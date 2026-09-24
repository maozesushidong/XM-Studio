"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const port = Math.max(1, Number(process.env.PORT || 8080));
const host = String(process.env.HOST || "0.0.0.0");
const dataRoot = path.resolve(process.env.DATA_ROOT || path.join(__dirname, "data"));
const adminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const maximumUploadBytes = Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024));
const chunkSize = Math.min(32 * 1024 * 1024, Math.max(1024 * 1024, Number(process.env.CHUNK_SIZE || 8 * 1024 * 1024)));
const resourcesPath = path.join(dataRoot, "resources.json");
const legacyReleasesPath = path.join(dataRoot, "releases.json");
const filesRoot = path.join(dataRoot, "files");
const uploadsRoot = path.join(dataRoot, "uploads");
const publicRoot = path.join(__dirname, "public");

if (!adminPassword) throw new Error("ADMIN_PASSWORD is required");
fs.mkdirSync(filesRoot, { recursive: true });
fs.mkdirSync(uploadsRoot, { recursive: true });

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function sendText(response, status, value, contentType = "text/plain; charset=utf-8") {
  const body = Buffer.from(String(value), "utf8");
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function readJson(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > limit) {
        request.destroy();
        reject(new Error("请求内容过大"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("请求格式无效"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeResource(item) {
  const payload = item?.payload || item || {};
  const resourceId = safeId(payload.resourceId || payload.releaseId || `legacy-${Date.now()}`);
  const legacyStatus = item?.status === "deleted" ? "deleted" : item?.status === "revoked" ? "disabled" : "published";
  const fileName = safeFileName(payload.fileName || payload.name || "download");
  return {
    resourceId,
    status: payload.status || legacyStatus,
    title: String(payload.title || fileName).trim().slice(0, 160) || fileName,
    description: String(payload.description ?? payload.notes ?? "").slice(0, 20000),
    fileName,
    size: Number.isSafeInteger(Number(payload.size)) ? Number(payload.size) : 0,
    sha256: String(payload.sha256 || "").trim(),
    contentType: safeContentType(payload.contentType || mimeTypeFor(fileName)),
    uploadedAt: payload.uploadedAt || payload.publishedAt || item?.createdAt || new Date().toISOString(),
    downloadPath: `download/${resourceId}`
  };
}

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(resourcesPath, "utf8"));
    return { schemaVersion: 2, resources: Array.isArray(value.resources) ? value.resources.map(normalizeResource) : [] };
  } catch {
    // Keep existing standalone release files available as ordinary resources after the migration.
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyReleasesPath, "utf8"));
      return { schemaVersion: 2, resources: Array.isArray(legacy.releases) ? legacy.releases.map(normalizeResource) : [] };
    } catch {
      return { schemaVersion: 2, resources: [] };
    }
  }
}

function writeStore(store) {
  const temporary = `${resourcesPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 2, resources: store.resources }, null, 2), "utf8");
  fs.renameSync(temporary, resourcesPath);
}

function safeFileName(value) {
  const name = path.basename(String(value || "download"))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();
  return name || "download";
}

function safeId(value) {
  return String(value || "resource").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "resource";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safeContentType(value) {
  const type = String(value || "").trim();
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(type) ? type : "application/octet-stream";
}

function mimeTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return ({
    ".7z": "application/x-7z-compressed",
    ".apk": "application/vnd.android.package-archive",
    ".dmg": "application/x-apple-diskimage",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".msi": "application/x-msi",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".rar": "application/vnd.rar",
    ".txt": "text/plain",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip"
  })[extension] || "application/octet-stream";
}

function isAdmin(request) {
  const value = String(request.headers.authorization || "");
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(adminPassword);
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: "管理密码不正确" });
  return false;
}

function uploadDirectory(uploadId) { return path.join(uploadsRoot, safeId(uploadId)); }
function uploadSessionPath(uploadId) { return path.join(uploadDirectory(uploadId), "session.json"); }
function uploadChunkPath(session, index) { return path.join(uploadDirectory(session.uploadId), `${index}.part`); }
function resourceDirectory(resourceId) { return path.join(filesRoot, safeId(resourceId)); }
function resourceFilePath(resource) { return path.join(resourceDirectory(resource.resourceId), safeFileName(resource.fileName)); }

function validateMetadata(body) {
  const fileName = safeFileName(body?.fileName);
  const fileSize = Number(body?.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error("文件大小无效");
  if (fileSize > maximumUploadBytes) throw new Error("文件超过服务器允许的大小");
  return {
    fileName,
    fileSize,
    title: String(body?.title || fileName).trim().slice(0, 160) || fileName,
    description: String(body?.description || "").slice(0, 20000),
    contentType: safeContentType(body?.contentType || mimeTypeFor(fileName))
  };
}

function uploadChunk(request, targetPath, expectedLength) {
  return new Promise((resolve, reject) => {
    const temporaryPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.uploading`;
    const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
    let bytes = 0;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      output.destroy();
      fs.rmSync(temporaryPath, { force: true });
      reject(error);
    };
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > expectedLength) {
        request.destroy();
        fail(new Error("上传分片大小不正确"));
      }
    });
    request.on("aborted", () => fail(new Error("上传分片中断")));
    request.on("error", fail);
    output.on("error", fail);
    output.on("finish", () => {
      if (failed) return;
      if (bytes !== expectedLength) return fail(new Error("上传分片不完整"));
      fs.rmSync(targetPath, { force: true });
      fs.renameSync(temporaryPath, targetPath);
      resolve(bytes);
    });
    request.pipe(output);
  });
}

