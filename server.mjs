#!/usr/bin/env node
/**
 * 地球卫星全息镜像 —— 数据服务 (零依赖 ESM)
 *
 *   node server.mjs --port 5180
 *   PORT=5180 node server.mjs
 *
 * 依据 CONTRACT.md §3.1 / §3.2 / §3.3 / §3.4 实现：
 *   - 静态托管 public/（MIME、目录穿越防护、gzip）
 *   - GET /api/catalog  （TLE + SATCAT 合并，6h 磁盘缓存，?force=1 强刷，失败回退旧缓存）
 *   - GET /api/health   （{ok,count,updated,source}）
 * 启动绝不因网络失败而崩溃。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, CATEGORY_DEFS, CATEGORY_ORDER } from './data/classify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'catalog.json');
const CACHE_GZ_FILE = path.join(DATA_DIR, 'catalog.json.gz');
const TLE_FILE = path.join(DATA_DIR, 'tle-active.txt');
const SATCAT_FILE = path.join(DATA_DIR, 'satcat-active.json');

// 数据源（可用环境变量覆盖，便于离线/故障演练）
const TLE_URL = process.env.CATALOG_TLE_URL ||
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const SATCAT_URL = process.env.CATALOG_SATCAT_URL ||
  'https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json';

const TTL_HOURS = Number.isFinite(Number(process.env.CATALOG_TTL_HOURS)) && Number(process.env.CATALOG_TTL_HOURS) > 0
  ? Number(process.env.CATALOG_TTL_HOURS) : 6;
const TTL_MS = TTL_HOURS * 3600_000;
const TOP_OPERATORS_LIMIT = 30;   // 顶层 topOperators[] 保留的运营方数量
const FETCH_TIMEOUT_MS = Number(process.env.CATALOG_FETCH_TIMEOUT_MS) || 40_000;

/* ------------------------------------------------------------------ */
/* 日志                                                                */
/* ------------------------------------------------------------------ */
const t0 = Date.now();
const log = (...a) => console.log('[server]', ...a);
const warn = (...a) => console.warn('[server]', ...a);
const ms = () => (Date.now() - t0) + 'ms';

