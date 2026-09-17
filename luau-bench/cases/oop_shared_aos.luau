--!optimize 2
-- oop_shared_aos: variant (c) of oop_shared -- same shared tree, same classes, same halting
-- cascade, but per-agent state is Array-of-Structs: every node keeps ONE record table per agent
-- (`self.state[agent] = { running = false, cursor = 0 }`) instead of one map per field
-- (`self.cursor[agent]`). Measures what the Struct-of-Maps layout buys: node field access becomes
-- a double lookup (`self.state[agent].cursor`) and add_agent allocates one table per node.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING
local NONE = -1

---------------------------------------------------------------------------------------------------
-- Node (base)
---------------------------------------------------------------------------------------------------
local Node = {}
Node.__index = Node

function Node:IsRunning(agent)
	return self.state[agent].running
end

function Node:Halt(agent)
	self.state[agent].running = false
end

---------------------------------------------------------------------------------------------------
-- Composite
---------------------------------------------------------------------------------------------------
local Composite = setmetatable({}, { __index = Node })
Composite.__index = Composite

function Composite:Halt(agent)
	local s = self.state[agent]
	if not s.running then
		return
	end
	s.running = false
	local children = self.children
	for i = 1, self.n do
		local c = children[i]
		if c.state[agent].running then
			c:Halt(agent)
		end
	end
end

function Composite:HaltOthers(agent, except)
	local children = self.children
	for i = 1, self.n do
		if i ~= except then
			local c = children[i]
			if c.state[agent].running then
				c:Halt(agent)
			end
		end
	end
end

function Composite:HaltFrom(agent, from)
	local children = self.children
	for i = from, self.n do
		local c = children[i]
		if c.state[agent].running then
			c:Halt(agent)
		end
	end
end

---------------------------------------------------------------------------------------------------
-- Decorator
---------------------------------------------------------------------------------------------------
local Decorator = setmetatable({}, { __index = Node })
Decorator.__index = Decorator

function Decorator:Halt(agent)
	local s = self.state[agent]
	if not s.running then
		return
	end
	s.running = false
	local c = self.child
	if c.state[agent].running then
		c:Halt(agent)
	end
end

---------------------------------------------------------------------------------------------------
-- Sequence / Fallback
---------------------------------------------------------------------------------------------------
local Sequence = setmetatable({}, { __index = Composite })
Sequence.__index = Sequence

function Sequence:Tick(agent, dt)
	local s = self.state[agent]
	local i
	if s.running then
		i = s.cursor
	else
		s.running = true
		i = 1
	end
	local children, n = self.children, self.n
	while i <= n do
		local st = children[i]:Tick(agent, dt)
		if st == RUNNING then
			s.cursor = i
			return RUNNING
		elseif st == FAILURE then
			s.running = false
			return FAILURE
		end
		i += 1
	end
	s.running = false
	return SUCCESS
end

function Sequence:Halt(agent)
	local s = self.state[agent]
	if not s.running then
		return
	end
	s.running = false
	local c = self.children[s.cursor]
	if c and c.state[agent].running then
		c:Halt(agent)
	end
end

local Fallback = setmetatable({}, { __index = Composite })
Fallback.__index = Fallback
Fallback.Halt = Sequence.Halt

function Fallback:Tick(agent, dt)
	local s = self.state[agent]
	local i
	if s.running then
		i = s.cursor
	else
		s.running = true
		i = 1
	end
	local children, n = self.children, self.n
	while i <= n do
		local st = children[i]:Tick(agent, dt)
		if st == RUNNING then
			s.cursor = i
			return RUNNING
		elseif st == SUCCESS then
			s.running = false
			return SUCCESS
		end
		i += 1
	end
	s.running = false
	return FAILURE
end

---------------------------------------------------------------------------------------------------
-- ReactiveSequence / ReactiveFallback
---------------------------------------------------------------------------------------------------
local ReactiveSequence = setmetatable({}, { __index = Composite })
ReactiveSequence.__index = ReactiveSequence

function ReactiveSequence:Tick(agent, dt)
	local s = self.state[agent]
	s.running = true
	local children, n = self.children, self.n
	for i = 1, n do
		local st = children[i]:Tick(agent, dt)
		if st == RUNNING then
			if i < n then
				self:HaltFrom(agent, i + 1)
			end
			return RUNNING
		elseif st == FAILURE then
			if i < n then
				self:HaltFrom(agent, i + 1)
			end
			s.running = false
			return FAILURE
		end
	end
	s.running = false
	return SUCCESS
end

