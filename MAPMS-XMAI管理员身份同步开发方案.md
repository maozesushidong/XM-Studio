# MAPMS 与 XMAI Studio 管理员身份同步开发方案

## 1. 文档信息

- 方案名称：MAPMS 嵌入 XMAI Studio 管理后台的管理员身份同步
- 编制日期：2026-09-01
- 实施状态：待开发、待联调
- 适用系统：
  - MAPMS 管理平台：http://xmjh.aipro123.top:8866
  - XMAI Studio 正式服务：http://47.96.184.148/xianma-updates
  - XMAI Studio 管理页面：http://47.96.184.148/xianma-updates/admin
- 本方案只描述开发与迁移方法，不执行生产部署。

### 当前实施决策

2026-09-01 已确认本阶段允许直接信任 MAPMS 前端提供的管理员信息，不要求防止浏览器开发者工具修改。当前实际实施采用以下简化链路：

~~~text
MAPMS 前端读取 mapms-admin-auth
-> 通过指定目标源 postMessage 发送管理员 ID、登录名和显示名
-> XMAI 前端通过管理请求头透传
-> XMAI 服务端直接保存创建人和审计操作人
~~~

对应实现文件：

- integrations/mapms/XianmaAiStudioView.vue：MAPMS 源码集成版本。
- integrations/mapms/XianmaAiStudioView-it03T58n.js：当前 MAPMS 生产 chunk 的可替换版本。
- update-service/public/admin-v11.js：XMAI 接收、缓存与请求头透传。
- update-service/company-skills.js：XMAI 创建人和审计落库。

本文后续的签名凭证方案保留为未来安全升级方案，不是本阶段上线前置条件。

## 2. 背景与问题

MAPMS 当前通过 iframe 嵌入 XMAI Studio 管理页面。生产前端的核心结构相当于：

~~~html
<iframe src="http://47.96.184.148/xianma-updates/admin"></iframe>
~~~

MAPMS 已经知道当前登录管理员是谁，例如管理员“黄则”，但 iframe 只获得了 XMAI 页面地址，没有获得当前 MAPMS 管理员身份。因此 XMAI 只能显示默认名称，或者把操作记录为“平台管理员”，无法准确记录真实操作人。

两个页面属于不同源：

~~~text
MAPMS：http://xmjh.aipro123.top:8866
XMAI：http://47.96.184.148
~~~

浏览器同源策略会阻止 XMAI iframe 直接读取 MAPMS 的 Pinia 状态、Cookie、Local Storage 或页面变量。因此，单纯修改 XMAI 前端无法可靠取得 MAPMS 当前登录用户，必须由 MAPMS 主动、安全地传递身份。

## 3. 建设目标

本次开发需要达到以下结果：

1. MAPMS 中登录的是谁，XMAI 管理页面就显示谁的管理员昵称。
2. XMAI 的审批、发布、驳回、删除、下架、分类管理等后台操作，记录真实 MAPMS 管理员。
3. 身份以稳定管理员 ID 为主键，昵称变化后不影响历史责任追踪。
4. MAPMS 管理员切换账号、退出或凭证过期后，XMAI 能及时更新或清除身份。
5. XMAI 不接收、不保存 MAPMS 原始登录 Token 和密码。
6. 兼容迁移期间旧页面与旧接口，避免一次切换造成管理后台不可用。
7. 后续 XMAI 服务迁移到其他域名时，仅修改配置，不重写整套身份逻辑。

## 4. 不在本次范围内

1. 不合并 MAPMS 与 XMAI 的账号数据库。
2. 不允许 XMAI 直接读取 MAPMS 数据库。
3. 不把 MAPMS 原始登录 Token 透传给 XMAI。
4. 不通过 iframe URL 查询参数传递姓名、用户 ID 或 Token。
5. 不把历史“平台管理员”记录批量改成当前管理员。
6. 不以一个普通的 x-admin-name 请求头作为可信身份依据。
7. 不改变 MAPMS 现有管理员登录流程和权限模型。

## 5. 总体方案

采用“MAPMS 签发 XMAI 专用短时身份凭证，父页面通过 postMessage 传递，XMAI 服务端验签”的方案。

### 5.1 调用流程

~~~text
管理员登录 MAPMS
        |
        v
