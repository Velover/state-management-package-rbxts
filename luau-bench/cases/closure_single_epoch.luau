--!native
--!optimize 2
-- closure_single_epoch (variant b) -- same closure/SoM design, but halting is a sweep instead of an
-- explicit cascade.
--
--   * every haltable node stamps `stamp[agent] = NOW` whenever it is ticked, and appends its registry
--     index to the agent's reusable running-node list when it returns RUNNING;
--   * after the agent's root tick, the runner walks *last* tick's list: an entry whose stamp is stale
--     was not visited this tick, so it is halted. Halts are flat (each node only clears its own state)
--     because every running descendant is in the list too.
--
-- What this buys: no parent needs to know which child is running. ReactiveSequence / ReactiveFallback
-- become stateless, Timeout does not halt its child, Repeat does not track whether its child is running.
--
-- What it cannot do: preempt a sibling that has *already been ticked this tick*. That is exactly
-- Parallel with a ONE policy (child 3 fails after children 1-2 already returned RUNNING) -- those nodes
-- carry a fresh stamp, so the end-of-tick sweep will not touch them, and deferring to the next tick is
-- one tick late (the differential test catches it). The fix used here: the running-node list is in
-- depth-first order, so a node can record `base = CUR_N` on entry and halt exactly the entries pushed
-- during its own subtree tick. That is a cascade again, just expressed over the list.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING
local band, bor = bit32.band, bit32.bor

local NOW = 0 -- global agent-tick counter (shared upvalue of every node closure)
local CUR -- the running-node list being filled for the agent currently being ticked
local CUR_N = 0

local B_HALT, B_STAMP -- registry arrays under construction

local function register(halt, stamp)
	local k = #B_HALT + 1
	B_HALT[k] = halt
	B_STAMP[k] = stamp
	return k
end

local function split(children, maps)
	local n = #children
	local ct = table.create(n)
	for i = 1, n do
		local c = children[i]
		ct[i] = c.tick
		local cm = c.maps
		for j = 1, #cm do
			maps[#maps + 1] = cm[j]
		end
	end
	return n, ct
end

local function adopt(maps, child)
	local cm = child.maps
	for j = 1, #cm do
		maps[#maps + 1] = cm[j]
	end
	return child.tick
end

---------------------------------------------------------------------------------------------------

local function Sequence(children)
	local cursor, stamp = {}, {}
	local maps = { cursor, stamp }
	local n, ct = split(children, maps)
	local k = register(function(agent)
		cursor[agent] = nil
	end, stamp)
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local i = cursor[agent]
			local resumed = i ~= nil
			if not resumed then i = 1 end
			while i <= n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					cursor[agent] = i
					CUR_N += 1
					CUR[CUR_N] = k
					return RUNNING
				elseif s == FAILURE then
					if resumed then cursor[agent] = nil end
					return FAILURE
				end
				i += 1
			end
			if resumed then cursor[agent] = nil end
			return SUCCESS
		end,
		maps = maps,
	}
end

local function Fallback(children)
	local cursor, stamp = {}, {}
	local maps = { cursor, stamp }
	local n, ct = split(children, maps)
	local k = register(function(agent)
		cursor[agent] = nil
	end, stamp)
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local i = cursor[agent]
			local resumed = i ~= nil
			if not resumed then i = 1 end
			while i <= n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					cursor[agent] = i
					CUR_N += 1
					CUR[CUR_N] = k
					return RUNNING
				elseif s == SUCCESS then
					if resumed then cursor[agent] = nil end
					return SUCCESS
				end
				i += 1
			end
			if resumed then cursor[agent] = nil end
			return FAILURE
		end,
		maps = maps,
	}
end

-- Stateless: the child that stops being ticked is halted by the sweep.
local function ReactiveSequence(children)
	local maps = {}
	local n, ct = split(children, maps)
	return {
		tick = function(agent, dt)
			for i = 1, n do
				local s = ct[i](agent, dt)
				if s ~= SUCCESS then return s end
			end
			return SUCCESS
		end,
		maps = maps,
	}
end

local function ReactiveFallback(children)
	local maps = {}
	local n, ct = split(children, maps)
	return {
		tick = function(agent, dt)
			for i = 1, n do
				local s = ct[i](agent, dt)
				if s ~= FAILURE then return s end
			end
			return FAILURE
		end,
		maps = maps,
	}
end

