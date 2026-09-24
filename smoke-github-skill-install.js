"use strict";

process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const http = require("http");
const path = require("path");
const JSZip = require("jszip");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-github-skill-${runId}`);
const repositoryFixture = path.join(userDataDir, "ui-ux-pro-max-skill");
const primarySkillRoot = path.join(repositoryFixture, ".claude", "skills", "ui-ux-pro-max");
const otherSkillRoot = path.join(repositoryFixture, "examples", "other-skill");
const userId = `github-skill-${runId}`;
fs.mkdirSync(primarySkillRoot, { recursive: true });
fs.mkdirSync(path.join(primarySkillRoot, "scripts"), { recursive: true });
fs.mkdirSync(otherSkillRoot, { recursive: true });
fs.writeFileSync(path.join(primarySkillRoot, "skill.md"), [
  "---",
  "name: ui-ux-pro-max",
  "description: UI/UX design intelligence for web, mobile, and desktop.",
  "---",
  "",
  "# UI/UX Pro Max",
  "",
  "Run scripts/search.py when detailed guidance is needed."
].join("\n"), "utf8");
fs.writeFileSync(path.join(primarySkillRoot, "scripts", "search.py"), "print('fixture')\n", "utf8");
fs.writeFileSync(path.join(otherSkillRoot, "SKILL.md"), [
  "---",
  "name: other-skill",
  "description: A secondary example skill that must not be selected.",
  "---",
  "",
  "# Other"
].join("\n"), "utf8");
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
    await delay(50);
  }
  throw new Error(`${label}超时`);
}

async function archiveFixture() {
  const zip = new JSZip();
  zip.file("ui-ux-pro-max-skill-main/.claude/skills/ui-ux-pro-max/skill.md", fs.readFileSync(path.join(primarySkillRoot, "skill.md")));
  zip.file("ui-ux-pro-max-skill-main/.claude/skills/ui-ux-pro-max/scripts/search.py", fs.readFileSync(path.join(primarySkillRoot, "scripts", "search.py")));
  zip.file("ui-ux-pro-max-skill-main/examples/other-skill/SKILL.md", fs.readFileSync(path.join(otherSkillRoot, "SKILL.md")));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

let server;

async function run() {
  const useRealGitHub = process.env.XIANMA_TEST_REAL_GITHUB === "1";
  if (!useRealGitHub) {
    const archive = await archiveFixture();
    server = http.createServer((request, response) => {
      if (request.url === "/repos/nextlevelbuilder/ui-ux-pro-max-skill") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ default_branch: "main" }));
        return;
      }
      if (request.url === "/nextlevelbuilder/ui-ux-pro-max-skill/zip/main") {
        response.setHeader("content-type", "application/zip");
        response.end(archive);
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    process.env.XIANMA_GITHUB_API_BASE_URL = baseUrl;
    process.env.XIANMA_GITHUB_CODELOAD_BASE_URL = baseUrl;
    process.env.XIANMA_GITHUB_RAW_BASE_URL = baseUrl;
  }
  require("./electron/main.js");

  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const window = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !window.webContents.isLoading(), "页面加载");

  const result = await window.webContents.executeJavaScript(`(async ({ userId, repositoryFixture }) => {
    state.session = { userId, name: "GitHub技能安装测试用户" };
    state.authReady = true;
    const inspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: repositoryFixture });
    const conversation = activeConversation();
    const assistantMessage = { id: "github-install-reply", role: "assistant", content: "", loading: true };
    const reply = await getAssistantReply(conversation, {
      id: "github-install-request",
      role: "user",
      content: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill 帮我安装这个技能在本地，成为我的技能",
      attachments: []
    }, null, assistantMessage, "github-install-request");
    const installed = await window.desktopBridge.getInstalledSkills({ userId });
    const skill = installed.skills.find((item) => item.slug === "ui-ux-pro-max");
    const source = skill ? await window.desktopBridge.getInstalledSkillSource({ userId, skillId: skill.id }) : null;
    return {
      inspectionSlug: inspection.skill?.slug,
      installedSlugs: installed.skills.map((item) => item.slug),
      reply: reply?.content || "",
      sourcePath: source?.sourcePath || ""
    };
  })(${JSON.stringify({ userId, repositoryFixture })})`);

  const passed = result.inspectionSlug === "ui-ux-pro-max"
    && result.installedSlugs.includes("ui-ux-pro-max")
    && !result.installedSlugs.includes("other-skill")
    && result.reply.includes("已安装技能")
    && !/[A-Za-z]:\\Users\\/i.test(result.reply)
    && result.sourcePath.includes("ui-ux-pro-max")
    && fs.existsSync(path.join(result.sourcePath, "scripts", "search.py"));
  console.log(JSON.stringify({ ...result, realGitHub: useRealGitHub, scriptCopied: fs.existsSync(path.join(result.sourcePath, "scripts", "search.py")), passed }));
  server?.close();
  app.exit(passed ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  server?.close();
  app.exit(1);
});
