/**
 * v5.4: Kalender / Bühnen-Belegung (Reiter "Kalender")
 * Tag, Woche, Monat. Balken je Hebebühne: wer (Farbe der Person) macht was (Aufgabe / Auto) wie lange.
 * Überschneidungen auf derselben Bühne leuchten als "Bühnen-Konflikt!".
 */
import { app, canEdit } from './state.js';
import { get } from './api.js';
import { html, setHTML, on, icon, toastError } from './ui.js';
import { openTaskPlan, liftList } from './workload.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY0 = 6;    // sichtbarer Bereich 06:00 bis 22:00
const DAY1 = 22;
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let view = 'week';
let anchor = new Date();

function range() {
  if (view === 'day') return [anchor, anchor];
  if (view === 'week') { const s = addDays(anchor, -((anchor.getDay() + 6) % 7)); return [s, addDays(s, 6)]; }
  const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return [s, new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)];
}

const hourOf = (dt) => Number(dt.slice(11, 13)) + Number(dt.slice(14, 16)) / 60;
/** Balken-Position (in %) für einen Tag, abgeschnitten auf den sichtbaren Bereich */
function barPos(b, day) {
  const s = b.lift_from.slice(0, 10) < day ? DAY0 : Math.max(DAY0, hourOf(b.lift_from));
  const e = b.lift_to.slice(0, 10) > day ? DAY1 : Math.min(DAY1, hourOf(b.lift_to));
  if (e <= s) return null;
  return { left: ((s - DAY0) / (DAY1 - DAY0)) * 100, width: ((e - s) / (DAY1 - DAY0)) * 100 };
}
const onDay = (b, day) => b.lift_from.slice(0, 10) <= day && b.lift_to.slice(0, 10) >= day && !(b.lift_to.slice(0, 10) === day && b.lift_to.slice(11) === '00:00');
const who = (b) => b.assigned_name || 'offen';
const barColor = (b) => b.assigned_color || b.vehicle_color || '#64748b';

function lanes(lifts, bookings) {
  const out = lifts.map((l) => ({ key: l.id, label: l.label || l.code, list: bookings.filter((b) => b.lift_slot === l.id) }));
  const any = bookings.filter((b) => !b.lift_slot);
  if (any.length) out.push({ key: 0, label: 'Egal', list: any });
  return out;
}

function bar(b, day, { slim = false } = {}) {
  const p = barPos(b, day);
  if (!p) return '';
  return html`<button class="cal-bar ${b.conflict ? 'is-conflict' : ''} ${slim ? 'slim' : ''}" style="left:${p.left}%;width:${p.width}%;--c:${barColor(b)}" data-cal-task="${b.id}"
    title="${b.lift_from.slice(11)}–${b.lift_to.slice(11)} · ${b.vehicle_name || 'Halle'} · ${b.title} · ${who(b)}${b.conflict ? ' · BÜHNEN-KONFLIKT!' : ''}">
    ${slim ? '' : html`<span class="truncate">${b.lift_from.slice(11)} ${b.vehicle_name ? `${b.vehicle_name}: ` : ''}${b.title} · ${who(b)}</span>`}</button>`;
}

function hourScale(offset = false) {
  return html`<div class="cal-scale ${offset ? 'offset' : ''}">${[6, 9, 12, 15, 18, 21].map((h) => html`<span style="left:${((h - DAY0) / (DAY1 - DAY0)) * 100}%">${h}</span>`)}</div>`;
}

function dayView(data, day) {
  const nowPct = data.now.slice(0, 10) === day ? ((hourOf(data.now) - DAY0) / (DAY1 - DAY0)) * 100 : null;
  const list = data.bookings.filter((b) => onDay(b, day));
  return html`
    ${hourScale()}
    <div class="space-y-2">${lanes(data.lifts, list).map((l) => html`
      <div><div class="text-[11px] font-display font-bold tracking-wider text-cyan-300 mb-1">${l.label.toUpperCase()}</div>
        <div class="cal-lane tall">${nowPct !== null && nowPct >= 0 && nowPct <= 100 ? html`<span class="cal-now" style="left:${nowPct}%"></span>` : ''}${l.list.map((b) => bar(b, day))}</div></div>`)}</div>
    <div class="space-y-1.5 mt-4">${list.length ? list.map((b) => html`
      <button class="card card-hover w-full text-left px-3 py-2 flex items-center gap-2 ${b.conflict ? '!border-rose-400/60' : ''}" data-cal-task="${b.id}">
        <span class="w-2.5 h-8 rounded-full shrink-0" style="background:${barColor(b)}"></span>
        <div class="flex-1 min-w-0 text-sm"><div class="text-white truncate">${b.vehicle_name ? html`<b>${b.vehicle_name}</b> · ` : ''}${b.title}</div>
          <div class="text-[11px] text-slate-400">${b.lift_from.slice(11)}–${b.lift_to.slice(11)} · ${b.lift_slot ? (data.lifts.find((x) => x.id === b.lift_slot) || {}).label : 'Bühne egal'} · ${who(b)}</div></div>
        ${b.conflict ? html`<span class="chip !text-rose-200 !border-rose-400/60 !bg-rose-500/15">${icon('alert', 'w-3 h-3')} Konflikt</span>` : ''}
      </button>`) : html`<p class="text-sm text-slate-500">Keine Bühne reserviert.</p>`}</div>`;
}

