"use strict";

const rootPath = location.pathname.replace(/\/admin(?:\/index\.html)?\/?$/, "");
const apiUrl = (value) => `${rootPath}${value}`;
const $ = (selector, root = document) => root.querySelector(selector);
const elements = {
  navigation: $("#navigation"), content: $("#content"), pageTitle: $("#pageTitle"), pageEyebrow: $("#pageEyebrow"),
  refreshButton: $("#refreshButton"), statusBar: $("#statusBar"),
  skillBadge: $("#skillBadge"), editorDialog: $("#editorDialog"), editorForm: $("#editorForm"), editorEyebrow: $("#editorEyebrow"),
  editorTitle: $("#editorTitle"), editorFields: $("#editorFields"), detailDialog: $("#detailDialog"), detailTitle: $("#detailTitle"),
  detailContent: $("#detailContent"), detailActions: $("#detailActions"), userDialog: $("#userDialog"), userDetailTitle: $("#userDetailTitle"),
  userDetailIdentifier: $("#userDetailIdentifier"), userDetailContent: $("#userDetailContent"), toast: $("#toast"),
  directPublishDialog: $("#directPublishDialog"), directPublishForm: $("#directPublishForm"), directCategory: $("#directCategory"),
  directTagOptions: $("#directTagOptions"), directPublishProgress: $("#directPublishProgress"), directFolderStatus: $("#directFolderStatus"),
  directFolderPreview: $("#directFolderPreview"), directFolderFileCount: $("#directFolderFileCount"), directFolderFileList: $("#directFolderFileList")
};

const storedAdminContext = (() => {
  try { return JSON.parse(sessionStorage.getItem("xianma.v11.adminContext") || "{}"); } catch { return {}; }
})();

const state = {
  view: "overview", connected: true, skillSection: "reviews", configSection: "categories", range: "today", customFrom: "", customTo: "",
  overview: null, submissions: [], companySkills: [], companyUsage: [], users: [], categories: [], tags: [], releases: [],
  selectedSubmission: null, editorAction: null, suggestedInternalVersion: "1.4.1", releaseAuthenticated: false,
  releaseAdminToken: sessionStorage.getItem("xianma.v11.releaseAdminToken") || "",
  skillFilters: { query: "", categoryIds: [], page: 1, pageSize: 10 },
  userFilters: { query: "", accountStatus: "", onlineStatus: "" },
  directSource: "zip",
  adminContext: storedAdminContext && typeof storedAdminContext === "object" ? storedAdminContext : {},
  adminDisplayName: String(storedAdminContext?.username || storedAdminContext?.displayName || sessionStorage.getItem("xianma.v11.adminDisplayName") || "")
};

const trustedAdminParentOrigins = new Set(["http://xmjh.aipro123.top:8866", "http://223.4.248.121:8866"]);

