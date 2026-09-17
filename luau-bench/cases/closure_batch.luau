--!optimize 2
-- closure_batch: node-major batch processing (main case = out-lists + bucketed cursors).
--
-- Every node is a pair of closures produced by a factory. A node processes an ARRAY of agents per tick
-- instead of being called once per agent:
--
--     process(agents, n, dt, so, sn, fo, fn, ro, rn) -> sn, fn, rn
--         agents[1..n]  the batch (owned by the parent; a node never writes into its input)
--         so/fo/ro      succeeded / failed / running out-lists, provided by the parent
--         sn/fn/rn      how many entries they already hold; the child appends after them
--     halt(agents, n)   halts the agents of the batch that are running here (guarded, idempotent)
--     clear(agent)      (optional) drops per-agent state that survives a halt (Cooldown timers)
--
-- A parent forwards *subsets* of its batch to its children and hands each child the out-list the result
-- should end up in, so results travel zero-copy:
--   * Sequence: the child's FAILURE list *is* the Sequence's failure list and the RUNNING list *is* its
--     running list; only the SUCCESS list is redirected into the next child's input buffer. The parent
--     then only touches the agents that stopped (to update their cursor), never the whole batch.
--   * Inverter: a pure argument permutation - zero per-agent work.
--   * Parallel forwards the batch minus the per-agent completed children (bitmask per agent).
-- Agents resume at their per-agent cursor: the batch entering child i is "agents parked at i plus the
-- agents that passed child i-1". Parking is bucketed in the entry pass, and an n_deep counter skips
-- that pass entirely (the parent's array goes straight into child 1) when nobody is parked past child 1.
-- Per-agent state is Struct-of-Maps in closure upvalues (cursor[agent], time_left[agent], ...).
-- Every scratch list is per node and reused with an explicit count: no `#`, no table.clear, no
-- allocation at all once the buffers reached their high-water mark.
--
-- Variants: closure_batch_scan (same, cursors by one filter pass per child), closure_batch_status
-- (results through a shared status[agent] array instead of out-lists), closure_batch_status_scan (both),
-- closure_batch_control (same design, but the tree is walked recursively once per agent).
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local function NOOP() end

---------------------------------------------------------------------------------------------------
-- Leaf
---------------------------------------------------------------------------------------------------
local function make_leaf(spec)
	local on_tick = spec.on_tick
	local on_start, on_halt = spec.on_start, spec.on_halt

	if on_start == nil and on_halt == nil then
		return {
			process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
				for i = 1, n do
					local a = agents[i]
					local s = on_tick(a, dt)
					if s == SUCCESS then
						sn += 1
						so[sn] = a
					elseif s == FAILURE then
						fn += 1
						fo[fn] = a
					else
						rn += 1
						ro[rn] = a
					end
				end
				return sn, fn, rn
			end,
			halt = NOOP,
		}
	end

	local run = {}
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			for i = 1, n do
				local a = agents[i]
				if run[a] == nil then
					run[a] = true
					if on_start then on_start(a) end
				end
				local s = on_tick(a, dt)
				if s == SUCCESS then
					run[a] = nil
					sn += 1
					so[sn] = a
				elseif s == FAILURE then
					run[a] = nil
					fn += 1
					fo[fn] = a
				else
					rn += 1
					ro[rn] = a
				end
			end
			return sn, fn, rn
		end,
		halt = function(agents, n)
			for i = 1, n do
				local a = agents[i]
				if run[a] ~= nil then
					run[a] = nil
					if on_halt then on_halt(a) end
				end
			end
		end,
	}
end

---------------------------------------------------------------------------------------------------
-- Wait
---------------------------------------------------------------------------------------------------
local function make_wait(seconds)
	local time_left = {}
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			for i = 1, n do
				local a = agents[i]
				local t = time_left[a]
				if t == nil then t = seconds end
				t -= dt
				if t <= 0 then
					time_left[a] = nil
					sn += 1
					so[sn] = a
				else
					time_left[a] = t
					rn += 1
					ro[rn] = a
				end
			end
			return sn, fn, rn
		end,
		halt = function(agents, n)
			for i = 1, n do
				local a = agents[i]
				if time_left[a] ~= nil then time_left[a] = nil end
			end
		end,
	}
