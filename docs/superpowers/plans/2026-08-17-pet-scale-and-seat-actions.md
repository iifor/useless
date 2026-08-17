# Pet Scale and Seat Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 再缩小宠物 30%，并在动作菜单中提供可独立触发的聚焦窗口座位和桌面图标座位。

**Architecture:** 继续复用现有运行时 alpha 归一化渲染和 `seatSequence`。现有 Rust 目标命令增加一个受 serde 校验的搜索模式；自动模式保持优先级，两个手工模式只返回各自类别。

**Tech Stack:** React、TypeScript、Vitest、Tauri 2、Rust、serde。

## Global Constraints

- 不修改任何 spritesheet、标准 pet contract 或文件安全逻辑。
- 自动座位顺序保持：聚焦窗口 → 桌面图标 → 延迟自建文件。
- 手工动作找不到目标时恢复站立，不回退、不创建文件。
- 不新增依赖或第二套平台目标提供器。

---

### Task 1: 缩小统一人物尺寸

**Files:**
- Modify: `tests/pet/animation.test.ts`
- Modify: `src/pet/animations.ts`

**Interfaces:**
- Produces: `contentLongEdgeForPose(pose)` 普通动作返回 `119`，趴姿返回 `102`。

- [ ] **Step 1: Write the failing test**

```ts
expect(contentLongEdgeForPose("idle-stand")).toBe(119);
expect(contentLongEdgeForPose("idle-sit")).toBe(119);
expect(contentLongEdgeForPose("idle-prone")).toBe(102);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pet/animation.test.ts`
Expected: FAIL，实际值仍为 `170/170/145`。

- [ ] **Step 3: Write minimal implementation**

```ts
export const contentLongEdgeForPose = (pose: PetPose): number =>
  pose === "idle-prone" ? 102 : 119;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pet/animation.test.ts`
Expected: PASS。

### Task 2: 增加三个目标搜索模式

**Files:**
- Modify: `tests/pet/desktopSeat.test.ts`
- Modify: `src/pet/desktopSeat.ts`
- Modify: `src-tauri/src/desktop_targets.rs`

**Interfaces:**
- Produces: `type SeatSearchMode = "auto" | "focused-window" | "desktop-icon"`。
- Produces: `findSeatTarget(mode?: SeatSearchMode, random?: () => number): Promise<DesktopSeatTarget | null>`。
- Produces: Rust `SeatSearchMode` 参数和 `find_seat_targets(app, mode)` 命令。

- [ ] **Step 1: Write failing TypeScript tests**

```ts
expect(chooseSeatTarget([icon, focused], "focused-window", values(0))).toEqual(focused);
expect(chooseSeatTarget([icon, focused], "desktop-icon", values(0))).toEqual(icon);
expect(chooseSeatTarget([], "focused-window", values(0))).toBeNull();
expect(chooseSeatTarget([], "desktop-icon", values(0))).toBeNull();
expect(isPendingOwnedSeat(chooseSeatTarget([], "auto", values(0))!)).toBe(true);
```

- [ ] **Step 2: Run TypeScript test to verify it fails**

Run: `pnpm vitest run tests/pet/desktopSeat.test.ts`
Expected: FAIL，因为 `chooseSeatTarget` 尚不接受模式且不会返回 `null`。

- [ ] **Step 3: Write failing Rust mode test**

```rust
assert_eq!(serde_json::from_str::<SeatSearchMode>(r#""auto""#).unwrap(), SeatSearchMode::Auto);
assert_eq!(serde_json::from_str::<SeatSearchMode>(r#""focused-window""#).unwrap(), SeatSearchMode::FocusedWindow);
assert!(serde_json::from_str::<SeatSearchMode>(r#""unknown""#).is_err());
```

- [ ] **Step 4: Run Rust test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml desktop_targets::tests::parses_seat_search_modes`
Expected: FAIL，因为 `SeatSearchMode` 尚不存在。

- [ ] **Step 5: Implement the minimal shared mode path**

```ts
export type SeatSearchMode = "auto" | "focused-window" | "desktop-icon";
```

`desktopItemProvider.findSeatCandidates(mode)` 调用 `invoke("find_seat_targets", { mode })`。`auto` 继续选择聚焦窗口、图标或延迟自建座位；两个手工模式只从对应类别随机选择，空集合返回 `null`。自建文件的坐标重查固定使用 `desktop-icon`。

Rust 使用：

```rust
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SeatSearchMode { Auto, FocusedWindow, DesktopIcon }
```

`FocusedWindow` 只返回合格聚焦窗口；`DesktopIcon` 跳过窗口返回短路并读取桌面图标；`Auto` 保持原优先顺序。

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run tests/pet/desktopSeat.test.ts && cargo test --manifest-path src-tauri/Cargo.toml desktop_targets::tests`
Expected: PASS。

### Task 3: 将两个搜索模式接入动作菜单

**Files:**
- Modify: `tests/pet/actionMenu.test.ts`
- Modify: `tests/pet/actions.test.ts`
- Modify: `src/pet/actions.ts`
- Modify: `src/pet/actionMenu.ts`
- Modify: `src/pet/animations.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `PetAction.SEARCH_CURRENT_WINDOW` 和 `PetAction.SEARCH_DESKTOP_ICON`。
- Consumes: `findSeatTarget("focused-window")`、`findSeatTarget("desktop-icon")`。

- [ ] **Step 1: Write failing action/menu tests**

```ts
expect(MANUAL_ACTIONS).toContain(PetAction.SEARCH_CURRENT_WINDOW);
expect(MANUAL_ACTIONS).toContain(PetAction.SEARCH_DESKTOP_ICON);
expect(poseForAction(PetAction.SEARCH_CURRENT_WINDOW, "right")).toBe("search-seat");
expect(poseForAction(PetAction.SEARCH_DESKTOP_ICON, "right")).toBe("search-seat");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/pet/actionMenu.test.ts tests/pet/actions.test.ts`
Expected: FAIL，因为两个动作值尚不存在。

- [ ] **Step 3: Implement the minimal menu and flow wiring**

在现有 enum 和 `MANUAL_ACTIONS` 追加两个动作，标签分别为“坐到当前窗口”和“寻找桌面图标”；`poseForAction` 复用 `search-seat`。`seatSequence(mode = "auto")` 调用对应模式并在目标为 `null` 时返回；自动调度仍调用默认模式，两个手工动作传入各自模式。

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run tests/pet/actionMenu.test.ts tests/pet/actions.test.ts tests/pet/desktopSeat.test.ts tests/pet/animation.test.ts`
Expected: PASS。

### Task 4: 全量验证

**Files:**
- Verify only.

- [ ] **Step 1: Run frontend verification**

Run: `pnpm test && pnpm build`
Expected: 所有测试通过，TypeScript/Vite 构建成功。

- [ ] **Step 2: Run Rust verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 所有测试通过，无编译错误。

- [ ] **Step 3: Run debug bundle verification**

Run: `pnpm tauri build --debug`
Expected: debug app/bundle 构建成功。
