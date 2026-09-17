package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wails_runtime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx               context.Context
	hasUnsavedChanges bool
	forceQuit         bool
}

// BehaviorTreeSaveData represents the structure for saving behavior tree data
type BehaviorTreeSaveData struct {
	Nodes       json.RawMessage `json:"nodes"`
	Edges       json.RawMessage `json:"edges"`
	CustomNodes json.RawMessage `json:"customNodes"`
	NextNodeID  int             `json:"nextNodeId"`
	Version     string          `json:"version"`
	LastSaved   string          `json:"lastSaved"`
}

// BakeNodeStructure represents a single node in the baked behavior tree
type BakeNodeStructure struct {
	Name       string                 `json:"name"`
	Children   []string               `json:"children"`
	Parameters map[string]interface{} `json:"parameters,omitempty"`
	SwitchCase *BakeSwitchCase        `json:"switch_case,omitempty"`
}

// BakeSwitchCase represents switch case data for switch nodes
type BakeSwitchCase struct {
	Cases         map[string]string `json:"cases"`
	Default       *string           `json:"default,omitempty"`
	ParameterName string            `json:"parameter_name"`
}

// BehaviorTreeBakeData represents the complete baked behavior tree
type BehaviorTreeBakeData struct {
	Name      string                       `json:"name"`
	Structure map[string]BakeNodeStructure `json:"structure"`
	BakedAt   string                       `json:"baked_at"`
	Version   string                       `json:"version"`
}

var BT_SAVE_FILE_ENDING = ".btsave"
var BT_BAKE_FILE_ENDING = ".btbake"
var SAVE_DIR = "saves"
var BAKE_DIR = "bakes"
var HISTORY_FILE = "history.json"

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// beforeClose is called when the user tries to close the window.
// If there are unsaved changes, it emits an event to let the frontend handle the dialog.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.forceQuit || !a.hasUnsavedChanges {
		return false
	}
	// Let the frontend handle the save prompt
	wails_runtime.EventsEmit(ctx, "app-close-requested")
	return true // prevent close, frontend will call ForceQuit if needed
}

// SetHasUnsavedChanges is called by the frontend to sync unsaved state.
func (a *App) SetHasUnsavedChanges(value bool) {
	a.hasUnsavedChanges = value
}

// ForceQuit closes the app bypassing the unsaved changes check.
func (a *App) ForceQuit() {
	a.forceQuit = true
	wails_runtime.Quit(a.ctx)
}

func (a *App) getExecutableDir() (string, error) {
	execPath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get executable path: %w", err)
	}
	return filepath.Dir(execPath), nil
}

func (a *App) getFullSavePath(name string) (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(exec_dir, SAVE_DIR, name+BT_SAVE_FILE_ENDING), nil
}

func (a *App) getFullBakePath(name string) (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(exec_dir, BAKE_DIR, name+BT_BAKE_FILE_ENDING), nil
}

func (a *App) SaveBehaviorTreeToFile(name string, data BehaviorTreeSaveData) error {
	file_path, err := a.getFullSavePath(name)
	if err != nil {
		return fmt.Errorf("failed to get full save path: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(file_path), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	json_data, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to convert data to json: %w", err)
	}

	if err := os.WriteFile(file_path, json_data, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

func (a *App) GetSaves() ([]string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return nil, err
	}

	save_dir := filepath.Join(exec_dir, SAVE_DIR)
	files, err := os.ReadDir(save_dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil // Return empty slice if directory doesn't exist
		}
		return nil, err
	}

	var save_files []string = []string{}

	for _, file := range files {
		if file.Type().IsRegular() && filepath.Ext(file.Name()) == BT_SAVE_FILE_ENDING {
			file_name := file.Name()
			file_name = file_name[:len(file_name)-len(BT_SAVE_FILE_ENDING)]
			save_files = append(save_files, file_name)
		}
	}

	return save_files, nil
}

