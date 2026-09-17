--!optimize 2
-- closure_batch_status_scan: variant (a) + scan. Results through a shared status[agent] array
-- (see closure_batch_status) *and* Sequence/Fallback pick up the agents parked at child i with one
-- filter pass over the batch per child. This is the most straightforward way to write the design;
-- the other three cases each remove one of its two costs.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local function NOOP() end

---------------------------------------------------------------------------------------------------
-- Leaf
---------------------------------------------------------------------------------------------------
local function make_leaf(spec, status)
	local on_tick = spec.on_tick
	local on_start, on_halt = spec.on_start, spec.on_halt

	-- No hooks besides on_tick: the node is stateless, halting is a no-op. Conditions cost nothing.
	if on_start == nil and on_halt == nil then
		return {
			process = function(agents, n, dt)
				for i = 1, n do
					local a = agents[i]
					status[a] = on_tick(a, dt)
				end
			end,
			halt = NOOP,
		}
	end

	local run = {}
	if on_start ~= nil and on_halt ~= nil then
		return {
			process = function(agents, n, dt)
				for i = 1, n do
					local a = agents[i]
					if run[a] == nil then
						run[a] = true
						on_start(a)
					end
					local s = on_tick(a, dt)
					if s ~= RUNNING then run[a] = nil end
					status[a] = s
				end
			end,
			halt = function(agents, n)
				for i = 1, n do
					local a = agents[i]
					if run[a] ~= nil then
						run[a] = nil
						on_halt(a)
					end
				end
			end,
		}
	end

	return {
		process = function(agents, n, dt)
			for i = 1, n do
				local a = agents[i]
				if run[a] == nil then
					run[a] = true
					if on_start then on_start(a) end
				end
				local s = on_tick(a, dt)
				if s ~= RUNNING then run[a] = nil end
				status[a] = s
			end
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
local function make_wait(seconds, status)
	local time_left = {}
	return {
		process = function(agents, n, dt)
			for i = 1, n do
				local a = agents[i]
				local t = time_left[a]
				if t == nil then t = seconds end
				t -= dt
				if t <= 0 then
					time_left[a] = nil
					status[a] = SUCCESS
				else
					time_left[a] = t
					status[a] = RUNNING
				end
			end
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
-- Sequence / Fallback (cursor per agent; `cont` is the status that moves an agent to the next child)
---------------------------------------------------------------------------------------------------
local function make_seqlike(children, status, cont)
	local nc = #children
	if nc == 0 then
		return {
			process = function(agents, n)
				for i = 1, n do status[agents[i]] = cont end
			end,
			halt = NOOP,
		}
	end
	local procs, halts = table.create(nc), table.create(nc)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
	end

	local cursor = {} -- cursor[agent] = child index this agent is running in (nil = idle here)
	local buf = {} -- the batch travelling through the children, compacted in place
	local hb, hb2 = {}, {} -- halt scratch

	return {
		process = function(agents, n, dt)
			-- agents entering at child 1 (idle or already parked there); the rest resume deeper
			local m, deep = 0, 0
			for i = 1, n do
				local a = agents[i]
				local c = cursor[a]
				if c == nil or c == 1 then
					m += 1
					buf[m] = a
				else
					deep += 1
				end
			end
			for ci = 1, nc do
				if deep > 0 and ci > 1 then
					-- pick up the agents parked at this child (one filter pass; stops once they are all in)
					for i = 1, n do
						local a = agents[i]
						if cursor[a] == ci then
							m += 1
							buf[m] = a
							deep -= 1
						end
					end
				end
				if m > 0 then
					procs[ci](buf, m, dt)
					local om = 0
					for i = 1, m do
						local a = buf[i]
						local s = status[a]
						if s == cont then
							om += 1
							buf[om] = a -- carries on to the next child; status is overwritten there
						elseif s == RUNNING then
							cursor[a] = ci
						elseif cursor[a] ~= nil then
							cursor[a] = nil -- stopped here: the child's status is ours
						end
					end
					m = om
				end
				if m == 0 and deep == 0 then break end
			end
			-- survivors passed every child: status is already `cont`
			for i = 1, m do
				local a = buf[i]
				if cursor[a] ~= nil then cursor[a] = nil end
			end
		end,

		halt = function(agents, n)
			local k = 0
			for i = 1, n do
				local a = agents[i]
				if cursor[a] ~= nil then
					k += 1
					hb[k] = a
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
-- ReactiveSequence / ReactiveFallback: no cursor, every tick restarts at child 1.
---------------------------------------------------------------------------------------------------
local function make_reactive(children, status, cont)
	local nc = #children
	local procs, halts = table.create(nc), table.create(nc)
	local hbufs, hcnt = table.create(nc), table.create(nc, 0)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
		hbufs[i] = {}
	end

	local active = {} -- active[agent] = child index that was RUNNING at the end of last tick
	local buf = {}
	local hb, hb2 = {}, {}

	return {
		process = function(agents, n, dt)
			local nh = 0
			-- child 1 always gets the whole batch: read the parent's array in place, compact into buf
			procs[1](agents, n, dt)
			local m = 0
			for i = 1, n do
				local a = agents[i]
				local s = status[a]
				if s == cont then
					m += 1
					buf[m] = a
				else
					local p = active[a]
					if p ~= nil and p > 1 then
						local c = hcnt[p] + 1
						hcnt[p] = c
						hbufs[p][c] = a
						nh += 1
					end
					if s == RUNNING then
						if p ~= 1 then active[a] = 1 end
					elseif p ~= nil then
						active[a] = nil
					end
				end
			end
			for ci = 2, nc do
				if m == 0 then break end
				procs[ci](buf, m, dt)
				local om = 0
				for i = 1, m do
					local a = buf[i]
					local s = status[a]
					if s == cont then
						om += 1
						buf[om] = a
					else
						local p = active[a]
						if p ~= nil and p > ci then
							local c = hcnt[p] + 1
							hcnt[p] = c
							hbufs[p][c] = a
							nh += 1
						end
						if s == RUNNING then
							if p ~= ci then active[a] = ci end
						elseif p ~= nil then
							active[a] = nil
						end
					end
				end
				m = om
			end
			-- survivors passed every child: whatever was active was ticked and finished on the way
			for i = 1, m do
				local a = buf[i]
				if active[a] ~= nil then active[a] = nil end
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
-- Parallel: per-agent completed-children bitmasks.
---------------------------------------------------------------------------------------------------
local function make_parallel(children, status, succ_one, fail_one)
	local nc = #children
	local procs, halts, bits = table.create(nc), table.create(nc), table.create(nc)
	for i = 1, nc do
		procs[i] = children[i].process
		halts[i] = children[i].halt
		bits[i] = bit32.lshift(1, i - 1)
	end
	local full = bit32.lshift(1, nc) - 1
	local band, bor, bxor = bit32.band, bit32.bor, bit32.bxor

	local done, succ = {}, {} -- done[agent] / succ[agent] = bitmask of completed / succeeded children
	local cur, cin, fin, hb = {}, {}, {}, {}

	return {
		process = function(agents, n, dt)
			local m = n
			for i = 1, n do
				local a = agents[i]
				cur[i] = a
				if done[a] == nil then
					done[a] = 0
					succ[a] = 0
				end
			end
			local nf = 0 -- agents finished by a ONE policy this tick
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
					procs[ci](cin, cm, dt)
					local fc = 0
					for i = 1, cm do
						local a = cin[i]
						local s = status[a]
						if s == SUCCESS then
							if succ_one then
								nf += 1
								fin[nf] = a
								done[a] = -1
								fc += 1
							else
								done[a] = bor(done[a], bit)
								succ[a] = bor(succ[a], bit)
							end
						elseif s == FAILURE then
							if fail_one then
								nf += 1
								fin[nf] = a
								done[a] = -1
								fc += 1
							else
								done[a] = bor(done[a], bit)
							end
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
					status[a] = SUCCESS
				elseif not fail_one and bxor(d, sm) == full then
					done[a] = nil
					succ[a] = nil
					status[a] = FAILURE
				else
					status[a] = RUNNING
				end
			end
			if nf > 0 then
				-- a ONE policy fired: halt everything still running for those agents (guarded in the child)
				for ci = 1, nc do halts[ci](fin, nf) end
				for i = 1, nf do
					local a = fin[i]
					done[a] = nil
					succ[a] = nil
				end
			end
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
local function make_inverter(child, status)
	local cp = child.process
	return {
		process = function(agents, n, dt)
			cp(agents, n, dt)
			for i = 1, n do
				local a = agents[i]
				local s = status[a]
				if s == SUCCESS then
					status[a] = FAILURE
				elseif s == FAILURE then
					status[a] = SUCCESS
				end
			end
		end,
		halt = child.halt,
	}
end

local function make_force(child, status, forced)
	local cp = child.process
	return {
		process = function(agents, n, dt)
			cp(agents, n, dt)
			for i = 1, n do
				local a = agents[i]
				if status[a] ~= RUNNING then status[a] = forced end
			end
		end,
		halt = child.halt,
	}
end

local function make_repeat(child, count, status)
	local cp, ch = child.process, child.halt
	local n_done = {}
	return {
		process = function(agents, n, dt)
			cp(agents, n, dt)
			for i = 1, n do
				local a = agents[i]
				local s = status[a]
				if s == RUNNING then
					if n_done[a] == nil then n_done[a] = 0 end
				else
					local c = n_done[a]
					c = (c == nil and 0 or c) + 1
					if c >= count then
						n_done[a] = nil
						status[a] = SUCCESS
					else
						n_done[a] = c
						status[a] = RUNNING
					end
				end
			end
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

local function make_timeout(child, seconds, status)
	local cp, ch = child.process, child.halt
	local time_left = {}
	local pass, exp = {}, {}
	return {
		process = function(agents, n, dt)
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
				cp(pass, pm, dt)
				for i = 1, pm do
					local a = pass[i]
					if status[a] ~= RUNNING then time_left[a] = nil end
				end
			end
			if em > 0 then
				ch(exp, em)
				for i = 1, em do status[exp[i]] = FAILURE end
			end
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

-- Cooldown: time_left[agent] ~= nil means "still cooling" (the baseline lets the number go negative,
-- which is behaviourally identical to clamping it at 0 / nil).
local function make_cooldown(child, seconds, status, clears)
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
		process = function(agents, n, dt)
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
							status[a] = FAILURE
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
				cp(p, pm, dt)
				for i = 1, pm do
					local a = p[i]
					if status[a] ~= RUNNING then
						time_left[a] = seconds
						n_cool += 1
					end
				end
			end
		end,
		halt = ch, -- halting does not touch the cooldown timer
	}
end

---------------------------------------------------------------------------------------------------
-- Build
---------------------------------------------------------------------------------------------------
local function build(spec, status, clears)
	local k = spec.kind
	if k == "Leaf" then
		return make_leaf(spec, status)
	elseif k == "Wait" then
		return make_wait(spec.seconds, status)
	elseif k == "Sequence" or k == "Fallback" or k == "ReactiveSequence" or k == "ReactiveFallback" then
		local src = spec.children
		local cs = table.create(#src)
		for i = 1, #src do cs[i] = build(src[i], status, clears) end
		local cont = (k == "Sequence" or k == "ReactiveSequence") and SUCCESS or FAILURE
		if k == "Sequence" or k == "Fallback" then
			return make_seqlike(cs, status, cont)
		end
		return make_reactive(cs, status, cont)
	elseif k == "Parallel" then
		local src = spec.children
		local cs = table.create(#src)
		for i = 1, #src do cs[i] = build(src[i], status, clears) end
		return make_parallel(cs, status, spec.success_policy == "ONE", spec.failure_policy == "ONE")
	elseif k == "Inverter" then
		return make_inverter(build(spec.child, status, clears), status)
	elseif k == "ForceSuccess" then
		return make_force(build(spec.child, status, clears), status, SUCCESS)
	elseif k == "ForceFailure" then
		return make_force(build(spec.child, status, clears), status, FAILURE)
	elseif k == "Repeat" then
		return make_repeat(build(spec.child, status, clears), spec.count, status)
	elseif k == "Timeout" then
		return make_timeout(build(spec.child, status, clears), spec.seconds, status)
	elseif k == "Cooldown" then
		return make_cooldown(build(spec.child, status, clears), spec.seconds, status, clears)
	end
	error("closure_batch_status_scan: unknown kind " .. tostring(k))
end

---------------------------------------------------------------------------------------------------
-- Adapter
---------------------------------------------------------------------------------------------------
return {
	name = "closure_batch_status_scan",

	new_world = function(spec)
		local status = {}
		local clears = {}
		local root = build(spec, status, clears)
		return {
			root_process = root.process,
			root_halt = root.halt,
			clears = clears,
			status = status,
			live = {}, -- dense list of live agent ids
			slot = {}, -- slot[agent] = index in live
			n = 0,
			one = {}, -- 1-element batch for remove_agent
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
		w.root_process(w.live, w.n, dt)
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