MAPMS 前端请求当前管理员的 XMAI 身份凭证
        |
        v
MAPMS 后端校验登录状态和管理员权限
        |
        v
MAPMS 后端签发 2 分钟有效的 XMAI 专用签名凭证
        |
        v
MAPMS 父页面通过指定目标源 postMessage 发给 XMAI iframe
        |
        v
XMAI 前端仅接收可信 MAPMS 源发送的凭证
        |
        v
XMAI 前端调用管理接口时携带 X-XMAI-Admin-Context
        |
        v
XMAI 服务端验签、校验签发方、接收方、有效期和权限
        |
        v
XMAI 使用可信身份展示管理员昵称并写入审计记录
~~~

### 5.2 为什么必须由 XMAI 服务端验签

浏览器前端显示的任何姓名都可以被本机开发者工具修改。只有 XMAI 服务端验证过签名的身份，才可以用于发布、删除、审批等敏感操作和审计记录。

前端传来的 displayName 只用于界面即时展示，不可直接作为服务端审计依据。服务端审计必须从已验签凭证中取值。

## 6. 身份数据规范

MAPMS 向 XMAI 提供以下字段：

| 字段 | 必填 | 用途 |
| --- | --- | --- |
| adminId | 是 | MAPMS 中稳定且唯一的管理员 ID，作为审计主键 |
| username | 是 | 管理员登录名，用于定位账号 |
| displayName | 是 | 当前管理员昵称，XMAI 页面主要显示此字段 |
| roles | 是 | 当前管理员角色列表 |
| permissions | 否 | 与 XMAI 管理功能有关的权限代码 |
| issuedAt | 是 | 凭证签发时间 |
| expiresAt | 是 | 凭证过期时间 |
| tokenId | 是 | 本次凭证唯一编号，用于审计和防重放 |

### 6.1 昵称取值顺序

为避免后台再次显示真实姓名，MAPMS 应按以下顺序产生 displayName：

1. 钉钉昵称。
2. MAPMS 明确维护的展示昵称。
3. 管理员登录名。

不得把真实姓名作为默认优先值。若 MAPMS 当前没有钉钉昵称字段，需要先补充昵称字段或完成钉钉昵称同步。

### 6.2 建议的签名载荷

建议采用 JWT 或等效的有签名紧凑凭证。载荷示例：

~~~json
{
  "iss": "mapms",
  "aud": "xmai-admin",
  "sub": "mapms-admin-1024",
  "username": "huangze",
  "displayName": "黄则",
  "roles": ["ADMIN"],
  "permissions": ["XMAI_ADMIN"],
  "iat": 1788195600,
  "exp": 1788195720,
  "jti": "b2e9550d-4884-4859-a851-0c87bb488d55"
}
~~~

约束如下：

- iss 固定为 mapms。
- aud 固定为 xmai-admin。
- sub 必须是不可变的 MAPMS 管理员唯一 ID，不使用昵称。
- 有效期建议 120 秒，最长不得超过 5 分钟。
- jti 每次签发必须唯一。
- 只写必要身份字段，不写手机号、密码、MAPMS 登录 Token 等敏感信息。

## 7. MAPMS 后端开发

### 7.1 新增接口

~~~http
POST /api/admin/v1/integrations/xmai/context
Authorization: Bearer <当前 MAPMS 管理员登录 Token>
Content-Type: application/json
~~~

请求体可为空。MAPMS 后端根据当前登录会话取得管理员身份，不允许前端在请求体中指定 adminId、username 或 displayName。

成功响应：

~~~json
{
  "code": "0",
  "message": "OK",
  "data": {
    "contextToken": "<XMAI 专用短时签名凭证>",
    "expiresAt": "2026-09-01T16:02:00+08:00",
    "displayName": "黄则"
  }
}
~~~

失败响应：

- 401：MAPMS 登录失效。
- 403：当前用户不是管理员，或没有 XMAI 管理权限。
- 423：账号被禁用或锁定。
- 500：凭证签发失败。

### 7.2 后端校验顺序

1. 校验 MAPMS 登录会话。
2. 查询当前管理员最新状态。
3. 校验账号启用、未锁定。
4. 校验 XMAI 管理权限。
5. 获取稳定管理员 ID、登录名和钉钉昵称。
6. 签发短时 XMAI 专用凭证。
7. 记录签发日志，但不得记录完整凭证。

