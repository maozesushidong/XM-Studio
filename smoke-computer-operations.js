const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `computer-smoke-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-computer-operations-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_COMPUTER_ACCESS_MODE = "confirm-dangerous";
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);
const { __test } = require("./electron/main.js");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`${label}超时`);
}

async function startRendererOperation(window, expression) {
  await window.webContents.executeJavaScript(`
    window.__computerSmokeResult = null;
    window.__computerSmokeError = null;
    Promise.resolve(${expression})
      .then((value) => { window.__computerSmokeResult = value || { ok: true }; })
      .catch((error) => { window.__computerSmokeError = String(error && error.message || error); });
    true;
  `);
}

async function waitForConfirmation(window) {
  await waitFor(
    () => window.webContents.executeJavaScript(`!document.getElementById("computerOperationConfirmModal").classList.contains("hidden")`),
    "危险操作确认弹窗"
  );
  return window.webContents.executeJavaScript(`({
    title: document.getElementById("computerOperationConfirmTitle").textContent,
    target: document.getElementById("computerOperationConfirmTarget").textContent,
    command: document.getElementById("computerOperationConfirmCommand").textContent
  })`);
}

async function resolveConfirmation(window, action) {
  await window.webContents.executeJavaScript(`document.querySelector('[data-action="${action}"]').click()`);
  await waitFor(
    () => window.webContents.executeJavaScript(`Boolean(window.__computerSmokeResult || window.__computerSmokeError)`),
    "操作确认结果"
  );
  return window.webContents.executeJavaScript(`({ result: window.__computerSmokeResult, error: window.__computerSmokeError })`);
}

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }

  const workspace = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getUserWorkspace({ userId: ${JSON.stringify(userId)} })`);
  const relativePath = `computer-operation-${runId}.txt`;
  const targetPath = path.join(workspace.rootPath, relativePath);
  const commandTargetPath = path.join(workspace.rootPath, `command-operation-${runId}.txt`);
  const computerRoots = [path.join(os.tmpdir(), `xianma-computer-${runId}`)];
  if (fs.existsSync("D:\\")) computerRoots.push(path.join("D:\\", `xianma-computer-${runId}`));
  const callComputerTool = (name, args, conversationId) => __test.executeWorkspaceTool(userId, {
    id: `${name}-${Date.now()}`,
    function: { name, arguments: JSON.stringify(args) }
  }, null, { sender: mainWindow.webContents, userId, conversationId });

  for (const rootPath of computerRoots) {
    const absoluteFilePath = path.join(rootPath, "absolute-path-proof.txt");
    const copiedFilePath = path.join(rootPath, "absolute-path-copy.txt");
    await callComputerTool("computer_write", { path: absoluteFilePath, content: "绝对路径能力验证" }, `write-${path.parse(rootPath).root}`);
    const readResult = await callComputerTool("computer_read", { path: absoluteFilePath }, `read-${path.parse(rootPath).root}`);
    if (readResult.content !== "绝对路径能力验证") throw new Error(`绝对路径读取失败：${rootPath}`);
    const searchResult = await callComputerTool("computer_search", { path: rootPath, query: "absolute-path-proof" }, `search-${path.parse(rootPath).root}`);
    if (!searchResult.results.some((item) => path.resolve(item.path) === path.resolve(absoluteFilePath))) throw new Error(`绝对路径搜索失败：${rootPath}`);
    await callComputerTool("computer_copy", { sourcePath: absoluteFilePath, targetPath: copiedFilePath }, `copy-${path.parse(rootPath).root}`);
    if (!fs.existsSync(copiedFilePath)) throw new Error(`绝对路径复制失败：${rootPath}`);

    const deniedDeletePromise = callComputerTool("computer_delete", { path: absoluteFilePath }, `deny-delete-${path.parse(rootPath).root}`)
      .then(() => ({ denied: false }), () => ({ denied: true }));
    await waitForConfirmation(mainWindow);
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-action="computer-operation-deny"]').click()`);
    if (!(await deniedDeletePromise).denied) throw new Error("取消删除后操作仍成功");
    if (!fs.existsSync(absoluteFilePath)) throw new Error(`取消删除后文件消失：${rootPath}`);

    const allowedDeletePromise = callComputerTool("computer_delete", { path: absoluteFilePath }, `allow-delete-${path.parse(rootPath).root}`);
    await waitForConfirmation(mainWindow);
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-action="computer-operation-allow"]').click()`);
    await allowedDeletePromise;
    if (fs.existsSync(absoluteFilePath)) throw new Error(`允许删除后文件仍存在：${rootPath}`);
    fs.rmSync(rootPath, { recursive: true, force: true });
  }

  await mainWindow.webContents.executeJavaScript(`window.desktopBridge.writeWorkspaceFile({
    userId: ${JSON.stringify(userId)},
    conversationId: "new-file",
    relativePath: ${JSON.stringify(relativePath)},
    content: "初始内容"
  })`);
  if (fs.readFileSync(targetPath, "utf8") !== "初始内容") throw new Error("普通新建文件失败");

  await startRendererOperation(mainWindow, `window.desktopBridge.writeWorkspaceFile({
    userId: ${JSON.stringify(userId)},
    conversationId: "deny-overwrite",
    relativePath: ${JSON.stringify(relativePath)},
    content: "不应写入"
  })`);
  const deniedOverwrite = await waitForConfirmation(mainWindow);
  if (!deniedOverwrite.target.includes(relativePath)) throw new Error("覆盖确认未展示目标路径");
  const deniedOverwriteResult = await resolveConfirmation(mainWindow, "computer-operation-deny");
  if (!deniedOverwriteResult.error) throw new Error("取消覆盖后操作没有被拒绝");
  if (fs.readFileSync(targetPath, "utf8") !== "初始内容") throw new Error("取消覆盖后文件仍被修改");

  await startRendererOperation(mainWindow, `window.desktopBridge.writeWorkspaceFile({
    userId: ${JSON.stringify(userId)},
    conversationId: "allow-overwrite",
    relativePath: ${JSON.stringify(relativePath)},
    content: "允许后的内容"
  })`);
  await waitForConfirmation(mainWindow);
  const allowedOverwriteResult = await resolveConfirmation(mainWindow, "computer-operation-allow");
  if (allowedOverwriteResult.error) throw new Error(allowedOverwriteResult.error);
  if (fs.readFileSync(targetPath, "utf8") !== "允许后的内容") throw new Error("允许覆盖后文件没有更新");

  const command = `Set-Content -LiteralPath ${JSON.stringify(commandTargetPath)} -Value ${JSON.stringify("命令已执行")} -Encoding UTF8`;
  await startRendererOperation(mainWindow, `window.desktopBridge.runWorkspaceCommand({
    userId: ${JSON.stringify(userId)},
    conversationId: "deny-command",
    command: ${JSON.stringify(command)}
  })`);
  const deniedCommand = await waitForConfirmation(mainWindow);
  if (!deniedCommand.command.includes("Set-Content")) throw new Error("命令确认未展示命令摘要");
  await resolveConfirmation(mainWindow, "computer-operation-deny");
  if (fs.existsSync(commandTargetPath)) throw new Error("取消命令后仍创建了文件");

  await startRendererOperation(mainWindow, `window.desktopBridge.runWorkspaceCommand({
    userId: ${JSON.stringify(userId)},
    conversationId: "allow-command",
    command: ${JSON.stringify(command)}
  })`);
  await waitForConfirmation(mainWindow);
  const allowedCommand = await resolveConfirmation(mainWindow, "computer-operation-allow");
  if (allowedCommand.error) throw new Error(allowedCommand.error);
  if (!fs.existsSync(commandTargetPath)) throw new Error("允许命令后没有创建文件");

  const history = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getComputerOperationHistory({ userId: ${JSON.stringify(userId)}, limit: 20 })`);
  if (!history.some((item) => item.action === "computer_write" && item.status === "denied")) throw new Error("审计缺少覆盖拒绝记录");
  if (!history.some((item) => item.action === "computer_write" && item.status === "completed")) throw new Error("审计缺少覆盖完成记录");
  if (!history.some((item) => item.action === "computer_run" && item.status === "denied")) throw new Error("审计缺少命令拒绝记录");
  if (!history.some((item) => item.action === "computer_run" && item.status === "completed")) throw new Error("审计缺少命令完成记录");

  process.stdout.write(`${JSON.stringify({ absolutePaths: computerRoots.length, newFile: true, deniedOverwrite: true, allowedOverwrite: true, deniedCommand: true, allowedCommand: true, auditEntries: history.length })}\n`);
  fs.rmSync(targetPath, { force: true });
  fs.rmSync(commandTargetPath, { force: true });
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
