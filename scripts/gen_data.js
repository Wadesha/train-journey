/**
 * 生成游戏线路数据 data.js
 * 数据源: train-travel-recorder 小程序的 railway_lines.js（站序基于公开铁路数据）
 * 流程: 提取 7 条高铁线路 → 相邻站大圆距离 → 缩放对齐官方总里程 → 拓扑图坐标(锚点分段插值) → 风景/车次 → 输出 window.RAIL
 */
"use strict";
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/wade/OneDrive/miniprograms/train-travel-recorder/miniprogram-original-v2/miniprogram/utils/railway_lines.js';
const OUT = path.join(__dirname, '..', 'data.js');
const lines = require(SRC);

/* 官方总里程（km），用于缩放 */
const OFFICIAL_KM = {
  '京沪高速线': 1318, '京广高速线': 2298, '京沈高速线': 697, '哈大高速线': 921,
  '徐兰高速线': 1406, '沪昆高速线': 2252, '杭深线': 1450,
};

/* 徐兰高速线 = 郑徐 + 郑西 + 西宝 + 宝兰 合并（徐州东→兰州西） */
function mergeXulan() {
  const segs = ['徐兰高速线-郑徐段', '徐兰高速线-郑西段', '徐兰高速线-西宝段', '徐兰高速线-宝兰段'].map(p => lines[p].stations);
  const merged = [];
  const push = s => { if (!merged.length || merged[merged.length - 1].name !== s.name) merged.push(s); };
  segs[0].slice().reverse().forEach(push);  // 徐州东...郑州东
  segs.slice(1).forEach(seg => seg.slice(1).forEach(push));
  return merged;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* 站序 + 累计 km（按官方里程缩放） */
function buildStations(metaKey) {
  const raw = metaKey === '徐兰高速线' ? mergeXulan() : lines[metaKey].stations;
  const list = raw.map(s => ({ name: s.name, lat: parseFloat(s.latitude), lon: parseFloat(s.longitude) }))
    .filter(s => !isNaN(s.lat) && !isNaN(s.lon));
  const segs = [];
  for (let i = 0; i < list.length - 1; i++) segs.push(haversine(list[i].lat, list[i].lon, list[i + 1].lat, list[i + 1].lon));
  const k = OFFICIAL_KM[metaKey] / segs.reduce((a, b) => a + b, 0);
  const km = [0];
  for (let i = 0; i < segs.length; i++) km.push(km[i] + segs[i] * k);
  return list.map((s, i) => ({ name: s.name, km: Math.round(km[i]), lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4) }));
}

/* ================= 拓扑图坐标：锚点分段插值 =================
   每线定义锚点 [km, x, y]，站按 km 在相邻锚点间线性插值。
   换乘站：跨线共享同一坐标（锚点显式给定）。 */
const ANCHORS = {
  '哈大高速线': [
    [0, 150, 120], [Math.round(921 * 5 / 10), 150, 410], [921, 150, 700], // 沈阳(第6/11站)≈460
  ],
  '京沪高速线': [
    [0, 340, 110], [1318, 340, 540],
  ],
  '京广高速线': [
    [0, 640, 110], [349, 640, 300], [1083, 640, 540], [2298, 640, 830], // 郑州东≈349 长沙南≈1083
  ],
  '京沈高速线': [ // 折线：每站一个锚点
    [0, 340, 60], [193, 310, 130], [409, 260, 210], [558, 210, 290], [651, 172, 355], [697, 150, 410],
  ],
  '徐兰高速线': [
    [0, 340, 300], [349, 640, 300], [1406, 1290, 300], // 郑州东≈349
  ],
  '沪昆高速线': [
    [0, 340, 540], [160, 384, 540], [1083, 640, 540], [2252, 1300, 540], // 杭州东 长沙南
  ],
  '杭深线': [
    [0, 384, 540], [1450, 384, 830],
  ],
};

function lerp(a, b, t) { return a + (b - a) * t; }
function placeOnLine(anchors, km) {
  for (let i = 0; i < anchors.length - 1; i++) {
    const [k0, x0, y0] = anchors[i], [k1, x1, y1] = anchors[i + 1];
    if (km >= k0 && km <= k1) {
      const t = k1 === k0 ? 0 : (km - k0) / (k1 - k0);
      return { x: Math.round(lerp(x0, x1, t)), y: Math.round(lerp(y0, y1, t)) };
    }
  }
  return { x: anchors[anchors.length - 1][1], y: anchors[anchors.length - 1][2] };
}

