-- Scenario trees shared by every case. A scenario is a plain nested table ("spec") that each
-- case's adapter turns into its own node representation.
--
-- Spec node kinds:
--   { kind = "Sequence" | "Fallback" | "ReactiveSequence" | "ReactiveFallback", children = { ... } }
--   { kind = "Parallel", success_policy = "ALL"|"ONE", failure_policy = "ALL"|"ONE", children = { ... } }
--   { kind = "Inverter" | "ForceSuccess" | "ForceFailure", child = ... }
--   { kind = "Repeat", count = n, child = ... }
--   { kind = "Cooldown", seconds = s, child = ... }
--   { kind = "Timeout", seconds = s, child = ... }
--   { kind = "Wait", seconds = s }
--   { kind = "Leaf", name = "...", on_start = fn(agent)?, on_tick = fn(agent, dt) -> status, on_halt = fn(agent)? }
--
-- Leaf callbacks are owned by the harness so every implementation runs identical leaf logic.
-- Per-agent leaf state is Struct-of-Maps: one table per field keyed by agent id (progress[agent]).
-- ctx is shared with the runner: ctx.tick is the current tick number (the runner increments it before
-- each world tick); ctx.trace is an array of event strings while the correctness test records, else nil;
-- ctx.bb is the SoM "blackboard": ctx.bb.last_attack[agent].

