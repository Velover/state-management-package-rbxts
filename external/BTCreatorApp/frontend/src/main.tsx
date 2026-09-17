// Import controller singletons to ensure they are instantiated
import "./Features/BehaviorTree/Controllers/UndoRedoController.js";
import "./Features/BehaviorTree/Controllers/BehaviorTreeController.js";
import "./Features/BehaviorTree/Controllers/SaveController.js";
import "./Features/BehaviorTree/Controllers/ValidationController.js";
import "./Features/BehaviorTree/Controllers/BakingController.js";

import { startUI } from "./Features/UI/Controllers/UIControllers.js";
import "./main.css";

startUI();
