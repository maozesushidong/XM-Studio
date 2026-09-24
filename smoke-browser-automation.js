const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userId = `browser-smoke-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-browser-${runId}`);
const pagePath = path.join(userDataDir, "browser-test.html");
const pageTitle = `XMAI Browser Automation ${runId}`;
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(pagePath, `<!doctype html><html><head><meta charset="utf-8"><title>${pageTitle}</title></head><body>
  <h1>${pageTitle}</h1><button id="work-orders">工单中心</button><main id="panel"><p>真实浏览器导航与网页控件测试</p></main>
  <script>
    const panel = document.getElementById('panel');
    document.getElementById('work-orders').addEventListener('click', () => {
      panel.innerHTML = '<label>全部场景<select id="scenario" aria-label="全部场景"><option>全部场景</option><option>退货退款</option><option>物流异常</option></select></label><section id="rows"></section>';
      const scenario = document.getElementById('scenario');
      const renderRows = () => {
        document.getElementById('rows').innerHTML = scenario.value === '退货退款'
          ? '<button aria-label="查看 10001 详情">查看第一条退货退款工单</button>'
          : '<p>请选择业务场景</p>';
        const detail = document.querySelector('[aria-label="查看 10001 详情"]');
        if (detail) detail.addEventListener('click', () => { document.title = '${pageTitle} - 详情已打开'; detail.textContent = '详情已打开'; });
      };
      scenario.addEventListener('change', renderRows);
      renderRows();
    });
  </script>
</body></html>`, "utf8");

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
  }, null, {
    sender: mainWindow.webContents,
    userId,
    conversationId: `browser-${runId}`
  });
}

