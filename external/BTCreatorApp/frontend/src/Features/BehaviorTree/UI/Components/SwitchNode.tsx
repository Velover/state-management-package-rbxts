import { Handle, NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { behaviorTreeController } from "../../Controllers/BehaviorTreeController.js";
import { validationController } from "../../Controllers/ValidationController.js";
import type {
  BehaviorTreeNode,
  SwitchCase,
} from "../../Resources/FlowModels.js";
import { DEFAULT_NODES } from "../../Resources/NodeTypes.js";

function SwitchNode({ data, selected, id }: NodeProps<BehaviorTreeNode>) {
  const [isEditing, setIsEditing] = useState(false);
  const [newCaseName, setNewCaseName] = useState("");
  const [nameError, setNameError] = useState("");
  const [blackboardProperty, setBlackboardProperty] = useState(
    data.blackboardProperty || "",
  );
  const controller = behaviorTreeController;
  const inactiveNodes = validationController.useInactiveNodes();
  const isInactive = inactiveNodes.has(id);

  const switchCases = data.switchCases || [];
  const defaultCase = data.defaultCase;

  const validateCaseName = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Case name is required");
      return false;
    }
    if (switchCases.some((c) => c.name === trimmedName)) {
      setNameError("Case name already exists");
      return false;
    }
    setNameError("");
    return true;
  };

  const addCase = () => {
    if (!validateCaseName(newCaseName)) return;

    const newCase: SwitchCase = {
      id: `case-${Date.now()}`,
      name: newCaseName.trim(),
    };

    const updatedCases = [...switchCases, newCase];
    controller.UpdateNodeData(id, {
      ...data,
      switchCases: updatedCases,
    });

    setNewCaseName("");
    setNameError("");
  };

  const removeCase = (caseId: string) => {
    const updatedCases = switchCases.filter((c) => c.id !== caseId);
    controller.UpdateNodeData(id, {
      ...data,
      switchCases: updatedCases,
    });
  };

  const toggleDefault = () => {
    const hasDefault = !!defaultCase;
    controller.UpdateNodeData(id, {
      ...data,
      defaultCase: hasDefault ? undefined : `default-${Date.now()}`,
    });
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setNewCaseName(newName);
    if (newName.trim()) {
      validateCaseName(newName);
    } else {
      setNameError("");
    }
  };

  const updateBlackboardProperty = (value: string) => {
    setBlackboardProperty(value);
    controller.UpdateNodeData(id, {
      ...data,
      blackboardProperty: value.trim() || undefined,
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Helper function to get inheritance color with depth limit
  const getInheritanceColorFromChain = (
    nodeType?: string,
    inheritsFrom?: string,
    depth = 0,
  ): string => {
    const maxDepth = 2;

    if (depth >= maxDepth) return "bg-gray-500";

    if (!inheritsFrom && !nodeType) return "bg-gray-500";

    const targetType = inheritsFrom || nodeType;

    switch (targetType) {
      case "Composite":
        return "bg-blue-500";
      case "Node":
        return "bg-green-500";
      case "Decorator":
        return "bg-orange-500";
      case "Tool":
        return "bg-purple-500";
      default:
        const baseNode = DEFAULT_NODES.find((n) => n.type === targetType);
        if (baseNode && baseNode.inheritsFrom) {
          return getInheritanceColorFromChain(
            baseNode.type,
            baseNode.inheritsFrom,
            depth + 1,
          );
        }
        return "bg-gray-500";
    }
  };

  const headerColor = getInheritanceColorFromChain(
    data.nodeType,
    data.inheritsFrom,
  );

  return (
    <div
      className={`min-w-48 rounded-lg border-2 shadow-md relative ${
        selected ? "border-blue-500" : "border-gray-300"
      } ${isInactive ? "bg-gray-100 opacity-80" : "bg-white"}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`w-3 h-3 ${isInactive ? "opacity-80" : ""}`}
      />

      <div
        className={`px-3 py-1 text-xs font-semibold text-white rounded-t-md ${headerColor} ${
          isInactive ? "opacity-80" : ""
        }`}
      >
        {data.inheritsFrom || "Node"}
      </div>

      <div className="p-3">
        <div
          className={`text-sm font-medium mb-2 ${
            isInactive ? "text-gray-500" : "text-green-700"
          }`}
        >
          {data.label}
        </div>

        {/* Blackboard Property Input */}
        <div className="mb-3">
          <label
            className={`block text-xs font-medium mb-1 ${
              isInactive ? "text-gray-400" : "text-gray-600"
            }`}
          >
            Field / Selector:
          </label>
          <input
            type="text"
            value={blackboardProperty}
            onChange={(e) => updateBlackboardProperty(e.target.value)}
            onMouseDown={handleMouseDown}
            placeholder="registered field or selector name"
            disabled={isInactive}
            className={`w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              isInactive ? "bg-gray-50 text-gray-400" : ""
            }`}
          />
        </div>

        <div className="space-y-2">
          {switchCases.map((switchCase, index) => (
            <div
              key={switchCase.id}
              className="flex items-center justify-between text-xs py-1 relative"
            >
              <span className={isInactive ? "text-gray-400" : "text-gray-600"}>
                Case: {switchCase.name}
              </span>
              <button
                onClick={() => removeCase(switchCase.id)}
                disabled={isInactive}
                className={`hover:text-red-700 z-10 ${
                  isInactive
                    ? "text-gray-400 cursor-not-allowed"
                    : "text-red-500"
                }`}
              >
                ×
              </button>
              <Handle
                type="source"
                position={Position.Right}
                id={`case-${index}`}
                className={`w-2 h-2 ${isInactive ? "opacity-80" : ""}`}
                style={{
                  position: "absolute",
                  right: "-15px",
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              />
            </div>
          ))}

          {defaultCase && (
            <div className="flex items-center justify-between text-xs py-1 relative">
              <span className={isInactive ? "text-gray-400" : "text-gray-600"}>
                Default
              </span>
              <button
                onClick={toggleDefault}
                disabled={isInactive}
                className={`hover:text-red-700 z-10 ${
                  isInactive
                    ? "text-gray-400 cursor-not-allowed"
                    : "text-red-500"
                }`}
              >
                ×
              </button>
              <Handle
                type="source"
                position={Position.Right}
                id="default"
                className={`w-2 h-2 ${isInactive ? "opacity-80" : ""}`}
                style={{
                  position: "absolute",
                  right: "-15px",
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              />
            </div>
          )}
        </div>

        {isEditing && !isInactive ? (
          <div className="mt-2 space-y-2">
            <div className="flex gap-1">
              <div className="flex-1">
                <input
                  type="text"
                  value={newCaseName}
                  onChange={handleNameChange}
                  onMouseDown={handleMouseDown}
                  placeholder="Case name"
                  className={`w-full text-xs px-2 py-1 border rounded ${
                    nameError ? "border-red-500" : "border-gray-300"
                  }`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCase();
                    if (e.key === "Escape") setIsEditing(false);
                  }}
                  autoFocus
                />
                {nameError && (
                  <p className="text-red-500 text-xs mt-1">{nameError}</p>
                )}
              </div>
              <button
                onClick={addCase}
                disabled={!!nameError || !newCaseName.trim()}
                className="text-xs px-2 py-1 bg-blue-500 text-white rounded disabled:bg-gray-300"
              >
                Add
              </button>
            </div>
            <div className="flex gap-1">
              {!defaultCase && (
                <button
                  onClick={toggleDefault}
                  className="text-xs px-2 py-1 bg-gray-500 text-white rounded"
                >
                  Add Default
                </button>
              )}
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            disabled={isInactive}
            className={`mt-2 text-xs px-2 py-1 rounded w-full ${
              isInactive
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            {isInactive ? "Inactive" : "Edit Cases"}
          </button>
        )}
      </div>
    </div>
  );
}

export default SwitchNode;
