/**
 * 地球卫星全息镜像 · ORBITAL MIRROR
 * ui.js — 全息 HUD 控制器（契约 §4）
 *
 * export function createUI(handlers) -> ui
 * 纯原生 DOM；所有 handlers 调用前判空；高频方法内部节流。
 * 只读写 public/index.html 已提供的元素 id / class，不重建主树。
 */

/* ---------- 常量表 ---------- */

const ORBIT_DEFS = [
  { key: "LEO", label: "LEO 低轨", color: "#5ef0ff" },
  { key: "MEO", label: "MEO 中轨", color: "#7ea8ff" },
  { key: "GEO", label: "GEO 静止", color: "#ff5ea8" },
  { key: "HEO", label: "HEO 高椭圆", color: "#c08bff" },
  { key: "OTHER", label: "OTHER 其他", color: "#6f8b99" }
];

const SPEED_DEFS = [
  { value: 0, label: "暂停" },
  { value: 1, label: "×1" },
  { value: 10, label: "×10" },
  { value: 60, label: "×60" },
  { value: 600, label: "×600" },
  { value: 3600, label: "×3600" }
];

const LAYER_DEFS = [
  { key: "orbits", label: "轨道线" },
  { key: "grid", label: "经纬网" },
  { key: "atmosphere", label: "大气辉光" },
  { key: "autoRotate", label: "自动旋转" },
  { key: "labels", label: "标签" }
];

const STAT_DEFS = [
  { key: "total", label: "卫星总数", en: "TOTAL" },
  { key: "rendered", label: "当前渲染", en: "RENDERED" },
  { key: "countryCount", label: "国家 / 组织", en: "NATIONS" },
  { key: "activeCount", label: "在轨运行", en: "ACTIVE" }
];

/* V2 任务类型（契约 §8.6 固定色值，必须与 main.js 同值） */
const CATEGORY_DEFS = [
  { key: "comms", label: "通信 / 互联网", labelEn: "Communications", short: "通信", color: "#5ef0ff" },
  { key: "nav", label: "导航 / 定位", labelEn: "Navigation", short: "导航", color: "#ffd166" },
  { key: "eo", label: "对地观测 / 遥感", labelEn: "Earth Observation", short: "对地观测", color: "#4ade80" },
  { key: "mil", label: "军事 / 侦察", labelEn: "Military & Recon", short: "军事", color: "#ff5ea8" },
  { key: "weather", label: "气象 / 海洋 / 环境", labelEn: "Weather & Ocean", short: "气象", color: "#7dd3fc" },
  { key: "science", label: "科学 / 深空 / 载人", labelEn: "Science & Human", short: "科学", color: "#a78bfa" },
  { key: "tech", label: "技术试验 / 教育 / 业余", labelEn: "Tech Demo & Education", short: "技术试验", color: "#f97316" },
  { key: "other", label: "其他 / 未分类", labelEn: "Other", short: "其他", color: "#6b8ea3" }
];

const CATEGORY_INDEX = new Map(CATEGORY_DEFS.map(function (def) { return [def.key, def]; }));

const CONFIDENCE_TAGS = { medium: "中置信", low: "低置信" };

/* V3 观测（契约 §12/§13） */
const OBSERVER_CITIES = ["北京", "上海", "广州", "深圳", "成都", "西安", "杭州", "南京", "武汉", "哈尔滨", "乌鲁木齐", "拉萨"];

const TIER_SHORT = { naked: "肉眼", binocular: "双筒", telescope: "望远镜" };
const TIER_FULL = { naked: "肉眼可见", binocular: "双筒可见", telescope: "望远镜跟踪" };

const VIEWING_FIELDS = [
  { key: "el", label: "仰角 EL" },
  { key: "az", label: "方位 AZ" },
  { key: "range", label: "距离 RANGE" },
  { key: "sunlit", label: "照亮 SUNLIT" },
  { key: "mag", label: "估算星等 MAG", full: true }
];

const SOURCE_LABELS = {
  celestrak: "CELESTRAK 在线",
  cache: "本地缓存 CACHE",
  snapshot: "内置快照 SNAPSHOT",
  local: "本地合成 LOCAL"
};

const OBJECT_TYPE_LABELS = {
  PAY: "载荷 PAY",
  "R/B": "箭体 R/B",
  DEB: "碎片 DEB",
  UNK: "未知 UNK"
};

const STATUS_LABELS = {
  "+": "在轨运行",
  P: "部分运行",
  B: "备份（不跟踪）",
  S: "备用",
  X: "已失效",
  "": "未知"
};

const FALLBACK_COLORS = ["#5ef0ff", "#4ad7ff", "#7ea8ff", "#c08bff", "#ff5ea8"];
const COUNTRY_LIMIT = 120;
const CJK_RE = /[\u3400-\u9fff]/;

/** 芯片标题：label 已含中文时不再拼接 labelZh，避免 300px 面板溢出 */
function chipLabel(label, labelZh, fallback) {
  const base = label || fallback || "";
  if (!base) return "";
  if (labelZh && !CJK_RE.test(base)) return base + " " + labelZh;
  return base;
}

/** 任务类型芯片用短名（"通信 / 互联网" → "通信"），完整名放 title/aria-label */
function shortCategoryLabel(label, fallback) {
  const text = String(label || fallback || "").trim();
  if (!text) return "";
  const head = text.split(" / ")[0].trim();
  return head || text;
}

/* ---------- 工具函数 ---------- */

function byId(id) {
  return document.getElementById(id);
}

