"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const electronPath = require("electron");
const testPath = path.join(root, "smoke-memory-migration.js");
const runId = Date.now().toString(36);

function run(argumentsList) {
  const environment = { ...process.env, XIANMA_MEMORY_TEST_ID: runId };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [testPath, ...argumentsList], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const detail = result.status ?? result.error?.message ?? "unknown";
    throw new Error(`记忆迁移测试失败：${detail}`);
  }
}

run(["--seed"]);
run(["--verify"]);
