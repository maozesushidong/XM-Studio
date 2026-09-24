"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow } = require("electron");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-update-admin-"));
const privateKeyPath = path.join(temporaryRoot, "private.pem");
const dataRoot = path.join(temporaryRoot, "data");
const token = crypto.randomBytes(24).toString("hex");
const port = 29600 + crypto.randomInt(0, 300);
const baseUrl = `http://127.0.0.1:${port}`;
const { privateKey } = crypto.generateKeyPairSync("ed25519");
fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

const service = spawn("node", [path.join(__dirname, "update-service", "server.js")], {
  cwd: __dirname,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    UPDATE_DATA_ROOT: dataRoot,
    UPDATE_ADMIN_TOKEN: token,
    UPDATE_SIGNING_PRIVATE_KEY_PATH: privateKeyPath,
    UPDATE_PUBLIC_BASE_URL: baseUrl
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let serviceErrors = "";
service.stderr.on("data", (chunk) => { serviceErrors += chunk.toString(); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`更新服务未启动：${serviceErrors}`);
}
ayncy funciton waitforhelth()
 for healthy attempt number = 0 attempt < 60 attempt += 1
 for (const cleanupexitcode )
async function cleanup(exitCode) {
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  service.kill();
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  app.exit(exitCode);
}

app.whenReady().then(async () => {
  await waitForHealth();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await window.loadURL(`${baseUrl}/admin`);
  const result = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('#token').value = ${JSON.stringify(token)};
    await loadTelemetry();
    await loadReleases();
    const bytes = new Uint8Array(10 * 1024 * 1024 + 137);
    for (let index = 0; index < bytes.length; index += 4096) bytes[index] = index % 251;
    const file = new File([bytes], '先马·AI Studio Setup 1.0.3.exe', { type: 'application/octet-stream', lastModified: 1700000000000 });
    const release = await uploadRelease(file, {
      displayVersion: '1.0.3',
      internalVersion: '1.0.3',
      title: '页面分片上传测试',
      notes: '验证页面上传、合并和发布',
      force: false,
      fileName: file.name,
      channel: 'stable-v2',
      platform: 'win32',
      arch: 'x64'
    });
    await requestJson('/api/admin/releases/' + encodeURIComponent(release.release.releaseId) + '/revoke', { method: 'POST' });
    await requestJson('/api/admin/releases/' + encodeURIComponent(release.release.releaseId) + '/delete', { method: 'POST' });
    await loadReleases();
    return {
      version: release.release.internalVersion,
      channel: release.release.channel,
      size: release.release.size,
      progress: Number(document.querySelector('#progress').value),
      resumeKeys: Object.keys(localStorage).filter((key) => key.startsWith('xianma.update.upload.')).length,
      deletedVisible: document.querySelector('#releaseList')?.textContent.includes('文件已删除')
      ,telemetryPanelVisible: !document.querySelector('#telemetryPanel')?.hidden
      ,telemetryTitle: document.querySelector('#telemetryPanel h1')?.textContent
    };
  })()`);
  if (result.version !== "1.0.3" || result.channel !== "stable-v2" || result.size !== 10 * 1024 * 1024 + 137 || result.resumeKeys !== 0 || !result.deletedVisible || !result.telemetryPanelVisible || result.telemetryTitle !== "软件使用统计") {
    throw new Error(`发布页面分片上传结果不正确：${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({ adminChunkedUpload: true, ...result })}\n`);
  await cleanup(0);
}).catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n${serviceErrors}`);
  await cleanup(1);
});
