process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const http = require("http");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-online-skill-filter-${runId}`);
const userId = `online-skill-filter-${runId}`;
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(`${label}超时`);
}

const validSkillMarkdown = [
  "---",
  "name: valid-online-skill",
  "description: 一个可以直接安装的在线技能。",
  "---",
  "",
  "# 合法在线技能",
  ""
].join("\n");
const invalidSkillMarkdown = [
  "---",
  "name: invalid-online-skill",
  "description: >",
  "  这是多行描述。",
  "  在线安装器会拒绝它。",
  "---",
  "",
  "# 不兼容在线技能",
  ""
].join("\n");

let requestLog = [];
let server;

async function run() {
  const archive = new JSZip();
  archive.file("valid-online-skill/SKILL.md", validSkillMarkdown);
  archive.file("valid-online-skill/references/example.txt", "在线市场技能资源文件");
  const validSkillArchive = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  server = http.createServer((request, response) => {
    requestLog.push(request.url || "");
    if (request.url?.startsWith("/downloads/valid-online-skill.zip")) {
      response.setHeader("Content-Type", "application/zip");
      response.end(validSkillArchive);
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.url?.startsWith("/api/v1/search")) {
      response.end(JSON.stringify({ results: [
        { slug: "valid-online-skill", displayName: "合法技能", summary: "可以安装", ownerHandle: "test-owner", downloads: 10 },
        { slug: "invalid-online-skill", displayName: "不兼容技能", summary: "应该被过滤", ownerHandle: "test-owner", downloads: 20 }
      ] }));
      return;
    }
    if (request.url?.startsWith("/api/v1/skills/valid-online-skill/install")) {
      response.end(JSON.stringify({
        ok: true,
        slug: "valid-online-skill",
        installKind: "archive",
        archive: { version: "1.0.0", downloadUrl: "/downloads/valid-online-skill.zip" }
      }));
      return;
    }
    if (request.url?.startsWith("/api/v1/skills/-/security-verdicts")) {
      response.end(JSON.stringify({ items: [{
        ok: true,
        decision: "pass",
        reasons: [],
        requestedSlug: "valid-online-skill",
        requestedVersion: "1.0.0",
        slug: "valid-online-skill",
        version: "1.0.0",
        displayName: "合法技能",
        publisherHandle: "test-owner",
        security: { status: "clean", passed: true }
      }] }));
      return;
    }
    if (request.url?.startsWith("/api/v1/skills/valid-online-skill")) {
      response.end(JSON.stringify({ skill: { description: validSkillMarkdown } }));
      return;
    }
    if (request.url?.startsWith("/api/v1/skills/invalid-online-skill")) {
      response.end(JSON.stringify({ skill: { description: invalidSkillMarkdown } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.XIANMA_SKILL_LIBRARY_URL = `http://127.0.0.1:${server.address().port}`;
  require("./electron/main.js");

  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");

  const result = await mainWindow.webContents.executeJavaScript(`(async ({ userId }) => {
    state.session = { userId, name: "在线技能过滤测试用户" };
    state.authReady = true;
    const response = await window.desktopBridge.searchOnlineSkills({ query: "fixture", limit: 20 });
    const validInstall = await window.desktopBridge.installOnlineSkill({ userId, reference: "@test-owner/valid-online-skill", acknowledgeRisk: true, replace: true });
    const invalidInstall = await window.desktopBridge.installOnlineSkill({ userId, reference: "@test-owner/invalid-online-skill" });
    const installed = await window.desktopBridge.getInstalledSkills({ userId });
    const validSkill = installed.skills.find((skill) => skill.slug === "valid-online-skill");
    const validSource = validSkill ? await window.desktopBridge.getInstalledSkillSource({ userId, skillId: validSkill.id }) : null;
    return {
      resultCount: response.results.length,
      references: response.results.map((skill) => skill.reference),
      filteredCount: response.filteredCount,
      validStatus: response.results[0]?.preflightStatus || "",
      validInstalled: Boolean(validInstall?.installed && installed.skills.some((skill) => skill.slug === "valid-online-skill")),
      validSourcePath: validSource?.sourcePath || "",
      invalidInstallFiltered: Boolean(invalidInstall.filtered),
      invalidInstallMessage: invalidInstall.message || ""
    };
  })(${JSON.stringify({ userId })})`);

  const passed = result.resultCount === 1
    && result.references[0] === "@test-owner/valid-online-skill"
    && result.filteredCount === 1
    && result.validStatus === "valid"
    && result.validInstalled
    && fs.existsSync(path.join(result.validSourcePath, "references", "example.txt"))
    && result.invalidInstallFiltered
    && result.invalidInstallMessage.includes("description");
  console.log(JSON.stringify({ ...result, passed, requests: requestLog }));
  server.close();
  app.exit(passed ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  server?.close();
  app.exit(1);
});
