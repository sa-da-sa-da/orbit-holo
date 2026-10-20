/**
 * 卫星「运营方 + 任务类型」分类器（CONTRACT-V2 §7）
 *
 * 设计原则：
 *  1) 以「名称正则 + 目录(owner) + 轨道 + 发射年份」组合判定，规则表按"具体 → 宽泛"排序，先命中先生效。
 *  2) 纯函数、无随机、无时间依赖 → 同一输入永远同一输出（可复现）。
 *  3) 宁可 other 也不瞎猜：商用/民用星座绝不标 mil；owner=US 不等于 military。
 *  4) 每条判定都产出 categoryNote（判定依据，<= 40 字）。
 */

/* ------------------------------------------------------------------ */
/* 8 类定义（key 固定，顺序即前端展示顺序）                              */
/* ------------------------------------------------------------------ */
export const CATEGORY_DEFS = {
  comms:   { label: '通信 / 互联网',     labelEn: 'Communications' },
  nav:     { label: '导航 / 定位',       labelEn: 'Navigation' },
  eo:      { label: '对地观测 / 遥感',   labelEn: 'Earth Observation' },
  mil:     { label: '军事 / 侦察',       labelEn: 'Military & Recon' },
  weather: { label: '气象 / 海洋 / 环境', labelEn: 'Weather & Ocean' },
  science: { label: '科学 / 深空 / 载人', labelEn: 'Science & Human' },
  tech:    { label: '技术试验 / 教育 / 业余', labelEn: 'Tech Demo & Education' },
  other:   { label: '其他 / 未分类',     labelEn: 'Other' },
  debris:  { label: '碎片 / 残骸',       labelEn: 'Debris & Rocket Bodies' },
  station: { label: '空间站 / 载人',     labelEn: 'Stations & Crew' },
};
// V5 debisr 第 9 类；V20 §41 新增第 10 类 station（追加在末尾，前 9 类顺序不变）
export const CATEGORY_ORDER = ['comms', 'nav', 'eo', 'mil', 'weather', 'science', 'tech', 'other', 'debris', 'station'];

const K = {
  company: 'company', agency: 'agency', military: 'military',
  intergov: 'intergov', academic: 'academic', unknown: 'unknown',
};

