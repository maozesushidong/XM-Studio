"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");
const { createCompanySkillsClient } = require("../electron/company-skills");

async function main() {
  const sourcePath = path.resolve(String(process.argv[2] || ""));
  if (!fs.existsSync(path.join(sourcePath, "SKILL.md"))) throw new Error("目标目录缺少 SKILL.md");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xmai-real-skill-review-"));
  try {
    const client = createCompanySkillsClient({
      app: { getPath: () => temporaryRoot },
      dialog: {},
      fs,
      path,
      crypto,
      JSZip,
      publicKeyPath: path.join(temporaryRoot, "unused.pem"),
      getServiceConfig: () => ({}),
      getSessionToken: () => "",
      getUserSkillsDir: () => temporaryRoot,
      listInstalledSkills: () => [],
      installCompanyPackage: async () => ({}),
      disableCompanySkill: async () => ({})
    });
    const fallbackName = path.basename(sourcePath).replace(/^installed-/, "");
    const result = await client.prepareInstalledSkillSubmission({
      userId: "verification",
      sourcePath,
      skill: {
        slug: fallbackName,
        name: fallbackName,
        description: `验证 ${fallbackName} 企业审核包转换。`,
        category: "已安装技能",
        starter: `请使用 ${fallbackName} 处理以下内容。`
      }
    });
    assert.ok(result.inspection?.skill, "转换后没有生成可审核技能");
    assert.ok(result.inspection.fileTree.includes("SKILL.md"), "转换后缺少 SKILL.md");
    assert.ok(result.inspection.fileTree.includes("skill.json"), "转换后缺少 skill.json");
    process.stdout.write(JSON.stringify({
      verified: true,
      source: path.basename(sourcePath),
      normalized: result.normalized,
      name: result.inspection.skill.name,
      version: result.inspection.skill.version,
      files: result.inspection.fileTree.length,
      bytes: result.inspection.bytes
    }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(error.stack || error.message);
  process.exitCode = 1;
});
