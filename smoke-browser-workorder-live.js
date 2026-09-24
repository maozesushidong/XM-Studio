const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `workorder-live-${runId}`;
const conversationId = `workorder-live-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-workorder-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });

process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_COMPUTER_ACCESS_MODE = "full";
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);

const { __test } = require("./electron/main.js");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
      return window;
    }
    await delay(100);
  }
  throw new Error("主窗口创建超时");
}

function callTool(mainWindow, name, args) {
  return __test.executeWorkspaceTool(userId, {
    id: `${name}-${Date.now()}`,
    function: { name, arguments: JSON.stringify(args) }
  }, null, { sender: mainWindow.webContents, userId, conversationId });
}

app.whenReady().then(async () => {
  const mainWindow = await waitForMainWindow();
  const opened = await callTool(mainWindow, "computer_browser_open", {
    browser: "micsoft浏览器",
    url: "https://121.196.220.219/public/",
    newTab: true,
    waitMs: 20000
  });
  if (!opened.navigated || !opened.domControlAvailable || !opened.window?.handle) {
    throw new Error(`工单网站没有完整打开：${JSON.stringify(opened)}`);
  }

  const home = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
  if (home.source !== "browser-dom" || !home.controls.some((item) => item.name === "工单中心" && item.controlType === "Button")) {
    throw new Error("没有读取到网页内的工单中心按钮");
  }
  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "click",
    selector: { name: "工单中心", controlType: "Button" },
    purpose: "进入工单中心"
  });

  const center = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
  const scenario = center.controls.find((item) => item.name === "全部场景" && item.controlType === "ComboBox" && item.options?.includes("退货退款"));
  if (!scenario) throw new Error(`没有读取到全部场景下拉框：${JSON.stringify(center.controls.slice(0, 80))}`);
  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "set_text",
    selector: { name: "全部场景", controlType: "ComboBox" },
    text: "退货退款",
    purpose: "筛选退货退款工单"
  });

  let firstDetail = null;
  let filtered = null;
  const detailDeadline = Date.now() + 10000;
  while (Date.now() < detailDeadline && !firstDetail) {
    filtered = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
    firstDetail = filtered.controls.find((item) => /^查看 .* 详情$/.test(String(item.name || "")) && item.controlType === "Button");
    if (!firstDetail) await delay(500);
  }
  if (!firstDetail) throw new Error(`筛选后没有第一条退货退款工单：${JSON.stringify(filtered?.controls?.slice(0, 80) || [])}`);

  const beforePath = String((await callTool(mainWindow, "computer_capture_app", { app: "Microsoft Edge" })).capture?.path || "");
  const beforeHash = crypto.createHash("sha256").update(fs.readFileSync(beforePath)).digest("hex");
  const detail = await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "click",
    selector: { name: firstDetail.name, controlType: "Button" },
    purpose: "打开第一条退货退款工单"
  });
  const afterPath = String(detail.capture?.path || "");
  if (!afterPath || !fs.existsSync(afterPath)) throw new Error("打开工单后没有生成确认截图");
  const afterHash = crypto.createHash("sha256").update(fs.readFileSync(afterPath)).digest("hex");
  if (beforeHash === afterHash) throw new Error("点击第一条工单后页面画面没有变化");

  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "hotkey",
    keys: "CTRL+W",
    purpose: "关闭工单网站测试标签页"
  }).catch(() => {});

  process.stdout.write(`${JSON.stringify({
    realSite: true,
    browser: opened.browser,
    browserDomControls: true,
    enteredWorkOrderCenter: true,
    selectedScenario: "退货退款",
    openedFirstDetail: true,
    firstDetail: firstDetail.name
  })}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
