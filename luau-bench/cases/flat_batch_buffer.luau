--!optimize 2
-- flat_batch_buffer (variant e3 of flat_batch): the same recursive batch handlers, but every piece of
-- per-agent state lives in `buffer`s indexed by a dense slot instead of Struct-of-Maps keyed by agent id.
--
--   slot_of[id] -> slot   (hash map, the one lookup we cannot avoid: ids are caller chosen)
--   id_of[slot] -> id     (array, needed because leaf hooks take the agent id)
--   free[]                 free slot stack, so removed agents' slots are reused
--   V  f64 buffer, one "row" of `cap` slots per stateful node (+ extra rows for Cooldown timers and
--      the two Parallel counters). 0 means "idle": cursors are >= 1, live timers are > 0, leaf liveness
--      is 1, Repeat stores count+1 and Parallel stores mask+1, so one row doubles as the liveness flag.
--   ST u8 buffer, the shared status array.
--
-- Everything the SoM version gets for free has to be hand managed here, and the file says where:
-- growth (realloc + row-by-row copy, and every row offset changes), slot recycling, zeroing a freed
-- slot, and a live counter per node to replace `next(t) == nil` as the "nothing is running here" test.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local band, bor = bit32.band, bit32.bor
local readf64, writef64 = buffer.readf64, buffer.writef64
local readu8, writeu8 = buffer.readu8, buffer.writeu8

