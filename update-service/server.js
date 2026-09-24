"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const companySkillPlatformEnabled = process.env.ENABLE_COMPANY_SKILL_PLATFORM === "1";
const { createCompanySkillPlatform } = companySkillPlatformEnabled
  ? require("./company-skills")
  : { createCompanySkillPlatform: null };
const { createV11Platform } = require("./v11-platform");

const port = Math.max(1, Number(process.env.PORT || 8080));
const host = process.env.HOST || "0.0.0.0";
const dataRoot = path.resolve(process.env.UPDATE_DATA_ROOT || path.join(__dirname, "data"));
const adminToken = String(process.env.UPDATE_ADMIN_TOKEN || "").trim();
const privateKeyPath = path.resolve(process.env.UPDATE_SIGNING_PRIVATE_KEY_PATH || path.join(__dirname, "secrets", "update-signing-private.pem"));
const publicBaseUrl = String(process.env.UPDATE_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const previewModelSelection = /\/studio-v11-[\w-]+$/.test(publicBaseUrl);
const maximumUploadBytes = Math.max(1024, Number(process.env.UPDATE_MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024));
const uploadChunkBytes = Math.min(32 * 1024 * 1024, Math.max(1024 * 1024, Number(process.env.UPDATE_UPLOAD_CHUNK_BYTES || 8 * 1024 * 1024)));
const uploadSessionMaxAgeMs = Math.max(60 * 60 * 1000, Number(process.env.UPDATE_UPLOAD_SESSION_MAX_AGE_MS || 48 * 60 * 60 * 1000));
const minimumNextInternalVersion = String(process.env.UPDATE_NEXT_INTERNAL_VERSION || "1.4.0").trim();
const telemetryAllowedCorpId = String(process.env.TELEMETRY_ALLOWED_CORP_ID || "").trim();
const telemetryOnlineWindowMs = Math.max(60 * 1000, Number(process.env.TELEMETRY_ONLINE_WINDOW_MS || 3 * 60 * 1000));
const telemetrySessionHistoryLimit = 8;
const telemetrySessionHistoryMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const telemetryExcludedIdentifiers = new Set(String(process.env.TELEMETRY_EXCLUDED_IDENTIFIERS || "").split(/[,;\n]/).map((value) => value.trim()).filter(Boolean));
const telemetryExcludedNames = new Set(String(process.env.TELEMETRY_EXCLUDED_NAMES || "").split(/[,;\n]/).map((value) => value.trim()).filter(Boolean));
const promptPortalIntegrationKey = String(process.env.XMAI_PROMPT_PORTAL_INTEGRATION_KEY || "").trim();
const promptPortalIntegrationSecret = String(process.env.XMAI_PROMPT_PORTAL_INTEGRATION_SECRET || "").trim();
const promptPortalVerifyAudience = "prompt-portal";
const promptPortalSignatureMaxAgeMs = Math.max(30 * 1000, Number(process.env.XMAI_PROMPT_PORTAL_SIGNATURE_MAX_AGE_MS || 2 * 60 * 1000));
const mapmsBaseUrl = String(process.env.MAPMS_BASE_URL || "").trim().replace(/\/+$/, "");
const mapmsApiKey = String(process.env.MAPMS_API_KEY || "").trim();
const mapmsApiSecret = String(process.env.MAPMS_API_SECRET || "").trim();
const mapmsUserRemark = String(process.env.MAPMS_USER_REMARK || "桌面端注册").trim().slice(0, 255) || "桌面端注册";
const mapmsAdminBaseUrl = String(process.env.MAPMS_ADMIN_BASE_URL || "").trim().replace(/\/+$/, "");
const mapmsAdminUsername = String(process.env.MAPMS_ADMIN_USERNAME || "").trim();
const mapmsAdminPassword = String(process.env.MAPMS_ADMIN_PASSWORD || "");
const dingtalkAppKey = String(process.env.DINGTALK_APP_KEY || "").trim();
const dingtalkAppSecret = String(process.env.DINGTALK_APP_SECRET || "").trim();
const dingtalkAppAccessTokenUrl = String(process.env.DINGTALK_APP_ACCESS_TOKEN_URL || "https://api.dingtalk.com/v1.0/oauth2/accessToken").trim();
const dingtalkUserByUnionIdUrl = String(process.env.DINGTALK_USER_BY_UNION_ID_URL || "https://oapi.dingtalk.com/topapi/user/getbyunionid").trim();
const dingtalkUserDetailUrl = String(process.env.DINGTALK_USER_DETAIL_URL || "https://oapi.dingtalk.com/topapi/v2/user/get").trim();
const adminFrameAncestors = String(process.env.ADMIN_FRAME_ANCESTORS || "'self'").trim();
const modelGatewayGptBaseUrl = String(process.env.MODEL_GATEWAY_GPT_BASE_URL || "").trim().replace(/\/+$/, "");
const modelGatewayGptApiKey = String(process.env.MODEL_GATEWAY_GPT_API_KEY || "").trim();
const modelGatewayGptDefaultModel = String(process.env.MODEL_GATEWAY_GPT_DEFAULT_MODEL || "gpt-5.6-luna").trim();
const modelGatewayFallbackBaseUrl = String(process.env.MODEL_GATEWAY_FALLBACK_BASE_URL || "").trim().replace(/\/+$/, "");
const modelGatewayFallbackApiKey = String(process.env.MODEL_GATEWAY_FALLBACK_API_KEY || "").trim();
const modelGatewayFallbackModel = String(process.env.MODEL_GATEWAY_FALLBACK_MODEL || "").trim();
const modelGatewayFallbackSupportsTools = process.env.MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS === "1";
const modelGatewayErrorFallbackBaseUrl = String(process.env.MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL || "").trim().replace(/\/+$/, "");
const modelGatewayErrorFallbackApiKey = String(process.env.MODEL_GATEWAY_ERROR_FALLBACK_API_KEY || "").trim();
const modelGatewayErrorFallbackTextModel = String(process.env.MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL || "").trim();
const modelGatewayErrorFallbackVisionModel = String(process.env.MODEL_GATEWAY_ERROR_FALLBACK_VISION_MODEL || "").trim();
const modelGatewayErrorFallbackSupportsTools = process.env.MODEL_GATEWAY_ERROR_FALLBACK_SUPPORTS_TOOLS !== "0";
const modelGatewayGptMaxConcurrency = Math.max(1, Number(process.env.MODEL_GATEWAY_GPT_MAX_CONCURRENCY || 14));
const companySkillAdminPublic = process.env.COMPANY_SKILL_ADMIN_PUBLIC === "1";
const companySkillAdminPreviewPath = String(process.env.COMPANY_SKILL_ADMIN_PREVIEW_PATH || "").trim();
const v11AdminUiEnabled = process.env.ENABLE_V11_ADMIN_UI === "1";
const v11ManagementPublic = process.env.V11_MANAGEMENT_PUBLIC === "1";
const releasesPath = path.join(dataRoot, "releases.json");
const reportsPath = path.join(dataRoot, "reports.ndjson");
const telemetryPath = path.join(dataRoot, "telemetry.json");
const filesRoot = path.join(dataRoot, "files");
const uploadsRoot = path.join(dataRoot, "uploads");
const adminHtmlPath = path.join(__dirname, "public", "admin.html");
const adminV11HtmlPath = path.join(__dirname, "public", "admin-v11.html");
const adminV11CssPath = path.join(__dirname, "public", "admin-v11.css");
const adminV11ThemePath = path.join(__dirname, "public", "admin-v11-theme.css");
const adminV11JsPath = path.join(__dirname, "public", "admin-v11.js");
const adminV11IconPath = path.join(__dirname, "public", "admin-v11-icon.png");
const adminV11JsZipPath = require.resolve("jszip/dist/jszip.min.js");

if (!adminToken) throw new Error("UPDATE_ADMIN_TOKEN is required");
if (!fs.existsSync(privateKeyPath)) throw new Error("UPDATE_SIGNING_PRIVATE_KEY_PATH is unavailable");
if (companySkillAdminPreviewPath && !/^[A-Za-z0-9_-]{16,128}$/.test(companySkillAdminPreviewPath)) {
  throw new Error("COMPANY_SKILL_ADMIN_PREVIEW_PATH must contain 16-128 letters, numbers, underscores, or hyphens");
}
fs.mkdirSync(filesRoot, { recursive: true });
fs.mkdirSync(uploadsRoot, { recursive: true });
const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const publicKeyPem = crypto.createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" });
const sseClients = new Set();
const telemetryRateLimits = new Map();
const promptPortalNonces = new Map();
const telemetryProvisionJobs = new Map();
const mapmsResolutionJobs = new Map();
let telemetryAuthorizationRefreshJob = null;
let dingtalkAppTokenCache = { accessToken: "", expiresAt: 0 };
let mapmsDingtalkDirectoryCache = { key: "", users: [], departments: [], expiresAt: 0 };
let mapmsAdminTokenCache = { accessToken: "", expiresAt: 0 };
let companySkillPlatform = null;
let v11Platform = null;
let requirementIntake = null;
let activeGptModelRequests = 0;
const recentModelModes = new Map();
const telemetryEventTypes = new Set([
  "login",
  "logout",
  "app_open",
  "app_close",
  "chat",
  "image",
  "document",
  "skill",
  "file",
  "browser",
  "computer_operation"
]);

function sendJson(response, status, value, headers = {}) {
  const body = value === null ? "" : JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end(body);
}

function modelGatewayEndpoint(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
}

function modelGatewayConfigured() {
  return Boolean(
    modelGatewayGptBaseUrl
    && modelGatewayGptApiKey
    && modelGatewayGptDefaultModel
    && modelGatewayFallbackBaseUrl
    && modelGatewayFallbackApiKey
    && modelGatewayFallbackModel
  );
}

function modelGatewayErrorFallbackConfigured() {
  return Boolean(
    modelGatewayErrorFallbackBaseUrl
    && modelGatewayErrorFallbackApiKey
    && modelGatewayErrorFallbackTextModel
    && modelGatewayErrorFallbackVisionModel
  );
}

function modelGatewayProviderConfigured(provider) {
  if (provider === "primary") return Boolean(modelGatewayGptBaseUrl && modelGatewayGptApiKey && modelGatewayGptDefaultModel);
  if (provider === "fallback") return Boolean(modelGatewayFallbackBaseUrl && modelGatewayFallbackApiKey && modelGatewayFallbackModel);
  return provider === "error-fallback" && modelGatewayErrorFallbackConfigured();
}

function nextModelProviders(provider) {
  if (provider === "primary") return ["error-fallback", "fallback"];
  if (provider === "fallback") return ["error-fallback"];
  return ["fallback"];
}

function hasMultimodalModelInput(body) {
  for (const message of Array.isArray(body?.messages) ? body.messages : []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((part) => {
      const type = String(part?.type || "").trim().toLowerCase();
      return ["image", "image_url", "input_image"].includes(type)
        || Boolean(part?.image_url || part?.imageUrl || part?.source?.media_type?.startsWith?.("image/"));
    })) return true;
  }
  return Array.isArray(body?.images) && body.images.length > 0;
}

function modelGatewayPrivateModelNames() {
  return [
    modelGatewayFallbackModel,
    modelGatewayErrorFallbackTextModel,
    modelGatewayErrorFallbackVisionModel
  ].filter(Boolean);
}

function replacePrivateModelNames(value) {
  let output = String(value || "");
  for (const model of modelGatewayPrivateModelNames()) output = output.split(model).join("auto");
  return output;
}

async function shouldUseErrorFallback(upstream) {
  if ([401, 402, 403, 404, 408, 409, 410, 425, 429].includes(upstream.status)
    || upstream.status >= 500 && upstream.status <= 599) return true;
  if (![400, 422].includes(upstream.status)) return false;
  const errorText = await upstream.clone().text().catch(() => "");
  return /(model.{0,80}(not[ _-]?found|unavailable|unsupported|does not exist|no longer available)|模型.{0,40}(不存在|不可用|未开通|不支持)|无可用模型)/i.test(errorText);
}

