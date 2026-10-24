
---

## 七、V4 修复状态（2026-10-22 更新）

| 编号 | 项 | 状态 | 实现 |
| --- | --- | --- | --- |
| 高1 | 默认监听 0.0.0.0 | ✅ 已修 | 默认 `127.0.0.1`，`--host` / `HOST` 可覆盖，启动日志打印真实地址 |
| 高2 | CORS * + force 无鉴权 | ✅ 已修 | 默认不发 ACAO（`--cors` 才发 `*`）；`force=1` 限流 60s + 后台异步刷新（`X-Refresh-Started` / `X-Refresh-Throttled`） |
| 中3 | 错误详情回传 | ✅ 已修 | 固定 error code（`catalog_unavailable` / `not_found` / `internal_error`），细节只进日志（带 requestId） |
| 中4 | 抓取无大小上限 | ✅ 已修 | 流式读取 + 32MB 上限（`[BODY_TOO_LARGE]` 中断）、Content-Length 预检 |
| 中5 | 无限流与超时 | ✅ 已修 | requestTimeout 30s / headersTimeout 15s / 并发上限 64（503 busy） |
| 中6 | 同步 gzip 阻塞 | ✅ 已修 | `zlib.gzip` promisify，异步 + 结果缓存（上限 24MB） |
| 中7 | force=1 同步等待 | ✅ 已修 | 改为后台刷新，立即返回当前缓存 |
| 低8 | 符号链接未校验 | ✅ 已修 | realpath 二次校验，junction 逃逸 403 |
| 低9 | fetch 无协议/重定向限制 | ✅ 已修 | 仅 http/https，最多 3 次重定向且每跳校验 |
| 低10 | tmp 残留 | ✅ 已修 | 写入失败必删 + 启动清扫 |
| 低11 | 优雅关闭 | ✅ 已修 | `closeAllConnections()` + 1.5s unref 兜底 |
| 低12 | uncaughtException | ✅ 已修 | 打印完整 stack 后 exit 1 |
| 低13 | Worker 无异常保护 | ✅ 已修 | 前端守护：8 秒无响应自动重建 Worker（保留 TLE/时间/观测点） |
| 低14 | 缺安全响应头 | ✅ 已修 | nosniff / X-Frame-Options / Referrer-Policy / CSP（`script-src` 含 `unsafe-inline`，因为 importmap 是内联的；`CSP_MODE=strict` 可切） |
| 低15 | 静态 gzip 缓存无上限 | ✅ 已修 | 24MB 上限 |
| 低16 | 监听错误处理 | ✅ 已修 | EADDRINUSE / EACCES / EADDRNOTAVAIL 分类提示后 exit 1 |
| 低17 | startsWith('..') 误拒 | ✅ 已修 | 改为按解析后相对路径判断合法 |
| D1 | onResetView 未接线 | ✅ 已修 | 底栏「⟲ 重置视角」+ R 键 |
| D2 | 分类顺序不一致 | ✅ 已修 | main 改为契约顺序 comms/nav/eo/mil/weather/science/tech/other |
| D3 | 中文标签缩写 | ✅ 已修 | 补全为「气象 / 海洋 / 环境」「科学 / 深空 / 载人」「技术试验 / 教育 / 业余」 |
| D4 | 轨道默认色不一致 | ✅ 已修 | main 与 ui 统一（MEO #7ea8ff / HEO #c08bff / OTHER #6f8b99） |
| D5 | 过境正文缺 HH:MM | ✅ 已修 | 过境行正文加本地开始时间 |
| M2 | 观测面板缺选点按钮 | ✅ 已修 | 「🎯 在地球上选点」按钮 + 激活态 + 取消（Esc） |
| 数据 | 解析统计未落盘 | ✅ 已修 | `catalog.json` 顶层 `health{duplicates,malformed,noSatcat,tleCount,satcatCount,buildMs}`，`/api/health` 同步返回 |
| 数据 | 真·定时同步 | ⏸ 未做 | 仍为懒刷新（启动/请求时检查 TTL），按既定决定保持 |
| 新增 | 「其他(UNK)」桶 | ℹ️ 说明 | 今日 SATCAT 少 1 条 → 3 颗 TLE 卫星无 SATCAT → owner=UNK，`countries` 变 100 条；卫星数与分类求和不变，保留以保持数据诚实 |

### V4 额外增强（审计外的体验项）

- 时间轴滑块（±24h，可拖动回看/前瞻）、选中卫星「跟随」镜头（F）、一键 PNG 截图、URL 状态分享（`?lat&lon&cat&t&sat&quality`）。
- 自适应画质：FPS<40 连续两次降档、>57 连续三次升档，`?quality=high|medium|low` 可锁定。
- 快捷键帮助浮层（?）、prefers-reduced-motion 支持、移动端底栏重排。
