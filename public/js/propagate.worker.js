// SGP4 后台推算：位置 + 观测点可见性 + 过境预报
import { twoline2satrec, sgp4, gstime, eciToEcf, eciToGeodetic, jday } from '../vendor/satellite.es.js';

const EARTH_KM = 6371;
const EARTH_A = 6378.137;
const EARTH_B = 6356.7523142;
const EARTH_E2 = 2 * (EARTH_A - EARTH_B) / EARTH_A - Math.pow((EARTH_A - EARTH_B) / EARTH_A, 2);
const WORLD_R = 100;
const SCALE = WORLD_R / EARTH_KM;
const TICK_MS = 200;
const VIS_EVERY = 5; // 每 5 个 tick（约 1s）更新一次可见性
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

let sats = [];
let total = 0;
let initToken = 0;
let loop = null;
let tickCount = 0;
let ecfKm = null;
let visBuf = null;
let observer = null; // { lat, lon, altM, vec: {x,y,z}, sinLat, cosLat, sinLon, cosLon }
let clock = { baseMs: Date.now(), baseReal: performance.now(), rate: 1, paused: false };
let passToken = 0;

function nowMs() {
  return clock.paused ? clock.baseMs : clock.baseMs + (performance.now() - clock.baseReal) * clock.rate;
}

function jdOf(ms) {
  const d = new Date(ms);
  return jday(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds() + d.getUTCMilliseconds() / 1000);
}

function propagateIndex(i, jd) {
  const s = sats[i];
  if (!s || !s.rec || s.rec.error) return null;
  const pv = sgp4(s.rec, (jd - s.rec.jdsatepoch) * 1440);
  if (!pv || !pv.position || pv.position === true) return null;
  return pv;
}

/** 太阳单位向量（ECI，低精度算法，误差 < 0.01 度） */
function sunEci(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  return {
    x: Math.cos(lambda),
    y: Math.cos(eps) * Math.sin(lambda),
    z: Math.sin(eps) * Math.sin(lambda),
  };
}

function setObserver(o) {
  if (!o) {
    observer = null;
    visBuf = null;
    return;
  }
  const lat = o.lat * RAD;
  const lon = o.lon * RAD;
  const h = (o.altM || 0) / 1000;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const N = EARTH_A / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat);
  observer = {
    lat: o.lat,
    lon: o.lon,
    sinLat,
    cosLat,
    sinLon,
    cosLon,
    // 观测点 ECF 坐标（km）
    x: (N + h) * cosLat * cosLon,
    y: (N + h) * cosLat * sinLon,
    z: (N * (1 - EARTH_E2) + h) * sinLat,
  };
  visBuf = new Float32Array(total * 4);
}

/** 由 ECF 位置算仰角/方位/斜距/是否被太阳照亮 */
function lookAngles(px, py, pz, sun) {
  const dx = px - observer.x;
  const dy = py - observer.y;
  const dz = pz - observer.z;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(range > 1)) return null;
  const east = -observer.sinLon * dx + observer.cosLon * dy;
  const north = -observer.sinLat * observer.cosLon * dx - observer.sinLat * observer.sinLon * dy + observer.cosLat * dz;
  const up = observer.cosLat * observer.cosLon * dx + observer.cosLat * observer.sinLon * dy + observer.sinLat * dz;
  let el = Math.asin(Math.max(-1, Math.min(1, up / range))) * DEG;
  let az = Math.atan2(east, north) * DEG;
  if (az < 0) az += 360;
  // 太阳照亮判定（地影圆柱模型）
  const r2 = px * px + py * py + pz * pz;
  const dot = px * sun.x + py * sun.y + pz * sun.z;
  let sunlit = true;
  if (dot < 0) {
    const perp2 = r2 - dot * dot;
    sunlit = perp2 > EARTH_A * EARTH_A;
  }
  return { el, az, range, sunlit };
}

