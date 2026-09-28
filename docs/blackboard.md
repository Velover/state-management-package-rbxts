# Blackboard

A `Blackboard` is a key-value store for sharing data between parts of your AI or game logic. The [FSM](fsm.md) passes one to every state hook, and a [GOAP](goap.md) `WorldState` is a blackboard with planning features added.

([Behavior trees](behavior-tree.md) don't use a blackboard. They keep per-agent data in [fields](behavior-tree.md#per-agent-data-fields), one `Map` per value.)

A blackboard has two ways to reach its data, and both read and write the same store:

- **Typed keys** (`Get`, `Set`, `Update`): names declared in a type you give the blackboard. The compiler checks the key and the value's type.
- **Wild keys** (`GetWild`, `SetWild`, …): any string. Use them for data you didn't declare up front.

## Typed keys

```typescript
import { Blackboard } from "@rbxts/state-management";

type GuardData = {
	health: number;
	target?: Instance;
	isAlert: boolean;
};

// Create it with the starting values.
const blackboard = new Blackboard<GuardData>({
	health: 100,
	isAlert: false,
});

blackboard.Set("health", 90);
const health = blackboard.Get("health"); // number: 90

// Update passes the current value to your function and stores what it returns.
blackboard.Update("health", (current) => current - 10); // 80
```

## Wild keys

```typescript
blackboard.SetWild("lastKnownPosition", new Vector3(10, 0, 5));

const pos = blackboard.GetWild<Vector3>("lastKnownPosition"); // Vector3 | undefined
const pos2 = blackboard.GetWildOrDefault("lastKnownPosition", new Vector3(0, 0, 0)); // Vector3

// UpdateWild gets undefined when the key isn't set yet.
const alertLevel = blackboard.UpdateWild<number>("alertLevel", (current) => (current ?? 0) + 1); // 1

blackboard.HasWild("lastKnownPosition"); // true
blackboard.DeleteWild("lastKnownPosition");
```

The type parameter of `GetWild<T>` isn't checked at run time: you get whatever is stored. To check it, use the `...OfType` methods. Their second argument is **an example value of the type you expect** (`0` for a number, `""` for a string, `false` for a boolean), and its type is compared with the stored value's:

```typescript
// undefined, with a warning, if "health" holds something other than a number
const hp = blackboard.GetWildOfType("health", 0);

// 100 if "health" is missing or holds something other than a number
const hp2 = blackboard.GetOrDefaultWildOfType("health", 0, 100);
```

## API reference

| Method                                          | Description                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `new Blackboard<T>(initial, wild?)`             | Creates a blackboard from the typed starting values, plus optional wild ones                    |
| `Get(key)`                                      | Reads a typed key                                                                               |
| `Set(key, value)`                               | Writes a typed key                                                                              |
| `Update(key, fn)`                               | Stores `fn(current)` in a typed key and returns it                                              |
| `GetWild<T>(key)`                               | Reads any key (`T \| undefined`)                                                                |
| `GetWildOrDefault<T>(key, default)`             | Reads any key, or returns `default` when it isn't set                                           |
| `SetWild(key, value)`                           | Writes any key and returns the value                                                            |
| `UpdateWild<T>(key, fn)`                        | Stores `fn(current)` in any key (`current` may be `undefined`) and returns it                   |
| `GetWildOfType(key, example)`                   | Reads any key if its value has the same type as `example`; otherwise warns, returns `undefined` |
| `GetOrDefaultWildOfType(key, example, default)` | Like `GetWildOfType`, but returns `default` when the key is missing or has the wrong type       |
| `HasWild(key)`                                  | Whether the key is set                                                                          |
| `DeleteWild(key)`                               | Removes the key; returns whether it was set                                                     |
| `Cast<T>()`                                     | The same blackboard, typed as `Blackboard<T>` (no copy, no checks)                              |
