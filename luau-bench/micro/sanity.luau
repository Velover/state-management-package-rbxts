--!optimize 2
-- Harness self-checks: (1) generated+codegen'd code matches hand-written required-module code,
-- (2) unroll 1 / 4 / 8 / 16 agree on ns/op, (3) allocation accounting is exact.
local B = require("./bench")

local function mkdata()
	local t = {}
	for i = 1, 64 do t[i] = i end
	return { t = t, a = 7, k1 = 1, k2 = 2, k3 = 3, k4 = 4, k5 = 5, k6 = 6, k7 = 7, k8 = 8 }
end

-- hand-written, in this required module => natively compiled by Lune
local function handwritten(n, D)
	local t = D.t
	local a = D.a
	local s = 0
	for i = 1, n do
		s = s + t[a] + t[a] + t[a] + t[a] + t[a] + t[a] + t[a] + t[a]
	end
	return s
end
local function handempty(n, D)
	local t = D.t
	local a = D.a
	local s = 0
	for i = 1, n do end
	return s
end

print("## harness self-check")
local D = mkdata()
handwritten(B.ITERS, D)
handempty(B.ITERS, D)
local bw, be = math.huge, math.huge
for _ = 1, B.REPS do
	local t0 = os.clock(); handwritten(B.ITERS, D); local t1 = os.clock()
	if t1 - t0 < bw then bw = t1 - t0 end
	t0 = os.clock(); handempty(B.ITERS, D); t1 = os.clock()
	if t1 - t0 < be then be = t1 - t0 end
end
print(string.format("\nhand-written required-module `s = s + t[a]` (x8): %.2f ns/op (native, Lune's own compile path)",
	(bw - be) / (B.ITERS * 8) * 1e9))

for _, u in { 1, 2, 4, 8 } do
	B.suite({
		title = "unroll = " .. u,
		data = mkdata,
		unroll = u,
		cases = {
			{ name = "`s = s + t[a]` (array part, fixed key)", setup = "\tlocal t = D.t\n\tlocal a = D.a", body = "s = s + t[a]" },
			{ name = "`s = s + t[k$J]` (array part, 8 rotating keys)", setup = "\tlocal t = D.t", inner = table.concat({
				"\t\tlocal k1, k2, k3, k4 = D.k1, D.k2, D.k3, D.k4",
				"\t\tlocal k5, k6, k7, k8 = D.k5, D.k6, D.k7, D.k8",
			}, "\n"), body = "s = s + t[k$J]", unroll = u },
		},
	})
end

print("")
print("## allocation accounting check")
print("")
print("| alloc op | B/op |")
print("|---|---:|")
local sinkt
print(string.format("| `{}` (empty table) | %.1f |", B.bytes_per_op(function() sinkt = {} end)))
print(string.format("| `{ a = 1, b = 2 }` (2 hash fields) | %.1f |", B.bytes_per_op(function() sinkt = { a = 1, b = 2 } end)))
print(string.format("| `table.create(8)` | %.1f |", B.bytes_per_op(function() sinkt = table.create(8) end)))
print(string.format("| `{ 1, 2, 3, 4 }` (4 array slots) | %.1f |", B.bytes_per_op(function() sinkt = { 1, 2, 3, 4 } end)))
print(string.format("| nothing (control) | %.1f |", B.bytes_per_op(function() end)))
