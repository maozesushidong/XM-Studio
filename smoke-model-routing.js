"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label}超时`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function sendChat(response, model, content) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ model, choices: [{ message: { role: "assistant", content } }] }));
}

function sendStream(response, model, content) {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
  response.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-model-routing-"));
  const privateKeyPath = path.join(temporaryRoot, "private.pem");
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

  let primaryActive = 0;
  let primaryMaximum = 0;
  let releaseHeldPrimary;
  const heldPrimary = new Promise((resolve) => { releaseHeldPrimary = resolve; });
  const primaryServer = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-5.6-luna" }, { id: "gpt-5.4" }, { id: "gpt-image-2" }] }));
      return;
    }
    const body = await readBody(request);
    primaryActive += 1;
    primaryMaximum = Math.max(primaryMaximum, primaryActive);
    const finalContent = body.messages?.at(-1)?.content;
    const finalText = typeof finalContent === "string"
      ? finalContent
      : Array.isArray(finalContent) ? finalContent.map((part) => part?.text || "").join(" ") : "";
    if (finalText.includes("流式过载")) {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\r\n\r\n');
      response.write('data: {"error":{"message":"Our servers are currently over');
      setTimeout(() => response.end('loaded. Please try again later."}}\r\n\r\ndata: [DONE]\r\n\r\n'), 10);
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("HTTP529")) {
      response.writeHead(529, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "overloaded" } }));
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("输出后报错")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"已开始输出"}}]}\n\n');
      response.end('data: {"error":{"message":"late error"}}\n\n');
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("流式工具结果")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
      response.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"write_file","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n');
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("主模型429")) {
      response.writeHead(429, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: { message: "rate limit exceeded" } }));
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("模型不可用")) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: { message: "requested model is unavailable" } }));
      primaryActive -= 1;
      return;
    }
    if (finalText.includes("普通参数错误")) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: { message: "invalid temperature" } }));
      primaryActive -= 1;
      return;
    }
    if (String(body.messages?.at(-1)?.content || "").includes("占用槽位")) await heldPrimary;
    sendChat(response, body.model, "主模型结果");
    primaryActive -= 1;
  });

  const fallbackCalls = [];
  const fallbackServer = http.createServer(async (request, response) => {
    const body = await readBody(request);
    fallbackCalls.push(body);
    if (body.stream === true) {
      sendStream(response, "fallback-private-model", "备用服务流式结果");
      return;
    }
    sendChat(response, "fallback-private-model", "备用服务结果");
  });

  const errorFallbackCalls = [];
  const errorFallbackServer = http.createServer(async (request, response) => {
    const body = await readBody(request);
    errorFallbackCalls.push(body);
    const finalContent = body.messages?.at(-1)?.content;
    const finalText = typeof finalContent === "string"
      ? finalContent
      : Array.isArray(finalContent) ? finalContent.map((part) => part?.text || "").join(" ") : "";
    if (finalText.includes("备用鉴权失败")) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (finalText.includes("备用流式失败")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"error":{"message":"backup overloaded"}}\n\n');
      return;
    }
    if (finalText.includes("后备也限流")) {
      response.writeHead(429, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: { message: "limit exceeded for user" } }));
      return;
    }
    if (body.stream === true) {
      sendStream(response, body.model, "故障后备流式结果");
      return;
    }
    sendChat(response, body.model, "故障后备结果");
  });

  const [primaryPort, fallbackPort, errorFallbackPort] = await Promise.all([
    listen(primaryServer),
    listen(fallbackServer),
    listen(errorFallbackServer)
  ]);
  const servicePort = 29600 + crypto.randomInt(0, 300);
  const serviceBaseUrl = `http://127.0.0.1:${servicePort}`;
  const child = spawn(process.execPath, [path.join(__dirname, "update-service", "server.js")], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(servicePort),
      UPDATE_DATA_ROOT: path.join(temporaryRoot, "data"),
      UPDATE_ADMIN_TOKEN: crypto.randomBytes(24).toString("hex"),
      UPDATE_SIGNING_PRIVATE_KEY_PATH: privateKeyPath,
      ...(process.env.XMAI_TEST_PREVIEW_MODE === "1" ? { UPDATE_PUBLIC_BASE_URL: `${serviceBaseUrl}/studio-v11-routing-test` } : {}),
      MODEL_GATEWAY_GPT_BASE_URL: `http://127.0.0.1:${primaryPort}/v1`,
      MODEL_GATEWAY_GPT_API_KEY: "primary-test-key",
      MODEL_GATEWAY_GPT_DEFAULT_MODEL: "gpt-5.6-luna",
      MODEL_GATEWAY_FALLBACK_BASE_URL: `http://127.0.0.1:${fallbackPort}/v1`,
      MODEL_GATEWAY_FALLBACK_API_KEY: "fallback-test-key",
      MODEL_GATEWAY_FALLBACK_MODEL: "fallback-private-model",
      MODEL_GATEWAY_FALLBACK_SUPPORTS_TOOLS: "1",
      MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL: `http://127.0.0.1:${errorFallbackPort}/v1`,
      MODEL_GATEWAY_ERROR_FALLBACK_API_KEY: "error-fallback-test-key",
      MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL: "deepseek-private-text-model",
      MODEL_GATEWAY_ERROR_FALLBACK_VISION_MODEL: "deepseek-private-vision-model",
      MODEL_GATEWAY_ERROR_FALLBACK_SUPPORTS_TOOLS: "1",
      MODEL_GATEWAY_GPT_MAX_CONCURRENCY: "14",
      MODEL_GATEWAY_TEST_DIAGNOSTICS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });

  try {
    await waitFor(async () => (await fetch(`${serviceBaseUrl}/health`).catch(() => null))?.ok, "路由服务启动");
    const registration = await fetch(`${serviceBaseUrl}/api/desktop/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "router-user", deviceId: "router-device", appVersion: "1.3.0.3", internalVersion: "1.3.0.3", platform: "win32", arch: "x64" })
    });
    assert.strictEqual(registration.status, 201);
    const sessionToken = String((await registration.json()).sessionToken || "");
    assert.ok(sessionToken);
    const routeRequest = (content, options = {}) => fetch(`${serviceBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        model: options.model || "gpt-5.6-luna",
        messages: options.messages || [{ role: "user", content }],
        stream: options.stream === true,
        ...(options.tools ? { tools: [{ type: "function", function: { name: "write_file", parameters: { type: "object" } } }], tool_choice: "auto" } : {})
      })
    });

    const normalResponse = await routeRequest("普通问题");
    assert.strictEqual(normalResponse.headers.get("x-xianma-model-mode"), "selected");
    const normalPayload = await normalResponse.json();
    assert.strictEqual(normalPayload.model, "gpt-5.6-luna");
    assert.strictEqual(normalPayload.choices[0].message.content, "主模型结果");
    assert.strictEqual(fallbackCalls.length, 0);
    assert.strictEqual(errorFallbackCalls.length, 0);
    if (process.env.XMAI_TEST_PREVIEW_MODE === "1") {
      const catalogResponse = await fetch(`${serviceBaseUrl}/api/desktop/models`, { headers: { authorization: `Bearer ${sessionToken}` } });
      assert.strictEqual(catalogResponse.status, 200);
      const catalog = await catalogResponse.json();
      assert.strictEqual(catalog.models.length, 6);
      assert(!catalog.models.some((item) => ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.2"].includes(item.value)));
      assert(!JSON.stringify(catalog).includes("test-key"));
      const removed = await routeRequest("已下架模型", { model: "gpt-5.4" });
      assert.strictEqual(removed.status, 400);
      assert.strictEqual((await removed.json()).code, "MODEL_REMOVED");
      const gemini = await routeRequest("指定备用模型", { model: "fallback-private-model" });
      assert.strictEqual(gemini.headers.get("x-xianma-model-mode"), "selected");
      assert.strictEqual((await gemini.json()).model, "fallback-private-model");
      const deepseek = await routeRequest("指定视觉模型处理纯文本", { model: "deepseek-private-vision-model" });
      assert.strictEqual(deepseek.headers.get("x-xianma-model-mode"), "selected");
      assert.strictEqual((await deepseek.json()).model, "deepseek-private-vision-model");
      fallbackCalls.length = 0; errorFallbackCalls.length = 0;
    }

    const rateLimitedResponse = await routeRequest("主模型429", { model: "gpt-5.6-sol", tools: true });
    assert.strictEqual(rateLimitedResponse.status, 200);
    assert.strictEqual(rateLimitedResponse.headers.get("x-xianma-model-mode"), "auto");
    const rateLimitedText = await rateLimitedResponse.text();
    assert.ok(!rateLimitedText.includes("deepseek-private-text-model"));
    const rateLimitedPayload = JSON.parse(rateLimitedText);
    assert.strictEqual(rateLimitedPayload.model, "auto");
    assert.strictEqual(rateLimitedPayload.choices[0].message.content, "故障后备结果");
    assert.strictEqual(errorFallbackCalls.at(-1).model, "deepseek-private-text-model");
    assert.ok(Array.isArray(errorFallbackCalls.at(-1).tools));

    const unavailableVisionResponse = await routeRequest("", {
      model: "gpt-5.6-terra",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "模型不可用，请看图" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }
        ]
      }]
    });
    assert.strictEqual(unavailableVisionResponse.status, 200);
    assert.strictEqual(unavailableVisionResponse.headers.get("x-xianma-model-mode"), "auto");
    const unavailableVisionPayload = await unavailableVisionResponse.json();
    assert.strictEqual(unavailableVisionPayload.model, "auto");
    assert.strictEqual(errorFallbackCalls.at(-1).model, "deepseek-private-vision-model");

    const badRequestResponse = await routeRequest("普通参数错误");
    assert.strictEqual(badRequestResponse.status, 400);
    assert.strictEqual(errorFallbackCalls.length, 2);

    const doubleLimitedResponse = await routeRequest("主模型429，后备也限流", { model: "gpt-5.6-sol" });
    assert.strictEqual(doubleLimitedResponse.status, 200);
    assert.strictEqual(doubleLimitedResponse.headers.get("x-xianma-model-mode"), "auto");
    const doubleLimitedPayload = await doubleLimitedResponse.json();
    assert.strictEqual(doubleLimitedPayload.model, "auto");
    assert.strictEqual(doubleLimitedPayload.choices[0].message.content, "备用服务结果");
    assert.strictEqual(fallbackCalls.at(-1).model, "fallback-private-model");

    const occupied = Array.from({ length: 14 }, (_, index) => routeRequest(`占用槽位 ${index + 1}`));
    await waitFor(async () => {
      const health = await (await fetch(`${serviceBaseUrl}/health`)).json();
      return health.modelGateway?.gptActive === 14;
    }, "主模型并发达到14");

    const overflowResponse = await routeRequest("第十五个工具任务", { model: "gpt-5.6-terra", tools: true });
    assert.strictEqual(overflowResponse.headers.get("x-xianma-model-mode"), "auto");
    const overflowText = await overflowResponse.text();
    assert.ok(!overflowText.includes("fallback-private-model"));
    const overflowPayload = JSON.parse(overflowText);
    assert.strictEqual(overflowPayload.model, "auto");
    assert.strictEqual(overflowPayload.choices[0].message.content, "备用服务结果");
    assert.strictEqual(fallbackCalls.at(-1).model, "fallback-private-model");
    assert.ok(Array.isArray(fallbackCalls.at(-1).tools) && fallbackCalls.at(-1).tools.length === 1);

    const streamResponse = await routeRequest("流式容量保护", { stream: true });
    assert.strictEqual(streamResponse.headers.get("x-xianma-model-mode"), "auto");
    const streamText = await streamResponse.text();
    assert.ok(streamText.includes("备用服务流式结果"));
    assert.ok(streamText.includes('"model":"auto"'));
    assert.ok(!streamText.includes("fallback-private-model"));

    const modeResponse = await fetch(`${serviceBaseUrl}/api/desktop/model-mode`, { headers: { authorization: `Bearer ${sessionToken}` } });
    assert.deepStrictEqual(await modeResponse.json(), { modelMode: "auto" });

    releaseHeldPrimary();
    await Promise.all(occupied);
    await waitFor(async () => {
      const health = await (await fetch(`${serviceBaseUrl}/health`)).json();
      return health.modelGateway?.gptActive === 0;
    }, "主模型并发释放");

    const recoveredResponse = await routeRequest("恢复后的任务", { model: "auto" });
    assert.strictEqual(recoveredResponse.headers.get("x-xianma-model-mode"), "selected");
    const recoveredPayload = await recoveredResponse.json();
    assert.strictEqual(recoveredPayload.model, "gpt-5.6-luna");
    assert.strictEqual(recoveredPayload.choices[0].message.content, "主模型结果");
    assert.strictEqual(primaryMaximum, 14);

    const overloadedStream = await routeRequest("流式过载", { stream: true });
    assert.strictEqual(overloadedStream.status, 200);
    assert.strictEqual(overloadedStream.headers.get("x-xianma-model-mode"), "auto");
    const overloadedText = await overloadedStream.text();
    assert.ok(overloadedText.includes("故障后备流式结果"));
    assert.ok(!overloadedText.includes("overloaded"));
    assert.ok(!overloadedText.includes("deepseek-private-text-model"));

    const authFallback = await routeRequest("主模型429，备用鉴权失败");
    assert.strictEqual(authFallback.status, 200);
    assert.ok((await authFallback.text()).includes("备用服务结果"));

    const chainedStream = await routeRequest("流式过载，备用流式失败", { stream: true });
    assert.strictEqual(chainedStream.status, 200);
    assert.ok((await chainedStream.text()).includes("备用服务流式结果"));

    const overloaded529 = await routeRequest("HTTP529");
    assert.strictEqual(overloaded529.status, 200);
    assert.ok((await overloaded529.text()).includes("故障后备结果"));

    const callsBeforePartialOutput = errorFallbackCalls.length;
    const partialStream = await routeRequest("输出后报错", { stream: true });
    const partialText = await partialStream.text();
    assert.ok(partialText.includes("已开始输出") && partialText.includes("late error"));
    assert.strictEqual(errorFallbackCalls.length, callsBeforePartialOutput);

    const toolStream = await routeRequest("流式工具结果", { stream: true, tools: true });
    assert.ok((await toolStream.text()).includes('"tool_calls"'));
    assert.strictEqual(errorFallbackCalls.length, callsBeforePartialOutput);

    process.stdout.write(`${JSON.stringify({ primaryUnderLimit: true, primaryLimit: 14, forcedAutoFallback: true, fallbackTools: true, fallbackModelRedacted: true, streamRedacted: true, errorFallbackOn429: true, chainedFallbackOnDoubleLimit: true, unavailableVisionFallback: true, invalidRequestPreserved: true, recoveredPrimary: true, sseErrorFallback: true, chainedSseFallback: true, authErrorFallback: true, overload529Fallback: true, partialOutputNotReplayed: true, streamedToolsPreserved: true })}\n`);
  } finally {
    child.kill();
    primaryServer.close();
    fallbackServer.close();
    errorFallbackServer.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (errors) process.stderr.write(errors);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
