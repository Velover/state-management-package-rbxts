//native
//optimize 2
import { FSM } from "./FSM";
import { Blackboard } from "./Blackboard";
import type { Goap } from "./Goap";

export namespace BTree {
	// Core enums and interfaces
	export const enum ENodeStatus {
		SUCCESS,
		FAILURE,
		RUNNING,
	}

	export const enum ENodeState {
		IDLE,
		RUNNING,
		HALTED,
	}

	export const enum EParallelPolicy {
		ONE = "ONE",
		ALL = "ALL",
	}

	export const enum ERepeatCondition {
		ALWAYS = "ALWAYS",
		SUCCESS = "SUCCESS",
		FAILURE = "FAILURE",
	}

	export const enum ETimeoutBehavior {
		FAILURE = "FAILURE",
		SUCCESS = "SUCCESS",
	}

	// Base node class
	export abstract class Node {
		protected state_: ENodeState = ENodeState.IDLE;

		public Tick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.state_ === ENodeState.IDLE) {
				this.state_ = ENodeState.RUNNING;
				const start_status = this.OnStart(bb);

				if (start_status !== ENodeStatus.RUNNING) {
					this.state_ = ENodeState.IDLE;
					this.OnFinish(start_status, bb);
					return start_status;
				}
			}

			if (this.state_ === ENodeState.RUNNING) {
				const status = this.OnTick(dt, bb, active_nodes);

				if (status === ENodeStatus.RUNNING) {
					active_nodes.add(this);
				}

				if (status !== ENodeStatus.RUNNING) {
					this.state_ = ENodeState.IDLE;
					this.OnFinish(status, bb);
				}

				return status;
			}

			// Handle HALTED state - node was interrupted
			if (this.state_ === ENodeState.HALTED) {
				this.state_ = ENodeState.IDLE;
				return ENodeStatus.FAILURE;
			}

