# 审计报告 · orbit-holo

> 日期：2026-10-21　范围：数据管线 / 契约合规 / 代码安全
> 方法：静态审查 + 契约逐条比对 + 实跑 `data/verify-catalog.mjs`
> 总评：**数据与契约健康，风险集中在服务端默认暴露面**
> 6 小时同步：按你的决定**保持懒刷新**，本章仅记录实证

## 一、结论速览

| 领域 | 结论 | 关键实测 |
| --- | --- | --- |
| 数据管线 | ✅ 优秀 | 15,927 颗；重复 0 / 残行 0 / 缺 SATCAT 0 |
| 契约 V1 | ⚠️ 基本合规 | 15 项 14 符合，`onResetView` 未接线 |
| 契约 V2 | ✅ 全合规 | other 10.48% < 25%；8 类色值一致 |
| 契约 V3 | ⚠️ 基本合规 | 10 项 9 符合，过境 HH:MM 未进正文 |
| 代码安全 | ⚠️ 需整改 | 2 高 / 5 中 / 10 低 |

## 二、数据管线审计 ✅

| 指标 | 实测 | 判定 |
| --- | --- | --- |
| 卫星总数 | 15,927 | ✅ 与 README/契约一致 |
| 国家/组织 | 99 | ✅ 契约 §3.4 要求 99 |
| 轨道分布 | LEO 15125 / GEO 583 / MEO 184 / HEO 35 | ✅ |
| 任务分类 other | 1,669（10.48%） | ✅ < 25% |
| V2 字段缺失 | 0 | ✅ 全部有 operator/category |
| 解析重复 NORAD | 0 | ✅ |
| 解析残行 malformed | 0 | ✅ |
| 缺 SATCAT 记录 | 0 | ✅ |
| gzip 体积 | 1.21 MB | ✅ 契约 < 2.0 MB |
| 原始 catalog | 9.55 MB（TLE 2.55 + SATCAT 5.46） | ✅ |

**缓存新鲜度（与「6 小时同步」直接相关）**

- `updated = 2026-10-20T05:12:45Z`，审计时已 **11.14 小时**未更新。
- 超过 6h TTL，但**尚未刷新**——因为懒刷新只在「启动」或
  「收到 /api/catalog 请求」时才检查过期，服务空闲期间不触发。
- 这是你选择保持现状的已知代价，非缺陷；需要时改主动定时即可。

**建议（非阻塞）**：`buildCatalog` 算出的 `duplicates/malformed/
noSatcat` 未写入 `catalog.json`，外部无法观测解析健康度。可考虑
落盘，便于长期监控。

## 三、契约合规审计

### V1（CONTRACT.md）— 15 项，14 ✅

| 项 | 结果 | 说明 |
| --- | --- | --- |
| createUI 导出 | ✅ | `ui.js:278` |
| handlers 判空 | ⚠️ | `onResetView` 在 ui.js 零调用 |
| ui 方法齐全 | ✅ | `ui.js:2531-2546` |
| 国家列表 ≤120 + 滚动 | ✅ | `ui.js:98,1297` |
| 节流 ≤2 次/秒 | ✅ | `ui.js:1503-1509`（500ms） |
| 零外链/CDN | ✅ | `holo.css` 无 url() |
| 配色 / 字体 / 面板 | ✅ | 与 §5 完全同值 |

服务端侧：`?force=1`、TTL 6h、回退旧缓存、`/api/health`、
目录穿越防护、MIME、gzip 全部 ✅（`server.mjs`）。

### V2（CONTRACT-V2.md）— 7 项全 ✅

- `updateCategories` / `onCategoryToggle` / 8 chips / `#category-bars`
  / 详情卡公司+类型+置信度 / 底部灰字 —— 全部到位。
- 8 类色值在 `main.js` 与 `ui.js` 之间逐项同值，且与契约一致。
- Spot check（STARLINK/ONEWEB/NAVSTAR/GOES/FY/SENTINEL/LANDSAT/
  GF/ISS/CSS/USA/YAOGAN/CUBESAT/BEIDOU/GLONASS）全部通过。
- 分类可复现：同输入两次构建结果完全一致。

### V3（CONTRACT-V3.md）— 10 项，9 ✅

| 项 | 结果 | 说明 |
| --- | --- | --- |
| 概览/观测双 tab | ✅ | `ui.js:1740-1741` |
| #observe-pane 控件 | ✅ | 定位/12 城/手动/清除 |
| #visible-list / #pass-list | ✅ | 点击即选中 |
| 仅高亮可见开关 | ✅ | `onFocusVisibleOnly` |
| 详情卡「观看 VIEWING」 | ✅ | 在 TLE 之前 |
| 5 个新方法 / 6 个 handler | ✅ | main.js 侧齐备 |
| localStorage `holomirror.observer` | ✅ | `main.js:303` |
| tier 阈值 4.5 / 7 | ✅ | `main.js:1047-1051` |
| 过境本地 HH:MM | ⚠️ | 仅 title 与「下次过境」有，正文无 |

### 一致性缺陷（Lead 侧统一即可）

