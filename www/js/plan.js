/* 離線地圖 — 出發前（v3）：在地圖上規劃路線、山區天氣、行程計畫書與逾時提醒 */
'use strict';

/* ======================= 山區天氣（Open-Meteo，免帳號） ======================= */
const WX_TEXT = c => c === 0 ? '晴' : c === 1 ? '大致晴朗' : c === 2 ? '晴時多雲' : c === 3 ? '陰' : c <= 48 ? '霧' : c <= 57 ? '毛毛雨'
  : c <= 60 ? '小雨' : c === 61 ? '小雨' : c === 63 ? '雨' : c === 65 ? '大雨' : c <= 67 ? '凍雨' : c <= 77 ? '下雪' : c <= 82 ? '陣雨' : c <= 86 ? '陣雪' : c === 95 ? '雷雨' : '雷雨、冰雹';
const WX_ICON = c => {
  const k = c <= 1 ? 'sun' : c <= 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 67 || (c >= 80 && c <= 82) ? 'rain' : c <= 86 ? 'snow' : 'storm';
  return { sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18Z"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>', rain: '<path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
    snow: '<path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="M8 18h.01M12 19h.01M16 18h.01"/>',
    storm: '<path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="m12 14-2 4h3l-2 4"/>' }[k];
};
const wxSvg = c => `<svg viewBox="0 0 24 24">${WX_ICON(c)}</svg>`;
const WXC = new Map();
async function getForecast(lat, lon, ele) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${ele != null ? Math.round(ele / 50) * 50 : ''}`;
  const hit = WXC.get(key);
  if (hit && Date.now() - hit.t < 45 * 60e3) return hit.d;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${ele != null ? `&elevation=${Math.round(ele)}` : ''}` +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_gusts_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_min,precipitation_probability_max,wind_gusts_10m_max' +
    '&timezone=auto&forecast_days=16';
  const d = await netFetch(u, { timeout: 15000 });
  if (!d || !d.daily || !d.hourly) throw new Error('天氣資料格式不對');
  d._t = Date.now();
  WXC.set(key, { t: Date.now(), d });
  return d;
}
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const WEEK = '日一二三四五六';
const mdw = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
/* 某一天的山頂天氣卡片 */
function wxDayCard(d, dayT, title) {
  const i = d.daily.time.indexOf(ymd(dayT));
  if (i < 0) return `<div class="wx-card"><div class="wx-h"><b>${esc(title)}</b></div><p class="note" style="margin:6px 0 0">${mdw(dayT)} 超出 16 天預報範圍</p></div>`;
  const D = d.daily, c = D.weather_code[i], tmin = D.temperature_2m_min[i], tmax = D.temperature_2m_max[i], app = D.apparent_temperature_min[i];
  const g = D.wind_gusts_10m_max[i], pp = D.precipitation_probability_max[i];
  const tips = [];
  if (app != null && app <= 0) tips.push(`體感最低約 ${Math.round(app)}°C，記得帶保暖衣物`);
  else if (app != null && app <= 6) tips.push(`體感最低約 ${Math.round(app)}°C，帶件保暖外套`);
  if (g >= 60) tips.push(`陣風可達 ${Math.round(g)} km/h，稜線風很強，評估是否改期`);
  else if (g >= 40) tips.push(`陣風 ${Math.round(g)} km/h，稜線注意保暖與安全`);
  if (pp >= 60) tips.push('降雨機率高，準備雨具，注意溪水暴漲');
  if (c >= 95) tips.push('可能有雷雨，避免午後在稜線或空曠處停留');
  return `<div class="wx-card">
    <div class="wx-h"><b>${esc(title)}</b><small>${mdw(dayT)} · Open-Meteo</small></div>
    <div class="wx-grid">
      <div><span>天氣</span><b class="wx-ic">${wxSvg(c)}${WX_TEXT(c)}</b></div>
      <div><span>氣溫</span><b class="mono">${Math.round(tmin)}–${Math.round(tmax)}°C</b></div>
      <div><span>陣風</span><b class="mono">${Math.round(g)} km/h</b></div>
      <div><span>降雨</span><b class="mono">${pp ?? '—'}%</b></div>
    </div>
    ${tips.length ? `<div class="wx-tip">${tips.map(esc).join('<br>')}</div>` : '<div class="wx-tip ok">天氣條件看起來不錯</div>'}
  </div>`;
}
/* 路線最高點（看山頂天氣用） */
function routeTop(r) {
  let best = null;
  for (const p of r.pts) if (p[2] != null && (!best || p[2] > best[2])) best = p;
  return best || r.pts[Math.floor(r.pts.length / 2)];
}
async function fillWx(boxSel, r, dayT) {
  const box = $(boxSel); if (!box) return;
  if (!r || !r.pts || r.pts.length < 2) { box.innerHTML = ''; return; }
  const top = routeTop(r), title = `山頂天氣${top[2] != null ? ` · 海拔 ${Math.round(top[2]).toLocaleString()} m` : ''}`;
  if (!navigator.onLine) { box.innerHTML = `<div class="wx-card"><div class="wx-h"><b>${title}</b></div><p class="note" style="margin:6px 0 0">目前離線，連上網路後可查看天氣預報</p></div>`; return; }
  box.innerHTML = `<div class="wx-card"><div class="wx-h"><b>${title}</b></div><p class="note" style="margin:6px 0 0">讀取天氣中…</p></div>`;
  try { const d = await getForecast(top[0], top[1], top[2]); const b2 = $(boxSel); if (b2) b2.innerHTML = wxDayCard(d, dayT, title); }
  catch (e) { const b2 = $(boxSel); if (b2) b2.innerHTML = `<div class="wx-card"><div class="wx-h"><b>${title}</b></div><p class="note" style="margin:6px 0 0">天氣暫時讀不到（${esc(e.message || e)}）</p></div>`; }
}

