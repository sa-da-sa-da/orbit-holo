
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const ok = []; const pass = (n) => { ok.push(n); console.log('  PASS  ' + n); };
const cat = await (await fetch(BASE + '/api/catalog')).json();
const h = cat.health;
console.log('count=' + cat.count, 'source=' + cat.source, 'sourceDetail=' + h.sourceDetail);

assert.ok(cat.count > 33000 && cat.count < 38000, 'count 应 ≈35000，实际 ' + cat.count);
assert.equal(cat.count, cat.satellites.length);
pass('count = ' + cat.count + '（§34.1 约 35,000 ±5%）');

const byCat = {}; for (const s of cat.satellites) byCat[s.category] = (byCat[s.category] || 0) + 1;
assert.ok(byCat.debris >= 12000, 'debris 应 ≥12000，实际 ' + byCat.debris);
assert.equal(byCat.debris, h.debrisCount);
const otherPct = 100 * byCat.other / cat.count;
assert.ok(otherPct < 25, 'other 占比 ' + otherPct.toFixed(2) + '%');
pass('debris = ' + byCat.debris + '（≥12000 ✓）; other 占比 ' + otherPct.toFixed(2) + '%（<25% ✓）');
console.log('     9 类: ' + JSON.stringify(byCat));

const kinds = {}; let badKind = 0;
for (const s of cat.satellites) {
  if (!['PAY', 'R-B', 'DEB', 'UNK'].includes(s.objectKind)) badKind++;
  kinds[s.objectKind] = (kinds[s.objectKind] || 0) + 1;
}
assert.equal(badKind, 0);
pass('每颗都有合法 objectKind: ' + JSON.stringify(kinds));

assert.ok(cat.telescopes.length >= 19, '望远镜 ' + cat.telescopes.length);
assert.ok(cat.stations.length >= 12 && cat.stations.length <= 25, '空间站 ' + cat.stations.length);
pass('telescopes = ' + cat.telescopes.length + '（≥19 ✓）, stations = ' + cat.stations.length + '（12~25 ✓）');

assert.ok(['spacetrack', 'celestrak'].includes(h.sourceDetail), 'sourceDetail=' + h.sourceDetail);
assert.ok(h.groups && Object.keys(h.groups).length >= 1);
pass('sourceDetail = ' + h.sourceDetail + ', groups = ' + JSON.stringify(h.groups));

if (h.sourceDetail === 'spacetrack') {
  assert.ok(Number.isFinite(h.groups.spacetrack), 'groups.spacetrack 缺失');
  pass('groups.spacetrack = ' + h.groups.spacetrack + '（= TLE 条数）');
}

const need = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2',
 'operator','operatorZh','operatorKind','category','categoryLabel','categoryLabelEn','categoryConfidence','categoryNote',
 'objectKind','rcs','isTelescope','telescopeType','tleEpoch','tleAgeHours','isStation','stationType'];
for (const s of [cat.satellites[0], cat.satellites[20000], cat.satellites[cat.count-1]]) for (const k of need) assert.ok(k in s, '缺 ' + k);
pass('31 个字段齐全（V1 15 + V2 8 + V5 4 + V6 2 + V7 2）');

const raw = JSON.stringify(cat);
assert.ok(!/SPACETRACK_USER|SPACETRACK_PASS|"password"|"identity"/i.test(raw), '响应体疑似含凭据字段');
pass('响应体不含任何凭据字段（SPACETRACK_USER/PASS/password/identity）');
console.log('\n全部 ' + ok.length + ' 项断言通过 ✓');
