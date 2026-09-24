const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `computer-app-smoke-${runId}`;
const conversationId = `desktop-app-${runId}`;
const windowTitle = `Xianma Automation Test ${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-computer-app-${runId}`);
const hostScriptPath = path.join(userDataDir, "automation-host.ps1");
fs.mkdirSync(userDataDir, { recursive: true });
process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_COMPUTER_ACCESS_MODE = "confirm-dangerous";
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);

const { __test } = require("./electron/main.js");
let hostProcess = null;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`${label}超时`);
}

function callTool(mainWindow, name, args) {
  return __test.executeWorkspaceTool(userId, {
    id: `${name}-${Date.now()}`,
    function: { name, arguments: JSON.stringify(args) }
  }, null, {
    sender: mainWindow.webContents,
    userId,
    conversationId
  });
}

async function waitForConfirmation(mainWindow) {
  await waitFor(
    () => mainWindow.webContents.executeJavaScript(`!document.getElementById("computerOperationConfirmModal").classList.contains("hidden")`),
    "应用危险操作确认弹窗"
  );
}

function createAutomationHost() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = ${JSON.stringify(windowTitle)}
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(720, 420)

$heading = New-Object System.Windows.Forms.Label
$heading.Text = "Generic Windows UI automation smoke host"
$heading.Location = New-Object System.Drawing.Point(30, 20)
$heading.AutoSize = $true
$form.Controls.Add($heading)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Name = "AutomationInput"
$textBox.AccessibleName = "Automation input"
$textBox.Location = New-Object System.Drawing.Point(30, 60)
$textBox.Size = New-Object System.Drawing.Size(650, 32)
$form.Controls.Add($textBox)

$normalButton = New-Object System.Windows.Forms.Button
$normalButton.Name = "NormalAction"
$normalButton.AccessibleName = "Run action"
$normalButton.Text = "Run action"
$normalButton.Location = New-Object System.Drawing.Point(30, 120)
$normalButton.Size = New-Object System.Drawing.Size(160, 42)
$form.Controls.Add($normalButton)

$dangerButton = New-Object System.Windows.Forms.Button
$dangerButton.Name = "DangerAction"
$dangerButton.AccessibleName = "Delete test data"
$dangerButton.Text = "Delete test data"
$dangerButton.Location = New-Object System.Drawing.Point(210, 120)
$dangerButton.Size = New-Object System.Drawing.Size(180, 42)
$form.Controls.Add($dangerButton)

$status = New-Object System.Windows.Forms.Label
$status.Name = "AutomationStatus"
$status.AccessibleName = "READY"
$status.Text = "READY"
$status.Location = New-Object System.Drawing.Point(30, 190)
$status.AutoSize = $true
$form.Controls.Add($status)