end

---------------------------------------------------------------------------------------------------
-- Sequence / Fallback
---------------------------------------------------------------------------------------------------
local function make_seqlike(children, is_seq)
	local nc = #children
	local procs, halts = table.create(nc), table.create(nc)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
	end
	local cursor = {} -- cursor[agent] = child index this agent is parked in (nil = idle here)
	local b1, b2 = {}, {}
	local bucket, bcnt = table.create(nc), table.create(nc, 0) -- agents parked at child ci
	for i = 2, nc do bucket[i] = {} end
	-- n_deep: how many agents are parked past child 1. Maintained without any per-agent bookkeeping:
	-- every agent parked at the end of a tick had its cursor written during that tick's process call,
	-- so the count can be rebuilt from the sizes of the RUNNING slices.
	local n_deep = 0
	local hb, hb2 = {}, {}

	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local m, pending = 0, 0
			local buf, alt
			if n_deep == 0 then
				-- nobody parked past child 1: the parent's array *is* child 1's input, no copy at all
				buf, alt, m = agents, b1, n
			else
				-- one pass: child-1 entrants into b1, everyone else into their cursor's bucket
				for i = 1, n do
					local a = agents[i]
					local c = cursor[a]
					if c == nil or c == 1 then
						m += 1
						b1[m] = a
					else
						local k = bcnt[c] + 1
						bcnt[c] = k
						bucket[c][k] = a
						pending += 1
					end
				end
				buf, alt = b1, b2
				n_deep -= pending -- what is left is parked but not in this batch (it gets halted below)
			end
			for ci = 1, nc do
				if ci > 1 then
					local k = bcnt[ci]
					if k > 0 then
						bcnt[ci] = 0
						pending -= k
						local b = bucket[ci]
						for i = 1, k do
							m += 1
							buf[m] = b[i]
						end
					end
				end
				if m == 0 then
					if pending == 0 then break end
					continue
				end
				local sn0, fn0, rn0 = sn, fn, rn
				if ci < nc then
					local cn
					if is_seq then
						cn, fn, rn = procs[ci](buf, m, dt, alt, 0, fo, fn, ro, rn)
					else
						sn, cn, rn = procs[ci](buf, m, dt, so, sn, alt, 0, ro, rn)
					end
					if buf == agents then
						buf, alt = alt, b2
					else
						buf, alt = alt, buf
					end
					m = cn
				else
					sn, fn, rn = procs[ci](buf, m, dt, so, sn, fo, fn, ro, rn)
					m = 0
					-- survivors of the last child: their run in this node ended
					local list, from, to
					if is_seq then list, from, to = so, sn0 + 1, sn else list, from, to = fo, fn0 + 1, fn end
					for i = from, to do
						local a = list[i]
						if cursor[a] ~= nil then cursor[a] = nil end
					end
				end
				if ci == 1 then
					for i = rn0 + 1, rn do cursor[ro[i]] = 1 end
				else
					for i = rn0 + 1, rn do cursor[ro[i]] = ci end
					n_deep += rn - rn0
				end
				local list, from, to
				if is_seq then list, from, to = fo, fn0 + 1, fn else list, from, to = so, sn0 + 1, sn end
				for i = from, to do
					local a = list[i]
					if cursor[a] ~= nil then cursor[a] = nil end
				end
			end
			return sn, fn, rn
		end,

		halt = function(agents, n)
			local k = 0
			for i = 1, n do
				local a = agents[i]
				local c = cursor[a]
				if c ~= nil then
					k += 1
					hb[k] = a
					if c > 1 then n_deep -= 1 end
				end
			end
			while k > 0 do
				local ci = cursor[hb[1]]
				local m, rem = 0, 0
				for i = 1, k do
					local a = hb[i]
					if cursor[a] == ci then
						m += 1
						hb2[m] = a
						cursor[a] = nil
					else
						rem += 1
						hb[rem] = a
					end
				end
				halts[ci](hb2, m)
				k = rem
			end
		end,
	}
end

