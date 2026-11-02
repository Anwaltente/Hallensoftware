/**
 * v5.4: Hallen-Wartung & Infrastruktur (Reiter "Halle")
 * Hallen-To-Dos (Aufgaben ohne Auto und ohne Event) nach Kategorie, mit Fälligkeit, Zuweisung,
 * Unteraufgaben und Wiederholung (z. B. "Kompressor entwässern: alle 4 Wochen").
 */
import { app, canEdit, refreshWhiteboard } from './state.js';
import { get, post, del } from './api.js';
import { html, setHTML, on, icon, toast, toastError, haptic, confirmDialog } from './ui.js';
import { taskMetaChips, pausedBox, openTaskPlan, openLiftPlan, subtaskBlock, toggleSubtask, mineFilter, setOnlyMine, onlyMineToggle, HALL_CATEGORIES } from './workload.js';

let catFilter = '';

export async function renderHallPanel(container) {
  let tasks = [];
  try { tasks = (await get('/tasks?vehicleId=hall&status=open')).filter((t) => !t.event_id); } catch (err) { toastError(err); }
  const shown = mineFilter(tasks).filter((t) => !catFilter || (t.category || 'allgemein') === catFilter);
  const byDue = (a, b) => String(a.target_date || '9999').localeCompare(String(b.target_date || '9999')) || a.priority - b.priority;
  const groups = Object.entries(HALL_CATEGORIES).map(([k, label]) => [k, label, shown.filter((t) => (t.category || 'allgemein') === k).sort(byDue)]).filter(([, , list]) => list.length);
  const today = new Date().toLocaleDateString('sv-SE');
  const overdue = tasks.filter((t) => t.target_date && t.target_date < today).length;

  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <div><h3 class="font-display font-bold tracking-wider text-white">Hallen-Wartung &amp; Infrastruktur</h3>
          <p class="text-xs text-slate-500">${tasks.length} offen${overdue ? html` · <span class="text-rose-300">${overdue} überfällig</span>` : ''}</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-hall-new>${icon('plus')} Aufgabe</button>` : ''}
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <button class="chip chip-btn ${!catFilter ? 'on' : ''}" data-hall-cat="">Alle</button>
        ${Object.entries(HALL_CATEGORIES).map(([k, l]) => html`<button class="chip chip-btn ${catFilter === k ? 'on' : ''}" data-hall-cat="${k}">${l}</button>`)}
        <span class="ml-auto">${onlyMineToggle()}</span>
      </div>
      ${groups.length ? groups.map(([k, label, list]) => html`
        <section>
          <h4 class="font-display text-xs font-bold tracking-[0.2em] text-slate-300 mb-2">${label.toUpperCase()} · ${list.length}</h4>
          <div class="space-y-2">${list.map((t) => html`
            <div class="card px-3 py-2.5 ${t.target_date && t.target_date < today ? 'urg-critical' : t.priority === 1 ? 'urg-soon' : 'urg-planned'}">
              <div class="flex items-start gap-2.5">
                ${canEdit() ? html`<button class="mt-0.5 w-5 h-5 rounded border-2 border-slate-500 hover:border-lime-400 hover:bg-lime-400/20 shrink-0" data-hall-done="${t.id}" title="Erledigt${t.repeat_days ? ' (kommt automatisch wieder)' : ''}"></button>` : ''}
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-white">${t.title}</div>
                  ${t.description ? html`<div class="text-xs text-slate-400">${t.description}</div>` : ''}
                  <div class="flex flex-wrap gap-1 mt-1">${taskMetaChips(t)}</div>
                  ${subtaskBlock(t)}
                  ${pausedBox(t)}
                </div>
                ${canEdit() ? html`<div class="flex flex-col gap-1 shrink-0">
                  <button class="btn-icon !w-8 !h-8" data-hall-edit="${t.id}" title="Bearbeiten">${icon('edit')}</button>
                  <button class="btn-icon !w-8 !h-8 ${t.lift_from ? '!text-cyan-300' : ''}" data-hall-lift="${t.id}" title="Hebebühne reservieren">${icon('layers')}</button>
                  <button class="btn-icon !w-8 !h-8 hover:!text-rose-300" data-hall-del="${t.id}" title="Löschen">${icon('trash')}</button></div>` : ''}
              </div>
            </div>`)}</div>
        </section>`) : html`<div class="card p-6 text-center text-slate-400 text-sm">${icon('check', 'w-6 h-6 mx-auto mb-2 text-lime-400')}Nichts offen. Die Halle ist in Schuss.</div>`}
    </div>`);

  if (container.dataset.boundHall) { container._hallTasks = tasks; return; }
  container.dataset.boundHall = '1';
  container._hallTasks = tasks;
  const again = () => { refreshWhiteboard().catch(() => {}); app.rerenderTab('hall'); };
  const find = (id) => container._hallTasks.find((t) => t.id === Number(id));
  on(container, 'click', '[data-hall-cat]', (_e, b) => { catFilter = b.dataset.hallCat; app.rerenderTab('hall'); });
  on(container, 'change', '[data-onlymine]', (_e, c) => { setOnlyMine(c.checked); app.rerenderTab('hall'); });
  on(container, 'click', '[data-hall-new]', () => openTaskPlan({ category: catFilter || 'allgemein' }, again));
  on(container, 'click', '[data-hall-edit]', (_e, b) => { const t = find(b.dataset.hallEdit); if (t) openTaskPlan(t, again); });
  on(container, 'click', '[data-hall-lift]', (_e, b) => { const t = find(b.dataset.hallLift); if (t) openLiftPlan(t, again); });
  on(container, 'click', '[data-sub]', (_e, b) => toggleSubtask(b.dataset.sub, again));
  on(container, 'click', '[data-hall-done]', async (_e, b) => {
    const t = find(b.dataset.hallDone);
    try {
      haptic([10, 30, 10]);
      await post(`/tasks/${b.dataset.hallDone}/done`, {});
      toast(t && t.repeat_days ? 'Erledigt. Die nächste Runde ist schon eingeplant.' : 'Erledigt!', 'ok');
      again();
    } catch (err) { toastError(err); }
  });
  on(container, 'click', '[data-hall-del]', async (_e, b) => {
    if (!(await confirmDialog('Hallen-Aufgabe löschen?', { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/tasks/${b.dataset.hallDel}`); again(); } catch (err) { toastError(err); }
  });
}
