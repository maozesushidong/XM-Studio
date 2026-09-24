"use strict";

const Ajv = require("ajv");
const crypto = require("crypto");
const { hasInternalMessage } = require("./presentation");
const VERSION = "1.0.0";
const MODE = "ai_studio_requirement_intake";
const weights = { real_problem: 20, role_scenario: 15, current_workflow: 15, impact_evidence: 15, expected_outcome: 15, scope_branches: 10, success_criteria: 10 };
const focuses = [...Object.keys(weights), "constraints_risks"];
const summaryFields = ["title", "originalRequest", "realProblem", "rolesAndScenario", "currentWorkflow", "bottleneck", "impactAndEvidence", "expectedOutcome", "successCriteria", "inScope", "outOfScope", "dependencies", "risks", "validationPlan"];
const reasonCodes = ["CAPABILITY_GAP_CONFIRMED", "CAPABILITY_DIRECTLY_SOLVES", "CAPABILITY_UNKNOWN", "MISSING_REAL_SCENARIO", "MISSING_CURRENT_WORKFLOW", "MISSING_SUCCESS_CRITERIA", "SCOPE_CONFLICT", "DUPLICATE_WITHOUT_DELTA", "VALUE_EVIDENCE_WEAK", "RISK_DEPENDENCY_HIGH", "OUT_OF_AI_STUDIO_SCOPE"];
const actions = ["start", "answer", "correct", "accept_stage_summary", "resume", "retry_capability", "continue_gap"];
const uiActions = ["answer", "correct", "accept_stage_summary", "continue_gap", "retry_capability", "confirm_summary", "save_draft", "insist_submit", "close_resolved", "close_out_of_scope"];
const text = (maxLength = 12000) => ({ type: "string", maxLength });
const nullable = { anyOf: [text(), { type: "null" }] };
const enumeration = (values) => ({ type: "string", enum: values });
const array = (items, maxItems = 200) => ({ type: "array", items, maxItems });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", minLength: 1, maxLength: 160 };
const refs = { ...array(id), minItems: 1, uniqueItems: true };
const outputSchema = { $id: "https://xmai.local/schemas/requirement-intake/output/1.0.0", ...object({
  schemaVersion: { const: VERSION }, requestId: id, assistantMessage: text(),
  responseType: enumeration(["question", "stage_summary", "final_summary", "existing_capability", "out_of_scope", "conditional_result", "error"]),
  analysisStage: enumeration(["capability_checking", "analyzing", "stage_review", "summary_review", "closed_out_of_scope"]),
  analysisFocus: { anyOf: [enumeration(focuses), { type: "null" }] },
  confirmedFacts: array(object({ factId: id, dimension: enumeration(focuses), text: text(), sourceTurnIds: refs, status: enumeration(["confirmed", "corrected", "invalidated"]) })),
  assumptions: array(object({ id, text: text(), sourceTurnIds: array(id) })),
  openQuestions: array(object({ id, dimension: enumeration(focuses), text: text(), blocking: { type: "boolean" } })),
  conflicts: array(object({ id, text: text(), blocking: { type: "boolean" }, resolved: { type: "boolean" }, sourceTurnIds: refs })),
  branches: array(object({ branchId: id, title: text(300), inScope: { type: "boolean" }, reason: nullable })),
  capabilityAssessment: object({ dataStatus: enumeration(["available", "stale", "unavailable", "error"]), capabilityVersion: nullable, relation: enumeration(["directly_supported", "partially_supported", "not_supported", "unknown"]), matchedCapabilityIds: array(id), gap: nullable, uncertainty: nullable }),
  completeness: object({ score: { type: "integer", minimum: 0, maximum: 100 }, dimensions: object(Object.fromEntries(Object.keys(weights).map(key => [key, object({ status: enumeration(["missing", "partial", "confirmed", "explicit_gap"]), gap: nullable })]))), gatePassed: { type: "boolean" }, blockingItems: array(text()) }),
  recommendation: object({ type: enumeration(["submit", "supplement", "not_recommended", "not_applicable"]), reasonCodes: { ...array(enumeration(reasonCodes)), uniqueItems: true }, explanation: text() }),
  draftSummary: object(Object.fromEntries(summaryFields.map(key => [key, nullable]))),
  solutionProposal: object({ direction: nullable, mvpScope: array(text()), excludedScope: array(text()) }),
  allowedUiActions: { ...array(enumeration(uiActions)), uniqueItems: true }, warnings: array(text(1000)), stateVersion: { type: "integer", minimum: 1 }
}) };
const inputSchema = object({ schemaVersion: { const: VERSION }, requestId: id, skillMode: { const: MODE }, userId: id, conversationId: id, draftId: { anyOf: [id, { type: "null" }] }, turnId: id, userMessage: text(16000), userAction: enumeration(actions), analysisState: { anyOf: [outputSchema, { type: "null" }] }, capabilityContext: { type: "object" }, attachmentMetadata: array(object({ name: text(200), type: text(100), size: { type: "integer", minimum: 0 }, authorized: { const: false } }), 20), locale: { const: "zh-CN" }, clientTimeZone: text(80), targetStateVersion: { type: "integer", minimum: 1 }, sourceTurnIds: array(id), previousSubmissions: array(object({ requirementId: id, title: text(), realProblem: text() }), 20) });
inputSchema.properties.conversationContext = object({ effectiveAnswersSinceReview: { type: "integer", minimum: 0 }, recentTurns: array(object({ turnId: id, role: enumeration(["user", "assistant"]), message: text(16000) }), 30) });
inputSchema.required.push("conversationContext");
const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(outputSchema);
const validateInput = ajv.compile(inputSchema);
function error(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function assert(value, code, message, status) { if (!value) throw error(code, message, status); }
function canonical(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
}
function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex"); }
function redact(value) {
  return String(value ?? "")
    .replace(/\b(?:sk|sk-proj)-[a-zA-Z0-9_-]{12,}\b/g, "[密钥已隐藏]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, "$1[令牌已隐藏]")
    .replace(/((?:密码|口令|密钥|身份证号|银行卡号|password|secret|api[_ -]?key|access[_ -]?token)\s*[:：=]\s*)[^\s,，;；]+/gi, "$1[敏感值已隐藏]")
    .replace(/\b1[3-9]\d{9}\b/g, "[手机号已隐藏]")
    .replace(/\b\d{17}[\dXx]\b/g, "[证件号已隐藏]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[邮箱已隐藏]");
}
function scoreOf(dimensions) { return Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * ({ missing: 0, partial: 0.5, confirmed: 1, explicit_gap: 1 }[dimensions[key].status]), 0)); }
function checkOutput(value, input) {
  assert(validateShape(value), "OUTPUT_SCHEMA", `分析结果结构校验失败：${JSON.stringify(validateShape.errors?.slice(0, 5).map(e => ({ path: e.instancePath, rule: e.keyword, message: e.message })))}`, 502);
  assert(value.assistantMessage.trim() && !hasInternalMessage(value), "INTERNAL_RESPONSE", "面向用户的文字必须回应原始产品需求，不能包含内部字段、计算修正或校验过程；追问应提出一个业务问题", 502);
  assert(value.requestId === input.requestId && value.stateVersion === input.targetStateVersion, "OUTPUT_VERSION", "分析结果版本不匹配", 502);
  const sources = new Set(input.sourceTurnIds);
  const factIds = new Set();
  for (const fact of value.confirmedFacts) {
    assert(!factIds.has(fact.factId) && fact.sourceTurnIds.every(id => sources.has(id)), "FACT_SOURCE", "分析事实来源无效", 502);
    factIds.add(fact.factId);
  }
  for (const item of [...value.conflicts, ...value.assumptions]) assert(item.sourceTurnIds.every(id => sources.has(id)), "FACT_SOURCE", "引用轮次不存在", 502);
  const cap = value.capabilityAssessment, context = input.capabilityContext;
  assert(cap.dataStatus === context.dataStatus && cap.capabilityVersion === context.capabilityVersion, "CAPABILITY_VERSION", `能力元数据须回显输入：dataStatus=${JSON.stringify(context.dataStatus)}，capabilityVersion=${JSON.stringify(context.capabilityVersion)}，资料不可用也不能改写版本`, 502);
  const capabilities = context.capabilities || [];
  assert(cap.matchedCapabilityIds.every(id => capabilities.some(item => item.capabilityId === id)), "CAPABILITY_REFERENCE", "能力引用不存在", 502);
  if (cap.dataStatus !== "available") assert(cap.relation === "unknown", "CAPABILITY_UNCERTAIN", "能力资料异常时不能给出确定结论", 502);
  if (cap.relation === "directly_supported") assert(cap.matchedCapabilityIds.length > 0 && cap.matchedCapabilityIds.every(id => capabilities.some(item => item.capabilityId === id && item.status === "available" && item.entry)), "CAPABILITY_NOT_AVAILABLE", "推荐能力尚未验证可用", 502);
  assert(scoreOf(value.completeness.dimensions) === value.completeness.score, "SCORE_MISMATCH", `completeness.score 应为 ${scoreOf(value.completeness.dimensions)}，实际为 ${value.completeness.score}；保留各维度业务判断，只修正加权求和`, 502);
  const complete = Object.keys(weights).filter(key => key !== "impact_evidence").every(key => value.completeness.dimensions[key].status !== "missing");
  assert(!value.completeness.gatePassed || complete, "SUMMARY_GATE", "摘要存在必填维度缺口", 502);
  const recommendation = value.recommendation.type, allowed = value.allowedUiActions;
  const expectedStages = { question: ["analyzing", "capability_checking"], stage_summary: ["stage_review"], final_summary: ["summary_review"], conditional_result: ["summary_review"], existing_capability: ["analyzing"], out_of_scope: ["closed_out_of_scope"], error: ["analyzing", "capability_checking"] };
  assert(expectedStages[value.responseType].includes(value.analysisStage), "RESPONSE_STAGE", "响应类型与分析阶段不一致", 502);
  for (const dimension of Object.values(value.completeness.dimensions)) if (dimension.status === "explicit_gap") assert(dimension.gap?.trim(), "EXPLICIT_GAP", "证据缺口需要说明验证方式", 502);
  if (value.conflicts.some(item => item.blocking && !item.resolved)) assert(recommendation === "supplement", "CONFLICT_GATE", "重大冲突需要继续补充", 502);
  if (value.branches.length && value.branches.every(item => !item.inScope)) assert(value.responseType === "out_of_scope", "SCOPE_GATE", "范围外分支不能提交", 502);
  if (allowed.includes("accept_stage_summary")) assert(value.responseType === "stage_summary", "UI_ACTION", "阶段确认动作无效", 502);
  if (allowed.includes("close_resolved") || allowed.includes("continue_gap")) assert(value.responseType === "existing_capability" && cap.relation === "directly_supported", "UI_ACTION", "能力解决动作无效", 502);
  const final = ["final_summary", "conditional_result"].includes(value.responseType);
  if (final) {
    assert(value.analysisStage === "summary_review" && value.completeness.gatePassed, "SUMMARY_GATE", "摘要尚未满足确认条件", 502);
    for (const key of summaryFields) assert(typeof value.draftSummary[key] === "string" && value.draftSummary[key].trim(), "SUMMARY_FIELD", "摘要字段不完整", 502);
    assert(value.solutionProposal.direction?.trim() && value.solutionProposal.mvpScope.length, "SOLUTION_FIELD", "建议方向不完整", 502);
  }
  if (recommendation === "submit") assert(complete && value.completeness.gatePassed && cap.dataStatus === "available" && ["partially_supported", "not_supported"].includes(cap.relation) && !value.conflicts.some(item => item.blocking && !item.resolved) && !value.completeness.blockingItems.length, "SUBMIT_GATE", "建议提交与分析门禁冲突", 502);
  if (recommendation === "not_recommended") assert(complete && value.completeness.gatePassed, "RECOMMENDATION_GATE", "信息不足时应继续补充", 502);
  if (cap.dataStatus !== "available" && complete && value.completeness.gatePassed) assert(["not_recommended", "not_applicable", "supplement"].includes(recommendation), "CAPABILITY_UNCERTAIN", "能力未知时不能建议直接提交", 502);
  if (recommendation === "not_applicable") assert(["out_of_scope", "existing_capability", "error"].includes(value.responseType), "RECOMMENDATION_GATE", "提交建议与响应类型冲突", 502);
  if (recommendation === "supplement") assert(!allowed.includes("confirm_summary") && !allowed.includes("insist_submit"), "UI_ACTION", "补充状态不能提交", 502);
  if (allowed.includes("insist_submit")) assert(recommendation === "not_recommended" && final, "UI_ACTION", "坚持提交动作无效", 502);
  if (allowed.includes("confirm_summary")) assert(final && ["submit", "not_recommended"].includes(recommendation), "UI_ACTION", "摘要确认动作无效", 502);
  if (value.responseType === "out_of_scope") assert(value.analysisStage === "closed_out_of_scope" && recommendation === "not_applicable" && !allowed.includes("insist_submit") && !allowed.includes("confirm_summary"), "SCOPE_GATE", "范围外状态冲突", 502);
  if (value.responseType === "stage_summary") assert(value.analysisStage === "stage_review" && !allowed.includes("answer") && allowed.includes("accept_stage_summary"), "STAGE_GATE", "阶段总结动作不一致", 502);
  if (value.responseType === "question") assert(value.openQuestions.length && allowed.includes("answer"), "QUESTION_GATE", "追问结构不完整", 502);
  assert(redact(JSON.stringify(value)) === JSON.stringify(value), "SENSITIVE_OUTPUT", "分析结果包含需要隐藏的敏感值", 502);
  return value;
}
module.exports = { VERSION, MODE, weights, focuses, summaryFields, actions, outputSchema, inputSchema, validateInput, validateShape, checkOutput, scoreOf, redact, hash, assert, error };
