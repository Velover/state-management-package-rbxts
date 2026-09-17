--!optimize 2
-- flat_batch_control: the control for flat_batch. Identical flat node arrays, identical Struct-of-Maps
-- per-agent state, identical handler-per-kind dispatch (tick1[node](node, agent, dt)) -- but the
-- traversal is per agent and returns a status instead of walking a batch and writing status[agent].
-- The delta against flat_batch is exactly what batching buys; the delta against baseline is what the
-- flat shared-tree layout buys on its own.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local band, bor = bit32.band, bit32.bor

local function new_world(spec)
	local tick1, halt1 = {}, {}
	local st = {}
	local kids, nc, k1 = {}, {}, {}
	local param = {}
	local cdt = {}
	local psc, pfc, pso, pfo, psa, pfa = {}, {}, {}, {}, {}, {}
	local lstart, ltick, lhalt = {}, {}, {}
	local status = {}
	local purge = {}

	---------------------------------------------------------------------------------------------
	-- halt
	---------------------------------------------------------------------------------------------
	local function halt_none() end

	local function halt_leaf(i, a)
		local s = st[i]
		if s[a] ~= nil then
			s[a] = nil
			lhalt[i](a)
		end
	end

	local function halt_state(i, a)
		st[i][a] = nil
	end

	local function halt_cursor(i, a)
		local s = st[i]
		local c = s[a]
		if c ~= nil then
			s[a] = nil
			local ch = kids[i][c]
			halt1[ch](ch, a)
		end
	end

	local function halt_multi(i, a)
		local s = st[i]
		if s[a] ~= nil then
			s[a] = nil
			local kd = kids[i]
			for x = 1, nc[i] do
				local ch = kd[x]
				halt1[ch](ch, a)
			end
		end
	end

	local function halt_pass(i, a)
		local ch = k1[i]
		halt1[ch](ch, a)
	end

	local function halt_one(i, a)
		local s = st[i]
		if s[a] ~= nil then
			s[a] = nil
			local ch = k1[i]
			halt1[ch](ch, a)
		end
	end

	---------------------------------------------------------------------------------------------
	-- tick
	---------------------------------------------------------------------------------------------
	local function t_leaf_pure(i, a, dt)
		return ltick[i](a, dt)
	end

	local function t_leaf_full(i, a, dt)
		local s = st[i]
		if s[a] == nil then
			s[a] = true
			lstart[i](a)
		end
		local r = ltick[i](a, dt)
		if r ~= RUNNING then s[a] = nil end
		return r
	end

	local function t_leaf_halt(i, a, dt)
		local s = st[i]
		local r = ltick[i](a, dt)
		if r ~= RUNNING then s[a] = nil else s[a] = true end
		return r
	end

	local function t_wait(i, a, dt)
		local s = st[i]
		local t = s[a]
		if t == nil then t = param[i] end
		t -= dt
		if t <= 0 then
			s[a] = nil
			return SUCCESS
		end
		s[a] = t
		return RUNNING
	end

	local function t_seq(i, a, dt)
		local s = st[i]
		local c = s[a]
		if c == nil then c = 1 end
		local kd, C = kids[i], nc[i]
		for x = c, C do
			local ch = kd[x]
			local r = tick1[ch](ch, a, dt)
			if r == RUNNING then
				s[a] = x
				return RUNNING
			elseif r == FAILURE then
				s[a] = nil
				return FAILURE
			end
		end
		s[a] = nil
		return SUCCESS
	end

	local function t_fall(i, a, dt)
		local s = st[i]
		local c = s[a]
		if c == nil then c = 1 end
		local kd, C = kids[i], nc[i]
		for x = c, C do
			local ch = kd[x]
			local r = tick1[ch](ch, a, dt)
			if r == RUNNING then
				s[a] = x
				return RUNNING
			elseif r == SUCCESS then
				s[a] = nil
				return SUCCESS
			end
		end
		s[a] = nil
		return FAILURE
	end

	local function t_rseq(i, a, dt)
		local s = st[i]
		local kd, C = kids[i], nc[i]
		for x = 1, C do
			local ch = kd[x]
			local r = tick1[ch](ch, a, dt)
			if r ~= SUCCESS then
				for y = x + 1, C do
					local o = kd[y]
					halt1[o](o, a)
				end
				if r == RUNNING then
					s[a] = true
					return RUNNING
				end
				s[a] = nil
				return FAILURE
			end
		end
		s[a] = nil
		return SUCCESS
	end

	local function t_rfall(i, a, dt)
		local s = st[i]
		local kd, C = kids[i], nc[i]
		for x = 1, C do
			local ch = kd[x]
			local r = tick1[ch](ch, a, dt)
			if r ~= FAILURE then
				for y = x + 1, C do
					local o = kd[y]
					halt1[o](o, a)
				end
				if r == RUNNING then
					s[a] = true
					return RUNNING
				end
				s[a] = nil
				return SUCCESS
			end
		end
		s[a] = nil
		return FAILURE
	end

	local function t_par(i, a, dt)
		local s = st[i]
		local sc, fc = psc[i], pfc[i]
		local mask = s[a]
		if mask == nil then
			mask = 0
			s[a] = 0
			sc[a] = 0
			fc[a] = 0
		end
		local kd, C = kids[i], nc[i]
		local one_s, one_f = pso[i], pfo[i]
		local bit = 1
		for x = 1, C do
			if band(mask, bit) == 0 then
				local ch = kd[x]
				local r = tick1[ch](ch, a, dt)
				if r ~= RUNNING then
					local done
					if r == SUCCESS then
						sc[a] += 1
						done = one_s
					else
						fc[a] += 1
						done = one_f
					end
					if done then
						s[a] = nil
						for y = 1, C do
							local o = kd[y]
							halt1[o](o, a)
						end
						return r
					end
					mask = bor(mask, bit)
					s[a] = mask
				end
			end
			bit *= 2
		end
		if psa[i] and sc[a] == C then
			s[a] = nil
			return SUCCESS
		elseif pfa[i] and fc[a] == C then
			s[a] = nil
			return FAILURE
		end
		return RUNNING
	end

	local function t_inv(i, a, dt)
		local ch = k1[i]
		local r = tick1[ch](ch, a, dt)
		if r == SUCCESS then return FAILURE elseif r == FAILURE then return SUCCESS end
		return r
	end

	local function t_fsucc(i, a, dt)
		local ch = k1[i]
		local r = tick1[ch](ch, a, dt)
		if r == FAILURE then return SUCCESS end
		return r
	end

	local function t_ffail(i, a, dt)
		local ch = k1[i]
		local r = tick1[ch](ch, a, dt)
		if r == SUCCESS then return FAILURE end
		return r
	end

	local function t_repeat(i, a, dt)
		local s = st[i]
		local c = s[a]
		if c == nil then
			c = 0
			s[a] = 0
		end
		local ch = k1[i]
		local r = tick1[ch](ch, a, dt)
		if r == RUNNING then return RUNNING end
		c += 1
		if c >= param[i] then
			s[a] = nil
			return SUCCESS
		end
		s[a] = c
		return RUNNING
	end

	local function t_timeout(i, a, dt)
		local s = st[i]
		local t = s[a]
		if t == nil then t = param[i] end
		t -= dt
		local ch = k1[i]
		if t <= 0 then
			s[a] = nil
			halt1[ch](ch, a)
			return FAILURE
		end
		s[a] = t
		local r = tick1[ch](ch, a, dt)
		if r ~= RUNNING then s[a] = nil end
		return r
	end

	local function t_cooldown(i, a, dt)
		local timer = cdt[i]
		local t = timer[a]
		if t == nil then t = 0 end
		t -= dt
		timer[a] = t
		if t > 0 then return FAILURE end
		local ch = k1[i]
		local r = tick1[ch](ch, a, dt)
		if r ~= RUNNING then timer[a] = param[i] end
		return r
	end

	---------------------------------------------------------------------------------------------
	-- build
	---------------------------------------------------------------------------------------------
	local n_nodes = 0
	local function new_node()
		n_nodes += 1
		local i = n_nodes
		st[i] = {}
		purge[#purge + 1] = st[i]
		return i
	end

	local function build(sp)
		local kind = sp.kind
		local i = new_node()
		if kind == "Sequence" or kind == "Fallback" then
			tick1[i] = kind == "Sequence" and t_seq or t_fall
			halt1[i] = halt_cursor
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "ReactiveSequence" or kind == "ReactiveFallback" then
			tick1[i] = kind == "ReactiveSequence" and t_rseq or t_rfall
			halt1[i] = halt_multi
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "Parallel" then
			tick1[i] = t_par
			halt1[i] = halt_multi
			psc[i], pfc[i] = {}, {}
			purge[#purge + 1] = psc[i]
			purge[#purge + 1] = pfc[i]
			pso[i] = sp.success_policy == "ONE"
			pfo[i] = sp.failure_policy == "ONE"
			psa[i] = not pso[i]
			pfa[i] = not pfo[i]
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "Inverter" or kind == "ForceSuccess" or kind == "ForceFailure" then
			tick1[i] = kind == "Inverter" and t_inv or (kind == "ForceSuccess" and t_fsucc or t_ffail)
			halt1[i] = halt_pass
			k1[i] = build(sp.child)
		elseif kind == "Repeat" then
			tick1[i] = t_repeat
			halt1[i] = halt_one
			param[i] = sp.count
			k1[i] = build(sp.child)
		elseif kind == "Timeout" then
			tick1[i] = t_timeout
			halt1[i] = halt_one
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Cooldown" then
			tick1[i] = t_cooldown
			halt1[i] = halt_pass
			cdt[i] = {}
			purge[#purge + 1] = cdt[i]
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Wait" then
			tick1[i] = t_wait
			halt1[i] = halt_state
			param[i] = sp.seconds
		elseif kind == "Leaf" then
			ltick[i] = sp.on_tick
			lstart[i] = sp.on_start
			lhalt[i] = sp.on_halt
			if sp.on_start then
				tick1[i] = t_leaf_full
				halt1[i] = sp.on_halt and halt_leaf or halt_state
			elseif sp.on_halt then
				tick1[i] = t_leaf_halt
				halt1[i] = halt_leaf
			else
				tick1[i] = t_leaf_pure
				halt1[i] = halt_none
			end
		else
			error("flat_batch_control: unknown kind " .. tostring(kind))
		end
		return i
	end

	local root = build(spec)
	local root_tick, root_halt = tick1[root], halt1[root]

	local agents, slot, n_agents = {}, {}, 0

	return {
		status = status,
		add = function(id)
			n_agents += 1
			agents[n_agents] = id
			slot[id] = n_agents
		end,
		remove = function(id)
			root_halt(root, id)
			for _, t in purge do t[id] = nil end
			status[id] = nil
			local i = slot[id]
			local last = n_agents
			local moved = agents[last]
			agents[i] = moved
			slot[moved] = i
			agents[last] = nil
			slot[id] = nil
			n_agents = last - 1
		end,
		tick = function(dt)
			for k = 1, n_agents do
				local a = agents[k]
				status[a] = root_tick(root, a, dt)
			end
		end,
		node_count = n_nodes,
	}
end

return {
	name = "flat_batch_control",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
