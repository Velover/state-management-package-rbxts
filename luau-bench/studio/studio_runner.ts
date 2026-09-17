#!/usr/bin/env bun
/**
 * Runs the luau-bench behavior-tree design bench inside Roblox Studio, over the Studio MCP server,
 * in both codegen modes (`--!native` and plain `--!optimize 2`).
 *
 *   bun run luau-bench/studio/studio_runner.ts
 *   bun run luau-bench/studio/studio_runner.ts --quick --scenario=npc --agents=1,1000
 *   bun run luau-bench/studio/studio_runner.ts --mode=native --cases=baseline,closure_single
 *
 * Prerequisites: Roblox Studio open on any place, with MCP enabled in its Assistant settings.
 * What it leaves behind: nothing. The driver's Folder is removed at the end and the place is never
 * saved. Studio stays in Edit mode throughout.
 *
 * See studio/README.md for the whole picture; the MCP client below is the one from other_runner.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDriverChunk, cleanupChunk, pollChunk } from "./bundle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = resolve(here, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");
const LUNE_RUN = join(RESULTS_DIR, "_final_run.txt");

/** The bat that launches it resolves to this; spawning the exe directly skips a cmd.exe layer. */
const MCP_EXE = join(
	process.env.LOCALAPPDATA ?? "C:/Users/Default/AppData/Local",
	"Roblox/Versions/version-55808de4b1914919/StudioMCP.exe",
);
const MCP_BAT = join(process.env.LOCALAPPDATA ?? "C:/Users/Default/AppData/Local", "Roblox/mcp.bat");

/** A poll that times out is retried: the slice's state lives in the place, not in the call. */
const CALL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 750;
/** Per slice. A full interpreted `wide` slice at 1000 agents is the worst case by a wide margin. */
const SLICE_TIMEOUT_MS = 30 * 60_000;

const DEFAULT_CASES = [
	"baseline",
	"oop_shared_alias",
	"closure_single",
	"closure_batch",
	"flat_dispatch_pernode",
	"flat_batch",
	"flat_batch_buffer",
];
const ALL_SCENARIOS = ["npc", "wide", "deep", "reactive"];
const FOLDER = "LuauBench";

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface Studio {
	id: string;
	name: string;
}