const viewMeta = {
  requirements: ["需求管理", "需求提报"],
  overview: ["首页", "运营概况"], skills: ["技能管理", "技能治理"], users: ["XMAI Studio 用户", "用户使用概况"],
  config: ["基础配置", "技能基础数据"], releases: ["版本发布", "客户端更新管理"]
};
const moduleLabels = { AI_CHAT: "AI 对话", SKILL_LIBRARY: "技能库", BROWSER_TOOL: "浏览器工具", SEARCH: "搜索", PROMPT_LIBRARY: "提示词库", SCHEDULED: "已安排", TASK_RESULT: "任务结果" };
const moduleActionLabels = { send_message: "发起任务", use_skill: "使用技能", execute_skill: "调用技能", submit_for_review: "提交审核", execute_browser_task: "执行任务", delete_personal_skill: "删除技能" };

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function isReleaseEndpoint(endpoint) { return String(endpoint || "").startsWith("/api/admin/releases"); }
function releaseToken() { return String($("#releaseAdminToken")?.value || state.releaseAdminToken || "").trim(); }
function headers(endpoint, json = false) {
  const context = state.adminContext || {};
  return {
    ...(isReleaseEndpoint(endpoint) && releaseToken() ? { authorization: `Bearer ${releaseToken()}` } : {}),
    ...(state.adminDisplayName ? { "x-admin-name": encodeURIComponent(state.adminDisplayName) } : {}),
    ...(context.adminId ? { "x-admin-id": encodeURIComponent(context.adminId) } : {}),
    ...(context.username ? { "x-admin-username": encodeURIComponent(context.username) } : {}),
    ...(json ? { "content-type": "application/json" } : {})
  };
}
async function request(endpoint, options = {}) {
  const response = await fetch(apiUrl(endpoint), { ...options, headers: { ...headers(endpoint, Boolean(options.body)), ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.message || `请求失败：${response.status}`);
  return result;
}
async function downloadZip(endpoint, fileName) {
  const response = await fetch(apiUrl(endpoint), { headers: headers(endpoint) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `技能包下载失败：${response.status}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "skill.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function downloadSubmissionPackage(submissionId, item = state.submissions.find((entry) => entry.submissionId === submissionId) || {}) {
  const name = item.enterpriseDisplayName || item.displayName || item.name || "skill";
  const version = item.version || "package";
  await downloadZip(`/api/admin/skill-submissions/${encodeURIComponent(submissionId)}/package`, `${name}-${version}.zip`);
  toast("技能压缩包已开始下载");
}
function setStatus(message, error = false) { elements.statusBar.textContent = message; elements.statusBar.classList.toggle("error", error); }
function setConnected(connected) { state.connected = connected; document.body.classList.toggle("connected", connected); }
function toast(message) { elements.toast.textContent = message; elements.toast.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { elements.toast.hidden = true; }, 2600); }
function adminContextText(value, maximumLength = 80) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength); }
function normalizedAdminContext(source = {}) {
  const displayName = adminContextText(source.displayName || source.dingtalkNickname || source.nickname || source.nickName || source.realName || source.username);
  return {
    adminId: adminContextText(source.adminId || source.userId || source.id, 128),
    username: adminContextText(source.username || source.userName || source.loginName, 128),
    displayName
  };
}
function applyAdminContext(source) {
  const context = normalizedAdminContext(source);
  if (!context.displayName) return false;
  const actorName = context.username || context.displayName;
  state.adminContext = context;
  state.adminDisplayName = actorName;
  sessionStorage.setItem("xianma.v11.adminContext", JSON.stringify(context));
  sessionStorage.setItem("xianma.v11.adminDisplayName", actorName);
  return true;
}
function clearAdminContext() {
  state.adminContext = {};
  state.adminDisplayName = "";
  sessionStorage.removeItem("xianma.v11.adminContext");
  sessionStorage.removeItem("xianma.v11.adminDisplayName");
}
function requestAdminContext() {
  if (window.parent === window) return;
  try {
    const parentOrigin = new URL(document.referrer).origin;
    if (trustedAdminParentOrigins.has(parentOrigin)) window.parent.postMessage({ type: "XMAI_ADMIN_CONTEXT_REQUEST", protocolVersion: 1 }, parentOrigin);
  } catch {}
}
function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
function formatBytes(value) { const bytes = Number(value || 0); if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
function formatRate(value) { return value == null ? "—" : `${value}%`; }
function statusLabel(value) { return ({ pending: "待审批", approved: "待发布", published: "已发布", rejected: "已驳回", withdrawn: "已撤回", revoked: "已下架", ENABLED: "启用", DISABLED: "停用", active: "已激活", disabled: "已停用" })[value] || value || "未知"; }
function empty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }
function table(headersList, rows) { return rows.length ? `<div class="table-panel"><table><thead><tr>${headersList.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : empty("暂无数据"); }
function viewHeader(title, description, tools = "") { return `<div class="view-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="tools">${tools}</div></div>`; }
function skillUsage(skillId) { return state.companyUsage.find((item) => item.skillId === skillId) || { invoked: 0, succeeded: 0, failed: 0, cancelled: 0 }; }
function updateSkillBadge() { const count = state.submissions.filter((item) => item.status === "pending").length; elements.skillBadge.textContent = String(count); elements.skillBadge.style.display = count ? "inline-grid" : "none"; }
function dingtalkNickname(...identities) { for (const identity of identities) { const nickname = String(identity?.name || "").trim(); if (nickname) return isPrivateDeveloperIdentity(identity) ? "开发团队" : nickname; } return "钉钉用户"; }
function categoryName(categoryId, fallback = "-") { return state.categories.find((item) => item.categoryId === categoryId)?.name || fallback || "-"; }
function tagNames(tagIds = [], provided = []) { const byId = new Map(state.tags.map((item) => [item.tagId, item.name])); return (provided.length ? provided : tagIds.map((id) => byId.get(id) || id)).filter(Boolean); }
function tagChips(tagIds = [], provided = []) { const names = tagNames(tagIds, provided); return names.length ? `<div class="tag-list">${names.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : "-"; }
function auditLabel(action) { return ({ submitted: "提交审核", approved: "审核通过", rejected: "审核驳回", published: "发布企业技能", "direct-published": "管理员直接发布", revoked: "下架企业技能", republished: "重新发布", withdrawn: "员工撤回" })[action] || action || "状态更新"; }
const PRIVATE_DEVELOPER_NICKNAMES = new Set(["林动"]);
function identityNames(identity) {
  if (!identity) return [];
  if (typeof identity === "string") return [identity];
  return [identity.name, identity.nickname, identity.nickName, identity.displayName, identity.username, identity.userName, identity.realName, identity.submitterName, identity.dingtalkNickname];
}
function isPrivateDeveloperIdentity(...identities) { return identities.some((identity) => identityNames(identity).some((name) => PRIVATE_DEVELOPER_NICKNAMES.has(String(name || "").trim()))); }
function privacySafeIdentityName(name, fallback = "开发团队") { return isPrivateDeveloperIdentity(name) ? fallback : String(name || fallback); }
function auditTimeline(items = []) { return items.length ? `<ol class="audit-timeline">${items.map((item) => `<li><span></span><div><strong>${escapeHtml(auditLabel(item.action))}</strong><small>${formatDate(item.occurredAt)} · ${escapeHtml(privacySafeIdentityName(item.actor, "平台管理员"))}</small>${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="section-note">暂无处理记录</p>`; }

function rangeQuery() {
  const now = new Date();
  let from = new Date(now); let to = now;
  if (state.range === "today") from.setHours(0, 0, 0, 0);
  if (state.range === "7d") from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (state.range === "30d") from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (state.range === "custom" && state.customFrom) from = new Date(`${state.customFrom}T00:00:00+08:00`);
  if (state.range === "custom" && state.customTo) to = new Date(`${state.customTo}T23:59:59+08:00`);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

function shanghaiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function validateCustomRange(from, to) {
  if (!from || !to) throw new Error("请选择完整的开始日和结束日");
  if (from > to) throw new Error("开始日不能晚于结束日");
  if (to > shanghaiToday()) throw new Error("结束日不能晚于今天");
}

function renderTrendChart(items) {
  const hasTaskData = items.some((item) => Number(item.tasks || 0) > 0 || Number(item.succeeded || 0) > 0 || Number(item.failed || 0) > 0);
  if (!items.length || !hasTaskData) return empty("当前周期暂无任务数据");
  const width = 1000;
  const height = 220;
  const top = 18;
  const bottom = 20;
  const maxValue = Math.max(1, ...items.flatMap((item) => [item.tasks, item.succeeded, item.failed]));
  const x = (index) => items.length === 1 ? width / 2 : 10 + index * (width - 20) / (items.length - 1);
  const y = (value) => top + (height - top - bottom) * (1 - Number(value || 0) / maxValue);
  const series = [
    ["tasks", "tasks", "任务数"],
    ["succeeded", "success", "成功数"],
    ["failed", "failure", "失败数"]
  ];
  const grid = [0, .25, .5, .75, 1].map((ratio) => `<line x1="0" y1="${top + (height - top - bottom) * ratio}" x2="${width}" y2="${top + (height - top - bottom) * ratio}" />`).join("");
  const paths = series.map(([key, className, label]) => {
    const points = items.map((item, index) => `${x(index).toFixed(2)},${y(item[key]).toFixed(2)}`).join(" ");
    const dots = items.map((item, index) => `<circle cx="${x(index).toFixed(2)}" cy="${y(item[key]).toFixed(2)}" r="4"><title>${escapeHtml(item.label)} ${label} ${Number(item[key] || 0)}</title></circle>`).join("");
    return `<g class="trend-series ${className}"><polyline points="${points}" />${dots}</g>`;
  }).join("");
  return `<div class="trend-chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="任务、成功和失败趋势折线图"><g class="trend-grid">${grid}</g>${paths}</svg><div class="trend-labels" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map((item) => `<small title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</small>`).join("")}</div></div>`;
}

async function loadOverview() { state.overview = await request(`/api/admin/v11/overview?${rangeQuery()}`); if (state.view === "overview") renderOverview(); }
function renderOverview() {
  const data = state.overview;
  if (!data) return elements.content.innerHTML = empty("正在读取运营数据");
  const platformRealtime = [
    ["累计用户", data.realtime.cumulativeUsers, "历史累计，停用后仍保留"], ["当前有效用户", data.realtime.currentUsers, "当前仍有 XMAI Studio 使用资格"],
    ["当前在线", data.realtime.onlineUsers, "最近 5 分钟有效心跳，按用户去重"], ["近 30 天活跃设备", data.realtime.activeDevices30d, "最近 30 天有效心跳，按设备去重"]
  ];
  const skillRealtime = [
    ["企业技能数", data.realtime.enterpriseSkills, `含已发布、已下架；当前已发布 ${Number(data.realtime.publishedEnterpriseSkills || 0)} 个`],
    ["待审批", data.realtime.pendingReview, "等待管理员处理", "去审批"], ["待发布", data.realtime.pendingPublish, "审批通过，尚未发布", "去发布"]
  ];
  const period = [
    ["访问用户", data.period.visitUsers], ["活跃用户", data.period.activeUsers], ["任务用户", data.period.taskUsers], ["任务数", data.period.tasks],
    ["成功数", data.period.succeeded], ["失败数", data.period.failed], ["成功率", formatRate(data.period.successRate)], ["企业技能调用", data.period.companySkillInvocations]
  ];
  const rankingModules = (data.modules || []).filter((item) => item.moduleCode !== "TASK_RESULT");
  const maxModule = Math.max(1, ...rankingModules.map((item) => item.visits));
  const maximumDate = shanghaiToday();
  const custom = state.range === "custom" ? `<input id="customFrom" type="date" max="${maximumDate}" value="${escapeHtml(state.customFrom)}"><input id="customTo" type="date" max="${maximumDate}" value="${escapeHtml(state.customTo)}"><button class="secondary" data-apply-range>应用</button>` : "";
  const metric = ([label, value, note, action]) => action
    ? `<button type="button" class="metric attention" data-overview-skill-section="${action === "去审批" ? "reviews" : "publishing"}"><span class="metric-dot"></span><small>${escapeHtml(label)}</small><strong>${Number(value || 0)}</strong><em>${escapeHtml(note)}</em><span class="metric-action">${escapeHtml(action)}</span></button>`
    : `<div class="metric"><span class="metric-dot"></span><small>${escapeHtml(label)}</small><strong>${Number(value || 0)}</strong><em>${escapeHtml(note)}</em></div>`;
  elements.content.innerHTML = `
    ${viewHeader("首页", "查看平台核心使用情况和技能治理进度。", `<button class="secondary" data-refresh-overview>↻ 刷新数据</button>`)}
    <section class="overview-section"><div><h3>实时概况</h3><small>当前状态与历史累计，不受下方时间范围影响</small></div><div class="overview-group"><small>平台覆盖</small><div class="metrics">${platformRealtime.map(metric).join("")}</div></div><div class="overview-group"><small>技能治理</small><div class="metrics skills">${skillRealtime.map(metric).join("")}</div></div></section>
    <div class="section-tools" style="margin-top:14px"><div><strong>使用概况</strong><small style="display:block;color:var(--muted);margin-top:3px">按所选时间范围统计真实客户端事件</small></div><div class="range-tabs">${[["today","今日"],["7d","近 7 天"],["30d","近 30 天"],["custom","自定义"]].map(([id,label]) => `<button class="tab-button ${state.range === id ? "active" : ""}" data-overview-range="${id}">${label}</button>`).join("")}${custom}</div></div>
    <div class="metrics">${period.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${escapeHtml(value)}</strong><em>周期内真实去重统计</em></div>`).join("")}</div>
    <div class="dashboard-grid">
      <section class="panel trend-panel"><div class="panel-head"><div><h3>任务趋势</h3><small>${({"two-hours":"每 2 小时统计","day":"按天统计","week":"按周统计","month":"按月统计"})[data.trendGranularity] || "按天统计"}</small></div><div class="trend-legend"><span class="tasks">任务数</span><span class="success">成功数</span><span class="failure">失败数</span></div></div><div class="panel-body">${renderTrendChart(data.trend || [])}</div></section>
      <section class="panel module-ranking-panel"><div class="panel-head"><h3>功能使用排行</h3></div><div class="panel-body"><div class="module-list">${rankingModules.length ? rankingModules.map((item) => `<div class="module-row"><strong>${escapeHtml(moduleLabels[item.moduleCode] || item.moduleCode)}</strong><div class="module-track"><span style="width:${Math.max(2, item.visits / maxModule * 100)}%"></span></div><small>使用 ${Number(item.visits || 0)} 次</small></div>`).join("") : empty("暂无模块使用记录")}</div></div></section>
    </div>`;
}

async function loadSkillsData() {
  const [submissions, company, usage] = await Promise.all([request("/api/admin/skill-submissions"), request("/api/admin/company-skills"), request("/api/admin/company-skills/usage")]);
  state.submissions = (submissions.submissions || []).filter((item) => !isPrivateDeveloperIdentity(item.submitter));
  state.companySkills = company.skills || [];
  state.companyUsage = usage.skills || [];
  updateSkillBadge(); if (state.view === "skills") renderSkills();
}
function renderSkills() {
  const counts = { reviews: state.submissions.filter((item) => item.status === "pending").length, publishing: state.submissions.filter((item) => item.status === "approved").length, enterprise: state.companySkills.length };
  const tabs = `<div class="subtabs">${[["reviews","技能审批"],["publishing","待发布"],["enterprise","企业技能"]].map(([id,label]) => `<button class="tab-button ${state.skillSection === id ? "active" : ""}" data-skill-section="${id}">${label}<b>${counts[id]}</b></button>`).join("")}</div>`;
  const selectedCategories = new Set(state.skillFilters.categoryIds);
  const categoryFilter = `<details class="multi-filter"><summary>分类${selectedCategories.size ? ` (${selectedCategories.size})` : ""}</summary><div class="multi-filter-popover"><input id="skillCategorySearch" type="search" placeholder="搜索分类"><div class="multi-filter-options">${state.categories.filter((item) => item.status === "ENABLED").map((item) => `<label data-category-option><input type="checkbox" data-skill-category value="${escapeHtml(item.categoryId)}" ${selectedCategories.has(item.categoryId) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`).join("")}</div><small>多选分类按任一匹配</small></div></details>`;
  const tools = `<div class="filters"><input id="skillSearch" value="${escapeHtml(state.skillFilters.query)}" placeholder="搜索技能名称或提交人">${categoryFilter}<button class="secondary" data-reset-skill-filter>重置</button></div>`;
  let rows = [];
  let headersList = [];
  if (state.skillSection === "enterprise") {
    rows = state.companySkills.map((item) => { const latest = item.versions?.[0]; const usage = skillUsage(item.skillId); const source = state.submissions.find((entry) => entry.submissionId === latest?.submissionId); const creator = privacySafeIdentityName(dingtalkNickname(item.creator, source?.submitter)); return `<tr data-skill-row data-search-value="${escapeHtml(`${item.displayName} ${creator}`)}" data-category-id="${escapeHtml(item.categoryId)}"><td><div class="cell-main"><strong>${escapeHtml(item.displayName)}</strong><small>企业独立副本</small></div></td><td>${escapeHtml(creator)}</td><td>${escapeHtml(item.category || categoryName(item.categoryId))}</td><td>${tagChips(item.tagIds, item.tagNames)}</td><td>v${escapeHtml(latest?.version || "-")}</td><td>${Number(usage.invoked || 0)}</td><td>${formatDate(item.updatedAt || latest?.publishedAt)}</td><td><span class="status ${escapeHtml(item.status)}">${statusLabel(item.status)}</span></td><td><div class="row-actions"><button class="secondary" data-company-detail="${escapeHtml(item.skillId)}">查看</button>${item.status === "published" ? `<button class="secondary" data-download-company-skill="${escapeHtml(item.skillId)}" data-version="${escapeHtml(latest?.version || "")}">下载</button><button class="danger" data-revoke-skill="${escapeHtml(item.skillId)}">下架</button>` : `<button class="primary" data-republish-skill="${escapeHtml(item.skillId)}" data-version="${escapeHtml(latest?.version || "")}">重新发布</button>`}<button class="danger" data-delete-company-skill="${escapeHtml(item.skillId)}">删除</button></div></td></tr>`; });
    headersList = ["企业技能", "创建人", "分类", "标签", "当前版本", "累计调用次数", "更新时间", "状态", "操作"];
  } else {
    const status = state.skillSection === "reviews" ? "pending" : "approved";
    rows = state.submissions.filter((item) => item.status === status).map((item) => { const categoryId = status === "approved" ? (item.enterpriseCategoryId || item.categoryId) : item.categoryId; const tags = status === "approved" ? (item.enterpriseTagIds || item.tagIds) : item.tagIds; const names = status === "approved" ? item.enterpriseTagNames : []; const pendingNewTags = status === "pending" && item.newTags?.length ? `<span class="tag-chip">${item.newTags.map(escapeHtml).join('</span><span class="tag-chip">')}</span>` : ""; const submitter = dingtalkNickname(item.submitter); return `<tr data-skill-row data-search-value="${escapeHtml(`${item.displayName} ${item.enterpriseDisplayName || ""} ${submitter}`)}" data-category-id="${escapeHtml(categoryId)}"><td><div class="cell-main"><strong>${escapeHtml(status === "approved" ? (item.enterpriseDisplayName || item.displayName) : item.displayName)}</strong><small>${status === "approved" ? `个人技能：${escapeHtml(item.displayName)}` : "SKILL.md 校验通过"}</small></div></td><td>${escapeHtml(submitter)}</td><td>${escapeHtml(status === "approved" ? (item.enterpriseCategory || categoryName(categoryId, item.category)) : item.category || categoryName(categoryId))}</td><td>${tagChips(tags, names)}${pendingNewTags}</td><td>v${escapeHtml(item.version)}</td><td>${formatDate(status === "approved" ? item.approvedAt : item.submittedAt)}</td><td><span class="status ${status}">${statusLabel(status)}</span></td><td><div class="row-actions"><button class="secondary" data-detail-submission="${escapeHtml(item.submissionId)}">查看</button><button class="secondary" data-download-submission="${escapeHtml(item.submissionId)}">下载</button>${status === "pending" ? `<button class="primary" data-review-submission="${escapeHtml(item.submissionId)}">审批</button>` : `<button class="primary" data-publish-submission="${escapeHtml(item.submissionId)}" data-state-version="${Number(item.stateVersion || 1)}">发布</button>`}<button class="danger" data-delete-submission="${escapeHtml(item.submissionId)}">删除</button></div></td></tr>`; });
    headersList = [state.skillSection === "reviews" ? "技能" : "企业发布名称", "提交人", "分类", "标签", "版本", state.skillSection === "reviews" ? "提交时间" : "审批通过时间", "状态", "操作"];
  }
  elements.content.innerHTML = `${viewHeader("技能管理", "完成员工技能审批、企业发布与企业技能治理。", `<button class="primary" data-direct-publish>＋ 直接发布企业技能</button>`)}${tabs}<div class="section-tools">${tools}<small id="skillResultCount">共 ${rows.length} 条记录</small></div>${table(headersList, rows)}<div id="skillPagination" class="pagination"></div>`;
  filterSkillRows();
}

async function openSubmissionDetail(submissionId, mode = "view") {
  const result = await request(`/api/admin/skill-submissions/${encodeURIComponent(submissionId)}`); const item = result.submission; state.selectedSubmission = item;
  if (isPrivateDeveloperIdentity(item?.submitter)) { state.selectedSubmission = null; toast("该记录不在管理后台展示范围内"); return; }
  elements.detailTitle.textContent = item.displayName;
  const selectedTagIds = new Set(item.enterpriseTagIds?.length ? item.enterpriseTagIds : item.tagIds || []);
  const governance = mode === "review" && item.status === "pending" ? `<section class="detail-section approval-editor"><div><h3>企业发布信息</h3><small class="section-note">只影响审核后的企业副本，不修改员工个人技能。</small></div><label class="field"><span>企业分类</span><select id="approvalCategory">${state.categories.filter((entry) => entry.status === "ENABLED").map((entry) => `<option value="${escapeHtml(entry.categoryId)}" ${entry.categoryId === (item.enterpriseCategoryId || item.categoryId) ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select></label><div class="field"><span>企业标签（至少选择一个）</span><input id="approvalTagSearch" type="search" placeholder="搜索标签"><div class="tag-options">${state.tags.filter((entry) => entry.status === "ENABLED").map((entry) => `<label data-approval-tag-option><input type="checkbox" data-approval-tag value="${escapeHtml(entry.tagId)}" ${selectedTagIds.has(entry.tagId) ? "checked" : ""}><span>${escapeHtml(entry.name)}</span></label>`).join("")}</div></div><label class="field"><span>新增标签（可选，使用逗号分隔）</span><input id="approvalNewTags" value="${escapeHtml((item.newTags || []).join(', '))}" placeholder="例如：会议纪要, 管理工具"></label></section>` : "";
  const enterpriseInfo = item.enterpriseCategoryId ? `<section class="detail-section"><h3>企业副本配置</h3><div class="detail-grid"><div class="detail-item"><small>企业发布名称</small><strong>${escapeHtml(item.enterpriseDisplayName || "待发布时填写")}</strong></div><div class="detail-item"><small>企业分类</small><strong>${escapeHtml(item.enterpriseCategory || categoryName(item.enterpriseCategoryId))}</strong></div><div class="detail-item"><small>企业标签</small><strong>${escapeHtml(tagNames(item.enterpriseTagIds, item.enterpriseTagNames).join("、") || "-")}</strong></div></div></section>` : "";
  elements.detailContent.innerHTML = `<section class="detail-section"><h3>基本信息</h3><div class="detail-grid"><div class="detail-item"><small>个人技能标识</small><strong>${escapeHtml(item.name)}</strong></div><div class="detail-item"><small>版本</small><strong>${escapeHtml(item.version)}</strong></div><div class="detail-item"><small>状态</small><strong>${statusLabel(item.status)}</strong></div><div class="detail-item"><small>提交人</small><strong>${escapeHtml(dingtalkNickname(item.submitter))}</strong></div><div class="detail-item"><small>部门</small><strong>${escapeHtml(item.submitter?.department || "-")}</strong></div><div class="detail-item"><small>风险级别</small><strong>${escapeHtml(item.riskLevel || "standard")}</strong></div></div></section><section class="detail-section"><h3>说明</h3><p>${escapeHtml(item.description)}</p></section>${enterpriseInfo}${governance}<section class="detail-section"><h3>风险项</h3>${item.riskItems?.length ? `<pre>${escapeHtml(item.riskItems.join("\n"))}</pre>` : `<span class="status enabled">未发现高风险项</span>`}</section><section class="detail-section"><h3>处理记录</h3>${auditTimeline(item.auditTrail)}</section><section class="detail-section"><h3>文件结构</h3><pre>${escapeHtml((item.fileTree || []).map((entry) => typeof entry === "string" ? entry : `${entry.path}  ${formatBytes(entry.size)}`).join("\n"))}</pre></section>${(item.previews || []).map((preview) => `<section class="detail-section"><h3>${escapeHtml(preview.path || "内容预览")}</h3><pre>${escapeHtml(preview.content || "")}</pre></section>`).join("")}`;
  const actions = [`<button class="secondary" value="cancel">关闭</button>`, `<button class="secondary" type="button" data-download-submission="${escapeHtml(item.submissionId)}">下载原始包</button>`];
  if (mode === "review" && item.status === "pending") actions.push(`<button class="danger" type="button" data-reject-submission="${escapeHtml(item.submissionId)}">驳回</button><button class="primary" type="button" data-approve-submission="${escapeHtml(item.submissionId)}" data-state-version="${Number(item.stateVersion || 1)}">审核通过</button>`);
  if (item.status === "approved") actions.push(`<button class="primary" type="button" data-publish-submission="${escapeHtml(item.submissionId)}" data-state-version="${Number(item.stateVersion || 1)}">发布</button>`);
  if (!["published", "revoked"].includes(item.status)) actions.push(`<button class="danger" type="button" data-delete-submission="${escapeHtml(item.submissionId)}">永久删除</button>`);
  elements.detailActions.innerHTML = actions.join(""); elements.detailDialog.showModal();
}
async function approveSubmission(id, stateVersion) { const item = state.selectedSubmission || state.submissions.find((entry) => entry.submissionId === id); const categoryId = $("#approvalCategory")?.value || ""; const tagIds = [...elements.detailContent.querySelectorAll("[data-approval-tag]:checked")].map((input) => input.value); const newTags = String($("#approvalNewTags")?.value || "").split(/[,，]/).map((value) => value.trim()).filter(Boolean); if (!categoryId) throw new Error("请选择企业分类"); if (!tagIds.length && !newTags.length) throw new Error("请至少选择一个企业标签"); if (item?.riskLevel === "high" && !confirm("该技能包含脚本、命令或网络访问。确认已经核对风险项并继续批准吗？")) return; await request(`/api/admin/skill-submissions/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ stateVersion, categoryId, tagIds, newTags, riskAcknowledged: true }) }); elements.detailDialog.close(); toast("技能已审核通过，已进入待发布"); await Promise.all([loadSkillsData(), loadTaxonomy()]); }
function rejectSubmission(id) { openEditor("填写驳回原因", "原因会展示给技能提交人", [{ name: "reason", label: "驳回原因", type: "textarea", required: true }], async (values) => { await request(`/api/admin/skill-submissions/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ reason: values.reason, stateVersion: state.selectedSubmission?.stateVersion }) }); elements.detailDialog.close(); toast("技能已驳回"); await loadSkillsData(); }); }
function publishSubmission(id, stateVersion) { const item = state.submissions.find((entry) => entry.submissionId === id) || state.selectedSubmission; if (!item) return; openEditor("发布企业技能", "发布后全公司员工可在公司技能库安装", [{ name: "enterpriseDisplayName", label: "企业发布名称（全局唯一）", value: item.enterpriseDisplayName || item.displayName, required: true }, { name: "impact", label: "影响范围", value: "发布为独立企业副本，不修改员工个人技能；默认全员可见。", readonly: true }], async (values) => { await request(`/api/admin/skill-submissions/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify({ stateVersion, enterpriseDisplayName: values.enterpriseDisplayName }) }); if (elements.detailDialog.open) elements.detailDialog.close(); toast("企业技能已发布"); await loadSkillsData(); }); }

function deleteSubmission(id) { const item = state.submissions.find((entry) => entry.submissionId === id) || state.selectedSubmission; if (!item) return; const expectedName = item.enterpriseDisplayName || item.displayName; openEditor(`永久删除“${expectedName}”`, "将删除审核记录和服务器原始技能包，此操作无法恢复，不影响提交人的本地个人技能。", [{ name: "confirmName", label: `输入完整技能名称“${expectedName}”确认`, required: true }], async (values) => { if (values.confirmName.trim() !== expectedName) throw new Error("输入的技能名称不一致"); await request(`/api/admin/skill-submissions/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmName: values.confirmName.trim() }) }); if (elements.detailDialog.open) elements.detailDialog.close(); toast("技能提交及服务器文件已永久删除"); await loadSkillsData(); }); }
function deleteCompanySkill(id) { const item = state.companySkills.find((entry) => entry.skillId === id); if (!item) return; openEditor(`永久删除“${item.displayName}”`, "将删除企业技能、全部版本、关联审核记录和匿名使用统计；员工端同步后会停用已安装副本。此操作无法恢复。", [{ name: "confirmName", label: `输入完整技能名称“${item.displayName}”确认`, required: true }], async (values) => { if (values.confirmName.trim() !== item.displayName) throw new Error("输入的技能名称不一致"); await request(`/api/admin/company-skills/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmName: values.confirmName.trim() }) }); if (elements.detailDialog.open) elements.detailDialog.close(); toast("企业技能及服务器文件已永久删除"); await loadSkillsData(); }); }

async function loadUsers(filters = state.userFilters) {
  state.userFilters = {
    query: String(filters?.query || "").trim(),
    accountStatus: ["active", "disabled"].includes(filters?.accountStatus) ? filters.accountStatus : "",
    onlineStatus: ["true", "false"].includes(filters?.onlineStatus) ? filters.onlineStatus : ""
  };
  const query = new URLSearchParams();
  if (state.userFilters.query) query.set("search", state.userFilters.query);
  if (state.userFilters.accountStatus) query.set("accountStatus", state.userFilters.accountStatus);
  if (state.userFilters.onlineStatus) query.set("online", state.userFilters.onlineStatus);
  const result = await request(`/api/admin/v11/users${query.size ? `?${query}` : ""}`);
  state.users = (result.users || []).filter((item) => !isPrivateDeveloperIdentity(item));
  if (state.view === "users") renderUsers();
}
function renderUsers() {
  const filters = state.userFilters;
  const rows = state.users.map((item) => `<tr data-user-row data-account="${item.accountStatus}" data-online="${item.online}"><td><div class="cell-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.dingtalkUserId || item.userId)}</small></div></td><td><span class="status ${item.accountStatus}">${statusLabel(item.accountStatus)}</span></td><td><span class="status ${item.online ? "online" : "offline"}">${item.online ? "在线" : "离线"}</span></td><td>${Number(item.totalTasks || 0)}</td><td>${formatDate(item.firstSeenAt)}</td><td>${formatDate(item.lastLoginAt)}</td><td>${formatDate(item.lastSeenAt)}</td><td><button class="secondary" data-user-detail="${escapeHtml(item.userKey)}">查看详情</button></td></tr>`);
  elements.content.innerHTML = `${viewHeader("XMAI Studio 用户", "查看账号使用状态与平台贡献。", `<button class="secondary" data-refresh-users>↻ 刷新</button>`)}<div class="section-tools"><div class="filters"><input id="userSearch" value="${escapeHtml(filters.query)}" placeholder="搜索用户昵称或账号标识"><select id="accountFilter"><option value="">全部账号状态</option><option value="active" ${filters.accountStatus === "active" ? "selected" : ""}>已激活</option><option value="disabled" ${filters.accountStatus === "disabled" ? "selected" : ""}>已停用</option></select><select id="onlineFilter"><option value="">全部在线状态</option><option value="true" ${filters.onlineStatus === "true" ? "selected" : ""}>在线</option><option value="false" ${filters.onlineStatus === "false" ? "selected" : ""}>离线</option></select><button class="secondary" data-apply-user-filter>查询</button><button class="secondary" data-reset-user-filter>重置</button></div><small>共 ${rows.length} 位用户</small></div>${table(["用户", "账号状态", "在线状态", "累计任务数", "首次登录", "最后登录", "最近活跃", "操作"], rows)}`;
}
function openUserDetail(userKey) {
  const item = state.users.find((user) => user.userKey === userKey);
  if (!item) return;
  const recentRows = (item.recentModules || []).map((module) => `<tr><td>${escapeHtml(moduleLabels[module.moduleCode] || module.moduleCode)}</td><td>${Number(module.visits || 0)}</td><td>${escapeHtml(moduleActionLabels[module.primaryAction] || "关键操作")} ${Number(module.primaryActionCount || module.operations || 0)} 次</td></tr>`);
  elements.userDetailTitle.textContent = item.name;
  elements.userDetailIdentifier.textContent = `账号标识：${item.userId || item.dingtalkUserId || "-"}`;
  elements.userDetailContent.innerHTML = `
    <section class="user-account-summary">
      <div><small>账号状态</small><strong>${statusLabel(item.accountStatus)}</strong></div>
      <div><small>在线状态</small><strong>${item.online ? "在线" : "离线"}</strong></div>
      <div><small>首次登录</small><strong>${formatDate(item.firstSeenAt)}</strong></div>
      <div><small>最后登录</small><strong>${formatDate(item.lastLoginAt)}</strong></div>
      <div><small>最近活跃</small><strong>${formatDate(item.lastSeenAt)}</strong></div>
      <div><small>部门</small><strong>${escapeHtml(item.department || "-")}</strong></div>
    </section>
    <section class="detail-section"><div><h3>使用概况</h3><small class="section-note">累计统计，仅用于了解平台使用情况</small></div><div class="user-usage-metrics">
      <div><small>任务数</small><strong>${Number(item.totalTasks || 0)}</strong></div>
      <div><small>成功数</small><strong>${Number(item.succeededTasks || 0)}</strong></div>
      <div><small>失败数</small><strong>${Number(item.failedTasks || 0)}</strong></div>
      <div><small>成功率</small><strong>${formatRate(item.successRate)}</strong></div>
      <div><small>技能调用</small><strong>${Number(item.skillInvocations || 0)}</strong></div>
    </div></section>
    <section class="detail-section"><h3>最近使用模块</h3>${table(["模块", "访问次数", "关键操作"], recentRows)}</section>`;
  elements.userDialog.showModal();
}

async function loadTaxonomy() { const [categories, tags] = await Promise.all([request("/api/admin/v11/categories"), request("/api/admin/v11/tags")]); state.categories = categories.categories || []; state.tags = tags.tags || []; if (state.view === "config") renderConfig(); }
function taxonomyReferenceCount(kind, id) { const values = [...state.submissions, ...state.companySkills]; return values.filter((item) => kind === "category" ? item.categoryId === id : (item.tagIds || []).includes(id)).length; }
function renderConfig() {
  const isCategory = state.configSection === "categories"; const list = isCategory ? state.categories : state.tags;
  const rows = list.map((item) => { const id = item[isCategory ? "categoryId" : "tagId"]; const refs = taxonomyReferenceCount(isCategory ? "category" : "tag", id); const kind = isCategory ? "category" : "tag"; const nextStatus = item.status === "ENABLED" ? "DISABLED" : "ENABLED"; return `<tr><td><strong>${escapeHtml(item.name)}</strong><small style="display:block;color:var(--muted)">${escapeHtml(id)}</small></td><td>${refs} 个</td><td><span class="status ${item.status === "ENABLED" ? "enabled" : "disabled"}">${statusLabel(item.status)}</span></td><td>${formatDate(item.updatedAt)}</td><td><div class="row-actions"><button class="secondary" data-edit-${kind}="${escapeHtml(id)}">编辑</button><button class="secondary" data-toggle-${kind}="${escapeHtml(id)}" data-next-status="${nextStatus}">${nextStatus === "DISABLED" ? "停用" : "启用"}</button>${!isCategory ? `<button class="secondary" data-merge-tag="${escapeHtml(id)}">合并</button>` : ""}<button class="danger" data-delete-${kind}="${escapeHtml(id)}" ${refs ? "disabled" : ""}>删除</button></div></td></tr>`; });
  elements.content.innerHTML = `${viewHeader("基础配置", "统一维护应用端可选的技能分类和标签。", `<button class="primary" data-create-${isCategory ? "category" : "tag"}>＋ 新增${isCategory ? "分类" : "标签"}</button>`)}<div class="subtabs"><button class="tab-button ${isCategory ? "active" : ""}" data-config-section="categories">分类管理 <b>${state.categories.length}</b></button><button class="tab-button ${!isCategory ? "active" : ""}" data-config-section="tags">标签管理 <b>${state.tags.length}</b></button></div><div class="section-tools"><div class="filters"><input data-taxonomy-search placeholder="搜索${isCategory ? "分类" : "标签"}名称"><select data-taxonomy-status><option value="">全部状态</option><option value="ENABLED">启用</option><option value="DISABLED">停用</option></select><button class="secondary" data-reset-taxonomy>重置</button></div><small>共 ${rows.length} 条配置</small></div>${table([isCategory ? "分类名称" : "标签名称", "引用技能数", "状态", "更新时间", "操作"], rows)}`;
}
function openEditor(title, eyebrow, fields, action) { elements.editorTitle.textContent = title; elements.editorEyebrow.textContent = eyebrow; elements.editorFields.innerHTML = fields.map((field) => `<label class="field"><span>${escapeHtml(field.label)}</span>${field.type === "textarea" ? `<textarea name="${escapeHtml(field.name)}" ${field.required ? "required" : ""}>${escapeHtml(field.value || "")}</textarea>` : field.type === "select" ? `<select name="${escapeHtml(field.name)}">${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === field.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>` : `<input name="${escapeHtml(field.name)}" type="${field.type || "text"}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""} ${field.readonly ? "readonly" : ""}>`}</label>`).join(""); state.editorAction = action; elements.editorDialog.showModal(); }
function taxonomyEditor(kind, item = null) { const isCategory = kind === "category"; openEditor(item ? `编辑${isCategory ? "分类" : "标签"}` : `新增${isCategory ? "分类" : "标签"}`, "技能库基础数据", [{ name: "name", label: "名称", value: item?.name || "", required: true }, { name: "id", label: "标识", value: item?.[isCategory ? "categoryId" : "tagId"] || "", required: true, readonly: Boolean(item) }, { name: "sortOrder", label: "排序", type: "number", value: item?.sortOrder ?? 100 }], async (values) => { const idKey = isCategory ? "categoryId" : "tagId"; const endpoint = `/api/admin/v11/${isCategory ? "categories" : "tags"}${item ? `/${encodeURIComponent(item[idKey])}` : ""}`; await request(endpoint, { method: item ? "PUT" : "POST", body: JSON.stringify({ name: values.name, [idKey]: values.id, sortOrder: Number(values.sortOrder), status: item?.status || "ENABLED" }) }); toast(`${isCategory ? "分类" : "标签"}已保存`); await loadTaxonomy(); }); }

async function toggleTaxonomy(kind, id, status) {
  const isCategory = kind === "category";
  const list = isCategory ? state.categories : state.tags;
  const idKey = isCategory ? "categoryId" : "tagId";
  const item = list.find((entry) => entry[idKey] === id);
  if (!item) return;
  await request(`/api/admin/v11/${isCategory ? "categories" : "tags"}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ status }) });
  toast(`${isCategory ? "分类" : "标签"}已${status === "ENABLED" ? "启用" : "停用"}`);
  await loadTaxonomy();
}

async function loadReleases() {
  if (!releaseToken()) { state.releaseAuthenticated = false; if (state.view === "releases") renderReleases(); return; }
  try {
    const result = await request("/api/admin/releases?channel=stable-v2&platform=win32&arch=x64");
    state.releaseAuthenticated = true;
    state.releaseAdminToken = releaseToken();
    sessionStorage.setItem("xianma.v11.releaseAdminToken", state.releaseAdminToken);
    state.releases = result.releases || [];
    state.suggestedInternalVersion = result.suggestedInternalVersion || "1.4.1";
    if (state.view === "releases") renderReleases();
  } catch (error) {
    state.releaseAuthenticated = false;
    state.releaseAdminToken = "";
    sessionStorage.removeItem("xianma.v11.releaseAdminToken");
    if (state.view === "releases") renderReleases(error.message);
    throw error;
  }
}
function renderReleases(authError = "") {
  if (!state.releaseAuthenticated) {
    elements.content.innerHTML = `${viewHeader("版本发布", "只有版本发布需要验证管理员密码，其他管理页面无需输入。")}<section class="panel release-auth-panel"><form id="releaseAuthForm"><div><h3>验证发布权限</h3><p>输入管理员密码后，可查看历史版本并上传测试安装包。</p></div><label class="field"><span>管理员密码</span><input id="releaseAdminToken" type="password" autocomplete="current-password" placeholder="请输入管理员密码" required></label>${authError ? `<small class="form-error">${escapeHtml(authError)}</small>` : ""}<button class="primary" type="submit">验证并进入版本发布</button></form></section>`;
    return;
  }
  const rows = state.releases.map((item) => `<tr><td>${escapeHtml(item.displayVersion)}</td><td>${escapeHtml(item.internalVersion)}</td><td>${escapeHtml(item.channel)}</td><td><div class="cell-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.notes)}</small></div></td><td>${formatBytes(item.size)}</td><td><span class="status ${item.status === "published" ? "published" : "revoked"}">${statusLabel(item.status)}</span></td><td>${formatDate(item.publishedAt)}</td><td><div class="row-actions">${item.status === "published" ? `<button class="danger" data-revoke-release="${escapeHtml(item.releaseId)}">撤回</button>` : `<button class="danger" data-delete-release="${escapeHtml(item.releaseId)}">永久删除</button>`}</div></td></tr>`);
  elements.content.innerHTML = `${viewHeader("版本发布", "正式更新通道为 stable-v2，发布后符合条件的客户端将收到更新。", `<button class="secondary" data-lock-releases>退出发布管理</button>`)}<section class="panel"><form id="releaseForm" class="release-form"><label class="field"><span>显示版本</span><input name="displayVersion" value="2.0.0" required></label><label class="field"><span>内部版本</span><input name="internalVersion" value="${escapeHtml(state.suggestedInternalVersion)}" required></label><label class="field"><span>通道</span><input value="stable-v2" readonly></label><label class="field wide"><span>更新标题</span><input name="title" value="XMAI Studio 2.0.0" required></label><label class="field wide"><span>更新内容</span><textarea name="notes" required></textarea></label><label class="field wide"><span>Windows 安装包</span><input name="installer" type="file" accept=".exe" required></label><div class="release-progress"><progress id="releaseProgress" max="100" value="0"></progress><small id="releaseProgressText">等待选择安装包</small></div><div class="field wide"><button class="primary" type="submit">上传并发布正式更新</button></div></form></section><div style="height:14px"></div>${viewHeader("历史版本", "撤回后客户端不再检测；永久删除只允许已撤回版本。")}${table(["显示版本", "内部版本", "通道", "说明", "大小", "状态", "发布时间", "操作"], rows)}`;
}
async function uploadRelease(form) { const file = form.installer.files[0]; if (!file || !/\.exe$/i.test(file.name)) throw new Error("请选择 EXE 安装包"); const metadata = { displayVersion: form.displayVersion.value.trim(), internalVersion: form.internalVersion.value.trim(), channel: "stable-v2", platform: "win32", arch: "x64", title: form.title.value.trim(), notes: form.notes.value.trim(), force: false, fileName: file.name, fileSize: file.size, fileFingerprint: `${file.name}-${file.size}-${file.lastModified}` }; const session = await request("/api/admin/releases/uploads", { method: "POST", body: JSON.stringify(metadata) }); const uploaded = new Set(session.uploadedChunks || []); const progress = $("#releaseProgress"); const label = $("#releaseProgressText"); for (let index = 0; index < session.chunkCount; index += 1) { if (uploaded.has(index)) continue; const start = index * session.chunkSize; const chunk = file.slice(start, Math.min(file.size, start + session.chunkSize)); let completed = false; for (let attempt = 1; attempt <= 6 && !completed; attempt += 1) { const response = await fetch(apiUrl(`/api/admin/releases/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`), { method: "PUT", headers: { authorization: `Bearer ${releaseToken()}`, "content-type": "application/octet-stream", "content-length": String(chunk.size) }, body: chunk }).catch(() => null); if (response?.ok) completed = true; else if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt))); } if (!completed) throw new Error(`第 ${index + 1} 个分片上传失败`); progress.value = Math.floor((index + 1) / session.chunkCount * 96); label.textContent = `正在上传 ${index + 1}/${session.chunkCount}`; } await request(`/api/admin/releases/uploads/${encodeURIComponent(session.uploadId)}/complete`, { method: "POST" }); progress.value = 100; label.textContent = "发布完成"; toast("正式版本已发布"); await loadReleases(); }

function setDirectSource(source) {
  state.directSource = ["zip", "folder", "github"].includes(source) ? source : "zip";
  elements.directPublishDialog.querySelectorAll("[data-direct-source]").forEach((button) => button.classList.toggle("active", button.dataset.directSource === state.directSource));
  elements.directPublishDialog.querySelectorAll("[data-source-panel]").forEach((panel) => { panel.hidden = panel.dataset.sourcePanel !== state.directSource; });
}

function renderDirectTagOptions(query = "") {
  const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN");
  const selected = new Set([...elements.directTagOptions.querySelectorAll("input:checked")].map((input) => input.value));
  elements.directTagOptions.innerHTML = state.tags.filter((item) => item.status === "ENABLED" && (!normalized || item.name.toLocaleLowerCase("zh-CN").includes(normalized))).map((item) => `<label><input type="checkbox" value="${escapeHtml(item.tagId)}" ${selected.has(item.tagId) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`).join("") || `<small>没有匹配的标签，可在下方新增</small>`;
}

function openDirectPublish() {
  elements.directPublishForm.reset();
  elements.directCategory.innerHTML = `<option value="">请选择分类</option>${state.categories.filter((item) => item.status === "ENABLED").map((item) => `<option value="${escapeHtml(item.categoryId)}">${escapeHtml(item.name)}</option>`).join("")}`;
  elements.directTagOptions.innerHTML = "";
  renderDirectTagOptions();
  setDirectSource("zip");
  updateDirectFolderStatus([]);
  elements.directPublishProgress.hidden = true;
  elements.directPublishDialog.showModal();
}

function analyzeDirectFolder(files) {
  const selected = [...(files || [])];
  if (!selected.length) return { valid: false, empty: true, entries: [], folderName: "所选文件夹", error: "请选择技能文件夹" };
  const entries = selected.map((file) => {
    const sourcePath = String(file.webkitRelativePath || file.name).replaceAll("\\", "/");
    const pathParts = sourcePath.split("/").filter(Boolean);
    if (!sourcePath || pathParts.includes("..")) throw new Error("文件夹包含不安全路径");
    return {
      file,
      folderName: pathParts.length > 1 ? pathParts[0] : "所选文件夹",
      relativePath: pathParts.length > 1 ? pathParts.slice(1).join("/") : pathParts[0] || file.name
    };
  });
  const folderName = entries[0]?.folderName || "所选文件夹";
  const skillFiles = entries.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.relativePath));
  if (!skillFiles.length) return { valid: false, entries, folderName, error: `${folderName}：没有读取到 SKILL.md，请重新选择技能文件夹` };
  if (skillFiles.length !== 1) return { valid: false, entries, folderName, error: `${folderName}：读取到多个 SKILL.md，一个企业技能文件夹只能包含一个 SKILL.md` };
  const skillPathParts = skillFiles[0].relativePath.split("/");
  const skillRoot = skillPathParts.slice(0, -1).join("/");
  const packageEntries = entries.filter((entry) => !skillRoot || entry.relativePath.startsWith(`${skillRoot}/`)).map((entry) => ({
    ...entry,
    packagePath: skillRoot ? entry.relativePath.slice(skillRoot.length + 1) : entry.relativePath
  }));
  const packagePaths = new Set();
  for (const entry of packageEntries) {
    if (!entry.packagePath || entry.packagePath.split("/").includes("..")) throw new Error("文件夹包含不安全路径");
    const normalizedPath = entry.packagePath.toLocaleLowerCase("en-US");
    if (packagePaths.has(normalizedPath)) throw new Error(`技能文件路径重复：${entry.packagePath}`);
    packagePaths.add(normalizedPath);
  }
  return {
    valid: true,
    entries: packageEntries,
    folderName,
    skillRoot,
    skillFolderName: skillRoot.split("/").filter(Boolean).at(-1) || folderName,
    ignoredFileCount: entries.length - packageEntries.length
  };
}

function updateDirectFolderStatus(files) {
  if (!elements.directFolderStatus) return;
  let analysis;
  try { analysis = analyzeDirectFolder(files); } catch (error) { analysis = { valid: false, entries: [], folderName: "所选文件夹", error: error.message }; }
  if (analysis.empty) {
    elements.directFolderStatus.className = "file-selection-status";
    elements.directFolderStatus.textContent = "尚未选择文件夹";
    elements.directFolderPreview.hidden = true;
    elements.directFolderFileCount.textContent = "0 个";
    elements.directFolderFileList.innerHTML = "";
    return;
  }
  elements.directFolderStatus.className = `file-selection-status ${analysis.valid ? "valid" : "invalid"}`;
  if (analysis.valid) {
    const located = analysis.skillRoot ? `，已自动定位技能目录“${analysis.skillFolderName}”` : "";
    const ignored = analysis.ignoredFileCount ? `，已忽略目录外 ${analysis.ignoredFileCount} 个文件` : "";
    elements.directFolderStatus.textContent = `${analysis.folderName}：已读取 ${analysis.entries.length} 个技能文件${located}${ignored}；SKILL.md 校验通过，缺少 skill.json 时将自动补齐`;
  } else {
    elements.directFolderStatus.textContent = analysis.error;
  }
  const sorted = [...analysis.entries].sort((left, right) => {
    const leftPath = left.packagePath || left.relativePath;
    const rightPath = right.packagePath || right.relativePath;
    if (/^SKILL\.md$/i.test(leftPath)) return -1;
    if (/^SKILL\.md$/i.test(rightPath)) return 1;
    return leftPath.localeCompare(rightPath, "zh-CN");
  });
  const visibleEntries = sorted.slice(0, 60);
  elements.directFolderPreview.hidden = false;
  elements.directFolderFileCount.textContent = `${analysis.entries.length} 个`;
  elements.directFolderFileList.innerHTML = visibleEntries.map((entry) => { const displayPath = entry.packagePath || entry.relativePath; return `<li class="${/^SKILL\.md$/i.test(displayPath) ? "skill-entry" : ""}"><span>${escapeHtml(displayPath)}</span><small>${Math.max(0, Number(entry.file.size || 0)).toLocaleString("zh-CN")} B</small></li>`; }).join("")
    + (sorted.length > visibleEntries.length ? `<li class="file-overflow"><span>另有 ${sorted.length - visibleEntries.length} 个文件已读取</span></li>` : "");
}

async function packageFolder(files) {
  if (!window.JSZip) throw new Error("本地文件夹打包组件未加载，请刷新页面后重试");
  const analysis = analyzeDirectFolder(files);
  if (!analysis.valid) throw new Error(analysis.error || "请选择有效的技能文件夹");
  const zip = new window.JSZip();
  for (const entry of analysis.entries) zip.file(entry.packagePath, entry.file);
  return new File([await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } })], "local-skill-folder.zip", { type: "application/zip" });
}

