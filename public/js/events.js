/**
 * Event-Planer & automatische Trackside-Packliste
 * - Events anlegen (Name, Zeitraum, Ort, teilnehmende Autos per Multi-Select, auch externe)
 * - Packliste wird serverseitig dedupliziert erzeugt (/api/events/:id/packlist)
 * - Interaktive Checkliste "Eingepackt", Fortschritt, Filter, Druckansicht, eigene Positionen
 */
import { store, app, canEdit, modelInfo, statusInfo, refreshEvents, refreshWhiteboard, refreshVehicles } from './state.js';
import { get, post, put, del } from './api.js';
import { html, setHTML, el, on, icon, toast, toastError, haptic, fmtDate, daysUntil, countdownLabel, openModal, confirmDialog, formData } from './ui.js';
import { carThumb } from './sprites.js';
import { loadingBadge } from './trailers.js';

let showPast = false;

export async function renderEventsPanel(container) {
  let events = store.events;
  if (showPast) {
    try { events = await get('/events'); } catch (err) { toastError(err); }
  }
  const vehicleName = (id) => (store.vehicles.find((v) => v.id === id) || {}).name || '?';
  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <div><h3 class="font-display font-bold tracking-wider text-white">Event-Planer</h3><p class="text-xs text-slate-500">Trackdays, Drift-Events, Ausflüge</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-ev-new>${icon('plus')} Event</button>` : ''}
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" class="check !w-4 !h-4" data-ev-past ${showPast ? 'checked' : ''}> Vergangene Events zeigen</label>
      <div class="space-y-3">
        ${events.map((e) => {
          const d = daysUntil(e.date_start);
          const past = e.past || (e.date_end || e.date_start) < new Date().toISOString().slice(0, 10);
          return html`
          <article class="card overflow-hidden ${past ? 'opacity-60' : ''}">
            <div class="h-1 ${d <= 3 && !past ? 'hazard-anim' : 'bg-gradient-to-r from-cyan-400/70 to-transparent'}"></div>
            <div class="p-3.5">
              <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <h4 class="font-display font-bold text-white text-[15px] truncate">${e.name}</h4>
                  <p class="text-xs text-slate-400">${fmtDate(e.date_start)}${e.date_end && e.date_end !== e.date_start ? ` bis ${fmtDate(e.date_end)}` : ''}${e.location ? ` · ${e.location}` : ''}</p>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-display font-bold ${past ? 'text-slate-500' : d <= 3 ? 'text-rose-400' : d <= 10 ? 'text-amber-300' : 'text-cyan-300'}">${countdownLabel(d)}</div>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5 mt-2.5">
                ${e.vehicle_ids.map((id) => {
                  const v = store.vehicles.find((x) => x.id === id);
                  return v ? html`<span class="chip"><img src="${carThumb(modelInfo(v.model), v.color, { w: 34, h: 16 })}" class="w-[34px] h-4" alt="">${v.name}</span>` : html`<span class="chip">${vehicleName(id)}</span>`;
                })}
                ${!e.vehicle_ids.length ? html`<span class="text-xs text-slate-500">Noch keine Autos gewählt</span>` : ''}
              </div>
              <div class="flex gap-2 mt-3">
                <button class="btn btn-sm btn-amber flex-1" data-ev-pack="${e.id}">${icon('package')} Packliste${e.packed_count ? html` <span class="opacity-70">· ${e.packed_count} ✓</span>` : ''}</button>
                ${e.vehicle_ids.length ? html`<button class="btn btn-sm" data-ev-load="${e.id}" title="Gespanne & Beladung">${icon('car')} <span data-ev-badge="${e.id}"></span></button>` : ''}
                ${canEdit() ? html`<button class="btn btn-sm" data-ev-edit="${e.id}">${icon('edit')}</button>` : ''}
              </div>
            </div>
          </article>`;
        })}
        ${!events.length ? html`<div class="card p-6 text-center text-slate-400 text-sm">${icon('calendar', 'w-6 h-6 mx-auto mb-2')}Kein Event geplant. Zeit für den nächsten Trackday?</div>` : ''}
      </div>
    </div>`);

  if (!container.dataset.boundEvents) {
    container.dataset.boundEvents = '1';
    on(container, 'click', '[data-ev-new]', () => openEventEditor(null));
    on(container, 'click', '[data-ev-edit]', async (_e, b) => {
      try { openEventEditor(await get(`/events/${b.dataset.evEdit}`)); } catch (err) { toastError(err); }
    });
    on(container, 'click', '[data-ev-pack]', (_e, b) => openPacklist(Number(b.dataset.evPack)));
    on(container, 'change', '[data-ev-past]', (_e, c) => { showPast = c.checked; app.rerenderTab('events'); });
    on(container, 'click', '[data-ev-load]', (_e, b) => app.openLoadingPlan(Number(b.dataset.evLoad)));
  }
  // v3: Gespann-Ampel je Event nachladen
  for (const e of events.filter((x) => x.vehicle_ids.length)) {
    get(`/events/${e.id}/loading`).then((plan) => {
      const slot = container.querySelector(`[data-ev-badge="${e.id}"]`);
      if (slot && plan.trailers.length) setHTML(slot, loadingBadge(plan.summary));
      else if (slot) slot.textContent = 'Gespanne';
    }).catch(() => {});
  }
}