function weekView(data, start) {
  return html`${hourScale(true)}<div class="space-y-1.5">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(start, i);
    const day = ymd(d);
    const list = data.bookings.filter((b) => onDay(b, day));
    return html`<div class="flex items-stretch gap-2 ${day === data.now.slice(0, 10) ? 'cal-today' : ''}">
      <button class="w-10 shrink-0 text-left text-[11px] leading-tight text-slate-400 hover:text-white" data-cal-day="${day}"><b class="text-white">${WD[i]}</b><br>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</button>
      <div class="flex-1 min-w-0 space-y-0.5">${lanes(data.lifts, list).map((l) => html`<div class="cal-lane" title="${l.label}">${l.list.map((b) => bar(b, day, { slim: true }))}</div>`)}</div>
    </div>`;
  })}</div>
  <p class="text-[10px] text-slate-500 mt-2">Je Tag eine Zeile pro Bühne (${data.lifts.map((l) => l.label || l.code).join(', ')}). Tag antippen für Details.</p>`;
}

function monthView(data, first) {
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1))];
  return html`<div class="grid grid-cols-7 gap-1 text-[10px] text-slate-500 mb-1">${WD.map((w) => html`<div class="text-center">${w}</div>`)}</div>
    <div class="grid grid-cols-7 gap-1">${cells.map((d) => {
      if (!d) return html`<div></div>`;
      const day = ymd(d);
      const list = data.bookings.filter((b) => onDay(b, day));
      const conflict = list.some((b) => b.conflict);
      return html`<button class="cal-cell ${day === data.now.slice(0, 10) ? 'cal-today' : ''} ${conflict ? 'is-conflict' : ''}" data-cal-day="${day}">
        <span class="text-[11px] ${list.length ? 'text-white' : 'text-slate-500'}">${d.getDate()}</span>
        <span class="flex flex-wrap gap-0.5">${list.slice(0, 6).map((b) => html`<i style="background:${barColor(b)}"></i>`)}</span></button>`;
    })}</div>`;
}

export async function renderCalendarPanel(container) {
  const [s, e] = range();
  let data;
  try { data = await get(`/lift-calendar?from=${ymd(s)}&to=${ymd(e)}`); } catch (err) { toastError(err); return; }
  container._calData = data;
  const conflicts = data.bookings.filter((b) => b.conflict);
  const title = view === 'day' ? s.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : view === 'week' ? `${s.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${e.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
      : s.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  setHTML(container, html`
    <div class="p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div><h3 class="font-display font-bold tracking-wider text-white">Kalender / Bühnen-Belegung</h3><p class="text-xs text-slate-500">${data.lifts.length} Hebebühne${data.lifts.length === 1 ? '' : 'n'} · ${data.bookings.length} Reservierung${data.bookings.length === 1 ? '' : 'en'}</p></div>
        ${canEdit() && data.lifts.length ? html`<button class="btn btn-sm btn-primary" data-cal-new>${icon('plus')} Reservieren</button>` : ''}
      </div>
      <div class="flex items-center gap-1.5">
        ${['day', 'week', 'month'].map((v) => html`<button class="chip chip-btn ${view === v ? 'on' : ''}" data-cal-view="${v}">${{ day: 'Tag', week: 'Woche', month: 'Monat' }[v]}</button>`)}
        <span class="flex-1"></span>
        <button class="btn-icon !w-8 !h-8" data-cal-step="-1" title="Zurück">‹</button>
        <button class="chip chip-btn" data-cal-today>Heute</button>
        <button class="btn-icon !w-8 !h-8" data-cal-step="1" title="Weiter">›</button>
      </div>
      <div class="text-sm font-semibold text-white">${title}</div>
      ${conflicts.length ? html`<div class="cal-alert">${icon('alert', 'w-4 h-4 shrink-0')}<div><b>Bühnen-Konflikt!</b> ${conflicts.length} Reservierung${conflicts.length === 1 ? '' : 'en'} überschneiden sich:
        ${conflicts.map((b) => html`<button class="underline mr-1" data-cal-task="${b.id}">${b.vehicle_name || b.title} (${b.lift_from.slice(8, 10)}.${b.lift_from.slice(5, 7)}. ${b.lift_from.slice(11)})</button>`)}</div></div>` : ''}
      ${!data.lifts.length ? html`<div class="card p-6 text-center text-slate-400 text-sm">Keine Hebebühne angelegt. Im Garage-Builder einen Stellplatz mit Art „Hebebühne“ anlegen.</div>`
        : view === 'day' ? dayView(data, ymd(s)) : view === 'week' ? weekView(data, s) : monthView(data, s)}
    </div>`);

  if (container.dataset.boundCal) return;
  container.dataset.boundCal = '1';
  const again = () => app.rerenderTab('calendar');
  on(container, 'click', '[data-cal-view]', (_e, b) => { view = b.dataset.calView; again(); });
  on(container, 'click', '[data-cal-today]', () => { anchor = new Date(); again(); });
  on(container, 'click', '[data-cal-step]', (_e, b) => {
    const n = Number(b.dataset.calStep);
    anchor = view === 'day' ? addDays(anchor, n) : view === 'week' ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
    again();
  });
  on(container, 'click', '[data-cal-day]', (_e, b) => { anchor = new Date(`${b.dataset.calDay}T12:00`); view = 'day'; again(); });
  on(container, 'click', '[data-cal-new]', () => {
    const day = view === 'day' ? ymd(anchor) : ymd(new Date());
    openTaskPlan({ lift_slot: (liftList()[0] || {}).id, lift_from: `${day}T09:00`, lift_to: `${day}T11:00`, estimated_hours: 2 }, again, { pickVehicle: true });
  });
  on(container, 'click', '[data-cal-task]', async (_e, b) => {
    try {
      const t = (await get('/tasks?status=open')).find((x) => x.id === Number(b.dataset.calTask));
      if (!t) return;
      if (canEdit()) openTaskPlan(t, again);
      else if (t.vehicle_id) app.navigate({ kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' });
    } catch (err) { toastError(err); }
  });
}

