"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");

const REQUIRED_SECTIONS = ["适用场景", "输入要求", "输出要求", "执行流程", "边界与禁止事项", "异常处理", "使用示例"];
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".bat", ".cmd", ".sh", ".html", ".css", ".xml", ".csv", ".ini", ".toml", ".env"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".bat", ".cmd", ".sh", ".exe", ".dll", ".msi", ".jar"]);
const VALID_OUTCOMES = new Set(["invoked", "succeeded", "failed", "cancelled"]);
const PUBLIC_SKILL_API_PATH = "/api/open/v1/enterprise-skills";

function shanghaiDateKey(value = Date.now()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function createCompanySkillPlatform(options) {
  const {
    dataRoot,
    uploadChunkBytes,
    uploadSessionMaxAgeMs,
    maximumUploadBytes,
    privateKeyPem,
    publicBaseUrl,
    sendJson,
    readJsonBody,
    requireDesktopSession,
    requireAuthorizedDesktopSession,
    requireAdmin,
    isExcludedIdentity = () => false,
    resolveSkillTaxonomy = async (input) => ({
      category: text(input.category, 40),
      categoryId: safeIdentifier(input.categoryId, 64) || "efficiency-tools",
      tagIds: (Array.isArray(input.tagIds) ? input.tagIds : []).map((item) => safeIdentifier(item, 64)).filter(Boolean),
      tagNames: []
    })
  } = options;

  const skillsRoot = path.join(dataRoot, "skills");
  const submissionsRoot = path.join(skillsRoot, "submissions");
  const publicRoot = path.join(skillsRoot, "public");
  const uploadsRoot = path.join(skillsRoot, "uploads");
  const submissionsPath = path.join(dataRoot, "skill-submissions.json");
  const catalogPath = path.join(dataRoot, "company-skills.json");
  const usagePath = path.join(dataRoot, "skill-usage.json");
  const mutationQueues = new Map();

  for (const directory of [submissionsRoot, publicRoot, uploadsRoot]) fs.mkdirSync(directory, { recursive: true });

  function readStore(filePath, fallback) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporaryPath, filePath);
  }

  function readSubmissions() {
    const store = readStore(submissionsPath, { schemaVersion: 1, submissions: [] });
    if (!Array.isArray(store.submissions)) store.submissions = [];
    return store;
  }

  function readCatalog() {
    const store = readStore(catalogPath, { schemaVersion: 1, skills: [], revokedSkillIds: [] });
    if (!Array.isArray(store.skills)) store.skills = [];
    if (!Array.isArray(store.revokedSkillIds)) store.revokedSkillIds = [];
    return store;
  }

  function readUsage() {
    const store = readStore(usagePath, { schemaVersion: 1, aggregates: {} });
    if (!store.aggregates || typeof store.aggregates !== "object") store.aggregates = {};
    if (!store.eventKeys || typeof store.eventKeys !== "object") store.eventKeys = {};
    return store;
  }

  function queueMutation(name, work) {
    const previous = mutationQueues.get(name) || Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    const queued = current.then(() => undefined, () => undefined).finally(() => {
      if (mutationQueues.get(name) === queued) mutationQueues.delete(name);
    });
    mutationQueues.set(name, queued);
    return current;
  }

  function safeIdentifier(value, maximumLength = 128) {
    return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, maximumLength);
  }

  function text(value, maximumLength = 500) {
    return String(value || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").trim().slice(0, maximumLength);
  }

  function adminActorName(request) {
    return text(decodedHeader(request, "x-admin-name"), 80) || "平台管理员";
  }

  function adminActorIdentity(request) {
    const name = adminActorName(request);
    const adminId = text(decodedHeader(request, "x-admin-id"), 128);
    const username = text(decodedHeader(request, "x-admin-username"), 128);
    return {
      name,
      realName: name,
      department: "",
      ...(adminId ? { adminId, userId: adminId } : {}),
      ...(username ? { username } : {})
    };
  }

  function isMapmsAdminIdentity(identity) {
    return Boolean(text(identity?.adminId, 128) && text(identity?.username, 128));
  }

  function semver(value) {
    const normalized = String(value || "").trim();
    if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
      throw new Error("技能版本必须使用语义化版本，例如 1.0.0");
    }
    return normalized;
  }

  function compareSemver(left, right) {
    const numeric = (value) => String(value || "0.0.0").split(/[+-]/)[0].split(".").map(Number);
    const a = numeric(left);
    const b = numeric(right);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return String(left).localeCompare(String(right));
  }

  function enterpriseName(value) {
    const normalized = text(value, 80);
    if (!normalized) throw new Error("企业发布名称不能为空");
    return normalized;
  }

  function assertEnterpriseNameAvailable(catalog, displayName, allowedSkillId = "") {
    const normalized = displayName.toLocaleLowerCase("zh-CN");
    const conflict = catalog.skills.find((item) => item.skillId !== allowedSkillId
      && String(item.displayName || "").trim().toLocaleLowerCase("zh-CN") === normalized);
    if (conflict) throw new Error(`企业发布名称“${displayName}”已经存在，请更换名称`);
  }

  function appendAudit(submission, action, detail = {}) {
    if (!Array.isArray(submission.auditTrail)) submission.auditTrail = [];
    const event = {
      eventId: safeIdentifier(`audit-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`),
      action,
      actor: text(detail.actor || "平台管理员", 80),
      reason: text(detail.reason, 500),
      occurredAt: detail.occurredAt || new Date().toISOString(),
      ...(detail.enterpriseDisplayName ? { enterpriseDisplayName: text(detail.enterpriseDisplayName, 80) } : {}),
      ...(detail.enterpriseCategory ? { enterpriseCategory: text(detail.enterpriseCategory, 40) } : {}),
      ...(Array.isArray(detail.enterpriseTagIds) ? { enterpriseTagIds: detail.enterpriseTagIds.map((item) => safeIdentifier(item, 64)).filter(Boolean) } : {})
    };
    submission.auditTrail.push(event);
    return event;
  }

  function submissionAuditTrail(submission) {
    const trail = Array.isArray(submission.auditTrail) ? [...submission.auditTrail] : [];
    if (submission.submittedAt && !trail.some((item) => item.action === "submitted")) {
      trail.unshift({
        eventId: `legacy-submitted-${submission.submissionId}`,
        action: "submitted",
        actor: text(submission.submitter?.name || submission.submitter?.realName || "钉钉用户", 80),
        reason: "",
        occurredAt: submission.submittedAt
      });
    }
    return trail.sort((left, right) => Date.parse(left.occurredAt || 0) - Date.parse(right.occurredAt || 0));
  }

  function parseFrontMatter(markdown) {
    const match = String(markdown || "").replace(/^\uFEFF/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) throw new Error("SKILL.md 必须以 YAML Front Matter 开头");
    const values = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0 || /^\s/.test(line)) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[key] = value;
    }
    return values;
  }

  function validateMarkdown(markdown) {
    const source = String(markdown || "").replace(/^\uFEFF/, "").trim();
    const frontMatter = parseFrontMatter(source);
    const name = String(frontMatter.name || "").trim();
    const description = text(frontMatter.description, 500);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) throw new Error("技能 name 只能使用小写字母、数字和连字符，最长 64 个字符");
    if (!description) throw new Error("SKILL.md 的 description 不能为空");
    for (const section of REQUIRED_SECTIONS) {
      const heading = new RegExp(`^#{1,6}\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
      const match = heading.exec(source);
      if (!match) throw new Error(`SKILL.md 缺少“${section}”章节`);
      const body = source.slice(match.index + match[0].length).split(/\r?\n#{1,6}\s+/)[0].trim();
      if (!body) throw new Error(`SKILL.md 的“${section}”章节不能为空`);
    }
    return { name, description, frontMatter };
  }

  function validateMetadata(raw, markdownInfo) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("skill.json 格式不正确");
    const required = ["schemaVersion", "version", "displayName", "category", "starter", "icon", "fields", "supportedInputs", "outputs", "permissions", "dependencies"];
    for (const key of required) {
      if (raw[key] === undefined || raw[key] === null || raw[key] === "") throw new Error(`skill.json 缺少 ${key}`);
    }
    const version = semver(raw.version);
    if (!Array.isArray(raw.fields)) throw new Error("skill.json 的 fields 必须是数组");
    if (!Array.isArray(raw.supportedInputs)) throw new Error("skill.json 的 supportedInputs 必须是数组");
    if (!Array.isArray(raw.outputs)) throw new Error("skill.json 的 outputs 必须是数组");
    if (!Array.isArray(raw.permissions)) throw new Error("skill.json 的 permissions 必须是数组");
    if (!Array.isArray(raw.dependencies)) throw new Error("skill.json 的 dependencies 必须是数组");
    return {
      schemaVersion: Math.max(1, Number(raw.schemaVersion) || 1),
      version,
      name: markdownInfo.name,
      displayName: text(raw.displayName, 80),
      description: markdownInfo.description,
      category: text(raw.category, 40),
      categoryId: safeIdentifier(raw.categoryId || raw.category, 64) || "efficiency-tools",
      tagIds: (Array.isArray(raw.tagIds) ? raw.tagIds : []).map((item) => safeIdentifier(item, 64)).filter(Boolean).slice(0, 20),
      newTags: [...new Set((Array.isArray(raw.newTags) ? raw.newTags : [])
        .map((item) => text(item, 40))
        .filter(Boolean))].slice(0, 20),
      starter: text(raw.starter, 300),
      icon: safeIdentifier(raw.icon, 40) || "sparkles",
      fields: raw.fields.slice(0, 40),
      supportedInputs: raw.supportedInputs.map((item) => text(item, 40)).filter(Boolean).slice(0, 80),
      outputs: raw.outputs.map((item) => text(item, 40)).filter(Boolean).slice(0, 80),
      permissions: raw.permissions.map((item) => text(item, 80)).filter(Boolean).slice(0, 80),
      dependencies: raw.dependencies.map((item) => text(item, 160)).filter(Boolean).slice(0, 80)
    };
  }

  function findEndOfCentralDirectory(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size < 22) throw new Error("ZIP 包内容损坏");
    const tailSize = Math.min(stat.size, 65557);
    const tail = Buffer.allocUnsafe(tailSize);
    const handle = fs.openSync(filePath, "r");
    try { fs.readSync(handle, tail, 0, tail.length, stat.size - tail.length); } finally { fs.closeSync(handle); }
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
      const disk = tail.readUInt16LE(offset + 4);
      const centralDisk = tail.readUInt16LE(offset + 6);
      const entries = tail.readUInt16LE(offset + 10);
      const centralSize = tail.readUInt32LE(offset + 12);
      const centralOffset = tail.readUInt32LE(offset + 16);
      if (disk !== 0 || centralDisk !== 0 || entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error("技能包暂不支持 ZIP64 或多卷 ZIP，请拆分超大资源后重试");
      }
      return { entries, centralSize, centralOffset, fileSize: stat.size };
    }
    throw new Error("ZIP 包缺少中央目录，文件可能已损坏");
  }

  function normalizeZipPath(value) {
    const source = String(value || "").replaceAll("\\", "/");
    if (!source || source.includes("\0") || source.startsWith("/") || /^[a-zA-Z]:\//.test(source)) throw new Error("技能包包含绝对路径");
    const normalized = path.posix.normalize(source);
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new Error("技能包包含越界路径");
    return normalized.replace(/^\.\//, "");
  }

  function parseZipEntries(filePath) {
    const directory = findEndOfCentralDirectory(filePath);
    if (directory.entries > 10000 || directory.centralSize > 64 * 1024 * 1024) throw new Error("技能包文件数量异常，可能是压缩炸弹");
    if (directory.centralOffset + directory.centralSize > directory.fileSize) throw new Error("ZIP 中央目录越界");
    const central = Buffer.allocUnsafe(directory.centralSize);
    const handle = fs.openSync(filePath, "r");
    try { fs.readSync(handle, central, 0, central.length, directory.centralOffset); } finally { fs.closeSync(handle); }
    const entries = [];
    let offset = 0;
    let totalCompressed = 0;
    let totalUncompressed = 0;
    while (offset < central.length && entries.length < directory.entries) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP 中央目录内容损坏");
      const versionMadeBy = central.readUInt16LE(offset + 4);
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const crc32 = central.readUInt32LE(offset + 16);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const localOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new Error("ZIP 文件名或扩展字段越界");
      const rawName = central.subarray(offset + 46, offset + 46 + nameLength);
      const name = normalizeZipPath(rawName.toString("utf8"));
      const directoryEntry = name.endsWith("/");
      const unixMode = (versionMadeBy >> 8) === 3 ? ((externalAttributes >>> 16) & 0xffff) : 0;
      if ((unixMode & 0xf000) === 0xa000) throw new Error("技能包不能包含符号链接");
      if (flags & 0x1) throw new Error("技能包不能使用加密 ZIP 条目");
      if (![0, 8].includes(method) && !directoryEntry) throw new Error(`技能包包含不支持的压缩方式：${name}`);
      if (!directoryEntry && compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > 200) {
        throw new Error(`技能包包含异常压缩条目：${name}`);
      }
      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      entries.push({ name, directory: directoryEntry, method, flags, crc32, compressedSize, uncompressedSize, localOffset });
      offset = end;
    }
    if (entries.length !== directory.entries) throw new Error("ZIP 条目数量不一致");
    if (totalCompressed > 0 && totalUncompressed > 32 * 1024 * 1024 && totalUncompressed / totalCompressed > 100) throw new Error("技能包整体压缩比异常，可能是压缩炸弹");
    return entries;
  }

  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function readZipEntry(filePath, entry, maximumBytes = 16 * 1024 * 1024) {
    if (entry.uncompressedSize > maximumBytes || entry.compressedSize > maximumBytes) throw new Error(`文本文件过大，无法完成安全检查：${entry.name}`);
    const handle = fs.openSync(filePath, "r");
    try {
      const local = Buffer.allocUnsafe(30);
      fs.readSync(handle, local, 0, local.length, entry.localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP 本地条目损坏：${entry.name}`);
      const nameLength = local.readUInt16LE(26);
      const extraLength = local.readUInt16LE(28);
      const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
      const compressed = Buffer.allocUnsafe(entry.compressedSize);
      fs.readSync(handle, compressed, 0, compressed.length, dataOffset);
      const output = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: maximumBytes });
      if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc32) throw new Error(`ZIP 条目校验失败：${entry.name}`);
      return output;
    } finally {
      fs.closeSync(handle);
    }
  }

  function containsPlaintextSecret(content) {
    const source = String(content || "");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) return true;
    if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(source)) return true;
    return /\b(?:api[_ -]?key|secret|access[_ -]?token|password)\s*[:=]\s*["']?(?!\$\{|<|replace|your[-_ ]|example|demo|test|x{4,})[A-Za-z0-9_./+=-]{12,}/i.test(source);
  }

  function inspectSkillPackage(filePath) {
    const entries = parseZipEntries(filePath);
    const files = entries.filter((entry) => !entry.directory);
    const skillFiles = files.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.name));
    if (skillFiles.length !== 1) throw new Error("公司技能包必须且只能包含一个 SKILL.md");
    const root = skillFiles[0].name.slice(0, -"SKILL.md".length);
    const metadataEntry = files.find((entry) => entry.name === `${root}skill.json`);
    if (!metadataEntry) throw new Error("公司技能包必须包含与 SKILL.md 同级的 skill.json");
    const markdown = readZipEntry(filePath, skillFiles[0]).toString("utf8");
    const markdownInfo = validateMarkdown(markdown);
    let rawMetadata;
    try { rawMetadata = JSON.parse(readZipEntry(filePath, metadataEntry).toString("utf8")); } catch (error) { throw new Error(`skill.json 解析失败：${error.message}`); }
    const metadata = validateMetadata(rawMetadata, markdownInfo);
    const riskItems = [];
    const previews = [];
    let scannedBytes = 0;
    for (const entry of files) {
      if (!entry.name.startsWith(root)) throw new Error("技能包只能包含一个技能根目录");
      const relativePath = entry.name.slice(root.length);
      const extension = path.extname(relativePath).toLowerCase();
      if (SCRIPT_EXTENSIONS.has(extension)) riskItems.push(`包含脚本或程序：${relativePath}`);
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      scannedBytes += entry.uncompressedSize;
      if (scannedBytes > 128 * 1024 * 1024) throw new Error("技能包文本内容过大，无法完成明文密钥安全检查");
      const content = readZipEntry(filePath, entry).toString("utf8");
      if (containsPlaintextSecret(content)) throw new Error(`技能包包含疑似明文密钥：${relativePath}`);
      if (/https?:\/\//i.test(content) && !riskItems.includes("包含外部网络访问")) riskItems.push("包含外部网络访问");
      if (/\b(?:powershell|pwsh|cmd(?:\.exe)?|child_process|execSync|spawnSync|subprocess|os\.system)\b/i.test(content) && !riskItems.includes("包含 Shell 或系统命令调用")) riskItems.push("包含 Shell 或系统命令调用");
      if (previews.length < 30) previews.push({ path: relativePath, content: content.slice(0, 64 * 1024), truncated: content.length > 64 * 1024 });
    }
    for (const permission of metadata.permissions) {
      if (/shell|command|network|environment|script|execute|write|delete|install/i.test(permission)) riskItems.push(`声明高风险权限：${permission}`);
    }
    const uniqueRisks = [...new Set(riskItems)].slice(0, 80);
    return {
      metadata,
      riskLevel: uniqueRisks.length ? "high" : "low",
      riskItems: uniqueRisks,
      fileTree: files.map((entry) => ({ path: entry.name.slice(root.length), size: entry.uncompressedSize, compressedSize: entry.compressedSize })).filter((entry) => entry.path),
      previews,
      totalBytes: files.reduce((total, entry) => total + entry.uncompressedSize, 0),
      fileCount: files.length
    };
  }

  function markdownWithoutFrontMatter(markdown) {
    return String(markdown || "").replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim();
  }

  function directPublishFrontMatter(markdown) {
    try { return parseFrontMatter(markdown); } catch { return {}; }
  }

  function directPublishSkillName(value, seed) {
    const normalized = String(value || "").trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/g, "");
    if (/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized)) return normalized;
    return `imported-skill-${crypto.createHash("sha256").update(String(seed || value || Date.now())).digest("hex").slice(0, 10)}`;
  }

  function ensureMarkdownSection(markdown, title, fallback) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const heading = new RegExp(`^#{1,6}\\s*${escapedTitle}\\s*$`, "m");
    const match = heading.exec(markdown);
    if (!match) return `${markdown.trim()}\n\n# ${title}\n${fallback}`.trim();
    const contentStart = match.index + match[0].length;
    const remaining = markdown.slice(contentStart);
    const nextHeading = /\r?\n#{1,6}\s+/.exec(remaining);
    const contentEnd = contentStart + (nextHeading ? nextHeading.index : remaining.length);
    if (markdown.slice(contentStart, contentEnd).trim()) return markdown;
    return `${markdown.slice(0, contentStart)}\n${fallback}\n${markdown.slice(contentStart)}`;
  }

  function normalizeDirectPublishContent(markdown, rawMetadata = {}, options = {}, root = "") {
    const frontMatter = directPublishFrontMatter(markdown);
    const folderName = root.replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
    const headingName = String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const displayName = text(options.enterpriseDisplayName || rawMetadata.displayName || headingName || frontMatter.name || folderName || "导入技能", 80) || "导入技能";
    const name = directPublishSkillName(frontMatter.name || rawMetadata.name || folderName || displayName, `${root}\0${markdown}`);
    const description = text(frontMatter.description || rawMetadata.description || `用于完成${displayName}相关任务。`, 500) || `用于完成${displayName}相关任务。`;
    const outputs = Array.isArray(rawMetadata.outputs) && rawMetadata.outputs.length ? rawMetadata.outputs : ["markdown"];
    const sectionDefaults = {
      "适用场景": `适用于用户明确选择“${displayName}”并提供相关任务材料的场景。`,
      "输入要求": "请提供需要处理的文字内容；如有相关图片、文档或其他附件，可一并提供。",
      "输出要求": `按照技能原始说明生成完整结果；默认输出格式为 ${outputs.map((item) => text(item, 40)).filter(Boolean).join("、") || "markdown"}。`,
      "执行流程": "1. 阅读用户目标和输入材料。\n2. 严格按照原始技能说明执行。\n3. 检查结果完整性后输出。",
      "边界与禁止事项": "不得编造用户未提供的事实；涉及覆盖、删除、安装、命令执行或系统修改时必须再次确认。",
      "异常处理": "输入不足时明确指出缺失信息并请求补充；部分附件无法读取时说明具体文件，并继续处理其他可用内容。",
      "使用示例": `用户：请使用“${displayName}”处理我提供的内容。\n技能：读取输入后，按照技能原始说明完成任务并返回结果。`
    };
    let body = markdownWithoutFrontMatter(markdown);
    for (const [title, fallback] of Object.entries(sectionDefaults)) body = ensureMarkdownSection(body, title, fallback);
    const normalizedMarkdown = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;
    const version = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(rawMetadata.version || "").trim())
      ? String(rawMetadata.version).trim()
      : "1.0.0";
    const metadata = {
      ...rawMetadata,
      schemaVersion: Math.max(1, Number(rawMetadata.schemaVersion) || 1),
      version,
      displayName,
      category: text(options.category || rawMetadata.category || "其他", 40) || "其他",
      categoryId: safeIdentifier(options.categoryId || rawMetadata.categoryId || rawMetadata.category, 64) || "other",
      tagIds: (Array.isArray(options.tagIds) && options.tagIds.length ? options.tagIds : rawMetadata.tagIds || []).map((item) => safeIdentifier(item, 64)).filter(Boolean).slice(0, 20),
      starter: text(rawMetadata.starter || `请使用“${displayName}”处理以下内容：`, 300),
      icon: safeIdentifier(rawMetadata.icon, 40) || "sparkles",
      fields: Array.isArray(rawMetadata.fields) ? rawMetadata.fields : [],
      supportedInputs: Array.isArray(rawMetadata.supportedInputs) ? rawMetadata.supportedInputs : ["text", "document", "image"],
      outputs,
      permissions: Array.isArray(rawMetadata.permissions) ? rawMetadata.permissions : [],
      dependencies: Array.isArray(rawMetadata.dependencies) ? rawMetadata.dependencies : []
    };
    return { markdown: normalizedMarkdown, metadata };
  }

  async function prepareDirectPublishPackage(packagePath, normalizedPath, options = {}) {
    try {
      return { packagePath, inspection: inspectSkillPackage(packagePath), normalized: false, normalizationMessage: "" };
    } catch (initialError) {
      const entries = parseZipEntries(packagePath);
      const files = entries.filter((entry) => !entry.directory);
      const skillFiles = files.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.name));
      if (skillFiles.length !== 1) throw initialError;
      const skillEntry = skillFiles[0];
      const root = skillEntry.name.slice(0, -"SKILL.md".length);
      const markdown = readZipEntry(packagePath, skillEntry).toString("utf8");
      const metadataEntry = files.find((entry) => entry.name.toLowerCase() === `${root}skill.json`.toLowerCase())
        || files.find((entry) => entry.name.toLowerCase() === `${root}package.json`.toLowerCase());
      let rawMetadata = {};
      if (metadataEntry) {
        try { rawMetadata = JSON.parse(readZipEntry(packagePath, metadataEntry).toString("utf8")); } catch { rawMetadata = {}; }
      }
      if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) rawMetadata = {};
      const normalized = normalizeDirectPublishContent(markdown, rawMetadata, options, root);
      const sourceZip = await JSZip.loadAsync(fs.readFileSync(packagePath), { checkCRC32: true, createFolders: true });
      const outputZip = new JSZip();
      for (const entry of Object.values(sourceZip.files)) {
        if (entry.dir || !entry.name.startsWith(root)) continue;
        const relativePath = entry.name.slice(root.length);
        if (!relativePath || /^SKILL\.md$/i.test(relativePath) || /^skill\.json$/i.test(relativePath)) continue;
        outputZip.file(`${root}${relativePath}`, await entry.async("nodebuffer"));
      }
      outputZip.file(`${root}SKILL.md`, normalized.markdown);
      outputZip.file(`${root}skill.json`, JSON.stringify(normalized.metadata, null, 2));
      const normalizedBuffer = await outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
      if (Number.isFinite(maximumUploadBytes) && normalizedBuffer.length > maximumUploadBytes) throw new Error("自动补齐后的技能包超过服务器当前可接收容量");
      fs.writeFileSync(normalizedPath, normalizedBuffer);
      return {
        packagePath: normalizedPath,
        inspection: inspectSkillPackage(normalizedPath),
        normalized: true,
        normalizationMessage: "已保留原始技能说明、脚本和资源，并自动补齐企业发布格式"
      };
    }
  }

  function skillUploadDirectory(uploadId) {
    return path.join(uploadsRoot, safeIdentifier(uploadId));
  }

  function skillUploadSessionPath(uploadId) {
    return path.join(skillUploadDirectory(uploadId), "session.json");
  }

  function readUploadSession(uploadId) {
    const safeId = safeIdentifier(uploadId);
    if (!safeId || !fs.existsSync(skillUploadSessionPath(safeId))) throw new Error("技能上传会话不存在或已过期");
    const session = JSON.parse(fs.readFileSync(skillUploadSessionPath(safeId), "utf8"));
    if (session.uploadId !== safeId) throw new Error("技能上传会话无效");
    return session;
  }

  function writeUploadSession(session) {
    const directory = skillUploadDirectory(session.uploadId);
    fs.mkdirSync(directory, { recursive: true });
    writeStore(skillUploadSessionPath(session.uploadId), session);
  }

  function expectedChunkSize(session, index) {
    return Math.max(0, Math.min(session.chunkSize, session.fileSize - index * session.chunkSize));
  }

  function skillChunkPath(session, index) {
    return path.join(skillUploadDirectory(session.uploadId), `${index}.part`);
  }

  function uploadedChunks(session) {
    const result = [];
    for (let index = 0; index < session.chunkCount; index += 1) {
      const filePath = skillChunkPath(session, index);
      if (fs.existsSync(filePath) && fs.statSync(filePath).size === expectedChunkSize(session, index)) result.push(index);
    }
    return result;
  }

  function cleanupStaleUploads() {
    const cutoff = Date.now() - uploadSessionMaxAgeMs;
    for (const entry of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(uploadsRoot, entry.name);
      try {
        const session = JSON.parse(fs.readFileSync(path.join(directory, "session.json"), "utf8"));
        if (Date.parse(session.updatedAt || session.createdAt || 0) < cutoff) fs.rmSync(directory, { recursive: true, force: true });
      } catch {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  }

  function streamChunk(request, targetPath, expectedLength) {
    return new Promise((resolve, reject) => {
      const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.uploading`;
      const output = fs.createWriteStream(temporaryPath, { flags: "w" });
      let bytes = 0;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) {
          output.destroy();
          fs.rmSync(temporaryPath, { force: true });
          reject(error);
          return;
        }
        fs.renameSync(temporaryPath, targetPath);
        resolve(bytes);
      };
      request.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > expectedLength) {
          request.destroy();
          finish(new Error("技能上传分片大小超出预期"));
        }
      });
      request.on("error", finish);
      output.on("error", finish);
      output.on("finish", () => finish(bytes === expectedLength ? null : new Error("技能上传分片不完整")));
      request.pipe(output);
    });
  }

  function streamRequestFile(request, targetPath, maximumBytes) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(targetPath, { flags: "wx" });
      let bytes = 0;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) {
          request.unpipe(output);
          output.destroy();
          request.resume();
          fs.rmSync(targetPath, { force: true });
          reject(error);
        } else {
          resolve(bytes);
        }
      };
      request.on("data", (chunk) => {
        bytes += chunk.length;
        if (Number.isFinite(maximumBytes) && bytes > maximumBytes) finish(new Error("技能包超过服务器当前可接收容量"));
      });
      request.on("aborted", () => finish(new Error("技能包上传已中断")));
      request.on("error", finish);
      output.on("error", finish);
      output.on("finish", () => finish());
      request.pipe(output);
    });
  }

  function hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const input = fs.createReadStream(filePath);
      input.on("data", (chunk) => hash.update(chunk));
      input.on("error", reject);
      input.on("end", () => resolve(hash.digest("hex")));
    });
  }

  function publicSubmission(submission, includeDetail = false) {
    const submitterExcluded = isExcludedIdentity(submission);
    const submitter = {
      name: submitterExcluded ? "内部提交" : text(submission.submitter?.name || "钉钉用户", 80),
      department: submitterExcluded ? "" : text(submission.submitter?.department, 120)
    };
    const result = {
      submissionId: submission.submissionId,
      skillId: submission.skillId,
      name: submission.name,
      displayName: submission.displayName,
      description: submission.description,
      category: submission.category,
      categoryId: submission.categoryId || "efficiency-tools",
      tagIds: submission.tagIds || [],
      newTags: submission.newTags || [],
      enterpriseDisplayName: submission.enterpriseDisplayName || "",
      enterpriseCategory: submission.enterpriseCategory || "",
      enterpriseCategoryId: submission.enterpriseCategoryId || "",
      enterpriseTagIds: submission.enterpriseTagIds || [],
      enterpriseTagNames: submission.enterpriseTagNames || [],
      version: submission.version,
      status: submission.status,
      stateVersion: Number(submission.stateVersion || 1),
      riskLevel: submission.riskLevel,
      riskItems: submission.riskItems,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt || "",
      approvedAt: submission.approvedAt || "",
      publishedAt: submission.publishedAt || "",
      withdrawnAt: submission.withdrawnAt || "",
      revokedAt: submission.revokedAt || "",
      rejectionReason: submission.rejectionReason || "",
      submitter,
      sha256: submission.sha256,
      size: submission.size,
      fileCount: submission.fileCount,
      auditTrail: submissionAuditTrail(submission).map((entry) => ({
        ...entry,
        actor: submitterExcluded && entry.actor
          ? "内部提交"
          : (entry.actor && entry.actor === submission.submitter?.realName ? submitter.name : entry.actor)
      }))
    };
    if (includeDetail) {
      result.fileTree = submission.fileTree || [];
      result.previews = submission.previews || [];
    }
    return result;
  }

  function publicCatalogSkill(skill) {
    const latest = [...(skill.versions || [])].filter((version) => version.status === "published").sort((a, b) => compareSemver(b.version, a.version))[0];
    if (!latest) return null;
    const creatorExcluded = isExcludedIdentity(skill);
    return {
      skillId: skill.skillId,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      category: skill.category,
      categoryId: skill.categoryId || "efficiency-tools",
      tagIds: skill.tagIds || [],
      tagNames: skill.tagNames || [],
      creator: skill.creator ? {
        name: creatorExcluded ? "开发团队" : text(skill.creator.name || "钉钉用户", 80),
        department: creatorExcluded ? "" : text(skill.creator.department, 120)
      } : null,
      starter: skill.starter,
      icon: skill.icon,
      supportedInputs: skill.supportedInputs,
      outputs: skill.outputs,
      riskLevel: latest.riskLevel,
      riskItems: latest.riskItems,
      latestVersion: latest.version,
      sha256: latest.sha256,
      size: latest.size,
      signed: latest.signed,
      signature: latest.signature,
      publishedAt: latest.publishedAt,
      installId: `company-${skill.skillId}`
    };
  }

  function publicApiHeaders(extra = {}) {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type, accept",
      "access-control-expose-headers": "content-disposition, content-length, x-skill-id, x-skill-version",
      "cache-control": "no-store",
      ...extra
    };
  }

  function publicApiJson(response, status, value) {
    sendJson(response, status, value, publicApiHeaders());
  }

  function publicSkillUrl(skillId, suffix = "") {
    const relative = `${PUBLIC_SKILL_API_PATH}/${encodeURIComponent(skillId)}${suffix}`;
    return publicBaseUrl ? `${publicBaseUrl}${relative}` : relative;
  }

  function publishedSkillVersions(skill) {
    return [...(skill?.versions || [])]
      .filter((version) => version.status === "published")
      .sort((left, right) => compareSemver(right.version, left.version));
  }

  function publicOpenSkill(skill) {
    const catalogSkill = publicCatalogSkill(skill);
    if (!catalogSkill) return null;
    const versions = publishedSkillVersions(skill);
    const latest = versions[0];
    return {
      skillId: catalogSkill.skillId,
      name: catalogSkill.name,
      displayName: catalogSkill.displayName,
      description: catalogSkill.description,
      category: catalogSkill.category,
      categoryId: catalogSkill.categoryId,
      tagIds: catalogSkill.tagIds,
      tagNames: catalogSkill.tagNames,
      starter: catalogSkill.starter,
      icon: catalogSkill.icon,
      supportedInputs: catalogSkill.supportedInputs,
      outputs: catalogSkill.outputs,
      riskLevel: catalogSkill.riskLevel,
      riskItems: catalogSkill.riskItems,
      latestVersion: catalogSkill.latestVersion,
      sha256: catalogSkill.sha256,
      size: catalogSkill.size,
      publishedAt: catalogSkill.publishedAt,
      downloadUrl: publicSkillUrl(skill.skillId, `/package?version=${encodeURIComponent(latest.version)}`),
      versions: versions.map((version) => ({
        version: version.version,
        publishedAt: version.publishedAt,
        sha256: version.sha256,
        size: version.size,
        riskLevel: version.riskLevel,
        downloadUrl: publicSkillUrl(skill.skillId, `/package?version=${encodeURIComponent(version.version)}`)
      }))
    };
  }

  function publicSkillMatches(skill, query, category, tag) {
    const values = [
      skill.name,
      skill.displayName,
      skill.description,
      skill.category,
      ...(skill.tagNames || []),
      ...(skill.tagIds || [])
    ].map((value) => String(value || "").toLocaleLowerCase("zh-CN"));
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
    const normalizedCategory = String(category || "").trim().toLocaleLowerCase("zh-CN");
    const normalizedTag = String(tag || "").trim().toLocaleLowerCase("zh-CN");
    return (!normalizedQuery || values.some((value) => value.includes(normalizedQuery)))
      && (!normalizedCategory || [skill.category, skill.categoryId].some((value) => String(value || "").toLocaleLowerCase("zh-CN") === normalizedCategory))
      && (!normalizedTag || (skill.tagNames || []).concat(skill.tagIds || []).some((value) => String(value || "").toLocaleLowerCase("zh-CN") === normalizedTag));
  }

  function publicSkillStoreEntry(skillId) {
    return readCatalog().skills.find((skill) => skill.skillId === skillId && skill.status === "published") || null;
  }

  function publicSkillApiPath(pathname) {
    return pathname === PUBLIC_SKILL_API_PATH || pathname.startsWith(`${PUBLIC_SKILL_API_PATH}/`);
  }

  async function handlePublicSkillApi(request, response, url, pathname) {
    if (!publicSkillApiPath(pathname)) return false;
    if (request.method === "OPTIONS") {
      response.writeHead(204, publicApiHeaders({ "content-length": "0" }));
      response.end();
      return true;
    }

    if (request.method === "GET" && pathname === PUBLIC_SKILL_API_PATH) {
      const query = url.searchParams.get("q") || url.searchParams.get("search") || "";
      const category = url.searchParams.get("category") || url.searchParams.get("categoryId") || "";
      const tag = url.searchParams.get("tag") || url.searchParams.get("tagId") || "";
      const skills = readCatalog().skills
        .filter((skill) => skill.status === "published" && publicSkillMatches(skill, query, category, tag))
        .map(publicOpenSkill)
        .filter(Boolean);
      publicApiJson(response, 200, { ok: true, count: skills.length, skills });
      return true;
    }

    const versionMatch = pathname.match(new RegExp(`^${PUBLIC_SKILL_API_PATH}/([^/]+)/versions$`));
    if (request.method === "GET" && versionMatch) {
      const skill = publicSkillStoreEntry(decodeURIComponent(versionMatch[1]));
      if (!skill) {
        publicApiJson(response, 404, { ok: false, error: "企业技能不存在或已下架" });
        return true;
      }
      const versions = publishedSkillVersions(skill).map((version) => ({
        version: version.version,
        publishedAt: version.publishedAt,
        sha256: version.sha256,
        size: version.size,
        riskLevel: version.riskLevel,
        downloadUrl: publicSkillUrl(skill.skillId, `/package?version=${encodeURIComponent(version.version)}`)
      }));
      publicApiJson(response, 200, { ok: true, skillId: skill.skillId, versions });
      return true;
    }

    const packageMatch = pathname.match(new RegExp(`^${PUBLIC_SKILL_API_PATH}/([^/]+)/package$`));
    if (request.method === "GET" && packageMatch) {
      const skillId = decodeURIComponent(packageMatch[1]);
      const skill = publicSkillStoreEntry(skillId);
      if (!skill) {
        publicApiJson(response, 404, { ok: false, error: "企业技能不存在或已下架" });
        return true;
      }
      const requestedVersion = String(url.searchParams.get("version") || "").trim();
      const version = publishedSkillVersions(skill).find((item) => !requestedVersion || item.version === requestedVersion);
      if (!version) {
        publicApiJson(response, 404, { ok: false, error: "技能版本不存在或已下架" });
        return true;
      }
      servePackage(response, version.packagePath, `${skill.name}-${version.version}.zip`, publicApiHeaders({
        "cache-control": "public, max-age=31536000, immutable",
        "x-skill-id": skill.skillId,
        "x-skill-version": version.version
      }));
      return true;
    }

    const detailMatch = pathname.match(new RegExp(`^${PUBLIC_SKILL_API_PATH}/([^/]+)$`));
    if (request.method === "GET" && detailMatch) {
      const skill = publicSkillStoreEntry(decodeURIComponent(detailMatch[1]));
      if (!skill) {
        publicApiJson(response, 404, { ok: false, error: "企业技能不存在或已下架" });
        return true;
      }
      publicApiJson(response, 200, { ok: true, skill: publicOpenSkill(skill) });
      return true;
    }

    publicApiJson(response, 405, { ok: false, error: "公开企业技能接口仅支持 GET 和 OPTIONS" });
    return true;
  }

  async function initializeUpload(request, response) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    try {
      cleanupStaleUploads();
      const body = await readJsonBody(request, 64 * 1024);
      const fileName = text(body.fileName, 180);
      const fileSize = Number(body.fileSize);
      const fingerprint = safeIdentifier(body.fileFingerprint, 128);
      if (!/\.zip$/i.test(fileName)) throw new Error("公司技能审核只接受 ZIP 技能包");
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > maximumUploadBytes) throw new Error("技能包大小无效或服务器磁盘策略不允许接收");
      if (!fingerprint) throw new Error("缺少技能包指纹");
      const resumeId = safeIdentifier(body.resumeId);
      let session;
      if (resumeId && fs.existsSync(skillUploadSessionPath(resumeId))) {
        session = readUploadSession(resumeId);
        if (session.ownerUserKey !== identity.userKey || session.fileName !== fileName || session.fileSize !== fileSize || session.fileFingerprint !== fingerprint) {
          throw new Error("已有技能上传记录与当前文件不一致");
        }
        session.updatedAt = new Date().toISOString();
      } else {
        const uploadId = safeIdentifier(`skill-${Date.now()}-${crypto.randomBytes(12).toString("hex")}`);
        session = {
          uploadId,
          ownerUserKey: identity.userKey,
          fileName,
          fileSize,
          fileFingerprint: fingerprint,
          chunkSize: uploadChunkBytes,
          chunkCount: Math.ceil(fileSize / uploadChunkBytes),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      writeUploadSession(session);
      sendJson(response, 201, { uploadId: session.uploadId, chunkSize: session.chunkSize, chunkCount: session.chunkCount, uploadedChunks: uploadedChunks(session) });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function uploadChunk(request, response, uploadId, indexValue) {
    const identity = requireDesktopSession(request, response);
    if (!identity) return;
    try {
      const session = readUploadSession(uploadId);
      if (session.ownerUserKey !== identity.userKey) throw new Error("不能写入其他用户的技能上传会话");
      const index = Number(indexValue);
      if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) throw new Error("技能上传分片编号无效");
      const expectedLength = expectedChunkSize(session, index);
      const contentLength = Number(request.headers["content-length"] || 0);
      if (contentLength && contentLength !== expectedLength) throw new Error("技能上传分片长度不匹配");
      await streamChunk(request, skillChunkPath(session, index), expectedLength);
      session.updatedAt = new Date().toISOString();
      writeUploadSession(session);
      sendJson(response, 200, { ok: true, index });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function completeUpload(request, response, uploadId) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    let assembledPath = "";
    let submissionDirectory = "";
    try {
      const session = readUploadSession(uploadId);
      if (session.ownerUserKey !== identity.userKey) throw new Error("不能完成其他用户的技能上传");
      const completed = new Set(uploadedChunks(session));
      const missing = Array.from({ length: session.chunkCount }, (_, index) => index).filter((index) => !completed.has(index));
      if (missing.length) throw new Error(`技能包仍缺少 ${missing.length} 个上传分片`);
      const submissionId = safeIdentifier(`submission-${Date.now()}-${crypto.randomBytes(10).toString("hex")}`);
      submissionDirectory = path.join(submissionsRoot, submissionId);
      fs.mkdirSync(submissionDirectory, { recursive: true });
      assembledPath = path.join(submissionDirectory, "package.zip.uploading");
      const output = await fs.promises.open(assembledPath, "w");
      const hash = crypto.createHash("sha256");
      let offset = 0;
      try {
        for (let index = 0; index < session.chunkCount; index += 1) {
          const chunk = await fs.promises.readFile(skillChunkPath(session, index));
          hash.update(chunk);
          await output.write(chunk, 0, chunk.length, offset);
          offset += chunk.length;
        }
      } finally {
        await output.close();
      }
      if (offset !== session.fileSize) throw new Error("技能包合并后的大小不一致");
      const inspection = inspectSkillPackage(assembledPath);
      const packagePath = path.join(submissionDirectory, "package.zip");
      fs.renameSync(assembledPath, packagePath);
      assembledPath = "";
      const skillId = safeIdentifier(`sk-${crypto.createHash("sha256").update(`${identity.userKey}\0${inspection.metadata.name}`).digest("hex").slice(0, 20)}`);
      const submission = {
        submissionId,
        skillId,
        ownerUserKey: identity.userKey,
        submitter: {
          name: text(identity.user?.name || identity.user?.dingtalkRealName || "钉钉用户", 80),
          realName: text(identity.user?.dingtalkRealName, 80),
          department: text(identity.user?.department, 120)
        },
        name: inspection.metadata.name,
        displayName: inspection.metadata.displayName,
        description: inspection.metadata.description,
        category: inspection.metadata.category,
        categoryId: inspection.metadata.categoryId,
        tagIds: inspection.metadata.tagIds,
        newTags: inspection.metadata.newTags,
        starter: inspection.metadata.starter,
        icon: inspection.metadata.icon,
        fields: inspection.metadata.fields,
        supportedInputs: inspection.metadata.supportedInputs,
        outputs: inspection.metadata.outputs,
        permissions: inspection.metadata.permissions,
        dependencies: inspection.metadata.dependencies,
        version: inspection.metadata.version,
        status: "pending",
        stateVersion: 1,
        riskLevel: inspection.riskLevel,
        riskItems: inspection.riskItems,
        fileTree: inspection.fileTree,
        previews: inspection.previews,
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
        packagePath,
        sha256: hash.digest("hex"),
        size: offset,
        submittedAt: new Date().toISOString(),
        reviewedAt: "",
        rejectionReason: "",
        auditTrail: []
      };
      appendAudit(submission, "submitted", {
        actor: submission.submitter.name || submission.submitter.realName || "钉钉用户",
        occurredAt: submission.submittedAt
      });
      await queueMutation("approval", () => {
        const store = readSubmissions();
        const duplicate = store.submissions.find((item) => item.skillId === skillId && item.version === submission.version && !["withdrawn", "rejected"].includes(item.status));
        if (duplicate) throw new Error("该技能版本已经提交过，请提高版本号后重新提交");
        store.submissions.unshift(submission);
        writeStore(submissionsPath, store);
      });
      fs.rmSync(skillUploadDirectory(session.uploadId), { recursive: true, force: true });
      sendJson(response, 201, { submission: publicSubmission(submission, true) });
    } catch (error) {
      if (assembledPath) fs.rmSync(assembledPath, { force: true });
      if (submissionDirectory) fs.rmSync(submissionDirectory, { recursive: true, force: true });
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function listMine(request, response) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    const submissions = readSubmissions().submissions.filter((item) => item.ownerUserKey === identity.userKey).map((item) => publicSubmission(item));
    sendJson(response, 200, { submissions });
  }

  async function listCatalog(request, response) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    const store = readCatalog();
    const skills = store.skills.filter((skill) => skill.status === "published").map(publicCatalogSkill).filter(Boolean);
    sendJson(response, 200, { skills, revokedSkillIds: store.revokedSkillIds });
  }

  function servePackage(response, filePath, fileName, headers = {}) {
    if (!fs.existsSync(filePath)) {
      sendJson(response, 404, { error: "公司技能包不存在" });
      return;
    }
    const stat = fs.statSync(filePath);
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": stat.size,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...headers
    });
    fs.createReadStream(filePath).pipe(response);
  }

  async function downloadPackage(request, response, skillId, url) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    const skill = readCatalog().skills.find((item) => item.skillId === skillId && item.status === "published");
    if (!skill) return sendJson(response, 404, { error: "公司技能已下架或不存在" });
    const requestedVersion = String(url.searchParams.get("version") || "").trim();
    const version = [...(skill.versions || [])].filter((item) => item.status === "published" && (!requestedVersion || item.version === requestedVersion)).sort((a, b) => compareSemver(b.version, a.version))[0];
    if (!version) return sendJson(response, 404, { error: "没有找到可安装的技能版本" });
    servePackage(response, version.packagePath, `${skill.name}-${version.version}.zip`, {
      "x-skill-id": skill.skillId,
      "x-skill-version": version.version,
      "x-skill-sha256": version.sha256,
      "x-skill-signed": version.signed,
      "x-skill-signature": version.signature
    });
  }

  function recordUsage(skillId, version, outcome, count = 1, idempotencyKey = "") {
    const normalizedId = safeIdentifier(skillId);
    const normalizedVersion = String(version || "").trim();
    const normalizedOutcome = VALID_OUTCOMES.has(outcome) ? outcome : "failed";
    const normalizedCount = Math.min(1000, Math.max(1, Math.floor(Number(count) || 1)));
    if (!normalizedId) return Promise.resolve();
    return queueMutation("usage", () => {
      const store = readUsage();
      const normalizedEventKey = text(idempotencyKey, 240);
      if (normalizedEventKey && store.eventKeys[normalizedEventKey]) return { accepted: false, deduplicated: true };
      const date = shanghaiDateKey();
      const key = `${date}|${normalizedId}|${normalizedVersion || "unknown"}`;
      const item = store.aggregates[key] || {
        date,
        skillId: normalizedId,
        version: normalizedVersion || "unknown",
        invoked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        lastInvokedAt: ""
      };
      item[normalizedOutcome] = Number(item[normalizedOutcome] || 0) + normalizedCount;
      if (normalizedOutcome === "invoked") item.lastInvokedAt = new Date().toISOString();
      store.aggregates[key] = item;
      if (normalizedEventKey) {
        store.eventKeys[normalizedEventKey] = new Date().toISOString();
        const eventKeys = Object.keys(store.eventKeys);
        if (eventKeys.length > 200000) {
          for (const staleKey of eventKeys.slice(0, eventKeys.length - 180000)) delete store.eventKeys[staleKey];
        }
      }
      writeStore(usagePath, store);
      return { accepted: true, deduplicated: false };
    });
  }

  async function receiveUsage(request, response) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    if (isExcludedIdentity(identity)) {
      sendJson(response, 202, { ok: true, ignored: true, excludedFromStatistics: true });
      return;
    }
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const skillId = safeIdentifier(body.enterpriseSkillId || body.skillId);
      const version = String(body.version || "").trim();
      const outcome = String(body.outcome || "").trim();
      const taskId = safeIdentifier(body.taskId, 100);
      const idempotencyKey = text(body.idempotencyKey || body.eventKey || (taskId ? `company-skill:${taskId}:${skillId}:${outcome}` : ""), 240);
      const published = readCatalog().skills.some((skill) => skill.skillId === skillId && (skill.versions || []).some((item) => item.version === version));
      if (!published) throw new Error("只能统计已发布的公司技能");
      if (!VALID_OUTCOMES.has(outcome)) throw new Error("技能使用结果类型无效");
      const result = await recordUsage(skillId, version, outcome, 1, idempotencyKey);
      sendJson(response, 202, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  function usageSummary() {
    const catalog = new Map(readCatalog().skills.map((skill) => [skill.skillId, skill]));
    const records = Object.values(readUsage().aggregates);
    const today = Date.now();
    const bySkill = new Map();
    for (const record of records) {
      const item = bySkill.get(record.skillId) || {
        skillId: record.skillId,
        displayName: catalog.get(record.skillId)?.displayName || (record.skillId === "legacy-unidentified" ? "旧版未识别技能" : record.skillId),
        invoked: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        lastInvokedAt: "",
        daily: []
      };
      item.invoked += Number(record.invoked || 0);
      item.succeeded += Number(record.succeeded || 0);
      item.failed += Number(record.failed || 0);
      item.cancelled += Number(record.cancelled || 0);
      if (record.lastInvokedAt > item.lastInvokedAt) item.lastInvokedAt = record.lastInvokedAt;
      if (today - Date.parse(`${record.date}T00:00:00Z`) <= 31 * 24 * 60 * 60 * 1000) item.daily.push(record);
      bySkill.set(record.skillId, item);
    }
    return [...bySkill.values()].map((item) => ({
      ...item,
      successRate: item.succeeded + item.failed > 0 ? Math.round((item.succeeded / (item.succeeded + item.failed)) * 1000) / 10 : 0,
      last7Days: item.daily.filter((record) => today - Date.parse(`${record.date}T00:00:00Z`) <= 7 * 24 * 60 * 60 * 1000).reduce((sum, record) => sum + Number(record.invoked || 0), 0),
      last30Days: item.daily.reduce((sum, record) => sum + Number(record.invoked || 0), 0),
      daily: item.daily.sort((a, b) => a.date.localeCompare(b.date))
    })).sort((a, b) => b.invoked - a.invoked);
  }

  async function listAdminSubmissions(request, response, url) {
    if (!requireAdmin(request, response)) return;
    const status = String(url.searchParams.get("status") || "").trim();
    const submissions = readSubmissions().submissions.filter((item) => !status || item.status === status).map((item) => publicSubmission(item));
    sendJson(response, 200, { submissions });
  }

  async function getAdminSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    const submission = readSubmissions().submissions.find((item) => item.submissionId === submissionId);
    if (!submission) return sendJson(response, 404, { error: "技能提交记录不存在" });
    sendJson(response, 200, { submission: publicSubmission(submission, true) });
  }

  async function downloadAdminSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    const submission = readSubmissions().submissions.find((item) => item.submissionId === submissionId);
    if (!submission) return sendJson(response, 404, { error: "技能提交记录不存在" });
    servePackage(response, submission.packagePath, `${submission.name}-${submission.version}-submission.zip`);
  }

  async function downloadAdminCompanySkill(request, response, skillId, url) {
    if (!requireAdmin(request, response)) return;
    const skill = readCatalog().skills.find((item) => item.skillId === skillId);
    if (!skill) return sendJson(response, 404, { error: "企业技能不存在" });
    const requestedVersion = String(url.searchParams.get("version") || "").trim();
    const version = [...(skill.versions || [])]
      .filter((item) => item.status === "published" && (!requestedVersion || item.version === requestedVersion))
      .sort((left, right) => compareSemver(right.version, left.version))[0];
    if (!version) return sendJson(response, 404, { error: "没有找到可下载的已发布技能版本" });
    servePackage(response, version.packagePath, `${skill.name}-${version.version}.zip`, {
      "x-skill-id": skill.skillId,
      "x-skill-version": version.version,
      "x-skill-sha256": version.sha256 || ""
    });
  }

  function confirmedDeletionName(body, expectedName) {
    const confirmation = text(body?.confirmName, 80);
    if (!confirmation || confirmation !== expectedName) throw new Error(`请输入完整技能名称“${expectedName}”确认永久删除`);
  }

  async function deleteAdminSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const result = await queueMutation("approval", () => {
        const submissions = readSubmissions();
        const catalog = readCatalog();
        const submission = submissions.submissions.find((item) => item.submissionId === submissionId);
        if (!submission) throw new Error("技能提交记录不存在");
        const expectedName = submission.enterpriseDisplayName || submission.displayName;
        confirmedDeletionName(body, expectedName);
        const publishedReference = catalog.skills.some((skill) => (skill.versions || []).some((version) => version.submissionId === submissionId));
        if (publishedReference) throw new Error("该记录已经发布为企业技能，请在“企业技能”中永久删除");
        submissions.submissions = submissions.submissions.filter((item) => item.submissionId !== submissionId);
        writeStore(submissionsPath, submissions);
        fs.rmSync(path.join(submissionsRoot, safeIdentifier(submissionId)), { recursive: true, force: true });
        return { submissionId, displayName: expectedName };
      });
      sendJson(response, 200, { ok: true, deleted: result });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function deleteAdminCompanySkill(request, response, skillId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const result = await queueMutation("approval", () => {
        const catalog = readCatalog();
        const submissions = readSubmissions();
        const usage = readUsage();
        const skill = catalog.skills.find((item) => item.skillId === skillId);
        if (!skill) throw new Error("企业技能不存在");
        confirmedDeletionName(body, skill.displayName);
        const relatedSubmissions = submissions.submissions.filter((item) => item.skillId === skillId);
        catalog.skills = catalog.skills.filter((item) => item.skillId !== skillId);
        if (!catalog.revokedSkillIds.includes(skillId)) catalog.revokedSkillIds.push(skillId);
        submissions.submissions = submissions.submissions.filter((item) => item.skillId !== skillId);
        for (const [key, aggregate] of Object.entries(usage.aggregates)) {
          if (aggregate?.skillId === skillId) delete usage.aggregates[key];
        }
        writeStore(catalogPath, catalog);
        writeStore(submissionsPath, submissions);
        writeStore(usagePath, usage);
        for (const submission of relatedSubmissions) {
          fs.rmSync(path.join(submissionsRoot, safeIdentifier(submission.submissionId)), { recursive: true, force: true });
        }
        fs.rmSync(path.join(publicRoot, safeIdentifier(skillId)), { recursive: true, force: true });
        return { skillId, displayName: skill.displayName, submissions: relatedSubmissions.length };
      });
      sendJson(response, 200, { ok: true, deleted: result });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function approveSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const actor = adminActorName(request);
      const result = await queueMutation("approval", async () => {
        const submissions = readSubmissions();
        const submission = submissions.submissions.find((item) => item.submissionId === submissionId);
        if (!submission) throw new Error("技能提交记录不存在");
        if (submission.status !== "pending") throw new Error("只有待审核技能可以批准");
        if (submission.riskLevel === "high" && body.riskAcknowledged !== true) throw new Error("高风险技能必须勾选风险确认后批准");
        if (body.stateVersion !== undefined && Number(body.stateVersion) !== Number(submission.stateVersion || 1)) throw new Error("提交记录已被其他审核操作更新，请刷新后重试");
        const taxonomy = await resolveSkillTaxonomy({
          category: submission.category,
          categoryId: body.categoryId || submission.categoryId,
          tagIds: Array.isArray(body.tagIds) ? body.tagIds : submission.tagIds,
          newTags: Array.isArray(body.newTags) ? body.newTags : submission.newTags
        }, { requireTag: true });
        const approvedAt = new Date().toISOString();
        submission.status = "approved";
        submission.stateVersion = Number(submission.stateVersion || 1) + 1;
        submission.reviewedAt = approvedAt;
        submission.approvedAt = approvedAt;
        submission.rejectionReason = "";
        submission.enterpriseCategory = taxonomy.category;
        submission.enterpriseCategoryId = taxonomy.categoryId;
        submission.enterpriseTagIds = taxonomy.tagIds;
        submission.enterpriseTagNames = taxonomy.tagNames;
        appendAudit(submission, "approved", {
          actor,
          occurredAt: approvedAt,
          enterpriseCategory: taxonomy.category,
          enterpriseTagIds: taxonomy.tagIds
        });
        writeStore(submissionsPath, submissions);
        return publicSubmission(submission, true);
      });
      sendJson(response, 200, { ok: true, submission: result });
    } catch (error) {
      sendJson(response, /刷新|更新/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    }
  }

  async function publishSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const actor = adminActorName(request);
      const result = await queueMutation("approval", () => {
        const submissions = readSubmissions();
        const submission = submissions.submissions.find((item) => item.submissionId === submissionId);
        if (!submission) throw new Error("技能提交记录不存在");
        if (submission.status !== "approved") throw new Error("只有审核通过且待发布的技能可以发布");
        if (body.stateVersion !== undefined && Number(body.stateVersion) !== Number(submission.stateVersion || 1)) throw new Error("提交记录已被其他发布操作更新，请刷新后重试");
        const catalog = readCatalog();
        let skill = catalog.skills.find((item) => item.skillId === submission.skillId);
        const displayName = enterpriseName(body.enterpriseDisplayName || submission.enterpriseDisplayName || submission.displayName);
        assertEnterpriseNameAvailable(catalog, displayName, skill?.skillId || submission.skillId);
        if (skill?.versions?.some((item) => item.version === submission.version && item.status === "published")) throw new Error("该公司技能版本已经发布");
        const current = skill && publicCatalogSkill(skill);
        if (current && compareSemver(submission.version, current.latestVersion) <= 0) throw new Error(`新版本必须高于已发布版本 ${current.latestVersion}`);
        const targetDirectory = path.join(publicRoot, submission.skillId, submission.version);
        fs.mkdirSync(targetDirectory, { recursive: true });
        const packagePath = path.join(targetDirectory, "package.zip");
        fs.copyFileSync(submission.packagePath, packagePath);
        const publishedAt = new Date().toISOString();
        const signedPayload = {
          schemaVersion: 1,
          skillId: submission.skillId,
          name: submission.name,
          version: submission.version,
          sha256: submission.sha256,
          size: submission.size,
          publishedAt,
          downloadPath: `/api/desktop/company-skills/${submission.skillId}/package?version=${encodeURIComponent(submission.version)}`
        };
        const signed = Buffer.from(JSON.stringify(signedPayload), "utf8");
        const release = {
          version: submission.version,
          status: "published",
          packagePath,
          sha256: submission.sha256,
          size: submission.size,
          riskLevel: submission.riskLevel,
          riskItems: submission.riskItems,
          submissionId: submission.submissionId,
          enterpriseDisplayName: displayName,
          enterpriseCategory: submission.enterpriseCategory || submission.category,
          enterpriseCategoryId: submission.enterpriseCategoryId || submission.categoryId,
          enterpriseTagIds: submission.enterpriseTagIds || submission.tagIds || [],
          publishedAt,
          signed: signed.toString("base64url"),
          signature: crypto.sign(null, signed, privateKeyPem).toString("base64url")
        };
        if (!skill) {
          skill = {
            skillId: submission.skillId,
            ownerUserKey: submission.ownerUserKey,
            name: submission.name,
            displayName,
            description: submission.description,
            category: submission.enterpriseCategory || submission.category,
            categoryId: submission.enterpriseCategoryId || submission.categoryId,
            tagIds: submission.enterpriseTagIds || submission.tagIds,
            tagNames: submission.enterpriseTagNames || [],
            creator: submission.submitter,
            starter: submission.starter,
            icon: submission.icon,
            supportedInputs: submission.supportedInputs,
          outputs: submission.outputs,
          status: "published",
          updatedAt: publishedAt,
          versions: []
          };
          catalog.skills.unshift(skill);
        }
        Object.assign(skill, {
          displayName,
          description: submission.description,
          category: submission.enterpriseCategory || submission.category,
          categoryId: submission.enterpriseCategoryId || submission.categoryId,
          tagIds: submission.enterpriseTagIds || submission.tagIds,
          tagNames: submission.enterpriseTagNames || [],
          creator: skill.creator || submission.submitter,
          starter: submission.starter,
          icon: submission.icon,
          supportedInputs: submission.supportedInputs,
          outputs: submission.outputs,
          status: "published",
          updatedAt: publishedAt
        });
        const knownAuditIds = new Set((skill.auditTrail || []).map((item) => item.eventId));
        skill.auditTrail = [...(skill.auditTrail || []), ...submissionAuditTrail(submission).filter((item) => !knownAuditIds.has(item.eventId))];
        appendAudit(skill, "published", { actor, occurredAt: publishedAt, enterpriseDisplayName: displayName });
        skill.versions = [...(skill.versions || []), release];
        catalog.revokedSkillIds = catalog.revokedSkillIds.filter((id) => id !== skill.skillId);
        submission.status = "published";
        submission.stateVersion = Number(submission.stateVersion || 1) + 1;
        submission.reviewedAt = publishedAt;
        submission.publishedAt = publishedAt;
        submission.rejectionReason = "";
        submission.enterpriseDisplayName = displayName;
        appendAudit(submission, "published", { actor, occurredAt: publishedAt, enterpriseDisplayName: displayName });
        writeStore(catalogPath, catalog);
        writeStore(submissionsPath, submissions);
        return publicCatalogSkill(skill);
      });
      sendJson(response, 200, { ok: true, skill: result });
    } catch (error) {
      sendJson(response, /刷新|更新/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    }
  }

  async function rejectSubmission(request, response, submissionId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const reason = text(body.reason, 500);
      if (!reason) throw new Error("驳回必须填写原因");
      const actor = adminActorName(request);
      await queueMutation("submissions", () => {
        const store = readSubmissions();
        const submission = store.submissions.find((item) => item.submissionId === submissionId);
        if (!submission) throw new Error("技能提交记录不存在");
        if (submission.status !== "pending") throw new Error("只有待审核技能可以驳回");
        if (body.stateVersion !== undefined && Number(body.stateVersion) !== Number(submission.stateVersion || 1)) throw new Error("提交记录已被其他审核操作更新，请刷新后重试");
        submission.status = "rejected";
        submission.stateVersion = Number(submission.stateVersion || 1) + 1;
        submission.rejectionReason = reason;
        submission.reviewedAt = new Date().toISOString();
        appendAudit(submission, "rejected", { actor, occurredAt: submission.reviewedAt, reason });
        writeStore(submissionsPath, store);
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, /刷新|更新/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    }
  }

  async function withdrawSubmission(request, response, submissionId) {
    const identity = await requireAuthorizedDesktopSession(request, response);
    if (!identity) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const result = await queueMutation("submissions", () => {
        const store = readSubmissions();
        const submission = store.submissions.find((item) => item.submissionId === submissionId);
        if (!submission) throw new Error("技能提交记录不存在");
        if (submission.ownerUserKey !== identity.userKey) throw new Error("不能撤回其他用户的技能提交");
        if (submission.status !== "pending") throw new Error("只有待审核技能可以撤回");
        if (body.stateVersion !== undefined && Number(body.stateVersion) !== Number(submission.stateVersion || 1)) throw new Error("提交记录已更新，请刷新后重试");
        submission.status = "withdrawn";
        submission.stateVersion = Number(submission.stateVersion || 1) + 1;
        submission.withdrawnAt = new Date().toISOString();
        appendAudit(submission, "withdrawn", {
          actor: submission.submitter?.name || submission.submitter?.realName || "钉钉用户",
          occurredAt: submission.withdrawnAt
        });
        writeStore(submissionsPath, store);
        return publicSubmission(submission);
      });
      sendJson(response, 200, { ok: true, submission: result });
    } catch (error) {
      sendJson(response, /刷新|更新/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    }
  }

  async function revokeSkill(request, response, skillId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const reason = text(body.reason || "管理员下架", 500);
      const actor = adminActorName(request);
      await queueMutation("approval", () => {
        const store = readCatalog();
        const submissions = readSubmissions();
        const skill = store.skills.find((item) => item.skillId === skillId);
        if (!skill) throw new Error("公司技能不存在");
        const revokedAt = new Date().toISOString();
        skill.status = "revoked";
        skill.revokedAt = revokedAt;
        skill.updatedAt = revokedAt;
        appendAudit(skill, "revoked", { actor, occurredAt: revokedAt, reason });
        for (const version of skill.versions || []) {
          if (version.status === "published") {
            version.status = "revoked";
            version.revokedAt = revokedAt;
          }
        }
        for (const submission of submissions.submissions) {
          if (submission.skillId !== skillId || submission.status !== "published") continue;
          submission.status = "revoked";
          submission.stateVersion = Number(submission.stateVersion || 1) + 1;
          submission.revokedAt = revokedAt;
          appendAudit(submission, "revoked", { actor, occurredAt: revokedAt, reason });
        }
        if (!store.revokedSkillIds.includes(skillId)) store.revokedSkillIds.push(skillId);
        writeStore(catalogPath, store);
        writeStore(submissionsPath, submissions);
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function listAdminCompanySkills(request, response) {
    if (!requireAdmin(request, response)) return;
    const skills = readCatalog().skills.map((skill) => {
      const creatorExcluded = isExcludedIdentity(skill) && !isMapmsAdminIdentity(skill.creator);
      const creator = skill.creator ? {
        name: creatorExcluded ? "开发团队" : text(skill.creator.name || "钉钉用户", 80),
        department: creatorExcluded ? "" : text(skill.creator.department, 120)
      } : null;
      return {
        skillId: skill.skillId,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        category: skill.category,
        categoryId: skill.categoryId || "efficiency-tools",
        tagIds: skill.tagIds || [],
        tagNames: skill.tagNames || [],
        creator,
        status: skill.status,
        updatedAt: skill.updatedAt || submissionAuditTrail(skill).at(-1)?.occurredAt || skill.versions?.[0]?.publishedAt || "",
        auditTrail: submissionAuditTrail(skill).map((entry) => ({
          ...entry,
          actor: entry.actor && entry.actor === skill.creator?.realName ? creator?.name || "钉钉用户" : entry.actor
        })),
        versions: [...(skill.versions || [])].sort((left, right) => compareSemver(right.version, left.version)).map((version) => ({
          version: version.version,
          status: version.status,
          sha256: version.sha256,
          size: version.size,
          riskLevel: version.riskLevel,
          riskItems: version.riskItems || [],
          submissionId: version.submissionId,
          enterpriseDisplayName: version.enterpriseDisplayName || skill.displayName,
          enterpriseCategory: version.enterpriseCategory || skill.category,
          enterpriseCategoryId: version.enterpriseCategoryId || skill.categoryId,
          enterpriseTagIds: version.enterpriseTagIds || skill.tagIds || [],
          publishedAt: version.publishedAt,
          revokedAt: version.revokedAt || ""
        }))
      };
    });
    sendJson(response, 200, { skills });
  }

  function decodedHeader(request, name, fallback = "") {
    const source = String(request.headers[name] || fallback);
    try { return decodeURIComponent(source); } catch { return source; }
  }

  function decodedArrayHeader(request, name) {
    try {
      const parsed = JSON.parse(decodedHeader(request, name, "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function publishDirectPackage(packagePath, inspection, options = {}) {
    const displayName = enterpriseName(options.enterpriseDisplayName || inspection.metadata.displayName);
    const taxonomy = await resolveSkillTaxonomy({
      category: inspection.metadata.category,
      categoryId: options.categoryId || inspection.metadata.categoryId,
      tagIds: Array.isArray(options.tagIds) ? options.tagIds : inspection.metadata.tagIds,
      newTags: options.newTags || []
    }, { requireTag: true });
    const size = fs.statSync(packagePath).size;
    const sha256 = await hashFile(packagePath);
    return queueMutation("approval", () => {
      const catalog = readCatalog();
      const submissions = readSubmissions();
      let skill = catalog.skills.find((item) => item.name === inspection.metadata.name)
        || catalog.skills.find((item) => String(item.displayName || "").toLocaleLowerCase("zh-CN") === displayName.toLocaleLowerCase("zh-CN"));
      assertEnterpriseNameAvailable(catalog, displayName, skill?.skillId || "");
      const skillId = skill?.skillId || safeIdentifier(`sk-${crypto.createHash("sha256").update(`admin\0${inspection.metadata.name}\0${displayName}`).digest("hex").slice(0, 20)}`);
      if (skill?.versions?.some((item) => item.version === inspection.metadata.version)) throw new Error("该企业技能版本已经存在");
      const current = skill && publicCatalogSkill(skill);
      if (current && compareSemver(inspection.metadata.version, current.latestVersion) <= 0) throw new Error(`新版本必须高于已发布版本 ${current.latestVersion}`);
      const timestamp = new Date().toISOString();
      const submissionId = safeIdentifier(`admin-${Date.now()}-${crypto.randomBytes(10).toString("hex")}`);
      const submissionDirectory = path.join(submissionsRoot, submissionId);
      fs.mkdirSync(submissionDirectory, { recursive: true });
      const submissionPackagePath = path.join(submissionDirectory, "package.zip");
      fs.copyFileSync(packagePath, submissionPackagePath);
      const providedActorIdentity = options.actorIdentity && typeof options.actorIdentity === "object" ? options.actorIdentity : {};
      const actor = text(providedActorIdentity.name || options.actor, 80) || "平台管理员";
      const actorIdentity = {
        name: actor,
        realName: actor,
        department: "",
        ...(text(providedActorIdentity.adminId || providedActorIdentity.userId, 128) ? { adminId: text(providedActorIdentity.adminId || providedActorIdentity.userId, 128), userId: text(providedActorIdentity.adminId || providedActorIdentity.userId, 128) } : {}),
        ...(text(providedActorIdentity.username, 128) ? { username: text(providedActorIdentity.username, 128) } : {})
      };
      const actorKey = actorIdentity.adminId || actorIdentity.username || actor;
      const ownerUserKey = `platform-admin-${crypto.createHash("sha256").update(actorKey).digest("hex").slice(0, 12)}`;
      const submission = {
        submissionId,
        skillId,
        ownerUserKey,
        submitter: actorIdentity,
        name: inspection.metadata.name,
        displayName: inspection.metadata.displayName,
        description: inspection.metadata.description,
        category: inspection.metadata.category,
        categoryId: inspection.metadata.categoryId,
        tagIds: inspection.metadata.tagIds,
        enterpriseDisplayName: displayName,
        enterpriseCategory: taxonomy.category,
        enterpriseCategoryId: taxonomy.categoryId,
        enterpriseTagIds: taxonomy.tagIds,
        enterpriseTagNames: taxonomy.tagNames,
        starter: inspection.metadata.starter,
        icon: inspection.metadata.icon,
        fields: inspection.metadata.fields,
        supportedInputs: inspection.metadata.supportedInputs,
        outputs: inspection.metadata.outputs,
        permissions: inspection.metadata.permissions,
        dependencies: inspection.metadata.dependencies,
        version: inspection.metadata.version,
        status: "published",
        stateVersion: 3,
        riskLevel: inspection.riskLevel,
        riskItems: inspection.riskItems,
        fileTree: inspection.fileTree,
        previews: inspection.previews,
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
        packagePath: submissionPackagePath,
        sha256,
        size,
        sourceType: text(options.sourceType || "zip", 30),
        sourceUrl: text(options.sourceUrl, 500),
        submittedAt: timestamp,
        reviewedAt: timestamp,
        approvedAt: timestamp,
        publishedAt: timestamp,
        rejectionReason: "",
        auditTrail: []
      };
      appendAudit(submission, "direct-published", {
        actor,
        occurredAt: timestamp,
        enterpriseDisplayName: displayName,
        enterpriseCategory: taxonomy.category,
        enterpriseTagIds: taxonomy.tagIds
      });
      const targetDirectory = path.join(publicRoot, skillId, submission.version);
      fs.mkdirSync(targetDirectory, { recursive: true });
      const publicPackagePath = path.join(targetDirectory, "package.zip");
      fs.copyFileSync(packagePath, publicPackagePath);
      const signedPayload = {
        schemaVersion: 1,
        skillId,
        name: submission.name,
        version: submission.version,
        sha256,
        size,
        publishedAt: timestamp,
        downloadPath: `/api/desktop/company-skills/${skillId}/package?version=${encodeURIComponent(submission.version)}`
      };
      const signed = Buffer.from(JSON.stringify(signedPayload), "utf8");
      const release = {
        version: submission.version,
        status: "published",
        packagePath: publicPackagePath,
        sha256,
        size,
        riskLevel: submission.riskLevel,
        riskItems: submission.riskItems,
        submissionId,
        enterpriseDisplayName: displayName,
        enterpriseCategory: taxonomy.category,
        enterpriseCategoryId: taxonomy.categoryId,
        enterpriseTagIds: taxonomy.tagIds,
        publishedAt: timestamp,
        signed: signed.toString("base64url"),
        signature: crypto.sign(null, signed, privateKeyPem).toString("base64url")
      };
      if (!skill) {
        skill = { skillId, ownerUserKey, name: submission.name, creator: submission.submitter, versions: [], auditTrail: [] };
        catalog.skills.unshift(skill);
      }
      Object.assign(skill, {
        displayName,
        description: submission.description,
        category: taxonomy.category,
        categoryId: taxonomy.categoryId,
        tagIds: taxonomy.tagIds,
        tagNames: taxonomy.tagNames,
        creator: skill.creator || submission.submitter,
        starter: submission.starter,
        icon: submission.icon,
        supportedInputs: submission.supportedInputs,
        outputs: submission.outputs,
        status: "published",
        updatedAt: timestamp
      });
      appendAudit(skill, "direct-published", { actor, occurredAt: timestamp, enterpriseDisplayName: displayName });
      skill.versions = [...(skill.versions || []), release];
      catalog.revokedSkillIds = catalog.revokedSkillIds.filter((id) => id !== skillId);
      submissions.submissions.unshift(submission);
      writeStore(catalogPath, catalog);
      writeStore(submissionsPath, submissions);
      return publicCatalogSkill(skill);
    });
  }

  async function directPublishSkill(request, response) {
    if (!requireAdmin(request, response)) return;
    const temporaryDirectory = fs.mkdtempSync(path.join(uploadsRoot, "admin-direct-"));
    const temporaryPath = path.join(temporaryDirectory, "package.zip");
    try {
      const fileName = decodedHeader(request, "x-file-name", "skill.zip");
      if (!/\.zip$/i.test(fileName)) throw new Error("直接发布只接受 ZIP 技能包");
      const contentLength = Number(request.headers["content-length"] || 0);
      if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error("技能包内容为空");
      if (Number.isFinite(maximumUploadBytes) && contentLength > maximumUploadBytes) throw new Error("技能包超过服务器当前可接收容量");
      const size = await streamRequestFile(request, temporaryPath, maximumUploadBytes);
      if (size !== contentLength) throw new Error("技能包上传不完整");
      const prepared = await prepareDirectPublishPackage(temporaryPath, path.join(temporaryDirectory, "normalized.zip"), {
        enterpriseDisplayName: decodedHeader(request, "x-enterprise-name"),
        category: decodedHeader(request, "x-category-name"),
        categoryId: decodedHeader(request, "x-category-id"),
        tagIds: decodedArrayHeader(request, "x-tag-ids")
      });
      const inspection = prepared.inspection;
      if (inspection.riskLevel === "high" && request.headers["x-risk-acknowledged"] !== "1") throw new Error("高风险技能必须确认风险后才能直接发布");
      const result = await publishDirectPackage(prepared.packagePath, inspection, {
        actorIdentity: adminActorIdentity(request),
        enterpriseDisplayName: decodedHeader(request, "x-enterprise-name"),
        categoryId: decodedHeader(request, "x-category-id"),
        tagIds: request.headers["x-tag-ids"] ? decodedArrayHeader(request, "x-tag-ids") : inspection.metadata.tagIds,
        newTags: decodedArrayHeader(request, "x-new-tags"),
        sourceType: decodedHeader(request, "x-source-type", "zip")
      });
      sendJson(response, 201, { ok: true, skill: result, normalized: prepared.normalized, normalizationMessage: prepared.normalizationMessage });
    } catch (error) {
      sendJson(response, /已经存在/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  function parsePublicGitHubUrl(value) {
    let source;
    try { source = new URL(String(value || "").trim()); } catch { throw new Error("请输入有效的公开 GitHub 地址"); }
    if (source.protocol !== "https:" || source.hostname.toLowerCase() !== "github.com") throw new Error("仅支持 https://github.com 的公开仓库地址");
    const parts = source.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) throw new Error("GitHub 仓库地址格式不正确");
    const owner = parts[0];
    const repository = parts[1].replace(/\.git$/i, "");
    const treeIndex = parts[2] === "tree" ? 2 : -1;
    const ref = treeIndex >= 0 ? parts[3] : "HEAD";
    const directory = treeIndex >= 0 ? parts.slice(4).join("/") : "";
    if (!ref) throw new Error("GitHub 分支或标签不能为空");
    return { owner, repository, ref, directory, sourceUrl: source.toString() };
  }

  async function prepareGitHubPackage(github, targetPath) {
    const archiveUrl = `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repository)}/zipball/${encodeURIComponent(github.ref)}`;
    const result = await fetch(archiveUrl, { headers: { accept: "application/vnd.github+json", "user-agent": "Xianma-AI-Studio-Skill-Publisher" }, redirect: "follow" });
    if (!result.ok) throw new Error(result.status === 404 ? "GitHub 仓库、分支或目录不存在，或仓库不是公开仓库" : `GitHub 下载失败：${result.status}`);
    const length = Number(result.headers.get("content-length") || 0);
    if (Number.isFinite(maximumUploadBytes) && length > maximumUploadBytes) throw new Error("GitHub 技能包超过服务器当前可接收容量");
    const buffer = Buffer.from(await result.arrayBuffer());
    if (!buffer.length) throw new Error("GitHub 返回的技能包为空");
    if (Number.isFinite(maximumUploadBytes) && buffer.length > maximumUploadBytes) throw new Error("GitHub 技能包超过服务器当前可接收容量");
    if (!github.directory) {
      fs.writeFileSync(targetPath, buffer);
      return;
    }
    const sourceZip = await JSZip.loadAsync(buffer, { createFolders: true });
    const root = Object.keys(sourceZip.files).map((name) => name.split("/")[0]).find(Boolean);
    const prefix = `${root}/${github.directory.replace(/^\/+|\/+$/g, "")}/`;
    const output = new JSZip();
    let files = 0;
    for (const entry of Object.values(sourceZip.files)) {
      if (entry.dir || !entry.name.startsWith(prefix)) continue;
      const relative = entry.name.slice(prefix.length);
      if (!relative) continue;
      output.file(relative, await entry.async("nodebuffer"));
      files += 1;
    }
    if (!files) throw new Error("GitHub 指定目录不存在或目录为空");
    fs.writeFileSync(targetPath, await output.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  }

  async function directPublishGitHub(request, response) {
    if (!requireAdmin(request, response)) return;
    const temporaryDirectory = fs.mkdtempSync(path.join(uploadsRoot, "admin-github-"));
    const temporaryPath = path.join(temporaryDirectory, "package.zip");
    try {
      const body = await readJsonBody(request, 128 * 1024);
      const github = parsePublicGitHubUrl(body.url);
      await prepareGitHubPackage(github, temporaryPath);
      const prepared = await prepareDirectPublishPackage(temporaryPath, path.join(temporaryDirectory, "normalized.zip"), {
        enterpriseDisplayName: body.enterpriseDisplayName,
        category: body.category,
        categoryId: body.categoryId,
        tagIds: body.tagIds
      });
      const inspection = prepared.inspection;
      if (inspection.riskLevel === "high" && body.riskAcknowledged !== true) throw new Error("高风险技能必须确认风险后才能直接发布");
      const result = await publishDirectPackage(prepared.packagePath, inspection, {
        actorIdentity: adminActorIdentity(request),
        enterpriseDisplayName: body.enterpriseDisplayName,
        categoryId: body.categoryId,
        tagIds: body.tagIds,
        newTags: body.newTags,
        sourceType: "github",
        sourceUrl: github.sourceUrl
      });
      sendJson(response, 201, { ok: true, skill: result, normalized: prepared.normalized, normalizationMessage: prepared.normalizationMessage });
    } catch (error) {
      sendJson(response, /已经存在/.test(String(error?.message || error)) ? 409 : 400, { error: String(error?.message || error) });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async function republishSkill(request, response, skillId) {
    if (!requireAdmin(request, response)) return;
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const actor = adminActorName(request);
      const result = await queueMutation("approval", () => {
        const store = readCatalog();
        const submissions = readSubmissions();
        const skill = store.skills.find((item) => item.skillId === skillId);
        if (!skill) throw new Error("公司技能不存在");
        const requestedVersion = String(body.version || "").trim();
        const version = [...(skill.versions || [])]
          .filter((item) => !requestedVersion || item.version === requestedVersion)
          .sort((left, right) => compareSemver(right.version, left.version))[0];
        if (!version) throw new Error("没有找到可重新发布的技能版本");
        version.status = "published";
        version.publishedAt = new Date().toISOString();
        version.revokedAt = "";
        skill.status = "published";
        skill.revokedAt = "";
        skill.updatedAt = version.publishedAt;
        appendAudit(skill, "republished", { actor, occurredAt: version.publishedAt, reason: text(body.reason || "管理员重新发布", 500) });
        store.revokedSkillIds = store.revokedSkillIds.filter((id) => id !== skill.skillId);
        const submission = submissions.submissions.find((item) => item.submissionId === version.submissionId);
        if (submission) {
          submission.status = "published";
          submission.stateVersion = Number(submission.stateVersion || 1) + 1;
          submission.publishedAt = version.publishedAt;
          submission.revokedAt = "";
          appendAudit(submission, "republished", { actor, occurredAt: version.publishedAt, reason: text(body.reason || "管理员重新发布", 500) });
        }
        writeStore(catalogPath, store);
        writeStore(submissionsPath, submissions);
        return publicCatalogSkill(skill);
      });
      sendJson(response, 200, { ok: true, skill: result });
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
    }
  }

  async function handleRequest(request, response, url, pathname) {
    if (await handlePublicSkillApi(request, response, url, pathname)) return true;
    if (request.method === "POST" && pathname === "/api/desktop/skill-submissions/uploads") {
      await initializeUpload(request, response); return true;
    }
    const chunkMatch = pathname.match(/^\/api\/desktop\/skill-submissions\/uploads\/([^/]+)\/chunks\/(\d+)$/);
    if (request.method === "PUT" && chunkMatch) {
      await uploadChunk(request, response, decodeURIComponent(chunkMatch[1]), chunkMatch[2]); return true;
    }
    const completeMatch = pathname.match(/^\/api\/desktop\/skill-submissions\/uploads\/([^/]+)\/complete$/);
    if (request.method === "POST" && completeMatch) {
      await completeUpload(request, response, decodeURIComponent(completeMatch[1])); return true;
    }
    if (request.method === "GET" && pathname === "/api/desktop/skill-submissions/mine") {
      await listMine(request, response); return true;
    }
    const withdrawMatch = pathname.match(/^\/api\/desktop\/skill-submissions\/([^/]+)\/withdraw$/);
    if (request.method === "POST" && withdrawMatch) {
      await withdrawSubmission(request, response, decodeURIComponent(withdrawMatch[1])); return true;
    }
    if (request.method === "GET" && pathname === "/api/desktop/company-skills") {
      await listCatalog(request, response); return true;
    }
    const packageMatch = pathname.match(/^\/api\/desktop\/company-skills\/([^/]+)\/package$/);
    if (request.method === "GET" && packageMatch) {
      await downloadPackage(request, response, decodeURIComponent(packageMatch[1]), url); return true;
    }
    if (request.method === "POST" && pathname === "/api/desktop/company-skills/usage") {
      await receiveUsage(request, response); return true;
    }
    if (request.method === "GET" && pathname === "/api/admin/skill-submissions") {
      await listAdminSubmissions(request, response, url); return true;
    }
    const adminPackageMatch = pathname.match(/^\/api\/admin\/skill-submissions\/([^/]+)\/package$/);
    if (request.method === "GET" && adminPackageMatch) {
      await downloadAdminSubmission(request, response, decodeURIComponent(adminPackageMatch[1])); return true;
    }
    const adminCompanyPackageMatch = pathname.match(/^\/api\/admin\/company-skills\/([^/]+)\/package$/);
    if (request.method === "GET" && adminCompanyPackageMatch) {
      await downloadAdminCompanySkill(request, response, decodeURIComponent(adminCompanyPackageMatch[1]), url); return true;
    }
    const adminDetailMatch = pathname.match(/^\/api\/admin\/skill-submissions\/([^/]+)$/);
    if (request.method === "GET" && adminDetailMatch) {
      await getAdminSubmission(request, response, decodeURIComponent(adminDetailMatch[1])); return true;
    }
    if (request.method === "DELETE" && adminDetailMatch) {
      await deleteAdminSubmission(request, response, decodeURIComponent(adminDetailMatch[1])); return true;
    }
    const approveMatch = pathname.match(/^\/api\/admin\/skill-submissions\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveMatch) {
      await approveSubmission(request, response, decodeURIComponent(approveMatch[1])); return true;
    }
    const publishMatch = pathname.match(/^\/api\/admin\/skill-submissions\/([^/]+)\/publish$/);
    if (request.method === "POST" && publishMatch) {
      await publishSubmission(request, response, decodeURIComponent(publishMatch[1])); return true;
    }
    const rejectMatch = pathname.match(/^\/api\/admin\/skill-submissions\/([^/]+)\/reject$/);
    if (request.method === "POST" && rejectMatch) {
      await rejectSubmission(request, response, decodeURIComponent(rejectMatch[1])); return true;
    }
    const revokeMatch = pathname.match(/^\/api\/admin\/company-skills\/([^/]+)\/revoke$/);
    if (request.method === "POST" && revokeMatch) {
      await revokeSkill(request, response, decodeURIComponent(revokeMatch[1])); return true;
    }
    const deleteCompanySkillMatch = pathname.match(/^\/api\/admin\/company-skills\/([^/]+)$/);
    if (request.method === "DELETE" && deleteCompanySkillMatch) {
      await deleteAdminCompanySkill(request, response, decodeURIComponent(deleteCompanySkillMatch[1])); return true;
    }
    const republishMatch = pathname.match(/^\/api\/admin\/company-skills\/([^/]+)\/republish$/);
    if (request.method === "POST" && republishMatch) {
      await republishSkill(request, response, decodeURIComponent(republishMatch[1])); return true;
    }
    if (request.method === "GET" && pathname === "/api/admin/company-skills") {
      await listAdminCompanySkills(request, response); return true;
    }
    if (request.method === "POST" && pathname === "/api/admin/company-skills/direct-publish") {
      await directPublishSkill(request, response); return true;
    }
    if (request.method === "POST" && pathname === "/api/admin/company-skills/direct-publish/github") {
      await directPublishGitHub(request, response); return true;
    }
    if (request.method === "GET" && pathname === "/api/admin/company-skills/usage") {
      if (!requireAdmin(request, response)) return true;
      sendJson(response, 200, { skills: usageSummary() }); return true;
    }
    return false;
  }

  function recordLegacyUsage(count = 1) {
    return recordUsage("legacy-unidentified", "legacy", "invoked", count);
  }

  function migrateTelemetryStore(store) {
    let changed = false;
    for (const user of Object.values(store?.users || {})) {
      if (user?.usage && Object.prototype.hasOwnProperty.call(user.usage, "skill")) {
        delete user.usage.skill;
        changed = true;
      }
      for (const device of Object.values(user?.devices || {})) {
        if (device?.usage && Object.prototype.hasOwnProperty.call(device.usage, "skill")) {
          delete device.usage.skill;
          changed = true;
        }
      }
    }
    return changed;
  }

  return { handleRequest, recordLegacyUsage, migrateTelemetryStore, inspectSkillPackage, usageSummary };
}

module.exports = { createCompanySkillPlatform };
