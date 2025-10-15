import { HttpService } from "@rbxts/services";
import { BTree } from "BehaviorTree";
import { Blackboard } from "Blackboard";

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

export class BTCreator {
	private node_creators_ = new Map<string, (creator: BTCreator) => BTree.Node>();
	private data_?: IFileStructure;
	private created_nodes_map_ = new Map<string, BTree.Node>();

	private actions_registry_map_ = new Map<
		string,
		(bb: Blackboard, dt: number) => BTree.ENodeStatus
	>();
	private condition_registry_map_ = new Map<string, (bb: Blackboard, dt: number) => boolean>();
	private callback_registry_map_ = new Map<string, (bb: Blackboard, dt: number) => void>();
	private sub_tree_registry_map_ = new Map<string, (bb: Blackboard) => BTree.BehaviorTree>();

	private current_node_id_?: string;
	private current_blackboard_?: Blackboard;
	constructor() {
		this.FilloutDefaultCreators();
	}

	/**@asserts validity */
	LoadData(json_data: string): void {
		const data = HttpService.JSONDecode(json_data);

		try {
			const is_valid = ValidateSchema(data);
			if (!is_valid) return;
		} catch (error) {
			throw `Invalid file structure: ${error}`;
		}
		this.data_ = data;
	}

	private AssertLoaded() {
		if (this.data_ === undefined) {
			throw "BTree file not loaded. Call LoadFile() first.";
		}
	}

