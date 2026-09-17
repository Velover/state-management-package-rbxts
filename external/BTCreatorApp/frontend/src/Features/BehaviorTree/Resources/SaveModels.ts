import {
  BehaviorTreeNode,
  BehaviorTreeEdge,
  CustomNodeDefinition,
} from "./FlowModels.js";

export interface BehaviorTreeSaveData {
  nodes: BehaviorTreeNode[];
  edges: BehaviorTreeEdge[];
  customNodes: CustomNodeDefinition[];
  nextNodeId: number;
  version: string;
  lastSaved: string;
}

export const SAVE_VERSION = "2.0.0";
export const COMPATIBLE_SAVE_VERSIONS = ["1.0.0", "2.0.0"];
export const AUTOSAVE_INTERVAL_MS = 2000; // 2 seconds

// Interface for communicating with Go backend
export interface BehaviorTreeSaveRequest {
  nodes: any[];
  edges: any[];
  customNodes: CustomNodeDefinition[];
  nextNodeId: number;
  version: string;
  lastSaved: string;
}