async function prepareModelResponse(upstream) {
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  if (!upstream.ok || !contentType.includes("text/event-stream") || !upstream.body?.getReader) {
    return { upstream, retry: false };
  }
  // Hold metadata until actual model output so an HTTP-200 error can still fail over.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf8");
  const prefix = [];
  let bytes = 0;
  let buffer = "";
  let retry = false;
  let finished = false;
  const inspectLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") { finished = true; return; }
    let frame;
    try { frame = JSON.parse(data); } catch { return; }
    if (frame?.error) { retry = true; finished = true; return; }
    if (frame?.choices?.some((choice) => {
      const delta = choice?.delta || choice?.message || {};
      return delta.content || delta.reasoning_content || delta.reasoning
        || delta.tool_calls?.length || delta.function_call || choice?.finish_reason;
    })) finished = true;
  };
  try {
    while (!finished && bytes < 64 * 1024) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        for (const line of buffer.split("\n")) {
          inspectLine(line);
          if (finished) break;
        }
        break;
      }
      prefix.push(value);
      bytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        inspectLine(line);
        if (finished) break;
      }
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    reader.releaseLock();
    throw error;
  }
  let prefixIndex = 0;
  const replay = new ReadableStream({
    async pull(controller) {
      if (prefixIndex < prefix.length) {
        controller.enqueue(prefix[prefixIndex++]);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) { reader.releaseLock(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) {
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    }
  });
  return { upstream: new Response(replay, { status: upstream.status, headers: upstream.headers }), retry };
}

function recordModelMode(sessionToken, modelMode) {
  const key = telemetryTokenHash(sessionToken);
  if (!key) return;
  if (modelMode === "auto") {
    recentModelModes.set(key, { modelMode: "auto", expiresAt: Date.now() + 5 * 60 * 1000 });
  } else {
    recentModelModes.delete(key);
  }
}

function currentModelMode(sessionToken) {
  if (activeGptModelRequests >= modelGatewayGptMaxConcurrency) return "auto";
  const key = telemetryTokenHash(sessionToken);
  const recent = recentModelModes.get(key);
  if (recent?.expiresAt > Date.now()) return recent.modelMode;
  if (recent) recentModelModes.delete(key);
  return "selected";
}

function redactFallbackPayload(value) {
  if (typeof value === "string") return replacePrivateModelNames(value);
  if (Array.isArray(value)) return value.map(redactFallbackPayload);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = redactFallbackPayload(item);
  if (Object.prototype.hasOwnProperty.call(result, "model")) result.model = "auto";
  return result;
}

function rewriteFallbackSseLine(line) {
  const match = String(line || "").match(/^(\s*data:\s*)(.*)$/i);
  if (!match || !match[2] || match[2].trim() === "[DONE]") return line;
  try {
    return `${match[1]}${JSON.stringify(redactFallbackPayload(JSON.parse(match[2])))}`;
  } catch {
    return replacePrivateModelNames(line);
  }
}

async function pipeModelResponse(upstream, response, modelMode) {
  const contentType = String(upstream.headers.get("content-type") || "application/json; charset=utf-8");
  response.writeHead(upstream.status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-xianma-model-mode": modelMode
  });
  if (modelMode !== "auto") {
    if (!upstream.body?.getReader) {
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || response.destroyed) break;
        if (!response.write(Buffer.from(value))) await new Promise((resolve) => response.once("drain", resolve));
      }
    } finally {
      reader.releaseLock();
    }
    if (!response.destroyed) response.end();
    return;
  }
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    const source = Buffer.from(await upstream.arrayBuffer()).toString("utf8");
    let output;
    try { output = JSON.stringify(redactFallbackPayload(JSON.parse(source))); }
    catch { output = replacePrivateModelNames(source); }
    response.end(output);
    return;
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || response.destroyed) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        if (!response.write(`${rewriteFallbackSseLine(line)}\n`)) await new Promise((resolve) => response.once("drain", resolve));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer && !response.destroyed) response.write(rewriteFallbackSseLine(buffer));
  } finally {
    reader.releaseLock();
  }
  if (!response.destroyed) response.end();
}

async function proxyModelRequest(response, body, { provider, signal, sessionToken, attemptedProviders = [] }) {
  const attempted = new Set(attemptedProviders);
  attempted.add(provider);
  const tryNextProvider = async () => {
    for (const nextProvider of nextModelProviders(provider)) {
      if (attempted.has(nextProvider) || !modelGatewayProviderConfigured(nextProvider)) continue;
      await proxyModelRequest(response, body, {
        provider: nextProvider,
        signal,
        sessionToken,
        attemptedProviders: [...attempted]
      });
      return true;
    }
    return false;
  };
  const isPrimary = provider === "primary";
  const isCapacityFallback = provider === "fallback";
  const isErrorFallback = provider === "error-fallback";
  const baseUrl = isPrimary
    ? modelGatewayGptBaseUrl
    : isCapacityFallback ? modelGatewayFallbackBaseUrl : modelGatewayErrorFallbackBaseUrl;
  const apiKey = isPrimary
    ? modelGatewayGptApiKey
    : isCapacityFallback ? modelGatewayFallbackApiKey : modelGatewayErrorFallbackApiKey;
  const fallbackModel = isCapacityFallback
    ? modelGatewayFallbackModel
    : hasMultimodalModelInput(body) ? modelGatewayErrorFallbackVisionModel : modelGatewayErrorFallbackTextModel;
  const explicitSelection = previewModelSelection && (isCapacityFallback && body.model === modelGatewayFallbackModel
    || isErrorFallback && [modelGatewayErrorFallbackTextModel, modelGatewayErrorFallbackVisionModel].includes(body.model));
  const supportsTools = isCapacityFallback ? modelGatewayFallbackSupportsTools : modelGatewayErrorFallbackSupportsTools;
  const upstreamBody = isPrimary
    ? {
      ...body,
      model: String(body?.model || "").trim().toLowerCase() === "auto"
        ? modelGatewayGptDefaultModel
        : body.model
    }
    : {
      ...body,
      model: explicitSelection ? body.model : fallbackModel,
      messages: [
        { role: "system", content: "你是XMAI Studio。直接完成用户任务，不得披露底层模型、供应商、接口、密钥、路由或并发策略。" },
        ...(Array.isArray(body?.messages) ? body.messages : [])
      ],
      ...(supportsTools ? {} : {
        tools: undefined,
        tool_choice: undefined,
        parallel_tool_calls: undefined,
        reasoning_effort: undefined
      })
    };
  recordModelMode(sessionToken, isPrimary || explicitSelection ? "selected" : "auto");
  if (isPrimary) activeGptModelRequests += 1;
  try {
    let upstream;
    try {
      upstream = await fetch(modelGatewayEndpoint(baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(upstreamBody),
        signal
      });
    } catch (error) {
      if (error?.name !== "AbortError" && !signal?.aborted && await tryNextProvider()) return;
      throw error;
    }
    let shouldRetry = await shouldUseErrorFallback(upstream);
    if (!shouldRetry) {
      try {
        const prepared = await prepareModelResponse(upstream);
        upstream = prepared.upstream;
        shouldRetry = prepared.retry;
      } catch (error) {
        if (error?.name !== "AbortError" && !signal?.aborted && await tryNextProvider()) return;
        throw error;
      }
    }
    if (shouldRetry) {
      const canRetry = nextModelProviders(provider)
        .some((nextProvider) => !attempted.has(nextProvider) && modelGatewayProviderConfigured(nextProvider));
      if (canRetry) {
        upstream.body?.cancel?.().catch?.(() => {});
        if (await tryNextProvider()) return;
      }
    }
    await pipeModelResponse(upstream, response, isPrimary || explicitSelection ? "selected" : "auto");
  } finally {
    if (isPrimary) activeGptModelRequests = Math.max(0, activeGptModelRequests - 1);
  }
}

async function routeDesktopChatCompletion(request, response) {
  if (!modelGatewayConfigured()) {
    sendJson(response, 503, { error: "企业模型路由尚未配置" });
    return;
  }
  const session = requireTelemetrySession(request, response, readTelemetry());
  if (!session) return;
  let body;
  try {
    body = await readJsonBody(request, 128 * 1024 * 1024);
  } catch (error) {
    sendJson(response, 400, { error: String(error?.message || error) });
    return;
  }
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    sendJson(response, 400, { error: "缺少对话内容" });
    return;
  }
  if (previewModelSelection && require("./preview-model-catalog").isHiddenModel(body.model)) {
    sendJson(response, 400, { code: "MODEL_REMOVED", error: "所选模型已下架，请重新选择模型" });
    return;
  }
  const controller = new AbortController();
  const sessionToken = telemetryBearerToken(request);
  response.once("close", () => controller.abort());
  try {
    if (previewModelSelection) {
      let provider = body.model === modelGatewayFallbackModel ? "fallback"
        : [modelGatewayErrorFallbackTextModel, modelGatewayErrorFallbackVisionModel].includes(body.model) ? "error-fallback" : "primary";
      // Tool workloads must use a tool-capable provider, including explicitly selected models.
      if (provider === "fallback" && body.tools?.length && !modelGatewayFallbackSupportsTools) provider = "error-fallback";
      if (provider !== "primary") {
        await proxyModelRequest(response, body, { provider, signal: controller.signal, sessionToken });
        return;
      }
    }
    if (activeGptModelRequests >= modelGatewayGptMaxConcurrency) {
      await proxyModelRequest(response, body, { provider: "fallback", signal: controller.signal, sessionToken });
      return;
    }
    await proxyModelRequest(response, body, { provider: "primary", signal: controller.signal, sessionToken });
  } catch (error) {
    if (response.headersSent || response.destroyed || error?.name === "AbortError") {
      if (!response.destroyed) response.end();
      return;
    }
    sendJson(response, 502, { error: "企业模型服务暂不可用" });
  }
}

function readReleases() {
  try {
    const parsed = JSON.parse(fs.readFileSync(releasesPath, "utf8"));
    return Array.isArray(parsed?.releases) ? parsed : { schemaVersion: 1, releases: [] };
  } catch {
    return { schemaVersion: 1, releases: [] };
  }
}

function writeReleases(store) {
  fs.mkdirSync(path.dirname(releasesPath), { recursive: true });
  const temporaryPath = `${releasesPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(temporaryPath, releasesPath);
}

function readTelemetry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(telemetryPath, "utf8"));
    return parsed?.users && typeof parsed.users === "object"
      ? parsed
      : { schemaVersion: 1, users: {} };
  } catch {
    return { schemaVersion: 1, users: {} };
  }
}

function writeTelemetry(store) {
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  const temporaryPath = `${telemetryPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(temporaryPath, telemetryPath);
}

function telemetryText(value, maximumLength) {
  return String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function telemetryIdentifier(value, maximumLength = 160) {
  return telemetryText(value, maximumLength).replace(/[^a-zA-Z0-9._:@-]/g, "");
}

function telemetryUserKey(corpId, userId) {
  return crypto.createHash("sha256").update(`${corpId}\0${userId}`, "utf8").digest("hex");
}

function isTelemetryExcludedIdentity(identity) {
  const sources = [identity, identity?.user, identity?.submitter, identity?.creator].filter(Boolean);
  const identifiers = [];
  const names = [];
  for (const source of sources) {
    identifiers.push(source.userKey, source.ownerUserKey, source.userId, source.dingtalkUserId, source.DTUserId, source.mapms?.userId, source.mapms?.userNo);
    names.push(source.name, source.nickname, source.nickName, source.displayName, source.username, source.userName, source.realName, source.dingtalkRealName, source.dingtalkNickname);
  }
  return identifiers.some((value) => telemetryExcludedIdentifiers.has(String(value || "").trim()))
    || names.some((value) => telemetryExcludedNames.has(String(value || "").trim()));
}

function statisticalTelemetryEntries(store = readTelemetry()) {
  return Object.entries(store.users || {}).filter(([userKey, user]) => !isTelemetryExcludedIdentity({ userKey, user }));
}

function telemetryTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function telemetryHashMatches(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return Boolean(left.length && left.length === right.length && crypto.timingSafeEqual(left, right));
}

function activeTelemetrySessionHashes(device, now = Date.now()) {
  const values = [{ hash: String(device?.sessionTokenHash || ""), issuedAt: String(device?.sessionIssuedAt || "") }];
  for (const item of Array.isArray(device?.sessionTokenHistory) ? device.sessionTokenHistory : []) {
    const hash = String(typeof item === "string" ? item : item?.hash || "");
    const issuedAt = String(typeof item === "string" ? "" : item?.issuedAt || "");
    const issuedAtMs = Date.parse(issuedAt);
    if (issuedAtMs && now - issuedAtMs > telemetrySessionHistoryMaxAgeMs) continue;
    values.push({ hash, issuedAt });
  }
  const seen = new Set();
  return values.filter((item) => item.hash && !seen.has(item.hash) && seen.add(item.hash));
}

function normalizedAdminFrameAncestors() {
  const values = adminFrameAncestors.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  const allowed = values.filter((value) => {
    if (value === "'self'" || value === "'none'") return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value.replace(/\/$/, "");
    } catch {
      return false;
    }
  });
  return allowed.length ? allowed.join(" ") : "'self'";
}

function requestAddress(request) {
  return telemetryText(String(request.headers["x-forwarded-for"] || "").split(",")[0] || request.socket.remoteAddress || "unknown", 80);
}

function allowTelemetryRequest(request, response, bucket, maximumRequests, windowMs, identityKey = "") {
  const now = Date.now();
  const normalizedIdentity = telemetryText(identityKey, 160);
  const key = `${bucket}:${requestAddress(request)}${normalizedIdentity ? `:${normalizedIdentity}` : ""}`;
  const current = telemetryRateLimits.get(key);
  if (!current || current.resetAt <= now) {
    telemetryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (current.count <= maximumRequests) return true;
  sendJson(response, 429, { error: "请求过于频繁，请稍后重试" }, { "retry-after": String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))) });
  return false;
}

