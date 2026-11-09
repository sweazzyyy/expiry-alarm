'use strict';
/* ================= Будильник сроков — renderer ================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const bridge = window.api || { getAutostart: async () => false, setAutostart: async () => false, show() {}, attention() {}, setTrayTitle() {}, openSpeechSettings() {}, quit() {} };

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const KEEP_DAYS = 14;
const ON_TIME_MS = 15 * MIN;

/* ---------- localStorage ---------- */
const K = { alarms: 'ea.alarms', settings: 'ea.settings', items: 'ea.items', locs: 'ea.locations', usage: 'ea.usage', rec: 'ea.rec.' };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('Не хватает места в хранилище: удалите свои записи или старые данные'); return false; }
  }
};

const DEFAULT_SETTINGS = {
  pizzeria: 'Моя пиццерия', hoursOn: false, open: '10:00', close: '23:00',
  advanceMin: 30, repeatSec: 60, notify: true, showWindow: true,
  speak: true, soundOn: true, volume: 0.8, sound: 'bell', voiceURI: '', rate: 1
};
const DEFAULT_ITEMS = ['Тесто', 'Сыр моцарелла', 'Соус томатный', 'Соус сырный', 'Пепперони', 'Ветчина', 'Курица', 'Бекон',
  'Шампиньоны', 'Томаты', 'Лук красный', 'Перец болгарский', 'Ананасы', 'Халапеньо', 'Маслины', 'Сливки', 'Чесночный соус',
  'Пицца Маргарита', 'Пицца Пепперони', 'Салат'];
const DEFAULT_LOCS = ['Холодильник 1', 'Холодильник 2', 'Саладетта', 'Морозильник', 'Склад', 'Витрина', 'Пекарский стол'];

let S = Object.assign({}, DEFAULT_SETTINGS, LS.get(K.settings, {}));
let alarms = LS.get(K.alarms, []);
let items = LS.get(K.items, DEFAULT_ITEMS);
let locs = LS.get(K.locs, DEFAULT_LOCS);
let usage = LS.get(K.usage, {}); // name -> {n, loc}

const saveAlarms = () => LS.set(K.alarms, alarms);
const saveSettings = () => LS.set(K.settings, S);

/* ---------- utils ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function fmtDT(ms) {
  const d = new Date(ms), now = new Date();
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / DAY);
  const day = diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : diff === -1 ? 'вчера' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return `${day} ${hm(d)}`;
}
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
function fmtLeft(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN), s = Math.floor((ms % MIN) / 1000);
  let txt = d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : m ? `${m} мин ${pad(s)} с` : `${s} с`;
  return neg ? `просрочено ${txt}` : `через ${txt}`;
}
function minutesWord(m) { return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`; }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3000); }

/* ---------- часы работы ---------- */
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + m; };
function isOpenAt(ms) {
  const d = new Date(ms), m = d.getHours() * 60 + d.getMinutes();
  const o = toMin(S.open), c = toMin(S.close);
  if (o === c) return true;
  return o < c ? (m >= o && m < c) : (m >= o || m < c);
}
// Если пиццерия закрыта в момент истечения — переносим на ближайшее предыдущее закрытие
function adjustForHours(ms) {
  if (!S.hoursOn || isOpenAt(ms)) return ms;
  let t = Math.floor(ms / MIN) * MIN;
  for (let i = 0; i < 1500; i++) { t -= MIN; if (isOpenAt(t)) return t + MIN; }
  return ms;
}

