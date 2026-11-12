/* 離線地圖 — 紀錄：列表、統計、單筆詳情、3D 路線圖（v2.5） */
'use strict';

/* ---------- 計算 ---------- */
/* 移動時間：相鄰兩點水平速度 ≥ 0.15 m/s，或垂直速度 ≥ 3 m/分，且間隔不超過 10 分鐘，才算在移動 */
function movingTime(pts) {
  let ms = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a[3] == null || b[3] == null) continue;
    const dt = (b[3] - a[3]) / 1000;
    if (dt <= 0 || dt > 600) continue;
    const d = dist(a, b), dz = a[2] != null && b[2] != null ? Math.abs(b[2] - a[2]) : 0;
    if (d / dt >= 0.15 || (dz >= 8 && dz / dt >= 0.05)) ms += dt * 1000;
  }
  return ms;
}
const trkElapsed = t => Math.max(0, (t.end || t.start) - t.start);
const trkMoving = t => t.mov != null ? t.mov : trkElapsed(t);
/* 舊紀錄沒有移動時間：第一次打開時算好存起來 */
async function ensureMoving(list) {
  for (const t of list) {
    if (t.mov != null) continue;
    const hasT = t.pts && t.pts.length > 1 && t.pts[0][3] != null;
    t.mov = hasT ? Math.min(movingTime(t.pts), trkElapsed(t)) : trkElapsed(t);
    if (t.maxE == null && t.pts) { let m = null; for (const p of t.pts) if (p[2] != null) m = m == null ? p[2] : Math.max(m, p[2]); t.maxE = m; }
    DB.put('tracks', t).catch(() => {});
  }
}
function fmtHrMin(ms, html = true) {
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), mm = m % 60;
  if (!html) return h ? `${h} 小時 ${mm} 分` : `${mm} 分`;
  return h ? `${h.toLocaleString()}<small>時</small>${mm}<small>分</small>` : `${mm}<small>分</small>`;
}
const fmtInt = n => Math.round(n || 0).toLocaleString();
function sumUp(list) {
  const s = { n: list.length, mov: 0, ela: 0, dist: 0, up: 0, down: 0, maxE: null };
  for (const t of list) {
    s.mov += trkMoving(t); s.ela += trkElapsed(t); s.dist += t.dist || 0; s.up += t.up || 0; s.down += t.down || 0;
    if (t.maxE != null) s.maxE = s.maxE == null ? t.maxE : Math.max(s.maxE, t.maxE);
  }
  return s;
}

/* ---------- 期間 ---------- */
const now0 = new Date();
const RS = { y: now0.getFullYear(), m: now0.getMonth(), bucket: null };   // 目前看的年、月（0～11）、點選的長條
function inPeriod(t, per, y, m) {
  const d = new Date(t.start);
  if (per === 'all') return true;
  if (per === 'year') return d.getFullYear() === y;
  return d.getFullYear() === y && d.getMonth() === m;
}
function periodLabel(per) {
  if (per === 'all') return '全部時間';
  if (per === 'year') return `${RS.y} 年`;
  return `${RS.y} 年 ${RS.m + 1} 月`;
}
function shiftPeriod(per, k) {
  if (per === 'year') RS.y += k;
  else if (per === 'month') { const d = new Date(RS.y, RS.m + k, 1); RS.y = d.getFullYear(); RS.m = d.getMonth(); }
  RS.bucket = null;
}
/* 長條圖的分組：年→12 個月；月→每天；全部→每年 */
function buckets(per, list, all) {
  if (per === 'year') return Array.from({ length: 12 }, (_, i) => ({ key: i, lbl: String(i + 1), items: list.filter(t => new Date(t.start).getMonth() === i) }));
  if (per === 'month') {
    const days = new Date(RS.y, RS.m + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => ({ key: i + 1, lbl: String(i + 1), items: list.filter(t => new Date(t.start).getDate() === i + 1) }));
  }
  const ys = all.map(t => new Date(t.start).getFullYear());
  const y0 = Math.min(...ys, now0.getFullYear()), y1 = Math.max(...ys, now0.getFullYear());
  const out = [];
  for (let y = Math.max(y0, y1 - 9); y <= y1; y++) out.push({ key: y, lbl: String(y), items: list.filter(t => new Date(t.start).getFullYear() === y) });
  return out;
}
const METRICS = {
  n: { lbl: '次數', val: s => s.n, fmt: v => `${v} 次` },
  time: { lbl: '時間', val: s => s.mov / 3600000, fmt: v => `${v.toFixed(1)} 小時` },
  dist: { lbl: '距離', val: s => s.dist / 1000, fmt: v => `${v.toFixed(1)} km` },
  up: { lbl: '爬升', val: s => s.up, fmt: v => `${fmtInt(v)} m` },
};

