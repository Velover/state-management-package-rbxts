import { BTree } from "./BehaviorTree";

const HttpService = game.GetService("HttpService");

interface INodeData {
	name: string;
	children: string[]; //id[]
	parameters?: {
		[param_name: string]: string | number; //parameter name and value
	};
	switch_case?: {
		cases: {
			[case_name: string]: string; //id;
		};
		default?: string; //id
		parameter_name: string; //name of the parameter on the blackboard
	};
}

interface IFileStructure {
	name: string;
	baked_at: string;
	version: string;
	structure: {
		[id: string]: INodeData;
	};
}

function IsArray(value: unknown): value is unknown[] {
	return (
		typeIs(value, "table") &&
		(value as defined[]).size() === (value as Map<unknown, unknown>).size()
	);
}

function ValidateSchema(data: unknown): data is IFileStructure {
	if (!typeIs(data, "table")) {
		throw "Invalid data: must be a non-null object";
	}
	if (!("name" in data) || !typeIs(data.name, "string")) {
		throw "Invalid data: 'name' must be a string";
	}
	if (!("baked_at" in data) || !typeIs(data.baked_at, "string")) {
		throw "Invalid data: 'baked_at' must be a string";
	}
	if (!("version" in data) || !typeIs(data.version, "string")) {
		throw "Invalid data: 'version' must be a string";
	}
	if (!("structure" in data) || !typeIs(data.structure, "table")) {
		throw "Invalid data: 'structure' must be a non-null object";
	}

	const structure = data.structure as Map<string, INodeData>;
	for (const [id, node] of structure) {
		if (!typeIs(node.name, "string")) {
			throw `Invalid node: '${id}' name must be a string`;
		}
		if (!IsArray(node.children)) {
			throw `Invalid node: '${id}' children must be an array`;
		}
		for (const child of node.children) {
			if (!typeIs(child, "string")) {
				throw `Invalid node: '${id}' child must be a string`;
			}
			if (!structure.has(child)) {
				throw `Invalid node: '${id}' child '${child}' must be defined in structure`;
			}
		}
		if (node.parameters && !typeIs(node.parameters, "table")) {
			throw `Invalid node: '${id}' parameters must be an object`;
		}
		if (node.parameters) {
			for (const [param_name, param_value] of node.parameters as unknown as Map<string, unknown>) {
				if (!typeIs(param_value, "string") && !typeIs(param_value, "number")) {
					throw `Invalid node: '${id}' parameter '${param_name}' must be a string or number`;
				}
			}
		}
		if (node.switch_case !== undefined && !typeIs(node.switch_case, "table")) {
			throw `Invalid node: '${id}' switch_case must be an object`;
		}
		if (node.switch_case !== undefined) {
			const cases = node.switch_case.cases;
			if (!typeIs(cases, "table")) {
				throw `Invalid node: '${id}' switch_case cases must be a non-null object`;
			}
			for (const [case_name] of cases as unknown as Map<string, unknown>) {
				if (!typeIs(cases[case_name], "string")) {
					throw `Invalid node: '${id}' switch_case case '${case_name}' must be a string`;
				}
				if (!structure.has(cases[case_name])) {
					throw `Invalid node: '${id}' switch_case case '${case_name}' must be defined in structure`;
				}
			}
			if (node.switch_case.default !== undefined) {
				if (!typeIs(node.switch_case.default, "string")) {
					throw `Invalid node: '${id}' switch_case default must be a string`;
				}
				if (!structure.has(node.switch_case.default)) {
					throw `Invalid node: '${id}' switch_case default must be defined in structure`;
				}
			}
			if (!typeIs(node.switch_case.parameter_name, "string")) {
				throw `Invalid node: '${id}' switch_case parameter_name must be a string`;
			}
		}
	}

	let entry_point_exists = false;
	for (const [id, node] of structure) {
		if (node.name === "EntryPoint") {
			entry_point_exists = true;
			break;
		}
	}

	if (!entry_point_exists) {
		throw "Invalid data: 'EntryPoint' node must exist in structure";
	}
	return true;
}

