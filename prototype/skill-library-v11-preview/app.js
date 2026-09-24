const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const toastRoot = document.querySelector("#toast-root");

const categories = ["全部", "办公协同", "效率工具", "内容创作", "数据分析", "商业运营", "开发工具", "信息资讯", "教育学习", "网站部署", "生活服务", "知识管理"];

let skills = [
  { id: "weekly-report", name: "日报 / 周报生成", letter: "周", category: "办公协同", source: "enterprise", description: "整理指定时间范围内的工作内容，并按公司模板生成结构化周报。", tags: ["文档", "总结"], version: "1.2.0" },
  { id: "product-image", name: "商品图批量处理", letter: "图", category: "效率工具", source: "enterprise", description: "批量调整商品图尺寸、格式和背景，输出到指定工作目录。", tags: ["图片", "批处理"], version: "1.3.1" },
  { id: "commerce-copy", name: "电商文案润色", letter: "文", category: "内容创作", source: "enterprise", description: "按平台和活动语气改写商品卖点、活动标题与短文案。", tags: ["文案", "电商"], version: "1.1.0" },
  { id: "meeting-notes", name: "会议记录整理", letter: "会", category: "办公协同", source: "personal", description: "把会议记录整理为结论、待办、责任人与待确认事项。", tags: ["会议", "总结"], version: "1.0.0", status: null },
  { id: "sku-clean", name: "SKU 信息清洗", letter: "数", category: "数据分析", source: "personal", description: "检查并整理 SKU 表格中的空值、重复值和异常格式。", tags: ["表格", "清洗"], version: "1.0.0", status: "withdrawn", updatedAt: "今天 10:26" },
  { id: "review-insight", name: "评论卖点提炼", letter: "评", category: "商业运营", source: "personal", description: "从评论文本中提炼高频诉求、产品卖点和改进方向。", tags: ["评论", "洞察"], version: "1.0.0", status: "rejected", rejectionReason: "请补充输入文件格式和异常处理规则后重新提交。", updatedAt: "昨天 17:40" },
  { id: "web-research", name: "网页资料整理", letter: "网", category: "信息资讯", source: "personal", description: "读取公开网页内容，提取关键信息并按主题整理摘要。", tags: ["网页", "研究"], version: "1.1.0", status: "reviewing", updatedAt: "8 月 29 日" },
  { id: "meeting-model", name: "东哥会议模型", letter: "东", category: "办公协同", source: "builtin", description: "将会议录音或文本整理为准确纪要、决策结论和可执行待办。", tags: ["会议", "音频"], version: "1.0.0" },
  { id: "document-layout", name: "文档智能排版", letter: "排", category: "效率工具", source: "personal", description: "将杂乱内容整理为层级清晰、格式统一的正式文档。", tags: ["文档", "排版"], version: "1.0.2", status: "published", updatedAt: "8 月 26 日" }
];

const marketSkills = [
  { id: "market-contract", name: "合同要点检查", letter: "合", category: "办公协同", description: "识别合同中的关键条款、时间节点和待确认风险。", tags: ["合同", "检查"], version: "1.2.0", compatible: true },
  { id: "market-sheet", name: "表格公式助手", letter: "表", category: "数据分析", description: "根据业务目标生成、解释并检查常用表格公式。", tags: ["表格", "公式"], version: "1.0.3", compatible: true },
  { id: "market-poster", name: "活动海报文案", letter: "宣", category: "内容创作", description: "根据活动信息生成适用于海报的标题和简短卖点。", tags: ["活动", "文案"], version: "1.1.0", compatible: true },
  { id: "market-legacy", name: "旧版数据转换", letter: "转", category: "开发工具", description: "依赖较旧的运行环境，当前客户端暂不支持安装。", tags: ["转换"], version: "0.8.0", compatible: false }
];

