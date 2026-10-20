# 地球卫星全息镜像 · 接口契约 (CONTRACT)

> 本文件是团队协作的唯一接口规范。所有模块必须严格遵守，不要互相修改对方负责的文件。

## 1. 项目定位

一个"全息风格"的三维地球，实时显示全球在轨卫星位置，可按国家/轨道类型筛选，
显示卫星总数、各国卫星数量、单颗卫星实时状态（高度、速度、经纬度、周期、倾角等）。

技术栈：**零依赖 Node.js 静态服务器 + 原生 ES Module + three.js r160 (已本地 vendored) + satellite.js 5.0 (SGP4)**。
无构建步骤、无 npm 依赖、离线可用（数据有磁盘缓存 + 内置快照）。

## 2. 目录与文件归属（严禁越界写文件）

```
orbit-holo/
  CONTRACT.md                  ← Lead
  server.mjs                   ← 数据服务负责人
  data/                        ← 数据服务负责人（缓存/快照，服务器运行时生成）
  public/index.html            ← Lead（静态骨架，其他人只读）
  public/css/holo.css          ← UI 负责人
  public/js/ui.js               ← UI 负责人
  public/js/main.js            ← Lead（总装、时钟、筛选状态）
  public/js/globe.js           ← Lead（全息地球渲染）
  public/js/satellites.js      ← Lead（卫星点云/轨道线/拾取）
  public/js/propagate.worker.js← Lead（SGP4 后台推算）
  public/js/country-map.js     ← 数据服务负责人? 否 —— 见下
  public/vendor/**             ← Lead（已下载，勿动）
  public/data/land-110m.json   ← Lead（已下载，勿动）
  README.md / 启动.bat         ← Lead
```

## 3. 数据契约：server.mjs 与 GET /api/catalog

### 3.1 服务器行为

- ESM，`node server.mjs --port 5180`（也支持 `PORT` 环境变量），零 npm 依赖，Node >= 18。
- 静态托管 `public/`：正确 MIME（.js → text/javascript、.mjs、.json、.css、.html、.jpg、.png、.svg、.woff2、.glb），
  未找到 → 404 纯文本。**禁止目录穿越**（解析后必须位于 public 内）。
- 对 `/api/catalog` 响应支持 gzip（`Content-Encoding: gzip`，当请求 `Accept-Encoding` 含 gzip 时），
  并带 `Access-Control-Allow-Origin: *`。
- 缓存：落盘 `data/catalog.json`，TTL 6 小时（可用 `CATALOG_TTL_HOURS` 覆盖）。
  命中缓存则 0 网络请求、启动/响应 < 300ms。
- 刷新：`/api/catalog?force=1` 强制重新抓取；失败时回退到旧缓存并照常返回（`source: "cache"`）。
- 数据源（CelesTrak，已验证可达）：
  - TLE：`https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle`
  - 卫星目录：`https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json`
- 启动时若已有缓存 → 直接用；否则若 `data/tle-active.txt` 与 `data/satcat-active.json` 存在 → 本地合成；
  否则联网抓取。**启动绝不能因网络失败而崩溃**（打印警告，继续服务，`/api/catalog` 返回 503 + JSON 错误）。
- 其他端点：`GET /api/health` → `{"ok":true,"count":N,"updated":"ISO","source":"..."}`。
- 日志：`[server] ...` 打印端口、数据来源、耗时、卫星数。

### 3.2 数据合并规则

TLE 记录（3 行一组：名称 / TLE1 / TLE2）与 SATCAT 记录按 `NORAD_CAT_ID` 关联。
TLE 里 2 行 satellite number 必须与 SATCAT 一致。缺失 SATCAT 的卫星：owner = "UNK"。

SATCAT 字段：OBJECT_NAME, OBJECT_ID, NORAD_CAT_ID, OBJECT_TYPE, OPS_STATUS_CODE, OWNER,
LAUNCH_DATE, LAUNCH_SITE, DECAY_DATE, PERIOD, INCLINATION, APOGEE, PERIGEE, RCS, ORBIT_TYPE。

### 3.3 /api/catalog 响应 JSON（精确结构）

```jsonc
{
  "ok": true,
  "updated": "2026-10-20T02:41:00.000Z",   // 数据抓取时间 ISO
  "source": "celestrak",                    // "celestrak" | "cache" | "snapshot" | "local"
  "count": 15927,
  "countries": [                            // 全部出现过的国家/组织，按 count 降序
    {
      "code": "US",            // OWNER 原始代码，未识别用原始值
      "name": "美国",           // 中文名
      "nameEn": "United States",
      "flag": "🇺🇸",            // emoji，未知用 "🛰️"
      "kind": "country",       // "country" | "org" | "intergov" | "other"
      "count": 13026
    }
  ],
  "satellites": [
    {
      "id": 25544,             // NORAD ID (number)
      "name": "ISS (ZARYA)",
      "intl": "1998-067A",     // OBJECT_ID，可空串
      "owner": "ISS",          // SATCAT OWNER 原始代码
      "country": "ISS",        // 归一后的代码 = countries[].code
      "objectType": "PAY",     // PAY / R/B / DEB / UNK
      "status": "+",           // OPS_STATUS_CODE: + 运行 / P 部分 / B 备份(不跟踪) / S 备用 / X 已失效 / "" 未知
      "launchDate": "1998-11-20",
      "orbitClass": "LEO",     // LEO | MEO | GEO | HEO | OTHER
      "period": 92.9,          // 分钟
      "incl": 51.64,           // 度
      "apogee": 420,           // km
      "perigee": 415,          // km
      "tle1": "1 25544U 98067A   ...",
      "tle2": "2 25544  51.6416 ..."
    }
  ]
}
```

