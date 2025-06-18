//native
//optimize 2
import { BTree } from "./BehaviorTree";
import { Blackboard } from "./Blackboard";
import type { Goap } from "./Goap";

interface ITransition {
	To: string;
	Priority: number;
	Condition?: (bb: Blackboard) => boolean;
}

export namespace FSM {
	export class FSM implements IFSMState {
		private states_: Map<string, IFSMState> = new Map();
		private transitions_: Map<string, ITransition[]> = new Map();
		private any_transitions_: ITransition[] = [];
		private current_state_: string;

		private binding_on_enter_?: (bb: Blackboard) => void;
		private binding_on_exit_?: (bb: Blackboard) => void;
		private binding_update_?: (dt_s: number, bb: Blackboard) => void;

		constructor(
			private readonly default_state_: string,
			private readonly blackboard_: Blackboard = new Blackboard({}),
		) {
			this.current_state_ = default_state_;
		}

		OnEnter(): void {
			this.current_state_ = this.default_state_;
			this.states_.get(this.current_state_)?.OnEnter(this.blackboard_);
			this.binding_on_enter_?.(this.blackboard_);
		}
		OnExit(): void {
			this.states_.get(this.current_state_)?.OnExit(this.blackboard_);
			this.binding_on_exit_?.(this.blackboard_);
		}

		public RegisterState(name: string, state: IFSMState): void {
			this.states_.set(name, state);
		}

		Start(): void {
			this.OnEnter();
		}

		Stop(): void {
			this.OnExit();
		}

		public Update(dt: number): void {
			let state_to_set: string | undefined = undefined;
			const transitions = this.transitions_.get(this.current_state_) ?? [];
			for (const transition of transitions) {
				if (!transition.Condition?.(this.blackboard_)) continue;
				state_to_set = transition.To;
				break;
			}

			if (state_to_set === undefined) {
				for (const transition of this.any_transitions_) {
					if (!transition.Condition?.(this.blackboard_)) continue;
					state_to_set = transition.To;
					break;
				}
			}

			if (state_to_set !== undefined) {
				this.states_.get(this.current_state_)?.OnExit(this.blackboard_);
				this.current_state_ = state_to_set;
				this.states_.get(this.current_state_)?.OnEnter(this.blackboard_);
			}

			this.states_.get(this.current_state_)?.Update(dt, this.blackboard_);
			this.binding_update_?.(dt, this.blackboard_);
		}

		AddTransition(
			from: string,
			to: string,
			priority: number,
			condition?: (bb: Blackboard) => boolean,
		): void {
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};
			if (!this.transitions_.has(from)) {
				this.transitions_.set(from, []);
			}
			this.transitions_.get(from)?.push(transition);
			this.transitions_.get(from)?.sort((a, b) => a.Priority < b.Priority);
		}

		AddAnyTransition(to: string, priority: number, condition?: (bb: Blackboard) => boolean): void {
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};
			this.any_transitions_.push(transition);
			this.any_transitions_.sort((a, b) => a.Priority < b.Priority);
		}

		BindOnEnter(callback: (bb: Blackboard) => void) {
			this.binding_on_enter_ = callback;
		}
		BindOnExit(callback: (bb: Blackboard) => void) {
			this.binding_on_exit_ = callback;
		}
		BindUpdate(callback: (dt: number, bb: Blackboard) => void) {
			this.binding_update_ = callback;
		}
	}

	export class BehaviorTreeConnector implements IFSMState {
		constructor(private readonly tree_: BTree.BehaviorTree) {}
		OnEnter(bb: Blackboard): void {}
		Update(dt_s: number): void {
			this.tree_.Tick(dt_s);
		}
		OnExit(): void {
			this.tree_.Halt();
		}
	}

	export class GOAPConnector implements IFSMState {
		constructor(private readonly goap_: Goap.Agent) {}
		OnEnter(bb: Blackboard): void {}
		Update(dt_s: number): void {
			this.goap_.Update(dt_s);
		}
		OnExit(): void {
			this.goap_.Reset();
		}
	}

	export interface IFSMState {
		OnEnter(bb: Blackboard): void;
		Update(dt_s: number, bb: Blackboard): void;
		OnExit(bb: Blackboard): void;
	}
}
