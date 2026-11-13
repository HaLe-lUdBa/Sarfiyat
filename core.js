/* core.js — منطق التطبيق (استيراد/تصدير/حسابات). يعمل في المتصفح وفي Node للاختبار */
(function (root) {
  'use strict';
  const Core = {};
  const DAY = 86400000;
  const XL_EPOCH = Date.UTC(1899, 11, 30); // Excel serial 0

  // ---------- تواريخ ----------
  Core.serialToTs = (s) => Math.round(XL_EPOCH + s * DAY) - 3 * 3600000 + 3 * 3600000; // نخزن كتوقيت UTC للحقل، الإظهار بـ UTC
  Core.tsToSerial = (ts) => (ts - XL_EPOCH) / DAY;
  // كل التواريخ تُعامل كـ "ساعة جدارية" (UTC fields = ما يراه المستخدم) لتفادي مشاكل المنطقة الزمنية
  Core.nowLocalTs = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); };
  Core.parts = (ts) => { const d = new Date(ts); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
  const p2 = (n) => String(n).padStart(2, '0');
  Core.fmtDate = (ts) => { const p = Core.parts(ts); return `${p.y}/${p2(p.m)}/${p2(p.d)}`; };
  Core.fmtTime = (ts) => { const p = Core.parts(ts); return `${p2(p.h)}:${p2(p.mi)}`; };

  // مفتاح الشهر: الشهر يبدأ في اليوم monthStart ويُسمّى بشهر البداية
  Core.monthKey = (ts, monthStart) => {
    const p = Core.parts(ts);
    let y = p.y, m = p.m;
    if (monthStart > 1 && p.d < monthStart) { m -= 1; if (m < 1) { m = 12; y -= 1; } }
    return `${y}-${p2(m)}`;
  };
  Core.monthRange = (key, monthStart) => {
    const [y, m] = key.split('-').map(Number);
    const start = Date.UTC(y, m - 1, monthStart || 1);
    const end = monthStart > 1 ? Date.UTC(y, m, monthStart) - 1 : Date.UTC(y, m, 1) - 1;
    return [start, end];
  };
  Core.monthLabel = (key, monthStart) => {
    const [a, b] = Core.monthRange(key, monthStart);
    return `${p2(Core.parts(a).d)}/${p2(Core.parts(a).m)} – ${p2(Core.parts(b).d)}/${p2(Core.parts(b).m)}`;
  };

  // هجري -> ميلادي (تقريبي عبر تقويم أم القرى)
  let hijriMap = null;
  function buildHijriMap() {
    hijriMap = {};
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      for (let t = Date.UTC(2015, 0, 1); t < Date.UTC(2019, 6, 1); t += DAY) {
        const pr = f.formatToParts(new Date(t)); const g = (k) => pr.find((x) => x.type === k).value;
        hijriMap[`${+g('year')}/${+g('month')}/${+g('day')}`] = t;
      }
    } catch (e) { hijriMap = {}; }
  }
  Core.hijriToTs = (y, m, d) => { if (!hijriMap) buildHijriMap(); return hijriMap[`${y}/${m}/${d}`] || null; };

  // ---------- أدوات ----------
  const num = (v) => { if (typeof v === 'number') return v; if (v == null || v === '') return NaN; const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? NaN : n; };
  const str = (v) => (v == null ? '' : String(v).trim());
  const round2 = (x) => Math.round(x * 100) / 100;
  Core.round2 = round2;
  let idc = 0;
  Core.uid = () => Date.now().toString(36) + '-' + (idc++).toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  // تصنيفات مرتبة كما في Sheet1
  Core.SAVING_NAMES = ['الادخار', 'الاسهم', 'الشالية', 'احتياط'];
  Core.DEFAULT_CATS = ['الشقة', 'الكهرب', 'الغاز', 'الماء', 'الادخار', 'نت', 'القرض', 'بنزين', 'بنزين باجيرو', 'بنزين هافال', 'بنزين سزوكي', 'الاغراض', 'اغراض السفر', 'أغراض لأهلي', 'كماليات', 'ترفيه', 'زوجتي', 'بنتي', 'حلويات', 'مطاعم', 'الفواتير', 'الدوام', 'مخالفات', 'طلبات النت', 'الشحن', 'طب', 'الصيدلية', 'توصيل', 'صيانة', 'السيارة', 'ادوات للشاليه', 'الشالية', 'الاسهم', 'سلف', 'احتياط', 'غير مصنف'];
  Core.normCat = (c) => { c = str(c).replace(/\s+/g, ' '); if (c === 'الشقه') return 'الشقة'; if (c === 'السياره') return 'السيارة'; return c; };
  Core.DEFAULT_WALLETS = [
    { id: 'w1', code: 1, name: 'البلاد', color: '#1f5fa8' },
    { id: 'w2', code: 2, name: 'الاستثمار', color: '#2c5fa8' },
    { id: 'w3', code: 3, name: 'كاش', color: '#8a6d1d' },
    { id: 'w4', code: 4, name: 'الراجحي', color: '#a83232' },
  ];
  Core.defaultCategories = () => Core.DEFAULT_CATS.map((name, i) => ({ id: 'c' + (i + 1), name, kind: Core.SAVING_NAMES.includes(name) ? 'saving' : 'salary', hidden: false, order: i }));

  // ---------- الاستيراد ----------
  // sheets: { اسم_الشيت: [[خلايا]...] }  (نفس شكل SheetJS header:1)
  Core.importSheets = function (sheets, opts) {
    opts = opts || {};
    const log = [];
    const cats = Core.defaultCategories();
    const catByName = {}; cats.forEach((c) => (catByName[c.name] = c));
    const ensureCat = (name) => {
      name = Core.normCat(name) || 'غير مصنف';
      if (!catByName[name]) { const c = { id: 'c' + (cats.length + 1), name, kind: Core.SAVING_NAMES.includes(name) ? 'saving' : 'salary', hidden: false, order: cats.length }; cats.push(c); catByName[name] = c; }
      return catByName[name].id;
    };
    const walletByCode = {}; Core.DEFAULT_WALLETS.forEach((w) => (walletByCode[w.code] = w.id));

    const rawRows = []; // صفوف بعد التنظيف
      const names = Object.keys(sheets);
    const isMonthly = (n) => /^(0[1-9]|1[0-2])(\d\d)$/.test(n) && +n.slice(2) >= 20;
    const isYear = (n) => /^20(19|2\d)$/.test(n) && n !== '2026' && n !== '2019'; // 2019 بدون عمود محفظة
    const used = [];
    let seq = 0;
    for (const n of names) {
      if (!(isMonthly(n) || isYear(n))) continue;
      used.push(n);
      const rows = sheets[n];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; if (!r) continue;
        const bank = num(r[0]); const val = num(r[2]); const ser = num(r[6]);
        if (![1, 2, 3, 4].includes(bank) || isNaN(val) || isNaN(ser) || ser < 43800 || ser > 47500) continue;
        if (isYear(n)) { const yy = Core.parts(Core.serialToTs(ser)).y; const sy = +n; if (yy < sy || yy > sy + 1) continue; }
        const cat = Core.normCat(r[1]);
        const note = str(r[3]); const unit = num(r[4]); const qty = num(r[5]);
        rawRows.push({ seq: seq++, sheet: n, wallet: walletByCode[bank], cat, val, note, unit, qty: isNaN(qty) ? 1 : qty, ser });
      }
    }
    // ترتيب زمني ثابت
    rawRows.sort((a, b) => a.ser - b.ser || a.seq - b.seq);

    // مطابقة التحويلات: صف موجب بلا تصنيف (أو احتياط) في محفظة + صف سالب في محفظة أخرى نفس اليوم
    const isTr = (r) => r.cat === '' || r.cat === 'احتياط';
    const paired = new Set(); const transfers = [];
    const byDay = {};
    rawRows.forEach((r) => { if (isTr(r)) (byDay[Math.floor(r.ser)] = byDay[Math.floor(r.ser)] || []).push(r); });
    Object.values(byDay).forEach((arr) => {
      const pos = arr.filter((r) => r.val > 0), neg = arr.filter((r) => r.val < 0);
      pos.forEach((p) => {
        let best = null;
        neg.forEach((q) => {
          if (paired.has(q) || q.wallet === p.wallet) return;
          const fee = round2(p.val + q.val); // q.val سالب
          if (fee < 0 || fee > 10) return;
          if (!best || fee < best.fee) best = { q, fee };
        });
        if (best) { paired.add(p); paired.add(best.q); transfers.push({ p, q: best.q, fee: best.fee }); }
      });
    });

    const tx = [];
    const mk = (r, extra) => Object.assign({ id: 'imp-' + r.sheet + '-' + r.seq, ts: Core.serialToTs(r.ser) + (Number.isInteger(r.ser) ? r.seq % 60000 : 0), note: r.note, src: 'excel:' + r.sheet, upd: 0 }, extra);
    rawRows.forEach((r) => {
      if (paired.has(r)) return;
      if (r.cat === '' && r.val < 0) { tx.push(mk(r, { type: 'income', wallet: r.wallet, amount: -r.val, qty: 1, cat: null })); return; }
      const qty = r.qty || 1;
      tx.push(mk(r, { type: 'exp', wallet: r.wallet, cat: ensureCat(r.cat), amount: r.val, qty, unit: isNaN(r.unit) ? r.val / qty : r.unit }));
    });
    transfers.forEach(({ p, q, fee }) => {
      tx.push(mk(p, { id: 'imp-tr-' + p.sheet + '-' + p.seq, type: 'transfer', wallet: p.wallet, to: q.wallet, amount: -q.val, fee, cat: p.cat === 'احتياط' ? ensureCat('احتياط') : null, qty: 1, note: p.note || q.note }));
    });

    const legacy = [];
    // الأشهر القديمة (قبل 2020/1 — بدون محفظة): نعتمد مجاميع الداشبورد (Sheet1) لكل تصنيف
    const salariesOld = {};
    const dash = sheets['Sheet1'];
    if (dash) {
      const hi = dash.findIndex((r) => r && r.some((c) => str(c) === 'التاريخ') && r.some((c) => str(c) === 'المصروف'));
      if (hi >= 0) {
        const H = dash[hi].map(str); const iD = H.indexOf('التاريخ'), iE = H.indexOf('المصروف'), iT = H.indexOf('الاجمالي');
        let prev = null; let hk = null; // {y,m}
        for (let i = hi + 1; i < dash.length; i++) {
          const r = dash[i]; if (!r) continue; const dv = r[iD]; let ts = null; let isH = false;
          if (typeof dv === 'number' && dv > 40000 && dv < 47000) ts = Core.serialToTs(dv);
          else if (typeof dv === 'string') {
            const s = dv.replace(/[^\d\/\- ]/g, '').trim(); let m;
            if ((m = s.match(/^(\d+)\/(\d+)\/(\d{4})$/))) { const d = +m[1], mo = +m[2], y = +m[3]; if (y < 1500) { isH = true; ts = Core.hijriToTs(y, mo, d); } else ts = Date.UTC(y, mo - 1, d); }
            else if ((m = s.match(/^(\d+)\/(\d+)\s*-\s*(\d+)\/(\d+)$/)) && prev) { let y = prev.y; if (+m[2] < prev.m) y++; ts = Date.UTC(y, +m[2] - 1, +m[1]); }
          }
          if (!ts) continue;
          const pp = Core.parts(ts); prev = { y: pp.y, m: pp.m };
          const MS0 = opts.monthStart || 27; let key = Core.monthKey(ts + 2 * DAY, MS0);
          if (typeof dv === 'number') { const q = Core.parts(ts); key = q.y + '-' + p2(q.m); } else if (isH) { if (hk) { hk = hk.m === 12 ? { y: hk.y + 1, m: 1 } : { y: hk.y, m: hk.m + 1 }; } else { const kp0 = key.split('-').map(Number); hk = { y: kp0[0], m: kp0[1] }; } key = hk.y + '-' + p2(hk.m); } else hk = null; { const kp = key.split('-').map(Number); ts = Date.UTC(kp[0], kp[1] - 1, MS0) + DAY; }
          if (key >= '2020-01') continue; // من 2020 وما بعد: من العمليات التفصيلية
          const sal = num(r[iT]); if (!isNaN(sal) && sal > 0) salariesOld[key] = sal;
          for (let c = iD + 1; c < iE; c++) {
            const v = num(r[c]); const nm = Core.normCat(H[c]); if (isNaN(v) || v === 0 || !nm) continue;
            legacy.push({ id: 'imp-old-' + key + '-' + c, ts: ts + c, type: 'exp', wallet: null, cat: ensureCat(nm), amount: v, qty: 1, unit: v, note: 'من الداشبورد', src: 'excel:Sheet1', legacy: true, upd: 0 });
          }
        }
      }
    }

    // رصيد المحافظ الحالي: من آخر شيت شهري فيه أرصدة (صف الأرصدة = بعد "الكلي")
    let anchor = null;
    const monthlyUsed = used.filter(isMonthly).sort((a, b) => (a.slice(2) + a.slice(0, 2)).localeCompare(b.slice(2) + b.slice(0, 2)));
    for (let k = monthlyUsed.length - 1; k >= 0 && !anchor; k--) {
      if (!tx.some((t) => t.src === 'excel:' + monthlyUsed[k])) continue; // آخر شيت فيه عمليات فعلية
      const rows = sheets[monthlyUsed[k]];
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        const r = rows[i]; if (!r) continue;
        if (str(r[1]).startsWith('البلاد') && rows[i + 1]) {
          const v = rows[i + 1]; const bal = [num(v[1]), num(v[2]), num(v[3]), num(v[4])];
          if (bal.every((x) => !isNaN(x))) { anchor = { sheet: monthlyUsed[k], balances: bal }; }
          break;
        }
      }
    }
    let anchorTs = 0;
    const wallets = Core.DEFAULT_WALLETS.map((w, i) => ({ id: w.id, name: w.name, color: w.color, logo: null, hidden: false, order: i, opening: 0 }));
    if (anchor) {
      const last = tx.filter((t) => t.src === 'excel:' + anchor.sheet);
      anchorTs = last.length ? Math.max(...last.map((t) => t.ts)) + 1 : 0;
      wallets.forEach((w, i) => (w.opening = anchor.balances[i]));
      log.push(`رصيد المحافظ الحالي مأخوذ من شيت ${anchor.sheet}: ${anchor.balances.join(' / ')}`);
    }

    // الرواتب من شيت total
    const salaries = {};
    const tot = sheets['total'];
    if (tot) {
      const hdrRow = tot.find((r) => r && r.some((c) => str(c) === 'الراتب'));
      const sIdx = hdrRow ? hdrRow.findIndex((c) => str(c) === 'الراتب') : -1;
      tot.forEach((r) => {
        if (!r || sIdx < 0) return;
        const per = r[1]; const sal = num(r[sIdx]);
        if (isNaN(sal) || sal <= 0) return;
        let key = null;
        if (typeof per === 'number' && per > 40000) { const p = Core.parts(Core.serialToTs(per)); key = `${p.y}-${p2(p.m)}`; }
        else if (typeof per === 'string') { const m = per.match(/^(\d\d)\/(\d\d)$/); if (m) key = `20${m[2]}-${m[1]}`; }
        if (key) salaries[key] = sal;
      });
    }

    Object.keys(salariesOld).forEach((k) => { if (!salaries[k]) salaries[k] = salariesOld[k]; });
    log.push(`شيتات مستوردة: ${used.join(', ')}`);
    log.push(`عمليات: ${tx.length} (تحويلات ${transfers.length}) + سجلات قديمة بلا محفظة ${legacy.length}`);
    return { wallets, categories: cats, tx: tx.concat(legacy), salaries, anchorTs, log };
  };

  // ---------- الحسابات ----------
  const live = (t) => !t.del;
  // أثر العملية على محفظة
  Core.effect = (t, wid) => {
    if (t.legacy || !t.wallet) return 0;
    if (t.type === 'exp') return t.wallet === wid ? -t.amount : 0;
    if (t.type === 'income') return t.wallet === wid ? t.amount : 0;
    if (t.type === 'transfer') return (t.wallet === wid ? -(t.amount + (t.fee || 0)) : 0) + (t.to === wid ? t.amount : 0);
    return 0;
  };
  Core.balances = (state, atTs) => {
    const out = {};
    state.wallets.forEach((w) => (out[w.id] = w.opening || 0));
    state.tx.filter(live).forEach((t) => {
      if (t.ts < (state.anchorTs || 0)) return;
      if (atTs != null && t.ts > atTs) return;
      state.wallets.forEach((w) => (out[w.id] += Core.effect(t, w.id)));
    });
    Object.keys(out).forEach((k) => (out[k] = round2(out[k])));
    return out;
  };
  // رصيد أي محفظة في لحظة (للخلف: نطرح)
  Core.balanceAt = (state, wid, ts) => {
    let b = (Core.balances(state)[wid]);
    state.tx.filter(live).forEach((t) => { if (t.ts > ts) b -= Core.effect(t, wid); });
    return round2(b);
  };
  // مبلغ العملية كمصروف على الراتب/التوفير (الرسوم تُحسب ضمن الراتب)
  Core.monthSummary = (state, key) => {
    const ms = state.settings.monthStart || 1;
    const catKind = {}; state.categories.forEach((c) => (catKind[c.id] = c.kind));
    const byCat = {}; let salaryExp = 0, savingExp = 0, fees = 0, income = 0;
    state.tx.filter(live).forEach((t) => {
      if (Core.monthKey(t.ts, ms) !== key) return;
      if (t.type === 'exp') {
        byCat[t.cat] = (byCat[t.cat] || 0) + t.amount;
        if ((t.pay || catKind[t.cat]) === 'saving') savingExp += t.amount; else salaryExp += t.amount;
      } else if (t.type === 'transfer') {
        if (t.fee) { fees += t.fee; salaryExp += t.fee; }
      } else if (t.type === 'income') income += t.amount;
    });
    const salary = (state.salaries || {})[key] || 0;
    return { byCat, salaryExp: round2(salaryExp), savingExp: round2(savingExp), fees: round2(fees), income: round2(income), salary, remaining: round2(salary - salaryExp), total: round2(salaryExp + savingExp) };
  };
  Core.monthKeys = (state) => {
    const ms = state.settings.monthStart || 1; const s = new Set();
    state.tx.filter(live).forEach((t) => s.add(Core.monthKey(t.ts, ms)));
    return Array.from(s).sort().reverse();
  };

  // ---------- الدمج (Dropbox) ----------
  // كل عملية لها id فريد و upd (آخر تعديل). الدمج = اتحاد + الأحدث يفوز. الحذف علامة (del) فلا يضيع شيء.
  Core.mergeStates = (a, b) => {
    const mergeList = (x, y, key) => { const m = new Map(); (x || []).concat(y || []).forEach((it) => { const o = m.get(it[key]); if (!o || (it.upd || 0) >= (o.upd || 0)) m.set(it[key], it); }); return Array.from(m.values()); };
    const out = {
      tx: mergeList(a.tx, b.tx, 'id'),
      wallets: mergeList(a.wallets, b.wallets, 'id').sort((p, q) => p.order - q.order),
      categories: mergeList(a.categories, b.categories, 'id').sort((p, q) => p.order - q.order),
      salaries: Object.assign({}, a.salaries, b.salaries),
      settings: ((a.settingsUpd || 0) >= (b.settingsUpd || 0) ? a : b).settings,
      settingsUpd: Math.max(a.settingsUpd || 0, b.settingsUpd || 0),
      anchorTs: Math.min(a.anchorTs || Infinity, b.anchorTs || Infinity) === Infinity ? 0 : Math.min(a.anchorTs || Infinity, b.anchorTs || Infinity),
    };
    // الأرصدة الافتتاحية: تؤخذ من النسخة الأحدث للمحفظة (ضمن mergeList)
    out.tx.sort((p, q) => p.ts - q.ts);
    return out;
  };

  // ---------- التصدير إلى Excel بنفس تصميم الملف الأصلي ----------
  // XLSX = مكتبة SheetJS. يُنتج: Sheet1 (لوحة), total (أرصدة), شيت لكل شهر (MMYY)، وشيتات سنوية لا تُنتج (تُدمج في الشهرية).
  Core.exportWorkbook = function (XLSX, state) {
    const ms = state.settings.monthStart || 1;
    const wb = XLSX.utils.book_new();
    const cats = state.categories.filter((c) => !c.hidden || true).sort((a, b) => a.order - b.order);
    const wallets = state.wallets.slice().sort((a, b) => a.order - b.order);
    const catName = {}; state.categories.forEach((c) => (catName[c.id] = c.name));
    const wIdx = {}; wallets.forEach((w, i) => (wIdx[w.id] = i + 1));
    const keys = Core.monthKeys(state).slice().reverse();

    // Sheet1 : لوحة الصرفيات
    const head1 = ['من', 'الى', 'التاريخ'].concat(cats.map((c) => c.name), ['المصروف', 'المتبقي', 'الاجمالي', 'الاضافات']);
    const s1 = [head1];
    keys.forEach((k) => {
      const [a, b] = Core.monthRange(k, ms); const m = Core.monthSummary(state, k);
      const row = [Core.fmtDate(a), Core.fmtDate(b), k];
      cats.forEach((c) => row.push(m.byCat[c.id] ? round2(m.byCat[c.id]) : ''));
      row.push(m.salaryExp, m.remaining, m.salary, m.income);
      s1.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'Sheet1');

    // total : أرصدة بداية/نهاية الشهر لكل محفظة
    const ht = ['', 'الفترة']; wallets.forEach((w) => ht.push(w.name, '', '')); ht.push('الكلي', '', '', 'الراتب');
    const ht2 = ['الخلية بالجدول', '']; wallets.forEach(() => ht2.push('بداية الشهر', 'نهاية الشهر', 'الفرق')); ht2.push('بداية الشهر', 'نهاية الشهر', 'الفرق');
    const st = [ht, ht2];
    keys.forEach((k) => {
      const [a, b] = Core.monthRange(k, ms); const row = ['', k]; let s0 = 0, s1_ = 0;
      wallets.forEach((w) => { const st0 = Core.balanceAt(state, w.id, a - 1), en = Core.balanceAt(state, w.id, b); row.push(st0, en, round2(en - st0)); s0 += st0; s1_ += en; });
      row.push(round2(s0), round2(s1_), round2(s1_ - s0), (state.salaries || {})[k] || '');
      st.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), 'total');

    // شيت لكل شهر MMYY بنفس الأعمدة: البنك الصنف القيمه النوع السعر العدد التاريخ
    const bal = Core.balances(state);
    keys.forEach((k) => {
      const [a, b] = Core.monthRange(k, ms);
      const rows = [['', ...wallets.map((w) => `${w.name} (${wIdx[w.id]})`), '', 'الكلي'], ['', ...wallets.map((w) => Core.balanceAt(state, w.id, b)), '', round2(wallets.reduce((s, w) => s + Core.balanceAt(state, w.id, b), 0))], ['البنك', 'الصنف', 'القيمه', 'النوع', 'السعر', 'العدد', 'التاريخ']];
      state.tx.filter((t) => !t.del && t.ts >= a && t.ts <= b).sort((p, q) => p.ts - q.ts).forEach((t) => {
        const ser = Core.tsToSerial(t.ts);
        const q = t.qty || 1;
        if (t.type === 'exp') rows.push([t.legacy ? '' : wIdx[t.wallet], catName[t.cat], t.amount, t.note || '', t.unit != null && !isNaN(t.unit) ? t.unit : round2(t.amount / q), q, ser]);
        else if (t.type === 'income') rows.push([wIdx[t.wallet], '', -t.amount, t.note || '', -t.amount, 1, ser]);
        else if (t.type === 'transfer') { rows.push([wIdx[t.wallet], t.cat ? catName[t.cat] : '', round2(t.amount + (t.fee || 0)), t.note || '', round2(t.amount + (t.fee || 0)), 1, ser]); rows.push([wIdx[t.to], t.cat ? catName[t.cat] : '', -t.amount, '', -t.amount, 1, ser]); }
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const nm = k.slice(5) + k.slice(2, 4);
      XLSX.utils.book_append_sheet(wb, ws, nm);
    });
    return wb;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
