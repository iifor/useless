# 无用 U·N·O

Useless 它的存在没什么大用，既不能帮你赚钱也不能处理工作，但它在这里，就是最大的用处。

## 正式发布

`pnpm release` 只负责检查仓库、选择 `major / minor / patch`、同步版本、运行测试、创建发布提交与标签，并原子推送 `master` 和标签。GitHub Actions 随后构建并发布 macOS Universal DMG、Windows x64 NSIS 和自动更新文件。

首次启用前，在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

- Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_PRIVATE_KEY_BASE64`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET`、`AZURE_TENANT_ID`
- Variables：`TAURI_UPDATER_PUBLIC_KEY`、`APPLE_SIGNING_IDENTITY`、`AZURE_ARTIFACT_SIGNING_ENDPOINT`、`AZURE_ARTIFACT_SIGNING_ACCOUNT`、`AZURE_ARTIFACT_SIGNING_PROFILE`

Updater 密钥只生成一次：

```bash
pnpm tauri signer generate -w /安全的离线目录/uno-updater.key
```

私钥内容放入 `TAURI_SIGNING_PRIVATE_KEY`，对应公钥内容放入 `TAURI_UPDATER_PUBLIC_KEY`。私钥和密码必须离线备份，不能提交到 Git。

发布命令：

```bash
pnpm release
```

脚本要求当前分支为 `master`、工作树干净、`origin` 为 `https://github.com/iifor/useless.git`。构建检查失败会恢复版本文件；如果 atomic push 失败，本地发布提交和标签会保留，可修复网络或权限后重试：

```bash
git push --atomic origin master vX.Y.Z
```

`0.2.0` 是首个包含 Updater 的基线版本，需要用户手工安装一次；从 `0.2.1` 开始，Release 版会在启动 15 秒后检查更新，之后每 6 小时检查。更新下载并验签后，系统空闲 5 分钟且宠物没有交互时自动安装并重启。Debug 构建不检查更新。