轨道分类规则（务必一致）：
1. `1400 <= period <= 1470` → **GEO**
2. `apogee < 2000` → **LEO**
3. `apogee < 34000` → **MEO**
4. 其余 → **HEO**；period 缺失/为 0 → **OTHER**

### 3.4 国家/组织映射表（OWNER 原始值 → 名称）

必须覆盖下面全部 99 个代码（来自当前真实数据），无法确定的国家按 `kind:"other"`、中文名 `"其他(X)"` 处理：

US PRC UK CIS TBD JPN IT SKOR FR IND GER ESA SPN CA TURK SES ITSO O3B AUS FIN EUTE GLOB ROC ARGN UAE NOR GREC ISRA SING POL SAUD ORB BRAZ IM LUXE IRAN POR BEL INDO EGYP AB EUME SWTZ MALA THAI NETH RWA PAKI BUL ALG DEN AC ISS KAZ MEX ABS BELA AZER MA HUN VTNM NIG CZCH ASRA SWED SVN SVK KWT RP LTU UKR CHLE CHBZ VENZ SAFR FRIT ECU ROM NICO RASC DJI STCT SLB BHR BWA MNE HRV NZ JOR GRSA TMMC PERU LAOS ETH BGD NKOR BOL IRAQ ANG

已知判定（必须照此）：US=美国, PRC=中国, CIS=俄罗斯/独联体, UK=英国, JPN=日本, IND=印度, FR=法国,
GER=德国, IT=意大利, SKOR=韩国, ESA=欧洲空间局(intergov), SPN=西班牙, CA=加拿大, TURK=土耳其,
AUS=澳大利亚, ARGN=阿根廷, UAE=阿联酋, NOR=挪威, GREC=希腊, ISRA=以色列, SING=新加坡, POL=波兰,
SAUD=沙特, BRAZ=巴西, IRAN=伊朗, POR=葡萄牙, BEL=比利时, INDO=印度尼西亚, EGYP=埃及, SWTZ=瑞士,
MALA=马来西亚, THAI=泰国, NETH=荷兰, PAKI=巴基斯坦, BUL=保加利亚, ALG=阿尔及利亚, DEN=丹麦,
KAZ=哈萨克斯坦, MEX=墨西哥, BELA=白俄罗斯, AZER=阿塞拜疆, MA=摩洛哥, HUN=匈牙利, VTNM=越南,
NIG=尼日利亚, CZCH=捷克, SWED=瑞典, SVN=斯洛文尼亚, SVK=斯洛伐克, KWT=科威特, RP=菲律宾,
LTU=立陶宛, UKR=乌克兰, CHLE=智利, VENZ=委内瑞拉, SAFR=南非, ECU=厄瓜多尔, ROM=罗马尼亚,
DJI=吉布提, SLB=所罗门群岛, BHR=巴林, BWA=博茨瓦纳, MNE=黑山, HRV=克罗地亚, NZ=新西兰, JOR=约旦,
PERU=秘鲁, LAOS=老挝, ETH=埃塞俄比亚, BGD=孟加拉国, NKOR=朝鲜, BOL=玻利维亚, IRAQ=伊拉克,
ANG=安哥拉, ROC=中国台湾, ISS=国际空间站(intergov), TBD=待确认(other),
SES/O3B/LUXE=卢森堡(org), EUTE=欧洲通信卫星组织(org), ITSO=国际通信卫星组织(org),
IM=国际海事卫星组织(org), GLOB=加拿大(Globalstar, org), ORB=美国(Orbcomm, org),
AB/ABS=亚洲广播卫星(org), ASRA=亚洲卫星(org), EUME=欧洲(org), AC=亚洲(org), RWA=卢旺达,
FRIT=法国, CHBZ=中国(巴西合作), GRSA=沙特, TMMC=中国, NICO=荷兰, RASC=俄罗斯, STCT=中国香港。

国旗 emoji 尽量准确；商业/国际组织可用 🛰️ 或对应国家旗。

## 4. 前端 UI 契约（public/js/ui.js + public/css/holo.css）

