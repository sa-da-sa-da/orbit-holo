
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCatalog, classifyOrbit, parseTleText, COUNTRY_MAP, countryInfo } from '../server.mjs';

const D = fileURLToPath(new URL('.', import.meta.url));
const ok = [];
const t = (name, fn) => { fn(); ok.push(name); console.log('  PASS  ' + name); };

console.log('== 1. 轨道分类规则 §3.3 ==');
t('ISS 周期 92.97 / 远地点 424 → LEO', () => assert.equal(classifyOrbit(92.97, 424), 'LEO'));
t('GOES 16 周期 1436.1 / 远地点 35790 → GEO', () => assert.equal(classifyOrbit(1436.1, 35790), 'GEO'));
t('NAVSTAR 43 周期 717.97 / 远地点 20465 → MEO', () => assert.equal(classifyOrbit(717.97, 20465), 'MEO'));
t('MOLNIYA 周期 717.8 / 远地点 39400 → HEO', () => assert.equal(classifyOrbit(717.8, 39400), 'HEO'));
t('MOLNIYA 周期 717.8 / 近地点 500 (远地点 39800) → HEO', () => assert.equal(classifyOrbit(717.8, 39800), 'HEO'));
t('period=null → OTHER', () => assert.equal(classifyOrbit(null, 500), 'OTHER'));
t('period=0 → OTHER', () => assert.equal(classifyOrbit(0, 500), 'OTHER'));
t('GEO 边界 1400 / 1470', () => { assert.equal(classifyOrbit(1400, 999999), 'GEO'); assert.equal(classifyOrbit(1470, 999999), 'GEO'); });
t('GEO 边界外 1399 / 1471 不是 GEO', () => { assert.notEqual(classifyOrbit(1399, 36000), 'GEO'); assert.notEqual(classifyOrbit(1471, 36000), 'GEO'); });
t('LEO 边界 1999 → LEO / 2000 → MEO', () => { assert.equal(classifyOrbit(100, 1999), 'LEO'); assert.equal(classifyOrbit(100, 2000), 'MEO'); });
t('MEO 边界 33999 → MEO / 34000 → HEO', () => { assert.equal(classifyOrbit(700, 33999), 'MEO'); assert.equal(classifyOrbit(700, 34000), 'HEO'); });

console.log('== 2. 国家映射表覆盖 §3.4 全部 99 个代码 ==');
const NINETY_NINE = 'US PRC UK CIS TBD JPN IT SKOR FR IND GER ESA SPN CA TURK SES ITSO O3B AUS FIN EUTE GLOB ROC ARGN UAE NOR GREC ISRA SING POL SAUD ORB BRAZ IM LUXE IRAN POR BEL INDO EGYP AB EUME SWTZ MALA THAI NETH RWA PAKI BUL ALG DEN AC ISS KAZ MEX ABS BELA AZER MA HUN VTNM NIG CZCH ASRA SWED SVN SVK KWT RP LTU UKR CHLE CHBZ VENZ SAFR FRIT ECU ROM NICO RASC DJI STCT SLB BHR BWA MNE HRV NZ JOR GRSA TMMC PERU LAOS ETH BGD NKOR BOL IRAQ ANG'.split(/\s+/);
t('契约列出 99 个代码', () => assert.equal(NINETY_NINE.length, 99));
t('COUNTRY_MAP 恰好 99 项', () => assert.equal(Object.keys(COUNTRY_MAP).length, 99));
t('99 个代码全部命中映射表', () => { for (const c of NINETY_NINE) assert.ok(COUNTRY_MAP[c], '缺少 ' + c); });
t('映射表没有多余代码', () => { for (const c of Object.keys(COUNTRY_MAP)) assert.ok(NINETY_NINE.includes(c), '多余 ' + c); });
t('字段 name/nameEn/flag/kind 全部非空且合法', () => {
  for (const [c, v] of Object.entries(COUNTRY_MAP)) {
    assert.ok(v.name && v.nameEn && v.flag, c + ' 字段缺失');
    assert.ok(['country', 'org', 'intergov', 'other'].includes(v.kind), c + ' kind 非法: ' + v.kind);
  }
});
t('已知判定抽查 (US/PRC/CIS/ESA/ISS/TBD/SES)', () => {
  assert.equal(COUNTRY_MAP.US.name, '美国'); assert.equal(COUNTRY_MAP.PRC.name, '中国');
  assert.equal(COUNTRY_MAP.CIS.name, '俄罗斯/独联体'); assert.equal(COUNTRY_MAP.ESA.kind, 'intergov');
  assert.equal(COUNTRY_MAP.ISS.kind, 'intergov'); assert.equal(COUNTRY_MAP.TBD.kind, 'other');
  assert.equal(COUNTRY_MAP.SES.kind, 'org');
});
t('未列出代码 → {"其他(X)", nameEn=X, 🛰️, other}', () => {
  const i = countryInfo('ZZZ');
  assert.deepEqual(i, { code: 'ZZZ', name: '其他(ZZZ)', nameEn: 'ZZZ', flag: '🛰️', kind: 'other' });
});