type Slot = BTree.Slot;
type ActionFn = (slot: Slot, dt: number, tree: BTree.BehaviorTree) => BTree.ENodeStatus;
type ConditionFn = (slot: Slot, dt: number, tree: BTree.BehaviorTree) => boolean;
type CallbackFn = (slot: Slot, dt: number, tree: BTree.BehaviorTree) => void;
type SwitchSelector = (slot: Slot, tree: BTree.BehaviorTree) => string | undefined;

/**
 * Builds a shared `BTree.BehaviorTree` from a JSON description. Register named actions, conditions,
 * callbacks, fields and sub-trees, then call `Build()`. The nodes are created once; agents are added to
 * the returned tree with `AddAgent`.
 */
export class BTCreator {
	private node_creators_ = new Map<string, (creator: BTCreator) => BTree.Node>();
	private data_?: IFileStructure;
	private created_nodes_map_ = new Map<string, BTree.Node>();

	private actions_registry_map_ = new Map<string, ActionFn>();
	private condition_registry_map_ = new Map<string, ConditionFn>();
	private callback_registry_map_ = new Map<string, CallbackFn>();
	private sub_tree_registry_map_ = new Map<string, () => BTree.Node>();
	private field_registry_map_ = new Map<string, Map<Slot, unknown>>();
	private selector_registry_map_ = new Map<string, SwitchSelector>();

	private current_node_id_?: string;
	private nodes_loaded_ = false;
	private readonly tree_options_?: { external_ids?: boolean };

	/** @param tree_options passed to every `BehaviorTree` this creator builds, e.g. `{ external_ids: true }`. */
	constructor(tree_options?: { external_ids?: boolean }) {
		this.tree_options_ = tree_options;
	}

	/**@asserts validity, loads node creators based on version */
	LoadData(json_data: string): void {
		const data = HttpService.JSONDecode(json_data);

		try {
			const is_valid = ValidateSchema(data);
			if (!is_valid) return;
		} catch (err) {
			throw `Invalid file structure: ${err}`;
		}
		this.data_ = data;

		if (!this.nodes_loaded_) {
			this.LoadDefaultNodes();
			const version = data.version;
			if (version === "2.0.0") {
				this.LoadV2Nodes();
			} else if (version === "1.0.0") {
				this.LoadV1Nodes();
			}
			this.nodes_loaded_ = true;
		}
	}

	private AssertLoaded() {
		if (this.data_ === undefined) {
			throw "BTree file not loaded. Call LoadData() first.";
		}
	}

	public GetCreatedNode(id: string): BTree.Node {
		const node = this.created_nodes_map_.get(id);
		if (node === undefined) {
			throw `Node with id '${id}' has not been created yet.`;
		}
		return node;
	}

	private AnalyzeStructure(data: IFileStructure) {
		const entry_point = [...(data.structure as unknown as Map<string, INodeData>)].find(
			([, node]) => node.name === "EntryPoint",
		);
		if (!entry_point) {
			throw "Invalid data: 'EntryPoint' node must exist in structure";
		}
		const Analyze = (child_id: string, order: string[]): void => {
			const node_data = this.GetNodeData(child_id);
			for (const child of node_data.children) {
				Analyze(child, order);
			}
			if (node_data.switch_case) {
				for (const [, case_id] of node_data.switch_case.cases as unknown as Map<string, string>) {
					Analyze(case_id, order);
				}
				if (node_data.switch_case.default) {
					Analyze(node_data.switch_case.default, order);
				}
			}
			order.push(child_id);
		};
		const entry_id = entry_point[0];
		const order: string[] = [];
		Analyze(entry_id, order);
		return order;
	}

	public GetNodeData(id: string): INodeData {
		this.AssertLoaded();
		if (!this.data_!.structure[id]) {
			throw `Node '${id}' not found in structure`;
		}
		return this.data_!.structure[id];
	}

	AddNodeCreator(node_name: string, creator: (creator: BTCreator) => BTree.Node): void {
		if (this.node_creators_.has(node_name)) {
			throw `Node creator for '${node_name}' already exists.`;
		}
		this.node_creators_.set(node_name, creator);
	}

