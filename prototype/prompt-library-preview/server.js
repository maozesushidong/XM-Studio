"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const projectRoot = path.resolve(root, "..", "..");
const port = Math.max(1, Number(process.env.PORT || 4179));
const host = process.env.HOST || "127.0.0.1";
const upstreamBaseUrl = "https://cv.xianmaec.com/api/open/v1/resources/prompts";
const cache = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8"
};

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  const value = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": value.length,
    "cache-control": status === 200 ? "no-cache" : "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(value);
}

function safeInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

async function proxyPrompts(requestUrl, response) {
  const page = safeInteger(requestUrl.searchParams.get("page"), 1, 1, 10000);
  const pageSize = safeInteger(requestUrl.searchParams.get("page_size"), 12, 1, 24);
  const keyword = String(requestUrl.searchParams.get("keyword") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 100);
  const upstream = new URL(upstreamBaseUrl);
  upstream.searchParams.set("page", String(page));
  upstream.searchParams.set("page_size", String(pageSize));
  if (keyword) upstream.searchParams.set("keyword", keyword);
  const cacheKey = upstream.toString();
  const cached = cache.get(cacheKey);
  const refresh = requestUrl.searchParams.has("refresh");
  if (!refresh && cached && Date.now() - cached.time < 60 * 1000) {
    send(response, 200, cached.body, "application/json; charset=utf-8");
    return;
  }
  try {
    const upstreamResponse = await fetch(upstream, { headers: { accept: "application/json" } });
    const body = await upstreamResponse.text();
    if (!upstreamResponse.ok) {
      send(response, 502, JSON.stringify({ code: upstreamResponse.status, message: "公共提示词库暂时无法连接" }), "application/json; charset=utf-8");
      return;
    }
    JSON.parse(body);
    cache.set(cacheKey, { time: Date.now(), body });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    send(response, 200, body, "application/json; charset=utf-8");
  } catch (error) {
    send(response, 502, JSON.stringify({ code: 502, message: "公共提示词库暂时无法连接", error: String(error?.message || error).slice(0, 120) }), "application/json; charset=utf-8");
  }
}

function serveFile(response, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(response, 404, "Not found");
    return;
  }
  send(response, 200, fs.readFileSync(filePath), contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method === "GET" && requestUrl.pathname === "/api/prompts") {
    await proxyPrompts(requestUrl, response);
    return;
  }
  if (request.method !== "GET") {
    send(response, 405, "Method not allowed");
    return;
  }
  if (requestUrl.pathname === "/icon.png") {
    serveFile(response, path.join(projectRoot, "renderer", "assets", "icon.png"));
    return;
  }
  const relativePath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }
  serveFile(response, target);
});

server.listen(port, host, () => {
  process.stdout.write(`XMAI prompt library preview: http://${host}:${port}\n`);
});
