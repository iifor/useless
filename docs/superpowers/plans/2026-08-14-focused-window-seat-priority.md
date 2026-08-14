# Focused Window Seat Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select a valid focused application window first, then an existing Desktop icon, and create an owned seat only when both categories are unavailable.

**Architecture:** Native window enumeration marks the actual foreground window without changing the existing visibility and geometry filters. Rust returns the focused target immediately and skips Desktop automation; TypeScript repeats the priority rule as a defensive boundary and returns the existing deferred owned target only for an empty candidate set.

**Tech Stack:** React, TypeScript, Vitest, Rust, CoreGraphics/NSWorkspace, Win32/DWM, Tauri 2.

## Global Constraints

- Priority is exactly: focused window → existing Desktop icon → deferred app-owned file.
- UNO, hidden, minimized, tool, off-monitor, and insufficient-clearance windows are never valid seats.
- A valid focused window prevents Finder/Explorer Desktop coordinate access.
- Existing user files, folders, and windows remain read-only.
- Owned files are still created only after the initial walk completes.

---

### Task 1: Make the TypeScript selector enforce strict priority

**Files:**
- Modify: `tests/pet/desktopSeat.test.ts`
- Modify: `src/pet/desktopSeat.ts`

**Interfaces:**
- Modifies: `DesktopSeatTarget` with `focused: boolean`
- Modifies: `chooseSeatTarget(candidates, random): DesktopSeatTarget`

- [ ] **Step 1: Write the failing priority tests**

```ts
test("prefers the focused window, then an icon, then a deferred owned seat", () => {
  const focused = { ...windowSeat, id: "focused", focused: true };
  expect(chooseSeatTarget([icon, windowSeat, focused], values(0))).toEqual(focused);
  expect(chooseSeatTarget([icon, windowSeat], values(0))).toEqual(icon);
  expect(isPendingOwnedSeat(chooseSeatTarget([], values(0)))).toBe(true);
});
```

Update fixtures so icon, virtual, owned, and background-window targets have `focused: false`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test tests/pet/desktopSeat.test.ts`

Expected: FAIL because the current selector performs a 10% owned-seat choice and 50/50 icon/window choice instead of strict priority.

- [ ] **Step 3: Implement the minimal selector**

```ts
const focused = candidates.find((target) => target.kind === "window" && target.focused);
if (focused) return focused;
const icons = candidates.filter((target) => target.kind !== "window");
return icons[Math.floor(random() * icons.length)] ?? PENDING_OWNED_SEAT;
```

- [ ] **Step 4: Verify Task 1 GREEN**

Run: `pnpm test tests/pet/desktopSeat.test.ts`

Expected: all desktop-seat tests pass.

### Task 2: Mark and short-circuit the native focused window

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/desktop_targets.rs`

**Interfaces:**
- Modifies internal `RawWindow` and `WindowTarget` with `focused: bool`
- Keeps commands: `find_seat_targets()` and `refresh_window_seat()`

- [ ] **Step 1: Write failing Rust tests**

Add tests proving:

```rust
#[test]
fn selects_only_the_valid_focused_window() {
    let focused = RawWindow { focused: true, ..RawWindow::normal(7, 200, valid_bounds()) };
    let background = RawWindow::normal(8, 201, valid_bounds());
    let targets = visible_window_targets(vec![background, focused], work_area(), 100, 200.0);
    assert_eq!(focused_window_target(&targets).unwrap().native_id, "7");
}

#[test]
fn rejects_a_focused_uno_window_instead_of_using_a_background_window() {
    let own = RawWindow { focused: true, ..RawWindow::normal(7, 100, valid_bounds()) };
    let background = RawWindow::normal(8, 201, valid_bounds());
    let targets = visible_window_targets(vec![own, background], work_area(), 100, 200.0);
    assert!(focused_window_target(&targets).is_none());
}
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml desktop_targets::tests`

Expected: FAIL because no native target carries focus state and `focused_window_target` does not exist.

- [ ] **Step 3: Implement native focus detection**

- Add macOS dependency `objc2-app-kit = { version = "0.3.2", features = ["NSRunningApplication", "NSWorkspace"] }`.
- macOS: obtain the frontmost PID from `NSWorkspace::sharedWorkspace().frontmostApplication()` and mark matching CoreGraphics rows; their existing order chooses the frontmost eligible window of that app.
- Windows: import `GetForegroundWindow` and mark only the exact matching HWND.
- Other platforms: set `focused: false`.
- Preserve `focused` through `visible_window_targets` and `DesktopSeatTarget::window`.
- In `find_seat_targets`, return one valid focused window before calling `platform_desktop_items`; if none exists, return filtered Desktop icons only.
- Keep `refresh_window_seat` searching all valid windows by native ID, regardless of current focus.

- [ ] **Step 4: Verify Task 2 GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml desktop_targets::tests`

Expected: all desktop target tests pass.

### Task 3: Full verification

**Files:**
- No production changes expected.

**Interfaces:**
- Verifies the complete application boundary.

- [ ] **Step 1: Run all checks**

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug
```

Expected: every command exits 0 and the debug bundle is generated at `src-tauri/target/debug/bundle/macos/UNO.app`.
