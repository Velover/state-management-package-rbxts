--!optimize 2
-- (d) Per-tick allocation strategies: fresh table vs table.clear vs count-tracked reuse,
--     append idioms, `#t` vs a tracked count, table.create vs growth.
local B = require("./bench")

local K = 20 -- "nodes touched per tick": each timed op below builds/appends K entries

local function mkdata()
	local D = {}
	D.reuse = table.create(K)
	D.ins = table.create(K)
	D.tracked = table.create(K)
	D.hash = {}
	D.arr = table.create(64)
	for i = 1, 64 do D.arr[i] = i end
	D.n = 64
	D.big = table.create(1000)
	for i = 1, 1000 do D.big[i] = i end
	return D
end

local sink

return function()
	B.header("(d) Per-tick allocation strategies")

	B.suite({
		title = "(d1) Building a " .. K .. "-entry per-tick list (ns per whole list, and per entry)",
		note = "One op = one tick's worth of work: produce a list of " .. K .. " values. Divide by " .. K .. " for per-entry cost.",
		data = mkdata,
		unroll = 1,
		iters = 65536,
		cases = {
			{ name = "fresh `{}` + grow: `local t = {} for j=1," .. K .. " do t[j]=j end`",
				setup = "", body = "local t = {} for j = 1, " .. K .. " do t[j] = j end s = s + t[1]" },
			{ name = "fresh `table.create(" .. K .. ")` + fill",
				setup = "", body = "local t = table.create(" .. K .. ") for j = 1, " .. K .. " do t[j] = j end s = s + t[1]" },
			{ name = "reuse + `table.clear(t)` + fill",
				setup = "\tlocal t = D.reuse", body = "table.clear(t) for j = 1, " .. K .. " do t[j] = j end s = s + t[1]" },
			{ name = "reuse, count-tracked, never cleared: `n=0 ... t[n+1]=v n+=1`",
				setup = "\tlocal t = D.tracked", body = "local n = 0 for j = 1, " .. K .. " do n += 1 t[n] = j end s = s + t[1]" },
			{ name = "reuse + `table.insert(t, v)` (after clear)",
				setup = "\tlocal t = D.ins", body = "table.clear(t) for j = 1, " .. K .. " do table.insert(t, j) end s = s + t[1]" },
			{ name = "reuse + `t[#t+1] = v` (after clear)",
				setup = "\tlocal t = D.ins", body = "table.clear(t) for j = 1, " .. K .. " do t[#t + 1] = j end s = s + t[1]" },
			{ name = "reuse + `t[n+1] = v; n += 1` (after clear)",
				setup = "\tlocal t = D.ins", body = "table.clear(t) local n = 0 for j = 1, " .. K .. " do t[n + 1] = j n += 1 end s = s + t[1]" },
			{ name = "fresh `{}` used as a SET: `t[node] = true` x " .. K .. " (the baseline's per-tick sets)",
				setup = "\tlocal arr = D.arr", body = "local t = {} for j = 1, " .. K .. " do t[arr[j]] = true end s = s + 1" },
		},
	})

	B.suite({
		title = "(d2) Length vs a tracked count, and `table.clear`",
		note = "Append idioms are measured in (d1) instead, where the list stays bounded at " .. K .. " entries;\n"
			.. "an unbounded `t[#t+1]` / `table.insert` loop would measure array growth, not the idiom.",
		data = mkdata,
		cases = {
			{ name = "`s = s + #t` — length operator on a 64-entry array", setup = "\tlocal t = D.arr", body = "s = s + #t" },
			{ name = "`s = s + n` — tracked count in a local", setup = "\tlocal n = D.n", body = "s = s + n" },
			{ name = "`s = s + t.n` — count stored as a field on the table", setup = "\tlocal t = { n = 64 }", body = "s = s + t.n" },
			{ name = "`t[n] = v` — store, index already in a local (same slot)", setup = "\tlocal t = D.ins\n\tlocal n = 1", body = "t[n] = __i" },
			{ name = "`t[n + 1] = v` — store, one add", setup = "\tlocal t = D.ins\n\tlocal n = 0", body = "t[n + 1] = __i" },
			{ name = "`table.clear(t)` — 20-entry array", setup = "\tlocal t = D.reuse", body = "table.clear(t)", unroll = 1 },
			{ name = "`table.clear(t)` — 1000-entry array", setup = "\tlocal t = D.big", body = "table.clear(t)", unroll = 1 },
		},
	})

	print("")
	print("### (d3) Bytes allocated (sum of positive `collectgarbage(\"count\")` deltas, one sample per op)")
	print("")
	print("| op | B/op |")
	print("|---|---:|")
	local function row(name, step)
		print(string.format("| %s | %.1f |", name, B.bytes_per_op(step)))
	end

	row("`{}` — empty table", function() sink = {} end)
	row("`table.create(" .. K .. ")`", function() sink = table.create(K) end)
	row("`{ time_left = 0, cursor = 1 }` — a 2-field per-agent state table", function() sink = { time_left = 0, cursor = 1 } end)
	row("fresh `{}` + fill " .. K .. " entries (grow)", function()
		local t = {}
		for j = 1, K do t[j] = j end
		sink = t
	end)
	row("fresh `table.create(" .. K .. ")` + fill " .. K .. " entries", function()
		local t = table.create(K)
		for j = 1, K do t[j] = j end
		sink = t
	end)
	row("fresh `{}` set of " .. K .. " table keys (`t[node] = true`)", function()
		local t = {}
		for j = 1, K do t[j * 1000] = true end
		sink = t
	end)
	local reuse = table.create(K)
	row("reuse + `table.clear` + fill " .. K, function()
		table.clear(reuse)
		for j = 1, K do reuse[j] = j end
	end)
	local tracked = table.create(K)
	row("reuse, count-tracked, never cleared, " .. K .. " writes", function()
		local n = 0
		for j = 1, K do n += 1 tracked[n] = j end
	end)
	local ins = table.create(K)
	row("reuse + `table.clear` + `table.insert` x " .. K, function()
		table.clear(ins)
		for j = 1, K do table.insert(ins, j) end
	end)

	-- closures and objects: the per-agent memory question.
	-- NOTE: Luau caches the closure created by a NEWCLOSURE site when all its upvalues are the same
	-- objects as last time, so capturing an unchanging upvalue allocates NOTHING. A per-agent closure
	-- captures fresh state, which defeats the cache -- both rows are reported.
	local upc = 1
	row("`function() return upc end` — 1 upvalue, SAME value every time (closure cache hits)",
		function() sink = function() return upc end end)
	local idc = 0
	row("`function() return x end` — 1 FRESH upvalue each time (cache miss)", function()
		idc += 1
		local x = idc
		sink = function() return x end
	end)
	row("`function() return a + b + c end` — 3 FRESH upvalues each time", function()
		idc += 1
		local a, b, c = idc, idc, idc
		sink = function() return a + b + c end
	end)
	row("closure + its own 1-field state table (a per-(node,agent) closure design)", function()
		idc += 1
		local st = { n = idc }
		sink = function() return st.n end
	end)
	local MT = {}
	MT.__index = MT
	row("`setmetatable({}, MT)` — one class instance", function() sink = setmetatable({}, MT) end)
	row("`setmetatable({ a = 1, b = 2, c = 3 }, MT)` — instance with 3 fields",
		function() sink = setmetatable({ a = 1, b = 2, c = 3 }, MT) end)
	row("one new key in an existing SoM map (`m[id] = 0`, hash part, amortised)", (function()
		local m = {}
		local id = 0
		return function()
			id += 1
			m[id * 1000] = 0
		end
	end)())
	row("one new key in an existing dense array (`m[id] = 0`, array part, amortised)", (function()
		local m = {}
		local id = 0
		return function()
			id += 1
			m[id] = 0
		end
	end)())
	row("`buffer.create(4096)`", function() sink = buffer.create(4096) end)
	row("nothing (control)", function() end)
end