/* ---------- звук (WebAudio) ---------- */
let actx;
function ac() { if (!actx) actx = new AudioContext(); if (actx.state === 'suspended') actx.resume(); return actx; }
function strike(f, t0, decay, partials, gain = 0.5, type = 'sine') {
  const c = ac(), out = c.createGain(); out.gain.value = S.volume; out.connect(c.destination);
  for (const [mult, amp] of partials) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain * amp, 0.0002), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * (1 / Math.sqrt(mult)));
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + decay + 0.1);
  }
}
const BELL = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]];
const SOUNDS = {
  bell(t) { strike(1760, t, 1.6, BELL, 0.45); strike(1760, t + 0.45, 1.8, BELL, 0.45); return 2.3; },
  timer(t) { for (let g = 0; g < 4; g++) for (let i = 0; i < 4; i++) strike(2400, t + g * 0.6 + i * 0.09, 0.06, [[1, 1]], 0.18, 'square'); return 2.5; },
  dingdong(t) { strike(659, t, 1.4, [[1, 1], [2, 0.3], [3, 0.1]], 0.5); strike(523, t + 0.6, 1.8, [[1, 1], [2, 0.3], [3, 0.1]], 0.5); return 2.4; },
  waiter(t) { for (let i = 0; i < 12; i++) strike(i % 2 ? 1480 : 1320, t + i * 0.1, 0.5, BELL, 0.25); return 1.8; },
  gong(t) { strike(98, t, 4.5, [[1, 1], [1.48, 0.6], [2.12, 0.45], [2.93, 0.3], [4.1, 0.15]], 0.7); return 3.2; },
  soft(t) { strike(880, t, 1.0, [[1, 1], [2, 0.15]], 0.25); strike(1318, t + 0.35, 1.2, [[1, 1], [2, 0.15]], 0.25); return 1.6; },
  none() { return 0; }
};
function playChime(name = S.sound) {
  const fn = SOUNDS[name] || SOUNDS.bell;
  const dur = fn(ac().currentTime + 0.05);
  return new Promise((r) => setTimeout(r, dur * 1000));
}
function playRecording(kind) {
  const data = localStorage.getItem(K.rec + kind);
  if (!data) return null;
  return new Promise((resolve) => {
    const a = new Audio(data); a.volume = S.volume;
    a.onended = a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}

/* ---------- голос ---------- */
let voices = [];
function ruVoices() { return voices.filter((v) => /^ru/i.test(v.lang)); }
function pickVoice() {
  return voices.find((v) => v.voiceURI === S.voiceURI) || ruVoices()[0] || null;
}
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('#sVoice');
  const ru = ruVoices(), other = voices.filter((v) => !/^ru/i.test(v.lang));
  sel.innerHTML = '';
  const group = (label, arr) => {
    if (!arr.length) return;
    const g = document.createElement('optgroup'); g.label = label;
    arr.forEach((v) => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`; g.appendChild(o); });
    sel.appendChild(g);
  };
  group('Русские', ru); group('Другие', other);
  const pv = pickVoice(); if (pv) sel.value = pv.voiceURI;
  const ok = ru.length > 0;
  $('#voiceStatus').textContent = ok ? `✓ Русских голосов: ${ru.length}. Выбран: ${pv ? pv.name : '—'}` : voices.length ? '⚠ Русский голос не найден. Установите его в Windows.' : '⚠ Голоса не найдены.';
  $('#voiceStatus').className = 'hint' + (ok ? '' : ' warn');
  $('#voiceHowto').classList.toggle('hidden', ok);
  $('#voiceBanner').classList.toggle('hidden', ok || !S.speak);
  updateDot();
}
function speak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ru-RU';
    u.volume = S.volume; u.rate = S.rate;
    const done = () => { clearTimeout(guard); resolve(); };
    const guard = setTimeout(done, 20000);
    u.onend = u.onerror = done;
    speechSynthesis.speak(u);
  });
}

/* ---------- оповещение (очередь) ---------- */
let queue = Promise.resolve();
let mutedUntil = 0;
function announce(kind, list, { notify = true } = {}) {
  if (!list.length) return;
  const names = list.map((a) => a.name + (a.location ? `, ${a.location}` : '')).join('; ');
  let text, title;
  if (kind === 'expired') {
    title = list.length > 1 ? `Истёк срок: ${list.length} шт.` : `Истёк срок: ${list[0].name}`;
    text = `Внимание! Истёк срок: ${names}. Спишите.`;
  } else {
    const m = Math.max(1, Math.round((list[0].alarmAt - Date.now()) / MIN));
    title = `Скоро истекает: ${list[0].name}`;
    text = `Через ${minutesWord(m)} истекает срок: ${names}.`;
  }
  if (notify && S.notify && 'Notification' in window) {
    try {
      const n = new Notification(title, { body: list.map((a) => `${a.name}${a.location ? ' — ' + a.location : ''}`).join('\n'), silent: true });
      n.onclick = () => { bridge.show(); showView('list'); };
    } catch {}
  }
  if (kind === 'expired' && S.showWindow) bridge.attention();
  if (Date.now() < mutedUntil) return;
  queue = queue.then(async () => {
    if (S.soundOn && S.sound !== 'none') await playChime();
    const rec = playRecording(kind);
    if (rec) await rec;
    else if (S.speak) await speak(text);
  }).catch(() => {});
}

/* ---------- движок будильников ---------- */
let lastRepeat = 0;
function tick() {
  const now = Date.now();
  let changed = false;
  const newlyExpired = [], soon = [];
  for (const a of alarms) {
    if (a.status !== 'active') continue;
    if (now >= a.alarmAt) {
      if (!a.firedAt) { a.firedAt = now; changed = true; newlyExpired.push(a); }
    } else if (S.advanceMin > 0 && a.alarmAt - now <= S.advanceMin * MIN && !a.warned) {
      a.warned = true; changed = true; soon.push(a);
    }
  }
  const expiredAll = alarms.filter((a) => a.status === 'active' && now >= a.alarmAt);
  if (newlyExpired.length) {
    announce('expired', newlyExpired);
    lastRepeat = now;
  } else if (expiredAll.length && now - lastRepeat >= S.repeatSec * 1000) {
    announce('expired', expiredAll, { notify: false });
    lastRepeat = now;
  }
  if (soon.length) announce('soon', soon);
  if (changed) saveAlarms();

  const n = expiredAll.length;
  $('#expBadge').textContent = n; $('#expBadge').classList.toggle('hidden', !n);
  document.title = n ? `(${n}) Будильник сроков` : 'Будильник сроков';
  bridge.setTrayTitle(n ? `Будильник сроков — просрочено: ${n}` : 'Будильник сроков');
  if (currentView === 'list') renderList();
}

function cleanup() {
  const border = Date.now() - KEEP_DAYS * DAY;
  const before = alarms.length;
  alarms = alarms.filter((a) => a.status === 'active' || Math.max(a.resolvedAt || 0, a.expiry) >= border);
  if (alarms.length !== before) saveAlarms();
}

/* ---------- навигация ---------- */
let currentView = 'list';
function showView(v) {
  currentView = v;
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.id !== 'view-' + v));
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'list') renderList();
  if (v === 'create') prepareCreate();
  if (v === 'reports') renderReports();
  if (v === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$$('[data-view-go]').forEach((b) => b.addEventListener('click', () => { showView(b.dataset.viewGo); const t = document.getElementById(b.dataset.scroll); if (t) t.scrollIntoView({ behavior: 'smooth' }); }));

/* ---------- список ---------- */
function renderList() {
  const q = $('#listSearch').value.trim().toLowerCase();
  const now = Date.now();
  const list = alarms.filter((a) => a.status === 'active')
    .filter((a) => !q || (a.name + ' ' + (a.location || '') + ' ' + (a.comment || '')).toLowerCase().includes(q))
    .sort((a, b) => a.alarmAt - b.alarmAt);
  $('#listEmpty').classList.toggle('hidden', list.length > 0);
  $('#alarmList').innerHTML = list.map((a) => {
    const left = a.alarmAt - now;
    const cls = left <= 0 ? 'expired' : left <= S.advanceMin * MIN ? 'soon' : '';
    const shifted = a.alarmAt !== a.expiry ? ` · срок ${fmtDT(a.expiry)}` : '';
    return `<div class="card ${cls}" data-id="${a.id}">
      <div class="bar"></div>
      <div>
        <div class="name">${esc(a.name)}</div>
        <div class="meta">${a.location ? '📍 ' + esc(a.location) : ''}${a.comment ? ' · ' + esc(a.comment) : ''}</div>
      </div>
      <div class="when"><div class="left">${fmtLeft(left)}</div>${fmtDT(a.alarmAt)}${shifted}</div>
    </div>`;
  }).join('');
}
$('#alarmList').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openWriteOff(c.dataset.id); });
$('#listSearch').addEventListener('input', renderList);
$('#muteBtn').addEventListener('click', () => {
  mutedUntil = Date.now() + 5 * MIN; speechSynthesis.cancel();
  toast('Звук выключен на 5 минут');
});

/* ---------- создание ---------- */
function fillDatalists() {
  $('#itemsList').innerHTML = items.map((i) => `<option value="${esc(i)}">`).join('');
  $('#locList').innerHTML = locs.map((i) => `<option value="${esc(i)}">`).join('');
}
function prepareCreate() {
  fillDatalists();
  const now = new Date();
  const min = new Date(now.getTime() - KEEP_DAYS * DAY);
  $('#fDate').min = ymd(min);
  if (!$('#fDate').value) $('#fDate').value = ymd(now);
  if (!$('#fTime').value) $('#fTime').value = hm(new Date(now.getTime() + 2 * HOUR));
  const pop = Object.entries(usage).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  $('#popularChips').innerHTML = pop.length
    ? '<span class="muted" style="align-self:center;font-size:13px">Популярное:</span>' + pop.map(([n]) => `<button type="button" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    : '';
  updateShiftHint();
  setTimeout(() => $('#fName').focus(), 50);
}
function formExpiry() {
  const d = $('#fDate').value, t = $('#fTime').value;
  if (!d || !t) return null;
  return new Date(`${d}T${t}`).getTime();
}
function updateShiftHint() {
  const ms = formExpiry(); const h = $('#shiftHint');
  if (!ms) { h.textContent = ''; return; }
  const adj = adjustForHours(ms);
  if (adj !== ms) { h.className = 'hint warn'; h.textContent = `Пиццерия будет закрыта — будильник сработает ${fmtDT(adj)}.`; }
  else { h.className = 'hint'; h.textContent = `Сработает ${fmtDT(ms)} (${fmtLeft(ms - Date.now())}).`; }
}
$('#popularChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('#fName').value = b.dataset.name;
  const u = usage[b.dataset.name]; if (u && u.loc) $('#fLoc').value = u.loc;
});
$('#dateChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.days));
  $('#fDate').value = ymd(d); updateShiftHint();
});
$('#hourChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const d = new Date(Date.now() + Number(b.dataset.hours) * HOUR);
  $('#fDate').value = ymd(d); $('#fTime').value = hm(d); updateShiftHint();
});
['#fDate', '#fTime'].forEach((s) => $(s).addEventListener('input', updateShiftHint));
$('#createForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#fName').value.trim(), location = $('#fLoc').value.trim(), comment = $('#fComment').value.trim();
  const expiry = formExpiry();
  if (!name || !expiry) return;
  if (expiry < Date.now() - KEEP_DAYS * DAY) { toast('Дата не может быть раньше чем 14 дней назад'); return; }
  const alarmAt = adjustForHours(expiry);
  alarms.push({ id: uid(), name, location, comment, expiry, alarmAt, createdAt: Date.now(), status: 'active', warned: alarmAt - Date.now() <= S.advanceMin * MIN });
  saveAlarms();
  usage[name] = { n: (usage[name]?.n || 0) + 1, loc: location || usage[name]?.loc || '' };
  LS.set(K.usage, usage);
  if (!items.includes(name)) { items.push(name); LS.set(K.items, items); }
  if (location && !locs.includes(location)) { locs.push(location); LS.set(K.locs, locs); }
  $('#fName').value = ''; $('#fComment').value = '';
  toast(`Будильник «${name}» создан на ${fmtDT(alarmAt)}`);
  showView('list');
});

