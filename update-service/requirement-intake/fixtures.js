"use strict";
const C = require("./contract");
function output(input, kind = "question") {
  const complete = ["final", "conditional"].includes(kind);
  const data = {
    schemaVersion: C.VERSION, requestId: input.requestId, stateVersion: input.targetStateVersion,
    assistantMessage: complete ? "已整理需求摘要，请核对。" : "你最近一次在 AI Studio 遇到这个问题时，正在完成什么任务？",
    responseType: complete ? "final_summary" : "question", analysisStage: complete ? "summary_review" : "analyzing", analysisFocus: "real_problem",
    confirmedFacts: [], assumptions: [], openQuestions: complete ? [] : [{ id: "q1", dimension: "real_problem", text: "最近一次的具体场景是什么？", blocking: true }], conflicts: [], branches: [{ branchId: "b1", title: "AI Studio 需求提报", inScope: true, reason: null }],
    capabilityAssessment: { dataStatus: input.capabilityContext.dataStatus, capabilityVersion: input.capabilityContext.capabilityVersion, relation: input.capabilityContext.dataStatus === "available" ? "not_supported" : "unknown", matchedCapabilityIds: [], gap: "批量导出暂未覆盖", uncertainty: null },
    completeness: { score: complete ? 100 : 0, dimensions: Object.fromEntries(Object.keys(C.weights).map(k => [k, { status: complete ? "confirmed" : "missing", gap: null }])), gatePassed: complete, blockingItems: complete ? [] : ["缺少使用场景"] },
    recommendation: { type: complete ? (input.capabilityContext.dataStatus === "available" ? "submit" : "not_recommended") : "supplement", reasonCodes: [complete ? (input.capabilityContext.dataStatus === "available" ? "CAPABILITY_GAP_CONFIRMED" : "CAPABILITY_UNKNOWN") : "MISSING_REAL_SCENARIO"], explanation: complete ? "需求信息完整" : "需要补充真实场景" },
    draftSummary: Object.fromEntries(C.summaryFields.map(k => [k, complete ? ({ title: "批量导出对话", realProblem: "每次整理周报都需要逐个复制对话" })[k] || "测试夹具：有明确描述" : null])),
    solutionProposal: { direction: complete ? "支持选定对话批量导出" : null, mvpScope: complete ? ["选定对话导出 Markdown"] : [], excludedScope: [] },
    allowedUiActions: complete ? ["confirm_summary", "save_draft", "correct", ...(input.capabilityContext.dataStatus === "available" ? [] : ["insist_submit"])] : ["answer", "correct", "save_draft"], warnings: []
  };
  if (kind === "stage") { data.responseType = "stage_summary"; data.analysisStage = "stage_review"; data.assistantMessage = "当前理解：你希望减少重复复制对话的工作。"; data.allowedUiActions = ["accept_stage_summary", "correct", "save_draft"]; }
  if (kind === "outside") { data.responseType = "out_of_scope"; data.analysisStage = "closed_out_of_scope"; data.recommendation = { type: "not_applicable", reasonCodes: ["OUT_OF_AI_STUDIO_SCOPE"], explanation: "不属于 AI Studio 产品需求" }; data.branches[0].inScope = false; data.allowedUiActions = ["close_out_of_scope"]; }
  if (kind === "existing") { data.responseType = "existing_capability"; data.recommendation = { type: "not_applicable", reasonCodes: ["CAPABILITY_DIRECTLY_SOLVES"], explanation: "已有功能可以满足" }; data.capabilityAssessment.relation = "directly_supported"; data.capabilityAssessment.matchedCapabilityIds = [input.capabilityContext.capabilities[0].capabilityId]; data.allowedUiActions = ["close_resolved", "continue_gap"]; }
  return data;
}
function input(context) { return { schemaVersion: C.VERSION, requestId: "fixture-request-001", skillMode: C.MODE, userId: "fixture-user", conversationId: "fixture-conversation", draftId: null, turnId: "fixture-turn", userMessage: "我希望 AI Studio 支持批量导出对话", userAction: "start", analysisState: null, capabilityContext: context, attachmentMetadata: [], locale: "zh-CN", clientTimeZone: "Asia/Shanghai", targetStateVersion: 2, sourceTurnIds: ["fixture-turn"], previousSubmissions: [] }; }
const baseInput = input;
module.exports = { output, input: context => ({ ...baseInput(context), conversationContext: { effectiveAnswersSinceReview: 0, recentTurns: [] } }) };
