"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow } = require("electron");

const adminUiSource = fs.readFileSync(path.join(__dirname, "update-service", "public", "admin-v11.js"), "utf8");
const mapmsBridgeSource = fs.readFileSync(path.join(__dirname, "integrations", "mapms", "XianmaAiStudioView-it03T58n.js"), "utf8");
if (!adminUiSource.includes("XMAI_ADMIN_CONTEXT_REQUEST") || !adminUiSource.includes('"x-admin-id"') || !adminUiSource.includes('"x-admin-username"')) {
  throw new Error("XMAI 管理页缺少 MAPMS 前端管理员身份同步能力");
}
if (!adminUiSource.includes("context.username || context.displayName")) {
  throw new Error("XMAI 管理页没有优先同步 MAPMS 登录用户名");
}
if (!mapmsBridgeSource.includes("mapms-admin-auth") || !mapmsBridgeSource.includes("XMAI_ADMIN_CONTEXT")) {
  throw new Error("MAPMS iframe 桥接文件缺少管理员身份发送能力");
}

app.disableHardwareAcceleration();

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-admin-v11-"));
const privateKeyPath = path.join(temporaryRoot, "private.pem");
const dataRoot = path.join(temporaryRoot, "data");
const token = crypto.randomBytes(24).toString("hex");
const desktopToken = crypto.randomBytes(32).toString("base64url");
const desktopUserId = "smoke-user";
const desktopCorpId = "smoke-corp";
const desktopUserKey = crypto.createHash("sha256").update(`${desktopCorpId}\0${desktopUserId}`, "utf8").digest("hex");
const privateDeveloperUserId = "private-developer";
const privateDeveloperUserKey = crypto.createHash("sha256").update(`${desktopCorpId}\0${privateDeveloperUserId}`, "utf8").digest("hex");
const port = 29900 + crypto.randomInt(0, 300);
const baseUrl = `http://127.0.0.1:${port}`;
const { privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
fs.mkdirSync(dataRoot, { recursive: true });
const seededAt = new Date().toISOString();
fs.writeFileSync(path.join(dataRoot, "telemetry.json"), JSON.stringify({
  schemaVersion: 1,
  users: {
    [desktopUserKey]: {
      userId: desktopUserId,
      dingtalkUserId: "ding-smoke-user",
      dingtalkRealName: "测试真实姓名",
      name: "测试昵称",
      corpId: desktopCorpId,
      department: "测试部门",
      firstSeenAt: seededAt,
      lastSeenAt: seededAt,
      usage: {},
      mapms: { authorizationStatus: "allowed", authorizationCheckedAt: seededAt },
      devices: {
        "smoke-device": {
          deviceId: "smoke-device",
          firstSeenAt: seededAt,
          lastSeenAt: seededAt,
          sessionIssuedAt: seededAt,
          disconnectedAt: "",
          appVersion: "1.4.0",
          internalVersion: "1.4.0",
          sessionTokenHash: crypto.createHash("sha256").update(desktopToken, "utf8").digest("hex"),
          usage: {}
        }
      }
    },
    [privateDeveloperUserKey]: {
      userId: privateDeveloperUserId,
      dingtalkUserId: "ding-private-developer",
      dingtalkRealName: "开发者真实姓名",
      name: "林动",
      corpId: desktopCorpId,
      department: "开发部门",
      firstSeenAt: seededAt,
      lastSeenAt: seededAt,
      usage: {},
      mapms: { authorizationStatus: "allowed", authorizationCheckedAt: seededAt },
      devices: {
        "private-device": {
          deviceId: "private-device",
          firstSeenAt: seededAt,
          lastSeenAt: seededAt,
          sessionIssuedAt: seededAt,
          disconnectedAt: "",
          appVersion: "2.0.0",
          internalVersion: "2.0.0",
          sessionTokenHash: crypto.createHash("sha256").update("private-test-token", "utf8").digest("hex"),
          usage: {}
        }
      }
    }
  }
}, null, 2));
const smokeSubmissionId = "submission-smoke-review";
const smokeSubmissionDirectory = path.join(dataRoot, "skills", "submissions", smokeSubmissionId);
fs.mkdirSync(smokeSubmissionDirectory, { recursive: true });
const smokePackagePath = path.join(smokeSubmissionDirectory, "package.zip");
fs.writeFileSync(smokePackagePath, Buffer.from("smoke-skill-package"));
fs.writeFileSync(path.join(dataRoot, "skill-submissions.json"), JSON.stringify({
  schemaVersion: 1,
  submissions: [{
    submissionId: smokeSubmissionId,
    skillId: "sk-smoke-review",
    ownerUserKey: desktopUserKey,
    submitter: { name: "测试昵称", realName: "测试真实姓名", department: "测试部门" },
    name: "smoke-review-skill",
    displayName: "待审核测试技能",
    description: "用于验证管理端审批、发布、下架和重新发布的完整交互。",
    category: "效率工具",
    categoryId: "efficiency-tools",
    tagIds: ["automation"],
    starter: "请验证技能审批流程。",
    icon: "sparkles",
    fields: [],
    supportedInputs: ["text"],
    outputs: ["markdown"],
    permissions: [],
    dependencies: [],
    version: "1.0.0",
    status: "pending",
    stateVersion: 1,
    riskLevel: "standard",
    riskItems: [],
    fileTree: [{ path: "SKILL.md", size: 120 }, { path: "skill.json", size: 240 }],
    previews: [{ path: "SKILL.md", content: "# 适用场景\n验证审批流程" }],
    fileCount: 2,
    totalBytes: 360,
    packagePath: smokePackagePath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(smokePackagePath)).digest("hex"),
    size: fs.statSync(smokePackagePath).size,
    submittedAt: seededAt,
    reviewedAt: "",
    rejectionReason: "",
    auditTrail: [{ eventId: "audit-smoke-submitted", action: "submitted", actor: "测试昵称", reason: "", occurredAt: seededAt }]
  }, {
    submissionId: "submission-private-developer",
    skillId: "sk-private-developer",
    ownerUserKey: privateDeveloperUserKey,
    submitter: { name: "林动", realName: "开发者真实姓名", department: "开发部门" },
    name: "private-developer-skill",
    displayName: "开发者内部技能",
    description: "仅用于验证管理后台隐私过滤。",
    category: "效率工具",
    categoryId: "efficiency-tools",
    tagIds: ["automation"],
    starter: "验证隐私过滤。",
    icon: "sparkles",
    fields: [],
    supportedInputs: ["text"],
    outputs: ["markdown"],
    permissions: [],
    dependencies: [],
    version: "1.0.0",
    status: "pending",
    stateVersion: 1,
    riskLevel: "standard",
    riskItems: [],
    fileTree: [{ path: "SKILL.md", size: 120 }],
    previews: [{ path: "SKILL.md", content: "隐私过滤测试" }],
    fileCount: 1,
    totalBytes: 120,
    packagePath: smokePackagePath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(smokePackagePath)).digest("hex"),
    size: fs.statSync(smokePackagePath).size,
    submittedAt: seededAt,
    reviewedAt: "",
    rejectionReason: "",
    auditTrail: [{ eventId: "audit-private-submitted", action: "submitted", actor: "林动", reason: "", occurredAt: seededAt }]
  }]
}, null, 2));

