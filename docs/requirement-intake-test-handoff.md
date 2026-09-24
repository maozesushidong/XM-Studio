# 需求提报测试版交付与开发说明

日期：2026-09-18。需求基线：AI Studio V2.1.0；软件版本沿用 2.3.0.1。仅用于测试环境，未迁移正式环境，未发布客户端更新。

## 测试入口

- 服务基址：http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM
- 管理后台：上述基址加 `/admin`，进入“需求管理”。
- 测试客户端：`dist-requirement-preview-2.3.0.1/XMAI Studio Preview Setup 2.3.0.1.exe`。
- 安装名称：XMAI Studio 测试版；安装目录：Program Files/XMAI Studio Preview。
- 独立 AppId：`d90c2a54-f9ed-4c12-885a-c6992e1d78cf`。
- 用户数据：`%APPDATA%/xianma-ai-studio-preview`；公共配置：`%ProgramData%/XianmaAIStudioPreview`。
- 更新通道：`v11-preview`，签名公钥使用测试服务公钥。正式环境变量不能覆盖测试更新基址。
- 服务容器：`xianma-v11-preview-service-1`，实际内部映射为 `127.0.0.1:18092`。正式容器使用 18091；部署脚本从容器读取端口，不再硬编码。

测试版不导入正式会话、技能或登录缓存。需自行进行一次钉钉登录，原有外部钉钉认证体验保持一致。测试包没有上传到任何更新服务。

## 使用流程

1. 登录测试客户端，左侧进入“需求提报”，描述使用 AI Studio 时的真实问题。
2. 回答主要追问，在阶段总结中选择“确认理解”或填写修正。
3. 信息充分后核对右侧摘要。先“确认摘要”，再单独“确认提交”。
4. “继续补充”不能提交；“暂不建议提交”可暂存，或确认摘要并填写理由后坚持提交。
5. 可暂存、关闭再恢复；模型失败或服务重启后使用“重试”。“放弃草稿”清除草稿正文。
6. “我的提报”查询本人已提交记录。后台“需求管理”查询、查看只读详情、单条导出 Markdown。

能力清单目前为待产品确认的候选清单，不能认定现有功能已上线。运行时能力状态为 unavailable；完整需求会保留“能力未知”的分析建议，测试者仍可按规则坚持提交。确认能力条目后才能验收“已支持能力直接引导”和基于已验证能力差距的普通提交真实效果。

## 实现位置与边界

- `update-service/requirement-intake/`：专用适配、结构校验、能力快照、模型调用、持久化、状态迁移、提交与导出。
- `renderer/requirements.js`、`requirements.css`：需求提报、当前理解、草稿、我的提报。复用现有工作台外壳。
- `electron/requirements.js`：主进程验证当前钉钉会话、兑换专用令牌、调用测试接口。钉钉令牌不暴露给渲染层。
- `update-service/public/requirements.js`、`requirements.css`：后台查询及只读详情。
- `scripts/build-requirement-preview.js`：受控资源检查、独立配置注入、打包与 Inno 安装器。
- `scripts/deploy-requirement-preview.py`：测试镜像构建、临时数据库 schema 测试、测试库备份、发布、健康检查和失败回退；发布前后比较正式服务指纹。

固定模式为 `ai_studio_requirement_intake`。模型不接收任何工具定义，不能写文件、发通知、创建编号、提交或授权开发。原始通用 Skill 只作受控方法来源，不加载其通用 agent，也不执行其中的通知或建档规则。

员工身份通过服务端调用钉钉 users/me、企业 unionId 解析及 MAPMS 组织目录校验后绑定；请求中的自报用户 ID 不决定归属。后台遵照用户决定继续采用现有姓名显示及公开管理方式，不把姓名显示当作认证。管理员权限隔离（AC-C03/契约第14节）不计为验收通过。

## API

所有路径均相对于测试服务基址。桌面接口除 session 外携带专用 Bearer 令牌。

- `POST /api/desktop/requirements/session`：主进程以当前钉钉 accessToken 交换两小时专用会话。
- `GET .../current`：当前草稿、平台 stateVersion、能力状态；异常资源或过期使旧摘要确认失效。
- `POST .../analyze`：requestId、stateVersion、action、message，可选附件元数据、retry。action 仅七类分析动作；返回持久化操作状态。
- `GET .../operations/{requestId}`：轮询一次逻辑分析；重复请求不产生重复轮次。
- `POST .../save`、`discard`、`close-resolved`、`close-out-of-scope`：草稿及关闭操作。
- `POST .../recover`：旧版分析结构恢复，保留脱敏轮次并按当前规则重新分析。
- `POST .../confirm-summary`：额外携带 summaryVersion，产生独立确认。
- `POST .../submit`：额外携带 summaryVersion、submitMode（normal/insisted）、insistReason。
- `GET .../mine?page=1&q=关键词`、`GET .../{REQ-ID}`：本人记录与详情。
- `GET /api/admin/requirements?page=1&q=关键词&exported=yes或no`：后台列表；完整 REQ 前缀按 ID 精确检索，其余匹配标题、真实问题或昵称。
- `GET /api/admin/requirements/{REQ-ID}`：只读快照。
- `POST .../{REQ-ID}/export`：requestId，返回 Markdown、文件名、exportId、sha256。
- `POST .../{REQ-ID}/export-complete`：exportId、sha256，幂等确认接收，一次有效确认只计一次导出。

