# UNO Yan

独立的汉服桌面宠物，可与 UNO 同时安装和运行。

## 本地运行

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

## 验证

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

## 本地打包

macOS：

```bash
pnpm dmg
```

Windows x64：

```powershell
pnpm build:windows
```

Windows 产物为 `release/UNO-Yan.exe` 和 `release/UNO-Yan-Setup.exe`。

第一版不包含自动更新或自动发布流程。
