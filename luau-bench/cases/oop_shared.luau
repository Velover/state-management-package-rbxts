--!optimize 2
-- oop_shared: the control experiment.
--
-- Keeps the baseline class / metatable style (Node -> Composite|Decorator -> concrete class,
-- `node:Tick(agent, dt) -> status`, `node:Halt(agent)`) but changes two things:
--   1. the tree is built ONCE and shared by every agent; agents are integer ids,
--   2. per-agent node state is Struct-of-Maps held by the node (`self.running[agent]`,
--      `self.cursor[agent]`, `self.time_left[agent]`), so there are no per-agent node objects.
-- Halting is an explicit cascade: a parent knows which child runs for an agent (cursor / running
-- flag) and halts it when it skips it. No running/active sets, no per-tick allocation.
--
-- Every per-agent slot is created in add_agent with a default value and only nil'd in
-- remove_agent, so steady-state ticking never inserts a key -> 0 B/agent-tick.

local S = require("../harness/status")
local SUCCESS, FAILURE, RUNNING = S.SUCCESS, S.FAILURE, S.RUNNING
local NONE = -1 -- "child has not completed yet" marker for Parallel

---------------------------------------------------------------------------------------------------
-- Node (base)
---------------------------------------------------------------------------------------------------
local Node = {}
Node.__index = Node

function Node:IsRunning(agent)
	return self.running[agent]
end

-- leaf-ish default: nothing to cascade into
function Node:Halt(agent)
	self.running[agent] = false
end

---------------------------------------------------------------------------------------------------
-- Composite
---------------------------------------------------------------------------------------------------
local Composite = setmetatable({}, { __index = Node })
Composite.__index = Composite

function Composite:Halt(agent)
	local running = self.running
	if not running[agent] then
		return
	end
	running[agent] = false
	local children = self.children
	for i = 1, self.n do
		local c = children[i]
		if c.running[agent] then
			c:Halt(agent)
		end
	end
end

-- halt every running child except `except`
function Composite:HaltOthers(agent, except)
	local children = self.children
	for i = 1, self.n do
		if i ~= except then
			local c = children[i]
			if c.running[agent] then
				c:Halt(agent)
			end
		end
	end
end

-- halt every running child from `from` upwards (reactive composites: children before the active
-- one were ticked this tick and are idle, so only the tail can still be running)
function Composite:HaltFrom(agent, from)
	local children = self.children
	for i = from, self.n do
		local c = children[i]
		if c.running[agent] then
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
	local running = self.running
	if not running[agent] then
		return
	end
	running[agent] = false
	local c = self.child
	if c.running[agent] then
		c:Halt(agent)
	end
end

---------------------------------------------------------------------------------------------------
-- Sequence / Fallback (cursor, non reactive)
---------------------------------------------------------------------------------------------------
local Sequence = setmetatable({}, { __index = Composite })
Sequence.__index = Sequence

function Sequence:Tick(agent, dt)
	local running, cursor = self.running, self.cursor
	local i
	if running[agent] then
		i = cursor[agent]
	else
		running[agent] = true
		i = 1
	end
	local children, n = self.children, self.n
	while i <= n do
		local st = children[i]:Tick(agent, dt)
		if st == RUNNING then
			cursor[agent] = i
			return RUNNING
		elseif st == FAILURE then
			running[agent] = false
			return FAILURE
		end
		i += 1
	end
	running[agent] = false
	return SUCCESS
end

-- only the child under the cursor can be running
function Sequence:Halt(agent)
	local running = self.running
	if not running[agent] then
		return
	end
	running[agent] = false
	local c = self.children[self.cursor[agent]]
	if c and c.running[agent] then
		c:Halt(agent)
	end
end

local Fallback = setmetatable({}, { __index = Composite })
Fallback.__index = Fallback
Fallback.Halt = Sequence.Halt

function Fallback:Tick(agent, dt)
	local running, cursor = self.running, self.cursor
	local i
	if running[agent] then
		i = cursor[agent]
	else
		running[agent] = true
		i = 1
	end
	local children, n = self.children, self.n
	while i <= n do
		local st = children[i]:Tick(agent, dt)
		if st == RUNNING then
			cursor[agent] = i
			return RUNNING
		elseif st == SUCCESS then
			running[agent] = false
			return SUCCESS
		end
		i += 1
	end
	running[agent] = false
	return FAILURE
end

