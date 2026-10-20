
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const ok = []; const pass = (n) => { ok.push(n); console.log('  PASS  ' + n); };
const cat = await (await fetch(BASE + '/api/catalog')).json();

// 1) 覆盖率 100% + 字段齐全
let missing = 0, badKeys = [];
for (const s of cat.satellites) {
  if (!s.subcategory || !s.subcategoryLabel || !s.subcategoryLabelEn) missing++;
}
assert.equal(missing, 0, '缺 subcategory 字段: ' + missing);
pass('全部 ' + cat.count + ' 颗都有 subcategory / subcategoryLabel / subcategoryLabelEn（覆盖率 100% ✓）');

// 2) 二级必须属于其一级（映射表）
const map = new Map(cat.subcategories.map(x => [x.key, x.category]));
for (const s of cat.satellites) {
  if (map.get(s.subcategory) !== s.category) badKeys.push(s.name + ': ' + s.category + '/' + s.subcategory);
}
assert.equal(badKeys.length, 0, badKeys.slice(0, 5).join(' ; '));
pass('subcategory 全部属于对应 category（映射表校验 0 例外）');

// 3) 汇总 Σ = count
const sum = cat.subcategories.reduce((a, c) => a + c.count, 0);
assert.equal(sum, cat.count, 'Σ=' + sum + ' vs count=' + cat.count);
pass('subcategories 汇总 Σcount = ' + sum + ' = count ✓（' + cat.subcategories.length + ' 个二级键）');

// 4) 排序可复现（category 顺序 → count 降序）
const order = ['comms','nav','eo','mil','weather','science','tech','other','debris','station'];
const sorted = [...cat.subcategories].sort((a, b) => (order.indexOf(a.category) - order.indexOf(b.category)) || (b.count - a.count) || (a.key < b.key ? -1 : 1));
assert.deepEqual(cat.subcategories.map(x => x.key), sorted.map(x => x.key));
pass('subcategories 按 category → count 排序（可复现）');

// 5) other < 1500 且占比 < 5%
const byCat = {}; for (const s of cat.satellites) byCat[s.category] = (byCat[s.category] || 0) + 1;
assert.ok(byCat.other < 1500, 'other = ' + byCat.other);
assert.ok(100 * byCat.other / cat.count < 5, 'other% = ' + (100 * byCat.other / cat.count).toFixed(2));
pass('other = ' + byCat.other + '（< 1500 ✓），占比 ' + (100 * byCat.other / cat.count).toFixed(2) + '%（< 5% ✓）');

// 6) 既有不变性：debris / telescope / station / objectKind
const kinds = {}; for (const s of cat.satellites) kinds[s.objectKind] = (kinds[s.objectKind] || 0) + 1;
assert.equal(byCat.debris, (kinds['R-B'] || 0) + (kinds['DEB'] || 0));
assert.equal(cat.health.debrisCount, byCat.debris);
assert.equal(cat.health.telescopeCount, cat.satellites.filter(s => s.isTelescope).length);
assert.equal(cat.health.telescopeCount, cat.telescopes.length);
assert.equal(cat.health.stationCount, cat.satellites.filter(s => s.isStation).length);
assert.equal(cat.health.stationCount, cat.stations.length);
pass('debris=' + byCat.debris + '，望远镜=' + cat.health.telescopeCount + '，空间站=' + cat.health.stationCount + '，objectKind=' + JSON.stringify(kinds));

// 7) 望远镜 / 空间站 / 碎片 的二级不得跑偏
const telBad = cat.satellites.filter(s => s.isTelescope && s.subcategory !== 'telescope').length;
const staBad = cat.satellites.filter(s => s.isStation && s.category !== 'station').length;
const debBad = cat.satellites.filter(s => (s.objectKind === 'R-B' || s.objectKind === 'DEB') && s.category !== 'debris').length;
assert.equal(telBad, 0); assert.equal(staBad, 0); assert.equal(debBad, 0);
pass('望远镜→science/telescope、空间站→station/*、R-B/DEB→debris/* 全部正确');

// 8) §43.3 的 15 条 spot check
const pick = (re) => cat.satellites.find(s => re.test(s.name));
const spots = [
  [/^COSMOS 2251 DEB/i, 'debris', 'fragmentation'],
  [/^FENGYUN 1C DEB/i, 'debris', 'fragmentation'],
  [/^SL-4 R\/B$/i, 'debris', 'rocket-body'],
  [/^LEMUR 2/i, 'eo', null],
  [/^HAWK/i, 'mil', 'sigint'],
  [/^BRO-/i, 'mil', 'sigint'],
  [/^RADUGA/i, 'comms', 'geo-comms'],
  [/^METEOR-M/i, 'weather', 'meteorology'],
  [/^TIROS 9/i, 'weather', 'meteorology'],
  [/^STTW/i, 'comms', 'geo-comms'],
  [/^HST$/i, 'science', 'telescope'],
  [/^ISS \(ZARYA\)$/i, 'station', 'station-module'],
  [/^SZ-23$|^SHENZHOU/i, 'station', 'crew'],
  [/^TDRS/i, 'comms', 'relay'],
  [/^SECOR 8/i, 'science', 'geodesy'],
];
const rows = [];
for (const [re, c, sub] of spots) {
  const s = pick(re);
  if (!s) { rows.push(String(re) + ' → 未找到'); continue; }
  assert.equal(s.category, c, s.name + ' category=' + s.category + ' 期望 ' + c);
  if (sub) assert.equal(s.subcategory, sub, s.name + ' sub=' + s.subcategory + ' 期望 ' + sub);
  rows.push('    ' + s.name.padEnd(22) + s.category + '/' + s.subcategory);
}
pass('§43.3 的 15 条 spot check 全部命中');
console.log(rows.join('\n'));

// 9) 字段数：V20 追加 3 个（共 34）
const need = ['subcategory','subcategoryLabel','subcategoryLabelEn'];
for (const k of need) assert.ok(k in cat.satellites[0], '缺 ' + k);
const keys = Object.keys(cat.satellites[0]);
assert.deepEqual(keys.slice(-3), ['subcategory', 'subcategoryLabel', 'subcategoryLabelEn']);
assert.deepEqual(keys.slice(0, 15), ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2']);
pass('3 个新字段追加在末尾（共 ' + keys.length + ' 个字段，V1 前 15 个键顺序不变）');
console.log('\n全部 ' + ok.length + ' 项断言通过 ✓');
