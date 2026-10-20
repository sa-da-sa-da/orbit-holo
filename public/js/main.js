// 总装：数据接入、场景、时钟、筛选、拾取、UI 联动
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createGlobe } from './globe.js';
import { createSatLayer, createOrbitLine, createSelectionMarker, occludedByEarth } from './satellites.js';
import { loadLandTextures } from './topo.js';

// 全息风格：所有颜色按 sRGB 直出，不做线性/色彩管理转换，保证所见即所得
THREE.ColorManagement.enabled = false;

const WORLD_R = 100;
const EARTH_KM = 6371;

const COUNTRY_PALETTE = [
  '#5ef0ff', '#ff5ea8', '#a78bfa', '#ffd166', '#4ade80', '#ff8f4d',
  '#38bdf8', '#f472b6', '#c084fc', '#22d3ee', '#fb7185', '#a3e635',
  '#facc15', '#60a5fa', '#2dd4bf', '#f97316',
];
const ORBIT_COLORS = { LEO: '#5ef0ff', MEO: '#7ea8ff', GEO: '#ff5ea8', HEO: '#c08bff', OTHER: '#6f8b99' };
const ORBIT_LABELS = { LEO: 'LEO 低轨', MEO: 'MEO 中轨', GEO: 'GEO 静止', HEO: 'HEO 高椭圆', OTHER: 'OTHER 其他' };
const ORBIT_LABELS_ZH = { LEO: '低地球轨道', MEO: '中地球轨道', GEO: '地球同步轨道', HEO: '大椭圆轨道', OTHER: '其他轨道' };

// 任务类型：前 9 类对应 /api/catalog，telescope/station 为前端派生类
const CATEGORY_ORDER = ['comms', 'nav', 'eo', 'mil', 'weather', 'science',
  'telescope', 'station', 'tech', 'debris', 'other'];
const CATEGORY_COLORS = {
  comms: '#5ef0ff', nav: '#ffd166', eo: '#4ade80', weather: '#7dd3fc',
  mil: '#ff5ea8', science: '#a78bfa', telescope: '#fbbf24',
  station: '#38bdf8', tech: '#f97316', debris: '#7f8b96', other: '#6b8ea3',
};
// V5：按对象类型（有效载荷 / 火箭残骸 / 碎片 / 未知）
const KIND_ORDER = ['PAY', 'R-B', 'DEB', 'UNK'];
const KIND_COLORS = { PAY: '#5ef0ff', 'R-B': '#ffd166', DEB: '#7f8b96', UNK: '#6b8ea3' };
const KIND_LABELS = { PAY: '有效载荷', 'R-B': '火箭残骸', DEB: '碎片', UNK: '未知' };
const TELESCOPE_LABELS = { optical: '光学', xray: 'X 射线', gamma: '伽马', ir: '红外', solar: '太阳', particle: '粒子' };
const STATION_LABELS = { station: '常驻空间站', crew: '载人飞船', cargo: '货运飞船' };
// 望远镜中文名（NASA / 中国官方惯用译名）
const TELESCOPE_NAMES_ZH = {
  HST: '哈勃空间望远镜',
  JWST: '詹姆斯·韦布空间望远镜',
  CXO: '钱德拉 X 射线天文台',
  XMM: 'XMM-牛顿 X 射线天文台',
  INTEGRAL: '国际伽马射线天体物理实验室',
  MOST: '微型卫星 MOST',
  SWIFT: '雨燕伽马暴快速响应探测器',
  SDO: '太阳动力学天文台',
  NUSTAR: '核分光望远镜阵',
  IRIS: '界面区成像光谱仪',
  ASTROSAT: '印度天文卫星 AstroSat',
  DAMPE: '悟空号暗物质粒子探测卫星',
  HXMT: '慧眼号硬 X 射线调制望远镜',
  CHEOPS: '系外行星表征卫星 CHEOPS',
  'GECAM-A': '引力波暴高能电磁对应体全天监测器 A 星',
  'GECAM-B': '引力波暴高能电磁对应体全天监测器 B 星',
  IXPE: 'X 射线偏振成像探测器',
  'ASO-S': '夸父一号先进天基太阳天文台',
  'EINSTEIN PROBE': '爱因斯坦探针（天关）',
  SMILE: '太阳风-磁层相互作用全景成像卫星',
};
// 望远镜观测成果图（本地 public/img/astro/，来自 NASA 公共领域图库）
const ASTRO_GALLERY = {
  HST: ['hst-pillars', 'hst-deepfield', 'hst-orion', 'hst-jupiter', 'hst-saturn', 'hst-galaxy'],
  JWST: ['jwst-carina', 'jwst-ring', 'jwst-deep'],
  CXO: ['cxo-crab', 'cxo-casa', 'cxo-cluster', 'cxo-andromeda'],
  XMM: ['xmm-snr'],
  NUSTAR: ['nustar-bh', 'nustar-sun'],
  IXPE: ['ixpe-casa'],
  SDO: ['sdo-sun', 'sdo-flare'],
  IRIS: ['iris-flare'],
};
const ASTRO_BY_TYPE = {
  optical: ['hst-orion', 'hst-galaxy'],
  xray: ['cxo-casa', 'cxo-cluster'],
  gamma: ['fermi-crab', 'fermi-sky'],
  solar: ['sdo-flare', 'sdo-sun'],
  ir: ['jwst-carina'],
  particle: ['fermi-sky'],
};
let astroManifest = null;
const CATEGORY_LABELS = {
  comms: '通信 / 互联网', nav: '导航 / 定位', eo: '对地观测 / 遥感', mil: '军事 / 侦察',
  weather: '气象 / 海洋 / 环境', science: '科学 / 深空', telescope: '天文望远镜',
  station: '空间站 / 载人', tech: '技术试验 / 教育 / 业余',
  debris: '碎片 / 残骸', other: '其他 / 未分类',
};
const STATUS_TEXT = { '+': '在轨运行', P: '部分可用', B: '备份(未跟踪)', S: '备用状态', X: '已失效', '': '未知状态' };

const state = {
  catalog: null,
  sats: [],
  countries: [],
  countryMap: new Map(),
  countryColor: new Map(),
  filters: { countries: new Set(), orbits: new Set(), categories: new Set(), subcategories: new Set(), query: '', showDebris: false },
  subcategories: [],
  fly: null,
  hidden: new Uint8Array(0),
  visibleCount: 0,
  telescopeIndices: [],
  telescopeStatus: [],
  telescopeWindows: new Map(),
  reminders: new Map(),
  colorMode: 'country',
  selection: -1,
  hover: -1,
  layers: { orbits: true, grid: true, atmosphere: true, stars: true, autoRotate: true, labels: true, terminator: true, meridian: true, axis: true },
  clock: { baseMs: Date.now(), baseReal: performance.now(), rate: 1, paused: false },
  observer: null,
  visibility: null,
  visTime: 0,
  visibleNow: [],
  passes: [],
  passesByIndex: new Map(),
  passesAt: 0,
  passesPending: false,
  focusVisibleOnly: false,
  follow: false,
  quality: 'high',
  awaitingObserverClick: false,
  seekingUntil: 0,
  pendingShot: false,
};

// ---------- 时钟 ----------
function nowMs() {
  const c = state.clock;
  return c.paused ? c.baseMs : c.baseMs + (performance.now() - c.baseReal) * c.rate;
}
// ---------- 工具 ----------
const colorCache = new Map();
function hexToRgb(hex) {
  if (colorCache.has(hex)) return colorCache.get(hex);
  const c = new THREE.Color(hex);
  const out = [c.r, c.g, c.b];
  colorCache.set(hex, out);
  return out;
}
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const SETTINGS_KEY = 'holomirror.settings';
const settings = { tz: 'local', hour12: false, autoRotate: 'orbit', autoFit: true, lang: 'zh' };
const CATEGORY_LABELS_EN = {
  comms: 'Communications', nav: 'Navigation', eo: 'Earth Observation', mil: 'Military / Recon',
  weather: 'Weather / Ocean', science: 'Science', telescope: 'Space Telescopes', station: 'Stations / Crewed',
  tech: 'Technology / Education', debris: 'Debris & Rocket Bodies', other: 'Other / Unclassified',
};
const KIND_LABELS_EN = { PAY: 'Payload', 'R-B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };
const STATION_LABELS_EN = { station: 'Space station', crew: 'Crewed spacecraft', cargo: 'Cargo spacecraft' };
const TELESCOPE_LABELS_EN = { optical: 'Optical', xray: 'X-ray', gamma: 'Gamma-ray', ir: 'Infrared', solar: 'Solar', particle: 'Particles' };
const ORBIT_LABELS_EN = { LEO: 'Low Earth orbit', MEO: 'Medium Earth orbit', GEO: 'Geostationary', HEO: 'Highly elliptical', OTHER: 'Other' };
const isEn = () => settings.lang === 'en';
const pickLang = (zh, en) => (isEn() ? (en || zh) : zh);

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && (o.tz === 'local' || o.tz === 'utc' || typeof o.tz === 'number')) settings.tz = o.tz;
    if (o && typeof o.hour12 === 'boolean') settings.hour12 = o.hour12;
    if (o && ['off', 'orbit', 'earth'].indexOf(o.autoRotate) >= 0) settings.autoRotate = o.autoRotate;
    if (o && (o.lang === 'zh' || o.lang === 'en')) settings.lang = o.lang;
  } catch (err) { /* 忽略损坏的设置 */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) { /* 隐私模式忽略 */ }
}

function tzOffsetMinutes(tz) {
  if (tz === 'local') return -new Date().getTimezoneOffset();
  if (tz === 'utc') return 0;
  return typeof tz === 'number' ? tz : 0;
}

function tzLabel(tz) {
  if (tz === 'local') return '本地';
  if (tz === 'utc') return 'UTC';
  const m = typeof tz === 'number' ? tz : 0;
  const sign = m >= 0 ? '+' : '-';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return 'UTC' + sign + h + (mm ? ':' + pad2(mm) : '');
}

function fmtUTC(ms) {
  const d = new Date(ms);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

/** 按设置格式化某地时间（含 12/24 小时制） */
function fmtZoned(ms, tz, withDate) {
  const off = tzOffsetMinutes(tz) * 60000;
  const d = new Date(ms + off);
  let h = d.getUTCHours();
  let suffix = '';
  if (settings.hour12) {
    suffix = h < 12 ? ' AM' : ' PM';
    h = h % 12;
    if (h === 0) h = 12;
  }
  const time = pad2(h) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + suffix;
  if (!withDate) return time;
  return pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) + ' ' + time;
}