`public/index.html` 由 Lead 提供，**已有完整静态骨架与元素 id**，UI 负责人只读它，不要修改。
ui.js 必须导出：

```js
export function createUI(handlers) -> ui
```

`handlers`（main.js 提供，全部可选，调用前判空）：
```
onSearch(q: string)
onOrbitToggle(key: "LEO"|"MEO"|"GEO"|"HEO"|"OTHER", enabled: boolean)
onCountryToggle(code: string, enabled: boolean)
onCountriesAll(showAll: boolean)      // "全部显示"
onSpeed(secondsPerSecond: number)     // 0 = 暂停；1/10/60/600/3600
onPlayToggle()
onNow()
onLayerToggle(key: string, enabled: boolean)  // "orbits" | "grid" | "atmosphere" | "autoRotate" | "labels"
onResetView()
onRefresh()
```

`ui` 返回对象的方法（全部可被频繁调用，需幂等且不重建 DOM 之外的东西）：
```js
ui.setDataStatus({ source, updated, count })      // source: "celestrak"|"cache"|... updated: Date|string
ui.setPerf({ fps, rendered, total })
ui.setClock({ utc, local, speed, paused })        // utc/local 为已格式化字符串
ui.updateStats(stats)                             // 见下
ui.updateCountries(list, allShown)                // list: [{code,name,flag,count,color,active,kind}]
ui.updateOrbits(list)                             // [{key,label,labelZh,count,active,color}]
ui.setSelection(detail|null)                      // 见下
ui.setLoading({ visible, text, progress })        // progress 0..1 或 null
ui.setError(msg)                                  // 顶部错误条
ui.toast(msg)                                     // 1.6s 提示
```

`stats`：
```js
{
  total: 15927,          // 数据总卫星数
  rendered: 15927,       // 当前筛选后渲染数
  countryCount: 86,      // 出现的国家级/组织数
  activeCount: 16804,    // OPS_STATUS '+' 的数量（在轨运行）
  byOrbit: [{ key:"LEO", label:"LEO 低轨", count: 12000, color:"#5ef0ff" }],
  topCountries: [{ code:"US", name:"美国", flag:"🇺🇸", count:13026, pct:82, color:"#4ad7ff" }],  // 前 8
  launchYears?: null
}
```

`detail`（选中卫星，实时刷新，频率 ≤ 10Hz）：
```js
{
  id: 25544, name: "ISS (ZARYA)", intl: "1998-067A",
  country: { code:"ISS", name:"国际空间站", flag:"🛰️", color:"#7ef9ff" },
  owner: "ISS", objectType: "PAY", status: "+", statusText: "在轨运行",
  orbitClass: "LEO", orbitLabel: "低地球轨道",
  altKm: 418.3, speedKms: 7.66, periodMin: 92.9, inclDeg: 51.64,
  apogeeKm: 420, perigeeKm: 415,
  lat: 12.34, lon: 108.21,
  launchDate: "1998-11-20",
  tle1: "...", tle2: "..."
}
```

UI 规则：
- 纯原生 DOM，无框架、无外部字体/CDN。所有资源本地。
- 中文为主、英文副标注（科技感），数字用等宽字体。
- 面板可折叠（移动端/窄屏 < 900px 时默认收起，只显示底部时间条）。
- 国家列表最多渲染 120 项，滚动容器；每项：色点 + 国旗 + 名称 + 数量；点击切换 active。
- 点击国家条形图中的国家 → 等同切换该国家筛选。
- 详情卡：出现时右侧滑入，显示全部字段 + 复制 TLE 按钮（可选）+ 关闭按钮。
- 统计条形图用 CSS width 百分比，不用 canvas/svg 库。
- 性能：updateStats/updateCountries 每秒最多被调用 2 次（自行节流），不得每次重建全部节点造成闪烁。

## 5. 视觉规范（全息风）

- 底色：#03070d → #050d16 深空渐变 + 轻微噪点/扫描线 + 暗角。
- 主色（全息青）：#5ef0ff；辅色：#1b9dd9；强调（告警/选中）：#ff5ea8；文字：#cfe9f2 / 次要 #6f8b99。
- 面板：半透明（rgba(6,18,28,.72)）+ 1px 青色描边（含角标 L 形装饰）+ backdrop-filter blur。
- 字体：`ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, "Microsoft YaHei", monospace`。
- 标题带轻微 text-shadow 辉光；数字变化不要跳动（等宽）。
- 所有交互过渡 120~200ms；不要花哨动画拖慢渲染。

## 6. 验收标准

1. `node server.mjs --port 5180` 启动成功，`http://127.0.0.1:5180/` 打开页面。
2. 首屏 < 8 秒显示地球 + 卫星（本地缓存已存在时 < 3 秒）。
3. 卫星数 ~1.5 万，统计与国家筛选数字与 /api/catalog 一致。
4. 控制台无报错（无 404、无 CORS、无 JS 异常）。
5. 断网/刷新后仍可从缓存加载并显示（source = cache）。