function barChart(per, bs) {
  const mk = METRICS[S.trkMetric] ? S.trkMetric : 'dist', M = METRICS[mk];
  const vals = bs.map(b => M.val(sumUp(b.items)));
  const max = Math.max(...vals, 0);
  const W = 320, H = 120, n = bs.length, gap = n > 20 ? 2 : 5, bw = Math.min(40, (W - gap * (n - 1)) / n), x0 = (W - (bw * n + gap * (n - 1))) / 2;
  const nowKey = per === 'year' && RS.y === now0.getFullYear() ? now0.getMonth()
    : per === 'month' && RS.y === now0.getFullYear() && RS.m === now0.getMonth() ? now0.getDate()
    : per === 'all' ? now0.getFullYear() : null;
  let bars = '', lbls = '';
  bs.forEach((b, i) => {
    const v = vals[i], h = max ? Math.max(v ? 3 : 0, v / max * (H - 18)) : 0, x = x0 + i * (bw + gap);
    const sel = RS.bucket === b.key, dim = RS.bucket != null && !sel;
    bars += `<rect class="bar${sel ? ' sel' : ''}${dim ? ' dim' : ''}${b.key === nowKey ? ' now' : ''}" data-k="${b.key}" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}"/>`;
    bars += `<rect class="hit" data-k="${b.key}" x="${x.toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}"/>`;
    const show = per !== 'month' || i === 0 || (i + 1) % 5 === 0;
    if (show) lbls += `<span style="left:${((x + bw / 2) / W * 100).toFixed(2)}%">${b.lbl}</span>`;
  });
  const selB = bs.find(b => b.key === RS.bucket);
  const cap = selB ? `${per === 'year' ? selB.lbl + ' 月' : per === 'month' ? `${RS.m + 1}/${selB.lbl}` : selB.lbl + ' 年'}：${M.fmt(M.val(sumUp(selB.items)))}`
    : max ? `最高 ${M.fmt(max)}` : '這段期間沒有紀錄';
  return `<div class="chart-card">
    ${seg('segMetric', Object.entries(METRICS).map(([k, x]) => [k, x.lbl]), mk)}
    <div class="chart-cap">${cap}${selB ? ' <button class="link" id="btnClrBucket">顯示全部</button>' : ''}</div>
    <svg class="bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
    <div class="bar-lbls">${lbls}</div>
  </div>`;
}

/* ---------- 列表項目 ---------- */
const trkRow = t => `<button class="row trk-row" data-id="${t.id}">
    <div class="grow"><div class="t">${esc(t.name)}</div>
    <div class="s">${fmtDate(t.start).split(' ')[0]} · ${fmtKm(t.dist || 0)} km · ${fmtHrMin(trkMoving(t), false)} · ↑${fmtInt(t.up)} m</div></div>
    ${t.note && (t.note.text || (t.note.w || []).length || (t.note.c || []).length) ? '<span class="tag">有註記</span>' : ''}
    <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`;

function bindRows(el, list) {
  $$('.trk-row', el).forEach(b => b.onclick = () => { const t = list.find(x => x.id === b.dataset.id); if (t) openSheet('trackDetail', t); });
}