/** 内联 SVG favicon（data URI），避免浏览器自动请求 /favicon.ico 产生 404 */
function ensureFavicon() {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[rel~="icon"]')) return;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#03070d"/>' +
    '<circle cx="16" cy="16" r="8" fill="none" stroke="#5ef0ff" stroke-width="1.6"/>' +
    '<ellipse cx="16" cy="16" rx="12" ry="4.5" fill="none" stroke="#5ef0ff" stroke-width="1" opacity=".7" transform="rotate(-24 16 16)"/>' +
    '<circle cx="16" cy="16" r="1.8" fill="#5ef0ff"/>' +
    '</svg>';
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  document.head.appendChild(link);
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function fmtInt(value) {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtNum(value, digits) {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits == null ? 1 : digits);
}

function isNum(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function setText(el, value) {
  if (!el) return;
  const s = value === null || value === undefined ? "" : String(value);
  if (el.textContent !== s) el.textContent = s;
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * 尾随节流：首次调用延迟到下一帧（≤ min 间隔），
 * 期间只保留最后一次参数，保证最终状态不丢失。
 */
function throttle(fn, minInterval) {
  let timer = 0;
  let lastRun = 0;
  let pendingArgs = null;
  const run = () => {
    timer = 0;
    lastRun = performance.now();
    const args = pendingArgs || [];
    pendingArgs = null;
    fn.apply(null, args);
  };
  return function throttled() {
    pendingArgs = Array.prototype.slice.call(arguments);
    if (timer) return;
    const wait = Math.max(0, minInterval - (performance.now() - lastRun));
    timer = setTimeout(run, wait);
  };
}

function formatClockTime(input) {
  if (input === null || input === undefined || input === "") return "--:--:--";
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return "--:--:--";
    return pad2(input.getHours()) + ":" + pad2(input.getMinutes()) + ":" + pad2(input.getSeconds());
  }
  if (typeof input === "number" && Number.isFinite(input)) {
    return formatClockTime(new Date(input));
  }
  const str = String(input);
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  return str.length > 14 ? str.slice(0, 14) : str;
}

function formatUpdated(input) {
  if (input === null || input === undefined || input === "") return "--:--";
  let d = null;
  if (input instanceof Date) d = input;
  else if (typeof input === "number") d = new Date(input);
  else {
    const parsed = new Date(String(input));
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || Number.isNaN(d.getTime())) {
    const s = String(input);
    return s.length > 16 ? s.slice(11, 16) : s;
  }
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/** 纬度/经度 → "39.90N 116.41E" */
function fmtCoord(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return "--";
  return Math.abs(la).toFixed(2) + (la >= 0 ? "N" : "S") + " " + Math.abs(lo).toFixed(2) + (lo >= 0 ? "E" : "W");
}

function fmtLocalHHMM(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "--:--";
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function fmtDuration(sec) {
  const total = Math.round(Number(sec));
  if (!Number.isFinite(total) || total <= 0) return "--";
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return seconds + " 秒";
  return minutes + " 分" + (seconds ? pad2(seconds) + " 秒" : "");
}

function isPassLive(item, now) {
  if (!item) return false;
  if (item.live) return true;
  const start = Number(item.startAt);
  if (!Number.isFinite(start)) return false;
  const end = start + (Number(item.durationSec) || 0) * 1000;
  return now >= start && now <= end;
}

/** 过境倒计时文案：「正在过境」/「N 分钟后」/「已结束」 */
function passCountdown(item, now) {
  const start = Number(item && item.startAt);
  if (!Number.isFinite(start)) return "--";
  const end = start + (Number(item && item.durationSec) || 0) * 1000;
  if (isPassLive(item, now)) return "正在过境";
  if (now > end) return "已结束";
  const minutes = Math.ceil((start - now) / 60000);
  if (minutes <= 1) return "<1 分钟后";
  if (minutes < 60) return minutes + " 分钟后";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours + " 小时后" + (rest ? " " + rest + " 分" : "");
}

/* ---------- 主入口 ---------- */

export function createUI(handlers) {
  const h = handlers || {};

  const refs = {
    dataStatus: byId("data-status"),
    dataSource: byId("data-source"),
    dataUpdated: byId("data-updated"),
    refreshBtn: byId("refresh-btn"),
    perf: byId("perf"),
    fps: byId("fps"),
    renderCount: byId("render-count"),
    totalCount: byId("total-count"),
    dataError: byId("data-error"),

    panelLeft: byId("panel-left"),
    panelRight: byId("panel-right"),
    btnCollapseLeft: byId("btn-collapse-left"),
    btnCollapseRight: byId("btn-collapse-right"),

    searchInput: byId("search-input"),
    searchClear: byId("search-clear"),
    searchHint: byId("search-hint"),

    orbitChips: byId("orbit-chips"),
    categoryChips: byId("category-chips"),
    countryList: byId("country-list"),
    countryClear: byId("country-clear"),

    statGrid: byId("stat-grid"),
    orbitBars: byId("orbit-bars"),
    categoryBars: byId("category-bars"),
    countryBars: byId("country-bars"),
    statsBlock: byId("stats-block"),
    detailBlock: byId("detail-block"),
    satDetail: byId("sat-detail"),
    detailClose: byId("detail-close"),

    btnPlay: byId("btn-play"),
    btnNow: byId("btn-now"),
    clockUtc: byId("clock-utc"),
    clockLocal: byId("clock-local"),
    clockTag: byId("clock-tag"),
    speedBtns: byId("speed-btns"),
    layerBar: byId("layer-bar"),

    loading: byId("loading"),
    loadingSub: byId("loading-sub"),
    loadingProgress: byId("loading-progress"),

    toast: byId("toast")
  };

  /* 状态 */
  const orbitChips = new Map();
  const orbitEnabled = new Map();
  const speedBtns = new Map();
  const layerBtns = new Map();
  const layerEnabled = new Map();
  const statValues = new Map();
  const orbitBars = new Map();
  const categoryChips = new Map();
  const categoryBars = new Map();
  const countryBars = new Map();
  const countryIndex = new Map();
  const activeCountry = new Map();

  let detailRefs = null;
  let currentTle = "";
  let lastCountrySignature = "";
  let lastOrbitBarKeys = "";
  let lastCategoryBarKeys = "";
  let lastCountryBarKeys = "";
  let countryFiltered = false;
  let orbitFiltering = false;
  let categoryFiltering = false;
  let userInteracted = false;
  let autoCollapsed = false;
  let searchTimer = 0;
  let toastTimer = 0;

  /* V3 观测状态 */
  const obsEl = {
    pane: null, tabs: null, tabOverview: null, tabObserve: null, chip: null, chipLabel: null,
    current: null, locateBtn: null, citySelect: null, latInput: null, lonInput: null, applyBtn: null, clearBtn: null,
    visibleList: null, visibleCount: null, passList: null, passCount: null, focusInput: null,
    viewing: null, viewingTier: null, viewingNext: null
  };
  const obsData = {
    observer: null,
    observing: false,
    visible: [],
    passes: [],
    detail: null,
    tab: "overview",
    lastDetailId: null,
    visibleSig: "",
    passSig: "",
    visibleRows: new Map(),
    passRows: new Map(),
    viewingFields: new Map()
  };
  let countdownTimer = 0;

  const mediaQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 900px)")
    : null;

  function callHandler(name) {
    const fn = h[name];
    if (typeof fn !== "function") return;
    const args = Array.prototype.slice.call(arguments, 1);
    fn.apply(h, args);
  }

  function isNarrow() {
    return mediaQuery ? mediaQuery.matches : window.innerWidth <= 900;
  }

  /* ---------- 面板折叠 ---------- */

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;
    panel.classList.toggle("collapsed", !!collapsed);
    const tab = panel.querySelector(".panel-tab");
    if (tab) tab.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (collapsed) panel.setAttribute("data-collapsed", "1");
    else panel.removeAttribute("data-collapsed");
  }

  function expandPanel(panel) {
    if (panel && panel.classList.contains("collapsed")) setPanelCollapsed(panel, false);
  }

  function togglePanel(panel, other) {
    if (!panel) return;
    const wasCollapsed = panel.classList.contains("collapsed");
    setPanelCollapsed(panel, !wasCollapsed);
    if (wasCollapsed) {
      if (isNarrow() && other) setPanelCollapsed(other, true);
      userInteracted = true;
      autoCollapsed = false;
    }
  }

  function syncViewport() {
    if (isNarrow()) {
      setPanelCollapsed(refs.panelLeft, true);
      setPanelCollapsed(refs.panelRight, true);
      autoCollapsed = true;
    } else if (autoCollapsed) {
      setPanelCollapsed(refs.panelLeft, false);
      setPanelCollapsed(refs.panelRight, false);
      autoCollapsed = false;
    }
  }

  /* ---------- 构建：轨道芯片 ---------- */

  function createOrbitChip(key, item) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "chip orbit-chip";
    el.dataset.orbit = key;
    el.style.setProperty("--chip-color", (item && item.color) || "#5ef0ff");

    const dot = document.createElement("span");
    dot.className = "c-dot";

    const label = document.createElement("span");
    label.className = "chip-label";

    const count = document.createElement("span");
    count.className = "chip-count";
    count.textContent = "--";

    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(count);

    el.addEventListener("click", function () {
      handleOrbitClick(key);
    });

    if (refs.orbitChips) refs.orbitChips.appendChild(el);
    const entry = { el: el, label: label, count: count };
    orbitChips.set(key, entry);
    orbitEnabled.set(key, true);
    return entry;
  }

  function setOrbitVisual(key, on) {
    const entry = orbitChips.get(key);
    if (!entry) return;
    entry.el.classList.toggle("active", !!on);
    entry.el.setAttribute("aria-pressed", on ? "true" : "false");
    orbitEnabled.set(key, !!on);
  }

  /**
   * 轨道芯片与 main.js 的 Set 语义对齐：
   * filters.orbits 为空 = 全部显示，非空 = 只显示集合内轨道。
   * 因此「全部激活」时点击 = 只看这一种（向空集合 add），已筛选时点击 = 加入/移出。
   */
  function handleOrbitClick(key) {
    const entry = orbitChips.get(key);
    if (!entry) return;
    const active = entry.el.classList.contains("active");
    const filtering = orbitFiltering;
    const enabled = filtering ? !active : true;

    if (!filtering) {
      orbitChips.forEach(function (value, orbitKey) {
        setOrbitVisual(orbitKey, orbitKey === key);
      });
      orbitFiltering = true;
    } else {
      setOrbitVisual(key, enabled);
      let anyOff = false;
      orbitChips.forEach(function (value) {
        if (!value.el.classList.contains("active")) anyOff = true;
      });
      orbitFiltering = anyOff;
    }
    callHandler("onOrbitToggle", key, enabled);
  }

  function buildOrbitChips() {
    if (!refs.orbitChips) return;
    ORBIT_DEFS.forEach(function (def) {
      const entry = createOrbitChip(def.key, def);
      entry.el.classList.add("active");
      entry.el.setAttribute("aria-pressed", "true");
      setText(entry.label, def.label);
      entry.el.title = def.label;
    });
  }

  /* ---------- 构建：任务类型（V2） ---------- */

  /**
   * 左栏「任务类型」区块：index.html 仍是 V1 骨架时由 ui.js 动态插入
   * （放在「轨道类型」区块之后、「国家 / 组织」之前），已存在则复用。
   */
  function ensureCategorySection() {
    let container = byId("category-chips");
    if (!container) {
      const orbitSection = refs.orbitChips && refs.orbitChips.closest
        ? refs.orbitChips.closest(".panel-block")
        : null;
      const section = document.createElement("section");
      section.className = "panel-block";
      section.id = "category-block";

      const title = document.createElement("h3");
      title.className = "panel-title";
      const tick = document.createElement("span");
      tick.className = "tick";
      title.appendChild(tick);
      title.appendChild(document.createTextNode("任务类型 "));
      const en = document.createElement("span");
      en.className = "en";
      en.textContent = "MISSION";
      title.appendChild(en);

      container = document.createElement("div");
      container.id = "category-chips";
      container.className = "chips category-chips";

      section.appendChild(title);
      section.appendChild(container);

      if (orbitSection && orbitSection.parentNode) {
        orbitSection.parentNode.insertBefore(section, orbitSection.nextSibling);
      } else if (refs.panelLeft) {
        const inner = refs.panelLeft.querySelector(".panel-inner");
        if (inner) inner.appendChild(section);
      }
    } else if (!container.classList.contains("category-chips")) {
      container.classList.add("category-chips");
    }
    return container;
  }

  /**
   * 右栏「任务类型分布」条形区：插入在轨道条形之后、国家条形之前。
   */
  function ensureCategoryBars() {
    let container = byId("category-bars");
    if (!container) {
      const orbitBarsEl = refs.orbitBars;
      const parent = orbitBarsEl ? orbitBarsEl.parentNode : null;
      if (!parent) return null;

      const subtitle = document.createElement("div");
      subtitle.className = "panel-subtitle";
      subtitle.id = "category-subtitle";
      subtitle.appendChild(document.createTextNode("任务类型分布 "));
      const en = document.createElement("span");
      en.className = "en";
      en.textContent = "BY MISSION";
      subtitle.appendChild(en);

      container = document.createElement("div");
      container.id = "category-bars";
      container.className = "bars category-bars";

      const anchor = orbitBarsEl.nextSibling;
      parent.insertBefore(subtitle, anchor);
      parent.insertBefore(container, anchor);
    } else if (!container.classList.contains("bars")) {
      container.classList.add("bars");
      container.classList.add("category-bars");
    }
    return container;
  }

  function createCategoryChip(def) {
    const key = def.key;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "chip category-chip active";
    el.dataset.category = key;
    el.setAttribute("aria-pressed", "true");
    el.style.setProperty("--chip-color", def.color || "#6b8ea3");

    const dot = document.createElement("span");
    dot.className = "c-dot";
    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = def.short || def.label || key;
    const count = document.createElement("span");
    count.className = "chip-count";
    count.textContent = "--";

    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(count);
    el.title = (def.label || key) + (def.labelEn ? " · " + def.labelEn : "");

    el.addEventListener("click", function () {
      handleCategoryClick(key);
    });

    if (refs.categoryChips) refs.categoryChips.appendChild(el);
    return { el: el, label: label, count: count };
  }

  function buildCategoryChips() {
    if (!refs.categoryChips) return;
    const frag = document.createDocumentFragment();
    CATEGORY_DEFS.forEach(function (def) {
      const entry = createCategoryChip(def);
      categoryChips.set(def.key, entry);
      frag.appendChild(entry.el);
    });
    refs.categoryChips.replaceChildren(frag);
  }

  function setCategoryVisual(key, on) {
    const entry = categoryChips.get(key);
    if (!entry) return;
    entry.el.classList.toggle("active", !!on);
    entry.el.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /**
   * 与 main.js 的 Set 语义对齐（同轨道芯片）：
   * filters.categories 为空 = 全部显示；非空 = 只显示集合内类型。
   * 全部激活时点击 = 只看该类型（向空集合 add），已筛选时点击 = 加入 / 移出。
   */
  function handleCategoryClick(key) {
    const entry = categoryChips.get(key);
    if (!entry) return;
    const active = entry.el.classList.contains("active");
    const filtering = categoryFiltering;
    const enabled = filtering ? !active : true;

    if (!filtering) {
      categoryChips.forEach(function (value, categoryKey) {
        setCategoryVisual(categoryKey, categoryKey === key);
      });
      categoryFiltering = true;
    } else {
      setCategoryVisual(key, enabled);
      let anyOff = false;
      categoryChips.forEach(function (value) {
        if (!value.el.classList.contains("active")) anyOff = true;
      });
      categoryFiltering = anyOff;
    }
    callHandler("onCategoryToggle", key, enabled);
  }

  function rebuildCategoryBars(list) {
    if (!refs.categoryBars) return;
    categoryBars.clear();
    const frag = document.createDocumentFragment();
    list.forEach(function (item) {
      if (!item || !item.key) return;
      const def = CATEGORY_INDEX.get(item.key);
      const entry = buildBarRow(false, item.label || (def && def.label) || item.key);
      entry.row.dataset.key = item.key;
      categoryBars.set(item.key, entry);
      frag.appendChild(entry.row);
    });
    refs.categoryBars.replaceChildren(frag);
    lastCategoryBarKeys = list.map(function (i) { return i && i.key; }).join(",");
  }

  function renderCategoryBars(list) {
    if (!Array.isArray(list) || !refs.categoryBars) return;
    const keys = list.map(function (i) { return i && i.key; }).join(",");
    if (keys !== lastCategoryBarKeys) rebuildCategoryBars(list);

    let max = 1;
    list.forEach(function (i) { max = Math.max(max, Number(i && i.count) || 0); });

    list.forEach(function (item) {
      if (!item || !item.key) return;
      const entry = categoryBars.get(item.key);
      if (!entry) return;
      const def = CATEGORY_INDEX.get(item.key);
      const name = item.label || (def && def.label) || item.key;
      const count = Number(item.count) || 0;
      setText(entry.name, name);
      setText(entry.count, item.count === null || item.count === undefined ? "--" : fmtInt(item.count));
      entry.row.style.setProperty("--bar-color", (def && def.color) || item.color || "#6b8ea3");
      entry.fill.style.width = clampPct(count / max * 100).toFixed(1) + "%";
      entry.row.title = name + " · " + (item.count === null || item.count === undefined ? "--" : fmtInt(item.count));
    });
  }

  function updateCategoryChip(item) {
    if (!item || !item.key) return;
    const def = CATEGORY_INDEX.get(item.key);
    let chip = categoryChips.get(item.key);
    if (!chip) {
      chip = createCategoryChip(def || { key: item.key, label: item.label, color: item.color });
      categoryChips.set(item.key, chip);
    }
    const full = item.label || (def && def.label) || item.key;
    const en = item.labelEn || (def && def.labelEn) || "";
    setText(chip.label, shortCategoryLabel(full, def && def.short));
    setText(chip.count, fmtInt(item.count));
    chip.el.style.setProperty("--chip-color", (def && def.color) || item.color || "#6b8ea3");
    const active = item.active !== false;
    chip.el.classList.toggle("active", active);
    chip.el.setAttribute("aria-pressed", active ? "true" : "false");
    chip.el.title = full + (en ? " · " + en : "") + " · " + fmtInt(item.count);
    chip.el.setAttribute("aria-label", full + " · " + fmtInt(item.count) + (en ? " · " + en : ""));
  }

  /* ---------- 构建：时间倍速 ---------- */

  function buildSpeedButtons() {
    if (!refs.speedBtns) return;
    const frag = document.createDocumentFragment();
    SPEED_DEFS.forEach(function (def) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "chip speed";
      el.dataset.speed = String(def.value);
      el.textContent = def.label;
      el.title = def.value === 0 ? "暂停时间" : "时间流速 ×" + def.value;
      el.addEventListener("click", function () {
        setActiveSpeed(def.value);
        if (def.value === 0) {
          if (typeof h.onSpeed === "function") callHandler("onSpeed", 0);
          else callHandler("onPlayToggle");
        } else {
          callHandler("onSpeed", def.value);
        }
      });
      speedBtns.set(def.value, el);
      frag.appendChild(el);
    });
    refs.speedBtns.replaceChildren(frag);
  }

  function setActiveSpeed(value) {
    speedBtns.forEach(function (el, key) {
      const on = key === value;
      el.classList.toggle("active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------- 构建：图层开关 ---------- */

  function buildLayerButtons() {
    if (!refs.layerBar) return;
    const frag = document.createDocumentFragment();
    LAYER_DEFS.forEach(function (def) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "chip layer active";
      el.dataset.layer = def.key;
      el.setAttribute("aria-pressed", "true");
      el.title = def.label + " 显示 / 隐藏";

      const led = document.createElement("span");
      led.className = "led";
      const label = document.createElement("span");
      label.textContent = def.label;

      el.appendChild(led);
      el.appendChild(label);
      el.addEventListener("click", function () {
        const next = !el.classList.contains("active");
        el.classList.toggle("active", next);
        el.setAttribute("aria-pressed", next ? "true" : "false");
        layerEnabled.set(def.key, next);
        callHandler("onLayerToggle", def.key, next);
      });

      layerEnabled.set(def.key, true);
      layerBtns.set(def.key, el);
      frag.appendChild(el);
    });
    refs.layerBar.replaceChildren(frag);
  }

  /* ---------- 构建：统计网格 ---------- */

  function buildStatGrid() {
    if (!refs.statGrid) return;
    const frag = document.createDocumentFragment();
    STAT_DEFS.forEach(function (def) {
      const cell = document.createElement("div");
      cell.className = "stat-cell";

      const label = document.createElement("span");
      label.className = "stat-label";
      label.textContent = def.label;
      label.title = def.en;

      const value = document.createElement("span");
      value.className = "stat-value";
      value.textContent = "--";
      value.setAttribute("aria-live", "polite");

      cell.appendChild(label);
      cell.appendChild(value);
      frag.appendChild(cell);
      statValues.set(def.key, value);
    });
    refs.statGrid.replaceChildren(frag);
  }

  /* ---------- 构建：条形图 ---------- */

  function buildBarRow(clickable, label) {
    const row = document.createElement(clickable ? "button" : "div");
    if (clickable) {
      row.type = "button";
      row.className = "bar-row bar-row-btn";
      row.title = label || "";
    } else {
      row.className = "bar-row";
    }

    const head = document.createElement("span");
    head.className = "bar-head";
    const name = document.createElement("span");
    name.className = "bar-name";
    const count = document.createElement("span");
    count.className = "bar-count";
    count.textContent = "--";
    head.appendChild(name);
    head.appendChild(count);

    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("i");
    fill.className = "bar-fill";
    track.appendChild(fill);

    row.appendChild(head);
    row.appendChild(track);

    return { row: row, name: name, count: count, fill: fill };
  }

  function rebuildOrbitBars(list) {
    if (!refs.orbitBars) return;
    orbitBars.clear();
    const frag = document.createDocumentFragment();
    list.forEach(function (item) {
      if (!item || !item.key) return;
      const entry = buildBarRow(false, item.label || item.key);
      orbitBars.set(item.key, entry);
      frag.appendChild(entry.row);
    });
    refs.orbitBars.replaceChildren(frag);
    lastOrbitBarKeys = list.map(function (i) { return i && i.key; }).join(",");
  }

  function rebuildCountryBars(list) {
    if (!refs.countryBars) return;
    countryBars.clear();
    const frag = document.createDocumentFragment();
    list.forEach(function (item) {
      if (!item || !item.code) return;
      const entry = buildBarRow(true, item.name || item.code);
      entry.row.dataset.code = item.code;
      countryBars.set(item.code, entry);
      frag.appendChild(entry.row);
    });
    refs.countryBars.replaceChildren(frag);
    lastCountryBarKeys = list.map(function (i) { return i && i.code; }).join(",");
  }

  function renderOrbitBars(list) {
    if (!Array.isArray(list) || !refs.orbitBars) return;
    const keys = list.map(function (i) { return i && i.key; }).join(",");
    if (keys !== lastOrbitBarKeys) rebuildOrbitBars(list);
    let max = 1;
    list.forEach(function (i) { max = Math.max(max, Number(i && i.count) || 0); });
    list.forEach(function (item) {
      if (!item || !item.key) return;
      const entry = orbitBars.get(item.key);
      if (!entry) return;
      const count = Number(item.count) || 0;
      setText(entry.name, item.label || item.key);
      setText(entry.count, fmtInt(item.count));
      if (item.color) entry.row.style.setProperty("--bar-color", item.color);
      entry.fill.style.width = clampPct(count / max * 100).toFixed(1) + "%";
      entry.row.title = (item.label || item.key) + " · " + fmtInt(item.count);
    });
  }

  function renderCountryBars(list) {
    if (!Array.isArray(list) || !refs.countryBars) return;
    const keys = list.map(function (i) { return i && i.code; }).join(",");
    if (keys !== lastCountryBarKeys) rebuildCountryBars(list);
    let max = 1;
    list.forEach(function (i) { max = Math.max(max, Number(i && i.count) || 0); });
    list.forEach(function (item) {
      if (!item || !item.code) return;
      const entry = countryBars.get(item.code);
      if (!entry) return;
      const count = Number(item.count) || 0;
      const pct = isNum(item.pct) ? Number(item.pct) : count / max * 100;
      const label = String(item.flag || "") + " " + String(item.name || item.code);
      setText(entry.name, label.trim());
      setText(entry.count, fmtInt(item.count));
      if (item.color) entry.row.style.setProperty("--bar-color", item.color);
      entry.fill.style.width = clampPct(pct).toFixed(1) + "%";
      entry.row.title = (item.name || item.code) + " · " + fmtInt(item.count);
      entry.row.classList.toggle("active", countryFiltered && activeCountry.get(item.code) === true);
    });
  }

  /* ---------- 构建：详情卡 ---------- */

  const DETAIL_FIELDS = [
    { key: "alt", label: "高度 ALT" },
    { key: "speed", label: "速度 VEL" },
    { key: "period", label: "周期 PERIOD" },
    { key: "incl", label: "倾角 INCL" },
    { key: "perigee", label: "近地点 PERI" },
    { key: "apogee", label: "远地点 APO" },
    { key: "lat", label: "纬度 LAT" },
    { key: "lon", label: "经度 LON" },
    { key: "country", label: "国家 / 组织", full: true },
    { key: "operator", label: "所属公司 / 机构", full: true },
    { key: "category", label: "任务类型", full: true, composite: true },
    { key: "type", label: "物体类型" },
    { key: "status", label: "运行状态" },
    { key: "orbit", label: "轨道类型" },
    { key: "launch", label: "发射日期", full: true },
    { key: "ids", label: "国际编号 / NORAD", full: true }
  ];

  function buildDetail() {
    if (!refs.satDetail) return;
    const fields = new Map();

    const head = document.createElement("div");
    head.className = "detail-head";

    const flag = document.createElement("span");
    flag.className = "detail-flag";
    flag.textContent = "🛰️";

    const nameWrap = document.createElement("div");
    nameWrap.className = "detail-name-wrap";
    const name = document.createElement("div");
    name.className = "detail-name";
    name.textContent = "--";
    const sub = document.createElement("div");
    sub.className = "detail-sub";
    sub.textContent = "--";
    nameWrap.appendChild(name);
    nameWrap.appendChild(sub);

    const badge = document.createElement("span");
    badge.className = "detail-badge";
    badge.textContent = "--";

    head.appendChild(flag);
    head.appendChild(nameWrap);
    head.appendChild(badge);

    const grid = document.createElement("div");
    grid.className = "detail-grid";
    const composite = new Map();
    DETAIL_FIELDS.forEach(function (def) {
      const row = document.createElement("div");
      row.className = def.full ? "d-field full" : "d-field";
      const k = document.createElement("span");
      k.className = "d-k";
      k.textContent = def.label;
      const v = document.createElement("span");
      v.className = "d-v";
      if (def.composite) {
        // 任务类型：值 + 置信度小标签（中置信 / 低置信）
        v.className = "d-v d-v-cat";
        const catLabel = document.createElement("span");
        catLabel.className = "cat-label";
        catLabel.textContent = "--";
        const conf = document.createElement("span");
        conf.className = "conf-tag";
        conf.hidden = true;
        v.appendChild(catLabel);
        v.appendChild(conf);
        composite.set(def.key, { label: catLabel, conf: conf });
      } else {
        v.textContent = "--";
      }
      row.appendChild(k);
      row.appendChild(v);
      grid.appendChild(row);
      fields.set(def.key, v);
    });

    const tle = document.createElement("div");
    tle.className = "detail-tle";
    const tleHead = document.createElement("div");
    tleHead.className = "tle-head";
    const tleLabel = document.createElement("span");
    tleLabel.textContent = "TLE · SGP4";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "tle-copy";
    copy.textContent = "复制";
    copy.title = "复制两行 TLE 根数";
    tleHead.appendChild(tleLabel);
    tleHead.appendChild(copy);
    const tleBody = document.createElement("div");
    tleBody.className = "tle-body";
    tleBody.textContent = "--";
    tle.appendChild(tleHead);
    tle.appendChild(tleBody);

    copy.addEventListener("click", copyTle);

    const viewing = document.createElement("div");
    viewing.id = "viewing-block";
    viewing.className = "viewing-block";
    viewing.hidden = true;

    const viewingHead = document.createElement("div");
    viewingHead.className = "viewing-head";
    const viewingTick = document.createElement("span");
    viewingTick.className = "tick";
    viewingHead.appendChild(viewingTick);
    viewingHead.appendChild(document.createTextNode("观看 "));
    const viewingEn = document.createElement("span");
    viewingEn.className = "en";
    viewingEn.textContent = "VIEWING";
    viewingHead.appendChild(viewingEn);
    const viewingTier = document.createElement("span");
    viewingTier.className = "tier tier-telescope";
    viewingTier.textContent = "—";
    viewingHead.appendChild(viewingTier);

    const viewingGrid = document.createElement("div");
    viewingGrid.className = "viewing-grid";
    const viewingFields = new Map();
    VIEWING_FIELDS.forEach(function (def) {
      const row = document.createElement("div");
      row.className = "v-field" + (def.full ? " full" : "");
      const k = document.createElement("span");
      k.className = "v-k";
      k.textContent = def.label;
      const v = document.createElement("span");
      v.className = "v-v";
      v.textContent = "--";
      row.appendChild(k);
      row.appendChild(v);
      viewingGrid.appendChild(row);
      viewingFields.set(def.key, v);
    });

    const viewingNext = document.createElement("div");
    viewingNext.className = "viewing-next";
    viewingNext.textContent = "下一次过境 --";

    viewing.appendChild(viewingHead);
    viewing.appendChild(viewingGrid);
    viewing.appendChild(viewingNext);

    const note = document.createElement("div");
    note.className = "detail-note";
    note.textContent = "任务类型按名称与目录规则推断";

    refs.satDetail.replaceChildren(head, grid, viewing, tle, note);
    obsEl.viewing = viewing;
    obsEl.viewingTier = viewingTier;
    obsEl.viewingNext = viewingNext;
    obsData.viewingFields = viewingFields;

    detailRefs = {
      flag: flag,
      name: name,
      sub: sub,
      badge: badge,
      fields: fields,
      composite: composite,
      viewing: viewing,
      tle: tleBody,
      note: note
    };
  }

  function renderDetail(detail) {
    if (!detailRefs) return;

    const d = detail || {};
    const country = d.country || {};

    setText(detailRefs.flag, country.flag || "🛰️");
    setText(detailRefs.name, d.name || "--");
    setText(
      detailRefs.sub,
      "NORAD " + fmtInt(d.id) + " · " + (d.intl || "--") + " · " + (d.owner || country.code || "--")
    );
    setText(detailRefs.badge, d.orbitClass || "--");

    const field = function (key, value, cls) {
      const el = detailRefs.fields.get(key);
      if (!el) return;
      setText(el, value);
      el.className = "d-v" + (cls ? " " + cls : "");
    };

    field("alt", isNum(d.altKm) ? fmtNum(d.altKm, 1) + " km" : "--");
    field("speed", isNum(d.speedKms) ? fmtNum(d.speedKms, 2) + " km/s" : "--");
    field("period", isNum(d.periodMin) ? fmtNum(d.periodMin, 1) + " min" : "--");
    field("incl", isNum(d.inclDeg) ? fmtNum(d.inclDeg, 2) + "°" : "--");
    field("perigee", isNum(d.perigeeKm) ? fmtInt(d.perigeeKm) + " km" : "--");
    field("apogee", isNum(d.apogeeKm) ? fmtInt(d.apogeeKm) + " km" : "--");
    field("lat", isNum(d.lat) ? fmtNum(d.lat, 2) + "°" : "--");
    field("lon", isNum(d.lon) ? fmtNum(d.lon, 2) + "°" : "--");

    const countryText = country.name
      ? (String(country.flag || "").trim() + " " + country.name).trim()
      : (d.owner || "--");
    field("country", countryText);

    // V2：所属公司 / 机构（缺字段显示 --）
    const operator = d.operator && typeof d.operator === "object" ? d.operator : {};
    const operatorText = String(
      operator.nameZh || operator.name || (typeof d.operator === "string" ? d.operator : "") || "--"
    );
    field("operator", operatorText);
    const operatorEl = detailRefs.fields.get("operator");
    if (operatorEl && operatorEl.title !== operatorText) operatorEl.title = operatorText;

    // V2：任务类型（label + 非 high 置信度小标签）
    const category = d.category && typeof d.category === "object" ? d.category : {};
    const categoryDef = CATEGORY_INDEX.get(category.key);
    const categoryText = String(
      category.label || (categoryDef && categoryDef.label) || (typeof d.category === "string" ? d.category : "") || "--"
    );
    const compositeRefs = detailRefs.composite && detailRefs.composite.get("category");
    if (compositeRefs) {
      setText(compositeRefs.label, categoryText);
      const confidence = String(category.confidence || "").toLowerCase();
      const tag = CONFIDENCE_TAGS[confidence];
      if (tag) {
        setText(compositeRefs.conf, tag);
        compositeRefs.conf.hidden = false;
        compositeRefs.conf.classList.toggle("is-low", confidence === "low");
      } else if (compositeRefs.conf.hidden !== true) {
        compositeRefs.conf.hidden = true;
        setText(compositeRefs.conf, "");
        compositeRefs.conf.classList.remove("is-low");
      }
      const categoryValue = detailRefs.fields.get("category");
      if (categoryValue) {
        const tip = category.note
          ? categoryText + " · " + String(category.note)
          : categoryText;
        if (categoryValue.title !== tip) categoryValue.title = tip;
      }
    }

    field("type", OBJECT_TYPE_LABELS[d.objectType] || d.objectType || "--");
    field(
      "status",
      d.statusText || STATUS_LABELS[d.status] || (d.status ? d.status : "--"),
      d.status === "+" ? "is-ok" : (d.status ? "is-warn" : "")
    );
    field(
      "orbit",
      (d.orbitClass || "--") + (d.orbitLabel ? " · " + d.orbitLabel : "")
    );
    field("launch", d.launchDate || "--");
    field("ids", (d.intl || "--") + " / " + (d.id != null ? fmtInt(d.id) : "--"));

    markObsSelected(d.name);

    const tleLines = [d.tle1, d.tle2].filter(function (line) { return typeof line === "string" && line; });
    currentTle = tleLines.join("\n");
    setText(detailRefs.tle, currentTle || "--");

    if (refs.detailBlock && refs.detailBlock.hidden) {
      refs.detailBlock.hidden = false;
      openDetailPanel();
      // 详情卡位于统计下方，首次出现时滚动让整卡进入可视区
      scrollDetailIntoView();
    }
  }

  function openDetailPanel() {
    expandPanel(refs.panelRight);
    if (isNarrow()) setPanelCollapsed(refs.panelLeft, true);
  }

  function scrollDetailIntoView() {
    const block = refs.detailBlock;
    if (!block || typeof block.scrollIntoView !== "function") return;
    requestAnimationFrame(function () {
      try {
        block.scrollIntoView({ block: "nearest", behavior: "auto" });
      } catch (err) {
        block.scrollIntoView();
      }
    });
  }

  function hideDetail() {
    if (refs.detailBlock) refs.detailBlock.hidden = true;
    obsData.detail = null;
    if (obsEl.viewing) obsEl.viewing.hidden = true;
    markObsSelected(null);
  }

  let closingDetail = false;

  function closeDetail() {
    hideDetail();
    if (typeof h.onSelectNone === "function") {
      callHandler("onSelectNone");
      return;
    }
    if (typeof h.onDeselect === "function") {
      callHandler("onDeselect");
      return;
    }
    // main.js 未提供关闭回调时：派发 Escape，让总装侧执行 clearSelection()
    if (closingDetail) return;
    closingDetail = true;
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    } catch (err) {
      /* 忽略：非浏览器环境 */
    } finally {
      closingDetail = false;
    }
  }

  function fallbackCopy(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      return true;
    } catch (err) {
      return false;
    }
  }

  function copyTle() {
    if (!currentTle) {
      showToast("暂无 TLE 数据");
      return;
    }
    const text = currentTle;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(
        function () { showToast("TLE 已复制"); },
        function () { showToast(fallbackCopy(text) ? "TLE 已复制" : "复制失败，请手动选择"); }
      );
    } else {
      showToast(fallbackCopy(text) ? "TLE 已复制" : "复制失败，请手动选择");
    }
  }

  /* ---------- 国家列表 ---------- */

  function countryColor(item, index) {
    return (item && item.color) || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function rebuildCountryList(items, total) {
    const listEl = refs.countryList;
    if (!listEl) return;

    countryIndex.clear();
    const frag = document.createDocumentFragment();
    const shown = items.slice(0, COUNTRY_LIMIT);

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "country-empty";
      empty.textContent = "无匹配的国家 / 组织";
      frag.appendChild(empty);
    }

    shown.forEach(function (item, index) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "country-item";
      el.dataset.code = item.code || "";
      el.style.setProperty("--c", countryColor(item, index));

      const dot = document.createElement("span");
      dot.className = "c-dot";
      const flag = document.createElement("span");
      flag.className = "c-flag";
      flag.textContent = item.flag || "🛰️";
      const name = document.createElement("span");
      name.className = "c-name";
      name.textContent = item.name || item.code || "--";
      const count = document.createElement("span");
      count.className = "c-count";
      count.textContent = fmtInt(item.count);

      el.appendChild(dot);
      el.appendChild(flag);
      el.appendChild(name);
      el.appendChild(count);
      el.title = (item.name || item.code) + " · " + fmtInt(item.count);

      frag.appendChild(el);
      countryIndex.set(item.code, { el: el, count: count, flag: flag, name: name });
    });

    if (total > shown.length) {
      const more = document.createElement("div");
      more.className = "country-more";
      more.textContent = "另有 " + fmtInt(total - shown.length) + " 个国家 / 组织未列出";
      frag.appendChild(more);
    }

    listEl.replaceChildren(frag);
  }

  function applyCountryClasses() {
    countryIndex.forEach(function (entry, code) {
      entry.el.classList.toggle("active", activeCountry.get(code) !== false);
    });
    countryBars.forEach(function (entry, code) {
      entry.row.classList.toggle("active", countryFiltered && activeCountry.get(code) === true);
    });
  }

  function toggleCountry(code) {
    if (!code) return;
    const active = activeCountry.get(code) === true;
    const filtering = countryFiltered;
    const enabled = filtering ? !active : true;

    if (!filtering) {
      activeCountry.forEach(function (value, key) {
        if (key !== code) activeCountry.set(key, false);
      });
      countryFiltered = true;
    }
    activeCountry.set(code, enabled);
    applyCountryClasses();
    callHandler("onCountryToggle", code, enabled);
  }

  /* ---------- 绑定事件 ---------- */

  function bindPanels() {
    if (refs.btnCollapseLeft) {
      refs.btnCollapseLeft.addEventListener("click", function () {
        togglePanel(refs.panelLeft, refs.panelRight);
      });
    }
    if (refs.btnCollapseRight) {
      refs.btnCollapseRight.addEventListener("click", function () {
        togglePanel(refs.panelRight, refs.panelLeft);
      });
    }
  }

  function bindTopBar() {
    if (refs.refreshBtn) {
      refs.refreshBtn.addEventListener("click", function () {
        callHandler("onRefresh");
        refs.refreshBtn.classList.add("is-busy");
        setTimeout(function () { refs.refreshBtn.classList.remove("is-busy"); }, 800);
      });
    }
    if (refs.dataError) {
      refs.dataError.addEventListener("click", function () {
        refs.dataError.hidden = true;
      });
    }
  }

  function setSearchHint(query) {
    if (!refs.searchHint) return;
    setText(
      refs.searchHint,
      query ? "检索：" + query : "支持名称 / NORAD 编号 / 国家代码"
    );
  }

  function bindSearch() {
    const input = refs.searchInput;
    if (!input) return;

    input.addEventListener("input", function () {
      const query = input.value.trim();
      setSearchHint(query);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        callHandler("onSearch", query);
      }, 220);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        clearTimeout(searchTimer);
        callHandler("onSearch", input.value.trim());
      } else if (event.key === "Escape") {
        clearTimeout(searchTimer);
        input.value = "";
        setSearchHint("");
        callHandler("onSearch", "");
      }
    });

    if (refs.searchClear) {
      refs.searchClear.addEventListener("click", function () {
        clearTimeout(searchTimer);
        input.value = "";
        setSearchHint("");
        callHandler("onSearch", "");
        input.focus();
      });
    }

    setSearchHint("");
  }

  function bindCountry() {
    if (refs.countryList) {
      refs.countryList.addEventListener("click", function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const item = target.closest(".country-item");
        if (!item || !refs.countryList.contains(item)) return;
        toggleCountry(item.dataset.code);
      });
    }

    if (refs.countryBars) {
      refs.countryBars.addEventListener("click", function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const row = target.closest(".bar-row");
        if (!row || !refs.countryBars.contains(row)) return;
        toggleCountry(row.dataset.code);
      });
    }

    if (refs.countryClear) {
      refs.countryClear.addEventListener("click", function () {
        activeCountry.forEach(function (value, key) { activeCountry.set(key, true); });
        countryFiltered = false;
        applyCountryClasses();
        callHandler("onCountriesAll", true);
      });
    }
  }

  function bindTransport() {
    if (refs.btnPlay) {
      refs.btnPlay.addEventListener("click", function () {
        callHandler("onPlayToggle");
      });
    }
    if (refs.btnNow) {
      refs.btnNow.addEventListener("click", function () {
        callHandler("onNow");
      });
    }
    if (refs.detailClose) {
      refs.detailClose.addEventListener("click", closeDetail);
    }
  }

  function bindKeyboard() {
    window.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (refs.detailBlock && !refs.detailBlock.hidden) closeDetail();
    });
  }

  /* ---------- 节流后的高频渲染 ---------- */

  const applyStats = throttle(function (stats) {
    renderStats(stats);
  }, 500);

  const applyCountries = throttle(function (list, allShown) {
    renderCountries(list, allShown);
  }, 500);

  const applySelection = throttle(function (detail) {
    if (detail) {
      renderDetail(detail);
    } else {
      hideDetail();
    }
  }, 100);

  const applyClock = throttle(function (clock) {
    renderClock(clock);
  }, 500);

  const applyPerf = throttle(function (perf) {
    renderPerf(perf);
  }, 250);

  function renderStats(stats) {
    const s = stats || {};
    statValues.forEach(function (el, key) {
      setText(el, fmtInt(s[key]));
    });

    if (Array.isArray(s.byOrbit)) {
      s.byOrbit.forEach(function (item) {
        if (!item || !item.key) return;
        const chip = orbitChips.get(item.key);
        if (!chip) return;
        setText(chip.count, fmtInt(item.count));
        if (item.color) chip.el.style.setProperty("--chip-color", item.color);
        if (item.label) {
          const label = chipLabel(item.label, item.labelZh, item.key);
          chip.el.title = label + " · " + fmtInt(item.count);
          setText(chip.label, label);
        }
        if (typeof item.active === "boolean") {
          chip.el.classList.toggle("active", item.active);
          chip.el.setAttribute("aria-pressed", item.active ? "true" : "false");
          orbitEnabled.set(item.key, item.active);
        }
      });
      renderOrbitBars(s.byOrbit);
    }

    if (Array.isArray(s.byCategory)) {
      s.byCategory.forEach(function (item) {
        if (!item || !item.key) return;
        const chip = categoryChips.get(item.key);
        if (chip) {
          setText(chip.count, fmtInt(item.count));
          const def = CATEGORY_INDEX.get(item.key);
          if (def) {
            chip.el.style.setProperty("--chip-color", def.color);
            chip.el.title = def.label + " · " + fmtInt(item.count);
          }
        }
      });
      renderCategoryBars(s.byCategory);
    }

    if (Array.isArray(s.topCountries)) renderCountryBars(s.topCountries);
  }

  function renderCountries(list, allShown) {
    if (!Array.isArray(list)) return;
    const total = list.length;
    const signature = list.slice(0, COUNTRY_LIMIT).map(function (item) { return item && item.code; }).join("|") + "#" + total;

    if (signature !== lastCountrySignature) {
      rebuildCountryList(list, total);
      lastCountrySignature = signature;
    }

    activeCountry.clear();
    list.forEach(function (item) {
      if (!item || !item.code) return;
      activeCountry.set(item.code, item.active !== false);
    });
    countryFiltered = list.some(function (item) { return item && item.active === false; });

    const shown = list.slice(0, COUNTRY_LIMIT);
    shown.forEach(function (item) {
      if (!item || !item.code) return;
      const entry = countryIndex.get(item.code);
      if (!entry) return;
      setText(entry.count, fmtInt(item.count));
      entry.el.title = (item.name || item.code) + " · " + fmtInt(item.count);
    });

    applyCountryClasses();

    if (refs.countryClear) {
      refs.countryClear.setAttribute("aria-pressed", allShown ? "true" : "false");
    }
  }

  function renderClock(clock) {
    const c = clock || {};
    if (refs.clockUtc) setText(refs.clockUtc, c.utc ? String(c.utc) : "--:--:--");
    if (refs.clockLocal) setText(refs.clockLocal, c.local ? String(c.local) : "--");

    const paused = !!c.paused;
    const speed = Number(c.speed) || 0;

    if (refs.clockTag) {
      setText(refs.clockTag, paused ? "已暂停" : (speed === 1 ? "实时" : "×" + speed));
      refs.clockTag.classList.toggle("paused", paused);
    }

    if (refs.btnPlay) {
      setText(refs.btnPlay, paused ? "▶" : "⏸");
      refs.btnPlay.title = paused ? "继续时间" : "暂停时间";
      refs.btnPlay.setAttribute("aria-pressed", paused ? "true" : "false");
    }

    if (speedBtns.size) {
      const activeValue = paused ? 0 : speed;
      let matched = false;
      speedBtns.forEach(function (el, value) {
        const on = value === activeValue;
        if (on) matched = true;
        el.classList.toggle("active", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (!matched && !paused) setActiveSpeed(-1);
    }
  }

  function renderPerf(perf) {
    const p = perf || {};
    if (refs.fps) setText(refs.fps, isNum(p.fps) ? String(Math.round(Number(p.fps))) : "--");
    if (refs.renderCount) setText(refs.renderCount, fmtInt(p.rendered));
    if (refs.totalCount) setText(refs.totalCount, fmtInt(p.total));
    if (refs.perf) {
      const low = isNum(p.fps) && Number(p.fps) < 30;
      refs.perf.classList.toggle("is-low", low);
    }
  }

  /* ---------- Loading / Toast ---------- */

  function showToast(message) {
    const el = refs.toast;
    if (!el) return;
    const text = message === null || message === undefined ? "" : String(message);
    if (!text) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 1600);
  }

  /* ---------- V3 观测（契约 §13）---------- */

  function makeObsTitle(text, enText, countId) {
    const title = document.createElement("div");
    title.className = "obs-title";
    const main = document.createElement("span");
    main.textContent = text;
    title.appendChild(main);
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = enText;
    title.appendChild(en);
    const count = document.createElement("span");
    count.className = "obs-count";
    if (countId) count.id = countId;
    count.textContent = "0";
    title.appendChild(count);
    return title;
  }

  function makeEmptyState(text) {
    const el = document.createElement("div");
    el.className = "obs-empty";
    el.textContent = text;
    return el;
  }

  function ensureObserverChip() {
    let chip = byId("observer-chip");
    if (!chip) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.id = "observer-chip";
      chip.className = "observer-chip is-empty";
      const icon = document.createElement("span");
      icon.className = "oc-icon";
      icon.textContent = "📍";
      const label = document.createElement("span");
      label.className = "oc-label";
      label.textContent = "设置观测点";
      chip.appendChild(icon);
      chip.appendChild(label);
      const anchor = refs.dataStatus;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(chip, anchor.nextSibling);
      else if (refs.panelRight && refs.panelRight.parentNode) refs.panelRight.parentNode.appendChild(chip);
    }
    obsEl.chip = chip;
    obsEl.chipLabel = chip.querySelector(".oc-label");
  }

  function makeTab(name, label, enText, active) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tab-" + name;
    btn.className = "stats-tab" + (active ? " active" : "");
    btn.dataset.tab = name;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.appendChild(document.createTextNode(label + " "));
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = enText;
    btn.appendChild(en);
    return btn;
  }

  function ensureObserveUI() {
    const block = refs.statsBlock;
    if (!block) return;

    let tabs = byId("stats-tabs");
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = "stats-tabs";
      tabs.className = "stats-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.appendChild(makeTab("overview", "概览", "OVERVIEW", true));
      tabs.appendChild(makeTab("observe", "观测", "OBSERVE", false));
      block.insertBefore(tabs, block.firstChild);
    }
    obsEl.tabs = tabs;
    obsEl.tabOverview = byId("tab-overview");
    obsEl.tabObserve = byId("tab-observe");

    let pane = byId("observe-pane");
    if (!pane) {
      pane = document.createElement("div");
      pane.id = "observe-pane";
      pane.className = "observe-pane";
      block.appendChild(pane);
    }
    obsEl.pane = pane;

    if (!byId("obs-location")) buildLocationBlock(pane);
    if (!byId("visible-list")) buildVisibleSection(pane);
    if (!byId("pass-list")) buildPassSection(pane);
    if (!byId("obs-focus")) buildFocusRow(pane);
    if (!byId("obs-note")) {
      const note = document.createElement("div");
      note.id = "obs-note";
      note.className = "obs-note";
      note.textContent = "亮度为估算值 · 过境时间按当前时间机器";
      pane.appendChild(note);
    }

    obsEl.current = byId("obs-current");
    obsEl.locateBtn = byId("obs-locate");
    obsEl.citySelect = byId("obs-city");
    obsEl.latInput = byId("obs-lat");
    obsEl.lonInput = byId("obs-lon");
    obsEl.applyBtn = byId("obs-apply");
    obsEl.clearBtn = byId("obs-clear");
    obsEl.visibleList = byId("visible-list");
    obsEl.visibleCount = byId("visible-count");
    obsEl.passList = byId("pass-list");
    obsEl.passCount = byId("pass-count");
    obsEl.focusInput = byId("obs-focus");

    Array.prototype.forEach.call(block.children, function (el) {
      if (el.id === "stats-tabs" || el.id === "observe-pane") return;
      el.classList.add("ov-hide");
    });

    bindObserveEvents();
    renderObserver();
  }

  function buildLocationBlock(pane) {
    const box = document.createElement("div");
    box.id = "obs-location";
    box.className = "obs-location";

    const head = document.createElement("div");
    head.className = "obs-loc-head";
    const tick = document.createElement("span");
    tick.className = "tick";
    head.appendChild(tick);
    head.appendChild(document.createTextNode("观测地点 "));
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = "LOCATION";
    head.appendChild(en);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "obs-clear";
    clear.className = "link-btn";
    clear.textContent = "清除";
    head.appendChild(clear);

    const current = document.createElement("div");
    current.id = "obs-current";
    current.className = "obs-current is-empty";
    current.textContent = "请先设置观测地点";

    const actions = document.createElement("div");
    actions.className = "obs-actions";
    const locate = document.createElement("button");
    locate.type = "button";
    locate.id = "obs-locate";
    locate.className = "btn btn-ghost";
    locate.textContent = "📍 使用我的位置";
    locate.title = "使用浏览器定位（需授权）";
    actions.appendChild(locate);

    const select = document.createElement("select");
    select.id = "obs-city";
    select.className = "obs-select";
    select.title = "选择城市预设";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择城市预设…";
    select.appendChild(placeholder);
    OBSERVER_CITIES.forEach(function (city) {
      const option = document.createElement("option");
      option.value = city;
      option.textContent = city;
      select.appendChild(option);
    });

    const manual = document.createElement("div");
    manual.className = "obs-manual";
    const lat = document.createElement("input");
    lat.id = "obs-lat";
    lat.type = "number";
    lat.step = "0.0001";
    lat.min = "-90";
    lat.max = "90";
    lat.placeholder = "纬度";
    lat.setAttribute("aria-label", "观测点纬度");
    const lon = document.createElement("input");
    lon.id = "obs-lon";
    lon.type = "number";
    lon.step = "0.0001";
    lon.min = "-180";
    lon.max = "180";
    lon.placeholder = "经度";
    lon.setAttribute("aria-label", "观测点经度");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.id = "obs-apply";
    apply.className = "btn";
    apply.textContent = "确定";
    apply.title = "使用手动输入的经纬度";
    manual.appendChild(lat);
    manual.appendChild(lon);
    manual.appendChild(apply);

    box.appendChild(head);
    box.appendChild(current);
    box.appendChild(actions);
    box.appendChild(select);
    box.appendChild(manual);
    pane.insertBefore(box, pane.firstChild);
  }

  function buildVisibleSection(pane) {
    const section = document.createElement("div");
    section.id = "visible-section";
    section.className = "obs-section";
    section.appendChild(makeObsTitle("当前可见", "VISIBLE NOW", "visible-count"));
    const list = document.createElement("div");
    list.id = "visible-list";
    list.className = "obs-list";
    list.setAttribute("role", "list");
    section.appendChild(list);
    pane.appendChild(section);
  }

  function buildPassSection(pane) {
    const section = document.createElement("div");
    section.id = "pass-section";
    section.className = "obs-section";
    section.appendChild(makeObsTitle("未来 6 小时推荐过境", "PASSES", "pass-count"));
    const list = document.createElement("div");
    list.id = "pass-list";
    list.className = "obs-list";
    list.setAttribute("role", "list");
    section.appendChild(list);
    pane.appendChild(section);
  }

  function buildFocusRow(pane) {
    const label = document.createElement("label");
    label.className = "obs-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "obs-focus";
    const span = document.createElement("span");
    span.appendChild(document.createTextNode("仅高亮可见卫星 "));
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = "HIGHLIGHT ONLY";
    span.appendChild(en);
    label.appendChild(input);
    label.appendChild(span);
    pane.appendChild(label);
  }

  function bindObserveEvents() {
    if (obsEl.tabs) {
      obsEl.tabs.addEventListener("click", function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const btn = target.closest(".stats-tab");
        if (!btn || !obsEl.tabs.contains(btn)) return;
        setTab(btn.dataset.tab);
      });
    }
    if (obsEl.locateBtn) {
      obsEl.locateBtn.addEventListener("click", function () {
        callHandler("onLocate");
      });
    }
    if (obsEl.citySelect) {
      obsEl.citySelect.addEventListener("change", function () {
        const city = obsEl.citySelect.value;
        if (city) callHandler("onObserverPreset", city);
      });
    }
    if (obsEl.applyBtn) obsEl.applyBtn.addEventListener("click", applyManualObserver);
    [obsEl.latInput, obsEl.lonInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") applyManualObserver();
      });
    });
    if (obsEl.clearBtn) {
      obsEl.clearBtn.addEventListener("click", function () {
        if (obsEl.latInput) obsEl.latInput.value = "";
        if (obsEl.lonInput) obsEl.lonInput.value = "";
        if (obsEl.citySelect) obsEl.citySelect.value = "";
        setObserver(null);
        callHandler("onObserverClear");
      });
    }
    if (obsEl.focusInput) {
      obsEl.focusInput.addEventListener("change", function () {
        callHandler("onFocusVisibleOnly", !!obsEl.focusInput.checked);
      });
    }
    if (obsEl.visibleList) obsEl.visibleList.addEventListener("click", onObsListClick);
    if (obsEl.passList) obsEl.passList.addEventListener("click", onObsListClick);
    if (obsEl.chip) obsEl.chip.addEventListener("click", function () { setTab("observe"); });
  }

  function applyManualObserver() {
    const lat = obsEl.latInput ? Number(obsEl.latInput.value) : NaN;
    const lon = obsEl.lonInput ? Number(obsEl.lonInput.value) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showToast("请输入有效经纬度（纬度 -90~90，经度 -180~180）");
      return;
    }
    callHandler("onObserverManual", lat, lon);
  }

  function onObsListClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    const row = target.closest(".obs-item");
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    callHandler("onSelectPass", index);
  }

  function setTab(name) {
    const tab = name === "observe" ? "observe" : "overview";
    obsData.tab = tab;
    if (refs.statsBlock) refs.statsBlock.classList.toggle("is-observe", tab === "observe");
    [obsEl.tabOverview, obsEl.tabObserve].forEach(function (btn) {
      if (!btn) return;
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (tab === "observe") {
      expandPanel(refs.panelRight);
      if (isNarrow()) setPanelCollapsed(refs.panelLeft, true);
      updateCountdowns();
    }
  }

  function renderObserverChip() {
    const obs = obsData.observer;
    const chip = obsEl.chip;
    if (!chip) return;
    chip.classList.toggle("is-empty", !obs);
    const label = obs ? (obs.label || "自定义位置") : "设置观测点";
    setText(obsEl.chipLabel, label);
    const coord = obs ? fmtCoord(obs.lat, obs.lon) : "";
    chip.title = obs
      ? "观测点：" + label + " · " + coord + "（点击打开观测面板）"
      : "未设置观测点（点击打开观测面板）";
    chip.setAttribute("aria-label", obs ? "观测点 " + label : "设置观测点");
  }

  function renderObserver() {
    const obs = obsData.observer;
    if (obsEl.current) {
      obsEl.current.textContent = "";
      if (!obs) {
        obsEl.current.className = "obs-current is-empty";
        obsEl.current.textContent = "请先设置观测地点";
      } else {
        obsEl.current.className = "obs-current";
        const label = document.createElement("span");
        label.className = "obs-label";
        label.textContent = obs.label || "自定义位置";
        const coord = document.createElement("span");
        coord.className = "obs-coord";
        coord.textContent = fmtCoord(obs.lat, obs.lon);
        obsEl.current.appendChild(label);
        obsEl.current.appendChild(coord);
      }
    }
    if (obsEl.clearBtn) obsEl.clearBtn.disabled = !obs;
    if (obsEl.citySelect) {
      const city = obs && obs.label && OBSERVER_CITIES.indexOf(obs.label) >= 0 ? obs.label : "";
      obsEl.citySelect.value = city;
    }
    renderObserverChip();
    renderVisibleList();
    renderPassList();
  }

  function renderVisibleList() {
    const list = obsEl.visibleList;
    if (!list) return;
    const items = Array.isArray(obsData.visible) ? obsData.visible.slice(0, 12) : [];
    if (obsEl.visibleCount) setText(obsEl.visibleCount, String(items.length));
    if (!obsData.observer) {
      list.replaceChildren(makeEmptyState("请先设置观测地点"));
      obsData.visibleSig = "";
      obsData.visibleRows.clear();
      return;
    }
    if (!items.length) {
      list.replaceChildren(makeEmptyState(obsData.observing ? "正在计算观测数据…" : "当前没有合适目标"));
      obsData.visibleSig = "";
      obsData.visibleRows.clear();
      return;
    }
    const sig = items.map(function (item) { return item && item.index; }).join(",");
    if (sig !== obsData.visibleSig) {
      rebuildVisibleRows(items);
      obsData.visibleSig = sig;
    }
    items.forEach(updateVisibleRow);
  }

  function rebuildVisibleRows(items) {
    const list = obsEl.visibleList;
    if (!list) return;
    obsData.visibleRows.clear();
    const frag = document.createDocumentFragment();
    items.forEach(function (item) {
      if (!item) return;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "obs-item visible-item";
      row.dataset.index = String(item.index);
      row.style.setProperty("--c", item.color || "#5ef0ff");

      const top = document.createElement("span");
      top.className = "obs-item-top";
      const dot = document.createElement("i");
      dot.className = "oi-dot";
      const name = document.createElement("span");
      name.className = "oi-name";
      const mag = document.createElement("span");
      mag.className = "oi-mag";
      const tier = document.createElement("span");
      tier.className = "tier";
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(mag);
      top.appendChild(tier);

      const meta = document.createElement("span");
      meta.className = "obs-item-meta";
      const country = document.createElement("span");
      country.className = "oi-country";
      const el = document.createElement("span");
      el.className = "oi-el";
      const az = document.createElement("span");
      az.className = "oi-az";
      const range = document.createElement("span");
      range.className = "oi-range";
      meta.appendChild(country);
      meta.appendChild(el);
      meta.appendChild(az);
      meta.appendChild(range);

      row.appendChild(top);
      row.appendChild(meta);
      frag.appendChild(row);
      obsData.visibleRows.set(String(item.index), {
        row: row, name: name, mag: mag, tier: tier, country: country, el: el, az: az, range: range
      });
    });
    list.replaceChildren(frag);
  }

  function updateVisibleRow(item) {
    if (!item) return;
    const entry = obsData.visibleRows.get(String(item.index));
    if (!entry) return;
    setText(entry.name, item.name || ("#" + item.index));
    setText(entry.mag, "估算 " + (isNum(item.mag) ? fmtNum(item.mag, 1) : "--"));
    entry.tier.className = "tier tier-" + (item.tier || "telescope");
    setText(entry.tier, TIER_SHORT[item.tier] || "—");
    setText(entry.country, ((item.flag ? item.flag + " " : "") + (item.country || "")).trim());
    setText(entry.el, "仰角 " + (isNum(item.el) ? fmtNum(item.el, 1) + "°" : "--"));
    setText(entry.az, "方位 " + (isNum(item.az) ? fmtNum(item.az, 0) + "°" : "--"));
    setText(entry.range, isNum(item.rangeKm) ? fmtInt(item.rangeKm) + " km" : "-- km");
    entry.row.title = (item.name || "") + (item.sunlit ? " · 被照亮" : " · 地影中");
  }

  function renderPassList() {
    const list = obsEl.passList;
    if (!list) return;
    const items = Array.isArray(obsData.passes) ? obsData.passes.slice(0, 10) : [];
    if (obsEl.passCount) setText(obsEl.passCount, String(items.length));
    if (!obsData.observer) {
      list.replaceChildren(makeEmptyState("请先设置观测地点"));
      obsData.passSig = "";
      obsData.passRows.clear();
      return;
    }
    if (!items.length) {
      list.replaceChildren(makeEmptyState(obsData.observing ? "正在计算过境…" : "未来 6 小时内没有推荐过境"));
      obsData.passSig = "";
      obsData.passRows.clear();
      return;
    }
    const sig = items.map(function (item) {
      return item && (item.index + ":" + item.startAt + ":" + item.durationSec);
    }).join("|");
    if (sig !== obsData.passSig) {
      rebuildPassRows(items);
      obsData.passSig = sig;
    }
    items.forEach(updatePassRow);
  }

  function rebuildPassRows(items) {
    const list = obsEl.passList;
    if (!list) return;
    obsData.passRows.clear();
    const frag = document.createDocumentFragment();
    items.forEach(function (item) {
      if (!item) return;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "obs-item pass-item";
      row.dataset.index = String(item.index);
      row.dataset.start = String(item.startAt == null ? "" : item.startAt);
      row.dataset.duration = String(item.durationSec == null ? "" : item.durationSec);
      row.dataset.live = item.live ? "1" : "0";
      row.style.setProperty("--c", item.color || "#5ef0ff");

      const top = document.createElement("span");
      top.className = "obs-item-top";
      const dot = document.createElement("i");
      dot.className = "oi-dot";
      const name = document.createElement("span");
      name.className = "oi-name";
      const countdown = document.createElement("span");
      countdown.className = "countdown";
      const tier = document.createElement("span");
      tier.className = "tier";
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(countdown);
      top.appendChild(tier);

      const meta = document.createElement("span");
      meta.className = "obs-item-meta";
      const maxEl = document.createElement("span");
      maxEl.className = "oi-maxel";
      const az = document.createElement("span");
      az.className = "oi-az";
      const duration = document.createElement("span");
      duration.className = "oi-duration";
      const mag = document.createElement("span");
      mag.className = "oi-mag";
      meta.appendChild(maxEl);
      meta.appendChild(az);
      meta.appendChild(duration);
      meta.appendChild(mag);

      const reason = document.createElement("span");
      reason.className = "oi-reason";

      row.appendChild(top);
      row.appendChild(meta);
      row.appendChild(reason);
      frag.appendChild(row);
      obsData.passRows.set(String(item.index), {
        row: row, name: name, countdown: countdown, tier: tier,
        maxEl: maxEl, az: az, duration: duration, mag: mag, reason: reason
      });
    });
    list.replaceChildren(frag);
  }

  function updatePassRow(item) {
    if (!item) return;
    const entry = obsData.passRows.get(String(item.index));
    if (!entry) return;
    const now = Date.now();
    entry.row.dataset.start = String(item.startAt == null ? "" : item.startAt);
    entry.row.dataset.duration = String(item.durationSec == null ? "" : item.durationSec);
    entry.row.dataset.live = item.live ? "1" : "0";
    setText(entry.name, item.name || ("#" + item.index));
    setText(entry.countdown, passCountdown(item, now));
    entry.countdown.classList.toggle("live", isPassLive(item, now));
    entry.tier.className = "tier tier-" + (item.tier || "telescope");
    setText(entry.tier, TIER_SHORT[item.tier] || "—");
    setText(entry.maxEl, "最高 " + (isNum(item.maxEl) ? fmtNum(item.maxEl, 1) + "°" : "--"));
    setText(entry.az, "方位 " + (isNum(item.az) ? fmtNum(item.az, 0) + "°" : "--"));
    setText(entry.duration, fmtDuration(item.durationSec));
    setText(entry.mag, "估算 " + (isNum(item.mag) ? fmtNum(item.mag, 1) : "--"));
    setText(entry.reason, item.reason || "—");
    entry.row.title = (item.name || "") + " · " + fmtLocalHHMM(item.startAt) + " · " + (item.reason || "");
  }

  function updateCountdowns() {
    const list = obsEl.passList;
    if (!list) return;
    const rows = list.querySelectorAll(".obs-item");
    if (!rows.length) return;
    const now = Date.now();
    Array.prototype.forEach.call(rows, function (row) {
      const cd = row.querySelector(".countdown");
      if (!cd) return;
      const item = {
        startAt: row.dataset.start === "" ? null : Number(row.dataset.start),
        durationSec: row.dataset.duration === "" ? 0 : Number(row.dataset.duration),
        live: row.dataset.live === "1"
      };
      setText(cd, passCountdown(item, now));
      cd.classList.toggle("live", isPassLive(item, now));
    });
  }

  function setViewingField(key, value, cls) {
    const el = obsData.viewingFields.get(key);
    if (!el) return;
    setText(el, value);
    el.className = "v-v" + (cls ? " " + cls : "");
  }

  function renderViewing() {
    const block = obsEl.viewing;
    if (!block) return;
    const d = obsData.detail;
    if (!d) {
      block.hidden = true;
      return;
    }
    const wasHidden = block.hidden;
    block.hidden = false;

    const tier = d.tier || "telescope";
    if (obsEl.viewingTier) {
      obsEl.viewingTier.className = "tier tier-" + tier;
      setText(obsEl.viewingTier, TIER_FULL[tier] || "—");
    }

    const above = d.aboveHorizon !== false;
    setViewingField("el", isNum(d.el) ? fmtNum(d.el, 1) + "°" + (above ? "" : "（地平线下）") : "--");
    setViewingField("az", isNum(d.az) ? fmtNum(d.az, 0) + "°" : "--");
    setViewingField("range", isNum(d.rangeKm) ? fmtInt(d.rangeKm) + " km" : "--");
    setViewingField(
      "sunlit",
      d.sunlit === true ? "被照亮" : (d.sunlit === false ? "地影中" : "--"),
      d.sunlit === true ? "is-ok" : (d.sunlit === false ? "is-warn" : "")
    );
    setViewingField("mag", isNum(d.mag) ? fmtNum(d.mag, 1) + "（估算）" : "--");

    if (obsEl.viewingNext) {
      const next = d.nextPass;
      if (next && isNum(next.startAt)) {
        const parts = [fmtLocalHHMM(next.startAt)];
        if (isNum(next.maxEl)) parts.push("最高 " + fmtNum(next.maxEl, 1) + "°");
        if (isNum(next.durationSec)) parts.push(fmtDuration(next.durationSec));
        setText(obsEl.viewingNext, "下一次过境 · " + parts.join(" · "));
      } else {
        setText(obsEl.viewingNext, "未来 6 小时内无过境");
      }
    }

    if (wasHidden) scrollDetailIntoView();
  }

  /**
   * 选中态按名称匹配：main.js 的 visible/pass 条目 index 是卫星数组下标，
   * 而详情里的 id 是 NORAD 编号，两者不是同一套编号，不能直接比较。
   */
  function markObsSelected(name) {
    const target = name === null || name === undefined ? "" : String(name);
    const apply = function (map) {
      map.forEach(function (entry) {
        const rowName = entry.name ? entry.name.textContent : "";
        entry.row.classList.toggle("is-selected", !!target && rowName === target);
      });
    };
    apply(obsData.visibleRows);
    apply(obsData.passRows);
  }

  const applyVisibleNow = throttle(function () { renderVisibleList(); }, 500);
  const applyPasses = throttle(function () { renderPassList(); }, 500);
  const applyViewing = throttle(function () { renderViewing(); }, 100);

  /* ---------- V3 公共方法 ---------- */

  function setObserver(observer) {
    if (!observer || !isNum(observer.lat) || !isNum(observer.lon)) {
      obsData.observer = null;
      if (obsEl.latInput) obsEl.latInput.value = "";
      if (obsEl.lonInput) obsEl.lonInput.value = "";
      if (obsEl.citySelect) obsEl.citySelect.value = "";
    } else {
      obsData.observer = {
        lat: Number(observer.lat),
        lon: Number(observer.lon),
        label: observer.label || "自定义位置",
        source: observer.source || "manual"
      };
    }
    renderObserver();
  }

  function updateVisibleNow(list) {
    obsData.visible = Array.isArray(list) ? list : [];
    applyVisibleNow();
  }

  function updatePasses(list) {
    obsData.passes = Array.isArray(list) ? list : [];
    applyPasses();
  }

  function setPassDetail(detail) {
    obsData.detail = detail || null;
    applyViewing();
  }

  function setObserving(on) {
    obsData.observing = !!on;
    if (obsEl.pane) obsEl.pane.classList.toggle("is-observing", obsData.observing);
    if (!obsData.visible.length) renderVisibleList();
    if (!obsData.passes.length) renderPassList();
  }

  /* ---------- 公共 API（契约 §4） ---------- */

  function setDataStatus(status) {
    const s = status || {};
    const sourceKey = s.source ? String(s.source).toLowerCase() : "";
    const label = SOURCE_LABELS[sourceKey] || (s.source ? String(s.source).toUpperCase() : "数据链路");

    if (refs.dataSource) {
      const countText = isNum(s.count) ? " · " + fmtInt(s.count) : "";
      setText(refs.dataSource, label + countText);
    }
    if (refs.dataUpdated) setText(refs.dataUpdated, formatUpdated(s.updated));
    if (refs.dataStatus) {
      const stale = sourceKey && sourceKey !== "celestrak";
      refs.dataStatus.classList.toggle("is-stale", !!stale);
      refs.dataStatus.title = "数据来源：" + label + (s.updated ? " · 更新 " + String(s.updated) : "");
    }
  }

  function setPerf(perf) {
    applyPerf(perf || {});
  }

  function setClock(clock) {
    applyClock(clock || {});
  }

  function updateStats(stats) {
    applyStats(stats || {});
  }

  function updateCountries(list, allShown) {
    if (!Array.isArray(list)) return;
    applyCountries(list, !!allShown);
  }

  function updateOrbits(list) {
    if (!Array.isArray(list)) return;
    orbitFiltering = list.some(function (item) { return item && item.active === false; });
    list.forEach(function (item) {
      if (!item || !item.key) return;
      let chip = orbitChips.get(item.key);
      if (!chip) {
        chip = createOrbitChip(item.key, item);
        chip.el.classList.add("active");
        if (refs.orbitChips) refs.orbitChips.appendChild(chip.el);
      }
      const label = chipLabel(item.label, item.labelZh, item.key);
      setText(chip.label, label);
      setText(chip.count, fmtInt(item.count));
      if (item.color) chip.el.style.setProperty("--chip-color", item.color);
      const active = item.active !== false;
      chip.el.classList.toggle("active", active);
      chip.el.setAttribute("aria-pressed", active ? "true" : "false");
      chip.el.title = label + " · " + fmtInt(item.count);
      orbitEnabled.set(item.key, active);
    });
  }

  function updateCategories(list) {
    if (!Array.isArray(list)) return;
    if (!refs.categoryChips) refs.categoryChips = ensureCategorySection();
    if (!refs.categoryBars) refs.categoryBars = ensureCategoryBars();
    categoryFiltering = list.some(function (item) { return item && item.active === false; });
    list.forEach(updateCategoryChip);
    renderCategoryBars(list);
  }

  function setSelection(detail) {
    applySelection(detail || null);
  }

  function setLoading(state) {
    const el = refs.loading;
    if (!el) return;
    const s = state || {};
    if (refs.loadingSub && s.text !== undefined && s.text !== null) setText(refs.loadingSub, String(s.text));

    if (s.visible === false) {
      el.classList.add("is-hidden");
      el.setAttribute("aria-busy", "false");
      return;
    }
    if (s.visible === true) {
      el.classList.remove("is-hidden");
      el.setAttribute("aria-busy", "true");
    }

    if (s.progress === null) {
      el.classList.add("indeterminate");
    } else if (isNum(s.progress)) {
      el.classList.remove("indeterminate");
      const pct = Math.max(0, Math.min(1, Number(s.progress)));
      if (refs.loadingProgress) refs.loadingProgress.style.width = (pct * 100).toFixed(1) + "%";
    }
  }

  function setError(message) {
    const el = refs.dataError;
    if (!el) return;
    if (!message) {
      el.hidden = true;
      setText(el, "");
      return;
    }
    setText(el, String(message));
    el.hidden = false;
    el.title = "点击关闭";
  }

  /* ---------- 初始化 ---------- */

  ensureFavicon();
  refs.categoryChips = ensureCategorySection();
  refs.categoryBars = ensureCategoryBars();
  buildOrbitChips();
  buildCategoryChips();
  renderCategoryBars(CATEGORY_DEFS.map(function (def) {
    return { key: def.key, label: def.label, count: null, color: def.color };
  }));
  buildSpeedButtons();
  buildLayerButtons();
  buildStatGrid();
  buildDetail();
  ensureObserverChip();
  ensureObserveUI();
  bindTopBar();
  bindPanels();
  bindSearch();
  bindCountry();
  bindTransport();
  bindKeyboard();

  if (mediaQuery) {
    syncViewport();
    const onChange = function () { syncViewport(); };
    if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", onChange);
    else if (typeof mediaQuery.addListener === "function") mediaQuery.addListener(onChange);
  } else if (isNarrow()) {
    setPanelCollapsed(refs.panelLeft, true);
    setPanelCollapsed(refs.panelRight, true);
  }

  if (typeof window !== "undefined" && !countdownTimer) {
    countdownTimer = window.setInterval(updateCountdowns, 1000);
  }

  setLoading({ visible: true, progress: null });

  return {
    setDataStatus: setDataStatus,
    setPerf: setPerf,
    setClock: setClock,
    updateStats: updateStats,
    updateCountries: updateCountries,
    updateOrbits: updateOrbits,
    updateCategories: updateCategories,
    setSelection: setSelection,
    setObserver: setObserver,
    updateVisibleNow: updateVisibleNow,
    updatePasses: updatePasses,
    setPassDetail: setPassDetail,
    setObserving: setObserving,
    setLoading: setLoading,
    setError: setError,
    toast: showToast
  };
}