/* ------------------------------------------------------------------ */
/* §3.4 国家 / 组织映射表（99 个代码，含中文名 / 英文名 / 国旗 / kind）   */
/* ------------------------------------------------------------------ */
// kind: country | org | intergov | other
const COUNTRY_MAP = {
  US:   { name: '美国',           nameEn: 'United States',              flag: '🇺🇸', kind: 'country' },
  PRC:  { name: '中国',           nameEn: 'China',                      flag: '🇨🇳', kind: 'country' },
  UK:   { name: '英国',           nameEn: 'United Kingdom',             flag: '🇬🇧', kind: 'country' },
  CIS:  { name: '俄罗斯/独联体',   nameEn: 'Russia / CIS',               flag: '🇷🇺', kind: 'country' },
  TBD:  { name: '待确认',         nameEn: 'To Be Determined',           flag: '🛰️', kind: 'other'   },
  JPN:  { name: '日本',           nameEn: 'Japan',                      flag: '🇯🇵', kind: 'country' },
  IT:   { name: '意大利',         nameEn: 'Italy',                      flag: '🇮🇹', kind: 'country' },
  SKOR: { name: '韩国',           nameEn: 'South Korea',                flag: '🇰🇷', kind: 'country' },
  FR:   { name: '法国',           nameEn: 'France',                     flag: '🇫🇷', kind: 'country' },
  IND:  { name: '印度',           nameEn: 'India',                      flag: '🇮🇳', kind: 'country' },
  GER:  { name: '德国',           nameEn: 'Germany',                    flag: '🇩🇪', kind: 'country' },
  ESA:  { name: '欧洲空间局',      nameEn: 'European Space Agency',      flag: '🇪🇺', kind: 'intergov' },
  SPN:  { name: '西班牙',         nameEn: 'Spain',                      flag: '🇪🇸', kind: 'country' },
  CA:   { name: '加拿大',         nameEn: 'Canada',                     flag: '🇨🇦', kind: 'country' },
  TURK: { name: '土耳其',         nameEn: 'Turkey',                     flag: '🇹🇷', kind: 'country' },
  SES:  { name: '卢森堡',         nameEn: 'Luxembourg (SES)',           flag: '🇱🇺', kind: 'org'     },
  ITSO: { name: '国际通信卫星组织', nameEn: 'Intelsat',                  flag: '🛰️', kind: 'org'     },
  O3B:  { name: '卢森堡',         nameEn: 'Luxembourg (O3b)',           flag: '🇱🇺', kind: 'org'     },
  AUS:  { name: '澳大利亚',       nameEn: 'Australia',                  flag: '🇦🇺', kind: 'country' },
  FIN:  { name: '芬兰',           nameEn: 'Finland',                    flag: '🇫🇮', kind: 'country' },
  EUTE: { name: '欧洲通信卫星组织', nameEn: 'Eutelsat',                  flag: '🛰️', kind: 'org'     },
  GLOB: { name: '加拿大',         nameEn: 'Canada (Globalstar)',        flag: '🇨🇦', kind: 'org'     },
  ROC:  { name: '中国台湾',       nameEn: 'Taiwan',                     flag: '🇹🇼', kind: 'country' },
  ARGN: { name: '阿根廷',         nameEn: 'Argentina',                  flag: '🇦🇷', kind: 'country' },
  UAE:  { name: '阿联酋',         nameEn: 'United Arab Emirates',       flag: '🇦🇪', kind: 'country' },
  NOR:  { name: '挪威',           nameEn: 'Norway',                     flag: '🇳🇴', kind: 'country' },
  GREC: { name: '希腊',           nameEn: 'Greece',                     flag: '🇬🇷', kind: 'country' },
  ISRA: { name: '以色列',         nameEn: 'Israel',                     flag: '🇮🇱', kind: 'country' },
  SING: { name: '新加坡',         nameEn: 'Singapore',                  flag: '🇸🇬', kind: 'country' },
  POL:  { name: '波兰',           nameEn: 'Poland',                     flag: '🇵🇱', kind: 'country' },
  SAUD: { name: '沙特',           nameEn: 'Saudi Arabia',               flag: '🇸🇦', kind: 'country' },
  ORB:  { name: '美国',           nameEn: 'United States (Orbcomm)',    flag: '🇺🇸', kind: 'org'     },
  BRAZ: { name: '巴西',           nameEn: 'Brazil',                     flag: '🇧🇷', kind: 'country' },
  IM:   { name: '国际海事卫星组织', nameEn: 'Inmarsat',                  flag: '🛰️', kind: 'org'     },
  LUXE: { name: '卢森堡',         nameEn: 'Luxembourg',                 flag: '🇱🇺', kind: 'org'     },
  IRAN: { name: '伊朗',           nameEn: 'Iran',                       flag: '🇮🇷', kind: 'country' },
  POR:  { name: '葡萄牙',         nameEn: 'Portugal',                   flag: '🇵🇹', kind: 'country' },
  BEL:  { name: '比利时',         nameEn: 'Belgium',                    flag: '🇧🇪', kind: 'country' },
  INDO: { name: '印度尼西亚',     nameEn: 'Indonesia',                  flag: '🇮🇩', kind: 'country' },
  EGYP: { name: '埃及',           nameEn: 'Egypt',                      flag: '🇪🇬', kind: 'country' },
  AB:   { name: '亚洲广播卫星',   nameEn: 'Asia Broadcast Satellite',   flag: '🛰️', kind: 'org'     },
  EUME: { name: '欧洲',           nameEn: 'Europe',                     flag: '🇪🇺', kind: 'org'     },
  SWTZ: { name: '瑞士',           nameEn: 'Switzerland',                flag: '🇨🇭', kind: 'country' },
  MALA: { name: '马来西亚',       nameEn: 'Malaysia',                   flag: '🇲🇾', kind: 'country' },
  THAI: { name: '泰国',           nameEn: 'Thailand',                   flag: '🇹🇭', kind: 'country' },
  NETH: { name: '荷兰',           nameEn: 'Netherlands',                flag: '🇳🇱', kind: 'country' },
  RWA:  { name: '卢旺达',         nameEn: 'Rwanda',                     flag: '🇷🇼', kind: 'country' },
  PAKI: { name: '巴基斯坦',       nameEn: 'Pakistan',                   flag: '🇵🇰', kind: 'country' },
  BUL:  { name: '保加利亚',       nameEn: 'Bulgaria',                   flag: '🇧🇬', kind: 'country' },
  ALG:  { name: '阿尔及利亚',     nameEn: 'Algeria',                    flag: '🇩🇿', kind: 'country' },
  DEN:  { name: '丹麦',           nameEn: 'Denmark',                    flag: '🇩🇰', kind: 'country' },
  AC:   { name: '亚洲',           nameEn: 'Asia',                       flag: '🛰️', kind: 'org'     },
  ISS:  { name: '国际空间站',     nameEn: 'International Space Station', flag: '🛰️', kind: 'intergov' },
  KAZ:  { name: '哈萨克斯坦',     nameEn: 'Kazakhstan',                 flag: '🇰🇿', kind: 'country' },
  MEX:  { name: '墨西哥',         nameEn: 'Mexico',                     flag: '🇲🇽', kind: 'country' },
  ABS:  { name: '亚洲广播卫星',   nameEn: 'Asia Broadcast Satellite',   flag: '🛰️', kind: 'org'     },
  BELA: { name: '白俄罗斯',       nameEn: 'Belarus',                    flag: '🇧🇾', kind: 'country' },
  AZER: { name: '阿塞拜疆',       nameEn: 'Azerbaijan',                 flag: '🇦🇿', kind: 'country' },
  MA:   { name: '摩洛哥',         nameEn: 'Morocco',                    flag: '🇲🇦', kind: 'country' },
  HUN:  { name: '匈牙利',         nameEn: 'Hungary',                    flag: '🇭🇺', kind: 'country' },
  VTNM: { name: '越南',           nameEn: 'Vietnam',                    flag: '🇻🇳', kind: 'country' },
  NIG:  { name: '尼日利亚',       nameEn: 'Nigeria',                    flag: '🇳🇬', kind: 'country' },
  CZCH: { name: '捷克',           nameEn: 'Czechia',                    flag: '🇨🇿', kind: 'country' },
  ASRA: { name: '亚洲卫星',       nameEn: 'AsiaSat',                    flag: '🛰️', kind: 'org'     },
  SWED: { name: '瑞典',           nameEn: 'Sweden',                     flag: '🇸🇪', kind: 'country' },
  SVN:  { name: '斯洛文尼亚',     nameEn: 'Slovenia',                   flag: '🇸🇮', kind: 'country' },
  SVK:  { name: '斯洛伐克',       nameEn: 'Slovakia',                   flag: '🇸🇰', kind: 'country' },
  KWT:  { name: '科威特',         nameEn: 'Kuwait',                     flag: '🇰🇼', kind: 'country' },
  RP:   { name: '菲律宾',         nameEn: 'Philippines',                flag: '🇵🇭', kind: 'country' },
  LTU:  { name: '立陶宛',         nameEn: 'Lithuania',                  flag: '🇱🇹', kind: 'country' },
  UKR:  { name: '乌克兰',         nameEn: 'Ukraine',                    flag: '🇺🇦', kind: 'country' },
  CHLE: { name: '智利',           nameEn: 'Chile',                      flag: '🇨🇱', kind: 'country' },
  CHBZ: { name: '中国',           nameEn: 'China (CBERS / Brazil)',     flag: '🇨🇳', kind: 'country' },
  VENZ: { name: '委内瑞拉',       nameEn: 'Venezuela',                  flag: '🇻🇪', kind: 'country' },
  SAFR: { name: '南非',           nameEn: 'South Africa',               flag: '🇿🇦', kind: 'country' },
  FRIT: { name: '法国',           nameEn: 'France',                     flag: '🇫🇷', kind: 'country' },
  ECU:  { name: '厄瓜多尔',       nameEn: 'Ecuador',                    flag: '🇪🇨', kind: 'country' },
  ROM:  { name: '罗马尼亚',       nameEn: 'Romania',                    flag: '🇷🇴', kind: 'country' },
  NICO: { name: '荷兰',           nameEn: 'Netherlands',                flag: '🇳🇱', kind: 'country' },
  RASC: { name: '俄罗斯',         nameEn: 'Russia',                     flag: '🇷🇺', kind: 'country' },
  DJI:  { name: '吉布提',         nameEn: 'Djibouti',                   flag: '🇩🇯', kind: 'country' },
  STCT: { name: '中国香港',       nameEn: 'Hong Kong SAR',              flag: '🇭🇰', kind: 'country' },
  SLB:  { name: '所罗门群岛',     nameEn: 'Solomon Islands',            flag: '🇸🇧', kind: 'country' },
  BHR:  { name: '巴林',           nameEn: 'Bahrain',                    flag: '🇧🇭', kind: 'country' },
  BWA:  { name: '博茨瓦纳',       nameEn: 'Botswana',                   flag: '🇧🇼', kind: 'country' },
  MNE:  { name: '黑山',           nameEn: 'Montenegro',                 flag: '🇲🇪', kind: 'country' },
  HRV:  { name: '克罗地亚',       nameEn: 'Croatia',                    flag: '🇭🇷', kind: 'country' },
  NZ:   { name: '新西兰',         nameEn: 'New Zealand',                flag: '🇳🇿', kind: 'country' },
  JOR:  { name: '约旦',           nameEn: 'Jordan',                     flag: '🇯🇴', kind: 'country' },
  GRSA: { name: '沙特',           nameEn: 'Saudi Arabia',               flag: '🇸🇦', kind: 'country' },
  TMMC: { name: '中国',           nameEn: 'China',                      flag: '🇨🇳', kind: 'country' },
  PERU: { name: '秘鲁',           nameEn: 'Peru',                       flag: '🇵🇪', kind: 'country' },
  LAOS: { name: '老挝',           nameEn: 'Laos',                       flag: '🇱🇦', kind: 'country' },
  ETH:  { name: '埃塞俄比亚',     nameEn: 'Ethiopia',                   flag: '🇪🇹', kind: 'country' },
  BGD:  { name: '孟加拉国',       nameEn: 'Bangladesh',                 flag: '🇧🇩', kind: 'country' },
  NKOR: { name: '朝鲜',           nameEn: 'North Korea',                flag: '🇰🇵', kind: 'country' },
  BOL:  { name: '玻利维亚',       nameEn: 'Bolivia',                    flag: '🇧🇴', kind: 'country' },
  IRAQ: { name: '伊拉克',         nameEn: 'Iraq',                       flag: '🇮🇶', kind: 'country' },
  ANG:  { name: '安哥拉',         nameEn: 'Angola',                     flag: '🇦🇴', kind: 'country' },
};

