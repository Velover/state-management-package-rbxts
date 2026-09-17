--!optimize 2
-- Micro-benchmark harness for the BT rework study.
--
-- IMPORTANT ENVIRONMENT FINDING (see results/microbench.md):
-- Lune 0.10.5 embeds Luau's X64 native code generator (mlua `luau-jit`). Scripts run with
-- `lune run` and every module loaded with `require` are compiled to NATIVE CODE, not interpreted.
-- `luau.load(src, { codegenEnabled = false })` gives the plain interpreter for the same source.
-- So every op here is measured twice from ONE source string:
--   interp = plain Luau VM   (what a normal Roblox script gets)
--   native = Luau codegen    (what Roblox `--!native` gets, and what luau-bench/harness measures)
--
-- Method: source is generated so every name a "careful implementer" would cache is a real local
-- (or a real upvalue, for the cases that ask for one), never a global.
--   return function(__n, D)
--     <setup>              -- locals cached out of the data bundle D, outside the loop
--     local s = 0
--     for __i = 1, __n do
--       <body> x UNROLL    -- `$J` in body is replaced by the repetition index 1..UNROLL
--     end
--     return s
--   end
-- ns/op = (min-of-REPS time - min-of-REPS time of the identical function with an empty body)
--         / (__n * UNROLL).
-- Unrolling is required because a bare `for` back-edge costs ~2 ns (native) / ~5 ns (interp) here,
-- which would swamp the cheap ops. Reps are run round-robin across the cases in a suite so that a
-- load spike from another process cannot land on one case only.

local luau = require("@lune/luau")

-- Keep a big live heap so incremental GC sweeps are rare: heap deltas then equal real allocation.
local PAD = buffer.create(32 * 1024 * 1024)

local Bench = {}
Bench.PAD = PAD
Bench.ITERS = 262144 -- loop iterations; ops = ITERS * UNROLL = 2 097 152
Bench.UNROLL = 8
Bench.REPS = 7

local sink -- keeps returned values alive so nothing looks dead

---------------------------------------------------------------------------------------------------
-- source generation
---------------------------------------------------------------------------------------------------
local function build_src(setup, inner, body, unroll, wrap)
	local parts = {}
	for j = 1, unroll do
		parts[j] = "\t\t\t" .. (body:gsub("%$J", tostring(j)))
	end
	local loop = table.concat({
		"\t\tlocal s = 0",
		"\t\tfor __i = 1, __n do",
		table.concat(parts, "\n"),
		"\t\tend",
		"\t\treturn s",
	}, "\n")
	local out
	if wrap then
		-- everything in <setup> becomes an UPVALUE of the loop function
		out = table.concat({
			"return function(__n, D)",
			setup,
			"\tlocal run = function(__n)",
			inner,
			loop,
			"\tend",
			"\treturn run(__n)",
			"end",
		}, "\n")
	else
		out = table.concat({
			"return function(__n, D)",
			setup,
			inner,
			loop,
			"end",
		}, "\n")
	end
	return out
end

local compile_cache = {}
function Bench.compile(src)
	local hit = compile_cache[src]
	if hit then return hit end
	local i = luau.load(src, { optimizationLevel = 2, codegenEnabled = false, debugName = "interp" })()
	local n = luau.load(src, { optimizationLevel = 2, codegenEnabled = true, debugName = "native" })()
	local pair = { interp = i, native = n }
	compile_cache[src] = pair
	return pair
end

---------------------------------------------------------------------------------------------------
-- timing
---------------------------------------------------------------------------------------------------
local function time_once(fn, iters, D)
	local t0 = os.clock()
	local v = fn(iters, D)
	local t1 = os.clock()
	sink = v
	return t1 - t0
end

