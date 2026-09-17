--!optimize 2
-- flat_dispatch_pernode (d3): same flat arrays and same semantics as flat_dispatch, but the
-- handler is pre-resolved per node at build time: TF[id] / HF[id]. A recursion site is
--     local ch = FIRST[id] ; TF[ch](ch, agent, dt)
-- i.e. exactly one array read + one call, with no KIND[id] read and no if/elseif chain.
-- There is still one function per node KIND (14 of them), not one per node.

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
	local TF, HF = {}, {} -- pre-resolved handlers, indexed by node id

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
			error("flat_dispatch_pernode: unknown kind " .. tostring(k))
		end
	end

	-- halt handlers -----------------------------------------------------------------------------
	local function h_none(id, agent) end

	local function h_leaff(id, agent)
		local h = FH[id]
		if h ~= nil then h(agent) end
		SA[id][agent] = 0
	end

	local function h_cursor(id, agent)
		local m = SA[id]
		local c = m[agent]
		m[agent] = 0
		if c ~= 0 then HF[c](c, agent) end
	end

	local function h_child(id, agent)
		local ch = FIRST[id]
		HF[ch](ch, agent)
	end

	local function h_wait(id, agent)
		SA[id][agent] = 0
	end

	local function h_tmo(id, agent)
		SA[id][agent] = 0
		local ch = FIRST[id]
		HF[ch](ch, agent)
	end

	local function h_rep(id, agent)
		local mb = SB[id]
		SA[id][agent] = -1
		if mb[agent] == 1 then
			mb[agent] = 0
			local ch = FIRST[id]
			HF[ch](ch, agent)
		end
	end

	local function h_par(id, agent)
		local first = FIRST[id]
		for c = first, first + CNT[id] - 1 do
			local m = PS[c]
			local st = m[agent]
			m[agent] = -1
			if st == RUNNING then HF[c](c, agent) end
		end
	end

	local function par_reset(first, last, agent)
		for c = first, last do
			local m = PS[c]
			local st = m[agent]
			m[agent] = -1
			if st == RUNNING then HF[c](c, agent) end
		end
	end

	-- tick handlers -----------------------------------------------------------------------------
	local function t_leaf(id, agent, dt)
		return FT[id](agent, dt)
	end

	local function t_leaff(id, agent, dt)
		local m = SA[id]
		if m[agent] == 0 then
			m[agent] = 1
			local f = FS[id]
			if f ~= nil then f(agent) end
		end
		local s = FT[id](agent, dt)
		if s ~= RUNNING then m[agent] = 0 end
		return s
	end

	local function t_seq(id, agent, dt)
		local m = SA[id]
		local c = m[agent]
		local first = FIRST[id]
		if c == 0 then c = first end
		local last = first + CNT[id] - 1
		while c <= last do
			local s = TF[c](c, agent, dt)
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
	end

	local function t_fb(id, agent, dt)
		local m = SA[id]
		local c = m[agent]
		local first = FIRST[id]
		if c == 0 then c = first end
		local last = first + CNT[id] - 1
		while c <= last do
			local s = TF[c](c, agent, dt)
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
	end

	local function t_inv(id, agent, dt)
		local ch = FIRST[id]
		local s = TF[ch](ch, agent, dt)
		if s == SUCCESS then
			return FAILURE
		elseif s == FAILURE then
			return SUCCESS
		end
		return RUNNING
	end

	local function t_rseq(id, agent, dt)
		local m = SA[id]
		local r = m[agent]
		local first = FIRST[id]
		for c = first, first + CNT[id] - 1 do
			local s = TF[c](c, agent, dt)
			if s == RUNNING then
				m[agent] = c
				if r > c then HF[r](r, agent) end
				return RUNNING
			elseif s == FAILURE then
				m[agent] = 0
				if r > c then HF[r](r, agent) end
				return FAILURE
			end
		end
		m[agent] = 0
		return SUCCESS
	end

	local function t_rfb(id, agent, dt)
		local m = SA[id]
		local r = m[agent]
		local first = FIRST[id]
		for c = first, first + CNT[id] - 1 do
			local s = TF[c](c, agent, dt)
			if s == SUCCESS then
				m[agent] = 0
				if r > c then HF[r](r, agent) end
				return SUCCESS
			elseif s == RUNNING then
				m[agent] = c
				if r > c then HF[r](r, agent) end
				return RUNNING
			end
		end
		m[agent] = 0
		return FAILURE
	end

	local function t_wait(id, agent, dt)
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
	end

	local function t_par(id, agent, dt)
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
				local s = TF[c](c, agent, dt)
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
	end

	local function t_fsucc(id, agent, dt)
		local ch = FIRST[id]
		local s = TF[ch](ch, agent, dt)
		if s == RUNNING then return RUNNING end
		return SUCCESS
	end

	local function t_ffail(id, agent, dt)
		local ch = FIRST[id]
		local s = TF[ch](ch, agent, dt)
		if s == RUNNING then return RUNNING end
		return FAILURE
	end

	local function t_rep(id, agent, dt)
		local ma = SA[id]
		local c = ma[agent]
		if c < 0 then c = 0 end
		local target = PARAM[id]
		if c >= target then
			ma[agent] = -1
			return SUCCESS
		end
		local ch = FIRST[id]
		local s = TF[ch](ch, agent, dt)
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
	end

	local function t_cool(id, agent, dt)
		local m = SA[id]
		local t = m[agent] - dt
		m[agent] = t
		if t > 0 then return FAILURE end
		local ch = FIRST[id]
		local s = TF[ch](ch, agent, dt)
		if s ~= RUNNING then m[agent] = PARAM[id] end
		return s
	end

	local function t_tmo(id, agent, dt)
		local m = SA[id]
		local t = m[agent]
		local started = t ~= 0
		if not started then t = PARAM[id] end
		t -= dt
		local ch = FIRST[id]
		if t <= 0 then
			m[agent] = 0
			if started then HF[ch](ch, agent) end
			return FAILURE
		end
		m[agent] = t
		local s = TF[ch](ch, agent, dt)
		if s ~= RUNNING then m[agent] = 0 end
		return s
	end

	-- resolve one handler pair per node ---------------------------------------------------------
	local TICK_OF_KIND = {
		[K_LEAF] = t_leaf, [K_LEAFF] = t_leaff, [K_SEQ] = t_seq, [K_INV] = t_inv,
		[K_FB] = t_fb, [K_RSEQ] = t_rseq, [K_WAIT] = t_wait, [K_PAR] = t_par,
		[K_RFB] = t_rfb, [K_FSUCC] = t_fsucc, [K_FFAIL] = t_ffail, [K_REP] = t_rep,
		[K_COOL] = t_cool, [K_TMO] = t_tmo,
	}
	local HALT_OF_KIND = {
		[K_LEAF] = h_none, [K_LEAFF] = h_leaff, [K_SEQ] = h_cursor, [K_INV] = h_child,
		[K_FB] = h_cursor, [K_RSEQ] = h_cursor, [K_WAIT] = h_wait, [K_PAR] = h_par,
		[K_RFB] = h_cursor, [K_FSUCC] = h_child, [K_FFAIL] = h_child, [K_REP] = h_rep,
		[K_COOL] = h_child, [K_TMO] = h_tmo,
	}
	for id = 1, n do
		local k = KIND[id]
		TF[id] = TICK_OF_KIND[k]
		HF[id] = HALT_OF_KIND[k]
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
			if status[id] == RUNNING then HF[1](1, id) end
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
			local root = TF[1]
			for i = 1, nlive do
				local a = order[i]
				status[a] = root(1, a, dt)
			end
		end,
	}
end

return {
	name = "flat_dispatch_pernode",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick_all(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