local ReactiveFallback = setmetatable({}, { __index = Composite })
ReactiveFallback.__index = ReactiveFallback

function ReactiveFallback:Tick(agent, dt)
	local s = self.state[agent]
	s.running = true
	local children, n = self.children, self.n
	for i = 1, n do
		local st = children[i]:Tick(agent, dt)
		if st ~= FAILURE then
			if i < n then
				self:HaltFrom(agent, i + 1)
			end
			if st == SUCCESS then
				s.running = false
			end
			return st
		end
	end
	s.running = false
	return FAILURE
end

---------------------------------------------------------------------------------------------------
-- Parallel
---------------------------------------------------------------------------------------------------
local Parallel = setmetatable({}, { __index = Composite })
Parallel.__index = Parallel

function Parallel:Tick(agent, dt)
	local s = self.state[agent]
	local children, n = self.children, self.n
	local done = s.done
	if not s.running then
		s.running = true
		for i = 1, n do
			done[i] = NONE
		end
	end
	local sc, fc = 0, 0
	for i = 1, n do
		local cs = done[i]
		if cs == NONE then
			local st = children[i]:Tick(agent, dt)
			if st == SUCCESS then
				sc += 1
				done[i] = SUCCESS
				if self.success_one then
					self:HaltOthers(agent, i)
					s.running = false
					return SUCCESS
				end
			elseif st == FAILURE then
				fc += 1
				done[i] = FAILURE
				if self.failure_one then
					self:HaltOthers(agent, i)
					s.running = false
					return FAILURE
				end
			end
		elseif cs == SUCCESS then
			sc += 1
		else
			fc += 1
		end
	end
	if self.success_all and sc == n then
		s.running = false
		return SUCCESS
	end
	if self.failure_all and fc == n then
		s.running = false
		return FAILURE
	end
	return RUNNING
end

---------------------------------------------------------------------------------------------------
-- Decorators
---------------------------------------------------------------------------------------------------
local Inverter = setmetatable({}, { __index = Decorator })
Inverter.__index = Inverter

function Inverter:Tick(agent, dt)
	local s = self.state[agent]
	s.running = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	s.running = false
	return if st == SUCCESS then FAILURE else SUCCESS
end

local ForceSuccess = setmetatable({}, { __index = Decorator })
ForceSuccess.__index = ForceSuccess

function ForceSuccess:Tick(agent, dt)
	local s = self.state[agent]
	s.running = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	s.running = false
	return SUCCESS
end

local ForceFailure = setmetatable({}, { __index = Decorator })
ForceFailure.__index = ForceFailure

function ForceFailure:Tick(agent, dt)
	local s = self.state[agent]
	s.running = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	s.running = false
	return FAILURE
end

local Repeat = setmetatable({}, { __index = Decorator })
Repeat.__index = Repeat

function Repeat:Tick(agent, dt)
	local s = self.state[agent]
	local k
	if s.running then
		k = s.done
	else
		s.running = true
		k = 0
		s.done = 0
	end
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	k += 1
	if k >= self.count then
		s.running = false
		return SUCCESS
	end
	s.done = k
	return RUNNING
end

local Timeout = setmetatable({}, { __index = Decorator })
Timeout.__index = Timeout

function Timeout:Tick(agent, dt)
	local s = self.state[agent]
	local t
	if s.running then
		t = s.time_left - dt
	else
		s.running = true
		t = self.seconds - dt
	end
	s.time_left = t
	if t <= 0 then
		s.running = false
		local c = self.child
		if c.state[agent].running then
			c:Halt(agent)
		end
		return FAILURE
	end
	local st = self.child:Tick(agent, dt)
	if st ~= RUNNING then
		s.running = false
	end
	return st
end

local Cooldown = setmetatable({}, { __index = Decorator })
Cooldown.__index = Cooldown

function Cooldown:Tick(agent, dt)
	local s = self.state[agent]
	local t = s.time_left - dt
	s.time_left = t
	if t > 0 then
		s.running = false
		return FAILURE
	end
	s.running = true
	local st = self.child:Tick(agent, dt)
	if st ~= RUNNING then
		s.running = false
		s.time_left = self.seconds
	end
	return st
end

---------------------------------------------------------------------------------------------------
-- Leaves
---------------------------------------------------------------------------------------------------
local Wait = setmetatable({}, { __index = Node })
Wait.__index = Wait

function Wait:Tick(agent, dt)
	local s = self.state[agent]
	local t
	if s.running then
		t = s.time_left - dt
	else
		s.running = true
		t = self.seconds - dt
	end
	if t <= 0 then
		s.running = false
		return SUCCESS
	end
	s.time_left = t
	return RUNNING