---------------------------------------------------------------------------------------------------
-- suite
--   opts = {
--     title  = string,
--     note   = string?,                       -- printed under the table
--     setup  = string?,                       -- prepended to every case's setup
--     data   = function() -> D,               -- default data bundle
--     iters, unroll, reps                     -- overrides
--     cases  = { { name, body, setup?, inner?, wrap?, data?, unroll? }, ... }
--   }
---------------------------------------------------------------------------------------------------
function Bench.suite(opts)
	local iters = opts.iters or Bench.ITERS
	local unroll = opts.unroll or Bench.UNROLL
	local reps = opts.reps or Bench.REPS
	local shared = opts.data and opts.data() or {}
	local suite_setup = opts.setup or ""

	-- one baseline per (unroll, wrap) shape actually used
	local baselines = {}
	local function baseline_for(u, wrap)
		local key = u .. (wrap and "w" or "l")
		local b = baselines[key]
		if not b then
			b = { pair = Bench.compile(build_src(suite_setup, "", "", u, wrap)), interp = math.huge, native = math.huge }
			baselines[key] = b
		end
		return b
	end

	local rows = {}
	for _, c in opts.cases do
		local u = c.unroll or unroll
		local src = build_src(suite_setup .. "\n" .. (c.setup or ""), c.inner or "", c.body, u, c.wrap)
		rows[#rows + 1] = {
			name = c.name,
			pair = Bench.compile(src),
			D = c.data and c.data() or shared,
			unroll = u,
			opsmul = c.opsmul or 1,
			base = baseline_for(u, c.wrap),
			interp = math.huge,
			native = math.huge,
			src = src,
		}
	end

	-- warm up
	for _, b in baselines do
		b.pair.interp(iters, shared)
		b.pair.native(iters, shared)
	end
	for _, r in rows do
		r.pair.interp(iters, r.D)
		r.pair.native(iters, r.D)
	end

	-- round-robin reps
	for _ = 1, reps do
		for _, b in baselines do
			local ti = time_once(b.pair.interp, iters, shared)
			if ti < b.interp then b.interp = ti end
			local tn = time_once(b.pair.native, iters, shared)
			if tn < b.native then b.native = tn end
		end
		for _, r in rows do
			local ti = time_once(r.pair.interp, iters, r.D)
			if ti < r.interp then r.interp = ti end
			local tn = time_once(r.pair.native, iters, r.D)
			if tn < r.native then r.native = tn end
		end
	end

	print("")
	print("### " .. opts.title)
	print("")
	if opts.note then
		print(opts.note)
		print("")
	end
	print("| op (loop body, all names are cached locals) | interp ns/op | native ns/op | x |")
	print("|---|---:|---:|---:|")
	local out = {}
	for _, r in rows do
		local ops = iters * r.unroll * r.opsmul
		local ni = (r.interp - r.base.interp) / ops * 1e9
		local nn = (r.native - r.base.native) / ops * 1e9
		if ni < 0 then ni = 0 end
		if nn < 0 then nn = 0 end
		print(string.format("| %s | %.2f | %.2f | %s |", r.name, ni, nn,
			nn > 0.02 and string.format("%.1f", ni / nn) or "-"))
		out[r.name] = { interp = ni, native = nn }
	end
	local b = baseline_for(unroll, false)
	print(string.format("| _(subtracted: empty `for __i=1,n do end`, per loop iteration)_ | %.2f | %.2f | |",
		b.interp / iters * 1e9, b.native / iters * 1e9))
	return out
end

---------------------------------------------------------------------------------------------------
-- allocation: sum of positive collectgarbage("count") deltas, sampled once per op.
-- The 32 MB pad makes GC sweeps rare enough that this is exact (48 B / empty table verified).
---------------------------------------------------------------------------------------------------
function Bench.bytes_per_op(step, samples, ...)
	samples = samples or 20000
	for _ = 1, 200 do step(...) end -- warm up / let tables reach steady shape
	local total = 0
	for _ = 1, samples do
		local h0 = collectgarbage("count")
		step(...)
		local d = collectgarbage("count") - h0
		if d > 0 then total += d end
	end
	return total * 1024 / samples
end

function Bench.header(title)
	print("")
	print("## " .. title)
end

return Bench