/** OWNER 原始值 → 归一化国家条目（未列出的代码按契约生成 "其他(X)"） */
function countryInfo(code) {
  const key = String(code == null ? '' : code).trim();
  const hit = COUNTRY_MAP[key];
  if (hit) return { code: key, name: hit.name, nameEn: hit.nameEn, flag: hit.flag, kind: hit.kind };
  const raw = key || 'UNK';
  return { code: raw, name: '其他(' + raw + ')', nameEn: raw, flag: '🛰️', kind: 'other' };
}

/* ------------------------------------------------------------------ */
/* §3.3 轨道分类                                                       */
/* ------------------------------------------------------------------ */
function classifyOrbit(period, apogee) {
  if (period == null || !Number.isFinite(period) || period <= 0) return 'OTHER';
  if (period >= 1400 && period <= 1470) return 'GEO';
  if (apogee != null && Number.isFinite(apogee) && apogee < 2000) return 'LEO';
  if (apogee != null && Number.isFinite(apogee) && apogee < 34000) return 'MEO';
  return 'HEO';
}

/* ------------------------------------------------------------------ */
/* TLE / SATCAT 解析                                                   */
/* ------------------------------------------------------------------ */
const BOM = 0xfeff;
function stripBom(text) {
  if (typeof text !== 'string') return '';
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}
const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 跳过 I / O
function parseNoradField(field) {
  if (!field) return null;
  const s = String(field).trim();
  if (!s) return null;
  if (/^\d{1,6}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (/^[A-Z]\d{4}$/.test(s)) {               // Alpha-5 编码
    const idx = ALPHA5.indexOf(s[0]);
    if (idx < 0) return null;
    return (idx + 10) * 10000 + Number(s.slice(1));
  }
  return null;
}

/** 名称 / TLE1 / TLE2 三行一组；容错：空行、残行、缺名、重复 NORAD。 */
function parseTleText(text) {
  const lines = stripBom(String(text || '')).split(/\r?\n/);
  const records = [];
  const seen = new Set();
  let duplicates = 0;
  let malformed = 0;
  let pendingName = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine == null) continue;
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const isL1 = line.startsWith('1 ');
    const isL2 = line.startsWith('2 ');

    if (isL1) {
      const next = lines[i + 1] == null ? '' : lines[i + 1];
      if (!next.replace(/\s+$/, '').startsWith('2 ')) { malformed++; continue; }
      const tle1 = line.trim();
      const tle2 = next.trim();
      if (tle1.length < 60 || tle2.length < 60) { malformed++; i++; continue; }
      const id = parseNoradField(tle1.slice(2, 7)) ?? parseNoradField(tle2.slice(2, 7));
      if (id == null) { malformed++; i++; continue; }
      i++;
      if (seen.has(id)) { duplicates++; pendingName = ''; continue; }
      seen.add(id);
      const name = (pendingName || '').trim() || ('OBJECT ' + id);
      records.push({ id, name, tle1, tle2 });
      pendingName = '';
      continue;
    }
    if (isL2) { malformed++; continue; }       // 孤立的第 2 行
    pendingName = line;                        // 名称行（可能含 UTF-8 / 前缀 0 ）
  }
  return { records, duplicates, malformed };
}

