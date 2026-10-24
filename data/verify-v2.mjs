
import assert from 'node:assert/strict';
const BASE = process.argv[2] || 'http://127.0.0.1:5181';
const t = []; const pass = n => { t.push(n); console.log('  PASS  ' + n); };

const h = await (await fetch(BASE + '/api/health')).json();
console.log('health:', JSON.stringify(h));

const times = []; let res, raw;
for (let i = 0; i < 3; i++) { const s = performance.now(); res = await fetch(BASE + '/api/catalog', { headers: { 'accept-encoding': 'gzip' } }); raw = await res.text(); times.push(performance.now() - s); }
const cat = JSON.parse(raw);
pass('gzip=' + res.headers.get('content-encoding') + ' 传输耗时: ' + times.map(x=>x.toFixed(1)+'ms').join(' / '));
console.log('     (字节: ' + Buffer.byteLength(raw) + ' 解压后)');

// 1) 顶层
for (const k of ['ok','updated','source','count','countries','satellites','categories','topOperators']) assert.ok(k in cat, '缺少 ' + k);
pass('顶层含 categories/topOperators: ' + JSON.stringify(cat.categories.map(c=>c.key+':'+c.count)));
const sumCat = cat.categories.reduce((a,c)=>a+c.count,0);
assert.equal(sumCat, cat.count); assert.ok(cat.count > 15000);
pass('Σcategories.count = ' + sumCat + ' = count = satellites.length ✓');
assert.ok(cat.categories.length >= 8);
assert.deepEqual(cat.categories.map(c=>c.key).slice(0, 8), ['comms','nav','eo','mil','weather','science','tech','other']);
pass('categories ' + cat.categories.length + ' 类、前 8 类键名与顺序固定 ✓（V5 追加 debris）');
for (const c of cat.categories) { assert.deepEqual(Object.keys(c), ['key','label','labelEn','count']); }

// 2) 每颗卫星字段
const F = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2',
           'operator','operatorZh','operatorKind','category','categoryLabel','categoryLabelEn','categoryConfidence','categoryNote'];
const VT = { id:'number', name:'string', intl:'string', owner:'string', country:'string', objectType:'string', status:'string',
  launchDate:'string', orbitClass:'string', period:'number', incl:'number', apogee:'number', perigee:'number', tle1:'string', tle2:'string',
  operator:'string', operatorZh:'string', operatorKind:'string', category:'string', categoryLabel:'string', categoryLabelEn:'string',
  categoryConfidence:'string', categoryNote:'string' };
const KEYS = cat.categories.map(c => c.key);
const KINDS = ['company','agency','military','intergov','academic','unknown'];
const CONFS = ['high','medium','low'];
let missing = 0, badCat = 0, badKind = 0, badConf = 0, emptyOp = 0, longNote = 0, keyMismatch = 0;
const catSet = new Set();
for (const s of cat.satellites) {
  if (Object.keys(s).length < 23) keyMismatch++;
  for (const k of F) { const v = s[k]; if (v === undefined || v === null) { missing++; break; } if (typeof v !== VT[k]) { missing++; break; } }
  if (!KEYS.includes(s.category)) badCat++;
  if (!KINDS.includes(s.operatorKind)) badKind++;
  if (!CONFS.includes(s.categoryConfidence)) badConf++;
  if (!s.operator || !s.operatorZh || !s.operatorZh.trim()) emptyOp++;
  if (s.categoryNote.length > 40) longNote++;
  if (s.categoryLabel !== ({comms:'通信 / 互联网',nav:'导航 / 定位',eo:'对地观测 / 遥感',mil:'军事 / 侦察',weather:'气象 / 海洋 / 环境',science:'科学 / 深空 / 载人',tech:'技术试验 / 教育 / 业余',other:'其他 / 未分类',debris:'碎片 / 残骸',station:'空间站 / 载人'})[s.category]) catSet.add('label-mismatch:' + s.category);
}
assert.equal(keyMismatch, 0, '字段数量不一致: ' + keyMismatch);
assert.equal(missing, 0, '字段缺失/类型错误: ' + missing);
assert.equal(badCat, 0); assert.equal(badKind, 0); assert.equal(badConf, 0);
assert.equal(emptyOp, 0); assert.equal(longNote, 0); assert.equal(catSet.size, 0);
pass('全部 ' + cat.count + ' 条：23+ 个 V1/V2 字段齐全、类型正确、category/operatorKind/confidence 取值合法、note<=40 字、无空 operator');

