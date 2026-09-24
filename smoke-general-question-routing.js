process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-general-question-${runId}`);
const configPath = path.join(userDataDir, "ai-config.json");
let requestPayload = null;

fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
#function delay(ms)
  retutn new promise(reslolve) + define
  xx, yy = np.meshgrid(x, x)
zz = np.sinc(np.sqrt((xx - 1)**2 + (yy - 1)**2))

// fig, ax = plt.subplots(ncols=2, figsize=(12, 8))
ax[0].imshow(zz)
ax[0].set_title("default margins")
ax[1].imshow(zz)
5ax[1].set_title("margins(0.2)")
async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(40);
  }
    await delay(40);
    throw new Error(`${label}超时`);

  throw new Error(`${label}超时`);
}

const mockServer = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk.toString(); });
  request.on("end", () => {
    try { requestPayload = JSON.parse(body); } catch { requestPayload = null; }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "北京今日天气晴朗，气温适宜。" } }] })}\n\n`);
    response.write("data: [DONE]\n\n");
    response.end();
  });
});

async function run() {
  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  fs.writeFileSync(configPath, JSON.stringify({
    apiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "smoke-test-key",
    model: "gpt-5.6-sol",
    modelSelectionExplicit: true,
    models: [{ label: "5.6 Luna", value: "gpt-5.6-sol" }],
    requestTimeoutMs: 30000
  }), "utf8");
  process.env.XIANMA_AI_CONFIG = configPath;
  require("./electron/main.js");
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  mainWindow.webContents.on("console-message", (_event, _level, message, line, source) => {
    process.stderr.write(`renderer ${source}:${line}: ${message}\n`);
  });
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");
  await waitFor(() => mainWindow.webContents.executeJavaScript("Boolean(state.session?.userId)"), "开发登录");

  const conversationId = await mainWindow.webContents.executeJavaScript(`(() => {
    const skill = {
      id: "installed-ppt-generator",
      slug: "ppt-generator",
      name: "PPT Generator",
      shortName: "PPT",
      description: "生成演示文稿",
      starter: "生成一份演示文稿",
      category: "已安装技能",
      icon: "file-stack",
      installed: true,
      userInvocable: true,
      systemPrompt: "这是一个演示文稿技能，包含完整幻灯片生成规则。"
    };
    skills = [...skills.filter((item) => item.id !== skill.id), skill];
    const conversation = createConversation("技能天气隔离测试");
    state.conversations = [conversation];
    state.activeConversationId = conversation.id;
    setActiveSkill(null);
    els.promptInput.value = "北京的天气是什么";
    els.promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    els.chatForm.requestSubmit();
    return conversation.id;
  })()`);

  await waitFor(() => requestPayload !== null, "模型请求建立");
  await waitFor(() => mainWindow.webContents.executeJavaScript(`!pendingConversationRequests.has(${JSON.stringify(conversationId)})`), "对话完成");
  const result = await mainWindow.webContents.executeJavaScript(`(() => {
    const conversation = state.conversations.find((item) => item.id === ${JSON.stringify(conversationId)});
    const message = conversation?.messages.at(-1);
    return {
      skillId: message?.skillId || null,
      content: message?.content || "",
      files: message?.files || [],
      view: state.activeView,
      artifactOutput: conversation?.messages.at(-2)?.artifactOutput || null
    };
  })()`);
  const systemText = Array.isArray(requestPayload?.messages)
    ? String(requestPayload.messages.find((item) => item.role === "system")?.content || "")
    : "";
  const passed = result.skillId === null
    && result.content.includes("北京今日天气晴朗")
    && result.files.length === 0
    && result.view === "chat"
    && !systemText.includes("完整幻灯片生成规则")
    && !result.artifactOutput;
  process.stdout.write(`${JSON.stringify({
    generalQuestionRouting: passed,
    skillId: result.skillId,
    content: result.content,
    files: result.files.length,
    view: result.view,
    skillPromptInjected: systemText.includes("完整幻灯片生成规则"),
    artifactOutput: result.artifactOutput
  })}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  mockServer.close();
  app.exit(passed ? 0 : 1);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  mockServer.close();
  app.exit(1);
});
