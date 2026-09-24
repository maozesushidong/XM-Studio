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

环境要求：Windows x64、Node.js、npm、Python、Inno Setup 和 Git LFS。

```powershell
git lfs install
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

仓库不保存服务器密码、模型 API Key、钉钉密钥、数据库密码或 GitHub 登录密码。客户端和服务端的测试功能可以直接使用已部署的测试环境；需要自行部署服务端时，请通过环境变量或部署平台注入凭证，不要把凭证写入源代码。

正式服务端和正式客户端不属于这个测试仓库。