const state = {
  view: "library",
  activeTab: "all",
  category: "全部",
  query: "",
  detailId: null,
  marketQuery: "",
  editing: null,
  import: { step: 1, source: "local", selected: false, name: "会议行动项整理", category: "办公协同", tags: "会议, 待办", summary: "将会议内容整理为结论、负责人明确的行动项和待确认事项。", instruction: "读取用户提供的会议记录。\n提取会议结论、行动项、负责人和截止时间。\n信息不完整时列入待确认事项，不自行补充事实。" }
};

function sourceLabel(source) {
  return ({ enterprise: "企业技能", personal: "我的技能", builtin: "内置技能", market: "在线导入" })[source] || "技能";
}

function statusLabel(status) {
  return ({ reviewing: "审批中", withdrawn: "已撤回", rejected: "已驳回", published: "已发布" })[status] || "未提交";
}

function statusClass(status) {
  return status || "draft";
}

function counts() {
  return {
    all: skills.length,
    personal: skills.filter((item) => item.source === "personal" || item.source === "market").length,
    enterprise: skills.filter((item) => item.source === "enterprise").length
  };
}

function filteredSkills() {
  const query = state.query.trim().toLowerCase();
  return skills.filter((skill) => {
    const tabMatch = state.activeTab === "all"
      || (state.activeTab === "personal" && ["personal", "market"].includes(skill.source))
      || (state.activeTab === "enterprise" && skill.source === "enterprise");
    const categoryMatch = state.category === "全部" || skill.category === state.category;
    const haystack = `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase();
    return tabMatch && categoryMatch && (!query || haystack.includes(query));
  });
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function render() {
  if (state.view === "import") renderImport();
  else if (state.view === "detail") renderDetail();
  else renderLibrary();
  refreshIcons();
}

function renderLibrary() {
  const count = counts();
  const list = filteredSkills();
  app.innerHTML = `
    <section class="page">
      <header class="page-header">
        <div>
          <h1>技能库</h1>
          <p>调用现成技能，或导入自己的工作方法。</p>
        </div>
        <div class="header-actions">
          <button class="button" type="button" data-action="open-market"><i data-lucide="globe-2"></i>在线技能库</button>
          <button class="button primary" type="button" data-action="open-import"><i data-lucide="plus"></i>导入技能</button>
        </div>
      </header>

      <div class="tabs" role="tablist">
        <button class="${state.activeTab === "all" ? "active" : ""}" type="button" data-tab="all">全部技能 <span>${count.all}</span></button>
        <button class="${state.activeTab === "personal" ? "active" : ""}" type="button" data-tab="personal">我的技能 <span>${count.personal}</span></button>
        <button class="${state.activeTab === "enterprise" ? "active" : ""}" type="button" data-tab="enterprise">企业技能 <span>${count.enterprise}</span></button>
      </div>

      <div class="toolbar">
        <label class="search-field">
          <i data-lucide="search"></i>
          <input id="skill-search" value="${escapeHtml(state.query)}" placeholder="搜索技能名称、说明或标签" autocomplete="off">
        </label>
        <div class="category-nav">
          <button class="scroll-arrow" type="button" data-category-scroll="left" aria-label="查看左侧分类"><i data-lucide="chevron-left"></i></button>
          <div id="category-strip" class="category-scroll">
            ${categories.map((category) => `<button type="button" class="${state.category === category ? "active" : ""}" data-category="${category}">${category}</button>`).join("")}
          </div>
          <button class="scroll-arrow" type="button" data-category-scroll="right" aria-label="查看更多分类"><i data-lucide="chevron-right"></i></button>
        </div>
      </div>

      <div class="skill-grid">
        ${list.length ? list.map(renderSkillCard).join("") : `<div class="empty-state"><i data-lucide="search-x"></i><div>没有找到符合条件的技能</div></div>`}
      </div>
    </section>
  `;
}

function renderSkillCard(skill) {
  const personal = ["personal", "market"].includes(skill.source);
  const badge = personal
    ? `<span class="status-badge ${statusClass(skill.status)}">${statusLabel(skill.status)}</span>`
    : `<span class="source-badge">${sourceLabel(skill.source)}</span>`;
  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div class="skill-icon">${escapeHtml(skill.letter)}</div>
        <div class="skill-title"><h3 title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</h3><p>${escapeHtml(skill.category)}</p></div>
        ${badge}
      </div>
      <p class="skill-description">${escapeHtml(skill.description)}</p>
      <div class="tags">${skill.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <footer class="skill-card-footer">
        <small>版本 ${escapeHtml(skill.version)}</small>
        <div class="card-actions">
          ${personal ? `<button class="button" type="button" data-manage-skill="${skill.id}">管理</button>` : ""}
          <button class="button primary" type="button" data-use-skill="${skill.id}">使用</button>
        </div>
      </footer>
    </article>
  `;
}

function renderDetail() {
  const skill = skills.find((item) => item.id === state.detailId);
  if (!skill) {
    state.view = "library";
    renderLibrary();
    return;
  }

  const canEdit = !skill.status || ["withdrawn", "rejected"].includes(skill.status);
  const canSubmit = !skill.status || ["withdrawn", "rejected"].includes(skill.status);
  const canWithdraw = skill.status === "reviewing";
  const status = statusLabel(skill.status);
  const events = buildTimeline(skill);

  app.innerHTML = `
    <section class="page">
      <button class="back-button" type="button" data-action="back-library"><i data-lucide="arrow-left"></i>返回技能库</button>
      <div class="detail-hero">
        <div class="skill-icon">${escapeHtml(skill.letter)}</div>
        <div class="detail-title">
          <h1>${escapeHtml(skill.name)}</h1>
          <p>${escapeHtml(skill.description)}</p>
          <div class="detail-meta"><span>${escapeHtml(skill.category)}</span><span>版本 ${escapeHtml(skill.version)}</span><span class="status-badge ${statusClass(skill.status)}">${status}</span></div>
        </div>
        <div class="detail-actions">
          <button class="button" type="button" data-use-skill="${skill.id}"><i data-lucide="play"></i>使用</button>
          ${canEdit ? `<button class="button" type="button" data-edit-skill="${skill.id}"><i data-lucide="pencil"></i>编辑</button>` : ""}
          ${canEdit ? `<button class="button danger" type="button" data-delete-skill="${skill.id}"><i data-lucide="trash-2"></i>删除个人技能</button>` : ""}
          ${canSubmit ? `<button class="button primary" type="button" data-submit-skill="${skill.id}"><i data-lucide="send"></i>${skill.status ? "重新提交" : "提交审批"}</button>` : ""}
          ${canWithdraw ? `<button class="button danger" type="button" data-withdraw-skill="${skill.id}"><i data-lucide="undo-2"></i>撤回申请</button>` : ""}
        </div>
      </div>

      ${skill.status === "rejected" ? `<div class="rejection-note"><strong>驳回原因：</strong>${escapeHtml(skill.rejectionReason || "请修改技能内容后重新提交。")}</div>` : ""}

      <div class="detail-layout">
        <div class="detail-main">
          <section class="panel">
            <h2>技能说明</h2>
            <div class="instruction">${escapeHtml(skill.instruction || defaultInstruction(skill))}</div>
          </section>
          <section class="panel">
            <h2>基本信息</h2>
            <div class="info-grid">
              <div><span>技能分类</span><strong>${escapeHtml(skill.category)}</strong></div>
              <div><span>当前版本</span><strong>${escapeHtml(skill.version)}</strong></div>
              <div><span>技能标签</span><strong>${escapeHtml(skill.tags.join("、"))}</strong></div>
              <div><span>审批状态</span><strong>${status}</strong></div>
            </div>
          </section>
          <section class="panel">
            <h2>状态记录</h2>
            <div class="timeline">${events.map((event) => `<div class="timeline-item"><span class="timeline-dot"></span><div><strong>${event.title}</strong><small>${event.note} · ${event.time}</small></div></div>`).join("")}</div>
          </section>
        </div>
        <aside class="panel side-panel">
          <h3>个人技能</h3>
          <p>技能保存在当前钉钉账号下，可在对话中直接调用。</p>
          <h3>企业审批</h3>
          <p>${skill.status === "reviewing" ? "当前版本正在审核，撤回后可继续编辑。" : "编辑完成后可提交企业审批，审核中的版本不能修改。"}</p>
          <h3>版本说明</h3>
          <p>撤回或驳回后修改当前内容即可重新提交，无需仅为重新提交而提高版本号。</p>
        </aside>
      </div>
    </section>
  `;
}

function defaultInstruction(skill) {
  return `1. 读取用户提供的${skill.category === "数据分析" ? "数据文件" : "内容"}。\n2. 按照技能目标完成整理和检查。\n3. 输出结构清晰的结果。\n4. 信息不足时明确列出待确认项，不自行补充事实。`;
}

function buildTimeline(skill) {
  const base = [{ title: "导入个人技能", note: "已完成内容校验并加入我的技能", time: "8 月 25 日 09:30" }];
  if (skill.status === "reviewing") base.unshift({ title: "提交审批", note: "已提交管理员审核", time: skill.updatedAt || "今天 11:20" });
  if (skill.status === "withdrawn") {
    base.unshift({ title: "撤回申请", note: "已撤回，可编辑后重新提交", time: skill.updatedAt || "今天 10:26" });
    base.splice(1, 0, { title: "提交审批", note: "已提交管理员审核", time: "昨天 16:08" });
  }
  if (skill.status === "rejected") {
    base.unshift({ title: "审批驳回", note: skill.rejectionReason || "请修改后重新提交", time: skill.updatedAt || "昨天 17:40" });
    base.splice(1, 0, { title: "提交审批", note: "已提交管理员审核", time: "8 月 28 日 14:15" });
  }
  if (skill.status === "published") {
    base.unshift({ title: "企业技能发布", note: "企业副本已进入公司技能库", time: skill.updatedAt || "8 月 26 日" });
    base.splice(1, 0, { title: "审批通过", note: "管理员已通过当前版本", time: "8 月 26 日 15:12" });
  }
  return base;
}

function renderImport() {
  const data = state.import;
  app.innerHTML = `
    <section class="page import-page">
      <button class="back-button" type="button" data-action="back-library"><i data-lucide="arrow-left"></i>返回技能库</button>
      <header class="page-header">
        <div><h1>导入技能</h1><p>导入并校验完成后，该技能会立即进入“我的技能”。</p></div>
      </header>
      <div class="steps">
        ${["选择来源", "校验内容", "完成导入"].map((label, index) => {
          const number = index + 1;
          return `<div class="step ${data.step === number ? "active" : ""} ${data.step > number ? "done" : ""}"><span>${data.step > number ? "✓" : number}</span>${label}</div>`;
        }).join("")}
      </div>
      ${data.step === 1 ? renderImportSource() : data.step === 2 ? renderImportValidation() : renderImportSuccess()}
    </section>
  `;
}

function renderImportSource() {
  const data = state.import;
  const sourceCopy = {
    local: { icon: "folder-open", title: "本地技能文件夹", copy: "选择包含 SKILL.md 的完整技能目录。" },
    github: { icon: "github", title: "GitHub 地址", copy: "填写公开仓库或仓库内技能目录地址。" },
    zip: { icon: "file-archive", title: "ZIP 压缩包", copy: "选择包含 SKILL.md 的 ZIP 技能包。" }
  };
  return `
    <div class="source-grid">
      ${Object.entries(sourceCopy).map(([key, item]) => `<button type="button" class="source-card ${data.source === key ? "selected" : ""}" data-import-source="${key}"><i data-lucide="${item.icon}"></i><strong>${item.title}</strong><small>${item.copy}</small></button>`).join("")}
    </div>
    <div class="source-input">
      ${data.source === "github"
        ? `<div class="field"><label for="github-url">公开 GitHub 仓库地址</label><input id="github-url" value="https://github.com/example/meeting-action-skill"><span class="helper">支持仓库主页地址或仓库内具体技能目录地址。</span></div>`
        : `<div class="field"><label>${data.source === "zip" ? "技能压缩包" : "技能文件夹"}</label><div><button class="button" type="button" data-action="select-import-content"><i data-lucide="${data.source === "zip" ? "file-archive" : "folder-open"}"></i>${data.selected ? "重新选择" : "选择技能内容"}</button></div><span class="helper">${data.selected ? "已选择：会议行动项整理技能" : "尚未选择技能内容"}</span></div>`}
    </div>
    <div class="import-actions">
      <button class="button" type="button" data-action="back-library">取消</button>
      <button class="button primary" type="button" data-action="validate-import" ${(data.source !== "github" && !data.selected) ? "disabled" : ""}><i data-lucide="shield-check"></i>校验技能</button>
    </div>
  `;
}

function renderImportValidation() {
  const data = state.import;
  return `
    <div class="validation-card">
      <span class="validation-icon"><i data-lucide="check"></i></span>
      <div>
        <h3>技能内容校验通过</h3>
        <p>已识别技能说明和相关资源，未发现危险路径、损坏文件或明文密钥。</p>
        <div class="validation-summary"><span>已识别 SKILL.md</span><span>共 6 个文件</span><span>安全检查通过</span></div>
      </div>
      <small>版本 1.0.0</small>
    </div>
    <div class="edit-grid">
      <div class="field"><label for="import-name">技能名称</label><input id="import-name" value="${escapeHtml(data.name)}"></div>
      <div class="field"><label for="import-category">分类</label><select id="import-category">${categories.slice(1).map((category) => `<option ${data.category === category ? "selected" : ""}>${category}</option>`).join("")}</select><span class="helper">分类由管理后台统一维护，仅支持单选。</span></div>
      <div class="field wide"><label for="import-tags">标签</label><input id="import-tags" value="${escapeHtml(data.tags)}"><span class="helper">多个标签使用逗号分隔，也可以输入新标签。</span></div>
      <div class="field wide"><label for="import-summary">技能简介</label><textarea id="import-summary">${escapeHtml(data.summary)}</textarea></div>
    </div>
    <div class="import-actions">
      <button class="button" type="button" data-action="import-previous">上一步</button>
      <button class="button primary" type="button" data-action="complete-import"><i data-lucide="download"></i>导入我的技能</button>
    </div>
  `;
}

function renderImportSuccess() {
  return `
    <div class="success-view">
      <div>
        <span class="success-icon"><i data-lucide="check"></i></span>
        <h2>技能导入成功</h2>
        <p>“${escapeHtml(state.import.name)}”已加入我的技能，可立即使用、编辑或提交企业审批。</p>
        <div class="success-actions">
          <button class="button" type="button" data-action="view-imported-skill">查看技能</button>
          <button class="button primary" type="button" data-use-skill="imported-skill"><i data-lucide="play"></i>立即使用</button>
        </div>
      </div>
    </div>
  `;
}

function openMarket() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal large" role="dialog" aria-modal="true" aria-label="在线技能库">
        <header class="modal-header"><h2>在线技能库</h2><button class="icon-button" type="button" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button></header>
        <div class="modal-body">
          <label class="search-field market-search"><i data-lucide="search"></i><input id="market-search" value="${escapeHtml(state.marketQuery)}" placeholder="搜索技能名称、说明或标签" autocomplete="off"></label>
          <div id="market-results">${renderMarketResults()}</div>
        </div>
      </section>
    </div>
  `;
  refreshIcons();
  document.querySelector("#market-search")?.focus();
}

function renderMarketResults() {
  const query = state.marketQuery.trim().toLowerCase();
  const list = marketSkills.filter((skill) => `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase().includes(query));
  const compatible = list.filter((skill) => skill.compatible).length;
  const incompatible = list.length - compatible;
  return `
    <div class="market-summary"><span>找到 ${list.length} 个技能</span><span>${compatible} 个可安装${incompatible ? `，${incompatible} 个暂不兼容` : ""}</span></div>
    <div class="market-list">
      ${list.length ? list.map((skill) => {
        const installed = skills.some((item) => item.marketId === skill.id);
        return `<article class="market-item ${skill.compatible ? "" : "incompatible"}"><div class="skill-icon">${skill.letter}</div><div><h3>${skill.name} · ${skill.version}</h3><p>${skill.description}</p></div><button class="button ${installed ? "" : "primary"}" type="button" data-install-market="${skill.id}" ${!skill.compatible || installed ? "disabled" : ""}>${installed ? "已安装" : skill.compatible ? "安装" : "暂不兼容"}</button></article>`;
      }).join("") : `<div class="empty-state"><i data-lucide="search-x"></i><div>没有找到相关技能</div></div>`}
    </div>
  `;
}