/* ---------- 紀錄（列表／統計） ---------- */
SHEETS.tracks = {
  title: '紀錄',
  async render(el) {
    const all = (await DB.all('tracks')).sort((a, b) => b.start - a.start);
    await ensureMoving(all);
    const view = S.trkView === 'stats' ? 'stats' : 'list';
    const top = seg('segTrkView', [['list', '列表'], ['stats', '統計']], view);
    if (!all.length) {
      el.innerHTML = top + `<div class="empty">還沒有紀錄<br>按下中間的「開始」鍵，就會開始記錄你的軌跡。</div>`;
    } else if (view === 'list') {
      el.innerHTML = top + `<div class="list-meta">共 ${all.length} 筆 · ${fmtKm(sumUp(all).dist)} km</div>
        <div class="group">${all.map(trkRow).join('')}</div>
        <button class="btn ghost block" id="btnHideTrack" style="margin-top:8px">清除地圖上顯示的軌跡</button>`;
      bindRows(el, all);
    } else {
      el.innerHTML = top + renderStats(all);
      bindStats(el, all);
    }
    bindSeg('segTrkView', v => { S.trkView = v; saveSettings(); renderSheet(); });
    const hb = $('#btnHideTrack'); if (hb) hb.onclick = () => { viewLayer.clearLayers(); toast('已清除'); };
  },
};

function renderStats(all) {
  const per = ['month', 'year', 'all'].includes(S.trkPeriod) ? S.trkPeriod : 'year';
  const list = all.filter(t => inPeriod(t, per, RS.y, RS.m));
  const s = sumUp(list);
  /* 和上一期比較 */
  let cmp = '';
  if (per !== 'all') {
    const py = per === 'year' ? RS.y - 1 : new Date(RS.y, RS.m - 1, 1).getFullYear();
    const pm = per === 'year' ? 0 : new Date(RS.y, RS.m - 1, 1).getMonth();
    const p = sumUp(all.filter(t => inPeriod(t, per, py, pm)));
    const dn = s.n - p.n, word = per === 'year' ? '去年' : '上個月';
    cmp = p.n || s.n ? `<span class="cmp ${dn > 0 ? 'up' : dn < 0 ? 'down' : ''}">比${word} ${dn > 0 ? '+' : ''}${dn} 次</span>` : '';
  }
  const bs = buckets(per, list, all);
  const shown = RS.bucket != null ? (bs.find(b => b.key === RS.bucket) || { items: [] }).items : list;
  /* 個人紀錄 */
  const best = (f, fmt, lbl) => {
    let t = null; for (const x of list) if (f(x) != null && (t == null || f(x) > f(t))) t = x;
    return t && f(t) > 0 ? `<button class="row pr-row" data-id="${t.id}"><div class="grow"><div class="t">${lbl}</div><div class="s">${esc(t.name)}</div></div><b class="mono">${fmt(f(t))}</b></button>` : '';
  };
  const prs = list.length > 1 ? [
    best(t => t.dist, v => fmtKm(v) + ' km', '最長距離'),
    best(t => t.up, v => fmtInt(v) + ' m', '最多爬升'),
    best(t => t.maxE, v => fmtInt(v) + ' m', '最高海拔'),
    best(trkMoving, v => fmtHrMin(v, false), '最長時間'),
  ].join('') : '';
  const listTitle = RS.bucket != null ? (per === 'year' ? `${RS.bucket + 1} 月` : per === 'month' ? `${RS.m + 1}/${RS.bucket}` : `${RS.bucket} 年`) : periodLabel(per);
  return `
    <div style="margin-top:12px">${seg('segPer', [['month', '月'], ['year', '年'], ['all', '全部']], per)}</div>
    <div class="per-nav">
      ${per !== 'all' ? '<button class="icon-btn" id="perPrev" aria-label="上一期"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>' : '<span></span>'}
      <b>${periodLabel(per)}</b>
      ${per !== 'all' ? '<button class="icon-btn" id="perNext" aria-label="下一期"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>' : '<span></span>'}
    </div>
    <div class="kpis">
      <div><span class="lbl">活動</span><b class="mono">${s.n}<small>次</small></b>${cmp}</div>
      <div><span class="lbl">移動時間</span><b class="mono">${fmtHrMin(s.mov)}</b><span class="sub">總經過 ${fmtHrMin(s.ela, false)}</span></div>
      <div><span class="lbl">距離</span><b class="mono">${fmtKm(s.dist)}<small>km</small></b><span class="sub">${s.n ? `平均每次 ${fmtKm(s.dist / s.n)} km` : ''}</span></div>
      <div><span class="lbl">總爬升</span><b class="mono">${fmtInt(s.up)}<small>m</small></b><span class="sub">下降 ${fmtInt(s.down)} m</span></div>
    </div>
    ${barChart(per, bs)}
    ${per === 'year' && list.length ? `<button class="year-btn" id="btnYear"><svg viewBox="0 0 24 24"><path d="m3 18 6-10 4 6 3-4 5 8Z"/></svg><span class="grow"><b>${RS.y} 年度回顧</b><small>做成一張圖卡，分享到 LINE、IG</small></span><svg viewBox="0 0 24 24" class="chev"><path d="m9 6 6 6-6 6"/></svg></button>` : ''}
    ${prs ? `<div class="section-t">個人紀錄 · ${periodLabel(per)}</div><div class="group">${prs}</div>` : ''}
    <div class="section-t">${listTitle} · ${shown.length} 筆</div>
    ${shown.length ? `<div class="group">${shown.map(trkRow).join('')}</div>` : '<div class="empty" style="padding:16px">這段期間沒有紀錄</div>'}`;
}
function bindStats(el, all) {
  bindSeg('segPer', v => { S.trkPeriod = v; saveSettings(); RS.bucket = null; renderSheet(); });
  bindSeg('segMetric', v => { S.trkMetric = v; saveSettings(); renderSheet(); });
  const pv = $('#perPrev'), nx = $('#perNext'), per = S.trkPeriod || 'year';
  if (pv) pv.onclick = () => { shiftPeriod(per, -1); renderSheet(); };
  if (nx) nx.onclick = () => { shiftPeriod(per, 1); renderSheet(); };
  $$('.bars .hit', el).forEach(r => r.onclick = () => { const k = +r.dataset.k; RS.bucket = RS.bucket === k ? null : k; renderSheet(); });
  const cb = $('#btnClrBucket'); if (cb) cb.onclick = () => { RS.bucket = null; renderSheet(); };
  bindRows(el, all);
  const yb = $('#btnYear'); if (yb) yb.onclick = () => safe('year', () => makeYearCard(RS.y));
  $$('.pr-row', el).forEach(b => b.onclick = () => { const t = all.find(x => x.id === b.dataset.id); if (t) openSheet('trackDetail', t); });
}

