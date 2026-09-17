--!optimize 2
-- (f) Everything else that materially moves a BT tick loop: iteration forms, and/or vs if,
--     constant vs upvalue comparison, globals vs cached locals, varargs, multiple returns,
--     and number vs string status codes.
local B = require("./bench")

local NA = 1000

local function mkdata()
	local D = { flag = true, nilv = nil, k = 3, C = 3, n = NA, a = 7, b = 11,
		st_num = 2, st_str = "running" }
	D.arr = table.create(NA)
	for i = 1, NA do D.arr[i] = i end
	D.dense_map = {}          -- SoM map, dense integer agent ids -> array part
	for i = 1, NA do D.dense_map[i] = i end
	D.sparse_map = {}         -- SoM map, sparse agent ids -> hash part
	D.sparse_ids = table.create(NA)
	for i = 1, NA do
		D.sparse_map[i * 1000] = i
		D.sparse_ids[i] = i * 1000
	end
	D.live_set = {}           -- `live[id] = true` membership set, sparse ids
	for i = 1, NA do D.live_set[i * 1000] = true end
	return D
end

return function()
	B.header("(f) Other things that move a tick loop")

	B.suite({
		title = "(f1) Iterating " .. NA .. " elements (ns per element)",
		note = "`arr` is a dense array of " .. NA .. " numbers; the maps hold one value per agent id.",
		data = mkdata,
		unroll = 1,
		iters = 1300,
		cases = {
			{ name = "`for i = 1, n do s = s + arr[i] end` — numeric for, count in a local",
				setup = "\tlocal arr = D.arr\n\tlocal n = D.n", body = "for i = 1, n do s = s + arr[i] end", opsmul = NA },
			{ name = "`for i = 1, #arr do ... end` — numeric for, `#` in the loop header",
				setup = "\tlocal arr = D.arr", body = "for i = 1, #arr do s = s + arr[i] end", opsmul = NA },
			{ name = "`for i, v in arr do s = s + v end` — Luau generic for over a table",
				setup = "\tlocal arr = D.arr", body = "for i, v in arr do s = s + v end", opsmul = NA },
			{ name = "`for i, v in ipairs(arr) do ... end`",
				setup = "\tlocal arr = D.arr", body = "for i, v in ipairs(arr) do s = s + v end", opsmul = NA },
			{ name = "`for k, v in pairs(arr) do ... end`",
				setup = "\tlocal arr = D.arr", body = "for k, v in pairs(arr) do s = s + v end", opsmul = NA },
			{ name = "dense ids: `for i = 1, n do local id = ids[i] s = s + map[id] end`",
				setup = "\tlocal ids = D.arr\n\tlocal map = D.dense_map\n\tlocal n = D.n",
				body = "for i = 1, n do local id = ids[i] s = s + map[id] end", opsmul = NA },
			{ name = "sparse ids: `for i = 1, n do local id = ids[i] s = s + map[id] end` (hash part)",
				setup = "\tlocal ids = D.sparse_ids\n\tlocal map = D.sparse_map\n\tlocal n = D.n",
				body = "for i = 1, n do local id = ids[i] s = s + map[id] end", opsmul = NA },
			{ name = "sparse ids: `for id, v in map do s = s + v end` (generic for over the hash map)",
				setup = "\tlocal map = D.sparse_map", body = "for id, v in map do s = s + v end", opsmul = NA },
			{ name = "sparse ids: `for id in live do s = s + map[id] end` (membership set + lookup)",
				setup = "\tlocal live = D.live_set\n\tlocal map = D.sparse_map",
				body = "for id in live do s = s + map[id] end", opsmul = NA },
		},
	})

	B.suite({
		title = "(f2) Branching, constants, globals",
		data = mkdata,
		cases = {
			{ name = "`if flag then s = s + 1 else s = s + 2 end`",
				setup = "\tlocal flag = D.flag", body = "if flag then s = s + 1 else s = s + 2 end" },
			{ name = "`s = s + (flag and 1 or 2)`",
				setup = "\tlocal flag = D.flag", body = "s = s + (flag and 1 or 2)" },
			{ name = "`if k == 1 then ... end` — compare against a literal",
				setup = "\tlocal k = D.k", body = "if k == 1 then s = s + 1 else s = s + 2 end" },
			{ name = "`if k == C then ... end` — C is a LOCAL",
				setup = "\tlocal k = D.k\n\tlocal C = D.C", body = "if k == C then s = s + 1 else s = s + 2 end" },
			{ name = "`if k == C then ... end` — C is an UPVALUE",
				setup = "\tlocal C = D.C", inner = "\t\tlocal k = D.k", body = "if k == C then s = s + 1 else s = s + 2 end", wrap = true },
			{ name = "`if st == 2 then` — numeric status compare",
				setup = "\tlocal st = D.st_num", body = "if st == 2 then s = s + 1 else s = s + 2 end" },
			{ name = "`if st == \"running\" then` — string status compare (interned, pointer eq)",
				setup = "\tlocal st = D.st_str", body = "if st == \"running\" then s = s + 1 else s = s + 2 end" },
			{ name = "`if x ~= nil then` — x is a present table value",
				setup = "\tlocal x = D.arr", body = "if x ~= nil then s = s + 1 end" },
			{ name = "`if x then` — x is a present table value",
				setup = "\tlocal x = D.arr", body = "if x then s = s + 1 end" },
			{ name = "`s = s + max(a, b)` — `math.max` cached in a local (fastcall)",
				setup = "\tlocal max = math.max\n\tlocal a, b = D.a, D.b", body = "s = s + max(a, b)" },
			{ name = "`s = s + math.max(a, b)` — through the global table",
				setup = "\tlocal a, b = D.a, D.b", body = "s = s + math.max(a, b)" },
			{ name = "`if a > b then s = s + a else s = s + b end` — inline instead of `max`",
				setup = "\tlocal a, b = D.a, D.b", body = "if a > b then s = s + a else s = s + b end" },
		},
	})

	B.suite({
		title = "(f3) Threading tick arguments: varargs vs fixed, and multiple returns",
		note = "The current design threads five tick arguments through every node call.",
		data = mkdata,
		cases = {
			{ name = "`f(a)` — 1 fixed arg, forwarded to a 1-arg callee",
				setup = "\tlocal function g(x) return x end\n\tlocal function f(x) return g(x) end", body = "s = s + f(1)" },
			{ name = "`f(a,b,c,d,e)` — 5 fixed args, forwarded to a 5-arg callee",
				setup = "\tlocal function g(a, b, c, d, e) return a end\n\tlocal function f(a, b, c, d, e) return g(a, b, c, d, e) end",
				body = "s = s + f(1, 2, 3, 4, 5)" },
			{ name = "`f(...)` — 5 args through varargs, forwarded with `...`",
				setup = "\tlocal function g(a, b, c, d, e) return a end\n\tlocal function f(...) return g(...) end",
				body = "s = s + f(1, 2, 3, 4, 5)" },
			{ name = "`f(ctx)` — 5 values packed into one long-lived context table, `ctx.dt` read inside",
				setup = "\tlocal ctx = { dt = 1, a = 2, b = 3, c = 4, d = 5 }\n"
					.. "\tlocal function g(c) return c.dt end\n\tlocal function f(c) return g(c) end", body = "s = s + f(ctx)" },
			{ name = "`local st = f(a)` — 1 return value",
				setup = "\tlocal function f(a) return a end", body = "local st = f(1) s = s + st" },
			{ name = "`local st, x = f(a)` — 2 return values",
				setup = "\tlocal function f(a) return a, a end", body = "local st, x = f(1) s = s + st" },
			{ name = "`local st, x, y = f(a)` — 3 return values",
				setup = "\tlocal function f(a) return a, a, a end", body = "local st, x, y = f(1) s = s + st" },
		},
	})
end