async function submitDirectPublish() {
  const enterpriseDisplayName = String($("#directEnterpriseName")?.value || "").trim();
  const categoryId = elements.directCategory.value;
  const category = elements.directCategory.selectedOptions?.[0]?.textContent?.trim() || "";
  const tagIds = [...elements.directTagOptions.querySelectorAll("input:checked")].map((input) => input.value);
  const newTags = String($("#directNewTags")?.value || "").split(/[,，]/).map((value) => value.trim()).filter(Boolean);
  const riskAcknowledged = $("#directRiskAcknowledged")?.checked === true;
  if (!enterpriseDisplayName) throw new Error("请填写企业技能名称");
  if (!categoryId) throw new Error("请选择企业分类");
  if (!tagIds.length && !newTags.length) throw new Error("请至少选择或新增一个企业标签");
  const progress = elements.directPublishProgress;
  progress.hidden = false;
  progress.querySelector("progress").value = 15;
  progress.querySelector("small").textContent = state.directSource === "github" ? "正在读取公开 GitHub 技能" : "正在准备并上传技能包";
  let result;
  if (state.directSource === "github") {
    const url = String($("#directGithubUrl")?.value || "").trim();
    if (!url) throw new Error("请输入公开 GitHub 地址");
    result = await request("/api/admin/company-skills/direct-publish/github", { method: "POST", body: JSON.stringify({ url, enterpriseDisplayName, category, categoryId, tagIds, newTags, riskAcknowledged }) });
  } else {
    let file = $("#directZipFile")?.files?.[0];
    if (state.directSource === "folder") file = await packageFolder([...($("#directFolderFiles")?.files || [])]);
    if (!file) throw new Error("请选择技能 ZIP 包");
    if (!/\.zip$/i.test(file.name)) throw new Error("请选择 ZIP 技能包");
    const response = await fetch(apiUrl("/api/admin/company-skills/direct-publish"), {
      method: "POST",
      headers: {
        ...headers("/api/admin/company-skills/direct-publish"),
        "content-type": "application/zip",
        "x-file-name": encodeURIComponent(file.name),
        "x-enterprise-name": encodeURIComponent(enterpriseDisplayName),
        "x-category-name": encodeURIComponent(category),
        "x-category-id": encodeURIComponent(categoryId),
        "x-tag-ids": encodeURIComponent(JSON.stringify(tagIds)),
        "x-new-tags": encodeURIComponent(JSON.stringify(newTags)),
        "x-source-type": state.directSource,
        "x-risk-acknowledged": riskAcknowledged ? "1" : "0"
      },
      body: file
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "企业技能发布失败");
  }
  progress.querySelector("progress").value = 100;
  progress.querySelector("small").textContent = result.normalized ? "已自动补齐格式并完成发布" : "校验和发布完成";
  elements.directPublishDialog.close();
  toast(`企业技能“${result.skill?.displayName || enterpriseDisplayName}”已直接发布${result.normalized ? "，并自动补齐标准格式" : ""}`);
  await Promise.all([loadSkillsData(), loadTaxonomy()]);
}

let overviewAutoRefreshInFlight = false;
async function refreshOverviewAutomatically() {
  if (overviewAutoRefreshInFlight || document.hidden || state.view !== "overview" || !state.connected) return;
  if ([elements.editorDialog, elements.detailDialog, elements.userDialog, elements.directPublishDialog].some((dialog) => dialog?.open)) return;
  overviewAutoRefreshInFlight = true;
  try { await loadOverview(); } catch (error) { setStatus(error.message, true); } finally { overviewAutoRefreshInFlight = false; }
}
setInterval(refreshOverviewAutomatically, 30000);
async function refreshCurrentView() { if (!state.connected) return; setStatus("正在刷新数据..."); try { if (state.view === "requirements") await window.RequirementAdmin.mount(elements.content, request, () => state.view === "requirements"); if (state.view === "overview") await loadOverview(); if (state.view === "skills") await Promise.all([loadSkillsData(), loadTaxonomy()]); if (state.view === "users") await loadUsers(); if (state.view === "config") await Promise.all([loadTaxonomy(), loadSkillsData()]); if (state.view === "releases") { if (state.releaseAuthenticated || releaseToken()) await loadReleases(); else renderReleases(); } setStatus("数据已同步"); } catch (error) { setStatus(error.message, true); } }
function showView(view) { state.view = view; const [title, eyebrow] = viewMeta[view]; elements.pageTitle.textContent = title; elements.pageEyebrow.textContent = eyebrow; elements.navigation.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.view === view)); elements.content.innerHTML = empty("正在读取数据"); refreshCurrentView(); }

