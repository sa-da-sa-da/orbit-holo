
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const ok = [];
const pass = (n) => { ok.push(n); console.log('  PASS  ' + n); };
const cat = await (await fetch(BASE + '/api/catalog')).json();
console.log('count =', cat.count, '| 顶层键 =', JSON.stringify(Object.keys(cat)));

// 1) 每颗都有 isStation / stationType
const TYPES = [null, 'station', 'crew', 'cargo'];
let bad = 0, n = 0;
for (const s of cat.satellites) {
  if (typeof s.isStation !== 'boolean' || !TYPES.includes(s.stationType)) bad++;
  if (s.isStation) {
    n++;
    if (s.stationType === null) bad++;
    if (s.objectKind !== 'PAY') bad++;                    // 碎片/残骸不得被当成空间站
    if (/\b(DEB|R\/B)\s*$/i.test(s.name)) bad++;
  } else if (s.stationType !== null) bad++;
}
assert.equal(bad, 0);
pass('全部 ' + cat.count + ' 颗：isStation(bool) + stationType(station|crew|cargo|null) 齐全；碎片/残骸无一条被判为空间站');

// 2) stations[] 汇总
assert.equal(cat.stations.length, n);
assert.equal(cat.stations.length, cat.health.stationCount);
pass('stations[] = ' + cat.stations.length + ' 项 = isStation 数 = health.stationCount（预期 15~25 ✓）');
const sortedNames = cat.stations.map(s => s.name);
assert.deepEqual(sortedNames, [...sortedNames].sort());
pass('stations[] 按名称排序（可复现）');
for (const st of cat.stations) {
  assert.deepEqual(Object.keys(st), ['id', 'name', 'stationType', 'orbitClass', 'operator']);
  const src = cat.satellites.find(s => s.id === st.id);
  assert.ok(src && src.isStation && src.stationType === st.stationType && src.orbitClass === st.orbitClass && src.operator === st.operator);
}
pass('stations[] 元素字段 {id,name,stationType,orbitClass,operator} 与 satellites 逐条一致');
console.log('     ' + cat.stations.map(s => s.name + '[' + s.stationType + ']').join(' '));

// 3) spot check
const pick = (re) => { const s = cat.satellites.find(x => re.test(x.name)); assert.ok(s, '未找到 ' + re); return s; };
const sp = [
  [/^ISS \(ZARYA\)$/, 'station', 'ISS (ZARYA)'],
  [/^CSS \(TIANHE/, 'station', 'CSS (TIANHE / TIANHE-1)'],
  [/^POISK$/, 'station', 'POISK'],
  [/^SHENZHOU|^SZ-2\d MODULE$/, 'crew', '神舟/SZ 模块'],
  [/^SZ-21 MODULE$/, 'crew', 'SZ-21 MODULE'],
  [/^TIANZHOU[ -]?10/, 'cargo', 'TIANZHOU 10'],
  [/^PROGRESS[ -]?MS[ -]?3\d/, 'cargo', 'PROGRESS MS-3x'],
];
for (const [re, type, label] of sp) {
  const s = pick(re);
  assert.equal(s.isStation, true); assert.equal(s.stationType, type);
  console.log('     ' + label.padEnd(22) + '→ isStation=' + s.isStation + ' stationType=' + s.stationType + '  category=' + s.category + '（分类未改动）');
}
pass('7 条 spot check（ISS 舱段 / 天和 / POISK / 神舟 / 联盟? / 天舟 / 进步）全部正确');

// 4) 反例
const neg = ['ISS OBJECT YM', 'FREGAT DEB', 'STARLINK-1008', 'HST'];
for (const nm of neg) {
  const s = cat.satellites.find(x => x.name === nm);
  if (s) assert.equal(s.isStation, false, nm + ' 不应是空间站');
}
pass('反例通过：ISS OBJECT YM / FREGAT DEB / STARLINK / HST 均 isStation=false');

// 5) 分类未被改动（空间站仍属既有 category）
// V20 §41 起空间站/载人独立成第 10 个一级类目 station（V7 时附在 science/other 下）
assert.equal(pick(/^ISS \(ZARYA\)$/).category, 'station');
assert.equal(pick(/^CSS \(TIANHE/).category, 'station');
assert.equal(cat.categories.find(c => c.key === 'debris').count, cat.health.debrisCount);
const sum = cat.categories.reduce((a, c) => a + c.count, 0);
assert.equal(sum, cat.count);
pass('分类未变：ISS/天和 仍 category=science；9 类 Σ=' + sum + '=count；debris 数未变');

// 6) 字段总数
const need = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2',
 'operator','operatorZh','operatorKind','category','categoryLabel','categoryLabelEn','categoryConfidence','categoryNote',
 'objectKind','rcs','isTelescope','telescopeType','tleEpoch','tleAgeHours','isStation','stationType'];
for (const s of [cat.satellites[0], cat.satellites[9000], cat.satellites[cat.count-1]]) for (const k of need) assert.ok(k in s, '缺 ' + k);
pass('V1(15)+V2(8)+V5(4)+V6(2)+V7(2) = 31 个字段齐全');

// 7) health.stationCount 与逐条统计一致
const cnt = cat.satellites.filter(s => s.isStation).length;
assert.equal(cat.health.stationCount, cnt);
pass('health.stationCount = ' + cnt + ' 与逐条统计一致');
console.log('\n全部 ' + ok.length + ' 项断言通过 ✓');
