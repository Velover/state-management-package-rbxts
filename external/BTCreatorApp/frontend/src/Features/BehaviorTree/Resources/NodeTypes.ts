export enum NodeCategory {
  Composite = "Composite",
  Node = "Node",
  Decorator = "Decorator",
  Tool = "Tool",
}

export enum CompositeType {
  Sequence = "Sequence",
  ReactiveSequence = "ReactiveSequence",
  MemorySequence = "MemorySequence",
  Fallback = "Fallback",
  ReactiveFallback = "ReactiveFallback",
  Parallel = "Parallel",
  IfThenElse = "IfThenElse",
  WhileDoElse = "WhileDoElse",
  TryCatch = "TryCatch",
}

export enum NodeType {
  Action = "Action",
  Condition = "Condition",
  Switch = "Switch",
  Wait = "Wait",
  Timer = "Timer",
  SubTree = "SubTree",
  Callback = "Callback",
  WaitGate = "WaitGate",
  WasEntryUpdated = "WasEntryUpdated",
  Plug = "Plug",
  Log = "Log",
  Scope = "Scope",
}

export enum DecoratorType {
  Inverter = "Inverter",
  ForceSuccess = "ForceSuccess",
  ForceFailure = "ForceFailure",
  Timeout = "Timeout",
  KeepRunningUntilSuccess = "KeepRunningUntilSuccess",
  KeepRunningUntilFailure = "KeepRunningUntilFailure",
  Repeat = "Repeat",
  Cooldown = "Cooldown",
  FireAndForget = "FireAndForget",
  RunningGate = "RunningGate",
  OneShot = "OneShot",
  ForceRunning = "ForceRunning",
}

export enum ToolType {
  EntryPoint = "EntryPoint",
}

export enum ParameterType {
  String = "String",
  Number = "Number",
  Enum = "Enum",
}

export enum VisualType {
  Note = "Note",
  Group = "Group",
}

export interface NodeParameter {
  name: string;
  type: ParameterType;
  defaultValue?: string | number;
  enumValues?: string[]; // For enum type
  description?: string;
}

export interface NodeValidationRules {
  minChildren?: number;
  maxChildren?: number;
  canConnectToSelf?: boolean;
  isAbstract?: boolean;
  canInheritFrom?: string[];
}

export interface NodeDefinition {
  id: string;
  type: string;
  category: NodeCategory;
  label: string;
  description?: string;
  validation?: NodeValidationRules;
  isAbstract?: boolean;
  isCustom?: boolean;
  isVisual?: boolean;
  inheritsFrom?: string;
  parameters?: NodeParameter[];
}

export interface VisualNodeDefinition extends NodeDefinition {
  isVisual: true;
  visualType: VisualType;
}

export const NODE_VALIDATION_RULES: Record<string, NodeValidationRules> = {
  // Base abstract types
  Node: { isAbstract: true, maxChildren: 0 },
  Composite: { isAbstract: true, minChildren: 1 },
  Decorator: { isAbstract: true, minChildren: 1, maxChildren: 1 },
  Tool: { isAbstract: true, minChildren: 1 },

  // Composite nodes - inherit from Composite (which inherits from Node)
  [CompositeType.Sequence]: { minChildren: 2 },
  [CompositeType.ReactiveSequence]: { minChildren: 2 },
  [CompositeType.MemorySequence]: { minChildren: 2 },
  [CompositeType.Fallback]: { minChildren: 2 },
  [CompositeType.ReactiveFallback]: { minChildren: 2 },
  [CompositeType.Parallel]: { minChildren: 2 },
  [CompositeType.IfThenElse]: { minChildren: 2, maxChildren: 3 },
  [CompositeType.WhileDoElse]: { minChildren: 2, maxChildren: 3 },
  [CompositeType.TryCatch]: { minChildren: 2, maxChildren: 3 },

  // Decorator nodes - some no longer abstract
  [DecoratorType.Inverter]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.ForceSuccess]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.ForceFailure]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.Timeout]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.KeepRunningUntilSuccess]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.KeepRunningUntilFailure]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.FireAndForget]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.Repeat]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.Cooldown]: {
    minChildren: 1,
    maxChildren: 1,
  },
  [DecoratorType.RunningGate]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.OneShot]: { minChildren: 1, maxChildren: 1 },
  [DecoratorType.ForceRunning]: { minChildren: 1, maxChildren: 1 },

  // Node types - some no longer abstract
  [NodeType.WaitGate]: { maxChildren: 0 },
  [NodeType.Action]: { maxChildren: 0 },
  [NodeType.Condition]: { maxChildren: 0 },
  [NodeType.Wait]: { maxChildren: 0 },
  [NodeType.SubTree]: { maxChildren: 0 },
  [NodeType.Timer]: { maxChildren: 0 },
  [NodeType.Callback]: { maxChildren: 0 },
  [NodeType.WasEntryUpdated]: { maxChildren: 0 },

  [NodeType.Plug]: { maxChildren: 0 },
  [NodeType.Log]: { maxChildren: 0 },
  [NodeType.Scope]: { maxChildren: 0 },

  // Special nodes
  [NodeType.Switch]: { minChildren: 1 },

  // Tool nodes
  [ToolType.EntryPoint]: { minChildren: 1, maxChildren: 1 },
};