	private GetNodeCreator(node_name: string): (creator: BTCreator) => BTree.Node {
		const creator = this.node_creators_.get(node_name);
		if (creator === undefined) {
			throw `Node creator for '${node_name}' not found.`;
		}
		return creator;
	}

	/** Builds the root node only, for embedding this file's tree inside another (see RegisterSubTree). */
	BuildRoot(): BTree.Node {
		this.AssertLoaded();
		const order = this.AnalyzeStructure(this.data_!);
		order.pop(); // Remove the EntryPoint node from the order

		for (const id of order) {
			this.current_node_id_ = id;
			const node_data = this.GetNodeData(id);
			const creator = this.GetNodeCreator(node_data.name);
			const node = creator(this);
			this.created_nodes_map_.set(id, node);
		}

		const last_node_id = order[order.size() - 1];
		const last_node = this.GetCreatedNode(last_node_id);
		this.created_nodes_map_.clear();
		this.current_node_id_ = undefined;
		return last_node;
	}

	/** Builds the tree. Every registered field is registered on it, so removing an agent clears them. */
	Build(): BTree.BehaviorTree {
		const tree = new BTree.BehaviorTree(this.BuildRoot(), this.tree_options_);
		for (const [, field] of this.field_registry_map_) tree.RegisterField(field);
		return tree;
	}

	public GetCurrentNodeId(): string {
		if (this.current_node_id_ === undefined) {
			throw "Cannot use current node id outside of building process.";
		}
		return this.current_node_id_;
	}

	public GetCurrentNodeData(): INodeData {
		if (this.current_node_id_ === undefined) {
			throw "Cannot use current node data outside of building process.";
		}
		return this.GetNodeData(this.current_node_id_);
	}

	public RegisterAction(action_name: string, action: ActionFn): void {
		if (this.actions_registry_map_.has(action_name)) {
			throw `Action '${action_name}' already registered.`;
		}
		this.actions_registry_map_.set(action_name, action);
	}

	public RegisterCondition(condition_name: string, condition: ConditionFn): void {
		if (this.condition_registry_map_.has(condition_name)) {
			throw `Condition '${condition_name}' already registered.`;
		}
		this.condition_registry_map_.set(condition_name, condition);
	}

	/** Registers a factory producing the root node of a sub-tree. It is called once per `SubTree` node. */
	public RegisterSubTree(sub_tree_name: string, sub_tree: () => BTree.Node): void {
		if (this.sub_tree_registry_map_.has(sub_tree_name)) {
			throw `SubTree '${sub_tree_name}' already registered.`;
		}
		this.sub_tree_registry_map_.set(sub_tree_name, sub_tree);
	}

	public RegisterCallback(callback_name: string, callback: CallbackFn): void {
		if (this.callback_registry_map_.has(callback_name)) {
			throw `Callback '${callback_name}' already registered.`;
		}
		this.callback_registry_map_.set(callback_name, callback);
	}

	/**
	 * Registers a per-agent field by name so `Timer`, `WasEntryUpdated` and `Switch` nodes can refer to it,
	 * and so the built tree clears it when an agent is removed. Returns the map for your own use.
	 */
	public RegisterField<T>(field_name: string, field?: Map<Slot, T>): Map<Slot, T> {
		if (this.field_registry_map_.has(field_name)) {
			throw `Field '${field_name}' already registered.`;
		}
		const map = field ?? new Map<Slot, T>();
		this.field_registry_map_.set(field_name, map as Map<Slot, unknown>);
		return map;
	}

	/** Registers a named selector for `Switch` nodes whose `parameter_name` is not a registered field. */
	public RegisterSelector(selector_name: string, selector: SwitchSelector): void {
		if (this.selector_registry_map_.has(selector_name)) {
			throw `Selector '${selector_name}' already registered.`;
		}
		this.selector_registry_map_.set(selector_name, selector);
	}

