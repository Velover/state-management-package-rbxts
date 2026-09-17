-- Adapter for the package build of src/BehaviorTree.ts (out/BehaviorTree.luau, built with `bun run build`).
-- The harness ids are used as slots directly, so leaf callbacks
-- receive the harness agent id with no wrapper: Bt2.Leaf with only OnTick returns the user's function itself.
local Bt2 = require("../../out/BehaviorTree").BTree

local function build(spec)
	local k = spec.kind
	if k == "Sequence" or k == "Fallback" or k == "ReactiveSequence" or k == "ReactiveFallback" or k == "MemorySequence" then
		local children = {}
		for i, c in spec.children do children[i] = build(c) end
		return Bt2[k](table.unpack(children))
	elseif k == "Parallel" then
		local children = {}
		for i, c in spec.children do children[i] = build(c) end
		return Bt2.Parallel(spec.success_policy, spec.failure_policy, table.unpack(children))
	elseif k == "IfThenElse" or k == "WhileDoElse" or k == "TryCatch" then
		local c = spec.children
		return Bt2[k](build(c[1]), build(c[2]), c[3] and build(c[3]) or nil)
	elseif k == "Inverter" or k == "ForceSuccess" or k == "ForceFailure" or k == "ForceRunning"
		or k == "FireAndForget" or k == "RunningGate" then
		return Bt2[k](build(spec.child))
	elseif k == "KeepRunningUntilSuccess" or k == "KeepRunningUntilFailure" then
		return Bt2[k](build(spec.child), spec.max_attempts)
	elseif k == "OneShot" then
		return Bt2.OneShot(build(spec.child), spec.reset_on_inactive)
	elseif k == "Repeat" then
		return Bt2.Repeat(spec.count, build(spec.child), spec.condition)
	elseif k == "Cooldown" then
		return Bt2.Cooldown(spec.seconds, build(spec.child), spec.reset_on_halt)
	elseif k == "Timeout" then
		return Bt2.Timeout(spec.seconds, build(spec.child), spec.behavior)
	elseif k == "Wait" then
		return Bt2.Wait(spec.seconds)
	elseif k == "WaitGate" then
		return Bt2.WaitGate(spec.seconds)
	elseif k == "Scope" then
		return Bt2.Scope({ OnEnter = spec.on_enter, OnExit = spec.on_exit })
	elseif k == "Leaf" then
		return Bt2.Leaf({ Name = spec.name, OnStart = spec.on_start, OnTick = spec.on_tick, OnHalt = spec.on_halt })
	end
	error("btree_ts adapter: unknown kind " .. tostring(k))
end

return {
	name = "btree_ts",
	new_world = function(spec)
		return { tree = Bt2.BehaviorTree.new(build(spec), { external_ids = true }) }
	end,
	add_agent = function(w, id)
		w.tree:AddAgent(id)
	end,
	remove_agent = function(w, id)
		w.tree:RemoveAgent(id)
	end,
	tick = function(w, dt)
		w.tree:Tick(dt)
	end,
	get_status = function(w, id)
		return w.tree:GetStatus(id)
	end,
}