function fmtLocal(ms) {
  const d = new Date(ms);
  return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function fmtNum(n) {
  return (n || 0).toLocaleString('zh-CN');
}

// ---------- 降级 UI（ui.js 未就绪时） ----------
function createFallbackUI() {
  const noop = () => {};
  const el = (id) => document.getElementById(id);
  return {
    setDataStatus(d) {
      const s = el('data-source');
      const u = el('data-updated');
      if (s) s.textContent = d && d.source ? '数据 ' + d.source : '数据 --';
      if (u && d && d.updated) u.textContent = new Date(d.updated).toLocaleTimeString('zh-CN', { hour12: false });
    },
    setPerf(p) {
      const f = el('fps');
      if (f) f.textContent = String(p.fps || 0);
      const r = el('render-count');
      if (r) r.textContent = fmtNum(p.rendered);
      const t = el('total-count');
      if (t) t.textContent = fmtNum(p.total);
    },
    setClock(c) {
      const u = el('clock-utc');
      if (u) u.textContent = c.utc;
      const l = el('clock-local');
      if (l) l.textContent = c.local;
    },
    updateStats: noop,
    updateCountries: noop,
    updateOrbits: noop,
    setSelection(d) {
      const box = el('detail-block');
      const body = el('sat-detail');
      if (box) box.hidden = !d;
      if (body && d) body.textContent = d.name + ' · ' + d.country.name + ' · ' + d.altKm.toFixed(1) + ' km';
    },
    setLoading(l) {
      const box = el('loading');
      if (!box) return;
      box.style.opacity = l.visible ? '1' : '0';
      box.style.pointerEvents = l.visible ? 'auto' : 'none';
      setTimeout(() => { if (!l.visible) box.style.display = 'none'; }, 400);
      const s = el('loading-sub');
      if (s && l.text) s.textContent = l.text;
      const p = el('loading-progress');
      if (p && l.progress != null) p.style.width = Math.round(l.progress * 100) + '%';
    },
    setError(m) {
      const e = el('data-error');
      if (e) { e.hidden = !m; e.textContent = m || ''; }
    },
    toast(m) {
      const t = el('toast');
      if (!t) return;
      t.textContent = m;
      t.classList.add('show');
      clearTimeout(t._timer);
      t._timer = setTimeout(() => t.classList.remove('show'), 1800);
    },
  };
}

// ---------- handlers ----------
const handlers = {
  onSearch(q) {
    state.filters.query = q || '';
    applyFilters();
  },
  onOrbitToggle(key, enabled) {
    if (enabled) state.filters.orbits.add(key);
    else state.filters.orbits.delete(key);
    state.fitPending = true;
    applyFilters();
  },
  onCountryToggle(code, enabled) {
    if (enabled) state.filters.countries.add(code);
    else state.filters.countries.delete(code);
    state.fitPending = true;
    applyFilters();
  },
  onSubcategoryToggle(key, enabled) {
    if (enabled) state.filters.subcategories.add(key);
    else state.filters.subcategories.delete(key);
    applyFilters();
  },
  onCategoryToggle(key, enabled) {
    if (enabled) state.filters.categories.add(key);
    else state.filters.categories.delete(key);
    state.fitPending = true;
    applyFilters();
  },
  onClearFilters() {
    const f = state.filters;
    f.countries.clear();
    f.orbits.clear();
    f.categories.clear();
    f.subcategories.clear();
    f.query = '';
    f.telescopeOnly = false;
    f.stationOnly = false;
    f.showDebris = false;
    if (typeof ui.setSearchValue === 'function') ui.setSearchValue('');
    applyFilters();
    ui.toast('已清空全部筛选');
  },
  onCountriesAll() {
    state.filters.countries.clear();
    applyFilters();
  },
  onSpeed(v) {
    if (v === 0) {
      state.clock.baseMs = nowMs();
      state.clock.paused = true;
      state.clock.baseReal = performance.now();
    } else {
      state.clock.baseMs = nowMs();
      state.clock.paused = false;
      state.clock.baseReal = performance.now();
      state.clock.rate = v;
    }
    syncAutoRotate();
    pushWorkerTime();
  },
  onPlayToggle() {
    if (state.clock.paused) {
      state.clock.baseMs = nowMs();
      state.clock.paused = false;
      state.clock.baseReal = performance.now();
    } else {
      state.clock.baseMs = nowMs();
      state.clock.paused = true;
    }
    syncAutoRotate();
    pushWorkerTime();
  },
  onNow() {
    state.clock.rate = 1;
    state.clock.paused = false;
    state.clock.baseMs = Date.now();
    state.clock.baseReal = performance.now();
    syncAutoRotate();
    pushWorkerTime();
    ui.toast('已回到当前真实时间 · 实时模式');
  },
  onSetLang(lang) {
    settings.lang = lang === 'en' ? 'en' : 'zh';
    saveSettings();
    document.documentElement.setAttribute('lang', settings.lang === 'en' ? 'en' : 'zh-CN');
    if (typeof ui.setLang === 'function') ui.setLang(settings.lang);
    applyFilters();
    ui.toast(settings.lang === 'en' ? 'Language: English' : '界面语言：中文');
  },
  onClearLocalData() {
    const keys = ['holomirror.observer', 'holomirror.settings', 'holomirror.detailPos'];
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch (err) { /* 忽略 */ } });
    ui.toast(settings.lang === 'en' ? 'Local data cleared' : '已清除本地存储数据');
  },
  onAutoRotateChange(mode) {
    settings.autoRotate = ['off', 'orbit', 'earth'].indexOf(mode) >= 0 ? mode : 'off';
    state.layers.autoRotate = settings.autoRotate !== 'off';
    saveSettings();
    syncAutoRotate();
    if (typeof ui.setSettings === 'function') ui.setSettings({ ...settings });
    ui.toast('自动旋转：' + (settings.autoRotate === 'off' ? '关闭' : settings.autoRotate === 'orbit' ? '相机环绕' : '跟随地球自转'));
  },
  onSettingsChange(patch) {
    if (patch && ('tz' in patch)) {
      const tz = patch.tz;
      if (tz === 'local' || tz === 'utc' || typeof tz === 'number') settings.tz = tz;
    }
    if (patch && typeof patch.hour12 === 'boolean') settings.hour12 = patch.hour12;
    saveSettings();
    if (typeof ui.setSettings === 'function') ui.setSettings({ ...settings });
    ui.toast('时间显示：' + tzLabel(settings.tz) + ' · ' + (settings.hour12 ? '12 小时制' : '24 小时制'));
  },
  onLayerToggle(key, enabled) {
    state.layers[key] = !!enabled;
    if (key === 'autoRotate') {
      settings.autoRotate = enabled ? (settings.autoRotate === 'off' ? 'orbit' : settings.autoRotate) : 'off';
      saveSettings();
      syncAutoRotate();
      return;
    }
    if (key === 'telescopes') {
      if (telescopeGroup) telescopeGroup.visible = !!enabled;
      return;
    }
    if (key === 'axis') {
      if (axisGroup) {
        if (enabled && !axisGroup.parent) scene.add(axisGroup);
        if (!enabled) axisGroup.visible = false;
        if (enabled) axisGroup.visible = true;
      }
      return;
    }
    if (key === 'terminator') {
      if (globe) globe.setLayer('terminator', enabled);
      return;
    }
    if (key === 'meridian') {
      if (globe) globe.setLayer('meridian', enabled);
      return;
    }
    if (key === 'grid') globe && globe.setLayer('grid', enabled);
    else if (key === 'atmosphere') globe && globe.setLayer('atmosphere', enabled);
    else if (key === 'stars') globe && globe.setLayer('stars', enabled);
    else if (key === 'autoRotate') controls && (controls.autoRotate = !!enabled);
    else if (key === 'orbits') {
      orbitGroup && (orbitGroup.visible = !!enabled);
      if (enabled) scheduleBatchOrbits();
    } else if (key === 'labels') {
      const tag = document.getElementById('hover-tag');
      if (tag && !enabled) tag.hidden = true;
    }
  },
  onResetView() {
    resetView();
  },
  onRefresh() {
    loadData(true);
  },
  onSelectNone() {
    clearSelection();
  },
  onLocate() {
    if (!navigator.geolocation) {
      ui.toast('浏览器不支持定位，请手动输入经纬度');
      return;
    }
    ui.toast('正在获取你的位置…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setObserver({
          lat: +pos.coords.latitude.toFixed(4),
          lon: +pos.coords.longitude.toFixed(4),
          altM: pos.coords.altitude || 0,
          label: '我的位置',
          source: 'geo',
        });
      },
      (err) => {
        ui.toast('定位失败：' + (err && err.message ? err.message : '被拒绝') + '，可手动输入');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  },
  onObserverPreset(key) {
    const c = CITIES.find((x) => x.key === key || x.label === key);
    if (!c) return;
    setObserver({ lat: c.lat, lon: c.lon, altM: 0, label: c.label, source: 'preset' });
  },
  onObserverManual(lat, lon) {
    const la = Number(lat);
    const lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      ui.toast('经纬度不合法：纬度 -90~90，经度 -180~180');
      return;
    }
    setObserver({ lat: +la.toFixed(4), lon: +lo.toFixed(4), altM: 0, label: '自定义位置', source: 'manual' });
  },
  onObserverClear() {
    setObserver(null);
  },
  onSelectPass(index) {
    if (typeof index !== 'number' || index < 0) return;
    selectSat(index);
  },
  onRemindPass(index) {
    remindFor(Number(index));
  },
  onRemindAll() {
    let n = 0;
    for (const r of state.passes) {
      if (scheduleReminder(r.index, r.startAt)) n++;
    }
    ensureNotifyPermission().then((perm) => {
      if (perm === 'denied') ui.toast('浏览器已拒绝通知权限，仅界面内提醒');
      else if (n) ui.toast('⏰ 已为 ' + n + ' 条过境设置提醒');
      else ui.toast('当前过境时间太近或太远，未设置提醒');
    });
  },
  onExportIcs() {
    exportIcs();
  },
  onSearchQuery(text) {
    return searchSatellites(text);
  },
  onSearchPick(index) {
    const i = Number(index);
    if (!(i >= 0) || i >= state.sats.length) return;
    selectSat(i, { x: Math.round(window.innerWidth * 0.5), y: Math.round(window.innerHeight * 0.42) });
    flyToSatellite(i);
    ui.toast('已定位：' + state.sats[i].name);
  },
  onShowDebris(enabled) {
    state.filters.showDebris = !!enabled;
    applyFilters();
    if (typeof ui.setShowDebris === 'function') ui.setShowDebris(state.filters.showDebris);
  },
  // 兼容旧接口：望远镜 / 空间站现已是「任务类型」伪类目
  onTelescopeOnly(enabled) {
    if (enabled) state.filters.categories.add('telescope');
    else state.filters.categories.delete('telescope');
    applyFilters();
    if (typeof ui.setTelescopeOnly === 'function') ui.setTelescopeOnly(!!enabled);
  },
  onStationOnly(enabled) {
    if (enabled) state.filters.categories.add('station');
    else state.filters.categories.delete('station');
    applyFilters();
    if (typeof ui.setStationOnly === 'function') ui.setStationOnly(!!enabled);
  },
  onSearchInput(text) {
    state.filters.query = String(text || '');
    state.fitPending = true;
    applyFilters();
  },
  onClearSelection() {
    clearSelection();
  },
  onJumpDays(days) {
    const d = Number(days) || 0;
    state.clock.baseMs = nowMs() + d * 86400000;
    state.clock.baseReal = performance.now();
    pushWorkerTime();
    ui.toast('时间已跳转 ' + (d > 0 ? '+' : '') + d + ' 天');
  },
  onTimeSeek(offsetMinutes) {
    const c = state.clock;
    const off = Math.max(-1440, Math.min(1440, Number(offsetMinutes) || 0));
    c.baseMs = Date.now() + off * 60000;
    c.baseReal = performance.now();
    state.seekingUntil = performance.now() + 1600;
    pushWorkerTime();
    scheduleUrlSync();
    if (Math.abs(off) <= 1 && !c.paused) state.passesAt = 0;
  },
  onToggleFollow(enabled) {
    state.follow = !!enabled;
    if (typeof ui.setFollowing === 'function') ui.setFollowing(state.follow);
    if (state.follow && state.selection < 0) ui.toast('先选中一颗卫星，再开启跟随');
  },
  onExportShot() {
    state.pendingShot = true;
  },
  onPickOnGlobe() {
    state.awaitingObserverClick = true;
    if (typeof ui.setPickingOnGlobe === 'function') ui.setPickingOnGlobe(true);
    ui.toast('请在地球上点击一个位置（Esc 取消）');
  },
  onFocusVisibleOnly(enabled) {
    state.focusVisibleOnly = !!enabled;
    if (state.focusVisibleOnly) applyVisibilityHighlight();
    else buildSizes();
  },
};

function pushWorkerTime() {
  if (!worker) return;
  worker.postMessage({ type: 'time', ms: nowMs(), rate: state.clock.rate, paused: state.clock.paused });
}

// ---------- 全局引用 ----------
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let composer = null;
let globe = null;
let satLayer = null;
let selectionMarker = null;
let hoverMarker = null;
let chooserEl = null;
let observerMarker = null;
let horizonRing = null;

const OBSERVER_KEY = 'holomirror.observer';
const CITIES = [
  { key: '北京', label: '北京', lat: 39.9042, lon: 116.4074 },
  { key: '上海', label: '上海', lat: 31.2304, lon: 121.4737 },
  { key: '广州', label: '广州', lat: 23.1291, lon: 113.2644 },
  { key: '深圳', label: '深圳', lat: 22.5431, lon: 114.0579 },
  { key: '成都', label: '成都', lat: 30.5728, lon: 104.0668 },
  { key: '西安', label: '西安', lat: 34.3416, lon: 108.9398 },
  { key: '杭州', label: '杭州', lat: 30.2741, lon: 120.1551 },
  { key: '南京', label: '南京', lat: 32.0603, lon: 118.7969 },
  { key: '武汉', label: '武汉', lat: 30.5928, lon: 114.3055 },
  { key: '哈尔滨', label: '哈尔滨', lat: 45.8038, lon: 126.5349 },
  { key: '乌鲁木齐', label: '乌鲁木齐', lat: 43.8256, lon: 87.6168 },
  { key: '拉萨', label: '拉萨', lat: 29.6520, lon: 91.1721 },
];
let orbitGroup = null;
let worker = null;
let ui = createFallbackUI();
let batchLines = [];
let selOrbit = null;
let selGround = null;
let selectedTrackIndex = -1;
let lastPositions = null;
let lastTrackAt = 0;

// ---------- 主流程 ----------
const BUILD_STAMP = 'v19';

async function boot() {
  // 版本徽标（若被 UI 重写掉则自动补一个）
  let stamp = document.getElementById('build-stamp');
  if (!stamp) {
    stamp = document.createElement('div');
    stamp.id = 'build-stamp';
    stamp.style.cssText = 'position:fixed;right:10px;bottom:6px;font:10px/1 ui-monospace,Consolas,monospace;color:rgba(207,233,242,.45);pointer-events:none;z-index:5';
    document.body.appendChild(stamp);
  }
  stamp.textContent = BUILD_STAMP + ' · ' + new Date().toISOString().slice(0, 10);
  loadSettings();
  state.layers.autoRotate = settings.autoRotate !== 'off';
  loadAstroManifest();
  try {
    const mod = await import('./ui.js?v=19');
    if (mod && typeof mod.createUI === 'function') ui = mod.createUI(handlers);
  } catch (err) {
    console.warn('[ui] 使用降级界面：', err && err.message);
  }

  ui.setLoading({ visible: true, text: '连接数据服务…', progress: 0.05 });
  initScene();

  const lands = await loadLandTextures(THREE, '/data/land-110m.json');
  globe = createGlobe({ radius: WORLD_R, landTexture: lands ? lands.fill : null, edgeTexture: lands ? lands.edge : null });
  scene.add(globe.group);
  ui.setLoading({ visible: true, text: '构建全息地球…', progress: 0.18 });

  await loadData(false);
  animate(performance.now());
  // 调试入口（便于自动化验证）
  window.__MIRROR = {
    state,
    get satLayer() { return satLayer; },
    get globe() { return globe; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get worker() { return worker; },
    get scene() { return scene; },
    setObserver,
    requestPasses,
    handlers,
    get clockOffsetMinutes() { return (nowMs() - Date.now()) / 60000; },
    get visibility() { return state.visibility; },
    get composer() { return composer; },
    get controls() { return controls; },
    get bloom() { return window.__bloomRef || null; },
    /** 调试：渲染一帧后取屏幕某点邻域的亮度统计 */
    sampleAt(x, y, r) {
      composer.render();
      const c = document.createElement('canvas');
      const src = renderer.domElement;
      c.width = r * 2 + 1;
      c.height = r * 2 + 1;
      const cx = c.getContext('2d');
      cx.drawImage(src, x - r, y - r, c.width, c.height, 0, 0, c.width, c.height);
      const d = cx.getImageData(0, 0, c.width, c.height).data;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15;
        max = Math.max(max, l);
        sum += l;
      }
      return { x, y, max: +max.toFixed(1), mean: +(sum / (d.length / 4)).toFixed(2) };
    },
    /** 调试：世界坐标 → 屏幕坐标 */
    projectWorld(v) {
      const p = new THREE.Vector3(v[0], v[1], v[2]).project(camera);
      return { x: Math.round((p.x * 0.5 + 0.5) * renderer.domElement.clientWidth), y: Math.round((0.5 - p.y * 0.5) * renderer.domElement.clientHeight), z: p.z };
    },
    /** 调试：截一张图并返回统计，判断是否为空图 */
    testShot() {
      composer.render();
      const url = renderer.domElement.toDataURL('image/png');
      const img = new Image();
      const done = { len: url.length };
      return new Promise((resolve) => {
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, c.width, c.height).data;
          let sum = 0;
          let nonBlack = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15;
            sum += l;
            if (l > 12) nonBlack++;
          }
          const n = d.length / 4;
          resolve({ ...done, w: c.width, h: c.height, mean: +(sum / n).toFixed(2), nonBlackPct: +((nonBlack / n) * 100).toFixed(1) });
        };
        img.onerror = () => resolve({ ...done, error: 'decode failed' });
        img.src = url;
      });
    },
    /** 读回一帧并给出亮度统计（可选关闭 bloom） */
    pixelStats(noBloom) {
      composer.render();
      if (noBloom) {
        // 直接渲染场景，绕过后期
        const prev = renderer.getRenderTarget();
        renderer.render(scene, camera);
        renderer.setRenderTarget(prev);
      }
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const hist = new Array(16).fill(0);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < W * H; i++) {
        const l = px[i * 4] * 0.35 + px[i * 4 + 1] * 0.5 + px[i * 4 + 2] * 0.15;
        sum += l;
        if (l > max) max = l;
        hist[Math.min(15, Math.floor((l / 255) * 16))]++;
      }
      const sample = (fx, fy) => {
        const x = Math.floor(fx * W);
        const y = Math.floor(fy * H);
        const i = (y * W + x) * 4;
        return [px[i], px[i + 1], px[i + 2]];
      };
      return {
        W,
        H,
        mean: +(sum / (W * H)).toFixed(1),
        max,
        hist,
        center: sample(0.5, 0.5),
        corner: sample(0.02, 0.98),
        left: sample(0.22, 0.5),
        brightRatio: +(hist.slice(10).reduce((a, b) => a + b, 0) / (W * H)).toFixed(4),
      };
    },
    /** 彩色字符画：亮度数字 + 色调字母（C 青 / B 蓝 / M 品红 / W 白 / G 绿 / Y 黄 / R 红 / . 暗） */
    colorAscii(cols = 96, rows = 32) {
      if (!renderer || !composer) return 'no renderer';
      composer.render();
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let out = '';
      for (let ry = 0; ry < rows; ry++) {
        let line = '';
        for (let cx = 0; cx < cols; cx++) {
          const x0 = Math.floor((cx * W) / cols);
          const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / cols));
          const yy0 = Math.floor(((rows - 1 - ry) * H) / rows);
          const yy1 = Math.max(yy0 + 1, Math.floor(((rows - ry) * H) / rows));
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let y = yy0; y < yy1; y += 4) {
            for (let x = x0; x < x1; x += 4) {
              const i = (y * W + x) * 4;
              r += px[i];
              g += px[i + 1];
              b += px[i + 2];
              n++;
            }
          }
          r /= n * 255;
          g /= n * 255;
          b /= n * 255;
          const lum = 0.35 * r + 0.5 * g + 0.15 * b;
          if (lum < 0.045) {
            line += ' .';
            continue;
          }
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx > 0 ? (mx - mn) / mx : 0;
          let hue = 'W';
          if (sat > 0.16) {
            if (mx === g) hue = b > r * 1.25 ? 'C' : 'G';
            else if (mx === b) hue = r > g * 1.15 ? 'M' : 'B';
            else hue = g > b * 1.25 ? 'Y' : 'R';
          }
          line += String(Math.min(9, Math.round(lum * 9))) + hue;
        }
        out += line + '\n';
      }
      return out;
    },
    /** 卫星位置半径直方图（用于校验坐标换算） */
    radiusHistogram() {
      const p = this.satLayer ? this.satLayer.positions : null;
      if (!p) return null;
      const bins = { leo: 0, meo: 0, geo: 0, deep: 0, zero: 0 };
      for (let i = 0; i < p.length / 3; i++) {
        const r = Math.sqrt(p[i * 3] ** 2 + p[i * 3 + 1] ** 2 + p[i * 3 + 2] ** 2);
        if (r < 1) bins.zero++;
        else if (r < 130) bins.leo++;
        else if (r < 300) bins.meo++;
        else if (r < 900) bins.geo++;
        else bins.deep++;
      }
      return bins;
    },
    /** 陆地遮罩贴图的白点比例（应为 20%~40%） */
    landStats() {
      const tex = globe && globe.uniforms && globe.uniforms.uLand ? globe.uniforms.uLand.value : null;
      if (!tex || !tex.image) return null;
      const img = tex.image;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let land = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) land++;
      return { w: img.width, h: img.height, landRatio: +((land / (img.width * img.height)) * 100).toFixed(1) };
    },
    /** 把当前帧读回并转成字符画，供无图像能力的自动化检查 */
    frameAscii(cols = 110, rows = 46) {
      if (!renderer || !composer) return 'no renderer';
      composer.render();
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ramp = ' .:-=+*#%@';
      let out = '';
      for (let ry = 0; ry < rows; ry++) {
        let line = '';
        for (let cx = 0; cx < cols; cx++) {
          const x0 = Math.floor((cx * W) / cols);
          const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * W) / cols));
          const yy0 = Math.floor(((rows - 1 - ry) * H) / rows);
          const yy1 = Math.max(yy0 + 1, Math.floor(((rows - ry) * H) / rows));
          let sum = 0;
          let n = 0;
          for (let y = yy0; y < yy1; y += 3) {
            for (let x = x0; x < x1; x += 3) {
              const i = (y * W + x) * 4;
              sum += (px[i] * 0.35 + px[i + 1] * 0.5 + px[i + 2] * 0.15) / 255;
              n++;
            }
          }
          const v = n ? sum / n : 0;
          line += ramp[Math.min(ramp.length - 1, Math.round(v * ramp.length * 1.7))];
        }
        out += line + '\n';
      }
      return out;
    },
  };
}

