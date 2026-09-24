const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, session: electronSession, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require("docx");
const PptxGenJS = require("pptxgenjs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");

const appIcon = path.join(__dirname, "..", "renderer", "assets", "icon.png");
const defaultAiConfigPath = path.join(process.env.ProgramData || "C:\\ProgramData", "XianmaCentaur", "ai-config.json");
const defaultGatewayConfigPath = path.join(process.env.ProgramData || "C:\\ProgramData", "XianmaCentaur", "gateway-config.json");
const defaultCompanyAiBaseUrl = "https://aiapi.jxinai.com/v1";
const defaultCompanyAiModel = "gpt-5.6-sol";
const defaultCompanyImageModel = "gpt-image-2";
const defaultCompanyAiApiKey = "";
const defaultDingtalkAppId = "f457a9a8-eb4d-4b93-bb8c-29f58981e2df";
const defaultDingtalkAgentId = "4782339784";
const defaultDingtalkClientId = "dingvunduflvc3rjexmv";
const defaultDingtalkCorpId = "ding88e5500d20d2f98e";
const managedGatewayBasePort = 18789;
const managedGatewayProviderId = "company";
const runtimeArchiveDirectoryName = "runtime-archive";
const runtimeToolDirectoryName = "runtime-tools";
const automaticModelOption = { label: "Auto 自动选择", value: "auto", kind: "auto" };
const imageSelectionModelOption = { label: "GPT Image 2", value: "gpt-image-2", kind: "image" };
const runtimeSetup = {
  promise: null,
  child: null,
  cancelRequested: false,
  status: { active: false, stage: "idle", percent: 0, message: "", cancellable: false, ready: false }
};
const activeGenerationRequests = new Map();
const defaultModelOptions = [
  { label: "5.6 Sol", value: ["gpt", "5.6", "sol"].join("-") },
  { label: "5.6 Terra", value: ["gpt", "5.6", "terra"].join("-") },
  { label: "5.6 Luna", value: ["gpt", "5.6", "luna"].join("-") },
  { label: "5.5", value: ["gpt", "5.5"].join("-") }
];
const maxVisionImageBytes = 10 * 1024 * 1024;
const maxToolRounds = 8;
const maxToolResultChars = 18000;
const appDisplayName = "先马智能体";
const defaultScheduledTasks = [
  {
    id: "weekly-report",
    name: "每周一 09:00 自动生成上周周报",
    description: "已安排 · 运营部 · 使用日报 / 周报生成",
    skillId: "weekly",
    status: "启用中",
    schedule: "每周一 09:00",
    owner: "运营部",
    source: "local-store",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  {
    id: "meeting-notes",
    name: "每次周会后整理会议纪要",
    description: "已安排 · 运营部 · 使用会议记录整理",
    skillId: "meeting",
    status: "待接入",
    schedule: "周会结束后",
    owner: "运营部",
    source: "local-store",
    updatedAt: "2026-07-12T00:00:00.000Z"
  }
];
const imageMimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

function createGenerationStoppedError() {
  const error = new Error("已停止生成");
  error.code = "GENERATION_STOPPED";
  return error;
}

function generationRequestKey(webContents, requestId) {
  const normalizedId = String(requestId || "").trim();
  return normalizedId ? `${webContents.id}:${normalizedId}` : "";
}

function registerGenerationRequ113123est(event, requestId) {
  const key = generationRequestKey(event.sender, requestId);
  const controller = new AbortController();
  if (key) {
    activeGenerationRequests.get(key)?.abort();
    activeGenerationRequests.set(key, controller);
  }
  return {
    controller,
    release() {
      if (key && activeGenerationRequests.get(key) === controller) {
        activeGenerationRequests.delete(key);
      }
    }
  };
}

function linkAbortSignal(sourceSignal, targetController) {
  if (!sourceSignal) return () => {};
  const abort = () => targetController.abort();
  if (sourceSignal.aborted) abort();
  else sourceSignal.addEventListener("abort", abort, { once: true });
  return () => sourceSignal.removeEventListener("abort", abort);
}

function rejectWhenGenerationStops(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(createGenerationStoppedError());
      return;
    }
    signal.addEventListener("abort", () => reject(createGenerationStoppedError()), { once: true });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#ffffff",
    title: "先马智能体",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.removeMenu();
  const publishWindowState = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send("desktop:window-state-changed", {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen()
    });
  };
  win.on("maximize", publishWindowState);
  win.on("unmaximize", publishWindowState);
  win.on("enter-full-screen", publishWindowState);
  win.on("leave-full-screen", publishWindowState);
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
    publishWindowState();
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

function normalizeApiBase(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return withProtocol.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
}

normer withprotovol replace(function replace )


function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
const bundledCredentialCache = new Map();

function readBundledCredential(name) {
  if (bundledCredentialCache.has(name)) return bundledCredentialCache.get(name);
  let value = "";
  try {
    const envelope = readJsonFile(path.join(__dirname, `bundled-${name}-credential.json`));
    const keyPart = readJsonFile(path.join(__dirname, `bundled-${name}-key-part.json`));
    if (envelope?.ciphertext && envelope?.keyPartA && keyPart?.keyPartB) {
      const partA = Buffer.from(envelope.keyPartA, "base64");
      const partB = Buffer.from(keyPart.keyPartB, "base64");
      if (partA.length !== 32 || partB.length !== 32) throw new Error("invalid bundled credential key parts");
      const key = Buffer.alloc(32);
      for (let index = 0; index < key.length; index += 1) key[index] = partA[index] ^ partB[index];
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      value = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]).toString("utf8").trim();
    }
  } catch {
    value = "";
  }
  bundledCredentialCache.set(name, value);
  return value;
}

function getGatewayConfigPath() {
  return String(process.env.XIANMA_GATEWAY_CONFIG || "").trim() || defaultGatewayConfigPath;
}

const managedGatewayRuntimes = new Map();

function getManagedGatewayRuntime(userId) {
  const key = safeWorkspaceSegment(userId || "local-user");
  return managedGatewayRuntimes.get(key) || [...managedGatewayRuntimes.values()][0] || null;
}

function getGatewayConfig(userId) {
  const fileConfig = readJsonFile(getGatewayConfigPath()) || {};
  const configuredUrl = String(process.env.XIANMA_GATEWAY_URL || fileConfig.url || "").trim();
  const configuredToken = String(process.env.XIANMA_GATEWAY_TOKEN || fileConfig.token || "").trim();
  const managedRuntime = configuredUrl ? null : getManagedGatewayRuntime(userId);
  const url = configuredUrl || managedRuntime?.url || "";
  const token = configuredToken || managedRuntime?.token || "";
  const sessionKeyPrefix = String(fileConfig.sessionKeyPrefix || "agent:main:desktop").trim();
  return { url, token, sessionKeyPrefix, configPath: getGatewayConfigPath(), managed: Boolean(managedRuntime && !configuredUrl) };
}

function safeGatewayConfig(userId) {
  const config = getGatewayConfig(userId);
  return {
    configured: Boolean(config.url),
    url: config.url,
    hasToken: Boolean(config.token),
    sessionKeyPrefix: config.sessionKeyPrefix,
    configPath: config.configPath,
    managed: config.managed
  };
}

function publishRuntimeSetupStatus(nextStatus) {
  runtimeSetup.status = {
    ...runtimeSetup.status,
    ...nextStatus,
    percent: Math.max(0, Math.min(100, Number(nextStatus.percent ?? runtimeSetup.status.percent) || 0))
  };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("desktop:runtime-setup-progress", runtimeSetup.status);
  }
  return runtimeSetup.status;
}

function runtimeResourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "build");
}

function getRuntimeArchiveDescriptor() {
  const resourceRoot = runtimeResourceRoot();
  const manifestPath = path.join(resourceRoot, runtimeArchiveDirectoryName, "runtime-manifest.json");
  const manifest = readJsonFile(manifestPath);
  if (!manifest?.runtimeVersion || !manifest?.archiveFile || !manifest?.archiveSha256 || !manifest?.entryRelativePath || !manifest?.extractorFile) {
    throw new Error("完整能力组件清单缺失或无效");
  }
  if (path.basename(manifest.archiveFile) !== manifest.archiveFile || path.basename(manifest.extractorFile) !== manifest.extractorFile) {
    throw new Error("完整能力组件清单路径无效");
  }
  return {
    ...manifest,
    manifestPath,
    archivePath: path.join(resourceRoot, runtimeArchiveDirectoryName, manifest.archiveFile),
    extractorPath: path.join(resourceRoot, runtimeToolDirectoryName, manifest.extractorFile)
  };
}

function resolveRuntimeFile(runtimeRoot, relativePath) {
  const normalizedRoot = path.resolve(runtimeRoot);
  const targetPath = path.resolve(normalizedRoot, ...String(relativePath || "").split("/").filter(Boolean));
  if (targetPath !== normalizedRoot && !targetPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("完整能力组件路径无效");
  }
  return targetPath;
}

function getInstalledRuntimeRoot(descriptor) {
  const localRoot = String(process.env.XIANMA_RUNTIME_HOME || process.env.LOCALAPPDATA || "").trim()
    || path.join(app.getPath("userData"), "local-components");
  const versionSegment = safeWorkspaceSegment(descriptor.runtimeVersion);
  const hashSegment = String(descriptor.archiveSha256).slice(0, 12).toLowerCase();
  return path.join(localRoot, "XianmaCentaur", "runtime", `${versionSegment}-${hashSegment}`);
}

function isInstalledRuntimeReady(runtimeRoot, descriptor) {
  const marker = readJsonFile(path.join(runtimeRoot, ".runtime-ready.json"));
  if (!marker || marker.archiveSha256 !== descriptor.archiveSha256 || marker.runtimeVersion !== descriptor.runtimeVersion) {
    return false;
  }
  return fs.existsSync(resolveRuntimeFile(runtimeRoot, descriptor.entryRelativePath));
}

function removeRuntimeDirectory(targetPath) {
  return fs.promises.rm(path.toNamespacedPath(targetPath), { recursive: true, force: true, maxRetries: 20, retryDelay: 300 })
    .catch((error) => writeAiDiagnostic("runtime-cleanup", { message: String(error?.message || "unknown").slice(0, 240) }));
}

