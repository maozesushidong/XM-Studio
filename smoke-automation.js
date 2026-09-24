"use strict";

process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_ENABLE_TELEMETRY = "0";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const testRoot = path.join(__dirname, "build", `smoke-automation-${Date.now().toString(36)}`);
const configPath = path.join(testRoot, "ai-config.json");
fs.mkdirSync(testRoot, { recursive: true });
app.setPath("userData", testRoot);
process.env.XIANMA_USER_DATA = testRoot;
let modelCalls = 0;
let pausePromptCalls = 0;
let pauseRequestStarted = false;
let pauseRequestAborted = false;
let mainModule = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`${label}超时`);
}

function cleanup(code) {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  mockServer.closeAllConnections?.();
  mockServer.close();
  try { fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 }); } catch {}
  app.exit(code);
  setTimeout(() => process.exit(code), 80);
}

const mockServer = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/v1/images/generations") {
    let input = "";
    request.on("data", chunk => { input += chunk; });
    request.on("end", () => {
      if (JSON.parse(input).model !== "gpt-image-1.5") { response.writeHead(400); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=" }] }));
    });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end();
    return;
  }
  let rawBody = "";
  request.on("data", (chunk) => { rawBody += chunk; });
  request.on("end", () => {
    modelCalls += 1;
    const payload = JSON.parse(rawBody || "{}");
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const prompt = String(messages.at(-1)?.content || "");
    if (prompt.includes("等待暂停后继续") && pausePromptCalls++ === 0) {
      pauseRequestStarted = true;
      response.on("close", () => {
        if (!response.writableEnded) pauseRequestAborted = true;
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      choices: [{ message: { content: `自动化执行完成：${prompt.slice(0, 80)}` } }]
    }));
  });
});

async function invokeBridge(mainWindow, method, payload) {
  return mainWindow.webContents.executeJavaScript(`window.desktopBridge[${JSON.stringify(method)}](${JSON.stringify(payload)})`);
}

