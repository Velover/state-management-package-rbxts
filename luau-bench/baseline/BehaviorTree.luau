--!native
--!optimize 2
-- Compiled with roblox-ts v3.0.0
local BTree = {}
do
	local _container = BTree
	-- Core enums and interfaces
	--* Base node class 
	local Node
	do
		Node = {}
		function Node:constructor()
			self.state_ = 0
		end
		function Node:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local _old_active_nodes = old_active_nodes
			local _self = self
			if not (_old_active_nodes[_self] ~= nil) then
				self:OnBecameActivated(bb)
			end
			local _new_active_nodes = new_active_nodes
			local _self_1 = self
			_new_active_nodes[_self_1] = true
			if self.state_ == 0 then
				self.state_ = 1
				local start_status = self:OnStart(bb)
				if start_status ~= 2 then
					self.state_ = 0
					if start_status == 0 then
						self:OnSuccess(bb)
					else
						self:OnFailure(bb)
					end
					self:OnExit(start_status, bb)
					return start_status
				end
			end
			if self.state_ == 1 then
				local status = self:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if status == 2 then
					local _running_nodes = running_nodes
					local _self_2 = self
					_running_nodes[_self_2] = true
				end
				if status ~= 2 then
					self.state_ = 0
					if status == 0 then
						self:OnSuccess(bb)
					else
						self:OnFailure(bb)
					end
					self:OnExit(status, bb)
				end
				return status
			end
			-- Handle HALTED state - node was interrupted
			-- Cant normally happen during Tick, but just in case
			if self.state_ == 2 then
				self.state_ = 0
				return 1
			end
			return 1
		end
		function Node:Halt(bb)
			if self.state_ ~= 1 then
				return nil
			end
			self.state_ = 2
			self:OnHalt(bb)
			self:OnExit(2, bb)
			self.state_ = 0
		end
		function Node:IsRunning()
			return self.state_ == 1
		end
		function Node:OnStart(bb)
			-- Default implementation - can be overridden
			return 2
		end
		function Node:OnExit(status, bb)
		end
		function Node:OnSuccess(bb)
		end
		function Node:OnFailure(bb)
		end
		function Node:OnHalt(bb)
		end
		function Node:OnBecameActivated(bb)
		end
		function Node:OnBecameInactive(bb)
		end
	end
	_container.Node = Node
	--* Composite nodes (can have multiple children) 
	local Composite
	do
		local super = Node
		Composite = setmetatable({}, {
			__tostring = function()
				return "Composite"
			end,
			__index = super,
		})
		Composite.__index = Composite
		function Composite:constructor(...)
			super.constructor(self, ...)
			self.children_ = {}
		end
		function Composite:AddChild(child)
			local _children_ = self.children_
			local _child = child
			table.insert(_children_, _child)
			return self
		end
		function Composite:AddChildren(...)
			local children = { ... }
			for _, child in children do
				local _exp = self.children_
				table.insert(_exp, child)
			end
			return self
		end
		function Composite:OnHalt(bb)
			-- Halt all running children
			for _, child in self.children_ do
				if child:IsRunning() then
					child:Halt(bb)
				end
			end
		end
		function Composite:HaltOtherChildren(except_child, bb)
			for _, child in self.children_ do
				if child == except_child then
					continue
				end
				if child:IsRunning() then
					child:Halt(bb)
				end
			end
		end
	end
	_container.Composite = Composite
	--* Sequence - runs children in order until one fails 
	local Sequence
	do
		local super = Composite
		Sequence = setmetatable({}, {
			__tostring = function()
				return "Sequence"
			end,
			__index = super,
		})
		Sequence.__index = Sequence
		function Sequence.new(...)
			local self = setmetatable({}, Sequence)
			return self:constructor(...) or self
		end
		function Sequence:constructor(...)
			super.constructor(self, ...)
			self.current_index_ = 0
		end
		function Sequence:OnStart(bb)
			self.current_index_ = 0
			return 2
		end
		function Sequence:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			do
				local i = self.current_index_
				local _shouldIncrement = false
				while true do
					if _shouldIncrement then
						i += 1
					else
						_shouldIncrement = true
					end
					if not (i < #self.children_) then
						break
					end
					local status = self.children_[i + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
					if status == 2 then
						self.current_index_ = i
						return 2
					elseif status == 1 then
						return 1
					end
				end
			end
			return 0
		end
	end
	_container.Sequence = Sequence
	--* Sequence - runs children in order until one fails 
	local ReactiveSequence
	do
		local super = Composite
		ReactiveSequence = setmetatable({}, {
			__tostring = function()
				return "ReactiveSequence"
			end,
			__index = super,
		})
		ReactiveSequence.__index = ReactiveSequence
		function ReactiveSequence.new(...)
			local self = setmetatable({}, ReactiveSequence)
			return self:constructor(...) or self
		end
		function ReactiveSequence:constructor(...)
			super.constructor(self, ...)
		end
		function ReactiveSequence:OnStart(bb)
			return 2
		end
		function ReactiveSequence:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			for i = 0, #self.children_ - 1 do
				local status = self.children_[i + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if status == 2 then
					self:HaltOtherChildren(self.children_[i + 1], bb)
					return 2
				elseif status == 1 then
					return 1
				end
			end
			return 0
		end
	end
	_container.ReactiveSequence = ReactiveSequence
	--* Memory Sequence - remembers which child failed 
	local MemorySequence
	do
		local super = Composite
		MemorySequence = setmetatable({}, {
			__tostring = function()
				return "MemorySequence"
			end,
			__index = super,
		})
		MemorySequence.__index = MemorySequence
		function MemorySequence.new(...)
			local self = setmetatable({}, MemorySequence)
			return self:constructor(...) or self
		end
		function MemorySequence:constructor(...)
			super.constructor(self, ...)
			self.current_index_ = 0
		end
		function MemorySequence:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if #self.children_ == 0 then
				return 0
			end
			do
				local i = self.current_index_
				local _shouldIncrement = false
				while true do
					if _shouldIncrement then
						i += 1
					else
						_shouldIncrement = true
					end
					if not (i < #self.children_) then
						break
					end
					local status = self.children_[i + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
					self.current_index_ = i
					if status == 2 then
						return 2
					elseif status == 1 then
						return 1
					end
				end
			end
			-- Reset index after successful run
			self.current_index_ = 0
			return 0
		end
		function MemorySequence:OnBecameInactive(bb)
			self.current_index_ = 0
		end
	end
	_container.MemorySequence = MemorySequence
	--* Fallback - runs children in order until one succeeds 
	local Fallback
	do
		local super = Composite
		Fallback = setmetatable({}, {
			__tostring = function()
				return "Fallback"
			end,
			__index = super,
		})
		Fallback.__index = Fallback
		function Fallback.new(...)
			local self = setmetatable({}, Fallback)
			return self:constructor(...) or self
		end
		function Fallback:constructor(...)
			super.constructor(self, ...)
			self.current_index_ = 0
		end
		function Fallback:OnStart(bb)
			self.current_index_ = 0
			return 2
		end
		function Fallback:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			do
				local i = self.current_index_
				local _shouldIncrement = false
				while true do
					if _shouldIncrement then
						i += 1
					else
						_shouldIncrement = true
					end
					if not (i < #self.children_) then
						break
					end
					local status = self.children_[i + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
					if status == 2 then
						self.current_index_ = i
						return 2
					elseif status == 0 then
						return 0
					end
				end
			end
			return 1
		end
	end
	_container.Fallback = Fallback
	--* ReactiveFallback - like Fallback but restarts from beginning when child returns RUNNING 
	local ReactiveFallback
	do
		local super = Composite
		ReactiveFallback = setmetatable({}, {
			__tostring = function()
				return "ReactiveFallback"
			end,
			__index = super,
		})
		ReactiveFallback.__index = ReactiveFallback
		function ReactiveFallback.new(...)
			local self = setmetatable({}, ReactiveFallback)
			return self:constructor(...) or self
		end
		function ReactiveFallback:constructor(...)
			super.constructor(self, ...)
		end
		function ReactiveFallback:OnStart(bb)
			return 2
		end
		function ReactiveFallback:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			-- Always start from beginning (reactive behavior)
			for i = 0, #self.children_ - 1 do
				local status = self.children_[i + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if status == 0 then
					-- Halt subsequent children
					self:HaltOtherChildren(self.children_[i + 1], bb)
					return 0
				elseif status == 2 then
					-- Halt subsequent children and restart from beginning next tick
					self:HaltOtherChildren(self.children_[i + 1], bb)
					return 2
				end
				-- If FAILURE, continue to next child
			end
			return 1
		end
	end
	_container.ReactiveFallback = ReactiveFallback
	--* Parallel - runs all children simultaneously 
	local Parallel
	do
		local super = Composite
		Parallel = setmetatable({}, {
			__tostring = function()
				return "Parallel"
			end,
			__index = super,
		})
		Parallel.__index = Parallel
		function Parallel.new(...)
			local self = setmetatable({}, Parallel)
			return self:constructor(...) or self
		end
		function Parallel:constructor(success_policy_, failure_policy_)
			if success_policy_ == nil then
				success_policy_ = "ALL"
			end
			if failure_policy_ == nil then
				failure_policy_ = "ONE"
			end
			super.constructor(self)
			self.success_policy_ = success_policy_
			self.failure_policy_ = failure_policy_
			self.completed_children_ = {}
		end
		function Parallel:OnStart(bb)
			table.clear(self.completed_children_)
			return 2
		end
		function Parallel:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local success_count = 0
			local failure_count = 0
			for _, child in self.children_ do
				-- Skip already completed children
				local completed_status = self.completed_children_[child]
				if completed_status ~= nil then
					new_active_nodes[child] = true
					if completed_status == 0 then
						success_count += 1
					else
						failure_count += 1
					end
					continue
				end
				local status = child:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if status == 0 then
					success_count += 1
					self.completed_children_[child] = status
					if self.success_policy_ == "ONE" then
						self:HaltOtherChildren(child, bb)
						return 0
					end
				elseif status == 1 then
					failure_count += 1
					self.completed_children_[child] = status
					if self.failure_policy_ == "ONE" then
						self:HaltOtherChildren(child, bb)
						return 1
					end
				end
			end
			if self.success_policy_ == "ALL" and success_count == #self.children_ then
				return 0
			end
			if self.failure_policy_ == "ALL" and failure_count == #self.children_ then
				return 1
			end
			return 2
		end
		function Parallel:OnExit(status, bb)
			table.clear(self.completed_children_)
		end
	end
	_container.Parallel = Parallel
	--* Decorator base class 
	local Decorator
	do
		local super = Node
		Decorator = setmetatable({}, {
			__tostring = function()
				return "Decorator"
			end,
			__index = super,
		})
		Decorator.__index = Decorator
		function Decorator:constructor(child_)
			super.constructor(self)
			self.child_ = child_
		end
		function Decorator:OnHalt(bb)
			if self.child_:IsRunning() then
				self.child_:Halt(bb)
			end
		end
	end
	_container.Decorator = Decorator
	--* Inverter - inverts SUCCESS/FAILURE results 
	local Inverter
	do
		local super = Decorator
		Inverter = setmetatable({}, {
			__tostring = function()
				return "Inverter"
			end,
			__index = super,
		})
		Inverter.__index = Inverter
		function Inverter.new(...)
			local self = setmetatable({}, Inverter)
			return self:constructor(...) or self
		end
		function Inverter:constructor(...)
			super.constructor(self, ...)
		end
		function Inverter:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 0 then
				return 1
			elseif status == 1 then
				return 0
			end
			return status
		end
	end
	_container.Inverter = Inverter
	local Log
	do
		local super = Node
		Log = setmetatable({}, {
			__tostring = function()
				return "Log"
			end,
			__index = super,
		})
		Log.__index = Log
		function Log.new(...)
			local self = setmetatable({}, Log)
			return self:constructor(...) or self
		end
		function Log:constructor(message_)
			super.constructor(self)
			self.message_ = message_
		end
		function Log:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			print(self.message_)
			return 0
		end
	end
	_container.Log = Log
	--* ForceRunning - always returns RUNNING
	local ForceRunning
	do
		local super = Decorator
		ForceRunning = setmetatable({}, {
			__tostring = function()
				return "ForceRunning"
			end,
			__index = super,
		})
		ForceRunning.__index = ForceRunning
		function ForceRunning.new(...)
			local self = setmetatable({}, ForceRunning)
			return self:constructor(...) or self
		end
		function ForceRunning:constructor(...)
			super.constructor(self, ...)
		end
		function ForceRunning:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			return 2
		end
	end
	_container.ForceRunning = ForceRunning
	--* ForceSuccess - always returns SUCCESS unless child is RUNNING 
	local ForceSuccess
	do
		local super = Decorator
		ForceSuccess = setmetatable({}, {
			__tostring = function()
				return "ForceSuccess"
			end,
			__index = super,
		})
		ForceSuccess.__index = ForceSuccess
		function ForceSuccess.new(...)
			local self = setmetatable({}, ForceSuccess)
			return self:constructor(...) or self
		end
		function ForceSuccess:constructor(...)
			super.constructor(self, ...)
		end
		function ForceSuccess:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 2 then
				return 2
			end
			return 0
		end
	end
	_container.ForceSuccess = ForceSuccess
	--* ForceFailure - always returns FAILURE unless child is RUNNING 
	local ForceFailure
	do
		local super = Decorator
		ForceFailure = setmetatable({}, {
			__tostring = function()
				return "ForceFailure"
			end,
			__index = super,
		})
		ForceFailure.__index = ForceFailure
		function ForceFailure.new(...)
			local self = setmetatable({}, ForceFailure)
			return self:constructor(...) or self
		end
		function ForceFailure:constructor(...)
			super.constructor(self, ...)
		end
		function ForceFailure:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 2 then
				return 2
			end
			return 1
		end
	end
	_container.ForceFailure = ForceFailure
	--* FireAndForget - executes child and ignores its result 
	local FireAndForget
	do
		local super = Decorator
		FireAndForget = setmetatable({}, {
			__tostring = function()
				return "FireAndForget"
			end,
			__index = super,
		})
		FireAndForget.__index = FireAndForget
		function FireAndForget.new(...)
			local self = setmetatable({}, FireAndForget)
			return self:constructor(...) or self
		end
		function FireAndForget:constructor(...)
			super.constructor(self, ...)
		end
		function FireAndForget:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			return 0
		end
	end
	_container.FireAndForget = FireAndForget
	--* RunningGate - executes child and returns FAILURE if child is Running 
	local RunningGate
	do
		local super = Decorator
		RunningGate = setmetatable({}, {
			__tostring = function()
				return "RunningGate"
			end,
			__index = super,
		})
		RunningGate.__index = RunningGate
		function RunningGate.new(...)
			local self = setmetatable({}, RunningGate)
			return self:constructor(...) or self
		end
		function RunningGate:constructor(...)
			super.constructor(self, ...)
		end
		function RunningGate:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 2 then
				return 1
			end
			return status
		end
	end
	_container.RunningGate = RunningGate
	--* Timeout - fails child if it takes longer than specified time
	local Timeout
	do
		local super = Decorator
		Timeout = setmetatable({}, {
			__tostring = function()
				return "Timeout"
			end,
			__index = super,
		})
		Timeout.__index = Timeout
		function Timeout.new(...)
			local self = setmetatable({}, Timeout)
			return self:constructor(...) or self
		end
		function Timeout:constructor(child, timeout_s_, behavior_)
			if behavior_ == nil then
				behavior_ = "FAILURE"
			end
			super.constructor(self, child)
			self.timeout_s_ = timeout_s_
			self.behavior_ = behavior_
			self.time_left_ = 0
		end
		function Timeout:OnStart(bb)
			self.time_left_ = self.timeout_s_
			return 2
		end
		function Timeout:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			self.time_left_ -= dt
			if self.time_left_ <= 0 then
				self.child_:Halt(bb)
				return if self.behavior_ == "FAILURE" then 1 else 0
			end
			return self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
		end
	end
	_container.Timeout = Timeout
	--* IfThenElse - conditional execution (2-3 children) 
	local IfThenElse
	do
		local super = Composite
		IfThenElse = setmetatable({}, {
			__tostring = function()
				return "IfThenElse"
			end,
			__index = super,
		})
		IfThenElse.__index = IfThenElse
		function IfThenElse.new(...)
			local self = setmetatable({}, IfThenElse)
			return self:constructor(...) or self
		end
		function IfThenElse:constructor(...)
			super.constructor(self, ...)
			self.current_child_ = -1
		end
		function IfThenElse:OnStart(bb)
			self.current_child_ = -1
			return 2
		end
		function IfThenElse:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if #self.children_ < 2 or #self.children_ > 3 then
				error("IfThenElse must have exactly 2 or 3 children")
			end
			-- If we're continuing with a running child
			if self.current_child_ > 0 then
				local status = self.children_[self.current_child_ + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if status ~= 2 then
					self.current_child_ = -1
				end
				return status
			end
			-- Evaluate condition (first child)
			local condition_status = self.children_[1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if condition_status == 2 then
				return 2
			end
			-- Execute appropriate branch
			if condition_status == 0 then
				-- Execute THEN branch (second child)
				self.current_child_ = 1
				return self.children_[2]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			-- Execute ELSE branch (third child) if it exists
			if #self.children_ == 3 then
				self.current_child_ = 2
				return self.children_[3]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			return 1
		end
	end
	_container.IfThenElse = IfThenElse
	--* WhileDoElse - loop execution with condition checking 
	local WhileDoElse
	do
		local super = Composite
		WhileDoElse = setmetatable({}, {
			__tostring = function()
				return "WhileDoElse"
			end,
			__index = super,
		})
		WhileDoElse.__index = WhileDoElse
		function WhileDoElse.new(...)
			local self = setmetatable({}, WhileDoElse)
			return self:constructor(...) or self
		end
		function WhileDoElse:constructor(...)
			super.constructor(self, ...)
			self.current_child_ = -1
		end
		function WhileDoElse:OnStart(bb)
			self.current_child_ = -1
			return 2
		end
		function WhileDoElse:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if #self.children_ < 2 or #self.children_ > 3 then
				error("WhileDoElse must have exactly 2 or 3 children")
			end
			-- If a child is running, continue with it unless condition changed
			if self.current_child_ > 0 then
				-- Re-evaluate condition first
				local condition_status = self.children_[1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if condition_status == 2 then
					return 2
				end
				-- If condition changed, halt current child and switch
				local expected_child = if condition_status == 0 then 1 else 2
				if self.current_child_ ~= expected_child then
					self.children_[self.current_child_ + 1]:Halt(bb)
					self.current_child_ = expected_child
				end
				if self.current_child_ == 2 and #self.children_ < 3 then
					return 1
				end
				return self.children_[self.current_child_ + 1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			-- Evaluate condition (first child)
			local condition_status = self.children_[1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if condition_status == 2 then
				return 2
			end
			-- Execute appropriate branch based on condition
			if condition_status == 0 then
				self.current_child_ = 1
				return self.children_[2]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			if #self.children_ == 3 then
				self.current_child_ = 2
				return self.children_[3]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			return 1
		end
	end
	_container.WhileDoElse = WhileDoElse
	--* TryCatch - runs TRY, executes CATCH on failure, always runs optional FINALLY 
	local TryCatch
	do
		local super = Composite
		TryCatch = setmetatable({}, {
			__tostring = function()
				return "TryCatch"
			end,
			__index = super,
		})
		TryCatch.__index = TryCatch
		function TryCatch.new(...)
			local self = setmetatable({}, TryCatch)
			return self:constructor(...) or self
		end
		function TryCatch:constructor(...)
			super.constructor(self, ...)
			self.current_child_ = -1
			self.pending_result_ = 0
		end
		function TryCatch:OnStart(bb)
			if #self.children_ < 2 or #self.children_ > 3 then
				error("TryCatch must have 2 or 3 children")
			end
			self.current_child_ = -1
			return 2
		end
		function TryCatch:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local has_finally = #self.children_ == 3
			-- Continue FINALLY
			if self.current_child_ == 2 then
				local s = self.children_[3]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if s == 2 then
					return 2
				end
				self.current_child_ = -1
				return self.pending_result_
			end
			-- Continue CATCH
			if self.current_child_ == 1 then
				local s = self.children_[2]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if s == 2 then
					return 2
				end
				return self:EnterFinally(s, has_finally, dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			-- Start or continue TRY (current_child_ === -1 or 0)
			self.current_child_ = 0
			local try_s = self.children_[1]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if try_s == 2 then
				return 2
			end
			if try_s == 0 then
				return self:EnterFinally(0, has_finally, dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			-- TRY failed → start CATCH
			self.current_child_ = 1
			local catch_s = self.children_[2]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if catch_s == 2 then
				return 2
			end
			return self:EnterFinally(catch_s, has_finally, dt, bb, running_nodes, new_active_nodes, old_active_nodes)
		end
		function TryCatch:EnterFinally(result, has_finally, dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if not has_finally then
				self.current_child_ = -1
				return result
			end
			self.pending_result_ = result
			self.current_child_ = 2
			local s = self.children_[3]:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if s == 2 then
				return 2
			end
			self.current_child_ = -1
			return self.pending_result_
		end
	end
	_container.TryCatch = TryCatch
	--* KeepRunningUntilSuccess - retries child until it succeeds with max attempts 
	local KeepRunningUntilSuccess
	do
		local super = Decorator
		KeepRunningUntilSuccess = setmetatable({}, {
			__tostring = function()
				return "KeepRunningUntilSuccess"
			end,
			__index = super,
		})
		KeepRunningUntilSuccess.__index = KeepRunningUntilSuccess
		function KeepRunningUntilSuccess.new(...)
			local self = setmetatable({}, KeepRunningUntilSuccess)
			return self:constructor(...) or self
		end
		function KeepRunningUntilSuccess:constructor(child, max_attempts_)
			if max_attempts_ == nil then
				max_attempts_ = -1
			end
			super.constructor(self, child)
			self.max_attempts_ = max_attempts_
			self.current_attempts_ = 0
		end
		function KeepRunningUntilSuccess:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 0 then
				return 0
			end
			if status == 1 then
				self.current_attempts_ += 1
				local run_out_of_attempts = self.max_attempts_ > 0 and self.current_attempts_ >= self.max_attempts_
				if run_out_of_attempts then
					return 1
				end
			end
			return 2
		end
		function KeepRunningUntilSuccess:OnStart(bb)
			self.current_attempts_ = 0
			return 2
		end
	end
	_container.KeepRunningUntilSuccess = KeepRunningUntilSuccess
	--* KeepRunningUntilFailure - retries child until it fails with max attempts 
	local KeepRunningUntilFailure
	do
		local super = Decorator
		KeepRunningUntilFailure = setmetatable({}, {
			__tostring = function()
				return "KeepRunningUntilFailure"
			end,
			__index = super,
		})
		KeepRunningUntilFailure.__index = KeepRunningUntilFailure
		function KeepRunningUntilFailure.new(...)
			local self = setmetatable({}, KeepRunningUntilFailure)
			return self:constructor(...) or self
		end
		function KeepRunningUntilFailure:constructor(child, max_attempts_)
			if max_attempts_ == nil then
				max_attempts_ = -1
			end
			super.constructor(self, child)
			self.max_attempts_ = max_attempts_
			self.current_attempts_ = 0
		end
		function KeepRunningUntilFailure:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 1 then
				return 1
			end
			if status == 0 then
				self.current_attempts_ += 1
				if self.max_attempts_ > 0 and self.current_attempts_ >= self.max_attempts_ then
					return 0
				end
			end
			return 2
		end
		function KeepRunningUntilFailure:OnStart(bb)
			self.current_attempts_ = 0
			return 2
		end
	end
	_container.KeepRunningUntilFailure = KeepRunningUntilFailure
	--* Action node - performs an action 
	local Action
	do
		local super = Node
		Action = setmetatable({}, {
			__tostring = function()
				return "Action"
			end,
			__index = super,
		})
		Action.__index = Action
		function Action.new(...)
			local self = setmetatable({}, Action)
			return self:constructor(...) or self
		end
		function Action:constructor(action_)
			super.constructor(self)
			self.action_ = action_
		end
		function Action:OnTick(dt, bb, running_nodes)
			return self.action_(bb, dt)
		end
	end
	_container.Action = Action
	--* WasEntryUpdated - checks if specified blackboard entries have changed since last tick 
	local WasEntryUpdated
	do
		local super = Node
		WasEntryUpdated = setmetatable({}, {
			__tostring = function()
				return "WasEntryUpdated"
			end,
			__index = super,
		})
		WasEntryUpdated.__index = WasEntryUpdated
		function WasEntryUpdated.new(...)
			local self = setmetatable({}, WasEntryUpdated)
			return self:constructor(...) or self
		end
		function WasEntryUpdated:constructor(entries_, skip_first_)
			if skip_first_ == nil then
				skip_first_ = false
			end
			super.constructor(self)
			self.entries_ = entries_
			self.skip_first_ = skip_first_
			self.snapshot_ = {}
		end
		function WasEntryUpdated:OnBecameActivated(bb)
			if not self.skip_first_ then
				return nil
			end
			for _, key in self.entries_ do
				local _snapshot_ = self.snapshot_
				local _arg0 = bb:GetWild(key)
				table.insert(_snapshot_, _arg0)
			end
		end
		function WasEntryUpdated:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local new_snapshot = {}
			for _, key in self.entries_ do
				local _arg0 = bb:GetWild(key)
				table.insert(new_snapshot, _arg0)
			end
			local changed = #self.snapshot_ ~= #new_snapshot
			if not changed then
				for i = 0, #self.snapshot_ - 1 do
					if self.snapshot_[i + 1] == new_snapshot[i + 1] then
						continue
					end
					changed = true
					break
				end
			end
			self.snapshot_ = new_snapshot
			return if changed then 0 else 1
		end
		function WasEntryUpdated:OnBecameInactive(bb)
			table.clear(self.snapshot_)
		end
	end
	_container.WasEntryUpdated = WasEntryUpdated
	--* Condition node - checks a condition 
	local Condition
	do
		local super = Node
		Condition = setmetatable({}, {
			__tostring = function()
				return "Condition"
			end,
			__index = super,
		})
		Condition.__index = Condition
		function Condition.new(...)
			local self = setmetatable({}, Condition)
			return self:constructor(...) or self
		end
		function Condition:constructor(condition_)
			super.constructor(self)
			self.condition_ = condition_
		end
		function Condition:OnTick(dt, bb, running_nodes)
			return if self.condition_(bb, dt) then 0 else 1
		end
	end
	_container.Condition = Condition
	--* Switch - selects a child based on a blackboard value 
	local Switch
	do
		local super = Node
		Switch = setmetatable({}, {
			__tostring = function()
				return "Switch"
			end,
			__index = super,
		})
		Switch.__index = Switch
		function Switch.new(...)
			local self = setmetatable({}, Switch)
			return self:constructor(...) or self
		end
		function Switch:constructor(key_name_)
			super.constructor(self)
			self.key_name_ = key_name_
			self.cases_ = {}
		end
		function Switch:Case(value, node)
			local _cases_ = self.cases_
			local _value = value
			local _node = node
			_cases_[_value] = _node
			return self
		end
		function Switch:Default(node)
			self.default_node_ = node
			return self
		end
		function Switch:OnStart(bb)
			local value = bb:GetWild(self.key_name_)
			if value ~= nil and self.cases_[value] ~= nil then
				self.active_node_ = self.cases_[value]
			elseif self.default_node_ ~= nil then
				self.active_node_ = self.default_node_
			else
				return 1
			end
			return 2
		end
		function Switch:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if self.active_node_ ~= nil then
				return self.active_node_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			return 1
		end
		function Switch:OnHalt(bb)
			local _result = self.active_node_
			if _result ~= nil then
				_result = _result:IsRunning()
			end
			if _result then
				self.active_node_:Halt(bb)
			end
		end
		function Switch:OnExit(status, bb)
			self.active_node_ = nil
		end
	end
	_container.Switch = Switch
	--* Repeat - repeats its child a specified number of times 
	local Repeat
	do
		local super = Decorator
		Repeat = setmetatable({}, {
			__tostring = function()
				return "Repeat"
			end,
			__index = super,
		})
		Repeat.__index = Repeat
		function Repeat.new(...)
			local self = setmetatable({}, Repeat)
			return self:constructor(...) or self
		end
		function Repeat:constructor(child, repeat_count_, condition_)
			if condition_ == nil then
				condition_ = "ALWAYS"
			end
			super.constructor(self, child)
			self.repeat_count_ = repeat_count_
			self.condition_ = condition_
			self.current_count_ = 0
		end
		function Repeat:OnStart(bb)
			self.current_count_ = 0
			return 2
		end
		function Repeat:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if self.current_count_ >= self.repeat_count_ then
				return 0
			end
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if status == 2 then
				return 2
			end
			if self.condition_ == "SUCCESS" and status ~= 0 then
				return 0
			end
			if self.condition_ == "FAILURE" and status ~= 1 then
				return 0
			end
			self.current_count_ += 1
			if self.current_count_ >= self.repeat_count_ then
				return 0
			end
			return 2
		end
		function Repeat:OnExit(status, bb)
			self.current_count_ = 0
		end
	end
	_container.Repeat = Repeat
	--* Wait - waits for a specified duration 
	local Wait
	do
		local super = Node
		Wait = setmetatable({}, {
			__tostring = function()
				return "Wait"
			end,
			__index = super,
		})
		Wait.__index = Wait
		function Wait.new(...)
			local self = setmetatable({}, Wait)
			return self:constructor(...) or self
		end
		function Wait:constructor(duration_s_)
			super.constructor(self)
			self.duration_s_ = duration_s_
			self.time_left_ = 0
		end
		function Wait:OnStart(bb)
			self.time_left_ = self.duration_s_
			return 2
		end
		function Wait:OnTick(dt, bb, running_nodes)
			self.time_left_ -= dt
			if self.time_left_ <= 0 then
				return 0
			end
			return 2
		end
	end
	_container.Wait = Wait
	--* Wait - waits for a specified duration, but doesnt return RUNNING 
	local WaitGate
	do
		local super = Node
		WaitGate = setmetatable({}, {
			__tostring = function()
				return "WaitGate"
			end,
			__index = super,
		})
		WaitGate.__index = WaitGate
		function WaitGate.new(...)
			local self = setmetatable({}, WaitGate)
			return self:constructor(...) or self
		end
		function WaitGate:constructor(duration_s_)
			super.constructor(self)
			self.duration_s_ = duration_s_
			self.time_left_ = 0
		end
		function WaitGate:OnBecameActivated(bb)
			self.time_left_ = self.duration_s_
		end
		function WaitGate:OnTick(dt, bb, running_nodes)
			self.time_left_ -= dt
			if self.time_left_ <= 0 then
				self.time_left_ = self.duration_s_
				return 0
			end
			return 1
		end
	end
	_container.WaitGate = WaitGate
	--* faster way of creating a node with all callbacks 
	local FullAction
	do
		local super = Node
		FullAction = setmetatable({}, {
			__tostring = function()
				return "FullAction"
			end,
			__index = super,
		})
		FullAction.__index = FullAction
		function FullAction.new(...)
			local self = setmetatable({}, FullAction)
			return self:constructor(...) or self
		end
		function FullAction:constructor(config_)
			super.constructor(self)
			self.config_ = config_
		end
		function FullAction:OnBecameActivated(bb)
			local _result = self.config_.OnBecameActivated
			if _result ~= nil then
				_result(bb)
			end
		end
		function FullAction:OnStart(bb)
			local _result = self.config_.OnStart
			if _result ~= nil then
				_result = _result(bb)
			end
			local _condition = _result
			if _condition == nil then
				_condition = 2
			end
			return _condition
		end
		function FullAction:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			local _result = self.config_.OnTick
			if _result ~= nil then
				_result = _result(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			end
			local _condition = _result
			if _condition == nil then
				_condition = 0
			end
			return _condition
		end
		function FullAction:OnHalt(bb)
			local _result = self.config_.OnHalt
			if _result ~= nil then
				_result(bb)
			end
		end
		function FullAction:OnExit(status, bb)
			local _result = self.config_.OnExit
			if _result ~= nil then
				_result(status, bb)
			end
		end
		function FullAction:OnBecameInactive(bb)
			local _result = self.config_.OnBecameInactive
			if _result ~= nil then
				_result(bb)
			end
		end
		function FullAction:OnSuccess(bb)
			local _result = self.config_.OnSuccess
			if _result ~= nil then
				_result(bb)
			end
		end
		function FullAction:OnFailure(bb)
			local _result = self.config_.OnFailure
			if _result ~= nil then
				_result(bb)
			end
		end
	end
	_container.FullAction = FullAction
	local function CreateFullAction(config)
		return FullAction.new(config)
	end
	_container.CreateFullAction = CreateFullAction
	--* Cooldown - enforces a cooldown period after child execution 
	local Cooldown
	do
		local super = Decorator
		Cooldown = setmetatable({}, {
			__tostring = function()
				return "Cooldown"
			end,
			__index = super,
		})
		Cooldown.__index = Cooldown
		function Cooldown.new(...)
			local self = setmetatable({}, Cooldown)
			return self:constructor(...) or self
		end
		function Cooldown:constructor(child, cooldown_s_, reset_on_halt_)
			if reset_on_halt_ == nil then
				reset_on_halt_ = false
			end
			super.constructor(self, child)
			self.cooldown_s_ = cooldown_s_
			self.reset_on_halt_ = reset_on_halt_
			self.time_left_ = 0
		end
		function Cooldown:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			self.time_left_ -= dt
			if self.time_left_ > 0 then
				return 1
			end
			local status = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			return status
		end
		function Cooldown:OnExit(status, bb)
			if status == 2 and not self.reset_on_halt_ then
				return nil
			end
			if self.time_left_ > 0 then
				return nil
			end
			self.time_left_ = self.cooldown_s_
		end
	end
	_container.Cooldown = Cooldown
	--* Timer - checks if a timer has expired 
	local Timer
	do
		local super = Node
		Timer = setmetatable({}, {
			__tostring = function()
				return "Timer"
			end,
			__index = super,
		})
		Timer.__index = Timer
		function Timer.new(...)
			local self = setmetatable({}, Timer)
			return self:constructor(...) or self
		end
		function Timer:constructor(key_name_)
			super.constructor(self)
			self.key_name_ = key_name_
		end
		function Timer:OnTick(dt, bb, running_nodes)
			if not bb:HasWild(self.key_name_) then
				return 1
			end
			local time_left = bb:UpdateWild(self.key_name_, function(v)
				return v - dt
			end)
			return if time_left <= 0 then 0 else 1
		end
	end
	_container.Timer = Timer
	--* SubTree - references another behavior tree 
	local SubTree
	do
		local super = Node
		SubTree = setmetatable({}, {
			__tostring = function()
				return "SubTree"
			end,
			__index = super,
		})
		SubTree.__index = SubTree
		function SubTree.new(...)
			local self = setmetatable({}, SubTree)
			return self:constructor(...) or self
		end
		function SubTree:constructor(subtree_)
			super.constructor(self)
			self.subtree_ = subtree_
		end
		function SubTree:OnTick(dt)
			return self.subtree_:Tick(dt)
		end
		function SubTree:OnHalt()
			self.subtree_:Halt()
		end
	end
	_container.SubTree = SubTree
	local FSMConnector
	do
		local super = Node
		FSMConnector = setmetatable({}, {
			__tostring = function()
				return "FSMConnector"
			end,
			__index = super,
		})
		FSMConnector.__index = FSMConnector
		function FSMConnector.new(...)
			local self = setmetatable({}, FSMConnector)
			return self:constructor(...) or self
		end
		function FSMConnector:constructor(fsm_)
			super.constructor(self)
			self.fsm_ = fsm_
		end
		function FSMConnector:OnStart()
			self.fsm_:Start()
			return 2
		end
		function FSMConnector:OnTick(dt)
			self.fsm_:Update(dt)
			return 2
		end
		function FSMConnector:OnHalt()
			self.fsm_:Stop()
		end
	end
	_container.FSMConnector = FSMConnector
	local GoapConnector
	do
		local super = Node
		GoapConnector = setmetatable({}, {
			__tostring = function()
				return "GoapConnector"
			end,
			__index = super,
		})
		GoapConnector.__index = GoapConnector
		function GoapConnector.new(...)
			local self = setmetatable({}, GoapConnector)
			return self:constructor(...) or self
		end
		function GoapConnector:constructor(goap_)
			super.constructor(self)
			self.goap_ = goap_
		end
		function GoapConnector:OnStart(bb)
			return 2
		end
		function GoapConnector:OnTick(dt, bb, running_nodes)
			self.goap_:Update(dt)
			return 2
		end
		function GoapConnector:OnHalt()
			self.goap_:Reset()
		end
	end
	_container.GoapConnector = GoapConnector
	--[[
		*
			 * A node that executes a callback function with success.
			 
	]]
	local Callback
	do
		local super = Node
		Callback = setmetatable({}, {
			__tostring = function()
				return "Callback"
			end,
			__index = super,
		})
		Callback.__index = Callback
		function Callback.new(...)
			local self = setmetatable({}, Callback)
			return self:constructor(...) or self
		end
		function Callback:constructor(callback_)
			super.constructor(self)
			self.callback_ = callback_
		end
		function Callback:OnTick(dt, bb, running_nodes, new_active_nodes)
			self.callback_(bb, dt)
			return 0
		end
	end
	_container.Callback = Callback
	--* Plug - a node that always returns a specified status (useful for testing) 
	local Plug
	do
		local super = Node
		Plug = setmetatable({}, {
			__tostring = function()
				return "Plug"
			end,
			__index = super,
		})
		Plug.__index = Plug
		function Plug.new(...)
			local self = setmetatable({}, Plug)
			return self:constructor(...) or self
		end
		function Plug:constructor(status_)
			if status_ == nil then
				status_ = 0
			end
			super.constructor(self)
			self.status_ = status_
		end
		function Plug:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			return self.status_
		end
	end
	_container.Plug = Plug
	--* OneShot - executes child once and returns same result on subsequent ticks 
	local OneShot
	do
		local super = Decorator
		OneShot = setmetatable({}, {
			__tostring = function()
				return "OneShot"
			end,
			__index = super,
		})
		OneShot.__index = OneShot
		function OneShot.new(...)
			local self = setmetatable({}, OneShot)
			return self:constructor(...) or self
		end
		function OneShot:constructor(child, reset_on_become_inactive_)
			if reset_on_become_inactive_ == nil then
				reset_on_become_inactive_ = false
			end
			super.constructor(self, child)
			self.reset_on_become_inactive_ = reset_on_become_inactive_
		end
		function OneShot:OnTick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
			if self.res_ == nil then
				local res = self.child_:Tick(dt, bb, running_nodes, new_active_nodes, old_active_nodes)
				if res == 2 then
					return 2
				end
				self.res_ = res
			end
			return self.res_
		end
		function OneShot:OnBecameInactive(bb)
			if not self.reset_on_become_inactive_ then
				return nil
			end
			self.res_ = nil
		end
	end
	_container.OneShot = OneShot
	--* Main BehaviorTree class with active node tracking 
	local BehaviorTree
	do
		BehaviorTree = setmetatable({}, {
			__tostring = function()
				return "BehaviorTree"
			end,
		})
		BehaviorTree.__index = BehaviorTree
		function BehaviorTree.new(...)
			local self = setmetatable({}, BehaviorTree)
			return self:constructor(...) or self
		end
		function BehaviorTree:constructor(root_, blackboard_)
			self.root_ = root_
			self.blackboard_ = blackboard_
			self.running_nodes_ = {}
			self.active_nodes_ = {}
			self.is_running_ = false
			self.scheduling_halt_ = false
		end
		function BehaviorTree:Tick(dt)
			self.is_running_ = true
			local new_running_nodes = {}
			local new_active_nodes = {}
			local status = self.root_:Tick(dt, self.blackboard_, new_running_nodes, new_active_nodes, self.active_nodes_)
			-- Halt nodes that were active but are no longer traversed
			for node in self.running_nodes_ do
				if not (new_running_nodes[node] ~= nil) then
					node:Halt(self.blackboard_)
				end
			end
			for node in self.active_nodes_ do
				if not (new_active_nodes[node] ~= nil) then
					node:OnBecameInactive(self.blackboard_)
				end
			end
			self.running_nodes_ = new_running_nodes
			self.active_nodes_ = new_active_nodes
			self.is_running_ = false
			if self.scheduling_halt_ then
				self.scheduling_halt_ = false
				self:Halt()
			end
			return status
		end
		function BehaviorTree:Halt()
			if self.is_running_ then
				self.scheduling_halt_ = true
				return nil
			end
			self.root_:Halt(self.blackboard_)
			for node in self.running_nodes_ do
				node:Halt(self.blackboard_)
			end
			for node in self.active_nodes_ do
				node:OnBecameInactive(self.blackboard_)
			end
			table.clear(self.running_nodes_)
			table.clear(self.active_nodes_)
		end
		function BehaviorTree:GetBlackboard()
			return self.blackboard_
		end
		function BehaviorTree:GetRoot()
			return self.root_
		end
		function BehaviorTree:GetActiveNodes()
			return table.clone(self.active_nodes_)
		end
	end
	_container.BehaviorTree = BehaviorTree
end
return {
	BTree = BTree,
}
