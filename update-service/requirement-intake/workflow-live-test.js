"use strict";
const assert = require("assert/strict"), crypto = require("crypto"), { Pool } = require("pg");
const { Store } = require("./store"), { createIntake } = require("./service");
const detail = "我是运营专员，每周五在 AI Studio 整理客户分析。当前要打开20条本人历史对话，逐条复制到本地 Markdown，约花30分钟。我希望在历史列表勾选后一次导出为一个 Markdown，保留标题、时间和消息顺序。本期只做本人对话，不做附件、其他人记录或第三方同步。最近四周都遇到，我记录了耗时。成功标准是20条一分钟内导出且不漏消息，用本周20条逐项核对。没有额外系统依赖，主要风险是遗漏。产品是否已支持尚未确认，请保留不确定性。";
(async () => {
  assert(process.env.UPDATE_PUBLIC_BASE_URL.includes("/studio-v11-"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `intake_live_${crypto.randomBytes(6).toString("hex")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(process.env.DATABASE_URL); connection.searchParams.set("options", `-csearch_path=${schema}`);
  const service = createIntake({ store: new Store(connection.toString()) });
  const user = { ownerKey: "qa-live-workflow", name: "需求闭环测试", department: "测试" };
  const results = [];
  const state = () => service.current(user);
  async function analyze(action, message) {
    const before = await state(), requestId = crypto.randomUUID(), started = Date.now();
    const payload = { requestId, stateVersion: before.stateVersion, action, message };
    await service.reserve(user, payload);
    await Promise.all([...service.jobs]);
    const value = await state();
    assert(!value.draft.error, JSON.stringify(value.draft.error));
    results.push({ action, responseType: value.draft.analysis.responseType, recommendation: value.draft.analysis.recommendation.type, elapsedMs: Date.now() - started });
    console.error(JSON.stringify(results.at(-1)));
    return value;
  }
  async function mutate(action, extra = {}) { const s = await state(); return service.mutate(user, action, { requestId: crypto.randomUUID(), stateVersion: s.stateVersion, ...extra }); }
  try {
    let s = await analyze("start", "我想让 AI Studio 整理历史对话更方便。");
    assert.equal(s.draft.analysis.responseType, "question");
    const draftId = s.draft.draftId;
    await mutate("save");
    assert.equal((await state()).draft.draftId, draftId);
    s = await analyze("answer", detail);
    for (let attempt = 0; attempt < 3 && !["final_summary", "conditional_result"].includes(s.draft.analysis.responseType); attempt++) {
      s = s.draft.analysis.responseType === "stage_summary" ? await analyze("accept_stage_summary", "") : await analyze("answer", detail + " 上述范围与标准就是我的实际需求，未知能力请列为待验证。");
    }
    assert(["final_summary", "conditional_result"].includes(s.draft.analysis.responseType), "did not reach final summary");
    assert.equal(s.draft.analysis.recommendation.type, "not_recommended");
    const summaryVersion = s.draft.summaryVersion;
    await mutate("confirm-summary", { summaryVersion });
    const ready = await state();
    const body = { requestId: crypto.randomUUID(), stateVersion: ready.stateVersion, summaryVersion, submitMode: "insisted", insistReason: "测试验证完整闭环，保留能力尚未确认的 AI 原判断" };
    const [one, two] = await Promise.all([service.mutate(user, "submit", body), service.mutate(user, "submit", body)]);
    assert.deepEqual(one, two); assert.equal((await state()).draft, null);
    assert.equal((await service.list(new URL("http://test/"), user)).total, 1);
    assert.equal((await service.detail(one.requirementId, user)).snapshot.analysis.recommendation.type, "not_recommended");
    const exported = await service.exportRecord(one.requirementId, { requestId: crypto.randomUUID() });
    assert(exported.content.includes(one.requirementId));
    await service.acknowledgeExport(one.requirementId, { exportId: exported.exportId, sha256: exported.sha256 });
    assert.equal((await service.detail(one.requirementId)).export_count, 1);
    console.log(JSON.stringify({ ok: true, realModel: true, isolatedSchema: true, results, savedAndRestored: true, confirmedAndSubmitted: true, idempotent: true, exported: true, testDataCleaned: true }));
  } finally {
    await service.close(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