app.whenReady().then(async () => {
  const mainWindow = await waitForMainWindow();
  const browserTools = __test.toolDefinitions().filter((item) => /computer_browser_(?:open|search)/.test(item?.function?.name || ""));
  if (browserTools.length !== 2) throw new Error("浏览器专用工具未完整注册");

  const opened = await callTool(mainWindow, "computer_browser_open", {
    browser: "micsoft浏览器",
    url: pathToFileURL(pagePath).toString(),
    newTab: true,
    waitMs: 12000
  });
  if (!opened.navigated || !opened.window?.handle) throw new Error(`Edge 导航没有成功回执：${JSON.stringify(opened)}`);
  if (!opened.domControlAvailable) throw new Error(`Edge 网页控件通道没有就绪：${JSON.stringify(opened)}`);
  if (!String(opened.title || opened.window.title || "").includes(pageTitle)) {
    throw new Error(`Edge 没有打开测试页面，实际标题：${opened.title || opened.window.title || ""}`);
  }
  const initialDom = await callTool(mainWindow, "computer_inspect_app", {
    app: "Microsoft Edge",
    windowHandle: opened.window.handle,
    maxResults: 200
  });
  if (initialDom.source !== "browser-dom" || !initialDom.controls.some((item) => item.name === "工单中心" && item.controlType === "Button")) {
    throw new Error(`没有读取到网页内的工单中心按钮：${JSON.stringify(initialDom)}`);
  }
  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "click",
    selector: { name: "工单中心", controlType: "Button" },
    purpose: "进入工单中心"
  });
  const workOrderDom = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 200 });
  const scenarioControl = workOrderDom.controls.find((item) => item.name === "全部场景" && item.controlType === "ComboBox");
  if (!scenarioControl || !scenarioControl.options?.includes("退货退款")) throw new Error("没有读取到全部场景下拉框及退货退款选项");
  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "set_text",
    selector: { name: "全部场景", controlType: "ComboBox" },
    text: "退货退款",
    purpose: "筛选退货退款工单"
  });
  const filteredDom = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 200 });
  const firstDetail = filteredDom.controls.find((item) => /^查看 .* 详情$/.test(String(item.name || "")) && item.controlType === "Button");
  if (!firstDetail) throw new Error("筛选后没有读取到第一条退货退款工单详情按钮");
  const detailOpened = await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "click",
    selector: { name: firstDetail.name, controlType: "Button" },
    purpose: "打开第一条退货退款工单"
  });
  if (!String(detailOpened.result?.title || "").includes("详情已打开")) throw new Error(`第一条工单详情没有打开：${JSON.stringify(detailOpened)}`);
  if (!opened.capture?.path || !fs.existsSync(opened.capture.path)) throw new Error("Edge 页面截图没有生成");
  const capture = fs.readFileSync(opened.capture.path);
  if (capture.length < 1000 || capture.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("Edge 页面截图不是有效 PNG");
  const activeSession = __test.getActiveBrowserSession(userId, `browser-${runId}`);
  if (activeSession?.windowHandle !== opened.window.handle) throw new Error("浏览器窗口句柄没有保存到当前对话");
  const continuedCapture = await callTool(mainWindow, "computer_capture_app", { app: "Microsoft Edge" });
  if (continuedCapture.window?.handle !== opened.window.handle) throw new Error("续办操作没有复用当前浏览器窗口");
  const continuationMessage = await __test.buildBrowserContinuationMessage({
    browserAutomationTask: true,
    userId,
    conversationId: `browser-${runId}`,
    message: "那你继续吧"
  }, userId, null);
  if (!continuationMessage || !JSON.stringify(continuationMessage.content).includes("不要重新从头")) {
    throw new Error("续办请求没有注入当前浏览器上下文");
  }

  const chromeOpened = await callTool(mainWindow, "computer_browser_open", {
    browser: "谷歌浏览器",
    url: pathToFileURL(pagePath).toString(),
    newTab: true,
    waitMs: 12000
  });
  if (!chromeOpened.navigated || !chromeOpened.window?.handle) throw new Error(`Chrome 导航没有成功回执：${JSON.stringify(chromeOpened)}`);
  if (!String(chromeOpened.title || chromeOpened.window.title || "").includes(pageTitle)) {
    throw new Error(`Chrome 没有打开测试页面，实际标题：${chromeOpened.title || chromeOpened.window.title || ""}`);
  }
  if (!chromeOpened.capture?.path || !fs.existsSync(chromeOpened.capture.path)) throw new Error("Chrome 页面截图没有生成");
  await callTool(mainWindow, "computer_control_app", {
    app: "Google Chrome",
    action: "hotkey",
    windowHandle: chromeOpened.window.handle,
    keys: "CTRL+W",
    purpose: "关闭 Chrome 自动化测试标签页"
  }).catch(() => {});

  const searchTool = browserTools.find((item) => item.function.name === "computer_browser_search");
  if (!searchTool.function.parameters.properties.searchType.enum.includes("images")) throw new Error("浏览器搜索工具缺少图片搜索模式");

  let liveImageSearch = false;
  let openedImageResult = false;
  let liveWorkOrderPath = false;
  if (process.env.XIANMA_BROWSER_LIVE_WORKORDER === "1") {
    const liveOpened = await callTool(mainWindow, "computer_browser_open", {
      browser: "micsoft浏览器",
      url: "https://121.196.220.219/public/",
      newTab: true,
      waitMs: 20000
    });
    if (!liveOpened.domControlAvailable) throw new Error("在线工单页面缺少网页控件通道");
    const home = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
    if (!home.controls.some((item) => item.name === "工单中心" && item.controlType === "Button")) throw new Error("在线页面没有工单中心按钮");
    await callTool(mainWindow, "computer_control_app", {
      app: "Microsoft Edge", action: "click", selector: { name: "工单中心", controlType: "Button" }, purpose: "进入在线工单中心"
    });
    const center = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
    const liveScenario = center.controls.find((item) => item.name === "全部场景" && item.controlType === "ComboBox" && item.options?.includes("退货退款"));
    if (!liveScenario) throw new Error("在线工单中心没有全部场景下拉框");
    await callTool(mainWindow, "computer_control_app", {
      app: "Microsoft Edge", action: "set_text", selector: { name: "全部场景", controlType: "ComboBox" }, text: "退货退款", purpose: "筛选在线退货退款工单"
    });
    const filtered = await callTool(mainWindow, "computer_inspect_app", { app: "Microsoft Edge", maxResults: 500 });
    const liveFirstDetail = filtered.controls.find((item) => /^查看 .* 详情$/.test(String(item.name || "")) && item.controlType === "Button");
    if (!liveFirstDetail) throw new Error(`在线退货退款列表没有详情按钮：${JSON.stringify(filtered.controls.slice(0, 80))}`);
    await callTool(mainWindow, "computer_control_app", {
      app: "Microsoft Edge", action: "click", selector: { name: liveFirstDetail.name, controlType: "Button" }, purpose: "打开在线第一条退货退款工单"
    });
    liveWorkOrderPath = true;
  }
  if (process.env.XIANMA_BROWSER_LIVE_SEARCH === "1") {
    const searched = await callTool(mainWindow, "computer_browser_search", {
      browser: "Microsoft Edge",
      query: "胡歌",
      searchType: "images",
      newTab: true,
      waitMs: 15000
    });
    if (!searched.navigated || !/bing\.com\/images\/search/i.test(searched.url)) {
      throw new Error(`Edge 图片搜索没有成功回执：${JSON.stringify(searched)}`);
    }
    const beforeBytes = fs.readFileSync(searched.capture.path);
    const beforeHash = crypto.createHash("sha256").update(beforeBytes).digest("hex");
    const inspection = await callTool(mainWindow, "computer_inspect_app", {
      app: "Microsoft Edge",
      windowHandle: searched.window.handle,
      maxResults: 300
    });
    const namedImage = inspection.controls.find((item) =>
      /胡歌/.test(String(item.name || ""))
      && ["Hyperlink", "Image", "Button"].includes(item.controlType)
      && item.bounds?.width > 20
      && item.bounds?.height > 20
    );
    if (namedImage) {
      await callTool(mainWindow, "computer_control_app", {
        app: "Microsoft Edge",
        action: "click",
        windowHandle: searched.window.handle,
        selector: { name: namedImage.name, controlType: namedImage.controlType },
        purpose: "打开胡歌图片搜索结果"
      });
    } else {
      await callTool(mainWindow, "computer_control_app", {
        app: "Microsoft Edge",
        action: "click_position",
        windowHandle: searched.window.handle,
        xRatio: 0.18,
        yRatio: 0.42,
        purpose: "打开第一张胡歌图片搜索结果"
      });
    }
    await delay(1800);
    const after = await callTool(mainWindow, "computer_capture_app", {
      app: "Microsoft Edge",
      windowHandle: searched.window.handle
    });
    const afterHash = crypto.createHash("sha256").update(fs.readFileSync(after.capture.path)).digest("hex");
    liveImageSearch = true;
    openedImageResult = beforeHash !== afterHash;
    if (!openedImageResult) throw new Error("点击图片搜索结果后浏览器画面没有变化");
    await callTool(mainWindow, "computer_control_app", {
      app: "Microsoft Edge",
      action: "hotkey",
      windowHandle: searched.window.handle,
      keys: "CTRL+W",
      purpose: "关闭在线图片搜索测试标签页"
    }).catch(() => {});
  }

  await callTool(mainWindow, "computer_control_app", {
    app: "Microsoft Edge",
    action: "hotkey",
    windowHandle: opened.window.handle,
    keys: "CTRL+W",
    purpose: "关闭自动化测试创建的临时标签页"
  }).catch(() => {});

  process.stdout.write(`${JSON.stringify({
    edgeAlias: true,
    realEdgeNavigation: true,
    realChromeNavigation: true,
    verifiedTitle: true,
    screenshot: true,
    conversationSession: true,
    continuationContext: true,
    browserDomControls: true,
    semanticWorkOrderPath: true,
    liveWorkOrderPath,
    imageSearchMode: true,
    liveImageSearch,
    openedImageResult,
    title: opened.title || opened.window.title
  })}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
