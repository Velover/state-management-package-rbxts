--!optimize 2
-- (c) Optional hooks: what an ABSENT `on_start` / `on_halt` actually costs.
local B = require("./bench")

local function mkdata()
	local D = { agent = 1, S = 2 }
	D.leaf_full = { on_start = function(a) return a end, on_tick = function(a) return a end,
		on_halt = function(a) return a end }
	D.leaf_bare = { on_tick = function(a) return a end }
	-- a realistic leaf: several present keys, `on_start` simply absent
	D.leaf_rich = { kind = 1, name = "attack", child = false, on_tick = function(a) return a end,
		on_halt = function(a) return a end }
	return D
end

return function()
	B.header("(c) Optional hooks")

	B.suite({
		title = "(c1) Guarding a hook that lives in a local/upvalue",
		note = "`fn` is a cached local holding either the hook or `nil`; `agent` is a local. The floor row is\n"
			.. "the same loop with the hook call removed entirely.",
		data = mkdata,
		cases = {
			{ name = "`s = s + 1` — no hook site at all (floor)", setup = "", body = "s = s + 1" },
			{ name = "`if fn then fn(agent) end` — fn is **nil**",
				setup = "\tlocal fn = nil\n\tlocal agent = D.agent", body = "if fn then fn(agent) end s = s + 1" },
			{ name = "`if fn then fn(agent) end` — fn is **present**",
				setup = "\tlocal fn = function(a) return a end\n\tlocal agent = D.agent", body = "if fn then fn(agent) end s = s + 1" },
			{ name = "`if fn ~= nil then fn(agent) end` — fn is **nil**",
				setup = "\tlocal fn = nil\n\tlocal agent = D.agent", body = "if fn ~= nil then fn(agent) end s = s + 1" },
			{ name = "`noop(agent)` — always call a pre-bound no-op `function(a) end`",
				setup = "\tlocal noop = function(a) end\n\tlocal agent = D.agent", body = "noop(agent) s = s + 1" },
			{ name = "`if fn then fn(agent) end` — fn is **nil**, fn is an UPVALUE",
				setup = "\tlocal fn = nil", inner = "\t\tlocal agent = D.agent", body = "if fn then fn(agent) end s = s + 1", wrap = true },
			{ name = "`if fn then fn(agent) end` — fn is **present**, fn is an UPVALUE",
				setup = "\tlocal fn = function(a) return a end", inner = "\t\tlocal agent = D.agent",
				body = "if fn then fn(agent) end s = s + 1", wrap = true },
		},
	})

	B.suite({
		title = "(c2) Reading the hook out of the node table first",
		note = "`leaf` is a plain table. `leaf_bare` simply has no `on_start` key, so the read returns nil.",
		data = mkdata,
		cases = {
			{ name = "`local f = leaf.on_start if f then f(agent) end` — key **absent**",
				setup = "\tlocal leaf = D.leaf_bare\n\tlocal agent = D.agent",
				body = "local f = leaf.on_start if f then f(agent) end s = s + 1" },
			{ name = "`local f = leaf.on_start if f then f(agent) end` — key **present**",
				setup = "\tlocal leaf = D.leaf_full\n\tlocal agent = D.agent",
				body = "local f = leaf.on_start if f then f(agent) end s = s + 1" },
			{ name = "`if leaf.on_start then leaf.on_start(agent) end` — key **absent** (1 read)",
				setup = "\tlocal leaf = D.leaf_bare\n\tlocal agent = D.agent",
				body = "if leaf.on_start then leaf.on_start(agent) end s = s + 1" },
			{ name = "`if leaf.on_start then leaf.on_start(agent) end` — key **present** (2 reads)",
				setup = "\tlocal leaf = D.leaf_full\n\tlocal agent = D.agent",
				body = "if leaf.on_start then leaf.on_start(agent) end s = s + 1" },
			{ name = "`local f = leaf.on_start` only, no call, key **absent** (the read alone)",
				setup = "\tlocal leaf = D.leaf_bare", body = "local f = leaf.on_start s = s + 1" },
			{ name = "`local f = leaf.on_start` only, no call, key **present** (the read alone)",
				setup = "\tlocal leaf = D.leaf_full", body = "local f = leaf.on_start s = s + 1" },
			{ name = "`local f = leaf.on_start ...` — key absent on a 5-key leaf (realistic node table)",
				setup = "\tlocal leaf = D.leaf_rich\n\tlocal agent = D.agent",
				body = "local f = leaf.on_start if f then f(agent) end s = s + 1" },
			{ name = "`leaf.on_start(agent)` unguarded — key **present** (what you pay with a required hook)",
				setup = "\tlocal leaf = D.leaf_full\n\tlocal agent = D.agent",
				body = "leaf.on_start(agent) s = s + 1" },
		},
	})

	B.suite({
		title = "(c3) Five hooks per node per tick, the baseline's shape",
		note = "`start` / `tick` / `halt` / `activated` / `inactive`-style: five optional hook sites in a row.\n"
			.. "This is the per-node-per-tick cost of the hook protocol alone, with no node work.",
		data = mkdata,
		cases = {
			{ name = "5 sites, all guarded, all **nil** (`if h1 then h1(a) end` x5)",
				setup = "\tlocal h1, h2, h3, h4, h5 = nil, nil, nil, nil, nil\n\tlocal a = D.agent",
				body = "if h1 then h1(a) end if h2 then h2(a) end if h3 then h3(a) end if h4 then h4(a) end if h5 then h5(a) end s = s + 1" },
			{ name = "5 sites, all guarded, all **present**",
				setup = "\tlocal f = function(x) return x end\n\tlocal h1, h2, h3, h4, h5 = f, f, f, f, f\n\tlocal a = D.agent",
				body = "if h1 then h1(a) end if h2 then h2(a) end if h3 then h3(a) end if h4 then h4(a) end if h5 then h5(a) end s = s + 1" },
			{ name = "5 sites, unguarded pre-bound no-ops (`h1(a)` x5)",
				setup = "\tlocal f = function(x) end\n\tlocal h1, h2, h3, h4, h5 = f, f, f, f, f\n\tlocal a = D.agent",
				body = "h1(a) h2(a) h3(a) h4(a) h5(a) s = s + 1" },
			{ name = "5 sites read from the node table, all **absent**",
				setup = "\tlocal leaf = D.leaf_bare\n\tlocal a = D.agent",
				body = "local f1 = leaf.on_start if f1 then f1(a) end local f2 = leaf.on_halt if f2 then f2(a) end "
					.. "local f3 = leaf.on_act if f3 then f3(a) end local f4 = leaf.on_inact if f4 then f4(a) end "
					.. "local f5 = leaf.on_reset if f5 then f5(a) end s = s + 1" },
		},
	})
end
