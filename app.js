/* app.js — واجهة التطبيق */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const p2 = (n) => String(n).padStart(2, '0');

/* ---------------- التخزين المحلي (IndexedDB) ---------------- */
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('sarfiyat', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('tx', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
    r.onsuccess = () => { db = r.result; res(); }; r.onerror = () => rej(r.error);
  });
  const st = (n, m) => { if (!db) return { getAll: () => null, put: () => null, clear: () => null, get: () => null }; return db.transaction(n, m).objectStore(n); };
  const wrap = (rq) => !rq ? Promise.resolve(null) : new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  return {
    open,
    allTx: () => wrap(st('tx', 'readonly').getAll()),
    putTx: (t) => wrap(st('tx', 'readwrite').put(t)),
    putMany: (arr) => !db ? Promise.resolve() : new Promise((res, rej) => { const tr = db.transaction('tx', 'readwrite'); const s = tr.objectStore('tx'); arr.forEach((t) => s.put(t)); tr.oncomplete = res; tr.onerror = () => rej(tr.error); }),
    clearTx: () => wrap(st('tx', 'readwrite').clear()),
    get: (k) => wrap(st('kv', 'readonly').get(k)),
    set: (k, v) => wrap(st('kv', 'readwrite').put(v, k)),
  };
})();

/* ---------------- الحالة ---------------- */
let S = null; // الحالة
let ui = { tab: 'home', month: null, addType: 'exp', wallet: null, toWallet: null, cat: null, logMonth: null, showOld: false, logFilter: '' };

const defaultSettings = () => ({ monthStart: 27, theme: 'auto', hideBefore: 0, dropbox: { key: '', folder: '/الصرفيات', token: null, refresh: null, exp: 0, dirty: false, last: 0 } });

async function load() {
  try { await DB.open(); } catch (e) { DB.broken = true; }
  const meta = DB.broken ? null : await DB.get('state');
  const tx = DB.broken ? [] : await DB.allTx();
  if (meta) { S = Object.assign({ salaries: {}, anchorTs: 0, settingsUpd: 0 }, meta, { tx }); S.settings = Object.assign(defaultSettings(), S.settings); S.settings.dropbox = Object.assign(defaultSettings().dropbox, S.settings.dropbox); }
  else {
    S = { wallets: Core.DEFAULT_WALLETS.map((w, i) => ({ id: w.id, name: w.name, color: w.color, logo: null, hidden: false, order: i, opening: 0, upd: 1 })), categories: Core.defaultCategories().map((c) => Object.assign(c, { upd: 1 })), tx: [], salaries: {}, anchorTs: 0, settings: defaultSettings(), settingsUpd: 0 };
    await saveMeta();
  }
}
const saveMeta = () => { const { tx, ...rest } = S; return DB.set('state', rest); };
const touchSettings = () => { S.settingsUpd = Date.now(); markDirty(); return saveMeta(); };
function markDirty() { S.settings.dropbox.dirty = true; saveMeta(); scheduleSync(); }
async function putTx(t) { t.upd = Date.now(); const i = S.tx.findIndex((x) => x.id === t.id); if (i >= 0) S.tx[i] = t; else S.tx.push(t); await DB.putTx(t); markDirty(); }
const touchList = (o) => { o.upd = Date.now(); };