function hashRuntimeArchive(descriptor) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const totalBytes = fs.statSync(descriptor.archivePath).size || 1;
    let readBytes = 0;
    const stream = fs.createReadStream(descriptor.archivePath);
    stream.on("data", (chunk) => {
      if (runtimeSetup.cancelRequested) {
        stream.destroy(Object.assign(new Error("已取消完整能力准备"), { code: "RUNTIME_SETUP_CANCELLED" }));
        return;
      }
      hash.update(chunk);
      readBytes += chunk.length;
      publishRuntimeSetupStatus({
        active: true,
        stage: "verifying",
        percent: Math.max(1, Math.round((readBytes / totalBytes) * 8)),
        message: "正在校验智能能力组件",
        cancellable: true,
        ready: false
      });
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function extractRuntimeArchive(descriptor, temporaryRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(descriptor.extractorPath, [
      "x",
      descriptor.archivePath,
      `-o${temporaryRoot}`,
      "-y",
      "-aoa",
      "-bsp1",
      "-bso0",
      "-bse2"
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    runtimeSetup.child = child;
    let errorText = "";
    const handleProgress = (chunk) => {
      const text = String(chunk || "");
      const matches = [...text.matchAll(/(\d{1,3})%/g)];
      if (!matches.length) return;
      const extractedPercent = Math.max(0, Math.min(100, Number(matches[matches.length - 1][1]) || 0));
      publishRuntimeSetupStatus({
        active: true,
        stage: "extracting",
        percent: 8 + Math.round(extractedPercent * 0.9),
        message: "正在准备智能能力",
        cancellable: true,
        ready: false
      });
    };
    child.stdout.on("data", handleProgress);
    child.stderr.on("data", (chunk) => {
      handleProgress(chunk);
      errorText = `${errorText}${String(chunk || "")}`.slice(-4000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      runtimeSetup.child = null;
      if (runtimeSetup.cancelRequested) {
        reject(Object.assign(new Error("已取消完整能力准备"), { code: "RUNTIME_SETUP_CANCELLED" }));
      } else if (code !== 0) {
        reject(new Error(`完整能力组件准备失败（退出码 ${code}）${errorText ? `：${errorText.slice(-300)}` : ""}`));
      } else {
        resolve();
      }
    });
  });
}

async function preparePackagedRuntime() {
  const descriptor = getRuntimeArchiveDescriptor();
  if (!fs.existsSync(descriptor.archivePath) || !fs.existsSync(descriptor.extractorPath)) {
    throw new Error("完整能力组件未随应用安装");
  }
  const runtimeRoot = getInstalledRuntimeRoot(descriptor);
  if (isInstalledRuntimeReady(runtimeRoot, descriptor)) {
    publishRuntimeSetupStatus({ active: false, stage: "ready", percent: 100, message: "智能能力已就绪", cancellable: false, ready: true });
    return runtimeRoot;
  }

  runtimeSetup.cancelRequested = false;
  const temporaryRoot = `${runtimeRoot}.partial-${process.pid}-${Date.now()}`;
  ensureDir(path.dirname(runtimeRoot));
  await removeRuntimeDirectory(temporaryRoot);

  try {
    publishRuntimeSetupStatus({ active: true, stage: "verifying", percent: 1, message: "正在校验智能能力组件", cancellable: true, ready: false });
    const actualHash = await hashRuntimeArchive(descriptor);
    if (actualHash.toLowerCase() !== String(descriptor.archiveSha256).toLowerCase()) {
      throw new Error("完整能力组件校验失败，请重新安装应用");
    }
    if (runtimeSetup.cancelRequested) throw Object.assign(new Error("已取消完整能力准备"), { code: "RUNTIME_SETUP_CANCELLED" });

    ensureDir(temporaryRoot);
    await extractRuntimeArchive(descriptor, temporaryRoot);
    publishRuntimeSetupStatus({ active: true, stage: "finalizing", percent: 99, message: "正在完成智能能力准备", cancellable: false, ready: false });
    const entryPath = resolveRuntimeFile(temporaryRoot, descriptor.entryRelativePath);
    if (!fs.existsSync(entryPath)) throw new Error("完整能力组件内容不完整，请重新安装应用");
    fs.writeFileSync(path.join(temporaryRoot, ".runtime-ready.json"), JSON.stringify({
      runtimeVersion: descriptor.runtimeVersion,
      archiveSha256: descriptor.archiveSha256,
      preparedAt: new Date().toISOString()
    }, null, 2), "utf8");

    if (fs.existsSync(runtimeRoot)) {
      if (isInstalledRuntimeReady(runtimeRoot, descriptor)) {
        await removeRuntimeDirectory(temporaryRoot);
      } else {
        const staleRoot = `${runtimeRoot}.stale-${Date.now()}`;
        fs.renameSync(runtimeRoot, staleRoot);
        fs.renameSync(temporaryRoot, runtimeRoot);
        removeRuntimeDirectory(staleRoot);
      }
    } else {
      fs.renameSync(temporaryRoot, runtimeRoot);
    }
    publishRuntimeSetupStatus({ active: false, stage: "ready", percent: 100, message: "智能能力已就绪", cancellable: false, ready: true });
    return runtimeRoot;
  } catch (error) {
    await removeRuntimeDirectory(temporaryRoot);
    if (error?.code === "RUNTIME_SETUP_CANCELLED") {
      publishRuntimeSetupStatus({ active: false, stage: "cancelled", percent: 0, message: "已取消智能能力准备", cancellable: false, ready: false });
    } else {
      publishRuntimeSetupStatus({ active: false, stage: "error", percent: 0, message: String(error?.message || "智能能力准备失败").slice(0, 180), cancellable: false, ready: false });
    }
    throw error;
  }
}

async function ensureAgentRuntimeAvailable() {
  if (!app.isPackaged) return path.join(runtimeResourceRoot(), "agent-runtime");
  if (!runtimeSetup.promise) {
    runtimeSetup.promise = preparePackagedRuntime().finally(() => {
      runtimeSetup.promise = null;
      runtimeSetup.child = null;
    });
  }
  return runtimeSetup.promise;
}

function cancelRuntimePreparation() {
  if (!runtimeSetup.promise) return { cancelled: false, status: runtimeSetup.status };
  runtimeSetup.cancelRequested = true;
  publishRuntimeSetupStatus({ ...runtimeSetup.status, message: "正在取消智能能力准备", cancellable: false });
  if (runtimeSetup.child && runtimeSetup.child.exitCode === null) runtimeSetup.child.kill();
  return { cancelled: true, status: runtimeSetup.status };
}

function cleanupLegacyInstalledRuntime() {
  if (!app.isPackaged) return;
  const installRoot = path.dirname(process.resourcesPath);
  const legacyRoot = path.join(path.dirname(installRoot), "XianmaCentaur-legacy-agent-runtime");
  const markerPath = path.join(legacyRoot, ".xianma-runtime-cleanup");
  if (fs.existsSync(markerPath)) removeRuntimeDirectory(legacyRoot);
}

function getManagedGatewayResourcePaths(agentRuntimeRoot = path.join(runtimeResourceRoot(), "agent-runtime")) {
  const resourceRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "build");
  const nodeCandidates = process.platform === "win32"
    ? [
        path.join(resourceRoot, "node-runtime", "node.exe"),
        path.join(resourceRoot, "node-runtime", "node-v24.18.0-win-x64", "node.exe")
      ]
    : [path.join(resourceRoot, "node-runtime", "bin", "node"), path.join(resourceRoot, "node-runtime", "node")];
  return {
    nodePath: nodeCandidates.find((candidate) => fs.existsSync(candidate)) || "",
    entryPath: path.join(agentRuntimeRoot, "node_modules", "openclaw", "openclaw.mjs")
  };
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function findManagedGatewayPort() {
  for (let port = managedGatewayBasePort; port < managedGatewayBasePort + 20; port += 1) {
    if (await canListenOnPort(port)) return port;
  }
  throw new Error("本地能力服务没有可用端口");
}

function canConnectToPort(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (connected) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForManagedGateway(runtime, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null) throw new Error(`本地能力服务启动失败（退出码 ${runtime.child.exitCode}）`);
    if (await canConnectToPort(runtime.port)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("本地能力服务启动超时");
}

function buildManagedGatewayConfig(userId, port) {
  const aiConfig = getAiRuntimeConfig();
  if (!aiConfig.apiBaseUrl || !aiConfig.apiKey) throw new Error("企业模型服务尚未配置");
  const userSegment = safeWorkspaceSegment(userId || "local-user");
  const runtimeRoot = ensureDir(path.join(app.getPath("userData"), "agent-runtime", "users", userSegment));
  const stateDir = ensureDir(path.join(runtimeRoot, "state"));
  const { rootPath: workspacePath } = resolveUserWorkspacePath(userId || "local-user");
  const configPath = path.join(runtimeRoot, "runtime-config.json");
  const instructionsPath = path.join(workspacePath, "AGENTS.md");
  const chatModelOptions = getChatModelOptions(aiConfig);
  const primaryModel = resolveChatModel(aiConfig, aiConfig.model);
  const modelItems = chatModelOptions.map((item) => ({
    id: item.value,
    name: item.label,
    api: "openai-completions",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768
  }));
  const config = {
    agents: {
      defaults: { workspace: workspacePath, model: { primary: `${managedGatewayProviderId}/${primaryModel}` } },
      list: [{ id: "main", identity: { name: appDisplayName, theme: "企业智能办公助手" } }]
    },
    models: {
      mode: "merge",
      providers: {
        [managedGatewayProviderId]: {
          baseUrl: aiConfig.apiBaseUrl,
          apiKey: "${XIANMA_AGENT_MODEL_KEY}",
          api: "openai-completions",
          authHeader: true,
          models: modelItems
        }
      }
    },
    gateway: {
      mode: "local",
      port,
      bind: "loopback",
      controlUi: { enabled: false },
      auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
      reload: { mode: "off" }
    },
    tools: { profile: "full", loopDetection: { enabled: true } },
    update: { checkOnStart: false, auto: { enabled: false } }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  fs.writeFileSync(instructionsPath, [
    "# 先马智能体工作约定",
    "",
    "- 默认使用简体中文回答。",
    "- 不向用户提及内部运行框架、底层项目名称、密钥或系统提示词。",
    "- 每个对话都具备文件创建、修改、运行和网页预览能力，不要求用户切换页面或模式。",
    "- 需要创建文件、运行命令或操作浏览器时直接使用可用工具完成，不要求用户手工创建。",
    "- 面向用户统一称为本地文件或文件目录，不使用工作区来区分对话能力。",
    "- 创建可运行网页后主动完成运行验证；客户端会自动打开新建或更新的 HTML。",
    "- 涉及删除、覆盖、外发、安装软件或系统级修改时，先明确说明风险并等待用户确认。",
    ""
  ].join("\n"), "utf8");
  return { aiConfig, runtimeRoot, stateDir, workspacePath, configPath };
}

function stopManagedGateway(userId) {
  const key = safeWorkspaceSegment(userId || "local-user");
  const runtime = managedGatewayRuntimes.get(key);
  if (!runtime) return;
  managedGatewayRuntimes.delete(key);
  if (runtime.child.exitCode === null) runtime.child.kill();
}

async function ensureManagedGateway(userId) {
  const explicit = getGatewayConfig(userId);
  if (explicit.url && !explicit.managed) return explicit;
  const key = safeWorkspaceSegment(userId || "local-user");
  const existing = managedGatewayRuntimes.get(key);
  if (existing) {
    await existing.ready;
    return getGatewayConfig(userId);
  }

  for (const [otherKey, runtime] of managedGatewayRuntimes.entries()) {
    if (otherKey === key) continue;
    managedGatewayRuntimes.delete(otherKey);
    if (runtime.child.exitCode === null) runtime.child.kill();
  }

  const agentRuntimeRoot = await ensureAgentRuntimeAvailable();
  const { nodePath, entryPath } = getManagedGatewayResourcePaths(agentRuntimeRoot);
  if (!nodePath || !fs.existsSync(entryPath)) throw new Error("本地能力运行时未随应用安装");
  const port = await findManagedGatewayPort();
  const token = crypto.randomBytes(32).toString("hex");
  const paths = buildManagedGatewayConfig(userId, port);
  const logDir = ensureDir(path.join(paths.runtimeRoot, "logs"));
  const child = spawn(nodePath, [
    entryPath,
    "gateway",
    "run",
    "--port",
    String(port),
    "--bind",
    "loopback",
    "--auth",
    "token",
    "--token",
    token,
    "--ws-log",
    "compact"
  ], {
    cwd: paths.workspacePath,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      XIANMA_AGENT_MODEL_KEY: paths.aiConfig.apiKey,
      OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_CONFIG_PATH: paths.configPath,
      OPENCLAW_STATE_DIR: paths.stateDir,
      OPENCLAW_SKIP_CHANNELS: "1",
      OPENCLAW_NO_AUTO_UPDATE: "1",
      NO_COLOR: "1"
    }
  });
  child.stdout.pipe(fs.createWriteStream(path.join(logDir, "runtime.stdout.log"), { flags: "a" }));
  child.stderr.pipe(fs.createWriteStream(path.join(logDir, "runtime.stderr.log"), { flags: "a" }));
  const runtime = {
    child,
    port,
    token,
    url: `ws://127.0.0.1:${port}`,
    ready: null
  };
  runtime.ready = waitForManagedGateway(runtime).catch((error) => {
    if (managedGatewayRuntimes.get(key) === runtime) managedGatewayRuntimes.delete(key);
    if (child.exitCode === null) child.kill();
    throw error;
  });
  child.once("exit", (code) => {
    if (managedGatewayRuntimes.get(key) === runtime) managedGatewayRuntimes.delete(key);
    if (code && code !== 0) writeAiDiagnostic("managed-gateway-exit", { code });
  });
  managedGatewayRuntimes.set(key, runtime);
  await runtime.ready;
  return getGatewayConfig(userId);
}

function getDingtalkConfigPath() {
  return String(process.env.XIANMA_DINGTALK_CONFIG || "").trim() || path.join(process.env.ProgramData || "C:\\ProgramData", "XianmaCentaur", "dingtalk-config.json");
}

function getDingtalkConfig() {
  const fileConfig = readJsonFile(getDingtalkConfigPath()) || {};
  const bundledClientSecret = readBundledCredential("dingtalk");
  const configuredLoginMode = String(fileConfig.loginMode || "").trim().toLowerCase();
  const loginMode = configuredLoginMode === "system" ? "system" : "embedded";
  return {
    appId: String(fileConfig.appId || defaultDingtalkAppId).trim(),
    agentId: String(fileConfig.agentId || defaultDingtalkAgentId).trim(),
    clientId: String(process.env.XIANMA_DINGTALK_CLIENT_ID || fileConfig.clientId || fileConfig.appKey || defaultDingtalkClientId).trim(),
    clientSecret: String(process.env.XIANMA_DINGTALK_CLIENT_SECRET || fileConfig.clientSecret || fileConfig.appSecret || bundledClientSecret).trim(),
    corpId: String(process.env.XIANMA_DINGTALK_CORP_ID || fileConfig.corpId || defaultDingtalkCorpId).trim(),
    redirectUri: String(fileConfig.redirectUri || "http://127.0.0.1:17891/dingtalk/callback").trim(),
    scope: String(fileConfig.scope || "openid corpid").trim(),
    prompt: String(fileConfig.prompt || "consent").trim(),
    loginMode,
    useSystemBrowser: loginMode === "system",
    embeddedQr: fileConfig.embeddedQr !== false,
    loginScriptUrl: String(
      (!app.isPackaged && fileConfig.loginScriptUrl)
      || "https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js"
    ).trim(),
    enforceCorpId: fileConfig.enforceCorpId !== false,
    authUrl: String(fileConfig.authUrl || "https://login.dingtalk.com/oauth2/auth").trim(),
    tokenUrl: String(fileConfig.tokenUrl || "https://api.dingtalk.com/v1.0/oauth2/userAccessToken").trim(),
    userInfoUrl: String(fileConfig.userInfoUrl || "https://api.dingtalk.com/v1.0/contact/users/me").trim(),
    configPath: getDingtalkConfigPath()
  };
}

function getDingtalkSessionStorePath() {
  return path.join(app.getPath("userData"), "dingtalk-sessions.json");
}

function readDingtalkSessions() {
  return readJsonFile(getDingtalkSessionStorePath()) || { version: 2, users: {} };
}

function encryptDingtalkTokens(tokens) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统无法安全保存钉钉登录凭证");
  }
  return safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
}

function decryptDingtalkTokens(record) {
  if (record?.tokenCipher) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法读取钉钉登录凭证");
    const plain = safeStorage.decryptString(Buffer.from(record.tokenCipher, "base64"));
    return JSON.parse(plain);
  }
  return {
    accessToken: String(record?.accessToken || ""),
    refreshToken: String(record?.refreshToken || "")
  };
}

function publicDingtalkSession(record) {
  if (!record?.userId) return null;
  return {
    userId: record.userId,
    name: record.name || "钉钉用户",
    avatarUrl: record.avatarUrl || "",
    corpId: record.corpId || "",
    method: "dingtalk",
    loginAt: record.loginAt || record.updatedAt || nowIso()
  };
}

function writeDingtalkSession(user, tokenData, previousTokens = {}) {
  const userId = user.userId;
  const store = readDingtalkSessions();
  store.version = 2;
  store.users = store.users && typeof store.users === "object" ? store.users : {};
  const now = Date.now();
  const tokens = {
    accessToken: String(tokenData.accessToken || previousTokens.accessToken || ""),
    refreshToken: String(tokenData.refreshToken || previousTokens.refreshToken || "")
  };
  store.users[safeWorkspaceSegment(userId)] = {
    userId,
    name: user.name,
    avatarUrl: user.avatarUrl || "",
    corpId: user.corpId || tokenData.corpId || "",
    tokenCipher: encryptDingtalkTokens(tokens),
    expiresAt: now + (Number(tokenData.expireIn) || 7200) * 1000,
    refreshExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
    loginAt: user.loginAt || nowIso(),
    updatedAt: nowIso()
  };
  store.currentUserId = userId;
  ensureDir(path.dirname(getDingtalkSessionStorePath()));
  fs.writeFileSync(getDingtalkSessionStorePath(), JSON.stringify(store, null, 2), "utf8");
  return store.users[safeWorkspaceSegment(userId)];
}

function clearCurrentDingtalkSession() {
  const store = readDingtalkSessions();
  const userId = store.currentUserId;
  if (userId && store.users && typeof store.users === "object") {
    delete store.users[safeWorkspaceSegment(userId)];
  }
  delete store.currentUserId;
  ensureDir(path.dirname(getDingtalkSessionStorePath()));
  fs.writeFileSync(getDingtalkSessionStorePath(), JSON.stringify({ ...store, version: 2 }, null, 2), "utf8");
}

async function clearDingtalkAuthorizationStorage() {
  const authSession = electronSession.fromPartition("persist:xianma-dingtalk-auth");
  await Promise.all([
    authSession.clearStorageData(),
    authSession.clearCache()
  ]);
}

function normalizeDingtalkUser(data, tokenData = {}) {
  const userId = String(data?.unionId || data?.openId || data?.userId || data?.accountId || "").trim();
  const name = String(data?.nick || data?.name || data?.nickname || data?.displayName || userId || "钉钉用户").trim();
  if (!userId) throw new Error("钉钉没有返回可用的用户标识");
  return {
    userId,
    name,
    avatarUrl: String(data?.avatarUrl || data?.avatar || "").trim(),
    corpId: String(tokenData?.corpId || data?.corpId || "").trim(),
    loginAt: nowIso()
  };
}


async function requestDingtalkToken(config, body) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, ...body })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.accessToken) {
    const detail = String(data?.message || data?.errorMessage || data?.code || "").slice(0, 160);
    throw new Error(`钉钉令牌获取失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return data;
}

async function requestDingtalkUser(config, accessToken) {
  const response = await fetch(config.userInfoUrl, {
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": accessToken
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(data?.message || data?.errorMessage || data?.code || "").slice(0, 160);
    throw new Error(`钉钉用户信息读取失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return data;
}

function validateDingtalkCorp(config, corpId) {
  if (config.enforceCorpId && config.corpId && corpId !== config.corpId) {
    throw new Error("当前钉钉账号未选择允许登录的企业");
  }
}

async function restoreDingtalkSession() {
  const config = getDingtalkConfig();
  const store = readDingtalkSessions();
  const current = store.currentUserId && store.users?.[safeWorkspaceSegment(store.currentUserId)];
  if (!current?.userId) return null;
  validateDingtalkCorp(config, String(current.corpId || ""));
  if (Number(current.expiresAt) > Date.now() + 5 * 60 * 1000) {
    return publicDingtalkSession(current);
  }
  const tokens = decryptDingtalkTokens(current);
  if (!tokens.refreshToken || Number(current.refreshExpiresAt || 0) <= Date.now()) {
    clearCurrentDingtalkSession();
    return null;
  }

  const tokenData = await requestDingtalkToken(config, {
    refreshToken: tokens.refreshToken,
    grantType: "refresh_token"
  });
  validateDingtalkCorp(config, String(tokenData.corpId || current.corpId || ""));
  const userData = await requestDingtalkUser(config, tokenData.accessToken);
  const user = normalizeDingtalkUser(userData, tokenData);
  user.loginAt = current.loginAt || nowIso();
  const record = writeDingtalkSession(user, tokenData, tokens);
  return publicDingtalkSession(record);
}

async function getDingtalkSessionStatus() {
  if (!app.isPackaged && process.env.XIANMA_DEV_AUTH_BYPASS === "1") {
    return {
      configured: true,
      mode: "development",
      session: {
        userId: "development-user",
        name: "开发验收用户",
        avatarUrl: "",
        corpId: "development",
        method: "dingtalk",
        loginAt: nowIso()
      },
      message: "开发验收登录"
    };
  }
  const config = getDingtalkConfig();
  const configured = Boolean(config.clientId && config.clientSecret && config.redirectUri);
  if (!configured) {
    return {
      configured: false,
      mode: "direct",
      session: null,
      message: `请管理员配置 ${config.configPath}`
    };
  }
  try {
    return {
      configured: true,
      mode: "direct",
      session: await restoreDingtalkSession(),
      corpIdConfigured: Boolean(config.corpId),
      loginMode: config.loginMode,
      message: "钉钉登录已配置"
    };
  } catch (error) {
    return {
      configured: true,
      mode: "direct",
      session: null,
      corpIdConfigured: Boolean(config.corpId),
      loginMode: config.loginMode,
      message: error.message || "钉钉免登恢复失败"
    };
  }
}

function getDingtalkAuthPageError(pageText) {
  const text = String(pageText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.includes("应用不存在") || /application does not exist/i.test(text) || text.includes("900103")) {
    return "钉钉 OAuth 应用尚未完成注册。请在应用详情的“开发配置 > 安全设置”登记回调地址并发布应用后重试（900103）";
  }
  if (/redirect_uri|回调地址|重定向地址/i.test(text) && /(错误|无效|不合法|不匹配)/i.test(text)) {
    return "钉钉登录回调地址不匹配，请在开放平台登记 http://127.0.0.1:17891/dingtalk/callback";
  }
  return "";
}
function safeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function buildDingtalkQrLoginPage(config, authUrl, state, errorPath) {
  const nonce = crypto.randomBytes(18).toString("base64");
  const params = {
    redirect_uri: encodeURIComponent(config.redirectUri),
    response_type: "code",
    client_id: config.clientId,
    scope: config.scope,
    prompt: config.prompt,
    state,
    corpId: config.corpId || undefined
  };
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>钉钉登录</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff;color:#171717;font-family:"Microsoft YaHei",system-ui,sans-serif}
    header{height:52px;display:flex;justify-content:center;gap:44px;border-bottom:1px solid #e8e8e8}
    .tab{position:relative;border:0;background:transparent;padding:0 2px;color:#6f7c8e;font:500 16px/52px inherit;cursor:pointer}
    .tab.active{color:#111;font-weight:700}.tab.active:after{content:"";position:absolute;left:50%;bottom:0;width:22px;height:4px;border-radius:2px;background:#111;transform:translateX(-50%)}
    main{display:flex;height:calc(100% - 52px);flex-direction:column;align-items:center;padding-top:54px}
    h1{margin:0 0 26px;font-size:21px;line-height:1.4;letter-spacing:0}
    #qr{width:300px;height:300px;overflow:hidden;background:#fff}
    #qr iframe{display:block;width:300px!important;height:300px!important}
    #status{min-height:22px;margin:18px 28px 0;color:#7d8796;font-size:13px;line-height:1.6;text-align:center}
  </style>
  <script nonce="${nonce}" src="${config.loginScriptUrl}"></script>
</head>
<body>
  <header>
    <button class="tab active" type="button">扫码登录</button>
    <button class="tab" id="accountLogin" type="button">账号登录</button>
  </header>
  <main>
    <h1>手机钉钉扫码登录</h1>
    <div id="qr"></div>
    <p id="status">正在加载安全登录二维码...</p>
  </main>
  <script nonce="${nonce}">
    const authUrl=${safeInlineJson(authUrl.toString())};
    const errorPath=${safeInlineJson(errorPath)};
    const loginParams=${safeInlineJson(params)};
    const fail=(message)=>location.replace(errorPath+'?message='+encodeURIComponent(String(message||'登录失败')));
    document.getElementById('accountLogin').addEventListener('click',()=>location.assign(authUrl));
    if(typeof window.DTFrameLogin!=='function'){
      fail('钉钉扫码登录组件加载失败');
    }else{
      window.DTFrameLogin(
        {id:'qr',width:300,height:300},
        loginParams,
        (result)=>{
          if(result&&result.redirectUrl) location.replace(result.redirectUrl);
          else fail('钉钉没有返回授权结果');
        },
        fail
      );
      document.getElementById('status').textContent='';
    }
  </script>
</body>
</html>`;
  const scriptOrigin = new URL(config.loginScriptUrl).origin;
  const frameOrigin = new URL(config.authUrl).origin;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${scriptOrigin}`,
    "style-src 'unsafe-inline'",
    `frame-src ${frameOrigin}`,
    "img-src data: https:",
    "connect-src 'self'"
  ].join("; ");
  return { html, csp };
}

function createDingtalkAuthWindow(authUrl, settle) {
  const parent = BrowserWindow.getAllWindows().find((candidate) => {
    if (candidate.isDestroyed()) return false;
    return candidate.webContents.getURL().includes("renderer/index.html");
  });
  const authWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 480,
    minHeight: 680,
    maxWidth: 480,
    maxHeight: 680,
    parent,
    modal: Boolean(parent),
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    title: "钉钉登录",
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: "persist:xianma-dingtalk-auth"
    }
  });

  authWindow.removeMenu();
  authWindow.once("ready-to-show", () => {
    if (!authWindow.isDestroyed()) authWindow.show();
  });
  authWindow.on("closed", () => settle("reject", new Error("已取消钉钉登录")));
  authWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    settle("reject", new Error(`钉钉登录页面加载失败：${errorDescription || errorCode}`));
  });
    settle(reject new Erroer ddfie description || errrprcode : de hdfo dh )
  authWindow.webContents.on("did-finish-load", async () => {
    try {
      const pageText = await authWindow.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true);
      const message = getDingtalkAuthPageError(pageText);
      if (message) settle("reject", new Error(message));
    } catch {
      // Cross-origin login page inspection is best-effort only.
    }
  });
  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const allowed = target.protocol === "https:" && (
        target.hostname === "login.dingtalk.com" || target.hostname.endsWith(".dingtalk.com")
      );
      if (allowed) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            parent: authWindow,
            modal: true,
            autoHideMenuBar: true,
            backgroundColor: "#ffffff",
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
          }
        };
      }
    } catch {
      // Invalid popup URLs are denied.
    }
    return { action: "deny" };
  });
  authWindow.loadURL(authUrl.toString()).catch((error) => {
    if (error?.code === "ERR_ABORTED" || error?.errno === -3) return;
    settle("reject", error);
  });
  return authWindow;
}