/* ------------------------------------------------------------------ */
/* 运营方表：正则 → { name, zh, kind }                                  */
/* 顺序很重要：越具体越靠前                                              */
/* ------------------------------------------------------------------ */
const OPERATORS = [
  // —— 巨型星座 ——
  [/^STARLINK\b/i,                    'SpaceX', '太空探索技术公司 SpaceX', K.company],
  [/^ONEWEB\b/i,                      'Eutelsat OneWeb', '欧洲通信卫星公司 OneWeb', K.company],
  [/^KUIPER\b/i,                      'Amazon Kuiper', '亚马逊 柯伊伯计划', K.company],
  [/^QIANFAN\b/i,                     'Shanghai Yuanxin Satellite', '上海垣信卫星（千帆星座）', K.company],
  [/^HULIANWANG\b|^GUOWANG\b/i,       'China SatNet', '中国星网（国网星座）', K.company],
  // —— 导航 ——
  [/^NAVSTAR\b|^GPS[ -]?\d|^GPS \w/i, 'US Space Force', '美国太空军（GPS）', K.military],
  [/GLONASS|URAGAN/i,                 'Roscosmos', '俄罗斯国家航天集团（GLONASS）', K.agency],
  [/GALILEO|^GSAT0\d/i,               'ESA / EUSPA', '欧洲空间局（Galileo）', K.intergov],
  [/^BEIDOU\b|^BD-\d|北斗/i,           'CSNO', '中国卫星导航系统管理办公室（北斗）', K.agency],
  [/^QZS-|QZSS|MICHIBIKI/i,           'QZSS', '日本准天顶卫星系统（内阁府）', K.agency],
  [/^IRNSS\b|NAVIC/i,                 'ISRO', '印度空间研究组织（NavIC）', K.agency],
  // —— 国际与西方商业星座 ——
  [/^IRIDIUM\b/i,                     'Iridium', '铱星通信公司 Iridium', K.company],
  [/^GLOBALSTAR\b/i,                  'Globalstar', '全球星公司 Globalstar', K.company],
  [/^ORBCOMM\b/i,                     'Orbcomm', '轨道通信公司 Orbcomm', K.company],
  [/^SES[ -]|^O3B|^ASTRA\b|^NSS-|^AMC-/i, 'SES', 'SES 卫星公司', K.company],
  [/^EUTELSAT\b|HOTBIRD|KA-SAT/i,     'Eutelsat', '欧洲通信卫星公司 Eutelsat', K.company],
  [/^INTELSAT\b|^IS-\d|^GALAXY\b/i,   'Intelsat', '国际通信卫星公司 Intelsat', K.company],
  [/^INMARSAT\b/i,                    'Inmarsat', '国际海事卫星公司 Inmarsat', K.company],
  [/^VIASAT\b/i,                      'Viasat', '卫讯公司 Viasat', K.company],
  [/^TELESAT\b|^ANIK\b|^NIMIQ\b|^TELSTAR\b/i, 'Telesat', '加拿大电信卫星公司 Telesat', K.company],
  [/SPACEMOBILE/i,                    'AST SpaceMobile', 'AST 太空移动公司', K.company],
  [/^ECHOSTAR\b/i,                    'EchoStar', '回声星通信 EchoStar', K.company],
  [/^DIRECTV\b/i,                     'DirecTV', 'DirecTV 直播电视', K.company],
  [/^SXM-|SIRIUSXM|SIRIUS XM/i,       'SiriusXM', '天狼星卫星广播 SiriusXM', K.company],
  [/^JCSAT\b|^BSAT\b|^N-STAR\b|^SUPERBIRD/i, 'SKY Perfect JSAT', '日本天空完美 JSAT', K.company],
  [/^KOREASAT\b|^KORSAT\b|^MUGUNGWHA/i, 'KT SAT', '韩国 KT 卫星', K.company],
  [/^TURKSAT\b/i,                     'Turksat', '土耳其卫星公司 Türksat', K.company],
  [/^OPTUS\b/i,                       'Optus', '澳大利亚 Optus 通信', K.company],
  [/^APSTAR\b/i,                      'APT Satellite', '亚太卫星公司 APT', K.company],
  [/^ASIASAT\b/i,                     'AsiaSat', '亚洲卫星公司 AsiaSat', K.company],
  [/^CHINASAT\b|^ZHONGXING\b|^中星/i,  'China Satcom', '中国卫通集团', K.company],
  [/^ARABSAT\b/i,                     'Arabsat', '阿拉伯卫星通信组织 Arabsat', K.intergov],
  [/^SAUDICOMSAT\b|^SAUDISAT\b/i,     'KACST', '沙特阿卜杜勒阿齐兹国王科技城', K.agency],
  [/^NORSAT\b/i,                      'Norwegian Space Centre', '挪威航天中心', K.agency],
  [/^AMAZONAS\b/i,                     'Hispasat', '西班牙 Hispasat 卫星公司', K.company],
  [/^STAR ONE\b/i,                     'Embratel', '巴西 Embratel 电信', K.company],
  [/^YAMAL\b/i,                        'Gazprom Space Systems', '俄罗斯天然气航天系统', K.company],
  [/^EXPRESS-?A|^EXPRESS-MD/i,         'RSCC', '俄罗斯卫星通信公司 RSCC', K.company],
  [/^GONETS\b/i,                       'Gonets', '俄罗斯 Gonets 卫星通信', K.company],
  [/^MOLNIYA\b|^MERIDIAN\b|^LUCH\b/i,  'Roscosmos', '俄罗斯国家航天集团（通信/中继）', K.agency],
  [/^KINEIS\b/i,                       'Kinéis', '法国 Kinéis 物联网星座', K.company],
  [/^ASTROCAST\b/i,                    'Astrocast', '瑞士 Astrocast 物联网星座', K.company],
  [/^CENTAURI\b/i,                     'Fleet Space', '澳大利亚 Fleet Space', K.company],
  [/^KSM1|^KEPLER\b/i,                 'Kepler Communications', '加拿大开普勒通信', K.company],
  [/^LYNK\b/i,                         'Lynk Global', '美国 Lynk Global 直连手机', K.company],
  [/^SPACEBEE\b/i,                     'Swarm Technologies', '美国 Swarm 物联网', K.company],
  [/^SITRO\b/i,                        'SITRO-AIS', '俄罗斯 SITRO-AIS 船舶监视', K.company],
  [/^GEESAT\b/i,                       'Geely / GeeSAT', '吉利时空道宇（未来出行星座）', K.company],
  [/^TIANQI\b/i,                       'Guodian Gaoke', '国电高科（天启物联网星座）', K.company],
  [/^CENTISPACE\b/i,                   'CentiSpace', '中科星睿（低轨导航增强）', K.company],
  [/^HORS\b/i,                         'HORS', 'HORS 系列', K.company],
  [/^THURAYA\b/i,                     'Thuraya', '阿联酋 Thuraya 卫星通信', K.company],
  [/^HELLAS-?SAT/i,                    'HellasSat', '希腊 HellasSat', K.company],
  [/^CO3D\b/i,                        'Airbus Defence and Space', '空客防务与航天', K.company],
  [/^GEO-KOMPSAT\b|^CAS500\b/i,      'KARI', '韩国航空宇宙研究院', K.agency],
  [/^SDS-\d|^KOYOH\b|^ARIRANG\b|^KOMPSAT/i, 'KARI', '韩国航空宇宙研究院', K.agency],
  [/^SYRACUSE\b/i,                     'DGA', '法国国防采购局（Syracuse）', K.military],
  [/^THAICOM\b/i,                      'Thaicom', '泰国 Thaicom 通信', K.company],
  // —— 对地观测商业公司 ——
  [/^FLOCK\b|^SKYSAT\b|^PLANET\b|^DOVE\b|^SKYBOX\b|^PELICAN\b/i, 'Planet Labs', '行星实验室 Planet Labs', K.company],
  [/^ICEYE\b/i,                        'ICEYE', '芬兰冰眼 ICEYE', K.company],
  [/^CAPELLA\b/i,                      'Capella Space', '美国卡佩拉空间', K.company],
  [/^UMBRA\b/i,                        'Umbra Space', '美国本影空间', K.company],
  [/^LEMUR\b/i,                        'Spire Global', '美国斯派尔全球 Spire', K.company],
  [/^NUSAT\b/i,                        'Satellogic', '阿根廷卫星逻辑 Satellogic', K.company],
  [/^GRUS\b/i,                         'Axelspace', '日本 Axelspace', K.company],
  [/^QPS-SAR|^QPS\b/i,                 'iQPS', '日本 iQPS 合成孔径雷达', K.company],
  [/^STRIX\b/i,                        'Synspective', '日本 Synspective', K.company],
  [/^GHGSAT\b/i,                       'GHGSat', '加拿大 GHGSat 温室气体监测', K.company],
  [/^WORLDVIEW\b|^GEOEYE\b|^QUICKBIRD\b|^LEGION\b/i, 'Maxar', '美国马克萨 Maxar', K.company],
  [/^PLEIADES\b|^SPOT\b|^PELICAN\b/i,  'Airbus Defence and Space', '空客防务与航天', K.company],
  [/^COSMO-?SKYMED/i,                  'ASI', '意大利航天局（COSMO-SkyMed）', K.agency],
  [/^TERRASAR\b/i,                     'DLR', '德国宇航中心（TerraSAR-X）', K.agency],
  [/^RADARSAT\b/i,                     'CSA', '加拿大航天局（RADARSAT）', K.agency],
  [/^PAZ\b/i,                          'Hispasat / INTA', '西班牙 PAZ 雷达卫星', K.company],
  [/^JILIN\b|^吉林/i,                   'Chang Guang Satellite', '长光卫星（吉林一号）', K.company],
  [/^PIESAT\b/i,                       'PIESAT', '航天宏图（女娲星座）', K.company],
  [/^BRO\b/i,                          'Unseenlabs', '法国 Unseenlabs 射频侦察', K.company],
  [/^AAC\b/i,                          'AAC Clyde Space', '英国 AAC 克莱德空间', K.company],
  [/^YAM\b/i,                          'Loft Orbital', '美国 Loft Orbital 共享平台', K.company],
  [/^ION SCV|^ION-\d/i,                'D-Orbit', '意大利 D-Orbit 轨道转移', K.company],
  [/^HAWK\b/i,                         'HawkEye 360', '美国鹰眼 360 射频定位', K.company],
  [/^DISKSAT\b/i,                      'DiskSat', 'DiskSat 试验平台', K.company],
  // —— 中国国家系列 ——
  [/^YAOGAN\b|^YG-\d|遥感/i,            'CASC', '中国航天科技集团（遥感系列）', K.company],
  [/^GAOFEN\b|^GF-\d|高分/i,            'CASC', '中国航天科技集团（高分系列）', K.company],
  [/^ZIYUAN\b|^ZY-\d|资源/i,            'CASC', '中国航天科技集团（资源系列）', K.company],
  [/^TIANHUI\b/i,                      'CASC', '中国航天科技集团（天绘系列）', K.company],
  [/^HAIYANG\b|^HY-\d/i,               'CASC', '中国航天科技集团（海洋系列）', K.company],
  [/^YUNHAI\b/i,                       'CASC', '中国航天科技集团（云海系列）', K.company],
  [/^SHIJIAN\b|^SJ-\d/i,               'CASC', '中国航天科技集团（实践系列）', K.company],
  [/^SHIYAN\b|^SY-\d/i,                'CASC', '中国航天科技集团（试验系列）', K.company],
  [/^TJS-?\d|^TJS\b/i,                 'CASC', '中国航天科技集团（通信技术试验）', K.company],
  [/^FENGYUN\b|^FY-\d|风云/i,           'CMA', '中国气象局（风云系列）', K.agency],
  [/^TIANLIAN\b/i,                     'CMSA', '中国载人航天工程办公室（天链中继）', K.agency],
  [/^CSS\b|^TIANHE\b|^WENTIAN\b|^MENGTIAN\b|^TIANZHOU\b|^SHENZHOU\b|天宫|天和/i,
    'CMSA', '中国载人航天工程办公室', K.agency],
  [/^HULIANWANG JISHU/i,               'China SatNet', '中国星网（卫星互联网技术试验）', K.company],
  [/^SUPERVIEW\b|^NINGXIA\b|^ZHUHAI\b|^HEAD\b|^BEIJING-?3|^HJ-\d/i, 'CASC', '中国航天科技集团（商业遥感）', K.company],
  [/^TIANMU\b/i,                       'MinoSpace', '微纳星空（天目星座）', K.company],
  [/^YUNYAO\b/i,                       'Yunyao Aerospace', '云遥宇航（掩星气象）', K.company],
  [/^TIANYI\b/i,                       'CASC', '中国航天科技集团（天仪系列）', K.company],
  [/^CHUANGXIN\b/i,                    'CAST', '中国空间技术研究院（创新系列）', K.company],
  [/^SCS\b|^GJZ\b|^LKW\b|^TIANPING\b/i, 'CASC', '中国航天科技集团', K.company],
  // —— 国际机构与政府 ——
  [/^SENTINEL\b/i,                     'ESA', '欧洲空间局（哥白尼哨兵）', K.intergov],
  [/^LANDSAT\b/i,                      'NASA / USGS', '美国国家航空航天局 / 地质调查局', K.agency],
  [/^NOAA\b|^JPSS\b|^SUOMI NPP|^DMSP\b/i, 'NOAA', '美国国家海洋和大气管理局', K.agency],
  [/^GOES\b/i,                         'NOAA', '美国国家海洋和大气管理局（GOES）', K.agency],
  [/^HIMAWARI\b/i,                     'JMA', '日本气象厅', K.agency],
  [/^METOP\b|^METEOSAT\b|^MSG-\d/i,    'EUMETSAT', '欧洲气象卫星组织', K.intergov],
  [/^METEOR-?M|^ELEKTRO-?L/i,          'Roscosmos', '俄罗斯国家航天集团（气象）', K.agency],
  [/^COSMOS\b/i,                       'Roscosmos', '俄罗斯国家航天集团', K.agency],
  [/^RESURS\b|^KANOPUS\b/i,            'Roscosmos', '俄罗斯国家航天集团（遥感）', K.agency],
  [/^INSAT\b|^GSAT[ -]\d|^CARTOSAT\b|^OCEANSAT\b|^SCATSAT\b|^SARAL\b/i, 'ISRO', '印度空间研究组织', K.agency],
  [/^FORMOSAT\b/i,                     'NSPO', '台湾太空中心', K.agency],
  [/^ALSAT\b/i,                        'ASAL', '阿尔及利亚航天局', K.agency],
  [/^IRIDE\b/i,                        'ASI / ESA', '意大利航天局（IRIDE 星座）', K.agency],
  [/^PROBA\b/i,                        'ESA', '欧洲空间局（PROBA 技术试验）', K.intergov],
  [/^TDRS\b|^EDRS\b/i,                 'NASA / ESA', 'NASA / ESA 数据中继', K.agency],
  [/^ISS\b|^ZARYA\b/i,                  'ISS Program', '国际空间站计划', K.intergov],
  [/^HST\b|^HUBBLE SPACE/i,            'NASA', '美国国家航空航天局（哈勃）', K.agency],
  [/^JWST\b/i,                          'NASA / ESA / CSA', '詹姆斯·韦布空间望远镜', K.intergov],
  [/^MMS\b|^PUNCH\b|^GRACE\b|^ICESAT\b|^JASON\b|^SWARM\b|^CLUSTER\b|^THEMIS\b|^AQUA\b|^TERRA\b|^AURA\b|^OCO-?\d|^GOSAT\b/i,
    'NASA / ESA', 'NASA / ESA 地球科学', K.agency],
  // —— 军事 ——
  [/^NROL\b|^USA[ -]?\d|^MILSTAR\b|^AEHF\b|^WGS\b|^MUOS\b|^SBIRS\b|^DSP\b|^UFO \d|^SKYNET\b|^SAR-?LUPE|^HELIOS[- ]?[12][AB]?\b|^X-37B|^OTV\b|^GSSAP\b|^LACROSSE|^TOPAZ\b|^MISTY\b/i,
    'US Space Force / NRO', '美国太空军 / 国家侦察局', K.military],
  [/PRAETORIAN|CHECKMATE|^SDA\b/i,     'US Space Force (SDA)', '美国太空发展局', K.military],
  // —— 技术试验 / 业余 ——
  [/CUBESAT|^CUBE-?SAT/i,              'CubeSat', '立方星计划', K.academic],
  [/^AMSAT\b|OSCAR|^AO-\d|^SO-\d|^CO-\d|^IO-\d|^FO-\d|ITAMSAT|^RS\d+\*?/i, 'AMSAT', '业余无线电卫星组织 AMSAT', K.academic],
  [/^TEVEL\b/i,                        'Tel Aviv University', '特拉维夫大学（TEVEL 业余卫星）', K.academic],
  [/^APRIZESAT\b/i,                    'AMSAT / 教育机构', '教育立方星计划', K.academic],
  [/^STARLING\b/i,                     'NASA', '美国国家航空航天局（STARLING 立方星）', K.agency],
  [/^AETHER\b/i,                       'Aether', 'Aether 在轨制造试验', K.company],
  [/^FOSSASAT\b/i,                     'FOSSA Systems', '西班牙 FOSSA 物联网', K.company],
  [/^AEROCUBE\b/i,                     'NASA / 大学', 'AeroCube 技术试验', K.academic],
];