### 7.3 签名算法和密钥

推荐使用 Ed25519 或 RS256：

- 私钥只保存在 MAPMS 后端。
- XMAI 服务端只配置公钥。
- 私钥不得进入前端构建产物、Git 仓库或接口响应。
- 身份凭证必须使用独立密钥，不得复用安装包签名、技能包签名或 API Key。
- 配置 keyId，为以后轮换密钥预留空间。

建议环境变量：

~~~text
XMAI_IDENTITY_ISSUER=mapms
XMAI_IDENTITY_AUDIENCE=xmai-admin
XMAI_IDENTITY_PRIVATE_KEY_PATH=/run/secrets/xmai-identity-private.pem
XMAI_IDENTITY_KEY_ID=mapms-xmai-2026-01
XMAI_IDENTITY_TTL_SECONDS=120
~~~

## 8. MAPMS 前端开发

### 8.1 iframe 页面职责

MAPMS 的 XianmaAiStudioView 页面需要：

1. 使用 ref 获取 iframe。
2. iframe 加载完成后获取一次身份凭证并发送。
3. 收到 XMAI 的身份请求消息时重新发送。
4. 每 90 秒刷新一次短时凭证。
5. 当前 MAPMS 管理员变化时立即刷新身份。
6. MAPMS 退出时向 iframe 发送身份清除消息。
7. 页面销毁时清理定时器和 message 监听器。

### 8.2 消息协议

XMAI 主动请求身份：

~~~json
{
  "type": "XMAI_ADMIN_CONTEXT_REQUEST",
  "protocolVersion": 1
}
~~~

MAPMS 返回身份：

~~~json
{
  "type": "XMAI_ADMIN_CONTEXT",
  "protocolVersion": 1,
  "contextToken": "<短时签名凭证>",
  "expiresAt": "2026-09-01T16:02:00+08:00"
}
~~~

MAPMS 退出或身份失效：

~~~json
{
  "type": "XMAI_ADMIN_CONTEXT_CLEAR",
  "protocolVersion": 1
}
~~~

### 8.3 来源限制

MAPMS 发送消息时必须指定精确目标源：

~~~javascript
iframe.contentWindow.postMessage(message, "http://47.96.184.148")
~~~

禁止使用：

~~~javascript
iframe.contentWindow.postMessage(message, "*")
~~~

MAPMS 接收 XMAI 消息时，也必须检查 event.origin 是否等于配置的 XMAI 源。

### 8.4 配置化

不得在 Vue 组件中散落硬编码地址，建议使用：

~~~text
VITE_XMAI_ADMIN_URL=http://47.96.184.148/xianma-updates/admin
VITE_XMAI_ADMIN_ORIGIN=http://47.96.184.148
~~~

未来迁移域名时同时修改 URL 和 origin 配置。

## 9. XMAI 前端开发

### 9.1 接收身份

XMAI 管理页面加载后：

1. 向 window.parent 发送 XMAI_ADMIN_CONTEXT_REQUEST。
2. 只接收可信 MAPMS 源的 XMAI_ADMIN_CONTEXT。
3. 将 contextToken 保存在内存，不写 Local Storage、Session Storage 或 Cookie。
4. 从凭证中读取的昵称可临时显示，但敏感操作结果仍以服务端验签结果为准。
5. 凭证过期前 30 秒再次向父页面请求。
6. 收到 CLEAR 或超时后，清除当前管理员并禁用敏感操作。

允许的父页面源至少包含：

~~~text
http://xmjh.aipro123.top:8866
http://223.4.248.121:8866
~~~

生产环境应通过配置维护，不建议永久硬编码多个来源。

### 9.2 请求头

所有需要记录管理员的 XMAI 管理接口统一携带：

~~~http
X-XMAI-Admin-Context: <contextToken>
~~~

由统一请求拦截器添加，避免每个页面重复实现。

### 9.3 页面显示

- 右上角管理员名称显示已验证的 displayName。
- 身份还未到达时显示“正在同步管理员身份”，不显示虚假的默认姓名。
- 身份失效时显示“管理员身份已失效，请刷新 MAPMS 登录状态”。
- 不再把“平台管理员”作为新操作的默认操作人。