async function loginWithDingtalk() {
  const config = getDingtalkConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`钉钉登录尚未配置，请管理员填写 ${config.configPath} 中的 clientId/clientSecret`);
  }

  const redirect = new URL(config.redirectUri);
  if (!/^https?:$/i.test(redirect.protocol) || !["127.0.0.1", "localhost"].includes(redirect.hostname)) {
    throw new Error("钉钉回调地址必须是本机 localhost 或 127.0.0.1 地址");
  }

  const state = crypto.randomBytes(24).toString("hex");
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", config.prompt);
  if (config.corpId) authUrl.searchParams.set("corpId", config.corpId);
  const loginPagePath = redirect.pathname.replace(/\/[^/]*$/, "/login");
  const errorPagePath = redirect.pathname.replace(/\/[^/]*$/, "/error");
  const loginPageUrl = new URL(config.redirectUri);
  loginPageUrl.pathname = loginPagePath;
  loginPageUrl.search = "";

  let authWindow;
  let server;
  try {
    const callbackResult = await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => settle("reject", new Error("钉钉登录超时，请重新登录")), 180000);
      const settle = (type, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (type === "resolve") resolve(value);
        else reject(value);
      };
      server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url || "/", `http://${redirect.hostname}:${redirect.port || 80}`);
        if (requestUrl.pathname === loginPagePath) {
          const page = buildDingtalkQrLoginPage(config, authUrl, state, errorPagePath);
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": page.csp,
            "Cache-Control": "no-store"
          });
          response.end(page.html);
          return;
        }
        if (requestUrl.pathname === errorPagePath) {
          const rawMessage = requestUrl.searchParams.get("message") || "钉钉登录失败";
          const message = getDingtalkAuthPageError(rawMessage) || `钉钉登录失败：${String(rawMessage).slice(0, 180)}`;
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end("<!doctype html><meta charset=\"utf-8\"><title>登录失败</title><p>登录未完成</p>");
          settle("reject", new Error(message));
          return;
        }
        if (requestUrl.pathname !== redirect.pathname) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"
        });
        response.end("<!doctype html><meta charset=\"utf-8\"><title>登录完成</title><style>body{font-family:system-ui;margin:0;display:grid;place-items:center;height:100vh;color:#202124}main{text-align:center}p{color:#6b7280}</style><main><h2>登录完成</h2><p>请返回先马智能体继续使用。</p></main>");
        settle("resolve", {
          code: requestUrl.searchParams.get("authCode") || requestUrl.searchParams.get("code") || "",
          state: requestUrl.searchParams.get("state") || "",
          error: requestUrl.searchParams.get("error") || ""
        });
      });
      server.once("error", (error) => settle("reject", error));
      server.listen(Number(redirect.port || 80), redirect.hostname, async () => {
        try {
          if (config.useSystemBrowser) {
            await shell.openExternal(authUrl.toString());
          } else {
            authWindow = createDingtalkAuthWindow(config.embeddedQr ? loginPageUrl : authUrl, settle);
          }
        } catch (error) {
          settle("reject", error);
        }
      });
    });

    if (callbackResult.error) throw new Error(`钉钉授权失败：${callbackResult.error}`);
    if (callbackResult.state !== state) throw new Error("钉钉登录状态校验失败");
    if (!callbackResult.code) throw new Error("钉钉没有返回授权码");

    const tokenData = await requestDingtalkToken(config, {
      code: callbackResult.code,
      grantType: "authorization_code"
    });
    validateDingtalkCorp(config, String(tokenData.corpId || ""));
    const userData = await requestDingtalkUser(config, tokenData.accessToken);
    const user = normalizeDingtalkUser(userData, tokenData);
    const record = writeDingtalkSession(user, tokenData);
    return publicDingtalkSession(record);
  } finally {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    if (server) {
      await new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }
}

function extractGatewayText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractGatewayText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return extractGatewayText(value.text ?? value.content ?? value.message);
  return "";
}

function getGatewayDeviceIdentityPath() {
  return path.join(app.getPath("userData"), "identity", "device.json");
}

function publicKeyRawBase64Url(publicKeyPem) {
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: "jwk" });
  if (!jwk.x) throw new Error("能力服务设备公钥格式无效");
  return jwk.x;
}

function deriveGatewayDeviceId(publicKeyPem) {
  return crypto.createHash("sha256").update(Buffer.from(publicKeyRawBase64Url(publicKeyPem), "base64url")).digest("hex");
}

function loadOrCreateGatewayDeviceIdentity() {
  const identityPath = getGatewayDeviceIdentityPath();
  const stored = readJsonFile(identityPath);
  if (stored?.publicKeyPem && stored?.privateKeyPem) {
    try {
      const deviceId = deriveGatewayDeviceId(stored.publicKeyPem);
      const probe = Buffer.from("xianma-device-self-check", "utf8");
      const signature = crypto.sign(null, probe, crypto.createPrivateKey(stored.privateKeyPem));
      if (crypto.verify(null, probe, crypto.createPublicKey(stored.publicKeyPem), signature)) {
        return { deviceId, publicKeyPem: stored.publicKeyPem, privateKeyPem: stored.privateKeyPem };
      }
    } catch {
      // Invalid identity material is replaced below.
    }
  }

  function loadOrcreateGatewayDeviceIdentity()
  r
  }
eturn identityPath  = getGatewayDeviceIdentityPath();

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const identity = {
    version: 1,
    deviceId: "",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    createdAtMs: Date.now()
  };
  identity.deviceId = deriveGatewayDeviceId(identity.publicKeyPem);
  ensureDir(path.dirname(identityPath));
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), "utf8");
  return identity;
}

function buildGatewayDevicePayload(params) {
  const platform = String(params.platform || "").trim().toLowerCase();
  const deviceFamily = String(params.deviceFamily || "").trim().toLowerCase();
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token || "",
    params.nonce || "",
    platform,
    deviceFamily
  ].join("|");
}
function buildGatewayDevicepayload(params)



function buildGatewayDeviceParams(identity, params) {
  const signedAtMs = Date.now();
  const payload = buildGatewayDevicePayload({
    ...params,
    deviceId: identity.deviceId,
    signedAtMs
  });
  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
    signature: crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(identity.privateKeyPem)).toString("base64url"),
    signedAt: signedAtMs,
    nonce: params.nonce || ""
  };
}

function gatewayAttachmentMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return imageMimeByExtension.get(extension) || ({
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })[extension] || "application/octet-stream";
}


function prepareGatewayAttachments(filePaths) {
  const attachments = [];
  let totalBytes = 0;
  for (const filePath of (Array.isArray(filePaths) ? filePaths : []).slice(0, 8)) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const bytes = fs.statSync(filePath).size;
    if (bytes > 20 * 1024 * 1024) throw new Error(`附件过大：${path.basename(filePath)}，单个文件不能超过 20MB`);
    totalBytes += bytes;
    if (totalBytes > 32 * 1024 * 1024) throw new Error("本轮附件总大小不能超过 32MB");
    const mimeType = gatewayAttachmentMime(filePath);
    attachments.push({
      type: mimeType.startsWith("image/") ? "image" : "file",
      mimeType,
      fileName: path.basename(filePath),
      content: fs.readFileSync(filePath).toString("base64")
    });
  }
  return attachments;
}

