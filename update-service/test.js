"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const JSZip = require("jszip");
const { trendGranularity, seedTrendBuckets, validatedOverviewRange } = require("./v11-platform");

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试更新服务没有启动");
}

async function main() {
  const shanghai = (value) => Date.parse(`${value}+08:00`);
  assert.strictEqual(trendGranularity(shanghai("2026-08-31T00:00:00"), shanghai("2026-08-31T23:59:59")), "two-hours");
  assert.strictEqual(trendGranularity(shanghai("2026-08-30T00:00:00"), shanghai("2026-08-31T23:59:59")), "day");
  assert.strictEqual(trendGranularity(shanghai("2026-08-18T00:00:00"), shanghai("2026-08-31T23:59:59")), "day");
  assert.strictEqual(trendGranularity(shanghai("2026-08-17T00:00:00"), shanghai("2026-08-31T23:59:59")), "week");
  assert.strictEqual(trendGranularity(shanghai("2026-06-03T00:00:00"), shanghai("2026-08-31T23:59:59")), "week");
  assert.strictEqual(trendGranularity(shanghai("2026-06-02T00:00:00"), shanghai("2026-08-31T23:59:59")), "month");
  const partialWeeks = new Map();
  seedTrendBuckets(partialWeeks, shanghai("2026-08-12T00:00:00"), shanghai("2026-08-26T23:59:59"), "week");
  assert.deepStrictEqual([...partialWeeks.values()].map((item) => item.label), ["08-12~08-16", "08-17~08-23", "08-24~08-26"]);
  const naturalMonths = new Map();
  seedTrendBuckets(naturalMonths, shanghai("2026-05-01T00:00:00"), shanghai("2026-08-31T23:59:59"), "month");
  assert.deepStrictEqual([...naturalMonths.keys()], ["2026-05", "2026-06", "2026-07", "2026-08"]);
  assert.throws(() => validatedOverviewRange(new URL("http://test/?from=2026-08-31T00:00:00%2B08:00&to=2026-08-30T23:59:59%2B08:00"), shanghai("2026-08-31T12:00:00")), /开始日不能晚于结束日/);
  assert.throws(() => validatedOverviewRange(new URL("http://test/?from=2026-08-31T00:00:00%2B08:00&to=2026-09-01T00:00:00%2B08:00"), shanghai("2026-08-31T12:00:00")), /结束日不能晚于今天/);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xianma-update-service-"));
  const dataRoot = path.join(temporaryRoot, "data");
  const privateKeyPath = path.join(temporaryRoot, "private.pem");
  const token = crypto.randomBytes(24).toString("hex");
  const port = 29100 + crypto.randomInt(0, 400);
  const baseUrl = `http://127.0.0.1:${port}`;
  const mapmsServer = http.createServer();
  const mapmsCalls = [];
  const mapmsDirectoryUsers = [
    { dingTalkUserId: "ding-user-a-enterprise", realName: "真实姓名甲", departmentId: 1001, departmentName: "产品部", status: 1 },
    { dingTalkUserId: "ding-user-b-enterprise", realName: "真实姓名乙", departmentId: 1002, departmentName: "技术部", status: 1 },
    { dingTalkUserId: "ding-user-c-enterprise", realName: "重名真实姓名", departmentId: 1001, departmentName: "产品部", status: 1 },
    { dingTalkUserId: "ding-user-d-enterprise", realName: "新增真实姓名", departmentId: 1003, departmentName: "财务部", status: 1 }
  ];
  const mapmsUsers = [
    { id: 5001, userNo: "U000123", username: "test-a", realName: "真实姓名甲", dingTalkUserId: "ding-user-a-enterprise", departmentId: 1001, departmentName: "产品部", status: 1, approvalStatus: 1 },
    { id: 5002, userNo: "U000124", username: "test-b", realName: "真实姓名乙", dingTalkUserId: "ding-user-b-enterprise", departmentId: 1002, departmentName: "技术部", status: 0, approvalStatus: 1 },
    { id: 5003, userNo: "U000125", username: "重名用户", realName: "重名真实姓名", dingTalkUserId: "", departmentId: 1001, departmentName: "产品部", status: 1, approvalStatus: 1 }
  ];
  let nextMapmsUserId = 6001;
  const sendMapms = (response, status, value) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
  };
  mapmsServer.on("request", (request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname;
      const timestamp = String(request.headers["x-api-timestamp"] || "");
      const nonce = String(request.headers["x-api-nonce"] || "");
      const canonical = `${request.method}\n${pathname}\n${timestamp}\n${nonce}`;
      const expectedSignature = crypto.createHmac("sha256", "ms-test-secret").update(canonical).digest("hex");
      const payload = JSON.parse(body || "{}");
      mapmsCalls.push({ method: request.method, pathname, headers: request.headers, payload });

      if (request.method === "POST" && pathname === "/api/admin/v1/auth/login") {
        if (payload.username !== "test-admin" || payload.password !== "test-password") {
          sendMapms(response, 401, { code: "40101", message: "账号或密码错误" });
          return;
        }
        sendMapms(response, 200, {
          code: "0",
          message: "OK",
          data: { accessToken: "mapms-test-admin-token", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
        });
        return;
      }

      if (pathname.startsWith("/api/admin/v1/")) {
        if (request.headers.authorization !== "Bearer mapms-test-admin-token") {
          sendMapms(response, 401, { code: "40100", message: "未认证" });
          return;
        }
        if (request.method === "GET" && pathname === "/api/admin/v1/organization/users") {
          const keyword = String(requestUrl.searchParams.get("keyword") || "").trim().toLocaleLowerCase("zh-CN");
          const records = mapmsUsers.filter((user) => !keyword || [user.username, user.realName, user.dingTalkUserId]
            .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(keyword)));
          sendMapms(response, 200, { code: "0", message: "OK", data: { records, total: records.length } });
          return;
        }
        const approvalMatch = pathname.match(/^\/api\/admin\/v1\/organization\/registration-approvals\/(\d+)\/approve$/);
        if (request.method === "PUT" && approvalMatch) {
          const user = mapmsUsers.find((item) => item.id === Number(approvalMatch[1]));
          if (!user) {
            sendMapms(response, 404, { code: "40400", message: "用户不存在" });
            return;
          }
          user.approvalStatus = 1;
          sendMapms(response, 200, { code: "0", message: "OK" });
          return;
        }
        sendMapms(response, 404, { code: "40400", message: "管理接口不存在" });
        return;
      }

      const authenticated = request.headers["x-api-key"] === "mk-test-key"
        && request.headers["x-api-secret"] === "ms-test-secret"
        && request.headers["x-api-signature"] === expectedSignature;
      if (!authenticated) {
        sendMapms(response, 401, { code: "40100", message: "签名无效" });
        return;
      }
      if (request.method === "GET" && pathname === "/api/open/v1/platforms/me/dingtalk/departments/tree") {
        sendMapms(response, 200, {
          code: "0",
          message: "OK",
          data: [
            { departmentId: 1001, dingTalkDeptId: 8101, deptName: "产品部", children: [] },
            { departmentId: 1002, dingTalkDeptId: 8102, deptName: "技术部", children: [] },
            { departmentId: 1003, dingTalkDeptId: 8103, deptName: "财务部", children: [] }
          ]
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/open/v1/platforms/me/dingtalk/users") {
        const realName = String(requestUrl.searchParams.get("realName") || "").trim().toLocaleLowerCase("zh-CN");
        const users = mapmsDirectoryUsers.filter((user) => !realName || user.realName.toLocaleLowerCase("zh-CN").includes(realName));
        sendMapms(response, 200, {
          code: "0",
          message: "OK",
          data: users
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/open/v1/platforms/me/users/dingtalk-sso") {
        const user = mapmsUsers.find((item) => item.dingTalkUserId === payload.DTUserId);
        if (!user) {
          sendMapms(response, 404, { code: "40400", message: "未绑定 MAPMS 用户", requestId: "mapms-auth-unbound" });
        } else if (user.approvalStatus !== 1) {
          sendMapms(response, 400, { code: "40105", message: "账号待审批", requestId: "mapms-auth-pending" });
        } else if (user.status !== 1) {
          sendMapms(response, 403, { code: "40300", message: "用户已禁用或锁定", requestId: "mapms-auth-disabled" });
        } else {
          sendMapms(response, 200, {
            code: "0",
            message: "OK",
            data: { userId: user.id, userNo: user.userNo, username: user.username, realName: user.realName, departmentId: user.departmentId, departmentName: user.departmentName, status: 1, verified: true },
            requestId: "mapms-auth-allowed"
          });
        }
        return;
      }
      if (request.method === "POST" && pathname === "/api/open/v1/platforms/me/users") {
        if (mapmsUsers.some((user) => user.username === payload.username || user.dingTalkUserId === payload.dingTalkUserId)) {
          sendMapms(response, 409, { code: "USER_EXISTS", message: "登录名或钉钉用户已存在", requestId: "mapms-register-duplicate" });
          return;
        }
        const directoryUser = mapmsDirectoryUsers.find((user) => user.dingTalkUserId === payload.dingTalkUserId);
        if (!directoryUser || directoryUser.departmentId !== payload.departmentId) {
          sendMapms(response, 400, { code: "40000", message: "钉钉用户或部门不匹配" });
          return;
        }
        const user = {
          id: nextMapmsUserId,
          userNo: `U${String(nextMapmsUserId).padStart(6, "0")}`,
          username: payload.username,
          realName: directoryUser.realName,
          dingTalkUserId: directoryUser.dingTalkUserId,
          departmentId: directoryUser.departmentId,
          departmentName: directoryUser.departmentName,
          status: 1,
          approvalStatus: 0
        };
        nextMapmsUserId += 1;
        mapmsUsers.push(user);
        sendMapms(response, 200, {
          code: "0",
          message: "OK",
          data: { userId: user.id, userNo: user.userNo, username: user.username, tenantId: 9001, platformId: 1001 },
          requestId: "mapms-register-created"
        });
        return;
      }
      sendMapms(response, 404, { code: "40400", message: "接口不存在" });
    });
  });
  await new Promise((resolve) => mapmsServer.listen(0, "127.0.0.1", resolve));
  const mapmsBaseUrl = `http://127.0.0.1:${mapmsServer.address().port}`;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      UPDATE_DATA_ROOT: dataRoot,
      UPDATE_ADMIN_TOKEN: token,
      UPDATE_SIGNING_PRIVATE_KEY_PATH: privateKeyPath,
      UPDATE_PUBLIC_BASE_URL: baseUrl,
      UPDATE_NEXT_INTERNAL_VERSION: "1.4.0",
      TELEMETRY_EXCLUDED_NAMES: "黄则",
      ENABLE_COMPANY_SKILL_PLATFORM: "1",
      COMPANY_SKILL_ADMIN_PUBLIC: "0",
      COMPANY_SKILL_ADMIN_PREVIEW_PATH: "company-skills-test-preview",
      MAPMS_BASE_URL: mapmsBaseUrl,
      MAPMS_API_KEY: "mk-test-key",
      MAPMS_API_SECRET: "ms-test-secret",
      MAPMS_USER_REMARK: "桌面端注册",
      MAPMS_ADMIN_BASE_URL: `${mapmsBaseUrl}/api/admin/v1`,
      MAPMS_ADMIN_USERNAME: "test-admin",
      MAPMS_ADMIN_PASSWORD: "test-password",
      XMAI_PROMPT_PORTAL_INTEGRATION_KEY: "portal-test-key",
      XMAI_PROMPT_PORTAL_INTEGRATION_SECRET: "portal-test-secret",
      ADMIN_FRAME_ANCESTORS: "'self' http://mapms.example.test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  try {
    await waitForHealth(baseUrl);
    let adminHeaders = {
      authorization: `Bearer ${token}`,
      "x-admin-name": encodeURIComponent("邓婷"),
      "x-admin-id": encodeURIComponent("mapms-admin-1008"),
      "x-admin-username": encodeURIComponent("dengting")
    };
    const adminPage = await fetch(`${baseUrl}/admin`);
    assert.strictEqual(adminPage.status, 200);
    assert.strictEqual(adminPage.headers.get("x-frame-options"), null);
    assert.ok(String(adminPage.headers.get("content-security-policy") || "").includes("frame-ancestors 'self' http://mapms.example.test"));
    assert.ok((await adminPage.text()).includes('Object.freeze({"companySkills":false})'));
    const hiddenSkillAdmin = await fetch(`${baseUrl}/api/admin/skill-submissions`, { headers: adminHeaders });
    assert.strictEqual(hiddenSkillAdmin.status, 200, "页面隐藏时技能审核接口仍应允许管理密码调用");
    const previewEntry = await fetch(`${baseUrl}/admin/company-skills-test-preview`, { redirect: "manual" });
    assert.strictEqual(previewEntry.status, 302);
    const previewCookie = String(previewEntry.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.ok(previewCookie.startsWith("xianma_company_skill_preview="));
    const previewPage = await fetch(`${baseUrl}/admin?company-skills-preview=1`, { headers: { cookie: previewCookie } });
    assert.strictEqual(previewPage.status, 200);
    assert.ok((await previewPage.text()).includes('Object.freeze({"companySkills":true})'));
    adminHeaders = { ...adminHeaders, cookie: previewCookie };
    const publicOverview = await fetch(`${baseUrl}/api/admin/telemetry/overview`);
    assert.strictEqual(publicOverview.status, 200);
    const protectedReleases = await fetch(`${baseUrl}/api/admin/releases`);
    assert.strictEqual(protectedReleases.status, 401);
    const initial = await fetch(`${baseUrl}/api/admin/releases`, { headers: adminHeaders });
    assert.strictEqual(initial.status, 200);
    const initialPayload = await initial.json();
    assert.strictEqual(initialPayload.channel, "stable-v2");
    assert.strictEqual(initialPayload.suggestedInternalVersion, "1.4.0");

    const registerTelemetry = async (payload) => {
      const response = await fetch(`${baseUrl}/api/desktop/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      assert.strictEqual(response.status, 201, text);
      return JSON.parse(text);
    };
    const firstTelemetrySession = await registerTelemetry({
      userId: "ding-user-a",
      dingtalkUserId: "ding-user-a-enterprise",
      dingtalkRealName: "真实姓名甲",
      name: "测试用户甲",
      corpId: "ding-test-corp",
      department: "产品部",
      deviceId: "device-a",
      appVersion: "1.0.3",
      internalVersion: "1.0.3",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    const secondTelemetrySession = await registerTelemetry({
      userId: "ding-user-b",
      dingtalkUserId: "ding-user-b-enterprise",
      dingtalkRealName: "真实姓名乙",
      name: "测试用户乙",
      corpId: "ding-test-corp",
      department: "技术部",
      deviceId: "device-b",
      appVersion: "1.0.2",
      internalVersion: "1.0.2",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 10"
    });
    assert.ok(firstTelemetrySession.sessionToken);
    assert.ok(secondTelemetrySession.sessionToken);
    const invalidTelemetry = await fetch(`${baseUrl}/api/desktop/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "无标识用户" })
    });
    assert.strictEqual(invalidTelemetry.status, 400);
    const heartbeat = await fetch(`${baseUrl}/api/desktop/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(heartbeat.status, 202);
    const renewedFirstTelemetrySession = await registerTelemetry({
      userId: "ding-user-a",
      dingtalkUserId: "ding-user-a-enterprise",
      dingtalkRealName: "真实姓名甲",
      name: "测试用户甲",
      corpId: "ding-test-corp",
      department: "产品部",
      deviceId: "device-a",
      appVersion: "1.0.3",
      internalVersion: "1.0.3",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    assert.notStrictEqual(renewedFirstTelemetrySession.sessionToken, firstTelemetrySession.sessionToken);
    const legacySessionHeartbeat = await fetch(`${baseUrl}/api/desktop/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const renewedSessionHeartbeat = await fetch(`${baseUrl}/api/desktop/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${renewedFirstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(legacySessionHeartbeat.status, 202, "同一设备重新登记后旧版客户端会话仍应有效");
    assert.strictEqual(renewedSessionHeartbeat.status, 202, "同一设备新会话应有效");
    const telemetryEvents = await fetch(`${baseUrl}/api/desktop/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "chat", count: 2 }, { type: "skill", count: 1 }, { type: "unapproved-field", count: 999 }] })
    });
    assert.strictEqual(telemetryEvents.status, 202);
    const mapmsSyncResponse = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const mapmsSync = await mapmsSyncResponse.json();
    assert.strictEqual(mapmsSyncResponse.status, 200);
    assert.strictEqual(mapmsSync.status, "synced");
    assert.strictEqual(mapmsSync.mapmsUserId, 5001);
    const mapmsRegistrationCalls = () => mapmsCalls.filter((call) => call.pathname === "/api/open/v1/platforms/me/users");
    assert.strictEqual(mapmsRegistrationCalls().length, 0, "已有 MAPMS 用户不应重复注册");
    const registrationCountBeforeRepeat = mapmsRegistrationCalls().length;
    const repeatedMapmsSync = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(repeatedMapmsSync.status, 200);
    assert.strictEqual(mapmsRegistrationCalls().length, registrationCountBeforeRepeat, "MAPMS 已存在用户不应重复注册");
    const allowedMapmsAuthorization = await fetch(`${baseUrl}/api/desktop/mapms/authorize`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const allowedAuthorizationBody = await allowedMapmsAuthorization.json();
    assert.strictEqual(allowedMapmsAuthorization.status, 200);
    assert.strictEqual(allowedAuthorizationBody.allowed, true);
    assert.strictEqual(allowedAuthorizationBody.mapmsUserId, 5001);
    const firstAuthorizationCall = mapmsCalls.find((call) => call.pathname === "/api/open/v1/platforms/me/users/dingtalk-sso" && call.payload.DTUserId === "ding-user-a-enterprise");
    assert.ok(firstAuthorizationCall, "没有使用企业 userid 校验 MAPMS 登录权限");

    const verifyPromptPortalSession = async (payload, overrides = {}) => {
      const pathname = "/api/integrations/prompt-portal/session/verify";
      const rawBody = JSON.stringify(payload);
      const timestamp = String(overrides.timestamp || Date.now());
      const nonce = String(overrides.nonce || crypto.randomBytes(18).toString("base64url"));
      const bodyDigest = crypto.createHash("sha256").update(rawBody).digest("hex");
      const canonical = `POST\n${pathname}\n${timestamp}\n${nonce}\n${bodyDigest}`;
      const signature = String(overrides.signature || crypto.createHmac("sha256", "portal-test-secret").update(canonical).digest("hex"));
      return fetch(`${baseUrl}${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-xmai-integration-key": String(overrides.integrationKey || "portal-test-key"),
          "x-xmai-timestamp": timestamp,
          "x-xmai-nonce": nonce,
          "x-xmai-signature": signature
        },
        body: rawBody
      });
    };
    const promptPortalPayload = {
      desktopSessionToken: firstTelemetrySession.sessionToken,
      dingtalkUserId: "ding-user-a-enterprise",
      corpId: "ding-test-corp",
      audience: "prompt-portal"
    };
    const promptPortalVerification = await verifyPromptPortalSession(promptPortalPayload);
    const promptPortalVerificationBody = await promptPortalVerification.json();
    assert.strictEqual(promptPortalVerification.status, 200, JSON.stringify(promptPortalVerificationBody));
    assert.strictEqual(promptPortalVerificationBody.code, "0");
    assert.strictEqual(promptPortalVerificationBody.data.verified, true);
    assert.strictEqual(promptPortalVerificationBody.data.dingtalkUserId, "ding-user-a-enterprise");
    assert.strictEqual(promptPortalVerificationBody.data.corpId, "ding-test-corp");
    assert.strictEqual(promptPortalVerificationBody.data.nickname, "测试用户甲");
    assert.strictEqual(promptPortalVerificationBody.data.department, "产品部");

    const replayTimestamp = String(Date.now());
    const replayNonce = crypto.randomBytes(18).toString("base64url");
    const firstReplayAttempt = await verifyPromptPortalSession(promptPortalPayload, { timestamp: replayTimestamp, nonce: replayNonce });
    assert.strictEqual(firstReplayAttempt.status, 200, await firstReplayAttempt.text());
    const repeatedReplayAttempt = await verifyPromptPortalSession(promptPortalPayload, { timestamp: replayTimestamp, nonce: replayNonce });
    assert.strictEqual(repeatedReplayAttempt.status, 409);
    assert.strictEqual((await repeatedReplayAttempt.json()).code, "INTEGRATION_REPLAYED");

    const expiredPromptPortalSignature = await verifyPromptPortalSession(promptPortalPayload, { timestamp: String(Date.now() - 5 * 60 * 1000) });
    assert.strictEqual(expiredPromptPortalSignature.status, 401);
    assert.strictEqual((await expiredPromptPortalSignature.json()).code, "INTEGRATION_TIMESTAMP_INVALID");

    const invalidPromptPortalSignature = await verifyPromptPortalSession(promptPortalPayload, { signature: "0".repeat(64) });
    assert.strictEqual(invalidPromptPortalSignature.status, 401);
    assert.strictEqual((await invalidPromptPortalSignature.json()).code, "INTEGRATION_UNAUTHORIZED");

    const mismatchedPromptPortalUser = await verifyPromptPortalSession({
      ...promptPortalPayload,
      dingtalkUserId: "ding-user-b-enterprise"
    });
    assert.strictEqual(mismatchedPromptPortalUser.status, 403);
    assert.strictEqual((await mismatchedPromptPortalUser.json()).code, "XMAI_USER_MISMATCH");

    const invalidPromptPortalSession = await verifyPromptPortalSession({
      ...promptPortalPayload,
      desktopSessionToken: "invalid-desktop-session"
    });
    assert.strictEqual(invalidPromptPortalSession.status, 401);
    assert.strictEqual((await invalidPromptPortalSession.json()).code, "XMAI_SESSION_EXPIRED");

    const disabledPromptPortalUser = await verifyPromptPortalSession({
      desktopSessionToken: secondTelemetrySession.sessionToken,
      dingtalkUserId: "ding-user-b-enterprise",
      corpId: "ding-test-corp",
      audience: "prompt-portal"
    });
    assert.strictEqual(disabledPromptPortalUser.status, 403);
    assert.strictEqual((await disabledPromptPortalUser.json()).code, "MAPMS_USER_DISABLED");

    const factsStartedAt = new Date(Date.now() - 2_000).toISOString();
    const factsFinishedAt = new Date().toISOString();
    const historicalModuleAt = new Date(Date.now() - (60 * 24 * 60 * 60 * 1000)).toISOString();
    const factsResponse = await fetch(`${baseUrl}/api/desktop/v11/facts`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ facts: [
        { kind: "task", eventKey: "smoke-task-success-running", taskId: "smoke-task-success", taskType: "chat", state: "RUNNING", firstExecutedAt: factsStartedAt, occurredAt: factsStartedAt },
        { kind: "task", eventKey: "smoke-task-success-final", taskId: "smoke-task-success", taskType: "chat", state: "SUCCEEDED", firstExecutedAt: factsStartedAt, occurredAt: factsFinishedAt },
        { kind: "task", eventKey: "smoke-task-failed-running", taskId: "smoke-task-failed", taskType: "skill", state: "RUNNING", firstExecutedAt: factsStartedAt, occurredAt: factsStartedAt },
        { kind: "task", eventKey: "smoke-task-failed-final", taskId: "smoke-task-failed", taskType: "skill", state: "FAILED", httpStatus: 404, firstExecutedAt: factsStartedAt, occurredAt: factsFinishedAt },
        { kind: "task", eventKey: "smoke-task-server-error-running", taskId: "smoke-task-server-error", taskType: "chat", state: "RUNNING", firstExecutedAt: factsStartedAt, occurredAt: factsStartedAt },
        { kind: "task", eventKey: "smoke-task-server-error-final", taskId: "smoke-task-server-error", taskType: "chat", state: "FAILED", httpStatus: 500, firstExecutedAt: factsStartedAt, occurredAt: factsFinishedAt },
        { kind: "module", eventKey: "smoke-module-chat-visit", moduleCode: "AI_CHAT", action: "visit", keyOperation: false, occurredAt: factsStartedAt },
        { kind: "module", eventKey: "smoke-module-chat-operation", moduleCode: "AI_CHAT", action: "send_message", keyOperation: true, occurredAt: factsFinishedAt },
        { kind: "module", eventKey: "smoke-module-browser-visit", moduleCode: "BROWSER_TOOL", action: "visit", keyOperation: false, occurredAt: factsStartedAt },
        { kind: "module", eventKey: "smoke-module-browser-operation", moduleCode: "BROWSER_TOOL", action: "execute_browser_task", keyOperation: true, occurredAt: factsFinishedAt },
        { kind: "module", eventKey: "smoke-module-skill-historical-visit", moduleCode: "SKILL_LIBRARY", action: "visit", keyOperation: false, occurredAt: historicalModuleAt }
      ] })
    });
    const factsResult = await factsResponse.json();
    assert.strictEqual(factsResponse.status, 202, JSON.stringify(factsResult));
    assert.strictEqual(factsResult.accepted, 11, "V1.1 任务与模块事实没有完整写入");

    const skillMarkdown = `---
name: weather-brief
description: 根据用户输入整理天气信息并生成简洁出行建议。
---

# 适用场景
需要把天气查询结果整理成可读摘要时使用。

# 输入要求
输入城市、日期和关注事项。

# 输出要求
输出天气摘要、穿衣建议和风险提醒。

# 执行流程
1. 核对城市与日期。
2. 获取天气信息。
3. 生成结构化结果。

# 边界与禁止事项
不得编造实时天气；无法联网时应明确说明。

# 异常处理
城市不明确时先向用户确认。

# 使用示例
用户：整理北京明天的天气和通勤建议。
`;
    const skillMetadata = {
      schemaVersion: 1,
      version: "1.0.0",
      displayName: "天气简报",
      category: "办公效率",
      categoryId: "efficiency-tools",
      tagIds: ["summary"],
      newTags: ["天气简报"],
      starter: "请整理北京明天的天气和出行建议。",
      icon: "cloud-sun",
      fields: [{ id: "content", label: "城市与日期", type: "textarea" }],
      supportedInputs: ["text", "json"],
      outputs: ["markdown", "docx"],
      permissions: ["network"],
      dependencies: []
    };
    const skillZip = new JSZip();
    skillZip.file("weather-brief/SKILL.md", skillMarkdown);
    skillZip.file("weather-brief/skill.json", JSON.stringify(skillMetadata, null, 2));
    skillZip.file("weather-brief/references/source.txt", "公开天气数据源说明");
    const skillPackage = await skillZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const skillAuthHeaders = { authorization: `Bearer ${firstTelemetrySession.sessionToken}` };
    const initializeSkillUpload = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads`, {
      method: "POST",
      headers: { ...skillAuthHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "weather-brief.zip",
        fileSize: skillPackage.length,
        fileFingerprint: crypto.createHash("sha256").update(skillPackage).digest("hex")
      })
    });
    const skillUpload = await initializeSkillUpload.json();
    assert.strictEqual(initializeSkillUpload.status, 201, JSON.stringify(skillUpload));
    for (let index = 0; index < skillUpload.chunkCount; index += 1) {
      const start = index * skillUpload.chunkSize;
      const chunk = skillPackage.subarray(start, Math.min(skillPackage.length, start + skillUpload.chunkSize));
      const chunkResponse = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${skillUpload.uploadId}/chunks/${index}`, {
        method: "PUT",
        headers: { ...skillAuthHeaders, "content-type": "application/octet-stream", "content-length": String(chunk.length) },
        body: chunk,
        duplex: "half"
      });
      assert.strictEqual(chunkResponse.status, 200, await chunkResponse.text());
    }
    const completeSkillUpload = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${skillUpload.uploadId}/complete`, {
      method: "POST",
      headers: skillAuthHeaders
    });
    const completedSkillSubmission = await completeSkillUpload.json();
    assert.strictEqual(completeSkillUpload.status, 201, JSON.stringify(completedSkillSubmission));
    assert.strictEqual(completedSkillSubmission.submission.status, "pending");
    assert.strictEqual(completedSkillSubmission.submission.submitter.name, "测试用户甲");
    assert.strictEqual(completedSkillSubmission.submission.riskLevel, "high");
    assert.deepStrictEqual(completedSkillSubmission.submission.tagIds, ["summary"]);
    assert.deepStrictEqual(completedSkillSubmission.submission.newTags, ["天气简报"]);

    const mySkillSubmissions = await fetch(`${baseUrl}/api/desktop/skill-submissions/mine`, { headers: skillAuthHeaders });
    const mySkillSubmissionBody = await mySkillSubmissions.json();
    assert.strictEqual(mySkillSubmissions.status, 200);
    assert.strictEqual(mySkillSubmissionBody.submissions.length, 1);
    const pendingCatalog = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.strictEqual(pendingCatalog.skills.length, 0, "未审核技能不能进入公司技能库");
    const unauthorizedSkillCatalog = await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: { authorization: "Bearer invalid-token" } });
    assert.strictEqual(unauthorizedSkillCatalog.status, 401);

    const adminSkillList = await fetch(`${baseUrl}/api/admin/skill-submissions?status=pending`, { headers: adminHeaders });
    const adminSkillListBody = await adminSkillList.json();
    assert.strictEqual(adminSkillList.status, 200);
    assert.strictEqual(adminSkillListBody.submissions.length, 1);
    const submissionId = completedSkillSubmission.submission.submissionId;
    const adminSkillDetail = await (await fetch(`${baseUrl}/api/admin/skill-submissions/${submissionId}`, { headers: adminHeaders })).json();
    assert.ok(adminSkillDetail.submission.fileTree.some((entry) => entry.path === "SKILL.md"));
    const unsafeApproval = await fetch(`${baseUrl}/api/admin/skill-submissions/${submissionId}/approve`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ riskAcknowledged: false })
    });
    assert.strictEqual(unsafeApproval.status, 400, "高风险技能不能在未确认风险时批准");
    const approvalResponse = await fetch(`${baseUrl}/api/admin/skill-submissions/${submissionId}/approve`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ riskAcknowledged: true, categoryId: "efficiency-tools" })
    });
    const approvedSkill = await approvalResponse.json();
    assert.strictEqual(approvalResponse.status, 200, JSON.stringify(approvedSkill));
    assert.strictEqual(approvedSkill.submission.status, "approved");
    assert.ok(approvedSkill.submission.enterpriseTagNames.includes("天气简报"), "用户新增标签必须在审批时创建并保留");
    const catalogBeforePublish = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.strictEqual(catalogBeforePublish.skills.length, 0, "审核通过但未发布的技能不能进入公司技能库");
    const stalePublishResponse = await fetch(`${baseUrl}/api/admin/skill-submissions/${submissionId}/publish`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ stateVersion: Math.max(0, Number(approvedSkill.submission.stateVersion) - 1) })
    });
    assert.strictEqual(stalePublishResponse.status, 409, "旧状态版本必须触发发布冲突");
    const publishResponse = await fetch(`${baseUrl}/api/admin/skill-submissions/${submissionId}/publish`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ stateVersion: approvedSkill.submission.stateVersion, enterpriseDisplayName: "企业天气简报" })
    });
    const publishedSkill = await publishResponse.json();
    assert.strictEqual(publishResponse.status, 200, JSON.stringify(publishedSkill));
    assert.strictEqual(publishedSkill.skill.latestVersion, "1.0.0");
    assert.strictEqual(publishedSkill.skill.displayName, "企业天气简报");
    assert.ok(approvedSkill.submission.auditTrail.some((item) => item.action === "approved"));

    const catalogResponse = await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders });
    const catalogBody = await catalogResponse.json();
    assert.strictEqual(catalogResponse.status, 200);
    assert.strictEqual(catalogBody.skills.length, 1);
    const companySkill = catalogBody.skills[0];
    const packageResponse = await fetch(`${baseUrl}/api/desktop/company-skills/${companySkill.skillId}/package?version=1.0.0`, { headers: skillAuthHeaders });
    const downloadedSkillPackage = Buffer.from(await packageResponse.arrayBuffer());
    assert.strictEqual(packageResponse.status, 200);
    assert.strictEqual(crypto.createHash("sha256").update(downloadedSkillPackage).digest("hex"), companySkill.sha256);
    const signedSkillPayload = Buffer.from(companySkill.signed, "base64url");
    assert.strictEqual(crypto.verify(null, signedSkillPayload, publicKey, Buffer.from(companySkill.signature, "base64url")), true);

    const publicSkillApiPath = "/api/open/v1/enterprise-skills";
    const publicSkillPreflight = await fetch(`${baseUrl}${publicSkillApiPath}`, {
      method: "OPTIONS",
      headers: { origin: "https://workbuddy.example" }
    });
    assert.strictEqual(publicSkillPreflight.status, 204);
    assert.strictEqual(publicSkillPreflight.headers.get("access-control-allow-origin"), "*");
    assert.ok(publicSkillPreflight.headers.get("access-control-allow-methods").includes("GET"));
    const publicSkillListResponse = await fetch(`${baseUrl}${publicSkillApiPath}?q=${encodeURIComponent("企业天气")}`, {
      headers: { origin: "https://workbuddy.example" }
    });
    const publicSkillList = await publicSkillListResponse.json();
    assert.strictEqual(publicSkillListResponse.status, 200, JSON.stringify(publicSkillList));
    assert.strictEqual(publicSkillList.count, 1);
    assert.strictEqual(publicSkillList.skills[0].skillId, companySkill.skillId);
    assert.strictEqual(publicSkillList.skills[0].latestVersion, "1.0.0");
    assert.ok(publicSkillList.skills[0].downloadUrl.endsWith(`/api/open/v1/enterprise-skills/${encodeURIComponent(companySkill.skillId)}/package?version=1.0.0`));
    assert.ok(!JSON.stringify(publicSkillList).includes("packagePath"), "公开技能目录不能泄露服务器文件路径");
    const publicSkillDetailResponse = await fetch(`${baseUrl}${publicSkillApiPath}/${encodeURIComponent(companySkill.skillId)}`);
    const publicSkillDetail = await publicSkillDetailResponse.json();
    assert.strictEqual(publicSkillDetailResponse.status, 200, JSON.stringify(publicSkillDetail));
    assert.strictEqual(publicSkillDetail.skill.displayName, "企业天气简报");
    const publicSkillVersionsResponse = await fetch(`${baseUrl}${publicSkillApiPath}/${encodeURIComponent(companySkill.skillId)}/versions`);
    const publicSkillVersions = await publicSkillVersionsResponse.json();
    assert.strictEqual(publicSkillVersionsResponse.status, 200, JSON.stringify(publicSkillVersions));
    assert.deepStrictEqual(publicSkillVersions.versions.map((item) => item.version), ["1.0.0"]);
    const publicSkillPackageResponse = await fetch(`${baseUrl}${publicSkillApiPath}/${encodeURIComponent(companySkill.skillId)}/package?version=1.0.0`);
    const publicSkillPackage = Buffer.from(await publicSkillPackageResponse.arrayBuffer());
    assert.strictEqual(publicSkillPackageResponse.status, 200);
    assert.strictEqual(publicSkillPackageResponse.headers.get("access-control-allow-origin"), "*");
    assert.strictEqual(publicSkillPackageResponse.headers.get("x-skill-id"), companySkill.skillId);
    assert.strictEqual(publicSkillPackageResponse.headers.get("x-skill-version"), "1.0.0");
    assert.deepStrictEqual(publicSkillPackage, downloadedSkillPackage, "公开下载包必须与客户端企业技能包一致");

    const updatedSkillZip = new JSZip();
    updatedSkillZip.file("weather-brief/SKILL.md", skillMarkdown);
    updatedSkillZip.file("weather-brief/skill.json", JSON.stringify({ ...skillMetadata, version: "1.0.1" }, null, 2));
    updatedSkillZip.file("weather-brief/references/source.txt", "公开天气数据源说明 v1.0.1");
    const updatedSkillPackage = await updatedSkillZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const initializeUpdatedUpload = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads`, {
      method: "POST",
      headers: { ...skillAuthHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "weather-brief-1.0.1.zip",
        fileSize: updatedSkillPackage.length,
        fileFingerprint: crypto.createHash("sha256").update(updatedSkillPackage).digest("hex")
      })
    });
    const updatedUpload = await initializeUpdatedUpload.json();
    assert.strictEqual(initializeUpdatedUpload.status, 201, JSON.stringify(updatedUpload));
    for (let index = 0; index < updatedUpload.chunkCount; index += 1) {
      const start = index * updatedUpload.chunkSize;
      const chunk = updatedSkillPackage.subarray(start, Math.min(updatedSkillPackage.length, start + updatedUpload.chunkSize));
      const response = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${updatedUpload.uploadId}/chunks/${index}`, {
        method: "PUT",
        headers: { ...skillAuthHeaders, "content-type": "application/octet-stream", "content-length": String(chunk.length) },
        body: chunk,
        duplex: "half"
      });
      assert.strictEqual(response.status, 200, await response.text());
    }
    const completeUpdatedUpload = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${updatedUpload.uploadId}/complete`, {
      method: "POST",
      headers: skillAuthHeaders
    });
    const updatedSubmission = await completeUpdatedUpload.json();
    assert.strictEqual(completeUpdatedUpload.status, 201, JSON.stringify(updatedSubmission));
    const staleWithdraw = await fetch(`${baseUrl}/api/desktop/skill-submissions/${updatedSubmission.submission.submissionId}/withdraw`, {
      method: "POST",
      headers: { ...skillAuthHeaders, "content-type": "application/json" },
      body: JSON.stringify({ stateVersion: 0 })
    });
    assert.strictEqual(staleWithdraw.status, 409, "旧状态版本必须触发撤回冲突");
    const withdrawResponse = await fetch(`${baseUrl}/api/desktop/skill-submissions/${updatedSubmission.submission.submissionId}/withdraw`, {
      method: "POST",
      headers: { ...skillAuthHeaders, "content-type": "application/json" },
      body: JSON.stringify({ stateVersion: updatedSubmission.submission.stateVersion })
    });
    const withdrawnSubmission = await withdrawResponse.json();
    assert.strictEqual(withdrawResponse.status, 200, JSON.stringify(withdrawnSubmission));
    assert.strictEqual(withdrawnSubmission.submission.status, "withdrawn");
    const initializeResubmission = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads`, {
      method: "POST",
      headers: { ...skillAuthHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "weather-brief-1.0.1-resubmit.zip",
        fileSize: updatedSkillPackage.length,
        fileFingerprint: crypto.createHash("sha256").update(updatedSkillPackage).digest("hex")
      })
    });
    const resubmissionUpload = await initializeResubmission.json();
    assert.strictEqual(initializeResubmission.status, 201, JSON.stringify(resubmissionUpload));
    for (let index = 0; index < resubmissionUpload.chunkCount; index += 1) {
      const start = index * resubmissionUpload.chunkSize;
      const chunk = updatedSkillPackage.subarray(start, Math.min(updatedSkillPackage.length, start + resubmissionUpload.chunkSize));
      const response = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${resubmissionUpload.uploadId}/chunks/${index}`, {
        method: "PUT",
        headers: { ...skillAuthHeaders, "content-type": "application/octet-stream", "content-length": String(chunk.length) },
        body: chunk,
        duplex: "half"
      });
      assert.strictEqual(response.status, 200, await response.text());
    }
    const completeResubmission = await fetch(`${baseUrl}/api/desktop/skill-submissions/uploads/${resubmissionUpload.uploadId}/complete`, {
      method: "POST",
      headers: skillAuthHeaders
    });
    const resubmittedSkill = await completeResubmission.json();
    assert.strictEqual(completeResubmission.status, 201, JSON.stringify(resubmittedSkill));
    assert.strictEqual(resubmittedSkill.submission.status, "pending", "撤回后必须允许同版本重新提交");
    const withdrawnSubmissionDirectory = path.join(dataRoot, "skills", "submissions", updatedSubmission.submission.submissionId);
    const wrongSubmissionDelete = await fetch(`${baseUrl}/api/admin/skill-submissions/${updatedSubmission.submission.submissionId}`, {
      method: "DELETE",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmName: "错误名称" })
    });
    assert.strictEqual(wrongSubmissionDelete.status, 400, "永久删除必须校验完整技能名称");
    const deleteWithdrawnSubmission = await fetch(`${baseUrl}/api/admin/skill-submissions/${updatedSubmission.submission.submissionId}`, {
      method: "DELETE",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmName: updatedSubmission.submission.displayName })
    });
    assert.strictEqual(deleteWithdrawnSubmission.status, 200, await deleteWithdrawnSubmission.text());
    assert.strictEqual(fs.existsSync(withdrawnSubmissionDirectory), false, "删除审核记录时必须同时删除服务器原始包");

    for (const outcome of ["invoked", "succeeded", "failed", "cancelled"]) {
      const usageResponse = await fetch(`${baseUrl}/api/desktop/company-skills/usage`, {
        method: "POST",
        headers: { ...skillAuthHeaders, "content-type": "application/json" },
        body: JSON.stringify({ skillId: companySkill.skillId, version: "1.0.0", outcome })
      });
      assert.strictEqual(usageResponse.status, 202, await usageResponse.text());
    }
    const companyUsageResponse = await fetch(`${baseUrl}/api/admin/company-skills/usage`, { headers: adminHeaders });
    const companyUsage = await companyUsageResponse.json();
    assert.strictEqual(companyUsageResponse.status, 200);
    const weatherUsage = companyUsage.skills.find((item) => item.skillId === companySkill.skillId);
    assert.deepStrictEqual({ invoked: weatherUsage.invoked, succeeded: weatherUsage.succeeded, failed: weatherUsage.failed, cancelled: weatherUsage.cancelled }, { invoked: 1, succeeded: 1, failed: 1, cancelled: 1 });
    const rawUsageStore = fs.readFileSync(path.join(dataRoot, "skill-usage.json"), "utf8");
    assert.ok(!rawUsageStore.includes("ding-user") && !rawUsageStore.includes("测试用户"), "匿名技能统计不能保存用户身份");

    const v11OverviewResponse = await fetch(`${baseUrl}/api/admin/v11/overview?from=${encodeURIComponent(new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { headers: adminHeaders });
    const v11Overview = await v11OverviewResponse.json();
    assert.strictEqual(v11OverviewResponse.status, 200, JSON.stringify(v11Overview));
    assert.deepStrictEqual({ tasks: v11Overview.period.tasks, succeeded: v11Overview.period.succeeded, failed: v11Overview.period.failed, successRate: v11Overview.period.successRate }, { tasks: 7, succeeded: 5, failed: 1, successRate: 83.3 }, "每次真实访问必须补为成功任务，且只有 HTTP 404 计入失败数和成功率分母");
    assert.ok(v11Overview.trend.length > 1 && v11Overview.trend.every((item) => Number.isFinite(item.tasks)), "折线图必须包含连续时间桶，少量数据时不能退化为单个点");
    assert.strictEqual(v11Overview.period.companySkillInvocations, 2, "企业技能周期调用次数应包含新版企业技能和旧版未识别技能匿名调用");
    const browserModule = v11Overview.modules.find((item) => item.moduleCode === "BROWSER_TOOL");
    assert.ok(browserModule && browserModule.visits === 1 && browserModule.operations === 1, "浏览器操作没有反馈到 V1.1 模块统计");
    const historicalSkillModule = v11Overview.modules.find((item) => item.moduleCode === "SKILL_LIBRARY");
    assert.ok(historicalSkillModule && historicalSkillModule.visits === 1, "功能使用排行必须累计日期范围之外的历史访问");
    assert.ok(v11Overview.realtime.versionDistribution.some((item) => item.version === "1.0.3" && item.devices === 1), "客户端版本分布缺少 1.0.3");
    assert.ok(v11Overview.realtime.versionDistribution.some((item) => item.version === "1.0.2" && item.devices === 1), "客户端版本分布缺少 1.0.2");
    const v11UsersResponse = await fetch(`${baseUrl}/api/admin/v11/users?search=${encodeURIComponent("测试用户甲")}`, { headers: adminHeaders });
    const v11Users = await v11UsersResponse.json();
    assert.strictEqual(v11UsersResponse.status, 200, JSON.stringify(v11Users));
    assert.strictEqual(v11Users.users.length, 1);
    assert.deepStrictEqual(
      { total: v11Users.users[0].totalTasks, succeeded: v11Users.users[0].succeededTasks, failed: v11Users.users[0].failedTasks, successRate: v11Users.users[0].successRate },
      { total: 6, succeeded: 5, failed: 1, successRate: 83.3 },
      "用户详情必须把模块访问补为成功任务，但只有 HTTP 404 计入失败数"
    );
    assert.ok(v11Users.users[0].recentModules.length > 0 && v11Users.users[0].recentModules.every((module) => module.visits === module.operations && module.primaryActionCount === module.visits), "模块使用次数必须按访问与操作中的较大真实值统一展示");

    const revokeCompanySkill = await fetch(`${baseUrl}/api/admin/company-skills/${companySkill.skillId}/revoke`, { method: "POST", headers: adminHeaders });
    assert.strictEqual(revokeCompanySkill.status, 200);
    const publicCatalogAfterRevokeResponse = await fetch(`${baseUrl}${publicSkillApiPath}`);
    const publicCatalogAfterRevoke = await publicCatalogAfterRevokeResponse.json();
    assert.strictEqual(publicCatalogAfterRevokeResponse.status, 200);
    assert.strictEqual(publicCatalogAfterRevoke.count, 0, "已下架企业技能不能出现在公开技能列表");
    const publicPackageAfterRevoke = await fetch(`${baseUrl}${publicSkillApiPath}/${encodeURIComponent(companySkill.skillId)}/package?version=1.0.0`);
    assert.strictEqual(publicPackageAfterRevoke.status, 404, "已下架企业技能不能通过公开接口下载");
    const catalogAfterRevoke = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.strictEqual(catalogAfterRevoke.skills.length, 0);
    assert.ok(catalogAfterRevoke.revokedSkillIds.includes(companySkill.skillId));
    const revokedSubmissionsResponse = await fetch(`${baseUrl}/api/admin/skill-submissions?status=revoked`, { headers: adminHeaders });
    const revokedSubmissions = await revokedSubmissionsResponse.json();
    assert.strictEqual(revokedSubmissionsResponse.status, 200);
    assert.ok(revokedSubmissions.submissions.some((item) => item.submissionId === submissionId), "下架技能必须同步显示在已下架审核记录中");
    const companySkillsAdmin = await fetch(`${baseUrl}/api/admin/company-skills`, { headers: adminHeaders });
    const companySkillsAdminBody = await companySkillsAdmin.json();
    assert.strictEqual(companySkillsAdmin.status, 200);
    assert.strictEqual(companySkillsAdminBody.skills[0].status, "revoked");
    const republishResponse = await fetch(`${baseUrl}/api/admin/company-skills/${companySkill.skillId}/republish`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0.0" })
    });
    assert.strictEqual(republishResponse.status, 200, await republishResponse.text());
    const publicCatalogAfterRepublish = await (await fetch(`${baseUrl}${publicSkillApiPath}`)).json();
    assert.strictEqual(publicCatalogAfterRepublish.count, 1, "重新发布后企业技能应恢复到公开目录");
    const catalogAfterRepublish = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.strictEqual(catalogAfterRepublish.skills.length, 1, "重新发布后技能应恢复到公司技能库");

    const directSkillMarkdown = skillMarkdown.replace("name: weather-brief", "name: admin-direct-summary").replace("天气信息", "项目进展");
    const directSkillZip = new JSZip();
    directSkillZip.file("admin-direct-summary/SKILL.md", directSkillMarkdown);
    directSkillZip.file("admin-direct-summary/skill.json", JSON.stringify({
      ...skillMetadata,
      displayName: "管理员直发摘要",
      category: "办公协同",
      categoryId: "office-collaboration",
      tagIds: ["document", "summary"],
      permissions: []
    }, null, 2));
    const directSkillPackage = await directSkillZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const directPublishResponse = await fetch(`${baseUrl}/api/admin/company-skills/direct-publish`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/zip",
        "content-length": String(directSkillPackage.length),
        "x-file-name": encodeURIComponent("admin-direct-summary.zip")
      },
      body: directSkillPackage
    });
    const directPublished = await directPublishResponse.json();
    assert.strictEqual(directPublishResponse.status, 201, JSON.stringify(directPublished));
    assert.strictEqual(directPublished.skill.displayName, "管理员直发摘要");
    assert.strictEqual(directPublished.skill.creator?.name, "邓婷", "直接发布创建人必须使用外层当前登录管理员昵称");
    const directSubmissionStore = JSON.parse(fs.readFileSync(path.join(dataRoot, "skill-submissions.json"), "utf8"));
    const directSubmission = directSubmissionStore.submissions.find((item) => item.skillId === directPublished.skill.skillId);
    assert.strictEqual(directSubmission?.submitter?.adminId, "mapms-admin-1008", "直接发布必须保存外层管理员稳定 ID");
    assert.strictEqual(directSubmission?.submitter?.username, "dengting", "直接发布必须保存外层管理员登录名");
    const catalogAfterDirectPublish = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.ok(catalogAfterDirectPublish.skills.some((item) => item.displayName === "管理员直发摘要"), "管理员直接发布的技能没有进入企业技能库");
    const adminCatalogAfterDirectPublish = await (await fetch(`${baseUrl}/api/admin/company-skills`, { headers: adminHeaders })).json();
    const adminDirectSkill = adminCatalogAfterDirectPublish.skills.find((item) => item.skillId === directPublished.skill.skillId);
    assert.strictEqual(adminDirectSkill?.auditTrail?.at(-1)?.actor, "邓婷", "直接发布审计记录必须使用外层当前登录管理员昵称");

    const productionLikeStore = JSON.parse(fs.readFileSync(path.join(dataRoot, "company-skills.json"), "utf8"));
    const productionLikeSkill = productionLikeStore.skills.find((item) => item.skillId === directPublished.skill.skillId);
    productionLikeSkill.creator = {
      name: "黄则",
      realName: "黄则",
      department: "",
      adminId: "401",
      userId: "401",
      username: "xmai_a10487df9390836d607f9f9a"
    };
    productionLikeSkill.auditTrail.at(-1).actor = "黄则";
    fs.writeFileSync(path.join(dataRoot, "company-skills.json"), JSON.stringify(productionLikeStore, null, 2), "utf8");
    const excludedAdminCatalog = await (await fetch(`${baseUrl}/api/admin/company-skills`, { headers: adminHeaders })).json();
    const excludedAdminSkill = excludedAdminCatalog.skills.find((item) => item.skillId === directPublished.skill.skillId);
    assert.strictEqual(excludedAdminSkill?.creator?.name, "黄则", "MAPMS 管理员审计身份不能被开发者统计排除规则替换");
    assert.strictEqual(excludedAdminSkill?.auditTrail?.at(-1)?.actor, "黄则", "MAPMS 管理员审计人必须保留当前登录管理员");
    const privacyCatalog = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    const privacySkill = privacyCatalog.skills.find((item) => item.skillId === directPublished.skill.skillId);
    assert.strictEqual(privacySkill?.creator?.name, "开发团队", "客户端企业技能目录仍应遵守开发者隐私规则");

    const rawDirectSkillZip = new JSZip();
    rawDirectSkillZip.file("raw-meeting-skill/SKILL.md", "# 会议整理\n\n读取会议材料，提炼结论、决定和待办事项。\n");
    rawDirectSkillZip.file("raw-meeting-skill/references/example.md", "会议主题：季度经营复盘\n");
    const rawDirectSkillPackage = await rawDirectSkillZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const normalizedDirectPublishResponse = await fetch(`${baseUrl}/api/admin/company-skills/direct-publish`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/zip",
        "content-length": String(rawDirectSkillPackage.length),
        "x-file-name": encodeURIComponent("raw-meeting-skill.zip"),
        "x-enterprise-name": encodeURIComponent("管理员直发会议整理"),
        "x-category-name": encodeURIComponent("办公协同"),
        "x-category-id": encodeURIComponent("office-collaboration"),
        "x-tag-ids": encodeURIComponent(JSON.stringify(["document"]))
      },
      body: rawDirectSkillPackage
    });
    const normalizedDirectPublished = await normalizedDirectPublishResponse.json();
    assert.strictEqual(normalizedDirectPublishResponse.status, 201, JSON.stringify(normalizedDirectPublished));
    assert.strictEqual(normalizedDirectPublished.normalized, true, "缺少 skill.json 的直发技能没有自动补齐格式");
    assert.ok(String(normalizedDirectPublished.normalizationMessage || "").includes("自动补齐"));
    const normalizedSubmissionStore = JSON.parse(fs.readFileSync(path.join(dataRoot, "skill-submissions.json"), "utf8"));
    const normalizedSubmission = normalizedSubmissionStore.submissions.find((item) => item.enterpriseDisplayName === "管理员直发会议整理");
    assert.ok(normalizedSubmission, "自动标准化后的技能没有写入发布记录");
    assert.ok(normalizedSubmission.fileTree.some((item) => item.path === "SKILL.md"), "标准化发布包缺少 SKILL.md");
    assert.ok(normalizedSubmission.fileTree.some((item) => item.path === "skill.json"), "标准化发布包缺少自动生成的 skill.json");
    assert.ok(normalizedSubmission.fileTree.some((item) => item.path === "references/example.md"), "标准化时丢失了原技能资源");
    assert.strictEqual(normalizedSubmission.version, "1.0.0", "缺失版本时应使用 1.0.0");
    assert.ok(normalizedSubmission.previews.some((item) => item.path === "SKILL.md" && item.content.includes("读取会议材料")), "标准化时丢失了原始 SKILL.md 说明");
    const normalizedPublishedZip = await JSZip.loadAsync(fs.readFileSync(normalizedSubmission.packagePath));
    const normalizedMetadata = JSON.parse(await normalizedPublishedZip.file("raw-meeting-skill/skill.json").async("string"));
    assert.strictEqual(normalizedMetadata.displayName, "管理员直发会议整理");
    assert.strictEqual(normalizedMetadata.version, "1.0.0");
    assert.ok(normalizedPublishedZip.file("raw-meeting-skill/references/example.md"), "最终发布包没有保留 references 资源");

    const unsafeDirectSkillZip = new JSZip();
    unsafeDirectSkillZip.file("unsafe-direct/SKILL.md", "# 不安全技能\n\n测试自动标准化后的安全扫描。\n");
    unsafeDirectSkillZip.file("unsafe-direct/references/secret.txt", "api_key: sk-1234567890abcdef1234567890abcdef\n");
    const unsafeDirectSkillPackage = await unsafeDirectSkillZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const unsafeDirectPublishResponse = await fetch(`${baseUrl}/api/admin/company-skills/direct-publish`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/zip",
        "content-length": String(unsafeDirectSkillPackage.length),
        "x-file-name": encodeURIComponent("unsafe-direct.zip"),
        "x-enterprise-name": encodeURIComponent("不安全直发技能"),
        "x-category-id": encodeURIComponent("office-collaboration"),
        "x-tag-ids": encodeURIComponent(JSON.stringify(["document"]))
      },
      body: unsafeDirectSkillPackage
    });
    const unsafeDirectPublished = await unsafeDirectPublishResponse.json();
    assert.strictEqual(unsafeDirectPublishResponse.status, 400, JSON.stringify(unsafeDirectPublished));
    assert.ok(String(unsafeDirectPublished.error || "").includes("明文密钥"), "自动标准化不能绕过明文密钥检查");
    const wrongCompanyDelete = await fetch(`${baseUrl}/api/admin/company-skills/${companySkill.skillId}`, {
      method: "DELETE",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmName: "错误名称" })
    });
    assert.strictEqual(wrongCompanyDelete.status, 400, "永久删除企业技能必须校验完整技能名称");
    const deleteCompanySkill = await fetch(`${baseUrl}/api/admin/company-skills/${companySkill.skillId}`, {
      method: "DELETE",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmName: "企业天气简报" })
    });
    assert.strictEqual(deleteCompanySkill.status, 200, await deleteCompanySkill.text());
    const catalogAfterCompanyDelete = await (await fetch(`${baseUrl}/api/desktop/company-skills`, { headers: skillAuthHeaders })).json();
    assert.ok(!catalogAfterCompanyDelete.skills.some((item) => item.skillId === companySkill.skillId), "永久删除后企业技能仍在客户端目录");
    assert.ok(catalogAfterCompanyDelete.revokedSkillIds.includes(companySkill.skillId), "永久删除后必须保留客户端停用墓碑");
    const submissionsAfterCompanyDelete = await (await fetch(`${baseUrl}/api/admin/skill-submissions`, { headers: adminHeaders })).json();
    assert.ok(!submissionsAfterCompanyDelete.submissions.some((item) => item.skillId === companySkill.skillId), "企业技能关联审核记录没有删除");
    assert.strictEqual(fs.existsSync(path.join(dataRoot, "skills", "public", companySkill.skillId)), false, "企业技能发布包目录没有删除");
    const usageAfterCompanyDelete = JSON.parse(fs.readFileSync(path.join(dataRoot, "skill-usage.json"), "utf8"));
    assert.ok(!Object.values(usageAfterCompanyDelete.aggregates).some((item) => item.skillId === companySkill.skillId), "企业技能匿名统计没有删除");

    const deniedMapmsAuthorization = await fetch(`${baseUrl}/api/desktop/mapms/authorize`, {
      method: "POST",
      headers: { authorization: `Bearer ${secondTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const deniedAuthorizationBody = await deniedMapmsAuthorization.json();
    assert.strictEqual(deniedMapmsAuthorization.status, 403);
    assert.strictEqual(deniedAuthorizationBody.code, "MAPMS_USER_DISABLED");
    assert.ok(deniedAuthorizationBody.error.includes("禁用"));
    const unauthorizedMapmsSync = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: "Bearer invalid-token", "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(unauthorizedMapmsSync.status, 401);
    const unauthorizedMapmsAuthorization = await fetch(`${baseUrl}/api/desktop/mapms/authorize`, {
      method: "POST",
      headers: { authorization: "Bearer invalid-token", "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(unauthorizedMapmsAuthorization.status, 401);
    const telemetryRefreshResponse = await fetch(`${baseUrl}/api/admin/telemetry/refresh`, { method: "POST" });
    const telemetryRefresh = await telemetryRefreshResponse.json();
    assert.strictEqual(telemetryRefreshResponse.status, 200);
    assert.deepStrictEqual(
      { checked: telemetryRefresh.checked, allowed: telemetryRefresh.allowed, denied: telemetryRefresh.denied },
      { checked: 2, allowed: 1, denied: 1 }
    );
    const overviewResponse = await fetch(`${baseUrl}/api/admin/telemetry/overview`);
    assert.strictEqual(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.deepStrictEqual({ users: overview.totalUsers, online: overview.onlineUsers, devices: overview.totalDevices }, { users: 2, online: 2, devices: 2 });
    assert.strictEqual(overview.versionDistribution["1.0.3"], 1);
    const usersResponse = await fetch(`${baseUrl}/api/admin/telemetry/users?search=${encodeURIComponent("产品部")}`);
    const telemetryUsers = (await usersResponse.json()).users;
    assert.strictEqual(telemetryUsers.length, 1);
    assert.strictEqual(telemetryUsers[0].userId, "ding-user-a");
    assert.strictEqual(telemetryUsers[0].usage.chat, 2);
    assert.strictEqual(telemetryUsers[0].usage.skill, undefined);
    assert.strictEqual(telemetryUsers[0].usage["unapproved-field"], undefined);
    assert.strictEqual(telemetryUsers[0].mapms.status, "synced");
    assert.strictEqual(telemetryUsers[0].mapms.userId, 5001);
    assert.strictEqual(telemetryUsers[0].mapms.authorizationStatus, "allowed");
    const exportResponse = await fetch(`${baseUrl}/api/admin/telemetry/export`);
    const exportText = await exportResponse.text();
    assert.strictEqual(exportResponse.status, 200);
    assert.ok(exportText.includes("测试用户甲") && exportText.includes("测试用户乙"));
    const v2TelemetrySession = await registerTelemetry({
      userId: "ding-user-a",
      dingtalkUserId: "ding-user-a-enterprise",
      dingtalkRealName: "真实姓名甲",
      name: "测试用户甲",
      corpId: "ding-test-corp",
      department: "产品部",
      deviceId: "device-a",
      appVersion: "2.0.0",
      internalVersion: "2.0.0",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    const v2CompatibilityEvent = await fetch(`${baseUrl}/api/desktop/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${v2TelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "chat", count: 1 }] })
    });
    assert.strictEqual(v2CompatibilityEvent.status, 202);
    const v2Range = `from=${encodeURIComponent(new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`;
    const beforeV2Fact = await (await fetch(`${baseUrl}/api/admin/v11/overview?${v2Range}`, { headers: adminHeaders })).json();
    assert.deepStrictEqual(beforeV2Fact.modules, v11Overview.modules, "2.0.0 的兼容计数接口不能生成重复模块访问");
    const v2FactTime = new Date().toISOString();
    const v2FactResponse = await fetch(`${baseUrl}/api/desktop/v11/facts`, {
      method: "POST",
      headers: { authorization: `Bearer ${v2TelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ facts: [
        { kind: "task", eventKey: "smoke-v2-task-final", taskId: "smoke-v2-task", taskType: "chat", state: "SUCCEEDED", firstExecutedAt: v2FactTime, occurredAt: v2FactTime }
      ] })
    });
    assert.strictEqual(v2FactResponse.status, 202);
    const afterV2Fact = await (await fetch(`${baseUrl}/api/admin/v11/overview?${v2Range}`, { headers: adminHeaders })).json();
    assert.strictEqual(afterV2Fact.period.tasks, 7, "2.0.0 的精确任务不能与兼容访问重复累加");
    const logoutTelemetry = await fetch(`${baseUrl}/api/desktop/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "logout" }] })
    });
    assert.strictEqual(logoutTelemetry.status, 202);
    const afterLogoutOverview = await (await fetch(`${baseUrl}/api/admin/telemetry/overview`, { headers: adminHeaders })).json();
    assert.strictEqual(afterLogoutOverview.onlineUsers, 1);

    const duplicateTelemetrySession = await registerTelemetry({
      userId: "ding-user-c",
      dingtalkUserId: "ding-user-c-enterprise",
      dingtalkRealName: "重名真实姓名",
      name: "重名用户",
      corpId: "ding-test-corp",
      department: "产品部",
      deviceId: "device-c",
      appVersion: "1.0.3",
      internalVersion: "1.0.3",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    const duplicateResolution = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${duplicateTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const duplicateResolutionBody = await duplicateResolution.json();
    assert.strictEqual(duplicateResolution.status, 409);
    assert.strictEqual(duplicateResolutionBody.code, "MAPMS_EXISTING_USER_UNBOUND");
    assert.strictEqual(mapmsRegistrationCalls().length, 0, "未绑定用户不能通过注册接口创建重复账号");

    const newTelemetrySession = await registerTelemetry({
      userId: "ding-user-d",
      dingtalkUserId: "ding-user-d-enterprise",
      dingtalkRealName: "新增真实姓名",
      name: "新增用户",
      corpId: "ding-test-corp",
      department: "财务部",
      deviceId: "device-d",
      appVersion: "1.0.3",
      internalVersion: "1.0.3",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    const newUserResolution = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${newTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const newUserResolutionBody = await newUserResolution.json();
    assert.strictEqual(newUserResolution.status, 200, JSON.stringify(newUserResolutionBody));
    assert.strictEqual(newUserResolutionBody.status, "synced");
    assert.strictEqual(newUserResolutionBody.mapmsUserId, 6001);
    assert.strictEqual(mapmsRegistrationCalls().length, 1, "全新用户应且只应注册一次");
    const newUserRegistration = mapmsRegistrationCalls()[0].payload;
    assert.deepStrictEqual({
      username: newUserRegistration.username,
      departmentId: newUserRegistration.departmentId,
      dingTalkUserId: newUserRegistration.dingTalkUserId,
      realName: newUserRegistration.realName,
      remark: newUserRegistration.remark
    }, {
      username: "新增用户",
      departmentId: 1003,
      dingTalkUserId: "ding-user-d-enterprise",
      realName: "新增真实姓名",
      remark: "桌面端注册"
    });
    assert.match(newUserRegistration.password, /^(?=.{8,64}$)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])/);
    assert.ok(mapmsCalls.some((call) => call.method === "PUT" && call.pathname === "/api/admin/v1/organization/registration-approvals/6001/approve"), "注册成功后必须自动审批");
    const repeatedNewUserResolution = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${newTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    assert.strictEqual(repeatedNewUserResolution.status, 200);
    assert.strictEqual(mapmsRegistrationCalls().length, 1, "重复登录不能重复注册 MAPMS 用户");

    const incompleteTelemetrySession = await registerTelemetry({
      userId: "ding-user-e",
      dingtalkUserId: "ding-user-e-enterprise",
      dingtalkRealName: "未同步真实姓名",
      name: "未同步用户",
      corpId: "ding-test-corp",
      department: "未知部门",
      deviceId: "device-e",
      appVersion: "1.0.3",
      internalVersion: "1.0.3",
      platform: "win32",
      arch: "x64",
      osVersion: "Windows 11"
    });
    const incompleteResolution = await fetch(`${baseUrl}/api/desktop/mapms/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${incompleteTelemetrySession.sessionToken}`, "content-type": "application/json" },
      body: "{}"
    });
    const incompleteResolutionBody = await incompleteResolution.json();
    assert.strictEqual(incompleteResolution.status, 409);
    assert.strictEqual(incompleteResolutionBody.code, "MAPMS_DINGTALK_USER_NOT_SYNCED");
    assert.strictEqual(mapmsRegistrationCalls().length, 1, "组织资料不完整时不能猜测字段并注册");

    const channelInstaller = crypto.randomBytes(4096);
    const uploadChannelVersion = async (channel) => {
      const channelParams = new URLSearchParams({
        displayVersion: "1.0.2",
        internalVersion: "1.0.2",
        title: "通道隔离测试",
        notes: Buffer.from("验证相同内部版本可存在于不同通道", "utf8").toString("base64url"),
        force: "0",
        fileName: `先马·AI Studio Setup 1.0.2 ${channel}.exe`,
        channel,
        platform: "win32",
        arch: "x64"
      });
      return fetch(`${baseUrl}/api/admin/releases/upload?${channelParams}`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/octet-stream" },
        body: channelInstaller
      });
    };
    assert.strictEqual((await uploadChannelVersion("stable-v2")).status, 201);
    assert.strictEqual((await uploadChannelVersion("stable")).status, 201);
    assert.strictEqual((await uploadChannelVersion("stable-v2")).status, 409);
    const v2Latest = await fetch(`${baseUrl}/api/app-updates/latest?channel=stable-v2&platform=win32&arch=x64&current=1.0.1`);
    assert.strictEqual(v2Latest.status, 200);
    const v2Envelope = await v2Latest.json();
    const v2Release = JSON.parse(Buffer.from(v2Envelope.signed, "base64url").toString("utf8"));
    assert.strictEqual(v2Release.internalVersion, "1.0.2");
    assert.strictEqual(v2Release.channel, "stable-v2");
    const publicVersionDownload = await fetch(`${baseUrl}/download/1.0.2`, { headers: { range: "bytes=0-127" } });
    assert.strictEqual(publicVersionDownload.status, 206);
    assert.strictEqual((await publicVersionDownload.arrayBuffer()).byteLength, 128);
    const publicLatestDownload = await fetch(`${baseUrl}/download/latest`, { headers: { range: "bytes=0-127" } });
    assert.strictEqual(publicLatestDownload.status, 206);
    assert.strictEqual((await publicLatestDownload.arrayBuffer()).byteLength, 128);

    const fileName = "先马·AI Studio Setup 1.0.2.exe";
    const installer = crypto.randomBytes(4096);
    const params = new URLSearchParams({
      displayVersion: "1.0.2",
      internalVersion: "1.4.55",
      title: "测试发布",
      notes: Buffer.from("修复测试问题", "utf8").toString("base64url"),
      force: "0",
      fileName,
      channel: "stable",
      platform: "win32",
      arch: "x64"
    });
    const upload = await fetch(`${baseUrl}/api/admin/releases/upload?${params}`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/octet-stream" },
      body: installer
    });
    const uploadText = await upload.text();
    assert.strictEqual(upload.status, 201, uploadText);
    const uploaded = JSON.parse(uploadText);

    const latestResponse = await fetch(`${baseUrl}/api/app-updates/latest?channel=stable&platform=win32&arch=x64&current=1.4.54`);
    assert.strictEqual(latestResponse.status, 200);
    const envelope = await latestResponse.json();
    const signed = Buffer.from(envelope.signed, "base64url");
    assert.strictEqual(crypto.verify(null, signed, publicKey, Buffer.from(envelope.signature, "base64url")), true);
    const release = JSON.parse(signed.toString("utf8"));
    assert.strictEqual(release.internalVersion, "1.4.55");
    assert.strictEqual(release.sha256, crypto.createHash("sha256").update(installer).digest("hex"));

    const download = await fetch(new URL(release.downloadPath, `${baseUrl}/`), { headers: { range: "bytes=0-127" } });
    assert.strictEqual(download.status, 206);
    assert.strictEqual((await download.arrayBuffer()).byteLength, 128);

    const revoke = await fetch(`${baseUrl}/api/admin/releases/${encodeURIComponent(uploaded.release.releaseId)}/revoke`, { method: "POST", headers: adminHeaders });
    assert.strictEqual(revoke.status, 200);
    const remove = await fetch(`${baseUrl}/api/admin/releases/${encodeURIComponent(uploaded.release.releaseId)}/delete`, { method: "POST", headers: adminHeaders });
    assert.strictEqual(remove.status, 200);
    assert.strictEqual(fs.existsSync(path.join(dataRoot, "files", uploaded.release.releaseId)), false);
    const releasesAfterDelete = await fetch(`${baseUrl}/api/admin/releases`, { headers: adminHeaders });
    const deletedRelease = (await releasesAfterDelete.json()).releases.find((release) => release.releaseId === uploaded.release.releaseId);
    assert.strictEqual(deletedRelease.status, "deleted");
    const noUpdate = await fetch(`${baseUrl}/api/app-updates/latest?channel=stable&platform=win32&arch=x64&current=1.4.54`);
    assert.strictEqual(noUpdate.status, 204);
    const reuploadAfterDelete = await fetch(`${baseUrl}/api/admin/releases/upload?${params}`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/octet-stream" },
      body: installer
    });
    assert.strictEqual(reuploadAfterDelete.status, 201, await reuploadAfterDelete.text());

    const chunkedInstaller = crypto.randomBytes(10 * 1024 * 1024 + 137);
    const chunkedMetadata = {
      displayVersion: "1.0.3",
      internalVersion: "1.4.56",
      title: "分片上传测试",
      notes: "验证断点续传",
      force: false,
      fileName: "先马·AI Studio Setup 1.0.3.exe",
      fileSize: chunkedInstaller.length,
      fileFingerprint: crypto.createHash("sha256").update(chunkedInstaller.subarray(0, 1024)).digest("hex"),
      channel: "stable",
      platform: "win32",
      arch: "x64"
    };
    const browserStyleMetadata = {
      ...chunkedMetadata,
      internalVersion: "1.4.57",
      fileName: "XMAI Studio Setup 2.0.0.exe",
      fileSize: 231944438,
      fileFingerprint: "XMAI Studio Setup 2.0.0.exe-231944438-0"
    };
    const browserStyleUpload = await fetch(`${baseUrl}/api/admin/releases/uploads`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify(browserStyleMetadata)
    });
    const browserStyleUploadBody = await browserStyleUpload.json();
    assert.strictEqual(browserStyleUpload.status, 201, JSON.stringify(browserStyleUploadBody));
    fs.rmSync(path.join(dataRoot, "uploads", browserStyleUploadBody.uploadId), { recursive: true, force: true });
    const initializeUpload = async (resumeId = "") => {
      const response = await fetch(`${baseUrl}/api/admin/releases/uploads`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ...chunkedMetadata, resumeId })
      });
      const text = await response.text();
      assert.strictEqual(response.status, 201, text);
      return JSON.parse(text);
    };
    const uploadSession = await initializeUpload();
    assert.strictEqual(uploadSession.chunkCount, 2);
    const putChunk = async (index) => {
      const start = index * uploadSession.chunkSize;
      const chunk = chunkedInstaller.subarray(start, Math.min(chunkedInstaller.length, start + uploadSession.chunkSize));
      const response = await fetch(`${baseUrl}/api/admin/releases/uploads/${uploadSession.uploadId}/chunks/${index}`, {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/octet-stream", "content-length": String(chunk.length) },
        body: chunk,
        duplex: "half"
      });
      const text = await response.text();
      assert.strictEqual(response.status, 200, text);
    };
    await putChunk(0);
    await putChunk(0);
    const resumedSession = await initializeUpload(uploadSession.uploadId);
    assert.deepStrictEqual(resumedSession.uploadedChunks, [0]);
    await putChunk(1);
    const completedResponse = await fetch(`${baseUrl}/api/admin/releases/uploads/${uploadSession.uploadId}/complete`, {
      method: "POST",
      headers: adminHeaders
    });
    const completedText = await completedResponse.text();
    assert.strictEqual(completedResponse.status, 201, completedText);
    const completed = JSON.parse(completedText);
    assert.strictEqual(completed.release.size, chunkedInstaller.length);
    assert.strictEqual(completed.release.sha256, crypto.createHash("sha256").update(chunkedInstaller).digest("hex"));

    const chunkedLatest = await fetch(`${baseUrl}/api/app-updates/latest?channel=stable&platform=win32&arch=x64&current=1.4.55`);
    assert.strictEqual(chunkedLatest.status, 200);
    const chunkedEnvelope = await chunkedLatest.json();
    const chunkedPayload = JSON.parse(Buffer.from(chunkedEnvelope.signed, "base64url").toString("utf8"));
    assert.strictEqual(chunkedPayload.internalVersion, "1.4.56");
    process.stdout.write("update service smoke test passed\n");
  } finally {
    child.kill();
    mapmsServer.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (errors) process.stderr.write(errors);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
