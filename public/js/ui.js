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
  { key: "science", label: "科学 / 深空", labelEn: "Science & Deep Space", short: "科学", color: "#a78bfa" },
  { key: "telescope", label: "天文望远镜", labelEn: "Space Telescopes", short: "望远镜", color: "#fbbf24" },
  { key: "station", label: "空间站 / 载人", labelEn: "Stations & Crew", short: "空间站", color: "#38bdf8" },
  { key: "tech", label: "技术试验 / 教育 / 业余", labelEn: "Tech Demo & Education", short: "技术试验", color: "#f97316" },
  { key: "debris", label: "碎片 / 残骸", labelEn: "Debris & Rocket Bodies", short: "碎片", color: "#7f8b96" },
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
  { key: "mag", label: "估算星等 MAG", full: true },
  { key: "age", label: "星历龄期 AGE", full: true },
  { key: "scope", label: "观测状态 STATUS", full: true, hidden: true }
];

/* V6 望远镜可观测状态 */
const SCOPE_STATUS = {
  now: { label: "现在可观测", cls: "is-now" },
  shadow: { label: "地影中", cls: "is-shadow" },
  below: { label: "地平线下", cls: "is-below" },
  unknown: { label: "未知", cls: "is-unknown" }
};

const SCOPE_RANK = { now: 0, shadow: 1, below: 2, unknown: 3 };

/* V7 空间站 / 载人类型 */
const STATION_TYPES = { station: "常驻空间站", crew: "载人飞船", cargo: "货运飞船" };

const SEARCH_EMPTY_HINT = "试试 ISS / 天和 / 哈勃 / Starlink / 遥感 / 望远镜";

const SOURCE_LABELS = {
  spacetrack: "SPACE-TRACK 在线",
  celestrak: "CELESTRAK 在线",
  cache: "本地缓存 CACHE",
  snapshot: "内置快照 SNAPSHOT",
  local: "本地合成 LOCAL"
};

const LIVE_MIN_TARGETS = 25000;

const OBJECT_TYPE_LABELS = {
  PAY: "载荷 PAY",
  "R/B": "箭体 R/B",
  "R-B": "火箭残骸 R-B",
  DEB: "碎片 DEB",
  UNK: "未知 UNK"
};

/* V5 对象类型（契约 §21.3 / §21.4） */
const OBJECT_KIND_DEFS = [
  { key: "PAY", label: "有效载荷", labelEn: "Payload", color: "#5ef0ff" },
  { key: "R-B", label: "火箭残骸", labelEn: "Rocket Body", color: "#ffd166" },
  { key: "DEB", label: "碎片", labelEn: "Debris", color: "#7f8b96" },
  { key: "UNK", label: "未知", labelEn: "Unknown", color: "#6b8ea3" }
];

const OBJECT_KIND_INDEX = new Map(OBJECT_KIND_DEFS.map(function (def) { return [def.key, def]; }));

const OBJECT_KIND_LABELS = {
  PAY: "载荷 PAY",
  "R-B": "火箭残骸 R-B",
  DEB: "碎片 DEB",
  UNK: "未知 UNK"
};

const TELESCOPE_TYPES = {
  optical: "光学",
  xray: "X 射线",
  gamma: "伽马",
  ir: "红外",
  solar: "太阳",
  particle: "粒子"
};

/** RCS → "0.051 m²" 风格 */
function fmtRcs(value) {
  if (!isNum(value)) return "--";
  const v = Number(value);
  if (!(v > 0)) return "--";
  if (v >= 10) return v.toFixed(1) + " m²";
  if (v >= 1) return v.toFixed(2) + " m²";
  if (v >= 0.001) return v.toFixed(3) + " m²";
  return "<0.001 m²";
}

/** 统一 objectKind：兼容旧 R/B 写法 */
function normalizeObjectKind(value) {
  const raw = value === null || value === undefined ? "" : String(value).trim().toUpperCase();
  if (raw === "R/B" || raw === "R-B" || raw === "RB") return "R-B";
  if (raw === "PAY" || raw === "DEB" || raw === "UNK") return raw;
  return "";
}

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

/* V4 快捷键帮助（契约 §17.7） */
const SHORTCUTS = [
  { key: "C", desc: "切换配色：国家 / 任务类型 / 轨道" },
  { key: "空格", desc: "暂停 / 继续时间" },
  { key: "Esc", desc: "取消选中 · 关闭浮动层" },
  { key: "F", desc: "跟随选中卫星（开关）" },
  { key: "R", desc: "重置视角" },
  { key: "?", desc: "打开 / 关闭本快捷键面板" },
  { key: "Shift + 点击", desc: "多个目标重叠时挑选一个" },
  { key: "Alt + 点击", desc: "在地球表面设置观测点" },
  { key: "双击空白", desc: "重置视角" }
];

/** 时间轴偏移 → 「现在 / -2h 15m / +30m」 */
function fmtOffset(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || Math.abs(value) <= 1) return "现在";
  const sign = value > 0 ? "+" : "-";
  const abs = Math.abs(Math.round(value));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (!hours) return sign + mins + "m";
  return sign + hours + "h" + (mins ? " " + mins + "m" : "");
}

/* ---------- 主入口 ---------- */