elements.navigation.addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) showView(button.dataset.view); });
request("/health").then(health => { const nav = document.getElementById("requirementAdminNav"); if (nav) nav.hidden = health.requirementIntake !== "enabled"; }).catch(() => {});
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !trustedAdminParentOrigins.has(event.origin)) return;
  if (event.data?.type === "XMAI_ADMIN_CONTEXT_CLEAR") { clearAdminContext(); return; }
  if (event.data?.type !== "XMAI_ADMIN_CONTEXT") return;
  applyAdminContext(event.data);
});
window.addEventListener("pageshow", requestAdminContext);
document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAdminContext(); });
setTimeout(requestAdminContext, 0);
elements.refreshButton.addEventListener("click", refreshCurrentView);
elements.editorForm.addEventListener("submit", async (event) => { event.preventDefault(); if (!elements.editorForm.reportValidity()) return; const values = Object.fromEntries(new FormData(elements.editorForm)); try { await state.editorAction?.(values); elements.editorDialog.close(); } catch (error) { toast(error.message); } });
elements.detailContent.addEventListener("input", (event) => { if (event.target.id !== "approvalTagSearch") return; const query = event.target.value.trim().toLocaleLowerCase("zh-CN"); elements.detailContent.querySelectorAll("[data-approval-tag-option]").forEach((option) => { option.hidden = Boolean(query && !option.textContent.toLocaleLowerCase("zh-CN").includes(query)); }); });
elements.directPublishDialog.addEventListener("click", (event) => { const button = event.target.closest("[data-direct-source]"); if (button) setDirectSource(button.dataset.directSource); });
$("#directFolderFiles").addEventListener("change", (event) => updateDirectFolderStatus(event.target.files));
$("#directTagSearch").addEventListener("input", (event) => { const query = event.target.value.trim().toLocaleLowerCase("zh-CN"); elements.directTagOptions.querySelectorAll("label").forEach((option) => { option.hidden = Boolean(query && !option.textContent.toLocaleLowerCase("zh-CN").includes(query)); }); });
elements.directPublishForm.addEventListener("submit", async (event) => { event.preventDefault(); if (!elements.directPublishForm.reportValidity()) return; const button = event.submitter || elements.directPublishForm.querySelector("button[type=submit]"); button.disabled = true; try { await submitDirectPublish(); } catch (error) { const progress = elements.directPublishProgress; progress.hidden = false; progress.querySelector("progress").value = 0; progress.querySelector("small").textContent = error.message; toast(error.message); } finally { button.disabled = false; } });

