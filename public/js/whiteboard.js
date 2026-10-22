/**
 * Hallen-Whiteboard
 * - Live: "Wer schraubt gerade woran?" (1-Klick-Zuweisung, pulsiert)
 * - Event-Deadline-Priorisierung (Server-Algorithmus /api/whiteboard)
 * - Hallen-To-Dos als Vorschläge, wenn Event-Autos fertig sind
 */
import { store, app, subscribe, canEdit, modelInfo, refreshWhiteboard, refreshVehicles } from './state.js';
import { get, post, del } from './api.js';
import { html, setHTML, el, on, icon, toast, toastError, haptic, since, fmtDate, countdownLabel, openModal, initials } from './ui.js';
import { carThumb } from './sprites.js';
import { taskMetaChips, pausedBox, openPauseDialog, openTaskPlan, openWorkload } from './workload.js';   // v5.3

let root = null;
let pending = false;

let lastRadar = '';

export function initWhiteboard(container) {
  root = container;
  subscribe('whiteboard', render);
  subscribe('work', render);
  subscribe('hud', () => { const sig = JSON.stringify((store.hud && store.hud.radar) || []); if (sig !== lastRadar) { lastRadar = sig; render(); } });   // v4.2
  root.addEventListener('focusout', () => { if (pending) setTimeout(render, 50); });
  bind();
  render();
}

function isTyping() {
  const a = document.activeElement;
  return a && root.contains(a) && a.matches('input,textarea,select');
}

function taskRow(t, { showEvent = true } = {}) {
  const editable = canEdit();
  const working = (store.work || []).some((w) => w.task_id === t.id);
  return html`
    <div class="card px-3 py-2.5 urg-${t.urgency || 'none'} group ${t.paused_at ? 'task-is-paused' : ''}" data-task="${t.id}">
      <div class="flex items-start gap-2.5">
        ${editable ? html`<button class="mt-0.5 w-5 h-5 rounded border-2 border-slate-500 hover:border-lime-400 hover:bg-lime-400/20 shrink-0 grid place-items-center" data-act="done" title="Erledigt (ins Wartungsheft)"></button>` : ''}
        <div class="flex-1 min-w-0">
          <button class="text-left text-sm font-semibold text-white leading-snug hover:text-cyan-300" data-act="open">${t.title}</button>
          <div class="flex flex-wrap items-center gap-1.5 mt-1">
            ${t.vehicle_name ? html`<span class="chip"><span class="dot" style="background:${t.vehicle_color}"></span>${t.vehicle_name}</span>` : html`<span class="chip">Halle</span>`}
            ${t.priority === 1 ? html`<span class="chip !text-rose-300 !border-rose-400/40">Prio hoch</span>` : ''}
            ${showEvent && t.event_name && t.deadline_kind !== 'target' ? html`<span class="chip ${t.urgency === 'critical' ? '!text-rose-200 !border-rose-400/50 !bg-rose-500/10' : t.urgency === 'soon' ? '!text-amber-200 !border-amber-400/50' : '!text-cyan-200 !border-cyan-400/40'}">${icon('flag', 'w-3 h-3')} ${t.event_name} · ${countdownLabel(t.daysLeft)}</span>` : ''}
            ${taskMetaChips(t)}
          </div>
          ${pausedBox(t)}
        </div>
        ${editable ? html`<div class="flex flex-col gap-1 shrink-0">
          <button class="btn-icon !w-8 !h-8 opacity-60 group-hover:opacity-100" data-act="work" title="Ich schraube daran">${icon('wrench')}</button>
          ${working || t.paused_at ? html`<button class="btn-icon !w-8 !h-8 ${t.paused_at ? '!text-amber-300' : 'opacity-60 group-hover:opacity-100'}" data-act="pause" title="Arbeit pausieren / Nicht fertig">${icon('pause')}</button>`
            : html`<button class="btn-icon !w-8 !h-8 opacity-60 group-hover:opacity-100" data-act="plan" title="Planen: wer, wie lange, bis wann">${icon('clock')}</button>`}
        </div>` : ''}
      </div>
    </div>`;
}

