# 当前上下文

- 产品：`先马·AI Studio`
- 工程：`C:\Users\Administrator\Documents\Codex\2026-07-09\w\work\centaur-desktop`
- 技术栈：Electron + 原生 HTML/CSS/JavaScript + Inno Setup
- 当前已安装基础版本：`1.0.1` / 内部版本 `1.4.54`
- 已生成测试升级版本：`1.0.2` / 内部版本 `1.4.56`；故障版 `1.4.55` 已撤回。

# 自动更新状态

- 客户端自动更新、SSE 通知、5 分钟轮询、下载、SHA-256、Ed25519 验签、更新前备份和安装重启已实现。
- 设置页已提供当前版本、更新状态、上次检查时间、“检查更新”按钮和“自动检查更新”开关。
- 设置页可查看新版本号、发布时间、安装包大小、更新标题、更新内容和最近 12 条更新记录。
- 更新后台已改为 8 MB 分片上传、3 路并行、单分片自动重试和断点续传；公网分片与恢复测试通过。
- 已撤回版本可在后台永久删除安装文件；只能删除 `revoked` 版本，审计记录保留并标记为 `deleted`。
- 更新失败后会优先复用本地已下载且通过大小、SHA-256 和数字签名校验的安装包，损坏缓存会自动删除并重新下载。
- 已修复 `flushStorageData()` 返回空值时更新前备份调用 `.catch` 报错；旧 `1.0.1` 需手动覆盖安装一次修复版。
- 发布后台和更新 API 已部署在 `/opt/xianma-update-service`。
- 管理后台信息仅保存在 `交付/自动更新后台信息.txt`。
- 旧客户端需要手动安装一次 `1.0.1` 过渡包，之后才能自动更新。
- 当前 HTTP 仅用于内测；全员发布前必须配置 HTTPS。
- 安装包未做 Authenticode 签名。

# 记忆保护

- 路由文件：`%APPDATA%\XianmaAIStudio\user-data-route.json`
- 候选资料目录：`xianma-ai-studio`、`xianma-centaur-desktop`、`xianma-ai-studio-desktop`
- 对话键：`centaur.desktop.chat.v3:<钉钉用户ID>`
- 更新备份：当前实际用户资料目录下的 `update-backups`
- 不要逐文件合并 LevelDB；缺失时使用逻辑 LocalStorage 备份恢复。

# 验证状态

- `npm run test:syntax`：通过
- `npm run test:updater`：通过
- `npm run test:update-service`：通过
- `npm run test:electron`：通过
- 打包应用真实更新检查、流式对话、钉钉配置、文件生成和预览：通过
- `npm run build`：通过
- 交付过渡包：`交付/先马·AI Studio Setup 1.0.1 自动更新修复版.exe`
- `1.0.1` 修复版 SHA-256：`88AB3EC97EF5BCAD4F41DC784690C2B3047E4AA3B2EEC08B101A57BCC59ABDE9`
- 测试升级包：`交付/先马·AI Studio Setup 1.0.2.exe`
- 测试升级包 SHA-256：`7F81B0C0FCF7DE84B6AC5A86024C583CE2B34CBBACAB60C20EF0C90A42470583`

# 下一步

1. 手动覆盖安装 `1.0.1 自动更新修复版`，然后发布 `1.0.2 / 1.4.56` 测试升级。
2. 更换服务器 root 密码。
3. 准备域名、HTTPS 和 Windows 代码签名证书。
4. 测试通过后，下一正式版本使用显示版本 `1.0.3`、内部版本 `1.4.57` 或更高版本。
