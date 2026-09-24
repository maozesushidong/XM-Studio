"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { readReleaseMetadata } = require("./release-version");

const projectRoot = path.resolve(__dirname, "..");
const { releaseVersion } = readReleaseMetadata(projectRoot);
const baseUrl = String(process.env.XIANMA_UPDATE_BASE_URL || "http://47.96.184.148/xianma-updates").replace(/\/+$/, "");
const adminToken = String(process.env.XIANMA_UPDATE_ADMIN_TOKEN || "").trim();
const installerPath = path.resolve(process.argv[2] || "");
const displayVersion = String(process.argv[3] || releaseVersion);
const internalVersion = String(process.argv[4] || displayVersion);
const channel = String(process.argv[5] || "stable-v2");
const releaseTitle = String(process.env.XIANMA_UPDATE_RELEASE_TITLE || `XMAI Studio ${displayVersion}`).trim();
const releaseNotes = String(process.env.XIANMA_UPDATE_RELEASE_NOTES || [
  "1. 新增公司技能创建、提交审核、公司技能库、安装与自动同步能力",
  "2. 对话框新增浏览器操作选项，支持网页打开、点击、输入、选择和连续任务",
  "3. 完善 GitHub 技能识别与安装，兼容仓库根目录和子目录技能",
  "4. 升级后继续使用原有会话、钉钉登录、技能和用户文件",
  "5. 应用名称统一为 XMAI Studio，并完善操作说明和界面体验"
].join("\n")).trim();
const resumePath = path.join(path.dirname(installerPath), `.${path.basename(installerPath)}.upload.json`);

if (!adminToken) throw new Error("XIANMA_UPDATE_ADMIN_TOKEN is required");
if (!fs.existsSync(installerPath)) throw new Error(`installer not found: ${installerPath}`);

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(options.body && !Buffer.isBuffer(options.body) ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let value = {};
  try { value = JSON.parse(text || "{}"); } catch {}
  if (!response.ok) throw new Error(value.error || `${response.status}: ${text.slice(0, 200)}`);
  return value;
}

function fingerprint(filePath) {
  const stat = fs.statSync(filePath);
  const sampleSize = Math.min(1024 * 1024, stat.size);
  const handle = fs.openSync(filePath, "r");
  try {
    const first = Buffer.alloc(sampleSize);
    const last = Buffer.alloc(sampleSize);
    fs.readSync(handle, first, 0, sampleSize, 0);
    fs.readSync(handle, last, 0, sampleSize, Math.max(0, stat.size - sampleSize));
    return crypto.createHash("sha256").update(path.basename(filePath)).update(String(stat.size)).update(first).update(last).digest("hex");
  } finally {
    fs.closeSync(handle);
  }
}

function readChunk(filePath, start, length) {
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytes = fs.readSync(handle, buffer, 0, length, start);
    return bytes === length ? buffer : buffer.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
}

async function main() {
  const stat = fs.statSync(installerPath);
  const fileFingerprint = fingerprint(installerPath);
  let resumeId = "";
  try {
    const stored = JSON.parse(fs.readFileSync(resumePath, "utf8"));
    if (stored.fileFingerprint === fileFingerprint && stored.internalVersion === internalVersion && stored.channel === channel) resumeId = stored.uploadId;
  } catch {}
  const metadata = {
    displayVersion,
    internalVersion,
    title: releaseTitle,
    notes: releaseNotes,
    force: false,
    fileName: path.basename(installerPath),
    fileSize: stat.size,
    fileFingerprint,
    channel,
    platform: "win32",
    arch: "x64",
    resumeId
  };
  const session = await requestJson("/api/admin/releases/uploads", { method: "POST", body: JSON.stringify(metadata) });
  fs.writeFileSync(resumePath, JSON.stringify({ uploadId: session.uploadId, fileFingerprint, internalVersion, channel }, null, 2), "utf8");
  const uploaded = new Set(session.uploadedChunks || []);
  const pending = Array.from({ length: session.chunkCount }, (_, index) => index).filter((index) => !uploaded.has(index));
  let cursor = 0;
  let completed = uploaded.size;
  async function worker() {
    while (cursor < pending.length) {
      const index = pending[cursor++];
      const start = index * session.chunkSize;
      const chunk = readChunk(installerPath, start, Math.min(session.chunkSize, stat.size - start));
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
          await requestJson(`/api/admin/releases/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream", "content-length": String(chunk.length) },
            body: chunk
          });
          completed += 1;
          process.stdout.write(`uploaded ${completed}/${session.chunkCount}\n`);
          break;
        } catch (error) {
          if (attempt === 6) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(12000, 1000 * (2 ** (attempt - 1)))));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, pending.length)) }, worker));
  const result = await requestJson(`/api/admin/releases/uploads/${encodeURIComponent(session.uploadId)}/complete`, { method: "POST" });
  fs.rmSync(resumePath, { force: true });
  process.stdout.write(`${JSON.stringify({ published: true, release: result.release })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
