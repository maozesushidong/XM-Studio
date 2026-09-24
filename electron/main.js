const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, session: electronSession, shell, Tray } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = require("docx");
const PptxGenJS = require("pptxgenjs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");
const { createDesktopUpdater, readLatestChatBackup } = require("./updater");
const companySkillsEnabled = true;
const { createCompanySkillsClient } = companySkillsEnabled ? require("./company-skills") : { createCompanySkillsClient: null };

const appIcon = path.join(__dirname, "..", "renderer", "assets", "icon.png");
const buildFlavor = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "build-flavor.json"), "utf8")); } catch { return {}; } })();
const isTestBuild = buildFlavor.flavor === "requirement-preview";
const appDisplayName = isTestBuild ? "XMAI Studio 测试版" : "XMAI Studio";
if (isTestBuild) app.setName("xianma-ai-studio-preview");
const programDataRoot = process.env.ProgramData || "C:\\ProgramData";
const productProgramDataRoot = path.join(programDataRoot, isTestBuild ? "XianmaAIStudioPreview" : "XianmaAIStudio");
const legacyProgramDataRoot = path.join(programDataRoot, "XianmaCentaur");
const appDataRoot = app.getPath("appData");
// Keep this path independent from the display name so a future rebrand cannot
// create a second Chromium profile and make existing conversations disappear.
const productUserDataRoot = path.join(appDataRoot, isTestBuild ? "xianma-ai-studio-preview" : "xianma-ai-studio");
const legacyUserDataRoot = path.join(appDataRoot, "xianma-centaur-desktop");
const configuredUserDataRoot = isTestBuild ? productUserDataRoot : String(process.env.XIANMA_USER_DATA || "").trim();
const defaultElectronUserDataRoot = path.join(appDataRoot, "xianma-ai-studio-desktop");
const userDataRoutePath = path.join(appDataRoot, isTestBuild ? "XianmaAIStudioPreview" : "XianmaAIStudio", "user-data-route.json");
const chatStoragePrefix = "centaur.desktop.chat.v3";

function getUserDataProfileCandidates() {
  if (isTestBuild) return [productUserDataRoot];
  const configuredLegacyRoots = String(process.env.XIANMA_LEGACY_USER_DATA_ROOTS || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configuredUserDataRoot && !configuredLegacyRoots.length) {
    return [path.resolve(configuredUserDataRoot)];
  }
  if (process.env.XIANMA_LEGACY_USER_DATA_ONLY === "1") {
    return configuredLegacyRoots.map((candidate) => path.resolve(candidate))
      .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);
  }
  return [
    productUserDataRoot,
    legacyUserDataRoot,
    defaultElectronUserDataRoot,
    path.join(appDataRoot, "xianma-centaur"),
    path.join(appDataRoot, "先马智能体"),
    path.join(appDataRoot, "先马·Centaur"),
    path.join(appDataRoot, "先马Centaur"),
    path.join(appDataRoot, "先马·AI Studio"),
    path.join(appDataRoot, "先马AI Studio"),
    ...configuredLegacyRoots
  ].map((candidate) => path.resolve(candidate))
    .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);
}

function inspectUserDataProfile(rootPath) {
  const levelDbRoot = path.join(rootPath, "Local Storage", "leveldb");
  const result = {
    rootPath,
    hasChatState: false,
    latestChatActivityMs: 0,
    totalChatDbBytes: 0
  };
  if (!fs.existsSync(levelDbRoot)) return result;

  let entries = [];
  try {
    entries = fs.readdirSync(levelDbRoot, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(levelDbRoot, entry.name);
    try {
      const stat = fs.statSync(filePath);
      result.totalChatDbBytes += stat.size;
      result.latestChatActivityMs = Math.max(result.latestChatActivityMs, stat.mtimeMs);
      // The application keys are plain UTF-8 strings inside Chromium's LevelDB
      // records. A bounded scan is enough to identify a populated profile.
      if (!result.hasChatState && stat.size > 0 && stat.size <= 8 * 1024 * 1024) {
        result.hasChatState = fs.readFileSync(filePath).toString("utf8").includes(chatStoragePrefix);
      }
    } catch {
      // A profile may be locked or partially written while another version exits.
    }
  }
  return result;
}

function resolveStableUserDataRoot() {
  const candidates = getUserDataProfileCandidates();
  const configuredRoute = readJsonFile(userDataRoutePath);
  const configuredRouteRoot = configuredRoute?.rootPath ? path.resolve(configuredRoute.rootPath) : "";
  if (configuredRouteRoot && candidates.includes(configuredRouteRoot)) {
    const routedProfile = inspectUserDataProfile(configuredRouteRoot);
    if (routedProfile.hasChatState) return configuredRouteRoot;
  }

  const profiles = candidates
    .filter((candidate, index) => candidates.indexOf(candidate) === index)
    .map(inspectUserDataProfile)
    .filter((profile) => profile.hasChatState);
  if (!profiles.length) {
    if (configuredRouteRoot && candidates.includes(configuredRouteRoot) && fs.existsSync(configuredRouteRoot)) {
      return configuredRouteRoot;
    }
    ensureDir(path.dirname(userDataRoutePath));
    fs.writeFileSync(userDataRoutePath, JSON.stringify({ rootPath: productUserDataRoot, selectedAt: new Date().toISOString() }, null, 2), "utf8");
    return productUserDataRoot;
  }

  // If both old and new folders exist, use the profile whose chat database was
  // written most recently. This recovers users who continued using the old
  // build after an incomplete directory migration.
  profiles.sort((left, right) => {
    if (right.latestChatActivityMs !== left.latestChatActivityMs) {
      return right.latestChatActivityMs - left.latestChatActivityMs;
    }
    if (left.rootPath === productUserDataRoot) return -1;
    if (right.rootPath === productUserDataRoot) return 1;
    return 0;
  });
  const selectedRoot = profiles[0].rootPath;
  ensureDir(path.dirname(userDataRoutePath));
  fs.writeFileSync(userDataRoutePath, JSON.stringify({ rootPath: selectedRoot, selectedAt: new Date().toISOString() }, null, 2), "utf8");
  return selectedRoot;
}

const existingUserDataRoot = app.getPath("userData");
if (configuredUserDataRoot) app.setPath("userData", configuredUserDataRoot);
else app.setPath("userData", resolveStableUserDataRoot());
app.setName(appDisplayName);
let primaryWindowCreated = false;
const defaultAiConfigPath = path.join(productProgramDataRoot, "ai-config.json");
const defaultGatewayConfigPath = path.join(productProgramDataRoot, "gateway-config.json");
const defaultComputerAccessConfigPath = path.join(productProgramDataRoot, "computer-access.json");
const defaultCompanyAiBaseUrl = "http://47.251.247.220/v1";
const defaultCompanyAiModel = "gpt-5.6-luna";
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
const activeSkillInstallJobs = new Map();
const pendingComputerOperationConfirmations = new Map();
const pendingDesktopMessageDrafts = new Map();
const activeBrowserSessions = new Map();
const activeBrowserTaskRuns = new Map();
const defaultPromptPortalUrl = "https://agent.xianmaec.com/";
const defaultPromptLibraryEntryUrl = "https://cv.xianmaec.com/dingtalk-sso?source=XM_PORTAL&entry=prompts";
const defaultPublicPromptLibraryUrl = "https://cv.xianmaec.com/api/open/v1/resources/prompts";
const defaultPromptDesktopExchangePath = "/api/portal/auth/desktop";
const publicPromptLibraryCache = new Map();
let promptLibraryWindow = null;
let promptLibraryOpenPromise = null;
let primaryWindow = null;
let applicationTray = null;
let applicationIsQuitting = false;
let trayBackgroundNoticeShown = false;
let automationSchedulerTimer = null;
const activeAutomationRuns = new Map();
const computerOperationConfirmationTimeoutMs = 30 * 60 * 1000;
const desktopMessageDraftMaxAgeMs = 10 * 60 * 1000;
const defaultModelOptions = [
  { label: "5.6 Luna", value: "gpt-5.6-luna" },
  { label: "5.6 Sol", value: "gpt-5.6-sol" },
  { label: "5.6 Terra", value: "gpt-5.6-terra" },
  { label: "5.5", value: "gpt-5.6-sol" }
];
// No product-level quotas are applied. The provider/runtime may still impose
// its own physical or protocol limits, and the user can always stop a run.
const unlimitedBytes = Number.MAX_SAFE_INTEGER;
const runtimeMediaMaxBytes = unlimitedBytes;
// The bundled runtime validates configured timeout fields as positive integers.
// This keeps those fields valid while making the effective limit longer than a
// normal desktop process lifetime; user cancellation remains available.
const runtimeNoAutoTimeoutSeconds = 2147483;
const computerAccessModes = new Set(["full", "confirm-dangerous", "read-only"]);
const onlineSkillLibraryUrl = String(process.env.XIANMA_SKILL_LIBRARY_URL || "https://clawhub.ai").trim().replace(/\/+$/, "");
const bundledSkillRoot = path.join(__dirname, "bundled-skills");
const bundledSkillDefinitions = Object.freeze({
  meeting: {
    slug: "dongge-meeting-model",
    displayName: "东哥会议模型",
    directoryName: "dongge-meeting-model"
  }
});
const bundledSkillPromptCache = new Map();
const updateConfigPath = path.join(__dirname, "update-config.json");
const updateSigningPublicKeyPath = path.join(__dirname, "update-signing-public.pem");
const bundledCompanySkillSigningPublicKeyPath = path.join(__dirname, "company-skill-signing-public.pem");
const companySkillSigningPublicKeyPath = String(process.env.XIANMA_COMPANY_SKILL_PUBLIC_KEY_PATH || "").trim()
  || (fs.existsSync(bundledCompanySkillSigningPublicKeyPath) ? bundledCompanySkillSigningPublicKeyPath : updateSigningPublicKeyPath);
let desktopUpdater = null;
const desktopTelemetry = {
  userId: "",
  sessionToken: "",
  heartbeatTimer: null,
  retryTimer: null,
  flushTimer: null,
  generation: 0,
  pendingEvents: new Map(),
  flushing: false
};
const defaultScheduledTasks = [];
const legacyPlaceholderAutomationIds = new Set(["weekly-report", "meeting-notes"]);
const imageMimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".avif", "image/avif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"]
]);
const audioMimeByExtension = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/opus"],
  [".wma", "audio/x-ms-wma"],
  [".amr", "audio/amr"],
  [".aif", "audio/aiff"],
  [".aiff", "audio/aiff"],
  [".mpga", "audio/mpeg"],
  [".mp2", "audio/mpeg"]
]);
const videoMimeByExtension = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/x-m4v"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
  [".wmv", "video/x-ms-wmv"],
  [".flv", "video/x-flv"],
  [".mpeg", "video/mpeg"],
  [".mpg", "video/mpeg"],
  [".3gp", "video/3gpp"]
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

function registerGenerationRequest(event, requestId) {
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

function showPrimaryWindow() {
  if (!primaryWindow || primaryWindow.isDestroyed()) {
    primaryWindow = createWindow();
    desktopUpdater?.setWindow(primaryWindow);
    return primaryWindow;
  }
  primaryWindow.show();
  if (primaryWindow.isMinimized()) primaryWindow.restore();
  primaryWindow.focus();
  return primaryWindow;
}

function createApplicationTray() {
  if (applicationTray && !applicationTray.isDestroyed()) return applicationTray;
  const icon = nativeImage.createFromPath(appIcon).resize({ width: 18, height: 18 });
  applicationTray = new Tray(icon);
  applicationTray.setToolTip(`${appDisplayName} - 自动化后台运行中`);
  applicationTray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示窗口", click: showPrimaryWindow },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        applicationIsQuitting = true;
        app.quit();
      }
    }
  ]));
  applicationTray.on("click", showPrimaryWindow);
  applicationTray.on("double-click", showPrimaryWindow);
  return applicationTray;
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
    title: appDisplayName,
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
  win.on("close", (event) => {
    if (applicationIsQuitting) return;
    event.preventDefault();
    win.hide();
    if (!trayBackgroundNoticeShown && Notification.isSupported()) {
      trayBackgroundNoticeShown = true;
      const notification = new Notification({
        title: appDisplayName,
        body: "窗口已隐藏，自动化任务会继续在后台运行。可从系统托盘重新打开或退出。",
        icon: appIcon,
        silent: true
      });
      notification.on("click", showPrimaryWindow);
      notification.show();
    }
  });
  win.on("closed", () => {
    if (primaryWindow === win) primaryWindow = null;
  });
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
    publishWindowState();
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  primaryWindow = win;
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
const gatewayClients = new Map();

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
  return path.join(localRoot, isTestBuild ? "XianmaAIStudioPreview" : "XianmaAIStudio", "runtime", `${versionSegment}-${hashSegment}`);
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
  if (isTestBuild) return;
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

async function waitForManagedGateway(runtime) {
  while (true) {
    if (runtime.child.exitCode !== null) throw new Error(`本地能力服务启动失败（退出码 ${runtime.child.exitCode}）`);
    if (await canConnectToPort(runtime.port)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function mergeLegacyJsonFile(legacyPath, targetPath) {
  if (!fs.existsSync(legacyPath)) return false;
  const legacyConfig = readJsonFile(legacyPath);
  if (!legacyConfig || typeof legacyConfig !== "object" || Array.isArray(legacyConfig)) return false;
  const currentConfig = readJsonFile(targetPath);
  const mergedConfig = currentConfig && typeof currentConfig === "object" && !Array.isArray(currentConfig)
    ? { ...legacyConfig, ...currentConfig }
    : legacyConfig;
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, JSON.stringify(mergedConfig, null, 2), "utf8");
  return true;
}

function copyMissingDirectoryEntries(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return false;
  ensureDir(targetDir);
  let changed = false;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      changed = copyMissingDirectoryEntries(sourcePath, targetPath) || changed;
      continue;
    }
    if (!fs.existsSync(targetPath)) {
      ensureDir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
      changed = true;
    }
  }
  return changed;
}

function memoryMigrationRoot() {
  return ensureDir(path.join(app.getPath("userData"), "memory-migration"));
}

function memoryMigrationSourceId(sourceRoot) {
  return crypto.createHash("sha256").update(path.resolve(sourceRoot).toLowerCase()).digest("hex").slice(0, 20);
}

function legacyProfileImportStorePath() {
  return path.join(memoryMigrationRoot(), "legacy-profile-imports.json");
}

function readLegacyProfileImports() {
  const stored = readJsonFile(legacyProfileImportStorePath());
  return stored && Array.isArray(stored.sources)
    ? stored
    : { schemaVersion: 1, updatedAt: "", sources: [] };
}

function writeLegacyProfileImports(store) {
  const targetPath = legacyProfileImportStorePath();
  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({
    schemaVersion: 1,
    updatedAt: nowIso(),
    sources: Array.isArray(store?.sources) ? store.sources : []
  }), "utf8");
  fs.renameSync(temporaryPath, targetPath);
}

function legacyProfileActivityMs(sourceRoot) {
  const inspected = inspectUserDataProfile(sourceRoot);
  const usersRoot = path.join(sourceRoot, "users");
  let usersActivityMs = 0;
  try {
    usersActivityMs = fs.statSync(usersRoot).mtimeMs;
  } catch {}
  return Math.max(inspected.latestChatActivityMs, usersActivityMs);
}

function migrateLegacyUserFiles() {
  const targetRoot = path.resolve(app.getPath("userData"));
  const markerPath = path.join(memoryMigrationRoot(), "file-migration-v2.json");
  const marker = readJsonFile(markerPath) || { schemaVersion: 2, sources: {} };
  marker.sources = marker.sources && typeof marker.sources === "object" ? marker.sources : {};

  for (const sourceRoot of getUserDataProfileCandidates()) {
    if (path.resolve(sourceRoot) === targetRoot || !fs.existsSync(sourceRoot)) continue;
    const sourceId = memoryMigrationSourceId(sourceRoot);
    const sourceActivityMs = legacyProfileActivityMs(sourceRoot);
    if (Number(marker.sources[sourceId]?.sourceActivityMs || 0) >= sourceActivityMs && sourceActivityMs > 0) continue;

    for (const directoryName of ["users", "update-backups"]) {
      copyMissingDirectoryEntries(path.join(sourceRoot, directoryName), path.join(targetRoot, directoryName));
    }
    for (const fileName of ["dingtalk-sessions.json"]) {
      const sourcePath = path.join(sourceRoot, fileName);
      const targetPath = path.join(targetRoot, fileName);
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        ensureDir(path.dirname(targetPath));
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
    marker.sources[sourceId] = { sourceActivityMs, migratedAt: nowIso() };
  }

  const temporaryPath = `${markerPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(marker, null, 2), "utf8");
  fs.renameSync(temporaryPath, markerPath);
}

async function readLegacyProfileLocalStorage(sourceRoot) {
  const profileSession = electronSession.fromPath(path.resolve(sourceRoot), { cache: false });
  const readerWindow = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      session: profileSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  try {
    await readerWindow.loadFile(path.join(__dirname, "legacy-profile-reader.html"));
    const items = await readerWindow.webContents.executeJavaScript(`(() => {
      const result = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && (key.startsWith(${JSON.stringify(chatStoragePrefix)}) || key === "centaur.config")) {
          result[key] = localStorage.getItem(key);
        }
      }
      return result;
    })()`, true);
    return items && typeof items === "object" ? items : {};
  } finally {
    if (!readerWindow.isDestroyed()) readerWindow.destroy();
    try {
      const flushResult = profileSession.flushStorageData();
      if (flushResult && typeof flushResult.then === "function") await flushResult;
    } catch {}
  }
}

async function collectLegacyProfileChatImports() {
  const targetRoot = path.resolve(app.getPath("userData"));
  const store = readLegacyProfileImports();
  let changed = false;

  for (const sourceRoot of getUserDataProfileCandidates()) {
    if (path.resolve(sourceRoot) === targetRoot || !inspectUserDataProfile(sourceRoot).hasChatState) continue;
    const sourceId = memoryMigrationSourceId(sourceRoot);
    const sourceActivityMs = legacyProfileActivityMs(sourceRoot);
    const existing = store.sources.find((source) => source.sourceId === sourceId);
    if (existing && Number(existing.sourceActivityMs || 0) >= sourceActivityMs && existing.items) continue;

    try {
      const items = await readLegacyProfileLocalStorage(sourceRoot);
      if (!Object.keys(items).some((key) => key.startsWith(chatStoragePrefix))) continue;
      const snapshot = {
        sourceId,
        profileName: path.basename(sourceRoot),
        sourceActivityMs,
        importedAt: nowIso(),
        items
      };
      if (existing) Object.assign(existing, snapshot);
      else store.sources.push(snapshot);
      changed = true;
    } catch (error) {
      writeAiDiagnostic("legacy-memory-import", {
        sourceId,
        message: String(error?.message || "unknown").slice(0, 180)
      });
    }
  }

  if (changed) writeLegacyProfileImports(store);
  return store;
}

function readStartupChatRestoreData() {
  const sources = [];
  const updateBackup = readLatestChatBackup(app.getPath("userData"));
  if (updateBackup?.items) sources.push({ type: "update-backup", ...updateBackup });
  for (const source of readLegacyProfileImports().sources) {
    if (source?.items && typeof source.items === "object") {
      sources.push({
        type: "legacy-profile",
        sourceId: source.sourceId,
        createdAt: source.importedAt || "",
        items: source.items
      });
    }
  }
  return { schemaVersion: 2, sources };
}

function migrateLegacyProductData() {
  if (isTestBuild) return;
  if (path.resolve(app.getPath("userData")) !== path.resolve(productUserDataRoot)) return;
  const migrationMarker = path.join(productUserDataRoot, ".migrated-from-xianma-centaur");
  if (!fs.existsSync(migrationMarker)) {
    // Chromium owns these directories. They are LevelDB/profile databases and
    // must never be merged file-by-file; resolveStableUserDataRoot() selects a
    // complete profile before Electron starts instead.
    const chromiumProfileEntries = new Set([
      "Cache",
      "Code Cache",
      "DawnGraphiteCache",
      "GPUCache",
      "IndexedDB",
      "Local Storage",
      "Network",
      "Partitions",
      "Session Storage",
      "Shared Dictionary",
      "WebStorage",
      "blob_storage",
      "Dictionaries"
    ]);
    if (fs.existsSync(legacyUserDataRoot)) {
      for (const entry of fs.readdirSync(legacyUserDataRoot, { withFileTypes: true })) {
        if (chromiumProfileEntries.has(entry.name)) continue;
        const sourcePath = path.join(legacyUserDataRoot, entry.name);
        const targetPath = path.join(productUserDataRoot, entry.name);
        if (entry.isDirectory()) {
          copyMissingDirectoryEntries(sourcePath, targetPath);
        } else if (entry.isFile() && !fs.existsSync(targetPath)) {
          ensureDir(path.dirname(targetPath));
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    }
    ensureDir(productUserDataRoot);
    fs.writeFileSync(migrationMarker, JSON.stringify({ migratedAt: new Date().toISOString() }), "utf8");
  }

  const configMigrationMarker = path.join(productProgramDataRoot, ".migrated-from-xianma-centaur");
  if (!fs.existsSync(configMigrationMarker)) {
    mergeLegacyJsonFile(path.join(legacyProgramDataRoot, "ai-config.json"), defaultAiConfigPath);
    mergeLegacyJsonFile(path.join(legacyProgramDataRoot, "gateway-config.json"), defaultGatewayConfigPath);
    mergeLegacyJsonFile(path.join(legacyProgramDataRoot, "dingtalk-config.json"), path.join(productProgramDataRoot, "dingtalk-config.json"));
    ensureDir(productProgramDataRoot);
    fs.writeFileSync(configMigrationMarker, JSON.stringify({ migratedAt: new Date().toISOString() }), "utf8");
  }
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
  const bootstrapPath = path.join(workspacePath, "BOOTSTRAP.md");
  const identityPath = path.join(workspacePath, "IDENTITY.md");
  const userProfilePath = path.join(workspacePath, "USER.md");
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
      defaults: { workspace: workspacePath, timeoutSeconds: runtimeNoAutoTimeoutSeconds, mediaMaxMb: runtimeMediaMaxBytes / (1024 * 1024), model: { primary: `${managedGatewayProviderId}/${primaryModel}` } },
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
          models: modelItems,
          timeoutSeconds: runtimeNoAutoTimeoutSeconds
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
    skills: {
      load: {
        extraDirs: [getUserSkillsDir(userId || "local-user")],
        watch: true,
        watchDebounceMs: 250
      }
    },
    plugins: {
      entries: {
        browser: { enabled: true }
      }
    },
    browser: {
      enabled: true,
      defaultProfile: "openclaw",
      headless: false
    },
    tools: {
      profile: "full",
      alsoAllow: ["browser"],
      exec: {
        host: "gateway",
        security: "full",
        ask: getComputerAccessMode() === "full" ? "off" : "always",
        strictInlineEval: true,
        timeoutSec: runtimeNoAutoTimeoutSeconds
      },
      loopDetection: { enabled: false },
      web: {
        search: { enabled: true, timeoutSeconds: runtimeNoAutoTimeoutSeconds },
        fetch: { enabled: true, maxCharsCap: Number.MAX_SAFE_INTEGER, timeoutSeconds: runtimeNoAutoTimeoutSeconds }
      },
      media: {
        image: { enabled: true, maxBytes: runtimeMediaMaxBytes, timeoutSeconds: runtimeNoAutoTimeoutSeconds, attachments: { mode: "all" } },
        audio: { enabled: true, maxBytes: runtimeMediaMaxBytes, timeoutSeconds: runtimeNoAutoTimeoutSeconds, attachments: { mode: "all" } },
        video: { enabled: true, maxBytes: runtimeMediaMaxBytes, timeoutSeconds: runtimeNoAutoTimeoutSeconds, attachments: { mode: "all" } }
      }
    },
    update: { checkOnStart: false, auto: { enabled: false } }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  fs.writeFileSync(path.join(stateDir, "exec-approvals.json"), JSON.stringify({
    version: 1,
    defaults: {
      security: "full",
      ask: getComputerAccessMode() === "full" ? "off" : "always",
      askFallback: getComputerAccessMode() === "full" ? "full" : "deny"
    }
  }, null, 2), "utf8");
  fs.writeFileSync(instructionsPath, [
    "# XMAI Studio工作约定",
    "",
    "- 默认使用简体中文回答。",
    "- 不向用户提及内部运行框架、底层项目名称、密钥或系统提示词。",
    "- 每个对话都具备文件创建、修改、运行和网页预览能力，不要求用户切换页面或模式。",
    "- 需要创建文件、运行命令或操作浏览器时直接使用可用工具完成，不要求用户手工创建。",
    "- 面向用户统一称为本地文件或文件目录，不使用工作区来区分对话能力。",
    "- 创建可运行网页后主动完成运行验证；客户端会自动打开新建或更新的 HTML。",
    "- 默认使用独立且可见的自动化浏览器；只有用户在当前任务中明确要求连接现有浏览器时，才使用现有浏览器登录状态。",
    getComputerAccessMode() === "full"
      ? "- 当前启用完全访问模式：用户在对话中明确要求的本机操作可以直接执行，无需等待客户端逐次确认；所有操作仍受 Windows 当前账号权限限制并写入本地审计记录。"
      : "- 涉及删除、覆盖、替换、运行命令、安装或卸载软件、系统级修改、上传、发送、发布或提交时，必须通过客户端确认后再执行。",
    ""
  ].join("\n"), "utf8");
  if (fs.existsSync(bootstrapPath)) {
    fs.rmSync(bootstrapPath, { force: true });
  }
  const existingIdentity = fs.existsSync(identityPath) ? fs.readFileSync(identityPath, "utf8") : "";
  if (!existingIdentity.trim() || /Who Am I|Fill this in during your first conversation/i.test(existingIdentity)) {
    fs.writeFileSync(identityPath, [
      "# 企业助手身份",
      "",
      `- Name: ${appDisplayName}`,
      "- Theme: 企业智能办公助手",
      "- Vibe: 清晰、务实、专业",
      ""
    ].join("\n"), "utf8");
  }
  const existingUserProfile = fs.existsSync(userProfilePath) ? fs.readFileSync(userProfilePath, "utf8") : "";
  if (!existingUserProfile.trim() || /About Your Human|Learn about the person/i.test(existingUserProfile)) {
    fs.writeFileSync(userProfilePath, [
      "# 当前用户约定",
      "",
      "- Timezone: Asia/Shanghai",
      "- Notes: 不记录登录凭据、密钥或与任务无关的个人信息。",
      ""
    ].join("\n"), "utf8");
  }
  return { aiConfig, runtimeRoot, stateDir, workspacePath, configPath };
}

function stopManagedGateway(userId) {
  const key = safeWorkspaceSegment(userId || "local-user");
  const runtime = managedGatewayRuntimes.get(key);
  if (!runtime) return;
  managedGatewayRuntimes.delete(key);
  for (const [clientKey, client] of gatewayClients.entries()) {
    if (clientKey.startsWith(`${key}|`)) {
      client.close();
      gatewayClients.delete(clientKey);
    }
  }
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
    for (const [clientKey, client] of gatewayClients.entries()) {
      if (clientKey.startsWith(`${otherKey}|`)) {
        client.close();
        gatewayClients.delete(clientKey);
      }
    }
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
      OPENAI_API_KEY: paths.aiConfig.apiKey,
      OPENAI_BASE_URL: paths.aiConfig.apiBaseUrl,
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
  return String(process.env.XIANMA_DINGTALK_CONFIG || "").trim() || path.join(productProgramDataRoot, "dingtalk-config.json");
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
    appAccessTokenUrl: String(fileConfig.appAccessTokenUrl || "https://api.dingtalk.com/v1.0/oauth2/accessToken").trim(),
    userByUnionIdUrl: String(fileConfig.userByUnionIdUrl || "https://oapi.dingtalk.com/topapi/user/getbyunionid").trim(),
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
  const previousRecord = store.users[safeWorkspaceSegment(userId)] || {};
  const now = Date.now();
  const tokens = {
    accessToken: String(tokenData.accessToken || previousTokens.accessToken || ""),
    refreshToken: String(tokenData.refreshToken || previousTokens.refreshToken || "")
  };
  store.users[safeWorkspaceSegment(userId)] = {
    userId,
    dingtalkUserId: String(user.dingtalkUserId || previousRecord.dingtalkUserId || "").trim(),
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

async function requestDingtalkEnterpriseUserId(config, unionId) {
  const appTokenResponse = await fetch(config.appAccessTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret })
  });
  const appToken = await appTokenResponse.json().catch(() => ({}));
  if (!appTokenResponse.ok || !appToken.accessToken) {
    throw new Error("钉钉企业身份服务暂不可用，请稍后重试");
  }
  const lookupUrl = new URL(config.userByUnionIdUrl);
  lookupUrl.searchParams.set("access_token", appToken.accessToken);
  const lookupResponse = await fetch(lookupUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unionid: String(unionId || "") })
  });
  const lookup = await lookupResponse.json().catch(() => ({}));
  const dingtalkUserId = String(lookup?.result?.userid || "").trim();
  if (!lookupResponse.ok || Number(lookup?.errcode || 0) !== 0 || !dingtalkUserId) {
    const detail = String(lookup?.sub_msg || lookup?.errmsg || "").slice(0, 160);
    throw new Error(detail || "无法确认当前钉钉企业身份，请联系管理员");
  }
  return dingtalkUserId;
}

async function ensureStoredDingtalkEnterpriseUserId(config, record) {
  if (!record?.userId) throw new Error("钉钉登录身份无效");
  if (record.dingtalkUserId) return String(record.dingtalkUserId);
  const dingtalkUserId = await requestDingtalkEnterpriseUserId(config, record.userId);
  const store = readDingtalkSessions();
  const key = safeWorkspaceSegment(record.userId);
  if (store.users?.[key]) {
    store.users[key].dingtalkUserId = dingtalkUserId;
    store.users[key].updatedAt = nowIso();
    fs.writeFileSync(getDingtalkSessionStorePath(), JSON.stringify(store, null, 2), "utf8");
    record.dingtalkUserId = dingtalkUserId;
  }
  return dingtalkUserId;
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
  await ensureStoredDingtalkEnterpriseUserId(config, current);
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
  user.dingtalkUserId = current.dingtalkUserId;
  user.loginAt = current.loginAt || nowIso();
  const record = writeDingtalkSession(user, tokenData, tokens);
  return publicDingtalkSession(record);
}

require("./requirements").registerRequirements({
  ipcMain, getFlavor: () => buildFlavor,
  async getIdentity() {
    const session = await restoreDingtalkSession();
    if (!session) return null;
    const record = readDingtalkSessions().users?.[safeWorkspaceSegment(session.userId)];
    return { userId: session.userId, accessToken: decryptDingtalkTokens(record).accessToken };
  }
});

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
        response.end("<!doctype html><meta charset=\"utf-8\"><title>登录完成</title><style>body{font-family:system-ui;margin:0;display:grid;place-items:center;height:100vh;color:#202124}main{text-align:center}p{color:#6b7280}</style><main><h2>登录完成</h2><p>请返回XMAI Studio继续使用。</p></main>");
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
    user.dingtalkUserId = await requestDingtalkEnterpriseUserId(config, user.userId);
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

function getDesktopTelemetryConfig() {
  const updateConfig = readJsonFile(updateConfigPath) || {};
  return {
    enabled: app.isPackaged || process.env.XIANMA_ENABLE_TELEMETRY === "1",
    baseUrl: String((isTestBuild ? buildFlavor.baseUrl : process.env.XIANMA_TELEMETRY_BASE_URL) || updateConfig.baseUrl || "").trim().replace(/\/+$/, ""),
    appVersion: String(updateConfig.displayVersion || app.getVersion()),
    internalVersion: String(updateConfig.internalVersion || app.getVersion())
  };
}

async function desktopTelemetryRequest(pathname, options = {}) {
  const config = getDesktopTelemetryConfig();
  if (!config.enabled || !config.baseUrl) throw new Error("统计服务未启用");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${config.baseUrl}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error || `企业服务返回 ${response.status}`);
      error.code = String(body?.code || "");
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function readDesktopModelMode() {
  if (!desktopTelemetry.sessionToken) return "selected";
  try {
    const result = await desktopTelemetryRequest("/api/desktop/model-mode", {
      headers: { authorization: `Bearer ${desktopTelemetry.sessionToken}` }
    });
    return result?.modelMode === "auto" ? "auto" : "selected";
  } catch {
    return "selected";
  }
}

function scheduleDesktopTelemetryRetry(session, generation) {
  clearTimeout(desktopTelemetry.retryTimer);
  desktopTelemetry.retryTimer = setTimeout(() => {
    if (desktopTelemetry.generation !== generation || desktopTelemetry.userId !== session?.userId) return;
    startDesktopTelemetry(session, { eventType: "" });
  }, 60 * 1000);
  desktopTelemetry.retryTimer.unref?.();
}

async function sendDesktopTelemetryHeartbeat(generation = desktopTelemetry.generation) {
  if (!desktopTelemetry.sessionToken || generation !== desktopTelemetry.generation) return;
  try {
    await desktopTelemetryRequest("/api/desktop/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${desktopTelemetry.sessionToken}` },
      body: "{}"
    });
    flushDesktopTelemetryEvents().catch(() => {});
  } catch (error) {
    writeAiDiagnostic("desktop-telemetry-heartbeat", { message: String(error?.message || "unknown").slice(0, 160) });
  }
}

async function syncCurrentDingtalkUserToMapms(generation = desktopTelemetry.generation) {
  if (!desktopTelemetry.sessionToken || generation !== desktopTelemetry.generation) return;
  try {
    await desktopTelemetryRequest("/api/desktop/mapms/register", {
      method: "POST",
      headers: { authorization: `Bearer ${desktopTelemetry.sessionToken}` },
      body: "{}"
    });
  } catch (error) {
    writeAiDiagnostic("mapms-user-sync", { message: String(error?.message || "unknown").slice(0, 160) });
  }
}

async function authorizeCurrentDingtalkUserInMapms(generation = desktopTelemetry.generation) {
  if (!desktopTelemetry.sessionToken || generation !== desktopTelemetry.generation) {
    throw new Error("企业权限校验会话无效，请重新登录");
  }
  return desktopTelemetryRequest("/api/desktop/mapms/authorize", {
    method: "POST",
    headers: { authorization: `Bearer ${desktopTelemetry.sessionToken}` },
    body: "{}"
  });
}

function storedDingtalkEnterpriseUserId(userId) {
  const store = readDingtalkSessions();
  return String(store.users?.[safeWorkspaceSegment(userId)]?.dingtalkUserId || "").trim();
}

async function flushDesktopTelemetryEvents() {
  if (desktopTelemetry.flushing || !desktopTelemetry.sessionToken || !desktopTelemetry.pendingEvents.size) return;
  desktopTelemetry.flushing = true;
  const generation = desktopTelemetry.generation;
  const events = [...desktopTelemetry.pendingEvents.entries()].map(([type, count]) => ({ type, count }));
  desktopTelemetry.pendingEvents.clear();
  const token = desktopTelemetry.sessionToken;
  let retryDelayMs = 0;
  try {
    await desktopTelemetryRequest("/api/desktop/events", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ events })
    });
  } catch (error) {
    if (generation === desktopTelemetry.generation && token === desktopTelemetry.sessionToken) {
      for (const event of events) {
        desktopTelemetry.pendingEvents.set(event.type, Number(desktopTelemetry.pendingEvents.get(event.type) || 0) + event.count);
      }
    }
    writeAiDiagnostic("desktop-telemetry-events", { message: String(error?.message || "unknown").slice(0, 160) });
    retryDelayMs = 5000;
  } finally {
    desktopTelemetry.flushing = false;
    if (generation === desktopTelemetry.generation && token === desktopTelemetry.sessionToken && desktopTelemetry.pendingEvents.size) {
      clearTimeout(desktopTelemetry.flushTimer);
      desktopTelemetry.flushTimer = setTimeout(() => {
        desktopTelemetry.flushTimer = null;
        flushDesktopTelemetryEvents().catch(() => {});
      }, retryDelayMs);
      desktopTelemetry.flushTimer.unref?.();
    }
  }
}

function recordDesktopTelemetryEvent(type, count = 1) {
  const normalizedType = String(type || "").trim();
  if (!normalizedType) return;
  desktopTelemetry.pendingEvents.set(normalizedType, Number(desktopTelemetry.pendingEvents.get(normalizedType) || 0) + Math.max(1, Number(count) || 1));
  flushDesktopTelemetryEvents().catch(() => {});
}