### 9.4 当前兼容代码的处理

XMAI 当前已有接收以下明文消息的兼容逻辑：

~~~json
{
  "type": "XMAI_ADMIN_CONTEXT",
  "displayName": "黄则"
}
~~~

该逻辑只能用于迁移期间的界面预览，不能作为可信审计身份。升级后应优先要求 contextToken；明文 displayName 只允许在兼容开关开启时显示，禁止写入正式审计记录。

## 10. XMAI 服务端开发

### 10.1 统一身份中间件

新增 verifyMapmsAdminContext 中间件，统一执行：

1. 读取 X-XMAI-Admin-Context。
2. 按 keyId 选择 MAPMS 公钥。
3. 验证签名。
4. 验证 iss 等于 mapms。
5. 验证 aud 等于 xmai-admin。
6. 验证 exp、iat，并限制允许的时钟偏差。
7. 验证 sub、username、displayName 必填。
8. 验证 XMAI_ADMIN 权限或双方约定的管理权限。
9. 将可信身份写入 request.adminActor。

建议结果对象：

~~~javascript
request.adminActor = {
  id: claims.sub,
  username: claims.username,
  displayName: claims.displayName,
  roles: claims.roles,
  source: "MAPMS"
}
~~~

### 10.2 需要接入中间件的接口

至少包括：

- 技能审批、驳回、删除、直接发布、待发布确认和企业技能下架。
- 技能分类新增、编辑、启用、停用和删除。
- 版本发布与更新配置。
- 用户状态管理。
- 其他会改变 XMAI 服务端数据的管理接口。

只读统计接口是否强制要求身份，可按现有权限策略决定，但页面仍应显示当前 MAPMS 管理员。

### 10.3 审计记录结构

新审计记录统一保存：

~~~json
{
  "actorId": "mapms-admin-1024",
  "actorUsername": "huangze",
  "actorDisplayName": "黄则",
  "actorSource": "MAPMS",
  "action": "SKILL_APPROVE",
  "targetType": "company-skill",
  "targetId": "skill-1008",
  "createdAt": "2026-09-01T16:00:00+08:00"
}
~~~

规则：

- actorId 是身份关联主键。
- actorDisplayName 是操作当时的昵称快照。
- 昵称之后改变时，历史记录不回写。
- 不保存完整身份凭证。
- 日志中只记录 jti 的哈希或截断值，不记录 Token。

## 11. 权限与现有管理密码

身份同步与管理授权是两个不同概念：

- 身份同步解决“现在是谁在操作”。
- 权限控制解决“这个人能否执行该操作”。

建议最终以 MAPMS 的 XMAI_ADMIN 权限控制大多数管理操作。若当前版本发布仍保留独立管理员密码，可在迁移阶段采用双重校验：

~~~text
有效 MAPMS 管理员身份 + 正确版本发布密码
~~~

待权限模型稳定后，再决定是否取消版本发布密码。不得因为取得管理员昵称就自动授予全部管理权限。

## 12. 兼容迁移方案

### 12.1 兼容开关

XMAI 服务端增加：

~~~text
REQUIRE_MAPMS_ADMIN_CONTEXT=0
~~~

含义：

- 0：迁移期。新请求有凭证时验证并记录真实管理员；旧调用暂时保持兼容，但标记为 LEGACY。
- 1：正式期。受保护管理接口没有有效凭证时直接拒绝。

### 12.2 上线顺序

1. XMAI 服务端先增加验签中间件、审计字段和兼容开关，保持开关为 0。
2. XMAI 前端增加消息接收、请求头注入和身份状态显示。
3. 部署 MAPMS 后端身份凭证签发接口。
4. 部署 MAPMS 前端 iframe 消息桥接。
5. 使用测试管理员完成完整联调。
6. 观察至少一个工作日的签发失败、验签失败和旧调用比例。
7. 确认所有管理入口均携带有效身份后，将 REQUIRE_MAPMS_ADMIN_CONTEXT 改为 1。
8. 删除明文 displayName 兼容路径。

此顺序可避免 MAPMS 与 XMAI 不能同时发布时造成后台不可用。

