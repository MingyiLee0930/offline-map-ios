/* 離線地圖 — 導航強化（v3）：坡度上色、下一個航點、前方剖面、訊號標示、夜間模式、版面 */
'use strict';

/* ---------- 掛勾：讓各功能模組彼此獨立，任一個出錯都不影響其他 ---------- */
const HOOKS = { start: [], finish: [], nav: [], fix: [] };
function startHooks() { for (const f of HOOKS.start) safe('start', f); }
function afterFinishHooks(t) { for (const f of HOOKS.finish) safe('finish', () => f(t)); }
function navHook(n) { for (const f of HOOKS.nav) safe('nav', () => f(n)); }
function fixHook() { for (const f of HOOKS.fix) safe('fix', f); }

/* ---------- 版面：頂部區塊高度給其他元件定位 ---------- */
function syncTopH() {
  const tb = $('#topbar'); if (!tb) return;
  document.body.style.setProperty('--top-h', Math.round(tb.getBoundingClientRect().bottom) + 'px');
}
if (window.ResizeObserver) new ResizeObserver(() => syncTopH()).observe($('#topbar'));
window.addEventListener('resize', syncTopH);

/* ---------- 坡度 ---------- */
const SLOPE = [
  { c: '#3E9B62', n: '平緩', r: '< 10%' },
  { c: '#E0A21B', n: '中等', r: '10–20%' },
  { c: '#E06A26', n: '陡', r: '20–30%' },
  { c: '#C2343A', n: '很陡', r: '> 30%' },
];
const slopeIdx = g => g < 0.10 ? 0 : g < 0.20 ? 1 : g < 0.30 ? 2 : 3;
/* 路線坡度分析：補齊缺少的高度、平滑後每約 80 m 算一段坡度。結果快取在路線物件上 */
function routeSlope(r) {
  if (r._slope !== undefined) return r._slope;
  const pts = r.pts, cum = r.prep.cum, n = pts.length;
  const have = pts.filter(p => p[2] != null && isFinite(p[2])).length;
  if (n < 2 || have < 2 || have < n * 0.3) return (r._slope = null);
  const e = new Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) {
    const v = pts[i][2];
    if (v != null && isFinite(v)) {
      if (last < 0) for (let k = 0; k < i; k++) e[k] = v;
      else for (let k = last + 1; k < i; k++) e[k] = e[last] + (v - e[last]) * (cum[k] - cum[last]) / ((cum[i] - cum[last]) || 1);
      e[i] = v; last = i;
    }
  }
  for (let k = last + 1; k < n; k++) e[k] = e[last];
  // ±30 m 移動平均，去掉 GPS 高度雜訊
  const sm = new Array(n); let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && cum[hi] <= cum[i] + 30) sum += e[hi++];
    while (cum[lo] < cum[i] - 30) sum -= e[lo++];
    sm[i] = sum / (hi - lo);
  }
  const chunks = [];
  let i0 = 0;
  for (let i = 1; i < n; i++) {
    if (cum[i] - cum[i0] >= 80 || i === n - 1) {
      const d = cum[i] - cum[i0];
      const g = d > 5 ? Math.abs(sm[i] - sm[i0]) / d : 0;
      chunks.push({ i0, i1: i, a: cum[i0], b: cum[i], g, k: slopeIdx(g) });
      i0 = i;
    }
  }
  const runs = [];
  for (const c of chunks) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun.k === c.k) lastRun.i1 = c.i1; else runs.push({ i0: c.i0, i1: c.i1, k: c.k });
  }
  return (r._slope = { chunks, runs, ele: sm });
}
function drawRouteLine(r, layer) {
  const ll = r.pts.map(p => [p[0], p[1]]);
  L.polyline(ll, { color: '#fff', weight: 9, opacity: .92, interactive: false }).addTo(layer);
  const s = S.slopeColor !== false ? routeSlope(r) : null;
  if (!s) { L.polyline(ll, { color: '#2F6FDB', weight: 5, opacity: .95, interactive: false }).addTo(layer); return; }
  for (const run of s.runs)
    L.polyline(ll.slice(run.i0, run.i1 + 1), { color: SLOPE[run.k].c, weight: 5.5, opacity: .97, interactive: false, lineCap: 'round' }).addTo(layer);
}
/* 沿路線某個距離處的累積值（線性內插） */
function cumAt(arr, cum, along) {
  let lo = 0, hi = cum.length - 1;
  if (along <= 0) return arr[0];
  if (along >= cum[hi]) return arr[hi];
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= along) lo = m; else hi = m; }
  const f = (along - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return arr[lo] + (arr[hi] - arr[lo]) * f;
}

