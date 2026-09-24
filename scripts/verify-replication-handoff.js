"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name).toString("utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const credentials = json("config/plaintext/client-credentials.json");
function decrypt(kind) {
  const envelope = json(`electron/bundled-${kind}-credential.json`);
  const part = json(`electron/bundled-${kind}-key-part.json`);
  const a = Buffer.from(envelope.keyPartA, "base64");
  const b = Buffer.from(part.keyPartB, "base64");
  const key = Buffer.from(a.map((byte, index) => byte ^ b[index]));
  const decipher = crypto.createDecipheriv(envelope.algorithm, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
assert(decrypt("ai") === credentials.modelApiKey, "Client model credential mismatch");
assert(decrypt("dingtalk") === credentials.dingtalkClientSecret, "Client DingTalk credential mismatch");
const manifest = json("config/plaintext/manifest.json");
for (const entry of manifest.files) {
  assert(path.basename(entry.file) === entry.file, "Invalid manifest path");
  assert(hash(read(`config/plaintext/${entry.file}`)) === entry.sha256, `Credential snapshot checksum mismatch: ${entry.file}`);
}
const env = json("config/plaintext/preview-service-environment.json");
const postgres = json("config/plaintext/preview-postgres-environment.json");
assert(env.UPDATE_PUBLIC_BASE_URL === manifest.previewBaseUrl, "Preview base URL mismatch");
const database = new URL(env.DATABASE_URL);
assert(database.pathname === "/xianma_v11_preview", "Unexpected database target");
assert(decodeURIComponent(database.password) === postgres.POSTGRES_PASSWORD, "Database credential mismatch");
const privateKey = crypto.createPrivateKey(read("config/plaintext/preview-signing-private.pem"));
const publicKey = crypto.createPublicKey(read("build/v11-preview-signing-public.pem"));
assert(crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" })), "Preview signing key mismatch");
const runtime = json("build/runtime-archive/runtime-manifest.json");
assert(hash(read(`build/runtime-archive/${path.basename(runtime.archiveFile)}`)) === runtime.archiveSha256, "Runtime archive checksum mismatch");
for (const file of ["build/node-runtime/node-v24.18.0-win-x64/node.exe", "build/runtime-tools/7za.exe", "build/tools/InnoSetup/ISCC.exe", "build/tools/InnoSetup/Languages/ChineseSimplified.isl", "build/installer-config/dingtalk-config.json", "build/installer-config/computer-access.json"]) {
  assert(read(file).length > 0, `Build resource missing: ${file}`);
}
const installer = "release-assets/XMAI Studio Preview Setup 2.3.0.1.exe";
assert(hash(read(installer)) === read(installer.replace(/\.exe$/, ".sha256")).toString("utf8").trim().split(/\s+/)[0].toLowerCase(), "Installer checksum mismatch");
console.log(JSON.stringify({ ok: true, credentialChecksums: manifest.files.length, encryptedCredentialsMatch: true, signingKeyMatches: true, buildResourcesPresent: true, originalInstallerUnchanged: true }));
