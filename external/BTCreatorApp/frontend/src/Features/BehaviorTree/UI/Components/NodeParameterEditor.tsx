import { useState, useEffect } from "react";
import { NodeParameter, ParameterType } from "../../Resources/NodeTypes.js";

interface NodeParameterEditorProps {
  parameters: NodeParameter[];
  values: Record<string, string | number>;
  onChange: (values: Record<string, string | number>) => void;
  disabled?: boolean;
}

function NodeParameterEditor({
  parameters,
  values,
  onChange,
  disabled = false,
}: NodeParameterEditorProps) {
  const [localValues, setLocalValues] = useState(values);
  const [hoveredParam, setHoveredParam] = useState<string | null>(null);

  useEffect(() => {
    setLocalValues(values);
  }, [values]);

  const handleValueChange = (paramName: string, value: string | number) => {
    const newValues = { ...localValues, [paramName]: value };
    setLocalValues(newValues);
    onChange(newValues);
  };

  const renderParameterInput = (param: NodeParameter) => {
    const currentValue = localValues[param.name] ?? param.defaultValue ?? "";

    const handleMouseDown = (e: React.MouseEvent) => {
      e.stopPropagation();
    };

    switch (param.type) {
      case ParameterType.String:
        return (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => handleValueChange(param.name, e.target.value)}
            onMouseDown={handleMouseDown}
            disabled={disabled}
            className={`w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              disabled ? "bg-gray-50 text-gray-400" : ""
            }`}
            placeholder={param.defaultValue?.toString() || ""}
          />
        );

      case ParameterType.Number:
        return (
          <input
            type="number"
            value={currentValue}
            onChange={(e) =>
              handleValueChange(param.name, parseFloat(e.target.value) || 0)
            }
            onMouseDown={handleMouseDown}
            disabled={disabled}
            className={`w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              disabled ? "bg-gray-50 text-gray-400" : ""
            }`}
            placeholder={param.defaultValue?.toString() || "0"}
          />
        );

      case ParameterType.Enum:
        return (
          <select
            value={currentValue}
            onChange={(e) => handleValueChange(param.name, e.target.value)}
            onMouseDown={handleMouseDown}
            disabled={disabled}
            className={`w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              disabled ? "bg-gray-50 text-gray-400" : ""
            }`}
          >
            {param.enumValues?.map((enumValue) => (
              <option key={enumValue} value={enumValue}>
                {enumValue}
              </option>
            ))}
          </select>
        );

      default:
        return null;
    }
  };

  if (parameters.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {parameters.map((param) => (
        <div
          key={param.name}
          className="space-y-1 relative"
          onMouseEnter={() => setHoveredParam(param.name)}
          onMouseLeave={() => setHoveredParam(null)}
        >
          <label
            className={`block text-xs font-medium ${
              disabled ? "text-gray-400" : "text-gray-600"
            }`}
          >
            {param.name}:
          </label>
          {renderParameterInput(param)}

          {/* Parameter description tooltip on hover */}
          {param.description && hoveredParam === param.name && (
            <div
              className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-800 rounded shadow-lg whitespace-nowrap ${
                disabled ? "opacity-80" : ""
              }`}
              style={{
                bottom: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                marginBottom: "4px",
              }}
            >
              {param.description}
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
        </div>
      ))}
    </div>
  );
}

export default NodeParameterEditor;
