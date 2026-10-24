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
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { classify, detectTelescope, detectStation, CATEGORY_DEFS, CATEGORY_ORDER, SUBCATEGORY_DEFS } from './data/classify.mjs';

const gzipAsync = promisify(zlib.gzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'catalog.json');
const CACHE_GZ_FILE = path.join(DATA_DIR, 'catalog.json.gz');
const TLE_FILE = path.join(DATA_DIR, 'tle-active.txt');
const SATCAT_FILE = path.join(DATA_DIR, 'satcat-active.json');
const SATCAT_CSV_FILE = path.join(DATA_DIR, 'satcat-full.csv');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');

// ── V8 §32：Space-Track 数据源 ─────────────────────────────────────────
const SPACETRACK_ENV_FILE = path.join(DATA_DIR, '.spacetrack.env');   // 凭据文件（只在内存读取，绝不写日志/输出）
const SPACETRACK_GP_FILE = path.join(DATA_DIR, 'spacetrack-gp.3le');  // GP 3LE 落盘（冷启动/断网复用）
const SPACETRACK_LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const SPACETRACK_GP_URL = 'https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/orderby/norad_cat_id/format/3le';
const SPACETRACK_TIMEOUT_MS = Number(process.env.CATALOG_ST_TIMEOUT_MS) > 0
  ? Number(process.env.CATALOG_ST_TIMEOUT_MS) : 120_000;
const SPACETRACK_MIN_GAP_MS = 5_000;      // §32.6：失败重试间隔 ≥5s
const SPACETRACK_MAX_RETRY = 1;           // §32.6：失败最多重试 1 次
const SPACETRACK_RATE_LIMIT = 18;         // §32.6：Space-Track 约 20 次/分钟，留余量
const CATALOG_SOURCE = String(process.env.CATALOG_SOURCE || '').toLowerCase();  // '' | 'spacetrack' | 'celestrak'

/** 凭据只存在内存里，永不进日志 / JSON / health */
let SPACETRACK_CREDS = null;
let SPACETRACK_LAST_ERR = '';             // 仅保存脱敏后的原因，供日志
const SPACETRACK_REQ_TIMES = [];          // 最近请求时间戳（限速用）

/** 把可能混入日志的账号/密码替换掉 */
function redact(text) {
  let s = String(text == null ? '' : text);
  if (SPACETRACK_CREDS) {
    if (SPACETRACK_CREDS.user) s = s.split(SPACETRACK_CREDS.user).join('[redacted]');
    if (SPACETRACK_CREDS.pass) s = s.split(SPACETRACK_CREDS.pass).join('[redacted]');
  }
  return s;
}

// ── V5 §20.1 多分组 TLE（按 NORAD 合并去重；单组失败只跳过该组）────────
const GROUP_DEFS = [
  { key: 'active',             file: 'tle-active.txt' },
  { key: 'fengyun-1c-debris',  file: 'groups/fengyun-1c-debris.txt' },
  { key: 'cosmos-2251-debris', file: 'groups/cosmos-2251-debris.txt' },
  { key: 'iridium-33-debris',  file: 'groups/iridium-33-debris.txt' },
  { key: 'cosmos-1408-debris', file: 'groups/cosmos-1408-debris.txt' },
  { key: 'science',            file: 'groups/science.txt' },
  { key: 'stations',           file: 'groups/stations.txt' },
  { key: 'amateur',            file: 'groups/amateur.txt' },
];
const groupUrl = (key) => 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + key + '&FORMAT=tle';
/** 分组的实际 URL：支持 CATALOG_TLE_URL_<GROUP> 单组覆盖，也支持 CATALOG_TLE_URL 全体覆盖（断网演练） */
function resolveGroupUrl(key) {
  const perGroup = process.env['CATALOG_TLE_URL_' + key.toUpperCase().replace(/-/g, '_')];
  return perGroup || process.env.CATALOG_TLE_URL || groupUrl(key);
}

// 数据源（可用环境变量覆盖，便于离线/故障演练）
const TLE_URL = process.env.CATALOG_TLE_URL ||
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
// §20.2：SATCAT 全量 CSV（含 OBJECT_TYPE / RCS / DECAY_DATE）；records.php 作为回退
const SATCAT_CSV_URL = process.env.CATALOG_SATCAT_CSV_URL || 'https://celestrak.org/pub/satcat.csv';
const SATCAT_URL = process.env.CATALOG_SATCAT_URL ||
  'https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json';
const CSV_TIMEOUT_MS = Number(process.env.CATALOG_CSV_TIMEOUT_MS) > 0
  ? Number(process.env.CATALOG_CSV_TIMEOUT_MS) : 120_000;   // 6.7MB CSV，实测 ~58s

const TTL_HOURS = Number.isFinite(Number(process.env.CATALOG_TTL_HOURS)) && Number(process.env.CATALOG_TTL_HOURS) > 0
  ? Number(process.env.CATALOG_TTL_HOURS) : 6;
const TTL_MS = TTL_HOURS * 3600_000;
const TOP_OPERATORS_LIMIT = 30;   // 顶层 topOperators[] 保留的运营方数量

/* ---- CONTRACT-V4 §16 加固相关配置 ---------------------------------- */
// 提前解析命令行参数（函数声明会提升），供 CORS / 监听地址等使用
const ARGS = parseArgs(process.argv.slice(2));
const PORT = Number(ARGS.port ?? process.env.PORT ?? 5180);
const HOST = ARGS.host ?? process.env.HOST ?? '127.0.0.1';   // §16.1 默认只听本地
const CORS_ENABLED = ARGS.cors === true || /^(1|true|yes)$/i.test(String(process.env.CORS || ''));  // §16.2 默认不发 ACAO

const FETCH_TIMEOUT_MS = Number(process.env.CATALOG_FETCH_TIMEOUT_MS) > 0
  ? Number(process.env.CATALOG_FETCH_TIMEOUT_MS) : 20_000;                 // §16.5 默认 20s
const MAX_BODY_BYTES = Number(process.env.CATALOG_MAX_BODY_BYTES) > 0
  ? Number(process.env.CATALOG_MAX_BODY_BYTES) : 32 * 1024 * 1024;         // §16.5 响应体上限 32MB
const MAX_REDIRECTS = 3;                                                   // §16.5 最多 3 次重定向
const FORCE_MIN_INTERVAL_MS = 60_000;                                      // §16.3 force=1 最小间隔 60s
const MAX_CONCURRENT_REQUESTS = Number(process.env.CATALOG_MAX_CONCURRENCY) > 0
  ? Number(process.env.CATALOG_MAX_CONCURRENCY) : 64;                      // §16.6 并发未完成请求上限（env 仅用于压测）
const REQUEST_TIMEOUT_MS = 30_000;                                         // §16.6
const HEADERS_TIMEOUT_MS = 15_000;                                         // §16.6
const STATIC_GZ_CACHE_MAX_BYTES = 24 * 1024 * 1024;                        // 静态 gzip 缓存字节上限

