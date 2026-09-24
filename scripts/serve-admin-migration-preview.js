"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(projectRoot, "update-service", "public");
const port = Number(process.env.PORT || 4180);
const now = new Date();
const iso = (daysAgo = 0, hour = 9) => {
  const value = new Date(now);
  value.setDate(value.getDate() - daysAgo);
  value.setHours(hour, 30, 0, 0);
  return value.toISOString();
};

const categories = [
  ["office-collaboration", "办公协同"],
  ["efficiency-tools", "效率工具"],
  ["content-creation", "内容创作"],
  ["data-analysis", "数据分析"],
  ["business-operations", "商业运营"],
  ["development-tools", "开发工具"]
].map(([categoryId, name], index) => ({ categoryId, name, status: "ENABLED", sortOrder: (index + 1) * 10, updatedAt: iso(index) }));

const tags = [
  ["document", "文档"], ["summary", "总结"], ["meeting", "会议"], ["automation", "自动化"],
  ["copywriting", "文案"], ["table", "表格"], ["insight", "洞察"], ["browser", "浏览器"]
].map(([tagId, name], index) => ({ tagId, name, status: "ENABLED", sortOrder: (index + 1) * 10, updatedAt: iso(index) }));

const submissions = [{
  submissionId: "preview-submission-1",
  skillId: "preview-meeting-review",
  ownerUserKey: "preview-user-a",
  submitter: { name: "示例用户A", department: "运营中心" },
  name: "meeting-action-list",
  displayName: "会议行动清单",
  description: "将会议材料整理为结论、负责人、截止时间和待确认事项。",
  category: "办公协同",
  categoryId: "office-collaboration",
  tagIds: ["meeting", "summary"],
  version: "1.0.0",
  status: "pending",
  stateVersion: 1,
  riskLevel: "standard",
  riskItems: [],
  fileTree: [{ path: "SKILL.md", size: 2650 }, { path: "skill.json", size: 842 }],
  previews: [{ path: "SKILL.md", content: "# 适用场景\n用于整理会议结论、行动项与风险。\n\n# 使用示例\n请根据附件生成会议行动清单。" }],
  submittedAt: iso(1, 15),
  auditTrail: [{ eventId: "preview-audit-1", action: "submitted", actor: "示例用户A", reason: "", occurredAt: iso(1, 15) }]
}, {
  submissionId: "preview-submission-2",
  skillId: "preview-sales-summary",
  ownerUserKey: "preview-user-b",
  submitter: { name: "示例用户B", department: "销售中心" },
  name: "sales-weekly-summary",
  displayName: "销售周报整理",
  enterpriseDisplayName: "销售周报整理",
  description: "汇总销售进展、风险和下周计划。",
  category: "商业运营",
  categoryId: "business-operations",
  enterpriseCategory: "商业运营",
  enterpriseCategoryId: "business-operations",
  tagIds: ["document", "summary"],
  enterpriseTagIds: ["document", "summary"],
  version: "1.2.0",
  status: "approved",
  stateVersion: 2,
  riskLevel: "standard",
  riskItems: [],
  fileTree: [{ path: "SKILL.md", size: 3210 }, { path: "skill.json", size: 960 }],
  previews: [],
  submittedAt: iso(3, 11),
  approvedAt: iso(2, 10),
  auditTrail: [
    { eventId: "preview-audit-2", action: "submitted", actor: "示例用户B", reason: "", occurredAt: iso(3, 11) },
    { eventId: "preview-audit-3", action: "approved", actor: "平台管理员", reason: "内容与权限校验通过", occurredAt: iso(2, 10) }
  ]
}];

const companySkills = [{
  skillId: "company-preview-1",
  displayName: "项目复盘助手",
  creator: { name: "示例用户C" },
  category: "办公协同",
  categoryId: "office-collaboration",
  tagIds: ["document", "insight"],
  status: "published",
  versions: [{ version: "1.3.0", publishedAt: iso(5), submissionId: "preview-published-1" }]
}, {
  skillId: "company-preview-2",
  displayName: "商品文案检查",
  creator: { name: "示例用户D" },
  category: "内容创作",
  categoryId: "content-creation",
  tagIds: ["copywriting"],
  status: "published",
  versions: [{ version: "1.1.0", publishedAt: iso(8), submissionId: "preview-published-2" }]
}];

const users = [
  ["示例用户A", "运营中心", true],
  ["示例用户B", "销售中心", true],
  ["示例用户C", "产品中心", false],
  ["示例用户D", "设计中心", false]
].map(([name, department, online], index) => ({
  userKey: `preview-user-${index + 1}`,
  userId: `PREVIEW-${index + 1}`,
  dingtalkUserId: `ding-preview-${index + 1}`,
  name,
  department,
  accountStatus: "active",
  online,
  totalTasks: 0,
  succeededTasks: 0,
  failedTasks: 0,
  successRate: null,
  skillInvocations: 0,
  firstSeenAt: iso(45 - index * 4),
  lastLoginAt: iso(index, 9 + index),
  lastSeenAt: iso(online ? 0 : index + 1, 14),
  recentModules: []
}));

