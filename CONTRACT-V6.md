# 契约 V6 · 望远镜观测辅助 + 过境提醒 + 星历龄期

> 继续精修：把「天文望远镜」从“能看见”提升到“能安排观测”；给过境加提醒与日历导出；补星历新鲜度。

## 24. 数据（server.mjs / data/**）

1. 每颗卫星新增 `tleEpoch`（ISO 字符串，来自 TLE 第 1 行 epoch）与 `tleAgeHours`（相对本次构建时间的龄期，保留 1 位小数）。
2. 顶层新增 `telescopes`：`[{ id, name, telescopeType, orbitClass, operator }]`（当前 19 项），便于前端直接取。
3. `health` 增加 `tleAgeHoursMax`、`tleAgeHoursMedian`。
4. 体积不变（gzip 仍应 < 3.5MB）；V1~V5 字段与语义不变。

## 25. UI（public/js/ui.js + public/css/holo.css）

1. 观测面板新增「🔭 望远镜可观测」区块（在“当前可见”之后）：
   - 列表项：名称（含 🔭）、望远镜类型（光学/X 射线/伽马/太阳）、当前仰角、状态徽标（**现在可观测 / 地影中 / 地平线下**）、
     下次可观测时间（HH:MM 或「—」）；按「现在可观测 → 即将可观测 → 不可观测」排序；点击 → 选中该卫星。
   - 空态：未设观测点 → 「设置观测地点后可判断望远镜可观测性」。
   - 新方法：`ui.updateTelescopeStatus(list)`；list 结构见下。
2. 详情卡：
   - 观看区块下加一行「星历龄期」：`TLE 龄期 2.3 天`（>7 天时标黄提示“星历较旧，位置误差可能增大”）。
   - 望远镜目标在观看区块里显示「状态：现在可观测 / 地影中 / 地平线下」。
3. 过境列表每行加「⏰」提醒按钮 → handler `onRemindPass(index)`；已在提醒中的行显示「⏰ 已设置」。
4. 观测面板底部加两个按钮：「📅 导出日历」→ `onExportIcs()`、「🔔 全部提醒」→ `onRemindAll()`。
5. 通知权限被拒时用 toast 提示（main 负责），UI 只需反映状态。

list 元素结构（updateTelescopeStatus）：
```js
{ id, index, name, telescopeType, typeLabel, el, az, sunlit, observable, status, nextAt, nextEl, color }
```
status 取值：`now`（现在可观测）/ `shadow`（地影中）/ `below`（地平线下）/ `unknown`（无观测点）。

## 26. main.js（Lead）

- 观测点存在时，对 19 台望远镜请求过境窗口（复用现有 passes 引擎，minEl=10），得到「下次可观测时间」；
  结合 visibility 缓冲得到 仰角/是否被照亮，推导 status。
- 通知：`onRemindPass(index)` 请求 Notification 权限，在过境前 5 分钟推送「即将过境：名称 · 最高仰角 · 时长」；
  `onRemindAll()` 对当前过境列表全部设置。时间机器跳转后自动重排。
- 日历：`onExportIcs()` 把当前 6 小时内过境导出为 .ics（VEVENT，含 SUMMARY/DESCRIPTION/DtStart/DtEnd），浏览器下载。
- 详情：把 `tleEpoch/tleAgeHours` 透传给 UI。

## 27. 验收（V6）

1. 设定北京后，望远镜区块出现 19 条；至少 1 条「现在可观测」或给出明确状态；点击能选中并画轨道。
2. 详情卡显示星历龄期（数值合理，TLE 通常 < 3 天）。
3. 点 ⏰ 后浏览器通知权限被请求（headless 下会拒绝 → toast 提示，不报错）。
4. 点「导出日历」下载 .ics，可被日历软件识别（含 1+ 个 VEVENT）。
5. 桌面 1600x900 / 移动 390x844 无溢出；控制台 0 报错；V1~V5 行为回归通过。