/** 静态部署（Cloudflare Pages 等）时的数据回退：public/data/catalog.json.gz → catalog.json */
async function fetchStaticCatalog() {
  const urls = ['data/catalog.json.gz', 'data/catalog.json'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) continue;
      if (url.endsWith('.gz')) {
        if (typeof DecompressionStream === 'undefined') continue;
        const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
        const j = JSON.parse(text);
        if (j && Array.isArray(j.satellites)) return j;
        continue;
      }
      const j = await res.json();
      if (j && Array.isArray(j.satellites)) return j;
    } catch (err) { /* 试下一个 */ }
  }
  return null;
}

async function loadData(force) {
  if (force) ui.toast('正在刷新星历…');
  ui.setLoading({ visible: true, text: force ? '重新抓取最新星历…' : '获取全球卫星目录…', progress: 0.25 });
  let data = null;
  try {
    const res = await fetch('/api/catalog' + (force ? '?force=1' : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
    if (!data || !Array.isArray(data.satellites)) throw new Error('数据格式异常');
    ui.setError('');
  } catch (err) {
    console.warn('[data] /api/catalog 不可用，尝试静态数据', err && err.message);
    // 静态部署回退（Cloudflare Pages / 任何静态托管）
    data = await fetchStaticCatalog();
    if (data) {
      state.staticMode = true;
      const btn = document.getElementById('btn-refresh');
      if (btn) { btn.disabled = true; btn.title = '静态部署模式：数据随构建更新'; }
      ui.toast('静态数据模式（构建快照）');
      ui.setError('');
    } else {
      console.error('[data] 目录加载失败', err);
      ui.setError('数据服务不可用：' + (err && err.message ? err.message : '未知错误') + '（本地请确认 node server.mjs 已启动；静态部署请先运行 npm run build:data）');
      ui.setLoading({ visible: false });
      if (!state.catalog) return;
    }
  }
  if (data) applyCatalog(data);
}

function applyCatalog(data) {
  state.catalog = data;
  state.sats = data.satellites;
  state.countries = data.countries || [];
  state.subcategories = data.subcategories || [];
  state.countryMap = new Map();
  state.countryColor = new Map();

  const total = state.sats.length;
  state.hidden = new Uint8Array(total);

  const ranked = [...state.countries].sort((a, b) => b.count - a.count);
  ranked.forEach((c, i) => {
    state.countryMap.set(c.code, c);
    state.countryColor.set(c.code, c.kind === 'other' ? '#6b8ea3' : COUNTRY_PALETTE[i % COUNTRY_PALETTE.length]);
  });
  // 未在 countries 里的代码兜底
  for (const s of state.sats) {
    if (!state.countryMap.has(s.country)) {
      state.countryMap.set(s.country, { code: s.country, name: s.country, nameEn: s.country, flag: '🛰️', kind: 'other', count: 0 });
      state.countryColor.set(s.country, '#6b8ea3');
    }
  }

  // 重建卫星层
  if (satLayer) {
    scene.remove(satLayer.points);
    satLayer.geometry.dispose();
    satLayer.material.dispose();
  }
  satLayer = createSatLayer({ count: total, pixelRatio: renderer.getPixelRatio() });
  scene.add(satLayer.points);

  buildColors();
  buildSizes();
  buildTelescopeMarkers();
  buildAxisAndSun();
  buildOrbitGroup();

  // worker
  if (worker) worker.terminate();
  startWorker();

  state.selection = -1;
  clearSelectionVisual();
  applyFilters();

  // 恢复上一次的观测点
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OBSERVER_KEY) || 'null'); } catch (err) { saved = null; }
  if (saved && isFinite(saved.lat) && isFinite(saved.lon)) setObserver(saved);

  // URL 参数优先级最高（分享链接可复现视图）
  const urlState = readUrlState();
  if (Object.keys(urlState).length) applyUrlState(urlState);
  syncFilterUi();

  // 走磁盘缓存时用 sourceDetail 体现真实来源（如 spacetrack / celestrak），避免一直显示 CACHE
  const detail = data.sourceDetail || (data.health && data.health.sourceDetail) || null;
  const src = data.source === 'cache' && detail ? detail : (data.source || 'service');
  ui.setDataStatus({ source: src, updated: data.updated || Date.now(), count: total });
  ui.updateStats(buildStats());
}

