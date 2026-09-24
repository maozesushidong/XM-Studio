const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const expectedVersion = require("./package.json").version;

const runId = Date.now().toString(36);
const userDataDir = path.join(__dirname, "build", `smoke-dingtalk-${runId}`);
const configPath = path.join(userDataDir, "dingtalk-config.json");
const callbackPort = 22000 + (process.pid % 5000) * 2;
const mockPort = callbackPort + 1;
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  clientId: "mock-client",
  clientSecret: "mock-secret",
  corpId: "mock-corp",
  redirectUri: `http://127.0.0.1:${callbackPort}/dingtalk/callback`,
  scope: "openid corpid",
  prompt: "consent",
  loginMode: "embedded",
  embeddedQr: true,
  loginScriptUrl: `http://127.0.0.1:${mockPort}/ddlogin.js`,
  useSystemBrowser: true,
  enforceCorpId: true,
  authUrl: `http://127.0.0.1:${mockPort}/oauth2/auth`,
  tokenUrl: `http://127.0.0.1:${mockPort}/oauth2/token`,
  userInfoUrl: `http://127.0.0.1:${mockPort}/contact/users/me`,
  appAccessTokenUrl: `http://127.0.0.1:${mockPort}/app-access-token`,
  userByUnionIdUrl: `http://127.0.0.1:${mockPort}/user-by-unionid`
}, null, 2), "utf8");

app.setPath("userData", userDataDir);
process.env.XIANMA_USER_DATA = userDataDir;
process.env.XIANMA_DINGTALK_CONFIG = configPath;
process.env.XIANMA_ENABLE_TELEMETRY = "1";
process.env.XIANMA_TELEMETRY_BASE_URL = `http://127.0.0.1:${mockPort}`;

let refreshCalls = 0;
let sawOfficialTokenHeader = false;
let authPageCalls = 0;
let telemetryRegistration = null;
let telemetryHeartbeats = 0;
const telemetryEvents = [];
let mapmsSyncCalls = 0;
let mapmsAuthorizationCalls = 0;
let enterpriseUserLookups = 0;
let mapmsAuthorizationAllowed = true;