$normalButton.Add_Click({ $textBox.Text = "NORMAL_CLICKED"; $status.Text = "NORMAL_CLICKED" })
$dangerButton.Add_Click({ $textBox.Text = "DANGER_CLICKED"; $status.Text = "DANGER_CLICKED" })
$form.Add_Shown({ $form.Activate() })
[System.Windows.Forms.Application]::Run($form)
`;
  fs.writeFileSync(hostScriptPath, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(script, "utf8")
  ]));
  hostProcess = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", hostScriptPath
  ], { windowsHide: false, stdio: "ignore" });
}

function stopAutomationHost() {
  if (hostProcess && hostProcess.exitCode === null) hostProcess.kill();
}

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }

  const routeChecks = await mainWindow.webContents.executeJavaScript(`({
    namedApp: shouldUseDesktopApplicationTools({ messages: [] }, { content: "打开 Photoshop" }),
    arbitraryClient: shouldUseDesktopApplicationTools({ messages: [] }, { content: "在公司的业务客户端中点击导出按钮" }),
    edgeBrowser: shouldUseDesktopApplicationTools({ messages: [] }, { content: "打开micsoft浏览器搜索胡歌图片，并且打开胡歌的图片" }),
    chromeBrowser: shouldUseDesktopApplicationTools({ messages: [] }, { content: "打开谷歌浏览器搜索胡歌图片" }),
    selectedBrowserSkill: shouldUseDesktopApplicationTools({ skillId: "browser", messages: [] }, { content: "搜索胡歌图片" }),
    browserContinuation: shouldUseDesktopApplicationTools({ messages: [{ role: "user", content: "打开浏览器进入工单中心" }] }, { content: "那你继续吧" }),
    knowledgeQuestion: shouldUseDesktopApplicationTools({ messages: [] }, { content: "中国的首都在哪里" })
  })`);
  if (!routeChecks.namedApp || !routeChecks.arbitraryClient || !routeChecks.edgeBrowser || !routeChecks.chromeBrowser || !routeChecks.selectedBrowserSkill || !routeChecks.browserContinuation || routeChecks.knowledgeQuestion) {
    throw new Error(`通用桌面应用路由判断失败：${JSON.stringify(routeChecks)}`);
  }

  const definitions = __test.toolDefinitions();
  const captureTool = definitions.find((item) => item?.function?.name === "computer_capture_app");
  const controlTool = definitions.find((item) => item?.function?.name === "computer_control_app");
  const browserOpenTool = definitions.find((item) => item?.function?.name === "computer_browser_open");
  const browserSearchTool = definitions.find((item) => item?.function?.name === "computer_browser_search");
  if (!captureTool) throw new Error("缺少应用截图工具定义");
  if (!browserOpenTool || !browserSearchTool) throw new Error("缺少浏览器打开或搜索工具定义");
  if (!controlTool?.function?.parameters?.properties?.action?.enum?.includes("click_position")) {
    throw new Error("应用控制工具缺少相对坐标点击");
  }

  createAutomationHost();
  await waitFor(async () => {
    const result = await callTool(mainWindow, "computer_list_apps", { query: windowTitle });
    return result.windows.some((item) => item.title === windowTitle);
  }, "通用测试应用窗口");

  const launch = await callTool(mainWindow, "computer_launch_app", { app: windowTitle, waitMs: 5000 });
  if (!launch.window?.handle) throw new Error("无法切换到已运行的通用应用");
  const windowHandle = launch.window.handle;

  const inspection = await callTool(mainWindow, "computer_inspect_app", {
    app: windowTitle,
    windowHandle,
    maxResults: 100
  });
  if (!inspection.controls.some((item) => item.controlType === "Edit")) throw new Error("没有读取到通用文本控件");
  if (!inspection.controls.some((item) => /Run action/i.test(item.name))) throw new Error("没有读取到通用按钮控件");

  const capture = await callTool(mainWindow, "computer_capture_app", { app: windowTitle, windowHandle });
  const capturePath = capture.capture?.path;
  if (!capturePath || !fs.existsSync(capturePath)) throw new Error("应用窗口截图没有落盘");
  const captureBytes = fs.readFileSync(capturePath);
  if (captureBytes.length < 1000 || captureBytes.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("应用窗口截图不是有效 PNG");

  await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "set_text",
    windowHandle,
    selector: { controlType: "Edit", index: 0 },
    text: "先马通用应用操作测试 1.0.3",
    purpose: "验证中文输入"
  });
  const firstRead = await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "read_text",
    windowHandle,
    selector: { controlType: "Edit", index: 0 }
  });
  if (firstRead.result?.text !== "先马通用应用操作测试 1.0.3") throw new Error("通用控件中文输入或读取失败");

  await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "click_position",
    windowHandle,
    xRatio: 0.48,
    yRatio: 0.225,
    purpose: "聚焦测试输入框"
  });
  await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "set_text",
    windowHandle,
    xRatio: 0.48,
    yRatio: 0.225,
    text: "截图坐标输入成功",
    purpose: "验证自绘界面的坐标输入后备能力"
  });
  const coordinateRead = await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "read_text",
    windowHandle,
    selector: { controlType: "Edit", index: 0 }
  });
  if (!String(coordinateRead.result?.text || "").includes("截图坐标输入成功")) {
    throw new Error(`截图坐标输入失败，实际内容：${String(coordinateRead.result?.text || "")}`);
  }

  const normalClickResult = await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "click",
    windowHandle,
    selector: { name: "Run action", controlType: "Button" },
    purpose: "执行无外部影响的测试按钮"
  });
  const normalStatus = await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "read_text",
    windowHandle,
    selector: { controlType: "Edit", index: 0 }
  });
  if (normalStatus.result?.text !== "NORMAL_CLICKED") {
    throw new Error(`普通应用点击没有生效，实际内容：${String(normalStatus.result?.text || "")}；点击结果：${JSON.stringify(normalClickResult)}`);
  }

  const deniedOperation = callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "click",
    windowHandle,
    selector: { name: "Delete test data", controlType: "Button" },
    purpose: "删除测试数据",
    commit: true
  }).then(() => ({ denied: false }), () => ({ denied: true }));
  await waitForConfirmation(mainWindow);
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-action="computer-operation-deny"]').click()`);
  if (!(await deniedOperation).denied) throw new Error("拒绝危险应用操作后仍返回成功");
  const dangerStatus = await callTool(mainWindow, "computer_control_app", {
    app: windowTitle,
    action: "read_text",
    windowHandle,
    selector: { controlType: "Edit", index: 0 }
  });
  if (dangerStatus.result?.text === "DANGER_CLICKED") throw new Error("拒绝后危险按钮仍被点击");

  const history = __test.readComputerOperationHistory(userId, 100);
  if (!history.some((item) => item.action === "computer_capture_app" && item.status === "completed")) throw new Error("审计缺少截图记录");
  if (!history.some((item) => item.action === "computer_control_app" && item.status === "denied")) throw new Error("审计缺少危险应用操作拒绝记录");

  process.stdout.write(`${JSON.stringify({
    genericWindow: true,
    genericRouting: true,
    appDiscovery: true,
    capture: true,
    inspect: true,
    chineseInput: true,
    coordinateInput: true,
    normalClick: true,
    dangerousActionDenied: true,
    auditEntries: history.length
  })}\n`);
  stopAutomationHost();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  stopAutomationHost();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
