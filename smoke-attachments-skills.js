process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { app, BrowserWindow, clipboard, dialog, nativeImage } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-attachments-skills-${runId}`);
const testUserId = `attachment-skill-${runId}`;
const pickerState = { filePath: "", folderPath: "", calls: [] };

dialog.showOpenDialog = async (windowOrOptions, dialogOptions = {}) => {
  const options = windowOrOptions && !windowOrOptions.webContents && Object.keys(dialogOptions).length === 0
    ? windowOrOptions
    : dialogOptions;
  pickerState.calls.push({
    title: options.title,
    properties: Array.isArray(options.properties) ? [...options.properties] : [],
    filters: Array.isArray(options.filters) ? options.filters.map((filter) => ({ ...filter, extensions: [...(filter.extensions || [])] })) : []
  });
  const folderMode = options.properties?.includes("openDirectory");
  const sourcePath = folderMode ? pickerState.folderPath : pickerState.filePath;
  return sourcePath ? { canceled: false, filePaths: [sourcePath] } : { canceled: true, filePaths: [] };
};

fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
require("./electron/main.js");

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

async function run() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");

  const fixtureDir = path.join(userDataDir, "fixtures");
  fs.mkdirSync(fixtureDir, { recursive: true });
  const imagePath = path.join(fixtureDir, "粘贴测试.png");
  fs.copyFileSync(path.join(__dirname, "renderer", "assets", "icon.png"), imagePath);
  const documentPath = path.join(fixtureDir, "会议材料.docx");
  const audioPath = path.join(fixtureDir, "会议录音.mp3");
  const videoPath = path.join(fixtureDir, "会议视频.mp4");
  fs.writeFileSync(documentPath, Buffer.from("document-fixture"));
  fs.writeFileSync(audioPath, Buffer.from("audio-fixture"));
  fs.writeFileSync(videoPath, Buffer.from("video-fixture"));

  const zip = new JSZip();
  zip.file("SKILL.md", [
    "---",
    "name: project-review",
    "description: 审阅项目材料并输出结构化问题、风险和改进建议。",
    "---",
    "",
    "# 项目审阅",
    "",
    "读取 {baseDir}/references/checklist.md，并根据用户提供的项目材料输出问题、风险和改进建议。",
    ""
  ].join("\n"));
  zip.file("references/checklist.md", "检查范围、影响、优先级和建议。\n");
  zip.file("skill.json", JSON.stringify({
    displayName: "项目审阅",
    category: "质量保障",
    icon: "clipboard-list",
    fields: [{ id: "content", label: "审阅内容", type: "textarea", placeholder: "填写要审阅的内容" }]
  }));
  const skillZipPath = path.join(fixtureDir, "项目审阅.zip");
  fs.writeFileSync(skillZipPath, await zip.generateAsync({ type: "nodebuffer" }));

  const markdownSkillPath = path.join(fixtureDir, "日报整理技能.md");
  fs.writeFileSync(markdownSkillPath, [
    "---",
    "name: daily-summary",
    "description: 将用户提供的工作记录整理为结构化日报。",
    "---",
    "",
    "# 日报整理",
    "",
    "根据用户输入生成清晰、简洁的日报。",
    ""
  ].join("\n"), "utf8");

  const markdownLongSkillPath = path.join(fixtureDir, "会议行动项.markdown");
  fs.writeFileSync(markdownLongSkillPath, [
    "---",
    "name: meeting-actions",
    "description: 从会议材料中提取行动项、负责人和截止日期。",
    "---",
    "",
    "# 会议行动项",
    ""
  ].join("\n"), "utf8");

  const resourceSkillDir = path.join(fixtureDir, "多格式资源技能");
  fs.mkdirSync(path.join(resourceSkillDir, "templates"), { recursive: true });
  fs.mkdirSync(path.join(resourceSkillDir, "references"), { recursive: true });
  fs.mkdirSync(path.join(resourceSkillDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(resourceSkillDir, "data"), { recursive: true });
  fs.writeFileSync(path.join(resourceSkillDir, "SKILL.md"), [
    "---",
    "name: office-resource-kit",
    "description: 使用随技能提供的办公模板、图片和结构化数据处理任务。",
    "---",
    "",
    "读取 {baseDir}/templates、{baseDir}/references、{baseDir}/assets 和 {baseDir}/data 中的资源。",
    ""
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(resourceSkillDir, "templates", "周报模板.docx"), Buffer.from("docx-template"));
  fs.writeFileSync(path.join(resourceSkillDir, "templates", "汇报模板.pptx"), Buffer.from("pptx-template"));
  fs.writeFileSync(path.join(resourceSkillDir, "templates", "统计模板.xlsx"), Buffer.from("xlsx-template"));
  fs.writeFileSync(path.join(resourceSkillDir, "references", "制度.pdf"), Buffer.from("pdf-reference"));
  fs.copyFileSync(imagePath, path.join(resourceSkillDir, "assets", "封面.png"));
  fs.writeFileSync(path.join(resourceSkillDir, "data", "示例.csv"), "项目,状态\n技能,完成\n", "utf8");
  fs.writeFileSync(path.join(resourceSkillDir, "data", "配置.json"), JSON.stringify({ enabled: true }), "utf8");
  pickerState.filePath = markdownSkillPath;
  pickerState.folderPath = resourceSkillDir;


  const riskyZip = new JSZip();
  riskyZip.file("SKILL.md", "---\nname: risky-maintenance\ndescription: 执行需要人工确认的本地维护流程。\n---\n\n运行 {baseDir}/scripts/cleanup.ps1。\n");
  riskyZip.file("scripts/cleanup.ps1", "Remove-Item -Recurse -Force $env:TEMP\\example\n");
  const riskySkillZipPath = path.join(fixtureDir, "高风险维护.zip");
  fs.writeFileSync(riskySkillZipPath, await riskyZip.generateAsync({ type: "nodebuffer" }));

  const invalidSkillPath = path.join(fixtureDir, "无效技能.txt");
  fs.writeFileSync(invalidSkillPath, "不支持的技能文件格式。\n", "utf8");
  clipboard.writeImage(nativeImage.createFromPath(imagePath));

  const result = await mainWindow.webContents.executeJavaScript(`(async ({ userId, imagePath, documentPath, audioPath, videoPath, skillZipPath, markdownSkillPath, markdownLongSkillPath, resourceSkillDir, riskySkillZipPath, invalidSkillPath }) => {
    const metadata = await window.desktopBridge.getInputFileMetadata({ filePaths: [imagePath] });
    await window.desktopBridge.selectFiles();
    state.session = { userId, name: "测试用户" };
    state.authReady = true;
    state.activeView = "chat";
    state.selectedFiles = [];
    els.promptInput.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 50 && !state.selectedFiles.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 40));
    const clipboardImagePaste = state.selectedFiles.length === 1
      && state.selectedFiles[0]?.kind === 'image'
      && String(state.selectedFiles[0]?.previewDataUrl || '').startsWith('data:image/');
    state.selectedFiles = [];
    openLocalSkillImport();
    const localSkillUnifiedEntry = Boolean(document.querySelector('[data-action="choose-skill-import-source"]'))
      && document.querySelectorAll('[data-skill-import-source]').length === 3;
    const localSkillPickerBridge = typeof window.desktopBridge.selectSkillSource === 'function'
      && typeof window.desktopBridge.selectSkillFile === 'function'
      && typeof window.desktopBridge.selectSkillFolder === 'function';
    closeLocalSkillImport();
    await addSelectedFiles([imagePath]);
    render();
    const composerImage = Boolean(document.querySelector('#attachmentBar img'));
    const composerAttachmentCard = Boolean(document.querySelector('#chatForm > #attachmentBar .composer-attachment-card'));
    const composerAttachmentMetadata = document.querySelector('.composer-attachment-copy small')?.textContent?.includes('图片') === true;
    const conversation = activeConversation();
    conversation.messages = [{
      id: 'attachment-message', role: 'user', content: '请审阅这个附件',
      attachments: metadata, files: [], images: [], createdAt: new Date().toISOString()
    }];
    render();
    const messageAttachmentCard = Boolean(document.querySelector('.message-attachment-card'));
    const messageAttachmentImage = Boolean(document.querySelector('.message-attachment-card img'));
    const inspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: skillZipPath });
    const installed = await window.desktopBridge.installSkill({ userId, sourcePath: skillZipPath });
    await refreshInstalledSkills();
    state.activeView = 'chat';
    render();
    const composerSkillOption = Boolean(document.querySelector('[data-menu-skill="' + installed.skill.id + '"]'));
    const baseDirResolved = installed.skill.systemPrompt.includes('references\\\\checklist.md') || installed.skill.systemPrompt.includes('references/checklist.md');
    openSkillForm(installed.skill.id);
    const installedSkillAttachmentPicker = Boolean(document.querySelector('.skill-attachment-picker'));
    const installedSkillAttachmentHelp = document.querySelector('.skill-attachment-picker')?.textContent?.includes('视频、录音和音频') === true;
    const installedSkillTextArea = document.querySelector('[data-form-field="content"] textarea');
    installedSkillTextArea.value = '添加附件前已经填写的技能内容';
    await addSelectedFiles([documentPath, imagePath, audioPath, videoPath]);
    const skillTextPreservedAfterAdd = document.querySelector('[data-form-field="content"] textarea')?.value === '添加附件前已经填写的技能内容';
    const skillAttachmentCards = document.querySelectorAll('.skill-attachment-item').length;
    const skillAttachmentKinds = state.selectedFiles.map((item) => item.kind);
    const skillAttachmentPathsVisible = [...document.querySelectorAll('.skill-attachment-copy code')].every((item) => /^[A-Za-z]:\\\\/.test(item.textContent));
    const audioPreview = await window.desktopBridge.previewArtifact(audioPath);
    const videoPreview = await window.desktopBridge.previewArtifact(videoPath);
    showArtifactPreview(audioPreview);
    const audioPlayer = Boolean(document.querySelector('#artifactPreviewContent audio'));
    closeArtifactPreview();
    showArtifactPreview(videoPreview);
    const videoPlayer = Boolean(document.querySelector('#artifactPreviewContent video'));
    closeArtifactPreview();
    removeAttachment(2);
    const skillAttachmentRemove = state.selectedFiles.length === 3 && document.querySelectorAll('.skill-attachment-item').length === 3;
    const skillTextPreservedAfterRemove = document.querySelector('[data-form-field="content"] textarea')?.value === '添加附件前已经填写的技能内容';
    submitInstalledSkill(installed.skill, [{ label: '审阅内容', value: '请结合附件整理项目风险' }]);
    const installedSkillAttachmentRouting = state.taskResult?.useFullAgent === true && state.taskResult?.selectedFiles?.length === 3;
    state.taskResult = null;
    state.selectedFiles = [];
    state.activeView = 'skills';
    render();
    const skillCard = Boolean(document.querySelector('[data-use-skill="' + installed.skill.id + '"]'));
    const installedSkills = await window.desktopBridge.getInstalledSkills({ userId });
    const isolatedSkills = await window.desktopBridge.getInstalledSkills({ userId: userId + '-other' });
    const pickedFile = await window.desktopBridge.selectSkillFile();
    const pickedFolder = await window.desktopBridge.selectSkillFolder();
    const markdownInspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: pickedFile.sourcePath });
    const markdownInstalled = await window.desktopBridge.installSkill({ userId, sourcePath: markdownSkillPath });
    const markdownLongInspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: markdownLongSkillPath });
    const markdownLongInstalled = await window.desktopBridge.installSkill({ userId, sourcePath: markdownLongSkillPath });
    const resourceInspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: pickedFolder.sourcePath });
    const resourceInstalled = await window.desktopBridge.installSkill({ userId, sourcePath: resourceSkillDir });
    const riskyInspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath: riskySkillZipPath });
    const riskyBlocked = await window.desktopBridge.installSkill({ userId, sourcePath: riskySkillZipPath });
    const riskyInstalled = await window.desktopBridge.installSkill({ userId, sourcePath: riskySkillZipPath, acknowledgeRisk: true });
    let invalidRejected = false;
    try {
      await window.desktopBridge.inspectSkillSource({ userId, sourcePath: invalidSkillPath });
    } catch {
      invalidRejected = true;
    }
    const directOnline = await window.desktopBridge.searchOnlineSkills({ query: 'https://github.com/example/project-skill' });
    await window.desktopBridge.removeInstalledSkill({ userId, skillId: riskyInstalled.skill.id });
    await window.desktopBridge.removeInstalledSkill({ userId, skillId: markdownInstalled.skill.id });
    await window.desktopBridge.removeInstalledSkill({ userId, skillId: markdownLongInstalled.skill.id });
    await window.desktopBridge.removeInstalledSkill({ userId, skillId: resourceInstalled.skill.id });
    await window.desktopBridge.removeInstalledSkill({ userId, skillId: installed.skill.id });
    const afterRemove = await window.desktopBridge.getInstalledSkills({ userId });
    return {
      metadataImage: metadata[0]?.kind === 'image' && String(metadata[0]?.previewDataUrl || '').startsWith('data:image/'),
      clipboardImagePaste,
      localSkillUnifiedEntry,
      localSkillPickerBridge,
      composerImage,
      composerAttachmentCard,
      composerAttachmentMetadata,
      messageAttachmentCard,
      messageAttachmentImage,
      installed: Boolean(installed.installed),
      inspected: inspection?.skill?.slug === 'project-review' && inspection?.skill?.riskLevel !== 'high',
      skillCard,
      composerSkillOption,
      baseDirResolved,
      installedSkillAttachmentPicker,
      installedSkillAttachmentHelp,
      skillTextPreservedAfterAdd,
      skillAttachmentCards: skillAttachmentCards === 4,
      skillAttachmentKinds: ['document', 'image', 'audio', 'video'].every((kind) => skillAttachmentKinds.includes(kind)),
      skillAttachmentPathsVisible,
      audioPlayer,
      videoPlayer,
      skillAttachmentRemove,
      skillTextPreservedAfterRemove,
      installedSkillAttachmentRouting,
      filePickerReturnedMarkdown: pickedFile?.sourceType === 'markdown' && pickedFile?.sourcePath === markdownSkillPath,
      folderPickerReturnedFolder: pickedFolder?.sourceType === 'folder' && pickedFolder?.sourcePath === resourceSkillDir,
      markdownInspected: markdownInspection?.sourceKind === 'markdown' && markdownInspection?.skill?.slug === 'daily-summary',
      markdownInstalled: markdownInstalled?.installed === true,
      markdownLongInspected: markdownLongInspection?.sourceKind === 'markdown' && markdownLongInspection?.skill?.slug === 'meeting-actions',
      markdownLongInstalled: markdownLongInstalled?.installed === true,
      folderInspected: resourceInspection?.sourceKind === 'folder' && resourceInspection?.skill?.fileCount === 8,
      folderInstalled: resourceInstalled?.installed === true && resourceInstalled?.skill?.fileCount === 8,
      resourceBaseDirResolved: resourceInstalled?.skill?.systemPrompt?.includes('templates') && !resourceInstalled?.skill?.systemPrompt?.includes('{baseDir}'),
      installedCount: installedSkills.skills.length,
      userIsolated: isolatedSkills.skills.length === 0,
      riskyDetected: riskyInspection?.requiresRiskAcknowledgement === true,
      riskyBlocked: riskyBlocked?.requiresRiskAcknowledgement === true && !riskyBlocked?.installed,
      riskyConfirmed: riskyInstalled?.installed === true,
      invalidRejected,
      directOnlineSource: directOnline?.results?.[0]?.reference === 'git:example/project-skill',
      removed: afterRemove.skills.every((skill) => skill.id !== installed.skill.id)
    };
  })(${JSON.stringify({ userId: testUserId, imagePath, documentPath, audioPath, videoPath, skillZipPath, markdownSkillPath, markdownLongSkillPath, resourceSkillDir, riskySkillZipPath, invalidSkillPath })})`);

  const expected = ["metadataImage", "clipboardImagePaste", "localSkillUnifiedEntry", "localSkillPickerBridge", "composerImage", "composerAttachmentCard", "composerAttachmentMetadata", "messageAttachmentCard", "messageAttachmentImage", "installed", "inspected", "skillCard", "composerSkillOption", "baseDirResolved", "installedSkillAttachmentPicker", "installedSkillAttachmentHelp", "skillTextPreservedAfterAdd", "skillAttachmentCards", "skillAttachmentKinds", "skillAttachmentPathsVisible", "audioPlayer", "videoPlayer", "skillAttachmentRemove", "skillTextPreservedAfterRemove", "installedSkillAttachmentRouting", "filePickerReturnedMarkdown", "folderPickerReturnedFolder", "markdownInspected", "markdownInstalled", "markdownLongInspected", "markdownLongInstalled", "folderInspected", "folderInstalled", "resourceBaseDirResolved", "userIsolated", "riskyDetected", "riskyBlocked", "riskyConfirmed", "invalidRejected", "directOnlineSource", "removed"];
  for (const key of expected) {
    if (!result[key]) throw new Error(`${key}未通过：${JSON.stringify(result)}`);
  }
  const [filePickerCall, folderPickerCall] = pickerState.calls.slice(-2);
  const attachmentPickerCall = pickerState.calls.find((call) => call.title === "选择附件");
  const attachmentExtensions = new Set((attachmentPickerCall?.filters || []).flatMap((filter) => filter.extensions || []));
  if (!attachmentPickerCall?.properties?.includes("multiSelections")) {
    throw new Error(`附件选择器不支持多选：${JSON.stringify(attachmentPickerCall)}`);
  }
  if (!["docx", "pdf", "png", "mp3", "wav", "mp4", "webm"].every((extension) => attachmentExtensions.has(extension))) {
    throw new Error(`附件选择器缺少多媒体格式：${JSON.stringify(attachmentPickerCall)}`);
  }

  const fileExtensions = new Set((filePickerCall?.filters || []).flatMap((filter) => filter.extensions || []));
  if (filePickerCall?.properties?.length !== 1 || filePickerCall.properties[0] !== "openFile") {
    throw new Error(`技能文件选择器模式不正确：${JSON.stringify(filePickerCall)}`);
  }
  if (!["md", "markdown", "zip"].every((extension) => fileExtensions.has(extension))) {
    throw new Error(`技能文件选择器缺少格式：${JSON.stringify(filePickerCall)}`);
  }
  if (folderPickerCall?.properties?.length !== 1 || folderPickerCall.properties[0] !== "openDirectory") {
    throw new Error(`技能文件夹选择器模式不正确：${JSON.stringify(folderPickerCall)}`);
  }

  await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getInputFileMetadata({ filePaths: ${JSON.stringify([imagePath, documentPath])} }).then((files) => { state.selectedFiles = files; showView('chat'); renderAttachmentBar(); return true; })`);
  await delay(120);
  const composerScreenshotPath = path.join(__dirname, "build", "smoke-composer-attachments.png");
  fs.writeFileSync(composerScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());

  process.stdout.write(`${JSON.stringify({
    attachmentMetadata: true,
    clipboardImagePaste: true,
    localSkillUnifiedEntry: true,
    pastePreviewPathReady: true,
    conversationAttachmentCard: true,
    conversationImagePreview: true,
    composerAttachmentCards: true,
    installedSkillUniversalAttachments: true,
    skillTextPreservedDuringAttachmentChanges: true,
    skillDocumentImageAudioVideoInputs: true,
    skillAbsolutePathsVisible: true,
    inAppAudioVideoPreview: true,
    skillAttachmentRemoval: true,
    installedSkillAttachmentRouting: true,
    nativeAttachmentPickerFormats: true,
    skillZipInstall: true,
    skillMarkdownInstall: true,
    skillMarkdownLongExtensionInstall: true,
    skillFolderInstall: true,
    skillOfficePdfImageDataResources: true,
    nativeFilePickerFormats: true,
    nativeFolderPickerMode: true,
    skillYamlValidated: true,
    skillRiskConfirmation: true,
    skillUserIsolation: true,
    skillBaseDirResolved: true,
    onlineSourceRecognized: true,
    installedSkillVisible: true,
    installedSkillRemove: true,
    composerScreenshotPath
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