function buildColors() {
  const mode = state.colorMode;
  const colors = satLayer.colors;
  for (let i = 0; i < state.sats.length; i++) {
    const s = state.sats[i];
    let hex;
    if (mode === 'orbit') hex = ORBIT_COLORS[s.orbitClass] || ORBIT_COLORS.OTHER;
    else if (mode === 'category') hex = CATEGORY_COLORS[categoryKeyOf(s)] || CATEGORY_COLORS.other;
    else if (mode === 'kind') hex = KIND_COLORS[kindOf(s)] || KIND_COLORS.UNK;
    else hex = state.countryColor.get(s.country) || '#6b8ea3';
    const rgb = hexToRgb(hex);
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  satLayer.commitColors();
}

function buildSizes() {
  if (!satLayer) return;
  const sizes = satLayer.sizes;
  for (let i = 0; i < state.sats.length; i++) sizes[i] = baseSizeFor(state.sats[i]);
  satLayer.commitSizes();
}

function startWorker() {
  worker = new Worker(new URL('./propagate.worker.js?v=19', import.meta.url), { type: 'module' });
  lastWorkerMsgAt = performance.now();
  worker.onmessage = (e) => {
    const msg = e.data || {};
    lastWorkerMsgAt = performance.now();
    if (msg.type === 'positions') {
      lastPositions = msg.buf;
      satLayer.setPositionBuffer(msg.buf);
      updateTelescopeMarkers(msg.buf);
      if (state.selection >= 0) {
        const i = state.selection * 3;
        selectionMarker.place(msg.buf[i], msg.buf[i + 1], msg.buf[i + 2]);
      }
    } else if (msg.type === 'progress') {
      const p = 0.25 + (msg.done / Math.max(1, msg.total)) * 0.7;
      ui.setLoading({ visible: true, text: '解析轨道根数 ' + msg.done + ' / ' + msg.total, progress: p });
    } else if (msg.type === 'ready') {
      ui.setLoading({ visible: false });
      ui.toast('全息链路已建立 · ' + fmtNum(msg.total) + ' 颗卫星');
      scheduleBatchOrbits();
    } else if (msg.type === 'detail') {
      handleDetail(msg);
    } else if (msg.type === 'visibility') {
      state.visibility = msg.buf;
      state.visTime = msg.timeMs;
      if (state.observer) {
        buildVisibleNow();
        buildTelescopeStatus();
        if (state.focusVisibleOnly) applyVisibilityHighlight();
        orderDetailRefresh = true;
        if (!state.passesRequested && !state.passesPending) {
          state.passesRequested = true;
          requestPasses('list');
        }

      }
    } else if (msg.type === 'passes') {
      handlePasses(msg);
    } else if (msg.type === 'track') {
      handleTrack(msg);
    } else if (msg.type === 'batch') {
      handleBatch(msg);
    }
  };
  worker.onerror = (err) => {
    console.error('[worker] 错误', err);
    ui.setError('轨道推算线程异常：' + (err && err.message ? err.message : ''));
  };
  worker.postMessage({ type: 'init', sats: state.sats.map((s) => ({ id: s.id, tle1: s.tle1, tle2: s.tle2 })) });
  pushWorkerTime();
}

function readUrlState() {
  const p = new URLSearchParams(location.search);
  const out = {};
  if (p.has('lat') && p.has('lon')) {
    out.lat = Number(p.get('lat'));
    out.lon = Number(p.get('lon'));
    out.name = p.get('name');
  }
  if (p.has('cat')) out.cats = p.get('cat').split(',').filter(Boolean);
  if (p.has('country')) out.countries = p.get('country').split(',').filter(Boolean);
  if (p.has('q')) out.query = p.get('q');
  if (p.has('sat')) out.sat = Number(p.get('sat'));
  if (p.has('t')) out.offsetMin = Number(p.get('t'));
  if (p.has('quality')) out.quality = p.get('quality');
  if (p.get('telescope') === '1') out.telescopeOnly = true;
  if (p.get('debris') === '1') out.showDebris = true;
  if (p.get('reset') === '1') out.reset = true;
  return out;
}

function applyUrlState(u) {
  if (u.quality === 'high' || u.quality === 'medium' || u.quality === 'low') {
    applyQuality(u.quality);
    qualityLocked = true;
  }
  if (u.cats && u.cats.length) state.filters.categories = new Set(u.cats);
  if (u.countries && u.countries.length) state.filters.countries = new Set(u.countries);
  if (u.query) state.filters.query = u.query;
  // 兼容旧分享链接 ?telescope=1，映射到新的「望远镜」任务类别
  if (u.telescopeOnly) state.filters.categories = new Set(['telescope']);
  if (u.showDebris) state.filters.showDebris = true;
  if (u.reset) {
    state.filters.countries.clear();
    state.filters.orbits.clear();
    state.filters.categories.clear();
    state.filters.query = '';
    state.filters.showDebris = false;
  }
  if (isFinite(u.offsetMin) && u.offsetMin !== 0) handlers.onTimeSeek(u.offsetMin);
  if (isFinite(u.lat) && isFinite(u.lon)) {
    setObserver({
      lat: u.lat,
      lon: u.lon,
      altM: 0,
      label: u.name || ('自定义 ' + u.lat.toFixed(2) + ', ' + u.lon.toFixed(2)),
      source: 'url',
    });
  }
  applyFilters();
  if (u.query && typeof ui.setSearch === 'function') {
    ui.setSearch(state.filters.query);
  }
  if (isFinite(u.sat)) {
    const idx = state.sats.findIndex((s) => s.id === u.sat);
    if (idx >= 0) selectSat(idx);
  }
}

/** 把 URL / 初始筛选状态回填到左栏，避免“筛选生效但按钮不亮” */
function syncFilterUi() {
  if (!ui) return;
  if (state.filters.showDebris && typeof ui.setShowDebris === 'function') {
    ui.setShowDebris(true);
  }
}

function scheduleUrlSync() {
  if (urlSyncTimer) return;
  urlSyncTimer = setTimeout(() => {
    urlSyncTimer = null;
    syncUrl();
  }, 600);
}

function syncUrl() {
  const p = new URLSearchParams();
  const o = state.observer;
  if (o) {
    p.set('lat', o.lat.toFixed(4));
    p.set('lon', o.lon.toFixed(4));
    if (o.label) p.set('name', o.label);
  }
  if (state.filters.categories.size) p.set('cat', [...state.filters.categories].join(','));
  if (state.filters.countries.size) p.set('country', [...state.filters.countries].join(','));
  if (state.filters.query) p.set('q', state.filters.query);
  const off = Math.round((nowMs() - Date.now()) / 60000);
  if (Math.abs(off) >= 1) p.set('t', String(off));
  if (state.selection >= 0 && state.sats[state.selection]) p.set('sat', String(state.sats[state.selection].id));
  if (state.quality !== 'high' && qualityLocked) p.set('quality', state.quality);
  if (state.filters.showDebris) p.set('debris', '1');
  const qs = p.toString();
  try {
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  } catch (err) { /* file:// 下可能失败，忽略 */ }
}

/** Worker 无响应时重建（保留 TLE / 时间 / 观测点 / 选中状态） */
function restartWorker() {
  if (!state.sats.length) return;
  if (worker) {
    try { worker.terminate(); } catch (err) { /* ignore */ }
    worker = null;
  }
  state.visibility = null;
  startWorker();
  if (state.observer) {
    worker.postMessage({ type: 'observer', observer: { lat: state.observer.lat, lon: state.observer.lon, altM: state.observer.altM } });
    state.passesRequested = false;
  }
}

// ---------- 筛选 ----------
/**
 * 展示用任务类别：望远镜、空间站从「科学」中独立出来。
 * 碎片保持原类目，避免被 isTelescope 误判影响。
 */
function categoryKeyOf(sat) {
  if (!sat) return 'other';
  if (sat.category === 'debris') return 'debris';
  if (sat.isTelescope) return 'telescope';
  if (sat.isStation) return 'station';
  return sat.category || 'other';
}

/** 碎片是否要显示（默认关闭；点「碎片」类目或设置里打开时显示） */
function wantDebris(f) {
  return !!(f.showDebris || f.categories.has('debris'));
}

/** 单颗目标是否满足当前过滤；skip 指定「不参与本次判断」的维度，用于联动计数 */
function passesFilters(s, f, q, skip) {
  if (skip !== 'country' && f.countries.size && !f.countries.has(s.country)) return false;
  if (skip !== 'orbit' && f.orbits.size && !f.orbits.has(s.orbitClass)) return false;
  if (skip !== 'category' && skip !== 'categoryanddebris' &&
    f.categories.size && !f.categories.has(categoryKeyOf(s))) return false;
  if (skip !== 'debris' && skip !== 'categoryanddebris' && !wantDebris(f) && s.category === 'debris') return false;
  if (skip !== 'sub' && f.subcategories.size && !f.subcategories.has(s.subcategory)) return false;
  if (q && !matchQuery(s, q)) return false;
  return true;
}

function applyFilters() {
  const f = state.filters;
  const q = (f.query || '').trim().toUpperCase();
  let visible = 0;
  for (let i = 0; i < state.sats.length; i++) {
    const s = state.sats[i];
    const ok = passesFilters(s, f, q, null);
    state.hidden[i] = ok ? 0 : 1;
    if (ok) visible++;
  }
  state.visibleCount = visible;
  // 用户主动筛选后自动取景（结果集较小的时候才拉远，避免全量时乱跳）
  if (state.fitPending && settings.autoFit !== false) {
    state.fitPending = false;
    if (visible > 0 && visible <= 3000) setTimeout(fitToVisibleSetSafe, 420);
  }
  if (satLayer) {
    satLayer.hidden.set(state.hidden);
    satLayer.commitHidden();
    const total = Math.max(1, state.sats.length);
    const scale = visible <= 300 ? 1.85 : visible <= 1500 ? 1.5 : visible <= 5000 ? 1.2 : 1.0;
    satLayer.setScale(scale);
    // 点大小随可见数量自适应：全量时收一点避免糊成一片，筛选后就放大，一眼看得清
    const minSize = visible <= 200 ? 7.0 : visible <= 800 ? 6.0 : visible <= 3000 ? 5.0 : visible <= 12000 ? 4.0 : 3.2;
    satLayer.setMinSize(minSize);
  }
  syncTelescopeVisibility();
  const stats = buildStats();
  ui.updateStats(stats);
  scheduleUrlSync();
  ui.updateOrbits(buildOrbitStats());
  if (typeof ui.updateCategories === 'function') ui.updateCategories(buildCategoryStats());
  if (typeof ui.updateObjectKinds === 'function') ui.updateObjectKinds(buildKindStats());
  ui.updateCountries(buildCountryList(), !f.countries.size);
  if (typeof ui.updateSubcategories === 'function') ui.updateSubcategories(buildSubcategoryStats());
  // 无论从哪个入口改的碎片开关，都同步回 UI（避免 chip 还显示「隐藏」但数据已含碎片）
  if (typeof ui.setShowDebris === 'function') ui.setShowDebris(f.showDebris);
  scheduleBatchOrbits();
}

// 常用别名（CelesTrak 官方名与大众叫法差异较大，如 Chandra→CXO、Fermi→FGRST）
const SEARCH_ALIASES = {
  CHANDRA: ['CXO'],
  钱德拉: ['CXO'],
  FERMI: ['FGRST'],
  费米: ['FGRST'],
  HUBBLE: ['HST'],
  哈勃: ['HST'],
  悟空: ['DAMPE'],
  慧眼: ['HXMT'],
  天关: ['EINSTEIN PROBE'],
  爱因斯坦探针: ['EINSTEIN PROBE'],
  夸父: ['ASO-S'],
  韦伯: ['JWST'],
  天和: ['TIANHE', 'CSS (TIANHE)'],
  天宫: ['CSS (TIANHE)', 'TIANHE'],
  问天: ['WENTIAN'],
  梦天: ['MENGTIAN'],
  神舟: ['SHENZHOU', 'SZ-'],
  天舟: ['TIANZHOU'],
  国际空间站: ['ISS '],
  空间站实验室: ['CSS', 'ISS'],
  北斗: ['BEIDOU', 'BDS'],
  北斗导航: ['BEIDOU'],
  格洛纳斯: ['GLONASS'],
  伽利略: ['GALILEO'],
  星链: ['STARLINK'],
  一网: ['ONEWEB'],
  千帆: ['QIANFAN'],
  开普勒: ['KUIPER'],
  铱星: ['IRIDIUM'],
  全球星: ['GLOBALSTAR'],
};

function matchQuery(s, q) {
  if (s.isTelescope && /望远镜|TELESCOPE|天文/.test(q)) return true;
  const alias = SEARCH_ALIASES[q];
  if (alias) {
    const nm = (s.name || '').toUpperCase();
    if (alias.some((a) => nm.indexOf(a) >= 0)) return true;
  }
  if (String(s.id).indexOf(q) >= 0) return true;
  if ((s.name || '').toUpperCase().indexOf(q) >= 0) return true;
  const c = state.countryMap.get(s.country);
  if (c) {
    if ((c.name || '').indexOf(q) >= 0) return true;
    if ((c.nameEn || '').toUpperCase().indexOf(q) >= 0) return true;
    if ((c.code || '').toUpperCase() === q) return true;
  }
  if ((s.intl || '').toUpperCase().indexOf(q) >= 0) return true;
  if ((s.operator || '').toUpperCase().indexOf(q) >= 0) return true;
  if ((s.operatorZh || '').indexOf(q) >= 0) return true;
  if ((s.categoryLabel || '').indexOf(q) >= 0) return true;
  if ((s.subcategoryLabel || '').indexOf(q) >= 0) return true;
  if ((s.subcategoryLabelEn || '').toUpperCase().indexOf(q) >= 0) return true;
  return false;
}

function buildStats() {
  const fc = facetCounts();
  const byOrbitCount = fc.orbits;
  const counts = fc.countries;
  let active = 0;
  for (const s of state.sats) if (s.status === '+' || s.status === 'P') active++;
  let filtered = 0;
  for (const [, v] of counts) filtered += v;
  const total = Math.max(1, filtered);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => {
      const c = state.countryMap.get(code) || { name: code, flag: '🛰️' };
      return {
        code,
        name: pickLang(c.name, c.nameEn || c.name),
        nameZh: c.name,
        nameEn: c.nameEn || c.name,
        flag: c.flag,
        count,
        pct: Math.round((count / total) * 1000) / 10,
        color: state.countryColor.get(code) || '#6b8ea3',
      };
    });
  return {
    total: state.sats.length,
    rendered: state.visibleCount,
    countryCount: counts.size,
    activeCount: active,
    byOrbit: ['LEO', 'MEO', 'GEO', 'HEO', 'OTHER'].map((k) => ({
      key: k,
      label: ORBIT_LABELS[k],
      labelZh: ORBIT_LABELS_ZH[k],
      count: byOrbitCount[k] || 0,
      color: ORBIT_COLORS[k],
    })),
    topCountries: top,
    byCategory: buildCategoryStats(),
    byObjectKind: buildKindStats(),
  };
}

/** 统计入口：按当前过滤做「联动计数」（某维度统计时排除自身条件） */
function facetCounts() {
  const f = state.filters;
  const q = (f.query || '').trim().toUpperCase();
  const orbits = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, OTHER: 0 };
  const cats = new Map();
  const kinds = new Map();
  const countries = new Map();
  for (const s of state.sats) {
    const okAll = passesFilters(s, f, q, null);
    if (passesFilters(s, f, q, 'orbit')) orbits[s.orbitClass] = (orbits[s.orbitClass] || 0) + 1;
    // 分类计数时同时忽略「分类」与「碎片默认隐藏」，让碎片 chip 始终显示真实数量
    if (passesFilters(s, f, q, 'categoryanddebris')) {
      const key = categoryKeyOf(s);
      cats.set(key, (cats.get(key) || 0) + 1);
    }
    if (passesFilters(s, f, q, 'country')) countries.set(s.country, (countries.get(s.country) || 0) + 1);
    if (okAll) kinds.set(kindOf(s), (kinds.get(kindOf(s)) || 0) + 1);
  }
  return { orbits, cats, kinds, countries, visible: state.visibleCount };
}

