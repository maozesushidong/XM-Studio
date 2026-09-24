process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_DISABLE_REMOTE_COMPANY_SKILLS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
let smokeStage = "准备测试数据";

const testRoot = path.join(__dirname, "build", `smoke-company-skills-ui-${Date.now().toString(36)}`);
fs.rmSync(testRoot, { recursive: true, force: true });
app.setPath("userData", testRoot);
process.env.XIANMA_USER_DATA = testRoot;
const personalSkillSource = path.join(testRoot, "personal-skill-source");
fs.mkdirSync(personalSkillSource, { recursive: true });
fs.writeFileSync(path.join(personalSkillSource, "SKILL.md"), `---
name: smoke-personal-skill
description: 用于验证个人技能详情和审批状态流程。
title: 个人技能验收
---

# 适用场景
验证个人技能管理页面。

# 输入要求
输入任意测试内容。

# 输出要求
输出简洁测试结果。

# 执行流程
1. 读取输入。
2. 输出结果。

# 边界与禁止事项
不执行外部操作。

# 异常处理
输入为空时提示补充。

# 使用示例
用户：验证个人技能。
`, "utf8");
const installedPersonalSkillPath = path.join(testRoot, "users", "development-user", "skills", "installed-smoke-personal-skill");
fs.mkdirSync(installedPersonalSkillPath, { recursive: true });
fs.copyFileSync(path.join(personalSkillSource, "SKILL.md"), path.join(installedPersonalSkillPath, "SKILL.md"));
fs.mkdirSync(path.join(installedPersonalSkillPath, "scripts"), { recursive: true });
fs.writeFileSync(path.join(installedPersonalSkillPath, "scripts", "keep.js"), "module.exports = true;\n", "utf8");
fs.writeFileSync(path.join(installedPersonalSkillPath, ".xianma-skill-origin.json"), JSON.stringify({
  source: "local",
  sourceLabel: "本地导入",
  sourceReference: personalSkillSource,
  installId: "installed-smoke-personal-skill",
  personalSkillId: "installed-smoke-personal-skill",
  categoryId: "efficiency-tools",
  tagIds: ["automation"],
  installedAt: new Date().toISOString(),
  riskLevel: "low",
  riskItems: [],
  fileCount: 1,
  totalBytes: fs.statSync(path.join(personalSkillSource, "SKILL.md")).size
}, null, 2), "utf8");
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`${label}超时`);
}

async function click(mainWindow, selector) {
  const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`找不到页面元素：${selector}`);
  await delay(120);
}