/* ---------- 單筆詳情 ---------- */
SHEETS.trackDetail = {
  title: t => t.name,
  render(el, t) {
    const P = prepRoute(t.pts);
    el.innerHTML = `
      <button class="back-link" id="tdBack"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>紀錄</button>
      <div class="coord-hero">
        <div class="s" style="color:var(--ink2);font-size:13px">${fmtDate(t.start)}${t.end ? ' – ' + fmtDate(t.end).split(' ')[1] : ''}${t.wpts?.length ? ` · ${t.wpts.length} 個航點` : ''}</div>
        <div class="kpis flat">
          <div><span class="lbl">移動時間</span><b class="mono">${fmtHrMin(trkMoving(t))}</b><span class="sub">總經過 ${fmtHrMin(trkElapsed(t), false)}</span></div>
          <div><span class="lbl">距離</span><b class="mono">${fmtKm(t.dist || 0)}<small>km</small></b></div>
          <div><span class="lbl">爬升／下降</span><b class="mono">${fmtInt(t.up)}<small>/</small>${fmtInt(t.down)}<small>m</small></b></div>
          <div><span class="lbl">最高海拔</span><b class="mono">${t.maxE != null ? fmtInt(t.maxE) + '<small>m</small>' : '—'}</b></div>
        </div>
        ${profileSVG(t.pts, P.cum)}
      </div>
      <div class="btn-row"><button class="btn primary" id="tdShow">在地圖上顯示</button><button class="btn" id="td3d">${ICON3D}3D 路線圖</button></div>
      <div class="btn-row"><button class="btn" id="tdExp">${ICON.share}匯出 GPX</button><button class="btn" id="tdRoute">當作路線</button></div>
      <div class="btn-row"><button class="btn" id="tdRen">改名</button><button class="btn" id="tdDel" style="color:var(--danger)">刪除</button></div>`;
    $('#tdBack').onclick = () => openSheet('tracks');
    $('#tdShow').onclick = () => { showTrack(t); closeSheet(); };
    $('#td3d').onclick = () => open3D(t);
    $('#tdExp').onclick = () => shareFile(safeName(t.name) + '.gpx', toGPX(t.name, t.pts, t.wpts));
    $('#tdRoute').onclick = async () => {
      const R = prepRoute(t.pts);
      await DB.put('routes', { id: uid(), name: t.name, pts: t.pts.map(p => [p[0], p[1], p[2]]), wpts: t.wpts || [], created: Date.now(), length: R.length, up: R.up });
      toast('已加入路線清單');
    };
    $('#tdRen').onclick = async () => { const v = await askText('重新命名', t.name); if (v) { t.name = v; await DB.put('tracks', t); renderSheet(); } };
    $('#tdDel').onclick = async () => {
      if (await ask('刪除軌跡？', esc(t.name), [{ label: '刪除', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }])) {
        await DB.del('tracks', t.id); viewLayer.clearLayers(); openSheet('tracks');
      }
    };
  },
};
const ICON3D = '<svg viewBox="0 0 24 24"><path d="m3 18 6-10 4 6 3-4 5 8Z"/><path d="M9 8 7.5 5.5"/></svg>';

