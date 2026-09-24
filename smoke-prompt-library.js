"use strict";

process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_ENABLE_TELEMETRY = "0";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xmai-prompt-library-"));
app.setPath("userData", temporaryRoot);
process.env.XIANMA_USER_DATA = temporaryRoot;

let requestCount = 0;
let lastRequest = null;

function promptItem(index = 1) {
  return {
    id: `prompt-${index}`,
    source_name: "公共提示词库",
    title: index === 1 ? "咖啡馆产品宣传图" : `提示词模板 ${index}`,
    prompt: index === 1
      ? '为 {argument name="product" default="咖啡杯"} 创作一张简洁的产品宣传图。'
      : `请完成第 ${index} 个测试任务。`,
    description: index === 1 ? "用于咖啡产品宣传的可编辑提示词。" : `第 ${index} 个提示词简介。`,
    category: "公共提示词库",
    tags: [index === 1 ? "产品营销" : "社交媒体帖子", "gpt-image-2", "测试作者"],
    source_created_at: "2026-08-25",
    author: "测试作者",
    image_model: "gpt-image-2"
  };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/open/v1/resources/prompts") {
    response.writeHead(404);
    response.end();
    return;
  }
  requestCount += 1;
  lastRequest = {
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("page_size") || 12),
    keyword: url.searchParams.get("keyword") || ""
  };
  const allItems = Array.from({ length: 25 }, (_, index) => promptItem(index + 1));
  const matching = lastRequest.keyword.includes("咖啡")
    ? allItems.filter((item) => `${item.title} ${item.description}`.includes("咖啡"))
    : allItems;
  const start = (lastRequest.page - 1) * lastRequest.pageSize;
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    code: 200,
    message: "success",
    data: {
      items: matching.slice(start, start + lastRequest.pageSize),
      total: matching.length,
      page: lastRequest.page,
      page_size: lastRequest.pageSize
    }
  }));
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(60);
  }
  throw new Error(`${label}超时`);
}