	private GetCreatedNode(id: string): BTree.Node {
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
				for (const [case_name, case_id] of node_data.switch_case.cases as unknown as Map<
					string,
					string
				>) {
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

	private GetNodeData(id: string): INodeData {
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

	Build(bb: Blackboard) {
		this.AssertLoaded();
		const order = this.AnalyzeStructure(this.data_!);

		order.pop(); // Remove the EntryPoint node from the order

		for (const id of order) {
			this.current_blackboard_ = bb;
			this.current_node_id_ = id;
			const node_data = this.GetNodeData(id);
			const creator = this.GetNodeCreator(node_data.name);
			const node = creator(this);
			this.created_nodes_map_.set(id, node);
		}

		const last_node_id = order[order.size() - 1];
		const last_node = this.GetCreatedNode(last_node_id);
		this.created_nodes_map_.clear();
		this.current_blackboard_ = undefined; // Reset current blackboard after building
		this.current_node_id_ = undefined; // Reset current node id after building
		return new BTree.BehaviorTree(last_node, bb);
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

	public GetCurrentBlackboard(): Blackboard {
		if (this.current_blackboard_ === undefined) {
			throw "Cannot use current blackboard outside of building process.";
		}
		return this.current_blackboard_;
	}

	public RegisterAction(
		action_name: string,
		action: (bb: Blackboard, dt: number) => BTree.ENodeStatus,
	): void {
		if (this.actions_registry_map_.has(action_name)) {
			throw `Action '${action_name}' already registered.`;
		}
		this.actions_registry_map_.set(action_name, action);
	}

	public RegisterCondition(
		condition_name: string,
		condition: (bb: Blackboard, dt: number) => boolean,
	): void {
		if (this.condition_registry_map_.has(condition_name)) {
			throw `Condition '${condition_name}' already registered.`;
		}
		this.condition_registry_map_.set(condition_name, condition);
	}

	public RegisterSubTree(
		sub_tree_name: string,
		sub_tree: (bb: Blackboard) => BTree.BehaviorTree,
	): void {
		if (this.sub_tree_registry_map_.has(sub_tree_name)) {
			throw `SubTree '${sub_tree_name}' already registered.`;
		}
		this.sub_tree_registry_map_.set(sub_tree_name, sub_tree);
	}

	public RegisterCallback(
		callback_name: string,
		callback: (bb: Blackboard, dt: number) => void,
	): void {
		if (this.callback_registry_map_.has(callback_name)) {
			throw `Callback '${callback_name}' already registered.`;
		}
		this.callback_registry_map_.set(callback_name, callback);
	}

	private GetCallback(callback_name: string): (bb: Blackboard, dt: number) => void {
		const callback = this.callback_registry_map_.get(callback_name);
		if (callback === undefined) {
			throw `Callback '${callback_name}' not found.`;
		}
		return callback;
	}

	private GetAction(action_name: string): (bb: Blackboard, dt: number) => BTree.ENodeStatus {
		const action = this.actions_registry_map_.get(action_name);
		if (action === undefined) {
			throw `Action '${action_name}' not found.`;
		}
		return action;
	}

	private GetCondition(condition_name: string): (bb: Blackboard, dt: number) => boolean {
		const condition = this.condition_registry_map_.get(condition_name);
		if (condition === undefined) {
			throw `Condition '${condition_name}' not found.`;
		}
		return condition;
	}

	private GetSubTree(sub_tree_name: string): (bb: Blackboard) => BTree.BehaviorTree {
		const sub_tree = this.sub_tree_registry_map_.get(sub_tree_name);
		if (sub_tree === undefined) {
			throw `SubTree '${sub_tree_name}' not found.`;
		}
		return sub_tree;
	}

	public GetCurrentNodeParameter<T extends "string" | "number">(
		name: string,
		parameter_type: T,
	): T extends "string" ? string : number {
		const node_data = this.GetCurrentNodeData();
		if (!node_data.parameters) {
			throw `Node '${this.current_node_id_}' has no parameters defined.`;
		}
		const value = node_data.parameters[name];
		if (!typeIs(value, parameter_type)) {
			throw `Parameter '${name}' on node '${this.current_node_id_}' must be a ${parameter_type}.`;
		}
		return value as never;
	}

	private FilloutDefaultCreators() {
		this.AddNodeCreator("Sequence", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const sequence = new BTree.Sequence();
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				sequence.AddChild(child_node);
			}
			return sequence;
		});

		this.AddNodeCreator("ReactiveSequence", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const sequence = new BTree.ReactiveSequence();
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				sequence.AddChild(child_node);
			}
			return sequence;
		});

		this.AddNodeCreator("MemorySequence", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const sequence = new BTree.MemorySequence();
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				sequence.AddChild(child_node);
			}
			return sequence;
		});

		this.AddNodeCreator("Fallback", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const fallback = new BTree.Fallback();
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				fallback.AddChild(child_node);
			}
			return fallback;
		});

		this.AddNodeCreator("ReactiveFallback", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const fallback = new BTree.ReactiveFallback();
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				fallback.AddChild(child_node);
			}
			return fallback;
		});

		this.AddNodeCreator("Parallel", (creator) => {
			const children = creator.GetCurrentNodeData().children;
			const success_policy =
				creator.GetCurrentNodeParameter("successPolicy", "string") === "ALL"
					? BTree.EParallelPolicy.ALL
					: BTree.EParallelPolicy.ONE;

			const failure_policy =
				creator.GetCurrentNodeParameter("failurePolicy", "string") === "ALL"
					? BTree.EParallelPolicy.ALL
					: BTree.EParallelPolicy.ONE;

			const parallel = new BTree.Parallel(success_policy, failure_policy);
			for (const child_id of children) {
				const child_node = creator.GetCreatedNode(child_id);
				parallel.AddChild(child_node);
			}
			return parallel;
		});

		this.AddNodeCreator("Inverter", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.Inverter(child_node);
		});

		this.AddNodeCreator("ForceSuccess", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.ForceSuccess(child_node);
		});

		this.AddNodeCreator("ForceFailure", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.ForceFailure(child_node);
		});

		this.AddNodeCreator("FireAndForget", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.FireAndForget(child_node);
		});

		this.AddNodeCreator("RunningGate", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.RunningGate(child_node);
		});

		this.AddNodeCreator("IfThenElse", (creator) => {
			const node_data = creator.GetCurrentNodeData();
			const if_then_else = new BTree.IfThenElse();
			for (const child_id of node_data.children) {
				const child_node = creator.GetCreatedNode(child_id);
				if_then_else.AddChild(child_node);
			}
			return if_then_else;
		});

		this.AddNodeCreator("WhileDoElse", (creator) => {
			const node_data = creator.GetCurrentNodeData();
			const while_do_else = new BTree.WhileDoElse();
			for (const child_id of node_data.children) {
				const child_node = creator.GetCreatedNode(child_id);
				while_do_else.AddChild(child_node);
			}
			return while_do_else;
		});

		this.AddNodeCreator("Action", (creator) => {
			const action_name = creator.GetCurrentNodeParameter("actionName", "string");
			const action = creator.GetAction(action_name);
			return new BTree.Action(action);
		});

		this.AddNodeCreator("Condition", (creator) => {
			const condition_name = creator.GetCurrentNodeParameter("conditionName", "string");
			const condition = creator.GetCondition(condition_name);
			return new BTree.Condition(condition);
		});

		this.AddNodeCreator("Wait", (creator) => {
			const duration = creator.GetCurrentNodeParameter("duration", "number");
			return new BTree.Wait(duration);
		});
		this.AddNodeCreator("WaitGate", (creator) => {
			const duration = creator.GetCurrentNodeParameter("duration", "number");
			return new BTree.WaitGate(duration);
		});

		this.AddNodeCreator("Timer", (creator) => {
			const timer_name = creator.GetCurrentNodeParameter("timerName", "string");
			return new BTree.Timer(timer_name);
		});

		this.AddNodeCreator("SubTree", (creator) => {
			const sub_tree_name = creator.GetCurrentNodeParameter("treeName", "string");
			const sub_tree_creator = creator.GetSubTree(sub_tree_name);
			return new BTree.SubTree(sub_tree_creator(creator.GetCurrentBlackboard()));
		});

		this.AddNodeCreator("Timeout", (creator) => {
			const timeout_seconds = creator.GetCurrentNodeParameter("timeoutSeconds", "number");
			const timeout_behavior_raw = creator.GetCurrentNodeParameter("timeoutBehavior", "string");
			const timeout_behavior =
				timeout_behavior_raw === "FAILURE"
					? BTree.ETimeoutBehavior.FAILURE
					: BTree.ETimeoutBehavior.SUCCESS;
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			return new BTree.Timeout(child_node, timeout_seconds, timeout_behavior);
		});

		this.AddNodeCreator("RetryUntilSuccess", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			const max_attempts = creator.GetCurrentNodeParameter("maxAttempts", "number");
			return new BTree.RetryUntilSuccess(child_node, max_attempts);
		});

		this.AddNodeCreator("RetryUntilFailure", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			const max_attempts = creator.GetCurrentNodeParameter("maxAttempts", "number");
			return new BTree.RetryUntilFailure(child_node, max_attempts);
		});

		this.AddNodeCreator("Repeat", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			const repeat_count = creator.GetCurrentNodeParameter("repeatCount", "number");
			const repeat_condition_raw = creator.GetCurrentNodeParameter("repeatCondition", "string");
			const repeat_condition =
				repeat_condition_raw === "SUCCESS"
					? BTree.ERepeatCondition.SUCCESS
					: repeat_condition_raw === "FAILURE"
						? BTree.ERepeatCondition.FAILURE
						: BTree.ERepeatCondition.ALWAYS;

			return new BTree.Repeat(child_node, repeat_count, repeat_condition);
		});

		this.AddNodeCreator("Cooldown", (creator) => {
			const child_id = creator.GetCurrentNodeData().children[0];
			const child_node = creator.GetCreatedNode(child_id);
			const cooldown_seconds = creator.GetCurrentNodeParameter("cooldownSeconds", "number");
			const reset_on_halt = creator.GetCurrentNodeParameter("resetOnHalt", "string") === "TRUE";
			return new BTree.Cooldown(child_node, cooldown_seconds, reset_on_halt);
		});

		this.AddNodeCreator("Switch", (creator) => {
			const node_data = creator.GetCurrentNodeData();
			const switch_node = new BTree.Switch(node_data.switch_case!.parameter_name);
			for (const [case_name, case_id] of node_data.switch_case!.cases as unknown as Map<
				string,
				string
			>) {
				const case_node = creator.GetCreatedNode(case_id);
				switch_node.Case(case_name, case_node);
			}
			if (node_data.switch_case!.default) {
				const default_id = node_data.switch_case!.default;
				const default_node = creator.GetCreatedNode(default_id);
				switch_node.Default(default_node);
			}
			return switch_node;
		});

		this.AddNodeCreator("Callback", (creator) => {
			const callback_name = creator.GetCurrentNodeParameter("callbackName", "string");
			const callback = creator.GetCallback(callback_name);
			return new BTree.Callback(callback);
		});
	}
}
