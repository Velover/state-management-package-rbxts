-- Unit checks for the BTree nodes whose API has no baseline equivalent (Switch, Timer, WasFieldUpdated,
-- fields, slot handling, FireAndForget bracketing, deferred add/remove, leaf exit hooks).
-- Run: lune run luau-bench/tests/btree_extra.luau
local Bt2 = require("../../out/BehaviorTree").BTree
local S, F, R = 0, 1, 2
local DT = 0.125

local passed, failed = 0, 0
local function test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		passed += 1
	else
		failed += 1
		print("FAIL " .. name .. ": " .. tostring(err))
	end
end
local function expect(cond, msg)
	if not cond then error(msg, 2) end
end

test("Switch selects a case at start, keeps it while running, falls back to default", function()
	local key = {}
	local sw = Bt2.Switch(function(slot) return key[slot] end, {
		sword = Bt2.Plug(S),
		bow = Bt2.Plug(R),
	}, Bt2.Plug(F))
	local tree = Bt2.BehaviorTree.new(sw)
	tree:RegisterField(key)
	local a, b, c = tree:AddAgent(), tree:AddAgent(), tree:AddAgent()
	key[a], key[b] = "sword", "bow"
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "sword case")
	expect(tree:GetStatus(b) == R, "bow case")
	expect(tree:GetStatus(c) == F, "no key -> default")
	key[b] = "sword"
	tree:Tick(DT)
	expect(tree:GetStatus(b) == R, "running case keeps its selection")
	tree:RemoveAgent(b)
	expect(key[b] == nil, "registered field cleared on remove")
end)

test("Switch without default fails on unknown key", function()
	local sw = Bt2.Switch(function() return "x" end, { a = Bt2.Plug(S) })
	local tree = Bt2.BehaviorTree.new(sw)
	local a = tree:AddAgent()
	tree:Tick(DT)
	expect(tree:GetStatus(a) == F, "FAILURE without default")
end)

test("Timer counts a field down", function()
	local tree
	local timer = Bt2.Timer(setmetatable({}, { __index = function(t, k) return nil end }))
	tree = Bt2.BehaviorTree.new(Bt2.Plug(S))
	local field = tree:Field()
	local t2 = Bt2.BehaviorTree.new(Bt2.Timer(field))
	local a = t2:AddAgent()
	local b = t2:AddAgent()
	field[a] = 0.3
	t2:Tick(DT)
	expect(t2:GetStatus(a) == F and t2:GetStatus(b) == F, "positive / absent -> FAILURE")
	t2:Tick(DT)
	expect(t2:GetStatus(a) == F, "still positive")
	t2:Tick(DT)
	expect(t2:GetStatus(a) == S, "reached zero -> SUCCESS")
	expect(field[a] <= 0, "field written back")
end)

test("WasFieldUpdated reports changes and resets after a gap", function()
	local gate = {}
	local tree
	local hp = {}
	local root = Bt2.Sequence(
		Bt2.Condition(function(slot) return gate[slot] == true end),
		Bt2.WasFieldUpdated({ hp })
	)
	tree = Bt2.BehaviorTree.new(root)
	tree:RegisterField(gate)
	tree:RegisterField(hp)
	local a = tree:AddAgent()
	gate[a] = true
	hp[a] = 10
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "first visit reports SUCCESS")
	tree:Tick(DT)
	expect(tree:GetStatus(a) == F, "unchanged -> FAILURE")
	hp[a] = 11
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "changed -> SUCCESS")
	gate[a] = false
	tree:Tick(DT)
	gate[a] = true
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "after a gap the first visit reports SUCCESS again")

	local root2 = Bt2.WasFieldUpdated({ hp }, true)
	local t2 = Bt2.BehaviorTree.new(root2)
	local b = t2:AddAgent()
	hp[b] = 1
	t2:Tick(DT)
	expect(t2:GetStatus(b) == F, "skip_first: first visit reports FAILURE")
	hp[b] = 2
	t2:Tick(DT)
	expect(t2:GetStatus(b) == S, "skip_first: later change reports SUCCESS")
end)