function tick() {
  if (!ecfKm || !total) return;
  const ms = nowMs();
  const jd = jdOf(ms);
  const gmst = gstime(new Date(ms));
  const out = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    const pv = propagateIndex(i, jd);
    if (!pv) continue;
    const ecf = eciToEcf(pv.position, gmst);
    ecfKm[i * 3] = ecf.x;
    ecfKm[i * 3 + 1] = ecf.y;
    ecfKm[i * 3 + 2] = ecf.z;
    out[i * 3] = ecf.x * SCALE;
    out[i * 3 + 1] = ecf.z * SCALE;
    out[i * 3 + 2] = -ecf.y * SCALE;
  }
  // three.js 为 Y-up，ECEF 为 Z-up → (x, z, -y)
  self.postMessage({ type: 'positions', buf: out, timeMs: ms }, [out.buffer]);

  tickCount++;
  if (observer && visBuf && tickCount % VIS_EVERY === 0) {
    const sunE = sunEci(ms);
    // 太阳 ECI → ECF
    const cg = Math.cos(gmst);
    const sg = Math.sin(gmst);
    const sun = {
      x: sunE.x * cg + sunE.y * sg,
      y: -sunE.x * sg + sunE.y * cg,
      z: sunE.z,
    };
    for (let i = 0; i < total; i++) {
      const px = ecfKm[i * 3];
      const py = ecfKm[i * 3 + 1];
      const pz = ecfKm[i * 3 + 2];
      if (!px && !py && !pz) {
        visBuf[i * 4] = -90;
        continue;
      }
      const la = lookAngles(px, py, pz, sun);
      if (!la) {
        visBuf[i * 4] = -90;
        continue;
      }
      visBuf[i * 4] = la.el;
      visBuf[i * 4 + 1] = la.az;
      visBuf[i * 4 + 2] = la.range;
      visBuf[i * 4 + 3] = la.sunlit ? 1 : 0;
    }
    self.postMessage({ type: 'visibility', buf: visBuf.slice(), timeMs: ms }, [visBuf.slice().buffer]);
  }
}

function startLoop() {
  if (loop) clearInterval(loop);
  loop = setInterval(tick, TICK_MS);
  tick();
}

function init(list) {
  const token = ++initToken;
  total = list.length;
  sats = new Array(total);
  ecfKm = new Float32Array(total * 3);
  if (observer) setObserver({ lat: observer.lat, lon: observer.lon, altM: 0 });
  let i = 0;
  const CHUNK = 300;
  function step() {
    if (token !== initToken) return;
    const end = Math.min(i + CHUNK, total);
    for (; i < end; i++) {
      const it = list[i];
      let rec = null;
      try {
        rec = twoline2satrec(it.tle1, it.tle2);
        if (!rec || !rec.jdsatepoch || rec.error) rec = null;
      } catch (err) {
        rec = null;
      }
      sats[i] = { rec, id: it.id };
    }
    self.postMessage({ type: 'progress', done: i, total });
    if (i < total) setTimeout(step, 0);
    else {
      self.postMessage({ type: 'ready', total });
      startLoop();
    }
  }
  step();
}

function detail(index, ms) {
  const s = sats[index];
  if (!s || !s.rec) {
    self.postMessage({ type: 'detail', index, ok: false });
    return;
  }
  const jd = jdOf(ms);
  const gmst = gstime(new Date(ms));
  const pv = propagateIndex(index, jd);
  if (!pv) {
    self.postMessage({ type: 'detail', index, ok: false });
    return;
  }
  const ecf = eciToEcf(pv.position, gmst);
  const geo = eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  let look = null;
  if (observer) {
    const sunE = sunEci(ms);
    const cg = Math.cos(gmst);
    const sg = Math.sin(gmst);
    const sun = { x: sunE.x * cg + sunE.y * sg, y: -sunE.x * sg + sunE.y * cg, z: sunE.z };
    look = lookAngles(ecf.x, ecf.y, ecf.z, sun);
  }
  self.postMessage({
    type: 'detail',
    index,
    ok: true,
    timeMs: ms,
    lat: geo.latitude * DEG,
    lon: geo.longitude * DEG,
    altKm: geo.height,
    speedKms: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
    world: [ecf.x * SCALE, ecf.z * SCALE, -ecf.y * SCALE],
    look,
  });
}

