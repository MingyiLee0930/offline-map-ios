/* 離線地圖 — 回家後（v3）：紀錄註記、年度回顧圖卡、3D 重播錄影；設定頁的錯誤紀錄 */
'use strict';

/* ======================= 紀錄註記 ======================= */
const NOTE_W = ['晴', '多雲', '陰', '雨', '霧', '雪', '強風', '炎熱', '寒冷'];
const NOTE_C = ['路況良好', '濕滑', '泥濘', '倒木', '芒草／箭竹', '崩塌', '螞蝗／蚊蟲', '水源充足', '水源乾涸', '路跡不明'];
const hasNote = t => !!(t.note && (t.note.text || (t.note.w || []).length || (t.note.c || []).length));
function noteSummary(t) {
  if (!hasNote(t)) return '';
  const n = t.note;
  return `${[...(n.w || []), ...(n.c || [])].map(x => `<span class="tag">${esc(x)}</span>`).join(' ')}${n.text ? `<div class="note-txt">${esc(n.text)}</div>` : ''}`;
}
SHEETS.trackNote = {
  title: '註記',
  render(el, t) {
    const n = t.note || { w: [], c: [], text: '' };
    const sel = { w: new Set(n.w || []), c: new Set(n.c || []) };
    el.innerHTML = `
      <button class="back-link" id="tnBack"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>${esc(t.name)}</button>
      <div class="section-t">天氣</div>
      <div class="chips-row wrap">${NOTE_W.map(x => `<button class="chip-k ${sel.w.has(x) ? 'on' : ''}" data-g="w" data-v="${x}">${x}</button>`).join('')}</div>
      <div class="section-t">路況</div>
      <div class="chips-row wrap">${NOTE_C.map(x => `<button class="chip-k ${sel.c.has(x) ? 'on' : ''}" data-g="c" data-v="${x}">${x}</button>`).join('')}</div>
      <div class="section-t">心得</div>
      <textarea id="tnText" class="note-area" rows="5" placeholder="例如：第二個岔路要走左邊；山頂風很大；下次早一點出發">${esc(n.text || '')}</textarea>
      <button class="btn primary block" id="tnSave" style="margin-top:14px">儲存註記</button>
      <p class="note">註記會跟著紀錄一起備份。下次規劃同一座山時可以回來參考。</p>`;
    $$('[data-g]', el).forEach(b => b.onclick = () => {
      const g = sel[b.dataset.g], v = b.dataset.v;
      g.has(v) ? g.delete(v) : g.add(v); b.classList.toggle('on', g.has(v));
    });
    const back = () => openSheet('trackDetail', t);
    $('#tnBack').onclick = back;
    $('#tnSave').onclick = async () => {
      t.note = { w: [...sel.w], c: [...sel.c], text: $('#tnText').value.trim(), t: Date.now() };
      await DB.put('tracks', t); toast('已儲存註記'); back();
    };
  },
};
(() => {
  const orig = SHEETS.trackDetail.render;
  SHEETS.trackDetail.render = function (el, t) {
    orig.call(this, el, t);
    const hero = el.querySelector('.coord-hero'); if (!hero) return;
    const box = document.createElement('div'); box.className = 'group note-box';
    box.innerHTML = `<button class="row" id="tdNote" style="width:100%;text-align:left"><div class="grow"><div class="t">註記</div>
      <div class="s">${hasNote(t) ? noteSummary(t) : '天氣、路況、心得，下次爬同一座山時可以參考'}</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`;
    hero.after(box);
    $('#tdNote').onclick = () => openSheet('trackNote', t);
  };
  const origDone = SHEETS.trackDone.render;
  SHEETS.trackDone.render = function (el, t) {
    origDone.call(this, el, t);
    const ok = $('#tdOk');
    if (ok) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = '加註記'; b.onclick = () => openSheet('trackNote', t);
      const row1 = ok.parentNode, row2 = document.createElement('div'); row2.className = 'btn-row';
      const b3d = [...row1.children].find(x => /3D/.test(x.textContent));
      row2.appendChild(b); if (b3d) row2.appendChild(b3d);
      row1.after(row2);
    }
  };
})();