// §16.7 安全响应头（CSP 两种形态见下方说明）
const CSP_STRICT = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'";
// public/index.html 第 10 行是 <script type="importmap"> 内联脚本，契约的 script-src 'self' 会直接把它拦掉、
// 导致整个页面无法加载模块。该文件不归我改，故默认在 script-src 上补 'unsafe-inline'；
// 需要严格版（已把 importmap 外置或加 nonce 后）用 CSP_MODE=strict。
const CSP_COMPAT = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'";
const CSP = String(process.env.CSP_MODE || '').toLowerCase() === 'strict' ? CSP_STRICT : CSP_COMPAT;

/** 所有响应（静态 + API）共用：安全头 + 按需 CORS */
function baseHeaders(extra) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP,
  };
  if (CORS_ENABLED) h['Access-Control-Allow-Origin'] = '*';
  return extra ? { ...h, ...extra } : h;
}

/* ------------------------------------------------------------------ */
/* 日志                                                                */
/* ------------------------------------------------------------------ */
const t0 = Date.now();
const log = (...a) => console.log('[server]', ...a);
const warn = (...a) => console.warn('[server]', ...a);
const ms = () => (Date.now() - t0) + 'ms';

/** 列出本机非回环 IPv4 地址，供局域网访问提示 */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net || net.family !== 'IPv4' || net.internal) continue;
      if (String(net.address).startsWith('169.254.')) continue;
      out.push({ name, address: net.address });
    }
  }
  return out;
}

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

/**
 * V6 §24.1：从 TLE 第 1 行解析 epoch（列 19-32，格式 YYDDD.DDDDDDDD）
 *   两位年份规则：57-99 → 1957-1999，00-56 → 2000-2056
 *   dot 之后是"当日的比例"，用 UTC 计算。
 * @returns {{ ms: number, iso: string } | null}  ISO 精确到秒（UTC，Z 结尾）
 */