---------------------------------------------------------------------------------------------------
-- ReactiveSequence / ReactiveFallback
---------------------------------------------------------------------------------------------------
local ReactiveSequence = setmetatable({}, { __index = Composite })
ReactiveSequence.__index = ReactiveSequence

function ReactiveSequence:Tick(agent, dt)
	local running = self.running
	running[agent] = true
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
			running[agent] = false
			return FAILURE
		end
	end
	running[agent] = false
	return SUCCESS
end

local ReactiveFallback = setmetatable({}, { __index = Composite })
ReactiveFallback.__index = ReactiveFallback

function ReactiveFallback:Tick(agent, dt)
	local running = self.running
	running[agent] = true
	local children, n = self.children, self.n
	for i = 1, n do
		local st = children[i]:Tick(agent, dt)
		if st ~= FAILURE then
			if i < n then
				self:HaltFrom(agent, i + 1)
			end
			if st == SUCCESS then
				running[agent] = false
			end
			return st
		end
	end
	running[agent] = false
	return FAILURE
end

---------------------------------------------------------------------------------------------------
-- Parallel
---------------------------------------------------------------------------------------------------
local Parallel = setmetatable({}, { __index = Composite })
Parallel.__index = Parallel

function Parallel:Tick(agent, dt)
	local running = self.running
	local children, n, completed = self.children, self.n, self.completed
	if not running[agent] then
		running[agent] = true
		for i = 1, n do
			completed[i][agent] = NONE
		end
	end
	local sc, fc = 0, 0
	for i = 1, n do
		local cm = completed[i]
		local cs = cm[agent]
		if cs == NONE then
			local st = children[i]:Tick(agent, dt)
			if st == SUCCESS then
				sc += 1
				cm[agent] = SUCCESS
				if self.success_one then
					self:HaltOthers(agent, i)
					running[agent] = false
					return SUCCESS
				end
			elseif st == FAILURE then
				fc += 1
				cm[agent] = FAILURE
				if self.failure_one then
					self:HaltOthers(agent, i)
					running[agent] = false
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
		running[agent] = false
		return SUCCESS
	end
	if self.failure_all and fc == n then
		running[agent] = false
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
	local running = self.running
	running[agent] = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	running[agent] = false
	return if st == SUCCESS then FAILURE else SUCCESS
end

local ForceSuccess = setmetatable({}, { __index = Decorator })
ForceSuccess.__index = ForceSuccess

function ForceSuccess:Tick(agent, dt)
	local running = self.running
	running[agent] = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	running[agent] = false
	return SUCCESS
end

local ForceFailure = setmetatable({}, { __index = Decorator })
ForceFailure.__index = ForceFailure

function ForceFailure:Tick(agent, dt)
	local running = self.running
	running[agent] = true
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	running[agent] = false
	return FAILURE
end

local Repeat = setmetatable({}, { __index = Decorator })
Repeat.__index = Repeat

function Repeat:Tick(agent, dt)
	local running, done = self.running, self.done
	local k
	if running[agent] then
		k = done[agent]
	else
		running[agent] = true
		k = 0
		done[agent] = 0 -- a halted run can leave a stale counter behind
	end
	local st = self.child:Tick(agent, dt)
	if st == RUNNING then
		return RUNNING
	end
	k += 1
	if k >= self.count then
		running[agent] = false
		return SUCCESS
	end
	done[agent] = k
	return RUNNING
end

local Timeout = setmetatable({}, { __index = Decorator })
Timeout.__index = Timeout

function Timeout:Tick(agent, dt)
	local running, time_left = self.running, self.time_left
	local t
	if running[agent] then
		t = time_left[agent] - dt
	else
		running[agent] = true
		t = self.seconds - dt
	end
	time_left[agent] = t
	if t <= 0 then
		running[agent] = false
		local c = self.child
		if c.running[agent] then
			c:Halt(agent)
		end
		return FAILURE
	end
	local st = self.child:Tick(agent, dt)
	if st ~= RUNNING then
		running[agent] = false
	end
	return st
end

local Cooldown = setmetatable({}, { __index = Decorator })
Cooldown.__index = Cooldown

-- time_left persists across runs and starts at 0
function Cooldown:Tick(agent, dt)
	local running, time_left = self.running, self.time_left
	local t = time_left[agent] - dt
	time_left[agent] = t
	if t > 0 then
		running[agent] = false
		return FAILURE
	end
	running[agent] = true
	local st = self.child:Tick(agent, dt)
	if st ~= RUNNING then
		running[agent] = false
		time_left[agent] = self.seconds
	end
	return st
