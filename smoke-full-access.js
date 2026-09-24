const fs = require("fs");
const path = require("path");
const os = require("os");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `full-access-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-full-access-${runId}`);
const targetPath = path.join(os.tmpdir(), `xianma-full-access-${runId}.txt`);
process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_USER_DATA = userDataDir;
process.env.XIANMA_COMPUTER_ACCESS_MODE = "full";
app.setPath("userData", userDataDir);

const { __test } = require("./electron/main.js");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForWindow() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
      return window;
    }
    await delay(100);
  }
  throw new Error("主窗口创建超时");
}

async function waitFor(check, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`${label}超时`);
}

async function callWithConfirmation(mainWindow, call) {
  const pending = call();
  await waitFor(
    () => mainWindow.webContents.executeJavaScript(`!document.getElementById("computerOperationConfirmModal").classList.contains("hidden")`),
    "完整访问模式最终确认"
  );
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-action="computer-operation-allow"]').click()`);
  return pending;
}

app.whenReady().then(async () => {
  const mainWindow = await waitForWindow();
  const call = (name, args) => __test.executeWorkspaceTool(userId, {
    id: `${name}-${Date.now()}`,
    function: { name, arguments: JSON.stringify(args) }
  }, null, { sender: mainWindow.webContents, userId, conversationId: "full-access" });

  if (__test.getComputerAccessMode() !== "full") throw new Error("完全访问策略未启用");
  await call("computer_write", { path: targetPath, content: "before" });
  await callWithConfirmation(mainWindow, () => call("computer_write", { path: targetPath, content: "after", overwrite: true }));
  const commandPath = `${targetPath}.command.txt`;
  await callWithConfirmation(mainWindow, () => call("computer_run", {
    command: `Set-Content -LiteralPath ${JSON.stringify(commandPath)} -Value ${JSON.stringify("command-ok")} -Encoding UTF8`,
    cwd: os.tmpdir()
  }));
  if (fs.readFileSync(targetPath, "utf8") !== "after") throw new Error("确认后未覆盖文件");
  if (!fs.existsSync(commandPath)) throw new Error("确认后未执行命令");
  if (!__test.computerOperationPolicy({ action: "付款", target: "支付订单" }).denied) throw new Error("支付操作未被绝对禁止");
  if (!__test.computerOperationPolicy({ action: "批量删除", target: "全部记录" }).denied) throw new Error("批量删除未被绝对禁止");
  const history = __test.readComputerOperationHistory(userId, 20);
  if (!history.some((item) => item.approval === "allow-once" && item.action === "computer_write")) throw new Error("审计缺少单次允许的覆盖操作");
  if (!history.some((item) => item.approval === "allow-once" && item.action === "computer_run")) throw new Error("审计缺少单次允许的命令操作");
  process.stdout.write(`${JSON.stringify({ mode: "full", overwriteConfirmed: true, commandConfirmed: true, absoluteProhibitions: true, auditEntries: history.length })}\n`);
  fs.rmSync(targetPath, { force: true });
  fs.rmSync(commandPath, { force: true });
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
