import { Node, Edge } from "@xyflow/react";
import { NodeCategory, NodeParameter } from "./NodeTypes.js";

export interface SwitchCase {
  id: string;
  name: string;
  targetNodeId?: string;
}

export interface BehaviorTreeNodeData {
  label: string;
  category: NodeCategory;
  nodeType: string;
  description?: string;
  isCustom?: boolean;
  customName?: string;
  inheritsFrom?: string;
  switchCases?: SwitchCase[];
  defaultCase?: string;
  blackboardProperty?: string; // For Switch nodes
  parameters?: Record<string, string | number>; // Parameter values
  // Visual node properties
  isVisual?: boolean;
  noteText?: string; // For Note nodes
  noteSize?: number; // For Note nodes - font size in pixels
  groupColor?: string; // For Group nodes
  groupSize?: { width: number; height: number }; // For Group nodes
  [key: string]: unknown;
}

export type BehaviorTreeNode = Node<BehaviorTreeNodeData>;
export type BehaviorTreeEdge = Edge;

export interface CustomNodeDefinition {
  id: string;
  name: string;
  inheritsFrom: string;
  description?: string;
  parameters?: NodeParameter[];
}
