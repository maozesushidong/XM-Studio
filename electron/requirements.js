"use strict";
function registerRequirements({ ipcMain, getFlavor, getIdentity }) {
  let cached = null;
  ipcMain.handle("desktop:build-flavor", () => { const flavor = getFlavor(); return { test: flavor.flavor === "requirement-preview", name: "XMAI Studio 测试版" }; });
  ipcMain.handle("desktop:requirement-request", async (_event, payload = {}) => {
    try {
      const flavor = getFlavor();
      if (flavor.flavor !== "requirement-preview" || !/^http:\/\/47\.96\.184\.148\/studio-v11-[\w-]+$/.test(flavor.baseUrl)) throw new Error("需求提报仅在独立测试版启用");
      const route = String(payload.route || "");
      if (!/^(current|analyze|operations\/[\w-]+|save|discard|recover|confirm-summary|submit|close-resolved|close-out-of-scope|mine(?:\?[^#]*)?|REQ-\d{8}-\d{3})$/.test(route)) throw new Error("需求接口无效");
      const method = payload.method === "POST" ? "POST" : "GET";
      let identity;
      try { identity = await getIdentity(); }
      catch { throw Object.assign(new Error("登录信息已失效，请退出并重新登录钉钉"), { code: "LOGIN_REQUIRED" }); }
      if (!identity?.accessToken || !identity.userId) throw Object.assign(new Error("请先登录钉钉"), { code: "LOGIN_REQUIRED" });
      async function fetchJson(endpoint, body, token) {
        const response = await fetch(`${flavor.baseUrl}/api/desktop/requirements/${endpoint}`, { method: body ? "POST" : "GET", signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const value = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(value.error || `请求失败（${response.status}）`), { code: value.code, status: response.status });
        return value;
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!cached || cached.userId !== identity.userId || Date.parse(cached.expiresAt) < Date.now() + 60000) cached = { ...await fetchJson("session", { accessToken: identity.accessToken }), userId: identity.userId };
        try { return { data: await fetchJson(route, method === "POST" ? payload.body : null, cached.token) }; }
        catch (e) { if (e.status === 401 && attempt === 0) { cached = null; continue; } throw e; }
      }
    } catch (e) { return { error: e.name === "TimeoutError" ? "请求超时，输入可能已保存，请重试恢复" : e.message, code: e.code || "REQUEST_FAILED" }; }
  });
}
module.exports = { registerRequirements };
