"use strict";
window.XmaiRequirements = (() => {
  const labels = { title: "需求标题", originalRequest: "原始诉求", realProblem: "真实问题", rolesAndScenario: "角色与场景", currentWorkflow: "当前流程", bottleneck: "主要卡点", impactAndEvidence: "影响与证据", expectedOutcome: "预期结果", successCriteria: "成功标准", inScope: "本期范围", outOfScope: "不做范围", dependencies: "依赖", risks: "风险", validationPlan: "验证计划" };
  const dimensions = { real_problem: "真实问题", role_scenario: "角色场景", current_workflow: "当前流程", impact_evidence: "影响证据", expected_outcome: "预期结果", scope_branches: "范围边界", success_criteria: "成功标准" };
  const recommendations = { submit: "建议提交", supplement: "继续补充", not_recommended: "暂不建议提交", not_applicable: "不适用" };
  const relations = { directly_supported: "现有能力可解决", partially_supported: "现有能力部分解决", not_supported: "当前无对应能力", unknown: "暂时无法判断" };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = v => v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "";
  let root, config, owner, current = { stateVersion: 0, draft: null }, busy = false, error = "", note = "", text = "", reason = "", mode = "intake", items = [], detail = null, page = 1, total = 0, query = "", action = "answer", retryPayload = null, pollTimer, epoch = 0, confirmOpen = false;
  const id = () => crypto.randomUUID();
  const api = async (route, body) => { const version = epoch; const value = await config.api({ route, method: body ? "POST" : "GET", body }); if (version !== epoch) throw new Error("用户已切换"); return value; };
  const icon = name => config.icon(name);
  const button = (label, name, symbol = "", primary = false, disabled = busy) => `<button type="button" class="${primary ? "primary-button" : "secondary-button"}" data-req="${name}" ${disabled ? "disabled" : ""}>${symbol ? icon(symbol) : ""}<span>${label}</span></button>`;
  const badge = (label, tone = "") => `<span class="req-badge ${tone}">${esc(label)}</span>`;
  function summary(a, compact = false) {
    const fields = compact ? ["originalRequest", "realProblem", "rolesAndScenario", "currentWorkflow", "bottleneck", "expectedOutcome"] : Object.keys(labels);
    return `<dl class="req-summary">${fields.filter(key => !compact || a.draftSummary[key]).map(key => `<div><dt>${labels[key]}</dt><dd>${esc(a.draftSummary[key] || "待补充")}</dd></div>`).join("")}${!compact ? `<div class="req-wide"><dt>建议解决方向</dt><dd>${esc(a.solutionProposal.direction || "待明确")}</dd></div><div><dt>第一期范围</dt><dd>${a.solutionProposal.mvpScope.map(esc).join("\n")}</dd></div><div><dt>不做范围</dt><dd>${a.solutionProposal.excludedScope.map(esc).join("\n") || "待明确"}</dd></div>` : ""}</dl>`;
  }
  function review(d, blocked) {
    const a = d.analysis, allowed = a.allowedUiActions;
    if (d.dirty) return "";
    if (a.responseType === "stage_summary") return `<section class="req-review"><header><strong>阶段理解</strong>${badge("等待确认")}</header>${summary(a, true)}${a.assumptions.length ? `<p class="req-muted">待验证：${a.assumptions.map(x => esc(x.text)).join("；")}</p>` : ""}<div class="req-review-actions">${button("需要修正", "correct", "square-pen", false, blocked)}${button("以上理解正确", "accept", "check", true, blocked)}</div></section>`;
    if (!["final_summary", "conditional_result"].includes(a.responseType)) return "";
    const confirmable = allowed.includes("confirm_summary") && !d.needsReevaluation;
    return `<section class="req-review"><header><strong>提交前摘要</strong>${badge(d.confirmation ? "摘要已确认" : "待确认", d.confirmation ? "green" : "")}</header>${summary(a)}<div class="req-recommendation"><strong>AI 建议：${recommendations[a.recommendation.type]}</strong><p>${esc(a.recommendation.explanation)}</p></div><div class="req-review-actions">${button("返回修改", "correct", "square-pen", false, blocked)}${confirmable ? d.confirmation ? button(a.recommendation.type === "not_recommended" ? "坚持提交" : "确认提交", "submit", "check", true, blocked) : button("确认摘要", "confirm", "check", true, blocked) : ""}</div></section>`;
  }
  function rail(d) {
    const a = d?.analysis;
    return `<aside class="req-understanding"><header><div><h2>需求理解</h2>${badge(d?.pending ? "分析中" : d?.confirmation ? "待提交" : a ? "分析中" : "未开始")}</div><progress value="${a?.completeness.score || 0}" max="100" aria-label="分析完整度"></progress><div class="req-progress-label"><span>分析完整度</span><strong>${a?.completeness.score || 0}%</strong></div></header><div class="req-rail-content"><section><h3>现有能力关系</h3>${badge(a ? relations[a.capabilityAssessment.relation] : "等待核对")}<p>${esc(a?.capabilityAssessment.gap || a?.capabilityAssessment.uncertainty || (a ? "依据当前版本能力资料进行对比。" : "等待你描述需求"))}</p></section><section><h3>已确认事实</h3>${a?.confirmedFacts.some(f=>f.status !== "invalidated") ? a.confirmedFacts.filter(f=>f.status !== "invalidated").map(f=>`<div class="req-fact"><small>${dimensions[f.dimension] || "约束与风险"}</small><p>${esc(f.text)}</p></div>`).join("") : '<p class="req-muted">暂无已确认内容</p>'}</section>${a?.openQuestions.length ? `<section><h3>待确认事项</h3>${a.openQuestions.map(q=>`<p>${esc(q.text)}</p>`).join("")}</section>` : ""}${a?.conflicts.some(c=>!c.resolved) ? `<section><h3>待解决分歧</h3>${a.conflicts.filter(c=>!c.resolved).map(c=>`<p>${esc(c.text)}</p>`).join("")}</section>` : ""}<section><h3>建议方案</h3><p>${esc(a?.solutionProposal.direction || "待分析完成")}</p>${a?.solutionProposal.mvpScope.length ? `<ul>${a.solutionProposal.mvpScope.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>` : ""}</section></div><footer>${button("查看我的提报", "mine", "history", false, false)}</footer></aside>`;
  }
  function intake() {
    const d = current.draft, a = d?.analysis, allowed = a?.allowedUiActions || [], blocked = busy || Boolean(d?.pending);
    return `<div class="req-layout"><div class="req-conversation"><div class="req-messages" aria-live="polite">${d?.turns.some(t=>t.message) ? d.turns.filter(t=>t.message).map(t=>`<article class="req-message ${t.role}"><span class="req-avatar">${t.role === "user" ? "我" : "AI"}</span><div><small>${t.role === "user" ? "我" : t.responseType === "stage_summary" ? "阶段总结" : "需求分析"}</small><p>${esc(t.message)}</p></div></article>`).join("") : `<div class="req-empty"><img src="./assets/icon.png" alt="XMAI Studio"><h2>你希望 AI Studio 有哪些改进？</h2><p>说说你遇到的问题，或希望达成的结果。</p></div>`}${a ? review(d, blocked) : ""}${d?.pending ? '<div class="req-thinking" role="status"><span></span>正在分析需求，输入已保存…</div>' : ""}</div>${d?.needsReevaluation ? `<div class="req-notice">已保留草稿，能力资料更新后需重新核对。${button("重新评估", "reevaluate", "rotate-cw", false, blocked)}</div>` : ""}${d?.incompatible ? `<div class="req-notice">旧版本草稿已保留。${button("恢复草稿", "recover", "rotate-cw", false, blocked)}</div>` : ""}<div class="req-actions">${allowed.includes("close_resolved") && !d.dirty ? button("已解决我的问题", "resolved", "check", true, blocked) : ""}${allowed.includes("continue_gap") && !d.dirty ? button("仍有差距", "gap", "message-square", false, blocked) : ""}${allowed.includes("close_out_of_scope") && !d.dirty ? button("结束分析", "out-of-scope", "check", false, blocked) : ""}</div><form class="req-composer"><textarea id="req-message" rows="2" maxlength="16000" aria-label="需求与补充信息" placeholder="${action === "correct" ? "请指出需要修正的内容…" : action === "continue_gap" ? "描述尚未解决的问题…" : "描述具体场景、遇到的问题或希望达成的结果…"}" ${blocked || d?.incompatible ? "disabled" : ""}>${esc(text)}</textarea><button class="primary-button" type="submit" ${blocked || d?.incompatible ? "disabled" : ""}>${icon("arrow-up")}<span>${action === "correct" ? "提交修正" : "发送"}</span></button></form></div>${rail(d)}</div>`;
  }
  function mine() {
    const a = detail?.snapshot?.analysis;
    return `<form class="req-search"><input aria-label="搜索我的提报" placeholder="搜索需求编号、标题或问题" value="${esc(query)}" maxlength="200"><button class="secondary-button" type="submit">${icon("search")}查询</button></form><div class="req-submitted-count">已提交 <span>${total}</span></div><div class="req-submissions"><div class="req-records">${items.length ? items.map(item=>`<button class="req-record ${detail?.requirement_id === item.requirement_id ? "active" : ""}" data-req="detail" data-id="${esc(item.requirement_id)}"><strong>${esc(item.title)}</strong><span>${esc(item.real_problem)}</span><small>${esc(date(item.submitted_at))}</small>${badge("已提交")}</button>`).join("") : '<div class="req-empty">暂无提交记录</div>'}</div><article class="req-readonly">${a ? `<header><h2>${esc(detail.title || a.draftSummary.title)}</h2>${badge("已提交", "green")}</header><p class="req-meta">${esc(detail.requirement_id)} · ${esc(date(detail.submitted_at))}</p><div class="req-readonly-meta">${badge(recommendations[a.recommendation.type])}${badge(detail.snapshot.submitMode === "insisted" ? "坚持提交" : "普通提交")}${badge(relations[a.capabilityAssessment.relation])}</div>${detail.snapshot.insistReason ? `<p>坚持理由：${esc(detail.snapshot.insistReason)}</p>` : ""}${summary(a)}` : '<div class="req-empty">选择一条提报查看详情</div>'}</article></div><div class="req-pagination">${button("上一页", "previous", "chevron-left", false, page <= 1 || busy)}<span>第 ${page} 页 · 共 ${total} 条</span>${button("下一页", "next", "chevron-right", false, page * 20 >= total || busy)}</div>`;
  }
  function submitDialog() {
    if (!confirmOpen || !current.draft?.confirmation) return "";
    const insisted = current.draft.analysis.recommendation.type === "not_recommended";
    return `<div class="req-modal-backdrop"><section class="req-modal" role="dialog" aria-modal="true" aria-label="确认提交需求"><h2>确认提交需求</h2><p>${esc(current.draft.analysis.draftSummary.title)}</p>${badge(recommendations[current.draft.analysis.recommendation.type])}${insisted ? `<label class="req-reason">坚持提交的理由<textarea id="req-reason" rows="3" maxlength="2000" placeholder="说明仍希望提交的原因">${esc(reason)}</textarea></label>` : ""}<p class="req-muted">提交后正文不可修改。${insisted ? "AI 原建议将同时保留。" : ""}</p><div class="req-review-actions">${button("取消", "cancel-submit")}${button("确认提交", "commit", "check", true)}</div></section></div>`;
  }
  function render() {
    if (!root?.isConnected || root.dataset.requirementOwner !== owner) return;
    const d = current.draft;
    root.innerHTML = `<section class="req-module ${mode === "mine" ? "req-mine" : ""}"><header class="req-header"><div><h1>${mode === "mine" ? "我的提报" : "需求提报"}</h1></div><div class="req-toolbar">${mode === "mine" ? button(d ? "继续当前草稿" : "提报新需求", "back", "plus", false, false) : `${d ? button("放弃草稿", "discard", "trash-2", false, busy || Boolean(d.pending)) + button("暂存", "save", "save", false, busy || Boolean(d.pending)) : ""}${button("我的提报", "mine", "history", false, false)}`}</div></header>${error ? `<div class="req-error" role="alert" tabindex="-1"><span>${esc(error)}</span>${button("重试", "retry", "rotate-cw", false, busy)}</div>` : ""}${note ? `<p class="req-note" role="status">${esc(note)}</p>` : ""}${mode === "mine" ? mine() : intake()}${submitDialog()}</section>`;
    root.querySelector(".req-composer")?.addEventListener("submit", e => { e.preventDefault(); send(); });
    root.querySelector(".req-search")?.addEventListener("submit", e => { e.preventDefault(); query = e.currentTarget.querySelector("input").value; page = 1; perform(loadMine); });
    root.querySelector("#req-message")?.addEventListener("input", e => { text = e.target.value; });
    root.querySelector("#req-message")?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } });
    root.querySelector("#req-reason")?.addEventListener("input", e => { reason = e.target.value; });
    if (confirmOpen && error) {
      const alert = document.createElement("p"); alert.className = "req-error"; alert.setAttribute("role", "alert"); alert.textContent = error;
      root.querySelector(".req-modal .req-review-actions")?.before(alert);
    }
    root.querySelectorAll("[data-req]").forEach(el => el.addEventListener("click", () => click(el.dataset.req, el.dataset.id)));
    const a = d?.analysis;
    if (a && !d.dirty && !a.allowedUiActions.some(item=>["answer","correct","continue_gap"].includes(item))) root.querySelectorAll(".req-composer textarea,.req-composer [type=submit]").forEach(el=>{el.disabled=true;});
    const messages = root.querySelector(".req-messages"); if (messages) messages.scrollTop = messages.scrollHeight;
  }
  async function refresh() { current = await api("current"); if (current.draft?.pending) poll(current.draft.pending); if (current.draft?.error) error = current.draft.error.error; }
  async function perform(work) {
    if (busy) return;
    const version = epoch; busy = true; error = ""; note = ""; render();
    try { await work(); } catch (e) { if (version !== epoch) return; error = e.message || "请求失败，请重试"; if (e.code === "VERSION_CONFLICT") { confirmOpen = false; await refresh().catch(()=>{}); } }
    finally { if (version === epoch) { busy = false; render(); if (error) root?.querySelector(".req-error")?.focus(); } }
  }
  function poll(requestId) {
    clearTimeout(pollTimer); const version = epoch;
    pollTimer = setTimeout(async()=>{
      if (version !== epoch) return;
      try { const op = await api(`operations/${requestId}`); if (op.status === "running") { poll(requestId); return; } await refresh(); error = op.status === "failed" ? op.result?.error || "分析失败，请重试" : ""; render(); }
      catch { error = "连接中断，输入已保留。点击重试以恢复连接。"; render(); }
    }, 1500);
  }
  async function analyze(selected, message = "", retry = false) {
    retryPayload = { requestId: id(), stateVersion: current.stateVersion, action: selected, message, retry };
    const op = await api("analyze", retryPayload); retryPayload = null; text = ""; action = "answer"; await refresh();
    if (op.status === "running") poll(op.request_id); else if (op.status === "failed") error = op.result?.error || "分析失败，请重试";
  }
  function send() {
    if (!text.trim() || busy || current.draft?.pending) return;
    const allowed = current.draft?.analysis?.allowedUiActions || [];
    const selected = !current.draft?.analysis ? "start" : action === "answer" && !allowed.includes("answer") ? allowed.includes("correct") ? "correct" : "continue_gap" : action;
    perform(()=>analyze(selected, text));
  }
  async function mutation(route, extra = {}) {
    const body = { requestId: id(), stateVersion: current.stateVersion, ...extra };
    retryPayload = { route, body };
    const result = await api(route, body); retryPayload = null; await refresh(); return result;
  }
  async function loadMine() { const result = await api(`mine?page=${page}&q=${encodeURIComponent(query)}`); items = result.items; total = result.total; mode = "mine"; confirmOpen = false; detail = items.length ? await api(items[0].requirement_id) : null; }
  function click(name, recordId) {
    if (name === "correct" || name === "gap") { action = name === "correct" ? "correct" : "continue_gap"; render(); root.querySelector("#req-message")?.focus(); return; }
    if (name === "back") { mode = "intake"; error = ""; render(); return; }
    if (name === "submit" || name === "cancel-submit") { confirmOpen = name === "submit"; render(); root.querySelector("#req-reason")?.focus(); return; }
    perform(async()=>{
      if (name === "mine") await loadMine();
      if (name === "previous" || name === "next") { page += name === "next" ? 1 : -1; await loadMine(); }
      if (name === "detail") detail = await api(recordId);
      if (name === "accept") await analyze("accept_stage_summary");
      if (name === "reevaluate") await analyze("retry_capability");
      if (name === "save") { await mutation("save"); note = "草稿已暂存"; }
      if (name === "recover") { await mutation("recover"); await analyze("resume", "", true); }
      if (name === "discard" && window.confirm("放弃当前草稿？已填写的内容将被清除。")) { await mutation("discard"); text = ""; reason = ""; }
      if (name === "resolved" || name === "out-of-scope") { await mutation(name === "resolved" ? "close-resolved" : "close-out-of-scope"); note = "分析已结束，未生成提交记录"; }
      if (name === "confirm") await mutation("confirm-summary", { summaryVersion: current.draft.summaryVersion });
      if (name === "commit") {
        const insisted = current.draft.analysis.recommendation.type === "not_recommended";
        if (insisted && !reason.trim()) throw new Error("请填写坚持提交的理由");
        const result = await mutation("submit", { summaryVersion: current.draft.summaryVersion, submitMode: insisted ? "insisted" : "normal", insistReason: reason });
        confirmOpen = false; reason = ""; note = `提交成功：${result.requirementId}`;
      }
      if (name === "retry") {
        if (retryPayload) { const result = await api(retryPayload.route || "analyze", retryPayload.body || retryPayload); retryPayload = null; await refresh(); if (result.requirementId) { confirmOpen = false; note = `提交成功：${result.requirementId}`; } }
        else { await refresh(); if (current.draft?.lastFailedTurn) await analyze("resume", "", true); else if (mode === "mine") await loadMine(); }
      }
    });
  }
  function mount(element, options) {
    const newOwner = String(options.owner || "anonymous");
    if (owner !== newOwner) { epoch++; clearTimeout(pollTimer); current = { stateVersion: 0, draft: null }; text = ""; reason = ""; error = ""; note = ""; retryPayload = null; detail = null; mode = "intake"; items = []; busy = false; confirmOpen = false; page = 1; query = ""; }
    owner = newOwner; root = element; config = options;
    if (element.dataset.requirementOwner === owner && element.querySelector(".req-module")) return;
    element.dataset.requirementOwner = owner; render(); perform(refresh);
  }
  return { mount };
})();
