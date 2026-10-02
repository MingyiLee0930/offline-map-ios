/* 離線地圖 — 主程式 */
'use strict';
const $ = s => document.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ICON = {
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  msg: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
};

/* ---------- 小工具：提示與對話框 ---------- */
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function ask(title, msg, buttons) {
  return new Promise(res => {
    $('#dlgTitle').textContent = title; $('#dlgMsg').innerHTML = msg;
    const a = $('#dlgActions'); a.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn block ' + (b.cls || ''); el.textContent = b.label;
      el.onclick = () => {
        const inp = $('#dlgMsg input');
        $('#dialog').classList.add('hidden');
        res(b.value === '__input' ? (inp ? inp.value.trim() : '') : b.value);
      };
      a.appendChild(el);
    }
    $('#dialog').classList.remove('hidden');
  });
}
const askText = (title, value, ok = '確定') => ask(title, `<input type="text" value="${esc(value)}">`,
  [{ label: ok, value: '__input', cls: 'primary' }, { label: '取消', value: null, cls: 'ghost' }]);

/* ---------- 地圖 ---------- */
const map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 3, maxZoom: 19, zoomSnap: 1 })
  .setView([S.view[0], S.view[1]], S.view[2]);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
let base = null;
/* 原生 App：已下載的圖磚直接讀手機檔案，沒有才連網 */
const OfflineTileLayer = L.TileLayer.extend({
  getTileUrl(c) {
    const key = tileKey(this.options.layerKey, this._getZoomForUrl(), c.x, c.y);
    return NT.index.has(key) ? NT.src(key) : L.TileLayer.prototype.getTileUrl.call(this, c);
  },
});
function setLayer(key) {
  const d = layerDef(key);
  if (!d.url) { toast('請先在「設定」填入自訂圖層網址'); return false; }
  if (base) map.removeLayer(base);
  const opts = { maxNativeZoom: d.maxNative, maxZoom: 19, attribution: d.attr, keepBuffer: 3, layerKey: key };
  base = (NATIVE ? new OfflineTileLayer(d.url, opts) : L.tileLayer(d.url, opts)).addTo(map);
  base.bringToBack();
  S.layer = key; saveSettings();
  return true;
}
map.on('moveend', () => {
  const c = map.getCenter();
  S.view = [+c.lat.toFixed(5), +c.lng.toFixed(5), map.getZoom()]; saveSettings();
});

const routeLayer = L.layerGroup().addTo(map);   // 導航路線
const viewLayer = L.layerGroup().addTo(map);    // 檢視中的歷史軌跡 / 區域
const pinIcon = cls => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });

/* ---------- 跟隨模式 ---------- */
let follow = false;
const setFollow = v => { follow = v; $('#btnLocate').classList.toggle('on', v); };
map.on('dragstart', () => follow && setFollow(false));
$('#btnLocate').onclick = () => {
  requestCompass();
  setFollow(true);
  if (fix) map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 15));
  else toast('正在取得 GPS 定位…');
};

