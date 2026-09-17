--!optimize 2
-- flat_dispatch (d1): the whole tree is a flat graph in parallel arrays indexed by node id.
-- No closure per node, no metatables, no node objects. One recursive `tick_node(id, agent, dt)`
-- with an if/elseif chain on a numeric kind code, and one `halt_node(id, agent)`.
--
-- Layout
--   ids are assigned breadth-first, so the children of a composite occupy the contiguous range
--   FIRST[id] .. FIRST[id] + CNT[id] - 1. Decorators are composites with CNT == 1, so the same
--   FIRST[id] is the child pointer: no per-node children table at all.
--
-- Per-agent state: Struct-of-Maps *per node*: SA[id] is a table keyed by agent id.
--   Only nodes that need state own a map, and every map uses a numeric idle sentinel instead of
--   nil so that a steady-state tick never inserts a hash key (which would allocate).
--
--   LEAF   (no on_start/on_halt)  no state at all
--   LEAFF  (has hooks)            SA = 0 idle / 1 running
--   SEQ/FB                        SA = 0 idle / cursor child id
--   RSEQ/RFB                      SA = 0 none  / id of the one running child
--   WAIT/TIMEOUT                  SA = 0 idle  / time_left (> 0 while running)
--   COOLDOWN                      SA = time_left, persists across runs (never an idle marker)
--   REPEAT                        SA = -1 idle / count, SB = 1 when the child is running
--   PARALLEL                      PS[child] = -1 idle / RUNNING / SUCCESS / FAILURE (per child)
--   INVERTER/FORCE*               no state (they run exactly when their child runs)
--
-- Halting is an explicit cascade: halt_node(id, agent) is only ever called on a node that IS
-- running for that agent, and each kind knows which of its children is the running one.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

-- kind codes, roughly ordered by how often they are visited per tick across the scenarios
local K_LEAF = 1
local K_LEAFF = 2
local K_SEQ = 3
local K_INV = 4
local K_FB = 5
local K_RSEQ = 6
local K_WAIT = 7
local K_PAR = 8
local K_RFB = 9
local K_FSUCC = 10
local K_FFAIL = 11
local K_REP = 12
local K_COOL = 13
local K_TMO = 14

