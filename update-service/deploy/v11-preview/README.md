# V1.1 独立测试服务

该部署与正式更新服务完全隔离：

- 独立容器：`xianma-v11-preview`
- 独立 PostgreSQL 卷：`xianma_v11_preview_postgres`
- 独立文件卷：`xianma_v11_preview_data`
- 独立更新通道：`v11-preview`
- 独立访问路径：当前测试路径记录在 `config/plaintext/deployment-access.json`
- 正式服务数据和正式 `stable-v2` 通道不受影响

## 部署顺序

1. 把整个 `update-service` 目录上传到服务器的独立目录。
2. 在 `deploy/v11-preview` 中复制 `.env.example` 为 `.env` 并填写真实配置。
3. 生成独立 Ed25519 私钥到 `secrets/update-signing-private.pem`。
4. 生成至少 32 位随机访问路径，并替换 Nginx 模板中的 `__V11_PREVIEW_PATH__`。
5. 执行 `docker compose up -d --build`。
6. 检查 `http://127.0.0.1:18091/health`。
7. 加载 Nginx 配置并执行 `nginx -t` 后重载。
8. 客户端测试配置指向随机路径，更新通道设为 `v11-preview`。

本次所有者明确授权的复现快照已在 `config/plaintext/` 中提交真实环境配置与测试签名私钥。可在仓库根目录执行 `node scripts/prepare-preview-handoff.js`，将该快照准备到本地部署目录；该命令不会连接服务器或启动容器。部署到不同主机时，应修改测试公开地址及反向代理配置。
