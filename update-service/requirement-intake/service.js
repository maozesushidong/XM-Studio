"use strict";
const crypto = require("crypto");
const { Store } = require("./store");
const { Analyzer } = require("./model");
const { loadResources } = require("./resources");
const C = require("./contract");
const { displayAnalysis, displayTurns } = require("./presentation");
const uuid = () => crypto.randomUUID();
const labels = { title: "需求标题", originalRequest: "原始诉求", realProblem: "真实问题", rolesAndScenario: "角色与场景", currentWorkflow: "当前流程", bottleneck: "主要卡点", impactAndEvidence: "影响与证据", expectedOutcome: "预期结果", successCriteria: "成功标准", inScope: "本期范围", outOfScope: "不做范围", dependencies: "依赖", risks: "风险", validationPlan: "验证计划" };
const recommendations = { submit: "建议提交", supplement: "建议补充", not_recommended: "暂不建议提交", not_applicable: "不适用" };
function beijingDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, ""); }
function publicState(row) {
  const d = row.draft;
  const incompatible = d?.analysis && !C.validateShape(d.analysis);
  return { stateVersion: Number(row.version), draft: d ? { ...d, turns: displayTurns(d.turns, d.analysis), analysis: incompatible ? null : displayAnalysis(d.analysis), ...(incompatible ? { incompatible: true } : {}) } : d };
}
function requestKey(body) { C.assert(typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId), "REQUEST_ID", "缺少有效请求编号"); return body.requestId; }
function checkVersion(row, body) { C.assert(Number.isSafeInteger(body.stateVersion) && body.stateVersion === Number(row.version), "VERSION_CONFLICT", "草稿已在其他窗口更新，请刷新后继续", 409); }
function summaryHash(draft) { return C.hash({ summary: draft.analysis.draftSummary, proposal: draft.analysis.solutionProposal, recommendation: draft.analysis.recommendation, resources: draft.resourceHash }); }
function businessSummaryHash(analysis) { const { capabilityVersion, dataStatus, ...assessment } = analysis.capabilityAssessment; return C.hash({ summary: analysis.draftSummary, proposal: analysis.solutionProposal, recommendation: analysis.recommendation, assessment, dataStatus }); }
function markdown(row) {
  const s = row.snapshot;
  const clean = value => String(value ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/^([#>*])/gm, "\\$1");
  return `# ${row.requirement_id} ${clean(row.title)}\n\n提交时间：${new Date(row.submitted_at).toISOString()}\n提交人：${clean(row.nickname)}\n部门：${clean(row.department)}\nAI 原建议：${recommendations[s.analysis.recommendation.type]}\n提交方式：${s.submitMode === "insisted" ? "坚持提交" : "普通提交"}\n坚持理由：${clean(s.insistReason || "无")}\n\n${Object.entries(labels).map(([key, label]) => `## ${label}\n\n${clean(s.analysis.draftSummary[key])}\n`).join("\n")}\n## 建议解决方向\n\n${clean(s.analysis.solutionProposal.direction)}\n\n## MVP 范围\n\n${s.analysis.solutionProposal.mvpScope.map(item => `- ${clean(item)}`).join("\n")}\n\n## 版本依据\n\nSkill：${s.versions.adapterVersion}\nSchema：${s.versions.schemaVersion}\n能力：${s.versions.capabilityVersion}\n构建哈希：${s.versions.buildHash}\n`;
}
function createIntake(options) {
  const store = options.store || new Store(process.env.DATABASE_URL);
  const analyzer = options.analyzer || new Analyzer();
  const resourceLoader = options.resources || loadResources;
  const jobs = new Set();
  async function current(profile) {
    return store.transaction(async client => {
      const row = await store.owner(client, profile), resource = resourceLoader();
      if (row.draft?.pending && Date.now() - Date.parse(row.draft.pendingAt || row.draft.createdAt) > 6 * 60000) {
        const requestId = row.draft.pending;
        row.draft.pending = null; row.draft.lastFailedTurn = row.draft.turns.findLast(t => t.role === "user")?.turnId;
        row.draft.error = { code: "ANALYSIS_TIMEOUT", error: "分析等待超时，输入已保留，请重试" };
        row.version = Number(row.version) + 1;
        await client.query("UPDATE intake_operations SET status='failed',result=$3,updated_at=now() WHERE owner_key=$1 AND request_id=$2", [profile.ownerKey, requestId, row.draft.error]);
        await store.save(client, row);
      }
      if (row.draft?.analysis && C.validateShape(row.draft.analysis) && (row.draft.resourceHash !== resource.manifest?.buildHash || row.draft.analysis.capabilityAssessment.dataStatus !== resource.context.dataStatus) && !row.draft.needsReevaluation) {
        row.draft.reconfirmationCandidate = row.draft.confirmation ? { confirmation: row.draft.confirmation, businessHash: businessSummaryHash(row.draft.analysis), summaryVersion: row.draft.summaryVersion } : null;
        row.draft.needsReevaluation = true; row.draft.confirmation = null; row.version = Number(row.version) + 1;
        await store.save(client, row);
      }
      return { ...publicState(row), capabilityStatus: resource.context.dataStatus, capabilityReview: resource.context.reviewStatus, resourceVersion: resource.manifest?.adapterVersion || null };
    });
  }
  async function reserve(profile, body) {
    const id = requestKey(body), contentHash = C.hash(body);
    C.assert(C.actions.includes(body.action), "ACTION_INVALID", "不支持的分析动作");
    C.assert(Object.keys(body).every(key => ["requestId", "stateVersion", "action", "message", "attachments", "retry"].includes(key)), "INPUT_FIELD", "请求包含不支持的字段");
    C.assert(typeof (body.message || "") === "string" && (body.message || "").length <= 16000, "MESSAGE_SIZE", "每次最多输入 16000 个字符");
    const result = await store.transaction(async client => {
      const row = await store.owner(client, profile), existing = await store.operation(client, profile.ownerKey, id);
      if (existing) { C.assert(existing.content_hash === contentHash, "IDEMPOTENCY_CONFLICT", "同一请求编号不能用于不同内容", 409); return { operation: existing, input: null }; }
      checkVersion(row, body);
      C.assert(!row.draft?.pending, "ANALYSIS_RUNNING", "当前草稿正在分析，请等待完成", 409);
      const resources = resourceLoader();
      let d = row.draft;
      if (!d) {
        C.assert(body.action === "start" && body.message?.trim(), "START_REQUIRED", "请先填写需求内容");
        d = { draftId: null, conversationId: uuid(), turns: [], analysis: null, confirmation: null, summaryVersion: 0, saved: false, createdAt: new Date().toISOString(), resourceHash: resources.manifest?.buildHash || null };
      } else {
        C.assert(body.action !== "start" || !d.analysis, "DRAFT_EXISTS", "已有草稿，请继续或放弃当前草稿", 409);
        const allowed = d.analysis?.allowedUiActions || [];
        C.assert(body.retry || (!d.analysis && body.action === "start") || ["resume", "retry_capability"].includes(body.action) || allowed.includes(body.action), "ACTION_NOT_ALLOWED", "当前阶段不支持此操作", 409);
      }
      C.assert(!d.analysis || d.analysis.schemaVersion === C.VERSION, "DRAFT_INCOMPATIBLE", "草稿版本暂不兼容，原输入已保留，请联系测试管理员", 409);
      let turn;
      if (body.retry) {
        C.assert(d.lastFailedTurn, "RETRY_UNAVAILABLE", "没有可重试的输入", 409);
        turn = d.turns.find(item => item.turnId === d.lastFailedTurn);
      } else {
        C.assert(!["start", "answer", "correct", "continue_gap"].includes(body.action) || body.message?.trim(), "MESSAGE_REQUIRED", "请填写补充或修正内容");
        C.assert(d.turns.length < 200, "DRAFT_LIMIT", "草稿已达到轮次上限，请暂存并联系管理员", 409);
        const attachments = (body.attachments || []).map(a => ({ name: C.redact(a.name).slice(0, 200), type: String(a.type || "").slice(0, 100), size: a.size, authorized: false }));
        C.assert(attachments.length <= 20 && attachments.every(a => Number.isSafeInteger(a.size) && a.size >= 0), "ATTACHMENT_METADATA", "附件信息无效");
        turn = { turnId: uuid(), action: body.action, role: "user", message: C.redact(body.message || ""), attachments, createdAt: new Date().toISOString() };
        d.turns.push(turn);
      }
      C.assert(turn, "RETRY_UNAVAILABLE", "原输入不存在", 409);
      if (!["resume", "retry_capability"].includes(turn.action)) d.reconfirmationCandidate = null;
      d.confirmation = null; d.dirty = true; d.pending = id; d.pendingAt = new Date().toISOString(); d.lastFailedTurn = null; d.error = null; d.saved = false;
      row.draft = d; row.version = Number(row.version) + 1;
      const previous = (await client.query("SELECT requirement_id,title,real_problem FROM intake_submissions WHERE owner_key=$1 ORDER BY submitted_at DESC LIMIT 20", [profile.ownerKey])).rows;
      const input = { schemaVersion: C.VERSION, requestId: id, skillMode: C.MODE, userId: profile.ownerKey, conversationId: d.conversationId, draftId: d.draftId, turnId: turn.turnId, userMessage: turn.message, userAction: turn.action, analysisState: displayAnalysis(d.analysis), capabilityContext: resources.context, attachmentMetadata: turn.attachments, locale: "zh-CN", clientTimeZone: "Asia/Shanghai", targetStateVersion: row.version + 1, sourceTurnIds: d.turns.filter(t => t.role === "user").map(t => t.turnId), previousSubmissions: previous.map(s => ({ requirementId: s.requirement_id, title: s.title, realProblem: s.real_problem })) };
      const reviewAt = d.turns.findLastIndex(t => t.action === "accept_stage_summary");
      const citedTurns = new Set((d.analysis?.confirmedFacts || []).filter(f => f.status !== "invalidated").flatMap(f => f.sourceTurnIds));
      const necessaryTurns = d.turns.filter((t, index) => index >= d.turns.length - 8 || citedTurns.has(t.turnId)).slice(-30);
      input.conversationContext = { effectiveAnswersSinceReview: d.turns.slice(reviewAt + 1).filter(t => ["answer", "correct", "continue_gap"].includes(t.action) && t.message.trim()).length, recentTurns: displayTurns(necessaryTurns, d.analysis).map(t => ({ turnId: t.turnId, role: t.role, message: t.message })) };
      if (d.recoveryAnalysis) input.conversationContext.recentTurns = [{ turnId: `recovery-${d.conversationId}`, role: "assistant", message: `旧版本分析仅作为恢复上下文，必须对照用户轮次与当前能力资料重新核验：${d.recoveryAnalysis}` }, ...input.conversationContext.recentTurns.slice(-29)];
      C.assert(C.validateInput(input), "INPUT_SCHEMA", "输入数据校验失败");
      await store.save(client, row);
      await store.record(client, profile.ownerKey, id, "analyze", contentHash, "running", null);
      await store.audit(client, profile.ownerKey, "analyze", id);
      return { operation: { request_id: id, status: "running", result: null }, input, resources, contentHash };
    });
    if (result.input) {
      const job = finish(profile, result).finally(() => jobs.delete(job));
      jobs.add(job);
    }
    return result.operation;
  }
  async function finish(profile, reservation) {
    const { input, resources, contentHash } = reservation;
    let analysis, failure;
    try { analysis = C.checkOutput(await analyzer.run(input, resources), input); }
    catch (e) {
      const code = e.code || "ANALYSIS_FAILED";
      const message = code === "MODEL_TIMEOUT" ? "模型响应超时" : /^MODEL_HTTP_/.test(code) ? "模型服务暂不可用" : code === "BUSY" ? "分析请求较多" : code === "CAPABILITY_VERSION" ? "能力资料版本校验未通过" : "分析结果校验未通过";
      failure = { code, error: `${message}，输入和上一有效结果已保留，请重试` };
      process.stderr.write(JSON.stringify({ event: "requirement-analysis-failed", requestId: input.requestId, code }) + "\n");
    }
    try {
      await store.transaction(async client => {
        const row = await store.owner(client, profile), d = row.draft;
        if (!d || d.pending !== input.requestId) return;
        d.pending = null; row.version = Number(row.version) + 1;
        if (failure) { d.lastFailedTurn = input.turnId; d.error = failure; }
        else {
          d.draftId ||= uuid(); d.analysis = analysis; d.resourceHash = resources.manifest.buildHash;
          d.versions = { ...resources.manifest, files: undefined }; d.dirty = false; d.needsReevaluation = false; d.error = null;
          if (["final_summary", "conditional_result"].includes(analysis.responseType)) {
            if (d.reconfirmationCandidate?.businessHash === businessSummaryHash(analysis)) {
              d.summaryVersion = d.reconfirmationCandidate.summaryVersion;
              d.confirmation = { ...d.reconfirmationCandidate.confirmation, hash: summaryHash(d) };
            } else d.summaryVersion++;
          }
          d.reconfirmationCandidate = null; d.recoveryAnalysis = null;
          d.turns.push({ turnId: uuid(), role: "assistant", message: analysis.assistantMessage, responseType: analysis.responseType, createdAt: new Date().toISOString() });
        }
        await store.save(client, row);
        // The ledger stores no duplicate copy of the requirement body.
        await store.record(client, profile.ownerKey, input.requestId, "analyze", contentHash, failure ? "failed" : "succeeded", failure || { stateVersion: Number(row.version) });
      });
    } catch {
      // A database outage leaves the persisted pending input recoverable at restart.
      process.stderr.write("requirement-intake: completion persistence unavailable\n");
    }
  }
  async function mutate(profile, action, body) {
    const id = requestKey(body), contentHash = C.hash({ action, body });
    C.assert(["save", "discard", "recover", "confirm-summary", "submit", "close-resolved", "close-out-of-scope"].includes(action), "ACTION_INVALID", "不支持的操作");
    C.assert(Object.keys(body).every(key => ["requestId", "stateVersion", "summaryVersion", "insistReason", "submitMode"].includes(key)), "INPUT_FIELD", "请求包含不支持的字段");
    return store.transaction(async client => {
      const row = await store.owner(client, profile), existing = await store.operation(client, profile.ownerKey, id);
      if (existing) { C.assert(existing.content_hash === contentHash, "IDEMPOTENCY_CONFLICT", "请求编号冲突", 409); return existing.result; }
      checkVersion(row, body);
      const d = row.draft;
      C.assert(d, "NO_DRAFT", "当前没有草稿", 404);
      const clearing = ["discard", "close-resolved", "close-out-of-scope"].includes(action);
      if (action === "close-resolved") C.assert(d.analysis?.responseType === "existing_capability" && !d.dirty, "STATE_INVALID", "当前无法确认能力已解决问题", 409);
      if (action === "close-out-of-scope") C.assert(d.analysis?.responseType === "out_of_scope" && !d.dirty, "STATE_INVALID", "当前不是范围外需求", 409);
      if (!clearing) C.assert(!d.pending, "ANALYSIS_RUNNING", "分析尚未完成，请稍后操作", 409);
      let result;
      if (clearing) {
        row.draft = null;
        await client.query("UPDATE intake_operations SET result=NULL,status=CASE WHEN status='running' THEN 'cancelled' ELSE status END WHERE owner_key=$1 AND action='analyze'", [profile.ownerKey]);
      } else if (action === "save") d.saved = true;
      else if (action === "recover") {
        C.assert(d.analysis && !C.validateShape(d.analysis), "RECOVERY_NOT_REQUIRED", "当前草稿无需版本恢复", 409);
        const last = d.turns.findLast(t => t.role === "user");
        C.assert(last, "RECOVERY_INPUT_MISSING", "草稿缺少原始输入，请联系测试管理员", 409);
        d.recoveryAnalysis = C.redact(JSON.stringify(d.analysis)).slice(0, 15000);
        d.analysis = null; d.confirmation = null; d.reconfirmationCandidate = null; d.summaryVersion++; d.dirty = true; d.lastFailedTurn = last.turnId;
      }
      else {
        const a = d.analysis, r = resourceLoader();
        C.assert(a && !d.dirty && !d.needsReevaluation && d.resourceHash === r.manifest?.buildHash && a.capabilityAssessment.dataStatus === r.context.dataStatus, "REEVALUATION_REQUIRED", "摘要需要重新分析后确认", 409);
        C.assert(["final_summary", "conditional_result"].includes(a.responseType) && ["submit", "not_recommended"].includes(a.recommendation.type), "SUBMIT_NOT_ALLOWED", "当前建议需要继续补充，不能提交", 409);
        C.assert(body.summaryVersion === d.summaryVersion, "SUMMARY_CHANGED", "摘要已变化，请重新确认", 409);
        if (action === "confirm-summary") d.confirmation = { summaryVersion: d.summaryVersion, hash: summaryHash(d), confirmedAt: new Date().toISOString() };
        else {
          C.assert(d.confirmation?.hash === summaryHash(d), "CONFIRM_REQUIRED", "请先独立确认摘要", 409);
          C.assert(["normal", "insisted"].includes(body.submitMode), "SUBMIT_MODE", "请选择提交方式");
          C.assert(a.recommendation.type === "submit" ? body.submitMode === "normal" : body.submitMode === "insisted", "SUBMIT_MODE", "提交方式与 AI 原建议不符");
          const reason = C.redact(body.insistReason || "").trim();
          C.assert(body.submitMode !== "insisted" || (reason.length >= 1 && reason.length <= 2000), "INSIST_REASON", "坚持提交时请填写理由（最多 2000 字）");
          const day = beijingDay();
          await client.query("INSERT INTO intake_sequences(day,value) VALUES($1,0) ON CONFLICT DO NOTHING", [day]);
          const sequence = (await client.query("SELECT value FROM intake_sequences WHERE day=$1 FOR UPDATE", [day])).rows[0].value;
          C.assert(sequence < 999, "DAILY_CAPACITY", "当日编号已用尽，草稿已保留，请联系管理员", 409);
          const requirementId = `REQ-${day}-${String(sequence + 1).padStart(3, "0")}`;
          await client.query("UPDATE intake_sequences SET value=value+1 WHERE day=$1", [day]);
          const snapshot = { analysis: a, versions: d.versions, summaryVersion: d.summaryVersion, confirmation: d.confirmation, submitMode: body.submitMode, insistReason: reason, sourceChannel: "ai_studio_app", draftId: d.draftId };
          await client.query("INSERT INTO intake_submissions(requirement_id,draft_id,owner_key,nickname,department,title,real_problem,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [requirementId, d.draftId, profile.ownerKey, profile.name, profile.department || "", a.draftSummary.title, a.draftSummary.realProblem, snapshot]);
          row.draft = null; result = { requirementId, submitted: true };
        }
      }
      row.version = Number(row.version) + 1;
      await store.save(client, row); await store.audit(client, profile.ownerKey, action, id);
      result ||= { stateVersion: Number(row.version), discarded: clearing, saved: action === "save", confirmed: action === "confirm-summary" };
      await store.record(client, profile.ownerKey, id, action, contentHash, "succeeded", result);
      return result;
    });
  }
  async function session(body) {
    C.assert(typeof body.accessToken === "string" && body.accessToken.length >= 10 && body.accessToken.length < 4096, "LOGIN_REQUIRED", "请先登录钉钉", 401);
    const profile = await options.verifyIdentity(body.accessToken);
    C.assert(profile?.ownerKey && profile.name, "IDENTITY_INVALID", "无法验证登录身份", 401);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 2 * 3600000).toISOString();
    await store.pool.query("INSERT INTO intake_sessions(token_hash,owner_key,profile,expires_at) VALUES($1,$2,$3,$4)", [C.hash(token), profile.ownerKey, profile, expiresAt]);
    return { token, expiresAt, profile: { name: profile.name, department: profile.department } };
  }
  async function authenticate(request) {
    const token = String(request.headers.authorization || "").replace(/^Bearer /, "");
    const row = (await store.pool.query("SELECT profile FROM intake_sessions WHERE token_hash=$1 AND expires_at>now()", [C.hash(token)])).rows[0];
    C.assert(row, "LOGIN_REQUIRED", "登录已失效，请重新登录", 401); return row.profile;
  }
  async function list(url, profile) {
    const page = Math.max(1, Math.min(100000, Number(url.searchParams.get("page")) || 1)), params = [];
    const clauses = [];
    function param(value) { params.push(value); return `$${params.length}`; }
    if (profile) clauses.push(`owner_key=${param(profile.ownerKey)}`);
    const keyword = String(url.searchParams.get("q") || "").trim().slice(0, 200);
    if (keyword) {
      const p = param(keyword);
      clauses.push(/^REQ-/i.test(keyword) ? `requirement_id=${p}` : `(strpos(lower(title),lower(${p}))>0 OR strpos(lower(real_problem),lower(${p}))>0 OR strpos(lower(nickname),lower(${p}))>0)`);
    }
    if (url.searchParams.get("exported") === "yes") clauses.push("export_count>0");
    if (url.searchParams.get("exported") === "no") clauses.push("export_count=0");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = Number((await store.pool.query(`SELECT count(*) FROM intake_submissions ${where}`, params)).rows[0].count);
    const rows = (await store.pool.query(`SELECT requirement_id,nickname,department,title,real_problem,submitted_at,export_count,last_exported_at,snapshot->>'submitMode' AS submit_mode FROM intake_submissions ${where} ORDER BY submitted_at DESC LIMIT 20 OFFSET ${param((page - 1) * 20)}`, params)).rows;
    return { items: rows, total, page, pageSize: 20 };
  }
  async function detail(id, profile) {
    const row = (await store.pool.query("SELECT * FROM intake_submissions WHERE requirement_id=$1" + (profile ? " AND owner_key=$2" : ""), profile ? [id, profile.ownerKey] : [id])).rows[0];
    C.assert(row, "NOT_FOUND", "需求不存在", 404); delete row.owner_key; return row;
  }
  async function exportRecord(id, body) {
    requestKey(body);
    return store.transaction(async client => {
      const row = await detail(id), content = markdown(row), contentHash = C.hash(content);
      const exportId = uuid();
      await client.query("INSERT INTO intake_exports(export_id,request_id,requirement_id,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING", [exportId, body.requestId, id, contentHash]);
      const record = (await client.query("SELECT * FROM intake_exports WHERE request_id=$1", [body.requestId])).rows[0];
      C.assert(record.requirement_id === id && record.content_hash === contentHash, "IDEMPOTENCY_CONFLICT", "导出请求编号冲突", 409);
      return { exportId: record.export_id, filename: `${id}.md`, content, sha256: contentHash };
    });
  }
  async function acknowledgeExport(id, body) {
    return store.transaction(async client => {
      const record = (await client.query("SELECT * FROM intake_exports WHERE export_id=$1 AND requirement_id=$2 FOR UPDATE", [body.exportId, id])).rows[0];
      C.assert(record && record.content_hash === body.sha256, "EXPORT_INVALID", "导出确认信息不匹配", 409);
      if (!record.completed_at) {
        await client.query("UPDATE intake_exports SET completed_at=now() WHERE export_id=$1", [body.exportId]);
        await client.query("UPDATE intake_submissions SET export_count=export_count+1,last_exported_at=now() WHERE requirement_id=$1", [id]);
      }
      return { ok: true };
    });
  }
  async function handleRequest(request, response, url, pathname) {
    const match = pathname.match(/^\/api\/(desktop|admin)\/requirements(?:\/(.*))?$/);
    if (!match) return false;
    try {
      await store.ready;
      const admin = match[1] === "admin", route = match[2] || "";
      if (admin && !options.requireManagement(request, response)) return true;
      const body = request.method === "POST" ? await options.readJsonBody(request, 128 * 1024) : {};
      let value;
      if (!admin && route === "session" && request.method === "POST") value = await session(body);
      else {
        const profile = admin ? null : await authenticate(request);
        if (!admin && route === "current" && request.method === "GET") value = await current(profile);
        else if (!admin && route === "analyze" && request.method === "POST") value = await reserve(profile, body);
        else if (!admin && route.startsWith("operations/") && request.method === "GET") {
          await current(profile);
          value = (await store.pool.query("SELECT request_id,status,result FROM intake_operations WHERE owner_key=$1 AND request_id=$2", [profile.ownerKey, route.slice(11)])).rows[0]; C.assert(value, "NOT_FOUND", "请求不存在", 404);
        } else if (!admin && ["save", "discard", "recover", "confirm-summary", "submit", "close-resolved", "close-out-of-scope"].includes(route) && request.method === "POST") value = await mutate(profile, route, body);
        else if ((!route || route === "mine") && request.method === "GET") value = await list(url, profile);
        else {
          const record = route.match(/^(REQ-\d{8}-\d{3})(?:\/(export|export-complete))?$/);
          C.assert(record, "NOT_FOUND", "接口不存在", 404);
          if (request.method === "GET" && !record[2]) value = await detail(record[1], profile);
          else if (admin && request.method === "POST" && record[2] === "export") value = await exportRecord(record[1], body);
          else if (admin && request.method === "POST" && record[2] === "export-complete") value = await acknowledgeExport(record[1], body);
          else throw C.error("METHOD_INVALID", "不支持的请求方式", 405);
        }
      }
      options.sendJson(response, 200, value);
    } catch (e) { options.sendJson(response, e.status || 503, { code: e.code || "SERVICE_UNAVAILABLE", error: e.status ? e.message : "需求服务暂不可用，已保存的内容不会丢失" }); }
    return true;
  }
  return { ready: store.ready, store, current, reserve, mutate, session, list, detail, exportRecord, acknowledgeExport, handleRequest, jobs, async close() { await Promise.allSettled(jobs); await store.close(); } };
}
module.exports = { createIntake, markdown, labels, beijingDay };
