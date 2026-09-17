--!optimize 2
-- flat_batch: flat node arrays + node-major batch processing.
--
-- One handler per node KIND (not per node): proc[node](node, agents, n, dt). Every handler loops over
-- an array of agent ids, writes results into the shared status[agent] array and forwards filtered
-- agent lists to its children through preallocated per-node scratch arrays with explicit counts
-- (never `#`, never a per-tick allocation).
--
-- Node data is Struct-of-Arrays indexed by node id (kids[i], nc[i], param[i], sA[i], ...).
-- Per-agent node state is Struct-of-Maps: st[i][agent] holds the node's one live value and doubles as
-- the liveness flag (nil = idle). Extra per-agent maps only where a node needs a second field
-- (cooldown timer, parallel success/failure counters).
--
-- Halting is cursor driven: a parent halts a child for the agents that were live there but are not
-- forwarded this tick. There is no end-of-tick running-set sweep and no per-tick garbage.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local band, bor = bit32.band, bit32.bor
local next = next

local KIND_SEQ, KIND_FALL = 1, 2

local function new_world(spec)
	---------------------------------------------------------------------------------------------
	-- flat node arrays
	---------------------------------------------------------------------------------------------
	local proc, halth = {}, {} -- node -> batch tick / batch halt handler (shared per kind)
	local st = {} -- node -> { [agent] = live value }   (nil = idle)
	local kids, nc, k1 = {}, {}, {} -- children (composites), child count, single child (decorators)
	local param = {} -- node -> seconds / repeat count
	local sA, sB, sC = {}, {}, {} -- node -> scratch agent lists
	local bkt, bcn = {}, {} -- node -> per-child resume buckets + counts (Sequence / Fallback)
	local cdt = {} -- node -> { [agent] = cooldown time_left }
	local psc, pfc = {}, {} -- node -> parallel success / failure counters per agent
	local pso, pfo, psa, pfa = {}, {}, {}, {} -- parallel policies as booleans
	local lstart, ltick, lhalt = {}, {}, {} -- leaf hooks

	local status = {} -- shared result array: status[agent]
	local purge = {} -- every per-agent table, cleared on remove_agent

	---------------------------------------------------------------------------------------------
	-- halt handlers: halth[node](node, list, n) halts the node for every agent in list that is live
	---------------------------------------------------------------------------------------------
	local function halt_none() end

	local function halt_leaf(i, list, n)
		local s = st[i]
		if next(s) == nil then return end
		local h = lhalt[i]
		for k = 1, n do
			local a = list[k]
			if s[a] ~= nil then
				s[a] = nil
				h(a)
			end
		end
	end

	local function halt_state(i, list, n) -- Wait: state only, no hooks, no children
		local s = st[i]
		if next(s) == nil then return end
		for k = 1, n do s[list[k]] = nil end
	end

	local function halt_cursor(i, list, n) -- Sequence / Fallback: only the cursor child can be live
		local s = st[i]
		if next(s) == nil then return end
		local bk, bc = bkt[i], bcn[i]
		local used = 0
		for k = 1, n do
			local a = list[k]
			local c = s[a]
			if c ~= nil then
				s[a] = nil
				local m = bc[c] + 1
				bc[c] = m
				bk[c][m] = a
				used += 1
			end
		end
		if used == 0 then return end
		local kd = kids[i]
		for c = 1, nc[i] do
			local m = bc[c]
			if m > 0 then
				bc[c] = 0
				local ch = kd[c]
				halth[ch](ch, bk[c], m)
			end
		end
	end

	local function halt_multi(i, list, n) -- Reactive* / Parallel: any child may be live
		local s = st[i]
		if next(s) == nil then return end
		local w = sA[i]
		local m = 0
		for k = 1, n do
			local a = list[k]
			if s[a] ~= nil then
				s[a] = nil
				m += 1
				w[m] = a
			end
		end
		if m == 0 then return end
		local kd = kids[i]
		for c = 1, nc[i] do
			local ch = kd[c]
			halth[ch](ch, w, m)
		end
	end

	local function halt_pass(i, list, n) -- stateless decorators + Cooldown: forward
		local ch = k1[i]
		halth[ch](ch, list, n)
	end

	local function halt_one(i, list, n) -- Repeat / Timeout: clear state, forward the live ones
		local s = st[i]
		if next(s) == nil then return end
		local w = sA[i]
		local m = 0
		for k = 1, n do
			local a = list[k]
			if s[a] ~= nil then
				s[a] = nil
				m += 1
				w[m] = a
			end
		end
		if m == 0 then return end
		local ch = k1[i]
		halth[ch](ch, w, m)
	end

	---------------------------------------------------------------------------------------------
	-- tick handlers: proc[node](node, agents, n, dt)
	-- Every handler leaves status[agent] set for every agent in the list.
	-- Sequence / Fallback / Parallel-ONE never write status: the child's value is already theirs.
	---------------------------------------------------------------------------------------------
	local function proc_leaf_pure(i, agents, n, dt) -- on_tick only
		local f = ltick[i]
		for k = 1, n do
			local a = agents[k]
			status[a] = f(a, dt)
		end
	end

	local function proc_leaf_full(i, agents, n, dt) -- on_start (+ maybe on_halt)
		local s, f, fs = st[i], ltick[i], lstart[i]
		for k = 1, n do
			local a = agents[k]
			if s[a] == nil then
				s[a] = true
				fs(a)
			end
			local r = f(a, dt)
			status[a] = r
			if r ~= RUNNING then s[a] = nil end
		end
	end

	local function proc_leaf_halt(i, agents, n, dt) -- on_halt but no on_start: state only
		local s, f = st[i], ltick[i]
		for k = 1, n do
			local a = agents[k]
			local r = f(a, dt)
			status[a] = r
			if r ~= RUNNING then s[a] = nil else s[a] = true end
		end
	end

	local function proc_wait(i, agents, n, dt)
		local s = st[i]
		local secs = param[i]
		for k = 1, n do
			local a = agents[k]
			local t = s[a]
			if t == nil then t = secs end
			t -= dt
			if t <= 0 then
				s[a] = nil
				status[a] = SUCCESS
			else
				s[a] = t
				status[a] = RUNNING
			end
		end
	end

	-- Sequence: bucket the batch by cursor, then pipeline it through the children. Agents that fail
	-- or go RUNNING drop out; survivors carry on to the next child. status is already correct for
	-- every exit path (child status == sequence status), so nothing is written here.
	local function proc_seq(i, agents, n, dt)
		local s = st[i]
		local work, bk, bc = sA[i], bkt[i], bcn[i]
		local kd, C = kids[i], nc[i]
		local wn, resume = 0, 0
		for k = 1, n do
			local a = agents[k]
			local c = s[a]
			if c == nil then
				s[a] = 1
				wn += 1
				work[wn] = a
			elseif c == 1 then
				wn += 1
				work[wn] = a
			else
				local m = bc[c] + 1
				bc[c] = m
				bk[c][m] = a
				resume += 1
			end
		end
		for c = 1, C do
			if c > 1 then
				local m = bc[c]
				if m > 0 then
					bc[c] = 0
					local b = bk[c]
					for k = 1, m do
						wn += 1
						work[wn] = b[k]
					end
					resume -= m
				end
			end
			if wn > 0 then
				local ch = kd[c]
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local a = work[k]
					local r = status[a]
					if r == SUCCESS then
						j += 1
						work[j] = a
					elseif r == RUNNING then
						s[a] = c
					else
						s[a] = nil
					end
				end
				wn = j
			elseif resume == 0 then
				break
			end
		end
		for k = 1, wn do s[work[k]] = nil end -- ran off the end: SUCCESS, node idle
	end

	local function proc_fall(i, agents, n, dt)
		local s = st[i]
		local work, bk, bc = sA[i], bkt[i], bcn[i]
		local kd, C = kids[i], nc[i]
		local wn, resume = 0, 0
		for k = 1, n do
			local a = agents[k]
			local c = s[a]
			if c == nil then
				s[a] = 1
				wn += 1
				work[wn] = a
			elseif c == 1 then
				wn += 1
				work[wn] = a
			else
				local m = bc[c] + 1
				bc[c] = m
				bk[c][m] = a
				resume += 1
			end
		end
		for c = 1, C do
			if c > 1 then
				local m = bc[c]
				if m > 0 then
					bc[c] = 0
					local b = bk[c]
					for k = 1, m do
						wn += 1
						work[wn] = b[k]
					end
					resume -= m
				end
			end
			if wn > 0 then
				local ch = kd[c]
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local a = work[k]
					local r = status[a]
					if r == FAILURE then
						j += 1
						work[j] = a
					elseif r == RUNNING then
						s[a] = c
					else
						s[a] = nil
					end
				end
				wn = j
			elseif resume == 0 then
				break
			end
		end
		for k = 1, wn do s[work[k]] = nil end
	end

	-- Reactive: every agent restarts at child 1. Agents that drop out (FAILURE, or RUNNING at child c)
	-- must have the *later* children halted; children before the drop point returned SUCCESS this tick
	-- and are idle, so the accumulated drop list can be handed to every subsequent child unfiltered.
	local function proc_rseq(i, agents, n, dt)
		local s = st[i]
		local work, drop = sA[i], sB[i]
		local kd, C = kids[i], nc[i]
		local wn, dn = n, 0
		for k = 1, n do work[k] = agents[k] end
		for c = 1, C do
			local ch = kd[c]
			if dn > 0 then halth[ch](ch, drop, dn) end
			if wn > 0 then
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local a = work[k]
					local r = status[a]
					if r == SUCCESS then
						j += 1
						work[j] = a
					else
						dn += 1
						drop[dn] = a
						if r == RUNNING then s[a] = true else s[a] = nil end
					end
				end
				wn = j
			elseif dn == 0 then
				break
			end
		end
		for k = 1, wn do s[work[k]] = nil end
	end

	local function proc_rfall(i, agents, n, dt)
		local s = st[i]
		local work, drop = sA[i], sB[i]
		local kd, C = kids[i], nc[i]
		local wn, dn = n, 0
		for k = 1, n do work[k] = agents[k] end
		for c = 1, C do
			local ch = kd[c]
			if dn > 0 then halth[ch](ch, drop, dn) end
			if wn > 0 then
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local a = work[k]
					local r = status[a]
					if r == FAILURE then
						j += 1
						work[j] = a
					else
						dn += 1
						drop[dn] = a
						if r == RUNNING then s[a] = true else s[a] = nil end
					end
				end
				wn = j
			elseif dn == 0 then
				break
			end
		end
		for k = 1, wn do s[work[k]] = nil end
	end

	-- Parallel: st[i][agent] is the bitmask of children that already completed this run (0 is a valid
	-- live value), psc / pfc count them. An agent leaves under a ONE policy; its children are halted
	-- in one pass at the end (the child it left on is idle, so halting it is a no-op).
	local function proc_par(i, agents, n, dt)
		local s = st[i]
		local sc, fc = psc[i], pfc[i]
		local act, drop, sub = sA[i], sB[i], sC[i]
		local kd, C = kids[i], nc[i]
		local one_s, one_f = pso[i], pfo[i]
		for k = 1, n do
			local a = agents[k]
			if s[a] == nil then
				s[a] = 0
				sc[a] = 0
				fc[a] = 0
			end
			act[k] = a
		end
		local an, dn = n, 0
		local bit = 1
		for c = 1, C do
			local m, sn = 0, 0
			for k = 1, an do
				local a = act[k]
				local mask = s[a]
				if mask ~= nil then
					m += 1
					act[m] = a
					if band(mask, bit) == 0 then
						sn += 1
						sub[sn] = a
					end
				end
			end
			an = m
			if sn > 0 then
				local ch = kd[c]
				proc[ch](ch, sub, sn, dt)
				for k = 1, sn do
					local a = sub[k]
					local r = status[a]
					if r ~= RUNNING then
						if r == SUCCESS then
							sc[a] += 1
							if one_s then
								s[a] = nil
								dn += 1
								drop[dn] = a
							else
								s[a] = bor(s[a], bit)
							end
						else
							fc[a] += 1
							if one_f then
								s[a] = nil
								dn += 1
								drop[dn] = a
							else
								s[a] = bor(s[a], bit)
							end
						end
					end
				end
			end
			bit *= 2
		end
		local all_s, all_f = psa[i], pfa[i]
		for k = 1, an do
			local a = act[k]
			if s[a] ~= nil then
				if all_s and sc[a] == C then
					s[a] = nil
					status[a] = SUCCESS
				elseif all_f and fc[a] == C then
					s[a] = nil
					status[a] = FAILURE
				else
					status[a] = RUNNING
				end
			end
		end
		if dn > 0 then
			for c = 1, C do
				local ch = kd[c]
				halth[ch](ch, drop, dn)
			end
		end
	end

	-- IfThenElse: children = { condition, then, else? }. Not used by the harness scenarios; it is here
	-- as the worked example of "adding a node kind" from results/flat_batch.md (and it is checked
	-- against BTree.IfThenElse separately). st[i][agent] is the child the agent is parked on:
	-- 1 = evaluating the condition, 2 = running THEN, 3 = running ELSE. Halting is plain halt_cursor.
	local function proc_ite(i, agents, n, dt)
		local s = st[i]
		local bk, bc = bkt[i], bcn[i]
		local cond = sA[i]
		local kd, C = kids[i], nc[i]
		local cn = 0
		for k = 1, n do
			local a = agents[k]
			local c = s[a]
			if c == nil then
				s[a] = 1
				cn += 1
				cond[cn] = a
			elseif c == 1 then
				cn += 1
				cond[cn] = a
			else
				local m = bc[c] + 1
				bc[c] = m
				bk[c][m] = a
			end
		end
		if cn > 0 then
			local ch = kd[1]
			proc[ch](ch, cond, cn, dt)
			for k = 1, cn do
				local a = cond[k]
				local r = status[a]
				if r == SUCCESS then
					s[a] = 2
					local m = bc[2] + 1
					bc[2] = m
					bk[2][m] = a
				elseif r == FAILURE then
					if C == 3 then
						s[a] = 3
						local m = bc[3] + 1
						bc[3] = m
						bk[3][m] = a
					else
						s[a] = nil -- status is already FAILURE
					end
				end
				-- RUNNING: stays parked on the condition, status already RUNNING
			end
		end
		for x = 2, C do
			local m = bc[x]
			if m > 0 then
				bc[x] = 0
				local b = bk[x]
				local ch = kd[x]
				proc[ch](ch, b, m, dt)
				for k = 1, m do
					local a = b[k]
					if status[a] ~= RUNNING then s[a] = nil end
				end
			end
		end
	end

	local function proc_inv(i, agents, n, dt)
		local ch = k1[i]
		proc[ch](ch, agents, n, dt)
		for k = 1, n do
			local a = agents[k]
			local r = status[a]
			if r == SUCCESS then
				status[a] = FAILURE
			elseif r == FAILURE then
				status[a] = SUCCESS
			end
		end
	end

	local function proc_fsucc(i, agents, n, dt)
		local ch = k1[i]
		proc[ch](ch, agents, n, dt)
		for k = 1, n do
			local a = agents[k]
			if status[a] == FAILURE then status[a] = SUCCESS end
		end
	end

	local function proc_ffail(i, agents, n, dt)
		local ch = k1[i]
		proc[ch](ch, agents, n, dt)
		for k = 1, n do
			local a = agents[k]
			if status[a] == SUCCESS then status[a] = FAILURE end
		end
	end

	local function proc_repeat(i, agents, n, dt)
		local s = st[i]
		local target = param[i]
		for k = 1, n do
			local a = agents[k]
			if s[a] == nil then s[a] = 0 end
		end
		local ch = k1[i]
		proc[ch](ch, agents, n, dt)
		for k = 1, n do
			local a = agents[k]
			if status[a] ~= RUNNING then
				local c = s[a] + 1
				if c >= target then
					s[a] = nil
					status[a] = SUCCESS
				else
					s[a] = c
					status[a] = RUNNING
				end
			end
		end
	end

	local function proc_timeout(i, agents, n, dt)
		local s = st[i]
		local secs = param[i]
		local work, expired = sA[i], sB[i]
		local wn, en = 0, 0
		for k = 1, n do
			local a = agents[k]
			local t = s[a]
			if t == nil then t = secs end
			t -= dt
			if t <= 0 then
				s[a] = nil
				en += 1
				expired[en] = a
			else
				s[a] = t
				wn += 1
				work[wn] = a
			end
		end
		local ch = k1[i]
		if en > 0 then
			halth[ch](ch, expired, en)
			for k = 1, en do status[expired[k]] = FAILURE end
		end
		if wn > 0 then
			proc[ch](ch, work, wn, dt)
			for k = 1, wn do
				local a = work[k]
				if status[a] ~= RUNNING then s[a] = nil end
			end
		end
	end

	-- Cooldown: the timer persists across runs and is only decremented on ticks the node is visited.
	-- It holds no liveness flag of its own (live == child live), so halts are forwarded straight down.
	local function proc_cooldown(i, agents, n, dt)
		local timer = cdt[i]
		local secs = param[i]
		local work = sA[i]
		local wn = 0
		for k = 1, n do
			local a = agents[k]
			local t = timer[a]
			if t == nil then t = 0 end
			t -= dt
			timer[a] = t
			if t > 0 then
				status[a] = FAILURE
			else
				wn += 1
				work[wn] = a
			end
		end
		if wn > 0 then
			local ch = k1[i]
			proc[ch](ch, work, wn, dt)
			for k = 1, wn do
				local a = work[k]
				if status[a] ~= RUNNING then timer[a] = secs end
			end
		end
	end

	---------------------------------------------------------------------------------------------
	-- build: spec tree -> flat arrays
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
			proc[i] = kind == "Sequence" and proc_seq or proc_fall
			halth[i] = halt_cursor
			sA[i] = {}
			local kd, bk, bc = {}, {}, {}
			for c, cs in sp.children do
				kd[c] = build(cs)
				bk[c] = {}
				bc[c] = 0
			end
			kids[i], nc[i], bkt[i], bcn[i] = kd, #kd, bk, bc
		elseif kind == "ReactiveSequence" or kind == "ReactiveFallback" then
			proc[i] = kind == "ReactiveSequence" and proc_rseq or proc_rfall
			halth[i] = halt_multi
			sA[i], sB[i] = {}, {}
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "Parallel" then
			proc[i] = proc_par
			halth[i] = halt_multi
			sA[i], sB[i], sC[i] = {}, {}, {}
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
			if nc[i] > 32 then error("flat_batch: Parallel is limited to 32 children (bitmask)") end
		elseif kind == "IfThenElse" then
			proc[i] = proc_ite
			halth[i] = halt_cursor
			sA[i] = {}
			local kd, bk, bc = {}, {}, {}
			for c, cs in sp.children do
				kd[c] = build(cs)
				bk[c] = {}
				bc[c] = 0
			end
			kids[i], nc[i], bkt[i], bcn[i] = kd, #kd, bk, bc
			if nc[i] < 2 or nc[i] > 3 then error("flat_batch: IfThenElse needs 2 or 3 children") end
		elseif kind == "Inverter" or kind == "ForceSuccess" or kind == "ForceFailure" then
			proc[i] = kind == "Inverter" and proc_inv or (kind == "ForceSuccess" and proc_fsucc or proc_ffail)
			halth[i] = halt_pass
			k1[i] = build(sp.child)
		elseif kind == "Repeat" then
			proc[i] = proc_repeat
			halth[i] = halt_one
			sA[i] = {}
			param[i] = sp.count
			k1[i] = build(sp.child)
		elseif kind == "Timeout" then
			proc[i] = proc_timeout
			halth[i] = halt_one
			sA[i], sB[i] = {}, {}
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Cooldown" then
			proc[i] = proc_cooldown
			halth[i] = halt_pass
			sA[i] = {}
			cdt[i] = {}
			purge[#purge + 1] = cdt[i]
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Wait" then
			proc[i] = proc_wait
			halth[i] = halt_state
			param[i] = sp.seconds
		elseif kind == "Leaf" then
			ltick[i] = sp.on_tick
			lstart[i] = sp.on_start
			lhalt[i] = sp.on_halt
			if sp.on_start then
				proc[i] = proc_leaf_full
				halth[i] = sp.on_halt and halt_leaf or halt_state
			elseif sp.on_halt then
				proc[i] = proc_leaf_halt
				halth[i] = halt_leaf
			else
				proc[i] = proc_leaf_pure -- no hooks: no per-agent state, nothing to halt
				halth[i] = halt_none
			end
		else
			error("flat_batch: unknown kind " .. tostring(kind))
		end
		return i
	end

	local root = build(spec)

	---------------------------------------------------------------------------------------------
	-- world
	---------------------------------------------------------------------------------------------
	local agents, slot, n_agents = {}, {}, 0
	local one = { 0 }
	local root_proc, root_halt = proc[root], halth[root]

	local w
	w = {
		status = status,
		add = function(id)
			n_agents += 1
			agents[n_agents] = id
			slot[id] = n_agents
		end,
		remove = function(id)
			one[1] = id
			root_halt(root, one, 1)
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
			if n_agents > 0 then root_proc(root, agents, n_agents, dt) end
		end,
		node_count = n_nodes,
	}
	return w
end

return {
	name = "flat_batch",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
