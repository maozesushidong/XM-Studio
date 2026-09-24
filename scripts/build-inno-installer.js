const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readReleaseMetadata } = require("./release-version");

const projectRoot = path.resolve(__dirname, "..");
const { releaseVersion: version } = readReleaseMetadata(projectRoot);
const outputRoot = String(process.env.XIANMA_BUILD_OUTPUT || `dist-${version}`).trim() || `dist-${version}`;
const sourceDir = path.join(projectRoot, outputRoot, "win-unpacked");
const outputDir = path.join(projectRoot, outputRoot);
const scriptPath = path.join(projectRoot, "build", "先马智能体安装器.iss");
const outputPath = path.join(outputDir, `XMAI Studio Setup ${version}.exe`);
const compilerCandidates = [
  String(process.env.INNO_SETUP_COMPILER || "").trim(),
  path.join(projectRoot, "build", "tools", "InnoSetup", "ISCC.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 7", "ISCC.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 7", "ISCC.exe")
].filter(Boolean);
const compilerPath = compilerCandidates.find((candidate) => fs.existsSync(candidate));

if (!compilerPath) throw new Error("Inno Setup 7 compiler is unavailable; set INNO_SETUP_COMPILER");
for (const requiredPath of [sourceDir, scriptPath, path.join(sourceDir, "XMAI Studio.exe")]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Missing installer input: ${path.relative(projectRoot, requiredPath)}`);
}

fs.rmSync(outputPath, { force: true });
const result = spawnSync(compilerPath, [
  "/Qp",
  `/DMyAppVersion=${version}`,
  `/DMySourceDir=${sourceDir}`,
  `/DMyOutputDir=${outputDir}`,
  scriptPath
], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true
});

if (result.status !== 0 || !fs.existsSync(outputPath)) {
  process.stderr.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error(`Inno Setup compilation failed with exit code ${result.status}`);
}

process.stdout.write(`${JSON.stringify({
  installerReady: true,
  version,
  bytes: fs.statSync(outputPath).size,
  path: outputPath
})}\n`);
