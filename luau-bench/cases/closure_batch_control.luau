--!optimize 2
-- closure_batch_control: the *control* for closure_batch. Identical design (shared tree, closures per
-- node, per-agent Struct-of-Maps state in upvalues, no node instance per agent) except that the tree is
-- walked recursively once per agent: tick(agent, dt) -> status, halt(agent).
-- The only difference against closure_batch is batching, so the delta isolates the batch idea.
-- (Used when cases/closure_single.luau is not available.)

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local function NOOP() end

local function make_leaf(spec)
	local on_tick = spec.on_tick
	local on_start, on_halt = spec.on_start, spec.on_halt
	if on_start == nil and on_halt == nil then
		return { tick = on_tick, halt = NOOP }
	end
	local run = {}
	return {
		tick = function(a, dt)
			if run[a] == nil then
				run[a] = true
				if on_start then on_start(a) end
			end
			local s = on_tick(a, dt)
			if s ~= RUNNING then run[a] = nil end
			return s
		end,
		halt = function(a)
			if run[a] ~= nil then
				run[a] = nil
				if on_halt then on_halt(a) end
			end
		end,
	}
end

local function make_wait(seconds)
	local time_left = {}
	return {
		tick = function(a, dt)
			local t = time_left[a]
			if t == nil then t = seconds end
			t -= dt
			if t <= 0 then
				time_left[a] = nil
				return SUCCESS
			end
			time_left[a] = t
			return RUNNING
		end,
		halt = function(a)
			if time_left[a] ~= nil then time_left[a] = nil end
		end,
	}
end

local function make_seqlike(children, cont)
	local nc = #children
	local ticks, halts = table.create(nc), table.create(nc)
	for i = 1, nc do
		ticks[i] = children[i].tick
		halts[i] = children[i].halt
	end
	local cursor = {}
	return {
		tick = function(a, dt)
			local c = cursor[a]
			if c == nil then c = 1 end
			for ci = c, nc do
				local s = ticks[ci](a, dt)
				if s ~= cont then
					if s == RUNNING then
						cursor[a] = ci
					elseif cursor[a] ~= nil then
						cursor[a] = nil
					end
					return s
				end
			end
			if cursor[a] ~= nil then cursor[a] = nil end
			return cont
		end,
		halt = function(a)
			local c = cursor[a]
			if c ~= nil then
				cursor[a] = nil
				halts[c](a)
			end
		end,
	}
end

local function make_reactive(children, cont)
	local nc = #children
	local ticks, halts = table.create(nc), table.create(nc)
	for i = 1, nc do
		ticks[i] = children[i].tick
		halts[i] = children[i].halt
	end
	local active = {}
	return {
		tick = function(a, dt)
			for ci = 1, nc do
				local s = ticks[ci](a, dt)
				if s ~= cont then
					local p = active[a]
					if p ~= nil and p > ci then halts[p](a) end
					if s == RUNNING then
						if p ~= ci then active[a] = ci end
					elseif p ~= nil then
						active[a] = nil
					end
					return s
				end
			end
			if active[a] ~= nil then active[a] = nil end
			return cont
		end,
		halt = function(a)
			local p = active[a]
			if p ~= nil then
				active[a] = nil
				halts[p](a)
			end
		end,
	}
end

local function make_parallel(children, succ_one, fail_one)
	local nc = #children
	local ticks, halts, bits = table.create(nc), table.create(nc), table.create(nc)
	for i = 1, nc do
		ticks[i] = children[i].tick
		halts[i] = children[i].halt
		bits[i] = bit32.lshift(1, i - 1)
	end
	local full = bit32.lshift(1, nc) - 1
	local band, bor, bxor = bit32.band, bit32.bor, bit32.bxor
	local done, succ = {}, {}

	local function finish(a, except)
		if done[a] ~= nil then
			done[a] = nil
			succ[a] = nil
		end
		for ci = 1, nc do
			if ci ~= except then halts[ci](a) end
		end
	end

	return {
		tick = function(a, dt)
			local d, sm = done[a], nil
			if d == nil then
				d, sm = 0, 0
			else
				sm = succ[a]
			end
			for ci = 1, nc do
				local bit = bits[ci]
				if band(d, bit) == 0 then
					local s = ticks[ci](a, dt)
					if s == SUCCESS then
						if succ_one then
							done[a] = d
							succ[a] = sm
							finish(a, ci)
							return SUCCESS
						end
						d = bor(d, bit)
						sm = bor(sm, bit)
					elseif s == FAILURE then
						if fail_one then
							done[a] = d
							succ[a] = sm
							finish(a, ci)
							return FAILURE
						end
						d = bor(d, bit)
					end
				end
			end
			if not succ_one and sm == full then
				if done[a] ~= nil then
					done[a] = nil
					succ[a] = nil
				end
				return SUCCESS
			end
			if not fail_one and bxor(d, sm) == full then
				if done[a] ~= nil then
					done[a] = nil
					succ[a] = nil
				end
				return FAILURE
			end
			done[a] = d
			succ[a] = sm
			return RUNNING
		end,
		halt = function(a)
			if done[a] ~= nil then
				done[a] = nil
				succ[a] = nil
				for ci = 1, nc do halts[ci](a) end
			end
		end,
	}
