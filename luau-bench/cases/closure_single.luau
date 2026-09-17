--!native
--!optimize 2
-- closure_single -- closure factories, Struct-of-Maps per-agent state in upvalues, explicit halt cascade.
--
-- A node is a build-time table `{ tick = f(agent, dt) -> status, halt = f(agent), maps = {...} }`.
-- Only `tick` and `halt` exist at run time: composites copy their children's closures into parallel
-- arrays (`ct[i]`, `ch[i]`) at build time, so ticking a child is an array read plus a call -- no field
-- lookup, no method dispatch, no `self`.
--
-- Per-agent state is Struct-of-Maps held in upvalues: `cursor[agent]`, `time_left[agent]`. A missing
-- key means "idle for this agent", so an agent that never reaches a node costs nothing there.
-- `maps` is the build-time list of those tables, used by remove_agent to free an agent's state.
--
-- Halting is an explicit cascade: every parent knows which child is running for an agent and halts
-- exactly that one. A node's `halt` may assume the node is running for that agent.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING
local band, bor = bit32.band, bit32.bor

local function NOOP() end

-- Build-time: children -> (count, tick array, halt array), accumulating their state maps.
local function split(children, maps)
	local n = #children
	local ct, ch = table.create(n), table.create(n)
	for i = 1, n do
		local c = children[i]
		ct[i], ch[i] = c.tick, c.halt
		local cm = c.maps
		for j = 1, #cm do
			maps[#maps + 1] = cm[j]
		end
	end
	return n, ct, ch
end

local function adopt(maps, child)
	local cm = child.maps
	for j = 1, #cm do
		maps[#maps + 1] = cm[j]
	end
	return child.tick, child.halt
end

---------------------------------------------------------------------------------------------------
-- Composites
---------------------------------------------------------------------------------------------------

local function Sequence(children)
	local cursor = {}
	local maps = { cursor }
	local n, ct, ch = split(children, maps)
	return {
		tick = function(agent, dt)
			local i = cursor[agent]
			local resumed = i ~= nil
			if not resumed then i = 1 end
			while i <= n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					cursor[agent] = i
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
		halt = function(agent)
			local i = cursor[agent]
			cursor[agent] = nil
			ch[i](agent)
		end,
		maps = maps,
	}
end

local function Fallback(children)
	local cursor = {}
	local maps = { cursor }
	local n, ct, ch = split(children, maps)
	return {
		tick = function(agent, dt)
			local i = cursor[agent]
			local resumed = i ~= nil
			if not resumed then i = 1 end
			while i <= n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					cursor[agent] = i
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
		halt = function(agent)
			local i = cursor[agent]
			cursor[agent] = nil
			ch[i](agent)
		end,
		maps = maps,
	}
end

-- Reactive composites restart at child 1 every tick and keep at most one running child, whose index
-- is `rc[agent]`.
local function ReactiveSequence(children)
	local rc = {}
	local maps = { rc }
	local n, ct, ch = split(children, maps)
	return {
		tick = function(agent, dt)
			local r0 = rc[agent]
			local r = r0
			for i = 1, n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					if r ~= nil and r ~= i then ch[r](agent) end
					rc[agent] = i
					return RUNNING
				elseif s == FAILURE then
					if r ~= nil and r ~= i then ch[r](agent) end
					if r0 ~= nil then rc[agent] = nil end
					return FAILURE
				elseif r == i then
					r = nil
				end
			end
			if r0 ~= nil then rc[agent] = nil end
			return SUCCESS
		end,
		halt = function(agent)
			local r = rc[agent]
			rc[agent] = nil
			ch[r](agent)
		end,
		maps = maps,
	}
end

local function ReactiveFallback(children)
	local rc = {}
	local maps = { rc }
	local n, ct, ch = split(children, maps)
	return {
		tick = function(agent, dt)
			local r0 = rc[agent]
			local r = r0
			for i = 1, n do
				local s = ct[i](agent, dt)
				if s == RUNNING then
					if r ~= nil and r ~= i then ch[r](agent) end
					rc[agent] = i
					return RUNNING
				elseif s == SUCCESS then
					if r ~= nil and r ~= i then ch[r](agent) end
					if r0 ~= nil then rc[agent] = nil end
					return SUCCESS
				elseif r == i then
					r = nil
				end
			end
			if r0 ~= nil then rc[agent] = nil end
			return FAILURE
		end,
		halt = function(agent)
			local r = rc[agent]
			rc[agent] = nil
			ch[r](agent)
		end,
		maps = maps,
	}
end

-- Parallel keeps three per-agent bitmasks instead of a per-agent set: which children have completed,
-- which of those succeeded, and which are running. `done[agent] == nil` means idle.
local function Parallel(success_all, failure_all, children)
	local done, run, succ = {}, {}, {}
	local maps = { done, run, succ }
	local n, ct, ch = split(children, maps)
	local function halt_running(agent, rm, dm)
		local bit = 1
		for i = 1, n do
			if band(rm, bit) ~= 0 and band(dm, bit) == 0 then ch[i](agent) end
			bit += bit
		end
	end
	return {
		tick = function(agent, dt)
			local dm = done[agent]
			local resumed = dm ~= nil
			local rm, sm
			if resumed then
				rm, sm = run[agent], succ[agent]
			else
				dm, rm, sm = 0, 0, 0
			end
			local ns, nf = 0, 0
			local bit = 1
			for i = 1, n do
				if band(dm, bit) ~= 0 then
					if band(sm, bit) ~= 0 then ns += 1 else nf += 1 end
				else
					local s = ct[i](agent, dt)
					if s == RUNNING then
						rm = bor(rm, bit)
					else
						dm = bor(dm, bit)
						if s == SUCCESS then
							ns += 1
							sm = bor(sm, bit)
							if not success_all then
								halt_running(agent, rm, dm)
								if resumed then done[agent] = nil end
								return SUCCESS
							end
						else
							nf += 1
							if not failure_all then
								halt_running(agent, rm, dm)
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
			done[agent], run[agent], succ[agent] = dm, rm, sm
			return RUNNING
		end,
		halt = function(agent)
			halt_running(agent, run[agent], done[agent])
			done[agent] = nil
		end,
		maps = maps,
	}
end

---------------------------------------------------------------------------------------------------
-- Decorators
---------------------------------------------------------------------------------------------------

-- Inverter / ForceSuccess / ForceFailure hold no per-agent state at all: they are running exactly when
-- their child is, so their `halt` *is* the child's `halt`.
local function Inverter(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			local s = ct(agent, dt)
			if s == SUCCESS then return FAILURE elseif s == FAILURE then return SUCCESS end
			return RUNNING
		end,
		halt = child.halt,
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
		halt = child.halt,
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
		halt = child.halt,
		maps = child.maps,
	}
end

-- cnt[agent]: nil = idle, c >= 0 = running with an idle child, -(c + 1) = running with a running child.
local function Repeat(count, child)
	local cnt = {}
	local maps = { cnt }
	local ct, chh = adopt(maps, child)
	return {
		tick = function(agent, dt)
			local c = cnt[agent]
			local resumed = c ~= nil
			if not resumed then c = 0 elseif c < 0 then c = -c - 1 end
			local s = ct(agent, dt)
			if s == RUNNING then
				cnt[agent] = -c - 1
				return RUNNING
			end
			c += 1
			if c >= count then
				if resumed then cnt[agent] = nil end
				return SUCCESS
			end
			cnt[agent] = c
			return RUNNING
		end,
		halt = function(agent)
			local c = cnt[agent]
			cnt[agent] = nil
			if c < 0 then chh(agent) end
		end,
		maps = maps,
	}
end

local function Wait(seconds)
	local tl = {}
	return {
		tick = function(agent, dt)
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
			return RUNNING
		end,
		halt = function(agent)
			tl[agent] = nil
		end,
		maps = { tl },
	}
end

local function Timeout(seconds, child)
	local tl = {}
	local maps = { tl }
	local ct, chh = adopt(maps, child)
	return {
		tick = function(agent, dt)
			local t = tl[agent]
			local resumed = t ~= nil
			if resumed then t -= dt else t = seconds - dt end
			if t <= 0 then
				if resumed then
					tl[agent] = nil
					chh(agent)
				end
				return FAILURE
			end
			tl[agent] = t
			local s = ct(agent, dt)
			if s ~= RUNNING then tl[agent] = nil end
			return s
		end,
		halt = function(agent)
			tl[agent] = nil
			chh(agent)
		end,
		maps = maps,
	}
end

-- Cooldown's timer persists across runs (and across halts), so its map holds a value for every agent
-- that ever reached it; it never needs a nil write.
local function Cooldown(seconds, child)
	local tl = {}
	local maps = { tl }
	local ct, chh = adopt(maps, child)
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
		halt = chh,
		maps = maps,
	}
end

---------------------------------------------------------------------------------------------------
-- Leaf: specialised at build time, so absent hooks cost nothing at run time.
---------------------------------------------------------------------------------------------------

local function Leaf(cfg)
	local on_start, on_tick, on_halt = cfg.on_start, cfg.on_tick, cfg.on_halt
	if on_start == nil then
		-- No start hook => no per-agent state at all; the node *is* the user's on_tick.
		return { tick = on_tick, halt = on_halt or NOOP, maps = {} }
	end
	local started = {}
	local tick = function(agent, dt)
		if started[agent] == nil then
			started[agent] = true
			on_start(agent)
		end
		local s = on_tick(agent, dt)
		if s ~= RUNNING then started[agent] = nil end
		return s
	end
	local halt
	if on_halt == nil then
		halt = function(agent)
			started[agent] = nil
		end
	else
		halt = function(agent)
			started[agent] = nil
			on_halt(agent)
		end
	end
	return { tick = tick, halt = halt, maps = { started } }
end

---------------------------------------------------------------------------------------------------
-- Spec -> tree
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
	error("closure_single: unknown kind " .. tostring(k))
end

---------------------------------------------------------------------------------------------------
-- Adapter
---------------------------------------------------------------------------------------------------

return {
	name = "closure_single",

	new_world = function(spec)
		local root = build(spec)
		return {
			root_tick = root.tick,
			root_halt = root.halt,
			maps = root.maps,
			status = {},
			order = {},
		}
	end,

	add_agent = function(w, id)
		w.order[#w.order + 1] = id
	end,

	remove_agent = function(w, id)
		if w.status[id] == RUNNING then w.root_halt(id) end
		w.status[id] = nil
		local maps = w.maps
		for i = 1, #maps do
			maps[i][id] = nil
		end
		local i = table.find(w.order, id)
		if i then table.remove(w.order, i) end
	end,

	tick = function(w, dt)
		local root_tick, status = w.root_tick, w.status
		for _, id in w.order do
			status[id] = root_tick(id, dt)
		end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