export function createUI(handlers) {
  const h = handlers || {};

  const refs = {
    dataStatus: byId("data-status"),
    statSummary: byId("stat-summary"),
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
    objectKindBars: byId("objectkind-bars"),
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
  let autoRotateChip = null;
  const statValues = new Map();
  const orbitBars = new Map();
  const categoryChips = new Map();
  const categoryBars = new Map();
  const objectKindBars = new Map();
  const countryBars = new Map();
  const countryIndex = new Map();
  const activeCountry = new Map();

  let detailRefs = null;
  let currentTle = "";
  let lastCountrySignature = "";
  let lastOrbitBarKeys = "";
  let lastCategoryBarKeys = "";
  let lastObjectKindKeys = "";
  let lastCountryBarKeys = "";
  let countryFiltered = false;
  let orbitFiltering = false;
  let categoryFiltering = false;
  let telescopeOnly = false;
  let stationOnly = false;
  let showDebris = false;
  let userInteracted = false;
  let autoCollapsed = false;
  let searchTimer = 0;
  let toastTimer = 0;

  /* V3 观测状态 */
  const obsEl = {
    pane: null, tabs: null, tabOverview: null, tabObserve: null, chip: null, chipLabel: null,
    current: null, locateBtn: null, pickBtn: null, pickHint: null, citySelect: null, latInput: null, lonInput: null, applyBtn: null, clearBtn: null,
    visibleList: null, visibleCount: null, passList: null, passCount: null, focusInput: null,
    telescopeList: null, telescopeCount: null, exportIcsBtn: null, remindAllBtn: null,
    viewing: null, viewingTier: null, viewingNext: null, viewingAgeHint: null
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
    viewingFields: new Map(),
    telescopes: [],
    telescopeRows: new Map(),
    telescopeSig: "",
    reminders: new Map(),
    selectionDetail: null
  };
  let countdownTimer = 0;

  /* V4 控件状态 */
  const v4 = {
    slider: null,
    offsetLabel: null,
    seekValue: 0,
    freezeUntil: 0,
    dragging: false,
    help: null,
    helpOpen: false,
    following: false,
    followBtn: null,
    pickMode: false
  };

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
      let orbitActive = 0;
      orbitChips.forEach(function (value) {
        if (value.el.classList.contains("active")) orbitActive++;
      });
      if (orbitActive === 0) {
        orbitChips.forEach(function (value, orbitKey) {
          setOrbitVisual(orbitKey, true);
        });
        orbitFiltering = false;
      } else {
        orbitFiltering = true;
      }
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
    ensureCategoryToggles();
    return container;
  }

  /**
   * 任务类型标题右侧的三个筛选开关：只看望远镜 / 只看空间站 / 显示碎片
   * （V5 §21.2、V7 §29.2、V9）
   */
  function ensureCategoryToggles() {
    const container = byId("category-chips");
    const block = container && container.closest ? container.closest(".panel-block") : null;
    const title = block ? block.querySelector(".panel-title") : null;
    if (!title) return;

    let wrap = byId("category-toggles");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "category-toggles";
      wrap.className = "title-toggles";
      title.appendChild(wrap);
    }
    title.classList.add("has-title-toggles");

    let scopeBtn = byId("telescope-toggle");
    if (!scopeBtn) {
      scopeBtn = document.createElement("button");
      scopeBtn.type = "button";
      scopeBtn.id = "telescope-toggle";
      scopeBtn.className = "telescope-toggle";
      scopeBtn.textContent = "🔭 只看望远镜";
      scopeBtn.title = "只显示天文 / 空间科学望远镜";
      scopeBtn.setAttribute("aria-pressed", "false");
      wrap.appendChild(scopeBtn);
      scopeBtn.addEventListener("click", function () {
        setTelescopeOnly(!telescopeOnly, true);
      });
    }

    let stationBtn = byId("station-toggle");
    if (!stationBtn) {
      stationBtn = document.createElement("button");
      stationBtn.type = "button";
      stationBtn.id = "station-toggle";
      stationBtn.className = "telescope-toggle";
      stationBtn.textContent = "🛰️ 只看空间站";
      stationBtn.title = "只显示空间站与载人 / 货运飞船";
      stationBtn.setAttribute("aria-pressed", "false");
      wrap.appendChild(stationBtn);
      stationBtn.addEventListener("click", function () {
        setStationOnly(!stationOnly, true);
      });
    }

    let debrisBtn = byId("debris-toggle");
    if (!debrisBtn) {
      debrisBtn = document.createElement("button");
      debrisBtn.type = "button";
      debrisBtn.id = "debris-toggle";
      debrisBtn.className = "telescope-toggle";
      debrisBtn.textContent = "🛰️ 显示碎片";
      debrisBtn.title = "显示碎片 / 残骸目标（默认隐藏）";
      debrisBtn.setAttribute("aria-pressed", "false");
      wrap.appendChild(debrisBtn);
      debrisBtn.addEventListener("click", function () {
        setShowDebris(!showDebris, true);
      });
    }

    scopeBtn.classList.toggle("is-on", telescopeOnly);
    scopeBtn.setAttribute("aria-pressed", telescopeOnly ? "true" : "false");
    stationBtn.classList.toggle("is-on", stationOnly);
    stationBtn.setAttribute("aria-pressed", stationOnly ? "true" : "false");
    debrisBtn.classList.toggle("is-on", showDebris);
    debrisBtn.setAttribute("aria-pressed", showDebris ? "true" : "false");
  }

  function setTelescopeOnly(on, notify) {
    telescopeOnly = !!on;
    const btn = byId("telescope-toggle");
    if (btn) {
      btn.classList.toggle("is-on", telescopeOnly);
      btn.setAttribute("aria-pressed", telescopeOnly ? "true" : "false");
    }
    refreshClearFilters();
    if (notify) callHandler("onTelescopeOnly", telescopeOnly);
  }

  function setTelescopeOnlyState(on) {
    setTelescopeOnly(!!on, false);
  }

  function setStationOnly(on, notify) {
    stationOnly = !!on;
    const btn = byId("station-toggle");
    if (btn) {
      btn.classList.toggle("is-on", stationOnly);
      btn.setAttribute("aria-pressed", stationOnly ? "true" : "false");
    }
    refreshClearFilters();
    if (notify) callHandler("onStationOnly", stationOnly);
  }

  function setStationOnlyState(on) {
    setStationOnly(!!on, false);
  }

  function applyDebrisChipState() {
    const chip = categoryChips.get("debris");
    if (!chip) return;
    const active = chip.el.classList.contains("active");
    let filtering = false;
    categoryChips.forEach(function (value) {
      if (!value.el.classList.contains("active")) filtering = true;
    });
    chip.el.classList.toggle("is-off", !showDebris && !(active && filtering));
  }

  function setShowDebris(on, notify) {
    showDebris = !!on;
    const btn = byId("debris-toggle");
    if (btn) {
      btn.classList.toggle("is-on", showDebris);
      btn.setAttribute("aria-pressed", showDebris ? "true" : "false");
    }
    applyDebrisChipState();
    if (settingsUi && settingsUi.debrisRow) syncSettingsControls();
    refreshClearFilters();
    if (notify) callHandler("onShowDebris", showDebris);
  }

  function setShowDebrisState(on) {
    setShowDebris(!!on, false);
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

  /**
   * 右栏「对象类型」分布：插在任务类型分布之后、国家条形之前（契约 §21.3）。
   */
  function ensureObjectKindBars() {
    let container = byId("objectkind-bars");
    if (!container) {
      const categoryBarsEl = refs.categoryBars || byId("category-bars");
      const parent = categoryBarsEl ? categoryBarsEl.parentNode : null;
      if (!parent) return null;

      const subtitle = document.createElement("div");
      subtitle.className = "panel-subtitle";
      subtitle.id = "objectkind-subtitle";
      subtitle.appendChild(document.createTextNode("对象类型分布 "));
      const en = document.createElement("span");
      en.className = "en";
      en.textContent = "BY OBJECT";
      subtitle.appendChild(en);

      container = document.createElement("div");
      container.id = "objectkind-bars";
      container.className = "bars objectkind-bars";

      const anchor = categoryBarsEl.nextSibling;
      parent.insertBefore(subtitle, anchor);
      parent.insertBefore(container, anchor);
    } else if (!container.classList.contains("bars")) {
      container.classList.add("bars");
      container.classList.add("objectkind-bars");
    }
    return container;
  }

  function rebuildObjectKindBars(list) {
    if (!refs.objectKindBars) return;
    objectKindBars.clear();
    const frag = document.createDocumentFragment();
    list.forEach(function (item) {
      if (!item || !item.key) return;
      const def = OBJECT_KIND_INDEX.get(item.key);
      const entry = buildBarRow(false, item.label || (def && def.label) || item.key);
      entry.row.classList.add("bar-row-static");
      entry.row.dataset.kind = item.key;
      objectKindBars.set(item.key, entry);
      frag.appendChild(entry.row);
    });
    refs.objectKindBars.replaceChildren(frag);
    lastObjectKindKeys = list.map(function (i) { return i && i.key; }).join(",");
  }

  function renderObjectKindBars(list) {
    if (!Array.isArray(list) || !refs.objectKindBars) return;
    const keys = list.map(function (i) { return i && i.key; }).join(",");
    if (keys !== lastObjectKindKeys) rebuildObjectKindBars(list);

    let max = 1;
    list.forEach(function (i) { max = Math.max(max, Number(i && i.count) || 0); });

    list.forEach(function (item) {
      if (!item || !item.key) return;
      const entry = objectKindBars.get(item.key);
      if (!entry) return;
      const def = OBJECT_KIND_INDEX.get(item.key);
      const name = item.label || (def && def.label) || item.key;
      const count = Number(item.count) || 0;
      setText(entry.name, name);
      setText(entry.count, item.count === null || item.count === undefined ? "--" : fmtInt(item.count));
      entry.row.style.setProperty("--bar-color", (def && def.color) || item.color || "#6b8ea3");
      entry.fill.style.width = clampPct(count / max * 100).toFixed(1) + "%";
      entry.row.title = name + " · " + (item.count === null || item.count === undefined ? "--" : fmtInt(item.count)) + " · 暂不支持按对象类型筛选";
    });
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
      renderSubcategories();
      categoryFiltering = true;
    } else {
      setCategoryVisual(key, enabled);
      let activeCount = 0;
      categoryChips.forEach(function (value) {
        if (value.el.classList.contains("active")) activeCount++;
      });
      if (activeCount === 0) {
        // 集合被清空 = 全部显示，芯片恢复全亮
        categoryChips.forEach(function (value, categoryKey) {
          setCategoryVisual(categoryKey, true);
        });
        categoryFiltering = false;
      } else {
        categoryFiltering = true;
      }
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
      const entry = buildBarRow(true, item.label || (def && def.label) || item.key);
      entry.row.dataset.key = item.key;
      entry.row.dataset.categoryBar = item.key;
      entry.row.addEventListener("click", function () {
        const active = entry.row.classList.contains("active");
        callHandler("onCategoryToggle", item.key, !active);
      });
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
      entry.row.title = name + " · " + (item.count === null || item.count === undefined ? "--" : fmtInt(item.count)) + " · 点击筛选";
      const selected = categoryFiltering && item.active !== false;
      entry.row.classList.toggle("active", selected);
      entry.row.setAttribute("aria-pressed", selected ? "true" : "false");
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

    // V16：count 为 null 表示这一类当前不参与显示（如未启用的碎片），只写「默认隐藏」不写数字
    const countNull = item.count === null || item.count === undefined;
    setText(chip.count, countNull ? "默认隐藏" : fmtInt(item.count));
    if (chip.count && chip.count.classList) {
      chip.count.classList.toggle("is-hidden-count", countNull);
    }
    chip.el.classList.toggle("has-hidden-count", countNull);

    chip.el.style.setProperty("--chip-color", (def && def.color) || item.color || "#6b8ea3");
    const active = item.active !== false;
    chip.el.classList.toggle("active", active);
    chip.el.setAttribute("aria-pressed", active ? "true" : "false");

    const countLabel = countNull ? "默认隐藏" : fmtInt(item.count);
    const baseTitle = full + (en ? " · " + en : "") + " · " + countLabel;
    chip.el.title = (countNull && item.hint) ? String(item.hint) : baseTitle;
    chip.el.setAttribute("aria-label", full + (en ? " · " + en : "") + " · " + countLabel);

    if (item.key === "debris") {
      // 默认隐藏碎片时标注「未启用」；若用户主动只看碎片类目（main 会放行），则不标注
      const off = !showDebris && !(active && categoryFiltering);
      chip.el.classList.toggle("is-off", off);
      if (off) {
        if (countNull && item.hint) {
          chip.el.title = String(item.hint);
          chip.el.setAttribute("aria-label", full + " · 默认隐藏" + (en ? " · " + en : ""));
        } else if (!countNull) {
          chip.el.title += " · 默认隐藏，点本芯片可查看";
        }
      }
    }
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
      if (def.key === "autoRotate") {
        const mode = document.createElement("span");
        mode.className = "layer-mode";
        el.appendChild(mode);
        autoRotateChip = { el: el, mode: mode };
        el.addEventListener("click", cycleAutoRotate);
        layerEnabled.set(def.key, true);
        layerBtns.set(def.key, el);
        frag.appendChild(el);
        return;
      }
      el.addEventListener("click", function () {
        const next = !el.classList.contains("active");
        el.classList.toggle("active", next);
        el.setAttribute("aria-pressed", next ? "true" : "false");
        layerEnabled.set(def.key, next);
        if (settingsUi && settingsUi.layerRows && settingsUi.layerRows.has(def.key)) {
          settingsUi.layers[def.key] = next;
          syncSettingsControls();
          persistLayerState();
        }
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

    // V9：「筛选结果」摘要（显示 N / 共 M）
    let summary = byId("stat-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "stat-summary";
      summary.className = "stat-summary";
      summary.textContent = "显示 -- / 共 --";
      if (refs.statGrid.parentNode) refs.statGrid.parentNode.insertBefore(summary, refs.statGrid.nextSibling);
    }
    refs.statSummary = summary;
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
      const entry = buildBarRow(true, item.label || item.key);
      entry.row.dataset.orbitBar = item.key;
      entry.row.addEventListener("click", function () {
        const active = entry.row.classList.contains("active");
        callHandler("onOrbitToggle", item.key, !active);
      });
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
    lastCountryBarKeys = list.map(function (i) { return i && (i.code + ":" + (i.name || "")); }).join(",");
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
      entry.row.title = (item.label || item.key) + " · " + fmtInt(item.count) + " · 点击筛选";
      const selected = orbitFiltering && orbitEnabled.get(item.key) === true;
      entry.row.classList.toggle("active", selected);
      entry.row.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function renderCountryBars(list) {
    if (!Array.isArray(list) || !refs.countryBars) return;
    lastTopCountries = list;
    const keys = list.map(function (i) { return i && (i.code + ":" + (i.name || "")); }).join(",");
    if (keys !== lastCountryBarKeys) rebuildCountryBars(list);
    let max = 1;
    list.forEach(function (i) { max = Math.max(max, Number(i && i.count) || 0); });
    list.forEach(function (item) {
      if (!item || !item.code) return;
      const entry = countryBars.get(item.code);
      if (!entry) return;
      const count = Number(item.count) || 0;
      const pct = isNum(item.pct) ? Number(item.pct) : count / max * 100;
      // topCountries 里的 name 只有中文；优先用国家列表下发过的本地化名称（跟随语言）
      const localizedName = countryNameMap.get(item.code);
      const label = String(item.flag || "") + " " + String(localizedName || item.name || item.code);
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
    { key: "subtype", label: "细分类型 SUBTYPE", full: true, hidden: true },
    { key: "type", label: "对象类型" },
    { key: "status", label: "运行状态" },
    { key: "orbit", label: "轨道类型" },
    { key: "scope", label: "望远镜 TELESCOPE", full: true, hidden: true },
    { key: "station", label: "空间站 / 载人", full: true, hidden: true },
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

    const scopeBadge = document.createElement("span");
    scopeBadge.className = "detail-scope-badge";
    scopeBadge.textContent = "🔭";
    scopeBadge.hidden = true;

    head.appendChild(flag);
    head.appendChild(nameWrap);
    head.appendChild(scopeBadge);
    head.appendChild(badge);

    const grid = document.createElement("div");
    grid.className = "detail-grid";
    const composite = new Map();
    DETAIL_FIELDS.forEach(function (def) {
      const row = document.createElement("div");
      row.className = def.full ? "d-field full" : "d-field";
      if (def.hidden) row.hidden = true;
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
      if (def.hidden) row.hidden = true;
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

    const viewingAgeHint = document.createElement("div");
    viewingAgeHint.className = "viewing-hint";
    viewingAgeHint.hidden = true;
    viewingAgeHint.textContent = "星历较旧，位置误差可能增大";

    viewing.appendChild(viewingHead);
    viewing.appendChild(viewingGrid);
    viewing.appendChild(viewingNext);
    viewing.appendChild(viewingAgeHint);

    const note = document.createElement("div");
    note.className = "detail-note";
    note.textContent = "任务类型按名称与目录规则推断";

    // V12：观测成果画廊（放在「望远镜 TELESCOPE」行下方）
    const gallery = document.createElement("div");
    gallery.id = "detail-gallery";
    gallery.className = "d-field full d-gallery";
    gallery.hidden = true;
    const scopeValue = fields.get("scope");
    const scopeRow = scopeValue ? scopeValue.parentNode : null;
    if (scopeRow && scopeRow.parentNode === grid) grid.insertBefore(gallery, scopeRow.nextSibling);
    else grid.appendChild(gallery);

    refs.satDetail.replaceChildren(head, grid, viewing, tle, note);
    obsEl.viewing = viewing;
    obsEl.viewingTier = viewingTier;
    obsEl.viewingNext = viewingNext;
    obsEl.viewingAgeHint = viewingAgeHint;
    obsData.viewingFields = viewingFields;

    detailRefs = {
      flag: flag,
      name: name,
      sub: sub,
      badge: badge,
      fields: fields,
      composite: composite,
      scopeBadge: scopeBadge,
      gallery: gallery,
      viewing: viewing,
      tle: tleBody,
      note: note
    };
  }

  /* ---------- V12 观测成果画廊 ---------- */

  const galleryData = { items: [], index: 0, open: false, sig: null };
  const galleryUi = {
    overlay: null, img: null, fail: null, imgTitle: null, desc: null, credit: null, counter: null,
    prev: null, next: null, openLink: null
  };

  function galleryPageUrl(item) {
    const page = item && item.page ? String(item.page).trim() : "";
    if (!page) return "";
    // 只放行 https 外链，避免 javascript: / data: 之类
    return /^https:\/\//i.test(page) ? page : "";
  }

  function renderGallery(rawList, scopeLabel) {
    const box = detailRefs && detailRefs.gallery;
    if (!box) return;
    const items = (Array.isArray(rawList) ? rawList : []).filter(function (g) { return g && g.src; }).slice(0, 6);
    const sig = items.map(function (g) { return g.slug || g.src; }).join("|") + "#" + String(scopeLabel || "");
    if (sig === galleryData.sig) return;
    galleryData.sig = sig;
    galleryData.items = items;
    galleryData.index = 0;
    if (!items.length) {
      box.hidden = true;
      box.replaceChildren();
      closeGallery();
      return;
    }
    box.hidden = false;

    const head = document.createElement("div");
    head.className = "gallery-head";
    const title = document.createElement("span");
    title.className = "gallery-title";
    title.textContent = "📸 观测成果";
    if (scopeLabel) title.textContent += " · " + scopeLabel;
    title.appendChild(document.createTextNode(" "));
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = "GALLERY";
    title.appendChild(en);

    const right = document.createElement("span");
    right.className = "gallery-head-right";
    const badge = document.createElement("span");
    badge.className = "gallery-badge";
    badge.textContent = items.length + "/" + items.length;
    badge.title = "共 " + items.length + " 张观测图";
    right.appendChild(badge);

    const allPage = galleryPageUrl(items[0]);
    if (allPage) {
      const all = document.createElement("a");
      all.className = "gallery-all";
      all.href = allPage;
      all.target = "_blank";
      all.rel = "noopener noreferrer";
      all.textContent = "查看全部 ↗";
      all.title = "在 NASA 图片库查看该望远镜的观测图";
      right.appendChild(all);
    }
    head.appendChild(title);
    head.appendChild(right);

    const thumbs = document.createElement("div");
    thumbs.className = "gallery-thumbs";
    items.forEach(function (item, index) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gallery-thumb";
      btn.dataset.index = String(index);
      btn.title = item.titleEn || item.title || "观测成果";

      const frame = document.createElement("span");
      frame.className = "gallery-thumb-img";
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = item.title || "观测成果";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        frame.classList.add("is-fail");
        if (!frame.querySelector(".gallery-fail")) {
          const fail = document.createElement("span");
          fail.className = "gallery-fail";
          fail.textContent = "图片加载失败";
          frame.appendChild(fail);
        }
      });
      frame.appendChild(img);

      const caption = document.createElement("span");
      caption.className = "gallery-thumb-title";
      caption.textContent = item.title || "观测成果";

      btn.appendChild(frame);
      btn.appendChild(caption);
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        openGallery(index);
      });
      thumbs.appendChild(btn);
    });
    box.replaceChildren(head, thumbs);
  }

  function ensureGalleryOverlay() {
    let overlay = byId("gallery-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "gallery-overlay";
      overlay.className = "gallery-overlay";
      overlay.hidden = true;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "观测成果大图");

      const box = document.createElement("div");
      box.className = "gallery-box";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "link-btn gallery-close";
      close.textContent = "×";
      close.title = "关闭（Esc）";

      const imgTitle = document.createElement("div");
      imgTitle.className = "gallery-imgtitle";

      const imgWrap = document.createElement("div");
      imgWrap.className = "gallery-imgwrap";
      const img = document.createElement("img");
      img.className = "gallery-img";
      img.alt = "观测成果";
      img.decoding = "async";
      const fail = document.createElement("div");
      fail.className = "gallery-imgfail";
      fail.textContent = "图片加载失败";
      fail.hidden = true;
      imgWrap.appendChild(img);
      imgWrap.appendChild(fail);
      img.addEventListener("error", function () {
        img.hidden = true;
        fail.hidden = false;
      });
      img.addEventListener("load", function () {
        img.hidden = false;
        fail.hidden = true;
      });

      const cap = document.createElement("div");
      cap.className = "gallery-cap";
      const desc = document.createElement("span");
      desc.className = "gallery-cap-desc";
      const credit = document.createElement("span");
      credit.className = "gallery-cap-credit";
      const counter = document.createElement("span");
      counter.className = "gallery-cap-counter";
      const meta = document.createElement("span");
      meta.className = "gallery-cap-meta";
      meta.appendChild(credit);
      meta.appendChild(counter);
      cap.appendChild(desc);
      cap.appendChild(meta);

      const nav = document.createElement("div");
      nav.className = "gallery-navbtns";
      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "btn btn-ghost gallery-prev";
      prev.textContent = "‹ 上一张";
      const next = document.createElement("button");
      next.type = "button";
      next.className = "btn btn-ghost gallery-next";
      next.textContent = "下一张 ›";
      const openLink = document.createElement("button");
      openLink.type = "button";
      openLink.className = "btn gallery-open";
      openLink.textContent = "在原站查看 ↗";
      openLink.title = "在 NASA 图片库打开原图页面";
      openLink.hidden = true;
      openLink.addEventListener("click", function () {
        const page = galleryPageUrl(galleryData.items[galleryData.index]);
        if (!page) return;
        window.open(page, "_blank", "noopener,noreferrer");
      });
      nav.appendChild(prev);
      nav.appendChild(next);
      nav.appendChild(openLink);

      box.appendChild(close);
      box.appendChild(imgTitle);
      box.appendChild(imgWrap);
      box.appendChild(cap);
      box.appendChild(nav);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      prev.addEventListener("click", function () { stepGallery(-1); });
      next.addEventListener("click", function () { stepGallery(1); });
      close.addEventListener("click", closeGallery);
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeGallery();
      });

      galleryUi.overlay = overlay;
      galleryUi.img = img;
      galleryUi.fail = fail;
      galleryUi.imgTitle = imgTitle;
      galleryUi.desc = desc;
      galleryUi.credit = credit;
      galleryUi.counter = counter;
      galleryUi.prev = prev;
      galleryUi.next = next;
      galleryUi.openLink = openLink;
    }
    return overlay;
  }

  function showGalleryIndex(index) {
    if (!galleryData.items.length) return;
    const n = galleryData.items.length;
    galleryData.index = ((index % n) + n) % n;
    const item = galleryData.items[galleryData.index];
    if (!item) return;
    ensureGalleryOverlay();
    if (galleryUi.img) {
      galleryUi.img.hidden = false;
      galleryUi.img.src = item.src;
      galleryUi.img.alt = item.title || "观测成果";
    }
    if (galleryUi.fail) galleryUi.fail.hidden = true;
    const titleText = item.title || "观测成果";
    if (galleryUi.imgTitle) {
      setText(galleryUi.imgTitle, titleText);
      galleryUi.imgTitle.title = item.titleEn || "";
    }
    if (galleryUi.desc) {
      setText(galleryUi.desc, item.desc || "");
      galleryUi.desc.title = item.desc || "";
      galleryUi.desc.hidden = !item.desc;
    }
    if (galleryUi.credit) {
      const creditText = item.credit || item.creditFull || "";
      setText(galleryUi.credit, creditText ? "出处：" + creditText : "");
      galleryUi.credit.title = item.creditFull && item.creditFull !== item.credit ? item.creditFull : "";
      galleryUi.credit.hidden = !creditText;
    }
    if (galleryUi.counter) setText(galleryUi.counter, (galleryData.index + 1) + "/" + n);
    if (galleryUi.prev) galleryUi.prev.disabled = n <= 1;
    if (galleryUi.next) galleryUi.next.disabled = n <= 1;
    if (galleryUi.openLink) galleryUi.openLink.hidden = !galleryPageUrl(item);
  }

  function openGallery(index) {
    if (!galleryData.items.length) return;
    ensureGalleryOverlay();
    if (!galleryUi.overlay) return;
    galleryUi.overlay.hidden = false;
    galleryData.open = true;
    showGalleryIndex(index || 0);
    const close = galleryUi.overlay.querySelector(".gallery-close");
    if (close && typeof close.focus === "function") close.focus();
  }

  function closeGallery() {
    if (!galleryUi.overlay) return;
    galleryUi.overlay.hidden = true;
    galleryData.open = false;
  }

  function stepGallery(delta) {
    if (!galleryData.open) return;
    showGalleryIndex(galleryData.index + delta);
  }

  function renderDetail(detail) {
    if (!detailRefs) return;

    const d = detail || {};
    const country = d.country || {};
    obsData.selectionDetail = d;

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

    // V20：细分类型（subcategory）——字段缺失时整行隐藏
    const subEl = detailRefs.fields.get("subtype");
    if (subEl) {
      const subKey = d.subcategory ? String(d.subcategory) : "";
      const subText = String(
        (lang === "en"
          ? (d.subcategoryLabelEn || d.subcategoryLabel || d.subcategoryLabelZh)
          : (d.subcategoryLabelZh || d.subcategoryLabel || d.subcategoryLabelEn)) || subKey || ""
      ).trim();
      const subRow = subEl.parentNode;
      if (subRow) subRow.hidden = !subText;
      setText(subEl, subText || "--");
      subEl.title = subText && subKey && subKey !== subText ? subKey : "";
    }

    // V5：对象类型（objectKind 优先）+ RCS
    const kindKey = normalizeObjectKind(d.objectKind) || normalizeObjectKind(d.objectType);
    const kindText = OBJECT_KIND_LABELS[kindKey] || (d.objectKind || d.objectType || "--");
    field("type", kindText + (isNum(d.rcs) && Number(d.rcs) > 0 ? " · RCS " + fmtRcs(d.rcs) : ""));
    const typeEl = detailRefs.fields.get("type");
    if (typeEl) {
      const kindTitle = kindText + (isNum(d.rcs) && Number(d.rcs) > 0 ? " · RCS " + fmtRcs(d.rcs) : "");
      if (typeEl.title !== kindTitle) typeEl.title = kindTitle;
    }
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

    // V5：望远镜徽标 + 类型
    const isScope = d.isTelescope === true;
    const scopeTypeKey = String(d.telescopeType || "").toLowerCase();
    const scopeTypeText = TELESCOPE_TYPES[scopeTypeKey] || (d.telescopeType ? String(d.telescopeType) : "--");
    // V15：望远镜中文名（英文代号）
    const scopeName = isScope ? String(d.nameZh || "").trim() : "";
    const scopeLabel = scopeName
      ? (d.name ? scopeName + "（" + d.name + "）" : scopeName)
      : "";
    const scopeEl = detailRefs.fields.get("scope");
    if (scopeEl) {
      const scopeRow = scopeEl.parentNode;
      if (scopeRow) scopeRow.hidden = !isScope;
      if (isScope) {
        const scopeText = (scopeLabel ? scopeLabel + " · " : "") + "望远镜类型：" + scopeTypeText;
        setText(scopeEl, scopeText);
        scopeEl.title = scopeText;
      } else {
        setText(scopeEl, "--");
        scopeEl.title = "";
      }
    }

    // V12/V15：观测成果画廊（非望远镜 / 空数组时整块隐藏）
    renderGallery(d.gallery, scopeName || (isScope ? d.name : ""));
    if (detailRefs.scopeBadge) {
      detailRefs.scopeBadge.hidden = !isScope;
      detailRefs.scopeBadge.title = isScope ? "天文望远镜 · " + scopeTypeText : "";
      detailRefs.scopeBadge.setAttribute("aria-label", isScope ? "天文望远镜" : "");
    }

    // V7：空间站 / 载人
    const stationKey = String(d.stationType || "").toLowerCase();
    const isStation = d.isStation === true || (!!stationKey && !!STATION_TYPES[stationKey]);
    const stationText = STATION_TYPES[stationKey] || (d.stationType ? String(d.stationType) : "--");
    const stationEl = detailRefs.fields.get("station");
    if (stationEl) {
      const stationRow = stationEl.parentNode;
      if (stationRow) stationRow.hidden = !isStation;
      if (isStation) {
        setText(stationEl, stationText);
        stationEl.title = "空间站 / 载人：" + stationText;
      } else {
        setText(stationEl, "--");
        stationEl.title = "";
      }
    }

    markObsSelected(d.name);

    const tleLines = [d.tle1, d.tle2].filter(function (line) { return typeof line === "string" && line; });
    currentTle = tleLines.join("\n");
    setText(detailRefs.tle, currentTle || "--");

    if (refs.detailBlock && refs.detailBlock.hidden) {
      refs.detailBlock.hidden = false;
      presentDetail();
    } else if (fp.mode === "float") {
      if (!fp.appliedKey || fp.appliedKey !== fp.selectionKey) {
        fp.appliedKey = fp.selectionKey;
        positionFloatingDetail(fp.anchor);
      }
      updateDockPlaceholder();
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
    if (fp.placeholder) fp.placeholder.hidden = true;
    closeGallery();
    obsData.detail = null;
    if (obsEl.viewing) obsEl.viewing.hidden = true;
    markObsSelected(null);
    setFollowingState(false);
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

    const prevScroll = listEl.scrollTop;
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

    // 联动计数会频繁重排，保留滚动位置（否则每次筛选都跳到顶部）
    if (prevScroll > 0) {
      const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
      listEl.scrollTop = Math.min(prevScroll, maxScroll);
    }
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

  /** 外部恢复搜索词（URL 分享 / 刷新页面），不触发 onSearch 回调 */
  function setSearchState(query) {
    const q = query == null ? "" : String(query);
    if (refs.searchInput && refs.searchInput.value !== q) {
      refs.searchInput.value = q;
    }
    setSearchHint(q);
  }

  function bindSearch() {
    const input = refs.searchInput;
    if (!input) return;

    input.addEventListener("input", function () {
      const query = input.value.trim();
      setSearchHint(query);
      refreshClearFilters();
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

  /* ---------- V18 清空筛选 ---------- */

  const filterUi = { btn: null, countEl: null, external: null };

  function ensureClearFilters() {
    const input = refs.searchInput;
    const block = input && input.closest ? input.closest(".panel-block") : null;
    const title = block ? block.querySelector(".panel-title") : null;
    if (!title) return filterUi.btn;

    let btn = byId("clear-filters");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "clear-filters";
      btn.className = "link-btn clear-filters";
      btn.disabled = true;
      btn.title = "当前没有筛选条件";
      btn.appendChild(document.createTextNode("✕ 清空筛选"));
      const cnt = document.createElement("span");
      cnt.className = "cf-count";
      cnt.hidden = true;
      btn.appendChild(cnt);
      btn.addEventListener("click", clearAllFilters);
      title.appendChild(btn);
      filterUi.countEl = cnt;
    }
    filterUi.btn = btn;
    return btn;
  }

  function countActiveIn(map) {
    let active = 0;
    map.forEach(function (entry) {
      if (entry && entry.el && entry.el.classList.contains("active")) active++;
    });
    return active;
  }

  function activeFilterCount() {
    let n = 0;
    if (orbitFiltering) n += countActiveIn(orbitChips);
    if (categoryFiltering) n += countActiveIn(categoryChips);
    if (countryFiltered) {
      let c = 0;
      activeCountry.forEach(function (on) { if (on) c++; });
      n += c;
    }
    if (refs.searchInput && String(refs.searchInput.value || "").trim()) n += 1;
    if (telescopeOnly) n += 1;
    if (stationOnly) n += 1;
    if (showDebris) n += 1;
    // main 也可能下发权威计数（例如它自己还要算 URL 参数这类 UI 不知道的条件）
    if (n === 0 && typeof filterUi.external === "number") return filterUi.external;
    return n;
  }

  function refreshClearFilters() {
    const btn = ensureClearFilters();
    if (!btn) return;
    const n = activeFilterCount();
    btn.disabled = n <= 0;
    btn.classList.toggle("is-disabled", n <= 0);
    if (filterUi.countEl) {
      filterUi.countEl.textContent = n > 0 ? " · " + n : "";
      filterUi.countEl.hidden = n <= 0;
    }
    btn.title = n > 0 ? "清空全部筛选（当前 " + n + " 项）" : "当前没有筛选条件";
  }

  function clearAllFilters() {
    orbitFiltering = false;
    orbitChips.forEach(function (value, key) { setOrbitVisual(key, true); });
    categoryFiltering = false;
    categoryChips.forEach(function (value, key) { setCategoryVisual(key, true); });
    countryFiltered = false;
    activeCountry.forEach(function (value, key) { activeCountry.set(key, true); });
    applyCountryClasses();
    setTelescopeOnly(false, false);
    setStationOnly(false, false);
    setShowDebris(false, false);
    if (subcategoryList.length) {
      subcategoryList.forEach(function (item) { item.active = false; });
      subchipsSig = "";
      renderSubcategories();
    }
    if (refs.searchInput) {
      refs.searchInput.value = "";
      setSearchHint("");
    }
    filterUi.external = null;
    refreshClearFilters();
    callHandler("onClearFilters");
  }

  function setFiltersSummary(summary) {
    const s = summary || {};
    filterUi.external = typeof s.count === "number" ? s.count : null;
    refreshClearFilters();
  }


  /* ---------- V20 · 二级任务类型（细分）---------- */

  let subcategoryList = [];
  let subchipsSig = "";

  function selectedCategoryKeys() {
    const keys = [];
    categoryChips.forEach(function (entry, key) {
      if (entry && entry.el && entry.el.classList.contains("active")) keys.push(key);
    });
    return keys;
  }

  function ensureSubcategoryRow() {
    let row = byId("subcategory-chips");
    if (row) return row;
    const catChips = refs.categoryChips;
    const block = catChips && catChips.closest ? catChips.closest(".panel-block") : null;
    if (!block || !catChips) return null;
    row = document.createElement("div");
    row.id = "subcategory-chips";
    row.className = "chips subcategory-chips";
    row.hidden = true;
    row.setAttribute("aria-label", "细分类型");
    if (catChips.nextSibling) block.insertBefore(row, catChips.nextSibling);
    else block.appendChild(row);
    return row;
  }

  function subcategoryLabelOf(item) {
    if (lang === "en") return item.labelEn || item.label || item.labelZh || item.key;
    return item.labelZh || item.label || item.labelEn || item.key;
  }

  function renderSubcategories() {
    const row = ensureSubcategoryRow();
    if (!row) return;
    if (!refs.subcategoryChips) refs.subcategoryChips = row;

    const cats = selectedCategoryKeys();
    const totalChips = categoryChips.size;
    // 只有「全部大类里恰好 1 个被选中」时才展开细分行
    const single = cats.length === 1 && totalChips > 1 ? cats[0] : "";
    const items = single
      ? subcategoryList.filter(function (item) { return item && item.category === single; })
      : [];

    if (!items.length) {
      if (!row.hidden) {
        row.hidden = true;
        row.replaceChildren();
      }
      subchipsSig = "";
      return;
    }

    const sig = single + "|" + lang + "|" + items.map(function (item) {
      return item.key + ":" + (item.count === null || item.count === undefined ? "-" : item.count) + (item.active ? "a" : "");
    }).join(",");
    if (sig === subchipsSig && !row.hidden) return;
    subchipsSig = sig;
    row.hidden = false;

    const frag = document.createDocumentFragment();
    const head = document.createElement("span");
    head.className = "subchips-title";
    head.textContent = "细分 SUBTYPE";
    frag.appendChild(head);

    items.forEach(function (item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip subchip" + (item.active ? " active" : "");
      btn.dataset.subcategory = item.key;
      btn.setAttribute("aria-pressed", item.active ? "true" : "false");
      const name = subcategoryLabelOf(item);
      const countNull = item.count === null || item.count === undefined;
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = name;
      const count = document.createElement("span");
      count.className = "chip-count" + (countNull ? " is-hidden-count" : "");
      count.textContent = countNull ? "--" : fmtInt(item.count);
      btn.appendChild(label);
      btn.appendChild(count);
      btn.title = name + " · " + (countNull ? "--" : fmtInt(item.count));
      btn.addEventListener("click", function () {
        const on = !btn.classList.contains("active");
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        item.active = on;
        subchipsSig = "";
        callHandler("onSubcategoryToggle", item.key, on);
      });
      frag.appendChild(btn);
    });

    row.replaceChildren(frag);
  }

  function updateSubcategories(list) {
    subcategoryList = Array.isArray(list) ? list.filter(function (item) { return item && item.key; }) : [];
    subchipsSig = "";
    renderSubcategories();
  }

  /* ---------- V19 · 隐私提示条 ---------- */

  const CONSENT_KEY = "holomirror.consent";

  function consentDecided() {
    try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch (err) { return true; }
  }

  function ensureConsent() {
    if (consentUi.bar) return consentUi.bar;
    const bar = document.createElement("div");
    bar.id = "consent-bar";
    bar.className = "consent-bar";
    bar.hidden = true;
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "隐私提示");

    const text = document.createElement("span");
    text.className = "consent-text";

    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-btn consent-link";
    link.textContent = "隐私说明 ↗";
    link.addEventListener("click", function () {
      window.open("/privacy.html", "_blank", "noopener,noreferrer");
    });

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-compact consent-ok";
    ok.textContent = "知道了";
    ok.addEventListener("click", function () {
      try { localStorage.setItem(CONSENT_KEY, "1"); } catch (err) { /* 忽略 */ }
      bar.classList.remove("show");
      bar.hidden = true;
    });

    bar.appendChild(text);
    bar.appendChild(link);
    bar.appendChild(ok);
    document.body.appendChild(bar);

    consentUi.bar = bar;
    consentUi.text = text;
    consentUi.link = link;
    consentUi.ok = ok;
    return bar;
  }

  function renderConsent() {
    if (!consentUi.bar) return;
    const zh = lang !== "en";
    consentUi.text.textContent = zh
      ? "本站不使用 Cookie、不做追踪，仅在你本机保存偏好。"
      : "No cookies, no tracking. Preferences are stored only on your device.";
    consentUi.link.textContent = zh ? "隐私说明 ↗" : "Privacy ↗";
    consentUi.ok.textContent = zh ? "知道了" : "Got it";
    consentUi.bar.setAttribute("aria-label", zh ? "隐私提示" : "Privacy notice");
  }

  function initConsent() {
    ensureConsent();
    renderConsent();
    if (consentDecided()) {
      consentUi.bar.hidden = true;
      return;
    }
    consentUi.bar.hidden = false;
    consentUi.bar.classList.add("show");
  }

  let localizeObserver = null;
  function startLocalizeObserver() {
    if (localizeObserver || typeof MutationObserver === "undefined") return;
    localizeObserver = new MutationObserver(function () { scheduleLocalize(); });
    localizeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
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

  /* ---------- V7 全局搜索覆盖层 ---------- */

  const gs = {
    overlay: null, panel: null, input: null, list: null, hint: null,
    rows: [], active: -1, open: false, timer: 0, requestId: 0, query: ""
  };

  function ensureGlobalSearch() {
    let overlay = byId("search-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "search-overlay";
      overlay.className = "search-overlay";
      overlay.hidden = true;

      const panel = document.createElement("div");
      panel.className = "search-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "全局搜索");

      const head = document.createElement("div");
      head.className = "search-head";
      const icon = document.createElement("span");
      icon.className = "search-icon";
      icon.textContent = "🔍";
      const input = document.createElement("input");
      input.id = "global-search-input";
      input.className = "global-search-input";
      input.type = "text";
      input.placeholder = "搜索卫星 / 空间站 / 望远镜 / 公司 / 国家…";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "全局搜索");
      const kbd = document.createElement("kbd");
      kbd.className = "search-kbd";
      kbd.textContent = "Esc";
      head.appendChild(icon);
      head.appendChild(input);
      head.appendChild(kbd);

      const list = document.createElement("div");
      list.id = "global-search-results";
      list.className = "search-results";
      list.setAttribute("role", "listbox");

      const hint = document.createElement("div");
      hint.id = "global-search-hint";
      hint.className = "search-hint";
      hint.textContent = SEARCH_EMPTY_HINT;

      panel.appendChild(head);
      panel.appendChild(list);
      panel.appendChild(hint);
      overlay.appendChild(panel);

      overlay.addEventListener("mousedown", function (event) {
        if (event.target === overlay) closeGlobalSearch();
      });
      panel.addEventListener("mousedown", function (event) { event.stopPropagation(); });
      input.addEventListener("input", function () { scheduleSearch(input.value); });
      input.addEventListener("keydown", onSearchKeydown);
      list.addEventListener("click", onSearchListClick);

      (document.body || document.documentElement).appendChild(overlay);
    }
    gs.overlay = overlay;
    gs.panel = overlay.querySelector(".search-panel");
    gs.input = byId("global-search-input");
    gs.list = byId("global-search-results");
    gs.hint = byId("global-search-hint");
    return overlay;
  }

  function ensureSearchEntry() {
    let btn = byId("global-search-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "global-search-btn";
      btn.className = "observer-chip search-entry";
      const icon = document.createElement("span");
      icon.className = "oc-icon";
      icon.textContent = "🔍";
      const label = document.createElement("span");
      label.className = "oc-label";
      label.textContent = "搜索";
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.title = "全局搜索（快捷键 /）";
      btn.setAttribute("aria-label", "打开全局搜索");
      const chip = byId("observer-chip");
      if (chip && chip.parentNode) chip.parentNode.insertBefore(btn, chip.nextSibling);
      else if (refs.dataStatus && refs.dataStatus.parentNode) refs.dataStatus.parentNode.insertBefore(btn, refs.dataStatus.nextSibling);
      else if (refs.panelRight && refs.panelRight.parentNode) refs.panelRight.parentNode.appendChild(btn);
    }
    if (!btn.dataset.bound) {
      btn.addEventListener("click", toggleGlobalSearch);
      btn.dataset.bound = "1";
    }
  }

  function openGlobalSearch() {
    ensureGlobalSearch();
    if (!gs.overlay) return;
    gs.overlay.hidden = false;
    gs.open = true;
    if (document.body) document.body.classList.add("search-open");
    if (gs.input) {
      gs.input.focus();
      try { gs.input.select(); } catch (err) { /* ignore */ }
      if (gs.input.value.trim()) scheduleSearch(gs.input.value, 0);
      else renderSearchResults();
    }
  }

  function closeGlobalSearch() {
    if (!gs.overlay) return;
    gs.overlay.hidden = true;
    gs.open = false;
    if (document.body) document.body.classList.remove("search-open");
    if (gs.input && typeof gs.input.blur === "function") gs.input.blur();
  }

  function toggleGlobalSearch() {
    if (gs.open) closeGlobalSearch();
    else openGlobalSearch();
  }

  function scheduleSearch(value, delay) {
    if (gs.timer) window.clearTimeout(gs.timer);
    const text = String(value || "");
    const wait = typeof delay === "number" ? delay : 120;
    if (wait <= 0) {
      gs.timer = 0;
      runSearch(text);
      return;
    }
    gs.timer = window.setTimeout(function () {
      gs.timer = 0;
      runSearch(text);
    }, wait);
  }

  function runSearch(text) {
    const query = String(text || "").trim();
    gs.query = query;
    if (!query) {
      gs.rows = [];
      gs.active = -1;
      renderSearchResults();
      return;
    }
    const fn = h.onSearchQuery;
    if (typeof fn !== "function") {
      gs.rows = [];
      gs.active = -1;
      renderSearchResults();
      return;
    }
    const requestId = ++gs.requestId;
    let result;
    try {
      result = fn(query);
    } catch (err) {
      result = [];
    }
    Promise.resolve(result).then(function (list) {
      if (requestId !== gs.requestId) return;
      gs.rows = Array.isArray(list) ? list.slice(0, 12) : [];
      gs.active = gs.rows.length ? 0 : -1;
      renderSearchResults();
    }).catch(function () {
      if (requestId !== gs.requestId) return;
      gs.rows = [];
      gs.active = -1;
      renderSearchResults();
    });
  }

  function searchRowName(item) {
    const prefix = (item.isTelescope ? "🔭 " : "") + (item.isStation ? "🛰️ " : "");
    return prefix + (item.name || ("#" + (item.index != null ? item.index : "")));
  }

  function searchCountryText(item) {
    const c = item.country;
    if (c && typeof c === "object") return String(c.name || c.code || "").trim();
    return c ? String(c).trim() : "";
  }

  function searchOperatorText(item) {
    const o = item.operator;
    if (o && typeof o === "object") return String(o.nameZh || o.name || "").trim();
    return o ? String(o).trim() : "";
  }

  function renderSearchResults() {
    const list = gs.list;
    if (!list) return;
    if (!gs.rows.length) {
      list.replaceChildren();
      if (gs.hint) {
        gs.hint.textContent = gs.query ? "没有匹配的目标 · " + SEARCH_EMPTY_HINT : SEARCH_EMPTY_HINT;
      }
      return;
    }
    const frag = document.createDocumentFragment();
    gs.rows.forEach(function (item, i) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "search-row" + (i === gs.active ? " is-active" : "");
      row.dataset.index = String(item.index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === gs.active ? "true" : "false");

      const main = document.createElement("span");
      main.className = "sr-main";
      const name = document.createElement("span");
      name.className = "sr-name";
      name.textContent = searchRowName(item);
      const sub = document.createElement("span");
      sub.className = "sr-sub";
      const parts = [];
      if (item.id != null) parts.push("NORAD " + fmtInt(item.id));
      const country = searchCountryText(item);
      if (country) parts.push(country);
      const operator = searchOperatorText(item);
      if (operator) parts.push(operator);
      sub.textContent = parts.join(" · ") || "--";
      main.appendChild(name);
      main.appendChild(sub);

      const tags = document.createElement("span");
      tags.className = "sr-tags";
      const cat = document.createElement("span");
      cat.className = "sr-tag";
      cat.textContent = item.categoryLabel || "--";
      const orbit = document.createElement("span");
      orbit.className = "sr-tag";
      orbit.textContent = item.orbitClass || "--";
      tags.appendChild(cat);
      tags.appendChild(orbit);

      row.appendChild(main);
      row.appendChild(tags);
      frag.appendChild(row);
    });
    list.replaceChildren(frag);
    if (gs.hint) {
      gs.hint.textContent = gs.rows.length + " 条结果 · ↑↓ 选择 · Enter 跳转 · Esc 关闭";
    }
  }

  function moveSearchActive(delta) {
    if (!gs.rows.length) return;
    const count = gs.rows.length;
    let next = gs.active + delta;
    if (next < 0) next = count - 1;
    if (next >= count) next = 0;
    gs.active = next;
    renderSearchResults();
    const active = gs.list ? gs.list.querySelector(".search-row.is-active") : null;
    if (active && typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
  }

  function pickSearch(index) {
    if (!Number.isFinite(index)) return;
    closeGlobalSearch();
    callHandler("onSearchPick", index);
  }

  function onSearchListClick(event) {
    const target = event.target;
    const row = target && target.closest ? target.closest(".search-row") : null;
    if (!row) return;
    pickSearch(Number(row.dataset.index));
  }

  function onSearchKeydown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSearchActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchActive(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = gs.active >= 0 ? gs.rows[gs.active] : null;
      if (item) pickSearch(item.index);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      event.stopPropagation();
      closeGlobalSearch();
    }
  }

  function bindKeyboard() {
    window.addEventListener("keydown", function (event) {
      const tag = event.target && event.target.tagName ? event.target.tagName : "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (v4.helpOpen) {
        if (event.key === "Escape" || event.key === "?" || (event.key === "/" && event.shiftKey)) {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          event.stopPropagation();
          closeHelp();
        }
        return;
      }

      if (galleryData.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          event.stopPropagation();
          closeGallery();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          event.stopPropagation();
          stepGallery(event.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        return;
      }

      if (settingsUi.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          event.stopPropagation();
          closeSettings();
        }
        return;
      }

      if (gs.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          event.stopPropagation();
          closeGlobalSearch();
        }
        return;
      }

      const isQuestion = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (isQuestion && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openHelp();
        return;
      }

      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        toggleGlobalSearch();
        return;
      }

      if (event.key !== "Escape") return;
      if (v4.pickMode) {
        exitPickMode();
        return;
      }
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

    // V9：显示 N / 共 M
    if (!refs.statSummary) refs.statSummary = byId("stat-summary");
    if (refs.statSummary) {
      const rendered = isNum(s.rendered) ? Number(s.rendered) : null;
      const total = isNum(s.total) ? Number(s.total) : null;
      if (rendered !== null && total !== null) {
        setText(refs.statSummary, "显示 " + fmtInt(rendered) + " / 共 " + fmtInt(total));
        refs.statSummary.hidden = false;
      } else {
        refs.statSummary.hidden = true;
      }
    }

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
      // 统一走 updateCategoryChip：count 为 null（如未启用的碎片）时显示「默认隐藏」而不是 --
      s.byCategory.forEach(updateCategoryChip);
      renderCategoryBars(s.byCategory);
    }

    if (Array.isArray(s.byObjectKind)) renderObjectKindBars(s.byObjectKind);

    if (Array.isArray(s.topCountries)) renderCountryBars(s.topCountries);
  }

  function renderCountries(list, allShown) {
    if (Array.isArray(list)) lastCountryList = { list: list, allShown: !!allShown };
    if (!Array.isArray(list)) return;
    const total = list.length;
    // 签名带上名称（名称随语言变化），保证切换语言时国家名会重渲染
    const signature = list.slice(0, COUNTRY_LIMIT).map(function (item) {
      return item && (item.code + ":" + (item.name || ""));
    }).join("|") + "#" + total;

    if (signature !== lastCountrySignature) {
      rebuildCountryList(list, total);
      lastCountrySignature = signature;
    }

    activeCountry.clear();
    list.forEach(function (item) {
      if (!item || !item.code) return;
      activeCountry.set(item.code, item.active !== false);
      if (item.name) countryNameMap.set(item.code, item.name);
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
    refreshClearFilters();
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

    if (c.offsetMinutes !== undefined && c.offsetMinutes !== null) {
      syncSeek(c.offsetMinutes);
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


  /* ---------- V19 · 中英文文案（zh → en） ---------- */
  const I18N_EN = {
    "检索": "Search", "检索：": "Search:", "轨道类型": "Orbit", "任务类型": "Mission",
    "国家 / 组织": "Nation / Org", "概览": "Overview", "观测": "Observe",
    "图层与显示": "Layers & Display", "时间显示": "Time Display", "设置": "Settings",
    "关闭": "Close", "搜索": "Search", "筛选": "Filters", "清空筛选": "Clear filters",
    "✕ 清空筛选": "✕ Clear filters", "全局搜索": "Global search", "快捷键": "Shortcuts",
    "快捷键帮助": "Shortcut help", "快捷键帮助 (?)": "Shortcut help (?)",
    "打开 / 关闭本快捷键面板": "Open / close shortcut help",
    "打开全局搜索": "Open global search", "打开设置": "Open settings",
    "按 Esc 或点击空白处关闭": "Press Esc or click outside to close",
    "按 Esc 或点击空白处关闭 · 设置会自动保存": "Press Esc or click outside to close · settings save automatically",
    "关闭（Esc）": "Close (Esc)",
    "刷新": "Refresh", "重置视角": "Reset view", "重置视角 (R)": "Reset view (R)",
    "截图": "Screenshot", "截图并下载 PNG": "Capture and download PNG",
    "当前版本不支持截图": "Screenshot not supported in this build",
    "暂停": "Pause", "暂停 / 继续时间": "Pause / resume time", "暂停时间": "Paused",
    "现在": "Now", "实时": "Live", "时间格式": "Time format", "时区 TZ": "Time zone TZ",
    "12 小时制": "12-hour", "24 小时制": "24-hour", "偏移": "Offset", "自定义": "Custom",
    "自动旋转": "Auto-rotate", "自动旋转：": "Auto-rotate:", "跟随自转": "Follow rotation",
    "跟随地球自转": "Follow Earth rotation", "相机环绕": "Camera orbit",
    "自动旋转已关闭 · 点击开启跟随地球自转": "Auto-rotate off · click to follow Earth rotation",
    "自动旋转，当前": "Auto-rotate, current",
    "拖动调整时间：−24h ~ +24h（双击回到现在）": "Drag to scrub time: -24h ~ +24h (double-click to reset)",
    "相对当前真实时间的偏移": "Offset from real time now",
    "时间轴偏移（分钟，-1440 ~ +1440）": "Timeline offset (minutes, -1440 ~ +1440)",
    "时间流速 ×": "Time rate ×",
    "星空": "Stars", "背景星点": "Background stars", "经纬网": "Graticule",
    "地球经纬线": "Earth graticule", "大气辉光": "Atmosphere glow",
    "大气发光边缘": "Atmospheric limb", "轨道线": "Orbit lines",
    "🌗 晨昏线": "🌗 Terminator", "🧭 本初子午线": "🧭 Prime meridian",
    "昼夜分界 · 夜面压暗 + 琥珀分界线": "Day/night boundary · dimmed night side with amber line",
    "0° 金色 / 180° 淡蓝经线": "0° amber / 180° cyan meridians",
    "望远镜星标": "Telescope markers", "🔭 金色星标层": "🔭 Golden marker layer",
    "金色星标 = 天文望远镜": "Golden star = space telescope",
    "金色图钉 = 观测点": "Golden pin = observer site",
    "琥珀环 = 当前悬停 / 选中目标": "Amber ring = hovered / selected target",
    "大点 = 空间站 / 载人飞船": "Large dot = station / crewed craft",
    "标记图例": "Legend", "显示 / 隐藏": "Show / hide",
    "图层": "Layers", "显示": "Show", "图片加载失败": "Image failed to load",
    "观测成果": "Observation gallery", "📸 观测成果": "📸 Observation gallery",
    "观测成果大图": "Observation image", "查看全部 ↗": "View all ↗",
    "在原站查看 ↗": "Open source page ↗", "‹ 上一张": "‹ Prev", "下一张 ›": "Next ›",
    "出处：": "Credit: ", "张观测图": "images",
    "在 NASA 图片库查看该望远镜的观测图": "View this telescope gallery on NASA Images",
    "在 NASA 图片库打开原图页面": "Open the original page on NASA Images",
    "望远镜类型：": "Telescope type: ", "望远镜 TELESCOPE": "Telescope TELESCOPE",
    "望远镜": "Telescopes", "望远镜可观测": "Observable", "望远镜跟踪": "Telescope tracking",
    "天文望远镜 ·": "Telescope ·", "暂无望远镜数据": "No telescope data",
    "设置观测地点后可判断望远镜可观测性": "Set an observer site to evaluate telescope visibility",
    "正在计算望远镜窗口…": "Computing telescope windows…",
    "空间站 / 载人": "Station / Crewed", "空间站 / 载人：": "Station / Crewed: ",
    "常驻空间站": "Space station", "空间站": "Stations",
    "🔭 只看望远镜": "🔭 Telescopes only", "🛰️ 只看空间站": "🛰️ Stations only",
    "🛰️ 显示碎片": "🛰️ Show debris",
    "只显示天文 / 空间科学望远镜": "Show telescopes and space-science payloads only",
    "只显示空间站与载人 / 货运飞船": "Show stations and crewed / cargo vehicles only",
    "显示碎片 / 残骸目标（默认隐藏）": "Show debris and rocket bodies (hidden by default)",
    "碎片默认显示": "Show debris by default",
    "默认隐藏碎片 / 残骸": "Hide debris and rocket bodies by default",
    "默认隐藏": "Hidden by default", "默认隐藏，点本芯片可查看": "Hidden by default, click the chip to show",
    "当前没有筛选条件": "No filters active",
    "清空全部筛选（当前": "Clear all filters (", "项）": " active)",
    "已清空全部筛选": "All filters cleared",
    "高度 ALT": "Altitude ALT", "速度 VEL": "Speed VEL", "周期 PERIOD": "Period PERIOD",
    "倾角 INCL": "Inclination INCL", "近地点 PERI": "Perigee PERI", "远地点 APO": "Apogee APO",
    "纬度 LAT": "Latitude LAT", "经度 LON": "Longitude LON",
    "所属公司 / 机构": "Operator", "对象类型": "Object type", "运行状态": "Status",
    "发射日期": "Launch date", "星历龄期 AGE": "Ephemeris age AGE",
    "观看": "Viewing", "观测状态 STATUS": "Observing STATUS",
    "距离 RANGE": "Range RANGE", "仰角 EL": "Elevation EL", "方位 AZ": "Azimuth AZ",
    "估算星等 MAG": "Est. mag MAG", "TLE 龄期": "TLE age",
    "国际编号 / NORAD": "Intl. designator / NORAD", "轨道倾角": "Inclination",
    "星历较旧，位置误差可能增大": "Stale ephemeris, position error may grow",
    "暂无 TLE 数据": "No TLE data", "复制": "Copy", "复制两行 TLE 根数": "Copy two-line elements",
    "复制失败，请手动选择": "Copy failed, please select manually", "TLE 已复制": "TLE copied",
    "确定": "OK", "取消": "Cancel", "清除": "Clear",
    "卫星总数": "Total satellites", "当前可见": "Visible now", "当前渲染": "Rendered",
    "本地缓存 CACHE": "Local cache CACHE", "实时全量目录（≥": "Live full catalog (≥",
    "显示 -- / 共 --": "Showing -- / of --", "显示": "Showing",
    "/ 共": " / of ", "共": "of ", "条结果 · ↑↓ 选择 · Enter 跳转 · Esc 关闭":
      "results · ↑↓ to select · Enter to jump · Esc to close",
    "没有匹配的目标 ·": "No matching targets ·",
    "试试 ISS / 天和 / 哈勃 / Starlink / 遥感 / 望远镜": "Try ISS / Tiangong / Hubble / Starlink / EO / telescope",
    "搜索卫星 / 空间站 / 望远镜 / 公司 / 国家…": "Search satellites / stations / telescopes / operators / nations…",
    "支持名称 / NORAD 编号 / 国家代码": "Supports name / NORAD ID / country code",
    "任务类型分布": "Missions", "对象类型分布": "Object types",
    "卫星数量 TOP 国家": "Top nations",
    "任务类型按名称与目录规则推断": "Mission type inferred from name and catalog rules",
    "数据来源：": "Data source: ", "数据链路": "Data link",
    "本地合成 LOCAL": "Local blend LOCAL", "内置快照 SNAPSHOT": "Built-in snapshot SNAPSHOT",
    "备份（不跟踪）": "Backup (no tracking)", "低置信": "Low confidence",
    "中置信": "Medium confidence", "高置信": "High confidence",
    "观测点": "Observer", "观测地点": "Observer site", "观测点：": "Observer: ",
    "设置观测点": "Set observer", "观测点纬度": "Observer latitude", "观测点经度": "Observer longitude",
    "使用我的位置": "Use my location", "📍 使用我的位置": "📍 Use my location",
    "使用浏览器定位（需授权）": "Use browser geolocation (permission required)",
    "使用手动输入的经纬度": "Use manual coordinates",
    "选择城市预设": "City preset", "选择城市预设…": "Choose a city preset…",
    "自定义位置": "Custom location", "在地球表面设置观测点": "Pick a point on the globe",
    "在地球上点击以设置观测点": "Click the globe to set the observer",
    "🎯 在地球上选点": "🎯 Pick on globe",
    "进入选点模式后在地球表面点击（也可按住 Alt 点击）": "In pick mode click the globe surface (or Alt+click)",
    "当前版本不支持在地球上选点": "Picking on the globe is not supported in this build",
    "请输入有效经纬度（纬度 -90~90，经度 -180~180）": "Enter valid coordinates (lat -90~90, lon -180~180)",
    "未设置观测点（点击打开观测面板）": "No observer set (click to open the observer panel)",
    "（点击打开观测面板）": " (click to open observer panel)",
    "请先设置观测地点": "Set an observer site first",
    "请在地球上点击以设置观测点": "Click the globe to set the observer",
    "过境": "Passes", "过境提醒": "Pass reminders",
    "未来 6 小时推荐过境": "Recommended passes (next 6h)",
    "未来 6 小时内没有推荐过境": "No recommended passes in the next 6 hours",
    "未来 6 小时内无过境": "No passes in the next 6 hours",
    "为当前过境列表全部设置提醒": "Set reminders for every pass listed",
    "导出未来 6 小时过境为 .ics 日历": "Export the next 6 hours of passes as .ics",
    "📅 导出日历": "📅 Export .ics", "🔔 全部提醒": "🔔 Remind all",
    "亮度为估算值 · 过境时间按当前时间机器": "Brightness is estimated · pass times follow the time machine",
    "正在计算过境…": "Computing passes…", "正在计算观测数据…": "Computing observation data…",
    "设置过境提醒": "Set pass reminders", "已设置提醒（点击取消）": "Reminder set (click to cancel)",
    "⏰ 已设置": "⏰ Set", "当前没有合适目标": "No suitable target right now",
    "现在可观测": "Observable now", "🔭 望远镜可观测": "🔭 Telescope observable",
    "下次": "Next", "下次 —": "Next —", "下一次过境 --": "Next pass --",
    "下一次过境 ·": "Next pass ·", "正在过境": "In pass", "已结束": "Finished",
    "已失效": "Expired", "开始": "Start", "最高": "Max", "结束": "End",
    "方位": "Azimuth", "仰角": "Elevation", "亮度": "Brightness", "可见性": "Visibility",
    "肉眼可见": "Naked eye", "双筒可见": "Binocular", "肉眼": "Naked eye", "双筒": "Binocular",
    "望远镜": "Telescope", "遮挡": "Blocked", "地平线下": "Below horizon",
    "（地平线下）": " (below horizon)", "照亮 SUNLIT": "Sunlit", "被照亮": "Sunlit",
    "地影中": "In shadow", "照亮": "Sunlit", "估算": "Est.", "（估算）": " (est.)",
    "现在": "Now", "天后": "d", "小时": "h", "小时前": "h ago", "小时后": "h",
    "分钟": "min", "分钟后": "min", "秒": "s", "<1 分钟后": "<1 min",
    "已选中：": "Selected: ", "已选中目标 · 详情在浮动卡（点此停靠）":
      "Selected · detail shown in the floating card (click to dock)",
    "· 详情在浮动卡（点此停靠）": " · detail in floating card (click to dock)",
    "取消选中 · 关闭浮动层": "Deselect · close floating card",
    "拖动移动卡片 · 双击切换【浮动 / 停靠】": "Drag to move · double-click to toggle docked / floating",
    "在浮动卡与停靠右栏之间切换（也可双击标题栏）": "Toggle floating card vs docked panel (or double-click the header)",
    "⤢ 浮动": "⤢ Float", "⤢ 停靠": "⤢ Dock",
    "跟随": "Follow", "跟随中": "Following", "跟随选中卫星（开关）": "Follow the selected satellite (toggle)",
    "相机跟随选中卫星（快捷键 F）": "Camera follows the selected satellite (F)",
    "其他 / 未分类": "Other / unclassified", "其他": "Other",
    "有效载荷": "Payload", "载荷 PAY": "Payload PAY", "火箭残骸": "Rocket body",
    "火箭残骸 R-B": "Rocket body R-B", "碎片 / 残骸": "Debris / rocket bodies",
    "碎片 DEB": "Debris DEB", "未知 UNK": "Unknown UNK", "未知": "Unknown",
    "载人飞船": "Crewed spacecraft", "货运飞船": "Cargo spacecraft",
    "技术试验 / 教育 / 业余": "Tech demo / education / amateur",
    "通信 / 互联网": "Communications / internet", "导航 / 定位": "Navigation / positioning",
    "对地观测 / 遥感": "Earth observation / remote sensing",
    "科学 / 深空": "Science / deep space", "军事 / 侦察": "Military / recon",
    "气象 / 海洋 / 环境": "Weather / ocean / environment",
    "部分运行": "Partial", "在轨运行": "Operational", "备用": "Standby",
    "已暂停": "Paused", "已关": "Off", "关": "Off",
    "按 Esc 或点击空白处关闭": "Press Esc or click outside to close",
    "语言": "Language", "中文": "中文", "English": "English",
    "隐私与数据": "Privacy & data",
    "本站不使用 Cookie、不做追踪，仅在你本机保存偏好。": "This site sets no cookies, runs no tracking, and only stores your preferences locally.",
    "隐私说明 ↗": "Privacy ↗", "清除本地数据": "Clear local data",
    "本站不使用 Cookie、不做追踪，仅在你本机保存偏好。查看隐私说明": "No cookies, no tracking. Preferences are stored only on your device. Read the privacy note.",
    "知道了": "Got it",
    "清除成功": "Cleared",
    "时区": "Time zone", "本地": "Local", "北京": "Beijing"
  };
  // 补充词条（按实测遗漏逐条补齐）
  Object.assign(I18N_EN, {
    "界面语言": "Interface language",
    "全球概览": "Global overview",
    "目标详情": "Target detail",
    "全部显示": "Show all",
    "名称 / NORAD 编号 / 国家": "Name / NORAD ID / Country",
    "低轨": "Low Earth orbit",
    "中轨": "Medium Earth orbit",
    "静止": "Geostationary",
    "高椭圆": "Highly elliptical",
    "HEO 高椭圆": "HEO",
    "LEO 低轨": "LEO",
    "MEO 中轨": "MEO",
    "GEO 静止": "GEO",
    "OTHER 其他": "OTHER",
    "全部收起": "Collapse all",
    "详情": "Details",
    "目标": "Target",
    "参数": "Parameters",
    "位置": "Position",
    "轨道": "Orbit",
    "观测条件": "Visibility",
    "过境列表": "Pass list",
    "开始": "Start", "结束": "End", "最高": "Max",
    "时间": "Time", "状态": "Status", "提醒": "Remind",
    "方向": "Direction", "持续时间": "Duration", "亮度估计": "Brightness",
    "设置提醒": "Set reminder", "取消": "Cancel",
    "刷新数据": "Refresh data", "重新计算": "Recompute",
    "关于": "About", "版本": "Version", "数据": "Data",
    "当前时间": "Current time", "播放": "Play", "暂停": "Pause",
    "在轨": "In orbit", "已退役": "Retired",
    "无数据": "No data", "加载中…": "Loading…", "加载中": "Loading",
    "没有结果": "No results", "空": "Empty",
    "云量": "Cloud", "夜面": "Night side", "昼面": "Day side",
    "计算中…": "Computing…", "计算中": "Computing",
    "观测窗口": "Windows", "开始时间": "Start time", "结束时间": "End time",
    "切换配色：国家 / 任务类型 / 轨道": "Switch color scheme: nation / mission / orbit",
    "细分类型 SUBTYPE": "Subtype SUBTYPE",
    "细分 SUBTYPE": "Subtype SUBTYPE",
    "细分": "Subtype",
    "Shift + 点击": "Shift + click",
    "Alt + 点击": "Alt + click",
    "空格": "Space",
    "多个目标重叠时挑选一个": "Pick one when targets overlap",
    "双击空白": "Double-click empty area",
    "仅高亮可见卫星": "Highlight visible satellites only",
    "时间流速": "Time rate",
    "观测成果画廊": "Observation gallery",
    "查看": "View", "亮点": "Highlights"
  });

  const I18N_ZH = {};
  Object.keys(I18N_EN).forEach(function (zh) {
    const en = I18N_EN[zh];
    if (zh !== en && !(en in I18N_ZH)) I18N_ZH[en] = zh;
  });

  let lang = "zh";
  let localizing = false;
  let lastCountryList = null;
  let lastTopCountries = null;
  const countryNameMap = new Map();
  const consentUi = { bar: null, shown: false };

  function translateText(value) {
    const raw = String(value == null ? "" : value);
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const map = lang === "en" ? I18N_EN : I18N_ZH;
    const hit = map[trimmed];
    if (hit == null || hit === trimmed) return raw;
    const lead = raw.slice(0, raw.indexOf(trimmed));
    const tail = raw.slice(raw.lastIndexOf(trimmed) + trimmed.length);
    return lead + hit + tail;
  }

  function localizeNode(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      const next = translateText(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== 1) return;
    const tag = String(root.tagName || "").toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
    ["title", "placeholder", "aria-label"].forEach(function (attr) {
      const cur = root.getAttribute(attr);
      if (cur) {
        const next = translateText(cur);
        if (next !== cur) root.setAttribute(attr, next);
      }
    });
    let child = root.firstChild;
    while (child) {
      const next = child.nextSibling;
      localizeNode(child);
      child = next;
    }
  }

  function localizeAll() {
    if (localizing) return;
    localizing = true;
    try {
      localizeNode(document.body);
      if (consentUi && consentUi.bar) localizeNode(consentUi.bar);
    } finally {
      localizing = false;
    }
  }

  let localizeTimer = 0;
  function scheduleLocalize() {
    if (lang !== "en") return;
    if (localizeTimer) return;
    localizeTimer = setTimeout(function () {
      localizeTimer = 0;
      localizeAll();
    }, 60);
  }

  function setLang(next, opts) {
    const v = next === "en" ? "en" : "zh";
    lang = v;
    document.documentElement.lang = v === "en" ? "en" : "zh-CN";
    document.documentElement.setAttribute("data-lang", v);
    // 清掉渲染缓存，强制按新语言重渲染（国家名/条形名都随语言变）
    lastCountrySignature = "";
    lastOrbitBarKeys = "";
    lastCategoryBarKeys = "";
    lastObjectKindKeys = "";
    lastCountryBarKeys = "";
    localizeAll();
    if (settingsUi && settingsUi.langBtns) {
      settingsUi.langBtns.forEach(function (btn, key) {
        btn.classList.toggle("is-on", key === v);
        btn.setAttribute("aria-pressed", key === v ? "true" : "false");
      });
    }
    if (consentUi && consentUi.bar) renderConsent();
    // 用最后一次数据重渲染一次（数据里的 label 会随语言变）
    if (obsData && obsData.selectionDetail) renderDetail(obsData.selectionDetail);
    if (lastCountryList) renderCountries(lastCountryList.list, lastCountryList.allShown);
    if (lastTopCountries) renderCountryBars(lastTopCountries);
    subchipsSig = "";
    renderSubcategories();
    if (Array.isArray(obsData.visible) && obsData.visible.length) obsData.visibleSig = "";
    if (Array.isArray(obsData.passes) && obsData.passes.length) obsData.passSig = "";
    obsData.telescopeSig = "";
    refreshClearFilters();
    if (opts && opts.notify) callHandler("onSetLang", v);
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
    if (!byId("telescope-list")) buildTelescopeSection(pane);
    if (!byId("pass-list")) buildPassSection(pane);
    if (!byId("obs-focus")) buildFocusRow(pane);
    if (!byId("obs-extra-actions")) buildExtraActions(pane);
    let obsNote = byId("obs-note");
    if (!obsNote) {
      obsNote = document.createElement("div");
      obsNote.id = "obs-note";
      obsNote.className = "obs-note";
      obsNote.textContent = "亮度为估算值 · 过境时间按当前时间机器";
    }
    pane.appendChild(obsNote);

    obsEl.current = byId("obs-current");
    obsEl.locateBtn = byId("obs-locate");
    obsEl.pickBtn = byId("obs-pick");
    obsEl.pickHint = byId("obs-pick-hint");
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
    obsEl.telescopeList = byId("telescope-list");
    obsEl.telescopeCount = byId("telescope-count");
    obsEl.exportIcsBtn = byId("obs-ics");
    obsEl.remindAllBtn = byId("obs-remind-all");

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

    const pick = document.createElement("button");
    pick.type = "button";
    pick.id = "obs-pick";
    pick.className = "btn btn-ghost obs-pick";
    pick.textContent = "🎯 在地球上选点";
    pick.title = "进入选点模式后在地球表面点击（也可按住 Alt 点击）";
    pick.setAttribute("aria-pressed", "false");
    actions.appendChild(pick);

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

    const pickHint = document.createElement("div");
    pickHint.id = "obs-pick-hint";
    pickHint.className = "obs-pick-hint";
    pickHint.textContent = "请在地球上点击以设置观测点";
    pickHint.hidden = true;

    box.appendChild(head);
    box.appendChild(current);
    box.appendChild(actions);
    box.appendChild(pickHint);
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

  function buildTelescopeSection(pane) {
    const section = document.createElement("div");
    section.id = "telescope-section";
    section.className = "obs-section";
    section.appendChild(makeObsTitle("🔭 望远镜可观测", "TELESCOPES", "telescope-count"));
    const list = document.createElement("div");
    list.id = "telescope-list";
    list.className = "obs-list telescope-list";
    list.setAttribute("role", "list");
    section.appendChild(list);
    const anchor = byId("visible-section");
    if (anchor && anchor.parentNode === pane) pane.insertBefore(section, anchor.nextSibling);
    else pane.appendChild(section);
  }

  function buildExtraActions(pane) {
    const row = document.createElement("div");
    row.id = "obs-extra-actions";
    row.className = "obs-actions obs-extra-actions";
    const ics = document.createElement("button");
    ics.type = "button";
    ics.id = "obs-ics";
    ics.className = "btn btn-ghost";
    ics.textContent = "📅 导出日历";
    ics.title = "导出未来 6 小时过境为 .ics 日历";
    const remindAll = document.createElement("button");
    remindAll.type = "button";
    remindAll.id = "obs-remind-all";
    remindAll.className = "btn";
    remindAll.textContent = "🔔 全部提醒";
    remindAll.title = "为当前过境列表全部设置提醒";
    row.appendChild(ics);
    row.appendChild(remindAll);
    pane.appendChild(row);
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
    if (obsEl.pickBtn) {
      obsEl.pickBtn.addEventListener("click", function () {
        if (v4.pickMode) exitPickMode();
        else enterPickMode();
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
    if (obsEl.passList) {
      obsEl.passList.addEventListener("keydown", function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        if (event.key !== "Enter" && event.key !== " ") return;
        const remind = target.closest(".remind-btn");
        if (!remind) return;
        event.preventDefault();
        event.stopPropagation();
        toggleReminder(Number(remind.dataset.index));
      });
    }
    if (obsEl.telescopeList) obsEl.telescopeList.addEventListener("click", onObsListClick);
    if (obsEl.exportIcsBtn) obsEl.exportIcsBtn.addEventListener("click", function () { callHandler("onExportIcs"); });
    if (obsEl.remindAllBtn) obsEl.remindAllBtn.addEventListener("click", remindAll);
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

    const remind = target.closest(".remind-btn");
    if (remind) {
      event.preventDefault();
      event.stopPropagation();
      toggleReminder(Number(remind.dataset.index));
      return;
    }

    const row = target.closest(".obs-item");
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    callHandler("onSelectPass", index);
  }

  /* ---------- V6 过境提醒 ---------- */

  function isReminded(item) {
    if (!item) return false;
    const saved = obsData.reminders.get(String(item.index));
    if (saved === undefined) return false;
    if (item.startAt == null) return true;
    return String(saved) === String(item.startAt);
  }

  function toggleReminder(index) {
    if (!Number.isFinite(index)) return;
    const item = (obsData.passes || []).find(function (p) { return p && p.index === index; }) || null;
    if (item && isReminded(item)) {
      obsData.reminders.delete(String(index));
    } else {
      obsData.reminders.set(String(index), item ? item.startAt : null);
    }
    renderPassList();
    callHandler("onRemindPass", index);
  }

  function remindAll() {
    (obsData.passes || []).forEach(function (item) {
      if (item) obsData.reminders.set(String(item.index), item.startAt);
    });
    renderPassList();
    callHandler("onRemindAll");
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
    renderTelescopeList();
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

  /** 望远镜目标在列表里加 🔭 前缀（契约 §21.5） */
  function obsDisplayName(item) {
    if (!item) return "--";
    const base = item.name || ("#" + (item.index != null ? item.index : ""));
    return (item.isTelescope ? "🔭 " : "") + base;
  }

  function updateVisibleRow(item) {
    if (!item) return;
    const entry = obsData.visibleRows.get(String(item.index));
    if (!entry) return;
    setText(entry.name, obsDisplayName(item));
    setText(entry.mag, "估算 " + (isNum(item.mag) ? fmtNum(item.mag, 1) : "--"));
    entry.tier.className = "tier tier-" + (item.tier || "telescope");
    setText(entry.tier, TIER_SHORT[item.tier] || "—");
    setText(entry.country, ((item.flag ? item.flag + " " : "") + (item.country || "")).trim());
    setText(entry.el, "仰角 " + (isNum(item.el) ? fmtNum(item.el, 1) + "°" : "--"));
    setText(entry.az, "方位 " + (isNum(item.az) ? fmtNum(item.az, 0) + "°" : "--"));
    setText(entry.range, isNum(item.rangeKm) ? fmtInt(item.rangeKm) + " km" : "-- km");
    entry.row.title = (item.name || "") + (item.sunlit ? " · 被照亮" : " · 地影中");
  }

  function scopeStatusInfo(status) {
    return SCOPE_STATUS[status] || SCOPE_STATUS.unknown;
  }

  function normalizeScopeStatus(status) {
    const key = status === null || status === undefined ? "" : String(status).toLowerCase();
    return SCOPE_STATUS[key] ? key : "unknown";
  }

  function lookupScopeStatus(id) {
    if (id === null || id === undefined) return "unknown";
    const list = Array.isArray(obsData.telescopes) ? obsData.telescopes : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item && String(item.id) === String(id)) return normalizeScopeStatus(item.status);
    }
    return "unknown";
  }

  /** V6 望远镜可观测状态列表（契约 §25.1） */
  function renderTelescopeList() {
    const list = obsEl.telescopeList;
    if (!list) return;
    const items = Array.isArray(obsData.telescopes) ? obsData.telescopes.slice() : [];
    items.sort(function (a, b) {
      const sa = normalizeScopeStatus(a && a.status);
      const sb = normalizeScopeStatus(b && b.status);
      const ra = SCOPE_RANK[sa] != null ? SCOPE_RANK[sa] : 3;
      const rb = SCOPE_RANK[sb] != null ? SCOPE_RANK[sb] : 3;
      if (ra !== rb) return ra - rb;
      const na = a && isNum(a.nextAt) ? Number(a.nextAt) : Infinity;
      const nb = b && isNum(b.nextAt) ? Number(b.nextAt) : Infinity;
      if (na !== nb) return na - nb;
      return (isNum(b && b.el) ? Number(b.el) : -90) - (isNum(a && a.el) ? Number(a.el) : -90);
    });

    if (obsEl.telescopeCount) setText(obsEl.telescopeCount, String(items.length));

    if (!obsData.observer) {
      list.replaceChildren(makeEmptyState("设置观测地点后可判断望远镜可观测性"));
      obsData.telescopeSig = "";
      obsData.telescopeRows.clear();
      return;
    }
    if (!items.length) {
      list.replaceChildren(makeEmptyState(obsData.observing ? "正在计算望远镜窗口…" : "暂无望远镜数据"));
      obsData.telescopeSig = "";
      obsData.telescopeRows.clear();
      return;
    }

    const sig = items.map(function (item) { return item && item.id; }).join(",");
    if (sig !== obsData.telescopeSig) {
      rebuildTelescopeRows(items);
      obsData.telescopeSig = sig;
    }
    items.forEach(updateTelescopeRow);
  }

  function rebuildTelescopeRows(items) {
    const list = obsEl.telescopeList;
    if (!list) return;
    obsData.telescopeRows.clear();
    const frag = document.createDocumentFragment();
    items.forEach(function (item) {
      if (!item) return;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "obs-item scope-item";
      row.dataset.index = String(item.index);
      row.dataset.id = String(item.id);
      row.setAttribute("role", "listitem");
      row.style.setProperty("--c", item.color || "#ffd166");

      const top = document.createElement("span");
      top.className = "obs-item-top";
      const dot = document.createElement("i");
      dot.className = "oi-dot";
      const name = document.createElement("span");
      name.className = "oi-name";
      const flag = document.createElement("span");
      flag.className = "scope-flag";
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(flag);

      const meta = document.createElement("span");
      meta.className = "obs-item-meta";
      const type = document.createElement("span");
      type.className = "oi-type";
      const el = document.createElement("span");
      el.className = "oi-el";
      const az = document.createElement("span");
      az.className = "oi-az";
      const next = document.createElement("span");
      next.className = "oi-next";
      meta.appendChild(type);
      meta.appendChild(el);
      meta.appendChild(az);
      meta.appendChild(next);

      row.appendChild(top);
      row.appendChild(meta);
      frag.appendChild(row);
      obsData.telescopeRows.set(String(item.id), {
        row: row, name: name, flag: flag, type: type, el: el, az: az, next: next
      });
    });
    list.replaceChildren(frag);
  }

  function updateTelescopeRow(item) {
    if (!item) return;
    const entry = obsData.telescopeRows.get(String(item.id));
    if (!entry) return;
    const status = normalizeScopeStatus(item.status);
    const info = scopeStatusInfo(status);

    setText(entry.name, "🔭 " + (item.name || ("#" + item.index)));
    entry.flag.className = "scope-flag " + info.cls;
    setText(entry.flag, info.label);

    const typeLabel = item.typeLabel
      || TELESCOPE_TYPES[String(item.telescopeType || "").toLowerCase()]
      || "未知";
    setText(entry.type, typeLabel);
    setText(entry.el, "仰角 " + (isNum(item.el) ? fmtNum(item.el, 0) + "°" : "--"));
    setText(entry.az, "方位 " + (isNum(item.az) ? fmtNum(item.az, 0) + "°" : "--"));
    const nextText = isNum(item.nextAt)
      ? "下次 " + fmtLocalHHMM(item.nextAt) + (isNum(item.nextEl) ? " · 最高 " + fmtNum(item.nextEl, 0) + "°" : "")
      : "下次 —";
    setText(entry.next, nextText);
    entry.row.title = (item.name || "") + " · " + info.label + " · " + nextText
      + (item.sunlit === true ? " · 被照亮" : (item.sunlit === false ? " · 地影中" : ""));
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
      const remind = document.createElement("span");
      remind.className = "remind-btn";
      remind.setAttribute("role", "button");
      remind.setAttribute("tabindex", "0");
      remind.dataset.index = String(item.index);
      remind.title = "设置过境提醒";
      remind.textContent = "⏰";
      top.appendChild(dot);
      top.appendChild(name);
      top.appendChild(countdown);
      top.appendChild(tier);
      top.appendChild(remind);

      const meta = document.createElement("span");
      meta.className = "obs-item-meta";
      const time = document.createElement("span");
      time.className = "oi-time";
      const maxEl = document.createElement("span");
      maxEl.className = "oi-maxel";
      const az = document.createElement("span");
      az.className = "oi-az";
      const duration = document.createElement("span");
      duration.className = "oi-duration";
      const mag = document.createElement("span");
      mag.className = "oi-mag";
      meta.appendChild(time);
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
        row: row, name: name, countdown: countdown, tier: tier, time: time, remind: remind,
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
    setText(entry.name, obsDisplayName(item));
    setText(entry.countdown, passCountdown(item, now));
    entry.countdown.classList.toggle("live", isPassLive(item, now));
    entry.tier.className = "tier tier-" + (item.tier || "telescope");
    setText(entry.tier, TIER_SHORT[item.tier] || "—");
    setText(entry.time, isNum(item.startAt) ? fmtLocalHHMM(item.startAt) : "--:--");
    if (entry.time) entry.time.title = "本地开始时间";
    setText(entry.maxEl, "最高 " + (isNum(item.maxEl) ? fmtNum(item.maxEl, 1) + "°" : "--"));
    setText(entry.az, "方位 " + (isNum(item.az) ? fmtNum(item.az, 0) + "°" : "--"));
    setText(entry.duration, fmtDuration(item.durationSec));
    setText(entry.mag, "估算 " + (isNum(item.mag) ? fmtNum(item.mag, 1) : "--"));
    if (entry.remind) {
      const on = isReminded(item);
      entry.remind.textContent = on ? "⏰ 已设置" : "⏰";
      entry.remind.classList.toggle("is-on", on);
      entry.remind.title = on ? "已设置提醒（点击取消）" : "设置过境提醒";
      entry.remind.dataset.index = String(item.index);
    }
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

    // V6：星历龄期（优先 passDetail，其次 setSelection 的详情）
    const sel = obsData.selectionDetail || {};
    let ageHours = NaN;
    if (isNum(d.tleAgeHours)) ageHours = Number(d.tleAgeHours);
    else if (isNum(sel.tleAgeHours)) ageHours = Number(sel.tleAgeHours);
    else if (sel.tleEpoch) {
      const epoch = Date.parse(sel.tleEpoch);
      if (!Number.isNaN(epoch)) ageHours = (Date.now() - epoch) / 3600000;
    }
    const isOld = isNum(ageHours) && ageHours > 168;
    setViewingField(
      "age",
      isNum(ageHours) ? "TLE 龄期 " + fmtNum(ageHours / 24, 1) + " 天" : "TLE 龄期 --",
      isOld ? "is-old" : ""
    );
    if (obsEl.viewingAgeHint) obsEl.viewingAgeHint.hidden = !isOld;

    // V6：望远镜观测状态
    const isScope = d.isTelescope === true || sel.isTelescope === true;
    const scopeEl = obsData.viewingFields.get("scope");
    if (scopeEl) {
      const scopeRow = scopeEl.parentNode;
      if (scopeRow) scopeRow.hidden = !isScope;
      if (isScope) {
        const status = normalizeScopeStatus(d.scopeStatus || d.telescopeStatus || lookupScopeStatus(sel.id));
        const info = scopeStatusInfo(status);
        setText(scopeEl, info.label);
        scopeEl.className = "v-v " + info.cls;
      } else {
        setText(scopeEl, "--");
        scopeEl.className = "v-v";
      }
    }

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
        const rowName = entry.name ? entry.name.textContent.replace(/^🔭 /, "") : "";
        entry.row.classList.toggle("is-selected", !!target && rowName === target);
      });
    };
    apply(obsData.visibleRows);
    apply(obsData.passRows);
    apply(obsData.telescopeRows);
  }

  const applyVisibleNow = throttle(function () { renderVisibleList(); }, 500);
  const applyPasses = throttle(function () { renderPassList(); }, 500);
  const applyViewing = throttle(function () { renderViewing(); }, 100);
  const applyTelescopes = throttle(function () { renderTelescopeList(); }, 500);

  /* ---------- V3 公共方法 ---------- */

  function setObserver(observer) {
    exitPickMode();
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

  /* ---------- V4 底栏控件（时间轴 / 截图 / 重置 / 帮助） ---------- */

  function ensureBottomControls() {
    const timeBar = document.querySelector(".time-bar");
    if (!timeBar) return;
    const clockEl = timeBar.querySelector(".clock");

    let seek = byId("time-seek");
    if (!seek) {
      seek = document.createElement("div");
      seek.id = "time-seek";
      seek.className = "time-seek";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.id = "time-slider";
      slider.className = "time-slider";
      slider.min = "-1440";
      slider.max = "1440";
      slider.step = "1";
      slider.value = String(v4.seekValue);
      slider.setAttribute("aria-label", "时间轴偏移（分钟，-1440 ~ +1440）");
      slider.title = "拖动调整时间：−24h ~ +24h（双击回到现在）";

      const label = document.createElement("span");
      label.id = "time-offset";
      label.className = "time-offset is-now";
      label.textContent = "现在";
      label.title = "相对当前真实时间的偏移";

      seek.appendChild(slider);
      seek.appendChild(label);
      if (clockEl && clockEl.parentNode === timeBar) timeBar.insertBefore(seek, clockEl.nextSibling);
      else timeBar.appendChild(seek);
    }
    v4.slider = byId("time-slider");
    v4.offsetLabel = byId("time-offset");

    ensureBottomButton("btn-reset-view", "⟲", "重置视角", "重置视角 (R)", function () {
      callHandler("onResetView");
    });
    ensureBottomButton("btn-shot", "📷", "截图", "截图并下载 PNG", function () {
      if (typeof h.onExportShot !== "function") {
        showToast("当前版本不支持截图");
        return;
      }
      callHandler("onExportShot");
    });
    ensureBottomButton("btn-help", "？", "快捷键", "快捷键帮助 (?)", function () {
      toggleHelp();
    });

    bindSeek();
    updateSeekLabel(v4.seekValue);

    const hint = document.querySelector("#hud-bottom .hint");
    if (hint && hint.textContent.indexOf("快捷键") < 0) {
      hint.textContent = hint.textContent + " · ? 查看快捷键";
    }
  }

  function ensureBottomButton(id, icon, label, title, onClick) {
    let btn = byId(id);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = id;
      btn.className = "btn btn-ghost btn-compact";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      const iconEl = document.createElement("span");
      iconEl.className = "btn-icon";
      iconEl.textContent = icon;
      const labelEl = document.createElement("span");
      labelEl.className = "btn-label";
      labelEl.textContent = label;
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
      const timeBar = document.querySelector(".time-bar");
      if (timeBar) timeBar.appendChild(btn);
    }
    if (!btn.dataset.bound) {
      btn.addEventListener("click", onClick);
      btn.dataset.bound = "1";
    }
    return btn;
  }

  function updateSeekLabel(minutes) {
    if (!v4.offsetLabel) return;
    const value = Number(minutes) || 0;
    setText(v4.offsetLabel, fmtOffset(value));
    v4.offsetLabel.classList.toggle("is-now", Math.abs(value) <= 1);
  }

  /** main 回传 offsetMinutes 时同步滑块；拖动中 / 冻结窗口内不打断 */
  function syncSeek(offset) {
    const value = Number(offset);
    if (!Number.isFinite(value)) return;
    if (v4.dragging || performance.now() < v4.freezeUntil) return;
    v4.seekValue = value;
    if (v4.slider) {
      const clamped = Math.max(-1440, Math.min(1440, Math.round(value)));
      if (Number(v4.slider.value) !== clamped) v4.slider.value = String(clamped);
    }
    updateSeekLabel(value);
  }

  function bindSeek() {
    const slider = v4.slider;
    if (!slider || slider.dataset.bound) return;
    slider.dataset.bound = "1";

    const freeze = function () {
      v4.freezeUntil = performance.now() + 1500;
    };
    const release = function () {
      v4.dragging = false;
      freeze();
      v4.seekValue = Number(slider.value) || 0;
      callHandler("onTimeSeek", v4.seekValue);
    };

    slider.addEventListener("pointerdown", function () {
      v4.dragging = true;
      freeze();
    });
    slider.addEventListener("input", function () {
      const value = Number(slider.value) || 0;
      v4.seekValue = value;
      v4.dragging = true;
      freeze();
      updateSeekLabel(value);
      applySeek();
    });
    slider.addEventListener("change", release);
    slider.addEventListener("pointerup", release);
    slider.addEventListener("pointercancel", release);
    slider.addEventListener("dblclick", function () {
      slider.value = "0";
      v4.seekValue = 0;
      freeze();
      updateSeekLabel(0);
      callHandler("onTimeSeek", 0);
    });
  }

  const applySeek = throttle(function () {
    callHandler("onTimeSeek", v4.seekValue);
  }, 80);

  /* ---------- V4 快捷键帮助浮层 ---------- */

  function ensureHelpOverlay() {
    let overlay = byId("help-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "help-overlay";
      overlay.className = "help-overlay";
      overlay.hidden = true;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "快捷键帮助");

      const panel = document.createElement("div");
      panel.className = "help-panel";

      const head = document.createElement("div");
      head.className = "help-head";
      const tick = document.createElement("span");
      tick.className = "tick";
      head.appendChild(tick);
      head.appendChild(document.createTextNode("快捷键 "));
      const en = document.createElement("span");
      en.className = "en";
      en.textContent = "SHORTCUTS";
      head.appendChild(en);
      const close = document.createElement("button");
      close.type = "button";
      close.id = "help-close";
      close.className = "link-btn";
      close.textContent = "关闭";
      head.appendChild(close);

      const list = document.createElement("div");
      list.className = "help-list";
      SHORTCUTS.forEach(function (item) {
        const row = document.createElement("div");
        row.className = "help-row";
        const key = document.createElement("kbd");
        key.className = "help-key";
        key.textContent = item.key;
        const desc = document.createElement("span");
        desc.className = "help-desc";
        desc.textContent = item.desc;
        row.appendChild(key);
        row.appendChild(desc);
        list.appendChild(row);
      });

      const foot = document.createElement("div");
      foot.className = "help-foot";
      foot.textContent = "按 Esc 或点击空白处关闭";

      panel.appendChild(head);
      panel.appendChild(list);
      panel.appendChild(foot);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      close.addEventListener("click", closeHelp);
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeHelp();
      });
    }
    v4.help = overlay;
  }

  function openHelp() {
    if (!v4.help) ensureHelpOverlay();
    if (!v4.help) return;
    v4.help.hidden = false;
    v4.helpOpen = true;
    const btn = byId("btn-help");
    if (btn) btn.classList.add("is-active");
    const close = v4.help.querySelector("#help-close");
    if (close && typeof close.focus === "function") close.focus();
  }

  function closeHelp() {
    if (!v4.help) return;
    v4.help.hidden = true;
    v4.helpOpen = false;
    const btn = byId("btn-help");
    if (btn) btn.classList.remove("is-active");
  }

  function toggleHelp() {
    if (v4.helpOpen) closeHelp();
    else openHelp();
  }

  /* ---------- V11 设置面板 ---------- */

  const SETTINGS_KEY = "holomirror.settings";

  const TZ_PRESETS = [
    { key: "local", label: "本地" },
    { key: "utc", label: "UTC" },
    { key: 480, label: "UTC+8" },
    { key: "custom", label: "自定义" }
  ];

  const SETTINGS_LAYERS = [
    { key: "stars", label: "星空", desc: "背景星点" },
    { key: "grid", label: "经纬网", desc: "地球经纬线" },
    { key: "atmosphere", label: "大气辉光", desc: "大气发光边缘" },
    { key: "terminator", label: "🌗 晨昏线", desc: "昼夜分界 · 夜面压暗 + 琥珀分界线" },
    { key: "meridian", label: "🧭 本初子午线", desc: "0° 金色 / 180° 淡蓝经线" },
    { key: "telescopes", label: "望远镜星标", desc: "🔭 金色星标层" }
  ];

  /* V11.1 自动旋转三档（契约追加项） */
  const AUTO_ROTATE_OPTIONS = [
    { key: "off", label: "关" },
    { key: "orbit", label: "相机环绕" },
    { key: "earth", label: "跟随地球自转" }
  ];

  const LEGEND_ROWS = [
    { icon: "🔭", text: "金色星标 = 天文望远镜" },
    { icon: "🛰️", text: "大点 = 空间站 / 载人飞船" },
    { icon: "◎", text: "琥珀环 = 当前悬停 / 选中目标" },
    { icon: "📍", text: "金色图钉 = 观测点" }
  ];

  const settingsUi = {
    overlay: null,
    open: false,
    tz: "local",
    hour12: false,
    custom: 480,
    customMode: false,
    layers: { stars: true, grid: true, atmosphere: true, terminator: true, meridian: true, telescopes: true },
    autoRotate: "orbit",
    lastAutoMode: "orbit",
    autoBtns: new Map(),
    tzBtns: new Map(),
    hourBtns: new Map(),
    layerRows: new Map(),
    customRow: null,
    customSlider: null,
    customLabel: null,
    debrisRow: null,
    langBtns: new Map(),
    privacySection: null
  };

  function fmtTzOffset(minutes) {
    const m = Number(minutes) || 0;
    const sign = m >= 0 ? "+" : "-";
    const abs = Math.abs(m);
    const h = Math.floor(abs / 60);
    const mm = abs % 60;
    return "UTC" + sign + h + (mm ? ":" + (mm < 10 ? "0" + mm : mm) : "");
  }

  function readSavedSettings() {
    const raw = readStore(SETTINGS_KEY);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      const out = {};
      if (o.tz === "local" || o.tz === "utc" || typeof o.tz === "number") out.tz = o.tz;
      if (typeof o.hour12 === "boolean") out.hour12 = o.hour12;
      if (o.autoRotate === "off" || o.autoRotate === "orbit" || o.autoRotate === "earth") out.autoRotate = o.autoRotate;
      if (o.layers && typeof o.layers === "object") {
        const layers = {};
        Object.keys(o.layers).forEach(function (key) {
          if (typeof o.layers[key] === "boolean") layers[key] = o.layers[key];
        });
        if (Object.keys(layers).length) out.layers = layers;
      }
      return out;
    } catch (err) {
      return null;
    }
  }

  function ensureSettings() {
    let overlay = byId("settings-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "settings-overlay";
      overlay.className = "help-overlay settings-overlay";
      overlay.hidden = true;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "设置");

      const panel = document.createElement("div");
      panel.className = "help-panel settings-panel";

      const head = document.createElement("div");
      head.className = "help-head";
      const tick = document.createElement("span");
      tick.className = "tick";
      head.appendChild(tick);
      head.appendChild(document.createTextNode("设置 "));
      const en = document.createElement("span");
      en.className = "en";
      en.textContent = "SETTINGS";
      head.appendChild(en);
      const close = document.createElement("button");
      close.type = "button";
      close.id = "settings-close";
      close.className = "link-btn";
      close.textContent = "关闭";
      head.appendChild(close);

      const body = document.createElement("div");
      body.className = "settings-body";

      // —— 时间显示 ——
      body.appendChild(makeSettingsSection("语言", "LANGUAGE"));
      const langRow = document.createElement("div");
      langRow.className = "set-row";
      const langLabel = document.createElement("span");
      langLabel.className = "set-label";
      langLabel.textContent = "界面语言";
      const langSeg = document.createElement("div");
      langSeg.className = "set-seg";
      [{ key: "zh", label: "中文" }, { key: "en", label: "English" }].forEach(function (opt) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "set-btn";
        btn.textContent = opt.label;
        btn.dataset.lang = opt.key;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", function () {
          setLang(opt.key, { notify: true });
        });
        settingsUi.langBtns.set(opt.key, btn);
        langSeg.appendChild(btn);
      });
      langRow.appendChild(langLabel);
      langRow.appendChild(langSeg);
      body.appendChild(langRow);

      body.appendChild(makeSettingsSection("时间显示", "TIME DISPLAY"));
      const tzRow = document.createElement("div");
      tzRow.className = "set-row";
      const tzLabel = document.createElement("span");
      tzLabel.className = "set-label";
      tzLabel.textContent = "时区 TZ";
      const tzSeg = document.createElement("div");
      tzSeg.className = "set-seg";
      TZ_PRESETS.forEach(function (preset) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "set-btn";
        btn.textContent = preset.label;
        btn.dataset.tz = preset.key === "custom" ? "custom" : String(preset.key);
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", function () {
          if (preset.key === "custom") {
            applyTz(settingsUi.custom, true, true, true);
          } else {
            applyTz(preset.key, true);
          }
        });
        settingsUi.tzBtns.set(String(preset.key), btn);
        tzSeg.appendChild(btn);
      });
      tzRow.appendChild(tzLabel);
      tzRow.appendChild(tzSeg);
      body.appendChild(tzRow);

      const customRow = document.createElement("div");
      customRow.className = "set-row set-row-custom";
      customRow.hidden = true;
      const customLabel = document.createElement("span");
      customLabel.className = "set-label";
      customLabel.textContent = "偏移";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "set-slider";
      slider.id = "settings-tz-slider";
      slider.min = "-720";
      slider.max = "720";
      slider.step = "30";
      slider.value = "480";
      const readout = document.createElement("span");
      readout.className = "set-readout";
      readout.textContent = "UTC+8";
      slider.addEventListener("input", function () {
        settingsUi.custom = Number(slider.value) || 0;
        readout.textContent = fmtTzOffset(settingsUi.custom);
        applyTz(settingsUi.custom, true, true, true);
      });
      customRow.appendChild(customLabel);
      customRow.appendChild(slider);
      customRow.appendChild(readout);
      body.appendChild(customRow);

      const hourRow = document.createElement("div");
      hourRow.className = "set-row";
      const hourLabel = document.createElement("span");
      hourLabel.className = "set-label";
      hourLabel.textContent = "时间格式";
      const hourSeg = document.createElement("div");
      hourSeg.className = "set-seg";
      [{ key: "h24", label: "24 小时制", value: false }, { key: "h12", label: "12 小时制", value: true }].forEach(function (opt) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "set-btn";
        btn.textContent = opt.label;
        btn.dataset.hour = opt.key;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", function () {
          settingsUi.hour12 = opt.value;
          syncSettingsControls();
          callHandler("onSettingsChange", { hour12: opt.value });
        });
        settingsUi.hourBtns.set(opt.key, btn);
        hourSeg.appendChild(btn);
      });
      hourRow.appendChild(hourLabel);
      hourRow.appendChild(hourSeg);
      body.appendChild(hourRow);

      // —— 图层与显示 ——
      body.appendChild(makeSettingsSection("图层与显示", "LAYERS"));

      const autoRow = document.createElement("div");
      autoRow.className = "set-row";
      const autoLabel = document.createElement("span");
      autoLabel.className = "set-label";
      autoLabel.textContent = "自动旋转";
      const autoSeg = document.createElement("div");
      autoSeg.className = "set-seg";
      AUTO_ROTATE_OPTIONS.forEach(function (opt) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "set-btn";
        btn.textContent = opt.label;
        btn.dataset.auto = opt.key;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", function () {
          setAutoRotate(opt.key, true);
        });
        settingsUi.autoBtns.set(opt.key, btn);
        autoSeg.appendChild(btn);
      });
      autoRow.appendChild(autoLabel);
      autoRow.appendChild(autoSeg);
      body.appendChild(autoRow);
      SETTINGS_LAYERS.forEach(function (def) {
        const row = makeSwitchRow(def.label, def.desc, def.key === "telescopes");
        row.btn.addEventListener("click", function () {
          const next = !settingsUi.layers[def.key];
          settingsUi.layers[def.key] = next;
          syncLayerChip(def.key, next);
          syncSettingsControls();
          persistLayerState();
          callHandler("onLayerToggle", def.key, next);
        });
        settingsUi.layerRows.set(def.key, row.btn);
        body.appendChild(row.el);
      });

      const debrisRow = makeSwitchRow("碎片默认显示", "默认隐藏碎片 / 残骸", false);
      debrisRow.btn.addEventListener("click", function () {
        setShowDebris(!showDebris, true);
        syncSettingsControls();
      });
      settingsUi.debrisRow = debrisRow.btn;
      body.appendChild(debrisRow.el);

      // —— 图例 ——
      body.appendChild(makeSettingsSection("标记图例", "LEGEND"));
      const legendList = document.createElement("div");
      legendList.className = "settings-legend";
      LEGEND_ROWS.forEach(function (item) {
        const row = document.createElement("div");
        row.className = "legend-row";
        const icon = document.createElement("span");
        icon.className = "legend-icon";
        icon.textContent = item.icon;
        const text = document.createElement("span");
        text.className = "legend-text";
        text.textContent = item.text;
        row.appendChild(icon);
        row.appendChild(text);
        legendList.appendChild(row);
      });
      body.appendChild(legendList);

      const foot = document.createElement("div");
      foot.className = "help-foot";
      foot.textContent = "按 Esc 或点击空白处关闭 · 设置会自动保存";

      body.appendChild(makeSettingsSection("隐私与数据", "PRIVACY & DATA"));
      const priv = document.createElement("div");
      priv.className = "set-privacy";
      priv.id = "settings-privacy";
      const privText = document.createElement("p");
      privText.className = "set-privacy-text";
      privText.textContent = "本站不使用 Cookie、不做追踪，仅在你本机保存偏好。";
      const privActions = document.createElement("div");
      privActions.className = "set-privacy-actions";
      const privLink = document.createElement("button");
      privLink.type = "button";
      privLink.className = "btn btn-compact";
      privLink.id = "settings-privacy-link";
      privLink.textContent = "隐私说明 ↗";
      privLink.addEventListener("click", function () {
        window.open("/privacy.html", "_blank", "noopener,noreferrer");
      });
      const privClear = document.createElement("button");
      privClear.type = "button";
      privClear.className = "btn btn-compact";
      privClear.id = "settings-clear-data";
      privClear.textContent = "清除本地数据";
      privClear.title = "删除本机保存的观测点 / 设置 / 详情卡位置";
      privClear.addEventListener("click", function () {
        callHandler("onClearLocalData");
      });
      privActions.appendChild(privLink);
      privActions.appendChild(privClear);
      priv.appendChild(privText);
      priv.appendChild(privActions);
      body.appendChild(priv);
      settingsUi.privacySection = priv;

      panel.appendChild(head);
      panel.appendChild(body);
      panel.appendChild(foot);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      close.addEventListener("click", closeSettings);
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeSettings();
      });

      settingsUi.customRow = customRow;
      settingsUi.customSlider = slider;
      settingsUi.customLabel = readout;
    }

    settingsUi.overlay = overlay;
    ensureSettingsEntry();
    syncSettingsControls();
    return overlay;
  }

  function makeSettingsSection(title, enText) {
    const sec = document.createElement("div");
    sec.className = "set-section";
    const head = document.createElement("div");
    head.className = "set-title";
    head.appendChild(document.createTextNode(title + " "));
    const en = document.createElement("span");
    en.className = "en";
    en.textContent = enText;
    head.appendChild(en);
    sec.appendChild(head);
    return sec;
  }

  function makeSwitchRow(label, desc, isScope) {
    const el = document.createElement("div");
    el.className = "set-row set-row-switch";
    const text = document.createElement("div");
    text.className = "set-switch-text";
    const name = document.createElement("span");
    name.className = "set-switch-name";
    name.textContent = label;
    const hint = document.createElement("span");
    hint.className = "set-switch-desc";
    hint.textContent = desc;
    text.appendChild(name);
    text.appendChild(hint);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "set-switch" + (isScope ? " is-scope" : "");
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", "false");
    const knob = document.createElement("span");
    knob.className = "set-knob";
    btn.appendChild(knob);
    el.appendChild(text);
    el.appendChild(btn);
    return { el: el, btn: btn };
  }

  function applyTz(value, notify, skipCustom, asCustom) {
    settingsUi.tz = value;
    if (typeof value === "number") settingsUi.custom = value;
    if (asCustom) settingsUi.customMode = true;
    else if (value === "local" || value === "utc" || value === 480) settingsUi.customMode = false;
    if (!skipCustom && typeof value === "number") {
      if (settingsUi.customSlider) settingsUi.customSlider.value = String(value);
      if (settingsUi.customLabel) settingsUi.customLabel.textContent = fmtTzOffset(value);
    }
    syncSettingsControls();
    if (notify) callHandler("onSettingsChange", { tz: value });
  }

  function setAutoRotate(mode, notify) {
    const next = mode === "off" || mode === "orbit" || mode === "earth" ? mode : "off";
    settingsUi.autoRotate = next;
    if (next !== "off") settingsUi.lastAutoMode = next;
    syncSettingsControls();
    if (notify) callHandler("onAutoRotateChange", next);
  }

  /** 快捷芯片上的模式后缀：环绕 / 跟随自转 / 已关 */
  function autoRotateChipText(mode) {
    if (mode === "earth") return "跟随自转";
    if (mode === "orbit") return "环绕";
    return "已关";
  }

  /** 同步底部「自动旋转」芯片：常驻为模式按钮，不做关闭开关 */
  function syncAutoRotateChip() {
    if (!autoRotateChip) return;
    const mode = settingsUi.autoRotate || "orbit";
    const on = mode !== "off";
    const el = autoRotateChip.el;
    el.classList.toggle("active", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.title = on
      ? "自动旋转：" + (mode === "earth" ? "跟随地球自转" : "相机环绕") +
        " · 点击切换（关闭请到设置面板）"
      : "自动旋转已关闭 · 点击开启跟随地球自转";
    autoRotateChip.mode.textContent = autoRotateChipText(mode);
    el.setAttribute("aria-label", "自动旋转，当前" + autoRotateChipText(mode) + "，点击切换");
    layerEnabled.set("autoRotate", on);
  }

  /** 点击芯片：相机环绕 ⇄ 跟随地球自转；关闭态则直接开启跟随自转 */
  function cycleAutoRotate() {
    const mode = settingsUi.autoRotate || "orbit";
    setAutoRotate(mode === "earth" ? "orbit" : "earth", true);
  }

  function syncLayerChip(key, on) {
    const chip = layerBtns.get(key);
    if (!chip) return;
    chip.classList.toggle("active", !!on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    layerEnabled.set(key, !!on);
  }

  let pendingLayerSync = null;

  /** 初始化时读到的图层状态要等 main 的 globe 建好后再下发一次 */
  function flushPendingLayers() {
    if (!pendingLayerSync) return;
    const list = pendingLayerSync;
    pendingLayerSync = null;
    list.forEach(function (item) {
      callHandler("onLayerToggle", item.key, item.on);
    });
  }

  /** 把当前图层开关写回 localStorage（与 main 的 settings 合并，不动其它字段） */
  function persistLayerState() {
    let current = {};
    const raw = readStore(SETTINGS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") current = parsed;
      } catch (err) { /* 忽略损坏数据 */ }
    }
    const layers = {};
    Object.keys(settingsUi.layers).forEach(function (key) {
      layers[key] = settingsUi.layers[key] !== false;
    });
    current.layers = layers;
    writeStore(SETTINGS_KEY, JSON.stringify(current));
  }

  function syncSettingsControls() {
    ensureSettingsEntry();
    const tz = settingsUi.tz;
    const tzKey = settingsUi.customMode
      ? "custom"
      : (tz === "local" || tz === "utc" ? tz : (tz === 480 ? "480" : "custom"));
    settingsUi.tzBtns.forEach(function (btn, key) {
      const on = key === tzKey;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (settingsUi.customRow) settingsUi.customRow.hidden = tzKey !== "custom";
    if (settingsUi.customSlider && tzKey === "custom") {
      settingsUi.customSlider.value = String(settingsUi.custom);
    }
    if (settingsUi.customLabel) settingsUi.customLabel.textContent = fmtTzOffset(settingsUi.custom);

    settingsUi.hourBtns.forEach(function (btn, key) {
      const on = key === (settingsUi.hour12 ? "h12" : "h24");
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    settingsUi.autoBtns.forEach(function (btn, key) {
      const on = key === (settingsUi.autoRotate || "orbit");
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncAutoRotateChip();

    settingsUi.layerRows.forEach(function (btn, key) {
      const on = settingsUi.layers[key] !== false;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });

    if (settingsUi.debrisRow) {
      settingsUi.debrisRow.classList.toggle("is-on", !!showDebris);
      settingsUi.debrisRow.setAttribute("aria-checked", showDebris ? "true" : "false");
    }
  }

  function ensureSettingsEntry() {
    let btn = byId("settings-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "settings-btn";
      btn.className = "observer-chip settings-entry";
      const icon = document.createElement("span");
      icon.className = "oc-icon";
      icon.textContent = "⚙";
      const label = document.createElement("span");
      label.className = "oc-label";
      label.textContent = "设置";
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.title = "设置：时区 / 时间格式 / 图层与图例";
      btn.setAttribute("aria-label", "打开设置");
      const search = byId("global-search-btn");
      const chip = byId("observer-chip");
      if (search && search.parentNode) search.parentNode.insertBefore(btn, search.nextSibling);
      else if (chip && chip.parentNode) chip.parentNode.insertBefore(btn, chip.nextSibling);
      else if (refs.dataStatus && refs.dataStatus.parentNode) refs.dataStatus.parentNode.insertBefore(btn, refs.dataStatus.nextSibling);
      btn.addEventListener("click", toggleSettings);
    }
    return btn;
  }

  function openSettings() {
    ensureSettings();
    if (!settingsUi.overlay) return;
    syncSettingsControls();
    settingsUi.overlay.hidden = false;
    settingsUi.open = true;
    const btn = byId("settings-btn");
    if (btn) btn.classList.add("is-active");
    const close = byId("settings-close");
    if (close && typeof close.focus === "function") close.focus();
  }

  function closeSettings() {
    if (!settingsUi.overlay) return;
    settingsUi.overlay.hidden = true;
    settingsUi.open = false;
    const btn = byId("settings-btn");
    if (btn) btn.classList.remove("is-active");
  }

  function toggleSettings() {
    if (settingsUi.open) closeSettings();
    else openSettings();
  }

  function setSettings(next) {
    const s = next || {};
    if ("tz" in s) {
      if (s.tz === "local" || s.tz === "utc" || typeof s.tz === "number") {
        const changed = String(settingsUi.tz) !== String(s.tz);
        settingsUi.tz = s.tz;
        if (typeof s.tz === "number") {
          settingsUi.custom = s.tz;
          // main 会把同一份设置回传，值没变时不要重置「自定义」模式
          if (changed) settingsUi.customMode = s.tz !== 480;
        } else {
          settingsUi.customMode = false;
        }
      }
    }
    if (typeof s.hour12 === "boolean") settingsUi.hour12 = s.hour12;
    if (s.lang === "en" || s.lang === "zh") {
      if (s.lang !== lang) setLang(s.lang, { notify: false });
    }
    if (s.autoRotate === "off" || s.autoRotate === "orbit" || s.autoRotate === "earth") {
      settingsUi.autoRotate = s.autoRotate;
      if (s.autoRotate !== "off") settingsUi.lastAutoMode = s.autoRotate;
    }
    if (typeof s.layers === "object" && s.layers) {
      Object.keys(s.layers).forEach(function (key) {
        if (key in settingsUi.layers) settingsUi.layers[key] = !!s.layers[key];
      });
    }
    syncSettingsControls();
  }

  /* ---------- V4 跟随开关（详情卡） ---------- */

  /* ---------- V10 浮动详情卡 ---------- */

  const DETAIL_POS_KEY = "holomirror.detailPos";
  const DETAIL_MODE_KEY = "holomirror.detailMode";

  const fp = {
    mode: "float",
    anchor: null,
    pos: null,
    home: null,
    placeholder: null,
    toggleBtn: null,
    sheetHandle: null,
    drag: null,
    pinned: false,
    resizeBound: false,
    selectionKey: "",
    appliedKey: ""
  };

  function readStore(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (err) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (err) { /* ignore */ }
  }

  function readSavedPos() {
    const raw = readStore(DETAIL_POS_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (p && isNum(p.left) && isNum(p.top)) return { left: Number(p.left), top: Number(p.top) };
    } catch (err) { /* ignore */ }
    return null;
  }

  function ensureDetailChrome() {
    const block = refs.detailBlock;
    if (!block) return;
    const title = block.querySelector(".panel-title");
    if (title) {
      title.classList.add("detail-handle");
      title.title = "拖动移动卡片 · 双击切换【浮动 / 停靠】";
    }

    let toggle = byId("detail-float-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = "detail-float-toggle";
      toggle.className = "link-btn detail-float-btn";
      toggle.textContent = "⤢ 停靠";
      toggle.title = "在浮动卡与停靠右栏之间切换（也可双击标题栏）";
      const close = byId("detail-close");
      const host = title || block;
      if (close && close.parentNode === host) host.insertBefore(toggle, close);
      else host.appendChild(toggle);
    }
    if (!toggle.dataset.bound) {
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        setDetailMode(fp.mode === "float" ? "dock" : "float", true);
      });
      toggle.dataset.bound = "1";
    }
    fp.toggleBtn = toggle;

    let handle = byId("detail-sheet-handle");
    if (!handle) {
      handle = document.createElement("div");
      handle.id = "detail-sheet-handle";
      handle.className = "detail-sheet-handle";
      handle.setAttribute("aria-hidden", "true");
      const bar = document.createElement("span");
      bar.className = "dsh-bar";
      handle.appendChild(bar);
      block.insertBefore(handle, block.firstChild);
      bindSheetHandle(handle);
    }
    fp.sheetHandle = handle;

    let note = byId("detail-dock-note");
    if (!note) {
      note = document.createElement("button");
      note.type = "button";
      note.id = "detail-dock-note";
      note.className = "detail-dock-note";
      note.hidden = true;
      note.addEventListener("click", function () {
        setDetailMode("dock", true);
      });
    }
    fp.placeholder = note;

    if (!block.dataset.floatBound) {
      block.addEventListener("pointerdown", onDetailPointerDown);
      block.addEventListener("dblclick", onDetailDoubleClick);
      block.dataset.floatBound = "1";
    }
    if (!fp.resizeBound && typeof window !== "undefined") {
      window.addEventListener("resize", onDetailViewportResize);
      fp.resizeBound = true;
    }
  }

  function updateFloatButton() {
    const btn = fp.toggleBtn || byId("detail-float-toggle");
    if (!btn) return;
    const floating = fp.mode === "float";
    btn.textContent = floating ? "⤢ 停靠" : "⤢ 浮动";
    btn.classList.toggle("is-on", floating);
    btn.setAttribute("aria-pressed", floating ? "true" : "false");
  }

  function updateDockPlaceholder() {
    const note = fp.placeholder;
    if (!note) return;
    const sel = obsData.selectionDetail || {};
    const fromDetail = detailRefs && detailRefs.name ? String(detailRefs.name.textContent || "").trim() : "";
    const name = sel.name ? String(sel.name) : (fromDetail && fromDetail !== "--" ? fromDetail : "");
    note.textContent = name
      ? "已选中：" + name + " · 详情在浮动卡（点此停靠）"
      : "已选中目标 · 详情在浮动卡（点此停靠）";
  }

  function ensureDockPlaceholder() {
    const note = fp.placeholder;
    if (!note || !fp.home || !fp.home.parent) return;
    const parent = fp.home.parent;
    if (note.parentNode !== parent) {
      const ref = fp.home.next && fp.home.next.parentNode === parent ? fp.home.next : null;
      parent.insertBefore(note, ref);
    }
    note.hidden = !!(refs.detailBlock && refs.detailBlock.hidden);
    updateDockPlaceholder();
  }

  function removeDockPlaceholder() {
    const note = fp.placeholder;
    if (note && note.parentNode) note.parentNode.removeChild(note);
  }

  function applyDetailPos(left, top) {
    const block = refs.detailBlock;
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const w = rect.width || 322;
    const h = Math.min(rect.height || 240, block.offsetHeight || rect.height || 240);
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(margin, window.innerHeight - h - margin);
    const l = Math.min(Math.max(left, margin), maxLeft);
    const t = Math.min(Math.max(top, margin), maxTop);
    block.style.left = Math.round(l) + "px";
    block.style.top = Math.round(t) + "px";
  }

  function syncSheetLayout() {
    const block = refs.detailBlock;
    if (!block) return;
    if (fp.mode === "float" && isNarrow()) {
      block.classList.add("is-sheet");
      block.style.left = "";
      block.style.top = "";
      block.style.transformOrigin = "";
    } else {
      block.classList.remove("is-sheet");
    }
  }

  function restartDetailAnimation() {
    const block = refs.detailBlock;
    if (!block) return;
    block.classList.remove("is-entering");
    void block.offsetWidth;
    block.classList.add("is-entering");
    window.setTimeout(function () {
      if (block) block.classList.remove("is-entering");
    }, 240);
  }

  function positionFloatingDetail(anchor) {
    const block = refs.detailBlock;
    if (!block || fp.mode !== "float") return;
    if (isNarrow()) {
      syncSheetLayout();
      restartDetailAnimation();
      return;
    }
    syncSheetLayout();

    const rect = block.getBoundingClientRect();
    const w = rect.width || 322;
    const h = Math.min(block.offsetHeight || rect.height || 240, window.innerHeight - 16);
    const gap = 14;
    const margin = 8;
    let left;
    let top;

    // 用户拖动过（或上次位置已记忆）时优先用记忆位置，否则跟随点击点展开
    const saved = readSavedPos();
    if (saved) {
      left = saved.left;
      top = saved.top;
      if (anchor && isNum(anchor.x) && isNum(anchor.y)) {
        const ox = Math.max(4, Math.min(w - 4, anchor.x - left));
        const oy = Math.max(4, Math.min(h - 4, anchor.y - top));
        block.style.transformOrigin = ox + "px " + oy + "px";
      } else {
        block.style.transformOrigin = "50% 0%";
      }
    } else if (anchor && isNum(anchor.x) && isNum(anchor.y)) {
      left = anchor.x + gap;
      top = anchor.y + gap;
      if (left + w > window.innerWidth - margin) left = anchor.x - w - gap;
      if (top + h > window.innerHeight - margin) top = anchor.y - h - gap;
      const originX = Math.max(4, Math.min(w - 4, anchor.x - left));
      const originY = Math.max(4, Math.min(h - 4, anchor.y - top));
      block.style.transformOrigin = originX + "px " + originY + "px";
    } else {
      left = window.innerWidth - w - 24;
      top = 96;
      block.style.transformOrigin = "100% 0%";
    }
    applyDetailPos(left, top);
    restartDetailAnimation();
  }

  function setDetailMode(mode, notify) {
    const block = refs.detailBlock;
    if (!block) return;
    const next = mode === "dock" ? "dock" : "float";
    if (!fp.home) fp.home = { parent: block.parentNode, next: block.nextSibling };
    fp.mode = next;
    writeStore(DETAIL_MODE_KEY, next);
    updateFloatButton();

    if (next === "float") {
      if (block.parentNode !== document.body) document.body.appendChild(block);
      block.classList.add("is-float");
      fp.home.parent && ensureDockPlaceholder();
      syncSheetLayout();
      if (!block.hidden) positionFloatingDetail(fp.anchor);
    } else {
      block.classList.remove("is-float", "is-sheet", "is-dragging", "is-entering");
      block.style.left = "";
      block.style.top = "";
      block.style.transformOrigin = "";
      if (fp.home && fp.home.parent && block.parentNode === document.body) {
        const ref = fp.home.next && fp.home.next.parentNode === fp.home.parent ? fp.home.next : null;
        fp.home.parent.insertBefore(block, ref);
      }
      removeDockPlaceholder();
      if (!block.hidden) {
        openDetailPanel();
        scrollDetailIntoView();
      }
    }
    if (notify) {
      // 纯 UI 行为，无对应 handler
    }
  }

  function presentDetail() {
    ensureDetailChrome();
    if (fp.mode === "float") {
      if (refs.detailBlock.parentNode !== document.body) {
        if (!fp.home) fp.home = { parent: refs.detailBlock.parentNode, next: refs.detailBlock.nextSibling };
        document.body.appendChild(refs.detailBlock);
      }
      refs.detailBlock.classList.add("is-float");
      ensureDockPlaceholder();
      updateFloatButton();
      syncSheetLayout();
      fp.appliedKey = fp.selectionKey;
      positionFloatingDetail(fp.anchor);
    } else {
      openDetailPanel();
      scrollDetailIntoView();
    }
  }

  /** 指针捕获后 event.target 会变成卡片本身，用坐标命中测试兜底 */
  function detailHitAt(x, y) {
    if (x == null || y == null || typeof document.elementFromPoint !== "function") return null;
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    if (!el.closest("#detail-block")) return null;
    return el;
  }

  function onDetailPointerDown(event) {
    if (fp.mode !== "float" || isNarrow()) return;
    const target = event.target;
    const hit = detailHitAt(event.clientX, event.clientY) || target;
    if (!hit || typeof hit.closest !== "function") return;
    if (hit.closest("button, a, input, select, textarea, .tle-copy, .obs-item")) return;
    const head = hit.closest(".panel-title, .detail-head");
    if (!head) return;
    const block = refs.detailBlock;
    if (!block) return;
    const rect = block.getBoundingClientRect();
    fp.drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, id: event.pointerId, moved: false };
    block.classList.add("is-dragging");
    // 注意：这里不 preventDefault，否则浏览器不会再派发 click / dblclick（双击切停靠要用）
    event.stopPropagation();
    if (typeof block.setPointerCapture === "function" && event.pointerId != null) {
      try { block.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    block.addEventListener("pointermove", onDetailPointerMove);
    block.addEventListener("pointerup", onDetailPointerUp);
    block.addEventListener("pointercancel", onDetailPointerUp);
  }

  function onDetailPointerMove(event) {
    if (!fp.drag) return;
    event.preventDefault();
    event.stopPropagation();
    fp.drag.moved = true;
    applyDetailPos(event.clientX - fp.drag.dx, event.clientY - fp.drag.dy);
  }

  function onDetailPointerUp(event) {
    const block = refs.detailBlock;
    if (fp.drag) {
      fp.drag = null;
      if (block) {
        block.classList.remove("is-dragging");
        block.removeEventListener("pointermove", onDetailPointerMove);
        block.removeEventListener("pointerup", onDetailPointerUp);
        block.removeEventListener("pointercancel", onDetailPointerUp);
        const rect = block.getBoundingClientRect();
        fp.pos = { left: rect.left, top: rect.top };
        fp.pinned = true;
        writeStore(DETAIL_POS_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
      }
    }
    if (event) event.stopPropagation();
  }

  function onDetailDoubleClick(event) {
    const hit = detailHitAt(event.clientX, event.clientY) || event.target;
    if (!hit || typeof hit.closest !== "function") return;
    if (hit.closest("button, a, input")) return;
    if (!hit.closest(".panel-title, .detail-head")) return;
    event.preventDefault();
    setDetailMode(fp.mode === "float" ? "dock" : "float", true);
  }

  function onDetailViewportResize() {
    if (fp.mode !== "float" || !refs.detailBlock || refs.detailBlock.hidden) return;
    syncSheetLayout();
    if (isNarrow()) return;
    const rect = refs.detailBlock.getBoundingClientRect();
    applyDetailPos(rect.left, rect.top);
    const now = refs.detailBlock.getBoundingClientRect();
    if (fp.pinned) {
      fp.pos = { left: now.left, top: now.top };
      writeStore(DETAIL_POS_KEY, JSON.stringify({ left: Math.round(now.left), top: Math.round(now.top) }));
    }
  }

  function bindSheetHandle(handle) {
    let startY = null;
    let delta = 0;
    const block = function () { return refs.detailBlock; };
    handle.addEventListener("pointerdown", function (event) {
      if (fp.mode !== "float" || !isNarrow()) return;
      startY = event.clientY;
      delta = 0;
      const el = block();
      if (el) el.classList.add("is-dragging");
      event.preventDefault();
      event.stopPropagation();
      if (typeof handle.setPointerCapture === "function" && event.pointerId != null) {
        try { handle.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
      }
    });
    handle.addEventListener("pointermove", function (event) {
      if (startY === null) return;
      delta = Math.max(0, event.clientY - startY);
      const el = block();
      if (el) el.style.transform = "translateY(" + Math.min(delta, 140) + "px)";
      event.preventDefault();
    });
    handle.addEventListener("pointerup", function (event) {
      if (startY === null) return;
      const el = block();
      const shouldClose = delta > 80;
      startY = null;
      delta = 0;
      if (el) {
        el.classList.remove("is-dragging");
        el.style.transform = "";
      }
      event.stopPropagation();
      if (shouldClose) closeDetail();
    });
    handle.addEventListener("pointercancel", function () {
      startY = null;
      delta = 0;
      const el = block();
      if (el) {
        el.classList.remove("is-dragging");
        el.style.transform = "";
      }
    });
  }

  function ensureFollowButton() {
    const title = document.querySelector("#detail-block .panel-title");
    if (!title) return;
    let btn = byId("detail-follow");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "detail-follow";
      btn.className = "link-btn follow-btn";
      btn.textContent = "跟随";
      btn.title = "相机跟随选中卫星（快捷键 F）";
      btn.setAttribute("aria-pressed", "false");
      const close = byId("detail-close");
      if (close && close.parentNode === title) title.insertBefore(btn, close);
      else title.appendChild(btn);
    }
    if (!btn.dataset.bound) {
      btn.addEventListener("click", function () {
        const next = !v4.following;
        setFollowingState(next);
        callHandler("onToggleFollow", next);
      });
      btn.dataset.bound = "1";
    }
    v4.followBtn = btn;
  }

  function setFollowingState(on) {
    v4.following = !!on;
    const btn = v4.followBtn || byId("detail-follow");
    if (!btn) return;
    btn.classList.toggle("is-on", v4.following);
    btn.setAttribute("aria-pressed", v4.following ? "true" : "false");
    btn.textContent = v4.following ? "跟随中" : "跟随";
  }

  function setFollowing(on) {
    setFollowingState(on);
  }

  /* ---------- V4 地球选点模式 ---------- */

  /** 只切视觉态，不回调 handler（供 main 侧 setPickingOnGlobe 调用，避免递归） */
  function setPickModeVisual(on) {
    v4.pickMode = !!on;
    if (obsEl.pickBtn) {
      obsEl.pickBtn.classList.toggle("is-active", v4.pickMode);
      obsEl.pickBtn.setAttribute("aria-pressed", v4.pickMode ? "true" : "false");
    }
    if (obsEl.pickHint) obsEl.pickHint.hidden = !v4.pickMode;
  }

  function enterPickMode() {
    if (typeof h.onPickOnGlobe !== "function") {
      showToast("当前版本不支持在地球上选点");
      return;
    }
    setPickModeVisual(true);
    callHandler("onPickOnGlobe");
  }

  function exitPickMode() {
    setPickModeVisual(false);
  }

  function setPickingOnGlobe(on) {
    setPickModeVisual(!!on);
  }

  /* ---------- 公共 API（契约 §4） ---------- */

  function ensureLiveBadge() {
    let live = byId("ds-live");
    if (live) return live;
    const anchor = refs.dataSource || byId("data-source");
    if (!anchor || !anchor.parentNode) return null;
    live = document.createElement("span");
    live.id = "ds-live";
    live.className = "ds-live";
    live.textContent = "LIVE";
    live.title = "实时全量目录（≥ " + fmtInt(LIVE_MIN_TARGETS) + " 目标）";
    live.hidden = true;
    anchor.parentNode.insertBefore(live, anchor.nextSibling);
    return live;
  }

  function setDataStatus(status) {
    flushPendingLayers();
    const s = status || {};
    const sourceKey = s.source ? String(s.source).toLowerCase() : "";
    const label = SOURCE_LABELS[sourceKey] || (s.source ? String(s.source).toUpperCase() : "数据链路");

    if (refs.dataSource) {
      const countText = isNum(s.count) ? " · " + fmtInt(s.count) : "";
      setText(refs.dataSource, label + countText);
    }
    if (refs.dataUpdated) setText(refs.dataUpdated, formatUpdated(s.updated));
    if (refs.dataStatus) {
      const stale = sourceKey === "cache" || sourceKey === "snapshot" || sourceKey === "local";
      refs.dataStatus.classList.toggle("is-stale", !!stale);
      refs.dataStatus.title = "数据来源：" + label + (s.updated ? " · 更新 " + String(s.updated) : "");
    }
    const live = ensureLiveBadge();
    if (live) live.hidden = !(isNum(s.count) && Number(s.count) >= LIVE_MIN_TARGETS);
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
    refreshClearFilters();
  }

  function updateCategories(list) {
    if (!Array.isArray(list)) return;
    if (!refs.categoryChips) refs.categoryChips = ensureCategorySection();
    if (!refs.categoryBars) refs.categoryBars = ensureCategoryBars();
    categoryFiltering = list.some(function (item) { return item && item.active === false; });
    list.forEach(updateCategoryChip);
    renderCategoryBars(list);

    // 芯片顺序跟随 main 下发的顺序（新增 debris 时保持一致）
    const order = list.map(function (item) { return item && item.key; }).filter(Boolean);
    if (refs.categoryChips && order.length) {
      const current = Array.prototype.map.call(refs.categoryChips.children, function (el) { return el.dataset.category; });
      const same = current.length === order.length && current.every(function (key, i) { return key === order[i]; });
      if (!same) {
        order.forEach(function (key) {
          const chip = categoryChips.get(key);
          if (chip) refs.categoryChips.appendChild(chip.el);
        });
      }
    }
    renderSubcategories();
    refreshClearFilters();
  }

  function updateTelescopeStatus(list) {
    obsData.telescopes = Array.isArray(list) ? list : [];
    applyTelescopes();
  }

  function updateObjectKinds(list) {
    if (!Array.isArray(list)) return;
    if (!refs.objectKindBars) refs.objectKindBars = ensureObjectKindBars();
    renderObjectKindBars(list);
  }

  function setSelection(detail, anchor) {
    const a = anchor && isNum(anchor.x) && isNum(anchor.y)
      ? { x: Number(anchor.x), y: Number(anchor.y) }
      : null;
    if (a) fp.anchor = a;
    else if (!detail) fp.anchor = null;
    // main 会周期性用 setSelection(detail)（不带 anchor）刷新动态字段，这种情况保留上次展开点
    const id = detail && detail.id != null ? String(detail.id) : "";
    fp.selectionKey = id + "@" + (fp.anchor ? Math.round(fp.anchor.x) + "," + Math.round(fp.anchor.y) : "-");
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
  refs.objectKindBars = ensureObjectKindBars();
  buildOrbitChips();
  buildCategoryChips();
  renderCategoryBars(CATEGORY_DEFS.map(function (def) {
    return { key: def.key, label: def.label, count: null, color: def.color };
  }));
  renderObjectKindBars(OBJECT_KIND_DEFS.map(function (def) {
    return { key: def.key, label: def.label, count: null, color: def.color };
  }));
  buildSpeedButtons();
  buildLayerButtons();
  buildStatGrid();
  buildDetail();
  const savedSettings = readSavedSettings();
  if (savedSettings) {
    if ("tz" in savedSettings) {
      settingsUi.tz = savedSettings.tz;
      if (typeof savedSettings.tz === "number") settingsUi.custom = savedSettings.tz;
    }
    if (typeof savedSettings.hour12 === "boolean") settingsUi.hour12 = savedSettings.hour12;
    if (savedSettings.autoRotate) {
      settingsUi.autoRotate = savedSettings.autoRotate;
      if (savedSettings.autoRotate !== "off") settingsUi.lastAutoMode = savedSettings.autoRotate;
    }
    if (savedSettings.layers) {
      const pending = [];
      Object.keys(savedSettings.layers).forEach(function (key) {
        if (!(key in settingsUi.layers)) return;
        const on = !!savedSettings.layers[key];
        if (settingsUi.layers[key] === on) return;
        settingsUi.layers[key] = on;
        syncLayerChip(key, on);
        pending.push({ key: key, on: on });
      });
      if (pending.length) {
        // main 的 globe 在本函数之后才创建，先记下来，等 setDataStatus / 超时兜底再下发
        pendingLayerSync = pending;
        if (typeof window !== "undefined") {
          window.setTimeout(flushPendingLayers, 1200);
        }
      }
    }
  }
  ensureSettings();
  if (readStore(DETAIL_MODE_KEY) === "dock") fp.mode = "dock";
  ensureDetailChrome();
  updateFloatButton();
  ensureFollowButton();
  ensureObserverChip();
  ensureSearchEntry();
  ensureGlobalSearch();
  ensureObserveUI();
  ensureBottomControls();
  ensureHelpOverlay();
  bindTopBar();
  bindPanels();
  bindSearch();
  ensureClearFilters();
  refreshClearFilters();
  initConsent();
  startLocalizeObserver();
  // main 启动时不一定会下发 lang，这里自己按 localStorage 恢复一次
  try {
    const savedSettings = readStore(SETTINGS_KEY);
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      if (parsed && (parsed.lang === "en" || parsed.lang === "zh")) setLang(parsed.lang, { notify: false });
    }
  } catch (err) { /* 忽略 */ }
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
    updateObjectKinds: updateObjectKinds,
    updateTelescopeStatus: updateTelescopeStatus,
    setShowDebris: setShowDebrisState,
    setFiltersSummary: setFiltersSummary,
    setLang: function (value) { setLang(value, { notify: false }); },
    updateSubcategories: updateSubcategories,
    setTelescopeOnly: setTelescopeOnlyState,
    setStationOnly: setStationOnlyState,
    setSearch: setSearchState,
    setSettings: setSettings,
    setSelection: setSelection,
    setObserver: setObserver,
    updateVisibleNow: updateVisibleNow,
    updatePasses: updatePasses,
    setPassDetail: setPassDetail,
    setObserving: setObserving,
    setFollowing: setFollowing,
    setPickingOnGlobe: setPickingOnGlobe,
    setLoading: setLoading,
    setError: setError,
    toast: showToast
  };
}
