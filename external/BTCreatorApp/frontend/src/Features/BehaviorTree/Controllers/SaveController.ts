import { proxy, subscribe, useSnapshot } from "valtio";
import {
  AddToRecentFiles,
  ClearRecentFiles,
  ForceQuit,
  GetRecentFiles,
  LoadBehaviorTreeFromFileWithPath,
  SaveBehaviorTreeToFileWithPath,
  SetHasUnsavedChanges,
  ShowOpenFileDialog,
  ShowSaveFileDialog,
} from "../../../../wailsjs/go/main/App.js";
import {
  EventsOn,
  OnFileDrop,
  OnFileDropOff,
} from "../../../../wailsjs/runtime/runtime.js";
import { WindowSetTitle } from "../../../../wailsjs/runtime/runtime.js";
import {
  BehaviorTreeSaveRequest,
  COMPATIBLE_SAVE_VERSIONS,
  SAVE_VERSION,
} from "../Resources/SaveModels.js";
import { behaviorTreeController } from "./BehaviorTreeController.js";
import { undoRedoController } from "./UndoRedoController.js";

export type UnsavedDialogResult = "save" | "discard" | "cancel";

const BASE_TITLE = "Behavior Tree Creator";

export class SaveController {
  private readonly behavior_tree_controller_ = behaviorTreeController;
  private readonly undo_redo_ = undoRedoController;

  readonly state = proxy({
    currentFilePath: null as string | null,
    lastSaved: null as Date | null,
    isLoading: false,
    isSaving: false,
    hasUnsavedChanges: false,
    isEditing: false,
    recentFiles: [] as string[],
  });

  readonly dialogState = proxy({
    showUnsavedDialog: false,
  });

  private unsaved_dialog_resolver_:
    | ((result: UnsavedDialogResult) => void)
    | null = null;
  private last_saved_state_: string | null = null;
  private suppress_change_tracking_ = false;

  constructor() {
    console.log("SaveController initialized");
    this.setupChangeTracking();
    this.setupCloseHandler();
    this.setupFileDropHandler();
    this.loadRecentFiles();
  }

  public useCurrentFileName() {
    const snap = useSnapshot(this.state);
    const filePath = snap.currentFilePath;
    if (!filePath) return null;

    // Extract filename without extension
    const fileName = filePath.split(/[\\/]/).pop() || "";
    return fileName.replace(/\.[^/.]+$/, "");
  }

  public useLastSaved() {
    return useSnapshot(this.state).lastSaved;
  }

  public useIsLoading() {
    return useSnapshot(this.state).isLoading;
  }

  public useIsSaving() {
    return useSnapshot(this.state).isSaving;
  }

  public useHasUnsavedChanges() {
    return useSnapshot(this.state).hasUnsavedChanges;
  }

  public useIsEditing() {
    return useSnapshot(this.state).isEditing;
  }

  public useRecentFiles() {
    return useSnapshot(this.state).recentFiles;
  }

  private async loadRecentFiles() {
    try {
      const files = await GetRecentFiles();
      this.state.recentFiles = files;
    } catch (error) {
      console.error("Failed to load recent files:", error);
    }
  }

  private async addRecentFile(filePath: string) {
    try {
      await AddToRecentFiles(filePath);
      // Reload the list to stay in sync
      await this.loadRecentFiles();
    } catch (error) {
      console.error("Failed to add recent file:", error);
    }
  }

  public async ClearRecentFiles() {
    try {
      await ClearRecentFiles();
      this.state.recentFiles = [];
    } catch (error) {
      console.error("Failed to clear recent files:", error);
    }
  }

  public GetRecentFileName(filePath: string): string {
    const fileName = filePath.split(/[\\/]/).pop() || "";
    return fileName.replace(/\.[^/.]+$/, "");
  }

  private setupChangeTracking() {
    subscribe(this.behavior_tree_controller_.state, () => {
      if (this.suppress_change_tracking_) return;

      const currentState = JSON.stringify({
        nodes: this.behavior_tree_controller_.GetCurrentNodesAtom(),
        edges: this.behavior_tree_controller_.GetCurrentEdgesAtom(),
        customNodes: this.behavior_tree_controller_.GetCurrentCustomNodesAtom(),
        nextNodeId: this.behavior_tree_controller_.GetCurrentNextNodeIdAtom(),
      });

      const hasChanges = currentState !== this.last_saved_state_;
      this.state.hasUnsavedChanges = hasChanges;
      this.updateWindowTitle();
      SetHasUnsavedChanges(hasChanges);
    });
  }

