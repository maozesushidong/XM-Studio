const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { app } = require("electron");
const { chromium } = require("./build/agent-runtime/node_modules/openclaw/node_modules/playwright-core");
const packageJson = require("./package.json");

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-runtime-${runId}`);
const runtimeHome = path.join(userDataDir, "runtime-cache");
const packagedExecutableCandidates = [
  path.join(__dirname, `dist-${packageJson.version}`, "win-unpacked", "XMAI Studio.exe"),
  path.join(__dirname, "dist", "win-unpacked", "XMAI Studio.exe"),
  path.join(__dirname, "dist", "win-unpacked", "先马·Centaur.exe")
];
const executablePath = process.env.XIANMA_PACKAGED_EXE
  ? path.resolve(process.env.XIANMA_PACKAGED_EXE)
  : packagedExecutableCandidates.find((candidate) => fs.existsSync(candidate)) || packagedExecutableCandidates[0];

function findPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForDebugPort(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Application startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("打包应用调试端口启动超时");
}

async function removeTestDirectory(targetPath) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.promises.rm(path.toNamespacedPath(targetPath), { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

(async () => {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`没有找到打包应用：${executablePath}`);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const port = await findPort();
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`
  ], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      XIANMA_USER_DATA: userDataDir,
      XIANMA_RUNTIME_HOME: runtimeHome
    }
  });

  let browser;
  try {
    await waitForDebugPort(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const deadline = Date.now() + 30000;
    let appPage;
    while (Date.now() < deadline && !appPage) {
      appPage = browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes("renderer/index.html"));
      if (!appPage) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!appPage) throw new Error("未找到打包应用主页面");

    await appPage.evaluate(() => {
      document.getElementById("loginModal").classList.add("hidden");
      window.__runtimeEvents = [];
      window.desktopBridge.onRuntimeSetupProgress((status) => window.__runtimeEvents.push(status));
      window.__runtimeResult = null;
      window.desktopBridge.prepareRuntime()
        .then(() => { window.__runtimeResult = "ready"; })
        .catch((error) => { window.__runtimeResult = error.message || "error"; });
    });

    await appPage.waitForFunction(() => window.__runtimeEvents.some((item) => item.stage === "extracting" && item.percent > 8), null, { timeout: 300000 });
    const cancelUi = await appPage.evaluate(() => ({
      visible: !document.getElementById("runtimeSetup").classList.contains("hidden"),
      enabled: !document.getElementById("runtimeSetupCancel").disabled
    }));
    if (!cancelUi.visible || !cancelUi.enabled) throw new Error("运行时准备取消入口不可用");
    await appPage.evaluate(() => document.getElementById("loginModal").classList.add("hidden"));
    await appPage.click("#runtimeSetupCancel");
    await appPage.waitForFunction(() => window.__runtimeResult && window.__runtimeResult !== "ready", null, { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 800));

    const runtimeDirectory = path.join(runtimeHome, "XianmaAIStudio", "runtime");
    const partialAfterCancel = fs.existsSync(runtimeDirectory)
      ? fs.readdirSync(runtimeDirectory, { withFileTypes: true })
        .filter((entry) => entry.name.includes(".partial-")).length
      : 0;
    if (partialAfterCancel !== 0) throw new Error("取消后仍残留不完整运行时目录");

    await appPage.evaluate(() => {
      window.__runtimeResult = null;
      window.desktopBridge.prepareRuntime()
        .then(() => { window.__runtimeResult = "ready"; })
        .catch((error) => { window.__runtimeResult = error.message || "error"; });
    });
    await appPage.waitForFunction(() => window.__runtimeResult === "ready", null, { timeout: 600000 });
    const result = await appPage.evaluate(async () => ({
      status: await window.desktopBridge.getRuntimeSetupStatus(),
      events: window.__runtimeEvents
    }));
    const readyDirectories = fs.readdirSync(runtimeDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.includes(".partial-") && !entry.name.includes(".stale-"));
    if (readyDirectories.length !== 1 || !result.status.ready || result.status.percent !== 100) {
      throw new Error("运行时准备完成状态无效");
    }
    const readyRoot = path.join(runtimeDirectory, readyDirectories[0].name);
    const entryReady = fs.existsSync(path.join(readyRoot, "node_modules", "openclaw", "openclaw.mjs"));
    if (!entryReady) throw new Error("运行时入口文件未解压");

    process.stdout.write(`${JSON.stringify({
      packagedRuntimeArchive: true,
      cancelVisible: true,
      cancelWorked: true,
      partialCleanup: true,
      progressEvents: result.events.length,
      ready: true
    })}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    await removeTestDirectory(userDataDir);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(() => {
  app.exit(process.exitCode || 0);
});
