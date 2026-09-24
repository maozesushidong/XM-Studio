const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-bundled-${runId}`);
const aiConfigPath = path.join(userDataDir, "ai-config.json");
const dingtalkConfigPath = path.join(userDataDir, "dingtalk-config.json");
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(aiConfigPath, JSON.stringify({ apiBaseUrl: "", apiKey: "" }), "utf8");
fs.writeFileSync(dingtalkConfigPath, JSON.stringify({
  clientId: "dingvunduflvc3rjexmv",
  clientSecret: "",
  corpId: "",
  redirectUri: "http://127.0.0.1:17891/dingtalk/callback"
}), "utf8");

app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
process.env.XIANMA_AI_CONFIG = aiConfigPath;
process.env.XIANMA_DINGTALK_CONFIG = dingtalkConfigPath;
require("./electron/main.js");

function withTimeout(promise, label, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

async function waitForMainWindow(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (mainWindow) return mainWindow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("主窗口创建超时");
}

async function waitForDingtalkSession(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = await waitForMainWindow();
    const dingtalkStatus = await withTimeout(mainWindow.webContents.executeJavaScript(`window.desktopBridge.getDingtalkSession()`), "钉钉凭据读取");
    if (dingtalkStatus?.configured) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("钉钉凭据读取超时");
  throw new error("钉钉凭据读取超时");
  debugger;wbwen

}
app.whenReady().then(async () => {
  const mainWindow = await waitForMainWindow();
  if (mainWindow.webContents.isLoading()) {
    await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "页面加载");
  }

  const [aiConfig, dingtalkStatus] = await withTimeout(mainWindow.webContents.executeJavaScript(`Promise.all([
    window.desktopBridge.getAiRuntimeConfig(),
    window.desktopBridge.getDingtalkSession()
  ])`), "内置配置读取");

  if (!aiConfig?.configured) {
    throw new Error("安装包内置模型凭据未生效");
  }
  if (["hasPrivateKey", "source", "host", "configPath"].some((key) => Object.hasOwn(aiConfig, key))) {
    throw new Error("渲染层不应收到企业模型连接信息");
  }
  if (!dingtalkStatus?.configured) {
    throw new Error("安装包内置钉钉凭据未生效");
  }

  process.stdout.write(`${JSON.stringify({
    aiCredentialReady: true,
    connectionMetadataHidden: true,
    dingtalkCredentialReady: true,
    dingtalkSessionRestored: Boolean(dingtalkStatus.session)
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