/* ------------------------------------------------------------------ */
/* 任务类型规则表：正则 → { cat, conf, note }                          */
/* 顺序 = 优先级（具体 → 宽泛），并对高频星座做前置优化                  */
/* ------------------------------------------------------------------ */
const RULES = [
  // ===== 通信 / 互联网（数据量最大，放最前） =====
  [/^STARLINK\b/i,                    'comms', 'high',   '名称匹配 STARLINK 星座'],
  [/^ONEWEB\b/i,                      'comms', 'high',   '名称匹配 OneWeb 星座'],
  [/^KUIPER\b/i,                      'comms', 'high',   '名称匹配 Kuiper 星座'],
  [/^QIANFAN\b/i,                     'comms', 'high',   '名称匹配 千帆星座'],
  [/^HULIANWANG\b|^GUOWANG\b/i,       'comms', 'high',   '名称匹配 卫星互联网（国网）'],
  [/^IRIDIUM\b/i,                     'comms', 'high',   '名称匹配 铱星星座'],
  [/^GLOBALSTAR\b/i,                  'comms', 'high',   '名称匹配 全球星星座'],
  [/^ORBCOMM\b/i,                     'comms', 'high',   '名称匹配 Orbcomm 星座'],
  [/^LEMUR\b/i,                       'other', 'low',    'Spire 多用途射频遥感'],
  [/^TIANQI\b/i,                      'comms', 'high',   '名称匹配 天启物联网星座'],
  [/^(SES|O3B|ASTRA|NSS|AMC)[ -]/i,   'comms', 'high',   '名称匹配 SES 系列'],
  [/^EUTELSAT\b|HOTBIRD|KA-SAT/i,     'comms', 'high',   '名称匹配 Eutelsat 系列'],
  [/^INTELSAT\b|^IS-\d+|^GALAXY\b/i,  'comms', 'high',   '名称匹配 Intelsat 系列'],
  [/^INMARSAT\b/i,                    'comms', 'high',   '名称匹配 Inmarsat 系列'],
  [/^VIASAT\b/i,                      'comms', 'high',   '名称匹配 Viasat 系列'],
  [/^TELESAT\b|^ANIK\b|^NIMIQ\b|^TELSTAR\b/i, 'comms', 'high', '名称匹配 Telesat 系列'],
  [/SPACEMOBILE/i,                    'comms', 'high',   '名称匹配 AST SpaceMobile'],
  [/^ECHOSTAR\b|^DIRECTV\b|^SXM-\d|SIRIUS ?XM/i, 'comms', 'high', '名称匹配 直播/广播卫星'],
  [/^JCSAT\b|^BSAT\b|^N-STAR\b|^SUPERBIRD/i, 'comms', 'high', '名称匹配 日本通信广播卫星'],
  [/^KOREASAT\b|^KORSAT\b|^MUGUNGWHA/i, 'comms', 'high', '名称匹配 韩国通信卫星'],
  [/^TURKSAT\b/i,                     'comms', 'high',   '名称匹配 Türksat 系列'],
  [/^OPTUS\b/i,                       'comms', 'high',   '名称匹配 Optus 系列'],
  [/^APSTAR\b/i,                      'comms', 'high',   '名称匹配 亚太卫星系列'],
  [/^ASIASAT\b/i,                     'comms', 'high',   '名称匹配 亚洲卫星系列'],
  [/^CHINASAT\b|^ZHONGXING\b|^中星/i,  'comms', 'high',   '名称匹配 中星/中国卫通系列'],
  [/^ARABSAT\b/i,                     'comms', 'high',   '名称匹配 Arabsat 系列'],
  [/^SAUDICOMSAT\b|^SAUDISAT\b/i,     'comms', 'medium', '名称匹配 沙特通信卫星'],
  [/^NORSAT\b/i,                      'comms', 'high',   '名称匹配 挪威 NORSAT'],
  [/^AMAZONAS\b/i,                    'comms', 'high',   '名称匹配 Hispasat 系列'],
  [/^STAR ONE\b/i,                    'comms', 'high',   '名称匹配 Embratel 系列'],
  [/^YAMAL\b/i,                       'comms', 'high',   '名称匹配 俄 Yamal 通信'],
  [/^EXPRESS-?A|^EXPRESS-?MD/i,       'comms', 'high',   '名称匹配 俄 Express 通信'],
  [/^THURAYA\b/i,                    'comms', 'high',   '名称匹配 阿联酋 Thuraya'],
  [/^HELLAS-?SAT/i,                   'comms', 'high',   '名称匹配 希腊 HellasSat'],
  [/^THAICOM\b/i,                     'comms', 'high',   '名称匹配 泰国 Thaicom'],
  [/^GONETS\b/i,                      'comms', 'high',   '名称匹配 Gonets 通信'],
  [/^MOLNIYA\b|^MERIDIAN\b|^LUCH\b/i, 'comms', 'high',   '名称匹配 俄通信/中继系列'],
  [/^KINEIS\b|^ASTROCAST\b|^CENTAURI\b|^KSM1|^LYNK\b|^SPACEBEE\b/i, 'comms', 'high', '名称匹配 物联网/直连星座'],
  [/^SITRO\b/i,                       'other', 'medium', 'SITRO-AIS 船舶监视'],
  [/^GEESAT\b/i,                     'comms', 'medium', '吉利未来出行星座（物联网/导航增强）'],
  [/^GSAT[ -]\d/i,                    'comms', 'high',   '名称匹配 印度 GSAT 通信卫星'],
  [/^CONNECTA\b/i,                   'comms', 'high',   '名称匹配 土耳其 Connecta IoT'],
  [/^RASSVET\b/i,                    'comms', 'high',   '名称匹配 俄 Rassvet 通信'],
  [/^ABS-?\d/i,                       'comms', 'high',   '名称匹配 亚洲广播卫星 ABS'],
  [/^SKYKRAFT\b/i,                   'comms', 'medium', 'Skykraft 天基监视/通信'],
  [/^EXPRESS\b/i,                    'comms', 'high',   '名称匹配 俄 Express 通信'],
  [/^CENTISPACE\b/i,                  'nav',   'medium', '低轨导航增强星座'],
  [/^TDRS\b|^EDRS\b|^TIANLIAN\b/i,    'comms', 'high',   '名称匹配 数据中继卫星'],
  [/^TJS-?\d/i,                       'tech',  'medium', '通信技术试验系列'],
  [/^TIANYI\b|^CHUANGXIN\b/i,         'comms', 'medium', '名称匹配 通信试验系列'],
  [/^SCS\b|^GJZ\b|^TIANPING\b/i,      'other', 'low',    '名称无法判定任务类型'],
  // ===== 导航 =====
  [/^NAVSTAR\b|^GPS[ -]?\d|^GPS [A-Z]|^BIIR|^BLOCK II/i, 'nav', 'high', '名称匹配 GPS/NAVSTAR'],
  [/GLONASS|URAGAN/i,                 'nav', 'high',   '名称匹配 GLONASS（COSMOS 编号）'],
  [/GALILEO|^GSAT0\d/i,               'nav', 'high',   '名称匹配 Galileo'],
  [/^BEIDOU\b|^BD-\d|北斗/i,           'nav', 'high',   '名称匹配 北斗'],
  [/^QZS-|QZSS|MICHIBIKI/i,           'nav', 'high',   '名称匹配 QZSS'],
  [/^IRNSS\b|NAVIC/i,                 'nav', 'high',   '名称匹配 NavIC'],
  [/^CENTISPACE\b/i,                  'nav', 'medium', '低轨导航增强星座'],
  // ===== 气象 / 海洋 / 环境 =====
  [/^GOES\b/i,                        'weather', 'high', '名称匹配 GOES'],
  [/^NOAA\b|^JPSS\b|^SUOMI NPP|^DMSP\b/i, 'weather', 'high', '名称匹配 NOAA/JPSS'],
  [/^FENGYUN\b|^FY-\d|风云/i,          'weather', 'high', '名称匹配 风云系列'],
  [/^HIMAWARI\b/i,                    'weather', 'high', '名称匹配 Himawari'],
  [/^METOP\b|^METEOSAT\b|^MSG-\d/i,   'weather', 'high', '名称匹配 Metop/Meteosat'],
  [/^METEOR-?M|^ELEKTRO-?L/i,         'weather', 'high', '名称匹配 俄气象卫星'],
  [/^YUNYAO\b/i,                      'weather', 'medium', '云遥 GNSS 掩星气象'],
  [/^YUNHAI\b|^HAIYANG\b|^HY-\d/i,    'weather', 'medium', '名称匹配 大气/海洋环境卫星'],
  [/^HJ-\d/i,                         'weather', 'medium', '环境减灾系列'],
  [/^OCEANSAT\b|^SCATSAT\b|^SARAL\b/i,'weather', 'high', '名称匹配 印度海洋/气象卫星'],
  [/^INSAT\b/i,                       'comms', 'medium', '印度通信/气象两用'],
  [/^GNOMES\b/i,                      'weather', 'medium', 'PlanetIQ 掩星气象'],
  [/^FORMOSAT-?7|^COSMIC-?2/i,        'weather', 'high',   '名称匹配 掩星气象星座'],
  [/^GEO-KOMPSAT\b/i,                 'weather', 'high',   '名称匹配 韩国气象/海洋卫星'],
  [/^IONOSFERA\b/i,                  'science', 'medium', '电离层探测科学卫星'],
  [/^GHGSAT\b/i,                      'eo',    'medium', '温室气体监测（环境遥感）'],
  // ===== 对地观测 / 遥感 =====
  [/^SENTINEL\b/i,                    'eo', 'high',  '名称匹配 哥白尼哨兵'],
  [/^LANDSAT\b/i,                     'eo', 'high',  '名称匹配 Landsat'],
  [/^GAOFEN\b|^GF-\d|高分/i,           'eo', 'high',  '名称匹配 高分系列'],
  [/^ZIYUAN\b|^ZY-\d|资源/i,           'eo', 'high',  '名称匹配 资源系列'],
  [/^TIANHUI\b/i,                     'eo', 'high',  '名称匹配 天绘测绘'],
  [/^JILIN\b|^吉林/i,                  'eo', 'high',  '名称匹配 吉林一号'],
  [/^SUPERVIEW\b|^NINGXIA\b|^ZHUHAI\b|^HEAD-?\d/i, 'eo', 'medium', '名称匹配 商业遥感星座'],
  [/^FLOCK\b|^SKYSAT\b|^PLANET\b|^DOVE\b|^SKYBOX\b|^PELICAN\b/i, 'eo', 'high', '名称匹配 Planet 遥感星座'],
  [/^ICEYE\b|^CAPELLA\b|^UMBRA\b|^QPS-SAR|^STRIX\b/i, 'eo', 'high', '名称匹配 商业 SAR 卫星'],
  [/^NUSAT\b/i,                       'eo', 'high',   '名称匹配 Satellogic 遥感'],
  [/^GRUS\b/i,                        'eo', 'high',   '名称匹配 Axelspace 遥感'],
  [/^WORLDVIEW\b|^GEOEYE\b|^QUICKBIRD\b/i, 'eo', 'high', '名称匹配 Maxar 高分辨率遥感'],
  [/^PLEIADES\b|^SPOT-?\d/i,          'eo', 'high',   '名称匹配 空客光学遥感'],
  [/^COSMO-?SKYMED/i,                 'eo', 'high',   '名称匹配 COSMO-SkyMed'],
  [/^TERRASAR\b|^PAZ\b|^RADARSAT\b/i, 'eo', 'high',   '名称匹配 雷达遥感卫星'],
  [/^PIESAT\b|^TIANMU\b/i,            'eo', 'medium', '名称匹配 商业遥感星座'],
  [/^CARTOSAT\b|^RESURS\b|^KANOPUS\b/i, 'eo', 'high', '名称匹配 光学遥感'],
  [/^FORMOSAT\b/i,                   'eo', 'high',   '名称匹配 FORMOSAT 遥感'],
  [/^CAS500\b/i,                      'eo', 'high',   '名称匹配 韩国 CAS500 遥感'],
  [/^CO3D\b/i,                        'eo', 'high',   '名称匹配 空客 CO3D 立体遥感'],
  [/^ARIRANG\b|^KOMPSAT\b/i,          'eo', 'high',   '名称匹配 韩国多用途遥感'],
  [/^ALSAT\b|^IRIDE\b/i,              'eo', 'high',   '名称匹配 国家遥感星座'],
  [/^HAWK\b/i,                        'other', 'low', 'HawkEye 360 射频定位'],
  [/^BRO\b/i,                         'other', 'medium', 'Unseenlabs 射频侦察'],
  [/^WILDFIRE\b/i,                    'eo', 'low',    '名称疑似野火监测'],
  [/^AAC\b/i,                         'eo', 'medium', 'AAC 小卫星遥感/技术'],
  // ===== 军事 / 侦察（严格，仅明确军用命名） =====
  [/^USA[ -]?\d{3,4}/i,               'mil', 'medium', 'USA 编号，军用/侦察任务'],
  [/^NROL\b|^MILSTAR\b|^AEHF\b|^WGS\b|^MUOS\b|^SBIRS\b|^DSP\b|^UFO \d|^SKYNET\b|^SAR-?LUPE|^HELIOS[- ]?[12][AB]?\b|^X-37B|^OTV\b|^GSSAP\b|^LACROSSE|^TOPAZ\b|^MISTY\b|^SDA_\d/i,
    'mil', 'high', '名称匹配 军用系统'],
  [/^YAOGAN\b|^YG-\d|遥感/i,           'mil', 'medium', '遥感系列，按侦察任务判定为军用'],
  [/PRAETORIAN|CHECKMATE|^SDA\b/i,    'mil', 'high',   '名称匹配 SDA 计划'],
  [/^SKYNET\b/i,                      'mil', 'high',   '名称匹配 英国军用通信'],
  [/^OPS \d|^FLTSATCOM\b/i,           'mil', 'medium', 'OPS/FLTSATCOM 美军编号'],
  [/^SYRACUSE\b/i,                     'mil', 'high',   '名称匹配 法国军用通信'],
  // ===== 科学 / 深空 / 载人 =====
  [/^ISS\b|^ZARYA\b/i,                'science', 'high', '名称匹配 国际空间站'],
  [/^CSS\b|^TIANHE\b|^WENTIAN\b|^MENGTIAN\b|^TIANZHOU\b|^SHENZHOU\b|天宫|天和/i,
    'science', 'high', '名称匹配 中国空间站/载人'],
  [/^HST\b|^HUBBLE SPACE/i,           'science', 'high', '名称匹配 哈勃空间望远镜'],
  [/^JWST\b/i,                        'science', 'high', '名称匹配 詹姆斯·韦布望远镜'],
  [/^MMS\b|^PUNCH\b|^GRACE\b|^ICESAT\b|^JASON\b|^SWARM\b|^CLUSTER\b|^THEMIS\b|^OCO-?\d|^GOSAT\b|^AQUA\b|^AURA\b/i,
    'science', 'medium', '名称匹配 地球科学/空间科学'],
  [/^TERRA\b/i,                       'science', 'medium', '名称匹配 地球科学平台'],
  [/^PROBA\b/i,                       'tech', 'medium', 'ESA 技术试验'],
  [/^CALSPHERE\b|^LAGEOS\b|^STARLETTE\b|^STELLA\b|^AJISAI\b|^ETALON\b|^GEOS-?\d|^POLAR\b|^FORTE\b|^CELESTIS\b|^SCD-?\d/i,
    'science', 'medium', '测地/空间科学卫星'],
  [/^DMSP\b/i,                        'weather', 'high', '名称匹配 国防气象卫星 DMSP'],
  // ===== 技术试验 / 教育 / 业余 =====
  [/CUBESAT|^CUBE-?SAT/i,             'tech', 'high', '名称匹配 CubeSat 立方星'],
  [/^AMSAT\b|OSCAR|^AO-\d|^SO-\d|^CO-\d|^IO-\d|^FO-\d|ITAMSAT/i, 'tech', 'high', '名称匹配 业余无线电卫星'],
  [/^(TEVEL|APRIZESAT|AEROCUBE|FOSSASAT|CUBY|NETSAT|GEOSCAN|FOREST)\b/i, 'tech', 'high', '名称匹配 教育/技术验证立方星'],
  [/\((?:AO|SO|CO|FO|IO|NO|PO|LO|UO|MO|TO|JO|KO|RS|RO|EO|WO|BO|DO|GO|HO)[- ]?\d+\)/i, 'tech', 'high', '名称含业余无线电编号'],
  [/^KL-|^S-NET\b/i,                  'tech', 'medium', '德国大学技术试验立方星'],
  [/^SDS-\d|^KOYOH\b|^WREN-\d|^XCUBE|^VINDLER\b|^MENUT\b|RODNIK|^TECHNOSAT|^UHETSAT|^NAPA-?\d/i, 'tech', 'medium', '技术试验/立方星'],
  [/^SHIYAN\b|^SY-\d/i,               'tech', 'medium', '试验系列（技术验证）'],
  [/^SHIJIAN\b|^SJ-\d/i,              'tech', 'medium', '实践系列（技术试验）'],
  [/^STARLING\b/i,                    'tech', 'medium', 'NASA STARLING 立方星试验'],
  [/^ION SCV|^ION-\d/i,               'tech', 'medium', '轨道转移/拼车载具'],
  [/^AETHER\b|^DISKSAT\b|^YAM\b/i,    'tech', 'medium', '在轨技术验证平台'],
  [/^TRANSPORTER\b|^BANDWAGON\b/i,    'other', 'low', '拼车任务未命名载荷'],
  [/^COSMOS\b/i,                      'other', 'low', '通用 COSMOS 编号，类型不明'],
];

