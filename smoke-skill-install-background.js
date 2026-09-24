process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-background-skill-${runId}`);
const testUserId = `background-skill-${runId}`;
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMainWindow(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) return mainWindow;
    await delay(50);
  }
  throw new Error("主窗口创建超时");
}

async function run() {
  await app.whenReady();
  const mainWindow = await waitForMainWindow();
  while (mainWindow.webContents.isLoading()) await delay(40);

  const fixturePath = path.join(userDataDir, "后台安装技能.md");
  fs.writeFileSync(fixturePath, [
    "---",
    "name: background-install-check",
    "description: 验证技能安装在后台执行并发送完成通知。",
    "---",
    "",
    "# 后台安装验证",
    "",
    "安装后可在对话中调用。"
  ].join("\n"), "utf8");

  const result = await mainWindow.webContents.executeJavaScript(`(async ({ userId, sourcePath }) => {
    state.session = { userId, name: "后台安装测试用户" };
    state.authReady = true;
    const inspection = await window.desktopBridge.inspectSkillSource({ userId, sourcePath });
    resetLocalSkillImport();
    localSkillImport.source = "zip";
    localSkillImport.sourcePath = sourcePath;
    applySkillImportInspection(inspection);
    localSkillImport.step = 2;
    localSkillImport.categoryId = "efficiency-tools";
    localSkillImport.tags = [{ tagId: "automation", name: "自动化", isNew: false }];
    localSkillImport.instructions = inspection.skill.instructions || inspection.skill.description;
    state.activeView = "skill-import";
    render();
    const startedAt = performance.now();
    await installLocalSkill();
    const returnedMs = performance.now() - startedAt;
    const successVisible = Boolean(document.querySelector('.skill-import-success'));
    const completedStep = localSkillImport.step === 3;
    state.activeView = "search";
    render();
    const installed = (await window.desktopBridge.getInstalledSkills({ userId }))?.skills?.find((skill) => skill.slug === "background-install-check");
    return {
      completedStep,
      successVisible,
      returnedWithoutLongWait: returnedMs < 5000,
      pageStayedUsable: state.activeView === "search",
      installed: Boolean(installed),
      installedName: installed?.name || ""
    };
  })(${JSON.stringify({ userId: testUserId, sourcePath: fixturePath })})`);

  const installed = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getInstalledSkills(${JSON.stringify({ userId: testUserId })})`);
  for (const skill of installed?.skills || []) {
    await mainWindow.webContents.executeJavaScript(`window.desktopBridge.removeInstalledSkill(${JSON.stringify({ userId: testUserId, skillId: skill.id })})`);
  }
  console.log(JSON.stringify(result));
  if (!result.completedStep || !result.successVisible || !result.returnedWithoutLongWait || !result.pageStayedUsable || !result.installed) {
    app.exit(1);
    return;
  }
  app.quit();
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