/** 从 TLE2 推算 period / incl / apogee / perigee（仅当 SATCAT 缺字段时兜底） */
function deriveFromTle2(tle2) {
  const out = { period: null, incl: null, apogee: null, perigee: null };
  try {
    const incl = parseFloat(tle2.slice(8, 16));
    if (Number.isFinite(incl)) out.incl = incl;
    const eccField = tle2.slice(26, 33).trim();
    const ecc = Number('0.' + (eccField || '0'));
    const mm = parseFloat(tle2.slice(52, 63));
    if (Number.isFinite(mm) && mm > 0) {
      const period = 1440 / mm;
      out.period = period;
      const n = (mm * 2 * Math.PI) / 86400;              // rad/s
      const aKm = Math.cbrt(398600.4418 / (n * n));      // km
      if (Number.isFinite(ecc) && Number.isFinite(aKm)) {
        out.apogee = aKm * (1 + ecc) - 6378.137;
        out.perigee = aKm * (1 - ecc) - 6378.137;
      }
    }
  } catch { /* 纯兜底，失败即忽略 */ }
  return out;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
function str(v, fallback = '') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s || fallback;
}
const round = (v, d = 0) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);

/** SATCAT JSON → Map<NORAD, record>，容错 BOM / 包装对象 / 脏行 */
function parseSatcatJson(text) {
  const clean = stripBom(String(text || '')).trim();
  if (!clean) return new Map();
  let data;
  try { data = JSON.parse(clean); }
  catch (err) {
    // 兼容非法结尾逗号等轻微脏数据
    const repaired = clean.replace(/,\s*([\]}])/g, '$1');
    data = JSON.parse(repaired);
  }
  let list = data;
  if (!Array.isArray(list)) list = data && Array.isArray(data.records) ? data.records : [];
  const map = new Map();
  for (const rec of list) {
    if (!rec || typeof rec !== 'object') continue;
    const id = numOrNull(rec.NORAD_CAT_ID);
    if (id == null) continue;
    if (!map.has(id)) map.set(id, rec);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* §3.2 合并                                                           */
/* ------------------------------------------------------------------ */
function buildCatalog(tleText, satcatText) {
  const { records, duplicates, malformed } = parseTleText(tleText);
  const satMap = parseSatcatJson(satcatText);

  const satellites = [];
  const counts = new Map();
  let noSatcat = 0;

  for (const rec of records) {
    const s = satMap.get(rec.id) || null;
    if (!s) noSatcat++;

    const owner = s ? str(s.OWNER, 'UNK') : 'UNK';
    const info = countryInfo(owner);
    // 仅当 SATCAT 缺任一轨道要素时才用 TLE2 推算（V1.1 修正：原先只看 PERIOD，导致 8 颗 GEO 的 incl 为 null）
    const needDerive = !s || numOrNull(s.PERIOD) == null || numOrNull(s.INCLINATION) == null ||
      numOrNull(s.APOGEE) == null || numOrNull(s.PERIGEE) == null;
    const derived = needDerive ? deriveFromTle2(rec.tle2) : null;

    const period = s ? (numOrNull(s.PERIOD) ?? (derived ? derived.period : null)) : (derived ? derived.period : null);
    const incl = s ? (numOrNull(s.INCLINATION) ?? (derived ? derived.incl : null)) : (derived ? derived.incl : null);
    const apogee = s ? (numOrNull(s.APOGEE) ?? (derived ? derived.apogee : null)) : (derived ? derived.apogee : null);
    const perigee = s ? (numOrNull(s.PERIGEE) ?? (derived ? derived.perigee : null)) : (derived ? derived.perigee : null);
    const periodR = round(period, 2);
    const apogeeR = round(apogee, 0);

    const objectType = s ? str(s.OBJECT_TYPE, 'UNK').toUpperCase() : 'UNK';
    const sat = {
      id: rec.id,
      name: rec.name || (s ? str(s.OBJECT_NAME, 'OBJECT ' + rec.id) : 'OBJECT ' + rec.id),
      intl: s ? str(s.OBJECT_ID, '') : '',
      owner,
      country: info.code,
      objectType: ['PAY', 'R/B', 'DEB'].includes(objectType) ? objectType : (objectType === 'UNK' ? 'UNK' : objectType),
      status: s ? str(s.OPS_STATUS_CODE, '') : '',
      launchDate: s ? str(s.LAUNCH_DATE, '') : '',
      orbitClass: classifyOrbit(periodR, apogeeR),
      period: periodR,
      incl: round(incl, 2),
      apogee: apogeeR,
      perigee: round(perigee, 0),
      tle1: rec.tle1,
      tle2: rec.tle2,
    };
    // V2 §7：运营方 + 任务类型（V1 字段保持不变，新增字段追加在后）
    Object.assign(sat, classify(sat));

    satellites.push(sat);
    counts.set(sat.country, (counts.get(sat.country) || 0) + 1);
  }

  const countries = [];
  for (const [code, count] of counts) {
    const info = countryInfo(code);
    countries.push({ code, name: info.name, nameEn: info.nameEn, flag: info.flag, kind: info.kind, count });
  }
  countries.sort((a, b) => (b.count - a.count) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  // —— V2 顶层汇总：categories（8 类固定顺序） + topOperators ——
  const categoryCounts = new Map();
  const operatorAgg = new Map();
  for (const s of satellites) {
    categoryCounts.set(s.category, (categoryCounts.get(s.category) || 0) + 1);
    let e = operatorAgg.get(s.operator);
    if (!e) {
      e = { name: s.operator, nameZh: s.operatorZh, kind: s.operatorKind, count: 0 };
      operatorAgg.set(s.operator, e);
    }
    e.count++;
  }
  const categories = CATEGORY_ORDER.map((k) => ({
    key: k,
    label: CATEGORY_DEFS[k].label,
    labelEn: CATEGORY_DEFS[k].labelEn,
    count: categoryCounts.get(k) || 0,
  }));
  const topOperators = [...operatorAgg.values()]
    .sort((a, b) => (b.count - a.count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, TOP_OPERATORS_LIMIT);

  return { satellites, countries, categories, topOperators, duplicates, malformed, noSatcat };
}

/* ------------------------------------------------------------------ */
/* 状态 / 缓存                                                          */
/* ------------------------------------------------------------------ */
const state = {
  ready: false,
  catalog: null,        // 内存目录对象（source 反映本次进程的来源）
  raw: null,            // Buffer：/api/catalog 响应体
  gz: null,             // Buffer：gzip 后的响应体
  updated: null,        // ISO
  source: 'none',
  error: null,
  initPromise: null,
  refreshing: null,
};

function serialize(catalog) {
  const raw = Buffer.from(JSON.stringify(catalog), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 6 });
  return { raw, gz };
}

async function writeCacheFile(catalog) {
  // 磁盘缓存里的 source 固定记为 "cache"（它本身就是缓存），进程内仍保留真实来源。
  const diskCatalog = { ...catalog, source: 'cache' };
  const { raw, gz } = serialize(diskCatalog);
  const tmp = CACHE_FILE + '.' + process.pid + '.tmp';
  const tmpGz = CACHE_GZ_FILE + '.' + process.pid + '.tmp';
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(tmp, raw);
  await fsp.writeFile(tmpGz, gz);
  await fsp.rename(tmp, CACHE_FILE);
  await fsp.rename(tmpGz, CACHE_GZ_FILE);
  return { rawBytes: raw.length, gzBytes: gz.length };
}

/** 载入磁盘缓存；返回 { catalog, ageMs } 或 null。 */
async function readCacheFile() {
  let st;
  try { st = await fsp.stat(CACHE_FILE); } catch { return null; }
  let text;
  try { text = await fsp.readFile(CACHE_FILE, 'utf8'); } catch (err) { warn('读取缓存失败:', err.message); return null; }
  let obj;
  try { obj = JSON.parse(stripBom(text)); } catch (err) { warn('缓存 JSON 损坏，忽略:', err.message); return null; }
  if (!obj || !Array.isArray(obj.satellites) || !Array.isArray(obj.countries)) { warn('缓存结构不合法，忽略'); return null; }
  const updatedMs = Date.parse(obj.updated);
  const ageMs = Number.isFinite(updatedMs) ? Date.now() - updatedMs : Infinity;
  return { catalog: obj, ageMs, mtimeMs: st.mtimeMs };
}

function adoptCatalog(catalog, source, opts = {}) {
  const served = { ...catalog, source, count: catalog.satellites.length };
  const { raw, gz } = serialize(served);
  state.catalog = served;
  state.raw = raw;
  state.gz = gz;
  state.updated = served.updated;
  state.source = source;
  state.error = null;
  state.ready = true;
  log('目录就绪: source=' + source +
    ' 卫星=' + served.count +
    ' 国家/组织=' + served.countries.length +
    ' raw=' + (raw.length / 1048576).toFixed(2) + 'MB' +
    ' gzip=' + (gz.length / 1048576).toFixed(2) + 'MB' +
    ' 耗时=' + ms());
  return served;
}

/* ------------------------------------------------------------------ */
/* 抓取                                                                */
/* ------------------------------------------------------------------ */
async function fetchText(url, what) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'orbit-holo/1.0 (+zero-dep data service)', accept: '*/*' },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const err = new Error('HTTP ' + res.status + ' ' + res.statusText +
        (bodyText ? ' — ' + bodyText.replace(/\s+/g, ' ').trim().slice(0, 200) : ''));
      err.status = res.status;
      err.bodyText = bodyText;
      // CelesTrak 的"数据自上次下载后未更新"会以 403 + 说明文本返回，这不是故障。
      err.notModified = /has not updated since your last successful\s+download/i.test(bodyText);
      throw err;
    }
    const text = await res.text();
    if (!text || text.length < 32) throw new Error('响应过短 (' + (text ? text.length : 0) + ' bytes)');
    log('抓取 ' + what + ' 成功: ' + text.length + ' 字节 / ' + (Date.now() - started) + 'ms');
    return text;
  } catch (err) {
    if (err && !err.status && err.cause) {
      err.message = err.message + ' (' + (err.cause.code || err.cause.message || String(err.cause)) + ')';
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readLocalFile(file) {
  try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
}

async function refreshFromNetwork(reason) {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    const started = Date.now();
    log('开始联网抓取 (' + reason + ') ...');
    try {
      // 两路独立抓取：任意一路失败都不应让整次刷新失败（可用本地最新文件补齐）
      const [tleRes, satcatRes] = await Promise.allSettled([
        fetchText(TLE_URL, 'TLE'),
        fetchText(SATCAT_URL, 'SATCAT'),
      ]);

      let tleText = tleRes.status === 'fulfilled' ? tleRes.value : null;
      let satcatText = satcatRes.status === 'fulfilled' ? satcatRes.value : null;
      const freshTle = !!tleText;
      const freshSatcat = !!satcatText;

      // §3.1：整次刷新失败（两路都拿不到）且已有旧缓存 → 回退旧缓存，source 保持 cache
      if (!tleText && !satcatText && state.catalog) {
        warn('TLE 与 SATCAT 均抓取失败 → 回退到旧缓存 (source=' + state.source + ', 卫星=' + state.catalog.count + ')');
        return state.catalog;
      }

      if (!tleText) {
        const e = tleRes.reason || {};
        if (e.notModified) log('CelesTrak TLE 未更新（' + (e.status || '') + '：数据自上次下载后无变化），沿用本地最新 TLE');
        else warn('TLE 抓取失败: ' + (e.message || e));
        tleText = await readLocalFile(TLE_FILE);
        if (tleText) log('TLE 回退到本地文件 data/tle-active.txt (' + tleText.length + ' 字节)');
      }
      if (!satcatText) {
        const e = satcatRes.reason || {};
        if (e.notModified) log('CelesTrak SATCAT 未更新，沿用本地 SATCAT');
        else warn('SATCAT 抓取失败: ' + (e.message || e));
        satcatText = await readLocalFile(SATCAT_FILE);
        if (satcatText) log('SATCAT 回退到本地文件 data/satcat-active.json (' + satcatText.length + ' 字节)');
      }
      if (!tleText || !satcatText) {
        throw new Error('TLE 与 SATCAT 均无可用数据源（网络失败且本地文件缺失）');
      }

      const built = buildCatalog(tleText, satcatText);
      if (!built.satellites.length) throw new Error('合并结果为空');
      const catalog = {
        ok: true,
        updated: new Date().toISOString(),
        source: 'celestrak',
        count: built.satellites.length,
        countries: built.countries,
        satellites: built.satellites,
        categories: built.categories,
        topOperators: built.topOperators,
      };
      const source = freshTle && freshSatcat ? 'celestrak' : 'local';
      catalog.source = source;
      const wrote = await writeCacheFile(catalog).catch(err => { warn('写缓存失败:', err.message); return null; });
      adoptCatalog(catalog, source);
      log('刷新完成: source=' + source + ' 卫星=' + catalog.count + ' 国家=' + catalog.countries.length +
        ' TLE=' + (freshTle ? '网络' : '本地') + ' SATCAT=' + (freshSatcat ? '网络' : '本地') +
        ' 抓取+合并+落盘=' + (Date.now() - started) + 'ms' +
        (wrote ? ' 磁盘=' + (wrote.rawBytes / 1048576).toFixed(2) + 'MB / gz=' + (wrote.gzBytes / 1048576).toFixed(2) + 'MB' : ''));
      return state.catalog;
    } catch (err) {
      warn('联网刷新失败: ' + (err && err.message ? err.message : err));
      if (!state.catalog) {
        state.error = '数据不可用: ' + (err && err.message ? err.message : String(err));
        warn('当前无可用缓存 → /api/catalog 将返回 503');
      } else {
        log('已回退到旧缓存 (source=cache, 卫星=' + state.catalog.count + ')');
      }
      return state.catalog;
    } finally {
      state.refreshing = null;
    }
  })();
  return state.refreshing;
}