/* ---------- списание ---------- */
let woId = null, woReason = 'expired', woAmount = '';
function openWriteOff(id) {
  const a = alarms.find((x) => x.id === id); if (!a) return;
  woId = id; woAmount = '';
  woReason = Date.now() >= a.alarmAt ? 'expired' : 'early';
  $('#woInfo').innerHTML = `<b>${esc(a.name)}</b>${a.location ? ' · ' + esc(a.location) : ''}<br>Срок: ${fmtDT(a.expiry)}${a.comment ? '<br>' + esc(a.comment) : ''}`;
  $('#woCustom').value = '';
  syncWo();
  $('#woDialog').showModal();
}
function syncWo() {
  $$('#woReason button').forEach((b) => b.classList.toggle('on', b.dataset.v === woReason));
  $$('#woAmount button').forEach((b) => b.classList.toggle('on', b.dataset.v === woAmount));
}
$('#woReason').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { woReason = b.dataset.v; syncWo(); } });
$('#woAmount').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { woAmount = b.dataset.v; $('#woCustom').value = ''; syncWo(); } });
$('#woCustom').addEventListener('input', () => { woAmount = ''; syncWo(); });
$('#woCancel').addEventListener('click', () => $('#woDialog').close());
$('#woOk').addEventListener('click', () => {
  const a = alarms.find((x) => x.id === woId); if (!a) return;
  a.status = 'done'; a.resolution = woReason; a.resolvedAt = Date.now();
  a.amount = $('#woCustom').value.trim() || woAmount || '';
  saveAlarms(); $('#woDialog').close();
  if (!alarms.some((x) => x.status === 'active' && Date.now() >= x.alarmAt)) speechSynthesis.cancel();
  toast(woReason === 'early' ? 'Отмечено: закончилось раньше' : 'Списано');
  tick(); renderList();
});
$('#woDelete').addEventListener('click', () => {
  if (!confirm('Удалить этот будильник как ошибочный? Он не попадёт в отчёты.')) return;
  alarms = alarms.filter((x) => x.id !== woId);
  saveAlarms(); $('#woDialog').close(); speechSynthesis.cancel(); tick(); renderList();
});