| # | 问题 | 证据 |
| --- | --- | --- |
| D2 | 分类顺序 main 与 ui 不同（weather/mil 互换） | `main.js:28` vs `ui.js:45-54` |
| D3 | main 侧中文标签是缩写（缺「深空」「业余」「环境」） | `main.js:33-36` |
| D4 | 轨道默认色 main 与 ui 不同 | `main.js:23` vs `ui.js:13-17` |
| D5 | 过境正文缺 HH:MM | `ui.js:2244-2248` |
| D1 | `onResetView` 未由 ui 接线 | ui.js 全文无命中 |
| M2 | 观测面板缺「在地球上选点」按钮 | `ui.js:1791-1920` |

## 四、代码与安全审计

做得扎实的部分（无需改动）：目录穿越防护（含 `%2e%2e`、双重编码、
空字节、盘符、8.3 短名全部拦截）、启动绝不因网络失败崩溃、刷新并发
去重无竞态、vendor 完全本地化（three r160 / satellite.js 5.0，零 CDN）、
前端 XSS 全链路 `textContent`、localStorage 读写双 try/catch。

### 🔴 高（建议优先修）

| # | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| 1 | 默认监听 0.0.0.0，日志却打印 127.0.0.1 | `server.mjs:868` | 默认改 127.0.0.1 |
| 2 | CORS * + force=1 无鉴权 | `server.mjs:663,824` | 校验 Origin + 限流 |

### 🟡 中

| # | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| 3 | 内部错误详情回传客户端 | `server.mjs:559,756` | 对外固定文案 |
| 4 | 抓取响应体无大小上限，可 OOM | `server.mjs:476` | 校验长度并截断 |
| 5 | 无限流与请求超时 | `server.mjs:793` | 设 requestTimeout |
| 6 | 同步 gzip 阻塞事件循环 | `server.mjs:403` | 改异步 gzip |
| 7 | `force=1` 同步等待最长 40s 无超时 | `server.mjs:830` | 加超时或改 202 后台刷新 |

### 🟢 低

| # | 问题 | 位置 |
| --- | --- | --- |
| 8 | 符号链接未校验（无 realpath 二次比对） | `server.mjs:691` |
| 9 | fetch 无重定向限制 / 协议白名单 | `server.mjs:462` |
| 10 | tmp 文件失败残留且不清理 | `server.mjs:411-417` |
| 11 | 优雅关闭可能挂住（等 keep-alive） | `server.mjs:911-912` |
| 12 | `uncaughtException` 只 warn 不退出、不打印 stack | `server.mjs:916-917` |
| 13 | Worker 无全局异常保护（tick 每 200ms 刷屏） | `propagate.worker.js:111,363` |
| 14 | 缺安全响应头（nosniff / X-Frame-Options / CSP） | `server.mjs:660,762` |
| 15 | 静态 gzip 缓存无字节上限 | `server.mjs:653` |
| 16 | 非 EADDRINUSE 监听错误只 warn | `server.mjs:883-889` |
| 17 | `startsWith('..')` 误拒 public 下合法 `..` 开头文件 | `server.mjs:681` |

## 五、待办勾选清单

### 安全（按优先级）

- [ ] 高1　默认监听改为 `127.0.0.1`，日志打印真实地址
- [ ] 高2　移除默认 CORS `*`，校验 Origin；`force=1` 加限流
- [ ] 中3　`/api/health` 与 503 不再回传内部错误详情
- [ ] 中4　抓取加 content-length 校验与字节上限
- [ ] 中5　设置 `requestTimeout` / `headersTimeout` / 并发上限
- [ ] 中6　gzip 改异步，避免阻塞事件循环
- [ ] 低13　Worker `onmessage`/`tick` 加 try/catch + 回发 error
- [ ] 低11　优雅关闭用 `closeAllConnections()`，兜底定时器不 unref
- [ ] 低14　补 `nosniff` / `X-Frame-Options` / CSP 响应头

### 契约一致性（Lead 侧）

- [ ] D1　ui.js 接线 `onResetView`（或契约移除该 handler）
- [ ] D2　`main.js:28` 分类顺序改为契约顺序（weather 在 mil 前）
- [ ] D3　`main.js:33-36` 中文标签补全为契约全文案
- [ ] D4　统一 MEO/HEO/OTHER 默认色（与 ui.js 一致）
- [ ] D5　过境条目正文补本地 HH:MM
- [ ] M2　观测面板补「在地球上选点」按钮

### 数据管线（可选增强）

- [ ] 把 `duplicates/malformed/noSatcat` 落盘进 catalog，便于监控
- [ ] 若日后要真·定时同步：加 `setInterval(TTL_MS)` 主动刷新

## 六、复现方式

```bash
node data/verify-catalog.mjs   # 契约 §3.2/§3.3/§3.4 + V2 §7 全量校验
node data/verify-v2.mjs        # V2 增量校验
node data/verify-http.mjs      # 需先启动 server
```

审计结论基于 2026-10-21 的 `data/catalog.json` 快照与当前源码。