/* ================= 风景类型（本站→下一站区段） ================= */
const SCENERY = {
  '京沪高速线': { '北京南': 'urban', '廊坊': 'plain', '天津西': 'plain', '天津南': 'plain', '沧州西': 'plain', '德州东': 'plain', '济南西': 'plain', '泰安': 'mountain', '枣庄': 'plain', '徐州东': 'plain', '宿州东': 'plain', '蚌埠南': 'plain', '滁州': 'plain', '南京南': 'water', '镇江南': 'water', '常州北': 'water', '无锡东': 'water', '苏州北': 'water', '昆山南': 'urban', '上海虹桥': '*' },
  '京广高速线': { '北京丰台': 'urban', '保定东': 'plain', '石家庄': 'plain', '邢台东': 'plain', '邯郸东': 'plain', '安阳东': 'plain', '鹤壁东': 'plain', '新乡东': 'plain', '郑州东': 'plain', '许昌东': 'plain', '漯河西': 'plain', '驻马店西': 'plain', '信阳东': 'plain', '孝感北': 'water', '武汉': 'water', '咸宁北': 'water', '岳阳东': 'water', '长沙南': 'water', '株洲西': 'plain', '衡阳东': 'plain', '郴州西': 'mountain', '韶关': 'mountain', '清远': 'mountain', '广州北': 'urban', '广州南': '*' },
  '京沈高速线': { '北京朝阳': 'urban', '承德南': 'mountain', '朝阳': 'mountain', '阜新': 'plain', '沈阳西': 'plain', '沈阳': '*' },
  '哈大高速线': { '哈尔滨西': 'snow', '长春西': 'snow', '四平东': 'plain', '铁岭西': 'plain', '沈阳北': 'plain', '沈阳': 'plain', '沈阳南': 'plain', '辽阳': 'plain', '鞍山西': 'plain', '营口东': 'coast', '大连北': '*' },
  '徐兰高速线': { '徐州东': 'plain', '商丘': 'plain', '开封北': 'plain', '郑州东': 'plain', '郑州西': 'plain', '洛阳龙门': 'mountain', '三门峡南': 'mountain', '渭南北': 'loess', '西安北': 'loess', '咸阳西': 'loess', '宝鸡南': 'loess', '天水南': 'mountain', '定西北': 'mountain', '兰州西': '*' },
  '沪昆高速线': { '上海虹桥': 'urban', '嘉兴南': 'water', '杭州东': 'water', '杭州南': 'water', '金华': 'mountain', '衢州': 'mountain', '上饶': 'mountain', '鹰潭北': 'mountain', '抚州东': 'mountain', '南昌西': 'plain', '新余北': 'plain', '宜春': 'plain', '萍乡北': 'plain', '长沙南': 'water', '湘潭北': 'mountain', '娄底南': 'mountain', '邵阳北': 'mountain', '怀化南': 'mountain', '铜仁南': 'mountain', '贵阳东': 'karst', '贵阳北': 'karst', '安顺西': 'karst', '曲靖北': 'karst', '昆明南': '*' },
  '杭深线': { '杭州东': 'urban', '绍兴北': 'water', '宁波': 'coast', '台州西': 'coast', '温州南': 'coast', '宁德': 'coast', '福州南': 'coast', '莆田': 'coast', '泉州': 'coast', '厦门北': 'coast', '漳州': 'coast', '潮汕': 'coast', '汕尾': 'coast', '深圳北': '*' },
};