---------------------------------------------------------------------------------------------------
-- ReactiveSequence / ReactiveFallback
---------------------------------------------------------------------------------------------------
local function make_reactive(children, is_seq)
	local nc = #children
	local procs, halts = table.create(nc), table.create(nc)
	local hbufs, hcnt = table.create(nc), table.create(nc, 0)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
		hbufs[i] = {}
	end
	local active = {} -- active[agent] = child index that was RUNNING at the end of last tick
	local b1, b2 = {}, {}
	local hb, hb2 = {}, {}

	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local buf, alt = agents, b1 -- child 1 always gets the whole batch: read it in place
			local m = n
			local nh = 0
			for ci = 1, nc do
				local sn0, fn0, rn0 = sn, fn, rn
				if ci < nc then
					local cn
					if is_seq then
						cn, fn, rn = procs[ci](buf, m, dt, alt, 0, fo, fn, ro, rn)
					else
						sn, cn, rn = procs[ci](buf, m, dt, so, sn, alt, 0, ro, rn)
					end
					if buf == agents then
						buf, alt = alt, b2
					else
						buf, alt = alt, buf
					end
					m = cn
				else
					sn, fn, rn = procs[ci](buf, m, dt, so, sn, fo, fn, ro, rn)
					m = 0
					-- survivors passed every child: whatever was active was ticked and finished on the way
					local list, from, to
					if is_seq then list, from, to = so, sn0 + 1, sn else list, from, to = fo, fn0 + 1, fn end
					for i = from, to do
						local a = list[i]
						if active[a] ~= nil then active[a] = nil end
					end
				end
				-- agents that went RUNNING here: a *later* child may still be running from last tick
				for i = rn0 + 1, rn do
					local a = ro[i]
					local p = active[a]
					if p ~= ci then
						if p ~= nil and p > ci then
							local c = hcnt[p] + 1
							hcnt[p] = c
							hbufs[p][c] = a
							nh += 1
						end
						active[a] = ci
					end
				end
				-- agents that stopped here
				local list, from, to
				if is_seq then list, from, to = fo, fn0 + 1, fn else list, from, to = so, sn0 + 1, sn end
				for i = from, to do
					local a = list[i]
					local p = active[a]
					if p ~= nil then
						if p > ci then
							local c = hcnt[p] + 1
							hcnt[p] = c
							hbufs[p][c] = a
							nh += 1
						end
						active[a] = nil
					end
				end
				if m == 0 then break end
			end
			if nh > 0 then
				for ci = 1, nc do
					local c = hcnt[ci]
					if c > 0 then
						hcnt[ci] = 0
						halts[ci](hbufs[ci], c)
					end
				end
			end
			return sn, fn, rn
		end,

		halt = function(agents, n)
			local k = 0
			for i = 1, n do
				local a = agents[i]
				if active[a] ~= nil then
					k += 1
					hb[k] = a
				end
			end
			while k > 0 do
				local ci = active[hb[1]]
				local m, rem = 0, 0
				for i = 1, k do
					local a = hb[i]
					if active[a] == ci then
						m += 1
						hb2[m] = a
						active[a] = nil
					else
						rem += 1
						hb[rem] = a
					end
				end
				halts[ci](hb2, m)
				k = rem
			end
		end,
	}
end