function getSession(uploadId) {
  const file = uploadSessionPath(uploadId);
  if (!fs.existsSync(file)) throw new Error("上传会话不存在或已过期");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { throw new Error("资源编号无效"); }
}

function getResource(resourceId) {
  const id = safeId(decodePart(resourceId));
  return readStore().resources.find((item) => item.resourceId === id) || null;
}

function publicDownloadUrl(resourceId) {
  const pathName = `/download/${encodeURIComponent(safeId(resourceId))}`;
  return publicBaseUrl ? `${publicBaseUrl}${pathName}` : pathName;
}

function resourceForClient(resource) {
  return { ...resource, downloadUrl: publicDownloadUrl(resource.resourceId) };
}

function parseRange(value, size) {
  const match = String(value || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

function serveDownload(request, response, resource) {
  const filePath = resourceFilePath(resource);
  if (!fs.existsSync(filePath) || resource.status !== "published") {
    sendJson(response, 404, { error: "资源不存在或已删除" });
    return;
  }
  const stat = fs.statSync(filePath);
  const range = parseRange(request.headers.range, stat.size);
  const fileName = safeFileName(resource.fileName);
  const commonHeaders = {
    "content-type": safeContentType(resource.contentType || mimeTypeFor(fileName)),
    "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff"
  };
  if (range?.invalid || (range && stat.size === 0)) {
    response.writeHead(416, { "content-range": `bytes */${stat.size}` });
    response.end();
    return;
  }
  if (range) {
    const length = range.end - range.start + 1;
    response.writeHead(206, { ...commonHeaders, "content-range": `bytes ${range.start}-${range.end}/${stat.size}`, "content-length": length });
    if (request.method !== "HEAD") fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
    else response.end();
    return;
  }
  response.writeHead(200, { ...commonHeaders, "content-length": stat.size });
  if (request.method !== "HEAD") fs.createReadStream(filePath).pipe(response);
  else response.end();
}

function publicPage() {
  const resources = readStore().resources.filter((item) => item.status === "published" && fs.existsSync(resourceFilePath(item)));
  const cards = resources.length
    ? resources.map((resource) => { const downloadUrl = publicDownloadUrl(resource.resourceId); return `<article class="resource"><div class="resource-copy"><p class="resource-kind">可下载资源</p><h2>${escapeHtml(resource.title)}</h2><p class="file-name">${escapeHtml(resource.fileName)} · ${formatBytes(resource.size)}</p>${resource.description ? `<p class="description">${escapeHtml(resource.description)}</p>` : ""}</div><div class="resource-actions"><a class="download" href="${escapeHtml(downloadUrl)}">下载文件</a><button class="copy" type="button" data-download-url="${escapeHtml(downloadUrl)}">复制地址</button></div></article>`; }).join("")
    : `<div class="empty"><strong>暂无可下载资源</strong><span>管理员上传文件后，下载链接会显示在这里。</span></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XMAI 文件下载中心</title><style>${publicCss}</style></head><body><main class="page"><header><div class="brand"><span class="brand-mark">X</span><div><p class="eyebrow">XMAI Studio</p><h1>文件下载中心</h1></div></div><p class="intro">客户端下载与其他软件资源</p></header><section class="resource-list">${cards}</section></main><script>document.addEventListener("click",async(event)=>{const button=event.target.closest("[data-download-url]");if(!button)return;const value=button.dataset.downloadUrl;try{await navigator.clipboard.writeText(value)}catch{const input=document.createElement("textarea");input.value=value;input.style.position="fixed";input.style.opacity="0";document.body.appendChild(input);input.select();document.execCommand("copy");input.remove()}const original=button.textContent;button.textContent="已复制";setTimeout(()=>{button.textContent=original},1600)});</script></body></html>`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const publicCss = `:root{font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#162536;background:#f7f8fa}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f8fa}.page{width:min(900px,calc(100% - 40px));margin:0 auto;padding:64px 0 80px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-bottom:30px;border-bottom:1px solid #e0e5eb}.brand{display:flex;align-items:center;gap:14px}.brand-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#c52d39;color:#fff;font-size:20px;font-weight:800}.eyebrow,.resource-kind{margin:0 0 6px;color:#c52d39;font-size:12px;font-weight:800;letter-spacing:.08em}.brand h1{margin:0;font-size:30px;line-height:1.2}.intro{margin:0;color:#687787;font-size:14px}.resource-list{display:grid;gap:14px;padding-top:24px}.resource{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px 26px;background:#fff;border:1px solid #e0e5eb;border-radius:10px;box-shadow:0 5px 18px rgba(24,38,54,.04)}.resource h2{margin:0 0 8px;font-size:19px}.resource-kind{margin-bottom:9px}.file-name,.description{margin:0;color:#687787;font-size:13px;line-height:1.7}.description{margin-top:7px;white-space:pre-wrap}.resource-actions{display:flex;align-items:center;gap:9px;flex:none}.download,.copy{display:inline-flex;align-items:center;justify-content:center;min-width:104px;padding:11px 16px;border-radius:7px;font:inherit;font-size:14px;font-weight:700;white-space:nowrap}.download{background:#c52d39;color:#fff;text-decoration:none}.download:hover{background:#a92530}.copy{border:1px solid #cbd6e0;background:#fff;color:#344f68;cursor:pointer}.copy:hover{background:#f7f9fb}.empty{display:grid;gap:8px;padding:48px 24px;text-align:center;color:#687787}.empty strong{color:#344758;font-size:17px}.empty span{font-size:13px}@media(max-width:640px){.page{width:calc(100% - 28px);padding-top:34px}header{display:block}.intro{margin-top:14px}.resource{display:block;padding:20px}.resource-actions{margin-top:18px}.download,.copy{flex:1;min-width:0}.brand h1{font-size:26px}}`;

async function completeUpload(request, response, uploadId) {
  let session;
  try { session = getSession(uploadId); } catch (error) { sendJson(response, 404, { error: error.message }); return; }
  const resourceId = safeId(session.uploadId);
  const temporaryPath = path.join(filesRoot, `${resourceId}.${crypto.randomBytes(6).toString("hex")}.uploading`);
  const targetDirectory = resourceDirectory(resourceId);
  const targetPath = path.join(targetDirectory, safeFileName(session.fileName));
  let output = null;
  let committed = false;
  try {
    fs.mkdirSync(targetDirectory, { recursive: true });
    output = fs.openSync(temporaryPath, "wx");
    const hash = crypto.createHash("sha256");
    let total = 0;
    for (let index = 0; index < session.chunkCount; index += 1) {
      const part = uploadChunkPath(session, index);
      const expected = index === session.chunkCount - 1 ? session.fileSize - (index * session.chunkSize) : session.chunkSize;
      if (!fs.existsSync(part) || fs.statSync(part).size !== expected) throw new Error(`文件尚未上传完整，还缺少第 ${index + 1} 个分片`);
      const bytes = fs.readFileSync(part);
      fs.writeSync(output, bytes);
      hash.update(bytes);
      total += bytes.length;
    }
    fs.closeSync(output);
    output = null;
    if (total !== session.fileSize) throw new Error("文件合并后大小不一致");
    fs.renameSync(temporaryPath, targetPath);
    const uploadedAt = new Date().toISOString();
    const resource = {
      resourceId,
      status: "published",
      title: session.title,
      description: session.description,
      fileName: safeFileName(session.fileName),
      size: total,
      sha256: hash.digest("hex"),
      contentType: session.contentType,
      uploadedAt,
      downloadPath: `download/${resourceId}`
    };
    const store = readStore();
    store.resources = store.resources.filter((item) => item.resourceId !== resourceId);
    store.resources.push(resource);
    writeStore(store);
    committed = true;
    fs.rmSync(uploadDirectory(session.uploadId), { recursive: true, force: true });
    sendJson(response, 201, { ok: true, resource: resourceForClient(resource) });
  } catch (error) {
    if (output !== null) fs.closeSync(output);
    fs.rmSync(temporaryPath, { force: true });
    if (!committed) fs.rmSync(targetDirectory, { recursive: true, force: true });
    sendJson(response, 400, { error: String(error?.message || error) });
  }
}

function sendStatic(response, fileName, contentType) {
  const filePath = path.join(publicRoot, fileName);
  if (!fs.existsSync(filePath)) { sendText(response, 404, "Not found"); return; }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, { "content-type": contentType, "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "GET" && pathname === "/health") { sendJson(response, 200, { ok: true, service: "xmai-client-download-service", mode: "file-library" }); return; }
  if (request.method === "GET" && pathname === "/") { sendText(response, 200, publicPage(), "text/html; charset=utf-8"); return; }
  if (request.method === "GET" && pathname === "/admin") { sendStatic(response, "admin.html", "text/html; charset=utf-8"); return; }
  if (request.method === "GET" && pathname === "/admin.js") { sendStatic(response, "admin.js", "text/javascript; charset=utf-8"); return; }

  const downloadMatch = pathname.match(/^\/download\/([^/]+)$/);
  if ((request.method === "GET" || request.method === "HEAD") && downloadMatch) {
    const resource = getResource(downloadMatch[1]);
    if (!resource) { sendJson(response, 404, { error: "资源不存在" }); return; }
    serveDownload(request, response, resource);
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/resources") {
    if (!requireAdmin(request, response)) return;
    const resources = readStore().resources.filter((item) => item.status !== "deleted").slice().reverse().map(resourceForClient);
    sendJson(response, 200, { resources, publicPageUrl: publicBaseUrl || "/" });
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/resources/uploads") {
    if (!requireAdmin(request, response)) return;
    try {
      const metadata = validateMetadata(await readJson(request));
      const uploadId = safeId(`resource-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`);
      const session = { schemaVersion: 1, uploadId, ...metadata, chunkSize, chunkCount: Math.max(1, Math.ceil(metadata.fileSize / chunkSize)), createdAt: new Date().toISOString() };
      fs.mkdirSync(uploadDirectory(uploadId), { recursive: true });
      fs.writeFileSync(uploadSessionPath(uploadId), JSON.stringify(session), "utf8");
      sendJson(response, 201, { uploadId, chunkSize, chunkCount: session.chunkCount, uploadedChunks: [] });
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }); }
    return;
  }

  const uploadSessionMatch = pathname.match(/^\/api\/admin\/resources\/uploads\/([^/]+)$/);
  if (request.method === "GET" && uploadSessionMatch) {
    if (!requireAdmin(request, response)) return;
    try {
      const session = getSession(decodePart(uploadSessionMatch[1]));
      const uploadedChunks = Array.from({ length: session.chunkCount }, (_, index) => index).filter((index) => fs.existsSync(uploadChunkPath(session, index)));
      sendJson(response, 200, { uploadId: session.uploadId, chunkSize: session.chunkSize, chunkCount: session.chunkCount, uploadedChunks });
    } catch (error) { sendJson(response, 404, { error: error.message }); }
    return;
  }

  const chunkMatch = pathname.match(/^\/api\/admin\/resources\/uploads\/([^/]+)\/chunks\/(\d+)$/);
  if (request.method === "PUT" && chunkMatch) {
    if (!requireAdmin(request, response)) return;
    try {
      const session = getSession(decodePart(chunkMatch[1]));
      const index = Number(chunkMatch[2]);
      if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) throw new Error("上传分片编号无效");
      const expected = index === session.chunkCount - 1 ? session.fileSize - (index * session.chunkSize) : session.chunkSize;
      const declaredLength = request.headers["content-length"];
      if (declaredLength !== undefined && Number(declaredLength) !== expected) throw new Error("上传分片大小不正确");
      const bytes = await uploadChunk(request, uploadChunkPath(session, index), expected);
      sendJson(response, 200, { ok: true, index, bytes });
    } catch (error) { sendJson(response, 400, { error: String(error?.message || error) }); }
    return;
  }

  const completeMatch = pathname.match(/^\/api\/admin\/resources\/uploads\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeMatch) {
    if (requireAdmin(request, response)) await completeUpload(request, response, decodePart(completeMatch[1]));
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/resources\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    if (!requireAdmin(request, response)) return;
    const id = safeId(decodePart(deleteMatch[1]));
    const store = readStore();
    const exists = store.resources.some((item) => item.resourceId === id);
    if (!exists) { sendJson(response, 404, { error: "资源不存在" }); return; }
    fs.rmSync(resourceDirectory(id), { recursive: true, force: true });
    store.resources = store.resources.filter((item) => item.resourceId !== id);
    writeStore(store);
    sendJson(response, 200, { ok: true, resourceId: id });
    return;
  }

  sendJson(response, 404, { error: "接口不存在" });
}

http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (response.headersSent) response.destroy();
    else sendJson(response, 500, { error: String(error?.message || error) });
  });
}).listen(port, host, () => process.stdout.write(`xmai client download service listening on ${host}:${port}\n`));