function createGatewayClient(userId, conversationId) {
  const config = getGatewayConfig(userId);
  if (!config.url) throw new Error(`未配置本地能力服务。管理员可配置 ${config.configPath}`);
  if (typeof WebSocket !== "function") throw new Error("当前运行环境不支持 WebSocket");
  const gatewayUrl = new URL(config.url);
  if (gatewayUrl.protocol === "ws:" && !["127.0.0.1", "localhost", "::1"].includes(gatewayUrl.hostname)) {
    throw new Error("远程能力服务必须使用加密的 wss:// 连接");
  }
  const sessionKey = `${config.sessionKeyPrefix}:${safeWorkspaceSegment(userId)}:${safeWorkspaceSegment(conversationId || "default")}`;
  const identity = loadOrCreateGatewayDeviceIdentity();
  const socket = new WebSocket(config.url);
  const pending = new Map();
  let closed = false;
  let requestId = 0;
  let connectTimer;
  let connectSent = false;

  const sendRequest = (method, params) => new Promise((resolve, reject) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return reject(new Error("本地能力服务未连接"));
    const id = `desktop-${Date.now()}-${++requestId}`;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  const ready = new Promise((resolve, reject) => {
    connectTimer = setTimeout(() => reject(new Error("本地能力服务连接超时")), 10000);
    const sendConnect = (nonce = "") => {
      if (connectSent || closed || socket.readyState !== WebSocket.OPEN) return;
      connectSent = true;
      const clientId = "gateway-client";
      const clientMode = "backend";
      const role = "operator";
      const scopes = ["operator.read", "operator.write", "operator.approvals", "operator.admin"];
      socket.send(JSON.stringify({
        type: "req",
        id: `desktop-connect-${Date.now()}`,
        method: "connect",
        params: {
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: clientId,
            displayName: appDisplayName,
            version: app.getVersion(),
            platform: process.platform,
            deviceFamily: "desktop",
            mode: clientMode
          },
          role,
          scopes,
          caps: ["task-suggestions", "tool-events", "inline-widgets"],
          auth: config.token ? { token: config.token } : undefined,
          device: buildGatewayDeviceParams(identity, {
            clientId,
            clientMode,
            role,
            scopes,
            token: config.token,
            nonce,
            platform: process.platform,
            deviceFamily: "desktop"
          }),
          locale: "zh-CN",
          userAgent: "先马智能体桌面端"
        }
      }));
    };
    socket.addEventListener("open", () => {
      connectTimer = setTimeout(() => sendConnect(), 750);
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(String(event.data || "")); } catch { return; }
      if (frame.type === "event" && frame.event === "connect.challenge") {
        sendConnect(String(frame.payload?.nonce || ""));
        return;
      }
      if (frame.type === "res") {
        if (String(frame.id).startsWith("desktop-connect-")) {
          clearTimeout(connectTimer);
          if (frame.ok) resolve(frame.payload); else reject(new Error(frame.error?.message || "本地能力服务连接失败"));
          return;
        }
        const entry = pending.get(frame.id);
        if (!entry) return;
        pending.delete(frame.id);
        frame.ok ? entry.resolve(frame.payload) : entry.reject(new Error(frame.error?.message || "本地能力服务请求失败"));
      }
    });
    socket.addEventListener("error", () => reject(new Error("本地能力服务连接失败")));
    socket.addEventListener("close", () => {
      closed = true;
      for (const entry of pending.values()) entry.reject(new Error("本地能力服务连接已关闭"));
      pending.clear();
    });
  });

  return {
    async send(message, attachments = [], onEvent, model, signal) {
      await Promise.race([ready, rejectWhenGenerationStops(signal)]);
      if (signal?.aborted) throw createGenerationStoppedError();
      if (config.managed && model) {
        await Promise.race([
          sendRequest("sessions.patch", { key: sessionKey, model: `${managedGatewayProviderId}/${model}` }),
          rejectWhenGenerationStops(signal)
        ]);
      }
      if (signal?.aborted) throw createGenerationStoppedError();
      let response;
      try {
        response = await Promise.race([
          sendRequest("chat.send", {
            sessionKey,
            message,
            deliver: false,
            idempotencyKey: `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            attachments
          }),
          rejectWhenGenerationStops(signal)
        ]);
      } catch (error) {
        if (signal?.aborted) {
          sendRequest("chat.abort", { sessionKey }).catch(() => {});
          throw createGenerationStoppedError();
        }
        throw error;
      }
      if (signal?.aborted) {
        if (response?.runId) sendRequest("chat.abort", { sessionKey, runId: response.runId }).catch(() => {});
        throw createGenerationStoppedError();
      }
      if (!response?.runId || typeof onEvent !== "function") return response;
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeout;
        const cleanup = () => {
          clearTimeout(timeout);
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("close", handleClose);
          signal?.removeEventListener("abort", handleAbort);
        };
        const finish = (type, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (type === "resolve") resolve(value);
          else reject(value);
        };
        const handleEvent = (event) => {
          if (event?.event !== "chat") return;
          const payload = event.payload || {};
          if (payload.runId !== response.runId) return;
          onEvent(payload);
          if (["final", "aborted", "error"].includes(payload.state)) {
            if (payload.state === "aborted") finish("reject", createGenerationStoppedError());
            else finish("resolve", { ...response, content: payload.message?.content || payload.errorMessage || "任务已完成。" });
          }
        };
        const handleMessage = (event) => {
          try { handleEvent(JSON.parse(String(event.data || ""))); } catch { /* ignore malformed event */ }
        };
        const handleClose = () => finish("reject", signal?.aborted ? createGenerationStoppedError() : new Error("本地能力服务连接已关闭"));
        const handleAbort = () => {
          sendRequest("chat.abort", { sessionKey, runId: response.runId }).catch(() => {});
          finish("reject", createGenerationStoppedError());
        };
        timeout = setTimeout(() => finish("resolve", { ...response, content: "任务仍在后台执行，完成后可以继续在当前会话中查看结果。" }), 600000);
        socket.addEventListener("message", handleMessage);
        socket.addEventListener("close", handleClose, { once: true });
        signal?.addEventListener("abort", handleAbort, { once: true });
      });
    },
    async history() {
      await ready;
      return sendRequest("chat.history", { sessionKey, limit: 100 });
    },
    close() {
      closed = true;
      socket.close();
    }
  };
}

function workspaceFileKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".html", ".htm"].includes(extension)) return "website";
  if (imageMimeByExtension.has(extension)) return "image";
  if ([".doc", ".docx", ".pdf", ".rtf", ".odt"].includes(extension)) return "document";
  if ([".xls", ".xlsx", ".csv", ".ods"].includes(extension)) return "spreadsheet";
  if ([".ppt", ".pptx", ".odp"].includes(extension)) return "presentation";
  if ([".js", ".ts", ".jsx", ".tsx", ".css", ".json", ".md", ".txt", ".py", ".java", ".c", ".cpp", ".cs"].includes(extension)) return "code";
  return "file";
}

function describeWorkspaceFile(rootPath, targetPath) {
  const absolutePath = path.resolve(String(targetPath || ""));
  const relativePath = path.relative(rootPath, absolutePath);
  if (!absolutePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const extension = path.extname(absolutePath).toLowerCase();
  return {
    name: path.basename(absolutePath),
    path: absolutePath,
    absolutePath,
    relativePath,
    extension: extension.replace(/^\./, ""),
    kind: workspaceFileKind(absolutePath),
    bytes: stat.size,
    modifiedAtMs: stat.mtimeMs
  };
}
  const extension

function describeInputFile(filePath, includePreview = true) {
  const absolutePath = requireExistingFile(filePath);
  const stat = fs.statSync(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const kind = workspaceFileKind(absolutePath);
  const result = {
    name: path.basename(absolutePath),
    path: absolutePath,
    absolutePath,
    extension: extension.replace(/^\./, ""),
    kind,
    bytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
    mimeType: artifactMimeType(absolutePath),
    previewDataUrl: ""
  };
  if (includePreview && kind === "image" && stat.size <= 20 * 1024 * 1024) {
    const image = nativeImage.createFromPath(absolutePath);
    if (!image.isEmpty()) {
      const thumbnail = image.getSize().width > 640 || image.getSize().height > 640
        ? image.resize({ width: 640, height: 640, quality: "good" })
        : image;
      result.previewDataUrl = `data:${result.mimeType};base64,${thumbnail.toPNG().toString("base64")}`;
    }
  }
  return result;
}

function saveClipboardImage(userId = "local-user") {
  const image = clipboard.readImage();
  if (image.isEmpty()) throw new Error("剪贴板中没有可用图片");
  const attachmentDir = ensureDir(path.join(getUserWorkspaceDir(userId), "attachments"));
  const filePath = path.join(attachmentDir, `粘贴图片-${Date.now()}.png`);
  fs.writeFileSync(filePath, image.toPNG());
  return describeInputFile(filePath, true);
}

function mergeWorkspaceArtifacts(...groups) {
  const merged = new Map();
  for (const item of groups.flat()) {
    if (!item?.path) continue;
    merged.set(path.resolve(item.path).toLowerCase(), item);
  }
  return [...merged.values()].sort((left, right) => Number(right.modifiedAtMs || 0) - Number(left.modifiedAtMs || 0));
}

function filterRequestedArtifactFiles(files, userId, output) {
  const relativePath = String(output?.relativePath || "").trim();
  const format = String(output?.format || path.extname(relativePath).replace(/^\./, "")).toLowerCase();
  if (!relativePath || format !== "docx") return files;

  const { targetPath } = resolveUserWorkspacePath(userId, relativePath);
  const requestedPath = path.resolve(targetPath).toLowerCase();
  return mergeWorkspaceArtifacts(files).filter((file) => (
    path.resolve(file.path).toLowerCase() === requestedPath
    && path.extname(file.path).toLowerCase() === ".docx"
  )).slice(0, 1);
}

function artifactsFromToolResult(rootPath, toolResult) {
  const candidates = [];
  if (toolResult?.path) candidates.push(toolResult.path);
  if (Array.isArray(toolResult?.artifacts)) {
    for (const artifact of toolResult.artifacts) {
      if (artifact?.path) candidates.push(artifact.path);
    }
  }
  return candidates.map((candidate) => describeWorkspaceFile(rootPath, candidate)).filter(Boolean);
}

function findRecentlyChangedWorkspaceFiles(rootPath, sinceMs) {
  const stack = [rootPath];
  let visited = 0;
  const changed = [];
  while (stack.length && visited < 5000) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (visited >= 5000) break;
      if ([".git", "node_modules", ".cache"].includes(entry.name)) continue;
      const targetPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(targetPath);
        continue;
      }
      if (!entry.isFile()) continue;
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(targetPath).mtimeMs; } catch { continue; }
      if (mtimeMs < sinceMs - 1000) continue;
      const artifact = describeWorkspaceFile(rootPath, targetPath);
      if (artifact) changed.push(artifact);
    }
  }
  return mergeWorkspaceArtifacts(changed).slice(0, 24);
}

async function requestGatewayChat(payload, signal) {
  const client = createGatewayClient(payload?.userId || "local-user", payload?.conversationId);
  let streamedContent = "";
  const startedAt = Date.now();
  const runtimeConfig = getAiRuntimeConfig();
  const allowedModel = resolveChatModel(runtimeConfig, payload?.model);
  try {
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const lastUser = [...messages].reverse().find((item) => item?.role === "user");
    const response = await client.send(
      String(payload?.message || extractGatewayText(lastUser?.content) || ""),
      prepareGatewayAttachments(payload?.attachments),
      (event) => {
        if (typeof event?.deltaText === "string") {
          streamedContent = event.replace === true ? event.deltaText : `${streamedContent}${event.deltaText}`;
        }
      },
      allowedModel,
      signal
    );
    if (signal?.aborted) throw createGenerationStoppedError();
    const { rootPath } = resolveUserWorkspacePath(payload?.userId || "local-user");
    const files = findRecentlyChangedWorkspaceFiles(rootPath, startedAt);
    const previewPath = files.find((item) => item.kind === "website")?.path || "";
    if (previewPath) openHtmlPreview(previewPath);
    return {
      content: String(streamedContent || extractGatewayText(response?.message?.content) || extractGatewayText(response?.content) || "能力服务已接受任务，请稍后查看会话记录。"),
      gateway: true,
      runId: response?.runId || "",
      model: allowedModel,
      previewPath,
      files
    };
  } finally {
    client.close();
  }
}

function writeAiDiagnostic(event, details = {}) {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "model-service.log"),
      `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`,
      "utf8"
    );
  } catch {
    // Diagnostics must never affect a model request.
  }
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

function getStoreDir(userId = "local-user") {
  return ensureDir(path.join(app.getPath("userData"), "users", safeWorkspaceSegment(userId), "data"));
}

function safeWorkspaceSegment(value) {
  return String(value || "local-user").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "local-user";
}

function getUserWorkspaceDir(userId) {
  return ensureDir(path.join(app.getPath("userData"), "users", safeWorkspaceSegment(userId), "files"));
}

function getUserSkillsDir(userId = "local-user") {
  return ensureDir(path.join(app.getPath("userData"), "users", safeWorkspaceSegment(userId), "skills"));
}

function skillIdFromName(value) {
  const normalized = safeWorkspaceSegment(value).toLowerCase() || "skill";
  return `installed-${normalized}`;
}

function parseSimpleSkillFrontMatter(markdown) {
  const source = String(markdown || "");
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) values[key] = value;
  }
  return values;
}

function readSkillDescriptor(skillRoot, source = "installed") {
  const markdownPath = path.join(skillRoot, "SKILL.md");
  if (!fs.existsSync(markdownPath) || !fs.statSync(markdownPath).isFile()) {
    throw new Error("技能包必须包含 SKILL.md");
  }
  const markdown = fs.readFileSync(markdownPath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!markdown) throw new Error("SKILL.md 不能为空");
  const metadataPath = ["skill.json", "package.json"]
    .map((name) => path.join(skillRoot, name))
    .find((candidate) => fs.existsSync(candidate));
  let metadata = {};
  if (metadataPath) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch {
      throw new Error(`${path.basename(metadataPath)} 格式不正确`);
    }
  }
  const frontMatter = parseSimpleSkillFrontMatter(markdown);
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  const name = String(metadata.name || frontMatter.name || heading || path.basename(skillRoot)).trim().slice(0, 80);
  const description = String(metadata.description || frontMatter.description || markdown.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#.*$/m, "").trim().split(/\r?\n/).find(Boolean) || "已安装技能").trim().slice(0, 240);
  const category = String(metadata.category || frontMatter.category || "已安装技能").trim().slice(0, 40);
  const starter = String(metadata.starter || frontMatter.starter || `使用“${name}”处理以下内容：`).trim().slice(0, 240);
  const icon = ["file-stack", "file-text", "clipboard-list", "sparkles", "pen-line"].includes(metadata.icon) ? metadata.icon : "file-stack";
  const prompt = String(metadata.systemPrompt || frontMatter.systemPrompt || markdown).trim().slice(0, 50000);
  const fields = Array.isArray(metadata.fields) && metadata.fields.length
    ? metadata.fields.slice(0, 12).map((field, index) => ({
      id: safeWorkspaceSegment(field?.id || `field-${index + 1}`),
      label: String(field?.label || `输入内容 ${index + 1}`).slice(0, 60),
      type: field?.type === "textarea" ? "textarea" : "textarea",
      placeholder: String(field?.placeholder || "填写本技能需要处理的内容。").slice(0, 180)
    }))
    : [
      { id: "content", label: "输入内容", type: "textarea", placeholder: "填写要交给技能处理的内容，也可以先选择附件。" },
      { id: "extra", label: "补充说明", type: "textarea", placeholder: "补充输出格式、语气或其他要求。" }
    ];
  return {
    id: skillIdFromName(name),
    name,
    shortName: name.slice(0, 8),
    icon,
    category,
    description,
    starter,
    systemPrompt: `当前是已安装技能“${name}”。\n${prompt}`,
    fields,
    source,
    installed: true
  };
}




function findSkillRoot(rootPath) {
  if (fs.existsSync(path.join(rootPath, "SKILL.md"))) return rootPath;
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const child = entries.find((entry) => entry.isDirectory() && !entry.name.startsWith(".") && fs.existsSync(path.join(rootPath, entry.name, "SKILL.md")));
  return child ? path.join(rootPath, child.name) : rootPath;
}

function copySkillDirectory(sourcePath, targetPath) {
  ensureDir(targetPath);
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    if ([".git", "node_modules", ".DS_Store"].includes(entry.name)) continue;
    const source = path.join(sourcePath, entry.name);
    const target = path.join(targetPath, entry.name);
    if (entry.isDirectory()) copySkillDirectory(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

async function extractSkillZip(sourcePath, targetPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const names = Object.keys(zip.files);
  if (names.length > 500) throw new Error("技能包文件数量不能超过 500 个");
  for (const name of names) {
    const normalized = path.posix.normalize(String(name).replaceAll("\\", "/"));
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
      throw new Error("技能包包含不安全的文件路径");
    }
    const entry = zip.files[name];
    const outputPath = path.resolve(targetPath, normalized);
    const relative = path.relative(targetPath, outputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("技能包路径越界");
    if (entry.dir) {
      ensureDir(outputPath);
      continue;
    }
    const data = await entry.async("nodebuffer");
    if (data.byteLength > 10 * 1024 * 1024) throw new Error("技能包单个文件不能超过 10MB");
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, data);
  }
}

function listInstalledSkills(userId = "local-user") {
  const root = getUserSkillsDir(userId);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      try { return readSkillDescriptor(findSkillRoot(path.join(root, entry.name))); } catch { return null; }
    })
    .filter(Boolean);
}

async function installSkill(event, payload = {}) {
  let sourcePath = String(payload?.sourcePath || "").trim();
  if (!sourcePath) {
    const result = await dialog.showOpenDialog(senderWindow(event), {
      title: "安装技能",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "技能包", extensions: ["zip", "md", "json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    sourcePath = result.filePaths[0];
  }
  if (!fs.existsSync(sourcePath)) throw new Error("技能文件或文件夹不存在");
  const stat = fs.statSync(sourcePath);
  const sourceName = stat.isDirectory() ? path.basename(sourcePath) : path.basename(sourcePath, path.extname(sourcePath));
  const targetPath = path.join(getUserSkillsDir(payload?.userId || "local-user"), skillIdFromName(sourceName));
  fs.rmSync(targetPath, { recursive: true, force: true });
  ensureDir(targetPath);
  try {
    if (stat.isDirectory()) copySkillDirectory(sourcePath, targetPath);
    else if (/\.zip$/i.test(sourcePath)) await extractSkillZip(sourcePath, targetPath);
    else if (/\.md$/i.test(sourcePath)) fs.copyFileSync(sourcePath, path.join(targetPath, "SKILL.md"));
    else throw new Error("请选择技能 ZIP、技能文件夹或 SKILL.md");
    const descriptor = readSkillDescriptor(findSkillRoot(targetPath));
    return { installed: true, skill: descriptor };
  } catch (error) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    throw error;
  }
}

function removeInstalledSkill(payload = {}) {
  const id = String(payload?.skillId || "");
  if (!id.startsWith("installed-")) throw new Error("内置技能不能卸载");
  const root = getUserSkillsDir(payload?.userId || "local-user");
  const entry = fs.readdirSync(root, { withFileTypes: true }).find((candidate) => {
    if (!candidate.isDirectory()) return false;
    try { return readSkillDescriptor(findSkillRoot(path.join(root, candidate.name))).id === id; } catch { return false; }
  });
  if (!entry) throw new Error("技能不存在或已卸载");
  const target = path.join(root, entry.name);
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: true, skillId: id };
}

function resolveUserWorkspacePath(userId, relativePath = "") {
  const rootPath = getUserWorkspaceDir(userId);
  const targetPath = path.resolve(rootPath, String(relativePath || ""));
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("只能访问当前用户的本地文件目录");
  return { rootPath, targetPath };
}

function listWorkspace(rootPath, currentPath = rootPath, depth = 0) {
  if (depth > 4 || !fs.existsSync(currentPath)) return [];
  return fs.readdirSync(currentPath, { withFileTypes: true }).filter((entry) => ![".git", "node_modules"].includes(entry.name)).slice(0, 300).map((entry) => {
    const fullPath = path.join(currentPath, entry.name);
    let modifiedAtMs = 0;
    try { modifiedAtMs = fs.statSync(fullPath).mtimeMs; } catch { /* best effort metadata */ }
    return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", relativePath: path.relative(rootPath, fullPath), modifiedAtMs, children: entry.isDirectory() ? listWorkspace(rootPath, fullPath, depth + 1) : [] };
  });
}

function extractHtmlFromResponse(content) {
  const matches = [...String(content || "").matchAll(/```(?:html|htm)?\s*([\s\S]*?)```/gi)];
  return matches.map((match) => match[1].trim()).find((value) => /<(!doctype|html|body|canvas|script|style)/i.test(value)) || "";
}

function toolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "workspace_list",
        description: "列出当前用户可用的本地文件和目录。",
        parameters: { type: "object", properties: { relativePath: { type: "string" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "workspace_read",
        description: "读取当前用户本地目录中的文本文件。",
        parameters: { type: "object", required: ["relativePath"], properties: { relativePath: { type: "string" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "workspace_write",
        description: "创建或更新当前用户本地目录中的文本文件。只有用户明确要求创建或修改时才调用。",
        parameters: { type: "object", required: ["relativePath", "content"], properties: { relativePath: { type: "string" }, content: { type: "string" }, overwrite: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "workspace_write_document",
        description: "根据真实内容创建 Word 文档，并返回可下载的绝对路径。日报、周报、会议纪要等 Word 输出优先调用此工具。",
        parameters: {
          type: "object",
          required: ["relativePath", "title", "content"],
          properties: {
            relativePath: { type: "string", description: "以 .docx 结尾的本地相对路径" },
            title: { type: "string" },
            content: { type: "string", description: "需要写入文档的完整真实正文" },
            overwrite: { type: "boolean" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "workspace_run",
        description: "在当前用户的本地文件目录运行命令。用于启动或验证用户要求的项目；破坏性命令会被拒绝。",
        parameters: { type: "object", required: ["command"], properties: { command: { type: "string" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "workspace_preview",
        description: "把 HTML 内容写入当前用户本地目录并打开客户端网页预览。",
        parameters: { type: "object", required: ["relativePath", "html"], properties: { relativePath: { type: "string" }, html: { type: "string" } } }
      }
    }
  ];
}

function truncateToolResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > maxToolResultChars ? `${text.slice(0, maxToolResultChars)}\n...[结果已截断]` : text;
}

function parseToolArguments(rawArguments) {
  try {
    return typeof rawArguments === "string" ? JSON.parse(rawArguments || "{}") : (rawArguments || {});
  } catch {
    throw new Error("模型返回的工具参数不是有效 JSON");
  }
}

function isHighRiskWorkspaceCommand(command) {
  return /\b(format|shutdown|reboot|diskpart|reg\s+(delete|add)|del\s+\/s|rd\s+\/s|rmdir\s+\/s|remove-item|rm\s+-rf)\b/i.test(command);
}

function runWorkspaceCommand(userId, command, signal) {
  const { rootPath } = resolveUserWorkspacePath(userId);
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) throw new Error("缺少要运行的命令");
  if (isHighRiskWorkspaceCommand(normalizedCommand)) throw new Error("出于安全原因，已阻止高风险命令");
  if (signal?.aborted) return Promise.reject(createGenerationStoppedError());
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", normalizedCommand], { cwd: rootPath, windowsHide: true, env: { ...process.env, CI: "1" } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (type, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      if (type === "resolve") resolve(value);
      else reject(value);
    };
    const handleAbort = () => {
      if (child.exitCode === null) child.kill();
      finish("reject", createGenerationStoppedError());
    };
    const timer = setTimeout(() => child.kill(), 120000);
    signal?.addEventListener("abort", handleAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish("reject", error));
    child.on("close", (code, signal) => {
      finish("resolve", { command: normalizedCommand, cwd: rootPath, code: code ?? -1, signal: signal || "", stdout: stdout.slice(-20000), stderr: stderr.slice(-12000) });
    });
  });
}

async function executeWorkspaceTool(userId, toolCall, signal) {
  if (signal?.aborted) throw createGenerationStoppedError();
  const name = String(toolCall?.function?.name || toolCall?.name || "");
  const args = parseToolArguments(toolCall?.function?.arguments || toolCall?.arguments);
  if (name === "workspace_list") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath || "");
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) throw new Error("本地文件目录不存在");
    return { relativePath: args.relativePath || "", entries: listWorkspace(rootPath, targetPath) };
  }
  if (name === "workspace_read") {
    const { targetPath } = resolveUserWorkspacePath(userId, args.relativePath);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) throw new Error("本地文件不存在");
    return { relativePath: args.relativePath, content: fs.readFileSync(targetPath, "utf8").slice(0, maxToolResultChars) };
  }
  if (name === "workspace_write") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath);
    if (fs.existsSync(targetPath) && args.overwrite !== true) throw new Error(`文件已存在：${args.relativePath}。如需覆盖，请先明确确认。`);
    ensureDir(path.dirname(targetPath));
    const content = String(args.content || "");
    fs.writeFileSync(targetPath, content, "utf8");
    return { relativePath: path.relative(rootPath, targetPath), path: targetPath, bytes: Buffer.byteLength(content, "utf8") };
  }
  if (name === "workspace_write_document") {
    const requestedPath = String(args.relativePath || "");
    if (!/\.docx$/i.test(requestedPath)) throw new Error("Word 文档路径必须以 .docx 结尾");
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, requestedPath);
    if (fs.existsSync(targetPath) && args.overwrite !== true) throw new Error(`文件已存在：${requestedPath}。如需覆盖，请先明确确认。`);
    const content = String(args.content || "").trim();
    if (!content) throw new Error("缺少要写入 Word 文档的真实内容");
    ensureDir(path.dirname(targetPath));
    await writeDocx(targetPath, {
      resultTitle: String(args.title || path.basename(targetPath, path.extname(targetPath))),
      resultText: content,
      resultBody: content
    });
    const stat = fs.statSync(targetPath);
    return { relativePath: path.relative(rootPath, targetPath), path: targetPath, bytes: stat.size };
  }
  if (name === "workspace_run") {
    return runWorkspaceCommand(userId, args.command, signal);
  }
  if (name === "workspace_preview") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath || `generated/${Date.now()}-preview.html`);
    if (!targetPath.toLowerCase().endsWith(".html") && !targetPath.toLowerCase().endsWith(".htm")) throw new Error("网页预览文件必须是 HTML");
    const html = String(args.html || "");
    if (!html.trim()) throw new Error("缺少网页内容");
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, html, "utf8");
    openHtmlPreview(targetPath);
    return { relativePath: path.relative(rootPath, targetPath), path: targetPath, opened: true };
  }
  throw new Error(`不支持的文件工具：${name}`);
}

function openHtmlPreview(filePath) {
  const preview = new BrowserWindow({ width: 1180, height: 780, minWidth: 860, minHeight: 560, title: "先马智能体 - 网页预览", icon: appIcon, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  preview.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  preview.loadFile(filePath);
  return preview;
}

function isTextLikeFile(filePath) {
  return [".txt", ".md", ".csv", ".json", ".js", ".ts", ".jsx", ".tsx", ".css", ".html", ".htm", ".xml", ".yaml", ".yml", ".py", ".java", ".c", ".cpp", ".cs", ".log"].includes(path.extname(filePath).toLowerCase());
}

function requireExistingFile(targetPath) {
  const absolutePath = path.resolve(String(targetPath || ""));
  if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error("文件不存在或已被移动");
  }
  return absolutePath;
}

function artifactMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return imageMimeByExtension.get(extension) || ({
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf"
  })[extension] || "application/octet-stream";
}

function openLocalArtifactPreview(filePath) {
  const preview = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    title: `先马智能体 - ${path.basename(filePath)}`,
    icon: appIcon,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.loadURL(pathToFileURL(filePath).toString());
  return preview;
}

function previewArtifact(targetPath) {
  const absolutePath = requireExistingFile(targetPath);
  const stat = fs.statSync(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const kind = workspaceFileKind(absolutePath);
  const base = {
    path: absolutePath,
    name: path.basename(absolutePath),
    extension: extension.replace(/^\./, ""),
    kind,
    bytes: stat.size
  };

  if ([".html", ".htm", ".pdf"].includes(extension)) {
    openLocalArtifactPreview(absolutePath);
    return { ...base, previewType: "window" };
  }

  if (kind === "image" || extension === ".svg") {
    const mimeType = artifactMimeType(absolutePath);
    return {
      ...base,
      previewType: "image",
      dataUrl: `data:${mimeType};base64,${fs.readFileSync(absolutePath).toString("base64")}`
    };
  }

  if (isTextLikeFile(absolutePath) && stat.size <= 8 * 1024 * 1024) {
    return { ...base, previewType: "text", content: fs.readFileSync(absolutePath, "utf8") };
  }

  return { ...base, previewType: "file" };
}

function copyArtifact(targetPath) {
  const absolutePath = requireExistingFile(targetPath);
  const kind = workspaceFileKind(absolutePath);
  if (kind === "image") {
    const image = nativeImage.createFromPath(absolutePath);
    if (image.isEmpty()) throw new Error("图片读取失败，无法复制");
    clipboard.writeImage(image);
    return { path: absolutePath, copiedAs: "image" };
  }


  function copyAr

  if (process.platform === "win32") {
    clipboard.clear();
    clipboard.writeBuffer("FileNameW", Buffer.from(`${absolutePath}\0`, "utf16le"));
    return { path: absolutePath, copiedAs: "file" };
  }

  clipboard.writeText(absolutePath);
  return { path: absolutePath, copiedAs: "path" };
}

async function downloadArtifact(event, targetPath) {
  const absolutePath = requireExistingFile(targetPath);
  const owner = BrowserWindow.fromWebContents(event.sender) || undefined;
  const options = {
    title: "下载文件",
    defaultPath: path.join(app.getPath("downloads"), path.basename(absolutePath)),
    buttonLabel: "保存"
  };
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { canceled: true };
  const destination = path.resolve(result.filePath);
  if (destination.toLowerCase() !== absolutePath.toLowerCase()) {
    ensureDir(path.dirname(destination));
    fs.copyFileSync(absolutePath, destination);
  }
  return { canceled: false, path: destination };
}

function openWithSystemChooser(targetPath) {
  if (process.platform !== "win32") return shell.openPath(targetPath);
  const child = spawn("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", targetPath], {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
  return undefined;
}

function showGeneratedFileContextMenu(sender, targetPath) {
  const absolutePath = requireExistingFile(targetPath);
  const extension = path.extname(absolutePath).toLowerCase();
  const isHtml = [".html", ".htm"].includes(extension);
  const isText = isTextLikeFile(absolutePath) && fs.statSync(absolutePath).size <= 2 * 1024 * 1024;
  const openWithSubmenu = [
    { label: "使用系统默认程序", click: () => shell.openPath(absolutePath) },
    ...(isHtml ? [
      { label: "在应用内预览", click: () => openHtmlPreview(absolutePath) },
      { label: "使用浏览器打开", click: () => shell.openExternal(pathToFileURL(absolutePath).toString()) }
    ] : []),
    ...(isText && process.platform === "win32" ? [
      { label: "使用记事本打开", click: () => spawn("notepad.exe", [absolutePath], { detached: true, windowsHide: false, stdio: "ignore" }).unref() }
    ] : []),
    { type: "separator" },
    { label: "选择其他应用...", click: () => openWithSystemChooser(absolutePath) }
  ];
  const menu = Menu.buildFromTemplate([
    { label: "打开文件", click: () => (isHtml ? openHtmlPreview(absolutePath) : shell.openPath(absolutePath)) },
    { label: "打开方式", submenu: openWithSubmenu },
    { type: "separator" },
    { label: "复制路径", click: () => clipboard.writeText(absolutePath) },
    {
      label: "复制文件内容",
      enabled: isText,
      click: () => clipboard.writeText(fs.readFileSync(absolutePath, "utf8"))
    },
    { label: "在资源管理器中显示", click: () => shell.showItemInFolder(absolutePath) }
  ]);
  const owner = BrowserWindow.fromWebContents(sender);
  menu.popup({ window: owner || undefined });
  return { shown: true, path: absolutePath };
}

function getResultsDir(userId = "local-user") {
  return ensureDir(path.join(getStoreDir(userId), "results"));
}

function getStorePath(userId = "local-user") {
  return path.join(getStoreDir(userId), "tasks-store.json");
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeFileName(value, fallback = "结果") {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}


function readTaskStore(userId = "local-user") {
  const storePath = getStorePath(userId);
  const store = readJsonFile(storePath) || {};
  const scheduled = Array.isArray(store.scheduledTasks) && store.scheduledTasks.length
    ? store.scheduledTasks
    : defaultScheduledTasks;
  const taskRuns = Array.isArray(store.taskRuns) ? store.taskRuns : [];

  const normalized = {
    version: 1,
    scheduledTasks: scheduled,
    taskRuns
  };
  if (!fs.existsSync(storePath)) {
    writeTaskStore(userId, normalized);
  }
  return normalized;
}

function writeTaskStore(userId, store) {
  const payload = {
    version: 1,
    scheduledTasks: Array.isArray(store?.scheduledTasks) ? store.scheduledTasks : defaultScheduledTasks,
    taskRuns: Array.isArray(store?.taskRuns) ? store.taskRuns : []
  };
  ensureDir(path.dirname(getStorePath(userId)));
  fs.writeFileSync(getStorePath(userId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function upsertTaskRun(userId, record) {
  const store = readTaskStore(userId);
  const existingIndex = store.taskRuns.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) {
    store.taskRuns[existingIndex] = { ...store.taskRuns[existingIndex], ...record };
  } else {
    store.taskRuns.unshift(record);
  }
  store.taskRuns = store.taskRuns.slice(0, 200);
  writeTaskStore(userId, store);
  return record;
}

function paragraphFromLine(line) {
  const text = String(line || "");
  if (!text.trim()) {
    return new Paragraph({ text: "" });
  }
  if (/^(一、|二、|三、|四、|五、|六、|会议摘要|关键决议|待办事项|风险问题|本周完成|进行中|下周计划)/.test(text)) {
    return new Paragraph({
      text,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 180, after: 100 }
    });
  }
  return new Paragraph({
    children: [new TextRun({ text })],
    spacing: { after: 90 }
  });
}

function defaultDocumentContent(payload) {
  const providedContent = String(
    payload?.resultText ||
    payload?.resultBody ||
    payload?.content ||
    ""
  ).trim();
  if (providedContent) return providedContent;


  const skillId = payload?.skillId || "";
  if (skillId === "meeting") {
    return [
      "会议摘要",
      "本次会议围绕项目进度、资源协同和交付风险进行讨论，已形成明确行动项。",
      "",
      "关键决议",
      "1. 本周优先完成核心页面与文件落盘能力验证。",
      "2. 后续任务调度、审批与后台配置按企业服务接口逐步接入。",
      "",
      "待办事项",
      "1. 产品负责人：确认会议纪要模板字段与导出格式。",
      "2. 技术负责人：补齐真实任务调度接口契约。",
      "3. 运维负责人：确认安装包分发与签名流程。"
    ].join("\n");
  }

  if (skillId === "copywriting") {
    return payload?.resultText || payload?.resultBody || "文案润色结果";
  }

  return "未提供可写入文档的真实内容。";
}
async function writedocx (fikepath payload) resultTile d
async function writeDocx(filePath, payload) {
  const title = payload?.resultTitle || payload?.historyTitle || "任务结果";
  const content = defaultDocumentContent(payload);
  const paragraphs = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 220 }
    }),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${new Date().toLocaleString("zh-CN")}`, italics: true })],
      spacing: { after: 180 }
    }),
    ...content.split(/\r?\n/).map(paragraphFromLine)
  ];
  const document = new Document({
    creator: appDisplayName,
    title,
    sections: [{ children: paragraphs }]
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function extractArtifactBody(content, format) {
  const source = String(content || "").trim();
  if (!source) return "";
  const normalizedFormat = String(format || "").toLowerCase();
  if (normalizedFormat === "html" || normalizedFormat === "htm") {
    const fencedHtml = extractHtmlFromResponse(source);
    if (fencedHtml) return fencedHtml;
    const start = source.search(/<!doctype\s+html|<html[\s>]/i);
    if (start >= 0) {
      const endTag = source.toLowerCase().lastIndexOf("</html>");
      return source.slice(start, endTag >= start ? endTag + 7 : undefined).trim();
    }
  }

  const codeBlocks = [...source.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)]
    .map((match) => ({ language: String(match[1] || "").trim().toLowerCase(), body: String(match[2] || "").trim() }));
  const aliases = ({ js: ["js", "javascript"], py: ["py", "python"], md: ["md", "markdown"], json: ["json"], txt: ["txt", "text"] })[normalizedFormat] || [normalizedFormat];
  const preferred = codeBlocks.find((block) => aliases.includes(block.language));
  if (preferred?.body) return preferred.body;
  if (codeBlocks.length === 1 && codeBlocks[0].body) return codeBlocks[0].body;
  return source;
}

function cleanDocumentMarkdown(content) {
  return String(content || "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

const supportedDocumentFormats = new Set([
  "docx", "pptx", "xlsx", "pdf", "odt", "ods", "odp", "rtf",
  "html", "htm", "md", "markdown", "txt", "csv", "json", "xml", "zip"
]);

function normalizeDocumentFormat(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/^\./, "");
  const aliases = {
    word: "docx",
    document: "docx",
    powerpoint: "pptx",
    presentation: "pptx",
    excel: "xlsx",
    spreadsheet: "xlsx",
    markdown: "md",
    text: "txt",
    webpage: "html",
    web: "html",
    openoffice: "odt"
  };
  const format = aliases[normalized] || normalized;
  return supportedDocumentFormats.has(format) ? (format === "markdown" ? "md" : format) : "docx";
}

function documentContentLines(content) {
  const source = String(content || "")
    .replace(/```[^\r\n`]*\r?\n([\s\S]*?)```/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
  return (source || "未提供正文内容。").split("\n").map((line) => line.trimEnd());
}

function documentSections(content, fallbackTitle) {
  const sections = [];
  let current = { heading: fallbackTitle || "正文", lines: [] };
  for (const rawLine of documentContentLines(content)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]
      || line.match(/^【(.+)】$/)?.[1]
      || line.match(/^(?:一|二|三|四|五|六|七|八|九|十)、(.+)$/)?.[0];
    if (heading && current.lines.length) {
      sections.push(current);
      current = { heading: heading.replace(/^#+\s*/, ""), lines: [] };
    } else if (heading && !current.lines.length) {
      current.heading = heading.replace(/^#+\s*/, "");
    } else if (line) {
      current.lines.push(line.replace(/^[-*]\s+/, "• ").replace(/^\d+[.)]\s+/, "• "));
    }
  }
  if (current.lines.length || !sections.length) sections.push(current);
  return sections;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitTableLine(line) {
  const text = String(line || "").trim();
  if (!text.includes("|")) return [text];
  return text.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function writePptx(filePath, payload) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = appDisplayName;
  pptx.company = "先马";
  pptx.subject = String(payload?.resultTitle || "文档");
  pptx.title = String(payload?.documentTitle || payload?.resultTitle || "演示文稿");
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
    lang: "zh-CN"
  };
  const title = String(payload?.documentTitle || payload?.resultTitle || "演示文稿");
  const sections = documentSections(payload?.resultText || payload?.resultBody, title);
  const cover = pptx.addSlide();
  cover.background = { color: "F7F8FA" };
  cover.addText(title, { x: 0.8, y: 2.2, w: 11.7, h: 0.8, fontFace: "Microsoft YaHei", fontSize: 28, bold: true, color: "1F2937", align: "center", margin: 0.05, fit: "shrink" });
  cover.addText(`生成时间：${new Date().toLocaleString("zh-CN")}`, { x: 1.2, y: 3.25, w: 10.9, h: 0.35, fontFace: "Microsoft YaHei", fontSize: 11, color: "6B7280", align: "center", margin: 0.02 });
  for (const section of sections.slice(0, 30)) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, line: { color: "2563EB", transparency: 100 }, fill: { color: "2563EB" } });
    slide.addText(section.heading || title, { x: 0.65, y: 0.55, w: 12, h: 0.55, fontFace: "Microsoft YaHei", fontSize: 22, bold: true, color: "111827", margin: 0.02, fit: "shrink" });
    const body = section.lines.length ? section.lines.join("\n") : "暂无补充内容";
    slide.addText(body, { x: 0.85, y: 1.45, w: 11.65, h: 5.2, fontFace: "Microsoft YaHei", fontSize: 17, color: "374151", breakLine: false, valign: "top", margin: 0.08, breakLine: false, fit: "shrink", paraSpaceAfterPt: 12, bullet: { type: "bullet" } });
  }
  return pptx.writeFile({ fileName: filePath });
}

  const workbook = new ExcelJS.Workbook();
  workbook.creator = appDisplayName;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("文档内容");
  const title = String(payload?.documentTitle || payload?.resultTitle || "文档");
  sheet.addRow([title]);
  sheet.addRow([`生成时间：${new Date().toLocaleString("zh-CN")}`]);
  sheet.addRow([]);
  for (const line of documentContentLines(payload?.resultText || payload?.resultBody)) {
    const row = splitTableLine(line);
    sheet.addRow(row);
  }
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF1F2937" } };
  sheet.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };
  sheet.columns.forEach((column) => { column.width = Math.min(48, Math.max(14, ...sheet.getColumn(column.number).values.map((value) => String(value || "").length + 2))); });
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  await workbook.xlsx.writeFile(filePath);
}

function resolvePdfFont() {
  const candidates = [
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "simhei.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "Deng.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "Helvetica";
}
function resolvepdFont() {
  const candidates = [
      path.join(process.env.WINDIR || "C\\Windows0", "Fronts 0" simhei.ttf),
      path.join(procsess.env.WinDIR) ||cintrol.env Fronts 0 simhei sttsf  
  ]
}
function writePdf(filePath, payload) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 60, right: 60 }, autoFirstPage: true });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    document.pipe(stream);
    document.font(resolvePdfFont());
    document.fontSize(22).fillColor("#1F2937").text(String(payload?.documentTitle || payload?.resultTitle || "文档"), { align: "center" });
    document.moveDown(0.6).fontSize(9).fillColor("#6B7280").text(`生成时间：${new Date().toLocaleString("zh-CN")}`, { align: "center" });
    document.moveDown(1.2).fontSize(11).fillColor("#374151");
    for (const line of documentContentLines(payload?.resultText || payload?.resultBody)) {
      if (!line.trim()) document.moveDown(0.55);
      else document.text(line.replace(/^[-*]\s+/, "• "), { paragraphGap: 5, lineGap: 3 });
    }
    document.end();
  });
}

function odfManifest(mimeType) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:media-type="${mimeType}" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/></manifest:manifest>`;
}

function odfContent(format, title, lines) {
  const text = lines.map((line) => `<text:p>${escapeXml(line)}</text:p>`).join("");
  if (format === "odt") {
    return `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:h text:outline-level="1">${escapeXml(title)}</text:h>${text}</office:text></office:body></office:document-content>`;
  }
  if (format === "ods") {
    const rows = lines.map((line) => `<table:table-row><table:table-cell office:value-type="string"><text:p>${escapeXml(line)}</text:p></table:table-cell></table:table-row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="文档内容">${rows}</table:table></office:spreadsheet></office:body></office:document-content>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:body><office:presentation><draw:page draw:name="第1页"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="24cm" svg:height="15cm"><draw:text-box>${text}</draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>`;
}

async function writeOdf(filePath, payload, format) {
  const mimeTypes = { odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation" };
  const zip = new JSZip();
  zip.file("mimetype", mimeTypes[format], { compression: "STORE" });
  zip.file("content.xml", odfContent(format, String(payload?.documentTitle || payload?.resultTitle || "文档"), documentContentLines(payload?.resultText || payload?.resultBody)));
  zip.file("styles.xml", `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:styles/></office:document-styles>`);
  zip.file("meta.xml", `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:meta><meta:generator xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">${escapeXml(appDisplayName)}</meta:generator></office:meta></office:document-meta>`);
  zip.file("META-INF/manifest.xml", odfManifest(mimeTypes[format]));
  fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

function rtfEscape(value) {
  return String(value || "").split("").map((char) => {
    const code = char.charCodeAt(0);
    return code > 127 ? `\\u${code}?` : char.replace(/[\\{}]/g, "\\$&");
  }).join("");
}

function writeRtf(filePath, payload) {
  const title = payload?.documentTitle || payload?.resultTitle || "文档";
  const lines = documentContentLines(payload?.resultText || payload?.resultBody);
  fs.writeFileSync(filePath, `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\f0\\fs28 ${rtfEscape(title)}\\par\\fs22 ${lines.map(rtfEscape).join("\\par ")}}`, "utf8");
}

async function writeDocumentFile(filePath, payload, format) {
  const normalizedFormat = normalizeDocumentFormat(format || path.extname(filePath));
  const content = String(payload?.resultText || payload?.resultBody || "").trim();
  if (normalizedFormat === "docx") return writeDocx(filePath, payload);
  if (normalizedFormat === "pptx") return writePptx(filePath, payload);
  if (normalizedFormat === "xlsx") return writeXlsx(filePath, payload);
  if (normalizedFormat === "pdf") return writePdf(filePath, payload);
  if (["odt", "ods", "odp"].includes(normalizedFormat)) return writeOdf(filePath, payload, normalizedFormat);
  if (normalizedFormat === "rtf") return writeRtf(filePath, payload);
  if (normalizedFormat === "html" || normalizedFormat === "htm") {
    const html = /<html[\s>]|<!doctype\s+html/i.test(content) ? content : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeXml(payload?.documentTitle || "文档")}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;max-width:900px;margin:40px auto;line-height:1.8;color:#1f2937}h1{border-bottom:1px solid #ddd;padding-bottom:12px;white-space:pre-wrap}pre{white-space:pre-wrap}</style></head><body><h1>${escapeXml(payload?.documentTitle || "文档")}</h1><pre>${escapeXml(content)}</pre></body></html>`;
    return fs.writeFileSync(filePath, html, "utf8");
  }
  if (normalizedFormat === "json") return fs.writeFileSync(filePath, JSON.stringify({ title: payload?.documentTitle || "文档", generatedAt: nowIso(), content, lines: documentContentLines(content) }, null, 2), "utf8");
  if (normalizedFormat === "xml") return fs.writeFileSync(filePath, `<?xml version="1.0" encoding="UTF-8"?><document><title>${escapeXml(payload?.documentTitle || "文档")}</title><generatedAt>${nowIso()}</generatedAt><content>${escapeXml(content)}</content></document>`, "utf8");
  if (normalizedFormat === "csv") return fs.writeFileSync(filePath, documentContentLines(content).map((line) => splitTableLine(line).map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n"), "utf8");
  if (normalizedFormat === "zip") {
    const zip = new JSZip();
    zip.file("README.txt", `${payload?.documentTitle || "文档"}\r\n\r\n${content}\r\n`);
    zip.file("metadata.json", JSON.stringify({ title: payload?.documentTitle || "文档", generatedAt: nowIso() }, null, 2));
    return fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  return fs.writeFileSync(filePath, content, "utf8");
}

async function createRequestedArtifact(userId, output, content) {
  const relativePath = String(output?.relativePath || "").trim();
  const format = normalizeDocumentFormat(output?.format || path.extname(relativePath));
  const extractedBody = extractArtifactBody(content, format);
  const body = ["docx", "pptx", "xlsx", "pdf", "odt", "ods", "odp", "rtf"].includes(format)
    ? cleanDocumentMarkdown(extractedBody)
    : extractedBody;
  if (!relativePath || !body) return [];
  const { rootPath, targetPath } = resolveUserWorkspacePath(userId, relativePath);
  ensureDir(path.dirname(targetPath));
  await writeDocumentFile(targetPath, {
    ...output,
    resultTitle: String(output?.title || path.basename(targetPath, path.extname(targetPath))),
    resultText: body,
    resultBody: body
  }, format);
  return [describeWorkspaceFile(rootPath, targetPath)].filter(Boolean);
}

function writeTextFile(filePath, payload) {
  const content = [
    payload?.resultTitle || payload?.historyTitle || "任务结果",
    "",
    payload?.resultText || payload?.resultBody || "已完成处理。",
    "",
    `生成时间：${new Date().toLocaleString("zh-CN")}`
  ].join("\n");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writePlaceholderPng(filePath) {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAZElEQVR4nO3QMQEAAAgDINc/9F2hQAkJrKwuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4G24AAAFkf7YzAAAAAElFTkSuQmCC";
  fs.writeFileSync(filePath, Buffer.from(pngBase64, "base64"));
}

function copyOrCreateImageResults(targetDir, payload) {
  const inputFiles = Array.isArray(payload?.selectedFiles) ? payload.selectedFiles : [];
  const imageFiles = inputFiles.filter((filePath) => /\.(png|jpe?g|webp|gif)$/i.test(String(filePath || "")) && fs.existsSync(filePath));
  const count = Math.max(imageFiles.length, Number(payload?.imageCount) || 3);
  const artifacts = [];

  for (let index = 0; index < count; index += 1) {
    const sourcePath = imageFiles[index];
    const extension = sourcePath ? path.extname(sourcePath) : ".png";
    const nameBase = sourcePath ? safeFileName(path.basename(sourcePath, extension), `图片-${index + 1}`) : `图片-${index + 1}`;
    const filePath = path.join(targetDir, `${nameBase}-处理结果${extension || ".png"}`);
    if (sourcePath) {
      fs.copyFileSync(sourcePath, filePath);
    } else {
      writePlaceholderPng(filePath);
    }
    artifacts.push({
      type: "image",
      label: path.basename(filePath),
      path: filePath,
      src: pathToFileURL(filePath).toString()
    });
  }

  fs.writeFileSync(
    path.join(targetDir, "处理说明.txt"),
    [
      payload?.resultTitle || "图片处理结果",
      payload?.resultBody || "图片结果已写入当前目录。",
      "",
      "说明：处理结果已落盘并记录；具体算法按当前技能参数执行。",
      `生成时间：${new Date().toLocaleString("zh-CN")}`
    ].join("\n"),
    "utf8"
  );

  return artifacts;
}

async function createTaskResult(payload) {
  const id = payload?.id || createId("task");
  const outputFormat = normalizeDocumentFormat(payload?.outputFormat || payload?.format || "docx");
  const rawTitle = String(payload?.resultTitle || payload?.historyTitle || "任务结果");
  const title = safeFileName(rawTitle.replace(new RegExp(`\\.${outputFormat}(?:\\s+已生成)?$`, "i"), ""));
  const userId = payload?.userId || "local-user";
  const folderPath = ensureDir(path.join(getResultsDir(userId), `${new Date().toISOString().slice(0, 10)}-${id}`));
  let artifacts = [];

  if (payload?.resultType === "images") {
    artifacts = copyOrCreateImageResults(folderPath, payload);
  } else if (payload?.resultType === "text" && payload?.resultText) {
    const docxPath = path.join(folderPath, `${title}.docx`);
    const txtPath = path.join(folderPath, `${title}.txt`);
    await writeDocx(docxPath, payload);
    writeTextFile(txtPath, payload);
    artifacts = [
      { type: "document", label: path.basename(docxPath), path: docxPath },
      { type: "text", label: path.basename(txtPath), path: txtPath }
    ];
  } else {
    const format = outputFormat;
    const outputPath = path.join(folderPath, `${title}.${format}`);
    await writeDocumentFile(outputPath, {
      ...payload,
      documentTitle: payload?.documentTitle || title,
      resultTitle: title,
      resultText: payload?.resultText || payload?.resultBody || ""
    }, format);
    artifacts = [{ type: workspaceFileKind(outputPath), label: path.basename(outputPath), path: outputPath }];
  }

  const record = {
    id,
    skillId: payload?.skillId || "",
    title: payload?.historyTitle || payload?.resultTitle || "任务结果",
    description: payload?.resultBody || "",
    status: payload?.cancelled ? "已取消" : "已完成",
    resultType: payload?.resultType || "document",
    folderPath,
    primaryPath: artifacts[0]?.path || folderPath,
    artifacts,
    prompt: payload?.prompt || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  return upsertTaskRun(userId, record);
}

function findTaskRun(userId, taskId) {
  return readTaskStore(userId).taskRuns.find((task) => task.id === taskId) || null;
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    ensureDir(targetPath);
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function downloadTaskResult(payload) {
  const userId = payload?.userId || "local-user";
  const task = payload?.taskId ? findTaskRun(userId, payload.taskId) : null;
  const sourcePath = task?.primaryPath || payload?.primaryPath || payload?.folderPath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("结果文件不存在，请重新生成任务结果。");
  }

  const downloadsDir = app.getPath("downloads");
  const sourceStat = fs.statSync(sourcePath);
  const baseName = safeFileName(task?.title || payload?.title || path.basename(sourcePath), "任务结果");
  const targetPath = sourceStat.isDirectory()
    ? path.join(downloadsDir, baseName)
    : path.join(downloadsDir, path.basename(sourcePath));
  copyRecursive(sourcePath, targetPath);
  return { path: targetPath, isDirectory: fs.statSync(targetPath).isDirectory() };
}

function getAiConfigPath() {
  return String(process.env.XIANMA_AI_CONFIG || "").trim() || defaultAiConfigPath;
}

function getAiRuntimeConfig() {
  const configPath = getAiConfigPath();
  const fileConfig = readJsonFile(configPath) || {};

  const apiBaseUrl = normalizeApiBase(
    process.env.XIANMA_AI_BASE_URL ||
    fileConfig.apiBaseUrl ||
    fileConfig.baseUrl ||
    fileConfig.proxyBaseUrl ||
    defaultCompanyAiBaseUrl
  );
  const environmentApiKey = String(process.env.XIANMA_AI_API_KEY || "").trim();
  const fileApiKey = String(fileConfig.apiKey || "").trim();
  const bundledApiKey = readBundledCredential("ai");
  const apiKey = String(environmentApiKey || fileApiKey || bundledApiKey || defaultCompanyAiApiKey).trim();
  const model = String(process.env.XIANMA_AI_MODEL || fileConfig.model || defaultCompanyAiModel).trim();
  const imageModel = String(process.env.XIANMA_IMAGE_MODEL || fileConfig.imageModel || defaultCompanyImageModel).trim();
  const configuredModels = Array.isArray(fileConfig.models) && fileConfig.models.length ? fileConfig.models : defaultModelOptions;
  const providerModels = configuredModels.map((item) => {
    if (typeof item === "string") return { label: item, value: item, kind: "chat" };
    const label = String(item?.label || item?.value || "");
    const normalizedLabel = label.toLowerCase();
    const value = normalizedLabel.includes("terra")
      ? ["gpt", "5.6", "terra"].join("-")
      : (normalizedLabel.includes("luna")
        ? ["gpt", "5.6", "luna"].join("-")
        : (normalizedLabel === "5.5" || normalizedLabel.includes("5.5")
          ? ["gpt", "5.5"].join("-")
          : String(item?.value || item?.label || "")));
    const configuredKind = String(item?.kind || "").toLowerCase();
    const kind = configuredKind === "auto" || configuredKind === "image" ? configuredKind : "chat";
    return { label, value, kind };
  }).filter((item) => item.label && item.value);
  const models = [
    automaticModelOption,
    ...providerModels.filter((item) => item.value !== automaticModelOption.value && item.value !== imageSelectionModelOption.value),
    imageSelectionModelOption
  ];
  const source = process.env.XIANMA_AI_BASE_URL || environmentApiKey || process.env.XIANMA_AI_MODEL || process.env.XIANMA_IMAGE_MODEL
    ? "environment"
    : (fileApiKey ? "admin-file" : (bundledApiKey ? "bundled" : (Object.keys(fileConfig).length ? "admin-file" : "company-default")));

  return {
    apiBaseUrl,
    apiKey,
    model: model || defaultCompanyAiModel,
    imageModel: imageModel || defaultCompanyImageModel,
    models,
    source,
    configPath
  };
}

function getChatModelOptions(runtimeConfig) {
  const options = (runtimeConfig.models || []).filter((item) => (
    item?.kind !== "auto"
    && item?.kind !== "image"
    && item?.value !== automaticModelOption.value
    && item?.value !== imageSelectionModelOption.value
  ));
  const configuredModel = String(runtimeConfig.model || "").trim();
  if (configuredModel && !options.some((item) => item.value === configuredModel)) {
    options.unshift({ label: configuredModel, value: configuredModel, kind: "chat" });
  }
  return options.length ? options : [{ label: defaultCompanyAiModel, value: defaultCompanyAiModel, kind: "chat" }];
}

function resolveChatModel(runtimeConfig, requestedModel) {
  const options = getChatModelOptions(runtimeConfig);
  const requested = String(requestedModel || "").trim();
  if (options.some((item) => item.value === requested)) return requested;
  const configuredModel = String(runtimeConfig.model || "").trim();
  if (options.some((item) => item.value === configuredModel)) return configuredModel;
  return options[0].value;
}

function resolveImageModel(runtimeConfig, requestedModel) {
  const requested = String(requestedModel || "").trim();
  if (requested === imageSelectionModelOption.value) return requested;
  return runtimeConfig.imageModel || defaultCompanyImageModel;
}

function safeAiRuntimeConfig() {
  const config = getAiRuntimeConfig();
  return {
    configured: Boolean(config.apiBaseUrl),
    model: config.model,
    imageModel: config.imageModel,
    models: config.models
  };
}

function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const normalized = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      normalized.push({ type: "text", text: part.text });
    }
    if (part.type === "image_url" && part.image_url?.url) {
      normalized.push({
        type: "image_url",
        image_url: { url: String(part.image_url.url) }
      });
    }
  }
  return normalized;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && message.content != null)
    .map((message) => ({
      role: ["system", "user", "assistant"].includes(message.role) ? message.role : "user",
      content: normalizeMessageContent(message.content)
    }))
    .filter((message) => {
      if (typeof message.content === "string") {
        return message.content.trim();
      }
      return Array.isArray(message.content) && message.content.length;
    });
}

function getImageAttachmentData(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length) {
    return [];
  }

  const images = [];
  for (const filePath of filePaths) {
    const normalizedPath = String(filePath || "");
    const extension = path.extname(normalizedPath).toLowerCase();
    const mimeType = imageMimeByExtension.get(extension);
    if (!mimeType || !fs.existsSync(normalizedPath)) {
      continue;
    }

    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile() || stat.size > maxVisionImageBytes) {
      continue;
    }

    const base64 = fs.readFileSync(normalizedPath).toString("base64");
    images.push({
      name: path.basename(normalizedPath),
      url: `data:${mimeType};base64,${base64}`
    });
  }
  return images;
}

function attachImagesToLastUserMessage(messages, imagePaths) {
  const images = getImageAttachmentData(imagePaths);
  if (!images.length) {
    return messages;
  }

  const cloned = messages.map((message) => ({ ...message }));
  for (let index = cloned.length - 1; index >= 0; index -= 1) {
    if (cloned[index].role !== "user") {
      continue;
    }

    const text = typeof cloned[index].content === "string"
      ? cloned[index].content
      : "请结合这些图片回答。";
    cloned[index].content = [
      { type: "text", text },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.url }
      }))
    ];
    return cloned;
  }

  cloned.push({
    role: "user",
    content: [
      { type: "text", text: "请分析这些图片。" },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.url }
      }))
    ]
  });
  return cloned;
}