function parseTleEpoch(tle1) {
  try {
    const field = String(tle1 || '').slice(18, 32).trim();
    if (!/^\d{5}\.\d+$/.test(field)) return null;
    const yy = Number(field.slice(0, 2));
    const doy = Number(field.slice(2));             // 1.0 ~ 366.9999...
    if (!Number.isFinite(doy) || doy < 1 || doy > 367) return null;
    const year = yy >= 57 ? 1900 + yy : 2000 + yy;
    const ms = Math.round(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
    if (!Number.isFinite(ms)) return null;
    return { ms, iso: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  } catch { return null; }
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

/** RFC4180 风格 CSV 解析（支持引号、引号内逗号/换行、CRLF） */
function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += text[i]; i++; continue;
    }
    if (c === 34) { inQuotes = true; i++; continue; }
    if (c === 44) { row.push(field); field = ''; i++; continue; }
    if (c === 13) { i++; continue; }
    if (c === 10) { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += text[i]; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * §20.2：全量 satcat.csv → Map<NORAD, record>
 * DECAY_DATE 非空的对象已经再入，直接不入库。
 */
function parseSatcatCsv(text) {
  const rows = parseCsvRows(stripBom(String(text || '')));
  const map = new Map();
  if (!rows.length) return map;
  const head = rows[0].map((h) => h.trim().toUpperCase());
  const idx = {};
  head.forEach((h, i) => { idx[h] = i; });
  if (idx.NORAD_CAT_ID == null || idx.OBJECT_TYPE == null) {
    throw new Error('satcat.csv 表头不符合预期: ' + head.slice(0, 8).join(','));
  }
  const pick = (row, name) => (idx[name] == null ? '' : row[idx[name]]);
  let decayed = 0;
  const decayedIds = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 4) continue;
    const id = numOrNull(pick(row, 'NORAD_CAT_ID'));
    if (id == null) continue;
    if (str(pick(row, 'DECAY_DATE'), '')) { decayed++; decayedIds.add(id); continue; }   // 已再入 → 丢弃
    if (map.has(id)) continue;
    const rec = {
      OBJECT_NAME: pick(row, 'OBJECT_NAME'),
      OBJECT_ID: pick(row, 'OBJECT_ID'),
      NORAD_CAT_ID: id,
      OBJECT_TYPE: pick(row, 'OBJECT_TYPE'),
      OPS_STATUS_CODE: pick(row, 'OPS_STATUS_CODE'),
      OWNER: pick(row, 'OWNER'),
      LAUNCH_DATE: pick(row, 'LAUNCH_DATE'),
      DECAY_DATE: pick(row, 'DECAY_DATE'),
      PERIOD: pick(row, 'PERIOD'),
      INCLINATION: pick(row, 'INCLINATION'),
      APOGEE: pick(row, 'APOGEE'),
      PERIGEE: pick(row, 'PERIGEE'),
      RCS: pick(row, 'RCS'),
    };
    map.set(id, rec);
  }
  Object.defineProperty(map, 'decayedCount', { value: decayed, enumerable: false });
  Object.defineProperty(map, 'decayedIds', { value: decayedIds, enumerable: false });
  return map;
}

/** 自动识别 SATCAT 文本格式：JSON（records.php）或 CSV（pub/satcat.csv） */
function parseSatcatAny(text) {
  const t = stripBom(String(text || '')).trim();
  if (!t) return new Map();
  if (t.startsWith('{') || t.startsWith('[')) return parseSatcatJson(t);
  return parseSatcatCsv(t);
}

/* ------------------------------------------------------------------ */
/* §3.2 合并（V5：多分组 TLE）                                          */
/* ------------------------------------------------------------------ */
function buildCatalog(tleInput, satcatInput) {
  const buildStart = performance.now();
  const buildTimeMs = Date.now();          // V6：TLE 龄期的参照时刻（本次构建时间）

  // V5：tleInput 可以是 [{group, text}] 或单段文本（V1 兼容）
  const sources = Array.isArray(tleInput) ? tleInput : [{ group: 'active', text: tleInput }];
  const merged = new Map();          // NORAD → { id, name, tle1, tle2, group }
  const groups = {};                 // 各分组实际纳入条数
  let duplicates = 0;
  let malformed = 0;
  for (const src of sources) {
    const parsed = parseTleText(src.text);
    malformed += parsed.malformed;
    duplicates += parsed.duplicates;          // 组内重复
    let added = 0;
    for (const rec of parsed.records) {
      if (merged.has(rec.id)) { duplicates++; continue; }   // 按 NORAD 去重，先到先得
      merged.set(rec.id, { ...rec, group: src.group });
      added++;
    }
    groups[src.group] = parsed.records.length;   // 该分组本次解析到的条数（去重前）
  }
  const allRecords = [...merged.values()];
  const satMap = (satcatInput instanceof Map) ? satcatInput : parseSatcatAny(satcatInput);
  // §20.2：SATCAT 里 DECAY_DATE 非空的对象已再入 → 连它的 TLE 也一并丢弃
  const decayedIds = (satMap && satMap.decayedIds) || new Set();
  let decayedDropped = 0;
  const records = allRecords.filter((rec) => {
    if (decayedIds.has(rec.id)) { decayedDropped++; return false; }
    return true;
  });
  if (decayedDropped) log('已丢弃 ' + decayedDropped + ' 个已再入对象的 TLE');

  const satellites = [];
  const counts = new Map();
  let noSatcat = 0;
  let debrisCount = 0;
  let telescopeCount = 0;
  let stationCount = 0;                    // V7：空间站/载人/货运数量
  const tleAges = [];                      // V6：收集龄期用于 max / median

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
    // —— V5 §20.3：对象类型 / RCS / 望远镜 ——
    // 名称以 "R/B" 结尾的对象强制视为火箭残骸（SATCAT 里个别合并条目被标成 PAY）
    const rawType = objectType;
    const objectKind = /R\/B\s*$/i.test(sat.name)
      ? 'R-B'
      : (rawType === 'R/B' ? 'R-B' : rawType === 'DEB' ? 'DEB' : rawType === 'PAY' ? 'PAY' : 'UNK');
    const rcsNum = s ? numOrNull(s.RCS) : null;
    const rcs = rcsNum != null && rcsNum > 0 ? round(rcsNum, 4) : null;
    const tel = detectTelescope(sat.name);

    // —— V7 §28：空间站 / 载人飞船 / 货运飞船（先算，供 V20 二级分类使用）——
    const sta = objectKind === 'PAY' ? detectStation(sat.name) : { isStation: false, stationType: null };

    // V2 §7 运营方 + 任务类型；V20 §41 二级分类（stationType/launchDate/orbitClass 参与判定）
    Object.assign(sat, classify({
      name: sat.name,
      owner,
      objectKind,
      isTelescope: tel.isTelescope,
      telescopeType: tel.telescopeType,
      stationType: sta.stationType,
      launchDate: sat.launchDate,
      orbitClass: sat.orbitClass,
    }));
    sat.objectKind = objectKind;
    sat.rcs = rcs;
    sat.isTelescope = tel.isTelescope;
    sat.telescopeType = tel.telescopeType;
    sat.isStation = sta.isStation;
    sat.stationType = sta.stationType;
    if (sta.isStation) stationCount++;

    // —— V6 §24.1：星历龄期 ——
    const epoch = parseTleEpoch(rec.tle1);
    sat.tleEpoch = epoch ? epoch.iso : null;
    sat.tleAgeHours = epoch ? round((buildTimeMs - epoch.ms) / 3600000, 1) : null;
    if (sat.tleAgeHours != null) tleAges.push(sat.tleAgeHours);

    // V20 §40：三个二级分类字段移到末尾，保证既有 31 个字段的相对顺序完全不变
    if (sat.subcategory !== undefined) {
      const v20 = { subcategory: sat.subcategory, subcategoryLabel: sat.subcategoryLabel, subcategoryLabelEn: sat.subcategoryLabelEn };
      delete sat.subcategory; delete sat.subcategoryLabel; delete sat.subcategoryLabelEn;
      Object.assign(sat, v20);
    }

    if (objectKind === 'R-B' || objectKind === 'DEB') debrisCount++;
    if (tel.isTelescope) telescopeCount++;

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
  // —— V20 §41：二级分类汇总（category 顺序 → count 降序 → key）——
  const subCounts = new Map();
  for (const s of satellites) subCounts.set(s.subcategory, (subCounts.get(s.subcategory) || 0) + 1);
  const subcategories = Object.keys(SUBCATEGORY_DEFS)
    .map((key) => ({
      key,
      label: SUBCATEGORY_DEFS[key].label,
      labelEn: SUBCATEGORY_DEFS[key].labelEn,
      category: SUBCATEGORY_DEFS[key].cat,
      count: subCounts.get(key) || 0,
    }))
    .sort((a, b) =>
      (CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)) ||
      (b.count - a.count) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const topOperators = [...operatorAgg.values()]
    .sort((a, b) => (b.count - a.count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, TOP_OPERATORS_LIMIT);

  // —— V6 §24.2：望远镜汇总（前端直接取，按名称排序保证可复现） ——
  const telescopes = satellites
    .filter((s) => s.isTelescope)
    .map((s) => ({ id: s.id, name: s.name, telescopeType: s.telescopeType, orbitClass: s.orbitClass, operator: s.operator }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // —— V7 §28.2：空间站/载人目标汇总（按名称排序，可复现） ——
  const stations = satellites
    .filter((s) => s.isStation)
    .map((s) => ({ id: s.id, name: s.name, stationType: s.stationType, orbitClass: s.orbitClass, operator: s.operator }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // —— V6 §24.3：TLE 龄期统计 ——
  let tleAgeHoursMax = null;
  let tleAgeHoursMedian = null;
  if (tleAges.length) {
    const sorted = [...tleAges].sort((a, b) => a - b);
    tleAgeHoursMax = round(sorted[sorted.length - 1], 1);
    const mid = sorted.length >> 1;
    tleAgeHoursMedian = round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 1);
  }

  // §16.9 解析健康度：落盘进 catalog.json 顶层，/api/health 一并返回
  const health = {
    duplicates,
    malformed,
    noSatcat,
    tleCount: allRecords.length,
    satcatCount: satMap.size,
    buildMs: Math.round(performance.now() - buildStart),
    decayedDropped,
    debrisCount,          // V5 §20.6：R-B + DEB 对象数
    telescopeCount,       // V5 §20.6：望远镜数量
    groups,               // V5 §20.6：各分组实际纳入条数
    tleAgeHoursMax,       // V6 §24.3：最大 TLE 龄期（小时）
    tleAgeHoursMedian,    // V6 §24.3：TLE 龄期中位数（小时）
    stationCount,         // V7 §28.3：空间站/载人/货运数量
  };

  return { satellites, countries, categories, subcategories, topOperators, telescopes, stations, duplicates, malformed, noSatcat, health };
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
  error: null,          // 内部错误详情：只写日志，绝不回传客户端
  health: null,         // §16.9 解析健康度 { duplicates, malformed, noSatcat, tleCount, satcatCount, buildMs }
  initPromise: null,
  refreshing: null,
  lastForceAt: 0,       // §16.3 force=1 限流时间戳
  active: 0,            // §16.6 未完成请求计数
  refreshStarted: 0,    // 本次进程内后台刷新次数（日志/健康用）
};

/** §16.6：gzip 改异步（zlib.gzip promisify），避免 1MB+ 压缩阻塞事件循环 */
async function serialize(catalog) {
  const raw = Buffer.from(JSON.stringify(catalog), 'utf8');
  const gz = await gzipAsync(raw, { level: 6 });
  return { raw, gz };
}

async function writeCacheFile(catalog) {
  // 磁盘缓存里的 source 固定记为 "cache"（它本身就是缓存），进程内仍保留真实来源。
  const diskCatalog = { ...catalog, source: 'cache' };
  const { raw, gz } = await serialize(diskCatalog);
  const tmp = CACHE_FILE + '.' + process.pid + '.tmp';
  const tmpGz = CACHE_GZ_FILE + '.' + process.pid + '.tmp';
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(tmp, raw);
    await fsp.writeFile(tmpGz, gz);
    await fsp.rename(tmp, CACHE_FILE);
    await fsp.rename(tmpGz, CACHE_GZ_FILE);
    return { rawBytes: raw.length, gzBytes: gz.length };
  } catch (err) {
    // §16.8 tmp 写入失败必须清理，避免 data/ 残留半成品
    await fsp.rm(tmp, { force: true }).catch(() => {});
    await fsp.rm(tmpGz, { force: true }).catch(() => {});
    throw err;
  }
}

/** V5：把抓到的各分组 TLE 落盘，供冷启动/断网时复用 */
async function saveGroupFiles(sources) {
  if (!sources || !sources.length) return;
  await fsp.mkdir(GROUPS_DIR, { recursive: true });
  for (const src of sources) {
    const def = GROUP_DEFS.find((d) => d.key === src.group);
    if (!def) continue;
    const target = path.join(DATA_DIR, def.file);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.' + process.pid + '.tmp';
    try {
      await fsp.writeFile(tmp, src.text);
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
  log('已落盘 ' + sources.length + ' 个分组 TLE 文件到 data/');
}

/** V5：全量 satcat.csv 落盘（原子写） */
async function saveSatcatCsv(text) {
  const tmp = SATCAT_CSV_FILE + '.' + process.pid + '.tmp';
  try {
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, SATCAT_CSV_FILE);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** §16.8 启动时清扫上一次被强杀留下的 tmp 文件 */
async function cleanupStaleTmp() {
  try {
    const entries = await fsp.readdir(DATA_DIR);
    let removed = 0;
    for (const name of entries) {
      if (/\.tmp$/.test(name)) {
        await fsp.rm(path.join(DATA_DIR, name), { force: true }).catch(() => {});
        removed++;
      }
    }
    if (removed) log('已清理 ' + removed + ' 个残留 tmp 文件');
  } catch { /* data/ 不存在等，忽略 */ }
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

async function adoptCatalog(catalog, source, opts = {}) {
  const served = { ...catalog, source, count: catalog.satellites.length };
  const { raw, gz } = await serialize(served);
  state.catalog = served;
  state.raw = raw;
  state.gz = gz;
  state.updated = served.updated;
  state.source = source;
  state.health = served.health || null;
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
/** §16.5：协议白名单，只允许 http/https */
function assertHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('非法 URL: ' + String(raw).slice(0, 120)); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('URL 协议被拒绝（仅允许 http/https）: ' + u.protocol);
  }
  return u;
}

/** §16.5：流式读取响应体并强制字节上限，超限立即中断（不把整包读进内存） */
async function readCappedBody(res, cap, what) {
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > cap) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    const e = new Error(what + ' 响应体过大: Content-Length=' + cl + ' > 上限 ' + cap);
    e.code = 'BODY_TOO_LARGE';
    throw e;
  }
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text) > cap) {
      const e = new Error(what + ' 响应体过大: > 上限 ' + cap);
      e.code = 'BODY_TOO_LARGE';
      throw e;
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        try { await reader.cancel('body_too_large'); } catch { /* ignore */ }
        const e = new Error(what + ' 响应体超过上限 ' + cap + ' 字节（已读 ' + total + '，已中断）');
        e.code = 'BODY_TOO_LARGE';
        throw e;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchText(url, what, opts = {}) {
  const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : FETCH_TIMEOUT_MS;
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : MAX_BODY_BYTES;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const started = Date.now();
  try {
    let current = assertHttpUrl(url);
    let res = null;
    // §16.5：手动跟随重定向，最多 MAX_REDIRECTS 次，且每一跳都校验协议
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(current.href, {
        signal: ac.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'orbit-holo/1.0 (+zero-dep data service)', accept: '*/*' },
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop === MAX_REDIRECTS) throw new Error(what + ' 重定向超过 ' + MAX_REDIRECTS + ' 次');
        const next = new URL(loc, current);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new Error(what + ' 重定向到非 http(s) 地址: ' + next.protocol);
        }
        log(what + ' 重定向 #' + (hop + 1) + ' → ' + next.origin + next.pathname);
        try { await res.body?.cancel(); } catch { /* ignore */ }
        current = next;
        continue;
      }
      break;
    }
    if (!res.ok) {
      const bodyText = await readCappedBody(res, 64 * 1024, what).catch(() => '');
      const err = new Error('HTTP ' + res.status + ' ' + res.statusText +
        (bodyText ? ' — ' + bodyText.replace(/\s+/g, ' ').trim().slice(0, 200) : ''));
      err.status = res.status;
      err.bodyText = bodyText;
      // CelesTrak 的"数据自上次下载后未更新"会以 403 + 说明文本返回，这不是故障。
      err.notModified = /has not updated since your last successful\s+download/i.test(bodyText);
      throw err;
    }
    const text = await readCappedBody(res, maxBytes, what);
    if (!text || text.length < 32) throw new Error('响应过短 (' + (text ? text.length : 0) + ' bytes)');
    log('抓取 ' + what + ' 成功: ' + text.length + ' 字节 / ' + (Date.now() - started) + 'ms');
    return text;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error(what + ' 抓取超时 (' + timeout + 'ms)');
      e.code = 'FETCH_TIMEOUT';
      throw e;
    }
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

/* ------------------------------------------------------------------ */
/* V8 §32：Space-Track（登录 + GP 3LE 全量）                             */
/* ------------------------------------------------------------------ */
function parseEnvText(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i <= 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** 读凭据：只在内存保留，返回 null 表示没有可用凭据（不抛异常、不打印内容） */
async function loadSpaceTrackCreds() {
  if (SPACETRACK_CREDS) return SPACETRACK_CREDS;
  const text = await readLocalFile(SPACETRACK_ENV_FILE);
  if (!text) return null;
  const env = parseEnvText(text);
  const user = env.SPACETRACK_USER || env.ST_USER || env.identity || '';
  const pass = env.SPACETRACK_PASS || env.ST_PASS || env.password || '';
  if (!user || !pass) {
    warn('Space-Track 凭据文件存在但缺少 SPACETRACK_USER / SPACETRACK_PASS 字段（内容不打印）');
    return null;
  }
  SPACETRACK_CREDS = { user, pass };
  log('已加载 Space-Track 凭据（仅内存使用，不写日志）');
  return SPACETRACK_CREDS;
}

/** §32.6 限速：统计最近 60s 内的请求数 */
function spaceTrackRateOk() {
  const now = Date.now();
  while (SPACETRACK_REQ_TIMES.length && now - SPACETRACK_REQ_TIMES[0] > 60_000) SPACETRACK_REQ_TIMES.shift();
  return SPACETRACK_REQ_TIMES.length < SPACETRACK_RATE_LIMIT;
}

async function spaceTrackLogin(creds) {
  if (!spaceTrackRateOk()) throw new Error('Space-Track 请求频次已达上限，本次跳过');
  SPACETRACK_REQ_TIMES.push(Date.now());
  const body = new URLSearchParams({ identity: creds.user, password: creds.pass }).toString();
  const res = await fetch(SPACETRACK_LOGIN_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'orbit-holo/1.0 (+zero-dep data service)',
    },
    body,
    signal: AbortSignal.timeout(SPACETRACK_TIMEOUT_MS),
  });
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookies = raw.map((c) => String(c).split(';')[0]).filter(Boolean);
  try { await res.body?.cancel(); } catch { /* ignore */ }
  if (!res.ok || !cookies.length) throw new Error('登录失败（凭据或网络）');
  return cookies.join('; ');
}

async function spaceTrackGp(cookieHeader) {
  if (!spaceTrackRateOk()) throw new Error('Space-Track 请求频次已达上限，本次跳过');
  SPACETRACK_REQ_TIMES.push(Date.now());
  const res = await fetch(SPACETRACK_GP_URL, {
    headers: { cookie: cookieHeader, 'user-agent': 'orbit-holo/1.0 (+zero-dep data service)' },
    redirect: 'manual',
    signal: AbortSignal.timeout(SPACETRACK_TIMEOUT_MS),
  });
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new Error('GP 查询失败 HTTP ' + res.status);
  }
  const text = await readCappedBody(res, MAX_BODY_BYTES, 'Space-Track GP');
  if (!text || text.length < 1000 || !/(^|\r?\n)1 +/.test(text)) throw new Error('GP 返回内容异常（不是 3LE）');
  return text;
}

/** §32.6：一次刷新只发 2 个请求（登录 + GP）；失败最多重试 1 次，间隔 ≥5s */
async function fetchSpaceTrackTle(creds) {
  let lastErr = null;
  for (let attempt = 0; attempt <= SPACETRACK_MAX_RETRY; attempt++) {
    if (attempt > 0) {
      log('Space-Track 重试第 ' + attempt + ' 次（间隔 ' + (SPACETRACK_MIN_GAP_MS / 1000) + 's）');
      await new Promise((r) => setTimeout(r, SPACETRACK_MIN_GAP_MS));
    }
    try {
      const cookie = await spaceTrackLogin(creds);
      const text = await spaceTrackGp(cookie);
      log('Space-Track 抓取成功: ' + text.length + ' 字节');
      return text;
    } catch (err) {
      lastErr = err;
      warn('Space-Track 尝试 ' + (attempt + 1) + ' 失败: ' + redact(err && err.message ? err.message : err));
    }
  }
  SPACETRACK_LAST_ERR = redact(lastErr && lastErr.message ? lastErr.message : 'Space-Track 不可用');
  throw new Error(SPACETRACK_LAST_ERR);
}

/** 3LE（0 NAME / 1 行 / 2 行）→ 兼容 parseTleText 的文本：去 "0 " 前缀、去行首空格 */
function normalize3le(text) {
  const lines = stripBom(String(text || '')).split(/\r?\n/);
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    let s = lines[i].replace(/^\s+/, '');
    if (s.startsWith('0 ')) s = s.slice(2);
    out[i] = s;
  }
  return out.join('\n');
}