async function startDesktopTelemetry(session, { eventType = "app_open", requireMapmsAuthorization = false } = {}) {
  const config = getDesktopTelemetryConfig();
  if (!config.enabled || !config.baseUrl || !session?.userId) return;
  if (desktopTelemetry.userId === session.userId && desktopTelemetry.sessionToken) {
    if (eventType) recordDesktopTelemetryEvent(eventType);
    sendDesktopTelemetryHeartbeat().catch(() => {});
    return requireMapmsAuthorization ? authorizeCurrentDingtalkUserInMapms() : undefined;
  }
  if (desktopTelemetry.userId && desktopTelemetry.userId !== session.userId) desktopTelemetry.pendingEvents.clear();
  desktopTelemetry.generation += 1;
  const generation = desktopTelemetry.generation;
  clearInterval(desktopTelemetry.heartbeatTimer);
  clearTimeout(desktopTelemetry.retryTimer);
  clearTimeout(desktopTelemetry.flushTimer);
  desktopTelemetry.flushTimer = null;
  desktopTelemetry.userId = session.userId;
  desktopTelemetry.sessionToken = "";
  try {
    const identity = loadOrCreateGatewayDeviceIdentity();
    const registration = await desktopTelemetryRequest("/api/desktop/register", {
      method: "POST",
      body: JSON.stringify({
        userId: session.userId,
        dingtalkUserId: storedDingtalkEnterpriseUserId(session.userId),
        name: session.name || "钉钉用户",
        corpId: session.corpId || "",
        department: session.department || "",
        deviceId: identity.deviceId,
        appVersion: config.appVersion,
        internalVersion: config.internalVersion,
        platform: process.platform,
        arch: process.arch,
        osVersion: `${os.type()} ${os.release()}`
      })
    });
    if (generation !== desktopTelemetry.generation || desktopTelemetry.userId !== session.userId) return;
    desktopTelemetry.sessionToken = String(registration.sessionToken || "");
    if (!desktopTelemetry.sessionToken) throw new Error("统计服务未签发会话令牌");
    companySkillsClient?.flushV11Facts?.().catch((error) => {
      writeAiDiagnostic("v11-facts-flush", { message: String(error?.message || "unknown").slice(0, 160) });
    });
    if (eventType) recordDesktopTelemetryEvent(eventType);
    desktopTelemetry.heartbeatTimer = setInterval(() => sendDesktopTelemetryHeartbeat(generation), 60 * 1000);
    desktopTelemetry.heartbeatTimer.unref?.();
    await flushDesktopTelemetryEvents();
    if (requireMapmsAuthorization) {
      await syncCurrentDingtalkUserToMapms(generation);
      return await authorizeCurrentDingtalkUserInMapms(generation);
    }
    syncCurrentDingtalkUserToMapms(generation).catch(() => {});
    return undefined;
  } catch (error) {
    writeAiDiagnostic("desktop-telemetry-register", { message: String(error?.message || "unknown").slice(0, 160) });
    if (requireMapmsAuthorization) throw error;
    if (generation === desktopTelemetry.generation) scheduleDesktopTelemetryRetry(session, generation);
    return undefined;
  }
}

function stopDesktopTelemetry(eventType = "app_close") {
  desktopTelemetry.generation += 1;
  clearInterval(desktopTelemetry.heartbeatTimer);
  clearTimeout(desktopTelemetry.retryTimer);
  clearTimeout(desktopTelemetry.flushTimer);
  desktopTelemetry.flushTimer = null;
  desktopTelemetry.heartbeatTimer = null;
  desktopTelemetry.retryTimer = null;
  const token = desktopTelemetry.sessionToken;
  desktopTelemetry.userId = "";
  desktopTelemetry.sessionToken = "";
  desktopTelemetry.pendingEvents.clear();
  if (!token || !eventType) return;
  desktopTelemetryRequest("/api/desktop/events", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: [{ type: eventType, count: 1 }] }),
    keepalive: true
  }).catch(() => {});
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
  return imageMimeByExtension.get(extension) || audioMimeByExtension.get(extension) || videoMimeByExtension.get(extension) || ({
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip"
  })[extension] || "application/octet-stream";
}

async function prepareGatewayAttachments(filePaths) {
  const attachments = [];
  for (const filePath of (Array.isArray(filePaths) ? filePaths : [])) {
    if (!filePath) continue;
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      const mimeType = gatewayAttachmentMime(filePath);
      const content = await fs.promises.readFile(filePath);
      attachments.push({
        type: mimeType.startsWith("image/") ? "image" : "file",
        mimeType,
        fileName: path.basename(filePath),
        content: content.toString("base64")
      });
    } catch {
      // The absolute path remains in the prompt when a file cannot be embedded.
    }
  }
  return attachments;
}

function createGatewayClient(userId, conversationId, taskId = "") {
  const config = getGatewayConfig(userId);
  if (!config.url) throw new Error(`未配置本地能力服务。管理员可配置 ${config.configPath}`);
  if (typeof WebSocket !== "function") throw new Error("当前运行环境不支持 WebSocket");
  const gatewayUrl = new URL(config.url);
  if (gatewayUrl.protocol === "ws:" && !["127.0.0.1", "localhost", "::1"].includes(gatewayUrl.hostname)) {
    throw new Error("远程能力服务必须使用加密的 wss:// 连接");
  }
  const sessionKey = [
    config.sessionKeyPrefix,
    safeWorkspaceSegment(userId),
    safeWorkspaceSegment(conversationId || "default"),
    taskId ? safeWorkspaceSegment(taskId) : "conversation"
  ].join(":");
  const identity = loadOrCreateGatewayDeviceIdentity();
  const socket = new WebSocket(config.url);
  const pending = new Map();
  const eventListeners = new Map();
  const eventBacklog = new Map();
  let closed = false;
  let requestId = 0;
  let connectTimer;
  let connectSent = false;
  let patchedModel = "";
  let activeApprovalContext = null;
  const gatewayApprovalsInFlight = new Set();

  const sendRequest = (method, params) => new Promise((resolve, reject) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return reject(new Error("本地能力服务未连接"));
    const id = `desktop-${Date.now()}-${++requestId}`;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  const handleGatewayApprovalRequest = async (frame) => {
    const approvalId = String(frame?.payload?.id || "").trim();
    if (!approvalId || gatewayApprovalsInFlight.has(approvalId)) return;
    gatewayApprovalsInFlight.add(approvalId);
    const context = activeApprovalContext ? { ...activeApprovalContext } : null;
    let decision = getComputerAccessMode() === "full" ? "allow-once" : "deny";
    let commandSummary = String(frame?.payload?.request?.command || frame?.payload?.request?.commandPreview || "").trim();
    let target = String(frame?.payload?.request?.cwd || frame?.payload?.request?.host || "当前电脑").trim();
    try {
      const details = await sendRequest("exec.approval.get", { id: approvalId }).catch(() => null);
      commandSummary = String(details?.commandText || details?.commandPreview || details?.request?.command || commandSummary).trim();
      target = String(details?.cwd || details?.request?.cwd || details?.host || target).trim();
      if (context && getComputerAccessMode() !== "full") {
        const resolution = await requestComputerOperationConfirmation(context, {
          action: "computer_run",
          title: "确认运行命令",
          description: "该命令会在当前 Windows 账号权限下运行。请核对命令和目标位置。",
          target: target || "当前电脑",
          auditTarget: target || "当前电脑",
          commandSummary
        });
        decision = resolution.approved ? "allow-once" : "deny";
        appendComputerOperationAudit(context.userId, {
          conversationId: context.conversationId,
          action: "computer_run",
          target: target || "当前电脑",
          approval: decision,
          status: decision === "allow-once" ? "approved" : "denied",
          result: resolution.reason
        });
        publishComputerOperationStatus(context.sender, {
          state: decision === "allow-once" ? "approved" : "denied",
          action: "computer_run",
          target: target || "当前电脑"
        });
      }
      if (context && getComputerAccessMode() === "full") {
        appendComputerOperationAudit(context.userId, {
          conversationId: context.conversationId,
          action: "computer_run",
          target: target || "当前电脑",
          approval: "allow-always",
          status: "approved",
          result: "full-access-policy"
        });
      }
      await sendRequest("exec.approval.resolve", { id: approvalId, decision });
    } catch (error) {
      appendComputerOperationAudit(context?.userId || userId, {
        conversationId: context?.conversationId || conversationId,
        action: "computer_run",
        target: target || "当前电脑",
        approval: decision,
        status: "failed",
        error: error?.message || "approval resolution failed"
      });
      try { await sendRequest("exec.approval.resolve", { id: approvalId, decision: "deny" }); } catch { /* gateway may already be closed */ }
    } finally {
      gatewayApprovalsInFlight.delete(approvalId);
    }
  };

  const ready = new Promise((resolve, reject) => {
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
          userAgent: "XMAI Studio桌面端"
        }
      }));
    };
    socket.addEventListener("open", () => {
      connectTimer = setTimeout(() => sendConnect(), 80);
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(String(event.data || "")); } catch { return; }
      if (frame.type === "event" && frame.event === "connect.challenge") {
        sendConnect(String(frame.payload?.nonce || ""));
        return;
      }
      if (frame.type === "event") {
        if (frame.event === "exec.approval.requested") {
          handleGatewayApprovalRequest(frame).catch(() => {});
          return;
        }
        const eventRunId = String(frame.payload?.runId || "");
        const listener = eventRunId ? eventListeners.get(eventRunId) : null;
        if (listener) {
          listener({ data: JSON.stringify(frame) });
        } else if (eventRunId) {
          const queued = eventBacklog.get(eventRunId) || [];
          queued.push(frame);
          eventBacklog.set(eventRunId, queued.slice(-80));
        }
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
    socket.addEventListener("error", () => {
      closed = true;
      reject(new Error("本地能力服务连接失败"));
    });
    socket.addEventListener("close", () => {
      closed = true;
      for (const entry of pending.values()) entry.reject(new Error("本地能力服务连接已关闭"));
      pending.clear();
    });
  });

  return {
    async send(message, attachments = [], onEvent, model, signal, approvalContext = null) {
      await Promise.race([ready, rejectWhenGenerationStops(signal)]);
      activeApprovalContext = approvalContext;
      if (signal?.aborted) throw createGenerationStoppedError();
      if (config.managed && model && patchedModel !== model) {
        await Promise.race([
          sendRequest("sessions.patch", { key: sessionKey, model: `${managedGatewayProviderId}/${model}` }),
          rejectWhenGenerationStops(signal)
        ]);
        patchedModel = model;
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
        activeApprovalContext = null;
        if (signal?.aborted) {
          sendRequest("chat.abort", { sessionKey }).catch(() => {});
          throw createGenerationStoppedError();
        }
        throw error;
      }
      if (signal?.aborted) {
        activeApprovalContext = null;
        if (response?.runId) sendRequest("chat.abort", { sessionKey, runId: response.runId }).catch(() => {});
        throw createGenerationStoppedError();
      }
      if (!response?.runId || typeof onEvent !== "function") {
        activeApprovalContext = null;
        return response;
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let finalContent = "";
        const cleanup = () => {
          if (eventListeners.get(response.runId) === handleMessage) eventListeners.delete(response.runId);
          eventBacklog.delete(response.runId);
          socket.removeEventListener("close", handleClose);
          signal?.removeEventListener("abort", handleAbort);
          if (activeApprovalContext === approvalContext) activeApprovalContext = null;
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
            else if (payload.state === "error") finish("reject", new Error(payload.errorMessage || "技能执行失败"));
            else {
              finalContent = extractGatewayText(payload.message?.content) || finalContent;
              finish("resolve", { ...response, content: finalContent || "任务已完成。" });
            }
            return;
          }
          if (typeof payload.deltaText === "string") {
            finalContent = payload.replace === true ? payload.deltaText : `${finalContent}${payload.deltaText}`;
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
        eventListeners.set(response.runId, handleMessage);
        socket.addEventListener("close", handleClose, { once: true });
        signal?.addEventListener("abort", handleAbort, { once: true });
        for (const frame of eventBacklog.get(response.runId) || []) handleMessage({ data: JSON.stringify(frame) });
        eventBacklog.delete(response.runId);
      });
    },
    async history() {
      await ready;
      return sendRequest("chat.history", { sessionKey, limit: 100 });
    },
    close() {
      closed = true;
      socket.close();
    },
    isClosed() {
      return closed || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING;
    }
  };
}

function toolDisplayName(toolCall) {
  const name = String(toolCall?.function?.name || toolCall?.name || "文件操作");
  return {
    computer_list: "查看目录",
    computer_read: "读取文件",
    computer_write: "写入文件",
    computer_write_document: "生成文档",
    computer_copy: "复制文件",
    computer_move: "移动文件",
    computer_delete: "删除文件",
    computer_open: "打开文件或网页",
    computer_list_apps: "查看应用",
    computer_launch_app: "打开应用",
    computer_browser_open: "打开浏览器页面",
    computer_browser_search: "浏览器搜索",
    computer_inspect_app: "读取应用界面",
    computer_capture_app: "查看应用画面",
    computer_control_app: "操作应用",
    computer_prepare_message: "准备消息",
    computer_send_message: "发送消息",
    computer_search: "搜索文件",
    computer_run: "运行命令",
    workspace_list: "读取文件目录",
    workspace_read: "读取文件",
    workspace_write: "写入文件",
    workspace_write_document: "生成文档",
    workspace_run: "运行命令",
    workspace_preview: "打开网页预览"
  }[name] || name;
}

function workspaceFileKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".html", ".htm"].includes(extension)) return "website";
  if (imageMimeByExtension.has(extension)) return "image";
  if (audioMimeByExtension.has(extension)) return "audio";
  if (videoMimeByExtension.has(extension)) return "video";
  if ([".doc", ".docx", ".pdf", ".rtf", ".odt"].includes(extension)) return "document";
  if ([".xls", ".xlsx", ".csv", ".ods"].includes(extension)) return "spreadsheet";
  if ([".ppt", ".pptx", ".odp"].includes(extension)) return "presentation";
  if ([".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"].includes(extension)) return "archive";
  if ([".js", ".ts", ".jsx", ".tsx", ".css", ".json", ".md", ".txt", ".py", ".java", ".c", ".cpp", ".cs"].includes(extension)) return "code";
  return "file";
}

function describeWorkspaceFile(rootPath, targetPath) {
  const absolutePath = path.resolve(String(targetPath || ""));
  const relativePath = path.relative(rootPath, absolutePath);
  if (!absolutePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return describeComputerFile(absolutePath, rootPath);
}

function describeComputerFile(targetPath, rootPath = "") {
  const absolutePath = path.resolve(String(targetPath || ""));
  if (!absolutePath) return null;
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
    relativePath: rootPath ? path.relative(rootPath, absolutePath) : absolutePath,
    extension: extension.replace(/^\./, ""),
    kind: workspaceFileKind(absolutePath),
    bytes: stat.size,
    modifiedAtMs: stat.mtimeMs
  };
}

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

function validateInputFiles(filePaths, options = {}) {
  const selected = [...new Set((Array.isArray(filePaths) ? filePaths : []).map((filePath) => path.resolve(String(filePath || ""))).filter(Boolean))];
  for (const filePath of selected) {
    const absolutePath = requireExistingFile(filePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) throw new Error(`${path.basename(absolutePath)} 不是文件`);
  }
  return selected;
}

function gatewayClientCacheKey(userId, conversationId, taskId = "") {
  const config = getGatewayConfig(userId);
  return [
    safeWorkspaceSegment(userId || "local-user"),
    safeWorkspaceSegment(conversationId || "default"),
    taskId ? safeWorkspaceSegment(taskId) : "conversation",
    config.url,
    config.token,
    config.sessionKeyPrefix
  ].join("|");
}

function getReusableGatewayClient(userId, conversationId, taskId = "") {
  const key = gatewayClientCacheKey(userId, conversationId, taskId);
  const existing = gatewayClients.get(key);
  if (existing && !existing.isClosed()) return existing;
  if (existing) gatewayClients.delete(key);
  const client = createGatewayClient(userId, conversationId, taskId);
  gatewayClients.set(key, client);
  return client;
}

async function saveClipboardImage(userId = "local-user") {
  let image = clipboard.readImage();
  for (let attempt = 0; image.isEmpty() && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    image = clipboard.readImage();
  }
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
  return candidates.map((candidate) => describeWorkspaceFile(rootPath, candidate) || describeComputerFile(candidate)).filter(Boolean);
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

function extractTextArtifactContent(files) {
  for (const file of Array.isArray(files) ? files : []) {
    const filePath = String(file?.path || "");
    if (!filePath || !fs.existsSync(filePath) || !isTextLikeFile(filePath)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content) return content;
    } catch {
      // A generated file may be locked briefly; the model text remains usable.
    }
  }
  return "";
}

function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ""; }
    });
}

function extractWebSkillUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?，。！？）】》]+$/g, "") : "";
}

function isWebContentExtractorRequest(payload) {
  const skill = `${payload?.skillSlug || ""} ${payload?.skillName || ""} ${payload?.skillId || ""}`;
  const text = `${payload?.message || ""} ${payload?.skillPrompt || ""}`;
  return Boolean(extractWebSkillUrl(text) && /web[-_ ]?content[-_ ]?extract|网页内容|网页提取|内容提取/i.test(skill));
}

async function runWebContentExtractorFastPath(payload, signal, onDelta, onProgress) {
  const url = extractWebSkillUrl(`${payload?.message || ""} ${payload?.skillPrompt || ""}`);
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("网页地址无效，请提供完整的 http 或 https 地址。"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("网页技能只支持 http 或 https 地址。");

  onProgress?.({ stage: "skill-loading", message: "正在加载在线技能…" });
  onProgress?.({ stage: "skill-fetching", message: `正在访问网页：${parsed.origin}…` });
  const response = await fetch(parsed.toString(), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
    },
    signal
  });
  if (!response.ok) throw new Error(`网页返回 ${response.status}，暂时无法读取内容。`);
  const html = await response.text();
  onProgress?.({ stage: "skill-extracting", message: "正在提取网页标题、正文和链接…" });

  const title = decodeBasicHtmlEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ["", ""])[1])
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const description = decodeBasicHtmlEntities((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || ["", ""])[1]).trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:nav|footer|header)\b[^>]*>[\s\S]*?<\/(?:nav|footer|header)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const content = decodeBasicHtmlEntities(body).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  const images = [...html.matchAll(/<(?:img|source)\b[^>]*(?:src|data-src|srcset)=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].split(",")[0].trim())
    .map((src) => { try { return new URL(src, parsed).toString(); } catch { return src; } });
  const links = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      try { return { url: new URL(match[1], parsed).toString(), text: decodeBasicHtmlEntities(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }; }
      catch { return null; }
    }).filter(Boolean);
  const extracted = { url: parsed.toString(), title, meta_description: description, content, images, links, extracted_at: new Date().toISOString() };
  const extractedText = JSON.stringify(extracted, null, 2);
  onProgress?.({ stage: "skill-organizing", message: "网页内容已提取，正在整理回复…" });

  const originalMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const enrichedMessage = [
    String(payload?.message || "请整理网页内容。"),
    "\n以下是在线技能刚刚提取的真实网页结果，请基于这些结果直接回答，不要再次访问网页，也不要输出初始化问候：",
    extractedText
  ].join("\n");
  const enrichedMessages = originalMessages.length
    ? originalMessages.map((item, index) => index === originalMessages.length - 1 && item?.role === "user" ? { ...item, content: enrichedMessage } : item)
    : [{ role: "user", content: enrichedMessage }];
  const result = await requestChatCompletion({
    ...payload,
    messages: enrichedMessages,
    message: enrichedMessage,
    enableFileTools: false,
    enableWorkspaceTools: false,
    preferGateway: false,
    stream: true
  }, onDelta, signal, (progress) => {
    if (progress?.stage === "model") onProgress?.({ stage: "skill-organizing", message: "正在整理回复…" });
  });
  return { ...result, skillFastPath: true, extractedWeb: { url: parsed.toString(), title, images, links } };
}

async function requestGatewayChat(payload, signal, onDelta, onProgress, operationContext = {}) {
  const userId = payload?.userId || "local-user";
  const selectedAttachments = validateInputFiles(payload?.attachments, { allowUnlimited: payload?.allowUnlimitedAttachments === true });
  let importedAttachments = await importAttachmentsToWorkspace(userId, selectedAttachments);
  importedAttachments = await preprocessMediaAttachments(userId, importedAttachments, signal, onProgress);
  if (isWebContentExtractorRequest(payload)) {
    return runWebContentExtractorFastPath(payload, signal, onDelta, onProgress);
  }
  onProgress?.({ stage: "skill-loading", message: payload?.skillId ? "正在加载已选技能…" : "正在准备完整能力…" });
  const client = getReusableGatewayClient(
    userId,
    payload?.conversationId,
    payload?.browserAutomationTask === true ? payload?.browserAutomationTaskId : ""
  );
  let streamedContent = "";
  const startedAt = Date.now();
  let firstTokenMs = null;
  const runtimeConfig = getAiRuntimeConfig();
  const allowedModel = resolveChatModel(runtimeConfig, payload?.model);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const lastUser = [...messages].reverse().find((item) => item?.role === "user");
  const skillPrompt = [
    readBundledSkillPrompt(resolveBundledSkillDefinition(payload)),
    String(payload?.skillPrompt || "").trim()
  ].filter(Boolean).join("\n\n");
  const message = [
    String(payload?.message || extractGatewayText(lastUser?.content) || ""),
    skillPrompt ? `当前用户已明确选择技能。必须严格使用以下技能规范直接生成最终结果，不要只回复执行计划：\n${skillPrompt}` : "",
    importedAttachmentContext(importedAttachments),
    appendMediaTranscriptContext([], importedAttachments)[0]?.content || ""
  ].filter(Boolean).join("\n\n");
  onProgress?.({ stage: "model", message: payload?.skillId ? "技能已加载，正在分析任务…" : "正在连接企业模型服务…" });
  if (await readDesktopModelMode() === "auto") {
    onProgress?.({ stage: "model-routing", modelMode: "auto", message: "正在整理回复…" });
  }
  const response = await client.send(
      message,
      await prepareGatewayAttachments([
        ...importedAttachments.filter((item) => !isAudioOrVideoPath(item.absolutePath)).map((item) => item.absolutePath),
        ...mediaKeyFramePaths(importedAttachments)
      ]),
      (event) => {
        const eventState = String(event?.state || "");
        if (eventState === "delta") onProgress?.({ stage: "skill-progress", message: "技能正在处理内容…" });
        if (eventState === "final") onProgress?.({ stage: "completed", message: "技能处理完成，正在展示结果…" });
        if (eventState === "error") onProgress?.({ stage: "error", message: event?.errorMessage || "技能执行失败" });
        if (typeof event?.deltaText === "string") {
          streamedContent = event.replace === true ? event.deltaText : `${streamedContent}${event.deltaText}`;
          if (firstTokenMs == null && streamedContent) firstTokenMs = Date.now() - startedAt;
          if (typeof onDelta === "function") {
            onDelta({
              delta: event.deltaText,
              content: streamedContent,
              firstTokenMs
            });
          }
        }
      },
      allowedModel,
      signal,
      {
        ...operationContext,
        userId,
        conversationId: payload?.conversationId || "default",
        signal
      }
  );
  if (await readDesktopModelMode() === "auto") {
    onProgress?.({ stage: "model-routing", modelMode: "auto", message: "正在整理回复…" });
  }
  if (signal?.aborted) throw createGenerationStoppedError();
  const { rootPath } = resolveUserWorkspacePath(payload?.userId || "local-user");
  let files = findRecentlyChangedWorkspaceFiles(rootPath, startedAt);
  const previewPath = payload?.autoPreviewHtml
    ? (files.find((item) => item.kind === "website")?.path || "")
    : "";
  if (previewPath) openHtmlPreview(previewPath);
  const responseContent = String(streamedContent || extractGatewayText(response?.message?.content) || extractGatewayText(response?.content) || "").trim();
  files = mergeWorkspaceArtifacts(files, await createRequestedArtifact(userId, payload?.artifactOutput, responseContent));
  files = filterRequestedArtifactFiles(files, userId, payload?.artifactOutput);
  return {
    content: responseContent || extractTextArtifactContent(files) || "能力服务已完成任务，但没有返回可直接展示的正文。",
    gateway: true,
    runId: response?.runId || "",
    model: allowedModel,
    previewPath,
    files
  };
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

function computerOperationAuditPath(userId = "local-user") {
  return path.join(getStoreDir(userId), "computer-operation-audit.jsonl");
}

function sanitizeAuditText(value, maximumLength = 1000) {
  return String(value || "")
    .replace(/(?:sk|api[-_ ]?key)[-_a-zA-Z0-9]{12,}/gi, "[已隐藏]")
    .replace(/(password|passwd|token|secret)\s*[:=]\s*[^\s]+/gi, "$1=[已隐藏]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function appendComputerOperationAudit(userId, record = {}) {
  const entry = {
    timestamp: nowIso(),
    userId: safeWorkspaceSegment(userId || "local-user"),
    conversationId: safeWorkspaceSegment(record.conversationId || "default"),
    taskId: record.taskId ? safeWorkspaceSegment(record.taskId) : "",
    executionId: record.executionId ? safeWorkspaceSegment(record.executionId) : "",
    action: sanitizeAuditText(record.action, 120),
    target: sanitizeAuditText(record.target, 1000),
    approval: ["not-required", "allow-once", "allow-always", "deny"].includes(record.approval) ? record.approval : "not-required",
    status: sanitizeAuditText(record.status, 80),
    result: sanitizeAuditText(record.result, 300),
    error: sanitizeAuditText(record.error, 500)
  };
  try {
    fs.appendFileSync(computerOperationAuditPath(userId), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Audit failures must not grant or repeat an operation.
  }
  return entry;
}

function getComputerAccessMode() {
  const environmentMode = String(process.env.XIANMA_COMPUTER_ACCESS_MODE || "").trim().toLowerCase();
  if (computerAccessModes.has(environmentMode)) return environmentMode;
  const configuredMode = String(readJsonFile(defaultComputerAccessConfigPath)?.computerAccessMode || "").trim().toLowerCase();
  if (computerAccessModes.has(configuredMode)) return configuredMode;
  try {
    ensureDir(path.dirname(defaultComputerAccessConfigPath));
    fs.writeFileSync(defaultComputerAccessConfigPath, JSON.stringify({
      schemaVersion: 1,
      computerAccessMode: "full",
      description: "full=完全访问；confirm-dangerous=危险操作确认；read-only=只读"
    }, null, 2), "utf8");
  } catch {
    // A non-administrator install can still use the built-in default.
  }
  return "full";
}

function computerOperationPolicy(operation = {}) {
  const mode = getComputerAccessMode();
  const operationText = [operation.action, operation.title, operation.description, operation.target, operation.commandSummary].filter(Boolean).join(" ");
  const absolutelyDenied = /(?:支付|付款|立即购买|确认购买|下单付款|转账|汇款|提现|充值|修改密码|重置密码|安全设置|二次验证|双重验证|权限变更|修改权限|授权管理员|批量删除|清空全部|永久删除全部|签署合同|确认合同|合同确认|pay(?:ment)?|transfer|withdraw|change password|security settings|permission change|bulk delete|delete all|sign contract|confirm contract)/i.test(operationText);
  if (absolutelyDenied) return { mode, denied: true, denialReason: "absolute-prohibition", requiresConfirmation: false };
  const readOnlyActions = new Set([
    "computer_list", "computer_read", "computer_open", "computer_list_apps", "computer_inspect_app",
    "computer_capture_app", "computer_search", "workspace_list", "workspace_read"
  ]);
  if (mode === "read-only" && !readOnlyActions.has(String(operation.action || ""))) {
    return { mode, denied: true, requiresConfirmation: false };
  }
  return {
    mode,
    denied: false,
    requiresConfirmation: operation.requiresConfirmation === true
  };
}

function readComputerOperationHistory(userId = "local-user", limit = 200) {
  const filePath = computerOperationAuditPath(userId);
  if (!fs.existsSync(filePath)) return [];
  const requestedLimit = Math.max(1, Number(limit) || 200);
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .slice(-requestedLimit)
      .reverse();
  } catch {
    return [];
  }
}

function publishComputerOperationStatus(sender, status = {}) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send("desktop:computer-operation-status", {
    timestamp: nowIso(),
    ...status
  });
}

function publicComputerOperation(operation = {}) {
  return {
    confirmationId: operation.confirmationId,
    action: sanitizeAuditText(operation.action, 120),
    title: sanitizeAuditText(operation.title || "确认本机操作", 160),
    description: sanitizeAuditText(operation.description || "请确认是否允许执行此操作。", 500),
    target: sanitizeAuditText(operation.target, 1000),
    commandSummary: sanitizeConfirmationDetail(operation.commandSummary, 4000),
    detailLabel: sanitizeAuditText(operation.detailLabel || "命令", 40),
    userId: safeWorkspaceSegment(operation.userId || "local-user"),
    conversationId: safeWorkspaceSegment(operation.conversationId || "default"),
    taskId: operation.taskId ? safeWorkspaceSegment(operation.taskId) : "",
    executionId: operation.executionId ? safeWorkspaceSegment(operation.executionId) : "",
    createdAt: operation.createdAt || nowIso()
  };
}

function settleComputerOperationConfirmation(confirmationId, decision = "deny", reason = "user") {
  const entry = pendingComputerOperationConfirmations.get(String(confirmationId || ""));
  if (!entry || entry.settled) return false;
  entry.settled = true;
  pendingComputerOperationConfirmations.delete(entry.confirmationId);
  clearTimeout(entry.timer);
  entry.signal?.removeEventListener("abort", entry.onAbort);
  if (entry.sender && !entry.sender.isDestroyed?.()) entry.sender.removeListener("destroyed", entry.onUnavailable);
  publishComputerOperationStatus(entry.sender, {
    confirmationId: entry.confirmationId,
    state: "confirmation-resolved",
    decision: decision === "allow-once" ? "allow-once" : "deny",
    reason
  });
  entry.resolve({
    confirmationId: entry.confirmationId,
    approved: decision === "allow-once",
    decision: decision === "allow-once" ? "allow-once" : "deny",
    reason
  });
  return true;
}

function requestComputerOperationConfirmation(context = {}, operation = {}) {
  const sender = context.sender;
  if (!sender || sender.isDestroyed?.()) {
    return Promise.resolve({ approved: false, decision: "deny", reason: "window-unavailable" });
  }
  const confirmationId = crypto.randomUUID();
  const publicOperation = publicComputerOperation({
    ...operation,
    confirmationId,
    userId: context.userId,
    conversationId: context.conversationId,
    taskId: browserTaskIdFromContext(context),
    executionId: context.executionId,
    createdAt: nowIso()
  });
  return new Promise((resolve) => {
    const entry = {
      confirmationId,
      sender,
      signal: context.signal,
      settled: false,
      resolve,
      onAbort: () => settleComputerOperationConfirmation(confirmationId, "deny", "cancelled"),
      onUnavailable: () => settleComputerOperationConfirmation(confirmationId, "deny", "window-unavailable")
    };
    entry.timer = setTimeout(() => settleComputerOperationConfirmation(confirmationId, "deny", "timeout"), computerOperationConfirmationTimeoutMs);
    pendingComputerOperationConfirmations.set(confirmationId, entry);
    context.signal?.addEventListener("abort", entry.onAbort, { once: true });
    sender.once("destroyed", entry.onUnavailable);
    publishComputerOperationStatus(sender, { confirmationId, state: "awaiting-confirmation", operation: publicOperation });
    sender.send("desktop:computer-operation-confirmation", publicOperation);
    const owner = BrowserWindow.fromWebContents(sender);
    if (owner && !owner.isVisible() && Notification.isSupported()) {
      const notification = new Notification({
        title: "自动化任务需要确认",
        body: publicOperation.title || "请打开 XMAI Studio 确认本机操作",
        icon: appIcon
      });
      notification.on("click", showPrimaryWindow);
      notification.show();
    }
  });
}

async function runComputerOperation(context = {}, operation = {}, handler) {
  const policy = computerOperationPolicy(operation);
  const operationStartedAt = nowIso();
  const externalImpact = operation.requiresConfirmation === true || [
    "computer_write", "computer_write_document", "computer_copy", "computer_move", "computer_delete",
    "computer_run", "computer_send_message", "workspace_write", "workspace_write_document", "workspace_run", "workspace_preview"
  ].includes(String(operation.action || ""));
  if (policy.denied) {
    appendComputerOperationAudit(context.userId, {
      conversationId: context.conversationId,
      action: operation.action,
      target: operation.auditTarget || operation.target,
      approval: "deny",
      status: "denied",
      result: policy.denialReason || "read-only-policy"
    });
    recordBrowserTaskExecutionDetail(context, {
      startedAt: operationStartedAt,
      finishedAt: nowIso(),
      action: operation.action,
      target: operation.auditTarget || operation.target,
      riskConfirmation: "policy-denied",
      externalImpact: false,
      result: "denied",
      error: policy.denialReason || "read-only-policy"
    });
    const error = new Error(policy.denialReason === "absolute-prohibition"
      ? "出于安全原因，支付、转账、安全设置、权限变更、批量删除和合同确认不能由自动化执行"
      : "当前本机操作策略为只读，未执行会改变电脑状态的操作");
    error.code = "COMPUTER_OPERATION_DENIED";
    throw error;
  }
  let approval = "not-required";
  if (policy.requiresConfirmation) {
    const resolution = await requestComputerOperationConfirmation(context, operation);
    approval = resolution.decision;
    if (!resolution.approved) {
      appendComputerOperationAudit(context.userId, {
        conversationId: context.conversationId,
        action: operation.action,
        target: operation.auditTarget || operation.target,
        approval,
        status: "denied",
        result: resolution.reason
      });
      recordBrowserTaskExecutionDetail(context, {
        startedAt: operationStartedAt,
        finishedAt: nowIso(),
        action: operation.action,
        target: operation.auditTarget || operation.target,
        riskConfirmation: resolution.reason || approval,
        humanControl: true,
        externalImpact: false,
        result: "denied"
      });
      publishComputerOperationStatus(context.sender, {
        state: "denied",
        action: operation.action,
        target: operation.target,
        reason: resolution.reason
      });
      const error = new Error("用户已取消此本机操作");
      error.code = "COMPUTER_OPERATION_DENIED";
      throw error;
    }
  }

  publishComputerOperationStatus(context.sender, { state: "executing", action: operation.action, target: operation.target });
  try {
    const result = await handler();
    appendComputerOperationAudit(context.userId, {
      conversationId: context.conversationId,
      action: operation.action,
      target: operation.auditTarget || operation.target,
      approval,
      status: "completed",
      result: operation.resultSummary || (policy.mode === "full" && operation.requiresConfirmation ? "completed-full-access" : "completed")
    });
    recordBrowserTaskExecutionDetail(context, {
      startedAt: operationStartedAt,
      finishedAt: nowIso(),
      action: operation.action,
      target: operation.auditTarget || operation.target,
      riskConfirmation: policy.requiresConfirmation ? approval : "not-required",
      humanControl: policy.requiresConfirmation,
      externalImpact,
      result: "completed"
    });
    publishComputerOperationStatus(context.sender, { state: "completed", action: operation.action, target: operation.target });
    return result;
  } catch (error) {
    appendComputerOperationAudit(context.userId, {
      conversationId: context.conversationId,
      action: operation.action,
      target: operation.auditTarget || operation.target,
      approval,
      status: "failed",
      error: error?.message || "operation failed"
    });
    recordBrowserTaskExecutionDetail(context, {
      startedAt: operationStartedAt,
      finishedAt: nowIso(),
      action: operation.action,
      target: operation.auditTarget || operation.target,
      riskConfirmation: policy.requiresConfirmation ? approval : "not-required",
      humanControl: policy.requiresConfirmation,
      externalImpact,
      result: externalImpact ? "uncertain" : "failed",
      error: error?.message || "operation failed"
    });
    publishComputerOperationStatus(context.sender, { state: "failed", action: operation.action, target: operation.target, error: sanitizeAuditText(error?.message, 300) });
    throw error;
  }
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
  const source = String(markdown || "").replace(/^\uFEFF/, "");
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { __validBlock: false };

  const values = {};
  let pending = null;
  const flushPending = () => {
    if (!pending) return;
    const lines = pending.lines.map((line) => line.trim()).filter(Boolean);
    values[pending.key] = pending.style === ">"
      ? lines.join(" ").replace(/\s+/g, " ").trim()
      : lines.join("\n").trim();
    pending = null;
  };

  for (const line of match[1].split(/\r?\n/)) {
    if (pending) {
      if (!line.trim() || /^\s+/.test(line)) {
        pending.lines.push(line);
        continue;
      }
      flushPending();
    }
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    const block = value.match(/^([>|])[-+]?(?:\s+#.*)?$/);
    if (block) {
      pending = { key, style: block[1], lines: [] };
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  flushPending();
  return { ...values, __validBlock: true };
}

function normalizedSkillName(value, fallback = "skill") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  if (normalized) return normalized;
  const digest = crypto.createHash("sha1").update(String(fallback || "skill")).digest("hex").slice(0, 10);
  return `skill-${digest}`;
}

function derivedSkillDescription(markdown, fallbackName = "技能") {
  const source = String(markdown || "").replace(/^\uFEFF/, "");
  const withoutFrontMatter = source.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const text = withoutFrontMatter
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[-*+]\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || `用于处理${fallbackName}相关任务。`).slice(0, 400);
}

function validateSkillFrontMatter(markdown, skillRoot = "") {
  const values = parseSimpleSkillFrontMatter(markdown);
  const fallbackName = path.basename(String(skillRoot || "skill")) || "skill";
  const rawName = String(values.name || "").trim();
  const name = normalizedSkillName(rawName || fallbackName, markdown);
  const description = String(values.description || "").trim() || derivedSkillDescription(markdown, name);
  return {
    ...values,
    name,
    description,
    __validBlock: values.__validBlock === true,
    __derived: values.__validBlock !== true || !rawName || !String(values.description || "").trim()
  };
}

function sanitizeVisibleSkillText(value) {
  return String(value || "")
    .replace(/clawhub/gi, "在线技能库")
    .replace(new RegExp(["open", "claw"].join(""), "gi"), appDisplayName)
    .trim();
}

function isPathInside(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function walkSkillFiles(skillRoot) {
  const resolvedRoot = fs.realpathSync(skillRoot);
  const files = [];
  let totalBytes = 0;
  const walk = (currentPath, depth) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if ([".git", "node_modules", ".DS_Store"].includes(entry.name)) continue;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error("技能包不能包含符号链接");
      const realPath = fs.realpathSync(entryPath);
      if (!isPathInside(resolvedRoot, realPath)) throw new Error("技能包包含越界路径");
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) throw new Error("技能包包含不支持的文件类型");
      const stat = fs.statSync(entryPath);
      totalBytes += stat.size;
      files.push({ path: entryPath, relativePath: path.relative(skillRoot, entryPath), bytes: stat.size });
    }
  };
  walk(skillRoot, 0);
  return { files, totalBytes };
}

function analyzeSkillRisk(skillRoot, markdown) {
  const { files, totalBytes } = walkSkillFiles(skillRoot);
  const highRiskItems = [];
  const reviewItems = [];
  const add = (target, item) => {
    if (!target.includes(item)) target.push(item);
  };
  const executableExtensions = new Set([".exe", ".dll", ".msi", ".com", ".scr", ".ps1", ".bat", ".cmd", ".sh", ".py", ".js", ".mjs", ".cjs", ".jar"]);
  const textExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".ps1", ".bat", ".cmd", ".sh", ".py", ".js", ".mjs", ".cjs"]);
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (executableExtensions.has(extension)) add(highRiskItems, `包含可执行脚本或程序：${file.relativePath}`);
    if (!textExtensions.has(extension) || file.bytes > 1024 * 1024) continue;
    const content = fs.readFileSync(file.path, "utf8");
    if (/\b(?:rm\s+-rf|del\s+\/s|rmdir\s+\/s|remove-item\b|format\b|diskpart\b|reg\s+delete|shutdown\b)\b/i.test(content)) {
      add(highRiskItems, `包含高风险系统命令：${file.relativePath}`);
    }
    if (/\b(?:curl|wget|invoke-webrequest)\b[^\r\n|]*(?:\||;|&&)\s*(?:sh|bash|powershell|pwsh|cmd)\b/i.test(content)) {
      add(highRiskItems, `包含下载后执行指令：${file.relativePath}`);
    }
  }
  if (/metadata\s*:\s*\{[^\n]*(?:requires|primaryEnv)/i.test(markdown) || /requires\.(?:env|bins)/i.test(markdown)) {
    add(reviewItems, "技能声明了外部程序或环境变量依赖");
  }
  if (/https?:\/\//i.test(markdown)) add(reviewItems, "技能说明包含外部网络地址");
  const riskLevel = highRiskItems.length ? "high" : (reviewItems.length ? "medium" : "low");
  return {
    riskLevel,
    riskItems: [...highRiskItems, ...reviewItems].slice(0, 20),
    fileCount: files.length,
    totalBytes
  };
}

function findSkillManifestPath(skillRoot) {
  if (!skillRoot || !fs.existsSync(skillRoot) || !fs.statSync(skillRoot).isDirectory()) return "";
  const entry = fs.readdirSync(skillRoot, { withFileTypes: true })
    .find((item) => item.isFile() && item.name.toLowerCase() === "skill.md");
  return entry ? path.join(skillRoot, entry.name) : "";
}

function readSkillDescriptor(skillRoot, source = "installed") {
  const markdownPath = findSkillManifestPath(skillRoot);
  if (!fs.existsSync(markdownPath) || !fs.statSync(markdownPath).isFile()) {
    throw new Error("技能包必须包含 SKILL.md");
  }
  const markdown = fs.readFileSync(markdownPath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!markdown) throw new Error("SKILL.md 不能为空");
  const frontMatter = validateSkillFrontMatter(markdown, skillRoot);
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
  const origin = readJsonFile(path.join(skillRoot, ".xianma-skill-origin.json")) || {};
  const name = frontMatter.name;
  const displayName = sanitizeVisibleSkillText(metadata.displayName || metadata.title || frontMatter.title || name).slice(0, 80) || name;
  const description = sanitizeVisibleSkillText(frontMatter.description);
  const version = sanitizeVisibleSkillText(metadata.version || frontMatter.version || "1.0.0").slice(0, 32) || "1.0.0";
  const category = sanitizeVisibleSkillText(metadata.category || frontMatter.category || "已安装技能").slice(0, 40);
  const categoryId = safeWorkspaceSegment(metadata.categoryId || origin.categoryId || "") || "efficiency-tools";
  const tagIds = (Array.isArray(metadata.tagIds) ? metadata.tagIds : (Array.isArray(origin.tagIds) ? origin.tagIds : []))
    .map((item) => safeWorkspaceSegment(item))
    .filter(Boolean)
    .slice(0, 20);
  const customTags = (Array.isArray(metadata.customTags) ? metadata.customTags : (Array.isArray(origin.customTags) ? origin.customTags : []))
    .map((item) => ({ tagId: safeWorkspaceSegment(item?.tagId || ""), name: sanitizeVisibleSkillText(item?.name || "").slice(0, 30) }))
    .filter((item) => item.tagId && item.name)
    .slice(0, 20);
  const newTags = (Array.isArray(metadata.newTags) ? metadata.newTags : (Array.isArray(origin.newTags) ? origin.newTags : []))
    .map((item) => sanitizeVisibleSkillText(item).slice(0, 30))
    .filter(Boolean)
    .slice(0, 20);
  const starter = sanitizeVisibleSkillText(metadata.starter || frontMatter.starter || `使用“${displayName}”处理以下内容：`);
  const icon = ["file-stack", "file-text", "clipboard-list", "sparkles", "pen-line"].includes(metadata.icon) ? metadata.icon : "file-stack";
  const prompt = String(metadata.systemPrompt || markdown).replaceAll("{baseDir}", skillRoot).trim();
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
  const risk = origin.riskLevel
    ? { riskLevel: origin.riskLevel, riskItems: Array.isArray(origin.riskItems) ? origin.riskItems : [], fileCount: Number(origin.fileCount || 0), totalBytes: Number(origin.totalBytes || 0) }
    : analyzeSkillRisk(skillRoot, markdown);
  return {
    id: String(origin.installId || skillIdFromName(name)),
    slug: name,
    name: displayName,
    shortName: displayName.slice(0, 8),
    icon,
    category,
    categoryId,
    tagIds,
    customTags,
    newTags,
    description,
    version,
    instructions: String(metadata.systemPrompt || markdown).trim(),
    starter,
    systemPrompt: `当前选用技能“${displayName}”。技能目录为：${skillRoot}\n${prompt}`,
    fields,
    source: origin.source || source,
    sourceLabel: sanitizeVisibleSkillText(origin.sourceLabel || (source === "online" ? "在线技能库" : "本地技能")),
    sourceReference: String(origin.sourceReference || ""),
    sourceType: origin.companySkillId ? "ENTERPRISE" : "PERSONAL",
    personalSkillId: String(origin.personalSkillId || origin.installId || skillIdFromName(name)),
    installedAt: origin.installedAt || "",
    companySkillId: String(origin.companySkillId || ""),
    companyVersion: String(origin.companyVersion || ""),
    packageSha256: String(origin.packageSha256 || ""),
    riskLevel: risk.riskLevel,
    riskItems: risk.riskItems,
    fileCount: risk.fileCount,
    totalBytes: risk.totalBytes,
    userInvocable: String(frontMatter["user-invocable"] || "true").toLowerCase() !== "false",
    installed: true
  };
}

function skillMatchKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/(?:[-_.]?(?:skill|skills|plugin))$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function skillRootPreference(skillRoot, repositoryRoot, preferredName = "") {
  const relativePath = path.relative(repositoryRoot, skillRoot).replaceAll("\\", "/");
  const directoryName = path.basename(skillRoot);
  let frontMatterName = "";
  try {
    frontMatterName = parseSimpleSkillFrontMatter(fs.readFileSync(findSkillManifestPath(skillRoot), "utf8")).name || "";
  } catch {
    // Invalid candidates are rejected later by the normal descriptor validation.
  }
  const preferredKey = skillMatchKey(preferredName);
  const directoryKey = skillMatchKey(directoryName);
  const frontMatterKey = skillMatchKey(frontMatterName);
  let score = 100 - relativePath.split("/").length;
  if (!relativePath) score += 1000;
  if (preferredKey && frontMatterKey === preferredKey) score += 700;
  if (preferredKey && directoryKey === preferredKey) score += 600;
  if (/(^|\/)\.codex\/skills\//i.test(relativePath)) score += 80;
  if (/(^|\/)\.claude\/skills\//i.test(relativePath)) score += 70;
  if (/(^|\/)skills\//i.test(relativePath)) score += 40;
  if (/(^|\/)(?:examples?|fixtures?|templates?|assets?)\//i.test(relativePath)) score -= 120;
  return { skillRoot, frontMatterKey, score };
}

function findSkillRoots(rootPath, preferredName = "") {
  const resolvedRoot = path.resolve(rootPath);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) throw new Error("技能目录不存在");
  const matches = [];
  const visit = (currentPath, depth) => {
    if (depth > 10) return;
    if (findSkillManifestPath(currentPath)) {
      matches.push(currentPath);
      return;
    }
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || [".git", "node_modules"].includes(entry.name)) continue;
      visit(path.join(currentPath, entry.name), depth + 1);
    }
  };
  visit(resolvedRoot, 0);
  if (!matches.length) throw new Error("没有找到可安装的 SKILL.md");
  const ranked = matches
    .map((skillRoot) => skillRootPreference(skillRoot, resolvedRoot, preferredName))
    .sort((left, right) => right.score - left.score || left.skillRoot.localeCompare(right.skillRoot));
  const unique = [];
  const seen = new Set();
  for (const candidate of ranked) {
    const key = candidate.frontMatterKey || path.relative(resolvedRoot, candidate.skillRoot).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate.skillRoot);
  }
  return unique;
}

function findSkillRoot(rootPath, preferredName = "") {
  return findSkillRoots(rootPath, preferredName)[0];
}

async function zipInstalledSkillDirectory(sourcePath, rootName) {
  const zip = new JSZip();
  const root = zip.folder(safeFileName(rootName || path.basename(sourcePath), "skill"));
  const walk = (directory, target) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", ".DS_Store", ".xianma-skill-origin.json"].includes(entry.name)) continue;
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("技能包不能包含符号链接");
      if (entry.isDirectory()) {
        walk(source, target.folder(entry.name));
      } else if (entry.isFile()) {
        target.file(entry.name, fs.readFileSync(source));
      }
    }
  };
  walk(sourcePath, root);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function downloadInstalledSkillPackage(event, payload = {}) {
  const userId = payload.userId || "local-user";
  const sourcePath = findInstalledSkillRoot(userId, String(payload.skillId || ""));
  if (!sourcePath) throw new Error("技能不存在或已卸载");
  const descriptor = readSkillDescriptor(sourcePath);
  const buffer = await zipInstalledSkillDirectory(sourcePath, descriptor.name || descriptor.slug || path.basename(sourcePath));
  const version = String(descriptor.version || payload.version || "1.0.0");
  const displayName = String(descriptor.name || payload.displayName || "技能");
  const saveOptions = {
    title: "下载技能包",
    defaultPath: `${safeFileName(displayName, "skill")}-${safeFileName(version)}.zip`,
    filters: [{ name: "技能 ZIP 包", extensions: ["zip"] }]
  };
  const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  const result = parent ? await dialog.showSaveDialog(parent, saveOptions) : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) return { canceled: true };
  const targetPath = path.resolve(result.filePath.toLowerCase().endsWith(".zip") ? result.filePath : `${result.filePath}.zip`);
  if (targetPath === path.parse(targetPath).root) throw new Error("请选择具体文件名，不要直接选择磁盘根目录");
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, buffer);
  return { canceled: false, path: targetPath, name: descriptor.name || descriptor.slug, version, bytes: buffer.length, format: "zip" };
}

