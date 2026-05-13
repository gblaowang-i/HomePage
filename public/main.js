const state = {
  links: [],
  activeCategory: "全部"
};
const SITE_TITLE_KEY = "home_site_title";
const TONE_STORAGE = "home_tone_preset";
const TONE_PRESETS = [
  { id: "graywhite", label: "灰白色" },
  { id: "black", label: "黑色" },
  { id: "white", label: "白色" }
];
const DEFAULT_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='4' fill='%23cbd5e1'/%3E%3Cpath fill='%23475569' d='M8 8h8v8H8z'/%3E%3C/svg%3E";

function apiUrl(path) {
  if (!path || path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  const key = "/admin/";
  const i = location.pathname.indexOf(key);
  if (i > 0) return location.pathname.slice(0, i) + p;
  if (location.pathname.endsWith(".html")) {
    const last = location.pathname.lastIndexOf("/");
    if (last > 0) return location.pathname.slice(0, last) + p;
  }
  const norm = location.pathname.replace(/\/+$/, "") || "/";
  if (norm !== "/" && p.startsWith("/api/")) {
    return norm + p;
  }
  return p;
}

function applyTone(id) {
  const ok = TONE_PRESETS.some((preset) => preset.id === id);
  const key = ok ? id : "graywhite";
  document.documentElement.dataset.theme = key;
  try {
    localStorage.setItem(TONE_STORAGE, key);
  } catch {
    // ignore
  }
}

function renderToneOptions(select) {
  select.innerHTML = "";
  for (const preset of TONE_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    select.appendChild(option);
  }
}

function initToneControls() {
  const select = document.getElementById("toneSelect");
  if (!select) return;
  renderToneOptions(select);
  let initial = "graywhite";
  try {
    const saved = localStorage.getItem(TONE_STORAGE);
    if (saved && TONE_PRESETS.some((p) => p.id === saved)) {
      initial = saved;
    }
  } catch {
    // ignore
  }
  select.value = initial;
  applyTone(initial);
  select.addEventListener("change", () => applyTone(select.value));
}

async function loadSiteTitle() {
  try {
    const response = await fetch(apiUrl("/api/settings"), { cache: "no-store" });
    if (!response.ok) return;
    const raw = await response.json();
    const siteTitle =
      raw && raw.siteTitle && String(raw.siteTitle).trim()
        ? String(raw.siteTitle).trim()
        : "家用导航中心";
    const h1 = document.getElementById("siteTitle");
    if (h1) h1.textContent = siteTitle;
    document.title = siteTitle;
    try {
      localStorage.setItem(SITE_TITLE_KEY, siteTitle);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

const ORDER_KEY = "home_links_order_v1";
let dragFromId = null;

function getSavedOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function saveOrder(ids) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
}

function sortBySavedOrder(items) {
  const order = getSavedOrder();
  if (!order.length) {
    return items;
  }
  const rank = new Map(order.map((id, idx) => [id, idx]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Number.POSITIVE_INFINITY;
    const rb = rank.has(b.id) ? rank.get(b.id) : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return (a.order || 0) - (b.order || 0);
  });
}

function ensureOrderContainsAll() {
  const order = getSavedOrder();
  const existing = new Set(order);
  const appended = [];
  for (const item of state.links) {
    if (item?.id && !existing.has(String(item.id))) {
      appended.push(String(item.id));
    }
  }
  if (appended.length) {
    saveOrder(order.concat(appended));
  }
}

function withCategory(item) {
  return {
    ...item,
    category: item.category && String(item.category).trim() ? String(item.category).trim() : "未分类"
  };
}

function renderCategories() {
  const bar = document.getElementById("categoryBar");
  const categories = ["全部", ...new Set(state.links.map((item) => item.category))];
  bar.innerHTML = "";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = `category-chip ${category === state.activeCategory ? "active" : ""}`;
    button.textContent = category;
    button.addEventListener("click", () => {
      state.activeCategory = category;
      renderCategories();
      renderLinks();
    });
    bar.appendChild(button);
  });
}

function renderLinks() {
  const grid = document.getElementById("linkGrid");
  const filtered =
    state.activeCategory === "全部"
      ? state.links
      : state.links.filter((item) => item.category === state.activeCategory);
  const links = sortBySavedOrder(filtered);

  if (!links.length) {
    grid.innerHTML = '<div class="empty">该分类下暂无导航项。</div>';
    return;
  }

  grid.innerHTML = "";
  for (const item of links) {
    const card = document.createElement("a");
    card.className = "link-card";
    card.href = item.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.draggable = true;
    card.dataset.id = String(item.id);

    card.addEventListener("dragstart", (event) => {
      dragFromId = String(item.id);
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragFromId);
    });
    card.addEventListener("dragend", () => {
      dragFromId = null;
      card.classList.remove("dragging");
      grid.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const toId = String(item.id);
      const fromId = dragFromId || event.dataTransfer.getData("text/plain");
      if (!fromId || fromId === toId) return;

      const current = getSavedOrder();
      const ids = current.length ? [...current] : state.links.map((x) => String(x.id));

      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;

      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);
      saveOrder(ids);
      renderLinks();
    });

    const icon = document.createElement("img");
    icon.src = item.icon;
    icon.alt = item.name;
    icon.onerror = () => {
      icon.onerror = null;
      icon.src = DEFAULT_ICON;
    };

    const text = document.createElement("span");
    text.textContent = item.name;

    card.appendChild(icon);
    card.appendChild(text);
    grid.appendChild(card);
  }
}

async function loadLinks() {
  const grid = document.getElementById("linkGrid");
  grid.innerHTML = '<div class="empty">加载中...</div>';

  try {
    const response = await fetch(apiUrl("/api/links"), { cache: "no-store" });
    if (!response.ok) {
      throw new Error("接口请求失败");
    }
    const links = await response.json();
    state.links = links.map(withCategory);
    ensureOrderContainsAll();

    if (!state.links.length) {
      grid.innerHTML = '<div class="empty">暂无导航项，请先在后台添加。</div>';
      document.getElementById("categoryBar").innerHTML = "";
      return;
    }

    renderCategories();
    renderLinks();
  } catch (error) {
    grid.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

initToneControls();
loadSiteTitle();
loadLinks();
