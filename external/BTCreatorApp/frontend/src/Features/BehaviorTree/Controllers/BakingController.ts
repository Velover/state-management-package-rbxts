import { proxy, useSnapshot } from "valtio";
import {
  GetBakes,
  LoadBehaviorTreeBake,
  LoadBehaviorTreeBakeWithPath,
  SaveBehaviorTreeBakeWithPath,
  ShowBakeSaveFileDialog,
  ShowOpenBakeFileDialog,
} from "../../../../wailsjs/go/main/App.js";
import { ClipboardSetText } from "../../../../wailsjs/runtime/runtime.js";
import {
  BehaviorTreeEdge,
  BehaviorTreeNode,
  BehaviorTreeNodeData,
  CustomNodeDefinition,
} from "../Resources/FlowModels.js";
import {
  BakeNodeStructure,
  BakeResult,
} from "../Resources/ValidationModels.js";
import {
  DEFAULT_NODES,
  NodeCategory,
  NodeDefinition,
  NodeParameter,
  ParameterType,
  VisualType,
} from "../Resources/NodeTypes.js";
import { behaviorTreeController } from "./BehaviorTreeController.js";
import { saveController } from "./SaveController.js";
import { validationController } from "./ValidationController.js";

// Node name remap table from v1 → v2
const V1_TO_V2_NODE_NAMES: Record<string, string> = {
  RetryUntilSuccess: "KeepRunningUntilSuccess",
  RetryUntilFailure: "KeepRunningUntilFailure",
};

interface BakeFileData {
  name: string;
  baked_at: string;
  version: string;
  structure: Record<string, BakeNodeStructure>;
}

export class BakingController {
  private readonly behavior_tree_controller_ = behaviorTreeController;
  private readonly save_controller_ = saveController;
  private readonly validation_controller_ = validationController;

  readonly state = proxy({
    isBaking: false,
    isBakingToClipboard: false,
    lastBakeResult: null as BakeResult | null,
  });

  public useIsBaking() {
    return useSnapshot(this.state).isBaking;
  }

  public useIsBakingToClipboard() {
    return useSnapshot(this.state).isBakingToClipboard;
  }

  public useLastBakeResult() {
    return useSnapshot(this.state).lastBakeResult as BakeResult | null;
  }