function openEdit(skillId) {
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return;
  state.editing = { skillId, tags: [...skill.tags] };
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal" role="dialog" aria-modal="true" aria-label="编辑技能">
        <header class="modal-header"><h2>编辑技能</h2><button class="icon-button" type="button" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button></header>
        <div class="modal-body">
          <div class="form-stack">
            <div class="field"><label for="edit-name">技能名称</label><input id="edit-name" value="${escapeHtml(skill.name)}"></div>
            <div class="field"><label for="edit-summary">技能简介</label><textarea id="edit-summary">${escapeHtml(skill.description)}</textarea></div>
            <div class="form-row">
              <div class="field"><label for="edit-category">分类</label><select id="edit-category">${categories.slice(1).map((category) => `<option ${skill.category === category ? "selected" : ""}>${category}</option>`).join("")}</select><span class="helper">分类由管理后台统一维护，仅支持单选。</span></div>
              <div class="field"><label>标签</label><div id="edit-tag-editor" class="tag-editor">${renderEditTags()}</div><span class="helper">输入标签后按回车或点击添加，点击标签右侧的 × 可删除。</span></div>
            </div>
            <div class="field"><label for="edit-instruction">技能说明</label><textarea id="edit-instruction">${escapeHtml(skill.instruction || defaultInstruction(skill))}</textarea></div>
          </div>
        </div>
        <footer class="modal-footer"><button class="button" type="button" data-close-modal>取消</button><button class="button primary" type="button" data-save-skill="${skill.id}">保存修改</button></footer>
      </section>
    </div>
  `;
  refreshIcons();
}

function renderEditTags() {
  const tags = state.editing?.tags || [];
  return `${tags.map((tag, index) => `<span>${escapeHtml(tag)}<button type="button" data-remove-edit-tag="${index}" aria-label="删除标签 ${escapeHtml(tag)}"><i data-lucide="x"></i></button></span>`).join("")}<input id="edit-tags" placeholder="输入新标签" autocomplete="off"><button class="tag-add-button" type="button" data-add-edit-tag aria-label="添加标签"><i data-lucide="plus"></i></button>`;
}

function refreshEditTags() {
  const editor = document.querySelector("#edit-tag-editor");
  if (!editor) return;
  editor.innerHTML = renderEditTags();
  refreshIcons();
  editor.querySelector("#edit-tags")?.focus();
}

function addEditingTag() {
  const input = document.querySelector("#edit-tags");
  const value = input?.value.trim();
  if (!value || !state.editing) return;
  const additions = value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  additions.forEach((tag) => {
    if (!state.editing.tags.includes(tag)) state.editing.tags.push(tag);
  });
  refreshEditTags();
}

function openConfirm({ title, copy, confirmText, action, danger = false }) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal small" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="modal-header"><h2>${escapeHtml(title)}</h2><button class="icon-button" type="button" data-close-modal aria-label="关闭"><i data-lucide="x"></i></button></header>
        <div class="modal-body"><p class="modal-copy">${escapeHtml(copy)}</p></div>
        <footer class="modal-footer"><button class="button" type="button" data-close-modal>取消</button><button class="button ${danger ? "danger" : "primary"}" type="button" data-confirm-action="${action}">${escapeHtml(confirmText)}</button></footer>
      </section>
    </div>
  `;
  refreshIcons();
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function showToast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.innerHTML = `<i data-lucide="${type === "error" ? "circle-alert" : "circle-check"}"></i><span>${escapeHtml(message)}</span>`;
  toastRoot.appendChild(item);
  refreshIcons();
  window.setTimeout(() => item.remove(), 3200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]);
}

