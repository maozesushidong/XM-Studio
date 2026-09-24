process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const testRoot = path.join(__dirname, "build", `smoke-image-preview-${Date.now().toString(36)}`);
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

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await waitFor(() => mainWindow.isVisible(), "主窗口显示");

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f7f8fa"/><rect x="80" y="80" width="1040" height="640" rx="12" fill="#fff" stroke="#cfd4dc"/><circle cx="300" cy="400" r="130" fill="#b7302a"/><rect x="520" y="260" width="440" height="32" fill="#3c424b"/><rect x="520" y="330" width="350" height="22" fill="#9aa1ac"/></svg>').toString("base64");
  await mainWindow.webContents.executeJavaScript(`showArtifactPreview({
    previewType: 'image',
    dataUrl: 'data:image/svg+xml;base64,${svg}',
    name: '图片预览交互测试.png',
    path: 'C:\\\\Temp\\\\图片预览交互测试.png'
  })`);
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(document.querySelector('[data-artifact-preview-image]')?.complete && document.querySelector('[data-artifact-preview-image]')?.naturalWidth)"), "图片加载");
  await delay(120);

  const initial = await mainWindow.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('[data-artifact-image-viewport]');
    const toolbar = document.querySelector('.artifact-preview-image-toolbar');
    const viewportRect = viewport.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const footerButtons = [...document.querySelectorAll('.artifact-preview-actions button')];
    const footerActions = footerButtons
      .filter((button) => getComputedStyle(button).display !== 'none')
      .map((button) => button.dataset.action);
    const toolActions = [...toolbar.querySelectorAll('button')].map((button) => button.dataset.action);
    const firstStyle = getComputedStyle(toolbar.querySelector('[data-action="artifact-image-zoom-out"]'));
    const downloadStyle = getComputedStyle(toolbar.querySelector('[data-action="artifact-download-current"]'));
    return {
      zoom: artifactImagePreviewState.zoom,
      rotation: artifactImagePreviewState.rotation,
      viewport: { left: viewportRect.left, top: viewportRect.top, width: viewportRect.width, height: viewportRect.height, bottom: viewportRect.bottom },
      toolbar: { left: toolbarRect.left, top: toolbarRect.top, width: toolbarRect.width },
      footerActions,
      footerDownloadHidden: getComputedStyle(document.querySelector('#artifactDownloadButton')).display === 'none',
      toolActions,
      downloadMatchesTools: firstStyle.backgroundColor === downloadStyle.backgroundColor && firstStyle.color === downloadStyle.color,
      contentOverflow: getComputedStyle(document.querySelector('#artifactPreviewContent')).overflow,
      imagePosition: getComputedStyle(document.querySelector('[data-artifact-preview-image]')).position
    };
  })()`);

  if (initial.toolActions.join(",") !== "artifact-image-zoom-out,artifact-image-fit,artifact-image-zoom-in,artifact-image-rotate-left,artifact-image-rotate-right,artifact-download-current") {
    throw new Error(`图片工具顺序错误：${JSON.stringify(initial)}`);
  }
  if (initial.footerActions.join(",") !== "artifact-copy-current" || !initial.footerDownloadHidden || !initial.downloadMatchesTools || initial.contentOverflow !== "hidden" || initial.imagePosition !== "absolute") {
    throw new Error(`图片预览布局错误：${JSON.stringify(initial)}`);
  }
  const toolbarCenter = initial.toolbar.left + initial.toolbar.width / 2;
  const viewportCenter = initial.viewport.left + initial.viewport.width / 2;
  if (Math.abs(toolbarCenter - viewportCenter) > 2 || initial.toolbar.top < initial.viewport.bottom) {
    throw new Error(`图片工具条未位于图片下方中央：${JSON.stringify(initial)}`);
  }

  await mainWindow.webContents.executeJavaScript("document.querySelector('[data-action=\"artifact-image-zoom-in\"]').click()");
  const afterButtonZoom = await mainWindow.webContents.executeJavaScript("artifactImagePreviewState.zoom");
  if (afterButtonZoom <= initial.zoom) throw new Error("点击加号没有放大图片");

  await mainWindow.webContents.executeJavaScript(`(() => {
    const viewport = document.querySelector('[data-artifact-image-viewport]');
    const bounds = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: bounds.left + bounds.width * .7, clientY: bounds.top + bounds.height * .5, bubbles: true, cancelable: true }));
  })()`);
  const afterWheelZoom = await mainWindow.webContents.executeJavaScript("artifactImagePreviewState.zoom");
  if (afterWheelZoom <= afterButtonZoom) throw new Error("鼠标滚轮没有放大图片");

  await mainWindow.webContents.executeJavaScript("document.querySelector('[data-action=\"artifact-image-rotate-right\"]').click()");
  const afterRotation = await mainWindow.webContents.executeJavaScript("artifactImagePreviewState.rotation");
  if (afterRotation !== 90) throw new Error("图片右旋转没有生效");

  const startX = Math.round(initial.viewport.left + initial.viewport.width / 2);
  const startY = Math.round(initial.viewport.top + initial.viewport.height / 2);
  mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: startX, y: startY });
  mainWindow.webContents.sendInputEvent({ type: "mouseDown", x: startX, y: startY, button: "left", clickCount: 1 });
  mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: startX + 70, y: startY + 45, movementX: 70, movementY: 45 });
  mainWindow.webContents.sendInputEvent({ type: "mouseUp", x: startX + 70, y: startY + 45, button: "left", clickCount: 1 });
  await delay(100);
  const afterDrag = await mainWindow.webContents.executeJavaScript("({ x: artifactImagePreviewState.x, y: artifactImagePreviewState.y, dragging: artifactImagePreviewState.dragging })");
  if (afterDrag.x < 50 || afterDrag.y < 30 || afterDrag.dragging) throw new Error(`图片拖拽没有生效：${JSON.stringify(afterDrag)}`);

  const screenshotPath = path.join(__dirname, "build", "smoke-image-preview.png");
  fs.writeFileSync(screenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  process.stdout.write(`${JSON.stringify({ initial, afterButtonZoom, afterWheelZoom, afterRotation, afterDrag, screenshotPath })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
