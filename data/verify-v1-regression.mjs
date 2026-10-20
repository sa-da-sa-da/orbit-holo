
import fs from 'node:fs';
// 用法: node verify-v1-regression.mjs [备份 catalog.json 路径]
const B = process.argv[2] || 'D:/00同步文件/00程序/3D/orbit-holo-BACKUP-v1-20261020/data/catalog.json';
const N = 'D:/00同步文件/00程序/3D/orbit-holo/data/catalog.json';
const v1 = JSON.parse(fs.readFileSync(B,'utf8'));
const v2 = JSON.parse(fs.readFileSync(N,'utf8'));
console.log('V1 备份: count='+v1.count+' satellites='+v1.satellites.length+' 顶层键='+JSON.stringify(Object.keys(v1)));
console.log('V2 当前: count='+v2.count+' satellites='+v2.satellites.length+' 顶层键='+JSON.stringify(Object.keys(v2)));
const V1F = ['id','name','intl','owner','country','objectType','status','launchDate','orbitClass','period','incl','apogee','perigee','tle1','tle2'];
// 字段顺序：前 15 个必须与 V1 完全一致
let orderBad=0;
for (const s of v2.satellites) { if (Object.keys(s).slice(0,15).join(',') !== V1F.join(',')) orderBad++; }
console.log('前 15 个字段名与顺序不一致的记录数:', orderBad);
// 值对比
const m1 = new Map(v1.satellites.map(s=>[s.id,s]));
let diffs=0, missing=0; const samples=[];
for (const s2 of v2.satellites) {
  const s1 = m1.get(s2.id);
  if (!s1) { missing++; continue; }
  for (const k of V1F) {
    const a = s1[k], b = s2[k];
    const same = (typeof a === 'object' && a !== null) ? JSON.stringify(a)===JSON.stringify(b) : a===b;
    if (!same) { diffs++; if (samples.length<12) samples.push(s2.name+'#'+s2.id+' .'+k+': '+JSON.stringify(a)+' → '+JSON.stringify(b)); }
  }
}
console.log('V1 字段值差异总数:', diffs, ' 备份中不存在的卫星:', missing);
console.log('差异样例:'); for (const s of samples) console.log('   ' + s);
// countries 对比
const c1 = JSON.stringify(v1.countries), c2 = JSON.stringify(v2.countries);
console.log('countries[] 完全一致:', c1===c2);
console.log('country 分布一致:', JSON.stringify(v1.countries.map(c=>c.code+':'+c.count)) === JSON.stringify(v2.countries.map(c=>c.code+':'+c.count)));
// 顶层 V1 字段
for (const k of ['ok','updated','source','count']) {
  const same = k==='updated' ? '(时间戳允许不同)' : JSON.stringify(v1[k])===JSON.stringify(v2[k]);
  console.log('顶层 '+k+' 一致:', same);
}
// 新字段：23 keys
console.log('每条 23 字段:', v2.satellites.every(s=>Object.keys(s).length===23));
console.log('V2 新增顶层: categories='+v2.categories.length+' topOperators='+v2.topOperators.length);
console.log('文件大小: V1 '+(fs.statSync(B).size/1048576).toFixed(2)+'MB → V2 '+(fs.statSync(N).size/1048576).toFixed(2)+'MB');