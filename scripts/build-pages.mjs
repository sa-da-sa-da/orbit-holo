#!/usr/bin/env node
// 把 data/catalog.json 导出为静态部署所需的 public/data/catalog.json.gz
// 用法：node scripts/build-pages.mjs
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');
const src = join(rootDir, 'data', 'catalog.json');
const outDir = join(rootDir, 'public', 'data');
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(src);
const json = JSON.parse(raw.toString('utf8'));
const gz = gzipSync(raw, { level: 9 });
writeFileSync(join(outDir, 'catalog.json.gz'), gz);

const meta = {
  count: json.satellites.length,
  updated: json.updated,
  source: json.source,
  sourceDetail: json.sourceDetail || (json.health && json.health.sourceDetail) || '',
  subcategories: (json.subcategories || []).length,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

console.log('[build:data] 写入 public/data/catalog.json.gz  ' + (gz.length / 1048576).toFixed(2) + ' MB（源 ' + (raw.length / 1048576).toFixed(2) + ' MB）');
console.log('[build:data] 卫星 ' + meta.count + ' · 更新 ' + meta.updated + ' · 二级分类 ' + meta.subcategories);
if (statSync(join(outDir, 'catalog.json.gz')).size > 25 * 1024 * 1024) {
  console.error('[build:data] 警告：超过 Cloudflare Pages 单文件 25MB 限制');
  process.exit(1);
}
