import { NodeProps, NodeResizer } from "@xyflow/react";
import { useState } from "react";
import { behaviorTreeController } from "../../Controllers/BehaviorTreeController.js";
import type { BehaviorTreeNode } from "../../Resources/FlowModels.js";

function NoteNode({ data, selected, id }: NodeProps<BehaviorTreeNode>) {
  const controller = behaviorTreeController;
  const [isEditing, setIsEditing] = useState(false);
  const [localText, setLocalText] = useState(
    data.noteText || "Click to edit note...",
  );
  const [localSize, setLocalSize] = useState(data.noteSize || 16);
  const [sizeInput, setSizeInput] = useState(localSize.toString());

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing || (e.target as HTMLElement).closest(".note-controls")) {
      e.stopPropagation();
    }
  };

  const handleTextChange = (newText: string) => {
    setLocalText(newText);
    controller.UpdateNodeData(id, {
      ...data,
      noteText: newText,
    });
  };

  const handleSizeChange = (newSize: number) => {
    const clampedSize = Math.max(5, Math.min(1000, newSize));
    setLocalSize(clampedSize);
    setSizeInput(clampedSize.toString());
    controller.UpdateNodeData(id, {
      ...data,
      noteSize: clampedSize,
    });
  };

  const handleSizeInputChange = (value: string) => {
    setSizeInput(value);
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 5 && numValue <= 1000) {
      handleSizeChange(numValue);
    }
  };

  const handleSizeInputBlur = () => {
    const numValue = parseInt(sizeInput);
    if (isNaN(numValue) || numValue < 5 || numValue > 1000) {
      // Reset to current valid size if invalid input
      setSizeInput(localSize.toString());
    }
  };

  const handleSizeInputKeyDown = (e: React.KeyboardEvent) => {
    // Prevent arrow keys from triggering increment/decrement
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
    }
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Calculate stroke size proportionally to font size
  const getStrokeSize = () => {
    // Base stroke size for 16px font, scale proportionally
    const baseStrokeSize = 1;
    const baseFontSize = 16;
    return Math.max(1, Math.round((localSize / baseFontSize) * baseStrokeSize));
  };

  const getTextStrokeStyle = () => {
    const strokeSize = getStrokeSize();
    return {
      fontSize: `${localSize}px`,
      fontFamily: "Inter, sans-serif",
      fontWeight: "800",
      color: "white",
      WebkitTextStroke: `${strokeSize}px black`,
      paintOrder: "stroke fill",
      textStroke: `${strokeSize}px black`,
    };
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={100}
        minHeight={60}
        handleStyle={{
          backgroundColor: "white",
          border: "2px solid black",
          borderRadius: "50%",
          width: "8px",
          height: "8px",
          zIndex: 1000,
        }}
      />
      <div
        className="w-full h-full bg-transparent relative overflow-hidden"
        style={{
          minWidth: "150px",
          minHeight: "60px",
          zIndex: 100, // Always above other nodes
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Size controls in top-right corner */}
        <div className="note-controls absolute top-2 right-2 flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity z-10">
          <input
            type="text"
            value={sizeInput}
            onChange={(e) => handleSizeInputChange(e.target.value)}
            onBlur={handleSizeInputBlur}
            onKeyDown={handleSizeInputKeyDown}
            className="w-12 text-xs bg-black text-white border border-white outline-none rounded px-1 text-center"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="text-xs text-white bg-black px-1 rounded border border-white">
            px
          </span>
        </div>

        <div className="w-full h-full p-2 overflow-hidden">
          {isEditing ? (
            <textarea
              value={localText}
              onChange={(e) => handleTextChange(e.target.value)}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsEditing(false);
                }
              }}
              className="w-full h-full bg-transparent border-none outline-none resize-none text-white placeholder-gray-300"
              style={getTextStrokeStyle()}
              placeholder="Enter your note text..."
              autoFocus
            />
          ) : (
            <div
              onClick={() => setIsEditing(true)}
              className="cursor-text text-white w-full h-full overflow-hidden"
              style={{
                ...getTextStrokeStyle(),
                wordWrap: "break-word",
                overflowWrap: "break-word",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 10, // Limit to reasonable number of lines
                WebkitBoxOrient: "vertical",
              }}
            >
              {localText || "Click to edit note..."}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default NoteNode;
