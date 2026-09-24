const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const { readReleaseMetadata } = require("./release-version");

const root = path.resolve(__dirname, "..");
const { packageVersion, releaseVersion: version } = readReleaseMetadata(root);
const archivePath = [
  path.join(root, `dist-${version}-assembled`, "win-unpacked", "resources", "app.asar"),
  path.join(root, `dist-${version}`, "win-unpacked", "resources", "app.asar")
].find((candidate) => fs.existsSync(candidate));

if (!archivePath) throw new Error(`找不到 ${version} 的应用归档`);

const packedPackage = JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8"));
const mainSource = asar.extractFile(archivePath, "electron/main.js").toString("utf8");
const preloadSource = asar.extractFile(archivePath, "electron/preload.js").toString("utf8");
const htmlSource = asar.extractFile(archivePath, "renderer/index.html").toString("utf8");
const rendererSource = asar.extractFile(archivePath, "renderer/app.js").toString("utf8");
const companySkillsSource = asar.extractFile(archivePath, "electron/company-skills.js").toString("utf8");
const bundledMeetingSkill = asar.extractFile(archivePath, path.join("electron", "bundled-skills", "dongge-meeting-model", "SKILL.md")).toString("utf8");
const bundledMeetingReference = asar.extractFile(archivePath, path.join("electron", "bundled-skills", "dongge-meeting-model", "references", "先马会议蒸馏与组织知识资产化系统_V4.0.md")).toString("utf8");
const packagedEntries = asar.listPackage(archivePath);
const normalizedPackagedEntries = packagedEntries.map((entry) => entry.replace(/\\/g, "/"));
const packagedRuntimeToolPath = path.join(path.dirname(archivePath), "runtime-tools", "windows-ui-automation.ps1");
const packagedRuntimeToolSource = fs.existsSync(packagedRuntimeToolPath) ? fs.readFileSync(packagedRuntimeToolPath, "utf8") : "";
const openSkillFormSource = rendererSource.match(/function openSkillForm[\s\S]*?\n}\n/)?.[0] || "";
const startLocalSkillResultSource = rendererSource.match(/function startLocalSkillResult[\s\S]*?\n}\n/)?.[0] || "";

