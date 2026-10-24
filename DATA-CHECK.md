# 数据核验报告 · orbit-holo

> 核验时间：2026-10-22　数据源：Space-Track GP（全量）+ CelesTrak SATCAT（元数据）
> 方法：内部一致性断言 + 与 Space-Track 官方 satcat 逐条比对抽样

## 1. 规模

| 项 | 值 |
| --- | --- |
| 在轨目标 | **35,466**（GP 原始 35,476 条，剔除 10 条已再入） |
| 国家 / 组织 | 107（含「其他(UNK)」桶） |
| 分类合计 | 通信 13,802 · 碎片 14,596 · 其他 5,190 · 对地观测 527 · 军事 520 · 导航 350 · 技术试验 246 · 气象 162 · 科学 73 = 35,466 ✅ |
| 对象类型合计 | 载荷 19,661 · 碎片 12,329 · 火箭残骸 2,267 · 未知 1,209 = 35,466 ✅ |
| 望远镜 | 20 台 |
| 空间站 / 载人 | 18 个目标 |

## 2. 一致性断言（全部通过）

| 检查项 | 结果 |
| --- | --- |
| NORAD 编号重复 | 0 |
| 分类求和 = 总数 | 35,466 = 35,466 ✅ |
| 对象类型求和 = 总数 | 35,466 = 35,466 ✅ |
| 国家求和 = 总数 | 35,466 = 35,466 ✅ |
| 分类求和 = 国家求和 | 相等 ✅ |
| DEB/R-B 未归入 debris 类 | 0 条 |
| debris 类但对象类型不是 DEB/R-B | 0 条 |
| 缺 TLE 两行 | 0 条 |
| 发射日期在未来 | 0 条 |
| 名称形如 ISS/CSS/神舟/联盟/龙飞船但漏标 isStation | 0 条 |

## 3. 与 Space-Track 官方逐条抽查（11/11 全对）

| NORAD | 本地名称 | 官方名称 | 本地类型 / 官方类型 |
| --- | --- | --- | --- |
| 20580 | HST | HST | PAY / PAYLOAD ✅ |
| 25867 | CXO | CXO | PAY / PAYLOAD ✅ |
| 25544 | ISS (ZARYA) | ISS (ZARYA) | PAY / PAYLOAD ✅ |
| 25575 | ISS (UNITY) | ISS (UNITY) | PAY / PAYLOAD ✅ |
| 340 | TELSTAR 1 | TELSTAR 1 | PAY / PAYLOAD ✅ |
| 573 | TELSTAR 2 (A-41) | TELSTAR 2 (A-41) | PAY / PAYLOAD ✅ |
| 51 | ECHO 1 DEB (METAL OBJ) | ECHO 1 DEB (METAL OBJ) | DEB / DEBRIS ✅ |
| 52 | ECHO 1 DEB (MYLAR OBJ) | ECHO 1 DEB (MYLAR OBJ) | DEB / DEBRIS ✅ |
| 53 | ECHO 1 DEB (METAL OBJ) | ECHO 1 DEB (METAL OBJ) | DEB / DEBRIS ✅ |
| 12 | VANGUARD R/B | VANGUARD R/B | R-B / ROCKET BODY ✅ |
| 734 | OPS 3367 A | OPS 3367 A | PAY / PAYLOAD ✅ |

抽样覆盖：望远镜 2、空间站 2、通信载荷 2、碎片 3、火箭残骸 1、军事 1。

## 4. 空间站 / 载人（18 条，NORAD 可在 space-track.org 直接查）