async function run() {
  await app.whenReady();
  let mainWindow = null;
  await waitFor(() => {
    mainWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("renderer/index.html"));
    return Boolean(mainWindow);
  }, "主窗口创建");
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(state.session?.userId)"), "开发登录");

  const ui = await mainWindow.webContents.executeJavaScript(`(() => {
    state.modelOptions = [
      { label: 'Auto 自动选择', value: 'auto' },
      { label: '5.6 Luna', value: 'gpt-5.6-luna' },
      ...Array.from({ length: 16 }, (_, index) => ({ label: '测试模型 ' + (index + 1), value: 'test-model-' + (index + 1) }))
    ];
    skills = [
      ...skills,
      ...Array.from({ length: 14 }, (_, index) => ({
        id: 'automation-test-skill-' + (index + 1),
        name: '自动化测试技能 ' + (index + 1),
        description: '用于验证长技能列表滚动与搜索',
        icon: 'sparkles',
        userInvocable: true
      }))
    ];
    showView('scheduled');
    const navText = document.querySelector('[data-nav="scheduled"]')?.innerText || '';
    document.querySelector('[data-action="new-automation"]')?.click();
    document.querySelector('[data-automation-picker-toggle="model"]')?.click();
    const modelSearch = document.querySelector('[data-automation-picker-search="model"]');
    const modelList = document.querySelector('[data-automation-picker-options="model"]');
    const modelListStyle = getComputedStyle(modelList);
    const modelListOverflow = modelListStyle.overflowY;
    const modelListMaxHeight = parseFloat(modelListStyle.maxHeight);
    const modelScrolls = modelList.scrollHeight > modelList.clientHeight;
    modelSearch.value = 'Luna';
    modelSearch.dispatchEvent(new Event('input', { bubbles: true }));
    const filteredModelLabels = [...document.querySelectorAll('[data-automation-picker-option="model"]')].map((item) => item.innerText);
    document.querySelector('[data-automation-picker-option="model"][data-value="gpt-5.6-luna"]')?.click();
    const selectedModel = automationEditorDraft.model;
    document.querySelector('[data-automation-picker-toggle="skillId"]')?.click();
    const skillSearch = document.querySelector('[data-automation-picker-search="skillId"]');
    const skillList = document.querySelector('[data-automation-picker-options="skillId"]');
    const skillListStyle = getComputedStyle(skillList);
    const skillListOverflow = skillListStyle.overflowY;
    const skillListMaxHeight = parseFloat(skillListStyle.maxHeight);
    const skillOptionCount = document.querySelectorAll('[data-automation-picker-option="skillId"]').length;
    const skillScrolls = skillList.scrollHeight > skillList.clientHeight;
    skillSearch.value = '自动化测试技能 12';
    skillSearch.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-automation-picker-option="skillId"][data-value="automation-test-skill-12"]')?.click();
    const selectedSkill = automationEditorDraft.skillId;
    document.querySelector('[data-automation-picker-toggle="skillId"]')?.click();
    document.querySelector('.automation-editor-header h1')?.click();
    const closesOutside = !document.querySelector('.automation-picker-popover');
    document.querySelector('[data-automation-picker-toggle="skillId"]')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const closesWithEscape = !document.querySelector('.automation-picker-popover');
    document.querySelector('[data-automation-picker-toggle="skillId"]')?.click();
    return {
      navText,
      title: document.querySelector('.automation-editor-header h1')?.innerText || '',
      frequencyLabels: [...document.querySelectorAll('[data-automation-frequency]')].map((item) => item.innerText),
      hasWorkspace: Boolean(document.querySelector('[data-automation-field="workspacePath"]')),
      pickerCount: document.querySelectorAll('[data-automation-picker]').length,
      nativeCapabilitySelects: document.querySelectorAll('.automation-capabilities select').length,
      modelSearchVisible: Boolean(modelSearch),
      modelListOverflow,
      modelListMaxHeight,
      modelScrolls,
      filteredModelLabels,
      selectedModel,
      skillSearchVisible: Boolean(skillSearch),
      skillListOverflow,
      skillListMaxHeight,
      skillOptionCount,
      skillScrolls,
      selectedSkill,
      closesOutside,
      closesWithEscape,
      hasFullAccess: document.body.innerText.includes('完整本机能力'),
      unsupportedFeatures: ['召唤专家', '连接器'].filter((label) => document.body.innerText.includes(label))
    };
  })()`);
  if (ui.navText.trim() !== "定时任务" || ui.title !== "新建任务" || ui.frequencyLabels.join(",") !== "单次,每天,每周") {
    throw new Error(`自动化界面不完整：${JSON.stringify(ui)}`);
  }
  if (!ui.hasWorkspace || ui.pickerCount !== 2 || ui.nativeCapabilitySelects !== 0 || ui.unsupportedFeatures.length) {
    throw new Error(`自动化字段不符合要求：${JSON.stringify(ui)}`);
  }
  if (!ui.modelSearchVisible || ui.modelListOverflow !== "auto" || ui.modelListMaxHeight > 260 || !ui.modelScrolls || ui.filteredModelLabels.length !== 1 || !ui.filteredModelLabels[0].includes("5.6 Luna") || ui.selectedModel !== "gpt-5.6-luna") {
    throw new Error(`模型选择器交互错误：${JSON.stringify(ui)}`);
  }
  if (!ui.skillSearchVisible || ui.skillListOverflow !== "auto" || ui.skillListMaxHeight > 260 || ui.skillOptionCount <= 10 || !ui.skillScrolls || ui.selectedSkill !== "automation-test-skill-12" || !ui.closesOutside || !ui.closesWithEscape) {
    throw new Error(`技能选择器交互错误：${JSON.stringify(ui)}`);
  }

  const pickerScreenshotPath = path.join(__dirname, "build", "smoke-automation-picker.png");
  await delay(80);
  const pickerLayout = await mainWindow.webContents.executeJavaScript(`(() => {
    const picker = document.querySelector('[data-automation-picker="skillId"]');
    const trigger = picker?.querySelector('[data-automation-picker-toggle]');
    const popover = picker?.querySelector('.automation-picker-popover');
    return {
      triggerTop: trigger?.getBoundingClientRect().top || 0,
      popoverTop: popover?.getBoundingClientRect().top || 0,
      popoverBottom: popover?.getBoundingClientRect().bottom || 0,
      viewportHeight: window.innerHeight
    };
  })()`);
  const pickerFitsViewport = pickerLayout.popoverTop >= 8
    && pickerLayout.popoverBottom <= pickerLayout.viewportHeight - 8
    && pickerLayout.popoverTop < pickerLayout.triggerTop;
  if (!pickerFitsViewport) {
    throw new Error(`选择器超出可见窗口：${JSON.stringify(pickerLayout)}`);
  }
  fs.writeFileSync(pickerScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  await mainWindow.webContents.executeJavaScript("closeAutomationPicker()");

  const userId = "development-user";
  const common = {
    name: "自动化测试",
    workspacePath: "",
    prompt: "整理自动化测试结果",
    model: "auto",
    skillId: "",
    skillName: "",
    skillSystemPrompt: "",
    enabled: true,
    startDate: "",
    endDate: ""
  };
  const daily = await invokeBridge(mainWindow, "saveAutomation", { userId, task: { ...common, name: "每日自动化", frequency: "daily", time: "23:59" } });
  const weekly = await invokeBridge(mainWindow, "saveAutomation", { userId, task: { ...common, name: "每周自动化", frequency: "weekly", time: "09:00", weekdays: [1, 3, 5] } });
  const interval = await invokeBridge(mainWindow, "saveAutomation", { userId, task: { ...common, name: "间隔自动化", frequency: "interval", intervalHours: 2, weekdays: [1, 2, 3, 4, 5, 6, 7] } });
  const once = await invokeBridge(mainWindow, "saveAutomation", { userId, task: { ...common, name: "单次自动化", frequency: "once", runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() } });
  const createdTasks = [daily.task, weekly.task, interval.task, once.task];
  if (createdTasks.some((task) => !task?.id || !task.nextRunAt) || interval.task.intervalHours !== 2) {
    throw new Error(`自动化调度时间错误：${JSON.stringify(createdTasks)}`);
  }

  const manualResult = await invokeBridge(mainWindow, "runAutomationNow", { userId, taskId: daily.task.id });
  if (manualResult.task.nextRunAt !== daily.task.nextRunAt) throw new Error("手动运行修改了计划时间");
  const manualOnce = await invokeBridge(mainWindow, "runAutomationNow", { userId, taskId: once.task.id });
  if (!manualOnce.task.enabled || manualOnce.task.nextRunAt !== once.task.nextRunAt) throw new Error("提前手动运行消耗了单次计划");
  if (manualResult?.record?.status !== "已完成" || !manualResult.record.resultText.includes("自动化执行完成")) {
    throw new Error(`立即执行没有生成真实结果：${JSON.stringify(manualResult)}`);
  }

  const pausable = await invokeBridge(mainWindow, "saveAutomation", {
    userId,
    task: { ...common, name: "可暂停自动化", prompt: "等待暂停后继续", frequency: "daily", time: "23:58" }
  });
  const pauseRunPromise = invokeBridge(mainWindow, "runAutomationNow", { userId, taskId: pausable.task.id });
  await waitFor(() => (
    pauseRequestStarted
    && mainModule.__test.readTaskStore(userId).scheduledTasks.find((task) => task.id === pausable.task.id)?.status === "运行中"
  ), "自动化进入运行状态");
  await mainWindow.webContents.executeJavaScript(`(async () => { await refreshWorkData({ silent: true }); showView('scheduled'); })()`);
  const runningPauseUi = await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector('[data-automation-pause="${pausable.task.id}"]'))`);
  if (!runningPauseUi) throw new Error("运行中的自动化没有显示暂停按钮");
  const pauseScreenshotPath = path.join(__dirname, "build", "smoke-automation-pause.png");
  fs.writeFileSync(pauseScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());

  const pauseResult = await invokeBridge(mainWindow, "pauseAutomation", { userId, taskId: pausable.task.id });
  const pausedRunResult = await pauseRunPromise;
  await waitFor(() => pauseRequestAborted, "自动化请求中止");
  const pausedTask = mainModule.__test.readTaskStore(userId).scheduledTasks.find((task) => task.id === pausable.task.id);
  if (!pauseResult?.paused || !pausedRunResult?.paused || pausedRunResult.record?.status !== "已暂停" || pausedTask?.status !== "已暂停" || pausedTask?.enabled !== false || pausedTask?.nextRunAt) {
    throw new Error(`自动化暂停状态错误：${JSON.stringify({ pauseResult, pausedRunResult, pausedTask })}`);
  }

  await mainWindow.webContents.executeJavaScript(`(async () => { await refreshWorkData({ silent: true }); showView('scheduled'); })()`);
  const pausedUi = await mainWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector('[data-automation-run="${pausable.task.id}"]'); return { title: button?.title || '', text: button?.closest('.automation-card')?.innerText || '' }; })()`);
  if (pausedUi.title !== "继续执行" || !pausedUi.text.includes("已暂停")) throw new Error(`暂停后的界面状态错误：${JSON.stringify(pausedUi)}`);

  const resumedResult = await invokeBridge(mainWindow, "runAutomationNow", { userId, taskId: pausable.task.id });
  if (resumedResult?.record?.status !== "已完成" || pausePromptCalls !== 2) throw new Error(`暂停任务继续执行失败：${JSON.stringify(resumedResult)}`);

  const background = await invokeBridge(mainWindow, "saveAutomation", {
    userId,
    task: { ...common, name: "托盘后台自动化", prompt: "验证托盘后台自动化", frequency: "once", runAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }
  });
  await mainModule.__test.automationSchedulerTick();
  const store = mainModule.__test.readTaskStore(userId);
  const dueTask = store.scheduledTasks.find((task) => task.id === background.task.id);
  dueTask.nextRunAt = new Date(Date.now() - 1000).toISOString();
  mainModule.__test.writeTaskStore(userId, store);

  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-window-action="close"]').click()`);
  await waitFor(() => !mainWindow.isVisible(), "窗口隐藏到托盘");
  const hiddenState = mainModule.__test.getAutomationDesktopState();
  if (!hiddenState.schedulerActive || !hiddenState.trayActive || hiddenState.primaryWindowVisible) {
    throw new Error(`托盘后台状态错误：${JSON.stringify(hiddenState)}`);
  }

  await mainModule.__test.automationSchedulerTick();
  await waitFor(() => mainModule.__test.readTaskStore(userId).taskRuns.some((run) => run.automationId === background.task.id && run.status === "已完成"), "托盘任务执行");
  mainModule.__test.showPrimaryWindow();
  await waitFor(() => mainWindow.isVisible(), "从托盘恢复窗口");
  await invokeBridge(mainWindow, "getWorkData", { userId });
  const missedStore = mainModule.__test.readTaskStore(userId);
  const missedTask = missedStore.scheduledTasks.find(task => task.id === weekly.task.id);
  missedTask.nextRunAt = new Date(Date.now() - 300000).toISOString();
  mainModule.__test.writeTaskStore(userId, missedStore);
  const beforeMissed = modelCalls;
  await mainModule.__test.automationSchedulerTick();
  if (modelCalls !== beforeMissed || mainModule.__test.readTaskStore(userId).scheduledTasks.find(task => task.id === missedTask.id).status !== "已错过") throw new Error("错过的任务被自动补跑");
  const imageTask = await invokeBridge(mainWindow, "saveAutomation", { userId, task: { ...common, name: "图片模型定时任务", model: "gpt-image-1.5", frequency: "daily", time: "23:55" } });
  const imageRun = await invokeBridge(mainWindow, "runAutomationNow", { userId, taskId: imageTask.task.id });
  if (imageRun.record.status !== "已完成" || !imageRun.record.artifacts.length || !fs.existsSync(imageRun.record.artifacts[0].path)) throw new Error("图片任务未使用所选模型生成并保存图片");
  const rendered = await mainWindow.webContents.executeJavaScript(`(async () => {
    await refreshWorkData({ silent: true });
    showView('scheduled');
    return {
      taskCards: document.querySelectorAll('.automation-card').length,
      recentResults: document.querySelectorAll('[data-open-task-run]').length,
      pageText: document.querySelector('#pageContent')?.innerText || ''
    };
  })()`);
  if (rendered.taskCards !== 7 || rendered.recentResults < 4 || !rendered.pageText.includes("托盘后台自动化")) {
    throw new Error(`自动化列表或结果未同步：${JSON.stringify(rendered)}`);
  }

  const screenshotPath = path.join(__dirname, "build", "smoke-automation.png");
  fs.writeFileSync(screenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  process.stdout.write(`${JSON.stringify({
    automation: true,
    schedules: createdTasks.map((task) => task.frequency),
    modelCalls,
    manualRun: true,
    pauseRun: true,
    resumePausedRun: true,
    trayRun: true,
    trayActive: hiddenState.trayActive,
    pickerLayout,
    pickerScreenshotPath,
    pauseScreenshotPath,
    screenshotPath
  })}\n`);
  cleanup(0);
}

mockServer.listen(0, "127.0.0.1", () => {
  const address = mockServer.address();
  fs.writeFileSync(configPath, JSON.stringify({
    apiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "automation-smoke-key",
    model: "gpt-5.6-luna",
    models: [
      { label: "Auto 自动选择", value: "auto", kind: "auto" },
      { label: "5.6 Luna", value: "gpt-5.6-luna" },
      { label: "GPT Image 1.5", value: "gpt-image-1.5", kind: "image" }
    ]
  }), "utf8");
  process.env.XIANMA_AI_CONFIG = configPath;
  mainModule = require("./electron/main.js");
  run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    cleanup(1);
  });
});
