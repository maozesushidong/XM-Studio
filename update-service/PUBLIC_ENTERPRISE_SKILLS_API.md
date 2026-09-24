# XMAI Studio 公开企业技能接口使用手册

## 1. 用途

这套接口把 XMAI Studio 服务端已经发布的企业技能作为一个公开技能仓库提供给 WorkBuddy 或其他平台。

其他平台的使用流程是：

1. 获取全部已发布企业技能；
2. 展示技能名称、分类、标签和版本；
3. 用户选择一个技能；
4. 按 `skillId` 和版本下载技能 ZIP；
5. 解压并读取 `SKILL.md`，注册为本地技能后使用。

接口不需要登录，也不需要 `Authorization` 请求头。

## 2. 正式地址

技能列表接口：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills
```

服务端根地址：

```text
http://47.96.184.148/xianma-updates
```

## 3. 接口清单

| 用途 | 方法 | 地址 |
| --- | --- | --- |
| 获取技能列表 | `GET` | `/api/open/v1/enterprise-skills` |
| 获取指定技能详情 | `GET` | `/api/open/v1/enterprise-skills/{skillId}` |
| 获取技能版本 | `GET` | `/api/open/v1/enterprise-skills/{skillId}/versions` |
| 下载技能包 | `GET` | `/api/open/v1/enterprise-skills/{skillId}/package?version=版本号` |
| 跨域预检 | `OPTIONS` | 以上任意公开接口 |

公开接口只返回：

- 已审核并发布的技能；
- 当前没有下架的技能；
- 已发布的技能版本。

不会返回草稿、待审核、已撤回、已下架技能，也不会返回管理员接口、审核记录、创建人、部门或服务器文件路径。

## 4. 获取全部技能

请求：

```http
GET http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills
```

不需要请求头：

```http
Accept: application/json
```

可选筛选参数：

```text
?q=关键词
?search=关键词
?category=分类名称
?categoryId=分类 ID
?tag=标签名称
?tagId=标签 ID
```

例如：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills?q=周报
```

返回示例：

```json
{
  "ok": true,
  "count": 1,
  "skills": [
    {
      "skillId": "skill-project-report",
      "name": "project-report",
      "displayName": "项目周报整理",
      "description": "根据工作记录生成项目周报",
      "category": "效率工具",
      "categoryId": "efficiency-tools",
      "tagIds": ["project", "summary"],
      "tagNames": ["项目管理", "周报"],
      "latestVersion": "1.0.0",
      "sha256": "技能包 SHA-256",
      "size": 12345,
      "publishedAt": "2026-09-07T08:00:00.000Z",
      "downloadUrl": "http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/skill-project-report/package?version=1.0.0",
      "versions": [
        {
          "version": "1.0.0",
          "publishedAt": "2026-09-07T08:00:00.000Z",
          "sha256": "技能包 SHA-256",
          "size": 12345,
          "riskLevel": "low",
          "downloadUrl": "http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/skill-project-report/package?version=1.0.0"
        }
      ]
    }
  ]
}
```

WorkBuddy 应使用 `skillId` 作为稳定标识，不要用显示名称作为唯一标识。

## 5. 获取单个技能详情

```http
GET http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/{skillId}
```

例如：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/skill-project-report
```

返回：

```json
{
  "ok": true,
  "skill": {
    "skillId": "skill-project-report",
    "displayName": "项目周报整理",
    "latestVersion": "1.0.0",
    "versions": []
  }
}
```

技能不存在、未发布或已经下架时返回 `404`。

## 6. 获取版本列表

```http
GET http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/{skillId}/versions
```

WorkBuddy 可以使用 `latestVersion` 拉取最新版本，也可以让用户选择历史已发布版本。

## 7. 下载技能包

```http
GET http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/{skillId}/package?version=1.0.0
```

返回类型：

```text
application/zip
```

技能包通常包含：

```text
SKILL.md
skill.json
scripts/
references/
其他资源文件
```

下载后建议按以下顺序处理：

1. 读取响应头 `x-skill-id` 和 `x-skill-version`；
2. 读取整个 ZIP 文件；
3. 使用列表接口返回的 `sha256` 校验文件完整性；
4. 解压到 WorkBuddy 的技能目录；
5. 读取根目录或技能目录中的 `SKILL.md`；
6. 使用 `displayName` 作为界面名称，使用 `skillId` 作为内部 ID。

## 8. WorkBuddy 配置步骤

如果 WorkBuddy 支持“自定义 HTTP 技能源”或“远程技能仓库”：

1. 打开 WorkBuddy 的设置；
2. 进入“技能”“扩展”或“自定义技能来源”；
3. 新增 HTTP/API 技能源；
4. 填写下面的列表地址：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills
```

