<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";

const XMAI_ADMIN_URL = "http://47.96.184.148/xianma-updates/admin";
const XMAI_ADMIN_ORIGIN = "http://47.96.184.148";
const AUTH_STORAGE_KEY = "mapms-admin-auth";
const iframeRef = ref(null);
let lastContext = "";
let refreshTimer = null;

function clean(value, maximumLength = 128) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength);
}

function readSavedAuth() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || "null");
      if (saved?.user) return saved;
    } catch {}
  }
  return null;
}

function currentAdminContext() {
  const user = readSavedAuth()?.user || {};
  const displayName = clean(user.dingtalkNickname || user.nickname || user.nickName || user.displayName || user.realName || user.username, 80);
  if (!displayName) return { type: "XMAI_ADMIN_CONTEXT_CLEAR", protocolVersion: 1 };
  return {
    type: "XMAI_ADMIN_CONTEXT",
    protocolVersion: 1,
    adminId: clean(user.adminId || user.userId || user.id),
    username: clean(user.username || user.userName || user.loginName),
    displayName
  };
}

function sendAdminContext(force = false) {
  const frameWindow = iframeRef.value?.contentWindow;
  if (!frameWindow) return;
  const context = currentAdminContext();
  const serialized = JSON.stringify(context);
  if (!force && serialized === lastContext) return;
  lastContext = serialized;
  frameWindow.postMessage(context, XMAI_ADMIN_ORIGIN);
}

function handleMessage(event) {
  if (event.source !== iframeRef.value?.contentWindow || event.origin !== XMAI_ADMIN_ORIGIN || event.data?.type !== "XMAI_ADMIN_CONTEXT_REQUEST") return;
  sendAdminContext(true);
}

function handleStorage(event) {
  if (event.key === AUTH_STORAGE_KEY) sendAdminContext(true);
}

onMounted(() => {
  window.addEventListener("message", handleMessage);
  window.addEventListener("storage", handleStorage);
  refreshTimer = window.setInterval(() => sendAdminContext(), 3000);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleMessage);
  window.removeEventListener("storage", handleStorage);
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="xianma-studio">
    <iframe
      ref="iframeRef"
      class="xianma-studio-frame"
      :src="XMAI_ADMIN_URL"
      title="XMAI Studio"
      referrerpolicy="strict-origin-when-cross-origin"
      @load="sendAdminContext(true)"
    />
  </section>
</template>