/* ======================= 分享圖片／影片 ======================= */
async function shareBlob(blob, name) {
  if (NATIVE) {
    // 分段寫入（每段 3 MB），避免大影片一次轉成超長字串吃光記憶體
    const toB64 = part => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(part); });
    const CH = 3 * 1024 * 1024;   // 3 的倍數，base64 才能直接接起來
    let w = null;
    for (let off = 0; off < blob.size || off === 0; off += CH) {
      const data = await toB64(blob.slice(off, off + CH));
      if (off === 0) w = await NP.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
      else await NP.Filesystem.appendFile({ path: name, data, directory: 'CACHE' });
      if (blob.size === 0) break;
    }
    try { await NP.Share.share({ title: name, files: [w.uri] }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

/* ======================= 年度回顧圖卡 ======================= */
const CARD_FONT = '-apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function fitText(ctx, s, maxW) { if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
async function makeYearCard(year) {
  const all = await DB.all('tracks');
  await ensureMoving(all);
  const list = all.filter(t => new Date(t.start).getFullYear() === year);
  if (!list.length) { toast(`${year} 年沒有紀錄`); return; }
  const s = sumUp(list);
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#F5F3EE'; ctx.fillRect(0, 0, W, H);
  // 上方深綠色區塊
  ctx.fillStyle = '#3F5A4C'; rrect(ctx, 0, 0, W, 630, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 3;
  for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(860, 120, 120 + k * 70, 80 + k * 48, -0.3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.font = `700 150px ${CARD_FONT}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(year), 72, 210);
  ctx.font = `600 48px ${CARD_FONT}`; ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillText('登山年度回顧', 78, 285);
  const tiles = [['活動', `${s.n}`, '次'], ['距離', fmtKm(s.dist), 'km'], ['總爬升', Math.round(s.up).toLocaleString(), 'm'], ['移動時間', `${Math.round(s.mov / 3600e3)}`, '小時']];
  tiles.forEach(([l, v, u], i) => {
    const x = 72 + (i % 2) * 480, y = 372 + Math.floor(i / 2) * 132;
    ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = `500 30px ${CARD_FONT}`; ctx.fillText(l, x, y);
    ctx.fillStyle = '#fff'; ctx.font = `700 66px ${CARD_FONT}`; ctx.fillText(v, x, y + 70);
    const vw = ctx.measureText(v).width; ctx.font = `500 30px ${CARD_FONT}`; ctx.fillText(u, x + vw + 10, y + 70);
  });
  // 相當於幾座玉山
  ctx.fillStyle = '#17201B'; ctx.font = `700 40px ${CARD_FONT}`;
  ctx.fillText(`相當於爬了 ${(s.up / 3952).toFixed(1)} 座玉山`, 72, 700);
  ctx.fillStyle = '#5E6B63'; ctx.font = `500 28px ${CARD_FONT}`;
  ctx.fillText(`最高到過海拔 ${s.maxE != null ? Math.round(s.maxE).toLocaleString() + ' m' : '—'} · 總下降 ${Math.round(s.down).toLocaleString()} m`, 72, 746);
  // 每月爬升長條圖
  const mon = Array.from({ length: 12 }, (_, i) => list.filter(t => new Date(t.start).getMonth() === i).reduce((a, t) => a + (t.up || 0), 0));
  const mx = Math.max(...mon, 1), bx = 72, by = 800, bw = 936, bh = 170, gap = 14, w1 = (bw - gap * 11) / 12;
  ctx.fillStyle = '#FFFFFF'; rrect(ctx, 48, by - 30, W - 96, bh + 100, 28); ctx.fill();
  mon.forEach((v, i) => {
    const h = v ? Math.max(8, v / mx * bh) : 0, x = bx + i * (w1 + gap);
    ctx.fillStyle = v === mx && v ? '#C9963F' : '#A9BCB0'; rrect(ctx, x, by + bh - h, w1, h || 0.01, 8); ctx.fill();
    ctx.fillStyle = '#8A958E'; ctx.font = `500 22px ${CARD_FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x + w1 / 2, by + bh + 36); ctx.textAlign = 'left';
  });
  // 爬升最多的幾趟
  const top = [...list].sort((a, b) => (b.up || 0) - (a.up || 0)).slice(0, 4);
  ctx.fillStyle = '#17201B'; ctx.font = `700 32px ${CARD_FONT}`; ctx.fillText('爬升最多的行程', 72, 1100);
  top.forEach((t, i) => {
    const y = 1150 + i * 46;
    ctx.fillStyle = '#17201B'; ctx.font = `500 30px ${CARD_FONT}`;
    ctx.fillText(fitText(ctx, `${new Date(t.start).getMonth() + 1}/${new Date(t.start).getDate()}  ${t.name.replace(/\s*\d{4}\/\d{1,2}\/\d{1,2}\s*軌跡$/, '')}`, 640), 72, y);
    ctx.fillStyle = '#3F5A4C'; ctx.font = `700 30px ${CARD_FONT}`; ctx.textAlign = 'right';
    ctx.fillText(`↑${Math.round(t.up || 0).toLocaleString()} m · ${fmtKm(t.dist || 0)} km`, W - 72, y); ctx.textAlign = 'left';
  });
  ctx.fillStyle = '#8A958E'; ctx.font = `500 22px ${CARD_FONT}`; ctx.fillText('離線地圖 App', 72, H - 40);
  const url = cv.toDataURL('image/png');
  openSheet('yearCard', { url, cv, year });
}
SHEETS.yearCard = {
  title: a => `${a.year} 年度回顧`,
  render(el, a) {
    el.innerHTML = `<img src="${a.url}" alt="${a.year} 年度回顧圖卡" class="year-img">
      <button class="btn primary block" id="ycShare" style="margin-top:14px">${ICON.share}分享圖卡</button>
      <button class="btn ghost block" id="ycBack">回到統計</button>`;
    $('#ycShare').onclick = () => a.cv.toBlob(b => b && shareBlob(b, `登山年度回顧-${a.year}.png`).catch(e => toast('分享失敗：' + (e.message || e))), 'image/png');
    $('#ycBack').onclick = () => openSheet('tracks');
  },
};

/* ======================= 3D 重播錄影 ======================= */
const VREC = { on: false, cancel: false };
function videoMime() {
  if (!window.MediaRecorder) return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  return null;
}
async function record3D() {
  if (VREC.on) return;
  const mime = videoMime(), probe = document.createElement('canvas');
  if (!mime || !probe.captureStream) { toast('這支手機的系統版本不支援錄影，請更新 iOS 後再試', 3500); return; }
  if (!ml || !v3d.ready) { toast('地圖還在載入'); return; }
  stopReplay();
  const t = v3d.t, src = ml.getCanvas();
  const VW = 720, VH = 1280, cv = document.createElement('canvas'); cv.width = VW; cv.height = VH;
  const ctx = cv.getContext('2d');
  const chunks = [], stream = cv.captureStream(30);
  let mr;
  try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3.5e6 }); }
  catch (e) { try { mr = new MediaRecorder(stream); } catch (e2) { toast('無法開始錄影'); logErr('rec3d', e2); return; } }
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  VREC.on = true; VREC.cancel = false;
  const ov = $('#v3dRec'); ov.classList.remove('hidden'); $('#v3dRecTxt').textContent = '準備中…';
  document.body.classList.add('v3d-recording');
  let ok = false;
  try {
  // 先到起點，等圖資載入
  v3d.prog = 0; v3d.brg = null; v3d.ce = null;
  ml.jumpTo({ zoom: 14.2, pitch: 62 }); applyReplay(true);
  await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; ml.once('idle', fin); setTimeout(fin, 4000); });
  const dateS = fmtDate(t.start).split(' ')[0], DUR = 24000;
  const P = prepRoute(t.pts);
  const drawFrame = () => {
    const sw = src.width, sh = src.height, sc = Math.max(VW / sw, VH / sh);
    const dw = sw * sc, dh = sh * sc;
    ctx.fillStyle = '#DCE3DA'; ctx.fillRect(0, 0, VW, VH);
    try { ctx.drawImage(src, (VW - dw) / 2, (VH - dh) / 2, dw, dh); } catch (e) {}
    // 下方資訊卡
    const dm = v3d.prog * v3d.total, p = posAt(dm);
    ctx.fillStyle = 'rgba(255,255,255,.93)'; rrect(ctx, 32, VH - 250, VW - 64, 210, 28); ctx.fill();
    ctx.fillStyle = '#17201B'; ctx.font = `700 40px ${CARD_FONT}`; ctx.fillText(fitText(ctx, t.name, VW - 130), 62, VH - 188);
    ctx.fillStyle = '#5E6B63'; ctx.font = `500 26px ${CARD_FONT}`;
    ctx.fillText(`${dateS} · 全程 ${fmtKm(P.length)} km · 爬升 ${Math.round(P.up).toLocaleString()} m`, 62, VH - 146);
    ctx.fillStyle = '#3F5A4C'; ctx.font = `700 34px ${CARD_FONT}`;
    ctx.fillText(`${fmtKm(dm)} km${p.ele != null ? `   海拔 ${Math.round(p.ele).toLocaleString()} m` : ''}${p.tm != null ? `   ${fmtDur(p.tm - t.start)}` : ''}`, 62, VH - 92);
    ctx.fillStyle = '#E6EEE9'; rrect(ctx, 62, VH - 70, VW - 124, 10, 5); ctx.fill();
    ctx.fillStyle = '#E07B26'; rrect(ctx, 62, VH - 70, Math.max(10, (VW - 124) * v3d.prog), 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `600 22px ${CARD_FONT}`; ctx.fillText('離線地圖 App', 40, 60);
  };
  mr.start(500);
  let last = 0;
  await new Promise(res => {
    const step = ts => {
      if (VREC.cancel || !ml) return res();
      const dt = last ? Math.min(80, ts - last) : 16; last = ts;
      v3d.prog = Math.min(1, v3d.prog + dt / DUR);
      try { applyReplay(true); drawFrame(); } catch (e) { logErr('rec3dFrame', e); VREC.cancel = true; return res(); }
      $('#v3dRecTxt').textContent = `錄影中 ${Math.round(v3d.prog * 100)}%`;
      if (v3d.prog >= 1) { setTimeout(res, 700); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const stopped = new Promise(r => { mr.onstop = r; });
  try { mr.stop(); } catch (e) {}
  await Promise.race([stopped, new Promise(r => setTimeout(r, 3000))]);
  ok = true;
  } catch (e) { logErr('rec3d', e); toast('錄影中斷：' + (e.message || e), 3500); }
  finally {   // 不論成功失敗，一定把畫面恢復，不會卡住
    try { if (mr.state !== 'inactive') mr.stop(); } catch (e) {}
    try { stream.getTracks().forEach(x => x.stop()); } catch (e) {}
    VREC.on = false; ov.classList.add('hidden'); document.body.classList.remove('v3d-recording');
  }
  if (!ok) return;
  if (VREC.cancel || !chunks.length) { if (!VREC.cancel) toast('錄影失敗，請再試一次'); return; }
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  toast(`影片完成（${fmtBytes(blob.size)}）`);
  try { await shareBlob(blob, `${safeName(t.name)}-3D.${ext}`); } catch (e) { toast('分享失敗：' + (e.message || e), 3500); logErr('share3d', e); }
}
(() => {
  const ctl = $('#v3dSpeed'); if (!ctl) return;
  const b = document.createElement('button'); b.className = 'mini'; b.id = 'v3dRecBtn';
  b.innerHTML = '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>錄影';
  b.onclick = () => safe('rec3d', record3D);
  ctl.after(b);
  const ov = document.createElement('div'); ov.id = 'v3dRec'; ov.className = 'v3d-rec glass hidden';
  ov.innerHTML = '<span class="rec-dot"></span><b id="v3dRecTxt"></b><button class="mini red" id="v3dRecStop">取消</button>';
  $('#v3d').appendChild(ov);
  $('#v3dRecStop').onclick = () => { VREC.cancel = true; };
  const _close = close3D;
  close3D = function () { VREC.cancel = true; _close(); };
  $('#v3dClose').onclick = () => close3D();
})();

/* ======================= 設定頁：版本、資料來源、錯誤紀錄 ======================= */
(() => {
  const orig = SHEETS.settings.render;
  SHEETS.settings.render = function (el) {
    orig.call(this, el);
    const last = el.lastElementChild;
    const box = document.createElement('div');
    box.innerHTML = `
      <div class="section-t">錯誤紀錄</div>
      <div class="group"><div class="row"><div class="grow"><div class="t">${ERRLOG.length ? `${ERRLOG.length} 筆` : '沒有錯誤'}</div>
        <div class="s">${ERRLOG.length ? '最近：' + esc(ERRLOG[ERRLOG.length - 1].msg).slice(0, 60) : 'App 運作正常'}</div></div>
        ${ERRLOG.length ? '<button class="mini" id="btnErrCopy">複製</button><button class="mini red" id="btnErrClr">清除</button>' : ''}</div></div>
      <p class="note">如果遇到問題，按「複製」把錯誤紀錄貼給我，就能找出原因。</p>
      <div class="section-t">線上服務（只在有網路時使用，沒有也不影響離線功能）</div>
      <p class="note" style="margin-top:0">天氣、高度：Open-Meteo · 地點：OpenStreetMap（Overpass）· 沿步道連線：BRouter · 3D 地形：AWS Terrain Tiles · 地圖：魯地圖、國土測繪中心、Esri、OpenTopoMap</p>`;
    last.before(box);
    const c = $('#btnErrCopy'); if (c) c.onclick = () => copyText(ERRLOG.map(e => `${fmtDate(e.t)} [${e.where}] ${e.msg} ${e.stack}`).join('\n'));
    const x = $('#btnErrClr'); if (x) x.onclick = () => { ERRLOG.length = 0; try { localStorage.removeItem('offmap-errlog'); } catch (e) {} renderSheet(); };
  };
})();
