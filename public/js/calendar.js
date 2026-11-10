/**
 * v5.4/v5.5: Kalender / Bühnen-Belegung (Reiter "Kalender")
 * Bühnen werden ganztägig reserviert (Von/Bis in der Aufgabe, keine Uhrzeiten). Tag, Woche, Monat zeigen Tages-Blöcke
 * je Hebebühne ("Bühne 1 blockiert von Sa bis Mo durch E36 Diff-Tausch"). Überschneidung am selben Tag = "Bühnen-Konflikt!".
 * Darunter die fälligen Aufgaben des Zeitraums, Fälligkeit direkt verschiebbar (+1 Tag, +1 Woche, Datum wählen).
 * v5.6: Aufgaben am selben Fahrzeug auf derselben Bühne werden zu einem Block zusammengefasst (kein Konflikt),
 * Bühnen-Filter oben, "Freie Bühne finden".
 */
import { app, canEdit } from './state.js';
import { get } from './api.js';
import { html, setHTML, on, icon, toastError } from './ui.js';
import { openTaskPlan, dueControl } from './workload.js';
import { openLiftFinder } from './liftfinder.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let view = 'week';
let liftFilter = 'all';   // 'all' | Bühnen-ID | 'none' (nicht bühnengebunden, also "egal" oder ohne Reservierung)
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
/** Aufgaben desselben Fahrzeugs auf derselben Bühne in einem Block (bei Überschneidung der Tage); Eingabe nach Beginn sortiert */
function cluster(list) {
  const out = [];
  for (const b of list) {
    const c = b.vehicle_id && out.find((x) => x.vehicle_id === b.vehicle_id && x.lift_slot === b.lift_slot && von(b) <= x.bis);
    if (c) { c.tasks.push(b); if (b.lift_bis > c.bis) c.bis = b.lift_bis; c.conflict = c.conflict || b.conflict; } else out.push({ ...b, tasks: [b], von: von(b), bis: b.lift_bis });
  }
  return out;
}
const label = (c) => (c.tasks.length > 1 ? `${c.vehicle_name} (${c.tasks.length} Aufgaben: ${c.tasks.map((t) => t.title).join(', ')})` : what(c));
const blockText = (c, lifts) => `${liftLabel(c, lifts)} blockiert ${c.von === c.bis ? `am ${wd(c.von)}` : `von ${wd(c.von)} bis ${wd(c.bis)}`} durch ${label(c)}`;

function lanes(data, bookings) {
  const out = data.lifts.map((l) => ({ key: l.id, label: l.label || l.code, list: cluster(bookings.filter((b) => b.lift_slot === l.id)) }));
  const any = cluster(bookings.filter((b) => !b.lift_slot));
  if (any.length || data.showAny) out.push({ key: 0, label: 'Beliebige Bühne', list: any });
  return out;
}

/** Ganztägiger Block (füllt die Bahn des Tages) */
function block(c, { slim = false } = {}) {
  return html`<button class="cal-bar ${c.conflict ? 'is-conflict' : ''} ${slim ? 'slim' : ''}" style="left:0;width:100%;--c:${barColor(c)}" data-cal-task="${c.id}"
    title="${label(c)}${c.tasks.length > 1 ? '' : ` · ${who(c)}`}${c.conflict ? ' · BÜHNEN-KONFLIKT!' : ''}"><span class="truncate">${label(c)}${c.tasks.length > 1 ? '' : ` · ${who(c)}`}</span></button>`;
}

function listBlock(data, bookings) {
  const cl = cluster(bookings);
  return html`<div class="space-y-1.5 mt-4">${cl.length ? cl.map((c) => html`
    <div class="card px-3 py-2 flex items-center gap-2 ${c.conflict ? '!border-rose-400/60' : ''}">
      <span class="w-2.5 h-8 rounded-full shrink-0" style="background:${barColor(c)}"></span>
      <div class="flex-1 min-w-0 text-sm"><button class="text-left text-white hover:text-cyan-300" data-cal-task="${c.id}">${blockText(c, data.lifts)}</button>
        ${c.tasks.length > 1 ? html`<div class="flex flex-wrap gap-1 mt-1">${c.tasks.map((t) => html`<button class="chip chip-btn !text-[10px]" data-cal-task="${t.id}">${t.title}</button>`)}</div>`
          : html`<div class="text-[11px] text-slate-400">${who(c)}</div>`}</div>
      ${c.conflict ? html`<span class="chip !text-rose-200 !border-rose-400/60 !bg-rose-500/15">${icon('alert', 'w-3 h-3')} Konflikt</span>` : ''}
    </div>`) : html`<p class="text-sm text-slate-500">Keine Bühne reserviert.</p>`}</div>`;
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
    <div class="space-y-2">${lanes(data, list).map((l) => html`
      <div><div class="text-[11px] font-display font-bold tracking-wider text-cyan-300 mb-1">${l.label.toUpperCase()}</div>
        <div class="cal-lane tall ${l.list.length > 1 ? 'multi' : ''}">${l.list.map((c) => block(c))}${l.list.length ? '' : html`<span class="absolute inset-0 grid place-items-center text-[11px] text-slate-500">frei</span>`}</div></div>`)}</div>`;
}

function weekView(data, start) {
  return html`<div class="space-y-1.5">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(start, i);
    const day = ymd(d);
    const list = data.bookings.filter((b) => onDay(b, day));
    return html`<div class="flex items-stretch gap-2 ${day === data.now.slice(0, 10) ? 'cal-today' : ''}">
      <button class="w-10 shrink-0 text-left text-[11px] leading-tight text-slate-400 hover:text-white" data-cal-day="${day}"><b class="text-white">${WD[i]}</b><br>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</button>
      <div class="flex-1 min-w-0 space-y-0.5">${lanes(data, list).map((l) => html`<div class="cal-lane mid ${l.list.length > 1 ? 'multi' : ''}" title="${l.label}">${l.list.map((c) => block(c))}</div>`)}</div>
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
        <span class="flex flex-wrap gap-0.5">${cluster(list).slice(0, 6).map((c) => html`<i style="background:${barColor(c)}"></i>`)}</span></button>`;
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
  container._cal = { s, e, data, tasks };
  draw(container);
  bind(container);
}

