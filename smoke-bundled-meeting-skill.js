process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_AI_API_KEY = "smoke-test-key";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-bundled-meeting-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;

let capturedRequest = null;
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    capturedRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "东哥会议模型测试完成" } }]
    }));
  });
});

require("./electron/main.js");

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForMainWindow(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) return mainWindow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("主窗口创建超时");
}

async function run() {
  const port = await listen();
  process.env.XIANMA_AI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  await app.whenReady();
  const mainWindow = await waitForMainWindow();
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }

  const uiState = await mainWindow.webContents.executeJavaScript(`(() => {
    state.activeView = "skills";
    render();
    const skillButtons = Array.from(document.querySelectorAll('.skill-library-grid [data-use-skill]'));
    const fixedEntry = skillButtons.find((button) => button.dataset.useSkill === "meeting");
    return {
      fixedEntryName: fixedEntry?.closest('.skill-card')?.querySelector('.skill-card-name')?.textContent || "",
      fixedEntryDescription: fixedEntry?.closest('.skill-card')?.querySelector('.skill-card-desc')?.textContent || "",
      fixedEntryFirst: skillButtons[0] === fixedEntry,
      companySectionVisible: Boolean(document.querySelector('[data-skill-tab="enterprise"]')),
      companyActionVisible: ["company-skill-create", "company-skill-submit", "company-skill-mine"].every((view) => document.querySelector('[data-view="' + view + '"]')),
      meetingCount: document.querySelectorAll('[data-use-skill="meeting"]').length,
      companyBridgeExposed: ["createSkillPackage", "submitCompanySkill", "getCompanySkillCatalog", "syncCompanySkills"].some((name) => typeof window.desktopBridge?.[name] === "function")
    };
  })()`);
  const screenshotPath = path.join(__dirname, "build", "smoke-bundled-meeting.png");
  fs.writeFileSync(screenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  const fixedEntryOpened = await mainWindow.webContents.executeJavaScript(`(() => {
    const previousConversationId = state.activeConversationId;
    document.querySelector('.skill-library-grid [data-use-skill="meeting"]')?.click();
    const conversation = activeConversation();
    return {
      opened: state.activeView === "chat" && conversation?.skillId === "meeting",
      newConversation: Boolean(conversation?.id && conversation.id !== previousConversationId),
      empty: Array.isArray(conversation?.messages) && conversation.messages.length === 0
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const formScreenshotPath = path.join(__dirname, "build", "smoke-bundled-meeting-form.png");
  fs.writeFileSync(formScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());

  const result = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
    userId: "meeting-smoke-user",
    conversationId: "meeting-smoke-conversation",
    requestId: "meeting-smoke-request",
    model: "gpt-5.6-luna",
    skillId: "meeting",
    skillSlug: "dongge-meeting-model",
    messages: [
      { role: "system", content: "请直接执行会议技能。" },
      { role: "user", content: "根据会议材料生成会议蒸馏结果。" }
    ],
    enableFileTools: false,
    preferGateway: false,
    waitForGateway: false,
    stream: false
  })`);

  const systemPrompt = String(capturedRequest?.messages?.find((message) => message.role === "system")?.content || "");
  const checks = {
    fixedSkillVisible: uiState.fixedEntryName === "东哥会议模型" && uiState.fixedEntryDescription.includes("核心矛盾"),
    fixedSkillOpens: fixedEntryOpened.opened,
    fixedSkillNotDuplicated: uiState.meetingCount === 1,
    fixedSkillFirst: uiState.fixedEntryFirst,
    newConversationCreated: fixedEntryOpened.newConversation,
    newConversationEmpty: fixedEntryOpened.empty,
    companySkillUiIncluded: uiState.companySectionVisible && uiState.companyActionVisible,
    companySkillBridgeIncluded: uiState.companyBridgeExposed,
    responseReturned: result?.content === "东哥会议模型测试完成",
    fixedSkillName: systemPrompt.includes("东哥会议模型"),
    skillManifest: systemPrompt.includes("name: dongge-meeting-model"),
    completeFramework: systemPrompt.includes("先马会议蒸馏与组织知识资产化系统") && systemPrompt.includes("version: V4.0"),
    decisionDiscipline: systemPrompt.includes("不把个人发言写成会议决策"),
    referenceInjected: systemPrompt.length > 20000
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`固定会议技能测试失败：${failed.join(", ")}`);
  process.stdout.write(`${JSON.stringify({ bundledMeetingSkill: true, promptChars: systemPrompt.length, screenshotPath, formScreenshotPath, ...checks })}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(0);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(1);
});
