const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require("./build/agent-runtime/node_modules/openclaw/node_modules/playwright-core");
const packageJson = require("./package.json");
const expectedVersion = String(process.env.XIANMA_EXPECTED_VERSION || packageJson.version);

const runId = Date.now().toString(36);
const userId = `packaged-smoke-${runId}`;
const userDataDir = path.join(__dirname, "build", `smoke-packaged-${runId}`);
const aiConfigPath = path.join(userDataDir, "ai-config.json");
const dingtalkConfigPath = path.join(userDataDir, "dingtalk-config.json");
const resultPath = path.join(userDataDir, "smoke-result.json");
const packagedExecutableCandidates = [
  path.join(__dirname, `dist-${packageJson.version}`, "win-unpacked", "XMAI Studio.exe"),
  path.join(__dirname, "dist", "win-unpacked", "XMAI Studio.exe"),
  path.join(__dirname, "dist", "win-unpacked", "先马·Centaur.exe"),
  path.join(__dirname, "dist", "win-packed", "先马·Centaur.exe")
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("打包应用调试端口启动超时");
}

(async () => {
  if (!fs.existsSync(executablePath)) throw new Error(`没有找到打包应用：${executablePath}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(aiConfigPath, JSON.stringify({ apiBaseUrl: "", apiKey: "" }), "utf8");
  fs.writeFileSync(dingtalkConfigPath, JSON.stringify({ clientSecret: "" }), "utf8");
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
      XIANMA_AI_CONFIG: aiConfigPath,
      XIANMA_DINGTALK_CONFIG: dingtalkConfigPath,
      XIANMA_RUNTIME_HOME: path.join(userDataDir, "runtime-cache")
    }
  });
  let browser;
  try {
    await waitForDebugPort(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const deadline = Date.now() + 30000;
    let page;
    while (Date.now() < deadline && !page) {
      page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes("renderer/index.html"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!page) throw new Error("未找到打包应用主页面");

    const result = await page.evaluate(async ({ targetUserId }) => {
      const [aiConfig, dingtalkStatus, workspace, updateStatus] = await Promise.all([
        window.desktopBridge.getAiRuntimeConfig(),
        window.desktopBridge.getDingtalkSession(),
        window.desktopBridge.getUserWorkspace({ userId: targetUserId }),
        window.desktopBridge.getUpdateStatus()
      ]);
      const desktopRouting = {
        namedApp: shouldUseDesktopApplicationTools({ messages: [] }, { content: "打开 Photoshop" }),
        arbitraryClient: shouldUseDesktopApplicationTools({ messages: [] }, { content: "在公司的业务客户端中点击导出按钮" }),
        knowledgeQuestion: shouldUseDesktopApplicationTools({ messages: [] }, { content: "中国的首都在哪里" })
      };

      const updateCheck = await window.desktopBridge.checkForUpdates();
      const fastRequestId = `packaged-fast-${Date.now()}`;
      const fastStartedAt = performance.now();
      let fastFirstDeltaMs = null;
      const removeFastListener = window.desktopBridge.onChatCompletionChunk((chunk) => {
        if (chunk?.requestId === fastRequestId && fastFirstDeltaMs == null && chunk.content) {
          fastFirstDeltaMs = Math.round(performance.now() - fastStartedAt);
        }
      });
      const fastChat = await window.desktopBridge.chatCompletion({
        userId: targetUserId,
        model: "gpt-5.6-luna",
        preferGateway: false,
        enableWorkspaceTools: false,
        stream: true,
        requestId: fastRequestId,
        messages: [
          { role: "system", content: "请用一句中文直接回答，不要展开。" },
          { role: "user", content: "中国的首都在哪里？" }
        ]
      });
      removeFastListener();
      const fastTotalMs = Math.round(performance.now() - fastStartedAt);
      const chat = await window.desktopBridge.chatCompletion({
        userId: targetUserId,
        model: "gpt-5.6-luna",
        preferGateway: false,
        waitForGateway: false,
        enableFileTools: false,
        autoPreviewHtml: true,
        stream: true,
        requestId: `packaged-file-${Date.now()}`,
        artifactOutput: { relativePath: "packaged-runtime-proof.html", format: "html", title: "打包运行时验证" },
        messages: [
          { role: "system", content: "请直接返回一个完整 html 代码块，页面正文只显示用户要求的文字，不要解释。" },
          { role: "user", content: "生成一个完整 HTML，正文只显示：打包运行时验证成功。" }
        ]
      });
      return {
        aiConfigured: aiConfig.configured === true,
        privateConnectionMetadataHidden: !("hasPrivateKey" in aiConfig) && !("source" in aiConfig) && !("apiKey" in aiConfig),
        dingtalkConfigured: dingtalkStatus.configured,
        workspaceRoot: workspace.rootPath,
        desktopRouting,
        updateStatus,
        updateCheck,
        fastChat,
        fastFirstDeltaMs,
        fastTotalMs,
        chat
      };
    }, { targetUserId: userId });

    const proofPath = path.join(result.workspaceRoot, "packaged-runtime-proof.html");
    if (!result.aiConfigured || !result.privateConnectionMetadataHidden) throw new Error("打包应用模型配置或前端隐私边界不正确");
    if (!result.dingtalkConfigured) throw new Error("打包应用未识别内置钉钉凭据");
    if (!result.desktopRouting?.namedApp || !result.desktopRouting?.arbitraryClient || result.desktopRouting?.knowledgeQuestion) throw new Error("打包应用通用桌面路由不正确");
    if (!result.updateStatus?.supported || result.updateStatus.displayVersion !== expectedVersion || result.updateStatus.autoCheckEnabled !== true) throw new Error("打包应用自动更新状态不正确");
    if (result.updateCheck?.available !== false) throw new Error("打包应用当前版本检查结果不正确");
    if (!result.fastChat?.streamed || !String(result.fastChat.content || "").includes("北京")) throw new Error("打包应用普通问答未使用流式轻量路径");
    if (!Number.isFinite(result.fastFirstDeltaMs) || result.fastFirstDeltaMs < 0) throw new Error("打包应用未收到流式首字事件");
    if (result.chat?.gateway || Number(result.chat?.toolRounds) !== 0) throw new Error("打包应用未使用确定性快速文件链路");
    if (!result.chat.previewPath || !fs.existsSync(proofPath)) throw new Error("打包应用未创建并预览 HTML");
    const proofArtifact = result.chat.files?.find((item) => path.resolve(item.path) === path.resolve(proofPath));
    if (!proofArtifact || !path.isAbsolute(proofArtifact.path)) throw new Error("打包应用未返回生成文件的绝对路径");
    if (!fs.readFileSync(proofPath, "utf8").includes("打包运行时验证成功")) throw new Error("打包验证文件内容不正确");
    const report = {
      packaged: true,
      bundledModelCredential: true,
      privateConnectionMetadataHidden: true,
      bundledDingtalkCredential: true,
      genericDesktopRouting: true,
      softwareUpdateSettings: true,
      liveUpdateCheck: true,
      fastStreamingChat: true,
      fastFirstDeltaMs: result.fastFirstDeltaMs,
      fastTotalMs: result.fastTotalMs,
      deterministicFastFile: true,
      fileCreated: true,
      absoluteFileArtifact: true,
      previewOpened: true,
      model: result.chat.model
    };
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), "utf8");
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    }
  }
})().catch((error) => {
  try {
    fs.writeFileSync(resultPath, JSON.stringify({ packaged: false, error: String(error?.message || error) }, null, 2), "utf8");
  } catch {
    // The original failure remains the useful diagnostic.
  }
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