func (a *App) LoadBehaviorTreeFromFile(name string) (*BehaviorTreeSaveData, error) {
	file_path, err := a.getFullSavePath(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get full save path: %w", err)
	}

	if _, err := os.Stat(file_path); os.IsNotExist(err) {
		return nil, nil // File doesnt exist
	}

	data, err := os.ReadFile(file_path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var save_data BehaviorTreeSaveData
	if err := json.Unmarshal(data, &save_data); err != nil {
		return nil, fmt.Errorf("failed to parse json data: %w", err)
	}

	return &save_data, nil
}

// SaveBehaviorTreeBake saves a baked behavior tree to a file
func (a *App) SaveBehaviorTreeBake(name string, structure map[string]BakeNodeStructure) error {
	file_path, err := a.getFullBakePath(name)
	if err != nil {
		return fmt.Errorf("failed to get full bake path: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(file_path), 0755); err != nil {
		return fmt.Errorf("failed to create bake directory: %w", err)
	}

	bake_data := BehaviorTreeBakeData{
		Name:      name,
		Structure: structure,
		BakedAt:   time.Now().UTC().Format(time.RFC3339),
		Version:   "2.0.0",
	}

	json_data, err := json.Marshal(bake_data)
	if err != nil {
		return fmt.Errorf("failed to convert bake data to json: %w", err)
	}

	if err := os.WriteFile(file_path, json_data, 0644); err != nil {
		return fmt.Errorf("failed to write bake file: %w", err)
	}

	return nil
}

// GetBakes returns a list of all baked behavior trees
func (a *App) GetBakes() ([]string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return nil, err
	}

	bake_dir := filepath.Join(exec_dir, BAKE_DIR)
	files, err := os.ReadDir(bake_dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil // Return empty slice if directory doesn't exist
		}
		return nil, err
	}

	var bake_files []string = []string{}

	for _, file := range files {
		if file.Type().IsRegular() && filepath.Ext(file.Name()) == BT_BAKE_FILE_ENDING {
			file_name := file.Name()
			file_name = file_name[:len(file_name)-len(BT_BAKE_FILE_ENDING)]
			bake_files = append(bake_files, file_name)
		}
	}

	return bake_files, nil
}

// LoadBehaviorTreeBake loads a baked behavior tree from a file
func (a *App) LoadBehaviorTreeBake(name string) (*BehaviorTreeBakeData, error) {
	file_path, err := a.getFullBakePath(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get full bake path: %w", err)
	}

	if _, err := os.Stat(file_path); os.IsNotExist(err) {
		return nil, nil // File doesn't exist
	}

	data, err := os.ReadFile(file_path)
	if err != nil {
		return nil, fmt.Errorf("failed to read bake file: %w", err)
	}

	var bake_data BehaviorTreeBakeData
	if err := json.Unmarshal(data, &bake_data); err != nil {
		return nil, fmt.Errorf("failed to parse bake json data: %w", err)
	}

	return &bake_data, nil
}

// OpenBakesFolder opens the file explorer at the bakes folder location
func (a *App) OpenBakesFolder() error {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return fmt.Errorf("failed to get executable directory: %w", err)
	}

	bake_dir := filepath.Join(exec_dir, BAKE_DIR)

	// Ensure the bakes directory exists
	if err := os.MkdirAll(bake_dir, 0755); err != nil {
		return fmt.Errorf("failed to create bake directory: %w", err)
	}

	// Open file explorer based on operating system
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", bake_dir)
	case "darwin": // macOS
		cmd = exec.Command("open", bake_dir)
	case "linux":
		cmd = exec.Command("xdg-open", bake_dir)
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to open file explorer: %w", err)
	}

	return nil
}