/** 采样某颗卫星在给定时刻的仰角 */
function elevationAt(rec, jd, gmstMs) {
  const pv = sgp4(rec, (jd - rec.jdsatepoch) * 1440);
  if (!pv || !pv.position) return null;
  const gmst = gstime(new Date(gmstMs));
  const ecf = eciToEcf(pv.position, gmst);
  const sunE = sunEci(gmstMs);
  const cg = Math.cos(gmst);
  const sg = Math.sin(gmst);
  const sun = { x: sunE.x * cg + sunE.y * sg, y: -sunE.x * sg + sunE.y * cg, z: sunE.z };
  return lookAngles(ecf.x, ecf.y, ecf.z, sun);
}

/** 过境预报：从 fromMs 起 hours 小时内，仰角 > minEl 的过境事件 */
function passesFor(index, fromMs, hours, minEl) {
  const s = sats[index];
  if (!s || !s.rec || !observer) return [];
  const rec = s.rec;
  const stepMs = 30000;
  const endMs = fromMs + hours * 3600 * 1000;
  const out = [];
  let inPass = false;
  let aos = 0;
  let maxEl = -90;
  let maxAt = 0;
  let prev = null;

  const sample = (ms) => {
    const jd = jdOf(ms);
    return elevationAt(rec, jd, ms);
  };

  for (let t = fromMs; t <= endMs; t += stepMs) {
    const la = sample(t);
    if (!la) continue;
    if (!inPass && la.el > 0) {
      inPass = true;
      aos = prev && prev.el <= 0 ? refineCross(rec, prev.t, t, -1) : t;
      maxEl = la.el;
      maxAt = t;
    } else if (inPass) {
      if (la.el > maxEl) {
        maxEl = la.el;
        maxAt = t;
      }
      if (la.el <= 0) {
        const los = refineCross(rec, prev.t, t, 1);
        inPass = false;
        if (maxEl >= minEl) {
          const atMax = sample(maxAt);
          out.push({
            aos: Math.round(aos),
            los: Math.round(los),
            maxEl: +maxEl.toFixed(1),
            maxAt: Math.round(maxAt),
            az: atMax ? +atMax.az.toFixed(1) : 0,
            rangeKm: atMax ? Math.round(atMax.range) : 0,
            sunlit: !!(atMax && atMax.sunlit),
            durationSec: Math.max(0, Math.round((los - aos) / 1000)),
            live: aos <= fromMs + 1500,
          });
        }
        if (out.length >= 3) break;
      }
    }
    prev = { t, el: la.el };
  }
  // 扫描结束时仍在过境中
  if (inPass && maxEl >= minEl) {
    const atMax = sample(maxAt);
    out.push({
      aos: Math.round(aos),
      los: null,
      maxEl: +maxEl.toFixed(1),
      maxAt: Math.round(maxAt),
      az: atMax ? +atMax.az.toFixed(1) : 0,
      rangeKm: atMax ? Math.round(atMax.range) : 0,
      sunlit: !!(atMax && atMax.sunlit),
      durationSec: Math.max(0, Math.round((endMs - aos) / 1000)),
      live: true,
    });
  }
  return out;
}

/** 二分细化地平线穿越时刻：dir=-1 上升穿越，dir=1 下降穿越 */
function refineCross(rec, t0, t1, dir) {
  let lo = t0;
  let hi = t1;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    const la = elevationAt(rec, jdOf(mid), mid);
    if (!la) break;
    const above = la.el > 0;
    if ((dir < 0 && above) || (dir > 0 && !above)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function runPasses(msg) {
  const fromMs = msg.fromMs != null ? msg.fromMs : nowMs();
  const hours = msg.hours || 6;
  const minEl = msg.minEl != null ? msg.minEl : 10;
  const indices = (msg.indices || []).slice(0, 80);
  const token = ++passToken;
  const items = [];
  let i = 0;
  const CHUNK = 4;
  function step() {
    if (token !== passToken) return;
    const end = Math.min(i + CHUNK, indices.length);
    for (; i < end; i++) {
      const idx = indices[i];
      const list = passesFor(idx, fromMs, hours, minEl);
      if (list.length) items.push({ index: idx, passes: list });
    }
    if (i < indices.length) setTimeout(step, 0);
    else self.postMessage({ type: 'passes', items, fromMs, hours, minEl });
  }
  step();
}

self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'init':
      init(msg.sats || []);
      break;
    case 'time':
      clock = {
        baseMs: msg.ms != null ? msg.ms : nowMs(),
        baseReal: performance.now(),
        rate: msg.rate != null ? msg.rate : clock.rate,
        paused: !!msg.paused,
      };
      tick();
      break;
    case 'observer':
      setObserver(msg.observer || null);
      tick();
      break;
    case 'detail':
      detail(msg.index, msg.timeMs != null ? msg.timeMs : nowMs());
      break;
    case 'track':
      track(msg.index, msg.samples, msg.groundSamples);
      break;
    case 'batch':
      batchTrack(msg.indices || [], msg.samples);
      break;
    case 'passes':
      runPasses(msg);
      break;
    case 'now':
      tick();
      break;
    default:
      break;
  }
};