app.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === "open-market") openMarket();
    if (action === "open-import") {
      state.view = "import";
      state.import = { ...state.import, step: 1, selected: false };
      render();
    }
    if (action === "back-library") { state.view = "library"; render(); }
    if (action === "select-import-content") { state.import.selected = true; render(); showToast("已读取技能内容，下一步将进行完整校验"); }
    if (action === "validate-import") { state.import.step = 2; render(); }
    if (action === "import-previous") { state.import.step = 1; render(); }
    if (action === "complete-import") completeImport();
    if (action === "view-imported-skill") { state.view = "detail"; state.detailId = "imported-skill"; render(); }
    return;
  }

  const tab = event.target.closest("[data-tab]");
  if (tab) { state.activeTab = tab.dataset.tab; state.category = "全部"; render(); return; }

  const category = event.target.closest("[data-category]");
  if (category) { state.category = category.dataset.category; render(); return; }

  const scroll = event.target.closest("[data-category-scroll]");
  if (scroll) {
    document.querySelector("#category-strip")?.scrollBy({ left: scroll.dataset.categoryScroll === "right" ? 260 : -260, behavior: "smooth" });
    return;
  }

  const source = event.target.closest("[data-import-source]");
  if (source) { state.import.source = source.dataset.importSource; state.import.selected = false; render(); return; }

  const manage = event.target.closest("[data-manage-skill]");
  if (manage) { state.view = "detail"; state.detailId = manage.dataset.manageSkill; render(); return; }

  const use = event.target.closest("[data-use-skill]");
  if (use) { showToast("已选择该技能，正在为你打开新对话"); return; }

  const edit = event.target.closest("[data-edit-skill]");
  if (edit) { openEdit(edit.dataset.editSkill); return; }

  const submit = event.target.closest("[data-submit-skill]");
  if (submit) {
    const skill = skills.find((item) => item.id === submit.dataset.submitSkill);
    openConfirm({ title: skill.status ? "重新提交审批" : "提交企业审批", copy: skill.status ? "将当前修改后的内容重新提交审批。撤回或驳回记录会保留，当前版本可以正常重新提交。" : "提交身份来自当前钉钉账号，审核中的版本不能修改。", confirmText: skill.status ? "确认重新提交" : "确认提交", action: `submit:${skill.id}` });
    return;
  }

  const withdraw = event.target.closest("[data-withdraw-skill]");
  if (withdraw) {
    openConfirm({ title: "撤回审批申请", copy: "撤回后该版本将停止审批，你可以继续编辑并重新提交。", confirmText: "确认撤回", action: `withdraw:${withdraw.dataset.withdrawSkill}`, danger: true });
    return;
  }

  const remove = event.target.closest("[data-delete-skill]");
  if (remove) {
    openConfirm({ title: "删除个人技能", copy: "删除后该技能将从当前账号的技能库中移除，此操作无法撤销。", confirmText: "确认删除", action: `delete:${remove.dataset.deleteSkill}`, danger: true });
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "skill-search") {
    state.query = event.target.value;
    const cursor = event.target.selectionStart;
    renderLibrary();
    const input = document.querySelector("#skill-search");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
    refreshIcons();
  }
});