// OpenBakeFileInExplorer opens the file explorer and selects the specific bake file
func (a *App) OpenBakeFileInExplorer(name string) error {
	file_path, err := a.getFullBakePath(name)
	if err != nil {
		return fmt.Errorf("failed to get full bake path: %w", err)
	}

	// Ensure the file exists
	if _, err := os.Stat(file_path); os.IsNotExist(err) {
		return fmt.Errorf("bake file does not exist: %s", file_path)
	}

	// Open file explorer and select file based on operating system
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Use explorer with /select parameter to highlight the file
		cmd = exec.Command("explorer", "/select,", file_path)
	case "darwin": // macOS
		// Use open with -R flag to reveal in Finder
		cmd = exec.Command("open", "-R", file_path)
	case "linux":
		// For Linux, we'll open the directory and let the user find the file
		// as there's no standard way to select a file across all file managers
		bake_dir := filepath.Dir(file_path)
		cmd = exec.Command("xdg-open", bake_dir)
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to open file explorer: %w", err)
	}

	return nil
}

// ShowOpenFileDialog opens a native file dialog for opening files
func (a *App) ShowOpenFileDialog() (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}

	save_dir := filepath.Join(exec_dir, SAVE_DIR)
	// Ensure the saves directory exists
	if err := os.MkdirAll(save_dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create save directory: %w", err)
	}

	// Use wails runtime to show file dialog
	return wails_runtime.OpenFileDialog(a.ctx, wails_runtime.OpenDialogOptions{
		Title:            "Open Behavior Tree",
		DefaultDirectory: save_dir,
		Filters: []wails_runtime.FileFilter{
			{
				DisplayName: "Behavior Tree Files (*.btsave)",
				Pattern:     "*.btsave",
			},
		},
	})
}

// ShowSaveFileDialog opens a native file dialog for saving files
func (a *App) ShowSaveFileDialog(defaultName string) (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}

	save_dir := filepath.Join(exec_dir, SAVE_DIR)
	// Ensure the saves directory exists
	if err := os.MkdirAll(save_dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create save directory: %w", err)
	}

	// defaultPath := filepath.Join(save_dir, defaultName+BT_SAVE_FILE_ENDING)

	return wails_runtime.SaveFileDialog(a.ctx, wails_runtime.SaveDialogOptions{
		Title:            "Save Behavior Tree",
		DefaultDirectory: save_dir,
		DefaultFilename:  defaultName + BT_SAVE_FILE_ENDING,
		Filters: []wails_runtime.FileFilter{
			{
				DisplayName: "Behavior Tree Files (*.btsave)",
				Pattern:     "*.btsave",
			},
		},
	})
}

// ShowBakeSaveFileDialog opens a native file dialog for saving bake files
func (a *App) ShowBakeSaveFileDialog(defaultName string) (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}

	bake_dir := filepath.Join(exec_dir, BAKE_DIR)
	// Ensure the bakes directory exists
	if err := os.MkdirAll(bake_dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create bake directory: %w", err)
	}

	return wails_runtime.SaveFileDialog(a.ctx, wails_runtime.SaveDialogOptions{
		Title:            "Save Behavior Tree Bake",
		DefaultDirectory: bake_dir,
		DefaultFilename:  defaultName + BT_BAKE_FILE_ENDING,
		Filters: []wails_runtime.FileFilter{
			{
				DisplayName: "Behavior Tree Bake Files (*.btbake)",
				Pattern:     "*.btbake",
			},
		},
	})
}

// SaveBehaviorTreeToFileWithPath saves to a full file path instead of just name
func (a *App) SaveBehaviorTreeToFileWithPath(filePath string, data BehaviorTreeSaveData) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	json_data, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to convert data to json: %w", err)
	}

	if err := os.WriteFile(filePath, json_data, 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// LoadBehaviorTreeFromFileWithPath loads from a full file path
func (a *App) LoadBehaviorTreeFromFileWithPath(filePath string) (*BehaviorTreeSaveData, error) {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("file does not exist: %s", filePath)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var save_data BehaviorTreeSaveData
	if err := json.Unmarshal(data, &save_data); err != nil {
		return nil, fmt.Errorf("failed to parse json data: %w", err)
	}

	return &save_data, nil
}

// SaveBehaviorTreeBakeWithPath saves a baked behavior tree to a full file path
func (a *App) SaveBehaviorTreeBakeWithPath(filePath string, structure map[string]BakeNodeStructure) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create bake directory: %w", err)
	}

	// Extract filename without extension for the bake name
	fileName := filepath.Base(filePath)
	if ext := filepath.Ext(fileName); ext != "" {
		fileName = fileName[:len(fileName)-len(ext)]
	}

	bake_data := BehaviorTreeBakeData{
		Name:      fileName,
		Structure: structure,
		BakedAt:   time.Now().UTC().Format(time.RFC3339),
		Version:   "2.0.0",
	}

	json_data, err := json.Marshal(bake_data)
	if err != nil {
		return fmt.Errorf("failed to convert bake data to json: %w", err)
	}

	if err := os.WriteFile(filePath, json_data, 0644); err != nil {
		return fmt.Errorf("failed to write bake file: %w", err)
	}

	return nil
}