/* ------------------------------------------------------------------ */
/* V5 §20.5 天文望远镜识别表（精确名白名单 + 关键字兜底）                */
/* ------------------------------------------------------------------ */
// 注意：CelesTrak 里 Chandra 叫 CXO、Fermi 早期叫 FGRST (GLAST)、ISRO 的 IRIS 与太阳 IRIS 同名，
// 所以这里用「精确名」而非宽泛正则，避免把 IRIS-F2 / LEMUR-2-HUBBLE-4 / ITAMSAT 之类误判成望远镜。
export const TELESCOPE_TABLE = {
  // 光学
  'HST': 'optical', 'HUBBLE SPACE TELESCOPE': 'optical', 'CHEOPS': 'optical', 'CSST': 'optical', 'MOST': 'optical',
  // X 射线
  'CXO': 'xray', 'CHANDRA': 'xray', 'XMM-NEWTON': 'xray', 'XMM': 'xray', 'NUSTAR': 'xray', 'IXPE': 'xray',
  'HXMT (HUIYAN)': 'xray', 'HXMT': 'xray', 'GECAM-A': 'xray', 'GECAM-B': 'xray',
  'EINSTEIN PROBE': 'xray', 'EP': 'xray', 'ASTROSAT': 'xray', 'SRG': 'xray', 'SPEKTR-RG': 'xray', 'SMILE': 'xray',
  // 伽马
  'FGRST (GLAST)': 'gamma', 'FERMI': 'gamma', 'FERMI GAMMA SPACE TELESCOPE': 'gamma',
  'SWIFT': 'gamma', 'AGILE': 'gamma', 'INTEGRAL': 'gamma', 'DAMPE': 'gamma',
  // 红外
  'JWST': 'ir', 'JWST (JAMES WEBB)': 'ir', 'WISE': 'ir', 'SPITZER': 'ir',
  // 太阳
  'SDO': 'solar', 'SOHO': 'solar', 'STEREO-A': 'solar', 'STEREO-B': 'solar', 'IRIS': 'solar',
  'HINODE (SOLAR-B)': 'solar', 'HINODE': 'solar', 'SOLAR ORBITER': 'solar', 'ASO-S': 'solar',
  'HISAKI (SPRINT-A)': 'solar',
  // 粒子 / 宇宙线
  'AMS-02': 'particle', 'CALET': 'particle',
};

/**
 * 判断是否天文/空间科学望远镜。
 * @returns {{ isTelescope: boolean, telescopeType: string|null, confidence: 'high'|'medium'|null, note: string }}
 */
export function detectTelescope(name) {
  const raw = String(name || '').trim();
  const key = raw.toUpperCase();
  const hit = TELESCOPE_TABLE[key];
  if (hit) return { isTelescope: true, telescopeType: hit, confidence: 'high', note: '望远镜白名单：' + key };
  // §20.5 关键字兜底（medium）
  if (/TELESCOPE/i.test(raw)) return { isTelescope: true, telescopeType: 'optical', confidence: 'medium', note: '名称含 TELESCOPE 关键字' };
  if (/\bXMM\b/.test(key)) return { isTelescope: true, telescopeType: 'xray', confidence: 'medium', note: '名称含 XMM 关键字' };
  if (/\bHST\b/.test(key)) return { isTelescope: true, telescopeType: 'optical', confidence: 'medium', note: '名称含 HST 关键字' };
  return { isTelescope: false, telescopeType: null, confidence: null, note: '' };
}

