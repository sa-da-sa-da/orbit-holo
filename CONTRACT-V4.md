# 契约 V4 · 精修包（安全加固 + 交互细节 + 新功能）

> 依据 AUDIT.md（2026-10-21 审计报告）与一轮体验复盘。V1/V2/V3 的字段与 API 全部保持兼容。

## 16. 服务端加固（server.mjs）

1. **监听地址**：默认 127.0.0.1，新增 `--host` 参数与 `HOST` 环境变量；启动日志打印真实监听地址。
2. **CORS**：默认**不发送** Access-Control-Allow-Origin（同源即可）；只有显式 `--cors` 或 `CORS=1` 时才发 `*`。
3. **`?force=1` 限流 + 非阻塞**：同一进程内最小间隔 60s；未到间隔返回 200 + `X-Refresh-Throttled: 1` 并附带当前缓存；
   刷新改为**后台异步执行**（立即返回当前数据，`X-Refresh-Started: 1`），不再同步等待 40s。
4. **错误响应脱敏**：对外固定文案（如 `{"ok":false,"error":"catalog_unavailable"}`），内部细节只写日志，日志带 requestId。
5. **抓取防护**：`fetch` 加超时（`CATALOG_FETCH_TIMEOUT_MS`，默认 20000）、响应体大小上限（默认 32MB，超限中断并报错）、
   仅允许 http/https、最多 3 次重定向。
6. **HTTP 健壮性**：`server.requestTimeout`/`headersTimeout` 设置合理值；并发未完成请求数上限（如 64，超出 503）；
   gzip 改异步（`zlib.gzip` promisify）并缓存结果，避免阻塞事件循环。
7. **安全响应头**（静态与 API 都加）：`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、
   `Referrer-Policy: no-referrer`，以及宽松可用 CSP：`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'`。
8. **其它审计项**：静态目录 realpath 二次校验；tmp 文件写入失败清理；监听错误分类型处理（EADDRINUSE 明确提示）；
   优雅关闭用 `server.closeAllConnections()` 且兜底定时器 `unref()`；`uncaughtException` 打印 stack 后按策略退出；
   修复 `startsWith('..')` 对 public 下合法文件的误拒。
9. **可观测性**：`catalog.json` 顶层写入 `health: { duplicates, malformed, noSatcat, tleCount, satcatCount, buildMs }`，
   `/api/health` 返回同样字段。

## 17. UI 细节（public/js/ui.js + public/css/holo.css）

1. 接线 `onResetView`（顶部或底栏加「重置视角」按钮，快捷键 R）。
2. 过境列表与「观看」区块正文补本地 `HH:MM`（不只放 title）。
3. 观测面板加「🎯 在地球上选点」按钮 → 调用 handler `onPickOnGlobe()`；点击后进入选点模式（main 负责），
   按钮进入激活态，并提示「请在地球上点击」；收到 setObserver 后自动取消激活态。
4. **时间轴滑块**（底栏时间条内）：`input[type=range]`，范围 -1440 ~ +1440 分钟，步进 1，
   拖动时调用 handler `onTimeSeek(offsetMinutes)`；右侧显示相对时间（如 现在 / -2h 15m / +30m）；
   每 250ms 由 main 通过 `ui.setClock({ offsetMinutes })` 同步（不打断拖动）。
5. 底栏加两个按钮：「📷 截图」→ `onExportShot()`、「⟲ 重置视角」→ `onResetView()`。
6. 详情卡加「跟随」开关按钮 → `onToggleFollow(enabled)`，按钮态由 `ui.setFollowing(bool)` 控制。
7. **快捷键帮助**：按 `?`（或点底栏「？」）弹出浮层，列出 C / 空格 / Esc / F / R / ? / Shift+点击 / Alt+点击。
8. `prefers-reduced-motion: reduce` 时关闭所有装饰动画（扫描线、呼吸、脉冲）。
9. 保持既有全部行为与节流不变；移动端滑块与按钮不溢出。

## 18. main.js（Lead 实现，UI 只需按上面接口调用）

- 时间轴：`onTimeSeek(offsetMinutes)` 把时钟基准设为 `Date.now() + offset*60000`，保留当前倍速与暂停态；
  拖动结束后 1.5s 若仍在「现在」附近（|offset|<=1）则回到实时。
- 跟随：`onToggleFollow` 打开后相机围绕选中卫星（保持相对姿态与距离），取消后回到地心。选中变更时自动跟随新目标。
- 截图：`onExportShot()` 在当前帧渲染后把 canvas 转 PNG 下载（文件名含时间戳）；因 WebGL 无 preserveDrawingBuffer，
  需在同一帧内 render→toDataURL。
- URL 状态：支持 `?lat=&lon=&t=&cat=&country=&sat=` 初始化，并在状态变化时 `history.replaceState`。
- 自适应画质：连续 3 秒 FPS < 40 时降档（关 bloom / 降 pixelRatio），FPS > 55 且稳定 5 秒后升档；`__MIRROR.state.quality` 可查。
- Worker 崩溃自恢复：`worker.onerror` 或连续 5 秒无消息时重建 worker 并重放 init/时间/观察者状态。
- 一致性修复：分类顺序与中文标签、轨道默认色与 ui.js 对齐（D2/D3/D4）。

## 19. 验收（V4）

1. `node server.mjs` 启动后日志显示 `http://127.0.0.1:5180/`；`curl -I` 能看到 nosniff / X-Frame-Options / CSP。
2. 无 `--cors` 时响应不含 `Access-Control-Allow-Origin`；带 `--cors` 时含 `*`。
3. 连续两次 `?force=1`：第二次带 `X-Refresh-Throttled: 1`，响应仍为 200 且 < 300ms。
4. 拖时间滑块：卫星位置随时间跳变，时间显示同步；松手后仍按当前倍速走。
5. 点「跟随」：相机贴着卫星移动；再点取消恢复地心视角。
6. 点「截图」：下载到一张 1600x900 左右的 PNG（非空白）。
7. 带 `?lat=31.23&lon=121.47&cat=comms` 打开页面：观测点=上海、只显示通信类。
8. 移动端 390x844：新按钮与滑块不溢出；快捷键浮层可打开关闭。
9. 全站控制台 0 报错、0 个 4xx；V1/V2/V3 行为回归通过。
