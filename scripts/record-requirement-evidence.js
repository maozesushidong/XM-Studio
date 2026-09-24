"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");
const asar = require("@electron/asar");
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
async function main() {
  const build = read("build/requirement-preview-build.json"), deployment = read("build/requirement-preview-deployment.json"), integration = read("build/requirement-integration-results.json"), live = read("build/requirement-live-results.json"), ui = read("build/requirement-ui/results.json"), packaged = read("build/requirement-package-test.json"), resources = read("update-service/requirement-intake/manifest.json");
  const archive = path.join(path.dirname(build.installer), "win-unpacked/resources/app.asar");
  const files = ["electron/main.js", "electron/preload.js", "electron/requirements.js", "electron/updater.js", "renderer/app.js", "renderer/requirements.js", "renderer/index.html", "renderer/requirements.css"];
  const hashes = {};
  for (const file of files) { hashes[file] = digest(asar.extractFile(archive, file)); assert.equal(hashes[file], digest(fs.readFileSync(path.join(root, file))), `Packaged source mismatch: ${file}`); }
  const health = await (await fetch(`${deployment.baseUrl}/health`)).json();
  const unauthenticated = await fetch(`${deployment.baseUrl}/api/desktop/requirements/current`);
  assert.equal(health.requirementIntake, "enabled"); assert.equal(health.v11StorageMode, "postgres"); assert.equal(unauthenticated.status, 401);
  assert(deployment.productionUnchanged && ui.ok && packaged.ok && integration.ok && live.allPassed);
  const installerSha256 = await new Promise((resolve, reject) => { const hash = crypto.createHash("sha256"); fs.createReadStream(build.installer).on("data", data => hash.update(data)).on("end", () => resolve(hash.digest("hex"))).on("error", reject); });
  fs.writeFileSync(`${build.installer}.sha256`, `${installerSha256}  ${path.basename(build.installer)}\n`);
  const evidence = { checkedAt: new Date().toISOString(), productVersion: build.version, installer: build.installer, installerBytes: build.bytes, installerSha256, archiveSha256: digest(fs.readFileSync(archive)), packagedFileHashes: hashes, serverImage: deployment.image, resourceBuildHash: resources.buildHash, schemaVersion: resources.schemaVersion, migrationVersion: resources.migrationVersion, previewBaseUrl: deployment.baseUrl, productionUnchanged: true, installerUploaded: false, integrationGroupsPassed: integration.results.length, realModelCasesPassed: live.results.length, modelMinSeconds: Math.min(...live.results.map(r => r.elapsedMs)) / 1000, modelMaxSeconds: Math.max(...live.results.map(r => r.elapsedMs)) / 1000, layoutWidths: ui.widths, unauthenticatedStatus: 401, pendingAcceptance: ["product capability registry confirmation", "fresh DingTalk login and employee end-to-end acceptance", "remaining multi-turn semantic acceptance scenarios", "administrator authorization isolation intentionally not accepted"] };
  fs.writeFileSync(path.join(root, "build/requirement-delivery-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: true, installerSha256, integrationGroupsPassed: evidence.integrationGroupsPassed, realModelCasesPassed: evidence.realModelCasesPassed, productionUnchanged: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