function render() {
  if (!root) return;
  if (isTyping()) { pending = true; return; }
  pending = false;
  const wb = store.whiteboard;
  const work = store.work || [];
  const me = store.me;
  const myWork = me && work.find((w) => w.user_id === me.id);

  setHTML(root, html`
    <div class="px-4 pt-4 pb-3 border-b border-white/10 flex items-center gap-2 shrink-0">
      <h2 class="whiteboard-title text-xl text-white flex-1">Whiteboard</h2>
      <button class="btn btn-sm" data-act="workload" title="Team-Auslastung: wer hat wie viel zu tun?">${icon('users', 'w-3.5 h-3.5')} Team</button>
      <button class="btn-icon" data-act="refresh" title="Aktualisieren">${icon('refresh')}</button>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5">
      <!-- LIVE -->
      <section>
        <div class="flex items-center gap-2 mb-2"><span class="live-dot"></span><h3 class="font-display text-xs font-bold tracking-[0.2em] text-lime-300">LIVE IN DER HALLE</h3></div>
        <div class="space-y-2">
          ${work.length ? work.map((w) => html`
            <div class="card live-card px-3 py-2.5 flex items-center gap-3 border-lime-400/30">
              <span class="w-8 h-8 rounded-full grid place-items-center text-xs font-bold text-black shrink-0" style="background:${w.user_color}">${initials(w.user_name)}</span>
              <div class="flex-1 min-w-0 text-sm leading-snug">
                <div><b class="text-white">${w.user_name}</b> schraubt an <button class="text-cyan-300 hover:underline" data-act="vehicle" data-id="${w.vehicle_id || ''}">${w.vehicle_name || 'der Halle'}</button></div>
                <div class="text-[11px] text-slate-400">${w.text || w.task_title || ''}${w.text || w.task_title ? ' · ' : ''}${since(w.started_at)}</div>
              </div>
              ${me && w.user_id === me.id && w.task_id ? html`<button class="btn btn-sm !text-amber-200" data-act="pausework" data-task-id="${w.task_id}" title="Arbeit pausieren / Nicht fertig geworden">${icon('pause', 'w-3.5 h-3.5')}</button>` : ''}
              ${me && w.user_id === me.id ? html`<button class="btn btn-sm" data-act="stop" title="Fertig für heute">${icon('stop', 'w-3.5 h-3.5')}</button>` : ''}
            </div>`) : html`<p class="text-sm text-slate-500">Niemand aktiv.</p>`}
          ${canEdit() && !myWork ? html`<button class="btn w-full !justify-start" data-act="startwork">${icon('play', 'w-3.5 h-3.5')} Woran schraubst du gerade?</button>` : ''}
        </div>
      </section>

      ${wb && wb.nextEvent ? html`
        <section class="relative overflow-hidden rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-transparent p-4 cursor-pointer" data-act="event" data-id="${wb.nextEvent.id}">
          <div class="absolute inset-x-0 top-0 h-1 hazard"></div>
          <div class="text-[10px] font-display font-bold tracking-[0.2em] text-amber-300">NÄCHSTES EVENT</div>
          <div class="flex items-end justify-between gap-3 mt-1">
            <div class="min-w-0"><div class="font-display text-lg font-bold text-white truncate">${wb.nextEvent.name}</div><div class="text-xs text-slate-400">${fmtDate(wb.nextEvent.date_start)}${wb.nextEvent.location ? ` · ${wb.nextEvent.location}` : ''}</div></div>
            <div class="text-right shrink-0"><div class="font-display text-3xl font-bold ${wb.nextEvent.daysLeft <= 3 ? 'text-rose-400' : 'text-amber-300'} leading-none">${Math.max(0, wb.nextEvent.daysLeft)}</div><div class="text-[10px] uppercase tracking-widest text-slate-400">Tage</div></div>
          </div>
        </section>` : ''}

      ${radarSection()}

      <!-- PRIORITÄT -->
      <section>
        <h3 class="font-display text-xs font-bold tracking-[0.2em] text-slate-300 mb-2">PRIORITÄT NACH DEADLINE</h3>
        ${!wb ? html`<p class="text-sm text-slate-500">Lädt …</p>` : wb.urgent.length
          ? html`<div class="space-y-2">${wb.urgent.map((t) => taskRow(t))}</div>`
          : html`<div class="card p-3 border-lime-400/30 text-sm"><div class="text-lime-300 font-semibold">${icon('check', 'w-4 h-4 inline')} Alle Event-Autos sind startklar!</div><div class="text-slate-400 mt-1">Zeit für die Halle. Vorschläge:</div></div>
            <div class="space-y-2 mt-2">${wb.suggestions.map((t) => taskRow(t))}</div>`}
      </section>

      ${wb && wb.readyForEvent.length ? html`
        <section>
          <h3 class="font-display text-xs font-bold tracking-[0.2em] text-slate-300 mb-2">STARTKLAR</h3>
          <div class="flex flex-wrap gap-2">${wb.readyForEvent.map((v) => html`<button class="chip chip-btn !border-lime-400/40" data-act="vehicle" data-id="${v.id}"><span class="dot" style="background:${v.color}"></span>${v.name} → ${v.event_name}</button>`)}</div>
        </section>` : ''}

      <!-- HALLEN-TO-DOS -->
      ${wb ? html`
        <section>
          <h3 class="font-display text-xs font-bold tracking-[0.2em] text-slate-300 mb-2">HALLEN-TO-DOS</h3>
          <div class="space-y-2">${wb.hall.map((t) => taskRow(t))}</div>
          ${canEdit() ? html`<form class="flex gap-2 mt-2" data-form="hall"><input class="input text-sm" name="title" placeholder="Neues Hallen-To-Do …" autocomplete="off"><button class="btn btn-sm">${icon('plus')}</button></form>` : ''}
        </section>
        ${wb.backlog.length ? html`
          <details class="group">
            <summary class="cursor-pointer font-display text-xs font-bold tracking-[0.2em] text-slate-400 mb-2 select-none">BACKLOG (ohne Event) · ${wb.backlog.length}</summary>
            <div class="space-y-2">${wb.backlog.map((t) => taskRow(t))}</div>
          </details>` : ''}` : ''}
    </div>`);
}

