/**
 * HALLE//OS · Hallen-TV (Kiosk-Slider)
 * ------------------------------------------------------------
 * Aufruf: /tv?key=SCHLÜSSEL  (oder /dashboard?key=…)
 * - Holt alle 30 s frische Daten von /api/tv/data
 * - Wechselt weich zwischen den aktiven Screens (Dauer und Auswahl in der Admin-Konsole)
 * - Live-Countdown, Uhr, LED-Laufband mit Hallen-Mitteilungen
 * - Hält das Display wach (Wake Lock, wo verfügbar) und lädt sich alle 6 Stunden neu
 * - v4: roter Alarmstreifen bei kritischem Mangel, Verbrauchsartikel im Vorräte-Screen, "liegt rum" im Aufgaben-Screen
 * - v5.2: eigene Dashboard-Seiten aus dem Admin-Baukasten (Raster + Widgets, eigene Dauer je Seite),
 *         überfälliges Werkzeug (außer Haus verliehen) leuchtet rot. Vorschau einer Seite: &slide=ID
 */
import { carThumb } from './js/sprites.js';

const QS = new URLSearchParams(location.search);
const KEY = QS.get('key') || '';
const ONLY_SLIDE = QS.get('slide') ? Number(QS.get('slide')) : null;   // v5.2: Vorschau einer einzelnen Seite
const SCREEN_NAMES = { tasks: 'Aufgaben', event: 'Event-Radar', stock: 'Vorräte', hall: 'Halle' };
const STATUS_COLOR = { ready: '#22c55e', work: '#facc15', parts: '#ef4444' };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(Math.max(0, n)).padStart(2, '0');

let data = null;
let meta = { models: {} };
let order = [];
let idx = -1;
let slideTimer = null;
let slideStart = 0;
let lastLed = '';

const modelOf = (key) => meta.models[key] || { shape: 'dummy', length: 4.4, width: 1.8 };
const initials = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

function since(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `seit ${min} min`;
  return `seit ${Math.floor(min / 60)} h ${min % 60} min`;
}
function eventStart(ev) { return new Date(`${ev.date_start}T${ev.start_time || '08:00'}:00`); }
function fmtDate(d) { return new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); }

/* ======================= Screens ======================= */
function renderTasks() {
  const work = data.work || [];
  const urgent = data.tasks.urgent || [];
  const hallTasks = data.tasks.hall || [];
  return `
    <div class="panel"><div class="h"><span class="live"></span>Live in der Halle</div>
      ${work.length ? work.map((w) => `
        <div class="work"><span class="avatar" style="background:${esc(w.user_color)}">${esc(initials(w.user_name))}</span>
          <div><b>${esc(w.user_name)}</b><span>schraubt an <em>${esc(w.vehicle_name || 'der Halle')}</em>${w.text || w.task_title ? ` · ${esc(w.text || w.task_title)}` : ''}<br>${esc(since(w.started_at))}</span></div></div>`).join('')
        : '<div class="big-empty">Gerade schraubt niemand.</div>'}
      ${floatBlock()}
    </div>
    <div class="panel"><div class="h">Heute zu tun</div>
      ${urgent.length ? urgent.map((t) => `
        <div class="task ${esc(t.urgency)}"><span class="t">${esc(t.title)}</span>
          <span class="car"><span class="dot" style="background:${esc(t.vehicle_color)}"></span>${esc(t.vehicle_name)} · ${esc(t.event_name)} in ${t.daysLeft} T</span></div>`).join('')
        : '<div class="big-empty" style="color:#a3e635">Alle Event-Autos sind startklar!</div>'}
      ${hallTasks.length ? `<div class="h" style="margin-top:2vh">Hallen-To-Dos</div>${hallTasks.slice(0, urgent.length > 5 ? 2 : 5).map((t) => `<div class="task"><span class="t">${esc(t.title)}</span><span class="car">Halle</span></div>`).join('')}` : ''}
    </div>`;
}

/* v4: Dinge in der Schwebe ("liegt rum"), inkl. ausgeliehenem Werkzeug */
function lentBlock() {
  const od = ((data.hud && data.hud.lent) || []).filter((l) => l.overdue);
  if (!od.length) return '';
  return `<div class="h" style="margin-top:2vh;color:#fb7185">⚠ Rückgabe überfällig</div>
    ${od.slice(0, 3).map((l) => `<div class="od-li"><span class="t">${esc(l.name)}</span><span class="w">bei ${esc(l.lent_to)} · seit ${l.overdue_days} ${l.overdue_days === 1 ? 'Tag' : 'Tagen'}</span></div>`).join('')}`;
}