end

---------------------------------------------------------------------------------------------------
-- Leaves
---------------------------------------------------------------------------------------------------
local Wait = setmetatable({}, { __index = Node })
Wait.__index = Wait

function Wait:Tick(agent, dt)
	local running, time_left = self.running, self.time_left
	local t
	if running[agent] then
		t = time_left[agent] - dt
	else
		running[agent] = true
		t = self.seconds - dt
	end
	if t <= 0 then
		running[agent] = false
		return SUCCESS
	end
	time_left[agent] = t
	return RUNNING
end

local Leaf = setmetatable({}, { __index = Node })
Leaf.__index = Leaf

function Leaf:Tick(agent, dt)
	local running = self.running
	if not running[agent] then
		running[agent] = true
		local start = self.on_start
		if start then
			start(agent)
		end
	end
	local st = self.on_tick(agent, dt)
	if st ~= RUNNING then
		running[agent] = false
	end
	return st
end

function Leaf:Halt(agent)
	local running = self.running
	if not running[agent] then
		return
	end
	running[agent] = false
	local halt = self.on_halt
	if halt then
		halt(agent)
	end
end

---------------------------------------------------------------------------------------------------
-- build: one shared tree, and the list of per-agent state maps with their defaults
---------------------------------------------------------------------------------------------------
local function slot(reg, default)
	local m = {}
	local i = #reg.maps + 1
	reg.maps[i] = m
	reg.defaults[i] = default
	return m
end

local function build(spec, reg)
	local k = spec.kind
	local self
	if k == "Sequence" or k == "Fallback" then
		self = setmetatable({ cursor = slot(reg, 0) }, if k == "Sequence" then Sequence else Fallback)
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
	elseif k == "Inverter" then
		self = setmetatable({}, Inverter)
	elseif k == "ForceSuccess" then
		self = setmetatable({}, ForceSuccess)
	elseif k == "ForceFailure" then
		self = setmetatable({}, ForceFailure)
	elseif k == "Repeat" then
		assert(spec.count >= 1, "Repeat count must be >= 1")
		self = setmetatable({ count = spec.count, done = slot(reg, 0) }, Repeat)
	elseif k == "Timeout" then
		self = setmetatable({ seconds = spec.seconds, time_left = slot(reg, 0) }, Timeout)
	elseif k == "Cooldown" then
		self = setmetatable({ seconds = spec.seconds, time_left = slot(reg, 0) }, Cooldown)
	elseif k == "Wait" then
		self = setmetatable({ seconds = spec.seconds, time_left = slot(reg, 0) }, Wait)
	elseif k == "Leaf" then
		self = setmetatable({
			name = spec.name,
			on_start = spec.on_start or false,
			on_tick = spec.on_tick,
			on_halt = spec.on_halt or false,
		}, Leaf)
	else
		error("oop_shared: unknown kind " .. tostring(k))
	end
	self.running = slot(reg, false)
	if spec.children then
		local children = table.create(#spec.children)
		for i, c in spec.children do
			children[i] = build(c, reg)
		end
		self.children = children
		self.n = #children
		if k == "Parallel" then
			local completed = table.create(self.n)
			for i = 1, self.n do
				completed[i] = slot(reg, NONE)
			end
			self.completed = completed
		end
	elseif spec.child then
		self.child = build(spec.child, reg)
	end
	return self
end

---------------------------------------------------------------------------------------------------
-- adapter
---------------------------------------------------------------------------------------------------
return {
	name = "oop_shared",

	new_world = function(spec)
		local reg = { maps = {}, defaults = {} }
		local root = build(spec, reg)
		return {
			root = root,
			maps = reg.maps,
			defaults = reg.defaults,
			nmaps = #reg.maps,
			status = {},
			order = {}, -- dense array of live agent ids
			slot_of = {}, -- id -> index in order
		}
	end,

	add_agent = function(w, id)
		local maps, defaults = w.maps, w.defaults
		for i = 1, w.nmaps do
			maps[i][id] = defaults[i]
		end
		local order = w.order
		local n = #order + 1
		order[n] = id
		w.slot_of[id] = n
	end,

	remove_agent = function(w, id)
		local root = w.root
		if root.running[id] then
			root:Halt(id)
		end
		local maps = w.maps
		for i = 1, w.nmaps do
			maps[i][id] = nil
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
