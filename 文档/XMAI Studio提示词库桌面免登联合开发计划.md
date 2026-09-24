> **已作废：这是内部历史草案，不得交付门户开发。唯一有效文件为《门户端桌面免登最小改造开发方案.md》。**

# XMAI Studio 提示词库桌面免登联合开发计划

## 1. 文档目的

本文档用于 XMAI Studio、`agent.xianmaec.com` 门户和 `cv.xianmaec.com` 提示词平台联合开发桌面免登功能。

目标体验：

```text
用户登录 XMAI Studio
→ 点击“提示词库”
→ 后台校验当前钉钉身份和使用权限
→ 不扫码、不重复登录
→ 固定进入 https://cv.xianmaec.com/prompts
```

客户端版本保持：

```text
产品名：XMAI Studio
外部版本：1.4.0
内部版本：1.4.0
更新通道：v11-preview
```

真实线上免登测试通过前，不生成新的交付安装包，不上传更新服务器。

## 2. 当前问题

客户端当前调用：

```http
POST https://agent.xianmaec.com/api/portal/auth/desktop
Authorization: Bearer <XMAI桌面会话令牌>
Content-Type: application/json
```

线上返回：

```json
{
  "code": "SESSION_EXPIRED",
  "message": "门户会话已失效"
}
```

根本原因：

```text
门户后端把 XMAI 桌面会话令牌当成了门户自己的 accessToken。
```

正确处理方式：

```text
门户收到 XMAI 桌面令牌
→ 调用 XMAI 服务端校验令牌和用户权限
→ 校验成功后签发一次性门户 ticket
→ cv 平台消费 ticket 并建立自己的登录会话
```

## 3. 当前完成情况

| 模块 | 状态 |
|---|---|
| 客户端提示词库入口 | 已完成 |
| 优先匹配 `PROMPT_LIBRARY` | 已完成 |
| 固定识别 `/prompts` | 已完成 |
| 支持一次性 ticket URL | 已完成 |
| 支持门户 accessToken 响应 | 已完成 |
| 非受信任域名和非法跳转拦截 | 已完成 |
| 取消客户端主动二次钉钉登录 | 已完成 |
| 本地模拟免登测试 | 已通过 |
| 线上真实免登 | 未通过 |
| 门户桌面令牌信任 | 未完成 |
| 新安装包 | 暂不构建 |

## 4. 系统职责

| 系统 | 职责 |
|---|---|
| XMAI Studio 客户端 | 提交当前桌面会话和钉钉身份，打开提示词库窗口 |
| XMAI 服务端 | 校验桌面令牌、钉钉身份、账号状态及 MAPMS 权限 |
| agent 门户 | 接收桌面免登请求，调用 XMAI 校验服务，签发一次性 ticket |
| cv 提示词平台 | 消费 ticket，建立门户会话并跳转 `/prompts` |
| Redis | 保存一次性 ticket，控制有效期并防止重复使用 |
| Nginx/HTTPS | 加密服务间通信，限制接口访问范围 |

## 5. 完整时序

```text
XMAI客户端                 agent门户                XMAI服务端               cv提示词平台
    |                         |                         |                         |
    | 用户点击提示词库         |                         |                         |
    |------------------------>|                         |                         |
    | POST /auth/desktop      |                         |                         |
    | Bearer 桌面令牌          |                         |                         |
    |                         | POST /session/verify    |                         |
    |                         |------------------------>|                         |
    |                         |                         | 校验桌面会话             |
    |                         |                         | 校验userid/corpId        |
    |                         |                         | 校验MAPMS权限            |
    |                         |<------------------------|                         |
    |                         | verified=true           |                         |
    |                         | 生成一次性ticket         |                         |
    |<------------------------|                         |                         |
    | 返回cv免登URL            |                         |                         |
    |--------------------------------------------------------------------------->|
    |                         |                         |        消费ticket         |
    |                         |                         |        建立门户会话        |
    |<---------------------------------------------------------------------------|
    |                             302 /prompts                                     |
```

## 6. 第一阶段：门户项目准备

### 6.1 门户开发者需要提供

```text
agent.xianmaec.com 后端源码或源码仓库
cv.xianmaec.com 后端源码或源码仓库
后端语言和框架版本
本地启动方法
测试环境部署方法
测试环境地址
Redis或其他缓存连接方式
当前用户表和钉钉绑定字段说明
当前门户accessToken生成方式
当前/api/portal/session处理代码
当前/dingtalk-sso处理代码
```

### 6.2 需要确认的架构信息

```text
agent和cv是否属于同一套后端
agent和cv是否共用用户数据库
agent和cv是否共用Redis
门户用户是否已经保存dingtalk_user_id
门户用户是否保存corp_id
门户禁用状态字段是什么
门户登录使用Cookie还是sessionStorage
门户是否已有一次性ticket机制
```