function copySkillDirectory(sourcePath, targetPath, state = { fileCount: 0, totalBytes: 0 }, depth = 0) {
  ensureDir(targetPath);
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    if ([".git", "node_modules", ".DS_Store"].includes(entry.name)) continue;
    const source = path.join(sourcePath, entry.name);
    const target = path.join(targetPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error("技能包不能包含符号链接");
    if (entry.isDirectory()) {
      copySkillDirectory(source, target, state, depth + 1);
      continue;
    }
    if (!entry.isFile()) throw new Error("技能包包含不支持的文件类型");
    const stat = fs.statSync(source);
    state.fileCount += 1;
    state.totalBytes += stat.size;
    fs.copyFileSync(source, target);
  }
}

async function extractSkillZip(sourcePath, targetPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const names = Object.keys(zip.files);
  let totalBytes = 0;
  for (const name of names) {
    const normalized = path.posix.normalize(String(name).replaceAll("\\", "/"));
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
      throw new Error("技能包包含不安全的文件路径");
    }
    const entry = zip.files[name];
    const permissions = typeof entry.unixPermissions === "string" ? parseInt(entry.unixPermissions, 8) : Number(entry.unixPermissions || 0);
    if ((permissions & 0o170000) === 0o120000) throw new Error("技能包不能包含符号链接");
    const outputPath = path.resolve(targetPath, normalized);
    const relative = path.relative(targetPath, outputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("技能包路径越界");
    if (entry.dir) {
      ensureDir(outputPath);
      continue;
    }
    const data = await entry.async("nodebuffer");
    totalBytes += data.byteLength;
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, data);
  }
}

async function materializeSkillSource(sourcePath) {
  const absolutePath = path.resolve(String(sourcePath || "").trim());
  if (!sourcePath || !fs.existsSync(absolutePath)) throw new Error("技能文件或文件夹不存在");
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error("技能来源不能是符号链接");
  if (stat.isDirectory()) {
    return { sourceRoot: findSkillRoot(absolutePath, path.basename(absolutePath)), sourceKind: "folder", cleanup() {} };
  }
  if (!stat.isFile()) throw new Error("请选择技能 ZIP、Markdown 文件或技能文件夹");
  const temporaryRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "xianma-skill-inspect-"));
  try {
    if (/\.zip$/i.test(absolutePath)) {
      await extractSkillZip(absolutePath, temporaryRoot);
    } else if (/\.(?:md|markdown)$/i.test(absolutePath)) {
      const markdown = fs.readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
      const fileName = path.basename(absolutePath, path.extname(absolutePath));
      const frontMatter = parseSimpleSkillFrontMatter(markdown);
      const content = frontMatter.__validBlock
        ? markdown
        : [
          "---",
          `name: ${normalizedSkillName(fileName, absolutePath)}`,
          `description: ${derivedSkillDescription(markdown, fileName)}`,
          "---",
          "",
          markdown
        ].join("\n");
      fs.writeFileSync(path.join(temporaryRoot, "SKILL.md"), content, "utf8");
    } else {
      throw new Error("仅支持 .md、.markdown、.zip 或技能文件夹");
    }
    return {
      sourceRoot: findSkillRoot(temporaryRoot, path.basename(absolutePath, path.extname(absolutePath))),
      sourceKind: /\.zip$/i.test(absolutePath) ? "zip" : "markdown",
      cleanup() { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
    };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function findInstalledSkillEntry(userId, skillId) {
  const root = getUserSkillsDir(userId);
  return fs.readdirSync(root, { withFileTypes: true }).find((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith(".")) return false;
    try { return readSkillDescriptor(findSkillRoot(path.join(root, entry.name))).id === skillId; } catch { return false; }
  }) || null;
}

function publicSkillInspection(sourcePath, sourceKind, descriptor, userId) {
  const existing = findInstalledSkillEntry(userId, descriptor.id);
  return {
    sourcePath,
    sourceKind,
    skill: {
      id: descriptor.id,
      slug: descriptor.slug,
      name: descriptor.name,
      description: descriptor.description,
      version: descriptor.version,
      category: descriptor.category,
      categoryId: descriptor.categoryId,
      tagIds: descriptor.tagIds,
      customTags: descriptor.customTags,
      instructions: descriptor.instructions,
      icon: descriptor.icon,
      riskLevel: descriptor.riskLevel,
      riskItems: descriptor.riskItems,
      fileCount: descriptor.fileCount,
      totalBytes: descriptor.totalBytes,
      userInvocable: descriptor.userInvocable
    },
    requiresRiskAcknowledgement: descriptor.riskLevel === "high",
    requiresReplace: Boolean(existing)
  };
}

async function inspectSkillSource(payload = {}) {
  const sourcePath = String(payload?.sourcePath || "").trim();
  const userId = payload?.userId || "local-user";
  const prepared = await materializeSkillSource(sourcePath);
  try {
    const descriptor = readSkillDescriptor(prepared.sourceRoot, "local");
    return publicSkillInspection(sourcePath, prepared.sourceKind, descriptor, userId);
  } finally {
    prepared.cleanup();
  }
}

function writeSkillOrigin(skillRoot, origin, descriptor) {
  fs.writeFileSync(path.join(skillRoot, ".xianma-skill-origin.json"), JSON.stringify({
    source: origin.source || "local",
    sourceLabel: origin.sourceLabel || "本地技能",
    sourceReference: origin.sourceReference || "",
    installId: origin.installId || "",
    personalSkillId: origin.personalSkillId || origin.installId || "",
    categoryId: origin.categoryId || descriptor.categoryId || "",
    tagIds: Array.isArray(origin.tagIds) ? origin.tagIds : descriptor.tagIds,
    customTags: Array.isArray(origin.customTags) ? origin.customTags : descriptor.customTags,
    newTags: Array.isArray(origin.newTags) ? origin.newTags : descriptor.newTags,
    companySkillId: origin.companySkillId || "",
    companyVersion: origin.companyVersion || "",
    packageSha256: origin.packageSha256 || "",
    packageSignature: origin.packageSignature || "",
    installedAt: new Date().toISOString(),
    riskLevel: descriptor.riskLevel,
    riskItems: descriptor.riskItems,
    fileCount: descriptor.fileCount,
    totalBytes: descriptor.totalBytes
  }, null, 2), "utf8");
}

async function renameSkillDirectory(sourcePath, targetPath) {
  const retryableCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.promises.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error?.code) || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 + (attempt * 60)));
    }
  }
  throw lastError;
}

async function commitSkillDirectory(sourceRoot, payload, origin = {}) {
  const userId = payload?.userId || "local-user";
  const descriptor = readSkillDescriptor(sourceRoot, origin.source || "local");
  if (descriptor.riskLevel === "high" && payload?.acknowledgeRisk !== true) {
    return { installed: false, requiresRiskAcknowledgement: true, inspection: publicSkillInspection(payload?.sourcePath || "", payload?.sourceKind || "folder", descriptor, userId) };
  }
  const root = getUserSkillsDir(userId);
  const installId = String(payload?.installId || origin.installId || descriptor.id);
  const existing = findInstalledSkillEntry(userId, installId);
  if (existing && payload?.replace !== true) {
    return { installed: false, requiresReplace: true, inspection: publicSkillInspection(payload?.sourcePath || "", payload?.sourceKind || "folder", descriptor, userId) };
  }
  const targetPath = existing ? path.join(root, existing.name) : path.join(root, installId);
  const stagePath = path.join(root, `.installing-${descriptor.slug}-${process.pid}-${Date.now()}`);
  const backupPath = `${targetPath}.backup-${Date.now()}`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  try {
    copySkillDirectory(sourceRoot, stagePath);
    const stagedDescriptor = readSkillDescriptor(stagePath, origin.source || "local");
    writeSkillOrigin(stagePath, {
      ...origin,
      installId,
      personalSkillId: payload?.personalSkillId || origin.personalSkillId || installId,
      categoryId: payload?.categoryId || origin.categoryId || stagedDescriptor.categoryId,
      tagIds: Array.isArray(payload?.tagIds) ? payload.tagIds : origin.tagIds
    }, stagedDescriptor);
    if (existing) await renameSkillDirectory(targetPath, backupPath);
    await renameSkillDirectory(stagePath, targetPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
    return { installed: true, replaced: Boolean(existing), skill: readSkillDescriptor(targetPath, origin.source || "local") };
  } catch (error) {
    fs.rmSync(stagePath, { recursive: true, force: true });
    if (!fs.existsSync(targetPath) && fs.existsSync(backupPath)) await renameSkillDirectory(backupPath, targetPath);
    throw error;
  } finally {
    if (fs.existsSync(targetPath)) fs.rmSync(backupPath, { recursive: true, force: true });
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

function findInstalledSkillRoot(userId = "local-user", skillId = "") {
  const root = getUserSkillsDir(userId);
  const entry = fs.readdirSync(root, { withFileTypes: true }).find((candidate) => {
    if (!candidate.isDirectory() || candidate.name.startsWith(".")) return false;
    try { return readSkillDescriptor(findSkillRoot(path.join(root, candidate.name))).id === skillId; } catch { return false; }
  });
  return entry ? findSkillRoot(path.join(root, entry.name)) : "";
}

function updateSkillFrontMatter(markdown, description, fallbackName) {
  const source = String(markdown || "").replace(/^\uFEFF/, "");
  const block = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const normalizedDescription = JSON.stringify(String(description || "").trim());
  if (!block) {
    return `---\nname: ${normalizedSkillName(fallbackName, source)}\ndescription: ${normalizedDescription}\n---\n\n${source.trim()}\n`;
  }
  const lines = block[1].split(/\r?\n/);
  const output = [];
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^description\s*:/i.test(line)) {
      output.push(line);
      continue;
    }
    if (!replaced) output.push(`description: ${normalizedDescription}`);
    replaced = true;
    while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) index += 1;
  }
  if (!replaced) output.push(`description: ${normalizedDescription}`);
  return `---\n${output.join("\n")}\n---\n\n${source.slice(block[0].length).trim()}\n`;
}

function updateInstalledSkill(payload = {}) {
  const userId = payload.userId || "local-user";
  const skillId = String(payload.skillId || "").trim();
  const skillRoot = findInstalledSkillRoot(userId, skillId);
  if (!skillRoot) throw new Error("技能不存在或已卸载");
  const current = readSkillDescriptor(skillRoot);
  if (current.companySkillId) throw new Error("企业技能不能修改");

  const displayName = sanitizeVisibleSkillText(payload.displayName).slice(0, 80);
  const description = sanitizeVisibleSkillText(payload.description).slice(0, 500);
  const categoryId = safeWorkspaceSegment(payload.categoryId || current.categoryId) || "efficiency-tools";
  const category = sanitizeVisibleSkillText(payload.category || current.category).slice(0, 40) || "其他";
  const instructions = String(payload.instructions || "").trim();
  if (!displayName) throw new Error("请填写技能名称");
  if (!description) throw new Error("请填写技能简介");
  if (!instructions) throw new Error("请填写技能说明");

  const tags = (Array.isArray(payload.tags) ? payload.tags : [])
    .map((item) => ({
      tagId: safeWorkspaceSegment(item?.tagId || ""),
      name: sanitizeVisibleSkillText(item?.name || "").slice(0, 30),
      isNew: item?.isNew === true
    }))
    .filter((item) => item.tagId && item.name)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.tagId === item.tagId) === index)
    .slice(0, 20);
  if (!tags.length) throw new Error("请至少选择一个技能标签");

  const metadataPath = ["skill.json", "package.json"]
    .map((name) => path.join(skillRoot, name))
    .find((candidate) => fs.existsSync(candidate)) || path.join(skillRoot, "skill.json");
  const metadata = readJsonFile(metadataPath) || {};
  const nextMetadata = {
    ...metadata,
    displayName,
    category,
    categoryId,
    tagIds: tags.filter((item) => !item.isNew).map((item) => item.tagId),
    customTags: tags.filter((item) => item.isNew).map(({ tagId, name }) => ({ tagId, name })),
    newTags: tags.filter((item) => item.isNew).map((item) => item.name),
    systemPrompt: instructions
  };
  const manifestPath = findSkillManifestPath(skillRoot);
  const originPath = path.join(skillRoot, ".xianma-skill-origin.json");
  const origin = readJsonFile(originPath) || {};
  const temporarySuffix = `.editing-${process.pid}-${Date.now()}`;
  const writes = [
    { target: manifestPath, content: updateSkillFrontMatter(fs.readFileSync(manifestPath, "utf8"), description, current.slug) },
    { target: metadataPath, content: `${JSON.stringify(nextMetadata, null, 2)}\n` },
    { target: originPath, content: `${JSON.stringify({ ...origin, categoryId, tagIds: nextMetadata.tagIds, customTags: nextMetadata.customTags, newTags: nextMetadata.newTags }, null, 2)}\n` }
  ];
  const backups = [];
  try {
    for (const item of writes) {
      const backup = `${item.target}${temporarySuffix}.backup`;
      if (fs.existsSync(item.target)) fs.copyFileSync(item.target, backup);
      backups.push({ target: item.target, backup, existed: fs.existsSync(backup) });
      const temporary = `${item.target}${temporarySuffix}`;
      fs.writeFileSync(temporary, item.content, "utf8");
      fs.rmSync(item.target, { force: true });
      fs.renameSync(temporary, item.target);
    }
    return { updated: true, skill: readSkillDescriptor(skillRoot) };
  } catch (error) {
    for (const item of backups.reverse()) {
      if (item.existed) fs.copyFileSync(item.backup, item.target);
      else fs.rmSync(item.target, { force: true });
    }
    throw error;
  } finally {
    for (const item of backups) fs.rmSync(item.backup, { force: true });
  }
}

async function installSkill(event, payload = {}) {
  let sourcePath = String(payload?.sourcePath || "").trim();
  if (!sourcePath) {
    const result = await showSkillSourceDialog(event, payload?.sourceType === "folder" ? "folder" : "file");
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    sourcePath = result.filePaths[0];
  }
  const prepared = await materializeSkillSource(sourcePath);
  try {
    return await commitSkillDirectory(prepared.sourceRoot, { ...payload, sourcePath, sourceKind: prepared.sourceKind }, {
      source: "local",
      sourceLabel: "本地导入",
      sourceReference: path.basename(sourcePath)
    });
  } finally {
    prepared.cleanup();
  }
}

function showSkillSourceDialog(event, sourceType = "file") {
  const folderMode = sourceType === "folder";
  return dialog.showOpenDialog(senderWindow(event), {
    title: folderMode ? "选择技能文件夹" : sourceType === "unified" ? "选择技能" : "选择技能文件",
    properties: [folderMode ? "openDirectory" : "openFile"],
    ...(folderMode ? {} : {
      filters: [
        { name: "支持的技能文件", extensions: ["md", "markdown", "zip"] },
        { name: "Markdown 技能", extensions: ["md", "markdown"] },
        { name: "ZIP 技能包", extensions: ["zip"] }
      ]
    })
  });
}

function normalizeOnlineSkillReference(value) {
  const source = String(value || "").trim();
  if (!source) throw new Error("缺少在线技能来源");
  if (/^https:\/\/github\.com\//i.test(source)) {
    const url = new URL(source);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) throw new Error("GitHub 技能地址格式不正确");
    const repository = parts[1].replace(/\.git$/i, "");
    const ref = ["tree", "blob"].includes(parts[2]) && parts[3] ? `@${parts.slice(3).join("/")}` : "";
    return `git:${parts[0]}/${repository}${ref}`;
  }
  if (/^@[\w.-]+\/[a-z0-9][a-z0-9-]*$/i.test(source)) return source;
  if (/^[\w.-]+\/[a-z0-9][a-z0-9-]*$/i.test(source)) return `@${source}`;
  if (/^git:[\w.-]+\/[\w.-]+(?:@[\w./-]+)?$/i.test(source)) return source;
  throw new Error("请输入在线技能引用或 GitHub 仓库地址");
}

const githubApiBaseUrl = String(process.env.XIANMA_GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, "");
const githubCodeloadBaseUrl = String(process.env.XIANMA_GITHUB_CODELOAD_BASE_URL || "https://codeload.github.com").replace(/\/+$/, "");
const githubRawBaseUrl = String(process.env.XIANMA_GITHUB_RAW_BASE_URL || "https://raw.githubusercontent.com").replace(/\/+$/, "");

function parseGitHubSkillReference(reference) {
  const match = String(reference || "").match(/^git:([\w.-]+)\/([\w.-]+?)(?:@([\w./-]+))?$/i);
  if (!match) return null;
  const selector = String(match[3] || "").replace(/^\/+|\/+$/g, "");
  if (selector.split("/").some((part) => part === "..")) throw new Error("GitHub 技能路径不安全");
  return { owner: match[1], repository: match[2].replace(/\.git$/i, ""), selector };
}

