--!native
--!optimize 2
-- Compiled with roblox-ts v3.0.0
local Blackboard
do
	Blackboard = setmetatable({}, {
		__tostring = function()
			return "Blackboard"
		end,
	})
	Blackboard.__index = Blackboard
	function Blackboard.new(...)
		local self = setmetatable({}, Blackboard)
		return self:constructor(...) or self
	end
	function Blackboard:constructor(initial_data, wild_data)
		if wild_data == nil then
			wild_data = {}
		end
		self.data_ = {}
		if initial_data == nil then
			return nil
		end
		for k, v in initial_data do
			self.data_[k] = v
		end
		for k, v in wild_data do
			self.data_[k] = v
		end
	end
	function Blackboard:Cast()
		return self
	end
	function Blackboard:Set(key, value)
		local _data_ = self.data_
		local _key = key
		local _value = value
		_data_[_key] = _value
	end
	function Blackboard:SetWild(key, value)
		local _data_ = self.data_
		local _key = key
		local _value = value
		_data_[_key] = _value
		return value
	end
	function Blackboard:UpdateWild(key, callback)
		local _data_ = self.data_
		local _key = key
		local current_value = _data_[_key]
		local new_value = callback(current_value)
		local _data__1 = self.data_
		local _key_1 = key
		_data__1[_key_1] = new_value
		return new_value
	end
	function Blackboard:Get(key)
		local _data_ = self.data_
		local _key = key
		return _data_[_key]
	end
	function Blackboard:Update(key, callback)
		local _data_ = self.data_
		local _key = key
		local current_value = _data_[_key]
		local new_value = callback(current_value)
		local _data__1 = self.data_
		local _key_1 = key
		_data__1[_key_1] = new_value
		return new_value
	end
	function Blackboard:GetWild(key)
		local _data_ = self.data_
		local _key = key
		return _data_[_key]
	end
	function Blackboard:GetWildOrDefault(key, default_value)
		local _data_ = self.data_
		local _key = key
		local _condition = (_data_[_key])
		if _condition == nil then
			_condition = default_value
		end
		return _condition
	end
	function Blackboard:HasWild(key)
		local _data_ = self.data_
		local _key = key
		return _data_[_key] ~= nil
	end
	function Blackboard:DeleteWild(key)
		local _data_ = self.data_
		local _key = key
		-- ▼ Map.delete ▼
		local _valueExisted = _data_[_key] ~= nil
		_data_[_key] = nil
		-- ▲ Map.delete ▲
		return _valueExisted
	end
	function Blackboard:GetWildOfType(key, v_type)
		local _data_ = self.data_
		local _key = key
		local value = _data_[_key]
		if value == nil then
			return nil
		end
		local _exp = typeof(value)
		local _v_type = v_type
		if _exp ~= typeof(_v_type) then
			local _exp_1 = key
			local _v_type_1 = v_type
			warn(`Type mismatch for key "{_exp_1}": expected {typeof(_v_type_1)}, got {typeof(value)}`)
			return nil
		end
		return value
	end
	function Blackboard:GetOrDefaultWildOfType(key, v_type, default_value)
		local _data_ = self.data_
		local _key = key
		local value = _data_[_key]
		if value == nil then
			return default_value
		end
		local _exp = typeof(value)
		local _v_type = v_type
		if _exp ~= typeof(_v_type) then
			local _exp_1 = key
			local _v_type_1 = v_type
			warn(`Type mismatch for key "{_exp_1}": expected {typeof(_v_type_1)}, got {typeof(value)}`)
			return default_value
		end
		return value
	end
end
return {
	Blackboard = Blackboard,
}
