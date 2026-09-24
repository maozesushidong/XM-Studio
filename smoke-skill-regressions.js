process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-skill-regressions-${runId}`);
const userId = `skill-regression-${runId}`;
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

function writeSkill(root, name, description) {
  fs.mkdirSync(root, { recursive: true });
  const frontMatter = description
    ? ["---", `name: ${name}`, `description: ${description}`, "---"]
    : ["---", `name: ${name}`, "description: >", "  一个支持多行描述的技能。", "  可以直接安装。", "---"];
  fs.writeFileSync(path.join(root, "SKILL.md"), [
    ...frontMatter,
    "",
    `# ${name}`,
    "",
    "用于回归测试的本地技能。"
  ].join("\n"), "utf8");
}

async function run() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  mainWindow.webContents.on("console-message", (_event, _level, message, line, source) => {
    console.error(`renderer ${source}:${line}: ${message}`);
  });
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");

  const fixtureDir = path.join(userDataDir, "fixtures");
  fs.mkdirSync(fixtureDir, { recursive: true });
  const validPaths = ["alpha-skill", "beta-skill", "gamma-skill"].map((name) => {
    const target = path.join(fixtureDir, name);
    writeSkill(target, name, name === "beta-skill" ? "" : `用于${name}回归测试。`);
    return target;
  });
  const zipSource = path.join(fixtureDir, "zip-skill-source");
  writeSkill(zipSource, "zip-skill", "用于验证 ZIP 技能包安装。");
  fs.mkdirSync(path.join(zipSource, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(zipSource, "scripts", "keep.js"), "module.exports = true;\n", "utf8");
  const zip = new JSZip();
  zip.file("zip-skill/SKILL.md", fs.readFileSync(path.join(zipSource, "SKILL.md")));
  zip.file("zip-skill/scripts/keep.js", fs.readFileSync(path.join(zipSource, "scripts", "keep.js")));
  const zipPath = path.join(fixtureDir, "zip-skill.zip");
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  validPaths.push(zipPath);
  const invalidPath = path.join(fixtureDir, "invalid-skill");
  fs.mkdirSync(invalidPath, { recursive: true });
  fs.writeFileSync(path.join(invalidPath, "README.txt"), "缺少技能入口文件", "utf8");

  const script = `(async ({ userId, validPaths, invalidPath }) => {
    state.session = { userId, name: "技能回归测试用户" };
    state.authReady = true;
    const events = [];
    const unsubscribe = window.desktopBridge.onSkillInstallProgress((event) => events.push(event));
    const installResults = await Promise.all([
      ...validPaths.map((sourcePath) => window.desktopBridge.installSkill({ userId, sourcePath, acknowledgeRisk: true, background: true })),
      window.desktopBridge.installSkill({ userId, sourcePath: invalidPath, background: true })
    ]);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const settled = events.filter((event) => ["completed", "failed"].includes(event.status));
      if (settled.length >= 5) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const first = state.conversations[0];
    const second = createConversation("第二个会话");
    state.conversations.push(second);
    state.activeConversationId = second.id;
    openSkillForm("copywriting");
    const skillPageBinding = activeConversation().skillId;
    showView("chat");

    state.activeConversationId = first.id;
    setActiveSkill("weekly");
    const firstSkill = activeConversation().skillId;
    setActiveConversation(second.id);
    const secondSkill = activeConversation().skillId;
    setActiveConversation(first.id);
    const restoredFirstSkill = activeConversation().skillId;

    setActiveConversation(second.id);
    startLocalSkillResult({
      skill: { id: "installed-prompt-test", name: "提示词回归技能", systemPrompt: "请按技能规则处理用户任务。" },
      format: "",
      title: "提示词回归技能",
      userMsg: "北京的天气是什么",
      historyTitle: "提示词回归",
      resultBody: "正在执行。",
      resultText: "输入内容：北京的天气是什么",
      contentPrompt: "使用技能处理天气问题。",
      resultType: "document",
      outputFormat: "docx",
      persistArtifacts: true,
      steps: []
    });
    const skillExecutionPrompt = state.taskResult?.contentPrompt || "";
    const skillExecutionBinding = activeConversation().skillId;
    state.taskResult = null;
    state.activeView = "chat";

    const richHtml = buildResultRichHtml({
      resultType: "document",
      resultText: "真实生成正文：\\n第一项内容。",
      artifacts: [{ type: "document", label: "结果.docx", path: "result.docx" }]
    });
    const record = await window.desktopBridge.createTaskResult({
      userId,
      id: "regression-result",
      skillId: "weekly",
      historyTitle: "回归结果",
      resultTitle: "回归结果",
      resultType: "text",
      resultText: "从任务记录恢复的真实正文。",
      resultBody: "结果已生成。"
    });
    await refreshWorkData({ silent: true });
    openTaskRun(record.id);
    const reopenedText = state.taskResult?.resultText || "";
    const skillResult = await window.desktopBridge.createTaskResult({
      userId,
      id: "regression-skill-result",
      skillId: "installed-ppt-generator",
      historyTitle: "技能结果正文",
      resultTitle: "技能结果正文",
      resultType: "skill",
      resultText: "天气结果正文：北京今天晴。",
      resultBody: "技能已完成。"
    });
    const installedSkills = (await window.desktopBridge.getInstalledSkills({ userId })).skills;
    const zipSkill = installedSkills.find((skill) => skill.slug === "zip-skill");
    const zipSkillSource = zipSkill ? await window.desktopBridge.getInstalledSkillSource({ userId, skillId: zipSkill.id }) : null;
    unsubscribe();
    return {
      queuedCount: installResults.filter((item) => item?.queued).length,
      completedCount: events.filter((event) => event.status === "completed").length,
      failedCount: events.filter((event) => event.status === "failed").length,
      allValidInstalled: installedSkills.filter((skill) => ["alpha-skill", "beta-skill", "gamma-skill", "zip-skill"].includes(skill.slug)).length === 4,
      zipSkillSourcePath: zipSkillSource?.sourcePath || "",
      skillPageBinding,
      firstSkill,
      secondSkill,
      restoredFirstSkill,
      skillExecutionBinding,
      skillPromptKeepsTask: skillExecutionPrompt.includes("北京的天气是什么") && skillExecutionPrompt.includes("禁止输出初始化问候") && skillExecutionPrompt.includes("请按技能规则处理用户任务"),
      resultHasText: richHtml.includes("真实生成正文") && richHtml.includes("结果.docx"),
      reopenedText: reopenedText.includes("从任务记录恢复的真实正文"),
      skillResultHasText: skillResult.resultText === "天气结果正文：北京今天晴。",
      skillResultDocxPath: skillResult.artifacts?.find((artifact) => /\.docx$/i.test(String(artifact.path || "")))?.path || "",
      skillResultPrimaryPath: skillResult.primaryPath || ""
    };
  })(${JSON.stringify({ userId, validPaths, invalidPath })})`;
  fs.writeFileSync(path.join(userDataDir, "regression-script.js"), script, "utf8");
  let result;
  try {
    result = await mainWindow.webContents.executeJavaScript(script);
  } catch (error) {
    console.error(error);
    console.error(`regression script: ${path.join(userDataDir, "regression-script.js")}`);
    throw error;
  }

  console.log(JSON.stringify(result));
  const passed = result.queuedCount === 5
    && result.completedCount >= 4
    && result.failedCount >= 1
    && result.allValidInstalled
    && fs.existsSync(path.join(result.zipSkillSourcePath, "scripts", "keep.js"))
    && result.skillPageBinding === null
    && result.firstSkill === "weekly"
    && result.secondSkill === null
    && result.restoredFirstSkill === "weekly"
    && result.skillExecutionBinding === null
    && result.skillPromptKeepsTask
    && result.resultHasText
    && result.reopenedText
    && result.skillResultHasText
    && /\.docx$/i.test(result.skillResultDocxPath)
    && fs.existsSync(result.skillResultDocxPath)
    && /\.docx$/i.test(result.skillResultPrimaryPath)
  app.exit(passed ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
