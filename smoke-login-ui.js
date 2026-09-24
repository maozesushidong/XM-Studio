const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-login-ui-${runId}`);
const configPath = path.join(userDataDir, "dingtalk-config.json");
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  clientId: "ui-preview-client",
  clientSecret: "ui-preview-secret",
  corpId: "ui-preview-corp",
  redirectUri: "http://127.0.0.1:37891/dingtalk/callback",
  loginMode: "embedded",
  enforceCorpId: true
}, null, 2), "utf8");

app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
process.env.XIANMA_DINGTALK_CONFIG = configPath;
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  await delay(500);
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) throw new Error("主窗口未创建");
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }
  await delay(500);

  const state = await mainWindow.webContents.executeJavaScript(`(() => ({
    loginVisible: !document.querySelector('#loginModal')?.classList.contains('hidden'),
    buttonText: document.querySelector('#dingtalkLoginButton span:last-child')?.textContent?.trim(),
    statusText: document.querySelector('#loginStatusText')?.textContent?.trim(),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hasVerticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight
  }))()`);

  if (!state.loginVisible) throw new Error("登录页未显示");
  if (state.buttonText !== "打开扫码登录") throw new Error("扫码登录入口文案不正确");
  if (!state.statusText.includes("扫码")) throw new Error("登录状态文案不正确");
  if (state.hasHorizontalOverflow || state.hasVerticalOverflow) throw new Error("登录页存在视口溢出");

  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-login-ui.png");
  fs.writeFileSync(screenshotPath, image.toPNG());
  process.stdout.write(`${JSON.stringify({ ...state, screenshotPath })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
