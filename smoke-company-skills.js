"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { app } = require("electron");
const JSZip = require("jszip");
const { createCompanySkillsClient } = require("./electron/company-skills");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-company-skills-smoke-"));
app.setPath("userData", path.join(temporaryRoot, "user-data"));

async function main() {
  await app.whenReady();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPath = path.join(temporaryRoot, "public.pem");
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }));
  const uploads = new Map();
  const usage = [];
  const v11Facts = [];
  let taxonomyRequests = 0;
  let taxonomyRevision = 1;
  let packageBuffer = null;
  let catalogMode = "published";
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    assert.strictEqual(request.headers.authorization, "Bearer company-test-token");
    const sendJson = (status, value) => {
      const body = Buffer.from(JSON.stringify(value));
      response.writeHead(status, { "content-type": "application/json", "content-length": body.length });
      response.end(body);
    };
    if (request.method === "POST" && url.pathname === "/api/desktop/skill-submissions/uploads") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const metadata = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      uploads.set("upload-1", { metadata, chunks: new Map() });
      return sendJson(201, { uploadId: "upload-1", chunkSize: 128, chunkCount: Math.ceil(metadata.fileSize / 128), uploadedChunks: [] });
    }
    const chunkMatch = url.pathname.match(/^\/api\/desktop\/skill-submissions\/uploads\/upload-1\/chunks\/(\d+)$/);
    if (request.method === "PUT" && chunkMatch) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploads.get("upload-1").chunks.set(Number(chunkMatch[1]), Buffer.concat(chunks));
      return sendJson(200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/desktop/skill-submissions/uploads/upload-1/complete") {
      const upload = uploads.get("upload-1");
      assert.strictEqual(upload.chunks.size, Math.ceil(upload.metadata.fileSize / 128));
      return sendJson(201, { submission: { submissionId: "submission-1", displayName: "项目简报", status: "pending" } });
    }
    if (request.method === "GET" && url.pathname === "/api/desktop/skill-submissions/mine") return sendJson(200, { submissions: [] });
    if (request.method === "GET" && url.pathname === "/api/desktop/company-skills") {
      if (catalogMode === "revoked") return sendJson(200, { skills: [], revokedSkillIds: ["sk-company-test"] });
      const sha256 = crypto.createHash("sha256").update(packageBuffer).digest("hex");
      const signedPayload = Buffer.from(JSON.stringify({ schemaVersion: 1, skillId: "sk-company-test", name: "project-brief", version: "1.0.0", sha256, size: packageBuffer.length, publishedAt: new Date().toISOString(), downloadPath: "/package" }));
      return sendJson(200, { skills: [{ skillId: "sk-company-test", displayName: "项目简报", description: "整理项目进展", category: "办公效率", starter: "整理本周项目进展", icon: "file-text", supportedInputs: ["text"], outputs: ["docx"], riskLevel: "low", riskItems: [], latestVersion: "1.0.0", sha256, size: packageBuffer.length, signed: signedPayload.toString("base64url"), signature: crypto.sign(null, signedPayload, privateKey).toString("base64url") }], revokedSkillIds: [] });
    }
    if (request.method === "GET" && url.pathname === "/api/desktop/skills/config") {
      taxonomyRequests += 1;
      assert.ok(url.searchParams.get("refresh"), "分类同步请求必须携带刷新标识");
      assert.strictEqual(request.headers["cache-control"], "no-cache");
      return sendJson(200, {
        schemaVersion: 1,
        categories: [
          { categoryId: "office", name: "办公效率", status: "ENABLED", sortOrder: 10 },
          { categoryId: "retired", name: "已停用分类", status: "DISABLED", sortOrder: 20 },
          ...(taxonomyRevision > 1 ? [{ categoryId: "server-new", name: "服务器新增分类", status: "ENABLED", sortOrder: 30 }] : [])
        ],
        tags: [{ tagId: "weekly", name: "周报", status: "ENABLED", sortOrder: 10 }]
      });
    }
    if (request.method === "GET" && url.pathname === "/api/desktop/company-skills/sk-company-test/package") {
      response.writeHead(200, { "content-type": "application/zip", "content-length": packageBuffer.length });
      return response.end(packageBuffer);
    }
    if (request.method === "POST" && url.pathname === "/api/desktop/company-skills/usage") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      usage.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return sendJson(202, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/desktop/v11/facts") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const facts = JSON.parse(Buffer.concat(chunks).toString("utf8")).facts || [];
      v11Facts.push(...facts);
      return sendJson(202, { ok: true, accepted: facts.length });
    }
    sendJson(404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const skillsRoot = path.join(temporaryRoot, "skills");
  fs.mkdirSync(skillsRoot, { recursive: true });
  let installedSkills = [];
  let installs = 0;
  let disables = 0;
  let sessionToken = "company-test-token";
  const dialog = {};
  const clientOptions = {
    app,
    dialog,
    fs,
    path,
    crypto,
    JSZip,
    publicKeyPath,
    getServiceConfig: () => ({ baseUrl }),
    getSessionToken: () => sessionToken,
    getUserSkillsDir: () => skillsRoot,
    listInstalledSkills: () => installedSkills,
    installCompanyPackage: async ({ packagePath, skill }) => {
      installs += 1;
      assert.strictEqual(crypto.createHash("sha256").update(fs.readFileSync(packagePath)).digest("hex"), skill.sha256);
      return { installed: true };
    },
    disableCompanySkill: async () => { disables += 1; return { disabled: true }; }
  };
  const client = createCompanySkillsClient(clientOptions);
  const event = { sender: { isDestroyed: () => false, send() {} } };
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: "E:\\" });
  await assert.rejects(client.downloadTemplate(), /请选择具体文件名，不要直接选择磁盘根目录/, "保存到磁盘根目录必须给出可理解的提示");
  dialog.showSaveDialog = async (options) => ({ canceled: false, filePath: path.join(temporaryRoot, `template-${Date.now()}.zip`) });
  const templateResult = await client.downloadTemplate();
  assert.ok(templateResult.path.endsWith(".zip") && fs.existsSync(templateResult.path), "标准模板必须能保存到有效 ZIP 路径");
  const draft = {
    name: "project-brief",
    version: "1.0.0",
    displayName: "项目简报",
    description: "根据项目资料生成结构化简报。",
    category: "办公效率",
    categoryId: "office",
    tagIds: ["weekly"],
    newTags: ["项目管理"],
    starter: "请整理本周项目进展。",
    icon: "file-text",
    applicable: "需要归纳项目进展、风险和计划时使用。",
    inputs: "输入项目进展文字或附件。",
    outputRequirements: "输出完成事项、风险和下周计划。",
    steps: "1. 阅读输入。\n2. 去重归类。\n3. 输出简报。",
    boundaries: "不得编造项目数据。",
    exceptions: "材料不足时列出缺失信息。",
    example: "用户：整理项目简报。\n技能：输出结构化项目简报。",
    supportedInputs: ["text", "document"],
    outputs: ["markdown", "docx"],
    permissions: [],
    dependencies: []
  };
  const created = await client.createSkillPackage(event, { userId: "user-a", draft, saveAs: false });
  assert.ok(fs.existsSync(created.path));
  const inspection = await client.inspectCompanySkill({ sourcePath: created.path });
  assert.strictEqual(inspection.skill.name, "project-brief");
  assert.strictEqual(inspection.skill.categoryId, "office");
  assert.deepStrictEqual(inspection.skill.tagIds, ["weekly"]);
  assert.deepStrictEqual(inspection.skill.newTags, ["项目管理"]);
  const markdownPath = path.join(temporaryRoot, "imported-skill.md");
  fs.writeFileSync(markdownPath, `---\nname: imported-skill\ndescription: 导入现有 Markdown 技能。\n---\n\n# 适用场景\n整理资料。\n\n# 输入要求\n提供内容。\n\n# 输出要求\n输出摘要。\n\n# 执行流程\n1. 阅读内容。\n\n# 边界与禁止事项\n不得编造。\n\n# 异常处理\n说明缺失项。\n\n# 使用示例\n用户：整理资料。`, "utf8");
  const imported = await client.inspectCompanySkill({ sourcePath: markdownPath });
  assert.strictEqual(imported.importDraft.name, "imported-skill");
  assert.strictEqual(imported.importDraft.applicable, "整理资料。");
  assert.ok(imported.validationError.includes("skill.json"));
  const marketSkillRoot = path.join(temporaryRoot, "market-skill");
  fs.mkdirSync(path.join(marketSkillRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(marketSkillRoot, "skill.md"), `---\nname: ppt-generator\ndescription: 根据用户材料生成演示页面。\n---\n\n# 原始执行说明\n必须读取用户材料，并调用 scripts/render.js 生成 HTML。`, "utf8");
  fs.writeFileSync(path.join(marketSkillRoot, "scripts", "render.js"), "module.exports = () => 'presentation';", "utf8");
  fs.writeFileSync(path.join(marketSkillRoot, ".xianma-skill-origin.json"), JSON.stringify({ source: "online", sourceReference: "github:test/ppt-generator" }), "utf8");
  const preparedMarketSkill = await client.prepareInstalledSkillSubmission({
    userId: "user-a",
    sourcePath: marketSkillRoot,
    skill: { slug: "ppt-generator", name: "PPT 生成器", description: "根据用户材料生成演示页面。", category: "内容创作", starter: "请生成演示页面。" }
  });
  assert.strictEqual(preparedMarketSkill.normalized, true, "在线市场技能必须自动转换为标准审核包");
  assert.strictEqual(preparedMarketSkill.inspection.skill.name, "ppt-generator");
  assert.ok(preparedMarketSkill.inspection.fileTree.includes("scripts/render.js"), "转换审核包必须保留原技能脚本");
  assert.ok(!preparedMarketSkill.inspection.fileTree.includes(".xianma-skill-origin.json"), "审核包不能上传本机来源标记");
  const preparedZip = await JSZip.loadAsync(fs.readFileSync(preparedMarketSkill.sourcePath));
  const preparedMarkdownEntry = Object.values(preparedZip.files).find((entry) => /(^|\/)SKILL\.md$/i.test(entry.name));
  assert.strictEqual(Object.values(preparedZip.files).filter((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name)).length, 1, "小写 skill.md 转换后不能产生重复入口");
  const preparedMarkdown = await preparedMarkdownEntry.async("string");
  assert.ok(preparedMarkdown.includes("# 原始执行说明") && preparedMarkdown.includes("# 使用示例"), "转换审核包必须同时保留原说明并补齐审核章节");
  const repositorySkillRoot = path.join(temporaryRoot, "github-repository-skill");
  fs.mkdirSync(path.join(repositorySkillRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repositorySkillRoot, "examples", "sample-skill"), { recursive: true });
  fs.writeFileSync(path.join(repositorySkillRoot, "SKILL.md"), `---\nname: doxent\ndescription: 读取和操作办公数据。\nversion: 1.3.6\n---\n\n# Doxent\n使用主技能处理办公数据。`, "utf8");
  fs.writeFileSync(path.join(repositorySkillRoot, "scripts", "main.js"), "module.exports = () => 'doxent';", "utf8");
  fs.writeFileSync(path.join(repositorySkillRoot, "examples", "sample-skill", "SKILL.md"), `---\nname: doxent-example\ndescription: 示例子技能。\n---\n\n# Example`, "utf8");
  fs.writeFileSync(path.join(repositorySkillRoot, "examples", "sample-skill", "example.js"), "module.exports = true;", "utf8");
  const preparedRepositorySkill = await client.prepareInstalledSkillSubmission({
    userId: "user-a",
    sourcePath: repositorySkillRoot,
    skill: { slug: "doxent", name: "doxent", description: "读取和操作办公数据。", category: "办公效率", starter: "请使用 Doxent。" }
  });
  assert.strictEqual(preparedRepositorySkill.normalized, true, "包含子技能的 GitHub 仓库必须生成标准审核包");
  assert.strictEqual(preparedRepositorySkill.inspection.skill.name, "doxent");
  assert.ok(preparedRepositorySkill.inspection.fileTree.includes("scripts/main.js"), "标准审核包必须保留主技能资源");
  assert.ok(!preparedRepositorySkill.inspection.fileTree.some((item) => item.startsWith("examples/sample-skill/")), "标准审核包不能混入示例子技能");
  const preparedRepositoryZip = await JSZip.loadAsync(fs.readFileSync(preparedRepositorySkill.sourcePath));
  assert.strictEqual(Object.values(preparedRepositoryZip.files).filter((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name)).length, 1, "标准审核包必须且只能保留主入口");
  const ambiguousSkillZip = new JSZip();
  ambiguousSkillZip.file("skills/alpha/SKILL.md", `---\nname: alpha\ndescription: Alpha 技能。\n---\n`);
  ambiguousSkillZip.file("skills/beta/SKILL.md", `---\nname: beta\ndescription: Beta 技能。\n---\n`);
  const ambiguousSkillPath = path.join(temporaryRoot, "ambiguous-skills.zip");
  fs.writeFileSync(ambiguousSkillPath, await ambiguousSkillZip.generateAsync({ type: "nodebuffer" }));
  await assert.rejects(
    client.prepareInstalledSkillSubmission({ userId: "user-a", sourcePath: ambiguousSkillPath, skill: { name: "并列技能" } }),
    /多个并列技能入口.*alpha.*beta/,
    "无法判定主入口时必须列出候选路径"
  );
  packageBuffer = fs.readFileSync(created.path);
  const submitted = await client.submitCompanySkill(event, { userId: "user-a", sourcePath: created.path });
  assert.strictEqual(submitted.submission.status, "pending");
  const catalog = await client.getCatalog();
  assert.strictEqual(catalog.skills.length, 1);
  const taxonomy = await client.getSkillTaxonomy();
  assert.strictEqual(taxonomyRequests, 1, "客户端必须请求服务端技能分类配置");
  assert.strictEqual(taxonomy.categories[0].name, "办公效率");
  assert.strictEqual(taxonomy.categories[1].status, "DISABLED");
  assert.strictEqual(taxonomy.tags[0].name, "周报");
  taxonomyRevision = 2;
  const refreshedTaxonomy = await client.getSkillTaxonomy();
  assert.strictEqual(taxonomyRequests, 2, "客户端必须能再次拉取服务器新增分类");
  assert.ok(refreshedTaxonomy.categories.some((item) => item.categoryId === "server-new" && item.name === "服务器新增分类"));
  const originalPublicKey = fs.readFileSync(publicKeyPath, "utf8");
  const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(publicKeyPath, wrongPublicKey.export({ type: "spki", format: "pem" }));
  await assert.rejects(client.installCompanySkill(event, { userId: "user-a", skillId: "sk-company-test" }), /签名公钥不匹配/);
  fs.writeFileSync(publicKeyPath, originalPublicKey, "utf8");
  await client.installCompanySkill(event, { userId: "user-a", skillId: "sk-company-test" });
  assert.strictEqual(installs, 1);
  installedSkills = [{ companySkillId: "sk-company-test", companyVersion: "0.9.0" }];
  await client.syncCompanySkills(event, { userId: "user-a" });
  assert.strictEqual(installs, 2, "已安装旧版本必须自动更新");
  await client.reportUsage({ taskId: "task-company-skill-001", skillId: "sk-company-test", version: "1.0.0", outcome: "succeeded" });
  assert.deepStrictEqual(usage[0], {
    taskId: "task-company-skill-001",
    enterpriseSkillId: "sk-company-test",
    skillId: "sk-company-test",
    version: "1.0.0",
    outcome: "succeeded",
    idempotencyKey: "company-skill:task-company-skill-001:sk-company-test:succeeded"
  });
  sessionToken = "";
  const queuedFacts = await client.reportV11Facts({ facts: [{ kind: "module", eventKey: "queued-v11-fact", moduleCode: "SKILL_LIBRARY", action: "visit", keyOperation: false, occurredAt: new Date().toISOString() }] });
  assert.strictEqual(queuedFacts.queued, true, "统计会话未就绪时必须暂存事实");
  assert.strictEqual(v11Facts.length, 0, "统计会话未就绪时不能发送未鉴权请求");
  sessionToken = "company-test-token";
  await client.flushV11Facts();
  assert.strictEqual(v11Facts.length, 1, "统计会话就绪后必须补报暂存事实");
  assert.strictEqual(v11Facts[0].eventKey, "queued-v11-fact");
  sessionToken = "";
  for (let batch = 0; batch < 4; batch += 1) {
    await client.reportV11Facts({ facts: Array.from({ length: 500 }, (_, index) => ({
      kind: "module",
      eventKey: `offline-${batch}-${index}`,
      moduleCode: "AI_CHAT",
      action: "visit",
      keyOperation: false,
      occurredAt: new Date().toISOString()
    })) });
  }
  await client.reportV11Facts({ facts: [{
    kind: "module",
    eventKey: "offline-overflow",
    moduleCode: "AI_CHAT",
    action: "visit",
    keyOperation: false,
    occurredAt: new Date().toISOString()
  }] });
  const persistedQueue = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "telemetry", "v11-facts-queue.json"), "utf8"));
  assert.strictEqual(persistedQueue.facts.length, 2000, "离线队列必须按容量持久化");
  const qualityFact = persistedQueue.facts.find((fact) => fact.kind === "quality" && fact.eventType === "OFFLINE_QUEUE_OVERFLOW");
  assert.strictEqual(qualityFact?.droppedCount, 2, "质量记录必须精确包含被容量和质量记录共同替换的事实数");
  const restartedClient = createCompanySkillsClient(clientOptions);
  const restoredQueue = await restartedClient.flushV11Facts();
  assert.strictEqual(restoredQueue.pending, 2000, "客户端重启后必须恢复未补传事实");
  sessionToken = "company-test-token";
  await restartedClient.flushV11Facts();
  assert.strictEqual(v11Facts.length, 2001, "重启后的客户端必须补传持久化队列");
  assert.ok(v11Facts.some((fact) => fact.kind === "quality" && fact.eventType === "OFFLINE_QUEUE_OVERFLOW"), "服务端必须收到离线队列质量记录");
  catalogMode = "revoked";
  await client.syncCompanySkills(event, { userId: "user-a" });
  assert.strictEqual(disables, 1, "已下架技能必须在同步时停用");
  process.stdout.write("company skills client smoke test passed\n");
  server.close();
}

let failureCode = 0;
main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  failureCode = 1;
}).finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  app.exit(failureCode);
});
