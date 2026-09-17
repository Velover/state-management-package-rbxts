import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MiniMap,
  NodeChange,
  NodeTypes,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { behaviorTreeController } from "../Controllers/BehaviorTreeController.js";
import { saveController } from "../Controllers/SaveController.js";
import { undoRedoController } from "../Controllers/UndoRedoController.js";
import { validationController } from "../Controllers/ValidationController.js";
import {
  BehaviorTreeNode as BTNode,
  CustomNodeDefinition,
} from "../Resources/FlowModels.js";
import { NodeDefinition } from "../Resources/NodeTypes.js";
import BehaviorTreeNode from "./Components/BehaviorTreeNode.js";
import CustomNodeCreator from "./Components/CustomNodeCreator.js";
import GroupNode from "./Components/GroupNode.js";
import NodePalette from "./Components/NodePalette.js";
import NoteNode from "./Components/NoteNode.js";
import SwitchNode from "./Components/SwitchNode.js";
import { TopBar } from "./Components/TopBar.js";
import { WelcomeScreen } from "./Components/WelcomeScreen.js";

const nodeTypes: NodeTypes = {
  behaviorTreeNode: BehaviorTreeNode,
  switchNode: SwitchNode,
  noteNode: NoteNode,
  groupNode: GroupNode,
};

