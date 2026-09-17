--!optimize 2
-- (a) Indexing: SoM `t[a][b]` vs flat `t[a*N+b]` vs buffer vs upvalue vs `self.field[b]`,
--     dense / sparse / object keys, reads vs writes, and nil-then-reset.
local B = require("./bench")

local N = 64

local function mkdata()
	local D = {}
	-- 8 spread keys so the 8 unrolled bodies do not all hit the same cache line
	local ks = { 1, 9, 17, 25, 33, 41, 49, 57 }
	for j = 1, 8 do
		D["k" .. j] = ks[j]
		D["a" .. j] = j
		D["bo" .. j] = (j - 1) * 8        -- byte offsets for readu8
		D["fo" .. j] = (j - 1) * 32       -- byte offsets for readf32
		D["q" .. j] = j * 1000            -- sparse integer agent ids -> hash part
	end

	local t = table.create(N)
	for i = 1, N do t[i] = i end
	D.t = t

	local som = {}
	for a = 1, 8 do
		local row = table.create(N)
		for i = 1, N do row[i] = i end
		som[a] = row
	end
	D.som = som

	local flat = table.create(8 * N)
	for i = 1, 8 * N do flat[i] = i end
	D.flat = flat

	D.buf = buffer.create(8 * N * 4)

	local selfy = { field = t }
	for j = 1, 8 do selfy["f" .. j] = j end
	D.selfy = selfy

	-- sparse integer ids: 1000, 2000, ... -> hash part
	local sp = {}
	for j = 1, 200 do sp[j * 1000] = j end
	D.sp = sp

	-- table objects as keys
	local ok = {}
	for j = 1, 8 do
		local key = { id = j }
		D["o" .. j] = key
		ok[key] = j
	end
	D.ok = ok

	-- separate tables for the nil / re-set suite
	local na = table.create(N)
	for i = 1, N do na[i] = i end
	D.na = na
	local nh = {}
	for j = 1, 200 do nh[j * 1000] = j end
	D.nh = nh
	return D
end

local KS = "\t\tlocal k1, k2, k3, k4, k5, k6, k7, k8 = D.k1, D.k2, D.k3, D.k4, D.k5, D.k6, D.k7, D.k8"
local AS = "\t\tlocal a1, a2, a3, a4, a5, a6, a7, a8 = D.a1, D.a2, D.a3, D.a4, D.a5, D.a6, D.a7, D.a8"
local QS = "\t\tlocal q1, q2, q3, q4, q5, q6, q7, q8 = D.q1, D.q2, D.q3, D.q4, D.q5, D.q6, D.q7, D.q8"
local OS_ = "\t\tlocal o1, o2, o3, o4, o5, o6, o7, o8 = D.o1, D.o2, D.o3, D.o4, D.o5, D.o6, D.o7, D.o8"
local BOS = "\t\tlocal bo1, bo2, bo3, bo4, bo5, bo6, bo7, bo8 = D.bo1, D.bo2, D.bo3, D.bo4, D.bo5, D.bo6, D.bo7, D.bo8"
local FOS = "\t\tlocal fo1, fo2, fo3, fo4, fo5, fo6, fo7, fo8 = D.fo1, D.fo2, D.fo3, D.fo4, D.fo5, D.fo6, D.fo7, D.fo8"

