# 契约 V8 · 接入 Space-Track：全量目标（约 3.5 万）

> 目标：把目标集从 18,606 扩到 Space-Track 全量在轨目录（实测 GP 3LE = 5.6MB / 106,428 行 ≈ 35,476 条）。
> 凭据：已放在 D:\00同步文件\00程序\3D\orbit-holo\data\.spacetrack.env（SPACETRACK_USER / SPACETRACK_PASS），该文件已加入 .gitignore，且 data/ 不在静态托管目录，不会对外泄露。
> ⚠️ 任何日志、错误信息、响应体中**不得**出现账号或密码；凭据只在内存中使用。

## 32. 数据源（server.mjs / data/**）

1. 新增数据源 `spacetrack`：
   - 登录：POST https://www.space-track.org/ajaxauth/login（identity/password，form-urlencoded），拿会话 Cookie；
   - TLE：GET https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/orderby/norad_cat_id/format/3le
     （实测 200 / 5.6MB / ≈35,476 条，3LE 格式：0 NAME + 1 行 + 2 行；注意 NORAD 是 5 位右对齐，可能带前导空格）；
   - 元数据仍用现有 CelesTrak satcat.csv（6.7MB，35,362 条）按 NORAD 关联；找不到的记 objectKind=UNK、country=UNK。
2. 选择策略：
   - 若 data/.spacetrack.env 存在且 `CATALOG_SOURCE` 未显式设为 celestrak →  **优先 spacetrack**；
   - 抓取/IP 受限/登录失败 → 自动回退 CelesTrak 8 组（当前行为），日志写明原因（不含凭据）；
   - `CATALOG_SOURCE=celestrak` 可强制用旧数据源。
3. 解析：3LE 的 name 行可能为空；TLE 1/2 行要按固定列宽解析（行首可能没有补空格）；Alpha-5 编号（A0001=100001）要支持。
4. 分类：沿用现有 classify.mjs（objectKind=R-B/DEB → category=debris；望远镜/空间站规则不变）。
   碎片将大幅增加（预期 debris 1.5 万~2 万量级），`other` 占比仍须 < 25%。
5. 体积/性能：允许 catalog.json 到 ~30MB；但 **gzip 必须 < 4.5MB**；缓存命中 < 400ms；
   冷/热启动记录实测时间。health.groups 增加 `spacetrack: N`，并记录 `sourceDetail: 'spacetrack' | 'celestrak'`。
6. 刷新节流：Space-Track 限速（约 20 次/分钟），一次刷新只允许 2 个请求（登录 + GP）；失败重试最多 1 次，间隔 ≥ 5s。

## 33. UI（public/js/ui.js + public/css/holo.css）

1. 数据源标签：`setDataStatus({ source })` 支持 `spacetrack` → 显示「SPACE-TRACK 在线」，`celestrak` → 「CELESTRAK 在线」，cache → 「本地缓存」。
2. 目标数变多后，左栏国家列表、任务类型计数需正常滚动/更新（应已支持，回归确认）。
3. 碎片数量变多后，「碎片 / 残骸」筛选与对象类型条比例要正常（预期碎片占一半以上）。

## 34. 验收（V8）

1. /api/health：count ≈ 35,000（±5%）、sourceDetail=spacetrack、groups.spacetrack = TLE 条数。
2. /api/catalog：debris 数量 ≥ 12,000；每颗都有 objectKind；望远镜仍 ≥ 19；空间站仍 15 左右。
3. 页面：首屏 < 10s；worker 单次递推 < 40ms；FPS 不明显下降（自适应画质可用）；碎片筛选数量与 health 一致。
4. 凭据不泄露：日志、错误响应、catalog.json 中都不出现账号密码（grep 校验）。
5. 断网/登录失败时回退 CelesTrak，页面仍可用；V1~V7 行为回归通过。