/** 当前单选大类下的二级分类（含联动计数与选中态） */
function buildSubcategoryStats() {
  const f = state.filters;
  if (f.categories.size !== 1) return [];
  const cat = [...f.categories][0];
  const list = (state.subcategories || []).filter((x) => x.category === cat);
  if (!list.length) return [];
  const q = (f.query || '').trim().toUpperCase();
  const counts = new Map();
  for (const s of state.sats) {
    if ((s.category || 'other') !== cat) continue;
    if (!passesFilters(s, f, q, 'sub')) continue;
    const k = s.subcategory || 'unknown';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return list
    .map((x) => ({
      key: x.key,
      label: pickLang(x.label, x.labelEn),
      labelZh: x.label,
      labelEn: x.labelEn,
      category: x.category,
      count: counts.get(x.key) || 0,
      active: f.subcategories.has(x.key),
    }))
    .filter((x) => x.count > 0 || x.active)
    .sort((a, b) => b.count - a.count);
}

function buildOrbitStats() {
  const counts = facetCounts().orbits;
  return ['LEO', 'MEO', 'GEO', 'HEO', 'OTHER'].map((k) => ({
    key: k,
    label: pickLang(ORBIT_LABELS_ZH[k], ORBIT_LABELS_EN[k]),
    labelZh: ORBIT_LABELS_ZH[k],
    labelEn: ORBIT_LABELS_EN[k],
    count: counts[k] || 0,
    active: !state.filters.orbits.size || state.filters.orbits.has(k),
    color: ORBIT_COLORS[k],
  }));
}

function buildCategoryStats() {
  const counts = facetCounts().cats;
  let total = 0;
  for (const [, v] of counts) total += v;
  total = Math.max(1, total);
  const debrisOn = wantDebris(state.filters);
  return CATEGORY_ORDER.map((k) => {
    const n = counts.get(k) || 0;
    const isDebris = k === 'debris';
    const showCount = !isDebris || debrisOn;
    return {
      key: k,
      label: pickLang(CATEGORY_LABELS[k], CATEGORY_LABELS_EN[k]),
      labelZh: CATEGORY_LABELS[k],
      labelEn: CATEGORY_LABELS_EN[k],
      count: showCount ? n : null,
      total: isDebris ? n : undefined,
      hint: isDebris && !debrisOn
        ? '默认隐藏 · 共 ' + fmtNum(n) + ' 个，点开显示'
        : undefined,
      pct: Math.round((n / total) * 1000) / 10,
      active: !state.filters.categories.size || state.filters.categories.has(k),
      color: CATEGORY_COLORS[k],
    };
  });
}

function buildKindStats() {
  const counts = facetCounts().kinds;
  let total = 0;
  for (const [, v] of counts) total += v;
  total = Math.max(1, total);
  return KIND_ORDER.map((k) => ({
    key: k,
    label: pickLang(KIND_LABELS[k], KIND_LABELS_EN[k]),
    labelZh: KIND_LABELS[k],
    labelEn: KIND_LABELS_EN[k],
    count: counts.get(k) || 0,
    pct: Math.round(((counts.get(k) || 0) / total) * 1000) / 10,
    color: KIND_COLORS[k],
  }));
}

function buildCountryList() {
  const counts = facetCounts().countries;
  const list = [];
  for (const [code, count] of counts) {
    const c = state.countryMap.get(code) || { name: code, flag: '🛰️', kind: 'other' };
    list.push({
      code,
      name: pickLang(c.name, c.nameEn || c.name),
      nameZh: c.name,
      nameEn: c.nameEn || c.name,
      flag: c.flag,
      count,
      color: state.countryColor.get(code) || '#6b8ea3',
      kind: c.kind || 'country',
      active: !state.filters.countries.size || state.filters.countries.has(code),
    });
  }
  list.sort((a, b) => b.count - a.count);
  return list;
}

// ---------- 选中与详情 ----------
function selectSat(index, anchor) {
  if (index === state.selection) {
    clearSelection();
    return;
  }
  state.selection = index;
  if (index < 0) {
    clearSelectionVisual();
    ui.setSelection(null, null);
    return;
  }
  const s = state.sats[index];
  const color = state.countryColor.get(s.country) || '#5ef0ff';
  selectionMarker.setColor(color);
  if (lastPositions) selectionMarker.place(lastPositions[index * 3], lastPositions[index * 3 + 1], lastPositions[index * 3 + 2]);
  if (!orbitGroup) buildOrbitGroup();
  if (!selOrbit) {
    selOrbit = createOrbitLine({ color, opacity: 0.85, maxPoints: 256 });
    orbitGroup.add(selOrbit.line);
  } else {
    selOrbit.setColor(color);
    selOrbit.setOpacity(0.85);
  }
  if (!selGround) {
    selGround = createOrbitLine({ color, opacity: 0.32, maxPoints: 200, closed: false });
    orbitGroup.add(selGround.line);
  } else {
    selGround.setColor(color);
  }
  selectedTrackIndex = -1;
  requestTrack(true);
  requestDetail();
  ui.setSelection(makeDetailShell(s), anchor || null);
  ui.toast('已选中：' + (s.name || s.id));
  if (typeof ui.setFollowing === 'function') ui.setFollowing(state.follow);
  scheduleUrlSync();
  if (state.observer) setTimeout(() => requestPasses('single'), 80);
}

function clearSelection() {
  state.selection = -1;
  state.follow = false;
  if (typeof ui.setFollowing === 'function') ui.setFollowing(false);
  clearSelectionVisual();
  ui.setSelection(null);
  scheduleUrlSync();
}

function clearSelectionVisual() {
  if (selectionMarker) selectionMarker.hide();
  if (selOrbit) selOrbit.clear();
  if (selGround) selGround.clear();
  selectedTrackIndex = -1;
}

function makeDetailShell(s) {
  const c = state.countryMap.get(s.country) || { code: s.country, name: s.country, flag: '🛰️' };
  const catKey = categoryKeyOf(s);
  return {
    id: s.id,
    name: s.name,
    intl: s.intl || '--',
    country: { code: s.country, name: c.name, flag: c.flag || '🛰️', color: state.countryColor.get(s.country) || '#5ef0ff' },
    owner: s.owner || s.country,
    operator: {
      name: s.operator || s.owner || s.country || '--',
      nameZh: s.operatorZh || s.operator || s.owner || '--',
      kind: s.operatorKind || 'unknown',
    },
    category: {
      key: catKey,
      label: CATEGORY_LABELS[catKey] || '其他 / 未分类',
      labelEn: CATEGORY_LABELS_EN[catKey] || '',
      confidence: (s.isTelescope || s.isStation) ? 'high' : (s.categoryConfidence || 'low'),
      note: s.isTelescope ? '望远镜白名单'
        : s.isStation ? '空间站 / 载人目标' : (s.categoryNote || ''),
      color: CATEGORY_COLORS[catKey] || CATEGORY_COLORS.other,
    },
    objectType: s.objectType || 'PAY',
    status: s.status || '',
    statusText: STATUS_TEXT[s.status] || STATUS_TEXT[''],
    orbitClass: s.orbitClass,
    orbitLabel: ORBIT_LABELS_ZH[s.orbitClass] || s.orbitClass,
    objectKind: kindOf(s),
    objectKindLabel: KIND_LABELS[kindOf(s)] || '未知',
    rcs: typeof s.rcs === 'number' ? s.rcs : null,
    isTelescope: !!s.isTelescope,
    telescopeType: s.telescopeType || null,
    tleEpoch: s.tleEpoch || null,
    tleAgeHours: typeof s.tleAgeHours === 'number' ? s.tleAgeHours : null,
    isStation: !!s.isStation,
    stationType: s.stationType || null,
    stationLabel: s.stationType ? pickLang(STATION_LABELS[s.stationType], STATION_LABELS_EN[s.stationType]) : null,
    objectKindLabel: pickLang(KIND_LABELS[kindOf(s)], KIND_LABELS_EN[kindOf(s)]),
    gallery: galleryFor(s),
    telescopeLabel: s.telescopeType ? pickLang(TELESCOPE_LABELS[s.telescopeType], TELESCOPE_LABELS_EN[s.telescopeType]) : null,
    categoryLabel: pickLang(s.categoryLabel, s.categoryLabelEn),
    categoryLabelZh: s.categoryLabel,
    categoryLabelEn: s.categoryLabelEn,
    subcategory: s.subcategory || null,
    subcategoryLabel: pickLang(s.subcategoryLabel, s.subcategoryLabelEn),
    subcategoryLabelZh: s.subcategoryLabel || null,
    subcategoryLabelEn: s.subcategoryLabelEn || null,
    operatorZh: s.operatorZh || s.operator,
    operatorEn: s.operator,
    countryNameZh: (state.countryMap.get(s.country) || {}).name,
    countryNameEn: (state.countryMap.get(s.country) || {}).nameEn,
    nameZh: TELESCOPE_NAMES_ZH[s.name] || null,
    altKm: null,
    speedKms: null,
    periodMin: s.period,
    inclDeg: s.incl,
    apogeeKm: s.apogee,
    perigeeKm: s.perigee,
    lat: null,
    lon: null,
    launchDate: s.launchDate || '--',
    tle1: s.tle1,
    tle2: s.tle2,
    live: false,
  };
}

function handleDetail(msg) {
  if (state.selection !== msg.index) return;
  const s = state.sats[msg.index];
  if (!s) return;
  const d = makeDetailShell(s);
  if (msg.ok) {
    d.altKm = msg.altKm;
    d.speedKms = msg.speedKms;
    d.lat = msg.lat;
    d.lon = msg.lon;
    d.live = true;
  }
  ui.setSelection(d);
}

function requestDetail() {
  if (!worker || state.selection < 0) return;
  worker.postMessage({ type: 'detail', index: state.selection, timeMs: nowMs() });
}

function requestTrack(force) {
  if (!worker || state.selection < 0 || !state.layers.orbits) return;
  const t = performance.now();
  if (!force && t - lastTrackAt < 4000) return;
  lastTrackAt = t;
  worker.postMessage({ type: 'track', index: state.selection, samples: 220, groundSamples: 160 });
}

function handleTrack(msg) {
  if (!msg.ok || msg.index !== state.selection) return;
  selectedTrackIndex = msg.index;
  selOrbit.setPoints(msg.orbit);
  selGround.setPoints(msg.ground);
}

// ---------- 批量轨道 ----------
function buildOrbitGroup() {
  if (orbitGroup) {
    scene.remove(orbitGroup);
    clearBatchLines();
  }
  orbitGroup = new THREE.Group();
  orbitGroup.name = 'orbits';
  orbitGroup.visible = !!state.layers.orbits;
  scene.add(orbitGroup);
  batchLines = [];
  selOrbit = null;
  selGround = null;
}

function clearBatchLines() {
  for (const l of batchLines) {
    orbitGroup.remove(l.line);
    l.line.geometry.dispose();
    l.material.dispose();
  }
  batchLines = [];
}

let batchTimer = null;
function scheduleBatchOrbits() {
  clearTimeout(batchTimer);
  batchTimer = setTimeout(() => {
    if (!orbitGroup || !state.layers.orbits || !worker) return;
    clearBatchLines();
    const idxs = [];
    for (let i = 0; i < state.sats.length; i++) if (state.hidden[i] === 0) idxs.push(i);
    if (idxs.length === 0 || idxs.length > 400) return;
    worker.postMessage({ type: 'batch', indices: idxs, samples: 90 });
  }, 280);
}

function handleBatch(msg) {
  if (!orbitGroup || !state.layers.orbits) return;
  clearBatchLines();
  for (const item of msg.items) {
    if (item.index === state.selection) continue;
    const hex = state.colorMode === 'orbit' ? ORBIT_COLORS[state.sats[item.index].orbitClass] : state.countryColor.get(state.sats[item.index].country);
    const l = createOrbitLine({ color: hex || '#3fd8ff', opacity: 0.16, maxPoints: 100 });
    l.setPoints(item.pts);
    orbitGroup.add(l.line);
    batchLines.push(l);
  }
}

// ---------- 观测点与过境推荐 ----------
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function geoToWorld(latDeg, lonDeg, r = WORLD_R) {
  const lat = latDeg * RAD;
  const lon = lonDeg * RAD;
  return new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

function kindOf(sat) {
  const k = sat && sat.objectKind;
  if (k === 'R/B' || k === 'R-B' || k === 'RKB') return 'R-B';
  if (k === 'DEB' || k === 'DEBRIS') return 'DEB';
  if (k === 'PAY') return 'PAY';
  return 'UNK';
}

/** 地轴线（南北极）+ 极点标记 + 太阳直射点标记 */
function buildAxisAndSun() {
  if (axisGroup) {
    scene.remove(axisGroup);
    axisGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  const g = new THREE.Group();
  g.name = 'axis';
  const R = WORLD_R;
  // 地轴：略微穿出球体
  const axisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -R * 1.32, 0),
    new THREE.Vector3(0, R * 1.32, 0),
  ]);
  const axisLine = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({
    color: 0xffd166, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  g.add(axisLine);
  // 南北极小球
  for (const sign of [1, -1]) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 12),
      new THREE.MeshBasicMaterial({ color: sign > 0 ? 0xffd166 : 0x7dd3fc, transparent: true, opacity: 0.9 }),
    );
    dot.position.set(0, sign * R * 1.02, 0);
    g.add(dot);
  }
  // 太阳直射点：暖白光点
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.35, 'rgba(255,214,120,0.6)');
  grad.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sunMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xffe9a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95,
  }));
  sunMarker.scale.setScalar(16);
  g.add(sunMarker);
  axisGroup = g;
  if (state.layers.axis !== false) scene.add(g);
}

/** 把太阳方向换成地球表面的直射点（世界坐标），顺带更新太阳赤纬 */
function placeSunMarker() {
  if (!sunMarker) return;
  const R = WORLD_R * 1.015;
  sunMarker.position.set(sunVec.x * R, sunVec.z * R, -sunVec.y * R);
  const lat = Math.asin(Math.max(-1, Math.min(1, sunVec.z))) * (180 / Math.PI);
  state.subsolarLat = lat;
  const el = document.getElementById('subsolar');
  if (el) {
    const txt = '☀ 直射 ' + Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S');
    if (el.textContent !== txt) el.textContent = txt;
  }
}

/** 太阳方向（ECEF 单位向量）：低精度太阳历 + GMST 旋转，误差 < 0.02° */
const sunVec = { x: 1, y: 0, z: 0 };
function updateSunDir(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const x = Math.cos(lambda);
  const y = Math.cos(eps) * Math.sin(lambda);
  const z = Math.sin(eps) * Math.sin(lambda);
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  gmst = ((gmst % 360) + 360) % 360;
  const gr = gmst * (Math.PI / 180);
  const cg = Math.cos(gr);
  const sg = Math.sin(gr);
  sunVec.x = x * cg + y * sg;
  sunVec.y = -x * sg + y * cg;
  sunVec.z = z;
  if (globe && typeof globe.setSunDir === 'function') globe.setSunDir(sunVec);
}

