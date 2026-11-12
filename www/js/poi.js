/* 離線地圖 — 離線地點（v3）：下載地圖時一併存下 OSM 的山頂、三角點、山屋、水源、登山口等，可離線搜尋 */
'use strict';

const POI_KIND = {
  peak: { n: '山頂', c: '#3F5A4C', ic: '<path d="m3 19 7-12 4 6 2-3 5 9Z"/>', pri: 0 },
  survey: { n: '三角點', c: '#6B5B3E', ic: '<path d="M12 4 20 19H4Z"/><circle cx="12" cy="14" r="1.6"/>', pri: 1 },
  hut: { n: '山屋', c: '#8A5A12', ic: '<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/>', pri: 2 },
  water: { n: '水源', c: '#2F6FDB', ic: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>', pri: 3 },
  trailhead: { n: '登山口', c: '#2F7A4D', ic: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>', pri: 4 },
  camp: { n: '營地', c: '#7A4E9B', ic: '<path d="M3 20 12 5l9 15Z"/><path d="M12 20v-6"/>', pri: 5 },
  shelter: { n: '涼亭／避難處', c: '#8A5A12', ic: '<path d="M3 10 12 5l9 5"/><path d="M6 10v9M18 10v9"/>', pri: 6 },
  toilet: { n: '廁所', c: '#5E6B63', ic: '<path d="M8 4v16M16 4v16M5 9h6M13 9h6"/>', pri: 7 },
  parking: { n: '停車場', c: '#3E5A8C', ic: '<path d="M7 20V4h6a4 4 0 0 1 0 8H7"/>', pri: 8 },
  mine: { n: '我的航點', c: '#E07B26', ic: '<circle cx="12" cy="10" r="3"/><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z"/>', pri: 9 },
};
const poiSvg = k => `<svg viewBox="0 0 24 24">${(POI_KIND[k] || POI_KIND.mine).ic}</svg>`;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

function poiKindOf(t) {
  if (t.natural === 'peak' || t.natural === 'volcano') return 'peak';
  if (t.man_made === 'survey_point') return 'survey';
  if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut' || (t.amenity === 'shelter' && /hut|basic_hut/.test(t.shelter_type || ''))) return 'hut';
  if (t.natural === 'spring' || t.amenity === 'drinking_water' || t.amenity === 'water_point' || t.man_made === 'water_tap') return 'water';
  if (t.highway === 'trailhead') return 'trailhead';
  if (t.tourism === 'camp_site') return 'camp';
  if (t.amenity === 'shelter') return 'shelter';
  if (t.amenity === 'toilets') return 'toilet';
  if (t.amenity === 'parking') return 'parking';
  return null;
}
function areaBox(a) { return a.kind === 'bbox' ? a.bounds : a.bbox; }   // [s,w,n,e]
async function fetchPois(box) {
  const [s, w, n, e] = box.map(v => +v.toFixed(5));
  const bb = `(${s},${w},${n},${e})`, big = (n - s) * (e - w) > 0.25;
  const q = `[out:json][timeout:90];(node["natural"~"^(peak|volcano)$"]${bb};node["man_made"="survey_point"]${bb};` +
    `nwr["tourism"~"^(alpine_hut|wilderness_hut|camp_site)$"]${bb};nwr["amenity"="shelter"]${bb};` +
    `node["natural"="spring"]${bb};nwr["amenity"~"^(drinking_water|water_point)$"]${bb};node["man_made"="water_tap"]${bb};` +
    `node["highway"="trailhead"]${bb};${big ? '' : `nwr["amenity"~"^(parking|toilets)$"]${bb};`});out center tags 6000;`;
  let lastErr = null;
  const t0 = Date.now();
  for (const url of OVERPASS) {
    if (Date.now() - t0 > 150000) break;   // 總共最多等約 2.5 分鐘
    try {
      const j = await netFetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), timeout: 90000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!j || !Array.isArray(j.elements)) throw new Error('回應格式不對');
      const out = [], per = {};
      for (const el of j.elements) {
        const t = el.tags || {}, k = poiKindOf(t);
        if (!k) continue;
        const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const name = t['name:zh-Hant'] || t['name:zh'] || t.name || '';
        if (!name && k === 'peak') continue;
        per[k] = (per[k] || 0) + 1;
        if ((k === 'parking' || k === 'toilet') && per[k] > 600) continue;
        const ele = parseFloat(t.ele);
        out.push({ id: el.type[0] + el.id, k, n: name, lat: +lat.toFixed(6), lon: +lon.toFixed(6), e: isFinite(ele) ? Math.round(ele) : null,
          x: k === 'water' && t.seasonal === 'yes' ? '季節性' : k === 'survey' && t.ref ? `編號 ${t.ref}` : '' });
      }
      return out;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('地點伺服器沒有回應');
}

/* ---------- 記憶體索引 ---------- */
const POI = { items: [], byId: new Map(), loaded: false };
async function poiLoad() {
  POI.items = []; POI.byId.clear();
  let ids = (await DB.kvGet('poiAreas')) || [];
  const exist = new Set((await DB.all('areas')).map(a => a.id));
  const gone = ids.filter(id => !exist.has(id));
  if (gone.length && !POI.busy) {   // 已刪除或重新下載的區域：清掉舊的地點資料
    for (const id of gone) await DB.kvDel('poi_' + id).catch(() => {});
    ids = ids.filter(id => exist.has(id)); await DB.kvSet('poiAreas', ids);
  }
  for (const id of ids) {
    const d = await DB.kvGet('poi_' + id);
    if (!d) continue;
    for (const p of d.items || []) if (!POI.byId.has(p.id)) { POI.byId.set(p.id, p); POI.items.push(p); }
  }
  POI.loaded = true;
}
async function poiSaveArea(area, items) {
  await DB.kvSet('poi_' + area.id, { t: Date.now(), items });
  const ids = new Set((await DB.kvGet('poiAreas')) || []); ids.add(area.id);
  await DB.kvSet('poiAreas', [...ids]);
  area.poiN = items.length; area.poiT = Date.now();
  await DB.put('areas', area);
}
async function poiForArea(area, quiet) {
  if (!navigator.onLine) { if (!quiet) toast('目前離線，連上網路後再下載地點'); return; }
  if (POI.busy) { if (!quiet) toast('地點資料下載中，請稍候'); return; }
  POI.busy = area.id;
  if (sheetName === 'download') renderSheet();
  try {
    const items = await fetchPois(areaBox(area));
    if (!(await DB.get('areas', area.id))) return;   // 下載期間區域已被刪除：不要讓它復活
    await poiSaveArea(area, items);
    await poiLoad(); drawPoiLayer();
    toast(`「${area.name}」已存下 ${items.length} 個地點，可離線搜尋`, 3500);
  } catch (e) {
    logErr('poi', e);
    if (!quiet) toast('地點資料下載失敗：' + (e.message || e) + '。可稍後在「下載」頁重試', 4500);
    else toast('地圖已下載；地點資料暫時抓不到，可稍後在「下載」頁按「下載地點」', 4500);
  } finally { POI.busy = null; if (sheetName === 'download') renderSheet(); }
}
/* 下載地圖完成後，自動接著下載該區的地點 */
const _finishDownload = finishDownload;
finishDownload = async function (area) {
  await _finishDownload(area);
  if (area.count > 0 && !dl.cancel) safe('poiAuto', () => poiForArea(area, true));
};
const _deleteArea = deleteArea;
deleteArea = async function (id) {
  await _deleteArea(id);
  try {
    await DB.kvDel('poi_' + id);
    const ids = ((await DB.kvGet('poiAreas')) || []).filter(x => x !== id);
    await DB.kvSet('poiAreas', ids); await poiLoad(); drawPoiLayer();
  } catch (e) { logErr('poiDel', e); }
};
/* 「下載」頁：每個區域顯示地點數量與補抓按鈕 */
(() => {
  const orig = SHEETS.download.render;
  SHEETS.download.render = async function (el, arg) {
    await orig.call(this, el, arg);
    const areas = await DB.all('areas');
    $$('[data-id]', el).forEach(row => {
      const a = areas.find(x => x.id === row.dataset.id); if (!a) return;
      const acts = row.querySelector('.acts'); if (!acts) return;
      const s = document.createElement('div'); s.className = 's';
      s.textContent = POI.busy === a.id ? '地點資料下載中…（約需 30 秒～1 分鐘）' : a.poiN != null ? `地點 ${a.poiN.toLocaleString()} 個（山頂、水源、山屋…）` : '尚未下載地點資料';
      acts.before(s);
      if (POI.busy !== a.id) {
        const b = document.createElement('button'); b.className = 'mini'; b.textContent = a.poiN != null ? '更新地點' : '下載地點';
        b.onclick = () => poiForArea(a); acts.insertBefore(b, acts.lastElementChild);
      }
    });
  };
})();

/* ---------- 地圖上的地點圖示 ---------- */
const poiLayer = L.layerGroup().addTo(map);
let poiT = null;
let poiKey = '';
function drawPoiLayer() {
  const z = map.getZoom();
  if (S.showPoi === false || !POI.items.length || z < 13) { poiLayer.clearLayers(); poiKey = ''; return; }
  const b = map.getBounds().pad(0.1);
  const vis = POI.items.filter(p => b.contains([p.lat, p.lon]) && (z >= 15 || !['parking', 'toilet', 'shelter'].includes(p.k)))
    .sort((a, c) => POI_KIND[a.k].pri - POI_KIND[c.k].pri).slice(0, 220);
  const key = z + ':' + POI.items.length + ':' + vis.map(p => p.id).join(',');
  if (key === poiKey) return;   // 畫面上的地點沒變就不重畫
  poiKey = key; poiLayer.clearLayers();
  for (const p of vis) {
    const K = POI_KIND[p.k], showName = p.n && (z >= 15 || p.k === 'peak' || p.k === 'hut');
    L.marker([p.lat, p.lon], { keyboard: false, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<div class="poi" style="--pc:${K.c}">${poiSvg(p.k)}${showName ? `<span>${esc(p.n)}${p.e != null && p.k === 'peak' ? ` <i>${p.e}</i>` : ''}</span>` : ''}</div>` }) })
      .bindPopup(poiPopup(p)).addTo(poiLayer);
  }
}
function poiPopup(p) {
  const K = POI_KIND[p.k] || POI_KIND.mine;
  let d = '';
  if (fix) { const m = dist([fix.lat, fix.lon], [p.lat, p.lon]); d = `<br>距離 ${fmtDist(m)}，在你的${dirName(bearing([fix.lat, fix.lon], [p.lat, p.lon]))}方`; }
  return `<b>${esc(p.n || K.n)}</b><br>${K.n}${p.e != null ? ` · 海拔 ${p.e} m` : ''}${p.x ? ` · ${esc(p.x)}` : ''}${d}`;
}
map.on('moveend', () => { clearTimeout(poiT); poiT = setTimeout(() => safe('poiLayer', drawPoiLayer), 150); });

/* ---------- 搜尋 ---------- */
const searchLayer = L.layerGroup().addTo(map);
const SR = { q: '', kind: '' };
let mySpotsCache = null, mySpotsVer = '';
async function mySpots() {
  const v = DB.ver.routes + '/' + DB.ver.tracks;
  if (mySpotsCache && mySpotsVer === v) return mySpotsCache;
  const out = [];
  for (const r of await DB.all('routes')) for (const w of r.wpts || []) out.push({ id: 'rw' + r.id + w.lat + w.lon, k: 'mine', n: w.name, lat: w.lat, lon: w.lon, e: w.ele != null ? Math.round(w.ele) : null, x: `路線：${r.name}` });
  for (const t of await DB.all('tracks')) {
    for (const w of t.wpts || []) out.push({ id: 'tw' + t.id + w.lat + w.lon, k: 'mine', n: w.name, lat: w.lat, lon: w.lon, e: w.ele != null ? Math.round(w.ele) : null, x: `紀錄：${t.name}` });
    for (const p of t.sig || []) if (p[3] === 2) out.push({ id: 'sg' + t.id + p[2], k: 'mine', n: '可通話地點', lat: p[0], lon: p[1], e: null, x: `紀錄：${t.name}` });
  }
  mySpotsCache = out; mySpotsVer = v;
  return out;
}
SHEETS.search = {
  title: '搜尋地點',
  async render(el) {
    if (!POI.loaded) await poiLoad();
    const mine = await mySpots();
    const kinds = ['peak', 'survey', 'hut', 'water', 'trailhead', 'camp', 'parking', 'toilet', 'mine'];
    el.innerHTML = `
      <label class="search-in"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input type="search" id="srQ" placeholder="山名、水源、山屋、航點名稱" value="${esc(SR.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="chips-row">${kinds.map(k => `<button class="chip-k ${SR.kind === k ? 'on' : ''}" data-k="${k}" style="--pc:${POI_KIND[k].c}">${poiSvg(k)}${POI_KIND[k].n}</button>`).join('')}</div>
      <div id="srList"></div>`;
    const all = POI.items.concat(mine);
    const draw = () => {
      const o = fix ? [fix.lat, fix.lon] : [map.getCenter().lat, map.getCenter().lng];
      const q = SR.q.trim().toLowerCase();
      let list = all.filter(p => (!SR.kind || p.k === SR.kind) &&
        (!q || (p.n || '').toLowerCase().includes(q) || POI_KIND[p.k].n.includes(q) || (p.x || '').toLowerCase().includes(q)));
      list = list.map(p => ({ p, d: dist(o, [p.lat, p.lon]) })).sort((a, b) => a.d - b.d).slice(0, 60);
      $('#srList').innerHTML = !all.length ? `<div class="empty">還沒有地點資料<br>下載離線地圖時會一併存下該區的山頂、三角點、山屋、水源、登山口。已下載過的區域，可到「下載」頁按「下載地點」。</div>`
        : !list.length ? '<div class="empty" style="padding:18px">找不到符合的地點</div>'
          : `<div class="section-t">${fix ? '依距離你的遠近排序' : '依距離地圖中心排序'} · 不需網路</div><div class="group">${list.map(({ p, d }) => `
            <button class="row poi-row" data-pid="${esc(p.id)}">
              <span class="poi-ic" style="--pc:${POI_KIND[p.k].c}">${poiSvg(p.k)}</span>
              <span class="grow"><span class="t">${esc(p.n || POI_KIND[p.k].n)}</span><span class="s">${POI_KIND[p.k].n}${p.e != null ? ` · ${p.e.toLocaleString()} m` : ''}${p.x ? ' · ' + esc(p.x) : ''}</span></span>
              <span class="poi-d"><b class="mono">${fmtDist(d)}</b><small>${dirName(bearing(o, [p.lat, p.lon]))}</small></span>
            </button>`).join('')}</div>`;
      $$('.poi-row', el).forEach(b => b.onclick = () => {
        const p = all.find(x => x.id === b.dataset.pid); if (!p) return;
        closeSheet(); setFollow(false); searchLayer.clearLayers();
        const K = POI_KIND[p.k];
        L.marker([p.lat, p.lon], { zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
          html: `<div class="poi poi-hit" style="--pc:${K.c}">${poiSvg(p.k)}</div>` }) }).bindPopup(poiPopup(p)).addTo(searchLayer).openPopup();
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15));
      });
    };
    draw();
    $('#srQ').oninput = e => { SR.q = e.target.value; draw(); };
    $$('.chip-k', el).forEach(b => b.onclick = () => { SR.kind = SR.kind === b.dataset.k ? '' : b.dataset.k; $$('.chip-k', el).forEach(x => x.classList.toggle('on', x.dataset.k === SR.kind)); draw(); });
    setTimeout(() => { const i = $('#srQ'); if (i && !SR.kind) i.focus(); }, 320);
  },
};
$('#searchBar').onclick = () => openSheet('search');
$('#btnSearchFab').onclick = () => openSheet('search');
HOOKS.start.push(async () => { await poiLoad(); drawPoiLayer(); });
