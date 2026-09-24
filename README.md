# XMAI Studio 测试版

这是 XMAI Studio 当前测试版快照，包含客户端源码、测试服务端与管理后台源码、构建脚本、构建运行资源，以及可直接安装的 Windows 测试包。

## 直接使用

安装包位于：

```text
release-assets/XMAI Studio Preview Setup 2.3.0.1.exe
```

安装后启动“XMAI Studio 测试版”即可。安装包已固定连接测试服务端：

```text
http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM
```

安装包的 SHA-256 在同目录的 `.sha256` 文件中。

## 从源码复现

环境要求：Windows x64、Node.js、npm 和 Git LFS。构建使用的 Inno Setup 编译器与配置随仓库提供；只读刷新服务端配置时另外需要 Python、paramiko 和 cryptography。

```powershell
git lfs install
git lfs pull
node scripts/verify-replication-handoff.js
npm ci
npm run test:syntax
npm run build:dir
node scripts/build-requirement-preview.js
```

新的安装包会生成在：

```text
dist-requirement-preview-2.3.0.1/XMAI Studio Preview Setup 2.3.0.1.exe
```

构建用的 Node 运行时、媒体工具和运行时归档已放在 `build/` 并由 Git LFS 管理，因此不需要从正式服务器下载资源。

## 测试服务端

服务端源码在 `update-service/`，管理后台静态资源在 `update-service/public/`。测试后台地址：

```text
http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM/admin
```

测试部署脚本只使用 `/opt/xianma-v11-preview` 和 `v11-preview` 通道，不能用于正式服务部署。

## 主要功能

- 多模型桌面对话与模型选择
- 浏览器操作、本地文件处理和附件上下文
- 个人技能、企业技能、在线技能与 GitHub 技能导入
- 技能 ZIP 下载、企业技能审批、待发布和发布管理
- 需求提报测试模块
- 定时任务与可暂停执行
- 文档、图片、音视频处理
- 测试版更新与独立用户数据目录

## 凭证说明

按仓库所有者明确要求，项目复现所需的真实配置已纳入版本管理。`config/plaintext/` 提供服务器登录信息、客户端解密凭证、测试服务端环境变量、数据库配置和测试签名私钥；`electron/` 保留原始四个加密凭证及分片文件。目录和使用方法见 [凭证与配置说明](config/plaintext/README.md)。

这些配置是导出时的快照；有效期由所有者在外部服务中管理，本仓库不延长有效期。现有测试安装包未被修改。

正式服务端和正式客户端不属于这个测试仓库。