/* ---------- GPS ---------- */
let fix = null, meMarker = null, accCircle = null;
const meIcon = L.divIcon({ className: '', html: '<div class="me-wrap"><div class="me-cone"></div><div class="me-dot"></div></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
/* 原生 App：背景定位外掛。bg=true 時鎖定螢幕、切到其他 App 仍持續定位 */
let gpsWatcher = null, gpsBg = null, permAsked = false;
async function nativeWatch(bg) {
  if (gpsBg === bg && gpsWatcher) return;
  const BG = NP.BackgroundGeolocation;
  if (gpsWatcher) { try { await BG.removeWatcher({ id: gpsWatcher }); } catch (e) {} gpsWatcher = null; }
  gpsBg = bg;
  const opts = { requestPermissions: true, stale: false, distanceFilter: 0 };
  if (bg) { opts.backgroundTitle = '離線地圖'; opts.backgroundMessage = '正在記錄登山軌跡'; }
  try {
    gpsWatcher = await BG.addWatcher(opts, (loc, err) => {
      if (err) {
        if (err.code === 'NOT_AUTHORIZED') {
          $('#coordText').textContent = '未允許定位'; $('#gpsDot').className = 'gps-dot bad';
          if (!permAsked) {
            permAsked = true;
            ask('需要定位權限', '請到「設定」開啟定位：選「使用 App 期間」（或「永遠」），並開啟「精確位置」。',
              [{ label: '開啟設定', value: 1, cls: 'primary' }, { label: '稍後', value: 0, cls: 'ghost' }]).then(v => v && BG.openSettings());
          }
        }
        return;
      }
      if (!loc) return;
      onFix({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude,
        altitudeAccuracy: loc.altitudeAccuracy, speed: loc.speed, heading: loc.bearing }, timestamp: loc.time });
    });
  } catch (e) { $('#coordText').textContent = '定位啟動失敗：' + (e && e.message || e); }
}
function startGPS() {
  if (NATIVE) {
    if (!NP.BackgroundGeolocation) { $('#coordText').textContent = '定位外掛載入失敗 ' + NATIVE_ERR; return; }
    return nativeWatch(false);
  }
  if (!('geolocation' in navigator)) { $('#coordText').textContent = '此裝置不支援定位'; return; }
  navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function onGpsErr(e) {
  if (e.code === 1) { $('#coordText').textContent = '未允許定位，請到設定開啟'; $('#gpsDot').className = 'gps-dot bad'; }
  else if (!fix) $('#coordText').textContent = '搜尋衛星訊號中…';
}
let firstFix = true;
function onFix(pos) {
  const c = pos.coords;
  fix = { lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy, altAcc: c.altitudeAccuracy,
    speed: c.speed, course: c.heading, t: pos.timestamp || Date.now() };
  const ll = [fix.lat, fix.lon];
  if (!meMarker) {
    accCircle = L.circle(ll, { radius: fix.acc, color: '#2F6FDB', weight: 1, opacity: .35, fillOpacity: .08, interactive: false }).addTo(map);
    meMarker = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(fix.acc); }
  if (firstFix) { firstFix = false; if (S.view[2] <= 8) map.setView(ll, 15); }
  const visible = document.visibilityState !== 'hidden';
  if (follow && visible) map.panTo(ll, { animate: true, duration: .5 });
  if (!compassHeading && fix.course != null && fix.speed > 0.6) setCone(fix.course);
  updateTopbar();
  if (rec.on) recAdd(fix);
  updateNav();
  if (sheetName === 'sos') renderSheet();
}
function updateTopbar() {
  if (!fix) return;
  const f = coordFormats(fix.lat, fix.lon);
  $('#coordText').textContent = f.inTW ? `TWD97 ${f.twd97[0]} · ${f.twd97[1]}` : f.dec;
  $('#altText').textContent = fix.alt != null ? Math.round(fix.alt) : '—';
  $('#gpsDot').className = 'gps-dot ' + (fix.acc <= 15 ? 'ok' : fix.acc <= 50 ? 'fair' : 'bad');
}
$('#coordChip').onclick = () => openSheet('sos');

/* ---------- 指南針 ---------- */
let compassOn = false, compassHeading = null;
async function requestCompass() {
  if (compassOn) return;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
    window.addEventListener('deviceorientation', onOrient, true);
    compassOn = true;
  } catch (e) {}
}
let orientT = 0;
function onOrient(e) {
  let h = e.webkitCompassHeading;
  if (h == null && e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  compassHeading = h;
  const now = performance.now(); if (now - orientT < 90) return; orientT = now;
  setCone(h);
}
function setCone(h) {
  const c = document.querySelector('.me-cone');
  if (c) { c.classList.add('show'); c.style.transform = `rotate(${h}deg)`; }
}

/* ---------- 音效 / 語音 / 螢幕常亮 ---------- */
let actx = null;
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(); g.gain.value = 0.0001;
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.05);
  } catch (e) {}
  try { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) {}
}
function beep(freqs, dur = 0.18, gap = 0.08) {
  if (!actx) return;
  if (actx.state === 'suspended') actx.resume();
  let t = actx.currentTime + 0.03;
  for (const f of freqs) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.03);
    t += dur + gap;
  }
}
function speak(s) {
  if (!S.voice || !('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(s); u.lang = 'zh-TW'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
let wl = null;
async function wake(on) {
  if (NATIVE) { try { on ? await NP.KeepAwake.keepAwake() : await NP.KeepAwake.allowSleep(); } catch (e) {} return; }
  try {
    if (on) { if ('wakeLock' in navigator && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } }
    else if (wl) { await wl.release(); wl = null; }
  } catch (e) { wl = null; }
}

/* ---------- 軌跡記錄 ---------- */
let rec = { on: false }, recLine = null, recTimer = null, recWptLayer = L.layerGroup().addTo(map);
function recAdd(f) {
  if (f.acc > S.minAcc) return;
  const p = [+f.lat.toFixed(7), +f.lon.toFixed(7), f.alt != null ? +f.alt.toFixed(1) : null, f.t];
  const last = rec.pts[rec.pts.length - 1];
  if (last) {
    const d = dist(last, p), gate = Math.max(5, f.acc * 0.5);
    if (d < gate && p[3] - last[3] < 60000) return;
    if (d >= gate) rec.dist += d;
  }
  if (p[2] != null) {
    if (rec.ref == null) rec.ref = p[2];
    else if (p[2] - rec.ref >= 6) { rec.up += p[2] - rec.ref; rec.ref = p[2]; }
    else if (rec.ref - p[2] >= 6) { rec.down += rec.ref - p[2]; rec.ref = p[2]; }
    rec.maxE = Math.max(rec.maxE ?? -1e9, p[2]); rec.minE = Math.min(rec.minE ?? 1e9, p[2]);
  }
  rec.pts.push(p);
  recLine.addLatLng([p[0], p[1]]);
  if (document.visibilityState === 'hidden') { if (rec.pts.length % 5 === 0) persistRec(); }
  else persistSoon();
}
let persistT = null;
function persistSoon() { if (!persistT) persistT = setTimeout(() => { persistT = null; persistRec(); }, 8000); }
function persistRec() { if (!rec.on) return; const { on, ...data } = rec; DB.kvSet('current', data).catch(() => {}); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistRec();
  else if (rec.on && S.keepAwake) wake(true);
});
window.addEventListener('pagehide', persistRec);

function startRec(resume) {
  unlockAudio(); requestCompass();
  if (NATIVE) { nativeWatch(true); NP.LocalNotifications.requestPermissions().catch(() => {}); }
  rec = resume ? Object.assign({ on: true }, resume)
    : { on: true, id: uid(), start: Date.now(), pts: [], wpts: [], dist: 0, up: 0, down: 0, ref: null, maxE: null, minE: null };
  if (recLine) map.removeLayer(recLine);
  recLine = L.polyline(rec.pts.map(p => [p[0], p[1]]), { color: '#E08A2C', weight: 4.5, opacity: .95, interactive: false }).addTo(map);
  recWptLayer.clearLayers(); rec.wpts.forEach(addWptMarker);
  document.body.classList.add('recording'); $('#startLbl').textContent = '結束';
  setFollow(true);
  if (fix) { map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 15)); recAdd(fix); }
  if (S.keepAwake) wake(true);
  clearInterval(recTimer); recTimer = setInterval(tick, 1000); tick();
  persistRec(); updateNav();
  toast(resume ? '已繼續記錄' : fix ? '開始導航，正在記錄軌跡' : '開始記錄，等待 GPS 定位…');
}
async function stopRec() {
  const r = await ask('結束記錄？', `已記錄 ${fmtKm(rec.dist)} km，歷時 ${fmtDur(Date.now() - rec.start)}。`,
    [{ label: '結束並儲存', value: 'save', cls: 'danger' }, { label: '繼續記錄', value: null, cls: 'ghost' }]);
  if (r === 'save') finishRec();
}
async function finishRec(src) {
  const r = src || rec;
  clearInterval(recTimer);
  const t = { id: r.id, name: (route ? route.name + ' ' : '') + fmtDate(r.start).split(' ')[0] + ' 軌跡',
    start: r.start, end: src && r.pts.length ? r.pts[r.pts.length - 1][3] : Date.now(),
    pts: r.pts, wpts: r.wpts, dist: r.dist, up: r.up, down: r.down, maxE: r.maxE, minE: r.minE };
  rec = { on: false };
  document.body.classList.remove('recording'); $('#startLbl').textContent = '開始';
  wake(false); clearOff();
  if (NATIVE) nativeWatch(false);
  if (recLine) { map.removeLayer(recLine); recLine = null; }
  recWptLayer.clearLayers();
  await DB.kvDel('current');
  updateNav();
  if (t.pts.length >= 2 || t.wpts.length) {
    await DB.put('tracks', t);
    showTrack(t, false);
    openSheet('trackDone', t);
  } else toast('記錄點太少，未儲存軌跡');
}
$('#btnStart').onclick = () => rec.on ? stopRec() : startRec();

function tick() {
  if (!rec.on) return;
  const el = fmtDur(Date.now() - rec.start);
  $('#stTime').textContent = el;
  $('#stDist').textContent = fmtKm(rec.dist);
  $('#stUp').textContent = Math.round(rec.up);
  const spd = fix && fix.speed != null && fix.speed >= 0 && Date.now() - fix.t < 15000 ? fix.speed * 3.6 : 0;
  $('#stSpd').textContent = spd.toFixed(1);
  if (!$('#dim').classList.contains('hidden')) {
    const d = new Date();
    $('#dimClock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('#dimElapsed').textContent = el; $('#dimDist').textContent = fmtKm(rec.dist);
    $('#dimAlt').textContent = fix && fix.alt != null ? Math.round(fix.alt) : '—';
    $('#dimUp').textContent = Math.round(rec.up);
  }
}

/* 航點 */
function addWptMarker(w) {
  L.marker([w.lat, w.lon], { icon: pinIcon('mywpt') })
    .bindPopup(`<b>${esc(w.name)}</b>${w.ele != null ? `<br>海拔 ${Math.round(w.ele)} m` : ''}`).addTo(recWptLayer);
}
$('#btnWpt').onclick = async () => {
  if (!fix) return toast('尚未取得定位');
  const at = { ...fix };
  const name = await askText('標記航點', `航點 ${rec.wpts.length + 1}`, '標記');
  if (name === null || !rec.on) return;
  const w = { lat: at.lat, lon: at.lon, ele: at.alt, name: name || `航點 ${rec.wpts.length + 1}`, t: at.t };
  rec.wpts.push(w); addWptMarker(w); persistRec(); toast('已標記航點');
};

/* 省電暗幕 */
$('#btnDim').onclick = () => { $('#dim').classList.remove('hidden'); tick(); };
let lastTap = 0;
$('#dim').addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 400) $('#dim').classList.add('hidden');
  lastTap = now;
});

