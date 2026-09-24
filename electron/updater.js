"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const UPDATE_SCHEMA_VERSION = 1;
const CHAT_STORAGE_PREFIX = "centaur.desktop.chat.v3";
const DOWNLOAD_STALL_TIMEOUT_MS = 90000;
const DOWNLOAD_RETRY_MAX_DELAY_MS = 30000;

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function compareVersions(left, right) {
  const leftParts = String(left || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function decodeSignedRelease(envelope, publicKeyPem) {
  if (!envelope?.signed || !envelope?.signature) throw new Error("更新信息缺少数字签名");
  const signed = Buffer.from(String(envelope.signed), "base64url");
  const signature = Buffer.from(String(envelope.signature), "base64url");
  const verified = crypto.verify(null, signed, publicKeyPem, signature);
  if (!verified) throw new Error("更新信息的数字签名无效");

  const release = JSON.parse(signed.toString("utf8"));
  const required = ["releaseId", "displayVersion", "internalVersion", "sha256", "downloadPath", "fileName"];
  if (release.schemaVersion !== UPDATE_SCHEMA_VERSION || required.some((key) => !String(release[key] || "").trim())) {
    throw new Error("更新信息格式无效");
  }
  if (!/^[a-f0-9]{64}$/i.test(release.sha256)) throw new Error("更新文件校验值无效");
  if (!String(release.fileName).toLowerCase().endsWith(".exe")) throw new Error("更新文件不是 Windows 安装程序");
  return release;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function latestBackupRoot(userDataRoot) {
  return path.join(userDataRoot, "update-backups");
}

function readLatestChatBackup(userDataRoot) {
  const pointer = readJson(path.join(latestBackupRoot(userDataRoot), "latest.json"));
  if (!pointer?.backupId) return null;
  const snapshot = readJson(path.join(latestBackupRoot(userDataRoot), pointer.backupId, "local-storage.json"));
  if (!snapshot?.items || typeof snapshot.items !== "object") return null;
  return {
    createdAt: snapshot.createdAt || pointer.createdAt || "",
    sourceInternalVersion: snapshot.sourceInternalVersion || "",
    items: snapshot.items
  };
}

function pruneBackups(userDataRoot, keep = 5) {
  const root = latestBackupRoot(userDataRoot);
  if (!fs.existsSync(root)) return;
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, mtimeMs: fs.statSync(path.join(root, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  directories.slice(keep).forEach((entry) => fs.rmSync(path.join(root, entry.name), { recursive: true, force: true }));
}

async function createPreUpdateBackup({ app, mainWindow, release, internalVersion }) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      const flushResult = mainWindow.webContents.session.flushStorageData();
      if (flushResult && typeof flushResult.then === "function") await flushResult;
    } catch {}
  }

  let items = {};
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    items = await mainWindow.webContents.executeJavaScript(`(() => {
      const result = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && (key.startsWith(${JSON.stringify(CHAT_STORAGE_PREFIX)}) || key === "centaur.config")) {
          result[key] = localStorage.getItem(key);
        }
      }
      return result;
    })()`, true);
  }

  const createdAt = new Date().toISOString();
  const backupId = createdAt.replace(/[:.]/g, "-");
  const backupRoot = ensureDir(path.join(latestBackupRoot(app.getPath("userData")), backupId));
  writeJson(path.join(backupRoot, "local-storage.json"), {
    schemaVersion: 1,
    createdAt,
    sourceInternalVersion: internalVersion,
    targetInternalVersion: release.internalVersion,
    items
  });
  writeJson(path.join(backupRoot, "update.json"), {
    releaseId: release.releaseId,
    displayVersion: release.displayVersion,
    internalVersion: release.internalVersion,
    createdAt
  });

  const sessionPath = path.join(app.getPath("userData"), "dingtalk-sessions.json");
  if (fs.existsSync(sessionPath)) fs.copyFileSync(sessionPath, path.join(backupRoot, "dingtalk-sessions.json"));
  writeJson(path.join(latestBackupRoot(app.getPath("userData")), "latest.json"), { backupId, createdAt });
  pruneBackups(app.getPath("userData"));
  return backupRoot;
}

function inspectAuthenticode(filePath) {
  if (process.platform !== "win32") return { valid: false, status: "Unsupported" };
  const escaped = String(filePath).replace(/'/g, "''");
  const script = `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'; [PSCustomObject]@{Status=[string]$signature.Status; Subject=[string]$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000
  });
  if (result.status !== 0) return { valid: false, status: "Unknown", subject: "" };
  const parsed = JSON.parse(String(result.stdout || "{}").trim() || "{}");
  return { valid: parsed.Status === "Valid", status: parsed.Status || "Unknown", subject: parsed.Subject || "" };
}

async function verifyReleaseInstaller(filePath, release, options = {}) {
  if (!fs.existsSync(filePath)) throw new Error("本地没有已下载的安装包");
  const expectedSize = Number(release?.size || 0);
  if (expectedSize > 0 && fs.statSync(filePath).size !== expectedSize) throw new Error("安装包大小不一致");
  const digest = await sha256File(filePath);
  if (digest.toLowerCase() !== String(release?.sha256 || "").toLowerCase()) throw new Error("安装包 SHA-256 校验失败");
  const inspectSignature = options.inspectSignature || inspectAuthenticode;
  const signature = inspectSignature(filePath);
  if (options.requireCodeSignature && !signature.valid) throw new Error(`安装包数字签名无效：${signature.status}`);
  if (options.expectedPublisher && !String(signature.subject || "").includes(options.expectedPublisher)) {
    throw new Error("安装包发布者与公司配置不一致");
  }
  return { digest, signature };
}

async function reuseVerifiedInstaller(filePath, release, options = {}) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return await verifyReleaseInstaller(filePath, release, options);
  } catch {
    fs.rmSync(filePath, { force: true });
    return null;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseContentRange(value) {
  const match = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? 0 : Number(match[3])
  };
}

function isTransientDownloadError(error) {
  const status = Number(error?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (status >= 400) return false;
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["EACCES", "EBUSY", "ENOSPC", "EPERM", "EROFS"].includes(code)) return false;
  const message = String(error?.message || error).toLowerCase();
  return error?.name === "AbortError"
    || /fetch failed|network|socket|connection|reset|terminated|premature close|aborted|timed out|timeout|下载不完整/.test(message)
    || ["ECONNABORTED", "ECONNRESET", "ENETDOWN", "ENETRESET", "ENETUNREACH", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET"].includes(code);
}

async function downloadFileWithResume({
  url,
  temporaryPath,
  expectedSize = 0,
  fetchImpl = fetch,
  stallTimeoutMs = DOWNLOAD_STALL_TIMEOUT_MS,
  retryMaxDelayMs = DOWNLOAD_RETRY_MAX_DELAY_MS,
  shouldStop = () => false,
  onProgress = () => {},
  onRetry = () => {}
}) {
  ensureDir(path.dirname(temporaryPath));
  let retryCount = 0;
  let resumed = false;

  while (!shouldStop()) {
    let received = fs.existsSync(temporaryPath) ? fs.statSync(temporaryPath).size : 0;
    if (expectedSize > 0 && received > expectedSize) {
      fs.rmSync(temporaryPath, { force: true });
      received = 0;
    }
    if (expectedSize > 0 && received === expectedSize) {
      return { received, total: expectedSize, resumed: resumed || received > 0, retryCount };
    }

    const requestedOffset = received;
    const controller = new AbortController();
    let stallTimer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), Math.max(30000, Number(stallTimeoutMs) || DOWNLOAD_STALL_TIMEOUT_MS));
    };

    try {
      resetStallTimer();
      const headers = { accept: "application/octet-stream" };
      if (requestedOffset > 0) headers.range = `bytes=${requestedOffset}-`;
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      if (response.status === 416 && requestedOffset > 0) {
        fs.rmSync(temporaryPath, { force: true });
        resumed = true;
        continue;
      }
      if (!response.ok || !response.body) {
        const error = new Error(`安装包下载失败：${response.status}`);
        error.status = response.status;
        throw error;
      }

      const contentRange = parseContentRange(response.headers.get("content-range"));
      let append = requestedOffset > 0 && response.status === 206;
      if (append && (!contentRange || contentRange.start !== requestedOffset)) {
        fs.rmSync(temporaryPath, { force: true });
        throw new Error("下载服务器返回的断点位置不一致");
      }
      if (requestedOffset > 0 && response.status === 200) {
        append = false;
        received = 0;
      }

      const responseLength = Number(response.headers.get("content-length") || 0);
      const total = Number(expectedSize || contentRange?.total || (responseLength > 0 ? received + responseLength : 0));
      if (expectedSize > 0 && contentRange?.total > 0 && contentRange.total !== expectedSize) {
        const error = new Error("下载服务器上的安装包大小与发布信息不一致");
        error.status = 409;
        throw error;
      }

      resumed = resumed || append;
      const speedSamples = [{ at: Date.now(), received }];
      let lastProgressAt = 0;
      const publishProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 500) return;
        lastProgressAt = now;
        speedSamples.push({ at: now, received });
        while (speedSamples.length > 2 && now - speedSamples[0].at > 8000) speedSamples.shift();
        const first = speedSamples[0];
        const elapsedMs = Math.max(1, now - first.at);
        const bytesPerSecond = Math.max(0, Math.round(((received - first.received) * 1000) / elapsedMs));
        const remainingSeconds = total > received && bytesPerSecond > 0 ? Math.ceil((total - received) / bytesPerSecond) : 0;
        const percent = total > 0 ? Math.min(99.9, Number(((received / total) * 100).toFixed(1))) : 0;
        onProgress({ received, total, percent, bytesPerSecond, remainingSeconds, resumed, retryCount });
      };
      publishProgress(true);

      const source = Readable.fromWeb(response.body);
      source.on("data", (chunk) => {
        received += chunk.length;
        resetStallTimer();
        publishProgress(false);
      });
      await pipeline(source, fs.createWriteStream(temporaryPath, { flags: append ? "a" : "w" }));
      publishProgress(true);
      if (total > 0 && received !== total) throw new Error(`安装包下载不完整：${received}/${total}`);
      return { received, total, resumed, retryCount };
    } catch (error) {
      if (shouldStop() || !isTransientDownloadError(error)) throw error;
      retryCount += 1;
      const savedBytes = fs.existsSync(temporaryPath) ? fs.statSync(temporaryPath).size : 0;
      const delayMs = Math.min(Math.max(1000, retryMaxDelayMs), 1000 * (2 ** Math.min(retryCount - 1, 5)));
      onRetry({ error, retryCount, delayMs, received: savedBytes, total: Number(expectedSize || 0) });
      await sleep(delayMs);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
  }

  const error = new Error("安装包下载已停止");
  error.code = "DOWNLOAD_STOPPED";
  throw error;
}

function createDesktopUpdater({ app, dialog, Notification, publicKeyPath, configPath, writeDiagnostic = () => {} }) {
  const config = {
    displayVersion: app.getVersion(),
    internalVersion: app.getVersion(),
    channel: "stable-v2",
    baseUrl: "",
    checkOnStart: false,
    pollIntervalMs: 300000,
    eventReconnectMs: 30000,
    deferHours: 24,
    requireCodeSignature: false,
    expectedPublisher: "",
    ...readJson(configPath, {})
  };
  config.baseUrl = normalizeBaseUrl(config.isolatedPreview ? config.baseUrl : (process.env.XIANMA_UPDATE_BASE_URL || config.baseUrl));
  const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");
  const statePath = path.join(app.getPath("userData"), "updates", "state.json");
  let state = readJson(statePath, {});
  let mainWindow = null;
  let stopped = false;
  let pollTimer = null;
  let eventController = null;
  let automaticGeneration = 0;
  let activeReleaseId = "";
  let activeDownloadStatus = null;
  const promptedReleaseIds = new Set();

  const summarizeRelease = (release) => release ? {
    releaseId: String(release.releaseId || ""),
    displayVersion: String(release.displayVersion || ""),
    internalVersion: String(release.internalVersion || ""),
    title: String(release.title || ""),
    notes: String(release.notes || ""),
    publishedAt: String(release.publishedAt || ""),
    size: Number(release.size || 0),
    force: release.force === true
  } : null;
  const recordHistory = (type, release, message = "") => {
    if (!release?.releaseId) return;
    const record = {
      id: `${type}:${release.releaseId}`,
      type,
      at: new Date().toISOString(),
      message: String(message || ""),
      ...summarizeRelease(release)
    };
    const history = Array.isArray(state.updateHistory) ? state.updateHistory : [];
    state.updateHistory = [record, ...history.filter((item) => item?.id !== record.id)].slice(0, 30);
  };

  const saveState = () => writeJson(statePath, state);
  const emit = (status, details = {}) => {
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("desktop:update-status", {
        status,
        availableRelease: state.availableRelease || null,
        updateHistory: Array.isArray(state.updateHistory) ? state.updateHistory : [],
        ...details
      });
    }
  };
  const report = async (status, release = null, details = {}) => {
    if (!config.baseUrl) return;
    const body = {
      status,
      at: new Date().toISOString(),
      currentInternalVersion: config.internalVersion,
      currentDisplayVersion: config.displayVersion,
      targetInternalVersion: release?.internalVersion || "",
      releaseId: release?.releaseId || "",
      platform: process.platform,
      arch: process.arch,
      ...details
    };
    fetch(`${config.baseUrl}/api/app-updates/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).catch(() => {});
  };

  async function fetchLatest() {
    const url = new URL(`${config.baseUrl}/api/app-updates/latest`);
    url.searchParams.set("channel", config.channel);
    url.searchParams.set("platform", process.platform);
    url.searchParams.set("arch", process.arch);
    url.searchParams.set("current", config.internalVersion);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok) throw new Error(`更新服务返回 ${response.status}`);
      return decodeSignedRelease(await response.json(), publicKeyPem);
    } finally {
      clearTimeout(timer);
    }
  }

  async function downloadRelease(release) {
    if (activeReleaseId) return;
    activeReleaseId = release.releaseId;
    const updatesRoot = ensureDir(path.join(app.getPath("userData"), "updates", "downloads"));
    const targetPath = path.join(updatesRoot, `${release.releaseId}-${path.basename(release.fileName)}`);
    const temporaryPath = `${targetPath}.partial`;

    try {
      const verificationOptions = {
        requireCodeSignature: config.requireCodeSignature,
        expectedPublisher: config.expectedPublisher
      };
      emit("cache-check", { release, percent: 0 });
      let verified = await reuseVerifiedInstaller(targetPath, release, verificationOptions);
      const reusedDownload = Boolean(verified);
      if (verified) {
        emit("cache-hit", { release, path: targetPath, percent: 100 });
        await report("cache-hit", release);
      } else {
        const existingBytes = fs.existsSync(temporaryPath) ? fs.statSync(temporaryPath).size : 0;
        activeDownloadStatus = { status: "download-start", release, received: existingBytes, total: Number(release.size || 0), percent: release.size > 0 ? Number(((existingBytes / release.size) * 100).toFixed(1)) : 0 };
        emit("download-start", activeDownloadStatus);
        await report("download-start", release);
        const downloadUrl = new URL(String(release.downloadPath).replace(/^\/+/, ""), `${config.baseUrl}/`);
        if (config.isolatedPreview && !downloadUrl.href.startsWith(`${config.baseUrl}/`)) throw new Error("测试版禁止下载其他环境的安装包");
        await downloadFileWithResume({
          url: downloadUrl,
          temporaryPath,
          expectedSize: Number(release.size || 0),
          shouldStop: () => stopped,
          onProgress: (progress) => {
            activeDownloadStatus = { status: "download-progress", release, ...progress };
            emit("download-progress", activeDownloadStatus);
          },
          onRetry: ({ error, ...retry }) => {
            const total = Number(retry.total || release.size || 0);
            const percent = total > 0 ? Math.min(99.9, Number(((retry.received / total) * 100).toFixed(1))) : 0;
            activeDownloadStatus = { status: "download-retry", release, ...retry, total, percent, message: String(error?.message || error) };
            emit("download-retry", activeDownloadStatus);
            writeDiagnostic("update-download-retry", { releaseId: release.releaseId, retryCount: retry.retryCount, received: retry.received, message: String(error?.message || error).slice(0, 240) });
          }
        });
        try {
          verified = await verifyReleaseInstaller(temporaryPath, release, verificationOptions);
        } catch (error) {
          // A complete package that fails integrity checks cannot be resumed safely.
          fs.rmSync(temporaryPath, { force: true });
          throw error;
        }
        fs.rmSync(targetPath, { force: true });
        fs.renameSync(temporaryPath, targetPath);
      }

      await createPreUpdateBackup({ app, mainWindow, release, internalVersion: config.internalVersion });
      recordHistory("downloaded", release, reusedDownload ? "已复用本地安装包" : "安装包下载完成");
      state = {
        ...state,
        lastDownloadedReleaseId: release.releaseId,
        lastDownloadAt: new Date().toISOString(),
        pendingInstall: summarizeRelease(release),
        updateHistory: state.updateHistory
      };
      saveState();
      emit("downloaded", { release, path: targetPath, percent: 100, reusedDownload });
      await report("downloaded", release, { authenticodeStatus: verified.signature.status, reusedDownload });

      const logPath = path.join(app.getPath("userData"), "updates", `install-${release.releaseId}.log`);
      const child = spawn(targetPath, [
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/CLOSEAPPLICATIONS",
        "/AUTOUPDATE=1",
        `/LOG=${logPath}`
      ], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      recordHistory("installing", release, "安装程序已经启动");
      saveState();
      await report("install-start", release);
      setTimeout(() => app.quit(), 500);
    } catch (error) {
      if (state.pendingInstall?.releaseId === release.releaseId) state.pendingInstall = null;
      recordHistory("failed", release, String(error?.message || error).slice(0, 300));
      saveState();
      writeDiagnostic("update-error", { releaseId: release.releaseId, message: String(error?.message || error).slice(0, 300) });
      emit("error", { release, message: String(error?.message || error) });
      await report("failed", release, { message: String(error?.message || error).slice(0, 300) });
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "更新未完成",
          message: "新版本暂时无法安装",
          detail: `${String(error?.message || error)}\n\n你的对话和本地文件没有被删除，可以稍后重试。`,
          buttons: ["知道了"],
          noLink: true
        });
      }
    } finally {
      activeReleaseId = "";
      activeDownloadStatus = null;
    }
  }

  async function promptForRelease(release, manual) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!manual && promptedReleaseIds.has(release.releaseId)) return;
    promptedReleaseIds.add(release.releaseId);
    emit("available", { release });
    await report("available", release);

    const buttons = release.force ? ["立即更新", "退出软件"] : ["立即更新", "稍后提醒"];
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "发现新版本",
      message: `XMAI Studio ${release.displayVersion}`,
      detail: [release.title, release.notes].filter(Boolean).join("\n\n") || "有一个新版本可以安装。",
      buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) {
      await downloadRelease(release);
      return;
    }
    if (release.force) {
      app.quit();
      return;
    }
    state = {
      ...state,
      deferredReleaseId: release.releaseId,
      deferUntil: Date.now() + Math.max(1, Number(config.deferHours || 24)) * 60 * 60 * 1000
    };
    recordHistory("deferred", release, "用户选择稍后提醒");
    saveState();
    await report("deferred", release);
  }

  async function checkForUpdates({ manual = false, showDialogs = manual } = {}) {
    if (!config.baseUrl) {
      if (manual) throw new Error("尚未配置公司更新服务");
      return { available: false, reason: "disabled" };
    }
    try {
      emit("checking", { manual });
      const release = await fetchLatest();
      if (!release || compareVersions(release.internalVersion, config.internalVersion) <= 0) {
        state = {
          ...state,
          lastCheckedAt: new Date().toISOString(),
          lastCheckStatus: "current",
          availableDisplayVersion: "",
          availableInternalVersion: "",
          availableRelease: null
        };
        saveState();
        emit("not-available", { manual, displayVersion: config.displayVersion });
        if (manual && showDialogs && mainWindow && !mainWindow.isDestroyed()) {
          await dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "检查更新",
            message: "当前已经是最新版本",
            detail: `XMAI Studio ${config.displayVersion}`,
            buttons: ["知道了"],
            noLink: true
          });
        }
        return { available: false };
      }
      const deferred = !manual && state.deferredReleaseId === release.releaseId && Number(state.deferUntil || 0) > Date.now();
      recordHistory("available", release, "检测到新版本");
      state = {
        ...state,
        lastCheckedAt: new Date().toISOString(),
        lastCheckStatus: "available",
        availableDisplayVersion: release.displayVersion,
        availableInternalVersion: release.internalVersion,
        availableRelease: summarizeRelease(release),
        updateHistory: state.updateHistory
      };
      saveState();
      if (!deferred || release.force) await promptForRelease(release, manual);
      return { available: true, release };
    } catch (error) {
      writeDiagnostic("update-check-error", { message: String(error?.message || error).slice(0, 300) });
      state = { ...state, lastCheckedAt: new Date().toISOString(), lastCheckStatus: "error" };
      saveState();
      emit("check-error", { manual, message: String(error?.message || error) });
      if (manual && showDialogs && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "暂时无法检查更新",
          message: "没有连接到公司更新服务",
          detail: String(error?.message || error),
          buttons: ["知道了"],
          noLink: true
        });
      }
      return { available: false, error: String(error?.message || error) };
    }
  }

  async function eventLoop(generation) {
    while (!stopped && state.autoCheckEnabled !== false && generation === automaticGeneration && config.baseUrl) {
      eventController = new AbortController();
      try {
        const url = new URL(`${config.baseUrl}/api/app-updates/events`);
        url.searchParams.set("channel", config.channel);
        url.searchParams.set("platform", process.platform);
        url.searchParams.set("arch", process.arch);
        const response = await fetch(url, { headers: { accept: "text/event-stream" }, signal: eventController.signal });
        if (!response.ok || !response.body) throw new Error(`更新事件服务返回 ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (!stopped && state.autoCheckEnabled !== false && generation === automaticGeneration) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const events = pending.split("\n\n");
          pending = events.pop() || "";
          if (events.some((event) => event.split("\n").some((line) => line.startsWith("data:")))) {
            checkForUpdates().catch(() => {});
          }
        }
      } catch (error) {
        if (!stopped && error?.name !== "AbortError") {
          writeDiagnostic("update-events-error", { message: String(error?.message || error).slice(0, 240) });
        }
      }
      if (!stopped && state.autoCheckEnabled !== false && generation === automaticGeneration) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(5000, Number(config.eventReconnectMs || 30000))));
      }
    }
  }

  function stopAutomaticChecks() {
    automaticGeneration += 1;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    eventController?.abort();
    eventController = null;
  }

  function startAutomaticChecks({ checkNow = false } = {}) {
    stopAutomaticChecks();
    if (stopped || state.autoCheckEnabled === false || !config.baseUrl) return;
    const generation = automaticGeneration;
    if (checkNow) setTimeout(() => checkForUpdates().catch(() => {}), 200);
    pollTimer = setInterval(() => checkForUpdates().catch(() => {}), Math.max(60000, Number(config.pollIntervalMs || 300000)));
    eventLoop(generation).catch(() => {});
  }

  function start(window) {
    mainWindow = window;
    stopped = false;
    let stateChanged = false;
    if (state.pendingInstall?.internalVersion && compareVersions(config.internalVersion, state.pendingInstall.internalVersion) >= 0) {
      recordHistory("installed", state.pendingInstall, "更新完成并已启动新版本");
      state = {
        ...state,
        pendingInstall: null,
        availableDisplayVersion: "",
        availableInternalVersion: "",
        availableRelease: null,
        lastCheckStatus: "current",
        updateHistory: state.updateHistory
      };
      stateChanged = true;
    }
    const availableInternalVersion = state.availableRelease?.internalVersion || state.availableInternalVersion || "";
    if (availableInternalVersion && compareVersions(config.internalVersion, availableInternalVersion) >= 0) {
      state = {
        ...state,
        deferredReleaseId: "",
        deferUntil: 0,
        availableDisplayVersion: "",
        availableInternalVersion: "",
        availableRelease: null,
        lastCheckStatus: "current"
      };
      stateChanged = true;
    }
    if (stateChanged) {
      saveState();
    }
    if (typeof state.autoCheckEnabled !== "boolean") {
      state.autoCheckEnabled = config.checkOnStart !== false;
      saveState();
    }
    report("client-start").catch(() => {});
    startAutomaticChecks({ checkNow: config.checkOnStart });
  }

  function setWindow(window) {
    mainWindow = window;
  }

  function stop() {
    stopped = true;
    stopAutomaticChecks();
  }

  function getStatus() {
    return {
      supported: true,
      displayVersion: config.displayVersion,
      internalVersion: config.internalVersion,
      autoCheckEnabled: state.autoCheckEnabled !== false,
      status: activeDownloadStatus?.status || (activeReleaseId ? "download-start" : (state.lastCheckStatus || "idle")),
      lastCheckedAt: state.lastCheckedAt || "",
      availableDisplayVersion: state.availableDisplayVersion || "",
      availableRelease: state.availableRelease || null,
      updateHistory: Array.isArray(state.updateHistory) ? state.updateHistory : [],
      ...(activeDownloadStatus || {})
    };
  }

  function setAutoCheckEnabled(enabled) {
    state = { ...state, autoCheckEnabled: enabled === true };
    saveState();
    if (state.autoCheckEnabled) startAutomaticChecks({ checkNow: true });
    else stopAutomaticChecks();
    emit("settings-changed", getStatus());
    return getStatus();
  }

  return {
    config: { ...config },
    start,
    stop,
    setWindow,
    checkForUpdates,
    getStatus,
    setAutoCheckEnabled
  };
}

module.exports = {
  compareVersions,
  createDesktopUpdater,
  createPreUpdateBackup,
  decodeSignedRelease,
  downloadFileWithResume,
  readLatestChatBackup,
  reuseVerifiedInstaller,
  verifyReleaseInstaller,
  sha256File
};
