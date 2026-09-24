"use strict";

process.env.XIANMA_DEV_AUTH_BYPASS = "1";
process.env.XIANMA_DISABLE_REMOTE_COMPANY_SKILLS = "1";
process.env.XIANMA_ENABLE_TEST_API = "1";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { app } = require("electron");

const testRoot = path.join(__dirname, "..", "build", `skill-download-package-${Date.now().toString(36)}`);
fs.mkdirSync(testRoot, { recursive: true });
app.setPath("userData", testRoot);
process.env.XIANMA_USER_DATA = testRoot;

async function run() {
  const main = require("../electron/main.js");
  const source = path.join(testRoot, "installed-skill");
  fs.mkdirSync(path.join(source, "references"), { recursive: true });
  fs.mkdirSync(path.join(source, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(source, ".git"), { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: package-test\ndescription: ZIP 下载测试\n---\n\n# 适用场景\n测试\n", "utf8");
  fs.writeFileSync(path.join(source, "skill.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
  fs.writeFileSync(path.join(source, "references", "guide.md"), "reference content", "utf8");
  fs.writeFileSync(path.join(source, ".xianma-skill-origin.json"), "internal metadata", "utf8");
  fs.writeFileSync(path.join(source, "node_modules", "ignored.js"), "ignored", "utf8");

  await app.whenReady();
  const buffer = await main.__test.zipInstalledSkillDirectory(source, "package-test");
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files).sort();
  assert(names.includes("package-test/SKILL.md"));
  assert(names.includes("package-test/skill.json"));
  assert(names.includes("package-test/references/guide.md"));
  assert(!names.some((name) => /node_modules|\.git|\.xianma-skill-origin/.test(name)));
  assert.equal(await zip.file("package-test/references/guide.md").async("string"), "reference content");
  console.log(JSON.stringify({ ok: true, format: "zip", entries: names }));
  app.exit(0);
}

run().catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