function importAttachmentsToWorkspace(userId, filePaths) {
  const imported = [];
  const selected = Array.isArray(filePaths) ? filePaths : [];
  if (!selected.length) return imported;
  const { rootPath, targetPath: attachmentDir } = resolveUserWorkspacePath(userId, "attachments");
  ensureDir(attachmentDir);
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  for (let index = 0; index < selected.length; index += 1) {
    const sourcePath = selected[index];
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    const fileName = `${batchId}-${index + 1}-${safeFileName(path.basename(sourcePath), `附件-${index + 1}`)}`;
    const targetPath = path.join(attachmentDir, fileName);
    fs.copyFileSync(sourcePath, targetPath);
    imported.push({
      sourcePath,
      relativePath: path.relative(rootPath, targetPath),
      bytes: fs.statSync(targetPath).size
    });
  }
  return imported;
}

function appendImportedAttachmentContext(messages, imported) {
  if (!imported.length) return messages;
  const cloned = messages.map((message) => ({ ...message }));
  const userIndex = cloned.map((message) => message.role).lastIndexOf("user");
  if (userIndex < 0) return cloned;
  const note = `已将本轮附件复制到当前用户本地文件目录：\n${imported.map((item) => item.relativePath).join("\n")}`;
  const content = cloned[userIndex].content;
  if (typeof content === "string") {
    cloned[userIndex].content = `${content}\n\n${note}`;
  } else if (Array.isArray(content)) {
    cloned[userIndex].content = [...content, { type: "text", text: note }];
  }
  return cloned;
}