const mockServer = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${mockPort}`);
  if (url.pathname === "/api/desktop/register" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      telemetryRegistration = JSON.parse(body || "{}");
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ sessionToken: "mock-telemetry-token", heartbeatIntervalSeconds: 60 }));
    });
    return;
  }
  if (url.pathname === "/api/desktop/heartbeat" && request.method === "POST") {
    telemetryHeartbeats += 1;
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === "/api/desktop/events" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      telemetryEvents.push(...(JSON.parse(body || "{}").events || []));
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (url.pathname === "/api/desktop/mapms/register" && request.method === "POST") {
    mapmsSyncCalls += 1;
    response.writeHead(request.headers.authorization === "Bearer mock-telemetry-token" ? 200 : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(request.headers.authorization === "Bearer mock-telemetry-token"
      ? { ok: true, status: "synced", mapmsUserId: 5001 }
      : { error: "unauthorized" }));
    return;
  }
  if (url.pathname === "/api/desktop/mapms/authorize" && request.method === "POST") {
    mapmsAuthorizationCalls += 1;
    const authenticated = request.headers.authorization === "Bearer mock-telemetry-token";
    response.writeHead(authenticated ? (mapmsAuthorizationAllowed ? 200 : 403) : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(!authenticated
      ? { error: "unauthorized" }
      : (mapmsAuthorizationAllowed
        ? { allowed: true, mapmsUserId: 5001, departmentId: 1001 }
        : { error: "当前账号已被管理员禁用，请联系管理员", code: "MAPMS_USER_DISABLED" })));
    return;
  }
  if (url.pathname === "/ddlogin.js") {
    authPageCalls += 1;
    response.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    if (authPageCalls === 1) {
      response.end("window.DTFrameLogin=(_frame,_params,_success,error)=>setTimeout(()=>error('Application does not exist'),0);");
    } else {
      response.end("window.DTFrameLogin=(_frame,params,success)=>setTimeout(()=>{const target=new URL(decodeURIComponent(params.redirect_uri));target.searchParams.set('authCode','mock-auth-code');target.searchParams.set('state',params.state||'');success({redirectUrl:target.toString(),authCode:'mock-auth-code',state:params.state||''});},0);");
    }
    return;
  }
  if (url.pathname === "/oauth2/auth") {
    const redirect = new URL(url.searchParams.get("redirect_uri"));
    redirect.searchParams.set("authCode", "mock-auth-code");
    redirect.searchParams.set("state", url.searchParams.get("state") || "");
    response.writeHead(302, { Location: redirect.toString() });
    response.end();
    return;
  }

  if (url.pathname === "/oauth2/token" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      if (payload.clientId !== "mock-client" || payload.clientSecret !== "mock-secret") {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: "invalid client" }));
        return;
      }
      if (payload.grantType === "refresh_token") refreshCalls += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        accessToken: payload.grantType === "refresh_token" ? "mock-access-refreshed" : "mock-access",
        refreshToken: "mock-refresh",
        expireIn: 7200,
        corpId: "mock-corp"
      }));
    });
    return;
  }

  if (url.pathname === "/app-access-token" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const allowed = payload.appKey === "mock-client" && payload.appSecret === "mock-secret";
      response.writeHead(allowed ? 200 : 401, { "Content-Type": "application/json" });
      response.end(JSON.stringify(allowed ? { accessToken: "mock-app-access" } : { message: "invalid app" }));
    });
    return;
  }

  if (url.pathname === "/user-by-unionid" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      enterpriseUserLookups += 1;
      const payload = JSON.parse(body || "{}");
      const allowed = url.searchParams.get("access_token") === "mock-app-access" && payload.unionid === "mock-union-id";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(allowed
        ? { errcode: 0, errmsg: "ok", result: { userid: "mock-enterprise-user-id" } }
        : { errcode: 400, errmsg: "invalid unionid" }));
    });
    return;
  }

  if (url.pathname === "/contact/users/me") {
    sawOfficialTokenHeader = Boolean(request.headers["x-acs-dingtalk-access-token"]);
    response.writeHead(sawOfficialTokenHeader ? 200 : 401, { "Content-Type": "application/json" });
    response.end(JSON.stringify(sawOfficialTokenHeader
      ? { unionId: "mock-union-id", nick: "模拟钉钉用户", avatarUrl: "https://example.invalid/avatar.png" }
      : { message: "missing token header" }));
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs))
  ]);
}

mockServer.listen(mockPort, "127.0.0.1", () => {
  require("./electron/main.js");
});

app.whenReady().then(async () => {
  await delay(300);
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) throw new Error("主窗口未创建");
  if (mainWindow.webContents.isLoading()) {
    await withTimeout(new Promise((resolve) => mainWindow.webContents.once("did-finish-load", resolve)), "页面加载");
  }

  const initialStatus = await mainWindow.webContents.executeJavaScript("window.desktopBridge.getDingtalkSession()");
  if (initialStatus?.loginMode !== "embedded") throw new Error("钉钉登录没有使用应用内模式");

  let missingAppMessage = "";
  try {
    await withTimeout(
      mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogin()"),
      "钉钉错误页识别"
    );
  } catch (error) {
    missingAppMessage = String(error?.message || error);
  }
  if (!missingAppMessage.includes("开发配置 > 安全设置")) throw new Error("未识别钉钉应用不存在错误");

  const loginSession = await withTimeout(
    mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogin()"),
    "钉钉授权"
  );
  if (loginSession?.userId !== "mock-union-id") throw new Error("登录用户标识不正确");
  for (let attempt = 0; attempt < 40 && !telemetryRegistration; attempt += 1) await delay(50);
  if (telemetryRegistration?.userId !== "mock-union-id" || telemetryRegistration?.dingtalkUserId !== "mock-enterprise-user-id" || telemetryRegistration?.appVersion !== expectedVersion || telemetryRegistration?.internalVersion !== expectedVersion || !telemetryRegistration?.deviceId) {
    throw new Error(`使用统计登记不正确：${JSON.stringify(telemetryRegistration)}`);
  }
  for (let attempt = 0; attempt < 40 && mapmsSyncCalls < 1; attempt += 1) await delay(50);
  if (mapmsSyncCalls !== 1) throw new Error("钉钉登录后没有触发 MAPMS 用户同步");
  if (mapmsAuthorizationCalls !== 1) throw new Error("钉钉登录后没有完成 MAPMS 登录权限校验");
  if (enterpriseUserLookups !== 1) throw new Error("没有解析钉钉企业 userid");

  const sessionPath = path.join(userDataDir, "dingtalk-sessions.json");
  const sessionText = fs.readFileSync(sessionPath, "utf8");
  if (sessionText.includes("mock-access") || sessionText.includes("mock-refresh")) {
    throw new Error("钉钉令牌未加密保存");
  }

  const store = JSON.parse(sessionText);
  store.users["mock-union-id"].expiresAt = 0;
  fs.writeFileSync(sessionPath, JSON.stringify(store, null, 2), "utf8");
  const restored = await withTimeout(
    mainWindow.webContents.executeJavaScript("window.desktopBridge.getDingtalkSession()"),
    "免登刷新"
  );
  if (restored?.session?.userId !== "mock-union-id" || refreshCalls !== 1) {
    throw new Error("免登刷新未生效");
  }

  await mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogout()");
  for (let attempt = 0; attempt < 40 && !telemetryEvents.some((event) => event.type === "logout"); attempt += 1) await delay(50);
  const afterLogout = await mainWindow.webContents.executeJavaScript("window.desktopBridge.getDingtalkSession()");
  if (afterLogout?.session) throw new Error("退出后仍存在登录会话");
  if (!telemetryEvents.some((event) => event.type === "login") || !telemetryEvents.some((event) => event.type === "logout")) {
    throw new Error(`登录统计事件不完整：${JSON.stringify(telemetryEvents)}`);
  }

  mapmsAuthorizationAllowed = false;
  let deniedLoginMessage = "";
  try {
    await withTimeout(
      mainWindow.webContents.executeJavaScript("window.desktopBridge.dingtalkLogin()"),
      "禁用用户登录校验"
    );
  } catch (error) {
    deniedLoginMessage = String(error?.message || error);
  }
  if (!deniedLoginMessage.includes("管理员禁用")) throw new Error(`禁用用户未被拦截：${deniedLoginMessage}`);
  const deniedStore = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  if (deniedStore.currentUserId) throw new Error("禁用用户登录失败后仍保留自动登录会话");

  process.stdout.write(`${JSON.stringify({
    loginUserId: loginSession.userId,
    restoredUserId: restored.session.userId,
    refreshCalls,
    sawOfficialTokenHeader,
    encryptedAtRest: true,
    logoutCleared: true,
    embeddedLogin: true,
    embeddedQr: true,
    missingAppErrorMapped: true
    ,telemetryRegistered: true
    ,telemetryHeartbeats
    ,telemetryEvents: telemetryEvents.map((event) => event.type)
    ,mapmsSyncCalls
    ,mapmsAuthorizationCalls
    ,enterpriseUserLookups
    ,disabledLoginBlocked: true
    ,deniedSessionCleared: true
  })}\n`);
  mockServer.close();
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  mockServer.close();
  app.exit(1);
});
