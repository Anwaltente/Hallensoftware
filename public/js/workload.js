/**
 * v5.3: Team-Koordination
 *   - Workload-Board: Spalten je Person + "Nicht zugewiesen (Offener Pool)" mit summierter Restzeit,
 *     Aufgaben per Drag & Drop (Griff) oder Klick verschieben bzw. aus dem Pool übernehmen
 *   - Planung je Aufgabe: Zuständig, geschätzte Stunden, Zieldatum
 *   - "Arbeit pausieren / Nicht fertig": was ist noch zu tun + geschätzte Fertigstellung
 */
import { store, app, canEdit, refreshWhiteboard, refreshVehicles } from './state.js';
import { get, post, put, patch } from './api.js';
import { openLiftFinder } from './liftfinder.js';
import { html, setHTML, el, on, icon, toast, toastError, haptic, fmtDate, openModal, chooseDialog, initials, formData, since } from './ui.js';
import { track } from './track.js';

const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const todayIso = () => iso(new Date());
const plusDays = (n) => iso(new Date(Date.now() + n * 86400000));
export const fmtHours = (h) => (h || h === 0 ? `${Number(h).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.` : '');
const dayDiff = (d) => Math.round((Date.parse(`${d}T12:00:00`) - Date.parse(`${todayIso()}T12:00:00`)) / 86400000);

function dueLabel(d) {
  if (!d) return '';
  const n = dayDiff(d);
  if (n < 0) return `überfällig seit ${-n} ${n === -1 ? 'Tag' : 'Tagen'}`;
  if (n === 0) return 'heute fällig';
  if (n === 1) return 'bis morgen';
  return `bis ${fmtDate(d, { short: true })}`;
}

const addIso = (d, n) => iso(new Date(Date.parse(`${d}T12:00:00`) + n * 86400000));
/** Bühnen-Reservierung ist tageweise: Von = Tag von lift_from, Bis = letzter belegter Tag (lift_to ist der Folgetag 00:00) */
export const liftDays = (t) => {
  const von = t.lift_from.slice(0, 10);
  const end = t.lift_to.slice(0, 10);
  const bis = t.lift_to.slice(11) === '00:00' ? addIso(end, -1) : end;   // shortcut: alte Reservierungen mit Uhrzeit zählen als ganze Tage
  return [von, bis < von ? von : bis];
};
export const liftRangeLabel = (t) => { const [a, b] = liftDays(t); return a === b ? fmtDate(a, { short: true }) : `${fmtDate(a, { short: true })} bis ${fmtDate(b, { short: true })}`; };

/**
 * v5.5: Fälligkeit mit minimalem Klickaufwand: Klick aufs Datum = Datumsauswahl, +1 Tag, +1 Woche.
 * Speichert sofort per PATCH und tauscht nur dieses Element aus (kein Neuladen).
 */
export function dueControl(t) {
  const n = t.target_date ? dayDiff(t.target_date) : null;
  const cls = n === null ? 'task-date' : n < 0 ? 'task-late' : n <= 2 ? 'task-soon' : 'task-date';
  if (!canEdit() || t.status === 'done') {
    return t.target_date ? html`<span class="chip !text-[10px] ${cls}" title="Fällig am ${fmtDate(t.target_date)}">${icon('calendar', 'w-3 h-3')} ${dueLabel(t.target_date)}</span>` : '';
  }
  return html`<span class="due-ctl relative inline-flex items-center gap-1" data-duectl="${t.id}" data-due-date="${t.target_date || ''}">
    <button type="button" class="chip chip-btn !text-[10px] ${cls}" data-due-pick title="${t.target_date ? `Fällig am ${fmtDate(t.target_date)}. Klicken zum Ändern` : 'Fälligkeitsdatum wählen'}">${icon('calendar', 'w-3 h-3')} ${t.target_date ? dueLabel(t.target_date) : 'Datum wählen'}</button>
    <button type="button" class="chip chip-btn !text-[10px]" data-due-shift="1" title="Einen Tag später (mindestens morgen)">+1 Tag</button>
    <button type="button" class="chip chip-btn !text-[10px]" data-due-shift="7" title="Eine Woche später">+1 Woche</button>
    <input type="date" data-due-input value="${t.target_date || ''}" tabindex="-1" aria-hidden="true" style="position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none">
  </span>`;
}