  private setupCloseHandler() {
    EventsOn("app-close-requested", async () => {
      if (!this.state.hasUnsavedChanges) {
        await ForceQuit();
        return;
      }

      const result = await this.showUnsavedDialog();
      if (result === "save") {
        await this.Save();
        await ForceQuit();
      } else if (result === "discard") {
        await ForceQuit();
      }
      // "cancel" → do nothing, window stays open
    });
  }

  private setupFileDropHandler() {
    const applyDropState = (isEditing: boolean) => {
      if (isEditing) {
        OnFileDropOff();
      } else {
        OnFileDrop(async (_x, _y, paths) => {
          // Check for .btbake files first (import bake)
          const btbake = paths.find((p) => p.toLowerCase().endsWith(".btbake"));
          if (btbake) {
            const canProceed = await this.CheckUnsavedChanges();
            if (!canProceed) return;
            const { bakingController } = await import("./BakingController.js");
            await bakingController.ImportBakeFromPath(btbake);
            return;
          }

          // Then check for .btsave files
          const btsave = paths.find((p) => p.toLowerCase().endsWith(".btsave"));
          if (!btsave) return;
          const canProceed = await this.CheckUnsavedChanges();
          if (!canProceed) return;
          await this.LoadFromFile(btsave);
        }, false);
      }
    };

    // Apply immediately based on current state
    applyDropState(this.state.isEditing);

    // Re-apply whenever isEditing changes
    subscribe(this.state, () => {
      applyDropState(this.state.isEditing);
    });
  }

  private updateWindowTitle() {
    const prefix = this.state.hasUnsavedChanges ? "* " : "";
    const fileName = this.GetCurrentFileName();
    const filePart = fileName ? ` - ${fileName}` : "";
    WindowSetTitle(`${prefix}${BASE_TITLE}${filePart}`);
  }

  public showUnsavedDialog(): Promise<UnsavedDialogResult> {
    return new Promise((resolve) => {
      this.unsaved_dialog_resolver_ = resolve;
      this.dialogState.showUnsavedDialog = true;
    });
  }

  public resolveUnsavedDialog(result: UnsavedDialogResult) {
    this.dialogState.showUnsavedDialog = false;
    this.unsaved_dialog_resolver_?.(result);
    this.unsaved_dialog_resolver_ = null;
  }

  /**
   * Prompts the user to save unsaved changes via a dialog.
   * Returns true if it's safe to proceed (saved or discarded), false if cancelled.
   */
  public async CheckUnsavedChanges(): Promise<boolean> {
    if (!this.state.hasUnsavedChanges) return true;

    const result = await this.showUnsavedDialog();
    if (result === "save") {
      await this.Save();
      return true;
    } else if (result === "discard") {
      return true;
    }
    // "cancel"
    return false;
  }

  public async SaveToFile(filePath?: string) {
    try {
      if (this.state.isSaving) return;

      let filePathToUse = filePath || this.state.currentFilePath;

      // If no file path provided, show save dialog
      if (!filePathToUse) {
        const selectedPath = await ShowSaveFileDialog("Untitled");
        if (!selectedPath) {
          return; // User cancelled
        }
        filePathToUse = selectedPath;
      }

      this.state.isSaving = true;

      const saveData: BehaviorTreeSaveRequest = {
        nodes: this.behavior_tree_controller_.GetCurrentNodesAtom(),
        edges: this.behavior_tree_controller_.GetCurrentEdgesAtom(),
        customNodes: this.behavior_tree_controller_.GetCurrentCustomNodesAtom(),
        nextNodeId: this.behavior_tree_controller_.GetCurrentNextNodeIdAtom(),
        version: SAVE_VERSION,
        lastSaved: new Date().toISOString(),
      };

      await SaveBehaviorTreeToFileWithPath(filePathToUse, saveData);
      this.state.currentFilePath = filePathToUse;
      this.state.lastSaved = new Date();

      // Update last saved state
      this.last_saved_state_ = JSON.stringify({
        nodes: saveData.nodes,
        edges: saveData.edges,
        customNodes: saveData.customNodes,
        nextNodeId: saveData.nextNodeId,
      });
      this.state.hasUnsavedChanges = false;
      this.updateWindowTitle();
      SetHasUnsavedChanges(false);

      const fileName = filePathToUse.split(/[\\/]/).pop() || "";
      console.log(`Saved behavior tree to: ${fileName}`);

      // Add to recent files
      await this.addRecentFile(filePathToUse);
    } catch (error) {
      console.error("Failed to save:", error);
      throw error;
    } finally {
      this.state.isSaving = false;
    }
  }