/* ====================================================================== */
export function openEventEditor(ev) {
  const isNew = !ev;
  const e = ev || { name: '', date_start: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), date_end: '', location: '', notes: '', vehicle_ids: [] };
  const selected = new Set(e.vehicle_ids);
  const body = el(html`<div>
    <form class="space-y-4" data-form>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="sm:col-span-2"><span class="label">Name des Events</span><input class="input" name="name" value="${e.name}" placeholder="z. B. Drift-Weekend, Altstadt-Event" required></label>
        <label><span class="label">Start</span><input class="input" type="date" name="date_start" value="${e.date_start}" required></label>
        <label><span class="label">Ende (optional)</span><input class="input" type="date" name="date_end" value="${e.date_end || ''}"></label>
        <label><span class="label">Startzeit (für den Countdown)</span><input class="input" type="time" name="start_time" value="${e.start_time || ''}"></label>
        <label><span class="label">Ort</span><input class="input" name="location" value="${e.location || ''}" placeholder="Strecke, Treffpunkt"></label>
        <label class="sm:col-span-2"><span class="label">Notizen</span><textarea class="input" name="notes" rows="2">${e.notes || ''}</textarea></label>
      </div>
      <div>
        <div class="flex items-center justify-between"><span class="label">Teilnehmende Autos (Halle & außerhalb)</span><span class="text-xs text-slate-500" data-count></span></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-vehicles>
          ${store.vehicles.map((v) => html`
            <button type="button" class="card card-hover p-2 flex items-center gap-2 text-left ${selected.has(v.id) ? '!border-cyan-400 !bg-cyan-400/10' : ''}" data-veh="${v.id}">
              <img src="${carThumb(modelInfo(v.model), v.color, { w: 64, h: 30, status: statusInfo(v.status).color })}" class="w-16 h-[30px]" alt="">
              <span class="flex-1 min-w-0"><span class="block text-sm font-semibold text-white truncate">${v.name}</span>
                <span class="block text-[10px] text-slate-500">${v.slot_id ? 'in der Halle' : `außerhalb · ${v.extern_location || 'Paddock'}`}</span></span>
              <span class="w-5 h-5 rounded border-2 grid place-items-center ${selected.has(v.id) ? 'bg-cyan-400 border-cyan-400 text-black' : 'border-slate-500'}" data-tick>${selected.has(v.id) ? icon('check', 'w-3 h-3') : ''}</span>
            </button>`)}
        </div>
      </div>
    </form></div>`);
  const m = openModal({
    title: isNew ? 'Neues Event' : `${e.name} bearbeiten`, size: 'lg', iconName: 'calendar', body,
    footer: html`${!isNew ? html`<button class="btn btn-danger mr-auto" data-delete>${icon('trash')} Löschen</button>` : ''}
      <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} ${isNew ? 'Event anlegen' : 'Speichern'}</button>`
  });
  const updateCount = () => { body.querySelector('[data-count]').textContent = `${selected.size} ausgewählt`; };
  updateCount();
  on(body, 'click', '[data-veh]', (_e, b) => {
    const id = Number(b.dataset.veh);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    haptic(6);
    const on_ = selected.has(id);
    b.classList.toggle('!border-cyan-400', on_);
    b.classList.toggle('!bg-cyan-400/10', on_);
    const tick = b.querySelector('[data-tick]');
    tick.className = `w-5 h-5 rounded border-2 grid place-items-center ${on_ ? 'bg-cyan-400 border-cyan-400 text-black' : 'border-slate-500'}`;
    setHTML(tick, on_ ? icon('check', 'w-3 h-3') : '');
    updateCount();
  });
  const save = async () => {
    const form = body.querySelector('[data-form]');
    if (!form.reportValidity()) return;
    try {
      const payload = { ...formData(form), vehicle_ids: [...selected] };
      const saved = isNew ? await post('/events', payload) : await put(`/events/${e.id}`, payload);
      m.close();
      await Promise.all([refreshEvents(), refreshWhiteboard(), refreshVehicles()]);
      toast(isNew ? 'Event angelegt. Packliste ist fertig!' : 'Event gespeichert.', 'ok');
      if (isNew && saved.vehicle_ids.length) openPacklist(saved.id);
    } catch (err) { toastError(err); }
  };
  m.footer.querySelector('[data-save]').addEventListener('click', save);
  body.querySelector('[data-form]').addEventListener('submit', (ev2) => { ev2.preventDefault(); save(); });
  const delBtn = m.footer.querySelector('[data-delete]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(`„${e.name}“ löschen?`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/events/${e.id}`); m.close(); await Promise.all([refreshEvents(), refreshWhiteboard()]); toast('Event gelöscht.'); } catch (err) { toastError(err); }
  });
}