### 12.3 历史数据处理

历史记录中的“平台管理员”不能直接批量改成某一个人，因为无法证明所有历史操作都由同一管理员完成。

处理规则：

1. 原始历史记录保留不变，actorSource 标记为 LEGACY。
2. 能从现有可信日志明确对应操作人的记录，可执行定向迁移。
3. 每次迁移保留原值、修改值、证据来源、执行人和执行时间。
4. 无法确认的记录继续显示“历史管理员”或“平台管理员（历史）”。
5. 新方案启用后的所有新操作必须记录真实管理员。

## 13. 异常处理

| 场景 | XMAI 前端行为 | XMAI 服务端行为 |
| --- | --- | --- |
| MAPMS 未登录 | 显示身份失效，禁用敏感按钮 | 返回 401 |
| 当前账号无权限 | 显示无管理权限 | 返回 403 |
| 凭证过期 | 向父页面重新请求 | 返回 401 和明确错误码 |
| 消息来源不可信 | 静默丢弃并记录前端诊断信息 | 不涉及 |
| 签名错误 | 清除本地身份状态 | 返回 401 |
| MAPMS 接口临时失败 | 保留页面只读并允许重试 | 不接受匿名写操作 |
| MAPMS 账号切换 | 清除旧凭证并立即获取新凭证 | 新请求按新 sub 审计 |
| XMAI 独立打开 | 提示需从 MAPMS 进入 | 严格模式下拒绝写操作 |

建议错误码：

~~~text
XMAI_ADMIN_CONTEXT_MISSING
XMAI_ADMIN_CONTEXT_EXPIRED
XMAI_ADMIN_CONTEXT_INVALID
XMAI_ADMIN_PERMISSION_DENIED
XMAI_ADMIN_PARENT_ORIGIN_DENIED
~~~

## 14. 安全要求

1. MAPMS 与 XMAI 正式环境应升级到 HTTPS。当前 HTTP 链路中，即使凭证有效期很短，仍可能被网络中间人截获。
2. postMessage 必须检查 event.origin、event.source 和消息 type。
3. 不允许使用 postMessage 的星号目标源。
4. Token 只保存在内存，页面刷新后重新获取。
5. XMAI 不接收 MAPMS 登录 Token、Cookie 或密码。
6. XMAI 的公钥配置应支持 keyId 和双公钥轮换。
7. 管理接口继续执行 CSRF、请求频率和参数校验。
8. displayName 需要做长度限制和输出编码，防止脚本注入。
9. 审计日志不可由客户端传入 actor 字段覆盖。
10. 服务端时间需要通过 NTP 保持同步，允许的时钟偏差建议不超过 30 秒。

## 15. 测试方案

### 15.1 MAPMS 单元测试

- 登录管理员可取得 XMAI 专用凭证。
- 普通用户、禁用用户和锁定用户无法取得凭证。
- 请求体伪造 adminId 不会改变签发身份。
- 凭证包含正确 iss、aud、sub、iat、exp 和 jti。
- 每次签发的 jti 不重复。
- 私钥不会出现在日志和响应中。

### 15.2 XMAI 单元测试

- 正确凭证通过验签。
- 错误签名、错误 iss、错误 aud 和过期凭证均被拒绝。
- 伪造 displayName 不会进入审计记录。
- 审计身份只取自 request.adminActor。
- 兼容开关为 1 时，无凭证写接口被拒绝。

### 15.3 浏览器联调测试

1. 管理员“黄则”登录 MAPMS，进入 XMAI 页面后显示“黄则”。
2. 审批一个测试技能，服务端审计记录为“黄则”及其稳定管理员 ID。
3. 切换到另一个 MAPMS 管理员，XMAI 不刷新整个页面也能更新身份。
4. MAPMS 退出后，XMAI 管理按钮立即进入不可操作状态。
5. 直接访问 XMAI 管理地址时，严格模式下不能执行敏感操作。
6. 从非白名单页面向 iframe 伪造 postMessage，XMAI 必须忽略。
7. 修改浏览器中的显示昵称，不得影响服务端审计记录。
8. 凭证到期后能自动刷新，管理操作不中断。

### 15.4 回归测试