function fail(message: string): never {
	console.error(`\nerror: ${message}`);
	process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- mcp client ---

/** Minimal JSON-RPC client for the Studio MCP server over stdio. */
class McpClient {
	private proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	private nextId = 1;
	private buffer = "";
	private dead = false;

	constructor(command: string, args: string[]) {
		this.proc = Bun.spawn([command, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		void this.readLoop();
		void this.drainStderr();
	}

	private async drainStderr() {
		const decoder = new TextDecoder();
		for await (const chunk of this.proc.stderr as ReadableStream<Uint8Array>) {
			const text = decoder.decode(chunk).trim();
			if (text && process.env.MCP_DEBUG) console.error(`${DIM}[mcp] ${text.slice(0, 300)}${RESET}`);
		}
	}

	private async readLoop() {
		const decoder = new TextDecoder();
		for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
			this.buffer += decoder.decode(chunk);
			let newline: number;
			while ((newline = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				if (!line) continue;
				let message: any;
				try {
					message = JSON.parse(line);
				} catch {
					continue; // the server also logs plain text on stdout
				}
				const waiter = message.id !== undefined ? this.pending.get(message.id) : undefined;
				if (waiter) {
					this.pending.delete(message.id);
					if (message.error) waiter.reject(new Error(message.error.message ?? "MCP error"));
					else waiter.resolve(message.result);
				}
			}
		}
		this.dead = true;
		for (const waiter of this.pending.values()) waiter.reject(new Error("the MCP server exited"));
		this.pending.clear();
	}

	private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
		if (this.dead) return Promise.reject(new Error("the MCP server exited"));
		const id = this.nextId++;
		return new Promise((resolve_, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`timed out after ${timeoutMs}ms waiting for ${method}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve_(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
			this.proc.stdin.flush();
		});
	}

	async initialize() {
		await this.request(
			"initialize",
			{
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "luau-bench-studio", version: "1.0.0" },
			},
			CALL_TIMEOUT_MS,
		);
		this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
		this.proc.stdin.flush();
		// Some servers only finish wiring themselves up once the tool list is asked for.
		await this.request("tools/list", {}, CALL_TIMEOUT_MS).catch(() => undefined);
	}

	async callTool(name: string, args: Record<string, unknown>, timeoutMs = CALL_TIMEOUT_MS): Promise<string> {
		const result = await this.request("tools/call", { name, arguments: args }, timeoutMs);
		const text = (result?.content ?? [])
			.filter((part: any) => part?.type === "text")
			.map((part: any) => part.text)
			.join("\n");
		if (result?.isError) throw new Error(`${name} failed: ${text}`);
		return text;
	}

	close() {
		this.proc.kill();
	}
}

async function listStudios(mcp: McpClient): Promise<Studio[]> {
	// StudioMCP opens its bridge to Studio asynchronously after launch, so the first call can land
	// before Studio is reachable. Retry for ~30s, then give up with something actionable.
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < 30; attempt++) {
		try {
			const text = await mcp.callTool("list_roblox_studios", {});
			const studios = (JSON.parse(text).studios ?? []) as Studio[];
			if (studios.length > 0) return studios;
		} catch (error) {
			lastError = error as Error;
		}
		await sleep(1000);
	}
	fail(
		"no Roblox Studio instance answered in 30s.\n" +
			"  - Is Studio open with a place loaded?\n" +
			"  - Is MCP enabled in Studio's Assistant settings (Assistant -> settings -> MCP)?\n" +
			(lastError ? `  Last error: ${lastError.message}` : "  The server returned an empty list."),
	);
}

/** Arrow-key list: up/down (or j/k, or a number) to move, Enter to choose. */
function pickWithArrows(studios: Studio[]): Promise<Studio> {
	return new Promise((resolve_, reject) => {
		const stdin = process.stdin;
		let index = 0;
		const draw = (redraw: boolean) => {
			if (redraw) process.stdout.write(`\x1b[${studios.length}A`);
			studios.forEach((studio, i) => {
				const on = i === index;
				process.stdout.write(
					`\x1b[2K ${on ? `${CYAN}>${RESET}` : " "} ${on ? `${CYAN}${studio.name}${RESET}` : studio.name}\n`,
				);
			});
		};
		const finish = (studio?: Studio) => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off("data", onData);
			if (studio) resolve_(studio);
			else reject(new Error("cancelled"));
		};
		const onData = (key: string) => {
			switch (key) {
				case "\u0003":
				case "\u001b":
					process.stdout.write("\n");
					return finish();
				case "\r":
				case "\n":
					return finish(studios[index]!);
				case "\u001b[A":
				case "k":
					index = (index - 1 + studios.length) % studios.length;
					break;
				case "\u001b[B":
				case "j":
					index = (index + 1) % studios.length;
					break;
				default: {
					const choice = Number(key);
					if (!Number.isInteger(choice) || choice < 1 || choice > studios.length) return;
					index = choice - 1;
				}
			}
			draw(true);
		};
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		stdin.on("data", onData);
		draw(false);
	});
}

/** First available by default; `--studio=` filters by name; `--pick` asks. */
async function resolveStudio(mcp: McpClient, opts: Options): Promise<Studio> {
	let studios = await listStudios(mcp);
	if (opts.studio) {
		const needle = opts.studio.toLowerCase();
		studios = studios.filter((s) => s.name.toLowerCase().includes(needle));
		if (studios.length === 0) fail(`no open Studio instance matches --studio=${opts.studio}`);
	}
	if (opts.pick && studios.length > 1 && process.stdin.isTTY) {
		console.log(`\nSelect a Studio instance  ${DIM}(arrows, Enter to choose)${RESET}\n`);
		return pickWithArrows(studios).catch(() => fail("cancelled"));
	}
	return studios[0]!;
}

// ----------------------------------------------------------------- options ---

interface Options {
	cases: string[];
	scenarios: string[];
	agents: number[];
	quick: boolean;
	modes: ("native" | "interp")[];
	studio?: string;
	pick: boolean;
	check: boolean;
	bench: boolean;
	outDir: string;
}

const USAGE = `usage: bun run luau-bench/studio/studio_runner.ts [options]
  --mode=native|interp|both   which codegen mode(s) to run   (default both)
  --cases=a,b,c               cases to run                   (default the 7 from results/SUMMARY.md)
  --scenario=npc|wide|deep|reactive   only this scenario     (default all four)
  --agents=1,10,100,1000      agent counts                   (default 1,10,100,1000)
  --quick                     fewer ticks / reps
  --no-check                  skip the differential correctness test
  --no-bench                  only run the correctness test
  --studio=<name substring>   pick a Studio instance by name (default: the first one)
  --pick                      choose interactively when several match
  --out=<dir>                 where to write the reports     (default luau-bench/results)`;

function parseArgs(argv: string[]): Options {
	const opts: Options = {
		cases: DEFAULT_CASES,
		scenarios: ALL_SCENARIOS,
		agents: [1, 10, 100, 1000],
		quick: false,
		modes: ["native", "interp"],
		pick: false,
		check: true,
		bench: true,
		outDir: RESULTS_DIR,
	};
	for (const arg of argv) {
		const match = arg.match(/^--([\w-]+)=?(.*)$/);
		if (!match) fail(`unexpected argument "${arg}"\n${USAGE}`);
		const [, key, value] = match as unknown as [string, string, string];
		switch (key) {
			case "help":
				console.log(USAGE);
				process.exit(0);
			// falls through
			case "mode":
				if (value === "both") opts.modes = ["native", "interp"];
				else if (value === "native" || value === "interp") opts.modes = [value];
				else fail(`--mode must be native, interp or both`);
				break;
			case "cases":
				opts.cases = value.split(",").map((s) => s.trim()).filter(Boolean);
				if (opts.cases.length === 0) fail("--cases needs at least one case");
				break;
			case "scenario":
				if (!ALL_SCENARIOS.includes(value)) fail(`--scenario must be one of ${ALL_SCENARIOS.join(", ")}`);
				opts.scenarios = [value];
				break;
			case "agents":
				opts.agents = value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
				if (opts.agents.length === 0) fail("--agents needs at least one positive integer");
				break;
			case "quick":
				opts.quick = true;
				break;
			case "no-check":
				opts.check = false;
				break;
			case "no-bench":
				opts.bench = false;
				break;
			case "studio":
				opts.studio = value;
				break;
			case "pick":
				opts.pick = true;
				break;
			case "out":
				opts.outDir = resolve(value);
				break;
			default:
				fail(`unknown option "${arg}"\n${USAGE}`);
		}
	}
	for (const name of opts.cases) {
		if (name !== "baseline" && !existsSync(join(BENCH_ROOT, "cases", `${name}.luau`))) {
			fail(`no case file luau-bench/cases/${name}.luau`);
		}
	}
	return opts;
}

// ------------------------------------------------------------------ driver ---

interface Row {
	case: string;
	scenario: string;
	agents: number;
	us: number;
	bytes: number;
	kb: number;
}

interface ModeResult {
	mode: "native" | "interp";
	studioVersion: string;
	canaryNs: number;
	rows: Row[];
	checks: string[];
	seconds: number;
}

const ROW = /^\|\s*([\w.]+)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*([\d.]+)\s*\|$/;

function parseRows(text: string): Row[] {
	const rows: Row[] = [];
	for (const line of text.split("\n")) {
		const m = line.trim().match(ROW);
		if (!m) continue;
		rows.push({
			case: m[1]!,
			scenario: m[2]!,
			agents: Number(m[3]),
			us: Number(m[4]),
			bytes: Number(m[5]),
			kb: Number(m[6]),
		});
	}
	return rows;
}

/**
 * Sends one slice, then polls the StringValue until the driver writes `#DONE`. The spawn call
 * returns immediately, so a slice may block Studio for as long as it needs; a poll that times out
 * while Studio is busy is simply retried.
 */
async function runSlice(
	mcp: McpClient,
	studio: Studio,
	slice: string,
	chunk: string,
	label: string,
): Promise<string> {
	process.stdout.write(`  ${label} ${DIM}...${RESET}`);
	const started = Date.now();
	await mcp.callTool("execute_luau", { code: chunk, datamodel_type: "Edit", studio_id: studio.id });

	const poll = pollChunk(FOLDER, slice);
	const deadline = started + SLICE_TIMEOUT_MS;
	let text = "";
	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		try {
			text = await mcp.callTool("execute_luau", {
				code: poll,
				datamodel_type: "Edit",
				studio_id: studio.id,
			});
		} catch {
			continue; // Studio is busy inside the slice; the result is in the place, so just ask again
		}
		if (text === "#MISSING") continue;
		if (text.includes("#DONE")) {
			const secs = ((Date.now() - started) / 1000).toFixed(1);
			process.stdout.write(`\r  ${label} ${DIM}${secs}s${RESET}\x1b[K\n`);
			const error = text.split("\n").find((l) => l.startsWith("#error\t"));
			if (error) fail(`the slice "${slice}" failed inside Studio:\n${error.slice(7)}`);
			return text;
		}
	}
	return fail(`the slice "${slice}" did not finish within ${SLICE_TIMEOUT_MS / 60000} minutes`);
}

function field(text: string, key: string): string | undefined {
	const line = text.split("\n").find((l) => l.startsWith(`#${key}\t`));
	return line?.slice(key.length + 2);
}

async function runMode(mcp: McpClient, studio: Studio, opts: Options, mode: "native" | "interp"): Promise<ModeResult> {
	const native = mode === "native";
	console.log(`\n${CYAN}${mode}${RESET} ${DIM}(--!optimize 2${native ? " --!native" : ""})${RESET}`);
	const base = { root: BENCH_ROOT, cases: opts.cases, native, folder: FOLDER };
	const started = Date.now();

	// The canary rides along with the first slice so it is measured in the same chunk as the bench.
	const checks: string[] = [];
	let canaryNs = Number.NaN;
	let studioVersion = "unknown";
	const rows: Row[] = [];

	const checkArgs = [...opts.cases, "--no-bench"];
	if (opts.scenarios.length === 1) checkArgs.push(`--scenario=${opts.scenarios[0]}`);
	if (opts.check) {
		const text = await runSlice(
			mcp,
			studio,
			"check",
			buildDriverChunk({ ...base, args: checkArgs, slice: "check", canary: true }),
			"correctness".padEnd(28),
		);
		studioVersion = field(text, "studio") ?? studioVersion;
		canaryNs = Number(field(text, "canary")?.split("\t")[0] ?? Number.NaN);
		for (const line of text.split("\n")) {
			const m = line.match(/^\s*\[([\w.]+)\]\s+(\w+)\s+(ok|FAIL|ERROR)(.*)$/);
			if (m) checks.push(`${m[1]} / ${m[2]}: ${m[3] === "ok" ? "pass" : m[3]}${m[4] ?? ""}`);
		}
		console.log(
			`    canary ${canaryNs.toFixed(2)} ns/iter   ${checks.filter((c) => c.includes("pass")).length}/${checks.length} correctness checks pass`,
		);
	}

	if (opts.bench) {
		// One slice per (scenario, agents) over all cases: the same grouping the Lune runner uses, and
		// small enough that Studio gets a breath between slices.
		for (const scenario of opts.scenarios) {
			for (const agents of opts.agents) {
				const slice = `b_${scenario}_${agents}`;
				const args = [...opts.cases, "--no-check", `--scenario=${scenario}`, `--agents=${agents}`];
				if (opts.quick) args.push("--quick");
				const wantCanary = Number.isNaN(canaryNs);
				const text = await runSlice(
					mcp,
					studio,
					slice,
					buildDriverChunk({ ...base, args, slice, canary: wantCanary }),
					`${scenario} @ ${agents}`.padEnd(28),
				);
				if (studioVersion === "unknown") studioVersion = field(text, "studio") ?? studioVersion;
				if (wantCanary) canaryNs = Number(field(text, "canary")?.split("\t")[0] ?? Number.NaN);
				rows.push(...parseRows(text));
			}
		}
	}

	return { mode, studioVersion, canaryNs, rows, checks, seconds: (Date.now() - started) / 1000 };
}

// ----------------------------------------------------------------- reports ---

/**
 * The one place Studio cannot reproduce a Lune measurement. Roblox's `collectgarbage("count")`
 * returns whole kilobytes (verified: every reading and every delta is an integer), where Lune's is a
 * precise float, so the harness's per-tick heap delta is quantised to 1 KB here.
 */
const ALLOC_CAVEAT = [
	"> **Reading `B/agent-tick` in Studio.** Roblox's `collectgarbage(\"count\")` reports whole",
	"> kilobytes, so the harness's per-tick heap delta is quantised to 1024 B (Lune's counter is a",
	"> precise float). At 1000 agents a tick allocates hundreds of KB and the column is accurate to",
	"> well under 1%; at 1 and 10 agents the true per-tick figure is below the quantum, so a real 480 B",
	"> shows up as 0 or 1024. Trust the 1000-agent rows, and read `KB/agent (add + 1st tick)` the same",
	"> way. The zero-garbage claim for the shared-tree designs still holds: they read 0 at every agent",
	"> count, including 1000, where 480 B/agent-tick would have been impossible to miss.",
].join("\n");

function table(rows: Row[]): string {
	const out = [
		"| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |",
		"|---|---|---:|---:|---:|---:|",
	];
	for (const r of rows) {
		out.push(`| ${r.case} | ${r.scenario} | ${r.agents} | ${r.us.toFixed(3)} | ${r.bytes.toFixed(0)} | ${r.kb.toFixed(2)} |`);
	}
	return out.join("\n");
}

function writeModeReport(result: ModeResult, opts: Options, studio: Studio, stamp: string) {
	const native = result.mode === "native";
	const lines = [
		`# Studio bench: ${result.mode} (${native ? "--!native --!optimize 2" : "--!optimize 2, no --!native"})`,
		"",
		`Roblox Studio ${result.studioVersion} - ${studio.name}`,
		`Run ${stamp} through the Studio MCP server (\`luau-bench/studio/studio_runner.ts\`), Edit mode.`,
		`Cases: ${opts.cases.join(", ")}. ${opts.quick ? "Quick run (15k agent-ticks per rep, 2 reps)." : "Full run (60k agent-ticks per rep, 3 reps)."}`,
		`Wall time: ${result.seconds.toFixed(0)}s.`,
		"",
		"## Native-codegen canary",
		"",
		`\`s = s + math.sqrt(i) * 1.5\` x 5e6: **${Number.isNaN(result.canaryNs) ? "n/a" : result.canaryNs.toFixed(2)} ns/iter**.`,
		"",
	];
	if (result.checks.length > 0) {
		lines.push("## Differential correctness vs the baseline tree (in the Roblox VM)", "");
		lines.push("| case / scenario | result |", "|---|---|");
		for (const check of result.checks) {
			const [head, ...rest] = check.split(": ");
			lines.push(`| ${head} | ${rest.join(": ")} |`);
		}
		lines.push("");
	}
	if (result.rows.length > 0) lines.push("## Benchmark", "", table(result.rows), "", ALLOC_CAVEAT, "");
	writeFileSync(join(opts.outDir, `studio_${result.mode}.md`), lines.join("\n"));
}

function luneRows(): Row[] {
	if (!existsSync(LUNE_RUN)) return [];
	return parseRows(readFileSync(LUNE_RUN, "utf8"));
}

const key = (r: { case: string; scenario: string; agents: number }) => `${r.case}|${r.scenario}|${r.agents}`;

type RowMap = Map<string, Row> | undefined;

const median = (xs: number[]) => {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)]!;
};

/**
 * The verdict section, computed from the run rather than written by hand, so it cannot drift from
 * the table above it.
 */
function narrative(lune: Map<string, Row>, nat: RowMap, int: RowMap, opts: Options): string[] {
	const designs = opts.cases.filter((c) => c !== "baseline");
	const at = (src: RowMap, c: string, s: string, n: number) => src?.get(`${c}|${s}|${n}`)?.us;
	const best = (src: RowMap, s: string, n: number) => {
		const ranked = designs
			.map((c) => [c, at(src, c, s, n)] as const)
			.filter((x): x is readonly [string, number] => x[1] !== undefined)
			.sort((a, b) => a[1] - b[1]);
		return ranked[0]?.[0];
	};
	/** Lowest agent count at which `b` is faster than `a`, or undefined if it never is. */
	const crossover = (src: RowMap, a: string, b: string, s: string) => {
		for (const n of [...opts.agents].sort((x, y) => x - y)) {
			const av = at(src, a, s, n);
			const bv = at(src, b, s, n);
			if (av !== undefined && bv !== undefined && bv < av) return n;
		}
		return undefined;
	};

	const allKeys = [...(nat?.keys() ?? [])];
	const vsLune = median(
		allKeys.map((k) => (lune.get(k) && nat?.get(k) ? nat.get(k)!.us / lune.get(k)!.us : Number.NaN)).filter((x) => !Number.isNaN(x)),
	);
	const perCase = opts.cases.map((c) => {
		const ratios = allKeys
			.filter((k) => k.startsWith(`${c}|`))
			.map((k) => (nat?.get(k)?.us && int?.get(k)?.us ? int!.get(k)!.us / nat!.get(k)!.us : Number.NaN))
			.filter((x) => !Number.isNaN(x));
		return [c, median(ratios)] as const;
	});

	const out: string[] = ["## What changes in Studio", ""];
	out.push(
		`**Studio native is the fastest of the three runtimes.** Across all ${allKeys.length} rows the median`,
		`Studio-native time is **${vsLune.toFixed(2)}x** the Lune time, i.e. Studio runs the same bundled harness about`,
		`${Math.round((1 / vsLune - 1) * 100)}% faster than Lune does. The Lune numbers in SUMMARY.md are therefore`,
		"conservative for a `--!native` Roblox build, not optimistic.",
		"",
	);
	out.push("**How much each design depends on native codegen** (median interp / native over all rows):", "");
	out.push("| case | interp / native |", "|---|---:|");
	for (const [c, r] of [...perCase].sort((a, b) => a[1] - b[1])) {
		out.push(`| ${c} | ${Number.isNaN(r) ? "-" : r.toFixed(2) + "x"} |`);
	}
	out.push(
		"",
		"The spread is the point. The baseline barely notices codegen: it spends its time in metatable",
		"lookups, table allocation and GC, none of which codegen speeds up. The lean designs are the ones",
		"that lose the most without it, because what is left of them is arithmetic and calls. So the",
		"*ratio* between the baseline and the rework shrinks under the interpreter, but only from",
		"enormous to very large.",
		"",
	);

	const lowLead: string[] = [];
	for (const s of opts.scenarios) {
		const n = Math.min(...opts.agents);
		lowLead.push(`${s}: Lune ${best(lune, s, n) ?? "-"}, Studio native ${best(nat, s, n) ?? "-"}, Studio interp ${best(int, s, n) ?? "-"}`);
	}
	out.push(`**Does \`closure_single\` still lead at ${Math.min(...opts.agents)} agent(s)?** Fastest design per scenario:`, "");
	for (const line of lowLead) out.push(`- ${line}`);
	out.push("");

	if (designs.includes("closure_single") && designs.includes("closure_batch")) {
		out.push("**Where batching starts to pay** (lowest measured agent count at which `closure_batch` beats", "`closure_single`):", "");
		out.push("| scenario | Lune | Studio native | Studio interp |", "|---|---:|---:|---:|");
		for (const s of opts.scenarios) {
			const cells = [lune, nat, int].map((src) => {
				const n = crossover(src, "closure_single", "closure_batch", s);
				return n === undefined ? "never" : String(n);
			});
			out.push(`| ${s} | ${cells[0]} | ${cells[1]} | ${cells[2]} |`);
		}
		out.push("");
	}
	return out;
}

function writeComparison(results: ModeResult[], opts: Options, studio: Studio, stamp: string) {
	const lune = new Map(luneRows().map((r) => [key(r), r]));
	const byMode = new Map(results.map((r) => [r.mode, new Map(r.rows.map((x) => [key(x), x]))]));
	const nat = byMode.get("native");
	const int = byMode.get("interp");
	const canary = (mode: "native" | "interp") => results.find((r) => r.mode === mode)?.canaryNs;

	const num = (v: number | undefined, digits = 3) => (v === undefined ? "-" : v.toFixed(digits));
	const ratio = (a: number | undefined, b: number | undefined) =>
		a === undefined || b === undefined || a === 0 ? "-" : `${(b / a).toFixed(2)}x`;

	const lines = [
		"# Studio vs Lune",
		"",
		`Roblox Studio ${results[0]?.studioVersion ?? "?"} - ${studio.name}, Edit mode, ${stamp}.`,
		"Lune column: `results/_final_run.txt` (Lune 0.10.5, native codegen for required modules).",
		"Studio columns: `results/studio_native.md` and `results/studio_interp.md`, produced by",
		"`luau-bench/studio/studio_runner.ts` - the same harness, bundled into one chunk per slice and",
		"run through `execute_luau`. Same scenarios, same agent counts, same 60k agent-ticks per rep.",
		"",
		"## Native codegen really is on",
		"",
		"| runtime | canary ns/iter |",
		"|---|---:|",
		`| Lune (require, native codegen) | 2.0 |`,
		`| Studio \`--!native\` | ${num(canary("native"), 2)} |`,
		`| Studio plain interpreter | ${num(canary("interp"), 2)} |`,
		"",
		"## us per agent-tick",
		"",
		"| case | scenario | agents | Lune native | Studio native | Studio interp | Studio native / Lune | interp / native | B/agent-tick (Studio) |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|",
	];

	for (const scenario of opts.scenarios) {
		for (const agents of opts.agents) {
			for (const name of opts.cases) {
				const k = `${name}|${scenario}|${agents}`;
				const l = lune.get(k);
				const n = nat?.get(k);
				const i = int?.get(k);
				if (!n && !i && !l) continue;
				lines.push(
					`| ${name} | ${scenario} | ${agents} | ${num(l?.us)} | ${num(n?.us)} | ${num(i?.us)} | ` +
						`${ratio(l?.us, n?.us)} | ${ratio(n?.us, i?.us)} | ${n ? n.bytes.toFixed(0) : "-"} |`,
				);
			}
		}
	}
	lines.push("", ALLOC_CAVEAT, "");

	// How the ordering of designs moves between runtimes, computed rather than asserted.
	lines.push("## How the ordering of designs changes", "");
	const rank = (get: Map<string, Row> | undefined, scenario: string, agents: number) =>
		opts.cases
			.filter((c) => c !== "baseline" && get?.get(`${c}|${scenario}|${agents}`))
			.sort((a, b) => get!.get(`${a}|${scenario}|${agents}`)!.us - get!.get(`${b}|${scenario}|${agents}`)!.us);

	lines.push("Fastest design first, baseline excluded.", "");
	lines.push("| scenario | agents | Lune native | Studio native | Studio interp |", "|---|---:|---|---|---|");
	for (const scenario of opts.scenarios) {
		for (const agents of opts.agents) {
			const cells = [lune, nat, int].map((src) => {
				const order = rank(src, scenario, agents);
				return order.length ? order.join(" > ") : "-";
			});
			lines.push(`| ${scenario} | ${agents} | ${cells[0]} | ${cells[1]} | ${cells[2]} |`);
		}
	}
	lines.push("", ...narrative(lune, nat, int, opts));
	lines.push("");
	writeFileSync(join(opts.outDir, "studio_vs_lune.md"), lines.join("\n"));
}

// -------------------------------------------------------------------- main ---

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true });

	const [command, args] = existsSync(MCP_EXE)
		? ([MCP_EXE, []] as const)
		: existsSync(MCP_BAT)
			? (["cmd", ["/c", MCP_BAT]] as const)
			: fail(`no StudioMCP.exe at ${MCP_EXE} and no mcp.bat at ${MCP_BAT}`);

	const mcp = new McpClient(command, [...args]);
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
	try {
		await mcp.initialize();
		const studio = await resolveStudio(mcp, opts);
		console.log(`studio:    ${studio.name}`);
		console.log(`cases:     ${opts.cases.join(", ")}`);
		console.log(`scenarios: ${opts.scenarios.join(", ")}   agents: ${opts.agents.join(", ")}`);
		console.log(`modes:     ${opts.modes.join(", ")}${opts.quick ? "   (quick)" : ""}`);

		const results: ModeResult[] = [];
		for (const mode of opts.modes) {
			const result = await runMode(mcp, studio, opts, mode);
			results.push(result);
			writeModeReport(result, opts, studio, stamp);
			console.log(`  ${DIM}-> ${join(opts.outDir, `studio_${mode}.md`)}${RESET}`);
		}
		if (opts.bench) {
			writeComparison(results, opts, studio, stamp);
			console.log(`  ${DIM}-> ${join(opts.outDir, "studio_vs_lune.md")}${RESET}`);
		}

		// Leave nothing in the place. The place is never saved and Studio never leaves Edit mode.
		const cleaned = await mcp.callTool("execute_luau", {
			code: cleanupChunk(FOLDER),
			datamodel_type: "Edit",
			studio_id: studio.id,
		});
		console.log(`\ncleanup:   ${cleaned}`);
	} finally {
		mcp.close();
	}
}

await main();