/* ---------------- مساعدات ---------------- */
const curKey = () => Core.monthKey(Core.nowLocalTs(), S.settings.monthStart);
const wallets = (all) => S.wallets.filter((w) => all || !w.hidden).sort((a, b) => a.order - b.order);
const cats = (all) => S.categories.filter((c) => all || !c.hidden).sort((a, b) => a.order - b.order);
const wById = (id) => S.wallets.find((w) => w.id === id);
const cById = (id) => S.categories.find((c) => c.id === id);
const walletIcon = (w, cls) => w && w.logo ? `<img class="wlogo ${cls || ''}" src="${w.logo}" alt="">` : `<div class="wlogo ${cls || ''}" style="background:${esc(w ? w.color || '#1f5fa8' : '#888')}">${esc(w ? w.name.slice(0, 1) : '؟')}</div>`;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 2600); }
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
const tsToInput = (ts) => { const p = Core.parts(ts); return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`; };
const inputToTs = (v) => { const m = v.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : Core.nowLocalTs(); };
const parseNum = (s) => { const n = parseFloat(String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,،]/g, '').replace('٫', '.')); return isNaN(n) ? 0 : n; };
function applyTheme() { const t = S.settings.theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }

/* ---------------- التنقل ---------------- */
ui.open = { h: {}, w: {} };
const isOpen = (sc, y, i) => (ui.open[sc][y] !== undefined ? ui.open[sc][y] : i === 0);
document.addEventListener('toggle', (e) => { const d = e.target; if (d.tagName === 'DETAILS' && d.dataset.yr) ui.open[d.dataset.sc][d.dataset.yr] = d.open; }, true);
function go(tab) { ui.tab = tab; render(); window.scrollTo(0, 0); }
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const v = $('#view');
  v.innerHTML = ({ home: vHome, add: vAdd, log: vLog, wallets: vWallets, settings: vSettings })[ui.tab]();
  renderSync();
}
document.addEventListener('click', (e) => {
  const tb = e.target.closest('#tabs button'); if (tb) return go(tb.dataset.tab);
  const a = e.target.closest('[data-act]'); if (!a) return;
  const f = actions[a.dataset.act]; if (f) f(a.dataset, a, e);
});
document.addEventListener('change', (e) => { const a = e.target.closest('[data-chg]'); if (a && actions[a.dataset.chg]) actions[a.dataset.chg](a.dataset, a, e); });

/* ---------------- الرئيسية (لوحة الصرفيات) ---------------- */
function vHome() {
  const ms = S.settings.monthStart; const key = ui.month || curKey(); ui.month = key;
  const m = Core.monthSummary(S, key);
  const over = m.salary > 0 && m.salaryExp > m.salary;
  const pct = m.salary > 0 ? Math.min(100, (m.salaryExp / m.salary) * 100) : 0;
  const keys = Core.monthKeys(S); if (!keys.includes(key)) keys.unshift(key);
  const visible = keys.filter((k) => S.settings.hideBefore ? Core.monthRange(k, ms)[1] >= S.settings.hideBefore || ui.showOld : true);
  const cs = cats().filter((c) => keys.some((k) => Core.monthSummary(S, k).byCat[c.id]) || true);
  const sums = {}; visible.forEach((k) => (sums[k] = Core.monthSummary(S, k)));
  const usedCats = cs.filter((c) => visible.some((k) => sums[k].byCat[c.id]));
  const years = {}; visible.forEach((k) => (years[k.slice(0, 4)] = years[k.slice(0, 4)] || []).push(k));
  const th = `<tr><th>الفترة</th>${usedCats.map((c) => `<th>${esc(c.name)}</th>`).join('')}<th>المصروف</th><th>المتبقي</th><th>الراتب</th><th>نسبة التوفير</th></tr>`;
  const yearTables = Object.keys(years).sort().reverse().map((y, i) => `<details data-sc="h" data-yr="${y}" ${isOpen('h', y, i) ? 'open' : ''}><summary>${y}</summary><div class="tw"><table>${th}${years[y].map((k) => { const s = sums[k]; return `<tr class="${k === key ? 'sel' : ''}" data-act="pickMonth" data-k="${k}"><td><b>${k}</b></td>${usedCats.map((c) => `<td class="${c.kind === 'saving' ? 'sv' : ''}">${s.byCat[c.id] ? fmt(s.byCat[c.id]) : ''}</td>`).join('')}<td><b>${fmt(s.salaryExp)}</b></td><td class="${s.remaining < 0 ? 'bad' : 'good'}">${s.salary ? fmt(s.remaining) : ''}</td><td>${s.salary ? fmt(s.salary) : ''}</td><td>${s.salary ? Math.round((s.remaining / s.salary) * 100) + '%' : ''}</td></tr>`; }).join('')}</table></div></details>`).join('');
  const top = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => `<span class="tag ${cById(id) && cById(id).kind === 'saving' ? 'sv' : ''}">${esc(cById(id) ? cById(id).name : '؟')} ${fmt(v)}</span>`).join(' ');
  return `${over ? `<div class="alert">⚠ تنبيه: صرفت ${fmt(m.salaryExp)} وهذا أكثر من راتب هذا الشهر (${fmt(m.salary)}) بزيادة ${fmt(m.salaryExp - m.salary)}</div>` : ''}
  <div class="card"><div class="row"><h2 class="sp"><b>${key}</b></h2><button class="b sm" data-act="salary" data-k="${key}">الراتب: ${m.salary ? fmt(m.salary) : 'حدد'}</button></div>
  <div class="row"><div class="sp"><div class="mut">مصروف من الراتب</div><div class="big ${over ? 'bad' : ''}">${fmt(m.salaryExp)}</div></div>
  <div class="sp"><div class="mut">المتبقي (التوفير)</div><div class="big ${m.remaining < 0 ? 'bad' : 'good'}">${m.salary ? fmt(m.remaining) : '—'}</div></div></div>
  <div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
  <div class="mut">مشتريات التوفير (لا تُخصم من الراتب): <b class="sav">${fmt(m.savingExp)}</b> · رسوم التحويل: ${fmt(m.fees)} · دخل إضافي: ${fmt(m.income)} · إجمالي الشهر: ${fmt(m.total)}</div>
  <div style="margin-top:8px">${top}</div></div>
  <h3>الأشهر (اضغط على شهر لاختياره)</h3>${yearTables}
  ${S.settings.hideBefore ? `<button class="b sm" data-act="toggleOld">${ui.showOld ? 'إخفاء' : 'إظهار'} التواريخ القديمة</button>` : ''}`;
}

/* ---------------- الإضافة ---------------- */
function vAdd() {
  const ws = wallets(); if (!ui.wallet || !wById(ui.wallet)) ui.wallet = ws[0] && ws[0].id;
  if (ui.addType === 'transfer' && (!ui.toWallet || ui.toWallet === ui.wallet)) ui.toWallet = (ws.find((w) => w.id !== ui.wallet) || {}).id;
  const t = ui.addType;
  const walBtns = (sel, act) => `<div class="wal">${ws.map((w) => `<button class="wb ${sel === w.id ? 'on' : ''}" data-act="${act}" data-id="${w.id}">${walletIcon(w)}<span>${esc(w.name)}</span><span class="mut">${fmt(Core.balances(S)[w.id])}</span></button>`).join('')}</div>`;
  return `<div class="seg"><button class="${t === 'exp' ? 'on' : ''}" data-act="addType" data-t="exp">مصروف</button><button class="${t === 'transfer' ? 'on' : ''}" data-act="addType" data-t="transfer">تحويل</button><button class="${t === 'income' ? 'on' : ''}" data-act="addType" data-t="income">دخل</button></div>
  <div class="card">
  <h3 style="margin-top:0">${t === 'transfer' ? 'من محفظة' : t === 'income' ? 'تدخل في محفظة' : 'ادفع من محفظة'}</h3>${walBtns(ui.wallet, 'pickWallet')}
  ${t === 'transfer' ? `<h3>إلى محفظة</h3>${walBtns(ui.toWallet, 'pickTo')}` : ''}
  ${t === 'exp' ? `<h3>الخصم من</h3><div class="src"><button class="b ${(ui.pay || 'salary') === 'salary' ? 'pri' : ''}" data-act="pickPay" data-p="salary">الراتب</button><button class="b ${ui.pay === 'saving' ? 'pri' : ''}" data-act="pickPay" data-p="saving">التوفير</button></div><h3>التصنيف</h3><div class="cats">${cats().map((c) => `<button class="cb ${c.kind === 'saving' ? 'sv' : ''} ${ui.cat === c.id ? 'on' : ''}" data-act="pickCat" data-id="${c.id}">${c.logo ? `<img src="${c.logo}" style="width:22px;height:22px;border-radius:5px;vertical-align:middle;margin-left:6px">` : ''}${esc(c.name)}</button>`).join('')}</div>` : ''}
  <div class="row"><div class="sp"><label class="f">${t === 'exp' ? 'السعر' : 'المبلغ'}</label><input id="f_amt" inputmode="decimal" placeholder="0"></div>
  ${t === 'exp' ? `<div style="width:90px"><label class="f">الكمية</label><input id="f_qty" inputmode="decimal" value="1"></div>` : ''}
  ${t === 'transfer' ? `<div style="width:120px"><label class="f">+ رسوم</label><input id="f_fee" inputmode="decimal" placeholder="0"></div>` : ''}</div>
  ${t === 'exp' ? `<div class="mut" id="totalHint"></div>` : ''}
  <label class="f">ملاحظة (اختياري)</label><input id="f_note" placeholder="${t === 'income' ? 'راتب / مكافأة / استرجاع…' : 'مثال: فطور'}">
  <label class="f">الوقت والتاريخ (تلقائي الآن — عدّله لو تبي)</label><input id="f_ts" type="datetime-local" value="${tsToInput(Core.nowLocalTs())}">
  <button class="b pri" style="width:100%;padding:14px" data-act="saveNew">حفظ</button></div>`;
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'f_amt' || e.target.id === 'f_qty') { const h = $('#totalHint'); if (h) h.textContent = 'الإجمالي: ' + fmt(parseNum($('#f_amt').value) * (parseNum($('#f_qty').value) || 1)); }
});

/* ---------------- السجل ---------------- */
function vLog() {
  const ms = S.settings.monthStart; const keys = Core.monthKeys(S); const key = ui.logMonth || ui.month || curKey(); ui.logMonth = key;
  const list = S.tx.filter((t) => !t.del && Core.monthKey(t.ts, ms) === key).filter((t) => !ui.logFilter || ((cById(t.cat) || {}).name || '').includes(ui.logFilter) || (t.note || '').includes(ui.logFilter)).sort((a, b) => b.ts - a.ts);
  const byDay = {}; list.forEach((t) => (byDay[Core.fmtDate(t.ts)] = byDay[Core.fmtDate(t.ts)] || []).push(t));
  return `<div class="card"><div class="row"><select id="logSel" data-chg="logMonth" style="flex:3">${[...new Set([key, ...keys])].sort().reverse().map((k) => `<option value="${k}" ${k === key ? 'selected' : ''}>${k}</option>`).join('')}</select><input id="logQ" placeholder="بحث" value="${esc(ui.logFilter)}" data-chg="logQ" style="flex:1;min-width:0;width:90px"></div>
  <div class="mut">${list.length} عملية</div></div>
  ${Object.keys(byDay).map((d) => `<div class="card"><h3 style="margin-top:0">${d}</h3>${byDay[d].map(itemHtml).join('')}</div>`).join('') || '<div class="card mut">لا توجد عمليات</div>'}`;
}
function itemHtml(t) {
  const c = cById(t.cat), w = wById(t.wallet), w2 = wById(t.to);
  let title, tag, amt, cls = '';
  if (t.type === 'transfer') { title = `${esc(w ? w.name : '؟')} ← ${esc(w2 ? w2.name : '؟')}`; tag = '<span class="tag tr">تحويل</span>'; amt = fmt(t.amount) + (t.fee ? ` <span class="mut">(+${fmt(t.fee)})</span>` : ''); }
  else if (t.type === 'income') { title = 'دخل'; tag = `<span class="tag">${esc(w ? w.name : '')}</span>`; amt = '+' + fmt(t.amount); cls = 'good'; }
  else { title = esc(c ? c.name : '؟'); tag = `<span class="tag ${c && c.kind === 'saving' ? 'sv' : ''}">${esc(t.legacy ? 'قديم' : w ? w.name : '')}</span>`; amt = fmt(t.amount); }
  return `<div class="item" data-act="editTx" data-id="${esc(t.id)}"><div class="sp"><div><b>${title}</b> ${tag}</div><div class="mut">${Core.fmtTime(t.ts)}${t.qty && t.qty !== 1 ? ' · ×' + t.qty : ''}${t.note ? ' · ' + esc(t.note) : ''}</div></div><div class="amt ${cls}">${amt}</div></div>`;
}

/* ---------------- المحافظ ---------------- */
function walletSeries() {
  // الرصيد في أي لحظة = الرصيد الحالي − أثر كل العمليات بعد تلك اللحظة (يشمل ما قبل التثبيت)
  const out = {}; const fin = Core.balances(S);
  wallets(true).forEach((w) => { const arr = []; S.tx.forEach((t) => { if (t.del) return; const e = Core.effect(t, w.id); if (e) arr.push([t.ts, e]); }); arr.sort((x, y) => x[0] - y[0]); const pre = []; let c = 0; arr.forEach(([ts, e]) => { c += e; pre.push([ts, c]); }); out[w.id] = { fin: fin[w.id] || 0, pre, total: c }; });
  return out;
}
function balAt(ser, ts) {
  const c = ser.pre; let lo = 0, hi = c.length - 1, idx = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid][0] <= ts) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const upTo = idx < 0 ? 0 : c[idx][1];
  return Core.round2(ser.fin - (ser.total - upTo));
}
function vWallets() {
  const bal = Core.balances(S); const ser = walletSeries(); const ms = S.settings.monthStart; const ws = wallets();
  const total = ws.reduce((s, w) => s + (bal[w.id] || 0), 0);
  const keys = Core.monthKeys(S).filter((k) => Core.monthRange(k, ms)[0] >= (S.anchorTs ? 0 : 0));
  const years = {}; keys.forEach((k) => (years[k.slice(0, 4)] = years[k.slice(0, 4)] || []).push(k));
  const head = `<tr><th rowspan="2">الفترة</th>${ws.map((w) => `<th colspan="3">${esc(w.name)}</th>`).join('')}<th colspan="3">الكلي</th></tr><tr>${[...ws, 0].map(() => '<th>بداية الشهر</th><th>نهاية الشهر</th><th>الفرق</th>').join('')}</tr>`;
  const tbl = Object.keys(years).sort().reverse().map((y, i) => `<details data-sc="w" data-yr="${y}" ${isOpen('w', y, i) ? 'open' : ''}><summary>${y}</summary><div class="tw"><table>${head}${years[y].map((k) => { const [a, b] = Core.monthRange(k, ms); let s0 = 0, s1 = 0; const cells = ws.map((w) => { const x = balAt(ser[w.id], a - 1), y2 = balAt(ser[w.id], b); s0 += x; s1 += y2; return `<td>${fmt(x)}</td><td>${fmt(y2)}</td><td class="${y2 - x < 0 ? 'bad' : 'good'}">${fmt(y2 - x)}</td>`; }).join(''); return `<tr><td><b>${k}</b></td>${cells}<td>${fmt(s0)}</td><td>${fmt(s1)}</td><td class="${s1 - s0 < 0 ? 'bad' : 'good'}">${fmt(s1 - s0)}</td></tr>`; }).join('')}</table></div></details>`).join('');
  return `<div class="card"><h2>الأرصدة الحالية</h2><div class="wal">${ws.map((w) => `<div class="wb">${walletIcon(w)}<b>${esc(w.name)}</b><span>${fmt(bal[w.id])}</span></div>`).join('')}</div><div class="row"><div class="sp mut">الكلي</div><div class="big">${fmt(total)}</div></div>
  <div class="mut">الأرصدة تتحدث تلقائياً مع كل عملية. السجلات القديمة (قبل 2020) بدون محفظة ولا تؤثر على الأرصدة.</div></div>
  <h3>بداية ونهاية كل شهر (مثل شيت total)</h3>${tbl}`;
}

/* ---------------- الإعدادات ---------------- */
function vSettings() {
  const d = S.settings.dropbox;
  return `<div class="card"><h2>الشهر والمظهر</h2>
  <label class="f">يبدأ الشهر من اليوم (ويمتد لقبل اليوم نفسه من الشهر التالي)</label><input id="s_ms" type="number" min="1" max="28" value="${S.settings.monthStart}" data-chg="setMs">
  <label class="f">المظهر</label><select data-chg="setTheme">${[['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'غامق']].map(([v, l]) => `<option value="${v}" ${S.settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <label class="f">إخفاء الأشهر قبل تاريخ (لا يحذفها)</label><input type="date" value="${S.settings.hideBefore ? Core.fmtDate(S.settings.hideBefore).replace(/\//g, '-') : ''}" data-chg="setHide"></div>
  <div class="card"><h2>المحافظ</h2>${wallets(true).map((w, i) => `<div class="item">${walletIcon(w, 'mini')}<div class="sp" data-act="editWallet" data-id="${w.id}" style="cursor:pointer"><b>${esc(w.name)}</b>${w.hidden ? ' <span class="mut">(مخفية)</span>' : ''}</div><span class="drag"><button class="b sm" data-act="moveW" data-id="${w.id}" data-d="-1">▲</button><button class="b sm" data-act="moveW" data-id="${w.id}" data-d="1">▼</button></span></div>`).join('')}<button class="b" style="margin-top:8px" data-act="editWallet" data-id="">+ محفظة جديدة</button></div>
  <div class="card"><h2>التصنيفات</h2><div class="mut">كل تصنيف: يُحسب على راتب الشهر أو على التوفير. الحذف = إخفاء (العمليات القديمة تبقى).</div>${cats(true).map((c) => `<div class="item">${walletIcon({ name: c.name, logo: c.logo, color: '#6b736e' }, 'mini')}<div class="sp ${c.hidden ? 'mut' : ''}" data-act="editCat" data-id="${c.id}" style="cursor:pointer"><b>${esc(c.name)}</b> <span class="tag ${c.kind === 'saving' ? 'sv' : ''}">${c.kind === 'saving' ? 'توفير' : 'راتب'}</span>${c.hidden ? ' (مخفي)' : ''}</div><span class="drag"><button class="b sm" data-act="moveC" data-id="${c.id}" data-d="-1">▲</button><button class="b sm" data-act="moveC" data-id="${c.id}" data-d="1">▼</button></span></div>`).join('')}<button class="b" style="margin-top:8px" data-act="editCat" data-id="">+ تصنيف جديد</button></div>
  <div class="card"><h2>Excel</h2><div class="row"><label class="b pri sp" style="text-align:center">استيراد من Excel<input type="file" accept=".xlsx,.xls" data-chg="importXlsx"></label><button class="b sp" data-act="exportXlsx">تصدير إلى Excel</button></div><div class="mut" style="margin-top:6px">الاستيراد يكرر نفس عمليات الملف بدون تضاعف لو استوردت مرتين. العمليات اللي أضفتها من التطبيق لا تُمس.</div></div>
  <div class="card"><h2>Dropbox</h2>
  <div class="mut">الربط يخلي ملف Excel يتحدث في مجلد Dropbox بعد كل مزامنة، والعمليات بدون نت تنحفظ وتنرفع لما يرجع النت. الدمج تلقائي حسب الوقت وبدون فقدان بيانات.</div>
  <label class="f">App key (من dropbox.com/developers → Create app → Scoped access → Full Dropbox أو App folder)</label><input id="d_key" value="${esc(d.key)}" data-chg="dbKey" placeholder="App key">
  <label class="f">مجلد Dropbox</label><input id="d_folder" value="${esc(d.folder)}" data-chg="dbFolder">
  <div class="mut">Redirect URI المطلوب إضافته في إعدادات تطبيق Dropbox: <b dir="ltr">${esc(location.origin + location.pathname)}</b></div>
  <div class="row" style="margin-top:8px">${d.token ? `<button class="b pri" data-act="syncNow">مزامنة الآن</button><button class="b dng" data-act="dbLogout">فصل</button>` : `<button class="b pri" data-act="dbLogin">ربط Dropbox</button>`}</div>
  <div class="mut" id="syncInfo">${d.last ? 'آخر مزامنة: ' + new Date(d.last).toLocaleString('ar') : ''}</div></div>
  <div class="card"><h2>نسخة احتياطية</h2><div class="row"><button class="b sp" data-act="backupJson">حفظ نسخة JSON</button><label class="b sp" style="text-align:center">استرجاع من JSON<input type="file" accept=".json" data-chg="restoreJson"></label></div></div>`;
}

/* ---------------- الإجراءات ---------------- */
const actions = {
  pickMonth: (d) => { const y = window.scrollY; ui.month = d.k; render(); window.scrollTo(0, y); },
  toggleOld: () => { ui.showOld = !ui.showOld; render(); },
  addType: (d) => { ui.addType = d.t; ui.cat = null; ui.pay = null; ui.payManual = false; render(); },
  pickWallet: (d) => { keepFields(); ui.wallet = d.id; render(); restoreFields(); },
  pickTo: (d) => { keepFields(); ui.toWallet = d.id; render(); restoreFields(); },
  pickCat: (d) => { keepFields(); ui.cat = d.id; if (!ui.payManual) ui.pay = (cById(d.id) || {}).kind || 'salary'; render(); restoreFields(); },
  pickPay: (d) => { keepFields(); ui.pay = d.p; ui.payManual = true; render(); restoreFields(); },
  logMonth: (d, el) => { ui.logMonth = el.value; render(); },
  logQ: (d, el) => { ui.logFilter = el.value.trim(); render(); const q = $('#logQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } },
  salary: (d) => { const cur = S.salaries[d.k] || ''; modal(`<h2>راتب شهر ${d.k}</h2><input id="m_sal" inputmode="decimal" value="${cur}"><div class="row"><button class="b pri sp" data-act="saveSalary" data-k="${d.k}">حفظ</button><button class="b" onclick="closeModal()">إلغاء</button></div>`); },
  saveSalary: async (d) => { S.salaries[d.k] = parseNum($('#m_sal').value); await touchSettings(); closeModal(); render(); },
  saveNew: async () => {
    const t = ui.addType; const amt = parseNum($('#f_amt').value); if (!amt) return toast('اكتب المبلغ', true);
    if (!ui.wallet) return toast('اختر المحفظة', true);
    const ts = inputToTs($('#f_ts').value); const note = $('#f_note').value.trim();
    let rec;
    if (t === 'exp') { if (!ui.cat) return toast('اختر التصنيف', true); const q = parseNum($('#f_qty').value) || 1; rec = { id: Core.uid(), ts, type: 'exp', pay: ui.pay || (cById(ui.cat) || {}).kind || 'salary', wallet: ui.wallet, cat: ui.cat, unit: amt, qty: q, amount: Core.round2(amt * q), note }; }
    else if (t === 'transfer') { if (!ui.toWallet || ui.toWallet === ui.wallet) return toast('اختر محفظتين مختلفتين', true); rec = { id: Core.uid(), ts, type: 'transfer', wallet: ui.wallet, to: ui.toWallet, amount: amt, fee: parseNum($('#f_fee').value), qty: 1, cat: null, note }; }
    else rec = { id: Core.uid(), ts, type: 'income', wallet: ui.wallet, amount: amt, qty: 1, cat: null, note };
    await putTx(rec);
    const k = Core.monthKey(ts, S.settings.monthStart); const m = Core.monthSummary(S, k);
    const over = m.salary > 0 && m.salaryExp > m.salary;
    ui.cat = null; ui.pay = null; ui.payManual = false; ui.month = k; render();
    toast(over ? `⚠ تم الحفظ — تجاوزت راتب الشهر بمقدار ${fmt(m.salaryExp - m.salary)}` : 'تم الحفظ ✓', over);
  },
  editTx: (d) => {
    const t = S.tx.find((x) => x.id === d.id); if (!t) return;
    const wOpts = (sel) => wallets(true).map((w) => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    modal(`<h2>تعديل عملية</h2>${t.legacy ? '' : `<label class="f">المحفظة</label><select id="e_w">${wOpts(t.wallet)}</select>`}
    ${t.type === 'transfer' ? `<label class="f">إلى</label><select id="e_to">${wOpts(t.to)}</select><label class="f">الرسوم</label><input id="e_fee" value="${t.fee || 0}" inputmode="decimal">` : ''}
    ${t.type === 'exp' ? `<label class="f">التصنيف</label><select id="e_c">${cats(true).map((c) => `<option value="${c.id}" ${c.id === t.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><label class="f">الخصم من</label><select id="e_p"><option value="salary" ${(t.pay || (cById(t.cat) || {}).kind) !== 'saving' ? 'selected' : ''}>الراتب</option><option value="saving" ${(t.pay || (cById(t.cat) || {}).kind) === 'saving' ? 'selected' : ''}>التوفير</option></select><label class="f">الكمية</label><input id="e_q" value="${t.qty || 1}" inputmode="decimal"><label class="f">السعر</label><input id="e_u" value="${t.unit != null && !isNaN(t.unit) ? t.unit : Core.round2(t.amount / (t.qty || 1))}" inputmode="decimal">` : `<label class="f">المبلغ</label><input id="e_a" value="${t.amount}" inputmode="decimal">`}
    <label class="f">ملاحظة</label><input id="e_n" value="${esc(t.note || '')}"><label class="f">الوقت</label><input id="e_ts" type="datetime-local" value="${tsToInput(t.ts)}">
    <div class="row"><button class="b pri sp" data-act="saveEdit" data-id="${t.id}">حفظ</button><button class="b dng" data-act="delTx" data-id="${t.id}">حذف</button><button class="b" onclick="closeModal()">إلغاء</button></div>`);
  },
  saveEdit: async (d) => {
    const t = Object.assign({}, S.tx.find((x) => x.id === d.id)); const g = (i) => $('#' + i);
    if (g('e_w')) t.wallet = g('e_w').value; if (g('e_to')) { t.to = g('e_to').value; t.fee = parseNum(g('e_fee').value); }
    if (t.type === 'exp') { t.cat = g('e_c').value; t.pay = g('e_p').value; t.qty = parseNum(g('e_q').value) || 1; t.unit = parseNum(g('e_u').value); t.amount = Core.round2(t.unit * t.qty); } else t.amount = parseNum(g('e_a').value);
    t.note = g('e_n').value.trim(); t.ts = inputToTs(g('e_ts').value);
    await putTx(t); closeModal(); render(); toast('تم التعديل ✓');
  },
  delTx: async (d) => { if (!confirm('حذف العملية؟')) return; const t = Object.assign({}, S.tx.find((x) => x.id === d.id), { del: true }); await putTx(t); closeModal(); render(); toast('تم الحذف'); },
  setMs: async (d, el) => { const v = Math.max(1, Math.min(28, parseInt(el.value) || 1)); S.settings.monthStart = v; ui.month = null; ui.logMonth = null; await touchSettings(); toast('تم الحفظ'); },
  setTheme: async (d, el) => { S.settings.theme = el.value; applyTheme(); await touchSettings(); },
  setHide: async (d, el) => { S.settings.hideBefore = el.value ? inputToTs(el.value + 'T00:00') : 0; await touchSettings(); },
  editWallet: (d) => {
    const w = d.id ? wById(d.id) : { id: '', name: '', opening: 0, hidden: false, logo: null };
    ui.tmpLogo = w.logo || null;
    modal(`<h2>${d.id ? 'تعديل محفظة' : 'محفظة جديدة'}</h2><label class="f">الاسم</label><input id="w_n" value="${esc(w.name)}">
    <label class="f">الرصيد الحالي (يُحتسب منه أي تغيير لاحق)</label><input id="w_o" value="${d.id ? Core.balances(S)[w.id] : 0}" inputmode="decimal">
    <label class="f">الشعار (يتصغر تلقائياً لمقاس زر المحفظة)</label><div class="row"><div id="w_prev">${walletIcon({ name: w.name || '؟', logo: ui.tmpLogo, color: w.color })}</div><label class="b">اختر صورة<input type="file" accept="image/*" data-chg="logoFile"></label><button class="b sm" data-act="clearLogo">إزالة</button></div>
    <label class="f"><input type="checkbox" id="w_h" ${w.hidden ? 'checked' : ''}> إخفاء المحفظة</label>
    <div class="row"><button class="b pri sp" data-act="saveWallet" data-id="${d.id}">حفظ</button>${d.id ? `<button class="b dng" data-act="delWallet" data-id="${d.id}">حذف</button>` : ''}<button class="b" onclick="closeModal()">إلغاء</button></div>`);
  },
  logoFile: (d, el) => { const f = el.files[0]; if (!f) return; const img = new Image(); const url = URL.createObjectURL(f); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96); ui.tmpLogo = c.toDataURL('image/png'); URL.revokeObjectURL(url); $('#w_prev').innerHTML = walletIcon({ name: '', logo: ui.tmpLogo }); }; img.src = url; },
  clearLogo: () => { ui.tmpLogo = null; $('#w_prev').innerHTML = walletIcon({ name: $('#w_n').value || '؟', logo: null }); },
  saveWallet: async (d) => {
    const name = $('#w_n').value.trim(); if (!name) return toast('اكتب اسم المحفظة', true);
    let w = d.id ? wById(d.id) : null; const wantBal = parseNum($('#w_o').value);
    if (!w) { w = { id: 'w' + Date.now().toString(36), name, color: '#1f5fa8', logo: null, hidden: false, order: S.wallets.length, opening: 0 }; S.wallets.push(w); }
    const cur = Core.balances(S)[w.id] || 0; w.opening = Core.round2((w.opening || 0) + (wantBal - cur));
    w.name = name; w.logo = ui.tmpLogo; w.hidden = $('#w_h').checked; touchList(w);
    if (!S.anchorTs) S.anchorTs = 1; await touchSettings(); closeModal(); render();
  },
  delWallet: async (d) => { const w = wById(d.id); if (!w || !confirm(`حذف المحفظة «${w.name}»؟\nستختفي من القوائم وتبقى عملياتها السابقة محفوظة، وتقدر تعيدها من التعديل.`)) return; w.hidden = true; touchList(w); await touchSettings(); closeModal(); render(); toast('تم حذف (إخفاء) المحفظة'); },
  delCat: async (d) => { const c = cById(d.id); if (!c || !confirm(`حذف التصنيف «${c.name}»؟\nسيختفي من القوائم وتبقى عملياته السابقة محفوظة، وتقدر تعيده من التعديل.`)) return; c.hidden = true; touchList(c); await touchSettings(); closeModal(); render(); toast('تم حذف (إخفاء) التصنيف'); },
  moveW: async (d) => { const l = wallets(true); const i = l.findIndex((w) => w.id === d.id), j = i + +d.d; if (j < 0 || j >= l.length) return; [l[i].order, l[j].order] = [l[j].order, l[i].order]; touchList(l[i]); touchList(l[j]); await touchSettings(); render(); },
  editCat: (d) => {
    const c = d.id ? cById(d.id) : { name: '', kind: 'salary', hidden: false, logo: null };
    ui.tmpLogo = c.logo || null;
    modal(`<h2>${d.id ? 'تعديل تصنيف' : 'تصنيف جديد'}</h2><label class="f">الاسم</label><input id="c_n" value="${esc(c.name)}"><label class="f">يُحسب على</label><select id="c_k"><option value="salary" ${c.kind === 'salary' ? 'selected' : ''}>راتب نفس الشهر</option><option value="saving" ${c.kind === 'saving' ? 'selected' : ''}>التوفير</option></select>
    <label class="f">الشعار (اختياري — يتصغر تلقائياً)</label><div class="row"><div id="w_prev">${walletIcon({ name: c.name || '؟', logo: ui.tmpLogo, color: '#6b736e' })}</div><label class="b">اختر صورة<input type="file" accept="image/*" data-chg="logoFile"></label><button class="b sm" data-act="clearLogo">إزالة</button></div>
    <label class="f"><input type="checkbox" id="c_h" ${c.hidden ? 'checked' : ''}> إخفاء (حذف من القائمة مع بقاء العمليات)</label><div class="row"><button class="b pri sp" data-act="saveCat" data-id="${d.id}">حفظ</button>${d.id ? `<button class="b dng" data-act="delCat" data-id="${d.id}">حذف</button>` : ''}<button class="b" onclick="closeModal()">إلغاء</button></div>`);
  },
  saveCat: async (d) => {
    const name = $('#c_n').value.trim(); if (!name) return toast('اكتب الاسم', true);
    let c = d.id ? cById(d.id) : null; if (!c) { c = { id: 'c' + Date.now().toString(36), order: S.categories.length }; S.categories.push(c); }
    c.name = name; c.kind = $('#c_k').value; c.hidden = $('#c_h').checked; c.logo = ui.tmpLogo; touchList(c); await touchSettings(); closeModal(); render();
  },
  moveC: async (d) => { const l = cats(true); const i = l.findIndex((c) => c.id === d.id), j = i + +d.d; if (j < 0 || j >= l.length) return; [l[i].order, l[j].order] = [l[j].order, l[i].order]; touchList(l[i]); touchList(l[j]); await touchSettings(); render(); },
  importXlsx: async (d, el) => {
    const f = el.files[0]; if (!f) return;
    try {
      toast('جاري قراءة الملف…');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheets = {}; wb.SheetNames.forEach((n) => (sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })));
      const r = Core.importSheets(sheets);
      const cnt = r.tx.length;
      modal(`<h2>نتيجة قراءة الملف</h2><div class="mut" style="white-space:pre-line">${esc(r.log.join('\n'))}</div><p>سيتم إضافة/تحديث <b>${cnt}</b> عملية، وضبط أرصدة المحافظ حسب آخر شيت، والرواتب (${Object.keys(r.salaries).length} شهر). العمليات اللي أضفتها من التطبيق ما تتغير.</p><div class="row"><button class="b pri sp" data-act="doImport">تأكيد الاستيراد</button><button class="b" onclick="closeModal()">إلغاء</button></div>`);
      ui.pending = r;
    } catch (e2) { toast('تعذر قراءة الملف: ' + e2.message, true); }
    el.value = '';
  },
  doImport: async () => {
    const r = ui.pending; if (!r) return;
    // نحتفظ بالمحافظ/التصنيفات الحالية (تعديلات المستخدم)، ونضيف الناقص
    const keepW = new Set(S.wallets.map((w) => w.id)); const nameW = {}; S.wallets.forEach((w) => (nameW[w.name] = w.id));
    r.wallets.forEach((w) => { if (!keepW.has(w.id) && !nameW[w.name]) { w.upd = Date.now(); S.wallets.push(w); } else { const cur = S.wallets.find((x) => x.id === w.id); if (cur) { cur.opening = w.opening; touchList(cur); } } });
    const idMap = {}; const nameC = {}; S.categories.forEach((c) => (nameC[c.name] = c));
    r.categories.forEach((c) => { if (nameC[c.name]) idMap[c.id] = nameC[c.name].id; else { const n = Object.assign({}, c, { id: 'c' + Date.now().toString(36) + c.id, order: S.categories.length, upd: Date.now() }); S.categories.push(n); idMap[c.id] = n.id; nameC[n.name] = n; } });
    const now = Date.now(); const fresh = r.tx.map((t) => Object.assign({}, t, { cat: t.cat ? idMap[t.cat] : null, upd: now }));
    const keepOther = S.tx.filter((t) => !String(t.id).startsWith('imp-'));
    S.tx = keepOther.concat(fresh); await DB.clearTx(); await DB.putMany(S.tx);
    Object.assign(S.salaries, r.salaries); S.anchorTs = r.anchorTs;
    await touchSettings(); closeModal(); ui.pending = null; ui.month = null; render(); toast(`تم استيراد ${fresh.length} عملية ✓`);
  },
  exportXlsx: () => { const wb = Core.exportWorkbook(XLSX, S); XLSX.writeFile(wb, 'الصرفيات.xlsx'); },
  backupJson: () => { const blob = new Blob([JSON.stringify(S)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sarfiyat-backup-' + Core.fmtDate(Core.nowLocalTs()).replace(/\//g, '-') + '.json'; a.click(); },
  restoreJson: async (d, el) => { const f = el.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (!confirm('سيتم دمج النسخة مع بياناتك الحالية (بدون حذف). متابعة؟')) return; await applyMerged(Core.mergeStates(S, o)); toast('تم الاسترجاع ✓'); render(); } catch (e) { toast('ملف غير صالح', true); } el.value = ''; },
  dbKey: async (d, el) => { S.settings.dropbox.key = el.value.trim(); await saveMeta(); },
  dbFolder: async (d, el) => { let v = el.value.trim(); if (!v.startsWith('/')) v = '/' + v; S.settings.dropbox.folder = v.replace(/\/$/, ''); await saveMeta(); },
  dbLogin: () => Dropbox.login(),
  dbLogout: async () => { Object.assign(S.settings.dropbox, { token: null, refresh: null, exp: 0 }); await saveMeta(); render(); },
  syncNow: () => syncNow(true),
};
let kept = {};
function keepFields() { kept = {}; ['f_amt', 'f_qty', 'f_fee', 'f_note', 'f_ts'].forEach((i) => { const e = $('#' + i); if (e) kept[i] = e.value; }); }
function restoreFields() { Object.entries(kept).forEach(([i, v]) => { const e = $('#' + i); if (e) e.value = v; }); }

/* ---------------- Dropbox ---------------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const Dropbox = {
  async login() {
    const d = S.settings.dropbox; if (!d.key) return toast('اكتب App key أولاً', true);
    const ver = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const ch = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver)));
    sessionStorage.setItem('dbx_ver', ver);
    const redirect = location.origin + location.pathname;
    location.href = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(d.key)}&response_type=code&code_challenge=${ch}&code_challenge_method=S256&token_access_type=offline&redirect_uri=${encodeURIComponent(redirect)}`;
  },
  async finish(code) {
    const d = S.settings.dropbox; const ver = sessionStorage.getItem('dbx_ver');
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: d.key, code_verifier: ver, redirect_uri: location.origin + location.pathname });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body }); const j = await r.json();
    if (!j.access_token) throw new Error(j.error_description || 'فشل الربط');
    d.token = j.access_token; d.refresh = j.refresh_token; d.exp = Date.now() + (j.expires_in - 60) * 1000; await saveMeta();
  },
  async tok() {
    const d = S.settings.dropbox; if (!d.token) throw new Error('غير مربوط');
    if (Date.now() > d.exp && d.refresh) {
      const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: d.key }) }); const j = await r.json();
      if (!j.access_token) throw new Error('انتهت صلاحية الربط، اربط من جديد'); d.token = j.access_token; d.exp = Date.now() + (j.expires_in - 60) * 1000; await saveMeta();
    }
    return d.token;
  },
  async download(path) {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: 'Bearer ' + (await this.tok()), 'Dropbox-API-Arg': JSON.stringify({ path }).replace(/[\u0080-￿]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)) } });
    if (r.status === 409) return null; if (!r.ok) throw new Error('Dropbox ' + r.status);
    const rev = JSON.parse(r.headers.get('dropbox-api-result') || '{}').rev; return { rev, data: await r.arrayBuffer() };
  },
  async upload(path, data, mode) {
    const arg = JSON.stringify({ path, mode: mode || 'overwrite', mute: true, autorename: false }).replace(/[\u0080-￿]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + (await this.tok()), 'Dropbox-API-Arg': arg, 'Content-Type': 'application/octet-stream' }, body: data });
    if (!r.ok) throw new Error('رفع Dropbox فشل ' + r.status + ' ' + (await r.text()).slice(0, 120)); return r.json();
  },
};
let syncing = false, syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); if (S && S.settings.dropbox.token) syncTimer = setTimeout(() => syncNow(false), 4000); renderSync(); }
function renderSync() {
  const el = $('#syncState'); if (!el || !S) return; const d = S.settings.dropbox;
  if (!d.token) { el.textContent = ''; el.className = 'sync'; return; }
  if (!navigator.onLine) { el.textContent = d.dirty ? 'بدون نت — محفوظ محلياً' : 'بدون نت'; el.className = 'sync off'; } else if (d.err) { el.textContent = 'خطأ مزامنة'; el.className = 'sync err'; } else { el.textContent = d.dirty ? 'بانتظار المزامنة' : 'متزامن'; el.className = 'sync ok'; }
}
async function applyMerged(m) {
  S.tx = m.tx; S.wallets = m.wallets; S.categories = m.categories; S.salaries = m.salaries; S.settingsUpd = m.settingsUpd;
  S.settings = Object.assign({}, m.settings, { dropbox: S.settings.dropbox }); if (m.anchorTs) S.anchorTs = m.anchorTs;
  await DB.clearTx(); await DB.putMany(S.tx); await saveMeta(); applyTheme();
}
async function syncNow(manual) {
  const d = S.settings.dropbox; if (!d.token || syncing) return; if (!navigator.onLine) { renderSync(); if (manual) toast('ما فيه اتصال، التغييرات محفوظة وتنرفع لاحقاً', true); return; }
  syncing = true; d.err = null;
  try {
    const base = d.folder || '/الصرفيات'; const jpath = base + '/sarfiyat-data.json'; const xpath = base + '/الصرفيات.xlsx';
    // 1) نزّل ملف البيانات، ادمج
    const remote = await Dropbox.download(jpath);
    if (remote) {
      const rs = JSON.parse(new TextDecoder().decode(remote.data));
      // نسخة احتياطية من النسخة البعيدة قبل أي كتابة
      const stamp = Core.fmtDate(Core.nowLocalTs()).replace(/\//g, '-');
      await Dropbox.upload(`${base}/backup/sarfiyat-data-${stamp}.json`, remote.data, 'overwrite');
      await applyMerged(Core.mergeStates(S, rs));
    }
    // 2) ارفع الدمج (شرط rev لمنع الكتابة فوق تغيير حصل أثناء المزامنة)
    const { tx, ...rest } = S; const payload = JSON.stringify(Object.assign({}, rest, { tx, settings: Object.assign({}, rest.settings, { dropbox: undefined }) }));
    await Dropbox.upload(jpath, new TextEncoder().encode(payload), remote ? { '.tag': 'update', update: remote.rev } : 'add');
    // 3) حدّث ملف Excel
    const wb = Core.exportWorkbook(XLSX, S); const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await Dropbox.upload(xpath, out, 'overwrite');
    d.dirty = false; d.last = Date.now(); await saveMeta(); if (manual) toast('تمت المزامنة ✓'); if (ui.tab !== 'add') render();
  } catch (e) { d.err = String(e.message || e); if (manual) toast('فشلت المزامنة: ' + d.err, true); if (/rev|conflict|update/i.test(d.err)) syncTimer = setTimeout(() => syncNow(false), 3000); }
  syncing = false; renderSync();
}
window.addEventListener('online', () => { if (S) syncNow(false); renderSync(); });
window.addEventListener('offline', renderSync);

/* ---------------- البدء ---------------- */
(async function boot() {
  await load(); applyTheme();
  const q = new URLSearchParams(location.search);
  if (q.get('code')) { try { await Dropbox.finish(q.get('code')); toast('تم ربط Dropbox ✓'); history.replaceState(null, '', location.pathname); ui.tab = 'settings'; setTimeout(() => syncNow(true), 500); } catch (e) { toast(e.message, true); } }
  render();
  if (DB.broken) toast('تنبيه: المتصفح لا يسمح بالتخزين في هذا الوضع، افتح التطبيق من رابط https حتى تنحفظ بياناتك', true);
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (S.settings.dropbox.token && navigator.onLine) syncNow(false);
})();
