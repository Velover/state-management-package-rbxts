import { proxy, snapshot, useSnapshot } from "valtio";
import {
  BehaviorTreeEdge,
  BehaviorTreeNode,
  BehaviorTreeNodeData,
  CustomNodeDefinition,
} from "../Resources/FlowModels.js";
import {
  ALL_AVAILABLE_NODES,
  NodeCategory,
  NodeDefinition,
  isNodeAbstract,
  VisualType,
  DEFAULT_NODES,
  getValidationRules,
  ParameterType,
} from "../Resources/NodeTypes.js";
import {
  TreeState,
  TreeStateCommand,
  undoRedoController,
} from "./UndoRedoController.js";

export class BehaviorTreeController {
  private readonly undo_redo_ = undoRedoController;

  readonly state = proxy({
    nodes: [] as BehaviorTreeNode[],
    edges: [] as BehaviorTreeEdge[],
    customNodes: [] as CustomNodeDefinition[],
    nextNodeId: 1,
    editingCustomNode: null as CustomNodeDefinition | null,
  });

  // --- State capture/restore for undo/redo ---

  public CaptureState(): TreeState {
    const s = snapshot(this.state);
    return {
      nodes: structuredClone(s.nodes) as BehaviorTreeNode[],
      edges: structuredClone(s.edges) as BehaviorTreeEdge[],
      customNodes: structuredClone(s.customNodes) as CustomNodeDefinition[],
      nextNodeId: s.nextNodeId,
    };
  }

  public ApplyState(state: TreeState) {
    this.state.nodes = state.nodes;
    this.state.edges = state.edges;
    this.state.customNodes = state.customNodes;
    this.state.nextNodeId = state.nextNodeId;
  }

  public ExecuteCommand(description: string, action: () => void) {
    const before = this.CaptureState();
    action();
    const after = this.CaptureState();
    const cmd = new TreeStateCommand(
      (s) => this.ApplyState(s),
      before,
      after,
      description,
    );
    this.undo_redo_.PushExecuted(cmd);
  }

  public PushStateCommand(before: TreeState, description: string) {
    const after = this.CaptureState();
    const cmd = new TreeStateCommand(
      (s) => this.ApplyState(s),
      before,
      after,
      description,
    );
    this.undo_redo_.PushExecuted(cmd);
  }

  public useNodes() {
    return useSnapshot(this.state).nodes as BehaviorTreeNode[];
  }

  public GetNodesAtom() {
    return this.state.nodes;
  }

  public useEdges() {
    return useSnapshot(this.state).edges as BehaviorTreeEdge[];
  }
  public GetEdgesAtom() {
    return this.state.edges;
  }

  public useCustomNodes() {
    return useSnapshot(this.state).customNodes as CustomNodeDefinition[];
  }
  public GetCustomNodesAtom() {
    return this.state.customNodes;
  }

  public useAvailableNodes(): NodeDefinition[] {
    const snap = useSnapshot(this.state);
    const concreteNodes = ALL_AVAILABLE_NODES.filter(
      (node) => !node.isAbstract,
    );

    return [
      ...concreteNodes,
      ...(snap.customNodes as CustomNodeDefinition[]).map((node) => {
        const baseNode = ALL_AVAILABLE_NODES.find(
          (n) => n.type === node.inheritsFrom,
        );
        return {
          id: node.id,
          type: node.name,
          category: baseNode?.category || NodeCategory.Node,
          label: node.name,
          description: node.description,
          inheritsFrom: node.inheritsFrom,
          isCustom: true,
        } as NodeDefinition;
      }),
    ];
  }

