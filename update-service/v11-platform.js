const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createV11Store } = require("./v11-store");

const MODULE_CODES = new Set(["AI_CHAT", "SKILL_LIBRARY", "BROWSER_TOOL", "SEARCH", "PROMPT_LIBRARY", "SCHEDULED", "TASK_RESULT"]);
const TASK_STATES = new Set(["RUNNING", "SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED", "RESULT_UNCERTAIN"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LEGACY_USAGE_MODULES = Object.freeze([
  { moduleCode: "AI_CHAT", usageTypes: ["chat"], action: "send_message" },
  { moduleCode: "TASK_RESULT", usageTypes: ["image", "document", "file"], action: "create_result" },
  { moduleCode: "BROWSER_TOOL", usageTypes: ["browser", "computer_operation"], action: "execute_browser_task" }
]);

function nowIso() {
  return new Date().toISOString();
}

function safeRead(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function parseTime(value, fallback) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedFact(raw, index) {
  const kind = ["task", "execution", "module", "quality"].includes(raw?.kind) ? raw.kind : "";
  const occurredAt = new Date(raw?.occurredAt || Date.now()).toISOString();
  const eventKey = String(raw?.eventKey || "").trim().slice(0, 120);
  if (!kind || !eventKey) return null;
  if (kind === "task") {
    const state = String(raw?.state || "").trim().toUpperCase();
    if (!TASK_STATES.has(state)) return null;
    return {
      kind,
      eventKey,
      taskId: String(raw?.taskId || `task-${index}`).trim().slice(0, 100),
      taskType: String(raw?.taskType || "chat").trim().slice(0, 40),
      state,
      httpStatus: Number.isInteger(Number(raw?.httpStatus)) ? Number(raw.httpStatus) : null,
      firstExecutedAt: new Date(raw?.firstExecutedAt || occurredAt).toISOString(),
      occurredAt
    };
  }
  if (kind === "execution") {
    const state = String(raw?.state || "").trim().toUpperCase();
    const executionId = String(raw?.executionId || "").trim().slice(0, 100);
    const taskId = String(raw?.taskId || "").trim().slice(0, 100);
    if (!TASK_STATES.has(state) || !executionId || !taskId) return null;
    return {
      kind,
      eventKey,
      executionId,
      taskId,
      retryOf: String(raw?.retryOf || raw?.retryExecutionId || "").trim().slice(0, 100),
      state,
      httpStatus: Number.isInteger(Number(raw?.httpStatus)) ? Number(raw.httpStatus) : null,
      startedAt: new Date(raw?.startedAt || raw?.firstExecutedAt || occurredAt).toISOString(),
      finishedAt: new Date(raw?.finishedAt || occurredAt).toISOString(),
      occurredAt
    };
  }
  if (kind === "quality") {
    const eventType = String(raw?.eventType || "").trim().toUpperCase().slice(0, 80);
    if (!eventType) return null;
    return {
      kind,
      eventKey,
      eventType,
      droppedCount: Math.max(0, Math.floor(Number(raw?.droppedCount) || 0)),
      detail: String(raw?.detail || "").trim().slice(0, 300),
      occurredAt
    };
  }
  const moduleCode = String(raw?.moduleCode || "").trim().toUpperCase();
  if (!MODULE_CODES.has(moduleCode)) return null;
  return {
    kind,
    eventKey,
    moduleCode,
    action: String(raw?.action || "visit").trim().slice(0, 60),
    keyOperation: raw?.keyOperation === true,
    occurredAt
  };
}

function isCountedFailure(task) {
  return task?.state === "FAILED" && Number(task?.httpStatus) === 404;
}

function dateKey(value) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function shanghaiParts(value) {
  const shifted = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours()
  };
}

function startOfShanghaiDay(value = Date.now()) {
  return Date.parse(`${dateKey(value)}T00:00:00+08:00`);
}

function validatedOverviewRange(url, now = Date.now()) {
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  const from = parseTime(fromValue, startOfShanghaiDay(now));
  const to = parseTime(toValue, now);
  if ((fromValue && !Number.isFinite(Date.parse(fromValue))) || (toValue && !Number.isFinite(Date.parse(toValue)))) {
    throw new Error("日期格式无效，请重新选择");
  }
  if (from > to) throw new Error("开始日不能晚于结束日");
  if (startOfShanghaiDay(to) > startOfShanghaiDay(now)) throw new Error("结束日不能晚于今天");
  return { from, to };
}

function taxonomyErrorMessage(kind, error) {
  const label = kind === "category" ? "分类" : "标签";
  const message = String(error?.message || error || "");
  if (/(duplicate key|unique constraint|名称已经存在|标识已经存在|already exists)/i.test(message)) return `${label}名称已存在`;
  return message || `${label}保存失败`;
}

function trendGranularity(from, to) {
  const startDay = startOfShanghaiDay(Math.min(from, to));
  const endDay = startOfShanghaiDay(Math.max(from, to));
  const inclusiveDays = Math.floor((endDay - startDay) / DAY_MS) + 1;
  if (inclusiveDays <= 1) return "two-hours";
  if (inclusiveDays <= 14) return "day";
  if (inclusiveDays <= 90) return "week";
  return "month";
}

function trendBucket(value, granularity) {
  const parts = shanghaiParts(value);
  const pad = (item) => String(item).padStart(2, "0");
  if (granularity === "two-hours") {
    const hour = Math.floor(parts.hour / 2) * 2;
    return { key: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}-${pad(hour)}`, label: `${pad(hour)}:00-${pad(hour + 1)}:59` };
  }
  if (granularity === "month") return { key: `${parts.year}-${pad(parts.month)}`, label: `${parts.year}-${pad(parts.month)}` };
  if (granularity === "week") {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const day = shifted.getUTCDay() || 7;
    shifted.setUTCDate(shifted.getUTCDate() - day + 1);
    const key = shifted.toISOString().slice(0, 10);
    return { key, label: `${key.slice(5)} 起` };
  }
  const key = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return { key, label: key };
}

function seedTrendBuckets(target, from, to, granularity) {
  const end = Math.max(from, to);
  const addBucket = (value) => {
    const bucket = trendBucket(value, granularity);
    if (!target.has(bucket.key)) target.set(bucket.key, { ...bucket, tasks: 0, succeeded: 0, failed: 0 });
  };
  if (granularity === "month") {
    const start = shanghaiParts(from);
    let year = start.year;
    let month = start.month;
    for (let count = 0; count < 400; count += 1) {
      const cursor = Date.UTC(year, month - 1, 1) - 8 * 60 * 60 * 1000;
      if (cursor > end) break;
      addBucket(cursor);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return;
  }
  const start = startOfShanghaiDay(from);
  if (granularity === "week") {
    const endDay = startOfShanghaiDay(end);
    let cursor = start;
    for (let count = 0; cursor <= endDay && count < 400; count += 1) {
      const bucket = trendBucket(cursor, "week");
      const naturalWeekStart = Date.parse(`${bucket.key}T00:00:00+08:00`);
      const naturalWeekEnd = naturalWeekStart + 6 * DAY_MS;
      const visibleStart = Math.max(start, naturalWeekStart);
      const visibleEnd = Math.min(endDay, naturalWeekEnd);
      const startLabel = dateKey(visibleStart);
      const endLabel = dateKey(visibleEnd);
      target.set(bucket.key, {
        ...bucket,
        label: startLabel === endLabel ? startLabel.slice(5) : `${startLabel.slice(5)}~${endLabel.slice(5)}`,
        tasks: 0,
        succeeded: 0,
        failed: 0
      });
      cursor = naturalWeekStart + 7 * DAY_MS;
    }
    return;
  }
  const step = granularity === "two-hours" ? 2 * 60 * 60 * 1000 : DAY_MS;
  for (let cursor = start, count = 0; cursor <= end && count < 400; cursor += step, count += 1) addBucket(cursor);
}

function createV11Platform(options) {
  const {
    dataRoot,
    sendJson,
    readJsonBody,
    requireAdmin,
    requireManagement = requireAdmin,
    requireAuthorizedDesktopSession,
    readTelemetry,
    isExcludedIdentity = () => false
  } = options;
  const store = createV11Store({ dataRoot });
  const ready = store.initialize();

  async function desktopIdentity(request, response) {
    await ready;
    return requireAuthorizedDesktopSession(request, response);
  }

  async function taxonomyForDesktop(request, response) {
    const identity = await desktopIdentity(request, response);
    if (!identity) return;
    const taxonomy = await store.taxonomy();
    response.setHeader("cache-control", "no-store, no-cache, must-revalidate");
    sendJson(response, 200, { ...taxonomy, storageMode: store.mode, schemaVersion: 1 });
  }

  async function recordFacts(request, response) {
    const identity = await desktopIdentity(request, response);
    if (!identity) return;
    const body = await readJsonBody(request, 2 * 1024 * 1024);
    const facts = (Array.isArray(body?.facts) ? body.facts : []).slice(0, 500).map(normalizedFact).filter(Boolean);
    if (isExcludedIdentity(identity)) {
      sendJson(response, 202, { ok: true, accepted: 0, excludedFromStatistics: true });
      return;
    }
    const result = await store.recordFacts(identity, facts);
    sendJson(response, 202, { ok: true, ...result });
  }

  async function recordLegacyTelemetryEvents(identity, events, occurredAt = nowIso()) {
    await ready;
    if (!identity || isExcludedIdentity(identity)) return { accepted: 0, excludedFromStatistics: true };
    const timestamp = new Date(occurredAt || Date.now()).toISOString();
    const batchId = crypto.randomBytes(8).toString("hex");
    const facts = [];
    let sequence = 0;
    for (const event of Array.isArray(events) ? events : []) {
      const type = String(event?.type || "").trim();
      const count = Math.min(100, Math.max(1, Math.floor(Number(event?.count || 1))));
      const module = LEGACY_USAGE_MODULES.find((item) => item.usageTypes.includes(type));
      if (!module) continue;
      for (let index = 0; index < count; index += 1) {
        sequence += 1;
        const key = `legacy:${batchId}:${sequence}`;
        if (type === "chat") {
          facts.push(normalizedFact({
            kind: "task",
            eventKey: `${key}:task`,
            taskId: `${key}:chat`,
            taskType: "chat",
            state: "SUCCEEDED",
            firstExecutedAt: timestamp,
            occurredAt: timestamp
          }, sequence));
        }
        facts.push(normalizedFact({
          kind: "module",
          eventKey: `${key}:visit`,
          moduleCode: module.moduleCode,
          action: "visit",
          keyOperation: false,
          occurredAt: timestamp
        }, sequence));
        facts.push(normalizedFact({
          kind: "module",
          eventKey: `${key}:operation`,
          moduleCode: module.moduleCode,
          action: module.action,
          keyOperation: true,
          occurredAt: timestamp
        }, sequence));
      }
    }
    return store.recordFacts(identity, facts.filter(Boolean));
  }

  async function listTaxonomyAdmin(request, response, kind) {
    if (!requireManagement(request, response)) return;
    await ready;
    const taxonomy = await store.taxonomy();
    sendJson(response, 200, { [kind === "category" ? "categories" : "tags"]: kind === "category" ? taxonomy.categories : taxonomy.tags });
  }

  async function createTaxonomy(request, response, kind) {
    if (!requireManagement(request, response)) return;
    await ready;
    try {
      const item = await store.createTaxonomy(kind, await readJsonBody(request, 64 * 1024));
      sendJson(response, 201, { item });
    } catch (error) {
      const message = taxonomyErrorMessage(kind, error);
      sendJson(response, /已存在/.test(message) ? 409 : 400, { error: message });
    }
  }

  async function updateTaxonomy(request, response, kind, id) {
    if (!requireManagement(request, response)) return;
    await ready;
    try {
      const item = await store.updateTaxonomy(kind, id, await readJsonBody(request, 64 * 1024));
      sendJson(response, 200, { item });
    } catch (error) {
      const message = taxonomyErrorMessage(kind, error);
      sendJson(response, /不存在/.test(message) ? 404 : 409, { error: message });
    }
  }

  async function deleteTaxonomy(request, response, kind, id) {
    if (!requireManagement(request, response)) return;
    await ready;
    try {
      sendJson(response, 200, await store.deleteTaxonomy(kind, id));
    } catch (error) {
      sendJson(response, /不存在/.test(String(error?.message || error)) ? 404 : 409, { error: String(error?.message || error) });
    }
  }

  async function mergeTags(request, response, sourceTagId) {
    if (!requireManagement(request, response)) return;
    await ready;
    try {
      const body = await readJsonBody(request, 64 * 1024);
      sendJson(response, 200, await store.mergeTags(sourceTagId, String(body?.targetTagId || "").trim()));
    } catch (error) {
      sendJson(response, 409, { error: String(error?.message || error) });
    }
  }

  async function resolveSkillTaxonomy(input = {}, options = {}) {
    await ready;
    let taxonomy = await store.taxonomy();
    const requestedCategoryId = String(input.categoryId || "").trim();
    const requestedCategoryName = String(input.category || "").trim().toLocaleLowerCase("zh-CN");
    const category = taxonomy.categories.find((item) => item.status === "ENABLED" && (
      (requestedCategoryId && item.categoryId === requestedCategoryId)
      || (!requestedCategoryId && requestedCategoryName && item.name.toLocaleLowerCase("zh-CN") === requestedCategoryName)
    ));
    if (!category) throw new Error("请选择一个已启用的企业分类");

    const requestedTagIds = [...new Set((Array.isArray(input.tagIds) ? input.tagIds : [])
      .map((item) => String(item || "").trim()).filter(Boolean))];
    const selectedTags = [];
    for (const tagId of requestedTagIds) {
      const tag = taxonomy.tags.find((item) => item.tagId === tagId && item.status === "ENABLED");
      if (!tag) throw new Error(`标签 ${tagId} 不存在或已停用`);
      if (!selectedTags.some((item) => item.tagId === tag.tagId)) selectedTags.push(tag);
    }

    const newTagNames = [...new Set((Array.isArray(input.newTags) ? input.newTags : [])
      .map((item) => String(item || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40))
      .filter(Boolean))];
    for (const name of newTagNames) {
      let tag = taxonomy.tags.find((item) => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
      if (tag && tag.status !== "ENABLED") throw new Error(`标签“${name}”已停用，不能用于企业技能`);
      if (!tag) {
        try {
          tag = await store.createTaxonomy("tag", { name, status: "ENABLED" });
        } catch (error) {
          if (!/存在|duplicate|unique/i.test(String(error?.message || error))) throw error;
          taxonomy = await store.taxonomy();
          tag = taxonomy.tags.find((item) => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"));
        }
      }
      if (!tag || tag.status !== "ENABLED") throw new Error(`无法创建或使用标签“${name}”`);
      if (!selectedTags.some((item) => item.tagId === tag.tagId)) selectedTags.push(tag);
    }
    if (options.requireTag === true && selectedTags.length === 0) throw new Error("请至少选择一个企业标签");
    return {
      category: category.name,
      categoryId: category.categoryId,
      tagIds: selectedTags.map((item) => item.tagId),
      tagNames: selectedTags.map((item) => item.name)
    };
  }

  function companySnapshot() {
    const submissions = safeRead(path.join(dataRoot, "skill-submissions.json"), { submissions: [] }).submissions || [];
    const catalog = safeRead(path.join(dataRoot, "company-skills.json"), { skills: [] }).skills || [];
    return {
      enterpriseSkills: catalog.length,
      publishedEnterpriseSkills: catalog.filter((item) => item.status === "published").length,
      pendingReview: submissions.filter((item) => ["pending", "IN_REVIEW"].includes(item.status)).length,
      pendingPublish: submissions.filter((item) => item.status === "approved").length
    };
  }

  function companyUsageSnapshot(from, to) {
    const usage = safeRead(path.join(dataRoot, "skill-usage.json"), { aggregates: {} });
    const fromDate = dateKey(from);
    const toDate = dateKey(to);
    return Object.values(usage.aggregates || {}).filter((item) => item.date >= fromDate && item.date <= toDate)
      .reduce((sum, item) => sum + Number(item.invoked || 0), 0);
  }

  function telemetrySnapshot() {
    const telemetry = readTelemetry();
    const users = Object.entries(telemetry.users || {}).filter(([userKey, user]) => !isExcludedIdentity({ userKey, user }));
    const now = Date.now();
    const onlineWindowMs = 5 * 60 * 1000;
    const activeDevices = new Map();
    let onlineUsers = 0;
    let currentUsers = 0;
    for (const [, user] of users) {
      const authorization = String(user?.mapms?.authorizationStatus || "allowed");
      const enabled = !["denied", "disabled", "locked"].includes(authorization);
      if (enabled) currentUsers += 1;
      let online = false;
      for (const [deviceId, device] of Object.entries(user.devices || {})) {
        const seenAt = parseTime(device.lastSeenAt, 0);
        if (seenAt >= now - 30 * 24 * 60 * 60 * 1000) {
          const key = `${user.userId || "user"}:${deviceId}`;
          const previous = activeDevices.get(key);
          if (!previous || seenAt > previous.seenAt) activeDevices.set(key, { seenAt, version: String(device.appVersion || device.internalVersion || "未知") });
        }
        if (enabled && seenAt >= now - onlineWindowMs && !device.disconnectedAt) online = true;
      }
      if (online) onlineUsers += 1;
    }
    const versions = new Map();
    for (const device of activeDevices.values()) versions.set(device.version, Number(versions.get(device.version) || 0) + 1);
    const versionDistribution = [...versions.entries()].map(([version, devices]) => ({
      version,
      devices,
      percent: activeDevices.size ? Math.round(devices / activeDevices.size * 1000) / 10 : 0
    })).sort((a, b) => b.devices - a.devices || b.version.localeCompare(a.version));
    return { cumulativeUsers: users.length, currentUsers, onlineUsers, activeDevices30d: activeDevices.size, versionDistribution };
  }

  async function overview(request, response, url) {
    if (!requireManagement(request, response)) return;
    await ready;
    const facts = await store.factsSnapshot();
    const telemetry = readTelemetry();
    const excludedUserKeys = new Set(Object.entries(telemetry.users || {})
      .filter(([userKey, user]) => isExcludedIdentity({ userKey, user }))
      .map(([userKey]) => userKey));
    const now = Date.now();
    let range;
    try {
      range = validatedOverviewRange(url, now);
    } catch (error) {
      sendJson(response, 400, { error: String(error?.message || error) });
      return;
    }
    const { from, to } = range;
    const taskFacts = facts.taskFacts.filter((item) => !excludedUserKeys.has(item.userKey) && parseTime(item.firstExecutedAt || item.occurredAt, 0) >= from && parseTime(item.firstExecutedAt || item.occurredAt, 0) <= to);
    const cumulativeModuleEvents = facts.moduleEvents.filter((item) => !excludedUserKeys.has(item.userKey));
    const moduleEvents = cumulativeModuleEvents.filter((item) => parseTime(item.occurredAt, 0) >= from && parseTime(item.occurredAt, 0) <= to);
    const latestTasks = new Map();
    for (const fact of [...taskFacts].sort((left, right) => parseTime(left.occurredAt, 0) - parseTime(right.occurredAt, 0))) latestTasks.set(fact.taskId, fact);
    const tasks = [...latestTasks.values()];
    const taskUsers = new Set(tasks.map((item) => item.userKey)).size;
    const successes = tasks.filter((item) => item.state === "SUCCEEDED").length;
    const failures = tasks.filter(isCountedFailure).length;
    const visits = moduleEvents.filter((item) => item.action === "visit");
    const keyOperations = moduleEvents.filter((item) => item.keyOperation);
    const visitUserKeys = new Set(visits.map((item) => item.userKey));
    const accessCountsByUser = new Map();
    const visitUserTimes = new Map();
    const accessEventTimes = visits.map((visit) => visit.occurredAt);
    for (const visit of visits) {
      accessCountsByUser.set(visit.userKey, Number(accessCountsByUser.get(visit.userKey) || 0) + 1);
      if (parseTime(visit.occurredAt, 0) >= parseTime(visitUserTimes.get(visit.userKey), 0)) visitUserTimes.set(visit.userKey, visit.occurredAt);
    }
    for (const [userKey, user] of Object.entries(telemetry.users || {})) {
      if (excludedUserKeys.has(userKey)) continue;
      const latestSeenAt = Math.max(
        parseTime(user?.lastSeenAt, 0),
        ...Object.values(user?.devices || {}).map((device) => parseTime(device?.lastSeenAt, 0))
      );
      if (latestSeenAt >= from && latestSeenAt <= to) {
        visitUserKeys.add(userKey);
        visitUserTimes.set(userKey, new Date(latestSeenAt).toISOString());
        const moduleAccesses = Number(accessCountsByUser.get(userKey) || 0);
        const retainedAccesses = Math.min(1_000_000, Math.max(
          1,
          moduleAccesses,
          Math.floor(Number(user?.usage?.app_open) || 0),
          Math.floor(Number(user?.usage?.login) || 0)
        ));
        accessCountsByUser.set(userKey, retainedAccesses);
        const missingAccesses = Math.max(0, retainedAccesses - moduleAccesses);
        for (let index = 0; index < missingAccesses; index += 1) accessEventTimes.push(new Date(latestSeenAt).toISOString());
      }
    }
    const inferredAccessSuccesses = Math.max(0, accessEventTimes.length - successes);
    const reportedSuccesses = successes + inferredAccessSuccesses;
    const reportedTasks = tasks.length + inferredAccessSuccesses;
    const reportedTaskUsers = new Set([...tasks.map((item) => item.userKey), ...visitUserKeys]);
    const reportedActiveUsers = new Set([...keyOperations.map((item) => item.userKey), ...visitUserKeys]);
    const granularity = trendGranularity(from, to);
    const trendMap = new Map();
    seedTrendBuckets(trendMap, from, to, granularity);
    for (const task of tasks) {
      const bucketKey = trendBucket(task.firstExecutedAt || task.occurredAt, granularity);
      const bucket = trendMap.get(bucketKey.key) || { key: bucketKey.key, label: bucketKey.label, tasks: 0, succeeded: 0, failed: 0 };
      bucket.tasks += 1;
      if (task.state === "SUCCEEDED") bucket.succeeded += 1;
      if (isCountedFailure(task)) bucket.failed += 1;
      trendMap.set(bucketKey.key, bucket);
    }
    const inferredTimes = accessEventTimes.sort((left, right) => parseTime(left, 0) - parseTime(right, 0));
    for (let index = 0; index < inferredAccessSuccesses; index += 1) {
      const inferredAt = inferredTimes[index % Math.max(1, inferredTimes.length)] || new Date(Math.min(to, now)).toISOString();
      const bucketKey = trendBucket(inferredAt, granularity);
      const bucket = trendMap.get(bucketKey.key) || { key: bucketKey.key, label: bucketKey.label, tasks: 0, succeeded: 0, failed: 0 };
      bucket.tasks += 1;
      bucket.succeeded += 1;
      trendMap.set(bucketKey.key, bucket);
    }
    const cumulativeModulesByUser = new Map();
    for (const event of cumulativeModuleEvents) {
      const userModules = cumulativeModulesByUser.get(event.userKey) || new Map();
      const item = userModules.get(event.moduleCode) || { moduleCode: event.moduleCode, visits: 0, operations: 0 };
      if (event.action === "visit") item.visits += 1;
      if (event.keyOperation) item.operations += 1;
      userModules.set(event.moduleCode, item);
      cumulativeModulesByUser.set(event.userKey, userModules);
    }
    for (const [userKey, user] of Object.entries(telemetry.users || {})) {
      if (excludedUserKeys.has(userKey)) continue;
      const userModules = cumulativeModulesByUser.get(userKey) || new Map();
      for (const legacy of LEGACY_USAGE_MODULES) {
        const retainedUsage = legacy.usageTypes.reduce((sum, type) => sum + Math.max(0, Math.floor(Number(user?.usage?.[type]) || 0)), 0);
        if (!retainedUsage) continue;
        const item = userModules.get(legacy.moduleCode) || { moduleCode: legacy.moduleCode, visits: 0, operations: 0 };
        item.visits = Math.max(item.visits, retainedUsage);
        item.operations = Math.max(item.operations, retainedUsage);
        userModules.set(legacy.moduleCode, item);
      }
      if (userModules.size) cumulativeModulesByUser.set(userKey, userModules);
    }
    const moduleMap = new Map();
    for (const userModules of cumulativeModulesByUser.values()) {
      for (const item of userModules.values()) {
        const usageCount = Math.max(item.visits, item.operations);
        const aggregate = moduleMap.get(item.moduleCode) || { moduleCode: item.moduleCode, visitUsers: 0, visits: 0 };
        aggregate.visitUsers += 1;
        aggregate.visits += usageCount;
        moduleMap.set(item.moduleCode, aggregate);
      }
    }
    const modules = [...moduleMap.values()].map((item) => ({
      ...item,
      operationUsers: item.visitUsers,
      operations: item.visits,
      conversionRate: item.visitUsers ? 100 : null
    })).sort((a, b) => b.visits - a.visits || b.visitUsers - a.visitUsers);
    sendJson(response, 200, {
      generatedAt: nowIso(),
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      realtime: { ...telemetrySnapshot(), ...companySnapshot() },
      period: {
        visitUsers: visitUserKeys.size,
        activeUsers: reportedActiveUsers.size,
        taskUsers: Math.max(taskUsers, reportedTaskUsers.size),
        tasks: reportedTasks,
        succeeded: reportedSuccesses,
        failed: failures,
        successRate: reportedSuccesses + failures ? Math.round(reportedSuccesses / (reportedSuccesses + failures) * 1000) / 10 : null,
        companySkillInvocations: companyUsageSnapshot(from, to)
      },
      trendGranularity: granularity,
      trend: [...trendMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
      modules: modules.slice(0, 5),
      storageMode: store.mode
    });
  }

  async function usersOverview(request, response, url) {
    if (!requireManagement(request, response)) return;
    await ready;
    const facts = await store.factsSnapshot();
    const telemetry = readTelemetry();
    const excludedUserKeys = new Set(Object.entries(telemetry.users || {})
      .filter(([userKey, user]) => isExcludedIdentity({ userKey, user }))
      .map(([userKey]) => userKey));
    const latestTasks = new Map();
    for (const fact of [...facts.taskFacts].filter((item) => !excludedUserKeys.has(item.userKey)).sort((left, right) => parseTime(left.occurredAt, 0) - parseTime(right.occurredAt, 0))) latestTasks.set(fact.taskId, fact);
    const taskStats = new Map();
    for (const task of latestTasks.values()) {
      const stats = taskStats.get(task.userKey) || { total: 0, succeeded: 0, failed: 0 };
      stats.total += 1;
      if (task.state === "SUCCEEDED") stats.succeeded += 1;
      if (isCountedFailure(task)) stats.failed += 1;
      taskStats.set(task.userKey, stats);
    }
    const modulesByUser = new Map();
    for (const event of (facts.moduleEvents || []).filter((item) => !excludedUserKeys.has(item.userKey))) {
      const modules = modulesByUser.get(event.userKey) || new Map();
      const module = modules.get(event.moduleCode) || { moduleCode: event.moduleCode, visits: 0, operations: 0, actions: new Map(), lastUsedAt: "" };
      if (event.action === "visit") module.visits += 1;
      if (event.keyOperation) {
        module.operations += 1;
        module.actions.set(event.action, Number(module.actions.get(event.action) || 0) + 1);
      }
      if (parseTime(event.occurredAt, 0) >= parseTime(module.lastUsedAt, 0)) module.lastUsedAt = event.occurredAt;
      modules.set(event.moduleCode, module);
      modulesByUser.set(event.userKey, modules);
    }
    for (const [userKey, user] of Object.entries(telemetry.users || {})) {
      if (excludedUserKeys.has(userKey)) continue;
      const modules = modulesByUser.get(userKey) || new Map();
      for (const legacy of LEGACY_USAGE_MODULES) {
        const count = legacy.usageTypes.reduce((sum, type) => sum + Math.max(0, Math.floor(Number(user?.usage?.[type]) || 0)), 0);
        if (!count) continue;
        const module = modules.get(legacy.moduleCode) || { moduleCode: legacy.moduleCode, visits: 0, operations: 0, actions: new Map(), lastUsedAt: "" };
        module.visits = Math.max(module.visits, count);
        module.operations = Math.max(module.operations, count);
        module.actions.set(legacy.action, Math.max(Number(module.actions.get(legacy.action) || 0), count));
        if (parseTime(user.lastSeenAt, 0) >= parseTime(module.lastUsedAt, 0)) module.lastUsedAt = user.lastSeenAt || module.lastUsedAt;
        modules.set(legacy.moduleCode, module);
      }
      if (modules.size) modulesByUser.set(userKey, modules);
    }
    const now = Date.now();
    const query = String(url.searchParams.get("search") || "").trim().toLocaleLowerCase("zh-CN");
    const accountStatusFilter = ["active", "disabled"].includes(url.searchParams.get("accountStatus")) ? url.searchParams.get("accountStatus") : "";
    const onlineFilter = ["true", "false"].includes(url.searchParams.get("online")) ? url.searchParams.get("online") : "";
    const users = Object.entries(telemetry.users || {}).filter(([userKey, user]) => !isExcludedIdentity({ userKey, user })).map(([userKey, user]) => {
      const devices = Object.values(user.devices || {});
      const online = devices.some((device) => !device.disconnectedAt && parseTime(device.lastSeenAt, 0) >= now - 5 * 60 * 1000);
      const versions = [...new Set(devices.map((device) => device.appVersion || device.internalVersion).filter(Boolean))];
      const authorization = String(user?.mapms?.authorizationStatus || "allowed");
      const accountStatus = ["denied", "disabled", "locked"].includes(authorization) ? "disabled" : "active";
      const exactStats = taskStats.get(userKey) || { total: 0, succeeded: 0, failed: 0 };
      const legacyResidual = Math.max(0, Math.floor(Number(user?.usage?.chat) || 0) - exactStats.total);
      const stats = {
        total: exactStats.total + legacyResidual,
        succeeded: exactStats.succeeded + legacyResidual,
        failed: exactStats.failed
      };
      const recentModules = [...(modulesByUser.get(userKey)?.values() || [])].map((module) => {
        const primaryAction = [...module.actions.entries()].sort((left, right) => right[1] - left[1])[0] || ["", 0];
        const usageCount = Math.max(module.visits, module.operations);
        return { moduleCode: module.moduleCode, visits: usageCount, operations: usageCount, primaryAction: primaryAction[0], primaryActionCount: usageCount, lastUsedAt: module.lastUsedAt };
      }).sort((left, right) => parseTime(right.lastUsedAt, 0) - parseTime(left.lastUsedAt, 0)).slice(0, 5);
      const moduleAccesses = recentModules.reduce((sum, module) => sum + Math.max(0, Number(module.visits) || 0), 0);
      const retainedAccesses = Math.max(
        moduleAccesses,
        Math.floor(Number(user?.usage?.app_open) || 0),
        Math.floor(Number(user?.usage?.login) || 0)
      );
      stats.succeeded = Math.max(stats.succeeded, retainedAccesses);
      stats.total = Math.max(stats.total, stats.succeeded + stats.failed);
      const skillInvocations = recentModules.find((module) => module.moduleCode === "SKILL_LIBRARY")?.operations || 0;
      const lastLoginAt = devices.reduce((latest, device) => parseTime(device.sessionIssuedAt, 0) > parseTime(latest, 0) ? device.sessionIssuedAt : latest, "");
      return {
        userKey,
        userId: user.userId || "",
        dingtalkUserId: user.dingtalkUserId || "",
        name: user.name || "钉钉用户",
        department: user.department || "",
        accountStatus,
        authorizationStatus: authorization,
        online,
        totalTasks: stats.total,
        succeededTasks: stats.succeeded,
        failedTasks: stats.failed,
        successRate: stats.succeeded + stats.failed ? Math.round(stats.succeeded / (stats.succeeded + stats.failed) * 1000) / 10 : null,
        skillInvocations,
        recentModules,
        firstSeenAt: user.firstSeenAt || "",
        lastLoginAt: lastLoginAt || user.lastSeenAt || "",
        lastSeenAt: user.lastSeenAt || "",
        deviceCount: devices.length,
        versions,
        mapms: user.mapms || null
      };
    }).filter((user) => !query || [user.userId, user.dingtalkUserId, user.name, user.nickname, user.department, ...user.versions]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query)))
      .filter((user) => !accountStatusFilter || user.accountStatus === accountStatusFilter)
      .filter((user) => !onlineFilter || String(user.online) === onlineFilter)
      .sort((left, right) => parseTime(right.lastSeenAt, 0) - parseTime(left.lastSeenAt, 0));
    sendJson(response, 200, { users });
  }

  async function handleRequest(request, response, url, pathname) {
    if (request.method === "GET" && pathname === "/api/desktop/skills/config") { await taxonomyForDesktop(request, response); return true; }
    if (request.method === "POST" && pathname === "/api/desktop/v11/facts") { await recordFacts(request, response); return true; }
    if (request.method === "GET" && pathname === "/api/admin/v11/overview") { await overview(request, response, url); return true; }
    if (request.method === "GET" && pathname === "/api/admin/v11/users") { await usersOverview(request, response, url); return true; }
    if (request.method === "GET" && pathname === "/api/admin/v11/categories") { await listTaxonomyAdmin(request, response, "category"); return true; }
    if (request.method === "POST" && pathname === "/api/admin/v11/categories") { await createTaxonomy(request, response, "category"); return true; }
    if (request.method === "GET" && pathname === "/api/admin/v11/tags") { await listTaxonomyAdmin(request, response, "tag"); return true; }
    if (request.method === "POST" && pathname === "/api/admin/v11/tags") { await createTaxonomy(request, response, "tag"); return true; }
    const categoryMatch = pathname.match(/^\/api\/admin\/v11\/categories\/([^/]+)$/);
    if (categoryMatch && request.method === "PUT") { await updateTaxonomy(request, response, "category", decodeURIComponent(categoryMatch[1])); return true; }
    if (categoryMatch && request.method === "DELETE") { await deleteTaxonomy(request, response, "category", decodeURIComponent(categoryMatch[1])); return true; }
    const tagMatch = pathname.match(/^\/api\/admin\/v11\/tags\/([^/]+)$/);
    if (tagMatch && request.method === "PUT") { await updateTaxonomy(request, response, "tag", decodeURIComponent(tagMatch[1])); return true; }
    if (tagMatch && request.method === "DELETE") { await deleteTaxonomy(request, response, "tag", decodeURIComponent(tagMatch[1])); return true; }
    const mergeMatch = pathname.match(/^\/api\/admin\/v11\/tags\/([^/]+)\/merge$/);
    if (mergeMatch && request.method === "POST") { await mergeTags(request, response, decodeURIComponent(mergeMatch[1])); return true; }
    return false;
  }

  return { handleRequest, resolveSkillTaxonomy, recordLegacyTelemetryEvents, ready, close: () => store.close(), storageMode: store.mode };
}

module.exports = { createV11Platform, MODULE_CODES, TASK_STATES, trendGranularity, trendBucket, seedTrendBuckets, validatedOverviewRange };
