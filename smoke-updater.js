"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  compareVersions,
  createDesktopUpdater,
  createPreUpdateBackup,
  decodeSignedRelease,
  downloadFileWithResume,
  readLatestChatBackup,
  reuseVerifiedInstaller,
  sha256File
} = require("./electron/updater");

async function main() {
  assert.strictEqual(compareVersions("1.4.55", "1.4.54"), 1);
  assert.strictEqual(compareVersions("1.4.54", "1.4.54"), 0);
  assert.strictEqual(compareVersions("1.0.1", "1.4.53"), -1);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1,
    releaseId: "1.4.55-test",
    channel: "stable",
    platform: "win32",
    arch: "x64",
    displayVersion: "1.0.2",
    internalVersion: "1.4.55",
    title: "测试更新",
    notes: "验证签名",
    force: false,
    publishedAt: new Date().toISOString(),
    fileName: "先马·AI Studio Setup 1.0.2.exe",
    size: 2048,
    sha256: "a".repeat(64),
    downloadPath: "downloads/1.4.55-test/update.exe"
  };
  const signed = Buffer.from(JSON.stringify(payload));
  const envelope = {
    signed: signed.toString("base64url"),
    signature: crypto.sign(null, signed, privateKey).toString("base64url")
  };
  assert.deepStrictEqual(decodeSignedRelease(envelope, publicKey), payload);
  assert.throws(() => decodeSignedRelease({ ...envelope, signature: Buffer.alloc(64).toString("base64url") }, publicKey), /签名无效/);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-updater-"));
  try {
    const samplePath = path.join(temporaryRoot, "sample.bin");
    fs.writeFileSync(samplePath, Buffer.from("先马·AI Studio update verification", "utf8"));
    const sampleSha256 = crypto.createHash("sha256").update(fs.readFileSync(samplePath)).digest("hex");
    assert.strictEqual(await sha256File(samplePath), sampleSha256);
    const reusable = await reuseVerifiedInstaller(samplePath, { size: fs.statSync(samplePath).size, sha256: sampleSha256 }, {
      inspectSignature: () => ({ valid: false, status: "NotSigned", subject: "" })
    });
    assert.strictEqual(reusable.digest, sampleSha256);
    const invalidCachePath = path.join(temporaryRoot, "invalid-cache.bin");
    fs.writeFileSync(invalidCachePath, Buffer.from("invalid cache"));
    assert.strictEqual(await reuseVerifiedInstaller(invalidCachePath, { size: 999, sha256: "0".repeat(64) }), null);
    assert.strictEqual(fs.existsSync(invalidCachePath), false);

    const completeDownload = Buffer.from("先马更新断点续传验证：已下载部分 + 剩余部分", "utf8");
    const partialLength = Math.floor(completeDownload.length / 2);
    const resumedDownloadPath = path.join(temporaryRoot, "resume-update.exe.partial");
    fs.writeFileSync(resumedDownloadPath, completeDownload.subarray(0, partialLength));
    let requestedRange = "";
    let latestProgress = null;
    const resumedDownload = await downloadFileWithResume({
      url: "https://updates.example.test/resume-update.exe",
      temporaryPath: resumedDownloadPath,
      expectedSize: completeDownload.length,
      fetchImpl: async (_url, options) => {
        requestedRange = String(options?.headers?.range || "");
        return new Response(completeDownload.subarray(partialLength), {
          status: 206,
          headers: {
            "content-length": String(completeDownload.length - partialLength),
            "content-range": `bytes ${partialLength}-${completeDownload.length - 1}/${completeDownload.length}`
          }
        });
      },
      onProgress: (progress) => { latestProgress = progress; }
    });
    assert.strictEqual(requestedRange, `bytes=${partialLength}-`);
    assert.deepStrictEqual(fs.readFileSync(resumedDownloadPath), completeDownload);
    assert.strictEqual(resumedDownload.resumed, true);
    assert.strictEqual(latestProgress.received, completeDownload.length);
    assert.strictEqual(latestProgress.total, completeDownload.length);

    const backupRoot = path.join(temporaryRoot, "update-backups", "2026-test");
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, "update-backups", "latest.json"), JSON.stringify({ backupId: "2026-test", createdAt: "2026-07-29T00:00:00.000Z" }));
    fs.writeFileSync(path.join(backupRoot, "local-storage.json"), JSON.stringify({ items: { "centaur.desktop.chat.v3:user": "{}" } }));
    assert.strictEqual(readLatestChatBackup(temporaryRoot).items["centaur.desktop.chat.v3:user"], "{}");

    fs.writeFileSync(path.join(temporaryRoot, "dingtalk-sessions.json"), JSON.stringify({ currentUserId: "user" }));
    const backupPath = await createPreUpdateBackup({
      app: { getPath: (name) => name === "userData" ? temporaryRoot : temporaryRoot },
      mainWindow: {
        webContents: {
          isDestroyed: () => false,
          session: { flushStorageData: () => undefined },
          executeJavaScript: async () => ({ "centaur.desktop.chat.v3:user": "{\"conversations\":[{\"id\":\"chat-1\"}]}" })
        }
      },
      release: { releaseId: "1.4.55-backup", displayVersion: "1.0.2", internalVersion: "1.4.55" },
      internalVersion: "1.4.54"
    });
    assert.strictEqual(fs.existsSync(path.join(backupPath, "dingtalk-sessions.json")), true);
    assert.strictEqual(readLatestChatBackup(temporaryRoot).items["centaur.desktop.chat.v3:user"].includes("chat-1"), true);

    const updaterPublicKeyPath = path.join(temporaryRoot, "updater-public.pem");
    const updaterConfigPath = path.join(temporaryRoot, "updater-config.json");
    fs.mkdirSync(path.join(temporaryRoot, "updates"), { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, "updates", "state.json"), JSON.stringify({
      pendingInstall: { releaseId: "installed-test", displayVersion: "1.0.1", internalVersion: "1.4.54", title: "安装测试" }
    }));
    fs.writeFileSync(updaterPublicKeyPath, publicKey.export({ type: "spki", format: "pem" }));
    fs.writeFileSync(updaterConfigPath, JSON.stringify({ displayVersion: "1.0.1", internalVersion: "1.4.54", baseUrl: "", checkOnStart: true }));
    const updater = createDesktopUpdater({
      app: { getVersion: () => "1.0.1", getPath: () => temporaryRoot, quit: () => {} },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      Notification: class {},
      publicKeyPath: updaterPublicKeyPath,
      configPath: updaterConfigPath
    });
    updater.start(null);
    assert.strictEqual(updater.getStatus().autoCheckEnabled, true);
    assert.strictEqual(updater.getStatus().updateHistory[0].type, "installed");
    assert.strictEqual(updater.setAutoCheckEnabled(false).autoCheckEnabled, false);
    assert.strictEqual(updater.setAutoCheckEnabled(true).autoCheckEnabled, true);
    updater.stop();

    fs.writeFileSync(path.join(temporaryRoot, "updates", "state.json"), JSON.stringify({
      availableDisplayVersion: "2.0.3",
      availableInternalVersion: "2.0.3",
      availableRelease: { releaseId: "already-installed", displayVersion: "2.0.3", internalVersion: "2.0.3" },
      lastCheckStatus: "available"
    }));
    fs.writeFileSync(updaterConfigPath, JSON.stringify({ displayVersion: "2.0.3", internalVersion: "2.0.3", baseUrl: "", checkOnStart: false }));
    const currentUpdater = createDesktopUpdater({
      app: { getVersion: () => "2.0.3", getPath: () => temporaryRoot, quit: () => {} },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      Notification: class {},
      publicKeyPath: updaterPublicKeyPath,
      configPath: updaterConfigPath
    });
    currentUpdater.start(null);
    assert.strictEqual(currentUpdater.getStatus().availableRelease, null);
    assert.strictEqual(currentUpdater.getStatus().status, "current");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  process.stdout.write("updater smoke test passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
