"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const asar = require("@electron/asar");
const root = path.resolve(__dirname, "..");
const baseUrl = "http://47.96.184.148/studio-v11-CWyTWq7cBtoNl7dztMDpwHeirAXE-k59F-5DL4uFcYM";
const version = require("./release-version").readReleaseMetadata(root).releaseVersion;
const output = `dist-requirement-preview-${version}`;
function run(command, args, env = {}) { const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true }); if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).slice(-4000)); if (result.stdout) process.stdout.write(result.stdout.slice(-1500)); }
async function main() {
  run(process.execPath, ["update-service/requirement-intake/generate.js", "--check"]);
  run(process.execPath, ["scripts/repack-app-asar.js"], { XIANMA_BASE_ASAR: "dist-2.3.0.1/win-unpacked/resources/app.asar", XIANMA_APP_RESOURCES_OUTPUT: "build/requirement-preview-resources", XIANMA_V11_PREVIEW_BASE_URL: baseUrl, XIANMA_V11_PREVIEW_CHANNEL: "v11-preview", XIANMA_V11_PREVIEW_SIGNING_PUBLIC_KEY: "build/v11-preview-signing-public.pem", XIANMA_REQUIREMENT_PREVIEW: "1" });
  const appAsar = path.join(root, "build/requirement-preview-resources/app.asar");
  const config = JSON.parse(asar.extractFile(appAsar, "electron/update-config.json"));
  const flavor = JSON.parse(asar.extractFile(appAsar, "electron/build-flavor.json"));
  if (config.baseUrl !== baseUrl || config.channel !== "v11-preview" || flavor.baseUrl !== baseUrl || flavor.flavor !== "requirement-preview") throw new Error("Test endpoint isolation failed");
  run(process.execPath, ["scripts/assemble-release.js"], { XIANMA_ASSEMBLE_OUTPUT: output, XIANMA_APP_ASAR: appAsar });
  const source = path.join(root, output, "win-unpacked");
  fs.renameSync(path.join(source, "XMAI Studio.exe"), path.join(source, "XMAI Studio Preview.exe"));
  const compiler = path.join(root, "build/tools/InnoSetup/ISCC.exe");
  run(compiler, ["/Qp", `/DMyAppVersion=${version}`, `/DMySourceDir=${source}`, `/DMyOutputDir=${path.join(root, output)}`, path.join(root, "build/requirement-preview-installer.iss")]);
  const installer = path.join(root, output, `XMAI Studio Preview Setup ${version}.exe`);
  const result = { installer, bytes: fs.statSync(installer).size, version, baseUrl, channel: config.channel, productionUpload: false, builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, "build/requirement-preview-build.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
