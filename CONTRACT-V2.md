# 契约 V2 · 卫星「所属公司 / 任务类型」与点选体验增强

> 在 V1（CONTRACT.md）基础上增量扩展。**V1 的所有字段与 API 保持不变**，只新增内容。
> 当前基线已备份为 orbit-holo-BACKUP-v1-20261020（含 zip），页面已验收通过，改动必须向后兼容。

## 7. 数据扩展（server.mjs 与 /api/catalog）

在每颗 satellites[] 上新增字段（字段名不可改）：

```jsonc
{
  "operator": "SpaceX",                    // 运营方英文标识（公司/机构/部队）
  "operatorZh": "太空探索技术公司 SpaceX",  // 中文名
  "operatorKind": "company",               // company | agency | military | intergov | academic | unknown
  "category": "comms",                     // comms | nav | eo | mil | weather | science | tech | other
  "categoryLabel": "通信 / 互联网",
  "categoryLabelEn": "Communications",
  "categoryConfidence": "high",             // high | medium | low
  "categoryNote": "名称匹配 STARLINK"        // 判定依据，<=40 字，可空串
}
```

顶层新增汇总（可选但推荐，前端用于一致性校验）：

```jsonc
"categories": [{ "key": "comms", "label": "通信 / 互联网", "labelEn": "Communications", "count": 12345 }],
"topOperators": [{ "name": "SpaceX", "nameZh": "太空探索技术公司 SpaceX", "kind": "company", "count": 9876 }]
```

**分类定义（8 类，键名固定）：**

| key | 中文 | 英文 | 典型 |
| --- | --- | --- | --- |
| comms | 通信 / 互联网 | Communications | Starlink、OneWeb、Intelsat、SES、天链、中星、千帆/国网 |
| nav | 导航 / 定位 | Navigation | GPS、GLONASS、Galileo、北斗、QZSS、NavIC |
| eo | 对地观测 / 遥感 | Earth Observation | Landsat、Sentinel、高分/资源、Planet、SkySat、WorldView、SAR 卫星 |
| mil | 军事 / 侦察 | Military & Recon | NROL、USA-2xxx、遥感三十号、军用通信/侦察星 |
| weather | 气象 / 海洋 / 环境 | Weather & Ocean | NOAA、GOES、JPSS、风云、Himawari、Metop、Meteosat |
| science | 科学 / 深空 / 载人 | Science & Human | ISS、天宫、哈勃、JWST、空间科学、天文 |
| tech | 技术试验 / 教育 / 业余 | Tech Demo & Education | 试验星、技术验证、CubeSat、AMSAT/OSCAR、教育卫星 |
| other | 其他 / 未分类 | Other | 规则未命中的一律放这里，**不允许瞎猜** |

**分类规则要求：**

1. 以「名称正则 + 运营方 + 轨道 + 发射年份」组合判定，优先级从具体到宽泛；先命中先生效。
2. 必须覆盖当前真实数据里的主力星座（至少：Starlink、OneWeb、Iridium、Globalstar、Orbcomm、Planet/Flock/SkySat、Spire、ICEYE、Capella、Umbra、SES/O3B、Intelsat、Eutelsat、Inmarsat、ViaSat、Telesat、AST SpaceMobile、GPS/NAVSTAR、GLONASS/Uragan、Galileo、北斗/BD、QZSS、NavIC、GOES/NOAA/JPSS、风云 FY、Himawari、Metop、Sentinel、Landsat、WorldView、高分 GF、资源 ZY、遥感 YAOGAN、天绘、实践 SJ、试验 SY、天链 TL、中星 CHINASAT、亚太 APSTAR、亚洲卫星 ASIASAT、银河 GALAXY、COSMOS、NROL、USA-、Molniya、Meridian、ISS/ZARYA、天宫/天和、哈勃 HST、JWST、AMSAT/OSCAR、各类 CUBESAT）。
3. 置信度：名称/运营方精确命中 = high；仅靠运营方或轨道+名称弱特征 = medium；只能按 owner/轨道兜底 = low。未命中 → category=other、categoryConfidence=low、categoryNote="未匹配规则"。
4. **不要**把商用通信星座标成 mil；不要凭 owner=US 就标 military。宁可 other 也不要误判。
5. 分类结果需可复现：同样输入必须得到同样输出（不依赖随机/时间）。

