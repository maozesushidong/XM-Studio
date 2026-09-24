const STORAGE_KEY = "centaur.desktop.chat.v3";
const GLOBAL_SESSION_KEY = "centaur.session";
const SKILL_BINDING_VERSION = 4;
const LEGACY_CHAT_OWNER_KEY = "centaur.desktop.chat.legacy-owner.v1";

function storedConversationValue(conversation) {
  if (!conversation || typeof conversation !== "object") return 0;
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  return messages.length * 100000 + JSON.stringify(conversation).length;
}

function mergeStoredChatObjects(existing, incoming) {
  if (!existing || typeof existing !== "object") return incoming;
  if (!incoming || typeof incoming !== "object") return existing;
  const existingConversations = Array.isArray(existing.conversations) ? existing.conversations : [];
  const incomingConversations = Array.isArray(incoming.conversations) ? incoming.conversations : [];
  const conversationsById = new Map();
  const conversationOrder = [];

  for (const conversation of [...existingConversations, ...incomingConversations]) {
    if (!conversation || typeof conversation !== "object") continue;
    const id = String(conversation.id || `legacy-${conversationOrder.length}`);
    const current = conversationsById.get(id);
    if (!current) {
      conversationsById.set(id, conversation);
      conversationOrder.push(id);
      continue;
    }
    if (storedConversationValue(conversation) > storedConversationValue(current)) {
      conversationsById.set(id, conversation);
    }
  }

  const conversations = conversationOrder.map((id) => conversationsById.get(id));
  const activeConversationId = conversations.some((conversation) => conversation.id === existing.activeConversationId)
    ? existing.activeConversationId
    : (conversations.some((conversation) => conversation.id === incoming.activeConversationId)
      ? incoming.activeConversationId
      : conversations[0]?.id);
  return {
    ...incoming,
    ...existing,
    config: { ...(incoming.config || {}), ...(existing.config || {}) },
    conversations,
    activeConversationId
  };
}

function mergeStoredChatValues(existingValue, incomingValue) {
  const existing = parseJson(existingValue);
  const incoming = parseJson(incomingValue);
  if (!existing) return incoming ? JSON.stringify(incoming) : existingValue;
  if (!incoming) return existingValue;
  return JSON.stringify(mergeStoredChatObjects(existing, incoming));
}

function hasMeaningfulChatHistory(saved) {
  const conversations = Array.isArray(saved?.conversations) ? saved.conversations : [];
  if (conversations.length > 1) return true;
  return conversations.some((conversation) => {
    if (Array.isArray(conversation?.messages) && conversation.messages.length > 0) return true;
    const title = String(conversation?.title || "").trim();
    return Boolean(title && !["新的对话", "新对话"].includes(title));
  });
}

function restoreLegacyChatForSession(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const targetKey = getStorageKey(normalizedUserId);
  const current = parseJson(localStorage.getItem(targetKey));
  if (hasMeaningfulChatHistory(current)) return current;

  const recordedOwner = String(localStorage.getItem(LEGACY_CHAT_OWNER_KEY) || "").trim();
  if (recordedOwner && recordedOwner !== normalizedUserId) return current;
  const legacyKeys = [STORAGE_KEY, getStorageKey("anonymous"), getStorageKey("local-user")];
  let recovered = null;
  for (const key of legacyKeys) {
    const candidate = parseJson(localStorage.getItem(key));
    if (!hasMeaningfulChatHistory(candidate)) continue;
    recovered = mergeStoredChatObjects(recovered, candidate);
  }
  if (!hasMeaningfulChatHistory(recovered)) return current;

  const migrated = mergeStoredChatObjects(recovered, current);
  localStorage.setItem(targetKey, JSON.stringify(migrated));
  localStorage.setItem(LEGACY_CHAT_OWNER_KEY, normalizedUserId);
  return migrated;
}
function restoreStartupChatBackup() {
  let backup = null;
  try {
    backup = window.desktopBridge?.getStartupChatBackup?.();
  } catch {
    return;
  }
  const sources = Array.isArray(backup?.sources)
    ? backup.sources
    : (backup?.items && typeof backup.items === "object" ? [backup] : []);
  for (const source of sources) {
    if (!source?.items || typeof source.items !== "object") continue;
    Object.entries(source.items).forEach(([key, value]) => {
      const allowed = key.startsWith(STORAGE_KEY) || key === "centaur.config";
      if (!allowed || typeof value !== "string") return;
      const existingValue = localStorage.getItem(key);
      if (key.startsWith(STORAGE_KEY)) {
        localStorage.setItem(key, mergeStoredChatValues(existingValue, value));
      } else if (existingValue === null) {
        localStorage.setItem(key, value);
      }
    });
  }
}

restoreStartupChatBackup();

const SVG_ICON_PATHS = Object.freeze({
  minus: '<path d="M5 12h14"/>',
  x: '<path d="m18 6-12 12"/><path d="m6 6 12 12"/>',
  maximize: '<rect width="15" height="15" x="4.5" y="4.5" rx="1.5"/>',
  "copy-square": '<rect width="13" height="13" x="8" y="3" rx="1.5"/><path d="M16 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3"/>',
  "square-pen": '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.4 2.6 3 3L12 15l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.2 14.6A7 7 0 1 1 15.8 14.6C14.7 15.4 14 16.2 14 18h-4c0-1.8-.7-2.6-1.8-3.4Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  zap: '<path d="M13 2 4.5 13H11l-1 9 8.5-11H12Z"/>',
  "log-out": '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
  "x-circle": '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "arrow-up": '<path d="m18 10-6-6-6 6"/><path d="M12 4v16"/>',
  "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  "pen-line": '<path d="m15 5 4 4"/><path d="M4 20h4L19.5 8.5a2.8 2.8 0 1 0-4-4L4 16Z"/><path d="M12 20h8"/>',
  "clipboard-list": '<rect width="16" height="18" x="4" y="4" rx="2"/><path d="M9 4V2h6v2"/><path d="M9 10h6"/><path d="M9 14h6"/><path d="M7 10h.01"/><path d="M7 14h.01"/>',
  paperclip: '<path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>',
  "qr-code": '<rect width="5" height="5" x="3" y="3" rx=".5"/><rect width="5" height="5" x="16" y="3" rx=".5"/><rect width="5" height="5" x="3" y="16" rx=".5"/><path d="M16 16h2v2h-2zM19 19h2v2h-2zM19 14h2M14 19v2M14 14h2"/>',
  "triangle-alert": '<path d="M10.3 3.7 2.4 17.2A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  "rotate-cw": '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  pin: '<path d="m12 17-5 5"/><path d="m5 3 6.5 6.5"/><path d="M15 3 9 9l6 6 6-6"/>',
  "pin-off": '<path d="m3 3 18 18"/><path d="m12 17-5 5"/><path d="M15 3 9.8 8.2"/><path d="m13 11 2 4 3.2-3.2"/>',
  "more-horizontal": '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "circle-check": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  square: '<rect width="10" height="10" x="7" y="7" rx="1.5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  "calendar-clock": '<path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h11"/><path d="M14 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8"/><circle cx="18" cy="17" r="4"/><path d="M18 15v2l1.5 1"/>',
  "folder-open": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H7l-4 9Z"/>',
  "file-archive": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M10 8h2M10 12h2M10 16h2"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-7 0C4.8.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/>',
  "file-code": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 13 2 2-2 2"/>',
  "file-stack": '<path d="M7 3h10a2 2 0 0 1 2 2v10"/><path d="M5 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M7 11h6M7 15h6"/>',
  "file-audio": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M15 12v5.5a2.5 2.5 0 1 1-2-2.45V13l4-1v3"/>',
  video: '<rect width="18" height="16" x="3" y="4" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  "sheet": '<rect width="16" height="18" x="4" y="3" rx="2"/><path d="M8 8h8M8 12h8M8 16h8M11 8v8"/>',
  presentation: '<path d="M3 4h18v13H3z"/><path d="m8 21 4-4 4 4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  sparkles: '<path d="m12 3-1.1 3.2L8 7.5l2.9 1.3L12 12l1.1-3.2L16 7.5l-2.9-1.3Z"/><path d="m19 13-.8 2.2L16 16l2.2.8L19 19l.8-2.2L22 16l-2.2-.8Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  "refresh-cw": '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.7-2.6L20 8"/><path d="m4 16 2.2 2.6A7 7 0 0 0 17.9 16"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
  "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/>',
  "arrow-up-right": '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  "user-round": '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  "shopping-bag": '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  megaphone: '<path d="m3 11 15-6v14L3 13Z"/><path d="M11.6 16.6 13 21H7l-1.4-6"/>',
  "chart-no-axes-combined": '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
  "wand-sparkles": '<path d="m15 4 5 5L8 21H3v-5Z"/><path d="m13 6 5 5"/><path d="M6 3v3M4.5 4.5h3M19 16v4M17 18h4"/>',
  "search-x": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8.5 8.5l5 5M13.5 8.5l-5 5"/>',
  "wifi-off": '<path d="m2 2 20 20"/><path d="M8.5 8.5A10.8 10.8 0 0 1 21 9"/><path d="M5 12.6a11 11 0 0 1 2.3-1.5M10.7 14.5a4.2 4.2 0 0 1 5.8 1.3"/><path d="M12 20h.01"/>',
  "shield-alert": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  "shield-check": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  "circle-alert": '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'
});

function iconSvg(name) {
  const paths = SVG_ICON_PATHS[name] || SVG_ICON_PATHS.file;
  return `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

function setSvgIcon(target, name) {
  if (!target) return;
  target.dataset.svgIcon = name;
  target.innerHTML = iconSvg(name);
}
function hydrateSvgIcons(root = document) {
  root.querySelectorAll?.("[data-svg-icon]").forEach((target) => {
    setSvgIcon(target, target.dataset.svgIcon);
  });
}

const els = {
  conversationList: document.getElementById("conversationList"),
  chatView: document.getElementById("chatView"),
  pageView: document.getElementById("pageView"),
  pageContent: document.getElementById("pageContent"),
  messages: document.getElementById("messages"),
  contextBar: document.getElementById("contextBar"),
  attachmentBar: document.getElementById("attachmentBar"),
  chatForm: document.getElementById("chatForm"),
  promptInput: document.getElementById("promptInput"),
  sendButton: document.getElementById("sendButton"),
  titlebar: document.getElementById("titlebar"),
  maximizeButton: document.getElementById("maximizeButton"),
  conversationTitle: document.getElementById("conversationTitle"),
  activeMode: document.getElementById("activeMode"),
  modelPicker: document.getElementById("modelPicker"),
  modelButton: document.getElementById("modelButton"),
  modelDropdown: document.getElementById("modelDropdown"),
  composerMenu: document.getElementById("composerMenu"),
  composerSkillSearch: document.getElementById("composerSkillSearch"),
  composerSkillList: document.getElementById("composerSkillList"),
  starterGrid: document.getElementById("starterGrid"),
  runtimeSetup: document.getElementById("runtimeSetup"),
  runtimeSetupLabel: document.getElementById("runtimeSetupLabel"),
  runtimeSetupProgress: document.getElementById("runtimeSetupProgress"),
  runtimeSetupPercent: document.getElementById("runtimeSetupPercent"),
  runtimeSetupCancel: document.getElementById("runtimeSetupCancel"),
  workspacePath: document.getElementById("workspacePath"),
  loginModal: document.getElementById("loginModal"),
  dingtalkLoginButton: document.getElementById("dingtalkLoginButton"),
  loginStatusText: document.getElementById("loginStatusText"),
  accountAvatarText: document.getElementById("accountAvatarText"),
  accountAvatarImage: document.getElementById("accountAvatarImage"),
  accountName: document.getElementById("accountName"),
  accountSubtitle: document.getElementById("accountSubtitle"),
  taskConfirmModal: document.getElementById("taskConfirmModal"),
  taskConfirmTitle: document.getElementById("taskConfirmTitle"),
  taskConfirmText: document.getElementById("taskConfirmText"),
  taskConfirmButton: document.getElementById("taskConfirmButton"),
  taskConfirmCancelButton: document.getElementById("taskConfirmCancelButton"),
  computerOperationModal: document.getElementById("computerOperationModal"),
  computerOperationTitle: document.getElementById("computerOperationTitle"),
  computerOperationDescription: document.getElementById("coversation_task"),
  computerOperationLabel: document.getElementById("computer_yourskill_task,confirmcancelButton"),
  computerOperationCancelButton: document.getElementById("computerOperationorderbutton_task"),

  computerOperationConfirmModal: document.getElementById("computerOperationConfirmModal"),
  computerOperationConfirmLabel: document.getElementById("computerOperationConfirmLabel"),
  computerOperationConfirmTitle: document.getElementById("computerOperationConfirmTitle"),
  computerOperationConfirmDescription: document.getElementById("computerOperationConfirmDescription"),
  computerOperationTargetRow: document.getElementById("computerOperationTargetRow"),
  computerOperationConfirmTarget: document.getElementById("computerOperationConfirmTarget"),
  computerOperationCommandRow: document.getElementById("computerOperationCommandRow"),
  computerOperationCommandLabel: document.getElementById("computerOperationCommandLabel"),
  computerOperationConfirmCommand: document.getElementById("computerOperationConfirmCommand"),
  conversationDeleteModal: document.getElementById("conversationDeleteModal"),
  conversationDeleteText: document.getElementById("conversationDeleteText"),
  artifactPreviewModal: document.getElementById("artifactPreviewModal"),
  artifactPreviewTitle: document.getElementById("artifactPreviewTitle"),
  artifactPreviewContent: document.getElementById("artifactPreviewContent"),
  artifactCopyButton: document.getElementById("artifactCopyButton"),
  artifactDownloadButton: document.getElementById("artifactDownloadButton"),
  skillImportModal: document.getElementById("skillImportModal"),
  skillDropZone: document.getElementById("skillDropZone"),
  skillAutoInstallSafe: document.getElementById("skillAutoInstallSafe"),
  skillImportDetails: document.getElementById("skillImportDetails"),
  skillImportStatus: document.getElementById("skillImportStatus"),
  skillImportInstallButton: document.getElementById("skillImportInstallButton"),
  installedSkillEditModal: document.getElementById("installedSkillEditModal"),
  installedSkillEditForm: document.getElementById("installedSkillEditForm"),
  installedSkillEditName: document.getElementById("installedSkillEditName"),
  installedSkillEditDescription: document.getElementById("installedSkillEditDescription"),
  installedSkillEditCategory: document.getElementById("installedSkillEditCategory"),
  installedSkillTagEditor: document.getElementById("installedSkillTagEditor"),
  installedSkillEditInstructions: document.getElementById("installedSkillEditInstructions"),
  installedSkillEditStatus: document.getElementById("installedSkillEditStatus"),
  installedSkillEditSaveButton: document.getElementById("installedSkillEditSaveButton"),
  skillActionConfirmModal: document.getElementById("skillActionConfirmModal"),
  skillActionConfirmTitle: document.getElementById("skillActionConfirmTitle"),
  skillActionConfirmText: document.getElementById("skillActionConfirmText"),
  skillActionConfirmButton: document.getElementById("skillActionConfirmButton"),
  onlineSkillsModal: document.getElementById("onlineSkillsModal"),
  onlineSkillSearchForm: document.getElementById("onlineSkillSearchForm"),
  onlineSkillSearchInput: document.getElementById("onlineSkillSearchInput"),
  onlineSkillStatus: document.getElementById("onlineSkillStatus"),
  onlineSkillResults: document.getElementById("onlineSkillResults"),
  skillInstallConfirmModal: document.getElementById("skillInstallConfirmModal"),
  skillInstallConfirmTitle: document.getElementById("skillInstallConfirmTitle"),
  skillInstallConfirmText: document.getElementById("skillInstallConfirmText"),
  skillInstallRiskList: document.getElementById("skillInstallRiskList"),
  skillInstallConfirmCheck: document.getElementById("skillInstallConfirmCheck"),
  skillInstallConfirmLabel: document.getElementById("skillInstallConfirmLabel"),
  skillInstallConfirmButton: document.getElementById("skillInstallConfirmButton"),
  toast: document.getElementById("toast"),
  autoLogin: document.getElementById("autoLogin")
};

const defaultConfig = {
  model: "gpt-5.6-luna",
  modelSelectionExplicit: false,
  mockWithoutKey: false,
  autoLogin: true
};

const meetingMinutesSkillPrompt = [
  "当前固定技能是“东哥会议模型”，负责把会议转写、录音、笔记、PDF、PPT、截图或混合材料蒸馏成可追溯、可执行、可复用的组织知识资产。",
  "默认按 B 级会议执行；战略、经营、重大组织调整、核心方法论或数字员工主题自动提升为 A 级。用户要求快速纪要时输出精简版本。",
  "必须区分事实、决策、观点、推断和待确认信息，保留重要分歧；不得猜测人名、日期、数字、负责人和结论。",
  "输出必须包含一句话判断、核心矛盾、决策地图、任务安排、风险与回退、待确认事项；任务缺少 DRI、时间或验收标准时保持待确认。",
  "完整技能规范和《先马会议蒸馏与组织知识资产化系统 V4.0》由客户端主进程在调用时自动注入。"
].join("\n");

const builtInSkills = [
  {
    id: "meeting",
    name: "东哥会议模型",
    shortName: "会议模型",
    icon: "clipboard-list",
    category: "办公效率",
    categoryId: "office-collaboration",
    tagIds: ["meeting", "summary"],
    sourceType: "BUILT_IN",
    description: "蒸馏会议材料，提炼核心矛盾、决策、任务、风险与组织知识资产。",
    starter: "使用东哥会议模型蒸馏这次会议，输出一句话判断、决策地图、任务安排和待确认事项。",
    systemPrompt: meetingMinutesSkillPrompt,
    fields: [
      { id: "content", label: "输入内容", type: "textarea", placeholder: "粘贴会议转写、笔记或群聊记录，也可以选择录音、PDF、PPT、截图等附件。" },
      { id: "focus", label: "输出重点", type: "multi", options: ["执行摘要", "一句话判断", "决策地图", "任务安排", "风险与回退", "待确认事项"], value: ["执行摘要", "一句话判断", "决策地图", "任务安排", "风险与回退", "待确认事项"], readonly: true },
      { id: "format", label: "输出格式", type: "single", options: ["Word（DOCX）", "PowerPoint（PPTX）", "PDF", "Markdown（MD）", "纯文本（TXT）"], value: "Word（DOCX）" },
      { id: "extra", label: "补充说明", type: "textarea", placeholder: "例如：按 A 级深度蒸馏，重点保留分歧、方法卡和任务验收标准。" }
    ]
  },
  {
    id: "browser",
    name: "浏览器操作",
    shortName: "浏览器",
    icon: "globe",
    category: "办公效率",
    categoryId: "efficiency-tools",
    tagIds: ["automation"],
    sourceType: "BUILT_IN",
    description: "根据你的要求打开网页，并完成点击、输入、选择、下载和内容读取。",
    starter: "打开浏览器并帮我完成这个网页任务：",
    systemPrompt: "当前技能是浏览器操作。理解用户的网页任务，复用客户端现有浏览器与工具能力完成打开网页、点击、输入、选择、下载和读取内容。不要虚构网页结果；涉及发送、提交、发布或其他外部影响时，遵循客户端现有确认规则。",
    fields: [
      { id: "task", label: "浏览器任务", type: "textarea", placeholder: "例如：打开指定网站，搜索相关内容并整理结果。" },
      { id: "url", label: "网页地址（选填）", type: "textarea", placeholder: "可填写完整网页地址，也可以只描述要打开的网站。" },
      { id: "extra", label: "补充要求（选填）", type: "textarea", placeholder: "例如：只读取内容，不提交表单。" }
    ]
  },
  {
    id: "weekly",
    name: "日报 / 周报生成",
    shortName: "周报",
    icon: "file-text",
    category: "办公效率",
    categoryId: "office-collaboration",
    tagIds: ["document", "summary"],
    sourceType: "BUILT_IN",
    description: "选定时间范围，自动整理内容并按模板排版输出。",
    starter: "帮我整理一份本周工作周报，包含本周完成、风险问题和下周计划。",
    systemPrompt: "当前技能是日报/周报生成。优先输出结构化日报或周报，包含完成事项、进行中事项、风险问题、下步计划。",
    fields: [
      { id: "range", label: "时间范围", type: "single", options: ["今日", "本周", "自定义"], value: "本周" },
      { id: "source", label: "内容附件（选填）", type: "file", hint: "可选择已有日报、记录或其他素材；不选择也可以生成" },
      { id: "format", label: "输出格式", type: "single", options: ["Word", "纯文本"], value: "Word" },
      { id: "tone", label: "语气风格", type: "single", options: ["简洁", "详细"], value: "简洁" },
      { id: "extra", label: "附加说明", type: "textarea", placeholder: "直接填写今日或本周做了什么、当前进展、问题和下一步计划。" }
    ]
  },
  {
    id: "image",
    name: "P图 / 图片处理",
    shortName: "图片",
    icon: "image",
    category: "图片处理",
    categoryId: "efficiency-tools",
    tagIds: ["image", "batch"],
    sourceType: "BUILT_IN",
    description: "批量去背景、加水印、调整尺寸或转换格式。",
    starter: "我想批量处理一组图片，请先帮我整理处理规则和输出要求。",
    systemPrompt: "当前技能是图片处理。先明确输入图片、处理类型、尺寸、格式、质量和输出目录；如用户要求文生图，可直接调用图片生成能力。",
    fields: [
      { id: "images", label: "选择图片", type: "file", hint: "点击选择图片，支持多选" },
      { id: "actions", label: "处理类型", type: "multi", options: ["去背景", "调整尺寸", "加水印", "格式转换"], value: ["去背景"] },
      { id: "format", label: "输出格式", type: "multi", options: ["PNG", "JPG"], value: ["PNG"] },
      { id: "output", label: "输出位置", type: "file", hint: "点击选择保存文件夹" },
      { id: "extra", label: "补充说明", type: "textarea", placeholder: "例如：白底产品图、宽度 1200px、保留透明背景。" }
    ]
  },
  {
    id: "copywriting",
    name: "文案润色 / 改写",
    shortName: "文案",
    icon: "pen-line",
    category: "内容创作",
    categoryId: "content-creation",
    tagIds: ["copywriting", "commerce"],
    sourceType: "BUILT_IN",
    description: "调整语气、精简或扩写一段文字。",
    starter: "帮我把这段内容润色成更适合公司内部沟通的版本：",
    systemPrompt: "当前技能是文案润色/改写。保留事实，优化表达，必要时给出正式版、简洁版和改动说明。",
    fields: [
      { id: "content", label: "输入内容", type: "textarea", placeholder: "粘贴要润色的文字，也可以点击右下角选择文件。" },
      { id: "tone", label: "目标语气", type: "multi", options: ["正式", "口语化", "精炼", "生动"], value: ["正式"] },
      { id: "length", label: "目标长度", type: "multi", options: ["保持原长", "精简", "扩写"], value: ["保持原长"] }
    ]
  },
  {
    id: "documents",
    name: "多格式文档生成",
    shortName: "文档",
    icon: "file-stack",
    category: "办公效率",
    categoryId: "office-collaboration",
    tagIds: ["document", "summary"],
    sourceType: "BUILT_IN",
    description: "在技能页面直接生成 Word、PPT、Excel、PDF、开放文档及常见文本格式。",
    starter: "生成一份项目汇报文档，可导出 Word、PPT、Excel 或 PDF。",
    systemPrompt: "当前技能是多格式文档生成。只使用用户提供的素材生成真实内容，不得编造事实；按用户选择的文件格式组织标题、段落、列表和表格。",
    fields: [
      { id: "title", label: "文档标题", type: "textarea", placeholder: "例如：2026年第三季度项目汇报" },
      { id: "content", label: "文档内容", type: "textarea", placeholder: "填写要生成或整理的正文、提纲、数据和要求。支持 Markdown 标题、列表和表格。" },
      { id: "source", label: "内容附件（选填）", type: "file", hint: "可选择 Word、Excel、PDF、TXT 等素材" },
      { id: "format", label: "输出格式", type: "single", options: ["Word（DOCX）", "PowerPoint（PPTX）", "Excel（XLSX）", "PDF", "OpenDocument（ODT）", "表格（ODS）", "演示（ODP）", "网页（HTML）", "Markdown（MD）", "纯文本（TXT）", "CSV", "JSON", "XML", "RTF", "ZIP"], value: "Word（DOCX）" },
      { id: "style", label: "排版风格", type: "single", options: ["简洁正式", "汇报风格", "数据清晰", "图文优先"], value: "简洁正式" },
      { id: "extra", label: "补充说明（选填）", type: "textarea", placeholder: "例如：分成背景、进展、问题、计划四部分；PPT 每页一个重点。" }
    ]
  }
];

let skills = [...builtInSkills];

const starterLabels = {
  browser: "使用浏览器完成网页任务",
  weekly: "生成本周周报",
  image: "帮我把这批图片去背景",
  copywriting: "润色一段文案，语气更正式一点",
  meeting: "使用东哥会议模型蒸馏会议",
  documents: "生成一份多格式项目文档"
};

const skillScenarios = {
  weekly: {
    userMsg: "帮我生成本周周报",
    historyTitle: "本周周报生成",
    steps: ["正在读取内容来源…", "正在按模板整理周报格式…", "检测到同名文件，等待确认…"],
    needsConfirm: true,
    confirmTitle: "检测到同名文件，是否覆盖?",
    confirmText: "文件目录中已存在「本周周报.docx」，继续执行将覆盖原文件内容，此操作无法撤销。",
    afterConfirmSteps: ["正在生成文档…"],
    resultTitle: "本周周报.docx 已生成",
    resultBody: "已整理本周工作内容，共 3 个板块 · 12 条要点，文档已保存至本地文件目录。",
    resultType: "document",
    downloadLabel: "下载为 Word"
  },
  image: {
    userMsg: "帮我把这批图片去背景",
    historyTitle: "产品图批量去背景",
    steps: ["正在读取图片…", "正在去除背景…", "正在导出结果…"],
    needsConfirm: false,
    resultTitle: "图片处理已完成",
    resultBody: "已处理 6 张图片，全部转为透明背景 PNG，可直接查看或下载。",
    resultType: "images",
    imageCount: 6
  },
  copywriting: {
    userMsg: "润色一段文案，语气更正式一点",
    historyTitle: "618活动文案润色",
    steps: ["正在读取原文…", "正在按目标语气润色…"],
    needsConfirm: false,
    resultTitle: "文案润色已完成",
    resultBody: "已将原文调整为更正式的语气，长度与原文基本一致。可直接选中下方文字复制，或点“复制全文”。",
    resultType: "text",
    resultText: "尊敬的各位客户：\n\n值此 618 年中大促之际，我们谨向长期以来给予支持与信赖的您致以诚挚感谢。本次活动我们精选全场热销商品，推出满减、折扣与赠品等多重优惠，力求以更具诚意的价格回馈每一位客户。\n\n活动期间下单还可享受优先发货与专属客服服务，让您的每一次购物都安心、省心。期待与您在 618 相见，共享品质好物。"
  },
  meeting: {
    userMsg: "使用东哥会议模型蒸馏今天的会议",
    historyTitle: "周会会议蒸馏",
    steps: ["正在识别会议材料…", "正在提炼一句话判断与决策地图…", "正在整理任务、风险和待确认事项…"],
    needsConfirm: false,
    resultTitle: "会议蒸馏已完成",
    resultBody: "已按东哥会议模型生成结构化会议蒸馏结果。",
    resultType: "document",
    downloadLabel: "下载文件"
  }
};

const forceAuthPreview = !window.desktopBridge && new URLSearchParams(window.location.search).has("auth");
const initialSession = window.desktopBridge || forceAuthPreview
  ? null
  : { userId: "browser-preview", name: "演示用户", method: "preview", loginAt: new Date().toISOString() };
const state = loadState(initialSession?.userId || "anonymous", initialSession);
let desktopUpdateStatus = {
  supported: null,
  displayVersion: "2.0.0",
  internalVersion: "",
  autoCheckEnabled: true,
  status: "loading",
  lastCheckedAt: "",
  availableDisplayVersion: "",
  availableRelease: null,
  updateHistory: []
};
let updateCheckBusy = false;
const pendingChatStreams = new Map();
const pendingConversationRequests = new Map();
const pendingTaskPersistence = new Map();
let sessionGeneration = 0;
let streamRenderQueued = false;
let openConversationMenuId = null;
let renamingConversationId = null;
let deletingConversationId = null;
let currentArtifactPreview = null;
let artifactImagePreviewState = null;
let pendingArtifactOutput = null;
let automationEditorDraft = null;
let automationPickerState = { open: "", query: "" };
let composerSkillQuery = "";
let localSkillImport = {
  step: 1,
  source: "folder",
  sourcePath: "",
  reference: "",
  inspection: null,
  loading: false,
  installing: false,
  error: "",
  acknowledgeRisk: false,
  replace: false,
  displayName: "",
  description: "",
  categoryId: "",
  tags: [],
  tagQuery: "",
  instructions: "",
  installedSkillId: "",
  returnView: "skills"
};
let onlineSkillLibrary = { query: "", results: [], filteredCount: 0, preflightPendingCount: 0, loading: false, error: "", loaded: false };
const onlineSkillInstallRefs = new Set();
let pendingOnlineSkillConfirmation = null;
let companySkillState = { catalog: [], revokedSkillIds: [], submissions: [], loading: false, error: "", loaded: false, progress: null };
const PROMPT_LIBRARY_FAVORITES_KEY = "xmai.prompt-library.favorites.v1";
const promptLibraryCategories = [
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
let promptLibraryState = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  query: "",
  category: "all",
  scope: "all",
  loading: false,
  loaded: false,
  error: "",
  requestVersion: 0,
  activePrompt: null,
  argumentValues: {},
  favorites: new Map(),
  favoriteOwner: ""
};
let promptLibrarySearchTimer = null;
const fallbackSkillCategories = [
  ["office-collaboration", "办公协同"], ["efficiency-tools", "效率工具"], ["content-creation", "内容创作"],
  ["data-analysis", "数据分析"], ["business-operations", "商业运营"], ["development-tools", "开发工具"],
  ["information", "信息资讯"], ["education", "教育学习"], ["web-deployment", "网站部署"],
  ["lifestyle", "生活服务"], ["knowledge-management", "知识管理"]
].map(([categoryId, name], index) => ({ categoryId, name, status: "ENABLED", sortOrder: (index + 1) * 10 }));
const fallbackSkillTags = [
  ["document", "文档"], ["summary", "总结"], ["image", "图片"], ["batch", "批处理"],
  ["copywriting", "文案"], ["commerce", "电商"], ["meeting", "会议"], ["table", "表格"],
  ["review", "评论"], ["insight", "洞察"], ["browser", "浏览器"], ["automation", "自动化"]
].map(([tagId, name]) => ({ tagId, name, status: "ENABLED" }));
let skillLibraryState = {
  tab: "all",
  categoryId: "all",
  categoryScrollLeft: 0,
  categories: fallbackSkillCategories,
  tags: fallbackSkillTags,
  taxonomyLoaded: false,
  taxonomyError: ""
};
let skillPageSearchComposing = false;
let installedSkillEditor = { skillId: "", tags: [], tagQuery: "", saving: false, error: "" };
let pendingSkillAction = null;
let companySkillSubmission = { sourcePath: "", inspection: null, importDraft: null, loading: false, submitting: false, error: "", normalizationNote: "" };
let companySkillSyncTimer = null;
let skillTaxonomySyncTimer = null;
let companySkillDraft = {
  name: "",
  version: "1.0.0",
  displayName: "",
  description: "",
  category: "效率工具",
  categoryId: "efficiency-tools",
  starter: "",
  icon: "sparkles",
  applicable: "",
  inputs: "",
  outputRequirements: "",
  steps: "",
  boundaries: "",
  exceptions: "",
  example: "",
  supportedInputs: "text, image, document",
  outputs: "markdown, docx",
  permissions: "",
  dependencies: ""
};
const companySkillExampleDraft = {
  name: "project-weekly-report",
  version: "1.0.0",
  displayName: "项目周报整理",
  description: "根据员工提供的工作记录，整理成结构清晰、可直接提交的项目周报。",
  category: "效率工具",
  categoryId: "efficiency-tools",
  starter: "请把以下工作内容整理成项目周报：完成登录页改版；修复文档下载问题；下周准备接口联调。",
  icon: "file-text",
  applicable: "当用户提供本周工作记录，希望生成个人周报或项目周报时使用。不用于编写没有事实材料的工作成果。",
  inputs: "必填：本周做了什么。可选：遇到的问题、下周计划、负责人、日期，以及相关文档或表格附件。附件不是必填项。",
  outputRequirements: "输出中文周报，固定包含“本周完成”“问题与风险”“下周计划”三个部分。合并重复事项，语言简洁；用户需要时同时生成 DOCX 文件。",
  steps: "1. 读取用户输入和附件。\n2. 提取完成事项、问题风险和下周计划。\n3. 合并重复内容，按三个固定部分排版。\n4. 检查是否存在编造内容，再输出周报。",
  boundaries: "只能根据用户提供的信息整理，不得编造数据、进度、负责人或完成结果。信息不确定时标记“待确认”。",
  exceptions: "没有附件时直接根据文字生成；工作内容为空时，请用户至少补充一项完成事项；个别附件无法读取时说明文件名，并继续处理其他可用内容。",
  example: "用户输入：\n本周完成登录页改版，修复文档下载失败；图片生成速度仍需优化；下周准备接口联调。\n\n预期结果：\n本周完成\n1. 完成登录页改版。\n2. 修复文档下载失败问题。\n\n问题与风险\n1. 图片生成速度仍需优化。\n\n下周计划\n1. 开展接口联调。",
  supportedInputs: "text, document, image",
  outputs: "markdown, docx",
  permissions: "",
  dependencies: ""
};
const pendingComputerOperationConfirmations = [];
let currentComputerOperationConfirmation = null;

function getStorageKey(userId) {
  return `${STORAGE_KEY}:${String(userId || "anonymous")}`;
}

function loadState(userId = "anonymous", sessionOverride = null) {
  const saved = parseJson(localStorage.getItem(getStorageKey(userId))) || (userId === "anonymous" ? parseJson(localStorage.getItem(STORAGE_KEY)) : null);
  const legacyConfig = parseJson(localStorage.getItem("centaur.config"));
  const legacyClientConfig = safeClientConfig(legacyConfig);
  const savedClientConfig = safeClientConfig(saved?.config);
  const config = {
    ...defaultConfig,
    ...legacyClientConfig,
    ...savedClientConfig
  };
  if (["gpt-5.6-sol", "gpt-5.6"].includes(config.model) && legacyClientConfig.modelSelectionExplicit !== true && savedClientConfig.modelSelectionExplicit !== true) {
    config.model = "gpt-5.6-luna";
  }

  const conversations = Array.isArray(saved?.conversations) && saved.conversations.length
    ? saved.conversations.map(sanitizeConversation)
    : [createConversation("新的对话")];
  const activeConversationId = saved?.activeConversationId || conversations[0].id;
  const legacySkillId = saved?.activeSkillId || null;
  const legacyConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  if (saved?.skillBindingVersion !== SKILL_BINDING_VERSION) {
    // Version 3 could bind a skill merely by opening its skill-page form.
    // Clear legacy bindings; users can explicitly select a skill again in chat.
    conversations.forEach((conversation) => { conversation.skillId = null; });
  }

  const migrated = saved?.skillBindingVersion !== SKILL_BINDING_VERSION;
  return {
    session: sessionOverride || null,
    authReady: Boolean(sessionOverride),
    authStatus: {
      configured: !window.desktopBridge,
      mode: window.desktopBridge ? "unknown" : "preview",
      message: window.desktopBridge ? "正在检查钉钉登录状态..." : "浏览器预览模式"
    },
    config,
    conversations,
    activeConversationId,
    activeSkillId: legacyConversation?.skillId || null,
    activeView: migrated ? "chat" : (saved?.activeView === "workspace" ? "chat" : (saved?.activeView || "chat")),
    searchQuery: saved?.searchQuery || "",
    taskResult: migrated ? null : (saved?.taskResult || null),
    scheduledTasks: [],
    taskRuns: [],
    modelOptions: [],
    workspace: null,
    selectedFiles: []
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function scrubInternalTerms(value) {
  const sourceNamePattern = new RegExp(["open", "claw"].join(""), "gi");
  return String(value ?? "")
    .replace(/^\s*(?:Uncaught\s+\(in promise\)\s*)?Error invoking remote method ['"]desktop:[^'"]+['"]:\s*(?:Error:\s*)?/i, "")
    .replace(/^\s*Error:\s*/i, "")
    .replace(/desktop:[a-z0-9:_-]+/gi, "客户端功能")
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+\\AppData\\[^\r\n"']+/gi, "本地应用数据")
    .replace(sourceNamePattern, "XMAI Studio")
    .replace(/\u7f51\u9875\u7aef/g, "应用服务")
    .replace(/\u5bf9\u8bdd\u5305\u88c5/g, "对话服务")
    .replace(/\u5305\u88c5\u5c42/g, "服务层");
}

function isGenerationStoppedError(error) {
  return /已停止生成|generation[_ -]?stopped|aborted|cancelled/i.test(String(error?.message || error || ""));
}

const richTextAllowedTags = new Set([
  "A", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3", "H4",
  "HR", "LI", "OL", "P", "PRE", "STRONG", "TABLE", "TBODY", "TD", "TH",
  "THEAD", "TR", "UL"
]);

function sanitizeRichTextHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const blockedTags = new Set(["EMBED", "FORM", "IFRAME", "OBJECT", "SCRIPT", "STYLE", "SVG", "MATH"]);

  [...template.content.querySelectorAll("*")].forEach((element) => {
    const tag = element.tagName;
    if (blockedTags.has(tag)) {
      element.remove();
      return;
    }
    if (tag === "IMG") {
      element.replaceWith(document.createTextNode(element.getAttribute("alt") || "图片"));
      return;
    }
    if (tag === "INPUT" && element.getAttribute("type") === "checkbox") {
      element.replaceWith(document.createTextNode(element.hasAttribute("checked") ? "已完成 " : "待完成 "));
      return;
    }
    if (!richTextAllowedTags.has(tag)) {
      element.replaceWith(...element.childNodes);
      return;
    }

    const href = tag === "A" ? String(element.getAttribute("href") || "").trim() : "";
    const title = tag === "A" ? String(element.getAttribute("title") || "").trim() : "";
    [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
    if (tag === "A" && /^(https?:|mailto:|#)/i.test(href)) {
      element.setAttribute("href", href);
      if (title) element.setAttribute("title", title);
      if (!href.startsWith("#")) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noreferrer noopener");
      }
    }
  });

  const textWalker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    if (!textNode.parentElement?.closest("code, pre")) {
      textNode.textContent = String(textNode.textContent || "")
        .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
        .replace(/[*_]{2,3}/g, "")
        .replace(/(^|\n)\s*[*_]\s+(?=\S)/g, "$1");
    }
    textNode = textWalker.nextNode();
  }

  return template.innerHTML;
}

function renderRichText(value) {
  const text = scrubInternalTerms(value).replace(/^\uFEFF/, "");
  if (!text) return "";
  if (!window.marked?.parse) return escapeHtml(text).replace(/\n/g, "<br>");
  try {
    return sanitizeRichTextHtml(window.marked.parse(text, { gfm: true, breaks: true }));
  } catch {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
}

function sanitizeMessageFiles(files) {
  if (!Array.isArray(files)) return [];
  const normalizedFiles = files.map((file) => {
    const absolutePath = String(file?.absolutePath || file?.path || "").trim();
    if (!absolutePath) return null;
    const inferredExtension = absolutePath.match(/\.([^./\\]+)$/)?.[1] || "";
    return {
      name: String(file?.name || baseName(absolutePath)),
      path: absolutePath,
      absolutePath,
      relativePath: String(file?.relativePath || ""),
      extension: String(file?.extension || inferredExtension).replace(/^\./, "").toLowerCase(),
      kind: String(file?.kind || "file"),
      bytes: Number(file?.bytes || 0),
      modifiedAtMs: Number(file?.modifiedAtMs || 0)
    };
  }).filter(Boolean);

  if (!normalizedFiles.some((file) => file.extension === "docx")) return normalizedFiles;
  return normalizedFiles.filter((file) => file.extension !== "py");
}

function sanitizeConversation(conversation) {
  if (!conversation || typeof conversation !== "object") {
    return createConversation("新的对话");
  }

  return {
    ...conversation,
    skillId: typeof conversation.skillId === "string" ? conversation.skillId : null,
    title: scrubInternalTerms(conversation.title || "新的对话"),
    customTitle: conversation.customTitle === true,
    pinned: conversation.pinned === true,
    pinnedAt: conversation.pinnedAt || null,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) => ({
        ...message,
        content: scrubInternalTerms(message.content),
        files: sanitizeMessageFiles(message.files),
        attachments: sanitizeAttachmentItems(message.attachments)
      }))
      : []
  };
}

function sanitizeAttachmentItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const absolutePath = String(item?.absolutePath || item?.path || "").trim();
    if (!absolutePath) return null;
    return {
      name: String(item?.name || baseName(absolutePath)),
      path: absolutePath,
      absolutePath,
      extension: String(item?.extension || absolutePath.match(/\.([^./\\]+)$/)?.[1] || "").replace(/^\./, "").toLowerCase(),
      kind: String(item?.kind || "file"),
      bytes: Number(item?.bytes || 0),
      mimeType: String(item?.mimeType || "application/octet-stream"),
      previewDataUrl: String(item?.previewDataUrl || "")
    };
  }).filter(Boolean);
}

function safeClientConfig(config) {
  if (!config || typeof config !== "object") {
    return {};
  }

  return {
    model: typeof config.model === "string" ? config.model : undefined,
    modelSelectionExplicit: typeof config.modelSelectionExplicit === "boolean" ? config.modelSelectionExplicit : undefined,
    mockWithoutKey: typeof config.mockWithoutKey === "boolean" ? config.mockWithoutKey : undefined,
    autoLogin: typeof config.autoLogin === "boolean" ? config.autoLogin : undefined
  };
}

function saveState() {
  const safeConfig = safeClientConfig(state.config);
  const storedConversations = state.conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachments: sanitizeAttachmentItems(message.attachments).map(({ previewDataUrl, ...attachment }) => attachment)
    }))
  }));
  const payload = {
    config: safeConfig,
    skillBindingVersion: SKILL_BINDING_VERSION,
    conversations: storedConversations,
    activeConversationId: state.activeConversationId,
    // Keep the legacy field for older builds, but the conversation is the source of truth.
    activeSkillId: activeConversation()?.skillId || null,
    activeView: state.activeView,
    searchQuery: state.searchQuery,
    taskResult: state.taskResult
  };
  const userId = state.session?.userId || "anonymous";
  localStorage.setItem(getStorageKey(userId), JSON.stringify(payload));
  localStorage.removeItem(GLOBAL_SESSION_KEY);
  localStorage.setItem("centaur.config", JSON.stringify(safeConfig));
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createConversation(title) {
  const now = new Date().toISOString();
  return {
    id: createId("chat"),
    title,
    customTitle: false,
    pinned: false,
    pinnedAt: null,
    createdAt: now,
    updatedAt: now,
    skillId: null,
    messages: []
  };
}

function activeConversation() {
  let conversation = state.conversations.find((item) => item.id === state.activeConversationId);
  if (!conversation) {
    conversation = state.conversations[0] || createConversation("新的对话");
    if (!state.conversations.length) state.conversations.push(conversation);
    state.activeConversationId = conversation.id;
  }
  return conversation;
}

function activeSkill() {
  const skillId = activeConversation()?.skillId || null;
  return skills.find((skill) => skill.id === skillId) || null;
}

async function refreshInstalledSkills() {
  if (!window.desktopBridge?.getInstalledSkills) return;
  try {
    const result = await window.desktopBridge.getInstalledSkills({ userId: state.session?.userId || "local-user" });
    const installed = Array.isArray(result?.skills) ? result.skills : [];
    const builtInIds = new Set(builtInSkills.map((skill) => skill.id));
    skills = [...builtInSkills, ...installed.filter((skill) => skill?.id && !builtInIds.has(skill.id))];
    state.conversations.forEach((conversation) => {
      if (conversation.skillId && !skills.some((skill) => skill.id === conversation.skillId)) conversation.skillId = null;
    });
    state.activeSkillId = activeConversation()?.skillId || null;
    render();
  } catch (error) {
    showToast(error.message || "已安装技能读取失败");
  }
}

function render() {
  renderNavState();
  renderConversationList();
  renderActiveView();
  renderLoginState();
  renderModelPicker();
  renderComposerSkillMenu();
  renderComposerState();
}

function renderNavState() {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const nav = button.dataset.nav;
    const isActive = nav === "chat"
      ? state.activeView === "chat"
      : (state.activeView === nav
        || (nav === "skills" && (
          state.activeView === "skill-import"
          || state.activeView.startsWith("skill-form:")
          || state.activeView.startsWith("skill-detail:")
          || state.activeView.startsWith("company-skill-")
          || state.activeView === "company-skills"
        ))
        || (nav === "scheduled" && state.activeView === "automation-editor"));
    button.classList.toggle("active", isActive);
  });
}

function renderActiveView() {
  const isChat = state.activeView === "chat";
  els.chatView.classList.toggle("hidden", !isChat);
  els.chatView.classList.toggle("empty-chat", isChat && !activeConversation().messages.length);
  els.pageView.classList.toggle("hidden", isChat);

  if (isChat) {
    renderHeader();
    renderMessages();
    renderStarterGrid();
    renderContextBar();
    renderAttachmentBar();
    return;
  }

  renderPageView();
}

function renderConversationList() {
  const conversations = [...state.conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const pinnedOrder = new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0);
      if (pinnedOrder) return pinnedOrder;
    }
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  els.conversationList.innerHTML = conversations.map((conversation) => {
    const pending = pendingConversationRequests.get(conversation.id);
    const busy = Boolean(pending);
    const lastMessage = conversation.messages.at(-1);
    const meta = pending?.stopping ? "正在停止..." : (busy ? "正在处理..." : (lastMessage ? previewText(lastMessage.content) : "还没有消息"));
    const active = conversation.id === state.activeConversationId;
    const renaming = conversation.id === renamingConversationId;
    const menuOpen = conversation.id === openConversationMenuId;
    return `
      <div class="conversation-row ${active ? "active" : ""} ${busy ? "busy" : ""} ${menuOpen ? "menu-open" : ""}" data-conversation-row="${escapeHtml(conversation.id)}">
        ${renaming ? `
          <div class="conversation-rename">
            <input type="text" maxlength="80" value="${escapeHtml(conversation.title)}" data-conversation-rename-input="${escapeHtml(conversation.id)}" aria-label="新的对话名称">
            <button type="button" data-conversation-rename-save="${escapeHtml(conversation.id)}" title="保存名称" aria-label="保存名称">${iconSvg("check")}</button>
            <button type="button" data-conversation-rename-cancel="${escapeHtml(conversation.id)}" title="取消重命名" aria-label="取消重命名">${iconSvg("x")}</button>
          </div>
        ` : `
          <button class="conversation-item ${active ? "active" : ""} ${busy ? "busy" : ""}" type="button" data-conversation="${escapeHtml(conversation.id)}">
            <span class="conversation-title-line">
              ${conversation.pinned ? `<span class="conversation-pin-indicator" title="已置顶" aria-label="已置顶">${iconSvg("pin")}</span>` : ""}
              <span class="conversation-title">${escapeHtml(conversation.title)}</span>
            </span>
            <span class="conversation-meta">${escapeHtml(meta)}</span>
          </button>
          <button class="conversation-menu-button" type="button" data-conversation-menu="${escapeHtml(conversation.id)}" title="对话操作" aria-label="对话操作" aria-expanded="${menuOpen}">${iconSvg("more-horizontal")}</button>
          ${menuOpen ? `
            <div class="conversation-menu" role="menu">
              <button type="button" role="menuitem" data-conversation-action="rename" data-conversation-id="${escapeHtml(conversation.id)}">${iconSvg("pen-line")}<span>重命名</span></button>
              <button type="button" role="menuitem" data-conversation-action="pin" data-conversation-id="${escapeHtml(conversation.id)}">${iconSvg(conversation.pinned ? "pin-off" : "pin")}<span>${conversation.pinned ? "取消置顶" : "置顶"}</span></button>
              <button class="danger" type="button" role="menuitem" data-conversation-action="delete" data-conversation-id="${escapeHtml(conversation.id)}">${iconSvg("trash-2")}<span>删除</span></button>
            </div>
          ` : ""}
        `}
      </div>
    `;
  }).join("");
}

function renderPageView() {
  if (state.activeView === "requirements") {
    els.pageContent.classList.add("requirement-host");
    window.XmaiRequirements.mount(els.pageContent, { owner: state.session?.userId, icon: iconSvg, api: async payload => { const result = await window.desktopBridge.requirementRequest(payload); if (result.error) throw Object.assign(new Error(result.error), { code: result.code }); return result.data; } });
    return;
  }
  els.pageContent.classList.remove("requirement-host");
  delete els.pageContent.dataset.requirementOwner;
  if (state.activeView === "prompt-library") {
    renderPromptLibraryPage();
    if (!promptLibraryState.loaded && !promptLibraryState.loading) queueMicrotask(() => {
      if (state.activeView === "prompt-library" && !promptLibraryState.loaded && !promptLibraryState.loading) loadPromptLibrary();
    });
    return;
  }

  if (state.activeView === "skills") {
    renderSkillsPage();
    return;
  }

  if (state.activeView === "skill-import") {
    renderSkillImportPage();
    return;
  }

  if (state.activeView.startsWith("skill-detail:")) {
    renderPersonalSkillDetailPage(state.activeView.replace("skill-detail:", ""));
    return;
  }

  if (state.activeView === "company-skill-create") {
    renderCompanySkillCreatePage();
    return;
  }

  if (state.activeView === "company-skill-submit") {
    renderCompanySkillSubmitPage();
    return;
  }

  if (state.activeView === "company-skills") {
    renderCompanySkillCatalogPage();
    return;
  }

  if (state.activeView === "company-skill-mine") {
    renderMyCompanySkillSubmissionsPage();
    return;
  }

  if (state.activeView === "search") {
    renderSearchPage();
    return;
  }

  if (state.activeView === "scheduled") {
    renderScheduledPage();
    return;
  }

  if (state.activeView === "automation-editor") {
    renderAutomationEditorPage();
    return;
  }

  if (state.activeView === "settings") {
    renderSettingsPage();
    return;
  }

  if (state.activeView.startsWith("skill-form:")) {
    renderSkillFormPage(state.activeView.replace("skill-form:", ""));
    return;
  }

  if (state.activeView === "task-result") {
    renderTaskResultPage();
    return;
  }

  state.activeView = "chat";
  renderActiveView();
}

function renderPageHeader(title, subtitle, action = "") {
  return `
    <div class="page-header">
      <div>
        ${action}
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </div>
  `;
}

function promptLibraryFavoriteStorageKey() {
  return `${PROMPT_LIBRARY_FAVORITES_KEY}:${String(state.session?.userId || "anonymous")}`;
}

function ensurePromptLibraryFavorites() {
  const owner = String(state.session?.userId || "anonymous");
  if (promptLibraryState.favoriteOwner === owner) return;
  const saved = parseJson(localStorage.getItem(promptLibraryFavoriteStorageKey()));
  const items = Array.isArray(saved) ? saved.filter((item) => item && typeof item === "object" && item.id) : [];
  promptLibraryState.favorites = new Map(items.map((item) => [String(item.id), item]));
  promptLibraryState.favoriteOwner = owner;
}

function savePromptLibraryFavorites() {
  ensurePromptLibraryFavorites();
  localStorage.setItem(promptLibraryFavoriteStorageKey(), JSON.stringify([...promptLibraryState.favorites.values()]));
}

function promptLibraryCleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function promptLibraryCategory(prompt) {
  const tags = Array.isArray(prompt?.tags) ? prompt.tags : [];
  return promptLibraryCategories.find((category) => category.id !== "all" && tags.includes(category.id))?.id
    || tags.find((tag) => tag && tag !== prompt?.image_model && tag !== "gpt-image-2")
    || prompt?.category
    || "灵感提示词";
}

function promptLibraryCategoryLabel(id) {
  return promptLibraryCategories.find((item) => item.id === id)?.label || id || "全部分类";
}

function promptLibraryVisual(prompt) {
  const category = promptLibraryCategory(prompt);
  if (/电商|产品/.test(category)) return { icon: "shopping-bag", tone: "red" };
  if (/社交|YouTube|视频/.test(category)) return { icon: "megaphone", tone: "blue" };
  if (/头像|个人/.test(category)) return { icon: "user-round", tone: "green" };
  if (/漫画|故事|游戏/.test(category)) return { icon: "sparkles", tone: "violet" };
  if (/信息图|教育/.test(category)) return { icon: "chart-no-axes-combined", tone: "amber" };
  return { icon: "wand-sparkles", tone: "blue" };
}

function promptLibraryFavoriteItems() {
  ensurePromptLibraryFavorites();
  const query = promptLibraryState.query.toLocaleLowerCase("zh-CN");
  return [...promptLibraryState.favorites.values()].filter((prompt) => {
    if (promptLibraryState.category !== "all" && promptLibraryCategory(prompt) !== promptLibraryState.category) return false;
    if (!query) return true;
    return [prompt.title, prompt.description, prompt.prompt, prompt.author, ...(Array.isArray(prompt.tags) ? prompt.tags : [])]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
  });
}

function promptLibraryVisibleItems() {
  if (promptLibraryState.scope !== "saved") return promptLibraryState.items;
  const favorites = promptLibraryFavoriteItems();
  const start = (promptLibraryState.page - 1) * promptLibraryState.pageSize;
  return favorites.slice(start, start + promptLibraryState.pageSize);
}

function promptLibraryVisibleTotal() {
  return promptLibraryState.scope === "saved" ? promptLibraryFavoriteItems().length : promptLibraryState.total;
}

function promptLibraryCard(prompt) {
  const id = String(prompt?.id || "");
  const saved = promptLibraryState.favorites.has(id);
  const visual = promptLibraryVisual(prompt);
  const category = promptLibraryCategory(prompt);
  const tags = (Array.isArray(prompt?.tags) ? prompt.tags : []).filter(Boolean).slice(0, 3);
  const description = promptLibraryCleanText(prompt?.description || prompt?.prompt || "打开查看完整提示词内容。");
  return `
    <article class="prompt-library-card" tabindex="0" data-prompt-library-id="${escapeHtml(id)}" aria-label="查看提示词：${escapeHtml(prompt?.title || "未命名提示词")}">
      <div class="prompt-library-card-top">
        <span class="prompt-library-card-icon ${visual.tone}">${iconSvg(visual.icon)}</span>
        <div class="prompt-library-card-heading">
          <h3>${escapeHtml(prompt?.title || "未命名提示词")}</h3>
          <span>${escapeHtml(promptLibraryCategoryLabel(category))}</span>
        </div>
        <button class="prompt-library-save ${saved ? "saved" : ""}" type="button" data-prompt-library-save="${escapeHtml(id)}" title="${saved ? "取消收藏" : "收藏"}" aria-label="${saved ? "取消收藏" : "收藏"}">${iconSvg("bookmark")}</button>
      </div>
      <p>${escapeHtml(description)}</p>
      <div class="prompt-library-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <footer>
        <span class="prompt-library-author">${iconSvg("user-round")}<span>${escapeHtml(prompt?.author || "公共提示词库")}</span></span>
        <button type="button" data-prompt-library-open="${escapeHtml(id)}"><span>查看</span>${iconSvg("arrow-up-right")}</button>
      </footer>
    </article>
  `;
}

function promptLibrarySkeletonCards() {
  return Array.from({ length: promptLibraryState.pageSize }, () => `
    <article class="prompt-library-card prompt-library-skeleton" aria-hidden="true">
      <div class="prompt-library-card-top"><span class="prompt-library-skeleton-circle"></span><span class="prompt-library-skeleton-copy"><i></i><i></i></span></div>
      <span class="prompt-library-skeleton-block"></span><span class="prompt-library-skeleton-line medium"></span><span class="prompt-library-skeleton-line short"></span>
    </article>
  `).join("");
}

function promptLibraryEmptyState() {
  const saved = promptLibraryState.scope === "saved";
  return `
    <div class="prompt-library-empty">
      <span>${iconSvg(saved ? "bookmark" : "search-x")}</span>
      <h3>${saved ? "还没有收藏提示词" : "没有找到匹配的提示词"}</h3>
      <p>${saved ? "在提示词卡片上点击收藏，稍后可以快速找到。" : "可以更换关键词、切换分类或重置筛选。"}</p>
      ${saved ? "" : '<button type="button" data-prompt-library-reset>重置筛选</button>'}
    </div>
  `;
}

function promptLibraryErrorState() {
  return `
    <div class="prompt-library-empty">
      <span>${iconSvg("wifi-off")}</span>
      <h3>公共提示词库暂时无法连接</h3>
      <p>${escapeHtml(promptLibraryState.error || "请检查网络后重新加载。")}</p>
      <button type="button" data-prompt-library-retry>重新加载</button>
    </div>
  `;
}

function promptLibraryPageNumbers(current, totalPages) {
  const values = new Set([1, totalPages, current - 1, current, current + 1]);
  const pages = [...values].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  let previous = 0;
  return pages.map((page) => {
    const separator = previous && page - previous > 1 ? '<span aria-hidden="true">...</span>' : "";
    previous = page;
    return `${separator}<button class="${page === current ? "active" : ""}" type="button" data-prompt-library-page="${page}" aria-current="${page === current ? "page" : "false"}">${page}</button>`;
  }).join("");
}

function promptLibraryPagination() {
  const total = promptLibraryVisibleTotal();
  const totalPages = Math.max(1, Math.ceil(total / promptLibraryState.pageSize));
  if (total <= promptLibraryState.pageSize) return "";
  return `
    <nav class="prompt-library-pagination" aria-label="分页">
      <button type="button" data-prompt-library-page="previous" ${promptLibraryState.page <= 1 ? "disabled" : ""}>${iconSvg("chevron-left")}<span>上一页</span></button>
      <span class="prompt-library-page-numbers">${promptLibraryPageNumbers(promptLibraryState.page, totalPages)}</span>
      <button type="button" data-prompt-library-page="next" ${promptLibraryState.page >= totalPages ? "disabled" : ""}><span>下一页</span>${iconSvg("chevron-right")}</button>
    </nav>
  `;
}

function promptLibraryArguments(promptText) {
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

function resolvedPromptLibraryPrompt(prompt) {
  return String(prompt?.prompt || "").replace(/\{argument\s+name="([^"]+)"(?:\s+default="([^"]*)")?\s*\}/g, (_all, name, defaultValue) => {
    return promptLibraryCleanText(promptLibraryState.argumentValues[name]) || defaultValue || `[${name}]`;
  });
}

function promptLibraryDetail() {
  const prompt = promptLibraryState.activePrompt;
  if (!prompt) return "";
  const argumentsList = promptLibraryArguments(prompt.prompt);
  const tags = (Array.isArray(prompt.tags) ? prompt.tags : []).filter(Boolean);
  const saved = promptLibraryState.favorites.has(String(prompt.id));
  return `
    <div class="prompt-library-detail-backdrop">
      <button class="prompt-library-detail-scrim" type="button" data-prompt-library-close aria-label="关闭提示词详情"></button>
      <aside class="prompt-library-detail" role="dialog" aria-modal="true" aria-labelledby="promptLibraryDetailTitle">
        <header>
          <div><span>${escapeHtml(promptLibraryCategoryLabel(promptLibraryCategory(prompt)))}</span><h2 id="promptLibraryDetailTitle">${escapeHtml(prompt.title || "提示词详情")}</h2></div>
          <button class="icon-button" type="button" data-prompt-library-close title="关闭" aria-label="关闭">${iconSvg("x")}</button>
        </header>
        <div class="prompt-library-detail-content">
          <section><h3>简介</h3><p>${escapeHtml(prompt.description || "该提示词暂未提供简介。")}</p></section>
          <section><dl>
            <div><dt>来源</dt><dd>${escapeHtml(prompt.source_name || "公共提示词库")}</dd></div>
            <div><dt>作者</dt><dd>${escapeHtml(prompt.author || "未署名")}</dd></div>
            <div><dt>适用模型</dt><dd>${escapeHtml(prompt.image_model || "通用")}</dd></div>
            <div><dt>收录时间</dt><dd>${escapeHtml(prompt.source_created_at || "未记录")}</dd></div>
          </dl></section>
          ${argumentsList.length ? `<section><h3>自定义内容</h3><div class="prompt-library-arguments">${argumentsList.map((item, index) => `
            <label><span>${escapeHtml(item.name)}</span><input id="prompt-library-argument-${index}" type="text" data-prompt-library-argument="${escapeHtml(item.name)}" value="${escapeHtml(promptLibraryState.argumentValues[item.name] ?? item.defaultValue)}"></label>
          `).join("")}</div></section>` : ""}
          <section><h3>提示词内容</h3><pre data-prompt-library-preview>${escapeHtml(resolvedPromptLibraryPrompt(prompt))}</pre></section>
          ${tags.length ? `<section><h3>标签</h3><div class="prompt-library-detail-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></section>` : ""}
        </div>
        <footer>
          <button class="secondary-button ${saved ? "saved" : ""}" type="button" data-prompt-library-detail-save>${iconSvg("bookmark")}<span>${saved ? "已收藏" : "收藏"}</span></button>
          <button class="secondary-button" type="button" data-prompt-library-copy>${iconSvg("copy")}<span>复制</span></button>
          <button class="primary-button" type="button" data-prompt-library-use>${iconSvg("arrow-up-right")}<span>使用此提示词</span></button>
        </footer>
      </aside>
    </div>
  `;
}

function updatePromptLibraryCategoryArrows() {
  const strip = els.pageContent?.querySelector("[data-prompt-library-category-strip]");
  if (!strip) return;
  const previous = els.pageContent.querySelector('[data-prompt-library-category-scroll="-1"]');
  const next = els.pageContent.querySelector('[data-prompt-library-category-scroll="1"]');
  if (previous) previous.disabled = strip.scrollLeft <= 2;
  if (next) next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
}

function renderPromptLibraryPage() {
  ensurePromptLibraryFavorites();
  const restoreSearch = document.activeElement?.matches?.("[data-prompt-library-search]");
  const selectionStart = restoreSearch ? document.activeElement.selectionStart : null;
  const items = promptLibraryVisibleItems();
  const total = promptLibraryVisibleTotal();
  const heading = promptLibraryState.scope === "saved"
    ? "我的收藏"
    : (promptLibraryState.category === "all" ? "全部提示词" : promptLibraryCategoryLabel(promptLibraryState.category));
  const meta = promptLibraryState.loading
    ? "正在读取公共提示词库"
    : (promptLibraryState.scope === "saved" ? `共 ${total.toLocaleString("zh-CN")} 条收藏` : `第 ${promptLibraryState.page} 页，共 ${total.toLocaleString("zh-CN")} 条`);
  const count = promptLibraryState.loading && !promptLibraryState.loaded ? "--" : total.toLocaleString("zh-CN");
  const showReset = Boolean(promptLibraryState.query || promptLibraryState.category !== "all" || promptLibraryState.scope !== "all");
  const grid = promptLibraryState.loading
    ? promptLibrarySkeletonCards()
    : (promptLibraryState.error ? promptLibraryErrorState() : (items.length ? items.map(promptLibraryCard).join("") : promptLibraryEmptyState()));

  els.pageContent.innerHTML = `
    <div class="prompt-library-page">
      <header class="prompt-library-header">
        <div><span>灵感与模板</span><h1>提示词库</h1><p>查找适合当前任务的提示词，按需修改后直接使用。</p></div>
        <div class="prompt-library-count"><strong>${count}</strong><span>条可用提示词</span></div>
      </header>
      <div class="prompt-library-toolbar" role="region" aria-label="提示词筛选">
        <label class="prompt-library-search">${iconSvg("search")}<input type="search" data-prompt-library-search value="${escapeHtml(promptLibraryState.query)}" placeholder="搜索标题、内容、标签或作者" autocomplete="off"><button class="${promptLibraryState.query ? "" : "hidden"}" type="button" data-prompt-library-clear title="清除搜索" aria-label="清除搜索">${iconSvg("x")}</button></label>
        <div class="prompt-library-view-actions">
          <div class="prompt-library-segmented" role="tablist" aria-label="提示词范围">
            <button class="${promptLibraryState.scope === "all" ? "active" : ""}" type="button" data-prompt-library-scope="all" role="tab" aria-selected="${promptLibraryState.scope === "all"}">${iconSvg("layout-grid")}<span>全部</span></button>
            <button class="${promptLibraryState.scope === "saved" ? "active" : ""}" type="button" data-prompt-library-scope="saved" role="tab" aria-selected="${promptLibraryState.scope === "saved"}">${iconSvg("bookmark")}<span>收藏</span></button>
          </div>
          <button class="icon-button" type="button" data-prompt-library-refresh title="刷新" aria-label="刷新">${iconSvg("refresh-cw")}</button>
        </div>
      </div>
      <div class="prompt-library-category-navigation" role="tablist" aria-label="提示词分类">
        <button type="button" data-prompt-library-category-scroll="-1" title="向左查看更多分类" aria-label="向左查看更多分类">${iconSvg("chevron-left")}</button>
        <div data-prompt-library-category-strip>
          ${promptLibraryCategories.map((category) => `<button class="${promptLibraryState.category === category.id ? "active" : ""}" type="button" data-prompt-library-category="${escapeHtml(category.id)}" role="tab" aria-selected="${promptLibraryState.category === category.id}">${escapeHtml(category.label)}</button>`).join("")}
        </div>
        <button type="button" data-prompt-library-category-scroll="1" title="向右查看更多分类" aria-label="向右查看更多分类">${iconSvg("chevron-right")}</button>
      </div>
      <div class="prompt-library-results-heading"><div><h2>${escapeHtml(heading)}</h2><span>${escapeHtml(meta)}</span></div>${showReset ? `<button type="button" data-prompt-library-reset>重置筛选</button>` : ""}</div>
      <div class="prompt-library-grid" data-prompt-library-grid>${grid}</div>
      ${promptLibraryState.loading || promptLibraryState.error ? "" : promptLibraryPagination()}
    </div>
    ${promptLibraryDetail()}
  `;
  requestAnimationFrame(() => {
    els.pageContent.querySelector("[data-prompt-library-category-strip]")?.addEventListener("scroll", updatePromptLibraryCategoryArrows, { passive: true });
    updatePromptLibraryCategoryArrows();
    if (restoreSearch) {
      const input = els.pageContent.querySelector("[data-prompt-library-search]");
      input?.focus();
      if (input && Number.isInteger(selectionStart)) input.setSelectionRange(selectionStart, selectionStart);
    }
    if (promptLibraryState.activePrompt) els.pageContent.querySelector("[data-prompt-library-close]")?.focus();
  });
}

function promptLibraryKeyword() {
  return [promptLibraryState.query, promptLibraryState.category === "all" ? "" : promptLibraryState.category].filter(Boolean).join(" ");
}

async function loadPromptLibrary({ force = false } = {}) {
  if (promptLibraryState.scope === "saved") {
    promptLibraryState.loading = false;
    promptLibraryState.error = "";
    renderPromptLibraryPage();
    return;
  }
  const version = ++promptLibraryState.requestVersion;
  promptLibraryState.loading = true;
  promptLibraryState.error = "";
  renderPromptLibraryPage();
  try {
    if (!window.desktopBridge?.getPublicPromptLibrary) throw new Error("当前客户端未启用公共提示词库接口");
    const result = await window.desktopBridge.getPublicPromptLibrary({
      page: promptLibraryState.page,
      pageSize: promptLibraryState.pageSize,
      keyword: promptLibraryKeyword(),
      force
    });
    if (version !== promptLibraryState.requestVersion) return;
    promptLibraryState.items = Array.isArray(result?.data?.items) ? result.data.items : [];
    promptLibraryState.total = Math.max(0, Number(result?.data?.total || 0));
    promptLibraryState.page = Math.max(1, Number(result?.data?.page || promptLibraryState.page));
    promptLibraryState.pageSize = Math.max(1, Number(result?.data?.page_size || promptLibraryState.pageSize));
    promptLibraryState.loaded = true;
  } catch (error) {
    if (version !== promptLibraryState.requestVersion) return;
    promptLibraryState.items = [];
    promptLibraryState.total = 0;
    promptLibraryState.error = String(error?.message || error || "提示词库加载失败").replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
  } finally {
    if (version === promptLibraryState.requestVersion) {
      promptLibraryState.loading = false;
      if (state.activeView === "prompt-library") renderPromptLibraryPage();
    }
  }
}

function resetPromptLibraryFilters() {
  promptLibraryState.query = "";
  promptLibraryState.category = "all";
  promptLibraryState.scope = "all";
  promptLibraryState.page = 1;
  loadPromptLibrary();
}

function openPromptLibraryDetail(id) {
  ensurePromptLibraryFavorites();
  const prompt = promptLibraryState.items.find((item) => String(item.id) === String(id))
    || promptLibraryState.favorites.get(String(id));
  if (!prompt) return;
  promptLibraryState.activePrompt = prompt;
  promptLibraryState.argumentValues = Object.fromEntries(promptLibraryArguments(prompt.prompt).map((item) => [item.name, item.defaultValue]));
  renderPromptLibraryPage();
}

function closePromptLibraryDetail() {
  promptLibraryState.activePrompt = null;
  promptLibraryState.argumentValues = {};
  renderPromptLibraryPage();
}

function togglePromptLibraryFavorite(id) {
  ensurePromptLibraryFavorites();
  const key = String(id || "");
  const prompt = promptLibraryState.items.find((item) => String(item.id) === key)
    || promptLibraryState.favorites.get(key)
    || (String(promptLibraryState.activePrompt?.id) === key ? promptLibraryState.activePrompt : null);
  if (!key || !prompt) return;
  if (promptLibraryState.favorites.has(key)) {
    promptLibraryState.favorites.delete(key);
    showToast("已取消收藏");
  } else {
    promptLibraryState.favorites.set(key, prompt);
    showToast("已加入收藏");
  }
  savePromptLibraryFavorites();
  const totalPages = Math.max(1, Math.ceil(promptLibraryVisibleTotal() / promptLibraryState.pageSize));
  promptLibraryState.page = Math.min(promptLibraryState.page, totalPages);
  renderPromptLibraryPage();
}

async function copyPromptLibraryPrompt() {
  if (!promptLibraryState.activePrompt) return;
  const text = resolvedPromptLibraryPrompt(promptLibraryState.activePrompt);
  try {
    if (window.desktopBridge?.copyText) await window.desktopBridge.copyText(text);
    else await navigator.clipboard.writeText(text);
    showToast("提示词已复制");
  } catch {
    showToast("复制失败，请稍后重试");
  }
}

function usePromptLibraryPrompt() {
  if (!promptLibraryState.activePrompt) return;
  const text = resolvedPromptLibraryPrompt(promptLibraryState.activePrompt);
  promptLibraryState.activePrompt = null;
  promptLibraryState.argumentValues = {};
  createNewConversation();
  els.promptInput.value = text;
  autoResizePrompt();
  focusPrompt();
  showToast("提示词已带入新对话");
}

function renderSkillsPage() {
  const currentCategoryStrip = els.pageContent?.querySelector("[data-skill-category-strip]");
  if (currentCategoryStrip) skillLibraryState.categoryScrollLeft = currentCategoryStrip.scrollLeft;
  const query = state.searchQuery.trim().toLocaleLowerCase("zh-CN");
  const items = skillLibraryItems();
  const tabCounts = {
    all: items.length,
    personal: items.filter((item) => item.sourceType === "PERSONAL").length,
    enterprise: items.filter((item) => item.sourceType === "ENTERPRISE").length,
    submissions: companySkillState.submissions.length
  };
  const showingSubmissions = skillLibraryState.tab === "submissions";
  const visible = items.filter((skill) => {
    if (skillLibraryState.tab === "personal" && skill.sourceType !== "PERSONAL") return false;
    if (skillLibraryState.tab === "enterprise" && skill.sourceType !== "ENTERPRISE") return false;
    if (skillLibraryState.categoryId !== "all" && skill.categoryId !== skillLibraryState.categoryId) return false;
    if (!query) return true;
    const tagNames = (skill.tagIds || []).map((tagId) => skillTagName(tagId, skill)).join(" ");
    return [skill.name, skill.description, skill.category, skill.slug, tagNames].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
  });
  els.pageContent.innerHTML = `
    <section class="skill-library-page">
    <div class="skill-library-header">
      <div><h1>技能库</h1><p>调用现成技能，或导入自己的工作方法。</p></div>
      <div class="skill-library-header-actions">
        <button class="secondary-button" type="button" data-action="show-view" data-view="company-skill-create">${iconSvg("square-pen")}<span>创建技能</span></button>
        <button class="secondary-button" type="button" data-action="open-skill-import">${iconSvg("plus")}<span>导入技能</span></button>
        <button class="secondary-button" type="button" data-action="open-online-skills">${iconSvg("globe")}<span>在线技能库</span></button>
      </div>
    </div>
    <div class="skill-library-tabs" role="tablist" aria-label="技能范围">
      ${skillLibraryTab("all", "全部技能", tabCounts.all)}
      ${skillLibraryTab("personal", "我的技能", tabCounts.personal)}
      ${skillLibraryTab("enterprise", "企业技能", tabCounts.enterprise)}
      ${skillLibraryTab("submissions", "我的提交", tabCounts.submissions)}
    </div>
    ${showingSubmissions ? renderSkillLibrarySubmissions() : `
      <div class="page-search skill-library-search">
        <span class="search-symbol">${iconSvg("search")}</span>
        <input type="text" placeholder="搜索技能名称、说明或标签" data-skill-page-search value="${escapeHtml(state.searchQuery)}">
      </div>
      <div class="skill-category-navigation" data-skill-category-navigation>
        <button class="skill-category-scroll-button previous" type="button" data-skill-category-scroll="-1" aria-label="查看左侧分类" title="查看左侧分类">${iconSvg("chevron-left")}</button>
        <div class="skill-category-strip" data-skill-category-strip role="tablist" aria-label="技能分类">
          <button class="${skillLibraryState.categoryId === "all" ? "active" : ""}" type="button" data-skill-category="all">全部</button>
          ${skillLibraryState.categories.filter((item) => item.status !== "DISABLED").sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map((item) => `<button class="${skillLibraryState.categoryId === item.categoryId ? "active" : ""}" type="button" data-skill-category="${escapeHtml(item.categoryId)}">${escapeHtml(item.name)}</button>`).join("")}
        </div>
        <button class="skill-category-scroll-button next" type="button" data-skill-category-scroll="1" aria-label="查看更多分类" title="查看更多分类">${iconSvg("chevron-right")}</button>
      </div>
      ${skillLibraryState.taxonomyError ? `<div class="skill-library-inline-note">分类暂时使用本地缓存，连接恢复后会自动同步。</div>` : ""}
      <section class="skill-library-grid" aria-live="polite">
        ${visible.length ? visible.map(renderSkillCard).join("") : `<div class="skills-empty skill-library-empty"><span>${iconSvg("search")}</span><strong>没有找到匹配的技能</strong><p>可以切换分类、清空搜索，或导入一个新技能。</p></div>`}
      </section>
    `}
    ${companySkillState.loading ? `<div class="skill-library-sync-state">${iconSvg("refresh-cw")}<span>正在同步技能</span></div>` : ""}
    </section>
  `;
  if (!showingSubmissions) {
    initializeSkillCategoryNavigation();
    window.requestAnimationFrame(initializeSkillCategoryNavigation);
  }
}

function commitSkillPageSearch(input) {
  if (!input?.matches?.("[data-skill-page-search]")) return;
  const selectionStart = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const selectionEnd = typeof input.selectionEnd === "number" ? input.selectionEnd : selectionStart;
  state.searchQuery = input.value;
  saveState();
  renderSkillsPage();
  const searchInput = els.pageContent.querySelector("[data-skill-page-search]");
  searchInput?.focus({ preventScroll: true });
  if (searchInput) {
    const nextStart = Math.min(selectionStart, searchInput.value.length);
    const nextEnd = Math.min(selectionEnd, searchInput.value.length);
    searchInput.setSelectionRange(nextStart, nextEnd);
  }
}

function initializeSkillCategoryNavigation() {
  const navigation = els.pageContent?.querySelector("[data-skill-category-navigation]");
  const strip = navigation?.querySelector("[data-skill-category-strip]");
  if (!navigation || !strip) return;
  const previous = navigation.querySelector('[data-skill-category-scroll="-1"]');
  const next = navigation.querySelector('[data-skill-category-scroll="1"]');
  strip.scrollLeft = Math.min(Number(skillLibraryState.categoryScrollLeft || 0), Math.max(0, strip.scrollWidth - strip.clientWidth));
  const update = () => {
    const overflow = strip.scrollWidth > strip.clientWidth + 2;
    skillLibraryState.categoryScrollLeft = strip.scrollLeft;
    navigation.classList.toggle("has-overflow", overflow);
    previous.disabled = !overflow || strip.scrollLeft <= 2;
    next.disabled = !overflow || strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
  };
  strip.addEventListener("scroll", update, { passive: true });
  update();
}

function skillLibraryTab(id, label, count) {
  return `<button class="${skillLibraryState.tab === id ? "active" : ""}" type="button" role="tab" aria-selected="${skillLibraryState.tab === id}" data-skill-tab="${id}">${escapeHtml(label)} <span>${Number(count || 0)}</span></button>`;
}

function personalSkillForSubmission(submission) {
  return skills.find((skill) => skill.installed && !skill.companySkillId && (
    submission?.name === skill.slug
    || submission?.skillId === skill.personalSkillId
    || submission?.displayName === skill.name
  )) || null;
}

function submissionUpdatedAt(submission) {
  return submission?.withdrawnAt || submission?.rejectedAt || submission?.reviewedAt
    || submission?.approvedAt || submission?.publishedAt || submission?.submittedAt || "";
}

function renderSkillLibrarySubmissions() {
  const submissions = [...companySkillState.submissions]
    .sort((left, right) => new Date(submissionUpdatedAt(right) || 0) - new Date(submissionUpdatedAt(left) || 0));
  const pending = submissions.filter((item) => String(item.status || "").toLowerCase() === "pending").length;
  const completed = submissions.filter((item) => ["approved", "published"].includes(String(item.status || "").toLowerCase())).length;
  const rows = submissions.map((item) => {
    const status = String(item.status || "pending").toLowerCase();
    const personalSkill = personalSkillForSubmission(item);
    const displayName = item.enterpriseDisplayName || item.displayName || item.name || "未命名技能";
    const iconName = ["approved", "published"].includes(status) ? "circle-check" : (status === "rejected" ? "triangle-alert" : (status === "withdrawn" ? "undo-2" : "history"));
    return `<article class="skill-submission-item">
      <span class="skill-submission-icon ${escapeHtml(status)}">${iconSvg(iconName)}</span>
      <div class="skill-submission-copy">
        <div><strong>${escapeHtml(displayName)}</strong><span class="company-submission-status ${escapeHtml(status)}">${escapeHtml(companySkillStatusLabel(status))}</span></div>
        <p>${escapeHtml(item.name || personalSkill?.slug || "技能")}${item.version ? ` · 版本 ${escapeHtml(item.version)}` : ""}${item.category || item.enterpriseCategory ? ` · ${escapeHtml(item.enterpriseCategory || item.category)}` : ""}</p>
        ${item.rejectionReason ? `<div class="skill-submission-reason"><strong>驳回原因</strong><span>${escapeHtml(item.rejectionReason)}</span></div>` : ""}
      </div>
      <time>${escapeHtml(formatUpdateDate(submissionUpdatedAt(item)))}</time>
      <div class="skill-submission-actions">
        ${personalSkill ? `<button class="secondary-button" type="button" data-manage-skill="${escapeHtml(personalSkill.id)}">查看技能</button>` : ""}
        ${status === "pending" ? `<button class="secondary-button danger" type="button" data-confirm-skill-action="withdraw" data-submission-id="${escapeHtml(item.submissionId)}" data-state-version="${Number(item.stateVersion || 1)}" data-skill-name="${escapeHtml(displayName)}">撤回申请</button>` : ""}
      </div>
    </article>`;
  }).join("");
  return `<section class="skill-submissions-panel" aria-live="polite">
    <header class="skill-submissions-header">
      <div><h2>我的提交</h2><p>这里显示当前钉钉账号提交过的全部技能和审核进度。</p></div>
      <button class="primary-button" type="button" data-action="show-view" data-view="company-skill-submit">${iconSvg("upload")}<span>提交新技能</span></button>
    </header>
    <div class="skill-submissions-summary" aria-label="提交统计">
      <span><strong>${submissions.length}</strong>全部提交</span>
      <span><strong>${pending}</strong>审核中</span>
      <span><strong>${completed}</strong>已通过或发布</span>
    </div>
    <div class="skill-submission-list">
      ${rows || `<div class="skills-empty skill-library-empty"><span>${iconSvg("history")}</span><strong>还没有提交记录</strong><p>导入或创建技能后，可以提交企业审核。</p></div>`}
    </div>
  </section>`;
}

function skillCategoryName(categoryId, fallback = "效率工具") {
  return skillLibraryState.categories.find((item) => item.categoryId === categoryId)?.name || fallback;
}

function skillTagName(tagId, skill = null) {
  return skillLibraryState.tags.find((item) => item.tagId === tagId)?.name
    || (skill?.customTags || []).find((item) => item.tagId === tagId)?.name
    || tagId;
}

function latestSubmissionForSkill(skill) {
  return companySkillState.submissions
    .filter((item) => item.name === skill.slug || item.skillId === skill.personalSkillId)
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0] || null;
}

function skillLibraryItems() {
  const personal = skills.filter((skill) => skill.installed && !skill.companySkillId).map((skill) => ({
    ...skill,
    sourceType: "PERSONAL",
    categoryId: skill.categoryId || "efficiency-tools",
    tagIds: Array.isArray(skill.tagIds) && skill.tagIds.length ? skill.tagIds : ["automation"],
    status: latestSubmissionForSkill(skill)?.status || "DRAFT",
    version: skill.version || "1.0.0",
    canManage: true
  }));
  const builtIn = builtInSkills.filter((skill) => skill.id !== "browser").map((skill) => ({
    ...skill,
    category: skillCategoryName(skill.categoryId, skill.category),
    sourceType: "BUILT_IN",
    sourceLabel: "自带技能",
    version: skill.version || "1.0.0",
    status: "BUILT_IN",
    canManage: false
  }));
  const enterprise = companySkillState.catalog.map((item) => {
    const installed = skills.find((skill) => skill.companySkillId === item.skillId);
    return {
      ...(installed || {}),
      id: installed?.id || `company-${item.skillId}`,
      enterpriseSkillId: item.skillId,
      name: item.displayName,
      slug: item.name,
      shortName: String(item.displayName || "企业技能").slice(0, 8),
      icon: item.icon || "file-stack",
      categoryId: item.categoryId || installed?.categoryId || "efficiency-tools",
      category: skillCategoryName(item.categoryId || installed?.categoryId, item.category || installed?.category),
      tagIds: Array.isArray(item.tagIds) && item.tagIds.length ? item.tagIds : (installed?.tagIds || []),
      description: item.description,
      starter: item.starter,
      sourceType: "ENTERPRISE",
      sourceLabel: "企业技能",
      status: "PUBLISHED",
      installed: Boolean(installed),
      latestVersion: item.latestVersion,
      version: item.latestVersion || installed?.version || "1.0.0",
      canManage: false,
      userInvocable: true
    };
  });
  return [...builtIn, ...enterprise, ...personal];
}

function downloadableSkill(skill) {
  return Boolean(skill && ["PERSONAL", "ENTERPRISE", "BUILT_IN"].includes(skill.sourceType));
}

function builtInSkillPackageDraft(skill) {
  const fields = Array.isArray(skill.fields) && skill.fields.length ? skill.fields : [{ id: "content", label: "输入内容", type: "textarea", required: true }];
  return {
    name: String(skill.id || skill.slug || "skill").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "skill",
    version: skill.version || "1.0.0",
    displayName: skill.name || "技能",
    description: skill.description || "用于处理用户提供的内容。",
    category: skill.category || "效率工具",
    categoryId: skill.categoryId || "efficiency-tools",
    tagIds: skill.tagIds || [],
    starter: skill.starter || `请使用“${skill.name || "这个技能"}”处理以下内容。`,
    icon: skill.icon || "sparkles",
    applicable: skill.description || "当用户需要完成与该技能相关的任务时使用。",
    inputs: fields.map((field) => field.label || field.id).join("、") || "用户提供的文字或附件。",
    outputRequirements: "根据用户要求输出清晰、可复核的结果；不编造输入中没有的事实。",
    steps: "1. 理解用户目标。\n2. 按技能说明处理输入。\n3. 检查结果并说明无法确认的内容。",
    boundaries: "只根据用户提供的信息处理，不执行未授权的外部操作。",
    exceptions: "输入不足时先向用户追问；附件无法读取时明确说明文件名和原因。",
    example: `用户：${skill.starter || "请处理这项任务。"}\n\n技能：先确认输入，再输出结构化结果。`,
    fields,
    supportedInputs: skill.supportedInputs || ["text", "document"],
    outputs: skill.outputs || ["markdown"],
    permissions: [],
    dependencies: []
  };
}

async function downloadSkillPackage(skill) {
  if (!downloadableSkill(skill)) {
    showToast("这个技能没有可下载的技能包");
    return;
  }
  try {
    showToast(`正在准备“${skill.name}”技能压缩包`);
    let result;
    if (skill.sourceType === "ENTERPRISE") {
      result = await window.desktopBridge?.downloadCompanySkillPackage?.({ skillId: skill.enterpriseSkillId });
    } else if (skill.sourceType === "PERSONAL") {
      result = await window.desktopBridge?.downloadInstalledSkillPackage?.({ userId: state.session?.userId || "local-user", skillId: skill.id });
    } else {
      result = await window.desktopBridge?.createSkillPackage?.({ userId: state.session?.userId || "local-user", draft: builtInSkillPackageDraft(skill), saveAs: true });
    }
    if (!result || result.canceled) return;
    showToast(`已保存技能压缩包：${baseName(result.path || `${skill.name}.zip`)}`);
  } catch (error) {
    showToast(error.message || "技能压缩包下载失败");
  }
}

function renderSkillCard(skill) {
  const personalStatus = skill.sourceType === "PERSONAL" ? personalSkillStatus(skill.status) : null;
  const sourceLabel = skill.sourceType === "ENTERPRISE" ? "企业技能" : (skill.sourceType === "BUILT_IN" ? "内置技能" : personalStatus.label);
  const tagIds = (skill.tagIds || []).slice(0, 3);
  const iconText = String(skill.name || "技").trim().slice(0, 1);
  const useAction = skill.sourceType === "ENTERPRISE" && !skill.installed
    ? `data-use-enterprise-skill="${escapeHtml(skill.enterpriseSkillId)}"`
    : `data-use-skill="${escapeHtml(skill.id)}"`;
  return `
    <article class="skill-card skill-library-card">
      <div class="skill-card-top">
        <div class="skill-icon skill-letter-icon" aria-hidden="true">${escapeHtml(iconText)}</div>
        <div class="skill-card-heading">
          <div class="skill-card-name">${escapeHtml(skill.name)}</div>
          <div class="skill-card-category">${escapeHtml(skillCategoryName(skill.categoryId, skill.category))}</div>
        </div>
        <span class="skill-source-badge ${skill.sourceType === "ENTERPRISE" ? "enterprise" : (personalStatus?.code || "")}">${escapeHtml(sourceLabel)}</span>
      </div>
      <div class="skill-card-desc">${escapeHtml(skill.description)}</div>
      <div class="skill-card-tags">${tagIds.length ? tagIds.map((tagId) => `<span>${escapeHtml(skillTagName(tagId, skill))}</span>`).join("") : `<span>通用</span>`}</div>
      <div class="skill-card-footer">
        <span class="skill-card-version">版本 ${escapeHtml(skill.version || skill.latestVersion || skill.companyVersion || "1.0.0")}</span>
        <span class="skill-card-actions">
          ${skill.canManage ? `<button class="skill-manage-button" type="button" data-manage-skill="${escapeHtml(skill.id)}">管理</button>` : ""}
          ${downloadableSkill(skill) ? `<button class="skill-download-button" type="button" data-download-skill="${escapeHtml(skill.id)}" title="下载技能压缩包" aria-label="下载${escapeHtml(skill.name)}技能压缩包">${iconSvg("download")}<span>下载</span></button>` : ""}
          ${skill.userInvocable === false ? `<span class="skill-auto-label">自动调用</span>` : `<button class="skill-use-button" type="button" ${useAction}>使用</button>`}
        </span>
      </div>
    </article>
  `;
}

function personalSkillStatus(status) {
  const value = String(status || "DRAFT").toLowerCase();
  if (["pending", "in_review"].includes(value)) return { code: "processing", label: "审批中" };
  if (value === "approved") return { code: "approved", label: "已通过" };
  if (value === "withdrawn") return { code: "withdrawn", label: "已撤回" };
  if (value === "rejected") return { code: "rejected", label: "已驳回" };
  if (value === "published") return { code: "published", label: "已发布" };
  if (value === "revoked") return { code: "revoked", label: "已下架" };
  return { code: "private", label: "未提交" };
}

function companySubmissionAuditLabel(action) {
  return ({ submitted: "提交审批", approved: "审核通过", rejected: "审批驳回", published: "企业技能发布", "direct-published": "管理员直接发布", revoked: "企业技能下架", republished: "企业技能重新发布", withdrawn: "申请已撤回" })[action] || "状态更新";
}

function renderPersonalSkillDetailPage(skillId) {
  const skill = skillLibraryItems().find((item) => item.id === skillId && item.sourceType === "PERSONAL");
  if (!skill) {
    state.activeView = "skills";
    renderSkillsPage();
    return;
  }
  const submission = latestSubmissionForSkill(skill);
  const status = personalSkillStatus(submission?.status);
  const submissionStatus = String(submission?.status || "").toLowerCase();
  const canWithdraw = submissionStatus === "pending";
  const canEditOrDelete = !submission || ["withdrawn", "rejected"].includes(submissionStatus);
  const canSubmit = !submission || ["withdrawn", "rejected"].includes(submissionStatus);
  const safeSkillId = escapeHtml(skill.id);
  const editableActions = canEditOrDelete
    ? `<button class="secondary-button" type="button" data-edit-installed-skill="${safeSkillId}">${iconSvg("pen-line")}<span>编辑</span></button><button class="secondary-button danger" type="button" data-confirm-skill-action="delete" data-skill-id="${safeSkillId}" data-skill-name="${escapeHtml(skill.name)}" data-submission-status="${escapeHtml(submissionStatus)}">${iconSvg("trash-2")}<span>删除个人技能</span></button>`
    : "";
  const submitLabel = ["rejected", "withdrawn"].includes(status.code) ? "重新提交" : "提交审批";
  const rejectedAt = String(submission?.status || "").toLowerCase() === "rejected"
    ? (submission.rejectedAt || submission.reviewedAt)
    : submission?.rejectedAt;
  const auditedHistory = Array.isArray(submission?.auditTrail) ? submission.auditTrail.map((item) => ({
    title: companySubmissionAuditLabel(item.action),
    time: item.occurredAt,
    note: item.reason || (item.action === "approved" ? "等待管理员发布企业副本" : (item.action === "published" ? "企业副本已进入公司技能库" : "状态已更新"))
  })).reverse() : [];
  const history = auditedHistory.length ? [...auditedHistory, { title: "导入成功", time: skill.installedAt, note: "已进入我的技能" }] : [
    submission?.revokedAt && { title: "企业技能下架", time: submission.revokedAt, note: "个人技能仍保留并可继续使用" },
    submission?.publishedAt && { title: "企业技能发布", time: submission.publishedAt, note: "企业副本已进入公司技能库" },
    submission?.approvedAt && { title: "审核通过", time: submission.approvedAt, note: "等待管理员发布企业副本" },
    rejectedAt && { title: "审批驳回", time: rejectedAt, note: submission.rejectionReason || "请修改后重新提交" },
    submission?.withdrawnAt && { title: "申请已撤回", time: submission.withdrawnAt, note: "个人技能继续保留并可使用" },
    submission?.submittedAt && { title: "提交审批", time: submission.submittedAt, note: "已提交管理员" },
    { title: "导入成功", time: skill.installedAt, note: "已进入我的技能" }
  ].filter(Boolean);
  const version = skill.version || skill.companyVersion || "1.0.0";
  const tagNames = (skill.tagIds || []).map((tagId) => skillTagName(tagId, skill)).join("、") || "通用";
  const instruction = String(skill.instructions || skill.systemPrompt || "").replace(/^当前选用技能[^\n]*\n?/, "").trim();
  els.pageContent.innerHTML = `
    <section class="skill-detail-page">
      <button class="skill-back-button" type="button" data-action="show-view" data-view="skills">${iconSvg("arrow-left")}<span>返回技能库</span></button>
      <section class="personal-skill-hero">
        <div class="skill-icon skill-letter-icon large" aria-hidden="true">${escapeHtml(String(skill.name || "技").slice(0, 1))}</div>
        <div class="personal-skill-title"><h1>${escapeHtml(skill.name)}</h1><p>${escapeHtml(skill.description)}</p><div class="personal-skill-meta"><span>${escapeHtml(skillCategoryName(skill.categoryId, skill.category))}</span><span>版本 ${escapeHtml(version)}</span><span class="personal-skill-state ${status.code}">${escapeHtml(status.label)}</span></div></div>
        <div class="personal-skill-actions">
          <button class="secondary-button" type="button" data-download-skill="${escapeHtml(skill.id)}" title="下载技能压缩包" aria-label="下载${escapeHtml(skill.name)}技能压缩包">${iconSvg("download")}<span>下载</span></button>
          <button class="secondary-button" type="button" data-use-skill="${escapeHtml(skill.id)}">${iconSvg("play")}<span>使用</span></button>
          ${editableActions}
          ${canWithdraw ? `<button class="secondary-button danger" type="button" data-confirm-skill-action="withdraw" data-submission-id="${escapeHtml(submission.submissionId)}" data-state-version="${Number(submission.stateVersion || 1)}" data-skill-name="${escapeHtml(skill.name)}">${iconSvg("undo-2")}<span>撤回申请</span></button>` : (canSubmit ? `<button class="primary-button" type="button" data-confirm-skill-action="submit" data-skill-id="${escapeHtml(skill.id)}" data-skill-name="${escapeHtml(skill.name)}">${iconSvg("send")}<span>${escapeHtml(submitLabel)}</span></button>` : "")}
        </div>
      </section>
      ${submission?.rejectionReason ? `<div class="personal-skill-notice rejected"><strong>驳回原因：</strong><span>${escapeHtml(submission.rejectionReason)}</span></div>` : ""}
      <div class="personal-skill-layout">
        <section class="personal-skill-main">
          <div class="personal-skill-panel"><h2>技能说明</h2><div class="personal-skill-instruction">${escapeHtml(instruction || skill.description)}</div></div>
          <div class="personal-skill-panel"><h2>基本信息</h2><dl>
            <div><dt>技能分类</dt><dd>${escapeHtml(skillCategoryName(skill.categoryId, skill.category))}</dd></div>
            <div><dt>当前版本</dt><dd>${escapeHtml(version)}</dd></div>
            <div><dt>技能标签</dt><dd>${escapeHtml(tagNames)}</dd></div>
            <div><dt>审批状态</dt><dd>${escapeHtml(status.label)}</dd></div>
          </dl></div>
          <div class="personal-skill-panel"><h2>状态记录</h2><div class="personal-skill-timeline">${history.map((item) => `<div><span></span><p><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.note)} · ${escapeHtml(formatUpdateDate(item.time))}</small></p></div>`).join("")}</div></div>
        </section>
        <aside class="personal-skill-side"><h3>个人技能</h3><p>技能保存在当前钉钉账号下，可在对话中直接调用。</p><h3>企业审批</h3><p>${canWithdraw ? "当前版本正在审核，撤回后可继续编辑。" : "编辑完成后可提交企业审批，审核中的版本不能修改。"}</p><h3>版本说明</h3><p>撤回或驳回后修改当前内容即可重新提交，无需仅为重新提交而提高版本号。</p></aside>
      </div>
    </section>
  `;
}

function companySkillDraftStorageKey() {
  return `xianma.company-skill-draft:${state.session?.userId || "anonymous"}`;
}

function loadCompanySkillDraft() {
  const saved = parseJson(localStorage.getItem(companySkillDraftStorageKey()));
  if (saved && typeof saved === "object") companySkillDraft = { ...companySkillDraft, ...saved };
}

function saveCompanySkillDraft() {
  localStorage.setItem(companySkillDraftStorageKey(), JSON.stringify(companySkillDraft));
}

function fillCompanySkillExample() {
  companySkillDraft = { ...companySkillDraft, ...companySkillExampleDraft };
  saveCompanySkillDraft();
  renderCompanySkillCreatePage();
  showToast("已填入完整示例，可以直接修改成自己的技能");
  document.querySelector('[data-company-draft="displayName"]')?.focus();
}

function renderCompanyBackHeader(title, subtitle, actions = "") {
  return renderPageHeader(title, subtitle, `<span class="page-header-actions"><button class="secondary-button page-header-action" type="button" data-action="show-view" data-view="skills">${iconSvg("chevron-left")}<span>返回技能</span></button>${actions}</span>`);
}

function companyDraftField(key, label, options = {}) {
  const value = escapeHtml(companySkillDraft[key] || "");
  const required = options.required === false ? "" : " required";
  if (options.type === "select") {
    return `<label class="company-form-field"><span>${escapeHtml(label)}</span><select data-company-draft="${escapeHtml(key)}"${required}>${options.values.map((item) => `<option value="${escapeHtml(item)}"${item === companySkillDraft[key] ? " selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></label>`;
  }
  if (options.type === "textarea") {
    return `<label class="company-form-field ${options.wide ? "wide" : ""}"><span>${escapeHtml(label)}</span><textarea data-company-draft="${escapeHtml(key)}" placeholder="${escapeHtml(options.placeholder || "")}"${required}>${value}</textarea></label>`;
  }
  return `<label class="company-form-field ${options.wide ? "wide" : ""}"><span>${escapeHtml(label)}</span><input data-company-draft="${escapeHtml(key)}" value="${value}" placeholder="${escapeHtml(options.placeholder || "")}"${required}></label>`;
}

function renderCompanySkillCreatePage() {
  const categories = skillLibraryState.categories
    .filter((item) => item.status !== "DISABLED")
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const selectedCategory = categories.find((item) => item.categoryId === companySkillDraft.categoryId)
    || categories.find((item) => item.name === companySkillDraft.category)
    || categories[0];
  if (selectedCategory) {
    companySkillDraft.categoryId = selectedCategory.categoryId;
    companySkillDraft.category = selectedCategory.name;
  }
  els.pageContent.innerHTML = `
    ${renderCompanyBackHeader("创建技能", "填写统一模板后，可以保存到我的技能、下载技能包或提交企业审核。", `<button class="secondary-button page-header-action" type="button" data-action="download-company-skill-template">${iconSvg("download")}<span>下载标准模板</span></button>`)}
    <div class="company-example-strip">
      <span class="company-example-icon">${iconSvg("lightbulb")}</span>
      <div><strong>第一次创建技能？</strong><p>一键填入“项目周报整理”完整示例，再把示例内容改成自己的即可。</p></div>
      <button class="secondary-button" type="button" data-action="fill-company-skill-example">${iconSvg("sparkles")}<span>填入完整示例</span></button>
    </div>
    <form class="company-skill-form" id="companySkillCreateForm">
      <section class="company-form-section">
        <div class="company-form-section-title"><span>1</span><div><h2>基本信息</h2><p>名称和标识将用于公司技能库中的识别。</p></div></div>
        <div class="company-form-grid">
          ${companyDraftField("displayName", "技能名称", { placeholder: "例如：项目周报整理" })}
          ${companyDraftField("name", "技能标识", { placeholder: "例如：project-weekly-report" })}
          <label class="company-form-field"><span>分类</span><select data-company-category required>${categories.map((item) => `<option value="${escapeHtml(item.categoryId)}"${item.categoryId === companySkillDraft.categoryId ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
          ${companyDraftField("description", "技能说明", { wide: true, placeholder: "用一句话说明技能解决的问题" })}
          ${companyDraftField("starter", "对话引导语", { wide: true, placeholder: "用户安装后可以直接点击使用的示例请求" })}
        </div>
      </section>
      <section class="company-form-section">
        <div class="company-form-section-title"><span>2</span><div><h2>执行规范</h2><p>这些内容会成为 SKILL.md 的强制章节。</p></div></div>
        <div class="company-form-grid">
          ${companyDraftField("applicable", "适用场景", { type: "textarea", placeholder: "什么情况下应该使用这个技能" })}
          ${companyDraftField("inputs", "输入要求", { type: "textarea", placeholder: "必填信息、可选信息和支持的附件" })}
          ${companyDraftField("outputRequirements", "输出要求", { type: "textarea", placeholder: "结果结构、文件格式和质量标准" })}
          ${companyDraftField("steps", "执行流程", { type: "textarea", placeholder: "建议使用有序步骤描述" })}
          ${companyDraftField("boundaries", "边界与禁止事项", { type: "textarea", placeholder: "不得执行或必须确认的行为" })}
          ${companyDraftField("exceptions", "异常处理", { type: "textarea", placeholder: "输入不足、依赖失败时如何处理" })}
          ${companyDraftField("example", "使用示例", { type: "textarea", wide: true, placeholder: "至少提供一组用户输入与预期处理结果" })}
        </div>
      </section>
      <section class="company-form-section">
        <div class="company-form-section-title"><span>3</span><div><h2>格式、依赖与资源</h2><p>脚本、网络和系统命令会在审核时标记为风险项。</p></div></div>
        <div class="company-form-grid">
          ${companyDraftField("supportedInputs", "支持的输入", { placeholder: "text, image, document, audio, video" })}
          ${companyDraftField("outputs", "输出格式", { placeholder: "markdown, docx, xlsx, pptx" })}
          ${companyDraftField("permissions", "所需权限（选填）", { required: false, placeholder: "network, shell, file-write" })}
          ${companyDraftField("dependencies", "外部依赖（选填）", { required: false, placeholder: "程序、环境变量或服务名称" })}
        </div>
        <div class="company-resource-block">
          <div><strong>资源文件（选填）</strong><small>图片、模板、参考资料和脚本会放入 assets 目录，提交前统一安全检查。</small></div>
          <button class="secondary-button" type="button" data-action="attach-file">${iconSvg("paperclip")}<span>添加资源</span></button>
          ${state.selectedFiles.length ? `<div class="company-resource-list">${state.selectedFiles.map((file, index) => `<span title="${escapeHtml(file.absolutePath || file.path || "")}">${iconSvg(file.kind === "image" ? "image" : "file")}<span>${escapeHtml(file.name || baseName(file.absolutePath || file.path))}</span><button type="button" data-remove-file="${index}" title="移除">${iconSvg("x")}</button></span>`).join("")}</div>` : ""}
        </div>
      </section>
      <div class="company-form-actions">
        <span class="company-form-save-state">草稿自动保存在当前钉钉用户的本机数据中</span>
        <button class="secondary-button" type="button" data-action="save-company-skill-package">${iconSvg("download")}<span>下载技能包</span></button>
        <button class="secondary-button" type="button" data-action="create-company-skill-package">${iconSvg("send")}<span>提交企业审核</span></button>
        <button class="primary-button" type="button" data-action="install-created-skill">${iconSvg("circle-check")}<span>保存到我的技能</span></button>
      </div>
    </form>
  `;
}

function renderCompanySkillSubmitPage() {
  const inspection = companySkillSubmission.inspection;
  els.pageContent.innerHTML = `
    ${renderCompanyBackHeader("提交技能审核", "提交身份来自当前钉钉账号，审核中的版本不可修改。", `<button class="secondary-button page-header-action" type="button" data-action="download-company-skill-template">${iconSvg("download")}<span>标准模板</span></button>`)}
    <section class="company-submit-panel">
      ${inspection ? `<div class="company-submit-ready">
        <span>${iconSvg("shield-check")}</span>
        <div><strong>确认提交内容</strong><p>当前技能内容已经准备完成，确认无误后可直接提交审核。</p></div>
      </div>` : `<div class="company-submit-drop ${companySkillSubmission.loading ? "loading" : ""}">
          <span class="company-submit-icon">${iconSvg("upload")}</span>
          <h2>选择要提交的技能</h2>
          <p>支持 Markdown、ZIP，或包含 SKILL.md 与 skill.json 的文件夹。选择后会先完成本地校验，再进入提交确认。</p>
          <div class="company-submit-actions">
            <button class="secondary-button" type="button" data-action="choose-company-skill-package">${iconSvg("file-stack")}<span>选择文件</span></button>
            <button class="secondary-button" type="button" data-action="choose-company-skill-folder">${iconSvg("folder-open")}<span>选择文件夹</span></button>
          </div>
        </div>
      `}
      ${inspection ? `<div class="company-inspection-result success">
        <div class="company-inspection-heading"><span>${iconSvg("circle-check")}</span><div><strong>${escapeHtml(inspection.skill.displayName)}</strong><small>${escapeHtml(inspection.skill.name)} · ${escapeHtml(inspection.skill.version)}</small></div><span>${formatFileBytes(inspection.bytes)}</span></div>
        <p>${escapeHtml(inspection.skill.description)}</p>
        <div class="company-inspection-tags"><span>${escapeHtml(inspection.skill.category)}</span>${inspection.skill.supportedInputs.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        <details><summary>查看文件清单（${inspection.fileTree.length}）</summary><pre>${escapeHtml(inspection.fileTree.join("\n"))}</pre></details>
      </div>` : ""}
      ${companySkillSubmission.normalizationNote ? `<div class="company-submit-note">${iconSvg("circle-check")}<span>${escapeHtml(companySkillSubmission.normalizationNote)}</span></div>` : ""}
      ${companySkillSubmission.error ? `<div class="company-submit-error"><strong>未通过本地校验</strong><p>${escapeHtml(companySkillSubmission.error)}</p><button class="secondary-button" type="button" data-action="company-skill-fix-in-wizard">导入表单向导修正</button></div>` : ""}
      ${companySkillState.progress ? `<div class="company-upload-progress"><div><strong>${escapeHtml(companySkillState.progress.message || "正在处理")}</strong><span>${Number(companySkillState.progress.percent || 0)}%</span></div><progress max="100" value="${Number(companySkillState.progress.percent || 0)}"></progress><small>上传在后台继续运行，可以切换到其他页面。</small></div>` : ""}
      <div class="company-form-actions">
        <span>${inspection ? "已锁定当前内容，提交后等待管理员审核" : "请选择待审核技能"}</span>
        <button class="primary-button" type="button" data-action="submit-company-skill-review" ${!inspection || companySkillSubmission.submitting ? "disabled" : ""}>${iconSvg("upload")}<span>${companySkillSubmission.submitting ? "正在提交" : "提交审核"}</span></button>
      </div>
    </section>
  `;
}

function companySkillStatusLabel(status) {
  return ({ pending: "待审核", approved: "待发布", published: "已发布", rejected: "已驳回", withdrawn: "已撤回", revoked: "已下架" })[status] || status || "未知";
}

function renderCompanySkillCatalogPage() {
  const installedIds = new Map(skills.filter((skill) => skill.companySkillId).map((skill) => [skill.companySkillId, skill]));
  els.pageContent.innerHTML = `
    ${renderCompanyBackHeader("公司技能库", "这里的技能均经过公司审核，安装后仅保存在当前钉钉用户的私有目录。", `<button class="secondary-button page-header-action" type="button" data-action="refresh-company-skills">${iconSvg("refresh-cw")}<span>刷新</span></button>`)}
    ${companySkillState.error ? `<div class="company-submit-error">${escapeHtml(companySkillState.error)}</div>` : ""}
    <div class="company-catalog-grid">
      ${companySkillState.catalog.length ? companySkillState.catalog.map((skill) => {
        const installed = installedIds.get(skill.skillId);
        return `<article class="company-catalog-card">
          <div class="company-catalog-top"><span class="skill-icon">${iconSvg(skill.icon || "sparkles")}</span><span><strong>${escapeHtml(skill.displayName)}</strong><small>${escapeHtml(skill.category)}</small></span><span class="company-risk ${skill.riskLevel === "high" ? "high" : ""}">${skill.riskLevel === "high" ? "已确认风险" : "标准技能"}</span></div>
          <p>${escapeHtml(skill.description)}</p>
          <div class="company-inspection-tags">${(skill.supportedInputs || []).slice(0, 5).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          <div class="company-catalog-footer"><span>${escapeHtml(skill.starter || "")}</span><span class="company-catalog-actions"><button class="secondary-button" type="button" data-download-enterprise-skill="${escapeHtml(skill.skillId)}" title="下载技能压缩包" aria-label="下载${escapeHtml(skill.displayName)}技能压缩包">${iconSvg("download")}<span>下载</span></button><button class="${installed ? "secondary-button" : "primary-button"}" type="button" data-install-company-skill="${escapeHtml(skill.skillId)}" ${installed ? "disabled" : ""}>${iconSvg(installed ? "circle-check" : "download")}<span>${installed ? "已安装" : "安装"}</span></button></span></div>
        </article>`;
      }).join("") : `<div class="company-empty"><span>${iconSvg("file-stack")}</span><h2>暂时没有已发布技能</h2><p>审核通过后，公司技能会出现在这里。</p></div>`}
    </div>
  `;
}

function renderMyCompanySkillSubmissionsPage() {
  els.pageContent.innerHTML = `
    ${renderCompanyBackHeader("我的提交", "查看当前钉钉用户提交的技能、审核状态和驳回原因。", `<button class="primary-button page-header-action" type="button" data-action="show-view" data-view="company-skill-submit">${iconSvg("upload")}<span>提交技能审核</span></button>`)}
    <div class="company-submission-list">
      ${companySkillState.submissions.length ? companySkillState.submissions.map((item) => `<article class="company-submission-row">
        <span class="company-submission-icon">${iconSvg(item.status === "approved" ? "circle-check" : (item.status === "rejected" ? "triangle-alert" : "history"))}</span>
        <div><strong>${escapeHtml(item.enterpriseDisplayName || item.displayName)}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.enterpriseCategory || item.category)}</small>${item.enterpriseDisplayName ? `<p>个人技能名称：${escapeHtml(item.displayName)}</p>` : ""}${item.rejectionReason ? `<p>驳回原因：${escapeHtml(item.rejectionReason)}</p>` : ""}</div>
        <span class="company-submission-status ${escapeHtml(item.status)}">${escapeHtml(companySkillStatusLabel(item.status))}</span>
        ${item.status === "pending" ? `<button class="secondary-button company-submission-withdraw" type="button" data-withdraw-skill-submission="${escapeHtml(item.submissionId)}" data-state-version="${Number(item.stateVersion || 1)}">撤回</button>` : ""}
        <time>${escapeHtml(formatUpdateDate(item.submittedAt))}</time>
      </article>`).join("") : `<div class="company-empty"><span>${iconSvg("history")}</span><h2>还没有提交记录</h2><p>创建标准技能包后，可以在这里提交审核。</p><button class="primary-button" type="button" data-action="show-view" data-view="company-skill-create">创建公司技能</button></div>`}
    </div>
  `;
}

function renderSearchPage() {
  els.pageContent.innerHTML = `
    ${renderPageHeader("搜索", "搜索技能、历史任务与自动化。")}
    <div class="page-search">
      <span class="search-symbol">${iconSvg("search")}</span>
      <input type="text" placeholder="输入关键词" data-search-input value="${escapeHtml(state.searchQuery)}" autofocus>
    </div>
    <div id="searchResults">${renderSearchResultsHtml()}</div>
  `;
}

function renderSearchResultsHtml() {
  const query = state.searchQuery.trim().toLowerCase();
  const backendScheduledTasks = getScheduledTasks();
  const backendTaskRuns = getTaskRuns();
  const skillResults = skills
    .filter((skill) => matchQuery(query, [skill.name, skill.description, skill.category, skill.shortName]))
    .map((skill) => ({
      type: "技能",
      title: skill.name,
      desc: skill.description,
      icon: skill.icon,
      action: `data-use-skill="${escapeHtml(skill.id)}"`
    }));

  const historyResults = state.conversations
    .filter((conversation) => matchQuery(query, [conversation.title, conversation.messages.map((message) => message.content).join(" ")]))
    .slice(0, 8)
    .map((conversation) => ({
      type: "历史任务",
      title: conversation.title,
      desc: conversation.messages.at(-1)?.content || "还没有消息",
      icon: "history",
      action: `data-conversation="${escapeHtml(conversation.id)}"`
    }));

  const taskRunResults = backendTaskRuns
    .filter((task) => matchQuery(query, [task.title, task.description, task.status, task.skillId]))
    .slice(0, 12)
    .map((task) => ({
      type: "执行结果",
      title: task.title,
      desc: task.description || task.status,
      icon: "circle-check",
      action: `data-open-task-run="${escapeHtml(task.id)}"`
    }));

  const scheduledResults = backendScheduledTasks
    .filter((task) => matchQuery(query, [task.name, task.description, task.status]))
    .map((task) => ({
      type: "自动化",
      title: task.name,
      desc: task.description,
      icon: "calendar-clock",
      action: `data-action="show-view" data-view="scheduled"`
    }));

  if (!query) {
    return renderResultGroup("技能", skillResults);
  }

  const html = [
    renderResultGroup("技能", skillResults),
    renderResultGroup("历史任务", historyResults),
    renderResultGroup("执行结果", taskRunResults),
    renderResultGroup("自动化", scheduledResults)
  ].filter(Boolean).join("");

  return html || `
    <div class="empty-state">
      <div class="empty-title">没有找到相关结果</div>
      <p>换个关键词试试，或直接新建对话描述你的需求。</p>
    </div>
  `;
}

function renderResultGroup(title, items) {
  if (!items.length) return "";
  return `
    <section class="result-group">
      <div class="section-title">${escapeHtml(title)}</div>
      <div class="result-list">
        ${items.map((item) => `
          <button class="result-item" type="button" ${item.action}>
            <span class="result-icon">${iconSvg(item.icon)}</span>
            <span class="result-copy">
              <span class="result-title">${escapeHtml(item.title)}</span>
              <span class="result-desc">${escapeHtml(previewText(item.desc))}</span>
            </span>
            <span class="result-type">${escapeHtml(item.type)}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function matchQuery(query, values) {
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function getScheduledTasks() {
  return Array.isArray(state.scheduledTasks) ? state.scheduledTasks : [];
}

function getTaskRuns() {
  return Array.isArray(state.taskRuns) ? state.taskRuns : [];
}

async function refreshWorkData(options = {}) {
  if (!window.desktopBridge?.getWorkData) {
    return;
  }
  try {
    const data = await window.desktopBridge.getWorkData({ userId: state.session?.userId || "local-user" });
    state.scheduledTasks = Array.isArray(data?.scheduledTasks) ? data.scheduledTasks : [];
    state.taskRuns = Array.isArray(data?.taskRuns) ? data.taskRuns : [];
    if (!options.silent) {
      render();
    }
  } catch (error) {
    if (!options.silent) {
      showToast(error.message || "任务数据读取失败");
    }
  }
}

async function refreshRuntimeConfig() {
  const runtimeConfig = await readSafeAiRuntimeConfig();
  state.modelOptions = Array.isArray(runtimeConfig?.models) ? runtimeConfig.models : [];
  if (runtimeConfig?.model && state.config.modelSelectionExplicit !== true) state.config.model = runtimeConfig.model;
  saveState();
  renderModelPicker();
}

function closeArtifactPreview() {
  currentArtifactPreview = null;
  artifactImagePreviewState = null;
  els.artifactPreviewModal?.classList.add("hidden");
  if (els.artifactPreviewContent) {
    els.artifactPreviewContent.classList.remove("is-image");
    els.artifactPreviewContent.innerHTML = "";
  }
}

const ARTIFACT_IMAGE_MIN_ZOOM = 0.05;
const ARTIFACT_IMAGE_MAX_ZOOM = 4;

function artifactImagePreviewElements() {
  return {
    viewport: els.artifactPreviewContent?.querySelector("[data-artifact-image-viewport]"),
    image: els.artifactPreviewContent?.querySelector("[data-artifact-preview-image]"),
    zoomValue: els.artifactPreviewContent?.querySelector("[data-artifact-zoom-value]")
  };
}

function renderArtifactImageTransform() {
  if (!artifactImagePreviewState) return;
  const { image, zoomValue } = artifactImagePreviewElements();
  if (!image) return;
  const { x, y, rotation, zoom } = artifactImagePreviewState;
  image.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rotation}deg) scale(${zoom})`;
  if (zoomValue) zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function setArtifactImageZoom(nextZoom, anchor = null) {
  if (!artifactImagePreviewState) return;
  const { viewport } = artifactImagePreviewElements();
  const previousZoom = artifactImagePreviewState.zoom;
  const zoom = Math.min(ARTIFACT_IMAGE_MAX_ZOOM, Math.max(ARTIFACT_IMAGE_MIN_ZOOM, Math.round(Number(nextZoom) * 100) / 100));
  if (anchor && viewport && previousZoom > 0 && zoom !== previousZoom) {
    const bounds = viewport.getBoundingClientRect();
    const anchorX = anchor.clientX - bounds.left - bounds.width / 2;
    const anchorY = anchor.clientY - bounds.top - bounds.height / 2;
    const ratio = zoom / previousZoom;
    artifactImagePreviewState.x = anchorX - (anchorX - artifactImagePreviewState.x) * ratio;
    artifactImagePreviewState.y = anchorY - (anchorY - artifactImagePreviewState.y) * ratio;
  }
  artifactImagePreviewState.zoom = zoom;
  renderArtifactImageTransform();
}

function fitArtifactPreviewImage() {
  if (!artifactImagePreviewState) return;
  const { viewport, image } = artifactImagePreviewElements();
  if (!viewport || !image || !image.naturalWidth || !image.naturalHeight) return;
  const bounds = viewport.getBoundingClientRect();
  const quarterTurn = Math.abs(artifactImagePreviewState.rotation % 180) === 90;
  const imageWidth = quarterTurn ? image.naturalHeight : image.naturalWidth;
  const imageHeight = quarterTurn ? image.naturalWidth : image.naturalHeight;
  const availableWidth = Math.max(1, bounds.width - 40);
  const availableHeight = Math.max(1, bounds.height - 32);
  artifactImagePreviewState.zoom = Math.min(1, Math.max(ARTIFACT_IMAGE_MIN_ZOOM, Math.min(availableWidth / imageWidth, availableHeight / imageHeight)));
  artifactImagePreviewState.x = 0;
  artifactImagePreviewState.y = 0;
  renderArtifactImageTransform();
}

function rotateArtifactPreviewImage(delta) {
  if (!artifactImagePreviewState) return;
  artifactImagePreviewState.rotation = (artifactImagePreviewState.rotation + delta + 360) % 360;
  fitArtifactPreviewImage();
}

function bindArtifactImagePreviewInteractions() {
  const { viewport, image } = artifactImagePreviewElements();
  if (!viewport || !image || !artifactImagePreviewState) return;
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setArtifactImageZoom(artifactImagePreviewState.zoom + (event.deltaY < 0 ? 0.1 : -0.1), event);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !artifactImagePreviewState) return;
    artifactImagePreviewState.dragging = true;
    artifactImagePreviewState.pointerId = event.pointerId;
    artifactImagePreviewState.pointerX = event.clientX;
    artifactImagePreviewState.pointerY = event.clientY;
    artifactImagePreviewState.startX = artifactImagePreviewState.x;
    artifactImagePreviewState.startY = artifactImagePreviewState.y;
    viewport.setPointerCapture?.(event.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!artifactImagePreviewState?.dragging || event.pointerId !== artifactImagePreviewState.pointerId) return;
    artifactImagePreviewState.x = artifactImagePreviewState.startX + event.clientX - artifactImagePreviewState.pointerX;
    artifactImagePreviewState.y = artifactImagePreviewState.startY + event.clientY - artifactImagePreviewState.pointerY;
    renderArtifactImageTransform();
  });
  const stopDragging = (event) => {
    if (!artifactImagePreviewState?.dragging) return;
    artifactImagePreviewState.dragging = false;
    viewport.releasePointerCapture?.(event.pointerId);
    viewport.classList.remove("dragging");
  };
  viewport.addEventListener("pointerup", stopDragging);
  viewport.addEventListener("pointercancel", stopDragging);
  image.addEventListener("load", fitArtifactPreviewImage, { once: true });
}

function showArtifactPreview(result) {
  if (!result || result.previewType === "window") {
    showToast("已在应用内打开预览");
    return;
  }
  currentArtifactPreview = result;
  els.artifactPreviewTitle.textContent = result.name || "文件预览";
  const isImage = result.previewType === "image";
  els.artifactPreviewContent.classList.toggle("is-image", isImage);
  els.artifactDownloadButton.hidden = isImage;
  if (isImage) {
    artifactImagePreviewState = { zoom: 1, rotation: 0, x: 0, y: 0, dragging: false, pointerId: null, pointerX: 0, pointerY: 0, startX: 0, startY: 0 };
    els.artifactPreviewContent.innerHTML = `
      <div class="artifact-preview-image-workspace">
        <div class="artifact-preview-image-viewport" data-artifact-image-viewport tabindex="0" aria-label="图片预览，可滚轮缩放并拖拽查看">
          <img class="artifact-preview-image" data-artifact-preview-image src="${escapeHtml(result.dataUrl)}" alt="${escapeHtml(result.name || "图片预览")}">
        </div>
        <div class="artifact-preview-image-toolbar" role="toolbar" aria-label="图片查看工具">
          <button class="artifact-image-tool-button" type="button" data-action="artifact-image-zoom-out" title="缩小" aria-label="缩小">${iconSvg("minus")}</button>
          <button class="artifact-image-zoom-value" type="button" data-action="artifact-image-fit" data-artifact-zoom-value title="适应窗口" aria-label="适应窗口">100%</button>
          <button class="artifact-image-tool-button" type="button" data-action="artifact-image-zoom-in" title="放大" aria-label="放大">${iconSvg("plus")}</button>
          <span class="artifact-image-toolbar-divider" aria-hidden="true"></span>
          <button class="artifact-image-tool-button" type="button" data-action="artifact-image-rotate-left" title="向左旋转" aria-label="向左旋转">${iconSvg("rotate-ccw")}</button>
          <button class="artifact-image-tool-button" type="button" data-action="artifact-image-rotate-right" title="向右旋转" aria-label="向右旋转">${iconSvg("rotate-cw")}</button>
          <span class="artifact-image-toolbar-divider" aria-hidden="true"></span>
          <button class="artifact-image-tool-button" type="button" data-action="artifact-download-current" title="下载" aria-label="下载">${iconSvg("download")}</button>
        </div>
      </div>`;
  } else if (result.previewType === "media") {
    artifactImagePreviewState = null;
    const mediaTag = result.mediaType === "audio" ? "audio" : "video";
    els.artifactPreviewContent.innerHTML = `
      <div class="artifact-preview-media-wrap">
        <${mediaTag} class="artifact-preview-media" src="${escapeHtml(result.url)}" controls preload="metadata"></${mediaTag}>
        <strong>${escapeHtml(result.name || "媒体文件")}</strong>
        <span>${escapeHtml([fileKindLabel(result), formatFileBytes(result.bytes)].filter(Boolean).join(" · "))}</span>
      </div>
    `;
  } else if (result.previewType === "text") {
    artifactImagePreviewState = null;
    els.artifactPreviewContent.innerHTML = `<pre class="artifact-preview-text">${escapeHtml(result.content || "")}</pre>`;
  } else {
    artifactImagePreviewState = null;
    els.artifactPreviewContent.innerHTML = `
      <div class="artifact-preview-file">
        <span class="artifact-preview-file-icon">${iconSvg(fileIconName(result))}</span>
        <strong>${escapeHtml(result.name || "文件")}</strong>
        <span>${escapeHtml([fileKindLabel(result), formatFileBytes(result.bytes)].filter(Boolean).join(" · "))}</span>
        <code>${escapeHtml(result.path || "")}</code>
      </div>
    `;
  }
  els.artifactPreviewModal.classList.remove("hidden");
  if (isImage) {
    bindArtifactImagePreviewInteractions();
    const { image } = artifactImagePreviewElements();
    requestAnimationFrame(() => {
      if (image?.complete) fitArtifactPreviewImage();
    });
  }
}

async function openMessageFile(filePath) {
  if (!filePath || !window.desktopBridge?.previewArtifact) return;
  try {
    showArtifactPreview(await window.desktopBridge.previewArtifact(filePath));
  } catch (error) {
    showToast(error.message || "文件预览失败");
  }
}

async function copyArtifactPath(filePath) {
  if (!filePath || !window.desktopBridge?.copyArtifact) return;
  try {
    const result = await window.desktopBridge.copyArtifact(filePath);
    showToast(result?.copiedAs === "image" ? "图片已复制" : "文件已复制");
  } catch (error) {
    showToast(error.message || "复制失败");
  }
}

async function downloadArtifactPath(filePath) {
  if (!filePath || !window.desktopBridge?.downloadArtifact) return;
  try {
    const result = await window.desktopBridge.downloadArtifact(filePath);
    if (!result?.canceled) {
      showToast(result?.renamedBecauseBusy
        ? `同名文件正在使用，已另存为 ${baseName(result.path)}`
        : `已保存到 ${baseName(result.path)}`);
    }
  } catch (error) {
    const message = String(error?.message || "").replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
    showToast(message || "下载失败");
  }
}

function openTaskRun(taskId) {
  const record = getTaskRuns().find((item) => item.id === taskId);
  if (!record) {
    showToast("没有找到该执行结果");
    return;
  }
  const skill = skills.find((item) => item.id === record.skillId);
  state.activeView = "task-result";
  state.taskResult = {
    id: record.id,
    recordId: record.id,
    skillId: record.skillId,
    userMsg: record.title,
    historyTitle: record.title,
    statusText: record.status || "已完成",
    doneSteps: ["已读取任务仓库", "已找到结果文件"],
    resultTitle: record.title,
    resultBody: record.description || "结果文件已生成。",
    resultText: record.resultText || record.description || "",
    resultType: record.resultType || "document",
    artifacts: record.artifacts || [],
    folderPath: record.folderPath,
    primaryPath: record.primaryPath,
    persisted: true,
    finished: true,
    downloadLabel: skill?.id === "weekly" ? "下载为 Word" : "下载文件"
  };
  saveState();
  render();
}

function localDateTimeInputValue(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAutomationDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function automationScheduleText(task) {
  if (task.frequency === "once") return `单次 · ${formatAutomationDateTime(task.runAt)}`;
  if (task.frequency === "interval") return `每 ${Number(task.intervalHours || 1)} 小时`;
  if (task.frequency === "daily") return `每天 ${task.time || "09:00"}`;
  const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const days = (task.weekdays || []).map((day) => weekdayNames[Number(day) - 1]).filter(Boolean).join("、");
  return `${days || "周一"} ${task.time || "09:00"}`;
}

function automationModelLabel(value) {
  return state.modelOptions.find((item) => item.value === value)?.label || (value === "auto" ? "Auto 自动选择" : value || "Auto 自动选择");
}

function createAutomationDraft(task = null) {
  return {
    id: task?.id || "",
    name: task?.name || "",
    workspacePath: task?.workspacePath || "",
    prompt: task?.prompt || "",
    model: task?.model || "auto",
    skillId: task?.skillId || "",
    frequency: ["daily", "weekly", "interval", "once"].includes(task?.frequency) ? task.frequency : "daily",
    time: task?.time || "09:00",
    weekdays: Array.isArray(task?.weekdays) && task.weekdays.length ? [...task.weekdays] : [1, 2, 3, 4, 5],
    intervalHours: Math.max(1, Number(task?.intervalHours || 1)),
    runAt: localDateTimeInputValue(task?.runAt),
    startDate: task?.startDate || "",
    endDate: task?.endDate || "",
    enabled: task?.enabled !== false
  };
}

function openAutomationEditor(taskId = "") {
  const task = taskId ? getScheduledTasks().find((item) => item.id === taskId) : null;
  if (taskId && !task) {
    showToast("没有找到该自动化任务");
    return;
  }
  automationEditorDraft = createAutomationDraft(task);
  automationPickerState = { open: "", query: "" };
  state.activeView = "automation-editor";
  saveState();
  render();
  window.setTimeout(() => els.pageContent.querySelector('[data-automation-field="name"]')?.focus(), 0);
}

function closeAutomationEditor() {
  automationEditorDraft = null;
  automationPickerState = { open: "", query: "" };
  showView("scheduled");
}

async function saveAutomationEditor() {
  if (!window.desktopBridge?.saveAutomation || !automationEditorDraft) return;
  const skill = skills.find((item) => item.id === automationEditorDraft.skillId);
  try {
    const result = await window.desktopBridge.saveAutomation({
      userId: state.session?.userId || "local-user",
      task: {
        ...automationEditorDraft,
        intervalHours: Number(automationEditorDraft.intervalHours || 1),
        skillName: skill?.name || "",
        skillSystemPrompt: skill?.systemPrompt || "",
        runAt: automationEditorDraft.frequency === "once" ? automationEditorDraft.runAt : ""
      }
    });
    state.scheduledTasks = Array.isArray(result?.store?.scheduledTasks) ? result.store.scheduledTasks : state.scheduledTasks;
    automationEditorDraft = null;
    automationPickerState = { open: "", query: "" };
    state.activeView = "scheduled";
    saveState();
    render();
    showToast("定时任务已保存");
  } catch (error) {
    showToast(error.message || "自动化保存失败");
  }
}

async function toggleAutomation(taskId, enabled) {
  try {
    await window.desktopBridge?.setAutomationEnabled?.({ userId: state.session?.userId || "local-user", taskId, enabled });
    await refreshWorkData({ silent: true });
    renderScheduledPage();
  } catch (error) {
    showToast(error.message || "自动化状态修改失败");
    renderScheduledPage();
  }
}

async function runAutomationNow(taskId) {
  const task = getScheduledTasks().find((item) => item.id === taskId);
  showToast(task?.status === "已暂停" ? "自动化正在继续执行" : "自动化已开始运行，可继续使用其他页面");
  try {
    await window.desktopBridge?.runAutomationNow?.({ userId: state.session?.userId || "local-user", taskId });
    await refreshWorkData({ silent: true });
    if (state.activeView === "scheduled") renderScheduledPage();
  } catch (error) {
    showToast(error.message || "自动化执行失败");
  }
}

async function pauseAutomationNow(taskId) {
  const selector = `[data-automation-pause="${CSS.escape(taskId)}"]`;
  const button = els.pageContent.querySelector(selector);
  if (button) button.disabled = true;
  showToast("正在暂停自动化任务…");
  try {
    const result = await window.desktopBridge?.pauseAutomation?.({ userId: state.session?.userId || "local-user", taskId });
    await refreshWorkData({ silent: true });
    if (state.activeView === "scheduled") renderScheduledPage();
    showToast(result?.paused ? "自动化已暂停" : "任务已在暂停前完成");
  } catch (error) {
    showToast(error.message || "自动化暂停失败");
    if (state.activeView === "scheduled") renderScheduledPage();
  }
}

async function deleteAutomation(taskId) {
  const task = getScheduledTasks().find((item) => item.id === taskId);
  if (!task || !window.confirm(`确定删除自动化“${task.name}”吗？已有执行结果会继续保留。`)) return;
  try {
    await window.desktopBridge?.deleteAutomation?.({ userId: state.session?.userId || "local-user", taskId });
    await refreshWorkData({ silent: true });
    renderScheduledPage();
    showToast("自动化已删除");
  } catch (error) {
    showToast(error.message || "自动化删除失败");
  }
}

let scheduledFilter = "all";
let scheduledHistoryId = "";
function scheduledTaskStatus(task) {
  if (task.status === "已完成" && !task.enabled) return "completed";
  return task.missedAt || task.status === "已错过" ? "missed" : !task.enabled && task.status !== "运行中" ? "paused" : "running";
}
function renderScheduledHistory() {
  const task = getScheduledTasks().find(item => item.id === scheduledHistoryId);
  if (!task) return "";
  const runs = getTaskRuns().filter(run => run.automationId === task.id);
  return `<div class="schedule-overlay"><section class="schedule-history" role="dialog" aria-modal="true" aria-label="运行记录"><header><div><h2>${escapeHtml(task.name)}</h2><p>运行记录 · ${runs.length} 次</p></div><button class="automation-icon-button" data-schedule-close title="关闭" aria-label="关闭">${iconSvg("x")}</button></header><div class="schedule-history-list">${runs.length ? runs.map(run => `<article><header><strong>${escapeHtml(run.status)}</strong><time>${escapeHtml(formatAutomationDateTime(run.createdAt))}</time></header><small>${run.trigger === "manual" ? "手动运行" : "按计划运行"}</small><p>${escapeHtml(run.resultText || run.description || "正在执行任务…")}</p>${(run.artifacts || []).length ? `<button class="secondary-button" data-open-task-run="${escapeHtml(run.id)}">${iconSvg("file-text")}查看结果文件</button>` : ""}</article>`).join("") : '<div class="automation-empty">暂无运行记录</div>'}</div></section></div>`;
}
function renderScheduledPage() {
  const allTasks = getScheduledTasks();
  const backendScheduledTasks = allTasks.filter(task => scheduledFilter === "all" || scheduledTaskStatus(task) === scheduledFilter);
  const recentRuns = getTaskRuns().filter(run => run.automationId).slice(0, 8);
  els.pageContent.innerHTML = `
    ${renderPageHeader("定时任务", "", `<button class="page-header-action primary-button" type="button" data-action="new-automation">${iconSvg("plus")}<span>新建任务</span></button>`)}
    <div class="schedule-notice">${iconSvg("info")}<span>客户端在线或在托盘运行时执行；离线错过的计划可手动补跑。</span></div>
    <div class="schedule-filters" role="tablist">${[["all","全部"],["running","运行中"],["paused","已暂停"],["missed","已错过"]].map(([key,label])=>`<button role="tab" aria-selected="${key === scheduledFilter}" class="${key === scheduledFilter ? "active" : ""}" data-schedule-filter="${key}">${label}<small>${key === "all" ? allTasks.length : allTasks.filter(task=>scheduledTaskStatus(task) === key).length}</small></button>`).join("")}</div>
    ${backendScheduledTasks.length ? `
      <div class="automation-list">
        ${backendScheduledTasks.map((task) => {
          const skill = skills.find((item) => item.id === task.skillId);
          const isRunning = task.status === "运行中";
          const isPaused = !task.enabled && task.status !== "已完成";
          const nextRun = task.nextRunAt ? `下次 ${formatAutomationDateTime(task.nextRunAt)}` : (task.enabled ? "等待下次时间" : "已停用");
          const currentStatus = isRunning ? "正在执行" : (isPaused ? "已暂停 · 点击继续执行" : nextRun);
          return `
            <article class="automation-card ${isRunning ? "running" : ""} ${isPaused ? "paused" : ""}">
              <div class="scheduled-main">
                <div class="scheduled-icon">${iconSvg(skill?.icon || "calendar-clock")}</div>
                <div class="automation-card-copy">
                  <div class="scheduled-title">${escapeHtml(task.name)}<small class="schedule-status">${isRunning ? "执行中" : task.missedAt ? "已错过" : task.status === "已完成" ? "已完成" : isPaused ? "已暂停" : "运行中"}</small></div>
                  <div class="scheduled-desc">${escapeHtml(task.prompt)}</div>
                  <div class="scheduled-desc">${escapeHtml([automationScheduleText(task), task.skillName || "无指定技能", automationModelLabel(task.model)].join(" · "))}</div>
                  <div class="automation-next-run">${escapeHtml(currentStatus)}${task.lastStatus && !isPaused ? ` · 上次${escapeHtml(task.lastStatus)}` : ""}</div>
                </div>
              </div>
              <div class="automation-actions">
                <button class="automation-icon-button" type="button" data-schedule-history="${escapeHtml(task.id)}" title="运行记录" aria-label="运行记录">${iconSvg("history")}</button>
                <label class="toggle-control automation-toggle" title="${task.enabled ? "停用" : "启用"}">
                  <input type="checkbox" data-automation-toggle="${escapeHtml(task.id)}" ${task.enabled ? "checked" : ""} ${isRunning ? "disabled" : ""}>
                  <span></span>
                </label>
                ${isRunning
                  ? `<button class="automation-icon-button pause" type="button" data-automation-pause="${escapeHtml(task.id)}" title="暂停执行" aria-label="暂停执行">${iconSvg("pause")}</button>`
                  : `<button class="automation-icon-button" type="button" data-automation-run="${escapeHtml(task.id)}" title="${isPaused ? "继续执行" : "立即运行"}" aria-label="${isPaused ? "继续执行" : "立即运行"}">${iconSvg("play")}</button>`}
                <button class="automation-icon-button" type="button" data-automation-edit="${escapeHtml(task.id)}" title="编辑" aria-label="编辑" ${isRunning ? "disabled" : ""}>${iconSvg("square-pen")}</button>
                <button class="automation-icon-button danger" type="button" data-automation-delete="${escapeHtml(task.id)}" title="删除" aria-label="删除" ${isRunning ? "disabled" : ""}>${iconSvg("trash-2")}</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    ` : `
      <div class="automation-empty">
        <span>${iconSvg("calendar-clock")}</span>
        <strong>${allTasks.length ? "暂无此状态的任务" : "还没有定时任务"}</strong>
        <button class="secondary-button" type="button" data-action="new-automation">${iconSvg("plus")}<span>新建任务</span></button>
      </div>
    `}
    ${recentRuns.length ? `
      <div class="section-title automation-results-title">最近结果</div>
      <div class="result-list">
        ${recentRuns.map((task) => `
          <button class="result-item" type="button" data-open-task-run="${escapeHtml(task.id)}">
            <span class="result-icon">${iconSvg(task.status === "失败" ? "triangle-alert" : (task.status === "已暂停" ? "pause" : "circle-check"))}</span>
            <span class="result-copy">
              <span class="result-title">${escapeHtml(task.title)}</span>
              <span class="result-desc">${escapeHtml(previewText(task.description || task.status))}</span>
            </span>
            <span class="result-type">${escapeHtml(task.status || "已完成")}</span>
          </button>
        `).join("")}
      </div>
    ` : ""}
    ${renderScheduledHistory()}
  `;
  els.pageContent.querySelectorAll("[data-schedule-filter]").forEach(button => button.addEventListener("click", () => { scheduledFilter = button.dataset.scheduleFilter; renderScheduledPage(); }));
  els.pageContent.querySelectorAll("[data-schedule-history]").forEach(button => button.addEventListener("click", () => { scheduledHistoryId = button.dataset.scheduleHistory; renderScheduledPage(); }));
  els.pageContent.querySelector("[data-schedule-close]")?.addEventListener("click", () => { scheduledHistoryId = ""; renderScheduledPage(); });
}

function automationWeekdaySelector(selected = []) {
  const names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return `
    <div class="automation-weekdays" aria-label="执行星期">
      ${names.map((name, index) => `
        <label class="automation-weekday ${selected.includes(index + 1) ? "selected" : ""}">
          <input type="checkbox" data-automation-weekday="${index + 1}" ${selected.includes(index + 1) ? "checked" : ""}>
          <span>${name}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function automationPickerOptions(field) {
  if (field === "model") {
    const models = state.modelOptions.length ? state.modelOptions : [{ label: "Auto 自动选择", value: "auto" }];
    return models.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.value === "auto" ? "根据任务自动选择合适模型" : "使用此模型执行自动化",
      icon: item.value === "auto" ? "sparkles" : "zap"
    }));
  }
  return [
    { value: "", label: "不使用技能", description: "仅按提示词执行", icon: "x-circle" },
    ...skills.filter((skill) => skill.userInvocable !== false).map((skill) => ({
      value: skill.id,
      label: skill.name,
      description: skill.description || "使用此技能执行自动化",
      icon: skill.icon || "sparkles"
    }))
  ];
}

function automationPickerOptionsHtml(field, selectedValue, query = "") {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
  const visibleOptions = automationPickerOptions(field).filter((item) => (
    !normalizedQuery || `${item.label} ${item.value} ${item.description}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
  ));
  if (!visibleOptions.length) {
    return `<div class="automation-picker-empty">没有找到匹配项</div>`;
  }
  return visibleOptions.map((item) => {
    const selected = String(item.value) === String(selectedValue || "");
    return `
      <button class="automation-picker-option ${selected ? "selected" : ""}" type="button" role="option" aria-selected="${selected}" data-automation-picker-option="${escapeHtml(field)}" data-value="${escapeHtml(item.value)}">
        <span class="automation-picker-option-icon">${iconSvg(item.icon)}</span>
        <span class="automation-picker-option-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span>
        <span class="automation-picker-option-check">${selected ? iconSvg("check") : ""}</span>
      </button>
    `;
  }).join("");
}

function renderAutomationPicker(field, label, selectedValue) {
  const options = automationPickerOptions(field);
  const selected = options.find((item) => String(item.value) === String(selectedValue || "")) || options[0];
  const open = automationPickerState.open === field;
  const query = open ? automationPickerState.query : "";
  return `
    <div class="automation-picker-field ${open ? "open" : ""}" data-automation-picker="${escapeHtml(field)}">
      <span class="automation-picker-label" id="automation-${escapeHtml(field)}-label">${escapeHtml(label)}</span>
      <div class="automation-picker-shell">
        <button class="automation-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded="${open}" aria-labelledby="automation-${escapeHtml(field)}-label" data-automation-picker-toggle="${escapeHtml(field)}">
          <span class="automation-picker-trigger-icon">${iconSvg(selected.icon)}</span>
          <span class="automation-picker-trigger-copy"><strong>${escapeHtml(selected.label)}</strong><small>${escapeHtml(selected.description)}</small></span>
          <span class="automation-picker-trigger-arrow">${iconSvg("chevron-down")}</span>
        </button>
        ${open ? `
          <div class="automation-picker-popover" role="presentation">
            <label class="automation-picker-search">
              ${iconSvg("search")}
              <input type="search" autocomplete="off" placeholder="搜索${escapeHtml(label)}" value="${escapeHtml(query)}" data-automation-picker-search="${escapeHtml(field)}" aria-label="搜索${escapeHtml(label)}">
            </label>
            <div class="automation-picker-options" role="listbox" data-automation-picker-options="${escapeHtml(field)}">
              ${automationPickerOptionsHtml(field, selectedValue, query)}
            </div>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function closeAutomationPicker() {
  if (!automationPickerState.open) return;
  automationPickerState = { open: "", query: "" };
  document.querySelectorAll("[data-automation-picker]").forEach((picker) => picker.classList.remove("open"));
  document.querySelectorAll("[data-automation-picker-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  document.querySelectorAll(".automation-picker-popover").forEach((popover) => popover.remove());
}

function renderAutomationEditorPage() {
  if (!automationEditorDraft) automationEditorDraft = createAutomationDraft();
  const draft = automationEditorDraft;
  const periodic = draft.frequency === "daily" || draft.frequency === "weekly";
  scheduledHistoryId = "";
  renderScheduledPage();
  els.pageContent.insertAdjacentHTML("beforeend", `<div class="schedule-overlay"><section class="schedule-editor" role="dialog" aria-modal="true" aria-label="${draft.id ? "编辑任务" : "新建任务"}">
    <div class="automation-editor-header">
      <div><h1>${draft.id ? "编辑任务" : "新建任务"}</h1></div>
      <div class="automation-editor-actions"><button class="secondary-button" type="button" data-action="cancel-automation-editor">取消</button><button class="primary-button" type="button" data-action="save-automation">保存</button></div>
    </div>
    <div class="automation-form">
      <label class="automation-field"><span>名称</span><input type="text" maxlength="80" data-automation-field="name" value="${escapeHtml(draft.name)}" placeholder="例如：每天整理销售日报"></label>
      <label class="automation-field"><span>工作目录 <small>可选</small></span><div class="automation-workspace-input"><input type="text" data-automation-field="workspacePath" value="${escapeHtml(draft.workspacePath)}" placeholder="选择任务需要使用的本机文件夹"><button class="secondary-button" type="button" data-action="choose-automation-workspace">${iconSvg("folder-open")}<span>选择</span></button></div></label>
      <label class="automation-field"><span>任务指令</span><textarea rows="3" maxlength="40000" data-automation-field="prompt" placeholder="描述每次需要完成的任务">${escapeHtml(draft.prompt)}</textarea></label>
      <div class="automation-capabilities">
        ${renderAutomationPicker("model", "模型", draft.model)}
        ${renderAutomationPicker("skillId", "技能", draft.skillId)}
      </div>
      <fieldset class="automation-field automation-schedule-field"><legend>执行频率</legend>
        <div class="automation-frequency-tabs">
          <button type="button" data-automation-frequency="once" class="${draft.frequency === "once" ? "active" : ""}">单次</button>
          <button type="button" data-automation-frequency="daily" class="${draft.frequency === "daily" ? "active" : ""}">每天</button>
          <button type="button" data-automation-frequency="weekly" class="${draft.frequency === "weekly" ? "active" : ""}">每周</button>
          ${draft.frequency === "interval" ? '<button type="button" data-automation-frequency="interval" class="active">按间隔</button>' : ""}
        </div>
        ${periodic ? `
          <div class="automation-schedule-row">
            <input type="time" data-automation-field="time" value="${escapeHtml(draft.time)}">
          </div>
          ${draft.frequency === "weekly" ? automationWeekdaySelector(draft.weekdays) : ""}
        ` : draft.frequency === "interval" ? `
          <div class="automation-interval-row"><span>每</span><input type="number" min="1" max="8760" data-automation-field="intervalHours" value="${escapeHtml(draft.intervalHours)}"><span>小时</span></div>
          ${automationWeekdaySelector(draft.weekdays)}
        ` : `
          <div class="automation-schedule-row"><input type="datetime-local" data-automation-field="runAt" value="${escapeHtml(draft.runAt)}"></div>
        `}
      </fieldset>
      ${draft.frequency !== "once" ? `<div class="automation-field"><span>生效日期区间 <small>可选，留空表示始终生效</small></span><div class="automation-date-range"><input type="date" data-automation-field="startDate" value="${escapeHtml(draft.startDate)}"><span>至</span><input type="date" data-automation-field="endDate" value="${escapeHtml(draft.endDate)}"></div></div>` : ""}
    </div>
  </section></div>`);
}

function renderSkillFormPage(skillId) {
  const skill = skills.find((item) => item.id === skillId) || skills[0];
  const scenario = skillScenarios[skill.id] || {};
  const asideHtml = skill.id === "weekly"
    ? `
      <p>内容附件为选填项；附加说明会作为日报或周报的真实工作素材。</p>
      <p>系统不会补入默认事项，也不会编造未提供的项目和数据。</p>
      <p>生成后会直接返回正文和可复制、可下载的 Word 或文本文件。</p>
    `
    : `
      <p>当前版本会把你的参数和已选择文件路径带入对话，由企业模型服务先完成整理和生成。</p>
      <p>覆盖文件、批量删除、外发资料等高风险动作需要二次确认。</p>
      <p>${escapeHtml(scenario.needsConfirm ? "该技能会先弹出确认，再进入结果页。" : "该技能会直接进入结果页并显示生成状态。")}</p>
    `;
  els.pageContent.innerHTML = `
    ${renderPageHeader(skill.name, skill.description, `<button class="back-link" type="button" data-action="show-view" data-view="skills">${iconSvg("chevron-left")}<span>返回技能列表</span></button>`)}
    <div class="form-layout">
      <section class="form-card">
        <div class="form-hero">
          <div class="skill-icon large">${iconSvg(skill.icon)}</div>
          <div>
            <h2>${escapeHtml(skill.name)}</h2>
            <p>${escapeHtml(skill.description)}</p>
          </div>
        </div>
        ${renderSkillFormFields(skill)}
        <div class="form-actions">
          <button class="secondary-button" type="button" data-action="show-view" data-view="chat">取消</button>
          <button class="primary-button" type="button" data-submit-skill-form="${escapeHtml(skill.id)}">开始生成</button>
        </div>
      </section>
      <aside class="form-aside">
        <div class="aside-title">能力说明</div>
        ${asideHtml}
      </aside>
    </div>
  `;
}

function renderSkillFormFields(skill) {
  const fields = (Array.isArray(skill?.fields) ? skill.fields : []).filter((field) => field.type !== "file");
  const firstContentIndex = fields.findIndex((field) => field.type === "textarea");
  const insertionIndex = firstContentIndex >= 0 ? firstContentIndex : fields.length - 1;
  return fields.flatMap((field, index) => (
    index === insertionIndex ? [renderSkillField(field), renderSkillAttachmentField()] : [renderSkillField(field)]
  )).concat(fields.length ? [] : [renderSkillAttachmentField()]).join("");
}

function renderSkillAttachmentField() {
  const attachments = sanitizeAttachmentItems(state.selectedFiles);
  return `
    <div class="skill-field skill-attachment-field">
      <span>附件（选填）</span>
      <button class="file-picker skill-attachment-picker" type="button" data-skill-file-picker>
        <span>${iconSvg("paperclip")}</span>
        <span class="skill-attachment-picker-copy">
          <strong>添加文件</strong>
          <small>支持文档、表格、演示文稿、PDF、图片、压缩包、代码、视频、录音和音频</small>
        </span>
      </button>
      ${attachments.length ? `
        <div class="skill-attachment-list">
          ${attachments.map((file, index) => renderSkillAttachmentItem(file, index)).join("")}
        </div>
      ` : `<div class="skill-attachment-empty">可一次选择多个文件，也可以将文件拖入应用或从剪贴板粘贴。</div>`}
      <div class="skill-attachment-limit">技能输入不设置时间、次数或文件大小上限。大型文件会保留在本机，并按绝对路径交给技能处理；系统仅保留必要的路径安全检查。</div>
    </div>
  `;
}

function refreshSkillAttachmentField() {
  if (!state.activeView.startsWith("skill-form:")) return false;
  const currentField = els.pageContent.querySelector(".skill-attachment-field");
  if (!currentField) return false;
  const template = document.createElement("template");
  template.innerHTML = renderSkillAttachmentField().trim();
  const nextField = template.content.firstElementChild;
  if (!nextField) return false;
  currentField.replaceWith(nextField);
  return true;
}

function renderSkillAttachmentItem(file, index) {
  const extension = String(file.extension || "FILE").toUpperCase().slice(0, 8);
  const isImage = file.kind === "image" || /^image\//i.test(file.mimeType || "");
  const meta = [fileKindLabel(file), extension, formatFileBytes(file.bytes)].filter(Boolean).join(" · ");
  return `
    <article class="skill-attachment-item" title="${escapeHtml(file.absolutePath)}">
      ${isImage && file.previewDataUrl
        ? `<button class="skill-attachment-thumb" type="button" data-attachment-preview="${escapeHtml(file.absolutePath)}" aria-label="预览 ${escapeHtml(file.name)}"><img src="${escapeHtml(file.previewDataUrl)}" alt=""></button>`
        : `<span class="skill-attachment-icon">${iconSvg(fileIconName(file))}<small>${escapeHtml(extension || "FILE")}</small></span>`}
      <span class="skill-attachment-copy">
        <strong>${escapeHtml(file.name)}</strong>
        <small>${escapeHtml(meta)}</small>
        <code>${escapeHtml(file.absolutePath)}</code>
      </span>
      <span class="skill-attachment-actions">
        <button type="button" data-attachment-preview="${escapeHtml(file.absolutePath)}" title="应用内预览" aria-label="应用内预览">${iconSvg("eye")}</button>
        <button type="button" data-remove-file="${index}" title="移除附件" aria-label="移除附件">${iconSvg("x")}</button>
      </span>
    </article>
  `;
}

function renderTaskResultPage() {
  const result = state.taskResult || {
    historyTitle: "执行与结果",
    userMsg: "正在处理任务",
    statusText: "正在处理",
    resultTitle: "任务结果",
    resultBody: "结果将在任务完成后显示。",
    resultType: "document",
    doneSteps: []
  };
  const activeTask = result?.skillId ? skills.find((item) => item.id === result.skillId) : null;
  const stepItems = Array.isArray(result?.doneSteps) ? result.doneSteps : [];
  const pendingText = result?.statusText || "正在读取内容来源…";
  const resultBody = result?.resultBody || "已完成处理。";
  const rich = buildResultRichHtml(result);

  els.pageContent.innerHTML = `
    ${renderPageHeader(result?.historyTitle || "执行与结果", "任务正在处理中，步骤完成后会在结果卡展示可用输出。", `<button class="back-link" type="button" data-action="show-view" data-view="skills">${iconSvg("chevron-left")}<span>返回技能列表</span></button>`)}
    <div class="result-page">
      <section class="result-hero">
        <div class="result-user">${escapeHtml(result?.userMsg || "正在处理任务")}</div>
        <div class="status-bar ${result?.finished ? "done" : ""}" id="resultStatusBar">
          <span class="spinner">${result?.finished ? iconSvg("check") : ""}</span>
          <span id="resultStatusText">${escapeHtml(pendingText)}</span>
        </div>
        <div class="step-log">
          ${stepItems.map((step) => `<div class="step step-done"><span class="mark">${iconSvg("check")}</span>${escapeHtml(step)}</div>`).join("")}
        </div>
      </section>
      <section class="result-card show">
        <div class="rc-head">
          <div class="rc-icon">${iconSvg("check")}</div>
          <div class="rc-title">${escapeHtml(result?.resultTitle || "任务已完成")}</div>
        </div>
        <div class="rc-body" id="rc-body">${escapeHtml(resultBody)}</div>
        <div class="rc-rich" id="rc-rich">${rich}</div>
        <div class="rc-actions" id="rc-actions">${buildResultActions(result)}</div>
      </section>
      ${activeTask ? `<div class="empty-note">当前结果来源于「${escapeHtml(activeTask.name)}」技能。</div>` : ""}
    </div>
  `;
}

function buildResultRichHtml(result) {
  if (!result) return "";
  const bodyHtml = result.resultText
    ? `<div class="rc-textbox result-content-text" id="rc-textbox">${renderRichText(result.resultText)}</div>`
    : "";
  if (Array.isArray(result.artifacts) && result.artifacts.length) {
    const imageArtifacts = result.artifacts.filter((item) => item.type === "image" && item.src);
    const fileArtifacts = result.artifacts.filter((item) => item.type !== "image" || !item.src);
    const imageHtml = imageArtifacts.length ? `
      <div class="rc-imggrid">
        ${imageArtifacts.map((item) => `
          <div class="rc-thumb">
            <img class="rc-thumb-img" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.label || "处理结果")}">
            <div class="tb-bar">
              <button class="tb-btn" type="button" data-open-image-path="${escapeHtml(item.path)}">${iconSvg("eye")}<span>查看</span></button>
              <button class="tb-btn" type="button" data-artifact-copy="${escapeHtml(item.path)}">${iconSvg("copy")}<span>复制</span></button>
              <button class="tb-btn" type="button" data-artifact-download="${escapeHtml(item.path)}">${iconSvg("download")}<span>下载</span></button>
            </div>
          </div>
        `).join("")}
      </div>
    ` : "";
    const fileHtml = fileArtifacts.length ? `
      <div class="artifact-list">
        ${fileArtifacts.map((item) => `
          <div class="artifact-item-row">
            <button class="artifact-item" type="button" data-open-artifact-path="${escapeHtml(item.path)}">
              <span class="artifact-item-icon">${iconSvg(fileIconName(item))}</span>
              <span class="artifact-item-copy">
                <span>${escapeHtml(item.label || baseName(item.path))}</span>
                ${item.path ? `<code>${escapeHtml(item.path)}</code>` : ""}
              </span>
              <strong>${iconSvg("eye")}<span>预览</span></strong>
            </button>
            <span class="artifact-item-actions">
              <button type="button" data-artifact-copy="${escapeHtml(item.path)}" title="复制文件" aria-label="复制文件">${iconSvg("copy")}</button>
              <button type="button" data-artifact-download="${escapeHtml(item.path)}" title="下载文件" aria-label="下载文件">${iconSvg("download")}</button>
            </span>
          </div>
        `).join("")}
      </div>
    ` : "";
    return `${bodyHtml}${imageHtml}${fileHtml}`;
  }
  if (bodyHtml) return bodyHtml;
  if (result.resultType === "images" && result.imageCount) {
    const thumbs = Array.from({ length: result.imageCount }, (_, index) => `
      <div class="rc-thumb">
        <div class="ph c${(index % 3) + 1}">${iconSvg("image")}</div>
        <div class="tb-bar">
          <span class="tb-btn">${iconSvg("eye")}<span>查看</span></span>
          <span class="tb-btn">${iconSvg("download")}<span>下载</span></span>
        </div>
      </div>
    `).join("");
    return `<div class="rc-imggrid">${thumbs}</div>`;
  }
  return "";
}

function buildResultActions(result) {
  if (!result) {
    return `<button class="rc-btn" type="button" data-action="show-view" data-view="chat">${iconSvg("chevron-left")}<span>回到对话</span></button>`;
  }
  if (result.resultType === "text") {
    return `
      <button class="rc-btn" type="button" data-action="copy-result">${iconSvg("copy")}<span>复制全文</span></button>
      <button class="rc-btn" type="button" data-action="download-result">${iconSvg("download")}<span>下载为 Word</span></button>
    `;
  }
  if (result.resultType === "images") {
    return `
      <button class="rc-btn" type="button" data-action="download-result">${iconSvg("download")}<span>下载全部</span></button>
    `;
  }
  if (result.resultType === "skill") {
    return `
      <button class="rc-btn" type="button" data-action="copy-result">${iconSvg("copy")}<span>复制结果</span></button>
    `;
  }
  return `
    <button class="rc-btn" type="button" data-action="download-result">${iconSvg("download")}<span>${escapeHtml(result.downloadLabel || "下载文件")}</span></button>
  `;
}

function renderSkillField(field) {
  if (field.type === "textarea") {
    return `
      <label class="skill-field" data-form-field="${escapeHtml(field.id)}" data-field-type="textarea" data-field-label="${escapeHtml(field.label)}">
        <span>${escapeHtml(field.label)}</span>
        <textarea placeholder="${escapeHtml(field.placeholder || "")}"></textarea>
      </label>
    `;
  }

  if (field.type === "file") {
    return `
      <div class="skill-field" data-form-field="${escapeHtml(field.id)}" data-field-type="file" data-field-label="${escapeHtml(field.label)}">
        <span>${escapeHtml(field.label)}</span>
        <button class="file-picker" type="button" data-skill-file-picker>
          <span>${iconSvg("paperclip")}</span>
          <strong>${escapeHtml(field.hint || "点击选择文件")}</strong>
        </button>
        ${state.selectedFiles.length ? `<div class="selected-file-count">已选择 ${state.selectedFiles.length} 个附件</div>` : ""}
      </div>
    `;
  }

  const values = Array.isArray(field.value) ? field.value : [field.value];
  const readonly = field.readonly === true;
  return `
    <div class="skill-field" data-form-field="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}" data-field-label="${escapeHtml(field.label)}"${readonly ? ' data-field-readonly="true"' : ""}>
      <span>${escapeHtml(field.label)}</span>
      <div class="option-row${readonly ? " readonly" : ""}" ${field.type === "single" ? "data-single" : ""}${readonly ? ' aria-readonly="true"' : ""}>
        ${field.options.map((option) => readonly
          ? `<span class="option-pill readonly ${values.includes(option) ? "selected" : ""}" data-option-readonly>${escapeHtml(option)}</span>`
          : `<button class="option-pill ${values.includes(option) ? "selected" : ""}" type="button" data-option-pill>${escapeHtml(option)}</button>`
        ).join("")}
      </div>
    </div>
  `;
}

function renderHeader() {
  const conversation = activeConversation();
  const skill = activeSkill();
  els.conversationTitle.textContent = conversation.title || "新的对话";
  els.activeMode.textContent = skill ? `${skill.name}模式` : "普通对话";
}

function renderMessages() {
  const conversation = activeConversation();

  if (!conversation.messages.length) {
    els.messages.innerHTML = `
      <div class="welcome">
        <h2>有什么可以帮你的?</h2>
      </div>
    `;
    return;
  }

  els.messages.innerHTML = `
    <div class="messages-inner">
      ${conversation.messages.map(renderMessage).join("")}
    </div>
  `;
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function renderStarterGrid() {
  if (!els.starterGrid) return;
  const conversation = activeConversation();
  if (conversation.messages.length) {
    els.starterGrid.innerHTML = "";
    els.starterGrid.classList.add("hidden");
    return;
  }

  els.starterGrid.classList.remove("hidden");
  els.starterGrid.innerHTML = skills.filter((skill) => skill.id !== "browser").map((skill) => `
    <button class="starter-button" type="button" data-starter-skill="${skill.id}" data-starter-prompt="${escapeHtml(skill.starter)}">
      <span class="starter-icon">${iconSvg(skill.icon)}</span>
      <span class="starter-title">${escapeHtml(starterLabels[skill.id] || skill.starter.replace(/[。.]$/, ""))}</span>
      <span class="starter-arrow">${iconSvg("chevron-right")}</span>
    </button>
  `).join("");
}

function renderMessage(message) {
  const skill = skills.find((item) => item.id === message.skillId);
  const label = message.role === "user" ? currentUserName() : "XMAI Studio";
  const attachmentMeta = Array.isArray(message.attachments) && message.attachments.length
    ? `<span>${message.attachments.length} 个附件</span>`
    : "";
  const skillMeta = skill ? `<span class="message-skill">${escapeHtml(skill.name)}</span>` : "";
  const imageGrid = renderMessageImages(message);
  const fileCards = renderMessageFiles(message);
  const loadingClass = message.loading && message.content === "正在整理回复..." ? "loading" : "";
  const pendingClass = message.loading ? "pending" : "";
  const richContent = message.role === "assistant";
  const messageContent = richContent
    ? renderRichText(message.content)
    : escapeHtml(scrubInternalTerms(message.content));
  const messageActions = message.role === "assistant" && !message.loading && String(message.content || "").trim()
    ? `<div class="message-actions"><button type="button" data-message-copy="${escapeHtml(message.id)}" title="复制回答" aria-label="复制回答">${iconSvg("copy")}<span>复制</span></button></div>`
    : "";
  return `
    <article class="message ${message.role} ${loadingClass} ${pendingClass}">
      <div class="message-label">${escapeHtml(label)}</div>
      <div class="message-bubble ${richContent ? "rich-content" : ""}">${messageContent}</div>
      ${renderBrowserTaskCard(message)}
      ${renderMessageAttachments(message)}
      ${imageGrid}
      ${fileCards}
      ${messageActions}
      ${(skillMeta || attachmentMeta) ? `<div class="message-meta">${skillMeta}${attachmentMeta}</div>` : ""}
    </article>
  `;
}

function browserTaskStatusLabel(status) {
  return ({
    RUNNING: "执行中",
    PAUSING: "正在暂停",
    PAUSED: "已暂停",
    READY: "准备继续",
    SUCCEEDED: "已完成",
    PARTIAL_SUCCESS: "部分成功",
    RESULT_UNCERTAIN: "状态待确认",
    FAILED: "失败",
    CANCELED: "已取消"
  })[String(status || "").toUpperCase()] || "准备中";
}

function renderBrowserTaskCard(message) {
  const task = message?.browserTask;
  if (!task?.taskId) return "";
  const status = String(task.status || "RUNNING").toUpperCase();
  const details = Array.isArray(task.executionDetails) ? task.executionDetails : [];
  const latestAction = [...details].reverse().find((detail) => detail.action && !["view-page", "pause", "resume"].includes(detail.action));
  const summary = latestAction
    ? `${latestAction.action}${latestAction.target ? ` · ${latestAction.target}` : ""}`
    : (task.title || task.url || task.coreGoal || "正在准备浏览器页面");
  const canPause = ["RUNNING", "PAUSING"].includes(status);
  const canResume = ["PAUSED", "READY"].includes(status);
  return `
    <section class="browser-task-card status-${escapeHtml(status.toLowerCase())}" data-browser-task-card="${escapeHtml(task.taskId)}">
      <div class="browser-task-card-main">
        <span class="browser-task-icon">${iconSvg("globe")}</span>
        <span class="browser-task-copy">
          <span class="browser-task-heading"><strong>浏览器任务</strong><em>${escapeHtml(browserTaskStatusLabel(status))}</em></span>
          <small title="${escapeHtml(summary)}">${escapeHtml(summary)}</small>
          <code title="任务编号">${escapeHtml(task.taskId)}</code>
        </span>
      </div>
      <div class="browser-task-actions">
        <button type="button" data-browser-task-view="${escapeHtml(task.taskId)}">${iconSvg("eye")}<span>查看页面</span></button>
        ${canPause ? `<button type="button" data-browser-task-pause="${escapeHtml(task.taskId)}" ${status === "PAUSING" ? "disabled" : ""}>${iconSvg("pause")}<span>${status === "PAUSING" ? "正在暂停" : "暂停"}</span></button>` : ""}
        ${canResume ? `<button class="primary" type="button" data-browser-task-resume="${escapeHtml(task.taskId)}">${iconSvg("play")}<span>继续</span></button>` : ""}
      </div>
    </section>
  `;
}

function renderMessageAttachments(message) {
  const attachments = sanitizeAttachmentItems(message.attachments);
  if (!attachments.length) return "";
  return `
    <div class="message-attachments">
      ${attachments.map((file) => {
        const isImage = file.kind === "image" || /^image\//i.test(file.mimeType) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
        const meta = [fileKindLabel(file), String(file.extension || "文件").toUpperCase(), formatFileBytes(file.bytes)].filter(Boolean).join(" · ");
        return `
          <article class="message-attachment-card" title="${escapeHtml(file.absolutePath)}">
            ${isImage && file.previewDataUrl
              ? `<button class="message-attachment-image-button" type="button" data-attachment-preview="${escapeHtml(file.absolutePath)}"><img src="${escapeHtml(file.previewDataUrl)}" alt="${escapeHtml(file.name)}"></button>`
              : `<span class="message-file-type attachment-file-icon">${iconSvg(fileIconName(file))}<small>${escapeHtml(String(file.extension || "FILE").toUpperCase().slice(0, 5))}</small></span>`}
            <span class="message-attachment-copy">
              <strong>${escapeHtml(file.name)}</strong>
              <small>${escapeHtml(meta)}</small>
              <em>${escapeHtml(file.absolutePath)}</em>
            </span>
            <span class="message-attachment-actions">
              <button type="button" data-attachment-preview="${escapeHtml(file.absolutePath)}" title="预览附件" aria-label="预览附件">${iconSvg("eye")}</button>
              <button type="button" data-artifact-copy="${escapeHtml(file.absolutePath)}" title="复制附件" aria-label="复制附件">${iconSvg("copy")}</button>
              <button type="button" data-artifact-download="${escapeHtml(file.absolutePath)}" title="下载附件" aria-label="下载附件">${iconSvg("download")}</button>
            </span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderMessageImages(message) {
  if (!Array.isArray(message.images) || !message.images.length) {
    return "";
  }

  return `
    <div class="generated-images">
      ${message.images.map((image, index) => `
        <figure class="generated-image-card">
          <img src="${escapeHtml(image.src)}" alt="生成图片 ${index + 1}">
          <figcaption>
            <span class="generated-image-copy">${escapeHtml(image.revisedPrompt || "生成结果")}</span>
            ${image.localPath ? `
              <span class="generated-image-actions">
                <button type="button" data-open-image-path="${escapeHtml(image.localPath)}" title="应用内预览" aria-label="应用内预览">${iconSvg("eye")}</button>
                <button type="button" data-artifact-copy="${escapeHtml(image.localPath)}" title="复制图片" aria-label="复制图片">${iconSvg("copy")}</button>
                <button type="button" data-artifact-download="${escapeHtml(image.localPath)}" title="下载图片" aria-label="下载图片">${iconSvg("download")}</button>
              </span>
            ` : ""}
          </figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function fileKindLabel(file) {
  return ({
    website: "网站",
    image: "图片",
    document: "文档",
    spreadsheet: "表格",
    presentation: "演示文稿",
    audio: "音频",
    video: "视频",
    archive: "压缩包",
    code: "代码文件",
    file: "文件"
  })[file.kind] || "文件";
}

function fileIconName(file) {
  const kind = String(file?.kind || "").toLowerCase();
  const extension = String(file?.extension || file?.path || "").toLowerCase();
  if (kind === "image" || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(extension)) return "image";
  if (kind === "spreadsheet" || /\.(xlsx?|csv|tsv|ods)$/.test(extension)) return "sheet";
  if (kind === "presentation" || /\.(pptx?|key|odp)$/.test(extension)) return "presentation";
  if (kind === "audio" || /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|amr|aiff?)$/.test(extension)) return "file-audio";
  if (kind === "video" || /\.(mp4|m4v|mov|webm|avi|mkv|wmv|flv|mpeg|mpg|3gp)$/.test(extension)) return "video";
  if (kind === "website" || kind === "code" || /\.(html?|css|js|jsx|ts|tsx|json|py|java|c|cpp|cs|go|rs|sh|ps1)$/.test(extension)) return "file-code";
  if (kind === "document" || /\.(docx?|pdf|md|txt|rtf|odt)$/.test(extension)) return "file-text";
  return "file";
}

function formatFileBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderMessageFiles(message) {
  const files = sanitizeMessageFiles(message.files);
  if (!files.length) return "";
  return `
    <div class="message-files">
      ${files.map((file) => {
        const extension = (file.extension || "FILE").toUpperCase().slice(0, 5);
        const meta = [fileKindLabel(file), extension, formatFileBytes(file.bytes)].filter(Boolean).join(" · ");
        return `
          <article
            class="message-file-card"
            data-absolute-path="${escapeHtml(file.absolutePath)}"
            title="${escapeHtml(file.absolutePath)}"
          >
            <button class="message-file-open" type="button" data-message-file-open="${escapeHtml(file.path)}" aria-label="预览 ${escapeHtml(file.name)}">
              <span class="message-file-type">${iconSvg(fileIconName(file))}<small>${escapeHtml(extension)}</small></span>
              <span class="message-file-copy">
                <strong>${escapeHtml(file.name)}</strong>
                <small>${escapeHtml(meta)}</small>
              </span>
            </button>
            <span class="message-file-actions">
              <button type="button" data-message-file-open="${escapeHtml(file.path)}" title="应用内预览" aria-label="应用内预览">${iconSvg("eye")}</button>
              <button type="button" data-artifact-copy="${escapeHtml(file.path)}" title="复制文件" aria-label="复制文件">${iconSvg("copy")}</button>
              <button type="button" data-artifact-download="${escapeHtml(file.path)}" title="下载文件" aria-label="下载文件">${iconSvg("download")}</button>
            </span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderContextBar() {
  const skill = activeSkill();
  if (!skill && !state.selectedFiles.length) {
    els.contextBar.innerHTML = "";
    return;
  }
  els.contextBar.innerHTML = `
    ${skill ? `<button class="context-chip active" type="button" data-action="clear-skill" title="移除技能"><span>${escapeHtml(skill.shortName)}</span>${iconSvg("x")}</button>` : ""}
  `;
}

function renderAttachmentBar() {
  if (!state.selectedFiles.length) {
    els.attachmentBar.innerHTML = "";
    return;
  }

  els.attachmentBar.innerHTML = state.selectedFiles.map((file, index) => {
    const item = typeof file === "string" ? { name: baseName(file), path: file, kind: "file" } : file;
    const isImage = item.kind === "image" || /^image\//i.test(item.mimeType || "");
    const extension = String(item.extension || item.name?.match(/\.([^./\\]+)$/)?.[1] || "FILE").toUpperCase().slice(0, 6);
    const meta = [fileKindLabel(item), formatFileBytes(item.bytes)].filter(Boolean).join(" · ");
    const absolutePath = item.absolutePath || item.path || "";
    return `
      <article class="composer-attachment-card" title="${escapeHtml(absolutePath)}">
        ${isImage && item.previewDataUrl
          ? `<button class="composer-attachment-preview" type="button" data-attachment-preview="${escapeHtml(absolutePath)}" aria-label="预览 ${escapeHtml(item.name || "图片")}"><img src="${escapeHtml(item.previewDataUrl)}" alt=""></button>`
          : `<button class="composer-attachment-preview file" type="button" data-attachment-preview="${escapeHtml(absolutePath)}" aria-label="预览 ${escapeHtml(item.name || "附件")}"><span>${iconSvg(fileIconName(item))}</span><small>${escapeHtml(extension)}</small></button>`}
        <span class="composer-attachment-copy">
          <strong>${escapeHtml(item.name || baseName(item.path))}</strong>
          <small>${escapeHtml(meta || extension)}</small>
        </span>
        <button class="composer-attachment-remove" type="button" data-remove-file="${index}" aria-label="移除附件 ${escapeHtml(item.name || "")}" title="移除附件">${iconSvg("x")}</button>
      </article>
    `;
  }).join("");
}

function renderLoginState() {
  els.loginModal.classList.toggle("hidden", Boolean(state.session));
  els.autoLogin.checked = Boolean(state.config.autoLogin);
  const userName = state.session?.name || "先马用户";
  if (els.accountName) els.accountName.textContent = userName;
  if (els.accountAvatarText) els.accountAvatarText.textContent = userName.slice(0, 1) || "先";
  const avatarUrl = /^https?:\/\//i.test(String(state.session?.avatarUrl || "")) ? state.session.avatarUrl : "";
  if (els.accountAvatarImage) {
    els.accountAvatarImage.classList.toggle("hidden", !avatarUrl);
    els.accountAvatarImage.src = avatarUrl;
  }
  if (els.accountAvatarText) els.accountAvatarText.classList.toggle("hidden", Boolean(avatarUrl));
  if (els.accountSubtitle) {
    els.accountSubtitle.textContent = "钉钉账号";
  }

  if (!els.dingtalkLoginButton || !els.loginStatusText) return;
  if (!state.authReady) {
    els.dingtalkLoginButton.disabled = true;
    els.dingtalkLoginButton.querySelector("span:last-child").textContent = "正在检查登录状态...";
    els.loginStatusText.textContent = "正在恢复本机钉钉会话";
    return;
  }

  els.dingtalkLoginButton.disabled = false;
  els.dingtalkLoginButton.querySelector("span:last-child").textContent = "打开扫码登录";
  els.loginStatusText.textContent = state.authStatus?.configured
    ? "扫码或使用钉钉账号完成企业身份验证"
    : (state.authStatus?.message || "钉钉登录尚未由管理员配置");
}

let currentRuntimeSetupStatus = { active: false, stage: "idle", percent: 0, message: "", cancellable: false, ready: false };

function updateRuntimeSetupStatus(status = {}) {
  currentRuntimeSetupStatus = { ...currentRuntimeSetupStatus, ...status };
  if (!els.runtimeSetup) return;
  const percent = Math.max(0, Math.min(100, Number(currentRuntimeSetupStatus.percent) || 0));
  const visible = Boolean(currentRuntimeSetupStatus.active);
  els.runtimeSetup.classList.toggle("hidden", !visible);
  els.runtimeSetupLabel.textContent = currentRuntimeSetupStatus.message || "正在准备智能能力";
  els.runtimeSetupProgress.style.width = `${percent}%`;
  els.runtimeSetupPercent.textContent = `${Math.round(percent)}%`;
  els.runtimeSetupCancel.disabled = !currentRuntimeSetupStatus.cancellable;
}

async function cancelRuntimeSetup() {
  try {
    const result = await window.desktopBridge?.cancelRuntimeSetup?.();
    if (result?.cancelled) showToast("正在取消智能能力准备");
  } catch (error) {
    showToast(error.message || "取消失败");
  }
}

let modelSearchQuery = "";
function renderModelPickerList() {
  const list = els.modelDropdown?.querySelector(".model-options-list");
  if (!list) return;
  const query = modelSearchQuery.trim().toLowerCase();
  const options = state.modelOptions.filter(item => `${item.label} ${item.value} ${item.group || ""}`.toLowerCase().includes(query));
  let group = "";
  list.innerHTML = options.map(item => {
    const next = item.group || (item.kind === "auto" ? "自动选择" : item.kind === "image" ? "图片生成" : /^deepseek/.test(item.value) ? "DeepSeek" : /^gemini/.test(item.value) ? "Gemini" : "通用与推理");
    const header = next !== group ? `<div class="model-group-label">${escapeHtml(next)}</div>` : "";
    group = next;
    return `${header}<button class="model-option ${item.value === state.config.model ? "selected" : ""}" type="button" role="option" aria-selected="${item.value === state.config.model}" data-model-value="${escapeHtml(item.value)}"><span>${escapeHtml(item.label)}</span>${item.value === state.config.model ? `<span class="model-check">${iconSvg("check")}</span>` : ""}</button>`;
  }).join("") || '<div class="model-group-label">没有匹配的模型</div>';
}
function renderModelPicker() {
  if (!els.modelPicker || !els.modelButton || !els.modelDropdown) return;
  const options = Array.isArray(state.modelOptions) && state.modelOptions.length
    ? state.modelOptions
    : [{ label: state.config.model || "默认模型", value: state.config.model || "gpt-5.6-sol" }];
  const selected = options.find((item) => item.value === state.config.model) || options[0];
  state.config.model = selected.value;
  els.modelButton.innerHTML = `<span>${escapeHtml(selected.label)}</span><span class="model-arrow">${iconSvg("chevron-down")}</span>`;
  els.modelDropdown.innerHTML = `<div class="model-catalog-head"><strong>选择模型</strong><span>${options.length} 项</span></div><label class="model-catalog-search">${iconSvg("search")}<input type="search" placeholder="搜索模型" aria-label="搜索模型" value="${escapeHtml(modelSearchQuery)}"></label><div class="model-options-list" role="listbox"></div>`;
  els.modelDropdown.querySelector("input").addEventListener("input", event => { modelSearchQuery = event.target.value; renderModelPickerList(); });
  renderModelPickerList();
}

function renderComposerSkillMenu() {
  if (!els.composerSkillList) return;
  const query = composerSkillQuery.trim().toLowerCase();
  const browserSkill = skills.find((skill) => skill.id === "browser" && skill.userInvocable !== false);
  const localFileOption = {
    kind: "utility",
    id: "local-file",
    name: "本地文件",
    icon: "file-text",
    description: "查找、整理并处理本机文件中的 Excel、Word、PPT 等内容。"
  };
  const available = [
    ...(browserSkill ? [browserSkill] : []),
    localFileOption,
    ...skills.filter((skill) => skill.userInvocable !== false && skill.id !== "browser")
  ];
  const visible = query
    ? available.filter((item) => [item.name, item.description, item.category, item.slug].some((value) => String(value || "").toLowerCase().includes(query)))
    : available;
  els.composerSkillList.innerHTML = visible.length
    ? visible.map((item) => `
      <button class="composer-skill-option ${item.kind === "utility" ? "composer-utility-option" : (activeConversation()?.skillId === item.id ? "selected" : "")}" type="button" ${item.kind === "utility" ? `data-menu-utility="${escapeHtml(item.id)}"` : `data-menu-skill="${escapeHtml(item.id)}"`}>
        <span class="composer-skill-icon">${iconSvg(item.icon || "file-stack")}</span>
        <span class="composer-skill-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span>
        ${item.kind !== "utility" && activeConversation()?.skillId === item.id ? `<span class="composer-skill-check">${iconSvg("check")}</span>` : ""}
      </button>
    `).join("")
    : `<div class="composer-skill-empty">没有匹配的技能</div>`;
  if (els.composerSkillSearch && els.composerSkillSearch.value !== composerSkillQuery) els.composerSkillSearch.value = composerSkillQuery;
}

function fitModelPicker() {
  if (!els.modelDropdown?.classList.contains("open")) return;
  const rect = els.modelButton.getBoundingClientRect();
  const above = rect.top - 52, below = innerHeight - rect.bottom - 18;
  const openBelow = above < 200 && below > above;
  els.modelDropdown.style.maxHeight = `${Math.max(100, Math.min(540, openBelow ? below : above))}px`;
  els.modelDropdown.style.top = openBelow ? "calc(100% + 8px)" : "auto";
  els.modelDropdown.style.bottom = openBelow ? "auto" : "calc(100% + 8px)";
}
window.addEventListener("resize", fitModelPicker);
function toggleModelPicker() {
  els.modelDropdown?.classList.toggle("open");
  fitModelPicker();
}

function fitComposerMenu() {
  if (!els.chatForm || !els.composerSkillList || !els.composerMenu) return;
  els.composerMenu.classList.remove("open-below");
  const composerRect = els.chatForm.getBoundingClientRect();
  const composerTop = composerRect.top;
  const listHeight = Math.max(60, Math.min(330, Math.floor(composerTop - 235)));
  els.composerSkillList.style.maxHeight = `${listHeight}px`;
  const menuRect = els.composerMenu.getBoundingClientRect();
  const roomBelow = window.innerHeight - composerRect.bottom - 9;
  if (menuRect.top < 40 && roomBelow >= menuRect.height) els.composerMenu.classList.add("open-below");
}

function toggleComposerMenu() {
  if (!els.composerMenu) return;
  const opening = els.composerMenu.classList.contains("hidden");
  els.composerMenu.classList.toggle("hidden", !opening);
  if (opening) {
    renderComposerSkillMenu();
    fitComposerMenu();
    window.setTimeout(() => els.composerSkillSearch?.focus(), 0);
  }
}

function closeComposerMenu() {
  els.composerMenu?.classList.add("hidden");
}

function skillRiskLabel(level) {
  if (level === "high") return "高风险，需要确认";
  if (level === "medium") return "需要留意外部依赖";
  return "未发现高风险项";
}

function resetLocalSkillImport() {
  const returnView = localSkillImport.returnView || "skills";
  localSkillImport = {
    step: 1,
    source: "folder",
    sourcePath: "",
    reference: "",
    inspection: null,
    loading: false,
    installing: false,
    error: "",
    acknowledgeRisk: false,
    replace: false,
    displayName: "",
    description: "",
    categoryId: "",
    tags: [],
    tagQuery: "",
    instructions: "",
    installedSkillId: "",
    returnView
  };
}

function openLocalSkillImport() {
  closeComposerMenu();
  const returnView = state.activeView === "skill-import" ? "skills" : (state.activeView || "skills");
  localSkillImport.returnView = returnView;
  resetLocalSkillImport();
  localSkillImport.returnView = returnView;
  showView("skill-import");
}

function closeLocalSkillImport() {
  if (localSkillImport.installing) return;
  const returnView = localSkillImport.returnView || "skills";
  resetLocalSkillImport();
  showView(returnView === "skill-import" ? "skills" : returnView);
}

function renderLocalSkillImport() {
  if (state.activeView === "skill-import") renderSkillImportPage();
}

function updateSkillImportActionState() {
  const validateButton = els.pageContent?.querySelector('[data-action="validate-skill-import"]');
  if (validateButton) {
    const sourceSelected = localSkillImport.source === "github"
      ? Boolean(localSkillImport.reference.trim())
      : Boolean(localSkillImport.sourcePath);
    validateButton.disabled = !sourceSelected || localSkillImport.loading;
  }
  const installButton = els.pageContent?.querySelector('[data-action="confirm-local-skill-install"]');
  if (installButton) installButton.disabled = !skillImportCanInstall() || localSkillImport.installing;
}

function skillImportSourceName() {
  return ({ folder: "本地技能文件夹", zip: "ZIP 或 Markdown 技能文件", github: "GitHub 地址" })[localSkillImport.source] || "技能内容";
}

function normalizedCustomSkillTagName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 30);
}

function customSkillTagId(name) {
  let hash = 2166136261;
  for (const character of normalizedCustomSkillTagName(name)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

function normalizedSkillTagList(tags = []) {
  return tags
    .map((tag) => {
      const name = normalizedCustomSkillTagName(tag?.name);
      if (!name) return null;
      return {
        tagId: String(tag?.tagId || customSkillTagId(name)),
        name,
        isNew: tag?.isNew === true
      };
    })
    .filter(Boolean)
    .filter((tag, index, values) => values.findIndex((candidate) => candidate.tagId === tag.tagId || candidate.name.toLocaleLowerCase("zh-CN") === tag.name.toLocaleLowerCase("zh-CN")) === index)
    .slice(0, 20);
}

function skillImportTagsHtml() {
  const selectedIds = new Set(localSkillImport.tags.map((item) => item.tagId));
  const available = skillLibraryState.tags.filter((item) => item.status !== "DISABLED" && !selectedIds.has(item.tagId));
  return `<div class="skill-tag-picker">
    ${localSkillImport.tags.map((tag, index) => `<span class="skill-tag-chip">${escapeHtml(tag.name)}<button type="button" data-remove-skill-import-tag="${index}" aria-label="删除标签 ${escapeHtml(tag.name)}">${iconSvg("x")}</button></span>`).join("")}
    <input id="skillImportTagInput" maxlength="30" placeholder="搜索或新增标签" value="${escapeHtml(localSkillImport.tagQuery || "")}" autocomplete="off" aria-label="搜索或新增标签" aria-controls="skillImportTagSuggestions">
    <span class="skill-tag-picker-chevron" aria-hidden="true">${iconSvg("chevron-down")}</span>
    <div class="skill-tag-suggestions" id="skillImportTagSuggestions" role="listbox" aria-label="可选标签">
      ${available.length ? available.map((tag) => `<button type="button" role="option" data-select-skill-import-tag="${escapeHtml(tag.tagId)}" data-tag-search-name="${escapeHtml(tag.name.toLocaleLowerCase("zh-CN"))}">${escapeHtml(tag.name)}</button>`).join("") : `<span class="skill-tag-suggestions-empty">没有更多可选标签</span>`}
      <button class="skill-tag-create-option" type="button" data-create-skill-import-tag hidden>${iconSvg("plus")}<span data-custom-tag-label>新增标签</span></button>
      <span class="skill-tag-suggestions-empty filtered hidden" data-skill-tag-filter-empty>没有匹配的标签</span>
    </div>
  </div>`;
}

function skillImportCanInstall() {
  const inspection = localSkillImport.inspection;
  return Boolean(inspection
    && localSkillImport.displayName.trim()
    && localSkillImport.description.trim()
    && localSkillImport.categoryId
    && localSkillImport.tags.length
    && localSkillImport.instructions.trim()
    && (!inspection.requiresRiskAcknowledgement || localSkillImport.acknowledgeRisk)
    && (!inspection.requiresReplace || localSkillImport.replace));
}

function renderSkillImportPage() {
  const data = localSkillImport;
  const inspection = data.inspection;
  const skill = inspection?.skill;
  const categories = skillLibraryState.categories.filter((item) => item.status !== "DISABLED").sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const sources = [
    { id: "folder", icon: "folder-open", title: "本地技能文件夹", copy: "选择包含 SKILL.md 的完整技能目录。" },
    { id: "github", icon: "github", title: "GitHub 地址", copy: "填写公开仓库或仓库内技能目录地址。" },
    { id: "zip", icon: "file-archive", title: "ZIP 压缩包", copy: "选择 ZIP 技能包，也支持单独的 Markdown 技能文件。" }
  ];
  const sourceSelected = data.source === "github" ? Boolean(data.reference.trim()) : Boolean(data.sourcePath);
  const visibleFileName = data.source === "github" ? data.reference : (data.sourcePath ? baseName(data.sourcePath) : "");
  let content = "";

  if (data.step === 1) {
    content = `
      <div class="skill-import-source-grid">
        ${sources.map((item) => `<button type="button" class="skill-import-source-card ${data.source === item.id ? "selected" : ""}" data-skill-import-source="${item.id}">${iconSvg(item.icon)}<strong>${item.title}</strong><small>${item.copy}</small></button>`).join("")}
      </div>
      <div class="skill-import-source-input">
        ${data.source === "github"
          ? `<label class="skill-import-field"><span>公开 GitHub 技能地址</span><input data-skill-import-field="reference" value="${escapeHtml(data.reference)}" placeholder="https://github.com/owner/repository/tree/main/skills/example"><small>仅支持公开仓库；安装前会检查 SKILL.md、路径和执行风险。</small></label>`
          : `<div class="skill-import-field"><span>${skillImportSourceName()}</span><div><button class="secondary-button" type="button" data-action="choose-skill-import-source">${iconSvg(data.source === "folder" ? "folder-open" : data.source === "zip" ? "file-archive" : "file-text")}<span>${sourceSelected ? "重新选择" : "选择技能内容"}</span></button></div><small>${sourceSelected ? `已选择：${escapeHtml(visibleFileName)}` : "尚未选择技能内容"}</small></div>`}
        ${data.loading ? `<div class="skill-import-progress">${iconSvg("refresh-cw")}<span>正在检查技能格式和风险...</span></div>` : ""}
        ${skill ? `<div class="skill-import-selection"><span class="skill-icon skill-letter-icon">${escapeHtml(String(skill.name || "技").slice(0, 1))}</span><span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span><span class="skill-risk-badge ${escapeHtml(skill.riskLevel || "low")}">${escapeHtml(skillRiskLabel(skill.riskLevel))}</span></div>` : ""}
        ${data.error ? `<div class="skill-import-error">${iconSvg("circle-alert")}<span>${escapeHtml(data.error)}</span></div>` : ""}
      </div>
      <div class="skill-import-actions"><button class="secondary-button" type="button" data-action="close-skill-import">取消</button><button class="primary-button" type="button" data-action="validate-skill-import" ${(!sourceSelected || data.loading) ? "disabled" : ""}>${iconSvg("shield-check")}<span>${skill ? "查看校验结果" : "校验技能"}</span></button></div>`;
  } else if (data.step === 2 && skill) {
    const riskItems = Array.isArray(skill.riskItems) ? skill.riskItems : [];
    content = `
      <div class="skill-import-validation-card">
        <span class="skill-import-validation-icon">${iconSvg("check")}</span>
        <div><h3>技能内容校验通过</h3><p>已识别技能说明和相关资源，路径和文件结构检查通过。</p><div><span>已识别 SKILL.md</span><span>${escapeHtml(String(skill.fileCount || 0))} 个文件</span><span>${escapeHtml(formatFileBytes(skill.totalBytes || 0))}</span></div></div>
        <small>版本 ${escapeHtml(skill.version || "1.0.0")}</small>
      </div>
      ${riskItems.length ? `<div class="skill-import-risk"><strong>风险项</strong><ul>${riskItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      <div class="skill-import-edit-grid">
        <label class="skill-import-field"><span>技能名称</span><input data-skill-import-field="displayName" value="${escapeHtml(data.displayName)}" maxlength="80" required></label>
        <label class="skill-import-field"><span>分类</span><select data-skill-import-field="categoryId" required><option value="">请选择分类</option>${categories.map((item) => `<option value="${escapeHtml(item.categoryId)}" ${item.categoryId === data.categoryId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select><small>分类由管理后台统一维护，仅支持单选。</small></label>
        <div class="skill-import-field wide"><span>标签</span><div class="skill-import-tag-editor">${skillImportTagsHtml()}</div><small>可直接选择已有标签，也可输入新名称后新增；点击 × 可删除。</small></div>
        <label class="skill-import-field wide"><span>技能简介</span><textarea data-skill-import-field="description" maxlength="500" required>${escapeHtml(data.description)}</textarea></label>
        <label class="skill-import-field wide"><span>技能说明</span><textarea class="instructions" data-skill-import-field="instructions" required>${escapeHtml(data.instructions)}</textarea></label>
      </div>
      ${inspection.requiresRiskAcknowledgement ? `<label class="check-row skill-import-confirm"><input type="checkbox" data-local-skill-ack="risk" ${data.acknowledgeRisk ? "checked" : ""}><span>我已核对来源并确认安装此高风险技能</span></label>` : ""}
      ${inspection.requiresReplace ? `<label class="check-row skill-import-confirm"><input type="checkbox" data-local-skill-ack="replace" ${data.replace ? "checked" : ""}><span>覆盖当前用户已安装的同名技能</span></label>` : ""}
      ${data.error ? `<div class="skill-import-error">${iconSvg("circle-alert")}<span>${escapeHtml(data.error)}</span></div>` : ""}
      <div class="skill-import-actions"><button class="secondary-button" type="button" data-action="skill-import-previous">上一步</button><button class="primary-button" type="button" data-action="confirm-local-skill-install" ${!skillImportCanInstall() || data.installing ? "disabled" : ""}>${iconSvg("download")}<span>${data.installing ? "正在导入" : (inspection.requiresReplace ? "覆盖并导入" : "导入我的技能")}</span></button></div>`;
  } else {
    content = `<div class="skill-import-success"><div><span>${iconSvg("check")}</span><h2>技能导入成功</h2><p>“${escapeHtml(data.displayName || skill?.name || "新技能")}”已加入我的技能，可立即使用、编辑或提交企业审批。</p><div><button class="secondary-button" type="button" data-action="view-imported-skill">查看技能</button><button class="primary-button" type="button" data-action="use-imported-skill">${iconSvg("play")}<span>立即使用</span></button></div></div></div>`;
  }

  els.pageContent.innerHTML = `
    <section class="skill-import-page">
      <button class="skill-back-button" type="button" data-action="close-skill-import">${iconSvg("arrow-left")}<span>返回技能库</span></button>
      <header class="skill-library-header"><div><h1>导入技能</h1><p>导入并校验完成后，该技能会立即进入“我的技能”。</p></div></header>
      <div class="skill-import-steps">${["选择来源", "校验内容", "完成导入"].map((label, index) => { const number = index + 1; return `<div class="${data.step === number ? "active" : ""} ${data.step > number ? "done" : ""}"><span>${data.step > number ? iconSvg("check") : number}</span><strong>${label}</strong></div>`; }).join("")}</div>
      ${content}
    </section>`;
}

function applySkillImportInspection(inspection) {
  const skill = inspection?.skill || {};
  const categories = skillLibraryState.categories.filter((item) => item.status !== "DISABLED");
  const matchingCategory = categories.find((item) => item.categoryId === skill.categoryId) || categories.find((item) => item.name === skill.category);
  const serverTags = (skill.tagIds || []).map((tagId) => {
    const server = skillLibraryState.tags.find((item) => item.tagId === tagId && item.status !== "DISABLED");
    return server ? { tagId: server.tagId, name: server.name, isNew: false } : null;
  }).filter(Boolean);
  const customTags = (skill.customTags || []).map((tag) => ({ tagId: tag.tagId, name: tag.name, isNew: true }));
  const customNames = new Set(customTags.map((tag) => normalizedCustomSkillTagName(tag.name).toLocaleLowerCase("zh-CN")));
  const newTags = (skill.newTags || [])
    .filter((name) => !customNames.has(normalizedCustomSkillTagName(name).toLocaleLowerCase("zh-CN")))
    .map((name) => ({ name, isNew: true }));
  const tags = normalizedSkillTagList([...serverTags, ...customTags, ...newTags]);
  localSkillImport = { ...localSkillImport, inspection, loading: false, error: "", displayName: skill.name || "", description: skill.description || "", categoryId: matchingCategory?.categoryId || "", tags, tagQuery: "", instructions: skill.instructions || skill.description || "", acknowledgeRisk: false, replace: false };
}

async function inspectLocalSkill(sourcePath) {
  if (!sourcePath || !window.desktopBridge?.inspectSkillSource) return;
  localSkillImport = { ...localSkillImport, sourcePath, inspection: null, loading: true, error: "", acknowledgeRisk: false, replace: false };
  renderLocalSkillImport();
  try {
    const inspection = await window.desktopBridge.inspectSkillSource({ userId: state.session?.userId || "local-user", sourcePath });
    applySkillImportInspection(inspection);
    renderLocalSkillImport();
  } catch (error) {
    localSkillImport = { ...localSkillImport, loading: false, error: scrubInternalTerms(error.message || "技能包检查失败") };
    renderLocalSkillImport();
  }
}

async function chooseLocalSkillSource() {
  try {
    const result = await window.desktopBridge?.selectSkillSource?.({ sourceType: localSkillImport.source === "folder" ? "folder" : "file" });
    if (!result || result.canceled || !result.sourcePath) return;
    if (localSkillImport.source === "zip" && !/\.(?:zip|md|markdown)$/i.test(result.sourcePath)) throw new Error("请选择 ZIP、Markdown 或 SKILL.md 技能文件");
    await inspectLocalSkill(result.sourcePath);
  } catch (error) {
    localSkillImport = { ...localSkillImport, error: scrubInternalTerms(error.message || "技能来源选择失败") };
    renderLocalSkillImport();
  }
}

async function inspectGitHubSkill() {
  if (!window.desktopBridge?.inspectOnlineSkill) throw new Error("当前版本缺少 GitHub 技能预检能力");
  localSkillImport = { ...localSkillImport, sourcePath: "", inspection: null, loading: true, error: "", acknowledgeRisk: false, replace: false };
  renderLocalSkillImport();
  try {
    const result = await window.desktopBridge.inspectOnlineSkill({ userId: state.session?.userId || "local-user", reference: localSkillImport.reference });
    localSkillImport.reference = result.reference || localSkillImport.reference;
    applySkillImportInspection(result.inspection);
  } catch (error) {
    localSkillImport = { ...localSkillImport, inspection: null, loading: false, error: scrubInternalTerms(error.message || "GitHub 技能校验失败") };
  }
  renderLocalSkillImport();
}

async function validateSkillImport() {
  if (localSkillImport.loading) return;
  if (!localSkillImport.inspection) {
    if (localSkillImport.source !== "github") {
      localSkillImport.error = "请先选择技能内容";
      return renderLocalSkillImport();
    }
    await inspectGitHubSkill();
  }
  if (localSkillImport.inspection) {
    localSkillImport.step = 2;
    localSkillImport.error = "";
    renderLocalSkillImport();
  }
}

function addSkillImportTag(tagId) {
  const server = skillLibraryState.tags.find((item) => item.status !== "DISABLED" && item.tagId === tagId);
  if (!server) return;
  const tag = { tagId: server.tagId, name: server.name, isNew: false };
  if (!localSkillImport.tags.some((item) => item.tagId === tag.tagId || item.name.toLocaleLowerCase("zh-CN") === tag.name.toLocaleLowerCase("zh-CN"))) localSkillImport.tags.push(tag);
  localSkillImport.tagQuery = "";
  localSkillImport.error = "";
  renderLocalSkillImport();
  document.getElementById("skillImportTagInput")?.focus();
}

function addSkillImportCustomTag() {
  const name = normalizedCustomSkillTagName(localSkillImport.tagQuery);
  if (!name || localSkillImport.tags.length >= 20) return;
  const server = skillLibraryState.tags.find((item) => item.status !== "DISABLED" && item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
  if (server) return addSkillImportTag(server.tagId);
  if (!localSkillImport.tags.some((item) => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) {
    localSkillImport.tags.push({ tagId: customSkillTagId(name), name, isNew: true });
  }
  localSkillImport.tagQuery = "";
  localSkillImport.error = "";
  renderLocalSkillImport();
  document.getElementById("skillImportTagInput")?.focus();
}

async function installLocalSkill() {
  if (!localSkillImport.inspection || localSkillImport.installing) return;
  localSkillImport = { ...localSkillImport, installing: true, error: "" };
  renderLocalSkillImport();
  try {
    const skillName = localSkillImport.displayName || localSkillImport.inspection?.skill?.name || "新技能";
    const installPayload = { userId: state.session?.userId || "local-user", acknowledgeRisk: localSkillImport.acknowledgeRisk, replace: localSkillImport.replace, categoryId: localSkillImport.categoryId, tagIds: localSkillImport.tags.filter((item) => !item.isNew).map((item) => item.tagId), background: false };
    const result = localSkillImport.source === "github"
      ? await window.desktopBridge?.installOnlineSkill?.({ ...installPayload, reference: localSkillImport.reference })
      : await window.desktopBridge?.installSkill?.({ ...installPayload, sourcePath: localSkillImport.sourcePath, skillName });
    if (result?.requiresRiskAcknowledgement || result?.requiresReplace) {
      localSkillImport = {
        ...localSkillImport,
        installing: false,
        inspection: result.inspection || localSkillImport.inspection,
        error: result.requiresRiskAcknowledgement ? "请先确认技能风险后再安装。" : "同名技能已存在，请确认是否覆盖。"
      };
      renderLocalSkillImport();
      return;
    }
    if (!result?.installed) throw new Error("技能未完成安装");
    const installedSkillId = result.skill?.id;
    if (!installedSkillId) throw new Error("安装完成后未能识别技能");
    const category = skillLibraryState.categories.find((item) => item.categoryId === localSkillImport.categoryId);
    await window.desktopBridge?.updateInstalledSkill?.({ userId: state.session?.userId || "local-user", skillId: installedSkillId, displayName: localSkillImport.displayName, description: localSkillImport.description, categoryId: localSkillImport.categoryId, category: category?.name || "其他", tags: localSkillImport.tags, instructions: localSkillImport.instructions });
    localSkillImport = { ...localSkillImport, installing: false, installedSkillId, step: 3, error: "" };
    await refreshInstalledSkills();
    renderLocalSkillImport();
    showToast(`技能“${skillName}”已安装`);
  } catch (error) {
    localSkillImport = { ...localSkillImport, installing: false, error: scrubInternalTerms(error.message || "技能安装失败") };
    renderLocalSkillImport();
  }
}

function openOnlineSkills() {
  closeComposerMenu();
  els.onlineSkillsModal?.classList.remove("hidden");
  renderOnlineSkillLibrary();
  window.setTimeout(() => els.onlineSkillSearchInput?.focus(), 0);
  if (!onlineSkillLibrary.loaded && !onlineSkillLibrary.loading) searchOnlineSkillLibrary(onlineSkillLibrary.query);
}

function closeOnlineSkills() {
  els.onlineSkillsModal?.classList.add("hidden");
}

function updateStatusCopy() {
  const status = desktopUpdateStatus.status;
  if (status === "loading") return "正在读取版本信息...";
  if (status === "checking") return "正在检查更新...";
  if (status === "available") return `发现新版本 ${desktopUpdateStatus.availableDisplayVersion || ""}`.trim();
  if (status === "cache-check") return "正在检查已下载的安装包...";
  if (status === "cache-hit") return "已验证本地安装包，无需重新下载";
  if (status === "download-start") return desktopUpdateStatus.received > 0 ? "正在从上次进度继续下载..." : "正在连接下载服务器...";
  if (status === "download-retry") {
    const percent = Math.max(0, Number(desktopUpdateStatus.percent || 0)).toFixed(1);
    return `网络波动，正在从 ${percent}% 自动续传...`;
  }
  if (status === "download-progress") {
    const percent = Math.max(0, Number(desktopUpdateStatus.percent || 0)).toFixed(1);
    const received = formatUpdateProgressSize(desktopUpdateStatus.received);
    const total = formatUpdateProgressSize(desktopUpdateStatus.total);
    const speed = formatUpdateSpeed(desktopUpdateStatus.bytesPerSecond);
    const remaining = formatUpdateRemaining(desktopUpdateStatus.remainingSeconds);
    return [`正在下载新版本：${percent}%`, received && total ? `${received}/${total}` : "", speed, remaining].filter(Boolean).join(" · ");
  }
  if (status === "downloaded") return "新版本已下载，正在启动安装程序...";
  if (status === "check-error" || status === "error") return "暂时无法连接更新服务，请稍后重试";
  if (status === "current" || status === "not-available") return "当前已是最新版本";
  if (status === "disabled") return "当前环境未启用自动更新";
  return desktopUpdateStatus.autoCheckEnabled ? "自动检查更新已开启" : "自动检查更新已关闭";
}

function formatUpdateProgressSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatUpdateSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${formatUpdateProgressSize(value)}/秒`;
}

function formatUpdateRemaining(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 60) return `约 ${Math.ceil(value)} 秒`;
  if (value < 3600) return `约 ${Math.ceil(value / 60)} 分钟`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.ceil((value % 3600) / 60);
  return `约 ${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}`;
}

function formatUpdateDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString("zh-CN", { hour12: false });
}

function formatUpdateSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function updateHistoryLabel(type) {
  return ({
    available: "发现版本",
    deferred: "稍后提醒",
    downloaded: "下载完成",
    installing: "开始安装",
    installed: "安装完成",
    failed: "更新失败"
  })[type] || "更新事件";
}

function renderSettingsPage() {
  const supported = desktopUpdateStatus.supported === true;
  const checking = updateCheckBusy || ["checking", "download-start", "download-progress", "download-retry"].includes(desktopUpdateStatus.status);
  const lastChecked = desktopUpdateStatus.lastCheckedAt
    ? new Date(desktopUpdateStatus.lastCheckedAt).toLocaleString("zh-CN", { hour12: false })
    : "尚未检查";
  const available = desktopUpdateStatus.availableRelease;
  const updateHistory = Array.isArray(desktopUpdateStatus.updateHistory) ? desktopUpdateStatus.updateHistory.slice(0, 12) : [];
  els.pageContent.innerHTML = `
    ${renderPageHeader("设置", "管理软件更新并查看使用指引。")}
    <section class="settings-section" aria-labelledby="softwareUpdateTitle">
      <div class="settings-section-heading">
        <span class="settings-section-icon">${iconSvg("refresh-cw")}</span>
        <div>
          <h2 id="softwareUpdateTitle">软件更新</h2>
          <p id="updateStatusText">${escapeHtml(updateStatusCopy())}</p>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-copy">
          <strong>当前版本</strong>
          <span>XMAI Studio ${escapeHtml(desktopUpdateStatus.displayVersion || "2.0.0")}</span>
        </div>
        <button class="secondary-button settings-update-button" type="button" data-action="check-for-updates" ${supported && !checking ? "" : "disabled"}>
          ${iconSvg("refresh-cw")}<span>${checking ? "正在检查" : "检查更新"}</span>
        </button>
      </div>
      ${available ? `
        <div class="settings-release-detail">
          <div class="settings-release-version">
            <span>可用版本</span>
            <strong>XMAI Studio ${escapeHtml(available.displayVersion || desktopUpdateStatus.availableDisplayVersion || "")}</strong>
          </div>
          <div class="settings-release-meta">
            <span>${escapeHtml(formatUpdateDate(available.publishedAt, "发布时间未知"))}</span>
            ${formatUpdateSize(available.size) ? `<span>${escapeHtml(formatUpdateSize(available.size))}</span>` : ""}
          </div>
          <strong class="settings-release-title">${escapeHtml(available.title || "版本更新")}</strong>
          <div class="settings-release-notes">${escapeHtml(available.notes || "包含功能优化与问题修复。").replace(/\n/g, "<br>")}</div>
        </div>
      ` : ""}
      <label class="settings-row settings-toggle-row">
        <span class="settings-row-copy">
          <strong>自动检查更新</strong>
          <span>启动软件、收到版本发布通知以及运行期间自动检查</span>
        </span>
        <span class="toggle-control">
          <input type="checkbox" data-auto-update-check ${desktopUpdateStatus.autoCheckEnabled ? "checked" : ""} ${supported ? "" : "disabled"}>
          <span aria-hidden="true"></span>
        </span>
      </label>
      <div class="settings-footnote">上次检查：${escapeHtml(lastChecked)}</div>
    </section>
    <div class="settings-information-grid">
      <section class="settings-information-section" aria-labelledby="operationGuideTitle">
        <div class="settings-information-heading">
          <span class="settings-information-icon guide">${iconSvg("clipboard-list")}</span>
          <div><h2 id="operationGuideTitle">软件使用操作</h2><p>XMAI Studio 完整操作指南</p></div>
        </div>
        <div class="settings-guide-list">
          <details class="settings-guide-item" open>
            <summary><span>${iconSvg("square-pen")}</span><strong>开始对话与选择模型</strong>${iconSvg("chevron-down")}</summary>
            <p>点击左侧“新对话”，选择模型或自动模式后输入需求并发送。生成过程中可随时停止，完成的回答可一键复制。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("paperclip")}</span><strong>添加与查看附件</strong>${iconSvg("chevron-down")}</summary>
            <p>在输入框添加图片、文档、表格、演示文稿、音频或视频，也可以直接粘贴内容。附件会显示在当前对话中，可继续围绕附件提问。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("file-text")}</span><strong>生成文档与图片</strong>${iconSvg("chevron-down")}</summary>
            <p>说明需要的内容、格式和排版要求即可生成。结果会以文件或图片卡片展示，可直接预览、复制和下载。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("wand-sparkles")}</span><strong>安装与使用技能</strong>${iconSvg("chevron-down")}</summary>
            <p>在技能页浏览内置、在线和公司技能，按需安装或使用；也可在当前对话的技能选择器中选择技能，技能只关联当前对话。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("bookmark")}</span><strong>使用提示词库</strong>${iconSvg("chevron-down")}</summary>
            <p>进入提示词库后按分类或关键词查找内容，可收藏常用提示词、修改变量、复制文本，或直接带入新对话继续编辑。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("calendar-clock")}</span><strong>自动化任务</strong>${iconSvg("chevron-down")}</summary>
            <p>进入自动化页面创建任务，填写任务名称、执行要求、时间和重复方式。可查看运行状态、暂停、恢复或删除任务。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("globe")}</span><strong>浏览器操作</strong>${iconSvg("chevron-down")}</summary>
            <p>在对话输入框的技能选择器中选择“浏览器操作”，描述网站和任务，即可打开网页并完成内容读取、搜索、点击、输入、选择和下载。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("history")}</span><strong>管理会话</strong>${iconSvg("chevron-down")}</summary>
            <p>左侧会话列表保存历史对话。可切换会话，并通过会话菜单进行重命名、置顶或删除；不同会话的上下文和所选技能相互独立。</p>
          </details>
          <details class="settings-guide-item">
            <summary><span>${iconSvg("settings")}</span><strong>设置、更新与退出</strong>${iconSvg("chevron-down")}</summary>
            <p>在设置页检查更新并管理自动检查。关闭主窗口后软件进入系统托盘，可从托盘重新打开或彻底退出。</p>
          </details>
        </div>
      </section>
    </div>
    <section class="settings-history-section" aria-labelledby="updateHistoryTitle">
      <div class="settings-history-heading">
        <h2 id="updateHistoryTitle">更新记录</h2>
        <span>最近 ${Math.min(updateHistory.length, 12)} 条</span>
      </div>
      ${updateHistory.length ? `<div class="settings-history-list">${updateHistory.map((item) => `
        <div class="settings-history-item">
          <span class="settings-history-dot ${escapeHtml(item.type || "")}" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(updateHistoryLabel(item.type))}${item.displayVersion ? ` · ${escapeHtml(item.displayVersion)}` : ""}</strong>
            <span>${escapeHtml(item.message || item.title || "")}</span>
          </div>
          <time>${escapeHtml(formatUpdateDate(item.at))}</time>
        </div>
      `).join("")}</div>` : `<div class="settings-history-empty">还没有更新记录</div>`}
    </section>
  `;
}

function renderCompanySkillEntry(view, icon, title, description) {
  return `<button class="company-skill-entry" type="button" data-action="show-view" data-view="${escapeHtml(view)}">
    <span class="company-skill-entry-icon">${iconSvg(icon)}</span>
    <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
    ${iconSvg("chevron-right")}
  </button>`;
}

async function refreshUpdateStatus() {
  if (!window.desktopBridge?.getUpdateStatus) return;
  try {
    desktopUpdateStatus = { ...desktopUpdateStatus, ...(await window.desktopBridge.getUpdateStatus()) };
  } catch {
    desktopUpdateStatus = { ...desktopUpdateStatus, supported: false, status: "disabled" };
  }
  if (state.activeView === "settings") renderSettingsPage();
}

async function checkForUpdatesFromSettings() {
  if (updateCheckBusy || !window.desktopBridge?.checkForUpdates) return;
  updateCheckBusy = true;
  desktopUpdateStatus = { ...desktopUpdateStatus, status: "checking" };
  renderSettingsPage();
  try {
    const result = await window.desktopBridge.checkForUpdates();
    desktopUpdateStatus = {
      ...desktopUpdateStatus,
      status: result?.error ? "check-error" : (result?.available ? "available" : "current"),
      availableDisplayVersion: result?.release?.displayVersion || "",
      availableRelease: result?.release || null
    };
  } catch {
    desktopUpdateStatus = { ...desktopUpdateStatus, status: "check-error" };
  } finally {
    updateCheckBusy = false;
    await refreshUpdateStatus();
  }
}

async function setAutoUpdateCheck(enabled) {
  if (!window.desktopBridge?.setAutoUpdateCheck) return;
  desktopUpdateStatus = { ...desktopUpdateStatus, autoCheckEnabled: enabled, status: "idle" };
  renderSettingsPage();
  try {
    desktopUpdateStatus = { ...desktopUpdateStatus, ...(await window.desktopBridge.setAutoUpdateCheck(enabled)) };
  } catch {
    desktopUpdateStatus = { ...desktopUpdateStatus, autoCheckEnabled: !enabled, status: "check-error" };
  }
  renderSettingsPage();
}

function companySkillViewActive() {
  return ["skills", "skill-import", "company-skill-create", "company-skill-submit", "company-skills", "company-skill-mine"].includes(state.activeView)
    || String(state.activeView || "").startsWith("skill-detail:");
}

function applySkillTaxonomy(taxonomy) {
  if (!taxonomy) return false;
  const categories = Array.isArray(taxonomy.categories) ? taxonomy.categories : fallbackSkillCategories;
  const tags = Array.isArray(taxonomy.tags) ? taxonomy.tags : fallbackSkillTags;
  const enabledCategoryIds = new Set(categories.filter((item) => item.status !== "DISABLED").map((item) => item.categoryId));
  skillLibraryState = {
    ...skillLibraryState,
    categoryId: skillLibraryState.categoryId === "all" || enabledCategoryIds.has(skillLibraryState.categoryId) ? skillLibraryState.categoryId : "all",
    categories,
    tags,
    taxonomyLoaded: true,
    taxonomyError: ""
  };
  return true;
}

async function refreshSkillTaxonomy({ render = false } = {}) {
  if (!state.session?.userId || !window.desktopBridge?.getSkillTaxonomy) return;
  try {
    applySkillTaxonomy(await window.desktopBridge.getSkillTaxonomy());
  } catch (error) {
    skillLibraryState = { ...skillLibraryState, taxonomyLoaded: true, taxonomyError: scrubInternalTerms(error.message || "分类同步失败") };
  }
  if (render && state.activeView === "skills") renderSkillsPage();
}

async function refreshCompanySkillData({ silent = false } = {}) {
  if (!state.session?.userId || !window.desktopBridge?.getCompanySkillCatalog) return;
  companySkillState = { ...companySkillState, loading: true, error: "" };
  if (!silent && companySkillViewActive()) renderPageView();
  try {
    const [catalogResult, mineResult, taxonomyResult] = await Promise.allSettled([
      window.desktopBridge.getCompanySkillCatalog(),
      window.desktopBridge.getMySkillSubmissions(),
      window.desktopBridge.getSkillTaxonomy?.()
    ]);
    if (taxonomyResult.status === "fulfilled" && taxonomyResult.value) {
      applySkillTaxonomy(taxonomyResult.value);
    } else if (taxonomyResult.status === "rejected") {
      skillLibraryState = { ...skillLibraryState, taxonomyLoaded: true, taxonomyError: scrubInternalTerms(taxonomyResult.reason?.message || "分类同步失败") };
    }
    const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : null;
    const mine = mineResult.status === "fulfilled" ? mineResult.value : null;
    const remoteErrors = [catalogResult, mineResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "公司技能数据同步失败");
    companySkillState = {
      ...companySkillState,
      catalog: Array.isArray(catalog?.skills) ? catalog.skills : companySkillState.catalog,
      revokedSkillIds: Array.isArray(catalog?.revokedSkillIds) ? catalog.revokedSkillIds : companySkillState.revokedSkillIds,
      submissions: Array.isArray(mine?.submissions) ? mine.submissions : companySkillState.submissions,
      loading: false,
      error: scrubInternalTerms(remoteErrors.join("；")),
      loaded: true
    };
  } catch (error) {
    companySkillState = { ...companySkillState, loading: false, error: scrubInternalTerms(error.message || "公司技能服务暂不可用"), loaded: true };
  }
  if (companySkillViewActive()) renderPageView();
}

async function withdrawCompanySkillSubmission(submissionId, stateVersion, options = {}) {
  const submission = companySkillState.submissions.find((item) => item.submissionId === submissionId);
  if (!submission || submission.status !== "pending") return;
  if (!options.confirmed && !window.confirm(`确定撤回“${submission.displayName}”的审核申请吗？`)) return;
  try {
    await window.desktopBridge?.withdrawSkillSubmission?.({ submissionId, stateVersion });
    showToast("技能审核申请已撤回");
    await refreshCompanySkillData();
  } catch (error) {
    showToast(scrubInternalTerms(error?.message || "技能审核申请撤回失败"));
  }
}

async function chooseCompanySkillSource(sourceType) {
  if (companySkillSubmission.submitting) return;
  companySkillSubmission = { sourcePath: "", inspection: null, importDraft: null, loading: true, submitting: false, error: "" };
  renderCompanySkillSubmitPage();
  try {
    const selected = await window.desktopBridge?.selectSkillSource?.({ sourceType });
    if (selected?.canceled || !selected?.sourcePath) {
      companySkillSubmission.loading = false;
      renderCompanySkillSubmitPage();
      return;
    }
    const inspection = await window.desktopBridge.inspectCompanySkill({ sourcePath: selected.sourcePath });
    companySkillSubmission = inspection?.importDraft
      ? { sourcePath: selected.sourcePath, inspection: null, importDraft: inspection.importDraft, loading: false, submitting: false, error: inspection.validationError || "技能包需要在向导中补全" }
      : { sourcePath: selected.sourcePath, inspection, importDraft: null, loading: false, submitting: false, error: "" };
  } catch (error) {
    companySkillSubmission = { ...companySkillSubmission, inspection: null, importDraft: null, loading: false, error: scrubInternalTerms(error.message || "技能包校验失败") };
  }
  renderCompanySkillSubmitPage();
}

function importCompanySkillDraftIntoWizard() {
  if (companySkillSubmission.importDraft) {
    companySkillDraft = { ...companySkillDraft, ...companySkillSubmission.importDraft };
    saveCompanySkillDraft();
    showToast("已导入技能内容，请补全标记的必填项后生成标准技能包");
  }
  showView("company-skill-create");
}

async function createCompanySkillPackage(saveAs) {
  const form = document.getElementById("companySkillCreateForm");
  if (form && !form.reportValidity()) return;
  try {
    const result = await window.desktopBridge?.createSkillPackage?.({
      userId: state.session?.userId || "local-user",
      draft: companySkillDraft,
      resources: state.selectedFiles,
      saveAs
    });
    if (!result || result.canceled) return;
    showToast(saveAs ? `技能包已保存：${baseName(result.path)}` : "标准技能包已生成，可以提交审核");
    if (!saveAs) {
      const inspection = await window.desktopBridge.inspectCompanySkill({ sourcePath: result.path });
      companySkillSubmission = { sourcePath: result.path, inspection, loading: false, submitting: false, error: "" };
      state.selectedFiles = [];
      showView("company-skill-submit");
    }
  } catch (error) {
    showToast(error.message || "技能包生成失败");
  }
}

async function downloadCompanySkillTemplate() {
  try {
    const result = await window.desktopBridge?.downloadSkillTemplate?.();
    if (result && !result.canceled) showToast(`标准模板已保存：${baseName(result.path)}`);
  } catch (error) {
    showToast(error.message || "标准模板下载失败");
  }
}

async function submitCompanySkillReview() {
  if (!companySkillSubmission.inspection || companySkillSubmission.submitting) return;
  companySkillSubmission.submitting = true;
  companySkillState = { ...companySkillState, progress: { percent: 0, message: "正在准备技能审核包" } };
  renderCompanySkillSubmitPage();
  try {
    const result = await window.desktopBridge.submitCompanySkill({
      userId: state.session?.userId || "local-user",
      sourcePath: companySkillSubmission.sourcePath
    });
    companySkillSubmission = { sourcePath: "", inspection: null, importDraft: null, loading: false, submitting: false, error: "", normalizationNote: "" };
    companySkillState = { ...companySkillState, progress: null };
    await refreshCompanySkillData({ silent: true });
    showToast(`技能“${result?.submission?.displayName || "新技能"}”已提交审核`);
    window.desktopBridge?.notify?.("XMAI Studio", "公司技能已提交审核").catch(() => {});
    if (state.activeView === "company-skill-submit") {
      skillLibraryState.tab = "submissions";
      showView("skills");
    }
  } catch (error) {
    companySkillSubmission = { ...companySkillSubmission, submitting: false, error: scrubInternalTerms(error.message || "提交审核失败") };
    companySkillState = { ...companySkillState, progress: null };
    if (state.activeView === "company-skill-submit") renderCompanySkillSubmitPage();
    showToast(error.message || "提交审核失败");
  }
}

async function installCompanySkillFromCatalog(skillId) {
  const item = companySkillState.catalog.find((skill) => skill.skillId === skillId);
  if (!item) return;
  try {
    showToast(`正在安装“${item.displayName}”`);
    await window.desktopBridge?.installCompanySkill?.({ userId: state.session?.userId || "local-user", skillId });
    await refreshInstalledSkills();
    await refreshCompanySkillData({ silent: true });
    if (state.activeView === "company-skills") renderCompanySkillCatalogPage();
    if (state.activeView === "skills") renderSkillsPage();
    showToast(`技能“${item.displayName}”已安装完成`);
  } catch (error) {
    showToast(error.message || "公司技能安装失败");
  }
}

async function useEnterpriseSkill(skillId) {
  const item = companySkillState.catalog.find((skill) => skill.skillId === skillId);
  if (!item) {
    showToast("企业技能已下架或不存在");
    return;
  }
  let installed = skills.find((skill) => skill.companySkillId === skillId);
  try {
    if (!installed) {
      showToast(`正在安装“${item.displayName}”…`);
      await window.desktopBridge?.installCompanySkill?.({ userId: state.session?.userId || "local-user", skillId });
      await refreshInstalledSkills();
      installed = skills.find((skill) => skill.companySkillId === skillId);
    }
    if (!installed) throw new Error("技能安装完成后未能加载，请刷新后重试");
    openNewConversationWithSkill(installed.id);
  } catch (error) {
    showToast(error.message || "企业技能暂时无法使用");
  }
}

function openNewConversationWithSkill(skillId) {
  const skill = skills.find((item) => item.id === skillId && item.userInvocable !== false);
  if (!skill) {
    showToast("这个技能当前不可用，请刷新技能库后重试");
    return;
  }
  createNewConversation(skill.id);
  reportV11Module("SKILL_LIBRARY", "use_skill", true);
  showToast(`已打开新对话，已选择技能“${skill.name}”`);
}

function handleCompanySkillProgress(progress = {}) {
  companySkillState = { ...companySkillState, progress };
  if (state.activeView === "company-skill-submit") renderCompanySkillSubmitPage();
  if (progress.status === "installed") showToast(`技能“${progress.skillName || "公司技能"}”已安装`);
}

async function syncCompanySkills({ silent = true } = {}) {
  if (!state.session?.userId || !window.desktopBridge?.syncCompanySkills) return;
  try {
    const result = await window.desktopBridge.syncCompanySkills({ userId: state.session.userId });
    companySkillState = {
      ...companySkillState,
      catalog: Array.isArray(result?.skills) ? result.skills : companySkillState.catalog,
      revokedSkillIds: Array.isArray(result?.revokedSkillIds) ? result.revokedSkillIds : companySkillState.revokedSkillIds,
      loaded: true,
      error: ""
    };
    if ((result?.results || []).length) await refreshInstalledSkills();
    if (!silent && (result?.results || []).some((item) => item.status === "updated")) showToast("公司技能已更新到最新审核版本");
  } catch (error) {
    companySkillState = { ...companySkillState, error: scrubInternalTerms(error.message || "公司技能同步失败") };
  }
  if (companySkillViewActive()) renderPageView();
}

function startCompanySkillSync() {
  clearInterval(companySkillSyncTimer);
  clearInterval(skillTaxonomySyncTimer);
  companySkillSyncTimer = null;
  skillTaxonomySyncTimer = null;
  if (!state.session?.userId) return;
  loadCompanySkillDraft();
  window.setTimeout(() => {
    refreshCompanySkillData({ silent: true });
    syncCompanySkills({ silent: true });
  }, 300);
  companySkillSyncTimer = window.setInterval(() => {
    refreshCompanySkillData({ silent: true });
    syncCompanySkills({ silent: true });
  }, 15 * 60 * 1000);
  skillTaxonomySyncTimer = window.setInterval(() => {
    refreshSkillTaxonomy({ render: state.activeView === "skills" });
  }, 60 * 1000);
}

async function installCreatedSkill() {
  const form = document.getElementById("companySkillCreateForm");
  if (form && !form.reportValidity()) return;
  const installButton = document.querySelector('[data-action="install-created-skill"]');
  if (installButton?.disabled) return;
  const originalButtonHtml = installButton?.innerHTML || "";
  if (installButton) {
    installButton.disabled = true;
    installButton.innerHTML = `${iconSvg("refresh-cw")}<span>正在保存</span>`;
  }
  try {
    const userId = state.session?.userId || "local-user";
    const packageResult = await window.desktopBridge?.createSkillPackage?.({
      userId,
      draft: companySkillDraft,
      resources: state.selectedFiles,
      saveAs: false
    });
    if (!packageResult || packageResult.canceled || !packageResult.path) return;
    const inspection = await window.desktopBridge?.inspectSkillSource?.({ userId, sourcePath: packageResult.path });
    if (!inspection?.skill) throw new Error("技能生成后未能通过安装校验");

    if (inspection.requiresRiskAcknowledgement || inspection.requiresReplace) {
      resetLocalSkillImport();
      localSkillImport = {
        ...localSkillImport,
        step: 2,
        source: "zip",
        sourcePath: packageResult.path,
        returnView: "company-skill-create"
      };
      applySkillImportInspection(inspection);
      localSkillImport.step = 2;
      localSkillImport.returnView = "company-skill-create";
      localSkillImport.error = inspection.requiresRiskAcknowledgement
        ? "该技能包含需要确认的风险项，请确认后保存。"
        : "我的技能中已存在同名技能，请确认是否覆盖。";
      showView("skill-import");
      return;
    }

    const installResult = await window.desktopBridge?.installSkill?.({
      userId,
      sourcePath: packageResult.path,
      skillName: companySkillDraft.displayName,
      categoryId: companySkillDraft.categoryId,
      tagIds: Array.isArray(companySkillDraft.tagIds) ? companySkillDraft.tagIds : [],
      acknowledgeRisk: false,
      replace: false,
      background: false
    });
    if (!installResult?.installed || !installResult.skill?.id) throw new Error("技能未完成保存");
    const installedSkillId = installResult.skill.id;
    state.selectedFiles = [];
    await refreshInstalledSkills();
    openPersonalSkillDetail(installedSkillId);
    showToast(`技能“${companySkillDraft.displayName}”已保存到我的技能`);
  } catch (error) {
    showToast(scrubInternalTerms(error?.message || "技能保存失败"));
  } finally {
    if (installButton?.isConnected) {
      installButton.disabled = false;
      installButton.innerHTML = originalButtonHtml;
    }
  }
}

function renderOnlineSkillLibrary() {
  if (!els.onlineSkillResults || !els.onlineSkillStatus) return;
  if (els.onlineSkillSearchInput && document.activeElement !== els.onlineSkillSearchInput) els.onlineSkillSearchInput.value = onlineSkillLibrary.query;
  const installedReferences = new Set(skills.filter((skill) => skill.installed && skill.sourceReference).map((skill) => skill.sourceReference));
  els.onlineSkillResults.innerHTML = onlineSkillLibrary.results.length
    ? onlineSkillLibrary.results.map((skill) => {
      const installed = installedReferences.has(skill.reference);
      const installing = onlineSkillInstallRefs.has(skill.reference);
      const preflightPending = skill.preflightStatus === "unavailable" || skill.preflightStatus === "skipped";
      return `
        <article class="online-skill-item">
          <span class="online-skill-avatar">${escapeHtml(String(skill.name || skill.slug || "技").slice(0, 1).toUpperCase())}</span>
          <span class="online-skill-copy">
            <strong>${escapeHtml(skill.name || skill.slug)}</strong>
            <small>${escapeHtml(skill.description || "暂无简介")}</small>
            <span class="online-skill-meta">${skill.ownerName || skill.ownerHandle ? `发布者 ${escapeHtml(skill.ownerName || skill.ownerHandle)}` : "指定来源"}${skill.downloads ? ` · ${escapeHtml(Number(skill.downloads).toLocaleString("zh-CN"))} 次下载` : ""}</span>
          </span>
          <button class="${installed ? "secondary-button" : "primary-button"}" type="button" data-install-online-skill="${escapeHtml(skill.reference)}" ${installing ? "disabled" : ""} title="${escapeHtml(preflightPending ? (skill.installabilityReason || "安装时会再次检查技能格式") : "")}">${installing ? "安装中..." : (installed ? "重新安装" : "安装")}</button>
        </article>
      `;
    }).join("")
    : (!onlineSkillLibrary.loading && onlineSkillLibrary.loaded ? `<div class="online-skills-empty">没有找到相关技能，可以换个关键词或粘贴 GitHub 地址。</div>` : "");
  const resultSummary = onlineSkillLibrary.loaded
    ? `共找到 ${onlineSkillLibrary.results.length} 个技能${onlineSkillLibrary.filteredCount ? `，已过滤 ${onlineSkillLibrary.filteredCount} 个格式不兼容技能` : ""}${onlineSkillLibrary.preflightPendingCount ? `，${onlineSkillLibrary.preflightPendingCount} 个将在安装时检查` : ""}`
    : "";
  els.onlineSkillStatus.textContent = onlineSkillLibrary.loading
    ? "正在搜索在线技能..."
    : (onlineSkillInstallRefs.size ? `正在后台安装 ${onlineSkillInstallRefs.size} 个技能...` : (onlineSkillLibrary.error || resultSummary));
  els.onlineSkillStatus.classList.toggle("error", Boolean(onlineSkillLibrary.error));
}

async function searchOnlineSkillLibrary(query = "") {
  if (!window.desktopBridge?.searchOnlineSkills || onlineSkillLibrary.loading) return;
  onlineSkillLibrary = { ...onlineSkillLibrary, query: String(query || "").trim(), loading: true, error: "" };
  renderOnlineSkillLibrary();
  try {
    const response = await window.desktopBridge.searchOnlineSkills({ query: onlineSkillLibrary.query, limit: 20 });
    onlineSkillLibrary = {
      ...onlineSkillLibrary,
      results: Array.isArray(response?.results) ? response.results : [],
      filteredCount: Math.max(0, Number(response?.filteredCount || 0)),
      preflightPendingCount: Math.max(0, Number(response?.preflightPendingCount || 0)),
      loading: false,
      loaded: true,
      error: ""
    };
  } catch (error) {
    onlineSkillLibrary = { ...onlineSkillLibrary, results: [], loading: false, loaded: true, error: scrubInternalTerms(error.message || "在线技能搜索失败") };
  }
  renderOnlineSkillLibrary();
}

function closeSkillInstallConfirmation() {
  pendingOnlineSkillConfirmation = null;
  els.skillInstallConfirmModal?.classList.add("hidden");
  if (els.skillInstallConfirmCheck) els.skillInstallConfirmCheck.checked = false;
  if (els.skillInstallConfirmButton) els.skillInstallConfirmButton.disabled = true;
}

function openOnlineSkillConfirmation(reference, flags, result) {
  const risk = Boolean(result?.requiresRiskAcknowledgement);
  const skill = result?.inspection?.skill || {};
  pendingOnlineSkillConfirmation = {
    reference,
    flags: { ...flags, ...(risk ? { acknowledgeRisk: true } : { replace: true }) }
  };
  els.skillInstallConfirmTitle.textContent = risk ? "确认安装此技能?" : "覆盖同名技能?";
  els.skillInstallConfirmText.textContent = risk
    ? `${skill.name || reference} 包含需要人工复核的内容。只有确认来源可信后才能继续。`
    : `${skill.name || reference} 已安装在当前用户的本地技能库中，继续会覆盖原版本。`;
  const items = Array.isArray(skill.riskItems) ? skill.riskItems : [];
  els.skillInstallRiskList.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  els.skillInstallRiskList.classList.toggle("hidden", !items.length);
  els.skillInstallConfirmLabel.textContent = risk ? "我已核对技能来源并确认继续安装" : "我确认覆盖当前用户的同名技能";
  els.skillInstallConfirmCheck.checked = false;
  els.skillInstallConfirmButton.disabled = true;
  els.skillInstallConfirmModal.classList.remove("hidden");
}

async function installOnlineSkill(reference, flags = {}) {
  if (!reference || onlineSkillInstallRefs.has(reference)) return;
  closeSkillInstallConfirmation();
  onlineSkillInstallRefs.add(reference);
  onlineSkillLibrary = { ...onlineSkillLibrary, error: "" };
  renderOnlineSkillLibrary();
  try {
    const result = await window.desktopBridge?.installOnlineSkill?.({
      userId: state.session?.userId || "local-user",
      reference,
      ...flags,
      background: true
    });
    if (result?.queued) {
      renderOnlineSkillLibrary();
      showToast(`技能“${reference}”已开始后台安装`);
      return;
    }
    if (result?.requiresRiskAcknowledgement || result?.requiresReplace) {
      onlineSkillInstallRefs.delete(reference);
      renderOnlineSkillLibrary();
      openOnlineSkillConfirmation(reference, flags, result);
      return;
    }
    if (result?.filtered) {
      onlineSkillInstallRefs.delete(reference);
      onlineSkillLibrary = {
        ...onlineSkillLibrary,
        results: onlineSkillLibrary.results.filter((skill) => skill.reference !== reference),
        filteredCount: onlineSkillLibrary.filteredCount + 1,
        error: ""
      };
      renderOnlineSkillLibrary();
      showToast("已过滤不符合安装格式的技能");
      return;
    }
    if (!result?.installed) throw new Error("技能未完成安装");
    onlineSkillInstallRefs.delete(reference);
    await refreshInstalledSkills();
    renderOnlineSkillLibrary();
    showToast(`技能“${result.skill?.name || "新技能"}”已安装`);
  } catch (error) {
    onlineSkillInstallRefs.delete(reference);
    onlineSkillLibrary = { ...onlineSkillLibrary, error: scrubInternalTerms(error.message || "在线技能安装失败") };
    renderOnlineSkillLibrary();
  }
}

function selectModel(value) {
  state.config.model = value;
  state.config.modelSelectionExplicit = true;
  els.modelDropdown?.classList.remove("open");
  saveState();
  renderModelPicker();
  showToast("模型已切换");
}

function extractHtmlBlock(content) {
  const matches = [...String(content || "").matchAll(/```(?:html|htm)?\s*([\s\S]*?)```/gi)];
  return matches.map((match) => match[1].trim()).find((value) => /<(!doctype|html|body|canvas|script|style)/i.test(value)) || "";
}

function currentUserName() {
  return state.session?.name || "你";
}

function previewText(value) {
  const template = document.createElement("template");
  template.innerHTML = renderRichText(value || "");
  const text = String(template.content.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}...` : text || "空消息";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function baseName(filePath) {
  const value = typeof filePath === "object" ? filePath?.name || filePath?.path || filePath?.absolutePath : filePath;
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || String(value || "文件");
}

function attachmentPathList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => typeof item === "string" ? item : item?.absolutePath || item?.path || "")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function attachmentNameList(items) {
  return attachmentPathList(items).map(baseName);
}

function latestConversationAttachments(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const attachments = sanitizeAttachmentItems(messages[index]?.attachments);
    if (attachments.length) return attachments;
  }
  return [];
}

function resolveMessageAttachments(conversation, selectedFiles, text) {
  const selected = sanitizeAttachmentItems(selectedFiles);
  if (selected.length) return selected;
  const content = String(text || "").trim();
  const referencesPriorAttachment = /(继续|接着|继续处理|接着处理|按刚才|基于刚才|重新处理|这段录音|这段音频|这个视频|这份文档|这个文件|这个附件|该录音|该音频|该视频|该文件|该附件|上述材料|前面的材料|刚才的材料|刚才的附件)/i.test(content);
  return referencesPriorAttachment ? latestConversationAttachments(conversation) : [];
}

function createNewConversation(skillId = null) {
  const conversation = createConversation("新的对话");
  if (skillId) conversation.skillId = skillId;
  state.conversations.unshift(conversation);
  state.activeConversationId = conversation.id;
  openConversationMenuId = null;
  renamingConversationId = null;
  state.activeSkillId = conversation.skillId;
  state.selectedFiles = [];
  pendingArtifactOutput = null;
  state.activeView = "chat";
  state.taskResult = null;
  saveState();
  render();
  focusPrompt();
  return conversation;
}

function setActiveConversation(id) {
  if (state.conversations.some((conversation) => conversation.id === id)) {
    state.activeConversationId = id;
    state.activeSkillId = activeConversation()?.skillId || null;
    openConversationMenuId = null;
    renamingConversationId = null;
    state.selectedFiles = [];
    pendingArtifactOutput = null;
    state.activeView = "chat";
    state.taskResult = null;
    saveState();
    render();
    focusPrompt();
  }
}

function toggleConversationMenu(id) {
  renamingConversationId = null;
  openConversationMenuId = openConversationMenuId === id ? null : id;
  renderConversationList();
}

function startConversationRename(id) {
  if (!state.conversations.some((conversation) => conversation.id === id)) return;
  openConversationMenuId = null;
  renamingConversationId = id;
  renderConversationList();
  requestAnimationFrame(() => {
    const input = els.conversationList.querySelector(`[data-conversation-rename-input="${CSS.escape(id)}"]`);
    input?.focus();
    input?.select();
  });
}

function saveConversationRename(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  const input = els.conversationList.querySelector(`[data-conversation-rename-input="${CSS.escape(id)}"]`);
  if (!conversation || !input) return;
  const title = input.value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) {
    showToast("对话名称不能为空");
    input.focus();
    return;
  }
  conversation.title = title;
  conversation.customTitle = true;
  conversation.updatedAt = new Date().toISOString();
  renamingConversationId = null;
  saveState();
  render();
}

function cancelConversationRename() {
  renamingConversationId = null;
  renderConversationList();
}

function toggleConversationPin(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;
  conversation.pinned = !conversation.pinned;
  conversation.pinnedAt = conversation.pinned ? new Date().toISOString() : null;
  openConversationMenuId = null;
  saveState();
  renderConversationList();
  showToast(conversation.pinned ? "对话已置顶" : "已取消置顶");
}

function openConversationDelete(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation || !els.conversationDeleteModal) return;
  deletingConversationId = id;
  openConversationMenuId = null;
  if (els.conversationDeleteText) {
    els.conversationDeleteText.textContent = `“${conversation.title}”及其中的本地消息将被删除，此操作无法撤销。`;
  }
  els.conversationDeleteModal.classList.remove("hidden");
  renderConversationList();
}

function closeConversationDelete() {
  deletingConversationId = null;
  els.conversationDeleteModal?.classList.add("hidden");
}

function confirmConversationDelete() {
  const id = deletingConversationId;
  if (!id) return;

  const pending = pendingConversationRequests.get(id);
  if (pending?.requestId) {
    window.desktopBridge?.cancelChatCompletion?.(pending.requestId)?.catch?.(() => {});
    pendingChatStreams.delete(String(pending.requestId));
  }
  pendingConversationRequests.delete(id);
  state.conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (!state.conversations.length) {
    state.conversations.push(createConversation("新的对话"));
  }
  if (!state.conversations.some((conversation) => conversation.id === state.activeConversationId)) {
    state.activeConversationId = state.conversations[0].id;
  }
  renamingConversationId = null;
  closeConversationDelete();
  saveState();
  render();
  showToast("对话已删除");
}

function setActiveSkill(id) {
  const conversation = activeConversation();
  setConversationSkill(conversation, id);
  state.activeView = "chat";
  state.taskResult = null;
  saveState();
  render();
  focusPrompt();
}

function setConversationSkill(conversation, id) {
  if (!conversation) return null;
  const skillId = skills.some((skill) => skill.id === id && skill.userInvocable !== false) ? id : null;
  conversation.skillId = skillId;
  if (conversation.id === state.activeConversationId) state.activeSkillId = skillId;
  return skillId;
}

function clearActiveSkill() {
  const conversation = activeConversation();
  setConversationSkill(conversation, null);
  state.activeView = "chat";
  state.taskResult = null;
  saveState();
  render();
  focusPrompt();
}

function showView(view) {
  const previousView = state.activeView;
  if (state.activeView.startsWith("skill-form:") && view !== state.activeView) {
    state.selectedFiles = [];
  }
  if (state.activeView === "company-skill-create" && view !== state.activeView) state.selectedFiles = [];
  if (state.activeView === "automation-editor" && view !== "automation-editor") automationEditorDraft = null;
  if (previousView === "prompt-library" && view !== "prompt-library") {
    promptLibraryState.activePrompt = null;
    promptLibraryState.argumentValues = {};
  }
  state.activeView = view || "chat";
  if (state.activeView !== "chat") pendingArtifactOutput = null;
  if (view !== "task-result") {
    state.taskResult = null;
  }
  if (state.activeView === "company-skill-create") loadCompanySkillDraft();
  saveState();
  render();
  reportV11ModuleVisit(state.activeView);
  if (state.activeView === "prompt-library" && !promptLibraryState.loaded && !promptLibraryState.loading) loadPromptLibrary();
  if (companySkillViewActive()) refreshCompanySkillData({ silent: true });
  if (state.activeView === "settings") refreshUpdateStatus();
  if (state.activeView === "chat") {
    focusPrompt();
  }
}

function openSkillForm(skillId) {
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return;
  if (skill.companySkillId && companySkillState.revokedSkillIds.includes(skill.companySkillId)) {
    showToast("这个企业技能已下架，不能继续使用");
    syncCompanySkills({ silent: true });
    return;
  }
  if (state.activeView !== `skill-form:${skill.id}`) state.selectedFiles = [];
  state.activeView = `skill-form:${skill.id}`;
  state.taskResult = null;
  saveState();
  render();
  reportV11Module("SKILL_LIBRARY", "use_skill", true);
}

function openPersonalSkillDetail(skillId) {
  if (!skills.some((item) => item.id === skillId && item.installed && !item.companySkillId)) return;
  state.activeView = `skill-detail:${skillId}`;
  state.taskResult = null;
  saveState();
  render();
}

function editorTagsForSkill(skill) {
  const serverTags = (skill.tagIds || []).map((tagId) => {
    const serverTag = skillLibraryState.tags.find((item) => item.tagId === tagId);
    return serverTag && serverTag.status !== "DISABLED"
      ? { tagId: serverTag.tagId, name: serverTag.name, isNew: false }
      : null;
  }).filter(Boolean);
  const customTags = (skill.customTags || []).map((tag) => ({ tagId: tag.tagId, name: tag.name, isNew: true }));
  const customNames = new Set(customTags.map((tag) => normalizedCustomSkillTagName(tag.name).toLocaleLowerCase("zh-CN")));
  const newTags = (skill.newTags || [])
    .filter((name) => !customNames.has(normalizedCustomSkillTagName(name).toLocaleLowerCase("zh-CN")))
    .map((name) => ({ name, isNew: true }));
  return normalizedSkillTagList([...serverTags, ...customTags, ...newTags]);
}

function renderInstalledSkillEditorTags() {
  if (!els.installedSkillTagEditor) return;
  const selectedIds = new Set(installedSkillEditor.tags.map((item) => item.tagId));
  const available = skillLibraryState.tags.filter((item) => item.status !== "DISABLED" && !selectedIds.has(item.tagId));
  els.installedSkillTagEditor.innerHTML = `
    ${installedSkillEditor.tags.map((tag, index) => `<span class="installed-skill-tag">${escapeHtml(tag.name)}<button type="button" data-remove-installed-skill-tag="${index}" aria-label="删除标签 ${escapeHtml(tag.name)}" title="删除标签">${iconSvg("x")}</button></span>`).join("")}
    <input id="installedSkillTagInput" maxlength="30" placeholder="搜索或新增标签" value="${escapeHtml(installedSkillEditor.tagQuery || "")}" autocomplete="off" aria-label="搜索或新增标签" aria-controls="installedSkillTagSuggestions">
    <span class="skill-tag-picker-chevron" aria-hidden="true">${iconSvg("chevron-down")}</span>
    <div class="skill-tag-suggestions" id="installedSkillTagSuggestions" role="listbox" aria-label="可选标签">
      ${available.length ? available.map((tag) => `<button type="button" role="option" data-select-installed-skill-tag="${escapeHtml(tag.tagId)}" data-tag-search-name="${escapeHtml(tag.name.toLocaleLowerCase("zh-CN"))}">${escapeHtml(tag.name)}</button>`).join("") : `<span class="skill-tag-suggestions-empty">没有更多可选标签</span>`}
      <button class="skill-tag-create-option" type="button" data-create-installed-skill-tag hidden>${iconSvg("plus")}<span data-custom-tag-label>新增标签</span></button>
      <span class="skill-tag-suggestions-empty filtered hidden" data-skill-tag-filter-empty>没有匹配的标签</span>
    </div>
  `;
}

function renderInstalledSkillEditor() {
  const skill = skills.find((item) => item.id === installedSkillEditor.skillId && item.installed && !item.companySkillId);
  if (!skill || !els.installedSkillEditModal) return;
  const categories = skillLibraryState.categories
    .filter((item) => item.status !== "DISABLED")
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  els.installedSkillEditName.value = skill.name || "";
  els.installedSkillEditDescription.value = skill.description || "";
  els.installedSkillEditCategory.innerHTML = categories.map((item) => `<option value="${escapeHtml(item.categoryId)}" ${item.categoryId === skill.categoryId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  els.installedSkillEditInstructions.value = skill.instructions || skill.systemPrompt || "";
  els.installedSkillEditStatus.textContent = installedSkillEditor.error || "";
  els.installedSkillEditStatus.classList.toggle("error", Boolean(installedSkillEditor.error));
  els.installedSkillEditSaveButton.disabled = installedSkillEditor.saving;
  els.installedSkillEditSaveButton.textContent = installedSkillEditor.saving ? "正在保存..." : "保存修改";
  renderInstalledSkillEditorTags();
}

function editInstalledSkill(skillId) {
  const skill = skills.find((item) => item.id === skillId && item.installed && !item.companySkillId);
  if (!skill) return showToast("个人技能不存在或已卸载");
  installedSkillEditor = { skillId, tags: editorTagsForSkill(skill), tagQuery: "", saving: false, error: "" };
  renderInstalledSkillEditor();
  els.installedSkillEditModal?.classList.remove("hidden");
  window.setTimeout(() => els.installedSkillEditName?.focus(), 0);
}

function closeInstalledSkillEditor() {
  if (installedSkillEditor.saving) return;
  els.installedSkillEditModal?.classList.add("hidden");
  installedSkillEditor = { skillId: "", tags: [], tagQuery: "", saving: false, error: "" };
}

function addInstalledSkillEditorTag(tagId) {
  const existing = skillLibraryState.tags.find((item) => item.status !== "DISABLED" && item.tagId === tagId);
  if (!existing) return;
  const tag = { tagId: existing.tagId, name: existing.name, isNew: false };
  if (!installedSkillEditor.tags.some((item) => item.tagId === tag.tagId || item.name.toLocaleLowerCase("zh-CN") === tag.name.toLocaleLowerCase("zh-CN"))) {
    installedSkillEditor.tags.push(tag);
  }
  installedSkillEditor.tagQuery = "";
  renderInstalledSkillEditorTags();
  installedSkillEditor.error = "";
  els.installedSkillEditStatus.textContent = "";
  els.installedSkillEditStatus.classList.remove("error");
  document.getElementById("installedSkillTagInput")?.focus();
}

function addInstalledSkillEditorCustomTag() {
  const name = normalizedCustomSkillTagName(installedSkillEditor.tagQuery);
  if (!name || installedSkillEditor.tags.length >= 20) return;
  const server = skillLibraryState.tags.find((item) => item.status !== "DISABLED" && item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
  if (server) return addInstalledSkillEditorTag(server.tagId);
  if (!installedSkillEditor.tags.some((item) => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) {
    installedSkillEditor.tags.push({ tagId: customSkillTagId(name), name, isNew: true });
  }
  installedSkillEditor.tagQuery = "";
  installedSkillEditor.error = "";
  renderInstalledSkillEditorTags();
  els.installedSkillEditStatus.textContent = "";
  els.installedSkillEditStatus.classList.remove("error");
  document.getElementById("installedSkillTagInput")?.focus();
}

function filterSkillTagSuggestions(input, stateTarget) {
  const rawQuery = normalizedCustomSkillTagName(input?.value);
  const query = rawQuery.toLocaleLowerCase("zh-CN");
  if (stateTarget === "import") localSkillImport.tagQuery = rawQuery;
  if (stateTarget === "installed") installedSkillEditor.tagQuery = rawQuery;
  const picker = input?.closest(".skill-tag-picker, .installed-skill-tag-editor");
  if (!picker) return;
  let visible = 0;
  picker.querySelectorAll("[data-tag-search-name]").forEach((button) => {
    const matches = !query || String(button.dataset.tagSearchName || "").includes(query);
    button.hidden = !matches;
    if (matches) visible += 1;
  });
  const selectedTags = stateTarget === "import" ? localSkillImport.tags : installedSkillEditor.tags;
  const exactMatch = [...skillLibraryState.tags.filter((item) => item.status !== "DISABLED"), ...selectedTags]
    .some((item) => normalizedCustomSkillTagName(item.name).toLocaleLowerCase("zh-CN") === query);
  const createButton = picker.querySelector(stateTarget === "import" ? "[data-create-skill-import-tag]" : "[data-create-installed-skill-tag]");
  const canCreate = Boolean(rawQuery) && !exactMatch && selectedTags.length < 20;
  if (createButton) {
    createButton.hidden = !canCreate;
    const label = createButton.querySelector("[data-custom-tag-label]");
    if (label) label.textContent = `新增“${rawQuery}”`;
  }
  const empty = picker.querySelector("[data-skill-tag-filter-empty]");
  if (empty) empty.classList.toggle("hidden", visible > 0 || canCreate || !query);
}

function openSkillActionConfirmation(button) {
  const action = button?.dataset.confirmSkillAction;
  if (!action || !els.skillActionConfirmModal) return;
  const skillName = button.dataset.skillName || "该技能";
  const copy = {
    submit: {
      title: button.textContent.includes("重新") ? "重新提交审批" : "提交企业审批",
      text: button.textContent.includes("重新")
        ? `将“${skillName}”当前修改后的内容重新提交审批。历史记录会保留，审核中的版本不能修改。`
        : `将“${skillName}”提交企业审批。提交身份来自当前钉钉账号，审核中的版本不能修改。`,
      confirmText: button.textContent.includes("重新") ? "确认重新提交" : "确认提交",
      icon: "send",
      danger: false
    },
    withdraw: {
      title: "撤回审批申请",
      text: `撤回“${skillName}”后，该版本将停止审批，你可以继续编辑并重新提交。`,
      confirmText: "确认撤回",
      icon: "undo-2",
      danger: true
    },
    delete: {
      title: "删除个人技能",
      text: `删除“${skillName}”后，该技能将从当前账号的技能库中移除，此操作无法撤销。`,
      confirmText: "确认删除",
      icon: "trash-2",
      danger: true
    }
  }[action];
  if (!copy) return;
  pendingSkillAction = {
    action,
    skillId: button.dataset.skillId || "",
    skillName,
    submissionId: button.dataset.submissionId || "",
    stateVersion: Number(button.dataset.stateVersion || 1),
    submissionStatus: button.dataset.submissionStatus || ""
  };
  els.skillActionConfirmTitle.textContent = copy.title;
  els.skillActionConfirmText.textContent = copy.text;
  const confirmIcon = document.getElementById("skillActionConfirmIcon");
  if (confirmIcon) {
    confirmIcon.innerHTML = iconSvg(copy.icon);
    confirmIcon.classList.toggle("danger", copy.danger);
  }
  els.skillActionConfirmButton.textContent = copy.confirmText;
  els.skillActionConfirmButton.classList.toggle("danger", copy.danger);
  els.skillActionConfirmModal.classList.remove("hidden");
  window.setTimeout(() => els.skillActionConfirmButton?.focus(), 0);
}

function closeSkillActionConfirmation() {
  els.skillActionConfirmModal?.classList.add("hidden");
  pendingSkillAction = null;
}

async function confirmSkillAction() {
  const pending = pendingSkillAction;
  if (!pending) return;
  closeSkillActionConfirmation();
  if (pending.action === "submit") {
    await prepareInstalledSkillForReview(pending.skillId);
    return;
  }
  if (pending.action === "withdraw") {
    await withdrawCompanySkillSubmission(pending.submissionId, pending.stateVersion, { confirmed: true });
    return;
  }
  if (pending.action !== "delete") return;
  try {
    await window.desktopBridge?.removeInstalledSkill?.({
      userId: state.session?.userId || "local-user",
      skillId: pending.skillId,
      submissionStatus: pending.submissionStatus
    });
    state.activeView = "skills";
    await refreshInstalledSkills();
    reportV11Module("SKILL_LIBRARY", "delete_personal_skill", true);
    showToast(`技能“${pending.skillName}”已删除`);
  } catch (error) {
    showToast(scrubInternalTerms(error?.message || "技能删除失败"));
  }
}

async function saveInstalledSkillEditor() {
  if (installedSkillEditor.saving || !els.installedSkillEditForm?.reportValidity()) return;
  if (!installedSkillEditor.tags.length) {
    installedSkillEditor.error = "请至少选择一个标签";
    els.installedSkillEditStatus.textContent = installedSkillEditor.error;
    els.installedSkillEditStatus.classList.add("error");
    document.getElementById("installedSkillTagInput")?.focus();
    return;
  }
  const categoryOption = els.installedSkillEditCategory.selectedOptions[0];
  installedSkillEditor.saving = true;
  installedSkillEditor.error = "";
  els.installedSkillEditSaveButton.disabled = true;
  els.installedSkillEditSaveButton.textContent = "正在保存...";
  try {
    await window.desktopBridge?.updateInstalledSkill?.({
      userId: state.session?.userId || "local-user",
      skillId: installedSkillEditor.skillId,
      displayName: els.installedSkillEditName.value,
      description: els.installedSkillEditDescription.value,
      categoryId: els.installedSkillEditCategory.value,
      category: categoryOption?.textContent || "其他",
      tags: installedSkillEditor.tags,
      instructions: els.installedSkillEditInstructions.value
    });
    const skillId = installedSkillEditor.skillId;
    await refreshInstalledSkills();
    installedSkillEditor.saving = false;
    closeInstalledSkillEditor();
    state.activeView = `skill-detail:${skillId}`;
    render();
    showToast("技能内容已保存，可以继续使用或提交审批");
  } catch (error) {
    installedSkillEditor = { ...installedSkillEditor, saving: false, error: scrubInternalTerms(error?.message || "技能保存失败") };
    els.installedSkillEditStatus.textContent = installedSkillEditor.error;
    els.installedSkillEditStatus.classList.add("error");
    els.installedSkillEditSaveButton.disabled = false;
    els.installedSkillEditSaveButton.textContent = "保存修改";
  }
}

async function prepareInstalledSkillForReview(skillId, triggerButton = null) {
  if (!window.desktopBridge?.getInstalledSkillSource || !window.desktopBridge?.prepareInstalledSkillSubmission) {
    return showToast("当前版本无法提交技能审核");
  }
  const skill = skills.find((item) => item.id === skillId && item.installed && !item.companySkillId);
  if (!skill) return showToast("个人技能不存在或已卸载");
  const originalButtonHtml = triggerButton?.innerHTML || "";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.innerHTML = `${iconSvg("refresh-cw")}<span>正在准备审核包</span>`;
  }
  showToast("正在校验技能并生成企业审核包");
  try {
    const source = await window.desktopBridge.getInstalledSkillSource({ userId: state.session?.userId || "local-user", skillId });
    const prepared = await window.desktopBridge.prepareInstalledSkillSubmission({
      userId: state.session?.userId || "local-user",
      sourcePath: source.sourcePath,
      skill: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        categoryId: skill.categoryId,
        tagIds: skill.tagIds,
        customTags: skill.customTags,
        newTags: skill.newTags,
        starter: skill.starter,
        icon: skill.icon,
        fields: skill.fields
      }
    });
    companySkillSubmission = {
      sourcePath: prepared.sourcePath,
      inspection: prepared.inspection,
      importDraft: null,
      loading: false,
      submitting: false,
      error: "",
      normalizationNote: prepared.normalizationMessage || ""
    };
    showView("company-skill-submit");
    reportV11Module("SKILL_LIBRARY", "submit_for_review", true);
    showToast(prepared.normalized ? "已转换为标准审核包，请确认后提交" : "技能校验通过，请确认后提交");
  } catch (error) {
    showToast(scrubInternalTerms(error.message || "审核包准备失败，请检查技能内容"));
  } finally {
    if (triggerButton?.isConnected) {
      triggerButton.disabled = false;
      triggerButton.innerHTML = originalButtonHtml;
    }
  }
}

function toggleOptionPill(pill) {
  const row = pill.closest(".option-row");
  if (!row) return;
  if (row.hasAttribute("data-single")) {
    row.querySelectorAll("[data-option-pill]").forEach((item) => item.classList.remove("selected"));
    pill.classList.add("selected");
    return;
  }
  pill.classList.toggle("selected");
}

function submitSkillForm(skillId) {
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return;
  if (skill.companySkillId && companySkillState.revokedSkillIds.includes(skill.companySkillId)) {
    showToast("这个企业技能已下架，不能继续使用");
    syncCompanySkills({ silent: true });
    return;
  }
  const values = collectSkillFormValues();
  if (skill.id === "documents") {
    submitDocumentSkill(skill, values);
    return;
  }
  if (skill.id === "meeting") {
    submitMeetingSkill(skill, values);
    return;
  }
  if (skill.id === "weekly") {
    submitWeeklySkill(skill, values);
    return;
  }
  if (skill.installed) {
    submitInstalledSkill(skill, values);
    return;
  }
  const prompt = buildSkillPrompt(skill, values);
  const scenario = skillScenarios[skill.id] || skillScenarios.weekly;
  state.activeView = "task-result";
  state.taskResult = {
    id: createId("task"),
    skillId: skill.id,
    prompt,
    userMsg: scenario.userMsg,
    historyTitle: scenario.historyTitle,
    statusText: scenario.steps[0],
    steps: scenario.steps,
    doneSteps: [],
    resultTitle: scenario.resultTitle,
    resultBody: scenario.resultBody,
    resultType: scenario.resultType,
    resultText: scenario.resultText || "",
    imageCount: scenario.imageCount || 0,
    downloadLabel: scenario.downloadLabel || "",
    needsConfirm: Boolean(scenario.needsConfirm),
    confirmTitle: scenario.confirmTitle || "检测到同名文件，是否覆盖?",
    confirmText: scenario.confirmText || "继续执行将覆盖原文件内容，此操作无法撤销。",
    afterConfirmSteps: scenario.afterConfirmSteps || [],
    selectedFiles: attachmentPathList(state.selectedFiles),
    finished: false
  };
  state.selectedFiles = [];
  saveState();
  render();
  window.setTimeout(() => startTaskFlow(), 0);
}

function submitInstalledSkill(skill, values) {
  const text = values.map((item) => `${item.label}：${item.value}`).join("\n\n");
  const attachments = attachmentPathList(state.selectedFiles);
  const hasTaskText = values.some((item) => item.type === "textarea" && String(item.value || "").trim());
  if (!hasTaskText && !attachments.length) {
    showToast("请填写要处理的内容，或选择一个附件");
    els.pageContent.querySelector("textarea")?.focus();
    return;
  }
  startLocalSkillResult({
    skill,
    format: "docx",
    title: `${skill.name}结果`,
    userMsg: `使用技能：${skill.name}`,
    historyTitle: `${skill.name}执行`,
    resultBody: `已使用“${skill.name}”整理内容并生成 DOCX 文档。`,
    resultText: text || "请根据附件执行这个技能。",
    contentPrompt: [skill.systemPrompt, text || "请根据附件执行这个技能。", attachments.length ? `附件路径：\n${attachments.join("\n")}` : ""].filter(Boolean).join("\n\n"),
    selectedFiles: attachments,
    useFullAgent: attachments.length > 0,
    preferGateway: attachments.length > 0,
    resultType: "document",
    persistArtifacts: true,
    downloadLabel: "下载 DOCX",
    steps: ["正在读取技能参数…", "正在执行技能…", "正在整理结果…"]
  });
}

function documentFormatFromLabel(label) {
  const value = String(label || "");
  const match = value.match(/[（(]([^）)]+)[）)]/);
  return (match?.[1] || ({
    "PDF": "pdf",
    "CSV": "csv",
    "JSON": "json",
    "XML": "xml",
    "RTF": "rtf",
    "ZIP": "zip"
  }[value] || "docx")).toLowerCase();
}

function submitDocumentSkill(skill, values) {
  const valueByLabel = new Map(values.map((item) => [item.label, item.value]));
  const title = valueByLabel.get("文档标题") || "未命名文档";
  const content = valueByLabel.get("文档内容") || "";
  const formatLabel = valueByLabel.get("输出格式") || "Word（DOCX）";
  const format = documentFormatFromLabel(formatLabel);
  const style = valueByLabel.get("排版风格") || "简洁正式";
  const extra = valueByLabel.get("补充说明（选填）") || "";
  const attachments = attachmentPathList(state.selectedFiles);
  if (!content && !attachments.length) {
    showToast("请填写文档内容，或选择一个内容附件");
    els.pageContent.querySelector('[data-form-field="content"] textarea')?.focus();
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputPath = `documents/${stamp}-${safeDocumentTitle(title)}.${format}`;
  const resultText = [
    content,
    attachments.length ? `\n附件素材：${attachments.map(baseName).join("、")}` : "",
    `\n排版风格：${style}`,
    extra ? `补充说明：${extra}` : ""
  ].filter(Boolean).join("\n").trim();
  const result = {
    id: createId("task"),
    skillId: skill.id,
    prompt: `在技能页面生成 ${formatLabel} 文档。`,
    userMsg: `生成：${title}`,
    historyTitle: `${title}生成`,
    statusText: "正在准备文档…",
    steps: ["正在整理文档内容…", `正在生成 ${formatLabel} 文件…`],
    doneSteps: [],
    resultTitle: `${title}.${format}`,
    documentTitle: title,
    resultBody: `已在技能页面生成 ${formatLabel} 文件，文件保存在当前用户结果目录。`,
    resultText,
    resultType: "document",
    outputFormat: format,
    useModel: true,
    contentGenerated: false,
    contentPrompt: [
      "你是企业文档整理助手。请只根据用户提供的真实素材生成最终文档正文，不要编造事实，不要输出解释、前言或代码围栏。",
      `文档标题：${title}`,
      `输出格式：${formatLabel}`,
      `排版风格：${style}`,
      content ? `用户正文：\n${content}` : "用户未填写正文，请读取附件内容。",
      attachments.length ? `附件路径：\n${attachments.join("\n")}` : "",
      extra ? `补充要求：\n${extra}` : ""
    ].filter(Boolean).join("\n\n"),
    downloadLabel: `下载 ${format.toUpperCase()}`,
    selectedFiles: attachments,
    finished: false
  };
  state.activeView = "task-result";
  state.taskResult = result;
  state.selectedFiles = [];
  saveState();
  render();
  window.setTimeout(() => startTaskFlow(), 0);
}

function submitMeetingSkill(skill, values) {
  const valueByLabel = new Map(values.map((item) => [item.label, item.value]));
  const content = valueByLabel.get("输入内容") || "";
  const focus = valueByLabel.get("输出重点") || "执行摘要、一句话判断、任务安排";
  const format = documentFormatFromLabel(valueByLabel.get("输出格式") || "Word（DOCX）");
  const extra = valueByLabel.get("补充说明") || "";
  const attachments = attachmentPathList(state.selectedFiles);
  const needsFileAgent = attachments.some((filePath) => !/\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|mpeg|mpg)$/i.test(String(filePath || "")));
  if (!content && !attachments.length) {
    showToast("请填写会议记录，或选择一个转写/记录文件");
    els.pageContent.querySelector('[data-form-field="content"] textarea')?.focus();
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const title = `会议蒸馏-${stamp}`;
  startLocalSkillResult({
    skill,
    format,
    title,
    userMsg: `使用东哥会议模型：${title}`,
    historyTitle: `${title}生成`,
    resultBody: `已在技能页面生成 ${format.toUpperCase()} 会议蒸馏文档，重点包含：${focus}；不明确的信息已标记为待确认。`,
    resultText: [
      "东哥会议模型",
      `整理重点：${focus}`,
      content,
      attachments.length ? `附件素材：${attachments.map(baseName).join("、")}` : "",
      extra ? `补充说明：${extra}` : ""
    ].filter(Boolean).join("\n\n"),
    contentPrompt: [
      meetingMinutesSkillPrompt,
      "请严格执行客户端注入的完整会议蒸馏规范，默认按 B 级会议处理；符合升级条件时自动提升为 A 级。",
      `用户选择的输出重点：${focus}`,
      `用户选择的输出格式：${valueByLabel.get("输出格式") || "Word（DOCX）"}`,
      extra ? `用户补充说明：\n${extra}` : "",
      content ? `会议原始文字：\n${content}` : "会议文字已通过附件提供，请先读取附件。",
      attachments.length ? `会议材料附件路径：\n${attachments.join("\n")}` : ""
    ].filter(Boolean).join("\n\n"),
    selectedFiles: attachments,
    useFullAgent: needsFileAgent,
    preferGateway: needsFileAgent,
    relativePath: `meeting/${stamp}-${title}.${format}`,
    steps: ["正在识别会议材料与信息质量…", "正在提炼核心矛盾、决策与任务…", `正在生成 ${format.toUpperCase()} 会议蒸馏文档…`]
  });
}

function safeDocumentTitle(value) {
  return String(value || "未命名文档").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "未命名文档";
}

function submitWeeklySkill(skill, values) {
  const valueByLabel = new Map(values.map((item) => [item.label, item.value]));
  const range = valueByLabel.get("时间范围") || "本周";
  const format = valueByLabel.get("输出格式") || "Word";
  const tone = valueByLabel.get("语气风格") || "简洁";
  const material = valueByLabel.get("附加说明") || "";
  const attachments = attachmentPathList(state.selectedFiles);
  if (!material && !attachments.length) {
    showToast("请在附加说明中填写工作内容，或选择一个内容附件");
    els.pageContent.querySelector('[data-form-field="extra"] textarea')?.focus();
    return;
  }

  const reportName = range === "今日" ? "工作日报" : "工作周报";
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const extension = format === "Word" ? "docx" : "txt";
  const outputPath = `reports/${stamp}-${reportName}.${extension}`;
  const reportTitle = `${range === "今日" ? "工作日报" : "工作周报"}-${stamp}`;
  startLocalSkillResult({
    skill,
    format: extension,
    title: reportTitle,
    userMsg: `生成：${reportTitle}`,
    historyTitle: `${reportTitle}生成`,
    resultBody: `已在技能页面生成 ${format === "Word" ? "Word" : "纯文本"} 文件，内容只来自你填写的素材和附件。`,
    resultText: [
      `${range === "今日" ? "工作日报" : "工作周报"}`,
      `时间范围：${range}`,
      `语气风格：${tone}`,
      material ? `\n${material}` : "",
      attachments.length ? `\n内容附件：${attachments.map(baseName).join("、")}` : ""
    ].filter(Boolean).join("\n").trim(),
    selectedFiles: attachments,
    relativePath: outputPath,
    needsConfirm: false,
    steps: ["正在整理技能页输入内容…", `正在生成 ${format === "Word" ? "Word" : "纯文本"} 文件…`]
  });
}

function startLocalSkillResult({ skill, format, title, userMsg, historyTitle, resultBody, resultText, contentPrompt = "", selectedFiles = [], relativePath = "", needsConfirm = false, useFullAgent = false, steps = [], resultType = "document", persistArtifacts = true, downloadLabel = "", preferGateway = true }) {
  const taskId = createId("task");
  const executionId = createId("execution");
  const firstExecutedAt = new Date().toISOString();
  state.activeView = "task-result";
  state.taskResult = {
    id: taskId,
    v11TaskId: taskId,
    v11ExecutionId: executionId,
    v11FirstExecutedAt: firstExecutedAt,
    skillId: skill.id,
    companySkillId: skill.companySkillId || "",
    companyVersion: skill.companyVersion || "",
    companyUsageRecorded: false,
    prompt: format ? `技能页面本地生成 ${format.toUpperCase()} 文件` : `技能页面执行「${skill.name}」`,
    userMsg,
    historyTitle,
    statusText: steps[0] || "正在生成文件…",
    steps,
    doneSteps: [],
    resultTitle: format ? `${title}.${format}` : title,
    documentTitle: title,
    resultBody,
    resultText,
    resultType,
    outputFormat: format,
    relativePath,
    useModel: true,
    contentGenerated: false,
    useFullAgent,
    preferGateway,
    contentPrompt: [
      "你正在执行一个由用户主动提交的技能任务。必须直接处理本次用户任务，禁止输出初始化问候、自我介绍、询问用户姓名或询问应该如何称呼。",
      "你是企业内容整理助手。请根据用户提供的真实素材生成最终内容，不得编造事项或数据，只输出与本次任务直接相关的结果。",
      skill?.systemPrompt || "",
      `文档标题：${title}`,
      `输出格式：${format.toUpperCase()}`,
      contentPrompt || "",
      resultText ? `本次用户任务与素材（必须优先处理）：\n${resultText}` : "请读取附件素材并直接完成任务。"
    ].filter(Boolean).join("\n\n"),
    selectedFiles: [...selectedFiles],
    downloadLabel: downloadLabel || (format ? `下载 ${format.toUpperCase()}` : ""),
    persistArtifacts,
    needsConfirm,
    finished: false
  };
  state.selectedFiles = [];
  saveState();
  render();
  reportCompanySkillOutcome(skill, "invoked", taskId, executionId);
  reportV11Task(taskId, "skill", "RUNNING", firstExecutedAt, null, { executionId, startedAt: firstExecutedAt });
  reportV11Module("SKILL_LIBRARY", "execute_skill", true);
  window.setTimeout(() => startTaskFlow(), 0);
}

function collectSkillFormValues() {
  return [...els.pageContent.querySelectorAll("[data-form-field]")].map((field) => {
    const type = field.dataset.fieldType;
    const label = field.dataset.fieldLabel || "";
    let value = "";
    if (type === "textarea") {
      value = field.querySelector("textarea")?.value.trim() || "";
    } else if (type === "file") {
      value = state.selectedFiles.length ? state.selectedFiles.map(baseName).join("、") : "";
    } else {
      value = [...field.querySelectorAll(".option-pill.selected")]
        .map((pill) => pill.textContent.trim())
        .join("、");
    }
    return { label, value, type };
  }).filter((item) => item.value);
}

function buildSkillPrompt(skill, values) {
  const lines = values.map((item) => `- ${item.label}：${item.value}`);
  return [
    `请使用「${skill.name}」技能处理以下任务。`,
    lines.length ? "参数如下：" : "",
    ...lines,
    "",
    "请先基于这些参数生成可直接使用的结果；如果缺少关键信息，请明确列出需要我补充的内容。"
  ].filter(Boolean).join("\n");
}

function startTaskFlow() {
  const result = state.taskResult;
  if (!result) return;
  result.steps = Array.isArray(result.steps) ? result.steps : [];
  result.doneSteps = Array.isArray(result.doneSteps) ? result.doneSteps : [];

  // Model-backed skills already show their live status; skip artificial step
  // transitions so the provider request starts in the same event turn.
  if (result.useModel && !result.needsConfirm) {
    finalizeTaskResult();
    return;
  }

  const runSteps = (steps, onFinish) => {
    if (!state.taskResult || state.activeView !== "task-result") return;
    const live = state.taskResult;
    if (!live.steps.length) {
      onFinish();
      return;
    }
    const nextIndex = live.doneSteps.length;
    if (nextIndex >= steps.length) {
      onFinish();
      return;
    }
    live.statusText = steps[nextIndex];
    saveState();
    render();
    const stepDelay = live.useModel ? 0 : 850;
    window.setTimeout(() => {
      if (!state.taskResult || state.activeView !== "task-result") return;
      const item = steps[nextIndex];
      state.taskResult.doneSteps = [...new Set([...(state.taskResult.doneSteps || []), item.replace(/[…\.]+$/, "")])];
      state.taskResult.statusText = steps[nextIndex + 1] || "已完成";
      saveState();
      render();
      runSteps(steps, onFinish);
    }, stepDelay);
  };

  runSteps(result.steps, () => {
    if (!state.taskResult) return;
    if (state.taskResult.needsConfirm && !state.taskResult.confirmed) {
      openTaskConfirmModal();
      return;
    }
    finalizeTaskResult();
  });
}

function openTaskConfirmModal() {
  if (!state.taskResult) return;
  els.taskConfirmTitle.textContent = state.taskResult.confirmTitle || "检测到同名文件，是否覆盖?";
  els.taskConfirmText.textContent = state.taskResult.confirmText || "继续执行将覆盖原文件内容，此操作无法撤销。";
  els.taskConfirmModal.classList.remove("hidden");
}

function closeTaskConfirmModal() {
  els.taskConfirmModal.classList.add("hidden");
}

function computerOperationLabel(action) {
  return ({
    computer_write: "覆盖文件确认",
    computer_write_document: "覆盖文档确认",
    computer_copy: "复制替换确认",
    computer_move: "移动替换确认",
    computer_delete: "删除确认",
    computer_run: "命令执行确认",
    computer_control_app: "应用操作确认",
    computer_send_message: "发送消息确认"
  })[String(action || "")] || "本机操作确认";
}

function renderNextComputerOperationConfirmation() {
  if (currentComputerOperationConfirmation || !pendingComputerOperationConfirmations.length) return;
  currentComputerOperationConfirmation = pendingComputerOperationConfirmations.shift();
  const operation = currentComputerOperationConfirmation;
  els.computerOperationConfirmLabel.textContent = computerOperationLabel(operation.action);
  els.computerOperationConfirmTitle.textContent = operation.title || "确认执行此操作?";
  els.computerOperationConfirmDescription.textContent = operation.description || "请核对操作内容和目标位置。";
  els.computerOperationConfirmTarget.textContent = operation.target || "当前电脑";
  els.computerOperationTargetRow.classList.toggle("hidden", !operation.target);
  els.computerOperationCommandLabel.textContent = operation.detailLabel || "命令";
  els.computerOperationConfirmCommand.textContent = operation.commandSummary || "";
  els.computerOperationCommandRow.classList.toggle("hidden", !operation.commandSummary);
  els.computerOperationConfirmModal.classList.remove("hidden");
}

function queueComputerOperationConfirmation(operation = {}) {
  const confirmationId = String(operation.confirmationId || "");
  if (!confirmationId) return;
  if (currentComputerOperationConfirmation?.confirmationId === confirmationId) return;
  if (pendingComputerOperationConfirmations.some((item) => item.confirmationId === confirmationId)) return;
  pendingComputerOperationConfirmations.push(operation);
  renderNextComputerOperationConfirmation();
}

function removeComputerOperationConfirmation(confirmationId) {
  const id = String(confirmationId || "");
  for (let index = pendingComputerOperationConfirmations.length - 1; index >= 0; index -= 1) {
    if (pendingComputerOperationConfirmations[index]?.confirmationId === id) pendingComputerOperationConfirmations.splice(index, 1);
  }
  if (currentComputerOperationConfirmation?.confirmationId !== id) return;
  currentComputerOperationConfirmation = null;
  els.computerOperationConfirmModal.classList.add("hidden");
  renderNextComputerOperationConfirmation();
}

async function resolveComputerOperationConfirmation(decision) {
  const operation = currentComputerOperationConfirmation;
  if (!operation?.confirmationId) return;
  const buttons = els.computerOperationConfirmModal.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await window.desktopBridge?.resolveComputerOperationConfirmation?.({
      confirmationId: operation.confirmationId,
      decision: decision === "allow-once" ? "allow-once" : "deny"
    });
    if (result?.resolved === false && result?.reason !== "not-found") throw new Error("操作确认未能提交");
    removeComputerOperationConfirmation(operation.confirmationId);
  } catch (error) {
    showToast(error?.message || "操作确认提交失败");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function handleComputerOperationStatus(status = {}) {
  if (status.state === "confirmation-resolved" && status.confirmationId) {
    removeComputerOperationConfirmation(status.confirmationId);
  }
  if (status.state === "denied" && status.reason === "timeout") showToast("本机操作确认已超时，未执行任何操作");
  if (status.state === "failed" && status.error) showToast(status.error);
}

async function finalizeTaskResult() {
  if (!state.taskResult) return;
  const result = state.taskResult;
  const afterConfirm = Array.isArray(result.afterConfirmSteps) ? result.afterConfirmSteps : [];
  if (afterConfirm.length && !result.afterConfirmDone) {
    result.afterConfirmDone = true;
    result.statusText = afterConfirm[0];
    saveState();
    render();
    window.setTimeout(() => {
      if (!state.taskResult || state.activeView !== "task-result") return;
      state.taskResult.doneSteps = [...new Set([...(state.taskResult.doneSteps || []), afterConfirm[0].replace(/[…\.]+$/, "")])];
      persistTaskResult();
    }, state.taskResult.useModel ? 0 : 900);
    return;
  }

  persistTaskResult();
}

async function persistTaskResult() {
  const current = state.taskResult;
  if (!current) return;
  const existing = pendingTaskPersistence.get(current.id);
  if (existing) return existing;
  const promise = persistTaskResultInternal(current.id);
  pendingTaskPersistence.set(current.id, promise);
  try {
    return await promise;
  } finally {
    if (pendingTaskPersistence.get(current.id) === promise) pendingTaskPersistence.delete(current.id);
  }
}

async function persistTaskResultInternal(resultId) {
  if (!state.taskResult) return;
  const result = state.taskResult;
  if (result.id !== resultId) return;
  if (result.cancelled) {
    result.finished = true;
    result.statusText = "已取消";
    if (!result.companyUsageRecorded && result.companySkillId) {
      reportCompanySkillOutcome({ companySkillId: result.companySkillId, companyVersion: result.companyVersion }, "cancelled", result.v11TaskId || result.id, result.v11ExecutionId);
      result.companyUsageRecorded = true;
    }
    reportV11Task(result.v11TaskId || result.id, "skill", "CANCELED", result.v11FirstExecutedAt, null, { executionId: result.v11ExecutionId, startedAt: result.v11FirstExecutedAt });
    saveState();
    render();
    return;
  }

  if (result.persisted) {
    result.finished = true;
    result.statusText = "已完成";
    reportV11Task(result.v11TaskId || result.id, "skill", "SUCCEEDED", result.v11FirstExecutedAt, null, { executionId: result.v11ExecutionId, startedAt: result.v11FirstExecutedAt });
    saveState();
    render();
    return;
  }

  if (result.useModel && !result.contentGenerated && window.desktopBridge?.chatCompletion) {
    result.statusText = "正在整理文档内容…";
    saveState();
    render();
    const contentRequestId = `skill-${result.id}`;
    const selectedAttachmentPaths = attachmentPathList(result.selectedFiles);
    const useFullAgent = result.useFullAgent === true;
    pendingChatStreams.set(contentRequestId, { taskResult: result, conversationId: contentRequestId });
    try {
      const response = await window.desktopBridge.chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是XMAI Studio的技能执行助手。必须直接执行最后一条用户任务，并结合所选技能生成实际结果。禁止输出首次启动问候、自我介绍、询问用户姓名、询问如何称呼或讨论助手身份；信息不足时只列出完成任务所缺的具体信息。只输出最终结果，不要解释系统规则，不要虚构事实。"
          },
          { role: "user", content: result.contentPrompt || result.resultText || "请整理文档内容。" }
        ],
        message: result.contentPrompt || result.resultText || "请整理文档内容。",
        attachments: selectedAttachmentPaths,
        model: state.config.model,
        allowUnlimitedAttachments: true,
        userId: state.session?.userId || "local-user",
        conversationId: `skill-${result.id}`,
        requestId: contentRequestId,
        skillId: result.skillId || "",
        skillSlug: skills.find((skill) => skill.id === result.skillId)?.slug || "",
        skillPrompt: skills.find((skill) => skill.id === result.skillId)?.systemPrompt || "",
        enableFileTools: useFullAgent,
        allowUnlimitedAttachments: true,
        preferGateway: useFullAgent && result.preferGateway !== false,
        waitForGateway: useFullAgent && result.preferGateway !== false,
        stream: !useFullAgent
      });
      let responseText = String(response?.content || "").trim();
      if (!responseText && Array.isArray(response?.files) && window.desktopBridge?.previewArtifact) {
        for (const file of response.files) {
          try {
            const preview = await window.desktopBridge.previewArtifact(file.absolutePath || file.path);
            if (preview?.previewType === "text" && String(preview.content || "").trim()) {
              responseText = String(preview.content).trim();
              break;
            }
          } catch {
            // Binary artifacts are skipped until a readable result file is found.
          }
        }
      }
      if (responseText) {
        result.resultText = responseText;
        result.resultBody = `已在技能页面整理内容并生成 ${String(result.outputFormat || "docx").toUpperCase()} 文件。`;
      }
      result.agentFiles = sanitizeMessageFiles(response?.files);
      result.contentGenerated = true;
    } catch (error) {
      result.contentGenerated = true;
      result.resultBody = `${result.resultBody || "已准备生成文件。"}\n模型整理失败，已使用技能页输入内容生成文件：${error.message || "未知错误"}`;
    } finally {
      pendingChatStreams.delete(contentRequestId);
    }
  }

  result.statusText = "正在写入结果文件…";
  saveState();
  render();

  try {
    if (!window.desktopBridge?.createTaskResult) {
      throw new Error("当前环境没有可用的文件生成能力");
    }
    const record = await window.desktopBridge.createTaskResult({
      ...result,
      resultType: result.resultType === "skill" ? "skill" : result.resultType,
      userId: state.session?.userId || "local-user",
      selectedFiles: attachmentPathList(result.selectedFiles)
    });
    const generatedArtifacts = sanitizeMessageFiles(state.taskResult?.agentFiles).map((file) => ({
      type: file.kind === "image" ? "image" : "file",
      label: file.name,
      path: file.absolutePath
    }));
    const artifacts = [...generatedArtifacts, ...(record.artifacts || [])]
      .filter((item, index, list) => item?.path && list.findIndex((candidate) => candidate?.path === item.path) === index);
    state.taskResult = {
      ...state.taskResult,
      id: record.id,
      recordId: record.id,
      artifacts,
      folderPath: record.folderPath,
      primaryPath: record.primaryPath,
      persisted: true,
      finished: true,
      statusText: "已完成"
    };
    if (!state.taskResult.companyUsageRecorded && state.taskResult.companySkillId) {
      reportCompanySkillOutcome({ companySkillId: state.taskResult.companySkillId, companyVersion: state.taskResult.companyVersion }, "succeeded", state.taskResult.v11TaskId || resultId, state.taskResult.v11ExecutionId);
      state.taskResult.companyUsageRecorded = true;
    }
    reportV11Task(state.taskResult.v11TaskId || resultId, "skill", "SUCCEEDED", state.taskResult.v11FirstExecutedAt, null, { executionId: state.taskResult.v11ExecutionId, startedAt: state.taskResult.v11FirstExecutedAt });
    await refreshWorkData({ silent: true });
  } catch (error) {
    state.taskResult = {
      ...state.taskResult,
      finished: true,
      statusText: "结果文件写入失败",
      resultBody: `${state.taskResult.resultBody || "任务已完成。"}\n\n文件写入失败：${error.message || "未知错误"}`
    };
    if (!state.taskResult.companyUsageRecorded && state.taskResult.companySkillId) {
      reportCompanySkillOutcome({ companySkillId: state.taskResult.companySkillId, companyVersion: state.taskResult.companyVersion }, "failed", state.taskResult.v11TaskId || resultId, state.taskResult.v11ExecutionId);
      state.taskResult.companyUsageRecorded = true;
    }
    reportV11Task(state.taskResult.v11TaskId || resultId, "skill", "FAILED", state.taskResult.v11FirstExecutedAt, httpStatusFromError(error), { executionId: state.taskResult.v11ExecutionId, startedAt: state.taskResult.v11FirstExecutedAt });
  }
  saveState();
  render();
}

async function copyTaskResultText() {
  const text = state.taskResult?.resultText || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制到剪贴板");
  } catch {
    showToast("复制失败");
  }
}

function downloadTaskResult() {
  runDownloadTaskResult();
}

function openTaskResultFolder() {
  runOpenTaskResultFolder();
}

async function ensureTaskResultPersisted() {
  if (state.taskResult?.persisted && state.taskResult?.primaryPath) {
    return state.taskResult;
  }
  await persistTaskResult();
  return state.taskResult;
}

async function runDownloadTaskResult() {
  const result = await ensureTaskResultPersisted();
  const target = result?.recordId || result?.id;
  if (!target || !window.desktopBridge?.downloadTaskResult) {
    showToast("当前没有可下载的结果文件");
    return;
  }
  try {
    const downloaded = await window.desktopBridge.downloadTaskResult({ taskId: target, userId: state.session?.userId || "local-user" });
    showToast(downloaded?.renamedBecauseBusy
      ? `同名文件正在使用，已另存为 ${baseName(downloaded.path)}`
      : `已下载到 ${baseName(downloaded.path)}`);
  } catch (error) {
    const message = String(error?.message || "").replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
    showToast(message || "下载失败");
  }
}

async function copyMessageText(messageId) {
  const conversation = activeConversation();
  const message = conversation?.messages?.find((item) => item.id === messageId && item.role === "assistant");
  const text = String(message?.content || "").trim();
  if (!text) {
    showToast("当前回答没有可复制的内容");
    return;
  }
  try {
    if (window.desktopBridge?.copyText) {
      await window.desktopBridge.copyText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    showToast("回答已复制");
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    showToast(copied ? "回答已复制" : "复制失败");
  }
}

async function runOpenTaskResultFolder() {
  const result = await ensureTaskResultPersisted();
  const target = result?.recordId || result?.id;
  if (!target || !window.desktopBridge?.openTaskResultFolder) {
    showToast("当前没有可打开的结果目录");
    return;
  }
  try {
    await window.desktopBridge.openTaskResultFolder({ taskId: target, userId: state.session?.userId || "local-user" });
    showToast("已在文件夹中显示");
  } catch (error) {
    showToast(error.message || "打开失败");
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const text = els.promptInput.value.trim();
  if (text === "/本地文件") {
    els.promptInput.value = "";
    autoResizePrompt();
    closeComposerMenu();
    await attachFiles();
    return;
  }
  if (!text && !state.selectedFiles.length) {
    focusPrompt();
    return;
  }

  const conversation = activeConversation();
  if (pendingConversationRequests.has(conversation.id)) {
    showToast("当前对话正在处理，请切换到其他对话继续");
    return;
  }
  state.activeView = "chat";
  state.taskResult = null;
  const attachments = resolveMessageAttachments(conversation, state.selectedFiles, text);
  const now = new Date().toISOString();
  const userContent = text || "请根据我选择的文件继续处理。";
  const skill = skillForMessage(activeSkill(), { content: userContent, attachments });
  let companySkillOutcome = "";
  let taskHttpStatus = null;
  let taskTerminalState = "";

  const userMessage = {
    id: createId("msg"),
    role: "user",
    content: userContent,
    skillId: skill?.id || null,
    attachments: sanitizeAttachmentItems(attachments),
    artifactOutput: pendingArtifactOutput,
    createdAt: now
  };
  pendingArtifactOutput = null;

  const requestToken = createId("pending");
  const requestId = createId("request");
  const executionId = createId("execution");
  const browserAutomationTask = shouldUseBrowserAutomationTools(conversation, userMessage) || conversation?.skillId === "browser";
  const browserResolution = browserAutomationTask ? resolveBrowserAutomationTask(conversation, userMessage) : null;
  const browserTask = browserResolution?.task || null;
  const retryOf = browserResolution?.reused ? String(browserTask.lastExecutionId || "") : "";
  const taskId = browserTask?.taskId || requestId;
  const firstExecutedAt = browserTask?.firstExecutedAt || now;
  const taskType = browserAutomationTask ? "browser" : (skill ? "skill" : "chat");
  if (browserTask) {
    browserTask.lastExecutionId = executionId;
    browserTask.status = "RUNNING";
    browserTask.updatedAt = now;
  }

  const assistantMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "正在整理回复...",
    skillId: skill?.id || null,
    images: [],
    files: [],
    loading: true,
    ...(browserTask ? { browserTask: { ...browserTask, executionId, retryOf } } : {}),
    createdAt: now
  };

  conversation.messages.push(userMessage, assistantMessage);
  conversation.title = inferConversationTitle(conversation, userContent, skill);
  conversation.updatedAt = now;
  state.selectedFiles = [];
  els.promptInput.value = "";
  autoResizePrompt();
  const requestGeneration = sessionGeneration;
  assistantMessage.generationRequestId = requestId;
  pendingConversationRequests.set(conversation.id, {
    token: requestToken,
    requestId,
    taskId,
    executionId,
    browserAutomationTask,
    stopping: false,
    conversationId: conversation.id,
    assistantMessage
  });
  saveState();
  render();
  reportCompanySkillOutcome(skill, "invoked", taskId, executionId);
  reportV11Task(taskId, taskType, "RUNNING", firstExecutedAt, null, { executionId, retryOf, startedAt: now });
  reportV11Module(skill ? "SKILL_LIBRARY" : "AI_CHAT", skill ? "execute_skill" : "send_message", true);
  if (browserAutomationTask) {
    reportV11Module("BROWSER_TOOL", "visit", false);
    reportV11Module("BROWSER_TOOL", "execute_browser_task", true);
  }

  try {
    const reply = await getAssistantReply(conversation, userMessage, skill, assistantMessage, requestId, {
      taskId,
      executionId,
      retryOf,
      browserAutomationTask,
      browserTask
    });
    if (typeof reply === "string") {
      assistantMessage.content = reply;
    } else {
      assistantMessage.content = reply?.content || "企业模型服务已返回，但没有可展示的文本内容。";
      assistantMessage.images = Array.isArray(reply?.images) ? reply.images : [];
      assistantMessage.files = sanitizeMessageFiles(reply?.files);
      if (browserTask && reply?.browserTask) {
        assistantMessage.browserTask = { ...browserTask, ...reply.browserTask };
        conversation.browserTask = { ...browserTask, ...reply.browserTask, lastExecutionId: executionId };
      }
    }
    companySkillOutcome = "succeeded";
    taskTerminalState = String(assistantMessage.browserTask?.status || "SUCCEEDED").toUpperCase();
  } catch (error) {
    const pending = pendingConversationRequests.get(conversation.id);
    let browserSnapshot = null;
    if (browserTask && window.desktopBridge?.getBrowserTask) {
      browserSnapshot = await window.desktopBridge.getBrowserTask({
        userId: state.session?.userId || "local-user",
        conversationId: conversation.id,
        taskId
      }).catch(() => null);
      if (browserSnapshot) {
        assistantMessage.browserTask = { ...browserTask, ...browserSnapshot };
        conversation.browserTask = { ...browserTask, ...browserSnapshot, lastExecutionId: executionId };
      }
    }
    const browserStatus = String(browserSnapshot?.status || error?.message?.match(/\[BROWSER_TASK_STATUS:([^\]]+)\]/)?.[1] || "").toUpperCase();
    if (browserStatus === "PAUSED") {
      const partial = assistantMessage.content === "正在整理回复..." ? "" : String(assistantMessage.content || "").trim();
      assistantMessage.content = partial ? `${partial}\n\n浏览器任务已暂停，可从任务卡继续。` : "浏览器任务已暂停，可从任务卡继续。";
      taskTerminalState = "CANCELED";
    } else if (browserStatus === "PARTIAL_SUCCESS") {
      assistantMessage.content = "任务已停止，但已有部分网页操作完成。请先查看页面，确认后再决定是否继续。";
      assistantMessage.stopped = true;
      companySkillOutcome = "cancelled";
      taskTerminalState = "PARTIAL_SUCCESS";
    } else if (browserStatus === "RESULT_UNCERTAIN") {
      assistantMessage.content = "网页操作已发出，但结果暂时无法确认。请通过“查看页面”核对，避免重复提交。";
      companySkillOutcome = "failed";
      taskTerminalState = "RESULT_UNCERTAIN";
      taskHttpStatus = httpStatusFromError(error);
    } else if (pending?.stopping || isGenerationStoppedError(error)) {
      const partial = assistantMessage.content === "正在整理回复..." ? "" : String(assistantMessage.content || "").trim();
      assistantMessage.content = partial
        ? `${partial}\n\n已停止生成。`
        : "已停止生成。";
      assistantMessage.stopped = true;
      companySkillOutcome = "cancelled";
      taskTerminalState = "CANCELED";
    } else {
      assistantMessage.content = buildErrorReply(error);
      companySkillOutcome = "failed";
      taskTerminalState = "FAILED";
      taskHttpStatus = httpStatusFromError(error);
    }
  } finally {
    if (companySkillOutcome) reportCompanySkillOutcome(skill, companySkillOutcome, taskId, executionId);
    if (taskTerminalState) {
      reportV11Task(taskId, taskType, taskTerminalState, firstExecutedAt, taskHttpStatus, { executionId, retryOf, startedAt: now });
    }
    const pending = pendingConversationRequests.get(conversation.id);
    if (pending?.token !== requestToken) return;
    pendingConversationRequests.delete(conversation.id);
    if (requestGeneration !== sessionGeneration || !state.conversations.includes(conversation)) return;
    assistantMessage.loading = false;
    conversation.updatedAt = new Date().toISOString();
    saveState();
    render();
    if (state.activeConversationId === conversation.id) {
      focusPrompt();
    } else {
      window.desktopBridge?.notify?.("XMAI Studio", `“${conversation.title}”已完成`).catch(() => {});
    }
  }
}

function inferConversationTitle(conversation, text, skill) {
  if (conversation.customTitle || (conversation.messages.length > 2 && conversation.title !== "新的对话")) {
    return conversation.title;
  }
  const prefix = skill ? `${skill.shortName}: ` : "";
  const compact = text.replace(/\s+/g, " ").trim();
  return `${prefix}${compact.slice(0, 18) || "新的对话"}`;
}

function shouldUseFileCapabilities(conversation, userMessage) {
  const attachmentPaths = attachmentPathList(userMessage?.attachments);
  if (attachmentPaths.some((filePath) => !/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(filePath || "")))) return true;
  const text = String(userMessage?.content || "").trim();
  if (!text) return false;
  const explanatoryQuestion = /(是什么|什么意思|为什么|原理|怎么理解|如何理解|介绍一下|解释一下)/.test(text);
  const actionVerb = /(创建|新建|生成|制作|做一个|做个|写入|保存|导出|修改|编辑|替换|删除|重命名|移动|复制|运行|执行|启动|调试|测试|预览|打开)/i;
  const fileObject = /(文件|文件夹|目录|绝对路径|网页|网站|页面|HTML|游戏|代码|脚本|程序|项目|Word|Excel|表格|PPT|演示文稿|PDF|文档|压缩包)/i;
  const directRequest = /(?:^|[，,。.!！?？\s])(?:请|麻烦|帮我|给我|替我|现在)?\s*(?:直接|实际)?\s*(创建|新建|生成|制作|做一个|做个|写入|保存|导出|修改|编辑|替换|删除|重命名|移动|复制|运行|执行|启动|调试|测试|预览|打开)/i.test(text);
  const explicitPath = /(?:[a-z]:\\|\/[\w.-]+\/|\.(?:html?|js|ts|py|md|txt|json|docx?|xlsx?|pptx?|pdf)\b)/i.test(text);
  const recentMessages = conversation.messages;
  const recentFiles = recentMessages.some((message) => Array.isArray(message.files) && message.files.length);
  const recentFileRequest = recentMessages.some((message) => (
    message.role === "user" && fileObject.test(String(message.content || "")) && actionVerb.test(String(message.content || ""))
  ));
  const hasFileContext = recentFiles || recentFileRequest;
  const followUpFileAction = hasFileContext && (
    /(继续|接着|再|把它|这个|该文件|刚才|上一个).*(修改|编辑|运行|打开|预览|保存|导出|删除|复制|完善|调整|读取|查看|分析)/i.test(text)
    || /(?:修改|编辑|运行|打开|预览|保存|导出|删除|复制|完善|调整|读取|查看|分析).*(它|这个|该文件|刚才|上一个)/i.test(text)
    || /^(继续|接着|再来|按这个|就这样)(?:处理|完成|执行|修改|完善)?[。.!！?？]*$/i.test(text)
  );
  if (followUpFileAction) return true;
  const explicitOutput = /(保存到|写入到|导出为|输出为|生成到|放到).*(文件|文件夹|目录|桌面|工作区|[a-z]:\\)|(?:文件|文档|网页|代码|脚本).*(保存|导出|写入)/i.test(text);
  if (explicitOutput) return true;
  if (explanatoryQuestion && !/帮我|请直接|实际创建|直接生成/i.test(text)) return false;
  const bareArtifactRequest = text.length <= 48
    && !/[?？]/.test(text)
    && !/(怎么|如何|为什么|原理|教程|介绍|解释)/.test(text)
    && /(俄罗斯方块|贪吃蛇|小游戏|网页游戏|网页|网站|HTML|程序|脚本|代码文件|Word文档|Excel表格|PPT|演示文稿)/i.test(text);
  return bareArtifactRequest || (directRequest && fileObject.test(text)) || (explicitPath && actionVerb.test(text));
}

function shouldUseFullAgentCapabilities(conversation, userMessage) {
  const text = String(userMessage?.content || "").trim();
  const attachments = sanitizeAttachmentItems(userMessage?.attachments);
  const conversationSkill = skills.find((skill) => skill.id === conversation?.skillId) || null;
  const mediaAttachment = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|mpeg|mpg)$/i;
  if (attachments.some((file) => file.kind !== "image" && !mediaAttachment.test(String(file.absolutePath || file.path || "")))) return true;
  // Installed skills may contain scripts, network access or external tools.
  // A skill selected in this conversation is an explicit request to execute it.
  if (conversationSkill?.installed) return true;
  if (!text) return false;
  if (shouldUseDesktopApplicationTools(conversation, userMessage)) return false;

  // Creating a local web app can be handled by the fast file tool chain and preview window.
  if (/(生成|创建|制作|写).*(网页|网站|HTML|小游戏|俄罗斯方块|贪吃蛇)/i.test(text)) {
    return false;
  }

  return [
    /(操作|控制|接管).*(浏览器|网页|软件|应用|电脑|系统)/i,
    /(在|用).*(浏览器|网页).*(点击|填写|登录|提交|上传|下载|抓取|搜索)/i,
    /(安装|卸载|升级).*(软件|程序|应用|插件|驱动)/i,
    /(跨应用|多应用|自动化流程|批量操作窗口|模拟点击|键盘操作)/i
  ].some((pattern) => pattern.test(text));
}

function shouldUseBrowserAutomationTools(conversation, userMessage) {
  const text = String(userMessage?.content || "").trim();
  if (!text) return false;
  const browserObject = /(?:浏览器|网页|网站|网址|链接|页面|https?:\/\/|www\.)/i;
  const browserAction = /(?:打开|访问|进入|操作|控制|点击|填写|输入|选择|滚动|登录|提交|上传|下载|搜索|抓取|读取|查看|等待)/i;
  if (browserObject.test(text) && browserAction.test(text)) return true;
  const priorBrowserContext = (conversation?.messages || [])
    .filter((message) => message.role === "user")
    .slice(-8)
    .some((message) => browserObject.test(String(message.content || "")) && browserAction.test(String(message.content || "")));
  return priorBrowserContext && (
    isTaskContinuationInstruction(text)
    || /继续当前浏览器任务/i.test(text)
    || /^(点它|点击|填写|输入|选择|滚动|往下|往上|提交|上传|下载|查看页面|等一下)[。.!！?？]*$/i.test(text)
    || /(?:点击|点开|选择|输入|填写|滚动|打开第|进入|搜索|查看|切换|勾选)/i.test(text)
  );
}

function browserTaskSiteKey(value) {
  const text = String(value || "");
  const urlMatch = text.match(/https?:\/\/[^\s，。；;）)\]}>]+/i);
  if (urlMatch) {
    try { return new URL(urlMatch[0]).hostname.toLocaleLowerCase(); } catch { /* fall through */ }
  }
  const domainMatch = text.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?/i);
  return domainMatch ? domainMatch[0].toLocaleLowerCase() : "";
}

function browserTaskCoreGoal(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s，。；;）)\]}>]+/gi, " ")
    .replace(/(?:microsoft\s*edge|micsoft|微软浏览器|谷歌浏览器|google\s*chrome|chrome|浏览器)/gi, " ")
    .replace(/(?:请|帮我|一下|现在|然后|接着|继续|重新|打开|进入|访问|点击|点开|选择|输入|填写|滚动|查看|页面|网站|网址|链接|完成|操作|执行)/g, " ")
    .replace(/[\s，。；;、：:！？!?（）()【】\[\]"'“”‘’]+/g, "")
    .slice(0, 120);
}

function browserGoalSimilarity(left, right) {
  const pairs = (value) => {
    const text = String(value || "");
    if (text.length < 2) return new Set(text ? [text] : []);
    return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  };
  const a = pairs(left);
  const b = pairs(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return overlap / Math.max(a.size, b.size);
}

function resolveBrowserAutomationTask(conversation, message) {
  const text = String(message?.content || "").trim();
  const previous = conversation?.browserTask && typeof conversation.browserTask === "object" ? conversation.browserTask : null;
  const detectedSiteKey = browserTaskSiteKey(text);
  const nextCoreGoal = browserTaskCoreGoal(text);
  const continuation = isTaskContinuationInstruction(text)
    || /继续当前浏览器任务/i.test(text)
    || /^(?:点它|点击|填写|输入|选择|滚动|往下|往上|提交|上传|下载|查看页面|等一下|确认|继续)[。.!！?？]*$/i.test(text);
  const explicitNewGoal = /(?:新任务|另一个任务|另外一个|换个网站|换一个网站|重新开始一个|开始新的)/i.test(text);
  const sameSite = previous && (!detectedSiteKey || !previous.siteKey || detectedSiteKey === previous.siteKey);
  const goalSimilarity = previous ? browserGoalSimilarity(previous.coreGoal, nextCoreGoal) : 0;
  const activePrevious = previous && !["SUCCEEDED", "FAILED", "CANCELED", "PARTIAL_SUCCESS", "RESULT_UNCERTAIN"].includes(String(previous.status || "").toUpperCase());
  const reuse = Boolean(previous && sameSite && !explicitNewGoal && (
    continuation
    || (activePrevious && (!nextCoreGoal || goalSimilarity >= 0.18))
    || (detectedSiteKey && detectedSiteKey === previous.siteKey && goalSimilarity >= 0.35)
  ));
  const now = new Date().toISOString();
  const task = reuse ? {
    ...previous,
    siteKey: detectedSiteKey || previous.siteKey || "",
    coreGoal: previous.coreGoal || nextCoreGoal,
    status: "RUNNING",
    updatedAt: now
  } : {
    taskId: createId("browser-task"),
    siteKey: detectedSiteKey,
    coreGoal: nextCoreGoal || text.slice(0, 120),
    status: "RUNNING",
    firstExecutedAt: now,
    startedAt: now,
    updatedAt: now,
    lastExecutionId: "",
    executionDetails: []
  };
  conversation.browserTask = task;
  return { task, reused: reuse };
}

function isTaskContinuationInstruction(value) {
  const text = String(value || "").trim();
  return /^(?:那你|你|请)?(?:继续|接着|再试|重试|继续操作|继续执行|继续完成|把它完成|把它做完|完成它|做完它)(?:吧|一下|操作|执行|完成|做完)?[。.!！?？]*$/i.test(text);
}

function shouldUseDesktopApplicationTools(conversation, userMessage) {
  const text = String(userMessage?.content || "").trim();
  if (!text) return false;
  if (conversation?.skillId === "browser") return true;
  const appObject = /(飞书|微信|钉钉|QQ|企业微信|Teams|Outlook|Word|Excel|PowerPoint|WPS|记事本|计算器|画图|资源管理器|Microsoft\s*Edge|msedge|Edge|微软.*浏览器|micsoft.*浏览器|Google\s*Chrome|Chrome|谷歌.*浏览器|浏览器|browser|软件|应用|程序|客户端|窗口|\.exe)/i;
  const appAction = /(打开|启动|切换|聚焦|操作|控制|点击|输入|填写|读取|查看|查找|搜索|关闭|最小化|最大化|发送|发消息|回复|提交|保存)/i;
  if (appObject.test(text) && appAction.test(text)) return true;
  if (/(给|向).{1,40}(发送|发|回复).{0,12}(消息|文字|文件)/i.test(text)) return true;
  if (/在.{1,50}(中|里|上).*(点击|输入|填写|读取|查看|选择|切换|提交|保存|发送|回复|关闭)/i.test(text)) return true;
  if (/(打开|启动|运行|切换到|进入)\s*[A-Za-z0-9\u4e00-\u9fff·._+-]{2,50}(?:软件|应用|程序|客户端)?[。.!！]*$/i.test(text)
    && !/(网页|网站|链接|网址|文件|文件夹|目录|路径|浏览器|http|www\.)/i.test(text)) return true;

  const priorDesktopContext = (conversation?.messages || [])
    .filter((message) => message.role === "user")
    .slice(-6)
    .some((message) => shouldUseDesktopApplicationTools({ messages: [] }, { content: String(message.content || "") }));
  return priorDesktopContext && (isTaskContinuationInstruction(text) || /^(发送|确认发送|点发送|打开它|切过去|输入|回复|再发一次)[。.!！?？]*$/i.test(text));
}

function isGeneralKnowledgeQuestion(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const asksForAnswer = /(?:是什么|什么是|怎么回事|为什么|多少|几号|哪天|哪里|在哪|谁是|何时|什么时候|怎么样|如何|吗[？?]?$)/.test(value);
  const factualTopic = /(?:天气|气温|温度|空气质量|首都|时间|日期|星期|汇率|路况|位置|定义|含义|信息)/.test(value);
  const explicitWork = /(?:生成|创建|制作|整理|改写|润色|处理|提取|总结|翻译|根据附件|调用|使用.*技能|按.*技能)/.test(value);
  return factualTopic && (asksForAnswer || value.length < 40) && !explicitWork;
}

function skillForMessage(skill, userMessage) {
  return skill || null;
}

function inferFastArtifactOutput(userMessage) {
  const text = String(userMessage?.content || "").trim();
  if (!text || !/(创建|新建|生成|制作|做一个|做个|写一个|输出|导出)/i.test(text)) return null;
  if (/(修改|编辑|替换|删除|重命名|移动|读取|打开已有|继续修改|运行命令|执行命令)/i.test(text)) return null;

  let format = "";
  let title = "生成文件";
  if (/(网页|网站|页面|HTML|网页游戏|小游戏|俄罗斯方块|贪吃蛇)/i.test(text)) {
    format = "html";
    title = /(俄罗斯方块)/.test(text) ? "俄罗斯方块" : (/(贪吃蛇)/.test(text) ? "贪吃蛇" : "网页应用");
  } else if (/(Word|docx|文档)/i.test(text)) {
    format = "docx";
    title = "生成文档";
  } else if (/(Python|\.py\b)/i.test(text)) {
    format = "py";
    title = "Python程序";
  } else if (/(JavaScript|JS代码|\.js\b)/i.test(text)) {
    format = "js";
    title = "JavaScript程序";
  } else if (/(JSON|\.json\b)/i.test(text)) {
    format = "json";
    title = "数据文件";
  } else if (/(Markdown|\.md\b)/i.test(text)) {
    format = "md";
    title = "Markdown文档";
  } else if (/(文本文件|TXT|\.txt\b|生成一个文件)/i.test(text)) {
    format = "txt";
  }
  if (!format) return null;

  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return {
    relativePath: `generated/${stamp}-${title}.${format}`,
    format,
    title
  };
}

function renderComposerState() {
  if (!els.chatForm || !els.sendButton) return;
  const pending = pendingConversationRequests.get(activeConversation().id);
  const busy = Boolean(pending);
  els.chatForm.classList.toggle("conversation-busy", busy);
  els.chatForm.setAttribute("aria-busy", String(busy));
  els.sendButton.classList.toggle("stop-button", busy);
  els.sendButton.type = busy ? "button" : "submit";
  els.sendButton.disabled = Boolean(pending?.stopping);
  els.sendButton.title = pending?.stopping ? "正在停止" : (busy ? "停止生成" : "发送");
  els.sendButton.setAttribute("aria-label", pending?.stopping ? "正在停止" : (busy ? "停止生成" : "发送"));
  if (busy) {
    els.sendButton.dataset.action = "stop-generation";
    els.sendButton.innerHTML = iconSvg("square");
  } else {
    delete els.sendButton.dataset.action;
    els.sendButton.innerHTML = iconSvg("arrow-up");
  }
}

function applyBrowserTaskSnapshot(conversation, taskId, snapshot = {}) {
  if (!conversation || !taskId) return;
  const current = conversation.browserTask?.taskId === taskId ? conversation.browserTask : {};
  conversation.browserTask = { ...current, ...snapshot, taskId, lastExecutionId: current.lastExecutionId || snapshot.executionId || "" };
  for (const message of conversation.messages || []) {
    if (message?.browserTask?.taskId === taskId) message.browserTask = { ...message.browserTask, ...snapshot, taskId };
  }
  conversation.updatedAt = new Date().toISOString();
}

function browserTaskBridgePayload(taskId) {
  return {
    userId: state.session?.userId || "local-user",
    conversationId: activeConversation().id,
    taskId
  };
}

async function viewBrowserTask(taskId) {
  try {
    const snapshot = await window.desktopBridge?.openBrowserTask?.(browserTaskBridgePayload(taskId));
    if (snapshot) applyBrowserTaskSnapshot(activeConversation(), taskId, snapshot);
    saveState();
    renderMessages();
  } catch (error) {
    showToast(error.message || "浏览器页面暂时无法打开");
  }
}

async function pauseBrowserTask(taskId) {
  const conversation = activeConversation();
  applyBrowserTaskSnapshot(conversation, taskId, { status: "PAUSING", updatedAt: new Date().toISOString() });
  saveState();
  renderMessages();
  try {
    const snapshot = await window.desktopBridge?.pauseBrowserTask?.(browserTaskBridgePayload(taskId));
    applyBrowserTaskSnapshot(conversation, taskId, snapshot || { status: "PAUSED" });
    saveState();
    render();
  } catch (error) {
    applyBrowserTaskSnapshot(conversation, taskId, { status: "RUNNING" });
    saveState();
    renderMessages();
    showToast(error.message || "暂停浏览器任务失败");
  }
}

async function resumeBrowserTask(taskId) {
  const conversation = activeConversation();
  try {
    const snapshot = await window.desktopBridge?.resumeBrowserTask?.(browserTaskBridgePayload(taskId));
    applyBrowserTaskSnapshot(conversation, taskId, snapshot || { status: "READY" });
    saveState();
    renderMessages();
    for (let attempt = 0; attempt < 30 && pendingConversationRequests.has(conversation.id); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (pendingConversationRequests.has(conversation.id)) throw new Error("当前操作仍在暂停中，请稍后再试");
    els.promptInput.value = "继续当前浏览器任务";
    autoResizePrompt();
    els.chatForm.requestSubmit();
  } catch (error) {
    applyBrowserTaskSnapshot(conversation, taskId, { status: "PAUSED" });
    saveState();
    renderMessages();
    showToast(error.message || "继续浏览器任务失败");
  }
}

async function stopActiveGeneration() {
  const conversation = activeConversation();
  const pending = pendingConversationRequests.get(conversation.id);
  if (!pending || pending.stopping) return;
  pending.stopping = true;
  renderConversationList();
  renderComposerState();
  try {
    let result = await window.desktopBridge?.cancelChatCompletion?.(pending.requestId);
    if (!result?.cancelled) {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      result = await window.desktopBridge?.cancelChatCompletion?.(pending.requestId);
    }
    if (!result?.cancelled && pendingConversationRequests.get(conversation.id)?.token === pending.token) {
      pending.stopping = false;
      renderConversationList();
      renderComposerState();
      showToast("当前请求尚未建立，请稍后再试");
    }
  } catch (error) {
    if (pendingConversationRequests.get(conversation.id)?.token !== pending.token) return;
    pending.stopping = false;
    renderConversationList();
    renderComposerState();
    showToast(error.message || "停止生成失败");
  }
}

function cancelAllPendingGenerations() {
  for (const pending of pendingConversationRequests.values()) {
    if (!pending?.requestId) continue;
    window.desktopBridge?.cancelChatCompletion?.(pending.requestId)?.catch?.(() => {});
  }
}

function queueStreamRender() {
  if (streamRenderQueued) return;
  streamRenderQueued = true;
  requestAnimationFrame(() => {
    streamRenderQueued = false;
    renderMessages();
  });
}

function queueLiveRender() {
  if (streamRenderQueued) return;
  streamRenderQueued = true;
  requestAnimationFrame(() => {
    streamRenderQueued = false;
    if (state.activeView === "task-result") renderPageView();
    else renderMessages();
  });
}

function applyChatCompletionChunk(chunk) {
  const pending = pendingChatStreams.get(String(chunk?.requestId || ""));
  if (!pending || !chunk?.content) return;
  if (pending.taskResult) {
    pending.taskResult.resultText = scrubInternalTerms(chunk.content);
    pending.taskResult.statusText = "正在整理文档内容…";
    queueLiveRender();
    return;
  }
  pending.message.content = scrubInternalTerms(chunk.content);
  if (pending.conversationId === state.activeConversationId) queueLiveRender();
}

function applyGenerationProgress(progress) {
  const requestId = String(progress?.requestId || "");
  if (!requestId) return;
  if (progress?.type === "chat") {
    const pendingStream = pendingChatStreams.get(requestId);
    if (!pendingStream) return;
    if (progress.modelMode === "auto" && state.config.model !== "auto") {
      state.config.model = "auto";
      state.config.modelSelectionExplicit = true;
      saveState();
      renderModelPicker();
    }
    if (pendingStream.taskResult) {
      pendingStream.taskResult.statusText = String(progress.message || "正在处理…");
    } else if (pendingStream.message?.loading) {
      const nextMessage = String(progress.message || "正在处理…");
      const currentMessage = String(pendingStream.message.content || "");
      if (!currentMessage || currentMessage === "正在整理回复..." || currentMessage === pendingStream.progressMessage) {
        pendingStream.message.content = nextMessage;
        pendingStream.progressMessage = nextMessage;
      }
    }
    queueLiveRender();
    return;
  }
  if (progress?.type !== "image") return;
  for (const pending of pendingConversationRequests.values()) {
    if (String(pending?.requestId || "") !== requestId || !pending.assistantMessage) continue;
    const assistantMessage = pending.assistantMessage;
    if (Array.isArray(progress.images) && progress.images.length) {
      assistantMessage.images = progress.images;
      assistantMessage.content = progress.message || "图片已返回，正在保存本地文件…";
      saveState();
      if (state.activeConversationId === pending.conversationId) renderMessages();
    }
    break;
  }
  const savedMessage = state.conversations
    .flatMap((conversation) => conversation.messages)
    .find((message) => message?.generationRequestId === requestId);
  if (savedMessage && Array.isArray(progress.images) && progress.images.length) {
    savedMessage.images = progress.images;
    savedMessage.content = progress.message || "图片已保存到本地";
    saveState();
    if (state.activeConversationId && state.conversations.find((conversation) => conversation.id === state.activeConversationId)?.messages.includes(savedMessage)) {
      renderMessages();
    }
  }
}

function reportCompanySkillOutcome(skill, outcome, taskId = "", executionId = "") {
  if (!skill?.companySkillId || !skill?.companyVersion || !window.desktopBridge?.reportCompanySkillUsage) return;
  const enterpriseSkillId = String(skill.companySkillId || "").trim();
  const normalizedTaskId = String(taskId || "").trim();
  window.desktopBridge.reportCompanySkillUsage({
    taskId: normalizedTaskId,
    executionId: String(executionId || "").trim(),
    enterpriseSkillId,
    skillId: enterpriseSkillId,
    version: skill.companyVersion,
    outcome,
    idempotencyKey: normalizedTaskId ? `company-skill:${normalizedTaskId}:${enterpriseSkillId}:${outcome}` : ""
  }).catch(() => {});
}

function reportV11Facts(facts) {
  if (!window.desktopBridge?.reportV11Facts || !state.session?.userId || !Array.isArray(facts) || !facts.length) return;
  window.desktopBridge.reportV11Facts({ facts }).catch(() => {});
}

function httpStatusFromError(error) {
  for (const value of [error?.status, error?.statusCode, error?.code]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  const match = String(error?.message || error || "").match(/\b([1-5]\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function reportV11Task(taskId, taskType, taskState, firstExecutedAt, httpStatus = null, execution = {}) {
  const occurredAt = new Date().toISOString();
  const normalizedState = String(taskState || "").toUpperCase();
  const terminal = normalizedState !== "RUNNING";
  const tracker = reportV11Task.executionState || (reportV11Task.executionState = new Map());
  const previous = tracker.get(taskId) || {};
  const executionId = String(execution?.executionId || (normalizedState === "RUNNING" ? previous.activeExecutionId : "") || `execution-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
  const retryOf = String(execution?.retryOf || (executionId !== previous.lastTerminalExecutionId ? previous.lastTerminalExecutionId : "") || "");
  const startedAt = execution?.startedAt || previous.startedAt || firstExecutedAt || occurredAt;
  const facts = [{
    kind: "task",
    eventKey: ["desktop-task", taskId, normalizedState, executionId].join(":"),
    taskId,
    taskType,
    state: normalizedState,
    ...(Number.isInteger(Number(httpStatus)) ? { httpStatus: Number(httpStatus) } : {}),
    firstExecutedAt: firstExecutedAt || occurredAt,
    occurredAt
  }];
  if (terminal) {
    facts.push({
      kind: "execution",
      eventKey: ["desktop-execution", executionId, normalizedState].join(":"),
      executionId,
      taskId,
      retryOf,
      state: normalizedState,
      ...(Number.isInteger(Number(httpStatus)) ? { httpStatus: Number(httpStatus) } : {}),
      startedAt,
      finishedAt: occurredAt,
      occurredAt
    });
    tracker.set(taskId, { activeExecutionId: "", lastTerminalExecutionId: executionId, startedAt: "" });
  } else {
    tracker.set(taskId, { ...previous, activeExecutionId: executionId, startedAt });
  }
  reportV11Facts(facts);
  return { taskId, executionId, retryOf, state: normalizedState };
}

function reportV11Module(moduleCode, action = "visit", keyOperation = false) {
  const occurredAt = new Date().toISOString();
  reportV11Facts([{
    kind: "module",
    eventKey: ["desktop-module", moduleCode, action, Date.now(), Math.random().toString(36).slice(2, 8)].join(":"),
    moduleCode,
    action,
    keyOperation,
    occurredAt
  }]);
}

function reportV11ModuleVisit(view) {
  const moduleCode = ({
    chat: "AI_CHAT",
    search: "SEARCH",
    scheduled: "SCHEDULED",
    "task-result": "TASK_RESULT",
    skills: "SKILL_LIBRARY",
    "skill-import": "SKILL_LIBRARY",
    "company-skill-create": "SKILL_LIBRARY",
    "company-skill-submit": "SKILL_LIBRARY",
    "company-skills": "SKILL_LIBRARY",
    "company-skill-mine": "SKILL_LIBRARY"
  })[view] || (/^skill-(?:form|detail):/.test(String(view || "")) ? "SKILL_LIBRARY" : "");
  if (moduleCode) reportV11Module(moduleCode, "visit", false);
}

function githubSkillInstallReference(userMessage) {
  const text = String(userMessage?.content || "").trim();
  if (!text || !/(?:帮我|请|给我|直接|在本地|下载安装到|安装这个|安装该|成为我的技能|安装技能)/i.test(text)) return "";
  const match = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/(?:tree|blob)\/[^\s<>'"，。！？]+)?/i);
  return String(match?.[0] || "").replace(/[)\]}>.,;:]+$/g, "");
}

async function installGitHubSkillFromConversation(userMessage, assistantMessage) {
  const reference = githubSkillInstallReference(userMessage);
  if (!reference || !window.desktopBridge?.installOnlineSkill) return null;
  assistantMessage.content = "正在下载并检查 GitHub 技能…";
  assistantMessage.loading = true;
  if (activeConversation()?.id === state.activeConversationId) renderMessages();
  const result = await window.desktopBridge.installOnlineSkill({
    userId: state.session?.userId || "local-user",
    reference,
    acknowledgeRisk: true,
    replace: true,
    background: false,
    requestedFromConversation: true
  });
  if (result?.filtered) throw new Error(result.message || "该仓库没有可安装的技能入口");
  if (!result?.installed || !result?.skill) throw new Error(result?.message || "技能未完成安装");
  await refreshInstalledSkills();
  reportV11Module("SKILL_LIBRARY", "install_skill", true);
  return {
    content: [
      `已安装技能“${result.skill.name}”，并加入当前用户的本地技能库。`,
      "现在可以在对话框的技能选择中直接使用。"
    ].filter(Boolean).join("\n\n"),
    files: []
  };
}

async function getAssistantReply(conversation, userMessage, skill, assistantMessage, requestId, taskContext = {}) {
  const requestSkill = skillForMessage(skill, userMessage);
  const githubInstallResult = await installGitHubSkillFromConversation(userMessage, assistantMessage);
  if (githubInstallResult) return githubInstallResult;
  if (isImageGenerationRequest(userMessage, requestSkill, conversation) && window.desktopBridge?.generateImage) {
    try {
      assistantMessage.content = "正在生成图片…";
      assistantMessage.loading = true;
      if (conversation.id === state.activeConversationId) renderMessages();
      const sourceImagePaths = resolveConversationImagePaths(conversation, userMessage);
      const result = await window.desktopBridge.generateImage({
        prompt: userMessage.content,
        userId: state.session?.userId || "local-user",
        model: state.config.model,
        sourceImagePath: sourceImagePaths.at(-1) || "",
        requestId
      });
      return {
        content: result?.content || "已生成图片。",
        images: Array.isArray(result?.images) ? result.images : []
      };
    } catch (error) {
      if (isGenerationStoppedError(error)) throw error;
      if (!state.config.mockWithoutKey) {
        throw error;
      }
      return buildImageGenerationFallback(userMessage, error);
    }
  }

  if (window.desktopBridge?.chatCompletion) {
    const artifactOutput = userMessage?.artifactOutput || inferFastArtifactOutput(userMessage);
    if (artifactOutput) userMessage.artifactOutput = artifactOutput;
    const deterministicArtifact = Boolean(artifactOutput?.relativePath);
    const useFileCapabilities = !deterministicArtifact && shouldUseFileCapabilities(conversation, userMessage);
    const useBrowserAutomationTools = taskContext.browserAutomationTask === true || shouldUseBrowserAutomationTools(conversation, userMessage) || conversation?.skillId === "browser";
    const useDesktopApplicationTools = shouldUseDesktopApplicationTools(conversation, userMessage) || useBrowserAutomationTools;
    const useFullAgent = shouldUseFullAgentCapabilities(conversation, userMessage);
    const imagePaths = resolveConversationImagePaths(conversation, userMessage);
    pendingChatStreams.set(requestId, {
      conversationId: conversation.id,
      message: assistantMessage
    });
    try {
      const result = await window.desktopBridge.chatCompletion({
        messages: buildRemoteMessages(conversation, requestSkill, artifactOutput),
        message: userMessage.content,
        imagePaths,
        model: state.config.model,
        userId: state.session?.userId || "local-user",
        conversationId: conversation.id,
        attachments: attachmentPathList(userMessage.attachments),
        artifactOutput: artifactOutput || null,
        autoPreviewHtml: useFileCapabilities || artifactOutput?.format === "html",
        preferGateway: useFullAgent && !useDesktopApplicationTools,
        waitForGateway: useFullAgent && !useDesktopApplicationTools,
        enableFileTools: useFileCapabilities || useFullAgent || useDesktopApplicationTools,
        browserAutomationTask: useBrowserAutomationTools,
        browserAutomationTaskId: useBrowserAutomationTools ? taskContext.taskId : "",
        browserTaskFirstExecutedAt: taskContext.browserTask?.firstExecutedAt || "",
        browserTaskSiteKey: taskContext.browserTask?.siteKey || "",
        browserTaskCoreGoal: taskContext.browserTask?.coreGoal || "",
        taskId: taskContext.taskId || requestId,
        executionId: taskContext.executionId || "",
        retryOf: taskContext.retryOf || "",
        skillId: requestSkill?.id || "",
        skillSlug: requestSkill?.slug || "",
        skillName: requestSkill?.name || "",
        skillSource: requestSkill?.source || "",
        skillPrompt: requestSkill?.systemPrompt || "",
        stream: !useFileCapabilities && !useFullAgent && !useDesktopApplicationTools,
        requestId
      });
      return {
        content: result?.content || "企业模型服务已返回，但没有可展示的文本内容。",
        files: sanitizeMessageFiles(result?.files),
        browserTask: result?.browserTask || null,
        executionDetails: Array.isArray(result?.executionDetails) ? result.executionDetails : []
      };
    } catch (error) {
      if (isGenerationStoppedError(error)) throw error;
      if (!state.config.mockWithoutKey) {
        throw error;
      }
      return buildMockReply(userMessage, requestSkill, error);
    } finally {
      pendingChatStreams.delete(requestId);
    }
  }

  if (!state.config.mockWithoutKey) {
    throw new Error("企业模型服务不可用，且本地演示回复已关闭。");
  }

  return buildMockReply(userMessage, requestSkill);
}

function isImageGenerationRequest(userMessage, skill, conversation) {
  const text = String(userMessage?.content || "").toLowerCase();
  const hasImageAttachment = hasImageAttachments(userMessage?.attachments);
  const explicitTextOutputIntent = /(生成|写|撰写|输出|整理|提取|识别|分析|解读|总结|概括|翻译|改写|润色|回复|回答|拟定|编写).{0,24}(话术|文案|文字|文本|标题|描述|说明|介绍|摘要|总结|报告|方案|建议|清单|脚本|邮件|回复|口播稿|卖点|内容)/i.test(text);
  if (explicitTextOutputIntent || isGeneralKnowledgeQuestion(text)) return false;

  const explicitImageIntent = /(生成|画|绘制|做一张|做个|出一张|出图|文生图|create|generate|draw).*(图|图片|照片|海报|插画|image|photo|poster)/i.test(text);
  const imageSkillIntent = skill?.id === "image" && /(生成|画|绘制|做一张|出图|文生图|create|generate|draw)/i.test(text);
  const imageEditIntent = /(修改|调整|编辑|处理|重做|换|替换|移除|去掉|增加|添加|改成|变成|扩图|抠图|去背景|加水印).*(图|图片|照片|海报|背景|颜色|尺寸|风格|人物|文字)|(?:这张|刚才|上一张|上张).*(修改|调整|编辑|处理|换|去掉|增加|改成)/i.test(text);
  const imageUnderstandingIntent = /(?:分析|识别|读取|提取|总结|概括|解读|描述|说明|翻译).*(?:图|图片|截图|照片|附件)|(?:图|图片|截图|照片|附件).*(?:分析|识别|读取|提取|总结|概括|解读|描述|说明|翻译)/i.test(text);
  if (imageUnderstandingIntent && !explicitImageIntent) return false;

  const hasReusableImage = Boolean(resolveConversationImagePaths(conversation, userMessage).length);
  if (explicitImageIntent || imageSkillIntent || (imageEditIntent && (hasImageAttachment || hasReusableImage))) return true;

  // Selecting the image model is a useful fallback for prompt-only image requests,
  // but it must never override an explicit request for text based on an image.
  return /^gpt-image-/.test(state.config.model) && Boolean(text) && !hasImageAttachment;
}

function hasImageAttachments(paths) {
  if (!Array.isArray(paths)) {
    return false;
  }
  return attachmentPathList(paths).some((filePath) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(filePath || "")));
}

function getConversationImagePaths(conversation) {
  const paths = [];
  for (const message of conversation?.messages || []) {
    for (const filePath of attachmentPathList(message.attachments)) {
      if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(String(filePath || ""))) paths.push(filePath);
    }
    for (const image of message.images || []) {
      if (image?.localPath) paths.push(image.localPath);
    }
    for (const file of message.files || []) {
      const filePath = file?.absolutePath || file?.path || "";
      if (file?.kind === "image" || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(filePath))) paths.push(filePath);
    }
  }
  return [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))];
}

function resolveConversationImagePaths(conversation, userMessage) {
  const selected = attachmentPathList(userMessage?.attachments).filter((filePath) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(filePath || "")));
  if (selected.length) return [...new Set(selected)];

  const text = String(userMessage?.content || "");
  const referencesExistingImage = /(这张|这个图|这些图|刚才.*图|上一张|上张|之前.*图|图片|照片|海报|继续|按这个|基于它|修改它|调整它)/i.test(text);
  return referencesExistingImage ? getConversationImagePaths(conversation) : [];
}

function buildImageGenerationFallback(userMessage, error) {
  return {
    content: `图片生成服务暂不可用，已切换为需求整理。原因：${error.message || "未知错误"}\n\n我已记录你的文生图需求：${userMessage.content}\n\n请确认画面主体、风格、比例和用途。等图片生成接口可用后，我会直接返回图片结果。`,
    images: []
  };
}

function buildRemoteMessages(conversation, skill, artifactOutput = null) {
  const systemPrompt = [
    "你是XMAI Studio的桌面对话助手。",
    "当前产品是企业桌面智能工作台，回答使用中文，表达清晰、务实。",
    "回答排版要清晰工整：使用简短标题、短段落和有序列表，层次不超过三级；不要堆砌装饰符号，不要把 #、* 等 Markdown 源标记当作普通文字展示。",
    "不要提及任何底层平台、开源项目、封装来源或内部实现来源；统一以XMAI Studio和企业模型服务来表述。",
    "每个对话都可以直接使用文件读写、目录查看、命令运行和 HTML 网页预览能力，不需要切换到其他页面或模式。",
    "用户要求或明显意图创建、修改、运行文件时，应实际调用工具完成，并在回复中引用工具返回的绝对路径；用户要求运行网页时，应写入 HTML 并打开客户端预览。不要声称当前会话无法创建文件，不要要求用户手工创建文件。",
    "用户要求操作 Windows 软件时，应动态识别应用名称、窗口和控件；该能力适用于当前账号可访问的任意 Windows 应用，不限于提示词中的示例。优先使用 computer_list_apps、computer_launch_app、computer_inspect_app 和 computer_control_app，不要让用户手工点击。",
    "用户要求使用 Microsoft Edge、微软浏览器、Google Chrome、谷歌浏览器或浏览器技能时，必须真实调用 computer_browser_open 或 computer_browser_search。打开后优先调用 computer_inspect_app 读取网页按钮、链接、输入框和下拉框，并按名称连续完成全部步骤；浏览器下拉框使用 computer_control_app 的 set_text，把 text 设为目标选项。每次操作后重新检查当前网页，直到用户要求的最终页面真实出现，不能只完成第一步或等待用户反复说继续。没有获得工具成功回执时不得声称已经打开、选择或点击。",
    "如果应用使用自绘界面、computer_inspect_app 返回的控件不足，调用 computer_capture_app 查看当前窗口画面，再使用截图中的 0 到 1 相对坐标执行 click_position 或坐标 set_text；每次坐标点击必须准确填写 purpose。",
    "通过聊天或协作应用发送消息时，先调用 computer_prepare_message 填写草稿，再使用它返回的 draftId 调用 computer_send_message；完全访问模式下应用会直接执行用户明确要求的发送动作并记录审计。",
    artifactOutput?.relativePath
      ? `本轮使用快速文件生成：请直接输出完整可用内容，应用会自动保存到 ${artifactOutput.relativePath}。${artifactOutput.format === "html" ? "网页必须在一个完整 html 代码块中返回，包含所需 CSS 和 JavaScript。" : "代码类内容请放在一个完整代码块中；文档类内容直接输出完整正文。"}`
      : "",
    "当前客户端默认启用完全访问模式。用户已在本轮明确要求的文件、命令、应用或浏览器操作应直接调用工具执行，不要回复执行计划，也不要停下来索要应用内部权限；Windows UAC、系统权限和目标软件安全验证仍按系统规则处理。",
    skill?.systemPrompt || ""
  ].filter(Boolean).join("\n");

  const history = conversation.messages
    .filter((message) => !message.loading && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: withAttachmentContext(message)
    }));

  return [
    { role: "system", content: systemPrompt },
    ...history
  ];
}

async function hydrateConversationAttachments() {
  if (!window.desktopBridge?.getInputFileMetadata) return;
  const paths = [...new Set(state.conversations.flatMap((conversation) => conversation.messages.flatMap((message) => attachmentPathList(message.attachments))))];
  if (!paths.length) return;
  try {
    const metadata = await window.desktopBridge.getInputFileMetadata({ filePaths: paths, allowUnlimited: true });
    const byPath = new Map(metadata.map((item) => [item.absolutePath || item.path, item]));
    state.conversations.forEach((conversation) => conversation.messages.forEach((message) => {
      message.attachments = sanitizeAttachmentItems(message.attachments).map((item) => byPath.get(item.absolutePath) || item);
    }));
    saveState();
    render();
  } catch {
    // Missing historical attachments remain visible as file cards.
  }
}

function withAttachmentContext(message) {
  const attachmentPaths = attachmentPathList(message.attachments);
  const generatedFiles = sanitizeMessageFiles(message.files).map((file) => file.absolutePath);
  const generatedImages = Array.isArray(message.images)
    ? message.images.map((image) => image?.localPath).filter(Boolean)
    : [];
  const paths = [...new Set([...attachmentPaths, ...generatedFiles, ...generatedImages].map((item) => String(item || "").trim()).filter(Boolean))];
  if (!paths.length) return message.content;
  return `${message.content}\n\n本条消息关联的本地文件：\n${paths.join("\n")}`;
}

function buildMockReply(userMessage, skill, fallbackError) {
  const fallbackLine = fallbackError
    ? `企业模型服务暂不可用，已切换为本地演示回复。原因：${fallbackError.message || "未知错误"}\n\n`
    : "";
  const attachmentLine = userMessage.attachments?.length
    ? `\n\n已将 ${userMessage.attachments.length} 个本地文件作为本轮上下文。`
    : "";

  if (!skill) {
    return `${fallbackLine}收到。我会先按普通对话处理你的需求，并把它放在XMAI Studio的桌面工作台里。\n\n当前可以继续追问、补充上下文，或从左侧选择周报、图片处理、文案润色、东哥会议模型等技能。${attachmentLine}`;
  }

  if (skill.id === "weekly") {
    return `${fallbackLine}我已按“周报生成”理解你的输入。建议输出结构如下：\n\n1. 本周完成：列出已交付事项、关键进展和可量化结果。\n2. 进行中：标注当前状态、依赖方和预计完成时间。\n3. 风险问题：说明阻塞点、影响范围和需要协调的资源。\n4. 下周计划：按优先级给出 3 到 5 项行动。\n\n你可以继续把本周素材发给我，我会整理成正式周报。${attachmentLine}`;
  }

  if (skill.id === "image") {
    return `${fallbackLine}我已进入“图片处理”上下文。请告诉我处理类型、输出规格和保存位置；如果涉及批量覆盖或删除，我会先请求确认。${attachmentLine}`;
  }

  if (skill.id === "copywriting") {
    return `${fallbackLine}我已按“文案润色”处理。你可以把原文贴过来，我会默认给出：\n\n正式版：适合公告、邮件、方案说明。\n简洁版：保留重点，减少铺垫。\n优化说明：列出我改动了哪些语气、结构和措辞。\n\n如果你有目标语气，比如更商务、更有亲和力、更适合老板看，也可以直接说明。${attachmentLine}`;
  }

  return `${fallbackLine}我已进入“东哥会议模型”上下文。会议蒸馏会提炼一句话判断、核心矛盾、决策地图、任务安排、风险与回退，并把无法确认的信息单独标记为待确认。\n\n把会议文字、录音、笔记、PDF、PPT、截图或群聊记录发过来即可继续。${attachmentLine}`;
}

function buildErrorReply(error) {
  const message = error?.message || "未知错误";
  return `企业模型服务暂时没有连通：${message}\n\n请联系管理员检查企业模型代理配置后重试。`;
}

async function attachFiles() {
  if (!window.desktopBridge?.selectFiles) {
    showToast("当前环境没有可用的桌面文件选择能力。");
    return;
  }
  try {
    const allowUnlimited = state.activeView.startsWith("skill-form:") || state.activeView === "company-skill-create";
    const files = await window.desktopBridge.selectFiles({ allowUnlimited });
    if (!Array.isArray(files) || !files.length) return;
    await addSelectedFiles(files);
    if (state.activeView === "chat") focusPrompt();
  } catch (error) {
    showToast(error.message || "附件选择失败");
  }
}

async function addSelectedFiles(files) {
  const filePaths = [...new Set((Array.isArray(files) ? files : []).map((file) => typeof file === "string" ? file : file?.path || file?.absolutePath || "").filter(Boolean))];
  if (!filePaths.length) return;
  try {
    const combinedPaths = [...new Set([...attachmentPathList(state.selectedFiles), ...filePaths])];
    const allowUnlimited = state.activeView.startsWith("skill-form:") || state.activeView === "company-skill-create";
    const metadata = await window.desktopBridge.getInputFileMetadata?.({ filePaths: combinedPaths, allowUnlimited })
      || combinedPaths.slice(0, 20).map((filePath) => ({ path: filePath, absolutePath: filePath, name: baseName(filePath), kind: "file" }));
    state.selectedFiles = metadata;
    if (state.activeView === "chat") {
      renderAttachmentBar();
    } else if (!refreshSkillAttachmentField()) {
      renderPageView();
    }
    showToast(`已选择 ${filePaths.length} 个附件`);
  } catch (error) {
    showToast(error.message || "附件添加失败");
  }
}

function desktopFilePath(file) {
  try { return window.desktopBridge?.getPathForFile?.(file) || file?.path || ""; } catch { return file?.path || ""; }
}

function removeAttachment(index) {
  state.selectedFiles.splice(index, 1);
  if (state.activeView === "chat") renderAttachmentBar();
  else if (!refreshSkillAttachmentField()) renderPageView();
}

async function readSafeAiRuntimeConfig() {
  if (!window.desktopBridge?.getAiRuntimeConfig) {
    return {
      configured: false,
      model: defaultConfig.model,
      models: []
    };
  }

  try {
    return await window.desktopBridge.getAiRuntimeConfig();
  } catch {
    return {
      configured: false,
      model: defaultConfig.model,
      models: []
    };
  }
}

function applySession(session) {
  if (!session?.userId) return;
  cancelAllPendingGenerations();
  sessionGeneration += 1;
  pendingConversationRequests.clear();
  pendingChatStreams.clear();
  openConversationMenuId = null;
  renamingConversationId = null;
  const saved = restoreLegacyChatForSession(session.userId)
    || parseJson(localStorage.getItem(getStorageKey(session.userId)));
  state.session = session;
  state.config = {
    ...state.config,
    ...safeClientConfig(saved?.config)
  };
  state.conversations = Array.isArray(saved?.conversations) && saved.conversations.length
    ? saved.conversations.map(sanitizeConversation)
    : [createConversation("新的对话")];
  state.activeConversationId = saved?.activeConversationId || state.conversations[0]?.id;
  const savedConversation = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
  const legacySkillId = saved?.activeSkillId || null;
  if (saved?.skillBindingVersion !== SKILL_BINDING_VERSION) {
    state.conversations.forEach((conversation) => { conversation.skillId = null; });
  }
  state.activeSkillId = savedConversation?.skillId || null;
  const migrated = saved?.skillBindingVersion !== SKILL_BINDING_VERSION;
  state.activeView = migrated ? "chat" : (saved?.activeView === "workspace" ? "chat" : (saved?.activeView || "chat"));
  state.searchQuery = saved?.searchQuery || "";
  state.taskResult = migrated ? null : (saved?.taskResult || null);
  state.selectedFiles = [];
  state.scheduledTasks = [];
  state.taskRuns = [];
  state.workspace = null;
  state.authReady = true;
  refreshInstalledSkills();
  startCompanySkillSync();
}

async function bootstrapAuth() {
  if (!window.desktopBridge?.getDingtalkSession) {
    state.authReady = true;
    render();
    if (state.session) {
      await refreshWorkData({ silent: true });
      render();
      focusPrompt();
    }
    return;
  }

  try {
    const result = await window.desktopBridge.getDingtalkSession();
    state.authStatus = result || state.authStatus;
    if (state.config.autoLogin && result?.session?.userId) {
      applySession(result.session);
    }
    await refreshInstalledSkills();
  } catch (error) {
    state.authStatus = {
      configured: false,
      mode: "error",
      message: error.message || "钉钉登录状态读取失败"
    };
  } finally {
    state.authReady = true;
    saveState();
    render();
  }

  if (state.session) {
    await refreshWorkData({ silent: true });
    await refreshInstalledSkills();
    render();
    focusPrompt();
  }
}

async function handleLogin(method) {
  state.config.autoLogin = els.autoLogin.checked;
  if (method !== "dingtalk") {
    showToast("当前仅支持钉钉登录");
    return;
  }
  try {
    if (els.dingtalkLoginButton) {
      els.dingtalkLoginButton.disabled = true;
      els.dingtalkLoginButton.querySelector("span:last-child").textContent = "正在打开登录窗口...";
    }
    if (els.loginStatusText) els.loginStatusText.textContent = "请在应用内登录窗口完成身份验证";
    const session = await window.desktopBridge?.dingtalkLogin?.();
    if (!session?.userId) throw new Error("钉钉未返回用户信息");
    applySession(session);
    saveState();
    render();
    await refreshWorkData({ silent: true });
    render();
    focusPrompt();
  } catch (error) {
    state.authReady = true;
    renderLoginState();
    showToast(error.message || "钉钉登录失败");
  }
}

async function logout() {
  const signedOutUserId = state.session?.userId;
  cancelAllPendingGenerations();
  sessionGeneration += 1;
  pendingConversationRequests.clear();
  pendingChatStreams.clear();
  openConversationMenuId = null;
  renamingConversationId = null;
  clearInterval(companySkillSyncTimer);
  clearInterval(skillTaxonomySyncTimer);
  companySkillSyncTimer = null;
  skillTaxonomySyncTimer = null;
  try {
    await window.desktopBridge?.dingtalkLogout?.();
  } catch {
    // Local sign-out still proceeds if the remote session is already unavailable.
  }
  state.session = null;
  state.conversations = [createConversation("新的对话")];
  state.activeConversationId = state.conversations[0].id;
  state.activeSkillId = activeConversation()?.skillId || null;
  state.activeView = "chat";
  state.searchQuery = "";
  state.taskResult = null;
  state.selectedFiles = [];
  state.workspace = null;
  state.authReady = true;
  companySkillState = { catalog: [], revokedSkillIds: [], submissions: [], loading: false, error: "", loaded: false, progress: null };
  refreshInstalledSkills();
  if (signedOutUserId) {
    const storageKey = getStorageKey(signedOutUserId);
    const storedState = parseJson(localStorage.getItem(storageKey));
    if (storedState) {
      delete storedState.session;
      localStorage.setItem(storageKey, JSON.stringify(storedState));
    }
  }
  localStorage.removeItem(GLOBAL_SESSION_KEY);
  saveState();
  render();
}

function useStarter(skillId, prompt) {
  setConversationSkill(activeConversation(), skillId);
  state.activeView = "chat";
  els.promptInput.value = prompt || "";
  autoResizePrompt();
  saveState();
  render();
  focusPrompt();
}

function showToast(message) {
  els.toast.textContent = scrubInternalTerms(message);
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2400);
}

function handleSkillInstallProgress(progress = {}) {
  const currentUserId = String(state.session?.userId || "local-user");
  if (String(progress.userId || "local-user") !== currentUserId) return;

  if (progress.status === "completed") {
    if (progress.reference) onlineSkillInstallRefs.delete(progress.reference);
    refreshInstalledSkills().catch(() => {});
    renderOnlineSkillLibrary();
    showToast(`技能“${progress.skillName || "新技能"}”已安装完成`);
    return;
  }

  if (progress.status === "failed") {
    if (progress.reference) onlineSkillInstallRefs.delete(progress.reference);
    if (progress.filtered && progress.reference) {
      onlineSkillLibrary = {
        ...onlineSkillLibrary,
        results: onlineSkillLibrary.results.filter((skill) => skill.reference !== progress.reference),
        filteredCount: onlineSkillLibrary.filteredCount + 1,
        error: ""
      };
      renderOnlineSkillLibrary();
      showToast("已过滤不符合安装格式的技能");
      return;
    }
    showToast(`技能“${progress.skillName || "新技能"}”安装失败：${scrubInternalTerms(progress.error || "未知错误")}`);
    return;
  }

  if (progress.status !== "confirmation-required") return;
  const result = progress.result || {};
  if (progress.sourceType === "online") {
    if (progress.reference) onlineSkillInstallRefs.delete(progress.reference);
    onlineSkillLibrary = { ...onlineSkillLibrary, error: "" };
    renderOnlineSkillLibrary();
    openOnlineSkillConfirmation(progress.reference, progress.flags || {}, result);
    return;
  }

  const inspection = result.inspection;
  if (!inspection) {
    showToast(`技能“${progress.skillName || "新技能"}”需要确认后继续安装`);
    return;
  }
  const returnView = localSkillImport.returnView || "skills";
  resetLocalSkillImport();
  localSkillImport.returnView = returnView;
  localSkillImport.source = progress.sourceType === "online" ? "github" : (/\.zip$/i.test(progress.sourcePath || "") ? "zip" : "folder");
  localSkillImport.sourcePath = progress.sourcePath || "";
  applySkillImportInspection(inspection);
  localSkillImport.step = 2;
  localSkillImport.error = inspection.requiresRiskAcknowledgement ? "请先确认技能风险后再安装。" : "同名技能已存在，请确认是否覆盖。";
  localSkillImport.acknowledgeRisk = progress.flags?.acknowledgeRisk === true;
  localSkillImport.replace = progress.flags?.replace === true;
  showView("skill-import");
}

function focusPrompt() {
  requestAnimationFrame(() => {
    els.promptInput.focus();
  });
}

function autoResizePrompt() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${Math.min(els.promptInput.scrollHeight, 160)}px`;
}

function renderWindowState(windowState = {}) {
  const maximized = windowState.maximized === true || windowState.fullScreen === true;
  document.documentElement.classList.toggle("window-maximized", maximized);
  if (!els.maximizeButton) return;
  const label = maximized ? "还原" : "最大化";
  els.maximizeButton.title = label;
  els.maximizeButton.setAttribute("aria-label", label);
  els.maximizeButton.dataset.maximized = String(maximized);
  const glyph = els.maximizeButton.querySelector("[data-window-icon]");
  setSvgIcon(glyph, maximized ? "copy-square" : "maximize");
}

function handleUpdateStatus(update = {}) {
  const noAvailableRelease = ["not-available", "current"].includes(update.status);
  desktopUpdateStatus = {
    ...desktopUpdateStatus,
    ...update,
    status: update.status || desktopUpdateStatus.status,
    availableDisplayVersion: update.release?.displayVersion || (noAvailableRelease ? "" : desktopUpdateStatus.availableDisplayVersion),
    availableRelease: noAvailableRelease ? null : (update.availableRelease || update.release || desktopUpdateStatus.availableRelease),
    updateHistory: Array.isArray(update.updateHistory) ? update.updateHistory : desktopUpdateStatus.updateHistory
  };
  if (state.activeView === "settings") renderSettingsPage();
  if (update.status === "download-start") showToast("正在后台下载新版本...");
  if (update.status === "cache-hit") showToast("已验证本地安装包，无需重新下载");
  if (update.status === "downloaded") showToast("新版本已下载，正在启动安装程序...");
  if (update.status === "error") showToast(update.message || "新版本暂时无法安装");
}

document.addEventListener("click", (event) => {
  const automationPickerOption = event.target.closest?.("[data-automation-picker-option]");
  if (automationPickerOption && automationEditorDraft) {
    const field = automationPickerOption.dataset.automationPickerOption;
    automationEditorDraft[field] = automationPickerOption.dataset.value || "";
    automationPickerState = { open: "", query: "" };
    renderAutomationEditorPage();
    return;
  }

  const automationPickerToggle = event.target.closest?.("[data-automation-picker-toggle]");
  if (automationPickerToggle && automationEditorDraft) {
    const field = automationPickerToggle.dataset.automationPickerToggle;
    const willOpen = automationPickerState.open !== field;
    automationPickerState = { open: willOpen ? field : "", query: "" };
    renderAutomationEditorPage();
    if (willOpen) window.setTimeout(() => {
      document.querySelector(`[data-automation-picker-search="${field}"]`)?.focus();
    }, 0);
    return;
  }

  if (automationPickerState.open && !event.target.closest?.("[data-automation-picker]")) closeAutomationPicker();

  const windowControl = event.target.closest("[data-window-action]");
  if (windowControl) {
    window.desktopBridge?.controlWindow?.(windowControl.dataset.windowAction);
    return;
  }

  const modelOption = event.target.closest("[data-model-value]");
  if (modelOption) {
    selectModel(modelOption.dataset.modelValue);
    return;
  }

  if (event.target.closest("#modelButton")) {
    toggleModelPicker();
    return;
  }

  const menuUtility = event.target.closest("[data-menu-utility]");
  if (menuUtility) {
    closeComposerMenu();
    if (menuUtility.dataset.menuUtility === "local-file") void attachFiles();
    return;
  }

  const menuSkill = event.target.closest("[data-menu-skill]");
  if (menuSkill) {
    setActiveSkill(menuSkill.dataset.menuSkill);
    if (/^\/[^\s]*$/.test(els.promptInput.value.trim())) {
      els.promptInput.value = "";
      autoResizePrompt();
    }
    closeComposerMenu();
    return;
  }

  if (!event.target.closest("#modelPicker")) {
    els.modelDropdown?.classList.remove("open");
  }
  if (!event.target.closest("#composerMenu") && !event.target.closest("[data-action='toggle-composer-menu']")) {
    closeComposerMenu();
  }

  const renameSaveButton = event.target.closest("[data-conversation-rename-save]");
  if (renameSaveButton) {
    saveConversationRename(renameSaveButton.dataset.conversationRenameSave);
    return;
  }

  const renameCancelButton = event.target.closest("[data-conversation-rename-cancel]");
  if (renameCancelButton) {
    cancelConversationRename();
    return;
  }

  const conversationAction = event.target.closest("[data-conversation-action]");
  if (conversationAction) {
    const id = conversationAction.dataset.conversationId;
    if (conversationAction.dataset.conversationAction === "rename") startConversationRename(id);
    if (conversationAction.dataset.conversationAction === "pin") toggleConversationPin(id);
    if (conversationAction.dataset.conversationAction === "delete") openConversationDelete(id);
    return;
  }

  const conversationMenuButton = event.target.closest("[data-conversation-menu]");
  if (conversationMenuButton) {
    toggleConversationMenu(conversationMenuButton.dataset.conversationMenu);
    return;
  }

  if (openConversationMenuId && !event.target.closest("[data-conversation-row]")) {
    openConversationMenuId = null;
    renderConversationList();
  }

  const conversationButton = event.target.closest("[data-conversation]");
  if (conversationButton) {
    setActiveConversation(conversationButton.dataset.conversation);
    return;
  }

  const skillButton = event.target.closest("[data-skill]");
  if (skillButton) {
    setActiveSkill(skillButton.dataset.skill);
    return;
  }

  const skillUseButton = event.target.closest("[data-use-skill]");
  if (skillUseButton) {
    openNewConversationWithSkill(skillUseButton.dataset.useSkill);
    return;
  }

  const starterButton = event.target.closest("[data-starter-skill]");
  if (starterButton) {
    useStarter(starterButton.dataset.starterSkill, starterButton.dataset.starterPrompt);
    return;
  }

  const removeButton = event.target.closest("[data-remove-file]");
  if (removeButton) {
    removeAttachment(Number(removeButton.dataset.removeFile));
    return;
  }

  const artifactCopyButton = event.target.closest("[data-artifact-copy]");
  if (artifactCopyButton) {
    copyArtifactPath(artifactCopyButton.dataset.artifactCopy);
    return;
  }

  const artifactDownloadButton = event.target.closest("[data-artifact-download]");
  if (artifactDownloadButton) {
    downloadArtifactPath(artifactDownloadButton.dataset.artifactDownload);
    return;
  }

  const messageFileButton = event.target.closest("[data-message-file-open]");
  if (messageFileButton) {
    openMessageFile(messageFileButton.dataset.messageFileOpen);
    return;
  }

  const openImageButton = event.target.closest("[data-open-image-path]");
  if (openImageButton) {
    openMessageFile(openImageButton.dataset.openImagePath);
    return;
  }

  const attachmentPreviewButton = event.target.closest("[data-attachment-preview]");
  if (attachmentPreviewButton) {
    openMessageFile(attachmentPreviewButton.dataset.attachmentPreview);
    return;
  }

  const openArtifactButton = event.target.closest("[data-open-artifact-path]");
  if (openArtifactButton) {
    openMessageFile(openArtifactButton.dataset.openArtifactPath);
    return;
  }

  const openTaskRunButton = event.target.closest("[data-open-task-run]");
  if (openTaskRunButton) {
    openTaskRun(openTaskRunButton.dataset.openTaskRun);
    return;
  }

  const skillTabButton = event.target.closest("[data-skill-tab]");
  if (skillTabButton) {
    skillLibraryState.tab = skillTabButton.dataset.skillTab;
    renderSkillsPage();
    return;
  }

  const skillCategoryButton = event.target.closest("[data-skill-category]");
  if (skillCategoryButton) {
    skillLibraryState.categoryId = skillCategoryButton.dataset.skillCategory;
    renderSkillsPage();
    return;
  }

  const skillImportSource = event.target.closest("[data-skill-import-source]");
  if (skillImportSource) {
    localSkillImport = {
      ...localSkillImport,
      source: skillImportSource.dataset.skillImportSource,
      sourcePath: "",
      reference: "",
      inspection: null,
      loading: false,
      error: "",
      acknowledgeRisk: false,
      replace: false,
      tagQuery: ""
    };
    renderLocalSkillImport();
    return;
  }

  const removeSkillImportTag = event.target.closest("[data-remove-skill-import-tag]");
  if (removeSkillImportTag) {
    localSkillImport.tags.splice(Number(removeSkillImportTag.dataset.removeSkillImportTag), 1);
    localSkillImport.tagQuery = "";
    localSkillImport.error = "";
    renderLocalSkillImport();
    document.getElementById("skillImportTagInput")?.focus();
    return;
  }

  const selectSkillImportTag = event.target.closest("[data-select-skill-import-tag]");
  if (selectSkillImportTag) {
    addSkillImportTag(selectSkillImportTag.dataset.selectSkillImportTag);
    return;
  }

  if (event.target.closest("[data-create-skill-import-tag]")) {
    addSkillImportCustomTag();
    return;
  }

  const selectInstalledSkillTag = event.target.closest("[data-select-installed-skill-tag]");
  if (selectInstalledSkillTag) {
    addInstalledSkillEditorTag(selectInstalledSkillTag.dataset.selectInstalledSkillTag);
    return;
  }

  if (event.target.closest("[data-create-installed-skill-tag]")) {
    addInstalledSkillEditorCustomTag();
    return;
  }

  const confirmSkillActionButton = event.target.closest("[data-confirm-skill-action]");
  if (confirmSkillActionButton) {
    openSkillActionConfirmation(confirmSkillActionButton);
    return;
  }

  const automationEditButton = event.target.closest("[data-automation-edit]");
  if (automationEditButton) {
    openAutomationEditor(automationEditButton.dataset.automationEdit);
    return;
  }

  const automationRunButton = event.target.closest("[data-automation-run]");
  if (automationRunButton) {
    runAutomationNow(automationRunButton.dataset.automationRun);
    return;
  }

  const automationPauseButton = event.target.closest("[data-automation-pause]");
  if (automationPauseButton) {
    pauseAutomationNow(automationPauseButton.dataset.automationPause);
    return;
  }

  const automationDeleteButton = event.target.closest("[data-automation-delete]");
  if (automationDeleteButton) {
    deleteAutomation(automationDeleteButton.dataset.automationDelete);
    return;
  }

  const automationFrequencyButton = event.target.closest("[data-automation-frequency]");
  if (automationFrequencyButton && automationEditorDraft) {
    const frequency = automationFrequencyButton.dataset.automationFrequency;
    automationEditorDraft.frequency = frequency === "periodic" ? "daily" : frequency;
    renderAutomationEditorPage();
    return;
  }

  const skillCategoryScrollButton = event.target.closest("[data-skill-category-scroll]");
  if (skillCategoryScrollButton) {
    const strip = skillCategoryScrollButton.closest("[data-skill-category-navigation]")?.querySelector("[data-skill-category-strip]");
    if (strip) {
      const direction = Number(skillCategoryScrollButton.dataset.skillCategoryScroll || 1);
      strip.scrollBy({ left: direction * Math.max(240, Math.floor(strip.clientWidth * 0.7)), behavior: "smooth" });
    }
    return;
  }

  const enterpriseUseButton = event.target.closest("[data-use-enterprise-skill]");
  if (enterpriseUseButton) {
    useEnterpriseSkill(enterpriseUseButton.dataset.useEnterpriseSkill);
    return;
  }

  const enterpriseDownloadButton = event.target.closest("[data-download-enterprise-skill]");
  if (enterpriseDownloadButton) {
    const skill = skillLibraryItems().find((item) => item.sourceType === "ENTERPRISE" && item.enterpriseSkillId === enterpriseDownloadButton.dataset.downloadEnterpriseSkill);
    if (skill) downloadSkillPackage(skill);
    return;
  }

  const skillDownloadButton = event.target.closest("[data-download-skill]");
  if (skillDownloadButton) {
    const skill = skillLibraryItems().find((item) => item.id === skillDownloadButton.dataset.downloadSkill);
    if (skill) downloadSkillPackage(skill);
    return;
  }

  const skillManageButton = event.target.closest("[data-manage-skill]");
  if (skillManageButton) {
    openPersonalSkillDetail(skillManageButton.dataset.manageSkill);
    return;
  }

  const editInstalledSkillButton = event.target.closest("[data-edit-installed-skill]");
  if (editInstalledSkillButton) {
    editInstalledSkill(editInstalledSkillButton.dataset.editInstalledSkill);
    return;
  }

  const submitInstalledSkillButton = event.target.closest("[data-submit-installed-skill]");
  if (submitInstalledSkillButton) {
    prepareInstalledSkillForReview(submitInstalledSkillButton.dataset.submitInstalledSkill, submitInstalledSkillButton);
    return;
  }

  const removeInstalledSkillTagButton = event.target.closest("[data-remove-installed-skill-tag]");
  if (removeInstalledSkillTagButton) {
    installedSkillEditor.tags.splice(Number(removeInstalledSkillTagButton.dataset.removeInstalledSkillTag), 1);
    installedSkillEditor.tagQuery = "";
    renderInstalledSkillEditorTags();
    document.getElementById("installedSkillTagInput")?.focus();
    return;
  }

  const openSkillFormButton = event.target.closest("[data-open-skill-form]");
  if (openSkillFormButton) {
    openSkillForm(openSkillFormButton.dataset.openSkillForm);
    return;
  }

  const submitSkillFormButton = event.target.closest("[data-submit-skill-form]");
  if (submitSkillFormButton) {
    submitSkillForm(submitSkillFormButton.dataset.submitSkillForm);
    return;
  }

  const optionPill = event.target.closest("[data-option-pill]");
  if (optionPill) {
    toggleOptionPill(optionPill);
    return;
  }

  const skillFilePicker = event.target.closest("[data-skill-file-picker]");
  if (skillFilePicker) {
    attachFiles();
    return;
  }

  const removeInstalledSkillButton = event.target.closest("[data-remove-installed-skill]");
  if (removeInstalledSkillButton) {
    const skillId = removeInstalledSkillButton.dataset.removeInstalledSkill;
    if (!window.confirm("确定卸载这个技能吗？")) return;
    window.desktopBridge?.removeInstalledSkill?.({ userId: state.session?.userId || "local-user", skillId, submissionStatus: removeInstalledSkillButton.dataset.submissionStatus || "" })
      .then(async () => {
        state.activeView = "skills";
        await refreshInstalledSkills();
        reportV11Module("SKILL_LIBRARY", "delete_personal_skill", true);
      })
      .catch((error) => showToast(error.message || "技能卸载失败"));
    return;
  }

  const installOnlineSkillButton = event.target.closest("[data-install-online-skill]");
  if (installOnlineSkillButton) {
    installOnlineSkill(installOnlineSkillButton.dataset.installOnlineSkill);
    return;
  }

  const browserTaskViewButton = event.target.closest("[data-browser-task-view]");
  if (browserTaskViewButton) {
    viewBrowserTask(browserTaskViewButton.dataset.browserTaskView);
    return;
  }

  const browserTaskPauseButton = event.target.closest("[data-browser-task-pause]");
  if (browserTaskPauseButton) {
    pauseBrowserTask(browserTaskPauseButton.dataset.browserTaskPause);
    return;
  }

  const browserTaskResumeButton = event.target.closest("[data-browser-task-resume]");
  if (browserTaskResumeButton) {
    resumeBrowserTask(browserTaskResumeButton.dataset.browserTaskResume);
    return;
  }

  const messageCopyButton = event.target.closest("[data-message-copy]");
  if (messageCopyButton) {
    copyMessageText(messageCopyButton.dataset.messageCopy);
    return;
  }

  const promptLibrarySave = event.target.closest("[data-prompt-library-save]");
  if (promptLibrarySave) {
    togglePromptLibraryFavorite(promptLibrarySave.dataset.promptLibrarySave);
    return;
  }

  const promptLibraryOpen = event.target.closest("[data-prompt-library-open], [data-prompt-library-id]");
  if (promptLibraryOpen) {
    openPromptLibraryDetail(promptLibraryOpen.dataset.promptLibraryOpen || promptLibraryOpen.dataset.promptLibraryId);
    return;
  }

  const promptLibraryScope = event.target.closest("[data-prompt-library-scope]");
  if (promptLibraryScope) {
    promptLibraryState.scope = promptLibraryScope.dataset.promptLibraryScope === "saved" ? "saved" : "all";
    promptLibraryState.page = 1;
    if (promptLibraryState.scope === "saved") renderPromptLibraryPage();
    else loadPromptLibrary();
    return;
  }

  const promptLibraryCategory = event.target.closest("[data-prompt-library-category]");
  if (promptLibraryCategory) {
    promptLibraryState.category = promptLibraryCategory.dataset.promptLibraryCategory || "all";
    promptLibraryState.page = 1;
    if (promptLibraryState.scope === "saved") renderPromptLibraryPage();
    else loadPromptLibrary();
    return;
  }

  const promptLibraryPage = event.target.closest("[data-prompt-library-page]");
  if (promptLibraryPage) {
    const value = promptLibraryPage.dataset.promptLibraryPage;
    const totalPages = Math.max(1, Math.ceil(promptLibraryVisibleTotal() / promptLibraryState.pageSize));
    if (value === "previous") promptLibraryState.page = Math.max(1, promptLibraryState.page - 1);
    else if (value === "next") promptLibraryState.page = Math.min(totalPages, promptLibraryState.page + 1);
    else promptLibraryState.page = Math.max(1, Math.min(totalPages, Number(value) || 1));
    els.pageView.scrollTo({ top: 0, behavior: "smooth" });
    if (promptLibraryState.scope === "saved") renderPromptLibraryPage();
    else loadPromptLibrary();
    return;
  }

  const promptLibraryCategoryScroll = event.target.closest("[data-prompt-library-category-scroll]");
  if (promptLibraryCategoryScroll) {
    const strip = els.pageContent.querySelector("[data-prompt-library-category-strip]");
    const direction = Number(promptLibraryCategoryScroll.dataset.promptLibraryCategoryScroll || 1);
    strip?.scrollBy({ left: direction * Math.max(220, Math.floor(strip.clientWidth * 0.72)), behavior: "smooth" });
    return;
  }

  if (event.target.closest("[data-prompt-library-clear]")) {
    promptLibraryState.query = "";
    promptLibraryState.page = 1;
    if (promptLibraryState.scope === "saved") renderPromptLibraryPage();
    else loadPromptLibrary();
    return;
  }
  if (event.target.closest("[data-prompt-library-refresh], [data-prompt-library-retry]")) {
    loadPromptLibrary({ force: true });
    return;
  }
  if (event.target.closest("[data-prompt-library-reset]")) {
    resetPromptLibraryFilters();
    return;
  }
  if (event.target.closest("[data-prompt-library-close]")) {
    closePromptLibraryDetail();
    return;
  }
  if (event.target.closest("[data-prompt-library-detail-save]")) {
    togglePromptLibraryFavorite(promptLibraryState.activePrompt?.id);
    return;
  }
  if (event.target.closest("[data-prompt-library-copy]")) {
    copyPromptLibraryPrompt();
    return;
  }
  if (event.target.closest("[data-prompt-library-use]")) {
    usePromptLibraryPrompt();
    return;
  }

  const installCompanySkillButton = event.target.closest("[data-install-company-skill]");
  if (installCompanySkillButton) {
    installCompanySkillFromCatalog(installCompanySkillButton.dataset.installCompanySkill);
    return;
  }

  const withdrawSkillSubmissionButton = event.target.closest("[data-withdraw-skill-submission]");
  if (withdrawSkillSubmissionButton) {
    withdrawCompanySkillSubmission(
      withdrawSkillSubmissionButton.dataset.withdrawSkillSubmission,
      Number(withdrawSkillSubmissionButton.dataset.stateVersion || 1)
    );
    return;
  }

  const loginButton = event.target.closest("[data-login]");
  if (loginButton) {
    handleLogin(loginButton.dataset.login);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  if (action === "new-chat") createNewConversation();
  if (action === "show-view") {
    const targetView = String(actionButton.dataset.view || "");
    if (targetView.startsWith("company-skill-")) closeLocalSkillImport();
    if (targetView === "company-skill-submit") {
      companySkillSubmission = { sourcePath: "", inspection: null, importDraft: null, loading: false, submitting: false, error: "", normalizationNote: "" };
    }
    showView(targetView);
  }
  if (action === "logout") logout();
  if (action === "clear-skill") clearActiveSkill();
  if (action === "attach-file") attachFiles();
  if (action === "toggle-composer-menu") toggleComposerMenu();
  if (action === "stop-generation") stopActiveGeneration();
  if (action === "cancel-runtime-setup") cancelRuntimeSetup();
  if (action === "conversation-delete-cancel") closeConversationDelete();
  if (action === "conversation-delete-confirm") confirmConversationDelete();
  if (action === "artifact-preview-close") closeArtifactPreview();
  if (action === "artifact-copy-current" && currentArtifactPreview?.path) copyArtifactPath(currentArtifactPreview.path);
  if (action === "artifact-download-current" && currentArtifactPreview?.path) downloadArtifactPath(currentArtifactPreview.path);
  if (action === "artifact-image-zoom-out" && artifactImagePreviewState) setArtifactImageZoom(artifactImagePreviewState.zoom - 0.1);
  if (action === "artifact-image-zoom-in" && artifactImagePreviewState) setArtifactImageZoom(artifactImagePreviewState.zoom + 0.1);
  if (action === "artifact-image-fit") fitArtifactPreviewImage();
  if (action === "artifact-image-rotate-left") rotateArtifactPreviewImage(-90);
  if (action === "artifact-image-rotate-right") rotateArtifactPreviewImage(90);
  if (action === "open-prompt-library") window.desktopBridge?.openPromptLibrary?.().catch((error) => {
    const message = String(error?.message || "").replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
    showToast(message || "提示词库打开失败");
  });
  if (action === "new-automation") openAutomationEditor();
  if (action === "cancel-automation-editor") closeAutomationEditor();
  if (action === "save-automation") saveAutomationEditor();
  if (action === "choose-automation-workspace") {
    window.desktopBridge?.selectFolder?.().then((folderPath) => {
      if (!folderPath || !automationEditorDraft) return;
      automationEditorDraft.workspacePath = folderPath;
      renderAutomationEditorPage();
    }).catch((error) => showToast(error.message || "工作目录选择失败"));
  }
  if (action === "open-skill-import" || action === "install-skill") openLocalSkillImport();
  if (action === "close-skill-import") closeLocalSkillImport();
  if (action === "choose-skill-import-source") chooseLocalSkillSource();
  if (action === "validate-skill-import") validateSkillImport();
  if (action === "skill-import-previous") {
    localSkillImport.step = 1;
    localSkillImport.error = "";
    renderLocalSkillImport();
  }
  if (action === "view-imported-skill" && localSkillImport.installedSkillId) openPersonalSkillDetail(localSkillImport.installedSkillId);
  if (action === "use-imported-skill" && localSkillImport.installedSkillId) openNewConversationWithSkill(localSkillImport.installedSkillId);
  if (action === "cancel-skill-action-confirm") closeSkillActionConfirmation();
  if (action === "confirm-skill-action") confirmSkillAction();
  if (action === "close-installed-skill-editor") closeInstalledSkillEditor();
  if (action === "save-installed-skill-editor") saveInstalledSkillEditor();
  if (action === "choose-skill-source") chooseLocalSkillSource();
  if (action === "confirm-local-skill-install") installLocalSkill();
  if (action === "open-online-skills") openOnlineSkills();
  if (action === "close-online-skills") closeOnlineSkills();
  if (action === "manage-skills") {
    closeComposerMenu();
    showView("skills");
  }
  if (action === "cancel-skill-install-confirm") closeSkillInstallConfirmation();
  if (action === "confirm-online-skill-install" && pendingOnlineSkillConfirmation) {
    const pending = pendingOnlineSkillConfirmation;
    installOnlineSkill(pending.reference, pending.flags);
  }
  if (action === "task-confirm-cancel") {
    if (state.taskResult) {
      state.taskResult.cancelled = true;
      state.taskResult.statusText = "已取消，未覆盖原文件";
      state.taskResult.finished = true;
      saveState();
      render();
    }
    closeTaskConfirmModal();
  }
  if (action === "task-confirm-ok") {
    if (state.taskResult) {
      state.taskResult.confirmed = true;
      closeTaskConfirmModal();
      saveState();
      render();
      finalizeTaskResult();
    }
  }
  if (action === "computer-operation-deny") resolveComputerOperationConfirmation("deny");
  if (action === "computer-operation-allow") resolveComputerOperationConfirmation("allow-once");
  if (action === "copy-result") copyTaskResultText();
  if (action === "download-result") downloadTaskResult();
  if (action === "open-result-folder") openTaskResultFolder();
  if (action === "check-for-updates") checkForUpdatesFromSettings();
  if (action === "download-company-skill-template") downloadCompanySkillTemplate();
  if (action === "fill-company-skill-example") fillCompanySkillExample();
  if (action === "create-company-skill-package") createCompanySkillPackage(false);
  if (action === "save-company-skill-package") createCompanySkillPackage(true);
  if (action === "install-created-skill") installCreatedSkill();
  if (action === "choose-company-skill-package") chooseCompanySkillSource("file");
  if (action === "choose-company-skill-folder") chooseCompanySkillSource("folder");
  if (action === "submit-company-skill-review") submitCompanySkillReview();
  if (action === "refresh-company-skills") refreshCompanySkillData();
  if (action === "company-skill-fix-in-wizard") importCompanySkillDraftIntoWizard();
});

document.addEventListener("change", (event) => {
  const automationToggle = event.target.closest?.("[data-automation-toggle]");
  if (automationToggle) {
    toggleAutomation(automationToggle.dataset.automationToggle, automationToggle.checked);
    return;
  }
  const automationWeekday = event.target.closest?.("[data-automation-weekday]");
  if (automationWeekday && automationEditorDraft) {
    const day = Number(automationWeekday.dataset.automationWeekday);
    const selected = new Set(automationEditorDraft.weekdays || []);
    if (automationWeekday.checked) selected.add(day);
    else selected.delete(day);
    automationEditorDraft.weekdays = [...selected].sort((a, b) => a - b);
    renderAutomationEditorPage();
    return;
  }
  const automationField = event.target.closest?.("[data-automation-field]");
  if (automationField && automationEditorDraft) {
    automationEditorDraft[automationField.dataset.automationField] = automationField.value;
    if (automationField.dataset.automationField === "frequency") renderAutomationEditorPage();
    return;
  }
  const skillImportField = event.target.closest?.("[data-skill-import-field]");
  if (skillImportField) {
    const field = skillImportField.dataset.skillImportField;
    localSkillImport[field] = skillImportField.value;
    if (field === "reference") localSkillImport.inspection = null;
    localSkillImport.error = "";
    updateSkillImportActionState();
    return;
  }
  if (event.target.matches("[data-auto-update-check]")) {
    setAutoUpdateCheck(event.target.checked);
  }
});

document.addEventListener("compositionstart", (event) => {
  if (event.target?.matches?.("[data-skill-page-search]")) skillPageSearchComposing = true;
});

document.addEventListener("compositionend", (event) => {
  if (!event.target?.matches?.("[data-skill-page-search]")) return;
  skillPageSearchComposing = false;
  window.setTimeout(() => {
    if (event.target?.isConnected) commitSkillPageSearch(event.target);
  }, 0);
});

document.addEventListener("input", (event) => {
  if (event.target?.id === "skillImportTagInput") {
    filterSkillTagSuggestions(event.target, "import");
    return;
  }
  if (event.target?.id === "installedSkillTagInput") {
    filterSkillTagSuggestions(event.target, "installed");
    return;
  }
  const skillImportField = event.target.closest?.("[data-skill-import-field]");
  if (skillImportField) {
    const field = skillImportField.dataset.skillImportField;
    localSkillImport[field] = skillImportField.value;
    if (field === "reference") localSkillImport.inspection = null;
    localSkillImport.error = "";
    updateSkillImportActionState();
    return;
  }
  const promptLibraryArgument = event.target.closest?.("[data-prompt-library-argument]");
  if (promptLibraryArgument && promptLibraryState.activePrompt) {
    promptLibraryState.argumentValues[promptLibraryArgument.dataset.promptLibraryArgument] = promptLibraryArgument.value;
    const preview = els.pageContent.querySelector("[data-prompt-library-preview]");
    if (preview) preview.textContent = resolvedPromptLibraryPrompt(promptLibraryState.activePrompt);
    return;
  }
  const promptLibrarySearch = event.target.closest?.("[data-prompt-library-search]");
  if (promptLibrarySearch) {
    promptLibraryState.query = promptLibrarySearch.value.trim();
    promptLibraryState.page = 1;
    const clearButton = promptLibrarySearch.closest(".prompt-library-search")?.querySelector("[data-prompt-library-clear]");
    clearButton?.classList.toggle("hidden", !promptLibraryState.query);
    window.clearTimeout(promptLibrarySearchTimer);
    promptLibrarySearchTimer = window.setTimeout(() => {
      if (promptLibraryState.scope === "saved") renderPromptLibraryPage();
      else loadPromptLibrary();
    }, 320);
    return;
  }
  const automationPickerSearch = event.target.closest?.("[data-automation-picker-search]");
  if (automationPickerSearch && automationEditorDraft) {
    const field = automationPickerSearch.dataset.automationPickerSearch;
    automationPickerState = { open: field, query: automationPickerSearch.value };
    const options = automationPickerSearch.closest(".automation-picker-popover")?.querySelector("[data-automation-picker-options]");
    if (options) options.innerHTML = automationPickerOptionsHtml(field, automationEditorDraft[field], automationPickerState.query);
    return;
  }
  const automationField = event.target.closest?.("[data-automation-field]");
  if (automationField && automationEditorDraft) {
    automationEditorDraft[automationField.dataset.automationField] = automationField.value;
    return;
  }
  const companyDraftInput = event.target.closest?.("[data-company-draft]");
  if (companyDraftInput) {
    companySkillDraft[companyDraftInput.dataset.companyDraft] = companyDraftInput.value;
    saveCompanySkillDraft();
    return;
  }
  if (event.target === els.composerSkillSearch) {
    composerSkillQuery = event.target.value;
    renderComposerSkillMenu();
    return;
  }
  if (event.target.matches?.("[data-skill-page-search]")) {
    if (skillPageSearchComposing || event.isComposing) return;
    commitSkillPageSearch(event.target);
    return;
  }
  const input = event.target.closest("[data-search-input]");
  if (!input) return;
  state.searchQuery = input.value;
  const resultBox = document.getElementById("searchResults");
  if (resultBox) {
    resultBox.innerHTML = renderSearchResultsHtml();
  }
  saveState();
});

document.addEventListener("change", (event) => {
  if (event.target === els.skillAutoInstallSafe) {
    const inspection = localSkillImport.inspection;
    if (event.target.checked && inspection && !inspection.requiresRiskAcknowledgement && !inspection.requiresReplace) installLocalSkill();
    return;
  }
  const localAck = event.target.closest?.("[data-local-skill-ack]");
  if (localAck) {
    if (localAck.dataset.localSkillAck === "risk") localSkillImport.acknowledgeRisk = localAck.checked;
    if (localAck.dataset.localSkillAck === "replace") localSkillImport.replace = localAck.checked;
    renderLocalSkillImport();
    return;
  }
  if (event.target === els.skillInstallConfirmCheck) {
    els.skillInstallConfirmButton.disabled = !event.target.checked;
  }
});

els.chatForm.addEventListener("submit", handleSubmit);

els.chatForm.addEventListener("pointerdown", (event) => {
  if (event.target !== els.chatForm) return;
  event.preventDefault();
  els.promptInput.focus({ preventScroll: true });
  els.promptInput.setSelectionRange(els.promptInput.value.length, els.promptInput.value.length);
});

els.promptInput.addEventListener("input", () => {
  autoResizePrompt();
  const value = els.promptInput.value.trim();
  if (/^\/[^\s]*$/.test(value)) {
    composerSkillQuery = value.slice(1);
    if (els.composerMenu?.classList.contains("hidden")) els.composerMenu.classList.remove("hidden");
    renderComposerSkillMenu();
    fitComposerMenu();
  }
});

window.addEventListener("resize", () => {
  if (!els.composerMenu?.classList.contains("hidden")) fitComposerMenu();
  if (state.activeView === "prompt-library") updatePromptLibraryCategoryArrows();
});

els.onlineSkillSearchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  searchOnlineSkillLibrary(els.onlineSkillSearchInput?.value || "");
});

els.skillDropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!localSkillImport.installing) els.skillDropZone.classList.add("dragging");
});

els.skillDropZone?.addEventListener("dragleave", () => els.skillDropZone.classList.remove("dragging"));

els.skillDropZone?.addEventListener("drop", async (event) => {
  event.preventDefault();
  els.skillDropZone.classList.remove("dragging");
  if (localSkillImport.installing) return;
  const file = [...(event.dataTransfer?.files || [])][0];
  if (!file) return;
  let sourcePath = "";
  try { sourcePath = window.desktopBridge?.getPathForFile?.(file) || file.path || ""; } catch { sourcePath = file.path || ""; }
  if (!sourcePath) {
    localSkillImport = { ...localSkillImport, error: "无法读取拖拽路径，请点击上传选择技能。" };
    renderLocalSkillImport();
    return;
  }
  await inspectLocalSkill(sourcePath);
});

async function pasteClipboardAttachments(event) {
  const clipboardData = event.clipboardData;
  const files = [...(clipboardData?.files || [])].map(desktopFilePath).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    await addSelectedFiles(files);
    return true;
  }
  const types = [...(clipboardData?.types || [])];
  const hasFilePayload = types.includes("Files");
  if (hasFilePayload && window.desktopBridge?.readClipboardFiles) {
    event.preventDefault();
    const clipboardFiles = await window.desktopBridge.readClipboardFiles();
    if (clipboardFiles.length) {
      await addSelectedFiles(clipboardFiles);
      return true;
    }
  }
  const imageItem = [...(clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  const plainText = clipboardData?.getData("text/plain") || "";
  const shouldReadNativeImage = Boolean(imageItem) || (!plainText && !files.length);
  if (shouldReadNativeImage && window.desktopBridge?.saveClipboardImage) {
    event.preventDefault();
    try {
      const image = await window.desktopBridge.saveClipboardImage({ userId: state.session?.userId || "local-user" });
      await addSelectedFiles([image]);
      return true;
    } catch (error) {
      showToast(error.message || "图片粘贴失败");
    }
  }
  return false;
}

els.promptInput.addEventListener("paste", async (event) => {
  await pasteClipboardAttachments(event);
});

els.promptInput.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer?.items || []].some((item) => item.kind === "file")) event.preventDefault();
});

els.promptInput.addEventListener("drop", async (event) => {
  const files = [...event.dataTransfer.files].map(desktopFilePath).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  await addSelectedFiles(files);
});

els.pageContent.addEventListener("dragover", (event) => {
  if (!state.activeView.startsWith("skill-form:")) return;
  if ([...event.dataTransfer?.items || []].some((item) => item.kind === "file")) {
    event.preventDefault();
    els.pageContent.querySelector(".skill-attachment-picker")?.classList.add("dragging");
  }
});

els.pageContent.addEventListener("dragleave", (event) => {
  if (!state.activeView.startsWith("skill-form:")) return;
  if (!els.pageContent.contains(event.relatedTarget)) {
    els.pageContent.querySelector(".skill-attachment-picker")?.classList.remove("dragging");
  }
});

els.pageContent.addEventListener("drop", async (event) => {
  if (!state.activeView.startsWith("skill-form:")) return;
  const files = [...(event.dataTransfer?.files || [])].map(desktopFilePath).filter(Boolean);
  els.pageContent.querySelector(".skill-attachment-picker")?.classList.remove("dragging");
  if (!files.length) return;
  event.preventDefault();
  try {
    await addSelectedFiles(files);
  } catch (error) {
    showToast(error.message || "附件添加失败");
  }
});

els.pageContent.addEventListener("paste", async (event) => {
  if (!state.activeView.startsWith("skill-form:")) return;
  await pasteClipboardAttachments(event);
});

els.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.id === "skillImportTagInput") {
    event.preventDefault();
    addSkillImportCustomTag();
    return;
  }
  if (event.key === "Enter" && event.target.id === "installedSkillTagInput") {
    event.preventDefault();
    addInstalledSkillEditorCustomTag();
    return;
  }
  if (event.key === "Escape" && !els.skillActionConfirmModal?.classList.contains("hidden")) {
    event.preventDefault();
    closeSkillActionConfirmation();
    return;
  }
  const companyCategoryInput = event.target.closest?.("[data-company-category]");
  if (companyCategoryInput) {
    companySkillDraft.categoryId = companyCategoryInput.value;
    companySkillDraft.category = companyCategoryInput.selectedOptions?.[0]?.textContent?.trim() || "效率工具";
    saveCompanySkillDraft();
    return;
  }
  if (event.key === "Escape" && !els.installedSkillEditModal?.classList.contains("hidden")) {
    event.preventDefault();
    closeInstalledSkillEditor();
    return;
  }
  if (event.key === "Escape" && promptLibraryState.activePrompt) {
    event.preventDefault();
    closePromptLibraryDetail();
    return;
  }
  if (["Enter", " "].includes(event.key)) {
    const promptCard = event.target.closest?.("[data-prompt-library-id]");
    if (promptCard && !event.target.closest("button")) {
      event.preventDefault();
      openPromptLibraryDetail(promptCard.dataset.promptLibraryId);
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && state.activeView === "prompt-library") {
    event.preventDefault();
    els.pageContent.querySelector("[data-prompt-library-search]")?.focus();
    return;
  }
  if (event.key === "Escape" && automationPickerState.open) {
    event.preventDefault();
    const field = automationPickerState.open;
    closeAutomationPicker();
    document.querySelector(`[data-automation-picker-toggle="${field}"]`)?.focus();
    return;
  }
  const renameInput = event.target.closest?.("[data-conversation-rename-input]");
  if (renameInput && event.key === "Enter") {
    event.preventDefault();
    saveConversationRename(renameInput.dataset.conversationRenameInput);
    return;
  }
  if (renameInput && event.key === "Escape") {
    event.preventDefault();
    cancelConversationRename();
    return;
  }
  if (event.key === "Escape" && !els.computerOperationConfirmModal?.classList.contains("hidden")) {
    event.preventDefault();
    resolveComputerOperationConfirmation("deny");
    return;
  }
  if (event.key === "Escape" && !els.conversationDeleteModal?.classList.contains("hidden")) {
    event.preventDefault();
    closeConversationDelete();
    return;
  }
  if (event.key === "Escape" && !els.artifactPreviewModal?.classList.contains("hidden")) {
    event.preventDefault();
    closeArtifactPreview();
    return;
  }
  if (!els.artifactPreviewModal?.classList.contains("hidden") && artifactImagePreviewState) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setArtifactImageZoom(artifactImagePreviewState.zoom + 0.1);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      setArtifactImageZoom(artifactImagePreviewState.zoom - 0.1);
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createNewConversation();
  }
});

els.titlebar?.addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-window-action], button, input")) return;
  window.desktopBridge?.controlWindow?.("toggle-maximize");
});

hydrateSvgIcons();
window.desktopBridge?.getBuildFlavor?.().then(flavor => { const nav = document.getElementById("requirementNav"); if (nav) nav.hidden = !flavor.test; if (flavor.test) { document.title = flavor.name; const title = document.querySelector(".titlebar-name span"); if (title) title.textContent = flavor.name; const subtitle = document.querySelector(".brand-subtitle"); if (subtitle) subtitle.textContent = "测试版"; } }).catch(() => {});
render();
refreshRuntimeConfig();
autoResizePrompt();
window.desktopBridge?.onWindowStateChanged?.(renderWindowState);
window.desktopBridge?.getWindowState?.().then(renderWindowState).catch(() => {});
window.desktopBridge?.onSkillInstallProgress?.(handleSkillInstallProgress);
window.desktopBridge?.onCompanySkillProgress?.(handleCompanySkillProgress);
window.desktopBridge?.onChatCompletionChunk?.(applyChatCompletionChunk);
window.desktopBridge?.onGenerationProgress?.(applyGenerationProgress);
window.desktopBridge?.onComputerOperationConfirmation?.(queueComputerOperationConfirmation);
window.desktopBridge?.onComputerOperationStatus?.(handleComputerOperationStatus);
window.desktopBridge?.onRuntimeSetupProgress?.(updateRuntimeSetupStatus);
window.desktopBridge?.onUpdateStatus?.(handleUpdateStatus);
window.desktopBridge?.onAutomationUpdated?.(async (update) => {
  const currentUserId = state.session?.userId || "local-user";
  if (update?.userId && update.userId !== currentUserId) return;
  await refreshWorkData({ silent: true });
  if (state.activeView === "scheduled") renderScheduledPage();
});

window.addEventListener("resize", () => {
  if (artifactImagePreviewState && !els.artifactPreviewModal?.classList.contains("hidden")) fitArtifactPreviewImage();
});
refreshUpdateStatus();
window.desktopBridge?.getRuntimeSetupStatus?.().then(updateRuntimeSetupStatus).catch(() => {});
bootstrapAuth().then(() => {
  refreshInstalledSkills();
  hydrateConversationAttachments();
});
