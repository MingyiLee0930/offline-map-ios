/* 離線地圖 — 核心工具：資料庫、設定、座標、圖磚、GPX */
'use strict';

/* ---------- IndexedDB ---------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('offmap', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['routes', 'tracks', 'areas', 'kv'])
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => tx(s, 'readonly', o => o.get(k)),
    put: (s, v) => tx(s, 'readwrite', o => o.put(v)),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)),
    all: s => tx(s, 'readonly', o => o.getAll()),
    kvGet: async k => { const r = await tx('kv', 'readonly', o => o.get(k)); return r ? r.v : undefined; },
    kvSet: (k, v) => tx('kv', 'readwrite', o => o.put({ k, v })),
    kvDel: k => tx('kv', 'readwrite', o => o.delete(k)),
  };
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 原生 App（Capacitor）偵測 ---------- */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const NP = {};
let NATIVE_ERR = '';
if (NATIVE) {
  const reg = (window.capacitorExports && window.capacitorExports.registerPlugin) || window.Capacitor.registerPlugin;
  for (const n of ['App', 'BackgroundGeolocation', 'Filesystem', 'LocalNotifications', 'Share', 'Haptics', 'KeepAwake', 'CapacitorHttp']) {
    try { NP[n] = reg(n); } catch (e) { NATIVE_ERR += n + ' '; }
  }
}
/* 顯示未預期的錯誤，方便除錯 */
window.addEventListener('error', e => { const t = document.getElementById('toast'); if (t) { t.textContent = '錯誤：' + e.message; t.classList.add('show'); } });
window.addEventListener('unhandledrejection', e => { const t = document.getElementById('toast'); if (t) { t.textContent = '錯誤：' + (e.reason && e.reason.message || e.reason); t.classList.add('show'); } });

/* ---------- 設定 ---------- */
const DEFAULTS = {
  layer: 'rudy', offThreshold: 50, beep: true, voice: true, keepAwake: !NATIVE,
  contact: '', myName: '', customUrl: '', activeRoute: null, minAcc: 50,
  view: [23.75, 120.95, 8],
};
const S = (() => {
  let o = {};
  try { o = JSON.parse(localStorage.getItem('offmap-settings') || '{}'); } catch (e) {}
  return Object.assign({}, DEFAULTS, o);
})();
function saveSettings() { try { localStorage.setItem('offmap-settings', JSON.stringify(S)); } catch (e) {} }

/* ---------- 地理計算 ---------- */
const RAD = Math.PI / 180;
function dist(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const dirName = b => DIRS[Math.round(b / 45) % 8];

/* 路線前處理：累積距離、累積爬升 */
function prepRoute(pts) {
  const cum = [0], cumUp = [0];
  let up = 0, down = 0, ref = null, maxE = -Infinity, minE = Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const e = pts[i][2];
    if (e != null) {
      maxE = Math.max(maxE, e); minE = Math.min(minE, e);
      if (ref == null) ref = e;
      else if (e - ref >= 3) { up += e - ref; ref = e; }
      else if (ref - e >= 3) { down += ref - e; ref = e; }
    }
    if (i) cumUp.push(up);
  }
  return { cum, cumUp, length: cum[cum.length - 1] || 0, up, down,
    maxE: isFinite(maxE) ? maxE : null, minE: isFinite(minE) ? minE : null };
}

/* 找出路線上最近點 */
function nearestOnRoute(p, pts, cum) {
  const kx = 111320 * Math.cos(p[0] * RAD), ky = 110574;
  let best = { d: Infinity, i: 0, t: 0 };
  if (pts.length === 1) return { d: dist(p, pts[0]), i: 0, t: 0, along: 0, q: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][1] - p[1]) * kx, ay = (pts[i][0] - p[0]) * ky;
    const bx = (pts[i + 1][1] - p[1]) * kx, by = (pts[i + 1][0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + t * dx, y = ay + t * dy, d = Math.sqrt(x * x + y * y);
    if (d < best.d) best = { d, i, t };
  }
  const a = pts[best.i], b = pts[best.i + 1];
  best.along = cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]);
  best.q = [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1])];
  return best;
}