/* 主畫面天氣小標籤：目前位置的現在天氣＋日落 */
let wxNow = null;
try { wxNow = JSON.parse(localStorage.getItem('offmap-wxnow') || 'null'); } catch (e) {}
async function refreshWxChip(force) {
  const c = fix ? [fix.lat, fix.lon, fix.alt] : [map.getCenter().lat, map.getCenter().lng, null];
  if (navigator.onLine && (force || !wxNow || Date.now() - wxNow.t > 30 * 60e3 || dist([wxNow.lat, wxNow.lon], c) > 5000)) {
    try {
      const d = await getForecast(c[0], c[1], c[2]);
      const h = d.hourly, now = Date.now();
      let i = h.time.findIndex(t => Date.parse(t + ':00' + tzOff(d)) > now - 30 * 60e3); if (i < 0) i = 0;
      wxNow = { t: now, lat: c[0], lon: c[1], temp: h.temperature_2m[i], code: h.weather_code[i] };
      try { localStorage.setItem('offmap-wxnow', JSON.stringify(wxNow)); } catch (e) {}
    } catch (e) { /* 沒網路或伺服器沒回應：沿用上次的資料 */ }
  }
  renderWxChip();
}
const tzOff = d => { const s = d.utc_offset_seconds || 0, a = Math.abs(s); return `${s < 0 ? '-' : '+'}${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(Math.floor(a % 3600 / 60)).padStart(2, '0')}`; };
function renderWxChip() {
  const el = $('#wxChip');
  const c = fix ? [fix.lat, fix.lon] : [map.getCenter().lat, map.getCenter().lng];
  const st = sunTimes(new Date(), c[0], c[1]);
  const fresh = wxNow && Date.now() - wxNow.t < 6 * 3600e3 && dist([wxNow.lat, wxNow.lon], c) < 20000;
  const now = Date.now();
  const sun = st.set ? (now < st.set ? `日落 ${hhmm(st.set)}` : st.rise && now < st.rise + 864e5 ? `日出 ${hhmm(sunTimes(new Date(now + 864e5), c[0], c[1]).rise || st.rise)}` : '') : '';
  el.innerHTML = fresh ? `${wxSvg(wxNow.code)}<b class="mono">${Math.round(wxNow.temp)}°C</b><span>${WX_TEXT(wxNow.code)}${sun ? ' · ' + sun : ''}</span>`
    : `<svg viewBox="0 0 24 24"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 9V6M5.6 11.6 4 10M18.4 11.6 20 10"/></svg><span>${sun || '天氣'}</span>`;
  el.classList.remove('hidden');
}
$('#wxChip').onclick = () => openSheet('weather');
SHEETS.weather = {
  title: '天氣',
  async render(el) {
    const c = fix ? [fix.lat, fix.lon, fix.alt] : [map.getCenter().lat, map.getCenter().lng, null];
    const st = sunTimes(new Date(), c[0], c[1]);
    el.innerHTML = `<div class="group"><div class="row"><div class="grow"><div class="t">${fix ? '目前位置' : '地圖中心'}${c[2] != null ? ` · 海拔 ${Math.round(c[2])} m` : ''}</div>
      <div class="s mono">${c[0].toFixed(4)}, ${c[1].toFixed(4)}</div></div><div class="s" style="text-align:right">日出 ${st.rise ? hhmm(st.rise) : '—'}<br>日落 ${st.set ? hhmm(st.set) : '—'}</div></div></div>
      <div id="wxBody"><p class="note">${navigator.onLine ? '讀取天氣中…' : '目前離線，連上網路後可查看天氣預報。日出日落時間不需網路。'}</p></div>`;
    if (!navigator.onLine) return;
    try {
      const d = await getForecast(c[0], c[1], c[2]);
      const H = d.hourly, now = Date.now(), off = tzOff(d);
      let i0 = H.time.findIndex(t => Date.parse(t + ':00' + off) > now - 30 * 60e3); if (i0 < 0) i0 = 0;
      const hrs = [];
      for (let i = i0; i < Math.min(H.time.length, i0 + 24); i += 2) hrs.push(`<div class="wx-h1"><small>${H.time[i].slice(11, 13)} 時</small>${wxSvg(H.weather_code[i])}<b class="mono">${Math.round(H.temperature_2m[i])}°</b><small class="mono">${H.precipitation_probability[i] ?? 0}%</small></div>`);
      const D = d.daily, days = [];
      for (let i = 0; i < Math.min(7, D.time.length); i++) days.push(`<div class="row"><span style="width:76px;white-space:nowrap">${i === 0 ? '今天' : (() => { const t = new Date(Date.parse(D.time[i] + 'T12:00:00' + off)); return `${t.getMonth() + 1}/${t.getDate()} ${WEEK[t.getDay()]}`; })()}</span><span class="wx-ic grow">${wxSvg(D.weather_code[i])}${WX_TEXT(D.weather_code[i])}</span><span class="mono" style="width:78px;text-align:right">${Math.round(D.temperature_2m_min[i])}–${Math.round(D.temperature_2m_max[i])}°C</span><span class="mono s" style="width:44px;text-align:right">${D.precipitation_probability_max[i] ?? 0}%</span></div>`);
      $('#wxBody').innerHTML = `<div class="section-t">未來 24 小時</div><div class="wx-hours">${hrs.join('')}</div>
        <div class="section-t">未來 7 天</div><div class="group">${days.join('')}</div>
        <p class="note">資料來源：Open-Meteo（依海拔修正）。山區天氣變化快，出發前請再參考中央氣象署的登山天氣預報。</p>`;
    } catch (e) { const b = $('#wxBody'); if (b) b.innerHTML = `<p class="note">天氣暫時讀不到（${esc(e.message || e)}），請稍後再試。</p>`; }
  },
};
setInterval(() => safe('wxChip', () => refreshWxChip()), 5 * 60e3);
HOOKS.start.push(() => { renderWxChip(); setTimeout(() => safe('wxChip', () => refreshWxChip()), 4000); });
window.addEventListener('online', () => safe('wxChip', () => refreshWxChip()));