function findTelemetryDeviceByToken(store, token) {
  const tokenHash = telemetryTokenHash(token);
  for (const [userKey, user] of Object.entries(store.users || {})) {
    for (const [deviceId, device] of Object.entries(user.devices || {})) {
      if (activeTelemetrySessionHashes(device).some((item) => telemetryHashMatches(item.hash, tokenHash))) {
        return { userKey, user, deviceId, device };
      }
    }
  }
  return null;
}

function telemetryBearerToken(request) {
  const authorization = String(request.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function requireTelemetrySession(request, response, store) {
  const token = telemetryBearerToken(request);
  const session = token && findTelemetryDeviceByToken(store, token);
  if (session) return session;
  sendJson(response, 401, { error: "客户端统计会话无效" });
  return null;
}

function promptPortalRequestId() {
  return `xmai-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
}

function promptPortalError(response, status, code, message, requestId) {
  sendJson(response, status, { code, message, requestId });
}

function promptPortalSignature(request, pathname, rawBody) {
  const integrationKey = String(request.headers["x-xmai-integration-key"] || "").trim();
  const timestamp = String(request.headers["x-xmai-timestamp"] || "").trim();
  const nonce = String(request.headers["x-xmai-nonce"] || "").trim();
  const signature = String(request.headers["x-xmai-signature"] || "").trim().toLowerCase();
  if (!promptPortalIntegrationKey || !promptPortalIntegrationSecret) return { ok: false, status: 503, code: "INTEGRATION_NOT_CONFIGURED", message: "XMAI桌面免登校验服务尚未配置" };
  if (integrationKey !== promptPortalIntegrationKey || !/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, status: 401, code: "INTEGRATION_UNAUTHORIZED", message: "服务间身份校验失败" };
  }
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > promptPortalSignatureMaxAgeMs) {
    return { ok: false, status: 401, code: "INTEGRATION_TIMESTAMP_INVALID", message: "服务间请求时间戳无效" };
  }
  const now = Date.now();
  for (const [storedNonce, expiresAt] of promptPortalNonces) {
    if (expiresAt <= now) promptPortalNonces.delete(storedNonce);
  }
  if (promptPortalNonces.has(nonce)) {
    return { ok: false, status: 409, code: "INTEGRATION_REPLAYED", message: "服务间请求已被使用" };
  }
  const bodyDigest = crypto.createHash("sha256").update(rawBody).digest("hex");
  const canonical = `${request.method}\n${pathname}\n${timestamp}\n${nonce}\n${bodyDigest}`;
  const expected = crypto.createHmac("sha256", promptPortalIntegrationSecret).update(canonical).digest("hex");
  const left = Buffer.from(signature, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, status: 401, code: "INTEGRATION_UNAUTHORIZED", message: "服务间身份校验失败" };
  }
  promptPortalNonces.set(nonce, now + promptPortalSignatureMaxAgeMs);
  return { ok: true };
}

async function verifyPromptPortalDesktopSession(request, response, pathname) {
  const requestId = promptPortalRequestId();
  if (!allowTelemetryRequest(request, response, "prompt-portal-verify", 120, 60 * 1000)) return;
  let rawBody;
  let body;
  try {
    rawBody = await readRequestBody(request, 8 * 1024);
    body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch (error) {
    promptPortalError(response, 400, "INVALID_REQUEST", String(error?.message || "请求格式无效"), requestId);
    return;
  }
  const signed = promptPortalSignature(request, pathname, rawBody);
  if (!signed.ok) {
    promptPortalError(response, signed.status, signed.code, signed.message, requestId);
    return;
  }
  const desktopSessionToken = String(body?.desktopSessionToken || "").trim();
  const dingtalkUserId = telemetryIdentifier(body?.dingtalkUserId, 160);
  const corpId = telemetryIdentifier(body?.corpId, 100);
  const audience = String(body?.audience || "").trim();
  if (!desktopSessionToken || desktopSessionToken.length > 512 || !dingtalkUserId || !corpId || audience !== promptPortalVerifyAudience) {
    promptPortalError(response, 400, "INVALID_REQUEST", "桌面会话、钉钉身份或调用目标无效", requestId);
    return;
  }
  const session = findTelemetryDeviceByToken(readTelemetry(), desktopSessionToken);
  if (!session || session.device?.disconnectedAt) {
    promptPortalError(response, 401, "XMAI_SESSION_EXPIRED", "XMAI桌面会话已失效", requestId);
    return;
  }
  if (String(session.user?.dingtalkUserId || "") !== dingtalkUserId || String(session.user?.corpId || "") !== corpId) {
    promptPortalError(response, 403, "XMAI_USER_MISMATCH", "桌面会话与钉钉身份不一致", requestId);
    return;
  }
  try {
    await performMapmsAuthorization(session.userKey);
    const currentUser = readTelemetry().users?.[session.userKey] || session.user;
    sendJson(response, 200, {
      code: "0",
      message: "OK",
      data: {
        verified: true,
        userId: String(currentUser.userId || ""),
        dingtalkUserId,
        corpId,
        nickname: telemetryText(currentUser.name, 80),
        department: telemetryText(currentUser.mapms?.departmentName || currentUser.department, 120),
        status: 1
      },
      requestId
    });
  } catch (error) {
    const status = Number(error?.status || 503);
    const code = status === 503 ? "XMAI_VERIFY_UNAVAILABLE" : (error?.code || "XMAI_PERMISSION_DENIED");
    promptPortalError(response, status, code, String(error?.message || "当前用户没有XMAI Studio使用权限"), requestId);
  }
}

function normalizeTelemetryRegistration(body) {
  const result = {
    userId: telemetryIdentifier(body?.userId),
    dingtalkUserId: telemetryIdentifier(body?.dingtalkUserId),
    dingtalkRealName: telemetryText(body?.dingtalkRealName, 80),
    name: telemetryText(body?.name, 80),
    corpId: telemetryIdentifier(body?.corpId, 100),
    department: telemetryText(body?.department, 120),
    deviceId: telemetryIdentifier(body?.deviceId, 128),
    appVersion: telemetryIdentifier(body?.appVersion, 32),
    internalVersion: telemetryIdentifier(body?.internalVersion, 32),
    platform: telemetryIdentifier(body?.platform, 24),
    arch: telemetryIdentifier(body?.arch, 24),
    osVersion: telemetryText(body?.osVersion, 80)
  };
  if (!result.userId || !result.deviceId) throw new Error("缺少用户或设备标识");
  if (telemetryAllowedCorpId && result.corpId !== telemetryAllowedCorpId) throw new Error("当前企业不允许登记");
  return result;
}

async function registerDesktopTelemetry(request, response) {
  try {
    const registration = normalizeTelemetryRegistration(await readJsonBody(request, 32 * 1024));
    // Isolate clients behind the same office NAT so one launch burst cannot
    // exhaust the registration quota for other users.
    const registrationKey = telemetryUserKey(registration.corpId, registration.userId);
    if (!allowTelemetryRequest(request, response, "register", 6, 60 * 1000, registrationKey)) return;
    const store = readTelemetry();
    const now = new Date().toISOString();
    const userKey = telemetryUserKey(registration.corpId, registration.userId);
    const user = store.users[userKey] || {
      userId: registration.userId,
      dingtalkUserId: registration.dingtalkUserId,
      dingtalkRealName: registration.dingtalkRealName,
      name: registration.name || "钉钉用户",
      corpId: registration.corpId,
      department: registration.department,
      firstSeenAt: now,
      lastSeenAt: now,
      usage: {},
      devices: {}
    };
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const device = user.devices[registration.deviceId] || {
      deviceId: registration.deviceId,
      firstSeenAt: now,
      usage: {}
    };
    const sessionTokenHash = telemetryTokenHash(sessionToken);
    const sessionTokenHistory = activeTelemetrySessionHashes(device)
      .filter((item) => item.hash !== sessionTokenHash)
      .slice(0, telemetrySessionHistoryLimit - 1);
    Object.assign(device, {
      appVersion: registration.appVersion,
      internalVersion: registration.internalVersion,
      platform: registration.platform,
      arch: registration.arch,
      osVersion: registration.osVersion,
      lastSeenAt: now,
      disconnectedAt: "",
      sessionTokenHash,
      sessionIssuedAt: now,
      sessionTokenHistory
    });
    Object.assign(user, {
      dingtalkUserId: registration.dingtalkUserId || user.dingtalkUserId || "",
      dingtalkRealName: registration.dingtalkRealName || user.dingtalkRealName || "",
      name: registration.name || user.name || "钉钉用户",
      corpId: registration.corpId,
      department: registration.department || user.department || "",
      lastSeenAt: now
    });
    user.devices[registration.deviceId] = device;
    store.users[userKey] = user;
    writeTelemetry(store);
    sendJson(response, 201, { sessionToken, heartbeatIntervalSeconds: 60, onlineWindowSeconds: Math.floor(telemetryOnlineWindowMs / 1000) });
    provisionTelemetryUser(userKey).catch((error) => {
      process.stderr.write(`telemetry provisioning failed for ${userKey.slice(0, 12)}: ${String(error?.message || error).slice(0, 240)}\n`);
    });
  } catch (error) {
    sendJson(response, 400, { error: String(error?.message || error) });
  }
}

async function heartbeatDesktopTelemetry(request, response) {
  const token = telemetryBearerToken(request);
  if (!allowTelemetryRequest(request, response, "heartbeat", 180, 60 * 1000, token ? telemetryTokenHash(token).slice(0, 32) : "")) return;
  const store = readTelemetry();
  const session = requireTelemetrySession(request, response, store);
  if (!session) return;
  const now = new Date().toISOString();
  session.device.lastSeenAt = now;
  session.device.disconnectedAt = "";
  session.user.lastSeenAt = now;
  writeTelemetry(store);
  sendJson(response, 202, { ok: true, serverTime: now });
  provisionTelemetryUser(session.userKey).catch(() => {});
}

async function recordDesktopTelemetryEvents(request, response) {
  const token = telemetryBearerToken(request);
  if (!allowTelemetryRequest(request, response, "events", 240, 60 * 1000, token ? telemetryTokenHash(token).slice(0, 32) : "")) return;
  try {
    const store = readTelemetry();
    const session = requireTelemetrySession(request, response, store);
    if (!session) return;
    const body = await readJsonBody(request, 32 * 1024);
    const events = Array.isArray(body?.events) ? body.events.slice(0, 30) : [];
    if (isTelemetryExcludedIdentity(session)) {
      sendJson(response, 202, { ok: true, accepted: 0, excludedFromStatistics: true });
      return;
    }
    let disconnect = false;
    for (const event of events) {
      const type = telemetryIdentifier(event?.type, 40);
      if (!telemetryEventTypes.has(type)) continue;
      const count = Math.min(100, Math.max(1, Math.floor(Number(event?.count || 1))));
      if (type === "skill") {
        await companySkillPlatform?.recordLegacyUsage(count);
        continue;
      }
      session.user.usage[type] = Number(session.user.usage[type] || 0) + count;
      session.device.usage[type] = Number(session.device.usage[type] || 0) + count;
      if (type === "logout" || type === "app_close") disconnect = true;
    }
    const now = new Date().toISOString();
    session.user.lastSeenAt = now;
    session.device.lastSeenAt = now;
    session.device.disconnectedAt = disconnect ? now : "";
    writeTelemetry(store);
    const clientVersion = session.device.internalVersion || session.device.appVersion || "0";
    if (compareVersions(clientVersion, "2.0.0") < 0 && v11Platform?.recordLegacyTelemetryEvents) {
      try {
        await v11Platform.recordLegacyTelemetryEvents(session, events, now);
      } catch (error) {
        process.stderr.write(`legacy telemetry compatibility failed: ${String(error?.message || error).slice(0, 240)}\n`);
      }
    }
    sendJson(response, 202, { ok: true, accepted: events.length });
  } catch (error) {
    sendJson(response, 400, { error: String(error?.message || error) });
  }
}

function mapmsConfigured() {
  return Boolean(mapmsBaseUrl && mapmsApiKey && mapmsApiSecret);
}

function mapmsAdminConfigured() {
  return Boolean(mapmsAdminBaseUrl && mapmsAdminUsername && mapmsAdminPassword);
}

function dingtalkDirectoryConfigured() {
  return Boolean(dingtalkAppKey && dingtalkAppSecret);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function requestDingtalkAppToken() {
  if (!dingtalkDirectoryConfigured()) throw new Error("钉钉企业通讯录同步尚未配置");
  if (dingtalkAppTokenCache.accessToken && dingtalkAppTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return dingtalkAppTokenCache.accessToken;
  }
  const { response, payload } = await fetchJsonWithTimeout(dingtalkAppAccessTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appKey: dingtalkAppKey, appSecret: dingtalkAppSecret })
  });
  if (!response.ok || !payload?.accessToken) throw new Error("钉钉企业通讯录令牌获取失败");
  dingtalkAppTokenCache = {
    accessToken: String(payload.accessToken),
    expiresAt: Date.now() + Math.max(10 * 60 * 1000, Number(payload.expireIn || 7200) * 1000)
  };
  return dingtalkAppTokenCache.accessToken;
}

async function requestDingtalkEnterpriseUserId(unionId) {
  const accessToken = await requestDingtalkAppToken();
  const url = new URL(dingtalkUserByUnionIdUrl);
  url.searchParams.set("access_token", accessToken);
  const { response, payload } = await fetchJsonWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unionid: String(unionId || "") })
  });
  const userId = String(payload?.result?.userid || "").trim();
  if (!response.ok || Number(payload?.errcode || 0) !== 0 || !userId) {
    throw new Error(telemetryText(payload?.errmsg || "钉钉企业用户身份解析失败", 180));
  }
  return userId;
}

async function requestDingtalkUserDetail(userId) {
  const accessToken = await requestDingtalkAppToken();
  const url = new URL(dingtalkUserDetailUrl);
  url.searchParams.set("access_token", accessToken);
  const { response, payload } = await fetchJsonWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userid: String(userId || ""), language: "zh_CN" })
  });
  if (!response.ok || Number(payload?.errcode || 0) !== 0) {
    throw new Error(telemetryText(payload?.errmsg || "钉钉企业成员信息读取失败", 180));
  }
  return payload?.result || {};
}

function flattenMapmsDepartments(nodes, output = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    output.push(node);
    flattenMapmsDepartments(node?.children, output);
  }
  return output;
}

async function requestMapmsDingtalkDirectory(realName = "") {
  const normalizedRealName = telemetryText(realName, 80);
  const cacheKey = normalizedRealName.toLocaleLowerCase("zh-CN");
  if (mapmsDingtalkDirectoryCache.key === cacheKey && mapmsDingtalkDirectoryCache.expiresAt > Date.now()) {
    return mapmsDingtalkDirectoryCache;
  }
  const requestDirectory = async (pathname, requestPath = pathname) => {
    const { response, payload } = await fetchJsonWithTimeout(`${mapmsBaseUrl}${requestPath}`, {
      method: "GET",
      headers: mapmsSignedHeaders("GET", pathname)
    });
    if (!response.ok || String(payload?.code) !== "0") {
      throw new Error(telemetryText(payload?.message || `MAPMS 组织目录返回 ${response.status}`, 180));
    }
    return payload?.data;
  };
  const usersPath = "/api/open/v1/platforms/me/dingtalk/users";
  const usersRequestPath = normalizedRealName
    ? `${usersPath}?realName=${encodeURIComponent(normalizedRealName)}`
    : usersPath;
  const [departmentTree, users] = await Promise.all([
    requestDirectory("/api/open/v1/platforms/me/dingtalk/departments/tree"),
    requestDirectory(usersPath, usersRequestPath)
  ]);
  mapmsDingtalkDirectoryCache = {
    key: cacheKey,
    users: Array.isArray(users) ? users : [],
    departments: flattenMapmsDepartments(departmentTree),
    expiresAt: Date.now() + 5 * 60 * 1000
  };
  return mapmsDingtalkDirectoryCache;
}

function saveTelemetryDirectoryState(userKey, value) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user) throw new Error("客户端用户记录不存在");
  user.dingtalkUserId = telemetryIdentifier(value.dingtalkUserId || user.dingtalkUserId);
  user.dingtalkRealName = telemetryText(value.dingtalkRealName || user.dingtalkRealName, 80);
  user.department = telemetryText(value.department || user.department, 120);
  const departmentId = Number(value.mapmsDepartmentId || user.mapmsDepartmentId || 0);
  if (Number.isSafeInteger(departmentId) && departmentId > 0) user.mapmsDepartmentId = departmentId;
  user.directorySyncedAt = new Date().toISOString();
  delete user.directorySyncError;
  writeTelemetry(store);
  return user;
}

function saveTelemetryDirectoryError(userKey, error) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user) return;
  user.directorySyncError = telemetryText(error?.message || error, 240);
  user.directoryLastAttemptAt = new Date().toISOString();
  writeTelemetry(store);
}

async function enrichTelemetryUser(userKey) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user?.userId) throw new Error("客户端用户记录不存在");
  if (user.dingtalkUserId && user.dingtalkRealName && user.department && Number(user.mapmsDepartmentId) > 0) return user;

  let dingtalkUserId = String(user.dingtalkUserId || "").trim();
  if (!dingtalkUserId) dingtalkUserId = await requestDingtalkEnterpriseUserId(user.userId);

  let detail = {};
  if (dingtalkDirectoryConfigured()) {
    try {
      detail = await requestDingtalkUserDetail(dingtalkUserId);
    } catch {
      detail = {};
    }
  }
  const directory = await requestMapmsDingtalkDirectory(detail?.name || user.dingtalkRealName);
  const directoryUser = directory.users.find((item) => String(item?.dingTalkUserId || "") === dingtalkUserId);
  if (!directoryUser) {
    const error = new Error("当前钉钉用户尚未同步到 MAPMS 组织目录，请先同步钉钉组织");
    error.code = "MAPMS_DINGTALK_USER_NOT_SYNCED";
    error.status = 409;
    throw error;
  }
  if (Number(directoryUser?.status) === 0) {
    const error = new Error("当前钉钉用户在 MAPMS 组织目录中已禁用");
    error.code = "MAPMS_DINGTALK_USER_DISABLED";
    error.status = 403;
    throw error;
  }
  const departmentIds = new Set((Array.isArray(detail?.dept_id_list) ? detail.dept_id_list : []).map(Number));
  const departmentNames = directory.departments
    .filter((item) => departmentIds.has(Number(item?.dingTalkDeptId)))
    .map((item) => telemetryText(item?.deptName, 80))
    .filter(Boolean);
  const department = telemetryText(directoryUser?.departmentName, 120)
    || [...new Set(departmentNames)].join(" / ")
    || user.department;
  return saveTelemetryDirectoryState(userKey, {
    dingtalkUserId,
    dingtalkRealName: directoryUser?.realName || detail?.name,
    department,
    mapmsDepartmentId: Number(directoryUser?.departmentId || 0)
  });
}

function mapmsSignedHeaders(method, pathname) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(18).toString("hex");
  const canonical = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}`;
  const signature = crypto.createHmac("sha256", mapmsApiSecret).update(canonical, "utf8").digest("hex");
  return {
    "content-type": "application/json",
    "x-api-key": mapmsApiKey,
    "x-api-secret": mapmsApiSecret,
    "x-api-timestamp": timestamp,
    "x-api-nonce": nonce,
    "x-api-signature": signature
  };
}

async function requestMapmsAdminAccessToken(forceRefresh = false) {
  if (!mapmsAdminConfigured()) {
    const error = new Error("MAPMS 账号同步服务尚未配置");
    error.code = "MAPMS_ADMIN_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!forceRefresh && mapmsAdminTokenCache.accessToken && mapmsAdminTokenCache.expiresAt > Date.now() + 60 * 1000) {
    return mapmsAdminTokenCache.accessToken;
  }
  const { response, payload } = await fetchJsonWithTimeout(`${mapmsAdminBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: mapmsAdminUsername, password: mapmsAdminPassword, rememberMe: false })
  });
  const accessToken = String(payload?.data?.accessToken || "").trim();
  if (!response.ok || !accessToken) {
    const error = new Error("MAPMS 账号同步服务认证失败");
    error.code = "MAPMS_ADMIN_AUTH_FAILED";
    error.status = 503;
    throw error;
  }
  const parsedExpiry = Date.parse(payload?.data?.expiresAt || "");
  mapmsAdminTokenCache = {
    accessToken,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 10 * 60 * 1000
  };
  return accessToken;
}

async function mapmsAdminRequest(pathname, { method = "GET", body, retry = true } = {}) {
  const accessToken = await requestMapmsAdminAccessToken();
  const { response, payload } = await fetchJsonWithTimeout(`${mapmsAdminBaseUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 401 && retry) {
    mapmsAdminTokenCache = { accessToken: "", expiresAt: 0 };
    await requestMapmsAdminAccessToken(true);
    return mapmsAdminRequest(pathname, { method, body, retry: false });
  }
  return { response, payload };
}

function mapmsIdentityText(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function mapmsProvisioningError(message, code = "MAPMS_ACCOUNT_CONFLICT") {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

async function queryMapmsAdminUsers(keywords) {
  const records = new Map();
  for (const keyword of [...new Set(keywords.map((value) => String(value || "").trim()).filter(Boolean))]) {
    const query = new URLSearchParams({ keyword, pageNo: "1", pageSize: "100" });
    const { response, payload } = await mapmsAdminRequest(`/organization/users?${query}`);
    if (!response.ok || String(payload?.code) !== "0") {
      throw mapmsProvisioningError("MAPMS 已有账号查询失败", "MAPMS_ACCOUNT_LOOKUP_FAILED");
    }
    for (const record of Array.isArray(payload?.data?.records) ? payload.data.records : []) {
      if (Number(record?.id) > 0) records.set(Number(record.id), record);
    }
  }
  return [...records.values()];
}

async function resolveExistingMapmsAdminUser(profile) {
  const records = await queryMapmsAdminUsers([
    profile.dingtalkUserId,
    profile.username,
    profile.realName
  ]);
  const sameDingtalkId = records.filter((record) => String(record?.dingTalkUserId || "").trim() === profile.dingtalkUserId);
  if (sameDingtalkId.length > 1) throw mapmsProvisioningError("同一个钉钉 userid 关联了多个 MAPMS 账号");
  if (sameDingtalkId.length === 1) return sameDingtalkId[0];

  const exactProfileMatches = records.filter((record) => (
    !String(record?.dingTalkUserId || "").trim()
    && mapmsIdentityText(record?.username) === mapmsIdentityText(profile.username)
    && mapmsIdentityText(record?.realName) === mapmsIdentityText(profile.realName)
    && Number(record?.departmentId) === profile.departmentId
  ));
  if (exactProfileMatches.length > 1) throw mapmsProvisioningError("MAPMS 中存在多个相同姓名和部门的账号，已停止自动绑定");
  if (exactProfileMatches.length === 1) return exactProfileMatches[0];

  const possibleConflicts = records.filter((record) => (
    mapmsIdentityText(record?.username) === mapmsIdentityText(profile.username)
    || mapmsIdentityText(record?.realName) === mapmsIdentityText(profile.realName)
  ));
  if (possibleConflicts.length > 0) {
    throw mapmsProvisioningError("MAPMS 中存在同名或同登录名账号，但信息不能唯一确认，已停止自动注册");
  }
  return null;
}

async function approveMapmsRegistration(userId) {
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
    throw mapmsProvisioningError("MAPMS 注册结果缺少有效用户 ID", "MAPMS_APPROVAL_FAILED");
  }
  const { response, payload } = await mapmsAdminRequest(`/organization/registration-approvals/${numericUserId}/approve`, {
    method: "PUT"
  });
  const alreadyProcessed = /已处理|already\s*processed/i.test(String(payload?.message || ""));
  if ((!response.ok || String(payload?.code) !== "0") && !alreadyProcessed) {
    throw mapmsProvisioningError(telemetryText(payload?.message || "MAPMS 注册审批失败", 180), "MAPMS_APPROVAL_FAILED");
  }
}

function mapmsDuplicateError(status, payload) {
  const message = `${payload?.code || ""} ${payload?.message || ""}`;
  return status === 409 || /(already\s*exists|duplicate|unique|已存在|重复|唯一)/i.test(message);
}

function mapmsInitialPassword() {
  return `Xm!9${crypto.randomBytes(24).toString("base64url")}`.slice(0, 40);
}

async function registerMissingMapmsUser(userKey) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user?.userId) throw new Error("客户端用户记录不存在");
  const username = telemetryText(user.name, 64);
  const realName = telemetryText(user.dingtalkRealName, 80);
  const dingtalkUserId = telemetryIdentifier(user.dingtalkUserId, 128);
  const departmentId = Number(user.mapmsDepartmentId || 0);
  const department = telemetryText(user.department, 120);
  if (!username || !realName || !dingtalkUserId || !department || !Number.isSafeInteger(departmentId) || departmentId <= 0) {
    const error = new Error("钉钉昵称、企业 userid、真实姓名或实际部门不完整，不能自动注册 MAPMS 用户");
    error.code = "DINGTALK_PROFILE_INCOMPLETE";
    error.status = 409;
    throw error;
  }
  const pathname = "/api/open/v1/platforms/me/users";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  let payload;
  try {
    response = await fetch(`${mapmsBaseUrl}${pathname}`, {
      method: "POST",
      headers: mapmsSignedHeaders("POST", pathname),
      body: JSON.stringify({
        username,
        password: mapmsInitialPassword(),
        departmentId,
        dingTalkUserId: dingtalkUserId,
        realName,
        remark: mapmsUserRemark
      }),
      signal: controller.signal
    });
    payload = await response.json().catch(() => ({}));
  } catch (error) {
    const unavailable = new Error(error?.name === "AbortError" ? "MAPMS 注册请求响应超时" : "MAPMS 注册服务连接失败");
    unavailable.code = "MAPMS_REGISTER_UNAVAILABLE";
    unavailable.status = 503;
    throw unavailable;
  } finally {
    clearTimeout(timer);
  }
  if (response.ok && String(payload?.code) === "0") {
    saveMapmsAuthorizationState(userKey, {
      status: "registered",
      mapmsStatus: "registered",
      code: payload?.code,
      message: "MAPMS 用户已创建，等待钉钉绑定校验",
      userId: payload?.data?.userId,
      userNo: payload?.data?.userNo,
      username,
      departmentId
    });
    return payload?.data || {};
  }
  if (mapmsDuplicateError(response.status, payload)) {
    const duplicate = new Error("MAPMS 已存在同名用户，请将该用户绑定当前钉钉账号");
    duplicate.code = "MAPMS_USERNAME_EXISTS_UNBOUND";
    duplicate.status = 409;
    throw duplicate;
  }
  const failed = new Error(telemetryText(payload?.message || `MAPMS 注册接口返回 ${response.status}`, 240));
  failed.code = telemetryIdentifier(payload?.code || "MAPMS_REGISTER_FAILED", 80);
  failed.status = response.status >= 400 && response.status < 500 ? 409 : 503;
  throw failed;
}

async function resolveOrRegisterMapmsUser(userKey) {
  if (mapmsResolutionJobs.has(userKey)) return mapmsResolutionJobs.get(userKey);
  const job = (async () => {
    await enrichTelemetryUser(userKey);
    try {
      return await performMapmsAuthorization(userKey);
    } catch (error) {
      if (error?.code === "MAPMS_APPROVAL_PENDING") {
        const pendingUserId = Number(readTelemetry().users?.[userKey]?.mapms?.userId || 0);
        if (!Number.isSafeInteger(pendingUserId) || pendingUserId <= 0) throw error;
        await approveMapmsRegistration(pendingUserId);
        return performMapmsAuthorization(userKey);
      }
      if (error?.code !== "MAPMS_USER_NOT_BOUND") throw error;
    }

    const user = readTelemetry().users?.[userKey];
    const profile = {
      username: telemetryText(user?.name, 64),
      realName: telemetryText(user?.dingtalkRealName, 80),
      dingtalkUserId: telemetryIdentifier(user?.dingtalkUserId, 128),
      departmentId: Number(user?.mapmsDepartmentId || 0)
    };
    if (!profile.username || !profile.realName || !profile.dingtalkUserId
      || !Number.isSafeInteger(profile.departmentId) || profile.departmentId <= 0) {
      throw mapmsProvisioningError("钉钉昵称、企业真实姓名、userid 或 MAPMS 部门不完整，已停止自动注册", "DINGTALK_PROFILE_INCOMPLETE");
    }

    const existingUser = await resolveExistingMapmsAdminUser(profile);
    if (existingUser) {
      throw mapmsProvisioningError("MAPMS 已存在该用户账号，但尚未绑定钉钉 userid；当前不会重复注册", "MAPMS_EXISTING_USER_UNBOUND");
    }

    const registered = await registerMissingMapmsUser(userKey);
    await approveMapmsRegistration(registered?.userId);
    return performMapmsAuthorization(userKey);
  })().finally(() => mapmsResolutionJobs.delete(userKey));
  mapmsResolutionJobs.set(userKey, job);
  return job;
}

function provisionTelemetryUser(userKey) {
  if (telemetryProvisionJobs.has(userKey)) return telemetryProvisionJobs.get(userKey);
  const job = (async () => {
    try {
      await enrichTelemetryUser(userKey);
    } catch (error) {
      saveTelemetryDirectoryError(userKey, error);
    }
    const currentUser = readTelemetry().users?.[userKey];
    if (currentUser?.dingtalkUserId) {
      try {
        await resolveOrRegisterMapmsUser(userKey);
      } catch {}
    }
    return readTelemetry().users?.[userKey]?.mapms;
  })().finally(() => telemetryProvisionJobs.delete(userKey));
  telemetryProvisionJobs.set(userKey, job);
  return job;
}

async function registerCurrentUserInMapms(request, response) {
  if (!allowTelemetryRequest(request, response, "mapms-register", 20, 60 * 1000)) return;
  const store = readTelemetry();
  const session = requireTelemetrySession(request, response, store);
  if (!session) return;
  try {
    try {
      await enrichTelemetryUser(session.userKey);
    } catch (error) {
      saveTelemetryDirectoryError(session.userKey, error);
    }
    const result = await resolveOrRegisterMapmsUser(session.userKey);
    sendJson(response, 200, { ok: true, status: "synced", mapmsUserId: result.mapmsUserId, checkedAt: result.checkedAt });
  } catch (error) {
    sendJson(response, Number(error?.status || 503), { error: String(error?.message || error), code: error?.code || "MAPMS_AUTHORIZATION_FAILED" });
  }
}

function saveMapmsAuthorizationState(userKey, value) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user) throw new Error("客户端用户记录不存在");
  user.mapms = {
    ...(user.mapms || {}),
    status: telemetryIdentifier(value.mapmsStatus || user.mapms?.status, 32),
    userId: Number.isSafeInteger(Number(value.userId)) ? Number(value.userId) : (user.mapms?.userId || null),
    userNo: telemetryText(value.userNo || user.mapms?.userNo, 80),
    username: telemetryText(value.username || user.mapms?.username, 80),
    departmentId: Number.isSafeInteger(Number(value.departmentId)) && Number(value.departmentId) > 0
      ? Number(value.departmentId)
      : (user.mapms?.departmentId || user.mapmsDepartmentId || null),
    authorizationStatus: telemetryIdentifier(value.status, 32),
    authorizationCheckedAt: new Date().toISOString(),
    authorizationCode: telemetryIdentifier(value.code, 80),
    authorizationMessage: telemetryText(value.message, 240)
  };
  if (!user.department && value.departmentName) user.department = telemetryText(value.departmentName, 120);
  if (!user.mapmsDepartmentId && Number(value.departmentId) > 0) user.mapmsDepartmentId = Number(value.departmentId);
  writeTelemetry(store);
  return user.mapms;
}