async function fetchOnlineResponse(url, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 2));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(options.timeoutMs || 30000)));
    try {
      const fetcher = electronSession.defaultSession?.fetch?.bind(electronSession.defaultSession) || global.fetch;
      const response = await fetcher(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "XMAI-Studio-Skill-Installer",
          accept: options.accept || "application/octet-stream",
          ...(options.headers || {})
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("网络请求失败");
}

async function fetchGitHubJson(url) {
  const response = await fetchOnlineResponse(url, { accept: "application/vnd.github+json", timeoutMs: 20000 });
  return response.json();
}

function githubPathUrl(baseUrl, ...parts) {
  return `${baseUrl}/${parts.flatMap((part) => String(part || "").split("/")).filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function githubReferenceCandidates(parsed, defaultBranch = "main") {
  const selectorParts = parsed.selector.split("/").filter(Boolean);
  const candidates = [];
  const add = (ref, requestedPath = "") => {
    if (!ref) return;
    const key = `${ref}\0${requestedPath}`;
    if (!candidates.some((item) => item.key === key)) candidates.push({ key, ref, requestedPath });
  };
  if (selectorParts.length) {
    if (selectorParts[0] === defaultBranch) add(defaultBranch, selectorParts.slice(1).join("/"));
    for (let splitAt = selectorParts.length; splitAt >= 1; splitAt -= 1) {
      add(selectorParts.slice(0, splitAt).join("/"), selectorParts.slice(splitAt).join("/"));
    }
  } else {
    add(defaultBranch, "");
    add("main", "");
    add("master", "");
  }
  return candidates;
}

function extractedRepositoryRoot(rootPath) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return entries.length === 1 ? path.join(rootPath, entries[0].name) : rootPath;
}

async function downloadGitHubArchive(parsed, candidate, temporaryRoot) {
  const archiveUrls = [
    githubPathUrl(githubCodeloadBaseUrl, parsed.owner, parsed.repository, "zip", candidate.ref),
    `${githubApiBaseUrl}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/zipball/${encodeURIComponent(candidate.ref)}`
  ];
  let lastError = null;
  for (const archiveUrl of archiveUrls) {
    try {
      const response = await fetchOnlineResponse(archiveUrl, { timeoutMs: 45000, attempts: 2 });
      const archivePath = path.join(temporaryRoot, `github-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
      fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
      const extractRoot = ensureDir(path.join(temporaryRoot, `archive-${Date.now()}-${Math.random().toString(36).slice(2)}`));
      await extractSkillZip(archivePath, extractRoot);
      fs.rmSync(archivePath, { force: true });
      const repositoryRoot = extractedRepositoryRoot(extractRoot);
      let requestedRoot = candidate.requestedPath ? path.resolve(repositoryRoot, candidate.requestedPath) : repositoryRoot;
      if (!isPathInside(repositoryRoot, requestedRoot) || !fs.existsSync(requestedRoot)) throw new Error("GitHub 地址中的技能路径不存在");
      if (fs.statSync(requestedRoot).isFile() && /^SKILL\.md$/i.test(path.basename(requestedRoot))) requestedRoot = path.dirname(requestedRoot);
      if (!fs.statSync(requestedRoot).isDirectory()) throw new Error("GitHub 地址没有指向技能目录");
      return findSkillRoot(requestedRoot, parsed.repository);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("GitHub 仓库下载失败");
}

function chooseGitHubTreeSkillRoot(tree, requestedPath, repository) {
  const normalizedPath = String(requestedPath || "").replace(/^\/+|\/+$/g, "").replace(/\/SKILL\.md$/i, "");
  if (normalizedPath && tree.some((item) => String(item.path || "").toLowerCase() === `${normalizedPath}/skill.md`.toLowerCase())) return normalizedPath;
  const roots = tree
    .filter((item) => item.type === "blob" && /(^|\/)SKILL\.md$/i.test(item.path))
    .map((item) => item.path.replace(/(^|\/)SKILL\.md$/i, ""));
  if (!roots.length) throw new Error("GitHub 仓库中没有找到可安装的 SKILL.md");
  const preferredKey = skillMatchKey(repository);
  return roots.sort((left, right) => {
    const score = (value) => {
      const baseKey = skillMatchKey(value.split("/").pop());
      let result = 100 - value.split("/").length;
      if (baseKey === preferredKey) result += 600;
      if (/(^|\/)\.codex\/skills\//i.test(value)) result += 80;
      if (/(^|\/)\.claude\/skills\//i.test(value)) result += 70;
      if (/(^|\/)(?:examples?|fixtures?|templates?|assets?)\//i.test(value)) result -= 120;
      return result;
    };
    return score(right) - score(left) || left.localeCompare(right);
  })[0];
}

async function downloadGitHubSkillFiles(parsed, candidate, temporaryRoot) {
  const treeUrl = `${githubApiBaseUrl}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/git/trees/${encodeURIComponent(candidate.ref)}?recursive=1`;
  const treeResponse = await fetchGitHubJson(treeUrl);
  if (treeResponse?.truncated) throw new Error("GitHub 仓库目录过大，无法完整读取技能文件");
  const tree = Array.isArray(treeResponse?.tree) ? treeResponse.tree : [];
  const skillPath = chooseGitHubTreeSkillRoot(tree, candidate.requestedPath, parsed.repository);
  const prefix = skillPath ? `${skillPath}/` : "";
  const files = tree.filter((item) => item.type === "blob" && item.path.startsWith(prefix));
  if (!files.some((item) => String(item.path || "").toLowerCase() === `${prefix}skill.md`.toLowerCase())) throw new Error("GitHub 技能入口不存在");
  if (files.some((item) => String(item.mode) === "120000")) throw new Error("技能目录包含符号链接");
  const outputRoot = ensureDir(path.join(temporaryRoot, `files-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      const relativePath = file.path.slice(prefix.length);
      const outputPath = path.resolve(outputRoot, relativePath);
      if (!isPathInside(outputRoot, outputPath)) throw new Error("GitHub 技能包含越界路径");
      const rawUrl = githubPathUrl(githubRawBaseUrl, parsed.owner, parsed.repository, candidate.ref, file.path);
      const response = await fetchOnlineResponse(rawUrl, { timeoutMs: 30000, attempts: 3 });
      ensureDir(path.dirname(outputPath));
      fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    }
  });
  await Promise.all(workers);
  return findSkillRoot(outputRoot, parsed.repository);
}

async function materializeGitHubSkillReference(reference) {
  const parsed = parseGitHubSkillReference(reference);
  if (!parsed) throw new Error("GitHub 技能地址格式不正确");
  const temporaryRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "xmai-github-skill-"));
  let defaultBranch = "main";
  try {
    const metadata = await fetchGitHubJson(`${githubApiBaseUrl}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`);
    defaultBranch = String(metadata?.default_branch || "main");
  } catch (error) {
    writeAiDiagnostic("github-skill-metadata", { reference, message: String(error?.message || "unknown").slice(0, 200) });
  }
  const candidates = githubReferenceCandidates(parsed, defaultBranch);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const sourceRoot = await downloadGitHubArchive(parsed, candidate, temporaryRoot);
      return { sourceRoot, sourceKind: "github", cleanup() { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } };
    } catch (archiveError) {
      lastError = archiveError;
      try {
        const sourceRoot = await downloadGitHubSkillFiles(parsed, candidate, temporaryRoot);
        return { sourceRoot, sourceKind: "github-api", cleanup() { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } };
      } catch (filesError) {
        lastError = filesError;
      }
    }
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw new Error(`GitHub 技能下载失败：${sanitizeVisibleSkillText(lastError?.message || "无法连接技能仓库")}`);
}

async function installCompanySkillPackage({ userId, packagePath, skill }) {
  const prepared = await materializeSkillSource(packagePath);
  try {
    const installId = `company-${safeWorkspaceSegment(skill.skillId)}`;
    const result = await commitSkillDirectory(prepared.sourceRoot, {
      userId,
      sourcePath: packagePath,
      sourceKind: "zip",
      installId,
      replace: true,
      acknowledgeRisk: true
    }, {
      source: "company",
      sourceLabel: "公司技能库",
      sourceReference: skill.skillId,
      installId,
      personalSkillId: "",
      categoryId: skill.categoryId || "efficiency-tools",
      tagIds: Array.isArray(skill.tagIds) ? skill.tagIds : [],
      companySkillId: skill.skillId,
      companyVersion: skill.latestVersion,
      packageSha256: skill.sha256,
      packageSignature: skill.signature
    });
    if (!result.installed) throw new Error("公司技能未能完成安装");
    return result;
  } finally {
    prepared.cleanup();
  }
}

async function disableInstalledCompanySkill(userId, companySkillId) {
  const root = getUserSkillsDir(userId);
  const entry = fs.readdirSync(root, { withFileTypes: true }).find((candidate) => {
    if (!candidate.isDirectory() || candidate.name.startsWith(".")) return false;
    try {
      return readSkillDescriptor(findSkillRoot(path.join(root, candidate.name))).companySkillId === companySkillId;
    } catch {
      return false;
    }
  });
  if (!entry) return { disabled: false };
  const quarantineRoot = ensureDir(path.join(root, ".disabled-company"));
  const targetPath = path.join(quarantineRoot, `${safeWorkspaceSegment(companySkillId)}-${Date.now()}`);
  await renameSkillDirectory(path.join(root, entry.name), targetPath);
  return { disabled: true, path: targetPath };
}

const companySkillsClient = companySkillsEnabled ? createCompanySkillsClient({
  app,
  dialog,
  fs,
  path,
  crypto,
  JSZip,
  publicKeyPath: companySkillSigningPublicKeyPath,
  getServiceConfig: getDesktopTelemetryConfig,
  getSessionToken: () => desktopTelemetry.sessionToken,
  getUserSkillsDir,
  listInstalledSkills,
  installCompanyPackage: installCompanySkillPackage,
  disableCompanySkill: disableInstalledCompanySkill
}) : null;

const onlineSkillPreflightCache = new Map();
const onlineSkillPreflightTtlMs = 5 * 60 * 1000;

function parseOnlineSkillOwnerReference(reference) {
  const match = String(reference || "").trim().match(/^@([\w.-]+)\/([a-z0-9][a-z0-9-]*)$/i);
  return match ? { ownerHandle: match[1], slug: match[2] } : null;
}

function inspectOnlineSkillMarkdown(markdown) {
  const source = String(markdown || "").replace(/^\uFEFF/, "").trim();
  const block = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!block) return { installable: false, reason: "缺少有效的 SKILL.md Front Matter" };

  const lines = block[1].split(/\r?\n/);
  let name = "";
  let description = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nameMatch = line.match(/^name\s*:\s*(.*?)\s*$/i);
    if (nameMatch) {
      name = nameMatch[1].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
      continue;
    }
    const descriptionMatch = line.match(/^description\s*:\s*(.*?)\s*$/i);
    if (!descriptionMatch) continue;
    const rawValue = descriptionMatch[1].trim();
    if (/^[>|](?:[-+]?)?(?:\s+#.*)?$/.test(rawValue)) {
      return { installable: false, reason: "SKILL.md 的 description 必须是单行文字" };
    }
    if (!rawValue) return { installable: false, reason: "SKILL.md 缺少 description" };
    description = rawValue;
  }

  if (!name) return { installable: false, reason: "SKILL.md 缺少 name" };
  if (!description) return { installable: false, reason: "SKILL.md 缺少 description" };
  return { installable: true };
}

async function fetchOnlineSkillJson(url) {
  const fetcher = electronSession.defaultSession?.fetch?.bind(electronSession.defaultSession) || global.fetch;
  const response = await fetcher(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`在线技能详情返回 ${response.status}`);
  return await response.json();
}

async function preflightOnlineSkill(reference, options = {}) {
  const normalizedReference = normalizeOnlineSkillReference(reference);
  const parsed = parseOnlineSkillOwnerReference(normalizedReference);
  if (!parsed) {
    return { status: "skipped", installable: true, reason: "来源将在安装时检查" };
  }
  const cached = onlineSkillPreflightCache.get(normalizedReference);
  if (!options.force && cached && Date.now() - cached.checkedAt < onlineSkillPreflightTtlMs) return cached.result;

  const url = new URL(`/api/v1/skills/${encodeURIComponent(parsed.slug)}`, onlineSkillLibraryUrl);
  url.searchParams.set("owner", parsed.ownerHandle);
  try {
    const body = await fetchOnlineSkillJson(url.toString());
    const markdown = String(body?.skill?.description || "");
    const inspection = inspectOnlineSkillMarkdown(markdown);
    const result = inspection.installable
      ? { status: "valid", installable: true, reason: "" }
      : { status: "invalid", installable: false, reason: inspection.reason };
    onlineSkillPreflightCache.set(normalizedReference, { checkedAt: Date.now(), result });
    return result;
  } catch (error) {
    const result = {
      status: "unavailable",
      installable: false,
      reason: "暂时无法完成技能格式检查"
    };
    onlineSkillPreflightCache.set(normalizedReference, { checkedAt: Date.now(), result });
    writeAiDiagnostic("online-skill-preflight", {
      reference: normalizedReference,
      message: String(error?.message || "unknown").slice(0, 240)
    });
    return result;
  }
}

async function searchOnlineSkills(payload = {}) {
  const query = String(payload?.query || "").trim().slice(0, 120);
  const limit = Math.max(1, Math.min(30, Number(payload?.limit) || 20));
  if (query && (/^https:\/\/github\.com\//i.test(query) || /^git:/i.test(query) || /^@[\w.-]+\//.test(query))) {
    const reference = normalizeOnlineSkillReference(query);
    const preflight = await preflightOnlineSkill(reference);
    return {
      filteredCount: preflight.status === "invalid" ? 1 : 0,
      results: preflight.status !== "invalid"
        ? [{ reference, slug: reference, name: reference, description: "从指定代码仓库获取技能。安装前会进行格式和风险检查。", ownerHandle: "", downloads: 0, direct: true, installable: true, preflightStatus: preflight.status }]
        : []
    };
  }
  const url = new URL("/api/v1/search", onlineSkillLibraryUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  try {
    const fetcher = electronSession.defaultSession?.fetch?.bind(electronSession.defaultSession) || global.fetch;
    const response = await fetcher(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`在线技能库返回 ${response.status}`);
    const body = await response.json();
    const results = Array.isArray(body?.results) ? body.results : [];
    const checkedResults = await Promise.all(results.map(async (item) => {
      const slug = String(item?.slug || "").trim();
      const ownerHandle = String(item?.ownerHandle || item?.owner?.handle || "").trim();
      const reference = ownerHandle && slug ? `@${ownerHandle}/${slug}` : "";
      if (!reference) return null;
      const preflight = await preflightOnlineSkill(reference);
      return { item, slug, ownerHandle, reference, preflight };
    }));
    const filteredCount = checkedResults.filter((entry) => entry && entry.preflight.status === "invalid").length;
    const preflightPendingCount = checkedResults.filter((entry) => entry && entry.preflight.status !== "valid" && entry.preflight.status !== "invalid").length;
    return {
      filteredCount,
      preflightPendingCount,
      results: checkedResults.map((entry) => {
        if (!entry) return null;
        const { item, slug, ownerHandle, reference, preflight } = entry;
        return {
          reference,
          slug,
          name: sanitizeVisibleSkillText(item?.displayName || slug),
          description: sanitizeVisibleSkillText(item?.summary || "暂无简介"),
          ownerHandle: sanitizeVisibleSkillText(ownerHandle),
          ownerName: sanitizeVisibleSkillText(item?.owner?.displayName || ownerHandle),
          downloads: Math.max(0, Number(item?.downloads || 0)),
          updatedAt: Number(item?.updatedAt || 0),
          version: String(item?.version || ""),
          installable: preflight.status !== "invalid",
          preflightStatus: preflight.status,
          installabilityReason: preflight.reason
        };
      }).filter((item) => item?.reference && item.preflightStatus !== "invalid")
    };
  } catch (error) {
    throw new Error(sanitizeVisibleSkillText(error?.message || "在线技能库暂不可用"));
  }
}

function runSkillCli(nodePath, entryPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [entryPath, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env, CI: "1", NO_COLOR: "1", OPENCLAW_NO_AUTO_UPDATE: "1" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const append = (current, chunk) => `${current}${chunk}`;
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString("utf8")); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString("utf8")); });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => finish(resolve, { code: Number(code ?? 1), stdout, stderr }));
  });
}

async function installOnlineSkill(payload = {}) {
  const reference = normalizeOnlineSkillReference(payload?.reference);
  const preflight = await preflightOnlineSkill(reference, { force: true });
  if (preflight.status === "invalid") {
    return {
      installed: false,
      filtered: true,
      installable: false,
      reference,
      message: preflight.reason
    };
  }
  if (reference.startsWith("git:") && payload?.acknowledgeRisk !== true) {
    return {
      installed: false,
      requiresRiskAcknowledgement: true,
      inspection: {
        sourceKind: "online",
        skill: { name: reference, description: "代码仓库来源未经在线技能库发布校验。", riskLevel: "high", riskItems: ["将从外部代码仓库下载技能文件，请确认来源可信"] }
      }
    };
  }
  if (reference.startsWith("git:")) {
    const prepared = await materializeGitHubSkillReference(reference);
    try {
      const descriptor = readSkillDescriptor(prepared.sourceRoot, "online");
      if (descriptor.riskLevel === "high" && payload?.acknowledgeRisk !== true) {
        return { installed: false, requiresRiskAcknowledgement: true, inspection: publicSkillInspection(reference, prepared.sourceKind, descriptor, payload?.userId || "local-user") };
      }
      const result = await commitSkillDirectory(prepared.sourceRoot, { ...payload, sourcePath: reference, sourceKind: prepared.sourceKind }, {
        source: "online",
        sourceLabel: "GitHub 技能库",
        sourceReference: reference
      });
      return { ...result, reference };
    } finally {
      prepared.cleanup();
    }
  }
  const runtimeRoot = await ensureAgentRuntimeAvailable();
  const { nodePath, entryPath } = getManagedGatewayResourcePaths(runtimeRoot);
  if (!nodePath || !fs.existsSync(entryPath)) throw new Error("在线技能安装组件不可用，请重新安装应用");
  const temporaryRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "xianma-skill-online-"));
  const workspacePath = ensureDir(path.join(temporaryRoot, "workspace"));
  const stateDir = ensureDir(path.join(temporaryRoot, "state"));
  const configPath = path.join(temporaryRoot, "runtime-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    agents: { defaults: { workspace: workspacePath } },
    update: { checkOnStart: false, auto: { enabled: false } }
  }, null, 2), "utf8");
  try {
    const args = ["skills", "install", reference];
    if (payload?.acknowledgeRisk === true && reference.startsWith("@")) args.push("--acknowledge-clawhub-risk");
    const result = await runSkillCli(nodePath, entryPath, args, {
      cwd: workspacePath,
      env: {
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_CLAWHUB_URL: onlineSkillLibraryUrl,
        CLAWHUB_DISABLE_TELEMETRY: "1"
      }
    });
    if (result.code !== 0) {
      const rawMessage = `${result.stderr}\n${result.stdout}`.trim();
      if (/acknowledge[^\n]*risk|risky|suspicious/i.test(rawMessage)) {
        return {
          installed: false,
          requiresRiskAcknowledgement: true,
          inspection: { sourceKind: "online", skill: { name: reference, description: "在线安全检查要求人工确认后才能安装。", riskLevel: "high", riskItems: ["在线安全检查提示此技能需要人工复核"] } }
        };
      }
      throw new Error(`在线技能安装失败：${sanitizeVisibleSkillText(rawMessage).slice(0, 360) || "未知错误"}`);
    }
    const installedRoot = findSkillRoot(path.join(workspacePath, "skills"));
    const descriptor = readSkillDescriptor(installedRoot, "online");
    if (descriptor.riskLevel === "high" && payload?.acknowledgeRisk !== true) {
      return { installed: false, requiresRiskAcknowledgement: true, inspection: publicSkillInspection(reference, "online", descriptor, payload?.userId || "local-user") };
    }
    const committed = await commitSkillDirectory(installedRoot, { ...payload, sourcePath: reference, sourceKind: "online" }, {
      source: "online",
      sourceLabel: "在线技能库",
      sourceReference: reference
    });
    return { ...committed, reference };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function inspectOnlineSkill(payload = {}) {
  const reference = normalizeOnlineSkillReference(payload?.reference);
  if (!reference.startsWith("git:")) throw new Error("请填写公开 GitHub 技能仓库地址");
  const prepared = await materializeGitHubSkillReference(reference);
  try {
    const descriptor = readSkillDescriptor(prepared.sourceRoot, "online");
    const inspection = publicSkillInspection(reference, prepared.sourceKind, descriptor, payload?.userId || "local-user");
    return {
      reference,
      inspection: {
        ...inspection,
        requiresRiskAcknowledgement: true,
        skill: {
          ...inspection.skill,
          riskLevel: "high",
          riskItems: [...new Set([...(descriptor.riskItems || []), "将从外部代码仓库下载技能文件，请确认来源可信"])]
        }
      }
    };
  } finally {
    prepared.cleanup();
  }
}

function publicSkillInstallResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    installed: Boolean(result.installed),
    filtered: Boolean(result.filtered),
    installable: result.installable !== false,
    reference: String(result.reference || ""),
    message: String(result.message || ""),
    replaced: Boolean(result.replaced),
    requiresRiskAcknowledgement: Boolean(result.requiresRiskAcknowledgement),
    requiresReplace: Boolean(result.requiresReplace),
    inspection: result.inspection || null,
    skill: result.skill || null
  };
}

function publishSkillInstallProgress(job, status, extra = {}) {
  const payload = {
    jobId: job.jobId,
    userId: job.userId,
    sourceType: job.sourceType,
    sourcePath: job.sourcePath || "",
    reference: job.reference || "",
    skillName: job.skillName || job.reference || "新技能",
    status,
    ...extra
  };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("desktop:skill-install-progress", payload);
  }
  return payload;
}

function queueSkillInstall(event, payload = {}, sourceType = "local") {
  const userId = String(payload?.userId || "local-user");
  const sourcePath = String(payload?.sourcePath || "").trim();
  const reference = String(payload?.reference || "").trim();
  const fingerprint = `${sourceType}:${userId}:${sourcePath || reference}`;
  const existing = [...activeSkillInstallJobs.values()].find((job) => job.fingerprint === fingerprint && ["queued", "installing"].includes(job.status));
  if (existing) return { queued: true, duplicate: true, jobId: existing.jobId, status: existing.status, skillName: existing.skillName };

  const job = {
    jobId: createId("skill-install"),
    fingerprint,
    userId,
    sourceType,
    sourcePath,
    reference,
    skillName: String(payload?.skillName || reference || (sourcePath ? path.basename(sourcePath) : "新技能")),
    flags: {
      acknowledgeRisk: payload?.acknowledgeRisk === true,
      replace: payload?.replace === true
    },
    status: "queued",
    createdAt: nowIso()
  };
  activeSkillInstallJobs.set(job.jobId, job);
  publishSkillInstallProgress(job, "queued");

  setImmediate(async () => {
      job.status = "installing";
    publishSkillInstallProgress(job, "installing");
    try {
      const operationPayload = { ...payload, sourcePath, reference };
      const result = sourceType === "online"
        ? await installOnlineSkill(operationPayload)
        : await installSkill(event, operationPayload);
      const publicResult = publicSkillInstallResult(result);
      job.result = publicResult;
      if (publicResult?.filtered) {
        job.status = "failed";
        publishSkillInstallProgress(job, job.status, {
          filtered: true,
          error: publicResult.message || "技能格式不兼容"
        });
        return;
      }
      if (publicResult?.requiresRiskAcknowledgement || publicResult?.requiresReplace) {
        job.status = "confirmation-required";
        publishSkillInstallProgress(job, job.status, { result: publicResult, flags: job.flags });
        return;
      }
      if (!publicResult?.installed) throw new Error(publicResult?.message || "技能未完成安装");
      job.status = "completed";
      job.skillName = publicResult.skill?.name || job.skillName;
      publishSkillInstallProgress(job, job.status, { result: publicResult, skillName: job.skillName });
    } catch (error) {
      job.status = "failed";
      const message = sanitizeVisibleSkillText(error?.message || "技能安装失败");
      publishSkillInstallProgress(job, job.status, { error: message });
    } finally {
      setTimeout(() => activeSkillInstallJobs.delete(job.jobId), 10 * 60 * 1000);
    }
  });

  return { queued: true, jobId: job.jobId, status: job.status, skillName: job.skillName };
}

async function removeInstalledSkill(payload = {}) {
  const id = String(payload?.skillId || "");
  if (!id.startsWith("installed-")) throw new Error("内置技能不能卸载");
  const submissionStatus = String(payload?.submissionStatus || "").trim().toLowerCase();
  if (["pending", "in_review"].includes(submissionStatus)) throw new Error("审批中的技能必须先撤回申请，才能删除个人技能");
  if (["approved", "published", "revoked"].includes(submissionStatus)) throw new Error("当前状态的个人技能不能编辑或删除");
  const target = findInstalledSkillRoot(payload?.userId || "local-user", id);
  if (!target) throw new Error("技能不存在或已卸载");
  await fs.promises.rm(target, { recursive: true, force: true });
  return { removed: true, skillId: id };
}

function resolveUserWorkspacePath(userId, relativePath = "") {
  const rootPath = getUserWorkspaceDir(userId);
  const targetPath = path.resolve(rootPath, String(relativePath || ""));
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("只能访问当前用户的本地文件目录");
  return { rootPath, targetPath };
}

function resolveComputerPath(userId, requestedPath = "") {
  const rootPath = getUserWorkspaceDir(userId);
  const value = String(requestedPath || "").trim();
  const targetPath = path.resolve(path.isAbsolute(value) ? value : path.join(rootPath, value));
  return { rootPath, targetPath, requestedPath: value || rootPath };
}

function listComputerDirectory(currentPath, depth = 0, maximumDepth = 0) {
  if (!fs.existsSync(currentPath)) throw new Error(`路径不存在：${currentPath}`);
  const stat = fs.statSync(currentPath);
  if (!stat.isDirectory()) throw new Error(`目标不是目录：${currentPath}`);
  return fs.readdirSync(currentPath, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(currentPath, entry.name);
    let metadata = null;
    try { metadata = fs.statSync(fullPath); } catch { /* Windows ACL may hide metadata */ }
    return {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? "directory" : (entry.isFile() ? "file" : "other"),
      bytes: metadata?.isFile() ? metadata.size : 0,
      modifiedAt: metadata?.mtime?.toISOString?.() || "",
      children: entry.isDirectory() && depth < maximumDepth
        ? (() => { try { return listComputerDirectory(fullPath, depth + 1, maximumDepth); } catch { return []; } })()
        : undefined
    };
  });
}

function searchComputerFiles(rootPath, query, options = {}) {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) throw new Error(`搜索目录不存在：${rootPath}`);
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) throw new Error("缺少搜索关键词");
  const requestedMaximum = Number(options.maxResults);
  const maximumResults = Number.isFinite(requestedMaximum) && requestedMaximum > 0 ? requestedMaximum : 500;
  const includeContent = options.includeContent === true;
  const results = [];
  const stack = [rootPath];
  while (stack.length && results.length < maximumResults) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (results.length >= maximumResults) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
      if (!entry.isFile()) continue;
      let matched = entry.name.toLowerCase().includes(normalizedQuery);
      if (!matched && includeContent && isTextLikeFile(fullPath)) {
        try { matched = fs.readFileSync(fullPath, "utf8").toLowerCase().includes(normalizedQuery); } catch { /* inaccessible file */ }
      }
      if (!matched) continue;
      let stat = null;
      try { stat = fs.statSync(fullPath); } catch { /* inaccessible metadata */ }
      results.push({ path: fullPath, name: entry.name, bytes: stat?.size || 0, modifiedAt: stat?.mtime?.toISOString?.() || "" });
    }
  }
  return results;
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

function windowsUiAutomationScriptPath() {
  const candidates = [
    path.join(process.resourcesPath || "", runtimeToolDirectoryName, "windows-ui-automation.ps1"),
    path.join(__dirname, "..", "build", "runtime-tools", "windows-ui-automation.ps1")
  ];
  const scriptPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!scriptPath) throw new Error("Windows 应用操作组件未随软件安装");
  return scriptPath;
}

function windowsUiAutomationEnvironment() {
  const names = [
    "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)",
    "ProgramW6432", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP", "ComSpec"
  ];
  return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

function runWindowsUiAutomation(payload = {}, signal) {
  if (process.platform !== "win32") return Promise.reject(new Error("当前应用操作能力仅支持 Windows"));
  if (signal?.aborted) return Promise.reject(createGenerationStoppedError());
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const argumentsList = [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass",
    "-File", windowsUiAutomationScriptPath(), "-PayloadBase64", encodedPayload
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", argumentsList, {
      windowsHide: true,
      env: windowsUiAutomationEnvironment()
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (type, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      if (type === "resolve") resolve(value);
      else reject(value);
    };
    const handleAbort = () => {
      if (child.exitCode === null) child.kill();
      finish("reject", createGenerationStoppedError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => finish("reject", error));
    child.on("close", (code) => {
      let result = null;
      try {
        const line = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1) || "";
        result = JSON.parse(line);
      } catch {
        return finish("reject", new Error(`应用操作组件返回了无法解析的结果${stderr.trim() ? `：${stderr.trim().slice(0, 400)}` : ""}`));
      }
      if (code !== 0 || result?.ok !== true) {
        return finish("reject", new Error(String(result?.error || stderr.trim() || "应用操作失败").slice(0, 1000)));
      }
      return finish("resolve", result);
    });
  });
}

function sanitizeConfirmationDetail(value, maximumLength = 4000) {
  return String(value || "")
    .replace(/(?:sk|api[-_ ]?key)[-_a-zA-Z0-9]{12,}/gi, "[已隐藏]")
    .replace(/(password|passwd|token|secret)\s*[:=]\s*[^\s]+/gi, "$1=[已隐藏]")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maximumLength);
}

function cleanDesktopMessageDrafts() {
  const expiresBefore = Date.now() - desktopMessageDraftMaxAgeMs;
  for (const [draftId, draft] of pendingDesktopMessageDrafts.entries()) {
    if (Number(draft?.createdAt || 0) < expiresBefore) pendingDesktopMessageDrafts.delete(draftId);
  }
}

function normalizeDesktopAppName(value) {
  const appName = String(value || "").trim().slice(0, 500);
  if (!appName) throw new Error("缺少要操作的应用名称或路径");
  return appName;
}

function normalizeBrowserAppName(value) {
  const browser = String(value || "Microsoft Edge").trim().toLowerCase();
  if (/chrome|google|谷歌/.test(browser)) return "Google Chrome";
  return "Microsoft Edge";
}

function normalizeBrowserUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("缺少要打开的网址");
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("网址格式不正确");
  }
  if (!["http:", "https:", "file:"].includes(target.protocol)) {
    throw new Error("浏览器只能打开 http、https 或本地 file 地址");
  }
  return target.toString();
}

function browserSearchUrl(browser, query, searchType) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) throw new Error("缺少搜索内容");
  const images = String(searchType || "web").toLowerCase() === "images";
  if (normalizeBrowserAppName(browser) === "Google Chrome") {
    const target = new URL("https://www.google.com/search");
    target.searchParams.set("q", normalizedQuery);
    if (images) target.searchParams.set("tbm", "isch");
    return target.toString();
  }
  const target = new URL(images ? "https://www.bing.com/images/search" : "https://www.bing.com/search");
  target.searchParams.set("q", normalizedQuery);
  return target.toString();
}

function browserAutomationProfilePath(userId, browser) {
  const profileName = normalizeBrowserAppName(browser) === "Google Chrome" ? "chrome" : "edge";
  return ensureDir(path.join(getStoreDir(userId), "browser-profiles", `${profileName}-controlled`));
}

function browserDebugPort(userId, browser) {
  const digest = crypto.createHash("sha256")
    .update(`${safeWorkspaceSegment(userId || "local-user")}::${normalizeBrowserAppName(browser)}`, "utf8")
    .digest();
  return 42000 + (digest.readUInt16BE(0) % 10000);
}

async function browserCdpTargets(port, signal) {
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) return [];
  const response = await fetch(`http://127.0.0.1:${Number(port)}/json/list`, { signal });
  if (!response.ok) throw new Error(`浏览器调试接口返回 ${response.status}`);
  const targets = await response.json();
  return Array.isArray(targets) ? targets.filter((target) => target?.type === "page" && target.webSocketDebuggerUrl) : [];
}

function browserTargetMatchesUrl(target, targetUrl) {
  if (!targetUrl) return !/^(?:edge|chrome|devtools):/i.test(String(target?.url || ""));
  try {
    const actual = new URL(String(target?.url || ""));
    const expected = new URL(String(targetUrl));
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return String(target?.url || "") === String(targetUrl || "");
  }
}

async function waitForBrowserCdpTarget(port, targetUrl, targetId = "", signal, waitMs = 12000) {
  const deadline = Date.now() + Math.max(1000, Number(waitMs) || 12000);
  let lastError = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createGenerationStoppedError();
    try {
      const targets = await browserCdpTargets(port, signal);
      const matched = targets.find((target) => targetId && target.id === targetId)
        || targets.find((target) => browserTargetMatchesUrl(target, targetUrl))
        || targets.find((target) => !/^(?:edge|chrome|devtools):/i.test(String(target.url || "")));
      if (matched) return matched;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`浏览器网页控件通道未就绪${lastError?.message ? `：${lastError.message}` : ""}`);
}

function sendBrowserCdpCommand(target, method, params = {}, signal, timeoutMs = 15000) {
  if (typeof WebSocket !== "function") return Promise.reject(new Error("当前运行环境缺少浏览器网页控件支持"));
  if (!target?.webSocketDebuggerUrl) return Promise.reject(new Error("浏览器网页控件通道不可用"));
  if (signal?.aborted) return Promise.reject(createGenerationStoppedError());
  return new Promise((resolve, reject) => {
    const commandId = 1;
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(value);
    };
    const handleAbort = () => finish(createGenerationStoppedError());
    const timer = setTimeout(() => finish(new Error("浏览器网页控件操作等待过久")), Math.max(1000, Number(timeoutMs) || 15000));
    signal?.addEventListener("abort", handleAbort, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: commandId, method, params }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(String(event.data || "")); } catch { return; }
      if (message.id !== commandId) return;
      if (message.error) return finish(new Error(String(message.error.message || "浏览器网页控件操作失败")));
      finish(null, message.result || {});
    });
    socket.addEventListener("error", () => finish(new Error("无法连接浏览器网页控件通道")));
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("浏览器网页控件通道已关闭"));
    });
  });
}

async function waitForBrowserPageReady(target, targetUrl, signal, waitMs = 15000) {
  const deadline = Date.now() + Math.max(1000, Number(waitMs) || 15000);
  let latest = { title: String(target?.title || ""), url: String(target?.url || ""), readyState: "" };
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createGenerationStoppedError();
    try {
      const response = await sendBrowserCdpCommand(target, "Runtime.evaluate", {
        expression: "({ title: document.title, url: location.href, readyState: document.readyState })",
        returnByValue: true
      }, signal, 3000);
      latest = response.result?.value || latest;
      if (browserTargetMatchesUrl({ url: latest.url }, targetUrl) && ["interactive", "complete"].includes(latest.readyState)) return latest;
    } catch {
      // Navigation briefly replaces the page execution context; retry until it settles.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return latest;
}

function browserDomSnapshotInPage(options = {}) {
  const maxResults = Math.max(1, Math.min(500, Number(options.maxResults) || 120));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const roots = [document];
  const seenRoots = new Set(roots);
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot && !seenRoots.has(node.shadowRoot)) {
        seenRoots.add(node.shadowRoot);
        roots.push(node.shadowRoot);
      }
      if (node.tagName === "IFRAME") {
        try {
          if (node.contentDocument && !seenRoots.has(node.contentDocument)) {
            seenRoots.add(node.contentDocument);
            roots.push(node.contentDocument);
          }
        } catch { /* cross-origin frames are unavailable to page JavaScript */ }
      }
    }
  }
  const roleToType = {
    button: "Button", link: "Hyperlink", combobox: "ComboBox", textbox: "Edit",
    checkbox: "CheckBox", radio: "RadioButton", menuitem: "MenuItem", tab: "TabItem"
  };
  const controlType = (element) => {
    const tag = element.tagName;
    const role = normalize(element.getAttribute("role")).toLowerCase();
    if (roleToType[role]) return roleToType[role];
    if (tag === "BUTTON" || tag === "SUMMARY") return "Button";
    if (tag === "A") return "Hyperlink";
    if (tag === "SELECT") return "ComboBox";
    if (tag === "TEXTAREA" || element.isContentEditable) return "Edit";
    if (tag === "INPUT") {
      const inputType = String(element.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(inputType)) return "Button";
      if (inputType === "checkbox") return "CheckBox";
      if (inputType === "radio") return "RadioButton";
      return "Edit";
    }
    return "Custom";
  };
  const elementName = (element) => {
    const labelledBy = normalize(element.getAttribute("aria-labelledby"));
    const labelledText = labelledBy.split(/\s+/).filter(Boolean).map((id) => normalize(document.getElementById(id)?.innerText || document.getElementById(id)?.textContent)).filter(Boolean).join(" ");
    const labelText = Array.from(element.labels || []).map((label) => normalize(label.innerText || label.textContent)).filter(Boolean).join(" ");
    const selectedText = element.tagName === "SELECT" ? normalize(element.options?.[element.selectedIndex]?.text) : "";
    return normalize(element.getAttribute("aria-label")) || labelledText || labelText || selectedText
      || normalize(element.innerText || element.textContent)
      || normalize(element.getAttribute("placeholder")) || normalize(element.getAttribute("title"))
      || normalize(element.getAttribute("alt")) || normalize(element.value);
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0
      && rect.width > 1 && rect.height > 1;
  };
  const selector = "button,a[href],input,select,textarea,summary,[contenteditable='true'],[role='button'],[role='link'],[role='combobox'],[role='textbox'],[role='checkbox'],[role='radio'],[role='menuitem'],[role='tab']";
  const results = [];
  for (const root of roots) {
    for (const element of root.querySelectorAll(selector)) {
      if (results.length >= maxResults || !visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const type = controlType(element);
      const password = element.tagName === "INPUT" && String(element.type || "").toLowerCase() === "password";
      results.push({
        index: results.length,
        name: elementName(element),
        automationId: normalize(element.id),
        controlType: type,
        className: normalize(element.className),
        isEnabled: !element.disabled && element.getAttribute("aria-disabled") !== "true",
        isOffscreen: rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth,
        isKeyboardFocusable: element.tabIndex >= 0 || ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(element.tagName),
        isPassword: password,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        tagName: element.tagName.toLowerCase(),
        value: password ? "" : normalize(element.value),
        options: element.tagName === "SELECT" ? Array.from(element.options).slice(0, 100).map((option) => normalize(option.text)) : undefined,
        source: "browser-dom"
      });
    }
  }
  return { title: document.title, url: location.href, controls: results };
}

async function browserDomActionInPage(payload = {}) {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const comparable = (value) => normalize(value).toLocaleLowerCase();
  const roots = [document];
  const seenRoots = new Set(roots);
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot && !seenRoots.has(node.shadowRoot)) {
        seenRoots.add(node.shadowRoot);
        roots.push(node.shadowRoot);
      }
      if (node.tagName === "IFRAME") {
        try {
          if (node.contentDocument && !seenRoots.has(node.contentDocument)) {
            seenRoots.add(node.contentDocument);
            roots.push(node.contentDocument);
          }
        } catch { /* cross-origin frame */ }
      }
    }
  }
  const roleToType = { button: "Button", link: "Hyperlink", combobox: "ComboBox", textbox: "Edit", checkbox: "CheckBox", radio: "RadioButton", menuitem: "MenuItem", tab: "TabItem" };
  const controlType = (element) => {
    const role = comparable(element.getAttribute("role"));
    if (roleToType[role]) return roleToType[role];
    if (element.tagName === "BUTTON" || element.tagName === "SUMMARY") return "Button";
    if (element.tagName === "A") return "Hyperlink";
    if (element.tagName === "SELECT") return "ComboBox";
    if (element.tagName === "TEXTAREA" || element.isContentEditable) return "Edit";
    if (element.tagName === "INPUT") {
      const type = String(element.type || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "Button";
      if (type === "checkbox") return "CheckBox";
      if (type === "radio") return "RadioButton";
      return "Edit";
    }
    return "Custom";
  };
  const elementName = (element) => {
    const labelledBy = normalize(element.getAttribute("aria-labelledby"));
    const labelledText = labelledBy.split(/\s+/).filter(Boolean).map((id) => normalize(document.getElementById(id)?.innerText || document.getElementById(id)?.textContent)).filter(Boolean).join(" ");
    const labelText = Array.from(element.labels || []).map((label) => normalize(label.innerText || label.textContent)).filter(Boolean).join(" ");
    const selectedText = element.tagName === "SELECT" ? normalize(element.options?.[element.selectedIndex]?.text) : "";
    return normalize(element.getAttribute("aria-label")) || labelledText || labelText || selectedText
      || normalize(element.innerText || element.textContent)
      || normalize(element.getAttribute("placeholder")) || normalize(element.getAttribute("title"))
      || normalize(element.getAttribute("alt")) || normalize(element.value);
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 1 && rect.height > 1;
  };
  const selector = payload.selector || {};
  const selectorName = comparable(selector.name);
  const selectorType = comparable(selector.controlType);
  const selectorId = comparable(selector.automationId);
  const selectorClass = comparable(selector.className);
  const matches = [];
  const query = "button,a[href],input,select,textarea,summary,[contenteditable='true'],[role='button'],[role='link'],[role='combobox'],[role='textbox'],[role='checkbox'],[role='radio'],[role='menuitem'],[role='tab']";
  for (const root of roots) {
    for (const element of root.querySelectorAll(query)) {
      if (!visible(element)) continue;
      const name = comparable(elementName(element));
      const type = comparable(controlType(element));
      const id = comparable(element.id);
      const className = comparable(element.className);
      const nameMatches = !selectorName || (selector.contains === true ? name.includes(selectorName) : name === selectorName);
      if (!nameMatches || (selectorType && type !== selectorType) || (selectorId && id !== selectorId) || (selectorClass && !className.includes(selectorClass))) continue;
      matches.push(element);
    }
  }
  const requestedIndex = Math.max(0, Number(selector.index) || 0);
  const element = matches[requestedIndex];
  if (!element) throw new Error(`网页中没有找到匹配控件${selector.name ? `：${selector.name}` : ""}`);
  if (element.tagName === "INPUT" && String(element.type || "").toLowerCase() === "password" && payload.action === "read_text") {
    throw new Error("安全输入控件的内容不可读取");
  }
  element.scrollIntoView({ block: "center", inline: "nearest" });
  let method = "browser-dom";
  if (payload.action === "click") {
    element.click();
  } else if (payload.action === "set_text") {
    const text = String(payload.text ?? "");
    if (element.tagName === "SELECT") {
      const option = Array.from(element.options).find((candidate) => comparable(candidate.text) === comparable(text) || comparable(candidate.value) === comparable(text))
        || Array.from(element.options).find((candidate) => comparable(candidate.text).includes(comparable(text)));
      if (!option) throw new Error(`下拉框中没有选项：${text}`);
      element.value = option.value;
      method = "browser-dom-select";
    } else if (element.isContentEditable) {
      element.focus();
      element.textContent = text;
      method = "browser-dom-contenteditable";
    } else {
      const prototype = Object.getPrototypeOf(element);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) descriptor.set.call(element, text);
      else element.value = text;
      element.focus();
      method = "browser-dom-input";
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (payload.action === "read_text") {
    return { ok: true, method: "browser-dom-read", text: elementName(element), value: normalize(element.value), title: document.title, url: location.href };
  } else {
    throw new Error(`网页控件不支持操作：${payload.action}`);
  }
  await new Promise((resolve) => setTimeout(resolve, element.tagName === "SELECT" ? 1800 : 700));
  return { ok: true, method, name: elementName(element), controlType: controlType(element), title: document.title, url: location.href };
}

async function inspectBrowserDom(browserSession, maxResults, signal) {
  const target = await waitForBrowserCdpTarget(browserSession.debugPort, browserSession.url, browserSession.cdpTargetId, signal, 5000);
  const expression = `(${browserDomSnapshotInPage.toString()})(${JSON.stringify({ maxResults })})`;
  const response = await sendBrowserCdpCommand(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, signal);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "读取网页控件失败");
  return { ...(response.result?.value || {}), target };
}

async function controlBrowserDom(browserSession, action, selector, text, signal) {
  const target = await waitForBrowserCdpTarget(browserSession.debugPort, browserSession.url, browserSession.cdpTargetId, signal, 5000);
  const payload = { action, selector: selector || {}, text: String(text ?? "") };
  const expression = `(${browserDomActionInPage.toString()})(${JSON.stringify(payload)})`;
  const response = await sendBrowserCdpCommand(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, signal);
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "操作网页控件失败";
    throw new Error(String(detail).split("\n")[0]);
  }
  return { ...(response.result?.value || {}), target };
}