/* ======================= 在地圖上規劃路線 ======================= */
const PL = { on: false, ctrl: [], segs: [], snap: true, name: '', editId: null, busy: 0, sid: 0, day: null, markers: [] };
const planLayer = L.layerGroup();
const BROUTER = 'https://brouter.de/brouter';
async function routeSeg(a, b) {
  if (PL.snap && navigator.onLine) {
    try {
      const d = await netFetch(`${BROUTER}?lonlats=${a[1].toFixed(6)},${a[0].toFixed(6)}|${b[1].toFixed(6)},${b[0].toFixed(6)}&profile=hiking-mountain&alternativeidx=0&format=geojson`, { timeout: 20000 });
      const co = d && d.features && d.features[0] && d.features[0].geometry.coordinates;
      if (co && co.length > 1) return { snap: true, pts: co.map(c => [+c[1].toFixed(6), +c[0].toFixed(6), c[2] != null ? +(+c[2]).toFixed(1) : null]) };
    } catch (e) { logErr('brouter', e); PL.snapFail = true; }
  }
  // 直線：每 25 m 一點，有網路時補上高度
  const d = dist(a, b), n = Math.max(1, Math.min(99, Math.ceil(d / 25)));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([+(a[0] + (b[0] - a[0]) * i / n).toFixed(6), +(a[1] + (b[1] - a[1]) * i / n).toFixed(6), null]);
  if (navigator.onLine) {
    try {
      const r = await netFetch(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p[0]).join(',')}&longitude=${pts.map(p => p[1]).join(',')}`, { timeout: 15000 });
      if (r && Array.isArray(r.elevation) && r.elevation.length === pts.length) r.elevation.forEach((e, i) => { if (isFinite(e)) pts[i][2] = e; });
    } catch (e) { logErr('elev', e); }
  }
  return { snap: false, pts };
}
function planPts() {
  const out = [];
  PL.segs.forEach((s, i) => { if (s) for (let k = i ? 1 : 0; k < s.pts.length; k++) out.push(s.pts[k]); });
  if (!out.length && PL.ctrl.length) out.push([PL.ctrl[0][0], PL.ctrl[0][1], null]);
  return out;
}
let planLine = null, planDash = null;
function planDraw() {
  planLayer.clearLayers(); PL.markers = [];
  const pts = planPts();
  if (pts.length > 1) {
    L.polyline(pts.map(p => [p[0], p[1]]), { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(planLayer);
    L.polyline(pts.map(p => [p[0], p[1]]), { color: '#2F6FDB', weight: 5, interactive: false }).addTo(planLayer);
  }
  PL.segs.forEach((s, i) => { if (!s) L.polyline([PL.ctrl[i], PL.ctrl[i + 1]].map(p => [p[0], p[1]]), { color: '#2F6FDB', weight: 3, dashArray: '2 8', interactive: false }).addTo(planLayer); });
  PL.ctrl.forEach((c, i) => {
    const cls = i === 0 ? 'first' : i === PL.ctrl.length - 1 && i > 0 ? 'last' : '';
    const m = L.marker([c[0], c[1]], { draggable: true, zIndexOffset: 800, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="plan-pt ${cls}">${i + 1}</div>` }) });
    m.on('dragend', () => { const ll = m.getLatLng(); PL.ctrl[i] = [ll.lat, ll.lng]; planRecalc([i - 1, i]); });
    m.on('click', async () => {
      const v = await ask(`第 ${i + 1} 個點`, '要刪除這個點嗎？', [{ label: '刪除這個點', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }]);
      if (v) { PL.ctrl.splice(i, 1); PL.segs.splice(Math.min(i, PL.segs.length - 1), 1); if (i > 0 && i < PL.ctrl.length) { PL.segs[i - 1] = null; planRecalc([i - 1]); } else { planDraw(); planPanel(); } }
    });
    m.addTo(planLayer); PL.markers.push(m);
  });
  planPanel();
}
async function planRecalc(idxs) {
  const todo = idxs.filter(i => i >= 0 && i < PL.ctrl.length - 1);
  todo.forEach(i => { PL.segs[i] = null; });
  planDraw();
  const sid = PL.sid;   // 規劃畫面重新開啟後，舊的計算結果一律丟掉
  PL.busy++; planPanel();
  try {
    await Promise.all(todo.map(async i => {
      const a = PL.ctrl[i], b = PL.ctrl[i + 1];
      let s = null;
      try { s = await routeSeg(a, b); } catch (e) { logErr('routeSeg', e); }
      if (sid === PL.sid && PL.ctrl[i] === a && PL.ctrl[i + 1] === b) PL.segs[i] = s;
    }));
  } finally { if (sid === PL.sid) PL.busy = Math.max(0, PL.busy - 1); }
  if (sid !== PL.sid) return;
  const missing = PL.segs.map((s, i) => s ? -1 : i).filter(i => i >= 0 && i < PL.ctrl.length - 1 && !todo.includes(i));
  if (missing.length && !PL.busy) { planRecalc(missing); return; }
  if (PL.snapFail && PL.snap) { PL.snapFail = false; toast('沿步道連線暫時無法使用，先用直線連接', 3000); }
  if (PL.on) planDraw();
}
function planClick(e) {
  if (!PL.on) return;
  PL.ctrl.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
  if (PL.ctrl.length > 1) { PL.segs.push(null); planRecalc([PL.ctrl.length - 2]); } else planDraw();
}
function planStats() {
  const pts = planPts();
  if (pts.length < 2) return null;
  const P = prepRoute(pts), hasE = pts.filter(p => p[2] != null).length > pts.length * 0.5;
  return { P, hasE, need: stdTime(P.length, hasE ? P.up : 0) };
}
function planPanel() {
  const box = $('#planPanel'); if (!box) return;
  const st = planStats(), n = PL.ctrl.length, complete = PL.segs.length === Math.max(0, n - 1) && PL.segs.every(Boolean);
  $('#planHint').textContent = PL.busy ? '計算路線中…' : n === 0 ? '點地圖放下起點' : n === 1 ? '再點下一個點，路線會自動連起來' : '繼續點地圖延伸路線；拖曳圓點可調整位置';
  box.querySelector('.pl-stats').innerHTML = `
    <div><span>距離</span><b class="mono">${st ? fmtKm(st.P.length) : '0'}<small> km</small></b></div>
    <div><span>爬升</span><b class="mono">${st && st.hasE ? Math.round(st.P.up).toLocaleString() : '—'}<small> m</small></b></div>
    <div><span>下降</span><b class="mono">${st && st.hasE ? Math.round(st.P.down).toLocaleString() : '—'}<small> m</small></b></div>
    <div><span>預估</span><b class="mono">${st ? fmtHM(st.need) : '—'}</b></div>`;
  $('#plSave').disabled = !st || PL.busy > 0 || !complete;
  $('#plUndo').disabled = !n;
}
function planOpen(r) {
  closeSheet();
  PL.sid++; PL.on = true; PL.busy = 0; PL.editId = r ? r.id : null; PL.name = r ? r.name : '';
  PL.ctrl = r && r.planned ? r.planned.ctrl.map(c => [c[0], c[1]]) : [];
  PL.segs = r && r.planned ? r.planned.segs.map(s => s && s.pts ? { snap: s.snap, pts: s.pts } : null) : [];
  PL.segs.length = Math.max(0, PL.ctrl.length - 1);
  PL.snap = r && r.planned ? r.planned.snap !== false : (S.planSnap !== false);
  document.body.classList.add('planning');
  planLayer.addTo(map);
  map.on('click', planClick);
  let ui = $('#planUI');
  if (!ui) {
    ui = document.createElement('div'); ui.id = 'planUI';
    ui.innerHTML = `
      <div class="plan-top">
        <button class="fab glass" id="plClose" aria-label="離開規劃"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
        <div class="plan-hint glass" id="planHint"></div>
        <button class="fab glass" id="plUndo" aria-label="復原上一個點"><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
      </div>
      <section id="planPanel" class="plan-panel">
        <input type="text" id="plName" class="pl-name" placeholder="路線名稱，例如：鳶嘴稍來 O 型">
        <div class="pl-stats"></div>
        <label class="row pl-snap"><div class="grow"><div class="t">沿步道自動連線</div><div class="s">需要網路；沒網路時用直線連接</div></div><span class="switch"><input type="checkbox" id="plSnap"><i></i></span></label>
        <div class="btn-row"><button class="btn" id="plClear">清除</button><button class="btn primary" id="plSave">儲存路線</button></div>
      </section>`;
    document.body.appendChild(ui);
    $('#plClose').onclick = async () => {
      if (PL.ctrl.length && !(await ask('離開規劃？', '尚未儲存的路線會消失。', [{ label: '離開', value: 1, cls: 'danger' }, { label: '繼續規劃', value: 0, cls: 'ghost' }]))) return;
      planExit();
    };
    $('#plUndo').onclick = () => { if (!PL.ctrl.length) return; PL.ctrl.pop(); PL.segs.length = Math.max(0, PL.ctrl.length - 1); planDraw(); };
    $('#plClear').onclick = async () => { if (PL.ctrl.length && await ask('清除所有點？', '', [{ label: '清除', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }])) { PL.ctrl = []; PL.segs = []; planDraw(); } };
    $('#plSnap').onchange = e => { PL.snap = e.target.checked; S.planSnap = PL.snap; saveSettings(); if (PL.ctrl.length > 1) planRecalc(PL.ctrl.map((_, i) => i)); };
    $('#plName').oninput = e => { PL.name = e.target.value; };
    $('#plSave').onclick = planSave;
  }
  ui.classList.remove('hidden');
  $('#plName').value = PL.name; $('#plSnap').checked = PL.snap;
  setFollow(false);
  planDraw();
  if (PL.ctrl.length) map.fitBounds(L.latLngBounds(PL.ctrl.map(c => [c[0], c[1]])), { padding: [80, 80] });
  if (!navigator.onLine) toast('目前離線：會用直線連接，沒有高度資料', 3500);
  const miss = PL.segs.map((s, i) => s ? -1 : i).filter(i => i >= 0);
  if (miss.length) planRecalc(miss);
}
function planExit() {
  PL.sid++; PL.busy = 0; PL.on = false; map.off('click', planClick); map.removeLayer(planLayer); planLayer.clearLayers();
  document.body.classList.remove('planning');
  const ui = $('#planUI'); if (ui) ui.classList.add('hidden');
}
async function planSave() {
  const st = planStats();
  if (!st || PL.busy || !PL.segs.every(Boolean)) { toast('路線還在計算中，請稍候'); return; }
  const pts = planPts();
  const name = (PL.name || '').trim() || `規劃路線 ${fmtDate(Date.now()).split(' ')[0]}`;
  const r = { id: PL.editId || uid(), name, pts, wpts: [], created: Date.now(), length: st.P.length, up: st.hasE ? st.P.up : 0,
    planned: { ctrl: PL.ctrl, segs: PL.segs, snap: PL.snap } };
  if (PL.editId) { const old = await DB.get('routes', PL.editId); if (old) { r.created = old.created; r.wpts = old.wpts || []; r.turn = old.turn; } }
  await DB.put('routes', r);
  planExit();
  if (S.activeRoute === r.id) await setActiveRoute(r.id);   // 編輯的是導航中的路線：立刻換成新的
  const v = await ask('路線已儲存', `${esc(name)}<br>${fmtKm(st.P.length)} km${st.hasE ? ` · 爬升 ${Math.round(st.P.up)} m` : ''} · 約 ${fmtHM(st.need)}`,
    [{ label: '設為導航路線', value: 'nav', cls: 'primary' }, { label: '寫行程計畫書', value: 'trip' }, { label: '下載沿線地圖', value: 'dl' }, { label: '完成', value: 0, cls: 'ghost' }]);
  if (v === 'nav' || v === 'trip' || v === 'dl') await setActiveRoute(r.id, true);
  if (v === 'trip') openSheet('trip', { routeId: r.id });
  if (v === 'dl') openSheet('download', { mode: 'route', routeId: r.id });
}