**运营方（operator）要求：** 名称前缀能识别公司就给公司（SpaceX、Eutelsat OneWeb、Iridium、Planet Labs、SES、Intelsat、中国卫通、上海垣信/千帆、航天科技集团、NASA、NOAA、ESA、US Space Force、Roscosmos…），识别不了公司就给国家级机构，再不行用 owner 映射（如 operator=US、operatorZh=美国、kind=unknown）。**必须所有卫星都有 operator/operatorZh/operatorKind**。

**性能与体积：** 新增字段后 catalog.json 允许增大，但 gzip 后必须仍 < 2.0 MB；服务端缓存命中仍 < 300ms。

## 8. UI 扩展（public/js/ui.js + public/css/holo.css）

1. **左栏新增「任务类型」区**（放在「轨道类型」下方）：8 个 chips，显示中文名 + 数量，点击多选过滤，与轨道 chips 同样式；提供 ui.updateCategories(list)，结构：

```js
[{ key: "comms", label: "通信 / 互联网", count: 12345, active: true, color: "#5ef0ff" }]
```

   handler 新增：onCategoryToggle(key, enabled)。
2. **右栏概览新增「任务类型分布」条形**（在轨道分布之后、国家条形之前插入 #category-bars），updateCategories 的数据同时驱动 chips 与条形。
3. **详情卡新增两行**（在「国家 / 组织」之后）：「所属公司 / 机构」、「任务类型」；任务类型后若 categoryConfidence 不是 high，追加小标签（中置信/低置信），并在详情卡底部加一行灰色小字「任务类型按名称与目录规则推断」。
4. stats 增加 byCategory: [{key,label,count,color}]（若 main 提供则渲染，缺失时忽略）。
5. detail 增加：operator: {name, nameZh, kind}、category: {key, label, labelEn, confidence, note}。
6. 颜色（与 main.js 必须同值）：comms #5ef0ff、nav #ffd166、eo #4ade80、weather #7dd3fc、mil #ff5ea8、science #a78bfa、tech #f97316、other #6b8ea3。
7. 不新增外部资源；保持第 4 节的节流与幂等要求；移动端左栏变长后可滚动，不遮挡地球中心。

## 9. 兼容与回归

- V1 字段、V1 API、V1 handler 全部保留；新增字段/方法要能在旧数据（无 operator/category）下正常工作。
- 改完必须回归：桌面 1600x900、移动端 390x844 各截图；控制台 0 报错；统计/筛选数字与 /api/catalog 一致。

## 10. 验收清单（V2）

1. /api/catalog 每颗卫星都有 operator/operatorZh/operatorKind/category/categoryLabel/categoryLabelEn/categoryConfidence。
2. 分类覆盖率：other 占比 < 25%（基于当前 15,927 颗）；无 category 为空。
3. Spot check（必须逐条通过）：
   - STARLINK-* → SpaceX / comms / high
   - ONEWEB-* → Eutelsat OneWeb / comms
   - GPS / NAVSTAR → nav
   - GOES / NOAA / 风云 FY-* → weather
   - SENTINEL / LANDSAT / 高分 GF-* → eo（YAOGAN 若判 mil 需在 note 说明）
   - ISS (ZARYA) / 天和 → science
   - NROL / USA-2xxx → mil
   - CUBESAT 类 → tech
4. 页面：点「任务类型」里 comms → 渲染数与 catalog 统计一致；详情卡显示公司 + 类型 + 置信度；任务类型条形比例正确；移动端无溢出。
