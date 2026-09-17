# Behavior Tree Baking System

The Behavior Tree Creator includes a comprehensive baking system that converts visual behavior trees into structured data files that can be consumed by game engines or other applications.

## Overview

The baking process validates the behavior tree and exports it as a structured JSON file containing the relationships between nodes and their configurations. This allows the visual editor to remain separate from the runtime implementation.

## Baking Process

### Prerequisites

Before baking a behavior tree, ensure:

1. **File is saved**: The behavior tree must be saved to a `.btsave` file first
2. **Valid tree structure**: The tree must pass all validation checks
3. **Entry Point exists**: Exactly one Entry Point node must be present
4. **No validation errors**: All nodes must have valid configurations

### Validation Rules

The baking system enforces these validation rules:

- **Entry Point**: Exactly one Entry Point node is required
- **Node Children**: Composite nodes must have at least 2 children, Decorators exactly 1 child
- **Abstract Nodes**: Abstract nodes cannot be used directly in the tree
- **Switch Nodes**: Must name a registered field or selector and have valid case configurations
- **Connection Limits**: Nodes respect their maximum and minimum child requirements

## Baked File Structure

Baked files are saved with the `.btbake` extension in the `bakes` folder relative to the executable.

### File Format

```json
{
  "name": "MyBehaviorTree",
  "baked_at": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "structure": {
    "1": {
      "name": "NodeName",
      "children": ["2", "3"],
      "parameters": {
        "paramName": "value",
        "numericParam": 42
      },
      "switch_case": {
        "cases": {
          "CaseName": "4"
        },
        "default": "5",
        "parameter_name": "registered_field_or_selector"
      }
    }
  }
}
```

```ts
interface IFileStructure {
  name: string;
  baked_at: string;
  version: string;
  structure: {
    [id: string]: {
      name: string;
      children: string[]; //id[]
      parameters?: {
        [param_name: string]: string | number; //parameter name and value
      };
      switch_case?: {
        cases: {
          [case_name: string]: string; //id;
        };
        default?: string; //id
        parameter_name: string; //name of the field or selector registered with BTCreator
      };
    };
  };
}
```

### Structure Properties

#### Node Structure

Each node in the baked structure contains:

- **`name`**: The node type name (custom name for custom nodes, node type for default nodes)
- **`children`**: Array of child node IDs (ordered by visual position)
- **`parameters`** (Optional): Object containing parameter values with their names as keys
- **`switch_case`** (Optional): Present only for Switch nodes

#### Parameters

Node parameters are stored as key-value pairs where:

- **Key**: Parameter name as defined in the node definition
- **Value**: The configured value (string, number, or enum value)
- Parameters with default values that haven't been modified may be omitted

#### Switch Case Structure

For Switch nodes, the `switch_case` object contains:

- **`cases`**: Map of case names to target node IDs
- **`default`**: Optional default target node ID
- **`parameter_name`**: The registered field or selector name to switch on

### Node Structure Organization

In the baked structure:

1. **Node IDs**: Used as keys in the structure (unique identifiers from the editor)
2. **Node Names**: Stored as the `name` property in each node structure
3. **Child References**: All child references use node IDs to maintain proper relationships

This approach allows multiple nodes with the same name to coexist without conflicts, as each node has a unique ID.

## File Explorer Integration

After successful baking, the system will:

1. **Windows**: Open File Explorer and select the newly created `.btbake` file
2. **macOS**: Open Finder and reveal the bake file
3. **Linux**: Open the bakes directory (file selection varies by file manager)

If file selection fails, the system falls back to opening the bakes folder.

## Error Handling

The baking system provides detailed error messages for common issues:

- **No Entry Point**: "Behavior tree must have exactly one Entry Point node"
- **Multiple Entry Points**: "Only one Entry Point node is allowed per behavior tree"
- **Missing Field / Selector**: "Switch node must name a registered field or selector"
- **Invalid Children Count**: Node-specific messages about child requirements
- **File Save Errors**: Detailed file system error messages

## Best Practices

1. **Always validate before baking**: The UI prevents baking invalid trees, but always check for warnings
2. **Use descriptive names**: Custom node names should be clear and consistent
3. **Test baked output**: Verify the JSON structure matches your expectations
4. **Version control**: Keep both `.btsave` and `.btbake` files in version control
5. **Regular baking**: Bake frequently during development to catch issues early

## Troubleshooting

### Common Issues

**"No file selected" error**: Save your behavior tree project first before baking.

**Validation errors**: Check the error panel for specific validation issues and fix them before baking.

**File permission errors**: Ensure the application has write permissions to the application directory.

**Missing nodes in baked output**: Verify all nodes are properly connected and not floating in the editor.

### Example Baked Output

For a behavior tree with parameterized nodes:

- Entry Point (ID: "1") → Timeout (ID: "2") → Action (ID: "3")

The baked output would be:

```json
{
  "name": "ParameterizedTree",
  "baked_at": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "structure": {
    "1": {
      "name": "EntryPoint",
      "children": ["2"]
    },
    "2": {
      "name": "Timeout",
      "children": ["3"],
      "parameters": {
        "timeoutSeconds": 10.0,
        "timeoutBehavior": "FAILURE"
      }
    },
    "3": {
      "name": "Action",
      "children": [],
      "parameters": {
        "actionName": "MoveToTarget"
      }
    }
  }
}
```

### Custom Node Parameters

Custom nodes can define their own parameters during creation:

```json
{
  "4": {
    "name": "CustomPatrolAction",
    "children": [],
    "parameters": {
      "patrolRadius": 15.0,
      "patrolSpeed": 2.5,
      "patrolType": "CIRCULAR"
    }
  }
}
```

## Parameter Validation

The baking system validates parameters before baking:

- **Missing Parameters**: Required parameters without default values must be provided
- **Type Validation**: String, Number, and Enum parameters are type-checked
- **Enum Validation**: Enum parameters must match one of the defined enum values
- **Default Values**: Parameters with default values are automatically applied if not specified

## Integration with Game Engines

The baked JSON files with parameters can be easily consumed by game engines:
