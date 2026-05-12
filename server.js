const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const SESSION_TOKEN = crypto.randomBytes(24).toString("hex");
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");
const BASE_PATH = (process.env.BASE_PATH || "").replace(/^\/+|\/+$/g, "");

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
    const [key, ...valueParts] = part.trim().split("=");
    acc[key] = decodeURIComponent(valueParts.join("="));
    return acc;
  }, {});
}

function isAuthed(req) {
  return parseCookies(req).admin_token === SESSION_TOKEN;
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

function json(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, content, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
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
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").replace(/^\uFEFF/, "");
}

async function readBody(req) {
  const raw = await readRawUtf8(req);
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

async function handleApi(req, res, pathname) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET" && pathname === "/api/settings") {
    try {
      const data = await readData();
      return json(res, 200, data.settings);
    } catch {
      return json(res, 500, { message: "Failed to read settings." });
    }
  }

  if (method === "GET" && pathname === "/api/links") {
    try {
      const data = await readData();
      const links = data.links
        .map((item, index) => normalizeLink(item, index + 1))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      return json(res, 200, links);
    } catch {
      return json(res, 500, { message: "Failed to read links." });
    }
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    if (body.password !== ADMIN_PASSWORD) {
      return json(res, 401, { message: "密码错误" });
    }
    return json(
      res,
      200,
      { message: "登录成功" },
      { "Set-Cookie": `admin_token=${SESSION_TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` }
    );
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    return json(
      res,
      200,
      { message: "已退出登录" },
      { "Set-Cookie": "admin_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }
    );
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
      const links = data.links
        .map((item, index) => normalizeLink(item, index + 1))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      return json(res, 200, links);
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
    await handleApi(req, res, pathname);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    await serveFile(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    await serveFile(res, path.join(ADMIN_DIR, "login.html"));
    return;
  }

  if (pathname.startsWith("/admin/")) {
    const requested = pathname.replace("/admin/", "");
    await serveFile(res, path.join(ADMIN_DIR, requested));
    return;
  }

  const requested = pathname.replace(/^\/+/, "");
  await serveFile(res, path.join(PUBLIC_DIR, requested));
});

server.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}  DATA_FILE=${DATA_FILE}`);
});
