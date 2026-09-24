const STORAGE_KEY = "centaur.desktop.chat.v3";
const GLOBAL_SESSION_KEY = "centaur.session";
const SKILL_BINDING_VERSION = 4;

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
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  pin: '<path d="m12 17-5 5"/><path d="m5 3 6.5 6.5"/><path d="M15 3 9 9l6 6 6-6"/>',
  "pin-off": '<path d="m3 3 18 18"/><path d="m12 17-5 5"/><path d="M15 3 9.8 8.2"/><path d="m13 11 2 4 3.2-3.2"/>',
  "more-horizontal": '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "circle-check": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  square: '<rect width="10" height="10" x="7" y="7" rx="1.5" fill="currentColor" stroke="none"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  "calendar-clock": '<path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h11"/><path d="M14 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8"/><circle cx="18" cy="17" r="4"/><path d="M18 15v2l1.5 1"/>',
  "folder-open": '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H7l-4 9Z"/>',
  "file-code": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 13 2 2-2 2"/>',
  "file-stack": '<path d="M7 3h10a2 2 0 0 1 2 2v10"/><path d="M5 6h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M7 11h6M7 15h6"/>',
  "file-audio": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M15 12v5.5a2.5 2.5 0 1 1-2-2.45V13l4-1v3"/>',
  video: '<rect width="18" height="16" x="3" y="4" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  "sheet": '<rect width="16" height="18" x="4" y="3" rx="2"/><path d="M8 8h8M8 12h8M8 16h8M11 8v8"/>',
  presentation: '<path d="M3 4h18v13H3z"/><path d="m8 21 4-4 4 4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  sparkles: '<path d="m12 3-1.1 3.2L8 7.5l2.9 1.3L12 12l1.1-3.2L16 7.5l-2.9-1.3Z"/><path d="m19 13-.8 2.2L16 16l2.2.8L19 19l.8-2.2L22 16l-2.2-.8Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  "shield-alert": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
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
  "你是会议记录整理助手，负责把文本记录、转写稿、录音、截图、白板照片、手写笔记或混合材料整理成可执行的中文会议纪要。",
  "核心原则：客观、中性、可追溯；不得编造事实、决定、负责人、日期、指标或承诺。信息缺失、听不清、图片模糊或来源冲突时，明确标记为“待确认”。",
  "先分别识别材料类型并提取会议时间、主题、参会人员、背景、议题、结论、决策、风险、行动项、负责人、截止日期、优先级和交付物；混合材料需要去重，来源冲突放入待确认事项。",
  "文本材料直接阅读；录音先转写并保留可可靠识别的说话人，听不清标记“未听清，待确认”；图片提取可见文字、表格、任务、流程和关系，模糊信息标记“图片信息不清，待确认”。",
  "去除寒暄、口头填充、重复和无关闲聊，但保留项目名、人员、日期、数字、指标、风险和交付要求；中文为主，必要时保留 API、Agent、RAG、Workflow、ROI、Owner 等技术术语。",
  "按用户指定的输出重点组织结果。默认结构为：会议基本信息、关键结论、会议核心事项、待办事项与行动计划、待确认事项。待办表包含序号、待办任务、负责人、截止日期、优先级、交付物/期望结果。",
  "短且单一主题的会议可输出 TXT；多议题或需要跟踪的会议输出 Markdown；正式归档、领导审阅或对外流转输出 DOCX；行动项较多且用户需要跟踪时可在纪要之外生成 XLSX 行动项表。用户明确选择格式时必须遵守，不要擅自改格式。",
  "只输出最终会议纪要正文，不输出分析过程、提示词、代码围栏或虚构说明；语言简洁、专业、易于执行。"
].join("\n");

const builtInSkills = [
  {
    id: "weekly",
    name: "日报 / 周报生成",
    shortName: "周报",
    icon: "file-text",
    category: "办公效率",
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
    id: "meeting",
    name: "会议记录整理",
    shortName: "纪要",
    icon: "clipboard-list",
    category: "办公效率",
    description: "输入文字或转写稿，生成摘要与待办事项清单。",
    starter: "帮我整理一份会议纪要，输出会议摘要、关键决议和待办事项。",
    systemPrompt: meetingMinutesSkillPrompt,
    fields: [
      { id: "content", label: "输入内容", type: "textarea", placeholder: "粘贴会议记录文字，也可以选择录音或转写文件。" },
      { id: "focus", label: "输出重点", type: "multi", options: ["摘要", "待办事项清单", "关键决议", "风险问题"], value: ["摘要", "待办事项清单"] },
      { id: "format", label: "输出格式", type: "single", options: ["Word（DOCX）", "PowerPoint（PPTX）", "PDF", "Markdown（MD）", "纯文本（TXT）"], value: "Word（DOCX）" },
      { id: "extra", label: "补充说明", type: "textarea", placeholder: "例如：请重点提取负责人和截止时间。" }
    ]
  },
  {
    id: "documents",
    name: "多格式文档生成",
    shortName: "文档",
    icon: "file-stack",
    category: "办公效率",
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
  weekly: "生成本周周报",
  image: "帮我把这批图片去背景",
  copywriting: "润色一段文案，语气更正式一点",
  meeting: "整理今天的会议记录",
  documents: "生成一份多格式项目文档"
};

const scheduledTasks = [
  {
    id: "weekly-report",
    name: "每周一 09:00 自动生成上周周报",
    description: "已安排 · 运营部 · 使用日报 / 周报生成",
    skillId: "weekly",
    status: "启用中"
  },
  {
    id: "meeting-notes",
    name: "每次周会后整理会议纪要",
    description: "已安排 · 运营部 · 使用会议记录整理",
    skillId: "meeting",
    status: "待接入"
  }
];

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
    userMsg: "整理今天的会议记录",
    historyTitle: "周会会议记录整理",
    steps: ["正在读取会议记录…", "正在生成摘要…", "正在整理待办事项…"],
    needsConfirm: false,
    resultTitle: "会议记录整理已完成",
    resultBody: "已生成会议摘要，并提取 5 项待办事项，标注了负责人与截止时间（示例内容）。",
    resultType: "document",
    downloadLabel: "下载文件"
  }
};

