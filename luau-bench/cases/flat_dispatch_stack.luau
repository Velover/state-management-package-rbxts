--!optimize 2
-- flat_dispatch_stack (d4): same flat node arrays and the same per-agent SoM state as
-- flat_dispatch, but the traversal is an explicit state machine over a preallocated stack
-- instead of recursion.
--
-- Frame layout (parallel arrays, preallocated to the tree depth, never reallocated):
--   STK_ID[sp]  the composite/decorator being resumed
--   STK_C [sp]  the child id it is currently running
--   STK_A [sp]  spare: Parallel success count / ReactiveSeq+Fallback remembered running child /
--               Repeat count at entry
--   STK_B [sp]  spare: Parallel failure count
--
-- The loop alternates two phases:
--   descend: walk down from `id`, pushing a frame per composite, until a node produces a status;
--   ascend : hand `ret` to the frame on top, which either descends into its next child or pops.
-- A composite is therefore dispatched once per child return *plus* once on entry, where the
-- recursive version dispatches it once in total. That is the price of the flattening, and it
-- shows up in the numbers.
--
-- Halting is still recursive (it is rare, and an interruptible halt would need a second stack).

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

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
	local KIND, FIRST, CNT, PARAM = {}, {}, {}, {}
	local SPOL, FPOL = {}, {}
	local FS, FT, FH = {}, {}, {}
	local SA, SB, PS = {}, {}, {}

	local MAPS, INITS, NMAPS = {}, {}, 0
	local function newmap(store, id, init)
		local m = {}
		store[id] = m
		NMAPS += 1
		MAPS[NMAPS] = m
		INITS[NMAPS] = init
		return m
	end

	local queue, qid = { spec }, { 1 }
	local depth = { 1 }
	local n, head, maxdepth = 1, 1, 1
	while head <= #queue do
		local s = queue[head]
		local id = qid[head]
		local d = depth[head]
		head += 1
		if d > maxdepth then maxdepth = d end

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
				depth[#depth + 1] = d + 1
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
			error("flat_dispatch_stack: unknown kind " .. tostring(k))
		end
	end

	-- halt (recursive, same cascade as flat_dispatch) ---------------------------------------------
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
	end

	local function par_reset(first, last, agent)
		for c = first, last do
			local m = PS[c]
			local st = m[agent]
			m[agent] = -1
			if st == RUNNING then halt_node(c, agent) end
		end
	end

	-- preallocated frame stack --------------------------------------------------------------------
	local STK_ID, STK_C, STK_A, STK_B = {}, {}, {}, {}
	for i = 1, maxdepth + 1 do
		STK_ID[i] = 0
		STK_C[i] = 0
		STK_A[i] = 0
		STK_B[i] = 0
	end

	local function run(agent, dt)
		local sp = 0
		local id = 1
		local ret = FAILURE

		while true do
			---------------------------------------------------------------------------- descend
			while true do
				local k = KIND[id]
				if k == K_LEAF then
					ret = FT[id](agent, dt)
					break
				elseif k == K_LEAFF then
					local m = SA[id]
					if m[agent] == 0 then
						m[agent] = 1
						local f = FS[id]
						if f ~= nil then f(agent) end
					end
					local s = FT[id](agent, dt)
					if s ~= RUNNING then m[agent] = 0 end
					ret = s
					break
				elseif k == K_SEQ or k == K_FB then
					local c = SA[id][agent]
					if c == 0 then c = FIRST[id] end
					sp += 1
					STK_ID[sp] = id
					STK_C[sp] = c
					id = c
				elseif k == K_INV or k == K_FSUCC or k == K_FFAIL then
					sp += 1
					STK_ID[sp] = id
					id = FIRST[id]
				elseif k == K_RSEQ or k == K_RFB then
					local c = FIRST[id]
					sp += 1
					STK_ID[sp] = id
					STK_C[sp] = c
					STK_A[sp] = SA[id][agent] -- remembered running child
					id = c
				elseif k == K_WAIT then
					local m = SA[id]
					local t = m[agent]
					if t == 0 then t = PARAM[id] end
					t -= dt
					if t <= 0 then
						m[agent] = 0
						ret = SUCCESS
					else
						m[agent] = t
						ret = RUNNING
					end
					break
				elseif k == K_PAR then
					local first = FIRST[id]
					local last = first + CNT[id] - 1
					local nsucc, nfail = 0, 0
					local c = first
					while c <= last do
						local st = PS[c][agent]
						if st == SUCCESS then
							nsucc += 1
						elseif st == FAILURE then
							nfail += 1
						else
							break
						end
						c += 1
					end
					if c <= last then
						sp += 1
						STK_ID[sp] = id
						STK_C[sp] = c
						STK_A[sp] = nsucc
						STK_B[sp] = nfail
						id = c
					else
						local cnt = CNT[id]
						if not SPOL[id] and nsucc == cnt then
							par_reset(first, last, agent)
							ret = SUCCESS
						elseif not FPOL[id] and nfail == cnt then
							par_reset(first, last, agent)
							ret = FAILURE
						else
							ret = RUNNING
						end
						break
					end
				elseif k == K_REP then
					local ma = SA[id]
					local c = ma[agent]
					if c < 0 then c = 0 end
					if c >= PARAM[id] then
						ma[agent] = -1
						ret = SUCCESS
						break
					end
					sp += 1
					STK_ID[sp] = id
					STK_A[sp] = c
					id = FIRST[id]
				elseif k == K_COOL then
					local m = SA[id]
					local t = m[agent] - dt
					m[agent] = t
					if t > 0 then
						ret = FAILURE
						break
					end
					sp += 1
					STK_ID[sp] = id
					id = FIRST[id]
				elseif k == K_TMO then
					local m = SA[id]
					local t = m[agent]
					local started = t ~= 0
					if not started then t = PARAM[id] end
					t -= dt
					if t <= 0 then
						m[agent] = 0
						if started then halt_node(FIRST[id], agent) end
						ret = FAILURE
						break
					end
					m[agent] = t
					sp += 1
					STK_ID[sp] = id
					id = FIRST[id]
				else
					error("flat_dispatch_stack: bad kind " .. tostring(k))
				end
			end

			---------------------------------------------------------------------------- ascend
			while true do
				if sp == 0 then return ret end
				local fid = STK_ID[sp]
				local k = KIND[fid]

				if k == K_SEQ then
					local m = SA[fid]
					if ret == RUNNING then
						m[agent] = STK_C[sp]
						sp -= 1
					elseif ret == FAILURE then
						m[agent] = 0
						sp -= 1
					else
						local c = STK_C[sp] + 1
						if c > FIRST[fid] + CNT[fid] - 1 then
							m[agent] = 0
							ret = SUCCESS
							sp -= 1
						else
							STK_C[sp] = c
							id = c
							break
						end
					end
				elseif k == K_INV then
					if ret == SUCCESS then
						ret = FAILURE
					elseif ret == FAILURE then
						ret = SUCCESS
					end
					sp -= 1
				elseif k == K_FB then
					local m = SA[fid]
					if ret == RUNNING then
						m[agent] = STK_C[sp]
						sp -= 1
					elseif ret == SUCCESS then
						m[agent] = 0
						sp -= 1
					else
						local c = STK_C[sp] + 1
						if c > FIRST[fid] + CNT[fid] - 1 then
							m[agent] = 0
							ret = FAILURE
							sp -= 1
						else
							STK_C[sp] = c
							id = c
							break
						end
					end
				elseif k == K_RSEQ then
					local m = SA[fid]
					local c = STK_C[sp]
					local r = STK_A[sp]
					if ret == RUNNING then
						m[agent] = c
						if r > c then halt_node(r, agent) end
						sp -= 1
					elseif ret == FAILURE then
						m[agent] = 0
						if r > c then halt_node(r, agent) end
						sp -= 1
					else
						c += 1
						if c > FIRST[fid] + CNT[fid] - 1 then
							m[agent] = 0
							ret = SUCCESS
							sp -= 1
						else
							STK_C[sp] = c
							id = c
							break
						end
					end
				elseif k == K_RFB then
					local m = SA[fid]
					local c = STK_C[sp]
					local r = STK_A[sp]
					if ret == SUCCESS then
						m[agent] = 0
						if r > c then halt_node(r, agent) end
						sp -= 1
					elseif ret == RUNNING then
						m[agent] = c
						if r > c then halt_node(r, agent) end
						sp -= 1
					else
						c += 1
						if c > FIRST[fid] + CNT[fid] - 1 then
							m[agent] = 0
							ret = FAILURE
							sp -= 1
						else
							STK_C[sp] = c
							id = c
							break
						end
					end
				elseif k == K_PAR then
					local first = FIRST[fid]
					local cnt = CNT[fid]
					local last = first + cnt - 1
					local c = STK_C[sp]
					PS[c][agent] = ret
					local nsucc, nfail = STK_A[sp], STK_B[sp]
					local finished = false
					if ret == SUCCESS then
						nsucc += 1
						if SPOL[fid] then
							par_reset(first, last, agent)
							ret = SUCCESS
							sp -= 1
							finished = true
						end
					elseif ret == FAILURE then
						nfail += 1
						if FPOL[fid] then
							par_reset(first, last, agent)
							ret = FAILURE
							sp -= 1
							finished = true
						end
					end
					if not finished then
						c += 1
						while c <= last do
							local st = PS[c][agent]
							if st == SUCCESS then
								nsucc += 1
							elseif st == FAILURE then
								nfail += 1
							else
								break
							end
							c += 1
						end
						if c <= last then
							STK_C[sp] = c
							STK_A[sp] = nsucc
							STK_B[sp] = nfail
							id = c
							break
						end
						if not SPOL[fid] and nsucc == cnt then
							par_reset(first, last, agent)
							ret = SUCCESS
						elseif not FPOL[fid] and nfail == cnt then
							par_reset(first, last, agent)
							ret = FAILURE
						else
							ret = RUNNING
						end
						sp -= 1
					end
				elseif k == K_FSUCC then
					if ret ~= RUNNING then ret = SUCCESS end
					sp -= 1
				elseif k == K_FFAIL then
					if ret ~= RUNNING then ret = FAILURE end
					sp -= 1
				elseif k == K_REP then
					local ma = SA[fid]
					local mb = SB[fid]
					local c = STK_A[sp]
					if ret == RUNNING then
						ma[agent] = c
						mb[agent] = 1
					else
						mb[agent] = 0
						c += 1
						if c >= PARAM[fid] then
							ma[agent] = -1
							ret = SUCCESS
						else
							ma[agent] = c
							ret = RUNNING
						end
					end
					sp -= 1
				elseif k == K_COOL then
					if ret ~= RUNNING then SA[fid][agent] = PARAM[fid] end
					sp -= 1
				elseif k == K_TMO then
					if ret ~= RUNNING then SA[fid][agent] = 0 end
					sp -= 1
				end
			end
		end
	end

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
				status[a] = run(a, dt)
			end
		end,
	}
end

return {
	name = "flat_dispatch_stack",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick_all(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