async function performMapmsAuthorization(userKey) {
  const store = readTelemetry();
  const user = store.users?.[userKey];
  if (!user?.userId) throw new Error("客户端用户记录不存在");
  if (!mapmsConfigured()) {
    const error = new Error("企业权限服务尚未配置，请联系管理员");
    error.code = "MAPMS_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!user.dingtalkUserId) {
    const error = new Error("无法确认当前钉钉企业身份，请重新登录");
    error.code = "DINGTALK_USER_ID_MISSING";
    error.status = 403;
    throw error;
  }

  const pathname = "/api/open/v1/platforms/me/users/dingtalk-sso";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  let payload;
  try {
    response = await fetch(`${mapmsBaseUrl}${pathname}`, {
      method: "POST",
      headers: mapmsSignedHeaders("POST", pathname),
      body: JSON.stringify({ DTUserId: user.dingtalkUserId, corpId: user.corpId || "" }),
      signal: controller.signal
    });
    payload = await response.json().catch(() => ({}));
  } catch (error) {
    saveMapmsAuthorizationState(userKey, {
      status: "error",
      code: "MAPMS_AUTHORIZATION_UNAVAILABLE",
      message: error?.name === "AbortError" ? "企业权限服务响应超时" : "企业权限服务连接失败"
    });
    const unavailable = new Error(error?.name === "AbortError" ? "企业权限服务响应超时，请稍后重试" : "企业权限服务暂不可用，请稍后重试");
    unavailable.code = "MAPMS_AUTHORIZATION_UNAVAILABLE";
    unavailable.status = 503;
    throw unavailable;
  } finally {
    clearTimeout(timer);
  }

  if (response.ok && String(payload?.code) === "0" && payload?.data?.verified === true && Number(payload?.data?.status) === 1) {
    saveMapmsAuthorizationState(userKey, {
      status: "allowed",
      mapmsStatus: "synced",
      code: payload?.code,
      message: "允许登录",
      userId: payload?.data?.userId,
      userNo: payload?.data?.userNo,
      username: payload?.data?.username,
      departmentId: payload?.data?.departmentId,
      departmentName: payload?.data?.departmentName
    });
    return {
      allowed: true,
      mapmsUserId: Number(payload?.data?.userId),
      departmentId: Number(payload?.data?.departmentId),
      checkedAt: new Date().toISOString()
    };
  }

  const upstreamMessage = telemetryText(payload?.message || "当前账号没有使用权限", 240);
  const unbound = /未绑定|not\s*bound/i.test(upstreamMessage);
  const approvalPending = String(payload?.code || "") === "40105" || /待审批|等待审批|pending\s*approval/i.test(upstreamMessage);
  const disabled = /禁用|锁定|不可登录|disabled|locked/i.test(upstreamMessage) || Number(payload?.data?.status) === 0;
  const message = approvalPending
    ? "当前账号正在开通，请稍后重试"
    : (unbound ? "当前账号尚未获得XMAI Studio使用权限，请联系管理员"
      : (disabled ? "当前账号已被管理员禁用，请联系管理员" : "当前账号没有XMAI Studio使用权限，请联系管理员"));
  const authorizationCode = approvalPending
    ? "MAPMS_APPROVAL_PENDING"
    : (unbound ? "MAPMS_USER_NOT_BOUND" : (disabled ? "MAPMS_USER_DISABLED" : "MAPMS_ACCESS_DENIED"));
  saveMapmsAuthorizationState(userKey, {
    status: "denied",
    mapmsStatus: approvalPending ? "pending_approval" : (unbound ? "unbound" : "denied"),
    code: payload?.code || String(response.status),
    message,
    userId: payload?.data?.userId
  });
  const denied = new Error(message);
  denied.code = authorizationCode;
  denied.status = approvalPending ? 409 : 403;
  throw denied;
}

