// 总装：数据接入、场景、时钟、筛选、拾取、UI 联动
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createGlobe } from './globe.js';
import { createSatLayer, createOrbitLine, createSelectionMarker } from './satellites.js';
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
const ORBIT_COLORS = { LEO: '#5ef0ff', MEO: '#ffd166', GEO: '#ff5ea8', HEO: '#a78bfa', OTHER: '#6b8ea3' };
const ORBIT_LABELS = { LEO: 'LEO 低轨', MEO: 'MEO 中轨', GEO: 'GEO 同步', HEO: 'HEO 高椭圆', OTHER: 'OTH 其他' };
const ORBIT_LABELS_ZH = { LEO: '低地球轨道', MEO: '中地球轨道', GEO: '地球同步轨道', HEO: '大椭圆轨道', OTHER: '其他轨道' };

// 任务类型（V2）：key 与 /api/catalog 的 category 一一对应
const CATEGORY_ORDER = ['comms', 'nav', 'eo', 'weather', 'mil', 'science', 'tech', 'other'];
const CATEGORY_COLORS = {
  comms: '#5ef0ff', nav: '#ffd166', eo: '#4ade80', weather: '#7dd3fc',
  mil: '#ff5ea8', science: '#a78bfa', tech: '#f97316', other: '#6b8ea3',
};
const CATEGORY_LABELS = {
  comms: '通信 / 互联网', nav: '导航 / 定位', eo: '对地观测 / 遥感', weather: '气象 / 海洋',
  mil: '军事 / 侦察', science: '科学 / 载人', tech: '技术试验 / 教育', other: '其他 / 未分类',
};
const STATUS_TEXT = { '+': '在轨运行', P: '部分可用', B: '备份(未跟踪)', S: '备用状态', X: '已失效', '': '未知状态' };