export const ABSTRACT_NODES = ["Node", "Composite", "Decorator", "Tool"];

export const DEFAULT_NODES: NodeDefinition[] = [
  // Base abstract nodes
  {
    id: "abstract-node",
    type: "Node",
    category: NodeCategory.Node,
    label: "Node (Abstract)",
    description: "Base node - cannot be used directly",
    isAbstract: true,
  },
  {
    id: "abstract-composite",
    type: "Composite",
    category: NodeCategory.Composite,
    label: "Composite (Abstract)",
    description: "Base composite node - cannot be used directly",
    isAbstract: true,
    inheritsFrom: "Node",
  },
  {
    id: "abstract-decorator",
    type: "Decorator",
    category: NodeCategory.Decorator,
    label: "Decorator (Abstract)",
    description: "Base decorator - cannot be used directly",
    isAbstract: true,
    inheritsFrom: "Node",
  },
  {
    id: "abstract-tool",
    type: "Tool",
    category: NodeCategory.Tool,
    label: "Tool (Abstract)",
    description: "Base tool - cannot be used directly",
    isAbstract: true,
    inheritsFrom: "Node",
  },

  // Composite nodes - inherit from Composite
  {
    id: "sequence",
    type: CompositeType.Sequence,
    category: NodeCategory.Composite,
    label: "Sequence",
    inheritsFrom: "Composite",
  },
  {
    id: "reactive-sequence",
    type: CompositeType.ReactiveSequence,
    category: NodeCategory.Composite,
    label: "Reactive Sequence",
    inheritsFrom: "Composite",
  },
  {
    id: "memory-sequence",
    type: CompositeType.MemorySequence,
    category: NodeCategory.Composite,
    label: "Memory Sequence",
    inheritsFrom: "Composite",
  },
  {
    id: "fallback",
    type: CompositeType.Fallback,
    category: NodeCategory.Composite,
    label: "Fallback",
    inheritsFrom: "Composite",
  },
  {
    id: "reactive-fallback",
    type: CompositeType.ReactiveFallback,
    category: NodeCategory.Composite,
    label: "Reactive Fallback",
    inheritsFrom: "Composite",
  },
  {
    id: "parallel",
    type: CompositeType.Parallel,
    category: NodeCategory.Composite,
    label: "Parallel",
    inheritsFrom: "Composite",
    parameters: [
      {
        name: "successPolicy",
        type: ParameterType.Enum,
        defaultValue: "ALL",
        enumValues: ["ALL", "ONE"],
        description: "Policy for success",
      },
      {
        name: "failurePolicy",
        type: ParameterType.Enum,
        defaultValue: "ONE",
        enumValues: ["ALL", "ONE"],
        description: "Policy for failure",
      },
    ],
  },
  {
    id: "if-then-else",
    type: CompositeType.IfThenElse,
    category: NodeCategory.Composite,
    label: "If Then Else",
    inheritsFrom: "Composite",
  },
  {
    id: "while-do-else",
    type: CompositeType.WhileDoElse,
    category: NodeCategory.Composite,
    label: "While Do Else",
    inheritsFrom: "Composite",
  },
  {
    id: "try-catch",
    type: CompositeType.TryCatch,
    category: NodeCategory.Composite,
    label: "Try Catch",
    description:
      "Runs TRY child, executes CATCH on failure, optionally runs FINALLY",
    inheritsFrom: "Composite",
  },

  // Node types - some now concrete with parameters
  {
    id: "action",
    type: NodeType.Action,
    category: NodeCategory.Node,
    label: "Action",
    description: "Executes an action",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "actionName",
        type: ParameterType.String,
        defaultValue: "DefaultAction",
        description: "Name of the action to execute",
      },
    ],
  },
  {
    id: "condition",
    type: NodeType.Condition,
    category: NodeCategory.Node,
    label: "Condition",
    description: "Checks a condition",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "conditionName",
        type: ParameterType.String,
        defaultValue: "DefaultCondition",
        description: "Name of condition to use",
      },
    ],
  },
  {
    id: "switch",
    type: NodeType.Switch,
    category: NodeCategory.Node,
    label: "Switch",
    inheritsFrom: "Node",
  },
  {
    id: "wait",
    type: NodeType.Wait,
    category: NodeCategory.Node,
    label: "Wait",
    description: "Waits for a specified duration",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "duration",
        type: ParameterType.Number,
        defaultValue: 1.0,
        description: "Wait duration in seconds",
      },
    ],
  },
  {
    id: "timer",
    type: NodeType.Timer,
    category: NodeCategory.Node,
    label: "Timer",
    description:
      "Counts the registered field of this name down by dt; SUCCESS at zero",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "timerName",
        type: ParameterType.String,
        defaultValue: "Timer1",
        description: "Name of a field registered with BTCreator.RegisterField",
      },
    ],
  },
  {
    id: "subtree",
    type: NodeType.SubTree,
    category: NodeCategory.Node,
    label: "SubTree",
    description: "Embeds the root node of a registered sub-tree",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "treeName",
        type: ParameterType.String,
        defaultValue: "DefaultTreeName",
        description: "Name of the subtree to execute",
      },
    ],
  },
  {
    id: "callback",
    type: NodeType.Callback,
    category: NodeCategory.Node,
    label: "Callback",
    description: "Executes a callback function",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "callbackName",
        type: ParameterType.String,
        defaultValue: "CallbackName",
        description: "Name of the callback to execute",
      },
    ],
  },
  {
    id: "was-entry-updated",
    type: NodeType.WasEntryUpdated,
    category: NodeCategory.Node,
    label: "Was Entry Updated",
    description:
      "SUCCESS when any of the listed per-agent fields changed since the previous visited tick",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "entries",
        type: ParameterType.String,
        defaultValue: "entry1,entry2",
        description:
          "Comma-separated names of fields registered with BTCreator.RegisterField",
      },
      {
        name: "skipFirst",
        type: ParameterType.Enum,
        defaultValue: "FALSE",
        enumValues: ["TRUE", "FALSE"],
        description: "Whether to skip the first activation check",
      },
    ],
  },

  // Decorator types - some now concrete with parameters
  {
    id: "inverter",
    type: DecoratorType.Inverter,
    category: NodeCategory.Decorator,
    label: "Inverter",
    inheritsFrom: "Decorator",
  },
  {
    id: "force-success",
    type: DecoratorType.ForceSuccess,
    category: NodeCategory.Decorator,
    label: "Force Success",
    inheritsFrom: "Decorator",
  },
  {
    id: "force-failure",
    type: DecoratorType.ForceFailure,
    category: NodeCategory.Decorator,
    label: "Force Failure",
    inheritsFrom: "Decorator",
  },
  {
    id: "timeout",
    type: DecoratorType.Timeout,
    category: NodeCategory.Decorator,
    label: "Timeout",
    description: "Fails child if it takes too long",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "timeoutSeconds",
        type: ParameterType.Number,
        defaultValue: 5.0,
        description: "Timeout duration in seconds",
      },
      {
        name: "timeoutBehavior",
        type: ParameterType.Enum,
        defaultValue: "FAILURE",
        enumValues: ["FAILURE", "SUCCESS"],
        description: "Behavior when timeout occurs",
      },
    ],
  },
  {
    id: "fire-and-forget",
    type: DecoratorType.FireAndForget,
    category: NodeCategory.Decorator,
    label: "Fire And Forget",
    inheritsFrom: "Decorator",
  },
  {
    id: "keep-running-until-success",
    type: DecoratorType.KeepRunningUntilSuccess,
    category: NodeCategory.Decorator,
    label: "Keep Running Until Success",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "maxAttempts",
        type: ParameterType.Number,
        defaultValue: -1, // -1 for infinite retries
        description: "Number of attempts to retry (-1 for infinite)",
      },
    ],
  },
  {
    id: "keep-running-until-failure",
    type: DecoratorType.KeepRunningUntilFailure,
    category: NodeCategory.Decorator,
    label: "Keep Running Until Failure",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "maxAttempts",
        type: ParameterType.Number,
        defaultValue: -1, // -1 for infinite retries
        description: "Number of attempts to retry (-1 for infinite)",
      },
    ],
  },
  {
    id: "repeat",
    type: DecoratorType.Repeat,
    category: NodeCategory.Decorator,
    label: "Repeat",
    description: "Repeats child node execution",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "repeatCount",
        type: ParameterType.Number,
        defaultValue: -1,
        description: "Number of times to repeat (-1 for infinite)",
      },
      {
        name: "repeatCondition",
        type: ParameterType.Enum,
        defaultValue: "ALWAYS",
        enumValues: ["ALWAYS", "SUCCESS", "FAILURE"],
        description: "When to repeat execution",
      },
    ],
  },
  {
    id: "cooldown",
    type: DecoratorType.Cooldown,
    category: NodeCategory.Decorator,
    label: "Cooldown",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "cooldownSeconds",
        type: ParameterType.Number,
        defaultValue: 1,
        description: "Cooldown duration in seconds",
      },
      {
        name: "resetOnHalt",
        type: ParameterType.Enum,
        defaultValue: "FALSE",
        enumValues: ["TRUE", "FALSE"],
        description: "Whether to reset the cooldown when the node is halted",
      },
    ],
  },
  {
    id: "plug",
    type: NodeType.Plug,
    category: NodeCategory.Node,
    label: "Plug",
    description: "Returns a fixed status",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "status",
        type: ParameterType.Enum,
        defaultValue: "SUCCESS",
        enumValues: ["SUCCESS", "RUNNING", "FAILURE"],
        description: "The status to return",
      },
    ],
  },
  {
    id: "wait-gate",
    type: NodeType.WaitGate,
    category: NodeCategory.Node,
    label: "Wait Gate",
    description: "Waits for duration but returns FAILURE instead of RUNNING",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "duration",
        type: ParameterType.Number,
        defaultValue: 1.0,
        description: "Wait duration in seconds",
      },
    ],
  },
  {
    id: "running-gate",
    type: DecoratorType.RunningGate,
    category: NodeCategory.Decorator,
    label: "Running Gate",
    description: "Returns FAILURE if child returns RUNNING",
    inheritsFrom: "Decorator",
  },
  {
    id: "one-shot",
    type: DecoratorType.OneShot,
    category: NodeCategory.Decorator,
    label: "One Shot",
    description: "Executes child only once, then returns its last result",
    inheritsFrom: "Decorator",
    parameters: [
      {
        name: "resetOnBecomeInactive",
        type: ParameterType.Enum,
        defaultValue: "FALSE",
        enumValues: ["TRUE", "FALSE"],
        description:
          "Whether to forget the result when the node was not visited in the previous tick",
      },
    ],
  },

  {
    id: "log",
    type: NodeType.Log,
    category: NodeCategory.Node,
    label: "Log",
    description: "Prints a message and returns SUCCESS",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "message",
        type: ParameterType.String,
        defaultValue: "Hello",
        description: "Text to print",
      },
    ],
  },
  {
    id: "scope",
    type: NodeType.Scope,
    category: NodeCategory.Node,
    label: "Scope",
    description:
      "Always SUCCESS. Calls onEnter on the first tick its branch is visited and onExit at the end of the first tick it is not (the replacement for activated/inactive hooks)",
    inheritsFrom: "Node",
    parameters: [
      {
        name: "onEnter",
        type: ParameterType.String,
        defaultValue: "",
        description: "Registered callback name to run when visits begin (optional)",
      },
      {
        name: "onExit",
        type: ParameterType.String,
        defaultValue: "",
        description: "Registered callback name to run when visits stop (optional)",
      },
    ],
  },
  {
    id: "force-running",
    type: DecoratorType.ForceRunning,
    category: NodeCategory.Decorator,
    label: "Force Running",
    description:
      "Always returns RUNNING; the child restarts whenever it completes",
    inheritsFrom: "Decorator",
  },

  // Tool nodes - inherit from Tool
  {
    id: "entry-point",
    type: ToolType.EntryPoint,
    category: NodeCategory.Tool,
    label: "Entry Point",
    description: "Defines the starting point of the behavior tree",
    inheritsFrom: "Tool",
  },
].map((node) => ({
  ...node,
  validation: NODE_VALIDATION_RULES[node.type] || { canConnectToSelf: false },
}));

