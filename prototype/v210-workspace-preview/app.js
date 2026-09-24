const app = document.getElementById("app");
const overlayRoot = document.getElementById("overlay-root");
const toastRoot = document.getElementById("toast-root");

const state = {
  view: "requirement",
  requirementMode: "intake",
  requirementStage: "empty",
  requirementText: "",
  requirementAnswer: "",
  selectedSubmission: 0,
  taskFilter: "all",
  selectedModel: "gpt-5.6-luna",
  modelOpen: false,
  modelQuery: "",
};

const submissions = [
  {
    id: "REQ-20260831-142",
    title: "自动将新品资料转填至固定 Excel 登记表",
    suggestion: "建议提交",
    submitted: "2026-08-31 14:19",
    relation: "当前无对应能力",
    problem: "固定表格间重复复制粘贴耗时，且存在漏填、错填风险",
    impact: "每次约 5 个新品，人工需要数小时",
    solution: "固定源表与固定登记模板自动映射，生成新文件后逐项核对并输出异常清单。",
    mvp: "固定模板、约 5 个新品、新文件输出、异常识别与人工检查",
    insist: false,
  },
  {
    id: "REQ-20260828-096",
    title: "浏览器支持多个店铺批量执行相同任务",
    suggestion: "建议提交",
    submitted: "2026-08-28 10:32",
    relation: "现有能力部分解决",
    problem: "同一商品活动需要在多个店铺后台重复配置，操作步骤完全相同。",
    impact: "活动高峰期需要逐店处理，容易漏掉部分店铺。",
    solution: "在现有浏览器操作能力上增加任务模板与店铺队列，逐个执行并汇总结果。",
    mvp: "固定活动流程、3 个测试店铺、失败停留与结果清单",
    insist: false,
  },
  {
    id: "REQ-20260826-081",
    title: "提升内容生成结果的稳定性",
    suggestion: "暂不建议提交",
    submitted: "2026-08-26 16:08",
    relation: "暂时无法判断",
    problem: "相同提示词生成结果偶尔差异较大，但尚未沉淀可复现样本。",
    impact: "编辑需要重复生成并人工选择，耗时尚未统计。",
    solution: "先收集相同输入下的失败样本与可接受标准，再判断应优化提示词、模型路由还是生成参数。",
    mvp: "收集 20 组样本、标记失败类型、形成可复现测试集",
    insist: true,
  },
];

const tasks = [
  {
    id: 1,
    icon: "calendar-days",
    name: "生成上周周报",
    instruction: "整理上周工作记录并按公司模板生成结构化周报",
    cycle: "weekly",
    cycleLabel: "每周一 · 09:00",
    time: "09:00",
    workspace: "运营工作",
    status: "running",
    next: "下次运行：周一 09:00",
    latest: "最近成功：2026-09-14 09:02",
  },
  {
    id: 2,
    icon: "notebook-pen",
    name: "整理每日工作记录",
    instruction: "汇总当天工作记录并生成简要总结",
    cycle: "daily",
    cycleLabel: "每天 · 18:00",
    time: "18:00",
    workspace: "运营工作",
    status: "running",
    next: "下次运行：今天 18:00",
    latest: "最近失败：2026-09-14 18:00",
  },
  {
    id: 3,
    icon: "sheet",
    name: "整理新品登记表",
    instruction: "检查新品登记表并输出异常项清单",
    cycle: "once",
    cycleLabel: "单次 · 2026-09-14 10:00",
    time: "10:00",
    workspace: "运营工作",
    status: "missed",
    next: "计划时间：2026-09-14 10:00",
    latest: "最近记录：2026-09-14 10:00",
  },
  {
    id: 4,
    icon: "image",
    name: "检查新品图片",
    instruction: "检查工作区新增图片的尺寸和文件格式",
    cycle: "daily",
    cycleLabel: "每天 · 20:00",
    time: "20:00",
    workspace: "设计工作",
    status: "paused",
    next: "已暂停，不会自动运行",
    latest: "尚未运行",
  },
];

