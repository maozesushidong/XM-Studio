"use strict";
const fs = require("fs");
const path = require("path");
const { hash } = require("./contract");
const root = __dirname;
function methodResources(resourceRoot) {
  const selectSections = (file, titles) => {
    const source = fs.readFileSync(path.join(resourceRoot, "upstream", file), "utf8");
    const sections = source.split(/(?=^## )/m);
    const selected = titles.map(title => {
      const section = sections.find(item => item.startsWith(`## ${title}\r\n`) || item.startsWith(`## ${title}\n`));
      if (!section) throw new Error("METHOD_SECTION_MISSING");
      return section.trim();
    });
    return `来源：${file}\n${selected.join("\n\n")}`;
  };
  return [
    selectSections("SKILL.md", ["追问优先级", "必要的推理模式", "需求类型与分支"]),
    fs.readFileSync(path.join(resourceRoot, "upstream/references/questioning-engine.md"), "utf8"),
    selectSections("references/quality-gates.md", ["理解门禁", "追问门禁", "事实与证据门禁", "范围与风险门禁"])
  ].join("\n\n");
}
function loadResources(now = Date.now(), resourceRoot = root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(resourceRoot, "manifest.json"), "utf8"));
    const capabilityFiles = new Set(["capabilities.json", "capability-source.json", "docs/AI_CAPABILITIES.md"]);
    let capabilityFailure = null;
    for (const [file, expected] of Object.entries(manifest.files)) {
      try { if (hash(fs.readFileSync(path.join(resourceRoot, file), "utf8")) !== expected) throw new Error("RESOURCE_HASH"); }
      catch (e) { if (!capabilityFiles.has(file)) throw e; capabilityFailure = e.code === "ENOENT" ? "unavailable" : "error"; }
    }
    const adapter = `以下为受控上游 Skill 的访谈方法和质量门禁。其通用渠道、归档和输出格式不适用本模式。\n${methodResources(resourceRoot)}\n\n以下专用适配规则优先于上述方法资料：\n${fs.readFileSync(path.join(resourceRoot, "adapter.md"), "utf8")}`;
    if (capabilityFailure) return { manifest, adapter, integrity: false, context: { dataStatus: capabilityFailure, capabilityVersion: null, capabilities: [] } };
    const snapshot = JSON.parse(fs.readFileSync(path.join(resourceRoot, "capabilities.json"), "utf8"));
    const version = process.env.REQUIREMENT_PRODUCT_VERSION || "2.3.0.1";
    const age = now - Date.parse(snapshot.generatedAt);
    let dataStatus = "available";
    if (snapshot.productVersion !== version || snapshot.reviewStatus !== "confirmed") dataStatus = "unavailable";
    else if (!Number.isFinite(age) || age < -300000 || age > Number(process.env.REQUIREMENT_CAPABILITY_MAX_AGE_DAYS || 30) * 86400000) dataStatus = "stale";
    return { manifest, adapter, integrity: true, context: { ...snapshot, dataStatus } };
  } catch {
    return { manifest: null, adapter: "", integrity: false, context: { dataStatus: "error", capabilityVersion: null, capabilities: [] } };
  }
}
module.exports = { loadResources };