/* ======================= 行程計畫書＋逾時提醒 ======================= */
const toLocalInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = s => { const t = new Date(s).getTime(); return isNaN(t) ? null : t; };
async function getTrip() { try { return (await DB.kvGet('trip')) || null; } catch (e) { return null; } }
async function scheduleOverdue(tr) {
  if (!NATIVE || !NP.LocalNotifications) return false;
  try { await NP.LocalNotifications.cancel({ notifications: [{ id: 9100 }, { id: 9101 }] }); } catch (e) {}
  if (!tr || !tr.remind || tr.done) return false;
  const list = [], now = Date.now();
  const t1 = tr.end + 60 * 60e3, t2 = tr.end + 3 * 3600e3;
  if (t1 > now) list.push({ id: 9100, title: '超過預計下山時間了', body: `「${tr.routeName}」預計 ${hhmm(tr.end)} 下山。平安的話，記得跟留守人報平安。`, schedule: { at: new Date(t1) } });
  if (t2 > now) list.push({ id: 9101, title: '已超過預計下山時間 3 小時', body: '如果已平安下山，請結束記錄並聯絡留守人，避免家人擔心。', schedule: { at: new Date(t2) } });
  if (!list.length) return false;
  try { await NP.LocalNotifications.requestPermissions(); await NP.LocalNotifications.schedule({ notifications: list }); return true; } catch (e) { logErr('overdue', e); return false; }
}
function tripText(tr, r) {
  const st = r ? prepRoute(r.pts) : null, top = r ? routeTop(r) : null, s0 = r && r.pts[0];
  const f0 = s0 ? coordFormats(s0[0], s0[1]) : null, ft = top ? coordFormats(top[0], top[1]) : null;
  const L_ = [`【登山行程計畫】${tr.who ? tr.who : (S.myName || '')}`.trim(),
    `路線：${tr.routeName}${st ? `（${fmtKm(st.length)} km，爬升 ${Math.round(st.up)} m）` : ''}`,
    `出發：${mdw(tr.start)} ${hhmm(tr.start)}`,
    `預計下山：${mdw(tr.end)} ${hhmm(tr.end)}`,
    `若 ${mdw(tr.end + 3 * 3600e3)} ${hhmm(tr.end + 3 * 3600e3)} 仍聯絡不上，請先打電話給同行者，仍無消息請撥 112 或 119 報案。`];
  if (tr.party) L_.push(`同行：${tr.party}`);
  if (S.contact) L_.push(`留守人電話：${S.contact}`);
  if (tr.car) L_.push(`交通／車牌：${tr.car}`);
  if (f0) L_.push(`登山口：${f0.dec}${f0.inTW ? `（TWD97 ${f0.twd97raw[0]}, ${f0.twd97raw[1]}）` : ''}`);
  if (ft && top[2] != null) L_.push(`最高點：海拔 ${Math.round(top[2])} m，${ft.dec}`);
  if (tr.wx) L_.push(`天氣預報：${tr.wx}`);
  if (tr.note) L_.push(`備註：${tr.note}`);
  if (s0) L_.push(`登山口地圖：https://maps.google.com/?q=${s0[0].toFixed(6)},${s0[1].toFixed(6)}`);
  return L_.join('\n');
}
SHEETS.trip = {
  title: '行程計畫書',
  async render(el, arg) {
    const routes = (await DB.all('routes')).filter(r => r.pts && r.pts.length > 1).sort((a, b) => b.created - a.created);
    let tr = await getTrip();
    if (tr && tr.end + 12 * 3600e3 < Date.now()) tr = null;   // 過期的計畫不再沿用
    const rid = (arg && arg.routeId) || (tr && tr.routeId) || S.activeRoute || (routes[0] && routes[0].id);
    const r = routes.find(x => x.id === rid) || routes[0] || null;
    if (!r) { el.innerHTML = `<div class="empty">請先匯入或規劃一條路線，再來寫行程計畫書。</div><button class="btn primary block" id="tpPlan">在地圖上規劃路線</button>`; $('#tpPlan').onclick = () => planOpen(); return; }
    const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(6, 0, 0, 0);
    const same = tr && tr.routeId === r.id;
    const start = same ? tr.start : tom.getTime();
    const need = stdTime(r.length || prepRoute(r.pts).length, r.up || 0);
    const autoEnd = t => Math.ceil((t + need * 1.15) / 600e3) * 600e3;   // 標準時間多抓 15%
    const end = same && tr.endManual ? tr.end : autoEnd(start);
    const v = { start, end, endManual: !!(same && tr.endManual), party: same ? tr.party || '' : '', car: same ? tr.car || '' : '', note: same ? tr.note || '' : '', remind: same ? tr.remind !== false : true, wx: '' };
    el.innerHTML = `
      ${tr && tr.saved && !tr.done ? `<div class="trip-on">已儲存的計畫：${esc(tr.routeName)} · ${mdw(tr.start)} ${hhmm(tr.start)} 出發${tr.remind && NATIVE ? ' · 逾時提醒已開啟' : ''}</div>` : ''}
      <div class="group">
        <label class="row"><div class="t">路線</div><select id="tpRoute">${routes.map(x => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="row"><div class="t">出發</div><input type="datetime-local" id="tpStart" value="${toLocalInput(v.start)}"></label>
        <label class="row"><div class="grow"><div class="t">預計下山</div><div class="s">依標準時間多抓 15%，可自行修改</div></div><input type="datetime-local" id="tpEnd" value="${toLocalInput(v.end)}"></label>
      </div>
      <div id="tpWx" style="margin-top:10px"></div>
      <div class="section-t">其他資訊（選填）</div>
      <div class="group">
        <label class="row"><div class="t">同行者</div><input type="text" id="tpParty" placeholder="姓名、電話" value="${esc(v.party)}"></label>
        <label class="row"><div class="t">留守人電話</div><input type="tel" id="tpContact" placeholder="0912345678" value="${esc(S.contact)}"></label>
        <label class="row"><div class="t">交通／車牌</div><input type="text" id="tpCar" placeholder="例如：自行開車 ABC-1234" value="${esc(v.car)}"></label>
        <label class="row" style="display:block"><div class="t">備註</div><textarea id="tpNote" rows="2" placeholder="例如：帶頭燈、預計在山頂午餐">${esc(v.note)}</textarea></label>
      </div>
      <div class="group" style="margin-top:10px">${swRow('tpRemind', '逾時提醒', NATIVE ? '超過預計下山 1 小時、3 小時還沒結束記錄，手機會提醒你報平安' : '（iPhone App 版才有）', v.remind)}</div>
      <button class="btn primary block" id="tpShare" style="margin-top:14px">${ICON.share}儲存並分享計畫書</button>
      <div class="btn-row"><button class="btn" id="tpSms">${ICON.msg}傳給留守人</button><button class="btn" id="tpCopy">${ICON.copy}複製文字</button></div>
      ${tr && tr.saved && !tr.done ? '<button class="btn ghost block" id="tpCancel" style="margin-top:6px;color:var(--danger)">取消這份計畫與提醒</button>' : ''}
      <p class="note">計畫書會寫明出發、預計下山時間、登山口座標，以及「超過多久聯絡不上就報案」。結束記錄時，App 會自動取消提醒，並問你要不要傳簡訊報平安。</p>`;
    const read = () => {
      const s = fromLocalInput($('#tpStart').value) || v.start;
      let e = fromLocalInput($('#tpEnd').value) || v.end;
      if (e <= s) e = autoEnd(s);
      return { routeId: r.id, routeName: r.name, start: s, end: e, endManual: v.endManual, party: $('#tpParty').value.trim(), car: $('#tpCar').value.trim(),
        note: $('#tpNote').value.trim(), remind: $('#tpRemind').checked, wx: v.wx, saved: true, done: false };
    };
    const loadWx = async () => {
      await fillWx('#tpWx', r, fromLocalInput($('#tpStart').value) || v.start);
      const b = $('#tpWx .wx-grid'); v.wx = b ? [...b.querySelectorAll('div')].map(x => x.querySelector('b').textContent).join('，') : '';
    };
    loadWx();
    $('#tpRoute').onchange = e => openSheet('trip', { routeId: e.target.value });
    $('#tpStart').onchange = () => { const s = fromLocalInput($('#tpStart').value); if (s && !v.endManual) $('#tpEnd').value = toLocalInput(autoEnd(s)); loadWx(); };
    $('#tpEnd').onchange = () => { v.endManual = true; };
    $('#tpContact').onchange = e => { S.contact = e.target.value.trim(); saveSettings(); };
    const save = async () => {
      S.contact = $('#tpContact').value.trim(); saveSettings();
      const t = read(); await DB.kvSet('trip', t);
      const ok = await scheduleOverdue(t);
      return { t, ok };
    };
    $('#tpShare').onclick = async () => {
      const { t, ok } = await save(); const txt = tripText(t, r);
      if (NATIVE) { try { await NP.Share.share({ text: txt }); } catch (e) {} }
      else { try { if (navigator.share) await navigator.share({ text: txt }); else copyText(txt); } catch (e) {} }
      toast(t.remind && ok ? '已儲存，逾時提醒已開啟' : '已儲存計畫書');
    };
    $('#tpSms').onclick = async () => {
      const { t } = await save(); const nums = S.contact.split(/[,，;\s]+/).filter(Boolean);
      if (!nums.length) return toast('請先填留守人電話');
      const body = encodeURIComponent(tripText(t, r));
      location.href = nums.length > 1 ? `sms:/open?addresses=${nums.join(',')}&body=${body}` : `sms:${nums[0]}&body=${body}`;
    };
    $('#tpCopy').onclick = async () => { const { t } = await save(); copyText(tripText(t, r)); };
    const cb = $('#tpCancel'); if (cb) cb.onclick = async () => { await DB.kvDel('trip'); await scheduleOverdue(null); toast('已取消計畫與提醒'); renderSheet(); };
  },
};
/* 結束記錄：取消逾時提醒、問要不要報平安 */
HOOKS.finish.push(async (t) => {
  const tr = await getTrip();
  if (!tr || tr.done || !tr.saved) return;
  const now = Date.now();
  if (now < tr.start - 2 * 3600e3 || now > tr.end + 24 * 3600e3) return;
  // 先問清楚，避免開車、午餐等其他記錄誤把真正行程的提醒取消掉
  setTimeout(async () => {
    const v = await ask('這趟行程結束了嗎？', `行程計畫「${esc(tr.routeName)}」預計 ${hhmm(tr.end)} 下山。<br>如果已經平安下山，就取消逾時提醒；如果只是中途停下來，請保留提醒。`,
      [{ label: '已下山，傳簡訊報平安', value: 2, cls: 'primary' }, { label: '已下山，取消提醒', value: 1 }, { label: '還沒，保留提醒', value: 0, cls: 'ghost' }]);
    if (!v) return;
    tr.done = true; await DB.kvSet('trip', tr); await scheduleOverdue(null);
    toast('已取消逾時提醒');
    if (v !== 2) return;
    const nums = (S.contact || '').split(/[,，;\s]+/).filter(Boolean);
    const body = encodeURIComponent(`【平安下山】${S.myName ? S.myName + ' ' : ''}已於 ${hhmm(now)} 結束「${tr.routeName}」行程，平安。`);
    location.href = nums.length > 1 ? `sms:/open?addresses=${nums.join(',')}&body=${body}` : `sms:${nums[0] || ''}&body=${body}`;
  }, 900);
});