/* v4.2: Einkaufs-Radar "Demnächst einkaufen" (Kritische Liste + Kühlschrank unter Soll), 1 Klick auf die Einkaufsliste */
function radarSection() {
  const radar = (store.hud && store.hud.radar) || [];
  if (!radar.length) return '';
  const shown = radar.slice(0, 5);
  return html`
    <section class="rounded-xl border ${radar.some((r) => r.level === 'critical') ? 'border-rose-400/50 bg-rose-500/5' : 'border-amber-400/30 bg-amber-400/5'} p-3">
      <div class="flex items-center gap-2 mb-2">
        <h3 class="font-display text-xs font-bold tracking-[0.2em] ${radar.some((r) => r.level === 'critical') ? 'text-rose-300' : 'text-amber-300'} flex-1">🛒 DEMNÄCHST EINKAUFEN</h3>
        <button class="text-[11px] text-cyan-300 hover:underline" data-act="shop">Einkauf öffnen</button>
      </div>
      <div class="space-y-1.5">${shown.map((r) => html`
        <div class="flex items-center gap-2 text-sm">
          <span class="${r.level === 'critical' ? 'text-rose-300' : 'text-amber-300'} shrink-0">${icon(r.source === 'supply' ? 'fridge' : 'alert', 'w-3.5 h-3.5')}</span>
          <div class="flex-1 min-w-0"><div class="text-white truncate">${r.name}</div><div class="text-[11px] text-slate-400 truncate">${r.text}</div></div>
          ${r.onList ? html`<span class="text-lime-300 text-[11px] shrink-0">${icon('check', 'w-3 h-3 inline')} Liste</span>`
            : canEdit() ? html`<button class="btn btn-sm !px-2 shrink-0" data-act="tolist" data-src="${r.source}" data-ref="${r.ref_id}" title="Auf die Einkaufsliste">${icon('plus', 'w-3.5 h-3.5')} Liste</button>` : ''}
        </div>`)}
        ${radar.length > shown.length ? html`<button class="text-[11px] text-slate-400 hover:text-white" data-act="shop">+ ${radar.length - shown.length} weitere</button>` : ''}
      </div>
    </section>`;
}

function findTask(id) {
  const wb = store.whiteboard;
  if (!wb) return null;
  return [...wb.urgent, ...wb.backlog, ...wb.hall].find((t) => t.id === Number(id));
}

async function afterChange() {
  await Promise.all([refreshWhiteboard(), refreshVehicles()]);
}