async function authorizeCurrentUserInMapms(request, response) {
  if (!allowTelemetryRequest(request, response, "mapms-authorize", 30, 60 * 1000)) return;
  const store = readTelemetry();
  const session = requireTelemetrySession(request, response, store);
  if (!session) return;
  try {
    sendJson(response, 200, await performMapmsAuthorization(session.userKey));
  } catch (error) {
    sendJson(response, Number(error?.status || 503), {
      error: String(error?.message || error),
      code: error?.code || "MAPMS_AUTHORIZATION_FAILED"
    });
  }
}

function requireCompanySkillDesktopSession(request, response) {
  return requireTelemetrySession(request, response, readTelemetry());
}

async function requireAuthorizedCompanySkillDesktopSession(request, response) {
  const session = requireCompanySkillDesktopSession(request, response);
  if (!session) return null;
  try {
    const checkedAt = Date.parse(session.user?.mapms?.authorizationCheckedAt || "");
    const recentlyAllowed = session.user?.mapms?.authorizationStatus === "allowed"
      && Number.isFinite(checkedAt)
      && Date.now() - checkedAt < 5 * 60 * 1000;
    if (!recentlyAllowed) await performMapmsAuthorization(session.userKey);
    const refreshed = readTelemetry().users?.[session.userKey] || session.user;
    return { ...session, user: refreshed };
  } catch (error) {
    sendJson(response, Number(error?.status || 503), {
      error: String(error?.message || error),
      code: error?.code || "MAPMS_AUTHORIZATION_FAILED"
    });
    return null;
  }
}

