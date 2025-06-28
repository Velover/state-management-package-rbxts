//native
//optimize 2
import { FSM } from "FSM";
import { Blackboard } from "./Blackboard";
import { BTree } from "BehaviorTree";

function AssertNumber(value: unknown): asserts value is number {
	if (typeIs(value, "number")) return;
	throw "Expected a number, but got: " + typeOf(value);
}

function AssertBoolean(value: unknown): asserts value is boolean {
	if (typeIs(value, "boolean")) return;
	throw "Expected a boolean, but got: " + typeOf(value);
}

export namespace Goap {
	export type Effect = (other_v: unknown) => unknown;
	export type Requirement = (other_v: unknown) => boolean;

	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	export class WorldState<T extends Record<string, unknown> = {}> extends Blackboard<T> {
		SatisfiesRequirements(requirements: Map<string, Requirement>): boolean {
			for (const [key, requirement] of requirements) {
				const value = this.GetWild(key);
				if (!requirement(value)) return false;
			}
			return true;
		}

		ApplyEffects(effects: Map<string, Effect>): void {
			for (const [key, effect] of effects) {
				const currentValue = this.GetWild(key);
				const newValue = effect(currentValue);
				this.SetWild(key, newValue);
			}
		}

		// Clone method for planning
		Clone(): WorldState<T> {
			const obj = { data_: table.clone(this.data_) };
			return setmetatable(obj, WorldState as never) as never;
		}

		override Cast<T extends Record<string, unknown>>(): WorldState<T> {
			return this as unknown as WorldState<T>;
		}

		public Size(): number {
			return this.data_.size();
		}

		// Enhanced distance calculation with weights
		CalculateWeightedDistance(goal: Goal): number {
			let total_distance = 0;
			for (const [key, requirement] of goal.RequirementsMap) {
				const value = this.GetWild(key);
				const weight = goal.GetRequirementWeight(key);
				if (!requirement(value)) total_distance += weight;
			}
			return total_distance;
		}

		public Equals(target: WorldState): boolean {
			const target_data = target.data_;
			if (target_data.size() !== this.data_.size()) return false;

			for (const [k, v] of target.data_) {
				if (this.data_.get(k) !== v) return false;
			}

			return true;
		}
	}

	export class WorldStateSet {
		private states_: WorldState[] = [];
		private states_set_ = new Set<string>();
		Add(state: WorldState): void {
			if (!this.Has(state)) this.states_.push(state);
		}

		Has(state: WorldState): boolean {
			return this.states_.some((s) => s.Equals(state));
		}

		Delete(state: WorldState): boolean {
			const index = this.states_.findIndex((s) => s.Equals(state));
			if (index !== -1) {
				this.states_.remove(index);
				return true;
			}
			return false;
		}
	}

	export const enum EActionStatus {
		SUCCESS,
		FAILURE,
		RUNNING,
	}

	export const enum EActionState {
		IDLE,
		RUNNING,
		HALTED,
	}

	// Goal represents what the agent wants to achieve
	export class Goal {
		public Name: string;
		public RequirementsMap = new Map<string, Requirement>();
		private priority_v_: number = 1;
		private priority_func_?: (world_state: WorldState, agent: Agent) => number;
		private requirement_weights_ = new Map<string, number>();
		private sub_goals_: Goal[] = [];
		private is_composite_: boolean = false;

		constructor(
			name: string,
			priority?: ((world_state: WorldState, agent: Agent) => number) | number,
			is_composite: boolean = false,
		) {
			this.Name = name;
			this.is_composite_ = is_composite;
			if (typeIs(priority, "function")) {
				this.priority_func_ = priority;
			} else if (typeIs(priority, "number")) {
				this.priority_v_ = priority;
			}
		}

		public GetPriority(world_state: WorldState, agent: Agent): number {
			return this.priority_func_?.(world_state, agent) ?? this.priority_v_;
		}

