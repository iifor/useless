# 趴下动作修复设计

## 目标

修复 `IDLE_PRONE` 头部比例偏大和循环姿势跳变，同时保持同一角色身份、现有窗口裁剪机制和其他动作不变。

## 素材

- 以 `artifacts/black-shirt-companion-hatch/references/canonical-base.png` 为唯一身份参考。
- 仅重生成 `public/pet/extended-animations/idle-prone.png`：四帧横向 strip、蓝键背景、完整分离、无遮挡、无文字、无道具、无阴影。
- 四帧只表现安静趴着托腮、眨眼和极轻微晃脚；头脸、身体比例及基线保持一致，禁止换手、抬高单腿或大幅姿势变化。
- 使用 hatch-pet 的确定性去蓝流程转为透明素材，并检查蓝边、裁切、四帧尺寸和循环连续性。

## 运行时

- `IDLE_PRONE` 继续映射 `idle-prone`，帧数与 FPS 不变。
- 删除 `contentLongEdgeForPose()` 对趴下姿势的 `102px` 特例；全部动作统一使用 `119px`，让源素材负责正确比例。
- 不修改 Canvas、动态窗口、动作调度或其他 spritesheet。

## 验证

- TDD：测试先要求 `idle-prone` 与其他动作同为 `119px`，确认失败后再删除特例。
- 视觉 QA：四帧身份一致、无裁切/蓝边、头部观感接近站立、循环无明显跳变。
- 运行 `pnpm test`、`pnpm build` 和 `pnpm tauri build --debug`。
