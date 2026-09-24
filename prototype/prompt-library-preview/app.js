"use strict";

const categories = [
  { id: "all", label: "全部分类" },
  { id: "社交媒体帖子", label: "社交媒体" },
  { id: "电商主图", label: "电商主图" },
  { id: "产品营销", label: "产品营销" },
  { id: "个人资料 / 头像", label: "头像与形象" },
  { id: "漫画 / 故事板", label: "漫画与故事板" },
  { id: "YouTube 缩略图", label: "视频缩略图" },
  { id: "信息图 / 教育视觉图", label: "信息图" },
  { id: "游戏素材", label: "游戏素材" }
];

const elements = {
  searchInput: document.querySelector("#searchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  refreshButton: document.querySelector("#refreshButton"),
  categoryStrip: document.querySelector("#categoryStrip"),
  categoryPrevious: document.querySelector("#categoryPrevious"),
  categoryNext: document.querySelector("#categoryNext"),
  promptGrid: document.querySelector("#promptGrid"),
  totalCount: document.querySelector("#totalCount"),
  resultsTitle: document.querySelector("#resultsTitle"),
  resultsMeta: document.querySelector("#resultsMeta"),
  resetFiltersButton: document.querySelector("#resetFiltersButton"),
  pagination: document.querySelector("#pagination"),
  previousPageButton: document.querySelector("#previousPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pageNumbers: document.querySelector("#pageNumbers"),
  detailBackdrop: document.querySelector("#detailBackdrop"),
  detailCategory: document.querySelector("#detailCategory"),
  detailTitle: document.querySelector("#detailTitle"),
  detailContent: document.querySelector("#detailContent"),
  detailSaveButton: document.querySelector("#detailSaveButton"),
  detailCopyButton: document.querySelector("#detailCopyButton"),
  detailUseButton: document.querySelector("#detailUseButton"),
  toast: document.querySelector("#toast")
};

const state = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  query: "",
  category: "all",
  scope: "all",
  loading: false,
  activePrompt: null,
  argumentValues: {},
  requestVersion: 0,
  savedIds: new Set(readSavedIds())
};

let searchTimer = null;
let toastTimer = null;

function readSavedIds() {
  try {
    const value = JSON.parse(localStorage.getItem("xmai-prompt-preview-saved") || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function saveSavedIds() {
  localStorage.setItem("xmai-prompt-preview-saved", JSON.stringify([...state.savedIds]));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createIcons(root = document) {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ root, attrs: { "aria-hidden": "true" } });
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

function categoryLabel(id) {
  return categories.find((item) => item.id === id)?.label || id || "全部分类";
}

function promptCategory(prompt) {
  const tags = Array.isArray(prompt?.tags) ? prompt.tags : [];
  return categories.find((category) => category.id !== "all" && tags.includes(category.id))?.id
    || tags.find((tag) => tag && tag !== prompt?.image_model && tag !== "gpt-image-2")
    || prompt?.category
    || "灵感提示词";
}

function promptVisual(prompt) {
  const category = promptCategory(prompt);
  if (/电商|产品/.test(category)) return { icon: "shopping-bag", tone: "tone-red" };
  if (/社交|YouTube|视频/.test(category)) return { icon: "megaphone", tone: "tone-blue" };
  if (/头像|个人/.test(category)) return { icon: "user-round", tone: "tone-green" };
  if (/漫画|故事|游戏/.test(category)) return { icon: "sparkles", tone: "tone-violet" };
  if (/信息图|教育/.test(category)) return { icon: "chart-no-axes-combined", tone: "tone-amber" };
  return { icon: "wand-sparkles", tone: "tone-blue" };
}

function renderCategories() {
  elements.categoryStrip.innerHTML = categories.map((category) => `
    <button class="${state.category === category.id ? "active" : ""}" type="button" data-category="${escapeHtml(category.id)}" role="tab" aria-selected="${state.category === category.id}">${escapeHtml(category.label)}</button>
  `).join("");
  updateCategoryArrows();
}

function updateCategoryArrows() {
  const strip = elements.categoryStrip;
  elements.categoryPrevious.disabled = strip.scrollLeft <= 2;
  elements.categoryNext.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
}

function skeletonCards() {
  return Array.from({ length: state.pageSize }, () => `
    <article class="prompt-card skeleton-card" aria-hidden="true">
      <div class="prompt-card-top">
        <span class="skeleton-circle"></span>
        <span><span class="skeleton-line"></span><span class="skeleton-line short" style="display:block;margin-top:9px"></span></span>
      </div>
      <span class="skeleton-block"></span>
      <span class="skeleton-line medium"></span>
      <span class="skeleton-line short" style="margin-top:auto"></span>
    </article>
  `).join("");
}

function visibleItems() {
  if (state.scope === "saved") return state.items.filter((item) => state.savedIds.has(String(item.id)));
  return state.items;
}

function renderPromptCard(prompt) {
  const id = String(prompt.id || "");
  const saved = state.savedIds.has(id);
  const visual = promptVisual(prompt);
  const category = promptCategory(prompt);
  const tags = (Array.isArray(prompt.tags) ? prompt.tags : []).filter(Boolean).slice(0, 3);
  const description = cleanText(prompt.description || prompt.prompt || "打开查看完整提示词内容。");
  return `
    <article class="prompt-card" tabindex="0" data-prompt-id="${escapeHtml(id)}" aria-label="查看提示词：${escapeHtml(prompt.title)}">
      <div class="prompt-card-top">
        <span class="prompt-icon ${visual.tone}"><i data-lucide="${visual.icon}"></i></span>
        <div class="prompt-card-heading">
          <h3>${escapeHtml(prompt.title || "未命名提示词")}</h3>
          <span>${escapeHtml(category)}</span>
        </div>
        <button class="save-button ${saved ? "saved" : ""}" type="button" data-save-prompt="${escapeHtml(id)}" title="${saved ? "取消收藏" : "收藏"}" aria-label="${saved ? "取消收藏" : "收藏"}"><i data-lucide="bookmark"${saved ? " fill=\"currentColor\"" : ""}></i></button>
      </div>
      <p class="prompt-description">${escapeHtml(description)}</p>
      <div class="prompt-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <footer class="prompt-card-footer">
        <span class="prompt-author"><i data-lucide="user-round"></i><span>${escapeHtml(prompt.author || "公共提示词库")}</span></span>
        <button class="open-prompt-button" type="button" data-open-prompt="${escapeHtml(id)}"><span>查看</span><i data-lucide="arrow-up-right"></i></button>
      </footer>
    </article>
  `;
}

function renderEmptyState() {
  const isSaved = state.scope === "saved";
  return `
    <div class="empty-state">
      <span class="empty-icon"><i data-lucide="${isSaved ? "bookmark" : "search-x"}"></i></span>
      <h3>${isSaved ? "还没有收藏提示词" : "没有找到匹配的提示词"}</h3>
      <p>${isSaved ? "在提示词卡片上点击收藏，稍后可以快速找到。" : "可以更换关键词、切换分类或重置筛选。"}</p>
      ${isSaved ? "" : "<button type=\"button\" data-reset-empty>重置筛选</button>"}
    </div>
  `;
}

function renderErrorState(message) {
  return `
    <div class="empty-state">
      <span class="empty-icon"><i data-lucide="wifi-off"></i></span>
      <h3>公共提示词库暂时无法连接</h3>
      <p>${escapeHtml(message || "请检查网络后重新加载。")}</p>
      <button type="button" data-retry>重新加载</button>
    </div>
  `;
}

function renderResults() {
  const items = visibleItems();
  const category = categoryLabel(state.category);
  elements.resultsTitle.textContent = state.scope === "saved" ? "我的收藏" : (state.category === "all" ? "全部提示词" : category);
  elements.resultsMeta.textContent = state.scope === "saved"
    ? `当前页面有 ${items.length} 条收藏`
    : `第 ${state.page} 页，共 ${state.total.toLocaleString("zh-CN")} 条`;
  elements.resetFiltersButton.classList.toggle("hidden", !state.query && state.category === "all" && state.scope === "all");
  elements.promptGrid.innerHTML = items.length ? items.map(renderPromptCard).join("") : renderEmptyState();
  renderPagination();
  createIcons(elements.promptGrid);
}

function pageWindow(current, totalPages) {
  const values = new Set([1, totalPages, current - 1, current, current + 1]);
  return [...values].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const show = state.scope === "all" && state.total > state.pageSize;
  elements.pagination.classList.toggle("hidden", !show);
  if (!show) return;
  elements.previousPageButton.disabled = state.page <= 1;
  elements.nextPageButton.disabled = state.page >= totalPages;
  const pages = pageWindow(state.page, totalPages);
  let previous = 0;
  const parts = [];
  for (const page of pages) {
    if (previous && page - previous > 1) parts.push("<span aria-hidden=\"true\">...</span>");
    parts.push(`<button class="${page === state.page ? "active" : ""}" type="button" data-page="${page}" aria-current="${page === state.page ? "page" : "false"}">${page}</button>`);
    previous = page;
  }
  elements.pageNumbers.innerHTML = parts.join("");
}

function fetchKeyword() {
  return [state.query, state.category === "all" ? "" : state.category].filter(Boolean).join(" ");
}

async function loadPrompts({ force = false } = {}) {
  const version = ++state.requestVersion;
  state.loading = true;
  elements.promptGrid.innerHTML = skeletonCards();
  elements.resultsMeta.textContent = "正在读取公共提示词库";
  elements.pagination.classList.add("hidden");
  const params = new URLSearchParams({ page: String(state.page), page_size: String(state.pageSize) });
  const keyword = fetchKeyword();
  if (keyword) params.set("keyword", keyword);
  if (force) params.set("refresh", String(Date.now()));
  try {
    const response = await fetch(`/api/prompts?${params}`);
    const payload = await response.json();
    if (!response.ok || payload?.code !== 200 || !Array.isArray(payload?.data?.items)) {
      throw new Error(payload?.message || payload?.error || `接口返回 ${response.status}`);
    }
    if (version !== state.requestVersion) return;
    state.items = payload.data.items;
    state.total = Number(payload.data.total || 0);
    state.page = Math.max(1, Number(payload.data.page || state.page));
    state.pageSize = Math.max(1, Number(payload.data.page_size || state.pageSize));
    elements.totalCount.textContent = state.total.toLocaleString("zh-CN");
    renderResults();
  } catch (error) {
    if (version !== state.requestVersion) return;
    state.items = [];
    state.total = 0;
    elements.totalCount.textContent = "--";
    elements.resultsMeta.textContent = "加载失败";
    elements.promptGrid.innerHTML = renderErrorState(error.message);
    createIcons(elements.promptGrid);
  } finally {
    if (version === state.requestVersion) state.loading = false;
  }
}

function promptArguments(promptText) {
  const values = [];
  const seen = new Set();
  const expression = /\{argument\s+name="([^"]+)"(?:\s+default="([^"]*)")?\s*\}/g;
  let match;
  while ((match = expression.exec(String(promptText || "")))) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    values.push({ name: match[1], defaultValue: match[2] || "" });
  }
  return values;
}

function resolvedPrompt(prompt) {
  return String(prompt?.prompt || "").replace(/\{argument\s+name="([^"]+)"(?:\s+default="([^"]*)")?\s*\}/g, (_all, name, defaultValue) => {
    return cleanText(state.argumentValues[name]) || defaultValue || `[${name}]`;
  });
}

function renderDetail(prompt) {
  const argumentsList = promptArguments(prompt.prompt);
  state.argumentValues = Object.fromEntries(argumentsList.map((item) => [item.name, item.defaultValue]));
  elements.detailCategory.textContent = promptCategory(prompt);
  elements.detailTitle.textContent = prompt.title || "提示词详情";
  const tags = (Array.isArray(prompt.tags) ? prompt.tags : []).filter(Boolean);
  elements.detailContent.innerHTML = `
    <section class="detail-section">
      <h3>简介</h3>
      <p class="detail-description">${escapeHtml(prompt.description || "该提示词暂未提供简介。")}</p>
    </section>
    <section class="detail-section">
      <dl class="detail-meta">
        <div><dt>来源</dt><dd>${escapeHtml(prompt.source_name || "公共提示词库")}</dd></div>
        <div><dt>作者</dt><dd>${escapeHtml(prompt.author || "未署名")}</dd></div>
        <div><dt>适用模型</dt><dd>${escapeHtml(prompt.image_model || "通用")}</dd></div>
        <div><dt>收录时间</dt><dd>${escapeHtml(prompt.source_created_at || "未记录")}</dd></div>
      </dl>
    </section>
    ${argumentsList.length ? `
      <section class="detail-section">
        <h3>自定义内容</h3>
        <div class="argument-fields">
          ${argumentsList.map((item) => `
            <div class="argument-field">
              <label for="argument-${escapeHtml(item.name)}">${escapeHtml(item.name)}</label>
              <input id="argument-${escapeHtml(item.name)}" type="text" data-argument-name="${escapeHtml(item.name)}" value="${escapeHtml(item.defaultValue)}">
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}
    <section class="detail-section">
      <h3>提示词内容</h3>
      <pre id="promptPreview" class="prompt-preview">${escapeHtml(resolvedPrompt(prompt))}</pre>
    </section>
    ${tags.length ? `<section class="detail-section"><h3>标签</h3><div class="detail-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>` : ""}
  `;
  updateDetailSaveButton();
  elements.detailBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  createIcons(elements.detailBackdrop);
  elements.detailBackdrop.querySelector("[data-close-detail]")?.focus();
}

function openPrompt(id) {
  const prompt = state.items.find((item) => String(item.id) === String(id));
  if (!prompt) return;
  state.activePrompt = prompt;
  renderDetail(prompt);
}

function closeDetail() {
  elements.detailBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
  state.activePrompt = null;
  state.argumentValues = {};
}

function updateDetailSaveButton() {
  const saved = state.activePrompt && state.savedIds.has(String(state.activePrompt.id));
  elements.detailSaveButton.classList.toggle("saved", Boolean(saved));
  elements.detailSaveButton.innerHTML = `<i data-lucide="bookmark"${saved ? " fill=\"currentColor\"" : ""}></i><span>${saved ? "已收藏" : "收藏"}</span>`;
  createIcons(elements.detailSaveButton);
}

function toggleSaved(id) {
  const key = String(id || "");
  if (!key) return;
  if (state.savedIds.has(key)) {
    state.savedIds.delete(key);
    showToast("已取消收藏");
  } else {
    state.savedIds.add(key);
    showToast("已加入收藏");
  }
  saveSavedIds();
  renderResults();
  if (state.activePrompt && String(state.activePrompt.id) === key) updateDetailSaveButton();
}

async function copyActivePrompt(used = false) {
  if (!state.activePrompt) return;
  const text = resolvedPrompt(state.activePrompt);
  try {
    await navigator.clipboard.writeText(text);
    showToast(used ? "提示词已复制，接入客户端后将自动带入对话框" : "提示词已复制");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast(used ? "提示词已复制，接入客户端后将自动带入对话框" : "提示词已复制");
  }
}

function resetFilters() {
  state.query = "";
  state.category = "all";
  state.scope = "all";
  state.page = 1;
  elements.searchInput.value = "";
  elements.clearSearchButton.classList.add("hidden");
  document.querySelectorAll("[data-scope]").forEach((button) => {
    const active = button.dataset.scope === "all";
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderCategories();
  loadPrompts();
}

elements.searchInput.addEventListener("input", () => {
  state.query = elements.searchInput.value.trim();
  elements.clearSearchButton.classList.toggle("hidden", !state.query);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadPrompts();
  }, 320);
});

elements.clearSearchButton.addEventListener("click", () => {
  elements.searchInput.value = "";
  state.query = "";
  state.page = 1;
  elements.clearSearchButton.classList.add("hidden");
  elements.searchInput.focus();
  loadPrompts();
});

elements.refreshButton.addEventListener("click", () => {
  elements.refreshButton.firstElementChild?.classList.add("spin");
  loadPrompts({ force: true }).finally(() => elements.refreshButton.firstElementChild?.classList.remove("spin"));
});

elements.categoryStrip.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  state.page = 1;
  renderCategories();
  loadPrompts();
});

elements.categoryStrip.addEventListener("scroll", updateCategoryArrows, { passive: true });
elements.categoryPrevious.addEventListener("click", () => elements.categoryStrip.scrollBy({ left: -280, behavior: "smooth" }));
elements.categoryNext.addEventListener("click", () => elements.categoryStrip.scrollBy({ left: 280, behavior: "smooth" }));
window.addEventListener("resize", updateCategoryArrows);

document.querySelectorAll("[data-scope]").forEach((button) => {
  button.addEventListener("click", () => {
    state.scope = button.dataset.scope;
    document.querySelectorAll("[data-scope]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    renderResults();
  });
});

elements.promptGrid.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save-prompt]");
  if (saveButton) {
    event.stopPropagation();
    toggleSaved(saveButton.dataset.savePrompt);
    return;
  }
  const target = event.target.closest("[data-open-prompt], [data-prompt-id]");
  if (target) openPrompt(target.dataset.openPrompt || target.dataset.promptId);
  if (event.target.closest("[data-reset-empty]")) resetFilters();
  if (event.target.closest("[data-retry]")) loadPrompts({ force: true });
});

elements.promptGrid.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("[data-prompt-id]");
  if (!card) return;
  event.preventDefault();
  openPrompt(card.dataset.promptId);
});

elements.pagination.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) state.page = Number(pageButton.dataset.page);
  else if (event.target.closest("#previousPageButton")) state.page = Math.max(1, state.page - 1);
  else if (event.target.closest("#nextPageButton")) state.page += 1;
  else return;
  document.querySelector(".library-shell")?.scrollTo({ top: 0, behavior: "smooth" });
  loadPrompts();
});

elements.resetFiltersButton.addEventListener("click", resetFilters);

elements.detailBackdrop.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-detail]")) closeDetail();
});

elements.detailContent.addEventListener("input", (event) => {
  const input = event.target.closest("[data-argument-name]");
  if (!input || !state.activePrompt) return;
  state.argumentValues[input.dataset.argumentName] = input.value;
  const preview = document.querySelector("#promptPreview");
  if (preview) preview.textContent = resolvedPrompt(state.activePrompt);
});

elements.detailSaveButton.addEventListener("click", () => state.activePrompt && toggleSaved(state.activePrompt.id));
elements.detailCopyButton.addEventListener("click", () => copyActivePrompt(false));
elements.detailUseButton.addEventListener("click", () => copyActivePrompt(true));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.detailBackdrop.classList.contains("hidden")) closeDetail();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.searchInput.focus();
  }
});

renderCategories();
createIcons();
loadPrompts();
