process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userId = `skill-live-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-skill-live-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
require("./electron/main.js");

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

async function run() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()), "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");

  const message = [
    "你正在执行用户主动提交的技能任务。禁止输出首次启动问候、自我介绍、询问用户姓名或询问如何称呼。",
    "所选技能：微信公众号写作。根据用户任务提供与公众号写作相关的实际结果；若任务资料不足，明确列出需要补充的内容。",
    "本次用户任务：写一段约 100 字的公众号开场白，主题是团队协作。"
  ].join("\n\n");
  const payload = {
    messages: [
      { role: "system", content: "直接执行技能任务，不要讨论助手身份。" },
      { role: "user", content: message }
    ],
    message,
    model: "gpt-5.6-luna",
    userId,
    conversationId: `skill-${runId}`,
    attachments: [],
    enableFileTools: false,
    preferGateway: true,
    waitForGateway: true,
    stream: false,
    requestId: `skill-live-${runId}`
  };
  const response = await mainWindow.webContents.executeJavaScript(
    `window.desktopBridge.chatCompletion(${JSON.stringify(payload)})`
  );
  const content = String(response?.content || "").trim();
  const workspace = path.join(userDataDir, "users", userId, "files");
  const bootstrapExists = fs.existsSync(path.join(workspace, "BOOTSTRAP.md"));
  const identity = fs.existsSync(path.join(workspace, "IDENTITY.md"))
    ? fs.readFileSync(path.join(workspace, "IDENTITY.md"), "utf8")
    : "";
  const greeting = /刚刚上线|我是谁|怎么称呼|专属\s*emoji|just came online|who am i/i.test(content);
  const result = {
    hasContent: Boolean(content),
    bootstrapExists,
    identityInitialized: identity.includes("XMAI Studio"),
    greeting,
    gateway: response?.gateway === true
  };
  console.log(JSON.stringify(result));
  app.exit(result.hasContent && !result.bootstrapExists && result.identityInitialized && !result.greeting ? 0 : 1);
}

run().catch((error) => {
  console.error(error?.message || error);
  app.exit(1);
});