冲突返回 409，不覆盖新状态；身份失效返回 401，无归属记录返回 404；异常分析结果拒收并保留上一有效状态。首次分析失败也保留输入。导出确认表示文件内容已完整接收并发起下载，不证明用户最终保存到磁盘。

## 状态与数据库

新增表前缀均为 `intake_`：schema_migrations、owners、operations、submissions、sequences、exports、audit、sessions。复用独立测试 PostgreSQL，不回落 JSON。

owners 主键与行锁保证每人一份有效草稿。所有草稿写操作校验平台 stateVersion；requestId 与内容哈希共同判断幂等。分析先保存输入，释放事务后调用模型，完成时按 pending requestId 比较更新；放弃后的迟到响应不能恢复草稿。服务重启清理中断分析并提供重试；超过六分钟的异常挂起操作在读取状态时转为可重试。

提交事务同时校验归属、版本、摘要确认、建议类型和坚持理由，锁定北京时间当日计数器，生成 REQ-YYYYMMDD-NNN，保存不可变快照并清空草稿。draft_id 唯一，重复提交不能生成多个编号；当日 999 用尽时事务回滚并保留草稿。正文不写入普通审计日志。

模型最多两次生成尝试，单次请求上限 90 秒，全局并发 2、等待队列最多 20。硬校验错误提供结构路径或正确的加权计算值，要求模型修复，平台不静默补写业务结论。不可用请求尝试现有备用模型；仍失败返回真实错误。

## 资源生成与回退

原包在 `upstream/`，八个资源的原始 SHA-256 在 `upstream-lock.json`，与原包清单核验一致。Git 禁止改写原资源换行。

能力事实候选稿是 `capability-source.json`；生成器生成 `docs/AI_CAPABILITIES.md` 和同源 capabilities.json 索引，并锁定 schema、适配规则、快照与上游资源哈希。生成与校验命令：

```powershell
node update-service/requirement-intake/generate.js
node update-service/requirement-intake/generate.js --check
```

available 条目必须具备入口和验证日期，且清单须已确认；当前清单不满足此条件，因此保留 unknown/prototype。快照默认 30 天有效，可配置。资源损坏、版本不匹配、过期不返回确定的能力结论。

部署证据在 `build/requirement-preview-deployment.json`，包含镜像、备份路径和正式服务未变更断言。回退使用上一个已验证镜像、受控资源和兼容 schema 组合；不回滚删除已提交记录。旧版分析结构会显示“恢复草稿”，保留原有草稿 ID、脱敏输入及旧分析作为上下文，按当前规则重新分析。能力复评期间暂停提交；复评后的摘要、建议方向、原建议与能力结论完全一致时保留原独立确认，内容变化则重新确认。

## 验证证据

本次交付汇总在 `build/requirement-delivery-evidence.json`，绑定安装包 SHA-256、包内源文件校验值、测试服务镜像和受控资源版本。29 组结构/数据库测试、5 组真实模型样本已通过；真实模型耗时约 51～155 秒。测试夹具通过不代表全部真实业务效果已经验收。

- `build/requirement-integration-results.json`：真实 PostgreSQL 临时 schema 的结构和事务测试；测试结束删除临时 schema，不往测试后台混入虚构提交。
- `build/requirement-live-results.json`：真实模型调用的输入、结构化结果、耗时与通过情况；与静态夹具测试分开。
- `build/requirement-live-results-before-repair.json`：首轮真实模型失败记录，保留追溯，不冒充通过。
- `build/requirement-ui/results.json`、summary-1024.png、summary-1280.png：实际组件的交互和布局验证。页面数据为明确的测试夹具。
- `build/requirement-ui/admin.png`：已部署后台真实页面。
- `build/requirement-package-test.json`：实际打包 asar 的加载、测试标识、导航、数据目录及未登录行为检查。
- `build/requirement-preview-build.json`：安装包大小、构建时间、测试地址与未上传状态。

SA-01～16 的硬校验/事务映射在 requirement-intake/test.js；它不等于全部 16 项真实模型语义验收。真实模型本轮覆盖信息不足、范围外、提示注入、能力未知的完整需求及敏感信息五类样本。其余多轮效果仍需测试部门结合真实工作场景验收。

需要人工完成的验收：测试版全新钉钉扫码、本人真实需求从分析到后台导出的端到端过程；能力清单确认后直接解决/部分支持等分支的真实效果；正文保留周期、容量目标和正式迁移时机。测试版与正式版若同时处于扫码过程，现有钉钉注册回调端口 17891 可能占用，应结束一个扫码窗口后再重试，不能擅自更换尚未注册的回调地址。

## 常用命令

```powershell
npm run test:syntax
node update-service/requirement-intake/test.js
node scripts/test-requirement-update-isolation.js
.\node_modules\.bin\electron.cmd scripts/test-requirement-ui.js
node scripts/build-requirement-preview.js
.\node_modules\.bin\electron.cmd scripts/test-requirement-package.js
```

数据库集成测试需要 DATABASE_URL；部署脚本通过 XIANMA_SERVER_PASSWORD 读取 SSH 凭据。两者均从环境提供。正式迁移必须在测试验收后另行执行；不复制测试草稿、模拟提交或测试统计，不直接给正式用户推送这个测试安装包。