modalRoot.addEventListener("click", (event) => {
  if (event.target.matches("[data-modal-backdrop]") || event.target.closest("[data-close-modal]")) { closeModal(); return; }

  const install = event.target.closest("[data-install-market]");
  if (install) { installMarketSkill(install.dataset.installMarket); return; }

  const save = event.target.closest("[data-save-skill]");
  if (save) { saveSkill(save.dataset.saveSkill); return; }

  const removeTag = event.target.closest("[data-remove-edit-tag]");
  if (removeTag && state.editing) {
    state.editing.tags.splice(Number(removeTag.dataset.removeEditTag), 1);
    refreshEditTags();
    return;
  }

  if (event.target.closest("[data-add-edit-tag]")) {
    addEditingTag();
    return;
  }

  const confirm = event.target.closest("[data-confirm-action]");
  if (confirm) {
    const [action, id] = confirm.dataset.confirmAction.split(":");
    handleConfirmedAction(action, id);
  }
});

modalRoot.addEventListener("keydown", (event) => {
  if (event.target.id === "edit-tags" && event.key === "Enter") {
    event.preventDefault();
    addEditingTag();
  }
});

modalRoot.addEventListener("input", (event) => {
  if (event.target.id === "market-search") {
    state.marketQuery = event.target.value;
    document.querySelector("#market-results").innerHTML = renderMarketResults();
    refreshIcons();
  }
});