async function captureBrowserPage(target, targetPath, signal) {
  const response = await sendBrowserCdpCommand(target, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  }, signal, 10000);
  const data = String(response.data || "");
  if (!data) throw new Error("浏览器没有返回页面截图");
  const bytes = Buffer.from(data, "base64");
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, bytes);
  const validPng = bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG";
  return {
    path: targetPath,
    width: validPng ? bytes.readUInt32BE(16) : 0,
    height: validPng ? bytes.readUInt32BE(20) : 0,
    source: "browser-cdp"
  };
}

function isBrowserAppName(value) {
  return /(?:microsoft\s*edge|msedge|edge|微软|micsoft|google\s*chrome|chrome|谷歌|浏览器|browser)/i.test(String(value || ""));
}

function browserSessionKey(userId, conversationId, taskId) {
  return [userId || "local-user", conversationId || "default", taskId || "legacy-browser-task"]
    .map((value) => safeWorkspaceSegment(value))
    .join("::");
}

function browserTaskIdFromContext(context = {}) {
  return String(context.browserAutomationTaskId || context.taskId || "legacy-browser-task").trim() || "legacy-browser-task";
}

function getActiveBrowserSession(userId, conversationId, taskId) {
  return activeBrowserSessions.get(browserSessionKey(userId, conversationId, taskId)) || null;
}

function rememberBrowserSession(userId, conversationId, taskId, patch = {}) {
  const key = browserSessionKey(userId, conversationId, taskId);
  const existing = activeBrowserSessions.get(key) || {};
  const next = {
    ...existing,
    ...patch,
    userId: safeWorkspaceSegment(userId || "local-user"),
    conversationId: safeWorkspaceSegment(conversationId || "default"),
    taskId: safeWorkspaceSegment(taskId || "legacy-browser-task"),
    updatedAt: nowIso()
  };
  activeBrowserSessions.delete(key);
  activeBrowserSessions.set(key, next);
  while (activeBrowserSessions.size > 200) {
    activeBrowserSessions.delete(activeBrowserSessions.keys().next().value);
  }
  return next;
}

function publicBrowserTaskRun(runtime = {}) {
  const session = getActiveBrowserSession(runtime.userId, runtime.conversationId, runtime.taskId);
  return {
    taskId: String(runtime.taskId || ""),
    executionId: String(runtime.executionId || ""),
    retryOf: String(runtime.retryOf || ""),
    status: String(runtime.status || "IDLE"),
    firstExecutedAt: runtime.firstExecutedAt || runtime.startedAt || nowIso(),
    startedAt: runtime.startedAt || runtime.firstExecutedAt || nowIso(),
    updatedAt: runtime.updatedAt || nowIso(),
    finishedAt: runtime.finishedAt || "",
    siteKey: String(runtime.siteKey || ""),
    coreGoal: String(runtime.coreGoal || ""),
    browser: String(session?.browser || runtime.browser || ""),
    windowHandle: Number(session?.windowHandle || runtime.windowHandle) || 0,
    url: String(session?.url || runtime.url || ""),
    title: String(session?.title || runtime.title || ""),
    executionDetails: (Array.isArray(runtime.executionDetails) ? runtime.executionDetails : []).slice(-100).map((detail) => ({
      id: String(detail.id || ""),
      timestamp: detail.timestamp || nowIso(),
      startedAt: detail.startedAt || detail.timestamp || "",
      finishedAt: detail.finishedAt || "",
      action: sanitizeAuditText(detail.action, 120),
      target: sanitizeAuditText(detail.target, 500),
      riskConfirmation: sanitizeAuditText(detail.riskConfirmation, 80),
      humanControl: detail.humanControl === true,
      externalImpact: detail.externalImpact === true,
      result: sanitizeAuditText(detail.result, 160),
      error: sanitizeAuditText(detail.error, 300)
    }))
  };
}

function rememberBrowserTaskRun(runtime) {
  const key = browserSessionKey(runtime.userId, runtime.conversationId, runtime.taskId);
  activeBrowserTaskRuns.delete(key);
  activeBrowserTaskRuns.set(key, runtime);
  while (activeBrowserTaskRuns.size > 200) {
    activeBrowserTaskRuns.delete(activeBrowserTaskRuns.keys().next().value);
  }
  return runtime;
}

function registerBrowserTaskRun(event, payload, controller) {
  const taskId = String(payload?.browserAutomationTaskId || "").trim();
  if (payload?.browserAutomationTask !== true || !taskId) return null;
  const userId = payload?.userId || "local-user";
  const conversationId = payload?.conversationId || "default";
  const key = browserSessionKey(userId, conversationId, taskId);
  const existing = activeBrowserTaskRuns.get(key) || {};
  const runtime = {
    ...existing,
    userId: safeWorkspaceSegment(userId),
    conversationId: safeWorkspaceSegment(conversationId),
    taskId: safeWorkspaceSegment(taskId),
    executionId: String(payload?.executionId || crypto.randomUUID()),
    retryOf: String(payload?.retryOf || ""),
    siteKey: String(payload?.browserTaskSiteKey || existing.siteKey || ""),
    coreGoal: String(payload?.browserTaskCoreGoal || existing.coreGoal || ""),
    firstExecutedAt: payload?.browserTaskFirstExecutedAt || existing.firstExecutedAt || nowIso(),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: "",
    status: "RUNNING",
    pauseRequested: false,
    stopRequested: false,
    controller,
    sender: event.sender,
    requestId: String(payload?.requestId || ""),
    executionDetails: Array.isArray(existing.executionDetails) ? existing.executionDetails : []
  };
  rememberBrowserTaskRun(runtime);
  rememberBrowserSession(userId, conversationId, taskId, { status: "active" });
  return runtime;
}

function findBrowserTaskRun(userId, conversationId, taskId) {
  return activeBrowserTaskRuns.get(browserSessionKey(userId, conversationId, taskId)) || null;
}

function recordBrowserTaskExecutionDetail(context = {}, detail = {}) {
  const taskId = browserTaskIdFromContext(context);
  const runtime = findBrowserTaskRun(context.userId || "local-user", context.conversationId || "default", taskId);
  if (!runtime) return null;
  const entry = {
    id: String(detail.id || crypto.randomUUID()),
    timestamp: detail.timestamp || nowIso(),
    ...detail
  };
  runtime.executionDetails = [...(runtime.executionDetails || []), entry].slice(-100);
  runtime.updatedAt = nowIso();
  rememberBrowserTaskRun(runtime);
  return entry;
}

function browserTaskHasExternalImpact(runtime) {
  return (runtime?.executionDetails || []).some((detail) => detail.externalImpact === true && detail.result === "completed");
}

function browserTaskHasUncertainResult(runtime) {
  return (runtime?.executionDetails || []).some((detail) => detail.externalImpact === true && detail.result === "uncertain");
}

function finalizeBrowserTaskRun(runtime, outcome, error = null) {
  if (!runtime) return null;
  let status = outcome;
  if (outcome !== "SUCCEEDED") {
    if (runtime.pauseRequested) status = "PAUSED";
    else if (browserTaskHasUncertainResult(runtime)) status = "RESULT_UNCERTAIN";
    else if (error?.code === "GENERATION_STOPPED" || runtime.stopRequested) {
      status = browserTaskHasExternalImpact(runtime) ? "PARTIAL_SUCCESS" : "CANCELED";
    } else status = "FAILED";
  }
  runtime.status = status;
  runtime.updatedAt = nowIso();
  runtime.finishedAt = status === "PAUSED" ? "" : runtime.updatedAt;
  runtime.controller = null;
  runtime.sender = null;
  rememberBrowserTaskRun(runtime);
  rememberBrowserSession(runtime.userId, runtime.conversationId, runtime.taskId, { status: status.toLowerCase() });
  return publicBrowserTaskRun(runtime);
}

function desktopUiActionNeedsConfirmation(action, args = {}) {
  if (args.commit === true) return true;
  const normalizedAction = String(action || "").toLowerCase();
  if (normalizedAction === "hotkey") {
    return /(?:^|\+)(?:ENTER|DELETE)(?:$|\+)|ALT\+F4|CTRL\+S|ALT\+S/i.test(String(args.keys || ""));
  }
  if (!["click", "click_position"].includes(normalizedAction)) return false;
  const actionText = [
    args.selector?.name,
    args.selector?.automationId,
    args.selector?.className,
    args.purpose
  ].filter(Boolean).join(" ");
  return /(发送|提交|发布|上传|删除|移除|付款|支付|购买|下单|保存|安装|卸载|关闭|退出|确认|send|submit|publish|upload|delete|remove|pay|purchase|save|install|close|quit|confirm)/i.test(actionText);
}

