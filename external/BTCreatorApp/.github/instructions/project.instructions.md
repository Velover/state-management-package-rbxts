# Behavoir Tree creator

The app should help to build and visualize behavior trees visually.
The app is ONLY for visualizing behavoir trees and not for exporting them.

Requirements:

- Visual editor for behavior trees
- Nodes can be added, removed, and connected
- Nodes have types (e.g., Node, Composite, Decorator)
- Default nodes

```
Coposite: (Sequence, ReactiveSequence, MemorySequence, Fallback, ReactiveFallback, Parallel, IfThenElse, WhileDoElse)
Node: (Action, Condition, Switch, Wait, Timer, SubTree)
Decorator: (Inverter, ForceSuccess, ForceFailure, Timeout, RetryUntilSuccess, RetryUntilFailure, Repeat, Cooldown)
```

- Connect to react flow events like Connect, Disconnect, Add, Remove
- Add creator for custom nodes where you can define type of it (Node, Composite, Decorator)
- Add drag and drop support for nodes

Project structure:

- Feature-based separation

```
src/
  ├── Features/
	│   ├── SomeFeature/
	│       ├── Controllers/
	│       ├── UI/
	│       ├── Resources/ (namespaces that are used to store constants, enums, models etc.)
	│       ├── (Other folders as needed)
```

- Separate ui elements into Feature
- Single entry point for the app
- typescript for frontend
- Go for backend

Packages:

- Wails-go-app
- @xyflow/react
- valtio (state management: proxy, useSnapshot, subscribe, snapshot)

AVOID generating bindings for the go code as it will be done automatically by Wails.
