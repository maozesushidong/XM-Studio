process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const testRoot = path.join(__dirname, "build", `smoke-message-bubble-${Date.now().toString(36)}`);
fs.rmSync(testRoot, { recursive: true, force: true });
app.setPath("userData", testRoot);
process.env.XIANMA_USER_DATA = testRoot;
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

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow.webContents.isLoading()) {
    await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  }
  await waitFor(() => mainWindow.isVisible(), "主窗口显示");
  await delay(1500);

  const state = await mainWindow.webContents.executeJavaScript(`(() => {
    const conversation = activeConversation();
    conversation.messages = [
      { id: 'preview-user-short', role: 'user', content: '你好', attachments: [] },
      { id: 'preview-assistant', role: 'assistant', content: '你好，请问有什么可以帮你？', attachments: [] },
      {
        id: 'preview-user-long',
        role: 'user',
        content: '打开 Microsoft 浏览器搜索 ChatGPT，并在完成后告诉我当前页面标题。这是一条用于验证长文本换行与最大宽度的测试消息。',
        attachments: []
      }
    ];
    state.activeView = 'chat';
    render();
    const bubbles = [...document.querySelectorAll('.message.user .message-bubble')];
    const shortBubble = bubbles[0];
    const longBubble = bubbles[1];
    const style = getComputedStyle(shortBubble);
    const shortRect = shortBubble.getBoundingClientRect();
    const longRect = longBubble.getBoundingClientRect();
    const toolRect = document.querySelector('.composer-tool').getBoundingClientRect();
    const modelRect = document.querySelector('.model-button').getBoundingClientRect();
    const sendRect = document.querySelector('.send-button').getBoundingClientRect();
    return {
      count: bubbles.length,
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      shortWidth: shortRect.width,
      longWidth: longRect.width,
      toolLeft: toolRect.left,
      modelLeft: modelRect.left,
      sendLeft: sendRect.left,
      emptyChat: document.querySelector('#chatView').classList.contains('empty-chat'),
      viewportWidth: innerWidth
    };
  })()`);

  if (state.count !== 2) throw new Error(`用户气泡数量错误：${JSON.stringify(state)}`);
  if (state.backgroundColor !== "rgb(243, 244, 243)" || state.color !== "rgb(31, 35, 40)") {
    throw new Error(`用户气泡颜色错误：${JSON.stringify(state)}`);
  }
  if (state.borderRadius !== "14px" || state.shortWidth >= state.longWidth || state.longWidth > 682) {
    throw new Error(`用户气泡尺寸错误：${JSON.stringify(state)}`);
  }
  if (state.emptyChat || state.modelLeft <= state.toolLeft || state.sendLeft <= state.modelLeft) {
    throw new Error(`真实对话布局或模型选择位置错误：${JSON.stringify(state)}`);
  }

  await mainWindow.webContents.executeJavaScript(`(() => {
    const messages = document.querySelector('#messages');
    messages.scrollTop = messages.scrollHeight;
  })()`);
  await delay(100);
  const image = await mainWindow.webContents.capturePage();
  const screenshotPath = path.join(__dirname, "build", "smoke-message-bubble.png");
  fs.writeFileSync(screenshotPath, image.toPNG());
  process.stdout.write(`${JSON.stringify({ ...state, screenshotPath, screenshotSize: image.getSize() })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