function chatResponseContent(data) {
  return String(extractGatewayText(data?.choices?.[0]?.message?.content) || data?.choices?.[0]?.text || "").trim();
}

async function readStreamingChatResponse(response, onDelta, requestStartedAt = Date.now()) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.body?.getReader || !contentType.includes("text/event-stream")) {
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("接口返回了无法解析的流式内容");
    }
    const content = chatResponseContent(data);
    if (content && typeof onDelta === "function") onDelta({ delta: content, content });
    return { content, responseBytes: Buffer.byteLength(rawText, "utf8"), firstTokenMs: null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let responseBytes = 0;
  let firstTokenMs = null;

  const processLine = (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line.startsWith("data:")) return;
    const payloadText = line.slice(5).trim();
    if (!payloadText || payloadText === "[DONE]") return;
    let frame;
    try {
      frame = JSON.parse(payloadText);
    } catch {
      return;
    }
    if (frame?.error) throw new Error(frame.error.message || "流式接口返回错误");
    const choice = frame?.choices?.[0] || {};
    const deltaText = extractGatewayText(choice?.delta?.content);
    const fullText = extractGatewayText(choice?.message?.content);
    const nextText = deltaText || (!content ? fullText : "");
    if (!nextText) return;
    content += nextText;
    if (firstTokenMs == null) firstTokenMs = Date.now() - requestStartedAt;
    if (typeof onDelta === "function") onDelta({ delta: nextText, content, firstTokenMs });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    responseBytes += value?.byteLength || 0;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) processLine(line);
  return { content: content.trim(), responseBytes, firstTokenMs };
}

