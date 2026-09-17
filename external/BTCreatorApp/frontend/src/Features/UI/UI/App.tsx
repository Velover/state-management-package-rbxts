import BehaviorTreeEditorWrapper from "../../BehaviorTree/UI/BehaviorTreeEditor.js";
import { UnsavedChangesDialog } from "../../BehaviorTree/UI/Components/UnsavedChangesDialog.js";

function App() {
  return (
    <div className="w-screen h-screen bg-gray-100">
      <BehaviorTreeEditorWrapper />
      <UnsavedChangesDialog />
    </div>
  );
}

export default App;