async function saveSpaceTrackGp(text) {
  const tmp = SPACETRACK_GP_FILE + '.' + process.pid + '.tmp';
  try {
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, SPACETRACK_GP_FILE);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function refreshFromNetwork(reason) {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    const started = Date.now();
    log('开始联网抓取 (' + reason + ') ...');
    try {
      const describe = (e) => ((e && e.message) ? e.message : String(e)) + ((e && e.code) ? ' [' + e.code + ']' : '');

      // ── V8 §32.2：优先 Space-Track（有凭据且未强制 celestrak）────────────
      let sourceDetail = 'celestrak';
      let tleSources = [];
      const freshGroups = new Set();
      const skippedGroups = [];

      if (CATALOG_SOURCE !== 'celestrak') {
        const creds = await loadSpaceTrackCreds().catch(() => null);
        if (creds) {
          try {
            const gpText = await fetchSpaceTrackTle(creds);
            tleSources = [{ group: 'spacetrack', text: normalize3le(gpText) }];
            sourceDetail = 'spacetrack';
            await saveSpaceTrackGp(gpText).catch((err) => warn('Space-Track GP 落盘失败: ' + redact(err.message)));
          } catch (err) {
            warn('Space-Track 不可用 → 自动回退 CelesTrak 8 组：' + redact(err && err.message ? err.message : err));
          }
        } else if (CATALOG_SOURCE === 'spacetrack') {
          warn('CATALOG_SOURCE=spacetrack 但未找到 data/.spacetrack.env（或字段不全），回退 CelesTrak');
        }
      } else {
        log('CATALOG_SOURCE=celestrak：按配置跳过 Space-Track');
      }

      // ── V5 §20.1 回退：逐组抓 CelesTrak；单组失败只跳过并记日志 ────────
      if (!tleSources.length) {
      const groupSettled = await Promise.allSettled(GROUP_DEFS.map(async (g) => ({
        group: g.key,
        text: await fetchText(resolveGroupUrl(g.key), 'TLE:' + g.key),
      })));

      for (let i = 0; i < groupSettled.length; i++) {
        const def = GROUP_DEFS[i];
        const r = groupSettled[i];
        if (r.status === 'fulfilled') {
          tleSources.push({ group: def.key, text: r.value.text });
          freshGroups.add(def.key);
          continue;
        }
        const e = r.reason || {};
        if (e.notModified) log('分组 ' + def.key + ' 未更新（数据自上次下载后无变化），沿用本地文件');
        else warn('分组 ' + def.key + ' 抓取失败，已跳过: ' + describe(e));
        const local = (await readLocalFile(path.join(DATA_DIR, def.file)))
          ?? (def.key === 'active' ? await readLocalFile(TLE_FILE) : null);
        if (local) { tleSources.push({ group: def.key, text: local }); log('  分组 ' + def.key + ' → 回退本地文件'); }
        else skippedGroups.push(def.key);
      }
      if (!tleSources.length) throw new Error('所有 TLE 分组均不可用（网络失败且本地文件缺失）');
      if (skippedGroups.length) warn('以下分组完全无数据，已忽略: ' + skippedGroups.join(', '));
      log('TLE 分组: 成功 ' + freshGroups.size + '/' + GROUP_DEFS.length +
        (skippedGroups.length ? '，无数据 ' + skippedGroups.length : ''));
      }   // end if (!tleSources.length) — CelesTrak 回退分支
      log('TLE 来源: ' + sourceDetail);

      // ── V5 §20.2：SATCAT 全量 CSV → records.php → 本地文件 ─────────────
      let satcatText = null;
      let satcatFrom = '';
      try {
        satcatText = await fetchText(SATCAT_CSV_URL, 'SATCAT(csv)', { timeoutMs: CSV_TIMEOUT_MS });
        satcatFrom = 'csv';
        await saveSatcatCsv(satcatText).catch((err) => warn('satcat.csv 落盘失败: ' + err.message));
      } catch (e1) {
        warn('全量 SATCAT CSV 不可用: ' + describe(e1));
        // 优先用本地已缓存的「全量 CSV」（71,000+ 条，含碎片/残骸元数据），
        // 它比 records.php（仅 active ~1.7 万）完整得多，避免大量目标丢失国家/类型变成 UNK
        const localCsv = await readLocalFile(SATCAT_CSV_FILE);
        if (localCsv) {
          satcatText = localCsv;
          satcatFrom = 'local-csv';
          log('SATCAT 使用本地全量 CSV 回退 (' + localCsv.length + ' 字节)');
        } else {
          warn('本地 CSV 也不存在 → 回退 records.php');
          try { satcatText = await fetchText(SATCAT_URL, 'SATCAT(json)'); satcatFrom = 'json'; }
          catch (e2) { warn('SATCAT records.php 也不可用: ' + describe(e2)); }
        }
      }
      if (!satcatText) {
        satcatText = (await readLocalFile(SATCAT_CSV_FILE)) ?? (await readLocalFile(SATCAT_FILE));
        if (satcatText) { satcatFrom = 'local'; log('SATCAT 回退到本地文件 (' + satcatText.length + ' 字节)'); }
      }
      if (!satcatText) {
        if (state.catalog) {
          warn('TLE 与 SATCAT 均不可用 → 回退到旧缓存 (source=' + state.source + ', 卫星=' + state.catalog.count + ')');
          return state.catalog;
        }
        throw new Error('TLE 与 SATCAT 均无可用数据源（网络失败且本地文件缺失）');
      }

      // 成功抓到的分组落盘，供下次冷启动/断网时使用
      await saveGroupFiles(tleSources.filter((s) => freshGroups.has(s.group)))
        .catch((err) => warn('分组 TLE 落盘失败: ' + err.message));

      const built = buildCatalog(tleSources, satcatText);
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
        subcategories: built.subcategories,
        telescopes: built.telescopes,
        stations: built.stations,
        health: built.health,
      };
      built.health.sourceDetail = sourceDetail;
      const source = sourceDetail === 'spacetrack'
        ? 'spacetrack'
        : ((freshGroups.size === GROUP_DEFS.length && satcatFrom !== 'local') ? 'celestrak' : 'local');
      catalog.source = source;
      const wrote = await writeCacheFile(catalog).catch(err => { warn('写缓存失败:', err.message); return null; });
      await adoptCatalog(catalog, source);
      state.refreshStarted++;
      log('刷新完成: source=' + source + ' (' + sourceDetail + ') 卫星=' + catalog.count + ' 国家=' + catalog.countries.length +
        ' TLE来源=' + sourceDetail + (sourceDetail === 'celestrak' ? '组:' + freshGroups.size + '/' + GROUP_DEFS.length : '') +
        ' SATCAT=' + satcatFrom +
        ' 碎片=' + built.health.debrisCount + ' 望远镜=' + built.health.telescopeCount +
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
    await adoptCatalog(cache.catalog, 'cache');
    const ageH = cache.ageMs === Infinity ? '未知' : (cache.ageMs / 3600000).toFixed(2) + 'h';
    log('使用磁盘缓存 catalog.json (age=' + ageH + ', TTL=' + TTL_HOURS + 'h)');
    if (cache.ageMs > TTL_MS) {
      log('缓存已过期，后台刷新（不阻塞启动/响应）');
      refreshFromNetwork('缓存过期').catch(() => {});
    }
    return;
  }

  // 本地原始数据合成（V8：优先 Space-Track 落盘 3LE；否则 V5 多分组；再否则 V1 单文件）
  try {
    const tleSources = [];
    let localSourceDetail = 'celestrak';
    // 只有「配了 Space-Track 凭据」时才用 ST 缓存文件；凭据被移除时按 CelesTrak 走（回退演练可见）
    const stCreds = CATALOG_SOURCE !== 'celestrak' ? await loadSpaceTrackCreds().catch(() => null) : null;
    if (CATALOG_SOURCE !== 'celestrak' && !stCreds) log('未找到 Space-Track 凭据，按 CelesTrak 分组数据合成');
    const stLocal = stCreds ? await readLocalFile(SPACETRACK_GP_FILE) : null;
    if (stLocal && /(^|\r?\n)1 +/.test(stLocal)) {
      tleSources.push({ group: 'spacetrack', text: normalize3le(stLocal) });
      localSourceDetail = 'spacetrack';
      log('本地合成使用 Space-Track 缓存 data/spacetrack-gp.3le');
    }
    if (!tleSources.length) {           // 没有 Space-Track 缓存时才用 CelesTrak 分组文件
      for (const def of GROUP_DEFS) {
        const txt = (await readLocalFile(path.join(DATA_DIR, def.file)))
          ?? (def.key === 'active' ? await readLocalFile(TLE_FILE) : null);
        if (txt) tleSources.push({ group: def.key, text: txt });
      }
    }
    const satcatText = (await readLocalFile(SATCAT_CSV_FILE)) ?? (await readLocalFile(SATCAT_FILE));
    if (!tleSources.length || !satcatText) throw new Error('本地 TLE/SATCAT 文件缺失');
    const built = buildCatalog(tleSources, satcatText);
    if (!built.satellites.length) throw new Error('本地文件合并结果为空');
    built.health.sourceDetail = localSourceDetail;
    const catalog = {
      ok: true,
      updated: new Date().toISOString(),
      source: 'local',
      count: built.satellites.length,
      countries: built.countries,
      satellites: built.satellites,
      categories: built.categories,
      topOperators: built.topOperators,
      subcategories: built.subcategories,
      telescopes: built.telescopes,
      stations: built.stations,
      health: built.health,
    };
    log('本地合成完成: 来源=' + localSourceDetail + ' 分组=' + tleSources.length +
      ' TLE=' + built.health.tleCount + ' SATCAT=' + built.health.satcatCount +
      ' 碎片=' + built.health.debrisCount + ' 望远镜=' + built.health.telescopeCount +
      ' 重复=' + built.duplicates + ' 残行=' + built.malformed +
      ' 无SATCAT=' + built.noSatcat + ' 构建=' + built.health.buildMs + 'ms');
    await writeCacheFile(catalog).catch(err => warn('写缓存失败:', err.message));
    await adoptCatalog(catalog, 'local');
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
let GZ_TEXT_CACHE_BYTES = 0;   // 静态 gzip 缓存占用字节（审计低 #15）

function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }
const acceptsGzip = (req) => /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  }));
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