/* ---------- 導航路線 ---------- */
let route = null;
async function setActiveRoute(id, fit) {
  routeLayer.clearLayers(); route = null; clearOff();
  S.activeRoute = id || null; saveSettings();
  if (id) {
    const r = await DB.get('routes', id);
    if (r) {
      route = r; route.prep = prepRoute(r.pts);
      const ll = r.pts.map(p => [p[0], p[1]]);
      if (ll.length > 1) {
        L.polyline(ll, { color: '#fff', weight: 8.5, opacity: .9, interactive: false }).addTo(routeLayer);
        L.polyline(ll, { color: '#2F6FDB', weight: 4.5, opacity: .95, interactive: false }).addTo(routeLayer);
        L.marker(ll[0], { icon: pinIcon('start'), interactive: false }).addTo(routeLayer);
        L.marker(ll[ll.length - 1], { icon: pinIcon('end'), interactive: false }).addTo(routeLayer);
      }
      for (const w of r.wpts || [])
        L.marker([w.lat, w.lon], { icon: pinIcon('wpt') })
          .bindPopup(`<b>${esc(w.name)}</b>${w.ele != null ? `<br>海拔 ${Math.round(w.ele)} m` : ''}`).addTo(routeLayer);
      if (fit) {
        const all = ll.concat((r.wpts || []).map(w => [w.lat, w.lon]));
        if (all.length) { setFollow(false); map.fitBounds(L.latLngBounds(all), { padding: [50, 50] }); }
      }
    } else { S.activeRoute = null; saveSettings(); }
  }
  updateNav();
}
function navInfo() {
  if (!route || route.pts.length < 2 || !fix) return null;
  const n = nearestOnRoute([fix.lat, fix.lon], route.pts, route.prep.cum);
  const P = route.prep;
  const upDone = P.cumUp[n.i] + n.t * ((P.cumUp[n.i + 1] ?? P.cumUp[n.i]) - P.cumUp[n.i]);
  return { ...n, left: Math.max(0, P.length - n.along), upLeft: Math.max(0, P.up - upDone), frac: P.length ? n.along / P.length : 0 };
}
function updateNav() {
  const show = rec.on || !!route;
  $('#navCard').classList.toggle('hidden', !show);
  $('#navCard .stats').classList.toggle('hidden', !rec.on);
  $('#routeRow').classList.toggle('hidden', !route);
  if (route) {
    $('#rtName').textContent = route.name;
    const n = navInfo();
    if (n) {
      $('#rtLeft').textContent = `剩 ${fmtKm(n.left)} km · ↑${Math.round(n.upLeft)} m`;
      $('#rtBar').style.width = (n.frac * 100).toFixed(1) + '%';
      if (rec.on) checkOff(n);
    } else {
      $('#rtLeft').textContent = `全長 ${fmtKm(route.prep.length)} km · ↑${Math.round(route.prep.up)} m`;
      $('#rtBar').style.width = '0%';
    }
  }
  const c = $('#navCard');
  document.body.classList.toggle('has-nav', show);
  document.body.style.setProperty('--nav-h', show ? (c.offsetHeight + 8) + 'px' : '0px');
}

/* ---------- 偏離路線警示 ---------- */
let notifId = 1;
function notify(title, body) {
  if (!NATIVE) return;
  NP.LocalNotifications.schedule({ notifications: [{ id: notifId++, title, body }] }).catch(() => {});
}
function haptic() {
  if (NATIVE) { NP.Haptics.vibrate({ duration: 600 }).catch(() => {}); setTimeout(() => NP.Haptics.vibrate({ duration: 600 }).catch(() => {}), 700); }
  else if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}
const off = { on: false, cnt: 0, last: 0 };
let offLine = null, offTarget = null;
function checkOff(n) {
  const th = S.offThreshold, d = n.d;
  if (d - Math.min(fix.acc, th) * 0.5 > th) off.cnt++;
  else if (d < th * 0.8) {
    if (off.on) {
      off.on = false;
      if (NATIVE && document.visibilityState === 'hidden') notify('已回到路線', '繼續沿著藍色路線前進');
      else { if (S.beep) beep([660, 990], 0.14, 0.05); speak('已回到路線'); toast('已回到路線'); }
    }
    off.cnt = 0;
  }
  if (off.cnt >= 2 && !off.on) { off.on = true; off.last = 0; }
  if (off.on) {
    const b = bearing([fix.lat, fix.lon], n.q);
    offTarget = n.q;
    $('#offBanner').classList.remove('hidden');
    $('#offDist').textContent = Math.round(d) + ' m';
    $('#offHint').textContent = `路線在你的${dirName(b)}方 · 點此查看`;
    $('#dimOff').textContent = `⚠ 已偏離路線 ${Math.round(d)} m（${dirName(b)}方）`;
    $('#dimOff').classList.remove('hidden');
    const seg = [[fix.lat, fix.lon], n.q];
    if (offLine) offLine.setLatLngs(seg);
    else offLine = L.polyline(seg, { color: '#C4533A', weight: 3, dashArray: '6 7', interactive: false }).addTo(map);
    if (Date.now() - off.last > 45000) {
      off.last = Date.now();
      if (NATIVE && document.visibilityState === 'hidden') {
        notify('已偏離路線', `距離路線 ${Math.round(d)} m，路線在你的${dirName(b)}方`);
      } else {
        if (S.beep) beep([988, 988, 988], 0.2, 0.1);
        haptic();
        setTimeout(() => speak(`注意，已偏離路線 ${Math.round(d)} 公尺`), 900);
      }
    }
  } else clearOff(true);
}
function clearOff(keepCount) {
  if (!keepCount) { off.on = false; off.cnt = 0; }
  $('#offBanner').classList.add('hidden'); $('#dimOff').classList.add('hidden');
  if (offLine) { map.removeLayer(offLine); offLine = null; }
}
$('#offBanner').onclick = () => {
  if (!fix || !offTarget) return;
  setFollow(false);
  map.fitBounds(L.latLngBounds([[fix.lat, fix.lon], offTarget]), { padding: [90, 90], maxZoom: 17 });
};

/* ---------- 歷史軌跡顯示 ---------- */
function showTrack(t, fit = true) {
  viewLayer.clearLayers();
  const ll = t.pts.map(p => [p[0], p[1]]);
  if (ll.length > 1) {
    L.polyline(ll, { color: '#fff', weight: 7.5, opacity: .85, interactive: false }).addTo(viewLayer);
    L.polyline(ll, { color: '#E08A2C', weight: 4, interactive: false }).addTo(viewLayer);
  }
  for (const w of t.wpts || []) L.marker([w.lat, w.lon], { icon: pinIcon('mywpt') }).bindPopup(`<b>${esc(w.name)}</b>`).addTo(viewLayer);
  const all = ll.concat((t.wpts || []).map(w => [w.lat, w.lon]));
  if (fit && all.length) { setFollow(false); map.fitBounds(L.latLngBounds(all), { padding: [50, 50] }); }
}