const checks = {
  version: packedPackage.version === packageVersion,
  separatePickerModes: mainSource.includes('folderMode ? "openDirectory" : "openFile"'),
  markdownExtension: mainSource.includes('extensions: ["md", "markdown", "zip"]'),
  unifiedBridge: preloadSource.includes("selectSkill:") && preloadSource.includes('sourceType: "unified"'),
  unifiedButton: htmlSource.includes('data-action="choose-skill-source"') && !htmlSource.includes('data-action="choose-skill-file"') && !htmlSource.includes('data-action="choose-skill-folder"'),
  resourceFormats: htmlSource.includes("DOCX、PPTX、XLSX、PDF"),
  unifiedAction: rendererSource.includes('action === "choose-skill-source"') && rendererSource.includes("chooseLocalSkillSource()"),
  skillEntryMapsToFolder: mainSource.includes('path.basename(selectedPath).toLowerCase() === "skill.md"') && mainSource.includes("path.dirname(selectedPath)"),
  universalSkillAttachments: rendererSource.includes("function renderSkillAttachmentField()"),
  skillAttachmentMediaHelp: rendererSource.includes("视频、录音和音频"),
  skillAttachmentLocalRefresh: rendererSource.includes("function refreshSkillAttachmentField()"),
  installedSkillDynamicRouting: rendererSource.includes("if (conversationSkill?.installed) return true;") && rendererSource.includes('skillId: requestSkill?.id || ""'),
  skillResultCreatesDocument: rendererSource.includes('resultType: "document"') && rendererSource.includes('persistArtifacts: true') && mainSource.includes('if (payload?.resultType === "images")'),
  skillResultContentFallback: mainSource.includes("extractTextArtifactContent(files)"),
  skillPageConversationIsolation: !openSkillFormSource.includes("setConversationSkill") && !startLocalSkillResultSource.includes("setConversationSkill"),
  skillExecutionKeepsTask: rendererSource.includes("本次用户任务与素材（必须优先处理）") && rendererSource.includes("禁止输出初始化问候"),
  firstRunGreetingDisabled: mainSource.includes('path.join(workspacePath, "BOOTSTRAP.md")') && mainSource.includes('fs.rmSync(bootstrapPath, { force: true })'),
  meetingMinutesCore: rendererSource.includes("meetingMinutesSkillPrompt") && rendererSource.includes("东哥会议模型") && mainSource.includes("applyBundledSkillPrompt"),
  bundledMeetingSkill: bundledMeetingSkill.includes("name: dongge-meeting-model") && bundledMeetingSkill.includes("# 东哥会议模型"),
  bundledMeetingReference: bundledMeetingReference.includes("先马会议蒸馏与组织知识资产化系统") && bundledMeetingReference.includes("version: V4.0"),
  bundledMeetingFirst: rendererSource.indexOf('id: "meeting"') < rendererSource.indexOf('id: "weekly"') && rendererSource.includes("return [...builtIn, ...enterprise, ...personal];"),
  bundledMeetingFocusReadOnly: rendererSource.includes('value: ["执行摘要", "一句话判断", "决策地图", "任务安排", "风险与回退", "待确认事项"], readonly: true') && rendererSource.includes("data-option-readonly"),
  companySkillReleaseIncluded: normalizedPackagedEntries.some((entry) => entry.endsWith("/electron/company-skills.js")) && preloadSource.includes("submitCompanySkill") && preloadSource.includes("withdrawSkillSubmission") && preloadSource.includes("getSkillTaxonomy") && mainSource.includes("const companySkillsEnabled = true") && rendererSource.includes("企业技能") && rendererSource.includes("创建标准技能") && rendererSource.includes("提交审核") && rendererSource.includes("startCompanySkillSync();"),
  importedSkillReviewPackage: companySkillsSource.includes("prepareInstalledSkillSubmission") && companySkillsSource.includes("standardizedImportedMarkdown") && preloadSource.includes("prepareInstalledSkillSubmission") && mainSource.includes("desktop:prepare-installed-skill-submission") && rendererSource.includes("prepareInstalledSkillForReview"),
  backgroundSkillInstall: mainSource.includes("function queueSkillInstall") && mainSource.includes('desktop:skill-install-progress'),
  backgroundSkillInstallBridge: preloadSource.includes("onSkillInstallProgress"),
  backgroundSkillInstallUi: rendererSource.includes("handleSkillInstallProgress") && rendererSource.includes("已开始后台安装"),
  mediaPickerFormats: ["mp3", "wav", "m4a", "mp4", "webm"].every((extension) => mainSource.includes(`\"${extension}\"`)),
  asynchronousAttachmentRead: mainSource.includes("await fs.promises.readFile(filePath)"),
  selectedSkillKeepsRouting: rendererSource.includes("function skillForMessage") && rendererSource.includes("return skill || null;"),
  browserDesktopRouting: rendererSource.includes('conversation?.skillId === "browser"') && rendererSource.includes("computer_browser_search") && rendererSource.includes("micsoft.*浏览器"),
  browserAutomationTools: mainSource.includes('name: "computer_browser_open"') && mainSource.includes('name: "computer_browser_search"') && mainSource.includes("browserAutomationProfilePath"),
  browserAutomationRuntime: packagedRuntimeToolSource.includes("Invoke-BrowserNavigate") && packagedRuntimeToolSource.includes('"browser_navigate"') && packagedRuntimeToolSource.includes("Google\\Chrome\\Application\\chrome.exe"),
  browserConversationContinuity: mainSource.includes("activeBrowserSessions") && mainSource.includes("buildBrowserContinuationMessage") && mainSource.includes("continuation-snapshot") && rendererSource.includes("isTaskContinuationInstruction") && rendererSource.includes("browserAutomationTask"),
  onlineWebSkillFastPath: mainSource.includes("runWebContentExtractorFastPath") && mainSource.includes("正在提取网页标题、正文和链接"),
  chatResultStateReset: rendererSource.includes('state.activeView = "chat";') && rendererSource.includes("state.taskResult = null;")
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`打包技能能力校验失败：${failed.join(", ")}`);

process.stdout.write(`${JSON.stringify({ packagedSkillImport: true, version, ...checks })}\n`);