/** §16.4 统一脱敏错误：对外只给固定 error code，内部细节只进日志 */
function sendError(res, status, code) {
  return sendJson(res, status, { ok: false, error: code });
}

/** §16.8 目录包含判断（不用 startsWith('..') 这种易误判的写法） */
function insideDir(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

/** public/ 的真实路径，用于符号链接二次校验（只算一次） */
let PUBLIC_REAL = null;
async function publicRealPath() {
  if (!PUBLIC_REAL) PUBLIC_REAL = await fsp.realpath(PUBLIC_DIR);
  return PUBLIC_REAL;
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
  // §16.8 修复：原写法 relFromPublic.startsWith('..') 会把 public/..foo.js 这类合法文件误判为越界
  const escapes = relFromPublic === '..' || relFromPublic.startsWith('..' + path.sep) || path.isAbsolute(relFromPublic);
  if (escapes) {
    log('拒绝越界访问: ' + JSON.stringify(decoded));
    return sendText(res, 403, '403 Forbidden');
  }
  if (!insideDir(PUBLIC_DIR, abs)) return sendText(res, 403, '403 Forbidden');

  // §16.8 符号链接二次校验：解析真实路径后必须仍在 public/ 之内
  let real;
  try {
    const baseReal = await publicRealPath();
    real = await fsp.realpath(abs);
    if (!insideDir(baseReal, real)) {
      warn('拒绝符号链接越界访问: ' + JSON.stringify(decoded) + ' → ' + real);
      return sendText(res, 403, '403 Forbidden');
    }
  } catch {
    return sendText(res, 404, '404 Not Found');
  }

  let st;
  try { st = await fsp.stat(real); } catch { return sendText(res, 404, '404 Not Found'); }
  if (st.isDirectory()) {
    const idx = path.join(real, 'index.html');
    try { st = await fsp.stat(idx); } catch { return sendText(res, 404, '404 Not Found'); }
    return sendFile(req, res, idx, st);
  }
  return sendFile(req, res, real, st);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, baseHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  }));
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

