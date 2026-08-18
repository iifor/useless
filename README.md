# 通用桌宠引擎

React/Tauri/Rust 行为引擎由所有角色共用；人物图片、动画和应用图标按角色独立存放，不能跨角色复用。当前支持：

- `uno`：站、坐、趴、侧躺；
- `uno-pangyu`、`uno-yan`：站、坐；
- 三个角色都启用桌面座位和文件交互能力。

运行时统一将人物可见长边归一化为 `119px`。本版本不支持应用内换肤，也不包含自动更新。

## 校验、开发与打包

```bash
pnpm install --frozen-lockfile
pnpm pet:validate --all
pnpm pet:dev uno-yan
pnpm pet:build uno-yan -- --debug
```

macOS DMG 示例：

```bash
pnpm pet:build uno -- --bundles dmg --no-sign
```

Windows x64 NSIS 示例（需在 Windows 上实际构建、运行和验收）：

```powershell
pnpm pet:build uno-pangyu -- --target x86_64-pc-windows-msvc --bundles nsis --no-sign
```

## 角色包约定

角色位于 `characters/<id>/`：

```text
character.json
canonical-base.png              # 有原始 canonical 时保留
pet/spritesheet.webp            # 标准 v2 atlas，必须包含 idle-stand
pet/extended-animations/*.png   # 四帧横向 RGBA strip
icons/icon.png
icons/icon.icns
icons/icon.ico
qa/                             # 精简 QA 证据
```

所有角色必须提供 `walk-slow-left/right/up/down`。`idlePoses` 声明额外待机素材；`desktop-seat` 要求 `search-seat`、`search-current-window`、`search-desktop-icon`、`seat-on-item`；`file-eating` 要求 `look-file`、`ask-confirm`、`eat-normal`。帧数、FPS、布局和动作逻辑由引擎固定，不写进角色配置。

## 新增角色

1. 使用 `hatch-pet` 从参考图生成并 QA canonical、标准 v2 atlas 和该角色启用能力所需的扩展动作。
2. 按上述目录写入素材、图标、精简 QA 证据和 `character.json`。
3. 运行 `pnpm pet:validate <id>`。
4. 运行 `pnpm pet:dev <id>` 或 `pnpm pet:build <id> -- <Tauri 参数>`。

只有增加全新交互能力时才修改共享引擎；新增已有能力范围内的角色只增加角色包。
