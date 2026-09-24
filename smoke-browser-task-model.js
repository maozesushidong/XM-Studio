const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `browser-task-${runId}`;
const conversationId = `conversation-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-browser-task-model-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);

const { __test } = require("./electron/main.js");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForWindow() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
      return window;
    }
    await delay(80);
  }
  throw new Error("主窗口创建超时");
}

app.whenReady().then(async () => {
  const mainWindow = await waitForWindow();
  const firstTaskId = `task-a-${runId}`;
  const secondTaskId = `task-b-${runId}`;
  const controller = new AbortController();
  const first = __test.registerBrowserTaskRun({ sender: mainWindow.webContents }, {
    browserAutomationTask: true,
    browserAutomationTaskId: firstTaskId,
    userId,
    conversationId,
    executionId: `execution-a-${runId}`,
    browserTaskSiteKey: "example.test",
    browserTaskCoreGoal: "填写第一条工单"
  }, controller);
  if (!first || first.taskId !== firstTaskId || first.status !== "RUNNING") throw new Error("浏览器任务没有独立任务编号");

  __test.rememberBrowserSession(userId, conversationId, firstTaskId, {
    browser: "Microsoft Edge",
    windowHandle: 1001,
    url: "https://example.test/orders/1",
    title: "第一条工单"
  });
  __test.rememberBrowserSession(userId, conversationId, secondTaskId, {
    browser: "Microsoft Edge",
    windowHandle: 2002,
    url: "https://another.test/home",
    title: "另一个站点"
  });
  if (__test.getActiveBrowserSession(userId, conversationId, firstTaskId).windowHandle !== 1001) throw new Error("同任务页面会话没有复用");
  if (__test.getActiveBrowserSession(userId, conversationId, secondTaskId).windowHandle !== 2002) throw new Error("不同任务页面会话没有隔离");

  const paused = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.pauseBrowserTask(${JSON.stringify({ userId, conversationId, taskId: firstTaskId })})`);
  if (paused.status !== "PAUSED" || !controller.signal.aborted) throw new Error("暂停没有立即停止当前浏览器执行");
  const resumed = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.resumeBrowserTask(${JSON.stringify({ userId, conversationId, taskId: firstTaskId })})`);
  if (resumed.status !== "READY" || resumed.windowHandle !== 1001 || resumed.url !== "https://example.test/orders/1") throw new Error("继续没有保留原浏览器页面上下文");

  const partialRuntime = __test.registerBrowserTaskRun({ sender: mainWindow.webContents }, {
    browserAutomationTask: true,
    browserAutomationTaskId: `task-partial-${runId}`,
    userId,
    conversationId,
    executionId: `execution-partial-${runId}`
  }, new AbortController());
  __test.recordBrowserTaskExecutionDetail({ userId, conversationId, browserAutomationTaskId: partialRuntime.taskId }, {
    action: "submit",
    target: "测试表单",
    riskConfirmation: "allow-once",
    humanControl: true,
    externalImpact: true,
    result: "completed"
  });
  partialRuntime.stopRequested = true;
  const partial = __test.finalizeBrowserTaskRun(partialRuntime, "FAILED", Object.assign(new Error("stopped"), { code: "GENERATION_STOPPED" }));
  if (partial.status !== "PARTIAL_SUCCESS" || partial.executionDetails[0].action !== "submit") throw new Error("部分成功终态或执行详情不正确");

  const uncertainRuntime = __test.registerBrowserTaskRun({ sender: mainWindow.webContents }, {
    browserAutomationTask: true,
    browserAutomationTaskId: `task-uncertain-${runId}`,
    userId,
    conversationId,
    executionId: `execution-uncertain-${runId}`
  }, new AbortController());
  __test.recordBrowserTaskExecutionDetail({ userId, conversationId, browserAutomationTaskId: uncertainRuntime.taskId }, {
    action: "publish",
    target: "发布按钮",
    riskConfirmation: "allow-once",
    humanControl: true,
    externalImpact: true,
    result: "uncertain",
    error: "页面响应中断，无法确认发布结果"
  });
  const uncertain = __test.finalizeBrowserTaskRun(uncertainRuntime, "FAILED", new Error("network interrupted"));
  if (uncertain.status !== "RESULT_UNCERTAIN" || !uncertain.executionDetails[0].error) throw new Error("状态待确认终态或异常详情不正确");

  process.stdout.write(`${JSON.stringify({ taskIsolation: true, paused: true, resumed: true, partialSuccess: true, resultUncertain: true, executionDetails: true })}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
