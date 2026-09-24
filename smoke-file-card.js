process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, clipboard, dialog } = require("electron");

const testRoot = path.join(__dirname, "build", "smoke-file-card-data");
let downloadTarget = path.join(testRoot, "downloads", "tetris-downloaded.html");
let busyDestination = "";
const originalCopyFile = fs.promises.copyFile.bind(fs.promises);
fs.promises.copyFile = async (sourcePath, destinationPath, ...rest) => {
  if (busyDestination && path.resolve(destinationPath) === path.resolve(busyDestination)) {
    const error = new Error("simulated busy destination");
    error.code = "EBUSY";
    throw error;
  }
  return originalCopyFile(sourcePath, destinationPath, ...rest);
};
fs.rmSync(testRoot, { recursive: true, force: true });
app.setPath("userData", testRoot);
app.setPath("downloads", path.join(testRoot, "downloads"));
process.env.XIANMA_USER_DATA = testRoot;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: downloadTarget });
require(process.env.XIANMA_TEST_MAIN_PATH || "./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

async function waitForMainWindow(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) return mainWindow;
    await delay(50);
  }
  throw new Error("主窗口创建超时");
}

app.whenReady().then(async () => {
  const mainWindow = await waitForMainWindow();
  if (mainWindow.webContents.isLoading()) {
    await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "页面加载");
  }
  await delay(900);

  const state = await mainWindow.webContents.executeJavaScript(`(async () => {
    const html = '<!doctype html><meta charset="utf-8"><title>俄罗斯方块</title><main><h1>俄罗斯方块</h1></main>';
    const written = await window.desktopBridge.writeWorkspaceFile({
      userId: 'file-card-smoke-user',
      relativePath: 'generated/tetris.html',
      content: html
    });
    const conversation = activeConversation();
    conversation.title = '生成俄罗斯方块';
    conversation.messages = [
      { id: createId('msg'), role: 'user', content: '做一个俄罗斯方块游戏', createdAt: new Date().toISOString() },
      {
        id: createId('msg'),
        role: 'assistant',
        content: '已完成，文件已生成并可直接打开。',
        createdAt: new Date().toISOString(),
        files: [{
          name: 'tetris.html',
          path: written.path,
          absolutePath: written.path,
          relativePath: 'generated/tetris.html',
          extension: 'html',
          kind: 'website',
          bytes: html.length
        }]
      }
    ];
    render();
    const openButton = document.querySelector('[data-message-file-open]');
    const card = openButton?.closest('.message-file-card');
    return {
      filePath: written.path,
      cardExists: Boolean(card),
      cardPath: openButton?.dataset.messageFileOpen || '',
      hoverPath: card?.dataset.absolutePath || '',
      title: card?.getAttribute('title') || '',
      cardText: card?.innerText || '',
      artifactBridges: ['previewArtifact', 'copyArtifact', 'downloadArtifact'].every((name) => typeof window.desktopBridge[name] === 'function'),
      actionButtonCount: card?.querySelectorAll('.message-file-actions button').length || 0,
      historicalWordFiles: sanitizeMessageFiles([
        { path: 'C:\\Temp\\北京天气简报.docx', name: '北京天气简报.docx' },
        { path: 'C:\\Temp\\create_beijing_weather_docx.py', name: 'create_beijing_weather_docx.py' }
      ]).map((file) => file.name),
      skillBadgeCount: document.querySelectorAll('.nav-badge').length,
      routeSimple: shouldUseFileCapabilities(conversation, { content: '中国的首都在哪里？', attachments: [] }),
      routeFile: shouldUseFileCapabilities(conversation, { content: '请生成一个新的俄罗斯方块网页游戏', attachments: [] }),
      fullAgentForFile: shouldUseFullAgentCapabilities(conversation, { content: '请生成一个新的俄罗斯方块网页游戏并预览', attachments: [] })
    };
  })()`);

  if (!state.cardExists) throw new Error("对话文件卡片未渲染");
  if (!path.isAbsolute(state.cardPath) || state.cardPath !== state.hoverPath || state.cardPath !== state.title) {
    throw new Error("文件卡片未展示一致的绝对路径");
  }
  if (!state.cardText.includes("tetris.html") || state.cardText.includes("打开方式")) throw new Error("文件卡片内容不正确");
  if (!state.artifactBridges || state.actionButtonCount !== 3) throw new Error("文件预览、复制和下载操作未完整暴露");
  if (state.historicalWordFiles.length !== 1 || state.historicalWordFiles[0] !== "北京天气简报.docx") {
    throw new Error(`历史 Word 中间脚本未隐藏：${JSON.stringify(state.historicalWordFiles)}`);
  }
  if (state.skillBadgeCount !== 0) throw new Error("技能数量标记仍然存在");
  if (state.routeSimple !== false || state.routeFile !== true || state.fullAgentForFile !== false) throw new Error("简单问答与快速文件任务路由判断错误");

  const cardCenter = await mainWindow.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('.message-file-card').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.focus();
  await delay(100);
  mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: cardCenter.x, y: cardCenter.y });
  await delay(500);
  const hoverState = await mainWindow.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.message-file-card');
    const style = getComputedStyle(card, '::after');
    const hit = document.elementFromPoint(${cardCenter.x}, ${cardCenter.y});
    return { opacity: style.opacity, content: style.content, hovered: card.matches(':hover'), hit: hit?.className || hit?.tagName || '' };
  })()`);
  if (hoverState.opacity !== "1" || !hoverState.content.includes(state.filePath.replace(/\\/g, "\\\\"))) {
    throw new Error(`悬浮绝对路径提示未显示：${JSON.stringify({ cardCenter, hoverState, filePath: state.filePath })}`);
  }
  const hoverImage = await mainWindow.webContents.capturePage();
  const hoverScreenshotPath = path.join(__dirname, "build", "smoke-file-card-hover.png");
  fs.writeFileSync(hoverScreenshotPath, hoverImage.toPNG());

  await mainWindow.webContents.executeJavaScript(`window.desktopBridge.previewArtifact(${JSON.stringify(state.filePath)})`);
  await delay(500);
  if (BrowserWindow.getAllWindows().length < 2) throw new Error("HTML 文件未打开应用内预览");

  const copyResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.copyArtifact(${JSON.stringify(state.filePath)})`);
  const clipboardFormats = clipboard.availableFormats();
  if (copyResult?.copiedAs !== "file" || !clipboardFormats.some((format) => ["FileNameW", "text/uri-list"].includes(format))) {
    throw new Error(`文件未按可粘贴格式复制：${JSON.stringify({ copyResult, formats: clipboard.availableFormats() })}`);
  }

  const downloadResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.downloadArtifact(${JSON.stringify(state.filePath)})`);
  if (downloadResult?.canceled || downloadResult?.path !== downloadTarget || !fs.existsSync(downloadTarget)) {
    throw new Error(`文件下载失败：${JSON.stringify(downloadResult)}`);
  }
  if (fs.readFileSync(downloadTarget, "utf8") !== fs.readFileSync(state.filePath, "utf8")) throw new Error("下载文件内容不一致");

  busyDestination = path.join(testRoot, "downloads", "tetris-busy.html");
  fs.writeFileSync(busyDestination, "locked old download", "utf8");
  downloadTarget = busyDestination;
  const busyDownloadResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.downloadArtifact(${JSON.stringify(state.filePath)})`);
  if (!busyDownloadResult?.renamedBecauseBusy || busyDownloadResult.path === busyDestination || !fs.existsSync(busyDownloadResult.path)) {
    throw new Error(`同名文件占用时没有自动另存：${JSON.stringify(busyDownloadResult)}`);
  }
  if (fs.readFileSync(busyDownloadResult.path, "utf8") !== fs.readFileSync(state.filePath, "utf8")) throw new Error("自动另存文件内容不一致");

  const taskDownload = await mainWindow.webContents.executeJavaScript(`(async () => {
    const task = await window.desktopBridge.createTaskResult({
      id: 'busy-docx-task',
      userId: 'file-card-smoke-user',
      skillId: 'documents',
      resultType: 'document',
      resultTitle: '占用文档验证',
      documentTitle: '占用文档验证',
      resultText: '# 验证结果\\n\\n- 文档内容完整。',
      outputFormat: 'docx'
    });
    return { taskId: task.id, primaryPath: task.primaryPath };
  })()`);
  const busyDocxDestination = path.join(testRoot, "downloads", path.basename(taskDownload.primaryPath));
  fs.writeFileSync(busyDocxDestination, "locked old document", "utf8");
  busyDestination = busyDocxDestination;
  const busyTaskDownloadResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.downloadTaskResult({ taskId: ${JSON.stringify("busy-docx-task")}, userId: ${JSON.stringify("file-card-smoke-user")} })`);
  if (!busyTaskDownloadResult?.renamedBecauseBusy || busyTaskDownloadResult.path === busyDocxDestination || !fs.existsSync(busyTaskDownloadResult.path)) {
    throw new Error(`同名 DOCX 占用时没有自动另存：${JSON.stringify(busyTaskDownloadResult)}`);
  }
  if (fs.readFileSync(busyTaskDownloadResult.path).subarray(0, 2).toString("ascii") !== "PK") throw new Error("自动另存的 DOCX 文件无效");

  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-file-card.png");
  fs.writeFileSync(screenshotPath, image.toPNG());
  process.stdout.write(`${JSON.stringify({
    fileCard: true,
    absolutePathHover: true,
    appPreview: true,
    fileCopy: true,
    fileDownload: true,
    busyDownloadFallback: true,
    busyDocxTaskDownloadFallback: true,
    smartRouting: true,
    screenshotPath,
    hoverScreenshotPath
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