/* ---------- 檔案分享 ---------- */
async function shareFile(name, text, type = 'application/gpx+xml') {
  if (NATIVE) {
    try {
      const w = await NP.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await NP.Share.share({ title: name, files: [w.uri] });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('分享失敗'); }
    return;
  }
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const safeName = s => s.replace(/[\\/:*?"<>|]/g, '_');

/* ---------- 高度剖面圖 ---------- */
function profileSVG(pts, cum, markAlong) {
  const idx = []; for (let i = 0; i < pts.length; i++) if (pts[i][2] != null) idx.push(i);
  if (idx.length < 2) return '';
  const W = 320, H = 84, len = cum[cum.length - 1] || 1;
  let min = Infinity, max = -Infinity;
  for (const i of idx) { min = Math.min(min, pts[i][2]); max = Math.max(max, pts[i][2]); }
  const pad = (max - min) * 0.12 || 10, lo = min - pad, hi = max + pad;
  const step = Math.max(1, Math.floor(idx.length / 300));
  let d = '';
  for (let k = 0; k < idx.length; k += step) {
    const i = idx[k];
    d += (d ? 'L' : 'M') + (cum[i] / len * W).toFixed(1) + ' ' + (H - (pts[i][2] - lo) / (hi - lo) * H).toFixed(1);
  }
  const mark = markAlong != null ? `<line x1="${markAlong / len * W}" x2="${markAlong / len * W}" y1="0" y2="${H}" stroke="#C4533A" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d}L${W} ${H}L0 ${H}Z" fill="rgba(47,111,219,.12)" stroke="none"/>
    <path d="${d}" fill="none" stroke="#2F6FDB" stroke-width="1.8" vector-effect="non-scaling-stroke"/>${mark}</svg>
    <div class="dl-stat"><span>最低 ${Math.round(min)} m</span><span>最高 ${Math.round(max)} m</span></div>`;
}

/* ---------- 底部抽屜 ---------- */
let sheetName = null, sheetArg = null;
function openSheet(name, arg) {
  sheetName = name; sheetArg = arg;
  $('#sheetBody').scrollTop = 0;
  renderSheet();
  $('#sheet').classList.add('show'); $('#backdrop').classList.add('show');
}
function closeSheet() {
  sheetName = null;
  $('#sheet').classList.remove('show'); $('#backdrop').classList.remove('show');
}
function renderSheet() {
  if (!sheetName) return;
  const sh = SHEETS[sheetName];
  $('#sheetTitle').textContent = typeof sh.title === 'function' ? sh.title(sheetArg) : sh.title;
  sh.render($('#sheetBody'), sheetArg);
}
$('#sheetClose').onclick = closeSheet;
$('#backdrop').onclick = closeSheet;
$$('.dock [data-sheet]').forEach(b => b.onclick = () => openSheet(b.dataset.sheet));
$('#btnLayers').onclick = () => openSheet('layers');
$('#btnSettings').onclick = () => openSheet('settings');
// 下拉關閉
(() => {
  const sh = $('#sheet'); let y0 = null, dy = 0;
  sh.addEventListener('touchstart', e => { if ($('#sheetBody').scrollTop <= 0 && e.target.closest('.sheet-head,.sheet-grip')) { y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; } }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', () => { if (y0 == null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; });
})();

const SHEETS = {};
const swRow = (id, title, sub, on) => `<label class="row"><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></span></label>`;
const seg = (id, opts, val) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const bindSeg = (id, fn) => $$(`#${id} button`).forEach(b => b.onclick = () => fn(b.dataset.v));

/* 圖層 */
SHEETS.layers = {
  title: '地圖圖層',
  render(el) {
    el.innerHTML = `<div class="layer-grid">${Object.entries(LAYERS).map(([k, L_]) => `
      <button class="layer-card ${S.layer === k ? 'on' : ''}" data-k="${k}">
        <div class="layer-sw" style="background:${L_.sw}"></div>
        <div class="t">${L_.name}</div><div class="s">${L_.desc}</div>
        <div>${L_.dl ? '<span class="tag">可離線下載</span>' : '<span class="tag warn">僅線上</span>'}</div>
      </button>`).join('')}</div>
      <p class="note">建議：台灣山區用「魯地圖」，看地貌用「正射影像」，國外旅遊用「OpenTopoMap」或「全球衛星圖」。出發前記得到「下載」預先存好圖資。</p>
      <p class="note" style="font-size:11px;color:var(--ink3)">目前圖資：${esc(layerDef(S.layer).attr || '')}</p>`;
    $$('.layer-card', el).forEach(b => b.onclick = () => { if (setLayer(b.dataset.k)) { renderSheet(); setTimeout(closeSheet, 200); } });
  },
};

/* 座標 / 求救 */
function smsBody() {
  const f = coordFormats(fix.lat, fix.lon);
  return `【位置回報】${S.myName ? S.myName + ' ' : ''}${fmtDate(fix.t)}\n` +
    `WGS84：${f.dec}\n` + (f.inTW ? `TWD97：${f.twd97raw[0]}, ${f.twd97raw[1]}\n` : '') +
    `海拔：${fix.alt != null ? Math.round(fix.alt) + ' m' : '未知'}（精度 ±${Math.round(fix.acc)} m）\n` +
    `https://maps.google.com/?q=${fix.lat.toFixed(6)},${fix.lon.toFixed(6)}`;
}
SHEETS.sos = {
  title: '座標與回報',
  render(el) {
    if (!fix) { el.innerHTML = `<div class="empty">尚未取得 GPS 定位<br>請到開闊處稍候片刻</div>`; return; }
    const f = coordFormats(fix.lat, fix.lon);
    const age = Math.round((Date.now() - fix.t) / 1000);
    el.innerHTML = `
      <div class="coord-hero">
        ${f.inTW ? `<div class="coord-item"><span>TWD97 (TM2)</span><b class="mono coord-big">${f.twd97[0]}<br>${f.twd97[1]}</b></div>` : ''}
        <div class="coord-item"><span>WGS84 十進位</span><b class="mono">${f.dec}</b></div>
        <div class="coord-item"><span>WGS84 度分秒</span><b class="mono" style="font-size:15px">${f.dms}</b></div>
        ${f.inTW ? `<div class="coord-item"><span>TWD67（約略）</span><b class="mono">${f.twd67[0]} · ${f.twd67[1]}</b></div>` : ''}
        <div class="coord-item"><span>海拔</span><b class="mono">${fix.alt != null ? Math.round(fix.alt) + ' m' : '—'}${fix.altAcc ? ` <small style="color:var(--ink2);font-weight:500">±${Math.round(fix.altAcc)}</small>` : ''}</b></div>
        <div class="coord-item"><span>水平精度 / 更新</span><b class="mono">±${Math.round(fix.acc)} m · ${age < 5 ? '剛剛' : age + ' 秒前'}</b></div>
      </div>
      <div class="section-t">留守人</div>
      <div class="group">
        <label class="row"><div class="t">電話</div><input type="tel" id="contactIn" placeholder="0912345678" value="${esc(S.contact)}"></label>
      </div>
      <button class="btn primary block" id="btnSms" style="margin-top:14px">${ICON.msg}傳簡訊給留守人</button>
      <div class="btn-row"><button class="btn" id="btnShareLoc">${ICON.share}分享位置</button><button class="btn" id="btnCopy">${ICON.copy}複製座標</button></div>
      <p class="note">簡訊只需微弱訊號即可送出。若完全沒有訊號，可先編好簡訊，走到有訊號處再按傳送。緊急求救請撥 <b>112</b>（無 SIM 卡或非本家電信訊號也可撥打）。</p>`;
    $('#contactIn').onchange = e => { S.contact = e.target.value.trim(); saveSettings(); };
    $('#btnSms').onclick = () => {
      S.contact = $('#contactIn').value.trim(); saveSettings();
      const nums = S.contact.split(/[,，;\s]+/).filter(Boolean);
      const body = encodeURIComponent(smsBody());
      location.href = nums.length > 1 ? `sms:/open?addresses=${nums.join(',')}&body=${body}` : `sms:${nums[0] || ''}&body=${body}`;
    };
    $('#btnShareLoc').onclick = async () => {
      if (NATIVE) { try { await NP.Share.share({ text: smsBody() }); } catch (e) {} return; }
      try { if (navigator.share) { await navigator.share({ text: smsBody() }); return; } } catch (e) { if (e.name === 'AbortError') return; }
      copyText(smsBody());
    };
    $('#btnCopy').onclick = () => copyText(smsBody());
  },
};
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast('已複製'); }
  catch (e) { toast('無法複製'); }
}

/* 路線 */
$('#gpxInput').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  let last = null, ok = 0;
  for (const f of files) {
    try {
      const g = parseGPX(await f.text(), f.name);
      const P = prepRoute(g.pts);
      const r = { id: uid(), name: g.name, pts: g.pts, wpts: g.wpts, created: Date.now(), length: P.length, up: P.up };
      await DB.put('routes', r); last = r; ok++;
    } catch (err) { toast(`${f.name}：${err.message}`, 3500); }
  }
  if (ok) {
    toast(`已匯入 ${ok} 條路線`);
    if (ok === 1) { await setActiveRoute(last.id, true); closeSheet(); }
    else renderSheet();
  }
};
SHEETS.routes = {
  title: '路線',
  async render(el) {
    const list = (await DB.all('routes')).sort((a, b) => b.created - a.created);
    const n = navInfo();
    el.innerHTML = `
      <button class="btn primary block" id="btnImport">${ICON.upload}匯入 GPX 檔</button>
      ${route ? `<div class="section-t">導航中</div><div class="group"><div class="row" style="display:block">
        <div class="t" style="color:var(--route)">${esc(route.name)}</div>
        <div class="s">全長 ${fmtKm(route.prep.length)} km · 爬升 ${Math.round(route.prep.up)} m · 下降 ${Math.round(route.prep.down)} m${n ? ` · 距路線 ${Math.round(n.d)} m` : ''}</div>
        ${profileSVG(route.pts, route.prep.cum, n ? n.along : null)}
      </div></div>` : ''}
      <div class="section-t">我的路線</div>
      ${list.length ? `<div class="group">${list.map(r => `
        <div class="row" style="display:block" data-id="${r.id}">
          <div style="display:flex;gap:8px;align-items:center"><div class="t grow">${esc(r.name)}</div>${S.activeRoute === r.id ? '<span class="tag blue">導航中</span>' : ''}</div>
          <div class="s">${fmtKm(r.length || 0)} km · ↑${Math.round(r.up || 0)} m${r.wpts?.length ? ` · ${r.wpts.length} 個航點` : ''}</div>
          <div class="acts">
            ${S.activeRoute === r.id ? '<button class="mini on" data-a="unset">取消導航</button>' : '<button class="mini" data-a="set">設為導航路線</button>'}
            <button class="mini" data-a="dl">下載沿線地圖</button>
            <button class="mini" data-a="exp">匯出</button>
            <button class="mini" data-a="ren">改名</button>
            <button class="mini red" data-a="del">刪除</button>
          </div>
        </div>`).join('')}</div>` : `<div class="empty">還沒有路線<br>匯入山友或官方提供的 GPX 檔，就能在地圖上跟著藍色路線走。</div>`}
      <p class="note">從 iPhone「檔案」App、LINE 或 Email 收到的 GPX 檔，都可以透過上方按鈕匯入。設為導航路線後，按下「開始」即會在偏離 ${S.offThreshold} m 時發出警示。</p>`;
    $('#btnImport').onclick = () => $('#gpxInput').click();
    $$('[data-a]', el).forEach(b => b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id, a = b.dataset.a;
      const r = list.find(x => x.id === id);
      if (a === 'set') { await setActiveRoute(id, true); closeSheet(); }
      if (a === 'unset') { await setActiveRoute(null); renderSheet(); }
      if (a === 'dl') openSheet('download', { mode: 'route', routeId: id });
      if (a === 'exp') shareFile(safeName(r.name) + '.gpx', toGPX(r.name, r.pts, r.wpts));
      if (a === 'ren') { const v = await askText('重新命名', r.name); if (v) { r.name = v; await DB.put('routes', r); if (route?.id === id) route.name = v; updateNav(); renderSheet(); } }
      if (a === 'del') {
        if (await ask('刪除路線？', esc(r.name), [{ label: '刪除', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }])) {
          await DB.del('routes', id); if (S.activeRoute === id) await setActiveRoute(null); renderSheet();
        }
      }
    });
  },
};

