"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { token: sessionStorage.getItem("xmai-download-admin-token") || "", resources: [] };
const authHeaders = () => ({ authorization: `Bearer ${state.token}` });
const serviceRoot = location.pathname.replace(/\/admin\/?$/, "");
const servicePath = (value) => `${serviceRoot}${value}`;

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "-"; }
function statusLabel(value) { return ({ published: "可下载", disabled: "已停用" })[value] || value || "未知"; }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.remove("hidden"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add("hidden"), 3600); }

async function request(pathName, options = {}) {
  const response = await fetch(servicePath(pathName), { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function renderResources() {
  const rows = $("#resourceRows");
  if (!state.resources.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">暂无上传资源</td></tr>`;
    return;
  }
  rows.innerHTML = state.resources.map((item) => `<tr><td><span class="resource-title">${escapeHtml(item.title)}</span>${item.description ? `<small class="resource-description">${escapeHtml(item.description)}</small>` : ""}</td><td><span class="file-name" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span><small class="file-size">${formatBytes(item.size)}</small></td><td><span class="status ${escapeHtml(item.status)}">${statusLabel(item.status)}</span></td><td><span class="date">${formatDate(item.uploadedAt)}</span></td><td><button class="button secondary" type="button" data-copy="${escapeHtml(item.downloadUrl)}">复制地址</button></td><td><button class="button danger" type="button" data-delete="${escapeHtml(item.resourceId)}">删除资源</button></td></tr>`).join("");
}

async function loadResources() {
  const data = await request("/api/admin/resources");
  state.resources = data.resources || [];
  $("#publicLink").href = data.publicPageUrl || servicePath("/");
  renderResources();
}

function showWorkspace() {
  $("#auth").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#logout").classList.remove("hidden");
  loadResources().catch((error) => {
    state.token = "";
    sessionStorage.removeItem("xmai-download-admin-token");
    $("#workspace").classList.add("hidden");
    $("#auth").classList.remove("hidden");
    toast(error.message);
  });
}

function setUploadState(disabled, text) {
  $("#uploadButton").disabled = disabled;
  $("#progressText").textContent = text;
}

async function uploadResource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.file.files[0];
  if (!file) { toast("请选择要上传的文件"); return; }
  const title = form.title.value.trim() || file.name;
  const metadata = { title, description: form.description.value.trim(), fileName: file.name, fileSize: file.size, contentType: file.type || "application/octet-stream" };
  setUploadState(true, "正在准备上传");
  $("#progressBar").style.width = "0%";
  try {
    const session = await request("/api/admin/resources/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(metadata) });
    for (let index = 0; index < session.chunkCount; index += 1) {
      const start = index * session.chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + session.chunkSize));
      let uploaded = false;
      for (let attempt = 1; attempt <= 4 && !uploaded; attempt += 1) {
        const response = await fetch(servicePath(`/api/admin/resources/uploads/${encodeURIComponent(session.uploadId)}/chunks/${index}`), { method: "PUT", headers: { ...authHeaders(), "content-type": "application/octet-stream", "content-length": String(chunk.size) }, body: chunk });
        if (response.ok) uploaded = true;
        else if (attempt === 4) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `第 ${index + 1} 个分片上传失败`); }
        if (!uploaded) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
      const uploadedBytes = Math.min(file.size, (index + 1) * session.chunkSize);
      $("#progressBar").style.width = `${file.size ? Math.floor(uploadedBytes / file.size * 96) : 96}%`;
      $("#progressText").textContent = `正在上传 ${formatBytes(uploadedBytes)} / ${formatBytes(file.size)}`;
    }
    await request(`/api/admin/resources/uploads/${encodeURIComponent(session.uploadId)}/complete`, { method: "POST" });
    $("#progressBar").style.width = "100%";
    setUploadState(false, "上传完成");
    toast("资源上传完成，公开下载地址已生效");
    form.reset();
    await loadResources();
  } catch (error) {
    setUploadState(false, error.message);
    toast(error.message);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  toast("下载地址已复制");
}

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = $("#password").value.trim();
  state.token = token;
  try {
    const data = await request("/api/admin/resources");
    sessionStorage.setItem("xmai-download-admin-token", token);
    state.resources = data.resources || [];
    $("#publicLink").href = data.publicPageUrl || servicePath("/");
    renderResources();
    $("#auth").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#logout").classList.remove("hidden");
  } catch (error) {
    state.token = "";
    toast(error.message);
  }
});

$("#resourceForm").addEventListener("submit", uploadResource);
$("#resourceForm").file.addEventListener("change", (event) => {
  const file = event.target.files[0];
  const title = $("#resourceForm").title;
  if (file && !title.value.trim()) title.value = file.name;
  if (file) $("#progressText").textContent = `${file.name} · ${formatBytes(file.size)}`;
});
$("#logout").addEventListener("click", () => { state.token = ""; sessionStorage.removeItem("xmai-download-admin-token"); location.reload(); });
$("#resourceRows").addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy]");
  const remove = event.target.closest("[data-delete]");
  if (copy) { await copyText(copy.dataset.copy); return; }
  if (remove && confirm("确认删除这个资源吗？删除后公开下载地址会立即失效，服务器文件也会被删除。")) {
    try { await request(`/api/admin/resources/${encodeURIComponent(remove.dataset.delete)}`, { method: "DELETE" }); toast("资源已删除"); await loadResources(); }
    catch (error) { toast(error.message); }
  }
});

if (state.token) showWorkspace();