console.log('== 3. 真实数据合并 §3.2/§3.3 ==');
const tleText = fs.readFileSync(D + 'tle-active.txt', 'utf8');
let satcatText = fs.readFileSync(D + 'satcat-active.json', 'utf8');
const built = buildCatalog(tleText, satcatText);
t('卫星数 = TLE 组数 15927', () => assert.equal(built.satellites.length, 15927));
t('countries 数 = 99', () => assert.equal(built.countries.length, 99));
t('countries count 之和 = 卫星条数', () => {
  const sum = built.countries.reduce((a, c) => a + c.count, 0);
  assert.equal(sum, built.satellites.length);
});
t('countries 按 count 严格降序', () => {
  for (let i = 1; i < built.countries.length; i++) assert.ok(built.countries[i - 1].count >= built.countries[i].count);
});
t('每颗卫星 country 都出现在 countries[] 中', () => {
  const codes = new Set(built.countries.map(c => c.code));
  for (const s of built.satellites) assert.ok(codes.has(s.country), 'missing ' + s.country);
});
const FIELDS = { id: 'number', name: 'string', intl: 'string', owner: 'string', country: 'string', objectType: 'string', status: 'string', launchDate: 'string', orbitClass: 'string', period: 'number', incl: 'number', apogee: 'number', perigee: 'number', tle1: 'string', tle2: 'string',
  // —— V2 §7 新增 ——
  operator: 'string', operatorZh: 'string', operatorKind: 'string', category: 'string', categoryLabel: 'string', categoryLabelEn: 'string', categoryConfidence: 'string', categoryNote: 'string' };