/* 紀錄 */
SHEETS.tracks = {
  title: '軌跡紀錄',
  async render(el) {
    const list = (await DB.all('tracks')).sort((a, b) => b.start - a.start);
    el.innerHTML = list.length ? `<div class="group">${list.map(t => `
      <div class="row" style="display:block" data-id="${t.id}">
        <div class="t">${esc(t.name)}</div>
        <div class="s">${fmtDate(t.start)} · ${fmtKm(t.dist)} km · ${fmtDur(t.end - t.start)} · ↑${Math.round(t.up)} m${t.wpts?.length ? ` · ${t.wpts.length} 航點` : ''}</div>
        <div class="acts">
          <button class="mini" data-a="show">顯示</button>
          <button class="mini" data-a="exp">匯出 GPX</button>
          <button class="mini" data-a="route">當作路線</button>
          <button class="mini" data-a="ren">改名</button>
          <button class="mini red" data-a="del">刪除</button>
        </div>
      </div>`).join('')}</div>
      <button class="btn ghost block" id="btnHideTrack" style="margin-top:8px">清除地圖上顯示的軌跡</button>`
      : `<div class="empty">還沒有紀錄<br>按下中間的「開始」鍵，就會開始記錄你的軌跡。</div>`;
    const hb = $('#btnHideTrack'); if (hb) hb.onclick = () => { viewLayer.clearLayers(); toast('已清除'); };
    $$('[data-a]', el).forEach(b => b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id, a = b.dataset.a;
      const t = list.find(x => x.id === id);
      if (a === 'show') { showTrack(t); closeSheet(); }
      if (a === 'exp') shareFile(safeName(t.name) + '.gpx', toGPX(t.name, t.pts, t.wpts));
      if (a === 'route') {
        const P = prepRoute(t.pts);
        await DB.put('routes', { id: uid(), name: t.name, pts: t.pts.map(p => [p[0], p[1], p[2]]), wpts: t.wpts || [], created: Date.now(), length: P.length, up: P.up });
        toast('已加入路線清單');
      }
      if (a === 'ren') { const v = await askText('重新命名', t.name); if (v) { t.name = v; await DB.put('tracks', t); renderSheet(); } }
      if (a === 'del') {
        if (await ask('刪除軌跡？', esc(t.name), [{ label: '刪除', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }])) {
          await DB.del('tracks', id); viewLayer.clearLayers(); renderSheet();
        }
      }
    });
  },
};