  public async LoadFromFile(filePath?: string) {
    try {
      this.state.isLoading = true;
      this.suppress_change_tracking_ = true;

      let filePathToUse = filePath;

      // If no file path provided, show open dialog
      if (!filePathToUse) {
        const selectedPath = await ShowOpenFileDialog();
        if (!selectedPath) {
          return; // User cancelled
        }
        filePathToUse = selectedPath;
      }

      const saved_data = await LoadBehaviorTreeFromFileWithPath(filePathToUse);
      if (!saved_data) {
        throw new Error(`No saved data found for file: ${filePathToUse}`);
      }

      // Version check
      if (!COMPATIBLE_SAVE_VERSIONS.includes(saved_data.version)) {
        console.warn(
          `Save data version mismatch. Expected one of ${COMPATIBLE_SAVE_VERSIONS.join(", ")}, got ${saved_data.version}`,
        );
      }

      // Restore data
      this.behavior_tree_controller_.SetNodes(saved_data.nodes ?? []);
      this.behavior_tree_controller_.SetEdges(saved_data.edges ?? []);
      this.behavior_tree_controller_.SetCustomNodes(
        saved_data.customNodes ?? [],
      );
      this.behavior_tree_controller_.SetNextNodeId(saved_data.nextNodeId ?? 1);

      this.state.currentFilePath = filePathToUse;
      this.state.lastSaved = new Date(saved_data.lastSaved);
      this.state.isEditing = true;

      // Clear undo/redo history after loading a file
      this.undo_redo_.Clear();

      // Update last saved state after successful load
      this.last_saved_state_ = JSON.stringify({
        nodes: saved_data.nodes ?? [],
        edges: saved_data.edges ?? [],
        customNodes: saved_data.customNodes ?? [],
        nextNodeId: saved_data.nextNodeId ?? 1,
      });
      this.state.hasUnsavedChanges = false;
      this.updateWindowTitle();
      SetHasUnsavedChanges(false);

      const fileName = filePathToUse.split(/[\\/]/).pop() || "";
      console.log(`Loaded behavior tree from: ${fileName}`);

      // Add to recent files
      await this.addRecentFile(filePathToUse);
    } catch (error) {
      console.error("Failed to load save data:", error);
      throw error;
    } finally {
      this.suppress_change_tracking_ = false;
      this.state.isLoading = false;
    }
  }

  public async SaveAs() {
    const currentFileName = this.GetCurrentFileName() ?? "Untitled";
    const selectedPath = await ShowSaveFileDialog(currentFileName);
    if (selectedPath) {
      await this.SaveToFile(selectedPath);
    }
  }

  public async Save() {
    const currentFilePath = this.state.currentFilePath;
    if (!currentFilePath) {
      // No file currently loaded, show save dialog
      await this.SaveAs();
    } else {
      await this.SaveToFile(currentFilePath);
    }
  }

  public NewFile() {
    this.suppress_change_tracking_ = true;

    // Clear current data
    this.behavior_tree_controller_.SetNodes([]);
    this.behavior_tree_controller_.SetEdges([]);
    this.behavior_tree_controller_.SetCustomNodes([]);
    this.behavior_tree_controller_.SetNextNodeId(1);

    this.state.currentFilePath = null;
    this.state.lastSaved = null;
    this.state.hasUnsavedChanges = false;
    this.state.isEditing = true;
    this.last_saved_state_ = JSON.stringify({
      nodes: [],
      edges: [],
      customNodes: [],
      nextNodeId: 1,
    });

    // Clear undo/redo history
    this.undo_redo_.Clear();

    this.suppress_change_tracking_ = false;
    this.updateWindowTitle();
    SetHasUnsavedChanges(false);

    console.log("Created new behavior tree file");
  }

  public async CloseSave() {
    const canProceed = await this.CheckUnsavedChanges();
    if (!canProceed) return;

    this.suppress_change_tracking_ = true;

    this.behavior_tree_controller_.SetNodes([]);
    this.behavior_tree_controller_.SetEdges([]);
    this.behavior_tree_controller_.SetCustomNodes([]);
    this.behavior_tree_controller_.SetNextNodeId(1);

    this.state.currentFilePath = null;
    this.state.lastSaved = null;
    this.state.hasUnsavedChanges = false;
    this.state.isEditing = false;
    this.last_saved_state_ = JSON.stringify({
      nodes: [],
      edges: [],
      customNodes: [],
      nextNodeId: 1,
    });

    this.undo_redo_.Clear();

    this.suppress_change_tracking_ = false;
    this.updateWindowTitle();
    SetHasUnsavedChanges(false);

    console.log("Closed save, returning to welcome screen");
  }

  public GetCurrentFileName(): string | null {
    const filePath = this.state.currentFilePath;
    if (!filePath) return null;

    // Extract filename without extension
    const fileName = filePath.split(/[\\/]/).pop() || "";
    return fileName.replace(/\.[^/.]+$/, "");
  }
}

export const saveController = new SaveController();