t('23 个字段名与类型逐字一致（V1 15 + V2 8）', () => {
  const sample = [built.satellites[0], built.satellites[300], built.satellites[8000], built.satellites[15000]];
  for (const s of sample) {
    // V5 之后字段会继续增加，这里只校验「前 N 个字段名与顺序一致」+ 全部存在
    assert.deepEqual(Object.keys(s).slice(0, Object.keys(FIELDS).length), Object.keys(FIELDS), '字段顺序/名称不一致: ' + Object.keys(s));
    for (const [k, ty] of Object.entries(FIELDS)) assert.equal(typeof s[k], ty, k + ' 类型应为 ' + ty);
  }
});
t('orbitClass 仅 LEO/MEO/GEO/HEO/OTHER', () => {
  for (const s of built.satellites) assert.ok(['LEO', 'MEO', 'GEO', 'HEO', 'OTHER'].includes(s.orbitClass), s.name);
});
t('分类分布', () => {
  const c = {};
  for (const s of built.satellites) c[s.orbitClass] = (c[s.orbitClass] || 0) + 1;
  console.log('        分布:', JSON.stringify(c));
});
t('ISS (ZARYA) → LEO', () => {
  const s = built.satellites.find(x => x.id === 25544);
  assert.equal(s.orbitClass, 'LEO'); assert.equal(s.name, 'ISS (ZARYA)');
});
t('GOES 16 → GEO', () => {
  const s = built.satellites.find(x => x.name === 'GOES 16');
  assert.ok(s, '未找到 GOES 16'); assert.equal(s.orbitClass, 'GEO');
});
t('NAVSTAR 43 (GPS) → MEO', () => {
  const s = built.satellites.find(x => x.name === 'NAVSTAR 43 (USA 132)');
  assert.ok(s, '未找到 NAVSTAR 43'); assert.equal(s.orbitClass, 'MEO');
});
t('HEO 卫星存在且 apogee>34000 或 period>1470', () => {
  const heos = built.satellites.filter(x => x.orbitClass === 'HEO');
  assert.ok(heos.length > 0);
  for (const s of heos) assert.ok(s.apogee >= 34000, s.name + ' apo=' + s.apogee);
  console.log('        HEO 样例:', heos.slice(0, 3).map(s => s.name + ' apo=' + s.apogee + ' p=' + s.period).join(' | '));
});
t('TLE1/TLE2 与 id 对应（1/2 行 NORAD 一致）', () => {
  for (const s of built.satellites.slice(0, 2000)) {
    const n = Number(s.tle1.slice(2, 7));
    assert.equal(n, s.id);
    assert.equal(Number(s.tle2.slice(2, 7)), s.id);
  }
});
t('SATCAT 字段落位正确（首个 CALSPHERE 1）', () => {
  const s = built.satellites[0];
  assert.equal(s.id, 900); assert.equal(s.intl, '1964-063C'); assert.equal(s.owner, 'US');
  assert.equal(s.launchDate, '1964-10-06'); assert.equal(s.objectType, 'PAY'); assert.equal(s.status, '+');
});

