const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readReleaseMetadata } = require("./release-version");

const root = path.resolve(__dirname, "..");
const { packageVersion, releaseVersion: version } = readReleaseMetadata(root);
if (!version) throw new Error("package.json 缺少版本号");
const electronDir = path.join(root, "node_modules", "electron", "dist");
const sourceRoot = String(process.env.XIANMA_ASSEMBLE_SOURCE || `dist-${version}`).trim() || `dist-${version}`;
const outputRoot = String(process.env.XIANMA_ASSEMBLE_OUTPUT || `dist-${version}-assembled`).trim() || `dist-${version}-assembled`;
const sourceApp = path.join(root, sourceRoot, "win-unpacked");
const outputDir = path.join(root, outputRoot, "win-unpacked");
const repackedAsar = path.join(root, "build", `app-resources-${version}`, "app.asar");
const sourceAsar = String(process.env.XIANMA_APP_ASAR || "").trim()
  ? path.resolve(root, process.env.XIANMA_APP_ASAR)
  : (fs.existsSync(path.join(sourceApp, "resources", "app.asar")) ? path.join(sourceApp, "resources", "app.asar") : repackedAsar);
const sourceUnpacked = `${sourceAsar}.unpacked`;

if (!fs.existsSync(sourceAsar)) {
  throw new Error("新版 app.asar 不存在，不能组装交付目录");
}

fs.rmSync(path.dirname(outputDir), { recursive: true, force: true });
fs.cpSync(electronDir, outputDir, { recursive: true });
const temporaryExecutablePath = path.join(outputDir, "xianma-centaur.exe");
const executablePath = path.join(outputDir, "XMAI Studio.exe");
fs.copyFileSync(path.join(outputDir, "electron.exe"), temporaryExecutablePath);
fs.rmSync(path.join(outputDir, "electron.exe"), { force: true });
fs.mkdirSync(path.join(outputDir, "resources"), { recursive: true });
fs.copyFileSync(sourceAsar, path.join(outputDir, "resources", "app.asar"));
if (fs.existsSync(sourceUnpacked)) {
  fs.cpSync(sourceUnpacked, path.join(outputDir, "resources", "app.asar.unpacked"), { recursive: true });
}
// Windows may keep Electron's stock archive mapped. It is harmless at runtime.
try {
  fs.rmSync(path.join(outputDir, "resources", "default_app.asar"), { force: true, maxRetries: 3, retryDelay: 200 });
} catch (error) {
  if (!['EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
}
fs.rmSync(path.join(outputDir, "version"), { force: true });
if (fs.existsSync(path.join(outputDir, "LICENSE"))) {
  fs.renameSync(path.join(outputDir, "LICENSE"), path.join(outputDir, "LICENSE.electron.txt"));
}
fs.cpSync(path.join(root, "build", "runtime-archive"), path.join(outputDir, "resources", "runtime-archive"), { recursive: true });
fs.cpSync(path.join(root, "build", "runtime-tools"), path.join(outputDir, "resources", "runtime-tools"), {
  recursive: true,
  filter: (sourcePath) => path.resolve(sourcePath) !== path.resolve(root, "build", "runtime-tools", "media")
});
fs.cpSync(path.join(root, "build", "node-runtime", "node-v24.18.0-win-x64"), path.join(outputDir, "resources", "node-runtime"), { recursive: true });

const rceditPath = path.join(root, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
if (fs.existsSync(rceditPath)) {
  const result = spawnSync(rceditPath, [
    temporaryExecutablePath,
    "--set-icon", path.join(root, "build", "icon.ico"),
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-version-string", "ProductName", "XMAI Studio",
    "--set-version-string", "FileDescription", "XMAI Studio",
    "--set-version-string", "InternalName", "XMAI Studio",
    "--set-version-string", "OriginalFilename", "XMAI Studio.exe",
    "--set-version-string", "CompanyName", "Xianma"
  ], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`主程序图标和版本信息写入失败：${result.stderr || result.stdout || result.status}`);
}
fs.renameSync(temporaryExecutablePath, executablePath);

console.log(JSON.stringify({ assembled: true, version, packageVersion, path: outputDir, appAsarBytes: fs.statSync(path.join(outputDir, "resources", "app.asar")).size, brandedExecutable: fs.existsSync(rceditPath) }));