async function pageState(mainWindow) {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const content = document.querySelector('#pageContent');
    const rect = content?.getBoundingClientRect();
    return {
      title: content?.querySelector('.page-header h1, .skill-library-header h1, .personal-skill-title h1')?.textContent || '',
      viewport: { width: innerWidth, height: innerHeight },
      content: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      entries: [...content?.querySelectorAll('.company-skill-entry') || []].map((item) => item.textContent.trim()),
      skillCards: [...content?.querySelectorAll('.skill-library-card') || []].map((item) => item.textContent.trim()),
      skillTabs: [...content?.querySelectorAll('[data-skill-tab]') || []].map((item) => item.textContent.trim()),
      skillCategories: [...content?.querySelectorAll('[data-skill-category]') || []].map((item) => item.textContent.trim()),
      categoryNavigation: (() => {
        const navigation = content?.querySelector('[data-skill-category-navigation]');
        const strip = navigation?.querySelector('[data-skill-category-strip]');
        const previous = navigation?.querySelector('[data-skill-category-scroll="-1"]');
        const next = navigation?.querySelector('[data-skill-category-scroll="1"]');
        return strip ? {
          overflow: strip.scrollWidth > strip.clientWidth + 2,
          scrollLeft: Math.round(strip.scrollLeft),
          previousDisabled: Boolean(previous?.disabled),
          nextDisabled: Boolean(next?.disabled),
          nextVisible: getComputedStyle(next).display !== 'none'
        } : null;
      })(),
      skillColumns: content?.querySelector('.skill-library-grid') ? getComputedStyle(content.querySelector('.skill-library-grid')).gridTemplateColumns.split(' ').length : 0,
      entryLayout: (() => {
        const section = content?.querySelector('.company-skill-section');
        const entries = [...content?.querySelectorAll('.company-skill-entry') || []];
        if (!section || entries.length !== 4) return null;
        const sectionRect = section.getBoundingClientRect();
        const firstRect = entries[0].getBoundingClientRect();
        const lastRect = entries[3].getBoundingClientRect();
        return {
          leftGap: Math.round(firstRect.left - sectionRect.left),
          rightGap: Math.round(sectionRect.right - lastRect.right),
          columns: getComputedStyle(content.querySelector('.company-skill-entry-grid')).gridTemplateColumns.split(' ').length
        };
      })(),
      draftFields: content?.querySelectorAll('[data-company-draft], [data-company-category]').length || 0,
      draftValues: Object.fromEntries([...content?.querySelectorAll('[data-company-draft]') || []].map((item) => [item.dataset.companyDraft, item.value])),
      actions: [...content?.querySelectorAll('[data-action]') || []].map((item) => item.dataset.action),
      createSkillEntry: content?.querySelector('[data-view="company-skill-create"]')?.textContent.trim() || '',
      skillEntryButtons: ['[data-view="company-skill-create"]', '[data-action="open-skill-import"]'].map((selector) => {
        const button = content?.querySelector(selector);
        if (!button) return null;
        const style = getComputedStyle(button);
        return { className: button.className, backgroundColor: style.backgroundColor, color: style.color, borderColor: style.borderColor };
      }),
      personalStatus: content?.querySelector('.personal-skill-state')?.textContent.trim() || '',
      personalActions: [...content?.querySelectorAll('.personal-skill-actions button') || []].map((item) => item.textContent.trim()),
      personalTimeline: content?.querySelector('.personal-skill-timeline')?.innerText || '',
      personalNotice: content?.querySelector('.personal-skill-notice')?.innerText || '',
      hasWithdrawAction: Boolean(content?.querySelector('[data-confirm-skill-action="withdraw"]')),
      text: content?.innerText || ''
    };
  })()`);
}

async function setViewport(mainWindow, width, height) {
  if (!mainWindow.webContents.debugger.isAttached()) mainWindow.webContents.debugger.attach("1.3");
  await mainWindow.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await delay(120);
}

app.whenReady().then(async () => {
  smokeStage = "等待主窗口";
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await delay(300);

  smokeStage = "检查对话本地文件入口";
  await click(mainWindow, '[data-action="toggle-composer-menu"]');
  const composerLocalFile = await mainWindow.webContents.executeJavaScript(`(() => {
    const options = [...document.querySelectorAll('#composerSkillList [data-menu-skill], #composerSkillList [data-menu-utility]')];
    const local = document.querySelector('#composerSkillList [data-menu-utility="local-file"]');
    return {
      visible: !document.querySelector('#composerMenu')?.classList.contains('hidden'),
      firstOptions: options.slice(0, 2).map((item) => item.querySelector('strong')?.textContent.trim() || ''),
      localFile: local ? { name: local.querySelector('strong')?.textContent || '', description: local.querySelector('small')?.textContent || '' } : null
    };
  })()`);
  if (!composerLocalFile.visible || composerLocalFile.firstOptions[0] !== "浏览器操作" || composerLocalFile.firstOptions[1] !== "本地文件" || composerLocalFile.localFile?.name !== "本地文件") {
    throw new Error(`对话技能菜单缺少本地文件入口：${JSON.stringify(composerLocalFile)}`);
  }
  await click(mainWindow, '[data-action="toggle-composer-menu"]');

  smokeStage = "读取个人技能";
  await mainWindow.webContents.executeJavaScript("refreshInstalledSkills()");
  await delay(200);

  smokeStage = "打开技能库";
  await click(mainWindow, '[data-view="skills"]');
  const skillPage = await pageState(mainWindow);
  if (skillPage.title !== "技能库" || skillPage.skillCards.length < 5 || skillPage.skillTabs.length !== 4 || !skillPage.skillTabs.some((item) => item.includes("我的提交")) || skillPage.skillCategories.length < 10 || skillPage.createSkillEntry !== "创建技能") throw new Error(`V1.1 技能库入口不完整：${JSON.stringify(skillPage)}`);
  if (skillPage.skillEntryButtons.some((button) => !button || !button.className.includes("secondary-button"))
    || new Set(skillPage.skillEntryButtons.map((button) => `${button.backgroundColor}|${button.color}|${button.borderColor}`)).size !== 1) {
    throw new Error(`创建技能与导入技能按钮样式不一致：${JSON.stringify(skillPage.skillEntryButtons)}`);
  }
  if (skillPage.skillColumns !== 3) throw new Error(`技能卡片没有按三列展示：${JSON.stringify(skillPage)}`);
  if (!skillPage.categoryNavigation?.nextVisible) throw new Error(`分类导航按钮没有按预览展示：${JSON.stringify(skillPage.categoryNavigation)}`);
  const imeInputResult = await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-skill-page-search]');
    if (!input) return { ok: false, reason: 'missing-input' };
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '项目';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '项目', inputType: 'insertCompositionText', isComposing: true }));
    const preservedDuringComposition = document.querySelector('[data-skill-page-search]') === input && document.activeElement === input && input.value === '项目';
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '项目' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '项目', inputType: 'insertText', isComposing: false }));
    return { ok: preservedDuringComposition, value: input.value };
  })()`);
  await delay(100);
  const imeInputAfterCommit = await mainWindow.webContents.executeJavaScript(`(() => ({
    value: document.querySelector('[data-skill-page-search]')?.value || '',
    visible: Boolean(document.querySelector('[data-skill-page-search]'))
  }))()`);
  if (!imeInputResult.ok || !imeInputAfterCommit.visible || imeInputAfterCommit.value !== '项目') throw new Error(`技能库搜索框无法保留中文输入：${JSON.stringify({ imeInputResult, imeInputAfterCommit })}`);
  await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-skill-page-search]');
    if (!input) return false;
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return true;
  })()`);
  await delay(100);
  await mainWindow.webContents.executeJavaScript(`applySkillTaxonomy({
    categories: [...skillLibraryState.categories, ...Array.from({ length: 12 }, (_, index) => ({ categoryId: 'overflow-' + index, name: '扩展业务分类' + (index + 1), status: 'ENABLED', sortOrder: 500 + index }))],
    tags: skillLibraryState.tags
  }); renderSkillsPage();`);
  const overflowingSkillPage = await pageState(mainWindow);
  if (!overflowingSkillPage.categoryNavigation?.overflow || overflowingSkillPage.categoryNavigation.nextDisabled) throw new Error(`分类较多时没有启用向右导航按钮：${JSON.stringify(overflowingSkillPage.categoryNavigation)}`);
  await click(mainWindow, '[data-skill-category-scroll="1"]');
  await delay(1000);
  const scrolledSkillPage = await pageState(mainWindow);
  if (scrolledSkillPage.categoryNavigation.scrollLeft <= 0 || scrolledSkillPage.categoryNavigation.previousDisabled) throw new Error(`分类向右导航没有产生滚动：${JSON.stringify(scrolledSkillPage.categoryNavigation)}`);
  await mainWindow.webContents.executeJavaScript(`applySkillTaxonomy({
    categories: [...skillLibraryState.categories, { categoryId: 'server-new', name: '服务器新增分类', status: 'ENABLED', sortOrder: 999 }],
    tags: skillLibraryState.tags
  }); renderSkillsPage();`);
  const synchronizedSkillPage = await pageState(mainWindow);
  if (!synchronizedSkillPage.skillCategories.includes("服务器新增分类")) throw new Error(`服务器新增分类没有同步到客户端：${JSON.stringify(synchronizedSkillPage.skillCategories)}`);
  const skillPageScreenshotPath = path.join(__dirname, "build", "smoke-company-skills-entry-layout.png");
  fs.writeFileSync(skillPageScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());

  smokeStage = "检查我的技能";
  await click(mainWindow, '[data-skill-tab="personal"]');
  const personalPage = await pageState(mainWindow);
  if (personalPage.skillCards.some((item) => item.includes("自带技能") || item.includes("东哥会议模型"))) throw new Error(`自带技能错误混入我的技能：${JSON.stringify(personalPage)}`);
  if (!personalPage.skillCards.some((item) => item.includes("个人技能验收"))) throw new Error(`我的技能没有显示当前用户安装的技能：${JSON.stringify(personalPage)}`);

  smokeStage = "检查个人技能详情";
  await click(mainWindow, '[data-manage-skill]');
  const privateDetail = await pageState(mainWindow);
  if (privateDetail.title !== "个人技能验收" || privateDetail.personalStatus !== "未提交" || !privateDetail.personalActions.some((item) => item.includes("提交审批"))) {
    throw new Error(`个人技能详情页不完整：${JSON.stringify(privateDetail)}`);
  }
  smokeStage = "编辑个人技能";
  await click(mainWindow, '[data-edit-installed-skill]');
  const editorReady = await mainWindow.webContents.executeJavaScript(`(() => ({
    visible: !document.querySelector('#installedSkillEditModal')?.classList.contains('hidden'),
    name: document.querySelector('#installedSkillEditName')?.value || '',
    tags: [...document.querySelectorAll('#installedSkillTagEditor .installed-skill-tag')].map((item) => item.textContent.trim())
  }))()`);
  if (!editorReady.visible || editorReady.name !== "个人技能验收" || !editorReady.tags.some((item) => item.includes("自动化"))) {
    throw new Error(`个人技能编辑器没有正确载入：${JSON.stringify(editorReady)}`);
  }
  await click(mainWindow, '#installedSkillTagEditor [data-remove-installed-skill-tag]');
  await mainWindow.webContents.executeJavaScript(`(() => { const input = document.querySelector('#installedSkillTagInput'); input.value = '文档'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click(mainWindow, '[data-select-installed-skill-tag="document"]');
  await mainWindow.webContents.executeJavaScript(`(() => { const input = document.querySelector('#installedSkillTagInput'); input.value = '客户服务'; input.dispatchEvent(new Event('input', { bubbles: true })); return !document.querySelector('[data-create-installed-skill-tag]')?.hidden; })()`);
  await click(mainWindow, '[data-create-installed-skill-tag]');
  await mainWindow.webContents.executeJavaScript(`
    document.querySelector('#installedSkillEditDescription').value = '用于验证编辑、标签和审批重提流程。';
    document.querySelector('#installedSkillEditInstructions').value = '只根据用户提供的内容完成验证，不得编造。';
    true;
  `);
  await click(mainWindow, '[data-action="save-installed-skill-editor"]');
  await waitFor(async () => mainWindow.webContents.executeJavaScript(`document.querySelector('#installedSkillEditModal')?.classList.contains('hidden')`), "保存个人技能");
  const editedSkill = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getInstalledSkills({ userId: 'development-user' }).then((result) => result.skills.find((item) => item.id === 'installed-smoke-personal-skill'))`);
  if (editedSkill.description !== "用于验证编辑、标签和审批重提流程。" || !editedSkill.tagIds.includes("document") || !(editedSkill.newTags || []).includes("客户服务") || editedSkill.instructions !== "只根据用户提供的内容完成验证，不得编造。") {
    throw new Error(`个人技能编辑结果不完整：${JSON.stringify(editedSkill)}`);
  }
  if (!fs.existsSync(path.join(installedPersonalSkillPath, "scripts", "keep.js"))) throw new Error("编辑个人技能时丢失了原有脚本");
  smokeStage = "在线或本地技能自动生成审核包";
  await click(mainWindow, '[data-confirm-skill-action="submit"]');
  const submitConfirm = await mainWindow.webContents.executeJavaScript(`(() => ({
    visible: !document.querySelector('#skillActionConfirmModal')?.classList.contains('hidden'),
    title: document.querySelector('#skillActionConfirmTitle')?.textContent || '',
    text: document.querySelector('#skillActionConfirmText')?.textContent || ''
  }))()`);
  if (!submitConfirm.visible || submitConfirm.title !== "提交企业审批" || !submitConfirm.text.includes("钉钉账号")) throw new Error(`提交确认弹窗不符合预览：${JSON.stringify(submitConfirm)}`);
  await click(mainWindow, '[data-action="confirm-skill-action"]');
  await waitFor(async () => (await pageState(mainWindow)).title === "提交技能审核", "打开提交审核确认页");
  const preparedSubmission = await pageState(mainWindow);
  if (!preparedSubmission.text.includes("个人技能验收") || !preparedSubmission.text.includes("确认提交内容") || !preparedSubmission.text.includes("自动补齐企业审核格式") || preparedSubmission.actions.includes("choose-company-skill-package") || preparedSubmission.actions.includes("choose-company-skill-folder") || preparedSubmission.text.includes("未通过本地校验")) {
    throw new Error(`非标准个人技能没有生成可提交审核包：${JSON.stringify(preparedSubmission)}`);
  }
  const submissionScreenshotPath = path.join(__dirname, "build", "smoke-company-skill-submit-ready.png");
  fs.writeFileSync(submissionScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  await click(mainWindow, '[data-view="skills"]');
  await click(mainWindow, '[data-skill-tab="personal"]');
  await click(mainWindow, '[data-manage-skill]');
  const submittedAt = new Date(Date.now() - 60_000).toISOString();
  smokeStage = "检查待审核状态";
  await mainWindow.webContents.executeJavaScript(`companySkillState = {
    ...companySkillState,
    submissions: [{
      submissionId: "submission-smoke",
      skillId: "installed-smoke-personal-skill",
      name: "smoke-personal-skill",
      displayName: "个人技能验收",
      status: "pending",
      stateVersion: 1,
      submittedAt: ${JSON.stringify(submittedAt)}
    }]
  }; renderPageView();`);
  const pendingDetail = await pageState(mainWindow);
  if (pendingDetail.personalStatus !== "审批中" || !pendingDetail.hasWithdrawAction || !pendingDetail.personalTimeline.includes("提交审批")) {
    throw new Error(`个人技能待审核状态不完整：${JSON.stringify(pendingDetail)}`);
  }
  await click(mainWindow, '[data-confirm-skill-action="withdraw"]');
  const withdrawConfirm = await mainWindow.webContents.executeJavaScript(`(() => ({ visible: !document.querySelector('#skillActionConfirmModal')?.classList.contains('hidden'), title: document.querySelector('#skillActionConfirmTitle')?.textContent || '' }))()`);
  if (!withdrawConfirm.visible || withdrawConfirm.title !== "撤回审批申请") throw new Error(`撤回确认弹窗不符合预览：${JSON.stringify(withdrawConfirm)}`);
  await click(mainWindow, '[data-action="cancel-skill-action-confirm"]');
  const reviewedAt = new Date().toISOString();
  smokeStage = "检查驳回状态";
  await mainWindow.webContents.executeJavaScript(`companySkillState = {
    ...companySkillState,
    submissions: [{
      submissionId: "submission-smoke",
      skillId: "installed-smoke-personal-skill",
      name: "smoke-personal-skill",
      displayName: "个人技能验收",
      status: "rejected",
      stateVersion: 2,
      submittedAt: ${JSON.stringify(submittedAt)},
      reviewedAt: ${JSON.stringify(reviewedAt)},
      rejectionReason: "请补充一个完整示例"
    }]
  }; renderPageView();`);
  const rejectedDetail = await pageState(mainWindow);
  if (rejectedDetail.personalStatus !== "已驳回" || !rejectedDetail.personalNotice.includes("请补充一个完整示例") || !rejectedDetail.personalTimeline.includes("审批驳回") || !rejectedDetail.personalActions.some((item) => item.includes("重新提交"))) {
    throw new Error(`个人技能驳回状态不完整：${JSON.stringify(rejectedDetail)}`);
  }
  smokeStage = "删除个人技能";
  await mainWindow.webContents.executeJavaScript("companySkillState = { ...companySkillState, submissions: [] }; renderPageView(); true;");
  await click(mainWindow, '[data-confirm-skill-action="delete"]');
  const deleteConfirm = await mainWindow.webContents.executeJavaScript(`(() => ({ visible: !document.querySelector('#skillActionConfirmModal')?.classList.contains('hidden'), title: document.querySelector('#skillActionConfirmTitle')?.textContent || '' }))()`);
  if (!deleteConfirm.visible || deleteConfirm.title !== "删除个人技能") throw new Error(`删除确认弹窗不符合预览：${JSON.stringify(deleteConfirm)}`);
  await click(mainWindow, '[data-action="confirm-skill-action"]');
  await waitFor(async () => (await pageState(mainWindow)).title === "技能库", "删除个人技能后返回技能库");
  await click(mainWindow, '[data-skill-tab="personal"]');
  const afterDelete = await pageState(mainWindow);
  if (afterDelete.skillCards.some((item) => item.includes("个人技能验收"))) throw new Error(`删除后个人技能仍在列表：${JSON.stringify(afterDelete)}`);

  await click(mainWindow, '[data-action="open-skill-import"]');
  const importChoice = await mainWindow.webContents.executeJavaScript(`(() => ({
    cards: [...document.querySelectorAll('.skill-import-source-card')].map((item) => item.textContent.trim()),
    steps: [...document.querySelectorAll('.skill-import-steps strong')].map((item) => item.textContent.trim()),
    stepLabelBackground: getComputedStyle(document.querySelector('.skill-import-steps strong')).backgroundColor,
    modalHidden: document.querySelector('#skillImportModal')?.classList.contains('hidden'),
    text: document.querySelector('.skill-import-page')?.textContent || ''
  }))()`);
  if (importChoice.cards.length !== 3 || importChoice.steps.join(",") !== "选择来源,校验内容,完成导入" || importChoice.stepLabelBackground === "rgba(0, 0, 0, 0)" || !importChoice.modalHidden || !/GitHub/.test(importChoice.text) || !/Markdown/.test(importChoice.text) || !/SKILL\.md/.test(importChoice.text)) {
    throw new Error(`三步技能导入页不符合预览：${JSON.stringify(importChoice)}`);
  }
  const importScreenshotPath = path.join(__dirname, "build", "smoke-skill-import-unified.png");
  fs.writeFileSync(importScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  smokeStage = "检查技能导入校验页";
  await mainWindow.webContents.executeJavaScript(`inspectLocalSkill(${JSON.stringify(personalSkillSource)})`);
  await waitFor(async () => mainWindow.webContents.executeJavaScript(`Boolean(localSkillImport.inspection) && !localSkillImport.loading`), "读取导入技能");
  await click(mainWindow, '[data-action="validate-skill-import"]');
  const importValidation = await mainWindow.webContents.executeJavaScript(`(() => ({
    passed: document.querySelector('.skill-import-validation-card')?.textContent.includes('校验通过'),
    categories: document.querySelectorAll('[data-skill-import-field="categoryId"] option').length,
    helper: document.querySelector('.skill-import-tag-editor')?.parentElement?.textContent || '',
    nameTop: document.querySelector('[data-skill-import-field="displayName"]')?.getBoundingClientRect().top,
    categoryTop: document.querySelector('[data-skill-import-field="categoryId"]')?.getBoundingClientRect().top
  }))()`);
  if (!importValidation.passed || importValidation.categories < 2 || !importValidation.helper.includes("可直接选择已有标签") || !importValidation.helper.includes("新增") || Math.abs(importValidation.nameTop - importValidation.categoryTop) > 1) throw new Error(`技能导入校验页不完整：${JSON.stringify(importValidation)}`);
  const importValidationScreenshotPath = path.join(__dirname, "build", "smoke-skill-import-validation.png");
  fs.writeFileSync(importValidationScreenshotPath, (await mainWindow.webContents.capturePage()).toPNG());
  await mainWindow.webContents.executeJavaScript(`(() => {
    const category = document.querySelector('[data-skill-import-field="categoryId"]');
    category.value = 'efficiency-tools';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const tag = document.querySelector('#skillImportTagInput');
    tag.value = '文档';
    tag.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await click(mainWindow, '[data-select-skill-import-tag="document"]');
  await mainWindow.webContents.executeJavaScript(`(() => { const input = document.querySelector('#skillImportTagInput'); input.value = '效率提升'; input.dispatchEvent(new Event('input', { bubbles: true })); return !document.querySelector('[data-create-skill-import-tag]')?.hidden; })()`);
  await click(mainWindow, '[data-create-skill-import-tag]');
  const installReady = await mainWindow.webContents.executeJavaScript(`(() => ({ canInstall: skillImportCanInstall(), disabled: document.querySelector('[data-action="confirm-local-skill-install"]')?.disabled }))()`);
  if (!installReady.canInstall || installReady.disabled) throw new Error(`技能校验通过后仍不能安装：${JSON.stringify(installReady)}`);
  await click(mainWindow, '[data-action="confirm-local-skill-install"]');
  await waitFor(async () => mainWindow.webContents.executeJavaScript(`localSkillImport.step === 3 && Boolean(localSkillImport.installedSkillId)`), "导入技能完成");
  const importSuccess = await mainWindow.webContents.executeJavaScript(`(() => ({ success: document.querySelector('.skill-import-success')?.textContent.includes('技能导入成功'), installedSkillId: localSkillImport.installedSkillId }))()`);
  if (!importSuccess.success || !importSuccess.installedSkillId) throw new Error(`技能导入完成页不完整：${JSON.stringify(importSuccess)}`);
  await click(mainWindow, '[data-view="skills"]');
  await click(mainWindow, '[data-view="company-skill-create"]');
  const createPage = await pageState(mainWindow);
  if (createPage.title !== "创建技能" || createPage.draftFields < 15 || !createPage.actions.includes("save-company-skill-package") || !createPage.actions.includes("fill-company-skill-example") || !createPage.actions.includes("install-created-skill")) {
    throw new Error(`公司技能创建向导不完整：${JSON.stringify(createPage)}`);
  }
  await click(mainWindow, '[data-action="fill-company-skill-example"]');
  const examplePage = await pageState(mainWindow);
  const requiredExampleFields = ["name", "displayName", "description", "starter", "applicable", "inputs", "outputRequirements", "steps", "boundaries", "exceptions", "example", "supportedInputs", "outputs"];
  if (requiredExampleFields.some((key) => !String(examplePage.draftValues[key] || "").trim()) || "version" in examplePage.draftValues || examplePage.draftValues.displayName !== "项目周报整理" || !examplePage.draftValues.example.includes("图片生成速度")) {
    throw new Error(`完整示例没有正确填入：${JSON.stringify(examplePage.draftValues)}`);
  }
  smokeStage = "保存创建的技能到我的技能";
  await click(mainWindow, '[data-action="install-created-skill"]');
  await waitFor(async () => (await pageState(mainWindow)).title === "项目周报整理", "打开新建技能详情");
  const createdSkill = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.getInstalledSkills({ userId: 'development-user' }).then((result) => result.skills.find((item) => item.slug === 'project-weekly-report'))`);
  if (!createdSkill?.installed || createdSkill.name !== "项目周报整理" || createdSkill.categoryId !== "efficiency-tools") {
    throw new Error(`创建的技能没有保存到我的技能：${JSON.stringify(createdSkill)}`);
  }

  await mainWindow.webContents.executeJavaScript(`companySkillSubmission = { sourcePath: '', inspection: null, importDraft: null, loading: false, submitting: false, error: '', normalizationNote: '' }; showView('company-skill-submit')`);
  const submitPage = await pageState(mainWindow);
  if (submitPage.title !== "提交技能审核" || !submitPage.text.includes("Markdown") || !submitPage.actions.includes("choose-company-skill-folder")) {
    throw new Error(`公司技能提交页不完整：${JSON.stringify(submitPage)}`);
  }

  await click(mainWindow, '[data-view="skills"]');
  await click(mainWindow, '[data-skill-tab="enterprise"]');
  const catalogPage = await pageState(mainWindow);
  if (catalogPage.title !== "技能库" || !catalogPage.skillTabs.some((item) => item.includes("企业技能"))) throw new Error(`企业技能页签不完整：${JSON.stringify(catalogPage)}`);

  await mainWindow.webContents.executeJavaScript(`companySkillState = { ...companySkillState, submissions: [{ submissionId: 'submission-tab-smoke', name: 'smoke-personal-skill', displayName: '个人技能验收', version: '1.0.0', category: '效率工具', status: 'rejected', rejectionReason: '请补充完整示例', submittedAt: new Date().toISOString(), stateVersion: 2 }] }; skillLibraryState.tab = 'submissions'; renderSkillsPage();`);
  const minePage = await pageState(mainWindow);
  if (minePage.title !== "技能库" || !minePage.skillTabs.some((item) => item.includes("我的提交")) || !minePage.text.includes("个人技能验收") || !minePage.text.includes("请补充完整示例")) throw new Error(`我的提交页签不完整：${JSON.stringify(minePage)}`);

  const layouts = [];
  for (const [width, height] of [[1920, 1080], [1280, 800], [980, 700]]) {
    await setViewport(mainWindow, width, height);
    await click(mainWindow, '[data-view="skills"]');
    await click(mainWindow, '[data-skill-tab="all"]');
    const layout = await pageState(mainWindow);
    if (layout.bodyOverflowX > 1 || layout.skillCards.length < 5) throw new Error(`${width}x${height} 布局异常：${JSON.stringify(layout)}`);
    layouts.push({ requested: `${width}x${height}`, actual: layout.viewport, overflowX: layout.bodyOverflowX });
  }

  await setViewport(mainWindow, 1280, 800);
  await mainWindow.webContents.executeJavaScript(`showView('company-skill-create')`);
  const screenshot = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-company-skills-ui.png");
  fs.writeFileSync(screenshotPath, screenshot.toPNG());
  process.stdout.write(`${JSON.stringify({ companySkillUi: true, skillCards: skillPage.skillCards.length, tabs: skillPage.skillTabs, categories: synchronizedSkillPage.skillCategories.length, categoryNavigation: scrolledSkillPage.categoryNavigation, taxonomyRefresh: true, personalDetail: true, personalStates: [privateDetail.personalStatus, pendingDetail.personalStatus, rejectedDetail.personalStatus], personalDelete: true, unifiedImport: true, draftFields: createPage.draftFields, completeExample: true, layouts, skillPageScreenshotPath, importScreenshotPath, importValidationScreenshotPath, submissionScreenshotPath, screenshotPath })}\n`);
  if (mainWindow.webContents.debugger.isAttached()) mainWindow.webContents.debugger.detach();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`[${smokeStage}] ${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