---------------------------------------------------------------------------------------------------
-- Parallel
---------------------------------------------------------------------------------------------------
local function make_parallel(children, succ_one, fail_one)
	local nc = #children
	local procs, halts, bits = table.create(nc), table.create(nc), table.create(nc)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
		bits[i] = bit32.lshift(1, i - 1)
	end
	local full = bit32.lshift(1, nc) - 1
	local band, bor, bxor = bit32.band, bit32.bor, bit32.bxor

	local done, succ = {}, {}
	local cur, cin, fin, hb = {}, {}, {}, {}
	local ts, tf, tr = {}, {}, {}

	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local m = n
			for i = 1, n do
				local a = agents[i]
				cur[i] = a
				if done[a] == nil then
					done[a] = 0
					succ[a] = 0
				end
			end
			local nf = 0
			for ci = 1, nc do
				if m == 0 then break end
				local bit = bits[ci]
				local cm = 0
				for i = 1, m do
					local a = cur[i]
					if band(done[a], bit) == 0 then
						cm += 1
						cin[cm] = a
					end
				end
				if cm > 0 then
					local ns, nff = procs[ci](cin, cm, dt, ts, 0, tf, 0, tr, 0)
					local fc = 0
					for i = 1, ns do
						local a = ts[i]
						if succ_one then
							nf += 1
							fin[nf] = a
							done[a] = -1
							fc += 1
							sn += 1
							so[sn] = a
						else
							done[a] = bor(done[a], bit)
							succ[a] = bor(succ[a], bit)
						end
					end
					for i = 1, nff do
						local a = tf[i]
						if fail_one then
							nf += 1
							fin[nf] = a
							done[a] = -1
							fc += 1
							fn += 1
							fo[fn] = a
						else
							done[a] = bor(done[a], bit)
						end
					end
					if fc > 0 then
						local om = 0
						for i = 1, m do
							local a = cur[i]
							if done[a] ~= -1 then
								om += 1
								cur[om] = a
							end
						end
						m = om
					end
				end
			end
			for i = 1, m do
				local a = cur[i]
				local d = done[a]
				local sm = succ[a]
				if not succ_one and sm == full then
					done[a] = nil
					succ[a] = nil
					sn += 1
					so[sn] = a
				elseif not fail_one and bxor(d, sm) == full then
					done[a] = nil
					succ[a] = nil
					fn += 1
					fo[fn] = a
				else
					rn += 1
					ro[rn] = a
				end
			end
			if nf > 0 then
				for ci = 1, nc do halts[ci](fin, nf) end
				for i = 1, nf do
					local a = fin[i]
					done[a] = nil
					succ[a] = nil
				end
			end
			return sn, fn, rn
		end,

		halt = function(agents, n)
			local k = 0
			for i = 1, n do
				local a = agents[i]
				if done[a] ~= nil then
					k += 1
					hb[k] = a
					done[a] = nil
					succ[a] = nil
				end
			end
			if k > 0 then
				for ci = 1, nc do halts[ci](hb, k) end
			end
		end,
	}
end

---------------------------------------------------------------------------------------------------
-- Decorators
---------------------------------------------------------------------------------------------------
-- Inverter: swap which out-list the child writes into. Zero per-agent work.
local function make_inverter(child)
	local cp = child.process
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local a, b, c = cp(agents, n, dt, fo, fn, so, sn, ro, rn)
			return b, a, c
		end,
		halt = child.halt,
	}
end

-- ForceSuccess / ForceFailure: the losing list is a temp that gets appended to the winning one.
local function make_force(child, forced)
	local cp = child.process
	local tmp = {}
	if forced == SUCCESS then
		return {
			process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
				local ns, nff, nr = cp(agents, n, dt, so, sn, tmp, 0, ro, rn)
				for i = 1, nff do
					ns += 1
					so[ns] = tmp[i]
				end
				return ns, fn, nr
			end,
			halt = child.halt,
		}
	end
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local ns, nff, nr = cp(agents, n, dt, tmp, 0, fo, fn, ro, rn)
			for i = 1, ns do
				nff += 1
				fo[nff] = tmp[i]
			end
			return sn, nff, nr
		end,
		halt = child.halt,
	}
end

local function make_repeat(child, count)
	local cp, ch = child.process, child.halt
	local n_done = {}
	local ts, tf = {}, {}
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local ns, nff, nr = cp(agents, n, dt, ts, 0, tf, 0, ro, rn)
			for i = rn + 1, nr do
				local a = ro[i]
				if n_done[a] == nil then n_done[a] = 0 end
			end
			rn = nr
			for j = 1, 2 do
				local list, k = ts, ns
				if j == 2 then
					list, k = tf, nff
				end
				for i = 1, k do
					local a = list[i]
					local c = n_done[a]
					c = (c == nil and 0 or c) + 1
					if c >= count then
						if n_done[a] ~= nil then n_done[a] = nil end
						sn += 1
						so[sn] = a
					else
						n_done[a] = c
						rn += 1
						ro[rn] = a
					end
				end
			end
			return sn, fn, rn
		end,
		halt = function(agents, n)
			for i = 1, n do
				local a = agents[i]
				if n_done[a] ~= nil then n_done[a] = nil end
			end
			ch(agents, n)
		end,
	}
end

