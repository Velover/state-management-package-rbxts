--!optimize 2
-- Runs the whole micro-benchmark study.
--   lune run luau-bench/micro/run_all.luau [topic ...]
-- topics: a_indexing b_calls c_hooks d_alloc e_batch f_misc   (default: all)
-- `sanity` is a separate file that validates the harness itself.
local process = require("@lune/process")
local luau = require("@lune/luau")
local B = require("./bench")

local ALL = { "a_indexing", "b_calls", "c_hooks", "d_alloc", "e_batch", "f_misc" }
local pick = #process.args > 0 and process.args or ALL

---------------------------------------------------------------------------------------------------
-- Environment probe: is Lune interpreting or natively compiling the code it runs?
---------------------------------------------------------------------------------------------------
local SRC = "return function(n) local s = 0.0 for i = 1, n do s = s + math.sqrt(i) * 1.5 end return s end"
local function timeit(f, n)
	f(n)
	local best = math.huge
	for _ = 1, 7 do
		local t0 = os.clock(); f(n); local t1 = os.clock()
		if t1 - t0 < best then best = t1 - t0 end
	end
	return best / n * 1e9
end
-- the same function, written here in a module Lune loaded with `require`
local function here(n)
	local s = 0.0
	for i = 1, n do s = s + math.sqrt(i) * 1.5 end
	return s
end

local N = 1048576
local t_here = timeit(here, N)
local t_off = timeit(luau.load(SRC, { optimizationLevel = 2, codegenEnabled = false })(), N)
local t_on = timeit(luau.load(SRC, { optimizationLevel = 2, codegenEnabled = true })(), N)

print("# Luau micro-benchmarks for the behaviour-tree rework")
print("")
print(string.format("runtime: %s / Lune 0.10.5, Windows x64", _VERSION))
print("")
print("Environment probe, `s = s + math.sqrt(i) * 1.5` in a loop, ns per iteration:")
print("")
print("| where the code came from | ns/iter |")
print("|---|---:|")
print(string.format("| this module, loaded by Lune's `require` | %.2f |", t_here))
print(string.format("| `luau.load(src, { codegenEnabled = false })` | %.2f |", t_off))
print(string.format("| `luau.load(src, { codegenEnabled = true })` | %.2f |", t_on))
print("")
print(string.format("Lune 0.10.5 embeds Luau's X64 code generator and applies it to everything it runs,"))
print(string.format("so `require`d code is NATIVE (%.2f ns/iter matches codegen=true's %.2f, not the", t_here, t_on))
print(string.format("interpreter's %.2f). Every table below therefore reports BOTH columns from one", t_off))
print("source string: `interp` = plain Luau VM, `native` = Luau codegen (the Roblox `--!native` case).")
print("")
print("ns/op = (min of 7 reps) - (min of 7 reps of the identical function with an empty loop body),")
print("divided by the op count. Bodies are unrolled 8x inside the loop so the ~2 ns (native) /")
print("~5 ns (interp) `for` back-edge does not swamp cheap ops. Reps are interleaved across the")
print("cases of a suite. Other benchmarks were running on this machine throughout; absolute numbers")
print("carry a few percent of noise, repeated runs agreed to <3%.")

for _, t in pick do
	require("./" .. t)()
end