async function refreshTelemetryAuthorizations() {
  if (telemetryAuthorizationRefreshJob) return telemetryAuthorizationRefreshJob;
  telemetryAuthorizationRefreshJob = (async () => {
    if (!mapmsConfigured()) return { checked: 0, allowed: 0, denied: 0 };
    const userKeys = Object.entries(readTelemetry().users || {})
      .filter(([, user]) => Boolean(user?.dingtalkUserId))
      .map(([userKey]) => userKey);
    let cursor = 0;
    let allowed = 0;
    let denied = 0;
    async function worker() {
      while (cursor < userKeys.length) {
        const userKey = userKeys[cursor];
        cursor += 1;
        try {
          await performMapmsAuthorization(userKey);
          allowed += 1;
        } catch {
          denied += 1;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, userKeys.length)) }, () => worker()));
    return { checked: userKeys.length, allowed, denied, refreshedAt: new Date().toISOString() };
  })().finally(() => { telemetryAuthorizationRefreshJob = null; });
  return telemetryAuthorizationRefreshJob;
}

function telemetryAdminRows(search = "") {
  const now = Date.now();
  const query = telemetryText(search, 120).toLocaleLowerCase("zh-CN");
  return statisticalTelemetryEntries().map(([, user]) => {
    const devices = Object.values(user.devices || {});
    const online = devices.some((device) => !device.disconnectedAt && now - new Date(device.lastSeenAt || 0).getTime() <= telemetryOnlineWindowMs);
    const versions = [...new Set(devices.map((device) => device.appVersion).filter(Boolean))];
    return {
      userId: user.userId,
      name: user.name,
      corpId: user.corpId,
      department: user.department || "",
      firstSeenAt: user.firstSeenAt,
      lastSeenAt: user.lastSeenAt,
      online,
      deviceCount: devices.length,
      versions,
      usage: user.usage || {},
      mapms: user.mapms || null
    };
  }).filter((user) => !query || [user.userId, user.name, user.corpId, user.department, ...user.versions]
    .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query)))
    .sort((left, right) => new Date(right.lastSeenAt || 0) - new Date(left.lastSeenAt || 0));
}

function telemetryOverview() {
  const store = readTelemetry();
  const users = statisticalTelemetryEntries(store).map(([, user]) => user);
  const rows = telemetryAdminRows();
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const versionDistribution = {};
  let deviceCount = 0;
  for (const user of users) {
    for (const device of Object.values(user.devices || {})) {
      deviceCount += 1;
      const version = device.appVersion || "未知";
      versionDistribution[version] = Number(versionDistribution[version] || 0) + 1;
    }
  }
  return {
    totalUsers: users.length,
    onlineUsers: rows.filter((row) => row.online).length,
    activeToday: users.filter((user) => new Date(user.lastSeenAt || 0).getTime() >= today.getTime()).length,
    activeSevenDays: users.filter((user) => now - new Date(user.lastSeenAt || 0).getTime() <= 7 * 24 * 60 * 60 * 1000).length,
    totalDevices: deviceCount,
    versionDistribution
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function sendTelemetryCsv(response, rows) {
  const headers = ["姓名", "钉钉用户ID", "企业ID", "部门", "软件版本", "设备数", "首次使用时间", "最后活跃时间", "在线状态", "MAPMS同步状态", "MAPMS用户ID"];
  const lines = [headers, ...rows.map((user) => [
    user.name,
    user.userId,
    user.corpId,
    user.department,
    user.versions.join(" / "),
    user.deviceCount,
    user.firstSeenAt,
    user.lastSeenAt,
    user.online ? "在线" : "离线",
    user.mapms?.status || "",
    user.mapms?.userId || ""
  ])].map((row) => row.map(csvCell).join(","));
  const body = Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
  response.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-length": body.length,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`先马AI-Studio-使用统计-${new Date().toISOString().slice(0, 10)}.csv`)}`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function compareVersions(left, right) {
  const a = String(left || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function incrementPatch(version) {
  const parts = String(version || "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

function safeFileName(value) {
  const name = path.basename(String(value || "update.exe")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return name.toLowerCase().endsWith(".exe") ? name : `${name || "update"}.exe`;
}

function safeReleaseId(value) {
  return String(value || "release").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100) || "release";
}

function normalizeReleaseMetadata(source) {
  const value = (name, fallback = "") => String(source?.[name] ?? fallback).trim();
  return {
    displayVersion: value("displayVersion"),
    internalVersion: value("internalVersion"),
    title: value("title", "版本更新").slice(0, 120),
    notes: String(source?.notes || "").slice(0, 20000),
    force: source?.force === true || source?.force === "1",
    channel: value("channel", "stable-v2").slice(0, 30) || "stable-v2",
    platform: value("platform", "win32").slice(0, 30) || "win32",
    arch: value("arch", "x64").slice(0, 30) || "x64",
    fileName: safeFileName(source?.fileName)
  };
}

function validateReleaseMetadata(metadata) {
  if (!/^\d+(?:\.\d+){1,3}$/.test(metadata.displayVersion) || !/^\d+(?:\.\d+){1,3}$/.test(metadata.internalVersion)) {
    throw new Error("显示版本和内部版本必须是数字版本号，例如 1.0.2 和 1.0.2");
  }
}

function ensureVersionAvailable(metadata) {
  const internalVersion = String(metadata?.internalVersion || "");
  const channel = String(metadata?.channel || "stable-v2");
  const platform = String(metadata?.platform || "win32");
  const arch = String(metadata?.arch || "x64");
  const exists = readReleases().releases.some((release) => (
    release.payload.internalVersion === internalVersion
    && release.payload.channel === channel
    && release.payload.platform === platform
    && release.payload.arch === arch
    && release.status === "published"
  ));
  if (exists) throw new Error("这个内部版本已经上传过，请填写更高的内部版本");
}

function uploadDirectory(uploadId) {
  return path.join(uploadsRoot, safeReleaseId(uploadId));
}

function uploadSessionPath(uploadId) {
  return path.join(uploadDirectory(uploadId), "session.json");
}

function readUploadSession(uploadId) {
  const safeId = safeReleaseId(uploadId);
  const session = JSON.parse(fs.readFileSync(uploadSessionPath(safeId), "utf8"));
  if (session.uploadId !== safeId) throw new Error("上传会话无效");
  return session;
}

function writeUploadSession(session) {
  const directory = uploadDirectory(session.uploadId);
  fs.mkdirSync(directory, { recursive: true });
  const targetPath = uploadSessionPath(session.uploadId);
  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(session, null, 2), "utf8");
  fs.renameSync(temporaryPath, targetPath);
}

function expectedChunkSize(session, index) {
  const offset = index * session.chunkSize;
  return Math.max(0, Math.min(session.chunkSize, session.fileSize - offset));
}

function chunkPath(session, index) {
  return path.join(uploadDirectory(session.uploadId), `${index}.part`);
}

function uploadedChunkIndexes(session) {
  const uploaded = [];
  for (let index = 0; index < session.chunkCount; index += 1) {
    const targetPath = chunkPath(session, index);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size === expectedChunkSize(session, index)) uploaded.push(index);
  }
  return uploaded;
}

function cleanupStaleUploads() {
  const cutoff = Date.now() - uploadSessionMaxAgeMs;
  for (const entry of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(uploadsRoot, entry.name);
    try {
      const session = JSON.parse(fs.readFileSync(path.join(directory, "session.json"), "utf8"));
      if (new Date(session.updatedAt || session.createdAt || 0).getTime() < cutoff) fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      if (fs.statSync(directory).mtimeMs < cutoff) fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function isAdmin(request) {
  const value = String(request.headers.authorization || "");
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(adminToken);
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: "管理密码不正确" });
  return false;
}

function requireManagement(request, response) {
  return v11ManagementPublic || requireAdmin(request, response);
}

function companySkillPreviewCookieValue() {
  if (!companySkillAdminPreviewPath) return "";
  return crypto.createHmac("sha256", adminToken)
    .update(`company-skill-admin-preview:${companySkillAdminPreviewPath}`)
    .digest("base64url");
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return "";
}

function hasCompanySkillPreviewAccess(request) {
  const actual = Buffer.from(cookieValue(request, "xianma_company_skill_preview"));
  const expected = Buffer.from(companySkillPreviewCookieValue());
  return expected.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function adminPage(companySkillsVisible) {
  const source = fs.readFileSync(v11AdminUiEnabled ? adminV11HtmlPath : adminHtmlPath, "utf8");
  const features = JSON.stringify({ companySkills: companySkillsVisible === true });
  return Buffer.from(source.replace("</head>", `<script>window.__XIANMA_ADMIN_FEATURES__ = Object.freeze(${features});</script>\n</head>`), "utf8");
}

function serveAdminV11Asset(response, filePath, contentType) {
  if (!v11AdminUiEnabled || !fs.existsSync(filePath)) return false;
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
  return true;
}

function readRequestBody(request, maximumBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maximumBytes) {
        reject(new Error("请求内容过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

async function readJsonBody(request, maximumBytes = 256 * 1024) {
  const body = await readRequestBody(request, maximumBytes);
  try {
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    throw new Error("JSON 格式无效");
  }
}

function signedEnvelope(payload) {
  const signed = Buffer.from(JSON.stringify(payload), "utf8");
  return {
    signed: signed.toString("base64url"),
    signature: crypto.sign(null, signed, privateKeyPem).toString("base64url")
  };
}

function publishEvent(type, value) {
  const body = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
  for (const response of sseClients) {
    try { response.write(body); } catch { sseClients.delete(response); }
  }
}

function latestRelease(searchParams) {
  const channel = searchParams.get("channel") || "stable";
  const platform = searchParams.get("platform") || "win32";
  const arch = searchParams.get("arch") || "x64";
  const current = searchParams.get("current") || "0";
  return readReleases().releases
    .filter((release) => release.status === "published" && release.payload.channel === channel && release.payload.platform === platform)
    .filter((release) => release.payload.arch === arch || release.payload.arch === "any")
    .filter((release) => compareVersions(release.payload.internalVersion, current) > 0)
    .sort((left, right) => compareVersions(right.payload.internalVersion, left.payload.internalVersion))[0] || null;
}

function publicDownloadRelease(version = "latest") {
  const releases = readReleases().releases
    .filter((release) => release.status === "published")
    .filter((release) => release.payload.channel === "stable-v2" && release.payload.platform === "win32")
    .filter((release) => release.payload.arch === "x64" || release.payload.arch === "any")
    .filter((release) => version === "latest" || release.payload.displayVersion === version)
    .sort((left, right) => {
      const compared = compareVersions(right.payload.internalVersion, left.payload.internalVersion);
      return compared || new Date(right.payload.publishedAt || 0) - new Date(left.payload.publishedAt || 0);
    });
  return releases[0] || null;
}

function streamUpload(request, targetPath, expectedLength) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const output = fs.createWriteStream(targetPath, { flags: "wx" });
    let bytes = 0;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      output.destroy();
      fs.rmSync(targetPath, { force: true });
      reject(error);
    };
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumUploadBytes) {
        fail(new Error("安装包超过服务器允许的大小"));
        request.destroy();
        return;
      }
      hash.update(chunk);
    });
    request.on("error", fail);
    request.on("aborted", () => fail(new Error("安装包上传中断，可以重新上传继续")));
    output.on("error", fail);
    output.on("finish", () => {
      if (failed) return;
      if (expectedLength > 0 && bytes !== expectedLength) return fail(new Error("安装包上传不完整"));
      resolve({ bytes, sha256: hash.digest("hex") });
    });
    request.pipe(output);
  });
}

function streamChunk(request, targetPath, expectedLength) {
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
        fail(new Error("上传分片大小不正确"));
        request.destroy();
      }
    });
    request.on("error", fail);
    request.on("aborted", () => fail(new Error("上传分片中断")));
    output.on("error", fail);
    output.on("finish", () => {
      if (failed) return;
      if (bytes !== expectedLength) return fail(new Error("上传分片不完整"));
      fs.rmSync(targetPath, { force: true });
      fs.renameSync(temporaryPath, targetPath);
      resolve({ bytes });
    });
    request.pipe(output);
  });
}

