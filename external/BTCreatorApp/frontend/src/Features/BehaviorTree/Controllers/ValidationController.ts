import { proxy, useSnapshot } from "valtio";
import { BehaviorTreeEdge, BehaviorTreeNode } from "../Resources/FlowModels.js";
import {
  DEFAULT_NODES,
  getValidationRules,
  isNodeAbstract,
} from "../Resources/NodeTypes.js";
import { NodeError, ValidationResult } from "../Resources/ValidationModels.js";
import { behaviorTreeController } from "./BehaviorTreeController.js";

export class ValidationController {
  private readonly behavior_tree_controller_ = behaviorTreeController;

  readonly state = proxy({
    validationResult: {
      isValid: true,
      errors: [],
      warnings: [],
    } as ValidationResult,
    inactiveNodes: new Set<string>(),
  });

  public useValidationResult() {
    return useSnapshot(this.state).validationResult as ValidationResult;
  }

  public useInactiveNodes() {
    return this.state.inactiveNodes;
  }

  public useNodeErrors() {
    const snap = useSnapshot(this.state);
    const result = snap.validationResult as ValidationResult;
    const errorsByNode: Record<string, NodeError[]> = {};

    [...result.errors, ...result.warnings].forEach((error) => {
      if (!errorsByNode[error.nodeId]) {
        errorsByNode[error.nodeId] = [];
      }
      errorsByNode[error.nodeId].push(error);
    });

    return errorsByNode;
  }

  public ValidateTree(): ValidationResult {
    const nodes = this.behavior_tree_controller_.GetCurrentNodesAtom();
    const edges = this.behavior_tree_controller_.GetCurrentEdgesAtom();

    const errors: NodeError[] = [];
    const warnings: NodeError[] = [];

    // Filter out visual nodes from validation
    const behaviorNodes = nodes.filter((node) => !node.data.isVisual);
    const behaviorEdges = edges.filter((edge) => {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      return !sourceNode?.data.isVisual && !targetNode?.data.isVisual;
    });

    // Find Entry Point and check for cycles
    const entryPoints = behaviorNodes.filter(
      (node) => node.data.nodeType === "EntryPoint",
    );
    let activeNodes = new Set<string>();

    if (entryPoints.length === 1) {
      // Check for cycles and get active nodes (excluding visual nodes)
      const cycleResult = this.detectCyclesAndGetActiveNodes(
        behaviorNodes,
        behaviorEdges,
        entryPoints[0].id,
      );
      if (cycleResult.hasCycles) {
        cycleResult.cycleNodes.forEach((nodeId) => {
          errors.push({
            nodeId,
            type: "cyclic_dependency",
            message: "Node is part of a cyclic dependency",
            severity: "error",
          });
        });
      }
      activeNodes = cycleResult.activeNodes;
    }

    // Update inactive nodes (excluding visual nodes)
    const inactiveNodes = new Set(
      behaviorNodes
        .filter((node) => !activeNodes.has(node.id))
        .map((node) => node.id),
    );
    this.state.inactiveNodes = inactiveNodes;

    // Validate Entry Point requirements
    this.validateEntryPoints(behaviorNodes, errors);

    // Validate individual nodes (only active behavior nodes)
    behaviorNodes.forEach((node) => {
      if (!inactiveNodes.has(node.id)) {
        const validation = this.validateNode(
          node,
          behaviorNodes,
          behaviorEdges,
        );
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);
      }
    });

    const result = {
      isValid: errors.length === 0,
      errors,
      warnings,
    };