/* 結束記錄後的摘要也加上 3D */
(() => {
  const orig = SHEETS.trackDone.render;
  SHEETS.trackDone.render = function (el, t) {
    orig.call(this, el, t);
    const ok = $('#tdOk');
    if (ok) { const b = document.createElement('button'); b.className = 'btn'; b.innerHTML = ICON3D + '3D'; b.onclick = () => open3D(t); ok.parentNode.insertBefore(b, ok); }
  };
})();

/* ---------- 3D 路線圖（MapLibre，需連網） ---------- */
let ml = null, mlLoading = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  if (mlLoading) return mlLoading;
  mlLoading = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/maplibre-gl.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'vendor/maplibre-gl.js';
    s.onload = () => res(); s.onerror = () => { mlLoading = null; rej(new Error('無法載入 3D 元件')); };
    document.head.appendChild(s);
  });
  return mlLoading;
}
const BASE3D = {
  topo: { name: '地形圖', tiles: () => [LAYERS.rudy.url], max: 18, attr: '魯地圖 Rudy Map © OSM contributors' },
  photo: { name: '衛星', tiles: () => ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], max: 18, attr: 'Imagery © Esri, Maxar' },
  otm: { name: '國外地形', tiles: () => ['https://tile.opentopomap.org/{z}/{x}/{y}.png'], max: 17, attr: '© OpenTopoMap © OSM' },
};
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function trackGeo(pts) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[0]]) } }; }
const ptGeo = c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } });

async function open3D(t) {
  if (!t.pts || t.pts.length < 2) { toast('這筆紀錄的點太少，無法顯示 3D'); return; }
  if (!navigator.onLine) { toast('3D 路線圖需要網路，請在有訊號的地方再打開', 3500); return; }
  const box = $('#v3d');
  box.classList.remove('hidden'); document.body.classList.add('v3d-on');
  $('#v3dName').textContent = t.name;
  $('#v3dMsg').textContent = '載入中…'; $('#v3dMsg').classList.remove('hidden');
  try { await loadMapLibre(); } catch (e) { $('#v3dMsg').textContent = e.message + '，請確認網路後再試一次'; return; }
  if (ml) { ml.remove(); ml = null; }
  v3d.ready = false;
  const inTW = t.pts.some(p => p[1] > 118 && p[1] < 123 && p[0] > 21 && p[0] < 27);
  let baseKey = S.base3d && BASE3D[S.base3d] ? S.base3d : (inTW ? 'topo' : 'otm');
  const P = prepRoute(t.pts), cum = P.cum, total = cum[cum.length - 1] || 1;
  const lons = t.pts.map(p => p[1]), lats = t.pts.map(p => p[0]);
  const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  const style = {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: BASE3D[baseKey].tiles(), tileSize: 256, maxzoom: BASE3D[baseKey].max, attribution: BASE3D[baseKey].attr },
      dem: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Terrain © Mapzen / AWS' },
      trk: { type: 'geojson', data: trackGeo(t.pts) },
      done: { type: 'geojson', data: trackGeo(t.pts.slice(0, 1).concat(t.pts.slice(0, 1))) },
      se: { type: 'geojson', data: { type: 'FeatureCollection', features: [
        Object.assign(ptGeo([t.pts[0][1], t.pts[0][0]]), { properties: { k: 's' } }),
        Object.assign(ptGeo([t.pts[t.pts.length - 1][1], t.pts[t.pts.length - 1][0]]), { properties: { k: 'e' } })] } },
      me: { type: 'geojson', data: ptGeo([t.pts[0][1], t.pts[0][0]]) },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#2a3a30' } },
      { id: 'trk-casing', type: 'line', source: 'trk', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 } },
      { id: 'trk', type: 'line', source: 'trk', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#E08A2C', 'line-width': 4 } },
      { id: 'done', type: 'line', source: 'done', layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' }, paint: { 'line-color': '#C4533A', 'line-width': 5 } },
      { id: 'se', type: 'circle', source: 'se', paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'k'], 's', '#3E9B62', '#C4533A'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } },
      { id: 'me', type: 'circle', source: 'me', layout: { visibility: 'none' }, paint: { 'circle-radius': 8, 'circle-color': '#2F6FDB', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } },
    ],
  };
  ml = new maplibregl.Map({
    container: 'v3dMap', style, bounds, fitBoundsOptions: { padding: 50 },
    pitch: 60, maxPitch: 80, attributionControl: false, fadeDuration: 0,
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
  });
  ml.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  ml.touchPitch.enable();
  let tileErr = 0;
  ml.on('error', e => { if (++tileErr === 8) toast('部分地圖或地形載入失敗，請確認網路', 3000); });
  ml.on('load', () => {
    ml.setTerrain({ source: 'dem', exaggeration: S.exag3d || 1.3 });
    ml.fitBounds(bounds, { padding: 60, pitch: 60, bearing: -20, duration: 0 });
    $('#v3dMsg').classList.add('hidden');
    v3d.ready = true;
    const at = $('#v3dMap .maplibregl-ctrl-attrib'); if (at) at.classList.remove('maplibregl-compact-show');
  });
  v3d.t = t; v3d.cum = cum; v3d.total = total; v3d.bounds = bounds; v3d.base = baseKey; v3d.prog = 0; stopReplay();
  renderV3dBar();
}