5. 认证方式选择“无认证”；
6. 保存并刷新技能列表；
7. 选择需要的企业技能；
8. WorkBuddy 根据 `downloadUrl` 下载 ZIP；
9. 安装完成后即可在 WorkBuddy 中使用。

如果 WorkBuddy 只支持“从 ZIP URL 导入”，则直接使用列表返回的 `downloadUrl`，例如：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/skill-project-report/package?version=1.0.0
```

如果 WorkBuddy 只接受 GitHub 仓库地址，则需要使用 WorkBuddy 的“自定义 HTTP/API 工具”或“从 ZIP URL 导入”能力；当前公开接口不是 GitHub 仓库地址，不能直接填入仅支持 GitHub 的输入框。

## 9. 直接发给 WorkBuddy 的对话指令

把下面这段话和接口地址一起发给 WorkBuddy：

```text
请使用这个公开接口作为 XMAI Studio 企业技能仓库：

http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills

请按以下流程执行：

1. 先调用接口获取全部 skills，不要立即下载或安装。
2. 把每个技能的 displayName、skillId、description、category、tagNames 和 latestVersion 展示给我。
3. 展示完成后只询问我：“你需要拉取哪个具体技能？可以回复技能名称或 skillId。”
4. 我选择技能后，使用对应技能的 skillId 和 latestVersion，访问它的 downloadUrl 下载 ZIP。
5. 下载后使用 sha256 校验 ZIP，校验通过后再安装。
6. 安装成功后告诉我技能名称、skillId 和版本号，并使用这个技能处理我后续的任务。
7. 如果找不到技能、版本不存在、下载失败或校验失败，要明确告诉我原因，不要自行选择其他技能。
8. 如果列表为空，请告诉我当前没有已发布企业技能，不要虚构技能。
```

WorkBuddy 的实际对话效果应当是：

```text
你：请帮我从 XMAI 企业技能库拉取技能。

WorkBuddy：我找到以下企业技能：
1. 项目周报整理（skill-project-report）
2. 客服话术生成（skill-customer-service）
请选择需要拉取的技能名称或 skillId。

你：拉取 skill-project-report。

WorkBuddy：已找到项目周报整理，版本 1.0.0。是否现在拉取并安装？

你：是。

WorkBuddy：技能已拉取、校验并安装完成，现在可以使用项目周报整理技能。
```

如果 WorkBuddy 具备联网请求、下载 ZIP 和安装技能的能力，上述流程可以直接完成。当前线上接口没有已发布技能时，WorkBuddy 会返回空列表；管理员发布企业技能后，刷新接口即可看到。

## 10. 使用 PowerShell 测试

获取技能列表：

```powershell
$base = "http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills"
$catalog = Invoke-RestMethod -Uri $base -Method Get
$catalog.skills | Select-Object skillId, displayName, latestVersion, downloadUrl
```

下载指定版本：

```powershell
$skillId = "skill-project-report"
$version = "1.0.0"
$url = "$base/$skillId/package?version=$version"
Invoke-WebRequest -Uri $url -OutFile ".\$skillId-$version.zip"
```

## 11. 使用 curl 测试

```bash
curl "http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills"
```

```bash
curl -L \
  "http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills/skill-project-report/package?version=1.0.0" \
  -o skill-project-report-1.0.0.zip
```

## 12. 版本更新规则

当管理员发布新版本后：

1. 列表中的 `latestVersion` 会变化；
2. `versions` 中会增加新版本；
3. 旧版本仍可通过明确版本号下载，前提是旧版本没有被下架；
4. WorkBuddy 下一次刷新列表时可以发现更新；
5. WorkBuddy 下载新 ZIP 并覆盖本地对应版本。

当技能被下架后：

- 列表不再返回该技能；
- 详情接口返回 `404`；
- 版本接口返回 `404`；
- ZIP 下载接口返回 `404`。

## 13. 当前接口边界

本次接口实现的是“公开查看和拉取技能包”。WorkBuddy 下载后负责本地安装和执行。

当前没有开放服务端直接执行技能的接口，也没有开放以下接口：

- 技能创建；
- 技能提交审核；
- 技能审批；
- 技能发布；
- 技能删除；
- 使用统计；
- 管理员登录。

## 14. 验收检查

部署后按以下地址检查：

```text
http://47.96.184.148/xianma-updates/api/open/v1/enterprise-skills
```

预期结果：

- HTTP 状态码为 `200`；
- 返回 JSON；
- 包含 `ok`、`count`、`skills`；
- 每个技能包含 `skillId`、`latestVersion` 和 `downloadUrl`；
- 不需要请求头中的 Token；
- 浏览器或 WorkBuddy 可以跨域请求；
- 使用 `downloadUrl` 可以下载 ZIP 文件。
