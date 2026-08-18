# UNO Yan 独立桌宠设计

## 目标

从 UNO PangYu 精简版复制一套可独立安装、独立运行的桌宠应用 UNO Yan。新应用只替换应用身份和宠物视觉素材，继续复用已验证的桌面窗口、移动、目标发现、坐窗口/图标、吃文件与安全回收实现。

## 最小实现方案

- 从 `e1f9895` 创建 `pet/uno-yan` 分支和 `.worktrees/uno-yan` worktree。该提交包含 PangYu 精简动作以及后续移动、Windows 开发和打包输入修复，同时避开远端分支后来提交的 `release/` 二进制产物。
- 不新增角色配置层、工厂或通用脚手架。第三只宠物的需求尚不足以证明抽象成本合理。
- 保持现有 UNO 与 UNO PangYu 分支和安装数据不变。

## 应用身份

- 显示名：`UNO Yan`
- npm 包名：`uno-yan-desktop`
- Rust crate：`uno-yan`
- 初始版本：`0.1.0`
- Bundle ID：`com.iifor.uno-yan`
- 描述：`UNO Yan desktop pet`
- 辅助窗口标题、macOS Finder 授权说明、Windows 单实例锁和数据目录标识全部使用 Yan 身份。
- 自动更新与自动发布继续禁用，只支持本地 DMG/EXE 构建。

## 唯一角色身份

上传参考图：

`/var/folders/8n/_t7zmf6116vcy2yfy6lcr7k00000gn/T/codex-clipboard-590977ea-51c8-4785-89f5-b41a0a785203.png`

该图是唯一身份原型。生成结果严格保持像素画风和以下特征：

- 东方年轻女性 Q 版像素角色。
- 黑色短波波头、齐刘海。
- 棕色大眼睛、温和表情。
- 画面左侧头发上的黄色三角发夹和彩色糖果状发夹。
- 黄色宽松开衫、白色吊带上衣、米色抽绳高腰短裤。
- 白袜与奶白色高帮鞋。

参考图中的米白背景和地面阴影不是人物身份，不进入 canonical 或动画。所有素材必须透明背景、无遮挡、无文字、无道具、无阴影。

## Hatch Pet

- 严格使用 `hatch-pet` v2 工作流生成 `artifacts/uno-yan-hatch/`。
- 先把上传参考图复制为持久参考，再生成单人物、正面、完整全身、自然站立的 `references/canonical-base.png`。
- canonical 一经视觉批准，所有后续动画必须引用它；不得重新设计发型、发夹、服装或比例。
- 标准包必须包含 8×11 atlas、9 个标准动作行、16 个方向观察格和 `spriteVersionNumber: 2`。
- 完成逐行检查、cardinal anchors、方向盲审、连续性检查、最终 contact sheet、透明边缘检查和 package validation。
- 运行时标准 idle 继续从标准 atlas 第 0 行读取。

## 扩展动画

使用 canonical 生成以下 4 帧透明横向 strip：

- `idle-sit`
- `walk-slow-left`
- `walk-slow-right`
- `walk-slow-up`
- `walk-slow-down`
- `search-seat`
- `search-current-window`
- `search-desktop-icon`
- `seat-on-item`
- `look-file`
- `ask-confirm`
- `eat-normal`

角色动画中不绘制文件、窗口、图标、文字、确认框或阴影；这些仍由应用 UI 动态渲染。全部 strip 使用统一身份、稳定基线和清理后的透明背景。

## 动作范围

保留：

- `IDLE_STAND`
- `IDLE_SIT`
- `WALK_SLOW`（左、右、上、下）
- `SEARCH_SEAT`
- `SEARCH_CURRENT_WINDOW`
- `SEARCH_DESKTOP_ICON`
- `SEAT_ON_ITEM`
- `LOOK_AT_FILE`
- `ASK_CONFIRM`
- `EAT_NORMAL`

自动普通动作仅在站立、坐着和慢走之间切换，并保留 8% 座位彩蛋。不包含趴着、侧躺或睡觉；UNO Yan 的 `public/pet/extended-animations/` 中也不保留这些无效遗留文件。

所有动作继续采用现有运行时 alpha 边界、紧凑窗口和 `119px` 可见长边归一化。

## 应用图标

从已批准的 Yan canonical 正面形象制作独立透明方形源图，再使用 Tauri 自带 icon 命令生成 PNG、ICNS 和 ICO。图标不得复用 UNO 或 PangYu 的角色形象。

## 验收

- 动作枚举、菜单、调度和动画映射不存在 prone、lie、sleep。
- 13 个运行时 pose 均有非空素材，且视觉身份一致。
- 四向行走方向映射正确，人物不会越界或尺寸跳变。
- 当前窗口、桌面图标、落座和吃文件流程行为与 PangYu 精简版一致。
- `UNO Yan` 可与 UNO、UNO PangYu 同时安装并运行，数据和单实例锁互不干扰。
- Debug/Release 启动均不检查 UNO 的更新端点。
- 通过 `pnpm test`、`pnpm build`、Rust test/check 和 `pnpm tauri build --debug`。

