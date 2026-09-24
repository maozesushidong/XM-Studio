"use strict";

process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TELEMETRY = "0";
process.env.XIANMA_PROMPT_LIBRARY_API_URL = "https://cv.xianmaec.com/api/open/v1/resources/prompts";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xmai-prompt-library-live-"));
app.setPath("userData", temporaryRoot);
process.env.XIANMA_USER_DATA = temporaryRoot;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`${label}超时`);
}

function cleanup(code) {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 }); } catch {}
  app.exit(code);
  setTimeout(() => process.exit(code), 80);
}

require("./electron/main.js");

app.whenReady().then(async () => {
  let mainWindow = null;
  await waitFor(() => {
    mainWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("renderer/index.html"));
    return Boolean(mainWindow);
  }, "主窗口创建");
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(state.session?.userId)"), "开发登录");
  await mainWindow.webContents.executeJavaScript("showView('prompt-library')");
  await waitFor(() => mainWindow.webContents.executeJavaScript("promptLibraryState.loaded && !promptLibraryState.loading"), "公共提示词库加载");
  const result = await mainWindow.webContents.executeJavaScript(`(() => ({
    total: promptLibraryState.total,
    cards: document.querySelectorAll('.prompt-library-card:not(.prompt-library-skeleton)').length,
    title: document.querySelector('.prompt-library-header h1')?.innerText,
    error: promptLibraryState.error,
    activeView: state.activeView
  }))()`);
  if (result.activeView !== "prompt-library" || result.title !== "提示词库" || result.total < 1 || result.cards < 1 || result.error) {
    throw new Error(`公共提示词库真实接口验证失败：${JSON.stringify(result)}`);
  }
  if (BrowserWindow.getAllWindows().length !== 1) throw new Error("真实提示词库错误地打开了额外窗口");
  process.stdout.write(`${JSON.stringify({ livePromptLibrary: true, embedded: true, total: result.total, cards: result.cards })}\n`);
  cleanup(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  cleanup(1);
});
