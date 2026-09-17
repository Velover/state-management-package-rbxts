-- bt2_ts with a Bt2.Scope (no callbacks) inserted as the first child of every Sequence/Fallback-family
-- composite, to measure what the visited-span tracking costs where it is placed.
local base = require("./btree_ts")
local function inject(spec)
	if spec.children then
		local kids = {}
		if spec.kind == "Sequence" or spec.kind == "ReactiveSequence" or spec.kind == "MemorySequence" then kids[1] = { kind = "Scope" } end
		for _, c in spec.children do kids[#kids + 1] = inject(c) end
		return setmetatable({ children = kids }, { __index = spec })
	elseif spec.child then
		return setmetatable({ child = inject(spec.child) }, { __index = spec })
	end
	return spec
end
return {
	name = "btree_ts_scoped",
	new_world = function(spec) return base.new_world(inject(spec)) end,
	add_agent = base.add_agent,
	remove_agent = base.remove_agent,
	tick = base.tick,
	get_status = base.get_status,
}