/* ---------- 下一個航點 ---------- */
function routeTargets(r) {
  if (r._targets) return r._targets;
  const P = r.prep, out = [];
  // 航點可能在路線上出現不只一次（原路來回、O 型重疊），每一段都要算進去
  for (const w of r.wpts || []) {
    let best = null;
    for (let i = 0; i < r.pts.length; i++) {
      const d = dist([w.lat, w.lon], r.pts[i]);
      if (d < 150) { if (!best || d < best.d) best = { d, along: P.cum[i] }; }
      else if (best && P.cum[i] - best.along > 300) { out.push({ name: w.name || '航點', along: best.along, ele: w.ele }); best = null; }
    }
    if (best) out.push({ name: w.name || '航點', along: best.along, ele: w.ele });
  }
  out.sort((a, b) => a.along - b.along);
  out.push({ name: '終點', along: P.length, end: true });
  return (r._targets = out);
}
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km' : Math.round(m / 10) * 10 + ' m';
const fmtMins = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${Math.max(1, m)} 分` : `${Math.floor(m / 60)} 時 ${m % 60} 分`; };
const ARROW = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  flat: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  end: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>',
};
function updateNext(n) {
  const card = $('#nextCard');
  const show = !!(route && n && n.d < 500);
  document.body.classList.toggle('navigating', show);
  card.classList.toggle('hidden', !show);
  $('#searchBar').classList.toggle('hidden', show);
  $('#btnSearchFab').classList.toggle('hidden', !show);
  if (!show) { $('#steepChip').classList.add('hidden'); return; }
  const P = route.prep, T = routeTargets(route);
  const tgt = T.find(t => t.along > n.along + 15) || T[T.length - 1];
  const d = Math.max(0, tgt.along - n.along);
  const up = Math.max(0, cumAt(P.cumUp, P.cum, tgt.along) - cumAt(P.cumUp, P.cum, n.along));
  const dn = Math.max(0, cumAt(P.cumDown, P.cum, tgt.along) - cumAt(P.cumDown, P.cum, n.along));
  const eta = stdTime(d, up) * paceFactor();
  const kind = tgt.end && d < 30 ? 'end' : up > dn + 20 ? 'up' : dn > up + 20 ? 'down' : 'flat';
  $('#nextIc').innerHTML = ARROW[kind];
  $('#nextIc').className = 'next-ic ' + kind;
  $('#nextLbl').textContent = tgt.end ? (d < 30 ? '已到達終點' : '終點') : `下一個航點 · 還有 ${T.filter(t => !t.end && t.along > n.along + 15).length} 個`;
  $('#nextName').textContent = tgt.end ? route.name : tgt.name;
  $('#nextMeta').innerHTML = `<span>${fmtDist(d)}</span><span>約 ${fmtMins(eta)}</span>${up >= 5 ? `<span class="up">↑ ${Math.round(up)} m</span>` : ''}${dn >= 5 ? `<span>↓ ${Math.round(dn)} m</span>` : ''}`;
  // 前方 1 km 最陡
  const s = S.slopeColor !== false ? routeSlope(route) : null;
  let gmax = 0;
  if (s) for (const c of s.chunks) if (c.b > n.along && c.a < n.along + 1000) gmax = Math.max(gmax, c.g);
  const sc = $('#steepChip');
  if (gmax >= 0.2) {
    sc.innerHTML = `<i class="slope-bar"></i>前方 1 km 最陡 <b class="mono">${Math.round(gmax * 100)}%</b>`;
    sc.classList.remove('hidden');
  } else sc.classList.add('hidden');
}
$('#nextCard').onclick = () => openSheet('routes');

/* ---------- 導航卡上的高度剖面（依坡度上色，標出目前位置） ---------- */
let profKey = '', profObj = null;
function updateProfile(n) {
  const box = $('#rtProfile');
  if (!route) { box.innerHTML = ''; profKey = ''; profObj = null; return; }
  const P = route.prep, len = P.length || 1, s = routeSlope(route), W = 330, H = 52;
  const key = route.id + (S.slopeColor !== false) + (s ? 1 : 0);
  if (profKey !== key || profObj !== route) {
    profKey = key; profObj = route;
    if (!s) {
      box.innerHTML = '<div class="progress"><i id="rtBar"></i></div>';
    } else {
      const e = s.ele; let mn = Infinity, mx = -Infinity;
      for (const v of e) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      const pad = (mx - mn) * 0.12 || 10, lo = mn - pad, hi = mx + pad;
      const X = a => (a / len * W).toFixed(1), Y = v => (H - (v - lo) / (hi - lo) * H).toFixed(1);
      const step = Math.max(1, Math.floor(e.length / 400));
      let areas = '', line = '';
      const parts = S.slopeColor !== false ? s.runs : [{ i0: 0, i1: e.length - 1, k: -1 }];
      for (const c of parts) {
        let d = `M${X(P.cum[c.i0])} ${H}`;
        for (let i = c.i0; i <= c.i1; i += (i + step <= c.i1 ? step : Math.max(1, c.i1 - i))) d += `L${X(P.cum[i])} ${Y(e[i])}`;
        d += `L${X(P.cum[c.i1])} ${Y(e[c.i1])}L${X(P.cum[c.i1])} ${H}Z`;
        areas += `<path d="${d}" fill="${c.k >= 0 ? SLOPE[c.k].c : '#2F6FDB'}" fill-opacity=".3" stroke="${c.k >= 0 ? SLOPE[c.k].c : '#2F6FDB'}" stroke-opacity=".3" stroke-width=".6"/>`;
      }
      for (let i = 0; i < e.length; i += step) line += (line ? 'L' : 'M') + X(P.cum[i]) + ' ' + Y(e[i]);
      line += 'L' + X(P.cum[e.length - 1]) + ' ' + Y(e[e.length - 1]);
      box.innerHTML = `<svg class="profile-nav" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${areas}
        <path d="${line}" fill="none" stroke="#2B3A31" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <path id="profDone" class="prof-done" d="M0 0H0V${H}H0Z"/>
        <line id="profMark" x1="-10" x2="-10" y1="0" y2="${H}" stroke="#2F6FDB" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
        <div class="prof-lbl mono"><span>${Math.round(mn)} m</span><span>最高 ${Math.round(mx)} m</span></div>`;
    }
  }
  const x = n ? n.along / len * W : -10;
  const mk = $('#profMark'), dn = $('#profDone');
  if (mk) { mk.setAttribute('x1', x); mk.setAttribute('x2', x); }
  if (dn) dn.setAttribute('d', n ? `M0 0H${x.toFixed(1)}V${H}H0Z` : `M0 0H0V${H}H0Z`);
  const bar = $('#rtBar'); if (bar) bar.style.width = n ? (n.frac * 100).toFixed(1) + '%' : '0%';
}
HOOKS.nav.push(updateNext, updateProfile);
HOOKS.fix.push(() => { $('#altMiniV').textContent = fix && fix.alt != null ? Math.round(fix.alt).toLocaleString() : '—'; });

/* ---------- 訊號標示：記錄中每 2 分鐘自動測一次能否連網 ---------- */
const SIG = { last: 0, ok: null, busy: false };
const sigLayer = L.layerGroup().addTo(map);       // 這次記錄
const sigHistLayer = L.layerGroup().addTo(map);   // 過去紀錄裡有訊號的地點
const sigRenderer = L.canvas ? L.canvas({ padding: 0.3 }) : undefined;
async function sigProbe() {
  if (!navigator.onLine) return false;
  const tryOne = async (u) => {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
    try { await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }); return true; }
    catch (e) { return false; } finally { clearTimeout(tm); }
  };
  return (await tryOne('https://www.gstatic.com/generate_204')) || (await tryOne('https://captive.apple.com/hotspot-detect.html'));
}
function sigMarker(p, layer) {
  const k = p[3];
  const m = L.circleMarker([p[0], p[1]], k === 2
    ? { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2F7A4D', fillOpacity: 1, renderer: sigRenderer }
    : k === 1 ? { radius: 4.5, color: '#fff', weight: 1.5, fillColor: '#3E9B62', fillOpacity: .95, renderer: sigRenderer }
      : { radius: 3.5, color: '#fff', weight: 1, fillColor: '#9AA59E', fillOpacity: .8, renderer: sigRenderer });
  if (k === 2 || k === 1) m.bindPopup(`<b>${k === 2 ? '這裡可通話' : '有手機訊號'}</b><br>${fmtDate(p[2])}${p[4] ? '<br>' + esc(p[4]) : ''}`);
  return m.addTo(layer);
}
async function sigTick(force) {
  if (!rec.on || !fix || SIG.busy) return;
  if (!force && Date.now() - SIG.last < 120000) return;
  SIG.busy = true; SIG.last = Date.now();
  try {
    const ok = await sigProbe();
    SIG.ok = ok;
    if (rec.on && fix) {
      const p = [+fix.lat.toFixed(6), +fix.lon.toFixed(6), Date.now(), ok ? 1 : 0];
      rec.sig = rec.sig || []; rec.sig.push(p);
      if (S.showSig !== false) sigMarker(p, sigLayer);
      persistSoon();
    }
  } finally { SIG.busy = false; renderSigChip(); }
}
function renderSigChip() {
  const c = $('#sigChip');
  if (!rec.on) { c.classList.add('hidden'); return; }
  c.classList.remove('hidden');
  c.className = 'chip-s glass ' + (SIG.ok === true ? 'sig-ok' : SIG.ok === false ? 'sig-no' : '');
  c.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 19v-3M10 19v-7M15 19v-11M20 19V4"/></svg>${SIG.ok === true ? '有訊號' : SIG.ok === false ? '無訊號' : '檢查訊號中'}`;
}
$('#sigChip').onclick = async () => {
  if (!rec.on || !fix) return;
  const v = await ask('標記訊號點', '把目前位置標記為「這裡可通話」？<br>之後在地圖上就看得到，下次走同一條路可以參考。',
    [{ label: '標記：這裡可通話', value: 1, cls: 'primary' }, { label: '重新檢查訊號', value: 2 }, { label: '取消', value: 0, cls: 'ghost' }]);
  if (v === 1 && rec.on && fix) {
    const p = [+fix.lat.toFixed(6), +fix.lon.toFixed(6), Date.now(), 2];
    rec.sig = rec.sig || []; rec.sig.push(p); sigMarker(p, sigLayer); persistRec(); toast('已標記：這裡可通話');
  }
  if (v === 2) sigTick(true);
};
setInterval(() => safe('sigTick', () => sigTick()), 5000);
HOOKS.fix.push(() => sigTick());
/* 記錄開始／結束時更新圖層 */
HOOKS.finish.push(() => { sigLayer.clearLayers(); SIG.ok = null; renderSigChip(); drawSigHist(); });
/* 開始或接續記錄：重畫這次記錄的訊號點 */
function recStartHook(resume) {
  sigLayer.clearLayers();
  if (S.showSig !== false) for (const p of rec.sig || []) sigMarker(p, sigLayer);
  renderSigChip();
}
/* 過去紀錄的訊號點：紀錄有變動（新增、刪除、還原、改名）才重新讀取 */
let sigHistCache = null, sigHistVer = -1, sigHistKey = '';
async function drawSigHist() {
  if (S.showSig === false || map.getZoom() < 12) { sigHistLayer.clearLayers(); sigHistKey = ''; return; }
  if (!sigHistCache || sigHistVer !== DB.ver.tracks) {
    const v = DB.ver.tracks, out = [];
    try { for (const t of await DB.all('tracks')) for (const p of t.sig || []) if (p[3] >= 1) out.push([p[0], p[1], p[2], p[3], t.name]); }
    catch (e) { logErr('sigHist', e); return; }
    sigHistCache = out; sigHistVer = v; sigHistKey = '';
  }
  const b = map.getBounds().pad(0.2), vis = [];
  for (const p of sigHistCache) { if (b.contains([p[0], p[1]])) { vis.push(p); if (vis.length >= 400) break; } }
  const key = map.getZoom() + ':' + vis.map(p => p[2]).join(',');
  if (key === sigHistKey) return;   // 畫面上的點沒變就不重畫（跟隨模式每秒都在移動地圖）
  sigHistKey = key; sigHistLayer.clearLayers();
  for (const p of vis) sigMarker(p, sigHistLayer);
}
map.on('moveend', () => safe('sigHist', drawSigHist));
/* 檢視歷史軌跡時，一起顯示它的訊號點 */
const _showTrack = showTrack;
showTrack = function (t, fit) { _showTrack(t, fit); if (S.showSig !== false) for (const p of t.sig || []) safe('sigView', () => sigMarker([...p, t.name], viewLayer)); };