async function saveDue(ctl, date) {
  try {
    const row = await patch(`/tasks/${ctl.dataset.duectl}/due-date`, { date });
    haptic(8);
    ctl.replaceWith(el(dueControl(row)));
    toast(date ? `Fällig: ${fmtDate(date)}` : 'Fälligkeit entfernt.', 'ok', 2200);
    refreshWhiteboard().catch(() => {});
  } catch (err) { toastError(err); }
}
// Ein Handler für alle Stellen (Cockpit, Hallen-Board, Event-To-Dos, Whiteboard, Kalender)
document.addEventListener('click', (e) => {
  const ctl = e.target.closest && e.target.closest('[data-duectl]');
  if (!ctl) return;
  if (e.target.closest('[data-due-pick]')) {
    const inp = ctl.querySelector('[data-due-input]');
    try { inp.showPicker(); } catch { inp.focus(); inp.click(); }
  }
  const sh = e.target.closest('[data-due-shift]');
  if (sh) { const cur = ctl.dataset.dueDate; saveDue(ctl, addIso(cur && cur > todayIso() ? cur : todayIso(), Number(sh.dataset.dueShift))); }
});
document.addEventListener('change', (e) => {
  const inp = e.target.closest && e.target.closest('[data-due-input]');
  if (inp && inp.value) saveDue(inp.closest('[data-duectl]'), inp.value);
});

/** Kleine Chips für Zuständig / Zeit / Zieldatum / Pause (Whiteboard, Cockpit, Board) */
export function taskMetaChips(t, { showAssignee = true } = {}) {
  return html`
    ${showAssignee ? (t.assigned_user && t.assigned_name
      ? html`<span class="chip !text-[10px] task-who" title="Zuständig: ${t.assigned_name}"><span class="w-3.5 h-3.5 rounded-full grid place-items-center text-[7px] font-bold text-black" style="background:${t.assigned_color || '#94a3b8'}">${initials(t.assigned_name)}</span>${t.assigned_name}</span>`
      : html`<span class="chip !text-[10px] task-pool" title="Noch niemandem zugewiesen">${icon('users', 'w-3 h-3')} offen für alle</span>`) : ''}
    ${t.estimated_hours ? html`<span class="chip !text-[10px] task-hours">${icon('clock', 'w-3 h-3')} ca. ${fmtHours(t.estimated_hours)}</span>` : ''}
    ${dueControl(t)}
    ${t.lift_slot !== null && t.lift_slot !== undefined && t.lift_from ? html`<span class="chip !text-[10px] !text-cyan-200 !border-cyan-400/40" title="Hebebühne reserviert">${icon('layers', 'w-3 h-3')} ${liftName(t.lift_slot)} · ${liftRangeLabel(t)}</span>` : ''}
    ${t.repeat_days ? html`<span class="chip !text-[10px]" title="Wiederkehrend">${icon('refresh', 'w-3 h-3')} ${REPEATS[t.repeat_days] || `alle ${t.repeat_days} Tage`}</span>` : ''}
    ${t.vehicle_id && t.event_critical === 0 ? html`<span class="chip !text-[10px] !text-slate-400" title="Blockiert die Event-Abfahrt nicht">nicht event-kritisch</span>` : ''}`;
}

/** Hinweis-Box "Nicht fertig geworden" */
export function pausedBox(t) {
  if (!t.progress_note || (!t.paused_at && t.status === 'done')) return '';
  return html`<div class="task-paused ${t.paused_at ? '' : 'is-resumed'}">
    <div class="flex items-center gap-1.5 font-display text-[10px] font-bold tracking-wider">${icon('pause', 'w-3 h-3')} ${t.paused_at ? 'IN ARBEIT · NICHT FERTIG GEWORDEN' : 'REST-TO-DO (WIRD WEITERGEMACHT)'}</div>
    <div class="text-[13px] text-white mt-0.5">${t.progress_note}</div>
    ${t.paused_at ? html`<div class="text-[10px] opacity-75 mt-0.5">${t.paused_by_name ? `${t.paused_by_name} · ` : ''}${since(t.paused_at)}</div>` : ''}
  </div>`;
}