async function requestChatCompletion(payload, onDelta, externalSignal) {
  const runtimeConfig = getAiRuntimeConfig();
  if (!runtimeConfig.apiBaseUrl) {
    throw new Error(`未配置企业模型服务。管理员可配置 ${runtimeConfig.configPath} 或环境变量 XIANMA_AI_BASE_URL`);
  }

  const userId = payload?.userId || "local-user";
  const toolsEnabled = payload?.enableFileTools === undefined
    ? payload?.enableWorkspaceTools !== false
    : payload.enableFileTools === true;
  const importedAttachments = toolsEnabled ? importAttachmentsToWorkspace(userId, payload?.attachments) : [];
  const messagesWithAttachmentContext = appendImportedAttachmentContext(payload?.messages || [], importedAttachments);
  const messages = normalizeMessages(attachImagesToLastUserMessage(messagesWithAttachmentContext, payload?.imagePaths));
  if (!messages.length) {
    throw new Error("缺少对话内容");
  }

  const endpoint = `${runtimeConfig.apiBaseUrl}/chat/completions`;
  const allowedModel = resolveChatModel(runtimeConfig, payload?.model);
  const controller = new AbortController();
  let externallyAborted = Boolean(externalSignal?.aborted);
  const unlinkAbort = linkAbortSignal(externalSignal, controller);
  const markExternalAbort = () => { externallyAborted = true; };
  externalSignal?.addEventListener("abort", markExternalAbort, { once: true });
  const startedAt = Date.now();
  const requestBytes = Buffer.byteLength(JSON.stringify({ model: allowedModel, messages }), "utf8");
  const headers = {
    "Content-Type": "application/json"
  };
  if (runtimeConfig.apiKey) {
    headers.Authorization = `Bearer ${runtimeConfig.apiKey}`;
  }

  try {
    writeAiDiagnostic("request-start", {
      endpoint,
      model: allowedModel,
      messageCount: messages.length,
      requestBytes,
      stream: payload?.stream === true && !toolsEnabled,
      toolsEnabled
    });

    if (payload?.stream === true && !toolsEnabled) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: allowedModel,
          messages,
          stream: true,
          temperature: 0.3
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const rawText = await response.text();
        throw new Error(`接口返回 ${response.status}: ${rawText.slice(0, 360)}`);
      }
      const streamed = await readStreamingChatResponse(response, onDelta, startedAt);
      writeAiDiagnostic("response", {
        endpoint,
        model: allowedModel,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        responseBytes: streamed.responseBytes,
        elapsedMs: Date.now() - startedAt,
        firstTokenMs: streamed.firstTokenMs,
        streamed: true,
        toolRound: 0
      });
      const artifactFiles = filterRequestedArtifactFiles(
        await createRequestedArtifact(userId, payload?.artifactOutput, streamed.content),
        userId,
        payload?.artifactOutput
      );
      const previewFile = payload?.autoPreviewHtml ? artifactFiles.find((item) => item.kind === "website") : null;
      if (previewFile) openHtmlPreview(previewFile.path);
      return {
        content: streamed.content,
        model: allowedModel,
        toolRounds: 0,
        files: artifactFiles,
        previewPath: previewFile?.path || "",
        streamed: true,
        firstTokenMs: streamed.firstTokenMs
      };
    }

    const workingMessages = [...messages];
    const workspaceRoot = toolsEnabled ? resolveUserWorkspacePath(userId).rootPath : "";
    const toolArtifacts = [];
    const previewedPaths = new Set();
    let data;
    let content = "";
    let toolRounds = 0;
    while (toolRounds <= maxToolRounds) {
      if (externalSignal?.aborted) throw createGenerationStoppedError();
      const requestBody = {
        model: allowedModel,
        messages: workingMessages,
        stream: false,
        temperature: 0.3
      };
      if (toolsEnabled) {
        requestBody.tools = toolDefinitions();
        requestBody.tool_choice = "auto";
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      const rawText = await response.text();
      writeAiDiagnostic("response", {
        endpoint,
        model: allowedModel,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        responseBytes: Buffer.byteLength(rawText, "utf8"),
        elapsedMs: Date.now() - startedAt,
        toolRound: toolRounds
      });
      if (!response.ok) {
        throw new Error(`接口返回 ${response.status}: ${rawText.slice(0, 360)}`);
      }

      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error("接口返回了非 JSON 内容");
      }

      const message = data?.choices?.[0]?.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      content = chatResponseContent(data);
      if (!toolCalls.length) break;
      if (toolRounds >= maxToolRounds) throw new Error("工具执行轮数超过限制，请拆分任务后重试");

      workingMessages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
      for (const toolCall of toolCalls) {
        if (externalSignal?.aborted) throw createGenerationStoppedError();
        let toolResult;
        try {
          toolResult = await executeWorkspaceTool(payload?.userId || "local-user", toolCall, externalSignal);
        } catch (toolError) {
          if (externalSignal?.aborted || toolError?.code === "GENERATION_STOPPED") throw createGenerationStoppedError();
          toolResult = { error: toolError.message || "工具执行失败" };
        }
        if (toolResult?.opened && toolResult?.path) previewedPaths.add(path.resolve(toolResult.path).toLowerCase());
        if (workspaceRoot) toolArtifacts.push(...artifactsFromToolResult(workspaceRoot, toolResult));
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: truncateToolResult(toolResult)
        });
      }
      toolRounds += 1;
    }
    let files = workspaceRoot
      ? mergeWorkspaceArtifacts(toolArtifacts, findRecentlyChangedWorkspaceFiles(workspaceRoot, startedAt))
      : [];
    files = mergeWorkspaceArtifacts(files, await createRequestedArtifact(userId, payload?.artifactOutput, content));
    files = filterRequestedArtifactFiles(files, userId, payload?.artifactOutput);
    let previewPath = "";
    if (payload?.autoPreviewHtml) {
      if (externalSignal?.aborted) throw createGenerationStoppedError();
      const generatedPreview = files.find((item) => item.kind === "website" && !previewedPaths.has(path.resolve(item.path).toLowerCase()));
      if (generatedPreview) {
        openHtmlPreview(generatedPreview.path);
        previewPath = generatedPreview.path;
        previewedPaths.add(path.resolve(generatedPreview.path).toLowerCase());
      }
      const html = extractHtmlFromResponse(content);
      if (html && !generatedPreview) {
        const { rootPath, targetPath } = resolveUserWorkspacePath(userId, `generated/${Date.now()}-preview.html`);
        ensureDir(path.dirname(targetPath));
        fs.writeFileSync(targetPath, html, "utf8");
        openHtmlPreview(targetPath);
        files = mergeWorkspaceArtifacts(files, [describeWorkspaceFile(rootPath, targetPath)].filter(Boolean));
        return { content, model: allowedModel, toolRounds, files, previewPath: targetPath };
      }
    }
    return { content, model: allowedModel, toolRounds, files, previewPath };
  } catch (error) {
    if (externallyAborted || externalSignal?.aborted || error?.code === "GENERATION_STOPPED") {
      writeAiDiagnostic("cancelled", {
        endpoint,
        model: allowedModel,
        elapsedMs: Date.now() - startedAt,
        requestBytes
      });
      throw createGenerationStoppedError();
    }
    if (error?.name === "AbortError") {
      const elapsedMs = Date.now() - startedAt;
      writeAiDiagnostic("aborted", {
        endpoint,
        model: allowedModel,
        elapsedMs,
        requestBytes
      });
      throw new Error("模型请求已中止，请重试");
    }
    writeAiDiagnostic("error", {
      endpoint,
      model: runtimeConfig.model,
      elapsedMs: Date.now() - startedAt,
      errorName: error?.name || "Error",
      errorMessage: String(error?.message || "unknown").slice(0, 240)
    });
    throw error;
  } finally {
    unlinkAbort();
    externalSignal?.removeEventListener("abort", markExternalAbort);
  }
}

