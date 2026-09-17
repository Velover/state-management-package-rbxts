--!optimize 2
-- flat_batch_worklist (variant e2 of flat_batch): level-synchronous batch processing.
--
-- Same flat node arrays and same per-agent Struct-of-Maps state as flat_batch, but no recursion:
-- every node has an inbox (agents pushed down by its parent) and an out list (agents whose status is
-- final this tick). A tick is a fixpoint loop over two sweeps in node id order (ids are assigned in
-- preorder, so a subtree is a contiguous id range and "parent before child" == "lower id"):
--
--   push-down (ids ascending):  every node with a non-empty inbox distributes it to its children;
--                               leaves compute status[agent] here. One ascending pass reaches the
--                               whole active front because a child's id is always higher.
--   pull-up  (ids descending):  every pending node consumes its children's out lists, resolves what
--                               it can, and pushes any continuation (Sequence child c -> c+1, the
--                               Parallel's next child, ...) into that child's inbox -- which the
--                               descending pass has already gone past, so it is picked up by the
--                               NEXT round. A tick costs 1 + (number of child advances) rounds.
--
-- Three things this variant had to grow, all of them reported in results/flat_batch.md:
--  * a parent must stay pending while agents are still in flight below it (nfl[i]), otherwise a
--    child that needs several rounds silently loses its batch. A single push/pull pass pair is not
--    enough for anything but a tree of leaves.
--  * Parallel cannot push all children in one round: siblings would overwrite the same status[agent]
--    slot before the parent reads it. It walks one child per round, like a Reactive node.
--  * the sweeps are bounded to the live id range (ilo..ihi / plo..phi); a full-tree sweep per round
--    costs more than the traversal it replaces.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local band, bor, lshift = bit32.band, bit32.bor, bit32.lshift
local next = next

local function new_world(spec)
	local pushf, pullf, halth = {}, {}, {}
	local st = {}
	local kids, nc, k1 = {}, {}, {}
	local param = {}
	local inb, icn = {}, {} -- inbox list / count
	local out, ocn = {}, {} -- resolved list / count (consumed by the parent's pull)
	local snt, scn = {}, {} -- the batch a Parallel handed out (needed to finalise policies)
	local nfl = {} -- agents in flight below this node
	local pend = {} -- node wants a pull this round
	local sB = {} -- scratch (drop / filter lists)
	local cdt = {}
	local psc, pfc, pso, pfo, psa, pfa, pcur = {}, {}, {}, {}, {}, {}, {}
	local rfall = {} -- ReactiveFallback?
	local lstart, ltick, lhalt = {}, {}, {}

	local status = {}
	local purge = {}

	local n_nodes = 0
	local ilo, ihi = math.huge, 0 -- id range with pending inboxes
	local plo, phi = math.huge, 0 -- id range with pending pulls
	local dlo, dhi = math.huge, 0 -- inboxes deferred to the next round (Parallel already busy)

	local function mark_pend(i)
		pend[i] = true
		if i < plo then plo = i end
		if i > phi then phi = i end
	end

	local function push_to(kid, list, n)
		local box, m = inb[kid], icn[kid]
		for k = 1, n do
			m += 1
			box[m] = list[k]
		end
		icn[kid] = m
		if kid < ilo then ilo = kid end
		if kid > ihi then ihi = kid end
	end

	---------------------------------------------------------------------------------------------
	-- halting: identical to flat_batch (immediate, recursive, batched)
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

	local function halt_state(i, list, n)
		local s = st[i]
		if next(s) == nil then return end
		for k = 1, n do s[list[k]] = nil end
	end

	local function halt_multi(i, list, n)
		local s = st[i]
		if next(s) == nil then return end
		local w = sB[i]
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

	local function halt_pass(i, list, n)
		local ch = k1[i]
		halth[ch](ch, list, n)
	end

	local function halt_one(i, list, n)
		local s = st[i]
		if next(s) == nil then return end
		local w = sB[i]
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
	-- push handlers (parent -> children). Leaves and Wait resolve here.
	---------------------------------------------------------------------------------------------
	local function push_leaf_pure(i, dt)
		local box, n = inb[i], icn[i]
		local f = ltick[i]
		for k = 1, n do
			local a = box[k]
			status[a] = f(a, dt)
		end
		icn[i] = 0
		out[i], ocn[i] = box, n
	end

	local function push_leaf_full(i, dt)
		local box, n = inb[i], icn[i]
		local s, f, fs = st[i], ltick[i], lstart[i]
		for k = 1, n do
			local a = box[k]
			if s[a] == nil then
				s[a] = true
				fs(a)
			end
			local r = f(a, dt)
			status[a] = r
			if r ~= RUNNING then s[a] = nil end
		end
		icn[i] = 0
		out[i], ocn[i] = box, n
	end

	local function push_leaf_halt(i, dt)
		local box, n = inb[i], icn[i]
		local s, f = st[i], ltick[i]
		for k = 1, n do
			local a = box[k]
			local r = f(a, dt)
			status[a] = r
			if r ~= RUNNING then s[a] = nil else s[a] = true end
		end
		icn[i] = 0
		out[i], ocn[i] = box, n
	end

	local function push_wait(i, dt)
		local box, n = inb[i], icn[i]
		local s, secs = st[i], param[i]
		for k = 1, n do
			local a = box[k]
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
		icn[i] = 0
		out[i], ocn[i] = box, n
	end

	-- Sequence / Fallback: resumers go straight to their cursor child, so several children of the
	-- same node can be pushed in one round (different agents, so no status aliasing).
	local function push_cursor(i, dt)
		local box, n = inb[i], icn[i]
		local s, kd = st[i], kids[i]
		for k = 1, n do
			local a = box[k]
			local c = s[a]
			if c == nil then
				c = 1
				s[a] = 1
			end
			local kid = kd[c]
			local m = icn[kid] + 1
			icn[kid] = m
			inb[kid][m] = a
			if kid < ilo then ilo = kid end
			if kid > ihi then ihi = kid end
		end
		icn[i] = 0
		nfl[i] += n
		mark_pend(i)
	end

	local function push_reactive(i, dt)
		local box, n = inb[i], icn[i]
		icn[i] = 0
		nfl[i] += n
		push_to(kids[i][1], box, n)
		mark_pend(i)
	end

	local function push_parallel(i, dt)
		-- A node can be pushed to twice in one tick (a Sequence hands its resumers to child c in
		-- round 1 and the agents advancing from child c-1 later). Every other node kind is purely
		-- per-agent and copes; a Parallel walks its children per *wave*, so a second wave has to
		-- wait in the inbox until the first one is finished.
		if scn[i] > 0 then
			if i < dlo then dlo = i end
			if i > dhi then dhi = i end
			return
		end
		local box, n = inb[i], icn[i]
		local s, sc, fc = st[i], psc[i], pfc[i]
		local sent = snt[i]
		for k = 1, n do
			local a = box[k]
			if s[a] == nil then
				s[a] = 0
				sc[a] = 0
				fc[a] = 0
			end
			sent[k] = a
		end
		scn[i] = n
		icn[i] = 0
		pcur[i] = 1
		nfl[i] += n
		push_to(kids[i][1], sent, n)
		mark_pend(i)
	end

	local function push_fwd(i, dt) -- stateless decorators
		local box, n = inb[i], icn[i]
		icn[i] = 0
		nfl[i] += n
		push_to(k1[i], box, n)
		mark_pend(i)
	end

	local function push_repeat(i, dt)
		local box, n = inb[i], icn[i]
		local s = st[i]
		for k = 1, n do
			local a = box[k]
			if s[a] == nil then s[a] = 0 end
		end
		icn[i] = 0
		nfl[i] += n
		push_to(k1[i], box, n)
		mark_pend(i)
	end

	local function push_timeout(i, dt)
		local box, n = inb[i], icn[i]
		local s, secs = st[i], param[i]
		local sent, o = snt[i], out[i]
		local wn, en = 0, ocn[i]
		local drop = sB[i]
		local dn = 0
		for k = 1, n do
			local a = box[k]
			local t = s[a]
			if t == nil then t = secs end
			t -= dt
			if t <= 0 then
				s[a] = nil
				dn += 1
				drop[dn] = a
				status[a] = FAILURE
				en += 1
				o[en] = a
			else
				s[a] = t
				wn += 1
				sent[wn] = a
			end
		end
		icn[i] = 0
		ocn[i] = en
		local ch = k1[i]
		if dn > 0 then halth[ch](ch, drop, dn) end
		if wn > 0 then
			nfl[i] += wn
			push_to(ch, sent, wn)
		end
		mark_pend(i)
	end

	local function push_cooldown(i, dt)
		local box, n = inb[i], icn[i]
		local timer = cdt[i]
		local sent, o = snt[i], out[i]
		local wn, en = 0, ocn[i]
		for k = 1, n do
			local a = box[k]
			local t = timer[a]
			if t == nil then t = 0 end
			t -= dt
			timer[a] = t
			if t > 0 then
				status[a] = FAILURE
				en += 1
				o[en] = a
			else
				wn += 1
				sent[wn] = a
			end
		end
		icn[i] = 0
		ocn[i] = en
		if wn > 0 then
			nfl[i] += wn
			push_to(k1[i], sent, wn)
		end
		mark_pend(i)
	end

	---------------------------------------------------------------------------------------------
	-- pull handlers (children -> parent). A node stays pending while nfl[i] > 0.
	---------------------------------------------------------------------------------------------
	local function pull_seq(i, dt)
		local s, kd, C = st[i], kids[i], nc[i]
		local o, on = out[i], ocn[i]
		local fl = nfl[i]
		-- descending: child c+1's out is consumed before we write its inbox for the next round
		-- (a leaf's out list IS its inbox array, so the other order corrupts it).
		for c = C, 1, -1 do
			local kid = kd[c]
			local m = ocn[kid]
			if m > 0 then
				ocn[kid] = 0
				fl -= m
				local ko = out[kid]
				if c < C then
					local kid2 = kd[c + 1]
					local box2, q = inb[kid2], icn[kid2]
					local q0 = q
					for k = 1, m do
						local a = ko[k]
						local r = status[a]
						if r == SUCCESS then
							s[a] = c + 1
							q += 1
							box2[q] = a
						else
							if r == RUNNING then s[a] = c else s[a] = nil end
							on += 1
							o[on] = a
						end
					end
					if q > q0 then
						icn[kid2] = q
						fl += q - q0
						if kid2 < ilo then ilo = kid2 end
						if kid2 > ihi then ihi = kid2 end
					end
				else
					for k = 1, m do
						local a = ko[k]
						local r = status[a]
						if r == RUNNING then s[a] = c else s[a] = nil end
						on += 1
						o[on] = a
					end
				end
			end
		end
		ocn[i] = on
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_fall(i, dt)
		local s, kd, C = st[i], kids[i], nc[i]
		local o, on = out[i], ocn[i]
		local fl = nfl[i]
		-- descending: child c+1's out is consumed before we write its inbox for the next round
		-- (a leaf's out list IS its inbox array, so the other order corrupts it).
		for c = C, 1, -1 do
			local kid = kd[c]
			local m = ocn[kid]
			if m > 0 then
				ocn[kid] = 0
				fl -= m
				local ko = out[kid]
				if c < C then
					local kid2 = kd[c + 1]
					local box2, q = inb[kid2], icn[kid2]
					local q0 = q
					for k = 1, m do
						local a = ko[k]
						local r = status[a]
						if r == FAILURE then
							s[a] = c + 1
							q += 1
							box2[q] = a
						else
							if r == RUNNING then s[a] = c else s[a] = nil end
							on += 1
							o[on] = a
						end
					end
					if q > q0 then
						icn[kid2] = q
						fl += q - q0
						if kid2 < ilo then ilo = kid2 end
						if kid2 > ihi then ihi = kid2 end
					end
				else
					for k = 1, m do
						local a = ko[k]
						local r = status[a]
						if r == RUNNING then s[a] = c else s[a] = nil end
						on += 1
						o[on] = a
					end
				end
			end
		end
		ocn[i] = on
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_reactive(i, dt)
		local s, kd, C = st[i], kids[i], nc[i]
		local o, on = out[i], ocn[i]
		local drop = sB[i]
		local adv = rfall[i] and FAILURE or SUCCESS
		local fl = nfl[i]
		-- descending: child c+1's out is consumed before we write its inbox for the next round
		-- (a leaf's out list IS its inbox array, so the other order corrupts it).
		for c = C, 1, -1 do
			local kid = kd[c]
			local m = ocn[kid]
			if m > 0 then
				ocn[kid] = 0
				fl -= m
				local ko = out[kid]
				local dn = 0
				local kid2 = c < C and kd[c + 1] or nil
				local box2, q, q0
				if kid2 then
					box2 = inb[kid2]
					q = icn[kid2]
					q0 = q
				end
				for k = 1, m do
					local a = ko[k]
					local r = status[a]
					if r == adv then
						if kid2 then
							q += 1
							box2[q] = a
						else
							s[a] = nil
							on += 1
							o[on] = a
						end
					else
						if r == RUNNING then s[a] = true else s[a] = nil end
						dn += 1
						drop[dn] = a
						on += 1
						o[on] = a
					end
				end
				if kid2 and q > q0 then
					icn[kid2] = q
					fl += q - q0
					if kid2 < ilo then ilo = kid2 end
					if kid2 > ihi then ihi = kid2 end
				end
				if dn > 0 then
					for c2 = c + 1, C do
						local ch = kd[c2]
						halth[ch](ch, drop, dn)
					end
				end
			end
		end
		ocn[i] = on
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_parallel(i, dt)
		local s, kd, C = st[i], kids[i], nc[i]
		local sc, fc = psc[i], pfc[i]
		local one_s, one_f = pso[i], pfo[i]
		local c = pcur[i]
		local kid = kd[c]
		local m = ocn[kid]
		local fl = nfl[i] - m
		local drop = sB[i]
		local dn = 0
		if m > 0 then
			ocn[kid] = 0
			local ko = out[kid]
			local bit = lshift(1, c - 1)
			for k = 1, m do
				local a = ko[k]
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
		if fl > 0 then -- this child has not resolved every agent yet: wait for it
			nfl[i] = fl
			mark_pend(i)
		else
			local sent, sn = snt[i], scn[i]
			-- advance to the next child that still has work
			local q = 0
			while c < C and q == 0 do
				c += 1
				local kid2 = kd[c]
				local nbit = lshift(1, c - 1)
				local box2 = inb[kid2]
				local base = icn[kid2]
				q = 0
				for k = 1, sn do
					local a = sent[k]
					local mask = s[a]
					if mask ~= nil and band(mask, nbit) == 0 then
						q += 1
						box2[base + q] = a
					end
				end
				if q > 0 then
					icn[kid2] = base + q
					if kid2 < ilo then ilo = kid2 end
					if kid2 > ihi then ihi = kid2 end
				end
			end
			pcur[i] = c
			nfl[i] = q
			if q > 0 then
				mark_pend(i)
			else
				-- every child has reported: apply the policies
				local o, on = out[i], ocn[i]
				local all_s, all_f = psa[i], pfa[i]
				for k = 1, sn do
					local a = sent[k]
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
					on += 1
					o[on] = a
				end
				ocn[i] = on
				scn[i] = 0
			end
		end
		if dn > 0 then
			for c2 = 1, C do
				local ch = kd[c2]
				halth[ch](ch, drop, dn)
			end
		end
	end

	local function pull_inv(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
			local r = status[a]
			if r == SUCCESS then
				status[a] = FAILURE
			elseif r == FAILURE then
				status[a] = SUCCESS
			end
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_fsucc(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
			if status[a] == FAILURE then status[a] = SUCCESS end
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_ffail(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
			if status[a] == SUCCESS then status[a] = FAILURE end
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_repeat(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local s, target = st[i], param[i]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
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
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_timeout(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local s = st[i]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
			if status[a] ~= RUNNING then s[a] = nil end
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	local function pull_cooldown(i, dt)
		local kid = k1[i]
		local m = ocn[kid]
		ocn[kid] = 0
		local ko = out[kid]
		local timer, secs = cdt[i], param[i]
		local o, on = out[i], ocn[i]
		for k = 1, m do
			local a = ko[k]
			if status[a] ~= RUNNING then timer[a] = secs end
			on += 1
			o[on] = a
		end
		ocn[i] = on
		local fl = nfl[i] - m
		nfl[i] = fl
		if fl > 0 then mark_pend(i) end
	end

	---------------------------------------------------------------------------------------------
	-- build (ids are handed out in preorder: a subtree is a contiguous id range)
	---------------------------------------------------------------------------------------------
	local function new_node()
		n_nodes += 1
		local i = n_nodes
		st[i] = {}
		purge[#purge + 1] = st[i]
		inb[i], icn[i] = {}, 0
		out[i], ocn[i] = {}, 0
		snt[i], scn[i] = {}, 0
		nfl[i] = 0
		pend[i] = false
		return i
	end

	local function build(sp)
		local kind = sp.kind
		local i = new_node()
		if kind == "Sequence" or kind == "Fallback" then
			pushf[i] = push_cursor
			pullf[i] = kind == "Sequence" and pull_seq or pull_fall
			halth[i] = halt_multi -- only the cursor child can be live; the others no-op
			sB[i] = {}
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "ReactiveSequence" or kind == "ReactiveFallback" then
			pushf[i] = push_reactive
			pullf[i] = pull_reactive
			halth[i] = halt_multi
			rfall[i] = kind == "ReactiveFallback"
			sB[i] = {}
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "Parallel" then
			pushf[i] = push_parallel
			pullf[i] = pull_parallel
			halth[i] = halt_multi
			sB[i] = {}
			psc[i], pfc[i] = {}, {}
			purge[#purge + 1] = psc[i]
			purge[#purge + 1] = pfc[i]
			pso[i] = sp.success_policy == "ONE"
			pfo[i] = sp.failure_policy == "ONE"
			psa[i] = not pso[i]
			pfa[i] = not pfo[i]
			pcur[i] = 1
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
		elseif kind == "Inverter" or kind == "ForceSuccess" or kind == "ForceFailure" then
			pushf[i] = push_fwd
			pullf[i] = kind == "Inverter" and pull_inv or (kind == "ForceSuccess" and pull_fsucc or pull_ffail)
			halth[i] = halt_pass
			k1[i] = build(sp.child)
		elseif kind == "Repeat" then
			pushf[i] = push_repeat
			pullf[i] = pull_repeat
			halth[i] = halt_one
			sB[i] = {}
			param[i] = sp.count
			k1[i] = build(sp.child)
		elseif kind == "Timeout" then
			pushf[i] = push_timeout
			pullf[i] = pull_timeout
			halth[i] = halt_one
			sB[i] = {}
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Cooldown" then
			pushf[i] = push_cooldown
			pullf[i] = pull_cooldown
			halth[i] = halt_pass
			cdt[i] = {}
			purge[#purge + 1] = cdt[i]
			param[i] = sp.seconds
			k1[i] = build(sp.child)
		elseif kind == "Wait" then
			pushf[i] = push_wait
			halth[i] = halt_state
			param[i] = sp.seconds
		elseif kind == "Leaf" then
			ltick[i] = sp.on_tick
			lstart[i] = sp.on_start
			lhalt[i] = sp.on_halt
			if sp.on_start then
				pushf[i] = push_leaf_full
				halth[i] = sp.on_halt and halt_leaf or halt_state
			elseif sp.on_halt then
				pushf[i] = push_leaf_halt
				halth[i] = halt_leaf
			else
				pushf[i] = push_leaf_pure
				halth[i] = halt_none
			end
		else
			error("flat_batch_worklist: unknown kind " .. tostring(kind))
		end
		return i
	end

	local root = build(spec)

	---------------------------------------------------------------------------------------------
	-- world
	---------------------------------------------------------------------------------------------
	local agents, slot, n_agents = {}, {}, 0
	local one = { 0 }
	local total_rounds, total_ticks = 0, 0

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
			halth[root](root, one, 1)
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
			if n_agents == 0 then return end
			local box = inb[root]
			for k = 1, n_agents do box[k] = agents[k] end
			icn[root] = n_agents
			ilo, ihi = root, root
			plo, phi = math.huge, 0
			dlo, dhi = math.huge, 0
			local guard = 0
			repeat
				ocn[root] = 0
				local i = ilo
				while i <= ihi do
					if icn[i] > 0 then pushf[i](i, dt) end
					i += 1
				end
				ilo, ihi = dlo, dhi -- pushes from here on belong to the next round
				dlo, dhi = math.huge, 0
				local a, b = plo, phi
				plo, phi = math.huge, 0
				for j = b, a, -1 do
					if pend[j] then
						pend[j] = false
						pullf[j](j, dt)
					end
				end
				guard += 1
				total_rounds += 1
				if guard > 512 then error("flat_batch_worklist: round loop made no progress") end
			until ilo > ihi and plo > phi
			ocn[root] = 0
			total_ticks += 1
		end,
		node_count = n_nodes,
		stats = function() return total_rounds, total_ticks end,
	}
	return w
end

return {
	name = "flat_batch_worklist",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick(dt) end,
	get_status = function(w, id) return w.status[id] end,
}