console.log('== 4. 健壮性：脏数据不抛异常 ==');
t('BOM + 短行 + 缺失行 + 重复 NORAD + 非 ASCII 名称', () => {
  const tle = '\uFEFFISS (ZARYA)              \n1 25544U 98067A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 25544  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\n\n   \n1 00001\n2 00002\n中文卫星 甲           \n1 90001U 26001A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 90001  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\nDUP SAT\n1 25544U 98067A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 25544  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\nA0001 SAT\n1 A0001U 98067A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 A0001  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\n';
  const satcat = '\uFEFF[{"NORAD_CAT_ID":25544,"OBJECT_NAME":"ISS","OBJECT_ID":"1998-067A","OBJECT_TYPE":"PAY","OPS_STATUS_CODE":"+","OWNER":"ISS","LAUNCH_DATE":"1998-11-20","DECAY_DATE":"2026-01-01","PERIOD":92.9,"INCLINATION":51.64,"APOGEE":420,"PERIGEE":415},{"NORAD_CAT_ID":90001,"OBJECT_NAME":"X","OWNER":null,"PERIOD":null,"APOGEE":null,"INCLINATION":null,"OBJECT_TYPE":null,"OPS_STATUS_CODE":null,"DECAY_DATE":"","OBJECT_ID":null,"LAUNCH_DATE":null},]';
  const b = buildCatalog(tle, satcat);
  assert.equal(b.satellites.length, 3, '期望 3 条（重复 NORAD 去重、残行忽略）');
  assert.equal(b.duplicates, 1);
  assert.ok(b.malformed >= 1, 'malformed=' + b.malformed);
  const iss = b.satellites.find(s => s.id === 25544);
  assert.equal(iss.orbitClass, 'LEO');
  assert.equal(iss.intl, '1998-067A');
  const cn = b.satellites.find(s => s.name === '中文卫星 甲');
  assert.ok(cn, 'UTF-8 名称丢失');
  assert.equal(cn.owner, 'UNK', '缺 SATCAT 字段 → owner=UNK');
  assert.equal(cn.country, 'UNK');
  const alpha = b.satellites.find(s => s.id === 100001);
  assert.ok(alpha, 'Alpha-5 编号解析失败');
  for (const s of b.satellites) { assert.equal(typeof s.period, 'number'); assert.equal(typeof s.apogee, 'number'); }
});
t('SATCAT 非数组 / 空串 / 截断 JSON 不崩溃', () => {
  const tle = 'X\n1 90001U 26001A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 90001  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\n';
  const b1 = buildCatalog(tle, '');
  assert.equal(b1.satellites.length, 1);
  assert.equal(b1.satellites[0].owner, 'UNK');
  assert.equal(b1.satellites[0].intl, '');
  const b2 = buildCatalog(tle, '{"records":[{"NORAD_CAT_ID":90001,"OWNER":"PRC","PERIOD":100,"APOGEE":500}]}');
  assert.equal(b2.satellites[0].owner, 'PRC');
  let threw = false;
  try { buildCatalog(tle, '[{"NORAD_CAT_ID":90001,'); } catch { threw = true; }
  console.log('        截断 JSON 是否抛出:', threw, '(允许抛出，由上层回退处理)');
});
t('DECAY_DATE 非空 / OWNER 空串 / 未知代码 均正常', () => {
  const tle = 'A\n1 90001U 26001A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 90001  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\nB\n1 90002U 26001A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 90002  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\n';
  const satcat = JSON.stringify([
    { NORAD_CAT_ID: 90001, OWNER: 'ZZZ', PERIOD: 92, APOGEE: 400, INCLINATION: 51, DECAY_DATE: '2026-05-01', OBJECT_TYPE: 'DEB', OPS_STATUS_CODE: 'X' },
    { NORAD_CAT_ID: 90002, OWNER: '', PERIOD: 92, APOGEE: 400, INCLINATION: 51, DECAY_DATE: '', OBJECT_TYPE: 'R/B', OPS_STATUS_CODE: '' },
  ]);
  const b = buildCatalog(tle, satcat);
  const a = b.satellites.find(s => s.id === 90001);
  assert.equal(a.owner, 'ZZZ'); assert.equal(a.country, 'ZZZ'); assert.equal(a.objectType, 'DEB'); assert.equal(a.status, 'X');
  const unknown = b.countries.find(c => c.code === 'ZZZ');
  assert.deepEqual(unknown, { code: 'ZZZ', name: '其他(ZZZ)', nameEn: 'ZZZ', flag: '🛰️', kind: 'other', count: 1 });
  const bs = b.satellites.find(s => s.id === 90002);
  assert.equal(bs.owner, 'UNK'); assert.equal(bs.objectType, 'R/B');
});
t('parseTleText 空输入', () => {
  assert.equal(parseTleText('').records.length, 0);
  assert.equal(parseTleText(null).records.length, 0);
});

console.log('== 5. V2 §7 运营方 / 任务类型 ==');
const CATS = ['comms','nav','eo','mil','weather','science','tech','other','debris','station'];   // V5 追加 debris，V20 追加 station
const KINDS = ['company','agency','military','intergov','academic','unknown'];
const CONFS = ['high','medium','low'];