local function new_world(spec)
	local proc, halth = {}, {}
	local rowof = {} -- node -> byte offset of its state row in V
	local lc = {} -- node -> number of slots for which it is live
	local kids, nc, k1 = {}, {}, {}
	local param = {}
	local sA, sB, sC = {}, {}, {}
	local bkt, bcn = {}, {}
	local cdof, scof, fcof = {}, {}, {} -- extra rows
	local pso, pfo, psa, pfa = {}, {}, {}, {}
	local lstart, ltick, lhalt = {}, {}, {}

	local cap = 16 -- slots
	local n_rows = 0
	local rows = {} -- row index -> byte offset (recomputed on growth)
	local V = buffer.create(1)
	local ST = buffer.create(cap + 1)
	local id_of = {}
	local slot_of = {}
	local free, n_free = {}, 0
	local n_used = 0

	local function alloc_row()
		n_rows += 1
		return n_rows
	end

	---------------------------------------------------------------------------------------------
	-- halt handlers
	---------------------------------------------------------------------------------------------
	local function halt_none() end

	local function halt_leaf(i, list, n)
		if lc[i] == 0 then return end
		local o, h = rowof[i], lhalt[i]
		local c = lc[i]
		for k = 1, n do
			local sl = list[k]
			local p = o + sl * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				c -= 1
				h(id_of[sl])
			end
		end
		lc[i] = c
	end

	local function halt_state(i, list, n)
		if lc[i] == 0 then return end
		local o = rowof[i]
		local c = lc[i]
		for k = 1, n do
			local p = o + list[k] * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				c -= 1
			end
		end
		lc[i] = c
	end

	local function halt_cursor(i, list, n) -- Sequence / Fallback: only the cursor child is live
		if lc[i] == 0 then return end
		local o = rowof[i]
		local bk, bc = bkt[i], bcn[i]
		local used = 0
		local c = lc[i]
		for k = 1, n do
			local sl = list[k]
			local p = o + sl * 8
			local cur = readf64(V, p)
			if cur ~= 0 then
				writef64(V, p, 0)
				c -= 1
				local m = bc[cur] + 1
				bc[cur] = m
				bk[cur][m] = sl
				used += 1
			end
		end
		lc[i] = c
		if used == 0 then return end
		local kd = kids[i]
		for x = 1, nc[i] do
			local m = bc[x]
			if m > 0 then
				bc[x] = 0
				local ch = kd[x]
				halth[ch](ch, bk[x], m)
			end
		end
	end

	local function halt_multi(i, list, n) -- Reactive / Parallel
		if lc[i] == 0 then return end
		local o = rowof[i]
		local w = sA[i]
		local m = 0
		local c = lc[i]
		for k = 1, n do
			local sl = list[k]
			local p = o + sl * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				c -= 1
				m += 1
				w[m] = sl
			end
		end
		lc[i] = c
		if m == 0 then return end
		local kd = kids[i]
		for x = 1, nc[i] do
			local ch = kd[x]
			halth[ch](ch, w, m)
		end
	end

	local function halt_pass(i, list, n)
		local ch = k1[i]
		halth[ch](ch, list, n)
	end

	local function halt_one(i, list, n) -- Repeat / Timeout
		if lc[i] == 0 then return end
		local o = rowof[i]
		local w = sA[i]
		local m = 0
		local c = lc[i]
		for k = 1, n do
			local sl = list[k]
			local p = o + sl * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				c -= 1
				m += 1
				w[m] = sl
			end
		end
		lc[i] = c
		if m == 0 then return end
		local ch = k1[i]
		halth[ch](ch, w, m)
	end

	---------------------------------------------------------------------------------------------
	-- tick handlers
	---------------------------------------------------------------------------------------------
	local function proc_leaf_pure(i, slots, n, dt)
		local f = ltick[i]
		for k = 1, n do
			local sl = slots[k]
			writeu8(ST, sl, f(id_of[sl], dt))
		end
	end

	local function proc_leaf_full(i, slots, n, dt)
		local o, f, fs = rowof[i], ltick[i], lstart[i]
		local c = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local a = id_of[sl]
			local p = o + sl * 8
			if readf64(V, p) == 0 then
				writef64(V, p, 1)
				c += 1
				fs(a)
			end
			local r = f(a, dt)
			writeu8(ST, sl, r)
			if r ~= RUNNING then
				writef64(V, p, 0)
				c -= 1
			end
		end
		lc[i] = c
	end

	local function proc_leaf_halt(i, slots, n, dt)
		local o, f = rowof[i], ltick[i]
		local c = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			local r = f(id_of[sl], dt)
			writeu8(ST, sl, r)
			local was = readf64(V, p)
			if r ~= RUNNING then
				if was ~= 0 then
					writef64(V, p, 0)
					c -= 1
				end
			elseif was == 0 then
				writef64(V, p, 1)
				c += 1
			end
		end
		lc[i] = c
	end

	local function proc_wait(i, slots, n, dt)
		local o, secs = rowof[i], param[i]
		local c = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			local t = readf64(V, p)
			if t == 0 then
				t = secs
				c += 1
			end
			t -= dt
			if t <= 0 then
				writef64(V, p, 0)
				c -= 1
				writeu8(ST, sl, SUCCESS)
			else
				writef64(V, p, t)
				writeu8(ST, sl, RUNNING)
			end
		end
		lc[i] = c
	end

	local function proc_seq(i, slots, n, dt)
		local o = rowof[i]
		local work, bk, bc = sA[i], bkt[i], bcn[i]
		local kd, C = kids[i], nc[i]
		local wn, resume = 0, 0
		local live = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local cur = readf64(V, o + sl * 8)
			if cur == 0 then
				writef64(V, o + sl * 8, 1)
				live += 1
				wn += 1
				work[wn] = sl
			elseif cur == 1 then
				wn += 1
				work[wn] = sl
			else
				local m = bc[cur] + 1
				bc[cur] = m
				bk[cur][m] = sl
				resume += 1
			end
		end
		for x = 1, C do
			if x > 1 then
				local m = bc[x]
				if m > 0 then
					bc[x] = 0
					local b = bk[x]
					for k = 1, m do
						wn += 1
						work[wn] = b[k]
					end
					resume -= m
				end
			end
			if wn > 0 then
				local ch = kd[x]
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local sl = work[k]
					local r = readu8(ST, sl)
					if r == SUCCESS then
						j += 1
						work[j] = sl
					elseif r == RUNNING then
						writef64(V, o + sl * 8, x)
					else
						writef64(V, o + sl * 8, 0)
						live -= 1
					end
				end
				wn = j
			elseif resume == 0 then
				break
			end
		end
		for k = 1, wn do
			writef64(V, o + work[k] * 8, 0)
			live -= 1
		end
		lc[i] = live
	end

	local function proc_fall(i, slots, n, dt)
		local o = rowof[i]
		local work, bk, bc = sA[i], bkt[i], bcn[i]
		local kd, C = kids[i], nc[i]
		local wn, resume = 0, 0
		local live = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local cur = readf64(V, o + sl * 8)
			if cur == 0 then
				writef64(V, o + sl * 8, 1)
				live += 1
				wn += 1
				work[wn] = sl
			elseif cur == 1 then
				wn += 1
				work[wn] = sl
			else
				local m = bc[cur] + 1
				bc[cur] = m
				bk[cur][m] = sl
				resume += 1
			end
		end
		for x = 1, C do
			if x > 1 then
				local m = bc[x]
				if m > 0 then
					bc[x] = 0
					local b = bk[x]
					for k = 1, m do
						wn += 1
						work[wn] = b[k]
					end
					resume -= m
				end
			end
			if wn > 0 then
				local ch = kd[x]
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local sl = work[k]
					local r = readu8(ST, sl)
					if r == FAILURE then
						j += 1
						work[j] = sl
					elseif r == RUNNING then
						writef64(V, o + sl * 8, x)
					else
						writef64(V, o + sl * 8, 0)
						live -= 1
					end
				end
				wn = j
			elseif resume == 0 then
				break
			end
		end
		for k = 1, wn do
			writef64(V, o + work[k] * 8, 0)
			live -= 1
		end
		lc[i] = live
	end

	local function proc_rseq(i, slots, n, dt)
		local o = rowof[i]
		local work, drop = sA[i], sB[i]
		local kd, C = kids[i], nc[i]
		local wn, dn = n, 0
		local live = lc[i]
		for k = 1, n do work[k] = slots[k] end
		for x = 1, C do
			local ch = kd[x]
			if dn > 0 then halth[ch](ch, drop, dn) end
			if wn > 0 then
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local sl = work[k]
					local r = readu8(ST, sl)
					if r == SUCCESS then
						j += 1
						work[j] = sl
					else
						dn += 1
						drop[dn] = sl
						local p = o + sl * 8
						local was = readf64(V, p)
						if r == RUNNING then
							if was == 0 then
								writef64(V, p, 1)
								live += 1
							end
						elseif was ~= 0 then
							writef64(V, p, 0)
							live -= 1
						end
					end
				end
				wn = j
			elseif dn == 0 then
				break
			end
		end
		for k = 1, wn do
			local p = o + work[k] * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				live -= 1
			end
		end
		lc[i] = live
	end

	local function proc_rfall(i, slots, n, dt)
		local o = rowof[i]
		local work, drop = sA[i], sB[i]
		local kd, C = kids[i], nc[i]
		local wn, dn = n, 0
		local live = lc[i]
		for k = 1, n do work[k] = slots[k] end
		for x = 1, C do
			local ch = kd[x]
			if dn > 0 then halth[ch](ch, drop, dn) end
			if wn > 0 then
				proc[ch](ch, work, wn, dt)
				local j = 0
				for k = 1, wn do
					local sl = work[k]
					local r = readu8(ST, sl)
					if r == FAILURE then
						j += 1
						work[j] = sl
					else
						dn += 1
						drop[dn] = sl
						local p = o + sl * 8
						local was = readf64(V, p)
						if r == RUNNING then
							if was == 0 then
								writef64(V, p, 1)
								live += 1
							end
						elseif was ~= 0 then
							writef64(V, p, 0)
							live -= 1
						end
					end
				end
				wn = j
			elseif dn == 0 then
				break
			end
		end
		for k = 1, wn do
			local p = o + work[k] * 8
			if readf64(V, p) ~= 0 then
				writef64(V, p, 0)
				live -= 1
			end
		end
		lc[i] = live
	end

	-- mask is stored as mask + 1 so that 0 can mean "idle"
	local function proc_par(i, slots, n, dt)
		local o, osc, ofc = rowof[i], scof[i], fcof[i]
		local act, drop, sub = sA[i], sB[i], sC[i]
		local kd, C = kids[i], nc[i]
		local one_s, one_f = pso[i], pfo[i]
		local live = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			if readf64(V, p) == 0 then
				writef64(V, p, 1)
				writef64(V, osc + sl * 8, 0)
				writef64(V, ofc + sl * 8, 0)
				live += 1
			end
			act[k] = sl
		end
		local an, dn = n, 0
		local bit = 1
		for x = 1, C do
			local m, sn = 0, 0
			for k = 1, an do
				local sl = act[k]
				local mv = readf64(V, o + sl * 8)
				if mv ~= 0 then
					m += 1
					act[m] = sl
					if band(mv - 1, bit) == 0 then
						sn += 1
						sub[sn] = sl
					end
				end
			end
			an = m
			if sn > 0 then
				local ch = kd[x]
				proc[ch](ch, sub, sn, dt)
				for k = 1, sn do
					local sl = sub[k]
					local r = readu8(ST, sl)
					if r ~= RUNNING then
						local p = o + sl * 8
						if r == SUCCESS then
							local q = osc + sl * 8
							writef64(V, q, readf64(V, q) + 1)
							if one_s then
								writef64(V, p, 0)
								live -= 1
								dn += 1
								drop[dn] = sl
							else
								writef64(V, p, bor(readf64(V, p) - 1, bit) + 1)
							end
						else
							local q = ofc + sl * 8
							writef64(V, q, readf64(V, q) + 1)
							if one_f then
								writef64(V, p, 0)
								live -= 1
								dn += 1
								drop[dn] = sl
							else
								writef64(V, p, bor(readf64(V, p) - 1, bit) + 1)
							end
						end
					end
				end
			end
			bit *= 2
		end
		local all_s, all_f = psa[i], pfa[i]
		for k = 1, an do
			local sl = act[k]
			local p = o + sl * 8
			if readf64(V, p) ~= 0 then
				if all_s and readf64(V, osc + sl * 8) == C then
					writef64(V, p, 0)
					live -= 1
					writeu8(ST, sl, SUCCESS)
				elseif all_f and readf64(V, ofc + sl * 8) == C then
					writef64(V, p, 0)
					live -= 1
					writeu8(ST, sl, FAILURE)
				else
					writeu8(ST, sl, RUNNING)
				end
			end
		end
		lc[i] = live
		if dn > 0 then
			for x = 1, C do
				local ch = kd[x]
				halth[ch](ch, drop, dn)
			end
		end
	end

	local function proc_inv(i, slots, n, dt)
		local ch = k1[i]
		proc[ch](ch, slots, n, dt)
		for k = 1, n do
			local sl = slots[k]
			local r = readu8(ST, sl)
			if r == SUCCESS then
				writeu8(ST, sl, FAILURE)
			elseif r == FAILURE then
				writeu8(ST, sl, SUCCESS)
			end
		end
	end

	local function proc_fsucc(i, slots, n, dt)
		local ch = k1[i]
		proc[ch](ch, slots, n, dt)
		for k = 1, n do
			local sl = slots[k]
			if readu8(ST, sl) == FAILURE then writeu8(ST, sl, SUCCESS) end
		end
	end

	local function proc_ffail(i, slots, n, dt)
		local ch = k1[i]
		proc[ch](ch, slots, n, dt)
		for k = 1, n do
			local sl = slots[k]
			if readu8(ST, sl) == SUCCESS then writeu8(ST, sl, FAILURE) end
		end
	end

	-- count is stored as count + 1
	local function proc_repeat(i, slots, n, dt)
		local o, target = rowof[i], param[i]
		local live = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			if readf64(V, p) == 0 then
				writef64(V, p, 1)
				live += 1
			end
		end
		local ch = k1[i]
		proc[ch](ch, slots, n, dt)
		for k = 1, n do
			local sl = slots[k]
			if readu8(ST, sl) ~= RUNNING then
				local p = o + sl * 8
				local c = readf64(V, p) -- count + 1
				if c >= target then
					writef64(V, p, 0)
					live -= 1
					writeu8(ST, sl, SUCCESS)
				else
					writef64(V, p, c + 1)
					writeu8(ST, sl, RUNNING)
				end
			end
		end
		lc[i] = live
	end

	local function proc_timeout(i, slots, n, dt)
		local o, secs = rowof[i], param[i]
		local work, expired = sA[i], sB[i]
		local wn, en = 0, 0
		local live = lc[i]
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			local t = readf64(V, p)
			if t == 0 then
				t = secs
				live += 1
			end
			t -= dt
			if t <= 0 then
				writef64(V, p, 0)
				live -= 1
				en += 1
				expired[en] = sl
			else
				writef64(V, p, t)
				wn += 1
				work[wn] = sl
			end
		end
		lc[i] = live
		local ch = k1[i]
		if en > 0 then
			halth[ch](ch, expired, en)
			for k = 1, en do writeu8(ST, expired[k], FAILURE) end
		end
		if wn > 0 then
			proc[ch](ch, work, wn, dt)
			live = lc[i]
			for k = 1, wn do
				local sl = work[k]
				if readu8(ST, sl) ~= RUNNING then
					writef64(V, o + sl * 8, 0)
					live -= 1
				end
			end
			lc[i] = live
		end
	end

	local function proc_cooldown(i, slots, n, dt)
		local o, secs = cdof[i], param[i]
		local work = sA[i]
		local wn = 0
		for k = 1, n do
			local sl = slots[k]
			local p = o + sl * 8
			local t = readf64(V, p) - dt
			writef64(V, p, t)
			if t > 0 then
				writeu8(ST, sl, FAILURE)
			else
				wn += 1
				work[wn] = sl
			end
		end
		if wn > 0 then
			local ch = k1[i]
			proc[ch](ch, work, wn, dt)
			for k = 1, wn do
				local sl = work[k]
				if readu8(ST, sl) ~= RUNNING then writef64(V, o + sl * 8, secs) end
			end
		end
	end

	---------------------------------------------------------------------------------------------
	-- build
	---------------------------------------------------------------------------------------------
	local n_nodes = 0
	local noderow = {}
	local function new_node(with_row)
		n_nodes += 1
		local i = n_nodes
		lc[i] = 0
		if with_row then noderow[i] = alloc_row() end
		return i
	end

	local function build(sp)
		local kind = sp.kind
		if kind == "Sequence" or kind == "Fallback" then
			local i = new_node(true)
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
			return i
		elseif kind == "ReactiveSequence" or kind == "ReactiveFallback" then
			local i = new_node(true)
			proc[i] = kind == "ReactiveSequence" and proc_rseq or proc_rfall
			halth[i] = halt_multi
			sA[i], sB[i] = {}, {}
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
			return i
		elseif kind == "Parallel" then
			local i = new_node(true)
			proc[i] = proc_par
			halth[i] = halt_multi
			sA[i], sB[i], sC[i] = {}, {}, {}
			scof[i] = alloc_row()
			fcof[i] = alloc_row()
			pso[i] = sp.success_policy == "ONE"
			pfo[i] = sp.failure_policy == "ONE"
			psa[i] = not pso[i]
			pfa[i] = not pfo[i]
			local kd = {}
			for c, cs in sp.children do kd[c] = build(cs) end
			kids[i], nc[i] = kd, #kd
			if nc[i] > 32 then error("flat_batch_buffer: Parallel is limited to 32 children") end
			return i
		elseif kind == "Inverter" or kind == "ForceSuccess" or kind == "ForceFailure" then
			local i = new_node(false)
			proc[i] = kind == "Inverter" and proc_inv or (kind == "ForceSuccess" and proc_fsucc or proc_ffail)
			halth[i] = halt_pass
			k1[i] = build(sp.child)
			return i
		elseif kind == "Repeat" then
			local i = new_node(true)
			proc[i] = proc_repeat
			halth[i] = halt_one
			sA[i] = {}
			param[i] = sp.count
			k1[i] = build(sp.child)
			return i
		elseif kind == "Timeout" then
			local i = new_node(true)
			proc[i] = proc_timeout
			halth[i] = halt_one
			sA[i], sB[i] = {}, {}
			param[i] = sp.seconds
			k1[i] = build(sp.child)
			return i
		elseif kind == "Cooldown" then
			local i = new_node(false)
			proc[i] = proc_cooldown
			halth[i] = halt_pass
			sA[i] = {}
			cdof[i] = alloc_row()
			param[i] = sp.seconds
			k1[i] = build(sp.child)
			return i
		elseif kind == "Wait" then
			local i = new_node(true)
			proc[i] = proc_wait
			halth[i] = halt_state
			param[i] = sp.seconds
			return i
		elseif kind == "Leaf" then
			local i = new_node(sp.on_start ~= nil or sp.on_halt ~= nil)
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
				proc[i] = proc_leaf_pure
				halth[i] = halt_none
			end
			return i
		end
		error("flat_batch_buffer: unknown kind " .. tostring(kind))
	end

	local root = build(spec)

	-- Row offsets have to be recomputed on every growth, and every cached offset (rowof / cdof /
	-- scof / fcof) refreshed. Until relayout() runs they hold raw row indices.
	-- keep the raw row indices so layout() can be re-run after growth
	local cd_row, sc_row, fc_row = {}, {}, {}
	for i = 1, n_nodes do
		cd_row[i] = cdof[i]
		sc_row[i] = scof[i]
		fc_row[i] = fcof[i]
	end

	local function relayout(old_cap, oldV)
		local stride = (cap + 1) * 8
		local newV = buffer.create(n_rows * stride)
		if oldV then
			local old_stride = (old_cap + 1) * 8
			for r = 1, n_rows do
				buffer.copy(newV, (r - 1) * stride, oldV, (r - 1) * old_stride, old_stride)
			end
		end
		V = newV
		for i = 1, n_nodes do
			local r = noderow[i]
			if r then rowof[i] = (r - 1) * stride end
			if cd_row[i] then cdof[i] = (cd_row[i] - 1) * stride end
			if sc_row[i] then scof[i] = (sc_row[i] - 1) * stride end
			if fc_row[i] then fcof[i] = (fc_row[i] - 1) * stride end
		end
		local newST = buffer.create(cap + 1)
		if oldV then buffer.copy(newST, 0, ST, 0, old_cap + 1) end
		ST = newST
	end

	relayout(cap, nil)

	---------------------------------------------------------------------------------------------
	-- world
	---------------------------------------------------------------------------------------------
	local live_slots, index_of, n_agents = {}, {}, 0
	local one = { 0 }

	local function grow()
		local old_cap, oldV = cap, V
		cap *= 2
		relayout(old_cap, oldV)
	end

	local w
	w = {
		add = function(id)
			local sl
			if n_free > 0 then
				sl = free[n_free]
				free[n_free] = nil
				n_free -= 1
			else
				if n_used >= cap then grow() end
				n_used += 1
				sl = n_used
			end
			slot_of[id] = sl
			id_of[sl] = id
			n_agents += 1
			live_slots[n_agents] = sl
			index_of[sl] = n_agents
		end,
		remove = function(id)
			local sl = slot_of[id]
			one[1] = sl
			halth[root](root, one, 1)
			-- a recycled slot must look brand new: zero every row for it
			local p = sl * 8
			for r = 1, n_rows do writef64(V, (r - 1) * (cap + 1) * 8 + p, 0) end
			writeu8(ST, sl, 0)
			slot_of[id] = nil
			id_of[sl] = nil
			n_free += 1
			free[n_free] = sl
			local x = index_of[sl]
			local last = n_agents
			local moved = live_slots[last]
			live_slots[x] = moved
			index_of[moved] = x
			live_slots[last] = nil
			index_of[sl] = nil
			n_agents = last - 1
		end,
		tick = function(dt)
			if n_agents > 0 then proc[root](root, live_slots, n_agents, dt) end
		end,
		get = function(id)
			local sl = slot_of[id]
			if sl == nil then return nil end
			return readu8(ST, sl)
		end,
		node_count = n_nodes,
	}
	return w
end

return {
	name = "flat_batch_buffer",
	new_world = new_world,
	add_agent = function(w, id) w.add(id) end,
	remove_agent = function(w, id) w.remove(id) end,
	tick = function(w, dt) w.tick(dt) end,
	get_status = function(w, id) return w.get(id) end,
}
