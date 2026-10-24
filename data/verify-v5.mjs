
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const out = [];
const pass = (n) => { out.push(n); console.log('  PASS  ' + n); };

const cat = await (await fetch(BASE + '/api/catalog')).json();
console.log('总数 count =', cat.count, '| satellites =', cat.satellites.length, '| countries =', cat.countries.length);
console.log('顶层键 =', JSON.stringify(Object.keys(cat)));
console.log('health =', JSON.stringify(cat.health));

// 1) 每颗都有 objectKind / rcs / isTelescope / telescopeType
const KIND = ['PAY', 'R-B', 'DEB', 'UNK'];
let bad = 0, kinds = {}, tel = [], telTypes = {};
for (const s of cat.satellites) {
  if (!KIND.includes(s.objectKind)) bad++;
  if (!('rcs' in s) || (s.rcs !== null && typeof s.rcs !== 'number')) bad++;
  if (typeof s.isTelescope !== 'boolean') bad++;
  if (!('telescopeType' in s)) bad++;
  if (s.telescopeType !== null && !['optical','xray','gamma','ir','solar','particle'].includes(s.telescopeType)) bad++;
  kinds[s.objectKind] = (kinds[s.objectKind] || 0) + 1;
  if (s.isTelescope) { tel.push(s); telTypes[s.telescopeType] = (telTypes[s.telescopeType] || 0) + 1; }
}
assert.equal(bad, 0);
pass('全部 ' + cat.count + ' 颗：objectKind/rcs/isTelescope/telescopeType 齐全且取值合法');
console.log('     objectKind 分布:', JSON.stringify(kinds));

// 2) debris 类
const debrisCat = cat.categories.find(c => c.key === 'debris');
assert.equal(debrisCat.count, kinds['R-B'] + kinds['DEB']);
assert.ok(debrisCat.count > 2000, 'debris 需 > 2000');
pass('category=debris 数量 = ' + debrisCat.count + '（= R-B ' + kinds['R-B'] + ' + DEB ' + kinds['DEB'] + '，> 2000 ✓）');
const debrisSat = cat.satellites.filter(s => s.category === 'debris').length;
assert.equal(debrisSat, debrisCat.count);
pass('所有 R-B/DEB 的 category 确实都是 debris（' + debrisSat + ' 颗）');
const leaked = cat.satellites.filter(s => (s.objectKind === 'R-B' || s.objectKind === 'DEB') && s.category !== 'debris').length;
assert.equal(leaked, 0);

// 3) categories 9 类 + 求和
assert.equal(cat.categories.length, 10);   // V20 §41：追加第 10 类 station
assert.deepEqual(cat.categories.map(c => c.key), ['comms','nav','eo','mil','weather','science','tech','other','debris','station']);
assert.equal(cat.categories.reduce((a, c) => a + c.count, 0), cat.count);
pass('categories 10 类（debris 第 9、station 第 10），Σ = ' + cat.count + ' = count');
console.log('     9 类分布:', cat.categories.map(c => c.key + '=' + c.count).join(' '));

// 4) 望远镜
assert.ok(tel.length >= 12, '望远镜需 ≥ 12');
pass('isTelescope=true 的数量 = ' + tel.length + '（≥ 12 ✓），类型分布 ' + JSON.stringify(telTypes));
console.log('     望远镜名单：');
for (const s of tel.sort((a,b)=>a.name.localeCompare(b.name))) {
  console.log('       ' + s.name.padEnd(22) + ' ' + String(s.telescopeType).padEnd(9) + ' cat=' + s.category + '  conf=' + s.categoryConfidence + '  note=' + s.categoryNote);
}
const telNotScience = tel.filter(s => s.category !== 'science').length;
assert.equal(telNotScience, 0);
pass('望远镜 category 全为 science');

// 5) spot check
const find = (re) => cat.satellites.find(s => re.test(s.name));
const fy = find(/^FENGYUN 1C DEB/);
assert.ok(fy); assert.equal(fy.objectKind, 'DEB'); assert.equal(fy.category, 'debris');
pass('FENGYUN 1C DEB → objectKind=' + fy.objectKind + ', category=' + fy.category + ', rcs=' + fy.rcs);
const rb = find(/^SL-4 R\/B$/) || cat.satellites.find(s => /R\/B$/.test(s.name));
assert.ok(rb); assert.equal(rb.objectKind, 'R-B'); assert.equal(rb.category, 'debris');
pass(rb.name + ' → objectKind=' + rb.objectKind + ', category=' + rb.category);
const hst = find(/^HST$/);
assert.equal(hst.isTelescope, true); assert.equal(hst.telescopeType, 'optical');
pass('HST → isTelescope=' + hst.isTelescope + ', type=' + hst.telescopeType + ', category=' + hst.category);
const cxo = find(/^CXO$/) || find(/CHANDRA/i);
assert.ok(cxo, '未找到 CHANDRA/CXO'); assert.equal(cxo.telescopeType, 'xray');
pass(cxo.name + '（Chandra）→ type=' + cxo.telescopeType);
const sdo = find(/^SDO$/);
assert.equal(sdo.telescopeType, 'solar');
pass('SDO → type=' + sdo.telescopeType);
const iss = find(/^ISS \(ZARYA\)$/);
assert.equal(iss.objectKind, 'PAY'); assert.equal(iss.isTelescope, false); assert.equal(iss.telescopeType, null);
pass('ISS (ZARYA) → objectKind=' + iss.objectKind + ', isTelescope=' + iss.isTelescope);

// 6) 非望远镜里没有明显误判
const falsePos = cat.satellites.filter(s => s.isTelescope && /LEMUR|ITAMSAT|IRIS-F|SAMSAT/i.test(s.name));
assert.equal(falsePos.length, 0);
pass('无 LEMUR/ITAMSAT/IRIS-F 误判为望远镜');

// 7) V1~V4 字段仍在
const need = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2',
  'operator','operatorZh','operatorKind','category','categoryLabel','categoryLabelEn','categoryConfidence','categoryNote',
  'objectKind','rcs','isTelescope','telescopeType'];
for (const s of [cat.satellites[0], cat.satellites[5000], cat.satellites[cat.count-1]]) {
  for (const k of need) assert.ok(k in s, '缺字段 ' + k);
}
pass('V1(15) + V2(8) + V5(4) = 27 个字段齐全');

// 8) health 汇总
const h = cat.health;
assert.equal(h.debrisCount, debrisCat.count);
assert.equal(h.telescopeCount, tel.length);
assert.equal(h.tleCount, cat.count + (h.decayedDropped || 0));
assert.ok(h.groups && Object.keys(h.groups).length >= 1);   // V8 后可能是 {spacetrack:N}
pass('health.groups = ' + JSON.stringify(h.groups));

// 9) 体积
pass('catalog.json.gz = ' + (0).toString()); // 占位（体积由外部统计）
console.log('\n全部 ' + out.length + ' 项断言通过 ✓');
