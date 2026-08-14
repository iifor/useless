# Deferred Owned Seat Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an app-owned Desktop seat file is created only after the pet reaches its initial destination.

**Architecture:** Represent the 10% owned-seat choice as a deferred target with no path. `App` moves to the initial random destination first, then materializes that target through the existing Rust `FoodSafety` command and optionally performs one follow-up move to Finder/Explorer's real icon coordinate.

**Tech Stack:** React, TypeScript, Vitest, Tauri 2 invoke API.

## Global Constraints

- Do not create an owned file before the initial walk completes.
- A cancelled or failed initial walk creates no file.
- All creation and cleanup remain routed through Rust `FoodSafety` commands.
- User-owned Desktop items remain read-only.

---

### Task 1: Defer owned-seat materialization until arrival

**Files:**
- Modify: `tests/pet/desktopSeat.test.ts`
- Modify: `src/pet/desktopSeat.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `isPendingOwnedSeat(target: DesktopSeatTarget): boolean`
- Produces: `materializeOwnedSeatTarget(target: DesktopSeatTarget): Promise<DesktopSeatTarget>`
- Consumes: existing `find_seat_targets`, `create_owned_seat_file`, `moveWindowTo`, and `releaseSeatTarget`

- [ ] **Step 1: Write the failing tests**

Add tests proving that the 10% branch returns an uncreated pending target and that materialization invokes creation exactly once only when explicitly called:

```ts
test("defers owned file creation until the pending target is materialized", async () => {
  const pending = chooseSeatTarget([icon], values(0.099));
  expect(isPendingOwnedSeat(pending)).toBe(true);

  const events: string[] = [];
  const created = await materializeOwnedSeatTarget(
    pending!,
    async () => {
      events.push("create");
      return {
        id: "owned",
        name: "宠物的座位.tmp",
        kind: "owned-temp",
        path: "/Desktop/宠物的座位.tmp",
        appOwned: true,
        virtualMarker: true,
      };
    },
    async () => [],
    async () => undefined,
  );

  expect(events).toEqual(["create"]);
  expect(created.path).toBe("/Desktop/宠物的座位.tmp");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test tests/pet/desktopSeat.test.ts`

Expected: FAIL because `isPendingOwnedSeat` and `materializeOwnedSeatTarget` do not exist and the current selection uses `null`.

- [ ] **Step 3: Implement the minimal deferred target**

Change the selection result to a pending `owned-temp` target with no path. Move the existing create-and-discover loop out of `findSeatTarget()` into `materializeOwnedSeatTarget()`. Keep the existing two-second discovery timeout and virtual fallback.

- [ ] **Step 4: Move materialization after the first walk**

In `seatSequence()`, compute and walk to the initial destination first. Only after `moveWindowTo()` resolves and `isCurrent()` remains true, materialize a pending owned target. If a real anchor is discovered, perform one follow-up move; otherwise show the virtual marker at the reached destination.

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
pnpm test tests/pet/desktopSeat.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0.
