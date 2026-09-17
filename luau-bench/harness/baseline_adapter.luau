-- Adapter for the current implementation (compiled from src/BehaviorTree.ts): one tree instance per agent.
local BT = require("../baseline/BehaviorTree").BTree
local Blackboard = require("../baseline/Blackboard").Blackboard
local S = require("./status")

local shared_bb = Blackboard.new({}, {})

local function build(spec, agent)
	local k = spec.kind
	if k == "Sequence" or k == "Fallback" or k == "ReactiveSequence" or k == "ReactiveFallback"
		or k == "MemorySequence" or k == "IfThenElse" or k == "WhileDoElse" or k == "TryCatch" then
		local n = BT[k].new()
		for _, c in spec.children do n:AddChild(build(c, agent)) end
		return n
	elseif k == "Parallel" then
		local n = BT.Parallel.new(spec.success_policy, spec.failure_policy)
		for _, c in spec.children do n:AddChild(build(c, agent)) end
		return n
	elseif k == "Inverter" or k == "ForceSuccess" or k == "ForceFailure" or k == "ForceRunning"
		or k == "FireAndForget" or k == "RunningGate" then
		return BT[k].new(build(spec.child, agent))
	elseif k == "KeepRunningUntilSuccess" or k == "KeepRunningUntilFailure" then
		return BT[k].new(build(spec.child, agent), spec.max_attempts)
	elseif k == "OneShot" then
		return BT.OneShot.new(build(spec.child, agent), spec.reset_on_inactive)
	elseif k == "Repeat" then
		return BT.Repeat.new(build(spec.child, agent), spec.count, spec.condition)
	elseif k == "Cooldown" then
		return BT.Cooldown.new(build(spec.child, agent), spec.seconds, spec.reset_on_halt)
	elseif k == "Timeout" then
		return BT.Timeout.new(build(spec.child, agent), spec.seconds, spec.behavior)
	elseif k == "Wait" then
		return BT.Wait.new(spec.seconds)
	elseif k == "WaitGate" then
		return BT.WaitGate.new(spec.seconds)
	elseif k == "Leaf" then
		local on_start, on_tick, on_halt = spec.on_start, spec.on_tick, spec.on_halt
		return BT.FullAction.new({
			OnStart = function(bb)
				if on_start then on_start(agent) end
				return S.RUNNING
			end,
			OnTick = function(dt, bb)
				return on_tick(agent, dt)
			end,
			OnHalt = function(bb)
				if on_halt then on_halt(agent) end
			end,
		})
	end
	error("baseline adapter: unknown kind " .. tostring(k))
end

return {
	name = "baseline",
	new_world = function(spec)
		return { spec = spec, trees = {}, status = {}, order = {} }
	end,
	add_agent = function(w, id)
		w.trees[id] = BT.BehaviorTree.new(build(w.spec, id), shared_bb)
		w.order[#w.order + 1] = id
	end,
	remove_agent = function(w, id)
		w.trees[id]:Halt()
		w.trees[id] = nil
		w.status[id] = nil
		local i = table.find(w.order, id)
		if i then table.remove(w.order, i) end
	end,
	tick = function(w, dt)
		local trees, status = w.trees, w.status
		for _, id in w.order do
			status[id] = trees[id]:Tick(dt)
		end
	end,
	get_status = function(w, id)
		return w.status[id]
	end,
}
