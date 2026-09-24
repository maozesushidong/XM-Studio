"use strict";

// These describe our output protocol, not the employee's product requirement.
const protocol = /\b(?:completeness\s*[.\[]\s*["']?(?:score|dimensions)|assistantMessage|allowedUiActions|targetStateVersion|sourceTurnIds|capabilityAssessment\s*\.|SCORE_MISMATCH|OUTPUT_SCHEMA|CAPABILITY_VERSION|INTERNAL_RESPONSE)\b/i;
const repairNarration = /(?:已|已经|现已|本次|仅|只)(?:按[^。！？\n]{0,30})?(?:修正|修复|纠正|校正|调整|更新|重算|重新计算)[^。！？\n]{0,45}(?:加权|权重|评分|分值|分数|字段|JSON|schema|枚举|元数据|输出格式|结构校验)|(?:其余|其他|原有)(?:的)?(?:业务)?事实(?:均|全部)?(?:保持|维持)?不变|(?:上一次|上次)(?:的)?(?:输出|结果|JSON)[^。！？\n]{0,40}(?:校验|schema|字段|格式)|\b(?:corrected|fixed|repaired|recalculated)\s+(?:the\s+)?(?:completeness|weighted\s+score|schema|json|metadata)\b/i;

function isInternalMessage(value) {
  return typeof value === "string" && (protocol.test(value) || repairNarration.test(value));
}

function visibleTexts(analysis) {
  if (!analysis) return [];
  return [analysis.assistantMessage, analysis.recommendation?.explanation,
    analysis.capabilityAssessment?.gap, analysis.capabilityAssessment?.uncertainty,
    ...(analysis.openQuestions || []).map(item => item.text),
    ...(analysis.completeness?.blockingItems || []),
    ...Object.values(analysis.completeness?.dimensions || {}).map(item => item.gap),
    ...Object.values(analysis.draftSummary || {}), analysis.solutionProposal?.direction,
    ...(analysis.solutionProposal?.mvpScope || []), ...(analysis.solutionProposal?.excludedScope || []),
    ...(analysis.warnings || [])];
}

function hasInternalMessage(analysis) { return visibleTexts(analysis).some(isInternalMessage); }

// Read-time compatibility for diagnostic replies saved by earlier test builds.
// Keep stored evidence intact and use only an already generated business question.
function displayAnalysis(analysis) {
  if (!analysis || !isInternalMessage(analysis.assistantMessage)) return analysis;
  const question = analysis.responseType === "question"
    ? analysis.openQuestions?.find(item => item.text?.trim() && !isInternalMessage(item.text))?.text : "";
  return { ...analysis, assistantMessage: question || "上次回复未正确生成，需求内容已保留，请重新分析。" };
}

function displayTurns(turns, analysis) {
  return turns.flatMap((turn, index) => {
    if (turn.role !== "assistant" || !isInternalMessage(turn.message)) return [turn];
    if (index === turns.length - 1 && analysis?.assistantMessage === turn.message) {
      return [{ ...turn, message: displayAnalysis(analysis).assistantMessage }];
    }
    return [];
  });
}

module.exports = { isInternalMessage, hasInternalMessage, displayAnalysis, displayTurns };