/** 启动初始化：缓存 → 本地原始文件 → 联网。任何失败都只记警告。 */
async function initData() {
  const cache = await readCacheFile();
  if (cache) {
    adoptCatalog(cache.catalog, 'cache');
    const ageH = cache.ageMs === Infinity ? '未知' : (cache.ageMs / 3600000).toFixed(2) + 'h';
    log('使用磁盘缓存 catalog.json (age=' + ageH + ', TTL=' + TTL_HOURS + 'h)');
    if (cache.ageMs > TTL_MS) {
      log('缓存已过期，后台刷新（不阻塞启动/响应）');
      refreshFromNetwork('缓存过期').catch(() => {});
    }
    return;
  }

  // 本地原始数据合成
  try {
    const [tleText, satcatText] = await Promise.all([
      fsp.readFile(TLE_FILE, 'utf8'),
      fsp.readFile(SATCAT_FILE, 'utf8'),
    ]);
    const built = buildCatalog(tleText, satcatText);
    if (!built.satellites.length) throw new Error('本地文件合并结果为空');
    const catalog = {
      ok: true,
      updated: new Date().toISOString(),
      source: 'local',
      count: built.satellites.length,
      countries: built.countries,
      satellites: built.satellites,
      categories: built.categories,
      topOperators: built.topOperators,
    };
    log('本地合成完成: TLE 记录=' + built.satellites.length +
      ' 重复 NORAD=' + built.duplicates + ' 残行=' + built.malformed +
      ' 无SATCAT=' + built.noSatcat);
    await writeCacheFile(catalog).catch(err => warn('写缓存失败:', err.message));
    adoptCatalog(catalog, 'local');
    return;
  } catch (err) {
    log('本地原始数据不可用: ' + (err && err.message ? err.message : err));
  }

  try {
    const r = await refreshFromNetwork('首次启动无缓存');
    if (r) return;
  } catch { /* refresh 内部已处理 */ }
  if (!state.ready) {
    state.ready = true;
    if (!state.error) state.error = '暂无可用卫星数据（网络与本地数据源均不可用）';
  }
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.hdr': 'application/octet-stream',
};
const TEXTUAL = new Set(['.html', '.htm', '.js', '.mjs', '.json', '.map', '.css', '.txt', '.svg', '.gltf']);
const GZ_TEXT_CACHE = new Map(); // absPath|mtime|size → gzip Buffer