### 6.3 阶段产物

```text
门户真实认证流程图
门户用户身份字段说明
测试环境启动和部署说明
双方最终确认的接口协议
```

预计时间：`0.5个工作日`。

## 7. 第二阶段：服务间认证

### 7.1 创建门户专用凭证

XMAI 服务端生成：

```text
PORTAL_INTEGRATION_KEY
PORTAL_INTEGRATION_SECRET
```

凭证只能存放在：

```text
XMAI服务端环境变量
agent门户后端环境变量
```

禁止存放在：

```text
客户端代码
门户前端代码
安装包
Git仓库
URL参数
普通请求日志
```

### 7.2 服务间签名

门户调用 XMAI 校验接口时携带：

```http
X-XMAI-Integration-Key: <门户专用Key>
X-XMAI-Timestamp: <Unix时间戳>
X-XMAI-Nonce: <随机字符串>
X-XMAI-Signature: <HMAC-SHA256签名>
```

签名原文：

```text
timestamp + "\n" + nonce + "\n" + 原始JSON请求体
```

校验规则：

```text
时间戳误差不超过5分钟
Nonce在有效期内不得重复
签名使用恒定时间比较
错误响应不得泄露Secret和签名细节
```

### 7.3 HTTPS

XMAI 校验接口必须使用 HTTPS。当前公网 HTTP 更新地址不能直接用于传输桌面令牌。

需要完成：

```text
配置HTTPS域名
申请并部署有效SSL证书
配置Nginx反向代理
仅暴露必要的校验接口
条件允许时限制门户服务器出口IP
```

预计时间：`0.5至1个工作日`。

## 8. 第三阶段：XMAI 服务端开发

### 8.1 新增校验接口

建议接口：

```http
POST /api/integrations/prompt-portal/session/verify
```

请求体：

```json
{
  "desktopSessionToken": "XMAI桌面会话令牌",
  "dingtalkUserId": "钉钉企业userid",
  "corpId": "钉钉企业corpId",
  "audience": "prompt-portal"
}
```

### 8.2 桌面会话校验

服务端必须检查：

```text
桌面令牌存在
令牌哈希匹配当前设备会话
设备会话没有失效或注销
用户记录存在
用户没有被删除或禁用
```

数据库只保存桌面令牌的 SHA-256 哈希，不保存明文。

### 8.3 身份一致性校验

必须满足：

```text
令牌对应的dingtalkUserId等于请求中的dingtalkUserId
令牌对应的corpId等于请求中的corpId
audience严格等于prompt-portal
```

任何身份不一致均返回 `403`，不得尝试按姓名、昵称或手机号模糊匹配。

### 8.4 权限校验

校验顺序：

```text
XMAI用户状态
MAPMS绑定状态
MAPMS用户启用状态
MAPMS用户锁定状态
用户所属部门和平台
```

只有全部通过才能返回 `verified: true`。

### 8.5 成功响应

```json
{
  "code": "0",
  "message": "OK",
  "data": {
    "verified": true,
    "userId": "XMAI内部用户ID",
    "dingtalkUserId": "钉钉userid",
    "corpId": "企业corpId",
    "nickname": "钉钉昵称",
    "department": "所属部门",
    "status": 1
  }
}
```

### 8.6 日志要求

允许记录：

```text
请求时间
请求来源
请求ID
成功或失败
标准错误码
```

禁止记录：

```text
桌面令牌
服务间Secret
完整签名
浏览器Cookie
模型Key
用户文件信息
```

### 8.7 XMAI 自动化测试

```text
有效桌面令牌
不存在的令牌
失效令牌
错误dingtalkUserId
错误corpId
错误audience
用户被禁用
MAPMS权限不足
错误服务间签名
重复Nonce
过期Timestamp
请求频率超限
```

预计时间：`1个工作日`。

## 9. 第四阶段：agent 门户开发

### 9.1 修改现有接口

```http
POST /api/portal/auth/desktop
```

该接口必须位于门户普通登录鉴权中间件之前。

不能先使用门户原有 accessToken 中间件处理，因为请求中的 Bearer 令牌属于 XMAI，不属于门户。

### 9.2 客户端现有请求

```http
Authorization: Bearer <XMAI桌面会话令牌>
Content-Type: application/json
Accept: application/json
```

```json
{
  "DTUserId": "钉钉企业userid",
  "corpId": "钉钉企业corpId",
  "source": "XM_PORTAL",
  "entry": "prompts"
}
```

### 9.3 参数限制