/* ======================= 路線頁：加入規劃、計畫書、山頂天氣 ======================= */
(() => {
  const orig = SHEETS.routes.render;
  SHEETS.routes.render = async function (el, arg) {
    await orig.call(this, el, arg);
    const imp = $('#btnImport');
    if (imp) {
      const row = document.createElement('div'); row.className = 'btn-row';
      row.innerHTML = `<button class="btn" id="btnPlanNew"><svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5 16.5 7.5" stroke-dasharray="2 3"/></svg>在地圖上規劃</button><button class="btn" id="btnTrip"><svg viewBox="0 0 24 24"><path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/></svg>行程計畫書</button>`;
      imp.after(row);
      $('#btnPlanNew').onclick = () => planOpen();
      $('#btnTrip').onclick = () => openSheet('trip', { routeId: S.activeRoute });
    }
    const tr = await getTrip();
    if (tr && tr.saved && !tr.done && tr.end + 12 * 3600e3 > Date.now() && imp) {
      const d = document.createElement('button'); d.className = 'trip-on'; d.style.width = '100%'; d.style.textAlign = 'left';
      d.textContent = `行程計畫：${tr.routeName} · ${mdw(tr.start)} ${hhmm(tr.start)} 出發，預計 ${hhmm(tr.end)} 下山${tr.remind && NATIVE ? ' · 逾時提醒已開' : ''}`;
      d.onclick = () => openSheet('trip', { routeId: tr.routeId });
      imp.before(d);
    }
    // 導航中的路線：山頂天氣
    if (route && navigator.onLine) {
      const acts = $('#btnTurn'); if (acts) { const w = document.createElement('div'); w.id = 'rtWx'; w.style.marginTop = '10px'; acts.closest('.row').appendChild(w); fillWx('#rtWx', route, Date.now()); }
    }
    // 規劃的路線可以再編輯
    const list = await DB.all('routes');
    $$('[data-id]', el).forEach(row => {
      const r = list.find(x => x.id === row.dataset.id); if (!r || !r.planned) return;
      const acts = row.querySelector('.acts'); if (!acts) return;
      const b = document.createElement('button'); b.className = 'mini'; b.textContent = '編輯';
      b.onclick = () => planOpen(r); acts.insertBefore(b, acts.lastElementChild);
    });
  };
})();