function isStation(sat) {
  const n = (sat && sat.name ? sat.name : '').toUpperCase();
  return /^ISS |TIANHE|CSS \(|TIANGONG|ZARYA/.test(n);
}

function baseSizeFor(sat) {
  const kind = kindOf(sat);
  let s;
  if (kind === 'DEB') s = 1.1;
  else if (kind === 'R-B') s = 1.45;
  else {
    const cls = sat.orbitClass;
    s = cls === 'GEO' ? 2.9 : cls === 'HEO' ? 2.5 : cls === 'MEO' ? 2.3 : cls === 'LEO' ? 1.9 : 1.7;
  }
  if (isStation(sat)) s = 4.6;
  if (sat && sat.isTelescope) s += 1.0;
  return s;
}

function restoreSizes() {
  if (!satLayer) return;
  for (let i = 0; i < state.sats.length; i++) satLayer.sizes[i] = baseSizeFor(state.sats[i]);
  satLayer.commitSizes();
}

function applyVisibilityHighlight() {
  if (!satLayer || !state.visibility || !state.focusVisibleOnly) {
    restoreSizes();
    return;
  }
  const v = state.visibility;
  for (let i = 0; i < state.sats.length; i++) {
    const el = v[i * 4];
    const sunlit = v[i * 4 + 3] > 0.5;
    const vis = el > 10 && sunlit;
    satLayer.sizes[i] = baseSizeFor(state.sats[i]) * (vis ? 2.5 : 0.65);
  }
  satLayer.commitSizes();
}

function estimateMag(sat, rangeKm) {
  const n = (sat && sat.name ? sat.name : '').toUpperCase();
  const r = Math.max(1, rangeKm || 1000);
  // 有 RCS 时用面积模型：m = 6.5 - 2.5·log10(RCS) + 5·log10(距离/1000km)
  const rcs = sat && typeof sat.rcs === 'number' && sat.rcs > 0 ? sat.rcs : null;
  if (rcs) {
    const mag = 6.5 - 2.5 * Math.log10(rcs) + 5 * Math.log10(r / 1000);
    return +Math.max(-4, Math.min(15, mag)).toFixed(1);
  }
  let base = 6.5;
  if (/^ISS |TIANHE|CSS \(|TIANGONG|ZARYA/.test(n)) base = -1.6;
  else if (n.indexOf('STARLINK') === 0) base = 5.2;
  else if (n.indexOf('ONEWEB') === 0) base = 6.0;
  else if (n.indexOf('KUIPER') === 0) base = 6.2;
  else if (sat.orbitClass === 'GEO') base = 8.0;
  else if (sat.category === 'comms') base = 7.0;
  else if (sat.category === 'eo') base = 6.0;
  return +(base + 5 * Math.log10(r / 1000)).toFixed(1);
}

function azText(az) {
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

function tierOf(mag) {
  if (mag <= 4.5) return 'naked';
  if (mag <= 7.0) return 'binocular';
  return 'telescope';
}

function tierLabel(t) {
  return t === 'naked' ? '肉眼可见' : t === 'binocular' ? '双筒可见' : '望远镜跟踪';
}

/** 观测点当地太阳高度角（度），用于判断是否适合光学观测 */
function sunElevationAtObserver() {
  const o = state.observer;
  if (!o) return null;
  const d = new Date(nowMs());
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start) / 86400000);
  const decl = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365) * RAD;
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const solarH = utcH + o.lon / 15;
  const H = (solarH - 12) * 15 * RAD;
  const lat = o.lat * RAD;
  const s = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

function skyStateText(sunEl) {
  if (sunEl == null) return '';
  if (sunEl > 0) return '当地白天（天空较亮，肉眼观测受限）';
  if (sunEl > -6) return '当地暮光（适合看亮目标）';
  if (sunEl > -18) return '当地天文暮光';
  return '当地夜空（最佳观测）';
}

function setObserver(obs) {
  if (obs) {
    state.observer = {
      lat: +obs.lat.toFixed(4),
      lon: +obs.lon.toFixed(4),
      altM: obs.altM || 0,
      label: obs.label || (obs.lat.toFixed(2) + ', ' + obs.lon.toFixed(2)),
      source: obs.source || 'manual',
    };
  } else {
    state.observer = null;
    state.visibility = null;
    state.visibleNow = [];
    state.passes = [];
    state.passesByIndex = new Map();
  }

  if (worker) worker.postMessage({ type: 'observer', observer: state.observer ? { lat: state.observer.lat, lon: state.observer.lon, altM: state.observer.altM } : null });
  if (typeof ui.setObserver === 'function') ui.setObserver(state.observer);
  if (typeof ui.setObserving === 'function') ui.setObserving(!!state.observer);
  if (typeof ui.updateVisibleNow === 'function') ui.updateVisibleNow(state.observer ? state.visibleNow : []);
  if (typeof ui.updatePasses === 'function') ui.updatePasses(state.observer ? state.passes : []);
  if (typeof ui.setPassDetail === 'function') ui.setPassDetail(null);

  updateObserverVisuals();
  scheduleUrlSync();

  try {
    if (state.observer) localStorage.setItem(OBSERVER_KEY, JSON.stringify(state.observer));
    else localStorage.removeItem(OBSERVER_KEY);
  } catch (err) { /* 忽略隐私模式写入失败 */ }

  if (state.observer) {
    const sunEl = sunElevationAtObserver();
    const sky = skyStateText(sunEl);
    ui.toast('观测点：' + state.observer.label + ' · ' + sky);
    state.passesAt = 0;
    state.passesRequested = false;
    state.passes = [];
    state.telescopeWindows = new Map();
    state.telescopeRequested = false;
    buildTelescopeStatus();
  } else {
    ui.toast('已清除观测点');
  }
}

function updateObserverVisuals() {
  if (!observerMarker || !horizonRing) return;
  const o = state.observer;
  if (!o) {
    observerMarker.hide();
    horizonRing.clear();
    return;
  }
  const pos = geoToWorld(o.lat, o.lon, WORLD_R * 1.004);
  observerMarker.setColor(0xffd166);
  observerMarker.place(pos.x, pos.y, pos.z);
  // 以观测点为中心、约 1200km 半径的本地地平圈
  const d = 1200 / 6371;
  const pts = new Float32Array(96 * 3);
  for (let k = 0; k < 96; k++) {
    const brg = (k / 96) * Math.PI * 2;
    const lat1 = o.lat * RAD;
    const lon1 = o.lon * RAD;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    const v = geoToWorld(lat2 * DEG, lon2 * DEG, WORLD_R * 1.006);
    pts[k * 3] = v.x;
    pts[k * 3 + 1] = v.y;
    pts[k * 3 + 2] = v.z;
  }
  horizonRing.setPoints(pts);
  horizonRing.setColor(0xffd166);
  horizonRing.setOpacity(0.42);
}

/** 按望远镜取名下的观测图（本地图片，带出处） */
function galleryFor(sat) {
  if (!sat || !sat.isTelescope || !astroManifest) return [];
  const slugs = ASTRO_GALLERY[sat.name] || ASTRO_BY_TYPE[sat.telescopeType] || [];
  const out = [];
  for (const slug of slugs) {
    const m = astroManifest[slug];
    if (!m) continue;
    out.push({
      slug,
      src: 'img/astro/' + m.file,
      title: m.titleZh || m.titleEn || slug,
      titleEn: m.titleEn || '',
      desc: m.descZh || '',
      credit: m.creditZh || m.credit || 'NASA',
      creditFull: m.credit || 'NASA',
      page: m.page || '',
      date: m.date || '',
    });
  }
  return out;
}

async function loadAstroManifest() {
  try {
    const res = await fetch('img/astro/manifest.json');
    if (!res.ok) return;
    astroManifest = await res.json();
  } catch (err) {
    astroManifest = null;
  }
}

/** 全库搜索（名称/NORAD/公司/国家/类型/中文语义），返回最多 12 条 */
function searchSatellites(text) {
  const q = String(text || '').trim().toUpperCase();
  if (!q) return [];
  const semantic = {
    空间站: (s) => !!s.isStation,
    载人: (s) => s.stationType === 'crew' || s.stationType === 'station',
    飞船: (s) => s.stationType === 'crew' || s.stationType === 'cargo',
    望远镜: (s) => !!s.isTelescope,
    天文: (s) => !!s.isTelescope,
    碎片: (s) => s.category === 'debris',
    残骸: (s) => s.category === 'debris',
    军事: (s) => s.category === 'mil',
    侦察: (s) => s.category === 'mil',
    导航: (s) => s.category === 'nav',
    气象: (s) => s.category === 'weather',
    通信: (s) => s.category === 'comms',
    遥感: (s) => s.category === 'eo',
  };
  const hits = [];
  for (let i = 0; i < state.sats.length; i++) {
    const s = state.sats[i];
    const nm = (s.name || '').toUpperCase();
    let score = 0;
    if (String(s.id) === q) score = 98;
    else if (nm === q) score = 100;
    else if (nm.indexOf(q) === 0) score = 90;
    else if (nm.indexOf(q) >= 0) score = 70;
    else if (String(s.id).indexOf(q) === 0) score = 60;
    else if ((s.operator || '').toUpperCase().indexOf(q) >= 0 || (s.operatorZh || '').indexOf(q) >= 0) score = 46;
    else if ((s.categoryLabel || '').indexOf(q) >= 0 || (s.subcategoryLabel || '').indexOf(q) >= 0) score = 40;
    else if (((state.countryMap.get(s.country) || {}).name || '').indexOf(q) >= 0) score = 38;
    else {
      const alias = SEARCH_ALIASES[q];
      if (alias && alias.some((a) => nm.indexOf(a) >= 0)) score = 66;
    }
    if (!score && semantic[q] && semantic[q](s)) score = 50;
    if (score) hits.push({ i, score });
  }
  hits.sort((a, b) => b.score - a.score || String(state.sats[a.i].name).localeCompare(String(state.sats[b.i].name)));
  return hits.slice(0, 12).map(({ i }) => {
    const s = state.sats[i];
    const c = state.countryMap.get(s.country) || {};
    return {
      index: i,
      name: s.name,
      id: s.id,
      operator: s.operatorZh || s.operator || '--',
      categoryLabel: CATEGORY_LABELS[categoryKeyOf(s)] || s.category || '--',
      orbitClass: s.orbitClass || '--',
      country: c.name || s.country || '--',
      isTelescope: !!s.isTelescope,
      isStation: !!s.isStation,
    };
  });
}

function buildVisibleNow() {
  const v = state.visibility;
  if (!v || !state.observer) return;
  const rows = [];
  for (let i = 0; i < state.sats.length; i++) {
    const el = v[i * 4];
    if (!(el > 10)) continue;
    if (v[i * 4 + 3] < 0.5) continue;
    const sat = state.sats[i];
    const range = v[i * 4 + 2];
    const mag = estimateMag(sat, range);
    let score = el + (isStation(sat) ? 30 : 0) + (mag <= 4.5 ? 20 : mag <= 7 ? 8 : 0) + (range < 1200 ? 6 : 0);
    rows.push({
      index: i,
      name: sat.name,
      country: (state.countryMap.get(sat.country) || {}).name || sat.country,
      flag: (state.countryMap.get(sat.country) || {}).flag || '🛰️',
      color: state.countryColor.get(sat.country) || '#5ef0ff',
      el: +el.toFixed(1),
      az: +v[i * 4 + 1].toFixed(0),
      azText: azText(v[i * 4 + 1]),
      rangeKm: Math.round(range),
      mag,
      tier: tierOf(mag),
      sunlit: true,
      score,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  state.visibleNow = rows.slice(0, 12);
  if (typeof ui.updateVisibleNow === 'function') ui.updateVisibleNow(state.visibleNow);
}

function requestPasses(kind) {
  if (!state.observer || !worker || state.passesPending) return;
  const set = new Set();
  if (kind === 'single' && state.selection >= 0) {
    set.add(state.selection);
  } else {
    // 当前可见 + 空间站 + 均匀抽样，兼顾"现在能看"与"待会儿能看"
    for (const r of state.visibleNow.slice(0, 8)) set.add(r.index);
    for (let i = 0; i < state.sats.length; i++) if (isStation(state.sats[i])) set.add(i);
    const step = Math.max(60, Math.floor(state.sats.length / 64));
    for (let i = 0; i < state.sats.length && set.size < 72; i += step) set.add(i);
    if (state.selection >= 0) set.add(state.selection);
  }
  const indices = [...set].slice(0, 80);
  if (!indices.length) return;
  state.passesPending = true;
  worker.postMessage({ type: 'passes', indices, fromMs: nowMs(), hours: 6, minEl: 10, kind, requestId: ++passReqId });
  state.passesAt = performance.now();
}

let passReqId = 0;

/** 望远镜可观测性：now / shadow / below，并附下次可观测时间 */
function buildTelescopeStatus() {
  if (!state.observer) {
    state.telescopeStatus = [];
    if (typeof ui.updateTelescopeStatus === 'function') ui.updateTelescopeStatus([]);
    return;
  }
  const v = state.visibility;
  const rows = [];
  for (const i of state.telescopeIndices) {
    const sat = state.sats[i];
    if (!sat) continue;
    let el = null;
    let az = null;
    let sunlit = false;
    if (v) {
      el = v[i * 4];
      az = v[i * 4 + 1];
      sunlit = v[i * 4 + 3] > 0.5;
    }
    let status = 'unknown';
    if (el != null) {
      if (el <= 0) status = 'below';
      else if (!sunlit) status = 'shadow';
      else status = 'now';
    }
    const win = state.telescopeWindows.get(i) || null;
    const next = win && win.length ? win[0] : null;
    rows.push({
      id: sat.id,
      index: i,
      name: sat.name,
      telescopeType: sat.telescopeType || null,
      typeLabel: TELESCOPE_LABELS[sat.telescopeType] || '未知',
      el: el == null ? null : +el.toFixed(0),
      az: az == null ? null : +az.toFixed(0),
      sunlit,
      observable: status === 'now',
      status,
      nextAt: next ? next.aos : null,
      nextEl: next ? next.maxEl : null,
      color: state.countryColor.get(sat.country) || '#ffd166',
    });
  }
  const rank = { now: 0, shadow: 1, below: 2, unknown: 3 };
  rows.sort((a, b) => {
    const ra = rank[a.status] - rank[b.status];
    if (ra !== 0) return ra;
    if (a.nextAt && b.nextAt) return a.nextAt - b.nextAt;
    if (a.nextAt) return -1;
    if (b.nextAt) return 1;
    return (b.el || -90) - (a.el || -90);
  });
  state.telescopeStatus = rows;
  if (typeof ui.updateTelescopeStatus === 'function') ui.updateTelescopeStatus(rows);
}

function requestTelescopeWindows() {
  if (!state.observer || !worker || !state.telescopeIndices.length) return;
  worker.postMessage({
    type: 'passes',
    indices: state.telescopeIndices.slice(0, 40),
    fromMs: nowMs(),
    hours: 12,
    minEl: 10,
    kind: 'telescope',
    requestId: ++passReqId,
  });
}

/** 通知：过境前 5 分钟提醒 */
function ensureNotifyPermission() {
  if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  try {
    return Promise.resolve(Notification.requestPermission()).catch(() => 'denied');
  } catch (err) {
    return Promise.resolve('denied');
  }
}

function fireReminder(index) {
  const sat = state.sats[index];
  if (!sat) return;
  const title = '卫星即将过境：' + sat.name;
  const body = state.observer ? '观测点 ' + state.observer.label + ' · 抬头看天空' : '准备观测';
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'om-' + index });
    }
  } catch (err) { /* 通知失败不影响主流程 */ }
  ui.toast('⏰ ' + title);
}

function scheduleReminder(index, at) {
  const prev = state.reminders.get(index);
  if (prev) clearTimeout(prev.timer);
  const delay = at - 5 * 60000 - Date.now();
  if (delay <= 0 || delay > 12 * 3600 * 1000) return false;
  const timer = setTimeout(() => {
    state.reminders.delete(index);
    fireReminder(index);
  }, delay);
  state.reminders.set(index, { at, timer });
  return true;
}

function remindFor(index) {
  const list = state.passesByIndex ? state.passesByIndex.get(index) : null;
  const next = list && list.length ? list[0] : null;
  if (!next) {
    requestPasses('single');
    ui.toast('正在计算该目标的过境，请 2 秒后再点一次提醒');
    return;
  }
  ensureNotifyPermission().then((perm) => {
    if (perm === 'denied') {
      ui.toast('浏览器已拒绝通知权限，可在地址栏左侧重新允许');
      return;
    }
    if (perm === 'unsupported') {
      ui.toast('当前浏览器不支持桌面通知');
      return;
    }
    const ok = scheduleReminder(index, next.aos);
    ui.toast(ok ? '⏰ 已设置提醒（过境前 5 分钟）' : '过境时间太近或太远，未设置提醒');
  });
}