/* ---------- отчёты ---------- */
function classify(a) {
  if (a.status === 'active') return Date.now() >= a.alarmAt ? 'notdone' : null;
  if (a.resolution === 'early') return 'early';
  return a.resolvedAt - a.alarmAt <= ON_TIME_MS ? 'ontime' : 'late';
}
const CLS_LABEL = { early: 'Закончилось раньше', ontime: 'Списано вовремя', late: 'Списано с опозданием', notdone: 'Не списано' };
function renderReports() {
  const inp = $('#repDate');
  const today = new Date();
  inp.max = ymd(today); inp.min = ymd(new Date(today.getTime() - KEEP_DAYS * DAY));
  if (!inp.value) inp.value = ymd(today);
  const d0 = new Date(inp.value + 'T00:00').getTime(), d1 = d0 + DAY;
  const inDay = (t) => t && t >= d0 && t < d1;
  const list = alarms.filter((a) => inDay(a.alarmAt) || inDay(a.resolvedAt))
    .map((a) => ({ a, c: classify(a) })).filter((x) => x.c)
    .sort((x, y) => x.a.alarmAt - y.a.alarmAt);
  const cnt = { early: 0, ontime: 0, late: 0, notdone: 0 };
  list.forEach((x) => cnt[x.c]++);
  $('#repStats').innerHTML = Object.keys(cnt).map((k) => `<div class="stat"><b>${cnt[k]}</b><span class="tag ${k}">${CLS_LABEL[k]}</span></div>`).join('');
  $('#repList').innerHTML = list.length ? list.map(({ a, c }) => {
    let detail = `Срок: ${fmtDT(a.expiry)}`;
    if (a.resolvedAt) {
      const late = a.resolvedAt - a.alarmAt;
      detail += ` · отмечено ${fmtDT(a.resolvedAt)}`;
      if (c === 'late') detail += ` (опоздание ${Math.round(late / MIN)} мин)`;
    }
    return `<div class="card ${c === 'notdone' ? 'expired' : ''}" data-id="${a.id}" style="cursor:${c === 'notdone' ? 'pointer' : 'default'}">
      <div class="bar" style="background:var(--${c === 'early' ? 'ok' : c === 'ontime' ? 'ok' : c === 'late' ? 'late' : 'bad'})"></div>
      <div><div class="name">${esc(a.name)} <span class="tag ${c}">${CLS_LABEL[c]}</span></div>
      <div class="meta">${a.location ? '📍 ' + esc(a.location) + ' · ' : ''}${detail}${a.comment ? ' · ' + esc(a.comment) : ''}</div></div>
      <div class="when">Списано:<div class="left">${c === 'notdone' ? '—' : esc(a.amount || 'Нет данных')}</div></div>
    </div>`;
  }).join('') : '<div class="empty">За этот день записей нет.</div>';
}
$('#repDate').addEventListener('input', renderReports);
$('#repList').addEventListener('click', (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  const a = alarms.find((x) => x.id === c.dataset.id);
  if (a && a.status === 'active') openWriteOff(a.id);
});
$('#woDialog').addEventListener('close', () => { if (currentView === 'reports') renderReports(); });

