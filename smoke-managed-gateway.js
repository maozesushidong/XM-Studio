const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `managed-smoke-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-managed-${runId}`);
const aiConfigPath = path.join(userDataDir, "ai-config.json");
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(aiConfigPath, JSON.stringify({ apiBaseUrl: "", apiKey: "" }), "utf8");

app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
process.env.XIANMA_AI_CONFIG = aiConfigPath;
process.env.XIANMA_DEV_AUTH_BYPASS = "1";
require("./electron/main.js");

function withTimeout(promise, label, timeoutMs = 360000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

async function waitForMainWindow(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (mainWindow) return mainWindow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("主窗口创建超时");
}

app.whenReady().then(async () => {
  const mainWindow = await waitForMainWindow();
  if (mainWindow.webContents.isLoading()) {
    await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "页面加载", 30000);
  }

  const workspace = await mainWindow.webContents.executeJavaScript(
    `window.desktopBridge.getUserWorkspace({ userId: ${JSON.stringify(userId)} })`
  );
  const result = await withTimeout(mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
    userId: ${JSON.stringify(userId)},
    model: "gpt-5.6-sol",
      preferGateway: true,
      waitForGateway: true,
      autoPreviewHtml: true,
      messages: [{
      role: "user",
      content: "请只使用文件工具在当前工作区创建 managed-gateway-proof.html。写入完整可运行的 HTML，页面正文只显示：能力服务端到端验证成功。不要调用浏览器，不要运行命令，创建完成后简短回复。"
    }]
  })`), "能力服务端到端任务");

  if (!result?.gateway) throw new Error("任务退回了普通模型对话路径");
  if (String(result.content || "").includes("仍在后台执行")) throw new Error("能力服务没有返回最终事件");
  const proofPath = path.join(workspace.rootPath, "managed-gateway-proof.html");
  if (!fs.existsSync(proofPath)) throw new Error("能力服务未创建验证文件");
  const proofArtifact = result.files?.find((item) => path.resolve(item.path) === path.resolve(proofPath));
  if (!proofArtifact || !path.isAbsolute(proofArtifact.path)) throw new Error("能力服务未返回生成文件的绝对路径");
  const proofText = fs.readFileSync(proofPath, "utf8");
  if (!proofText.includes("能力服务端到端验证成功")) throw new Error("验证文件内容不正确");
  if (!result.previewPath || BrowserWindow.getAllWindows().length < 2) throw new Error("客户端没有自动打开 HTML 预览");
  const runtimeRoot = path.join(app.getPath("userData"), "agent-runtime", "users", userId);
  const managedConfig = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "runtime-config.json"), "utf8"));
  const approvalConfig = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "state", "exec-approvals.json"), "utf8"));
  if (managedConfig.tools?.profile !== "full" || managedConfig.tools?.exec?.host !== "gateway" || managedConfig.tools?.exec?.security !== "full" || managedConfig.tools?.exec?.ask !== "off") {
    throw new Error("完整工具或完全访问策略未启用");
  }
  if (managedConfig.plugins?.entries?.browser?.enabled !== true || managedConfig.browser?.enabled !== true || managedConfig.browser?.headless !== false || managedConfig.browser?.defaultProfile !== "openclaw") {
    throw new Error("独立可见浏览器能力未启用");
  }
  if (approvalConfig.defaults?.ask !== "off" || approvalConfig.defaults?.askFallback !== "full") throw new Error("本机完全访问配置不正确");

  process.stdout.write(`${JSON.stringify({
    gateway: true,
    model: result.model,
    fileCreated: true,
    absoluteFileArtifact: true,
    previewOpened: true,
    responseLength: String(result.content || "").length,
    fullTools: true,
    visibleBrowser: true,
    fullAccessPolicy: true
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
