const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, session: electronSession } = require("electron");

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "..", "build", `probe-dingtalk-auth-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
app.on("quit", () => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // The probe also clears identity data before quitting if Windows still holds a file handle here.
  }
});
require("../electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs = 180000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("真实钉钉授权页响应超时")), timeoutMs))
  ]);
}

app.whenReady().then(async () => {
  await delay(500);
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) throw new Error("主窗口未创建");
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }

  let message = "";
  try {
    const session = await withTimeout(mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogin()"));
    if (!session?.userId) throw new Error("钉钉登录没有返回用户标识");
    const sessionPath = path.join(userDataDir, "dingtalk-sessions.json");
    const sessionText = fs.readFileSync(sessionPath, "utf8");
    const store = JSON.parse(sessionText);
    const record = Object.values(store.users || {}).find((item) => item.userId === session.userId);
    const publicConfigPath = path.join(process.env.ProgramData || "C:\\ProgramData", "XianmaAIStudio", "dingtalk-config.json");
    const publicConfig = JSON.parse(fs.readFileSync(publicConfigPath, "utf8"));
    const result = {
      realAuthorizationReady: true,
      userIdReceived: Boolean(record?.userId),
      corpIdMatched: Boolean(record?.corpId && record.corpId === publicConfig.corpId),
      encryptedAtRest: Boolean(record?.tokenCipher && !record?.accessToken && !record?.refreshToken),
      expiresAtRecorded: Number(record?.expiresAt) > Date.now()
    };
    if (!Object.values(result).every(Boolean)) throw new Error("真实钉钉会话验收未全部通过");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    message = String(error?.message || error);
    process.stdout.write(`${JSON.stringify({
      realAuthorizationReady: false,
      applicationMissing: message.includes("900103"),
      action: message.includes("900103") ? "配置开发配置 > 安全设置并发布应用" : message.slice(0, 180)
    })}\n`);
  }

  try {
    await mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogout()");
  } catch {
    // Cleanup continues even if no application session was created.
  }
  try {
    await electronSession.fromPartition("persist:xianma-dingtalk-auth").clearStorageData();
  } catch {
    // The temporary user-data directory is removed on quit as a second cleanup layer.
  }
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(message && !message.includes("900103") ? 1 : 0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