```text
Authorization必须是Bearer格式
DTUserId不能为空
corpId不能为空
source必须等于XM_PORTAL
entry必须等于prompts
不允许客户端指定任意redirectUrl
```

### 9.4 调用 XMAI 校验服务

门户从 `Authorization` 读取 XMAI 桌面令牌，通过第 7 章的服务间签名调用 XMAI 校验接口。

XMAI 验证失败时，门户不得：

```text
创建门户会话
自动注册门户用户
生成ticket
进入/prompts
```

### 9.5 门户用户匹配

唯一身份键：

```text
corpId + dingtalkUserId
```

处理规则：

| 情况 | 处理方式 |
|---|---|
| 已存在唯一匹配账号 | 复用账号 |
| 昵称或部门变化 | 使用XMAI验证结果更新非唯一资料 |
| 不存在门户账号 | 按门户现有规则创建最小账号 |
| 门户账号被禁用 | 拒绝登录 |
| 同一userid匹配多个账号 | 拒绝登录并记录数据异常 |
| 只有姓名相同 | 不允许自动绑定 |

客户端提交的昵称、姓名和部门不能作为可信信息。门户只能使用 XMAI 校验接口返回的数据。

### 9.6 一次性 ticket

生成要求：

```text
至少32字节密码学安全随机数
有效期60至120秒
只能使用一次
Redis只保存ticket哈希
绑定用户、corpId、userid和目标入口
```

Redis 建议：

```text
Key：prompt:sso:ticket:<ticket_sha256>
TTL：60秒
Value：门户用户ID、dingtalkUserId、corpId、entry
```

### 9.7 成功响应

```json
{
  "code": "0",
  "message": "OK",
  "data": {
    "url": "https://cv.xianmaec.com/dingtalk-sso?source=XM_PORTAL&entry=prompts&ticket=一次性票据"
  }
}
```

客户端已经支持：

```text
data.url
url
data.launchUrl
launchUrl
```

推荐统一返回 `data.url`。

预计时间：`1个工作日`。

## 10. 第五阶段：cv 提示词平台开发

### 10.1 ticket 消费入口

```http
GET /dingtalk-sso?source=XM_PORTAL&entry=prompts&ticket=<一次性票据>
```

处理顺序：

```text
检查source严格等于XM_PORTAL
检查entry严格等于prompts
计算ticket的SHA-256
从Redis原子读取并删除ticket
检查ticket是否过期
检查门户用户是否有效
建立门户登录会话
302跳转到/prompts
```

必须使用 Redis `GETDEL` 或等效原子操作，防止同一个 ticket 被重复使用。

### 10.2 agent 与 cv 的 ticket 共享

如果两个域名不是同一个后端，采用以下方式之一：

```text
方案A：agent和cv共用同一个Redis
方案B：cv调用agent内部ticket消费接口
```

推荐方案 A，调用链更短。

### 10.3 门户会话

推荐安全 Cookie：

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

如果现有门户必须使用 `sessionStorage.XM_PORTAL_ACCESS_TOKEN`，应由可信页面写入，不能把长期 accessToken 放到 URL。

### 10.4 最终跳转

```http
HTTP/1.1 302 Found
Location: /prompts
```

不得跳转到：

```text
门户首页
钉钉扫码页面
二次登录页面
客户端传入的任意外部地址
```

### 10.5 原有流程兼容

不得影响：

```text
网页二维码登录
钉钉客户端免登
原有门户登录
现有提示词页面
```

预计时间：`0.5至1个工作日`。

## 11. 第六阶段：客户端收尾

客户端侧主要工作：

```text
连接正式HTTPS免登链路
验证真实ticket跳转
统一中文错误提示
清理英文IPC错误前缀
验证提示词窗口复用
验证退出登录后的行为
验证网络恢复后的重新打开
```

客户端不得重新加入钉钉扫码或网页二次登录作为自动回退。

预计时间：`0.5个工作日`。

## 12. 标准错误码

| HTTP状态 | 错误码 | 含义 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | 参数缺失或格式错误 |
| 401 | `XMAI_SESSION_EXPIRED` | XMAI桌面会话失效 |
| 403 | `XMAI_USER_MISMATCH` | userid或corpId不一致 |
| 403 | `XMAI_USER_DISABLED` | 用户被禁用 |
| 403 | `XMAI_PERMISSION_DENIED` | MAPMS或平台权限不允许 |
| 404 | `ENTRY_NOT_FOUND` | 提示词入口不存在 |
| 409 | `TICKET_USED` | ticket已使用 |
| 410 | `TICKET_EXPIRED` | ticket已过期 |
| 429 | `RATE_LIMITED` | 请求频率过高 |
| 503 | `XMAI_VERIFY_UNAVAILABLE` | XMAI校验服务不可用 |

错误响应示例：