local function Parallel(success_all, failure_all, children)
	local done, succ, stamp = {}, {}, {}
	local maps = { done, succ, stamp }
	local n, ct = split(children, maps)
	local k = register(function(agent)
		done[agent] = nil
	end, stamp)
	local HALTS = B_HALT
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local base = CUR_N
			local dm = done[agent]
			local resumed = dm ~= nil
			local sm
			if resumed then
				sm = succ[agent]
			else
				dm, sm = 0, 0
			end
			local ns, nf = 0, 0
			local bit = 1
			for i = 1, n do
				if band(dm, bit) ~= 0 then
					if band(sm, bit) ~= 0 then ns += 1 else nf += 1 end
				else
					local s = ct[i](agent, dt)
					if s ~= RUNNING then
						dm = bor(dm, bit)
						if s == SUCCESS then
							ns += 1
							sm = bor(sm, bit)
							if not success_all then
								for j = base + 1, CUR_N do HALTS[CUR[j]](agent) end
								CUR_N = base
								if resumed then done[agent] = nil end
								return SUCCESS
							end
						else
							nf += 1
							if not failure_all then
								for j = base + 1, CUR_N do HALTS[CUR[j]](agent) end
								CUR_N = base
								if resumed then done[agent] = nil end
								return FAILURE
							end
						end
					end
				end
				bit += bit
			end
			if success_all and ns == n then
				if resumed then done[agent] = nil end
				return SUCCESS
			end
			if failure_all and nf == n then
				if resumed then done[agent] = nil end
				return FAILURE
			end
			done[agent], succ[agent] = dm, sm
			CUR_N += 1
			CUR[CUR_N] = k
			return RUNNING
		end,
		maps = maps,
	}
end

---------------------------------------------------------------------------------------------------

local function Inverter(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			local s = ct(agent, dt)
			if s == SUCCESS then return FAILURE elseif s == FAILURE then return SUCCESS end
			return RUNNING
		end,
		maps = child.maps,
	}
end

local function ForceSuccess(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			if ct(agent, dt) == RUNNING then return RUNNING end
			return SUCCESS
		end,
		maps = child.maps,
	}
end

local function ForceFailure(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			if ct(agent, dt) == RUNNING then return RUNNING end
			return FAILURE
		end,
		maps = child.maps,
	}
end

local function Repeat(count, child)
	local cnt, stamp = {}, {}
	local maps = { cnt, stamp }
	local ct = adopt(maps, child)
	local k = register(function(agent)
		cnt[agent] = nil
	end, stamp)
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local c = cnt[agent]
			local resumed = c ~= nil
			if not resumed then c = 0 end
			local s = ct(agent, dt)
			if s ~= RUNNING then
				c += 1
				if c >= count then
					if resumed then cnt[agent] = nil end
					return SUCCESS
				end
			end
			cnt[agent] = c
			CUR_N += 1
			CUR[CUR_N] = k
			return RUNNING
		end,
		maps = maps,
	}
end

local function Wait(seconds)
	local tl, stamp = {}, {}
	local maps = { tl, stamp }
	local k = register(function(agent)
		tl[agent] = nil
	end, stamp)
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local t = tl[agent]
			if t == nil then
				t = seconds - dt
				if t <= 0 then return SUCCESS end
			else
				t -= dt
				if t <= 0 then
					tl[agent] = nil
					return SUCCESS
				end
			end
			tl[agent] = t
			CUR_N += 1
			CUR[CUR_N] = k
			return RUNNING
		end,
		maps = maps,
	}
end

-- No explicit child halt on expiry: the child is simply not ticked, so the sweep gets it.
local function Timeout(seconds, child)
	local tl, stamp = {}, {}
	local maps = { tl, stamp }
	local ct = adopt(maps, child)
	local k = register(function(agent)
		tl[agent] = nil
	end, stamp)
	return {
		tick = function(agent, dt)
			stamp[agent] = NOW
			local t = tl[agent]
			local resumed = t ~= nil
			if resumed then t -= dt else t = seconds - dt end
			if t <= 0 then
				if resumed then tl[agent] = nil end
				return FAILURE
			end
			tl[agent] = t
			local s = ct(agent, dt)
			if s == RUNNING then
				CUR_N += 1
				CUR[CUR_N] = k
				return RUNNING
			end
			tl[agent] = nil
			return s
		end,
		maps = maps,
	}
end

-- Cooldown has nothing to undo on halt (its timer persists), so it is not registered at all.
local function Cooldown(seconds, child)
	local tl = {}
	local maps = { tl }
	local ct = adopt(maps, child)
	return {
		tick = function(agent, dt)
			local t = tl[agent]
			if t == nil then t = -dt else t -= dt end
			if t > 0 then
				tl[agent] = t
				return FAILURE
			end
			local s = ct(agent, dt)
			if s == RUNNING then
				tl[agent] = t
				return RUNNING
			end
			tl[agent] = seconds
			return s
		end,
		maps = maps,
	}
