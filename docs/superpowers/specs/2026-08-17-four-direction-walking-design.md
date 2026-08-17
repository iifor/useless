# 四方向自由行走设计

## 目标

- 移除所有行走路径的 30° 垂直夹角限制。
- 普通散步可以向任意方向移动，不再以左右移动为主。
- 增加向上、向下两组慢走动画；斜向移动按主轴选择四方向动画。

## 路径与方向

- 随机散步继续采样 `240–720 CSS px`，角度改为完整的 `0–360°`。
- 目标点只做显示器可用区域夹取；夹取后直接移动，不再生成低斜率折返点。
- 走向窗口、桌面图标和文件时同样采用夹取后的直线路径。
- 方向规则：
  - `abs(dy) > abs(dx)` 且 `dy < 0`：`up`
  - `abs(dy) > abs(dx)` 且 `dy >= 0`：`down`
  - 其余情况按 `dx` 选择 `left` 或 `right`
- 目标与当前位置重合时保持当前方向，不触发额外移动。

## 动画

- 保留现有 `walk-slow-left` 和 `walk-slow-right`。
- 使用 `canonical-base.png` 作为唯一身份参考新增：
  - `walk-slow-up.png`：背面视角，小步向屏幕上方走。
  - `walk-slow-down.png`：正面视角，小步向屏幕下方走。
- 每组为 4 帧横向 strip，蓝键背景经官方 `remove_chroma_key.py` 转透明。
- 不绘制文字、图标、窗口、道具或阴影；继续使用运行时人物尺寸归一化。

## 代码范围

- 扩展 `Direction` 为 `left | right | up | down`。
- 扩展 `PetPose`、`PET_POSES`、`ANIMATIONS` 和 `poseForAction()`。
- 简化 `planWalkPath()` 为夹取目标后的单段直线路径。
- `randomWalkTarget()` 改为全角度候选，并保持屏幕边界与距离退化规则。
- `moveWindowTo()` 继续复用 AbortSignal、速度和窗口边界逻辑。

## 验证

- 四个象限和主轴边界正确映射四方向动画。
- 随机值覆盖上下左右及斜向目标。
- 指定目标返回单段路径并精确到达夹取后的目标。
- 所有路径不越出显示器可用区域，Abort 后停止移动。
- 两组新动画完成身份、透明背景、四帧、裁切和尺寸跳变 QA。
- 运行 `pnpm test`、`pnpm build`、`cargo test`、`cargo check` 和 `pnpm tauri build --debug`。