// LoadBehaviorTreeBakeWithPath loads a baked behavior tree from a full file path
func (a *App) LoadBehaviorTreeBakeWithPath(filePath string) (*BehaviorTreeBakeData, error) {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return nil, fmt.Errorf("file does not exist: %s", filePath)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var bake_data BehaviorTreeBakeData
	if err := json.Unmarshal(data, &bake_data); err != nil {
		return nil, fmt.Errorf("failed to parse bake json data: %w", err)
	}

	return &bake_data, nil
}

// ShowOpenBakeFileDialog opens a native file dialog for opening bake files
func (a *App) ShowOpenBakeFileDialog() (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", err
	}

	bake_dir := filepath.Join(exec_dir, BAKE_DIR)
	if err := os.MkdirAll(bake_dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create bake directory: %w", err)
	}

	return wails_runtime.OpenFileDialog(a.ctx, wails_runtime.OpenDialogOptions{
		Title:            "Import Behavior Tree Bake",
		DefaultDirectory: bake_dir,
		Filters: []wails_runtime.FileFilter{
			{
				DisplayName: "Behavior Tree Bake Files (*.btbake)",
				Pattern:     "*.btbake",
			},
		},
	})
}

// getHistoryFilePath returns the full path to the history.json file
func (a *App) getHistoryFilePath() (string, error) {
	exec_dir, err := a.getExecutableDir()
	if err != nil {
		return "", fmt.Errorf("failed to get executable directory: %w", err)
	}
	return filepath.Join(exec_dir, HISTORY_FILE), nil
}

// GetRecentFiles returns the list of recently opened .btsave file paths
func (a *App) GetRecentFiles() ([]string, error) {
	historyPath, err := a.getHistoryFilePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(historyPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, fmt.Errorf("failed to read history file: %w", err)
	}

	var recentFiles []string
	if err := json.Unmarshal(data, &recentFiles); err != nil {
		return nil, fmt.Errorf("failed to parse history file: %w", err)
	}

	return recentFiles, nil
}

// AddToRecentFiles adds a file path to the recent files list (no duplicates, most recent first)
func (a *App) AddToRecentFiles(filePath string) error {
	recentFiles, err := a.GetRecentFiles()
	if err != nil {
		recentFiles = []string{}
	}

	// Remove existing entry if present (case-insensitive comparison on Windows)
	filtered := make([]string, 0, len(recentFiles))
	normalizedNew := filepath.Clean(filePath)
	for _, f := range recentFiles {
		if !strings.EqualFold(filepath.Clean(f), normalizedNew) {
			filtered = append(filtered, f)
		}
	}

	// Prepend the new file path
	recentFiles = append([]string{filePath}, filtered...)

	// Write back to history.json
	historyPath, err := a.getHistoryFilePath()
	if err != nil {
		return err
	}

	jsonData, err := json.MarshalIndent(recentFiles, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal history data: %w", err)
	}

	if err := os.WriteFile(historyPath, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write history file: %w", err)
	}

	return nil
}

// ClearRecentFiles clears the recent files history
func (a *App) ClearRecentFiles() error {
	historyPath, err := a.getHistoryFilePath()
	if err != nil {
		return err
	}

	if err := os.WriteFile(historyPath, []byte("[]"), 0644); err != nil {
		return fmt.Errorf("failed to clear history file: %w", err)
	}

	return nil
}