function installMarketSkill(id) {
  const item = marketSkills.find((skill) => skill.id === id);
  if (!item || !item.compatible) return;
  const installed = {
    ...item,
    id: `installed-${item.id}`,
    marketId: item.id,
    source: "market",
    status: null
  };
  skills.push(installed);
  if (state.view === "library") renderLibrary();
  document.querySelector("#market-results").innerHTML = renderMarketResults();
  refreshIcons();
  showToast(`“${item.name}”安装成功，已加入我的技能`);
}

function completeImport() {
  const nameInput = document.querySelector("#import-name");
  const categoryInput = document.querySelector("#import-category");
  const tagsInput = document.querySelector("#import-tags");
  const summaryInput = document.querySelector("#import-summary");
  state.import.name = nameInput?.value.trim() || state.import.name;
  state.import.category = categoryInput?.value || state.import.category;
  state.import.tags = tagsInput?.value || state.import.tags;
  state.import.summary = summaryInput?.value.trim() || state.import.summary;
  const existing = skills.find((item) => item.id === "imported-skill");
  const imported = {
    id: "imported-skill",
    name: state.import.name,
    letter: state.import.name.slice(0, 1),
    category: state.import.category,
    source: "personal",
    description: state.import.summary,
    tags: state.import.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    version: "1.0.0",
    status: null,
    instruction: state.import.instruction
  };
  if (existing) Object.assign(existing, imported); else skills.push(imported);
  state.import.step = 3;
  render();
}

