"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const builderConfig = JSON.parse(read("electron-builder.2.0.0.json"));
const updateConfig = JSON.parse(read("electron/update-config.json"));
const installer = read("build/先马智能体安装器.iss");
const mainSource = read("electron/main.js");

assert.strictEqual(packageJson.version, "2.0.0");
assert.strictEqual(builderConfig.appId, "com.xianma.ai-studio.desktop");
assert.strictEqual(builderConfig.productName, "XMAI Studio");
assert.deepStrictEqual(
  {
    displayVersion: updateConfig.displayVersion,
    internalVersion: updateConfig.internalVersion,
    channel: updateConfig.channel
  },
  { displayVersion: "2.0.0", internalVersion: "2.0.0", channel: "stable-v2" }
);

assert.match(installer, /AppId=\{\{fa50672a-d937-5394-943a-83cc694bc2d8\}/);
assert.match(installer, /DefaultDirName=\{autopf\}\\XMAI Studio/);
for (const configName of ["ai-config.json", "gateway-config.json", "dingtalk-config.json"]) {
  const configLine = installer.split(/\r?\n/).find((line) => line.includes(`installer-config\\${configName}`));
  assert.ok(configLine, `安装器缺少 ${configName}`);
  assert.match(configLine, /uninsneveruninstall/, `${configName} 必须在卸载后保留`);
}

const uninstallSections = [...installer.matchAll(/\[UninstallDelete\]([\s\S]*?)(?=\r?\n\[|$)/g)];
assert.ok(uninstallSections.length > 0, "安装器缺少卸载清理规则");
for (const section of uninstallSections) {
  const deleteRules = section[1].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("Type:"));
  assert.ok(deleteRules.length > 0, "卸载清理段不能为空");
  for (const rule of deleteRules) {
    const disposableMediaRuntime = /Name: "\{commonappdata\}\\XianmaAIStudio\\media-runtime"/i.test(rule);
    assert.ok(disposableMediaRuntime || /Name: "\{app\}/.test(rule), `卸载不得清理安装目录之外的用户数据：${rule}`);
  }
}
const uninstallDeleteSource = uninstallSections.map((match) => match[1]).join("\n")
  .replace(/^.*\{commonappdata\}\\XianmaAIStudio\\media-runtime.*$/gim, "");
assert.doesNotMatch(uninstallDeleteSource, /\{(?:userappdata|commonappdata|appdata)\}/i);

assert.match(mainSource, /process\.env\.XIANMA_USER_DATA/);
assert.match(mainSource, /productUserDataRoot = path\.join\(appDataRoot, "xianma-ai-studio"\)/);
assert.match(mainSource, /productProgramDataRoot = path\.join\(programDataRoot, "XianmaAIStudio"\)/);
assert.match(mainSource, /user-data-route\.json/);
assert.match(mainSource, /app\.setPath\("userData", configuredUserDataRoot\)/);
assert.match(mainSource, /app\.setPath\("userData", resolveStableUserDataRoot\(\)\)/);
assert.ok(mainSource.indexOf("app.setPath(\"userData\"") < mainSource.indexOf("app.setName(appDisplayName)"), "必须先固定历史数据目录，再设置新的显示名称");
assert.match(mainSource, /legacyUserDataRoot/);
assert.match(installer, /UsePreviousAppDir=yes/);

process.stdout.write("data retention smoke test passed\n");