elements.content.addEventListener("input", (event) => {
  if (event.target.id === "skillSearch") filterSkillRows();
  if (event.target.id === "skillCategorySearch") { const query = event.target.value.trim().toLocaleLowerCase("zh-CN"); elements.content.querySelectorAll("[data-category-option]").forEach((option) => { option.hidden = Boolean(query && !option.textContent.toLocaleLowerCase("zh-CN").includes(query)); }); }
  if (event.target.matches("[data-taxonomy-search]")) filterTaxonomyRows();
});
elements.content.addEventListener("change", (event) => { if (event.target.matches("[data-skill-category]")) { state.skillFilters.page = 1; filterSkillRows(); } if (event.target.matches("[data-taxonomy-status]")) filterTaxonomyRows(); });
function filterSkillRows() {
  const query = String($("#skillSearch")?.value || state.skillFilters.query || "").toLocaleLowerCase("zh-CN");
  const categoryIds = [...elements.content.querySelectorAll("[data-skill-category]:checked")].map((input) => input.value);
  state.skillFilters.query = query; state.skillFilters.categoryIds = categoryIds;
  const matched = [...elements.content.querySelectorAll("[data-skill-row]")].filter((row) => (!query || row.dataset.searchValue.toLocaleLowerCase("zh-CN").includes(query)) && (!categoryIds.length || categoryIds.includes(row.dataset.categoryId)));
  const matchedSet = new Set(matched);
  const pages = Math.max(1, Math.ceil(matched.length / state.skillFilters.pageSize));
  state.skillFilters.page = Math.min(Math.max(1, state.skillFilters.page), pages);
  const start = (state.skillFilters.page - 1) * state.skillFilters.pageSize;
  elements.content.querySelectorAll("[data-skill-row]").forEach((row) => { const index = matched.indexOf(row); row.hidden = !matchedSet.has(row) || index < start || index >= start + state.skillFilters.pageSize; });
  const count = $("#skillResultCount"); if (count) count.textContent = `共 ${matched.length} 条记录`;
  const pagination = $("#skillPagination");
  if (pagination) pagination.innerHTML = matched.length > state.skillFilters.pageSize ? `<button class="secondary" data-skill-page="${state.skillFilters.page - 1}" ${state.skillFilters.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${state.skillFilters.page} / ${pages} 页</span><button class="secondary" data-skill-page="${state.skillFilters.page + 1}" ${state.skillFilters.page >= pages ? "disabled" : ""}>下一页</button>` : "";
}
function filterTaxonomyRows() { const query = String($("[data-taxonomy-search]")?.value || "").toLocaleLowerCase("zh-CN"); const status = $("[data-taxonomy-status]")?.value || ""; elements.content.querySelectorAll("tbody tr").forEach((row) => { const rowStatus = row.querySelector(".status")?.textContent || ""; row.hidden = Boolean(query && !row.textContent.toLocaleLowerCase("zh-CN").includes(query)) || Boolean(status && rowStatus !== statusLabel(status)); }); }

