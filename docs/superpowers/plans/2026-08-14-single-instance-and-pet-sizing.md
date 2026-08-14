# Single Instance and Pet Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate UNO pets and reduce the visible size of every pose, with an additional correction for `idle-prone`.

**Architecture:** Tauri's official single-instance plugin rejects later processes and focuses the existing main window. The renderer keeps alpha-bound normalization but obtains its target long edge from the current pose: 170px normally and 145px for `idle-prone`.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Canvas, Vitest.

## Global Constraints

- Only one UNO process may create a pet window per user session.
- The single-instance plugin is registered before every other Tauri plugin.
- Default visible long edge is exactly `170px`; `idle-prone` is exactly `145px`.
- Dynamic alpha cropping retains `8px` padding.
- Menus, confirmation UI, target icons, and the `280×320` interaction window are unchanged.

---

### Task 1: Add pose-aware visible sizing

**Files:**
- Modify: `tests/pet/animation.test.ts`
- Modify: `src/pet/animations.ts`
- Modify: `src/pet/PetRenderer.tsx`

**Interfaces:**
- Produces: `contentLongEdgeForPose(pose: PetPose): number`
- Consumes: existing `normalizedContentScale(bounds, targetLongEdge)` and `computeAnimationViewport()`

- [ ] **Step 1: Write the failing size test**

```ts
test("uses a smaller default pet size and a prone visual correction", () => {
  expect(contentLongEdgeForPose("idle-stand")).toBe(170);
  expect(contentLongEdgeForPose("idle-sit")).toBe(170);
  expect(contentLongEdgeForPose("idle-prone")).toBe(145);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test tests/pet/animation.test.ts`

Expected: FAIL because `contentLongEdgeForPose` does not exist and the renderer still uses `200`.

- [ ] **Step 3: Implement the minimal size rule**

```ts
export const contentLongEdgeForPose = (pose: PetPose): number =>
  pose === "idle-prone" ? 145 : 170;
```

In `PetRenderer`, compute the target once per pose and use it in both the alpha-analysis and whole-frame fallback branches:

```ts
const targetLongEdge = contentLongEdgeForPose(pose);
contentScale = normalizedContentScale(bounds, targetLongEdge);
contentScale = targetLongEdge / Math.max(source.width, source.height);
```

- [ ] **Step 4: Verify Task 1 GREEN**

Run: `pnpm test tests/pet/animation.test.ts`

Expected: all animation tests pass.

### Task 2: Enforce one Tauri application instance

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Adds: official Rust dependency `tauri-plugin-single-instance = "2"`
- Keeps: existing `instance_position::position_main_window()` for the first process only

- [ ] **Step 1: Add the official dependency**

Add `tauri-plugin-single-instance = "2"` to Rust dependencies. Do not add a frontend package because this plugin exposes no UI command needed by UNO.

- [ ] **Step 2: Register it first and focus the existing window**

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = window.show().and_then(|_| window.set_focus()) {
                eprintln!("UNO 已在运行，但无法聚焦现有窗口: {error}");
            }
        }
    }))
    .plugin(tauri_plugin_dialog::init())
```

The official plugin owns cross-process locking; do not duplicate its internals with a project unit test.

- [ ] **Step 3: Verify Rust integration**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit 0.

### Task 3: Full build and runtime verification

**Files:**
- No production changes expected.

**Interfaces:**
- Verifies the complete desktop application.

- [ ] **Step 1: Run all automated checks**

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug
```

Expected: every command exits 0 and `src-tauri/target/debug/bundle/macos/UNO.app` is regenerated.

- [ ] **Step 2: Verify one running instance**

Quit all old UNO processes once, launch the regenerated app, then launch the same bundle again. Confirm one pet remains and the existing main window receives focus.

- [ ] **Step 3: Verify visual size**

Switch between stand, sit, walk, lie, sleep, and prone. Confirm ordinary poses use a visible long edge near 170 logical pixels, prone uses about 145 logical pixels, and compact windows retain 8px padding without clipping.
