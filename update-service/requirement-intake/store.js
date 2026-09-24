"use strict";
const { Pool } = require("pg");
const { assert } = require("./contract");
const migration = `
CREATE TABLE IF NOT EXISTS intake_schema_migrations (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now());
INSERT INTO intake_schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS intake_owners (owner_key text PRIMARY KEY, profile jsonb NOT NULL, draft jsonb, version bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS intake_operations (owner_key text NOT NULL, request_id text NOT NULL, action text NOT NULL, content_hash text NOT NULL, status text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_key,request_id));
CREATE TABLE IF NOT EXISTS intake_submissions (requirement_id text PRIMARY KEY, draft_id text NOT NULL UNIQUE, owner_key text NOT NULL, nickname text NOT NULL, department text NOT NULL, title text NOT NULL, real_problem text NOT NULL, snapshot jsonb NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(), export_count integer NOT NULL DEFAULT 0, last_exported_at timestamptz);
CREATE INDEX IF NOT EXISTS intake_submissions_owner_time ON intake_submissions(owner_key,submitted_at DESC);
CREATE TABLE IF NOT EXISTS intake_sequences (day text PRIMARY KEY, value integer NOT NULL CHECK(value BETWEEN 0 AND 999));
CREATE TABLE IF NOT EXISTS intake_exports (export_id text PRIMARY KEY, request_id text NOT NULL UNIQUE, requirement_id text NOT NULL REFERENCES intake_submissions(requirement_id), content_hash text NOT NULL, completed_at timestamptz);
CREATE TABLE IF NOT EXISTS intake_audit (id bigserial PRIMARY KEY, owner_key text NOT NULL, action text NOT NULL, request_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS intake_sessions (token_hash text PRIMARY KEY, owner_key text NOT NULL, profile jsonb NOT NULL, expires_at timestamptz NOT NULL);
`;
class Store {
  constructor(connectionString) {
    assert(connectionString, "DATABASE_REQUIRED", "需求服务必须使用独立 PostgreSQL", 503);
    this.pool = new Pool({ connectionString, max: 6, statement_timeout: 15000 });
    this.ready = this.initialize();
  }
  async initialize() {
    await this.pool.query(migration);
    // A single preview service owns jobs. Interrupted jobs keep the already saved input.
    await this.pool.query("UPDATE intake_operations SET status='failed',result=$1,updated_at=now() WHERE status='running'", [{ code: "SERVICE_RESTARTED", error: "服务已重启，输入已保留，请重试分析" }]);
    await this.pool.query(`UPDATE intake_owners SET version=version+1,draft=jsonb_set(jsonb_set(jsonb_set(draft,'{pending}','null'::jsonb),'{lastFailedTurn}',COALESCE((SELECT t.value->'turnId' FROM jsonb_array_elements(draft->'turns') WITH ORDINALITY t(value,n) WHERE t.value->>'role'='user' ORDER BY t.n DESC LIMIT 1),'null'::jsonb)),'{error}',$1::jsonb) WHERE draft->'pending' IS NOT NULL AND draft->'pending'<>'null'::jsonb`, [{ code: "SERVICE_RESTARTED", error: "服务已重启，输入已保留，请重试分析" }]);
    await this.pool.query("DELETE FROM intake_sessions WHERE expires_at<now()");
  }
  async transaction(work) {
    await this.ready;
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  }
  async owner(client, profile) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [profile.ownerKey]);
    await client.query("INSERT INTO intake_owners(owner_key,profile) VALUES($1,$2) ON CONFLICT(owner_key) DO UPDATE SET profile=$2", [profile.ownerKey, profile]);
    const { rows } = await client.query("SELECT * FROM intake_owners WHERE owner_key=$1 FOR UPDATE", [profile.ownerKey]);
    return rows[0];
  }
  async save(client, row) {
    await client.query("UPDATE intake_owners SET draft=$2,version=$3,updated_at=now() WHERE owner_key=$1", [row.owner_key, row.draft, row.version]);
  }
  async operation(client, owner, requestId) { return (await client.query("SELECT * FROM intake_operations WHERE owner_key=$1 AND request_id=$2", [owner, requestId])).rows[0]; }
  async record(client, owner, id, action, contentHash, status, result) {
    await client.query("INSERT INTO intake_operations(owner_key,request_id,action,content_hash,status,result) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_key,request_id) DO UPDATE SET status=$5,result=$6,updated_at=now()", [owner, id, action, contentHash, status, result]);
  }
  async audit(client, owner, action, id) { await client.query("INSERT INTO intake_audit(owner_key,action,request_id) VALUES($1,$2,$3)", [owner, action, id]); }
  async close() { await this.pool.end(); }
}
module.exports = { Store, migration };
