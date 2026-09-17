export interface NodeError {
  nodeId: string;
  type:
    | "missing_children"
    | "too_many_children"
    | "invalid_connection"
    | "missing_switch_cases"
    | "abstract_node"
    | "missing_entry_point"
    | "multiple_entry_points"
    | "cyclic_dependency"
    | "missing_parameter"
    | "invalid_parameter";
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  isValid: boolean;
  errors: NodeError[];
  warnings: NodeError[];
}

export interface SwitchCase {
  id: string;
  name: string;
  nodeId?: string;
}

export interface BakeResult {
  success: boolean;
  structure: Record<string, BakeNodeStructure>;
  errors: string[];
}

export interface BakeNodeStructure {
  name: string;
  children: string[];
  parameters?: Record<string, string | number>;
  switch_case?: {
    cases: Record<string, string>;
    default?: string;
    parameter_name: string;
  };
}