local S = require("./status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

local Scenarios = {}
Scenarios.list = { "npc", "wide", "deep", "reactive" }

local function push(ctx, name, ev, agent)
	local t = ctx.trace
	t[#t + 1] = name .. ":" .. ev .. ":" .. agent
end

-- Condition leaf: only on_tick (no start/halt hooks). SUCCESS for on_ticks ticks out of every period,
-- phase shifted per agent so agents disagree.
local function cond(ctx, name, period, on_ticks, phase)
	phase = phase or 0
	return {
		kind = "Leaf",
		name = name,
		on_tick = function(agent, dt)
			local s = ((ctx.tick + agent * 7 + phase) % period) < on_ticks and SUCCESS or FAILURE
			if ctx.trace then push(ctx, name, "tick" .. s, agent) end
			return s
		end,
	}
end

-- Action leaf: has start/halt hooks and per-agent state. RUNNING for duration - 1 ticks, then
-- SUCCESS (or FAILURE when fail_every divides agent + tick).
local function action(ctx, name, duration, fail_every)
	local progress = {}
	return {
		kind = "Leaf",
		name = name,
		on_start = function(agent)
			progress[agent] = 0
			if ctx.trace then push(ctx, name, "start", agent) end
		end,
		on_tick = function(agent, dt)
			local p = progress[agent]
			if p == nil then error(name .. ": on_tick without on_start for agent " .. tostring(agent)) end
			p += 1
			local s
			if p >= duration then
				progress[agent] = nil
				if fail_every and (agent + ctx.tick) % fail_every == 0 then s = FAILURE else s = SUCCESS end
			else
				progress[agent] = p
				s = RUNNING
			end
			if ctx.trace then push(ctx, name, "tick" .. s, agent) end
			return s
		end,
		on_halt = function(agent)
			progress[agent] = nil
			if ctx.trace then push(ctx, name, "halt", agent) end
		end,
	}
end

-- Constant leaf (like Plug).
local function instant(ctx, name, status)
	return {
		kind = "Leaf",
		name = name,
		on_tick = function(agent, dt)
			if ctx.trace then push(ctx, name, "tick" .. status, agent) end
			return status
		end,
	}
end

-- SoM blackboard writer / reader.
local function set_flag(ctx, name, field)
	return {
		kind = "Leaf",
		name = name,
		on_tick = function(agent, dt)
			ctx.bb[field][agent] = ctx.tick
			if ctx.trace then push(ctx, name, "tick" .. SUCCESS, agent) end
			return SUCCESS
		end,
	}
end

local function flag_within(ctx, name, field, max_age)
	return {
		kind = "Leaf",
		name = name,
		on_tick = function(agent, dt)
			local t = ctx.bb[field][agent]
			local s = (t ~= nil and ctx.tick - t <= max_age) and SUCCESS or FAILURE
			if ctx.trace then push(ctx, name, "tick" .. s, agent) end
			return s
		end,
	}
end

function Scenarios.build(name, ctx)
	ctx.bb = { last_attack = {} }

	if name == "npc" then
		-- ~24 nodes, depth 4: the "typical NPC" shape.
		return {
			kind = "Fallback",
			children = {
				{ kind = "Sequence", children = {
					cond(ctx, "see_enemy", 10, 4),
					{ kind = "Cooldown", seconds = 1.0, child = action(ctx, "attack", 3) },
					set_flag(ctx, "mark_attack", "last_attack"),
				} },
				{ kind = "Sequence", children = {
					flag_within(ctx, "recently_attacked", "last_attack", 5),
					{ kind = "Wait", seconds = 0.25 },
					action(ctx, "retreat", 2),
				} },
				{ kind = "ReactiveSequence", children = {
					cond(ctx, "hungry", 12, 6),
					{ kind = "Repeat", count = 2, child = action(ctx, "eat", 2) },
				} },
				{ kind = "Parallel", success_policy = "ALL", failure_policy = "ONE", children = {
					action(ctx, "look_around", 4),
					{ kind = "Wait", seconds = 0.5 },
					{ kind = "Inverter", child = cond(ctx, "danger", 20, 2) },
				} },
				{ kind = "ForceSuccess", child = action(ctx, "idle", 1, 3) },
			},
		}
	elseif name == "wide" then
		-- Fallback over 16 [cond, action] sequences; exactly one cond is true per tick per agent.
		local children = {}
		for i = 1, 16 do
			children[i] = { kind = "Sequence", children = {
				cond(ctx, "c" .. i, 16, 1, i - 1),
				action(ctx, "a" .. i, 2),
			} }
		end
		return { kind = "Fallback", children = children }
	elseif name == "deep" then
		-- 10 decorators stacked on one action, inside a 3-child sequence (depth 12).
		local node = action(ctx, "deep_action", 3, 4)
		for i = 1, 10 do
			if i % 3 == 0 then
				node = { kind = "ForceSuccess", child = node }
			else
				node = { kind = "Inverter", child = node }
			end
		end
		return { kind = "Sequence", children = { instant(ctx, "pre", SUCCESS), node, instant(ctx, "post", SUCCESS) } }
	elseif name == "reactive" then
		-- Reactive composites + timeout: lots of halting.
		return {
			kind = "ReactiveFallback",
			children = {
				cond(ctx, "alarm", 9, 3),
				{ kind = "Sequence", children = {
					{ kind = "Wait", seconds = 0.25 },
					action(ctx, "work", 4),
					action(ctx, "work2", 2, 2),
				} },
				{ kind = "ReactiveSequence", children = {
					cond(ctx, "calm", 5, 3),
					{ kind = "Timeout", seconds = 0.45, child = action(ctx, "slow", 100) },
				} },
			},
		}
	elseif name == "misc" then
		-- Opt-in (not in Scenarios.list): exercises the rest of the baseline catalogue. Only adapters that
		-- implement these kinds can run it: `--scenario=misc`.
		return {
			kind = "Fallback",
			children = {
				{ kind = "Sequence", children = {
					cond(ctx, "gate_ite", 7, 2),
					{ kind = "IfThenElse", children = {
						{ kind = "Sequence", children = { { kind = "Wait", seconds = 0.25 }, cond(ctx, "ite_c", 4, 2) } },
						action(ctx, "ite_then", 3),
						action(ctx, "ite_else", 2, 2),
					} },
				} },
				{ kind = "Sequence", children = {
					cond(ctx, "gate_wde", 11, 5),
					{ kind = "WhileDoElse", children = {
						cond(ctx, "wde_c", 6, 3),
						action(ctx, "wde_do", 5),
						action(ctx, "wde_else", 2),
					} },
				} },
				{ kind = "Sequence", children = {
					cond(ctx, "gate_try", 13, 4),
					{ kind = "TryCatch", children = { action(ctx, "try", 2, 2), action(ctx, "catch", 2), action(ctx, "finally", 2) } },
				} },
				{ kind = "MemorySequence", children = { cond(ctx, "mem_c", 5, 3), action(ctx, "mem_a", 2, 2), action(ctx, "mem_b", 2) } },
				{ kind = "Sequence", children = {
					{ kind = "WaitGate", seconds = 0.375 },
					{ kind = "KeepRunningUntilSuccess", max_attempts = 3, child = action(ctx, "krus", 1, 2) },
					{ kind = "KeepRunningUntilFailure", max_attempts = 2, child = action(ctx, "kruf", 1, 3) },
				} },
				{ kind = "Sequence", children = {
					{ kind = "FireAndForget", child = action(ctx, "faf", 1000) },
					{ kind = "RunningGate", child = action(ctx, "gated", 3) },
					{ kind = "Timeout", seconds = 0.5, behavior = "SUCCESS", child = { kind = "ForceRunning", child = action(ctx, "forced", 2) } },
					{ kind = "OneShot", reset_on_inactive = true, child = action(ctx, "once", 2, 2) },
					{ kind = "Repeat", count = 3, condition = "SUCCESS", child = action(ctx, "rep", 1, 3) },
					{ kind = "Cooldown", seconds = 0.5, reset_on_halt = true, child = action(ctx, "cool", 2) },
				} },
			},
		}
	end
	error("unknown scenario " .. tostring(name))
end

-- Count nodes in a spec (for reporting).
function Scenarios.count_nodes(spec)
	local n = 1
	if spec.children then
		for _, c in spec.children do n += Scenarios.count_nodes(c) end
	elseif spec.child then
		n += Scenarios.count_nodes(spec.child)
	end
	return n
end

return Scenarios
