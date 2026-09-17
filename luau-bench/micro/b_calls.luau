--!optimize 2
-- (b) Calls and dispatch: closures, field-then-call, metatable chains, table dispatch,
--     if/elseif chains, arity, return-vs-write, recursion depth.
--
-- Every callee is declared inside the generated source so caller and callee always share the same
-- compilation mode (a natively compiled callee would flatter the interpreter column).
-- Every callee in (b1) is the SAME function `function(a) return a end`, because (b0) shows the
-- callee's own body changes the measured "call cost" by up to 50%.
local B = require("./bench")

local function mkdata()
	local D = { status = {}, S = 2, kind1 = 1, kindm = 4, kindl = 8, k3f = 1, k3m = 2, k3l = 3,
		k16f = 1, k16m = 8, k16l = 16 }
	for i = 1, 64 do D.status[i] = 0 end
	for j = 1, 8 do
		D["k" .. j] = j
		D["h" .. j] = j                 -- handler kinds 1..8
		D["n" .. j] = (j - 1) * 61 + 1  -- node ids spread through a 512-entry dispatch table
	end
	return D
end

local KS = "\t\tlocal k1, k2, k3, k4, k5, k6, k7, k8 = D.k1, D.k2, D.k3, D.k4, D.k5, D.k6, D.k7, D.k8"
local HS = "\t\tlocal h1, h2, h3, h4, h5, h6, h7, h8 = D.h1, D.h2, D.h3, D.h4, D.h5, D.h6, D.h7, D.h8"
local NS = "\t\tlocal n1, n2, n3, n4, n5, n6, n7, n8 = D.n1, D.n2, D.n3, D.n4, D.n5, D.n6, D.n7, D.n8"

