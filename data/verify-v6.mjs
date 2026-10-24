
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const ok = [];
const pass = (n) => { ok.push(n); console.log('  PASS  ' + n); };
const cat = await (await fetch(BASE + '/api/catalog')).json();
console.log('count =', cat.count, '| 顶层键 =', JSON.stringify(Object.keys(cat)));

// 1) 每颗卫星都有 tleEpoch / tleAgeHours
let bad = 0, nullEpoch = 0, ages = [];
for (const s of cat.satellites) {
  if (typeof s.tleEpoch !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.tleEpoch)) bad++;
  if (typeof s.tleAgeHours !== 'number') bad++;
  if (s.tleEpoch === null) nullEpoch++;
  ages.push(s.tleAgeHours);
}
assert.equal(bad, 0);
pass('全部 ' + cat.count + ' 颗：tleEpoch 为 ISO(Z) 字符串、tleAgeHours 为数字');
const sorted = [...ages].sort((a, b) => a - b);
const med = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[(sorted.length >> 1) - 1] + sorted[sorted.length >> 1]) / 2;
console.log('     龄期：min=' + sorted[0] + 'h  median=' + med.toFixed(1) + 'h  max=' + sorted[sorted.length - 1] + 'h');
assert.equal(cat.health.tleAgeHoursMax, sorted[sorted.length - 1]);
assert.ok(Math.abs(cat.health.tleAgeHoursMedian - med) < 0.11);
pass('health.tleAgeHoursMax=' + cat.health.tleAgeHoursMax + ' / Median=' + cat.health.tleAgeHoursMedian + ' 与逐条统计一致');

// 2) telescopes[]
assert.ok(cat.telescopes.length >= 19, '望远镜应 ≥19，实际 ' + cat.telescopes.length);
assert.equal(cat.telescopes.length, cat.satellites.filter(s => s.isTelescope).length);
for (const t of cat.telescopes) {
  assert.deepEqual(Object.keys(t), ['id', 'name', 'telescopeType', 'orbitClass', 'operator']);
  const src = cat.satellites.find(s => s.id === t.id);
  assert.ok(src && src.isTelescope);
  assert.equal(src.telescopeType, t.telescopeType);
  assert.equal(src.orbitClass, t.orbitClass);
  assert.equal(src.operator, t.operator);
}
pass('telescopes[] = 19 项，字段 {id,name,telescopeType,orbitClass,operator}，与 isTelescope 逐条一致');
console.log('     ' + cat.telescopes.map(t => t.name + '(' + t.telescopeType + ')').join(' '));

// 3) spot check
const pick = (re) => { const s = cat.satellites.find(x => re.test(x.name)); assert.ok(s, '未找到 ' + re); return s; };
for (const [label, re] of [['ISS (ZARYA)', /^ISS \(ZARYA\)$/], ['HST', /^HST$/], ['SL-4 R/B', /^SL-4 R\/B$/]]) {
  const s = pick(re);
  console.log('     ' + label.padEnd(12) + ' tleEpoch=' + s.tleEpoch + '  tleAgeHours=' + s.tleAgeHours);
  // 交叉校验：用 epoch 反推 TLE 第 1 行的 YYDDD
  const tle1 = s.tle1;
  const yy = tle1.slice(18, 20), ddd = tle1.slice(20, 23);
  const year = Number(yy) >= 57 ? 1900 + Number(yy) : 2000 + Number(yy);
  const jan1 = Date.UTC(year, 0, 1);
  const epochMs = Date.parse(s.tleEpoch);
  const doy = (epochMs - jan1) / 86400000 + 1;
  assert.equal(ddd, String(Math.floor(doy)).padStart(3, '0'), label + ' 日序不符');
  // 龄期与 health 的参照时刻一致（差值应在 1 分钟内）
  const impliedBuild = epochMs + s.tleAgeHours * 3600000;
  const updated = Date.parse(cat.updated);
  // tleAgeHours 四舍五入到 0.1h（±3 分钟），容差给 7 分钟
  assert.ok(Math.abs(impliedBuild - updated) < 420000, label + ' 龄期参照时刻偏差过大: ' + (impliedBuild - updated) + 'ms');
}
pass('3 条 spot check：tleEpoch 与 TLE 第 1 行 YYDDD 一致，龄期参照时刻 = catalog.updated');

// 4) 最长龄期对象
const maxSat = cat.satellites.reduce((a, b) => (b.tleAgeHours > a.tleAgeHours ? b : a));
console.log('     最长龄期：' + maxSat.name + ' (' + maxSat.id + ') tleEpoch=' + maxSat.tleEpoch + ' age=' + maxSat.tleAgeHours + 'h');

// 5) V1~V5 字段仍在
const need = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2',
 'operator','operatorZh','operatorKind','category','categoryLabel','categoryLabelEn','categoryConfidence','categoryNote',
 'objectKind','rcs','isTelescope','telescopeType','tleEpoch','tleAgeHours'];
for (const s of [cat.satellites[0], cat.satellites[9000], cat.satellites[cat.count-1]]) for (const k of need) assert.ok(k in s, '缺 ' + k);
pass('V1(15)+V2(8)+V5(4)+V6(2) = 29 个字段齐全');
console.log('\n全部 ' + ok.length + ' 项断言通过 ✓');