const modelGroups = [
  {
    label: "自动选择",
    models: [
      { id: "auto", name: "Auto 自动选择", desc: "根据任务类型自动选择合适模型" },
    ],
  },
  {
    label: "通用与推理",
    models: [
      { id: "gpt-6-astra", name: "GPT-6 Astra", desc: "复杂分析、规划与高难度任务" },
      { id: "gpt-6", name: "GPT-6", desc: "新一代通用模型" },
      { id: "gpt-5.6", name: "GPT-5.6", desc: "高质量通用模型" },
      { id: "gpt-5.6-sol", name: "5.6 Sol", desc: "复杂编码与长任务" },
      { id: "gpt-5.6-terra", name: "5.6 Terra", desc: "日常工作与综合任务" },
      { id: "gpt-5.6-luna", name: "5.6 Luna", desc: "快速对话与轻量任务" },
      { id: "gpt-5.5", name: "5.5", desc: "稳定的综合能力" },
      { id: "gpt-5.4", name: "5.4", desc: "通用文本与分析" },
      { id: "gpt-5.4-mini", name: "5.4 Mini", desc: "更快的轻量文本任务" },
      { id: "gpt-5.3-codex-spark", name: "5.3 Codex Spark", desc: "快速编码与修改" },
      { id: "gpt-5.2", name: "5.2", desc: "长任务与专业工作" },
      { id: "codex-auto-review", name: "Codex Auto Review", desc: "代码审查与风险检查" },
    ],
  },
  {
    label: "图片生成",
    models: [
      { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", desc: "高质量图片生成" },
      { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", desc: "快速图片生成与编辑" },
      { id: "gpt-image-2", name: "GPT Image 2", desc: "通用图片生成" },
      { id: "gpt-image-1.5", name: "GPT Image 1.5", desc: "图片生成与局部修改" },
      { id: "gpt-image-1", name: "GPT Image 1", desc: "兼容图片任务" },
    ],
  },
  {
    label: "DeepSeek",
    models: [
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", desc: "文本、推理与通用任务" },
      { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", desc: "图片理解与多模态任务" },
    ],
  },
  {
    label: "Gemini",
    models: [
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", desc: "快速响应与长上下文任务" },
    ],
  },
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name, attrs = "") {
  return `<i data-lucide="${name}" ${attrs} aria-hidden="true"></i>`;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setActiveNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function render() {
  setActiveNavigation();
  if (state.view === "requirement") renderRequirement();
  if (state.view === "tasks") renderTasks();
  if (state.view === "chat") renderChat();
  refreshIcons();
  app.focus({ preventScroll: true });
}

function renderRequirement() {
  if (state.requirementMode === "submissions") {
    renderSubmissions();
    return;
  }

  const content = renderRequirementStage();
  const rail = renderUnderstandingRail();
  const isSummary = ["summary", "ready", "submitted"].includes(state.requirementStage);

  app.innerHTML = `
    <section class="view requirement-layout">
      <div class="requirement-main">
        <header class="requirement-header">
          <div>
            <p class="eyebrow">需求提报 / 新需求</p>
            <h1>新需求提报</h1>
            <p>一条独立对话只分析一条 AI Studio 产品需求</p>
          </div>
          <div class="header-meta">
            ${state.requirementStage === "empty"
              ? `<span class="draft-state">等待描述需求</span>`
              : `<span class="draft-state active">草稿已保存</span><button class="button ghost sm" data-action="discard-requirement">放弃并新建</button>`}
          </div>
        </header>
        <div class="intake-stage" id="intake-stage">${content}</div>
        ${isSummary ? "" : renderRequirementComposer()}
      </div>
      ${rail}
    </section>
  `;
}

function renderRequirementStage() {
  if (state.requirementStage === "empty") {
    return `
      <div class="empty-intake">
        <div class="empty-wrap">
          <div class="empty-icon">${icon("clipboard-pen-line")}</div>
          <h2>请描述你希望 AI Studio 解决的问题</h2>
          <p>发送后，需求分析 Skill 会先核对当前产品能力，再围绕真实场景逐轮追问。</p>
          <div class="suggestion-row">
            <button type="button" data-action="requirement-suggestion">切换页面后草稿会丢失</button>
            <button type="button" data-action="requirement-suggestion">希望浏览器任务可以批量执行</button>
            <button type="button" data-action="requirement-suggestion">图片处理结果希望更稳定</button>
          </div>
        </div>
      </div>
    `;
  }

  const original = escapeHtml(state.requirementText || "我希望 AI Studio 能在需求提交前保存独立草稿，切换页面后继续上次分析。");
  const answer = escapeHtml(state.requirementAnswer || "昨天分析到一半去技能库查资料，回来后之前确认的事实和当前问题丢了，只能重新输入。");
  const question = `你通常在什么场景下遇到这个问题？现在会怎么处理，它带来了什么影响？`;

  let extra = "";
  if (state.requirementStage === "question") {
    extra = `
      <div class="message">
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="message-label">需求分析</div>
          <p>我会先检查当前版本的能力资料，再逐步确认问题。当前能力已有草稿保存基础，但是否覆盖切页与恢复还需要进一步核对。</p>
          <div class="capability-note">
            <strong>现有能力部分解决</strong>
            已核对当前版本能力快照，本次重点确认草稿恢复时仍然丢失的内容和影响。
          </div>
          <div class="question-panel">
            <span>本轮只确认一个问题</span>
            <strong>${question}</strong>
          </div>
        </div>
      </div>
    `;
  }

  if (["stage", "summary", "ready", "submitted"].includes(state.requirementStage)) {
    extra = `
      <div class="message">
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="message-label">需求分析</div>
          <p>我先汇总这一阶段的理解，确认无误后再继续形成最终摘要。</p>
          <section class="stage-summary">
            <header><strong>阶段理解</strong><span class="status-pill">等待确认</span></header>
            <div class="summary-grid">
              <div class="summary-item"><small>原始诉求</small><p>${original}</p></div>
              <div class="summary-item"><small>真实场景</small><p>${answer}</p></div>
              <div class="summary-item wide"><small>当前瓶颈</small><p>切页后需要重新整理并输入已经确认过的事实，无法从最后一个问题继续。</p></div>
            </div>
            ${state.requirementStage === "stage" ? `<div class="summary-actions"><button class="button sm" data-action="correct-stage">需要修正</button><button class="button primary sm" data-action="confirm-stage">以上理解正确</button></div>` : ""}
          </section>
        </div>
      </div>
    `;
  }

  let final = "";
  if (["summary", "ready", "submitted"].includes(state.requirementStage)) {
    const confirmed = ["ready", "submitted"].includes(state.requirementStage);
    final = `
      <div class="message">
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="message-label">需求摘要与建议解决方向</div>
          <section class="final-summary">
            <header><strong>提交前摘要</strong><span class="status-pill ${confirmed ? "green" : "red"}">${confirmed ? "摘要已确认" : "待确认"}</span></header>
            <div class="summary-grid">
              <div class="summary-item"><small>真实问题</small><p>需求分析草稿无法在切页或重新打开后稳定恢复，已确认事实和当前问题会丢失。</p></div>
              <div class="summary-item"><small>当前影响</small><p>测试中已发生两次，每次都需要重新整理回答；实际耗时仍待记录。</p></div>
              <div class="summary-item"><small>期望结果</small><p>恢复同一份草稿和最后未回答的问题，不重复追问，不丢失事实。</p></div>
              <div class="summary-item"><small>现有能力关系</small><p>现有能力部分解决</p></div>
              <div class="summary-item wide"><small>建议方向与第一期范围</small><p>复用现有草稿能力，补齐跨页面恢复、问题定位和事实版本校验；第一期覆盖单份草稿、切页恢复、重启恢复与确认失效处理。</p></div>
            </div>
            <div class="recommendation-strip"><strong>AI 建议：建议提交。</strong> 当前差距明确，可形成最小闭环；该建议不等于立项或开发授权。</div>
            ${state.requirementStage === "summary" ? `<div class="summary-actions"><button class="button sm" data-action="back-to-stage">返回修改</button><button class="button primary sm" data-action="confirm-summary">确认摘要</button></div>` : ""}
            ${state.requirementStage === "ready" ? `<div class="summary-actions"><span class="draft-state active">摘要已锁定</span><button class="button primary sm" data-action="open-submit-confirm">确认提交</button></div>` : ""}
            ${state.requirementStage === "submitted" ? `<div class="summary-actions"><span class="status-pill green">已提交 · REQ-20260919-018</span><button class="button sm" data-action="open-submissions">查看我的提报</button></div>` : ""}
          </section>
        </div>
      </div>
    `;
  }

  return `
    <div class="conversation">
      <div class="message user">
        <div class="message-body">${original}</div>
        <div class="message-avatar">我</div>
      </div>
      ${state.requirementAnswer ? `<div class="message user"><div class="message-body">${answer}</div><div class="message-avatar">我</div></div>` : ""}
      ${extra}
      ${final}
    </div>
  `;
}

function renderRequirementComposer() {
  const placeholder = state.requirementStage === "empty"
    ? "例如：我希望 AI Studio 可以在切换页面后继续分析同一份需求……"
    : "补充当前场景、处理方式与具体影响……";
  return `
    <div class="composer-shell">
      <div class="composer">
        <textarea id="requirement-input" rows="2" placeholder="${placeholder}"></textarea>
        <button type="button" class="button primary" data-action="send-requirement">发送</button>
      </div>
      <p class="composer-note">一次只提报一条需求；分析结果不等于已立项或授权开发。</p>
    </div>
  `;
}

function getRequirementProgress() {
  return { empty: 0, question: 32, stage: 68, summary: 100, ready: 100, submitted: 100 }[state.requirementStage];
}

function renderUnderstandingRail() {
  const progress = getRequirementProgress();
  const status = state.requirementStage === "submitted" ? "已提交" : state.requirementStage === "ready" ? "待提交" : state.requirementStage === "empty" ? "未开始" : "分析中";
  const relation = state.requirementStage === "empty" ? "等待核对" : "现有能力部分解决";
  const hasFacts = state.requirementStage !== "empty";
  const fullFacts = ["stage", "summary", "ready", "submitted"].includes(state.requirementStage);

  return `
    <aside class="understanding-rail">
      <div class="rail-header">
        <div class="rail-title-row"><h2>需求理解</h2><span class="status-pill ${state.requirementStage === "submitted" ? "green" : ""}">${status}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="progress-labels"><span>分析完整度</span><strong>${progress}%</strong></div>
      </div>
      <div class="rail-content">
        <section class="rail-section">
          <h3>现有能力关系</h3>
          <span class="status-pill ${hasFacts ? "red" : ""}">${relation}</span>
          <p style="margin-top:8px">${hasFacts ? "已核对当前版本能力资料，已有草稿基础能力，仍需确认恢复范围。" : "发送需求后核对当前版本能力资料。"}</p>
        </section>
        <section class="rail-section">
          <h3>已确认事实</h3>
          ${hasFacts ? `
            <div class="fact-list">
              <div class="fact"><small>原始诉求</small><span>${escapeHtml(state.requirementText)}</span></div>
              ${fullFacts ? `<div class="fact"><small>真实场景</small><span>${escapeHtml(state.requirementAnswer || "切换页面后无法继续原来的分析，只能重新输入。")}</span></div><div class="fact"><small>期望结果</small><span>恢复同一草稿和最后未回答的问题，不重复追问。</span></div>` : ""}
            </div>
          ` : `<p>对话中确认的信息会显示在这里。</p>`}
        </section>
        <section class="rail-section">
          <h3>建议方案</h3>
          <p>${progress === 100 ? "已基于当前能力和确认差距生成建议方向，等待摘要与提交确认。" : "需求分析完成后，基于当前能力和真实差距生成建议解决方向。"}</p>
        </section>
      </div>
      <div class="rail-footer"><button type="button" class="button" data-action="open-submissions">查看我的提报</button></div>
    </aside>
  `;
}

function renderSubmissions() {
  const selected = submissions[state.selectedSubmission] || submissions[0];
  app.innerHTML = `
    <section class="view submissions-page">
      <div class="submissions-wrap">
        <header class="submissions-header">
          <div>
            <div class="breadcrumbs">需求提报 / 我的提报</div>
            <h1>我的提报</h1>
            <p>查看本人已正式提交的记录；未提交内容只保留为当前草稿。</p>
          </div>
          <button type="button" class="button primary" data-action="new-requirement">${icon("plus")}提报新需求</button>
        </header>
        <div class="submission-tabs"><button type="button">已提交 <span>${submissions.length}</span></button></div>
        <div class="submissions-grid">
          <div class="submission-list">
            ${submissions.map((item, index) => `
              <button type="button" class="submission-card ${index === state.selectedSubmission ? "active" : ""}" data-action="select-submission" data-index="${index}">
                <strong>${escapeHtml(item.title)}</strong>
                <div class="card-tags">
                  <span class="status-pill ${item.suggestion === "建议提交" ? "green" : "amber"}">${item.suggestion}</span>
                  ${item.insist ? `<span class="status-pill amber">坚持提交</span>` : ""}
                  <span class="status-pill">已提交</span>
                </div>
                <footer><span>${item.submitted}</span><span>${item.relation}</span></footer>
              </button>
            `).join("")}
          </div>
          <article class="submission-detail">
            <div class="detail-head">
              <div><h2>${escapeHtml(selected.title)}</h2><p>需求 ID：${selected.id} · 提交时间：${selected.submitted}</p></div>
              <span class="status-pill green">已提交</span>
            </div>
            <section class="detail-section">
              <h3>需求分析</h3>
              <div class="detail-columns">
                <div class="detail-box"><small>真实问题</small><strong>${escapeHtml(selected.problem)}</strong></div>
                <div class="detail-box"><small>主要影响</small><strong>${escapeHtml(selected.impact)}</strong></div>
              </div>
            </section>
            <section class="detail-section">
              <h3>现有能力对比</h3><span class="status-pill">${selected.relation}</span>
            </section>
            <section class="detail-section">
              <h3>建议解决方向 <span class="status-pill">AI 建议</span></h3>
              <div class="direction-copy">
                <p><strong>首选方案：</strong>${escapeHtml(selected.solution)}</p>
                <p><strong>第一期范围：</strong>${escapeHtml(selected.mvp)}</p>
              </div>
              <div class="readonly-note">该方向不等于正式 PRD、技术方案或开发授权。</div>
            </section>
            <section class="detail-section">
              <h3>AI 判断与确认</h3>
              <div class="detail-columns">
                <div class="detail-box"><small>AI 原建议</small><strong>${selected.suggestion}</strong></div>
                <div class="detail-box"><small>提交方式</small><strong>${selected.insist ? "用户填写理由后坚持提交" : "按 AI 建议提交"}</strong></div>
              </div>
            </section>
          </article>
        </div>
      </div>
    </section>
  `;
}

function renderTasks() {
  const labels = { running: "运行中", paused: "已暂停", missed: "已错过" };
  const filtered = state.taskFilter === "all" ? tasks : tasks.filter((task) => task.status === state.taskFilter);
  app.innerHTML = `
    <section class="view tasks-page">
      <div class="tasks-wrap">
        <header class="page-header">
          <div class="page-title"><h1>定时任务</h1><p>按计划执行重复工作，并集中查看每次运行结果</p></div>
          <button type="button" class="button primary" data-action="open-task-modal">${icon("plus")}新增定时任务</button>
        </header>
        <div class="task-notice">${icon("triangle-alert")}<span>任务仅在客户端在线或后台常驻时执行。关闭期间到期的任务会标记为“已错过”，重新打开后可人工补跑。</span></div>
        <div class="filter-tabs">
          ${[
            ["all", "全部"], ["running", "运行中"], ["paused", "已暂停"], ["missed", "已错过"],
          ].map(([key, label]) => `<button type="button" class="${state.taskFilter === key ? "active" : ""}" data-action="filter-tasks" data-filter="${key}">${label}</button>`).join("")}
          <span>共 ${filtered.length} 个任务</span>
        </div>
        <div class="task-list">
          ${filtered.length ? filtered.map((task) => `
            <article class="task-row">
              <div class="task-icon">${icon(task.icon)}</div>
              <div class="task-copy">
                <div class="task-title-line"><strong>${escapeHtml(task.name)}</strong><span class="status-pill ${task.status === "running" ? "green" : task.status === "missed" ? "amber" : ""}">${labels[task.status]}</span></div>
                <p>${escapeHtml(task.instruction)}</p>
                <small>${escapeHtml(task.cycleLabel)} · 工作区：${escapeHtml(task.workspace)}</small>
              </div>
              <div class="task-schedule"><strong>${escapeHtml(task.next)}</strong><span>${escapeHtml(task.latest)}</span></div>
              <div class="task-actions">
                <button type="button" class="text-button" data-action="task-history" data-id="${task.id}">查看记录</button>
                <button type="button" class="button sm" data-action="run-task" data-id="${task.id}">${task.status === "missed" ? "补跑" : "立即运行"}</button>
                <button type="button" class="text-button" data-action="open-task-modal" data-id="${task.id}">编辑</button>
                <button type="button" class="switch ${task.status === "running" ? "on" : ""}" role="switch" aria-checked="${task.status === "running"}" aria-label="${task.status === "running" ? "暂停" : "启用"}${escapeHtml(task.name)}" data-action="toggle-task" data-id="${task.id}"></button>
              </div>
            </article>
          `).join("") : `<div class="empty-intake" style="min-height:420px"><div class="empty-wrap"><div class="empty-icon">${icon("calendar-x")}</div><h2>当前没有${labels[state.taskFilter] || ""}任务</h2><p>切换筛选条件，或新建一条定时任务。</p></div></div>`}
        </div>
      </div>
    </section>
  `;
}

function selectedModel() {
  return modelGroups.flatMap((group) => group.models).find((model) => model.id === state.selectedModel) || modelGroups[0].models[0];
}

function renderChat() {
  const model = selectedModel();
  app.innerHTML = `
    <section class="view chat-page">
      <header class="chat-topbar"><strong>新对话</strong><span class="env-chip">测试环境</span></header>
      <div class="chat-home">
        <div class="chat-welcome">
          <h1>有什么可以帮你的？</h1>
          <p>选择模型后开始对话，或直接描述需要完成的工作。</p>
          <div class="starter-grid">
            <button type="button" class="starter"><strong>处理本地文档</strong><span>Excel、Word、PPT 与 PDF</span></button>
            <button type="button" class="starter"><strong>使用浏览器完成操作</strong><span>查找信息、填写页面与执行流程</span></button>
            <button type="button" class="starter" data-action="go-tasks"><strong>安排一个定时任务</strong><span>设置执行周期与工作区</span></button>
            <button type="button" class="starter" data-action="go-requirement"><strong>提报产品需求</strong><span>分析问题并形成结构化摘要</span></button>
          </div>
        </div>
      </div>
      <div class="chat-composer-wrap">
        ${state.modelOpen ? renderModelPopover() : ""}
        <div class="chat-composer">
          <textarea rows="2" placeholder="随心输入，或用 / 唤出技能与工具"></textarea>
          <div class="chat-composer-bar">
            <button type="button" class="tool-button" aria-label="引用技能">${icon("plus")}</button>
            <button type="button" class="tool-button" aria-label="上传文件">${icon("paperclip")}</button>
            <button type="button" class="model-trigger" data-action="toggle-models" aria-expanded="${state.modelOpen}"><span>${escapeHtml(model.name)}</span>${icon("chevron-down")}</button>
            <button type="button" class="send-button" aria-label="发送">${icon("arrow-up")}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderModelPopover() {
  return `
    <div class="model-popover" role="dialog" aria-label="选择模型">
      <header>
        <strong>选择模型 <span class="model-total">${modelGroups.flatMap((group) => group.models).filter((model) => model.id !== "auto").length} 个模型 + Auto</span></strong>
        <label class="model-search">${icon("search")}<input id="model-search" type="search" value="${escapeHtml(state.modelQuery)}" placeholder="搜索全部模型" autocomplete="off"></label>
      </header>
      <div class="model-list">
        ${renderModelList()}
      </div>
    </div>
  `;
}

function renderModelList() {
  const query = state.modelQuery.trim().toLowerCase();
  const groups = modelGroups.map((group) => ({
    ...group,
    models: group.models.filter((model) => `${model.name} ${model.id} ${model.desc}`.toLowerCase().includes(query)),
  })).filter((group) => group.models.length);
  return groups.length ? groups.map((group) => `
    <div class="model-group-label">${group.label}</div>
    ${group.models.map((model) => `
      <button type="button" class="model-option ${state.selectedModel === model.id ? "selected" : ""}" data-action="select-model" data-model="${model.id}">
        <span><strong>${escapeHtml(model.name)}</strong><small>${escapeHtml(model.desc)}</small></span>
        ${state.selectedModel === model.id ? icon("check") : ""}
      </button>
    `).join("")}
  `).join("") : `<div class="no-models">没有匹配的模型</div>`;
}

function showTaskModal(taskId) {
  const task = tasks.find((item) => item.id === Number(taskId));
  const isEdit = Boolean(task);
  const cycle = task?.cycle || "daily";
  overlayRoot.innerHTML = `
    <div class="overlay" data-action="close-overlay">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" data-overlay-panel>
        <header class="modal-head">
          <div><h2 id="task-modal-title">${isEdit ? "编辑定时任务" : "新增定时任务"}</h2><p>设置任务内容、执行时间与工作区</p></div>
          <button type="button" class="modal-close" data-action="close-overlay" aria-label="关闭">${icon("x")}</button>
        </header>
        <div class="modal-body">
          <form id="task-form" class="form-grid" data-task-id="${task?.id || ""}">
            <div class="field wide"><label for="task-name">任务名称</label><input id="task-name" maxlength="40" value="${escapeHtml(task?.name || "")}" placeholder="例如：生成上周周报" required></div>
            <div class="field wide"><label for="task-instruction">任务指令</label><textarea id="task-instruction" placeholder="说明每次需要完成的工作和期望结果" required>${escapeHtml(task?.instruction || "")}</textarea></div>
            <div class="field wide">
              <label>执行周期</label>
              <div class="segmented" data-cycle="${cycle}">
                <button type="button" class="${cycle === "once" ? "active" : ""}" data-action="select-cycle" data-cycle="once">单次</button>
                <button type="button" class="${cycle === "daily" ? "active" : ""}" data-action="select-cycle" data-cycle="daily">每天</button>
                <button type="button" class="${cycle === "weekly" ? "active" : ""}" data-action="select-cycle" data-cycle="weekly">每周</button>
              </div>
            </div>
            <div class="field"><label for="task-time">执行时间</label><input id="task-time" type="time" value="${task?.time || "09:00"}" required></div>
            <div class="field"><label for="task-workspace">工作区</label><select id="task-workspace"><option ${task?.workspace === "运营工作" ? "selected" : ""}>运营工作</option><option ${task?.workspace === "设计工作" ? "selected" : ""}>设计工作</option><option ${task?.workspace === "默认工作区" ? "selected" : ""}>默认工作区</option></select></div>
          </form>
        </div>
        <footer class="modal-foot"><button type="button" class="button" data-action="close-overlay">取消</button><button type="button" class="button primary" data-action="save-task">确认保存</button></footer>
      </section>
    </div>
  `;
  refreshIcons();
  requestAnimationFrame(() => document.getElementById("task-name")?.focus());
}

function showSubmitConfirm() {
  overlayRoot.innerHTML = `
    <div class="overlay" data-action="close-overlay">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="submit-modal-title" data-overlay-panel>
        <header class="modal-head"><div><h2 id="submit-modal-title">确认提交需求</h2><p>提交后将生成正式需求编号，正文不可修改</p></div><button type="button" class="modal-close" data-action="close-overlay" aria-label="关闭">${icon("x")}</button></header>
        <div class="modal-body confirm-copy">
          <p>你已单独确认需求摘要。请再次确认是否将<strong>“需求分析草稿支持跨页面恢复”</strong>正式提交。</p>
          <div class="confirm-id">AI 原建议：建议提交 · 当前提交方式：按 AI 建议提交</div>
        </div>
        <footer class="modal-foot"><button type="button" class="button" data-action="close-overlay">返回检查</button><button type="button" class="button primary" data-action="submit-requirement">确认提交</button></footer>
      </section>
    </div>
  `;
  refreshIcons();
}

function showHistory(taskId) {
  const task = tasks.find((item) => item.id === Number(taskId));
  overlayRoot.innerHTML = `
    <div class="drawer-overlay" data-action="close-overlay">
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="history-title" data-overlay-panel>
        <header class="modal-head"><div><h2 id="history-title">运行记录</h2><p>${escapeHtml(task.name)}</p></div><button type="button" class="modal-close" data-action="close-overlay" aria-label="关闭">${icon("x")}</button></header>
        <div class="drawer-body">
          <div class="history-summary"><div><small>总运行</small><strong>12</strong></div><div><small>成功</small><strong>11</strong></div><div><small>失败</small><strong>1</strong></div></div>
          <div class="history-list">
            <div class="history-item"><span class="history-dot"></span><div><strong>执行成功</strong><span>结果已保存到“${escapeHtml(task.workspace)}”</span></div><time>09-14 09:02</time></div>
            <div class="history-item"><span class="history-dot"></span><div><strong>执行成功</strong><span>共处理 18 条工作记录</span></div><time>09-07 09:01</time></div>
            <div class="history-item"><span class="history-dot failed"></span><div><strong>执行失败</strong><span>客户端执行期间离线，可点击立即运行补跑</span></div><time>08-31 09:00</time></div>
            <div class="history-item"><span class="history-dot"></span><div><strong>执行成功</strong><span>任务正常完成</span></div><time>08-24 09:03</time></div>
          </div>
        </div>
      </aside>
    </div>
  `;
  refreshIcons();
}

function showToast(title, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `${icon("circle-check-big")}<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  toastRoot.appendChild(toast);
  refreshIcons();
  window.setTimeout(() => toast.remove(), 3200);
}

function scrollRequirementToBottom() {
  requestAnimationFrame(() => {
    const stage = document.getElementById("intake-stage");
    if (stage) stage.scrollTo({ top: stage.scrollHeight, behavior: "smooth" });
  });
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    state.view = nav.dataset.view;
    state.modelOpen = false;
    if (state.view === "requirement") state.requirementMode = "intake";
    render();
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "requirement-suggestion") {
    const input = document.getElementById("requirement-input");
    if (input) {
      input.value = "我希望 AI Studio 能在需求提交前保存独立草稿，切换页面后继续上次分析。";
      input.focus();
    }
  }

  if (action === "send-requirement") {
    const input = document.getElementById("requirement-input");
    const value = input?.value.trim();
    if (!value) {
      showToast("还缺少内容", "请先描述需求或回答当前问题");
      return;
    }
    if (state.requirementStage === "empty") {
      state.requirementText = value;
      state.requirementStage = "question";
    } else {
      state.requirementAnswer = value;
      state.requirementStage = "stage";
    }
    render();
    showToast("草稿已保存", "已记录本轮内容并更新需求理解");
    scrollRequirementToBottom();
  }

  if (action === "confirm-stage") {
    if (!state.requirementAnswer) state.requirementAnswer = "昨天分析到一半去技能库查资料，回来后之前确认的事实和当前问题丢了，只能重新输入。";
    state.requirementStage = "summary";
    render();
    scrollRequirementToBottom();
  }

  if (action === "correct-stage") {
    state.requirementStage = "question";
    render();
    requestAnimationFrame(() => document.getElementById("requirement-input")?.focus());
  }

  if (action === "back-to-stage") {
    state.requirementStage = "stage";
    render();
    scrollRequirementToBottom();
  }

  if (action === "confirm-summary") {
    state.requirementStage = "ready";
    render();
    showToast("摘要已确认", "仍需单独确认提交，当前尚未生成需求编号");
    scrollRequirementToBottom();
  }

  if (action === "open-submit-confirm") showSubmitConfirm();

  if (action === "submit-requirement") {
    overlayRoot.innerHTML = "";
    state.requirementStage = "submitted";
    if (!submissions.some((item) => item.id === "REQ-20260919-018")) {
      submissions.unshift({
        id: "REQ-20260919-018",
        title: "需求分析草稿支持跨页面恢复",
        suggestion: "建议提交",
        submitted: "2026-09-19 15:28",
        relation: "现有能力部分解决",
        problem: "需求分析草稿无法在切页或重新打开后稳定恢复。",
        impact: "已确认事实和当前问题会丢失，需要重复整理输入。",
        solution: "复用现有草稿能力，补齐跨页面恢复、问题定位和事实版本校验。",
        mvp: "单份草稿、切页恢复、重启恢复与确认失效处理",
        insist: false,
      });
    }
    render();
    showToast("需求已提交", "已生成需求编号 REQ-20260919-018");
    scrollRequirementToBottom();
  }

  if (action === "discard-requirement" || action === "new-requirement") {
    state.requirementMode = "intake";
    state.requirementStage = "empty";
    state.requirementText = "";
    state.requirementAnswer = "";
    render();
  }

  if (action === "open-submissions") {
    state.requirementMode = "submissions";
    state.selectedSubmission = 0;
    render();
  }

  if (action === "select-submission") {
    state.selectedSubmission = Number(target.dataset.index);
    render();
  }

  if (action === "filter-tasks") {
    state.taskFilter = target.dataset.filter;
    render();
  }

  if (action === "open-task-modal") showTaskModal(target.dataset.id);

  if (action === "select-cycle") {
    const segmented = target.closest(".segmented");
    segmented.dataset.cycle = target.dataset.cycle;
    segmented.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === target));
  }

  if (action === "save-task") {
    const form = document.getElementById("task-form");
    if (!form.reportValidity()) return;
    const existing = tasks.find((item) => item.id === Number(form.dataset.taskId));
    const cycle = form.querySelector(".segmented").dataset.cycle;
    const name = document.getElementById("task-name").value.trim();
    const instruction = document.getElementById("task-instruction").value.trim();
    const time = document.getElementById("task-time").value;
    const workspace = document.getElementById("task-workspace").value;
    const cycleLabel = cycle === "once" ? `单次 · 今天 ${time}` : cycle === "weekly" ? `每周一 · ${time}` : `每天 · ${time}`;
    if (existing) {
      Object.assign(existing, { name, instruction, time, workspace, cycle, cycleLabel, next: cycle === "once" ? `计划时间：今天 ${time}` : `下次运行：${cycle === "weekly" ? "周一 " : "今天 "}${time}` });
    } else {
      tasks.unshift({ id: Date.now(), icon: "calendar-clock", name, instruction, cycle, cycleLabel, time, workspace, status: "running", next: cycle === "once" ? `计划时间：今天 ${time}` : `下次运行：${cycle === "weekly" ? "周一 " : "今天 "}${time}`, latest: "尚未运行" });
    }
    overlayRoot.innerHTML = "";
    state.taskFilter = "all";
    render();
    showToast(existing ? "任务已更新" : "任务已创建", `${name}已启用`);
  }

  if (action === "toggle-task") {
    const task = tasks.find((item) => item.id === Number(target.dataset.id));
    task.status = task.status === "running" ? "paused" : "running";
    task.next = task.status === "paused" ? "已暂停，不会自动运行" : `下次运行：${task.cycle === "weekly" ? "周一 " : "今天 "}${task.time}`;
    render();
    showToast(task.status === "running" ? "任务已启用" : "任务已暂停", task.name);
  }

  if (action === "run-task") {
    const task = tasks.find((item) => item.id === Number(target.dataset.id));
    target.disabled = true;
    target.textContent = "运行中…";
    window.setTimeout(() => {
      task.status = "running";
      task.latest = "最近成功：刚刚";
      render();
      showToast("任务运行完成", `${task.name}已生成本次结果`);
    }, 700);
  }

  if (action === "task-history") showHistory(target.dataset.id);

  if (action === "toggle-models") {
    state.modelOpen = !state.modelOpen;
    render();
    if (state.modelOpen) requestAnimationFrame(() => document.getElementById("model-search")?.focus());
  }

  if (action === "select-model") {
    state.selectedModel = target.dataset.model;
    state.modelOpen = false;
    state.modelQuery = "";
    render();
    showToast("模型已切换", selectedModel().name);
  }

  if (action === "go-tasks") {
    state.view = "tasks";
    render();
  }

  if (action === "go-requirement") {
    state.view = "requirement";
    state.requirementMode = "intake";
    render();
  }

  if (action === "close-overlay" && (!target.hasAttribute("data-overlay-panel") || event.target === target)) {
    overlayRoot.innerHTML = "";
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "model-search") return;
  state.modelQuery = event.target.value;
  const list = document.querySelector(".model-list");
  if (list) list.innerHTML = renderModelList();
  refreshIcons();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (overlayRoot.innerHTML) overlayRoot.innerHTML = "";
    if (state.modelOpen) {
      state.modelOpen = false;
      render();
    }
  }
  if (event.key === "Enter" && event.target.id === "requirement-input" && !event.shiftKey) {
    event.preventDefault();
    document.querySelector('[data-action="send-requirement"]')?.click();
  }
});

render();