- 技能审批、待发布、企业技能、分类管理和版本发布均可正常操作。
- 现有统计页面和只读接口不受影响。
- 原有管理密码策略不被意外取消。
- MAPMS 其他 iframe 页面不受影响。
- XMAI 管理页面独立故障不会导致 MAPMS 主系统退出。

## 16. 验收标准

满足以下条件才可视为完成：

1. MAPMS 登录管理员与 XMAI 页面显示管理员一致。
2. 连续切换两个账号，XMAI 身份在 5 秒内正确切换。
3. 所有敏感管理接口均由 XMAI 服务端验签，不信任明文姓名。
4. 新增审计记录同时包含管理员稳定 ID、登录名、昵称和来源。
5. MAPMS 退出、禁用或失去权限后，XMAI 无法继续执行写操作。
6. 非 MAPMS 来源无法伪造管理员身份。
7. 凭证、私钥、密码和 MAPMS 原始 Token 均未进入前端存储或日志。
8. 严格模式开启后，不再产生新的“平台管理员”匿名操作记录。

## 17. 回滚方案

若正式切换后异常：

1. 将 REQUIRE_MAPMS_ADMIN_CONTEXT 临时恢复为 0。
2. 保留新审计字段和已写入的真实身份记录，不回滚数据结构。
3. MAPMS 前端可暂时关闭消息桥接，不影响 MAPMS 其他功能。
4. XMAI 恢复兼容模式后，旧管理流程继续可用，但新增操作标记为 LEGACY。
5. 修复后重新联调，再次开启严格模式。

禁止通过删除新审计数据或批量改写操作人进行回滚。

## 18. 开发任务拆分

### 18.1 MAPMS 开发方

- 提供当前管理员稳定 ID、登录名、钉钉昵称和权限的服务端读取能力。
- 实现 XMAI 专用短时凭证签发接口。
- 配置并保护身份签名私钥。
- 修改 XianmaAiStudioView，完成 iframe 消息桥接、刷新和退出清理。
- 提供测试管理员账号及权限配置。

### 18.2 XMAI 开发方

- 实现可信来源消息接收和内存态凭证管理。
- 为管理接口统一附加 X-XMAI-Admin-Context。
- 实现验签中间件、权限校验和错误码。
- 扩展审计数据结构及后台显示。
- 增加兼容开关、监控和严格模式。
- 完成历史记录的兼容展示，不做无证据的批量改名。

### 18.3 联合工作

- 确认管理员唯一 ID 和钉钉昵称字段。
- 确认 XMAI 管理权限代码。
- 交换 XMAI 身份验证公钥和 keyId。
- 确认正式与测试环境 URL、origin 白名单。
- 完成账号切换、凭证过期、无权限和回滚演练。

## 19. 预计工期

在双方已有标准登录与权限组件的前提下，建议安排：

| 阶段 | 内容 | 预计时间 |
| --- | --- | --- |
| 设计确认 | 字段、权限、签名算法和环境地址确认 | 0.5 天 |
| MAPMS 后端 | 身份接口、签名、测试 | 1 天 |
| MAPMS 前端 | iframe 消息桥接和账号切换 | 0.5 天 |
| XMAI 服务端 | 验签、权限、审计和兼容开关 | 1 至 1.5 天 |
| XMAI 前端 | 接收、刷新、状态显示和请求拦截 | 0.5 至 1 天 |
| 联调验收 | 异常、回归、安全和回滚测试 | 1 天 |

总计约 4.5 至 5.5 个开发测试工作日。若需要同步补齐 MAPMS 的钉钉昵称字段或升级 HTTPS，应单独增加时间。

## 20. 最终结论

这里的信息可以同步，但必须由 MAPMS 配合提供当前登录管理员的可信身份。仅在 XMAI 前端读取、写死姓名或接收明文姓名，都只能解决显示问题，不能保证审批和发布审计的真实性。

推荐落地方式是：

~~~text
MAPMS 后端签发短时凭证
-> MAPMS 父页面定向 postMessage
-> XMAI 前端转发凭证
-> XMAI 服务端验签与授权
-> 使用真实钉钉昵称展示并以稳定管理员 ID 审计
~~~

该方案既能实现“登录的是谁就同步谁”，也能在未来更换 XMAI 服务地址时通过配置平滑迁移。