/* ---------- 座標格式 ---------- */
function toTM2(lat, lon) { // TWD97 二度分帶 (TM2, 中央經線 121°E, GRS80)
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9999, E0 = 250000;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const ph = lat * RAD, la = (lon - 121) * RAD;
  const sin = Math.sin(ph), cos = Math.cos(ph), tan = Math.tan(ph);
  const N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos, A = la * cos;
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * ph
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * ph)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * ph)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * ph));
  const x = E0 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * tan * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [x, y];
}
function tm2To67(x, y) { // TWD97 → TWD67 近似轉換（誤差約數公尺）
  const A = 0.00001549, B = 0.000006521;
  return [x - 807.8 - A * x - B * y, y + 248.6 - A * y - B * x];
}
function dms(v, pos, neg) {
  const h = v >= 0 ? pos : neg; v = Math.abs(v);
  const d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${h}`;
}
const fmtTM = v => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
function coordFormats(lat, lon) {
  const [x, y] = toTM2(lat, lon);
  const [x67, y67] = tm2To67(x, y);
  return {
    dec: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    dms: `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`,
    twd97: [fmtTM(x), fmtTM(y)], twd97raw: [Math.round(x), Math.round(y)],
    twd67: [fmtTM(x67), fmtTM(y67)],
    inTW: lon > 118 && lon < 123 && lat > 21 && lat < 27,
  };
}

/* ---------- 格式化 ---------- */
const fmtKm = m => (m / 1000).toFixed(m < 10000 ? 2 : 1);
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 圖層 ---------- */
const LAYERS = {
  rudy: { name: '魯地圖', desc: '台灣登山首選，含等高線、步道、山屋', url: 'https://tile.happyman.idv.tw/map/rudy/{z}/{x}/{y}.png',
    maxNative: 17, kb: 28, dl: true, attr: '魯地圖 Rudy Map © OSM contributors', sw: 'linear-gradient(135deg,#e9efd9,#c9dcb3 45%,#f3e6c8)' },
  moi: { name: '魯地圖 清爽版', desc: '等高線清晰、配色淡雅', url: 'https://tile.happyman.idv.tw/map/moi_osm/{z}/{x}/{y}.png',
    maxNative: 17, kb: 24, dl: true, attr: 'MOI.OSM © happyman / OSM contributors', sw: 'linear-gradient(135deg,#f4f1ea,#e2e6dc 50%,#d6dfd0)' },
  emap: { name: '台灣通用電子地圖', desc: '國土測繪中心，含 20m 等高線', url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
    maxNative: 18, kb: 22, dl: true, attr: '© 內政部國土測繪中心', sw: 'linear-gradient(135deg,#f6f2e6,#e7e0cc 50%,#cfe0e8)' },
  photo: { name: '台灣正射影像', desc: '國土測繪中心航照圖', url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
    maxNative: 18, kb: 45, dl: true, attr: '© 內政部國土測繪中心', sw: 'linear-gradient(135deg,#4d5b3f,#6f7a52 45%,#8b8a6a)' },
  sat: { name: '全球衛星圖', desc: 'Esri World Imagery，國外適用', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNative: 18, kb: 40, dl: true, attr: 'Imagery © Esri, Maxar, Earthstar', sw: 'linear-gradient(135deg,#2f3d2e,#51603f 50%,#3b4a52)' },
  topo: { name: 'OpenTopoMap', desc: '全球地形圖，含等高線', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    maxNative: 17, kb: 30, dl: true, dlMax: 3000, attr: '© OpenTopoMap (CC-BY-SA) © OSM contributors', sw: 'linear-gradient(135deg,#f2ecd8,#d8e3c0 45%,#e8d3b4)' },
  osm: { name: '開放街道地圖', desc: 'OSM 標準圖，城市旅遊（僅線上瀏覽）', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNative: 19, kb: 20, dl: false, attr: '© OpenStreetMap contributors', sw: 'linear-gradient(135deg,#f2efe9,#e0dfd5 50%,#aad3df)' },
  custom: { name: '自訂圖層', desc: '在設定中填入圖磚網址', url: '', maxNative: 18, kb: 30, dl: true, attr: '', sw: 'repeating-linear-gradient(45deg,#eee,#eee 6px,#f8f8f8 6px,#f8f8f8 12px)' },
};
function layerDef(key) {
  const L = LAYERS[key] || LAYERS.rudy;
  if (key === 'custom') L.url = S.customUrl;
  return L;
}

/* ---------- 圖磚計算 ---------- */
const TILE_CACHE = 'tiles-dl';
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = Math.max(-85.05, Math.min(85.05, lat)) * RAD; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/* 依區域產生 [z,x,y] 清單 */
function tilesForArea(area) {
  const out = [];
  for (let z = area.zmin; z <= area.zmax; z++) {
    if (area.kind === 'bbox' || z <= 11) {
      const b = area.kind === 'bbox' ? area.bounds : area.bbox; // [s,w,n,e]
      const x0 = lon2x(b[1], z), x1 = lon2x(b[3], z), y0 = lat2y(b[2], z), y1 = lat2y(b[0], z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    } else {
      const set = new Set(), pts = area.line, r = area.radius;
      const tileM = 40075016 * Math.cos(23.5 * RAD) / 2 ** z;
      const step = Math.max(20, Math.min(r, tileM / 2));
      const addCircle = (lat, lon) => {
        const dLat = r / 110574, dLon = r / (111320 * Math.cos(lat * RAD));
        const x0 = lon2x(lon - dLon, z), x1 = lon2x(lon + dLon, z), y0 = lat2y(lat + dLat, z), y1 = lat2y(lat - dLat, z);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(x + '/' + y);
      };
      for (let i = 0; i < pts.length; i++) {
        addCircle(pts[i][0], pts[i][1]);
        if (i < pts.length - 1) {
          const d = dist(pts[i], pts[i + 1]), n = Math.floor(d / step);
          for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            addCircle(pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1]));
          }
        }
      }
      for (const k of set) { const [x, y] = k.split('/'); out.push([z, +x, +y]); }
    }
  }
  return out;
}
const tileKey = (layer, z, x, y) => `${layer}/${z}/${x}/${y}.png`;
/* 每張圖磚的下載工作：url（網路位址）與 key（原生 App 的檔案路徑） */
function jobsForArea(area) {
  const jobs = [];
  const tiles = tilesForArea(area);
  for (const key of area.layers) {
    const tpl = key === 'custom' ? (area.customUrl || S.customUrl) : LAYERS[key]?.url;
    if (!tpl) continue;
    for (const [z, x, y] of tiles) jobs.push({ url: tileUrl(tpl, z, x, y), key: tileKey(key, z, x, y) });
  }
  return jobs;
}
const urlsForArea = area => jobsForArea(area).map(j => j.url);

/* 原生 App 的離線圖磚：存成手機內的檔案，index 記錄已存在的圖磚 */
const NT = {
  base: '', index: new Set(),
  async load() {
    try { const r = await NP.Filesystem.getUri({ directory: 'DATA', path: 'tiles' }); this.base = r.uri.replace(/\/$/, ''); } catch (e) {}
    try { this.index = new Set((await DB.kvGet('ntindex')) || []); } catch (e) {}
  },
  save() { return DB.kvSet('ntindex', [...this.index]).catch(() => {}); },
  src(key) { return window.Capacitor.convertFileSrc(this.base + '/' + key); },
};
/* 抽稀路線（Douglas-Peucker 簡化版，以距離門檻） */
function thinLine(pts, minGap = 30) {
  if (pts.length < 3) return pts.map(p => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) if (dist(last, pts[i]) >= minGap) { out.push([pts[i][0], pts[i][1]]); last = pts[i]; }
  const e = pts[pts.length - 1]; out.push([e[0], e[1]]);
  return out;
}
function lineBBox(pts, padM = 0) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of pts) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
  const dLat = padM / 110574, dLon = padM / (111320 * Math.cos((s + n) / 2 * RAD));
  return [s - dLat, w - dLon, n + dLat, e + dLon];
}

/* ---------- GPX ---------- */
function parseGPX(text, fname) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX 格式錯誤');
  const byTag = (el, t) => el.getElementsByTagNameNS('*', t);
  const txt = (el, t) => { const n = byTag(el, t)[0]; return n ? n.textContent.trim() : null; };
  const toPt = el => {
    const lat = parseFloat(el.getAttribute('lat')), lon = parseFloat(el.getAttribute('lon'));
    const e = txt(el, 'ele');
    return [lat, lon, e != null && e !== '' ? parseFloat(e) : null];
  };
  let pts = [...byTag(doc, 'trkpt')].map(toPt);
  if (!pts.length) pts = [...byTag(doc, 'rtept')].map(toPt);
  pts = pts.filter(p => isFinite(p[0]) && isFinite(p[1]));
  const wpts = [...byTag(doc, 'wpt')].map(w => { const p = toPt(w); return { lat: p[0], lon: p[1], ele: p[2], name: txt(w, 'name') || '航點' }; })
    .filter(w => isFinite(w.lat));
  const trk = byTag(doc, 'trk')[0] || byTag(doc, 'rte')[0];
  const name = (trk && txt(trk, 'name')) || txt(doc, 'name') || fname.replace(/\.gpx$/i, '');
  if (!pts.length && !wpts.length) throw new Error('檔案中沒有軌跡或航點');
  return { name, pts, wpts };
}
function toGPX(name, pts, wpts = []) {
  const x = s => esc(s);
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="離線地圖" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(name)}</name></metadata>\n`;
  for (const w of wpts) s += `<wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">${w.ele != null ? `<ele>${w.ele.toFixed(1)}</ele>` : ''}${w.t ? `<time>${new Date(w.t).toISOString()}</time>` : ''}<name>${x(w.name)}</name></wpt>\n`;
  s += `<trk><name>${x(name)}</name><trkseg>\n`;
  for (const p of pts) s += `<trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">${p[2] != null ? `<ele>${p[2].toFixed(1)}</ele>` : ''}${p[3] ? `<time>${new Date(p[3]).toISOString()}</time>` : ''}</trkpt>\n`;
  return s + '</trkseg></trk>\n</gpx>\n';
}