| 名称 | NORAD | 类型 | 发射 | 运营方 |
| --- | --- | --- | --- | --- |
| ISS (ZARYA) | 25544 | 常驻空间站 | 1998-11-20 | 国际空间站计划 |
| ISS (UNITY) | 25575 | 常驻空间站 | 1998-12-04 | 国际空间站计划 |
| ISS (ZVEZDA) | 26400 | 常驻空间站 | 2000-07-12 | 国际空间站计划 |
| ISS (DESTINY) | 26700 | 常驻空间站 | 2001-02-07 | 国际空间站计划 |
| POISK | 36086 | 常驻空间站 | 2009-11-10 | 国际空间站 |
| ISS (NAUKA) | 49044 | 常驻空间站 | 2021-07-21 | 国际空间站计划 |
| CSS (TIANHE-1) | 48274 | 常驻空间站 | 2021-04-29 | 中国载人航天工程办公室 |
| CSS (WENTIAN) | 53239 | 常驻空间站 | 2022-07-24 | 中国载人航天工程办公室 |
| CSS (MENGTIAN) | 54216 | 常驻空间站 | 2022-10-31 | 中国载人航天工程办公室 |
| SZ-20 MODULE | 67481 | 载人飞船 | 2025-04-24 | 中国 |
| SZ-21 MODULE | 66515 | 载人飞船 | 2025-10-31 | 中国 |
| SZ-22 MODULE | 69328 | 载人飞船 | 2025-11-25 | 中国 |
| SOYUZ MS-29 | 100057 | 载人飞船 | 2026-07-14 | 俄罗斯 |
| DRAGON GRACE 2 | 100882 | 载人飞船 | 2026-10-01 | 美国 |
| TIANZHOU 10 | 69049 | 货运飞船 | 2026-05-11 | 中国载人航天工程办公室 |
| PROGRESS MS-34 | 68837 | 货运飞船 | 2026-04-25 | 俄罗斯 |
| PROGRESS MS-35 | 100712 | 货运飞船 | 2026-09-16 | 俄罗斯 |
| DRAGON CRS-35 | 101031 | 货运飞船 | 2026-10-13 | 美国 |

**ISS 为什么只有 6 个元素？** 不是漏标 —— Space-Track 的 GP 目录里 ISS 只有 6 个带独立 TLE 的编目对象
（ZARYA/UNITY/ZVEZDA/DESTINY/NAUKA/POISK）。Columbus、Kibo、Harmony、Tranquility、Cupola 等舱段**没有独立的两行根数**，
在官方目录中并入 ZARYA（25544）整体，任何软件都无法给它们单独算位置。已用原始 3LE 文件逐名核对确认。

## 5. 望远镜（20 台）

| 名称 | 类型 | 轨道 |
| --- | --- | --- |
| HST | 光学 | LEO |
| CXO（钱德拉） | X 射线 | HEO |
| XMM | X 射线 | HEO |
| INTEGRAL | 伽马 | HEO |
| MOST | 光学 | LEO |
| SWIFT | 伽马 | LEO |
| SDO | 太阳 | GEO |
| NUSTAR | X 射线 | LEO |
| IRIS | 太阳 | LEO |
| ASTROSAT | X 射线 | LEO |
| DAMPE（悟空） | 伽马 | LEO |
| HXMT（慧眼） | X 射线 | LEO |
| CHEOPS | 光学 | LEO |
| GECAM-A / GECAM-B | X 射线 | LEO |
| IXPE | X 射线 | LEO |
| JWST | 红外 | HEO（L2 附近，目录登记为 HEO） |
| ASO-S（夸父一号） | 太阳 | LEO |
| EINSTEIN PROBE（天关） | X 射线 | LEO |
| SMILE | X 射线 | HEO |

## 6. 已知限制（不是 bug，写清楚免得误解）

1. **碎片只含有 TLE 的部分**：Space-Track GP 只对仍在跟踪且根数可用的目标发布 TLE；部分古老碎片无根数，无法递推。
2. **1,209 个目标无 SATCAT 元数据**（占 3.4%）：国家/对象类型标为 UNK，位置仍准确。
3. **10 条已再入目标被剔除**（DECAY_DATE 非空，连 TLE 一起丢弃）。
4. **ISS 模块粒度**：见 §4。
5. **RCS 缺失**：部分老目标 SATCAT 无 RCS，星等估算退回按类型启发式。