		AddRequirement(key: string, requirement: Requirement, weight: number = 1): Goal {
			this.RequirementsMap.set(key, requirement);
			this.requirement_weights_.set(key, weight);
			return this;
		}

		GetRequirementWeight(key: string): number {
			return this.requirement_weights_.get(key) ?? 1;
		}

		// Hierarchical goal support
		AddSubGoal(goal: Goal): Goal {
			this.sub_goals_.push(goal);
			return this;
		}

		GetSubGoals(): Goal[] {
			return [...this.sub_goals_];
		}

		IsComposite(): boolean {
			return this.is_composite_;
		}

		DecomposeIntoSubgoals(): Goal[] {
			return this.sub_goals_.size() > 0 ? this.GetSubGoals() : [this];
		}

		IsSatisfied(world_state: WorldState): boolean {
			if (this.is_composite_) {
				return this.sub_goals_.every((goal) => goal.IsSatisfied(world_state));
			}
			return world_state.SatisfiesRequirements(this.RequirementsMap);
		}

		// Enhanced distance calculation with weights
		CalculateDistance(world_state: WorldState): number {
			if (!this.is_composite_) {
				return world_state.CalculateWeightedDistance(this);
			}
			return this.sub_goals_.reduce(
				(total, goal) => total + goal.CalculateDistance(world_state),
				0,
			);
		}
	}

	// Plan represents a sequence of actions to achieve a goal
	export class Plan {
		constructor(
			public Goal: Goal,
			public Actions: Action[] = [],
			public Cost: number = 0,
		) {}

		IsEmpty(): boolean {
			return this.Actions.size() === 0;
		}

		GetNextAction(): Action | undefined {
			return this.Actions[0];
		}

		PopAction(): Action | undefined {
			return this.Actions.shift();
		}

		Clone(): Plan {
			return new Plan(this.Goal, [...this.Actions], this.Cost);
		}
	}

	// Node for A* search algorithm
	class PlanNode {
		public FCost: number; // Total cost

		constructor(
			public WorldState: WorldState,
			public Action?: Action,
			public Parent?: PlanNode,
			public GCost: number = 0,
			public HCost: number = 0,
		) {
			this.FCost = this.GCost + this.HCost;
		}

		// Reconstruct the path from start to this node
		ReconstructPath(): Action[] {
			const path: Action[] = [];
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			let current: PlanNode | undefined = this;

			while (current !== undefined && current.Action !== undefined) {
				path.push(current.Action);
				current = current.Parent;
			}

			//inline reverse to avoid extra array allocation
			for (let i = 0, j = path.size() - 1; i < j; i++, j--) {
				[path[i], path[j]] = [path[j], path[i]];
			}

			return path;
		}
	}

	// Priority queue for A* algorithm
	class PriorityQueue<T> {
		private items_: Array<{ item: T; priority: number }> = [];

		Enqueue(item: T, priority: number): void {
			this.items_.push({ item, priority });
			this.items_.sort((a, b) => a.priority < b.priority);
		}

		Dequeue(): T | undefined {
			const item = this.items_.shift();
			return item?.item;
		}

		IsEmpty(): boolean {
			return this.items_.size() === 0;
		}

		Contains(predicate: (item: T) => boolean): boolean {
			return this.items_.some((entry) => predicate(entry.item));
		}

		Replace(predicate: (item: T) => boolean, new_item: T, new_priority: number): boolean {
			const index = this.items_.findIndex((entry) => predicate(entry.item));
			if (index === -1) return false;

			this.items_[index] = { item: new_item, priority: new_priority };
			this.items_.sort((a, b) => a.priority < b.priority);
			return true;
		}
	}

	// Main planner class using A* algorithm
	export class Planner {
		private max_iterations_: number;

		constructor(max_iterations: number = 1000) {
			this.max_iterations_ = max_iterations;
		}