end

local Leaf = setmetatable({}, { __index = Node })
Leaf.__index = Leaf

function Leaf:Tick(agent, dt)
	local s = self.state[agent]
	if not s.running then
		s.running = true
		local start = self.on_start
		if start then
			start(agent)
		end
	end
	local st = self.on_tick(agent, dt)
	if st ~= RUNNING then
		s.running = false
	end
	return st
end

function Leaf:Halt(agent)
	local s = self.state[agent]
	if not s.running then
		return
	end
	s.running = false
	local halt = self.on_halt
	if halt then
		halt(agent)
	end
end

---------------------------------------------------------------------------------------------------
-- build
---------------------------------------------------------------------------------------------------
local function build(spec, reg)
	local k = spec.kind
	local self, maker
	if k == "Sequence" or k == "Fallback" then
		self = setmetatable({}, if k == "Sequence" then Sequence else Fallback)
		maker = function()
			return { running = false, cursor = 0 }
		end
	elseif k == "ReactiveSequence" then
		self = setmetatable({}, ReactiveSequence)
	elseif k == "ReactiveFallback" then
		self = setmetatable({}, ReactiveFallback)
	elseif k == "Parallel" then
		self = setmetatable({
			success_one = spec.success_policy == "ONE",
			failure_one = spec.failure_policy == "ONE",
			success_all = spec.success_policy == "ALL",
			failure_all = spec.failure_policy == "ALL",
		}, Parallel)
		local n = #spec.children
		maker = function()
			return { running = false, done = table.create(n, NONE) }
		end
	elseif k == "Inverter" then
		self = setmetatable({}, Inverter)
	elseif k == "ForceSuccess" then
		self = setmetatable({}, ForceSuccess)
	elseif k == "ForceFailure" then
		self = setmetatable({}, ForceFailure)
	elseif k == "Repeat" then
		assert(spec.count >= 1, "Repeat count must be >= 1")
		self = setmetatable({ count = spec.count }, Repeat)
		maker = function()
			return { running = false, done = 0 }
		end
	elseif k == "Timeout" or k == "Cooldown" or k == "Wait" then
		self = setmetatable({ seconds = spec.seconds }, if k == "Timeout" then Timeout elseif k == "Cooldown" then Cooldown else Wait)
		maker = function()
			return { running = false, time_left = 0 }
		end
	elseif k == "Leaf" then
		self = setmetatable({
			name = spec.name,
			on_start = spec.on_start or false,
			on_tick = spec.on_tick,
			on_halt = spec.on_halt or false,
		}, Leaf)
	else
		error("oop_shared_aos: unknown kind " .. tostring(k))
	end
	if maker == nil then
		maker = function()
			return { running = false }
		end
	end
	local states = {}
	self.state = states
	local i = #reg.states + 1
	reg.states[i] = states
	reg.makers[i] = maker

	if spec.children then
		local children = table.create(#spec.children)
		for j, c in spec.children do
			children[j] = build(c, reg)
		end
		self.children = children
		self.n = #children
	elseif spec.child then
		self.child = build(spec.child, reg)
	end
	return self
end

---------------------------------------------------------------------------------------------------
-- adapter
---------------------------------------------------------------------------------------------------
return {
	name = "oop_shared_aos",

	new_world = function(spec)
		local reg = { states = {}, makers = {} }
		local root = build(spec, reg)
		return {
			root = root,
			states = reg.states,
			makers = reg.makers,
			nstates = #reg.states,
			status = {},
			order = {},
			slot_of = {},
		}
	end,

	add_agent = function(w, id)
		local states, makers = w.states, w.makers
		for i = 1, w.nstates do
			states[i][id] = makers[i]()
		end
		local order = w.order
		local n = #order + 1
		order[n] = id
		w.slot_of[id] = n
	end,

	remove_agent = function(w, id)
		local root = w.root
		if root.state[id].running then
			root:Halt(id)
		end
		local states = w.states
		for i = 1, w.nstates do
			states[i][id] = nil
		end
		w.status[id] = nil
		local order, slot_of = w.order, w.slot_of
		local i = slot_of[id]
		local last = #order
		local moved = order[last]
		order[i] = moved
		slot_of[moved] = i
		order[last] = nil
		slot_of[id] = nil
	end,

	tick = function(w, dt)
		local root, status, order = w.root, w.status, w.order
		for i = 1, #order do
			local id = order[i]
			status[id] = root:Tick(id, dt)
		end
	end,

	get_status = function(w, id)
		return w.status[id]
	end,
}
