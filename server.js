const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const SESSION_TOKEN = crypto.randomBytes(24).toString("hex");
const SITE_PASSWORD = String(process.env.SITE_PASSWORD || "").trim();
const VIEWER_AUTH_ENABLED = Boolean(SITE_PASSWORD);
const VIEWER_SESSION_TOKEN = VIEWER_AUTH_ENABLED ? crypto.randomBytes(24).toString("hex") : "";
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");
const BASE_PATH = (process.env.BASE_PATH || "").replace(/^\/+|\/+$/g, "");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true";
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
const MAX_JSON_BODY_BYTES = Math.min(
  Math.max(Number(process.env.MAX_JSON_BODY_BYTES) || 262144, 4096),
  2 * 1024 * 1024
);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

function withSecurityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

function normalizeRequestPathname(rawPathname) {
  let p;
  try {
    p = decodeURIComponent(rawPathname);
  } catch {
    p = rawPathname;
  }
  p = p.replace(/\/+/g, "/");
  if (BASE_PATH) {
    const prefix = `/${BASE_PATH}`;
    if (p === prefix || p.startsWith(`${prefix}/`)) {
      p = p.slice(prefix.length) || "/";
    }
  }
  while (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  if (!p.startsWith("/")) {
    p = `/${p.replace(/^\/+/, "")}`;
  }
  return p || "/";
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      acc[key] = decodeURIComponent(val);
    } catch {
      acc[key] = val;
    }
    return acc;
  }, {});
}

function isAuthed(req) {
  return parseCookies(req).admin_token === SESSION_TOKEN;
}

function isViewerAuthed(req) {
  if (!VIEWER_AUTH_ENABLED) return true;
  return parseCookies(req).site_token === VIEWER_SESSION_TOKEN;
}

function viewerLocationPath(internalPath) {
  const p = internalPath.startsWith("/") ? internalPath : `/${internalPath}`;
  if (!BASE_PATH) return p;
  const base = `/${BASE_PATH}`.replace(/\/+/g, "/");
  const suffix = p === "/" ? "" : p;
  return (base + suffix).replace(/\/+/g, "/") || "/";
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      return xff.split(",")[0].trim();
    }
  }
  return req.socket?.remoteAddress || "unknown";
}

const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 12;
const loginRateByIp = new Map();

function pruneLoginRateIfNeeded() {
  if (loginRateByIp.size < 2000) return;
  const now = Date.now();
  for (const [ip, v] of loginRateByIp) {
    if (now - v.start > LOGIN_RATE_WINDOW_MS * 2) loginRateByIp.delete(ip);
  }
}

function loginRateAllowed(ip) {
  pruneLoginRateIfNeeded();
  const now = Date.now();
  const e = loginRateByIp.get(ip);
  if (!e) return true;
  if (now - e.start > LOGIN_RATE_WINDOW_MS) {
    loginRateByIp.delete(ip);
    return true;
  }
  return e.fails < LOGIN_MAX_FAILS;
}

function loginRateOnFail(ip) {
  const now = Date.now();
  let e = loginRateByIp.get(ip);
  if (!e || now - e.start > LOGIN_RATE_WINDOW_MS) {
    loginRateByIp.set(ip, { start: now, fails: 1 });
  } else {
    e.fails += 1;
  }
}

function loginRateOnSuccess(ip) {
  loginRateByIp.delete(ip);
}

function timingSafeEqualPassword(input, expected) {
  if (typeof expected !== "string" || !expected.length) return false;
  const a = crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

function resolveSafeFile(rootDir, urlPath) {
  const rel = String(urlPath || "").replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const resolved = path.resolve(rootDir, rel);
  const relToRoot = path.relative(rootDir, resolved);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) return null;
  return resolved;
}

async function readData() {
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.links)) {
    data.links = [];
  }
  const st =
    data.settings &&
    typeof data.settings === "object" &&
    data.settings.siteTitle &&
    String(data.settings.siteTitle).trim()
      ? String(data.settings.siteTitle).trim()
      : "家用导航中心";
  data.settings = { siteTitle: st };
  return data;
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeLink(item, fallbackOrder = 1) {
  return {
    ...item,
    category:
      item.category && String(item.category).trim() ? String(item.category).trim() : "未分类",
    order: Number(item.order) || fallbackOrder
  };
}

function sortedLinksFromData(data) {
  return data.links
    .map((item, index) => normalizeLink(item, index + 1))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

const COOKIE_BASE = COOKIE_SECURE
  ? "HttpOnly; SameSite=Lax; Path=/; Secure"
  : "HttpOnly; SameSite=Lax; Path=/";

function sessionCookie(name, value, maxAge) {
  if (maxAge === 0) {
    return `${name}=; ${COOKIE_BASE}; Max-Age=0`;
  }
  return `${name}=${value}; ${COOKIE_BASE}; Max-Age=${maxAge}`;
}

function json(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(
    statusCode,
    withSecurityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    })
  );
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, content, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, withSecurityHeaders({ "Content-Type": contentType }));
  res.end(content);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon"
  };
  return map[ext] || "application/octet-stream";
}

