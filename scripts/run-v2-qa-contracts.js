"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const qaRoot = path.resolve(process.argv[2] || "");
const installRoot = path.join(root, "build", "qa-v2-install");
const resourcesRoot = path.join(installRoot, "resources");
const appResources = path.join(root, "build", "app-resources-2.0.0");

if (!process.argv[2] || !fs.existsSync(qaRoot)) throw new Error("请传入解压后的 V2.0 测试数据目录");
if (!fs.existsSync(path.join(appResources, "app.asar"))) throw new Error("请先执行 npm run build:asar");
if (!path.resolve(installRoot).startsWith(path.join(root, "build") + path.sep)) throw new Error("测试安装目录必须位于工程 build 目录");

fs.rmSync(installRoot, { recursive: true, force: true });
fs.mkdirSync(resourcesRoot, { recursive: true });
fs.copyFileSync(path.join(appResources, "app.asar"), path.join(resourcesRoot, "app.asar"));
if (fs.existsSync(path.join(appResources, "app.asar.unpacked"))) {
  fs.cpSync(path.join(appResources, "app.asar.unpacked"), path.join(resourcesRoot, "app.asar.unpacked"), { recursive: true });
}

const groups = ["08_Skill边界", "09_浏览器策略", "10_个人技能状态", "11_用户端版本范围", "12_调用数据口径", "13_任务执行数据", "14_离线补传"];
const scripts = groups.flatMap((group) => {
  const directory = path.join(qaRoot, group);
  return fs.readdirSync(directory)
    .filter((name) => /^执行.*\.cjs$/i.test(name))
    .sort()
    .map((name) => path.join(directory, name));
});

const bootstrap = `
const fs = require("fs");
const path = require("path");
const Module = require("module");
const scriptPath = path.resolve(process.argv[1]);
const installRoot = path.resolve(process.argv[2]).replaceAll("\\\\", "/");
let source = fs.readFileSync(scriptPath, "utf8");
source = source.replaceAll("C:/Program Files/先马·AI Studio", installRoot);
const testModule = new Module(scriptPath, module);
testModule.filename = scriptPath;
testModule.paths = Module._nodeModulePaths(path.dirname(scriptPath));
testModule._compile(source, scriptPath);
`;

const results = [];
for (const scriptPath of scripts) {
  const result = spawnSync(process.execPath, ["-e", bootstrap, scriptPath, installRoot], {
    cwd: path.dirname(scriptPath),
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024
  });
  process.stdout.write(`\n[${path.basename(path.dirname(scriptPath))}] ${path.basename(scriptPath)}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  results.push({ script: path.basename(scriptPath), status: result.status, signal: result.signal || "" });
}

const failures = results.filter((item) => item.status !== 0);
process.stdout.write(`\n${JSON.stringify({ total: results.length, passed: results.length - failures.length, failed: failures.length, results })}\n`);
if (failures.length) process.exitCode = 1;
