//!native
//!optimize 2

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
		private event_transitions_: Map<string, Map<string, ITransition[]>> = new Map();

		private any_transitions_: ITransition[] = [];
		private any_event_transitions_: Map<string, ITransition[]> = new Map();
		private current_state_: string;

		private scheduled_state_?: string;
		private is_update_ = false;

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
			assert(
				this.states_.has(this.default_state_),
				`FSM: default state "${this.default_state_}" was never registered.`,
			);
			this.OnEnter();
		}

		Stop(): void {
			this.OnExit();
		}

		Update(dt: number): void {
			this.is_update_ = true;
			let state_to_set: string | undefined = undefined;
			const transitions = this.transitions_.get(this.current_state_) ?? [];
			for (const transition of transitions) {
				if (transition.To === this.current_state_) continue;
				if (transition.Condition?.(this.blackboard_) === false) continue;
				state_to_set = transition.To;
				break;
			}

			if (state_to_set === undefined) {
				for (const transition of this.any_transitions_) {
					if (transition.To === this.current_state_) continue;
					if (transition.Condition?.(this.blackboard_) === false) continue;
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
			if (this.scheduled_state_ !== undefined) {
				this.states_.get(this.current_state_)?.OnExit(this.blackboard_);
				this.current_state_ = this.scheduled_state_;
				this.states_.get(this.current_state_)?.OnEnter(this.blackboard_);
				this.scheduled_state_ = undefined;
			}
			this.binding_update_?.(dt, this.blackboard_);
			this.is_update_ = false;
		}

		AddTransition(
			from: string,
			to: string,
			priority: number,
			condition?: (bb: Blackboard) => boolean,
		): void {
			assert(from !== to, "FSM: Cannot add a transition from a state to itself.");
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};
			if (!this.transitions_.has(from)) {
				this.transitions_.set(from, []);
			}
			this.transitions_.get(from)!.push(transition);
			this.transitions_.get(from)!.sort((a, b) => a.Priority > b.Priority);
		}

		AddAnyTransition(to: string, priority: number, condition?: (bb: Blackboard) => boolean): void {
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};
			this.any_transitions_.push(transition);
			this.any_transitions_.sort((a, b) => a.Priority > b.Priority);
		}

		AddEventTransition(
			from: string,
			to: string,
			event_name: string,
			priority: number,
			condition?: (bb: Blackboard) => boolean,
		): void {
			assert(from !== to, "FSM: Cannot add an event transition from a state to itself.");
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};

			let state_transitions = this.event_transitions_.get(from);

			if (state_transitions === undefined) {
				state_transitions = new Map<string, ITransition[]>();
				this.event_transitions_.set(from, state_transitions);
			}

			let transitions = state_transitions.get(event_name);
			if (transitions === undefined) {
				transitions = [];
				state_transitions.set(event_name, transitions);
			}

			transitions.push(transition);
			transitions.sort((a, b) => a.Priority > b.Priority);
		}

		AddAnyEventTransition(
			to: string,
			event_name: string,
			priority: number,
			condition?: (bb: Blackboard) => boolean,
		): void {
			const transition: ITransition = {
				To: to,
				Priority: priority,
				Condition: condition,
			};

			let transitions = this.any_event_transitions_.get(event_name);

			if (transitions === undefined) {
				transitions = [];
				this.any_event_transitions_.set(event_name, transitions);
			}
			transitions.push(transition);
			transitions.sort((a, b) => a.Priority > b.Priority);
		}

		HandleEvent(event_name: string): void {
			let best_transition: ITransition | undefined = undefined;
			const state_transitions = this.event_transitions_.get(this.current_state_);
			const any_transitions = this.any_event_transitions_.get(event_name);
			if (any_transitions === undefined && state_transitions === undefined) return;

			if (state_transitions !== undefined) {
				const transitions = state_transitions.get(event_name);
				if (transitions !== undefined) {
					for (const transition of transitions) {
						if (transition.To === this.current_state_) continue;
						if (transition.Condition?.(this.blackboard_) === false) continue;
						//in theory, the transitions should already be sorted by priority, so the first valid one is the best one
						best_transition = transition;
						break;
					}
				}
			}

			if (any_transitions !== undefined && best_transition === undefined) {
				for (const transition of any_transitions) {
					if (transition.To === this.current_state_) continue;
					if (transition.Condition?.(this.blackboard_) === false) continue;
					best_transition = transition;
					break;
				}
			}

			if (best_transition === undefined) return;
			this.ForceSetState(best_transition.To);
		}

		ForceSetState(state: string, skip_if_same: boolean = true): void {
			assert(
				this.states_.has(state),
				`FSM: Cannot force set state to ${state} because it does not exist.`,
			);
			if (skip_if_same && state === this.current_state_) return;
			if (this.is_update_) {
				this.scheduled_state_ = state;
				return;
			}
			this.states_.get(this.current_state_)?.OnExit(this.blackboard_);
			this.current_state_ = state;
			this.states_.get(this.current_state_)?.OnEnter(this.blackboard_);
		}

		GetCurrentState(): string {
			return this.current_state_;
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
