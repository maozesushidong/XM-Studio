# 先马·AI Studio 项目记忆

> 更新时间：2026-08-04  
> 工程目录：`C:\Users\Administrator\Documents\Codex\2026-07-09\w\work\centaur-desktop`  
> 安全要求：本文不保存模型 API Key、钉钉 Secret、服务器密码、更新后台密码或签名私钥。

## 项目目标

开发公司内部 Windows 桌面 AI 应用“先马·AI Studio”，提供多会话对话、文件与文档处理、命令执行、可见浏览器自动化、技能、钉钉登录和自动更新能力。

当前统一版本目标：

```text
package/version：1.0.2
displayVersion：1.0.2
internalVersion：1.0.2
channel：stable-v2
```

旧 `stable` 通道保留用于迁移，不参与新客户端更新判断。后续版本按 `1.0.3 / 1.0.3`、`1.0.4 / 1.0.4` 递增。

## 已完成内容

### 桌面基础能力

- Electron 37 + 原生 HTML/CSS/JavaScript + Node.js。
- 产品名、主程序名、安装目录统一为“先马·AI Studio”。
- 多会话、会话重命名、置顶、删除、并行生成和停止生成。
- 普通问答走 SSE 流式快速路径。
- 前端可选择 `auto`、聊天模型和 `gpt-image-2`，主进程同步路由。
- 文件卡显示绝对路径，支持应用内预览、复制和下载。
- HTML 生成结果可直接在应用内浏览器预览。
- 支持图片、音频、视频和常见办公文档附件。

### 本机操作能力

所有会话默认具备本机操作能力，不存在工作区模式、管理员授权、用户白名单、首次授权或权限开关。

主进程工具：

```text
computer_list
computer_read
computer_write
computer_write_document
computer_copy
computer_move
computer_delete
computer_open
computer_search
computer_run
```

能力范围：