test("FireAndForget brackets branch visits with OnStart / OnHalt", function()
	local gate = {}
	local events = {}
	local root = Bt2.Fallback(
		Bt2.Sequence(
			Bt2.Condition(function(slot) return gate[slot] == true end),
			Bt2.FireAndForget(Bt2.Leaf({
				OnStart = function(slot) events[#events + 1] = "start" .. slot end,
				OnTick = function() return R end,
				OnHalt = function(slot) events[#events + 1] = "halt" .. slot end,
			}))
		),
		Bt2.Plug(S)
	)
	local tree = Bt2.BehaviorTree.new(root)
	tree:RegisterField(gate)
	local a = tree:AddAgent()
	gate[a] = true
	tree:Tick(DT)
	tree:Tick(DT)
	expect(table.concat(events, ",") == "start1", "one start while visited")
	gate[a] = false
	tree:Tick(DT)
	expect(table.concat(events, ",") == "start1,halt1", "halt at the end of the first unvisited tick")
	gate[a] = true
	tree:Tick(DT)
	tree:RemoveAgent(a)
	expect(table.concat(events, ",") == "start1,halt1,start1,halt1", "remove halts a detached child")
end)

test("External-id tree (ECS): ids are the slots, duplicates throw, nothing is recycled", function()
	local tree = Bt2.BehaviorTree.new(Bt2.Plug(S), { external_ids = true })
	expect(tree:UsesExternalIds(), "mode flag")
	expect(tree:AddAgent(5000) == 5000, "explicit id is the slot")
	local ok, err = pcall(function() tree:AddAgent(5000) end)
	expect(not ok and tostring(err):find("already exists"), "duplicate id throws: " .. tostring(err))
	for _, bad in { 0, -1, 1.5, 0 / 0 } do
		expect(not pcall(function() tree:AddAgent(bad) end), "rejects " .. tostring(bad))
	end
	expect(not pcall(function() tree:AddAgent() end), "no-argument AddAgent throws in external mode")
	tree:RemoveAgent(5000)
	expect(not tree:HasAgent(5000), "removed")
	expect(tree:AddAgent(5000) == 5000, "the caller may reuse the id after removal")
	expect(tree:GetAgentCount() == 1, "one live")
end)

test("Allocating tree: dense slots, recycled after removal, explicit ids rejected", function()
	local tree = Bt2.BehaviorTree.new(Bt2.Plug(S))
	expect(not tree:UsesExternalIds(), "mode flag")
	local a, b, c = tree:AddAgent(), tree:AddAgent(), tree:AddAgent()
	expect(a == 1 and b == 2 and c == 3, "dense from 1")
	expect(not pcall(function() tree:AddAgent(7) end), "explicit id throws in allocating mode")
	tree:RemoveAgent(b)
	expect(tree:AddAgent() == 2, "freed slot recycled")
	expect(tree:AddAgent() == 4, "then the next fresh one")
end)

test("RemoveAgent and AddAgent during Tick are deferred and halts still fire", function()
	local tree
	local halts = 0
	local root = Bt2.Sequence(
		Bt2.Callback(function(slot)
			if slot == 1 then
				tree:RemoveAgent(1)
				tree:AddAgent()
			end
		end),
		Bt2.Leaf({ OnTick = function() return R end, OnHalt = function() halts += 1 end })
	)
	tree = Bt2.BehaviorTree.new(root)
	tree:AddAgent()
	tree:AddAgent()
	tree:Tick(DT)
	expect(tree:GetAgentCount() == 2, "one removed, one added after the tick")
	expect(not tree:HasAgent(1), "agent 1 removed")
	expect(halts == 1, "the running leaf of the removed agent was halted")
	tree:Tick(DT)
	expect(tree:GetAgentCount() == 2, "stable")
end)

test("Removing the same agent twice during one tick is harmless", function()
	local tree
	local halts = 0
	local root = Bt2.Sequence(
		Bt2.Callback(function(slot)
			if slot == 2 then
				tree:RemoveAgent(2)
				tree:RemoveAgent(2)
			end
		end),
		Bt2.Leaf({ OnTick = function() return R end, OnHalt = function() halts += 1 end })
	)
	tree = Bt2.BehaviorTree.new(root)
	tree:AddAgent()
	tree:AddAgent()
	tree:AddAgent()
	tree:Tick(DT)
	expect(tree:GetAgentCount() == 2, "one agent removed once")
	expect(halts == 1, "halted once")
	expect(tree:HasAgent(1) and tree:HasAgent(3) and not tree:HasAgent(2), "the right agents remain")
	tree:Tick(DT)
	expect(tree:GetAgentCount() == 2, "live list intact")
	local d = tree:AddAgent()
	expect(d == 2, "freed slot reused once")
end)

test("Field cleanup and OnAgentRemoved run on removal, after halt, before clearing", function()
	local log = {}
	local tree
	local leaf = Bt2.Leaf({ OnTick = function() return R end, OnHalt = function(slot) log[#log + 1] = "halt" .. slot end })
	tree = Bt2.BehaviorTree.new(leaf)
	local models = tree:Field(function(slot, value) log[#log + 1] = "destroy:" .. value end)
	local score = {}
	tree:RegisterField(score, function(slot, value) log[#log + 1] = "unrank:" .. value end)
	tree:OnAgentRemoved(function(slot, t)
		log[#log + 1] = "removed" .. slot .. ":" .. tostring(models[slot]) -- fields still readable here
	end)
	local a, b = tree:AddAgent(), tree:AddAgent()
	models[a] = "modelA"
	score[a] = 10
	models[b] = "modelB" -- b has no score entry: its cleanup must not run
	tree:Tick(DT)
	tree:RemoveAgent(a)
	expect(table.concat(log, ",") == "halt1,removed1:modelA,destroy:modelA,unrank:10", table.concat(log, ","))
	expect(models[a] == nil and score[a] == nil, "fields cleared afterwards")
	log = {}
	tree:RemoveAgent(b)
	expect(table.concat(log, ",") == "halt2,removed2:modelB,destroy:modelB", table.concat(log, ","))
end)

test("Scope brackets visits: enter on first visit, exit after the first unvisited tick", function()
	local gate = {}
	local log = {}
	local root = Bt2.Fallback(
		Bt2.Sequence(
			Bt2.Condition(function(slot) return gate[slot] == true end),
			Bt2.Scope({
				OnEnter = function(slot) log[#log + 1] = "enter" .. slot end,
				OnExit = function(slot) log[#log + 1] = "exit" .. slot end,
			}),
			Bt2.Plug(S)
		),
		Bt2.Plug(S)
	)
	local tree = Bt2.BehaviorTree.new(root)
	tree:RegisterField(gate)
	local a, b = tree:AddAgent(), tree:AddAgent()
	gate[a] = true
	tree:Tick(DT)
	tree:Tick(DT)
	tree:Tick(DT)
	expect(table.concat(log, ",") == "enter1", "one enter for three visited ticks, none for agent 2")
	gate[a] = false
	tree:Tick(DT)
	expect(table.concat(log, ",") == "enter1,exit1", "exit at the end of the first unvisited tick")
	tree:Tick(DT)
	expect(table.concat(log, ",") == "enter1,exit1", "no repeat")
	gate[a] = true
	tree:Tick(DT)
	tree:RemoveAgent(a)
	expect(table.concat(log, ",") == "enter1,exit1,enter1,exit1", "re-enter, and RemoveAgent exits")
	gate[b] = true
	tree:Tick(DT)
	tree:Halt(b)
	expect(table.concat(log, ",") == "enter1,exit1,enter1,exit1,enter2,exit2", "Halt exits too")
end)

test("Scoped wraps a subtree, passes status through, halts its running child on exit", function()
	local gate = {}
	local log = {}
	local n = 0
	-- ReactiveSequence re-checks the gate every tick, so a running Scoped child gets halted when it closes.
	local root = Bt2.Fallback(
		Bt2.ReactiveSequence(
			Bt2.Condition(function(slot) return gate[slot] == true end),
			Bt2.Scoped({
				OnEnter = function(slot) log[#log + 1] = "enter" end,
				OnExit = function(slot) log[#log + 1] = "exit" end,
			}, Bt2.Leaf({
				OnStart = function() log[#log + 1] = "start" end,
				OnTick = function()
					n += 1
					return n % 3 == 0 and S or R
				end,
				OnHalt = function() log[#log + 1] = "halt" end,
			}))
		),
		Bt2.Plug(F)
	)
	local tree = Bt2.BehaviorTree.new(root)
	tree:RegisterField(gate)
	local a = tree:AddAgent()
	gate[a] = true
	tree:Tick(DT)
	expect(tree:GetStatus(a) == R, "child RUNNING passes through")
	tree:Tick(DT)
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "child SUCCESS passes through")
	tree:Tick(DT) -- child starts a new run (RUNNING)
	expect(table.concat(log, ",") == "enter,start,start", "one enter across two child runs: " .. table.concat(log, ","))
	gate[a] = false
	tree:Tick(DT) -- gate fails: the reactive sequence halts Scoped (cascade), which halts the child and exits
	expect(table.concat(log, ",") == "enter,start,start,halt,exit", "halt cascade: " .. table.concat(log, ","))
	gate[a] = true
	tree:Tick(DT)
	tree:Tick(DT) -- n = 6 -> SUCCESS this tick, so the child is idle and Scoped sits on the detached list
	expect(tree:GetStatus(a) == S, "success again")
	gate[a] = false
	tree:Tick(DT) -- not visited: exit via the detached-list sweep, no halt (child idle)
	expect(table.concat(log, ",") == "enter,start,start,halt,exit,enter,start,exit", "sweep exit: " .. table.concat(log, ","))
	gate[a] = true
	tree:Tick(DT) -- n = 7 -> RUNNING
	tree:HaltAll()
	expect(table.concat(log, ",") == "enter,start,start,halt,exit,enter,start,exit,enter,start,halt,exit", "HaltAll: " .. table.concat(log, ","))
end)

test("Leaf OnEnter / OnLeave bracket visits across runs; absent hooks keep the bare shape", function()
	local bare = Bt2.Leaf({ OnTick = function() return S end })
	expect(#bare.Maps == 0, "no enter/leave -> no state")
	local gate, log, n = {}, {}, 0
	local root = Bt2.Fallback(
		Bt2.ReactiveSequence(
			Bt2.Condition(function(slot) return gate[slot] == true end),
			Bt2.Leaf({
				OnEnter = function() log[#log + 1] = "enter" end,
				OnStart = function() log[#log + 1] = "start" end,
				OnTick = function()
					n += 1
					return n % 2 == 0 and S or R
				end,
				OnHalt = function() log[#log + 1] = "halt" end,
				OnLeave = function() log[#log + 1] = "leave" end,
			})
		),
		Bt2.Plug(F)
	)
	local tree = Bt2.BehaviorTree.new(root)
	tree:RegisterField(gate)
	local a = tree:AddAgent()
	gate[a] = true
	for _ = 1, 4 do tree:Tick(DT) end -- two full runs
	expect(table.concat(log, ",") == "enter,start,start", "one enter for two runs: " .. table.concat(log, ","))
	gate[a] = false
	tree:Tick(DT) -- idle child, not visited: leave via sweep
	expect(table.concat(log, ",") == "enter,start,start,leave", "leave: " .. table.concat(log, ","))
	gate[a] = true
	tree:Tick(DT) -- running
	gate[a] = false
	tree:Tick(DT) -- halted by the reactive sequence, then leave
	expect(table.concat(log, ",") == "enter,start,start,leave,enter,start,halt,leave", "halt then leave: " .. table.concat(log, ","))
end)

test("Leaf exit hooks fire in order and on halt", function()
	local log = {}
	local status = R
	local leaf = Bt2.Leaf({
		OnStart = function() log[#log + 1] = "start" end,
		OnTick = function() return status end,
		OnSuccess = function() log[#log + 1] = "success" end,
		OnFailure = function() log[#log + 1] = "failure" end,
		OnExit = function(s) log[#log + 1] = "exit" .. s end,
		OnHalt = function() log[#log + 1] = "halt" end,
	})
	local tree = Bt2.BehaviorTree.new(leaf)
	local a = tree:AddAgent()
	tree:Tick(DT)
	status = S
	tree:Tick(DT)
	expect(table.concat(log, ",") == "start,success,exit0", "start once, success then exit")
	status = R
	tree:Tick(DT)
	tree:Halt(a)
	expect(table.concat(log, ",") == "start,success,exit0,start,halt,exit2", "halt then exit(RUNNING)")
	expect(tree:GetStatus(a) == nil, "status cleared by Halt")
end)

test("HaltAll halts every running agent and per-node state is cleared on remove", function()
	local halts = 0
	local wait = Bt2.Wait(1)
	local root = Bt2.Sequence(wait, Bt2.Leaf({ OnTick = function() return R end, OnHalt = function() halts += 1 end }))
	local tree = Bt2.BehaviorTree.new(root)
	tree:AddAgent()
	tree:AddAgent()
	tree:Tick(DT)
	expect(next(wait.Maps[1]) ~= nil, "wait holds per-agent state while running")
	tree:HaltAll()
	expect(next(wait.Maps[1]) == nil, "halt clears the wait timers")
	for _ = 1, 9 do tree:Tick(DT) end
	tree:Tick(DT)
	tree:HaltAll()
	expect(halts == 2, "both running leaves halted")
	tree:RemoveAgent(1)
	tree:RemoveAgent(2)
	for _, m in root.Maps do
		expect(next(m) == nil, "every state map empty after removing all agents")
	end
end)

test("Parallel halts the other running children on early-out", function()
	local halted = {}
	local function runner(name)
		return Bt2.Leaf({ OnTick = function() return R end, OnHalt = function() halted[#halted + 1] = name end })
	end
	local n = 0
	local root = Bt2.Parallel("ONE", "ONE", runner("a"), Bt2.Action(function()
		n += 1
		return n >= 2 and S or R
	end), runner("c"))
	local tree = Bt2.BehaviorTree.new(root)
	local a = tree:AddAgent()
	tree:Tick(DT)
	expect(tree:GetStatus(a) == R, "running")
	tree:Tick(DT)
	expect(tree:GetStatus(a) == S, "one success -> SUCCESS")
	table.sort(halted)
	expect(table.concat(halted, ",") == "a,c", "others halted")
end)

print(string.format("btree_extra: %d passed, %d failed", passed, failed))
if failed > 0 then error("btree_extra failed") end
