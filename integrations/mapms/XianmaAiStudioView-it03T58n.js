import { _ as exportComponent, i as openBlock, c as createElementBlock, a as createElementVNode } from "./index-CoSzahim.js";

const XMAI_ADMIN_URL = "http://47.96.184.148/xianma-updates/admin";
const XMAI_ADMIN_ORIGIN = "http://47.96.184.148";
const AUTH_STORAGE_KEY = "mapms-admin-auth";

function readSavedAuth() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || "null");
      if (saved?.user) return saved;
    } catch {}
  }
  return null;
}

function clean(value, maximumLength = 128) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength);
}

function currentAdminContext() {
  const user = readSavedAuth()?.user || {};
  const displayName = clean(user.dingtalkNickname || user.nickname || user.nickName || user.displayName || user.realName || user.username, 80);
  if (!displayName) return null;
  return {
    type: "XMAI_ADMIN_CONTEXT",
    protocolVersion: 1,
    adminId: clean(user.adminId || user.userId || user.id),
    username: clean(user.username || user.userName || user.loginName),
    displayName
  };
}

function xmaiFrame() {
  return document.querySelector(".xianma-studio-frame");
}

function sendAdminContext(frame = xmaiFrame()) {
  if (!frame?.contentWindow) return;
  const context = currentAdminContext();
  frame.contentWindow.postMessage(context || { type: "XMAI_ADMIN_CONTEXT_CLEAR", protocolVersion: 1 }, XMAI_ADMIN_ORIGIN);
}

window.addEventListener("message", (event) => {
  const frame = xmaiFrame();
  if (!frame || event.source !== frame.contentWindow || event.origin !== XMAI_ADMIN_ORIGIN || event.data?.type !== "XMAI_ADMIN_CONTEXT_REQUEST") return;
  sendAdminContext(frame);
});

window.addEventListener("storage", (event) => {
  if (event.key === AUTH_STORAGE_KEY) sendAdminContext();
});

const component = {};
const sectionProps = { class: "xianma-studio" };

function render(_context, cache) {
  return openBlock(), createElementBlock("section", sectionProps, [
    ...cache[0] || (cache[0] = [
      createElementVNode("iframe", {
        class: "xianma-studio-frame",
        src: XMAI_ADMIN_URL,
        title: "XMAI Studio",
        referrerpolicy: "strict-origin-when-cross-origin",
        onLoad: event => sendAdminContext(event.currentTarget)
      }, null, 32)
    ])
  ]);
}

const XianmaAiStudioView = exportComponent(component, [["render", render], ["__scopeId", "data-v-950c3508"]]);
export { XianmaAiStudioView as default };