/* ================= 车次 / 车型 ================= */
const TRAINS = {
  '京沪高速线': [
    { no: 'G1', name: '复兴号 CR400AF', dep: '07:00', arr: '11:29', desc: '标杆车 · 一站直达' },
    { no: 'G3', name: '复兴号 CR400AF', dep: '09:00', arr: '13:29', desc: '标杆车 · 大站停' },
    { no: 'G101', name: '和谐号 CRH380B', dep: '10:00', arr: '15:20', desc: '站站停' },
  ],
  '京广高速线': [
    { no: 'G79', name: '复兴号 CR400BF', dep: '08:00', arr: '16:03', desc: '标杆车 · 大站停' },
    { no: 'G81', name: '复兴号 CR400BF', dep: '09:30', arr: '17:33', desc: '大站停' },
    { no: 'G403', name: '和谐号 CRH380A', dep: '11:00', arr: '20:16', desc: '站站停' },
  ],
  '京沈高速线': [
    { no: 'G921', name: '复兴号 CR400BF-G', dep: '07:10', arr: '09:22', desc: '标杆车 · 大站停' },
    { no: 'G925', name: '复兴号 CR400BF-G', dep: '13:10', arr: '15:30', desc: '站站停' },
  ],
  '哈大高速线': [
    { no: 'G701', name: '和谐号 CRH380B', dep: '06:40', arr: '10:15', desc: '标杆车 · 大站停' },
    { no: 'G705', name: '和谐号 CRH380B', dep: '12:40', arr: '16:35', desc: '站站停' },
  ],
  '徐兰高速线': [
    { no: 'G1873', name: '复兴号 CR400AF', dep: '07:50', arr: '11:30', desc: '标杆车 · 大站停' },
    { no: 'G1883', name: '复兴号 CR400AF', dep: '14:20', arr: '18:30', desc: '站站停' },
  ],
  '沪昆高速线': [
    { no: 'G1341', name: '和谐号 CRH380A', dep: '08:00', arr: '19:10', desc: '长途标杆 · 大站停' },
    { no: 'G1355', name: '和谐号 CRH380A', dep: '10:00', arr: '21:20', desc: '长途 · 站站停' },
  ],
  '杭深线': [
    { no: 'D3101', name: '和谐号 CRH380D', dep: '09:00', arr: '14:30', desc: '动车 · 大站停' },
    { no: 'D3103', name: '和谐号 CRH380D', dep: '13:30', arr: '19:20', desc: '动车 · 站站停' },
  ],
};

const LINE_ORDER = ['哈大高速线', '京沪高速线', '京广高速线', '京沈高速线', '徐兰高速线', '沪昆高速线', '杭深线'];
const LINE_COLOR = {
  '哈大高速线': '#4fc3f7', '京沪高速线': '#e53935', '京广高速线': '#8e24aa', '京沈高速线': '#fb8c00',
  '徐兰高速线': '#43a047', '沪昆高速线': '#fdd835', '杭深线': '#00acc1',
};

/* ================= 组装 ================= */
const linesOut = {}, stationsOut = {};
for (const key of LINE_ORDER) {
  const sts = buildStations(key);
  const anchors = ANCHORS[key];
  const scenery = {};
  for (const s of sts) scenery[s.name] = (SCENERY[key] && SCENERY[key][s.name]) || 'plain';
  linesOut[key] = {
    name: key,
    color: LINE_COLOR[key],
    total: OFFICIAL_KM[key],
    trains: TRAINS[key].map(t => ({ ...t })),
    stations: sts,
    scenery,
    anchors,
  };
  for (const s of sts) {
    const p = placeOnLine(anchors, s.km);
    if (!stationsOut[s.name]) stationsOut[s.name] = { x: p.x, y: p.y, lat: s.lat, lon: s.lon, lines: [] };
    stationsOut[s.name].lines.push(key);
    // 同名站出现在多线时，坐标取锚点一致（锚点已保证换乘站重合）
    if (stationsOut[s.name].lines.length === 1) { stationsOut[s.name].x = p.x; stationsOut[s.name].y = p.y; }
  }
}
/* 徐州东：京沪本体坐标与徐兰西端不同 → 用 alt 节点 + 虚线连接 */
const xz = stationsOut['徐州东'];
if (xz) {
  const jhPos = placeOnLine(ANCHORS['京沪高速线'], 640); // 京沪线上徐州东km≈640
  xz.alt = { x: jhPos.x, y: jhPos.y };
}

const out = `/* 自动生成: scripts/gen_data.js — 请勿手改 */
window.RAIL = ${JSON.stringify({ lines: linesOut, stations: stationsOut }, null, 1)};
`;
fs.writeFileSync(OUT, out, 'utf8');

console.log('OK', OUT);
console.log('线路', Object.keys(linesOut).length, '站点', Object.keys(stationsOut).length);
for (const k of LINE_ORDER) console.log(' ', k, linesOut[k].stations.length + '站', linesOut[k].total + 'km', linesOut[k].trains.length + '车次');
const multi = Object.entries(stationsOut).filter(([n, s]) => s.lines.length > 1).map(([n, s]) => n + '(' + s.lines.join('/') + ')');
console.log('换乘站:', multi.join(', '));