local function new_world(spec)
	-- node arrays -------------------------------------------------------------------------------
	local KIND, FIRST, CNT, PARAM = {}, {}, {}, {}
	local SPOL, FPOL = {}, {} -- true == policy ONE
	local FS, FT, FH = {}, {}, {} -- leaf on_start / on_tick / on_halt
	local SA, SB, PS = {}, {}, {} -- per-agent state maps, indexed by node id

	-- every state map, with its idle value, so add/remove_agent is a flat loop
	local MAPS, INITS, NMAPS = {}, {}, 0
	local function newmap(store, id, init)
		local m = {}
		store[id] = m
		NMAPS += 1
		MAPS[NMAPS] = m
		INITS[NMAPS] = init
		return m
	end

	-- build: breadth-first id assignment keeps siblings contiguous ------------------------------
	local queue, qid = { spec }, { 1 }
	local n, head = 1, 1
	while head <= #queue do
		local s = queue[head]
		local id = qid[head]
		head += 1

		local kids = s.children
		if kids == nil and s.child ~= nil then kids = { s.child } end
		local first, cnt = 0, 0
		if kids ~= nil then
			cnt = #kids
			first = n + 1
			n += cnt
			FIRST[id] = first
			CNT[id] = cnt
			for i = 1, cnt do
				queue[#queue + 1] = kids[i]
				qid[#qid + 1] = first + i - 1
			end
		end

		local k = s.kind
		if k == "Leaf" then
			FT[id] = s.on_tick
			if s.on_start ~= nil or s.on_halt ~= nil then
				KIND[id] = K_LEAFF
				FS[id] = s.on_start
				FH[id] = s.on_halt
				newmap(SA, id, 0)
			else
				KIND[id] = K_LEAF
			end
		elseif k == "Sequence" then
			KIND[id] = K_SEQ
			newmap(SA, id, 0)
		elseif k == "Fallback" then
			KIND[id] = K_FB
			newmap(SA, id, 0)
		elseif k == "ReactiveSequence" then
			KIND[id] = K_RSEQ
			newmap(SA, id, 0)
		elseif k == "ReactiveFallback" then
			KIND[id] = K_RFB
			newmap(SA, id, 0)
		elseif k == "Parallel" then
			KIND[id] = K_PAR
			SPOL[id] = s.success_policy == "ONE"
			FPOL[id] = s.failure_policy == "ONE"
			for c = first, first + cnt - 1 do newmap(PS, c, -1) end
		elseif k == "Inverter" then
			KIND[id] = K_INV
		elseif k == "ForceSuccess" then
			KIND[id] = K_FSUCC
		elseif k == "ForceFailure" then
			KIND[id] = K_FFAIL
		elseif k == "Repeat" then
			KIND[id] = K_REP
			PARAM[id] = s.count
			newmap(SA, id, -1)
			newmap(SB, id, 0)
		elseif k == "Wait" then
			KIND[id] = K_WAIT
			PARAM[id] = s.seconds
			newmap(SA, id, 0)
		elseif k == "Timeout" then
			KIND[id] = K_TMO
			PARAM[id] = s.seconds
			newmap(SA, id, 0)
		elseif k == "Cooldown" then
			KIND[id] = K_COOL
			PARAM[id] = s.seconds
			newmap(SA, id, 0)
		else
			error("flat_dispatch: unknown kind " .. tostring(k))
		end
	end

	-- halt --------------------------------------------------------------------------------------
	local halt_node
	halt_node = function(id, agent)
		local k = KIND[id]
		if k == K_LEAFF then
			local h = FH[id]
			if h ~= nil then h(agent) end
			SA[id][agent] = 0
		elseif k == K_SEQ or k == K_FB or k == K_RSEQ or k == K_RFB then
			local m = SA[id]
			local c = m[agent]
			m[agent] = 0
			if c ~= 0 then halt_node(c, agent) end
		elseif k == K_INV or k == K_FSUCC or k == K_FFAIL or k == K_COOL then
			halt_node(FIRST[id], agent)
		elseif k == K_WAIT then
			SA[id][agent] = 0
		elseif k == K_TMO then
			SA[id][agent] = 0
			halt_node(FIRST[id], agent)
		elseif k == K_REP then
			local mb = SB[id]
			SA[id][agent] = -1
			if mb[agent] == 1 then
				mb[agent] = 0
				halt_node(FIRST[id], agent)
			end
		elseif k == K_PAR then
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local m = PS[c]
				local st = m[agent]
				m[agent] = -1
				if st == RUNNING then halt_node(c, agent) end
			end
		end
		-- K_LEAF holds nothing and has no on_halt
	end

	local function par_reset(first, last, agent)
		for c = first, last do
			local m = PS[c]
			local st = m[agent]
			m[agent] = -1
			if st == RUNNING then halt_node(c, agent) end
		end
	end

	-- tick --------------------------------------------------------------------------------------
	local tick_node
	tick_node = function(id, agent, dt)
		local k = KIND[id]

		if k == K_LEAF then
			return FT[id](agent, dt)

		elseif k == K_LEAFF then
			local m = SA[id]
			if m[agent] == 0 then
				m[agent] = 1
				local f = FS[id]
				if f ~= nil then f(agent) end
			end
			local s = FT[id](agent, dt)
			if s ~= RUNNING then m[agent] = 0 end
			return s

		elseif k == K_SEQ then
			local m = SA[id]
			local c = m[agent]
			local first = FIRST[id]
			if c == 0 then c = first end
			local last = first + CNT[id] - 1
			while c <= last do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					m[agent] = c
					return RUNNING
				elseif s == FAILURE then
					m[agent] = 0
					return FAILURE
				end
				c += 1
			end
			m[agent] = 0
			return SUCCESS

		elseif k == K_INV then
			local s = tick_node(FIRST[id], agent, dt)
			if s == SUCCESS then
				return FAILURE
			elseif s == FAILURE then
				return SUCCESS
			end
			return RUNNING

		elseif k == K_FB then
			local m = SA[id]
			local c = m[agent]
			local first = FIRST[id]
			if c == 0 then c = first end
			local last = first + CNT[id] - 1
			while c <= last do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					m[agent] = c
					return RUNNING
				elseif s == SUCCESS then
					m[agent] = 0
					return SUCCESS
				end
				c += 1
			end
			m[agent] = 0
			return FAILURE

		elseif k == K_RSEQ then
			local m = SA[id]
			local r = m[agent]
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					m[agent] = c
					if r > c then halt_node(r, agent) end
					return RUNNING
				elseif s == FAILURE then
					m[agent] = 0
					if r > c then halt_node(r, agent) end
					return FAILURE
				end
			end
			m[agent] = 0
			return SUCCESS

		elseif k == K_WAIT then
			local m = SA[id]
			local t = m[agent]
			if t == 0 then t = PARAM[id] end
			t -= dt
			if t <= 0 then
				m[agent] = 0
				return SUCCESS
			end
			m[agent] = t
			return RUNNING

		elseif k == K_PAR then
			local first = FIRST[id]
			local cnt = CNT[id]
			local last = first + cnt - 1
			local one_s, one_f = SPOL[id], FPOL[id]
			local nsucc, nfail = 0, 0
			for c = first, last do
				local m = PS[c]
				local st = m[agent]
				if st == SUCCESS then
					nsucc += 1
				elseif st == FAILURE then
					nfail += 1
				else
					local s = tick_node(c, agent, dt)
					m[agent] = s
					if s == SUCCESS then
						nsucc += 1
						if one_s then
							par_reset(first, last, agent)
							return SUCCESS
						end
					elseif s == FAILURE then
						nfail += 1
						if one_f then
							par_reset(first, last, agent)
							return FAILURE
						end
					end
				end
			end
			if not one_s and nsucc == cnt then
				par_reset(first, last, agent)
				return SUCCESS
			end
			if not one_f and nfail == cnt then
				par_reset(first, last, agent)
				return FAILURE
			end
			return RUNNING

		elseif k == K_RFB then
			local m = SA[id]
			local r = m[agent]
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local s = tick_node(c, agent, dt)
				if s == SUCCESS then
					m[agent] = 0
					if r > c then halt_node(r, agent) end
					return SUCCESS
				elseif s == RUNNING then
					m[agent] = c
					if r > c then halt_node(r, agent) end
					return RUNNING
				end
			end
			m[agent] = 0
			return FAILURE

		elseif k == K_FSUCC then
			local s = tick_node(FIRST[id], agent, dt)
			if s == RUNNING then return RUNNING end
			return SUCCESS

		elseif k == K_FFAIL then
			local s = tick_node(FIRST[id], agent, dt)
			if s == RUNNING then return RUNNING end
			return FAILURE

		elseif k == K_REP then
			local ma = SA[id]
			local c = ma[agent]
			if c < 0 then c = 0 end
			local target = PARAM[id]
			if c >= target then
				ma[agent] = -1
				return SUCCESS
			end
			local s = tick_node(FIRST[id], agent, dt)
			local mb = SB[id]
			if s == RUNNING then
				ma[agent] = c
				mb[agent] = 1
				return RUNNING
			end
			mb[agent] = 0
			c += 1
			if c >= target then
				ma[agent] = -1
				return SUCCESS
			end
			ma[agent] = c
			return RUNNING

		elseif k == K_COOL then
			local m = SA[id]
			local t = m[agent] - dt
			m[agent] = t
			if t > 0 then return FAILURE end
			local s = tick_node(FIRST[id], agent, dt)
			if s ~= RUNNING then m[agent] = PARAM[id] end
			return s

		elseif k == K_TMO then
			local m = SA[id]
			local t = m[agent]
			local started = t ~= 0
			if not started then t = PARAM[id] end
			t -= dt
			if t <= 0 then
				m[agent] = 0
				if started then halt_node(FIRST[id], agent) end
				return FAILURE
			end
			m[agent] = t
			local s = tick_node(FIRST[id], agent, dt)
			if s ~= RUNNING then m[agent] = 0 end
			return s
		end

		error("flat_dispatch: bad kind " .. tostring(k))
	end

	-- world -------------------------------------------------------------------------------------
	local status = {}
	local order, slot, nlive = {}, {}, 0

	return {
		status = status,
		add = function(id)
			for i = 1, NMAPS do MAPS[i][id] = INITS[i] end
			nlive += 1
			order[nlive] = id
			slot[id] = nlive
		end,
		remove = function(id)
			if status[id] == RUNNING then halt_node(1, id) end
			for i = 1, NMAPS do MAPS[i][id] = nil end
			status[id] = nil
			local s = slot[id]
			local moved = order[nlive]
			order[s] = moved
			slot[moved] = s
			order[nlive] = nil
			nlive -= 1
			slot[id] = nil
		end,
		tick_all = function(dt)
			for i = 1, nlive do
				local a = order[i]
				status[a] = tick_node(1, a, dt)
			end
		end,
	}
end

return {
	name = "flat_dispatch",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick_all(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