function bind() {
  on(root, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    const taskId = btn.closest('[data-task]') && btn.closest('[data-task]').dataset.task;
    try {
      if (act === 'refresh') { await afterChange(); toast('Whiteboard aktualisiert'); }
      if (act === 'done') {
        const t = findTask(taskId);
        haptic([10, 30, 10]);
        btn.classList.add('!bg-lime-400', '!border-lime-400');
        await post(`/tasks/${taskId}/done`, {});
        toast(t && t.vehicle_id ? `„${t.title}“ erledigt und ins Wartungsheft übertragen.` : 'Erledigt!', 'ok');
        await afterChange();
      }
      if (act === 'work') {
        const t = findTask(taskId);
        await post('/work', { task_id: Number(taskId), vehicle_id: t ? t.vehicle_id : null });
        haptic(15);
        toast(`Du schraubst jetzt: ${t ? t.title : ''}`, 'ok');
        await afterChange();
      }
      if (act === 'open') {
        const t = findTask(taskId);
        if (t && t.vehicle_id) app.navigate({ kind: 'vehicle', vehicleId: t.vehicle_id, tab: 'tasks' });
      }
      if (act === 'stop') { await post('/work/stop'); toast('Feierabend eingetragen. Gute Arbeit!'); await afterChange(); }
      // v5.3: Team-Koordination
      if (act === 'workload') openWorkload();
      if (act === 'pause' || act === 'plan') {
        const t = findTask(taskId);
        if (t) (act === 'pause' ? openPauseDialog : openTaskPlan)(t, afterChange);
      }
      if (act === 'pausework') {
        const id = Number(btn.dataset.taskId);
        let t = findTask(id);
        if (!t) { const all = await get('/tasks?status=open'); t = all.find((x) => x.id === id); }
        if (t) openPauseDialog(t, afterChange);
      }
      if (act === 'startwork') openWorkDialog();
      if (act === 'vehicle' && btn.dataset.id) app.navigate({ kind: 'vehicle', vehicleId: Number(btn.dataset.id) });
      if (act === 'event') app.navigate({ kind: 'event', eventId: Number(btn.dataset.id) });
      if (act === 'shop' && app.openQuickUse) app.openQuickUse({ tab: 'shop' });
      if (act === 'tolist') {
        await post('/shopping-list', { source: btn.dataset.src, ref_id: Number(btn.dataset.ref) });
        haptic(12);
        toast('Steht auf der Hallen-Einkaufsliste.', 'ok');
        if (app.refreshHud) await app.refreshHud();
      }
    } catch (err) { toastError(err); }
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="hall"]');
    if (!form) return;
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    try {
      await post('/tasks', { title, vehicle_id: null });
      form.title.value = '';
      form.title.blur();
      await refreshWhiteboard();
    } catch (err) { toastError(err); }
  });
}

/** 1-Klick-Zuweisung: Auto wählen -> Aufgabe wählen oder Freitext. */
export async function openWorkDialog(preselectVehicleId = null) {
  let vehicleId = preselectVehicleId;
  const body = el(html`<div><div data-step></div></div>`);
  const m = openModal({ title: 'Woran schraubst du?', subtitle: 'Erscheint live auf der Übersicht', iconName: 'wrench', size: 'md', body });
  const step = body.querySelector('[data-step]');

  async function renderStep() {
    if (!vehicleId) {
      setHTML(step, html`
        <div class="grid grid-cols-2 gap-2">
          ${store.vehicles.map((v) => html`
            <button class="card card-hover p-2 flex items-center gap-2 text-left" data-v="${v.id}">
              <img src="${carThumb(modelInfo(v.model), v.color, { w: 72, h: 34 })}" class="w-[72px] h-[34px]" alt="">
              <span class="text-sm font-semibold text-white leading-tight">${v.name}</span>
            </button>`)}
          <button class="card card-hover p-3 text-sm text-slate-300" data-v="0">${icon('grid', 'w-4 h-4 inline')} Halle allgemein</button>
        </div>`);
      return;
    }
    const tasks = vehicleId > 0 ? await get(`/tasks?vehicleId=${vehicleId}&status=open`) : await get('/tasks?vehicleId=hall&status=open');
    const v = store.vehicles.find((x) => x.id === vehicleId);
    setHTML(step, html`
      <button class="text-xs text-slate-400 hover:text-white mb-3" data-back>← ${v ? v.name : 'Halle'}</button>
      <div class="space-y-2 mb-4">
        ${tasks.map((t) => html`<button class="card card-hover w-full text-left px-3 py-2.5 text-sm font-semibold text-white" data-t="${t.id}">${t.title}</button>`)}
        ${!tasks.length ? html`<p class="text-sm text-slate-500">Keine offenen Aufgaben. Freitext?</p>` : ''}
      </div>
      <form class="flex gap-2" data-free><input class="input" name="text" placeholder="z. B. Querlenker, Elektrik …" required><button class="btn btn-primary">${icon('play', 'w-3.5 h-3.5')} Los</button></form>`);
  }

  on(step, 'click', '[data-v]', (_e, b) => { vehicleId = Number(b.dataset.v) || -1; renderStep(); });
  on(step, 'click', '[data-back]', () => { vehicleId = null; renderStep(); });
  const start = async (payload) => {
    try {
      await post('/work', payload);
      haptic(15);
      m.close();
      toast('Eingetragen! Pulsiert jetzt live auf der Map.', 'ok');
      await afterChange();
    } catch (err) { toastError(err); }
  };
  on(step, 'click', '[data-t]', (_e, b) => start({ task_id: Number(b.dataset.t), vehicle_id: vehicleId > 0 ? vehicleId : null }));
  step.addEventListener('submit', (e) => { e.preventDefault(); start({ vehicle_id: vehicleId > 0 ? vehicleId : null, text: e.target.text.value }); });
  renderStep();
}

export async function deleteTask(id) { await del(`/tasks/${id}`); }