// Helper function to get validation rules with inheritance
export function getValidationRules(
  nodeType: string,
  inheritsFrom?: string,
): NodeValidationRules {
  let rules = NODE_VALIDATION_RULES[nodeType];
  if (!rules && inheritsFrom) {
    rules = NODE_VALIDATION_RULES[inheritsFrom];
  }
  return rules || { canConnectToSelf: false };
}

// Helper function to check if a node is abstract
export function isNodeAbstract(nodeType: string, isCustom?: boolean): boolean {
  if (isCustom) {
    return false; // Custom nodes are never abstract
  }
  return ABSTRACT_NODES.includes(nodeType);
}

export const VISUAL_NODES: VisualNodeDefinition[] = [
  {
    id: "note",
    type: VisualType.Note,
    category: NodeCategory.Tool,
    label: "Note",
    description: "Add text notes to your behavior tree",
    isVisual: true,
    visualType: VisualType.Note,
    validation: { maxChildren: 0 },
  },
  {
    id: "group",
    type: VisualType.Group,
    category: NodeCategory.Tool,
    label: "Group",
    description: "Visual grouping for organizing nodes",
    isVisual: true,
    visualType: VisualType.Group,
    validation: { maxChildren: 0 },
  },
];

export const ALL_AVAILABLE_NODES = [...DEFAULT_NODES, ...VISUAL_NODES];