return function()
	B.header("(a) Indexing")

	B.suite({
		title = "(a1) Reads",
		note = "`t`/`som`/`flat`/`buf`/`selfy` are cached locals; the index is a runtime local (never a\n"
			.. "constant, so the compiler cannot use the constant-index opcode) and rotates over 8 spread\n"
			.. "slots. `N = 64`.",
		data = mkdata,
		cases = {
			{ name = "`s = s + t[k]` — 1 lookup, dense int key (array part)",
				setup = "\tlocal t = D.t", inner = KS, body = "s = s + t[k$J]" },
			{ name = "`s = s + som[a][k]` — SoM, 2 lookups, outer key fixed",
				setup = "\tlocal som = D.som\n\tlocal a = D.a3", inner = KS, body = "s = s + som[a][k$J]" },
			{ name = "`s = s + som[a][b]` — SoM, 2 lookups, outer key rotates (node-major walk)",
				setup = "\tlocal som = D.som\n\tlocal b = D.k4", inner = AS, body = "s = s + som[a$J][b]" },
			{ name = "`s = s + flat[a * N + k]` — flat, index computed",
				setup = "\tlocal flat = D.flat\n\tlocal a = D.a3\n\tlocal n = 64", inner = KS, body = "s = s + flat[a * n + k$J]" },
			{ name = "`s = s + flat[k]` — flat, index already in a local",
				setup = "\tlocal flat = D.flat", inner = KS, body = "s = s + flat[k$J]" },
			{ name = "`s = s + buffer.readu8(buf, o)`",
				setup = "\tlocal buf = D.buf\n\tlocal readu8 = buffer.readu8", inner = BOS, body = "s = s + readu8(buf, bo$J)" },
			{ name = "`s = s + buffer.readf32(buf, o)`",
				setup = "\tlocal buf = D.buf\n\tlocal readf32 = buffer.readf32", inner = FOS, body = "s = s + readf32(buf, fo$J)" },
			{ name = "`s = s + up[k]` — table is an UPVALUE of the loop function",
				setup = "\tlocal up = D.t", inner = KS, body = "s = s + up[k$J]", wrap = true },
			{ name = "`s = s + loc[k]` — same shape, table is a LOCAL (upvalue control)",
				setup = "", inner = "\t\tlocal loc = D.t\n" .. KS, body = "s = s + loc[k$J]", wrap = true },
			{ name = "`s = s + self.field[k]` — string field then int key (2 lookups)",
				setup = "\tlocal self = D.selfy", inner = KS, body = "s = s + self.field[k$J]" },
			{ name = "`s = s + self.f` — string key only (GETTABLEKS, inline-cached)",
				setup = "\tlocal self = D.selfy", inner = "", body = "s = s + self.f$J" },
			{ name = "`s = s + sp[q]` — sparse int ids 1000,2000,... (hash part, 8 HOT keys — see (f1) for a cold 1000-id walk)",
				setup = "\tlocal sp = D.sp", inner = QS, body = "s = s + sp[q$J]" },
			{ name = "`s = s + ok[obj]` — table object as key (hash part)",
				setup = "\tlocal ok = D.ok", inner = OS_, body = "s = s + ok[o$J]" },
		},
	})

	B.suite({
		title = "(a2) Writes",
		data = mkdata,
		cases = {
			{ name = "`t[k] = i` — dense int key (array part)",
				setup = "\tlocal t = D.t", inner = KS, body = "t[k$J] = __i" },
			{ name = "`som[a][k] = i` — SoM, 2 lookups",
				setup = "\tlocal som = D.som\n\tlocal a = D.a3", inner = KS, body = "som[a][k$J] = __i" },
			{ name = "`flat[a * N + k] = i` — flat, index computed",
				setup = "\tlocal flat = D.flat\n\tlocal a = D.a3\n\tlocal n = 64", inner = KS, body = "flat[a * n + k$J] = __i" },
			{ name = "`buffer.writeu8(buf, o, 1)`",
				setup = "\tlocal buf = D.buf\n\tlocal writeu8 = buffer.writeu8", inner = BOS, body = "writeu8(buf, bo$J, 1)" },
			{ name = "`buffer.writef32(buf, o, 1.5)`",
				setup = "\tlocal buf = D.buf\n\tlocal writef32 = buffer.writef32", inner = FOS, body = "writef32(buf, fo$J, 1.5)" },
			{ name = "`up[k] = i` — table is an UPVALUE",
				setup = "\tlocal up = D.t", inner = KS, body = "up[k$J] = __i", wrap = true },
			{ name = "`loc[k] = i` — same shape, LOCAL (upvalue control)",
				setup = "", inner = "\t\tlocal loc = D.t\n" .. KS, body = "loc[k$J] = __i", wrap = true },
			{ name = "`self.field[k] = i`",
				setup = "\tlocal self = D.selfy", inner = KS, body = "self.field[k$J] = __i" },
			{ name = "`self.f = i` — string key (SETTABLEKS)",
				setup = "\tlocal self = D.selfy", inner = "", body = "self.f$J = __i" },
			{ name = "`sp[q] = i` — sparse int ids (hash part)",
				setup = "\tlocal sp = D.sp", inner = QS, body = "sp[q$J] = __i" },
			{ name = "`ok[obj] = i` — table object as key (hash part)",
				setup = "\tlocal ok = D.ok", inner = OS_, body = "ok[o$J] = __i" },
		},
	})

	B.suite({
		title = "(a3) Clearing a key and putting it back (per pair of statements)",
		note = "Cost of `t[k] = nil` followed later by `t[k] = v`, which is what per-agent state does on\n"
			.. "`remove_agent` / `add_agent`. Compared against two plain stores so the extra cost of the\n"
			.. "nil store is visible.",
		data = mkdata,
		cases = {
			{ name = "array part: `t[k] = 1; t[k] = 2` (control, 2 stores)",
				setup = "\tlocal na = D.na", inner = KS, body = "na[k$J] = 1 na[k$J] = 2" },
			{ name = "array part: `t[k] = nil; t[k] = 2`",
				setup = "\tlocal na = D.na", inner = KS, body = "na[k$J] = nil na[k$J] = 2" },
			{ name = "hash part: `t[q] = 1; t[q] = 2` (control, 2 stores)",
				setup = "\tlocal nh = D.nh", inner = QS, body = "nh[q$J] = 1 nh[q$J] = 2" },
			{ name = "hash part: `t[q] = nil; t[q] = 2`",
				setup = "\tlocal nh = D.nh", inner = QS, body = "nh[q$J] = nil nh[q$J] = 2" },
		},
	})
end
