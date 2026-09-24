const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_CATEGORIES = Object.freeze([
  ["office-collaboration", "办公协同"],
  ["efficiency-tools", "效率工具"],
  ["content-creation", "内容创作"],
  ["data-analysis", "数据分析"],
  ["business-operations", "商业运营"],
  ["development-tools", "开发工具"],
  ["information", "信息资讯"],
  ["education", "教育学习"],
  ["web-deployment", "网站部署"],
  ["lifestyle", "生活服务"],
  ["knowledge-management", "知识管理"]
].map(([categoryId, name], index) => ({
  categoryId,
  name,
  status: "ENABLED",
  sortOrder: (index + 1) * 10,
  createdAt: "",
  updatedAt: ""
})));

const DEFAULT_TAGS = Object.freeze([
  ["document", "文档"], ["summary", "总结"], ["image", "图片"], ["batch", "批处理"],
  ["copywriting", "文案"], ["commerce", "电商"], ["meeting", "会议"], ["table", "表格"],
  ["review", "评论"], ["insight", "洞察"], ["browser", "浏览器"], ["automation", "自动化"]
].map(([tagId, name], index) => ({
  tagId,
  name,
  status: "ENABLED",
  sortOrder: (index + 1) * 10,
  mergedIntoTagId: "",
  createdAt: "",
  updatedAt: ""
})));

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maximum = 120) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanId(value, fallbackPrefix) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || `${fallbackPrefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function defaultJsonStore() {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    categories: DEFAULT_CATEGORIES.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp })),
    tags: DEFAULT_TAGS.map((item) => ({ ...item, createdAt: timestamp, updatedAt: timestamp })),
    taskFacts: [],
    executionFacts: [],
    moduleEvents: [],
    qualityEvents: []
  };
}

function createJsonStore(dataRoot) {
  const filePath = path.join(dataRoot, "v11-platform.json");
  let mutation = Promise.resolve();

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(parsed.categories)) parsed.categories = [];
      if (!Array.isArray(parsed.tags)) parsed.tags = [];
      if (!Array.isArray(parsed.taskFacts)) parsed.taskFacts = [];
      if (!Array.isArray(parsed.executionFacts)) parsed.executionFacts = [];
      if (!Array.isArray(parsed.moduleEvents)) parsed.moduleEvents = [];
      if (!Array.isArray(parsed.qualityEvents)) parsed.qualityEvents = [];
      return parsed;
    } catch {
      const initial = defaultJsonStore();
      atomicWrite(filePath, initial);
      return initial;
    }
  }

  function update(work) {
    const current = mutation.catch(() => {}).then(async () => {
      const store = read();
      const result = await work(store);
      atomicWrite(filePath, store);
      return result;
    });
    mutation = current;
    return current;
  }

  return {
    mode: "json",
    async initialize() { read(); },
    async taxonomy() {
      const store = read();
      return { categories: store.categories, tags: store.tags };
    },
    async createTaxonomy(kind, input) {
      return update((store) => {
        const isCategory = kind === "category";
        const list = isCategory ? store.categories : store.tags;
        const idKey = isCategory ? "categoryId" : "tagId";
        const name = cleanText(input.name, 40);
        if (!name) throw new Error(`${isCategory ? "分类" : "标签"}名称不能为空`);
        if (list.some((item) => item.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) throw new Error("名称已经存在");
        const timestamp = nowIso();
        const item = {
          [idKey]: cleanId(input[idKey] || name, isCategory ? "category" : "tag"),
          name,
          status: input.status === "DISABLED" ? "DISABLED" : "ENABLED",
          sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : (list.length + 1) * 10,
          ...(isCategory ? {} : { mergedIntoTagId: "" }),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        if (list.some((entry) => entry[idKey] === item[idKey])) throw new Error("标识已经存在");
        list.push(item);
        return item;
      });
    },
    async updateTaxonomy(kind, id, input) {
      return update((store) => {
        const isCategory = kind === "category";
        const list = isCategory ? store.categories : store.tags;
        const idKey = isCategory ? "categoryId" : "tagId";
        const item = list.find((entry) => entry[idKey] === id);
        if (!item) throw new Error(`${isCategory ? "分类" : "标签"}不存在`);
        const name = input.name === undefined ? item.name : cleanText(input.name, 40);
        if (!name) throw new Error("名称不能为空");
        if (list.some((entry) => entry !== item && entry.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) throw new Error("名称已经存在");
        item.name = name;
        if (["ENABLED", "DISABLED"].includes(input.status)) item.status = input.status;
        if (Number.isFinite(Number(input.sortOrder))) item.sortOrder = Number(input.sortOrder);
        item.updatedAt = nowIso();
        return item;
      });
    },
    async deleteTaxonomy(kind, id) {
      return update((store) => {
        const isCategory = kind === "category";
        const list = isCategory ? store.categories : store.tags;
        const idKey = isCategory ? "categoryId" : "tagId";
        const index = list.findIndex((entry) => entry[idKey] === id);
        if (index < 0) throw new Error(`${isCategory ? "分类" : "标签"}不存在`);
        list.splice(index, 1);
        return { deleted: true, id };
      });
    },
    async mergeTags(sourceTagId, targetTagId) {
      return update((store) => {
        if (sourceTagId === targetTagId) throw new Error("不能合并到同一个标签");
        const source = store.tags.find((tag) => tag.tagId === sourceTagId);
        const target = store.tags.find((tag) => tag.tagId === targetTagId);
        if (!source || !target) throw new Error("标签不存在");
        source.status = "DISABLED";
        source.mergedIntoTagId = target.tagId;
        source.updatedAt = nowIso();
        return { source, target };
      });
    },
    async recordFacts(identity, facts) {
      return update((store) => {
        const seen = new Set([...store.taskFacts, ...store.executionFacts, ...store.moduleEvents, ...store.qualityEvents].map((item) => item.eventKey));
        let accepted = 0;
        for (const fact of facts) {
          const eventKey = cleanText(fact.eventKey, 120);
          if (!eventKey || seen.has(eventKey)) continue;
          const base = {
            eventKey,
            userKey: cleanText(identity.userKey, 160),
            occurredAt: new Date(fact.occurredAt || Date.now()).toISOString(),
            receivedAt: nowIso()
          };
          if (fact.kind === "task") {
            store.taskFacts.push({ ...base, taskId: cleanText(fact.taskId, 100), taskType: cleanText(fact.taskType, 40), state: cleanText(fact.state, 40), httpStatus: Number.isInteger(Number(fact.httpStatus)) ? Number(fact.httpStatus) : null, firstExecutedAt: fact.firstExecutedAt || base.occurredAt });
          } else if (fact.kind === "execution") {
            store.executionFacts.push({ ...base, executionId: cleanText(fact.executionId, 100), taskId: cleanText(fact.taskId, 100), retryOf: cleanText(fact.retryOf, 100), state: cleanText(fact.state, 40), httpStatus: Number.isInteger(Number(fact.httpStatus)) ? Number(fact.httpStatus) : null, startedAt: fact.startedAt || base.occurredAt, finishedAt: fact.finishedAt || base.occurredAt });
          } else if (fact.kind === "module") {
            store.moduleEvents.push({ ...base, moduleCode: cleanText(fact.moduleCode, 40), action: cleanText(fact.action, 60), keyOperation: fact.keyOperation === true });
          } else if (fact.kind === "quality") {
            store.qualityEvents.push({ ...base, eventType: cleanText(fact.eventType, 80), droppedCount: Math.max(0, Math.floor(Number(fact.droppedCount) || 0)), detail: cleanText(fact.detail, 300) });
          } else {
            continue;
          }
          seen.add(eventKey);
          accepted += 1;
        }
        store.taskFacts = store.taskFacts.slice(-100000);
        store.executionFacts = store.executionFacts.slice(-200000);
        store.moduleEvents = store.moduleEvents.slice(-200000);
        store.qualityEvents = store.qualityEvents.slice(-20000);
        return { accepted };
      });
    },
    async factsSnapshot() {
      const store = read();
      return { taskFacts: store.taskFacts, executionFacts: store.executionFacts, moduleEvents: store.moduleEvents, qualityEvents: store.qualityEvents };
    },
    async close() {}
  };
}

function createPostgresStore(databaseUrl) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: Math.max(2, Number(process.env.DATABASE_POOL_MAX || 10)) });

  async function initialize() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS v11_schema_migrations (
        migration_id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS skill_categories (
        category_id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('ENABLED','DISABLED')),
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS skill_tags (
        tag_id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('ENABLED','DISABLED')),
        sort_order integer NOT NULL DEFAULT 0,
        merged_into_tag_id text REFERENCES skill_tags(tag_id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS skill_submissions_v11 (
        submission_id text PRIMARY KEY,
        personal_skill_id text NOT NULL,
        owner_user_key text NOT NULL,
        state text NOT NULL,
        state_version integer NOT NULL DEFAULT 1,
        category_id text REFERENCES skill_categories(category_id),
        tag_ids text[] NOT NULL DEFAULT '{}',
        snapshot jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS enterprise_skills_v11 (
        enterprise_skill_id text PRIMARY KEY,
        source_personal_skill_id text,
        name text NOT NULL UNIQUE,
        status text NOT NULL,
        category_id text REFERENCES skill_categories(category_id),
        tag_ids text[] NOT NULL DEFAULT '{}',
        creator_name text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS enterprise_skill_versions_v11 (
        enterprise_skill_id text NOT NULL REFERENCES enterprise_skills_v11(enterprise_skill_id),
        version text NOT NULL,
        snapshot jsonb NOT NULL,
        package_path text NOT NULL,
        sha256 text NOT NULL,
        signature text NOT NULL,
        status text NOT NULL,
        published_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (enterprise_skill_id, version)
      );
      CREATE TABLE IF NOT EXISTS task_facts_v11 (
        event_key text PRIMARY KEY,
        task_id text NOT NULL,
        user_key text NOT NULL,
        task_type text NOT NULL,
        state text NOT NULL,
        http_status integer,
        first_executed_at timestamptz NOT NULL,
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE task_facts_v11 ADD COLUMN IF NOT EXISTS http_status integer;
      CREATE INDEX IF NOT EXISTS task_facts_v11_time_idx ON task_facts_v11(first_executed_at);
      CREATE INDEX IF NOT EXISTS task_facts_v11_user_idx ON task_facts_v11(user_key);
      CREATE TABLE IF NOT EXISTS execution_facts_v11 (
        event_key text PRIMARY KEY,
        execution_id text NOT NULL,
        task_id text NOT NULL,
        retry_of text,
        user_key text NOT NULL,
        state text NOT NULL,
        http_status integer,
        started_at timestamptz NOT NULL,
        finished_at timestamptz NOT NULL,
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS execution_facts_v11_task_idx ON execution_facts_v11(task_id);
      CREATE INDEX IF NOT EXISTS execution_facts_v11_time_idx ON execution_facts_v11(started_at);
      CREATE TABLE IF NOT EXISTS module_events_v11 (
        event_key text PRIMARY KEY,
        user_key text NOT NULL,
        module_code text NOT NULL,
        action text NOT NULL,
        key_operation boolean NOT NULL DEFAULT false,
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS module_events_v11_time_idx ON module_events_v11(occurred_at);
      CREATE INDEX IF NOT EXISTS module_events_v11_module_idx ON module_events_v11(module_code);
      CREATE TABLE IF NOT EXISTS quality_events_v11 (
        event_key text PRIMARY KEY,
        user_key text NOT NULL,
        event_type text NOT NULL,
        dropped_count integer NOT NULL DEFAULT 0,
        detail text NOT NULL DEFAULT '',
        occurred_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const category of DEFAULT_CATEGORIES) {
      await pool.query("INSERT INTO skill_categories(category_id,name,status,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [category.categoryId, category.name, category.status, category.sortOrder]);
    }
    for (const tag of DEFAULT_TAGS) {
      await pool.query("INSERT INTO skill_tags(tag_id,name,status,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [tag.tagId, tag.name, tag.status, tag.sortOrder]);
    }
  }

  function categoryRow(row) {
    return { categoryId: row.category_id, name: row.name, status: row.status, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  function tagRow(row) {
    return { tagId: row.tag_id, name: row.name, status: row.status, sortOrder: row.sort_order, mergedIntoTagId: row.merged_into_tag_id || "", createdAt: row.created_at, updatedAt: row.updated_at };
  }

  return {
    mode: "postgres",
    initialize,
    async taxonomy() {
      const [categories, tags] = await Promise.all([
        pool.query("SELECT * FROM skill_categories ORDER BY sort_order,name"),
        pool.query("SELECT * FROM skill_tags ORDER BY sort_order,name")
      ]);
      return { categories: categories.rows.map(categoryRow), tags: tags.rows.map(tagRow) };
    },
    async createTaxonomy(kind, input) {
      const isCategory = kind === "category";
      const name = cleanText(input.name, 40);
      if (!name) throw new Error(`${isCategory ? "分类" : "标签"}名称不能为空`);
      const id = cleanId(input[isCategory ? "categoryId" : "tagId"] || name, isCategory ? "category" : "tag");
      const status = input.status === "DISABLED" ? "DISABLED" : "ENABLED";
      const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 1000;
      const table = isCategory ? "skill_categories" : "skill_tags";
      const idColumn = isCategory ? "category_id" : "tag_id";
      const result = await pool.query(`INSERT INTO ${table}(${idColumn},name,status,sort_order) VALUES($1,$2,$3,$4) RETURNING *`, [id, name, status, sortOrder]);
      return isCategory ? categoryRow(result.rows[0]) : tagRow(result.rows[0]);
    },
    async updateTaxonomy(kind, id, input) {
      const isCategory = kind === "category";
      const table = isCategory ? "skill_categories" : "skill_tags";
      const idColumn = isCategory ? "category_id" : "tag_id";
      const current = await pool.query(`SELECT * FROM ${table} WHERE ${idColumn}=$1`, [id]);
      if (!current.rows[0]) throw new Error(`${isCategory ? "分类" : "标签"}不存在`);
      const row = current.rows[0];
      const name = input.name === undefined ? row.name : cleanText(input.name, 40);
      const status = ["ENABLED", "DISABLED"].includes(input.status) ? input.status : row.status;
      const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : row.sort_order;
      const result = await pool.query(`UPDATE ${table} SET name=$2,status=$3,sort_order=$4,updated_at=now() WHERE ${idColumn}=$1 RETURNING *`, [id, name, status, sortOrder]);
      return isCategory ? categoryRow(result.rows[0]) : tagRow(result.rows[0]);
    },
    async deleteTaxonomy(kind, id) {
      const table = kind === "category" ? "skill_categories" : "skill_tags";
      const idColumn = kind === "category" ? "category_id" : "tag_id";
      const result = await pool.query(`DELETE FROM ${table} WHERE ${idColumn}=$1 RETURNING ${idColumn}`, [id]);
      if (!result.rowCount) throw new Error(`${kind === "category" ? "分类" : "标签"}不存在或仍被引用`);
      return { deleted: true, id };
    },
    async mergeTags(sourceTagId, targetTagId) {
      if (sourceTagId === targetTagId) throw new Error("不能合并到同一个标签");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const target = await client.query("SELECT * FROM skill_tags WHERE tag_id=$1", [targetTagId]);
        if (!target.rows[0]) throw new Error("目标标签不存在");
        await client.query("UPDATE skill_submissions_v11 SET tag_ids=array_replace(tag_ids,$1,$2),updated_at=now() WHERE $1=ANY(tag_ids)", [sourceTagId, targetTagId]);
        await client.query("UPDATE enterprise_skills_v11 SET tag_ids=array_replace(tag_ids,$1,$2),updated_at=now() WHERE $1=ANY(tag_ids)", [sourceTagId, targetTagId]);
        const source = await client.query("UPDATE skill_tags SET status='DISABLED',merged_into_tag_id=$2,updated_at=now() WHERE tag_id=$1 RETURNING *", [sourceTagId, targetTagId]);
        if (!source.rows[0]) throw new Error("来源标签不存在");
        await client.query("COMMIT");
        return { source: tagRow(source.rows[0]), target: tagRow(target.rows[0]) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async recordFacts(identity, facts) {
      let accepted = 0;
      for (const fact of facts) {
        const eventKey = cleanText(fact.eventKey, 120);
        if (!eventKey) continue;
        if (fact.kind === "task") {
          const result = await pool.query("INSERT INTO task_facts_v11(event_key,task_id,user_key,task_type,state,http_status,first_executed_at,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING", [eventKey, cleanText(fact.taskId, 100), cleanText(identity.userKey, 160), cleanText(fact.taskType, 40), cleanText(fact.state, 40), Number.isInteger(Number(fact.httpStatus)) ? Number(fact.httpStatus) : null, fact.firstExecutedAt || fact.occurredAt || nowIso(), fact.occurredAt || nowIso()]);
          accepted += result.rowCount;
        } else if (fact.kind === "execution") {
          const result = await pool.query("INSERT INTO execution_facts_v11(event_key,execution_id,task_id,retry_of,user_key,state,http_status,started_at,finished_at,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING", [eventKey, cleanText(fact.executionId, 100), cleanText(fact.taskId, 100), cleanText(fact.retryOf, 100) || null, cleanText(identity.userKey, 160), cleanText(fact.state, 40), Number.isInteger(Number(fact.httpStatus)) ? Number(fact.httpStatus) : null, fact.startedAt || fact.occurredAt || nowIso(), fact.finishedAt || fact.occurredAt || nowIso(), fact.occurredAt || nowIso()]);
          accepted += result.rowCount;
        } else if (fact.kind === "module") {
          const result = await pool.query("INSERT INTO module_events_v11(event_key,user_key,module_code,action,key_operation,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [eventKey, cleanText(identity.userKey, 160), cleanText(fact.moduleCode, 40), cleanText(fact.action, 60), fact.keyOperation === true, fact.occurredAt || nowIso()]);
          accepted += result.rowCount;
        } else if (fact.kind === "quality") {
          const result = await pool.query("INSERT INTO quality_events_v11(event_key,user_key,event_type,dropped_count,detail,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [eventKey, cleanText(identity.userKey, 160), cleanText(fact.eventType, 80), Math.max(0, Math.floor(Number(fact.droppedCount) || 0)), cleanText(fact.detail, 300), fact.occurredAt || nowIso()]);
          accepted += result.rowCount;
        }
      }
      return { accepted };
    },
    async factsSnapshot() {
      const [tasks, executions, modules, quality] = await Promise.all([
        pool.query("SELECT * FROM task_facts_v11 ORDER BY occurred_at DESC LIMIT 100000"),
        pool.query("SELECT * FROM execution_facts_v11 ORDER BY occurred_at DESC LIMIT 200000"),
        pool.query("SELECT * FROM module_events_v11 ORDER BY occurred_at DESC LIMIT 200000"),
        pool.query("SELECT * FROM quality_events_v11 ORDER BY occurred_at DESC LIMIT 20000")
      ]);
      return {
        taskFacts: tasks.rows.map((row) => ({ eventKey: row.event_key, taskId: row.task_id, userKey: row.user_key, taskType: row.task_type, state: row.state, httpStatus: row.http_status, firstExecutedAt: row.first_executed_at, occurredAt: row.occurred_at })),
        executionFacts: executions.rows.map((row) => ({ eventKey: row.event_key, executionId: row.execution_id, taskId: row.task_id, retryOf: row.retry_of || "", userKey: row.user_key, state: row.state, httpStatus: row.http_status, startedAt: row.started_at, finishedAt: row.finished_at, occurredAt: row.occurred_at })),
        moduleEvents: modules.rows.map((row) => ({ eventKey: row.event_key, userKey: row.user_key, moduleCode: row.module_code, action: row.action, keyOperation: row.key_operation, occurredAt: row.occurred_at })),
        qualityEvents: quality.rows.map((row) => ({ eventKey: row.event_key, userKey: row.user_key, eventType: row.event_type, droppedCount: row.dropped_count, detail: row.detail, occurredAt: row.occurred_at }))
      };
    },
    async close() { await pool.end(); }
  };
}

function createV11Store({ dataRoot, databaseUrl = process.env.DATABASE_URL || "" }) {
  return String(databaseUrl || "").trim() ? createPostgresStore(String(databaseUrl).trim()) : createJsonStore(dataRoot);
}

module.exports = { createV11Store, DEFAULT_CATEGORIES, DEFAULT_TAGS };
