-- Differential correctness test + benchmark runner.
-- usage: lune run luau-bench/harness/runner.luau <case> [<case>...] [--quick] [--no-check] [--no-bench]
--        [--agents=1,10,100,1000] [--scenario=npc|wide|deep|reactive]
-- "baseline" is a valid case name; other names resolve to luau-bench/cases/<name>.luau.

local process = require("@lune/process")
local S = require("./status")
local Scenarios = require("./scenarios")

-- Keep a big live heap so incremental GC sweeps are rare: per-tick heap deltas then equal real allocation.
local PAD = buffer.create(32 * 1024 * 1024)

local USAGE = [[
usage: lune run luau-bench/harness/runner.luau <case> [<case>...] [options]
  --quick            fewer ticks / reps
  --no-check         skip the differential correctness test
  --no-bench         skip benchmarks
  --agents=1,10,100  agent counts to benchmark (default 1,10,100,1000)
  --scenario=name    only this scenario (npc | wide | deep | reactive)
]]

local names = {}
local opts = { agents = { 1, 10, 100, 1000 }, quick = false, check = true, bench = true, scenarios = Scenarios.list }
for _, a in process.args do
	if a:sub(1, 2) == "--" then
		local k, v = a:match("^%-%-([%w_%-]+)=?(.*)$")
		if k == "quick" then
			opts.quick = true
		elseif k == "no-check" then
			opts.check = false
		elseif k == "no-bench" then
			opts.bench = false
		elseif k == "agents" then
			opts.agents = {}
			for n in v:gmatch("%d+") do opts.agents[#opts.agents + 1] = tonumber(n) end
		elseif k == "scenario" then
			opts.scenarios = { v }
		else
			error("unknown option " .. a .. "\n" .. USAGE)
		end
	else
		names[#names + 1] = a
	end
end
if #names == 0 then
	print(USAGE)
	return
end

local function load_case(name)
	if name == "baseline" then return require("./baseline_adapter") end
	return require("../cases/" .. name)
end

local CHECK_DT = 0.125 -- exact in binary: timers never hit float-order differences
local BENCH_DT = 1 / 60

---------------------------------------------------------------------------------------------------
-- Correctness: run a scripted schedule (add / remove / re-add agents) and record, per tick, the root
-- status of every live agent plus the sorted multiset of leaf events. Compare with baseline.
---------------------------------------------------------------------------------------------------
local SCHEDULE = {
	[1] = { add = { 1, 2, 3, 4, 5, 6 } },
	[30] = { remove = { 3 } },
	[40] = { add = { 9 } },
	[60] = { remove = { 9 } },
	[70] = { add = { 3 } },
}
local CHECK_TICKS = 80

local function run_trace(adapter, scenario_name)
	local ctx = { tick = 0, trace = nil }
	local spec = Scenarios.build(scenario_name, ctx)
	local world = adapter.new_world(spec)
	local live = {}
	local steps = {}
	for t = 1, CHECK_TICKS do
		ctx.tick = t
		ctx.trace = {}
		local sched = SCHEDULE[t]
		if sched then
			if sched.remove then
				for _, id in sched.remove do
					adapter.remove_agent(world, id)
					live[id] = nil
				end
			end
			if sched.add then
				for _, id in sched.add do
					adapter.add_agent(world, id)
					live[id] = true
				end
			end
		end
		adapter.tick(world, CHECK_DT)
		local statuses = {}
		for id in live do
			local st = adapter.get_status(world, id)
			statuses[#statuses + 1] = id .. "=" .. (S.NAMES[st] or ("?" .. tostring(st)))
		end
		table.sort(statuses)
		table.sort(ctx.trace)
		steps[t] = { status = table.concat(statuses, " "), events = table.concat(ctx.trace, " ") }
		ctx.trace = nil
	end
	return steps
end

local function diff_events(expected, got)
	local exp, g = {}, {}
	for e in expected:gmatch("%S+") do exp[e] = (exp[e] or 0) + 1 end
	for e in got:gmatch("%S+") do g[e] = (g[e] or 0) + 1 end
	local missing, extra = {}, {}
	for e, n in exp do
		local m = g[e] or 0
		if m < n then missing[#missing + 1] = e .. (n - m > 1 and (" x" .. (n - m)) or "") end
	end
	for e, n in g do
		local m = exp[e] or 0
		if n > m then extra[#extra + 1] = e .. (n - m > 1 and (" x" .. (n - m)) or "") end
	end
	table.sort(missing)
	table.sort(extra)
	return missing, extra
end

local function check_case(name, adapter, expected_by_scenario)
	local all_ok = true
	for _, sc in opts.scenarios do
		local ok, res = pcall(run_trace, adapter, sc)
		if not ok then
			print(string.format("  [%s] %-9s ERROR: %s", name, sc, tostring(res)))
			all_ok = false
			continue
		end
		local expected = expected_by_scenario[sc]
		local failed_tick
		for t = 1, CHECK_TICKS do
			if res[t].status ~= expected[t].status or res[t].events ~= expected[t].events then
				failed_tick = t
				break
			end
		end
		if failed_tick then
			all_ok = false
			local e, g = expected[failed_tick], res[failed_tick]
			print(string.format("  [%s] %-9s FAIL at tick %d", name, sc, failed_tick))
			if e.status ~= g.status then
				print("      expected status: " .. e.status)
				print("      got      status: " .. g.status)
			end
			if e.events ~= g.events then
				local missing, extra = diff_events(e.events, g.events)
				if #missing > 0 then print("      missing events: " .. table.concat(missing, " ")) end
				if #extra > 0 then print("      extra events:   " .. table.concat(extra, " ")) end
			end
		else
			local nodes = Scenarios.count_nodes(Scenarios.build(sc, { tick = 0 }))
			print(string.format("  [%s] %-9s ok (%d ticks, %d nodes)", name, sc, CHECK_TICKS, nodes))
		end
	end
	return all_ok
end

---------------------------------------------------------------------------------------------------
-- Benchmark
---------------------------------------------------------------------------------------------------
local BUDGET = opts.quick and 15000 or 60000 -- agent-ticks per measurement rep
local REPS = opts.quick and 2 or 3

-- Bytes allocated by a call, measured as the sum of positive heap deltas (accurate at fine granularity
-- because the 32 MB pad makes GC sweeps rare).
local function alloc_of(fn, ...)
	local h0 = collectgarbage("count")
	fn(...)
	local d = collectgarbage("count") - h0
	return d > 0 and d * 1024 or 0
end

local function bench_case(adapter, scenario_name, N)
	local ctx = { tick = 0 }
	local spec = Scenarios.build(scenario_name, ctx)
	local world = adapter.new_world(spec)
	-- Per-agent cost of existing: allocation during add_agent plus the first tick (lazy state creation).
	local add_bytes = 0
	for id = 1, N do
		add_bytes += alloc_of(adapter.add_agent, world, id)
	end
	ctx.tick += 1
	add_bytes += alloc_of(adapter.tick, world, BENCH_DT)
	local ticks = math.max(30, math.floor(BUDGET / N))
	for _ = 1, math.min(ticks, 50) do
		ctx.tick += 1
		adapter.tick(world, BENCH_DT)
	end

	-- Allocation: sample the heap around each tick, before the heavy timing loop so its garbage
	-- (and the GC sweep that follows) cannot land in the samples.
	local deltas = {}
	for i = 1, math.min(ticks, 300) do
		ctx.tick += 1
		local h0 = collectgarbage("count")
		adapter.tick(world, BENCH_DT)
		deltas[i] = collectgarbage("count") - h0
	end
	table.sort(deltas)
	-- Timing: nothing but the world tick inside the timed loop.
	local best = math.huge
	for _ = 1, REPS do
		local t0 = os.clock()
		for _ = 1, ticks do
			ctx.tick += 1
			adapter.tick(world, BENCH_DT)
		end
		local elapsed = os.clock() - t0
		if elapsed < best then best = elapsed end
	end
	local median = deltas[math.ceil(#deltas / 2)]
	return {
		us_per_agent_tick = best / (ticks * N) * 1e6,
		bytes_per_agent_tick = median * 1024 / N,
		add_kb_per_agent = add_bytes / N / 1024,
		ticks = ticks,
	}
end

---------------------------------------------------------------------------------------------------
-- Main
---------------------------------------------------------------------------------------------------
-- Lune compiles required modules with Luau native codegen (verified: a sqrt loop runs at ~2 ns/iter via
-- require vs ~21 ns via luau.load with codegenEnabled=false), so these numbers correspond to Roblox --!native.
print(string.format("runtime: %s (Luau native codegen for required modules; comparable to Roblox --!native)", _VERSION))

local baseline = require("./baseline_adapter")
local expected = {}
if opts.check then
	for _, sc in opts.scenarios do expected[sc] = run_trace(baseline, sc) end
end

local passing = {}
for _, name in names do
	local ok, adapter = pcall(load_case, name)
	if not ok then
		print(string.format("[%s] failed to load: %s", name, tostring(adapter)))
		continue
	end
	if opts.check and name ~= "baseline" then
		print(string.format("[%s] correctness vs baseline", name))
		if check_case(name, adapter, expected) then
			passing[#passing + 1] = { name = name, adapter = adapter }
		else
			print(string.format("[%s] correctness FAILED -> skipping benchmark", name))
		end
	else
		passing[#passing + 1] = { name = name, adapter = adapter }
	end
end

if opts.bench and #passing > 0 then
	print("")
	print("| case | scenario | agents | us/agent-tick | B/agent-tick | KB/agent (add + 1st tick) |")
	print("|---|---|---:|---:|---:|---:|")
	for _, sc in opts.scenarios do
		for _, N in opts.agents do
			for _, c in passing do
				local r = bench_case(c.adapter, sc, N)
				print(string.format("| %s | %s | %d | %.3f | %.0f | %.2f |", c.name, sc, N, r.us_per_agent_tick,
					r.bytes_per_agent_tick, r.add_kb_per_agent))
			end
		end
	end
end