const forceAuthPreview = !window.desktopBridge && new URLSearchParams(window.location.search).has("auth");
const initialSession = window.desktopBridge || forceAuthPreview
  ? null
  : { userId: "browser-preview", name: "演示用户", method: "preview", loginAt: new Date().toISOString() };
const state = loadState(initialSession?.userId || "anonymous", initialSession);
const pendingChatStreams = new Map();
const pendingConversationRequests = new Map();
const pendingTaskPersistence = new Map();
let sessionGeneration = 0;
let streamRenderQueued = false;
let openConversationMenuId = null;
let renamingConversationId = null;
let deletingConversationId = null;
let currentArtifactPreview = null;
let pendingArtifactOutput = null;
let composerSkillQuery = "";
let localSkillImport = { sourcePath: "", inspection: null, loading: false, installing: false, error: "" };
let onlineSkillLibrary = { query: "", results: [], filteredCount: 0, preflightPendingCount: 0, loading: false, error: "", loaded: false };
const onlineSkillInstallRefs = new Set();
let pendingOnlineSkillConfirmation = null;

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
    .replace(sourceNamePattern, "先马·Centaur")
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
      : (state.activeView === nav || (nav === "skills" && state.activeView.startsWith("skill-form:")));
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
  if (state.activeView === "skills") {
    renderSkillsPage();
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

function renderSkillsPage() {
  const query = state.searchQuery.trim().toLowerCase();
  const visibleSkills = query
    ? skills.filter((skill) => [skill.name, skill.description, skill.category, skill.slug].some((value) => String(value || "").toLowerCase().includes(query)))
    : skills;
  els.pageContent.innerHTML = `
    ${renderPageHeader("技能", "选择内置技能，或添加自己的本地和在线技能。", `<span class="page-header-actions"><button class="secondary-button page-header-action" type="button" data-action="open-online-skills">${iconSvg("globe")}<span>在线技能库</span></button><button class="primary-button page-header-action" type="button" data-action="open-skill-import">${iconSvg("upload")}<span>从本地添加</span></button></span>`)}
    <div class="skills-page-tip">技能最好在对话中使用，部分在线skill由于skill限制需要多轮对话，才能产生合适的结果。</div>
    <div class="page-search">
      <span class="search-symbol">${iconSvg("search")}</span>
      <input type="text" placeholder="搜索技能" data-skill-page-search value="${escapeHtml(state.searchQuery)}">
    </div>
    <div class="section-title">${query ? `找到 ${visibleSkills.length} 个技能` : (skills.some((skill) => skill.installed) ? "全部技能" : "常用技能")}</div>
    <div class="skill-grid">
      ${visibleSkills.length ? visibleSkills.map(renderSkillCard).join("") : `<div class="skills-empty">没有匹配的技能</div>`}
    </div>
  `;
}

function renderSkillCard(skill) {
  return `
    <article class="skill-card">
      <div class="skill-card-top">
        <div class="skill-icon">${iconSvg(skill.icon)}</div>
        <div>
          <div class="skill-card-name">${escapeHtml(skill.name)}</div>
          <div class="skill-card-desc">${escapeHtml(skill.description)}</div>
        </div>
      </div>
      <div class="skill-card-footer">
        <span class="skill-card-meta"><span>${escapeHtml(skill.category)}</span>${skill.installed ? `<span class="skill-source-badge">${escapeHtml(skill.sourceLabel || "本地技能")}</span>` : ""}</span>
        <span class="skill-card-actions">
          ${skill.userInvocable === false ? `<span class="skill-auto-label">自动调用</span>` : `<button type="button" data-open-skill-form="${escapeHtml(skill.id)}">使用</button>`}
          ${skill.installed ? `<button class="skill-remove-button" type="button" data-remove-installed-skill="${escapeHtml(skill.id)}" title="卸载技能" aria-label="卸载技能">${iconSvg("trash-2")}</button>` : ""}
        </span>
      </div>
    </article>
  `;
}

function renderSearchPage() {
  els.pageContent.innerHTML = `
    ${renderPageHeader("搜索", "搜索技能、历史任务与已安排任务。")}
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
      action: `data-open-skill-form="${escapeHtml(skill.id)}"`
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
      type: "已安排",
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
    renderResultGroup("已安排", scheduledResults)
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
  return Array.isArray(state.scheduledTasks) && state.scheduledTasks.length ? state.scheduledTasks : scheduledTasks;
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
  els.artifactPreviewModal?.classList.add("hidden");
  if (els.artifactPreviewContent) els.artifactPreviewContent.innerHTML = "";
}

function showArtifactPreview(result) {
  if (!result || result.previewType === "window") {
    showToast("已在应用内打开预览");
    return;
  }
  currentArtifactPreview = result;
  els.artifactPreviewTitle.textContent = result.name || "文件预览";
  if (result.previewType === "image") {
    els.artifactPreviewContent.innerHTML = `<img class="artifact-preview-image" src="${escapeHtml(result.dataUrl)}" alt="${escapeHtml(result.name || "图片预览")}">`;
  } else if (result.previewType === "media") {
    const mediaTag = result.mediaType === "audio" ? "audio" : "video";
    els.artifactPreviewContent.innerHTML = `
      <div class="artifact-preview-media-wrap">
        <${mediaTag} class="artifact-preview-media" src="${escapeHtml(result.url)}" controls preload="metadata"></${mediaTag}>
        <strong>${escapeHtml(result.name || "媒体文件")}</strong>
        <span>${escapeHtml([fileKindLabel(result), formatFileBytes(result.bytes)].filter(Boolean).join(" · "))}</span>
      </div>
    `;
  } else if (result.previewType === "text") {
    els.artifactPreviewContent.innerHTML = `<pre class="artifact-preview-text">${escapeHtml(result.content || "")}</pre>`;
  } else {
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
    if (!result?.canceled) showToast(`已保存到 ${baseName(result.path)}`);
  } catch (error) {
    showToast(error.message || "下载失败");
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

function renderScheduledPage() {
  const backendScheduledTasks = getScheduledTasks();
  const recentRuns = getTaskRuns().slice(0, 6);
  els.pageContent.innerHTML = `
    ${renderPageHeader("已安排", "查看周期任务、自动化安排和最近生成结果。")}
    <div class="scheduled-list">
      ${backendScheduledTasks.map((task) => {
        const skill = skills.find((item) => item.id === task.skillId);
        return `
          <article class="scheduled-card">
            <div class="scheduled-main">
              <div class="scheduled-icon">${iconSvg(skill?.icon || "calendar-clock")}</div>
              <div>
                <div class="scheduled-title">${escapeHtml(task.name)}</div>
                <div class="scheduled-desc">${escapeHtml(task.description)}</div>
              </div>
            </div>
            <div class="scheduled-actions">
              <span class="status-pill">${escapeHtml(task.status)}</span>
              <button type="button" data-open-skill-form="${escapeHtml(task.skillId)}">使用此技能</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
    ${recentRuns.length ? `
      <div class="section-title">最近结果</div>
      <div class="result-list">
        ${recentRuns.map((task) => `
          <button class="result-item" type="button" data-open-task-run="${escapeHtml(task.id)}">
            <span class="result-icon">${iconSvg("circle-check")}</span>
            <span class="result-copy">
              <span class="result-title">${escapeHtml(task.title)}</span>
              <span class="result-desc">${escapeHtml(previewText(task.description || task.status))}</span>
            </span>
            <span class="result-type">${escapeHtml(task.status || "已完成")}</span>
          </button>
        `).join("")}
      </div>
    ` : ""}
    <div class="empty-note">任务记录保存在当前用户的本地数据目录中；周期调度和审批能力可在后续接入企业服务时启用。</div>
  `;
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
      <div class="skill-attachment-limit">技能输入不设置文件大小上限。大型文件会保留在本机，并按绝对路径交给技能处理；系统仍会检查文件数量、路径安全和技能风险。</div>
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
  return `
    <div class="skill-field" data-form-field="${escapeHtml(field.id)}" data-field-type="${escapeHtml(field.type)}" data-field-label="${escapeHtml(field.label)}">
      <span>${escapeHtml(field.label)}</span>
      <div class="option-row" ${field.type === "single" ? "data-single" : ""}>
        ${field.options.map((option) => `
          <button class="option-pill ${values.includes(option) ? "selected" : ""}" type="button" data-option-pill>
            ${escapeHtml(option)}
          </button>
        `).join("")}
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
  els.starterGrid.innerHTML = skills.map((skill) => `
    <button class="starter-button" type="button" data-starter-skill="${skill.id}" data-starter-prompt="${escapeHtml(skill.starter)}">
      <span class="starter-icon">${iconSvg(skill.icon)}</span>
      <span class="starter-title">${escapeHtml(starterLabels[skill.id] || skill.starter.replace(/[。.]$/, ""))}</span>
      <span class="starter-arrow">${iconSvg("chevron-right")}</span>
    </button>
  `).join("");
}

function renderMessage(message) {
  const skill = skills.find((item) => item.id === message.skillId);
  const label = message.role === "user" ? currentUserName() : "先马·Centaur";
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
  return `
    <article class="message ${message.role} ${loadingClass} ${pendingClass}">
      <div class="message-label">${escapeHtml(label)}</div>
      <div class="message-bubble ${richContent ? "rich-content" : ""}">${messageContent}</div>
      ${renderMessageAttachments(message)}
      ${imageGrid}
      ${fileCards}
      ${(skillMeta || attachmentMeta) ? `<div class="message-meta">${skillMeta}${attachmentMeta}</div>` : ""}
    </article>
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
    return `
      <span class="attachment-chip attachment-chip-rich">
        ${isImage && item.previewDataUrl ? `<img src="${escapeHtml(item.previewDataUrl)}" alt="">` : iconSvg(isImage ? "image" : "paperclip")}
        <span>${escapeHtml(item.name || baseName(item.path))}</span>
        <button type="button" data-remove-file="${index}" aria-label="移除附件">${iconSvg("x")}</button>
      </span>
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

function renderModelPicker() {
  if (!els.modelPicker || !els.modelButton || !els.modelDropdown) return;
  const options = Array.isArray(state.modelOptions) && state.modelOptions.length
    ? state.modelOptions
    : [{ label: state.config.model || "默认模型", value: state.config.model || "gpt-5.6-sol" }];
  const selected = options.find((item) => item.value === state.config.model) || options[0];
  state.config.model = selected.value;
  els.modelButton.innerHTML = `<span>${escapeHtml(selected.label)}</span><span class="model-arrow">${iconSvg("chevron-down")}</span>`;
  els.modelDropdown.innerHTML = options.map((item) => `
    <button class="model-option ${item.value === selected.value ? "selected" : ""}" type="button" data-model-value="${escapeHtml(item.value)}">
      <span>${escapeHtml(item.label)}</span>${item.value === selected.value ? `<span class="model-check">${iconSvg("check")}</span>` : ""}
    </button>
  `).join("");
}

function renderComposerSkillMenu() {
  if (!els.composerSkillList) return;
  const query = composerSkillQuery.trim().toLowerCase();
  const available = skills.filter((skill) => skill.userInvocable !== false);
  const visible = query
    ? available.filter((skill) => [skill.name, skill.description, skill.category, skill.slug].some((value) => String(value || "").toLowerCase().includes(query)))
    : available;
  els.composerSkillList.innerHTML = visible.length
    ? visible.map((skill) => `
      <button class="composer-skill-option ${activeConversation()?.skillId === skill.id ? "selected" : ""}" type="button" data-menu-skill="${escapeHtml(skill.id)}">
        <span class="composer-skill-icon">${iconSvg(skill.icon || "file-stack")}</span>
        <span class="composer-skill-copy"><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span>
        ${activeConversation()?.skillId === skill.id ? `<span class="composer-skill-check">${iconSvg("check")}</span>` : ""}
      </button>
    `).join("")
    : `<div class="composer-skill-empty">没有匹配的技能</div>`;
  if (els.composerSkillSearch && els.composerSkillSearch.value !== composerSkillQuery) els.composerSkillSearch.value = composerSkillQuery;
}

function toggleModelPicker() {
  els.modelDropdown?.classList.toggle("open");
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
  localSkillImport = { sourcePath: "", inspection: null, loading: false, installing: false, error: "", acknowledgeRisk: false, replace: false };
  if (els.skillAutoInstallSafe) els.skillAutoInstallSafe.checked = false;
}

function openLocalSkillImport() {
  closeComposerMenu();
  resetLocalSkillImport();
  els.skillImportModal?.classList.remove("hidden");
  renderLocalSkillImport();
}

function closeLocalSkillImport() {
  if (localSkillImport.installing) return;
  els.skillImportModal?.classList.add("hidden");
  resetLocalSkillImport();
}

function renderLocalSkillImport() {
  if (!els.skillImportDetails || !els.skillImportInstallButton || !els.skillImportStatus) return;
  const inspection = localSkillImport.inspection;
  const skill = inspection?.skill;
  els.skillDropZone?.classList.toggle("loading", localSkillImport.loading);
  if (!skill) {
    els.skillImportDetails.classList.add("hidden");
    els.skillImportDetails.innerHTML = "";
  } else {
    const riskItems = Array.isArray(skill.riskItems) ? skill.riskItems : [];
    els.skillImportDetails.classList.remove("hidden");
    els.skillImportDetails.innerHTML = `
      <div class="skill-inspection-heading">
        <span class="skill-icon">${iconSvg(skill.icon || "file-stack")}</span>
        <span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span>
        <span class="skill-risk-badge ${escapeHtml(skill.riskLevel || "low")}">${escapeHtml(skillRiskLabel(skill.riskLevel))}</span>
      </div>
      <div class="skill-inspection-meta">
        <span>${escapeHtml(String(skill.fileCount || 0))} 个文件</span>
        <span>${escapeHtml(formatFileBytes(skill.totalBytes || 0))}</span>
        <span title="${escapeHtml(localSkillImport.sourcePath)}">${escapeHtml(baseName(localSkillImport.sourcePath))}</span>
      </div>
      ${riskItems.length ? `<ul class="skill-risk-list">${riskItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${inspection.requiresRiskAcknowledgement ? `<label class="check-row skill-confirm-row"><input type="checkbox" data-local-skill-ack="risk" ${localSkillImport.acknowledgeRisk ? "checked" : ""}><span>我已核对来源并确认安装此高风险技能</span></label>` : ""}
      ${inspection.requiresReplace ? `<label class="check-row skill-confirm-row"><input type="checkbox" data-local-skill-ack="replace" ${localSkillImport.replace ? "checked" : ""}><span>覆盖当前用户已安装的同名技能</span></label>` : ""}
    `;
  }
  const needsRisk = Boolean(inspection?.requiresRiskAcknowledgement && !localSkillImport.acknowledgeRisk);
  const needsReplace = Boolean(inspection?.requiresReplace && !localSkillImport.replace);
  els.skillImportInstallButton.disabled = !inspection || localSkillImport.loading || localSkillImport.installing || needsRisk || needsReplace;
  els.skillImportInstallButton.textContent = localSkillImport.installing ? "正在安装..." : (inspection?.requiresReplace ? "覆盖并安装" : "安装技能");
  els.skillImportStatus.textContent = localSkillImport.loading
    ? "正在检查技能格式和风险..."
    : (localSkillImport.installing ? "正在安装到当前用户的本地技能库..." : (localSkillImport.error || ""));
  els.skillImportStatus.classList.toggle("error", Boolean(localSkillImport.error));
}

async function inspectLocalSkill(sourcePath) {
  if (!sourcePath || !window.desktopBridge?.inspectSkillSource) return;
  localSkillImport = { ...localSkillImport, sourcePath, inspection: null, loading: true, error: "", acknowledgeRisk: false, replace: false };
  renderLocalSkillImport();
  try {
    const inspection = await window.desktopBridge.inspectSkillSource({ userId: state.session?.userId || "local-user", sourcePath });
    localSkillImport = { ...localSkillImport, inspection, loading: false, error: "" };
    renderLocalSkillImport();
    if (els.skillAutoInstallSafe?.checked && !inspection?.requiresRiskAcknowledgement && !inspection?.requiresReplace) {
      await installLocalSkill();
    }
  } catch (error) {
    localSkillImport = { ...localSkillImport, loading: false, error: scrubInternalTerms(error.message || "技能包检查失败") };
    renderLocalSkillImport();
  }
}

async function chooseLocalSkillSource(sourceType = "file") {
  try {
    const selector = sourceType === "folder"
      ? window.desktopBridge?.selectSkillFolder
      : window.desktopBridge?.selectSkillFile;
    const result = selector
      ? await selector()
      : await window.desktopBridge?.selectSkillSource?.({ sourceType });
    if (!result || result.canceled || !result.sourcePath) return;
    await inspectLocalSkill(result.sourcePath);
  } catch (error) {
    localSkillImport = { ...localSkillImport, error: scrubInternalTerms(error.message || "技能来源选择失败") };
    renderLocalSkillImport();
  }
}

async function installLocalSkill() {
  if (!localSkillImport.inspection || localSkillImport.installing) return;
  localSkillImport = { ...localSkillImport, installing: true, error: "" };
  renderLocalSkillImport();
  try {
    const skillName = localSkillImport.inspection?.skill?.name || "新技能";
    const result = await window.desktopBridge?.installSkill?.({
      userId: state.session?.userId || "local-user",
      sourcePath: localSkillImport.sourcePath,
      acknowledgeRisk: localSkillImport.acknowledgeRisk,
      replace: localSkillImport.replace,
      skillName,
      background: true
    });
    if (result?.queued) {
      localSkillImport = { ...localSkillImport, installing: false };
      closeLocalSkillImport();
      showToast(`技能“${skillName}”已开始后台安装`);
      return;
    }
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
    localSkillImport = { ...localSkillImport, installing: false };
    await refreshInstalledSkills();
    closeLocalSkillImport();
    showToast(`技能“${result.skill?.name || "新技能"}”已安装`);
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

function createNewConversation() {
  const conversation = createConversation("新的对话");
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
  if (state.activeView.startsWith("skill-form:") && view !== state.activeView) {
    state.selectedFiles = [];
  }
  state.activeView = view || "chat";
  if (state.activeView !== "chat") pendingArtifactOutput = null;
  if (view !== "task-result") {
    state.taskResult = null;
  }
  saveState();
  render();
  if (state.activeView === "chat") {
    focusPrompt();
  }
}

function openSkillForm(skillId) {
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return;
  if (state.activeView !== `skill-form:${skill.id}`) state.selectedFiles = [];
  state.activeView = `skill-form:${skill.id}`;
  state.taskResult = null;
  saveState();
  render();
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
  const focus = valueByLabel.get("输出重点") || "摘要、待办事项清单";
  const format = documentFormatFromLabel(valueByLabel.get("输出格式") || "Word（DOCX）");
  const extra = valueByLabel.get("补充说明") || "";
  const attachments = attachmentPathList(state.selectedFiles);
  if (!content && !attachments.length) {
    showToast("请填写会议记录，或选择一个转写/记录文件");
    els.pageContent.querySelector('[data-form-field="content"] textarea')?.focus();
    return;
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const title = `会议纪要-${stamp}`;
  startLocalSkillResult({
    skill,
    format,
    title,
    userMsg: `整理会议记录：${title}`,
    historyTitle: `${title}生成`,
    resultBody: `已在技能页面生成 ${format.toUpperCase()} 会议纪要，重点包含：${focus}；不明确的信息已标记为待确认。`,
    resultText: [
      "会议纪要",
      `整理重点：${focus}`,
      content,
      attachments.length ? `附件素材：${attachments.map(baseName).join("、")}` : "",
      extra ? `补充说明：${extra}` : ""
    ].filter(Boolean).join("\n\n"),
    contentPrompt: [
      meetingMinutesSkillPrompt,
      `用户选择的输出重点：${focus}`,
      `用户选择的输出格式：${valueByLabel.get("输出格式") || "Word（DOCX）"}`,
      extra ? `用户补充说明：\n${extra}` : "",
      content ? `会议原始文字：\n${content}` : "会议文字已通过附件提供，请先读取附件。",
      attachments.length ? `会议材料附件路径：\n${attachments.join("\n")}` : ""
    ].filter(Boolean).join("\n\n"),
    selectedFiles: attachments,
    useFullAgent: attachments.length > 0,
    relativePath: `meeting/${stamp}-${title}.${format}`,
    steps: ["正在读取技能页输入内容…", "正在整理会议纪要结构…", `正在生成 ${format.toUpperCase()} 文件…`]
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
  state.activeView = "task-result";
  state.taskResult = {
    id: createId("task"),
    skillId: skill.id,
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
      value = [...field.querySelectorAll("[data-option-pill].selected")]
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
    saveState();
    render();
    return;
  }

  if (result.persisted) {
    result.finished = true;
    result.statusText = "已完成";
    saveState();
    render();
    return;
  }

  // File-producing skills get a quick draft; conversational skills only show
  // the model result and must not create a placeholder document.
  let draftPromise = null;
  if (result.useModel && result.persistArtifacts !== false && !result.prepared && window.desktopBridge?.createTaskResult) {
    result.statusText = "正在生成可用初稿…";
    saveState();
    render();
    draftPromise = window.desktopBridge.createTaskResult({
      ...result,
      userId: state.session?.userId || "local-user",
      resultBody: "初稿已生成，正在继续整理最终内容。",
      selectedFiles: attachmentPathList(result.selectedFiles)
    }).then((draft) => {
      if (state.taskResult?.id !== resultId) return draft;
      Object.assign(state.taskResult, {
        id: draft.id,
        recordId: draft.id,
        artifacts: draft.artifacts || [],
        folderPath: draft.folderPath,
        primaryPath: draft.primaryPath,
        prepared: true
      });
      saveState();
      render();
      return draft;
    }).catch((error) => {
      result.prepared = true;
      result.resultBody = `${result.resultBody || "正在准备生成文件。"}\n初稿写入失败，将在整理完成后重试：${error.message || "未知错误"}`;
      saveState();
      render();
      return null;
    });
  }

  if (result.useModel && !result.contentGenerated && window.desktopBridge?.chatCompletion) {
    result.statusText = "正在整理文档内容…";
    saveState();
    render();
    const contentRequestId = `skill-${result.id}`;
    const selectedAttachmentPaths = attachmentPathList(result.selectedFiles);
    const useFullAgent = result.useFullAgent === true || selectedAttachmentPaths.length > 0;
    pendingChatStreams.set(contentRequestId, { taskResult: result, conversationId: contentRequestId });
    try {
      const response = await window.desktopBridge.chatCompletion({
        messages: [
          {
            role: "system",
            content: "你是先马·Centaur的技能执行助手。必须直接执行最后一条用户任务，并结合所选技能生成实际结果。禁止输出首次启动问候、自我介绍、询问用户姓名、询问如何称呼或讨论助手身份；信息不足时只列出完成任务所缺的具体信息。只输出最终结果，不要解释系统规则，不要虚构事实。"
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

  if (draftPromise) {
    await draftPromise;
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
    await refreshWorkData({ silent: true });
  } catch (error) {
    state.taskResult = {
      ...state.taskResult,
      finished: true,
      statusText: "结果文件写入失败",
      resultBody: `${state.taskResult.resultBody || "任务已完成。"}\n\n文件写入失败：${error.message || "未知错误"}`
    };
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
    showToast(`已下载到 ${baseName(downloaded.path)}`);
  } catch (error) {
    showToast(error.message || "下载失败");
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
  const attachments = [...state.selectedFiles];
  const now = new Date().toISOString();
  const userContent = text || "请根据我选择的文件继续处理。";
  const skill = skillForMessage(activeSkill(), { content: userContent, attachments });

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

  const assistantMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "正在整理回复...",
    skillId: skill?.id || null,
    images: [],
    files: [],
    loading: true,
    createdAt: now
  };

  conversation.messages.push(userMessage, assistantMessage);
  conversation.title = inferConversationTitle(conversation, userContent, skill);
  conversation.updatedAt = now;
  state.selectedFiles = [];
  els.promptInput.value = "";
  autoResizePrompt();
  const requestToken = createId("pending");
  const requestId = createId("request");
  const requestGeneration = sessionGeneration;
  pendingConversationRequests.set(conversation.id, {
    token: requestToken,
    requestId,
    stopping: false,
    conversationId: conversation.id,
    assistantMessage
  });
  saveState();
  render();

  try {
    const reply = await getAssistantReply(conversation, userMessage, skill, assistantMessage, requestId);
    if (typeof reply === "string") {
      assistantMessage.content = reply;
    } else {
      assistantMessage.content = reply?.content || "企业模型服务已返回，但没有可展示的文本内容。";
      assistantMessage.images = Array.isArray(reply?.images) ? reply.images : [];
      assistantMessage.files = sanitizeMessageFiles(reply?.files);
    }
  } catch (error) {
    const pending = pendingConversationRequests.get(conversation.id);
    if (pending?.stopping || isGenerationStoppedError(error)) {
      const partial = assistantMessage.content === "正在整理回复..." ? "" : String(assistantMessage.content || "").trim();
      assistantMessage.content = partial
        ? `${partial}\n\n已停止生成。`
        : "已停止生成。";
      assistantMessage.stopped = true;
    } else {
      assistantMessage.content = buildErrorReply(error);
    }
  } finally {
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
      window.desktopBridge?.notify?.("先马·Centaur", `“${conversation.title}”已完成`).catch(() => {});
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
  if (Array.isArray(userMessage?.attachments) && userMessage.attachments.length) return true;
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
  if (attachments.some((file) => file.kind !== "image")) return true;
  if (activeSkill()?.installed && attachments.length) return true;
  if (!text) return false;

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

function isGeneralKnowledgeQuestion(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  const asksForAnswer = /(?:是什么|什么是|怎么回事|为什么|多少|几号|哪天|哪里|在哪|谁是|何时|什么时候|怎么样|如何|吗[？?]?$)/.test(value);
  const factualTopic = /(?:天气|气温|温度|空气质量|首都|时间|日期|星期|汇率|路况|位置|定义|含义|信息)/.test(value);
  const explicitWork = /(?:生成|创建|制作|整理|改写|润色|处理|提取|总结|翻译|根据附件|调用|使用.*技能|按.*技能)/.test(value);
  return factualTopic && (asksForAnswer || value.length < 40) && !explicitWork;
}

function skillForMessage(skill, userMessage) {
  if (!skill) return null;
  if (attachmentPathList(userMessage?.attachments).length) return skill;
  return isGeneralKnowledgeQuestion(userMessage?.content) ? null : skill;
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
  if (!requestId || progress?.type !== "image") return;
  for (const pending of pendingConversationRequests.values()) {
    if (String(pending?.requestId || "") !== requestId || !pending.assistantMessage) continue;
    const assistantMessage = pending.assistantMessage;
    if (Array.isArray(progress.images) && progress.images.length) {
      assistantMessage.images = progress.images;
      assistantMessage.content = progress.message || "图片已返回，正在保存本地文件…";
      if (state.activeConversationId === pending.conversationId) renderMessages();
    }
    break;
  }
}

async function getAssistantReply(conversation, userMessage, skill, assistantMessage, requestId) {
  const requestSkill = skillForMessage(skill, userMessage);
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
    const useFullAgent = shouldUseFullAgentCapabilities(conversation, userMessage);
    const imagePaths = resolveConversationImagePaths(conversation, userMessage);
    if (!useFileCapabilities && !useFullAgent) {
      pendingChatStreams.set(requestId, {
        conversationId: conversation.id,
        message: assistantMessage
      });
    }
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
        preferGateway: useFullAgent,
        waitForGateway: useFullAgent,
        enableFileTools: useFileCapabilities || useFullAgent,
        stream: !useFileCapabilities && !useFullAgent,
        requestId
      });
      return {
        content: result?.content || "企业模型服务已返回，但没有可展示的文本内容。",
        files: sanitizeMessageFiles(result?.files)
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
  if (state.config.model === "gpt-image-2" && !isGeneralKnowledgeQuestion(text)) return true;

  const explicitImageIntent = /(生成|画|绘制|做一张|做个|出一张|出图|文生图|create|generate|draw).*(图|图片|照片|海报|插画|image|photo|poster)/i.test(text);
  const imageSkillIntent = skill?.id === "image" && /(生成|画|绘制|做一张|出图|文生图|create|generate|draw)/i.test(text);
  const imageEditIntent = /(修改|调整|编辑|处理|重做|换|替换|移除|去掉|增加|添加|改成|变成|扩图|抠图|去背景|加水印).*(图|图片|照片|海报|背景|颜色|尺寸|风格|人物|文字)|(?:这张|刚才|上一张|上张).*(修改|调整|编辑|处理|换|去掉|增加|改成)/i.test(text);
  const hasReusableImage = Boolean(resolveConversationImagePaths(conversation, userMessage).length);
  return explicitImageIntent || imageSkillIntent || (imageEditIntent && (hasImageAttachment || hasReusableImage));
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
    "你是先马·Centaur的桌面对话助手。",
    "当前产品是企业桌面智能工作台，回答使用中文，表达清晰、务实。",
    "回答排版要清晰工整：使用简短标题、短段落和有序列表，层次不超过三级；不要堆砌装饰符号，不要把 #、* 等 Markdown 源标记当作普通文字展示。",
    "不要提及任何底层平台、开源项目、封装来源或内部实现来源；统一以先马·Centaur和企业模型服务来表述。",
    "每个对话都可以直接使用文件读写、目录查看、命令运行和 HTML 网页预览能力，不需要切换到其他页面或模式。",
    "用户要求或明显意图创建、修改、运行文件时，应实际调用工具完成，并在回复中引用工具返回的绝对路径；用户要求运行网页时，应写入 HTML 并打开客户端预览。不要声称当前会话无法创建文件，不要要求用户手工创建文件。",
    artifactOutput?.relativePath
      ? `本轮使用快速文件生成：请直接输出完整可用内容，应用会自动保存到 ${artifactOutput.relativePath}。${artifactOutput.format === "html" ? "网页必须在一个完整 html 代码块中返回，包含所需 CSS 和 JavaScript。" : "代码类内容请放在一个完整代码块中；文档类内容直接输出完整正文。"}`
      : "",
    "遇到覆盖已有文件、删除文件、外部发送、安装软件或其他高风险动作，先说明风险并等待用户确认。",
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
    return `${fallbackLine}收到。我会先按普通对话处理你的需求，并把它放在先马·Centaur的桌面工作台里。\n\n当前可以继续追问、补充上下文，或从左侧选择周报、图片处理、文案润色、会议纪要这几个技能。${attachmentLine}`;
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

  return `${fallbackLine}我已进入“会议纪要”上下文。整理时会按下面结构输出：\n\n会议摘要：用几句话说明讨论范围和结论。\n关键决议：列出已经确定的事项。\n待办事项：包含负责人、截止时间和当前状态。\n待补充信息：标出会议记录里缺失但影响执行的信息。\n\n把会议文字、录音转写或截图内容发过来即可继续。${attachmentLine}`;
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
    const allowUnlimited = state.activeView.startsWith("skill-form:");
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
    const allowUnlimited = state.activeView.startsWith("skill-form:");
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
  const saved = parseJson(localStorage.getItem(getStorageKey(session.userId)));
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
  els.toast.textContent = message;
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
  localSkillImport = {
    sourcePath: progress.sourcePath || "",
    inspection,
    loading: false,
    installing: false,
    error: inspection.requiresRiskAcknowledgement ? "请先确认技能风险后再安装。" : "同名技能已存在，请确认是否覆盖。",
    acknowledgeRisk: progress.flags?.acknowledgeRisk === true,
    replace: progress.flags?.replace === true
  };
  els.skillImportModal?.classList.remove("hidden");
  renderLocalSkillImport();
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

document.addEventListener("click", (event) => {
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
    window.desktopBridge?.removeInstalledSkill?.({ userId: state.session?.userId || "local-user", skillId })
      .then(() => refreshInstalledSkills())
      .catch((error) => showToast(error.message || "技能卸载失败"));
    return;
  }

  const installOnlineSkillButton = event.target.closest("[data-install-online-skill]");
  if (installOnlineSkillButton) {
    installOnlineSkill(installOnlineSkillButton.dataset.installOnlineSkill);
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
  if (action === "show-view") showView(actionButton.dataset.view);
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
  if (action === "open-prompt-library") window.desktopBridge?.openPromptLibrary?.().catch((error) => showToast(error.message || "提示词库打开失败"));
  if (action === "open-skill-import" || action === "install-skill") openLocalSkillImport();
  if (action === "close-skill-import") closeLocalSkillImport();
  if (action === "choose-skill-file") chooseLocalSkillSource("file");
  if (action === "choose-skill-folder") chooseLocalSkillSource("folder");
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
  if (action === "copy-result") copyTaskResultText();
  if (action === "download-result") downloadTaskResult();
  if (action === "open-result-folder") openTaskResultFolder();
});

document.addEventListener("input", (event) => {
  if (event.target === els.composerSkillSearch) {
    composerSkillQuery = event.target.value;
    renderComposerSkillMenu();
    return;
  }
  if (event.target.matches?.("[data-skill-page-search]")) {
    state.searchQuery = event.target.value;
    const grid = els.pageContent.querySelector(".skill-grid");
    const sectionTitle = els.pageContent.querySelector(".section-title");
    const query = state.searchQuery.trim().toLowerCase();
    const visibleSkills = query
      ? skills.filter((skill) => [skill.name, skill.description, skill.category, skill.slug].some((value) => String(value || "").toLowerCase().includes(query)))
      : skills;
    if (grid) grid.innerHTML = visibleSkills.length ? visibleSkills.map(renderSkillCard).join("") : `<div class="skills-empty">没有匹配的技能</div>`;
    if (sectionTitle) sectionTitle.textContent = query ? `找到 ${visibleSkills.length} 个技能` : (skills.some((skill) => skill.installed) ? "全部技能" : "常用技能");
    saveState();
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

els.promptInput.addEventListener("paste", async (event) => {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;
  const files = [...clipboardData.files].map(desktopFilePath).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    await addSelectedFiles(files);
    return;
  }
  if (clipboardData.types.includes("Files") && window.desktopBridge?.readClipboardFiles) {
    event.preventDefault();
    const clipboardFiles = await window.desktopBridge.readClipboardFiles();
    if (clipboardFiles.length) {
      await addSelectedFiles(clipboardFiles);
      return;
    }
  }
  const imageItem = [...clipboardData.items].find((item) => item.type.startsWith("image/"));
  if (!imageItem && clipboardData.getData("text/plain")) return;
  if (imageItem && window.desktopBridge?.saveClipboardImage) {
    event.preventDefault();
    try {
      const image = await window.desktopBridge.saveClipboardImage({ userId: state.session?.userId || "local-user" });
      await addSelectedFiles([image]);
    } catch (error) {
      showToast(error.message || "图片粘贴失败");
    }
  }
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
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;
  const files = [...clipboardData.files].map(desktopFilePath).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    await addSelectedFiles(files);
    return;
  }
  if (clipboardData.types.includes("Files") && window.desktopBridge?.readClipboardFiles) {
    const clipboardFiles = await window.desktopBridge.readClipboardFiles();
    if (clipboardFiles.length) {
      event.preventDefault();
      await addSelectedFiles(clipboardFiles);
      return;
    }
  }
  const imageItem = [...clipboardData.items].find((item) => item.type.startsWith("image/"));
  if (imageItem && window.desktopBridge?.saveClipboardImage) {
    event.preventDefault();
    try {
      const image = await window.desktopBridge.saveClipboardImage({ userId: state.session?.userId || "local-user" });
      await addSelectedFiles([image]);
    } catch (error) {
      showToast(error.message || "图片粘贴失败");
    }
  }
});

els.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.chatForm.requestSubmit();
  }
});

document.addEventListener("keydown", (event) => {
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
render();
refreshRuntimeConfig();
autoResizePrompt();
window.desktopBridge?.onWindowStateChanged?.(renderWindowState);
window.desktopBridge?.getWindowState?.().then(renderWindowState).catch(() => {});
window.desktopBridge?.onSkillInstallProgress?.(handleSkillInstallProgress);
      window.desktopBridge?.onChatCompletionChunk?.(applyChatCompletionChunk);
window.desktopBridge?.onGenerationProgress?.(applyGenerationProgress);
window.desktopBridge?.onRuntimeSetupProgress?.(updateRuntimeSetupStatus);
window.desktopBridge?.getRuntimeSetupStatus?.().then(updateRuntimeSetupStatus).catch(() => {});
bootstrapAuth().then(() => {
  refreshInstalledSkills();
  hydrateConversationAttachments();
});