		CreatePlan(
			current_state: WorldState,
			goal: Goal,
			available_actions: Action[],
		): Plan | undefined {
			// Handle composite goals
			if (goal.IsComposite()) {
				return this.CreateHierarchicalPlan(current_state, goal, available_actions);
			}

			// If goal is already satisfied, return empty plan
			if (goal.IsSatisfied(current_state)) return new Plan(goal);

			const open_set = new PriorityQueue<PlanNode>();
			const closed_set = new WorldStateSet();

			// Create start node
			const start_node = new PlanNode(
				current_state.Clone(),
				undefined,
				undefined,
				0,
				goal.CalculateDistance(current_state),
			);

			open_set.Enqueue(start_node, start_node.FCost);

			let iterations = 0;
			while (!open_set.IsEmpty() && iterations < this.max_iterations_) {
				iterations++;

				const current_node = open_set.Dequeue()!;

				if (closed_set.Has(current_node.WorldState)) continue;

				closed_set.Add(current_node.WorldState);

				// Check if goal is reached
				if (goal.IsSatisfied(current_node.WorldState)) {
					const actions = current_node.ReconstructPath();
					return new Plan(goal, actions, current_node.GCost);
				}

				// Explore neighbors (apply each possible action)
				for (const action of available_actions) {
					const satisfies_requirements = current_node.WorldState.SatisfiesRequirements(
						action.GetStaticRequirements(current_node.WorldState),
					);

					// Action cannot be performed in this state
					if (!satisfies_requirements) continue;

					// Create new state by applying action effects
					const new_state = current_node.WorldState.Clone();
					new_state.ApplyEffects(action.GetStaticEffects(current_node.WorldState));

					// Already explored this state
					if (closed_set.Has(new_state)) continue;

					const g_cost = current_node.GCost + action.GetCost(current_node.WorldState);
					const h_cost = goal.CalculateDistance(new_state);
					const f_cost = g_cost + h_cost;

					const new_node = new PlanNode(new_state, action, current_node, g_cost, h_cost);

					// Check if this path to newState is better than any existing one
					const exists_in_open = open_set.Contains((node) => node.WorldState.Equals(new_state));

					if (!exists_in_open) {
						open_set.Enqueue(new_node, f_cost);
						continue;
					}

					// Replace if this path is better
					open_set.Replace(
						(node) => node.WorldState.Equals(new_state) && node.FCost > f_cost,
						new_node,
						f_cost,
					);
				}
			}

			// No plan found
			return undefined;
		}

		private CreateHierarchicalPlan(
			current_state: WorldState,
			composite_goal: Goal,
			available_actions: Action[],
		): Plan | undefined {
			const sub_goals = composite_goal.DecomposeIntoSubgoals();
			const combined_actions: Action[] = [];
			let total_cost = 0;
			const current_work_state = current_state.Clone();

			for (const sub_goal of sub_goals) {
				const sub_plan = this.CreatePlan(current_work_state, sub_goal, available_actions);
				if (sub_plan === undefined) return;

				for (const action of sub_plan.Actions) {
					combined_actions.push(action);
				}
				total_cost += sub_plan.Cost;

				// Apply sub-plan effects to working state
				for (const action of sub_plan.Actions) {
					current_work_state.ApplyEffects(action.GetStaticEffects(current_work_state));
				}
			}

			return new Plan(composite_goal, combined_actions, total_cost);
		}
	}

	// Main GOAP Agent
	export class Agent {
		private current_plan_?: Plan;
		private current_goal_?: Goal;
		private world_state_: WorldState;
		private available_actions_: Action[];
		private goals_: Goal[];
		private planner_: Planner;
		private active_nodes_: Set<Action> = new Set();
		private planning_cooldown_: number = 0;
		private planning_interval_: number = 1.0; // Replan every second if needed

		constructor(world_state: WorldState, available_actions: Action[] = [], goals: Goal[] = []) {
			this.world_state_ = world_state;
			this.available_actions_ = available_actions;
			this.goals_ = goals;
			this.planner_ = new Planner();
		}

