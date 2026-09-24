"use strict";
const fs = require("fs");
const path = require("path");
const { hash, outputSchema, inputSchema } = require("./contract");
const root = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(root, "capability-source.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const upstreamHashes = JSON.parse(fs.readFileSync(path.join(root, "upstream-lock.json"), "utf8"));
for (const [file, expected] of Object.entries(upstreamHashes)) {
  const actual = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(root, "upstream", file))).digest("hex");
  if (actual !== expected) throw new Error(`Upstream resource changed: ${file}`);
}
const allowed = ["available", "prototype", "planned", "deprecated", "unknown"];
if (!source.productVersion || !["pending_product_confirmation", "confirmed"].includes(source.reviewStatus)) throw new Error("Invalid capability registry metadata");
const ids = new Set();
for (const item of source.capabilities) {
  if (!item.capabilityId || ids.has(item.capabilityId) || !allowed.includes(item.status)) throw new Error("Invalid capability entry");
  if (item.status === "available" && (!item.entry || !item.lastVerifiedAt || source.reviewStatus !== "confirmed")) throw new Error("Available capability needs verification and product confirmation");
  ids.add(item.capabilityId);
}
function write(file, value) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); }
if (!checkOnly) {
  const sourceHash = hash(source);
  const snapshot = { ...source, generatedAt: new Date().toISOString(), capabilityVersion: `${source.productVersion}-${sourceHash.slice(0, 12)}`, sourceHash };
  write("capabilities.json", JSON.stringify(snapshot, null, 2) + "\n");
  write("schemas/input.json", JSON.stringify(inputSchema, null, 2) + "\n");
  write("schemas/output.json", JSON.stringify(outputSchema, null, 2) + "\n");
  write("docs/AI_CAPABILITIES.md", `# AI Studio 能力快照\n\n产品版本：${source.productVersion}\n能力版本：${snapshot.capabilityVersion}\n生成时间：${snapshot.generatedAt}\n确认状态：${source.reviewStatus}\n来源哈希：${sourceHash}\n\n来源引用：${source.sourceRefs.join("；")}\n\n${source.capabilities.map(c => `## ${c.capabilityId} / ${c.name}\n\n状态：${c.status}\n入口：${c.entry || "未确认"}\n支持场景：${c.supportedScenarios.join("；")}\n限制：${c.limitations.join("；")}\n最后验证：${c.lastVerifiedAt || "未验证"}\n`).join("\n")}`);
  const files = {};
  function inventory(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) inventory(name);
      else files[name] = hash(fs.readFileSync(path.join(root, name), "utf8"));
    }
  }
  for (const directory of ["upstream", "schemas", "docs"]) inventory(directory);
  for (const name of ["adapter.md", "contract.js", "resources.js", "presentation.js", "model.js", "capabilities.json", "capability-source.json"]) files[name] = hash(fs.readFileSync(path.join(root, name), "utf8"));
  write("manifest.json", JSON.stringify({ upstreamVersion: "1.0.0-rc1", adapterVersion: "1.0.2", schemaVersion: "1.0.0", migrationVersion: 1, productVersion: source.productVersion, capabilityVersion: snapshot.capabilityVersion, buildHash: hash(files), files }, null, 2) + "\n");
}
const resources = require("./resources").loadResources();
if (!resources.manifest || !resources.integrity) throw new Error("Controlled resource integrity check failed");
if (hash(source) !== resources.context.sourceHash) throw new Error("Capability snapshot needs regeneration");
console.log(JSON.stringify({ ok: true, buildHash: resources.manifest.buildHash, reviewStatus: source.reviewStatus, dataStatus: resources.context.dataStatus }));