/** Zeichnet aus den geladenen Daten (Filterwechsel ohne Neuladen) */
function draw(container) {
  const { s, e, data: all, tasks } = container._cal;
  const keep = (b) => liftFilter === 'all' || (liftFilter === 'none' ? !b.lift_slot : b.lift_slot === liftFilter);
  const data = { ...all, lifts: liftFilter === 'none' ? [] : all.lifts.filter((l) => liftFilter === 'all' || l.id === liftFilter), bookings: all.bookings.filter(keep), showAny: liftFilter === 'none' };
  const due = tasks.filter((t) => t.target_date && t.target_date >= ymd(s) && t.target_date <= ymd(e)
    && (liftFilter === 'all' || (liftFilter === 'none' ? !t.lift_slot : t.lift_slot === liftFilter))).sort((a, b) => a.target_date.localeCompare(b.target_date));
  const conflicts = cluster(data.bookings).filter((c) => c.conflict);
  const title = view === 'day' ? s.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    : view === 'week' ? `${s.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${e.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
      : s.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  setHTML(container, html`
    <div class="p-4 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div><h3 class="font-display font-bold tracking-wider text-white">Kalender / Bühnen-Belegung</h3><p class="text-xs text-slate-500">${all.lifts.length} Hebebühne${all.lifts.length === 1 ? '' : 'n'} · ${data.bookings.length} Reservierung${data.bookings.length === 1 ? '' : 'en'}</p></div>
      </div>
      <div class="flex items-center gap-1.5">
        ${['day', 'week', 'month'].map((v) => html`<button class="chip chip-btn ${view === v ? 'on' : ''}" data-cal-view="${v}">${{ day: 'Tag', week: 'Woche', month: 'Monat' }[v]}</button>`)}
        <span class="flex-1"></span>
        <button class="btn-icon !w-8 !h-8" data-cal-step="-1" title="Zurück">‹</button>
        <button class="chip chip-btn" data-cal-today>Heute</button>
        <button class="btn-icon !w-8 !h-8" data-cal-step="1" title="Weiter">›</button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <button class="chip chip-btn ${liftFilter === 'all' ? 'on' : ''}" data-cal-filter="all">Alle Bühnen anzeigen</button>
        ${all.lifts.map((l) => html`<button class="chip chip-btn ${liftFilter === l.id ? 'on' : ''}" data-cal-filter="${l.id}">Nur ${l.label || l.code}</button>`)}
        <button class="chip chip-btn ${liftFilter === 'none' ? 'on' : ''}" data-cal-filter="none">Nicht bühnengebundene Arbeiten</button>
        <span class="flex-1"></span>
        ${canEdit() && all.lifts.length ? html`<button class="btn btn-sm" data-cal-find>${icon('search', 'w-3.5 h-3.5')} Freie Bühne finden</button>` : ''}
      </div>
      <div class="text-sm font-semibold text-white">${title}</div>
      ${conflicts.length ? html`<div class="cal-alert">${icon('alert', 'w-4 h-4 shrink-0')}<div><b>Bühnen-Konflikt!</b> Unterschiedliche Fahrzeuge wollen dieselbe Bühne am selben Tag:
        ${conflicts.map((c) => html`<button class="underline mr-1" data-cal-task="${c.id}">${label(c)} (${c.von.slice(8, 10)}.${c.von.slice(5, 7)}.)</button>`)}</div></div>` : ''}
      ${!all.lifts.length ? html`<div class="card p-6 text-center text-slate-400 text-sm">Keine Hebebühne angelegt. Im Garage-Builder einen Stellplatz mit Art „Hebebühne“ anlegen.</div>`
        : html`${view === 'day' ? dayView(data, ymd(s)) : view === 'week' ? weekView(data, s) : monthView(data, s)}
          ${listBlock(data, data.bookings)}`}
      ${dueBlock(due)}
    </div>`);
}

function bind(container) {
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
  on(container, 'click', '[data-cal-filter]', (_e, b) => {
    const v = b.dataset.calFilter;
    liftFilter = v === 'all' || v === 'none' ? v : Number(v);
    draw(container);   // nur neu zeichnen, kein Nachladen
  });
  on(container, 'click', '[data-cal-find]', () => openLiftFinder({
    lifts: container._cal.data.lifts,
    // aus dem Kalender: neue Hallen-Aufgabe mit dem gewählten Zeitraum vorbelegt
    onPick: (r) => openTaskPlan({ category: 'allgemein', lift_slot: r.lift_id, lift_from: `${r.von}T00:00`, lift_to: `${new Date(Date.parse(`${r.bis}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)}T00:00` }, again)
  }));
  on(container, 'click', '[data-cal-day]', (_e, b) => { anchor = new Date(`${b.dataset.calDay}T12:00`); view = 'day'; again(); });
  on(container, 'click', '[data-cal-task], [data-cal-edit]', (_e, b) => {
    const t = container._calTasks.find((x) => x.id === Number(b.dataset.calTask || b.dataset.calEdit));
    if (!t) return;
    if (canEdit()) openTaskPlan(t, again);
    else if (t.vehicle_id) app.navigate({ kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' });
  });
}

