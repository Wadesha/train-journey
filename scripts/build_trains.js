/**
 * 从 12306 全量车次数据（HerbertHe/cr-12306-train-info 20260617 Release）构建真实车次表
 * 只保留经过本项目 107 站的车次，输出 window.RAIL.realTrains
 * 输出: trains_data.js
 */
"use strict";
const fs = require('fs');
const path = require('path');

const G_FILE = 'C:/Temp/rail12306/train_detail_G.json';
const D_FILE = 'C:/Temp/rail12306/train_detail_D.json';
const DATA_JS = path.join(__dirname, '..', 'data.js');
const OUT = path.join(__dirname, '..', 'trains_data.js');

global.window = {};
eval(fs.readFileSync(DATA_JS, 'utf8'));
const myStations = Object.keys(window.RAIL.stations);
const mySet = new Set(myStations);

/* 12306 站名 → 本项目站名 别名 */
const ALIAS = { '辽宁朝阳': '朝阳' };

const g = JSON.parse(fs.readFileSync(G_FILE, 'utf8'));
const d = JSON.parse(fs.readFileSync(D_FILE, 'utf8'));
const all = g.concat(d);

const clsMap = { '高速': '高铁', '动车': '动车', '城际': '城际' };
const realTrains = {};
let kept = 0, dropped = 0, stopsTotal = 0;

for (const t of all) {
  const code = t.station_train_codes;
  if (!code) continue;
  const data = t.data || [];
  if (!data.length) continue;
  // 经停站序列（映射到本项目站名）
  const stops = [];
  for (const s of data) {
    let nm = s.station_name;
    if (ALIAS[nm]) nm = ALIAS[nm];
    if (mySet.has(nm)) stops.push(nm);
  }
  if (stops.length < 2) { dropped++; continue; }
  const first = data[0], last = data[data.length - 1];
  realTrains[code] = {
    from: stops[0],
    to: stops[stops.length - 1],
    dep: first.start_time && first.start_time !== '----' ? first.start_time : '',
    arr: last.arrive_time && last.arrive_time !== '----' ? last.arrive_time : '',
    cls: clsMap[first.train_class_name] || '高铁',
    stops,
  };
  kept++; stopsTotal += stops.length;
}

const out = `/* 自动生成: scripts/build_trains.js — 12306 真实车次数据（20260617） */
/* 只保留经过本项目 107 站的车次，经停站已映射为本项目站名 */
window.RAIL.realTrains = ${JSON.stringify(realTrains)};
`;
fs.writeFileSync(OUT, out, 'utf8');

console.log('OK', OUT);
console.log('保留车次:', kept, ' 丢弃(不经过107站):', dropped, ' 平均经停(107站内):', (stopsTotal/kept).toFixed(1));
console.log('文件大小:', Math.round(fs.statSync(OUT).size/1024)+'KB');
// 样例
const keys = Object.keys(realTrains);
console.log('样例车次:');
for (const k of ['G1','G3','G101','G79','G137','D3101','G1341']) {
  if (realTrains[k]) console.log(' ', k, realTrains[k].from+'→'+realTrains[k].to, realTrains[k].dep+'~'+realTrains[k].arr, realTrains[k].cls, realTrains[k].stops.join('>'));
}