/* ---------- 夜間模式：日落後自動切換，也可手動 ---------- */
function isNightNow() {
  const c = fix ? [fix.lat, fix.lon] : [map.getCenter().lat, map.getCenter().lng];
  const now = Date.now(), st = sunTimes(new Date(), c[0], c[1]);
  if (!st.set || !st.rise) return false;
  return now > st.set + 10 * 60e3 || now < st.rise - 10 * 60e3;
}
function applyNight() {
  const mode = S.night || 'auto';
  const on = mode === 'on' || (mode === 'auto' && isNightNow());
  document.body.classList.toggle('night', on);
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', on ? '#0E1310' : '#F5F3EE');
}
setInterval(() => safe('night', applyNight), 60000);

/* ---------- 圖層頁：地圖顯示選項 ---------- */
(() => {
  const orig = SHEETS.layers.render;
  SHEETS.layers.render = function (el) {
    orig.call(this, el);
    el.insertAdjacentHTML('beforeend', `
      <div class="section-t">地圖顯示</div>
      <div class="group">
        ${swRow('swSlope', '路線依坡度上色', '綠＜10%、黃 10–20%、橘 20–30%、紅＞30%', S.slopeColor !== false)}
        ${swRow('swPoi', '顯示地點', '山頂、三角點、山屋、水源、登山口（下載地圖時一併存下）', S.showPoi !== false)}
        ${swRow('swSig', '顯示訊號點', '綠點＝有手機訊號；大綠點＝標記可通話。含過去的紀錄', S.showSig !== false)}
      </div>
      <div class="section-t">夜間模式</div>
      ${seg('segNight', [['auto', '日落後自動'], ['on', '開'], ['off', '關']], S.night || 'auto')}
      <p class="note">夜間模式把畫面改成深色、紅色調，不刺眼也比較省電。</p>`);
    $('#swSlope').onchange = e => { S.slopeColor = e.target.checked; saveSettings(); if (route) { route._slope = undefined; setActiveRoute(route.id); } profKey = ''; };
    $('#swPoi').onchange = e => { S.showPoi = e.target.checked; saveSettings(); safe('poiLayer', () => drawPoiLayer()); };
    $('#swSig').onchange = e => { S.showSig = e.target.checked; saveSettings(); sigHistKey = ''; drawSigHist(); if (!S.showSig) sigLayer.clearLayers(); else if (rec.on) recStartHook(); };
    bindSeg('segNight', v => { S.night = v; saveSettings(); applyNight(); renderSheet(); });
  };
})();

HOOKS.start.push(() => { syncTopH(); applyNight(); renderSigChip(); drawSigHist(); });