    this.state.validationResult = result;
    return result;
  }

  private detectCyclesAndGetActiveNodes(
    nodes: BehaviorTreeNode[],
    edges: BehaviorTreeEdge[],
    entryPointId: string,
  ): { hasCycles: boolean; cycleNodes: Set<string>; activeNodes: Set<string> } {
    const activeNodes = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycleNodes = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) {
        // Found a cycle
        cycleNodes.add(nodeId);
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visiting.add(nodeId);
      activeNodes.add(nodeId);

      // Get children of current node
      const childEdges = edges.filter((edge) => edge.source === nodeId);
      let hasCycle = false;

      for (const edge of childEdges) {
        if (dfs(edge.target)) {
          hasCycle = true;
          // Mark all nodes in cycle path
          cycleNodes.add(nodeId);
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);

      return hasCycle;
    };

    const hasCycles = dfs(entryPointId);

    return { hasCycles, cycleNodes, activeNodes };
  }

  private validateEntryPoints(nodes: BehaviorTreeNode[], errors: NodeError[]) {
    const entryPoints = nodes.filter(
      (node) => node.data.nodeType === "EntryPoint",
    );

    if (entryPoints.length === 0) {
      errors.push({
        nodeId: "tree",
        type: "missing_entry_point",
        message: "Behavior tree must have exactly one Entry Point node",
        severity: "error",
      });
    } else if (entryPoints.length > 1) {
      entryPoints.forEach((node, index) => {
        if (index > 0) {
          errors.push({
            nodeId: node.id,
            type: "multiple_entry_points",
            message: "Only one Entry Point node is allowed per behavior tree",
            severity: "error",
          });
        }
      });
    }
  }

  private validateNode(
    node: BehaviorTreeNode,
    allNodes: BehaviorTreeNode[],
    allEdges: BehaviorTreeEdge[],
  ): ValidationResult {
    const errors: NodeError[] = [];
    const warnings: NodeError[] = [];

    // Get validation rules using inheritance
    const rules = getValidationRules(
      node.data.nodeType,
      node.data.inheritsFrom,
    );

    // Check if abstract node is being used directly
    if (isNodeAbstract(node.data.nodeType, node.data.isCustom)) {
      errors.push({
        nodeId: node.id,
        type: "abstract_node",
        message: `${node.data.label} is an abstract node and cannot be used directly`,
        severity: "error",
      });
    }

    // Validate parameters
    this.validateNodeParameters(node, errors, warnings);

    // Count children
    const children = allEdges.filter((edge) => edge.source === node.id);
    const childCount = children.length;

    // Check minimum children
    if (rules.minChildren !== undefined && childCount < rules.minChildren) {
      errors.push({
        nodeId: node.id,
        type: "missing_children",
        message: `${node.data.label} requires at least ${rules.minChildren} children but has ${childCount}`,
        severity: "error",
      });
    }

    // Check maximum children
    if (rules.maxChildren !== undefined && childCount > rules.maxChildren) {
      errors.push({
        nodeId: node.id,
        type: "too_many_children",
        message: `${node.data.label} allows at most ${rules.maxChildren} children but has ${childCount}`,
        severity: "error",
      });
    }

    // Special validation for Switch nodes
    if (node.data.nodeType === "Switch") {
      this.validateSwitchNode(node, children, errors, warnings);
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  private validateNodeParameters(
    node: BehaviorTreeNode,
    errors: NodeError[],
    warnings: NodeError[],
  ) {
    // Get node definition to check required parameters
    const nodeDefinition = node.data.isCustom
      ? this.behavior_tree_controller_
          .GetCustomNodesAtom()
          .find((cn) => cn.name === node.data.customName)
      : DEFAULT_NODES.find((n) => n.type === node.data.nodeType);

    if (!nodeDefinition?.parameters) {
      return; // No parameters to validate
    }

    const nodeParameters = node.data.parameters || {};

    nodeDefinition.parameters.forEach((paramDef) => {
      const paramValue = nodeParameters[paramDef.name];

      // Check if required parameter is missing
      if (paramValue === undefined || paramValue === "") {
        if (paramDef.defaultValue === undefined) {
          errors.push({
            nodeId: node.id,
            type: "missing_parameter",
            message: `Missing required parameter: ${paramDef.name}`,
            severity: "error",
          });
        }
      } else {
        // Validate parameter type
        this.validateParameterValue(node.id, paramDef, paramValue, errors);
      }
    });
  }

  private validateParameterValue(
    nodeId: string,
    paramDef: any,
    value: string | number,
    errors: NodeError[],
  ) {
    switch (paramDef.type) {
      case "Number":
        if (typeof value !== "number" || isNaN(value)) {
          errors.push({
            nodeId,
            type: "invalid_parameter",
            message: `Parameter ${paramDef.name} must be a valid number`,
            severity: "error",
          });
        }
        break;

      case "Enum":
        if (paramDef.enumValues && !paramDef.enumValues.includes(value)) {
          errors.push({
            nodeId,
            type: "invalid_parameter",
            message: `Parameter ${
              paramDef.name
            } must be one of: ${paramDef.enumValues.join(", ")}`,
            severity: "error",
          });
        }
        break;

      case "String":
        if (typeof value !== "string") {
          errors.push({
            nodeId,
            type: "invalid_parameter",
            message: `Parameter ${paramDef.name} must be a string`,
            severity: "error",
          });
        }
        break;
    }
  }

  private validateSwitchNode(
    node: BehaviorTreeNode,
    children: BehaviorTreeEdge[],
    errors: NodeError[],
    warnings: NodeError[],
  ) {
    const switchCases = node.data.switchCases || [];
    const hasDefault = !!node.data.defaultCase;
    const blackboardProperty = node.data.blackboardProperty;

    // Check for blackboard property
    if (!blackboardProperty || !blackboardProperty.trim()) {
      errors.push({
        nodeId: node.id,
        type: "missing_switch_cases",
        message: "Switch node must name a registered field or selector",
        severity: "error",
      });
    }

    // Check for duplicate case names
    const caseNames = switchCases.map((c) => c.name);
    const duplicateNames = caseNames.filter(
      (name, index) => caseNames.indexOf(name) !== index,
    );
    if (duplicateNames.length > 0) {
      errors.push({
        nodeId: node.id,
        type: "missing_switch_cases",
        message: `Switch node has duplicate case names: ${[
          ...new Set(duplicateNames),
        ].join(", ")}`,
        severity: "error",
      });
    }

    const expectedConnections = switchCases.length + (hasDefault ? 1 : 0);

    if (children.length !== expectedConnections) {
      errors.push({
        nodeId: node.id,
        type: "missing_switch_cases",
        message: `Switch node has ${
          children.length
        } connections but expects ${expectedConnections} (${
          switchCases.length
        } cases${hasDefault ? " + 1 default" : ""})`,
        severity: "error",
      });
    }

    if (switchCases.length === 0) {
      warnings.push({
        nodeId: node.id,
        type: "missing_switch_cases",
        message: "Switch node has no cases defined",
        severity: "warning",
      });
    }
  }

  public CanConnect(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) {
      return false; // Cannot connect to self
    }

    const nodes = this.behavior_tree_controller_.GetCurrentNodesAtom();
    const edges = this.behavior_tree_controller_.GetCurrentEdgesAtom();

    const sourceNode = nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return false;

    // Check if connection would create a cycle
    if (this.wouldCreateCycle(sourceId, targetId, edges)) {
      return false;
    }

    const rules = getValidationRules(
      sourceNode.data.nodeType,
      sourceNode.data.inheritsFrom,
    );

    // Check if would exceed max children
    if (rules.maxChildren !== undefined) {
      const currentChildren = edges.filter(
        (edge) => edge.source === sourceId,
      ).length;
      return currentChildren < rules.maxChildren;
    }

    return true;
  }

  private wouldCreateCycle(
    sourceId: string,
    targetId: string,
    edges: BehaviorTreeEdge[],
  ): boolean {
    const visited = new Set<string>();

    const dfs = (currentId: string): boolean => {
      if (currentId === sourceId) {
        return true; // Found cycle back to source
      }

      if (visited.has(currentId)) {
        return false;
      }

      visited.add(currentId);

      // Check all children of current node
      const childEdges = edges.filter((edge) => edge.source === currentId);
      for (const edge of childEdges) {
        if (dfs(edge.target)) {
          return true;
        }
      }

      return false;
    };

    return dfs(targetId);
  }

  public GetInactiveNodes(): Set<string> {
    return this.state.inactiveNodes;
  }
}

export const validationController = new ValidationController();
