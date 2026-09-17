import { useEffect, useRef, useState } from "react";
import { saveController } from "../../Controllers/SaveController.js";

const DropIcon = () => (
  <svg
    className="w-14 h-14"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const ClockIcon = () => (
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
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const FileIcon = () => (
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
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

export function WelcomeScreen() {
  const isLoading = saveController.useIsLoading();
  const recentFiles = saveController.useRecentFiles();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  // Close recent dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        recentDropdownRef.current &&
        !recentDropdownRef.current.contains(event.target as Node)
      ) {
        setIsRecentOpen(false);
      }
    }
    if (isRecentOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isRecentOpen]);

  const handleDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    if (!hasFiles) {
      // Text drag (path string) — allow HTML5 drop handling
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
    // For real file drags: skip preventDefault so HTML5 drop never fires;
    // Wails native OnFileDrop handles it with the absolute path instead.
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    // Only reached for text/plain path drops (real file drops are handled
    // by Wails native OnFileDrop → "file-dropped" event in SaveController)
    const text = e.dataTransfer.getData("text/plain").trim();
    if (!text) return;

    const lower = text.toLowerCase();
    if (lower.endsWith(".btsave")) {
      await saveController.LoadFromFile(text);
    } else if (lower.endsWith(".btbake")) {
      const { bakingController } =
        await import("../../Controllers/BakingController.js");
      await bakingController.ImportBakeFromPath(text);
    }
  };

  const handleOpen = async () => {
    await saveController.LoadFromFile();
  };

  const handleNew = () => {
    saveController.NewFile();
  };

  const handleOpenRecent = async (filePath: string) => {
    try {
      await saveController.LoadFromFile(filePath);
    } catch (error) {
      console.error("Failed to load recent file:", error);
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 gap-10">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold text-slate-100 tracking-tight">
          Behavior Tree Creator
        </h1>
        <p className="text-sm text-slate-400">
          Open an existing save or create a new one to get started
        </p>
      </div>

      {/* Drop zone */}
      <div
        style={{ "--wails-drop-target": "drop" } as React.CSSProperties}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`welcome-drop-zone w-80 h-44 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 transition-all duration-150 select-none ${
          isDragOver
            ? "border-blue-400 bg-blue-500/10 text-blue-300"
            : "border-slate-600 bg-slate-800/50 text-slate-500 hover:border-slate-500 hover:text-slate-400"
        }`}
      >
        <DropIcon />
        <div className="text-sm text-center leading-relaxed">
          <div className="font-medium">Drop a .btsave or .btbake file here</div>
          <div className="text-xs mt-1 opacity-70">or drag a file path</div>
        </div>
      </div>

      {/* Recent files dropdown */}
      {recentFiles.length > 0 && (
        <div className="w-80 relative" ref={recentDropdownRef}>
          <button
            onClick={() => setIsRecentOpen(!isRecentOpen)}
            disabled={isLoading}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <ClockIcon />
              <span>Recent Files</span>
            </div>
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${isRecentOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isRecentOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl z-50 max-h-48 overflow-y-auto">
              {recentFiles.map((filePath, index) => (
                <button
                  key={index}
                  onClick={() => {
                    handleOpenRecent(filePath);
                    setIsRecentOpen(false);
                  }}
                  disabled={isLoading}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors duration-150 text-slate-300 hover:bg-slate-700/50 hover:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed border-b border-slate-700/50 last:border-b-0"
                >
                  <FileIcon />
                  <span className="truncate" title={filePath}>
                    {saveController.GetRecentFileName(filePath)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-4">
        <button
          onClick={handleOpen}
          disabled={isLoading}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors duration-150 shadow-md"
        >
          Open from File
        </button>
        <button
          onClick={handleNew}
          disabled={isLoading}
          className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 text-sm font-medium rounded-lg transition-colors duration-150 shadow-md border border-slate-600"
        >
          Create New Save
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-slate-400 animate-pulse">Loading...</p>
      )}
    </div>
  );
}