	public GetField<T = unknown>(field_name: string): Map<Slot, T> {
		const field = this.field_registry_map_.get(field_name);
		if (field === undefined) {
			throw `Field '${field_name}' not found.`;
		}
		return field as Map<Slot, T>;
	}

	private GetCallback(callback_name: string): CallbackFn {
		const callback = this.callback_registry_map_.get(callback_name);
		if (callback === undefined) {
			throw `Callback '${callback_name}' not found.`;
		}
		return callback;
	}

	private GetAction(action_name: string): ActionFn {
		const action = this.actions_registry_map_.get(action_name);
		if (action === undefined) {
			throw `Action '${action_name}' not found.`;
		}
		return action;
	}

	private GetCondition(condition_name: string): ConditionFn {
		const condition = this.condition_registry_map_.get(condition_name);
		if (condition === undefined) {
			throw `Condition '${condition_name}' not found.`;
		}
		return condition;
	}

	private GetSubTree(sub_tree_name: string): () => BTree.Node {
		const sub_tree = this.sub_tree_registry_map_.get(sub_tree_name);
		if (sub_tree === undefined) {
			throw `SubTree '${sub_tree_name}' not found.`;
		}
		return sub_tree;
	}

	private GetSelector(name: string): SwitchSelector {
		const selector = this.selector_registry_map_.get(name);
		if (selector !== undefined) return selector;
		const field = this.field_registry_map_.get(name);
		if (field !== undefined) return (slot) => field.get(slot) as string | undefined;
		throw `Switch parameter '${name}' is neither a registered selector nor a registered field.`;
	}

	public GetCurrentNodeParameter<T extends "string" | "number">(
		name: string,
		parameter_type: T,
	): T extends "string" ? string : number {
		const node_data = this.GetCurrentNodeData();
		if (!node_data.parameters) {
			throw `Node '${node_data.name}':'${this.current_node_id_}' has no parameters defined. Searching parameter name ${name}`;
		}
		const value = node_data.parameters[name];
		if (!typeIs(value, parameter_type)) {
			throw `Parameter '${name}' on node '${node_data.name}':'${this.current_node_id_}' must be a ${parameter_type}.`;
		}
		return value as never;
	}

	/** Optional string parameter of the current node, or undefined when absent. */
	public GetCurrentNodeOptionalString(name: string): string | undefined {
		const value = this.GetCurrentNodeData().parameters?.[name];
		return typeIs(value, "string") && value !== "" ? value : undefined;
	}

	/** The already-built children of the current node, in order. */
	public GetCurrentChildren(): BTree.Node[] {
		const children = this.GetCurrentNodeData().children;
		const nodes = new Array<BTree.Node>(children.size());
		for (let i = 0; i < children.size(); i++) nodes[i] = this.GetCreatedNode(children[i]);
		return nodes;
	}

	/** The already-built first child of the current node (decorators). */
	public GetCurrentChild(): BTree.Node {
		return this.GetCreatedNode(this.GetCurrentNodeData().children[0]);
	}

