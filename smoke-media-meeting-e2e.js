process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_AI_API_KEY = "smoke-test-key";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const sourcePath = process.env.XIANMA_MEDIA_SMOKE_FILE
  || "C:/Users/Administrator/Downloads/拼多多智能Agent项目周会_20260811.mp3";
const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-media-meeting-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;

let capturedRequest = null;
const finalMeetingResult = [
  "拼多多智能 Agent 项目周会",
  "",
  "一句话判断",
  "退款工单自动化已进入联调阶段，当前主要阻塞是多屏坐标与 150% 缩放偏移。",
  "",
  "核心决策",
  "1. 使用 Playwright 完成页面自动化。",
  "2. OCR 作为验证码识别和异常页面识别的补充能力。",
  "",
  "任务安排",
  "1. 修复多屏坐标偏移并完成回归测试。",
  "2. 核对技能调用统计和文件占用重试。",
  "",
  "待确认事项",
  "第三方验证码识别服务的最终方案与上线时间待确认。"
].join("\n");

const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    capturedRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: finalMeetingResult } }]
    }));
  });
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForMainWindow(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) return mainWindow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("主窗口创建超时");
}

async function run() {
  if (!fs.existsSync(sourcePath)) throw new Error(`测试音频不存在：${sourcePath}`);
  const port = await listen();
  process.env.XIANMA_AI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  require("./electron/main.js");
  await app.whenReady();
  const mainWindow = await waitForMainWindow();
  if (mainWindow.webContents.isLoading()) {
    await new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve));
  }

  const outputName = `媒体会议测试-${runId}.docx`;
  const result = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion(${JSON.stringify({
    userId: "media-meeting-smoke",
    conversationId: "media-meeting-conversation",
    requestId: `media-meeting-${runId}`,
    model: "gpt-5.6-luna",
    skillId: "meeting",
    skillSlug: "dongge-meeting-model",
    message: "使用东哥会议模型直接蒸馏这段会议录音并生成 Word 文档。",
    messages: [
      { role: "system", content: "直接完成会议蒸馏，不要只回复执行计划。" },
      { role: "user", content: "使用东哥会议模型直接蒸馏这段会议录音并生成 Word 文档。" }
    ],
    attachments: [sourcePath],
    artifactOutput: {
      relativePath: `meeting/${outputName}`,
      format: "docx",
      title: "媒体会议测试"
    },
    enableFileTools: false,
    preferGateway: false,
    waitForGateway: false,
    stream: false
  })})`);

  const requestText = JSON.stringify(capturedRequest?.messages || []);
  const files = Array.isArray(result?.files) ? result.files : [];
  const docxFiles = files.filter((file) => /\.docx$/i.test(String(file.absolutePath || file.path || "")));
  const docxPath = docxFiles[0]?.absolutePath || docxFiles[0]?.path || "";
  const checks = {
    transcriptInjected: /playwright/i.test(requestText) && requestText.includes("退款工单自动化") && requestText.includes("150%缩放"),
    skillInjected: requestText.includes("东哥会议模型") && requestText.includes("先马会议蒸馏与组织知识资产化系统"),
    noPlanningOnlyReply: !/(准备转写|开始转写|重新上传|允许.*转写)/.test(String(result?.content || "")),
    finalResultReturned: String(result?.content || "").includes("退款工单自动化") && String(result?.content || "").includes("任务安排"),
    oneDocxReturned: docxFiles.length === 1,
    docxWritten: Boolean(docxPath && fs.existsSync(docxPath) && fs.statSync(docxPath).size > 1000)
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`媒体会议端到端测试失败：${failed.join(", ")}`);
  process.stdout.write(`${JSON.stringify({ mediaMeetingE2E: true, docxPath, docxBytes: fs.statSync(docxPath).size, ...checks })}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(0);
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server.close();
  app.exit(1);
});