function floatBlock() {
  const fl = (data.hud && data.hud.floating) || [];
  if (!fl.length) return lentBlock();
  const n = fl.length;
  return `<div class="h" style="margin-top:2vh;color:#fcd34d">🛠️ ${n} ${n === 1 ? 'Ding liegt' : 'Dinge liegen'} rum</div>
    ${fl.slice(0, 4).map((f) => `<div class="float-li"><span class="t">${esc(f.label)}</span><span class="w">${esc(f.spot || 'irgendwo')}${f.user_name ? ` · ${esc(f.user_name)}` : ''}</span></div>`).join('')}
    ${n > 4 ? `<div class="float-li" style="border-color:#475569"><span class="t" style="color:#94a3b8">+ ${n - 4} weitere</span></div>` : ''}${lentBlock()}`;
}

const fmtQ = (n, kind) => (n === null || n === undefined ? '?' : Number(n).toLocaleString('de-DE', kind === 'fluid' ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 1 }));

function renderAlarm() {
  const crit = (data.hud && data.hud.critical) || [];
  const od = ((data.hud && data.hud.lent) || []).filter((l) => l.overdue);   // v5.2
  const a = $('#alarm');
  const tv = document.querySelector('.tv');
  if (!crit.length && !od.length) { a.hidden = true; tv.classList.remove('has-alarm'); return; }
  a.hidden = false;
  tv.classList.add('has-alarm');
  const text = crit.length
    ? `KRITISCHER MANGEL: ${esc(crit[0].text)}${crit.length > 1 ? ` (+${crit.length - 1} weitere)` : ''}${od.length ? ` · ${od.length}× Werkzeug überfällig` : ''}`
    : `${esc(od[0].text)}${od.length > 1 ? ` (+${od.length - 1} weitere)` : ''}`;
  a.innerHTML = `<span class="sig">⚠</span><span>${text}</span><span class="sig">⚠</span>`;
}

function renderEvent() {
  const ev = data.event;
  if (!ev) return '<div class="panel" style="grid-column:1/-1;display:grid;place-items:center"><div class="big-empty" style="font-size:6vh">Kein Event geplant. Zeit zum Schrauben!</div></div>';
  const pl = ev.packlist || { pct: 0, total: 0, packed: 0 };
  return `
    <div class="ev-head"><span class="ev-name">${esc(ev.name)}</span><span class="ev-meta">${esc(fmtDate(ev.date_start))}${ev.start_time ? ` · ${esc(ev.start_time)} Uhr` : ''}${ev.location ? ` · ${esc(ev.location)}` : ''}</span></div>
    <div class="panel" style="display:flex;flex-direction:column;justify-content:center">
      <div class="countdown" id="countdown"></div>
      <div style="display:flex;align-items:center;gap:2vw;margin-top:2vh">
        <div style="flex:1"><div class="h" style="margin-bottom:1vh">Packliste ${pl.packed} von ${pl.total}</div><div class="bar"><span style="width:${pl.pct}%"></span></div></div>
        <div class="pct">${pl.pct}%</div>
      </div>
    </div>
    <div class="panel"><div class="h">Autos fürs Event</div>
      ${(ev.vehicles || []).map((v) => {
        const lr = ev.loading && ev.loading.rows.find((r) => r.car === v.name);
        return `<div class="carrow"><img src="${carThumb(modelOf(v.model), v.color, { w: 90, h: 42 })}" alt="">
          <span class="n">${esc(v.name)}</span>
          <span class="dot" style="background:${STATUS_COLOR[v.status] || '#94a3b8'}"></span>
          <span class="chip">${v.open_tasks ? `${v.open_tasks} offen` : 'startklar'}</span>
          ${lr && lr.status ? `<span class="amp ${esc(lr.status)}" title="${esc(lr.issue || '')}">${lr.status === 'red' ? esc(lr.issue || 'Problem') : esc(lr.trailer || '')}</span>` : ''}</div>`;
      }).join('') || '<div class="big-empty">Noch keine Autos gewählt.</div>'}
      ${ev.loading && ev.loading.summary.red ? `<div class="amp red" style="display:block;margin-top:2vh;font-size:2.2vh;text-align:center">${ev.loading.summary.red} Gespann(e) nicht zulässig!</div>` : ''}
    </div>`;
}