  public async BakeToClipboard(): Promise<BakeResult> {
    try {
      this.state.isBakingToClipboard = true;

      const validation = this.validation_controller_.ValidateTree();
      if (!validation.isValid) {
        const result = {
          success: false,
          structure: {},
          errors: validation.errors.map((e) => e.message),
        };
        this.state.lastBakeResult = result;
        return result;
      }

      const structure = this.generateBakeStructure();
      const currentFileName =
        this.save_controller_.GetCurrentFileName() ?? "Untitled";

      const bakeData = {
        name: currentFileName,
        structure,
        baked_at: new Date().toISOString(),
        version: "2.0.0",
      };

      const json = JSON.stringify(bakeData, null, 2);

      try {
        await ClipboardSetText(json);
        console.log(`Bake "${currentFileName}" copied to clipboard`);
      } catch (error) {
        const result = {
          success: false,
          structure: {},
          errors: [
            `Failed to copy to clipboard: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
        };
        this.state.lastBakeResult = result;
        return result;
      }

      const result = { success: true, structure, errors: [] };
      this.state.lastBakeResult = result;
      return result;
    } catch (error) {
      const result = {
        success: false,
        structure: {},
        errors: [
          `Baking failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
      };
      this.state.lastBakeResult = result;
      return result;
    } finally {
      this.state.isBakingToClipboard = false;
    }
  }

  public async BakeTree(): Promise<BakeResult> {
    try {
      this.state.isBaking = true;

      const currentFileName = this.save_controller_.GetCurrentFileName();
      if (!currentFileName) {
        const result = {
          success: false,
          structure: {},
          errors: ["No file selected. Please save the behavior tree first."],
        };
        this.state.lastBakeResult = result;
        return result;
      }

      const validation = this.validation_controller_.ValidateTree();
      if (!validation.isValid) {
        const result = {
          success: false,
          structure: {},
          errors: validation.errors.map((e) => e.message),
        };
        this.state.lastBakeResult = result;
        return result;
      }

      // Show save dialog for bake file
      const selectedPath = await ShowBakeSaveFileDialog(currentFileName);
      if (!selectedPath) {
        const result = {
          success: false,
          structure: {},
          errors: ["Baking cancelled by user."],
        };
        this.state.lastBakeResult = result;
        return result;
      }

      const structure = this.generateBakeStructure();

      // Save bake to selected file
      try {
        await SaveBehaviorTreeBakeWithPath(selectedPath, structure);
        const fileName = selectedPath.split(/[\\/]/).pop() || "";
        console.log(`Bake saved to: ${fileName}`);
      } catch (error) {
        console.error("Failed to save bake to file:", error);
        const result = {
          success: false,
          structure: {},
          errors: [
            `Failed to save bake: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
        };
        this.state.lastBakeResult = result;
        return result;
      }

      const result = {
        success: true,
        structure,
        errors: [],
      };

      this.state.lastBakeResult = result;

      // Print bake result to console
      console.log("=== BAKE RESULT ===");
      console.log(`Bake Name: ${currentFileName}`);
      console.log("Bake Structure:");
      console.log(JSON.stringify(structure, null, 2));
      console.log("===================");

      return result;
    } catch (error) {
      const result = {
        success: false,
        structure: {},
        errors: [
          `Baking failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        ],
      };
      this.state.lastBakeResult = result;
      return result;
    } finally {
      this.state.isBaking = false;
    }
  }

  private generateBakeStructure(): Record<string, BakeNodeStructure> {
    const nodes = this.behavior_tree_controller_.GetCurrentNodesAtom();
    const edges = this.behavior_tree_controller_.GetCurrentEdgesAtom();
    const inactiveNodes = this.validation_controller_.GetInactiveNodes();
    const structure: Record<string, BakeNodeStructure> = {};

    // Only process active nodes that are not visual nodes
    const activeNodes = nodes.filter(
      (node) => !inactiveNodes.has(node.id) && !node.data.isVisual,
    );

    // Only process active nodes
    const filteredActiveNodes = nodes.filter(
      (node) => !inactiveNodes.has(node.id),
    );

    filteredActiveNodes.forEach((node) => {
      const nodeStructure: BakeNodeStructure = {
        name: this.getNodeBakeName(node),
        children: [],
      };

      // Get all parameters for this node (including defaults from definition)
      const allParameters = this.getNodeParameters(node);

      // Add parameters if they exist
      if (allParameters && Object.keys(allParameters).length > 0) {
        nodeStructure.parameters = allParameters;
      }

      // Only consider edges from this specific node to active children
      const childEdges = edges.filter(
        (edge) => edge.source === node.id && !inactiveNodes.has(edge.target),
      );

      if (node.data.nodeType === "Switch") {
        const blackboardProperty = node.data.blackboardProperty || "";

        nodeStructure.switch_case = {
          cases: {},
          default: undefined,
          parameter_name: blackboardProperty,
        };

        const switchCases = node.data.switchCases || [];
        const defaultCase = node.data.defaultCase;

        // Sort child edges by X position (only active children)
        const sortedChildren = childEdges
          .map((edge) => {
            const childNode = activeNodes.find((n) => n.id === edge.target);
            return { edge, node: childNode };
          })
          .filter((item) => item.node)
          .sort((a, b) => a.node!.position.x - b.node!.position.x);

        // Map cases to children based on position (using node IDs directly)
        switchCases.forEach((switchCase, index) => {
          if (sortedChildren[index]) {
            nodeStructure.switch_case!.cases[switchCase.name] =
              sortedChildren[index].node!.id;
          }
        });

        // Map default case if exists (using node ID directly)
        if (defaultCase && sortedChildren[switchCases.length]) {
          nodeStructure.switch_case!.default =
            sortedChildren[switchCases.length].node!.id;
        }
      } else {
        // Regular children handling - sort by X position (using node IDs directly)
        const sortedChildren = childEdges
          .map((edge) => {
            const childNode = activeNodes.find((n) => n.id === edge.target);
            return { edge, node: childNode };
          })
          .filter((item) => item.node)
          .sort((a, b) => a.node!.position.x - b.node!.position.x);

        // Use node IDs directly - no deduplication needed
        nodeStructure.children = sortedChildren.map((item) => item.node!.id);
      }

      // Use node ID as the key in the structure
      structure[node.id] = nodeStructure;
    });

    return structure;
  }

  private getNodeParameters(
    node: BehaviorTreeNode,
  ): Record<string, string | number> | undefined {
    // Start with the node's current parameter values
    const currentParameters = node.data.parameters || {};

    // Get the node definition to find all expected parameters
    const nodeDefinition = this.getNodeDefinition(node);

    if (!nodeDefinition?.parameters || nodeDefinition.parameters.length === 0) {
      // No parameters defined for this node type
      return Object.keys(currentParameters).length > 0
        ? currentParameters
        : undefined;
    }

    // Build complete parameter set with defaults
    const allParameters: Record<string, string | number> = {};

    nodeDefinition.parameters.forEach((paramDef: NodeParameter) => {
      // Use current value if it exists, otherwise use default
      if (currentParameters[paramDef.name] !== undefined) {
        allParameters[paramDef.name] = currentParameters[paramDef.name];
      } else if (paramDef.defaultValue !== undefined) {
        allParameters[paramDef.name] = paramDef.defaultValue;
      }
      // If no current value and no default, the parameter is required but missing
      // This should be caught by validation, but we'll skip it here
    });

    return Object.keys(allParameters).length > 0 ? allParameters : undefined;
  }

  private getNodeDefinition(
    node: BehaviorTreeNode,
  ): NodeDefinition | CustomNodeDefinition | undefined {
    if (node.data.isCustom) {
      // Find custom node definition
      const customNodes =
        this.behavior_tree_controller_.GetCurrentCustomNodesAtom();
      return customNodes.find((cn) => cn.name === node.data.customName);
    } else {
      // Find in default nodes
      return DEFAULT_NODES.find(
        (n: NodeDefinition) => n.type === node.data.nodeType,
      );
    }
  }

  private getNodeBakeName(node: BehaviorTreeNode): string {
    if (node.data.isCustom && node.data.customName) {
      return node.data.customName;
    }
    return node.data.nodeType;
  }

  public async GetAvailableBakes(): Promise<string[]> {
    try {
      return await GetBakes();
    } catch (error) {
      console.error("Failed to get available bakes:", error);
      return [];
    }
  }

  public async LoadBakeFromFile(fileName: string): Promise<BakeFileData> {
    try {
      const bake_data = await LoadBehaviorTreeBake(fileName);
      if (!bake_data) {
        throw new Error(`No bake data found for file: ${fileName}`);
      }

      console.log("=== LOADED BAKE ===");
      console.log(`Bake Name: ${bake_data.name}`);
      console.log(`Baked At: ${bake_data.baked_at}`);
      console.log(`Version: ${bake_data.version}`);
      console.log("Structure:");
      console.log(JSON.stringify(bake_data.structure, null, 2));
      console.log("==================");

      return bake_data as BakeFileData;
    } catch (error) {
      console.error("Failed to load bake data:", error);
      throw error;
    }
  }

  /**
   * Imports a bake file into the editor from a full file path.
   * Entry point for drag-and-drop of .btbake files.
   */
  public async ImportBakeFromPath(filePath: string): Promise<void> {
    try {
      const bake_data = await LoadBehaviorTreeBakeWithPath(filePath);
      if (!bake_data) {
        throw new Error(`No bake data found at: ${filePath}`);
      }

      // Reset editor state for a new unsaved document
      this.save_controller_.NewFile();

      await this.importBakeData(bake_data as BakeFileData);
    } catch (error) {
      console.error("Failed to import bake from path:", error);
      throw error;
    }
  }

  /**
   * Imports a bake file by name from the bakes directory.
   */
  public async ImportBakeIntoEditor(fileName: string): Promise<void> {
    const bake_data = await this.LoadBakeFromFile(fileName);
    this.save_controller_.NewFile();
    await this.importBakeData(bake_data);
  }

  /**
   * Shows a file dialog for importing .btbake files and imports the selected file.
   */
  public async ImportBakeFromDialog(): Promise<void> {
    try {
      const canProceed = await this.save_controller_.CheckUnsavedChanges();
      if (!canProceed) return;

      const selectedPath = await ShowOpenBakeFileDialog();
      if (!selectedPath) return;

      await this.ImportBakeFromPath(selectedPath);
    } catch (error) {
      console.error("Failed to import bake from dialog:", error);
      throw error;
    }
  }

  /**
   * Internal: infers the parent type for a custom node based on its children count.
   */
  private inferCustomNodeParentType(childCount: number): string {
    if (childCount === 0) return "Node";
    if (childCount === 1) return "Decorator";
    return "Composite";
  }

  /**
   * Internal: detects custom nodes in a bake structure and creates CustomNodeDefinition entries.
   * Returns the definitions and a map from node name → definition.
   */
  private detectCustomNodes(
    structure: Record<string, BakeNodeStructure>,
  ): CustomNodeDefinition[] {
    const customDefs: CustomNodeDefinition[] = [];
    const seen = new Set<string>();
    let customId = 1;

    for (const id of Object.keys(structure)) {
      const bakeNode = structure[id];
      const name = bakeNode.name;

      // Skip if already processed, is a default node, or is a visual type
      if (seen.has(name)) continue;
      seen.add(name);

      const isDefault = DEFAULT_NODES.some((n) => n.type === name);
      if (isDefault) continue;

      // Visual nodes like Note/Group — skip custom definition creation
      if (name === VisualType.Note || name === VisualType.Group) continue;

      // Infer parent type from children count
      const childCount = this.getNodeChildIds(bakeNode).length;
      const inheritsFrom = this.inferCustomNodeParentType(childCount);

      // Extract parameters from bake data
      const parameters: NodeParameter[] = [];
      if (bakeNode.parameters) {
        for (const [paramName, paramValue] of Object.entries(
          bakeNode.parameters,
        )) {
          parameters.push({
            name: paramName,
            type:
              typeof paramValue === "number"
                ? ParameterType.Number
                : ParameterType.String,
            defaultValue: paramValue as string | number,
          });
        }
      }

      customDefs.push({
        id: `imported-custom-${customId++}`,
        name,
        inheritsFrom,
        parameters: parameters.length > 0 ? parameters : undefined,
      });
    }

    return customDefs;
  }

  /**
   * Internal: imports bake data into the editor. Handles custom node detection,
   * v1→v2 remapping, layout, and node/edge reconstruction.
   */
  private async importBakeData(bake_data: BakeFileData): Promise<void> {
    const is_v1 = bake_data.version.startsWith("1");
    const structure = bake_data.structure;

    // Remap v1 node names to v2 equivalents
    if (is_v1) {
      for (const id of Object.keys(structure)) {
        const node = structure[id];
        if (V1_TO_V2_NODE_NAMES[node.name]) {
          structure[id] = { ...node, name: V1_TO_V2_NODE_NAMES[node.name] };
        }
      }
    }

    // Detect and create custom node definitions
    const customDefs = this.detectCustomNodes(structure);
    const customNames = new Set(customDefs.map((d) => d.name));

    // Find root: node that is not a child of any other node (excluding EntryPoint)
    const all_children = new Set<string>();
    for (const id of Object.keys(structure)) {
      const node = structure[id];
      if (node.name === "EntryPoint") continue;
      for (const child of node.children) all_children.add(child);
      if (node.switch_case) {
        for (const cid of Object.values(node.switch_case.cases))
          all_children.add(cid);
        if (node.switch_case.default)
          all_children.add(node.switch_case.default);
      }
    }

    // Find EntryPoint id
    const entry_id = Object.keys(structure).find(
      (id) => structure[id].name === "EntryPoint",
    );

    // Compute tree depth-first layout positions
    const NODE_W = 200;
    const NODE_H = 80;
    const H_GAP = 40;
    const V_GAP = 100;

    // Subtree width calculation (leaf = 1 unit)
    const subtreeWidth = (id: string): number => {
      const node = structure[id];
      if (node.name === "EntryPoint") return 1;
      const children = this.getNodeChildIds(node);
      if (children.length === 0) return 1;
      return children.reduce((sum, cid) => sum + subtreeWidth(cid), 0);
    };

    const positions: Record<string, { x: number; y: number }> = {};

    const layout = (id: string, x: number, y: number): void => {
      positions[id] = { x, y };
      const node = structure[id];
      const children = this.getNodeChildIds(node);
      if (children.length === 0) return;

      const widths = children.map(subtreeWidth);
      const totalUnits = widths.reduce((a, b) => a + b, 0);
      const totalPx = totalUnits * NODE_W + (children.length - 1) * H_GAP;
      let cx = x - totalPx / 2;

      children.forEach((cid, i) => {
        const childPx = widths[i] * NODE_W + (widths[i] - 1) * H_GAP;
        layout(cid, cx + childPx / 2, y + NODE_H + V_GAP);
        cx += childPx + H_GAP;
      });
    };

    // Find root (non-entry non-child node)
    const root_id = Object.keys(structure).find(
      (id) => !all_children.has(id) && structure[id].name !== "EntryPoint",
    );

    if (!root_id) {
      throw new Error("Could not find root node in bake structure");
    }

    layout(root_id, 0, 0);

    // Place EntryPoint above root
    if (entry_id) {
      positions[entry_id] = { x: 0, y: -(NODE_H + V_GAP) };
    }

    // Build BehaviorTreeNode list
    let next_id = 1;
    const nodes: BehaviorTreeNode[] = [];
    const edges: BehaviorTreeEdge[] = [];

    for (const id of Object.keys(structure)) {
      const bake_node = structure[id];
      const node_type = bake_node.name;
      const pos = positions[id] ?? { x: 0, y: 0 };

      const node_def = DEFAULT_NODES.find((n) => n.type === node_type);
      const isCustom = customNames.has(node_type);
      const isVisual =
        node_type === VisualType.Note || node_type === VisualType.Group;

      let category: NodeCategory;
      if (node_def) {
        category = node_def.category;
      } else if (isCustom) {
        const parentType = this.inferCustomNodeParentType(
          this.getNodeChildIds(bake_node).length,
        );
        category =
          parentType === "Decorator"
            ? NodeCategory.Decorator
            : parentType === "Composite"
              ? NodeCategory.Composite
              : NodeCategory.Node;
      } else if (node_type === "EntryPoint") {
        category = NodeCategory.Tool;
      } else {
        category = NodeCategory.Node;
      }

      const parameters: Record<string, string | number> = {};
      if (bake_node.parameters) {
        for (const [k, v] of Object.entries(bake_node.parameters)) {
          if (typeof v === "string" || typeof v === "number") {
            parameters[k] = v;
          }
        }
      }

      let react_flow_type = "behaviorTreeNode";
      if (node_type === "Switch") react_flow_type = "switchNode";
      else if (isVisual && node_type === VisualType.Note)
        react_flow_type = "noteNode";
      else if (isVisual && node_type === VisualType.Group)
        react_flow_type = "groupNode";

      const inheritsFrom = isCustom
        ? this.inferCustomNodeParentType(this.getNodeChildIds(bake_node).length)
        : node_def?.inheritsFrom;

      const node_data: BehaviorTreeNodeData = {
        label: node_def?.label ?? node_type,
        category,
        nodeType: node_type,
        description: node_def?.description,
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
        inheritsFrom,
        // Custom node properties

        isCustom: isCustom || undefined,
        customName: isCustom ? node_type : undefined,
        // Visual node properties

        isVisual: isVisual || undefined,
        noteText:
          node_type === VisualType.Note ? "Click to edit note..." : undefined,
        noteSize: node_type === VisualType.Note ? 16 : undefined,
        groupColor: node_type === VisualType.Group ? "#3b82f6" : undefined,
      };

      // Rebuild Switch node data
      if (node_type === "Switch" && bake_node.switch_case) {
        node_data.blackboardProperty = bake_node.switch_case.parameter_name;
        node_data.switchCases = Object.keys(bake_node.switch_case.cases).map(
          (case_name, idx) => ({ id: String(idx), name: case_name }),
        );
        node_data.defaultCase = bake_node.switch_case.default
          ? "default"
          : undefined;
      }

      const newNode: BehaviorTreeNode = {
        id,
        type: react_flow_type,
        position: pos,
        data: node_data,
      };

      // Set initial size for visual nodes
      if (node_type === VisualType.Group) {
        newNode.style = { width: 200, height: 150, zIndex: -1 };
      } else if (node_type === VisualType.Note) {
        newNode.style = { width: 200, height: 100, zIndex: 100 };
      }

      nodes.push(newNode);

      next_id = Math.max(next_id, parseInt(id) + 1 || next_id);
    }

    // Build edges from children
    let edge_idx = 0;
    for (const id of Object.keys(structure)) {
      const bake_node = structure[id];
      // Skip EntryPoint children - we'll connect it to root separately
      if (bake_node.name === "EntryPoint") continue;

      for (const child_id of bake_node.children) {
        edges.push({
          id: `e-${edge_idx++}`,
          source: id,
          target: child_id,
        });
      }
      if (bake_node.switch_case) {
        for (const child_id of Object.values(bake_node.switch_case.cases)) {
          edges.push({
            id: `e-${edge_idx++}`,
            source: id,
            target: child_id,
          });
        }
        if (bake_node.switch_case.default) {
          edges.push({
            id: `e-${edge_idx++}`,
            source: id,
            target: bake_node.switch_case.default,
          });
        }
      }
    }

    // Connect EntryPoint → root
    if (entry_id && root_id) {
      edges.push({ id: `e-${edge_idx++}`, source: entry_id, target: root_id });
    }

    this.behavior_tree_controller_.SetNodes(nodes);
    this.behavior_tree_controller_.SetEdges(edges);
    this.behavior_tree_controller_.SetNextNodeId(next_id);

    // Register custom node definitions
    if (customDefs.length > 0) {
      this.behavior_tree_controller_.SetCustomNodes(customDefs);
    }

    console.log(
      `Imported bake "${bake_data.name}" (${bake_data.version}) into editor: ${nodes.length} nodes, ${edges.length} edges, ${customDefs.length} custom nodes`,
    );
  }

  private getNodeChildIds(node: BakeNodeStructure): string[] {
    const ids: string[] = [...node.children];
    if (node.switch_case) {
      ids.push(...Object.values(node.switch_case.cases));
      if (node.switch_case.default) ids.push(node.switch_case.default);
    }
    return ids;
  }

  public CanBake(): boolean {
    return !!this.save_controller_.GetCurrentFileName();
  }
}

export const bakingController = new BakingController();
