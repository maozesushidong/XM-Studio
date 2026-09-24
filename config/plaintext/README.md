# 凭证与配置快照

按仓库所有者明确授权，此目录以明文保存测试项目复现所需的配置，内容来自当前测试容器、客户端内嵌凭证和所有者提供的服务器登录信息。

- `deployment-access.json`：服务器 IP、登录用户、密码及测试地址。
- `client-credentials.json`：客户端原有内嵌模型 API Key、钉钉 Client Secret 的解密值。
- `preview-service-environment.json`：当前测试容器的真实环境变量，含管理令牌、模型网关、钉钉、MAPMS 和数据库连接配置。后台登录对应 `UPDATE_ADMIN_TOKEN`，MAPMS 登录对应 `MAPMS_ADMIN_USERNAME` 和 `MAPMS_ADMIN_PASSWORD`。
- `preview-postgres-environment.json`：测试 PostgreSQL 的数据库名、用户名和密码。
- `preview-compose.env`：服务器上测试 Compose 的原始 `.env`。
- `preview-signing-private.pem`：测试更新/技能签名私钥，与 `build/v11-preview-signing-public.pem` 配对。
- `manifest.json`：导出时间、测试镜像信息和文件 SHA-256。

客户端仍使用 `electron/bundled-ai-credential.json`、`electron/bundled-ai-key-part.json`、`electron/bundled-dingtalk-credential.json`、`electron/bundled-dingtalk-key-part.json` 原有格式。明文副本用于交接，不改变客户端凭证读取方式。服务端 Key 与客户端历史内嵌 Key 分开保存，避免用旧客户端配置覆盖当前服务端配置。

## 准备本地测试服务配置

在仓库根目录执行：

```powershell
node scripts/verify-replication-handoff.js
node scripts/prepare-preview-handoff.js
```

准备脚本只向本地 `update-service/deploy/v11-preview` 写入 `.env`、`runtime.env` 和 `secrets/update-signing-private.pem`；已有不同内容会报错，不覆盖。部署时使用生成的 Compose 环境配置，自建主机另外调整公开地址与 Nginx。不要在现有正式部署目录运行测试 Compose。

如需刷新快照，安装 Python 的 `paramiko`、`cryptography` 后执行 `python scripts/export-preview-handoff.py`。该导出只读测试服务器，不重启、不部署、不改正式服务。

有效期由所有者在外部服务中设置，导出过程没有查询或延长有效期；文件存在不能保证未来仍有效。此快照不包含 GitHub Credential Manager 的令牌，也不包含员工正文或数据库业务记录。