async function sendFile(req, res, abs, st) {
  const ext = path.extname(abs).toLowerCase();
  const headers = baseHeaders({
    'Content-Type': mimeFor(abs),
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
  });
  const useGzip = acceptsGzip(req) && TEXTUAL.has(ext) && st.size > 1024;
  if (useGzip) {
    const key = abs + '|' + st.mtimeMs + '|' + st.size;
    let gz = GZ_TEXT_CACHE.get(key);
    if (!gz) {
      try {
        const buf = await fsp.readFile(abs);
        gz = await gzipAsync(buf, { level: 6 });     // §16.6 异步 gzip
        if (GZ_TEXT_CACHE_BYTES + gz.length > STATIC_GZ_CACHE_MAX_BYTES) {
          GZ_TEXT_CACHE.clear(); GZ_TEXT_CACHE_BYTES = 0;   // 审计低 #15：缓存字节上限
        }
        GZ_TEXT_CACHE.set(key, gz);
        GZ_TEXT_CACHE_BYTES += gz.length;
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
  if (!state.catalog) {
    // §16.4 脱敏：不暴露内部错误详情
    return sendError(res, 503, 'catalog_unavailable');
  }
  const gz = acceptsGzip(req);
  const body = gz ? state.gz : state.raw;
  res.__src = state.source;
  res.__mode = 'cache-hit';
  const extra = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'Vary': 'Accept-Encoding',
    'X-Data-Source': state.source,
    'X-Data-Count': String(state.catalog.count),
    'X-Data-Updated': state.updated || '',
  };
  // §16.3 刷新语义提示头
  if (res.__refreshThrottled) extra['X-Refresh-Throttled'] = '1';
  if (res.__refreshStarted) extra['X-Refresh-Started'] = '1';
  if (gz) extra['Content-Encoding'] = 'gzip';
  res.writeHead(200, baseHeaders(extra));
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** §16.9 解析健康度（与 catalog.json 顶层 health 同字段） */
function healthPayload() {
  const h = state.health || {};
  return {
    duplicates: h.duplicates ?? null,
    malformed: h.malformed ?? null,
    noSatcat: h.noSatcat ?? null,
    tleCount: h.tleCount ?? (state.catalog ? state.catalog.count : 0),
    satcatCount: h.satcatCount ?? null,
    buildMs: h.buildMs ?? null,
    debrisCount: h.debrisCount ?? null,
    telescopeCount: h.telescopeCount ?? null,
    groups: h.groups ?? null,
    tleAgeHoursMax: h.tleAgeHoursMax ?? null,
    tleAgeHoursMedian: h.tleAgeHoursMedian ?? null,
    stationCount: h.stationCount ?? null,
    sourceDetail: h.sourceDetail ?? (state.source === 'spacetrack' ? 'spacetrack' : null),
  };
}

function sendHealth(res, req) {
  const health = healthPayload();
  const ok = !!state.catalog;
  const payload = {
    ok,
    count: ok ? state.catalog.count : 0,
    updated: state.updated,
    source: state.source,
    // 嵌套一份（与 catalog.json 的 health 键对齐） + 平铺一份（便于直接读取）
    sourceDetail: health.sourceDetail,
    health,
    ...health,
    refreshing: !!state.refreshing,
    active: state.active,
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    forceMinIntervalMs: FORCE_MIN_INTERVAL_MS,
    uptimeMs: Date.now() - startedAt,
  };
  if (!ok) payload.error = 'catalog_unavailable';   // §16.4 固定文案
  sendJson(res, ok ? 200 : 503, payload);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
const startedAt = Date.now();
let requestSeq = 0;

/** §16.4 每个请求一个 requestId，日志可追溯（对外通过 X-Request-Id 暴露，便于报障对账） */
function nextRequestId() {
  requestSeq++;
  return 'r' + requestSeq.toString(36) + '-' + Date.now().toString(36).slice(-4);
}

async function handle(req, res) {
  const rid = nextRequestId();
  const begin = process.hrtime.bigint();
  const rawUrl = req.url || '/';
  res.__rid = rid;
  let url;
  try { url = new URL(rawUrl, 'http://' + (req.headers.host || 'localhost')); }
  catch {
    warn('[' + rid + '] 非法 URL: ' + JSON.stringify(rawUrl).slice(0, 200));
    return sendError(res, 400, 'bad_request');
  }
  const pathname = url.pathname;

  res.setHeader('X-Request-Id', rid);

  res.on('finish', () => {
    if (!pathname.startsWith('/api/')) return;
    const durMs = Number(process.hrtime.bigint() - begin) / 1e6;
    log('[' + rid + '] ' + req.method + ' ' + rawUrl + ' → ' + res.statusCode +
      ' ' + durMs.toFixed(1) + 'ms' +
      (res.getHeader('Content-Encoding') ? ' [gzip]' : '') +
      ' [source=' + (res.__src || 'none') + (res.__mode ? ', ' + res.__mode : '') + ']');
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'method_not_allowed');
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
      // §16.3：最小间隔 60s；未到期 → 限流；到期 → 后台异步刷新，立即返回当前缓存
      const now = Date.now();
      const sinceLast = now - state.lastForceAt;
      if (sinceLast < FORCE_MIN_INTERVAL_MS) {
        res.__refreshThrottled = true;
        log('[' + rid + '] force=1 被限流（距上次 ' + (sinceLast / 1000).toFixed(1) + 's < ' +
          (FORCE_MIN_INTERVAL_MS / 1000) + 's），直接返回当前缓存');
      } else {
        state.lastForceAt = now;
        if (state.refreshing) {
          log('[' + rid + '] force=1：已有刷新在执行，直接返回当前缓存');
        } else {
          log('[' + rid + '] force=1：触发后台刷新（立即返回当前缓存，不等抓取）');
          refreshFromNetwork('force=1').catch((err) =>
            warn('[' + rid + '] 后台刷新异常: ' + (err && err.stack ? err.stack : err)));
        }
        res.__refreshStarted = true;
      }
    } else if (state.catalog && ageMs > TTL_MS && !state.refreshing) {
      // 过期：先返回当前缓存，后台刷新
      log('[' + rid + '] 缓存已过期 ' + (ageMs / 3600000).toFixed(2) + 'h，后台刷新');
      refreshFromNetwork('TTL 过期(请求触发)').catch((err) =>
        warn('[' + rid + '] 后台刷新异常: ' + (err && err.stack ? err.stack : err)));
    }
    return sendCatalog(req, res);
  }

  if (pathname.startsWith('/api/')) {
    log('[' + rid + '] 未知接口: ' + JSON.stringify(pathname).slice(0, 120));
    return sendError(res, 404, 'not_found');
  }

  return serveStatic(req, res, pathname);
}

/* ------------------------------------------------------------------ */
/* 导出（便于离线单测；以脚本方式运行时仍会自启动）                       */
/* ------------------------------------------------------------------ */
export { buildCatalog, classifyOrbit, parseTleText, parseTleEpoch, parseSatcatJson, parseSatcatCsv, parseSatcatAny, countryInfo, COUNTRY_MAP, GROUP_DEFS, detectStation };

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
    else if (a === '--cors') out.cors = true;
    else if (a.startsWith('--cors=')) out.cors = /^(1|true|yes)$/i.test(a.slice('--cors='.length));
  }
  return out;
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[server] 端口非法: ' + (ARGS.port ?? process.env.PORT));
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // §16.6 并发未完成请求上限：超出直接 503，避免堆积打爆内存
  state.active++;
  if (state.active > MAX_CONCURRENT_REQUESTS) {
    state.active--;
    res.setHeader('Retry-After', '2');
    warn('并发超限 (' + state.active + '/' + MAX_CONCURRENT_REQUESTS + ')，请求被拒绝: ' + (req.url || ''));
    return sendError(res, 503, 'busy');
  }
  let counted = true;
  const release = () => { if (counted) { counted = false; state.active--; } };
  res.once('close', release);

  handle(req, res).catch((err) => {
    warn('[' + (res.__rid || '-') + '] 请求处理异常 ' + (req.url || '') + ': ' + (err && err.stack ? err.stack : err));
    if (!res.headersSent) sendError(res, 500, 'internal_error');   // §16.4 脱敏
    else res.destroy();
  });
});

