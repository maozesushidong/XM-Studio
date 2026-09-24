# GitHub 复现说明

## 获取完整资源

克隆后先安装 Git LFS 并拉取大文件：

```powershell
git lfs install
git lfs pull
```

如果只需要直接使用，运行 `release-assets/XMAI Studio Preview Setup 2.3.0.1.exe`。

## 验证安装包

```powershell
Get-FileHash -Algorithm SHA256 "release-assets/XMAI Studio Preview Setup 2.3.0.1.exe"
Get-Content "release-assets/XMAI Studio Preview Setup 2.3.0.1.sha256"
```

## 构建测试版

```powershell
npm ci
node scripts/verify-replication-handoff.js
npm run test:syntax
npm run test:company-skills
npm run test:company-skills-ui
npm run test:admin-v11
npm run build:dir
node scripts/build-requirement-preview.js
```

`scripts/build-requirement-preview.js` 会写入测试版构建配置，并检查客户端基址、通道和测试版标识。安装包不会自动上传服务器。

原始客户端加密凭证及分片已提交，`build/installer-config/` 和 `build/tools/InnoSetup/` 也已提供，不需要向原开发机器索取构建文件。仓库中的原始安装包保持原 SHA-256；重新编译会包含新构建时间，不承诺与原始 EXE 逐字节一致。

## 凭证与服务端配置

明文配置位于 `config/plaintext/`，包括服务端环境快照及客户端凭证的解密值。具体文件用途和本地准备命令见该目录的 README。克隆代码不包含员工会话、上传技能的数据卷或数据库业务记录；复用现有测试地址可使用现有测试数据，自建环境需要单独导入自己授权的数据备份。

## 测试范围

本仓库对应 `v11-preview` 测试环境。审批、待发布列表中的下载入口下载原始 ZIP；客户端对话技能菜单中的“本地文件”直接打开本机选择器。正式环境地址、正式更新通道和正式数据不在本仓库的部署目标内。
