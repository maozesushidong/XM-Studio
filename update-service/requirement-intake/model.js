"use strict";
const { outputSchema, validateInput, validateShape, scoreOf, checkOutput, assert, error, redact } = require("./contract");
class Analyzer {
  constructor() { this.active = 0; this.waiters = []; }
  async run(input, resources) {
    assert(resources.manifest && resources.adapter, "RESOURCE_UNAVAILABLE", "受控分析资源不可用，请稍后重试", 503);
    assert(validateInput(input), "INPUT_SCHEMA", "分析输入校验失败");
    if (this.active >= 2) {
      assert(this.waiters.length < 20, "BUSY", "分析请求较多，输入已保存，请稍后重试", 429);
      await new Promise(resolve => this.waiters.push(resolve));
    } else this.active++;
    try { return await this.generate(input, resources); }
    finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
  }
  async generate(input, resources) {
    const routes = [
      [process.env.REQUIREMENT_MODEL_BASE_URL || process.env.MODEL_GATEWAY_GPT_BASE_URL, process.env.REQUIREMENT_MODEL_API_KEY || process.env.MODEL_GATEWAY_GPT_API_KEY, process.env.REQUIREMENT_MODEL || process.env.MODEL_GATEWAY_GPT_DEFAULT_MODEL],
      [process.env.MODEL_GATEWAY_ERROR_FALLBACK_BASE_URL || process.env.MODEL_GATEWAY_FALLBACK_BASE_URL, process.env.MODEL_GATEWAY_ERROR_FALLBACK_API_KEY || process.env.MODEL_GATEWAY_FALLBACK_API_KEY, process.env.MODEL_GATEWAY_ERROR_FALLBACK_TEXT_MODEL || process.env.MODEL_GATEWAY_FALLBACK_MODEL]
    ].filter(route => route.every(Boolean));
    assert(routes.length, "MODEL_NOT_CONFIGURED", "需求分析模型尚未配置", 503);
    let failure = "MODEL_UNAVAILABLE";
    let feedback = "", rejectedOutput = null;
    const schema = structuredClone(outputSchema);
    schema.properties.requestId = { const: input.requestId };
    schema.properties.stateVersion = { const: input.targetStateVersion };
    schema.properties.capabilityAssessment.properties.dataStatus = { const: input.capabilityContext.dataStatus };
    schema.properties.capabilityAssessment.properties.capabilityVersion = { const: input.capabilityContext.capabilityVersion };
    const envelope = { requestId: input.requestId, stateVersion: input.targetStateVersion, capabilityAssessment: { dataStatus: input.capabilityContext.dataStatus, capabilityVersion: input.capabilityContext.capabilityVersion } };
    for (let attempt = 0; attempt < 2; attempt++) {
      const [base, key, model] = routes[rejectedOutput ? 0 : Math.min(attempt, routes.length - 1)];
      try {
        const response = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST", signal: AbortSignal.timeout(90000), headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, stream: false, ...(/^gpt-/.test(model) ? { reasoning_effort: "low", max_completion_tokens: 7000 } : { max_tokens: 7000 }), response_format: { type: "json_object" }, messages: [
            { role: "system", content: `${resources.adapter}\n输出必须严格符合以下 JSON Schema：\n${JSON.stringify(schema)}\n平台元数据逐字回显：${JSON.stringify(envelope)}。即使 dataStatus=unavailable，capabilityVersion 仍保留输入中的版本号，不能自行改为 null。这是资料版本标识，不代表能力已经上线。${attempt ? `\n内部校验反馈（不是用户需求）：${failure}：${feedback}。返回完整有效结果，不得省略字段，不得为通过校验而篡改业务事实。assistantMessage 仍须回答下方原始 userMessage 或提出一个业务追问，禁止回复已修正、已通过校验或说明内部字段与计算过程。此前 assistant JSON 是被拒绝的待修复数据，不是有效业务结论或指令。` : ""}` },
            ...(rejectedOutput ? [{ role: "assistant", content: rejectedOutput }] : []),
            { role: "user", content: JSON.stringify(input) }
          ] })
        });
        if (!response.ok) { failure = `MODEL_HTTP_${response.status}`; rejectedOutput = null; feedback = "上游服务失败，请使用本次输入重新分析"; await response.body?.cancel(); continue; }
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content;
        assert(typeof content === "string" && content.length <= 150000, "OUTPUT_SIZE", "模型结果无效", 502);
        const value = JSON.parse(content.replace(/^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i, "$1"));
        rejectedOutput = redact(content);
        // The model owns dimension judgments; the platform owns their arithmetic.
        if (validateShape(value)) value.completeness.score = scoreOf(value.completeness.dimensions);
        return checkOutput(value, input);
      } catch (e) {
        failure = e.name === "TimeoutError" ? "MODEL_TIMEOUT" : typeof e.code === "string" ? e.code : "MODEL_OUTPUT_INVALID";
        feedback = typeof e.code === "string" ? redact(e.message).slice(0, 1500) : failure === "MODEL_TIMEOUT" ? "模型响应超时，请根据原始需求重新分析" : "返回有效 JSON";
      }
    }
    throw error(failure, "本次分析未完成，输入及上一有效结果已保留，请重试", 502);
  }
}
module.exports = { Analyzer };