const service = spawn("node", [path.join(__dirname, "update-service", "server.js")], {
  cwd: __dirname,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    UPDATE_DATA_ROOT: dataRoot,
    UPDATE_ADMIN_TOKEN: token,
    UPDATE_SIGNING_PRIVATE_KEY_PATH: privateKeyPath,
    UPDATE_PUBLIC_BASE_URL: baseUrl,
    ENABLE_COMPANY_SKILL_PLATFORM: "1",
    ENABLE_V11_ADMIN_UI: "1",
    COMPANY_SKILL_ADMIN_PUBLIC: "1",
    V11_MANAGEMENT_PUBLIC: "1",
    TELEMETRY_EXCLUDED_IDENTIFIERS: `${privateDeveloperUserKey},${privateDeveloperUserId},ding-private-developer`,
    TELEMETRY_EXCLUDED_NAMES: "林动"
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let serviceErrors = "";
service.stderr.on("data", (chunk) => { serviceErrors += chunk.toString(); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`V1.1 管理服务未启动：${serviceErrors}`);
}

async function cleanup(code) {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  service.kill();
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  app.exit(code);
}

app.whenReady().then(async () => {
  await waitForHealth();
  const factsResponse = await fetch(`${baseUrl}/api/desktop/v11/facts`, {
    method: "POST",
    headers: { authorization: `Bearer ${desktopToken}`, "content-type": "application/json" },
    body: JSON.stringify({ facts: [
      { kind: "task", eventKey: "task-1-running", taskId: "task-1", taskType: "chat", state: "RUNNING", firstExecutedAt: seededAt, occurredAt: seededAt },
      { kind: "task", eventKey: "task-1-success", taskId: "task-1", taskType: "chat", state: "SUCCEEDED", firstExecutedAt: seededAt, occurredAt: seededAt },
      { kind: "module", eventKey: "module-chat-visit", moduleCode: "AI_CHAT", action: "visit", keyOperation: false, occurredAt: seededAt },
      { kind: "module", eventKey: "module-chat-send", moduleCode: "AI_CHAT", action: "send_message", keyOperation: true, occurredAt: seededAt },
      { kind: "module", eventKey: "module-skill-run", moduleCode: "SKILL_LIBRARY", action: "execute_skill", keyOperation: true, occurredAt: seededAt }
    ] })
  });
  if (!factsResponse.ok) throw new Error(`测试统计数据写入失败：${factsResponse.status}`);
  const privateFactsResponse = await fetch(`${baseUrl}/api/desktop/v11/facts`, {
    method: "POST",
    headers: { authorization: "Bearer private-test-token", "content-type": "application/json" },
    body: JSON.stringify({ facts: [
      { kind: "task", eventKey: "private-task-success", taskId: "private-task", taskType: "chat", state: "SUCCEEDED", firstExecutedAt: seededAt, occurredAt: seededAt },
      { kind: "module", eventKey: "private-module-chat", moduleCode: "AI_CHAT", action: "send_message", keyOperation: true, occurredAt: seededAt }
    ] })
  });
  const privateFactsPayload = await privateFactsResponse.json();
  if (privateFactsResponse.status !== 202 || privateFactsPayload.accepted !== 0 || privateFactsPayload.excludedFromStatistics !== true) {
    throw new Error(`开发者统计事件未排除：${JSON.stringify(privateFactsPayload)}`);
  }
  const window = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL(`${baseUrl}/admin`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (check, label) => { for (let i = 0; i < 80; i += 1) { if (check()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('等待超时：' + label); };
    await waitFor(() => /数据已同步/.test(document.querySelector('#statusBar').textContent), '自动读取后台');
    const views = [];
    for (const view of ['overview','skills','users','config','releases']) {
      document.querySelector('[data-view="' + view + '"]').click();
      await new Promise(r => setTimeout(r, 120));
      await waitFor(() => document.querySelector('[data-view="' + view + '"]').classList.contains('active'), view);
      views.push(document.querySelector('#pageTitle').textContent.trim());
    }
    document.querySelector('[data-view="skills"]').click();
    await waitFor(() => document.querySelector('[data-skill-section="reviews"]'), '技能管理');
    const skillSections = [];
    for (const section of ['reviews','publishing','enterprise']) {
      document.querySelector('[data-skill-section="' + section + '"]').click();
      await new Promise(r => setTimeout(r, 80));
      skillSections.push(document.querySelector('[data-skill-section="' + section + '"]').classList.contains('active'));
    }
    document.querySelector('[data-skill-section="reviews"]').click();
    await waitFor(() => document.querySelector('[data-review-submission]'), '待审核技能');
    const reviewDeleteAvailable = Boolean(document.querySelector('[data-delete-submission]'));
    const reviewDownloadAvailable = Boolean(document.querySelector('[data-download-submission]'));
    const reviewRowText = document.querySelector('[data-skill-row]').textContent;
    const reviewUsesNickname = reviewRowText.includes('测试昵称') && !reviewRowText.includes('测试真实姓名');
    const privateDeveloperSubmissionAnonymized = document.querySelector('#content').textContent.includes('开发者内部技能')
      && document.querySelector('#content').textContent.includes('内部提交')
      && !document.querySelector('#content').textContent.includes('林动');
    const multiCategoryFilter = Boolean(document.querySelector('.multi-filter [data-skill-category]'));
    document.querySelector('[data-review-submission]').click();
    await waitFor(() => document.querySelector('#detailDialog').open && document.querySelector('#approvalCategory'), '审批抽屉');
    const reviewDetailUsesNickname = document.querySelector('#detailContent').textContent.includes('测试昵称') && !document.querySelector('#detailContent').textContent.includes('测试真实姓名');
    document.querySelector('#approvalCategory').value = 'office-collaboration';
    const summaryTag = document.querySelector('[data-approval-tag][value="summary"]');
    const summaryTagLabel = summaryTag.closest('label');
    const summaryTagText = summaryTagLabel.querySelector('span');
    const approvalTagLayout = Math.round(summaryTag.getBoundingClientRect().width) === 15
      && getComputedStyle(summaryTagText).whiteSpace === 'nowrap'
      && summaryTagText.getBoundingClientRect().width >= 16
      && summaryTagText.getBoundingClientRect().height <= 20;
    summaryTag.checked = true;
    document.querySelector('[data-approve-submission]').click();
    await waitFor(() => !document.querySelector('#detailDialog').open, '审批完成');
    document.querySelector('[data-skill-section="publishing"]').click();
    await waitFor(() => document.querySelector('[data-publish-submission]'), '待发布技能');
    const publishingDeleteAvailable = Boolean(document.querySelector('[data-delete-submission]'));
    const publishingDownloadAvailable = Boolean(document.querySelector('[data-download-submission]'));
    const approvedUsesEnterpriseTaxonomy = document.querySelector('[data-skill-row]').dataset.categoryId === 'office-collaboration' && document.querySelector('[data-skill-row]').textContent.includes('总结');
    document.querySelector('[data-publish-submission]').click();
    await waitFor(() => document.querySelector('#editorDialog').open && document.querySelector('#editorForm').elements.enterpriseDisplayName, '发布名称弹窗');
    document.querySelector('#editorForm').elements.enterpriseDisplayName.value = '企业审批测试技能';
    document.querySelector('#editorForm').requestSubmit();
    await waitFor(() => !document.querySelector('#editorDialog').open, '发布完成');
    document.querySelector('[data-skill-section="enterprise"]').click();
    await waitFor(() => document.querySelector('[data-company-detail]') && document.querySelector('#content').textContent.includes('企业审批测试技能'), '企业技能列表');
    const enterpriseDeleteAvailable = Boolean(document.querySelector('[data-delete-company-skill]'));
    const enterpriseNameSeparated = document.querySelector('[data-skill-row]').textContent.includes('企业审批测试技能');
    const enterpriseCreatorUsesNickname = document.querySelector('[data-skill-row]').textContent.includes('测试昵称') && !document.querySelector('[data-skill-row]').textContent.includes('测试真实姓名');
    document.querySelector('[data-company-detail]').click();
    await waitFor(() => document.querySelector('#detailDialog').open, '企业技能详情');
    const auditTimelineWorks = document.querySelector('#detailContent').textContent.includes('发布企业技能') && document.querySelector('#detailContent').textContent.includes('提交审核');
    const enterpriseDetailUsesNickname = document.querySelector('#detailContent').textContent.includes('测试昵称') && !document.querySelector('#detailContent').textContent.includes('测试真实姓名');
    document.querySelector('#detailDialog [value="cancel"]').click();
    document.querySelector('[data-revoke-skill]').click();
    await waitFor(() => document.querySelector('#editorDialog').open && document.querySelector('#editorForm').elements.reason, '下架影响确认');
    const revokeImpactExplained = document.querySelector('#editorForm').textContent.includes('影响范围');
    document.querySelector('#editorForm').requestSubmit();
    await waitFor(() => !document.querySelector('#editorDialog').open && document.querySelector('[data-republish-skill]'), '技能下架');
    document.querySelector('[data-republish-skill]').click();
    await waitFor(() => document.querySelector('#editorDialog').open, '重新发布确认');
    document.querySelector('#editorForm').requestSubmit();
    await waitFor(() => !document.querySelector('#editorDialog').open && document.querySelector('[data-revoke-skill]'), '技能重新发布');
    document.querySelector('[data-direct-publish]').click();
    await waitFor(() => document.querySelector('#directPublishDialog').open, '直接发布弹窗');
    const directSources = [];
    for (const source of ['zip','folder','github']) {
      document.querySelector('[data-direct-source="' + source + '"]').click();
      directSources.push(!document.querySelector('[data-source-panel="' + source + '"]').hidden);
    }
    document.querySelector('[data-direct-source="folder"]').click();
    const directFolderInput = document.querySelector('#directFolderFiles');
    const directFolderTransfer = new DataTransfer();
    for (const [name, relativePath, content] of [
      ['SKILL.md', 'selected-folder/sample-skill/SKILL.md', '# 示例技能'],
      ['meta.json', 'selected-folder/sample-skill/.skillhub/meta.json', '{}'],
      ['openai.yaml', 'selected-folder/sample-skill/agents/openai.yaml', 'name: sample'],
      ['workflow.md', 'selected-folder/sample-skill/references/workflow.md', '# 流程'],
      ['outside.txt', 'selected-folder/outside.txt', '不属于技能目录']
    ]) {
      const file = new File([content], name, { type: 'text/plain' });
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
      directFolderTransfer.items.add(file);
    }
    directFolderInput.files = directFolderTransfer.files;
    directFolderInput.dispatchEvent(new Event('change', { bubbles: true }));
    const directFolderPackage = await packageFolder([...directFolderInput.files]);
    const directFolderZip = await JSZip.loadAsync(directFolderPackage);
    const lowercaseSkillFile = new File(['# 小写技能入口'], 'skill.md', { type: 'text/markdown' });
    Object.defineProperty(lowercaseSkillFile, 'webkitRelativePath', { value: 'lowercase-skill/skill.md' });
    const lowercaseSkillAnalysis = analyzeDirectFolder([lowercaseSkillFile]);
    const directFolderAcceptsSkillOnly = document.querySelector('[data-source-panel="folder"]').textContent.includes('Windows 选择窗口只显示文件夹')
      && !document.querySelector('[data-source-panel="folder"]').textContent.includes('SKILL.md 和 skill.json')
      && Boolean(document.querySelector('#directFolderStatus'));
    const directFolderFilePreviewWorks = document.querySelector('#directFolderStatus').textContent.includes('根目录 SKILL.md 校验通过')
      || document.querySelector('#directFolderStatus').textContent.includes('SKILL.md 校验通过');
    const directNestedFolderNormalized = document.querySelector('#directFolderStatus').textContent.includes('已自动定位技能目录“sample-skill”')
      && document.querySelector('#directFolderStatus').textContent.includes('已忽略目录外 1 个文件')
      && !document.querySelector('#directFolderPreview').hidden
      && document.querySelectorAll('#directFolderFileList li').length === 4
      && document.querySelector('#directFolderFileList').textContent.includes('.skillhub/meta.json')
      && document.querySelector('#directFolderFileList').textContent.includes('references/workflow.md')
      && Boolean(directFolderZip.file('SKILL.md'))
      && Boolean(directFolderZip.file('.skillhub/meta.json'))
      && !directFolderZip.file('sample-skill/SKILL.md')
      && !directFolderZip.file('outside.txt');
    const directLowercaseSkillRecognized = lowercaseSkillAnalysis.valid
      && lowercaseSkillAnalysis.entries[0]?.packagePath === 'skill.md';
    const neutralAdminSurface = getComputedStyle(document.body).backgroundColor === 'rgb(245, 246, 248)'
      && getComputedStyle(document.querySelector('#content')).backgroundColor === 'rgb(255, 255, 255)';
    document.querySelector('#directPublishDialog [data-close-dialog]').click();
    document.querySelector('[data-view="config"]').click();
    await waitFor(() => document.querySelector('[data-create-category]'), '分类页面');
    document.querySelector('[data-config-section="tags"]').click();
    await waitFor(() => document.querySelector('[data-create-tag]'), '标签页面');
    document.querySelector('[data-config-section="categories"]').click();
    document.querySelector('[data-create-category]').click();
    document.querySelector('#editorDialog [data-close-dialog]').click();
    const editorClosedWithoutValidation = !document.querySelector('#editorDialog').open;
    document.querySelector('[data-create-category]').click();
    const form = document.querySelector('#editorForm');
    form.elements.name.value = '测试分类';
    form.elements.id.value = 'smoke-category';
    form.elements.sortOrder.value = '999';
    form.requestSubmit();
    await waitFor(() => document.querySelector('#content').textContent.includes('测试分类'), '新增分类');
    const categoryCreated = document.querySelector('#content').textContent.includes('测试分类');
    document.querySelector('[data-toggle-category="smoke-category"]').click();
    await waitFor(() => document.querySelector('[data-toggle-category="smoke-category"]')?.textContent.includes('启用'), '停用分类');
    const taxonomyToggleWorks = document.querySelector('[data-toggle-category="smoke-category"]').textContent.includes('启用');
    document.querySelector('[data-view="overview"]').click();
    await waitFor(() => document.querySelector('[data-overview-range="7d"]'), '首页周期');
    document.querySelector('[data-overview-range="7d"]').click();
    await waitFor(() => document.querySelector('[data-overview-range="7d"]').classList.contains('active'), '近7天周期');
    const lineChartRendered = Boolean(document.querySelector('.trend-chart svg .trend-series polyline')) && !document.querySelector('.trend-bars');
    const zeroTrendUsesEmptyState = renderTrendChart([{ label: '09-01', tasks: 0, succeeded: 0, failed: 0 }]).includes('当前周期暂无任务数据');
    const emptySuccessRateUsesEmDash = formatRate(null) === '—' && formatRate(50) === '50%';
    const versionDistributionRemoved = !document.querySelector('#content').textContent.includes('客户端版本分布');
    const overviewHides404Wording = !document.querySelector('#content').textContent.includes('404');
    const moduleRankingUsesVisits = !document.querySelector('.module-ranking-panel .panel-head small')
      && [...document.querySelectorAll('.module-ranking-panel .module-row')].every((row) => /^使用 [0-9]+ 次$/.test(row.querySelector('small')?.textContent.trim() || ''))
      && !document.querySelector('.module-ranking-panel')?.textContent.includes('任务结果')
      && !document.querySelector('.module-ranking-panel')?.textContent.includes('人 /');
    document.querySelector('[data-view="users"]').click();
    await waitFor(() => document.querySelector('[data-user-detail]'), '用户页面');
    const nicknamePreferred = document.querySelector('[data-user-row] .cell-main strong')?.textContent.trim() === '测试昵称';
    const userListHidesRealName = !document.querySelector('[data-user-row]').textContent.includes('测试真实姓名');
    const privateDeveloperUserHidden = !document.querySelector('#content').textContent.includes('林动') && !document.querySelector('#content').textContent.includes('ding-private-developer');
    document.querySelector('#userSearch').value = '测试昵称';
    document.querySelector('#accountFilter').value = 'active';
    document.querySelector('#onlineFilter').value = 'true';
    document.querySelector('[data-apply-user-filter]').click();
    await waitFor(() => document.querySelector('#userSearch')?.value === '测试昵称'
      && document.querySelector('#accountFilter')?.value === 'active'
      && document.querySelector('#onlineFilter')?.value === 'true'
      && document.querySelectorAll('[data-user-row]').length === 1, '用户组合筛选');
    const userCombinedFilterWorks = document.querySelector('[data-user-row] .cell-main strong')?.textContent.trim() === '测试昵称';
    document.querySelector('#onlineFilter').value = 'false';
    document.querySelector('[data-apply-user-filter]').click();
    await waitFor(() => document.querySelector('#onlineFilter')?.value === 'false' && !document.querySelector('[data-user-row]'), '用户空结果筛选');
    const userEmptyFilterWorks = document.querySelector('#content').textContent.includes('共 0 位用户');
    document.querySelector('[data-reset-user-filter]').click();
    await waitFor(() => document.querySelector('#userSearch')?.value === ''
      && document.querySelector('#accountFilter')?.value === ''
      && document.querySelector('#onlineFilter')?.value === ''
      && document.querySelectorAll('[data-user-row]').length === 1, '重置用户筛选');
    const userFilterResetWorks = document.querySelector('[data-user-row] .cell-main strong')?.textContent.trim() === '测试昵称';
    document.querySelector('[data-user-detail]').click();
    const userDrawerWorks = document.querySelector('#userDialog').open && document.querySelector('#userDialog').classList.contains('user-dialog') && document.querySelector('#userDetailContent').textContent.includes('成功率');
    const userDrawerHides404Wording = !document.querySelector('#userDetailContent').textContent.includes('404');
    const userDrawerHidesRealName = !document.querySelector('#userDialog').textContent.includes('测试真实姓名');
    document.querySelector('#userDialog [data-close-dialog]').click();
    const [usersPayload, filteredUsersPayload, filteredOutUsersPayload, submissionsPayload, skillsPayload, overviewPayload, privateSubmissionPayload, privatePackage] = await Promise.all([
      fetch('/api/admin/v11/users').then((response) => response.json()),
      fetch('/api/admin/v11/users?search=' + encodeURIComponent('测试昵称') + '&accountStatus=active&online=true').then((response) => response.json()),
      fetch('/api/admin/v11/users?accountStatus=disabled&online=false').then((response) => response.json()),
      fetch('/api/admin/skill-submissions').then((response) => response.json()),
      fetch('/api/admin/company-skills').then((response) => response.json()),
      fetch('/api/admin/v11/overview').then((response) => response.json()),
      fetch('/api/admin/skill-submissions/submission-private-developer').then((response) => response.json()),
      fetch('/api/admin/skill-submissions/submission-private-developer/package').then(async (response) => ({ ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }))
    ]);
    const adminApisHideRealName = !JSON.stringify([usersPayload, submissionsPayload, skillsPayload, privateSubmissionPayload]).includes('realName')
      && !JSON.stringify([usersPayload, submissionsPayload, skillsPayload, privateSubmissionPayload]).includes('测试真实姓名');
    const serverExcludesPrivateDeveloperStats = usersPayload.users.length === 1
      && !JSON.stringify(usersPayload).includes('林动')
      && !JSON.stringify(usersPayload).includes('ding-private-developer')
      && overviewPayload.realtime.cumulativeUsers === 1
      && overviewPayload.realtime.currentUsers === 1;
    const privateSubmission = submissionsPayload.submissions.find((item) => item.submissionId === 'submission-private-developer');
    const serverAnonymizesPrivateDeveloperSubmission = submissionsPayload.submissions.length === 2
      && privateSubmission?.submitter?.name === '内部提交'
      && privateSubmission?.submitter?.department === ''
      && privateSubmissionPayload.submission?.submitter?.name === '内部提交'
      && !JSON.stringify([submissionsPayload, privateSubmissionPayload]).includes('林动')
      && privatePackage.ok
      && privatePackage.bytes > 0
      && overviewPayload.realtime.pendingReview === 1;
    const userFilterApiWorks = filteredUsersPayload.users.length === 1 && filteredOutUsersPayload.users.length === 0;
    document.querySelector('[data-view="releases"]').click();
    await waitFor(() => document.querySelector('#releaseAdminToken'), '版本发布密码');
    const passwordOnlyOnReleases = document.querySelectorAll('input[type="password"]').length === 1 && !document.querySelector('#connectionForm');
    const headerBrandUpdated = document.querySelector('.app-identity strong')?.textContent.trim() === 'XMAI Studio'
      && document.title === 'XMAI Studio 管理后台';
    const dataTimestampRemoved = !document.querySelector('#appUpdatedAt') && !document.body.textContent.includes('数据更新时间');
    const headerIcon = document.querySelector('.app-brand-icon');
    const headerIconLoaded = Boolean(headerIcon?.complete && headerIcon.naturalWidth > 0 && headerIcon.naturalHeight > 0);
    return {
      views,
      skillSections,
      multiCategoryFilter,
      approvalTagLayout,
      reviewUsesNickname,
      reviewDeleteAvailable,
      reviewDownloadAvailable,
      publishingDeleteAvailable,
      publishingDownloadAvailable,
      enterpriseDeleteAvailable,
      privateDeveloperSubmissionAnonymized,
      reviewDetailUsesNickname,
      approvedUsesEnterpriseTaxonomy,
      enterpriseNameSeparated,
      enterpriseCreatorUsesNickname,
      enterpriseDetailUsesNickname,
      auditTimelineWorks,
      revokeImpactExplained,
      directSources,
      directFolderAcceptsSkillOnly,
      directFolderFilePreviewWorks,
      directNestedFolderNormalized,
      directLowercaseSkillRecognized,
      neutralAdminSurface,
      categoryCreated,
      editorClosedWithoutValidation,
      taxonomyToggleWorks,
      lineChartRendered,
      zeroTrendUsesEmptyState,
      emptySuccessRateUsesEmDash,
      versionDistributionRemoved,
      overviewHides404Wording,
      moduleRankingUsesVisits,
      nicknamePreferred,
      userListHidesRealName,
      privateDeveloperUserHidden,
      userCombinedFilterWorks,
      userEmptyFilterWorks,
      userFilterResetWorks,
      userFilterApiWorks,
      userDrawerHidesRealName,
      adminApisHideRealName,
      serverExcludesPrivateDeveloperStats,
      serverAnonymizesPrivateDeveloperSubmission,
      userDrawerWorks,
      userDrawerHides404Wording,
      passwordOnlyOnReleases,
      headerBrandUpdated,
      dataTimestampRemoved,
      headerIconLoaded,
      externalPlatformShellRemoved: !document.querySelector('.platform-sidebar') && !document.body.textContent.includes('聚合管理后台'),
      navigationCount: document.querySelectorAll('#navigation [data-view]').length,
      hasPreviewChannel: (() => { document.querySelector('[data-view="releases"]').click(); return true; })()
    };
  })()`);
  if (result.navigationCount !== 6 || result.views.length !== 5 || result.skillSections.some((value) => !value) || !result.multiCategoryFilter || !result.approvalTagLayout || !result.reviewUsesNickname || !result.reviewDeleteAvailable || !result.reviewDownloadAvailable || !result.publishingDeleteAvailable || !result.publishingDownloadAvailable || !result.enterpriseDeleteAvailable || !result.privateDeveloperSubmissionAnonymized || !result.reviewDetailUsesNickname || !result.approvedUsesEnterpriseTaxonomy || !result.enterpriseNameSeparated || !result.enterpriseCreatorUsesNickname || !result.enterpriseDetailUsesNickname || !result.auditTimelineWorks || !result.revokeImpactExplained || result.directSources.some((value) => !value) || !result.directFolderAcceptsSkillOnly || !result.directFolderFilePreviewWorks || !result.directNestedFolderNormalized || !result.directLowercaseSkillRecognized || !result.neutralAdminSurface || !result.categoryCreated || !result.editorClosedWithoutValidation || !result.taxonomyToggleWorks || !result.lineChartRendered || !result.zeroTrendUsesEmptyState || !result.emptySuccessRateUsesEmDash || !result.versionDistributionRemoved || !result.overviewHides404Wording || !result.moduleRankingUsesVisits || !result.nicknamePreferred || !result.userListHidesRealName || !result.privateDeveloperUserHidden || !result.userCombinedFilterWorks || !result.userEmptyFilterWorks || !result.userFilterResetWorks || !result.userFilterApiWorks || !result.adminApisHideRealName || !result.serverExcludesPrivateDeveloperStats || !result.serverAnonymizesPrivateDeveloperSubmission || !result.userDrawerWorks || !result.userDrawerHides404Wording || !result.userDrawerHidesRealName || !result.passwordOnlyOnReleases || !result.headerBrandUpdated || !result.dataTimestampRemoved || !result.headerIconLoaded || !result.externalPlatformShellRemoved || !result.hasPreviewChannel) throw new Error(`V1.1 管理后台交互不完整：${JSON.stringify(result)}`);
  const screenshotRoot = path.join(__dirname, "build", "admin-v11-screenshots");
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const screenshotPaths = [];
  for (const view of ["overview", "skills", "users", "config", "releases"]) {
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-view="${view}"]').click();
      for (let i = 0; i < 80; i += 1) {
        const content = document.querySelector('#content');
        if (document.querySelector('[data-view="${view}"]').classList.contains('active') && content && !/正在读取/.test(content.textContent)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('截图页面加载超时：${view}');
    })()`);
    const screenshotPath = path.join(screenshotRoot, `${view}.png`);
    fs.writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
    screenshotPaths.push(screenshotPath);
  }
  process.stdout.write(`${JSON.stringify({ adminV11: true, ...result, screenshotPaths })}\n`);
  await cleanup(0);
}).catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n${serviceErrors}`);
  await cleanup(1);
});