function BehaviorTreeEditor() {
  const controller = behaviorTreeController;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [isCustomNodeCreatorOpen, setIsCustomNodeCreatorOpen] = useState(false);
  const dragStartState = useRef<ReturnType<
    typeof controller.CaptureState
  > | null>(null);

  const nodes = controller.useNodes();
  const edges = controller.useEdges();
  const availableNodes = controller.useAvailableNodes();
  const validationResult = validationController.useValidationResult();
  const editingCustomNode = controller.useEditingCustomNode();

  const [localNodes, setLocalNodes, onNodesChange] = useNodesState(nodes);
  const [localEdges, setLocalEdges, onEdgesChange] = useEdgesState(edges);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undoRedoController.Undo();
      } else if (
        ((event.ctrlKey || event.metaKey) && event.key === "y") ||
        ((event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key === "z")
      ) {
        event.preventDefault();
        undoRedoController.Redo();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        saveController.Save();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undoRedoController]);

  // Update local state when controller state changes
  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes, setLocalNodes]);

  useEffect(() => {
    setLocalEdges(edges);
  }, [edges, setLocalEdges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      // Validate connection before allowing it (includes cycle detection)
      if (
        params.source &&
        params.target &&
        !validationController.CanConnect(params.source, params.target)
      ) {
        console.warn(
          "Invalid connection attempted (would create cycle or exceed limits)",
        );
        return;
      }

      controller.ExecuteCommand("Connect Nodes", () => {
        const newEdges = addEdge(params, controller.GetCurrentEdgesAtom());
        controller.SetEdges(newEdges);
      });

      // Validate tree after connection to update inactive nodes
      setTimeout(() => validationController.ValidateTree(), 100);
    },
    [controller, validationController],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const react_flow_data = event.dataTransfer.getData(
        "application/reactflow",
      );
      if (react_flow_data === "") return;
      const nodeDefinition = JSON.parse(react_flow_data) as NodeDefinition;

      if (!reactFlowInstance || !reactFlowWrapper.current) {
        return;
      }

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      controller.AddNode(nodeDefinition, position);
    },
    [reactFlowInstance, controller],
  );

  const onPaletteDragStart = useCallback(
    (event: React.DragEvent, nodeDefinition: NodeDefinition) => {
      event.dataTransfer.setData(
        "application/reactflow",
        JSON.stringify(nodeDefinition),
      );
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const onCreateCustomNode = useCallback(
    (customNode: CustomNodeDefinition) => {
      controller.AddCustomNode(customNode);
    },
    [controller],
  );

  const onUpdateCustomNode = useCallback(
    (nodeId: string, updatedNode: CustomNodeDefinition) => {
      controller.UpdateCustomNode(nodeId, updatedNode);
    },
    [controller],
  );

  const handleCloseCustomNodeCreator = () => {
    setIsCustomNodeCreatorOpen(false);
    controller.StopEditingCustomNode();
  };

  // Open creator when editing starts
  useEffect(() => {
    if (editingCustomNode) {
      setIsCustomNodeCreatorOpen(true);
    }
  }, [editingCustomNode]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Capture state before remove operations
      const hasRemoves = changes.some((c) => c.type === "remove");
      const hasDimensionOrPosition = changes.some(
        (c) => c.type === "dimensions" || c.type === "position",
      );

      if (hasRemoves) {
        controller.ExecuteCommand("Remove Nodes", () => {
          const updatedNodes = applyNodeChanges(
            changes,
            controller.GetCurrentNodesAtom(),
          );
          controller.SetNodes(updatedNodes as BTNode[]);
        });
      } else if (hasDimensionOrPosition) {
        // Position/dimension changes: apply locally, defer command until drag ends
        const updatedNodes = applyNodeChanges(changes, localNodes);
        setLocalNodes(updatedNodes as BTNode[]);
        controller.SetNodes(updatedNodes as BTNode[]);
      } else {
        // Other changes (selection, etc): apply without undo tracking
        const updatedNodes = applyNodeChanges(changes, localNodes);
        setLocalNodes(updatedNodes as BTNode[]);
        controller.SetNodes(updatedNodes as BTNode[]);
      }
    },
    [localNodes, setLocalNodes, controller],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const hasRemoves = changes.some((c) => c.type === "remove");

      if (hasRemoves) {
        controller.ExecuteCommand("Remove Edges", () => {
          const updatedEdges = applyEdgeChanges(
            changes,
            controller.GetCurrentEdgesAtom(),
          );
          controller.SetEdges(updatedEdges);
        });
      } else {
        const updatedEdges = applyEdgeChanges(changes, localEdges);
        setLocalEdges(updatedEdges);
        controller.SetEdges(updatedEdges);
      }
    },
    [localEdges, setLocalEdges, controller],
  );

  const onNodeDragStart = useCallback(() => {
    dragStartState.current = controller.CaptureState();
  }, [controller]);

  const onNodeDragStop = useCallback(() => {
    if (dragStartState.current) {
      controller.PushStateCommand(dragStartState.current, "Move Nodes");
      dragStartState.current = null;
    }
  }, [controller]);

  useEffect(() => {
    // Validate tree when nodes or edges change
    const timer = setTimeout(() => {
      validationController.ValidateTree();
    }, 300);

    return () => clearTimeout(timer);
  }, [localNodes, localEdges, validationController]);

  return (
    <div className="flex flex-col h-full">
      <TopBar />

      {/* Error banner */}
      {!validationResult.isValid && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <div className="text-red-800 text-sm font-medium">
            Validation Errors: {validationResult.errors.length}
          </div>
          <div className="text-red-600 text-xs mt-1">
            {validationResult.errors.slice(0, 3).map((error, index) => (
              <div key={index}>
                • {error.message}
                {error.type === "cyclic_dependency" && " (Cycle detected)"}
              </div>
            ))}
            {validationResult.errors.length > 3 && (
              <div>• ... and {validationResult.errors.length - 3} more</div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <NodePalette
          nodes={availableNodes}
          onNodeDragStart={onPaletteDragStart}
        />

        <div className="flex-1 relative min-w-0">
          <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
            <button
              onClick={() => setIsCustomNodeCreatorOpen(true)}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 shadow-md"
            >
              Create Custom Node
            </button>
          </div>

          <div ref={reactFlowWrapper} className="w-full h-full">
            <ReactFlow
              nodes={localNodes}
              edges={localEdges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              minZoom={0.01}
              onDragOver={onDragOver}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              nodeTypes={nodeTypes}
              fitView
            >
              <Controls />
              <MiniMap />
              <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            </ReactFlow>
          </div>
        </div>
      </div>

      <CustomNodeCreator
        isOpen={isCustomNodeCreatorOpen || !!editingCustomNode}
        onClose={handleCloseCustomNodeCreator}
        onCreateNode={onCreateCustomNode}
        onUpdateNode={onUpdateCustomNode}
        existingNames={controller.GetAllNodeNames()}
        editingNode={editingCustomNode}
      />
    </div>
  );
}

export default function BehaviorTreeEditorWrapper() {
  const isEditing = saveController.useIsEditing();

  if (!isEditing) {
    return <WelcomeScreen />;
  }

  return (
    <ReactFlowProvider>
      <BehaviorTreeEditor />
    </ReactFlowProvider>
  );
}
