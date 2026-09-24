const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const sourcePath = process.env.XIANMA_MEDIA_SMOKE_FILE
  || "C:/Users/Administrator/Downloads/拼多多智能Agent项目周会_20260811.mp3";
const userDataDir = path.join(__dirname, "build", `smoke-media-${Date.now().toString(36)}`);
process.env.XIANMA_ENABLE_TEST_API = "1";
process.env.XIANMA_USER_DATA = userDataDir;
app.setPath("userData", userDataDir);

const { __test } = require("./electron/main.js");

app.whenReady().then(async () => {
  if (!fs.existsSync(sourcePath)) throw new Error(`测试音频不存在：${sourcePath}`);
  const imported = await __test.importAttachmentsToWorkspace("media-smoke", [sourcePath]);
  const progress = [];
  const startedAt = Date.now();
  const first = await __test.preprocessMediaAttachments("media-smoke", imported, null, (item) => progress.push(item.stage));
  const firstElapsedMs = Date.now() - startedAt;
  const transcript = String(first[0]?.transcript || "").trim();
  if (transcript.length < 20) throw new Error(`转写结果过短：${transcript}`);
  const cachedStartedAt = Date.now();
  const reimported = await __test.importAttachmentsToWorkspace("media-smoke", [sourcePath]);
  const second = await __test.preprocessMediaAttachments("media-smoke", reimported, null, (item) => progress.push(item.stage));
  const cachedElapsedMs = Date.now() - cachedStartedAt;
  if (!second[0]?.transcriptCached || second[0]?.transcript !== transcript) throw new Error("同一附件没有复用转写缓存");
  process.stdout.write(`${JSON.stringify({ transcriptLength: transcript.length, firstElapsedMs, cachedElapsedMs, progress, preview: transcript.slice(0, 120) })}\n`);
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