function overviewPayload() {
  const labels = ["08-21", "08-22", "08-23", "08-24", "08-25", "08-26", "08-27"];
  const tasks = labels.map(() => 0);
  const succeeded = labels.map(() => 0);
  const failed = labels.map(() => 0);
  return {
    realtime: {
      cumulativeUsers: 42,
      currentUsers: 38,
      onlineUsers: 17,
      activeDevices30d: 51,
      enterpriseSkills: 12,
      publishedEnterpriseSkills: 9,
      pendingReview: 1,
      pendingPublish: 1
    },
    period: {
      visitUsers: 0,
      activeUsers: 0,
      taskUsers: 0,
      tasks: 0,
      succeeded: 0,
      failed: 0,
      successRate: null,
      companySkillInvocations: 0
    },
    trendGranularity: "day",
    trend: labels.map((label, index) => ({ label, tasks: tasks[index], succeeded: succeeded[index], failed: failed[index] })),
    modules: []
  };
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

function sendFile(response, filePath, contentType, transform = null) {
  let body = fs.readFileSync(filePath);
  if (transform) body = Buffer.from(transform(body.toString("utf8")), "utf8");
  response.writeHead(200, { "content-type": contentType, "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

function previewHtml(source) {
  return source
    .replace("<title>XMAI Studio 管理后台</title>", "<title>XMAI Studio 管理后台 · 迁移预览</title>")
    .replace("</head>", `<style>
      body{padding-top:40px}.migration-preview-banner{position:fixed;z-index:1000;inset:0 0 auto;height:40px;display:flex;align-items:center;justify-content:center;gap:12px;background:#9f2831;color:#fff;font-size:13px}.migration-preview-banner strong{color:#fff}.migration-preview-banner span{opacity:.82}
    </style></head>`)
    .replace("<body>", `<body><div class="migration-preview-banner"><strong>旧地址迁移效果预览</strong><span>匿名示例数据 · 不连接、不修改线上服务器</span></div>`);
}

function previewScript(source) {
  return source
    .replaceAll("v11-preview", "stable-v2")
    .replace("测试通道固定为 stable-v2，不会被正式客户端检测到。", "正式更新通道为 stable-v2，迁移后沿用原有历史版本与安装包。");
}

function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/admin/v11/overview") return sendJson(response, 200, overviewPayload());
  if (request.method === "GET" && pathname === "/api/admin/v11/users") return sendJson(response, 200, { users });
  if (request.method === "GET" && pathname === "/api/admin/v11/categories") return sendJson(response, 200, { categories });
  if (request.method === "GET" && pathname === "/api/admin/v11/tags") return sendJson(response, 200, { tags });
  if (request.method === "GET" && pathname === "/api/admin/skill-submissions") return sendJson(response, 200, { submissions });
  if (request.method === "GET" && /^\/api\/admin\/skill-submissions\/[^/]+$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split("/").pop());
    const submission = submissions.find((item) => item.submissionId === id);
    return sendJson(response, submission ? 200 : 404, submission ? { submission } : { error: "预览记录不存在" });
  }
  if (request.method === "GET" && pathname === "/api/admin/company-skills") return sendJson(response, 200, { skills: companySkills });
  if (request.method === "GET" && pathname === "/api/admin/company-skills/usage") {
    return sendJson(response, 200, { skills: [
      { skillId: "company-preview-1", invoked: 31, succeeded: 30, failed: 1, cancelled: 0 },
      { skillId: "company-preview-2", invoked: 16, succeeded: 16, failed: 0, cancelled: 0 }
    ] });
  }
  if (pathname.startsWith("/api/")) return sendJson(response, 200, { ok: true, preview: true });
  return false;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  if (handleApi(request, response, pathname) !== false) return;
  if (pathname === "/" || pathname === "/admin" || pathname === "/admin/") {
    return sendFile(response, path.join(publicRoot, "admin-v11.html"), "text/html; charset=utf-8", previewHtml);
  }
  if (pathname === "/admin/v11.css") return sendFile(response, path.join(publicRoot, "admin-v11.css"), "text/css; charset=utf-8");
  if (pathname === "/admin/v11-theme.css") return sendFile(response, path.join(publicRoot, "admin-v11-theme.css"), "text/css; charset=utf-8");
  if (pathname === "/admin/v11.js") return sendFile(response, path.join(publicRoot, "admin-v11.js"), "text/javascript; charset=utf-8", previewScript);
  if (pathname === "/admin/v11-icon.png") return sendFile(response, path.join(publicRoot, "admin-v11-icon.png"), "image/png");
  if (pathname === "/admin/jszip.min.js") return sendFile(response, require.resolve("jszip/dist/jszip.min.js"), "text/javascript; charset=utf-8");
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`XMAI Studio admin migration preview: http://127.0.0.1:${port}/admin\n`);
});
