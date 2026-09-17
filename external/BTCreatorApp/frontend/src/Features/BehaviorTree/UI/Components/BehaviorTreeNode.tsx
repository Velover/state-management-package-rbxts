import { Handle, NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { validationController } from "../../Controllers/ValidationController.js";
import { behaviorTreeController } from "../../Controllers/BehaviorTreeController.js";
import type { BehaviorTreeNode } from "../../Resources/FlowModels.js";
import {
  DEFAULT_NODES,
  getValidationRules,
} from "../../Resources/NodeTypes.js";
import NodeParameterEditor from "./NodeParameterEditor.js";

function BehaviorTreeNode({ data, selected, id }: NodeProps<BehaviorTreeNode>) {
  const [isHovered, setIsHovered] = useState(false);
  const inactiveNodes = validationController.useInactiveNodes();
  const isInactive = inactiveNodes.has(id);

  const rules = getValidationRules(data.nodeType, data.inheritsFrom);
  const canHaveChildren =
    rules.maxChildren === undefined || rules.maxChildren > 0;
  const isEntryPoint = data.nodeType === "EntryPoint";

  // Get node definition to access parameters
  const nodeDefinition = data.isCustom
    ? behaviorTreeController
        .useCustomNodes()
        .find((cn) => cn.name === data.customName)
    : DEFAULT_NODES.find((node) => node.type === data.nodeType);

  const parameters = nodeDefinition?.parameters || [];

  const handleParameterChange = (values: Record<string, string | number>) => {
    behaviorTreeController.UpdateNodeData(id, {
      ...data,
      parameters: values,
    });
  };

  // Helper function to get the inheritance color with depth limit
  const getInheritanceColorFromChain = (
    nodeType?: string,
    inheritsFrom?: string,
    depth = 0,
  ): string => {
    const maxDepth = 2; // Limit to prevent deep chains like "Condition" -> "Decorator" -> "Node"

    if (depth >= maxDepth) return "bg-gray-500";

    if (!inheritsFrom && !nodeType) return "bg-gray-500";

    // First check the direct inheritance
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
        // If not a base type, look up the inheritance chain
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

  const getInheritanceTextColorFromChain = (
    nodeType?: string,
    inheritsFrom?: string,
    depth = 0,
  ): string => {
    const maxDepth = 2;

    if (depth >= maxDepth) return "text-gray-700";

    if (!inheritsFrom && !nodeType) return "text-gray-700";

    const targetType = inheritsFrom || nodeType;

    switch (targetType) {
      case "Composite":
        return "text-blue-700";
      case "Node":
        return "text-green-700";
      case "Decorator":
        return "text-orange-700";
      case "Tool":
        return "text-purple-700";
      default:
        const baseNode = DEFAULT_NODES.find((n) => n.type === targetType);
        if (baseNode && baseNode.inheritsFrom) {
          return getInheritanceTextColorFromChain(
            baseNode.type,
            baseNode.inheritsFrom,
            depth + 1,
          );
        }
        return "text-gray-700";
    }
  };

  const headerColor = getInheritanceColorFromChain(
    data.nodeType,
    data.inheritsFrom,
  );
  const textColor = getInheritanceTextColorFromChain(
    data.nodeType,
    data.inheritsFrom,
  );

  return (
    <div
      className={`min-w-32 rounded-lg border-2 shadow-md relative ${
        selected ? "border-blue-500" : "border-gray-300"
      } ${isInactive ? "bg-gray-100 opacity-80" : "bg-white"}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Entry Point nodes don't have top handle */}
      {!isEntryPoint && (
        <Handle
          type="target"
          position={Position.Top}
          className={`w-3 h-3 ${isInactive ? "opacity-80" : ""}`}
        />
      )}

      <div
        className={`px-3 py-1 text-xs font-semibold text-white rounded-t-md ${headerColor} ${
          isInactive ? "opacity-80" : ""
        }`}
      >
        {data.inheritsFrom || data.category}
      </div>

      <div className="p-3">
        <div
          className={`text-sm font-medium ${textColor} ${
            isInactive ? "text-gray-500 opacity-80" : ""
          }`}
        >
          {data.label}
        </div>

        {/* Description tooltip on hover */}
        {data.description && isHovered && (
          <div
            className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg whitespace-nowrap ${
              isInactive ? "opacity-80" : ""
            }`}
            style={{
              bottom: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              marginBottom: "4px",
            }}
          >
            {data.description}
            <div
              className="absolute w-2 h-2 bg-gray-800 rotate-45"
              style={{
                bottom: "-4px",
                left: "50%",
                transform: "translateX(-50%)",
              }}
            />
          </div>
        )}

        {/* Parameters Editor */}
        {parameters.length > 0 && (
          <div className="mt-3">
            <NodeParameterEditor
              parameters={parameters}
              values={data.parameters || {}}
              onChange={handleParameterChange}
              disabled={isInactive}
            />
          </div>
        )}
      </div>

      {canHaveChildren && (
        <Handle
          type="source"
          position={Position.Bottom}
          className={`w-3 h-3 ${isInactive ? "opacity-80" : ""}`}
        />
      )}
    </div>
  );
}

export default BehaviorTreeNode;
