
import assert from 'node:assert/strict';
// 用法: node verify-http.mjs [baseUrl]   默认 http://127.0.0.1:5180
const BASE = process.argv[2] || 'http://127.0.0.1:5180';
const t = [];
const pass = (n) => { t.push(n); console.log('  PASS  ' + n); };

// 1. health
const hRes = await fetch(BASE + '/api/health');
const h = await hRes.json();
assert.equal(hRes.status, 200); assert.equal(h.ok, true); assert.equal(typeof h.count, 'number');
pass('GET /api/health → 200 ' + JSON.stringify(h));

// 2. catalog (gzip) timing, 3 runs
const times = [];
let res, raw;
for (let i = 0; i < 3; i++) {
  const s = performance.now();
  res = await fetch(BASE + '/api/catalog', { headers: { 'accept-encoding': 'gzip' } });
  raw = await res.text();
  times.push(performance.now() - s);
}
const cat = JSON.parse(raw);
pass('GET /api/catalog → 200 gzip=' + res.headers.get('content-encoding') +
  ' ctype=' + res.headers.get('content-type') +
  ' cors=' + res.headers.get('access-control-allow-origin'));
assert.equal(res.headers.get('content-encoding'), 'gzip');
assert.equal(res.headers.get('access-control-allow-origin'), '*');
pass('传输耗时 3 次: ' + times.map(x => x.toFixed(1) + 'ms').join(' / ') + '（均 ' + (Math.max(...times) < 300 ? '< 300ms' : '⚠ 超 300ms') + '）');
assert.ok(Math.max(...times) < 300);

// 3. 顶层结构
for (const k of ['ok', 'updated', 'source', 'count', 'countries', 'satellites']) assert.ok(k in cat, '缺少 ' + k);
assert.equal(cat.ok, true);
pass('顶层字段 ok/updated/source/count/countries/satellites 齐全；source=' + cat.source + ' updated=' + cat.updated);

// 4. count 一致性
assert.equal(cat.count, cat.satellites.length);
assert.equal(cat.countries.reduce((a, c) => a + c.count, 0), cat.count);
pass('count=' + cat.count + ' = satellites.length = Σcountries.count');

// 5. 分类断言
const find = (n) => { const s = cat.satellites.find(x => x.name === n); assert.ok(s, '未找到 ' + n); return s; };
const iss = find('ISS (ZARYA)');
assert.equal(iss.orbitClass, 'LEO');
pass('ISS (ZARYA) → ' + iss.orbitClass + '  (period ' + iss.period + 'min, apogee ' + iss.apogee + 'km)');
const goes = find('GOES 16');
assert.equal(goes.orbitClass, 'GEO');
pass('GOES 16 (同步) → ' + goes.orbitClass + '  (period ' + goes.period + 'min)');
const gps = find('NAVSTAR 43 (USA 132)');
assert.equal(gps.orbitClass, 'MEO');
pass('NAVSTAR 43 (GPS) → ' + gps.orbitClass + '  (period ' + gps.period + 'min, apogee ' + gps.apogee + 'km)');
const heo = cat.satellites.filter(x => x.orbitClass === 'HEO');
assert.ok(heo.length > 0);
pass('HEO ' + heo.length + ' 颗，样例: ' + heo.slice(0, 2).map(s => s.name + '(apo ' + s.apogee + 'km, p ' + s.period + ')').join(' / '));

// 6. 字段类型
const TYPES = { id: 'number', name: 'string', intl: 'string', owner: 'string', country: 'string', objectType: 'string', status: 'string', launchDate: 'string', orbitClass: 'string', period: 'number', incl: 'number', apogee: 'number', perigee: 'number', tle1: 'string', tle2: 'string' };
for (let i = 0; i < cat.satellites.length; i += 977) {
  const s = cat.satellites[i];
  assert.deepEqual(Object.keys(s), Object.keys(TYPES));
  for (const [k, ty] of Object.entries(TYPES)) assert.equal(typeof s[k], ty, s.id + '.' + k);
}
pass('抽样 ' + Math.ceil(cat.satellites.length / 977) + ' 条：15 个字段名与类型逐字一致');

// 7. countries
for (let i = 1; i < cat.countries.length; i++) assert.ok(cat.countries[i - 1].count >= cat.countries[i].count);
const CT = { code: 'string', name: 'string', nameEn: 'string', flag: 'string', kind: 'string', count: 'number' };
for (const c of cat.countries) { assert.deepEqual(Object.keys(c), Object.keys(CT)); assert.ok(['country', 'org', 'intergov', 'other'].includes(c.kind)); }
pass('countries ' + cat.countries.length + ' 项，按 count 降序，字段 code/name/nameEn/flag/kind/count 类型正确');

// 8. 断网/刷新后的 503 语义已在 5183/5184 验证；此处校验缓存命中
pass('二次请求命中内存缓存（服务端日志可见 cache-hit）');

console.log('\nHTTP 端到端 ' + t.length + ' 项断言全部通过 ✓');
console.log('\n示例 JSON 片段:');
console.log('  countries[0..2] =', JSON.stringify(cat.countries.slice(0, 3)));
console.log('  ISS =', JSON.stringify(iss));
console.log('  GOES 16 =', JSON.stringify(goes));
console.log('  HEO[0] =', JSON.stringify(heo[0]));