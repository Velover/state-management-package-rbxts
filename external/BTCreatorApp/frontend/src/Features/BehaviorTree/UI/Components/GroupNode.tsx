import { NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";
import { behaviorTreeController } from "../../Controllers/BehaviorTreeController.js";
import type { BehaviorTreeNode } from "../../Resources/FlowModels.js";

function GroupNode({ data, selected, id }: NodeProps<BehaviorTreeNode>) {
  const controller = behaviorTreeController;
  const [localColor, setLocalColor] = useState(data.groupColor || "#3b82f6");

  const handleColorChange = (newColor: string) => {
    setLocalColor(newColor);
    controller.UpdateNodeData(id, {
      ...data,
      groupColor: newColor,
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow resizing and color picker interactions
    if (
      (e.target as HTMLElement).closest(".color-picker") ||
      (e.target as HTMLElement).closest(".react-flow__resize-control")
    ) {
      e.stopPropagation();
    }
  };

  // Convert hex to rgba with opacity
  const getBackgroundColor = () => {
    const hex = localColor.replace("#", "");
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, 0.1)`;
  };

  const getBorderColor = () => {
    const hex = localColor.replace("#", "");
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r}, ${g}, ${b}, 0.3)`;
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={100}
        minHeight={100}
        handleStyle={{
          backgroundColor: localColor,
          border: "2px solid white",
          borderRadius: "50%",
          width: "8px",
          height: "8px",
          zIndex: 1000, // Ensure resize handles are always visible
        }}
      />
      <div
        className="w-full h-full rounded-lg border-2 border-dashed relative"
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          minWidth: "200px",
          minHeight: "150px",
          zIndex: -1, // Always render below other nodes
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          className="absolute top-2 left-2 px-2 py-1 text-xs font-semibold rounded flex items-center gap-2"
          style={{
            backgroundColor: localColor,
            color: "white",
            zIndex: 1, // Render above the group background
          }}
        >
          <span>Group</span>
          <div className="color-picker">
            <input
              type="color"
              value={localColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-4 h-4 border-none rounded cursor-pointer"
              title="Change group color"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default GroupNode;