/* ------------------------------------------------------------------ */
/* V7 §28 空间站 / 载人飞船识别                                        */
/* ------------------------------------------------------------------ */
// station = 常驻空间站舱段；crew = 载人飞船；cargo = 货运飞船
// 注意排除 CelesTrak 里 "ISS OBJECT YM/YN/..."（从 ISS 释放/关联的通用命名对象，不是舱段），
// 所以舱段规则只认 "ISS (模块名)" 这种带括号的写法。
export const STATION_RULES = [
  [/^ISS\s*\(/i,                                                     'station', 'ISS 舱段'],
  [/^(POISK|PRICHAL|NAUKA|ZARYA|ZVEZDA|UNITY|DESTINY|HARMONY|TRANQUILITY|COLUMBUS|KIBO|CUPOLA|BISHOP|BEAM)$/i,
                                                                        'station', '空间站舱段'],
  [/^CSS\b|^(TIANHE|WENTIAN|MENGTIAN)$|天宫|天和|问天|梦天/i,             'station', '中国空间站舱段'],
  [/^CREW DRAGON\b/i,                                                  'crew', '载人龙飞船'],
  [/^STARLINER\b/i,                                                    'crew', '波音星际客机'],
  [/^SOYUZ\b|^SOYUZ-|^SOYUZ MS/i,                                       'crew', '联盟号载人飞船'],
  [/^SHENZHOU\b|^SZ-\d{2,}(\s+MODULE)?$/i,                            'crew', '神舟载人飞船'],
  [/^TIANZHOU\b/i,                                                     'cargo', '天舟货运飞船'],
  [/^PROGRESS\b/i,                                                     'cargo', '进步号货运飞船'],
  [/^CYGNUS\b/i,                                                       'cargo', '天鹅座货运飞船'],
  [/^HTV\b|^HTV-\d|^KOUNOTORI/i,                                       'cargo', 'HTV 货运飞船'],
  [/^CARGO DRAGON\b|^DRAGON\b.*\bCRS\b/i,                            'cargo', '货运龙飞船（CRS 任务）'],
  // Space-Track 把载人龙按返回舱命名（如 DRAGON GRACE 2），CelesTrak 叫 CREW DRAGON 13；不含 CRS 的裸 DRAGON 一律按载人处理。
  [/^DRAGON\b/i,                                                       'crew', '载人龙飞船'],
];

/**
 * 判断是否空间站 / 载人飞船 / 货运飞船。
 * @returns {{ isStation: boolean, stationType: 'station'|'crew'|'cargo'|null, note: string }}
 */
export function detectStation(name) {
  const raw = String(name || '').trim();
  // 碎片/残骸（如 "TIANZHOU X DEB"、"SOYUZ DEB"）不是空间站本身，先排除
  if (/\b(DEB|R\/B)\s*$/i.test(raw)) return { isStation: false, stationType: null, note: '' };
  for (const [re, type, note] of STATION_RULES) {
    if (re.test(raw)) return { isStation: true, stationType: type, note };
  }
  return { isStation: false, stationType: null, note: '' };
}

/* ------------------------------------------------------------------ */
/* owner 兜底（无名称命中时）：code + 中文名 + kind=unknown              */
/* ------------------------------------------------------------------ */
const OWNER_LABEL = {
  US: '美国', PRC: '中国', CIS: '俄罗斯/独联体', UK: '英国', JPN: '日本', IT: '意大利',
  SKOR: '韩国', FR: '法国', IND: '印度', GER: '德国', ESA: '欧洲空间局', SPN: '西班牙',
  CA: '加拿大', TURK: '土耳其', AUS: '澳大利亚', FIN: '芬兰', ROC: '中国台湾',
  ARGN: '阿根廷', UAE: '阿联酋', NOR: '挪威', GREC: '希腊', ISRA: '以色列', SING: '新加坡',
  POL: '波兰', SAUD: '沙特', BRAZ: '巴西', IRAN: '伊朗', POR: '葡萄牙', BEL: '比利时',
  INDO: '印度尼西亚', EGYP: '埃及', SWTZ: '瑞士', MALA: '马来西亚', THAI: '泰国',
  NETH: '荷兰', PAK1: '巴基斯坦', PAKI: '巴基斯坦', BUL: '保加利亚', ALG: '阿尔及利亚',
  DEN: '丹麦', KAZ: '哈萨克斯坦', MEX: '墨西哥', BELA: '白俄罗斯', AZER: '阿塞拜疆',
  MA: '摩洛哥', HUN: '匈牙利', VTNM: '越南', NIG: '尼日利亚', CZCH: '捷克', SWED: '瑞典',
  SVN: '斯洛文尼亚', SVK: '斯洛伐克', KWT: '科威特', RP: '菲律宾', LTU: '立陶宛',
  UKR: '乌克兰', CHLE: '智利', VENZ: '委内瑞拉', SAFR: '南非', ECU: '厄瓜多尔',
  ROM: '罗马尼亚', DJI: '吉布提', SLB: '所罗门群岛', BHR: '巴林', BWA: '博茨瓦纳',
  MNE: '黑山', HRV: '克罗地亚', NZ: '新西兰', JOR: '约旦', PERU: '秘鲁', LAOS: '老挝',
  ETH: '埃塞俄比亚', BGD: '孟加拉国', NKOR: '朝鲜', BOL: '玻利维亚', IRAQ: '伊拉克',
  ANG: '安哥拉', ISS: '国际空间站', TBD: '待确认', LUXE: '卢森堡', RWA: '卢旺达',
  SES: '卢森堡', O3B: '卢森堡', EUTE: '欧洲通信卫星组织', ITSO: '国际通信卫星组织',
  IM: '国际海事卫星组织', GLOB: '加拿大', ORB: '美国', AB: '亚洲广播卫星',
  ABS: '亚洲广播卫星', AC: '亚洲', ASRA: '亚洲卫星', EUME: '欧洲', FRIT: '法国',
  CHBZ: '中国', GRSA: '沙特', TMMC: '中国', NICO: '荷兰', RASC: '俄罗斯', STCT: '中国香港',
};
// 这些 owner 本身是机构，兜底时用 agency/intergov 更准确
const OWNER_KIND = { ESA: K.intergov, ISS: K.intergov, EUME: K.intergov, ITSO: K.company, IM: K.company, SES: K.company, O3B: K.company, EUTE: K.company };


/* ================================================================== */
/* V20 §41 二级分类（专业细分，48 个二级键，覆盖 10 个一级类目）          */
/* ================================================================== */
export const SUBCATEGORY_DEFS = {
  // ── comms 通信（7）────────────────────────────────────────────────
  'broadband':        { label: '宽带互联网',   labelEn: 'Broadband',      cat: 'comms' },
  'geo-comms':        { label: '静止轨道通信', labelEn: 'GEO Comms',      cat: 'comms' },
  'mobile':           { label: '移动通信',     labelEn: 'Mobile Comms',   cat: 'comms' },
  'relay':            { label: '数据中继',     labelEn: 'Data Relay',     cat: 'comms' },
  'amateur':          { label: '业余无线电',   labelEn: 'Amateur Radio',  cat: 'comms' },
  'broadcast':        { label: '广播/直播电视', labelEn: 'Broadcast',     cat: 'comms' },
  'other-comms':      { label: '其它通信',     labelEn: 'Other Comms',    cat: 'comms' },
  // ── nav 导航（3）──────────────────────────────────────────────────
  'gnss-core':        { label: 'GNSS 核心星座', labelEn: 'GNSS Core',     cat: 'nav' },
  'sbas':             { label: '星基增强',     labelEn: 'SBAS',           cat: 'nav' },
  'other-nav':        { label: '其它导航/授时', labelEn: 'Other Navigation', cat: 'nav' },
  // ── eo 对地观测（5）───────────────────────────────────────────────
  'optical':          { label: '光学成像',     labelEn: 'Optical Imaging', cat: 'eo' },
  'sar':              { label: '合成孔径雷达', labelEn: 'SAR Imaging',    cat: 'eo' },
  'hyperspectral':    { label: '高光谱/多光谱', labelEn: 'Hyperspectral',  cat: 'eo' },
  'video':            { label: '视频遥感',     labelEn: 'Video Imaging',  cat: 'eo' },
  'other-eo':         { label: '其它遥感',     labelEn: 'Other EO',       cat: 'eo' },
  // ── mil 军事（7）──────────────────────────────────────────────────
  'optical-recon':    { label: '光学侦察',     labelEn: 'Optical Recon',  cat: 'mil' },
  'radar-recon':      { label: '雷达成像侦察', labelEn: 'Radar Recon',    cat: 'mil' },
  'sigint':           { label: '电子侦察/频谱监测', labelEn: 'SIGINT',    cat: 'mil' },
  'early-warning':    { label: '导弹预警',     labelEn: 'Early Warning',  cat: 'mil' },
  'military-comms':   { label: '军用通信',     labelEn: 'Military Comms', cat: 'mil' },
  'unknown-military': { label: '军用但用途不明', labelEn: 'Unknown Military', cat: 'mil' },
  'other-mil':        { label: '其它军事',     labelEn: 'Other Military', cat: 'mil' },
  // ── weather 气象/海洋/环境（4）────────────────────────────────────
  'meteorology':      { label: '气象',         labelEn: 'Meteorology',    cat: 'weather' },
  'ocean':            { label: '海洋',         labelEn: 'Oceanography',   cat: 'weather' },
  'environment':      { label: '环境/温室气体', labelEn: 'Environment',    cat: 'weather' },
  'other-weather':    { label: '其它气象环境', labelEn: 'Other Weather',  cat: 'weather' },
  // ── science 科学（7）──────────────────────────────────────────────
  'telescope':        { label: '天文望远镜',   labelEn: 'Telescope',      cat: 'science' },
  'solar':            { label: '太阳观测',     labelEn: 'Solar Physics',  cat: 'science' },
  'earth-science':    { label: '地球科学',     labelEn: 'Earth Science',  cat: 'science' },
  'space-physics':    { label: '空间物理/粒子', labelEn: 'Space Physics',  cat: 'science' },
  'life-science':     { label: '生命科学',     labelEn: 'Life Science',   cat: 'science' },
  'geodesy':          { label: '大地测量',     labelEn: 'Geodesy',        cat: 'science' },
  'other-science':    { label: '其它科学',     labelEn: 'Other Science',  cat: 'science' },
  // ── tech 技术试验（4）─────────────────────────────────────────────
  'tech-demo':        { label: '技术验证',     labelEn: 'Tech Demo',      cat: 'tech' },
  'education':        { label: '教育/大学立方星', labelEn: 'Education',    cat: 'tech' },
  'servicing':        { label: '在轨服务/离轨', labelEn: 'Servicing',     cat: 'tech' },
  'other-tech':       { label: '其它技术试验', labelEn: 'Other Tech',     cat: 'tech' },
  // ── station 空间站/载人（3）───────────────────────────────────────
  'station-module':   { label: '空间站舱段',   labelEn: 'Station Module', cat: 'station' },
  'crew':             { label: '载人飞船',     labelEn: 'Crew Vehicle',   cat: 'station' },
  'cargo':            { label: '货运飞船',     labelEn: 'Cargo Vehicle',  cat: 'station' },
  // ── debris 碎片/残骸（3）──────────────────────────────────────────
  'fragmentation':    { label: '解体/碰撞碎片', labelEn: 'Fragmentation Debris', cat: 'debris' },
  'rocket-body':      { label: '火箭残骸/上面级', labelEn: 'Rocket Body',  cat: 'debris' },
  'inactive':         { label: '失效载荷',     labelEn: 'Inactive Payload', cat: 'debris' },
  // ── other 其他（5）────────────────────────────────────────────────
  'unclassified-military': { label: '疑似军用/用途不明', labelEn: 'Unclassified Military', cat: 'other' },
  'unnamed-object':   { label: '官方未命名对象', labelEn: 'Unnamed Object', cat: 'other' },
  'historical':       { label: '早期历史卫星', labelEn: 'Historical',     cat: 'other' },
  'interplanetary':   { label: '行星际/深空探测', labelEn: 'Interplanetary', cat: 'other' },
  'unknown':          { label: '信息缺失',     labelEn: 'Unknown',        cat: 'other' },
};

/** category → 允许的二级键（用于自洽校验） */
export const CATEGORY_SUBCATS = (() => {
  const m = {};
  for (const [k, v] of Object.entries(SUBCATEGORY_DEFS)) {
    (m[v.cat] = m[v.cat] || []).push(k);
  }
  return m;
})();

// 规则：[正则, 二级键, 可选的一级类目覆盖]
const SUB_RULES = [
  // ── 通信 ──
  [/^STARLINK|^ONEWEB|^KUIPER|^QIANFAN|^HULIANWANG|^GUOWANG|^GW-/i, 'broadband', 'comms'],
  [/^TDRS|^EDRS|^TIANLIAN|^LUCH|^SDRN/i, 'relay', 'comms'],
  [/AMSAT|OSCAR|^AO-\d|^SO-\d|^CO-\d|^FO-\d|^IO-\d|^NO-\d|^RS\d|ITAMSAT|SAMSAT|^RADIO ROSTO|^HAMSAT|^FOX-1|^LUSAT/i, 'amateur', 'comms'],
  [/^IRIDIUM|^GLOBALSTAR|^ORBCOMM|^INMARSAT|^THURAYA|^GONETS|^KINEIS|^ASTROCAST|^CENTAURI|^SPACEMOBILE|^LYNK|^SITRO|^TIANQI|^GEESAT|^AISSAT|^NADEZHDA|^MARISAT|^MARECS|^MUOS|^ACES/i, 'mobile', 'comms'],
  [/^DIRECTV|^SIRIUS|^SXM-|^ECHOSTAR|^TVSAT|^TDF-|^TELE-X|^BS-3|^BSS|^SAKURA|^YURI|^JCSAT|^BSAT|^SUPERBIRD|^N-STAR|^SOLIDARIDAD/i, 'broadcast', 'comms'],
  [/EUTELSAT|^INTELSAT|^IS-\d|^SES[ -]|^O3B|^ASTRA|^NSS-|^AMC-|CHINASAT|ZHONGXING|^APSTAR|^ASIASAT|^RADUGA|^GORIZONT|^EKRAN|^STTW|^TELECOM|^DFH|^EXPRESS|^YAMAL|^ABS-|^ARABSAT|^TURKSAT|^KOREASAT|^OPTUS|^ANIK|^NIMIQ|^TELSTAR|^AMAZONAS|^GALAXY|^SATCOM|^TELKOM|^PALAPA|^SBS-|^BRAZILSAT|^THOR\b|^AMOS-|^WESTAR|^MEASAT|^NILESAT|^GSTAR|^STAR ONE|^HISPASAT|^SPACENET|^MORELOS|^PAKSAT|^KAZSAT|^EGYPTSAT|^NIGERIASAT|^SPAINSAT|^HORIZONS|^BADR|^HYLAS|^VIASAT|^ITALSAT|^SYMPHONIE|^COMSTAR|^SYNCOM|^RELAY\b|^ACTS\b|^OLYMPUS|^SINOSAT|^TELSTAR|^ASIASAT|^ARABSAT|^CENTAURI|^EUTELSAT/i, 'geo-comms', 'comms'],
  // ── 导航 ──
  [/^NAVSTAR|^GPS[ -]?\d|^GPS [A-Z]|GLONASS|URAGAN|GALILEO|^GSAT0\d|^BEIDOU|^BD-|北斗|^QZS|QZSS|MICHIBIKI|^IRNSS|NAVIC/i, 'gnss-core', 'nav'],
  [/WAAS|EGNOS|GAGAN|SDCM|SBAS|^OMNI-[ML]\d/i, 'sbas', 'nav'],
  [/^TRANSIT|^TIMATION|^NOVA\b|^NAVSPASUR|^PARUS|^TSIKADA|^TSIKLON|^CENTISPACE|^GEESAT/i, 'other-nav', 'nav'],
  // ── 对地观测 ──
  [/SENTINEL-1|TERRASAR|SKYMED|^COSMO|RADARSAT|^ICEYE|^CAPELLA|^UMBRA|QPS-SAR|^STRIX|^PIESAT|^SAR-|^RISAT|^SAOCOM|^PAZ\b|^ALOS-2|^HJ-1C|^KOMPSAT-5|^KOMPSAT-3A/i, 'sar', 'eo'],
  [/ENMAP|^PRISMA\b|ZHUHAI|^GF-5|HISUI|HYPERS?PECTRAL|^ZY-1 02D/i, 'hyperspectral', 'eo'],
  [/^SKYSAT|BLACKSKY|^PELICAN|VIDEO/i, 'video', 'eo'],
  [/^SENTINEL-2|^LANDSAT|WORLDVIEW|GEOEYE|QUICKBIRD|^GAOFEN|^GF-\d|^JILIN|^FLOCK|^PLANET\b|^DOVE|^SPOT|^ERS-|^CBERS|^RESURS|^IRS\b|ARIRANG|^KOMPSAT|^DMC|RAPIDEYE|^FORMOSAT|^THEOS|^DEIMOS|^NUSAT|^GRUS|^GHGSAT|^AAC|^ASNARO|^VNREDSAT|^UK-DMC|^TOPSAT|^PERUSAT|^KAZEOSAT|^DUBAISAT|^ALOS|^SUPERVIEW|^NINGXIA|^HEAD-|^TIANHUI|^ZHUHAI|^HJ-|^ZY-|^ZIYUAN/i, 'optical', 'eo'],
  // ── 军事 ──
  [/DSP\b|^SBIRS|^MIDAS|^VELA\b|^IMEWS|^NTS\b|预警/i, 'early-warning', 'mil'],
  [/^HAWK|^BRO-|^NORSAT|ELISA|ESSAIM|VIGORIDE|^MENTOR|^ORION\b|^MAGNUM|^TRUMPET|^SSU\b/i, 'sigint', 'mil'],
  [/LACROSSE|ONYX|^TOPAZ|SAR-LUPE|^HELIOS[ -]?2|^USA .*RADAR/i, 'radar-recon', 'mil'],
  [/^YAOGAN|^YG-|^KH-|^HELIOS\b/i, 'optical-recon', 'mil'],
  [/^AEHF|^MILSTAR|^WGS|^SKYNET|^UFO |^FLTSATCOM|^LEASAT|^DSCS|^NATO|^SYRACUSE|^SICRAL/i, 'military-comms', 'mil'],
  [/^COSMOS|^USA[ -]?\d|^OBJECT [A-Z]{1,3}$/i, 'unknown-military', 'mil'],
  [/^PRAETORIAN|^CHECKMATE|^SDA|^LEGION|^BLACKJACK|^GSSAP|^SDS-|^X-37B|^OTV\b/i, 'other-mil', 'mil'],
  [/^LEMUR/i, 'other-eo', 'eo'],
  [/^CHUANG/i, 'other-comms', 'comms'],
  [/^GJZ|^SKYCRAFT|^VSP\b|^PAYLOAD/i, 'tech-demo', 'tech'],
  // ── 气象 / 海洋 / 环境 ──
  [/^NOAA|^GOES|^EWS-G|^FENGYUN|^FY-|风云|^HIMAWARI|^METOP|^METEOSAT|^METEOR|^TIROS|^ESSA|^NIMBUS|^DMSP|^ELEKTRO|^INSAT|^SMOS|^ITOS|^SMS\b|^GOMS/i, 'meteorology', 'weather'],
  [/^JASON|SENTINEL-6|^HY-|^HAIYANG|^SARAL|^OCEANSAT|^SCATSAT|^SENTINEL-3|^SWOT|^TOPEX|^SEASAT|^GCOM/i, 'ocean', 'weather'],
  [/^OCO|^GHGSAT|SENTINEL-5P|^AURA\b|^ENVISAT/i, 'environment', 'weather'],
  // ── 科学 ──
  [/^SDO$|^SOHO|^STEREO|^ASO-S|^HINODE|^IRIS$|^HISAKI|SOLAR ORBITER|^YOHKOH|^HINOTORI|^KYOKKO/i, 'solar', 'science'],
  [/^GRACE|^SWARM|^CHAMP|^ICESAT|^AQUA$|^TERRA$|^AURA$|^SMAP|^CLOUDSAT|^CALIPSO|^AEOLUS/i, 'earth-science', 'science'],
  [/^MMS|^THEMIS|^ARTEMIS|^CLUSTER|^PUNCH|^EXPLORER|^SOLRAD|^OGO|^OAO|^IUE|^HEAO|^EUVE|^COMPTON|^ISEE|^IMP-|^INTERBALL|^MAGION|^AUREOLE|^INTERCOSMOS|^WIND$|^GEOTAIL|^POLAR$|^FAST$|^IMAGE$|^IBEX|^RBSP|^VAN ALLEN|^GRANAT|^AKARI|^HAKUCHO|^ASTRO-|^TENMA|^GINGA|^SIRIO/i, 'space-physics', 'science'],
  [/^SECOR|LAGEOS|^ETALON|^STARLETTE|^STELLA|^AJISAI|^GEOS-\d|^GEOSAT|^CALSPHERE|^PAGEOS|^DIADEME|^ANNA|^SURCAL|^TEMPSAT|^PORCUPINE|^DAG\b|^GGSE|^BC-?4|^TOPO\b/i, 'geodesy', 'science'],
  [/^BION|^FOTON|^BIOSAT|^PHOTON/i, 'life-science', 'science'],
  // ── 行星际（归 other/interplanetary）──
  [/^PIONEER|^MARINER|^VENERA|^VIKING|^VOYAGER|^GIOTTO|^CLEMENTINE|^NOZOMI|^MARS\b|^JUNO|^DAWN|^CONTOUR|^SAKIGAKE|^SUISEI|^LUNAR|^CHANDRAYAAN|^CHANG|^APOLLO|^LADEE|^GRAIL|^KAGUYA|^MUSES|^HAYABUSA|^NEW HORIZONS|^ROSETTA|^MESSENGER|^CASSINI|^ULYSSES|^VEGA\b|^PHOBOS|^FOBOS|^LUNOKHOD|^ZOND/i, 'interplanetary', 'other'],
  // ── 技术试验 / 教育 ──
  [/^MEV-|REMOVEDEBRIS|DEORBITSAIL|^ELSA|^ION SCV|^MISSION EXTENSION|^ELSA-D/i, 'servicing', 'tech'],
  [/^CUBESAT|^NANOSAT|^PICOSAT|^UNISAT|^TUBSAT|^AAUSAT|^BEESAT|^UWE-|^DTUSAT|^CUTE|^CANX|^QB50|^BRITE|^HORYU|^FITSAT|^ITUPSAT|^ZACUBE|^SWISSCUBE|^TRITON|^ESTCUBE|^PCSAT|^DELFI|^VELOX|^GOMX|^WREN|^TECH|^CUBIC|^KITSAT|^POSAT|^FAISAT|^TMSAT|^TZINGHUA|^SSETI|^CINEMA|^RAX|^O\/OREOS|^FUNSAT|^APRIZESAT|^TEVEL|^AEROCUBE|^FOSSASAT|^CUBY|^NETSAT|^GEOSCAN|^FOREST|^S-NET|^KL-|^SDS-\d|^KOYOH|^XCUBE|^VINDLER|^MENUT|^TANSUO/i, 'education', 'tech'],
  [/^SHIYAN|^SY-|^SHIJIAN|^SJ-|^TJS|^STARLING|^AETHER|^DISKSAT|^YAM\b|^XSS|^STEX|^MIGHTYSAT|^ANGELS|^KIKU|^ETS-|^DUMMY|^RUBIN|^PROITERES|^STARS\b|^KKS|^SPRITE|^SOHLA|^KAGAYAKI|^HAYATO|^EQUULEUS|^TRICOM|^ELISA\b|^STRV|^NANORACKS|^POPSAT|^OPTOS|^PRISM\b/i, 'tech-demo', 'tech'],
  // ── V20 第二轮：长尾补齐（GEO 通信品牌 / 遥感计划 / 科学任务 / 技术试验 / 军用计划）──
  [/^EUTE\b|^XM-\d|^SBS\b|^AMOS\b|^ABS\b|^STARONE|^SPACEWAY|^NSTAR|^PAS-|^AGILA|^CS-?\d|^TDF-|^DFS-|^HGS-|^GALS|^NIGCOMSAT|^RASCOM|^VINASAT|^YAHSAT|^AZERSPACE|^ARSAT|^ANGOSAT|^MEXSAT|^TKSAT|^SGDC|^BULGARIASAT|^ALCOMSAT|^BELINTERSAT|^KAZSTSAT|^TURKMENALEM|^BRISAT|^IPSTAR|^WILDBLUE|^ALPHASAT|^COMSATBW|^ASIASTAR|^AFRISTAR|^AMSC|^MSAT-|^SESAT|^ESTRELA|^SINAH|^VENESAT|^CIEL-|^XTAR|^ICO\b|^TERRESTAR|^SKYTERRA|^KALPANA|^GARUDA|^OTS-|^S80\/T|^INDOSTAR|^SUOMI100|^H2SAT|^KOREASAT|^JCSAT|^BSAT|^SUPERBIRD|^OPTUS|^OPTUS/i, 'geo-comms', 'comms'],
  [/^SATELIOT|^HORUS|^CONNECTA|^AISSAT|^VESSELSAT|^M2M/i, 'mobile', 'comms'],
  [/^RADIO[- ]|^RADIO$|^XW-|^CAS-|^HO-|^BEESAT|^LILACSAT|^JY1SAT/i, 'amateur', 'comms'],
  // 遥感
  [/^OKEAN|^RESOURCESAT|^ADEOS|^ALOS|^RCM\b|^CSG-|^EOS-[468]|^TELEOS|^DS-EO|^MISRSAT|^KHALIFASAT|^PRSS|^NOVASAR|^CFOSAT|^HYPSO|^EARTHCARE|^METHANESAT|^ORBVIEW|^IKONOS|^SDGSAT|^EROS-|^KOMPSAT|^HJ-2|^ZY-3|^ZY-2|^GAOFEN|^TH-|^PNEO|^AMAZONIA|^CBERS|^MISR|^SEAHAWK/i, 'optical', 'eo'],
  // 科学
  [/^SWAS|^IRAS|^COBE|^WMAP|^GALEX|^SORCE|^CORIOLIS|^TIMED|^MSX\b|^FUSE|^HETE|^ICON\b|^TESS|^XRISM|^XPOSAT|^EUCLID|^KPLO|^CAPSTONE|^QUEQIAO|^ADITYA|^PSYCHE|^LUCY|^ISO\b|^HIPPARCOS|^HALCA|^ALEXIS|^HILAT|^CRRES|^SCATHA|^CCE\b|^ASTRON|^IUE|^SIRTF|^ARASE|^DEMETER|^DOUBLESTAR|^CASSIOPE|^ZHANGHENG|^MKA-FKI|^KORONAS|^SPEKTR|^QUAKESAT|^SCISAT|^HETE|^SORCE|^IBEX|^SWIFT/i, 'other-science', 'science'],
  [/^QUIKSCAT|^SEASAT|^TOPEX|^JASON|^SMOS|^SEAHAWK/i, 'ocean', 'weather'],
  // 技术试验 / 教育 / 立方星
  [/^FALCONSAT|^JAWSAT|^OPAL\b|^ASUSAT|^SEDSAT|^MUBLCOM|^MEGSAT|^TIUNGSAT|^NSAT|^ROCSAT|^KAISTSAT|^BILSAT|^ST5-|^STRAND|^CINEMA|^BPA\b|^ALICE|^MCUBED|^IPEX|^FUNCUBE|^HINCUBE|^PUCP|^UKUBE|^DX\b|^TDS-|^BUGSAT|^TABLETSAT|^ANTELSAT|^POLYITAN|^TIGRISAT|^AISAT|^PRATHAM|^PISAT|^RAVAN|^OPTICUBE|^CELTEE|^PATHFINDER|^SMDC|^CSSWE|^CXBN|^CP3|^CP4|^CP5|^RAX|^O\/OREOS|^DUMSAT|^FEDSAT|^WEOS|^MICRO\b|^TRAILBLAZER|^CHIPSAT|^LARETS|^SLOSHSAT|^OICETS|^INDEX\b|^STUDSAT|^TISAT|^SEEDS|^BLITS|^XIWANG|^YOUTHSAT|^TACSAT|^JUGNU|^SRMSAT|^STSAT|^ICUBE|^NEE\b|^POPACS|^WNISAT|^PROPCUBE|^CHUBUSAT|^SPARK\b|^TEN-KOH|^MANDRAKE|^POEM|^KONDOR|^NANOFF|^PE2\b|^POLYTECH|^NUVIEW|^FLYLAB|^NANOACE|^MAKERSAT|^DSAT\b|^NEXSAT|^T2V|^PRETTY|^ORBASTRO|^PLATERO|^GENMAT|^SPACEVAN|^SPIP|^IMPULSE|^PROTOMETHEE|^OBSERVER-1A|^MALLIGYONG|^DOORY|^ALISIO|^TAIJING|^ZHIXING|^TIRSAT|^MUSAT|^SONATE|^CONTECSAT|^TIGER-|^JACKAL|^MESON|^LIZZIESAT|^HAMMER|^EXO-0|^MOLA\b|^TSAT|^NEONSAT|^ACS\b|^ICECUBE|^PREFIRE|^DRO-A|^DRO-B|^R5-S|^3CAT-|^ISTSAT|^OOV-CUBE|^ROBUSTA|^CATSAT|^WARATAH|^PHISAT|^LOPEN|^ROCK\b|^QUBE|^TOMORROW|^TYCHE|^LUR-1|^TANAGER|^IPERDRONE|^ORESAT|^CUAVA|^ERNST|^LEMU-NGE|^NIGHTJAR|^ARCTIC|^UM5-|^KANYINI|^HYPERFIELD|^PTD-4|^SEDNA|^COLIBRI|^VIZARD|^SIT-|^MSU\b|^RTU\b|^ADS-01|^HAISHAO|^TANSTAAFL|^GITAI|^LASARSAT|^CROCUBE|^CTC-0|^DJIBOUTI|^BUZZZER|^EDISON|^BALKAN|^GESAT|^INNOCUBE|^SCOT-1|^IRIS-F|^MBZ|^BNU-1|^KX-09|^TAURUS-1|^TIBA-1|^IHOPSAT|^ANDESITE|^AL-AMAL|^ZINYUAN|^ATHENA|^NEMO-HD|^DEKART|^NORBI|^SALSAT|^DRAGRACER|^LUCAS|^CUBEL|^AII-BRAVO|^TYVAK|^DEMO8|^SHERPA|^MONOLITH|^RSW-0|^CUPID|^TEIKYOSAT|^Z-SAT|^HIBARI|^DRUMS|^KOSEN|^LDPE-|^XW-3|^ETV-A1|^ASCENT|^TK-2|^PUJIANG|^ARCSAT|^DAQI|^PVSAT|^KSLV|^RANDEV|^SNUGLITE|^MIMAN|^WFOV|^MT-CUBE|^TRISAT|^CELESTA|^SHERPA|^BLUEWALKER|^OTB|^MATS|^JIAOTONG|^BIRKELAND|^CONTINUUM|^EOSSAT|^HUYGENS|^KUWAITSAT|^SHARJAHSAT|^LINUSS|^IMECE|^LUMELITE|^ARCTURUS|^GS-1|^NVS-0|^GEISAT|^GREGOIRE|^RUNNER-1|^HOTSAT|^GHOST-|^ORBITER|^AFR-1|^A-SEANSAT|^QIANKUN|^JUPITER|^DS-SAR|^ORB-12|^SCOOBII|^ARCADE|^GALASSIA|^NULION|^LUDI|^BB3|^BB4|^CH\b|^ANSER|^NESS\b|^CSC-[12]|^PVCC|^SPIP/i, 'education', 'tech'],

  // ── V20 第三轮：1970-2020 年代长尾（逐族登记，均按公开任务性质归类）──
  // 通信
  [/^LES \d|^ATS \d|^CTS\b|^OTS \d|^AYAME|^ESIAFI|^NAHUEL I|^BS-2B|^YURI|^PAS \d|^CS 3|^TDF \d|^DFS \d|^AFRICASAT|^MSAT |^W75|^HGS \d|^BONUM|^NEWSAT|^HOT BIRD|^ES'HAIL|^LAOSAT|^TIANTONG|^AT&T T-|^SAUDIGEOSAT|^XINGYUN|^HONGYUN|^QUETZSAT|^NUSANTARA|^GLOBAL-\d|^EXACTVIEW|^LING QIAO|^DRTS|^MOZHAYETS|^ASTRO\b|^ICO\b/i, 'geo-comms', 'comms'],
  [/^LING QIAO|^DRTS/i, 'relay', 'comms'],
  // 导航
  [/^BD 1|^COMPASS [GCI]|^BEIDOU|^STERKH/i, 'gnss-core', 'nav'],
  [/^NNSS \d|^TRANSIT \d/i, 'other-nav', 'nav'],
  // 遥感
  [/^ERS [12]\b|^ZY \d|^ZY-\d|^HODOYOSHI|^LAPAN|^MOS 1|^SICH|^WEINA|^LONGJIANG|^HONGYAN|^YINHE|^LUOJIA|^DIWATA|^SSOT|^PAKTES|^MOHAMMED|^VRSS|^GOKTURK|^KENT RIDGE|^CARBONITE|^EO 1\b|^HYSIS|^BANGABANDHU|^SKY MUSTER|^PACE\b|^ZHEDA PIXING|^BEIJING 1|^JB-3|^NAXING|^SJ 16|^XINGCHI|^ZHIHUI|^GUANGCHUAN|^SSTL S1|^M2 PATHFINDER|^AL YAH|^S5\b|^M1\b|^R2\b|^LEO 1|^YIJIAN|^VENUS\b|^SAC C|^SAC-D/i, 'optical', 'eo'],
  [/^ASTRO H|^MINXSS|^TOMS|^PARASOL|^PICARD/i, 'other-science', 'science'],
  // 科学
  [/^GP-B|^LISA PATHFINDER|^KEPLER|^GLAST|^COROT|^CRYOSAT|^GPM|^DSX|^FREJA|^MUNIN|^CYGFM|^SAC-D|^TOMS EP|^ASTEX|^TRIAD|^EOLE|^SHINSEI|^TANSEI|^UME \d|^ASTRID|^SCD \d|^VEP\b|^REX|^CERISE|^AURORA 2|^INFORMATOR|^SARA\b|^OXP 1|^STEP 2|^PROSPERO|^MIRANDA|^INTASAT|^ISIS \d|^ALOUETTE|^AZUR|^SERT 2|^DODGE|^SOICAL|^RIGIDSPHERE|^DODECAPOLE|^TRAAC|^COURIER|^GREB|^RADIATION SAT|^FTV|^DASH|^A-1 |^FR 1|^DIAPASON|^LCS 1|^OV[1-5]/i, 'other-science', 'science'],
  [/^GEOS \d|^GEO IK|^EGS\b|^LARES|^RADCAL|^CALSPHERE|^ETALON|^STARLETTE|^AJISAI/i, 'geodesy', 'science'],
  // 技术试验 / 教育
  [/^MAQSAT|^SIMSAT|^DEMOSAT|^MAST\b|^CAPE 1|^CSTB|^LIBERTAD|^ETS \d|^LRE\b|^SERVIS|^RITE TARGET|^TATIANA|^MONITOR-E|^KUPON|^EQUATOR|^ST \d|^ARGOS\b|^ORSTED|^SACI|^TSX-5|^SNAP \d|^KOMPASS|^REFLECTOR|^MDS \d|^IDEFIX|^LATINSAT|^PERSEUS|^AIST|^SPRINT|^SOCRATES|^RISING|^UNIFORM|^PROX-1|^NPSAT|^MOMENTUS|^DANDE|^THEA|^EXCITE|^EAGLET|^ESEO|^EUCROPIS|^NEXTSAT|^SNUSAT|^MARCO|^PALISADE|^FLYING LAPTOP|^CORVUS|^TESLA|^UPPER FREE FLYER|^SPAWAR|^RANGE A|^FLYLAB|^NUVIEW|^GITAI|^SEA LAUNCH DEMO|^NNSS/i, 'tech-demo', 'tech'],

  // ── V20 第四轮：个别型号（长尾里能确证的）──
  [/^ESA\/GOES|^NPP$|^COMS 1|^ARKTIKA-M|^MTG-[SI]|^S6 MICHAEL FREILICH|^GOES/i, 'meteorology', 'weather'],
  [/^GIOVE-[AB]|^GALILEO IOV/i, 'gnss-core', 'nav'],
  [/^LT-1 \d|^NISAR|^BIOMASS|^CO3D\d|^SAR LUPE/i, 'sar', 'eo'],
  [/^KHAYYAM|^EROS C3|^FALCON EYE|^IMS-1|^CE-SAT|^HODOYOSHI|^PACE\b|^CMS-0/i, 'optical', 'eo'],
  [/^SPHEREX|^COSMIC\b|^TRACERS|^EZIE-|^ESCAPADE|^PANDORA|^ARCSTONE|^AEPEX|^UVSQ-SAT|^DYNAMICS EXPLORER|^NGRST|^EUCLID/i, 'space-physics', 'science'],
  [/^WINDS|^KIZUNA/i, 'relay', 'comms'],
  [/^JAS [12]|^YUBELEINY|^EYESAT|^HEALTHSAT|^AMSAT/i, 'amateur', 'comms'],
  [/^MACSAT|^WESTPAC|^COMETS|^STRELA|^CMS-?0|^SKY MEXICO|^PSN N5|^HJS-|^OVZON|^HONGHU|^LEO 3|^APSTAR/i, 'geo-comms', 'comms'],
  [/^FASTSAT|^FAST [12]|^SAR LUPE|^MKA PN2|^PRC TEST SPACECRAFT|^TIANYAN/i, 'other-mil', 'mil'],
  [/^ION-SCV|^ADRAS-J/i, 'servicing', 'tech'],
  [/^EUROPA CLIPPER|^ESCAPADE/i, 'interplanetary', 'other'],
  // 军事（计划级）
  [/^LKW-|^HBTSS|^SPIRALE|^SBSS|^EMISAT|^SAPPHIRE|^LDPE-|^ASBM-|^WSF-M|^ORS\b|^STPSAT|^ANGELS|^MYSTIQUE|^LACROSSE/i, 'other-mil', 'mil'],
];

/** 一级类目的默认二级（兜底） */
const DEFAULT_SUB = {
  comms: 'other-comms', nav: 'other-nav', eo: 'other-eo', mil: 'other-mil',
  weather: 'other-weather', science: 'other-science', tech: 'other-tech',
  station: 'station-module', debris: 'fragmentation', other: 'unnamed-object',
};

/**
 * V20：二级分类。可在特定型号上覆盖一级类目（如 COSMOS → mil/unknown-military）。
 * @returns {{ key: string, category: string }}
 */
export function detectSubcategory(ctx) {
  const name = String((ctx && ctx.name) || '').trim();
  const baseCat = String((ctx && ctx.category) || 'other');
  const kind = String((ctx && ctx.objectKind) || '');

  // 1) 碎片/残骸（按对象类型，最先判定）
  if (kind === 'R-B') return { key: 'rocket-body', category: 'debris' };
  if (kind === 'DEB') return { key: 'fragmentation', category: 'debris' };
  // 2) 空间站/载人（按 stationType）
  if (ctx && ctx.stationType === 'station') return { key: 'station-module', category: 'station' };
  if (ctx && ctx.stationType === 'crew') return { key: 'crew', category: 'station' };
  if (ctx && ctx.stationType === 'cargo') return { key: 'cargo', category: 'station' };
  // 3) 望远镜
  if (ctx && ctx.isTelescope) return { key: 'telescope', category: 'science' };

  // 4) 具体型号/星座规则（可覆盖一级类目）
  for (let i = 0; i < SUB_RULES.length; i++) {
    const r = SUB_RULES[i];
    if (r[0].test(name)) {
      const cat = r[2] || SUBCATEGORY_DEFS[r[1]].cat;
      return { key: r[1], category: cat };
    }
  }

  // 5) 兜底：按一级类目 + 少量上下文细化
  if (baseCat === 'other') {
    if (/^TBA|TO BE ASSIGNED/i.test(name)) return { key: 'unknown', category: 'other' };
    const year = Number(String((ctx && ctx.launchDate) || '').slice(0, 4));
    if (Number.isFinite(year) && year > 1957 && year <= 1975) return { key: 'historical', category: 'other' };
    // 名称形如 XXSAT / CUBE / NANO / PICO 的小卫星：归入技术试验-教育（命名惯例，非军用/商用判定）
    if (/SAT$|CUBE|NANO|PICO|^MICRO/i.test(name)) return { key: 'education', category: 'tech' };
    // 近两年新发射、尚无任何公开用途信息的载荷：按「待定级技术试验」处理（非军用/商用判定）
    if (Number.isFinite(year) && year >= 2024) return { key: 'other-tech', category: 'tech' };
    if (/^OBJECT [A-Z]{1,3}$/i.test(name)) return { key: 'unnamed-object', category: 'other' };
    return { key: 'unnamed-object', category: 'other' };
  }
  if (baseCat === 'comms') {
    if (ctx && ctx.orbitClass === 'GEO') return { key: 'geo-comms', category: 'comms' };
    return { key: 'other-comms', category: 'comms' };
  }
  if (baseCat === 'eo') {
    return { key: 'other-eo', category: 'eo' };
  }
  return { key: DEFAULT_SUB[baseCat] || 'other-science', category: baseCat };
}

/* ------------------------------------------------------------------ */
/* 主分类函数                                                          */
/* ------------------------------------------------------------------ */
const MAX_NOTE = 40;

function clip(s) {
  s = String(s || '');
  return s.length <= MAX_NOTE ? s : s.slice(0, MAX_NOTE);
}

/**
 * @param {{name:string, owner:string, orbitClass?:string, launchDate?:string}} sat
 * @returns {{operator:string, operatorZh:string, operatorKind:string, category:string,
 *            categoryLabel:string, categoryLabelEn:string, categoryConfidence:string, categoryNote:string}}
 */
export function classify(sat) {
  const name = String((sat && sat.name) || '').trim();
  const owner = String((sat && sat.owner) || '').trim() || 'UNK';

  // 1) 任务类型：V5 优先级 debris > 望远镜 > 名称规则
  let cat = 'other', conf = 'low', note = '未匹配规则';
  const objKind = String((sat && sat.objectKind) || '');
  if (objKind === 'R-B' || objKind === 'DEB') {
    // §20.4：火箭残骸 / 碎片一律归 debris，不参与任务分类，避免污染其它统计
    cat = 'debris';
    conf = 'high';
    note = objKind === 'R-B' ? '火箭残骸（SATCAT 对象类型 R/B）' : '碎片（SATCAT 对象类型 DEB）';
  } else if (sat && sat.isTelescope) {
    // §20.4：望远镜保持 science，可用 isTelescope 单独筛选
    cat = 'science';
    conf = 'high';
    note = '望远镜白名单（' + (sat.telescopeType || 'unknown') + '）';
  } else {
    for (let i = 0; i < RULES.length; i++) {
      const r = RULES[i];
      if (r[0].test(name)) { cat = r[1]; conf = r[2]; note = r[3]; break; }
    }
  }

  // 2) 运营方：按顺序命中第一条；否则退回 owner 映射
  let operator = '', operatorZh = '', operatorKind = '';
  for (let i = 0; i < OPERATORS.length; i++) {
    const o = OPERATORS[i];
    if (o[0].test(name)) { operator = o[1]; operatorZh = o[2]; operatorKind = o[3]; break; }
  }
  if (!operator) {
    operator = owner;
    operatorZh = OWNER_LABEL[owner] || ('其他(' + owner + ')');
    operatorKind = OWNER_KIND[owner] || K.unknown;
  }

  // 3) V20 §41：二级分类（可在特定型号上覆盖一级类目，如 COSMOS → mil）
  const sub = detectSubcategory({
    name,
    category: cat,
    objectKind: objKind,
    stationType: sat && sat.stationType,
    isTelescope: !!(sat && sat.isTelescope),
    owner,
    orbitClass: sat && sat.orbitClass,
    launchDate: sat && sat.launchDate,
  });
  if (sub && sub.category && sub.category !== cat) { cat = sub.category; }
  const subDef = SUBCATEGORY_DEFS[sub && sub.key] || SUBCATEGORY_DEFS['unnamed-object'];

  const def = CATEGORY_DEFS[cat] || CATEGORY_DEFS.other;
  return {
    operator,
    operatorZh,
    operatorKind,
    category: cat,
    categoryLabel: def.label,
    categoryLabelEn: def.labelEn,
    categoryConfidence: conf,
    categoryNote: clip(note),
    subcategory: subDef === SUBCATEGORY_DEFS[sub.key] ? sub.key : 'unnamed-object',
    subcategoryLabel: subDef.label,
    subcategoryLabelEn: subDef.labelEn,
  };
}

export const _internals = { RULES, OPERATORS, OWNER_LABEL, OWNER_KIND };