	/** Loads all default node creators shared across versions */
	public LoadDefaultNodes() {
		this.AddNodeCreator("Sequence", (c) => BTree.Sequence(...c.GetCurrentChildren()));
		this.AddNodeCreator("ReactiveSequence", (c) =>
			BTree.ReactiveSequence(...c.GetCurrentChildren()),
		);
		this.AddNodeCreator("MemorySequence", (c) => BTree.MemorySequence(...c.GetCurrentChildren()));
		this.AddNodeCreator("Fallback", (c) => BTree.Fallback(...c.GetCurrentChildren()));
		this.AddNodeCreator("ReactiveFallback", (c) =>
			BTree.ReactiveFallback(...c.GetCurrentChildren()),
		);

		this.AddNodeCreator("Parallel", (c) => {
			const success_policy =
				c.GetCurrentNodeParameter("successPolicy", "string") === "ALL"
					? BTree.EParallelPolicy.ALL
					: BTree.EParallelPolicy.ONE;
			const failure_policy =
				c.GetCurrentNodeParameter("failurePolicy", "string") === "ALL"
					? BTree.EParallelPolicy.ALL
					: BTree.EParallelPolicy.ONE;
			return BTree.Parallel(success_policy, failure_policy, ...c.GetCurrentChildren());
		});

		this.AddNodeCreator("Inverter", (c) => BTree.Inverter(c.GetCurrentChild()));
		this.AddNodeCreator("ForceSuccess", (c) => BTree.ForceSuccess(c.GetCurrentChild()));
		this.AddNodeCreator("ForceFailure", (c) => BTree.ForceFailure(c.GetCurrentChild()));
		this.AddNodeCreator("FireAndForget", (c) => BTree.FireAndForget(c.GetCurrentChild()));
		this.AddNodeCreator("RunningGate", (c) => BTree.RunningGate(c.GetCurrentChild()));

		this.AddNodeCreator("IfThenElse", (c) => {
			const [condition, then_node, else_node] = c.GetCurrentChildren();
			return BTree.IfThenElse(condition, then_node, else_node);
		});

		this.AddNodeCreator("WhileDoElse", (c) => {
			const [condition, do_node, else_node] = c.GetCurrentChildren();
			return BTree.WhileDoElse(condition, do_node, else_node);
		});

		this.AddNodeCreator("Action", (c) => {
			const action_name = c.GetCurrentNodeParameter("actionName", "string");
			return BTree.Action(c.GetAction(action_name), action_name);
		});

		this.AddNodeCreator("Condition", (c) => {
			const condition_name = c.GetCurrentNodeParameter("conditionName", "string");
			return BTree.Condition(c.GetCondition(condition_name), condition_name);
		});

		this.AddNodeCreator("Wait", (c) => BTree.Wait(c.GetCurrentNodeParameter("duration", "number")));
		this.AddNodeCreator("WaitGate", (c) =>
			BTree.WaitGate(c.GetCurrentNodeParameter("duration", "number")),
		);

		this.AddNodeCreator("Timer", (c) => {
			const timer_name = c.GetCurrentNodeParameter("timerName", "string");
			return BTree.Timer(c.GetField<number>(timer_name));
		});

		this.AddNodeCreator("SubTree", (c) => {
			const sub_tree_name = c.GetCurrentNodeParameter("treeName", "string");
			return c.GetSubTree(sub_tree_name)();
		});

		this.AddNodeCreator("Timeout", (c) => {
			const timeout_seconds = c.GetCurrentNodeParameter("timeoutSeconds", "number");
			const timeout_behavior =
				c.GetCurrentNodeParameter("timeoutBehavior", "string") === "FAILURE"
					? BTree.ETimeoutBehavior.FAILURE
					: BTree.ETimeoutBehavior.SUCCESS;
			return BTree.Timeout(timeout_seconds, c.GetCurrentChild(), timeout_behavior);
		});

		this.AddNodeCreator("Repeat", (c) => {
			const repeat_count = c.GetCurrentNodeParameter("repeatCount", "number");
			const repeat_condition_raw = c.GetCurrentNodeParameter("repeatCondition", "string");
			const repeat_condition =
				repeat_condition_raw === "SUCCESS"
					? BTree.ERepeatCondition.SUCCESS
					: repeat_condition_raw === "FAILURE"
						? BTree.ERepeatCondition.FAILURE
						: BTree.ERepeatCondition.ALWAYS;
			return BTree.Repeat(repeat_count, c.GetCurrentChild(), repeat_condition);
		});

		this.AddNodeCreator("Cooldown", (c) => {
			const cooldown_seconds = c.GetCurrentNodeParameter("cooldownSeconds", "number");
			const reset_on_halt = c.GetCurrentNodeParameter("resetOnHalt", "string") === "TRUE";
			return BTree.Cooldown(cooldown_seconds, c.GetCurrentChild(), reset_on_halt);
		});

		this.AddNodeCreator("Switch", (c) => {
			const switch_case = c.GetCurrentNodeData().switch_case!;
			const cases = new Map<string, BTree.Node>();
			for (const [case_name, case_id] of switch_case.cases as unknown as Map<string, string>) {
				cases.set(case_name, c.GetCreatedNode(case_id));
			}
			const default_node =
				switch_case.default !== undefined ? c.GetCreatedNode(switch_case.default) : undefined;
			return BTree.Switch(c.GetSelector(switch_case.parameter_name), cases, default_node);
		});

		this.AddNodeCreator("Callback", (c) => {
			const callback_name = c.GetCurrentNodeParameter("callbackName", "string");
			return BTree.Callback(c.GetCallback(callback_name), callback_name);
		});

		this.AddNodeCreator("Plug", (c) => {
			const status = c.GetCurrentNodeParameter("status", "string");
			let final_status: BTree.ENodeStatus;
			if (status === "RUNNING") {
				final_status = BTree.ENodeStatus.RUNNING;
			} else if (status === "FAILURE") {
				final_status = BTree.ENodeStatus.FAILURE;
			} else {
				final_status = BTree.ENodeStatus.SUCCESS;
			}
			return BTree.Plug(final_status);
		});

		this.AddNodeCreator("OneShot", (c) => {
			const reset_on_become_inactive =
				c.GetCurrentNodeParameter("resetOnBecomeInactive", "string") === "TRUE";
			return BTree.OneShot(c.GetCurrentChild(), reset_on_become_inactive);
		});
	}