/* ---------- настройки ---------- */
function renderChips(box, arr, onDel) {
  box.innerHTML = arr.map((x, i) => `<span>${esc(x)}<button data-i="${i}" title="Удалить">×</button></span>`).join('') || '<span class="muted">Пусто</span>';
  box.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) onDel(Number(b.dataset.i)); };
}
function renderLists() {
  renderChips($('#itemsChips'), items, (i) => { items.splice(i, 1); LS.set(K.items, items); renderLists(); });
  renderChips($('#locChips'), locs, (i) => { locs.splice(i, 1); LS.set(K.locs, locs); renderLists(); });
  fillDatalists();
}
function renderRecs() {
  $$('.rec').forEach((row) => {
    const has = !!localStorage.getItem(K.rec + row.dataset.kind);
    $('.recState', row).textContent = has ? '✓ Загружена' : 'Нет записи — синтез голоса';
    $('.recPlay', row).disabled = !has; $('.recDel', row).disabled = !has;
  });
}
async function renderSettings() {
  $('#sNotify').checked = S.notify; $('#sShowWindow').checked = S.showWindow;
  $('#sSpeak').checked = S.speak; $('#sSoundOn').checked = S.soundOn;
  $('#sSound').value = S.sound; $('#sVolume').value = S.volume; $('#sRate').value = S.rate;
  $('#volVal').textContent = Math.round(S.volume * 100) + '%'; $('#rateVal').textContent = '×' + Number(S.rate).toFixed(2);
  $('#sPizzeria').value = S.pizzeria; $('#sHoursOn').checked = S.hoursOn;
  $('#sOpen').value = S.open; $('#sClose').value = S.close;
  $('#sAdvance').value = S.advanceMin; $('#sRepeat').value = S.repeatSec;
  try { $('#sAutostart').checked = await bridge.getAutostart(); } catch {}
  loadVoices(); renderLists(); renderRecs();
}
const bindSetting = (sel, key, conv = (el) => el.checked) => $(sel).addEventListener('change', (e) => { S[key] = conv(e.target); saveSettings(); updateDot(); loadVoices(); });
bindSetting('#sNotify', 'notify'); bindSetting('#sShowWindow', 'showWindow');
bindSetting('#sSpeak', 'speak'); bindSetting('#sSoundOn', 'soundOn');
bindSetting('#sSound', 'sound', (el) => el.value);
bindSetting('#sVoice', 'voiceURI', (el) => el.value);
$('#sVolume').addEventListener('input', (e) => { S.volume = Number(e.target.value); $('#volVal').textContent = Math.round(S.volume * 100) + '%'; saveSettings(); });
$('#sRate').addEventListener('input', (e) => { S.rate = Number(e.target.value); $('#rateVal').textContent = '×' + S.rate.toFixed(2); saveSettings(); });
$('#sAutostart').addEventListener('change', async (e) => { try { e.target.checked = await bridge.setAutostart(e.target.checked); } catch {} });
$('#testNotify').addEventListener('click', () => { new Notification('Будильник сроков', { body: 'Уведомления работают ✓', silent: true }); });
$('#openSpeech').addEventListener('click', () => { $('#voiceHowto').classList.remove('hidden'); bridge.openSpeechSettings(); });
$('#refreshVoices').addEventListener('click', () => { loadVoices(); toast('Список голосов обновлён'); });
$('#testSound').addEventListener('click', () => playChime($('#sSound').value === 'none' ? 'bell' : $('#sSound').value));
$('#testVoice').addEventListener('click', () => { speechSynthesis.cancel(); speak('Проверка голоса. Истёк срок: сыр моцарелла, холодильник один. Спишите.'); });
$('#testFull').addEventListener('click', () => announce('expired', [{ name: 'Сыр моцарелла', location: 'Холодильник 1', alarmAt: Date.now() }]));