function createDesktopCapturePath(userId, appName) {
  const captureDir = ensureDir(path.join(getUserWorkspaceDir(userId), "desktop-captures"));
  const safeAppName = path.basename(String(appName || "应用窗口"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 48) || "应用窗口";
  return path.join(captureDir, `${safeAppName}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`);
}

function toolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "computer_list",
        description: "查看当前 Windows 账号有权访问的任意磁盘目录。支持 C:\\、D:\\ 等绝对路径；相对路径位于当前用户私有文件目录。",
        parameters: { type: "object", properties: { path: { type: "string" }, depth: { type: "integer", minimum: 0 } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_read",
        description: "读取当前 Windows 账号有权访问的任意文件。文本默认返回 UTF-8；二进制文件可指定 base64。",
        parameters: { type: "object", required: ["path"], properties: { path: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_write",
        description: "在任意可访问路径新建或修改文本文件。覆盖已有文件时必须把 overwrite 设为 true，并由用户在客户端确认。",
        parameters: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" }, overwrite: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_write_document",
        description: "在任意可访问路径生成 Word、PPT、Excel、PDF、HTML、RTF、ODF、CSV、JSON、XML、ZIP 或文本文件。覆盖时需要用户确认。",
        parameters: { type: "object", required: ["path", "title", "content"], properties: { path: { type: "string" }, title: { type: "string" }, content: { type: "string" }, format: { type: "string" }, overwrite: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_copy",
        description: "复制任意可访问的文件或目录。替换已有目标时需要用户确认。",
        parameters: { type: "object", required: ["sourcePath", "targetPath"], properties: { sourcePath: { type: "string" }, targetPath: { type: "string" }, overwrite: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_move",
        description: "移动任意可访问的文件或目录。移动并替换已有目标时需要用户确认。",
        parameters: { type: "object", required: ["sourcePath", "targetPath"], properties: { sourcePath: { type: "string" }, targetPath: { type: "string" }, overwrite: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_delete",
        description: "删除任意可访问的文件或目录。删除前始终需要用户在客户端确认。",
        parameters: { type: "object", required: ["path"], properties: { path: { type: "string" }, recursive: { type: "boolean" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_open",
        description: "使用系统默认应用打开文件、目录、程序或网页。",
        parameters: { type: "object", required: ["target"], properties: { target: { type: "string" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_list_apps",
        description: "列出当前 Windows 桌面上可操作的应用窗口和开始菜单应用。需要操作软件前可先用名称搜索。",
        parameters: { type: "object", properties: { query: { type: "string", description: "应用名称，例如飞书、微信、记事本或 Word" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_launch_app",
        description: "启动或切换到当前 Windows 账号可使用的桌面应用。打开应用本身不需要确认。",
        parameters: {
          type: "object",
          required: ["app"],
          properties: {
            app: { type: "string", description: "应用名称、可执行文件路径或命令，例如飞书、微信、记事本" },
            waitMs: { type: "integer", minimum: 1000, description: "等待应用主窗口出现的时间" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_browser_open",
        description: "真实启动或切换到 Microsoft Edge/Google Chrome，在新标签页打开网址并返回截图。默认独立窗口可读取网页按钮、链接、输入框和下拉框；打开后优先调用 computer_inspect_app，再按控件名称调用 computer_control_app。",
        parameters: {
          type: "object",
          required: ["url"],
          properties: {
            browser: { type: "string", description: "Microsoft Edge、微软浏览器、Google Chrome、谷歌浏览器；默认 Microsoft Edge" },
            url: { type: "string", description: "要实际打开的 http、https 或本地 file 地址" },
            newTab: { type: "boolean", description: "是否使用新标签页，默认 true" },
            useExistingSession: { type: "boolean", description: "仅当用户明确要求使用其现有浏览器登录状态时设为 true；默认使用独立自动化窗口" },
            waitMs: { type: "integer", minimum: 1000, description: "页面发生变化前的等待时间" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_browser_search",
        description: "真实启动 Microsoft Edge/Google Chrome 并执行网页或图片搜索，返回搜索结果页截图。优先调用 computer_inspect_app 读取网页结果并按名称点击；读取不到时再根据截图坐标操作。",
        parameters: {
          type: "object",
          required: ["query"],
          properties: {
            browser: { type: "string", description: "Microsoft Edge、微软浏览器、Google Chrome、谷歌浏览器；默认 Microsoft Edge" },
            query: { type: "string", description: "搜索关键词" },
            searchType: { type: "string", enum: ["web", "images"], description: "网页搜索或图片搜索" },
            newTab: { type: "boolean", description: "是否使用新标签页，默认 true" },
            useExistingSession: { type: "boolean", description: "仅当用户明确要求使用其现有浏览器登录状态时设为 true；默认使用独立自动化窗口" },
            waitMs: { type: "integer", minimum: 1000, description: "搜索结果页发生变化前的等待时间" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_inspect_app",
        description: "读取桌面应用窗口中的可访问控件。对于独立自动化浏览器，会直接读取网页中的按钮、链接、输入框和下拉框（含选项）；不会读取密码输入框内容。",
        parameters: {
          type: "object",
          required: ["app"],
          properties: {
            app: { type: "string" },
            windowHandle: { type: "integer" },
            selector: {
              type: "object",
              properties: {
                name: { type: "string" }, automationId: { type: "string" }, controlType: { type: "string" },
                className: { type: "string" }, contains: { type: "boolean" }, index: { type: "integer", minimum: 0 }
              }
            },
            maxResults: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_capture_app",
        description: "截取任意可见 Windows 应用窗口，并把画面作为多模态上下文返回。自绘界面或控件读取不完整时先调用此工具，再根据截图使用相对坐标操作。",
        parameters: {
          type: "object",
          required: ["app"],
          properties: {
            app: { type: "string", description: "应用名称、窗口标题、进程名或可执行文件路径" },
            windowHandle: { type: "integer" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_control_app",
        description: "操作任意 Windows 桌面应用：聚焦窗口、按名称点击控件或截图坐标、输入或读取文字、发送受限快捷键。浏览器下拉框使用 set_text，并把 text 设为目标选项。发送、提交、发布、保存、删除、支付、安装、关闭以及 Enter 等最终动作会要求用户确认。",
        parameters: {
          type: "object",
          required: ["app", "action"],
          properties: {
            app: { type: "string" },
            action: { type: "string", enum: ["focus", "click", "click_position", "set_text", "read_text", "hotkey"] },
            windowHandle: { type: "integer" },
            selector: {
              type: "object",
              properties: {
                name: { type: "string" }, automationId: { type: "string" }, controlType: { type: "string" },
                className: { type: "string" }, contains: { type: "boolean" }, index: { type: "integer", minimum: 0 }
              }
            },
            text: { type: "string" },
            xRatio: { type: "number", minimum: 0, maximum: 1, description: "相对应用窗口左侧的横向位置，0 到 1；仅用于截图坐标点击或坐标输入" },
            yRatio: { type: "number", minimum: 0, maximum: 1, description: "相对应用窗口顶部的纵向位置，0 到 1；仅用于截图坐标点击或坐标输入" },
            keys: { type: "string", description: "受支持快捷键，例如 CTRL+F、CTRL+K、TAB、ESC、ENTER" },
            commit: { type: "boolean", description: "该动作是否会最终提交、保存、删除、发送或产生其他外部影响" },
            purpose: { type: "string", description: "本次界面动作的明确目的；坐标点击时必填，涉及外部影响时必须把 commit 设为 true" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_prepare_message",
        description: "在飞书、微信或其他聊天应用中查找联系人并把消息填入输入框，但绝不发送。返回一次性草稿编号；随后必须使用 computer_send_message 并由用户确认。",
        parameters: {
          type: "object",
          required: ["app", "contact", "message"],
          properties: {
            app: { type: "string", description: "例如飞书或微信" },
            contact: { type: "string", description: "接收人或群聊名称" },
            message: { type: "string", description: "准备发送的完整消息" },
            waitMs: { type: "integer", minimum: 1000 }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_send_message",
        description: "发送 computer_prepare_message 已准备的消息。每次发送前客户端都会展示应用、接收人和消息内容，并要求用户确认。",
        parameters: { type: "object", required: ["draftId"], properties: { draftId: { type: "string" } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_search",
        description: "在任意可访问目录中递归搜索文件名，也可搜索文本文件内容。",
        parameters: { type: "object", required: ["path", "query"], properties: { path: { type: "string" }, query: { type: "string" }, includeContent: { type: "boolean" }, maxResults: { type: "integer", minimum: 1 } } }
      }
    },
    {
      type: "function",
      function: {
        name: "computer_run",
        description: "在当前 Windows 账号权限下运行 PowerShell 或 CMD 命令。每次执行前都需要用户在客户端确认。",
        parameters: { type: "object", required: ["command"], properties: { command: { type: "string" }, cwd: { type: "string" }, shell: { type: "string", enum: ["powershell", "cmd"] } } }
      }
    },
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
  return text;
}

function buildDesktopCaptureVisionMessage(toolCall, toolResult) {
  const toolName = String(toolCall?.function?.name || toolCall?.name || "");
  if (!["computer_capture_app", "computer_control_app", "computer_browser_open", "computer_browser_search"].includes(toolName)) return null;
  const capturePath = String(toolResult?.capture?.path || "").trim();
  if (!capturePath || !fs.existsSync(capturePath)) return null;
  const image = getImageAttachmentData([capturePath])[0];
  if (!image?.url) return null;
  const windowTitle = String(toolResult?.window?.title || toolResult?.app || "当前应用窗口");
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `这是刚截取的“${windowTitle}”窗口画面。请读取画面并继续当前任务。需要坐标操作时，以窗口左上角为 (0,0)、右下角为 (1,1)，调用 computer_control_app 的 click_position 或坐标 set_text。涉及发送、提交、发布、删除、支付、安装或其他外部影响时必须设置 commit=true，不得绕过客户端确认。`
      },
      { type: "image_url", image_url: { url: image.url } }
    ]
  };
}

async function buildBrowserContinuationMessage(payload, userId, signal) {
  if (payload?.browserAutomationTask !== true) return null;
  const conversationId = payload?.conversationId || "default";
  const taskId = String(payload?.browserAutomationTaskId || "legacy-browser-task").trim() || "legacy-browser-task";
  let browserSession = getActiveBrowserSession(userId, conversationId, taskId);
  if (!browserSession?.windowHandle || !browserSession?.browser) return null;

  const capturePath = createDesktopCapturePath(userId, browserSession.browser);
  try {
    const captureResult = await runWindowsUiAutomation({
      action: "capture",
      app: browserSession.browser,
      windowHandle: Number(browserSession.windowHandle),
      path: capturePath
    }, signal);
    browserSession = rememberBrowserSession(userId, conversationId, taskId, {
      windowHandle: Number(captureResult.window?.handle) || Number(browserSession.windowHandle),
      title: String(captureResult.window?.title || browserSession.title || ""),
      capturePath: String(captureResult.capture?.path || capturePath),
      lastAction: "continuation-snapshot",
      status: "active"
    });
  } catch (error) {
    browserSession = rememberBrowserSession(userId, conversationId, taskId, {
      lastSnapshotError: String(error?.message || "当前窗口暂时不可截图").slice(0, 300)
    });
  }

  const contextText = [
    "这是同一对话中尚未完成的浏览器任务，请从当前页面继续，不要重新从头打开或重复已经完成的步骤。",
    browserSession.originalTask ? `原始任务：${browserSession.originalTask}` : "",
    `当前浏览器：${browserSession.browser}`,
    `当前窗口句柄：${Number(browserSession.windowHandle)}`,
    browserSession.title ? `当前页面标题：${browserSession.title}` : "",
    browserSession.url ? `最近目标地址：${browserSession.url}` : "",
    browserSession.lastAction ? `上一步：${browserSession.lastAction}` : "",
    `本轮用户要求：${String(payload?.message || "继续")}`,
    "优先基于当前截图定位下一步；调用 computer_inspect_app、computer_control_app 或 computer_capture_app 时继续使用上述窗口句柄。只有确认窗口已经失效时才重新打开浏览器。"
  ].filter(Boolean).join("\n");
  const image = browserSession.capturePath && fs.existsSync(browserSession.capturePath)
    ? getImageAttachmentData([browserSession.capturePath])[0]
    : null;
  return {
    role: "user",
    content: image?.url
      ? [{ type: "text", text: contextText }, { type: "image_url", image_url: { url: image.url } }]
      : contextText
  };
}

function parseToolArguments(rawArguments) {
  try {
    return typeof rawArguments === "string" ? JSON.parse(rawArguments || "{}") : (rawArguments || {});
  } catch {
    throw new Error("模型返回的工具参数不是有效 JSON");
  }
}

function runComputerCommand(userId, command, options = {}, signal) {
  const { rootPath, targetPath } = resolveComputerPath(userId, options.cwd || "");
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) throw new Error("缺少要运行的命令");
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) throw new Error(`命令目录不存在：${targetPath}`);
  if (signal?.aborted) return Promise.reject(createGenerationStoppedError());
  const selectedShell = String(options.shell || "powershell").toLowerCase() === "cmd" ? "cmd" : "powershell";
  const executable = selectedShell === "cmd" ? "cmd.exe" : "powershell.exe";
  const commandArguments = selectedShell === "cmd"
    ? ["/d", "/s", "/c", normalizedCommand]
    : ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", normalizedCommand];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArguments, { cwd: targetPath, windowsHide: true, env: { ...process.env, CI: "1" } });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (type, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      if (type === "resolve") resolve(value);
      else reject(value);
    };
    const handleAbort = () => {
      if (child.exitCode === null) child.kill();
      finish("reject", createGenerationStoppedError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish("reject", error));
    child.on("close", (code, signal) => {
      finish("resolve", { command: normalizedCommand, cwd: targetPath || rootPath, shell: selectedShell, code: code ?? -1, signal: signal || "", stdout, stderr });
    });
  });
}

function runWorkspaceCommand(userId, command, signal) {
  return runComputerCommand(userId, command, {}, signal);
}

async function executeWorkspaceTool(userId, toolCall, signal, operationContext = {}) {
  if (signal?.aborted) throw createGenerationStoppedError();
  const name = String(toolCall?.function?.name || toolCall?.name || "");
  const args = parseToolArguments(toolCall?.function?.arguments || toolCall?.arguments);
  const context = { ...operationContext, userId, signal };
  const browserAutomationTaskId = browserTaskIdFromContext(operationContext);
  const operate = (operation, handler) => runComputerOperation(context, operation, handler);

  if (name === "computer_list") {
    const { targetPath } = resolveComputerPath(userId, args.path || "");
    return operate({ action: name, title: "查看目录", target: targetPath }, () => ({
      path: targetPath,
      entries: listComputerDirectory(targetPath, 0, Math.max(0, Number(args.depth) || 0))
    }));
  }
  if (name === "computer_read") {
    const { targetPath } = resolveComputerPath(userId, args.path);
    return operate({ action: name, title: "读取文件", target: targetPath }, () => {
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) throw new Error(`文件不存在：${targetPath}`);
      const encoding = args.encoding === "base64" ? "base64" : "utf8";
      return { path: targetPath, encoding, content: fs.readFileSync(targetPath).toString(encoding) };
    });
  }
  if (name === "computer_write") {
    const { targetPath } = resolveComputerPath(userId, args.path);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`文件已存在：${targetPath}。如需覆盖，请将 overwrite 设为 true。`);
    const content = String(args.content || "");
    return operate({
      action: name,
      title: exists ? "确认覆盖文件" : "新建文件",
      description: exists ? "继续执行会覆盖已有文件内容，此操作无法自动撤销。" : "将在指定位置创建新文件。",
      target: targetPath,
      requiresConfirmation: exists
    }, () => {
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, content, "utf8");
      return { path: targetPath, bytes: Buffer.byteLength(content, "utf8") };
    });
  }
  if (name === "computer_write_document") {
    const { targetPath } = resolveComputerPath(userId, args.path);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`文件已存在：${targetPath}。如需覆盖，请将 overwrite 设为 true。`);
    const content = String(args.content || "").trim();
    if (!content) throw new Error("缺少要写入文档的真实内容");
    const format = normalizeDocumentFormat(args.format || path.extname(targetPath));
    return operate({
      action: name,
      title: exists ? "确认覆盖文档" : "生成文档",
      description: exists ? "继续执行会覆盖已有文档，此操作无法自动撤销。" : "将在指定位置生成文档。",
      target: targetPath,
      requiresConfirmation: exists
    }, async () => {
      ensureDir(path.dirname(targetPath));
      await writeDocumentFile(targetPath, {
        documentTitle: String(args.title || path.basename(targetPath, path.extname(targetPath))),
        resultTitle: String(args.title || path.basename(targetPath, path.extname(targetPath))),
        resultText: content,
        resultBody: content
      }, format);
      return { path: targetPath, bytes: fs.statSync(targetPath).size, format };
    });
  }
  if (name === "computer_copy") {
    const sourcePath = resolveComputerPath(userId, args.sourcePath).targetPath;
    const targetPath = resolveComputerPath(userId, args.targetPath).targetPath;
    if (!fs.existsSync(sourcePath)) throw new Error(`源路径不存在：${sourcePath}`);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`目标已存在：${targetPath}。如需替换，请将 overwrite 设为 true。`);
    return operate({
      action: name,
      title: exists ? "确认复制并替换" : "复制文件",
      description: exists ? "继续执行会替换已有目标，此操作无法自动撤销。" : "将复制到指定位置。",
      target: targetPath,
      requiresConfirmation: exists
    }, () => {
      ensureDir(path.dirname(targetPath));
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: exists, errorOnExist: !exists });
      return { sourcePath, path: targetPath };
    });
  }
  if (name === "computer_move") {
    const sourcePath = resolveComputerPath(userId, args.sourcePath).targetPath;
    const targetPath = resolveComputerPath(userId, args.targetPath).targetPath;
    if (!fs.existsSync(sourcePath)) throw new Error(`源路径不存在：${sourcePath}`);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`目标已存在：${targetPath}。如需替换，请将 overwrite 设为 true。`);
    return operate({
      action: name,
      title: exists ? "确认移动并替换" : "移动文件",
      description: exists ? "继续执行会替换已有目标，此操作无法自动撤销。" : "将把源文件或目录移动到指定位置。",
      target: targetPath,
      requiresConfirmation: exists
    }, () => {
      ensureDir(path.dirname(targetPath));
      if (exists) fs.rmSync(targetPath, { recursive: true, force: true });
      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (error) {
        if (error?.code !== "EXDEV") throw error;
        fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
        fs.rmSync(sourcePath, { recursive: true, force: true });
      }
      return { sourcePath, path: targetPath };
    });
  }
  if (name === "computer_delete") {
    const { targetPath } = resolveComputerPath(userId, args.path);
    if (!fs.existsSync(targetPath)) throw new Error(`路径不存在：${targetPath}`);
    return operate({
      action: name,
      title: "确认删除",
      description: "删除后内容无法从应用内恢复。请核对目标路径。",
      target: targetPath,
      requiresConfirmation: true
    }, () => {
      fs.rmSync(targetPath, { recursive: args.recursive === true, force: false });
      return { path: targetPath, deleted: true };
    });
  }
  if (name === "computer_open") {
    const target = String(args.target || "").trim();
    if (!target) throw new Error("缺少要打开的目标");
    return operate({ action: name, title: "打开目标", target }, async () => {
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        return { target, opened: true, type: "url" };
      }
      const targetPath = resolveComputerPath(userId, target).targetPath;
      if (!fs.existsSync(targetPath)) throw new Error(`路径不存在：${targetPath}`);
      const errorMessage = await shell.openPath(targetPath);
      if (errorMessage) throw new Error(errorMessage);
      return { path: targetPath, opened: true };
    });
  }
  if (name === "computer_list_apps") {
    const query = String(args.query || "").trim().slice(0, 200);
    return operate({ action: name, title: "查看应用", target: query || "当前桌面" }, async () => {
      const result = await runWindowsUiAutomation({ action: "list_apps", query }, signal);
      return { query, windows: result.windows || [], installedApps: result.installedApps || [] };
    });
  }
  if (name === "computer_launch_app") {
    const appName = normalizeDesktopAppName(args.app);
    return operate({ action: name, title: "打开应用", target: appName }, async () => {
      const result = await runWindowsUiAutomation({
        action: "launch",
        app: appName,
        waitMs: Math.max(1000, Number(args.waitMs) || 15000)
      }, signal);
      return { app: appName, ...(result.result || {}), opened: true };
    });
  }
  if (name === "computer_browser_open" || name === "computer_browser_search") {
    const appName = normalizeBrowserAppName(args.browser);
    const browserSession = getActiveBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId);
    const sameBrowserSession = browserSession?.browser === appName;
    const reusableWindowHandle = sameBrowserSession ? Number(browserSession.windowHandle) || 0 : 0;
    const useExistingSession = args.useExistingSession === true;
    const remoteDebugPort = useExistingSession ? 0 : ((sameBrowserSession && Number(browserSession?.debugPort)) || browserDebugPort(userId, appName));
    const targetUrl = name === "computer_browser_search"
      ? browserSearchUrl(appName, args.query, args.searchType)
      : normalizeBrowserUrl(args.url);
    const capturePath = createDesktopCapturePath(userId, appName);
    const operationTitle = name === "computer_browser_search" ? "浏览器搜索" : "打开浏览器页面";
    return operate({ action: name, title: operationTitle, target: targetUrl }, async () => {
      let cdpTarget = null;
      let domControlError = "";
      let navigation = null;
      if (reusableWindowHandle && remoteDebugPort > 0) {
        try {
          cdpTarget = await waitForBrowserCdpTarget(remoteDebugPort, browserSession?.url, browserSession?.cdpTargetId, signal, 5000);
          await sendBrowserCdpCommand(cdpTarget, "Page.navigate", { url: targetUrl }, signal);
          const pageState = await waitForBrowserPageReady(cdpTarget, targetUrl, signal, Math.max(1000, Number(args.waitMs) || 15000));
          await sendBrowserCdpCommand(cdpTarget, "Page.bringToFront", {}, signal).catch(() => {});
          const capture = await captureBrowserPage(cdpTarget, capturePath, signal);
          navigation = {
            navigated: true,
            url: String(pageState.url || targetUrl),
            title: String(pageState.title || cdpTarget.title || ""),
            window: { handle: reusableWindowHandle, title: String(pageState.title || browserSession?.title || "") },
            capture
          };
        } catch (error) {
          domControlError = String(error?.message || "浏览器网页控件通道未就绪").slice(0, 240);
        }
      }
      if (!navigation) {
        const result = await runWindowsUiAutomation({
          action: "browser_navigate",
          app: appName,
          url: targetUrl,
          windowHandle: reusableWindowHandle,
          newTab: args.newTab !== false,
          waitMs: Math.max(1000, Number(args.waitMs) || 15000),
          profilePath: useExistingSession ? "" : browserAutomationProfilePath(userId, appName),
          remoteDebugPort,
          path: capturePath
        }, signal);
        navigation = result.result || {};
        if (remoteDebugPort > 0) {
          try {
            cdpTarget = await waitForBrowserCdpTarget(remoteDebugPort, targetUrl, sameBrowserSession ? browserSession?.cdpTargetId : "", signal, 8000);
            const pageState = await waitForBrowserPageReady(cdpTarget, targetUrl, signal, Math.max(1000, Number(args.waitMs) || 15000));
            await sendBrowserCdpCommand(cdpTarget, "Page.bringToFront", {}, signal).catch(() => {});
            navigation.capture = await captureBrowserPage(cdpTarget, capturePath, signal);
            navigation.title = String(pageState.title || navigation.title || cdpTarget.title || "");
            navigation.url = String(pageState.url || targetUrl);
            domControlError = "";
          } catch (error) {
            domControlError = String(error?.message || "浏览器网页控件通道未就绪").slice(0, 240);
          }
        }
      }
      const toolResult = {
        browser: appName,
        url: targetUrl,
        title: navigation.title || navigation.window?.title || "",
        window: navigation.window || null,
        capture: navigation.capture || { path: capturePath },
        navigated: navigation.navigated === true,
        domControlAvailable: Boolean(cdpTarget),
        ...(domControlError ? { domControlError } : {}),
        coordinateSystem: "窗口左上角为 (0,0)，右下角为 (1,1)"
      };
      rememberBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId, {
        browser: appName,
        windowHandle: Number(toolResult.window?.handle) || reusableWindowHandle,
        profilePath: useExistingSession ? "" : browserAutomationProfilePath(userId, appName),
        useExistingSession,
        debugPort: remoteDebugPort,
        cdpTargetId: String(cdpTarget?.id || (sameBrowserSession ? browserSession?.cdpTargetId : "") || ""),
        url: targetUrl,
        title: toolResult.title,
        capturePath: String(toolResult.capture?.path || ""),
        originalTask: sameBrowserSession ? (browserSession?.originalTask || String(operationContext.task || "")) : String(operationContext.task || ""),
        lastAction: name,
        status: "active"
      });
      return toolResult;
    });
  }
  if (name === "computer_inspect_app") {
    const appName = normalizeDesktopAppName(args.app);
    const browserSession = isBrowserAppName(appName) ? getActiveBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId) : null;
    const windowHandle = Number(args.windowHandle) || Number(browserSession?.windowHandle) || 0;
    return operate({ action: name, title: "读取应用界面", target: appName }, async () => {
      if (browserSession?.debugPort) {
        try {
          const snapshot = await inspectBrowserDom(browserSession, Math.min(500, Math.max(1, Number(args.maxResults) || 120)), signal);
          const selector = args.selector || {};
          const hasSelector = Boolean(selector.name || selector.automationId || selector.controlType || selector.className);
          const normalize = (value) => String(value || "").trim().toLocaleLowerCase();
          const controls = hasSelector ? (snapshot.controls || []).filter((control) => {
            const nameMatches = !selector.name || (selector.contains === true
              ? normalize(control.name).includes(normalize(selector.name))
              : normalize(control.name) === normalize(selector.name));
            return nameMatches
              && (!selector.automationId || normalize(control.automationId) === normalize(selector.automationId))
              && (!selector.controlType || normalize(control.controlType) === normalize(selector.controlType))
              && (!selector.className || normalize(control.className).includes(normalize(selector.className)));
          }) : (snapshot.controls || []);
          rememberBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId, {
            cdpTargetId: String(snapshot.target?.id || browserSession.cdpTargetId || ""),
            url: String(snapshot.url || browserSession.url || ""),
            title: String(snapshot.title || browserSession.title || ""),
            lastAction: `${name}:browser-dom`,
            status: "active"
          });
          return {
            app: appName,
            source: "browser-dom",
            window: { handle: windowHandle, title: String(snapshot.title || browserSession.title || "") },
            url: String(snapshot.url || browserSession.url || ""),
            controls
          };
        } catch {
          // Existing-session browsers and legacy windows may not expose a page channel; use Windows UIA below.
        }
      }
      const result = await runWindowsUiAutomation({
        action: "inspect",
        app: appName,
        windowHandle,
        selector: args.selector || null,
        maxResults: Math.min(500, Math.max(1, Number(args.maxResults) || 120))
      }, signal);
      const toolResult = { app: appName, window: result.window || null, controls: result.controls || [] };
      if (browserSession) rememberBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId, {
        windowHandle: Number(toolResult.window?.handle) || windowHandle,
        title: String(toolResult.window?.title || browserSession.title || ""),
        lastAction: name,
        status: "active"
      });
      return toolResult;
    });
  }
  if (name === "computer_capture_app") {
    const appName = normalizeDesktopAppName(args.app);
    const browserSession = isBrowserAppName(appName) ? getActiveBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId) : null;
    const windowHandle = Number(args.windowHandle) || Number(browserSession?.windowHandle) || 0;
    const capturePath = createDesktopCapturePath(userId, appName);
    return operate({ action: name, title: "查看应用画面", target: appName }, async () => {
      let result = null;
      if (browserSession?.debugPort) {
        try {
          const target = await waitForBrowserCdpTarget(browserSession.debugPort, browserSession.url, browserSession.cdpTargetId, signal, 5000);
          const capture = await captureBrowserPage(target, capturePath, signal);
          result = { capture, window: { handle: windowHandle, title: String(browserSession.title || target.title || "") } };
        } catch {
          // Fall back for legacy or existing-session browser windows.
        }
      }
      if (!result) {
        result = await runWindowsUiAutomation({
          action: "capture",
          app: appName,
          windowHandle,
          path: capturePath
        }, signal);
      }
      const toolResult = {
        app: appName,
        window: result.window || null,
        capture: result.capture || { path: capturePath },
        coordinateSystem: result.capture?.source === "browser-cdp"
          ? "网页可视区域左上角为 (0,0)，右下角为 (1,1)"
          : "窗口左上角为 (0,0)，右下角为 (1,1)"
      };
      if (browserSession) rememberBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId, {
        windowHandle: Number(toolResult.window?.handle) || windowHandle,
        title: String(toolResult.window?.title || browserSession.title || ""),
        capturePath: String(toolResult.capture?.path || capturePath),
        lastAction: name,
        status: "active"
      });
      return toolResult;
    });
  }
  if (name === "computer_control_app") {
    const appName = normalizeDesktopAppName(args.app);
    const browserSession = isBrowserAppName(appName) ? getActiveBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId) : null;
    const windowHandle = Number(args.windowHandle) || Number(browserSession?.windowHandle) || 0;
    const action = String(args.action || "").trim().toLowerCase();
    const supportedActions = new Set(["focus", "click", "click_position", "set_text", "read_text", "hotkey"]);
    if (!supportedActions.has(action)) throw new Error(`不支持的应用操作：${action}`);
    if (action === "set_text" && args.text === undefined) throw new Error("缺少要输入的文字");
    if (action === "hotkey" && !String(args.keys || "").trim()) throw new Error("缺少快捷键");
    const usesPosition = action === "click_position" || (action === "set_text" && (args.xRatio !== undefined || args.yRatio !== undefined));
    const xRatio = Number(args.xRatio);
    const yRatio = Number(args.yRatio);
    if (usesPosition && (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1)) {
      throw new Error("截图坐标必须同时提供 0 到 1 之间的 xRatio 和 yRatio");
    }
    if (action === "click_position" && !String(args.purpose || "").trim()) throw new Error("坐标点击必须说明操作目的");
    const selectorLabel = String(args.selector?.name || args.selector?.automationId || args.selector?.controlType || "").trim();
    const positionLabel = usesPosition ? `坐标 (${xRatio.toFixed(3)}, ${yRatio.toFixed(3)})` : "";
    const target = [appName, selectorLabel || positionLabel].filter(Boolean).join(" → ");
    const requiresConfirmation = desktopUiActionNeedsConfirmation(action, args);
    const actionSummary = action === "hotkey"
      ? `快捷键：${String(args.keys || "")}`
      : (["click", "click_position"].includes(action)
        ? `点击：${selectorLabel || positionLabel || "未命名控件"}${args.purpose ? `；目的：${String(args.purpose)}` : ""}`
        : "");
    return operate({
      action: name,
      title: requiresConfirmation ? "确认操作应用" : "操作应用",
      description: requiresConfirmation
        ? String(args.purpose || "该操作可能提交内容或改变应用状态，请核对后继续。")
        : String(args.purpose || "在当前 Windows 账号权限下操作应用界面。"),
      target,
      auditTarget: target,
      commandSummary: actionSummary,
      detailLabel: "操作",
      requiresConfirmation
    }, async () => {
      let browserDomOperation = null;
      let result = null;
      const hasDomSelector = Boolean(args.selector && (args.selector.name || args.selector.automationId || args.selector.controlType || args.selector.className));
      if (browserSession?.debugPort && hasDomSelector && ["click", "set_text", "read_text"].includes(action)) {
        try {
          browserDomOperation = await controlBrowserDom(browserSession, action, args.selector, args.text, signal);
          result = { result: browserDomOperation, window: null, source: "browser-dom" };
        } catch (browserDomError) {
          try {
            result = await runWindowsUiAutomation({
              action, app: appName, windowHandle, selector: args.selector || null,
              text: action === "set_text" ? String(args.text || "") : ""
            }, signal);
          } catch {
            throw browserDomError;
          }
        }
      } else {
        result = await runWindowsUiAutomation({
          action,
          app: appName,
          windowHandle,
          selector: args.selector || null,
          text: action === "set_text" ? String(args.text || "") : "",
          keys: action === "hotkey" ? String(args.keys || "") : "",
          xRatio: usesPosition ? xRatio : null,
          yRatio: usesPosition ? yRatio : null
        }, signal);
      }
      const toolResult = {
        app: appName,
        action,
        source: browserDomOperation ? "browser-dom" : "windows-uia",
        window: result.window || null,
        ...(result.result ? { result: result.result } : result)
      };
      if (browserSession) {
        if (["click", "click_position", "set_text", "hotkey"].includes(action)) {
          const latestHandle = Number(toolResult.window?.handle) || windowHandle;
          if (latestHandle) {
            const capturePath = createDesktopCapturePath(userId, appName);
            try {
              if (browserDomOperation?.target) {
                toolResult.capture = await captureBrowserPage(browserDomOperation.target, capturePath, signal);
                toolResult.window = { handle: latestHandle, title: String(browserDomOperation.title || browserSession.title || "") };
                toolResult.coordinateSystem = "网页可视区域左上角为 (0,0)，右下角为 (1,1)";
              } else {
                await new Promise((resolve) => setTimeout(resolve, 650));
                const captureResult = await runWindowsUiAutomation({ action: "capture", app: appName, windowHandle: latestHandle, path: capturePath }, signal);
                toolResult.window = captureResult.window || toolResult.window;
                toolResult.capture = captureResult.capture || { path: capturePath };
                toolResult.coordinateSystem = "窗口左上角为 (0,0)，右下角为 (1,1)";
              }
            } catch {
              // The action may intentionally close the current tab or window.
            }
          }
        }
        rememberBrowserSession(userId, operationContext.conversationId, browserAutomationTaskId, {
          windowHandle: Number(toolResult.window?.handle) || windowHandle,
          cdpTargetId: String(browserDomOperation?.target?.id || browserSession.cdpTargetId || ""),
          url: String(browserDomOperation?.url || browserSession.url || ""),
          title: String(browserDomOperation?.title || toolResult.window?.title || browserSession.title || ""),
          capturePath: String(toolResult.capture?.path || browserSession.capturePath || ""),
          lastAction: `${name}:${action}`,
          status: "active"
        });
      }
      return toolResult;
    });
  }
  if (name === "computer_prepare_message") {
    cleanDesktopMessageDrafts();
    const appName = normalizeDesktopAppName(args.app);
    const contact = String(args.contact || "").trim().slice(0, 300);
    const message = String(args.message || "");
    if (!contact) throw new Error("缺少消息接收人");
    if (!message.trim()) throw new Error("缺少消息内容");
    return operate({ action: name, title: "准备消息", target: `${appName} → ${contact}` }, async () => {
      const automation = await runWindowsUiAutomation({
        action: "prepare_message",
        app: appName,
        contact,
        message,
        waitMs: Math.max(1000, Number(args.waitMs) || 15000)
      }, signal);
      const result = automation.result || {};
      const windowHandle = Number(result.window?.handle) || 0;
      if (!result.prepared || !windowHandle) throw new Error("消息未能安全填入目标应用");
      const draftId = crypto.randomUUID();
      pendingDesktopMessageDrafts.set(draftId, {
        draftId,
        userId: safeWorkspaceSegment(userId || "local-user"),
        conversationId: safeWorkspaceSegment(context.conversationId || "default"),
        app: appName,
        contact,
        message,
        messageHash: crypto.createHash("sha256").update(message, "utf8").digest("hex"),
        windowHandle,
        processId: Number(result.window?.processId) || 0,
        createdAt: Date.now()
      });
      return {
        prepared: true,
        draftId,
        app: appName,
        contact,
        messageLength: message.length,
        window: result.window,
        notice: "消息已填入输入区但尚未发送。调用 computer_send_message 后仍需用户确认。"
      };
    });
  }
  if (name === "computer_send_message") {
    cleanDesktopMessageDrafts();
    const draftId = String(args.draftId || "").trim();
    const draft = pendingDesktopMessageDrafts.get(draftId);
    if (!draft) throw new Error("消息草稿不存在或已过期，请重新准备消息");
    if (draft.userId !== safeWorkspaceSegment(userId || "local-user") || draft.conversationId !== safeWorkspaceSegment(context.conversationId || "default")) {
      throw new Error("消息草稿不属于当前用户或当前会话");
    }
    const target = `${draft.app} → ${draft.contact}`;
    try {
      return await operate({
        action: name,
        title: "确认发送消息",
        description: "这是对外发送操作。请核对应用、接收人和完整消息内容；确认后将立即发送。",
        target,
        auditTarget: target,
        commandSummary: draft.message,
        detailLabel: "消息内容",
        requiresConfirmation: true,
        resultSummary: "message-sent"
      }, async () => {
        const currentHash = crypto.createHash("sha256").update(draft.message, "utf8").digest("hex");
        if (currentHash !== draft.messageHash) throw new Error("消息草稿校验失败，未执行发送");
        const automation = await runWindowsUiAutomation({
          action: "send_message",
          app: draft.app,
          windowHandle: draft.windowHandle
        }, signal);
        return {
          sent: automation.result?.sent === true,
          app: draft.app,
          contact: draft.contact,
          method: automation.result?.method || "application-control"
        };
      });
    } finally {
      pendingDesktopMessageDrafts.delete(draftId);
    }
  }
  if (name === "computer_search") {
    const { targetPath } = resolveComputerPath(userId, args.path);
    return operate({ action: name, title: "搜索文件", target: targetPath }, () => ({
      path: targetPath,
      query: String(args.query || ""),
      results: searchComputerFiles(targetPath, args.query, args)
    }));
  }
  if (name === "computer_run") {
    const cwd = resolveComputerPath(userId, args.cwd || "").targetPath;
    return operate({
      action: name,
      title: "确认运行命令",
      description: "该命令会在当前 Windows 账号权限下运行。请核对命令和运行目录。",
      target: cwd,
      auditTarget: cwd,
      commandSummary: String(args.command || ""),
      requiresConfirmation: true
    }, () => runComputerCommand(userId, args.command, { cwd, shell: args.shell }, signal));
  }

  if (name === "workspace_list") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath || "");
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) throw new Error("本地文件目录不存在");
    return operate({ action: "computer_list", title: "查看目录", target: targetPath }, () => ({ relativePath: args.relativePath || "", entries: listWorkspace(rootPath, targetPath) }));
  }
  if (name === "workspace_read") {
    const { targetPath } = resolveUserWorkspacePath(userId, args.relativePath);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) throw new Error("本地文件不存在");
    return operate({ action: "computer_read", title: "读取文件", target: targetPath }, () => ({ relativePath: args.relativePath, path: targetPath, content: fs.readFileSync(targetPath, "utf8") }));
  }
  if (name === "workspace_write") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`文件已存在：${args.relativePath}。如需覆盖，请将 overwrite 设为 true。`);
    const content = String(args.content || "");
    return operate({ action: "computer_write", title: exists ? "确认覆盖文件" : "新建文件", target: targetPath, requiresConfirmation: exists }, () => {
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, content, "utf8");
      return { relativePath: path.relative(rootPath, targetPath), path: targetPath, bytes: Buffer.byteLength(content, "utf8") };
    });
  }
  if (name === "workspace_write_document") {
    const requestedPath = String(args.relativePath || "");
    if (!/\.docx$/i.test(requestedPath)) throw new Error("Word 文档路径必须以 .docx 结尾");
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, requestedPath);
    const exists = fs.existsSync(targetPath);
    if (exists && args.overwrite !== true) throw new Error(`文件已存在：${requestedPath}。如需覆盖，请将 overwrite 设为 true。`);
    const content = String(args.content || "").trim();
    if (!content) throw new Error("缺少要写入 Word 文档的真实内容");
    return operate({ action: "computer_write_document", title: exists ? "确认覆盖文档" : "生成文档", target: targetPath, requiresConfirmation: exists }, async () => {
      ensureDir(path.dirname(targetPath));
      await writeDocx(targetPath, {
        resultTitle: String(args.title || path.basename(targetPath, path.extname(targetPath))),
        resultText: content,
        resultBody: content
      });
      const stat = fs.statSync(targetPath);
      return { relativePath: path.relative(rootPath, targetPath), path: targetPath, bytes: stat.size };
    });
  }
  if (name === "workspace_run") {
    const { rootPath } = resolveUserWorkspacePath(userId);
    return operate({ action: "computer_run", title: "确认运行命令", target: rootPath, auditTarget: rootPath, commandSummary: String(args.command || ""), requiresConfirmation: true }, () => runWorkspaceCommand(userId, args.command, signal));
  }
  if (name === "workspace_preview") {
    const { rootPath, targetPath } = resolveUserWorkspacePath(userId, args.relativePath || `generated/${Date.now()}-preview.html`);
    if (!targetPath.toLowerCase().endsWith(".html") && !targetPath.toLowerCase().endsWith(".htm")) throw new Error("网页预览文件必须是 HTML");
    const html = String(args.html || "");
    if (!html.trim()) throw new Error("缺少网页内容");
    const exists = fs.existsSync(targetPath);
    return operate({ action: "computer_write", title: exists ? "确认覆盖网页" : "生成网页", target: targetPath, requiresConfirmation: exists }, () => {
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, html, "utf8");
      openHtmlPreview(targetPath);
      return { relativePath: path.relative(rootPath, targetPath), path: targetPath, opened: true };
    });
  }
  throw new Error(`不支持的文件工具：${name}`);
}

function openHtmlPreview(filePath) {
  const preview = new BrowserWindow({ width: 1180, height: 780, minWidth: 860, minHeight: 560, title: "XMAI Studio - 网页预览", icon: appIcon, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
  return imageMimeByExtension.get(extension) || audioMimeByExtension.get(extension) || videoMimeByExtension.get(extension) || ({
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
    title: `XMAI Studio - ${path.basename(filePath)}`,
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

  if (kind === "audio" || kind === "video") {
    return {
      ...base,
      previewType: "media",
      mediaType: kind,
      mimeType: artifactMimeType(absolutePath),
      url: pathToFileURL(absolutePath).toString()
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
    try {
      await copyDownloadFileWithRetry(absolutePath, destination);
    } catch (error) {
      if (!isRetryableFileBusyError(error) || !fs.existsSync(destination)) {
        if (isRetryableFileBusyError(error)) throw new Error("文件正在被其他程序使用，请关闭文件后重试");
        throw error;
      }
      const alternateDestination = nextAvailableDownloadPath(destination);
      try {
        await copyDownloadFileWithRetry(absolutePath, alternateDestination);
      } catch (alternateError) {
        if (isRetryableFileBusyError(alternateError)) throw new Error("生成的文件正在被其他程序使用，请关闭文件预览后重试");
        throw alternateError;
      }
      return { canceled: false, path: alternateDestination, renamedBecauseBusy: true };
    }
  }
  return { canceled: false, path: destination };
}

function isRetryableFileBusyError(error) {
  return ["EBUSY", "EPERM", "EACCES", "ETXTBSY"].includes(String(error?.code || "").toUpperCase());
}

function delayFileRetry(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function copyDownloadFileWithRetry(sourcePath, destinationPath) {
  const retryDelays = [0, 80, 180, 320];
  let lastError;
  for (const retryDelay of retryDelays) {
    if (retryDelay) await delayFileRetry(retryDelay);
    try {
      await fs.promises.copyFile(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!isRetryableFileBusyError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function nextAvailableDownloadPath(destinationPath) {
  const extension = path.extname(destinationPath);
  const basePath = destinationPath.slice(0, destinationPath.length - extension.length);
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${basePath} (${suffix})${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${basePath}-${Date.now()}${extension}`;
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
  const scheduled = (Array.isArray(store.scheduledTasks) ? store.scheduledTasks : defaultScheduledTasks)
    .filter((task) => !(task?.source === "local-store" && legacyPlaceholderAutomationIds.has(task.id)))
    .map(normalizeAutomationTask);
  const taskRuns = Array.isArray(store.taskRuns) ? store.taskRuns : [];

  const normalized = {
    version: 2,
    scheduledTasks: scheduled,
    taskRuns
  };
  if (!fs.existsSync(storePath) || Number(store.version || 0) < 2 || JSON.stringify(store.scheduledTasks || []) !== JSON.stringify(scheduled)) {
    writeTaskStore(userId, normalized);
  }
  return normalized;
}

function writeTaskStore(userId, store) {
  const payload = {
    version: 2,
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

function automationTimeParts(value = "09:00") {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hours: 9, minutes: 0 };
  return {
    hours: Math.max(0, Math.min(23, Number(match[1]))),
    minutes: Math.max(0, Math.min(59, Number(match[2])))
  };
}

function automationDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextAutomationRun(task, after = Date.now()) {
  if (!task?.enabled) return "";
  const afterDate = new Date(after);
  const startDate = automationDateBoundary(task.startDate);
  const endDate = automationDateBoundary(task.endDate, true);
  const minimum = Math.max(afterDate.getTime(), startDate?.getTime() || 0);
  let candidate = null;

  if (task.frequency === "once") {
    candidate = new Date(task.runAt || "");
    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= after) return "";
  } else if (task.frequency === "interval") {
    const intervalMs = Math.max(1, Number(task.intervalHours) || 1) * 60 * 60 * 1000;
    const anchor = Math.max(new Date(task.lastRunAt || task.createdAt || after).getTime() || after, minimum);
    candidate = new Date(anchor + intervalMs);
    const weekdays = new Set((Array.isArray(task.weekdays) ? task.weekdays : [1, 2, 3, 4, 5, 6, 7]).map(Number));
    let matchedWeekday = false;
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay();
      if (candidate.getTime() > after && weekdays.has(weekday)) {
        matchedWeekday = true;
        break;
      }
      candidate = new Date(candidate.getTime() + intervalMs);
    }
    if (!matchedWeekday) candidate = null;
  } else {
    const { hours, minutes } = automationTimeParts(task.time);
    const weekdays = new Set((Array.isArray(task.weekdays) ? task.weekdays : [1]).map(Number));
    for (let offset = 0; offset <= 14; offset += 1) {
      const date = new Date(minimum);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      date.setHours(hours, minutes, 0, 0);
      const weekday = date.getDay() === 0 ? 7 : date.getDay();
      const allowedDay = task.frequency === "daily" || weekdays.has(weekday);
      if (allowedDay && date.getTime() > after && date.getTime() >= minimum) {
        candidate = date;
        break;
      }
    }
  }

  if (!candidate || Number.isNaN(candidate.getTime())) return "";
  if (endDate && candidate.getTime() > endDate.getTime()) return "";
  return candidate.toISOString();
}

function automationScheduleLabel(task) {
  if (task.frequency === "once") return `单次 · ${new Date(task.runAt).toLocaleString("zh-CN", { hour12: false })}`;
  if (task.frequency === "interval") return `每 ${Number(task.intervalHours || 1)} 小时`;
  if (task.frequency === "daily") return `每天 ${task.time || "09:00"}`;
  const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const days = (task.weekdays || [1]).map((day) => weekdayNames[Number(day) - 1]).filter(Boolean).join("、");
  return `${days || "周一"} ${task.time || "09:00"}`;
}

function normalizeAutomationTask(task = {}) {
  const frequency = ["daily", "weekly", "interval", "once"].includes(task.frequency) ? task.frequency : "weekly";
  const normalized = {
    id: String(task.id || createId("automation")),
    name: String(task.name || "未命名自动化").trim().slice(0, 80),
    prompt: String(task.prompt || "").trim().slice(0, 40000),
    workspacePath: String(task.workspacePath || "").trim().slice(0, 1000),
    model: String(task.model || "auto").trim().slice(0, 120),
    skillId: String(task.skillId || "").trim().slice(0, 160),
    skillName: String(task.skillName || "").trim().slice(0, 120),
    skillSystemPrompt: String(task.skillSystemPrompt || "").trim().slice(0, 120000),
    frequency,
    time: `${String(task.time || "09:00").padStart(5, "0")}`.slice(0, 5),
    weekdays: [...new Set((Array.isArray(task.weekdays) ? task.weekdays : (frequency === "interval" ? [1, 2, 3, 4, 5, 6, 7] : [1])).map(Number).filter((value) => value >= 1 && value <= 7))],
    intervalHours: Math.max(1, Number(task.intervalHours ?? task.intervalMinutes) || 1),
    runAt: String(task.runAt || ""),
    startDate: String(task.startDate || "").slice(0, 10),
    endDate: String(task.endDate || "").slice(0, 10),
    enabled: task.enabled !== false,
    status: String(task.status || (task.enabled === false ? "已停用" : "启用中")),
    lastStatus: String(task.lastStatus || ""),
    lastRunAt: String(task.lastRunAt || ""),
    missedAt: String(task.missedAt || ""),
    nextRunAt: String(task.nextRunAt || ""),
    createdAt: String(task.createdAt || nowIso()),
    updatedAt: String(task.updatedAt || nowIso()),
    source: "automation"
  };
  if (!normalized.weekdays.length) normalized.weekdays = [1];
  if (normalized.enabled && !normalized.nextRunAt) normalized.nextRunAt = nextAutomationRun(normalized);
  return normalized;
}

function validateAutomationTaskInput(payload = {}, existing = null) {
  const name = String(payload.name || "").trim();
  const prompt = String(payload.prompt || "").trim();
  if (!name) throw new Error("请输入自动化名称");
  if (!prompt) throw new Error("请输入自动化任务内容");
  const requestedFrequency = String(payload.frequency || existing?.frequency || "weekly");
  if (!["daily", "weekly", "interval", "once"].includes(requestedFrequency)) throw new Error("执行频率无效");
  if (["daily", "weekly"].includes(requestedFrequency) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(payload.time || existing?.time || ""))) throw new Error("请选择有效执行时间");
  if (existing?.status === "运行中") throw new Error("请先暂停正在执行的任务，再编辑");
  if (["weekly", "interval"].includes(requestedFrequency)) {
    const requestedWeekdays = Array.isArray(payload.weekdays) ? payload.weekdays : existing?.weekdays;
    if (!Array.isArray(requestedWeekdays) || !requestedWeekdays.some((value) => Number(value) >= 1 && Number(value) <= 7)) {
      throw new Error("请至少选择一个执行星期");
    }
  }
  const task = normalizeAutomationTask({
    ...existing,
    ...payload,
    id: existing?.id || createId("automation"),
    name,
    prompt,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    lastRunAt: existing?.lastRunAt || "",
    lastStatus: existing?.lastStatus || "",
    missedAt: "",
    nextRunAt: ""
  });
  if (task.frequency === "once") {
    const runAt = new Date(task.runAt);
    if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) throw new Error("单次执行时间必须晚于当前时间");
  }
  if (["weekly", "interval"].includes(task.frequency) && !task.weekdays.length) throw new Error("请至少选择一个执行星期");
  if (task.startDate && task.endDate && task.startDate > task.endDate) throw new Error("生效结束日期不能早于开始日期");
  if (task.workspacePath) {
    const workspaceStat = fs.existsSync(task.workspacePath) ? fs.statSync(task.workspacePath) : null;
    if (!workspaceStat?.isDirectory()) throw new Error("工作目录不存在或不是文件夹");
  }
  task.nextRunAt = nextAutomationRun(task);
  if (task.enabled && !task.nextRunAt) throw new Error("当前时间设置没有可执行的下次时间");
  task.status = task.enabled ? "启用中" : "已停用";
  task.description = `自动化 · ${automationScheduleLabel(task)}${task.skillName ? ` · ${task.skillName}` : ""}`;
  return task;
}

function publishAutomationUpdate(userId, detail = {}) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("desktop:automation-updated", { userId, timestamp: nowIso(), ...detail });
    }
  }
}

function currentAutomationUserId() {
  if (!app.isPackaged && process.env.XIANMA_DEV_AUTH_BYPASS === "1") return "development-user";
  const sessions = readDingtalkSessions();
  const record = sessions.currentUserId && sessions.users?.[safeWorkspaceSegment(sessions.currentUserId)];
  return String(record?.userId || "").trim();
}

function updateAutomationTask(userId, taskId, updater) {
  const store = readTaskStore(userId);
  const index = store.scheduledTasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("自动化任务不存在");
  const nextTask = updater({ ...store.scheduledTasks[index] });
  store.scheduledTasks[index] = normalizeAutomationTask(nextTask);
  writeTaskStore(userId, store);
  return store.scheduledTasks[index];
}

async function executeAutomationTask(userId, taskId, trigger = "schedule", sender = primaryWindow?.webContents) {
  const runKey = `${safeWorkspaceSegment(userId)}:${taskId}`;
  if (activeAutomationRuns.has(runKey)) return activeAutomationRuns.get(runKey).promise;
  const previousTask = readTaskStore(userId).scheduledTasks.find((task) => task.id === taskId);
  const resumingPausedRun = previousTask?.status === "已暂停" || previousTask?.lastStatus === "已暂停";
  const activeRun = {
    controller: new AbortController(),
    pauseRequested: false,
    promise: null
  };
  const promise = (async () => {
    let task = updateAutomationTask(userId, taskId, (current) => ({ ...current, status: "运行中", lastStatus: "运行中", updatedAt: nowIso() }));
    publishAutomationUpdate(userId, { taskId, state: "running" });
    const runId = createId("automation-run");
    const startedAt = nowIso();
    upsertTaskRun(userId, { id: runId, automationId: task.id, title: `${task.name}执行`, status: "运行中", trigger, createdAt: startedAt, updatedAt: startedAt, resultType: "text", artifacts: [] });
    try {
      const systemPrompt = [
        "这是用户预先创建并授权在本机后台执行的自动化任务。请直接完成任务并返回清晰结果。",
        task.workspacePath ? `用户指定工作目录：${task.workspacePath}` : "",
        resumingPausedRun ? "该任务上次执行被用户暂停。继续前先检查工作目录中的已有成果，保留已经完成的内容，并从尚未完成的部分继续，避免重复操作。" : "",
        task.skillSystemPrompt || ""
      ].filter(Boolean).join("\n\n");
      const imageTask = getAiRuntimeConfig().models.some(item => item.value === task.model && item.kind === "image");
      const imageResult = imageTask ? await requestImageGeneration({ userId, prompt: task.prompt, model: task.model, waitForLocalSave: true }, activeRun.controller.signal) : null;
      const result = imageTask ? { content: "图片已生成", files: (imageResult.images || []).filter(item => item.localPath).map(item => ({ path: item.localPath, kind: "image" })) } : await requestChatCompletion({
        userId,
        conversationId: `automation-${task.id}`,
        model: task.model || "auto",
        skillId: task.skillId || "",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.prompt }
        ],
        enableFileTools: true,
        enableWorkspaceTools: true,
        stream: false
      }, null, activeRun.controller.signal, (progress) => publishAutomationUpdate(userId, {
        taskId: task.id,
        state: "running",
        message: String(progress?.message || "正在执行自动化任务").slice(0, 160)
      }), { userId, conversationId: `automation-${task.id}`, sender });
      const artifacts = (Array.isArray(result.files) ? result.files : []).map((file) => ({
        type: file.kind || workspaceFileKind(file.path),
        label: file.name || path.basename(file.path),
        path: file.path
      })).filter((file) => file.path && fs.existsSync(file.path));
      const record = {
        id: runId,
        automationId: task.id,
        skillId: task.skillId || "",
        title: `${task.name}执行`,
        description: String(result.content || "任务已完成").trim().slice(0, 500),
        resultText: String(result.content || "").trim(),
        status: "已完成",
        resultType: artifacts.length ? "document" : "text",
        folderPath: artifacts[0]?.path ? path.dirname(artifacts[0].path) : "",
        primaryPath: artifacts[0]?.path || "",
        artifacts,
        prompt: task.prompt,
        trigger,
        createdAt: startedAt,
        updatedAt: nowIso()
      };
      upsertTaskRun(userId, record);
      task = updateAutomationTask(userId, task.id, (current) => {
        const completed = {
          ...current,
          lastRunAt: nowIso(),
          lastStatus: "已完成",
          status: trigger === "schedule" && current.frequency === "once" ? "已完成" : (current.enabled ? "启用中" : "已暂停"),
          missedAt: "",
          updatedAt: nowIso()
        };
        if (trigger === "schedule" && current.frequency === "once") completed.enabled = false;
        completed.nextRunAt = trigger === "manual" ? current.nextRunAt : nextAutomationRun(completed, Date.now() + 1000);
        if (trigger === "manual" && current.frequency === "once" && Date.parse(current.runAt) <= Date.now()) {
          completed.enabled = false; completed.nextRunAt = ""; completed.status = "已完成";
        }
        return completed;
      });
      publishAutomationUpdate(userId, { taskId: task.id, runId, state: "completed" });
      if (Notification.isSupported()) {
        const notification = new Notification({ title: `${task.name}已完成`, body: record.description || "自动化任务已完成", icon: appIcon });
        notification.on("click", showPrimaryWindow);
        notification.show();
      }
      return { task, record };
    } catch (error) {
      const paused = activeRun.pauseRequested;
      const message = paused
        ? "任务已暂停。已完成的本地文件和操作会保留，点击继续执行可接着处理。"
        : sanitizeVisibleSkillText(error?.message || "自动化执行失败");
      const record = {
        id: runId,
        automationId: task.id,
        skillId: task.skillId || "",
        title: `${task.name}执行`,
        description: message,
        resultText: message,
        status: paused ? "已暂停" : "失败",
        resultType: "text",
        artifacts: [],
        prompt: task.prompt,
        trigger,
        createdAt: startedAt,
        updatedAt: nowIso()
      };
      upsertTaskRun(userId, record);
      task = updateAutomationTask(userId, task.id, (current) => {
        if (paused) {
          return {
            ...current,
            enabled: false,
            lastRunAt: nowIso(),
            lastStatus: "已暂停",
            status: "已暂停",
            nextRunAt: "",
            updatedAt: nowIso()
          };
        }
        const failed = { ...current, lastRunAt: nowIso(), lastStatus: "失败", status: current.enabled ? "启用中" : "已暂停", updatedAt: nowIso() };
        if (trigger === "schedule" && current.frequency === "once") { failed.enabled = false; failed.status = "失败"; }
        failed.nextRunAt = trigger === "manual" ? current.nextRunAt : nextAutomationRun(failed, Date.now() + 1000);
        return failed;
      });
      publishAutomationUpdate(userId, { taskId: task.id, runId, state: paused ? "paused" : "failed", message });
      if (!paused && Notification.isSupported()) new Notification({ title: `${task.name}执行失败`, body: message, icon: appIcon }).show();
      return paused ? { task, record, paused: true } : { task, record, error: message };
    }
  })().finally(() => activeAutomationRuns.delete(runKey));
  activeRun.promise = promise;
  activeAutomationRuns.set(runKey, activeRun);
  return promise;
}

async function pauseAutomationTask(userId, taskId) {
  const runKey = `${safeWorkspaceSegment(userId)}:${taskId}`;
  const activeRun = activeAutomationRuns.get(runKey);
  if (!activeRun) throw new Error("自动化当前没有正在执行的任务");
  if (!activeRun.pauseRequested) {
    activeRun.pauseRequested = true;
    publishAutomationUpdate(userId, { taskId, state: "pausing", message: "正在暂停自动化任务" });
    activeRun.controller.abort();
  }
  const result = await activeRun.promise;
  if (result?.record?.status !== "已暂停") return { paused: false, task: result?.task || null, record: result?.record || null };
  return { paused: true, task: result.task, record: result.record };
}

let automationLastTick = { userId: "", at: 0 };
async function automationSchedulerTick() {
  const userId = currentAutomationUserId();
  if (!userId) { automationLastTick = { userId: "", at: 0 }; return; }
  const now = Date.now();
  const continuous = automationLastTick.userId === userId && now - automationLastTick.at < 45000;
  automationLastTick = { userId, at: now };
  const online = require("electron").net.isOnline();
  const store = readTaskStore(userId);
  for (const task of store.scheduledTasks) {
    const active = activeAutomationRuns.has(`${safeWorkspaceSegment(userId)}:${task.id}`);
    if (task.status === "运行中" && !active) {
      for (const run of store.taskRuns.filter(r => r.automationId === task.id && r.status === "运行中")) {
        upsertTaskRun(userId, { ...run, status: "失败", resultText: "应用退出导致执行中断，请检查已有结果后重试。", updatedAt: nowIso() });
      }
      updateAutomationTask(userId, task.id, current => ({ ...current, status: current.enabled ? "启用中" : "已暂停", lastStatus: "失败" }));
    }
    if (active || !task.enabled || !task.nextRunAt || Date.parse(task.nextRunAt) > now) continue;
    const missed = !online || !continuous || now - Date.parse(task.nextRunAt) > 45000;
    if (missed) {
      const missedAt = task.nextRunAt;
      upsertTaskRun(userId, { id: createId("missed-run"), automationId: task.id, title: task.name, status: "已错过", trigger: "schedule", createdAt: missedAt, updatedAt: nowIso(), resultText: "计划时间内客户端未保持在线，本次未执行，可手动补跑。", artifacts: [] });
      updateAutomationTask(userId, task.id, current => {
        const next = { ...current, status: "已错过", lastStatus: "已错过", missedAt, enabled: current.frequency !== "once", nextRunAt: "" };
        next.nextRunAt = nextAutomationRun(next, now);
        return next;
      });
      publishAutomationUpdate(userId, { taskId: task.id, state: "missed" });
    } else executeAutomationTask(userId, task.id, "schedule").catch(() => {});
  }
}

function startAutomationScheduler() {
  if (automationSchedulerTimer) return;
  automationSchedulerTick().catch(() => {});
  automationSchedulerTimer = setInterval(() => automationSchedulerTick().catch(() => {}), 15 * 1000);
}

function stopAutomationScheduler() {
  if (automationSchedulerTimer) clearInterval(automationSchedulerTimer);
  automationSchedulerTimer = null;
  automationLastTick = { userId: "", at: 0 };
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
      "东哥会议模型",
      "",
      "执行状态",
      "没有收到可确认的会议正文，无法生成可靠的会议蒸馏结论。",
      "",
      "待确认事项",
      "请提供会议转写、录音、笔记、PDF、PPT、截图或群聊记录。"
    ].join("\n");
  }

  if (skillId === "copywriting") {
    return payload?.resultText || payload?.resultBody || "文案润色结果";
  }

  return "未提供可写入文档的真实内容。";
}

async function writeDocx(filePath, payload) {
  const content = defaultDocumentContent(payload);
  const parsed = parseDocumentSource(content);
  const title = preferredDocumentTitle(payload, parsed.metadata);
  const paragraphs = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, color: "172033", size: 38, font: "Microsoft YaHei" })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 }
    }),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${new Date().toLocaleString("zh-CN")}`, italics: true, color: "7A8496", size: 19, font: "Microsoft YaHei" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: parsed.metadataRows.length ? 220 : 300 }
    })
  ];
  if (parsed.metadataRows.length) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: "基本信息", bold: true, color: "2459A9", size: 26, font: "Microsoft YaHei" })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 80, after: 120 },
      keepNext: true
    }));
    paragraphs.push(createDocumentInfoTable(parsed.metadataRows));
    paragraphs.push(new Paragraph({ text: "", spacing: { after: 100 } }));
  }
  for (const block of parsed.blocks) {
    const wordBlock = documentBlockToWord(block);
    if (wordBlock) paragraphs.push(wordBlock);
  }
  if (!parsed.blocks.length) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: "未提供正文内容。", color: "5B6577", font: "Microsoft YaHei" })],
      spacing: { after: 120, line: 360 }
    }));
  }
  const document = new Document({
    creator: appDisplayName,
    title,
    description: "由XMAI Studio生成的结构化文档",
    styles: {
      default: {
        document: {
          run: { font: "Microsoft YaHei", size: 22, color: "293244" },
          paragraph: { spacing: { line: 360, after: 110 } }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, right: 1260, bottom: 1080, left: 1260 }
        }
      },
      children: paragraphs
    }]
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

const documentMetadataLabels = {
  meeting_date: "会议日期",
  date: "日期",
  meeting_type: "会议类型",
  meeting_topic: "会议主题",
  participants: "参会人员",
  attendees: "参会人员",
  location: "会议地点",
  duration: "会议时长",
  distillation_level: "提炼等级",
  status: "文档状态",
  framework: "整理框架",
  department: "所属部门",
  author: "整理人"
};

function cleanYamlValue(value) {
  const source = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (/^(draft|pending)$/i.test(source)) return "草稿";
  if (/^(final|completed|approved)$/i.test(source)) return "正式版";
  return cleanDocumentInline(source);
}

function extractDocumentFrontMatter(content) {
  const source = String(content || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = source.match(/^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) return { body: source, metadata: {}, metadataRows: [] };
  const metadata = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]{0,63})\s*:\s*(.*)$/);
    if (!field) continue;
    metadata[field[1].toLowerCase()] = cleanYamlValue(field[2]);
  }
  const metadataRows = Object.entries(metadata)
    .filter(([key, value]) => documentMetadataLabels[key] && value)
    .map(([key, value]) => [documentMetadataLabels[key], value]);
  return { body: source.slice(match[0].length), metadata, metadataRows };
}