// ---------- 轨道与地面轨迹（原有能力） ----------
function track(index, samples = 180, groundSamples = 140) {
  const s = sats[index];
  if (!s || !s.rec) {
    self.postMessage({ type: 'track', index, ok: false });
    return;
  }
  const rec = s.rec;
  const periodMin = (2 * Math.PI) / rec.no;
  if (!isFinite(periodMin) || periodMin <= 0) {
    self.postMessage({ type: 'track', index, ok: false });
    return;
  }
  const ms = nowMs();
  const jd = jdOf(ms);
  const gmst = gstime(new Date(ms));
  const tNow = (jd - rec.jdsatepoch) * 1440;

  const orbit = new Float32Array(samples * 3);
  for (let k = 0; k < samples; k++) {
    const pv = sgp4(rec, tNow + (k / samples) * periodMin);
    if (!pv || !pv.position) {
      orbit[k * 3] = 0;
      continue;
    }
    const ecf = eciToEcf(pv.position, gmst);
    orbit[k * 3] = ecf.x * SCALE;
    orbit[k * 3 + 1] = ecf.z * SCALE;
    orbit[k * 3 + 2] = -ecf.y * SCALE;
  }

  const ground = new Float32Array(groundSamples * 3);
  const spanMin = 100;
  for (let k = 0; k < groundSamples; k++) {
    const t = tNow - spanMin / 2 + (k / (groundSamples - 1)) * spanMin;
    const pv = sgp4(rec, t);
    if (!pv || !pv.position) continue;
    const g = eciToGeodetic(pv.position, gmst);
    const lat = g.latitude;
    const lon = g.longitude;
    const r = WORLD_R * 1.004;
    ground[k * 3] = r * Math.cos(lat) * Math.cos(lon);
    ground[k * 3 + 1] = r * Math.sin(lat);
    ground[k * 3 + 2] = -r * Math.cos(lat) * Math.sin(lon);
  }

  self.postMessage({ type: 'track', index, ok: true, periodMin, orbit, ground }, [orbit.buffer, ground.buffer]);
}

function batchTrack(indices, samples = 84) {
  const out = [];
  const ms = nowMs();
  const jd = jdOf(ms);
  const gmst = gstime(new Date(ms));
  for (const index of indices) {
    const s = sats[index];
    if (!s || !s.rec) continue;
    const rec = s.rec;
    const periodMin = (2 * Math.PI) / rec.no;
    if (!isFinite(periodMin) || periodMin <= 0) continue;
    const tNow = (jd - rec.jdsatepoch) * 1440;
    const pts = new Float32Array(samples * 3);
    let good = true;
    for (let k = 0; k < samples; k++) {
      const pv = sgp4(rec, tNow + (k / samples) * periodMin);
      if (!pv || !pv.position) {
        good = false;
        break;
      }
      const ecf = eciToEcf(pv.position, gmst);
      pts[k * 3] = ecf.x * SCALE;
      pts[k * 3 + 1] = ecf.z * SCALE;
      pts[k * 3 + 2] = -ecf.y * SCALE;
    }
    if (good) out.push({ index, pts });
  }
  self.postMessage({ type: 'batch', items: out });
}
