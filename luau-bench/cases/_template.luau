-- Template for a design case. Copy to cases/<name>.luau and fill in.
-- Spec format: harness/scenarios.luau. Semantics + adapter contract: SPEC.md.
local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING

-- Build your node representation from the spec here.
local function build(spec)
	error("not implemented")
end

return {
	name = "_template",

	-- Build the shared tree once. Returns whatever your tick needs.
	new_world = function(spec)
		return { root = build(spec), agents = {}, status = {} }
	end,

	-- id: positive integer chosen by the caller, may be reused after remove_agent.
	add_agent = function(world, id)
		error("not implemented")
	end,

	-- Must halt everything running for this agent (leaf on_halt fires) and free its state.
	remove_agent = function(world, id)
		error("not implemented")
	end,

	-- Tick every live agent.
	tick = function(world, dt)
		error("not implemented")
	end,

	-- Root status for this agent from the latest tick.
	get_status = function(world, id)
		return world.status[id]
	end,
}
