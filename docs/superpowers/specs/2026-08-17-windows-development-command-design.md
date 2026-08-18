# Windows 本地开发命令设计

## 目标

为 Windows x64 开发者提供稳定的 `pnpm dev:windows` 命令。该命令自动加载 Visual Studio C++ 构建环境并临时选择 Rust 1.86 MSVC 工具链，从根源上避免 GNU 工具链缺少 `dlltool.exe` 导致的 Tauri 开发启动失败。

## 用户入口

```powershell
pnpm dev:windows
```

命令在当前终端持续运行并输出 Vite、Cargo 和 Tauri 日志。用户按 `Ctrl+C` 停止开发环境。

现有 `pnpm dev`、`pnpm tauri dev` 和 `pnpm build:windows` 保持不变。

## 结构

新增 `scripts/dev-windows.mjs`，负责：

1. 拒绝非 Windows 平台和非 x64 架构。
2. 复用 `scripts/build-windows.mjs` 已有的 Visual Studio 2022 `VsDevCmd.bat` 查找逻辑。
3. 在子进程环境中设置 `RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc`。
4. 通过 `cmd.exe` 加载 MSVC x64 环境。
5. 执行 `pnpm exec tauri dev --target x86_64-pc-windows-msvc`。
6. 继承当前终端的标准输入、输出和错误输出，并将非零退出码返回给调用者。

`package.json` 新增：

```json
"dev:windows": "node scripts/dev-windows.mjs"
```

## 命令与引号

传给 `cmd.exe` 的开发命令由纯函数生成：

```text
call "<VsDevCmd.bat>" -no_logo -arch=x64 && set "RUSTUP_TOOLCHAIN=1.86.0-x86_64-pc-windows-msvc" && pnpm exec tauri dev --target x86_64-pc-windows-msvc
```

启动 `cmd.exe` 时沿用正式 Windows 构建已验证的逐字参数传递方式，确保 `Program Files (x86)` 等含空格和括号的路径不会被 Node 再次转义破坏。

## 错误处理

- 非 Windows：明确提示 `pnpm dev:windows 仅支持 Windows`。
- 非 x64：报告当前架构并停止。
- 未找到 Visual Studio 2022 C++ 构建环境：复用现有中文错误提示。
- Rust、Tauri 或 Vite 启动失败：保留原始终端输出，并让 `pnpm dev:windows` 以相同的非零状态结束。
- 不调用 `rustup default`，不修改用户的全局 Rust 设置。

## 测试

新增 `tests/release/windowsDev.test.js`，通过依赖注入验证：

- 命令包含 Visual Studio 初始化、Rust 1.86 MSVC 和显式 MSVC target。
- Visual Studio 路径含空格和括号时仍保持正确引号。
- Windows x64 路径按正确顺序查找环境并启动 `cmd.exe`。
- `cmd.exe` 使用当前项目根目录、继承终端并启用逐字参数传递。
- 非 Windows、非 x64 和子进程非零退出均被正确拒绝或传播。

完成后运行聚焦测试、完整前端测试，并实际启动到 Tauri 开发进程出现就绪信息后停止，确认 `dlltool.exe` 错误不再出现。