function icsDate(ms) {
  const d = new Date(ms);
  return String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function exportIcs() {
  const rows = state.passes && state.passes.length ? state.passes : [];
  if (!rows.length) {
    ui.toast('当前没有可导出的过境，请先设置观测地点');
    return;
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OrbitalMirror//Satellite Passes//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const place = state.observer ? state.observer.label : '';
  for (const r of rows) {
    const end = r.startAt + Math.max(60, r.durationSec) * 1000;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:om-' + r.index + '-' + r.startAt + '@orbital-mirror');
    lines.push('DTSTAMP:' + icsDate(Date.now()));
    lines.push('DTSTART:' + icsDate(r.startAt));
    lines.push('DTEND:' + icsDate(end));
    lines.push('SUMMARY:卫星过境：' + r.name + (r.maxEl ? '（最高 ' + r.maxEl + '°）' : ''));
    lines.push('DESCRIPTION:最高仰角 ' + r.maxEl + '° · 方位 ' + r.az + '° · 时长 ' + Math.round(r.durationSec / 60) + ' 分钟 · 估算星等 ' + r.mag + ' · ' + (r.tier === 'naked' ? '肉眼可见' : r.tier === 'binocular' ? '双筒可见' : '望远镜') + (place ? ' · ' + place : ''));
    if (state.observer) lines.push('LOCATION:' + state.observer.lat + ',' + state.observer.lon);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = 'satellite-passes-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  ui.toast('已导出 ' + rows.length + ' 条过境到日历文件');
}

function handlePasses(msg) {
  state.passesPending = false;
  if (!state.passesByIndex) state.passesByIndex = new Map();
  for (const item of msg.items || []) state.passesByIndex.set(item.index, item.passes);

  if (msg.kind === 'telescope') {
    for (const item of msg.items || []) state.telescopeWindows.set(item.index, item.passes);
    buildTelescopeStatus();
    return;
  }
  if (msg.kind === 'single') {
    updatePassDetail();
    return;
  }

  const obsSun = sunElevationAtObserver();
  const dark = obsSun == null ? null : obsSun < -6;
  const rows = [];
  for (const item of msg.items || []) {
    const sat = state.sats[item.index];
    if (!sat) continue;
    // 只推荐真正的"过境"目标：GEO 常驻天际、MEO 长时间可见，不适合作为观看推荐
    if (sat.orbitClass === 'GEO' || sat.orbitClass === 'MEO') continue;
    for (const p of item.passes) {
      if (p.maxEl < 10) continue;
      if (p.durationSec > 3600) continue;
      const mag = estimateMag(sat, p.rangeKm);
      const tier = tierOf(mag);
      let score = p.maxEl * 0.8 + (isStation(sat) ? 45 : 0) + (p.sunlit ? 12 : 0) + Math.min(p.durationSec / 60, 10) + (mag <= 3 ? 12 : 0);
      if (!p.sunlit) score -= 10;
      if (dark === true) score += 15;
      else if (dark === false) score -= 20;
      if (sat.isTelescope) score -= 8;
      const reason = [
        isStation(sat) ? '大目标' : null,
        p.maxEl >= 60 ? '高仰角' : p.maxEl >= 30 ? '中高仰角' : null,
        p.sunlit ? '被阳光照亮' : '在地影中',
        tier === 'naked' ? '肉眼可见' : null,
        dark === true ? '当地夜空' : dark === false ? '当地白天' : null,
      ].filter(Boolean).join(' · ');
      rows.push({
        index: item.index,
        name: sat.name,
        country: (state.countryMap.get(sat.country) || {}).name || sat.country,
        flag: (state.countryMap.get(sat.country) || {}).flag || '🛰️',
        color: state.countryColor.get(sat.country) || '#5ef0ff',
        startAt: p.aos,
        maxAt: p.maxAt,
        maxEl: p.maxEl,
        az: p.az,
        azText: azText(p.az),
        durationSec: p.durationSec,
        rangeKm: p.rangeKm,
        orbitClass: sat.orbitClass,
        mag,
        tier,
        sunlit: p.sunlit,
        score: +score.toFixed(1),
        isTelescope: !!sat.isTelescope,
        reason,
        live: !!p.live,
      });
    }
  }
  // 正在过境最多 6 条，其余留给未来过境：推荐列表既有「现在能看」也有「待会儿能看」
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => {
      if (seen.has(r.index)) return false;
      seen.add(r.index);
      return true;
    });
  };
  const liveRows = dedupe(rows.filter((r) => r.live).sort((a, b) => b.score - a.score)).slice(0, 6);
  const futureRows = dedupe(rows.filter((r) => !r.live).sort((a, b) => b.score - a.score)).slice(0, 10 - liveRows.length);
  state.passes = [...liveRows, ...futureRows];
  state.passesAt = performance.now();
  if (typeof ui.updatePasses === 'function') ui.updatePasses(state.passes);
  updatePassDetail();
  if (!state.telescopeRequested && state.telescopeIndices.length) {
    state.telescopeRequested = true;
    requestTelescopeWindows();
  }
}

function updatePassDetail() {
  if (typeof ui.setPassDetail !== 'function') return;
  if (!state.observer || state.selection < 0 || !state.visibility) {
    ui.setPassDetail(null);
    return;
  }
  const i = state.selection;
  const sat = state.sats[i];
  const v = state.visibility;
  const el = v[i * 4];
  const az = v[i * 4 + 1];
  const range = v[i * 4 + 2];
  const sunlit = v[i * 4 + 3] > 0.5;
  const mag = estimateMag(sat, range);
  const list = state.passesByIndex ? state.passesByIndex.get(i) : null;
  const next = list && list.length ? list[0] : null;
  ui.setPassDetail({
    el: +el.toFixed(1),
    az: +az.toFixed(0),
    rangeKm: Math.round(range),
    sunlit,
    mag,
    tier: tierOf(mag),
    aboveHorizon: el > 0,
    nextPass: next ? { startAt: next.aos, maxEl: next.maxEl, az: next.az, durationSec: next.durationSec } : null,
  });
}

function observerFromClick(clientX, clientY) {
  const ndcX = (clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(clientY / window.innerHeight) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const sph = new THREE.Sphere(new THREE.Vector3(0, 0, 0), WORLD_R);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectSphere(sph, hit)) {
    ui.toast('请点击地球表面来设置观测点');
    return;
  }
  const lat = Math.asin(hit.y / WORLD_R) * DEG;
  const lon = Math.atan2(-hit.z, hit.x) * DEG;
  setObserver({ lat: +lat.toFixed(3), lon: +lon.toFixed(3), altM: 0, label: '自定义点', source: 'globe' });
}

// ---------- 场景 ----------
function initScene() {
  const canvas = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(new THREE.Color(0x02060c), 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  scene = new THREE.Scene();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 6000);
  camera.position.set(70, 95, 225);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.enablePan = false;
  controls.minDistance = 118;
  controls.maxDistance = 1800;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.28;
  syncAutoRotate();
  resetView();

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.26, 0.5, 0.80);
  window.__bloomRef = bloomPass;
  composer.addPass(bloomPass);

  selectionMarker = createSelectionMarker({ color: 0x9ffcff, scale: 11 });
  scene.add(selectionMarker.sprite);
  hoverMarker = createSelectionMarker({ color: 0xffffff, scale: 7.5 });
  hoverMarker.setOpacity && hoverMarker.setOpacity(0.85);
  scene.add(hoverMarker.sprite);
  observerMarker = createSelectionMarker({ color: 0xffd166, scale: 9 });
  scene.add(observerMarker.sprite);
  horizonRing = createOrbitLine({ color: 0xffd166, opacity: 0.42, maxPoints: 128 });
  scene.add(horizonRing.line);
  orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  window.addEventListener('resize', onResize);
  const dom = renderer.domElement;
  dom.addEventListener('pointermove', onPointerMove, { passive: true });
  dom.addEventListener('click', onClick);
  dom.addEventListener('dblclick', () => handlers.onResetView());
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      clearSelection();
      if (state.awaitingObserverClick) {
        state.awaitingObserverClick = false;
        if (typeof ui.setPickingOnGlobe === 'function') ui.setPickingOnGlobe(false);
        ui.toast('已取消选点');
      }
    }
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      handlers.onPlayToggle();
    }
    if (!typing && (e.key === 'r' || e.key === 'R')) handlers.onResetView();
    if (!typing && (e.key === 'f' || e.key === 'F')) handlers.onToggleFollow(!state.follow);
    if (!typing && (e.key === 'c' || e.key === 'C')) {
      const order = ['country', 'category', 'orbit', 'kind'];
      state.colorMode = order[(order.indexOf(state.colorMode) + 1) % order.length];
      if (satLayer) buildColors();
      buildOrbitGroup();
      if (state.selection >= 0) {
        const idx = state.selection;
        state.selection = -1;
        selectSat(idx);
      }
      scheduleBatchOrbits();
      const names = { country: '按国家 / 组织', category: '按任务类型', orbit: '按轨道类型', kind: '按对象类型（载荷/残骸/碎片）' };
      ui.toast('配色：' + names[state.colorMode]);
    }
  });

  createHoverTag();
  createReticle();
  renderer.domElement.style.cursor = 'crosshair';

  window.addEventListener('pointermove', (e) => {
    if (e.target === renderer.domElement) return;
    if (reticleEl) reticleEl.style.opacity = '0';
    if (hoverMarker) hoverMarker.hide();
    const tag = document.getElementById('hover-tag');
    if (tag) tag.style.display = 'none';
  }, true);
  renderer.domElement.addEventListener('pointerleave', () => {
    if (reticleEl) reticleEl.style.opacity = '0';
    if (hoverMarker) hoverMarker.hide();
  });
}

/** 让地球占满可用视野（按窗口宽高取较小边），返回相机到地心距离 */
function fitCameraDistance() {
  const vfov = (camera.fov * Math.PI) / 180;
  const halfV = Math.tan(vfov / 2);
  const halfH = halfV * camera.aspect;
  return WORLD_R / (Math.min(halfV, halfH) * 0.96);
}

function resetView() {
  if (!controls || !camera) return;
  state.fly = null;
  const d = fitCameraDistance();
  const dir = new THREE.Vector3(0.26, 0.34, 0.9).normalize();
  camera.position.copy(dir.multiplyScalar(d));
  controls.target.set(0, 0, 0);
  controls.minDistance = Math.max(WORLD_R * 1.18, d * 0.42);
  controls.maxDistance = d * 6;
  controls.update();
}

/** 相机平滑飞到某颗卫星附近 */
function flyToSatellite(index) {
  if (!lastPositions || !camera || !controls) return;
  const p = new THREE.Vector3(lastPositions[index * 3], lastPositions[index * 3 + 1], lastPositions[index * 3 + 2]);
  if (p.lengthSq() < 1) return;
  const r = p.length();
  const dist = Math.min(Math.max(r * 1.5, WORLD_R * 1.35), WORLD_R * 9);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1) dir.set(0.26, 0.34, 0.9);
  dir.normalize();
  state.fly = {
    fromPos: camera.position.clone(),
    toPos: p.clone().add(dir.multiplyScalar(dist)),
    fromTarget: controls.target.clone(),
    toTarget: p.clone(),
    t: 0,
    dur: 0.85,
  };
}

function fitToVisibleSetSafe() {
  if (!fitCameraToVisible()) return;
  const need = state.visibleCount;
  ui.toast('已切到星座视角：' + need + ' 个目标');
}

/** 把当前可见目标整体装进视野：抬高视角、拉远到刚好装下 */
function fitCameraToVisible() {
  if (!lastPositions || !camera || !controls) return false;
  let maxR = 0;
  let n = 0;
  for (let i = 0; i < state.sats.length; i++) {
    if (state.hidden[i]) continue;
    const x = lastPositions[i * 3];
    const y = lastPositions[i * 3 + 1];
    const z = lastPositions[i * 3 + 2];
    if (!x && !y && !z) continue;
    n++;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > maxR) maxR = r;
  }
  if (!n) return false;
  const vfov = (camera.fov * Math.PI) / 180;
  const halfV = Math.tan(vfov / 2);
  const halfH = halfV * Math.min(1, camera.aspect);
  const halfMin = Math.min(halfV, halfH);
  const need = Math.max(maxR, WORLD_R) * 1.08;
  const dist = Math.min(need / halfMin, fitCameraDistance() * 7);
  const cur = camera.position.clone().normalize();
  const az = Math.atan2(cur.z, cur.x);
  const elev = (n <= 40 ? 55 : 38) * (Math.PI / 180);
  const dir = new THREE.Vector3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));
  const to = dir.multiplyScalar(dist);
  state.fly = {
    fromPos: camera.position.clone(),
    toPos: to,
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(0, 0, 0),
    t: 0,
    dur: 0.9,
  };
  controls.minDistance = Math.max(WORLD_R * 1.18, Math.min(controls.minDistance, dist * 0.4));
  controls.maxDistance = Math.max(controls.maxDistance, dist * 2.2);
  return true;
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  if (controls) {
    const fd = fitCameraDistance();
    controls.minDistance = Math.max(WORLD_R * 1.18, fd * 0.42);
    controls.maxDistance = fd * 6;
  }
  const pr = renderer.getPixelRatio();
  if (satLayer) satLayer.setPixelRatio(pr);
}

// ---------- 拾取 ----------
let hoverTimer = 0;
let lastPointer = { x: 0, y: 0 };
let pickRaf = 0;
let lastHoverAt = 0;

function onPointerMove(e) {
  if (!satLayer) return;
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
  // 光标准星立即跟随（不受拾取计算影响）
  if (reticleEl) {
    reticleEl.style.opacity = '1';
    reticleEl.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  }
  if (pickRaf) return;
  pickRaf = requestAnimationFrame(() => {
    pickRaf = 0;
    const x = lastPointer.x;
    const y = lastPointer.y;
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = -(y / window.innerHeight) * 2 + 1;
    const near = satLayer.pickAll(ndcX, ndcY, camera, 14, 1, state.sats.length, satLayer.hidden);
    const telIdx = pickTelescopeAt(x, y, 16);
    const idx = telIdx >= 0 ? telIdx : (near.length ? near[0].index : -1);
    state.hover = idx;
    lastHoverAt = performance.now();
    if (reticleEl) {
      reticleEl.style.color = idx >= 0 ? '#ffd166' : '#5ef0ff';
      reticleEl.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + (idx >= 0 ? 1.18 : 1) + ')';
    }
    if (idx >= 0 && lastPositions && hoverMarker) {
      const color = state.colorMode === 'category'
        ? CATEGORY_COLORS[categoryKeyOf(state.sats[idx])]
        : state.colorMode === 'orbit'
          ? ORBIT_COLORS[state.sats[idx].orbitClass] || ORBIT_COLORS.OTHER
          : state.countryColor.get(state.sats[idx].country) || '#9ffcff';
      hoverMarker.setColor(color);
      hoverMarker.place(lastPositions[idx * 3], lastPositions[idx * 3 + 1], lastPositions[idx * 3 + 2]);
    } else if (hoverMarker) {
      hoverMarker.hide();
    }
    updateHoverTag(x, y, idx);
  });
}

function onClick(e) {
  if (!satLayer) return;
  closeChooser();
  if (state.awaitingObserverClick) {
    state.awaitingObserverClick = false;
    if (typeof ui.setPickingOnGlobe === 'function') ui.setPickingOnGlobe(false);
    observerFromClick(e.clientX, e.clientY);
    return;
  }
  if (e.altKey) {
    observerFromClick(e.clientX, e.clientY);
    return;
  }
  const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
  // 优先选中"准星当前锁定的那颗"（刚刚 hover 过的目标），更符合所见即所得
  if (!e.shiftKey && state.hover >= 0 && performance.now() - lastHoverAt < 300) {
    selectSat(state.hover, { x: e.clientX, y: e.clientY });
    return;
  }
  // 14px 内直接选中（与悬停锁定的手感一致）
  const anchor = { x: e.clientX, y: e.clientY };
  const telHit = pickTelescopeAt(e.clientX, e.clientY, 16);
  if (telHit >= 0 && !e.shiftKey) {
    selectSat(telHit, anchor);
    return;
  }
  const locked = satLayer.pickAll(ndcX, ndcY, camera, 14, 1, state.sats.length, satLayer.hidden);
  if (locked.length && !e.shiftKey) {
    selectSat(locked[0].index, anchor);
    return;
  }
  const cands = satLayer.pickAll(ndcX, ndcY, camera, 20, 8, state.sats.length, satLayer.hidden);
  if (!cands.length) {
    clearSelection();
    ui.toast('这里没有目标 · 按 / 搜索，或用滚轮放大后再点');
    return;
  }
  if (cands.length === 1 || (!e.shiftKey && cands[0].dist <= 9)) {
    selectSat(cands[0].index, anchor);
    return;
  }
  showChooser(cands, e.clientX, e.clientY);
}

// ---------- 多目标选择弹层 ----------
function satAltKm(index) {
  if (!lastPositions) return null;
  const x = lastPositions[index * 3];
  const y = lastPositions[index * 3 + 1];
  const z = lastPositions[index * 3 + 2];
  const r = Math.sqrt(x * x + y * y + z * z);
  return r > 1 ? (r / WORLD_R) * EARTH_KM - EARTH_KM : null;
}

function closeChooser() {
  if (chooserEl) {
    chooserEl.remove();
    chooserEl = null;
  }
}

