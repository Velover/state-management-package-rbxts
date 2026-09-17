import { useState } from "react";
import { fuzzySearchMultiField } from "../../../../Core/Utils/FuzzySearch.js";
import { behaviorTreeController } from "../../Controllers/BehaviorTreeController.js";
import { DEFAULT_NODES, NodeDefinition } from "../../Resources/NodeTypes.js";

interface NodePaletteProps {
  nodes: NodeDefinition[];
  onNodeDragStart: (
    event: React.DragEvent,
    nodeDefinition: NodeDefinition,
  ) => void;
}

function NodePalette({ nodes, onNodeDragStart }: NodePaletteProps) {
  const controller = behaviorTreeController;
  const customNodes = controller.useCustomNodes();
  const [searchTerm, setSearchTerm] = useState("");

  // Use fuzzy search with multiple fields
  const searchResults = fuzzySearchMultiField(
    nodes,
    searchTerm,
    {
      label: (node) => node.label,
      description: (node) => node.description ?? "",
      type: (node) => node.type,
      category: (node) => node.category,
    },
    1, // Minimum score threshold
  );

  const filteredNodes = searchTerm.trim()
    ? searchResults.map((result) => result.item)
    : nodes;

  // Group filtered nodes by what they inherit from
  const nodesByInheritance = filteredNodes.reduce(
    (acc, node) => {
      const inheritanceKey = node.inheritsFrom || node.category;
      if (!acc[inheritanceKey]) {
        acc[inheritanceKey] = [];
      }
      acc[inheritanceKey].push(node);
      return acc;
    },
    {} as Record<string, NodeDefinition[]>,
  );

  // Sort nodes alphabetically within each category
  Object.keys(nodesByInheritance).forEach((category) => {
    nodesByInheritance[category].sort((a, b) => a.label.localeCompare(b.label));
  });

  // Helper function to get inheritance color with depth limit
  const getInheritanceColorFromChain = (
    nodeType?: string,
    inheritsFrom?: string,
    depth = 0,
  ): string => {
    const maxDepth = 2;

    if (depth >= maxDepth) return "border-l-gray-500 bg-gray-50";

    if (!inheritsFrom && !nodeType) return "border-l-gray-500 bg-gray-50";

    const targetType = inheritsFrom || nodeType;

    switch (targetType) {
      case "Composite":
        return "border-l-blue-500 bg-blue-50";
      case "Node":
        return "border-l-green-500 bg-green-50";
      case "Decorator":
        return "border-l-orange-500 bg-orange-50";
      case "Tool":
        return "border-l-purple-500 bg-purple-50";
      default:
        const baseNode = DEFAULT_NODES.find((n) => n.type === targetType);
        if (baseNode && baseNode.inheritsFrom) {
          return getInheritanceColorFromChain(
            baseNode.type,
            baseNode.inheritsFrom,
            depth + 1,
          );
        }
        return "border-l-purple-500 bg-purple-50";
    }
  };

  const getInheritanceColor = (inheritance: string) => {
    return getInheritanceColorFromChain(inheritance);
  };

  const isCustomNode = (nodeId: string) => {
    return customNodes.some((customNode) => customNode.id === nodeId);
  };

  const handleDeleteCustomNode = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    controller.RemoveCustomNode(nodeId);
  };

  const handleEditCustomNode = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    controller.StartEditingCustomNode(nodeId);
  };

  // Get field matches for highlighting
  const getFieldMatches = (node: NodeDefinition) => {
    if (!searchTerm.trim()) return {};

    const result = searchResults.find((r) => r.item.id === node.id);
    return result?.fieldMatches || {};
  };

  return (
    <div className="w-64 h-full bg-white border-r border-gray-200 overflow-y-auto flex flex-col select-none">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Node Palette
        </h2>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {/* Search Icon */}
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <svg
              className="w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Clear Button */}
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute inset-y-0 right-7 flex items-center pr-1 text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Show message when no results */}
        {searchTerm.trim() && filteredNodes.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No nodes found for "{searchTerm}"
          </div>
        )}

        {/* Show results count when searching */}
        {searchTerm.trim() && filteredNodes.length > 0 && (
          <div className="text-xs text-gray-500 mb-3">
            {filteredNodes.length} node
            {filteredNodes.length !== 1 ? "s" : ""} found
          </div>
        )}

        {Object.entries(nodesByInheritance).map(
          ([inheritance, inheritanceNodes]) => (
            <div key={inheritance} className="mb-6">
              <h3 className="text-sm font-medium text-gray-600 mb-2">
                {inheritance}
              </h3>
              <div className="space-y-2">
                {inheritanceNodes.map((node) => {
                  const fieldMatches = getFieldMatches(node);

                  return (
                    <div
                      key={node.id}
                      draggable
                      onDragStart={(event) => onNodeDragStart(event, node)}
                      className={`p-3 border-l-4 rounded cursor-grab hover:shadow-md transition-shadow relative group select-none ${getInheritanceColor(
                        inheritance,
                      )}`}
                    >
                      <div className="text-sm font-medium text-gray-800 pointer-events-none">
                        {/* Highlight search term in node label */}
                        <FuzzyHighlightedText
                          text={node.label}
                          matches={fieldMatches.label?.matches ?? []}
                          hasMatch={!!fieldMatches.label?.score}
                        />
                      </div>
                      {node.description && (
                        <div className="text-xs text-gray-400 mt-1 pointer-events-none">
                          {/* Highlight search term in description */}
                          <FuzzyHighlightedText
                            text={node.description}
                            matches={fieldMatches.description?.matches ?? []}
                            hasMatch={!!fieldMatches.description?.score}
                          />
                        </div>
                      )}

                      {/* Action buttons for custom nodes */}
                      {isCustomNode(node.id) && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleEditCustomNode(e, node.id)}
                            className="w-5 h-5 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs flex items-center justify-center pointer-events-auto"
                            title="Edit custom node"
                          >
                            ✎
                          </button>
                          <button
                            onClick={(e) => handleDeleteCustomNode(e, node.id)}
                            className="w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center pointer-events-auto"
                            title="Delete custom node"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// Helper component to highlight fuzzy search matches
function FuzzyHighlightedText({
  text,
  matches,
  hasMatch,
}: {
  text: string;
  matches: number[];
  hasMatch: boolean;
}) {
  if (!hasMatch || matches.length === 0) {
    return <>{text}</>;
  }

  // Group consecutive matches into ranges
  const ranges: Array<{ start: number; end: number }> = [];
  let currentStart = matches[0];
  let currentEnd = matches[0];

  for (let i = 1; i < matches.length; i++) {
    const currentIndex = matches[i];

    // If current match is consecutive to the previous one, extend the range
    if (currentIndex === currentEnd + 1) {
      currentEnd = currentIndex;
    } else {
      // Save the current range and start a new one
      ranges.push({ start: currentStart, end: currentEnd });
      currentStart = currentIndex;
      currentEnd = currentIndex;
    }
  }

  // Don't forget the last range
  ranges.push({ start: currentStart, end: currentEnd });

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  ranges.forEach((range, i) => {
    // Add text before the highlighted range
    if (range.start > lastIndex) {
      parts.push(text.slice(lastIndex, range.start));
    }

    // Add the highlighted range as a single span
    parts.push(
      <mark key={`range-${i}`} className="bg-yellow-200 px-0.5 rounded">
        {text.slice(range.start, range.end + 1)}
      </mark>,
    );

    lastIndex = range.end + 1;
  });

  // Add remaining text after the last highlight
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export default NodePalette;
