process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const testRoot = path.join(__dirname, "build", `smoke-window-layout-${Date.now().toString(36)}`);
fs.rmSync(testRoot, { recursive: true, force: true });
app.setPath("userData", testRoot);
process.env.XIANMA_USER_DATA = testRoot;
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`${label}超时`);
}

async function readLayout(mainWindow) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const appWindow = document.querySelector('.window');
    const composer = document.querySelector('#chatForm');
    const input = document.querySelector('#promptInput');
    const windowRect = appWindow.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const closeButton = document.querySelector('[data-window-action="close"]');
    const closeRect = closeButton.getBoundingClientRect();
    const probeX = Math.round(inputRect.left + Math.min(80, inputRect.width / 3));
    const probeY = Math.round(inputRect.top + Math.min(18, inputRect.height / 3));
    const hit = document.elementFromPoint(probeX, probeY);
    const windowStyle = getComputedStyle(appWindow);
    const composerStyle = getComputedStyle(composer);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      windowRect: {
        left: windowRect.left,
        top: windowRect.top,
        right: windowRect.right,
        bottom: windowRect.bottom,
        width: windowRect.width,
        height: windowRect.height
      },
      composerRect: { top: composerRect.top, height: composerRect.height },
      inputRect: {
        left: inputRect.left,
        top: inputRect.top,
        width: inputRect.width,
        height: inputRect.height
      },
      probe: { x: probeX, y: probeY, hitId: hit?.id || '', hitTag: hit?.tagName || '' },
      bodyOverflow: getComputedStyle(document.body).overflow,
      borderRadius: windowStyle.borderRadius,
      boxShadow: windowStyle.boxShadow,
      composerRows: composerStyle.gridTemplateRows,
      controls: [...document.querySelectorAll('[data-window-action]')].map((button) => button.dataset.windowAction),
      closeButton: { right: closeRect.right, width: closeRect.width, top: closeRect.top },
      adminConnectionUi: {
        settingsActions: document.querySelectorAll('[data-action="settings"], [data-action="close-settings"], [data-action="save-settings"]').length,
        settingsModal: Boolean(document.querySelector('#settingsModal')),
        connectionPill: Boolean(document.querySelector('#connectionPill')),
        leakedLabels: ['连接设置', '企业模型与应用设置', '企业模型服务不可用时使用本地演示回复']
          .filter((label) => document.body.innerText.includes(label))
      },
      bridgeReady: typeof window.desktopBridge?.controlWindow === 'function' && typeof window.desktopBridge?.getWindowState === 'function'
    };
  })()`);
}

function assertWindowCoversViewport(layout, label) {
  const { windowRect: rect, viewport } = layout;
  const tolerance = 1;
  if (
    Math.abs(rect.left) > tolerance ||
    Math.abs(rect.top) > tolerance ||
    Math.abs(rect.right - viewport.width) > tolerance ||
    Math.abs(rect.bottom - viewport.height) > tolerance
  ) {
    throw new Error(`${label}时应用内容未覆盖视口：${JSON.stringify(layout)}`);
  }
}
app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow.webContents.isLoading()) {
    await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  }
  await waitFor(() => mainWindow.isVisible(), "主窗口显示");
  await waitFor(() => mainWindow.isMaximized(), "主窗口默认最大化");
  await delay(300);
  const maximizedLayout = await readLayout(mainWindow);
  assertWindowCoversViewport(maximizedLayout, "最大化");
  if (maximizedLayout.borderRadius !== "0px" || maximizedLayout.boxShadow !== "none" || maximizedLayout.bodyOverflow !== "hidden") {
    throw new Error(`主画布仍存在外围装饰或滚动：${JSON.stringify(maximizedLayout)}`);
  }
  if (!maximizedLayout.bridgeReady || maximizedLayout.controls.join(",") !== "minimize,toggle-maximize,close") {
    throw new Error(`窗口控制未完整接通：${JSON.stringify(maximizedLayout.controls)}`);
  }
  if (Math.abs(maximizedLayout.closeButton.right - maximizedLayout.viewport.width) > 1 || maximizedLayout.closeButton.width < 40 || Math.abs(maximizedLayout.closeButton.top) > 1) {
    throw new Error(`窗口控制没有位于右上角：${JSON.stringify(maximizedLayout.closeButton)}`);
  }
  if (maximizedLayout.inputRect.height < 50 || maximizedLayout.probe.hitId !== "promptInput") {
    throw new Error(`输入框上部不可编辑：${JSON.stringify(maximizedLayout)}`);
  }
  if (
    maximizedLayout.adminConnectionUi.settingsActions !== 0
    || maximizedLayout.adminConnectionUi.settingsModal
    || maximizedLayout.adminConnectionUi.connectionPill
    || maximizedLayout.adminConnectionUi.leakedLabels.length
  ) {
    throw new Error(`前端仍暴露连接设置信息：${JSON.stringify(maximizedLayout.adminConnectionUi)}`);
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  const { x, y } = maximizedLayout.probe;
  mainWindow.webContents.sendInputEvent({ type: "mouseMove", x, y });
  mainWindow.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  mainWindow.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await delay(100);
  await mainWindow.webContents.insertText("顶部输入验证");
  const inputState = await mainWindow.webContents.executeJavaScript(`(() => ({
    activeId: document.activeElement?.id || '',
    value: document.querySelector('#promptInput')?.value || ''
  }))()`);
  if (inputState.activeId !== "promptInput" || inputState.value !== "顶部输入验证") {
    throw new Error(`顶部点击输入失败：${JSON.stringify(inputState)}`);
  }
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#maximizeButton').click()`);
  await waitFor(() => !mainWindow.isMaximized(), "窗口还原");
  const restoredLayout = await readLayout(mainWindow);
  assertWindowCoversViewport(restoredLayout, "还原");
  await delay(200);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#maximizeButton').click()`);
  await waitFor(() => mainWindow.isMaximized(), "窗口再次最大化");
  await delay(200);
  const finalState = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getWindowState()`);
  if (!finalState?.maximized) throw new Error("最大化状态未同步到渲染层");

  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-window-layout.png");
  fs.writeFileSync(screenshotPath, image.toPNG());

  const composerMenuState = await mainWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="toggle-composer-menu"]')?.click();
    const menu = document.querySelector('#composerMenu');
    const options = [...document.querySelectorAll('[data-menu-skill]')].map((item) => ({
      id: item.dataset.menuSkill,
      label: item.querySelector('strong')?.textContent?.trim() || ''
    }));
    return {
      open: Boolean(menu && !menu.classList.contains('hidden')),
      options,
      browserCount: options.filter((item) => item.id === 'browser' && item.label === '浏览器操作').length
    };
  })()`);
  if (!composerMenuState.open || composerMenuState.browserCount !== 1) {
    throw new Error(`浏览器操作未唯一显示在对话技能选择器：${JSON.stringify(composerMenuState)}`);
  }
  await delay(100);
  const composerMenuImage = await mainWindow.webContents.capturePage();
  const composerMenuScreenshotPath = path.join(__dirname, "build", "smoke-browser-skill-menu.png");
  fs.writeFileSync(composerMenuScreenshotPath, composerMenuImage.toPNG());

  const settingsGuideState = await mainWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-view="settings"]')?.click();
    return {
      hasGuide: Boolean(document.querySelector('#operationGuideTitle')),
      hasReleaseNotes: Boolean(document.querySelector('#releaseNotesTitle')),
      browserGuide: [...document.querySelectorAll('.settings-guide-item strong')].some((item) => item.textContent.trim() === '浏览器操作')
    };
  })()`);
  if (!settingsGuideState.hasGuide || settingsGuideState.hasReleaseNotes || !settingsGuideState.browserGuide) {
    throw new Error(`设置页操作说明展示错误：${JSON.stringify(settingsGuideState)}`);
  }
  await delay(100);
  const settingsGuideImage = await mainWindow.webContents.capturePage();
  const settingsGuideScreenshotPath = path.join(__dirname, "build", "smoke-operation-guide.png");
  fs.writeFileSync(settingsGuideScreenshotPath, settingsGuideImage.toPNG());
  process.stdout.write(`${JSON.stringify({
    defaultMaximized: true,
    viewportCovered: true,
    topComposerInput: true,
    adminConnectionUiHidden: true,
    windowControls: true,
    restoredViewportCovered: true,
    screenshotPath,
    composerMenuState,
    composerMenuScreenshotPath,
    settingsGuideState,
    settingsGuideScreenshotPath,
    screenshotSize: image.getSize()
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