/* 結束後摘要 */
SHEETS.trackDone = {
  title: '完成！',
  render(el, t) {
    const P = prepRoute(t.pts);
    el.innerHTML = `
      <div class="coord-hero">
        <div class="t" style="font-weight:650;margin-bottom:6px">${esc(t.name)}</div>
        <div class="stats" style="margin:8px 0 4px">
          <div><span class="lbl">時間</span><b class="mono">${fmtDur(t.end - t.start)}</b></div>
          <div><span class="lbl">距離</span><b class="mono">${fmtKm(t.dist)}</b><span class="unit">km</span></div>
          <div><span class="lbl">爬升</span><b class="mono">${Math.round(t.up)}</b><span class="unit">m</span></div>
          <div><span class="lbl">下降</span><b class="mono">${Math.round(t.down)}</b><span class="unit">m</span></div>
        </div>
        ${profileSVG(t.pts, P.cum)}
      </div>
      <button class="btn primary block" id="tdExp" style="margin-top:14px">${ICON.share}匯出 GPX</button>
      <div class="btn-row"><button class="btn" id="tdRen">重新命名</button><button class="btn" id="tdOk">完成</button></div>
      <p class="note">軌跡已儲存在「紀錄」中，隨時可以再匯出或轉成路線。</p>`;
    $('#tdExp').onclick = () => shareFile(safeName(t.name) + '.gpx', toGPX(t.name, t.pts, t.wpts));
    $('#tdRen').onclick = async () => { const v = await askText('重新命名', t.name); if (v) { t.name = v; await DB.put('tracks', t); renderSheet(); } };
    $('#tdOk').onclick = closeSheet;
  },
};

/* 設定 */
SHEETS.settings = {
  title: '設定',
  render(el) {
    el.innerHTML = `
      <div class="section-t">偏離路線警示距離</div>
      ${seg('segOff', [[30, '30 m'], [50, '50 m'], [100, '100 m'], [200, '200 m']], S.offThreshold)}
      <div class="section-t">警示方式</div>
      <div class="group">
        ${swRow('swBeep', '警示音', '偏離與回到路線時播放提示音', S.beep)}
        ${swRow('swVoice', '語音提示', '以中文語音說出偏離距離', S.voice)}
        ${swRow('swAwake', '記錄時螢幕常亮', NATIVE ? '鎖定螢幕時仍會繼續記錄，開啟只是方便隨時看地圖' : 'iOS 鎖定螢幕會暫停定位，建議開啟', S.keepAwake)}
      </div>
      <div class="section-t">GPS 記錄精度門檻</div>
      ${seg('segAcc', [[20, '±20 m'], [50, '±50 m'], [100, '±100 m']], S.minAcc)}
      <p class="note">精度差於此值的定位點不會寫入軌跡，可避免訊號飄移造成的亂線。</p>
      <div class="section-t">回報資訊</div>
      <div class="group">
        <label class="row"><div class="t">我的名字</div><input type="text" id="inName" placeholder="簡訊署名" value="${esc(S.myName)}"></label>
        <label class="row"><div class="t">留守人電話</div><input type="tel" id="inContact" placeholder="可用逗號分隔多人" value="${esc(S.contact)}"></label>
      </div>
      <div class="section-t">自訂圖層</div>
      <div class="group"><label class="row"><input type="url" id="inCustom" style="text-align:left" placeholder="https://…/{z}/{x}/{y}.png" value="${esc(S.customUrl)}"></label></div>
      ${NATIVE ? '' : `<div class="section-t">儲存空間</div>
      <div class="group">
        <div class="row"><div class="grow"><div class="t">瀏覽快取</div><div class="s">平常滑動地圖時自動暫存的圖磚</div></div><button class="mini red" id="btnClearSeen">清除</button></div>
      </div>`}
      <p class="note">版本 2.0（${NATIVE ? 'iPhone App' : '網頁版'}）· 所有資料（路線、軌跡、地圖）只存在這支 iPhone 上。</p>`;
    bindSeg('segOff', v => { S.offThreshold = +v; saveSettings(); renderSheet(); });
    bindSeg('segAcc', v => { S.minAcc = +v; saveSettings(); renderSheet(); });
    $('#swBeep').onchange = e => { S.beep = e.target.checked; saveSettings(); if (S.beep) { unlockAudio(); beep([880], 0.15); } };
    $('#swVoice').onchange = e => { S.voice = e.target.checked; saveSettings(); if (S.voice) { unlockAudio(); speak('語音提示已開啟'); } };
    $('#swAwake').onchange = e => { S.keepAwake = e.target.checked; saveSettings(); if (rec.on) wake(S.keepAwake); };
    $('#inName').onchange = e => { S.myName = e.target.value.trim(); saveSettings(); };
    $('#inContact').onchange = e => { S.contact = e.target.value.trim(); saveSettings(); };
    $('#inCustom').onchange = e => { S.customUrl = e.target.value.trim(); saveSettings(); if (S.layer === 'custom') setLayer('custom'); };
    if ($('#btnClearSeen')) $('#btnClearSeen').onclick = async () => { await caches.delete('tiles-seen'); toast('已清除瀏覽快取'); };
  },
};

