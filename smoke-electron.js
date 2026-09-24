process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const expectedVersion = require("./package.json").version;

const userDataDir = path.join(__dirname, "build", `smoke-electron-${Date.now().toString(36)}`);
fs.mkdirSync(userDataDir, { recursive: true });
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

app.whenReady().then(async () => {
  process.stdout.write("ready\n");
  await delay(300);
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) throw new Error("主窗口未创建");
  if (mainWindow.webContents.isLoading()) {
    await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "页面加载");
  }
  await delay(900);
  process.stdout.write("loaded\n");

  const state = await withTimeout(mainWindow.webContents.executeJavaScript(`(() => ({
    loginHidden: document.querySelector('#loginModal')?.classList.contains('hidden'),
    accountName: document.querySelector('#accountName')?.textContent,
    starterCount: document.querySelectorAll('[data-starter-skill]').length,
    models: [...document.querySelectorAll('[data-model-value]')].map((item) => item.dataset.modelValue),
    workspaceNavCount: document.querySelectorAll('[data-view="workspace"]').length,
    containsInternalName: document.body.innerText.toLowerCase().includes(['open', 'claw'].join(''))
  }))()`), "页面状态读取");
  process.stdout.write("state-read\n");
  if (!state.models.includes("auto") || !state.models.includes("gpt-image-2") || state.workspaceNavCount !== 0) {
    throw new Error(`模型选择或统一对话入口不正确：${JSON.stringify(state)}`);
  }

  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view="settings"]')?.click()`);
  await delay(300);
  const settingsState = await mainWindow.webContents.executeJavaScript(`(() => ({
    visible: document.querySelector('#pageView') && !document.querySelector('#pageView').classList.contains('hidden'),
    title: document.querySelector('#pageContent .page-header h1')?.textContent || '',
    version: document.querySelector('.settings-row-copy span')?.textContent || '',
    checkButton: document.querySelector('[data-action="check-for-updates"]')?.textContent.trim() || '',
    autoCheckToggle: Boolean(document.querySelector('[data-auto-update-check]')),
    historyTitle: document.querySelector('#updateHistoryTitle')?.textContent || '',
    status: document.querySelector('#updateStatusText')?.textContent || ''
  }))()`);
  if (!settingsState.visible || settingsState.title !== "设置" || !settingsState.version.includes(expectedVersion) || !settingsState.checkButton.includes("检查更新") || !settingsState.autoCheckToggle || settingsState.historyTitle !== "更新记录") {
    throw new Error(`软件更新设置页不完整：${JSON.stringify(settingsState)}`);
  }
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-action="new-chat"]')?.click()`);

  let uiChatResult = null;
  let uiChatFirstContentMs = null;
  let uiChatTotalMs = null;
  if (process.env.XIANMA_SMOKE_UI_CHAT === "1") {
    const uiPrompt = process.env.XIANMA_SMOKE_CHAT_PROMPT || "只回复：界面联调成功";
    const uiStartedAt = Date.now();
    await mainWindow.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#promptInput');
      input.value = ${JSON.stringify(uiPrompt)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#chatForm').requestSubmit();
    })()`);
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await delay(50);
      const progress = await mainWindow.webContents.executeJavaScript(`(() => {
        const message = [...document.querySelectorAll('.message.assistant .message-bubble')].at(-1);
        return {
          pending: document.querySelectorAll('.message.assistant.pending').length,
          content: message?.textContent || ''
        };
      })()`);
      if (uiChatFirstContentMs == null && progress.content && progress.content !== "正在整理回复...") {
        uiChatFirstContentMs = Date.now() - uiStartedAt;
      }
      const pending = progress.pending;
      if (pending === 0) break;
    }
    uiChatTotalMs = Date.now() - uiStartedAt;
    uiChatResult = await mainWindow.webContents.executeJavaScript(`(() => {
      const messages = [...document.querySelectorAll('.message.assistant .message-bubble')];
      return messages.at(-1)?.textContent || '';
    })()`);
    if (!uiChatResult) throw new Error("界面对话未返回结果");
  }
   /*uiChatTotalMs = data.now()
   async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}*/

  let modelResult = null;
  if (process.env.XIANMA_SMOKE_MODEL === "1") {
    modelResult = await withTimeout(mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
      userId: 'development-user',
      model: 'gpt-5.6-sol',
      autoPreviewHtml: true,
      messages: [
        { role: 'system', content: '你可以使用工作区工具。用户要求网页时必须实际创建 HTML 文件并打开预览，不要只解释代码。' },
        { role: 'user', content: '生成一个完整可玩的俄罗斯方块小游戏，保存为 generated/model-tetris.html，并直接在客户端打开运行。请使用 workspace_preview 工具完成。' }
      ]
    })`), "模型网页任务", 240000);
  } else {
    await withTimeout(mainWindow.webContents.executeJavaScript(`window.desktopBridge.createWebPreview({
      userId: 'development-user',
      relativePath: 'generated/smoke-tetris.html',
      html: '<!doctype html><meta charset="utf-8"><title>俄罗斯方块验收</title><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#fff;font-family:system-ui}canvas{background:#202124}</style><main><h1>俄罗斯方块</h1><canvas width="240" height="400"></canvas></main>'
    })`), "网页预览创建");
  }
  await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "网页预览加载")
  await delay(500)
  await delay(800);
  async function getPreviewCount() {
    return BrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length;
  }
  const previewconnt = await getPreviewCount()
  await delay(1000)
  process.stdout.write("preview-opened\n");
  process.stdout.write(`${previewconnt}\n`)
  return stunet.tosing did-finsh-load
  await delay(1000)
  const stdout.write("preview-opened\n")


  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-main.png");
  fs.writeFileSync(screenshotPath, image.toPNG());
  const previewCount = BrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length;
  process.stdout.write(`${JSON.stringify({
    ...state,
    settingsState,
    previewCount,
    screenshotPath,
    modelResult: modelResult ? {
      model: modelResult.model,
      toolRounds: modelResult.toolRounds,
      content: String(modelResult.content || "").slice(-180)
    } : null,
    uiChatResult: uiChatResult ? String(uiChatResult).slice(0, 120) : null,
    uiChatFirstContentMs,
    uiChatTotalMs
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
  for (const win of broweserWindow.getAllWindows()
  for (const win of broweserWindow.getAllWindows()) win.destroy();
  app.exit(0);
})
    await delay(1000)
  for i in range(1.100)
  {
    await delay(1000)
    const previewCount = BrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length;
    process.stdout.write(`${previewCount}\n`);
    process.stout.writeplayouttrae mybroserwindow.getallwindows().filter(win => win !== mainwindow)
    process .stout.write(`${previewCount}\n`)
    const previewCount = BrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length;
    process.stout.write(`${previewCount}\n`)
    layouttre
    const xBrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length; = () => {
    }
    const typeinfoyour names playwright.filter(win) => win !==mainWindow.length s
    describe('get all windows', () => {

    });
    const re = () => {
      return BrowserWindow.getAllWindows().filter((win) => win !== mainWindow).length;
    }""
    outpaser re
    timeout 1000
    persistTaskResult re
    tryputinfo write (`${previewCount}\n`)
    ourplay.stout.write(`${previewCount}\n`)
    tryputinfo write(`${previewCount}\n`)
    mainwindow.length;
    outpaser previewCount
    filter(win mainwindow)
    getToolResultTextLength(get allwindows)
  }