$('#rulesForm').addEventListener('submit', (e) => {
  e.preventDefault();
  S.pizzeria = $('#sPizzeria').value.trim() || DEFAULT_SETTINGS.pizzeria;
  S.hoursOn = $('#sHoursOn').checked; S.open = $('#sOpen').value || '10:00'; S.close = $('#sClose').value || '23:00';
  S.advanceMin = Math.max(0, Number($('#sAdvance').value) || 0);
  S.repeatSec = Math.max(10, Number($('#sRepeat').value) || 60);
  saveSettings();
  // пересчитываем ещё не сработавшие будильники
  for (const a of alarms) if (a.status === 'active' && !a.firedAt) { a.alarmAt = adjustForHours(a.expiry); }
  saveAlarms(); renderHeader(); toast('Правила сохранены');
});

$('#itemAdd').addEventListener('submit', (e) => { e.preventDefault(); const i = $('input', e.target); const v = i.value.trim(); if (v && !items.includes(v)) { items.push(v); LS.set(K.items, items); } i.value = ''; renderLists(); });
$('#locAdd').addEventListener('submit', (e) => { e.preventDefault(); const i = $('input', e.target); const v = i.value.trim(); if (v && !locs.includes(v)) { locs.push(v); LS.set(K.locs, locs); } i.value = ''; renderLists(); });

