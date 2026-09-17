--!optimize 2
-- flat_dispatch_buffer (d5): identical to flat_dispatch (same flat node arrays, same if/elseif
-- dispatch, same semantics) except that ALL per-agent node state lives in one f64 `buffer`
-- instead of one Struct-of-Maps table per node.
--
--   every stateful node gets a fixed f64 field offset inside a per-agent block (BLOCK8 bytes);
--   agents get a dense slot (1..CAP) from a free list; `base` (the agent's byte offset) is an
--   upvalue set once per agent per tick, so a node access is
--       buffer.readf64(BUF, base + OFFA[id])
--   i.e. one array read + one buffer read, instead of SA[id] (array read) + m[agent] (HASH read).
--
-- Bookkeeping this forces on you (see the report):
--   * id -> slot map + free list + slot -> agent array, all kept in sync on add/remove;
--   * the buffer must be grown (realloc + copy) when the agent high-water mark rises;
--   * every sentinel must be shifted so that "idle" == 0.0, because a fresh slot can only be
--     cleared wholesale with buffer.fill (Repeat stores count+1, Parallel stores status+1);
--   * only numbers fit: leaf hook closures, policies etc. still live in ordinary arrays.

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

local readf64 = buffer.readf64
local writef64 = buffer.writef64

local function new_world(spec)
	local KIND, FIRST, CNT, PARAM = {}, {}, {}, {}
	local SPOL, FPOL = {}, {}
	local FS, FT, FH = {}, {}, {}
	local OFFA, OFFB, OFFP = {}, {}, {} -- byte offsets inside an agent block

	local NFIELDS = 0
	local function field()
		local off = NFIELDS * 8
		NFIELDS += 1
		return off
	end

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
				OFFA[id] = field()
			else
				KIND[id] = K_LEAF
			end
		elseif k == "Sequence" then
			KIND[id] = K_SEQ
			OFFA[id] = field()
		elseif k == "Fallback" then
			KIND[id] = K_FB
			OFFA[id] = field()
		elseif k == "ReactiveSequence" then
			KIND[id] = K_RSEQ
			OFFA[id] = field()
		elseif k == "ReactiveFallback" then
			KIND[id] = K_RFB
			OFFA[id] = field()
		elseif k == "Parallel" then
			KIND[id] = K_PAR
			SPOL[id] = s.success_policy == "ONE"
			FPOL[id] = s.failure_policy == "ONE"
			for c = first, first + cnt - 1 do OFFP[c] = field() end
		elseif k == "Inverter" then
			KIND[id] = K_INV
		elseif k == "ForceSuccess" then
			KIND[id] = K_FSUCC
		elseif k == "ForceFailure" then
			KIND[id] = K_FFAIL
		elseif k == "Repeat" then
			KIND[id] = K_REP
			PARAM[id] = s.count
			OFFA[id] = field() -- count + 1 (0 == idle)
			OFFB[id] = field() -- 1 while the child is running
		elseif k == "Wait" then
			KIND[id] = K_WAIT
			PARAM[id] = s.seconds
			OFFA[id] = field()
		elseif k == "Timeout" then
			KIND[id] = K_TMO
			PARAM[id] = s.seconds
			OFFA[id] = field()
		elseif k == "Cooldown" then
			KIND[id] = K_COOL
			PARAM[id] = s.seconds
			OFFA[id] = field()
		else
			error("flat_dispatch_buffer: unknown kind " .. tostring(k))
		end
	end

	local BLOCK8 = math.max(NFIELDS, 1) * 8
	local CAP = 8
	local BUF = buffer.create(BLOCK8 * CAP)
	local base = 0 -- byte offset of the agent currently being traversed

	-- halt --------------------------------------------------------------------------------------
	local halt_node
	halt_node = function(id, agent)
		local k = KIND[id]
		if k == K_LEAFF then
			local h = FH[id]
			if h ~= nil then h(agent) end
			writef64(BUF, base + OFFA[id], 0)
		elseif k == K_SEQ or k == K_FB or k == K_RSEQ or k == K_RFB then
			local o = base + OFFA[id]
			local c = readf64(BUF, o)
			writef64(BUF, o, 0)
			if c ~= 0 then halt_node(c, agent) end
		elseif k == K_INV or k == K_FSUCC or k == K_FFAIL or k == K_COOL then
			halt_node(FIRST[id], agent)
		elseif k == K_WAIT then
			writef64(BUF, base + OFFA[id], 0)
		elseif k == K_TMO then
			writef64(BUF, base + OFFA[id], 0)
			halt_node(FIRST[id], agent)
		elseif k == K_REP then
			writef64(BUF, base + OFFA[id], 0)
			local ob = base + OFFB[id]
			if readf64(BUF, ob) == 1 then
				writef64(BUF, ob, 0)
				halt_node(FIRST[id], agent)
			end
		elseif k == K_PAR then
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local o = base + OFFP[c]
				local st = readf64(BUF, o)
				writef64(BUF, o, 0)
				if st == 3 then halt_node(c, agent) end -- RUNNING + 1
			end
		end
	end

	local function par_reset(first, last, agent)
		for c = first, last do
			local o = base + OFFP[c]
			local st = readf64(BUF, o)
			writef64(BUF, o, 0)
			if st == 3 then halt_node(c, agent) end
		end
	end

	-- tick --------------------------------------------------------------------------------------
	local tick_node
	tick_node = function(id, agent, dt)
		local k = KIND[id]

		if k == K_LEAF then
			return FT[id](agent, dt)

		elseif k == K_LEAFF then
			local o = base + OFFA[id]
			if readf64(BUF, o) == 0 then
				writef64(BUF, o, 1)
				local f = FS[id]
				if f ~= nil then f(agent) end
			end
			local s = FT[id](agent, dt)
			if s ~= RUNNING then writef64(BUF, o, 0) end
			return s

		elseif k == K_SEQ then
			local o = base + OFFA[id]
			local c = readf64(BUF, o)
			local first = FIRST[id]
			if c == 0 then c = first end
			local last = first + CNT[id] - 1
			while c <= last do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					writef64(BUF, o, c)
					return RUNNING
				elseif s == FAILURE then
					writef64(BUF, o, 0)
					return FAILURE
				end
				c += 1
			end
			writef64(BUF, o, 0)
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
			local o = base + OFFA[id]
			local c = readf64(BUF, o)
			local first = FIRST[id]
			if c == 0 then c = first end
			local last = first + CNT[id] - 1
			while c <= last do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					writef64(BUF, o, c)
					return RUNNING
				elseif s == SUCCESS then
					writef64(BUF, o, 0)
					return SUCCESS
				end
				c += 1
			end
			writef64(BUF, o, 0)
			return FAILURE

		elseif k == K_RSEQ then
			local o = base + OFFA[id]
			local r = readf64(BUF, o)
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local s = tick_node(c, agent, dt)
				if s == RUNNING then
					writef64(BUF, o, c)
					if r > c then halt_node(r, agent) end
					return RUNNING
				elseif s == FAILURE then
					writef64(BUF, o, 0)
					if r > c then halt_node(r, agent) end
					return FAILURE
				end
			end
			writef64(BUF, o, 0)
			return SUCCESS

		elseif k == K_WAIT then
			local o = base + OFFA[id]
			local t = readf64(BUF, o)
			if t == 0 then t = PARAM[id] end
			t -= dt
			if t <= 0 then
				writef64(BUF, o, 0)
				return SUCCESS
			end
			writef64(BUF, o, t)
			return RUNNING

		elseif k == K_PAR then
			local first = FIRST[id]
			local cnt = CNT[id]
			local last = first + cnt - 1
			local one_s, one_f = SPOL[id], FPOL[id]
			local nsucc, nfail = 0, 0
			for c = first, last do
				local o = base + OFFP[c]
				local st = readf64(BUF, o)
				if st == 1 then -- SUCCESS + 1
					nsucc += 1
				elseif st == 2 then -- FAILURE + 1
					nfail += 1
				else
					local s = tick_node(c, agent, dt)
					writef64(BUF, o, s + 1)
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
			local o = base + OFFA[id]
			local r = readf64(BUF, o)
			local first = FIRST[id]
			for c = first, first + CNT[id] - 1 do
				local s = tick_node(c, agent, dt)
				if s == SUCCESS then
					writef64(BUF, o, 0)
					if r > c then halt_node(r, agent) end
					return SUCCESS
				elseif s == RUNNING then
					writef64(BUF, o, c)
					if r > c then halt_node(r, agent) end
					return RUNNING
				end
			end
			writef64(BUF, o, 0)
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
			local oa = base + OFFA[id]
			local c = readf64(BUF, oa) -- count + 1, 0 == idle
			if c == 0 then c = 1 end
			local target = PARAM[id]
			if c > target then
				writef64(BUF, oa, 0)
				return SUCCESS
			end
			local s = tick_node(FIRST[id], agent, dt)
			local ob = base + OFFB[id]
			if s == RUNNING then
				writef64(BUF, oa, c)
				writef64(BUF, ob, 1)
				return RUNNING
			end
			writef64(BUF, ob, 0)
			c += 1
			if c > target then
				writef64(BUF, oa, 0)
				return SUCCESS
			end
			writef64(BUF, oa, c)
			return RUNNING

		elseif k == K_COOL then
			local o = base + OFFA[id]
			local t = readf64(BUF, o) - dt
			writef64(BUF, o, t)
			if t > 0 then return FAILURE end
			local s = tick_node(FIRST[id], agent, dt)
			if s ~= RUNNING then writef64(BUF, o, PARAM[id]) end
			return s

		elseif k == K_TMO then
			local o = base + OFFA[id]
			local t = readf64(BUF, o)
			local started = t ~= 0
			if not started then t = PARAM[id] end
			t -= dt
			if t <= 0 then
				writef64(BUF, o, 0)
				if started then halt_node(FIRST[id], agent) end
				return FAILURE
			end
			writef64(BUF, o, t)
			local s = tick_node(FIRST[id], agent, dt)
			if s ~= RUNNING then writef64(BUF, o, 0) end
			return s
		end

		error("flat_dispatch_buffer: bad kind " .. tostring(k))
	end

	-- world: dense slots, free list, buffer growth -----------------------------------------------
	local status = {}
	local slot_of = {} -- agent id -> dense slot
	local free, nfree = {}, 0 -- free list of slots
	local high = 0 -- slot high-water mark
	local order, obase, pos, nlive = {}, {}, {}, 0

	return {
		status = status,
		add = function(id)
			local s
			if nfree > 0 then
				s = free[nfree]
				free[nfree] = nil
				nfree -= 1
			else
				high += 1
				s = high
				if s > CAP then
					local newcap = CAP * 2
					local nb = buffer.create(BLOCK8 * newcap)
					buffer.copy(nb, 0, BUF, 0, BLOCK8 * CAP)
					BUF = nb
					CAP = newcap
				end
			end
			slot_of[id] = s
			local b = (s - 1) * BLOCK8
			buffer.fill(BUF, b, 0, BLOCK8) -- all sentinels are 0
			nlive += 1
			order[nlive] = id
			obase[nlive] = b
			pos[id] = nlive
		end,
		remove = function(id)
			local p = pos[id]
			if status[id] == RUNNING then
				base = obase[p]
				halt_node(1, id)
			end
			nfree += 1
			free[nfree] = slot_of[id]
			slot_of[id] = nil
			status[id] = nil
			local moved = order[nlive]
			order[p] = moved
			obase[p] = obase[nlive]
			pos[moved] = p
			order[nlive] = nil
			obase[nlive] = nil
			nlive -= 1
			pos[id] = nil
		end,
		tick_all = function(dt)
			for i = 1, nlive do
				local a = order[i]
				base = obase[i]
				status[a] = tick_node(1, a, dt)
			end
		end,
	}
end

return {
	name = "flat_dispatch_buffer",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick_all(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
