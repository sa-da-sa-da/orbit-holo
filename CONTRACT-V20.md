# 契约 V20 · 任务类型二级分类（专业细分）

> 目标：现有 9 大类太粗（尤其「其他」5,190 条），需要一层**专业二级分类 subcategory**，覆盖全部 35,466 个目标。

## 40. 数据结构

每颗卫星新增 3 个字段：

| 字段 | 说明 |
| --- | --- |
| subcategory | 机器键（小写短横线），见下表 |
| subcategoryLabel | 中文标签 |
| subcategoryLabelEn | 英文标签 |

顶层 `/api/catalog` 增加 `subcategories: [{ key, label, labelEn, category, count }]`（按 category → count 排序，可复现）。

## 41. 二级分类表（必须全部实现，覆盖率 100%）

### comms 通信
- broadband — 宽带互联网星座（Starlink / OneWeb / Kuiper / 千帆 / 中国星网）
- geo-comms — 地球静止轨道通信（Eutelsat、Intelsat、SES、中星、亚太、RADUGA、GORIZONT、EKRAN、TELECOM、STTW/东方红）
- mobile — 移动通信（Inmarsat、Iridium、Globalstar、Orbcomm、Thuraya、天通）
- relay — 数据中继（TDRS、EDRS、天链、Luch）
- amateur — 业余无线电卫星（AMSAT、OSCAR、Fox、RS 系列）
- broadcast — 广播/电视直播（DirecTV、SiriusXM、EchoStar、Tianmu?）
- military-comms — 军用通信（AEHF、Milstar、WGS、Skynet、UHF Follow-On）
- other-comms — 其它通信

### nav 导航
- gnss-core — GNSS 核心星座（GPS、GLONASS、Galileo、北斗、QZSS、NavIC）
- sbas — 星基增强（WAAS、EGNOS、GAGAN、SDCM、BDS-SBAS）
- other-nav — 其它导航/授时

### eo 对地观测
- optical — 光学成像（Sentinel-2、Landsat、WorldView、高分、吉林一号、Planet）
- sar — 合成孔径雷达（Sentinel-1、TerraSAR、COSMO-SkyMed、雷达星）
- hyperspectral — 高光谱/多光谱专项（EnMAP、PRISMA、珠海一号）
- video — 视频/光学小卫星星座（SkySat、BlackSky、长光视频星）
- other-eo — 其它遥感

### mil 军事
- optical-recon — 光学侦察（KH-11/USA-xxx 光学、吉林/遥感军用型）
- radar-recon — 雷达成像侦察（Lacrosse/Oniks、SAR-Lupe）
- sigint — 电子侦察/频谱监测（HawkEye 360、Unseenlabs BRO、NORSAT、USA 电子侦察）
- early-warning — 导弹预警（DSP、SBIRS、天基预警）
- military-comms — 军用通信（与 comms/ military-comms 不冲突：以内容判定，军用任务优先 mil）
- unknown-military — 军用但用途不明（COSMOS 系列、USA-xxx 未定、OBJECT xx 军用型）
- other-mil — 其它军事

### weather 气象/海洋/环境
- meteorology — 气象（NOAA、GOES、风云、Himawari、Metop、METEOR、TIROS/ESSA）
- ocean — 海洋（Jason、Sentinel-6、HY、海洋系列）
- environment — 环境/温室气体（OCO、GHGSat、Sentinel-5P）
- other-weather — 其它

### science 科学
- telescope — 天文望远镜（沿用 isTelescope 判定）
- solar — 太阳观测（SDO、SOHO、STEREO、夸父一号）
- earth-science — 地球科学/重力场/磁测（GRACE、Swarm、CHAMP）
- space-physics — 空间物理/粒子/宇宙线（XMM、Fermi、DAMPE、THEMIS/ARTEMIS）
- life-science — 生命科学/生物载荷
- geodesy — 大地测量（SECOR、LAGEOS、Etalon、GEOSAT）
- other-science — 其它科学

### tech 技术试验/教育
- tech-demo — 技术验证（试验星、在轨验证）
- education — 教育/大学 CubeSat
- servicing — 在轨服务/维修/离轨演示（MEV、RemoveDEBRIS）
- other-tech — 其它

### station 空间站/载人
- station-module — 常驻空间站舱段
- crew — 载人飞船
- cargo — 货运飞船

### debris 碎片/残骸
- fragmentation — 解体/碰撞/反卫碎片（名称含 DEB 且来源为解体事件）
- rocket-body — 火箭残骸/上面级（OBJECT_TYPE = R/B）
- inactive — 失效载荷（PAY 但已失效/退役，若有可靠判据；否则并入 fragmentation 之外的单列）

### other 其他（这一类的二级必须尽量细化，目标 < 1500 条）
- unclassified-military — 疑似军用/用途不明（COSMOS 编号系列、USA-xxx 无用途信息、OBJECT xx 由政府发射）
- unnamed-object — 官方目录仅有「OBJECT X」且无法判定用途
- historical — 1960 年代及以前发射、已退役的早期卫星（VANGUARD、EXPLORER 早期等）
- interplanetary — 行星际/深空探测器（离开地球轨道或奔向月球/行星）
- unknown — 确实无任何可用信息

## 42. 判定要求

1. **规则优先级**：具体规则（星座/型号白名单）> 通用关键词 > 归属类目默认值；
2. **不得误伤**：望远镜仍必须 `isTelescope=true` 且 subcategory=telescope；空间站仍 station-*；R-B/DEB 仍 debris/*；
3. 类别与二级必须自洽：`subcategory` 必须属于其 `category`（用一张映射表校验）；
4. `other/unknown` 目标数量必须在 **1,500 以内**（当前 5,190），且 `other` 一级类目占比 < **5%**；
5. 现有字段（category / categoryLabel / categoryConfidence / isTelescope / isStation / objectKind / rcs）语义不变。

## 43. 验收

1. `/api/catalog`：每颗卫星都有 subcategory，且 subcategory 属于对应 category；
2. `subcategories` 汇总的 count 之和 = 35,466；
3. spot check（至少 15 条）：COSMOS 2251 DEB→debris/fragmentation；FENGYUN 1C DEB→debris/fragmentation；SL-4 R/B→debris/rocket-body；
   LEMUR 2→eo（或 comms）细分正确；HAWK-*→mil/sigint；BRO-*→mil/sigint；RADUGA→comms/geo-comms；METEOR-M→weather/meteorology；
   TIROS 9→weather/meteorology；STTW-1→comms/geo-comms；HST→science/telescope；ISS (ZARYA)→station/station-module；
   SHENZHOU-23→station/crew；TDRS→comms/relay；SECOR 8→science/geodesy；
4. 体积：gzip 增量 < 0.3MB（3 个短字段），缓存命中 < 400ms；
5. V1~V19 回归全绿（尤其 debris/isTelescope/isStation/objectKind 计数不变）。
