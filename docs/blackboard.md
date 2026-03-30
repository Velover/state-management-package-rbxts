# Blackboard

The `Blackboard` is a key-value store for sharing data between different parts of your AI or game logic. It supports typed keys via a generic record type, as well as untyped ("wild") keys for dynamic data.

## Basic Usage

```typescript
import { Blackboard } from "@rbxts/state-management";

// Define a type for your blackboard data (optional but recommended)
interface MyAgentBlackboard {
	health: number;
	target?: Instance;
	isAlert: boolean;
}

// Create a blackboard with initial data
const blackboard = new Blackboard<MyAgentBlackboard>({
	health: 100,
	isAlert: false,
});

// Set and get typed values
blackboard.Set("health", 90);
const currentHealth = blackboard.Get("health"); // number
print(currentHealth); // 90

// Update a typed value with a callback
blackboard.Update("health", (current) => current - 10);
```

## Wild Keys

Wild keys allow storing arbitrary data without a fixed schema. They are accessed by string name and are untyped by default.

```typescript
// Set a wild key
blackboard.SetWild("lastKnownPosition", new Vector3(10, 0, 5));

// Get a wild key (returns T | undefined)
const pos = blackboard.GetWild<Vector3>("lastKnownPosition");

// Get with a default fallback
const pos2 = blackboard.GetWildOrDefault<Vector3>("lastKnownPosition", new Vector3(0, 0, 0));

// Update a wild key with a callback
const newHealth = blackboard.UpdateWild<number>("health", (current) => (current ?? 100) - 10);
print(newHealth); // 80

// Check existence and delete
blackboard.HasWild("lastKnownPosition"); // true
blackboard.DeleteWild("lastKnownPosition");
```

## Type-safe Wild Access

Use `GetWildOfType` / `GetOrDefaultWildOfType` for runtime type checking:

```typescript
// Returns undefined and warns if the stored value has a different type
const hp = blackboard.GetWildOfType("health", 0); // number | undefined

// Falls back to default if missing or wrong type
const hp2 = blackboard.GetOrDefaultWildOfType("health", 0, 100);
```

## API Reference

| Method                                          | Description                           |
| ----------------------------------------------- | ------------------------------------- |
| `Set(key, value)`                               | Set a typed key                       |
| `Get(key)`                                      | Get a typed key                       |
| `Update(key, fn)`                               | Update a typed key with a callback    |
| `SetWild(key, value)`                           | Set an untyped key                    |
| `GetWild<T>(key)`                               | Get an untyped key (`T \| undefined`) |
| `GetWildOrDefault<T>(key, default)`             | Get an untyped key with fallback      |
| `UpdateWild<T>(key, fn)`                        | Update an untyped key with a callback |
| `GetWildOfType<T>(key, type)`                   | Get with runtime type check           |
| `GetOrDefaultWildOfType<T>(key, type, default)` | Get with type check and fallback      |
| `HasWild(key)`                                  | Check if an untyped key exists        |
| `DeleteWild(key)`                               | Delete an untyped key                 |
| `Cast<T>()`                                     | Reinterpret type parameter            |
