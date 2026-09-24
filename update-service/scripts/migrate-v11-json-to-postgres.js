"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createV11Store, DEFAULT_CATEGORIES, DEFAULT_TAGS } = require("../v11-store");

const dataRoot = path.resolve(process.env.UPDATE_DATA_ROOT || path.join(__dirname, "..", "data"));
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function readJson(fileName, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataRoot, fileName), "utf8")); } catch { return fallback; }
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function cleanTags(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

async function main() {
  const store = createV11Store({ dataRoot, databaseUrl });
  await store.initialize();
  await store.close();

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  const platform = readJson("v11-platform.json", {});
  const submissions = readJson("skill-submissions.json", { submissions: [] }).submissions || [];
  const catalog = readJson("company-skills.json", { skills: [] }).skills || [];
  const counts = { categories: 0, tags: 0, taskFacts: 0, moduleEvents: 0, submissions: 0, skills: 0, versions: 0 };
  try {
    await client.query("BEGIN");
    for (const item of platform.categories || DEFAULT_CATEGORIES) {
      await client.query("INSERT INTO skill_categories(category_id,name,status,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(category_id) DO UPDATE SET name=excluded.name,status=excluded.status,sort_order=excluded.sort_order,updated_at=excluded.updated_at", [item.categoryId, item.name, item.status || "ENABLED", Number(item.sortOrder || 0), iso(item.createdAt), iso(item.updatedAt)]);
      counts.categories += 1;
    }
    for (const item of platform.tags || DEFAULT_TAGS) {
      await client.query("INSERT INTO skill_tags(tag_id,name,status,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tag_id) DO UPDATE SET name=excluded.name,status=excluded.status,sort_order=excluded.sort_order,updated_at=excluded.updated_at", [item.tagId, item.name, item.status || "ENABLED", Number(item.sortOrder || 0), iso(item.createdAt), iso(item.updatedAt)]);
      counts.tags += 1;
    }
    for (const fact of platform.taskFacts || []) {
      const result = await client.query("INSERT INTO task_facts_v11(event_key,task_id,user_key,task_type,state,first_executed_at,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [fact.eventKey, fact.taskId, fact.userKey || "legacy", fact.taskType || "chat", fact.state || "FAILED", iso(fact.firstExecutedAt), iso(fact.occurredAt)]);
      counts.taskFacts += result.rowCount;
    }
    for (const event of platform.moduleEvents || []) {
      const result = await client.query("INSERT INTO module_events_v11(event_key,user_key,module_code,action,key_operation,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [event.eventKey, event.userKey || "legacy", event.moduleCode, event.action || "visit", event.keyOperation === true, iso(event.occurredAt)]);
      counts.moduleEvents += result.rowCount;
    }
    for (const item of submissions) {
      const personalSkillId = String(item.personalSkillId || item.skillId || item.name || "legacy-skill");
      await client.query("INSERT INTO skill_submissions_v11(submission_id,personal_skill_id,owner_user_key,state,state_version,category_id,tag_ids,snapshot,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(submission_id) DO UPDATE SET state=excluded.state,state_version=excluded.state_version,category_id=excluded.category_id,tag_ids=excluded.tag_ids,snapshot=excluded.snapshot,updated_at=excluded.updated_at", [item.submissionId, personalSkillId, item.ownerUserKey || "legacy", item.status || "pending", Number(item.stateVersion || 1), item.categoryId || null, cleanTags(item.tagIds), item, iso(item.submittedAt), iso(item.reviewedAt || item.submittedAt)]);
      counts.submissions += 1;
    }
    for (const skill of catalog) {
      await client.query("INSERT INTO enterprise_skills_v11(enterprise_skill_id,source_personal_skill_id,name,status,category_id,tag_ids,creator_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(enterprise_skill_id) DO UPDATE SET name=excluded.name,status=excluded.status,category_id=excluded.category_id,tag_ids=excluded.tag_ids,updated_at=excluded.updated_at", [skill.skillId, skill.sourcePersonalSkillId || null, skill.name, skill.status || "published", skill.categoryId || null, cleanTags(skill.tagIds), skill.ownerUserKey || "", iso(skill.createdAt || skill.versions?.[0]?.publishedAt), iso(skill.updatedAt || skill.versions?.[0]?.publishedAt)]);
      counts.skills += 1;
      for (const version of skill.versions || []) {
        const snapshot = { ...skill, versions: undefined, release: version };
        await client.query("INSERT INTO enterprise_skill_versions_v11(enterprise_skill_id,version,snapshot,package_path,sha256,signature,status,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(enterprise_skill_id,version) DO UPDATE SET snapshot=excluded.snapshot,package_path=excluded.package_path,sha256=excluded.sha256,signature=excluded.signature,status=excluded.status,published_at=excluded.published_at", [skill.skillId, version.version, snapshot, version.packagePath || "", version.sha256 || crypto.createHash("sha256").update(`${skill.skillId}:${version.version}`).digest("hex"), version.signature || "", version.status || "published", iso(version.publishedAt)]);
        counts.versions += 1;
      }
    }
    await client.query("INSERT INTO v11_schema_migrations(migration_id) VALUES($1) ON CONFLICT DO NOTHING", ["json-compat-import-v1"]);
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({ ok: true, dataRoot, counts })}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
