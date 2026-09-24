"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readReleaseMetadata } = require("./release-version");

const projectRoot = path.resolve(__dirname, "..");
const { releaseVersion: version } = readReleaseMetadata(projectRoot);
const outputRoot = `dist-${version}`;
const appResourcesRoot = `build/app-resources-${version}-${process.pid}-${Date.now()}`;
const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";

function run(script, extraEnvironment = {}) {
  const argumentsList = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${script}`]
    : ["run", script];
  const result = spawnSync(npmCommand, argumentsList, {
    cwd: projectRoot,
    env: { ...process.env, ...extraEnvironment },
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}: ${result.error?.message || "unknown error"}`);
}

run("build:asar", { XIANMA_APP_RESOURCES_OUTPUT: appResourcesRoot, XIANMA_RELEASE_VERSION: version });
run("build:assemble", {
  XIANMA_APP_ASAR: `${appResourcesRoot}/app.asar`,
  XIANMA_ASSEMBLE_OUTPUT: outputRoot,
  XIANMA_RELEASE_VERSION: version
});
run("build:installer", { XIANMA_BUILD_OUTPUT: outputRoot, XIANMA_RELEASE_VERSION: version });

const installerPath = path.join(projectRoot, outputRoot, `XMAI Studio Setup ${version}.exe`);
if (!fs.existsSync(installerPath)) throw new Error("离线打包完成后没有找到安装包");
process.stdout.write(`${JSON.stringify({ offlineBuildReady: true, version, installerPath, bytes: fs.statSync(installerPath).size })}\n`);