async function readRawUtf8(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.code = "PAYLOAD_TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").replace(/^\uFEFF/, "");
}

async function readBody(req) {
  let raw;
  try {
    raw = await readRawUtf8(req);
  } catch (e) {
    if (e && e.code === "PAYLOAD_TOO_LARGE") throw e;
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw.trim());
  } catch {
    return {};
  }
}

async function serveFile(res, filePath) {
  try {
    const content = await fs.readFile(filePath);
    text(res, 200, content, getContentType(filePath));
  } catch {
    text(res, 404, "Not Found");
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectSiteTitleIntoIndexHtml(html, siteTitle) {
  const esc = escapeHtml(siteTitle);
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc}</title>`);
  out = out.replace(/<h1 id="siteTitle">[^<]*<\/h1>/, `<h1 id="siteTitle">${esc}</h1>`);
  return out;
}

async function serveIndexHtml(res) {
  try {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    const [raw, data] = await Promise.all([fs.readFile(indexPath, "utf-8"), readData()]);
    const body = injectSiteTitleIntoIndexHtml(raw, data.settings.siteTitle);
    res.writeHead(
      200,
      withSecurityHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      })
    );
    res.end(body);
  } catch (err) {
    console.error(err);
    text(res, 500, "Internal Server Error");
  }
}

async function handleApi(req, res, pathname) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "POST" && pathname === "/api/site-auth/login") {
    if (!VIEWER_AUTH_ENABLED) {
      return json(res, 400, { message: "未配置站点访问密码" });
    }
    const ip = clientIp(req);
    if (!loginRateAllowed(ip)) {
      return json(res, 429, { message: "尝试过于频繁，请稍后再试" });
    }
    const body = await readBody(req);
    if (!timingSafeEqualPassword(body.password, SITE_PASSWORD)) {
      loginRateOnFail(ip);
      return json(res, 401, { message: "密码错误" });
    }
    loginRateOnSuccess(ip);
    const maxAge = 60 * 60 * 24 * 30;
    return json(
      res,
      200,
      { message: "ok" },
      { "Set-Cookie": sessionCookie("site_token", VIEWER_SESSION_TOKEN, maxAge) }
    );
  }

  if (method === "POST" && pathname === "/api/site-auth/logout") {
    return json(res, 200, { message: "ok" }, { "Set-Cookie": sessionCookie("site_token", "", 0) });
  }

  if (method === "GET" && pathname === "/api/site-auth/status") {
    return json(res, 200, {
      enabled: VIEWER_AUTH_ENABLED,
      loggedIn: VIEWER_AUTH_ENABLED ? isViewerAuthed(req) : false
    });
  }

  if (method === "GET" && pathname === "/api/settings") {
    if (VIEWER_AUTH_ENABLED && !isViewerAuthed(req)) {
      return json(res, 401, { message: "Unauthorized" });
    }
    try {
      const data = await readData();
      return json(res, 200, data.settings);
    } catch {
      return json(res, 500, { message: "Failed to read settings." });
    }
  }

  if (method === "GET" && pathname === "/api/links") {
    if (VIEWER_AUTH_ENABLED && !isViewerAuthed(req)) {
      return json(res, 401, { message: "Unauthorized" });
    }
    try {
      const data = await readData();
      return json(res, 200, sortedLinksFromData(data));
    } catch {
      return json(res, 500, { message: "Failed to read links." });
    }
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const ip = clientIp(req);
    if (!loginRateAllowed(ip)) {
      return json(res, 429, { message: "尝试过于频繁，请稍后再试" });
    }
    const body = await readBody(req);
    if (!timingSafeEqualPassword(body.password, ADMIN_PASSWORD)) {
      loginRateOnFail(ip);
      return json(res, 401, { message: "密码错误" });
    }
    loginRateOnSuccess(ip);
    return json(
      res,
      200,
      { message: "登录成功" },
      { "Set-Cookie": sessionCookie("admin_token", SESSION_TOKEN, 28800) }
    );
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    return json(res, 200, { message: "已退出登录" }, { "Set-Cookie": sessionCookie("admin_token", "", 0) });
  }

  if (method === "GET" && pathname === "/api/auth/check") {
    if (!isAuthed(req)) {
      return json(res, 401, { message: "Unauthorized" });
    }
    return json(res, 200, { ok: true });
  }

  if (!isAuthed(req) && pathname.startsWith("/api/admin/")) {
    return json(res, 401, { message: "Unauthorized" });
  }

  if (method === "GET" && pathname === "/api/admin/settings") {
    try {
      const data = await readData();
      return json(res, 200, data.settings);
    } catch {
      return json(res, 500, { message: "Failed to read settings." });
    }
  }

  if (method === "PUT" && pathname === "/api/admin/settings") {
    try {
      const body = await readBody(req);
      const data = await readData();
      const siteTitle =
        body.siteTitle && String(body.siteTitle).trim()
          ? String(body.siteTitle).trim()
          : "家用导航中心";
      data.settings = { siteTitle };
      await writeData(data);
      return json(res, 200, data.settings);
    } catch (err) {
      console.error(err);
      return json(res, 500, { message: "保存失败" });
    }
  }

  if (method === "GET" && pathname === "/api/admin/links") {
    try {
      const data = await readData();
      return json(res, 200, sortedLinksFromData(data));
    } catch {
      return json(res, 500, { message: "Failed to read links." });
    }
  }

  if (method === "POST" && pathname === "/api/admin/links") {
    try {
      const body = await readBody(req);
      const { name, url, icon, order, category } = body;
      if (!name || !url || !icon) {
        return json(res, 400, { message: "名称、URL、图标为必填项" });
      }
      const data = await readData();
      const item = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        url: String(url).trim(),
        icon: String(icon).trim(),
        category: category ? String(category).trim() : "未分类",
        order: Number(order) || data.links.length + 1
      };
      data.links.push(item);
      await writeData(data);
      return json(res, 201, item);
    } catch {
      return json(res, 500, { message: "创建失败" });
    }
  }

  const matchId = pathname.match(/^\/api\/admin\/links\/([^/]+)$/);
  if (method === "PUT" && matchId) {
    try {
      const id = decodeURIComponent(matchId[1]);
      const body = await readBody(req);
      const data = await readData();
      const index = data.links.findIndex((item) => item.id === id);
      if (index === -1) {
        return json(res, 404, { message: "未找到该链接" });
      }
      data.links[index] = {
        ...data.links[index],
        name: String(body.name || data.links[index].name).trim(),
        url: String(body.url || data.links[index].url).trim(),
        icon: String(body.icon || data.links[index].icon).trim(),
        category: body.category
          ? String(body.category).trim()
          : data.links[index].category || "未分类",
        order: Number(body.order) || data.links[index].order || index + 1
      };
      await writeData(data);
      return json(res, 200, data.links[index]);
    } catch {
      return json(res, 500, { message: "更新失败" });
    }
  }

  if (method === "DELETE" && matchId) {
    try {
      const id = decodeURIComponent(matchId[1]);
      const data = await readData();
      const nextLinks = data.links.filter((item) => item.id !== id);
      if (nextLinks.length === data.links.length) {
        return json(res, 404, { message: "未找到该链接" });
      }
      data.links = nextLinks;
      await writeData(data);
      return json(res, 200, { message: "删除成功" });
    } catch {
      return json(res, 500, { message: "删除失败" });
    }
  }

  return json(res, 404, { message: "Not Found" });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = normalizeRequestPathname(requestUrl.pathname);

  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      if (err && err.code === "PAYLOAD_TOO_LARGE") {
        json(res, 413, { message: "请求体过大" });
      } else {
        console.error(err);
        json(res, 500, { message: "服务器错误" });
      }
    }
    return;
  }

  if (pathname === "/gate.html") {
    if (!VIEWER_AUTH_ENABLED) {
      res.writeHead(302, withSecurityHeaders({ Location: viewerLocationPath("/") }));
      res.end();
      return;
    }
    const gatePath = resolveSafeFile(PUBLIC_DIR, "gate.html");
    if (!gatePath) {
      text(res, 400, "Bad Request");
      return;
    }
    await serveFile(res, gatePath);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    if (VIEWER_AUTH_ENABLED && !isViewerAuthed(req)) {
      const from = pathname === "/index.html" ? "/index.html" : "/";
      const dest = viewerLocationPath(`/gate.html?from=${encodeURIComponent(from)}`);
      res.writeHead(302, withSecurityHeaders({ Location: dest }));
      res.end();
      return;
    }
    await serveIndexHtml(res);
    return;
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    const loginPath = resolveSafeFile(ADMIN_DIR, "login.html");
    if (!loginPath) {
      text(res, 500, "Internal Server Error");
      return;
    }
    await serveFile(res, loginPath);
    return;
  }

  if (pathname.startsWith("/admin/")) {
    const requested = pathname.replace("/admin/", "");
    const adminPath = resolveSafeFile(ADMIN_DIR, requested);
    if (!adminPath) {
      text(res, 400, "Bad Request");
      return;
    }
    await serveFile(res, adminPath);
    return;
  }

  const requested = pathname.replace(/^\/+/, "");
  const publicPath = resolveSafeFile(PUBLIC_DIR, requested);
  if (!publicPath) {
    text(res, 400, "Bad Request");
    return;
  }
  await serveFile(res, publicPath);
});

server.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}  DATA_FILE=${DATA_FILE}`);
  if (VIEWER_AUTH_ENABLED) {
    console.log("已启用站点访问密码 SITE_PASSWORD（与 ADMIN_PASSWORD 独立）");
  }
  if (COOKIE_SECURE) {
    console.log("Cookie 已启用 Secure（COOKIE_SECURE，需 HTTPS）");
  }
  if (TRUST_PROXY) {
    console.log("已信任反向代理 IP（TRUST_PROXY，登录限速使用 X-Forwarded-For）");
  }
});