```json
{
  "code": "XMAI_SESSION_EXPIRED",
  "message": "XMAI桌面会话已失效，请重新登录客户端",
  "requestId": "req-xxxx"
}
```

## 13. 安全约束

```text
不能把XMAI桌面令牌当成门户accessToken
不能把桌面令牌拼接到URL
不能根据userid直接免密登录
不能按昵称、姓名或手机号自动绑定账号
不能把Secret放进前端或安装包
不能通过关闭鉴权解决免登问题
不能在日志中保存令牌、Cookie和Secret
不能允许客户端指定任意回跳地址
不能重复使用ticket
所有令牌传输必须使用HTTPS
```

## 14. 联合测试计划

### 14.1 正常流程

```text
登录XMAI后点击提示词库
没有二次扫码或登录
最终进入/prompts
提示词内容正常加载
关闭提示词窗口后可以重新打开
已有门户会话时可以直接复用
```

### 14.2 身份测试

```text
不同钉钉用户分别登录
不同部门用户登录
门户已有用户登录
门户新用户首次登录
用户昵称变化后登录
同名但userid不同的用户登录
```

### 14.3 权限测试

```text
MAPMS启用用户允许进入
MAPMS禁用用户拒绝进入
MAPMS锁定用户拒绝进入
XMAI退出登录后不能换取新ticket
同一userid重复绑定时拒绝进入
```

### 14.4 安全测试

```text
篡改DTUserId返回403
篡改corpId返回403
篡改source返回400
篡改entry返回400
伪造服务间签名失败
过期Timestamp失败
重复Nonce失败
ticket重复使用失败
ticket过期后失败
非法跳转地址被拒绝
URL和日志中不存在桌面令牌
```

### 14.5 客户端回归

```text
普通对话
多会话并行
模型切换
技能调用
文件生成、预览和下载
自动化任务
关闭到托盘
钉钉登录和退出
MAPMS权限校验
自动更新
```

## 15. 发布顺序

```text
1. 备份门户数据库、Redis配置和当前服务
2. 部署XMAI桌面会话校验接口
3. 在测试环境验证XMAI校验接口
4. 部署agent桌面免登接口
5. 部署cv ticket消费逻辑
6. 使用当前开发客户端执行真实免登测试
7. 确认最终地址固定为/prompts
8. 完成客户端全部回归测试
9. 保持1.4.0版本构建本地测试包
10. 安装包只做本地交付，不上传更新服务器
11. 由产品负责人安装验收
12. 明确确认后再决定是否发布
```

## 16. 回滚方案

建议增加服务端开关：

```text
PROMPT_DESKTOP_SSO_ENABLED=true
```

出现问题时：

```text
关闭桌面免登录口
恢复门户原有登录流程
删除未消费的测试ticket
恢复上一版agent和cv后端
保留原有用户、提示词和门户数据
不修改XMAI本地会话数据
不撤销用户原有门户账号
```

## 17. 验收标准

以下条件必须全部满足：

```text
真实XMAI钉钉用户测试通过
点击提示词库不出现第二次登录
最终URL固定为/prompts
提示词页面真实内容正常显示
不再出现401 SESSION_EXPIRED
客户端不显示英文IPC错误
ticket不能重复使用
过期ticket不能使用
禁用用户不能进入
服务日志不包含令牌和Secret
客户端其他功能没有回归问题
```

## 18. 预计工期

| 阶段 | 预计时间 |
|---|---:|
| 获取源码并确认架构 | 0.5天 |
| 服务间认证和HTTPS | 0.5至1天 |
| XMAI校验接口 | 1天 |
| agent门户改造 | 1天 |
| cv提示词平台改造 | 0.5至1天 |
| 客户端收尾 | 0.5天 |
| 联调和回归 | 1天 |
| 合计 | 4至6个工作日 |

工期前提：门户源码、测试环境、Redis和部署权限齐全。

## 19. 门户开发完成后需要反馈

```text
1. /api/portal/auth/desktop是否修改完成
2. 测试环境地址
3. 成功和失败响应示例
4. agent与cv是否共用Redis
5. ticket有效期
6. ticket是否使用原子消费
7. 最终是否固定跳转/prompts
8. 门户后端调用XMAI校验接口的实现位置
9. 门户用户匹配字段和去重规则
10. 联调负责人及可联调时间
```

## 20. 明确不需要提供

```text
模型API Key
钉钉AppSecret
MAPMS Secret
普通用户密码
个人浏览器Cookie
生产服务器root密码
```

门户开发者完成测试环境接口后，XMAI 侧将先执行真实免登测试。只有确认无需二次登录并成功进入 `/prompts`，才会生成新的 XMAI Studio 1.4.0 本地测试安装包。
