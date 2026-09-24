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
npm run test:syntax
npm run test:company-skills
npm run test:company-skills-ui
npm run test:admin-v11
npm run build:dir
node scripts/build-requirement-preview.js
```

`scripts/build-requirement-preview.js` 会写入测试版构建配置，并检查客户端基址、通道和测试版标识。安装包不会自动上传服务器。

## 测试范围

本仓库对应 `v11-preview` 测试环境。审批、待发布列表中的下载入口下载原始 ZIP；客户端对话技能菜单中的“本地文件”直接打开本机选择器。正式环境地址、正式更新通道和正式数据不在本仓库的部署目标内。