function cleanup(code) {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.closeAllConnections?.();
  server.close();
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 }); } catch {}
  app.exit(code);
  setTimeout(() => process.exit(code), 80);
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

  await mainWindow.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-view="prompt-library"]');
    if (!button) throw new Error('提示词库导航不存在');
    button.click();
  })()`);
  await waitFor(() => mainWindow.webContents.executeJavaScript("document.querySelectorAll('.prompt-library-card:not(.prompt-library-skeleton)').length === 12"), "提示词列表加载");
  const initial = await mainWindow.webContents.executeJavaScript(`(() => ({
    activeView: state.activeView,
    navActive: document.querySelector('[data-nav="prompt-library"]')?.classList.contains('active'),
    count: document.querySelector('.prompt-library-count strong')?.innerText,
    cards: document.querySelectorAll('.prompt-library-card:not(.prompt-library-skeleton)').length,
    horizontalOverflow: document.body.scrollWidth - document.body.clientWidth
  }))()`);
  if (initial.activeView !== "prompt-library" || !initial.navActive || initial.count !== "25" || initial.cards !== 12 || initial.horizontalOverflow !== 0) {
    throw new Error(`提示词库首页错误：${JSON.stringify(initial)}`);
  }
  if (BrowserWindow.getAllWindows().length !== 1) throw new Error("提示词库仍然打开了额外门户窗口");
  mainWindow.unmaximize();
  mainWindow.setSize(960, 640);
  await delay(120);
  const compact = await mainWindow.webContents.executeJavaScript(`(() => ({
    viewport: [innerWidth, innerHeight],
    horizontalOverflow: document.body.scrollWidth - document.body.clientWidth,
    columns: getComputedStyle(document.querySelector('.prompt-library-grid')).gridTemplateColumns.split(' ').length,
    segmented: [...document.querySelectorAll('.prompt-library-segmented button')].every((button) => button.scrollHeight <= button.clientHeight)
  }))()`);
  if (compact.horizontalOverflow !== 0 || compact.columns !== 2 || !compact.segmented) {
    throw new Error(`提示词库窄窗口布局错误：${JSON.stringify(compact)}`);
  }

  await mainWindow.webContents.executeJavaScript("document.querySelector('[data-prompt-library-page=\"next\"]')?.click()");
  await waitFor(() => lastRequest?.page === 2 && requestCount >= 2, "提示词分页");
  const pageTwo = await mainWindow.webContents.executeJavaScript("promptLibraryState.page");
  if (pageTwo !== 2) throw new Error(`提示词分页状态错误：${pageTwo}`);

  await mainWindow.webContents.executeJavaScript("resetPromptLibraryFilters()");
  await waitFor(() => mainWindow.webContents.executeJavaScript("promptLibraryState.page === 1 && !promptLibraryState.loading"), "提示词重置");
  await mainWindow.webContents.executeJavaScript("document.querySelector('.prompt-library-card').click()");
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(document.querySelector('.prompt-library-detail'))"), "提示词详情");
  const detail = await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-prompt-library-argument="product"]');
    input.value = '冷萃咖啡';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-prompt-library-detail-save]').click();
    return {
      title: document.querySelector('#promptLibraryDetailTitle')?.innerText,
      preview: document.querySelector('[data-prompt-library-preview]')?.innerText,
      saved: document.querySelector('[data-prompt-library-detail-save]')?.innerText,
      footerBottom: Math.round(document.querySelector('.prompt-library-detail > footer').getBoundingClientRect().bottom),
      viewportHeight: innerHeight
    };
  })()`);
  if (detail.title !== "咖啡馆产品宣传图" || !detail.preview.includes("冷萃咖啡") || !detail.saved.includes("已收藏") || detail.footerBottom !== detail.viewportHeight) {
    throw new Error(`提示词详情交互错误：${JSON.stringify(detail)}`);
  }

  await mainWindow.webContents.executeJavaScript("document.querySelector('[data-prompt-library-use]').click()");
  const used = await mainWindow.webContents.executeJavaScript(`(() => ({
    activeView: state.activeView,
    prompt: document.querySelector('#promptInput')?.value,
    conversations: state.conversations.length
  }))()`);
  if (used.activeView !== "chat" || !used.prompt.includes("冷萃咖啡") || used.conversations < 2) {
    throw new Error(`提示词没有带入新对话：${JSON.stringify(used)}`);
  }

  await mainWindow.webContents.executeJavaScript(`(() => {
    showView('prompt-library');
    document.querySelector('[data-prompt-library-scope="saved"]').click();
  })()`);
  const savedView = await mainWindow.webContents.executeJavaScript(`(() => {
    const favoriteKey = [...Object.keys(localStorage)].find((key) => key.startsWith('xmai.prompt-library.favorites.v1:'));
    return {
      cards: document.querySelectorAll('.prompt-library-card:not(.prompt-library-skeleton)').length,
      title: document.querySelector('.prompt-library-results-heading h2')?.innerText,
      favoriteKey,
      favoriteCount: JSON.parse(localStorage.getItem(favoriteKey) || '[]').length
    };
  })()`);
  if (savedView.cards !== 1 || savedView.title !== "我的收藏" || !savedView.favoriteKey || savedView.favoriteCount !== 1) {
    throw new Error(`收藏没有按用户保存：${JSON.stringify(savedView)}`);
  }

  await mainWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-prompt-library-scope="all"]').click();
    const input = document.querySelector('[data-prompt-library-search]');
    input.value = '咖啡';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(() => lastRequest?.keyword === "咖啡", "提示词搜索");
  await waitFor(() => mainWindow.webContents.executeJavaScript("promptLibraryState.total === 1 && !promptLibraryState.loading"), "搜索结果渲染");
  const search = await mainWindow.webContents.executeJavaScript(`(() => ({
    count: document.querySelector('.prompt-library-count strong')?.innerText,
    cards: document.querySelectorAll('.prompt-library-card:not(.prompt-library-skeleton)').length,
    query: document.querySelector('[data-prompt-library-search]')?.value
  }))()`);
  if (search.count !== "1" || search.cards !== 1 || search.query !== "咖啡") throw new Error(`搜索结果错误：${JSON.stringify(search)}`);

  const screenshotPath = path.join(__dirname, "build", "smoke-prompt-library.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  process.stdout.write(`${JSON.stringify({ promptLibrary: true, embedded: true, requestCount, pagination: true, search: true, favorites: true, useInChat: true, screenshotPath })}\n`);
  cleanup(0);
}

server.listen(0, "127.0.0.1", () => {
  process.env.XIANMA_PROMPT_LIBRARY_API_URL = `http://127.0.0.1:${server.address().port}/api/open/v1/resources/prompts`;
  require("./electron/main.js");
  run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    cleanup(1);
  });
});