async function initializeChunkedUpload(request, response) {
  if (!requireAdmin(request, response)) return;
  try {
    cleanupStaleUploads();
    const body = await readJsonBody(request);
    const metadata = normalizeReleaseMetadata(body);
    validateReleaseMetadata(metadata);
    ensureVersionAvailable(metadata);
    const fileSize = Number(body.fileSize || 0);
    if (!Number.isSafeInteger(fileSize) || fileSize < 1024) throw new Error("安装包内容过小，请选择真实的 EXE 安装包");
    if (fileSize > maximumUploadBytes) throw new Error("安装包超过服务器允许的大小");
    // The V1.1 admin page uses a metadata fingerprint (name-size-mtime), while
    // the legacy page sends a hexadecimal digest. Preserve either format.
    const fileFingerprint = String(body.fileFingerprint || "").trim().slice(0, 128);
    if (fileFingerprint.length < 16) throw new Error("无法识别安装包，请重新选择文件");

    const requestedId = String(body.resumeId || "").trim();
    let session = null;
    if (requestedId && fs.existsSync(uploadSessionPath(requestedId))) {
      session = readUploadSession(requestedId);
      if (session.fileFingerprint !== fileFingerprint || session.fileSize !== fileSize || session.internalVersion !== metadata.internalVersion || session.channel !== metadata.channel || session.platform !== metadata.platform || session.arch !== metadata.arch || session.fileName !== metadata.fileName) {
        throw new Error("之前的上传记录与当前安装包不一致，请重新选择文件后再试");
      }
      Object.assign(session, metadata, { updatedAt: new Date().toISOString() });
    } else {
      const uploadId = safeReleaseId(`${metadata.channel}-${metadata.platform}-${metadata.arch}-${metadata.internalVersion}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`);
      session = {
        schemaVersion: 1,
        uploadId,
        ...metadata,
        fileSize,
        fileFingerprint,
        chunkSize: uploadChunkBytes,
        chunkCount: Math.ceil(fileSize / uploadChunkBytes),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    writeUploadSession(session);
    sendJson(response, 201, {
      uploadId: session.uploadId,
      chunkSize: session.chunkSize,
      chunkCount: session.chunkCount,
      uploadedChunks: uploadedChunkIndexes(session)
    });
  } catch (error) {
    const message = String(error?.message || error);
    sendJson(response, /已经上传过/.test(message) ? 409 : 400, { error: message });
  }
}

async function uploadReleaseChunk(request, response, uploadId, indexValue) {
  if (!requireAdmin(request, response)) return;
  try {
    const session = readUploadSession(uploadId);
    const index = Number(indexValue);
    if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) throw new Error("上传分片编号无效");
    const expectedLength = expectedChunkSize(session, index);
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength !== expectedLength) throw new Error("上传分片大小不正确");
    await streamChunk(request, chunkPath(session, index), expectedLength);
    session.updatedAt = new Date().toISOString();
    writeUploadSession(session);
    sendJson(response, 200, { ok: true, index, bytes: expectedLength });
  } catch (error) {
    sendJson(response, 400, { error: String(error?.message || error) });
  }
}

async function completeChunkedUpload(request, response, uploadId) {
  if (!requireAdmin(request, response)) return;
  let releaseRoot = "";
  try {
    const session = readUploadSession(uploadId);
    ensureVersionAvailable(session);
    const uploaded = new Set(uploadedChunkIndexes(session));
    const missing = Array.from({ length: session.chunkCount }, (_, index) => index).filter((index) => !uploaded.has(index));
    if (missing.length) throw new Error(`安装包尚未上传完整，还缺少 ${missing.length} 个分片`);

    const releaseId = safeReleaseId(`${session.channel}-${session.platform}-${session.arch}-${session.internalVersion}-${Date.now()}`);
    releaseRoot = path.join(filesRoot, releaseId);
    fs.mkdirSync(releaseRoot, { recursive: true });
    const temporaryPath = path.join(releaseRoot, `${session.fileName}.uploading`);
    const output = await fs.promises.open(temporaryPath, "wx");
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    try {
      for (let index = 0; index < session.chunkCount; index += 1) {
        const chunk = await fs.promises.readFile(chunkPath(session, index));
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const written = await output.write(chunk, offset, chunk.length - offset, bytes + offset);
          if (!written.bytesWritten) throw new Error("安装包合并写入失败");
          offset += written.bytesWritten;
        }
        bytes += chunk.length;
      }
      await output.sync();
    } finally {
      await output.close();
    }
    if (bytes !== session.fileSize) throw new Error("安装包合并后大小不一致，请继续上传重试");
    const finalPath = path.join(releaseRoot, session.fileName);
    fs.renameSync(temporaryPath, finalPath);
    const publishedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      releaseId,
      channel: session.channel,
      platform: session.platform,
      arch: session.arch,
      displayVersion: session.displayVersion,
      internalVersion: session.internalVersion,
      title: session.title,
      notes: session.notes,
      force: session.force,
      publishedAt,
      fileName: session.fileName,
      size: bytes,
      sha256: hash.digest("hex"),
      downloadPath: `downloads/${releaseId}/${encodeURIComponent(session.fileName)}`
    };
    const store = readReleases();
    const envelope = signedEnvelope(payload);
    store.releases.push({ status: "published", createdAt: publishedAt, payload, ...envelope });
    writeReleases(store);
    fs.rmSync(uploadDirectory(session.uploadId), { recursive: true, force: true });
    publishEvent("release", { releaseId, internalVersion: session.internalVersion, displayVersion: session.displayVersion, publishedAt });
    sendJson(response, 201, { ok: true, release: payload });
  } catch (error) {
    if (releaseRoot) fs.rmSync(releaseRoot, { recursive: true, force: true });
    const message = String(error?.message || error);
    sendJson(response, /已经上传过/.test(message) ? 409 : 400, { error: message });
  }
}

async function uploadRelease(request, response, url) {
  if (!requireAdmin(request, response)) return;
  const displayVersion = String(url.searchParams.get("displayVersion") || "").trim();
  const internalVersion = String(url.searchParams.get("internalVersion") || "").trim();
  const title = String(url.searchParams.get("title") || "版本更新").trim().slice(0, 120);
  const notes = Buffer.from(String(url.searchParams.get("notes") || ""), "base64url").toString("utf8").slice(0, 20000);
  const force = url.searchParams.get("force") === "1";
  const channel = String(url.searchParams.get("channel") || "stable-v2").trim().slice(0, 30) || "stable-v2";
  const platform = String(url.searchParams.get("platform") || "win32").trim().slice(0, 30) || "win32";
  const arch = String(url.searchParams.get("arch") || "x64").trim().slice(0, 30) || "x64";
  const fileName = safeFileName(url.searchParams.get("fileName"));
  if (!/^\d+(?:\.\d+){1,3}$/.test(displayVersion) || !/^\d+(?:\.\d+){1,3}$/.test(internalVersion)) {
    sendJson(response, 400, { error: "显示版本和内部版本必须是数字版本号，例如 1.0.2 和 1.0.2" });
    return;
  }
  const store = readReleases();
  try {
    ensureVersionAvailable({ internalVersion, channel, platform, arch });
  } catch (error) {
    sendJson(response, 409, { error: String(error?.message || error) });
    return;
  }

  const releaseId = safeReleaseId(`${channel}-${platform}-${arch}-${internalVersion}-${Date.now()}`);
  const releaseRoot = path.join(filesRoot, releaseId);
  fs.mkdirSync(releaseRoot, { recursive: true });
  const temporaryPath = path.join(releaseRoot, `${fileName}.uploading`);
  try {
    const expectedLength = Number(request.headers["content-length"] || 0);
    if (expectedLength > maximumUploadBytes) throw new Error("安装包超过服务器允许的大小");
    const uploaded = await streamUpload(request, temporaryPath, expectedLength);
    if (uploaded.bytes < 1024) throw new Error("安装包内容过小，请选择真实的 EXE 安装包");
    const finalPath = path.join(releaseRoot, fileName);
    fs.renameSync(temporaryPath, finalPath);
    const publishedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      releaseId,
      channel,
      platform,
      arch,
      displayVersion,
      internalVersion,
      title,
      notes,
      force,
      publishedAt,
      fileName,
      size: uploaded.bytes,
      sha256: uploaded.sha256,
      downloadPath: `downloads/${releaseId}/${encodeURIComponent(fileName)}`
    };
    const envelope = signedEnvelope(payload);
    store.releases.push({ status: "published", createdAt: publishedAt, payload, ...envelope });
    writeReleases(store);
    publishEvent("release", { releaseId, internalVersion, displayVersion, publishedAt });
    sendJson(response, 201, { ok: true, release: payload });
  } catch (error) {
    fs.rmSync(releaseRoot, { recursive: true, force: true });
    sendJson(response, 400, { error: String(error?.message || error) });
  }
}

