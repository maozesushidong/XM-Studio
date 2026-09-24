"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const runId = process.env.XIANMA_MEMORY_TEST_ID || Date.now().toString(36);
const sourceRoot = path.join(__dirname, "build", `smoke-memory-source-${runId}`);
const targetRoot = path.join(__dirname, "build", `smoke-memory-target-${runId}`);
const readerPath = path.join(__dirname, "electron", "legacy-profile-reader.html");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`${label}超时`);
}

if (process.argv.includes("--seed")) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  app.setPath("userData", sourceRoot);
  app.whenReady().then(async () => {
    const seedWindow = new BrowserWindow({ show: false });
    await seedWindow.loadFile(readerPath);
    await seedWindow.webContents.executeJavaScript(`(() => {
      const makeState = (id, title, text) => ({
        config: { autoLogin: true },
        conversations: [{
          id,
          title,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:01:00.000Z",
          messages: [{ role: "user", content: text }]
        }],
        activeConversationId: id,
        activeView: "chat"
      });
      localStorage.setItem("centaur.desktop.chat.v3", JSON.stringify(makeState("chat-from-100", "1.0.0 历史窗口", "历史内容")));
      localStorage.setItem("centaur.desktop.chat.v3:another-user", JSON.stringify(makeState("chat-other-user", "另一用户窗口", "隔离内容")));
    })()`);
    await seedWindow.webContents.session.flushStorageData();
    fs.mkdirSync(path.join(sourceRoot, "users", "development-user", "files"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "users", "development-user", "files", "历史文件.txt"), "保留", "utf8");
    seedWindow.destroy();
    app.exit(0);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  });
} else {
  fs.mkdirSync(targetRoot, { recursive: true });
  process.env.XIANMA_DEV_AUTH_BYPASS = "1";
  process.env.XIANMA_USER_DATA = targetRoot;
  process.env.XIANMA_LEGACY_USER_DATA_ROOTS = sourceRoot;
  process.env.XIANMA_LEGACY_USER_DATA_ONLY = "1";
  app.setPath("userData", targetRoot);
  require("./electron/main.js");

  app.whenReady().then(async () => {
    const mainWindow = await waitFor(() => BrowserWindow.getAllWindows().find((window) => window.isVisible()), "主窗口创建");
    if (mainWindow.webContents.isLoading()) {
      await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
    }
    await waitFor(async () => mainWindow.webContents.executeJavaScript(`(() => {
      const saved = JSON.parse(localStorage.getItem("centaur.desktop.chat.v3:development-user") || "null");
      return saved?.conversations?.some((conversation) => conversation.id === "chat-from-100");
    })()`), "旧会话恢复");

    const result = await mainWindow.webContents.executeJavaScript(`(() => {
      const current = JSON.parse(localStorage.getItem("centaur.desktop.chat.v3:development-user") || "null");
      const other = JSON.parse(localStorage.getItem("centaur.desktop.chat.v3:another-user") || "null");
      return {
        currentConversationIds: current?.conversations?.map((conversation) => conversation.id) || [],
        otherConversationIds: other?.conversations?.map((conversation) => conversation.id) || [],
        ownerRecorded: Boolean(localStorage.getItem("centaur.desktop.chat.legacy-owner.v1"))
      };
    })()`);
    const copiedFile = path.join(targetRoot, "users", "development-user", "files", "历史文件.txt");
    const importStore = path.join(targetRoot, "memory-migration", "legacy-profile-imports.json");
    const sourceLevelDb = path.join(sourceRoot, "Local Storage", "leveldb");
    if (!result.currentConversationIds.includes("chat-from-100")) throw new Error("1.0.0 全局会话未恢复");
    if (!result.otherConversationIds.includes("chat-other-user")) throw new Error("其他用户会话键未保留");
    if (!result.ownerRecorded) throw new Error("旧全局会话没有记录归属，可能串用户");
    if (!fs.existsSync(copiedFile)) throw new Error("旧用户文件未恢复");
    if (!fs.existsSync(importStore)) throw new Error("旧资料目录导入快照不存在");
    if (!fs.existsSync(sourceLevelDb)) throw new Error("旧版原始数据库被删除");

    process.stdout.write(`${JSON.stringify({
      memoryMigration: true,
      fromVersion: "1.0.0",
      conversationsRestored: result.currentConversationIds.length,
      multiUserKeysPreserved: true,
      userFilesRestored: true,
      sourceDatabasePreserved: true
    })}\n`);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(0);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    app.exit(1);
  });
}