function renderStock() {
  const hud = data.hud || { critical: [], consumables: [] };
  const crit = hud.critical || [];
  const cons = hud.consumables || [];
  const lowCons = cons.filter((c) => c.low && !c.crit);
  const low = (data.supplies || []).filter((s) => s.low);
  const t = data.tyres || { driftActive: 0 };
  const tyreLow = t.driftActive < 4;
  const tiles = [];
  let used = 0;
  const maxSlots = crit.length ? 8 : 12;   // kritische Kacheln sind größer: dann nur zwei Reihen
  const push = (h, w = 1) => { if (used + w <= maxSlots) { tiles.push(h); used += w; } };
  const gauge = (c) => { const max = Math.max(c.min_qty * 2, c.qty || 0, 1); return `<div class="gauge"><span style="width:${Math.min(100, ((c.qty || 0) / max) * 100)}%"></span></div>`; };
  // v4: kritische Ressourcen zuerst, groß und rot
  crit.forEach((c) => push(`<div class="tile crit"><span class="tag">KRITISCHER MANGEL</span><b>${esc(c.name)}</b><div class="num">${c.qty <= 0 ? 'LEER' : `${fmtQ(c.qty, c.kind)} ${esc(c.unit)}`}</div><small>${c.qty <= 0 ? 'Nichts mehr da!' : `Nur noch ${fmtQ(c.qty, c.kind)} ${esc(c.unit)} vorhanden`} · mindestens ${fmtQ(c.min_qty, c.kind)} ${esc(c.unit)}</small>${gauge(c)}</div>`, 2));
  lowCons.forEach((c) => push(`<div class="tile warn"><b>${esc(c.name)}</b><div class="num">${fmtQ(c.qty, c.kind)}</div><small>${esc(c.unit)} · mindestens ${fmtQ(c.min_qty, c.kind)} · fast leer</small>${gauge(c)}</div>`));
  low.forEach((s) => push(`<div class="tile red"><b>${esc(s.name)}</b><div class="num">${s.qty}</div><small>${esc(s.unit)} · mindestens ${s.min_qty} · ${s.qty <= 0 ? 'LEER!' : 'fast leer'}</small></div>`));
  push(`<div class="tile ${tyreLow ? 'red' : 'ok'}"><b>Driftreifen</b><div class="num">${t.driftActive}</div><small>${t.driftActive === 0 ? 'Keine Burner-Reifen mehr!' : `aktiv · ${t.driftLoose} lose auf Lager`}</small></div>`);
  if (t.burned) push(`<div class="tile"><b>Altreifen</b><div class="num" style="color:#94a3b8">${t.burned}</div><small>warten auf Entsorgung</small></div>`);
  cons.filter((c) => !c.low && !c.unknown).forEach((c) => push(`<div class="tile ok"><b>${esc(c.name)}</b><div class="num">${fmtQ(c.qty, c.kind)}</div><small>${esc(c.unit)} · ok${c.critical ? ' · darf nie ausgehen' : ''}</small>${gauge(c)}</div>`));
  (data.supplies || []).filter((s) => !s.low).forEach((s) => push(`<div class="tile ok"><b>${esc(s.name)}</b><div class="num">${s.qty}</div><small>${esc(s.unit)} · ok</small></div>`));
  const anyLow = crit.length || lowCons.length || low.length || tyreLow;
  return `<div class="h" ${crit.length ? 'style="color:#fb7185"' : ''}>${crit.length ? 'Kritischer Mangel! Sofort nachkaufen' : anyLow ? 'Nachkaufen! Low-Stock-Radar' : 'Vorräte & Verbrauch'}</div>
    ${!anyLow && !tiles.length ? '<div class="allgood">Alles im grünen Bereich. Prost!</div>' : ''}
    ${tiles.join('')}`;
}

