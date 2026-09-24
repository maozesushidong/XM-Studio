"use strict";
async function forwardPreviewImage(request, response, { baseUrl, apiKey, sendJson }) {
  if (!baseUrl || !apiKey) { sendJson(response, 503, { error: "测试图片模型服务尚未配置" }); return; }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) { sendJson(response, 413, { error: "图片请求超过 64 MB" }); return; }
      chunks.push(chunk);
    }
    const suffix = request.url.split("?")[0].endsWith("/edits") ? "edits" : "generations";
    const upstream = await fetch(`${baseUrl.replace(/\/+$/, "")}/images/${suffix}`, { method: "POST", signal: AbortSignal.timeout(180000), headers: { authorization: `Bearer ${apiKey}`, "content-type": request.headers["content-type"] || "application/json" }, body: Buffer.concat(chunks) });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json", "content-length": body.length, "cache-control": "no-store" });
    response.end(body);
  } catch { sendJson(response, 502, { error: "测试图片服务暂不可用，请稍后重试" }); }
}
module.exports = { forwardPreviewImage };