		// Add actions and goals
		AddAction(action: Action): void {
			this.available_actions_.push(action);
		}

		AddGoal(goal: Goal): void {
			this.goals_.push(goal);
		}

		GetGoals(): Goal[] {
			return [...this.goals_];
		}

		RemoveGoal(goal_name: string): void {
			const goal_index = this.goals_.findIndex((goal) => goal.Name === goal_name);
			this.goals_.remove(goal_index);

			if (this.current_goal_?.Name === goal_name) {
				this.current_goal_ = undefined;
				this.current_plan_ = undefined;
			}
		}

		// Main update loop
		Update(dt_s: number): void {
			this.planning_cooldown_ -= dt_s;

			// Clear finished actions from active set
			for (const action of this.active_nodes_) {
				if (!action.IsRunning()) this.active_nodes_.delete(action);
			}

			// Check if we need to replan
			if (this.ShouldReplan()) this.CreateNewPlan();

			if (this.current_plan_ === undefined) return;
			if (this.current_plan_.IsEmpty()) return;

			// Execute current plan
			this.ExecuteCurrentPlan(dt_s, this.world_state_);
		}

		private ShouldReplan(): boolean {
			if (this.current_plan_ === undefined) return true;
			// Replan if no current plan
			if (this.current_plan_.IsEmpty()) return true;

			// Replan if current goal is satisfied
			if (this.current_goal_?.IsSatisfied(this.world_state_)) return true;

			// Replan periodically
			if (this.planning_cooldown_ <= 0) return true;

			return false;
		}

		private CreateNewPlan(): void {
			this.planning_cooldown_ = this.planning_interval_;

			// Stop current plan
			if (this.current_plan_ !== undefined) this.StopCurrentPlan();

			// Find highest priority achievable goal
			const best_goal = this.FindBestGoal();
			if (best_goal === undefined) {
				this.current_plan_ = undefined;
				this.current_goal_ = undefined;
				return;
			}

			const start = os.clock();
			// Create plan for the goal
			const plan = this.planner_.CreatePlan(this.world_state_, best_goal, this.available_actions_);
			const finish = os.clock();
			print(finish - start, "Took to create a plan");

			if (plan !== undefined) {
				this.current_plan_ = plan;
				this.current_goal_ = best_goal;
				print(`New plan created for goal: ${best_goal.Name} with ${plan.Actions.size()} actions`);
				return;
			}

			this.current_plan_ = undefined;
			this.current_goal_ = undefined;
		}

		private FindBestGoal(): Goal | undefined {
			let best_goal: Goal | undefined;
			let best_score = -math.huge;

			for (const goal of this.goals_) {
				// Skip already satisfied goals
				if (goal.IsSatisfied(this.world_state_)) continue;

				// Simple scoring: higher priority is better
				const score = goal.GetPriority(this.world_state_, this);
				if (score <= best_score) continue;

				best_score = score;
				best_goal = goal;
			}

			return best_goal;
		}

		private ExecuteCurrentPlan(dt_s: number, current_state: WorldState): void {
			if (this.current_plan_ === undefined) return;
			if (this.current_plan_.IsEmpty()) return;

			const current_action = this.current_plan_.GetNextAction();
			if (current_action === undefined) return;

			// Check if action can still be performed
			const satisfies_requirements = this.world_state_.SatisfiesRequirements(
				current_action.GetStaticRequirements(current_state),
			);
			if (!satisfies_requirements) {
				print("Action requirements no longer satisfied, replanning...");
				this.current_plan_ = undefined;
				return;
			}

			// Execute the action
			const status = current_action.Tick(dt_s, this.world_state_, this.active_nodes_);

			if (status === EActionStatus.SUCCESS) {
				// Apply the action's effects to the world state
				const effects = current_action.GetStaticEffects(this.world_state_);
				this.world_state_.ApplyEffects(effects);

				print("Action completed successfully - effects applied");
				this.current_plan_.PopAction();
			} else if (status === EActionStatus.FAILURE) {
				print("Action failed, replanning...");
				this.current_plan_ = undefined;
			}
			// If RUNNING, continue next frame
		}

