-- Runs the roblox-ts test files under Lune against the real package build.
-- Prerequisites:  bun run build   and   bun x rbxtsc -p tsconfig.tests.json
-- Usage:          lune run luau-bench/tests/run_rbxts_tests.luau [BehaviorTree ...]
--
-- Provides the tiny slice of the roblox-ts runtime the compiled files use (TS.import / TS.getModule,
-- `script` objects, _G.test_env) and a `warn` that prints. Modules come from ./out (the package build),
-- the tests from ./luau-bench/compiled-tests/tests.
local process = require("@lune/process")
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local ROOT = process.cwd:gsub("[\\/]+$", "")
local OUT = ROOT .. "/out"
local TESTS = ROOT .. "/luau-bench/compiled-tests/tests"
local TESTER = ROOT .. "/node_modules/@rbxts/tester/out/init.luau"

-- Fake Instance tree: only Parent / Name / child access by field is needed by the compiled code.
local function inst(name, parent)
	local self = { Name = name, Parent = parent, __children = {} }
	if parent then parent.__children[name] = self end
	return setmetatable(self, {
		__index = function(t, k)
			return rawget(t, "__children")[k]
		end,
	})
end

local cache = {}
local TS = {}

local function load_file(path, script_obj)
	if cache[path] ~= nil then return cache[path] end
	local src = fs.readFile(path)
	_G[script_obj] = TS -- compiled files start with `local TS = _G[script]`
	local env = setmetatable({ script = script_obj, TS = TS }, { __index = _G })
	local fn = luau.load(src, { debugName = path, environment = env, codegenEnabled = true })
	local result = fn()
	cache[path] = result
	return result
end

local src_root = inst("src")
local tests_folder = inst("tests", src_root)

local function module_path(node)
	-- node is a fake Instance under src_root; map to out/<Name>.luau
	if node == src_root then return OUT .. "/init.luau" end
	return OUT .. "/" .. node.Name .. ".luau"
end

function TS.import(caller, ...)
	local node = ...
	local parts = { select(2, ...) }
	for _, p in parts do node = node[p] or inst(p, node) end
	if node.__tester then
		return load_file(TESTER, node)
	end
	return load_file(module_path(node), node)
end

function TS.getModule(caller, scope, name)
	local m = inst(name)
	m.__tester = (name == "tester")
	m.__children.out = m
	return m
end

_G.test_env = true
_G.warn = function(...)
	print("[warn]", ...)
end
warn = _G.warn

-- Roblox-only globals used by out/ modules at load time.
_G.game = setmetatable({}, {
	__index = function(_, k)
		if k == "GetService" then
			return function(_, name)
				return setmetatable({}, { __index = function() return function() end end })
			end
		end
	end,
})
game = _G.game

local names = #process.args > 0 and process.args or { "BehaviorTree" }
local failed = 0
for _, name in names do
	local path = TESTS .. "/" .. name .. ".test.luau"
	local script_obj = inst(name .. ".test", tests_folder)
	print(("=== %s ==="):format(name))
	local ok, err = pcall(load_file, path, script_obj)
	if not ok then
		print("FAILED:", err)
		failed += 1
	end
end
if failed > 0 then process.exit(1) end
