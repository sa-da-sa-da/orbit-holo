# 契约 V7 · 空间站/载人目标 + 全局搜索 + 视角与选择优化

> 用户反馈：① 空间站等「全部」目标要有并好找；② 地球视角偏小；③ 目标不好选，最好能搜索。

## 28. 数据（server.mjs / data/**）

1. 每颗卫星新增：
   - isStation（布尔）：ISS 各舱段、天宫（天和/问天/梦天）、神舟、天舟、联盟号、进步号、龙飞船（载人/货运）、天鹅座、HTV、星际客机等
   - stationType：station（常驻空间站）/ crew（载人飞船）/ cargo（货运飞船）/ null
2. 顶层新增 stations：数组，元素 { id, name, stationType, orbitClass, operator }，按名称排序、可复现。
3. health 增加 stationCount。
4. 不改变既有字段与分类；空间站仍属 science 任务类型（用 isStation 单独筛）。

## 29. UI（public/js/ui.js + public/css/holo.css）

1. 全局搜索覆盖层（重点）：
   - 入口：顶栏放大镜按钮 / 快捷键 斜杠；覆盖层含输入框 + 结果列表（最多 12 条）。
   - 结果项：名称（望远镜带 🔭、空间站带 🛰️）、NORAD、国家、公司、任务类型、轨道类型。
   - 键盘：上下键选择、Enter 跳转、Esc 关闭；输入防抖 120ms。
   - 点击或回车后调用 handler onSearchPick(index)（main 负责选中 + 相机飞行）。
   - 空态提示：试试 ISS / 天和 / 哈勃 / Starlink / 遥感 / 望远镜。
   - handler onSearchQuery(text)：main 同步返回结果数组（结构见 §30）。
2. 左栏任务类型区加开关「🛰️ 只看空间站/载人」→ onStationOnly(enabled)，与「🔭 只看望远镜」并排；9 个 chips 不变。
3. 详情卡：空间站目标显示「空间站 / 载人」行（常驻空间站 / 载人飞船 / 货运飞船）。
4. 顶栏观测点 chip 旁加 🔍 入口按钮（移动端只留图标）。

## 30. main.js（Lead）

- 相机：默认视距拉近（地球占屏更满），FOV 与最小距离相应调整；重置视角用同一套参数；窄窗口自动再拉近。
- 拾取：悬停锁定半径 14px、点击 12px 内直接选中、其余 18px 内弹候选；望远镜/空间站/碎片尺寸再拉开差异。
- 搜索：onSearchQuery(text) 返回最多 12 条 [{index,name,id,operator,categoryLabel,orbitClass,country,isTelescope,isStation}]，
  相关度排序：精确名 > 前缀 > 包含 > 别名 > 公司/国家/类型；onSearchPick(index) 选中并把相机平滑飞到目标附近（约 0.8s）。
- 空间站过滤：state.filters.stationOnly，与望远镜过滤叠加。
- 搜索支持中文语义：空间站 / 载人 / 望远镜 / 碎片。

## 31. 验收（V7）

1. /api/catalog 的 stations 至少含 ISS (ZARYA)、CSS (TIANHE)、神舟/联盟/龙飞船 等在轨目标；每颗有 isStation/stationType。
2. 按斜杠打开搜索，输入 天和/ISS/哈勃 能出结果；回车后相机飞到该目标并选中。
3. 「只看空间站/载人」开启后只剩空间站与飞船，数量与 stations 统计一致。
4. 1600x900 下地球视觉占比明显变大（截图对比）；重置视角一致。
5. 任意位置 14px 内可锁定；密集处弹候选。
6. 桌面/移动端 0 报错、无溢出；V1~V6 回归通过。