function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }
const acceptsGzip = (req) => /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendText(res, 400, '400 Bad Request'); }
  if (decoded.includes('\0')) return sendText(res, 400, '400 Bad Request');

  let rel = decoded === '/' ? '/index.html' : decoded;
  if (!rel.startsWith('/')) rel = '/' + rel;
  const abs = path.resolve(PUBLIC_DIR, '.' + rel);
  const relFromPublic = path.relative(PUBLIC_DIR, abs);

  // 目录穿越 / 越界访问防护
  if (relFromPublic.startsWith('..') || path.isAbsolute(relFromPublic)) {
    log('拒绝越界访问: ' + JSON.stringify(decoded));
    return sendText(res, 403, '403 Forbidden');
  }
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, '403 Forbidden');
  }

  let st;
  try {
    st = await fsp.stat(abs);
    if (st.isDirectory()) {
      const idx = path.join(abs, 'index.html');
      st = await fsp.stat(idx);
      return sendFile(req, res, idx, st);
    }
  } catch {
    return sendText(res, 404, '404 Not Found');
  }
  return sendFile(req, res, abs, st);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

async function sendFile(req, res, abs, st) {
  const ext = path.extname(abs).toLowerCase();
  const headers = {
    'Content-Type': mimeFor(abs),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
  };
  const useGzip = acceptsGzip(req) && TEXTUAL.has(ext) && st.size > 1024;
  if (useGzip) {
    const key = abs + '|' + st.mtimeMs + '|' + st.size;
    let gz = GZ_TEXT_CACHE.get(key);
    if (!gz) {
      try {
        gz = zlib.gzipSync(await fsp.readFile(abs), { level: 6 });
        if (GZ_TEXT_CACHE.size > 64) GZ_TEXT_CACHE.clear();
        GZ_TEXT_CACHE.set(key, gz);
      } catch {
        return sendText(res, 500, '500 Internal Server Error');
      }
    }
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
function sendCatalog(req, res) {
  if (!state.ready) {
    return sendJson(res, 503, { ok: false, error: '数据尚未就绪，请稍候重试', source: 'none', count: 0, updated: null });
  }
  if (!state.catalog) {
    return sendJson(res, 503, { ok: false, error: state.error || '暂无可用卫星数据', source: 'none', count: 0, updated: null });
  }
  const gz = acceptsGzip(req);
  const body = gz ? state.gz : state.raw;
  res.__src = state.source;
  res.__mode = 'cache-hit';
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
    'X-Data-Source': state.source,
    'X-Data-Count': String(state.catalog.count),
    'X-Data-Updated': state.updated || '',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendHealth(res, req) {
  const payload = {
    ok: !!state.catalog,
    count: state.catalog ? state.catalog.count : 0,
    updated: state.updated,
    source: state.source,
  };
  if (!state.catalog) payload.error = state.error || '数据尚未就绪';
  sendJson(res, state.catalog ? 200 : 503, payload);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
const startedAt = Date.now();
let requestSeq = 0;

async function handle(req, res) {
  const seq = ++requestSeq;
  const begin = process.hrtime.bigint();
  const rawUrl = req.url || '/';
  let url;
  try { url = new URL(rawUrl, 'http://' + (req.headers.host || 'localhost')); }
  catch { return sendText(res, 400, '400 Bad Request'); }
  const pathname = url.pathname;

  res.on('finish', () => {
    if (!pathname.startsWith('/api/')) return;
    const durMs = Number(process.hrtime.bigint() - begin) / 1e6;
    log('#' + seq + ' ' + req.method + ' ' + rawUrl + ' → ' + res.statusCode +
      ' ' + durMs.toFixed(1) + 'ms' +
      (res.getHeader('Content-Encoding') ? ' [gzip]' : '') +
      ' [source=' + (res.__src || 'none') + (res.__mode ? ', ' + res.__mode : '') + ']');
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, '405 Method Not Allowed');
  }

  // ---- /api/health ----
  if (pathname === '/api/health') {
    await state.initPromise;
    return sendHealth(res, req);
  }

  // ---- /api/catalog ----
  if (pathname === '/api/catalog') {
    await state.initPromise;
    const force = ['1', 'true', 'yes'].includes(String(url.searchParams.get('force') || '').toLowerCase());
    const ageMs = state.updated ? Date.now() - Date.parse(state.updated) : Infinity;

    if (force) {
      log('收到 force=1 强制刷新请求');
      const before = state.updated;
      await refreshFromNetwork('force=1');
      if (state.updated === before && state.catalog) log('强制刷新未取得新数据，回退旧缓存 (source=' + state.source + ')');
    } else if (state.catalog && ageMs > TTL_MS && !state.refreshing) {
      // 过期：先返回当前缓存，后台刷新
      refreshFromNetwork('TTL 过期(请求触发)').catch(() => {});
    }
    return sendCatalog(req, res);
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, error: '未知接口: ' + pathname });
  }

  return serveStatic(req, res, pathname);
}

/* ------------------------------------------------------------------ */
/* 导出（便于离线单测；以脚本方式运行时仍会自启动）                       */
/* ------------------------------------------------------------------ */
export { buildCatalog, classifyOrbit, parseTleText, parseSatcatJson, countryInfo, COUNTRY_MAP };

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = argv[++i];
    else if (a.startsWith('--port=')) out.port = a.slice('--port='.length);
    else if (a === '--host') out.host = argv[++i];
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port ?? process.env.PORT ?? 5180);
const HOST = args.host ?? process.env.HOST ?? '';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[server] 端口非法: ' + (args.port ?? process.env.PORT));
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    warn('请求处理异常 ' + (req.url || '') + ': ' + (err && err.stack ? err.stack : err));
    if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
    else res.destroy();
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('[server] 端口 ' + PORT + ' 已被占用，请换端口：node server.mjs --port 5181');
    process.exit(1);
  }
  warn('服务器错误: ' + (err && err.message ? err.message : err));
});