// свои записи
$$('.rec').forEach((row) => {
  const kind = row.dataset.kind;
  $('input[type=file]', row).addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 1.8 * 1024 * 1024) { toast('Файл больше 1,8 МБ'); return; }
    const r = new FileReader();
    r.onload = () => {
      try { localStorage.setItem(K.rec + kind, r.result); toast('Запись сохранена'); }
      catch { toast('Не хватает места в хранилище для записи'); }
      renderRecs();
    };
    r.readAsDataURL(f);
  });
  $('.recPlay', row).addEventListener('click', () => playRecording(kind));
  $('.recDel', row).addEventListener('click', () => { localStorage.removeItem(K.rec + kind); renderRecs(); });
});

// данные
$('#exportBtn').addEventListener('click', () => {
  const data = { version: 1, exportedAt: new Date().toISOString(), settings: S, alarms, items, locations: locs, usage };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `expiry-alarm-${ymd(new Date())}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('#importFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.alarms)) throw new Error();
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      S = Object.assign({}, DEFAULT_SETTINGS, d.settings || {}); alarms = d.alarms;
      items = d.items || items; locs = d.locations || locs; usage = d.usage || {};
      saveSettings(); saveAlarms(); LS.set(K.items, items); LS.set(K.locs, locs); LS.set(K.usage, usage);
      renderHeader(); renderSettings(); toast('Данные импортированы');
    } catch { toast('Неверный файл'); }
  };
  r.readAsText(f);
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Удалить ВСЕ будильники, отчёты, настройки и записи?')) return;
  Object.keys(localStorage).filter((k) => k.startsWith('ea.')).forEach((k) => localStorage.removeItem(k));
  location.reload();
});
$('#quitBtn').addEventListener('click', () => bridge.quit());

/* ---------- шапка ---------- */
function updateDot() {
  const dot = $('#statusDot');
  const ru = ruVoices().length > 0;
  if (!S.speak && !S.soundOn) { dot.className = 'dot bad'; dot.title = 'Звук и голос выключены'; }
  else if (S.speak && !ru) { dot.className = 'dot warn'; dot.title = 'Нет русского голоса'; }
  else { dot.className = 'dot ok'; dot.title = 'Звук и голос работают'; }
}
function renderHeader() { $('#pizzeriaName').textContent = S.pizzeria; updateDot(); }

/* ---------- старт ---------- */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); showView('create'); }
});
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = loadVoices; }
cleanup();
renderHeader();
loadVoices();
showView('list');
tick();
setInterval(tick, 1000);
setInterval(cleanup, HOUR);