elements.content.addEventListener("click", async (event) => {
  const target = event.target.closest("button"); if (!target) return;
  try {
    if (target.dataset.overviewRange) { state.range = target.dataset.overviewRange; renderOverview(); if (state.range !== "custom") await loadOverview(); }
    if (target.hasAttribute("data-apply-range")) { const from = $("#customFrom")?.value || ""; const to = $("#customTo")?.value || ""; validateCustomRange(from, to); state.customFrom = from; state.customTo = to; await loadOverview(); }
    if (target.dataset.overviewSkillSection) { state.skillSection = target.dataset.overviewSkillSection; showView("skills"); }
    if (target.hasAttribute("data-refresh-overview")) await loadOverview();
    if (target.dataset.skillSection) { state.skillSection = target.dataset.skillSection; state.skillFilters.page = 1; renderSkills(); }
    if (target.dataset.configSection) { state.configSection = target.dataset.configSection; renderConfig(); }
    if (target.dataset.detailSubmission) await openSubmissionDetail(target.dataset.detailSubmission);
    if (target.dataset.downloadSubmission) await downloadSubmissionPackage(target.dataset.downloadSubmission);
    if (target.dataset.reviewSubmission) await openSubmissionDetail(target.dataset.reviewSubmission, "review");
    if (target.dataset.publishSubmission) publishSubmission(target.dataset.publishSubmission, Number(target.dataset.stateVersion));
    if (target.dataset.deleteSubmission) deleteSubmission(target.dataset.deleteSubmission);
    if (target.dataset.deleteCompanySkill) deleteCompanySkill(target.dataset.deleteCompanySkill);
    if (target.dataset.companyDetail) { const skill = state.companySkills.find((item) => item.skillId === target.dataset.companyDetail); if (skill) { const latest = skill.versions?.[0]; const usage = skillUsage(skill.skillId); const creator = dingtalkNickname(skill.creator); elements.detailTitle.textContent = skill.displayName; elements.detailContent.innerHTML = `<section class="detail-section"><h3>企业技能信息</h3><div class="detail-grid"><div class="detail-item"><small>企业名称</small><strong>${escapeHtml(skill.displayName)}</strong></div><div class="detail-item"><small>创建人</small><strong>${escapeHtml(creator)}</strong></div><div class="detail-item"><small>状态</small><strong>${statusLabel(skill.status)}</strong></div><div class="detail-item"><small>当前版本</small><strong>${escapeHtml(latest?.version || "-")}</strong></div><div class="detail-item"><small>分类</small><strong>${escapeHtml(skill.category || categoryName(skill.categoryId))}</strong></div><div class="detail-item"><small>标签</small><strong>${escapeHtml(tagNames(skill.tagIds, skill.tagNames).join("、") || "-")}</strong></div></div></section><section class="detail-section"><h3>匿名使用统计</h3><div class="detail-grid"><div class="detail-item"><small>累计调用</small><strong>${Number(usage.invoked || 0)}</strong></div><div class="detail-item"><small>成功</small><strong>${Number(usage.succeeded || 0)}</strong></div><div class="detail-item"><small>失败</small><strong>${Number(usage.failed || 0)}</strong></div><div class="detail-item"><small>取消</small><strong>${Number(usage.cancelled || 0)}</strong></div></div><small class="section-note">仅按技能和版本聚合，不保存使用人、提示词、附件或结果。</small></section><section class="detail-section"><h3>说明</h3><p>${escapeHtml(skill.description)}</p></section><section class="detail-section"><h3>处理记录</h3>${auditTimeline(skill.auditTrail)}</section>`; elements.detailActions.innerHTML = `<button class="secondary" value="cancel">关闭</button><button class="danger" type="button" data-delete-company-skill="${escapeHtml(skill.skillId)}">永久删除</button>`; elements.detailDialog.showModal(); } }
    if (target.dataset.downloadCompanySkill) { const skill = state.companySkills.find((item) => item.skillId === target.dataset.downloadCompanySkill); const version = target.dataset.version || skill?.versions?.[0]?.version || ""; if (!skill || !version) throw new Error("没有找到可下载的企业技能版本"); await downloadZip(`/api/admin/company-skills/${encodeURIComponent(skill.skillId)}/package?version=${encodeURIComponent(version)}`, `${skill.displayName || skill.name || "skill"}-${version}.zip`); toast("技能压缩包已开始下载"); }
    if (target.dataset.revokeSkill) { const skill = state.companySkills.find((item) => item.skillId === target.dataset.revokeSkill); openEditor(`下架“${skill?.displayName || "企业技能"}”`, "下架后员工无法继续安装，已安装副本将在同步时停用", [{ name: "reason", label: "下架原因", type: "textarea", value: "管理员下架" }, { name: "impact", label: "影响范围", value: "公司技能库立即隐藏；客户端同步后停用已安装副本。", readonly: true }], async (values) => { await request(`/api/admin/company-skills/${encodeURIComponent(target.dataset.revokeSkill)}/revoke`, { method: "POST", body: JSON.stringify({ reason: values.reason }) }); toast("技能已下架"); await loadSkillsData(); }); }
    if (target.dataset.republishSkill) { const skill = state.companySkills.find((item) => item.skillId === target.dataset.republishSkill); openEditor(`重新发布“${skill?.displayName || "企业技能"}”`, "重新发布后员工可以安装，已安装客户端将在同步时恢复", [{ name: "reason", label: "重新发布说明", value: "管理员重新发布" }, { name: "impact", label: "影响范围", value: "恢复公司技能库展示，并允许客户端继续安装和更新。", readonly: true }], async (values) => { await request(`/api/admin/company-skills/${encodeURIComponent(target.dataset.republishSkill)}/republish`, { method: "POST", body: JSON.stringify({ version: target.dataset.version, reason: values.reason }) }); toast("技能已重新发布"); await loadSkillsData(); }); }
    if (target.hasAttribute("data-direct-publish")) openDirectPublish();
    if (target.hasAttribute("data-reset-skill-filter")) { state.skillFilters = { ...state.skillFilters, query: "", categoryIds: [], page: 1 }; renderSkills(); }
    if (target.dataset.skillPage) { state.skillFilters.page = Number(target.dataset.skillPage); filterSkillRows(); }
    if (target.hasAttribute("data-refresh-users")) await loadUsers();
    if (target.hasAttribute("data-apply-user-filter")) await loadUsers({ query: $("#userSearch")?.value || "", accountStatus: $("#accountFilter")?.value || "", onlineStatus: $("#onlineFilter")?.value || "" });
    if (target.hasAttribute("data-reset-user-filter")) await loadUsers({ query: "", accountStatus: "", onlineStatus: "" });
    if (target.dataset.userDetail) openUserDetail(target.dataset.userDetail);
    if (target.hasAttribute("data-create-category")) taxonomyEditor("category");
    if (target.hasAttribute("data-create-tag")) taxonomyEditor("tag");
    if (target.dataset.editCategory) taxonomyEditor("category", state.categories.find((item) => item.categoryId === target.dataset.editCategory));
    if (target.dataset.editTag) taxonomyEditor("tag", state.tags.find((item) => item.tagId === target.dataset.editTag));
    if (target.dataset.toggleCategory) await toggleTaxonomy("category", target.dataset.toggleCategory, target.dataset.nextStatus);
    if (target.dataset.toggleTag) await toggleTaxonomy("tag", target.dataset.toggleTag, target.dataset.nextStatus);
    if (target.dataset.deleteCategory && confirm("确认删除这个分类吗？")) { await request(`/api/admin/v11/categories/${encodeURIComponent(target.dataset.deleteCategory)}`, { method: "DELETE" }); await loadTaxonomy(); }
    if (target.dataset.deleteTag && confirm("确认删除这个标签吗？")) { await request(`/api/admin/v11/tags/${encodeURIComponent(target.dataset.deleteTag)}`, { method: "DELETE" }); await loadTaxonomy(); }
    if (target.dataset.mergeTag) { const sourceTag = state.tags.find((item) => item.tagId === target.dataset.mergeTag); const affected = taxonomyReferenceCount("tag", target.dataset.mergeTag); const options = state.tags.filter((item) => item.tagId !== target.dataset.mergeTag && item.status === "ENABLED").map((item) => ({ value: item.tagId, label: item.name })); openEditor("合并标签", `标签“${sourceTag?.name || target.dataset.mergeTag}”当前影响 ${affected} 个技能；合并后这些技能会改用目标标签，来源标签将停用。`, [{ name: "targetTagId", label: "目标标签", type: "select", options }, { name: "impact", label: "受影响技能数", value: `${affected} 个`, readonly: true }], async (values) => { await request(`/api/admin/v11/tags/${encodeURIComponent(target.dataset.mergeTag)}/merge`, { method: "POST", body: JSON.stringify(values) }); toast("标签已合并"); await Promise.all([loadTaxonomy(), loadSkillsData()]); }); }
    if (target.hasAttribute("data-reset-taxonomy")) { $("[data-taxonomy-search]").value = ""; $("[data-taxonomy-status]").value = ""; filterTaxonomyRows(); }
    if (target.dataset.revokeRelease && confirm("确认撤回这个客户端版本吗？")) { await request(`/api/admin/releases/${encodeURIComponent(target.dataset.revokeRelease)}/revoke`, { method: "POST" }); await loadReleases(); }
    if (target.dataset.deleteRelease && confirm("确认永久删除服务器安装包吗？此操作无法恢复。")) { await request(`/api/admin/releases/${encodeURIComponent(target.dataset.deleteRelease)}/delete`, { method: "POST" }); await loadReleases(); }
    if (target.hasAttribute("data-lock-releases")) { state.releaseAuthenticated = false; state.releaseAdminToken = ""; sessionStorage.removeItem("xianma.v11.releaseAdminToken"); renderReleases(); }
  } catch (error) { toast(error.message); }
});