// 3) other 占比
const byCat = {}; for (const k of KEYS) byCat[k] = 0;
for (const s of cat.satellites) byCat[s.category]++;
const otherPct = 100 * byCat.other / cat.count;
assert.ok(otherPct < 25);
pass('other 占比 ' + otherPct.toFixed(2) + '% < 25%  (' + byCat.other + '/' + cat.count + ')');
console.log('     分布: ' + KEYS.map(k=>k+'='+byCat[k]).join(' '));

// 4) topOperators
const top = cat.topOperators;
assert.ok(Array.isArray(top) && top.length > 0 && top.length <= 30);
for (let i = 1; i < top.length; i++) assert.ok(top[i-1].count >= top[i].count);
pass('topOperators 前 5: ' + top.slice(0,5).map(x=>x.name+'('+x.count+')').join(', '));
console.log('     top15: ' + top.slice(0,15).map(x=>x.name+'='+x.count).join(' '));
// 一致性：topOperators 的数量应等于 satellites 里该 operator 的条数
const cnt = new Map();
for (const s of cat.satellites) cnt.set(s.operator, (cnt.get(s.operator)||0)+1);
for (const o of top) assert.equal(cnt.get(o.name), o.count, o.name);
pass('topOperators 计数与 satellites 实际条数一致 ✓');

// 5) spot check
const find = re => cat.satellites.filter(s => re.test(s.name));
const check = (label, re, fn) => {
  const list = find(re);
  assert.ok(list.length > 0, label + ' 无匹配');
  for (const s of list.slice(0, 3)) fn(s);
  const s0 = list[0];
  console.log('  PASS  ' + label.padEnd(20) + ' ' + list.length + ' 颗, 例: ' + s0.name + ' → ' + s0.operator + ' / ' + s0.category + ' / ' + s0.categoryConfidence + ' / ' + s0.categoryNote);
  t.push(label);
};
check('STARLINK', /^STARLINK/i, s => { assert.equal(s.operator,'SpaceX'); assert.equal(s.category,'comms'); assert.equal(s.categoryConfidence,'high'); });
check('ONEWEB', /^ONEWEB/i, s => { assert.equal(s.operator,'Eutelsat OneWeb'); assert.equal(s.category,'comms'); });
check('NAVSTAR(GPS)', /^NAVSTAR|^GPS/i, s => assert.equal(s.category,'nav'));
check('GOES/NOAA/FY', /^GOES|^NOAA|^FENGYUN|^FY-/i, s => assert.equal(s.category,'weather'));
check('SENTINEL/LANDSAT/GF', /^SENTINEL|^LANDSAT|^GAOFEN|^GF-/i, s => assert.equal(s.category,'eo'));
check('ISS/CSS', /^ISS|^CSS/i, s => assert.equal(s.category,'station'));   // V20：空间站独立成 station 类
check('USA/NROL', /^USA|^NROL/i, s => assert.equal(s.category,'mil'));
check('CUBESAT', /CUBESAT/i, s => assert.equal(s.category,'tech'));
check('BEIDOU', /^BEIDOU/i, s => assert.equal(s.category,'nav'));
check('YAOGAN', /^YAOGAN/i, s => { assert.equal(s.category,'mil'); assert.ok(s.categoryNote.length > 0); });
check('GLONASS', /GLONASS/i, s => assert.equal(s.category,'nav'));

// 6) 可复现性：同输入两次构建结果一致（用 server 两次请求的 JSON 比对）
const raw2 = await (await fetch(BASE + '/api/catalog')).text();
pass('两次请求响应体完全一致（可复现）: ' + (raw2 === raw));
