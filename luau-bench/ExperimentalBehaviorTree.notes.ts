// export namespace BT {
// 	type NodeResult = number;

// 	interface BTree {
// 		AssertGetNodeId(node: Callback): number;
// 		Register(node: Callback): number;
// 		// thinking of optimization, whether blackboard actually should exist per entity instead of just global SoA or per entity
// 		CreateEntity(): number;
// 		ReleaseEntity(id: number): void;
// 		OnStart: Map<number, () => NodeResult>;
// 		OnExit: Map<number, (status: ENodeStatus, bb: Blackboard) => void>;
// 		OnTick: Map<
// 			number,
// 			(
// 				dt: number,
// 				// bb: Blackboard,
// 				// running_nodes: Set<number>, //from what i've tried, set is the fastest, but has slightly bigger memory footprint
// 				// new_active_nodes: Set<number>,
// 				// old_active_nodes: Set<number>,
// 			) => NodeResult
// 		>;
// 		/** Default implementation - can be overridden
// 		 * Called when the node wasnt called in previous iteration but is called now
// 		 */
// 		OnBecameActivated: Map<number, () => void>; //have to check how to do tracking of it only for the nodes that actually have it
// 		/** Default implementation - can be overridden
// 		 * Called when the node was called in previous iteration but is not called now
// 		 */
// 		OnBecameInactive: Map<number, () => void>;
// 		//...
// 	}

// 	// a couple more stuff that tracking of stuff has to happen per node, still thinking about how to make nodes do the action if "Running"
// 	const bt: BTree;

// 	//so a hypotesis, since "Running" state propagates upwards, it can as well be used to avoid pushing agents to not relevant children or actually stop the running state
// 	function MemorySeqeuence(reset_on_abort: boolean, nodes: Array<number>) {
// 		return bt.Register((id: number, bt: BTree) => {
// 			//local state here
// 			return {
// 				//all of those fields are optional, but what happens in the end that they are being written to bt to the index of the node
// 				OnStart: () => {},
// 				OnTick: () => {},
// 				OnEnd: (aborted?: boolean) => {},
// 				OnEntityAdded: (id: number) => {}, //for local tracking and cleanup
// 				OnEntityRemoved: (id: number) => {},
// 			};
// 		});
// 	}
// }

// dont implement yet, lets discuss first.
// i wanna upgrade behavior tree to not be tables, so like to make that you have to register global nodes, and it's gonna batch