// §16.6 HTTP 超时（慢连接/半开连接不占用进程）
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = 5_000;

server.on('error', (err) => {
  const code = err && err.code;
  if (code === 'EADDRINUSE') {
    console.error('[server] 启动失败：端口 ' + PORT + ' 已被占用（可能已有实例在跑）。' +
      '请换端口：node server.mjs --port 5181');
  } else if (code === 'EACCES') {
    console.error('[server] 启动失败：无权绑定 ' + (HOST || '0.0.0.0') + ':' + PORT + '（1024 以下端口通常需要管理员权限）');
  } else if (code === 'EADDRNOTAVAIL') {
    console.error('[server] 启动失败：本机不存在地址 ' + HOST + '，请检查 --host/HOST');
  } else {
    console.error('[server] 启动失败 [' + code + ']: ' + (err && err.stack ? err.stack : err));
  }
  process.exit(1);
});

// 先监听（立即可用），数据初始化在后台进行；请求会 await initPromise。
function startServer() {
  state.initPromise = cleanupStaleTmp()
    .then(initData)
    .catch((err) => {
      warn('数据初始化异常: ' + (err && err.stack ? err.stack : err));
      state.error = '数据初始化失败: ' + (err && err.message ? err.message : String(err));
      state.ready = true;
    });

  server.listen(PORT, HOST, () => {
    const addr = server.address();
    const shownPort = addr && typeof addr === 'object' ? addr.port : PORT;
    const shownHost = addr && typeof addr === 'object' ? addr.address : HOST;
    const hostText = String(shownHost).includes(':') ? '[' + shownHost + ']' : shownHost;
    log('地球卫星全息镜像 · 数据服务已启动');
    log('监听 http://' + hostText + ':' + shownPort + '/  (public: ' + PUBLIC_DIR + ')');
    if (HOST === '0.0.0.0' || HOST === '::') {
      const lan = lanAddresses();
      if (lan.length) {
        for (const item of lan) {
          log('局域网: http://' + item.address + ':' + shownPort + '/  (' + item.name + ')');
        }
      } else {
        log('局域网: 未检测到可用的 IPv4 地址');
      }
    }
    const listenText = HOST === '127.0.0.1'
      ? '仅本机'
      : (HOST === '0.0.0.0' || HOST === '::' ? '局域网(所有网卡)' : HOST);
    log('安全: 监听=' + listenText +
      ' | CORS=' + (CORS_ENABLED ? '开启(*)' : '关闭(同源)') +
      ' | CSP=' + (CSP === CSP_STRICT ? 'strict' : 'compat(允许内联 importmap)'));
    log('接口: GET /api/catalog  |  GET /api/health  |  static /');
    log('参数: TTL=' + TTL_HOURS + 'h  force 限流=' + (FORCE_MIN_INTERVAL_MS / 1000) + 's' +
      '  抓取超时=' + FETCH_TIMEOUT_MS + 'ms  响应体上限=' + Math.round(MAX_BODY_BYTES / 1048576) + 'MB' +
      '  并发上限=' + MAX_CONCURRENT_REQUESTS + '  请求超时=' + REQUEST_TIMEOUT_MS + 'ms');
    log('缓存文件=' + CACHE_FILE);
  });
}

function shutdown(sig) {
  log('收到 ' + sig + '，关闭服务器 (运行 ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's, 请求 ' +
    requestSeq + ' 个, 未完成 ' + state.active + ')');
  server.close(() => process.exit(0));
  // §16.8：不等 keep-alive 自然断开，直接掐掉所有连接
  if (typeof server.closeAllConnections === 'function') {
    try { server.closeAllConnections(); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => warn('未处理的 Promise 拒绝: ' + (e && e.stack ? e.stack : e)));
process.on('uncaughtException', (err) => {
  // §16.8：打印完整 stack 后按策略退出（不再"只 warn 继续跑"）
  console.error('[server] 未捕获异常，进程即将退出:\n' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  try { server.close(); if (server.closeAllConnections) server.closeAllConnections(); } catch { /* ignore */ }
  setTimeout(() => process.exit(1), 200);
});

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return true;
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  } catch { return true; }
})();
if (isMainModule) startServer();
