import { useEffect, useRef, useState } from "react";
import { bakingController } from "../../Controllers/BakingController.js";
import { saveController } from "../../Controllers/SaveController.js";
import { undoRedoController } from "../../Controllers/UndoRedoController.js";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function DropdownMenu({
  trigger,
  children,
  isOpen,
  onToggle,
  onClose,
}: DropdownMenuProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div onClick={onToggle}>{trigger}</div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-48 py-1 animate-in fade-in duration-150">
          {children}
        </div>
      )}
    </div>
  );
}

interface SubMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function SubMenu({
  trigger,
  children,
  isOpen,
  onToggle,
  onClose,
}: SubMenuProps) {
  const subMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        subMenuRef.current &&
        !subMenuRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={subMenuRef}>
      <div
        onMouseEnter={() => onToggle()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {trigger}
      </div>

      {isOpen && (
        <div className="absolute left-full top-0 ml-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-56 py-1 animate-in fade-in duration-150 max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

function MenuItem({
  children,
  onClick,
  disabled = false,
  icon,
}: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors duration-150 ${
        disabled
          ? "text-gray-400 cursor-not-allowed"
          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <span className="w-4 h-4 flex items-center justify-center">
            {icon}
          </span>
        )}
        <span>{children}</span>
      </div>
    </button>
  );
}

interface MenuItemWithSubMenuProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  subMenuContent: React.ReactNode;
  isSubMenuOpen: boolean;
  onSubMenuToggle: () => void;
  onSubMenuClose: () => void;
}

function MenuItemWithSubMenu({
  children,
  icon,
  subMenuContent,
  isSubMenuOpen,
  onSubMenuToggle,
  onSubMenuClose,
}: MenuItemWithSubMenuProps) {
  return (
    <SubMenu
      trigger={
        <button
          className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors duration-150 ${
            isSubMenuOpen
              ? "bg-gray-50 text-gray-900"
              : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          }`}
        >
          <div className="flex items-center gap-3">
            {icon && (
              <span className="w-4 h-4 flex items-center justify-center">
                {icon}
              </span>
            )}
            <span>{children}</span>
          </div>
          <svg
            className="w-3 h-3 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      }
      isOpen={isSubMenuOpen}
      onToggle={onSubMenuToggle}
      onClose={onSubMenuClose}
    >
      {subMenuContent}
    </SubMenu>
  );
}

function MenuSeparator() {
  return <div className="border-t border-gray-100 my-1" />;
}

// Icons as simple SVGs
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

const SaveIcon = () => (
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
      d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
    />
  </svg>
);

const FolderIcon = () => (
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
      d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
    />
  </svg>
);

const CloseIcon = () => (
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

export function TopBar() {
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [isRecentMenuOpen, setIsRecentMenuOpen] = useState(false);

  const currentFileName = saveController.useCurrentFileName();
  const recentFiles = saveController.useRecentFiles();
  const isBaking = bakingController.useIsBaking();
  const isBakingToClipboard = bakingController.useIsBakingToClipboard();
  const canBake = bakingController.CanBake();
  const canUndo = undoRedoController.useCanUndo();
  const canRedo = undoRedoController.useCanRedo();

  const handleFileMenuToggle = () => {
    setIsFileMenuOpen(!isFileMenuOpen);
  };

  const handleFileMenuClose = () => {
    setIsFileMenuOpen(false);
  };

  const handleNew = async () => {
    const canProceed = await saveController.CheckUnsavedChanges();
    if (!canProceed) return;
    saveController.NewFile();
    handleFileMenuClose();
  };

  const handleOpen = async () => {
    try {
      const canProceed = await saveController.CheckUnsavedChanges();
      if (!canProceed) return;
      await saveController.LoadFromFile();
    } catch (error) {
      console.error("Failed to load file:", error);
    }
    handleFileMenuClose();
  };

  const handleSave = async () => {
    try {
      await saveController.Save();
    } catch (error) {
      console.error("Failed to save:", error);
    }
    handleFileMenuClose();
  };

  const handleSaveAs = async () => {
    try {
      await saveController.SaveAs();
    } catch (error) {
      console.error("Failed to save file:", error);
    }
    handleFileMenuClose();
  };

  const handleCloseSave = async () => {
    handleFileMenuClose();
    await saveController.CloseSave();
  };

  const handleOpenRecent = async (filePath: string) => {
    try {
      const canProceed = await saveController.CheckUnsavedChanges();
      if (!canProceed) return;
      await saveController.LoadFromFile(filePath);
    } catch (error) {
      console.error("Failed to load recent file:", error);
    }
    handleFileMenuClose();
  };

  const handleClearRecent = async () => {
    await saveController.ClearRecentFiles();
    setIsRecentMenuOpen(false);
    handleFileMenuClose();
  };

  const handleBake = async () => {
    try {
      const result = await bakingController.BakeTree();
      if (result.success) {
        console.log("Baking successful!");
      } else {
        console.error("Baking failed:", result.errors);
      }
    } catch (error) {
      console.error("Baking error:", error);
    }
  };

  const handleBakeToClipboard = async () => {
    try {
      const result = await bakingController.BakeToClipboard();
      if (result.success) {
        console.log("Bake copied to clipboard!");
      } else {
        console.error("Bake to clipboard failed:", result.errors);
      }
    } catch (error) {
      console.error("Bake to clipboard error:", error);
    }
  };

  const handleImportBake = async () => {
    try {
      await bakingController.ImportBakeFromDialog();
    } catch (error) {
      console.error("Failed to import bake:", error);
    }
    handleFileMenuClose();
  };

  const handleUndo = () => {
    undoRedoController.Undo();
  };

  const handleRedo = () => {
    undoRedoController.Redo();
  };

  return (
    <div className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 flex items-center h-8 w-full px-3 shadow-sm">
      <div className="flex items-center gap-1">
        <DropdownMenu
          trigger={
            <button
              className={`px-3 py-1.5 text-sm font-medium text-slate-200 rounded-md transition-all duration-150 hover:bg-slate-600/50 hover:text-white ${
                isFileMenuOpen ? "bg-slate-600 text-white" : ""
              }`}
            >
              File
            </button>
          }
          isOpen={isFileMenuOpen}
          onToggle={handleFileMenuToggle}
          onClose={handleFileMenuClose}
        >
          <MenuItem onClick={handleNew} icon={<FileIcon />}>
            New
          </MenuItem>
          <MenuItem onClick={handleOpen} icon={<FolderIcon />}>
            Open
          </MenuItem>
          <MenuItem onClick={handleImportBake} icon={<FileIcon />}>
            Import Bake...
          </MenuItem>
          <MenuItemWithSubMenu
            icon={<ClockIcon />}
            subMenuContent={
              <>
                {recentFiles.length === 0 ? (
                  <div className="px-4 py-2.5 text-sm text-gray-400 italic">
                    No recent files
                  </div>
                ) : (
                  <>
                    {recentFiles.map((filePath, index) => (
                      <MenuItem
                        key={index}
                        onClick={() => handleOpenRecent(filePath)}
                        icon={<FileIcon />}
                      >
                        <span className="truncate max-w-48" title={filePath}>
                          {saveController.GetRecentFileName(filePath)}
                        </span>
                      </MenuItem>
                    ))}
                    <MenuSeparator />
                    <MenuItem onClick={handleClearRecent} icon={<CloseIcon />}>
                      Clear Recent
                    </MenuItem>
                  </>
                )}
              </>
            }
            isSubMenuOpen={isRecentMenuOpen}
            onSubMenuToggle={() => setIsRecentMenuOpen(!isRecentMenuOpen)}
            onSubMenuClose={() => setIsRecentMenuOpen(false)}
          >
            Open Recent
          </MenuItemWithSubMenu>
          <MenuSeparator />
          <MenuItem onClick={handleSave} icon={<SaveIcon />}>
            Save
          </MenuItem>
          <MenuItem onClick={handleSaveAs} icon={<FileIcon />}>
            Save As...
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={handleCloseSave} icon={<CloseIcon />}>
            Close Save
          </MenuItem>
        </DropdownMenu>

        <button
          onClick={handleBake}
          disabled={!canBake || isBaking}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 ml-2 ${
            !canBake || isBaking
              ? "text-slate-400 cursor-not-allowed"
              : "text-slate-200 hover:bg-slate-600/50 hover:text-white"
          }`}
          title={
            !canBake ? "Save file first to enable baking" : "Bake behavior tree"
          }
        >
          {isBaking ? "Baking..." : "Bake"}
        </button>

        <button
          onClick={handleBakeToClipboard}
          disabled={isBakingToClipboard}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 ${
            isBakingToClipboard
              ? "text-slate-400 cursor-not-allowed"
              : "text-slate-200 hover:bg-slate-600/50 hover:text-white"
          }`}
          title="Bake behavior tree and copy JSON to clipboard"
        >
          {isBakingToClipboard ? "Copying..." : "Bake to Clipboard"}
        </button>

        <div className="w-px h-4 bg-slate-600 mx-2" />

        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`px-2 py-1.5 rounded-md transition-all duration-150 ${
            !canUndo
              ? "text-slate-500 cursor-not-allowed"
              : "text-slate-200 hover:bg-slate-600/50 hover:text-white"
          }`}
          title="Undo (Ctrl+Z)"
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
              d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4"
            />
          </svg>
        </button>

        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`px-2 py-1.5 rounded-md transition-all duration-150 ${
            !canRedo
              ? "text-slate-500 cursor-not-allowed"
              : "text-slate-200 hover:bg-slate-600/50 hover:text-white"
          }`}
          title="Redo (Ctrl+Y)"
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
              d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-xs text-slate-300">
        <span className="font-mono">
          {currentFileName ? `${currentFileName}.btsave` : "Untitled"}
        </span>
        <span className="font-mono">Behavior Tree Creator</span>
      </div>
    </div>
  );
}