// 先监听（立即可用），数据初始化在后台进行；请求会 await initPromise。
function startServer() {
  state.initPromise = initData().catch((err) => {
    warn('数据初始化异常: ' + (err && err.message ? err.message : err));
    state.error = '数据初始化失败: ' + (err && err.message ? err.message : String(err));
    state.ready = true;
  });

  server.listen(PORT, HOST || undefined, () => {
    const addr = server.address();
    const shownPort = addr && typeof addr === 'object' ? addr.port : PORT;
    log('地球卫星全息镜像 · 数据服务已启动');
    log('监听 http://127.0.0.1:' + shownPort + '/  (public: ' + PUBLIC_DIR + ')');
    log('接口: GET /api/catalog  |  GET /api/health  |  static /');
    log('TTL=' + TTL_HOURS + 'h  缓存文件=' + CACHE_FILE);
  });
}

function shutdown(sig) {
  log('收到 ' + sig + '，关闭服务器 (运行 ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's, 请求 ' + requestSeq + ' 个)');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => warn('未处理的 Promise 拒绝: ' + (e && e.message ? e.message : e)));
process.on('uncaughtException', (e) => warn('未捕获异常: ' + (e && e.stack ? e.stack : e)));

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return true;
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  } catch { return true; }
})();
if (isMainModule) startServer();