elements.detailActions.addEventListener("click", async (event) => { const target = event.target.closest("button"); if (!target) return; try { if (target.dataset.approveSubmission) await approveSubmission(target.dataset.approveSubmission, Number(target.dataset.stateVersion)); if (target.dataset.rejectSubmission) rejectSubmission(target.dataset.rejectSubmission); if (target.dataset.publishSubmission) publishSubmission(target.dataset.publishSubmission, Number(target.dataset.stateVersion)); if (target.dataset.deleteSubmission) deleteSubmission(target.dataset.deleteSubmission); if (target.dataset.deleteCompanySkill) deleteCompanySkill(target.dataset.deleteCompanySkill); if (target.dataset.downloadSubmission) await downloadSubmissionPackage(target.dataset.downloadSubmission, state.selectedSubmission || {}); } catch (error) { toast(error.message); } });
elements.content.addEventListener("submit", async (event) => {
  if (event.target.id === "releaseAuthForm") {
    event.preventDefault();
    state.releaseAdminToken = $("#releaseAdminToken")?.value.trim() || "";
    if (!state.releaseAdminToken) return;
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    try { await loadReleases(); } catch {} finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (event.target.id !== "releaseForm") return;
  event.preventDefault();
  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  try { await uploadRelease(event.target); } catch (error) { toast(error.message); } finally { button.disabled = false; }
});

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-dialog]");
  if (!closeButton) return;
  event.preventDefault();
  closeButton.closest("dialog")?.close();
});

setConnected(true);
showView("overview");