function serveDownload(request, response, pathname) {
  const match = pathname.match(/^\/downloads\/([^/]+)\/([^/]+)$/);
  if (!match) return false;
  const releaseId = safeReleaseId(decodeURIComponent(match[1]));
  const fileName = safeFileName(decodeURIComponent(match[2]));
  const store = readReleases();
  const release = store.releases.find((item) => item.payload.releaseId === releaseId && item.payload.fileName === fileName && item.status === "published");
  if (!release) {
    sendJson(response, 404, { error: "安装包不存在或已撤回" });
    return true;
  }
  const filePath = path.join(filesRoot, releaseId, fileName);
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "安装包文件不存在" });
    return true;
  }
  const stat = fs.statSync(filePath);
  const range = String(request.headers.range || "").match(/^bytes=(\d+)-(\d*)$/);
  const headers = {
    "content-type": "application/vnd.microsoft.portable-executable",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff"
  };
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(stat.size - 1, Number(range[2])) : stat.size - 1;
    if (start > end || start >= stat.size) {
      response.writeHead(416, { "content-range": `bytes */${stat.size}` });
      response.end();
      return true;
    }
    response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
    fs.createReadStream(filePath, { start, end }).pipe(response);
    return true;
  }
  response.writeHead(200, { ...headers, "content-length": stat.size });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (requirementIntake && await requirementIntake.handleRequest(request, response, url, pathname)) return;
  if (requirementIntake && request.method === "POST" && ["/v1/images/generations", "/v1/images/edits"].includes(pathname)) {
    if (!requireTelemetrySession(request, response, readTelemetry())) return;
    await require("./preview-image-proxy").forwardPreviewImage(request, response, { baseUrl: modelGatewayGptBaseUrl, apiKey: modelGatewayGptApiKey, sendJson });
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    const health = {
      ok: true,
      service: "xianma-update-service",
      v11StorageMode: v11Platform?.storageMode || "initializing",
      requirementIntake: requirementIntake ? "enabled" : "disabled",
      time: new Date().toISOString()
    };
    if (process.env.MODEL_GATEWAY_TEST_DIAGNOSTICS === "1") {
      health.modelGateway = {
        configured: modelGatewayConfigured(),
        gptActive: activeGptModelRequests,
        gptLimit: modelGatewayGptMaxConcurrency,
        fallbackConfigured: Boolean(modelGatewayFallbackBaseUrl && modelGatewayFallbackApiKey && modelGatewayFallbackModel),
        errorFallbackConfigured: modelGatewayErrorFallbackConfigured()
      };
    }
    sendJson(response, 200, health);
    return;
  }
  if (previewModelSelection && request.method === "GET" && pathname === "/api/desktop/models") {
    const session = requireTelemetrySession(request, response, readTelemetry());
    if (!session) return;
    sendJson(response, 200, await require("./preview-model-catalog").catalog());
    return;
  }
  if (request.method === "POST" && pathname === "/v1/chat/completions") {
    await routeDesktopChatCompletion(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/api/desktop/model-mode") {
    const session = requireTelemetrySession(request, response, readTelemetry());
    if (!session) return;
    sendJson(response, 200, { modelMode: currentModelMode(telemetryBearerToken(request)) });
    return;
  }
  if (request.method === "POST" && pathname === "/api/integrations/prompt-portal/session/verify") {
    await verifyPromptPortalDesktopSession(request, response, pathname);
    return;
  }
  const publicDownloadMatch = pathname.match(/^\/download\/(latest|\d+(?:\.\d+){1,3})$/);
  if (request.method === "GET" && publicDownloadMatch) {
    const release = publicDownloadRelease(publicDownloadMatch[1]);
    if (!release) {
      sendJson(response, 404, { error: "没有找到可下载的正式安装包" });
      return;
    }
    serveDownload(request, response, `/${release.payload.downloadPath}`);
    return;
  }
  if (request.method === "GET" && companySkillPlatformEnabled && companySkillAdminPreviewPath && pathname === `/admin/${companySkillAdminPreviewPath}`) {
    response.writeHead(302, {
      location: "../admin?company-skills-preview=1",
      "set-cookie": `xianma_company_skill_preview=${companySkillPreviewCookieValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    });
    response.end();
    return;
  }
  if (request.method === "GET" && (pathname === "/admin" || pathname === "/admin/index.html")) {
    const previewRequested = url.searchParams.get("company-skills-preview") === "1";
    const companySkillsVisible = companySkillPlatformEnabled
      && (companySkillAdminPublic || (previewRequested && hasCompanySkillPreviewAccess(request)));
    const body = adminPage(companySkillsVisible);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "content-security-policy": `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors ${normalizedAdminFrameAncestors()}`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    });
    response.end(body);
    return;
  }
  if (request.method === "GET" && pathname === "/admin/v11.css" && serveAdminV11Asset(response, adminV11CssPath, "text/css; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/admin/v11-theme.css" && serveAdminV11Asset(response, adminV11ThemePath, "text/css; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/admin/v11.js" && serveAdminV11Asset(response, adminV11JsPath, "text/javascript; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/admin/requirements.js" && serveAdminV11Asset(response, path.join(__dirname, "public", "requirements.js"), "text/javascript; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/admin/requirements.css" && serveAdminV11Asset(response, path.join(__dirname, "public", "requirements.css"), "text/css; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/admin/v11-icon.png" && serveAdminV11Asset(response, adminV11IconPath, "image/png")) return;
  if (request.method === "GET" && pathname === "/admin/jszip.min.js" && serveAdminV11Asset(response, adminV11JsZipPath, "text/javascript; charset=utf-8")) return;
  if (request.method === "GET" && pathname === "/api/app-updates/latest") {
    const release = latestRelease(url.searchParams);
    if (!release) {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    sendJson(response, 200, { signed: release.signed, signature: release.signature });
    return;
  }
  if (request.method === "GET" && pathname === "/api/app-updates/public-key") {
    sendJson(response, 200, { algorithm: "Ed25519", publicKey: publicKeyPem });
    return;
  }
  if (request.method === "GET" && pathname === "/api/app-updates/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    sseClients.add(response);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25000);
    request.on("close", () => { clearInterval(heartbeat); sseClients.delete(response); });
    return;
  }
  if (request.method === "POST" && pathname === "/api/app-updates/report") {
    try {
      const report = await readJsonBody(request, 64 * 1024);
      fs.mkdirSync(path.dirname(reportsPath), { recursive: true });
      fs.appendFileSync(reportsPath, `${JSON.stringify({ receivedAt: new Date().toISOString(), ip: request.socket.remoteAddress || "", ...report })}\n`, "utf8");
      sendJson(response, 202, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
    return;
  }
  if (request.method === "POST" && pathname === "/api/desktop/register") {
    await registerDesktopTelemetry(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/desktop/heartbeat") {
    await heartbeatDesktopTelemetry(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/desktop/events") {
    await recordDesktopTelemetryEvents(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/desktop/mapms/register") {
    await registerCurrentUserInMapms(request, response);
    return;
  }
  if (request.method === "POST" && pathname === "/api/desktop/mapms/authorize") {
    await authorizeCurrentUserInMapms(request, response);
    return;
  }
  if (v11Platform && await v11Platform.handleRequest(request, response, url, pathname)) return;
  if (companySkillPlatform && await companySkillPlatform.handleRequest(request, response, url, pathname)) return;
  if (request.method === "POST" && pathname === "/api/admin/telemetry/refresh") {
    if (!allowTelemetryRequest(request, response, "telemetry-admin-refresh", 12, 60 * 1000)) return;
    sendJson(response, 200, await refreshTelemetryAuthorizations());
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/telemetry/overview") {
    sendJson(response, 200, telemetryOverview());
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/telemetry/users") {
    sendJson(response, 200, { users: telemetryAdminRows(url.searchParams.get("search") || "") });
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/telemetry/export") {
    sendTelemetryCsv(response, telemetryAdminRows(url.searchParams.get("search") || ""));
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/releases") {
    if (!requireAdmin(request, response)) return;
    const store = readReleases();
    const channel = String(url.searchParams.get("channel") || "stable-v2").trim().slice(0, 30) || "stable-v2";
    const platform = String(url.searchParams.get("platform") || "win32").trim().slice(0, 30) || "win32";
    const arch = String(url.searchParams.get("arch") || "x64").trim().slice(0, 30) || "x64";
    const versions = store.releases
      .filter((release) => release.payload.channel === channel && release.payload.platform === platform && release.payload.arch === arch)
      .map((release) => release.payload.internalVersion)
      .sort(compareVersions);
    const highest = versions.at(-1) || minimumNextInternalVersion;
    const suggestedInternalVersion = versions.length ? incrementPatch(highest) : minimumNextInternalVersion;
    sendJson(response, 200, {
      publicBaseUrl,
      channel,
      platform,
      arch,
      suggestedInternalVersion,
      releases: store.releases.slice().reverse().map((release) => ({ status: release.status, ...release.payload }))
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/admin/releases/uploads") {
    await initializeChunkedUpload(request, response);
    return;
  }
  const chunkUploadMatch = pathname.match(/^\/api\/admin\/releases\/uploads\/([^/]+)\/chunks\/(\d+)$/);
  if (request.method === "PUT" && chunkUploadMatch) {
    await uploadReleaseChunk(request, response, decodeURIComponent(chunkUploadMatch[1]), chunkUploadMatch[2]);
    return;
  }
  const completeUploadMatch = pathname.match(/^\/api\/admin\/releases\/uploads\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeUploadMatch) {
    await completeChunkedUpload(request, response, decodeURIComponent(completeUploadMatch[1]));
    return;
  }
  if (request.method === "POST" && pathname === "/api/admin/releases/upload") {
    await uploadRelease(request, response, url);
    return;
  }
  const revokeMatch = pathname.match(/^\/api\/admin\/releases\/([^/]+)\/revoke$/);
  if (request.method === "POST" && revokeMatch) {
    if (!requireAdmin(request, response)) return;
    const releaseId = safeReleaseId(decodeURIComponent(revokeMatch[1]));
    const store = readReleases();
    const release = store.releases.find((item) => item.payload.releaseId === releaseId);
    if (!release) {
      sendJson(response, 404, { error: "版本不存在" });
      return;
    }
    release.status = "revoked";
    release.revokedAt = new Date().toISOString();
    writeReleases(store);
    publishEvent("revoked", { releaseId });
    sendJson(response, 200, { ok: true });
    return;
  }
  const deleteMatch = pathname.match(/^\/api\/admin\/releases\/([^/]+)\/delete$/);
  if (request.method === "POST" && deleteMatch) {
    if (!requireAdmin(request, response)) return;
    const releaseId = safeReleaseId(decodeURIComponent(deleteMatch[1]));
    const store = readReleases();
    const release = store.releases.find((item) => item.payload.releaseId === releaseId);
    if (!release) {
      sendJson(response, 404, { error: "版本不存在" });
      return;
    }
    if (release.status !== "revoked") {
      sendJson(response, 409, { error: "只能永久删除已经撤回的版本" });
      return;
    }
    fs.rmSync(path.join(filesRoot, releaseId), { recursive: true, force: true });
    release.status = "deleted";
    release.deletedAt = new Date().toISOString();
    writeReleases(store);
    publishEvent("deleted", { releaseId });
    sendJson(response, 200, { ok: true, releaseId, deletedAt: release.deletedAt });
    return;
  }
  if (request.method === "GET" && serveDownload(request, response, pathname)) return;
  sendJson(response, 404, { error: "接口不存在" });
}

if (companySkillPlatformEnabled) {
  companySkillPlatform = createCompanySkillPlatform({
    dataRoot,
    uploadChunkBytes,
    uploadSessionMaxAgeMs,
    maximumUploadBytes,
    privateKeyPem,
    publicBaseUrl,
    sendJson,
    readJsonBody,
    requireDesktopSession: requireCompanySkillDesktopSession,
    requireAuthorizedDesktopSession: requireAuthorizedCompanySkillDesktopSession,
    requireAdmin: requireManagement,
    isExcludedIdentity: isTelemetryExcludedIdentity,
    resolveSkillTaxonomy: (...args) => {
      if (!v11Platform?.resolveSkillTaxonomy) throw new Error("技能分类服务尚未就绪，请稍后重试");
      return v11Platform.resolveSkillTaxonomy(...args);
    }
  });
  const telemetryAtStartup = readTelemetry();
  if (companySkillPlatform.migrateTelemetryStore(telemetryAtStartup)) writeTelemetry(telemetryAtStartup);
}

v11Platform = createV11Platform({
  dataRoot,
  sendJson,
  readJsonBody,
  requireAdmin,
  requireManagement,
  requireAuthorizedDesktopSession: requireAuthorizedCompanySkillDesktopSession,
  readTelemetry,
  isExcludedIdentity: isTelemetryExcludedIdentity
});
v11Platform.ready.catch((error) => {
  process.stderr.write(`v1.1 platform initialization failed: ${String(error?.message || error).slice(0, 300)}\n`);
});

if (process.env.ENABLE_REQUIREMENT_INTAKE === "1") {
  if (!publicBaseUrl.includes("/studio-v11-") || !String(process.env.DATABASE_URL).includes("xianma_v11_preview")) throw new Error("Requirement intake must run in the isolated preview environment");
  requirementIntake = require("./requirement-intake/service").createIntake({
    sendJson, readJsonBody, requireManagement,
    async verifyIdentity(accessToken) {
      const { response, payload } = await fetchJsonWithTimeout("https://api.dingtalk.com/v1.0/contact/users/me", { headers: { "x-acs-dingtalk-access-token": accessToken } });
      if (!response.ok || !payload.unionId) throw Object.assign(new Error("钉钉登录已失效，请重新登录"), { status: 401, code: "LOGIN_REQUIRED" });
      const enterpriseId = await requestDingtalkEnterpriseUserId(payload.unionId);
      const detail = await requestDingtalkUserDetail(enterpriseId);
      const directory = await requestMapmsDingtalkDirectory(detail.name || "");
      const member = directory.users.find(item => String(item.dingTalkUserId) === enterpriseId);
      if (!member || Number(member.status) === 0) throw Object.assign(new Error("当前用户不在可用的企业组织目录中"), { status: 403, code: "MEMBERSHIP_REQUIRED" });
      return { ownerKey: crypto.createHash("sha256").update(`${telemetryAllowedCorpId}:${payload.unionId}`).digest("hex"), name: String(payload.nick || member.realName || detail.name || "钉钉用户").slice(0, 80), department: String(member.departmentName || "").slice(0, 120) };
    }
  });
  requirementIntake.ready.catch(() => process.stderr.write("requirement-intake initialization failed\n"));
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => sendJson(response, 500, { error: String(error?.message || error) }));
});

// Large uploads are split into retryable chunks, while the legacy endpoint remains unlimited for compatibility.
server.requestTimeout = 0;

server.listen(port, host, () => {
  process.stdout.write(`xianma-update-service listening on ${host}:${port}\n`);
  const timer = setTimeout(() => {
    for (const userKey of Object.keys(readTelemetry().users || {})) {
      provisionTelemetryUser(userKey).catch((error) => {
        process.stderr.write(`telemetry backfill failed for ${userKey.slice(0, 12)}: ${String(error?.message || error).slice(0, 240)}\n`);
      });
    }
  }, 500);
  timer.unref();
  const authorizationRefreshTimer = setInterval(() => {
    refreshTelemetryAuthorizations().catch((error) => {
      process.stderr.write(`telemetry authorization refresh failed: ${String(error?.message || error).slice(0, 240)}\n`);
    });
  }, 60 * 1000);
  authorizationRefreshTimer.unref();
});

function shutdown() {
  for (const response of sseClients) response.end();
  server.close(() => Promise.resolve(v11Platform?.close?.()).finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
