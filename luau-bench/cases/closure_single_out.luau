--!native
--!optimize 2
-- closure_single_out (variant d) -- same design as closure_single, but a node's tick returns nothing
-- and writes its result into a shared `RES[agent]` slot that the parent reads after the call.
--
-- Consequence: a node whose result *is* its child's result (Sequence returning FAILURE, Fallback
-- returning SUCCESS, Timeout, Cooldown while off cooldown) never writes at all -- the slot already
-- holds the right value. The price is that every leaf now needs a wrapper closure to move the user's
-- returned status into the slot, so the "condition leaf == the user's on_tick" trick is lost.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING
local band, bor = bit32.band, bit32.bor

local RES = {} -- shared result slot, one entry per agent

local function NOOP() end

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
				ct[i](agent, dt)
				local s = RES[agent]
				if s == RUNNING then
					cursor[agent] = i
					return
				elseif s == FAILURE then
					if resumed then cursor[agent] = nil end
					return -- slot already holds FAILURE
				end
				i += 1
			end
			if resumed then cursor[agent] = nil end
			RES[agent] = SUCCESS
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
				ct[i](agent, dt)
				local s = RES[agent]
				if s == RUNNING then
					cursor[agent] = i
					return
				elseif s == SUCCESS then
					if resumed then cursor[agent] = nil end
					return
				end
				i += 1
			end
			if resumed then cursor[agent] = nil end
			RES[agent] = FAILURE
		end,
		halt = function(agent)
			local i = cursor[agent]
			cursor[agent] = nil
			ch[i](agent)
		end,
		maps = maps,
	}
end

local function ReactiveSequence(children)
	local rc = {}
	local maps = { rc }
	local n, ct, ch = split(children, maps)
	return {
		tick = function(agent, dt)
			local r0 = rc[agent]
			local r = r0
			for i = 1, n do
				ct[i](agent, dt)
				local s = RES[agent]
				if s == RUNNING then
					if r ~= nil and r ~= i then ch[r](agent) end
					rc[agent] = i
					return
				elseif s == FAILURE then
					if r ~= nil and r ~= i then ch[r](agent) end
					if r0 ~= nil then rc[agent] = nil end
					return
				elseif r == i then
					r = nil
				end
			end
			if r0 ~= nil then rc[agent] = nil end
			RES[agent] = SUCCESS
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
				ct[i](agent, dt)
				local s = RES[agent]
				if s == RUNNING then
					if r ~= nil and r ~= i then ch[r](agent) end
					rc[agent] = i
					return
				elseif s == SUCCESS then
					if r ~= nil and r ~= i then ch[r](agent) end
					if r0 ~= nil then rc[agent] = nil end
					return
				elseif r == i then
					r = nil
				end
			end
			if r0 ~= nil then rc[agent] = nil end
			RES[agent] = FAILURE
		end,
		halt = function(agent)
			local r = rc[agent]
			rc[agent] = nil
			ch[r](agent)
		end,
		maps = maps,
	}
end

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
					ct[i](agent, dt)
					local s = RES[agent]
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
								return
							end
						else
							nf += 1
							if not failure_all then
								halt_running(agent, rm, dm)
								if resumed then done[agent] = nil end
								return
							end
						end
					end
				end
				bit += bit
			end
			if success_all and ns == n then
				if resumed then done[agent] = nil end
				RES[agent] = SUCCESS
				return
			end
			if failure_all and nf == n then
				if resumed then done[agent] = nil end
				RES[agent] = FAILURE
				return
			end
			done[agent], run[agent], succ[agent] = dm, rm, sm
			RES[agent] = RUNNING
		end,
		halt = function(agent)
			halt_running(agent, run[agent], done[agent])
			done[agent] = nil
		end,
		maps = maps,
	}
end

local function Inverter(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			ct(agent, dt)
			local s = RES[agent]
			if s == SUCCESS then RES[agent] = FAILURE elseif s == FAILURE then RES[agent] = SUCCESS end
		end,
		halt = child.halt,
		maps = child.maps,
	}
end

local function ForceSuccess(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			ct(agent, dt)
			if RES[agent] ~= RUNNING then RES[agent] = SUCCESS end
		end,
		halt = child.halt,
		maps = child.maps,
	}
end

local function ForceFailure(child)
	local ct = child.tick
	return {
		tick = function(agent, dt)
			ct(agent, dt)
			if RES[agent] ~= RUNNING then RES[agent] = FAILURE end
		end,
		halt = child.halt,
		maps = child.maps,
	}
end

local function Repeat(count, child)
	local cnt = {}
	local maps = { cnt }
	local ct, chh = adopt(maps, child)
	return {
		tick = function(agent, dt)
			local c = cnt[agent]
			local resumed = c ~= nil
			if not resumed then c = 0 elseif c < 0 then c = -c - 1 end
			ct(agent, dt)
			if RES[agent] == RUNNING then
				cnt[agent] = -c - 1
				return
			end
			c += 1
			if c >= count then
				if resumed then cnt[agent] = nil end
				RES[agent] = SUCCESS
				return
			end
			cnt[agent] = c
			RES[agent] = RUNNING
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
				if t <= 0 then
					RES[agent] = SUCCESS
					return
				end
			else
				t -= dt
				if t <= 0 then
					tl[agent] = nil
					RES[agent] = SUCCESS
					return
				end
			end
			tl[agent] = t
			RES[agent] = RUNNING
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
				RES[agent] = FAILURE
				return
			end
			tl[agent] = t
			ct(agent, dt)
			if RES[agent] ~= RUNNING then tl[agent] = nil end
		end,
		halt = function(agent)
			tl[agent] = nil
			chh(agent)
		end,
		maps = maps,
	}
end

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
				RES[agent] = FAILURE
				return
			end
			ct(agent, dt)
			if RES[agent] == RUNNING then
				tl[agent] = t
				return
			end
			tl[agent] = seconds
		end,
		halt = chh,
		maps = maps,
	}
end

local function Leaf(cfg)
	local on_start, on_tick, on_halt = cfg.on_start, cfg.on_tick, cfg.on_halt
	if on_start == nil then
		-- Still needs a wrapper: the user's on_tick returns, the protocol writes.
		return {
			tick = function(agent, dt)
				RES[agent] = on_tick(agent, dt)
			end,
			halt = on_halt or NOOP,
			maps = {},
		}
	end
	local started = {}
	local tick = function(agent, dt)
		if started[agent] == nil then
			started[agent] = true
			on_start(agent)
		end
		local s = on_tick(agent, dt)
		if s ~= RUNNING then started[agent] = nil end
		RES[agent] = s
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
	error("closure_single_out: unknown kind " .. tostring(k))
end

return {
	name = "closure_single_out",

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
		RES[id] = nil
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
			root_tick(id, dt)
			status[id] = RES[id]
		end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