t('每颗卫星 8 个 V2 字段齐全、取值合法、note<=40', () => {
  for (const s of built.satellites) {
    assert.equal(typeof s.operator, 'string'); assert.ok(s.operator.length > 0, s.name + ' operator 为空');
    assert.ok(s.operatorZh && s.operatorZh.trim().length > 0, s.name + ' operatorZh 为空');
    assert.ok(KINDS.includes(s.operatorKind), s.name + ' operatorKind=' + s.operatorKind);
    assert.ok(CATS.includes(s.category), s.name + ' category=' + s.category);
    assert.ok(CONFS.includes(s.categoryConfidence), s.name + ' confidence=' + s.categoryConfidence);
    assert.ok(s.categoryNote.length <= 40, s.name + ' note 过长');
    assert.equal(s.categoryLabel, { comms:'通信 / 互联网', nav:'导航 / 定位', eo:'对地观测 / 遥感', mil:'军事 / 侦察', weather:'气象 / 海洋 / 环境', science:'科学 / 深空 / 载人', tech:'技术试验 / 教育 / 业余', other:'其他 / 未分类', debris:'碎片 / 残骸', station:'空间站 / 载人' }[s.category]);
  }
});
t('categories ≥8 类、Σcount 与 satellites 一致', () => {
  assert.ok(built.categories.length >= 8);
  assert.deepEqual(built.categories.map(c => c.key), CATS);
  assert.equal(built.categories.reduce((a, c) => a + c.count, 0), built.satellites.length);
});
t('topOperators 计数与 satellites 一致且降序', () => {
  const cnt = new Map();
  for (const s of built.satellites) cnt.set(s.operator, (cnt.get(s.operator) || 0) + 1);
  for (const o of built.topOperators) assert.equal(cnt.get(o.name), o.count, o.name);
  for (let i = 1; i < built.topOperators.length; i++) assert.ok(built.topOperators[i-1].count >= built.topOperators[i].count);
});
t('other 占比 < 25%', () => {
  const other = built.categories.find(c => c.key === 'other').count;
  const pct = 100 * other / built.satellites.length;
  assert.ok(pct < 25, 'other=' + pct.toFixed(2) + '%');
  console.log('        other 占比 ' + pct.toFixed(2) + '% (' + other + ' 颗)');
});
t('spot check：STARLINK/ONEWEB/NAVSTAR/GOES/FY/SENTINEL/LANDSAT/GF/ISS/CSS/USA/YAOGAN/CUBESAT/BEIDOU/GLONASS', () => {
  const one = (re) => { const s = built.satellites.find(x => re.test(x.name)); assert.ok(s, '未找到 ' + re); return s; };
  const eq = (re, cat, op) => { const s = one(re); assert.equal(s.category, cat, s.name + ' 期望 ' + cat + ' 实际 ' + s.category); if (op) assert.equal(s.operator, op, s.name); return s; };
  eq(/^STARLINK/i, 'comms', 'SpaceX');
  eq(/^ONEWEB/i, 'comms', 'Eutelsat OneWeb');
  eq(/^NAVSTAR/i, 'nav');
  eq(/^GOES/i, 'weather');
  eq(/^FENGYUN/i, 'weather');
  eq(/^SENTINEL/i, 'eo');
  eq(/^LANDSAT/i, 'eo');
  eq(/^GAOFEN/i, 'eo');
  eq(/^ISS \(ZARYA\)/i, 'station');    // V20：空间站独立成一级类目
  eq(/^CSS \(TIANHE\)/i, 'station');
  eq(/^USA \d/i, 'mil');
  const yg = eq(/^YAOGAN/i, 'mil'); assert.ok(yg.categoryNote.indexOf('侦察') >= 0, 'YAOGAN 需在 note 说明');
  eq(/CUBESAT/i, 'tech');
  eq(/^BEIDOU/i, 'nav');
  eq(/GLONASS/i, 'nav');
});
t('可复现：同输入两次构建，V2 汇总与分类完全一致', () => {
  const again = buildCatalog(tleText, satcatText);
  assert.equal(JSON.stringify(again.categories), JSON.stringify(built.categories));
  assert.equal(JSON.stringify(again.topOperators), JSON.stringify(built.topOperators));
  let diff = 0;
  for (let i = 0; i < built.satellites.length; i++) {
    const a = built.satellites[i], b = again.satellites[i];
    if (a.category !== b.category || a.operator !== b.operator || a.categoryConfidence !== b.categoryConfidence) diff++;
  }
  assert.equal(diff, 0);
});
t('V2 脏数据兜底：无名称/SATCAT 缺失时也有 operator 与 category', () => {
  const b = buildCatalog('X\n1 90001U 26001A   26292.75756895  .00007600  00000+0  14619-3 0  9999\n2 90001  51.6325  43.6462 0006748 284.4745  75.5495 15.48944864591067\n', '');
  assert.equal(b.satellites[0].operator, 'UNK');
  assert.equal(b.satellites[0].category, 'other');
  assert.equal(b.satellites[0].categoryConfidence, 'low');
});

console.log('\n全部 ' + ok.length + ' 项断言通过 ✓');