		private StopCurrentPlan(): void {
			if (this.current_plan_ === undefined) return;

			// Halt any running actions
			for (const action of this.current_plan_.Actions) {
				if (action.IsRunning()) action.Halt();
			}
		}

		// Getters for debugging/monitoring
		GetCurrentGoal(): Goal | undefined {
			return this.current_goal_;
		}

		GetCurrentPlan(): Plan | undefined {
			return this.current_plan_;
		}

		GetWorldState(): WorldState {
			return this.world_state_;
		}

		IsIdle(): boolean {
			return this.current_plan_ === undefined || this.current_plan_.IsEmpty();
		}

		// Add a method to adjust planning interval dynamically
		SetPlanningInterval(interval_s: number): void {
			if (interval_s < 0) {
				warn("Planning interval must be positive, using default value");
				return;
			}

			this.planning_interval_ = interval_s;
		}

		Reset() {
			if (this.current_plan_ === undefined) return;
			this.StopCurrentPlan();
			this.current_plan_ = undefined;
			this.current_goal_ = undefined;
			this.active_nodes_.clear();
		}
	}

	// Utility comparison and effect functions (your existing code)
	export const Comparison = {
		GreaterThan:
			(value: number): Requirement =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v > value;
			},
		GreaterOrEq:
			(value: number): Requirement =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v >= value;
			},
		Eq:
			(value: unknown): Requirement =>
			(other_v: unknown) => {
				return other_v === value;
			},
		NEq:
			(value: unknown): Requirement =>
			(other_v: unknown) => {
				return other_v !== value;
			},
		Is: (): Requirement => (other_v: unknown) => {
			AssertBoolean(other_v);
			return other_v;
		},
		IsNot: (): Requirement => (other_v: unknown) => {
			AssertBoolean(other_v);
			return !other_v;
		},
		IsIn:
			(values: defined[]): Requirement =>
			(other_v: unknown) => {
				return values.includes(other_v!);
			},
		IsNotIn:
			(values: defined[]): Requirement =>
			(other_v: unknown) => {
				return !values.includes(other_v!);
			},
		InRange:
			(min: number, max: number): Requirement =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v >= min && other_v <= max;
			},
		LessThan:
			(value: number): Requirement =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v < value;
			},
		LessOrEq:
			(value: number): Requirement =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v <= value;
			},
		Exists: (): Requirement => (other_v: unknown) => {
			return other_v !== undefined;
		},
	};

	export const Effect = {
		IncrementClamp:
			(v: number, min: number, max: number): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				const newValue = current + v;
				if (newValue < min) return min;
				if (newValue > max) return max;
				return newValue;
			},
		DecrementClamp:
			(v: number, min: number, max: number): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				const newValue = current - v;
				if (newValue < min) return min;
				if (newValue > max) return max;
				return newValue;
			},
		Decrement:
			(value: number = 1): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				return current - value;
			},
		Increment:
			(value: number = 1): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				return current + value;
			},
		Insert:
			(v: defined): Effect =>
			(other_v: unknown) => {
				if (!typeIs(other_v, "table")) {
					throw "Insert effect can only be applied to arrays, but got: " + typeOf(other_v);
				}
				(other_v as defined[]).push(v!);
				return other_v as unknown[];
			},
		Remove:
			(value: defined): Effect =>
			(other_v: unknown) => {
				if (!typeIs(other_v, "table"))
					throw "Remove effect can only be applied to arrays, but got: " + typeOf(other_v);
				(other_v as defined[]).remove((other_v as defined[]).indexOf(value!));
				return other_v as unknown[];
			},
		Multiply:
			(v: number): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				return current * v;
			},
		Divide:
			(v: number): Effect =>
			(other_v: unknown = 0) => {
				const current = other_v;
				AssertNumber(current);
				if (v === 0) throw "Division by zero is not allowed.";
				return current / v;
			},
		Set:
			(value: unknown): Effect =>
			() => {
				return value;
			},
		Toggle: (): Effect => (other_v: unknown) => {
			if (typeIs(other_v, "boolean")) {
				return !other_v;
			} else if (typeIs(other_v, "number")) {
				return other_v === 0 ? 1 : 0;
			}
			throw "Toggle effect can only be applied to boolean or number types.";
		},
	};

	// Base Action class (your existing code)
	export abstract class Action {
		public abstract GetStaticEffects(world_state: WorldState): Map<string, Effect>;
		public abstract GetStaticRequirements(world_state: WorldState): Map<string, Requirement>;
		public abstract GetCost(world_state: WorldState): number;

		protected state_: EActionState = EActionState.IDLE;

		public Tick(dt_s: number, world_state: WorldState, active_nodes: Set<Action>): EActionStatus {
			if (this.state_ === EActionState.IDLE) {
				this.state_ = EActionState.RUNNING;
				const startStatus = this.OnStart(world_state);

				if (startStatus !== EActionStatus.RUNNING) {
					this.state_ = EActionState.IDLE;
					this.OnFinish(startStatus, world_state);
					return startStatus;
				}
			}

			if (this.state_ === EActionState.RUNNING) {
				const status = this.OnTick(dt_s, world_state, active_nodes);

				if (status === EActionStatus.RUNNING) {
					active_nodes.add(this);
				}

				if (status !== EActionStatus.RUNNING) {
					this.state_ = EActionState.IDLE;
					this.OnFinish(status, world_state);
				}

				return status;
			}

			if (this.state_ === EActionState.HALTED) {
				this.state_ = EActionState.IDLE;
				return EActionStatus.FAILURE;
			}

			return EActionStatus.FAILURE;
		}

		public Halt(): void {
			if (this.state_ !== EActionState.RUNNING) return;
			this.state_ = EActionState.HALTED;
			this.OnHalt();
			this.state_ = EActionState.IDLE;
		}

		public IsRunning(): boolean {
			return this.state_ === EActionState.RUNNING;
		}

		protected abstract OnTick(
			dt_s: number,
			world_state: WorldState,
			active_nodes: Set<Action>,
		): EActionStatus;

		protected OnStart(world_state: WorldState): EActionStatus {
			return EActionStatus.RUNNING;
		}

		protected OnFinish(status: EActionStatus, world_state: WorldState): void {
			// Default implementation - can be overridden
		}

		protected OnHalt(): void {
			// Default implementation - can be overridden
		}
	}

	export abstract class FSMConnector extends Action {
		constructor(protected readonly fsm_: FSM.FSM) {
			super();
		}

		protected override OnStart(world_state: WorldState): EActionStatus {
			this.fsm_.Start();
			return EActionStatus.RUNNING;
		}
		protected OnTick(
			dt: number,
			world_state: WorldState,
			active_nodes: Set<Action>,
		): EActionStatus {
			this.fsm_.Update(dt);
			return EActionStatus.RUNNING;
		}
		//OnFinish will never be called, as FSMConnector is always running
		protected override OnHalt(): void {
			this.fsm_.Stop();
		}
	}

	export abstract class BTConnector extends Action {
		constructor(protected readonly bt_: BTree.BehaviorTree) {
			super();
		}

		protected override OnStart(world_state: WorldState): EActionStatus {
			return EActionStatus.RUNNING;
		}

		protected override OnTick(
			dt: number,
			world_state: WorldState,
			active_nodes: Set<Action>,
		): EActionStatus {
			this.bt_.Tick(dt);
			return EActionStatus.RUNNING;
		}

		protected override OnHalt(): void {
			this.bt_.Halt();
		}
	}
}
