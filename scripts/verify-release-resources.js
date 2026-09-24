const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const expectedRuntimeVersion = "2026.7.1";
const runtimePackagePath = path.join(projectRoot, "build", "agent-runtime", "node_modules", "openclaw", "package.json");
const runtimeEntryPath = path.join(projectRoot, "build", "agent-runtime", "node_modules", "openclaw", "openclaw.mjs");
const nodePath = path.join(projectRoot, "build", "node-runtime", "node-v24.18.0-win-x64", "node.exe");
const runtimeManifestPath = path.join(projectRoot, "build", "runtime-archive", "runtime-manifest.json");
const runtimeExtractorPath = path.join(projectRoot, "build", "runtime-tools", "7za.exe");
const credentialPaths = [
  path.join(projectRoot, "electron", "bundled-ai-credential.json"),
  path.join(projectRoot, "electron", "bundled-ai-key-part.json"),
  path.join(projectRoot, "electron", "bundled-dingtalk-credential.json"),
  path.join(projectRoot, "electron", "bundled-dingtalk-key-part.json")
];

for (const requiredPath of [runtimePackagePath, runtimeEntryPath, nodePath, runtimeManifestPath, runtimeExtractorPath, ...credentialPaths]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Missing release resource: ${path.relative(projectRoot, requiredPath)}`);
}

const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, "utf8"));
if (runtimePackage.version !== expectedRuntimeVersion) {
  throw new Error(`Unexpected capability runtime version: ${runtimePackage.version || "unknown"}`);
}

const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
const runtimeArchivePath = path.join(path.dirname(runtimeManifestPath), path.basename(runtimeManifest.archiveFile || ""));
if (runtimeManifest.runtimeVersion !== expectedRuntimeVersion || !runtimeManifest.archiveSha256 || !fs.existsSync(runtimeArchivePath)) {
  throw new Error("Capability runtime archive manifest is invalid");
}
const archiveHash = crypto.createHash("sha256").update(fs.readFileSync(runtimeArchivePath)).digest("hex");
if (archiveHash !== runtimeManifest.archiveSha256) {
  throw new Error("Capability runtime archive checksum mismatch");
}

const nodeVersion = spawnSync(nodePath, ["--version"], { encoding: "utf8", windowsHide: true });
if (nodeVersion.status !== 0 || !String(nodeVersion.stdout).trim().startsWith("v24.")) {
  throw new Error("Bundled Node 24 runtime is unavailable");
}

process.stdout.write(`${JSON.stringify({
  runtimeReady: true,
  runtimeVersion: runtimePackage.version,
  runtimeArchiveBytes: fs.statSync(runtimeArchivePath).size,
  runtimeFileCount: runtimeManifest.fileCount,
  nodeVersion: String(nodeVersion.stdout).trim(),
  encryptedCredentialsReady: true
})}\n`);
