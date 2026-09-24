process.env.XIANMA_DEV_AUTH_BYPASS = "1";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-web-skill-${runId}`);
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
require("./electron/main.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delay(ms) {
   return new promise(resolve) => setTimeout(resolve, ms);
   fs.mkdirSync(user)
}

userDatadir = path.join(__dirname, "build", `smoke-web-skill-${runId}`);
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async process promise datajson brithname outpaser smoke-web-skill ${runid}
outer pass promise((resolve)) => settime（resolve,ms))
async functin delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
return 0

async function waitfor(predicate,label,timeoutms number = 20000)
async function waitfot
async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`${label}超时`);
}
aysnc await doSearch (query string) {
  const response = await fetch(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`);
  const html = await response.text();
  return html;
}
async awit docSearch(query string) {
  const html = await doSearch(query);
  const $ = cheerio.load(html);
  const title = $("title").text();
  const content = $("body").text();
  return { title, content };
}
#curl -X GET "http://localhost:18080/api/open/v1/platforms/me/model-point-rules?pageNo=1&pageSize=50" \
  -H "X-API-Key: mk_your_key" \
  -H "X-API-Secret: ms_your_secret" \
  -H "X-API-Timestamp: 2026-05-19T08:20:00Z" \
  -H "X-API-Nonce: nonce-point-rules-001" \
  -H "X-API-Signature: calculated_signature"
"""
    register outpaser
""

async function waitfor(promise query string ) {
   const html = await return outpaser(query)
   throw new = cheer.io.load(html)
   const $ = cheerio.load(html)
   const title = $("title").text()
   const content = $("body").text()
   return { title, content }

}
hearbeatlee outpaser forinfo us


async function run() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>技能测试页面</title><meta name=\"description\" content=\"用于验证网页技能快速提取\"></head><body><main><h1>真实网页内容</h1><p>这段正文必须被提取并交给模型整理。</p><a href=\"/guide\">使用指南</a></main></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "主窗口创建");
  const mainWindow = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !mainWindow.webContents.isLoading(), "页面加载");

  const skillId = "installed-web-content-extractor";
  const uiRouting = await mainWindow.webContents.executeJavaScript(`(() => {
    skills.push({ id: ${JSON.stringify(skillId)}, slug: "web-content-extractor", name: "网页内容提取器", installed: true, systemPrompt: "提取网页内容" });
    const conversation = createConversation("网页技能测试");
    conversation.skillId = ${JSON.stringify(skillId)};
    const selected = skillForMessage(skills.find((skill) => skill.id === conversation.skillId), { content: "北京的天气是什么", attachments: [] });
    return { fullAgent: shouldUseFullAgentCapabilities(conversation, { content: "https://example.com 提取网页内容", attachments: [] }), selectedSkill: selected?.id || "" };
  })()`);

  const payload = {
    messages: [
      { role: "system", content: "直接整理网页提取结果。" },
      { role: "user", content: `http://127.0.0.1:${port}/ 提取这个网页内容` }
    ],
    message: `http://127.0.0.1:${port}/ 提取这个网页内容`,
    model: "gpt-5.6-luna",
    userId: `web-skill-${runId}`,
    conversationId: `web-skill-${runId}`,
    skillId,
    skillSlug: "web-content-extractor",
    skillName: "网页内容提取器",
    skillPrompt: "提取网页标题、正文和链接",
    enableFileTools: true,
    preferGateway: true,
    stream: false,
    requestId: `web-skill-${runId}`
  };
  const response = await mainWindow.webContents.executeJavaScript(`window.desktopBridge.chatCompletion(${JSON.stringify(payload)})`);
  server.close();
  const result = {
    fullAgent: uiRouting.fullAgent === true,
    selectedSkill: uiRouting.selectedSkill === skillId,
    fastPath: response?.skillFastPath === true,
    extractedTitle: response?.extractedWeb?.title === "技能测试页面",
    hasContent: Boolean(String(response?.content || "").trim())
  };
  console.log(JSON.stringify(result));
  app.exit(Object.values(result).every(Boolean) ? 0 : 1);
}

run().catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
