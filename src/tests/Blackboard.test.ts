import { testInit, beforeEach, test, expect, runTests } from "@rbxts/tester";
import { Blackboard } from "Blackboard";

testInit(() => {
	print("Blackboard tests initialized");
});

let bb: Blackboard<{ health: number; name: string; alive: boolean }>;

beforeEach(() => {
	bb = new Blackboard({ health: 100, name: "Player", alive: true });
});

// ── Constructor ──────────────────────────────────────────────────────

test("constructor initializes typed data", () => {
	expect(bb.Get("health")).toBe(100);
	expect(bb.Get("name")).toBe("Player");
	expect(bb.Get("alive")).toBe(true);
});

test("constructor initializes wild data", () => {
	const board = new Blackboard({ health: 100 }, { mana: 50, stamina: 80 });
	expect(board.GetWild<number>("mana")).toBe(50);
	expect(board.GetWild<number>("stamina")).toBe(80);
});

// ── Set / Get ────────────────────────────────────────────────────────

test("Set and Get round-trip", () => {
	bb.Set("health", 42);
	expect(bb.Get("health")).toBe(42);
});

test("Set overwrites previous value", () => {
	bb.Set("name", "Enemy");
	expect(bb.Get("name")).toBe("Enemy");
});

// ── Wild operations ──────────────────────────────────────────────────

test("SetWild / GetWild round-trip", () => {
	bb.SetWild("score", 9001);
	expect(bb.GetWild<number>("score")).toBe(9001);
});

test("GetWild returns undefined for missing key", () => {
	expect(bb.GetWild("nonexistent")).toBeNil();
});

test("GetWildOrDefault returns value when present", () => {
	bb.SetWild("x", 5);
	expect(bb.GetWildOrDefault("x", 99)).toBe(5);
});

test("GetWildOrDefault returns default when missing", () => {
	expect(bb.GetWildOrDefault("missing", 42)).toBe(42);
});

test("HasWild returns true for existing key", () => {
	bb.SetWild("exists", true);
	expect(bb.HasWild("exists")).toBeTruthy();
});

test("HasWild returns false for missing key", () => {
	expect(bb.HasWild("nope")).toBeFalsy();
});

test("DeleteWild removes a key", () => {
	bb.SetWild("temp", 1);
	expect(bb.DeleteWild("temp")).toBeTruthy();
	expect(bb.HasWild("temp")).toBeFalsy();
});

test("DeleteWild returns false for missing key", () => {
	expect(bb.DeleteWild("ghost")).toBeFalsy();
});

// ── Update ───────────────────────────────────────────────────────────

test("Update modifies existing typed value", () => {
	bb.Update("health", (h) => h - 10);
	expect(bb.Get("health")).toBe(90);
});

test("UpdateWild with callback", () => {
	bb.SetWild("counter", 0);
	bb.UpdateWild<number>("counter", (v) => (v ?? 0) + 1);
	expect(bb.GetWild<number>("counter")).toBe(1);
});

test("UpdateWild creates entry when missing", () => {
	const val = bb.UpdateWild<number>("new_key", (v) => (v ?? 0) + 5);
	expect(val).toBe(5);
	expect(bb.GetWild<number>("new_key")).toBe(5);
});

// ── Cast ─────────────────────────────────────────────────────────────

test("Cast returns same instance with different type", () => {
	const casted = bb.Cast<{ score: number }>();
	casted.Set("score", 42);
	expect(casted.Get("score")).toBe(42);
});

runTests();