- 支持当前 Windows 账号可访问的 `C:\`、`D:\` 和其他磁盘路径。
- 支持目录查看、文件读取、新建、修改、复制、移动、删除、搜索和打开。
- 支持 PowerShell/CMD、启动程序、打开文件和调用系统默认应用。
- 支持创建 Word、PPT、Excel、PDF、文本、代码和网页。
- 仅使用当前 Windows 账号权限，不绕过 ACL 或 UAC。
- 不设置产品级操作次数、附件大小或模型执行时间限制。

### 危险操作确认

以下操作必须由用户确认：

```text
覆盖已有文件
复制并替换已有目标
移动并替换已有目标
删除文件或目录
运行任意 Shell、PowerShell 或 CMD 命令
安装或卸载软件
修改注册表、服务、启动项或计划任务
上传文件、发送消息、发布内容或提交表单
```

普通读取、新建文件、打开文件、打开网页和生成预览不弹确认。

确认规则：

- 弹窗显示操作类型、目标绝对路径和命令摘要。
- 取消、弹窗超时、窗口不可用、会话停止或应用退出时拒绝执行。
- 确认后只执行弹窗展示的本次操作。
- 前端不能直接调用 Node.js 或系统命令，所有执行均经过主进程。

相关 IPC：

```text
desktop:get-computer-operation-history
desktop:resolve-computer-operation-confirmation
desktop:computer-operation-confirmation
desktop:computer-operation-status
```

### 操作审计

审计文件：

```text
<userData>\users\<钉钉用户ID>\data\computer-operation-audit.jsonl
```

记录时间、用户、会话、动作、目标、确认结果、执行状态和错误摘要。不得记录文件正文、命令输出、模型 Key、钉钉 Token、密码或浏览器 Cookie。

### 完整运行时与浏览器

- 完整工具配置为 `tools.profile = full`。
- 浏览器插件已启用，默认使用独立、可见的自动化浏览器。
- 支持打开网页、点击、输入、下载和网页预览。
- 只有用户在当前任务明确要求连接现有浏览器时，才使用现有登录状态。
- 命令宿主使用 `ask = always`，审批失败回退为拒绝。
- `askFallback` 必须写在运行时 `exec-approvals.json`，不能写入 `tools.exec`。

### 技能与用户隔离

- 支持本地 Markdown、ZIP、文件夹和在线技能安装。
- 技能安装在后台运行，完成或失败后通知用户。
- 技能页“使用”不绑定任何对话。
- 只有在某个对话输入区选择技能时，才写入该会话的 `conversation.skillId`。
- 技能结果必须显示模型正文和真实生成文件，不能只显示“已完成”或空白结果。
- 不同钉钉用户的会话、技能、附件和应用私有文件按本机目录隔离。

### 钉钉登录

- 只提供钉钉登录，不提供普通账号密码登录。
- 钉钉身份用于本机数据隔离。
- 退出登录清除登录凭据和授权站点状态，但保留该用户本地工作数据。
- 不在前端展示钉钉 Secret、模型连接信息或底层框架名称。

## 版本与更新

当前源码配置：

```text
package.json                         1.0.2
electron/update-config.json          1.0.2 / 1.0.2 / stable-v2
electron-builder.1.0.2.json          com.xianma.ai-studio.desktop
build/先马智能体安装器.iss             固定原 AppId
```

更新服务已改为按以下组合判重：

```text
通道 + 平台 + 架构 + 内部版本
```

更新后台支持选择 `stable-v2` 或旧 `stable`，并按所选通道、平台和架构推荐下一内部版本。新客户端只检查 `stable-v2`。

当前线上状态（2026-08-04）：

- 新版更新服务已部署，后台已显示 `stable-v2` 与旧 `stable` 通道选择。
- 部署前代码、配置、签名文件和发布数据备份位于 `/opt/xianma-update-service/backups/deploy-20260804-183915`。
- 尚未在后台发布 `stable-v2 / 1.0.2`。
- 尚未发布 `stable-v2 / 1.0.3` 做真实自动更新测试。
- 旧 `stable` 版本不得提前撤回或永久删除。

## 卸载与数据保留

必须保持：

- AppId：`fa50672a-d937-5394-943a-83cc694bc2d8`。
- 安装目录：`C:\Program Files\先马·AI Studio`。
- 公共配置：`C:\ProgramData\XianmaAIStudio`。
- 数据路由：`%APPDATA%\XianmaAIStudio\user-data-route.json`。
- 新用户数据根目录：`%APPDATA%\xianma-ai-studio`。
- 兼容旧目录：`%APPDATA%\xianma-centaur-desktop` 等历史候选目录。

卸载器只清理 `{app}` 安装目录，不删除 `%APPDATA%` 或 ProgramData。`ai-config.json`、`gateway-config.json` 和 `dingtalk-config.json` 均带 `uninsneveruninstall`。

新版启动时读取 `user-data-route.json`；如路由缺失，会检查历史目录并选择包含会话且最近活动的完整目录。不得逐文件拼接或移动 Chromium LevelDB。

## 关键文件

```text
electron/main.js
```

主进程、模型路由、本机工具、确认队列、审计、技能、钉钉、文件和完整运行时。

```text
electron/preload.js
renderer/index.html
renderer/app.js
renderer/styles.css
```

安全 IPC 桥、桌面 UI、本机操作确认弹窗和交互状态。

```text
electron/update-config.json
electron/updater.js
electron/update-signing-public.pem
```

客户端版本、更新通道、更新检查、下载、验签、备份和覆盖安装。

```text
update-service/server.js
update-service/public/admin.html
update-service/docker-compose.yml
```

更新服务、管理后台和部署配置。

```text
build/先马智能体安装器.iss
scripts/build-offline-release.js
scripts/assemble-release.js
scripts/build-inno-installer.js
```

离线组装、版本资源写入、Inno 安装包和卸载规则。

```text
smoke-computer-operations.js
smoke-data-retention.js
smoke-runtime-setup.js
smoke-updater.js
```

本机能力、数据保留、运行时安装和更新器回归。

## 测试状态

全部 23 个 `test:*` 已通过。运行时安装专项单独执行，其余 22 项整套执行：

```text
npm run test:syntax
npm run test:update-service
npm run test:update-admin
npm run test:updater
npm run test:bundled
npm run test:managed-gateway
npm run test:computer-operations
npm run test:data-retention
npm run test:runtime-setup
npm run test:concurrent-chat
npm run test:document-formats
npm run test:attachments-skills
npm run test:skill-live
```

关键通过项：

- `C:\`、`D:\` 读写、搜索和复制。
- 覆盖、删除、命令的允许与拒绝。
- 拒绝后文件和系统状态不变。
- 钉钉用户审计隔离。
- 完整运行时创建 HTML、返回绝对路径并打开预览。
- `stable` 与 `stable-v2` 可存在相同内部版本，`stable-v2` 内重复版本被拒绝。
- 打包应用真实启动、内置模型和钉钉凭据可用、连接配置不下发前端。
- 打包应用普通问答首字约 `940ms`、完整约 `1136ms`。
- 主程序与安装器的文件版本、产品版本和产品名均正确。
- 打包内 `packageVersion / displayVersion / internalVersion` 均为 `1.0.2`，通道为 `stable-v2`。
- 中文界面截图无乱码，窗口控件、侧栏、输入框和品牌图标显示正常。

仍需人工环境验收：

- 在独立测试电脑执行真实卸载、重装和历史数据恢复。
- 使用 `1.0.3 / 1.0.3` 验证真实自动更新。

## 交付目标

```text
交付\先马·AI Studio Setup 1.0.2 统一版本重装版.exe
交付\先马·AI Studio Setup 1.0.2 统一版本重装版-SHA256.txt
```

```text
大小：534348061 字节
SHA-256：DC085FECF7A05AEE9A4191FBA686E77B6D6F840C783DA5EC99449FCD3154C24E
Authenticode：NotSigned
```

交付根目录的 13 个旧 EXE/ZIP 已移动到 `交付\历史版本`。最终包尚未完成 Windows Authenticode 数字签名。

## 明确边界

- 所有登录用户均可使用本机操作能力。
- 危险操作确认用于防止误操作，不是用户授权或权限分级。
- 软件只响应用户发送的任务，不在后台主动操作电脑。
- 不实现管理员远程桌面、鼠标键盘控制、屏幕采集、后台监控或无人值守远控。
- 当前只交付 Windows；macOS 后续单独设计、签名和公证。
- “不设置产品级限制”不代表绕过操作系统、磁盘、内存、网络或供应商 API 的物理限制。

## 注意事项

1. 工程不是 Git 仓库，不能依赖 Git 恢复文件。
2. 不要修改 AppId、用户数据路由或安装目录兼容逻辑。
3. 不要删除 `%APPDATA%`、ProgramData、`user-data-route.json` 或历史用户目录。
4. 不要把系统命令能力暴露给渲染进程。
5. 不要移除危险操作确认和默认拒绝逻辑。
6. 不要在前端或文档写入任何密钥、Token、密码或内部连接配置。
7. 不要把底层框架名称渲染到普通用户界面或模型回答。
8. 不要增加管理员授权、白名单、首次授权或权限开关。
9. 不要实现远控、监控或屏幕采集。
10. 不要撤回旧 `stable` 通道，直到所有用户完成统一版本重装。
11. 不要把旧同名 EXE 当作新构建；必须核对时间、版本和 SHA-256。
12. 用户机器上有正在运行的已安装版应用，测试时不要结束用户进程。

## 下一步计划

1. 在独立测试电脑卸载旧版、安装新版并检查两个钉钉用户的数据。
2. 验证安装、取消、卸载和再次安装过程。
3. 在已部署的更新后台发布 `stable-v2 / 1.0.2`。
4. 发布 `1.0.3 / 1.0.3` 验证自动下载、覆盖安装、重启和数据保留。
5. 测试通过后通知全员卸载旧版并手动安装统一版本。
6. 全员迁移完成后再撤回旧 `stable` 版本。
7. 正式全员发布前配置 HTTPS 和 Windows 代码签名。

## 推荐启动 Prompt

```text
继续实施“先马·AI Studio 1.0.2 统一版本重装计划”。

工程目录：C:\Users\Administrator\Documents\Codex\2026-07-09\w\work\centaur-desktop

先读取 memory.md、文档\自动更新使用说明.md、文档\发布与安装说明.md，并检查当前测试和交付目录。

版本必须保持：
- package/version：1.0.2
- displayVersion：1.0.2
- internalVersion：1.0.2
- channel：stable-v2

所有会话默认具备本机文件、命令和浏览器能力。危险操作必须确认；不得增加管理员授权、白名单、首次授权或权限开关；不得实现远控、监控或屏幕采集。

保持原 AppId、ProgramData 和 user-data-route.json，不得删除历史会话、钉钉状态、技能或用户文件。新客户端只检查 stable-v2，暂时不要撤回旧 stable 通道。

最终交付：
- 交付\先马·AI Studio Setup 1.0.2 统一版本重装版.exe
- 交付\先马·AI Studio Setup 1.0.2 统一版本重装版-SHA256.txt

继续直接实现、测试和打包。未完成独立测试电脑的真实卸载重装前，不要声称全量迁移已完成。
```