local function make_timeout(child, seconds)
	local cp, ch = child.process, child.halt
	local time_left = {}
	local pass, exp = {}, {}
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local pm, em = 0, 0
			for i = 1, n do
				local a = agents[i]
				local t = time_left[a]
				if t == nil then
					t = seconds - dt
					if t <= 0 then
						em += 1
						exp[em] = a
					else
						time_left[a] = t
						pm += 1
						pass[pm] = a
					end
				else
					t -= dt
					if t <= 0 then
						time_left[a] = nil
						em += 1
						exp[em] = a
					else
						time_left[a] = t
						pm += 1
						pass[pm] = a
					end
				end
			end
			if pm > 0 then
				local sn0, fn0 = sn, fn
				sn, fn, rn = cp(pass, pm, dt, so, sn, fo, fn, ro, rn)
				for i = sn0 + 1, sn do time_left[so[i]] = nil end
				for i = fn0 + 1, fn do time_left[fo[i]] = nil end
			end
			if em > 0 then
				ch(exp, em)
				for i = 1, em do
					fn += 1
					fo[fn] = exp[i]
				end
			end
			return sn, fn, rn
		end,
		halt = function(agents, n)
			for i = 1, n do
				local a = agents[i]
				if time_left[a] ~= nil then time_left[a] = nil end
			end
			ch(agents, n)
		end,
	}
end

local function make_cooldown(child, seconds, clears)
	local cp, ch = child.process, child.halt
	local time_left = {}
	local pass = {}
	local n_cool = 0
	clears[#clears + 1] = function(a)
		if time_left[a] ~= nil then
			time_left[a] = nil
			n_cool -= 1
		end
	end
	return {
		process = function(agents, n, dt, so, sn, fo, fn, ro, rn)
			local p, pm
			if n_cool == 0 then
				p, pm = agents, n
			else
				p, pm = pass, 0
				for i = 1, n do
					local a = agents[i]
					local t = time_left[a]
					if t == nil then
						pm += 1
						pass[pm] = a
					else
						t -= dt
						if t > 0 then
							time_left[a] = t
							fn += 1
							fo[fn] = a
						else
							time_left[a] = nil
							n_cool -= 1
							pm += 1
							pass[pm] = a
						end
					end
				end
			end
			if pm > 0 then
				local sn0, fn0 = sn, fn
				sn, fn, rn = cp(p, pm, dt, so, sn, fo, fn, ro, rn)
				for i = sn0 + 1, sn do
					time_left[so[i]] = seconds
					n_cool += 1
				end
				for i = fn0 + 1, fn do
					time_left[fo[i]] = seconds
					n_cool += 1
				end
			end
			return sn, fn, rn
		end,
		halt = ch,
	}
end

---------------------------------------------------------------------------------------------------
-- Build
---------------------------------------------------------------------------------------------------
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
		local is_seq = k == "Sequence" or k == "ReactiveSequence"
		if k == "Sequence" or k == "Fallback" then return make_seqlike(cs, is_seq) end
		return make_reactive(cs, is_seq)
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
	error("closure_batch: unknown kind " .. tostring(k))
end

---------------------------------------------------------------------------------------------------
-- Adapter
---------------------------------------------------------------------------------------------------
return {
	name = "closure_batch",

	new_world = function(spec)
		local clears = {}
		local root = build(spec, clears)
		return {
			root_process = root.process,
			root_halt = root.halt,
			clears = clears,
			status = {},
			live = {},
			slot = {},
			n = 0,
			one = {},
			so = {},
			fo = {},
			ro = {},
		}
	end,

	add_agent = function(w, id)
		local n = w.n + 1
		w.n = n
		w.live[n] = id
		w.slot[id] = n
	end,

	remove_agent = function(w, id)
		local one = w.one
		one[1] = id
		w.root_halt(one, 1)
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
		local so, fo, ro, status = w.so, w.fo, w.ro, w.status
		local sn, fn, rn = w.root_process(w.live, w.n, dt, so, 0, fo, 0, ro, 0)
		for i = 1, sn do status[so[i]] = SUCCESS end
		for i = 1, fn do status[fo[i]] = FAILURE end
		for i = 1, rn do status[ro[i]] = RUNNING end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
