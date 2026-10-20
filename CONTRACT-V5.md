# 契约 V5 · 扩展目标集（碎片 / 残骸 / 天文望远镜）

> 目标：把「近地轨道上的东西」尽量加全（有效载荷 + 火箭残骸 + 碎片），并把**天文望远镜**做成可单独筛选/标记的一等公民。
> 兼容：V1~V4 的字段与 API 全部保留；新增字段/接口只增不改。

## 20. 数据扩展（server.mjs + data/**）

### 20.1 多分组抓取（已实测可用）

TLE 分组（`gp.php?GROUP=…&FORMAT=tle`）合并去重（按 NORAD）：

| 分组 | 实测 TLE 数 | 说明 |
| --- | --- | --- |
| active | ~15,927 | 在轨有效载荷（现有） |
| fengyun-1c-debris | ~1,983 | 风云一号 C 反卫碎片 |
| cosmos-2251-debris | ~586 | 2009 美俄相撞碎片 |
| iridium-33-debris | ~109 | 2009 相撞碎片 |
| cosmos-1408-debris | ~3 | 2021 反卫碎片（已大量再入） |
| science | ~46 | 空间科学载荷（含部分望远镜） |
| stations | ~17 | 空间站各舱段 |
| amateur | ~95 | 业余无线电卫星 |

抓取失败的分组**跳过并记日志**，不影响其它分组。任何单组失败都不得让整体失效。

### 20.2 SATCAT 改为全量

目录元数据改用全量 `https://celestrak.org/pub/satcat.csv`（实测 6.7MB，含全部对象与 OBJECT_TYPE / RCS / DECAY_DATE），
按 NORAD 建索引；`DECAY_DATE` 非空的对象**不入库**（已再入）。
（保留原 records.php?GROUP=active 作为回退方案。）

### 20.3 新增字段（每颗卫星）

```jsonc
{
  "objectKind": "PAY",        // PAY 有效载荷 / R-B 火箭残骸 / DEB 碎片 / UNK 未知
  "rcs": 0.051,               // 雷达截面积 m²，可能为 null（旧对象无数据）
  "isTelescope": false,       // 是否天文/空间科学望远镜
  "telescopeType": null       // optical | xray | gamma | ir | solar | particle | null
}
```

### 20.4 分类规则调整

- 新增第 9 类 `category = "debris"`（中文「碎片 / 残骸」，英文 Debris & Rocket Bodies），
  **所有 objectKind 为 R-B 或 DEB 的对象**一律归入此类（不参与 comms/mil 等任务分类，避免污染）。
- 有效载荷的 8 类判定逻辑不变；`other` 占比要求 < 25% 仍然满足。
- 望远镜：`isTelescope=true` 时 `category` 仍为 `science`（可用 isTelescope 单独筛选）。

### 20.5 望远镜识别表（必须覆盖以下真实在轨目标，名称规则 + 人工白名单）

| 类型 | 目标 |
| --- | --- |
| optical 光学 | HUBBLE / HST、CHEOPS、CSST（巡天，若在轨）、MOST |
| xray X 射线 | CHANDRA、XMM-NEWTON、NUSTAR、IXPE、HXMT（慧眼）、GECAM-A/B、EP（爱因斯坦探针/天关）、ASTROSAT、SRG（Spektr-RG） |
| gamma 伽马 | FERMI、SWIFT、AGILE、INTEGRAL、DAMPE（悟空） |
| ir 红外 | JWST（若出现）、WISE、SPITZER（若在轨） |
| solar 太阳 | SDO、SOHO、STEREO-A/B、IRIS、HINODE、SOLAR ORBITER、ASO-S（夸父一号） |
| particle 粒子/宇宙线 | AMS-02（ISS 载荷）、CALET、DAMPE |

识别不到但名字含 TELESCOPE / XMM / HST 等关键字的，按关键字给出 `medium` 置信度并放入对应类型。

### 20.6 体积与性能

- 目标：卫星数约 **1.8~1.9 万**，`catalog.json` gzip < **3.5 MB**；缓存命中仍 < 300ms。
- `health` 增加 `debrisCount / telescopeCount / groups`（各分组实际条数），`/api/health` 同步返回。

## 21. UI 扩展（public/js/ui.js + public/css/holo.css）

1. 任务类型 chips 增加第 9 类「碎片 / 残骸」（key=debris，色 #7f8b96），与其它 chip 同样式与多选语义。
2. 新增「🔭 只看望远镜」开关（放在任务类型区标题右侧），handler `onTelescopeOnly(enabled)`，
   激活时列表/统计只有望远镜（main 负责过滤）。
3. 概览区新增「对象类型」分布条（有效载荷 / 火箭残骸 / 碎片），方法 `ui.updateObjectKinds(list)`，
   list 结构 `[{key,label,count,color}]`，色：PAY #5ef0ff、R-B #ffd166、DEB #7f8b96、UNK #6b8ea3。
4. 详情卡新增「对象类型」行（显示 载荷 PAY / 火箭残骸 R-B / 碎片 DEB），若 `rcs` 有值再显示 `RCS x.xxx m²`；
   若 `isTelescope` 为真，在标题旁加 🔭 徽标，并显示「望远镜类型: 光学/X 射线/伽马/红外/太阳/粒子」。
5. 观测面板与可见过境列表里，望远镜目标加 🔭 前缀；碎片不参与“过境推荐”（main 已过滤）。
6. 颜色模式在 UI 上只显示 国家/任务/轨道 三档说明（按对象类型的模式由 main 的 C 键第四档提供，无需 UI 改动）。

## 22. main.js（Lead 实现）

- 颜色模式增加第 4 档 `kind`（按对象类型上色），C 键循环 国家→任务→轨道→对象类型。
- 点尺寸：DEB 1.1、R-B 1.4、PAY 原尺寸、望远镜 +1.0；望远镜另用星形 sprite 层标记（≤40 个）。
- 筛选：新增 `state.filters.telescopeOnly`；望远镜优先排序（列表/搜索命中置前）。
- 统计：`stats.byObjectKind`，并传给 `ui.updateObjectKinds`。
- 亮度估算：`rcs` 存在时用 RCS 估算（mag = 常数 - 2.5*log10(rcs) + 5*log10(range/1000)），否则沿用启发式。
- 望远镜不进入“过境推荐”（GEO/MEO 已排除，望远镜多为 LEO/HEO，按 isTelescope 排除或降权）。

## 23. 验收（V5）

1. `/api/catalog`：总数约 1.8~1.9 万；`debris` 类 > 2000；`isTelescope=true` 的目标 ≥ 12 个；每颗都有 objectKind。
2. Spot check：FENGYUN 1C DEB → objectKind=DEB、category=debris；CZ-4B R/B → R-B；HST → isTelescope=true/optical；
   CHANDRA → xray；SDO → solar；ISS (ZARYA) → PAY、isTelescope=false。
3. 页面：切「碎片/残骸」只剩碎片；开「只看望远镜」后列表与统计只剩望远镜；C 键第 4 档上色生效。
4. 性能：worker tick < 35ms；首屏 < 6s；FPS 与之前同量级（自适应画质能兜底）。
5. 全站 0 报错 / 0 个 4xx；V1~V4 行为回归通过。
