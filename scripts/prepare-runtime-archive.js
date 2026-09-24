const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { path7za } = require("7zip-bin");

const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "build", "agent-runtime");
const runtimePackagePath = path.join(runtimeRoot, "node_modules", "openclaw", "package.json");
const runtimeLockPath = path.join(runtimeRoot, "package-lock.json");
const archiveDirectory = path.join(projectRoot, "build", "runtime-archive");
const toolDirectory = path.join(projectRoot, "build", "runtime-tools");
const manifestPath = path.join(archiveDirectory, "runtime-manifest.json");
const archiveFileName = "agent-runtime.7z";
const archivePath = path.join(archiveDirectory, archiveFileName);
const extractorName = process.platform === "win32" ? "7za.exe" : "7za";
const extractorPath = path.join(toolDirectory, extractorName);

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function runtimeInventory(rootPath) {
  const hash = crypto.createHash("sha256");
  const stack = [rootPath];
  let fileCount = 0;
  let uncompressedBytes = 0;

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        hash.update(`d:${relativePath}\n`);
        stack.push(absolutePath);
        continue;
      }
      const stat = fs.statSync(absolutePath);
      fileCount += 1;
      uncompressedBytes += stat.size;
      hash.update(`f:${relativePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}\n`);
    }
  }

  for (const sourcePath of [runtimePackagePath, runtimeLockPath]) {
    if (fs.existsSync(sourcePath)) hash.update(fs.readFileSync(sourcePath));
  }

  return {
    sourceFingerprint: hash.digest("hex"),
    fileCount,
    uncompressedBytes
  };
}

function copyExtractor() {
  if (!fs.existsSync(path7za)) throw new Error("7-Zip build tool is unavailable");
  fs.mkdirSync(toolDirectory, { recursive: true });
  fs.copyFileSync(path7za, extractorPath);
  if (process.platform !== "win32") fs.chmodSync(extractorPath, 0o755);

  const licenseSource = path.join(path.dirname(require.resolve("7zip-bin")), "LICENSE.txt");
  if (fs.existsSync(licenseSource)) {
    fs.copyFileSync(licenseSource, path.join(toolDirectory, "7zip-LICENSE.txt"));
  }
}

if (!fs.existsSync(runtimePackagePath)) {
  throw new Error(`Capability runtime is missing: ${path.relative(projectRoot, runtimePackagePath)}`);
}

const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, "utf8"));
const inventory = runtimeInventory(runtimeRoot);
fs.mkdirSync(archiveDirectory, { recursive: true });
copyExtractor();

const cachedManifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : null;
const cacheReady = Boolean(
  cachedManifest?.sourceFingerprint === inventory.sourceFingerprint
  && cachedManifest?.runtimeVersion === runtimePackage.version
  && cachedManifest?.archiveSha256
  && fs.existsSync(archivePath)
  && sha256File(archivePath) === cachedManifest.archiveSha256
);

if (!cacheReady) {
  const temporaryArchivePath = path.join(archiveDirectory, "agent-runtime.tmp.7z");
  fs.rmSync(temporaryArchivePath, { force: true });
  const result = spawnSync(path7za, [
    "a",
    "-t7z",
    "-mx=5",
    "-mmt=on",
    "-ms=on",
    temporaryArchivePath,
    path.join(runtimeRoot, "*")
  ], {
    cwd: runtimeRoot,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.status !== 0 || !fs.existsSync(temporaryArchivePath)) {
    throw new Error(`Capability runtime archive failed with exit code ${result.status}`);
  }
  fs.rmSync(archivePath, { force: true });
  fs.renameSync(temporaryArchivePath, archivePath);
}

const manifest = {
  formatVersion: 1,
  runtimeVersion: runtimePackage.version,
  archiveFile: archiveFileName,
  archiveSha256: sha256File(archivePath),
  sourceFingerprint: inventory.sourceFingerprint,
  fileCount: inventory.fileCount,
  uncompressedBytes: inventory.uncompressedBytes,
  entryRelativePath: "node_modules/openclaw/openclaw.mjs",
  packageRelativePath: "node_modules/openclaw/package.json",
  extractorFile: extractorName,
  createdAt: new Date().toISOString()
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  runtimeArchiveReady: true,
  runtimeVersion: manifest.runtimeVersion,
  archiveBytes: fs.statSync(archivePath).size,
  fileCount: manifest.fileCount,
  reused: cacheReady
})}\n`);
