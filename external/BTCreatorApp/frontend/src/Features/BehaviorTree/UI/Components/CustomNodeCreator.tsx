import { useState, useEffect } from "react";
import { CustomNodeDefinition } from "../../Resources/FlowModels.js";
import {
  DEFAULT_NODES,
  NodeCategory,
  NodeParameter,
  ParameterType,
} from "../../Resources/NodeTypes.js";

interface CustomNodeCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateNode: (node: CustomNodeDefinition) => void;
  onUpdateNode?: (nodeId: string, updatedNode: CustomNodeDefinition) => void;
  existingNames: string[];
  editingNode?: CustomNodeDefinition | null;
}

function CustomNodeCreator({
  isOpen,
  onClose,
  onCreateNode,
  onUpdateNode,
  existingNames,
  editingNode,
}: CustomNodeCreatorProps) {
  const [name, setName] = useState("");
  const [inheritsFrom, setInheritsFrom] = useState(NodeCategory.Node as string);
  const [description, setDescription] = useState("");
  const [parameters, setParameters] = useState<NodeParameter[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameError, setNameError] = useState("");
  const [enumInputValues, setEnumInputValues] = useState<
    Record<number, string>
  >({});

  const isEditing = !!editingNode;
  const abstractNodes = DEFAULT_NODES.filter((node) => node.isAbstract);

  // Load editing data when component opens for editing
  useEffect(() => {
    if (isOpen && editingNode) {
      setName(editingNode.name);
      setInheritsFrom(editingNode.inheritsFrom);
      setDescription(editingNode.description || "");
      setParameters(editingNode.parameters || []);

      // Initialize enum input values
      const enumInputs: Record<number, string> = {};
      editingNode.parameters?.forEach((param, index) => {
        if (param.type === ParameterType.Enum && param.enumValues) {
          enumInputs[index] = param.enumValues.join(", ");
        }
      });
      setEnumInputValues(enumInputs);
    } else if (isOpen && !editingNode) {
      // Reset to defaults when creating new node
      setInheritsFrom(NodeCategory.Node as string);
    }
  }, [isOpen, editingNode]);

  const validateName = (newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return false;
    }

    // When editing, allow the current name
    const filteredNames = isEditing
      ? existingNames.filter((name) => name !== editingNode?.name)
      : existingNames;

    if (filteredNames.includes(trimmedName)) {
      setNameError("A node with this name already exists");
      return false;
    }
    setNameError("");
    return true;
  };

  const addParameter = () => {
    const newParam: NodeParameter = {
      name: "",
      type: ParameterType.String,
      defaultValue: "",
    };
    setParameters([...parameters, newParam]);
  };

  const updateParameter = (
    index: number,
    field: keyof NodeParameter,
    value: any
  ) => {
    const updatedParams = [...parameters];
    const currentParam = { ...updatedParams[index] };

    // Handle type changes specially
    if (field === "type") {
      const oldType = currentParam.type;
      const newType = value as ParameterType;
      currentParam.type = newType;

      // Clear enum-specific properties when switching away from enum
      if (newType !== ParameterType.Enum) {
        currentParam.enumValues = undefined;
        setEnumInputValues((prev) => {
          const newValues = { ...prev };
          delete newValues[index];
          return newValues;
        });
      }

      // Handle default value conversion when changing types
      if (oldType !== newType && currentParam.defaultValue !== undefined) {
        if (newType === ParameterType.Number) {
          const numValue = Number(currentParam.defaultValue);
          currentParam.defaultValue = isNaN(numValue) ? 0 : numValue;
        } else if (newType === ParameterType.String) {
          currentParam.defaultValue = String(currentParam.defaultValue);
        } else if (newType === ParameterType.Enum) {
          currentParam.defaultValue = "";
          currentParam.enumValues = [];
        }
      }

      // Set default values for new parameters
      if (currentParam.defaultValue === undefined) {
        if (newType === ParameterType.Number) {
          currentParam.defaultValue = 0;
        } else if (newType === ParameterType.String) {
          currentParam.defaultValue = "";
        } else if (newType === ParameterType.Enum) {
          currentParam.defaultValue = "";
          currentParam.enumValues = [];
        }
      }
    } else {
      (currentParam as any)[field] = value;
    }

    updatedParams[index] = currentParam;
    setParameters(updatedParams);
  };

  const handleEnumInputChange = (index: number, value: string) => {
    setEnumInputValues((prev) => ({ ...prev, [index]: value }));
  };

  const handleEnumInputBlur = (index: number) => {
    const inputValue = enumInputValues[index] || "";
    const enumValues = inputValue
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v); // Remove empty strings

    updateParameter(index, "enumValues", [...new Set(enumValues)]);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
    // Clean up enum input value for this index
    setEnumInputValues((prev) => {
      const newValues = { ...prev };
      delete newValues[index];
      return newValues;
    });
  };

  const validateParameters = (): boolean => {
    const names = parameters.map((p) => p.name.trim()).filter((n) => n);
    const uniqueNames = new Set(names);

    // Check for duplicate parameter names
    const hasValidNames =
      names.length === uniqueNames.size &&
      names.length === parameters.filter((p) => p.name.trim()).length;

    // Check that enum parameters have at least one value
    const hasValidEnums = parameters.every((param) => {
      if (param.type === ParameterType.Enum) {
        return param.enumValues && param.enumValues.length > 0;
      }
      return true;
    });

    return hasValidNames && hasValidEnums;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !validateName(name) ||
      !inheritsFrom ||
      !validateParameters() ||
      isSubmitting
    )
      return;

    setIsSubmitting(true);

    try {
      const nodeData: CustomNodeDefinition = {
        id: editingNode?.id || `custom-${Date.now()}`,
        name: name.trim(),
        inheritsFrom,
        description: description.trim() || undefined,
        parameters: parameters.filter((p) => p.name.trim()),
      };

      if (isEditing && onUpdateNode) {
        onUpdateNode(editingNode!.id, nodeData);
      } else {
        onCreateNode(nodeData);
      }

      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setName("");
    setInheritsFrom(NodeCategory.Node as string); // Reset to default
    setDescription("");
    setParameters([]);
    setEnumInputValues({});
    setNameError("");
    onClose();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    if (newName.trim()) {
      validateName(newName);
    } else {
      setNameError("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[600px] max-w-full max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4">
          {isEditing ? "Edit Custom Node" : "Create Custom Node"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Node Name
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                nameError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="Enter node name"
              required
            />
            {nameError && (
              <p className="text-red-500 text-xs mt-1">{nameError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Inherits From
            </label>
            <select
              value={inheritsFrom}
              onChange={(e) => setInheritsFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select abstract node...</option>
              {abstractNodes.map((node) => (
                <option key={node.id} value={node.type}>
                  {node.label}
                </option>
              ))}
            </select>
            {isEditing && editingNode?.inheritsFrom !== inheritsFrom && (
              <p className="text-amber-600 text-xs mt-1">
                ⚠️ Changing inheritance may remove invalid connections from
                existing nodes
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter node description (optional)"
              rows={3}
            />
          </div>

          {/* Parameters Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Parameters
              </label>
              <button
                type="button"
                onClick={addParameter}
                className="text-sm px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Add Parameter
              </button>
            </div>

            {parameters.map((param, index) => (
              <div
                key={index}
                className="border border-gray-200 rounded p-3 mb-2"
              >
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Parameter name"
                    value={param.name}
                    onChange={(e) =>
                      updateParameter(index, "name", e.target.value)
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                  <select
                    value={param.type}
                    onChange={(e) => {
                      updateParameter(
                        index,
                        "type",
                        e.target.value as ParameterType
                      );
                    }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value={ParameterType.String}>String</option>
                    <option value={ParameterType.Number}>Number</option>
                    <option value={ParameterType.Enum}>Enum</option>
                  </select>
                </div>

                {param.type === ParameterType.Enum && (
                  <div className="mb-2">
                    <input
                      type="text"
                      placeholder="Enum values (comma-separated)"
                      value={
                        enumInputValues[index] ??
                        param.enumValues?.join(", ") ??
                        ""
                      }
                      onChange={(e) =>
                        handleEnumInputChange(index, e.target.value)
                      }
                      onBlur={() => handleEnumInputBlur(index)}
                      className={`w-full border rounded px-2 py-1 text-sm ${
                        param.enumValues && param.enumValues.length === 0
                          ? "border-red-500"
                          : "border-gray-300"
                      }`}
                    />
                    {param.enumValues && param.enumValues.length === 0 && (
                      <p className="text-red-500 text-xs mt-1">
                        Enum parameters must have at least one value
                      </p>
                    )}
                    {param.enumValues && param.enumValues.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        Values: {param.enumValues.join(", ")}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mb-2">
                  <input
                    type={
                      param.type === ParameterType.Number ? "number" : "text"
                    }
                    placeholder="Default value"
                    value={param.defaultValue ?? ""}
                    onChange={(e) => {
                      let value: string | number;
                      if (param.type === ParameterType.Number) {
                        // Allow empty string for clearing the field, but convert to number for storage
                        const inputValue = e.target.value;
                        if (inputValue === "") {
                          value = 0; // Use 0 as default when field is empty
                        } else {
                          const numValue = parseFloat(inputValue);
                          value = isNaN(numValue) ? 0 : numValue;
                        }
                      } else {
                        value = e.target.value;
                      }
                      updateParameter(index, "defaultValue", value);
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeParameter(index)}
                    className="text-red-500 hover:text-red-700 px-2"
                  >
                    ×
                  </button>
                </div>

                {/* Parameter Description */}
                <input
                  type="text"
                  placeholder="Parameter description (optional)"
                  value={param.description || ""}
                  onChange={(e) =>
                    updateParameter(index, "description", e.target.value)
                  }
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !name.trim() ||
                !inheritsFrom ||
                !!nameError ||
                !validateParameters()
              }
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? isEditing
                  ? "Updating..."
                  : "Creating..."
                : isEditing
                ? "Update Node"
                : "Create Node"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CustomNodeCreator;