const state = {
  catalog: null,
  sats: [],
  countries: [],
  countryMap: new Map(),
  countryColor: new Map(),
  filters: { countries: new Set(), orbits: new Set(), categories: new Set(), query: '' },
  hidden: new Uint8Array(0),
  visibleCount: 0,
  colorMode: 'country',
  selection: -1,
  hover: -1,
  layers: { orbits: true, grid: true, atmosphere: true, stars: true, autoRotate: true, labels: true },
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
function fmtUTC(ms) {
  const d = new Date(ms);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
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
    applyFilters();
  },
  onCountryToggle(code, enabled) {
    if (enabled) state.filters.countries.add(code);
    else state.filters.countries.delete(code);
    applyFilters();
  },
  onCategoryToggle(key, enabled) {
    if (enabled) state.filters.categories.add(key);
    else state.filters.categories.delete(key);
    applyFilters();
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
    pushWorkerTime();
  },
  onNow() {
    state.clock.rate = 1;
    state.clock.paused = false;
    state.clock.baseMs = Date.now();
    state.clock.baseReal = performance.now();
    pushWorkerTime();
    ui.toast('已回到当前真实时间 · 实时模式');
  },
  onLayerToggle(key, enabled) {
    state.layers[key] = !!enabled;
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
    if (!controls || !camera) return;
    camera.position.set(120, 110, 240);
    controls.target.set(0, 0, 0);
    controls.update();
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
async function boot() {
  try {
    const mod = await import('./ui.js');
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
    get visibility() { return state.visibility; },
    get composer() { return composer; },
    get bloom() { return window.__bloomRef || null; },
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
    console.error('[data] 目录加载失败', err);
    ui.setError('数据服务不可用：' + (err && err.message ? err.message : '未知错误') + '（请确认 node server.mjs 已启动）');
    ui.setLoading({ visible: false });
    if (!state.catalog) return;
  }
  if (data) applyCatalog(data);
}

function applyCatalog(data) {
  state.catalog = data;
  state.sats = data.satellites;
  state.countries = data.countries || [];
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

  ui.setDataStatus({ source: data.source || 'service', updated: data.updated || Date.now(), count: total });
  ui.updateStats(buildStats());
}

function buildColors() {
  const mode = state.colorMode;
  const colors = satLayer.colors;
  for (let i = 0; i < state.sats.length; i++) {
    const s = state.sats[i];
    let hex;
    if (mode === 'orbit') hex = ORBIT_COLORS[s.orbitClass] || ORBIT_COLORS.OTHER;
    else if (mode === 'category') hex = CATEGORY_COLORS[s.category || 'other'] || CATEGORY_COLORS.other;
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
  worker = new Worker(new URL('./propagate.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.type === 'positions') {
      lastPositions = msg.buf;
      satLayer.setPositionBuffer(msg.buf);
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

// ---------- 筛选 ----------
function applyFilters() {
  const f = state.filters;
  const q = (f.query || '').trim().toUpperCase();
  let visible = 0;
  for (let i = 0; i < state.sats.length; i++) {
    const s = state.sats[i];
    let ok = true;
    if (f.countries.size && !f.countries.has(s.country)) ok = false;
    if (ok && f.orbits.size && !f.orbits.has(s.orbitClass)) ok = false;
    if (ok && f.categories.size && !f.categories.has(s.category || 'other')) ok = false;
    if (ok && q) ok = matchQuery(s, q);
    state.hidden[i] = ok ? 0 : 1;
    if (ok) visible++;
  }
  state.visibleCount = visible;
  if (satLayer) {
    satLayer.hidden.set(state.hidden);
    satLayer.commitHidden();
    const total = Math.max(1, state.sats.length);
    const scale = visible <= 300 ? 1.85 : visible <= 1500 ? 1.5 : visible <= 5000 ? 1.2 : 1.0;
    satLayer.setScale(scale);
  }
  const stats = buildStats();
  ui.updateStats(stats);
  ui.updateOrbits(buildOrbitStats());
  if (typeof ui.updateCategories === 'function') ui.updateCategories(buildCategoryStats());
  ui.updateCountries(buildCountryList(), !f.countries.size);
  scheduleBatchOrbits();
}

function matchQuery(s, q) {
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
  return false;
}

function buildStats() {
  const byOrbitCount = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, OTHER: 0 };
  const counts = new Map();
  let active = 0;
  for (const s of state.sats) {
    byOrbitCount[s.orbitClass] = (byOrbitCount[s.orbitClass] || 0) + 1;
    counts.set(s.country, (counts.get(s.country) || 0) + 1);
    if (s.status === '+' || s.status === 'P') active++;
  }
  const total = state.sats.length || 1;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => {
      const c = state.countryMap.get(code) || { name: code, flag: '🛰️' };
      return {
        code,
        name: c.name,
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
  };
}

function buildOrbitStats() {
  const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, OTHER: 0 };
  for (const s of state.sats) counts[s.orbitClass] = (counts[s.orbitClass] || 0) + 1;
  return ['LEO', 'MEO', 'GEO', 'HEO', 'OTHER'].map((k) => ({
    key: k,
    label: ORBIT_LABELS[k],
    labelZh: ORBIT_LABELS_ZH[k],
    count: counts[k] || 0,
    active: !state.filters.orbits.size || state.filters.orbits.has(k),
    color: ORBIT_COLORS[k],
  }));
}

function buildCategoryCounts() {
  const counts = { comms: 0, nav: 0, eo: 0, weather: 0, mil: 0, science: 0, tech: 0, other: 0 };
  for (const s of state.sats) {
    const k = s.category || 'other';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function buildCategoryStats() {
  const counts = buildCategoryCounts();
  const total = Math.max(1, state.sats.length);
  return CATEGORY_ORDER.map((k) => ({
    key: k,
    label: CATEGORY_LABELS[k],
    count: counts[k] || 0,
    pct: Math.round(((counts[k] || 0) / total) * 1000) / 10,
    active: !state.filters.categories.size || state.filters.categories.has(k),
    color: CATEGORY_COLORS[k],
  }));
}

function buildCountryList() {
  const counts = new Map();
  for (const s of state.sats) counts.set(s.country, (counts.get(s.country) || 0) + 1);
  const list = [];
  for (const [code, count] of counts) {
    const c = state.countryMap.get(code) || { name: code, flag: '🛰️', kind: 'other' };
    list.push({
      code,
      name: c.name,
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
function selectSat(index) {
  if (index === state.selection) {
    clearSelection();
    return;
  }
  state.selection = index;
  if (index < 0) {
    clearSelectionVisual();
    ui.setSelection(null);
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
  ui.setSelection(makeDetailShell(s));
  if (state.observer) setTimeout(() => requestPasses('single'), 80);
}

function clearSelection() {
  state.selection = -1;
  clearSelectionVisual();
  ui.setSelection(null);
}

function clearSelectionVisual() {
  if (selectionMarker) selectionMarker.hide();
  if (selOrbit) selOrbit.clear();
  if (selGround) selGround.clear();
  selectedTrackIndex = -1;
}

function makeDetailShell(s) {
  const c = state.countryMap.get(s.country) || { code: s.country, name: s.country, flag: '🛰️' };
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
      key: s.category || 'other',
      label: s.categoryLabel || CATEGORY_LABELS[s.category || 'other'] || '其他 / 未分类',
      labelEn: s.categoryLabelEn || '',
      confidence: s.categoryConfidence || 'low',
      note: s.categoryNote || '',
      color: CATEGORY_COLORS[s.category || 'other'] || CATEGORY_COLORS.other,
    },
    objectType: s.objectType || 'PAY',
    status: s.status || '',
    statusText: STATUS_TEXT[s.status] || STATUS_TEXT[''],
    orbitClass: s.orbitClass,
    orbitLabel: ORBIT_LABELS_ZH[s.orbitClass] || s.orbitClass,
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

function isStation(sat) {
  const n = (sat && sat.name ? sat.name : '').toUpperCase();
  return /^ISS |TIANHE|CSS \(|TIANGONG|ZARYA/.test(n);
}

function baseSizeFor(sat) {
  const cls = sat.orbitClass;
  let s = cls === 'GEO' ? 2.9 : cls === 'HEO' ? 2.5 : cls === 'MEO' ? 2.3 : cls === 'LEO' ? 1.9 : 1.7;
  if (isStation(sat)) s = 4.6;
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
  let base = 6.5;
  if (/^ISS |TIANHE|CSS \(|TIANGONG|ZARYA/.test(n)) base = -1.6;
  else if (n.indexOf('STARLINK') === 0) base = 5.2;
  else if (n.indexOf('ONEWEB') === 0) base = 6.0;
  else if (n.indexOf('KUIPER') === 0) base = 6.2;
  else if (sat.orbitClass === 'GEO') base = 8.0;
  else if (sat.category === 'comms') base = 7.0;
  else if (sat.category === 'eo') base = 6.0;
  const r = Math.max(1, rangeKm || 1000);
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

function handlePasses(msg) {
  state.passesPending = false;
  if (!state.passesByIndex) state.passesByIndex = new Map();
  for (const item of msg.items || []) state.passesByIndex.set(item.index, item.passes);

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
  setObserver({ lat: +lat.toFixed(3), lon: +lon.toFixed(3), altM: 0, label: lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°', source: 'globe' });
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
  camera.position.set(120, 110, 240);

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

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.55, 0.58);
  window.__bloomRef = bloom;
  composer.addPass(bloom);

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
    if (e.key === 'Escape') clearSelection();
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      handlers.onPlayToggle();
    }
    if (!typing && (e.key === 'c' || e.key === 'C')) {
      const order = ['country', 'category', 'orbit'];
      state.colorMode = order[(order.indexOf(state.colorMode) + 1) % order.length];
      if (satLayer) buildColors();
      buildOrbitGroup();
      if (state.selection >= 0) {
        const idx = state.selection;
        state.selection = -1;
        selectSat(idx);
      }
      scheduleBatchOrbits();
      const names = { country: '按国家 / 组织', category: '按任务类型', orbit: '按轨道类型' };
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

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
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
    const near = satLayer.pickAll(ndcX, ndcY, camera, 9, 1, state.sats.length, satLayer.hidden);
    const idx = near.length ? near[0].index : -1;
    state.hover = idx;
    lastHoverAt = performance.now();
    if (reticleEl) {
      reticleEl.style.color = idx >= 0 ? '#ffd166' : '#5ef0ff';
      reticleEl.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + (idx >= 0 ? 1.18 : 1) + ')';
    }
    if (idx >= 0 && lastPositions && hoverMarker) {
      const color = state.colorMode === 'category'
        ? CATEGORY_COLORS[state.sats[idx].category || 'other']
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
  if (e.altKey) {
    observerFromClick(e.clientX, e.clientY);
    return;
  }
  const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
  // 优先选中"准星当前锁定的那颗"（刚刚 hover 过的目标），更符合所见即所得
  if (!e.shiftKey && state.hover >= 0 && performance.now() - lastHoverAt < 300) {
    selectSat(state.hover);
    return;
  }
  // 退而求其次：9px 内重新拾取，避免密集区域直接弹列表
  const locked = satLayer.pickAll(ndcX, ndcY, camera, 9, 1, state.sats.length, satLayer.hidden);
  if (locked.length && !e.shiftKey) {
    selectSat(locked[0].index);
    return;
  }
  const cands = satLayer.pickAll(ndcX, ndcY, camera, 18, 8, state.sats.length, satLayer.hidden);
  if (!cands.length) {
    clearSelection();
    return;
  }
  if (cands.length === 1) {
    selectSat(cands[0].index);
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
    dot.style.background = CATEGORY_COLORS[s.category || 'other'] || '#5ef0ff';
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

  controls.update();
  if (globe) globe.update(dt, now / 1000);
  if (selectionMarker) selectionMarker.update(now / 1000);
  if (hoverMarker) hoverMarker.update(now / 1000);
  if (selGround) selGround.setOpacity(0.20 + Math.sin(now / 600) * 0.06);

  composer.render();

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
      utc: 'UTC ' + fmtUTC(ms),
      local: fmtLocal(ms),
      speed: rate,
      paused: state.clock.paused,
    });
    if (state.selection >= 0) {
      if (now - detailAt > 140) {
        detailAt = now;
        requestDetail();
      }
      requestTrack(false);
    }
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
