"use strict";
let cached = null, loading = null;
const hiddenModels = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.2"]);
function isHiddenModel(value) { return hiddenModels.has(String(value || "").trim().toLowerCase()); }
function describe(id) {
  const kind = /^gpt-image-/i.test(id) ? "image" : "chat";
  const group = kind === "image" ? "图片生成" : /^deepseek/i.test(id) ? "DeepSeek" : /^gemini/i.test(id) ? "Gemini" : "通用与推理";
  return { value: id, label: id, kind, group };
}
async function catalog() {
  if (cached?.expires > Date.now()) return cached.value;
  if (loading) return loading;
  loading = (async () => {
    const env = process.env;
    let discovered = [], stale = false;
    try {
      const response = await fetch(`${env.MODEL_GATEWAY_GPT_BASE_URL.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${env.MODEL_GATEWAY_GPT_API_KEY}` }, signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error("catalog unavailable");
      const value = await response.json();
      discovered = (value.data || []).map(item => item.id).filter(id => typeof id === "string" && /^[\w.:-]{1,120}$/.test(id) && !isHiddenModel(id));
      if (!discovered.length) throw new Error("empty catalog");
    } catch { discovered = cached?.value.models.filter(item => item.kind !== "auto").map(item => item.value) || []; stale = true; }
    const ids = [...new Set([...discovered, env.MODEL_GATEWAY_GPT_DEFAULT_MODEL,
      ...(env.MODEL_GATEWAY_ERROR_FALLBACK_API_KEY ? [env.MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL, env.MODEL_GATEWAY_ERROR_FALLBACK_VISION_MODEL] : []),
      ...(env.MODEL_GATEWAY_FALLBACK_API_KEY ? [env.MODEL_GATEWAY_FALLBACK_MODEL] : [])].filter(id => id && !isHiddenModel(id)))];
    const order = ["通用与推理", "图片生成", "DeepSeek", "Gemini"];
    const models = ids.map(describe).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    const value = { models: [{ value: "auto", label: "Auto 自动选择", kind: "auto", group: "自动选择" }, ...models], stale, updatedAt: new Date().toISOString() };
    cached = { value, expires: Date.now() + (stale ? 15000 : 300000) };
    return value;
  })().finally(() => { loading = null; });
  return loading;
}
module.exports = { catalog, isHiddenModel };
