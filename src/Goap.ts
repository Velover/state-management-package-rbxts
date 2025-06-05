import { Blackboard } from "./Blackboard";

function AssertNumber(value: unknown): asserts value is number {
	assert(typeIs(value, "number"), "Expected a number, but got: " + typeOf(value));
}

function AssertBoolean(value: unknown): asserts value is boolean {
	assert(typeIs(value, "boolean"), "Expected a boolean, but got: " + typeOf(value));
}

export namespace Goap {
	export type Effect = (other_v: unknown) => unknown;
	export type Requirement = (other_v: unknown) => boolean;

	export class WorldState extends Blackboard {
		SatisfiesRequirements(requirements: Map<string, Requirement>): boolean {
			for (const [key, requirement] of requirements) {
				const value = this.GetWild(key);
				if (value === undefined || !requirement(value)) {
					return false;
				}
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
		Clone(): WorldState {
			const cloned = new WorldState({}, {});
			// Access the protected data_ property properly
			for (const [key, value] of this.data_) {
				cloned.SetWild(key, this.DeepClone(value));
			}
			return cloned;
		}

		private DeepClone(obj: unknown): unknown {
			if (typeIs(obj, "table")) {
				const clone = table.clone(obj);
				for (const [key, v] of clone as Map<unknown, unknown>) {
					clone[key as never] = this.DeepClone(v) as never;
				}
				return clone;
			}

			return obj;
		}
	}

	export class WorldStateSet {
		private states_: WorldState[] = [];
		Add(state: WorldState): void {
			if (!this.Has(state)) this.states_.push(state);
		}

		Has(state: WorldState): boolean {
			return this.states_.some((s) => s.Equals(state));
		}

		Delete(state: WorldState): boolean {
			const index = this.states_.findIndex((s) => s.Equals(state));
			this.states_.remove(index);
			return index !== -1;
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
		public name: string;
		public priority: number;
		public requirements: Map<string, Requirement>;

		constructor(name: string, priority: number = 1) {
			this.name = name;
			this.priority = priority;
			this.requirements = new Map();
		}

		AddRequirement(key: string, requirement: Requirement): Goal {
			this.requirements.set(key, requirement);
			return this;
		}

		IsSatisfied(world_state: WorldState): boolean {
			return world_state.SatisfiesRequirements(this.requirements);
		}

		// Calculate how close we are to achieving this goal (0 = achieved, higher = further)
		CalculateDistance(world_state: WorldState): number {
			let unsatisfied = 0;
			for (const [key, requirement] of this.requirements) {
				const value = world_state.GetWild(key);
				if (value === undefined || !requirement(value)) unsatisfied++;
			}
			return unsatisfied;
		}
	}

	// Plan represents a sequence of actions to achieve a goal
	export class Plan {
		public actions: Action[];
		public cost: number;
		public goal: Goal;

		constructor(goal: Goal, actions: Action[] = [], cost: number = 0) {
			this.goal = goal;
			this.actions = actions;
			this.cost = cost;
		}

		IsEmpty(): boolean {
			return this.actions.size() === 0;
		}

		GetNextAction(): Action | undefined {
			return this.actions[0];
		}

		PopAction(): Action | undefined {
			return this.actions.shift();
		}

		Clone(): Plan {
			return new Plan(this.goal, [...this.actions], this.cost);
		}
	}

	// Node for A* search algorithm
	class PlanNode {
		public WorldState: WorldState;
		public Action?: Action;
		public Parent?: PlanNode;
		public GCost: number; // Cost from start
		public HCost: number; // Heuristic cost to goal
		public FCost: number; // Total cost

		constructor(
			world_state: WorldState,
			action?: Action,
			parent?: PlanNode,
			g_cost: number = 0,
			h_cost: number = 0,
		) {
			this.WorldState = world_state;
			this.Action = action;
			this.Parent = parent;
			this.GCost = g_cost;
			this.HCost = h_cost;
			this.FCost = g_cost + h_cost;
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

			//reverse the path
			for (let i = 0, j = path.size() - 1; i < j; i++, j--) {
				[path[i], path[j]] = [path[j], path[i]];
			}

			return path;
		}
	}

	// Priority queue for A* algorithm
	class PriorityQueue<T> {
		private items: Array<{ item: T; priority: number }> = [];

		Enqueue(item: T, priority: number): void {
			this.items.push({ item, priority });
			this.items.sort((a, b) => a.priority < b.priority);
		}

		Dequeue(): T | undefined {
			const item = this.items.shift();
			return item?.item;
		}

		IsEmpty(): boolean {
			return this.items.size() === 0;
		}

		Contains(predicate: (item: T) => boolean): boolean {
			return this.items.some((entry) => predicate(entry.item));
		}

		Replace(predicate: (item: T) => boolean, new_item: T, new_priority: number): boolean {
			const index = this.items.findIndex((entry) => predicate(entry.item));
			if (index === -1) return false;

			this.items[index] = { item: new_item, priority: new_priority };
			this.items.sort((a, b) => a.priority < b.priority);
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

					// Check if this path to newState is better than unknown existing one
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

		RemoveGoal(goal_name: string): void {
			const goal_index = this.goals_.findIndex((goal) => goal.name === goal_name);
			this.goals_.remove(goal_index);

			if (this.current_goal_?.name === goal_name) {
				this.current_goal_ = undefined;
				this.current_plan_ = undefined;
			}
		}

		// Main update loop
		Update(dt: number): void {
			this.planning_cooldown_ -= dt;

			// Clear finished actions from active set
			for (const action of this.active_nodes_) {
				if (!action.IsRunning()) this.active_nodes_.delete(action);
			}

			// Check if we need to replan
			if (this.ShouldReplan()) this.CreateNewPlan();

			if (this.current_plan_ === undefined) return;
			if (this.current_plan_.IsEmpty()) return;

			// Execute current plan
			this.ExecuteCurrentPlan(dt, this.world_state_);
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

			// Create plan for the goal
			const plan = this.planner_.CreatePlan(this.world_state_, best_goal, this.available_actions_);

			if (plan !== undefined) {
				this.current_plan_ = plan;
				this.current_goal_ = best_goal;
				print(`New plan created for goal: ${best_goal.name} with ${plan.actions.size()} actions`);
				return;
			}

			this.current_plan_ = undefined;
			this.current_goal_ = undefined;
		}

		private FindBestGoal(): Goal | undefined {
			let bestGoal: Goal | undefined;
			let bestScore = -math.huge;

			for (const goal of this.goals_) {
				// Skip already satisfied goals
				if (goal.IsSatisfied(this.world_state_)) continue;

				// Simple scoring: higher priority is better
				const score = goal.priority;
				if (score <= bestScore) continue;

				bestScore = score;
				bestGoal = goal;
			}

			return bestGoal;
		}

		private ExecuteCurrentPlan(dt: number, current_state: WorldState): void {
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
			const status = current_action.Tick(dt, this.world_state_, this.active_nodes_);

			if (status === EActionStatus.SUCCESS) {
				print("Action completed successfully");
				this.current_plan_.PopAction();
			} else if (status === EActionStatus.FAILURE) {
				print("Action failed, replanning...");
				this.current_plan_ = undefined;
			}
			// If RUNNING, continue next frame
		}

		private StopCurrentPlan(): void {
			if (this.current_plan_ === undefined) return;

			// Halt unknown running actions
			for (const action of this.current_plan_.actions) {
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
			if (interval_s <= 0) {
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
		Is: (): ((v: boolean) => boolean) => (other_v: unknown) => {
			AssertBoolean(other_v);
			return other_v;
		},
		IsNot: (): ((v: boolean) => boolean) => (other_v: unknown) => {
			AssertBoolean(other_v);
			return !other_v;
		},
		IsIn:
			(values: defined[]): Requirement =>
			(other_v: unknown) => {
				return values.includes(other_v as never);
			},
		IsNotIn:
			(values: defined[]): Requirement =>
			(other_v: unknown) => {
				return !values.includes(other_v as never);
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
		Decrement:
			(value: number = 1): Effect =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v - value;
			},
		Increment:
			(value: number = 1): Effect =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v + value;
			},
		Insert:
			(v: defined): Effect =>
			(other_v: unknown) => {
				assert(
					typeIs(other_v, "table"),
					"Insert effect can only be applied to arrays, but got: " + typeOf(other_v),
				);
				(other_v as defined[]).push(v);
				return other_v;
			},
		Remove:
			(v: defined): Effect =>
			(other_v: unknown) => {
				assert(
					typeIs(other_v, "table"),
					"Remove effect can only be applied to arrays, but got: " + typeOf(other_v),
				);

				const other_v_array = other_v as defined[];
				other_v_array.remove(other_v_array.indexOf(v));
				return other_v;
			},
		Multiply:
			(v: number): Effect =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				return other_v * v;
			},
		Divide:
			(v: number): Effect =>
			(other_v: unknown) => {
				AssertNumber(other_v);
				if (v === 0) throw "Division by zero is not allowed.";
				return other_v / v;
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

		public Tick(dt: number, world_state: WorldState, active_nodes: Set<Action>): EActionStatus {
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
				const status = this.OnTick(dt, world_state, active_nodes);

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
			dt: number,
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
}
