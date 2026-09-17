--!optimize 2
-- (e) Batch vs per-agent structure: A agents x 20 nodes, three loop shapes, with and without
--     per-(node, agent) state, dense ids vs sparse ids.
local B = require("./bench")

local NN = 20

local function mkdata(A, sparse)
	return function()
		local agents = table.create(A)
		for i = 1, A do agents[i] = sparse and i * 1000 or i end
		local nodes = table.create(NN)
		for n = 1, NN do
			local st = {}
			for i = 1, A do st[agents[i]] = 0 end
			nodes[n] = { s = st, hits = 0 }
		end
		return { agents = agents, na = A, nodes = nodes, nn = NN }
	end
end

local SETUP = table.concat({
	"\tlocal agents = D.agents",
	"\tlocal na = D.na",
	"\tlocal nodes = D.nodes",
	"\tlocal nn = D.nn",
}, "\n")

local F_TINY = "\tlocal function f(node, agent) node.hits = agent end"
local G_TINY = "\tlocal function g(node, agents, n) for i = 1, n do node.hits = agents[i] end end"
local F_STATE = "\tlocal function f(node, agent) local st = node.s st[agent] = st[agent] + 1 end"
local G_STATE = "\tlocal function g(node, agents, n) local st = node.s for i = 1, n do local a = agents[i] st[a] = st[a] + 1 end end"

local AGENT_MAJOR = "for ai = 1, na do local agent = agents[ai] for ni = 1, nn do f(nodes[ni], agent) end end s = s + 1"
local NODE_MAJOR = "for ni = 1, nn do local node = nodes[ni] for ai = 1, na do f(node, agents[ai]) end end s = s + 1"
local NODE_BATCH = "for ni = 1, nn do g(nodes[ni], agents, na) end s = s + 1"
local INLINE_NODE = "for ni = 1, nn do local st = nodes[ni].s for ai = 1, na do local a = agents[ai] st[a] = st[a] + 1 end end s = s + 1"
local INLINE_AGENT = "for ai = 1, na do local a = agents[ai] for ni = 1, nn do local st = nodes[ni].s st[a] = st[a] + 1 end end s = s + 1"

local function run(A, sparse)
	local ops = A * NN
	local iters = math.max(24, math.floor(1300000 / ops))
	local data = mkdata(A, sparse)
	B.suite({
		title = string.format("(e) %d agent%s x %d nodes%s — ns per (node, agent)",
			A, A == 1 and "" or "s", NN, sparse and ", SPARSE ids (1000, 2000, ...)" or ", dense ids 1..N"),
		setup = SETUP,
		data = data,
		unroll = 1,
		iters = iters,
		cases = {
			{ name = "(i) agent-major, `f(node, agent)` — tiny fn, no state",
				setup = F_TINY, body = AGENT_MAJOR, opsmul = ops },
			{ name = "(ii) node-major, `f(node, agent)` — tiny fn, no state",
				setup = F_TINY, body = NODE_MAJOR, opsmul = ops },
			{ name = "(iii) node-major batched, `g(node, agents, n)` — tiny fn, no state",
				setup = G_TINY, body = NODE_BATCH, opsmul = ops },
			{ name = "(i-s) agent-major, `f` reads+writes `node.s[agent]`",
				setup = F_STATE, body = AGENT_MAJOR, opsmul = ops },
			{ name = "(ii-s) node-major, `f` reads+writes `node.s[agent]`",
				setup = F_STATE, body = NODE_MAJOR, opsmul = ops },
			{ name = "(iii-s) node-major batched, `g` hoists `node.s`, loops agents inside",
				setup = G_STATE, body = NODE_BATCH, opsmul = ops },
			{ name = "(iv-s) node-major, fully inlined (no call at all) — the ceiling",
				setup = "", body = INLINE_NODE, opsmul = ops },
			{ name = "(v-s) agent-major, fully inlined (no call at all)",
				setup = "", body = INLINE_AGENT, opsmul = ops },
		},
	})
end

return function()
	B.header("(e) Batch vs per-agent structure (20 nodes)")
	run(1, false)
	run(10, false)
	run(100, false)
	run(1000, false)
	run(1000, true)
end