function ensureGeneratedImageDir(userId = "local-user") {
  const targetDir = path.join(getStoreDir(userId), "generated-images");
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

function getImageMimeFromBase64(base64) {
  const prefix = String(base64 || "").slice(0, 16);
  if (prefix.startsWith("/9j/")) return "image/jpeg";
  if (prefix.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

async function saveBase64Image(base64, index, userId = "local-user") {
  const cleanBase64 = String(base64 || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  const mimeType = getImageMimeFromBase64(cleanBase64);
  const extension = extensionForMime(mimeType);
  const fileName = `image-${Date.now()}-${index + 1}${extension}`;
  const filePath = path.join(ensureGeneratedImageDir(userId), fileName);
  await fs.promises.writeFile(filePath, Buffer.from(cleanBase64, "base64"));
  return {
    src: pathToFileURL(filePath).toString(),
    localPath: filePath,
    mimeType
  };
}

async function saveRemoteImage(imageUrl, index, userId, signal) {
  const response = await fetch(String(imageUrl), { signal });
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  const mimeType = String(response.headers.get("content-type") || "image/png").split(";")[0].trim();
  const extension = extensionForMime(mimeType);
  const filePath = path.join(ensureGeneratedImageDir(userId), `image-${Date.now()}-${index + 1}${extension}`);
  await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return {
    src: pathToFileURL(filePath).toString(),
    localPath: filePath,
    mimeType
  };
}

async function requestImageGeneration(payload, externalSignal, onProgress) {
  const runtimeConfig = getAiRuntimeConfig();
  if (!runtimeConfig.apiBaseUrl) {
    throw new Error(`未配置企业模型服务。管理员可配置 ${runtimeConfig.configPath} 或环境变量 XIANMA_AI_BASE_URL`);
  }

  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) {
    throw new Error("缺少图片生成提示词");
  }

  const requestedSourcePath = String(payload?.sourceImagePath || "").trim();
  const sourceImagePath = requestedSourcePath && fs.existsSync(requestedSourcePath) && fs.statSync(requestedSourcePath).isFile()
    ? requestedSourcePath
    : "";
  const sourceMimeType = sourceImagePath ? imageMimeByExtension.get(path.extname(sourceImagePath).toLowerCase()) : "";
  const isEdit = Boolean(sourceImagePath && sourceMimeType);
  const endpoint = `${runtimeConfig.apiBaseUrl}/images/${isEdit ? "edits" : "generations"}`;
  const imageModel = resolveImageModel(runtimeConfig, payload?.model);
  const controller = new AbortController();
  let externallyAborted = Boolean(externalSignal?.aborted);
  const unlinkAbort = linkAbortSignal(externalSignal, controller);
  const markExternalAbort = () => { externallyAborted = true; };
  externalSignal?.addEventListener("abort", markExternalAbort, { once: true });
  const headers = {};
  if (runtimeConfig.apiKey) {
    headers.Authorization = `Bearer ${runtimeConfig.apiKey}`;
  }

  try {
    let requestBody;
    if (isEdit) {
      const formData = new FormData();
      formData.append("model", imageModel);
      formData.append("prompt", prompt);
      formData.append("n", "1");
      formData.append("size", String(payload?.size || "1024x1024"));
      formData.append("image", new Blob([fs.readFileSync(sourceImagePath)], { type: sourceMimeType }), path.basename(sourceImagePath));
      requestBody = formData;
    } else {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify({
        model: imageModel,
        prompt,
        n: 1,
        size: String(payload?.size || "1024x1024")
      });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal
    });

    let data;
    if (!response.ok) {
      const rawText = await response.text();
      throw new Error(`图片接口返回 ${response.status}: ${rawText.slice(0, 360)}`);
    }
    try {
      data = await response.json();
    } catch {
      throw new Error("图片接口返回了非 JSON 内容");
    }

    const items = Array.isArray(data?.data) ? data.data : [];
    const userId = payload?.userId || "local-user";
    const displayImages = items.map((item) => {
      if (item?.b64_json) {
        const cleanBase64 = String(item.b64_json).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
        const mimeType = getImageMimeFromBase64(cleanBase64);
        return {
          src: `data:${mimeType};base64,${cleanBase64}`,
          localPath: "",
          mimeType,
          revisedPrompt: item.revised_prompt || data.revised_prompt || "",
          _base64: cleanBase64
        };
      }
      if (item?.url) {
        return {
          src: String(item.url),
          localPath: "",
          mimeType: "",
          revisedPrompt: item.revised_prompt || data.revised_prompt || "",
          _url: String(item.url)
        };
      }
      return null;
    }).filter(Boolean);

    if (!displayImages.length) {
      throw new Error("图片接口已返回，但没有可展示的图片");
    }

    // Show the remote result as soon as the provider responds. Local persistence
    // continues in parallel so copy/download still use a stable local path.
    onProgress?.({
      stage: "preview",
      message: "图片已返回，正在保存本地文件…",
      images: displayImages.map(({ _base64, _url, ...image }) => image)
    });

    const images = await Promise.all(displayImages.map(async (image, index) => {
      try {
        const saved = image._base64
          ? await saveBase64Image(image._base64, index, userId)
          : image._url
            ? await saveRemoteImage(image._url, index, userId, controller.signal)
            : null;
        return saved ? { ...saved, revisedPrompt: image.revisedPrompt } : image;
      } catch {
        return {
          src: image.src,
          localPath: "",
          mimeType: image.mimeType || "",
          revisedPrompt: image.revisedPrompt || ""
        };
      }
    }));

    onProgress?.({
      stage: "saved",
      message: "图片已保存到本地",
      images
    });

    return {
      content: isEdit ? "已根据当前会话中的图片完成调整。" : "已生成图片。你可以继续让我调整风格、画幅、主体或细节。",
      model: imageModel,
      images
    };
  } catch (error) {
    if (externallyAborted || externalSignal?.aborted) {
      throw createGenerationStoppedError();
    }
    if (error?.name === "AbortError") {
      throw new Error("图片请求已中止，请重试");
    }
    throw error;
  } finally {
    unlinkAbort();
    externalSignal?.removeEventListener("abort", markExternalAbort);
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.xianma.centaur.desktop");
  createWindow();
  setTimeout(cleanupLegacyInstalledRuntime, 5000);
  if (app.isPackaged) {
    const sessionStore = readDingtalkSessions();
    if (sessionStore.currentUserId) {
      ensureManagedGateway(sessionStore.currentUserId).catch((error) => {
        writeAiDiagnostic("managed-gateway-prewarm", { message: String(error?.message || "unknown").slice(0, 240) });
      });
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  runtimeSetup.cancelRequested = true;
  if (runtimeSetup.child && runtimeSetup.child.exitCode === null) runtimeSetup.child.kill();
  for (const controller of activeGenerationRequests.values()) controller.abort();
  activeGenerationRequests.clear();
  for (const runtime of managedGatewayRuntimes.values()) {
    if (runtime.child.exitCode === null) runtime.child.kill();
  }
  managedGatewayRuntimes.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function senderWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error("窗口已关闭");
  return win;
}

ipcMain.on("desktop:window-control", (event, action) => {
  if (!["minimize", "toggle-maximize", "close"].includes(action)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (action === "minimize") {
    win.minimize();
    return;
  }
  if (action === "toggle-maximize") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return;
  }
  if (action === "close") {
    win.close();
  }
});

ipcMain.handle("desktop:get-window-state", async (event) => {
  const win = senderWindow(event);
  return {
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen()
  };
});

ipcMain.handle("desktop:select-files", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("desktop:get-input-file-metadata", async (_event, payload) => {
  const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
  return filePaths.slice(0, 20).map((filePath) => {
    try { return describeInputFile(filePath, true); } catch { return null; }
  }).filter(Boolean);
});

ipcMain.handle("desktop:read-clipboard-files", async () => {
  if (process.platform !== "win32") return [];
  try {
    const buffer = clipboard.readBuffer("FileNameW");
    if (!buffer?.length) return [];
    return buffer.toString("utf16le").split("\0").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
});

ipcMain.handle("desktop:save-clipboard-image", async (_event, payload) => {
  return saveClipboardImage(payload?.userId || "local-user");
});

ipcMain.handle("desktop:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("desktop:get-user-workspace", async (_event, payload) => {
  const { rootPath } = resolveUserWorkspacePath(payload?.userId || "local-user");
  return { rootPath, tree: listWorkspace(rootPath) };
});

ipcMain.handle("desktop:write-workspace-file", async (_event, payload) => {
  const { rootPath, targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath);
  const content = String(payload?.content || "");
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
  return { rootPath, path: targetPath, bytes: Buffer.byteLength(content, "utf8") };
});

ipcMain.handle("desktop:read-workspace-file", async (_event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath);
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) throw new Error("本地文件不存在");
  return { path: targetPath, content: fs.readFileSync(targetPath, "utf8") };
});

ipcMain.handle("desktop:run-workspace-command", async (_event, payload) => {
  return runWorkspaceCommand(payload?.userId || "local-user", payload?.command);
});

ipcMain.handle("desktop:create-web-preview", async (_event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath || `generated/${Date.now()}-preview.html`);
  if (!targetPath.toLowerCase().endsWith(".html") && !targetPath.toLowerCase().endsWith(".htm")) throw new Error("网页预览文件必须是 HTML");
  const html = String(payload?.html || "");
  if (!html.trim()) throw new Error("缺少网页内容");
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, html, "utf8");
  openHtmlPreview(targetPath);
  return { path: targetPath, url: pathToFileURL(targetPath).toString() };
});

ipcMain.handle("desktop:preview-workspace-file", async (_event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath || "");
  if (!/\.html?$/i.test(targetPath) || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    throw new Error("本地网页文件不存在");
  }
  openHtmlPreview(targetPath);
  return { path: targetPath, url: pathToFileURL(targetPath).toString() };
});

ipcMain.handle("desktop:open-workspace-file", async (_event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath || "");
  if (!fs.existsSync(targetPath)) throw new Error("本地文件不存在");
  const errorMessage = await shell.openPath(targetPath);
  if (errorMessage) throw new Error(errorMessage);
  return { path: targetPath };
});

ipcMain.handle("desktop:open-prompt-library", async () => {
  const promptWindow = new BrowserWindow({ width: 1280, height: 820, title: "提示词库", icon: appIcon, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await promptWindow.loadURL("https://www.prompt123.cn/search/");
  return { opened: true };
});

ipcMain.handle("desktop:get-installed-skills", async (_event, payload) => {
  return { skills: listInstalledSkills(payload?.userId || "local-user") };
});

ipcMain.handle("desktop:install-skill", async (event, payload) => {
  return installSkill(event, payload);
});

ipcMain.handle("desktop:remove-installed-skill", async (_event, payload) => {
  return removeInstalledSkill(payload);
});

ipcMain.handle("desktop:dingtalk-login", async () => {
  const session = await loginWithDingtalk();
  if (app.isPackaged && session?.userId) {
    ensureManagedGateway(session.userId).catch((error) => {
      writeAiDiagnostic("managed-gateway-login-prewarm", { message: String(error?.message || "unknown").slice(0, 240) });
    });
  }
  return session;
});

ipcMain.handle("desktop:get-dingtalk-session", async () => {
  return getDingtalkSessionStatus();
});

ipcMain.handle("desktop:dingtalk-logout", async () => {
  const sessionStore = readDingtalkSessions();
  if (sessionStore.currentUserId) stopManagedGateway(sessionStore.currentUserId);
  clearCurrentDingtalkSession();
  await clearDingtalkAuthorizationStorage();
  return { ok: true };
});

ipcMain.handle("desktop:open-path", async (_event, targetPath) => {
  if (targetPath) {
    const absolutePath = requireExistingFile(targetPath);
    const errorMessage = await shell.openPath(absolutePath);
    if (errorMessage) throw new Error(errorMessage);
    return { path: absolutePath };
  }
  throw new Error("缺少文件路径");
});

ipcMain.handle("desktop:preview-local-file", async (_event, targetPath) => {
  const absolutePath = requireExistingFile(targetPath);
  if (!/\.html?$/i.test(absolutePath)) throw new Error("当前文件不支持应用内预览");
  openHtmlPreview(absolutePath);
  return { path: absolutePath, opened: true };
});

ipcMain.handle("desktop:preview-artifact", async (_event, targetPath) => {
  return previewArtifact(targetPath);
});

ipcMain.handle("desktop:copy-artifact", async (_event, targetPath) => {
  return copyArtifact(targetPath);
});

ipcMain.handle("desktop:download-artifact", async (event, targetPath) => {
  return downloadArtifact(event, targetPath);
});

ipcMain.handle("desktop:show-file-context-menu", async (event, targetPath) => {
  return showGeneratedFileContextMenu(event.sender, targetPath);
});

ipcMain.handle("desktop:show-item-in-folder", async (_event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    await shell.openPath(targetPath);
  } else {
    shell.showItemInFolder(targetPath);
  }
});

ipcMain.handle("desktop:copy-text", async (_event, text) => {
  if (typeof text === "string") {
    clipboard.writeText(text);
  }
});

ipcMain.handle("desktop:notify", async (_event, payload) => {
  const title = payload?.title || "先马智能体";
  const body = payload?.body || "";
  new Notification({ title, body, icon: appIcon }).show();
});

ipcMain.handle("desktop:get-ai-runtime-config", async () => {
  return safeAiRuntimeConfig();
});

ipcMain.handle("desktop:get-gateway-config", async (_event, payload) => safeGatewayConfig(payload?.userId));

ipcMain.handle("desktop:get-runtime-setup-status", async () => runtimeSetup.status);

ipcMain.handle("desktop:prepare-runtime", async () => {
  await ensureAgentRuntimeAvailable();
  return { ready: true };
});

ipcMain.handle("desktop:cancel-runtime-setup", async () => cancelRuntimePreparation());

ipcMain.handle("desktop:get-work-data", async (_event, payload) => {
  return readTaskStore(payload?.userId || "local-user");
});

ipcMain.handle("desktop:create-task-result", async (_event, payload) => {
  return createTaskResult(payload);
});

ipcMain.handle("desktop:download-task-result", async (_event, payload) => {
  return downloadTaskResult(payload);
});

ipcMain.handle("desktop:open-task-result-folder", async (_event, payload) => {
  const task = payload?.taskId ? findTaskRun(payload?.userId || "local-user", payload.taskId) : null;
  const folderPath = task?.folderPath || payload?.folderPath;
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error("结果目录不存在，请重新生成任务结果。");
  }
  await shell.openPath(folderPath);
  return { path: folderPath };
});

ipcMain.handle("desktop:cancel-chat-completion", async (event, requestId) => {
  const key = generationRequestKey(event.sender, requestId);
  const controller = key ? activeGenerationRequests.get(key) : null;
  if (!controller || controller.signal.aborted) return { cancelled: false };
  controller.abort();
  return { cancelled: true };
});

ipcMain.handle("desktop:chat-completion", async (event, payload) => {
  const generationRequest = registerGenerationRequest(event, payload?.requestId);
  const sendDelta = payload?.requestId && payload?.stream === true
    ? (chunk) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:chat-completion-chunk", {
          requestId: payload.requestId,
          delta: chunk.delta || "",
          content: chunk.content || "",
          firstTokenMs: chunk.firstTokenMs ?? null
        });
      }
    }
    : null;
  try {
    if (payload?.preferGateway !== false) {
      try {
        const gatewayReady = ensureManagedGateway(payload?.userId || "local-user");
        if (payload?.waitForGateway === true) {
          await Promise.race([gatewayReady, rejectWhenGenerationStops(generationRequest.controller.signal)]);
        } else {
          await Promise.race([
            gatewayReady,
            rejectWhenGenerationStops(generationRequest.controller.signal),
            new Promise((_, reject) => setTimeout(() => reject(new Error("本地能力服务仍在后台启动")), 20000))
          ]);
        }
        if (generationRequest.controller.signal.aborted) throw createGenerationStoppedError();
        return await requestGatewayChat(payload, generationRequest.controller.signal);
      } catch (error) {
        if (generationRequest.controller.signal.aborted || error?.code === "GENERATION_STOPPED") throw createGenerationStoppedError();
        writeAiDiagnostic("gateway-fallback", { message: String(error?.message || "unknown").slice(0, 240) });
      }
    }
    return await requestChatCompletion(payload, sendDelta, generationRequest.controller.signal);
  } finally {
    generationRequest.release();
  }
});

ipcMain.handle("desktop:generate-image", async (event, payload) => {
  const generationRequest = registerGenerationRequest(event, payload?.requestId);
  try {
    const sendProgress = (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:generation-progress", {
          requestId: payload?.requestId || "",
          type: "image",
          ...progress
        });
      }
    };
    return await requestImageGeneration(payload, generationRequest.controller.signal, sendProgress);
  } finally {
    generationRequest.release();
  }
});