/* ---------- 離線下載 ---------- */
let dl = { running: false };
const dlForm = { mode: 'view', routeId: null, radius: 1000, layers: null, zmin: 8, zmax: 16, name: '' };
function buildArea() {
  const area = { id: uid(), created: Date.now(), layers: [...dlForm.layers], zmin: dlForm.zmin, zmax: dlForm.zmax, customUrl: S.customUrl };
  if (dlForm.mode === 'route' && dlForm.route) {
    const line = thinLine(dlForm.route.pts, 30);
    Object.assign(area, { kind: 'route', line, radius: dlForm.radius, bbox: lineBBox(line, dlForm.radius) });
  } else {
    const b = map.getBounds();
    Object.assign(area, { kind: 'bbox', bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()] });
  }
  return area;
}
function estimate(area) {
  const n = tilesForArea(area).length;
  const kb = area.layers.reduce((s, k) => s + (LAYERS[k]?.kb || 30), 0);
  return { tiles: n * area.layers.length, bytes: n * kb * 1000 };
}
async function fetchTile(u) {
  let r;
  try { r = await fetch(u, { mode: 'cors', credentials: 'omit' }); }
  catch (e) { r = await fetch(u, { mode: 'no-cors', credentials: 'omit' }); }
  if (r.type === 'opaque') return { res: r, size: 0 };
  if (!r.ok) return null;
  const b = await r.clone().blob();
  return b.size ? { res: r, size: b.size } : null;
}
async function fetchTileNative(job) {
  const r = await NP.CapacitorHttp.request({ url: job.url, method: 'GET', responseType: 'blob', connectTimeout: 15000, readTimeout: 20000 });
  if (r.status !== 200 || !r.data || typeof r.data !== 'string') return 0;
  await NP.Filesystem.writeFile({ path: 'tiles/' + job.key, data: r.data, directory: 'DATA', recursive: true });
  NT.index.add(job.key);
  return Math.round(r.data.length * 0.75);
}
async function startDownloadNative(area) {
  const jobs = jobsForArea(area);
  dl = { running: true, total: jobs.length, done: 0, fail: 0, bytes: 0, unknown: 0, cancel: false, name: area.name };
  let i = 0, sinceSave = 0;
  const worker = async () => {
    while (!dl.cancel && i < jobs.length) {
      const j = jobs[i++];
      if (NT.index.has(j.key)) dl.unknown++;
      else {
        let size = 0;
        for (let tries = 0; tries < 2 && !size; tries++) { try { size = await fetchTileNative(j); } catch (e) {} if (!size) await new Promise(s => setTimeout(s, 600)); }
        if (size) { dl.bytes += size; if (++sinceSave >= 300) { sinceSave = 0; NT.save(); } } else dl.fail++;
      }
      dl.done++;
      if (dl.done % 5 === 0 || dl.done === dl.total) drawProgress();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await NT.save();
  await finishDownload(area);
}
async function finishDownload(area) {
  const avg = area.layers.reduce((s, k) => s + (LAYERS[k]?.kb || 30), 0) / area.layers.length * 1000;
  area.count = dl.done - dl.fail; area.fail = dl.fail;
  area.bytes = dl.bytes + dl.unknown * avg;
  area.partial = dl.cancel;
  if (area.count > 0) await DB.put('areas', area);
  dl.running = false;
  toast(dl.cancel ? '已停止下載，已下載的部分已保存' : dl.fail ? `下載完成，${dl.fail} 張失敗（可再下載一次補齊）` : `「${area.name}」下載完成`, 3500);
  if (sheetName === 'download') renderSheet();
  if (base) base.redraw();
}
async function startDownload(area) {
  if (NATIVE) return startDownloadNative(area);
  const urls = urlsForArea(area);
  dl = { running: true, total: urls.length, done: 0, fail: 0, bytes: 0, unknown: 0, cancel: false, name: area.name };
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  const cache = await caches.open(TILE_CACHE);
  let i = 0;
  const worker = async () => {
    while (!dl.cancel && i < urls.length) {
      const u = urls[i++];
      try {
        if (!(await cache.match(u))) {
          let r = null;
          for (let tries = 0; tries < 2 && !r; tries++) { try { r = await fetchTile(u); } catch (e) {} if (!r) await new Promise(s => setTimeout(s, 600)); }
          if (r) { await cache.put(u, r.res); if (r.size) dl.bytes += r.size; else dl.unknown++; }
          else dl.fail++;
        } else dl.unknown++;
      } catch (e) { dl.fail++; }
      dl.done++;
      if (dl.done % 5 === 0 || dl.done === dl.total) drawProgress();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await finishDownload(area);
}
function drawProgress() {
  const bar = $('#dlBar'); if (!bar) return;
  bar.style.width = (dl.done / dl.total * 100).toFixed(1) + '%';
  $('#dlCount').textContent = `${dl.done.toLocaleString()} / ${dl.total.toLocaleString()}`;
  $('#dlFail').textContent = dl.fail ? `失敗 ${dl.fail}` : `${Math.round(dl.done / dl.total * 100)}%`;
}
async function deleteArea(id) {
  const areas = await DB.all('areas');
  const target = areas.find(a => a.id === id); if (!target) return;
  if (NATIVE) {
    const keepK = new Set();
    for (const a of areas) if (a.id !== id) for (const j of jobsForArea(a)) keepK.add(j.key);
    const delK = jobsForArea(target).map(j => j.key).filter(k => !keepK.has(k) && NT.index.has(k));
    for (let i = 0; i < delK.length; i += 20)
      await Promise.all(delK.slice(i, i + 20).map(k => NP.Filesystem.deleteFile({ path: 'tiles/' + k, directory: 'DATA' }).catch(() => {}).then(() => NT.index.delete(k))));
    await NT.save(); await DB.del('areas', id);
    if (base) base.redraw();
    return;
  }
  const keep = new Set();
  for (const a of areas) if (a.id !== id) for (const u of urlsForArea(a)) keep.add(u);
  const cache = await caches.open(TILE_CACHE);
  const del = urlsForArea(target).filter(u => !keep.has(u));
  for (let i = 0; i < del.length; i += 50) await Promise.all(del.slice(i, i + 50).map(u => cache.delete(u)));
  await DB.del('areas', id);
}
SHEETS.download = {
  title: '離線地圖下載',
  async render(el, arg) {
    if (arg && arg.mode) { dlForm.mode = arg.mode; dlForm.routeId = arg.routeId; sheetArg = null; dlForm.name = ''; }
    if (!dlForm.layers) dlForm.layers = new Set([LAYERS[S.layer]?.dl ? S.layer : 'rudy']);
    const routes = (await DB.all('routes')).filter(r => r.pts.length > 1).sort((a, b) => b.created - a.created);
    if (dlForm.mode === 'route') {
      dlForm.route = routes.find(r => r.id === (dlForm.routeId || S.activeRoute)) || routes[0] || null;
      if (!dlForm.route) dlForm.mode = 'view';
    }
    const areas = (await DB.all('areas')).sort((a, b) => b.created - a.created);
    let est = null;
    try { const a = buildArea(); if (a.layers.length) est = estimate(a); } catch (e) {}
    const z = map.getZoom();
    const topoLimit = dlForm.layers.has('topo') && est && est.tiles / dlForm.layers.size > LAYERS.topo.dlMax;
    const tooMany = est && est.tiles > 60000;
    let usage = '';
    if (NATIVE) { const tot = areas.reduce((s, a) => s + (a.bytes || 0), 0); usage = `<div class="section-t">儲存空間</div><div class="group"><div class="row"><div class="grow"><div class="t">離線地圖共占用</div><div class="s">${NT.index.size.toLocaleString()} 張圖磚</div></div><b class="mono">約 ${fmtBytes(tot)}</b></div></div>`; }
    else try { if (navigator.storage?.estimate) { const s = await navigator.storage.estimate(); usage = `<div class="section-t">儲存空間</div><div class="group"><div class="row" style="display:block"><div class="dl-stat"><span>已使用 ${fmtBytes(s.usage || 0)}</span><span>可用約 ${fmtBytes(s.quota || 0)}</span></div><div class="storage-bar"><i style="width:${Math.min(100, (s.usage / s.quota) * 100 || 0).toFixed(1)}%"></i></div></div></div>`; } } catch (e) {}

    el.innerHTML = `
      ${!navigator.onLine ? '<div class="banner" style="position:static;animation:none;margin-bottom:12px;background:var(--brand);box-shadow:none"><span><b>目前離線</b><small>連上網路後才能下載地圖</small></span></div>' : ''}
      ${dl.running ? `
        <div class="group"><div class="row" style="display:block">
          <div class="t">正在下載：${esc(dl.name)}</div>
          <div class="progress big"><i id="dlBar"></i></div>
          <div class="dl-stat"><span id="dlCount"></span><span id="dlFail"></span></div>
          <button class="btn block" id="btnCancel" style="margin-top:12px;color:var(--danger)">停止下載</button>
        </div></div>
        <p class="note">下載時請保持 App 在前景、螢幕開啟。可以關閉此視窗繼續操作地圖。</p>` : `
      <div class="section-t">下載範圍</div>
      ${seg('segMode', [['view', '目前畫面'], ['route', '沿著路線']], dlForm.mode)}
      ${dlForm.mode === 'route' ? `
        <div class="group" style="margin-top:10px">
          <label class="row"><div class="t">路線</div><select id="selRoute">${routes.map(r => `<option value="${r.id}" ${dlForm.route?.id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        </div>
        <div class="section-t">路線兩側寬度</div>
        ${seg('segRad', [[300, '300 m'], [500, '500 m'], [1000, '1 km'], [2000, '2 km']], dlForm.radius)}`
        : `<p class="note">會下載目前地圖畫面看到的範圍。請先把地圖移動、縮放到想要的區域（目前縮放等級 Z${z}）。</p>`}
      <div class="section-t">圖層（可複選）</div>
      <div class="group">${Object.entries(LAYERS).filter(([k, L_]) => L_.dl && (k !== 'custom' || S.customUrl)).map(([k, L_]) => `
        <label class="row"><span class="chk"><input type="checkbox" data-layer="${k}" ${dlForm.layers.has(k) ? 'checked' : ''}><span class="t">${L_.name}</span></span><span class="s">~${L_.kb} KB/張</span></label>`).join('')}
      </div>
      <div class="section-t">細緻程度</div>
      <div class="group">
        <div class="row"><div class="grow"><div class="t">最小縮放</div><div class="s">大範圍總覽</div></div><div class="stepper"><button data-z="zmin" data-d="-1">−</button><b class="mono">Z${dlForm.zmin}</b><button data-z="zmin" data-d="1">+</button></div></div>
        <div class="row"><div class="grow"><div class="t">最大縮放</div><div class="s">Z15 看得到步道 · Z16 建議 · Z17 最詳細</div></div><div class="stepper"><button data-z="zmax" data-d="-1">−</button><b class="mono">Z${dlForm.zmax}</b><button data-z="zmax" data-d="1">+</button></div></div>
      </div>
      <div class="group" style="margin-top:10px"><label class="row"><div class="t">名稱</div><input type="text" id="dlName" placeholder="${dlForm.mode === 'route' && dlForm.route ? esc(dlForm.route.name) : '例如：雪山主東'}" value="${esc(dlForm.name)}"></label></div>
      <div class="est">
        <div><span>圖磚數量</span><b class="mono">${est ? est.tiles.toLocaleString() : '—'}</b></div>
        <div><span>預估大小</span><b class="mono">${est ? fmtBytes(est.bytes) : '—'}</b></div>
      </div>
      ${tooMany ? '<p class="note" style="color:var(--danger)">範圍太大了，請縮小範圍或降低最大縮放等級（上限 60,000 張）。</p>' : ''}
      ${topoLimit ? `<p class="note" style="color:var(--danger)">OpenTopoMap 為公益伺服器，單次請勿超過 ${LAYERS.topo.dlMax.toLocaleString()} 張。</p>` : ''}
      <button class="btn primary block" id="btnDl" style="margin-top:14px" ${!navigator.onLine || !est || !est.tiles || tooMany || topoLimit ? 'disabled' : ''}>${ICON.dl}開始下載</button>`}
      <div class="section-t">已下載的區域</div>
      ${areas.length ? `<div class="group">${areas.map(a => `
        <div class="row" style="display:block" data-id="${a.id}">
          <div style="display:flex;gap:8px;align-items:center"><div class="t grow">${esc(a.name)}</div>${a.partial ? '<span class="tag warn">未完成</span>' : ''}</div>
          <div class="s">${a.layers.map(k => LAYERS[k]?.name || k).join('、')} · Z${a.zmin}–${a.zmax} · ${a.count.toLocaleString()} 張 · 約 ${fmtBytes(a.bytes || 0)}</div>
          <div class="acts"><button class="mini" data-a="view">在地圖上檢視</button><button class="mini" data-a="redo">重新下載 / 補齊</button><button class="mini red" data-a="del">刪除</button></div>
        </div>`).join('')}</div>` : '<div class="empty">尚未下載任何地圖</div>'}
      ${usage}`;

    if (dl.running) { drawProgress(); $('#btnCancel').onclick = () => { dl.cancel = true; }; }
    else {
      bindSeg('segMode', v => { dlForm.mode = v; if (v === 'route' && !routes.length) { toast('請先匯入 GPX 路線'); dlForm.mode = 'view'; } renderSheet(); });
      bindSeg('segRad', v => { dlForm.radius = +v; renderSheet(); });
      const sel = $('#selRoute'); if (sel) sel.onchange = () => { dlForm.routeId = sel.value; renderSheet(); };
      $$('[data-layer]', el).forEach(c => c.onchange = () => { c.checked ? dlForm.layers.add(c.dataset.layer) : dlForm.layers.delete(c.dataset.layer); renderSheet(); });
      $$('[data-z]', el).forEach(b => b.onclick = () => {
        const k = b.dataset.z; dlForm[k] = Math.max(3, Math.min(18, dlForm[k] + +b.dataset.d));
        if (dlForm.zmin > dlForm.zmax) k === 'zmin' ? dlForm.zmax = dlForm.zmin : dlForm.zmin = dlForm.zmax;
        renderSheet();
      });
      $('#dlName').oninput = e => { dlForm.name = e.target.value; };
      $('#btnDl').onclick = () => {
        const a = buildArea();
        a.name = dlForm.name.trim() || (a.kind === 'route' ? dlForm.route.name : `區域 ${fmtDate(Date.now())}`);
        dlForm.name = '';
        startDownload(a); renderSheet();
      };
    }
    $$('[data-a]', el).forEach(b => b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id, a = areas.find(x => x.id === id);
      if (b.dataset.a === 'view') {
        viewLayer.clearLayers();
        const bb = a.kind === 'bbox' ? a.bounds : a.bbox;
        const rect = [[bb[0], bb[1]], [bb[2], bb[3]]];
        if (a.kind === 'bbox') L.rectangle(rect, { color: '#445E51', weight: 2, fillOpacity: .06, dashArray: '6 6' }).addTo(viewLayer);
        else L.polyline(a.line, { color: '#445E51', weight: Math.max(6, 2 * a.radius / 40), opacity: .18, interactive: false }).addTo(viewLayer);
        setFollow(false); map.fitBounds(rect, { padding: [30, 30] }); closeSheet();
      }
      if (b.dataset.a === 'redo') {
        if (dl.running) return toast('目前有下載進行中');
        if (!navigator.onLine) return toast('目前離線');
        await DB.del('areas', id); a.id = uid(); startDownload(a); renderSheet();
      }
      if (b.dataset.a === 'del') {
        if (await ask('刪除離線地圖？', `「${esc(a.name)}」的圖資會從手機移除（與其他區域重疊的部分會保留）。`, [{ label: '刪除', value: 1, cls: 'danger' }, { label: '取消', value: 0, cls: 'ghost' }])) {
          toast('刪除中…'); await deleteArea(id); toast('已刪除'); renderSheet();
        }
      }
    });
  },
};
map.on('moveend', () => { if (sheetName === 'download' && !dl.running && dlForm.mode === 'view') renderSheet(); });

/* ---------- 網路狀態 ---------- */
function netState() { $('#netChip').classList.toggle('hidden', navigator.onLine); }
window.addEventListener('online', netState); window.addEventListener('offline', netState);

/* ---------- 啟動 ---------- */
(async function init() {
  if (NATIVE) { document.body.classList.add('native'); await NT.load(); if (NP.LocalNotifications) NP.LocalNotifications.requestPermissions().catch(() => {}); }
  if (!setLayer(S.layer)) setLayer('rudy');
  netState();
  startGPS();
  if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (S.activeRoute) await setActiveRoute(S.activeRoute);
  try {
    const cur = await DB.kvGet('current');
    if (cur && cur.start) {
      const r = await ask('有未結束的記錄', `${fmtDate(cur.start)} 開始，已記錄 ${fmtKm(cur.dist || 0)} km。`, [
        { label: '繼續記錄', value: 'go', cls: 'primary' }, { label: '結束並儲存', value: 'save' }, { label: '捨棄', value: 'drop', cls: 'ghost' }]);
      if (r === 'go') startRec(cur);
      else if (r === 'save') finishRec(cur);
      else await DB.kvDel('current');
    }
  } catch (e) {}
  updateNav();
})();