function saveSkill(id) {
  const skill = skills.find((item) => item.id === id);
  if (!skill) return;
  const name = document.querySelector("#edit-name")?.value.trim();
  const summary = document.querySelector("#edit-summary")?.value.trim();
  const category = document.querySelector("#edit-category")?.value;
  const instruction = document.querySelector("#edit-instruction")?.value.trim();
  const newTag = document.querySelector("#edit-tags")?.value.trim();
  if (!name || !summary || !instruction) { showToast("请完整填写技能名称、简介和技能说明", "error"); return; }
  skill.name = name;
  skill.description = summary;
  skill.category = category;
  skill.instruction = instruction;
  if (newTag && state.editing && !state.editing.tags.includes(newTag)) state.editing.tags.push(newTag);
  skill.tags = state.editing?.skillId === id ? [...state.editing.tags] : skill.tags;
  state.editing = null;
  closeModal();
  render();
  showToast("技能内容已保存，可以继续使用或提交审批");
}

function handleConfirmedAction(action, id) {
  const skill = skills.find((item) => item.id === id);
  if (!skill) return;
  if (action === "submit") {
    skill.status = "reviewing";
    skill.updatedAt = "刚刚";
    closeModal();
    render();
    showToast("提交成功，当前版本已进入审批");
  }
  if (action === "withdraw") {
    skill.status = "withdrawn";
    skill.updatedAt = "刚刚";
    closeModal();
    render();
    showToast("申请已撤回，现在可以编辑并重新提交");
  }
  if (action === "delete") {
    skills = skills.filter((item) => item.id !== id);
    closeModal();
    state.view = "library";
    state.activeTab = "personal";
    render();
    showToast("个人技能已删除");
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
});

render();
