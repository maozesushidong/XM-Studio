"use strict";
window.RequirementAdmin = (() => {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const labels = { title: "需求标题", originalRequest: "原始诉求", realProblem: "真实问题", rolesAndScenario: "角色与场景", currentWorkflow: "当前流程", bottleneck: "主要卡点", impactAndEvidence: "影响与证据", expectedOutcome: "预期结果", successCriteria: "成功标准", inScope: "本期范围", outOfScope: "不做范围", dependencies: "依赖", risks: "风险", validationPlan: "验证计划" };
  let root, request, active, page = 1, query = "", exported = "", loading = false, result = { items: [], total: 0 }, detail = null, error = "", pendingExport = null;
  const date = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-";
  const requestId = () => [...crypto.getRandomValues(new Uint8Array(20))].map(n => n.toString(16).padStart(2, "0")).join("");
  const api = (route = "", body) => request(`/api/admin/requirements${route}`, body ? { method: "POST", body: JSON.stringify(body) } : {});
  function render() {
    if (!root || !active()) return;
    root.innerHTML = `<section class="req-admin"><header class="view-head"><div><h2>${detail ? "需求详情" : "需求管理"}</h2><p>${detail ? escape(detail.requirement_id) : `共 ${result.total} 条提报`}</p></div><div class="tools">${detail ? `<button class="secondary" data-ra="back">返回列表</button><button class="primary" data-ra="export" ${loading ? "disabled" : ""}>导出 Markdown</button>` : ""}</div></header>${error ? `<div class="req-admin-error" role="alert" tabindex="-1">${escape(error)}<button class="secondary" data-ra="retry">重试</button></div>` : ""}${detail ? `<div class="req-admin-meta"><span>提交人：${escape(detail.nickname)}</span><span>部门：${escape(detail.department || "-")}</span><span>提交时间：${date(detail.submitted_at)}</span><span>导出 ${detail.export_count} 次</span><span>AI 原建议：${({ submit: "建议提交", not_recommended: "暂不建议提交" })[detail.snapshot.analysis.recommendation.type]}</span><span>提交方式：${detail.snapshot.submitMode === "insisted" ? "坚持提交" : "普通提交"}</span></div>${detail.snapshot.insistReason ? `<p class="req-admin-reason">坚持理由：${escape(detail.snapshot.insistReason)}</p>` : ""}<dl class="req-admin-detail">${Object.entries(labels).map(([key, label]) => `<div><dt>${label}</dt><dd>${escape(detail.snapshot.analysis.draftSummary[key])}</dd></div>`).join("")}<div><dt>建议解决方向</dt><dd>${escape(detail.snapshot.analysis.solutionProposal.direction)}</dd></div><div><dt>MVP 范围</dt><dd>${detail.snapshot.analysis.solutionProposal.mvpScope.map(escape).join("\n")}</dd></div></dl>` : `<form class="req-admin-filter"><input name="q" aria-label="搜索需求" maxlength="200" placeholder="需求编号、标题、真实问题或昵称" value="${escape(query)}"><select name="exported" aria-label="导出状态"><option value="">全部导出状态</option value="no" ${exported === "no" ? "selected" : ""}>未导出</option><option value="yes" ${exported === "yes" ? "selected" : ""}>已导出</option></select><button type="submit" class="primary" ${loading ? "disabled" : ""}>查询</button><button type="button" class="secondary" data-ra="reset">重置</button></form><div class="table-panel"><table><thead><tr><th>需求编号</th><th>需求标题</th><th>提交人</th><th>提交时间</th><th>导出状态</th><th>操作</th></tr></thead><tbody>${result.items.length ? result.items.map(r => `<tr><td>${escape(r.requirement_id)}</td><td class="req-admin-title">${escape(r.title)}</td><td>${escape(r.nickname)}</td><td>${date(r.submitted_at)}</td><td>${r.export_count ? `已导出 ${r.export_count} 次` : "未导出"}</td><td><button class="secondary" data-ra="detail" data-id="${escape(r.requirement_id)}">详情</button></td></tr>`).join("") : `<tr><td colspan="6" class="req-admin-empty">${loading ? "正在加载…" : "暂无需求提报"}</td></tr>`}</tbody></table></div><footer class="req-admin-pagination"><button class="secondary" data-ra="previous" ${page <= 1 || loading ? "disabled" : ""}>上一页</button><span>第 ${page} 页</span><button class="secondary" data-ra="next" ${page * 20 >= result.total || loading ? "disabled" : ""}>下一页</button></footer>`}</section>`;
    root.querySelector("form")?.addEventListener("submit", e => { e.preventDefault(); const data = new FormData(e.currentTarget); query = data.get("q"); exported = data.get("exported"); page = 1; run(load); });
    root.querySelectorAll("[data-ra]").forEach(b => b.addEventListener("click", () => run(async () => {
      if (b.dataset.ra === "detail") detail = await api(`/${b.dataset.id}`);
      if (b.dataset.ra === "back") { detail = null; await load(); }
      if (b.dataset.ra === "reset") { query = ""; exported = ""; page = 1; await load(); }
      if (b.dataset.ra === "previous" || b.dataset.ra === "next") { page += b.dataset.ra === "next" ? 1 : -1; await load(); }
      if (b.dataset.ra === "retry") { if (pendingExport) await completeExport(); else if (detail) detail = await api(`/${detail.requirement_id}`); else await load(); }
      if (b.dataset.ra === "export") {
        const item = await api(`/${detail.requirement_id}/export`, { requestId: requestId() });
        if (crypto.subtle) {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(item.content));
          const checksum = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
          if (checksum !== item.sha256) throw new Error("文件内容校验失败，请重试");
        }
        const url = URL.createObjectURL(new Blob([item.content], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = item.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        pendingExport = { id: detail.requirement_id, exportId: item.exportId, sha256: item.sha256 }; await completeExport();
      }
    })));
  }
  async function completeExport() { await api(`/${pendingExport.id}/export-complete`, { exportId: pendingExport.exportId, sha256: pendingExport.sha256 }); pendingExport = null; detail = await api(`/${detail.requirement_id}`); }
  async function load() { result = await api(`?q=${encodeURIComponent(query)}&exported=${exported}&page=${page}`); }
  async function run(work) { if (loading) return; loading = true; error = ""; render(); try { await work(); } catch (e) { error = e.message; } finally { loading = false; render(); if (error) root.querySelector("[role=alert]")?.focus(); } }
  async function mount(element, fetcher, isActive) { root = element; request = fetcher; active = isActive; detail = null; await run(load); }
  return { mount };
})();
