process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow, clipboard } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-concurrent-${runId}`);
const configPath = path.join(userDataDir, "ai-config.json");
let activeRequests = 0;
let maxConcurrentRequests = 0;
let stopRequestsStarted = 0;
let abortedRequests = 0;
let automaticChatResolvedModel = "";
let imageRequestModel = "";
let imageGenerationRequests = 0;
let imageCopywritingRequest = null;
let imageEditRequests = 0;
let reportRequestMessageCount = 0;
const testImageBase64 = fs.readFileSync(path.join(__dirname, "renderer", "assets", "icon.png")).toString("base64");

fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;

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

const mockServer = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/v1/images/generations") {
    let imageBody = "";
    request.on("data", (chunk) => { imageBody += chunk.toString(); });
    request.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(imageBody); } catch { payload = {}; }
      imageGenerationRequests += 1;
      imageRequestModel = String(payload.model || "");
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        data: [{ b64_json: testImageBase64 }]
      }));
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/images/edits") {
    request.resume();
    request.on("end", () => {
      imageEditRequests += 1;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        data: [{ b64_json: testImageBase64 }]
      }));
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end();
    return;
  }

  let body = "";
  request.on("data", (chunk) => { body += chunk.toString(); });
  request.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch { payload = {}; }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const lastContent = messages.at(-1)?.content;
    const prompt = typeof lastContent === "string"
      ? lastContent
      : (Array.isArray(lastContent) ? lastContent.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : String(lastContent || ""));
    if (prompt.includes("附件图片生成客服话术")) {
      imageCopywritingRequest = {
        model: String(payload.model || ""),
        hasImage: Array.isArray(lastContent) && lastContent.some((part) => part?.type === "image_url")
      };
    }
    if (prompt.includes("自动模型路由测试")) automaticChatResolvedModel = String(payload.model || "");
    const isReport = prompt.includes("周报真实生成测试");
    const isHtmlArtifact = prompt.includes("HTML快速生成测试");
    const isDocxFilter = prompt.includes("DOCX中间脚本过滤测试");
    if (isReport) reportRequestMessageCount = messages.length;
    if (isDocxFilter) {
      const generatedDir = path.join(userDataDir, "users", "docx-filter-user", "files", "generated");
      fs.mkdirSync(generatedDir, { recursive: true });
      fs.writeFileSync(path.join(generatedDir, "create_document.py"), "print('internal helper')\n", "utf8");
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "北京天气简报\n\n北京今日天气晴朗，适合正常通勤。" } }]
      }));
      return;
    }
    const isFirst = prompt.includes("第一个并行问题");
    const isStop = prompt.includes("停止生成测试");
    const content = prompt.includes("附件图片生成客服话术")
      ? "已根据附件图片生成客服话术。"
      : (isStop
      ? "这段内容不应完整返回"
      : (isHtmlArtifact
      ? "```html\n<!doctype html><html><head><meta charset=\"utf-8\"><title>快速文件</title></head><body>快速文件生成成功</body></html>\n```"
      : (isReport
      ? "本周完成\n1. 完成客户需求评审。\n2. 修复安装流程问题。\n\n风险问题\n1. 图片接口权限尚未开通。\n\n下周计划\n1. 完成正式验收。"
      : (isFirst
      ? "# 第一项结果\n\n- **状态**：完成\n- 中文内容正常\n\n| 项目 | 结果 |\n| --- | --- |\n| 并行 | 通过 |"
      : "## 第二项结果\n\n1. **状态**：完成\n2. 中文内容正常"))));
    const responseDelay = isStop ? 8000 : (isFirst ? 850 : 220);
    activeRequests += 1;
    if (isStop) stopRequestsStarted += 1;
    maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
    let completed = false;
    const finishRequest = () => {
      if (completed) return;
      completed = true;
      activeRequests -= 1;
    };

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    if (isStop) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "已输出的部分内容" } }] })}\n\n`);
    }
    const timer = setTimeout(() => {
      if (response.destroyed) return;
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      response.write("data: [DONE]\n\n");
      finishRequest();
      response.end();
    }, responseDelay);
    response.on("close", () => {
      clearTimeout(timer);
      if (!completed && isStop) abortedRequests += 1;
      finishRequest();
    });
  });
});

async function run() {
  const address = mockServer.address();
  fs.writeFileSync(configPath, JSON.stringify({
    apiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "smoke-test-key",
    model: "gpt-5.6-sol",
    modelSelectionExplicit: true,
    models: [{ label: "5.6 Sol", value: "gpt-5.6-sol" }],
    requestTimeoutMs: 30000
  }), "utf8");
  process.env.XIANMA_AI_CONFIG = configPath;
  require("./electron/main.js");

  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await delay(500);
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(state.session?.userId)"), "开发登录");

  const ids = await mainWindow.webContents.executeJavaScript(`(() => {
    state.conversations = [createConversation('并行任务一')];
    state.activeConversationId = state.conversations[0].id;
    state.activeView = 'chat';
    render();
    const firstId = state.activeConversationId;
    els.promptInput.value = '第一个并行问题';
    els.promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.chatForm.requestSubmit();
    createNewConversation();
    const secondId = state.activeConversationId;
    els.promptInput.value = '第二个并行问题';
    els.promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.chatForm.requestSubmit();
    return { firstId, secondId };
  })()`);

  await waitFor(() => maxConcurrentRequests >= 2, "并行请求建立");
  await waitFor(() => mainWindow.webContents.executeJavaScript("pendingConversationRequests.size === 0"), "并行请求完成");

  const result = await mainWindow.webContents.executeJavaScript(`(() => {
    const first = state.conversations.find((item) => item.id === ${JSON.stringify(ids.firstId)});
    const second = state.conversations.find((item) => item.id === ${JSON.stringify(ids.secondId)});
    setActiveConversation(${JSON.stringify(ids.firstId)});
    const firstBubble = document.querySelector('.message.assistant .rich-content');
    const formatting = {
      heading: Boolean(firstBubble?.querySelector('h1')),
      list: Boolean(firstBubble?.querySelector('ul li')),
      bold: Boolean(firstBubble?.querySelector('strong')),
      table: Boolean(firstBubble?.querySelector('table')),
      rawMarkers: /(^|\\s)[#*]{1,3}(?=\\s|$)/m.test(firstBubble?.innerText || ''),
      chinese: (firstBubble?.innerText || '').includes('中文内容正常'),
      scriptCount: firstBubble?.querySelectorAll('script').length || 0
    };
    const unsafeHost = document.createElement('div');
    unsafeHost.innerHTML = renderRichText('## 安全测试\\n\\n<script>window.__unsafe = true</script>\\n\\n- **正常内容**');
    const freshConversation = createConversation('文件能力判断');
    const managedConversation = createConversation('待管理对话');
    state.conversations.push(managedConversation);
    for (let index = 0; index < 9; index += 1) {
      const extraConversation = createConversation('侧栏布局验证 ' + (index + 1));
      extraConversation.messages.push({ role: 'assistant', content: '这是一条用于验证摘要不会与下一条对话重叠的消息。' });
      state.conversations.push(extraConversation);
    }
    toggleConversationPin(managedConversation.id);
    startConversationRename(managedConversation.id);
    const renameInput = document.querySelector('[data-conversation-rename-input="' + managedConversation.id + '"]');
    renameInput.value = '已置顶的自定义名称';
    saveConversationRename(managedConversation.id);
    const fileConversation = createConversation('已有文件');
    fileConversation.messages.push({ role: 'assistant', content: '文件已生成', files: [{ path: 'C:\\\\Temp\\\\demo.html', name: 'demo.html' }] });
    const contextConversation = createConversation('完整上下文');
    for (let index = 0; index < 25; index += 1) {
      contextConversation.messages.push(
        { role: 'user', content: '历史用户消息 ' + index, attachments: [], loading: false },
        { role: 'assistant', content: '历史助手消息 ' + index, files: [], images: [], loading: false }
      );
    }
    contextConversation.messages.push({ role: 'assistant', content: '已生成历史图片', images: [{ localPath: 'C:\\\\Temp\\\\history.png' }], files: [], loading: false });
    const mediaConversation = createConversation('音视频附件续用');
    mediaConversation.messages.push({ role: 'user', content: '总结这段会议录音', attachments: [{ absolutePath: 'C:/Temp/meeting.mp3', kind: 'audio' }], loading: false });
    mediaConversation.messages.push({ role: 'assistant', content: '已收到会议录音', files: [], images: [], loading: false });
    const retainedMessages = buildRemoteMessages(contextConversation, null);
    const reusedImages = resolveConversationImagePaths(contextConversation, { content: '把刚才那张图片背景改成白色', attachments: [] });
    const reusedMedia = resolveMessageAttachments(mediaConversation, [], '继续处理这段录音');
    const unrelatedMedia = resolveMessageAttachments(mediaConversation, [], '中国的首都在哪里？');
    const previousModel = state.config.model;
    state.config.model = 'gpt-image-2';
    const productImageAttachment = [{ absolutePath: 'C:\\Temp\\product.png', kind: 'image', mimeType: 'image/png' }];
    const imageIntent = {
      attachedCopywriting: isImageGenerationRequest({ content: '请根据附件图片生成客服话术', attachments: productImageAttachment }, null, freshConversation),
      referencedCopywriting: isImageGenerationRequest({ content: '基于图片生成销售话术', attachments: productImageAttachment }, null, freshConversation),
      imageAnalysis: isImageGenerationRequest({ content: '分析这张图片并提取产品卖点', attachments: productImageAttachment }, null, freshConversation),
      explicitPoster: isImageGenerationRequest({ content: '基于这张图片生成一张产品海报', attachments: productImageAttachment }, null, freshConversation),
      promptOnlyImageModel: isImageGenerationRequest({ content: '蓝天、草地和白色办公楼', attachments: [] }, null, freshConversation)
    };
    state.config.model = previousModel;
    const firstAssistant = first.messages.find((message) => message.role === 'assistant');
    const conversationRows = [...document.querySelectorAll('[data-conversation-row]')];
    const rowRects = conversationRows.map((row) => row.getBoundingClientRect());
    const firstItemRect = conversationRows[0]?.querySelector('.conversation-item')?.getBoundingClientRect();
    const firstTitleRect = conversationRows[0]?.querySelector('.conversation-title-line')?.getBoundingClientRect();
    const firstMenuRect = conversationRows[0]?.querySelector('.conversation-menu-button')?.getBoundingClientRect();
    const conversationList = document.querySelector('#conversationList');
    const sidebarRect = document.querySelector('.sidebar')?.getBoundingClientRect();
    const deletableConversation = createConversation('待删除对话');
    state.conversations.push(deletableConversation);
    const deleteCountBefore = state.conversations.length;
    openConversationDelete(deletableConversation.id);
    const deleteModalVisible = !document.querySelector('#conversationDeleteModal').classList.contains('hidden');
    confirmConversationDelete();
    return {
      firstCompleted: Boolean(first?.messages.at(-1)?.content.includes('第一项结果')) && first.messages.at(-1).loading === false,
      secondCompleted: Boolean(second?.messages.at(-1)?.content.includes('第二项结果')) && second.messages.at(-1).loading === false,
      formatting,
      sanitizer: {
        scriptCount: unsafeHost.querySelectorAll('script').length,
        hasHeading: Boolean(unsafeHost.querySelector('h2')),
        hasBold: Boolean(unsafeHost.querySelector('strong')),
        chinese: unsafeHost.textContent.includes('正常内容'),
        executed: window.__unsafe === true
      },
      accountSubtitle: document.querySelector('#accountSubtitle')?.textContent || '',
      logoutText: document.querySelector('[data-action="logout"]')?.innerText || '',
      productTitle: document.title,
      productName: document.querySelector('.brand-name')?.textContent || '',
      modelOptions: [...document.querySelectorAll('[data-model-value]')].map((item) => item.dataset.modelValue),
      workspaceNavCount: document.querySelectorAll('[data-view="workspace"]').length,
      conversationManagement: {
        id: managedConversation.id,
        title: managedConversation.title,
        customTitle: managedConversation.customTitle === true,
        pinned: managedConversation.pinned === true,
        firstRowId: document.querySelector('[data-conversation-row]')?.dataset.conversationRow || ''
      },
      conversationDelete: {
        modalVisible: deleteModalVisible,
        removed: !state.conversations.some((item) => item.id === deletableConversation.id),
        countBefore: deleteCountBefore,
        countAfter: state.conversations.length
      },
      contextMemory: {
        retainedCount: retainedMessages.length,
        firstHistory: retainedMessages[1]?.content || '',
        lastHistory: retainedMessages.at(-1)?.content || '',
        reusedImages,
        reusedMedia: attachmentPathList(reusedMedia),
        unrelatedMedia: attachmentPathList(unrelatedMedia)
      },
      imageIntent,
      answerCopy: {
        messageId: firstAssistant?.id || '',
        buttonVisible: Boolean(firstAssistant?.id && document.querySelector('[data-message-copy="' + firstAssistant.id + '"]')),
        expectedText: firstAssistant?.content || ''
      },
      sidebarLayout: {
        width: sidebarRect?.width || 0,
        firstItemHeight: firstItemRect?.height || 0,
        rowsOverlap: rowRects.some((rect, index) => index > 0 && rect.top < rowRects[index - 1].bottom - 0.5),
        titleClearOfMenu: Boolean(firstTitleRect && firstMenuRect && firstTitleRect.right <= firstMenuRect.left + 1),
        overflowY: conversationList ? getComputedStyle(conversationList).overflowY : ''
      },
      routes: {
        simple: shouldUseFileCapabilities(freshConversation, { content: '中国的首都在哪里？', attachments: [] }),
        freshFile: shouldUseFileCapabilities(freshConversation, { content: '请生成一个俄罗斯方块网页并直接运行', attachments: [] }),
        bareArtifact: shouldUseFileCapabilities(freshConversation, { content: '俄罗斯方块游戏', attachments: [] }),
        explainOnly: shouldUseFileCapabilities(freshConversation, { content: '如何理解创建文件的原理？', attachments: [] }),
        attachment: shouldUseFileCapabilities(freshConversation, { content: '分析一下', attachments: ['C:\\\\Temp\\\\a.txt'] }),
        followUp: shouldUseFileCapabilities(fileConversation, { content: '继续把它改成蓝色并打开', attachments: [] }),
        explicitOutput: shouldUseFileCapabilities(freshConversation, { content: '把结果保存到桌面文件夹', attachments: [] }),
        fullForGame: shouldUseFullAgentCapabilities(freshConversation, { content: '生成一个俄罗斯方块网页并预览', attachments: [] }),
        fullForBrowser: shouldUseFullAgentCapabilities(freshConversation, { content: '操作浏览器登录网站并点击提交', attachments: [] }),
        fullForMedia: shouldUseFullAgentCapabilities(mediaConversation, { content: '继续处理这段录音', attachments: reusedMedia })
      }
    };
  })()`);

  await mainWindow.webContents.executeJavaScript(`copyMessageText(${JSON.stringify(result.answerCopy.messageId)})`);
  const copiedAnswer = clipboard.readText();

  if (maxConcurrentRequests < 2 || !result.firstCompleted || !result.secondCompleted) {
    throw new Error(`多会话没有并行完成：${JSON.stringify({ maxConcurrentRequests, result })}`);
  }
  if (!result.formatting.heading || !result.formatting.list || !result.formatting.bold || !result.formatting.table || result.formatting.rawMarkers || !result.formatting.chinese) {
    throw new Error(`结构化回答排版失败：${JSON.stringify(result.formatting)}`);
  }
  if (result.sanitizer.scriptCount !== 0 || !result.sanitizer.hasHeading || !result.sanitizer.hasBold || !result.sanitizer.chinese || result.sanitizer.executed) {
    throw new Error(`回答内容清洗失败：${JSON.stringify(result.sanitizer)}`);
  }
  if (!result.answerCopy.buttonVisible || copiedAnswer !== result.answerCopy.expectedText) {
    throw new Error(`回答一键复制不正确：${JSON.stringify({ answerCopy: result.answerCopy, copiedAnswer })}`);
  }
  if (result.imageIntent.attachedCopywriting || result.imageIntent.referencedCopywriting || result.imageIntent.imageAnalysis || !result.imageIntent.explicitPoster || !result.imageIntent.promptOnlyImageModel) {
    throw new Error(`图片与文字意图路由不正确：${JSON.stringify(result.imageIntent)}`);
  }
  if (result.accountSubtitle !== "钉钉账号" || result.logoutText !== "退出登录" || result.productTitle !== "XMAI Studio" || result.productName !== "XMAI Studio") {
    throw new Error(`品牌或账号文案不正确：${JSON.stringify(result)}`);
  }
  if (result.routes.simple !== false || result.routes.freshFile !== true || result.routes.bareArtifact !== true || result.routes.explainOnly !== false || result.routes.attachment !== true || result.routes.followUp !== true || result.routes.explicitOutput !== true || result.routes.fullForGame !== false || result.routes.fullForBrowser !== true || result.routes.fullForMedia !== false) {
    throw new Error(`文件能力动态路由不正确：${JSON.stringify(result.routes)}`);
  }
  if (!result.conversationDelete.modalVisible || !result.conversationDelete.removed || result.conversationDelete.countAfter !== result.conversationDelete.countBefore - 1) {
    throw new Error(`会话删除不正确：${JSON.stringify(result.conversationDelete)}`);
  }
  if (result.contextMemory.retainedCount !== 52 || !result.contextMemory.firstHistory.includes("历史用户消息 0") || !result.contextMemory.lastHistory.includes("history.png") || result.contextMemory.reusedImages.length !== 1 || result.contextMemory.reusedMedia[0] !== "C:/Temp/meeting.mp3" || result.contextMemory.unrelatedMedia.length !== 0) {
    throw new Error(`完整上下文或历史图片复用不正确：${JSON.stringify(result.contextMemory)}`);
  }
  if (!result.modelOptions.includes("auto") || !result.modelOptions.includes("gpt-image-2") || result.workspaceNavCount !== 0) {
    throw new Error(`模型选项或统一对话入口不正确：${JSON.stringify(result)}`);
  }
  if (result.conversationManagement.title !== "已置顶的自定义名称" || !result.conversationManagement.customTitle || !result.conversationManagement.pinned || result.conversationManagement.firstRowId !== result.conversationManagement.id) {
    throw new Error(`会话重命名或置顶不正确：${JSON.stringify(result.conversationManagement)}`);
  }
  if (result.sidebarLayout.width < 270 || result.sidebarLayout.firstItemHeight < 54 || result.sidebarLayout.rowsOverlap || !result.sidebarLayout.titleClearOfMenu || result.sidebarLayout.overflowY !== "auto") {
    throw new Error(`左侧会话布局不正确：${JSON.stringify(result.sidebarLayout)}`);
  }

  const imageAttachmentPath = path.join(__dirname, "renderer", "assets", "icon.png");
  const imageCopywritingConversationId = await mainWindow.webContents.executeJavaScript(`(() => {
    createNewConversation();
    const conversationId = state.activeConversationId;
    state.config.model = 'gpt-image-2';
    state.config.modelSelectionExplicit = true;
    state.selectedFiles = [{
      absolutePath: ${JSON.stringify(imageAttachmentPath)},
      path: ${JSON.stringify(imageAttachmentPath)},
      name: 'product.png',
      extension: 'png',
      kind: 'image',
      mimeType: 'image/png'
    }];
    els.promptInput.value = '请根据附件图片生成客服话术';
    els.promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.chatForm.requestSubmit();
    return conversationId;
  })()`);
  await waitFor(() => imageCopywritingRequest !== null, "图片话术进入多模态对话");
  await waitFor(() => mainWindow.webContents.executeJavaScript(`!pendingConversationRequests.has(${JSON.stringify(imageCopywritingConversationId)})`), "图片话术生成完成");
  const imageCopywritingResult = await mainWindow.webContents.executeJavaScript(`(() => {
    const conversation = state.conversations.find((item) => item.id === ${JSON.stringify(imageCopywritingConversationId)});
    const message = conversation?.messages.at(-1);
    return { content: message?.content || '', images: message?.images || [], files: message?.files || [] };
  })()`);
  if (imageGenerationRequests !== 0 || imageCopywritingRequest?.model !== "gpt-5.6-sol" || !imageCopywritingRequest?.hasImage || !imageCopywritingResult.content.includes("生成客服话术") || imageCopywritingResult.images.length !== 0) {
    throw new Error(`图片话术完整路由不正确：${JSON.stringify({ imageGenerationRequests, imageCopywritingRequest, imageCopywritingResult })}`);
  }
  await mainWindow.webContents.executeJavaScript(`(() => {
    state.config.model = 'gpt-5.6-sol';
    state.config.modelSelectionExplicit = true;
    saveState();
    renderModelPicker();
  })()`);

  const modelRouting = await mainWindow.webContents.executeJavaScript(`Promise.all([
    window.desktopBridge.chatCompletion({
      userId: 'model-routing-user',
      conversationId: 'model-routing-conversation',
      requestId: 'model-routing-chat',
      model: 'auto',
      preferGateway: false,
      enableFileTools: false,
      stream: true,
      messages: [{ role: 'user', content: '自动模型路由测试' }]
    }),
    window.desktopBridge.generateImage({
      userId: 'model-routing-user',
      requestId: 'model-routing-image',
      model: 'gpt-image-2',
      prompt: '生成一张测试图片'
    })
  ])`);
  if (automaticChatResolvedModel !== "gpt-5.6-sol" || imageRequestModel !== "gpt-image-2" || modelRouting[1]?.model !== "gpt-image-2") {
    throw new Error(`前后端模型路由不正确：${JSON.stringify({ automaticChatResolvedModel, imageRequestModel, imageResultModel: modelRouting[1]?.model })}`);
  }

  const imageCopyResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.copyArtifact(${JSON.stringify(modelRouting[1]?.images?.[0]?.localPath || "")})`);
  if (imageCopyResult?.copiedAs !== "image" || clipboard.readImage().isEmpty()) {
    throw new Error(`生成图片复制不正确：${JSON.stringify(imageCopyResult)}`);
  }

  const imageEditResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.generateImage({
    userId: 'model-routing-user',
    requestId: 'model-routing-image-edit',
    model: 'gpt-image-2',
    prompt: '把刚才那张图片背景改成白色',
    sourceImagePath: ${JSON.stringify(modelRouting[1]?.images?.[0]?.localPath || "")}
  })`);
  if (imageEditRequests !== 1 || !imageEditResult?.images?.[0]?.localPath || !fs.existsSync(imageEditResult.images[0].localPath)) {
    throw new Error(`历史图片编辑链路不正确：${JSON.stringify({ imageEditRequests, imageEditResult })}`);
  }

  const reportResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
    userId: 'report-user',
    conversationId: 'report-conversation',
    requestId: 'report-request',
    model: 'gpt-5.6-sol',
    preferGateway: false,
    waitForGateway: false,
    enableFileTools: false,
    stream: true,
    artifactOutput: { relativePath: 'reports/weekly-test.docx', format: 'docx', title: '工作周报' },
    messages: [
      { role: 'system', content: '根据真实素材整理周报，不得编造。' },
      ...Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: '历史上下文 ' + index })),
      { role: 'user', content: '周报真实生成测试：完成客户需求评审，修复安装问题。' }
    ]
  })`);
  const reportPath = reportResult?.files?.[0]?.path || "";
  const reportHeader = reportPath && fs.existsSync(reportPath) ? fs.readFileSync(reportPath).subarray(0, 2).toString("ascii") : "";
  if (reportRequestMessageCount !== 42 || !reportResult?.content?.includes("完成客户需求评审") || !reportPath.endsWith(".docx") || reportHeader !== "PK") {
    throw new Error(`完整上下文周报落盘不正确：${JSON.stringify({ reportRequestMessageCount, reportResult, reportHeader })}`);
  }

  const docxFilterResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
    userId: 'docx-filter-user',
    conversationId: 'docx-filter-conversation',
    requestId: 'docx-filter-request',
    model: 'gpt-5.6-sol',
    preferGateway: false,
    waitForGateway: false,
    enableFileTools: true,
    stream: false,
    artifactOutput: { relativePath: 'generated/beijing-weather.docx', format: 'docx', title: '北京天气简报' },
    messages: [{ role: 'user', content: 'DOCX中间脚本过滤测试' }]
  })`);
  const visibleDocxFiles = Array.isArray(docxFilterResult?.files) ? docxFilterResult.files : [];
  const internalScriptPath = path.join(userDataDir, "users", "docx-filter-user", "files", "generated", "create_document.py");
  if (
    visibleDocxFiles.length !== 1
    || !visibleDocxFiles[0]?.path?.endsWith("beijing-weather.docx")
    || !fs.existsSync(visibleDocxFiles[0].path)
    || !fs.existsSync(internalScriptPath)
    || visibleDocxFiles.some((file) => /\.py$/i.test(String(file?.path || "")))
  ) {
    throw new Error(`Word成品文件过滤不正确：${JSON.stringify({ docxFilterResult, internalScriptPath })}`);
  }

  const htmlResult = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion({
    userId: 'html-user',
    conversationId: 'html-conversation',
    requestId: 'html-request',
    model: 'gpt-5.6-sol',
    preferGateway: false,
    waitForGateway: false,
    enableFileTools: false,
    autoPreviewHtml: true,
    stream: true,
    artifactOutput: { relativePath: 'generated/fast-proof.html', format: 'html', title: '快速文件' },
    messages: [{ role: 'user', content: 'HTML快速生成测试' }]
  })`);
  const htmlPath = htmlResult?.files?.[0]?.path || "";
  if (!htmlPath.endsWith("fast-proof.html") || !fs.existsSync(htmlPath) || !fs.readFileSync(htmlPath, "utf8").includes("快速文件生成成功") || htmlResult?.previewPath !== htmlPath) {
    throw new Error(`确定性 HTML 快速生成不正确：${JSON.stringify(htmlResult)}`);
  }

  const stopConversationId = await mainWindow.webContents.executeJavaScript(`(() => {
    createNewConversation();
    const conversationId = state.activeConversationId;
    els.promptInput.value = '停止生成测试';
    els.promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    els.chatForm.requestSubmit();
    return conversationId;
  })()`);
  await waitFor(() => stopRequestsStarted === 1, "停止测试请求建立");
  await waitFor(() => mainWindow.webContents.executeJavaScript(`activeConversation().messages.at(-1)?.content.includes('已输出的部分内容')`), "部分流式内容到达");
  const stopUi = await mainWindow.webContents.executeJavaScript(`(() => {
    const glyph = els.sendButton.querySelector('svg.svg-icon');
    const buttonRect = els.sendButton.getBoundingClientRect();
    const glyphRect = glyph?.getBoundingClientRect();
    const buttonStyle = getComputedStyle(els.sendButton);
    const glyphStyle = glyph ? getComputedStyle(glyph) : null;
    return {
      type: els.sendButton.type,
      title: els.sendButton.title,
      stopClass: els.sendButton.classList.contains('stop-button'),
      glyph: Boolean(glyph),
      disabled: els.sendButton.disabled,
      buttonDisplay: buttonStyle.display,
      glyphWidth: glyphStyle?.width || '',
      glyphHeight: glyphStyle?.height || '',
      hasStopRect: Boolean(glyph?.querySelector('rect[fill="currentColor"]')),
      centerOffsetX: glyphRect ? Math.abs((buttonRect.left + buttonRect.width / 2) - (glyphRect.left + glyphRect.width / 2)) : 99,
      centerOffsetY: glyphRect ? Math.abs((buttonRect.top + buttonRect.height / 2) - (glyphRect.top + glyphRect.height / 2)) : 99
    };
  })()`);
  if (
    stopUi.type !== "button"
    || stopUi.title !== "停止生成"
    || !stopUi.stopClass
    || !stopUi.glyph
    || stopUi.disabled
    || !stopUi.buttonDisplay.includes("grid")
    || stopUi.glyphWidth !== "15px"
    || stopUi.glyphHeight !== "15px"
    || !stopUi.hasStopRect
    || stopUi.centerOffsetX > 1
    || stopUi.centerOffsetY > 1
  ) {
    throw new Error(`停止按钮状态不正确：${JSON.stringify(stopUi)}`);
  }
  const stopStartedAt = Date.now();
  await mainWindow.webContents.executeJavaScript(`els.sendButton.click()`);
  await waitFor(() => mainWindow.webContents.executeJavaScript(`!pendingConversationRequests.has(${JSON.stringify(stopConversationId)})`), "停止生成完成", 5000);
  await waitFor(() => abortedRequests >= 1, "模型连接中止", 5000);
  const stopElapsedMs = Date.now() - stopStartedAt;
  const stopResult = await mainWindow.webContents.executeJavaScript(`(() => {
    const conversation = state.conversations.find((item) => item.id === ${JSON.stringify(stopConversationId)});
    const message = conversation?.messages.at(-1);
    return {
      content: message?.content || '',
      stopped: message?.stopped === true,
      loading: message?.loading === true,
      buttonType: els.sendButton.type,
      buttonTitle: els.sendButton.title,
      buttonIcon: Boolean(els.sendButton.querySelector('svg.svg-icon'))
    };
  })()`);
  if (stopElapsedMs >= 5000 || !stopResult.stopped || stopResult.loading || !stopResult.content.includes("已输出的部分内容") || !stopResult.content.includes("已停止生成") || stopResult.buttonType !== "submit" || stopResult.buttonTitle !== "发送" || !stopResult.buttonIcon) {
    throw new Error(`停止生成结果不正确：${JSON.stringify({ stopElapsedMs, stopResult, abortedRequests })}`);
  }

  const copyButtonLayout = await mainWindow.webContents.executeJavaScript(`(() => {
    setActiveConversation(${JSON.stringify(ids.firstId)});
    const message = document.querySelector('.message.assistant');
    const bubble = message?.querySelector('.message-bubble');
    const actions = message?.querySelector('.message-actions');
    const button = actions?.querySelector('[data-message-copy]');
    const messageRect = message?.getBoundingClientRect();
    const bubbleRect = bubble?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    const buttonRect = button?.getBoundingClientRect();
    return {
      visible: Boolean(button && buttonRect?.width > 0 && buttonRect?.height > 0),
      label: button?.innerText || '',
      title: button?.title || '',
      belowAnswer: Boolean(bubbleRect && actionsRect && actionsRect.top >= bubbleRect.bottom - 1),
      withinMessage: Boolean(messageRect && buttonRect && buttonRect.left >= messageRect.left && buttonRect.right <= messageRect.right + 1),
      width: buttonRect?.width || 0,
      height: buttonRect?.height || 0
    };
  })()`);
  if (!copyButtonLayout.visible || copyButtonLayout.label !== "复制" || copyButtonLayout.title !== "复制回答" || !copyButtonLayout.belowAnswer || !copyButtonLayout.withinMessage || copyButtonLayout.width < 40 || copyButtonLayout.height < 28) {
    throw new Error(`回答复制按钮布局不正确：${JSON.stringify(copyButtonLayout)}`);
  }

  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-concurrent-chat.png");
  fs.writeFileSync(screenshotPath, image.toPNG());
  process.stdout.write(`${JSON.stringify({
    concurrentConversations: true,
    maxConcurrentRequests,
    structuredFormatting: true,
    chineseEncoding: true,
    sanitizer: true,
    accountCopy: true,
    dynamicFileRouting: true,
    fullContextRetained: true,
    historicalImageEdit: true,
    generatedImageCopy: true,
    reportDocumentCreated: true,
    docxIntermediateFileHidden: true,
    deterministicHtmlCreated: true,
    conversationDelete: true,
    stopGeneration: true,
    partialOutputPreserved: true,
    answerCopy: true,
    imageTextIntent: true,
    stopElapsedMs,
    productName: "XMAI Studio",
    screenshotPath
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  mockServer.close();
  app.exit(0);
}

mockServer.listen(0, "127.0.0.1", () => {
  run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    mockServer.close();
    app.exit(1);
  });
});

mockServer.on("upgrade", (_request, socket) => {
  socket.end();
});
