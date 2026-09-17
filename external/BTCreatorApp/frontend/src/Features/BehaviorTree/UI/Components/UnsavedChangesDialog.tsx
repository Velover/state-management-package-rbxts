import { useSnapshot } from "valtio";
import { saveController } from "../../Controllers/SaveController.js";

export function UnsavedChangesDialog() {
  const { showUnsavedDialog } = useSnapshot(saveController.dialogState);

  if (!showUnsavedDialog) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Unsaved Changes
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          You have unsaved changes. What would you like to do?
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => saveController.resolveUnsavedDialog("cancel")}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => saveController.resolveUnsavedDialog("discard")}
            className="px-4 py-2 text-sm text-red-700 bg-red-100 rounded-md hover:bg-red-200"
          >
            Discard
          </button>
          <button
            onClick={() => saveController.resolveUnsavedDialog("save")}
            className="px-4 py-2 text-sm text-white bg-blue-500 rounded-md hover:bg-blue-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