  public UpdateNodeData(
    nodeId: string,
    newData: Partial<BehaviorTreeNodeData>,
  ) {
    this.ExecuteCommand("Update Node Data", () => {
      this.state.nodes = this.state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...newData } }
          : node,
      );
    });
  }

  public GetAllNodeNames(): string[] {
    const customNodes = this.state.customNodes;
    const defaultNodeNames = DEFAULT_NODES.map((n) => n.type);
    const customNodeNames = customNodes.map((n) => n.name);

    return [...defaultNodeNames, ...customNodeNames];
  }

  public SetNodes(nodes: BehaviorTreeNode[]) {
    this.state.nodes = nodes;
  }

  public SetEdges(edges: BehaviorTreeEdge[]) {
    this.state.edges = edges;
  }

  public AddNode(
    nodeDefinition: NodeDefinition,
    position: { x: number; y: number },
  ) {
    // Check if trying to place abstract node
    if (isNodeAbstract(nodeDefinition.type, nodeDefinition.isCustom)) {
      console.warn("Cannot place abstract node:", nodeDefinition.label);
      return;
    }

    this.ExecuteCommand("Add Node: " + nodeDefinition.label, () => {
      this.addNodeInternal(nodeDefinition, position);
    });
  }

  private addNodeInternal(
    nodeDefinition: NodeDefinition,
    position: { x: number; y: number },
  ) {
    const id = this.state.nextNodeId.toString();
    this.state.nextNodeId++;

    // Initialize parameters with default values for non-visual nodes
    const parameters: Record<string, string | number> = {};
    if (nodeDefinition.parameters && !nodeDefinition.isVisual) {
      nodeDefinition.parameters.forEach((param) => {
        if (param.defaultValue !== undefined) {
          parameters[param.name] = param.defaultValue;
        }
      });
    }

    // Determine node type for React Flow
    let reactFlowNodeType = "behaviorTreeNode";
    if (nodeDefinition.type === "Switch") {
      reactFlowNodeType = "switchNode";
    } else if (nodeDefinition.isVisual) {
      if (nodeDefinition.type === VisualType.Note) {
        reactFlowNodeType = "noteNode";
      } else if (nodeDefinition.type === VisualType.Group) {
        reactFlowNodeType = "groupNode";
      }
    }

    const newNode: BehaviorTreeNode = {
      id,
      type: reactFlowNodeType,
      position,
      data: {
        label: nodeDefinition.label,
        category: nodeDefinition.category,
        nodeType: nodeDefinition.type,
        description: nodeDefinition.description,
        isCustom: nodeDefinition.isCustom || false,
        customName: nodeDefinition.isCustom ? nodeDefinition.type : undefined,
        inheritsFrom: nodeDefinition.inheritsFrom,
        switchCases: nodeDefinition.type === "Switch" ? [] : undefined,
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
        // Visual node properties
        isVisual: nodeDefinition.isVisual || false,
        noteText:
          nodeDefinition.type === VisualType.Note
            ? "Click to edit note..."
            : undefined,
        noteSize: nodeDefinition.type === VisualType.Note ? 16 : undefined,
        groupColor:
          nodeDefinition.type === VisualType.Group ? "#3b82f6" : undefined,
      },
    };

    // Set initial size and z-index for different node types
    if (nodeDefinition.type === VisualType.Group) {
      newNode.style = {
        width: 200,
        height: 150,
        zIndex: -1, // Always render below other nodes
      };
    } else if (nodeDefinition.type === VisualType.Note) {
      newNode.style = {
        width: 200,
        height: 100,
        zIndex: 100, // Always render above other nodes
      };
    }

    this.state.nodes = [...this.state.nodes, newNode];
  }

  public RemoveNode(node_id: string) {
    this.ExecuteCommand("Remove Node", () => {
      this.state.nodes = this.state.nodes.filter((node) => node.id !== node_id);
      this.state.edges = this.state.edges.filter(
        (edge) => edge.source !== node_id && edge.target !== node_id,
      );
    });
  }

  public AddCustomNode(custom_node: CustomNodeDefinition) {
    this.ExecuteCommand("Add Custom Node: " + custom_node.name, () => {
      this.state.customNodes = [...this.state.customNodes, custom_node];
    });
  }

  public RemoveCustomNode(node_id: string) {
    this.ExecuteCommand("Remove Custom Node", () => {
      this.removeCustomNodeInternal(node_id);
    });
  }

  private removeCustomNodeInternal(node_id: string) {
    // Check if any nodes in the tree are using this custom node type
    const custom_node = this.state.customNodes.find(
      (node) => node.id === node_id,
    );
    if (custom_node !== undefined) {
      // Find nodes using this custom type - match by customName instead of nodeType
      const nodes_using_custom_type = this.state.nodes.filter(
        (node) =>
          node.data.isCustom && node.data.customName === custom_node.name,
      );

      if (nodes_using_custom_type.length > 0) {
        // Remove all nodes using this custom type from the tree
        const node_ids_to_remove = nodes_using_custom_type.map(
          (node) => node.id,
        );
        this.state.nodes = this.state.nodes.filter(
          (node) => !node_ids_to_remove.includes(node.id),
        );

        // Remove edges connected to these nodes
        this.state.edges = this.state.edges.filter(
          (edge) =>
            !node_ids_to_remove.includes(edge.source) &&
            !node_ids_to_remove.includes(edge.target),
        );

        console.log(
          `Removed ${nodes_using_custom_type.length} instances of custom node "${custom_node.name}" from canvas`,
        );
      }
    }

    // Remove the custom node definition
    this.state.customNodes = this.state.customNodes.filter(
      (node) => node.id !== node_id,
    );
  }

  public SetCustomNodes(custom_nodes: CustomNodeDefinition[]) {
    this.state.customNodes = custom_nodes;
  }

  public SetNextNodeId(next_node_id: number) {
    this.state.nextNodeId = next_node_id;
  }

  public useEditingCustomNode() {
    return useSnapshot(this.state)
      .editingCustomNode as CustomNodeDefinition | null;
  }

  public StartEditingCustomNode(nodeId: string) {
    const customNode = this.state.customNodes.find(
      (node) => node.id === nodeId,
    );
    if (customNode) {
      this.state.editingCustomNode = customNode;
    }
  }

  public StopEditingCustomNode() {
    this.state.editingCustomNode = null;
  }

  public UpdateCustomNode(nodeId: string, updatedNode: CustomNodeDefinition) {
    const existingNode = this.state.customNodes.find(
      (node) => node.id === nodeId,
    );

    if (!existingNode) {
      console.error("Custom node not found for update");
      return;
    }

    this.ExecuteCommand("Update Custom Node: " + updatedNode.name, () => {
      // Check if inheritance changed
      const inheritanceChanged =
        existingNode.inheritsFrom !== updatedNode.inheritsFrom;

      // Update custom node definition
      this.state.customNodes = this.state.customNodes.map((node) =>
        node.id === nodeId ? updatedNode : node,
      );

      // Update all instances of this custom node in the canvas
      this.updateCustomNodeInstances(
        existingNode.name,
        updatedNode,
        inheritanceChanged,
      );

      this.state.editingCustomNode = null;
    });
  }

  private updateCustomNodeInstances(
    oldNodeName: string,
    updatedNode: CustomNodeDefinition,
    inheritanceChanged: boolean,
  ) {
    const currentNodes = this.state.nodes;
    const updatedNodes: BehaviorTreeNode[] = [];
    const nodesToRemoveConnections: string[] = [];

    currentNodes.forEach((node) => {
      if (node.data.isCustom && node.data.customName === oldNodeName) {
        const updatedNodeData = { ...node.data };

        // Update basic properties
        updatedNodeData.customName = updatedNode.name;
        updatedNodeData.label = updatedNode.name;
        updatedNodeData.inheritsFrom = updatedNode.inheritsFrom;
        updatedNodeData.description = updatedNode.description;

        // Handle parameter changes
        const oldParameters = updatedNodeData.parameters || {};
        const newParameters: Record<string, string | number> = {};

        // Process new parameters and convert values if needed
        updatedNode.parameters?.forEach((newParam) => {
          const oldValue = oldParameters[newParam.name];

          if (oldValue !== undefined) {
            // Try to convert existing value to new type
            if (newParam.type === ParameterType.Number) {
              const numValue = Number(oldValue);
              newParameters[newParam.name] = isNaN(numValue)
                ? (newParam.defaultValue ?? 0)
                : numValue;
            } else if (newParam.type === ParameterType.String) {
              newParameters[newParam.name] = String(oldValue);
            } else if (newParam.type === ParameterType.Enum) {
              // Check if old value is valid enum value
              const isValidEnum = newParam.enumValues?.includes(
                String(oldValue),
              );
              newParameters[newParam.name] = isValidEnum
                ? String(oldValue)
                : (newParam.defaultValue ?? "");
            }
          } else {
            // Use default value for new parameters
            if (newParam.defaultValue !== undefined) {
              newParameters[newParam.name] = newParam.defaultValue;
            }
          }
        });

        updatedNodeData.parameters =
          Object.keys(newParameters).length > 0 ? newParameters : undefined;

        updatedNodes.push({
          ...node,
          data: updatedNodeData,
        });

        // If inheritance changed, mark for connection validation
        if (inheritanceChanged) {
          nodesToRemoveConnections.push(node.id);
        }
      } else {
        updatedNodes.push(node);
      }
    });

    // Update nodes
    this.state.nodes = updatedNodes;

    // Remove invalid connections if inheritance changed
    if (inheritanceChanged && nodesToRemoveConnections.length > 0) {
      this.removeInvalidConnections(
        nodesToRemoveConnections,
        updatedNode.inheritsFrom,
      );
    }

    console.log(
      `Updated ${nodesToRemoveConnections.length} instances of custom node "${updatedNode.name}"`,
    );
  }

  private removeInvalidConnections(nodeIds: string[], newInheritance: string) {
    const currentEdges = this.state.edges;
    const newValidationRules = getValidationRules("", newInheritance);

    const validEdges = currentEdges.filter((edge) => {
      // Check if edge involves any of the updated nodes
      const sourceUpdated = nodeIds.includes(edge.source);
      const targetUpdated = nodeIds.includes(edge.target);

      if (!sourceUpdated && !targetUpdated) {
        return true; // Keep edges not involving updated nodes
      }

      // For edges involving updated nodes, validate against new rules
      if (sourceUpdated) {
        // Check if the updated node can have children
        const canHaveChildren =
          newValidationRules.maxChildren === undefined ||
          newValidationRules.maxChildren > 0;
        if (!canHaveChildren) {
          console.log(
            `Removing outgoing connection from ${edge.source} - new inheritance doesn't allow children`,
          );
          return false;
        }
      }

      if (targetUpdated) {
        // Check if the updated node can be a child
        const canBeChild = newValidationRules.maxChildren !== 0;
        if (!canBeChild) {
          console.log(
            `Removing incoming connection to ${edge.target} - new inheritance doesn't allow being a child`,
          );
          return false;
        }
      }

      return true;
    });

    if (validEdges.length !== currentEdges.length) {
      this.state.edges = validEdges;
      console.log(
        `Removed ${
          currentEdges.length - validEdges.length
        } invalid connections due to inheritance change`,
      );
    }
  }

  // Methods for auto-save to get current state without reactivity
  public GetCurrentNodesAtom(): BehaviorTreeNode[] {
    return this.state.nodes;
  }

  public GetCurrentEdgesAtom(): BehaviorTreeEdge[] {
    return this.state.edges;
  }

  public GetCurrentCustomNodesAtom(): CustomNodeDefinition[] {
    return this.state.customNodes;
  }
  public GetCurrentNextNodeIdAtom(): number {
    return this.state.nextNodeId;
  }
}

export const behaviorTreeController = new BehaviorTreeController();