end

local function Leaf(cfg)
	local on_start, on_tick, on_halt = cfg.on_start, cfg.on_tick, cfg.on_halt
	if on_start == nil and on_halt == nil then
		return { tick = on_tick, maps = {} }
	end
	local started, stamp = {}, {}
	local k
	if on_halt == nil then
		k = register(function(agent)
			started[agent] = nil
		end, stamp)
	else
		k = register(function(agent)
			started[agent] = nil
			on_halt(agent)
		end, stamp)
	end
	local tick
	if on_start == nil then
		tick = function(agent, dt)
			stamp[agent] = NOW
			local s = on_tick(agent, dt)
			if s == RUNNING then
				started[agent] = true
				CUR_N += 1
				CUR[CUR_N] = k
			elseif started[agent] ~= nil then
				started[agent] = nil
			end
			return s
		end
	else
		tick = function(agent, dt)
			stamp[agent] = NOW
			if started[agent] == nil then
				started[agent] = true
				on_start(agent)
			end
			local s = on_tick(agent, dt)
			if s == RUNNING then
				CUR_N += 1
				CUR[CUR_N] = k
			else
				started[agent] = nil
			end
			return s
		end
	end
	return { tick = tick, maps = { started, stamp } }
end

---------------------------------------------------------------------------------------------------

local build
local function build_all(list)
	local out = table.create(#list)
	for i = 1, #list do
		out[i] = build(list[i])
	end
	return out
end

function build(spec)
	local k = spec.kind
	if k == "Leaf" then return Leaf(spec) end
	if k == "Sequence" then return Sequence(build_all(spec.children)) end
	if k == "Fallback" then return Fallback(build_all(spec.children)) end
	if k == "ReactiveSequence" then return ReactiveSequence(build_all(spec.children)) end
	if k == "ReactiveFallback" then return ReactiveFallback(build_all(spec.children)) end
	if k == "Parallel" then
		return Parallel(spec.success_policy == "ALL", spec.failure_policy == "ALL", build_all(spec.children))
	end
	if k == "Inverter" then return Inverter(build(spec.child)) end
	if k == "ForceSuccess" then return ForceSuccess(build(spec.child)) end
	if k == "ForceFailure" then return ForceFailure(build(spec.child)) end
	if k == "Repeat" then return Repeat(spec.count, build(spec.child)) end
	if k == "Wait" then return Wait(spec.seconds) end
	if k == "Timeout" then return Timeout(spec.seconds, build(spec.child)) end
	if k == "Cooldown" then return Cooldown(spec.seconds, build(spec.child)) end
	error("closure_single_epoch: unknown kind " .. tostring(k))
end

return {
	name = "closure_single_epoch",

	new_world = function(spec)
		B_HALT, B_STAMP = {}, {}
		local root = build(spec)
		return {
			root_tick = root.tick,
			maps = root.maps,
			halts = B_HALT,
			stamps = B_STAMP,
			status = {},
			order = {},
			lists = {}, -- per agent: nodes running at the end of the previous tick
			lens = {},
			spare = {}, -- per agent: the buffer being filled this tick
		}
	end,

	add_agent = function(w, id)
		w.order[#w.order + 1] = id
		w.lists[id] = {}
		w.spare[id] = {}
		w.lens[id] = 0
	end,

	remove_agent = function(w, id)
		local prev, pn, halts = w.lists[id], w.lens[id], w.halts
		for i = 1, pn do
			halts[prev[i]](id)
		end
		w.status[id] = nil
		w.lists[id] = nil
		w.spare[id] = nil
		w.lens[id] = nil
		local maps = w.maps
		for i = 1, #maps do
			maps[i][id] = nil
		end
		local i = table.find(w.order, id)
		if i then table.remove(w.order, i) end
	end,

	tick = function(w, dt)
		local root_tick, status = w.root_tick, w.status
		local lists, spare, lens = w.lists, w.spare, w.lens
		local halts, stamps = w.halts, w.stamps
		for _, id in w.order do
			NOW += 1
			CUR = spare[id]
			CUR_N = 0
			status[id] = root_tick(id, dt)
			local prev, pn = lists[id], lens[id]
			for i = 1, pn do
				local k = prev[i]
				if stamps[k][id] ~= NOW then halts[k](id) end
			end
			lists[id] = CUR
			lens[id] = CUR_N
			spare[id] = prev
		end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