function cleanDocumentInline(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*|__|~~/g, "")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[，。；：,.!?！？])/g, "$1$2")
    .replace(/\\([#*_`>~-])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseDocumentSource(content) {
  const frontMatter = extractDocumentFrontMatter(content);
  const lines = frontMatter.body.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let inCodeBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!trimmed) {
      if (blocks.length && blocks[blocks.length - 1].type !== "space") blocks.push({ type: "space" });
      continue;
    }
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) continue;
    if (!inCodeBlock && trimmed.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
      const rows = [splitTableLine(trimmed).map(cleanDocumentInline)];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(splitTableLine(lines[index]).map(cleanDocumentInline));
        index += 1;
      }
      index -= 1;
      if (rows.some((row) => row.some(Boolean))) blocks.push({ type: "table", rows });
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s*(.+)$/);
    if (heading) {
      const text = cleanDocumentInline(heading[2]).replace(/^\d+[.、]\s*/, "");
      if (text) blocks.push({ type: "heading", level: heading[1].length, text });
      continue;
    }
    const ordered = trimmed.match(/^(\d+)[.)、]\s*(.+)$/);
    if (ordered) {
      const text = cleanDocumentInline(ordered[2]);
      if (text) blocks.push({ type: "ordered", number: Number(ordered[1]), text });
      continue;
    }
    const bullet = trimmed.match(/^[-+*]\s*(.+)$/);
    if (bullet) {
      const text = cleanDocumentInline(bullet[1]);
      if (text) blocks.push({ type: "bullet", text });
      continue;
    }
    const quote = trimmed.match(/^>\s*(.+)$/);
    const text = cleanDocumentInline(quote ? quote[1] : trimmed.replace(/^#+\s*/, ""));
    if (!text) continue;
    const knownHeading = /^(?:会议摘要|执行摘要|核心结论|关键决议|关键决策|待办事项|行动计划|风险问题|风险提示|本周完成|进行中|下周计划|背景|目标|结论|建议)$/.test(text);
    blocks.push({ type: inCodeBlock ? "code" : (quote ? "quote" : (knownHeading ? "heading" : "paragraph")), level: 2, text });
  }
  while (blocks.at(-1)?.type === "space") blocks.pop();
  return { ...frontMatter, blocks };
}

function preferredDocumentTitle(payload, metadata = {}) {
  const metadataTitle = cleanDocumentInline(metadata.title || "");
  if (metadataTitle) return metadataTitle;
  const candidates = [payload?.documentTitle, payload?.resultTitle, payload?.historyTitle]
    .map((item) => cleanDocumentInline(item || ""))
    .filter(Boolean);
  const readable = candidates.find((item) => !/^xianma-[a-z0-9._-]+(?:\s*结果)?$/i.test(item) && !/^[a-z0-9._-]{8,}(?:\s*结果)?$/i.test(item));
  return readable || "技能处理结果";
}

function documentOutputTitle(payload) {
  const source = payload?.resultText || payload?.resultBody || payload?.content || "";
  return preferredDocumentTitle(payload, parseDocumentSource(source).metadata);
}

function documentTextRuns(text) {
  const label = String(text || "").match(/^([^：:]{1,24}[：:])\s*(.*)$/);
  if (!label) return [new TextRun({ text, font: "Microsoft YaHei", color: "293244", size: 22 })];
  return [
    new TextRun({ text: label[1], bold: true, font: "Microsoft YaHei", color: "172033", size: 22 }),
    new TextRun({ text: label[2], font: "Microsoft YaHei", color: "293244", size: 22 })
  ];
}

function createDocumentTable(rows, header = true) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "D8DEE8" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: header && rowIndex === 0,
      children: row.map((cell) => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: header && rowIndex === 0 ? "EAF1FB" : "FFFFFF", color: "auto" },
        margins: { top: 110, bottom: 110, left: 140, right: 140 },
        children: [new Paragraph({
          children: [new TextRun({ text: String(cell || ""), bold: header && rowIndex === 0, font: "Microsoft YaHei", color: "293244", size: 20 })],
          spacing: { after: 0, line: 300 }
        })]
      }))
    }))
  });
}

function createDocumentInfoTable(rows) {
  return createDocumentTable(rows, false);
}