/* ====================================================================== */
/* Packliste                                                              */
/* ====================================================================== */
export async function openPacklist(eventId) {
  let data;
  try { data = await get(`/events/${eventId}/packlist`); } catch (err) { toastError(err); return; }
  let filter = 'all';
  let query = '';

  const body = el(html`<div class="print-area">
    <div data-top></div>
    <div class="flex flex-wrap items-center gap-2 my-4 no-print">
      <div class="mode-switch" data-filter>
        <button class="on" data-f="all">Alle</button><button data-f="open">Fehlt noch</button><button data-f="packed">Eingepackt</button>
      </div>
      <input class="input !w-auto flex-1 min-w-[160px]" placeholder="In Liste suchen …" data-q>
    </div>
    <div data-sections class="space-y-4"></div>
    ${canEdit() ? html`<form class="flex gap-2 mt-5 no-print" data-custom><input class="input" name="name" placeholder="Eigene Position, z. B. Startnummern, Campingstuhl" required><input class="input !w-20" type="number" min="1" name="qty" value="1"><button class="btn">${icon('plus')}</button></form>` : ''}
  </div>`);
  const m = openModal({
    title: `Packliste · ${data.event.name}`, subtitle: `${fmtDate(data.event.date_start)}${data.event.location ? ` · ${data.event.location}` : ''}`,
    size: 'lg', iconName: 'package', body,
    footer: html`${canEdit() ? html`<button class="btn btn-ghost mr-auto" data-reset>${icon('undo')} Haken zurücksetzen</button>` : ''}
      <button class="btn" data-print>${icon('print')} Drucken</button><button class="btn btn-primary" data-close>Fertig</button>`
  });

  function renderTop() {
    const pct = data.stats.total ? Math.round((data.stats.packed / data.stats.total) * 100) : 0;
    setHTML(body.querySelector('[data-top]'), html`
      <div class="flex items-center gap-4">
        <div class="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 36 36" class="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#1f2937" stroke-width="4"/>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="${pct === 100 ? '#a3e635' : '#22d3ee'}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(pct / 100) * 97.4} 97.4"/></svg>
          <span class="absolute inset-0 grid place-items-center font-display font-bold text-white text-sm">${pct}%</span>
        </div>
        <div class="flex-1">
          <div class="font-display font-bold text-white">${data.stats.packed} von ${data.stats.total} eingepackt</div>
          <div class="text-xs text-slate-400">Werkzeug und Universal-Teile erscheinen genau einmal, egal wie viele Autos mitfahren.</div>
          <div class="flex flex-wrap gap-1.5 mt-2">${data.vehicles.map((v) => html`<span class="chip"><span class="dot" style="background:${v.color}"></span>${v.name}</span>`)}</div>
        </div>
      </div>
      ${pct === 100 && data.stats.total ? html`<div class="mt-3 rounded-lg border border-lime-400/40 bg-lime-400/10 px-3 py-2 text-lime-200 text-sm font-semibold">${icon('check', 'w-4 h-4 inline')} Alles eingepackt. Gute Fahrt und viel Spaß beim Event!</div>` : ''}`);
  }

  function itemVisible(it) {
    if (filter === 'open' && it.packed) return false;
    if (filter === 'packed' && !it.packed) return false;
    if (query && !`${it.name} ${it.category || ''} ${(it.locations || []).join(' ')}`.toLowerCase().includes(query)) return false;
    return true;
  }

  function renderSections() {
    const sections = data.sections.filter((s) => s.items.length);
    setHTML(body.querySelector('[data-sections]'), html`${sections.map((s) => {
      const items = s.items.filter(itemVisible);
      if (!items.length) return '';
      const done = s.items.filter((i) => i.packed).length;
      return html`
        <section>
          <div class="flex items-center gap-2 mb-2">
            ${s.vehicle ? html`<img src="${carThumb(modelInfo(s.vehicle.model), s.vehicle.color, { w: 46, h: 22 })}" class="w-[46px] h-[22px]" alt="">` : html`<span class="text-cyan-300">${icon(s.icon === 'wrench' ? 'wrench' : s.icon === 'car' ? 'car' : s.icon === 'search' ? 'search' : s.icon === 'plus' ? 'plus' : 'box')}</span>`}
            <h4 class="font-display text-xs font-bold tracking-[0.18em] text-slate-200 uppercase flex-1">${s.title}</h4>
            <span class="text-xs font-mono ${done === s.items.length ? 'text-lime-300' : 'text-slate-500'}">${done}/${s.items.length}</span>
          </div>
          <div class="space-y-1.5">
            ${items.map((it) => html`
              <label class="card flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none ${it.packed ? '!border-lime-400/30 !bg-lime-400/5' : ''}" data-key="${it.key}">
                <input type="checkbox" class="check check-lg" ${it.packed ? 'checked' : ''} ${canEdit() ? '' : 'disabled'} data-item="${it.key}">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold ${it.packed ? 'text-slate-400 line-through decoration-lime-400/60' : 'text-white'}">${it.name}</div>
                  <div class="flex flex-wrap gap-1 mt-0.5">
                    ${(it.locations || []).map((l) => html`<span class="text-[10px] text-slate-500">${icon('target', 'w-2.5 h-2.5 inline')} ${l}</span>`)}
                    ${it.foreignModel ? html`<span class="text-[10px] text-amber-300/80">passt zu: ${it.matches.join(', ')} (${it.foreignModel})</span>` : ''}
                    ${it.borrowed && it.borrowed.length ? html`<span class="text-[10px] text-rose-300">${icon('alert', 'w-2.5 h-2.5 inline')} gerade verliehen</span>` : ''}
                    ${it.packed && it.packedBy ? html`<span class="text-[10px] text-lime-400/70">✓ ${it.packedBy}</span>` : ''}
                  </div>
                </div>
                <span class="chip font-mono">${it.qty}×</span>
                ${it.kind === 'custom' && canEdit() ? html`<button type="button" class="btn-icon !w-7 !h-7 no-print" data-delcustom="${it.id}">${icon('x', 'w-3.5 h-3.5')}</button>` : ''}
              </label>`)}
          </div>
        </section>`;
    })}
    ${!data.stats.total ? html`<div class="card p-6 text-center text-sm text-slate-400">Noch nichts auf der Liste. Wähle Autos für das Event und markiere Werkzeug/Teile als „Event-relevant“.</div>` : ''}`);
  }

  function rerender() { renderTop(); renderSections(); }

  on(body, 'change', '[data-item]', async (_e, cb) => {
    const key = cb.dataset.item;
    const packed = cb.checked;
    haptic(packed ? [8, 20, 8] : 6);
    const item = data.sections.flatMap((s) => s.items).find((i) => i.key === key);
    item.packed = packed;
    item.packedBy = packed ? store.me.name : null;
    data.stats.packed += packed ? 1 : -1;
    rerender();
    try { await post(`/events/${eventId}/packlist/check`, { itemKey: key, packed }); } catch (err) { toastError(err); }
  });
  on(body, 'click', '[data-f]', (_e, b) => {
    filter = b.dataset.f;
    body.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    renderSections();
  });
  on(body, 'input', '[data-q]', (_e, inp) => { query = inp.value.trim().toLowerCase(); renderSections(); });
  on(body, 'click', '[data-delcustom]', async (e, b) => {
    e.preventDefault();
    try { data = await del(`/events/${eventId}/packlist/custom/${b.dataset.delcustom}`); rerender(); } catch (err) { toastError(err); }
  });
  const customForm = body.querySelector('[data-custom]');
  if (customForm) customForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      data = await post(`/events/${eventId}/packlist/custom`, formData(customForm));
      customForm.reset();
      rerender();
    } catch (err) { toastError(err); }
  });
  m.footer.querySelector('[data-print]').addEventListener('click', () => window.print());
  const reset = m.footer.querySelector('[data-reset]');
  if (reset) reset.addEventListener('click', async () => {
    if (!(await confirmDialog('Alle Haken dieser Packliste entfernen?', { okLabel: 'Zurücksetzen' }))) return;
    try { data = await post(`/events/${eventId}/packlist/reset`); rerender(); } catch (err) { toastError(err); }
  });
  rerender();
  // Event-Liste (Zähler) im Hintergrund aktualisieren, wenn das Modal geschlossen wird
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); refreshEvents().catch(() => {}); } });
  obs.observe(document.getElementById('modalRoot'), { childList: true });
}