	/** Loads v1 node creators (default set only) */
	public LoadV1Nodes() {
		this.AddNodeCreator("RetryUntilSuccess", (c) =>
			BTree.KeepRunningUntilSuccess(
				c.GetCurrentChild(),
				c.GetCurrentNodeParameter("maxAttempts", "number"),
			),
		);
		this.AddNodeCreator("RetryUntilFailure", (c) =>
			BTree.KeepRunningUntilFailure(
				c.GetCurrentChild(),
				c.GetCurrentNodeParameter("maxAttempts", "number"),
			),
		);
	}

	/** Loads v2 node creators (adds v2 nodes on top of default) */
	public LoadV2Nodes() {
		this.AddNodeCreator("KeepRunningUntilSuccess", (c) =>
			BTree.KeepRunningUntilSuccess(
				c.GetCurrentChild(),
				c.GetCurrentNodeParameter("maxAttempts", "number"),
			),
		);
		this.AddNodeCreator("KeepRunningUntilFailure", (c) =>
			BTree.KeepRunningUntilFailure(
				c.GetCurrentChild(),
				c.GetCurrentNodeParameter("maxAttempts", "number"),
			),
		);

		this.AddNodeCreator("TryCatch", (c) => {
			const [try_node, catch_node, finally_node] = c.GetCurrentChildren();
			return BTree.TryCatch(try_node, catch_node, finally_node);
		});

		this.AddNodeCreator("WasEntryUpdated", (c) => {
			const entries = c.GetCurrentNodeParameter("entries", "string").split(",");
			const skip_first = c.GetCurrentNodeParameter("skipFirst", "string") === "TRUE";
			const fields = new Array<Map<Slot, unknown>>(entries.size());
			for (let i = 0; i < entries.size(); i++) fields[i] = c.GetField(entries[i]);
			return BTree.WasFieldUpdated(fields, skip_first);
		});
		this.AddNodeCreator("Log", (c) => BTree.Log(c.GetCurrentNodeParameter("message", "string")));
		this.AddNodeCreator("ForceRunning", (c) => BTree.ForceRunning(c.GetCurrentChild()));

		this.AddNodeCreator("Scope", (c) => {
			const enter_name = c.GetCurrentNodeOptionalString("onEnter");
			const exit_name = c.GetCurrentNodeOptionalString("onExit");
			const enter = enter_name !== undefined ? c.GetCallback(enter_name) : undefined;
			const exit = exit_name !== undefined ? c.GetCallback(exit_name) : undefined;
			return BTree.Scope({
				OnEnter: enter !== undefined ? (slot, tree) => enter(slot, 0, tree) : undefined,
				OnExit: exit !== undefined ? (slot, tree) => exit(slot, 0, tree) : undefined,
			});
		});
	}
}