function hallSvg() {
  const slots = data.slots || [];
  if (!slots.length) return '';
  const W = Math.max(...slots.map((s) => s.x + s.w)) + 0.4;
  const H = Math.max(...slots.map((s) => s.y + s.h)) + 0.6;
  const parts = slots.map((s) => {
    const occ = s.vehicles || [];
    const free = Math.max(0, s.capacity - occ.length);
    const col = free ? '#22c55e' : (occ[0] && STATUS_COLOR[occ[0].status]) || '#94a3b8';
    const name = occ.map((v) => v.name).join(' / ');
    return `<g>
      <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="0.15" fill="${free ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.05)'}" stroke="${col}" stroke-width="0.06" ${free ? 'stroke-dasharray="0.25 0.15"' : ''}/>
      <text x="${s.x + s.w / 2}" y="${s.y + 0.55}" text-anchor="middle" font-size="0.42" font-family="Chakra Petch, Arial, sans-serif" font-weight="700" fill="${col}">${esc(s.code)}</text>
      ${occ.length && s.capacity > 1 ? [0, 1].map((pos, i) => {
          const v = occ.find((o) => o.pos === pos);
          const tag = s.kind === 'lift' ? (pos === 0 ? '▲ oben' : '▼ unten') : `Platz ${pos + 1}`;
          const label = v ? (v.name.length > 16 ? `${v.name.slice(0, 15)}…` : v.name) : 'frei';
          return `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 - 0.25 + i * 0.75}" text-anchor="middle" font-size="0.3" fill="${v ? '#fff' : '#22c55e'}" font-family="IBM Plex Sans, Arial, sans-serif" font-weight="600"><tspan fill="#64748b" font-size="0.24">${tag} </tspan>${esc(label)}</text>`;
        }).join('')
      : occ.length ? `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" text-anchor="middle" font-size="0.32" fill="#fff" font-family="IBM Plex Sans, Arial, sans-serif" font-weight="600">${esc(name.length > 24 ? `${name.slice(0, 23)}…` : name)}</text>`
        : `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" text-anchor="middle" font-size="0.4" fill="#22c55e" font-family="Chakra Petch, Arial, sans-serif" font-weight="700">FREI</text>`}
      ${s.blocksLane && occ.length ? `<text x="${s.x + s.w / 2}" y="${s.y + s.h - 0.3}" text-anchor="middle" font-size="0.28" fill="#facc15" font-family="Chakra Petch, Arial, sans-serif" font-weight="700">SCHNEISE BLOCKIERT</text>` : ''}
    </g>`;
  }).join('');
  return `<svg class="hallmap" viewBox="-0.2 -0.2 ${W} ${H}"><rect x="-0.1" y="-0.1" width="${W - 0.1}" height="${H - 0.2}" fill="#0e131a" stroke="#475569" stroke-width="0.12" rx="0.1"/>${parts}
    <text x="${W / 2 - 0.2}" y="${H - 0.35}" text-anchor="middle" font-size="0.32" fill="#64748b" font-family="Chakra Petch, Arial, sans-serif" letter-spacing="0.1">EINFAHRT</text></svg>`;
}

function renderHall() {
  const w = data.weather;
  const extern = data.extern || [];
  const total = (data.slots || []).reduce((a, s) => a + s.capacity, 0);
  return `
    <div class="panel" style="display:flex;flex-direction:column"><div class="h">Hallenbelegung</div>${hallSvg()}</div>
    <div class="hall-stats">
      <div class="stat"><div class="num" style="color:${data.freePlaces ? '#a3e635' : '#f43f5e'}">${data.freePlaces}</div><small>freie Plätze von ${total}</small></div>
      <div class="stat"><div class="num" style="color:#fbbf24">${extern.length}</div><small>Autos unterwegs</small></div>
      ${extern.length ? `<div class="stat" style="grid-column:1/-1">${extern.slice(0, 5).map((e) => `<div class="carrow"><span class="dot" style="background:${STATUS_COLOR[e.status] || '#94a3b8'}"></span><span class="n">${esc(e.name)}</span><span class="chip">${esc(e.where)}</span></div>`).join('')}</div>` : ''}
      ${w ? `<div class="stat weather"><div><div class="temp">${Math.round(w.temp)}°</div><small>${esc(w.place)} · ${esc(w.text)} · Wind ${Math.round(w.wind || 0)} km/h</small></div>
        <div class="days">${(w.days || []).map((d) => `<div class="day">${new Date(`${d.date}T12:00`).toLocaleDateString('de-DE', { weekday: 'short' })}<b>${Math.round(d.max)}°</b>${Math.round(d.min)}° · ${d.rain ?? 0}%</div>`).join('')}</div></div>` : ''}
    </div>`;
}

/* ======================= v5.2: Widgets für eigene Dashboard-Seiten ======================= */
const WIDGET_TITLE = {
  event: 'Event-Countdown', work: 'Wer schraubt woran?', tasks: 'Heute zu tun', shortage: 'Mangel-Radar',
  tools: 'Werkzeug-Radar', hall: 'Hallenbelegung', banner: '', weather: 'Wetter', empty: ''
};

function wEvent() {
  const ev = data.event;
  if (!ev) return '<div class="w-empty">Kein Event geplant. Zeit zum Schrauben!</div>';
  const pl = ev.packlist || { pct: 0, total: 0, packed: 0 };
  return `<div class="w-ev-name">${esc(ev.name)}</div>
    <div class="w-ev-meta">${esc(fmtDate(ev.date_start))}${ev.start_time ? ` · ${esc(ev.start_time)} Uhr` : ''}${ev.location ? ` · ${esc(ev.location)}` : ''}</div>
    <div class="countdown w-cd" data-cd></div>
    <div class="w-pack"><span>Packliste ${pl.packed}/${pl.total}</span><div class="bar"><span style="width:${pl.pct}%"></span></div><b>${pl.pct}%</b></div>
    <div class="w-chips">${(ev.vehicles || []).map((v) => `<span class="chip"><span class="dot" style="background:${STATUS_COLOR[v.status] || '#94a3b8'}"></span>${esc(v.name)}${v.open_tasks ? ` · ${v.open_tasks} offen` : ''}</span>`).join('')}</div>`;
}

function wWork() {
  const work = data.work || [];
  const urgent = (data.tasks && data.tasks.urgent) || [];
  return `${work.length ? work.slice(0, 4).map((w) => `
      <div class="work"><span class="avatar" style="background:${esc(w.user_color)}">${esc(initials(w.user_name))}</span>
        <div><b>${esc(w.user_name)}</b><span>schraubt an <em>${esc(w.vehicle_name || 'der Halle')}</em>${w.text || w.task_title ? ` · ${esc(w.text || w.task_title)}` : ''}<br>${esc(since(w.started_at))}</span></div></div>`).join('')
    : '<div class="w-empty">Gerade schraubt niemand.</div>'}
    ${urgent.length ? `<div class="w-sub">Als Nächstes</div>${urgent.slice(0, work.length ? 3 : 6).map((t) => `<div class="task ${esc(t.urgency)}"><span class="t">${esc(t.title)}</span><span class="car">${esc(t.vehicle_name)}</span></div>`).join('')}` : ''}`;
}

function wTasks() {
  const urgent = (data.tasks && data.tasks.urgent) || [];
  const hallTasks = (data.tasks && data.tasks.hall) || [];
  if (!urgent.length && !hallTasks.length) return '<div class="w-empty ok">Alles erledigt. Startklar!</div>';
  return `${urgent.slice(0, 8).map((t) => `<div class="task ${esc(t.urgency)}"><span class="t">${esc(t.title)}</span>
      <span class="car"><span class="dot" style="background:${esc(t.vehicle_color)}"></span>${esc(t.vehicle_name)} · ${esc(t.event_name)} in ${t.daysLeft} T</span></div>`).join('')}
    ${hallTasks.slice(0, Math.max(0, 8 - urgent.length)).map((t) => `<div class="task"><span class="t">${esc(t.title)}</span><span class="car">Halle</span></div>`).join('')}`;
}

function wShortage() {
  const hud = data.hud || {};
  const crit = hud.critical || [];
  const low = (hud.consumables || []).filter((c) => c.low && !c.crit);
  const sup = (data.supplies || []).filter((s) => s.low);
  const t = data.tyres || { driftActive: 99 };
  const rows = [
    ...crit.map((c) => `<div class="sh-li crit"><span class="t">${esc(c.name)}</span><b>${c.qty <= 0 ? 'LEER' : `${fmtQ(c.qty, c.kind)} ${esc(c.unit)}`}</b><small>mind. ${fmtQ(c.min_qty, c.kind)}</small></div>`),
    ...low.map((c) => `<div class="sh-li warn"><span class="t">${esc(c.name)}</span><b>${fmtQ(c.qty, c.kind)} ${esc(c.unit)}</b><small>mind. ${fmtQ(c.min_qty, c.kind)}</small></div>`),
    ...sup.map((s) => `<div class="sh-li drink"><span class="t">🍺 ${esc(s.name)}</span><b>${s.qty <= 0 ? 'LEER' : `${s.qty} ${esc(s.unit)}`}</b><small>mind. ${s.min_qty}</small></div>`),
    ...(t.driftActive < 4 ? [`<div class="sh-li warn"><span class="t">Driftreifen</span><b>${t.driftActive}</b><small>aktiv</small></div>`] : [])
  ];
  return rows.length ? rows.slice(0, 9).join('') + (rows.length > 9 ? `<div class="w-more">+ ${rows.length - 9} weitere</div>` : '')
    : '<div class="w-empty ok">Alles im grünen Bereich. Prost!</div>';
}

function wTools() {
  const lent = (data.hud && data.hud.lent) || [];
  const fl = ((data.hud && data.hud.floating) || []).filter((f) => f.kind === 'tool' || f.source === 'borrow');
  const od = lent.filter((l) => l.overdue);
  const ok = lent.filter((l) => !l.overdue);
  const rows = [
    ...od.map((l) => `<div class="tl-li od"><span class="t">⚠ ${esc(l.name)}</span><span class="w">Überfällig: bei <b>${esc(l.lent_to)}</b> seit ${l.overdue_days} ${l.overdue_days === 1 ? 'Tag' : 'Tagen'}!</span></div>`),
    ...ok.map((l) => `<div class="tl-li lent"><span class="t">${esc(l.name)}</span><span class="w">verliehen an ${esc(l.lent_to)}${l.lent_due ? ` · zurück ${l.due_in === 0 ? 'heute' : `in ${l.due_in} T`}` : ''}</span></div>`),
    ...fl.map((f) => `<div class="tl-li fl"><span class="t">${esc(f.label)}</span><span class="w">${esc(f.spot || 'in der Halle')}${f.user_name ? ` · ${esc(f.user_name)}` : ''}</span></div>`)
  ];
  return `<div class="w-count"><span><b>${lent.length}</b> außer Haus</span>${od.length ? `<span class="od"><b>${od.length}</b> überfällig</span>` : ''}<span><b>${fl.length}</b> in Benutzung</span></div>
    ${rows.length ? rows.slice(0, 8).join('') + (rows.length > 8 ? `<div class="w-more">+ ${rows.length - 8} weitere</div>` : '') : '<div class="w-empty ok">Alles Werkzeug ist an seinem Platz.</div>'}`;
}

function wHall() {
  const total = (data.slots || []).reduce((a, s) => a + s.capacity, 0);
  const extern = data.extern || [];
  return `<div class="w-hall">${hallSvg()}<div class="w-hall-side">
      <div class="stat"><div class="num" style="color:${data.freePlaces ? '#a3e635' : '#f43f5e'}">${data.freePlaces}</div><small>frei von ${total}</small></div>
      <div class="stat"><div class="num" style="color:#fbbf24">${extern.length}</div><small>unterwegs</small></div>
    </div></div>`;
}

function wBanner(tile) {
  const text = esc(tile.text || '').replace(/\n/g, '<br>');
  if (tile.scroll) return `<div class="w-banner-run"><div class="tv-led-track" style="animation-duration:${Math.max(12, (tile.text || '').length * 0.22)}s"><span>${esc(tile.text || '')}   ✦   </span><span>${esc(tile.text || '')}   ✦   </span></div></div>`;
  return `<div class="w-banner-text">${text || '&nbsp;'}</div>`;
}

function wWeather() {
  const w = data.weather;
  if (!w) return '<div class="w-empty">Kein Wetter eingerichtet (Admin · TV-Dashboard).</div>';
  return `<div class="w-weather"><div class="temp">${Math.round(w.temp)}°</div><small>${esc(w.place)} · ${esc(w.text)} · Wind ${Math.round(w.wind || 0)} km/h</small>
    <div class="days">${(w.days || []).map((d) => `<div class="day">${new Date(`${d.date}T12:00`).toLocaleDateString('de-DE', { weekday: 'short' })}<b>${Math.round(d.max)}°</b>${Math.round(d.min)}° · ${d.rain ?? 0}%</div>`).join('')}</div></div>`;
}

const WIDGETS = { event: wEvent, work: wWork, tasks: wTasks, shortage: wShortage, tools: wTools, hall: wHall, banner: wBanner, weather: wWeather, empty: () => '' };

function renderTile(tile) {
  const w = WIDGETS[tile.widget] ? tile.widget : 'empty';
  const title = tile.title || WIDGET_TITLE[w];
  const od = w === 'tools' && ((data.hud && data.hud.lent) || []).some((l) => l.overdue);
  const alarm = (w === 'shortage' && ((data.hud && data.hud.critical) || []).length) || od;
  return `<div class="panel w-cell wt-${w} ${w === 'banner' ? `tone-${esc(tile.tone || 'info')}` : ''} ${alarm ? 'w-alarm' : ''}">
    ${title ? `<div class="h">${w === 'work' ? '<span class="live"></span>' : ''}${esc(title)}</div>` : ''}
    <div class="w-body">${WIDGETS[w](tile)}</div></div>`;
}

const RENDER = { tasks: renderTasks, event: renderEvent, stock: renderStock, hall: renderHall };
const CLASS = { tasks: 's-tasks', event: 's-event', stock: 's-stock', hall: 's-hall' };

/* ======================= Ablauf ======================= */
// Ein Eintrag in "order" ist entweder ein klassischer Screen ('tasks', 'event' ...) oder eine Baukasten-Seite ('g<ID>')
const slideOf = (key) => (String(key).startsWith('g') ? (data.slides || []).find((x) => `g${x.id}` === key) : null);

function sectionFor(key) {
  let sec = document.querySelector(`[data-screen="${key}"]`);
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'tv-screen';
    sec.dataset.screen = key;
    $('#stage').insertBefore(sec, $('#message'));
  }
  return sec;
}

/** Text so lange verkleinern, bis er in seine Kachel passt (Banner, lange Event-Namen) */
function fitText(el) {
  const box = el.closest('.w-body') || el.parentElement;
  if (!box) return;
  let size = parseFloat(getComputedStyle(el).fontSize) || 40;
  const oneLine = el.classList.contains('w-ev-name');
  const fits = () => (oneLine ? el.scrollWidth <= el.clientWidth + 2
    : el.scrollHeight <= box.clientHeight + 2 && el.scrollWidth <= el.clientWidth + 2 && box.scrollHeight <= box.clientHeight + 2);
  let guard = 0;
  while (!fits() && size > 12 && guard < 60) { size *= 0.92; el.style.fontSize = `${size}px`; guard += 1; }
}

function renderScreen(name) {
  const sec = sectionFor(name);
  const on = sec.classList.contains('on') ? 'on' : '';
  const slide = slideOf(name);
  if (slide) {
    sec.className = `tv-screen tv-grid dl-${slide.layout} ${on}`;
    sec.innerHTML = slide.tiles.map(renderTile).join('');
    requestAnimationFrame(() => sec.querySelectorAll('.w-banner-text, .w-ev-name').forEach(fitText));
  } else {
    sec.className = `tv-screen ${CLASS[name]} ${on}`;
    sec.innerHTML = RENDER[name]();
  }
  tickCountdown();
}

function renderDots() {
  $('#dots').innerHTML = order.map((n, i) => `<span class="${i === idx ? 'on' : ''}">${esc(slideOf(n) ? slideOf(n).name : SCREEN_NAMES[n])}</span>`).join('');
}

function show(i) {
  const prev = order[idx];
  idx = i % order.length;
  const name = order[idx];
  sectionFor(name);
  document.querySelectorAll('.tv-screen').forEach((s) => {
    const n = s.dataset.screen;
    s.classList.remove('out');
    if (n === name) { s.classList.add('on'); } else if (n === prev) { s.classList.remove('on'); s.classList.add('out'); } else s.classList.remove('on');
  });
  renderScreen(name);
  renderDots();
  slideStart = Date.now();
  schedule();
}

/** Anzeigedauer des aktuellen Screens: eigene Dauer der Seite, sonst das allgemeine Intervall */
function durationMs() {
  const slide = slideOf(order[idx]);
  const sec = (slide && slide.duration) || (data.config && data.config.interval) || 18;
  return Math.max(5, sec) * 1000;
}

function schedule() {
  clearTimeout(slideTimer);
  if (order.length < 2) return;
  slideTimer = setTimeout(() => show(idx + 1), durationMs());
}

function tickCountdown() {
  const els = document.querySelectorAll('#countdown, [data-cd]');
  if (!els.length || !data || !data.event) return;
  const diff = Math.max(0, eventStart(data.event) - Date.now());
  const d = Math.floor(diff / 86400000); const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000); const s = Math.floor((diff % 60000) / 1000);
  const htmlCd = `<div class="cd-unit"><b>${pad(d)}</b><i>Tage</i></div><span class="cd-sep">:</span>
    <div class="cd-unit"><b>${pad(h)}</b><i>Std</i></div><span class="cd-sep">:</span>
    <div class="cd-unit"><b>${pad(m)}</b><i>Min</i></div><span class="cd-sep">:</span>
    <div class="cd-unit"><b>${pad(s)}</b><i>Sek</i></div>`;
  els.forEach((el) => { el.classList.toggle('hot', d < 3); el.innerHTML = htmlCd; });
}

function renderLed() {
  const seg = [];
  ((data.hud && data.hud.critical) || []).forEach((c) => seg.push(`KRITISCHER MANGEL: ${c.text}`));   // v4
  ((data.hud && data.hud.lent) || []).filter((l) => l.overdue).forEach((l) => seg.push(l.text));         // v5.2
  seg.push(...((data.config && data.config.messages) || []));
  if (data.event) {
    const diff = eventStart(data.event) - Date.now();
    const days = Math.floor(diff / 86400000);
    const hours = Math.max(0, Math.floor(diff / 3600000));
    seg.push(diff <= 0 ? `${data.event.name} läuft!` : days >= 1 ? `Noch ${days} ${days === 1 ? 'Tag' : 'Tage'} bis ${data.event.name}` : `Noch ${hours} Stunden bis ${data.event.name}`,
      `Packliste ${data.event.packlist.pct}% fertig`);
  }
  (data.supplies || []).filter((s) => s.low).forEach((s) => seg.push(`${s.name} ${s.qty <= 0 ? 'leer' : 'fast leer'}!`));
  if (data.tyres && data.tyres.driftActive < 4) seg.push(`Nur noch ${data.tyres.driftActive} Driftreifen!`);
  if (data.hud && data.hud.floatCount) seg.push(`${data.hud.floatCount} ${data.hud.floatCount === 1 ? 'Ding liegt' : 'Dinge liegen'} in der Halle rum: bitte aufräumen!`);
  if (!seg.length) seg.push(`${data.hall.name || 'Halle'} · Viel Spaß beim Schrauben`);
  const text = seg.join('   ✦   ');
  if (text === lastLed) return;
  lastLed = text;
  const track = $('#ledTrack');
  track.innerHTML = `<span>${esc(text)}   ✦   </span><span>${esc(text)}   ✦   </span>`;
  track.style.animationDuration = `${Math.max(25, text.length * 0.28)}s`;
}

async function load() {
  try {
    const r = await fetch(`/api/tv/data?key=${encodeURIComponent(KEY)}${ONLY_SLIDE ? `&preview=${ONLY_SLIDE}` : ''}`, { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Fehler');
    const firstLoad = !data;
    const oldOrder = order.join();
    data = j;
    $('#message').hidden = true;
    $('#hallName').textContent = data.hall.name || 'Hallen-TV';
    const slides = (data.slides || []).filter((x) => !ONLY_SLIDE || x.id === ONLY_SLIDE);
    if (slides.length && (data.config.useGrid || ONLY_SLIDE)) order = slides.map((x) => `g${x.id}`);   // v5.2: Baukasten
    else order = Object.keys(SCREEN_NAMES).filter((k) => data.config.screens[k] !== false);
    if (!order.length) order = ['tasks'];
    // Seiten, die es nicht mehr gibt, aus der Bühne entfernen
    document.querySelectorAll('.tv-screen').forEach((sct) => { if (sct.dataset.screen.startsWith('g') && !order.includes(sct.dataset.screen)) sct.remove(); });
    renderLed();
    renderAlarm();   // v4
    if (firstLoad || oldOrder !== order.join()) { idx = -1; show(0); } else renderScreen(order[idx]);
  } catch (err) {
    if (!data) {
      const m = $('#message');
      m.hidden = false;
      m.innerHTML = `${esc(err.message)}<br><small style="font-size:2.2vh">Öffne den TV-Link aus der Admin-Konsole (TV-Dashboard).</small>`;
    }
  }
}

function clock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
  if (data && order.length) {
    $('#progress').style.width = order.length > 1 ? `${Math.min(100, ((Date.now() - slideStart) / durationMs()) * 100)}%` : '100%';
  }
  tickCountdown();
}

async function keepAwake() {
  try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch { /* egal */ }
}

(async function start() {
  try { meta = await (await fetch('/api/meta')).json(); } catch { /* Sprites fallen auf Dummy zurück */ }
  await load();
  setInterval(load, 30000);
  setInterval(clock, 250);
  clock();
  keepAwake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });
  setTimeout(() => location.reload(), 6 * 3600 * 1000);
})();