local function chain(branches, var)
	local parts = {}
	for i = 1, branches do
		parts[#parts + 1] = (i == 1 and "if " or "elseif ") .. var .. " == " .. i .. " then s = s + " .. i
	end
	parts[#parts + 1] = "else s = s + 0 end"
	return table.concat(parts, " ")
end

local function ladder(depth)
	local parts = { "\tlocal function d0(x) return x end" }
	for i = 1, depth do
		parts[#parts + 1] = "\tlocal function d" .. i .. "(x) return d" .. (i - 1) .. "(x) end"
	end
	return table.concat(parts, "\n")
end

local CLASSES = table.concat({
	"\tlocal A = {}",
	"\tA.__index = A",
	"\tA.tick = function(self, a) return a end",
	"\tlocal obj1 = setmetatable({}, A)",
	"\tlocal C2 = setmetatable({}, { __index = A })",
	"\tC2.__index = C2",
	"\tlocal obj2 = setmetatable({}, C2)",
	"\tlocal C3 = setmetatable({}, { __index = C2 })",
	"\tC3.__index = C3",
	"\tlocal obj3 = setmetatable({}, C3)",
	"\tlocal own = { tick = function(self, a) return a end }",
}, "\n")

local DISPATCH = table.concat({
	"\tlocal handlers = table.create(8)",
	"\tfor i = 1, 8 do handlers[i] = function(a) return a end end",
	"\tlocal fns = table.create(512)",
	"\tfor i = 1, 512 do fns[i] = function(a) return a end end",
}, "\n")

return function()
	B.header("(b) Calls and dispatch")

	B.suite({
		title = "(b0) The callee's own body changes the cost of the call",
		note = "Identical call site `s = s + f(1)`; only the one-expression body of `f` differs. Reproducible\n"
			.. "to <3% over independent chunks, so it is not code alignment. Returning a literal or a computed\n"
			.. "value costs ~3.9 ns more under codegen than returning a parameter or an upvalue.",
		data = mkdata,
		cases = {
			{ name = "`function(a) return a end` (returns a parameter)",
				setup = "\tlocal function f(a) return a end", body = "s = s + f(1)" },
			{ name = "`function(a) return SUCCESS end` (SUCCESS is an upvalue)",
				setup = "\tlocal SUCCESS = D.S\n\tlocal function f(a) return SUCCESS end", body = "s = s + f(1)" },
			{ name = "`function(a) return 1 end` (returns a literal)",
				setup = "\tlocal function f(a) return 1 end", body = "s = s + f(1)" },
			{ name = "`function(a) return a + 1 end`",
				setup = "\tlocal function f(a) return a + 1 end", body = "s = s + f(1)" },
			{ name = "`function(a) return a, a end` (2 results, 1 used)",
				setup = "\tlocal function f(a) return a, a end", body = "s = s + f(1)" },
		},
	})

	B.suite({
		title = "(b1) Call shapes (every callee is the same `function(a) return a end`)",
		note = "`s = s + 1` (no call at all) is the floor.",
		data = mkdata,
		cases = {
			{ name = "`s = s + 1` — no call (floor)", setup = "", body = "s = s + 1" },
			{ name = "`f(1)` — local closure",
				setup = "\tlocal function f(a) return a end", body = "s = s + f(1)" },
			{ name = "`f(1)` — closure is an UPVALUE of the caller",
				setup = "\tlocal function f(a) return a end", body = "s = s + f(1)", wrap = true },
			{ name = "`node.tick(1)` — field lookup then call",
				setup = "\tlocal node = { tick = function(a) return a end }", body = "s = s + node.tick(1)" },
			{ name = "`node:tick(1)` — namecall, function stored on the table itself (no metatable)",
				setup = CLASSES, body = "s = s + own:tick(1)" },
			{ name = "`obj:tick(1)` — 1-level `__index` metatable",
				setup = CLASSES, body = "s = s + obj1:tick(1)" },
			{ name = "`obj:tick(1)` — 2-level `__index` chain",
				setup = CLASSES, body = "s = s + obj2:tick(1)" },
			{ name = "`obj:tick(1)` — 3-level `__index` chain",
				setup = CLASSES, body = "s = s + obj3:tick(1)" },
			{ name = "`handlers[kind](1)` — 8-entry table, kind fixed",
				setup = DISPATCH .. "\n\tlocal kind = D.kindm", body = "s = s + handlers[kind](1)" },
			{ name = "`handlers[kind](1)` — 8-entry table, kind rotates over all 8",
				setup = DISPATCH, inner = HS, body = "s = s + handlers[h$J](1)" },
			{ name = "`fns[id](1)` — 512-entry table, ids spread",
				setup = DISPATCH, inner = NS, body = "s = s + fns[n$J](1)" },
		},
	})

	B.suite({
		title = "(b2) Inline if/elseif chain on an integer kind (no call at all)",
		note = "Branch bodies are `s = s + <n>`; the kind is a runtime local, never a constant. \"fixed\" means\n"
			.. "the same branch every iteration (perfectly predicted); \"rotating\" cycles through all branches,\n"
			.. "which is what a real node-kind switch sees.",
		data = mkdata,
		cases = {
			{ name = "3 branches, 1st matches", setup = "\tlocal kind = D.k3f", body = chain(3, "kind") },
			{ name = "3 branches, 2nd (middle) matches", setup = "\tlocal kind = D.k3m", body = chain(3, "kind") },
			{ name = "3 branches, 3rd (last) matches", setup = "\tlocal kind = D.k3l", body = chain(3, "kind") },
			{ name = "8 branches, 1st matches", setup = "\tlocal kind = D.kind1", body = chain(8, "kind") },
			{ name = "8 branches, 4th (middle) matches", setup = "\tlocal kind = D.kindm", body = chain(8, "kind") },
			{ name = "8 branches, 8th (last) matches", setup = "\tlocal kind = D.kindl", body = chain(8, "kind") },
			{ name = "16 branches, 1st matches", setup = "\tlocal kind = D.k16f", body = chain(16, "kind") },
			{ name = "16 branches, 8th (middle) matches", setup = "\tlocal kind = D.k16m", body = chain(16, "kind") },
			{ name = "16 branches, 16th (last) matches", setup = "\tlocal kind = D.k16l", body = chain(16, "kind") },
			{ name = "8 branches, kind rotates over all 8 (unpredictable)", setup = "", inner = HS, body = chain(8, "h$J") },
		},
	})

	B.suite({
		title = "(b3) Arity, and returning a status vs writing it",
		note = "Arity rows use an empty callee (`function(a, b) end`) and the call site `f(...) s = s + 1`,\n"
			.. "so only the argument count varies.",
		data = mkdata,
		cases = {
			{ name = "`f()` — 0 args", setup = "\tlocal function f() end", body = "f() s = s + 1" },
			{ name = "`f(1)` — 1 arg", setup = "\tlocal function f(a) end", body = "f(1) s = s + 1" },
			{ name = "`f(1,2)` — 2 args", setup = "\tlocal function f(a, b) end", body = "f(1, 2) s = s + 1" },
			{ name = "`f(1,2,3,4,5)` — 5 args", setup = "\tlocal function f(a, b, c, d, e) end", body = "f(1, 2, 3, 4, 5) s = s + 1" },
			{ name = "`s = s + f(agent)` — leaf RETURNS the status (upvalue constant)",
				setup = "\tlocal SUCCESS = D.S\n\tlocal function f(a) return SUCCESS end", inner = KS, body = "s = s + f(k$J)" },
			{ name = "`f(agent)` — leaf WRITES `status[agent]` (upvalue table), returns nothing",
				setup = "\tlocal SUCCESS = D.S\n\tlocal status = D.status\n\tlocal function f(a) status[a] = SUCCESS end",
				inner = KS, body = "f(k$J) s = s + 1" },
			{ name = "`status[agent] = f(agent)` — leaf returns, caller stores it",
				setup = "\tlocal SUCCESS = D.S\n\tlocal status = D.status\n\tlocal function f(a) return SUCCESS end",
				inner = KS, body = "status[k$J] = f(k$J) s = s + 1" },
		},
	})

	B.suite({
		title = "(b4) Recursion / nesting depth (cost of one top-level call)",
		note = "`dN(x)` calls `dN-1(x)`; `d0(x)` returns `x`. This is the floor for per-agent recursive tree\n"
			.. "descent, before any node body runs.",
		data = mkdata,
		cases = {
			{ name = "`d0(1)` — 1 call (depth 0)", setup = ladder(0), body = "s = s + d0(1)" },
			{ name = "`d1(1)` — 2 nested calls", setup = ladder(1), body = "s = s + d1(1)" },
			{ name = "`d4(1)` — 5 nested calls (depth 4)", setup = ladder(4), body = "s = s + d4(1)" },
			{ name = "`d12(1)` — 13 nested calls (depth 12)", setup = ladder(12), body = "s = s + d12(1)", unroll = 4 },
		},
	})
end
