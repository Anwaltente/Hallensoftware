/**
 * v5.4/v5.5: Kalender / Bühnen-Belegung (Reiter "Kalender")
 * Bühnen werden ganztägig reserviert (Von/Bis in der Aufgabe, keine Uhrzeiten). Tag, Woche, Monat zeigen Tages-Blöcke
 * je Hebebühne ("Bühne 1 blockiert von Sa bis Mo durch E36 Diff-Tausch"). Überschneidung am selben Tag = "Bühnen-Konflikt!".
 * Darunter die fälligen Aufgaben des Zeitraums, Fälligkeit direkt verschiebbar (+1 Tag, +1 Woche, Datum wählen).
 */
import { app, canEdit } from './state.js';
import { get } from './api.js';
import { html, setHTML, on, icon, toastError } from './ui.js';
import { openTaskPlan, dueControl } from './workload.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let view = 'week';
let anchor = new Date();

function range() {
  if (view === 'day') return [anchor, anchor];
  if (view === 'week') { const s = addDays(anchor, -((anchor.getDay() + 6) % 7)); return [s, addDays(s, 6)]; }
  const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return [s, new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)];
}

const von = (b) => b.lift_from.slice(0, 10);
const onDay = (b, day) => von(b) <= day && b.lift_bis >= day;
const who = (b) => b.assigned_name || 'offen';
const barColor = (b) => b.assigned_color || b.vehicle_color || '#64748b';
const wd = (d) => `${WD[(new Date(`${d}T12:00`).getDay() + 6) % 7]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const liftLabel = (b, lifts) => (b.lift_slot ? (lifts.find((x) => x.id === b.lift_slot) || {}).label || 'Bühne' : 'Beliebige Bühne');
const what = (b) => [b.vehicle_name, b.title].filter(Boolean).join(' ');
const blockText = (b, lifts) => `${liftLabel(b, lifts)} blockiert ${von(b) === b.lift_bis ? `am ${wd(von(b))}` : `von ${wd(von(b))} bis ${wd(b.lift_bis)}`} durch ${what(b)}`;

function lanes(lifts, bookings) {
  const out = lifts.map((l) => ({ key: l.id, label: l.label || l.code, list: bookings.filter((b) => b.lift_slot === l.id) }));
  const any = bookings.filter((b) => !b.lift_slot);
  if (any.length) out.push({ key: 0, label: 'Beliebige Bühne', list: any });
  return out;
}

/** Ganztägiger Block (füllt die Bahn des Tages) */
function block(b, { slim = false } = {}) {
  return html`<button class="cal-bar ${b.conflict ? 'is-conflict' : ''} ${slim ? 'slim' : ''}" style="left:0;width:100%;--c:${barColor(b)}" data-cal-task="${b.id}"
    title="${what(b)} · ${who(b)}${b.conflict ? ' · BÜHNEN-KONFLIKT!' : ''}"><span class="truncate">${what(b)} · ${who(b)}</span></button>`;
}

function listBlock(data, bookings) {
  return html`<div class="space-y-1.5 mt-4">${bookings.length ? bookings.map((b) => html`
    <button class="card card-hover w-full text-left px-3 py-2 flex items-center gap-2 ${b.conflict ? '!border-rose-400/60' : ''}" data-cal-task="${b.id}">
      <span class="w-2.5 h-8 rounded-full shrink-0" style="background:${barColor(b)}"></span>
      <div class="flex-1 min-w-0 text-sm"><div class="text-white">${blockText(b, data.lifts)}</div>
        <div class="text-[11px] text-slate-400">${who(b)}</div></div>
      ${b.conflict ? html`<span class="chip !text-rose-200 !border-rose-400/60 !bg-rose-500/15">${icon('alert', 'w-3 h-3')} Konflikt</span>` : ''}
    </button>`) : html`<p class="text-sm text-slate-500">Keine Bühne reserviert.</p>`}</div>`;
}

function dueBlock(tasks) {
  if (!tasks.length) return '';
  return html`<div class="mt-5"><h4 class="font-display text-xs tracking-[0.2em] text-slate-400 mb-2">FÄLLIGE AUFGABEN IM ZEITRAUM</h4>
    <div class="space-y-1.5">${tasks.map((t) => html`
      <div class="card px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button class="text-left text-sm text-white hover:text-cyan-300 min-w-0 flex-1" data-cal-edit="${t.id}">${t.vehicle_name ? html`<b>${t.vehicle_name}</b> · ` : ''}${t.title}</button>
        <span class="inline-flex flex-wrap items-center gap-1">${dueControl(t)}</span>
      </div>`)}</div></div>`;
}

function dayView(data, day) {
  const list = data.bookings.filter((b) => onDay(b, day));
  return html`
    <div class="space-y-2">${lanes(data.lifts, list).map((l) => html`
      <div><div class="text-[11px] font-display font-bold tracking-wider text-cyan-300 mb-1">${l.label.toUpperCase()}</div>
        <div class="cal-lane tall ${l.list.length > 1 ? 'multi' : ''}">${l.list.map((b) => block(b))}${l.list.length ? '' : html`<span class="absolute inset-0 grid place-items-center text-[11px] text-slate-500">frei</span>`}</div></div>`)}</div>`;
}

function weekView(data, start) {
  return html`<div class="space-y-1.5">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(start, i);
    const day = ymd(d);
    const list = data.bookings.filter((b) => onDay(b, day));
    return html`<div class="flex items-stretch gap-2 ${day === data.now.slice(0, 10) ? 'cal-today' : ''}">
      <button class="w-10 shrink-0 text-left text-[11px] leading-tight text-slate-400 hover:text-white" data-cal-day="${day}"><b class="text-white">${WD[i]}</b><br>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</button>
      <div class="flex-1 min-w-0 space-y-0.5">${lanes(data.lifts, list).map((l) => html`<div class="cal-lane mid ${l.list.length > 1 ? 'multi' : ''}" title="${l.label}">${l.list.map((b) => block(b))}</div>`)}</div>
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
  let tasks = [];
  try {
    [data, tasks] = await Promise.all([get(`/lift-calendar?from=${ymd(s)}&to=${ymd(e)}`), get('/tasks?status=open')]);
  } catch (err) { toastError(err); return; }
  container._calData = data;
  container._calTasks = tasks;
  const due = tasks.filter((t) => t.target_date && t.target_date >= ymd(s) && t.target_date <= ymd(e)).sort((a, b) => a.target_date.localeCompare(b.target_date));
  const conflicts = data.bookings.filter((b) => b.conflict);
  const title = view === 'day' ? s.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : view === 'week' ? `${s.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${e.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
      : s.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  setHTML(container, html`
    <div class="p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div><h3 class="font-display font-bold tracking-wider text-white">Kalender / Bühnen-Belegung</h3><p class="text-xs text-slate-500">${data.lifts.length} Hebebühne${data.lifts.length === 1 ? '' : 'n'} · ${data.bookings.length} Reservierung${data.bookings.length === 1 ? '' : 'en'}</p></div>
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
        ${conflicts.map((b) => html`<button class="underline mr-1" data-cal-task="${b.id}">${what(b)} (${von(b).slice(8, 10)}.${von(b).slice(5, 7)}.)</button>`)}</div></div>` : ''}
      ${!data.lifts.length ? html`<div class="card p-6 text-center text-slate-400 text-sm">Keine Hebebühne angelegt. Im Garage-Builder einen Stellplatz mit Art „Hebebühne“ anlegen.</div>`
        : html`${view === 'day' ? dayView(data, ymd(s)) : view === 'week' ? weekView(data, s) : monthView(data, s)}
          ${listBlock(data, data.bookings)}`}
      ${dueBlock(due)}
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
  on(container, 'click', '[data-cal-task], [data-cal-edit]', (_e, b) => {
    const t = container._calTasks.find((x) => x.id === Number(b.dataset.calTask || b.dataset.calEdit));
    if (!t) return;
    if (canEdit()) openTaskPlan(t, again);
    else if (t.vehicle_id) app.navigate({ kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' });
  });
}

