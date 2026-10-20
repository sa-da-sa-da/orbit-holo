# 契约 V3 · 观测地点 + 卫星可见性 / 过境推荐（望远镜观看）

> 增量扩展，V1/V2 全部字段与 API 保持不变。前端已验收版本已备份（orbit-holo-BACKUP-v1-20261020）。

## 11. 功能目标

1. 设定观测地点：浏览器定位 / 城市预设 / 手动经纬度 / 点击地球选点，并持久化到 localStorage。
2. 实时可见性：对每颗卫星计算 仰角 elevation、方位角 azimuth、斜距 rangeKm、是否被太阳照亮 sunlit。
3. 过境推荐：未来 6 小时内该地点的卫星过境（AOS/LOS/最高仰角/方位/时长/亮度估算），按推荐分排序。
4. 观看辅助：详情卡显示「观看」信息；地球上显示观测点标记；可见卫星高亮。
5. 面向「天文望远镜观看」：过境列表标注推荐类型——肉眼可见 / 双筒可见 / 望远镜跟踪（大目标如 ISS、天宫优先）。

## 12. 内部数据结构（main.js 计算，UI 只负责展示）

observing（ui.setObserver）：
```js
{ lat: 39.9042, lon: 116.4074, label: "北京", source: "geo" | "preset" | "manual" | "globe" }
```

visibleNow（ui.updateVisibleNow(list)）：当前仰角 > 10 度且被照亮的卫星，按得分降序，最多 12 条。
```js
{ index: 25544, name: "ISS (ZARYA)", country: "国际空间站", flag: "🛰️", color: "#5ef0ff",
  el: 47.3, az: 128.4, rangeKm: 812, mag: -2.1, tier: "naked", sunlit: true }
```

passes（ui.updatePasses(list)）：未来 6 小时推荐过境，最多 10 条，按 score 降序。
```js
{ index: 25544, name: "ISS (ZARYA)", country: "国际空间站", flag: "🛰️", color: "#5ef0ff",
  startAt: 1792500000000, maxAt: 1792500300000, maxEl: 78.2, az: 214.5, durationSec: 412,
  rangeKm: 415, mag: -3.2, tier: "naked", sunlit: true, score: 96,
  reason: "国际空间站 · 高仰角 · 亮度高", live: false }
```

passDetail（ui.setPassDetail / 详情卡）：
```js
{ el: 47.3, az: 128.4, rangeKm: 812, sunlit: true, mag: -2.1, tier: "naked",
  aboveHorizon: true, nextPass: { startAt: 1792500000000, maxEl: 78.2, az: 214.5, durationSec: 412 } | null }
```

tier 定义：naked 肉眼可见（估算星等 <= 4.5）/ binocular 双筒（<= 7）/ telescope 望远镜（> 7）。
星等为估算值，必须标注「亮度为估算」。

## 13. UI 扩展（public/js/ui.js + public/css/holo.css）

1. 右栏 #stats-block 顶部加 **两个 tab**：「概览 OVERVIEW」与「观测 OBSERVE」（默认概览）。
   观测 tab 内为 #observe-pane，包含：
   - 观测地点块：按钮「📍 使用我的位置」、城市下拉（预置 12 个：北京/上海/广州/深圳/成都/西安/杭州/南京/武汉/哈尔滨/乌鲁木齐/拉萨）、
     手动输入 纬度/经度 + 确定、当前地点显示（label + 39.90N 116.41E）、清除按钮。
   - 提示：未设置地点时显示「请先设置观测地点」，列表为空态。
   - 「当前可见」列表 #visible-list：名称、国旗+国家、仰角、方位、距离、估算星等、tier 标签。点击某行 → 选中该卫星。
   - 「未来 6 小时推荐过境」列表 #pass-list：倒计时（如 12 分钟后 / 正在过境）、名称、最高仰角、方位、时长、tier、reason。点击 → 选中。
   - 开关「仅高亮可见卫星」（handler onFocusVisibleOnly(enabled)）。
2. 详情卡新增「观看 VIEWING」区块（在 TLE 之前）：仰角/方位/距离/是否照亮/估算星等/下一次过境（时间+最高仰角+时长）。
3. 顶部 #data-status 旁增加一个观测点 chip（location chip），显示 📍 地点或「设置观测点」，点击切到观测 tab。
4. 新增方法：ui.setObserver(obs)、ui.updateVisibleNow(list)、ui.updatePasses(list)、ui.setPassDetail(detail)、ui.setObserving(bool)。
   新增 handler：onLocate()、onObserverPreset(cityKey)、onObserverManual(lat, lon)、onObserverClear()、onSelectPass(index)、onFocusVisibleOnly(enabled)。
5. 时间显示：过境时间用本地时间 HH:MM，倒计时用「N 分钟后 / 正在过境」；数值全部带单位。
6. 移动端：右栏 tab 正常切换，观测列表可滚动；不新增外部资源。

## 14. main.js 侧约定（供 UI 参考，不需要你实现）

- 观测点存储在 localStorage 键 holomirror.observer，页面加载时自动恢复并调用 setObserver。
- 「使用我的位置」走 navigator.geolocation（localhost 视为安全上下文）；失败时 toast 提示并保留手动输入。
- 点击地球：按住 Alt 点击（或观测 tab 内点「在地球上选点」按钮后单击）设置观测点，避免与选中卫星冲突。
- 可见卫星在地球上放大高亮；观测点显示标记与本地地平圈。
- 所有过境计算使用当前时间机器时间（暂停/加速同样生效）。

## 15. 验收（V3）

1. 设置北京后：可见列表非空（白天也应有被照亮的高轨目标；夜间更多），过境列表 6 小时内至少 1 条。
2. 点推荐条目 → 该卫星被选中，详情卡出现「观看」区块且数值随时间更新。
3. ISS 过境：startAt < maxAt < LOS，duration 合理（2~10 分钟），maxEl 在 0~90 度。
4. 切换观测点（如上海 → 乌鲁木齐）→ 列表与仰角随之变化。
5. 清除观测点 → 列表清空并提示设置地点；标记与地平圈消失。
6. 桌面 1600x900 / 移动 390x844 无溢出、控制台 0 报错；V1/V2 行为回归通过。
