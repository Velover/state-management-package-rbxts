import { proxy, useSnapshot } from "valtio";
import {
  BehaviorTreeEdge,
  BehaviorTreeNode,
  CustomNodeDefinition,
} from "../Resources/FlowModels.js";

// Command pattern interface
export interface ICommand {
  execute(): void;
  undo(): void;
  readonly description: string;
}

// State snapshot for tree operations
export interface TreeState {
  nodes: BehaviorTreeNode[];
  edges: BehaviorTreeEdge[];
  customNodes: CustomNodeDefinition[];
  nextNodeId: number;
}

// Generic state command that captures before/after tree state
export class TreeStateCommand implements ICommand {
  constructor(
    private restoreState: (state: TreeState) => void,
    private before: TreeState,
    private after: TreeState,
    public readonly description: string,
  ) {}

  execute() {
    this.restoreState(this.after);
  }

  undo() {
    this.restoreState(this.before);
  }
}

const MAX_HISTORY = 100;

export class UndoRedoController {
  private history_: ICommand[] = [];
  private cursor_ = -1;
  private is_batch_ = false;
  private batch_commands_: ICommand[] = [];

  readonly state = proxy({
    canUndo: false,
    canRedo: false,
  });

  public Execute(command: ICommand) {
    if (this.is_batch_) {
      this.batch_commands_.push(command);
      command.execute();
      return;
    }

    // Remove forward history
    this.history_ = this.history_.slice(0, this.cursor_ + 1);
    command.execute();
    this.history_.push(command);

    if (this.history_.length > MAX_HISTORY) {
      this.history_.shift();
    } else {
      this.cursor_++;
    }

    this.updateState();
  }

  // Push a command that has already been executed (for wrapping imperative code)
  public PushExecuted(command: ICommand) {
    this.history_ = this.history_.slice(0, this.cursor_ + 1);
    this.history_.push(command);

    if (this.history_.length > MAX_HISTORY) {
      this.history_.shift();
    } else {
      this.cursor_++;
    }

    this.updateState();
  }

  // Execute a command without adding to history (for internal state restoration)
  public ExecuteSilent(command: ICommand) {
    command.execute();
  }

  public Undo() {
    if (this.cursor_ < 0) return;
    this.history_[this.cursor_].undo();
    this.cursor_--;
    this.updateState();
  }

  public Redo() {
    if (this.cursor_ >= this.history_.length - 1) return;
    this.cursor_++;
    this.history_[this.cursor_].execute();
    this.updateState();
  }

  public Clear() {
    this.history_ = [];
    this.cursor_ = -1;
    this.updateState();
  }

  public CanUndo(): boolean {
    return this.cursor_ >= 0;
  }

  public CanRedo(): boolean {
    return this.cursor_ < this.history_.length - 1;
  }

  public useCanUndo() {
    return useSnapshot(this.state).canUndo;
  }

  public useCanRedo() {
    return useSnapshot(this.state).canRedo;
  }

  private updateState() {
    this.state.canUndo = this.CanUndo();
    this.state.canRedo = this.CanRedo();
  }
}

export const undoRedoController = new UndoRedoController();