/* 重播：沿著軌跡飛一遍 */
const v3d = { t: null, ready: false, playing: false, prog: 0, raf: 0, last: 0, speed: 1, brg: null };
function posAt(dm) {
  const { t, cum } = v3d; let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < dm) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo), a = t.pts[i - 1], b = t.pts[i], seg_ = (cum[i] - cum[i - 1]) || 1, f = Math.min(1, Math.max(0, (dm - cum[i - 1]) / seg_));
  return { i, ll: [a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f], ele: a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * f : (a[2] ?? b[2]), tm: a[3] != null && b[3] != null ? a[3] + (b[3] - a[3]) * f : null };
}
function replayFrame(ts) {
  if (!v3d.playing || !ml) return;
  const dt = v3d.last ? Math.min(100, ts - v3d.last) : 16; v3d.last = ts;
  const dur = Math.min(60000, Math.max(20000, v3d.total / 1000 * 2500)) / v3d.speed;   // 約每公里 2.5 秒，20～60 秒
  v3d.prog = Math.min(1, v3d.prog + dt / dur);
  applyReplay(true);
  if (v3d.prog >= 1) { v3d.playing = false; renderV3dBar(); return; }
  v3d.raf = requestAnimationFrame(replayFrame);
}
function applyReplay(moveCam) {
  const dm = v3d.prog * v3d.total, p = posAt(dm), ahead = posAt(Math.min(v3d.total, dm + Math.max(150, v3d.total * 0.03)));
  ml.getSource('me').setData(ptGeo(p.ll));
  ml.getSource('done').setData(trackGeo(v3d.t.pts.slice(0, p.i).concat([[p.ll[1], p.ll[0]]])));
  ml.setLayoutProperty('me', 'visibility', 'visible'); ml.setLayoutProperty('done', 'visibility', 'visible');
  if (moveCam) {
    let b = bearing([p.ll[1], p.ll[0]], [ahead.ll[1], ahead.ll[0]]);
    if (v3d.brg == null) v3d.brg = b; else v3d.brg = (v3d.brg + angDiff(v3d.brg, b) * 0.04 + 360) % 360;
    /* 鏡頭的焦點要放在地面高度，否則在高山上鏡頭會鑽到山裡 */
    const e = ml.queryTerrainElevation(p.ll);
    if (e != null) v3d.ce = v3d.ce == null ? e : v3d.ce + (e - v3d.ce) * 0.12;
    ml.jumpTo({ center: p.ll, bearing: v3d.brg, pitch: 62, zoom: Math.max(13.2, Math.min(15, ml.getZoom())), ...(v3d.ce != null ? { elevation: v3d.ce } : {}) });
  }
  const tm = p.tm != null ? fmtDur(p.tm - v3d.t.start) : '';
  $('#v3dInfo').innerHTML = `<span>${fmtKm(dm)} km</span>${p.ele != null ? `<span>海拔 ${Math.round(p.ele)} m</span>` : ''}${tm ? `<span>${tm}</span>` : ''}`;
  $('#v3dSlider').value = Math.round(v3d.prog * 1000);
}
function startReplay() {
  if (!ml || !v3d.ready) { toast('地圖還在載入'); return; }
  if (v3d.prog >= 1) v3d.prog = 0;
  if (v3d.prog === 0) { v3d.brg = null; v3d.ce = null; ml.jumpTo({ zoom: 14.2 }); }
  v3d.playing = true; v3d.last = 0; renderV3dBar();
  v3d.raf = requestAnimationFrame(replayFrame);
}
function stopReplay() { v3d.playing = false; cancelAnimationFrame(v3d.raf); renderV3dBar(); }
function renderV3dBar() {
  $('#v3dPlay').innerHTML = v3d.playing
    ? '<svg viewBox="0 0 24 24"><rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5L8 5.5Z"/></svg>';
  $('#v3dSpeed').textContent = v3d.speed + '×';
  $$('#v3dBase button').forEach(b => b.classList.toggle('on', b.dataset.v === v3d.base));
}
function close3D() {
  stopReplay();
  if (ml) { ml.remove(); ml = null; }
  $('#v3d').classList.add('hidden'); document.body.classList.remove('v3d-on');
}
function setBase3D(k) {
  if (!BASE3D[k]) return;
  v3d.base = k; S.base3d = k; saveSettings();
  if (!ml || !v3d.ready) { renderV3dBar(); return; }
  v3d.base = k; S.base3d = k; saveSettings();
  const B = BASE3D[k];
  ml.removeLayer('base'); ml.removeSource('base');
  ml.addSource('base', { type: 'raster', tiles: B.tiles(), tileSize: 256, maxzoom: B.max, attribution: B.attr });
  ml.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'hill');
  renderV3dBar();
}
(function init3D() {
  const box = document.createElement('div');
  box.id = 'v3d'; box.className = 'v3d hidden';
  box.innerHTML = `
    <div id="v3dMap" class="v3d-map"></div>
    <div class="v3d-top">
      <button class="fab glass" id="v3dClose" aria-label="關閉"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="v3d-title glass"><b id="v3dName"></b><span>雙指旋轉、上下拖曳改變傾斜</span></div>
      <button class="fab glass" id="v3dReset" aria-label="回到全景"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div id="v3dMsg" class="v3d-msg glass hidden"></div>
    <div class="v3d-bottom glass">
      <div class="seg" id="v3dBase">${Object.entries(BASE3D).map(([k, B]) => `<button data-v="${k}">${B.name}</button>`).join('')}</div>
      <div class="v3d-info mono" id="v3dInfo"><span>按播放鍵，沿著路線飛一遍</span></div>
      <div class="v3d-ctl">
        <button class="v3d-play" id="v3dPlay" aria-label="播放"></button>
        <input type="range" id="v3dSlider" min="0" max="1000" value="0">
        <button class="mini" id="v3dSpeed">1×</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  $('#v3dClose').onclick = close3D;
  $('#v3dReset').onclick = () => { stopReplay(); if (ml && v3d.bounds) ml.fitBounds(v3d.bounds, { padding: 60, pitch: 60, bearing: -20, duration: 1200 }); };
  $('#v3dPlay').onclick = () => v3d.playing ? stopReplay() : startReplay();
  $('#v3dSpeed').onclick = () => { v3d.speed = v3d.speed === 1 ? 2 : v3d.speed === 2 ? 4 : 1; renderV3dBar(); };
  $('#v3dSlider').oninput = e => { if (!ml || !v3d.ready) return; stopReplay(); v3d.prog = e.target.value / 1000; v3d.brg = null; v3d.ce = null; applyReplay(true); };
  $$('#v3dBase button').forEach(b => b.onclick = () => setBase3D(b.dataset.v));
})();
