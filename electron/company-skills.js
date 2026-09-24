"use strict";

function createCompanySkillsClient(options) {
  const {
    app,
    dialog,
    fs,
    path,
    crypto,
    JSZip,
    publicKeyPath,
    getServiceConfig,
    getSessionToken,
    getUserSkillsDir,
    listInstalledSkills,
    installCompanyPackage,
    disableCompanySkill
  } = options;
  const remoteDisabled = process.env.XIANMA_DISABLE_REMOTE_COMPANY_SKILLS === "1";
  const v11FactsQueuePath = path.join(app.getPath("userData"), "telemetry", "v11-facts-queue.json");
  const maximumPendingV11Facts = 2000;
  let pendingV11Facts = [];
  let v11FactsFlushPromise = null;

  const REQUIRED_SECTIONS = ["适用场景", "输入要求", "输出要求", "执行流程", "边界与禁止事项", "异常处理", "使用示例"];

  function readJsonPendingV11Facts() {
    try {
      const parsed = JSON.parse(fs.readFileSync(v11FactsQueuePath, "utf8"));
      return Array.isArray(parsed?.facts) ? parsed.facts.slice(-maximumPendingV11Facts) : [];
    } catch {
      return [];
    }
  }

  function writeJsonPendingV11Facts() {
    fs.mkdirSync(path.dirname(v11FactsQueuePath), { recursive: true });
    const temporaryPath = `${v11FactsQueuePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), facts: pendingV11Facts }, null, 2), "utf8");
    fs.renameSync(temporaryPath, v11FactsQueuePath);
  }

  function enqueueV11Facts(facts) {
    const incoming = Array.isArray(facts) ? facts.filter(Boolean) : [];
    if (!incoming.length) return;
    const combined = pendingV11Facts.concat(incoming);
    if (combined.length > maximumPendingV11Facts) {
      const retainedFactCapacity = maximumPendingV11Facts - 1;
      const droppedCount = combined.length - retainedFactCapacity;
      const occurredAt = new Date().toISOString();
      const qualityFact = {
        kind: "quality",
        eventKey: `offline-queue-overflow:${Date.now()}:${crypto.randomBytes(5).toString("hex")}`,
        eventType: "OFFLINE_QUEUE_OVERFLOW",
        droppedCount,
        detail: "离线事实队列达到容量上限，已保留最新记录",
        occurredAt
      };
      pendingV11Facts = combined.slice(-retainedFactCapacity).concat(qualityFact);
    } else pendingV11Facts = combined;
    writeJsonPendingV11Facts();
  }

  pendingV11Facts = readJsonPendingV11Facts();

  function safeSegment(value, fallback = "skill") {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || fallback;
  }

  function safeFileName(value, fallback = "skill") {
    return String(value || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 120) || fallback;
  }

  function normalizeZipSavePath(value) {
    const candidate = String(value || "").trim();
    if (!candidate) throw new Error("未选择保存位置");
    const targetPath = path.resolve(candidate);
    const parsed = path.parse(targetPath);
    if (targetPath === parsed.root) throw new Error("请选择具体文件名，不要直接选择磁盘根目录");
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) throw new Error("请选择 ZIP 文件名，不要选择文件夹");
    if (!path.extname(targetPath)) return `${targetPath}.zip`;
    if (path.extname(targetPath).toLowerCase() !== ".zip") throw new Error("技能包必须保存为 .zip 文件");
    return targetPath;
  }

  function ensureFileParentDirectory(filePath) {
    const targetPath = path.resolve(filePath);
    const parent = path.dirname(targetPath);
    if (fs.existsSync(parent)) {
      if (!fs.statSync(parent).isDirectory()) throw new Error("技能包保存位置不是文件夹");
      return targetPath;
    }
    if (parent === path.parse(parent).root) return targetPath;
    fs.mkdirSync(parent, { recursive: true });
    return targetPath;
  }

  function semver(value) {
    const normalized = String(value || "").trim();
    if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) throw new Error("版本必须使用语义化版本，例如 1.0.0");
    return normalized;
  }

  function compareSemver(left, right) {
    const parse = (value) => String(value || "0.0.0").split(/[+-]/)[0].split(".").map(Number);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return String(left).localeCompare(String(right));
  }

  function arrayValue(value, fallback = []) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "").split(/[,，\r\n]+/).map((item) => item.trim()).filter(Boolean).concat(fallback).filter((item, index, values) => values.indexOf(item) === index);
  }

  function normalizeDraft(source = {}) {
    const name = safeSegment(source.name, "company-skill");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) throw new Error("技能标识只能使用小写字母、数字和连字符");
    const customTagIds = new Set((Array.isArray(source.customTags) ? source.customTags : [])
      .map((item) => safeSegment(item?.tagId || "", ""))
      .filter(Boolean));
    const draft = {
      name,
      version: semver(source.version || "1.0.0"),
      displayName: String(source.displayName || "").trim().slice(0, 80),
      description: String(source.description || "").trim().slice(0, 500),
      category: String(source.category || "办公效率").trim().slice(0, 40),
      categoryId: safeSegment(source.categoryId || source.category || "efficiency-tools", "efficiency-tools"),
      tagIds: arrayValue(source.tagIds).map((item) => safeSegment(item, "")).filter((item) => item && !customTagIds.has(item) && !item.startsWith("custom-")).slice(0, 20),
      newTags: arrayValue(source.newTags).map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
      starter: String(source.starter || "").trim().slice(0, 300),
      icon: safeSegment(source.icon || "sparkles", "sparkles"),
      applicable: String(source.applicable || "").trim(),
      inputs: String(source.inputs || "").trim(),
      outputRequirements: String(source.outputRequirements || "").trim(),
      steps: String(source.steps || "").trim(),
      boundaries: String(source.boundaries || "").trim(),
      exceptions: String(source.exceptions || "").trim(),
      example: String(source.example || "").trim(),
      fields: Array.isArray(source.fields) && source.fields.length ? source.fields.slice(0, 40) : [{ id: "content", label: "输入内容", type: "textarea", required: true }],
      supportedInputs: arrayValue(source.supportedInputs, ["text"]),
      outputs: arrayValue(source.outputs, ["markdown"]),
      permissions: arrayValue(source.permissions),
      dependencies: arrayValue(source.dependencies)
    };
    for (const key of ["displayName", "description", "starter", "applicable", "inputs", "outputRequirements", "steps", "boundaries", "exceptions", "example"]) {
      if (!draft[key]) throw new Error(`请完整填写“${({ displayName: "技能名称", description: "技能说明", starter: "对话引导语", applicable: "适用场景", inputs: "输入要求", outputRequirements: "输出要求", steps: "执行流程", boundaries: "边界与禁止事项", exceptions: "异常处理", example: "使用示例" })[key]}”`);
    }
    return draft;
  }

  function buildMarkdown(draft) {
    return `---
name: ${draft.name}
description: ${draft.description.replace(/\r?\n/g, " ")}
---

# 适用场景
${draft.applicable}

# 输入要求
${draft.inputs}

# 输出要求
${draft.outputRequirements}

# 执行流程
${draft.steps}

# 边界与禁止事项
${draft.boundaries}

# 异常处理
${draft.exceptions}

# 使用示例
${draft.example}
`;
  }

  function buildMetadata(draft) {
    return {
      schemaVersion: 1,
      version: draft.version,
      displayName: draft.displayName,
      category: draft.category,
      categoryId: draft.categoryId,
      tagIds: draft.tagIds,
      newTags: draft.newTags,
      starter: draft.starter,
      icon: draft.icon,
      fields: draft.fields,
      supportedInputs: draft.supportedInputs,
      outputs: draft.outputs,
      permissions: draft.permissions,
      dependencies: draft.dependencies
    };
  }

  async function addResources(zipRoot, resources = []) {
    const used = new Set();
    for (const resourcePath of resources.map((item) => String(item?.absolutePath || item?.path || item || "").trim()).filter(Boolean)) {
      if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isFile()) continue;
      const base = safeFileName(path.basename(resourcePath), "resource");
      let fileName = base;
      let suffix = 2;
      while (used.has(fileName.toLowerCase())) {
        const extension = path.extname(base);
        fileName = `${path.basename(base, extension)}-${suffix}${extension}`;
        suffix += 1;
      }
      used.add(fileName.toLowerCase());
      zipRoot.file(`assets/${fileName}`, fs.createReadStream(resourcePath));
    }
  }

  async function generatePackageBuffer(source, resources = []) {
    const draft = normalizeDraft(source);
    const zip = new JSZip();
    const root = zip.folder(draft.name);
    root.file("SKILL.md", buildMarkdown(draft));
    root.file("skill.json", JSON.stringify(buildMetadata(draft), null, 2));
    await addResources(root, resources);
    return { draft, buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }) };
  }

  function draftPackageDirectory(userId) {
    const target = path.join(getUserSkillsDir(userId), ".company-drafts", "packages");
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  async function createSkillPackage(event, payload = {}) {
    const { draft, buffer } = await generatePackageBuffer(payload.draft || payload, payload.resources || []);
    let targetPath = path.join(draftPackageDirectory(payload.userId || "local-user"), `${draft.name}-${draft.version}.zip`);
    if (payload.saveAs === true) {
      const saveOptions = {
        title: "保存公司技能包",
        defaultPath: `${safeFileName(draft.displayName)}-${draft.version}.zip`,
        filters: [{ name: "技能 ZIP 包", extensions: ["zip"] }]
      };
      const parent = event?.sender ? require("electron").BrowserWindow.fromWebContents(event.sender) : null;
      const result = parent ? await dialog.showSaveDialog(parent, saveOptions) : await dialog.showSaveDialog(saveOptions);
      if (result.canceled || !result.filePath) return { canceled: true };
      targetPath = normalizeZipSavePath(result.filePath);
    }
    targetPath = ensureFileParentDirectory(targetPath);
    fs.writeFileSync(targetPath, buffer);
    return { canceled: false, path: targetPath, name: draft.name, displayName: draft.displayName, version: draft.version, bytes: buffer.length };
  }

  async function downloadTemplate(event) {
    const template = {
      name: "project-weekly-report",
      version: "1.0.0",
      displayName: "项目周报整理",
      description: "根据员工提供的工作记录，整理成结构清晰、可直接提交的项目周报。",
      category: "办公效率",
      starter: "请把以下工作内容整理成项目周报：完成登录页改版；修复文档下载问题；下周准备接口联调。",
      icon: "file-text",
      applicable: "当用户提供本周工作记录，希望生成个人周报或项目周报时使用。不用于编写没有事实材料的工作成果。",
      inputs: "必填：本周做了什么。可选：遇到的问题、下周计划、负责人、日期，以及相关文档或表格附件。附件不是必填项。",
      outputRequirements: "输出中文周报，固定包含“本周完成”“问题与风险”“下周计划”三个部分。合并重复事项，语言简洁；用户需要时同时生成 DOCX 文件。",
      steps: "1. 读取用户输入和附件。\n2. 提取完成事项、问题风险和下周计划。\n3. 合并重复内容，按三个固定部分排版。\n4. 检查是否存在编造内容，再输出周报。",
      boundaries: "只能根据用户提供的信息整理，不得编造数据、进度、负责人或完成结果。信息不确定时标记“待确认”。",
      exceptions: "没有附件时直接根据文字生成；工作内容为空时，请用户至少补充一项完成事项；个别附件无法读取时说明文件名，并继续处理其他可用内容。",
      example: "用户输入：\n本周完成登录页改版，修复文档下载失败；图片生成速度仍需优化；下周准备接口联调。\n\n预期结果：\n本周完成\n1. 完成登录页改版。\n2. 修复文档下载失败问题。\n\n问题与风险\n1. 图片生成速度仍需优化。\n\n下周计划\n1. 开展接口联调。",
      supportedInputs: ["text", "document", "image"],
      outputs: ["markdown", "docx"],
      permissions: [],
      dependencies: []
    };
    return createSkillPackage(event, { draft: template, saveAs: true, userId: "template" });
  }

  function parseFrontMatter(markdown) {
    const match = String(markdown || "").replace(/^\uFEFF/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) throw new Error("SKILL.md 缺少 YAML 信息块");
    const values = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    }
    return values;
  }

  function sectionBody(markdown, title) {
    const source = String(markdown || "");
    const heading = new RegExp(`^#{1,6}\\s*${title}\\s*$`, "m");
    const match = heading.exec(source);
    if (!match) return "";
    return source.slice(match.index + match[0].length).split(/\r?\n#{1,6}\s+/)[0].trim();
  }

  function draftFromMarkdown(markdown, rawMetadata = {}) {
    let frontMatter = {};
    try { frontMatter = parseFrontMatter(markdown); } catch {}
    const metadata = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata) ? rawMetadata : {};
    const rawName = String(frontMatter.name || metadata.name || "company-skill");
    const name = safeSegment(rawName, "company-skill");
    const description = String(frontMatter.description || metadata.description || "").trim();
    const displayName = String(metadata.displayName || description.split(/[。.!！?？\r\n]/)[0] || name).trim().slice(0, 80);
    return {
      name,
      version: (() => { try { return semver(metadata.version || "1.0.0"); } catch { return "1.0.0"; } })(),
      displayName,
      description,
      category: String(metadata.category || "其他").trim().slice(0, 40),
      categoryId: safeSegment(metadata.categoryId || metadata.category || "efficiency-tools", "efficiency-tools"),
      tagIds: arrayValue(metadata.tagIds).map((item) => safeSegment(item, "")).filter(Boolean).slice(0, 20),
      newTags: arrayValue(metadata.newTags).map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
      starter: String(metadata.starter || description || "请使用这个技能处理以下内容：").trim().slice(0, 300),
      icon: safeSegment(metadata.icon || "sparkles", "sparkles"),
      applicable: sectionBody(markdown, "适用场景"),
      inputs: sectionBody(markdown, "输入要求"),
      outputRequirements: sectionBody(markdown, "输出要求"),
      steps: sectionBody(markdown, "执行流程"),
      boundaries: sectionBody(markdown, "边界与禁止事项"),
      exceptions: sectionBody(markdown, "异常处理"),
      example: sectionBody(markdown, "使用示例"),
      fields: Array.isArray(metadata.fields) ? metadata.fields : undefined,
      supportedInputs: arrayValue(metadata.supportedInputs, ["text"]).join(", "),
      outputs: arrayValue(metadata.outputs, ["markdown"]).join(", "),
      permissions: arrayValue(metadata.permissions).join(", "),
      dependencies: arrayValue(metadata.dependencies).join(", ")
    };
  }

  function validatePackageContent(markdown, rawMetadata) {
    const frontMatter = parseFrontMatter(markdown);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(String(frontMatter.name || ""))) throw new Error("技能 name 格式不正确");
    if (!String(frontMatter.description || "").trim()) throw new Error("技能 description 不能为空");
    for (const section of REQUIRED_SECTIONS) {
      if (!new RegExp(`^#{1,6}\\s*${section}\\s*$`, "m").test(markdown)) throw new Error(`SKILL.md 缺少“${section}”章节`);
    }
    const required = ["schemaVersion", "version", "displayName", "category", "starter", "icon", "fields", "supportedInputs", "outputs", "permissions", "dependencies"];
    for (const key of required) if (rawMetadata?.[key] === undefined || rawMetadata?.[key] === null || rawMetadata?.[key] === "") throw new Error(`skill.json 缺少 ${key}`);
    return {
      name: frontMatter.name,
      description: frontMatter.description,
      version: semver(rawMetadata.version),
      displayName: String(rawMetadata.displayName),
      category: String(rawMetadata.category),
      categoryId: safeSegment(rawMetadata.categoryId || rawMetadata.category || "efficiency-tools", "efficiency-tools"),
      tagIds: arrayValue(rawMetadata.tagIds).map((item) => safeSegment(item, "")).filter(Boolean).slice(0, 20),
      newTags: arrayValue(rawMetadata.newTags).map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
      starter: String(rawMetadata.starter),
      icon: String(rawMetadata.icon || "sparkles"),
      supportedInputs: arrayValue(rawMetadata.supportedInputs),
      outputs: arrayValue(rawMetadata.outputs),
      permissions: arrayValue(rawMetadata.permissions),
      dependencies: arrayValue(rawMetadata.dependencies)
    };
  }

  function assertSafeZipEntries(entries) {
    for (const entry of entries) {
      const originalName = String(entry.unsafeOriginalName || entry.name || "").replaceAll("\\", "/");
      const normalized = path.posix.normalize(originalName);
      const permissions = typeof entry.unixPermissions === "string" ? parseInt(entry.unixPermissions, 8) : Number(entry.unixPermissions || 0);
      if (!normalized || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(originalName)) throw new Error("技能包包含不安全路径");
      if ((permissions & 0o170000) === 0o120000) throw new Error("技能包不能包含符号链接");
    }
  }

  function skillEntryList(entries) {
    return entries.filter((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name));
  }

  function displaySkillEntryCandidates(entries) {
    return entries.slice(0, 5).map((entry) => entry.name).join("、");
  }

  function choosePrimarySkillEntry(entries, preferredArchiveEntry = "") {
    const candidates = skillEntryList(entries);
    if (!candidates.length) throw new Error("技能包必须包含 SKILL.md 或 skill.md");
    const preferred = String(preferredArchiveEntry || "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
    if (preferred) {
      const exact = candidates.filter((entry) => entry.name.replaceAll("\\", "/").toLowerCase() === preferred);
      if (exact.length === 1) return exact[0];
    }
    const ranked = candidates.map((entry) => ({
      entry,
      depth: entry.name.replaceAll("\\", "/").split("/").filter(Boolean).length
    })).sort((left, right) => left.depth - right.depth || left.entry.name.localeCompare(right.entry.name));
    const shallowest = ranked.filter((candidate) => candidate.depth === ranked[0].depth);
    if (shallowest.length === 1) return shallowest[0].entry;
    throw new Error(`检测到多个并列技能入口，无法确定要提交哪一个：${displaySkillEntryCandidates(shallowest.map((item) => item.entry))}`);
  }

  async function scopeInstalledSkillBuffer(buffer, preferredArchiveEntry = "") {
    const sourceZip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: true });
    const entries = Object.values(sourceZip.files);
    assertSafeZipEntries(entries);
    const candidates = skillEntryList(entries);
    const primaryEntry = choosePrimarySkillEntry(entries, preferredArchiveEntry);
    const primaryName = primaryEntry.name.replaceAll("\\", "/");
    const primaryRoot = primaryName.slice(0, primaryName.lastIndexOf("/") + 1);
    const excludedRoots = candidates
      .filter((entry) => entry !== primaryEntry)
      .map((entry) => {
        const name = entry.name.replaceAll("\\", "/");
        return name.slice(0, name.lastIndexOf("/") + 1);
      })
      .filter((candidateRoot) => candidateRoot.startsWith(primaryRoot) && candidateRoot !== primaryRoot);
    const outputZip = new JSZip();
    let changed = candidates.length !== 1 || path.posix.basename(primaryName) !== "SKILL.md";
    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.name.replaceAll("\\", "/");
      if (!name.startsWith(primaryRoot)) {
        changed = true;
        continue;
      }
      if (excludedRoots.some((excludedRoot) => name.startsWith(excludedRoot))) {
        changed = true;
        continue;
      }
      const relativePath = name.slice(primaryRoot.length);
      if (!relativePath || /(^|\/)\.xianma-skill-origin\.json$/i.test(relativePath)) {
        changed = true;
        continue;
      }
      const targetName = entry === primaryEntry ? `${primaryRoot}SKILL.md` : name;
      outputZip.file(targetName, await entry.async("nodebuffer"));
    }
    const scopedBuffer = await outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return {
      buffer: scopedBuffer,
      changed,
      primaryEntry: `${primaryRoot}SKILL.md`,
      omittedSkillEntries: candidates.filter((entry) => entry !== primaryEntry).map((entry) => entry.name)
    };
  }

  async function inspectZipBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: true });
    const entries = Object.values(zip.files);
    assertSafeZipEntries(entries);
    const skillEntries = entries.filter((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name));
    if (!skillEntries.length) throw new Error("公司技能包必须包含一个 SKILL.md");
    if (skillEntries.length > 1) throw new Error(`公司技能包包含多个技能入口：${displaySkillEntryCandidates(skillEntries)}`);
    const root = skillEntries[0].name.slice(0, -"SKILL.md".length);
    const markdown = await skillEntries[0].async("string");
    const metadataEntry = zip.file(`${root}skill.json`);
    let metadata = {};
    let metadataError = "";
    if (!metadataEntry) {
      metadataError = "公司技能包缺少 skill.json";
    } else {
      try { metadata = JSON.parse(await metadataEntry.async("string")); } catch { metadataError = "skill.json 不是有效的 JSON 文件"; }
    }
    const fileTree = entries.filter((entry) => !entry.dir).map((entry) => entry.name.slice(root.length)).filter(Boolean);
    try {
      if (metadataError) throw new Error(metadataError);
      return { skill: validatePackageContent(markdown, metadata), fileTree };
    } catch (error) {
      return {
        importDraft: draftFromMarkdown(markdown, metadata),
        validationError: String(error?.message || error),
        fileTree
      };
    }
  }

  async function zipFolder(sourcePath) {
    const zip = new JSZip();
    const rootName = safeSegment(path.basename(sourcePath));
    const root = zip.folder(rootName);
    const walk = (directory, target) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if ([".git", "node_modules", ".DS_Store"].includes(entry.name)) continue;
        const source = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("技能文件夹不能包含符号链接");
        if (entry.isDirectory()) walk(source, target.folder(entry.name));
        else if (entry.isFile()) target.file(entry.name, fs.createReadStream(source));
      }
    };
    walk(sourcePath, root);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  async function sourcePackageBuffer(sourcePath) {
    const absolute = path.resolve(String(sourcePath || "").trim());
    if (!fs.existsSync(absolute)) throw new Error("技能文件或文件夹不存在");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("技能来源不能是符号链接");
    if (stat.isDirectory()) return zipFolder(absolute);
    if (!stat.isFile() || !/\.zip$/i.test(absolute)) throw new Error("提交审核必须使用标准 ZIP 包或包含标准文件的技能文件夹");
    return fs.promises.readFile(absolute);
  }

  async function inspectCompanySkill(payload = {}) {
    const absolute = path.resolve(String(payload.sourcePath || "").trim());
    if (/\.(?:md|markdown)$/i.test(absolute)) {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error("Markdown 技能文件不存在");
      const markdown = fs.readFileSync(absolute, "utf8");
      return {
        sourcePath: absolute,
        bytes: Buffer.byteLength(markdown, "utf8"),
        fileTree: [path.basename(absolute)],
        importDraft: draftFromMarkdown(markdown),
        validationError: "单个 Markdown 文件缺少 skill.json，请导入表单向导补全并生成标准技能包"
      };
    }
    const buffer = await sourcePackageBuffer(payload.sourcePath);
    const inspection = await inspectZipBuffer(buffer);
    return { ...inspection, sourcePath: path.resolve(payload.sourcePath), bytes: buffer.length };
  }

  function markdownWithoutFrontMatter(markdown) {
    return String(markdown || "").replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim();
  }

  function completeImportedDraft(importDraft = {}, fallback = {}) {
    const displayName = String(fallback.name || fallback.displayName || importDraft.displayName || importDraft.name || "导入技能").trim().slice(0, 80);
    const description = String(fallback.description || importDraft.description || `用于完成${displayName}相关任务。`).trim().slice(0, 500);
    const outputList = arrayValue(importDraft.outputs || fallback.outputs, ["markdown"]);
    return {
      ...importDraft,
      name: fallback.slug || importDraft.name || fallback.name || "imported-skill",
      version: importDraft.version || fallback.version || "1.0.0",
      displayName,
      description,
      category: fallback.category || importDraft.category || "其他",
      categoryId: fallback.categoryId || importDraft.categoryId || "efficiency-tools",
      tagIds: fallback.tagIds || importDraft.tagIds || [],
      customTags: fallback.customTags || importDraft.customTags || [],
      newTags: fallback.newTags || importDraft.newTags || [],
      starter: fallback.starter || importDraft.starter || `请使用“${displayName}”处理以下内容：`,
      icon: importDraft.icon || fallback.icon || "sparkles",
      applicable: importDraft.applicable || `适用于用户明确选择“${displayName}”并提供相关任务材料的场景。`,
      inputs: importDraft.inputs || "请提供需要处理的文字内容；如有相关图片、文档或其他附件，可一并提供。",
      outputRequirements: importDraft.outputRequirements || `按照技能原始说明生成完整结果；默认输出格式为 ${outputList.join("、")}。`,
      steps: importDraft.steps || "1. 阅读用户目标和输入材料。\n2. 严格按照原始技能说明执行。\n3. 检查结果完整性后输出。",
      boundaries: importDraft.boundaries || "不得编造用户未提供的事实；涉及覆盖、删除、安装、命令执行或系统修改时必须再次确认。",
      exceptions: importDraft.exceptions || "输入不足时明确指出缺失信息并请求补充；部分附件无法读取时说明具体文件，并继续处理其他可用内容。",
      example: importDraft.example || `用户：请使用“${displayName}”处理我提供的内容。\n技能：读取输入后，按照技能原始说明完成任务并返回结果。`,
      fields: Array.isArray(importDraft.fields) && importDraft.fields.length ? importDraft.fields : fallback.fields,
      supportedInputs: importDraft.supportedInputs || fallback.supportedInputs || ["text", "document", "image"],
      outputs: outputList,
      permissions: importDraft.permissions || fallback.permissions || [],
      dependencies: importDraft.dependencies || fallback.dependencies || []
    };
  }

  function standardizedImportedMarkdown(markdown, draft) {
    const body = markdownWithoutFrontMatter(markdown);
    const sections = {
      "适用场景": draft.applicable,
      "输入要求": draft.inputs,
      "输出要求": draft.outputRequirements,
      "执行流程": draft.steps,
      "边界与禁止事项": draft.boundaries,
      "异常处理": draft.exceptions,
      "使用示例": draft.example
    };
    const missingSections = Object.entries(sections)
      .filter(([title]) => !new RegExp(`^#{1,6}\\s*${title}\\s*$`, "m").test(body))
      .map(([title, content]) => `# ${title}\n${content}`)
      .join("\n\n");
    const frontMatter = `---\nname: ${draft.name}\ndescription: ${draft.description.replace(/\r?\n/g, " ")}\n---`;
    return [frontMatter, body, missingSections].filter(Boolean).join("\n\n").trim() + "\n";
  }

  async function prepareInstalledSkillSubmission(payload = {}) {
    const userId = payload.userId || "local-user";
    const sourcePath = path.resolve(String(payload.sourcePath || "").trim());
    const buffer = await sourcePackageBuffer(sourcePath);
    let preferredArchiveEntry = "";
    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
      const directManifest = fs.readdirSync(sourcePath, { withFileTypes: true })
        .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
      if (directManifest) preferredArchiveEntry = `${safeSegment(path.basename(sourcePath))}/${directManifest.name}`;
    }
    const scoped = await scopeInstalledSkillBuffer(buffer, preferredArchiveEntry);
    const inspection = await inspectZipBuffer(scoped.buffer);
    if (inspection.skill && !scoped.changed) {
      return { sourcePath, inspection: { ...inspection, sourcePath, bytes: buffer.length }, normalized: false };
    }
    if (inspection.skill) {
      const targetDirectory = path.join(getUserSkillsDir(userId), ".company-drafts", "submissions");
      fs.mkdirSync(targetDirectory, { recursive: true });
      const targetPath = path.join(targetDirectory, `${Date.now()}-${safeFileName(inspection.skill.name, "skill")}-${inspection.skill.version}.zip`);
      fs.writeFileSync(targetPath, scoped.buffer);
      const omittedMessage = scoped.omittedSkillEntries.length ? `，已排除 ${scoped.omittedSkillEntries.length} 个示例或子技能入口` : "";
      return {
        sourcePath: targetPath,
        inspection: { ...inspection, sourcePath: targetPath, bytes: scoped.buffer.length },
        normalized: true,
        normalizationMessage: `已识别主技能入口并生成标准审核包${omittedMessage}`
      };
    }
    if (!inspection.importDraft) throw new Error(inspection.validationError || "技能内容无法转换为企业审核包");

    const zip = await JSZip.loadAsync(scoped.buffer, { checkCRC32: true, createFolders: true });
    const skillEntry = Object.values(zip.files).find((entry) => !entry.dir && /(^|\/)SKILL\.md$/i.test(entry.name));
    if (!skillEntry) throw new Error("技能包必须包含 SKILL.md");
    const root = skillEntry.name.slice(0, -"SKILL.md".length);
    const markdown = await skillEntry.async("string");
    const metadataEntry = zip.file(`${root}skill.json`) || zip.file(`${root}package.json`);
    let originalMetadata = {};
    if (metadataEntry) {
      try { originalMetadata = JSON.parse(await metadataEntry.async("string")); } catch { originalMetadata = {}; }
    }
    const draft = normalizeDraft(completeImportedDraft(draftFromMarkdown(markdown, originalMetadata), payload.skill || {}));
    zip.file(skillEntry.name, standardizedImportedMarkdown(markdown, draft));
    zip.file(`${root}skill.json`, JSON.stringify({ ...originalMetadata, ...buildMetadata(draft) }, null, 2));
    for (const entry of Object.values(zip.files)) {
      if (/(^|\/)\.xianma-skill-origin\.json$/i.test(entry.name)) zip.remove(entry.name);
    }
    const normalizedBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const targetDirectory = path.join(getUserSkillsDir(userId), ".company-drafts", "submissions");
    fs.mkdirSync(targetDirectory, { recursive: true });
    const targetPath = path.join(targetDirectory, `${Date.now()}-${safeFileName(draft.name, "skill")}-${draft.version}.zip`);
    fs.writeFileSync(targetPath, normalizedBuffer);
    const normalizedInspection = await inspectZipBuffer(normalizedBuffer);
    if (!normalizedInspection.skill) throw new Error(normalizedInspection.validationError || "自动生成的企业审核包校验失败");
    return {
      sourcePath: targetPath,
      inspection: { ...normalizedInspection, sourcePath: targetPath, bytes: normalizedBuffer.length },
      normalized: true,
      normalizationMessage: scoped.omittedSkillEntries.length
        ? `已保留主技能说明、脚本和资源，排除 ${scoped.omittedSkillEntries.length} 个示例或子技能入口，并自动补齐企业审核格式`
        : "已保留原始技能说明、脚本和资源，并自动补齐企业审核格式"
    };
  }

  function serviceUrl(pathname) {
    const baseUrl = String(getServiceConfig()?.baseUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) throw new Error("公司技能服务尚未配置");
    return `${baseUrl}${pathname}`;
  }

  function authHeaders(extra = {}) {
    const token = String(getSessionToken() || "").trim();
    if (!token) throw new Error("公司技能会话尚未就绪，请重新登录后重试");
    return { authorization: `Bearer ${token}`, ...extra };
  }

  async function requestJson(pathname, options = {}) {
    const response = await fetch(serviceUrl(pathname), {
      ...options,
      headers: authHeaders({ ...(options.body && !Buffer.isBuffer(options.body) ? { "content-type": "application/json" } : {}), ...(options.headers || {}) })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `公司技能服务返回 ${response.status}`);
      error.status = response.status;
      error.code = body.code || "";
      throw error;
    }
    return body;
  }

  function sendProgress(sender, payload) {
    if (sender && !sender.isDestroyed()) sender.send("desktop:company-skill-progress", payload);
  }

  async function writeSubmissionPackage(userId, sourcePath) {
    const buffer = await sourcePackageBuffer(sourcePath);
    await inspectZipBuffer(buffer);
    const directory = path.join(getUserSkillsDir(userId), ".company-drafts", "submissions");
    fs.mkdirSync(directory, { recursive: true });
    const targetPath = path.join(directory, `${Date.now()}-${safeFileName(path.basename(sourcePath), "skill.zip")}.zip`);
    fs.writeFileSync(targetPath, buffer);
    return targetPath;
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

  async function uploadChunk(uploadId, index, buffer, sender, state) {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        const response = await fetch(serviceUrl(`/api/desktop/skill-submissions/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`), {
          method: "PUT",
          headers: authHeaders({ "content-type": "application/octet-stream", "content-length": String(buffer.length) }),
          body: buffer
        });
        if (response.ok) return;
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.error || `分片上传失败：${response.status}`);
        error.status = response.status;
        throw error;
      } catch (error) {
        if (Number(error.status) >= 400 && Number(error.status) < 500) throw error;
        const delay = Math.min(15000, 800 * (2 ** Math.min(attempt - 1, 5)));
        sendProgress(sender, { ...state, status: "retrying", message: `网络波动，正在继续上传第 ${index + 1} 个分片` });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async function submitCompanySkill(event, payload = {}) {
    const userId = payload.userId || "local-user";
    const packagePath = await writeSubmissionPackage(userId, payload.sourcePath);
    const stat = fs.statSync(packagePath);
    const fingerprint = await hashFile(packagePath);
    const state = { taskId: `company-submit-${Date.now()}`, sourcePath: payload.sourcePath };
    sendProgress(event.sender, { ...state, status: "starting", percent: 0, message: "正在准备技能审核包" });
    const session = await requestJson("/api/desktop/skill-submissions/uploads", {
      method: "POST",
      body: JSON.stringify({ fileName: path.basename(packagePath), fileSize: stat.size, fileFingerprint: fingerprint, resumeId: payload.resumeId || "" })
    });
    const completed = new Set(session.uploadedChunks || []);
    const handle = fs.openSync(packagePath, "r");
    try {
      for (let index = 0; index < session.chunkCount; index += 1) {
        if (completed.has(index)) continue;
        const length = Math.min(session.chunkSize, stat.size - index * session.chunkSize);
        const chunk = Buffer.allocUnsafe(length);
        fs.readSync(handle, chunk, 0, length, index * session.chunkSize);
        await uploadChunk(session.uploadId, index, chunk, event.sender, state);
        completed.add(index);
        sendProgress(event.sender, { ...state, status: "uploading", uploadId: session.uploadId, percent: Math.floor((completed.size / session.chunkCount) * 95), message: `正在上传技能包 ${completed.size}/${session.chunkCount}` });
      }
    } finally {
      fs.closeSync(handle);
    }
    const result = await requestJson(`/api/desktop/skill-submissions/uploads/${encodeURIComponent(session.uploadId)}/complete`, { method: "POST" });
    sendProgress(event.sender, { ...state, status: "completed", percent: 100, submission: result.submission, message: "技能已提交审核" });
    return result;
  }

  async function getMySubmissions() {
    if (remoteDisabled) return { submissions: [] };
    return requestJson("/api/desktop/skill-submissions/mine");
  }

  async function withdrawSubmission(payload = {}) {
    if (!payload.submissionId) throw new Error("缺少要撤回的技能提交");
    return requestJson(`/api/desktop/skill-submissions/${encodeURIComponent(payload.submissionId)}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ stateVersion: payload.stateVersion })
    });
  }

  async function getCatalog() {
    if (remoteDisabled) return { skills: [], revokedSkillIds: [] };
    return requestJson("/api/desktop/company-skills");
  }

  async function getSkillTaxonomy() {
    if (remoteDisabled) return null;
    return requestJson(`/api/desktop/skills/config?refresh=${Date.now()}`, {
      headers: { "cache-control": "no-cache", pragma: "no-cache" }
    });
  }

  function verifyCatalogSkill(skill) {
    if (!fs.existsSync(publicKeyPath)) throw new Error("公司技能签名公钥不可用");
    const signed = Buffer.from(String(skill.signed || ""), "base64url");
    const signature = Buffer.from(String(skill.signature || ""), "base64url");
    const publicKey = fs.readFileSync(publicKeyPath, "utf8");
    if (!signed.length || !signature.length || !crypto.verify(null, signed, publicKey, signature)) {
      throw new Error("公司技能签名校验失败：当前客户端与技能服务的签名公钥不匹配，请安装对应测试版本");
    }
    const payload = JSON.parse(signed.toString("utf8"));
    if (payload.skillId !== skill.skillId || payload.version !== skill.latestVersion || payload.sha256 !== skill.sha256 || Number(payload.size) !== Number(skill.size)) throw new Error("公司技能签名信息与目录不一致");
    return payload;
  }

  async function downloadCompanyPackage(skill) {
    verifyCatalogSkill(skill);
    const response = await fetch(serviceUrl(`/api/desktop/company-skills/${encodeURIComponent(skill.skillId)}/package?version=${encodeURIComponent(skill.latestVersion)}`), { headers: authHeaders() });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `公司技能下载失败：${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (digest !== skill.sha256 || buffer.length !== Number(skill.size)) throw new Error("公司技能下载内容校验失败");
    return buffer;
  }

  async function downloadCompanySkillPackage(event, payload = {}) {
    const catalog = await getCatalog();
    const skill = (catalog.skills || []).find((item) => item.skillId === String(payload.skillId || ""));
    if (!skill) throw new Error("公司技能已下架或不存在");
    const buffer = await downloadCompanyPackage(skill);
    const defaultName = `${safeFileName(skill.displayName || skill.name, "skill")}-${safeFileName(skill.latestVersion || "1.0.0")}.zip`;
    const saveOptions = {
      title: "下载公司技能包",
      defaultPath: defaultName,
      filters: [{ name: "技能 ZIP 包", extensions: ["zip"] }]
    };
    const parent = event?.sender ? require("electron").BrowserWindow.fromWebContents(event.sender) : null;
    const result = parent ? await dialog.showSaveDialog(parent, saveOptions) : await dialog.showSaveDialog(saveOptions);
    if (result.canceled || !result.filePath) return { canceled: true };
    const targetPath = ensureFileParentDirectory(normalizeZipSavePath(result.filePath));
    fs.writeFileSync(targetPath, buffer);
    return {
      canceled: false,
      path: targetPath,
      name: skill.name,
      displayName: skill.displayName,
      version: skill.latestVersion,
      bytes: buffer.length,
      format: "zip"
    };
  }

  async function installCompanySkill(event, payload = {}) {
    const catalog = await getCatalog();
    const skill = (catalog.skills || []).find((item) => item.skillId === payload.skillId);
    if (!skill) throw new Error("公司技能已下架或不存在");
    sendProgress(event.sender, { taskId: `company-install-${skill.skillId}`, status: "downloading", skillId: skill.skillId, skillName: skill.displayName, message: "正在下载公司技能" });
    const buffer = await downloadCompanyPackage(skill);
    const temporaryRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "xianma-company-skill-"));
    const packagePath = path.join(temporaryRoot, `${skill.skillId}-${skill.latestVersion}.zip`);
    fs.writeFileSync(packagePath, buffer);
    try {
      const result = await installCompanyPackage({ userId: payload.userId || "local-user", packagePath, skill });
      sendProgress(event.sender, { taskId: `company-install-${skill.skillId}`, status: "installed", skillId: skill.skillId, skillName: skill.displayName, version: skill.latestVersion, message: "公司技能已安装" });
      return result;
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  async function syncCompanySkills(event, payload = {}) {
    if (remoteDisabled) return { skills: [], revokedSkillIds: [], results: [] };
    const userId = payload.userId || "local-user";
    const catalog = await getCatalog();
    const installed = listInstalledSkills(userId).filter((skill) => skill.companySkillId);
    const results = [];
    for (const skill of installed) {
      if ((catalog.revokedSkillIds || []).includes(skill.companySkillId)) {
        await disableCompanySkill(userId, skill.companySkillId);
        results.push({ skillId: skill.companySkillId, status: "disabled" });
        continue;
      }
      const available = (catalog.skills || []).find((item) => item.skillId === skill.companySkillId);
      if (!available || compareSemver(available.latestVersion, skill.companyVersion) <= 0) continue;
      try {
        await installCompanySkill(event, { userId, skillId: available.skillId });
        results.push({ skillId: available.skillId, status: "updated", version: available.latestVersion });
      } catch (error) {
        results.push({ skillId: available.skillId, status: "failed", error: error.message });
      }
    }
    return { skills: catalog.skills || [], revokedSkillIds: catalog.revokedSkillIds || [], results };
  }

  async function reportUsage(payload = {}) {
    if (remoteDisabled) return { ignored: true };
    if (!payload.skillId || !payload.version || !["invoked", "succeeded", "failed", "cancelled"].includes(payload.outcome)) return { ignored: true };
    const taskId = String(payload.taskId || "").trim();
    const enterpriseSkillId = String(payload.enterpriseSkillId || payload.skillId || "").trim();
    const idempotencyKey = String(payload.idempotencyKey || (taskId ? `company-skill:${taskId}:${enterpriseSkillId}:${payload.outcome}` : "")).trim();
    return requestJson("/api/desktop/company-skills/usage", { method: "POST", body: JSON.stringify({ taskId, enterpriseSkillId, skillId: enterpriseSkillId, version: payload.version, outcome: payload.outcome, idempotencyKey }) });
  }

  async function flushV11Facts() {
    if (!pendingV11Facts.length) pendingV11Facts = readJsonPendingV11Facts();
    if (remoteDisabled || !pendingV11Facts.length) return { ignored: true };
    if (!String(getSessionToken() || "").trim()) return { queued: true, pending: pendingV11Facts.length };
    if (v11FactsFlushPromise) return v11FactsFlushPromise;
    v11FactsFlushPromise = (async () => {
      let accepted = 0;
      let overflowQualityEventsAccepted = 0;
      while (pendingV11Facts.length) {
        const facts = pendingV11Facts.slice(0, 500);
        try {
          const result = await requestJson("/api/desktop/v11/facts", { method: "POST", body: JSON.stringify({ facts }) });
          accepted += Number(result.accepted || facts.length);
          overflowQualityEventsAccepted += facts.filter((fact) => fact?.eventType === "OFFLINE_QUEUE_OVERFLOW").length;
          pendingV11Facts.splice(0, facts.length);
          writeJsonPendingV11Facts();
        } catch (error) {
          writeJsonPendingV11Facts();
          throw error;
        }
      }
      return { accepted, overflowQualityEventsAccepted };
    })().finally(() => { v11FactsFlushPromise = null; });
    return v11FactsFlushPromise;
  }

  async function reportV11Facts(payload = {}) {
    if (remoteDisabled) return { ignored: true };
    const facts = Array.isArray(payload.facts) ? payload.facts.slice(0, 500) : [];
    if (!facts.length) return { ignored: true };
    enqueueV11Facts(facts);
    return flushV11Facts();
  }

  return {
    createSkillPackage,
    downloadTemplate,
    inspectCompanySkill,
    prepareInstalledSkillSubmission,
    submitCompanySkill,
    getMySubmissions,
    withdrawSubmission,
    getCatalog,
    getSkillTaxonomy,
    installCompanySkill,
    downloadCompanySkillPackage,
    syncCompanySkills,
    reportUsage,
    reportV11Facts,
    flushV11Facts
  };
}

module.exports = { createCompanySkillsClient };
