process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { app, BrowserWindow } = require("electron");

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-document-formats-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
require(process.env.XIANMA_TEST_MAIN_PATH || "./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(`${label}超时`);
}

function readSignature(filePath, bytes = 64) {
  return fs.readFileSync(filePath).subarray(0, bytes);
}

async function run() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await delay(500);

  const result = await mainWindow.webContents.executeJavaScript(`(async () => {
    const formats = ['docx', 'pptx', 'xlsx', 'pdf', 'odt', 'ods', 'odp', 'html', 'md', 'txt', 'csv', 'json', 'xml', 'rtf', 'zip'];
    const output = {};
    for (const format of formats) {
      output[format] = await window.desktopBridge.createTaskResult({
        id: 'format-' + format,
        userId: 'format-smoke-user',
        skillId: 'documents',
        resultType: 'document',
        resultTitle: '格式验证-' + format,
        documentTitle: '格式验证-' + format,
        resultText: '---\\ntitle: 项目交付复盘\\nmeeting_date: 2026-08-11\\nmeeting_type: 项目推进会\\nstatus: draft\\nframework: 结构化复盘\\n---\\n\\n# 项目摘要\\n\\n## 0. 执行摘要\\n\\n- **核心结论：** 项目已按计划交付。\\n- **后续行动：** 完成验收归档。\\n\\n1. 整理交付材料\\n2. 完成内部复盘\\n\\n| 字段 | 值 |\\n| --- | --- |\\n| 状态 | 通过 |',
        outputFormat: format
      });
    }
    const simpleQuestion = shouldUseFileCapabilities(activeConversation(), { content: '中国的首都在哪里？', attachments: [] });
    const documentForm = (() => {
      state.activeView = 'skills';
      render();
      openSkillForm('documents');
      const formatField = document.querySelector('[data-form-field="format"]');
      const submitButton = document.querySelector('[data-submit-skill-form="documents"]');
      return {
        visible: Boolean(formatField),
        optionCount: formatField?.querySelectorAll('[data-option-pill]').length || 0,
        submitPresent: Boolean(submitButton),
        chatFormVisible: !document.querySelector('#chatView')?.classList.contains('hidden'),
        contentPlaceholder: document.querySelector('[data-form-field="content"] textarea')?.getAttribute('placeholder') || ''
      };
    })();
    return { output, documentForm, simpleQuestion };
  })()`);

  const expected = ["docx", "pptx", "xlsx", "pdf", "odt", "ods", "odp", "html", "md", "txt", "csv", "json", "xml", "rtf", "zip"];
  const files = {};
  for (const format of expected) {
    const filePath = result.output[format]?.artifacts?.[0]?.path;
    if (!filePath || !fs.existsSync(filePath)) throw new Error(`${format}未生成`);
    files[format] = filePath;
  }

  const signatures = Object.fromEntries(Object.entries(files).map(([format, filePath]) => [format, readSignature(filePath).toString("ascii")]));
  if (signatures.docx.slice(0, 2) !== "PK" || signatures.pptx.slice(0, 2) !== "PK" || signatures.xlsx.slice(0, 2) !== "PK") {
    throw new Error(`Office 文件容器头不正确：${JSON.stringify(signatures)}`);
  }
  if (signatures.pdf !== "%PDF-1.3" && !signatures.pdf.startsWith("%PDF-")) throw new Error("PDF 文件头不正确");
  if (!signatures.rtf.startsWith("{\\rtf1")) throw new Error("RTF 文件头不正确");
  if (!signatures.html.startsWith("<!doctype html>")) throw new Error("HTML 文件内容不正确");
  if (!signatures.json.startsWith("{\r\n") && !signatures.json.startsWith("{\n")) throw new Error("JSON 文件内容不正确");
  const docx = await JSZip.loadAsync(fs.readFileSync(files.docx));
  const documentXml = await docx.file("word/document.xml").async("string");
  const stylesXml = await docx.file("word/styles.xml").async("string");
  const visibleDocxText = documentXml.replace(/<[^>]+>/g, "");
  if (/(?:---|\*\*|# 项目|meeting_date|meeting_type|distillation_level)/.test(visibleDocxText)) {
    throw new Error(`Word 文档仍包含 Markdown 或 YAML 标记：${visibleDocxText.slice(0, 500)}`);
  }
  if (!visibleDocxText.includes("项目交付复盘") || !visibleDocxText.includes("基本信息") || !visibleDocxText.includes("会议日期") || !visibleDocxText.includes("核心结论：")) {
    throw new Error(`Word 结构化内容不完整：${visibleDocxText.slice(0, 800)}`);
  }
  if (!documentXml.includes("<w:tbl>") || !stylesXml.includes("Microsoft YaHei")) throw new Error("Word 文档没有应用信息表格或中文字体样式");
  for (const format of ["html", "md", "txt", "json", "xml", "rtf"]) {
    const text = fs.readFileSync(files[format], "utf8");
    if (/(?:\*\*|# 项目摘要|meeting_date:|meeting_type:|^---$)/m.test(text)) throw new Error(`${format} 仍包含 Markdown 或 YAML 标记`);
  }
  if (!fs.readFileSync(files.txt, "utf8").startsWith("项目交付复盘\n")) {
    throw new Error("纯文本文件没有使用文档正式标题");
  }
  for (const format of ["odt", "ods", "odp", "zip"]) {
    const zip = await JSZip.loadAsync(fs.readFileSync(files[format]));
    if (!zip.files[Object.keys(zip.files).find((name) => name === "mimetype" || name === "README.txt" || name === "[Content_Types].xml") || ""]) {
      if (format === "zip") throw new Error("ZIP 文件没有内容");
    }
  }
  if (result.documentForm.optionCount < 10 || !result.documentForm.visible || !result.documentForm.submitPresent || result.documentForm.chatFormVisible || result.simpleQuestion) {
    throw new Error(`技能页文档入口或简单问题路由不正确：${JSON.stringify(result)}`);
  }

  const skillSubmit = await mainWindow.webContents.executeJavaScript(`(async () => {
    state.activeView = 'skills';
    state.selectedFiles = [];
    render();
    openSkillForm('documents');
    document.querySelector('[data-form-field="title"] textarea').value = '技能页生成验证';
    document.querySelector('[data-form-field="content"] textarea').value = '技能页面直接生成内容。';
    const pptOption = [...document.querySelectorAll('[data-form-field="format"] [data-option-pill]')].find((item) => item.textContent.includes('PowerPoint'));
    pptOption?.click();
    submitSkillForm('documents');
    return {
      activeView: state.activeView,
      resultType: state.taskResult?.resultType || '',
      outputFormat: state.taskResult?.outputFormat || '',
      chatFormSubmitted: activeConversation().messages.length > 0
    };
  })()`);
  if (skillSubmit.activeView !== "task-result" || skillSubmit.resultType !== "document" || skillSubmit.outputFormat !== "pptx" || skillSubmit.chatFormSubmitted) {
    throw new Error(`技能页提交跳转或格式选择不正确：${JSON.stringify(skillSubmit)}`);
  }

  process.stdout.write(`${JSON.stringify({
    documentFormats: expected,
    validOfficeContainers: true,
    polishedSkillDocuments: true,
    validPdfAndRtf: true,
    validOpenDocumentContainers: true,
    skillPageOnly: true,
    skillSubmitStaysOnResultPage: true,
    simpleQuestionStaysFast: true,
    files
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