/* ====================================================================== */
/* Pausieren                                                              */
/* ====================================================================== */
export function openPauseDialog(task, onDone) {
  const body = el(html`<div>
    <form class="space-y-3" data-form>
      <div class="text-sm text-slate-300"><b class="text-white">${task.title}</b>${task.vehicle_name ? html` · <span class="text-cyan-300">${task.vehicle_name}</span>` : ''}</div>
      <label class="block"><span class="label">Was ist noch zu tun?</span>
        <textarea class="input" name="note" rows="3" required placeholder="z. B. Querlenker montiert, Schrauben müssen noch auf Drehmoment 110 Nm angezogen werden">${task.progress_note || ''}</textarea></label>
      <div class="grid grid-cols-2 gap-3">
        <label><span class="label">Geschätzt fertig am</span><input class="input" type="date" name="target_date" value="${task.target_date || plusDays(2)}" min="${todayIso()}"></label>
        <label><span class="label">Restaufwand (Std.)</span><input class="input" type="number" step="0.25" min="0" inputmode="decimal" name="estimated_hours" value="${task.estimated_hours ?? ''}" placeholder="z. B. 1,5"></label>
      </div>
      <div class="flex flex-wrap gap-1.5">${[[1, 'morgen'], [2, 'übermorgen'], [7, 'nächste Woche'], [14, '2 Wochen']].map(([n, l]) => html`<button type="button" class="chip chip-btn" data-due="${plusDays(n)}">${l}</button>`)}</div>
      <p class="text-[11px] text-slate-500">${icon('alert', 'w-3 h-3 inline text-amber-300')} Das Auto bleibt „In Arbeit“ und bekommt auf der Hallenkarte ein Warn-Badge, bis die Aufgabe erledigt ist.</p>
    </form></div>`);
  const m = openModal({
    title: 'Arbeit pausieren', subtitle: 'Nicht fertig geworden? Kurz festhalten, wie es weitergeht', size: 'sm', iconName: 'pause', body,
    footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('pause', 'w-3.5 h-3.5')} Pausieren</button>`
  });
  const f = body.querySelector('[data-form]');
  on(body, 'click', '[data-due]', (_e, b) => { f.target_date.value = b.dataset.due; });
  setTimeout(() => f.note.focus(), 60);
  const save = async () => {
    if (!f.reportValidity()) return;
    const d = formData(f);
    try {
      await post(`/tasks/${task.id}/pause`, { note: d.note, target_date: d.target_date || null, estimated_hours: d.estimated_hours === '' ? null : String(d.estimated_hours).replace(',', '.') });
      m.close();
      haptic([12, 40, 12]);
      toast('Pausiert. Das Rest-To-do steht am Auto und auf dem Board.', 'ok', 3800);
      await Promise.all([refreshWhiteboard(), refreshVehicles()]).catch(() => {});
      if (onDone) onDone();
    } catch (err) { toastError(err); }
  };
  m.footer.querySelector('[data-save]').addEventListener('click', save);
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

/* ====================================================================== */
/* Aufgabe anlegen / planen (v5.4: alle Felder)                           */
/* ====================================================================== */
export const HALL_CATEGORIES = { kompressor: 'Kompressor & Druckluft', elektrik: 'Elektrik & Beleuchtung', buehne: 'Hebebühnen-Prüfung/Wartung', ordnung: 'Ordnung & Entsorgung', allgemein: 'Allgemeines' };
export const REPEATS = { 7: 'jede Woche', 14: 'alle 2 Wochen', 28: 'alle 4 Wochen', 30: 'jeden Monat', 91: 'jedes Quartal', 182: 'halbjährlich', 365: 'jährlich' };
export const liftList = () => store.objects.filter((o) => o.type === 'slot' && o.props && o.props.kind === 'lift');
export const liftName = (id) => (Number(id) === 0 ? 'Beliebige Bühne' : (liftList().find((l) => l.id === Number(id)) || {}).label || 'Bühne');
export const subtasksOf = (t) => { try { return JSON.parse(t.subtasks || '[]') || []; } catch { return []; } };

/**
 * Editor für jede Aufgabe (Auto, Halle, Event). task.id fehlt = neu anlegen.
 */
export function openTaskPlan(task, onDone) {
  const people = (store.users || []).filter((u) => u.role !== 'gast');
  const isNew = !task.id;
  const kind = () => (task.event_id ? 'event' : task.vehicle_id ? 'vehicle' : 'hall');
  const subs = subtasksOf(task);
  const lifts = liftList();
  const [liftVon, liftBis] = task.lift_from && task.lift_to ? liftDays(task) : [todayIso(), todayIso()];
  const body = el(html`<div>
    <form class="space-y-3" data-form>
      <label class="block"><span class="label">Aufgabe</span><input class="input" name="title" required value="${task.title || ''}" placeholder="z. B. Winterräder montieren"></label>
      ${task.vehicle_name ? html`<div class="text-xs text-cyan-300 -mt-1">${task.vehicle_name}</div>` : ''}
      <label class="block"><span class="label">Details</span><input class="input text-sm" name="description" value="${task.description || ''}" placeholder="optional"></label>
      <div><span class="label">Zuständig</span>
        <div class="flex flex-wrap gap-1.5" data-who>
          <button type="button" class="chip chip-btn ${!task.assigned_user ? 'on' : ''}" data-uid="">${icon('users', 'w-3 h-3')} Offener Pool</button>
          ${people.map((u) => html`<button type="button" class="chip chip-btn ${task.assigned_user === u.id ? 'on' : ''}" data-uid="${u.id}"><span class="w-3.5 h-3.5 rounded-full" style="background:${u.color}"></span>${u.name}</button>`)}
        </div></div>
      <div class="grid grid-cols-3 gap-3">
        <label><span class="label">Priorität</span><select class="select" name="priority">${[[1, 'Hoch'], [2, 'Normal'], [3, 'Niedrig']].map(([v, l]) => html`<option value="${v}" ${(task.priority || 2) === v ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label><span class="label">Aufwand (Std.)</span><input class="input" type="number" step="0.25" min="0" inputmode="decimal" name="estimated_hours" value="${task.estimated_hours ?? ''}" placeholder="2,5"></label>
        <label><span class="label">${kind() === 'hall' ? 'Fällig am' : 'Zieldatum'}</span><input class="input" type="date" name="target_date" value="${task.target_date || ''}"></label>
      </div>
      <div class="flex flex-wrap gap-1.5">${[[0.5, '30 min'], [1, '1 Std.'], [2, '2 Std.'], [4, 'halber Tag'], [8, 'ganzer Tag']].map(([h, l]) => html`<button type="button" class="chip chip-btn" data-h="${h}">${l}</button>`)}</div>
      ${kind() === 'vehicle' ? html`<label class="flex items-start gap-2 text-sm text-slate-300" data-critwrap>
        <input type="checkbox" class="check !w-4 !h-4 mt-0.5" name="event_critical" ${task.event_critical === 0 ? '' : 'checked'}>
        <span>Event-kritisch / vor Abfahrt zwingend erforderlich<br><small class="text-slate-500">Ohne Haken blockiert die Aufgabe die Event-Freigabe nicht (z. B. Kratzer lackieren).</small></span></label>` : ''}
      ${kind() === 'hall' ? html`<div class="grid grid-cols-2 gap-3">
        <label><span class="label">Kategorie</span><select class="select" name="category">${Object.entries(HALL_CATEGORIES).map(([k, l]) => html`<option value="${k}" ${(task.category || 'allgemein') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
        <label><span class="label">Wiederholen</span><select class="select" name="repeat_days"><option value="">einmalig</option>${Object.entries(REPEATS).map(([d, l]) => html`<option value="${d}" ${Number(task.repeat_days) === Number(d) ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>` : ''}
      ${lifts.length ? html`<div class="card p-3 space-y-2">
        <label class="flex items-center gap-2 text-sm text-white"><input type="checkbox" class="check !w-4 !h-4" name="lift_on" ${task.lift_slot !== null && task.lift_slot !== undefined ? 'checked' : ''}> ${icon('layers', 'w-3.5 h-3.5 text-cyan-300')} Benötigt Hebebühne</label>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2" data-liftfields>
          <label class="col-span-2 sm:col-span-1"><span class="label">Bühne</span><select class="select" name="lift_slot">${lifts.map((l) => html`<option value="${l.id}" ${task.lift_slot === l.id ? 'selected' : ''}>${l.label || l.code}</option>`)}<option value="0" ${task.lift_slot === 0 ? 'selected' : ''}>Beliebige Bühne</option></select></label>
          <label><span class="label">Von</span><input class="input" type="date" name="lift_von" value="${liftVon}"></label>
          <label><span class="label">Bis</span><input class="input" type="date" name="lift_bis" value="${liftBis}" min="${liftVon}"></label>
          <button type="button" class="btn btn-sm col-span-2 sm:col-span-3" data-lift-find>${icon('search', 'w-3.5 h-3.5')} Freie Bühne finden</button>
        </div></div>` : ''}
      <label class="block"><span class="label">Unteraufgaben (eine pro Zeile)</span>
        <textarea class="input text-sm" name="subtasks" rows="${Math.min(8, Math.max(3, subs.length + 1))}" placeholder="Räder aus Regal holen&#10;Neu wuchten&#10;Montieren &amp; Drehmoment 120 Nm prüfen">${subs.map((s) => s.t).join('\n')}</textarea></label>
      <label class="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" class="check !w-4 !h-4" name="auto_done" ${task.auto_done ? 'checked' : ''}> Hauptaufgabe automatisch erledigen, wenn alle Unteraufgaben abgehakt sind</label>
    </form></div>`);
  let uid = task.assigned_user || '';
  const m = openModal({
    title: isNew ? 'Neue Aufgabe' : 'Aufgabe planen', subtitle: 'Wer, wie lange, bis wann, Bühne (in Tagen), Unteraufgaben', size: 'md', iconName: 'list', body,
    footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} ${isNew ? 'Anlegen' : 'Speichern'}</button>`
  });
  const f = body.querySelector('[data-form]');
  const liftToggle = () => { const box = body.querySelector('[data-liftfields]'); if (box) box.classList.toggle('hidden', !f.lift_on.checked); };
  liftToggle();
  if (f.lift_on) f.lift_on.addEventListener('change', liftToggle);
  const findBtn = body.querySelector('[data-lift-find]');
  if (findBtn) findBtn.addEventListener('click', () => openLiftFinder({
    lifts, vehicleId: task.vehicle_id || null, excludeId: task.id || null,
    onPick: (r) => { f.lift_slot.value = String(r.lift_id); f.lift_von.value = r.von; f.lift_bis.value = r.bis; f.lift_bis.min = r.von; toast(`Bühne: ${r.lift_label}, ${fmtDate(r.von, { short: true })} bis ${fmtDate(r.bis, { short: true })} übernommen. Mit Speichern reservieren.`, 'ok', 4500); }
  }));
  if (f.lift_von) {
    // gleicher Tag = 1 Tag geblockt: Bis zieht mit, solange es nicht schon bewusst länger gewählt wurde
    let vonAlt = f.lift_von.value;
    f.lift_von.addEventListener('change', () => {
      if (!f.lift_von.value) return;
      if (!f.lift_bis.value || f.lift_bis.value <= vonAlt || f.lift_bis.value < f.lift_von.value) f.lift_bis.value = f.lift_von.value;
      f.lift_bis.min = f.lift_von.value;
      vonAlt = f.lift_von.value;
    });
  }
  on(body, 'click', '[data-uid]', (_e, b) => { uid = b.dataset.uid; body.querySelectorAll('[data-uid]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(body, 'click', '[data-h]', (_e, b) => { f.estimated_hours.value = b.dataset.h; });
  if (isNew) setTimeout(() => f.title.focus(), 60);
  const save = async () => {
    if (!f.reportValidity()) return;
    const d = formData(f);
    const num = (v) => (v === '' || v === undefined ? null : String(v).replace(',', '.'));
    // Erledigt-Status bleibt erhalten, solange der Text gleich ist
    const lines = String(d.subtasks || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const payload = {
      title: d.title, description: d.description || null, priority: Number(d.priority) || 2,
      assigned_user: uid ? Number(uid) : null, estimated_hours: num(d.estimated_hours), target_date: d.target_date || null,
      subtasks: lines.map((t) => ({ t, done: !!(subs.find((s) => s.t === t) || {}).done })), auto_done: !!f.auto_done.checked
    };
    if (f.event_critical) payload.event_critical = f.event_critical.checked;
    if (f.category) { payload.category = d.category; payload.repeat_days = d.repeat_days || null; }
    if (f.lift_on && f.lift_on.checked) {
      if (!d.lift_von || !d.lift_bis) { toast('Bitte Von- und Bis-Datum für die Bühne angeben.', 'warn'); return; }
      if (d.lift_bis < d.lift_von) { toast('Das Bis-Datum liegt vor dem Von-Datum.', 'warn'); return; }
      // ganze Tage: von 00:00 des ersten bis 00:00 des Tages nach dem letzten Tag (Ende exklusiv)
      Object.assign(payload, { lift_slot: Number(d.lift_slot), lift_from: `${d.lift_von}T00:00`, lift_to: `${addIso(d.lift_bis, 1)}T00:00` });
    } else payload.lift_slot = null;
    try {
      const res = isNew ? await post('/tasks', { ...payload, vehicle_id: task.vehicle_id || null, event_id: task.event_id || null })
        : await put(`/tasks/${task.id}`, payload);
      m.close();
      if (res.lift_conflict) toast(`Bühnen-Konflikt! ${liftName(res.lift_slot)} ist an diesen Tagen schon belegt. Siehe Kalender.`, 'warn', 6000);
      else toast(isNew ? 'Aufgabe angelegt.' : 'Gespeichert.', 'ok');
      refreshWhiteboard().catch(() => {});
      if (onDone) onDone(res);
    } catch (err) { toastError(err); }
  };
  m.footer.querySelector('[data-save]').addEventListener('click', save);
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

/* ====================================================================== */
/* v5.4: Unteraufgaben + "Nur meine Aufgaben"                             */
/* ====================================================================== */
/** Fortschritt + Checkliste unter einer Aufgabe; Klick auf [data-sub="taskId:index"] → toggleSubtask */
export function subtaskBlock(t) {
  const subs = subtasksOf(t);
  if (!subs.length) return '';
  const done = subs.filter((s) => s.done).length;
  return html`<div class="mt-1.5">
    <div class="flex items-center gap-2 text-[11px] text-slate-400"><div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-lime-400" style="width:${Math.round((done / subs.length) * 100)}%"></div></div>${done}/${subs.length} erledigt${t.auto_done ? html` <span title="Erledigt sich automatisch">⚡</span>` : ''}</div>
    <div class="mt-1 space-y-0.5">${subs.map((s, i) => html`<button type="button" class="flex items-center gap-2 text-left text-[13px] w-full hover:text-white ${s.done ? 'text-slate-500 line-through' : 'text-slate-300'}" data-sub="${t.id}:${i}" ${canEdit() ? '' : 'disabled'}>
      <span class="w-3.5 h-3.5 rounded border ${s.done ? 'bg-lime-400 border-lime-400' : 'border-slate-500'} shrink-0"></span>${s.t}</button>`)}</div></div>`;
}

export async function toggleSubtask(ref, onDone) {
  const [id, i] = String(ref).split(':');
  try {
    const r = await post(`/tasks/${id}/subtasks/${i}`);
    haptic(8);
    if (r.auto_completed) toast(`Alle Unteraufgaben erledigt: „${r.title}“ ist automatisch abgeschlossen.`, 'ok', 4000);
    else if (r.all_done && r.status === 'open') toast('Alle Unteraufgaben erledigt. Hauptaufgabe jetzt abhaken?', 'ok', 4000);
    refreshWhiteboard().catch(() => {});
    if (onDone) await onDone(r);
  } catch (err) { toastError(err); }
}

export const onlyMine = () => { try { return localStorage.getItem('halle.onlyMine') === '1'; } catch { return false; } };
export function setOnlyMine(on) { try { localStorage.setItem('halle.onlyMine', on ? '1' : '0'); } catch { /* privates Fenster */ } }
export const mineFilter = (list) => (onlyMine() && store.me ? list.filter((t) => t.assigned_user === store.me.id) : list);
export const onlyMineToggle = () => html`<label class="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none"><input type="checkbox" class="check !w-3.5 !h-3.5" data-onlymine ${onlyMine() ? 'checked' : ''}> Nur meine</label>`;

/* ====================================================================== */
/* Workload-Board                                                         */
/* ====================================================================== */
let boardOpen = null;

export async function openWorkload() {
  if (boardOpen) return;
  track('Öffnete Team-Auslastung (Workload)', 'open');
  const body = el(html`<div class="-mx-5 -my-4"><div data-wl class="wl-root"><p class="p-6 text-sm text-slate-500">Lädt …</p></div></div>`);
  const m = openModal({ title: 'Team-Auslastung', subtitle: 'Offene Aufgaben je Person mit geschätzter Restzeit', size: 'full', iconName: 'users', body, onClose: () => { boardOpen = null; } });
  boardOpen = m;
  const root = body.querySelector('[data-wl]');
  let data = null;

  async function load() {
    try { data = await get('/workload'); render(); } catch (err) { toastError(err); }
  }

  const card = (t) => {
    const late = t.target_date && dayDiff(t.target_date) < 0;
    return html`
    <div class="wl-card ${t.paused_at ? 'is-paused' : ''} ${late ? 'is-late' : ''} prio-${t.priority}" data-task="${t.id}">
      <div class="flex items-start gap-2">
        ${canEdit() ? html`<span class="wl-grip" data-grip title="Ziehen, um die Aufgabe jemand anderem zu geben">${icon('grip', 'w-4 h-4')}</span>` : ''}
        <div class="flex-1 min-w-0">
          <button class="text-left text-sm font-semibold text-white leading-snug hover:text-cyan-300" data-open>${t.title}</button>
          <div class="flex flex-wrap gap-1 mt-1">
            ${t.vehicle_name ? html`<span class="chip !text-[10px]"><span class="dot" style="background:${t.vehicle_color || '#94a3b8'}"></span>${t.vehicle_name}</span>` : html`<span class="chip !text-[10px]">Halle</span>`}
            ${t.priority === 1 ? html`<span class="chip !text-[10px] !text-rose-300 !border-rose-400/40">Prio hoch</span>` : ''}
            ${taskMetaChips(t, { showAssignee: false })}
            ${!t.target_date && t.event_name ? html`<span class="chip !text-[10px] !text-cyan-200 !border-cyan-400/40">${icon('flag', 'w-3 h-3')} ${t.event_name} · ${fmtDate(t.event_date, { short: true })}</span>` : ''}
            ${t.working && t.working.length ? html`<span class="chip !text-[10px] !text-lime-200 !border-lime-400/40"><span class="live-dot !w-1.5 !h-1.5"></span>${t.working.join(', ')} schraubt</span>` : ''}
          </div>
          ${t.paused_at ? html`<div class="wl-note">${icon('pause', 'w-3 h-3 inline')} ${t.progress_note}</div>` : ''}
        </div>
      </div>
      ${canEdit() ? html`<div class="wl-actions">
        ${t.assigned_user !== store.me.id ? html`<button class="btn btn-sm ${t.assigned_user ? '' : 'btn-lime'}" data-take>${icon('check', 'w-3.5 h-3.5')} ${t.assigned_user ? 'Übernehmen' : 'Ich mach das'}</button>` : ''}
        <button class="btn btn-sm" data-to>${icon('users', 'w-3.5 h-3.5')} Zuweisen</button>
        <button class="btn btn-sm" data-plan title="Zeit und Zieldatum">${icon('clock', 'w-3.5 h-3.5')}</button>
      </div>` : ''}
    </div>`;
  };

  const column = (key, title, color, col, sub) => html`
    <section class="wl-col ${key === 'pool' ? 'is-pool' : ''} ${store.me && Number(key) === store.me.id ? 'is-me' : ''}" data-col="${key}">
      <header class="wl-head">
        ${key === 'pool' ? html`<span class="wl-ava wl-ava-pool">${icon('users', 'w-4 h-4')}</span>` : html`<span class="wl-ava" style="background:${color}">${initials(title)}</span>`}
        <div class="flex-1 min-w-0">
          <div class="font-display font-bold text-white leading-tight">${title}${store.me && Number(key) === store.me.id ? html` <span class="text-[10px] text-cyan-300">(du)</span>` : ''}</div>
          <div class="text-[11px] text-slate-400">${sub}</div>
        </div>
        <div class="wl-hours" title="Summe der geschätzten Restzeit">${col.hours ? `${col.hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })}` : '0'}<small>Std.</small></div>
      </header>
      <div class="wl-bar"><span style="width:${Math.min(100, (col.hours / Math.max(8, maxHours)) * 100)}%;background:${key === 'pool' ? '#94a3b8' : color}"></span></div>
      <div class="wl-list" data-drop="${key}">
        ${col.tasks.map(card)}
        ${!col.tasks.length ? html`<div class="wl-empty">${key === 'pool' ? 'Pool ist leer. Alles verteilt!' : 'Nichts zugewiesen. Aufgabe hierher ziehen.'}</div>` : ''}
      </div>
    </section>`;

  let maxHours = 8;
  const summary = (col) => `${col.count} ${col.count === 1 ? 'Aufgabe' : 'Aufgaben'}${col.hours ? ` (ca. ${fmtHours(col.hours)})` : ''}${col.unestimated && col.count ? ` · ${col.unestimated} ohne Schätzung` : ''}`;

  function render() {
    if (!data) return;
    maxHours = Math.max(8, ...data.users.map((u) => u.hours), data.pool.hours);
    const total = data.users.reduce((s, u) => s + u.count, 0) + data.pool.count;
    const totalH = data.users.reduce((s, u) => s + u.hours, 0) + data.pool.hours;
    setHTML(root, html`
      <div class="wl-top">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span class="text-slate-300"><b class="text-white">${total}</b> offene Aufgaben</span>
          <span class="text-slate-300">ca. <b class="text-white">${fmtHours(Math.round(totalH * 100) / 100) || '0 Std.'}</b> Restarbeit</span>
          ${data.users.map((u) => html`<span class="wl-sum"><span class="dot" style="background:${u.color}"></span>${u.name}: ${summary(u)}</span>`)}
        </div>
        <p class="text-[11px] text-slate-500 mt-1">${canEdit() ? html`${icon('grip', 'w-3 h-3 inline')} Am Griff ziehen und bei einer Person ablegen, oder „Ich mach das“ tippen. Zurück in den Pool: auf „Nicht zugewiesen“ ziehen.` : 'Nur-Lese-Modus.'}</p>
      </div>
      <div class="wl-grid" style="--cols:${data.users.length + 1}">
        ${data.users.map((u) => column(String(u.id), u.name, u.color, u, summary(u)))}
        ${column('pool', 'Nicht zugewiesen (Offener Pool)', '#94a3b8', data.pool, summary(data.pool))}
      </div>`);
  }

  const findTask = (id) => [...data.users.flatMap((u) => u.tasks), ...data.pool.tasks].find((t) => t.id === Number(id));

  async function assign(taskId, to) {
    const t = findTask(taskId);
    const uid = to === 'pool' || to === '' || to === null ? null : Number(to);
    if (!t || (t.assigned_user || null) === uid) return;
    try {
      await post(`/tasks/${taskId}/assign`, { user_id: uid });
      haptic(12);
      const who = uid ? (data.users.find((u) => u.id === uid) || {}).name : null;
      toast(who ? `„${t.title}“ ist jetzt bei ${who}.` : `„${t.title}“ liegt wieder im offenen Pool.`, 'ok');
      await load();
      refreshWhiteboard().catch(() => {});
    } catch (err) { toastError(err); }
  }

  on(root, 'click', '[data-take]', (_e, b) => assign(b.closest('[data-task]').dataset.task, store.me.id));
  on(root, 'click', '[data-to]', async (_e, b) => {
    const t = findTask(b.closest('[data-task]').dataset.task);
    const POOL = 'Offener Pool (niemand)';
    const pick = await chooseDialog({ title: 'Zuweisen', text: `Wer übernimmt „${t.title}“?`, choices: [...data.users.map((u) => u.name), POOL], allowText: false });
    if (!pick) return;
    const u = data.users.find((x) => x.name === pick);
    assign(t.id, u ? u.id : 'pool');
  });
  on(root, 'click', '[data-plan]', (_e, b) => openTaskPlan(findTask(b.closest('[data-task]').dataset.task), load));
  on(root, 'click', '[data-open]', (_e, b) => {
    const t = findTask(b.closest('[data-task]').dataset.task);
    if (t && t.vehicle_id) { m.close(); app.navigate({ kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' }); }
  });

  /* --- Drag & Drop per Zeiger (Maus und Touch über den Griff) --- */
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip || !canEdit()) return;
    const cardEl = grip.closest('[data-task]');
    e.preventDefault();
    const r = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('wl-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    document.body.appendChild(ghost);
    cardEl.classList.add('is-dragging');
    drag = { id: cardEl.dataset.task, el: cardEl, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, over: null, pid: e.pointerId };
    try { grip.setPointerCapture(e.pointerId); } catch { /* egal */ }
    haptic(8);
  });
  const moveDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;
    drag.ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.visibility = '';
    const col = under && under.closest && under.closest('[data-col]');
    const key = col ? col.dataset.col : null;
    if (key !== drag.over) {
      root.querySelectorAll('.wl-col.drop-on').forEach((x) => x.classList.remove('drop-on'));
      if (col) col.classList.add('drop-on');
      drag.over = key;
    }
    // am Rand automatisch seitlich scrollen (Handy)
    const grid = root.querySelector('.wl-grid');
    if (grid) {
      const gr = grid.getBoundingClientRect();
      if (e.clientX > gr.right - 40) grid.scrollLeft += 14;
      else if (e.clientX < gr.left + 40) grid.scrollLeft -= 14;
    }
  };
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const { id, over, el: cardEl, ghost } = drag;
    drag = null;
    ghost.remove();
    cardEl.classList.remove('is-dragging');
    root.querySelectorAll('.wl-col.drop-on').forEach((x) => x.classList.remove('drop-on'));
    if (over) assign(id, over);
  };
  root.addEventListener('pointermove', moveDrag);
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  load();
}