end

local function make_inverter(child)
	local ct = child.tick
	return {
		tick = function(a, dt)
			local s = ct(a, dt)
			if s == SUCCESS then return FAILURE elseif s == FAILURE then return SUCCESS end
			return s
		end,
		halt = child.halt,
	}
end

local function make_force(child, forced)
	local ct = child.tick
	return {
		tick = function(a, dt)
			local s = ct(a, dt)
			if s == RUNNING then return RUNNING end
			return forced
		end,
		halt = child.halt,
	}
end

local function make_repeat(child, count)
	local ct, ch = child.tick, child.halt
	local n_done = {}
	return {
		tick = function(a, dt)
			local s = ct(a, dt)
			if s == RUNNING then
				if n_done[a] == nil then n_done[a] = 0 end
				return RUNNING
			end
			local c = n_done[a]
			c = (c == nil and 0 or c) + 1
			if c >= count then
				if n_done[a] ~= nil then n_done[a] = nil end
				return SUCCESS
			end
			n_done[a] = c
			return RUNNING
		end,
		halt = function(a)
			if n_done[a] ~= nil then n_done[a] = nil end
			ch(a)
		end,
	}
end

local function make_timeout(child, seconds)
	local ct, ch = child.tick, child.halt
	local time_left = {}
	return {
		tick = function(a, dt)
			local t = time_left[a]
			if t == nil then t = seconds end
			t -= dt
			if t <= 0 then
				if time_left[a] ~= nil then time_left[a] = nil end
				ch(a)
				return FAILURE
			end
			time_left[a] = t
			local s = ct(a, dt)
			if s ~= RUNNING then time_left[a] = nil end
			return s
		end,
		halt = function(a)
			if time_left[a] ~= nil then time_left[a] = nil end
			ch(a)
		end,
	}
end

local function make_cooldown(child, seconds, clears)
	local ct, ch = child.tick, child.halt
	local time_left = {}
	clears[#clears + 1] = function(a)
		if time_left[a] ~= nil then time_left[a] = nil end
	end
	return {
		tick = function(a, dt)
			local t = time_left[a]
			if t ~= nil then
				t -= dt
				if t > 0 then
					time_left[a] = t
					return FAILURE
				end
				time_left[a] = nil
			end
			local s = ct(a, dt)
			if s ~= RUNNING then time_left[a] = seconds end
			return s
		end,
		halt = ch,
	}
end

local function build(spec, clears)
	local k = spec.kind
	if k == "Leaf" then
		return make_leaf(spec)
	elseif k == "Wait" then
		return make_wait(spec.seconds)
	elseif k == "Sequence" or k == "Fallback" or k == "ReactiveSequence" or k == "ReactiveFallback" then
		local src = spec.children
		local cs = table.create(#src)
		for i = 1, #src do cs[i] = build(src[i], clears) end
		local cont = (k == "Sequence" or k == "ReactiveSequence") and SUCCESS or FAILURE
		if k == "Sequence" or k == "Fallback" then return make_seqlike(cs, cont) end
		return make_reactive(cs, cont)
	elseif k == "Parallel" then
		local src = spec.children
		local cs = table.create(#src)
		for i = 1, #src do cs[i] = build(src[i], clears) end
		return make_parallel(cs, spec.success_policy == "ONE", spec.failure_policy == "ONE")
	elseif k == "Inverter" then
		return make_inverter(build(spec.child, clears))
	elseif k == "ForceSuccess" then
		return make_force(build(spec.child, clears), SUCCESS)
	elseif k == "ForceFailure" then
		return make_force(build(spec.child, clears), FAILURE)
	elseif k == "Repeat" then
		return make_repeat(build(spec.child, clears), spec.count)
	elseif k == "Timeout" then
		return make_timeout(build(spec.child, clears), spec.seconds)
	elseif k == "Cooldown" then
		return make_cooldown(build(spec.child, clears), spec.seconds, clears)
	end
	error("closure_batch_control: unknown kind " .. tostring(k))
end

return {
	name = "closure_batch_control",

	new_world = function(spec)
		local clears = {}
		local root = build(spec, clears)
		return {
			root_tick = root.tick,
			root_halt = root.halt,
			clears = clears,
			status = {},
			live = {},
			slot = {},
			n = 0,
		}
	end,

	add_agent = function(w, id)
		local n = w.n + 1
		w.n = n
		w.live[n] = id
		w.slot[id] = n
	end,

	remove_agent = function(w, id)
		w.root_halt(id)
		for _, clear in w.clears do clear(id) end
		local n, i = w.n, w.slot[id]
		local last = w.live[n]
		w.live[i] = last
		w.slot[last] = i
		w.live[n] = nil
		w.slot[id] = nil
		w.status[id] = nil
		w.n = n - 1
	end,

	tick = function(w, dt)
		local live, status, root_tick = w.live, w.status, w.root_tick
		for i = 1, w.n do
			local a = live[i]
			status[a] = root_tick(a, dt)
		end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