function showChooser(candidates, clientX, clientY) {
  closeChooser();
  ui.toast('附近有 ' + candidates.length + ' 个目标，点其中一行选中');
  const box = document.createElement('div');
  box.id = 'sat-chooser';
  box.style.cssText = [
    'position:fixed', 'z-index:60', 'min-width:248px', 'max-width:320px', 'max-height:264px', 'overflow-y:auto',
    'padding:6px', 'border-radius:8px', 'border:1px solid rgba(94,240,255,.5)',
    'background:rgba(3,14,22,.94)', 'box-shadow:0 8px 32px rgba(0,0,0,.6), 0 0 22px rgba(94,240,255,.22)',
    'backdrop-filter:blur(6px)', 'font:12px/1.5 ui-monospace,Consolas,monospace', 'color:#d8f6ff',
  ].join(';');

  const head = document.createElement('div');
  head.textContent = candidates.length + ' 个目标在此附近 · 点击选择';
  head.style.cssText = 'padding:2px 6px 6px;color:#6fb6c9;font-size:11px;letter-spacing:.02em';
  box.appendChild(head);

  for (const c of candidates) {
    const s = state.sats[c.index];
    if (!s) continue;
    const cty = state.countryMap.get(s.country);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:6px;cursor:pointer';
    row.onmouseenter = () => { row.style.background = 'rgba(94,240,255,.13)'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    const dot = document.createElement('span');
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 8px currentColor';
    dot.style.background = CATEGORY_COLORS[categoryKeyOf(s)] || '#5ef0ff';
    dot.style.color = dot.style.background;
    const name = document.createElement('span');
    name.textContent = s.name || ('#' + s.id);
    name.style.cssText = 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const meta = document.createElement('span');
    const alt = satAltKm(c.index);
    meta.textContent = (cty ? cty.flag + ' ' + cty.name : s.country) + (alt != null ? ' · ' + Math.round(alt) + 'km' : '');
    meta.style.cssText = 'flex:0 0 auto;color:#6f96a6;font-size:11px';
    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(meta);
    row.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeChooser();
      selectSat(c.index);
    });
    box.appendChild(row);
  }

  document.body.appendChild(box);
  const rect = box.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - 18;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 14;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  if (top < 8) top = 8;
  box.style.left = Math.max(8, left) + 'px';
  box.style.top = top + 'px';
  chooserEl = box;
}

document.addEventListener('pointerdown', (e) => {
  if (chooserEl && !chooserEl.contains(e.target) && e.target.id !== 'scene') closeChooser();
}, true);

let reticleEl = null;
let bloomPass = null;
let sunTick = 0;

// 地球自转角速度（度/秒，恒星日）；时钟倍率越大转得越快
const EARTH_ROT_DEG_PER_SEC = 360 / 86164.0905;
const ORBIT_AUTOROTATE_SPEED = 0.28;

/** 按当前模式与时间倍率同步相机自动旋转速度 */
function syncAutoRotate() {
  if (!controls) return;
  const mode = settings.autoRotate;
  if (mode === 'off') {
    controls.autoRotate = false;
    return;
  }
  if (mode === 'orbit') {
    controls.autoRotate = true;
    controls.autoRotateSpeed = ORBIT_AUTOROTATE_SPEED;
  } else {
    // OrbitControls：speed 2.0 ≈ 12°/秒 → speed = (度/秒) / 6
    const rate = state.clock.paused ? 0 : Number(state.clock.rate);
    const degPerSec = EARTH_ROT_DEG_PER_SEC *
      (Number.isFinite(rate) ? Math.abs(rate) : 1);
    // 时间暂停时地球不自转，相机也应当停下
    controls.autoRotate = degPerSec > 0;
    controls.autoRotateSpeed = Math.max(0.0004, degPerSec / 6);
  }
}
let telescopeGroup = null;
let axisGroup = null;
let sunMarker = null;

function makeStarTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,238,180,0.95)');
  g.addColorStop(0.3, 'rgba(255,206,110,0.55)');
  g.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,226,150,0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(S / 2, 5);
  ctx.lineTo(S / 2, S - 5);
  ctx.moveTo(5, S / 2);
  ctx.lineTo(S - 5, S / 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 天文望远镜专用星标（≤60 个，成本可忽略） */
function buildTelescopeMarkers() {
  if (telescopeGroup) {
    scene.remove(telescopeGroup);
    telescopeGroup.traverse((o) => { if (o.material) o.material.dispose(); });
    telescopeGroup = null;
  }
  state.telescopeIndices = [];
  for (let i = 0; i < state.sats.length; i++) {
    if (state.sats[i].isTelescope) state.telescopeIndices.push(i);
  }
  if (!state.telescopeIndices.length) return;
  const tex = makeStarTexture();
  telescopeGroup = new THREE.Group();
  telescopeGroup.name = 'telescopes';
  for (const i of state.telescopeIndices.slice(0, 60)) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xffe6a8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.72,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.setScalar(4.6);
    sp.renderOrder = 7;
    telescopeGroup.add(sp);
  }
  scene.add(telescopeGroup);
}

/** 星标随筛选显示/隐藏（否则会出现"看得到却点不到"的暗点） */
function syncTelescopeVisibility() {
  if (!telescopeGroup) return;
  for (let k = 0; k < telescopeGroup.children.length; k++) {
    const i = state.telescopeIndices[k];
    const sp = telescopeGroup.children[k];
    const occluded = occludedByEarth(camera, sp.position.x, sp.position.y, sp.position.z);
    sp.visible = i != null && !state.hidden[i] && !occluded;
  }
}

/** 屏幕坐标拾取望远镜星标（星标比普通点大，单独判定更跟手） */
function pickTelescopeAt(clientX, clientY, maxPx) {
  if (!telescopeGroup || !telescopeGroup.visible || !camera) return -1;
  let best = -1;
  let bestD = maxPx * maxPx;
  for (let k = 0; k < telescopeGroup.children.length; k++) {
    const i = state.telescopeIndices[k];
    if (i == null || state.hidden[i]) continue;
    const sp = telescopeGroup.children[k];
    const p = sp.position.clone().project(camera);
    if (p.z > 1) continue;
    const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (0.5 - p.y * 0.5) * window.innerHeight;
    const d2 = (sx - clientX) * (sx - clientX) + (sy - clientY) * (sy - clientY);
    if (d2 <= bestD) {
      bestD = d2;
      best = i;
    }
  }
  return best;
}

function updateTelescopeMarkers(buf) {
  if (!telescopeGroup || !state.telescopeIndices.length) return;
  const kids = telescopeGroup.children;
  for (let k = 0; k < kids.length; k++) {
    const i = state.telescopeIndices[k];
    kids[k].position.set(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
  }
}
const followVec = new THREE.Vector3();
let qualityAt = 0;
let lowStreak = 0;
let highStreak = 0;
let qualityLocked = false;
let lastWorkerMsgAt = 0;
let workerRestarts = 0;
let urlSyncTimer = null;

/** 画质档位：high 全效 / medium 降采样 / low 关泛光 */
function applyQuality(level) {
  if (!composer || !bloomPass || qualityLocked) return;
  state.quality = level;
  const dpr = window.devicePixelRatio || 1;
  if (level === 'high') {
    composer.setPixelRatio(Math.min(dpr, 1.6));
    bloomPass.enabled = true;
    bloomPass.strength = 0.26;
  } else if (level === 'medium') {
    composer.setPixelRatio(Math.min(dpr, 1.15));
    bloomPass.enabled = true;
    bloomPass.strength = 0.18;
  } else {
    composer.setPixelRatio(1);
    bloomPass.enabled = false;
  }
  composer.setSize(window.innerWidth, window.innerHeight);
}

function qualityLabel(level) {
  return level === 'high' ? '高' : level === 'medium' ? '中' : '低';
}

function createReticle() {
  if (document.getElementById('cursor-reticle')) return;
  const el = document.createElement('div');
  el.id = 'cursor-reticle';
  el.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'width:28px', 'height:28px', 'margin:-14px 0 0 -14px',
    'z-index:56', 'pointer-events:none', 'opacity:0', 'color:#5ef0ff',
    'transition:opacity .12s ease', 'will-change:transform',
  ].join(';');
  el.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" style="display:block">' +
    '<circle cx="14" cy="14" r="9" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.85"/>' +
    '<circle cx="14" cy="14" r="1.7" fill="currentColor"/>' +
    '<path d="M14 1.5v4M14 22.5v4M1.5 14h4M22.5 14h4" stroke="currentColor" stroke-width="1.2" opacity="0.9"/>' +
    '</svg>';
  document.body.appendChild(el);
  reticleEl = el;
}

function createHoverTag() {
  if (document.getElementById('hover-tag')) return;
  const tag = document.createElement('div');
  tag.id = 'hover-tag';
  tag.hidden = true;
  tag.style.cssText = [
    'position:fixed', 'z-index:40', 'pointer-events:none', 'display:none',
    'padding:5px 9px', 'border-radius:6px', 'border:1px solid rgba(94,240,255,.55)',
    'background:rgba(3,14,22,.82)', 'color:#d8f6ff', 'font:12px/1.45 ui-monospace,Consolas,monospace',
    'box-shadow:0 0 18px rgba(94,240,255,.28)', 'white-space:nowrap', 'backdrop-filter:blur(4px)',
  ].join(';');
  document.body.appendChild(tag);
}

function updateHoverTag(x, y, idx) {
  const tag = document.getElementById('hover-tag');
  if (!tag) return;
  if (idx < 0 || !state.layers.labels) {
    tag.style.display = 'none';
    return;
  }
  const s = state.sats[idx];
  if (!s) return;
  const c = state.countryMap.get(s.country);
  const p = lastPositions;
  let alt = null;
  if (p) {
    const r = Math.sqrt(p[idx * 3] * p[idx * 3] + p[idx * 3 + 1] * p[idx * 3 + 1] + p[idx * 3 + 2] * p[idx * 3 + 2]);
    if (r > 1) alt = (r / WORLD_R) * EARTH_KM - EARTH_KM;
  }
  tag.innerHTML = '';
  const strong = document.createElement('b');
  strong.textContent = s.name || ('#' + s.id);
  tag.appendChild(strong);
  const span = document.createElement('span');
  span.style.color = '#7fb8c9';
  span.textContent = ' · ' + (c ? c.name : s.country) + (alt != null ? ' · ' + alt.toFixed(0) + ' km' : '');
  tag.appendChild(span);
  tag.style.display = 'block';
  tag.style.left = Math.min(window.innerWidth - 260, x + 14) + 'px';
  tag.style.top = Math.max(8, y - 34) + 'px';
}

// ---------- 渲染循环 ----------
let lastFrame = performance.now();
let fpsFrames = 0;
let fpsAt = performance.now();
let fpsValue = 60;
let uiTickAt = 0;
let clockAt = 0;
let detailAt = 0;
let orderDetailRefresh = false;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  // 相机飞行（搜索定位）
  if (state.fly) {
    const fl = state.fly;
    fl.t = Math.min(1, fl.t + dt / fl.dur);
    const e = 1 - Math.pow(1 - fl.t, 3);
    camera.position.lerpVectors(fl.fromPos, fl.toPos, e);
    controls.target.lerpVectors(fl.fromTarget, fl.toTarget, e);
    if (fl.t >= 1) state.fly = null;
  }

  // 跟随选中卫星（相机与目标同步平移，保持相对视角）
  if (state.follow && state.selection >= 0 && lastPositions) {
    const i = state.selection * 3;
    followVec.set(lastPositions[i], lastPositions[i + 1], lastPositions[i + 2]);
    const delta = followVec.clone().sub(controls.target).multiplyScalar(0.35);
    controls.target.add(delta);
    camera.position.add(delta);
  } else if (controls.target.lengthSq() > 0.5) {
    const back = controls.target.clone().multiplyScalar(-0.15);
    controls.target.add(back);
    camera.position.add(back);
  }

  controls.update();
  if (globe) globe.update(dt, now / 1000);
  if (globe && sunTick === 0) {
    updateSunDir(nowMs());
    placeSunMarker();
  }
  sunTick = (sunTick + 1) % 30;
  if (selectionMarker) selectionMarker.update(now / 1000);
  if (hoverMarker) hoverMarker.update(now / 1000);
  if (selGround) selGround.setOpacity(0.20 + Math.sin(now / 600) * 0.06);

  composer.render();

  // 截图必须与渲染在同一帧内完成（未开启 preserveDrawingBuffer）
  if (state.pendingShot) {
    state.pendingShot = false;
    try {
      const url = renderer.domElement.toDataURL('image/png');
      const d = new Date();
      const stamp = String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orbital-mirror-' + stamp + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      ui.toast('已保存截图 ' + a.download);
    } catch (err) {
      ui.toast('截图失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  fpsFrames++;
  if (now - fpsAt > 500) {
    fpsValue = Math.round((fpsFrames * 1000) / (now - fpsAt));
    fpsFrames = 0;
    fpsAt = now;
    ui.setPerf({ fps: fpsValue, rendered: state.visibleCount, total: state.sats.length });
  }
  if (now - clockAt > 250) {
    clockAt = now;
    const ms = nowMs();
    const rate = state.clock.paused ? 0 : state.clock.rate;
    ui.setClock({
      utc: tzLabel(settings.tz) + ' ' + fmtZoned(ms, settings.tz, true),
      local: settings.tz === 'utc' ? fmtLocal(ms) : 'UTC ' + fmtUTC(ms),
      speed: rate,
      paused: state.clock.paused,
      offsetMinutes: (ms - Date.now()) / 60000,
    });
    if (state.selection >= 0) {
      if (now - detailAt > 140) {
        detailAt = now;
        requestDetail();
      }
      requestTrack(false);
    }
  }
  // 自适应画质：连续两次 <40fps 降档，连续三次 >57fps 升档
  if (now - qualityAt > 2000 && state.sats.length && !qualityLocked) {
    qualityAt = now;
    if (fpsValue < 40) {
      lowStreak++;
      highStreak = 0;
    } else if (fpsValue > 57) {
      highStreak++;
      lowStreak = 0;
    } else {
      lowStreak = 0;
      highStreak = 0;
    }
    if (lowStreak >= 2 && state.quality !== 'low') {
      applyQuality(state.quality === 'high' ? 'medium' : 'low');
      lowStreak = 0;
    } else if (highStreak >= 3 && state.quality !== 'high') {
      applyQuality(state.quality === 'low' ? 'medium' : 'high');
      highStreak = 0;
    }
  }

  // Worker 守护：超过 8 秒没有任何消息就重建
  if (worker && state.sats.length && now - lastWorkerMsgAt > 6000 && workerRestarts < 5) {
    workerRestarts++;
    console.warn('[worker] 无响应，重建中…');
    ui.toast('推算线程无响应，正在重建…');
    restartWorker();
  }

  if (now - uiTickAt > 1000) {
    uiTickAt = now;
    const stats = buildStats();
    ui.updateStats(stats);
    if (orderDetailRefresh && state.selection >= 0) {
      orderDetailRefresh = false;
      updatePassDetail();
    }
    if (state.observer && !state.passesPending && now - state.passesAt > 120000) requestPasses('list');
  }
}

boot();