function documentBlockToWord(block) {
  if (!block || block.type === "space") return new Paragraph({ text: "", spacing: { after: 70 } });
  if (block.type === "table") return createDocumentTable(block.rows, true);
  if (block.type === "heading") {
    return new Paragraph({
      children: [new TextRun({ text: block.text, bold: true, color: block.level <= 2 ? "2459A9" : "172033", size: block.level <= 2 ? 29 : 25, font: "Microsoft YaHei" })],
      heading: block.level <= 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      spacing: { before: 260, after: 120 },
      keepNext: true
    });
  }
  if (block.type === "bullet") {
    return new Paragraph({ children: documentTextRuns(block.text), bullet: { level: 0 }, spacing: { after: 90, line: 360 } });
  }
  if (block.type === "ordered") {
    return new Paragraph({
      children: [new TextRun({ text: `${block.number}. `, bold: true, color: "2459A9", font: "Microsoft YaHei" }), ...documentTextRuns(block.text)],
      indent: { left: 360, hanging: 260 },
      spacing: { after: 90, line: 360 }
    });
  }
  if (block.type === "quote" || block.type === "code") {
    return new Paragraph({
      children: [new TextRun({ text: block.text, font: block.type === "code" ? "Consolas" : "Microsoft YaHei", color: "445064", size: 20 })],
      shading: { type: ShadingType.CLEAR, fill: "F3F6FA", color: "auto" },
      indent: { left: 280, right: 180 },
      spacing: { before: 70, after: 120, line: 330 }
    });
  }
  return new Paragraph({
    children: documentTextRuns(block.text),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 115, line: 380 }
  });
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
  return parseDocumentSource(content).blocks.map((block) => {
    if (block.type === "space") return "";
    if (block.type === "bullet") return `• ${block.text}`;
    if (block.type === "ordered") return `${block.number}. ${block.text}`;
    if (block.type === "table") return block.rows.map((row) => row.join("　")).join("\n");
    return block.text || "";
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function composePlainDocument(payload, content) {
  const cleanContent = cleanDocumentMarkdown(content);
  const title = documentOutputTitle({ ...payload, resultText: content, resultBody: content });
  if (!cleanContent) return title;
  if (cleanContent.split("\n")[0].trim() === title) return cleanContent;
  return `${title}\n\n${cleanContent}`;
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
  const source = cleanDocumentMarkdown(content).replace(/\r\n/g, "\n").trim();
  return (source || "未提供正文内容。").split("\n").map((line) => line.trimEnd());
}

function documentSections(content, fallbackTitle) {
  const sections = [];
  let current = { heading: fallbackTitle || "正文", lines: [] };
  for (const block of parseDocumentSource(content).blocks) {
    if (block.type === "space") continue;
    const line = block.type === "bullet" ? `• ${block.text}` : (block.type === "ordered" ? `${block.number}. ${block.text}` : block.text);
    const heading = block.type === "heading" ? block.text : line?.match(/^【(.+)】$/)?.[1];
    if (heading && current.lines.length) {
      sections.push(current);
      current = { heading: heading.replace(/^#+\s*/, ""), lines: [] };
    } else if (heading && !current.lines.length) {
      current.heading = heading.replace(/^#+\s*/, "");
    } else if (block.type === "table") {
      current.lines.push(...block.rows.map((row) => row.join("　")));
    } else if (line) {
      current.lines.push(line);
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
  const title = documentOutputTitle(payload);
  pptx.subject = title;
  pptx.title = title;
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
    lang: "zh-CN"
  };
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

async function writeXlsx(filePath, payload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = appDisplayName;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("文档内容");
  const title = documentOutputTitle(payload);
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

function writePdf(filePath, payload) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 60, right: 60 }, autoFirstPage: true });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    document.pipe(stream);
    document.font(resolvePdfFont());
    document.fontSize(22).fillColor("#1F2937").text(documentOutputTitle(payload), { align: "center" });
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
  zip.file("content.xml", odfContent(format, documentOutputTitle(payload), documentContentLines(payload?.resultText || payload?.resultBody)));
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
  const title = documentOutputTitle(payload);
  const lines = documentContentLines(payload?.resultText || payload?.resultBody);
  fs.writeFileSync(filePath, `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\f0\\fs28 ${rtfEscape(title)}\\par\\fs22 ${lines.map(rtfEscape).join("\\par ")}}`, "utf8");
}

async function writeDocumentFile(filePath, payload, format) {
  const normalizedFormat = normalizeDocumentFormat(format || path.extname(filePath));
  const content = String(payload?.resultText || payload?.resultBody || "").trim();
  const cleanContent = cleanDocumentMarkdown(content);
  const title = documentOutputTitle(payload);
  if (normalizedFormat === "docx") return writeDocx(filePath, payload);
  if (normalizedFormat === "pptx") return writePptx(filePath, payload);
  if (normalizedFormat === "xlsx") return writeXlsx(filePath, payload);
  if (normalizedFormat === "pdf") return writePdf(filePath, payload);
  if (["odt", "ods", "odp"].includes(normalizedFormat)) return writeOdf(filePath, payload, normalizedFormat);
  if (normalizedFormat === "rtf") return writeRtf(filePath, payload);
  if (normalizedFormat === "html" || normalizedFormat === "htm") {
    const html = /<html[\s>]|<!doctype\s+html/i.test(content) ? content : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;max-width:900px;margin:40px auto;line-height:1.8;color:#1f2937}h1{border-bottom:1px solid #ddd;padding-bottom:12px;white-space:pre-wrap}pre{white-space:pre-wrap}</style></head><body><h1>${escapeXml(title)}</h1><pre>${escapeXml(cleanContent)}</pre></body></html>`;
    return fs.writeFileSync(filePath, html, "utf8");
  }
  if (normalizedFormat === "json") return fs.writeFileSync(filePath, JSON.stringify({ title, generatedAt: nowIso(), content: cleanContent, lines: documentContentLines(content) }, null, 2), "utf8");
  if (normalizedFormat === "xml") return fs.writeFileSync(filePath, `<?xml version="1.0" encoding="UTF-8"?><document><title>${escapeXml(title)}</title><generatedAt>${nowIso()}</generatedAt><content>${escapeXml(cleanContent)}</content></document>`, "utf8");
  if (normalizedFormat === "csv") return fs.writeFileSync(filePath, documentContentLines(content).map((line) => splitTableLine(line).map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n"), "utf8");
  if (normalizedFormat === "zip") {
    const zip = new JSZip();
    zip.file("README.txt", `${title}\r\n\r\n${cleanContent}\r\n`);
    zip.file("metadata.json", JSON.stringify({ title, generatedAt: nowIso() }, null, 2));
    return fs.writeFileSync(filePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }
  return fs.writeFileSync(filePath, composePlainDocument(payload, content), "utf8");
}

async function createRequestedArtifact(userId, output, content) {
  const relativePath = String(output?.relativePath || "").trim();
  const format = normalizeDocumentFormat(output?.format || path.extname(relativePath));
  const body = extractArtifactBody(content, format);
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
    composePlainDocument(payload, payload?.resultText || payload?.resultBody || "已完成处理。"),
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
    resultText: payload?.resultText || "",
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

async function downloadTaskResult(payload) {
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
  if (sourceStat.isDirectory()) {
    copyRecursive(sourcePath, targetPath);
    return { path: targetPath, isDirectory: true };
  }

  try {
    await copyDownloadFileWithRetry(sourcePath, targetPath);
    return { path: targetPath, isDirectory: false };
  } catch (error) {
    if (!isRetryableFileBusyError(error) || !fs.existsSync(targetPath)) {
      if (isRetryableFileBusyError(error)) throw new Error("生成的文件正在被其他程序使用，请关闭文件后重试");
      throw error;
    }
    const alternateTargetPath = nextAvailableDownloadPath(targetPath);
    try {
      await copyDownloadFileWithRetry(sourcePath, alternateTargetPath);
    } catch (alternateError) {
      if (isRetryableFileBusyError(alternateError)) throw new Error("生成的文件正在被其他程序使用，请关闭文件后重试");
      throw alternateError;
    }
    return { path: alternateTargetPath, isDirectory: false, renamedBecauseBusy: true };
  }
}

function getAiConfigPath() {
  return String(process.env.XIANMA_AI_CONFIG || "").trim() || defaultAiConfigPath;
}

let previewModelCatalog = null;
let previewModelCatalogExpires = 0;
let previewModelCatalogRequest = null;
const previewHiddenModels = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.2"]);
function filterPreviewModels(models) {
  return models.filter(item => !previewHiddenModels.has(String(item?.value || "").trim().toLowerCase()));
}
function previewModels() {
  const describe = value => ({ value, label: value, kind: /^gpt-image-/.test(value) ? "image" : "chat",
    group: /^gpt-image-/.test(value) ? "图片生成" : /^deepseek/.test(value) ? "DeepSeek" : /^gemini/.test(value) ? "Gemini" : "通用与推理" });
  return filterPreviewModels(previewModelCatalog || [{ ...automaticModelOption, group: "自动选择" }, ...require("./preview-models.json").map(describe)]);
}
async function refreshPreviewModelCatalog() {
  if (!isTestBuild || !desktopTelemetry.sessionToken || previewModelCatalogExpires > Date.now()) return;
  if (previewModelCatalogRequest) return previewModelCatalogRequest;
  previewModelCatalogRequest = (async () => {
    try {
      const response = await fetch(`${buildFlavor.baseUrl}/api/desktop/models`, {
        headers: { authorization: `Bearer ${desktopTelemetry.sessionToken}` }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return;
      const value = await response.json();
      if (Array.isArray(value.models) && value.models.length > 1) {
        const models = filterPreviewModels(value.models);
        previewModelCatalog = value.stale ? filterPreviewModels([...new Map([...previewModels(), ...models].map(item => [item.value, item])).values()]) : models;
        previewModelCatalogExpires = Date.now() + (value.stale ? 15000 : 300000);
      }
    } catch { /* Retain the last known catalog while offline. */ }
  })().finally(() => { previewModelCatalogRequest = null; });
  return previewModelCatalogRequest;
}

function getAiRuntimeConfig() {
  const configPath = getAiConfigPath();
  const fileConfig = readJsonFile(configPath) || {};

  const imageApiBaseUrl = normalizeApiBase(
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
  const telemetryConfig = getDesktopTelemetryConfig();
  const routedTextBaseUrl = desktopTelemetry.sessionToken && telemetryConfig.baseUrl
    ? normalizeApiBase(`${telemetryConfig.baseUrl}/v1`)
    : imageApiBaseUrl;
  const routedTextApiKey = desktopTelemetry.sessionToken || apiKey;
  const configuredFileModel = String(fileConfig.model || "").trim();
  const legacyDefaultModel = ["gpt-5.6-sol", "gpt-5.6"].includes(configuredFileModel) && fileConfig.modelSelectionExplicit !== true;
  const model = String(process.env.XIANMA_AI_MODEL || (legacyDefaultModel ? defaultCompanyAiModel : configuredFileModel) || defaultCompanyAiModel).trim();
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
    apiBaseUrl: isTestBuild ? `${buildFlavor.baseUrl}/v1` : routedTextBaseUrl,
    apiKey: isTestBuild ? desktopTelemetry.sessionToken : routedTextApiKey,
    imageApiBaseUrl: isTestBuild ? `${buildFlavor.baseUrl}/v1` : imageApiBaseUrl,
    imageApiKey: isTestBuild ? desktopTelemetry.sessionToken : apiKey,
    model: model || defaultCompanyAiModel,
    imageModel: imageModel || defaultCompanyImageModel,
    models: isTestBuild ? previewModels() : models,
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
  if (runtimeConfig.models?.some(item => item.kind === "image" && item.value === requested)) return requested;
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
    if (!stat.isFile()) {
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

async function importAttachmentsToWorkspace(userId, filePaths) {
  const imported = [];
  const selected = Array.isArray(filePaths) ? filePaths : [];
  if (!selected.length) return imported;
  const { rootPath, targetPath: attachmentDir } = resolveUserWorkspacePath(userId, "attachments");
  ensureDir(attachmentDir);
  const batchId = new Date().toISOString().replace(/[:.]/g, "-");
  for (let index = 0; index < selected.length; index += 1) {
    const sourcePath = selected[index];
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    const sourceStat = fs.statSync(sourcePath);
    const sourceFingerprint = crypto.createHash("sha256")
      .update(path.resolve(sourcePath).toLowerCase())
      .update(String(sourceStat.size))
      .update(String(sourceStat.mtimeMs))
      .digest("hex");
    const fileName = `${batchId}-${index + 1}-${safeFileName(path.basename(sourcePath), `附件-${index + 1}`)}`;
    const targetPath = path.join(attachmentDir, fileName);
    await fs.promises.copyFile(sourcePath, targetPath);
    imported.push({
      sourcePath,
      sourceFingerprint,
      absolutePath: targetPath,
      relativePath: path.relative(rootPath, targetPath),
      bytes: fs.statSync(targetPath).size
    });
  }
  return imported;
}

function importedAttachmentContext(imported) {
  if (!Array.isArray(imported) || !imported.length) return "";
  return [
    "本轮附件已复制到当前用户本地文件目录。请根据任务需要读取这些真实文件；如包含音频或视频，客户端会在下方提供已经完成的真实转写和视频关键画面：",
    ...imported.map((item) => item.absolutePath)
  ].join("\n");
}

function appendImportedAttachmentContext(messages, imported) {
  if (!imported.length) return messages;
  const cloned = messages.map((message) => ({ ...message }));
  const userIndex = cloned.map((message) => message.role).lastIndexOf("user");
  if (userIndex < 0) return cloned;
  const note = importedAttachmentContext(imported);
  const content = cloned[userIndex].content;
  if (typeof content === "string") {
    cloned[userIndex].content = `${content}\n\n${note}`;
  } else if (Array.isArray(content)) {
    cloned[userIndex].content = [...content, { type: "text", text: note }];
  }
  return cloned;
}

function mediaRuntimePaths() {
  const bundledMediaRoot = path.join(runtimeResourceRoot(), runtimeToolDirectoryName, "media");
  const installedMediaRoot = path.join(productProgramDataRoot, "media-runtime");
  const installedRuntimeComplete = [
    path.join(installedMediaRoot, "ffmpeg.exe"),
    path.join(installedMediaRoot, "ggml-base-q5_1.bin"),
    path.join(installedMediaRoot, "whisper", "Release", "whisper-cli.exe")
  ].every((filePath) => fs.existsSync(filePath));
  const mediaRoot = app.isPackaged && installedRuntimeComplete ? installedMediaRoot : bundledMediaRoot;
  return {
    mediaRoot,
    ffmpegPath: path.join(mediaRoot, "ffmpeg.exe"),
    whisperPath: path.join(mediaRoot, "whisper", "Release", "whisper-cli.exe"),
    whisperRoot: path.join(mediaRoot, "whisper", "Release"),
    modelPath: path.join(mediaRoot, "ggml-base-q5_1.bin")
  };
}

function isAudioOrVideoPath(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return audioMimeByExtension.has(extension) || videoMimeByExtension.has(extension);
}

function mediaTranscriptionCacheDir(userId) {
  return ensureDir(path.join(getStoreDir(userId), "media-transcriptions"));
}

function mediaFileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return crypto.createHash("sha256")
    .update(path.resolve(filePath).toLowerCase())
    .update(String(stat.size))
    .update(String(stat.mtimeMs))
    .digest("hex");
}

function runMediaProcess(executable, args, options = {}, signal, onOutput) {
  if (signal?.aborted) return Promise.reject(createGenerationStoppedError());
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || path.dirname(executable),
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (type, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      if (type === "resolve") resolve(value);
      else reject(value);
    };
    const handleAbort = () => {
      if (child.exitCode === null) child.kill();
      finish("reject", createGenerationStoppedError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onOutput?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      onOutput?.(text);
    });
    child.once("error", (error) => finish("reject", error));
    child.once("close", (code) => {
      if (code === 0) finish("resolve", { code, stdout, stderr });
      else finish("reject", new Error(`媒体处理失败（退出码 ${code ?? -1}）：${String(stderr || stdout).trim().slice(-800)}`));
    });
  });
}

async function transcribeMediaAttachment(userId, imported, signal, onProgress, index, total) {
  const sourcePath = imported.absolutePath;
  const cacheKey = String(imported.sourceFingerprint || mediaFileFingerprint(sourcePath));
  const cachePath = path.join(mediaTranscriptionCacheDir(userId), `${cacheKey}.json`);
  const cached = readJsonFile(cachePath);
  if (cached?.text && cached?.schemaVersion === 1) {
    onProgress?.({ stage: "media-cache", message: `已读取缓存转写：${path.basename(sourcePath)}`, mediaIndex: index + 1, mediaTotal: total });
    return {
      ...imported,
      transcript: String(cached.text),
      transcriptCached: true,
      mediaType: cached.mediaType || "audio",
      keyFramePaths: Array.isArray(cached.keyFramePaths) ? cached.keyFramePaths.filter((item) => fs.existsSync(item)) : []
    };
  }

  const runtime = mediaRuntimePaths();
  for (const requiredPath of [runtime.ffmpegPath, runtime.whisperPath, runtime.modelPath]) {
    if (!fs.existsSync(requiredPath)) throw new Error("本地音视频解析组件不完整，请重新安装XMAI Studio");
  }
  const temporaryRoot = ensureDir(path.join(mediaTranscriptionCacheDir(userId), "temporary"));
  const wavPath = path.join(temporaryRoot, `${cacheKey}.wav`);
  const outputBase = path.join(temporaryRoot, `${cacheKey}-transcript`);
  const transcriptPath = `${outputBase}.txt`;
  const mediaType = videoMimeByExtension.has(path.extname(sourcePath).toLowerCase()) ? "video" : "audio";
  const keyFrameDir = path.join(mediaTranscriptionCacheDir(userId), `${cacheKey}-frames`);
  let keyFramePaths = [];
  try {
    onProgress?.({
      stage: "media-extracting",
      message: mediaType === "video" ? `正在提取视频音轨：${path.basename(sourcePath)}` : `正在准备录音：${path.basename(sourcePath)}`,
      mediaIndex: index + 1,
      mediaTotal: total
    });
    await runMediaProcess(runtime.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath
    ], {}, signal);

    if (mediaType === "video") {
      ensureDir(keyFrameDir);
      onProgress?.({ stage: "media-frames", message: `正在提取视频关键画面：${path.basename(sourcePath)}`, mediaIndex: index + 1, mediaTotal: total });
      await runMediaProcess(runtime.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
        "-vf", "fps=1/60,scale='min(1280,iw)':-2", "-frames:v", "8", "-q:v", "4", path.join(keyFrameDir, "frame-%02d.jpg")
      ], {}, signal);
      keyFramePaths = fs.readdirSync(keyFrameDir).filter((name) => /\.jpe?g$/i.test(name)).sort().map((name) => path.join(keyFrameDir, name));
    }

    onProgress?.({ stage: "media-transcribing", message: `正在转写第 ${index + 1}/${total} 个音视频附件…`, mediaIndex: index + 1, mediaTotal: total });
    await runMediaProcess(runtime.whisperPath, [
      "-m", runtime.modelPath,
      "-f", wavPath,
      "-l", "zh",
      "-t", String(Math.max(2, Math.min(8, Math.max(1, os.cpus().length - 1)))),
      "-otxt", "-of", outputBase,
      "-nt", "-np", "-sns"
    ], { cwd: runtime.whisperRoot }, signal);
    const text = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8").replace(/^\uFEFF/, "").trim() : "";
    if (!text) throw new Error(`没有从音视频中识别到可用语音：${path.basename(sourcePath)}`);
    fs.writeFileSync(cachePath, JSON.stringify({
      schemaVersion: 1,
      sourceName: path.basename(sourcePath),
      sourceBytes: fs.statSync(sourcePath).size,
      mediaType,
      keyFramePaths,
      text,
      createdAt: nowIso()
    }, null, 2), "utf8");
    return { ...imported, transcript: text, transcriptCached: false, mediaType, keyFramePaths };
  } finally {
    fs.rmSync(wavPath, { force: true });
    fs.rmSync(transcriptPath, { force: true });
  }
}

async function preprocessMediaAttachments(userId, importedAttachments, signal, onProgress) {
  const mediaAttachments = importedAttachments.filter((item) => isAudioOrVideoPath(item.absolutePath));
  if (!mediaAttachments.length) return importedAttachments;
  const transcribedByPath = new Map();
  for (let index = 0; index < mediaAttachments.length; index += 1) {
    if (signal?.aborted) throw createGenerationStoppedError();
    const result = await transcribeMediaAttachment(userId, mediaAttachments[index], signal, onProgress, index, mediaAttachments.length);
    transcribedByPath.set(result.absolutePath, result);
  }
  onProgress?.({ stage: "media-completed", message: "音视频转写完成，正在交给技能整理结果…", mediaTotal: mediaAttachments.length });
  return importedAttachments.map((item) => transcribedByPath.get(item.absolutePath) || item);
}

function appendMediaTranscriptContext(messages, importedAttachments) {
  const transcriptions = importedAttachments.filter((item) => String(item.transcript || "").trim());
  if (!transcriptions.length) return messages;
  const note = [
    "以下内容是客户端已经完成的真实音视频转写。必须直接基于转写内容完成用户任务，不要再回复‘准备转写’、‘将开始处理’或要求用户重新上传：",
    ...transcriptions.map((item) => `\n【${path.basename(item.absolutePath)} 转写开始】\n${item.transcript}\n【${path.basename(item.absolutePath)} 转写结束】`)
  ].join("\n");
  const cloned = messages.map((message) => ({ ...message }));
  const userIndex = cloned.map((message) => message.role).lastIndexOf("user");
  if (userIndex < 0) return [...cloned, { role: "user", content: note }];
  const content = cloned[userIndex].content;
  if (typeof content === "string") cloned[userIndex].content = `${content}\n\n${note}`;
  else if (Array.isArray(content)) cloned[userIndex].content = [...content, { type: "text", text: note }];
  return cloned;
}

function mediaKeyFramePaths(importedAttachments) {
  return importedAttachments.flatMap((item) => Array.isArray(item.keyFramePaths) ? item.keyFramePaths : [])
    .filter((item, index, paths) => fs.existsSync(item) && paths.indexOf(item) === index);
}

function resolveBundledSkillDefinition(payload = {}) {
  const skillId = String(payload.skillId || "").trim();
  const skillSlug = String(payload.skillSlug || "").trim();
  if (bundledSkillDefinitions[skillId]) return bundledSkillDefinitions[skillId];
  return Object.values(bundledSkillDefinitions).find((definition) => definition.slug === skillSlug) || null;
}

function readBundledSkillPrompt(definition) {
  if (!definition) return "";
  if (bundledSkillPromptCache.has(definition.slug)) return bundledSkillPromptCache.get(definition.slug);

  const skillRoot = path.join(bundledSkillRoot, definition.directoryName);
  const skillPath = path.join(skillRoot, "SKILL.md");
  if (!fs.existsSync(skillPath)) throw new Error(`固定技能“${definition.displayName}”缺少 SKILL.md`);
  const sections = [
    `当前固定技能为“${definition.displayName}”。必须优先遵循以下技能规范，并直接处理用户本轮提供的会议材料。`,
    fs.readFileSync(skillPath, "utf8").trim()
  ];
  const referencesRoot = path.join(skillRoot, "references");
  if (fs.existsSync(referencesRoot)) {
    const referenceFiles = fs.readdirSync(referencesRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
    for (const fileName of referenceFiles) {
      sections.push(`固定技能参考资料：${fileName}\n${fs.readFileSync(path.join(referencesRoot, fileName), "utf8").trim()}`);
    }
  }
  const prompt = sections.filter(Boolean).join("\n\n");
  bundledSkillPromptCache.set(definition.slug, prompt);
  return prompt;
}

function applyBundledSkillPrompt(messages, payload = {}) {
  const prompt = readBundledSkillPrompt(resolveBundledSkillDefinition(payload));
  if (!prompt) return messages;
  const cloned = messages.map((message) => ({ ...message }));
  const systemIndex = cloned.findIndex((message) => message.role === "system");
  if (systemIndex >= 0) {
    cloned[systemIndex].content = `${String(cloned[systemIndex].content || "").trim()}\n\n${prompt}`.trim();
  } else {
    cloned.unshift({ role: "system", content: prompt });
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

async function requestChatCompletion(payload, onDelta, externalSignal, onProgress, operationContext = {}) {
  const runtimeConfig = getAiRuntimeConfig();
  if (!runtimeConfig.apiBaseUrl) {
    throw new Error(`未配置企业模型服务。管理员可配置 ${runtimeConfig.configPath} 或环境变量 XIANMA_AI_BASE_URL`);
  }

  const userId = payload?.userId || "local-user";
  const toolsEnabled = payload?.enableFileTools === undefined
    ? payload?.enableWorkspaceTools !== false
    : payload.enableFileTools === true;
  const selectedAttachments = validateInputFiles(payload?.attachments, { allowUnlimited: payload?.allowUnlimitedAttachments === true });
  let importedAttachments = await importAttachmentsToWorkspace(userId, selectedAttachments);
  importedAttachments = await preprocessMediaAttachments(userId, importedAttachments, externalSignal, onProgress);
  const messagesWithAttachmentContext = appendMediaTranscriptContext(
    appendImportedAttachmentContext(payload?.messages || [], importedAttachments),
    importedAttachments
  );
  const messages = applyBundledSkillPrompt(
    normalizeMessages(attachImagesToLastUserMessage(messagesWithAttachmentContext, [
      ...(Array.isArray(payload?.imagePaths) ? payload.imagePaths : []),
      ...mediaKeyFramePaths(importedAttachments)
    ])),
    payload
  );
  const browserContinuationMessage = await buildBrowserContinuationMessage(payload, userId, externalSignal);
  if (browserContinuationMessage) messages.push(browserContinuationMessage);
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
  if (toolsEnabled || payload?.artifactOutput || payload?.skillId || payload?.skillSlug || selectedAttachments.length) {
    headers["X-Xianma-Task-Mode"] = "complex";
  }
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
      if (response.headers.get("x-xianma-model-mode") === "auto") {
        onProgress?.({ stage: "model-routing", modelMode: "auto", message: "正在整理回复…" });
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
    onProgress?.({ stage: "model", message: toolsEnabled ? "正在分析任务并准备执行…" : "正在请求企业模型服务…" });
    while (true) {
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
      if (response.headers.get("x-xianma-model-mode") === "auto") {
        onProgress?.({ stage: "model-routing", modelMode: "auto", message: "正在整理回复…" });
      }

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
      onProgress?.({ stage: "tools", message: `正在执行第 ${toolRounds + 1} 轮文件、应用与网页操作…`, toolRounds: toolRounds + 1 });
      workingMessages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
      const captureVisionMessages = [];
      for (const toolCall of toolCalls) {
        if (externalSignal?.aborted) throw createGenerationStoppedError();
        let toolResult;
        try {
          toolResult = await executeWorkspaceTool(payload?.userId || "local-user", toolCall, externalSignal, {
            ...operationContext,
            userId: payload?.userId || "local-user",
            conversationId: payload?.conversationId || "default",
            browserAutomationTaskId: payload?.browserAutomationTaskId || "",
            taskId: payload?.browserAutomationTaskId || payload?.taskId || "",
            executionId: payload?.executionId || "",
            task: payload?.message || "",
            signal: externalSignal
          });
        } catch (toolError) {
          if (externalSignal?.aborted || toolError?.code === "GENERATION_STOPPED") throw createGenerationStoppedError();
          toolResult = { error: toolError.message || "工具执行失败" };
        }
        if (toolResult?.opened && toolResult?.path) previewedPaths.add(path.resolve(toolResult.path).toLowerCase());
        if (workspaceRoot) toolArtifacts.push(...artifactsFromToolResult(workspaceRoot, toolResult));
        onProgress?.({ stage: "tool", message: `已完成：${toolDisplayName(toolCall)}`, toolRounds: toolRounds + 1 });
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: truncateToolResult(toolResult)
        });
        const captureVisionMessage = buildDesktopCaptureVisionMessage(toolCall, toolResult);
        if (captureVisionMessage) captureVisionMessages.push(captureVisionMessage);
      }
      workingMessages.push(...captureVisionMessages);
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
      writeAiDiagnostic("aborted", {
        endpoint,
        model: allowedModel,
        elapsedMs: Date.now() - startedAt,
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
  if (!runtimeConfig.imageApiBaseUrl) {
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
  const endpoint = `${runtimeConfig.imageApiBaseUrl}/images/${isEdit ? "edits" : "generations"}`;
  const imageModel = resolveImageModel(runtimeConfig, payload?.model);
  const controller = new AbortController();
  let externallyAborted = Boolean(externalSignal?.aborted);
  const unlinkAbort = linkAbortSignal(externalSignal, controller);
  const markExternalAbort = () => { externallyAborted = true; };
  externalSignal?.addEventListener("abort", markExternalAbort, { once: true });
  const headers = {};
  if (runtimeConfig.imageApiKey) {
    headers.Authorization = `Bearer ${runtimeConfig.imageApiKey}`;
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

    // Show the provider result immediately. Local persistence continues in the
    // background and updates the message when a stable local path is ready.
    const visibleImages = displayImages.map(({ _base64, _url, ...image }) => image);
    onProgress?.({
      stage: "preview",
      message: "图片已返回，正在保存本地文件…",
      images: visibleImages
    });

    // Base64 results are already local data, so persist them before returning;
    // this keeps copy/download immediately usable without waiting on a network.
    const immediatelyAvailableImages = await Promise.all(displayImages.map(async (image, index) => {
      if (!image._base64) return image;
      try {
        const saved = await saveBase64Image(image._base64, index, userId);
        return { ...saved, revisedPrompt: image.revisedPrompt };
      } catch {
        return image;
      }
    }));
    const persistence = Promise.all(displayImages.map(async (image, index) => {
      if (image._base64) return immediatelyAvailableImages[index];
      try {
        const saved = image._url
          ? await saveRemoteImage(image._url, index, userId)
          : null;
        return saved ? { ...saved, revisedPrompt: image.revisedPrompt } : image;
      } catch {
        return image;
      }
    })).then((images) => {
      onProgress?.({ stage: "saved", message: "图片已保存到本地", images });
      return images;
    }).catch(() => {});

    const savedImages = payload?.waitForLocalSave ? await persistence : immediatelyAvailableImages;
    if (payload?.waitForLocalSave && !savedImages?.every(image => image.localPath && fs.existsSync(image.localPath))) throw new Error("图片已生成，但本地保存失败，请重试");

    return {
      content: isEdit ? "已根据当前会话中的图片完成调整。" : "已生成图片。你可以继续让我调整风格、画幅、主体或细节。",
      model: imageModel,
      images: savedImages.map(({ _base64, _url, ...image }) => image)
    };
  } catch (error) {
    if (externallyAborted || externalSignal?.aborted) {
      throw createGenerationStoppedError();
    }
    if (error?.name === "AbortError") throw new Error("图片请求已中止，请重试");
    throw error;
  } finally {
    unlinkAbort();
    externalSignal?.removeEventListener("abort", markExternalAbort);
  }
}

if (process.env.XIANMA_ENABLE_TEST_API === "1") {
  module.exports.__test = {
    executeWorkspaceTool,
    readComputerOperationHistory,
    resolveComputerPath,
    toolDefinitions,
    getActiveBrowserSession,
    rememberBrowserSession,
    buildBrowserContinuationMessage,
    registerBrowserTaskRun,
    findBrowserTaskRun,
    recordBrowserTaskExecutionDetail,
    finalizeBrowserTaskRun,
    publicBrowserTaskRun,
    desktopUiActionNeedsConfirmation,
    getComputerAccessMode,
    computerOperationPolicy,
    importAttachmentsToWorkspace,
    preprocessMediaAttachments,
    appendMediaTranscriptContext,
    mediaRuntimePaths,
    normalizeAutomationTask,
    validateAutomationTaskInput,
    nextAutomationRun,
    automationScheduleLabel,
    readTaskStore,
    writeTaskStore,
    executeAutomationTask,
    pauseAutomationTask,
    automationSchedulerTick,
    zipInstalledSkillDirectory,
    showPrimaryWindow,
    getAutomationDesktopState: () => ({
      schedulerActive: Boolean(automationSchedulerTimer),
      trayActive: Boolean(applicationTray && !applicationTray.isDestroyed()),
      primaryWindowVisible: Boolean(primaryWindow && !primaryWindow.isDestroyed() && primaryWindow.isVisible()),
      applicationIsQuitting
    })
  };
}

app.whenReady().then(async () => {
  app.setAppUserModelId(isTestBuild ? "com.xianma.ai-studio.preview" : "com.xianma.ai-studio.desktop");
  createApplicationTray();
  try {
    migrateLegacyProductData();
    migrateLegacyUserFiles();
    await collectLegacyProfileChatImports();
  } catch (error) {
    writeAiDiagnostic("startup-memory-migration", {
      message: String(error?.message || "unknown").slice(0, 240)
    });
  }
  const mainWindow = createWindow();
  primaryWindowCreated = true;
  if (app.isPackaged || process.env.XIANMA_ENABLE_UPDATES === "1") {
    desktopUpdater = createDesktopUpdater({
      app,
      dialog,
      Notification,
      publicKeyPath: updateSigningPublicKeyPath,
      configPath: updateConfigPath,
      writeDiagnostic: writeAiDiagnostic
    });
    desktopUpdater.start(mainWindow);
  }
  setTimeout(cleanupLegacyInstalledRuntime, 5000);
  startAutomationScheduler();
  if (app.isPackaged) {
    setTimeout(() => {
      ensureAgentRuntimeAvailable().catch((error) => {
        writeAiDiagnostic("managed-runtime-prewarm", { message: String(error?.message || "unknown").slice(0, 240) });
      });
    }, 300);
  }
  app.on("activate", () => {
    showPrimaryWindow();
  });
});

app.on("before-quit", () => {
  applicationIsQuitting = true;
  stopAutomationScheduler();
  stopDesktopTelemetry("app_close");
  desktopUpdater?.stop();
  for (const confirmationId of [...pendingComputerOperationConfirmations.keys()]) {
    settleComputerOperationConfirmation(confirmationId, "deny", "application-quit");
  }
  runtimeSetup.cancelRequested = true;
  if (runtimeSetup.child && runtimeSetup.child.exitCode === null) runtimeSetup.child.kill();
  for (const controller of activeGenerationRequests.values()) controller.abort();
  activeGenerationRequests.clear();
  for (const run of activeAutomationRuns.values()) run.controller.abort();
  for (const runtime of managedGatewayRuntimes.values()) {
    if (runtime.child.exitCode === null) runtime.child.kill();
  }
  managedGatewayRuntimes.clear();
  for (const client of gatewayClients.values()) client.close();
  gatewayClients.clear();
});

app.on("window-all-closed", () => {
  if (!primaryWindowCreated || applicationIsQuitting) return;
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

ipcMain.handle("desktop:get-computer-operation-history", async (_event, payload) => {
  return readComputerOperationHistory(payload?.userId || "local-user", payload?.limit);
});

ipcMain.handle("desktop:resolve-computer-operation-confirmation", async (event, payload) => {
  const confirmationId = String(payload?.confirmationId || "");
  const pending = pendingComputerOperationConfirmations.get(confirmationId);
  if (!pending) return { resolved: false, reason: "not-found" };
  if (pending.sender?.id !== event.sender.id) return { resolved: false, reason: "sender-mismatch" };
  const decision = payload?.decision === "allow-once" ? "allow-once" : "deny";
  return { resolved: settleComputerOperationConfirmation(confirmationId, decision, "user"), decision };
});

ipcMain.handle("desktop:select-files", async (_event, payload) => {
  const result = await dialog.showOpenDialog({
    title: "选择附件",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "全部支持的文件", extensions: ["doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "pdf", "txt", "md", "rtf", "odt", "ods", "odp", "html", "htm", "json", "xml", "yaml", "yml", "zip", "rar", "7z", "tar", "gz", "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tif", "tiff", "avif", "heic", "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "amr", "aif", "aiff", "mp4", "m4v", "mov", "webm", "avi", "mkv", "wmv", "flv", "mpeg", "mpg", "3gp"] },
      { name: "视频与音频", extensions: ["mp4", "m4v", "mov", "webm", "avi", "mkv", "wmv", "flv", "mpeg", "mpg", "3gp", "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "amr", "aif", "aiff"] },
      { name: "文档与图片", extensions: ["doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "pdf", "txt", "md", "rtf", "odt", "ods", "odp", "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tif", "tiff"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  return result.canceled ? [] : validateInputFiles(result.filePaths, { allowUnlimited: payload?.allowUnlimited === true });
});

ipcMain.handle("desktop:get-input-file-metadata", async (_event, payload) => {
  const filePaths = validateInputFiles(payload?.filePaths, { allowUnlimited: payload?.allowUnlimited === true });
  return filePaths.map((filePath) => {
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

ipcMain.handle("desktop:write-workspace-file", async (event, payload) => {
  const { rootPath, targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath);
  const content = String(payload?.content || "");
  const exists = fs.existsSync(targetPath);
  return runComputerOperation({ sender: event.sender, userId: payload?.userId || "local-user", conversationId: payload?.conversationId || "default" }, {
    action: "computer_write",
    title: exists ? "确认覆盖文件" : "新建文件",
    target: targetPath,
    requiresConfirmation: exists
  }, () => {
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, content, "utf8");
    return { rootPath, path: targetPath, bytes: Buffer.byteLength(content, "utf8") };
  });
});

ipcMain.handle("desktop:read-workspace-file", async (_event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath);
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) throw new Error("本地文件不存在");
  return { path: targetPath, content: fs.readFileSync(targetPath, "utf8") };
});

ipcMain.handle("desktop:run-workspace-command", async (event, payload) => {
  const userId = payload?.userId || "local-user";
  const { rootPath } = resolveUserWorkspacePath(userId);
  return runComputerOperation({ sender: event.sender, userId, conversationId: payload?.conversationId || "default" }, {
    action: "computer_run",
    title: "确认运行命令",
    description: "该命令会在当前 Windows 账号权限下运行。请核对命令内容。",
    target: rootPath,
    auditTarget: rootPath,
    commandSummary: String(payload?.command || ""),
    requiresConfirmation: true
  }, () => runWorkspaceCommand(userId, payload?.command));
});

ipcMain.handle("desktop:create-web-preview", async (event, payload) => {
  const { targetPath } = resolveUserWorkspacePath(payload?.userId || "local-user", payload?.relativePath || `generated/${Date.now()}-preview.html`);
  if (!targetPath.toLowerCase().endsWith(".html") && !targetPath.toLowerCase().endsWith(".htm")) throw new Error("网页预览文件必须是 HTML");
  const html = String(payload?.html || "");
  if (!html.trim()) throw new Error("缺少网页内容");
  const exists = fs.existsSync(targetPath);
  return runComputerOperation({ sender: event.sender, userId: payload?.userId || "local-user", conversationId: payload?.conversationId || "default" }, {
    action: "computer_write",
    title: exists ? "确认覆盖网页" : "生成网页",
    target: targetPath,
    requiresConfirmation: exists
  }, () => {
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, html, "utf8");
    openHtmlPreview(targetPath);
    return { path: targetPath, url: pathToFileURL(targetPath).toString() };
  });
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

function promptLibraryUrl(value, fallback, label) {
  let url;
  try {
    url = new URL(String(value || "").trim() || fallback);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label}地址必须使用 HTTP 或 HTTPS`);
  return url;
}

function promptPortalPayloadData(payload) {
  let current = payload;
  for (let depth = 0; depth < 5 && current && typeof current === "object" && current.data !== undefined; depth += 1) {
    current = current.data;
  }
  return current;
}

function hasPromptPortalSession(payload) {
  const data = promptPortalPayloadData(payload);
  if (!data || typeof data !== "object") return data === true;
  if (data.authenticated === true || data.verified === true) return true;
  return Boolean(data.user || data.session || data.accessToken || data.userId);
}

function promptPortalEntries(payload) {
  const data = promptPortalPayloadData(payload);
  if (Array.isArray(data)) return data;
  for (const candidate of [data?.entries, data?.items, data?.records, data?.list, payload?.entries, payload?.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function promptPortalEntryCode(entry) {
  return String(entry?.code || entry?.entryCode || entry?.id || "").trim();
}

function isPromptPortalEntry(entry) {
  const configuredUrl = String(entry?.launchUrl || entry?.url || entry?.href || "");
  const searchable = [entry?.code, entry?.entryCode, entry?.name, entry?.label, entry?.title, entry?.description, configuredUrl]
    .map((value) => String(value || ""))
    .join(" ");
  if (/提示词|prompt/i.test(searchable)) return true;
  try { return new URL(configuredUrl).searchParams.get("entry") === "prompts"; } catch { return false; }
}

function selectPromptPortalEntry(entries) {
  const candidates = Array.isArray(entries) ? entries : [];
  return candidates.find((entry) => promptPortalEntryCode(entry).toUpperCase() === "PROMPT_LIBRARY")
    || candidates.find(isPromptPortalEntry)
    || null;
}

function promptPortalAccessToken(payload) {
  const data = promptPortalPayloadData(payload);
  return String(data?.accessToken || data?.token || payload?.accessToken || payload?.token || "").trim();
}

function promptLaunchUrl(payload) {
  const data = promptPortalPayloadData(payload);
  return String(data?.url || data?.launchUrl || data?.href || payload?.url || payload?.launchUrl || "").trim();
}

function validatePromptLaunchUrl(value, configuredEntryUrl) {
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error("提示词库免登地址无效");
  }
  if (candidate.origin !== configuredEntryUrl.origin || candidate.pathname !== configuredEntryUrl.pathname) {
    throw new Error("提示词库免登地址未通过安全校验");
  }
  if (candidate.searchParams.get("source") !== "XM_PORTAL" || candidate.searchParams.get("entry") !== "prompts") {
    throw new Error("提示词库免登入口不正确");
  }
  if (!candidate.searchParams.get("ticket")) throw new Error("提示词库没有返回一次性登录票据");
  return candidate;
}

function publicPromptLibraryUrl(value) {
  const url = new URL(value);
  url.searchParams.delete("ticket");
  url.searchParams.delete("accessToken");
  url.searchParams.delete("token");
  return `${url.origin}${url.pathname}${url.search}`;
}

function promptDesktopExchangeUrl(portalUrl) {
  const configured = String(process.env.XIANMA_PROMPT_DESKTOP_EXCHANGE_URL || "").trim();
  const exchangeUrl = configured
    ? promptLibraryUrl(configured, "", "提示词桌面免登接口")
    : new URL(defaultPromptDesktopExchangePath, portalUrl);
  if (exchangeUrl.origin !== portalUrl.origin) throw new Error("提示词桌面免登接口必须与提示词门户同源");
  return exchangeUrl;
}

async function requestPromptDesktopExchange(portalUrl, configuredEntryUrl, loginSession) {
  if (!desktopTelemetry.sessionToken) {
    await startDesktopTelemetry(loginSession, { eventType: "" });
  }
  const desktopSessionToken = desktopTelemetry.sessionToken
    || (!app.isPackaged ? String(process.env.XIANMA_PROMPT_TEST_SESSION_TOKEN || "").trim() : "");
  if (!desktopSessionToken) {
    throw new Error("当前桌面登录会话尚未就绪，请稍后再打开提示词库");
  }
  const sessions = readDingtalkSessions();
  const record = sessions.currentUserId && sessions.users?.[safeWorkspaceSegment(sessions.currentUserId)]
    || (!app.isPackaged && process.env.XIANMA_DEV_AUTH_BYPASS === "1" ? {
      userId: loginSession.userId,
      dingtalkUserId: String(process.env.XIANMA_PROMPT_TEST_DINGTALK_USER_ID || "development-user"),
      corpId: loginSession.corpId || "development"
    } : null);
  if (!record?.userId) throw new Error("当前钉钉登录身份无效，请重新登录");
  const dingtalkUserId = record.dingtalkUserId || await ensureStoredDingtalkEnterpriseUserId(getDingtalkConfig(), record);
  const exchangeUrl = promptDesktopExchangeUrl(portalUrl);
  let response;
  try {
    response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${desktopSessionToken}`
      },
      body: JSON.stringify({
        DTUserId: dingtalkUserId,
        corpId: record.corpId || loginSession.corpId || "",
        source: "XM_PORTAL",
        entry: "prompts"
      })
    });
  } catch {
    throw new Error("提示词门户桌面免登服务暂时无法连接");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("提示词门户尚未开通桌面免登接口，请门户服务端接入 /api/portal/auth/desktop");
    }
    if (response.status === 401 && String(data?.code || "").toUpperCase() === "SESSION_EXPIRED") {
      throw new Error("提示词门户尚未信任当前 XMAI 桌面登录会话，请门户管理员开通桌面免登");
    }
    const detail = String(data?.message || data?.error || "").trim().slice(0, 160);
    throw new Error(`提示词门户桌面免登失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  const launchUrl = promptLaunchUrl(data);
  if (launchUrl) return { launchUrl: validatePromptLaunchUrl(launchUrl, configuredEntryUrl), accessToken: "" };
  const accessToken = promptPortalAccessToken(data);
  if (!accessToken) throw new Error("提示词门户没有返回一次性登录票据或门户令牌");
  return { launchUrl: null, accessToken };
}

async function promptPortalFetch(promptWindow, url, options = {}) {
  if (!promptWindow || promptWindow.isDestroyed()) throw new Error("提示词库窗口已关闭");
  const requestOptions = {
    method: options.method || "GET",
    credentials: "include",
    headers: { accept: "application/json", ...(options.headers || {}) }
  };
  if (options.body !== undefined) {
    requestOptions.headers["content-type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }
  return promptWindow.webContents.executeJavaScript(`(async () => {
    const response = await fetch(${JSON.stringify(url.toString())}, ${JSON.stringify(requestOptions)});
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 240) }; }
    return { ok: response.ok, status: response.status, data };
  })()`, true);
}

function runPromptLibraryLaunch(promptWindow, portalUrl, configuredEntryUrl, loginSession) {
  const portalOrigin = portalUrl.origin;
  const targetOrigin = configuredEntryUrl.origin;
  const portalSessionUrl = new URL("/api/portal/session", portalUrl);
  const portalEntriesUrl = new URL("/api/portal/entries", portalUrl);
  let busy = false;
  let launchStarted = false;
  let portalAccessToken = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      promptWindow.webContents.removeListener("did-finish-load", inspectPage);
      promptWindow.webContents.removeListener("did-navigate-in-page", inspectPage);
      promptWindow.webContents.removeListener("did-fail-load", failLoad);
      promptWindow.removeListener("closed", closed);
    };
    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const closed = () => settle(new Error("已关闭提示词库"));
    const failLoad = (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      settle(new Error(`提示词库页面加载失败：${errorDescription || errorCode}`));
    };
    const inspectPage = async () => {
      if (busy || settled || promptWindow.isDestroyed()) return;
      let current;
      try { current = new URL(promptWindow.webContents.getURL()); } catch { return; }
      if (current.origin === targetOrigin) {
        if (current.pathname === "/prompts") settle(null, { opened: true, url: `${current.origin}/prompts` });
        return;
      }
      if (current.origin !== portalOrigin || launchStarted) return;
      busy = true;
      try {
        const portalSession = await promptPortalFetch(promptWindow, portalSessionUrl);
        if (!portalSession.ok || !hasPromptPortalSession(portalSession.data)) {
          const exchange = await requestPromptDesktopExchange(portalUrl, configuredEntryUrl, loginSession);
          if (exchange.launchUrl) {
            launchStarted = true;
            promptWindow.loadURL(exchange.launchUrl.toString()).catch((error) => settle(error));
            return;
          }
          portalAccessToken = exchange.accessToken;
        } else {
          portalAccessToken = promptPortalAccessToken(portalSession.data);
        }
        const authHeaders = portalAccessToken ? { authorization: `Bearer ${portalAccessToken}` } : {};
        const entriesResponse = await promptPortalFetch(promptWindow, portalEntriesUrl, { headers: authHeaders });
        if (!entriesResponse.ok) throw new Error(`提示词门户入口读取失败（${entriesResponse.status}）`);
        const entry = selectPromptPortalEntry(promptPortalEntries(entriesResponse.data));
        const entryCode = promptPortalEntryCode(entry);
        if (!entry || !entryCode) throw new Error("提示词门户中没有可用的提示词库入口");
        const launchResponse = await promptPortalFetch(promptWindow, new URL(`/api/portal/entries/${encodeURIComponent(entryCode)}/launch`, portalUrl), { method: "POST", headers: authHeaders, body: {} });
        if (!launchResponse.ok) throw new Error(`提示词库免登启动失败（${launchResponse.status}）`);
        const target = validatePromptLaunchUrl(promptLaunchUrl(launchResponse.data), configuredEntryUrl);
        launchStarted = true;
        promptWindow.loadURL(target.toString()).catch((error) => settle(error));
      } catch (error) {
        settle(error);
      } finally {
        busy = false;
      }
    };

    promptWindow.webContents.on("did-finish-load", inspectPage);
    promptWindow.webContents.on("did-navigate-in-page", inspectPage);
    promptWindow.webContents.on("did-fail-load", failLoad);
    promptWindow.on("closed", closed);
    promptWindow.loadURL(portalUrl.toString()).catch((error) => settle(error));
  });
}

async function openPromptLibrary() {
  const loginStatus = await getDingtalkSessionStatus();
  if (!loginStatus.session) throw new Error("请先登录钉钉，再打开提示词库");
  if (promptLibraryWindow && !promptLibraryWindow.isDestroyed()) {
    promptLibraryWindow.show();
    promptLibraryWindow.focus();
    if (promptLibraryOpenPromise) return promptLibraryOpenPromise;
    return { opened: true, reused: true, url: promptLibraryWindow.webContents.getURL() };
  }

  const portalUrl = promptLibraryUrl(process.env.XIANMA_PROMPT_PORTAL_URL, defaultPromptPortalUrl, "提示词门户");
  const configuredEntryUrl = promptLibraryUrl(process.env.XIANMA_PROMPT_LIBRARY_URL, defaultPromptLibraryEntryUrl, "提示词库");
  promptLibraryWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    title: "提示词库",
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:xianma-dingtalk-auth"
    }
  });
  promptLibraryWindow.removeMenu();
  promptLibraryWindow.once("ready-to-show", () => {
    if (promptLibraryWindow && !promptLibraryWindow.isDestroyed()) promptLibraryWindow.show();
  });
  promptLibraryWindow.on("closed", () => { promptLibraryWindow = null; });
  promptLibraryWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const allowed = target.origin === portalUrl.origin || target.origin === configuredEntryUrl.origin
        || target.hostname === "login.dingtalk.com" || target.hostname.endsWith(".dingtalk.com");
      if (allowed) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:xianma-dingtalk-auth" } } };
    } catch {
      // Invalid popup URLs are denied.
    }
    return { action: "deny" };
  });

  promptLibraryOpenPromise = runPromptLibraryLaunch(promptLibraryWindow, portalUrl, configuredEntryUrl, loginStatus.session);
  try {
    const result = await promptLibraryOpenPromise;
    return { ...result, url: publicPromptLibraryUrl(result.url) };
  } catch (error) {
    if (promptLibraryWindow && !promptLibraryWindow.isDestroyed()) promptLibraryWindow.close();
    throw error;
  } finally {
    promptLibraryOpenPromise = null;
  }
}

ipcMain.handle("desktop:open-prompt-library", openPromptLibrary);

function publicPromptLibraryEndpoint() {
  const configured = String(process.env.XIANMA_PROMPT_LIBRARY_API_URL || "").trim();
  const endpoint = promptLibraryUrl(configured, defaultPublicPromptLibraryUrl, "公共提示词库接口");
  if (app.isPackaged && endpoint.protocol !== "https:") throw new Error("公共提示词库接口必须使用 HTTPS");
  return endpoint;
}

async function getPublicPromptLibrary(payload = {}) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(payload.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(24, Number.parseInt(payload.pageSize, 10) || 12));
  const keyword = String(payload.keyword || "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 100);
  const endpoint = publicPromptLibraryEndpoint();
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("page_size", String(pageSize));
  if (keyword) endpoint.searchParams.set("keyword", keyword);
  const cacheKey = endpoint.toString();
  const cached = publicPromptLibraryCache.get(cacheKey);
  if (payload.force !== true && cached && Date.now() - cached.time < 60 * 1000) return cached.value;

  let response;
  try {
    response = await fetch(endpoint, { headers: { accept: "application/json" } });
  } catch {
    throw new Error("公共提示词库暂时无法连接，请检查网络后重试");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || Number(result?.code) !== 200 || !Array.isArray(result?.data?.items)) {
    const detail = String(result?.message || result?.error || "").trim().slice(0, 120);
    throw new Error(detail || `公共提示词库返回异常（${response.status}）`);
  }
  const value = JSON.parse(JSON.stringify(result));
  publicPromptLibraryCache.set(cacheKey, { time: Date.now(), value });
  if (publicPromptLibraryCache.size > 100) publicPromptLibraryCache.delete(publicPromptLibraryCache.keys().next().value);
  return value;
}

ipcMain.handle("desktop:get-public-prompt-library", async (_event, payload) => getPublicPromptLibrary(payload));

ipcMain.handle("desktop:get-installed-skills", async (_event, payload) => {
  return JSON.parse(JSON.stringify({ skills: listInstalledSkills(payload?.userId || "local-user") }));
});

ipcMain.handle("desktop:get-installed-skill-source", async (_event, payload) => {
  const sourcePath = findInstalledSkillRoot(payload?.userId || "local-user", String(payload?.skillId || ""));
  if (!sourcePath) throw new Error("技能不存在或已卸载");
  return { sourcePath, entryPath: findSkillManifestPath(sourcePath) };
});

ipcMain.handle("desktop:download-installed-skill-package", async (event, payload) => {
  return downloadInstalledSkillPackage(event, payload);
});

ipcMain.handle("desktop:open-installed-skill-source", async (_event, payload) => {
  const sourcePath = findInstalledSkillRoot(payload?.userId || "local-user", String(payload?.skillId || ""));
  if (!sourcePath) throw new Error("技能不存在或已卸载");
  const entryPath = findSkillManifestPath(sourcePath);
  const errorMessage = await shell.openPath(entryPath);
  if (errorMessage) throw new Error(errorMessage);
  return { sourcePath, entryPath };
});

ipcMain.handle("desktop:update-installed-skill", async (_event, payload) => {
  return updateInstalledSkill(payload);
});

ipcMain.handle("desktop:select-skill-source", async (event, payload) => {
  const sourceType = payload?.sourceType === "folder" ? "folder" : payload?.sourceType === "unified" ? "unified" : "file";
  const result = await showSkillSourceDialog(event, sourceType);
  if (result.canceled || !result.filePaths[0]) return { canceled: true, sourceType };
  const selectedPath = result.filePaths[0];
  const selectedSkillEntry = sourceType === "unified" && path.basename(selectedPath).toLowerCase() === "skill.md";
  const sourcePath = selectedSkillEntry ? path.dirname(selectedPath) : selectedPath;
  const resolvedSourceType = sourceType === "folder" || selectedSkillEntry
    ? "folder"
    : /\.zip$/i.test(sourcePath)
      ? "zip"
      : "markdown";
  return { canceled: false, sourceType: resolvedSourceType, sourcePath };
});

ipcMain.handle("desktop:inspect-skill-source", async (_event, payload) => {
  return inspectSkillSource(payload);
});

ipcMain.handle("desktop:install-skill", async (event, payload) => {
  if (payload?.background === true) return queueSkillInstall(event, payload, "local");
  return installSkill(event, payload);
});

ipcMain.handle("desktop:search-online-skills", async (_event, payload) => {
  return searchOnlineSkills(payload);
});

ipcMain.handle("desktop:inspect-online-skill", async (_event, payload) => {
  return inspectOnlineSkill(payload);
});

ipcMain.handle("desktop:install-online-skill", async (event, payload) => {
  if (payload?.background === true) return queueSkillInstall(event, payload, "online");
  return installOnlineSkill(payload);
});

ipcMain.on("desktop:get-startup-chat-backup", (event) => {
  event.returnValue = readStartupChatRestoreData();
});

ipcMain.handle("desktop:check-for-updates", async () => {
  if (!desktopUpdater) return { available: false, reason: "disabled" };
  return desktopUpdater.checkForUpdates({ manual: true, showDialogs: false });
});

ipcMain.handle("desktop:get-update-status", async () => {
  if (desktopUpdater) return desktopUpdater.getStatus();
  const updateConfig = readJsonFile(updateConfigPath) || {};
  return {
    supported: false,
    displayVersion: updateConfig.displayVersion || app.getVersion(),
    internalVersion: updateConfig.internalVersion || app.getVersion(),
    autoCheckEnabled: false,
    status: "disabled",
    lastCheckedAt: "",
    availableDisplayVersion: "",
    availableRelease: null,
    updateHistory: []
  };
});

ipcMain.handle("desktop:set-auto-update-check", async (_event, enabled) => {
  if (!desktopUpdater) return { supported: false, autoCheckEnabled: false, status: "disabled" };
  return desktopUpdater.setAutoCheckEnabled(enabled === true);
});

ipcMain.handle("desktop:remove-installed-skill", async (_event, payload) => {
  return removeInstalledSkill(payload);
});

if (companySkillsEnabled) {
  ipcMain.handle("desktop:create-skill-package", async (event, payload) => companySkillsClient.createSkillPackage(event, payload));
  ipcMain.handle("desktop:inspect-company-skill", async (_event, payload) => companySkillsClient.inspectCompanySkill(payload));
  ipcMain.handle("desktop:prepare-installed-skill-submission", async (_event, payload) => companySkillsClient.prepareInstalledSkillSubmission(payload));
  ipcMain.handle("desktop:submit-company-skill", async (event, payload) => companySkillsClient.submitCompanySkill(event, payload));
  ipcMain.handle("desktop:get-my-skill-submissions", async () => companySkillsClient.getMySubmissions());
  ipcMain.handle("desktop:withdraw-skill-submission", async (_event, payload) => companySkillsClient.withdrawSubmission(payload));
  ipcMain.handle("desktop:get-company-skill-catalog", async () => companySkillsClient.getCatalog());
  ipcMain.handle("desktop:get-skill-taxonomy", async () => companySkillsClient.getSkillTaxonomy());
  ipcMain.handle("desktop:install-company-skill", async (event, payload) => companySkillsClient.installCompanySkill(event, payload));
  ipcMain.handle("desktop:download-company-skill-package", async (event, payload) => companySkillsClient.downloadCompanySkillPackage(event, payload));
  ipcMain.handle("desktop:sync-company-skills", async (event, payload) => companySkillsClient.syncCompanySkills(event, payload));
  ipcMain.handle("desktop:download-skill-template", async (event) => companySkillsClient.downloadTemplate(event));
  ipcMain.handle("desktop:report-company-skill-usage", async (_event, payload) => companySkillsClient.reportUsage(payload));
  ipcMain.handle("desktop:report-v11-facts", async (_event, payload) => companySkillsClient.reportV11Facts(payload));
}

ipcMain.handle("desktop:dingtalk-login", async () => {
  const session = await loginWithDingtalk();
  try {
    await startDesktopTelemetry(session, { eventType: "login", requireMapmsAuthorization: true });
  } catch (error) {
    stopDesktopTelemetry("");
    clearCurrentDingtalkSession();
    throw error;
  }
  if (app.isPackaged && session?.userId) {
    ensureManagedGateway(session.userId).catch((error) => {
      writeAiDiagnostic("managed-gateway-login-prewarm", { message: String(error?.message || "unknown").slice(0, 240) });
    });
  }
  return session;
});

ipcMain.handle("desktop:get-dingtalk-session", async () => {
  const status = await getDingtalkSessionStatus();
  if (status?.session) {
    try {
      await startDesktopTelemetry(status.session, { eventType: "app_open", requireMapmsAuthorization: true });
      if (app.isPackaged) {
        ensureManagedGateway(status.session.userId).catch((error) => {
          writeAiDiagnostic("managed-gateway-restore-prewarm", { message: String(error?.message || "unknown").slice(0, 240) });
        });
      }
    } catch (error) {
      stopDesktopTelemetry("");
      clearCurrentDingtalkSession();
      status.session = null;
      status.message = error.message || "当前账号没有使用权限";
    }
  }
  return status;
});

ipcMain.handle("desktop:dingtalk-logout", async () => {
  const sessionStore = readDingtalkSessions();
  if (sessionStore.currentUserId) stopManagedGateway(sessionStore.currentUserId);
  stopDesktopTelemetry("logout");
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
    return { copied: true, characters: text.length };
  }
  return { copied: false, characters: 0 };
});

ipcMain.handle("desktop:notify", async (_event, payload) => {
  const title = payload?.title || appDisplayName;
  const body = payload?.body || "";
  new Notification({ title, body, icon: appIcon }).show();
});

ipcMain.handle("desktop:get-ai-runtime-config", async () => {
  await refreshPreviewModelCatalog();
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

ipcMain.handle("desktop:save-automation", async (_event, payload) => {
  const userId = String(payload?.userId || "local-user");
  const store = readTaskStore(userId);
  const requestedId = String(payload?.task?.id || "").trim();
  const existingIndex = requestedId ? store.scheduledTasks.findIndex((task) => task.id === requestedId) : -1;
  const existing = existingIndex >= 0 ? store.scheduledTasks[existingIndex] : null;
  const task = validateAutomationTaskInput(payload?.task || {}, existing);
  if (existingIndex >= 0) store.scheduledTasks[existingIndex] = task;
  else store.scheduledTasks.unshift(task);
  writeTaskStore(userId, store);
  publishAutomationUpdate(userId, { taskId: task.id, state: existing ? "updated" : "created" });
  return { task, store: readTaskStore(userId) };
});

ipcMain.handle("desktop:set-automation-enabled", async (_event, payload) => {
  const userId = String(payload?.userId || "local-user");
  const task = updateAutomationTask(userId, String(payload?.taskId || ""), (current) => {
    const enabled = payload?.enabled === true;
    const next = { ...current, enabled, status: enabled ? "启用中" : "已停用", updatedAt: nowIso(), nextRunAt: "" };
    next.nextRunAt = nextAutomationRun(next);
    if (enabled && !next.nextRunAt) throw new Error("当前时间设置没有可执行的下次时间");
    return next;
  });
  publishAutomationUpdate(userId, { taskId: task.id, state: task.enabled ? "enabled" : "disabled" });
  return { task };
});

ipcMain.handle("desktop:run-automation-now", async (event, payload) => {
  const userId = String(payload?.userId || "local-user");
  return executeAutomationTask(userId, String(payload?.taskId || ""), "manual", event.sender);
});

ipcMain.handle("desktop:pause-automation", async (_event, payload) => {
  const userId = String(payload?.userId || "local-user");
  return pauseAutomationTask(userId, String(payload?.taskId || ""));
});

ipcMain.handle("desktop:delete-automation", async (_event, payload) => {
  const userId = String(payload?.userId || "local-user");
  const taskId = String(payload?.taskId || "");
  const runKey = `${safeWorkspaceSegment(userId)}:${taskId}`;
  if (activeAutomationRuns.has(runKey)) throw new Error("自动化正在运行，完成后才能删除");
  const store = readTaskStore(userId);
  const previousLength = store.scheduledTasks.length;
  store.scheduledTasks = store.scheduledTasks.filter((task) => task.id !== taskId);
  if (store.scheduledTasks.length === previousLength) throw new Error("自动化任务不存在");
  writeTaskStore(userId, store);
  publishAutomationUpdate(userId, { taskId, state: "deleted" });
  return { deleted: true, taskId };
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

ipcMain.handle("desktop:get-browser-task", async (_event, payload) => {
  const runtime = findBrowserTaskRun(payload?.userId || "local-user", payload?.conversationId || "default", payload?.taskId);
  return runtime ? publicBrowserTaskRun(runtime) : null;
});

ipcMain.handle("desktop:open-browser-task", async (_event, payload) => {
  const userId = payload?.userId || "local-user";
  const conversationId = payload?.conversationId || "default";
  const taskId = String(payload?.taskId || "").trim();
  const session = getActiveBrowserSession(userId, conversationId, taskId);
  if (!session?.browser || !session?.windowHandle) throw new Error("当前浏览器任务还没有可查看的页面");
  if (session.debugPort) {
    const target = await waitForBrowserCdpTarget(session.debugPort, session.url, session.cdpTargetId, null, 4000).catch(() => null);
    if (target) await sendBrowserCdpCommand(target, "Page.bringToFront", {}, null).catch(() => {});
  }
  await runWindowsUiAutomation({ action: "focus", app: session.browser, windowHandle: Number(session.windowHandle) });
  recordBrowserTaskExecutionDetail({ userId, conversationId, browserAutomationTaskId: taskId }, {
    action: "view-page",
    target: session.url || session.title || session.browser,
    humanControl: true,
    externalImpact: false,
    result: "completed"
  });
  return publicBrowserTaskRun(findBrowserTaskRun(userId, conversationId, taskId) || { userId, conversationId, taskId });
});

ipcMain.handle("desktop:pause-browser-task", async (_event, payload) => {
  const userId = payload?.userId || "local-user";
  const conversationId = payload?.conversationId || "default";
  const taskId = String(payload?.taskId || "").trim();
  const runtime = findBrowserTaskRun(userId, conversationId, taskId);
  if (!runtime) throw new Error("浏览器任务不存在或已结束");
  runtime.pauseRequested = true;
  runtime.status = "PAUSED";
  runtime.updatedAt = nowIso();
  recordBrowserTaskExecutionDetail({ userId, conversationId, browserAutomationTaskId: taskId }, {
    action: "pause",
    target: runtime.url || runtime.siteKey || "browser-task",
    humanControl: true,
    externalImpact: false,
    result: "paused"
  });
  rememberBrowserSession(userId, conversationId, taskId, { status: "paused" });
  runtime.controller?.abort();
  return publicBrowserTaskRun(runtime);
});

ipcMain.handle("desktop:resume-browser-task", async (_event, payload) => {
  const userId = payload?.userId || "local-user";
  const conversationId = payload?.conversationId || "default";
  const taskId = String(payload?.taskId || "").trim();
  const runtime = findBrowserTaskRun(userId, conversationId, taskId);
  if (!runtime) throw new Error("浏览器任务不存在，无法继续");
  runtime.pauseRequested = false;
  runtime.stopRequested = false;
  runtime.status = "READY";
  runtime.updatedAt = nowIso();
  recordBrowserTaskExecutionDetail({ userId, conversationId, browserAutomationTaskId: taskId }, {
    action: "resume",
    target: runtime.url || runtime.siteKey || "browser-task",
    humanControl: true,
    externalImpact: false,
    result: "resumed"
  });
  rememberBrowserSession(userId, conversationId, taskId, { status: "active" });
  return publicBrowserTaskRun(runtime);
});

ipcMain.handle("desktop:cancel-chat-completion", async (event, requestId) => {
  const key = generationRequestKey(event.sender, requestId);
  const controller = key ? activeGenerationRequests.get(key) : null;
  if (!controller || controller.signal.aborted) return { cancelled: false };
  for (const runtime of activeBrowserTaskRuns.values()) {
    if (runtime.controller === controller) runtime.stopRequested = true;
  }
  controller.abort();
  return { cancelled: true };
});

ipcMain.handle("desktop:chat-completion", async (event, payload) => {
  recordDesktopTelemetryEvent("chat");
  if (payload?.artifactOutput) recordDesktopTelemetryEvent("document");
  const generationRequest = registerGenerationRequest(event, payload?.requestId);
  const browserTaskRun = registerBrowserTaskRun(event, payload, generationRequest.controller);
  const operationContext = {
    sender: event.sender,
    userId: payload?.userId || "local-user",
    conversationId: payload?.conversationId || "default",
    browserAutomationTaskId: payload?.browserAutomationTaskId || "",
    taskId: payload?.browserAutomationTaskId || payload?.taskId || "",
    executionId: payload?.executionId || ""
  };
  const completeResult = (result) => {
    const browserTask = finalizeBrowserTaskRun(browserTaskRun, "SUCCEEDED");
    return browserTask ? { ...result, browserTask, executionDetails: browserTask.executionDetails } : result;
  };
  const sendProgress = payload?.requestId
    ? (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:generation-progress", {
          requestId: payload.requestId,
          type: "chat",
          ...progress
        });
      }
    }
    : null;
  const sendDelta = payload?.requestId
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
    const fastWebSkill = isWebContentExtractorRequest(payload);
    if (payload?.preferGateway !== false && !fastWebSkill) {
      try {
        const gatewayReady = ensureManagedGateway(payload?.userId || "local-user");
        if (payload?.waitForGateway === true) {
          await Promise.race([gatewayReady, rejectWhenGenerationStops(generationRequest.controller.signal)]);
        } else {
          await Promise.race([gatewayReady, rejectWhenGenerationStops(generationRequest.controller.signal)]);
        }
        if (generationRequest.controller.signal.aborted) throw createGenerationStoppedError();
        return completeResult(await requestGatewayChat(
          payload,
          generationRequest.controller.signal,
          sendDelta,
          (progress) => sendProgress?.(progress),
          operationContext
        ));
      } catch (error) {
        if (generationRequest.controller.signal.aborted || error?.code === "GENERATION_STOPPED") throw createGenerationStoppedError();
        writeAiDiagnostic("gateway-fallback", { message: String(error?.message || "unknown").slice(0, 240) });
      }
    }
    if (fastWebSkill) {
      return completeResult(await requestGatewayChat(
        payload,
        generationRequest.controller.signal,
        sendDelta,
        (progress) => sendProgress?.(progress),
        operationContext
      ));
    }
    return completeResult(await requestChatCompletion(payload, sendDelta, generationRequest.controller.signal, sendProgress, operationContext));
  } catch (error) {
    const browserTask = finalizeBrowserTaskRun(browserTaskRun, "FAILED", error);
    if (browserTask) {
      error.browserTask = browserTask;
      error.message = `${String(error?.message || "浏览器任务执行失败")}\n[BROWSER_TASK_STATUS:${browserTask.status}]`;
    }
    throw error;
  } finally {
    generationRequest.release();
  }
});

ipcMain.handle("desktop:generate-image", async (event, payload) => {
  recordDesktopTelemetryEvent("image");
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