			return ENodeStatus.FAILURE;
		}

		public Halt(): void {
			if (this.state_ !== ENodeState.RUNNING) return;
			this.state_ = ENodeState.HALTED;
			this.OnHalt();
			this.state_ = ENodeState.IDLE;
		}

		public IsRunning(): boolean {
			return this.state_ === ENodeState.RUNNING;
		}

		protected abstract OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus;

		protected OnStart(bb: Blackboard): ENodeStatus {
			// Default implementation - can be overridden
			return ENodeStatus.RUNNING;
		}

		protected OnFinish(status: ENodeStatus, bb: Blackboard): void {
			// Default implementation - can be overridden
		}

		/** Default implementation - can be overridden*/
		protected OnHalt(): void {}
	}

	// Composite nodes (can have multiple children)
	export abstract class Composite extends Node {
		protected children_: Node[] = [];

		public AddChild(child: Node): this {
			this.children_.push(child);
			return this;
		}

		public AddChildren(...children: Node[]): this {
			for (const child of children) {
				this.children_.push(child);
			}
			return this;
		}

		protected override OnHalt(): void {
			// Halt all running children
			for (const child of this.children_) {
				if (child.IsRunning()) child.Halt();
			}
		}

		protected HaltOtherChildren(except_child: Node): void {
			for (const child of this.children_) {
				if (child === except_child) continue;
				if (child.IsRunning()) child.Halt();
			}
		}
	}

	// Sequence - runs children in order until one fails
	export class Sequence extends Composite {
		private current_index_ = 0;

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_index_ = 0;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			for (let i = this.current_index_; i < this.children_.size(); i++) {
				const status = this.children_[i].Tick(dt, bb, active_nodes);

				if (status === ENodeStatus.RUNNING) {
					this.current_index_ = i;
					return ENodeStatus.RUNNING;
				} else if (status === ENodeStatus.FAILURE) {
					return ENodeStatus.FAILURE;
				}
			}

			return ENodeStatus.SUCCESS;
		}
	}

	// Sequence - runs children in order until one fails
	export class ReactiveSequence extends Composite {
		protected override OnStart(bb: Blackboard): ENodeStatus {
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			for (let i = 0; i < this.children_.size(); i++) {
				const status = this.children_[i].Tick(dt, bb, active_nodes);

				if (status === ENodeStatus.RUNNING) {
					this.HaltOtherChildren(this.children_[i]);
					return ENodeStatus.RUNNING;
				} else if (status === ENodeStatus.FAILURE) {
					return ENodeStatus.FAILURE;
				}
			}
			return ENodeStatus.SUCCESS;
		}
	}

	// Memory Sequence - remembers which child failed
	export class MemorySequence extends Composite {
		private current_index_ = 0;

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.children_.size() === 0) return ENodeStatus.SUCCESS;

			for (let i = this.current_index_; i < this.children_.size(); i++) {
				const status = this.children_[i].Tick(dt, bb, active_nodes);

				this.current_index_ = i;
				if (status === ENodeStatus.RUNNING) {
					return ENodeStatus.RUNNING;
				} else if (status === ENodeStatus.FAILURE) {
					return ENodeStatus.FAILURE;
				}
			}

			// Reset index after successful run
			this.current_index_ = 0;
			return ENodeStatus.SUCCESS;
		}
	}

	// Fallback - runs children in order until one succeeds
	export class Fallback extends Composite {
		private current_index_ = 0;

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_index_ = 0;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			for (let i = this.current_index_; i < this.children_.size(); i++) {
				const status = this.children_[i].Tick(dt, bb, active_nodes);

				if (status === ENodeStatus.RUNNING) {
					this.current_index_ = i;
					return ENodeStatus.RUNNING;
				} else if (status === ENodeStatus.SUCCESS) {
					return ENodeStatus.SUCCESS;
				}
			}

			return ENodeStatus.FAILURE;
		}
	}

	// ReactiveFallback - like Fallback but restarts from beginning when child returns RUNNING
	export class ReactiveFallback extends Composite {
		protected override OnStart(bb: Blackboard): ENodeStatus {
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			// Always start from beginning (reactive behavior)
			for (let i = 0; i < this.children_.size(); i++) {
				const status = this.children_[i].Tick(dt, bb, active_nodes);

				if (status === ENodeStatus.SUCCESS) {
					// Halt subsequent children
					this.HaltOtherChildren(this.children_[i]);
					return ENodeStatus.SUCCESS;
				} else if (status === ENodeStatus.RUNNING) {
					// Halt subsequent children and restart from beginning next tick
					this.HaltOtherChildren(this.children_[i]);
					return ENodeStatus.RUNNING;
				}

				// If FAILURE, continue to next child
			}

			return ENodeStatus.FAILURE;
		}
	}

	// Parallel - runs all children simultaneously
	export class Parallel extends Composite {
		constructor(
			private success_policy_: EParallelPolicy = EParallelPolicy.ALL,
			private failure_policy_: EParallelPolicy = EParallelPolicy.ONE,
		) {
			super();
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			let success_count = 0;
			let failure_count = 0;

			for (const child of this.children_) {
				const status = child.Tick(dt, bb, active_nodes);

				if (status === ENodeStatus.SUCCESS) {
					success_count++;
					if (this.success_policy_ === EParallelPolicy.ONE) {
						// Halt other children
						this.HaltOtherChildren(child);
						return ENodeStatus.SUCCESS;
					}
				} else if (status === ENodeStatus.FAILURE) {
					failure_count++;
					if (this.failure_policy_ === EParallelPolicy.ONE) {
						// Halt other children
						this.HaltOtherChildren(child);
						return ENodeStatus.FAILURE;
					}
				}
			}

			if (this.success_policy_ === EParallelPolicy.ALL && success_count === this.children_.size()) {
				return ENodeStatus.SUCCESS;
			}

			if (this.failure_policy_ === EParallelPolicy.ALL && failure_count === this.children_.size()) {
				return ENodeStatus.FAILURE;
			}

			return ENodeStatus.RUNNING;
		}
	}

	// Decorator base class
	export abstract class Decorator extends Node {
		constructor(protected child_: Node) {
			super();
		}

		protected override OnHalt(): void {
			if (this.child_.IsRunning()) this.child_.Halt();
		}
	}

	// Inverter - inverts SUCCESS/FAILURE results
	export class Inverter extends Decorator {
		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			const status = this.child_.Tick(dt, bb, active_nodes);

			if (status === ENodeStatus.SUCCESS) return ENodeStatus.FAILURE;
			else if (status === ENodeStatus.FAILURE) return ENodeStatus.SUCCESS;

			return status; // RUNNING
		}
	}

	// ForceSuccess - always returns SUCCESS unless child is RUNNING
	export class ForceSuccess extends Decorator {
		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			const status = this.child_.Tick(dt, bb, active_nodes);

			if (status === ENodeStatus.RUNNING) return ENodeStatus.RUNNING;

			return ENodeStatus.SUCCESS;
		}
	}

	// ForceFailure - always returns FAILURE unless child is RUNNING
	export class ForceFailure extends Decorator {
		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			const status = this.child_.Tick(dt, bb, active_nodes);

			if (status === ENodeStatus.RUNNING) return ENodeStatus.RUNNING;

			return ENodeStatus.FAILURE;
		}
	}

	// FireAndForget - executes child and ignores its result
	export class FireAndForget extends Decorator {
		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			this.child_.Tick(dt, bb, active_nodes);
			return ENodeStatus.SUCCESS;
		}
	}

	// Timeout - fails child if it takes longer than specified time
	export class Timeout extends Decorator {
		private time_left_: number = 0;

		constructor(
			child: Node,
			private readonly timeout_s_: number,
			private behavior_: ETimeoutBehavior = ETimeoutBehavior.FAILURE,
		) {
			super(child);
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.time_left_ = this.timeout_s_;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			this.time_left_ -= dt;

			if (this.time_left_ <= 0) {
				this.child_.Halt();
				return this.behavior_ === ETimeoutBehavior.FAILURE
					? ENodeStatus.FAILURE
					: ENodeStatus.SUCCESS;
			}

			return this.child_.Tick(dt, bb, active_nodes);
		}
	}

	// IfThenElse - conditional execution (2-3 children)
	export class IfThenElse extends Composite {
		private current_child_: number = -1;

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_child_ = -1;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.children_.size() < 2 || this.children_.size() > 3) {
				throw "IfThenElse must have exactly 2 or 3 children";
			}

			// If we're continuing with a running child
			if (this.current_child_ > 0) {
				const status = this.children_[this.current_child_].Tick(dt, bb, active_nodes);
				if (status !== ENodeStatus.RUNNING) {
					this.current_child_ = -1;
				}
				return status;
			}

			// Evaluate condition (first child)
			const condition_status = this.children_[0].Tick(dt, bb, active_nodes);

			if (condition_status === ENodeStatus.RUNNING) {
				return ENodeStatus.RUNNING;
			}

			// Execute appropriate branch
			if (condition_status === ENodeStatus.SUCCESS) {
				// Execute THEN branch (second child)
				this.current_child_ = 1;
				return this.children_[1].Tick(dt, bb, active_nodes);
			}

			// Execute ELSE branch (third child) if it exists
			if (this.children_.size() === 3) {
				this.current_child_ = 2;
				return this.children_[2].Tick(dt, bb, active_nodes);
			}

			return ENodeStatus.FAILURE;
		}

		protected override OnHalt(): void {
			super.OnHalt();
			this.current_child_ = -1;
		}
	}

	// WhileDoElse - loop execution with condition checking
	export class WhileDoElse extends Composite {
		private current_child_: number = -1;

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_child_ = -1;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.children_.size() < 2 || this.children_.size() > 3) {
				throw "WhileDoElse must have exactly 2 or 3 children";
			}

			// If a child is running, continue with it unless condition changed
			if (this.current_child_ > 0) {
				// Re-evaluate condition first
				const condition_status = this.children_[0].Tick(dt, bb, active_nodes);

				if (condition_status === ENodeStatus.RUNNING) {
					return ENodeStatus.RUNNING;
				}

				// If condition changed, halt current child and switch
				const expected_child = condition_status === ENodeStatus.SUCCESS ? 1 : 2;
				if (this.current_child_ !== expected_child) {
					this.children_[this.current_child_].Halt();
					this.current_child_ = expected_child;
				}

				if (this.current_child_ === 2 && this.children_.size() < 3) {
					return ENodeStatus.FAILURE;
				}

				return this.children_[this.current_child_].Tick(dt, bb, active_nodes);
			}

			// Evaluate condition (first child)
			const condition_status = this.children_[0].Tick(dt, bb, active_nodes);

			if (condition_status === ENodeStatus.RUNNING) {
				return ENodeStatus.RUNNING;
			}

			// Execute appropriate branch based on condition
			if (condition_status === ENodeStatus.SUCCESS) {
				this.current_child_ = 1;
				return this.children_[1].Tick(dt, bb, active_nodes);
			}

			if (this.children_.size() === 3) {
				this.current_child_ = 2;
				return this.children_[2].Tick(dt, bb, active_nodes);
			}

			return ENodeStatus.FAILURE;
		}
	}

	// RepeatUntilSuccess - retries child until it succeeds with max attempts
	export class RetryUntilSuccess extends Decorator {
		private current_attempts_ = 0;
		constructor(
			child: Node,
			private readonly max_attempts_: number = -1,
		) {
			super(child);
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			const status = this.child_.Tick(dt, bb, active_nodes);
			if (status === ENodeStatus.SUCCESS) return status;

			if (status === ENodeStatus.FAILURE) {
				this.current_attempts_++;

				const run_out_of_attempts =
					this.max_attempts_ > 0 && this.current_attempts_ >= this.max_attempts_;

				if (run_out_of_attempts) return ENodeStatus.FAILURE;
			}

			return ENodeStatus.RUNNING;
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_attempts_ = 0;
			return ENodeStatus.RUNNING;
		}
	}

	// RetryUntilFailure - retries child until it fails with max attempts
	export class RetryUntilFailure extends Decorator {
		private current_attempts_ = 0;
		constructor(
			child: Node,
			private readonly max_attempts_: number = -1,
		) {
			super(child);
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			const status = this.child_.Tick(dt, bb, active_nodes);

			if (status === ENodeStatus.FAILURE) return ENodeStatus.FAILURE;

			if (status === ENodeStatus.SUCCESS) {
				this.current_attempts_++;
				if (this.max_attempts_ > 0 && this.current_attempts_ >= this.max_attempts_) {
					return ENodeStatus.SUCCESS;
				}
			}

			return ENodeStatus.RUNNING;
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			return ENodeStatus.RUNNING;
		}
	}

	// Action node - performs an action
	export class Action extends Node {
		constructor(private readonly action_: (bb: Blackboard, dt: number) => ENodeStatus) {
			super();
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			return this.action_(bb, dt);
		}
	}

	// Condition node - checks a condition
	export class Condition extends Node {
		constructor(
			private readonly condition_: (bb: Blackboard, dt: number) => Promise<boolean> | boolean,
		) {
			super();
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			return this.condition_(bb, dt) ? ENodeStatus.SUCCESS : ENodeStatus.FAILURE;
		}
	}

	// Switch - selects a child based on a blackboard value
	export class Switch<T> extends Node {
		private cases_: Map<T, Node> = new Map();
		private default_node_?: Node;
		private active_node_?: Node;

		constructor(private key_name_: string) {
			super();
		}

		// Add a case with value and corresponding node
		public Case(value: T, node: Node): this {
			this.cases_.set(value, node);
			return this;
		}

		// Set a default node to execute if no case matches
		public Default(node: Node): this {
			this.default_node_ = node;
			return this;
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			const value = bb.GetWild<T>(this.key_name_);

			if (value !== undefined && this.cases_.has(value)) {
				this.active_node_ = this.cases_.get(value)!;
			} else if (this.default_node_ !== undefined) {
				this.active_node_ = this.default_node_;
			} else {
				return ENodeStatus.FAILURE;
			}

			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.active_node_ !== undefined) {
				return this.active_node_.Tick(dt, bb, active_nodes);
			}
			return ENodeStatus.FAILURE;
		}

		protected override OnHalt(): void {
			if (this.active_node_?.IsRunning()) {
				this.active_node_.Halt();
			}
			this.active_node_ = undefined;
		}

		protected override OnFinish(status: ENodeStatus, bb: Blackboard): void {
			this.active_node_ = undefined;
		}
	}

	// Repeat - repeats its child a specified number of times
	export class Repeat extends Decorator {
		private current_count_ = 0;

		constructor(
			child: Node,
			private repeat_count_: number,
			private condition_: ERepeatCondition = ERepeatCondition.ALWAYS,
		) {
			super(child);
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.current_count_ = 0;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (this.current_count_ >= this.repeat_count_) {
				return ENodeStatus.SUCCESS;
			}

			const status = this.child_.Tick(dt, bb, active_nodes);

			if (status === ENodeStatus.RUNNING) {
				return ENodeStatus.RUNNING;
			}

			if (this.condition_ === ERepeatCondition.SUCCESS && status !== ENodeStatus.SUCCESS) {
				return ENodeStatus.SUCCESS;
			}

			if (this.condition_ === ERepeatCondition.FAILURE && status !== ENodeStatus.FAILURE) {
				return ENodeStatus.SUCCESS;
			}

			this.current_count_++;

			if (this.current_count_ >= this.repeat_count_) {
				return ENodeStatus.SUCCESS;
			}

			return ENodeStatus.RUNNING;
		}

		protected override OnHalt(): void {
			super.OnHalt();
			this.current_count_ = 0;
		}

		protected override OnFinish(status: ENodeStatus, bb: Blackboard): void {
			this.current_count_ = 0;
		}
	}

	// Wait - waits for a specified duration
	export class Wait extends Node {
		private time_left_ = 0;

		constructor(private duration_s_: number) {
			super();
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			this.time_left_ = this.duration_s_;
			return ENodeStatus.RUNNING;
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			this.time_left_ -= dt;

			if (this.time_left_ <= 0) {
				return ENodeStatus.SUCCESS;
			}

			return ENodeStatus.RUNNING;
		}
	}

	// Cooldown - enforces a cooldown period after child execution
	export class Cooldown extends Decorator {
		private time_left_ = 0;

		constructor(
			child: Node,
			private cooldown_s_: number,
			private reset_on_halt_: boolean = false,
		) {
			super(child);
		}

		protected OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			this.time_left_ -= dt;

			if (this.time_left_ > 0) return ENodeStatus.FAILURE;
			const status = this.child_.Tick(dt, bb, active_nodes);
			return status;
		}

		protected override OnHalt(): void {
			super.OnHalt();
			if (!this.reset_on_halt_) return;
			this.time_left_ = this.cooldown_s_;
		}

		protected override OnFinish(status: ENodeStatus, bb: Blackboard): void {
			this.time_left_ = this.cooldown_s_;
		}
	}

	// Timer - checks if a timer has expired
	export class Timer<T extends Record<string, unknown> = { [key: string]: unknown }> extends Node {
		constructor(private readonly key_name_: keyof T) {
			super();
		}

		protected override OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			if (!bb.HasWild(this.key_name_ as string)) return ENodeStatus.FAILURE;
			const time_left = bb.UpdateWild<number>(this.key_name_ as string, (v) => v! - dt);
			return time_left <= 0 ? ENodeStatus.SUCCESS : ENodeStatus.FAILURE;
		}
	}

	// SubTree - references another behavior tree
	export class SubTree extends Node {
		constructor(private readonly subtree_: BehaviorTree) {
			super();
		}

		protected OnTick(dt: number): ENodeStatus {
			return this.subtree_.Tick(dt);
		}

		protected override OnHalt(): void {
			this.subtree_.Halt();
		}
	}

	export class FSMConnector extends Node {
		constructor(private readonly fsm_: FSM.FSM) {
			super();
		}
		protected override OnStart(): ENodeStatus {
			this.fsm_.Start();
			return ENodeStatus.RUNNING;
		}
		protected override OnTick(dt: number): ENodeStatus {
			this.fsm_.Update(dt);
			return ENodeStatus.RUNNING;
		}
		protected override OnHalt(): void {
			this.fsm_.Stop();
		}
	}

	export class GoapConnector extends Node {
		constructor(private readonly goap_: Goap.Agent) {
			super();
		}

		protected override OnStart(bb: Blackboard): ENodeStatus {
			return ENodeStatus.RUNNING;
		}

		protected override OnTick(dt: number, bb: Blackboard, active_nodes: Set<Node>): ENodeStatus {
			this.goap_.Update(dt);
			return ENodeStatus.RUNNING;
		}

		protected override OnHalt(): void {
			this.goap_.Reset();
		}
	}

	// Main BehaviorTree class with active node tracking
	export class BehaviorTree {
		private active_nodes_: Set<Node> = new Set();

		constructor(
			private root_: Node,
			private blackboard_: Blackboard,
		) {}

		public Tick(dt: number): ENodeStatus {
			const new_active_nodes = new Set<Node>();
			const status = this.root_.Tick(dt, this.blackboard_, new_active_nodes);

			// Halt nodes that were active but are no longer traversed
			for (const node of this.active_nodes_) {
				if (!new_active_nodes.has(node)) {
					node.Halt();
				}
			}

			this.active_nodes_ = new_active_nodes;
			return status;
		}

		public Halt(): void {
			this.root_.Halt();
			this.active_nodes_.clear();
		}

		public GetBlackboard(): Blackboard {
			return this.blackboard_;
		}

		public GetRoot(): Node {
			return this.root_;
		}

		public GetActiveNodes(): Set<Node> {
			return table.clone(this.active_nodes_);
		}
	}
}
