/**
 * Fahrzeug-Cockpit (Modal) + Fuhrpark-Panel
 * Tabs: Aufgaben · Wartungsheft · Budget · Dokumente · Daten (Admin-Konverter) · Teile · Events · Einstellungen
 */
import { store, app, canEdit, isAdmin, modelInfo, statusInfo, vehicleLocationLabel, refreshVehicles, refreshWhiteboard } from './state.js';
import { get, post, put, del, upload } from './api.js';
import { html, raw, setHTML, el, on, icon, toast, toastError, haptic, euro, fmtDate, fmtDateTime, daysUntil, countdownLabel,
  openModal, confirmDialog, chooseDialog, formData, esc } from './ui.js';
import { carThumb } from './sprites.js';
import { openWorkDialog } from './whiteboard.js';
import { renderSetupTab } from './setup.js';
import { printLabels } from './qr.js';
import { dimsFields, bindDims, dimsPayload } from './dims.js';   // v4.1: Radmaße + KI-Auto-Fill

const TABS = [
  ['tasks', 'Aufgaben', 'list'], ['log', 'Wartungsheft', 'book'], ['budget', 'Budget', 'euro'], ['docs', 'Dokumente', 'file'],
  ['setup', 'Setup & Maße', 'gauge'], ['data', 'Daten & TÜV', 'settings'], ['parts', 'Teile', 'box'], ['events', 'Events', 'flag'], ['edit', 'Einstellungen', 'edit']
];
const DOC_KINDS = { schein: 'Fahrzeugschein', gutachten: 'Gutachten / Teilegutachten', tuev: 'TÜV-Bericht', foto: 'Foto', rechnung: 'Rechnung', sonstiges: 'Sonstiges' };
const COLOR_PRESETS = ['#f5c518', '#b91c1c', '#1e40af', '#0f766e', '#111827', '#e5e7eb', '#9ca3af', '#f97316', '#7c3aed', '#16a34a', '#0ea5e9', '#be185d'];

function tuevInfo(val) {
  if (!val) return null;
  const end = val.length === 7 ? `${val}-28` : val;
  const days = daysUntil(end);
  const label = val.length === 7 ? `${val.slice(5, 7)}/${val.slice(0, 4)}` : fmtDate(val);
  return { label, days, cls: days < 0 ? 'text-rose-400' : days < 60 ? 'text-amber-300' : 'text-lime-300' };
}

/* ====================================================================== */
export async function openCockpit(id, { tab = 'tasks', query = '' } = {}) {
  let data;
  try { data = await get(`/vehicles/${id}`); } catch (err) { toastError(err); return; }
  let current = tab;
  let logQuery = query || '';

  const body = el(html`<div class="-mx-5 -my-4"><div data-head></div>
    <nav class="tabs px-3 border-b border-white/10 sticky top-0 z-10 bg-[#121821]" data-tabs></nav>
    <div class="px-5 py-4" data-content></div></div>`);
  const m = openModal({ title: data.vehicle.name, subtitle: modelInfo(data.vehicle.model).label, size: 'xl', iconName: 'car', body });
  const head = body.querySelector('[data-head]');
  const tabsEl = body.querySelector('[data-tabs]');
  const content = body.querySelector('[data-content]');

  async function reload({ vehiclesToo = true } = {}) {
    data = await get(`/vehicles/${id}`);
    if (vehiclesToo) refreshVehicles().catch(() => {});
    renderHead();
    renderTab();
  }

  function renderHead() {
    const v = data.vehicle;
    const st = statusInfo(v.status);
    const tuev = tuevInfo(v.tuev_until);
    const ev = data.events.find((e) => (e.date_end || e.date_start) >= new Date().toISOString().slice(0, 10));
    const openTasks = data.tasks.filter((t) => t.status === 'open').length;
    m.el.querySelector('h2').textContent = v.name;
    setHTML(head, html`
      <div class="relative px-5 pt-4 pb-5 overflow-hidden">
        <div class="absolute inset-0 opacity-40 pointer-events-none" style="background:radial-gradient(ellipse at 15% 50%, ${st.color}33, transparent 60%)"></div>
        <div class="relative flex flex-col md:flex-row gap-5 md:items-center">
          <div class="shrink-0 rounded-xl bg-black/40 border border-white/10 p-3 grid place-items-center">
            <img src="${carThumb(modelInfo(v.model), v.color, { w: 240, h: 104, status: st.color })}" class="w-[240px] h-[104px]" alt="${v.name}">
          </div>
          <div class="flex-1 min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span class="chip">${icon('map', 'w-3 h-3')} ${vehicleLocationLabel(v)}</span>
              ${v.plate ? html`<span class="chip font-mono">${v.plate}</span>` : ''}
              ${data.work.map((w) => html`<span class="chip !border-lime-400/40 !text-lime-200"><span class="live-dot !w-2 !h-2"></span>${w.user_name} schraubt${w.text ? `: ${w.text}` : ''}</span>`)}
            </div>
            <div class="flex flex-wrap gap-2" data-status>
              ${Object.entries(store.meta.status).map(([key, s]) => html`
                <button class="btn btn-sm ${v.status === key ? '' : 'opacity-50'}" ${canEdit() ? '' : 'disabled'} data-status-key="${key}"
                  style="${v.status === key ? `border-color:${s.color};box-shadow:0 0 14px ${s.color}55;color:${s.color}` : ''}">
                  <span class="dot" style="background:${s.color}"></span>${s.label}</button>`)}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              ${kpi('Offene Aufgaben', openTasks, openTasks ? 'text-amber-300' : 'text-lime-300')}
              ${kpi('Noch zu kaufen', euro(data.budget.todo), 'text-white')}
              ${kpi('TÜV', tuev ? tuev.label : 'k. A.', tuev ? tuev.cls : 'text-slate-500')}
              ${kpi('Nächstes Event', ev ? `${ev.name}` : 'keins', ev ? 'text-cyan-300' : 'text-slate-500', ev ? countdownLabel(daysUntil(ev.date_start)) : '')}
            </div>
          </div>
        </div>
        ${canEdit() ? html`
          <div class="relative flex flex-wrap gap-2 mt-4">
            <button class="btn btn-sm btn-lime" data-quick="work">${icon('wrench')} Ich schraube daran</button>
            <button class="btn btn-sm" data-quick="move">${icon('move')} Umparken</button>
            ${v.slot_id && store.vehicles.filter((x) => x.slot_id === v.slot_id).length > 1 ? html`<button class="btn btn-sm" data-quick="swaplevel">${icon('layers')} Oben/Unten tauschen</button>` : ''}
            <button class="btn btn-sm" data-quick="map">${icon('target')} Auf Map zeigen</button>
            <button class="btn btn-sm" data-quick="wheels">${icon('tyre')} Räder</button>
            <button class="btn btn-sm burn-btn" data-quick="burn" title="2 Driftreifen dieses Autos als abgefahren buchen">${icon('flame')} -2 Burned</button>
            <button class="btn btn-sm" data-quick="qr">${icon('qr')} QR-Code drucken</button>
          </div>` : ''}
      </div>`);
  }

  const kpi = (label, value, cls, sub = '') => html`
    <div class="rounded-lg bg-black/30 border border-white/10 px-3 py-2 min-w-0">
      <div class="text-[10px] uppercase tracking-widest text-slate-500 font-display">${label}</div>
      <div class="font-display font-bold ${cls} truncate">${value}</div>
      ${sub ? html`<div class="text-[10px] text-slate-400">${sub}</div>` : ''}
    </div>`;

  function renderTabs() {
    setHTML(tabsEl, html`${TABS.map(([key, label]) => {
      const count = key === 'tasks' ? data.tasks.filter((t) => t.status === 'open').length : key === 'docs' ? data.documents.length : key === 'log' ? data.log.length : null;
      return html`<button class="tab ${current === key ? 'active' : ''}" data-tab="${key}">${label}${count ? html`<span class="chip !py-0 !px-1.5 !text-[10px]">${count}</span>` : ''}</button>`;
    })}`);
  }

  function renderTab() {
    renderTabs();
    const r = { tasks: tabTasks, log: tabLog, budget: tabBudget, docs: tabDocs, setup: tabSetup, data: tabData, parts: tabParts, events: tabEvents, edit: tabEdit }[current];
    r();
  }

  /* ---------------- Aufgaben ---------------- */
  function tabTasks() {
    const open = data.tasks.filter((t) => t.status === 'open');
    const done = data.tasks.filter((t) => t.status === 'done').slice(-8).reverse();
    setHTML(content, html`
      ${canEdit() ? html`
        <form class="card p-3 mb-4 grid grid-cols-2 sm:grid-cols-[1fr_auto_auto] gap-2" data-form="task">
          <input class="input col-span-2 sm:col-span-1" name="title" placeholder="Neue Aufgabe, z. B. Querlenker tauschen" required>
          <select class="select" name="priority"><option value="1">Prio hoch</option><option value="2" selected>Normal</option><option value="3">Niedrig</option></select>
          <button class="btn btn-primary">${icon('plus')} Hinzufügen</button>
          <input class="input col-span-2 sm:col-span-2 text-sm" name="description" placeholder="Details (optional)">
          <input class="input col-span-2 sm:col-span-1 text-sm sm:!w-36" name="cost" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Preis €" title="Optional: Preis, erscheint automatisch im Budget">
        </form>
        <div class="flex items-center gap-2 mb-3 text-xs text-slate-400">
          <label class="flex items-center gap-2">Km-Stand fürs Protokoll <input class="input !w-32 !py-1 text-sm" type="number" data-mileage placeholder="${data.vehicle.mileage || ''}"></label>
        </div>` : ''}
      <div class="space-y-2">
        ${open.length ? open.map((t) => html`
          <div class="card px-3 py-3 flex items-start gap-3 ${t.priority === 1 ? 'urg-critical' : t.priority === 3 ? 'urg-none' : 'urg-planned'}">
            ${canEdit() ? html`<button class="mt-0.5 w-6 h-6 rounded-md border-2 border-slate-500 hover:border-lime-400 hover:bg-lime-400/20 shrink-0" data-done="${t.id}" title="Erledigt: wandert mit Datum + User ins Wartungsheft"></button>` : ''}
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-white">${t.title}</div>
              ${t.description ? html`<div class="text-sm text-slate-400">${t.description}</div>` : ''}
              <div class="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-2">angelegt ${fmtDate(t.created_at)}${t.created_by_name ? ` von ${t.created_by_name}` : ''}
                ${t.cost ? html`<span class="text-amber-300">${euro(t.cost)} · im Budget</span>` : ''}</div>
            </div>
            ${canEdit() ? html`
              <button class="btn-icon" data-taskcost="${t.id}" title="Preis festlegen (erscheint automatisch im Budget)">${icon('euro')}</button>
              <button class="btn-icon" data-worktask="${t.id}" title="Ich schraube daran">${icon('wrench')}</button>
              <button class="btn-icon hover:!text-rose-300" data-deltask="${t.id}" title="Löschen">${icon('trash')}</button>` : ''}
          </div>`) : html`<div class="card p-6 text-center text-slate-400">${icon('check', 'w-6 h-6 mx-auto mb-2 text-lime-400')}Keine offenen Aufgaben. Fahrbereit?</div>`}
      </div>
      ${done.length ? html`
        <h4 class="font-display text-xs tracking-[0.2em] text-slate-500 mt-6 mb-2">ZULETZT ERLEDIGT</h4>
        <div class="space-y-1.5">${done.map((t) => html`
          <div class="flex items-center gap-3 text-sm text-slate-400 px-2">
            ${icon('check', 'w-4 h-4 text-lime-400 shrink-0')}<span class="flex-1 line-through decoration-slate-600">${t.title}</span>
            <span class="text-[11px]">${fmtDate(t.done_at)} · ${t.done_by_name || ''}</span>
            ${canEdit() ? html`<button class="text-[11px] text-slate-500 hover:text-white" data-reopen="${t.id}">zurück</button>` : ''}
          </div>`)}</div>` : ''}`);
  }

  /* ---------------- Wartungsheft ---------------- */
  function highlight(text, q) {
    const safe = esc(text || '');
    if (!q) return raw(safe);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    return raw(safe.replace(re, '<mark>$1</mark>'));
  }

  function logList() {
    const q = logQuery.trim().toLowerCase();
    const rows = data.log.filter((l) => !q || `${l.title} ${l.description || ''}`.toLowerCase().includes(q));
    const totalCost = rows.reduce((a, l) => a + (l.cost || 0), 0);
    return html`
      <div class="text-xs text-slate-500 mb-2">${rows.length} Einträge${totalCost ? ` · Summe ${euro(totalCost)}` : ''}</div>
      <ol class="relative border-l border-white/10 ml-2 space-y-4">
        ${rows.map((l) => html`
          <li class="ml-4">
            <span class="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]"></span>
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-mono text-xs text-cyan-300">${fmtDate(l.done_at)}</span>
              <span class="font-semibold text-white">${highlight(l.title, q)}</span>
            </div>
            ${l.description ? html`<div class="text-sm text-slate-400">${highlight(l.description, q)}</div>` : ''}
            <div class="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
              ${l.user_name ? html`<span>${icon('user', 'w-3 h-3 inline')} ${l.user_name}</span>` : ''}
              ${l.mileage ? html`<span>${Number(l.mileage).toLocaleString('de-DE')} km</span>` : ''}
              ${l.cost ? html`<span>${euro(l.cost)}</span>` : ''}
              ${l.task_id ? html`<span class="text-lime-400/80">aus Aufgabe</span>` : ''}
              ${isAdmin() ? html`<button class="hover:text-rose-300" data-dellog="${l.id}">löschen</button>` : ''}
            </div>
          </li>`)}
        ${!rows.length ? html`<li class="ml-4 text-slate-500 text-sm">Nichts gefunden.</li>` : ''}
      </ol>`;
  }

  function tabLog() {
    setHTML(content, html`
      <div class="relative mb-4">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">${icon('search')}</span>
        <input class="input !pl-9" placeholder="Wartungsheft durchsuchen, z. B. Benzinfilter" value="${logQuery}" data-logsearch>
      </div>
      ${canEdit() ? html`
        <details class="card p-3 mb-4">
          <summary class="cursor-pointer text-sm font-semibold text-slate-300">${icon('plus', 'w-4 h-4 inline')} Manueller Eintrag</summary>
          <form class="grid grid-cols-2 gap-2 mt-3" data-form="log">
            <input class="input col-span-2" name="title" placeholder="Was wurde gemacht?" required>
            <textarea class="input col-span-2" name="description" rows="2" placeholder="Details, Teilenummern …"></textarea>
            <input class="input" name="mileage" type="number" placeholder="Km-Stand">
            <input class="input" name="cost" type="number" step="0.01" placeholder="Kosten €">
            <input class="input" name="done_at" type="date" value="${new Date().toISOString().slice(0, 10)}">
            <button class="btn btn-primary">Eintragen</button>
          </form>
        </details>` : ''}
      <div data-loglist>${logList()}</div>`);
  }

  /* ---------------- Budget ---------------- */
  function tabBudget() {
    const todo = data.purchases.filter((p) => p.status === 'todo');
    const bought = data.purchases.filter((p) => p.status === 'bought');
    const col = (title, list, sum, cls, toggleLabel) => html`
      <div class="card p-3 flex flex-col">
        <div class="flex items-baseline justify-between mb-2">
          <h4 class="font-display text-xs tracking-[0.2em] ${cls}">${title}</h4>
          <span class="font-display font-bold text-lg text-white">${euro(sum)}</span>
        </div>
        <div class="space-y-1.5 flex-1">
          ${list.map((p) => html`
            <div class="flex items-center gap-2 rounded-md bg-black/25 px-2.5 py-2 text-sm">
              <div class="flex-1 min-w-0"><div class="text-white truncate">${p.url ? html`<a href="${p.url}" target="_blank" rel="noopener" class="hover:text-cyan-300">${p.name} ↗</a>` : p.name}</div>
                <div class="text-[11px] text-slate-500">${p.qty} × ${euro(p.price)}${p.bought_at ? ` · ${p.log_id ? 'erledigt' : 'gekauft'} ${fmtDate(p.bought_at)}` : ''}
                  ${p.log_id ? html` · <span class="text-cyan-300">aus Wartungsheft</span>` : p.task_id ? html` · <span class="text-cyan-300">aus Aufgabe</span>` : ''}</div></div>
              <span class="font-mono text-xs text-slate-300">${euro(p.price * p.qty)}</span>
              ${canEdit() && !p.log_id ? html`<button class="btn btn-sm" data-buytoggle="${p.id}" data-to="${p.status === 'todo' ? 'bought' : 'todo'}">${toggleLabel}</button>` : ''}
              ${canEdit() && !p.log_id && !p.task_id ? html`<button class="btn-icon !w-7 !h-7 hover:!text-rose-300" data-delbuy="${p.id}">${icon('trash', 'w-3.5 h-3.5')}</button>` : ''}
              ${p.log_id || p.task_id ? html`<span class="w-7 text-center text-slate-500" title="Wird automatisch geführt. Ändern in ${p.log_id ? 'Wartungsheft' : 'Aufgaben'}.">${icon('link', 'w-3.5 h-3.5 inline')}</span>` : ''}
            </div>`)}
          ${!list.length ? html`<p class="text-sm text-slate-500">Leer.</p>` : ''}
        </div>
      </div>`;
    setHTML(content, html`
      ${canEdit() ? html`
        <form class="card p-3 mb-4 grid grid-cols-2 sm:grid-cols-[1fr_90px_70px_auto] gap-2" data-form="buy">
          <input class="input col-span-2 sm:col-span-1" name="name" placeholder="Teil / Artikel" required>
          <input class="input" name="price" type="number" step="0.01" placeholder="Preis €" required>
          <input class="input" name="qty" type="number" min="1" value="1">
          <button class="btn btn-primary col-span-2 sm:col-span-1">${icon('plus')} Auf die Liste</button>
          <input class="input col-span-2 sm:col-span-4 text-sm" name="url" placeholder="Link zum Shop (optional)">
        </form>` : ''}
      <p class="text-[11px] text-slate-500 mb-3">${icon('link', 'w-3 h-3 inline')} Preise aus Aufgaben und Kosten aus dem Wartungsheft erscheinen hier automatisch, ohne doppelte Eingabe.</p>
      <div class="grid md:grid-cols-2 gap-3">
        ${col('NOCH ZU KAUFEN', todo, data.budget.todo, 'text-amber-300', 'Gekauft ✓')}
        ${col('BEREITS GEKAUFT', bought, data.budget.bought, 'text-lime-300', '↺')}
      </div>
      <div class="mt-4 card p-4 flex items-center justify-between">
        <span class="font-display tracking-[0.2em] text-xs text-slate-400">GESAMTBUDGET ${data.vehicle.name.toUpperCase()}</span>
        <span class="font-display text-2xl font-bold text-cyan-300">${euro(data.budget.total)}</span>
      </div>`);
  }

  /* ---------------- Dokumente ---------------- */
  function tabDocs() {
    setHTML(content, html`
      ${canEdit() ? html`
        <form class="card p-4 mb-4 border-dashed border-2 border-white/15 hover:border-cyan-400/50 transition" data-form="doc">
          <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label class="flex-1 cursor-pointer">
              <span class="label">Datei (Foto / PNG / PDF)</span>
              <input type="file" name="file" accept="image/*,application/pdf" class="block w-full text-sm text-slate-400 file:mr-3 file:btn file:border-0 file:rounded-md file:px-3 file:py-2 file:bg-cyan-500 file:text-black file:font-semibold" required>
            </label>
            <label class="sm:w-48"><span class="label">Art</span>
              <select class="select" name="kind">${Object.entries(DOC_KINDS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
            <label class="sm:w-48"><span class="label">Titel</span><input class="input" name="title" placeholder="optional"></label>
            <button class="btn btn-primary">${icon('upload')} Hochladen</button>
          </div>
          <p class="text-[11px] text-slate-500 mt-2">Tipp: Am Handy öffnet sich direkt die Kamera. Datei auch per Drag & Drop hier ablegen.</p>
        </form>` : ''}
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        ${data.documents.map((d) => html`
          <div class="card overflow-hidden group">
            <button class="block w-full aspect-[4/3] bg-black/40 grid place-items-center overflow-hidden" data-viewdoc="${d.id}">
              ${d.mime && d.mime.startsWith('image/') ? html`<img src="/files/${d.filename}" class="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" alt="${d.title}">`
                : html`<span class="text-slate-400 flex flex-col items-center gap-1">${icon('file', 'w-8 h-8')}PDF</span>`}
            </button>
            <div class="p-2">
              <div class="text-xs font-semibold text-white truncate">${d.title || d.original_name}</div>
              <div class="text-[10px] text-slate-500 flex items-center justify-between gap-1">
                <span>${DOC_KINDS[d.kind] || d.kind} · ${fmtDate(d.created_at)}</span>
                ${canEdit() ? html`<button class="hover:text-rose-300" data-deldoc="${d.id}">${icon('trash', 'w-3 h-3')}</button>` : ''}
              </div>
            </div>
          </div>`)}
      </div>
      ${!data.documents.length ? html`<p class="text-sm text-slate-500">Noch keine Dokumente. Fahrzeugschein abfotografieren und hochladen!</p>` : ''}`);
    const form = content.querySelector('[data-form="doc"]');
    if (form) {
      form.addEventListener('dragover', (e) => { e.preventDefault(); form.classList.add('!border-cyan-400'); });
      form.addEventListener('dragleave', () => form.classList.remove('!border-cyan-400'));
      form.addEventListener('drop', (e) => {
        e.preventDefault();
        form.classList.remove('!border-cyan-400');
        if (e.dataTransfer.files[0]) { form.file.files = e.dataTransfer.files; toast(`${e.dataTransfer.files[0].name} bereit zum Hochladen`); }
      });
    }
  }

  function viewDoc(doc) {
    const url = `/files/${doc.filename}`;
    openModal({
      title: doc.title || doc.original_name, subtitle: DOC_KINDS[doc.kind], size: 'full',
      body: doc.mime && doc.mime.startsWith('image/')
        ? html`<img src="${url}" class="max-w-full mx-auto rounded-lg" alt="">`
        : html`<iframe src="${url}" class="w-full h-[70vh] rounded-lg bg-white" title="PDF"></iframe>`,
      footer: html`<a class="btn" href="${url}" target="_blank" rel="noopener">${icon('download')} Original öffnen</a>`
    });
  }

  /* ---------------- Daten & TÜV (Admin-Konverter) ---------------- */
  function tabData() {
    const v = data.vehicle;
    const specs = v.wheel_specs.length ? v.wheel_specs : [];
    const images = data.documents.filter((d) => d.mime && d.mime.startsWith('image/'));
    const tuev = tuevInfo(v.tuev_until);
    if (!isAdmin()) {
      setHTML(content, html`
        <div class="grid sm:grid-cols-3 gap-3 mb-4">
          ${kpi('TÜV bis', tuev ? tuev.label : 'k. A.', tuev ? tuev.cls : 'text-slate-500')}
          ${kpi('Kennzeichen', v.plate || 'k. A.', 'text-white')}
          ${kpi('FIN', v.vin || 'k. A.', 'text-white font-mono text-sm')}
        </div>
        <h4 class="font-display text-xs tracking-[0.2em] text-slate-400 mb-2">RAD-REIFEN-KOMBINATIONEN</h4>
        <div class="space-y-1.5">${specs.map((s) => html`<div class="card px-3 py-2 text-sm flex gap-3"><span class="chip">${s.axle || 'VA/HA'}</span><span class="text-white">${s.rim}</span><span class="text-cyan-300">${s.tire}</span><span class="text-slate-500">${s.note || ''}</span></div>`)}
        ${!specs.length ? html`<p class="text-sm text-slate-500">Keine Einträge.</p>` : ''}</div>
        ${v.spec_notes ? html`<div class="card p-3 mt-4 text-sm text-slate-300 whitespace-pre-wrap">${v.spec_notes}</div>` : ''}
        <p class="text-[11px] text-slate-500 mt-4">Pflege dieser Daten über den Admin-Konverter.</p>`);
      return;
    }
    setHTML(content, html`
      <p class="text-sm text-slate-400 mb-3">${icon('zap', 'w-4 h-4 inline text-cyan-300')} Konverter: Links Fahrzeugschein oder Gutachten ansehen, rechts die Werte in Textform übertragen. So bleiben Rad-Reifen-Kombis und TÜV durchsuchbar.</p>
      <div class="grid lg:grid-cols-2 gap-4">
        <div class="card p-3">
          <select class="select mb-2" data-docpick>
            ${images.map((d) => html`<option value="${d.filename}">${DOC_KINDS[d.kind] || d.kind}: ${d.title || d.original_name}</option>`)}
            ${!images.length ? html`<option value="">Kein Bild hochgeladen</option>` : ''}
          </select>
          <div class="rounded-lg bg-black/50 overflow-auto h-[360px] grid place-items-center" data-docview>
            ${images.length ? html`<img src="/files/${images[0].filename}" class="max-w-none origin-top-left" style="width:100%" data-docimg alt="">` : html`<span class="text-slate-500 text-sm">Lade zuerst ein Foto im Tab „Dokumente“ hoch.</span>`}
          </div>
          <label class="flex items-center gap-2 mt-2 text-xs text-slate-400">Zoom <input type="range" min="100" max="400" value="100" class="flex-1" data-doczoom></label>
        </div>
        <form class="space-y-3" data-form="specs">
          <div class="grid grid-cols-2 gap-2">
            <label><span class="label">Kennzeichen</span><input class="input font-mono" name="plate" value="${v.plate || ''}"></label>
            <label><span class="label">TÜV / HU bis</span><input class="input" type="month" name="tuev_until" value="${(v.tuev_until || '').slice(0, 7)}"></label>
            <label class="col-span-2"><span class="label">FIN</span><input class="input font-mono" name="vin" value="${v.vin || ''}" maxlength="17"></label>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1"><span class="label !mb-0">Rad-Reifen-Kombinationen</span><button type="button" class="btn btn-sm" data-addspec>${icon('plus', 'w-3 h-3')} Zeile</button></div>
            <div class="space-y-2" data-specs>
              ${(specs.length ? specs : [{ axle: '', rim: '', tire: '', note: '' }]).map((s) => specRow(s))}
            </div>
          </div>
          <label class="block"><span class="label">Eintragungen / Notizen (Gutachten, Auflagen)</span>
            <textarea class="input" rows="4" name="spec_notes" placeholder="z. B. Fahrwerk KW V1 eingetragen, Auflage A04 …">${v.spec_notes || ''}</textarea></label>
          <button class="btn btn-primary w-full">${icon('check')} Daten speichern</button>
        </form>
      </div>`);
  }

  const specRow = (s) => html`
    <div class="grid grid-cols-[70px_1fr_1fr_auto] gap-1.5" data-specrow>
      <select class="select !px-1.5 text-sm" data-k="axle">${['', 'VA', 'HA', 'VA+HA'].map((a) => html`<option ${s.axle === a ? 'selected' : ''} value="${a}">${a || 'Achse'}</option>`)}</select>
      <input class="input text-sm" placeholder="Felge 8,5x18 ET35" value="${s.rim || ''}" data-k="rim">
      <input class="input text-sm" placeholder="Reifen 235/40 R18" value="${s.tire || ''}" data-k="tire">
      <button type="button" class="btn-icon !w-8" data-delspec>${icon('x', 'w-3.5 h-3.5')}</button>
      <input class="input text-xs col-span-4 !py-1" placeholder="Notiz / Auflage" value="${s.note || ''}" data-k="note">
    </div>`;

  /* ---------------- Teile ---------------- */
  function tabParts() {
    setHTML(content, html`
      ${canEdit() ? html`<button class="btn btn-primary mb-3" data-newpart>${icon('plus')} Teil für dieses Auto</button>` : ''}
      <div class="space-y-1.5">
        ${data.parts.map((p) => html`
          <div class="card px-3 py-2 flex items-center gap-3 text-sm">
            <span class="font-mono text-xs text-slate-400 w-8">${p.qty}×</span>
            <div class="flex-1 min-w-0"><div class="text-white truncate">${p.name}</div>
              <div class="text-[11px] text-slate-500">${p.category || ''} · ${p.condition || ''}</div></div>
            ${p.event_relevant ? html`<span class="chip !text-amber-200 !border-amber-400/40">${icon('flag', 'w-3 h-3')} Event</span>` : ''}
            ${p.shelf_id ? html`<button class="chip chip-btn" data-goshelf="${p.shelf_id}" data-level="${p.level || ''}" data-box="${p.box_id || ''}" data-part="${p.id}">${icon('target', 'w-3 h-3')} ${p.shelf_code}${p.level ? `·E${p.level}` : ''}${p.box_label ? ` · ${p.box_label}` : ''}</button>` : html`<span class="chip">kein Ort</span>`}
          </div>`)}
        ${!data.parts.length ? html`<p class="text-sm text-slate-500">Diesem Auto sind keine Teile zugeordnet.</p>` : ''}
      </div>`);
  }

  /* ---------------- Events ---------------- */
  function tabEvents() {
    setHTML(content, html`
      <div class="space-y-2">
        ${data.events.map((e) => {
          const d = daysUntil(e.date_start);
          return html`<button class="card card-hover w-full text-left px-3 py-3 flex items-center gap-3" data-openevent="${e.id}">
            <span class="text-cyan-300">${icon('flag')}</span>
            <div class="flex-1"><div class="font-semibold text-white">${e.name}</div><div class="text-xs text-slate-400">${fmtDate(e.date_start)}${e.location ? ` · ${e.location}` : ''}</div></div>
            <span class="chip ${d < 0 ? '' : '!text-cyan-200 !border-cyan-400/40'}">${countdownLabel(d)}</span>
          </button>`;
        })}
        ${!data.events.length ? html`<p class="text-sm text-slate-500">Nimmt an keinem Event teil.</p>` : ''}
      </div>`);
  }

  /* ---------------- v4.1: Setup & Maße ---------------- */
  function tabSetup() {
    const v = data.vehicle;
    setHTML(content, html`
      <form data-form="dims" class="mb-6">
        ${dimsFields(v, { readonly: !canEdit() })}
        ${canEdit() ? html`<div class="flex justify-end mt-3"><button class="btn btn-primary">${icon('check')} Maße speichern</button></div>` : ''}
      </form>
      <div data-setupwrap></div>`);
    bindDims(content.querySelector('[data-form="dims"]'));
    renderSetupTab(content.querySelector('[data-setupwrap]'), { vehicle: v });
  }

  /* ---------------- Einstellungen ---------------- */
  function tabEdit() {
    const v = data.vehicle;
    setHTML(content, vehicleFormFields(v, { readonly: !canEdit() }));
    if (canEdit()) bindColorPresets(content);
    const go = content.querySelector('[data-goto-dims]');
    if (go) go.addEventListener('click', () => { current = 'setup'; renderTab(); });
  }

  /* ---------------- Events binden ---------------- */
  on(tabsEl, 'click', '[data-tab]', (_e, b) => { current = b.dataset.tab; renderTab(); });

  on(head, 'click', '[data-status-key]', async (_e, b) => {
    try { await put(`/vehicles/${id}`, { status: b.dataset.statusKey }); haptic(10); await reload(); refreshWhiteboard(); } catch (err) { toastError(err); }
  });
  on(head, 'click', '[data-quick]', async (_e, b) => {
    const q = b.dataset.quick;
    const v = data.vehicle;
    if (q === 'work') { openWorkDialog(v.id); }
    if (q === 'map') { m.close(); app.setMobileView && app.setMobileView('map'); app.map.focusVehicle(v.id); }
    if (q === 'wheels') app.openTyreHub({ vehicleId: v.id });
    if (q === 'burn') app.burnTyres(v.id);
    if (q === 'qr') printLabels([{ kind: 'car', id: v.id, title: v.name, subtitle: `${modelInfo(v.model).label}${v.plate ? ` · ${v.plate}` : ''}`, kicker: 'FAHRZEUG', color: v.color }], { title: 'QR-Code: Fahrzeug' });
    if (q === 'move') {
      const slots = store.objects.filter((o) => o.type === 'slot');
      const choices = [...slots.map((s) => `${s.code} · ${s.label || ''}`), 'Außerhalb / Paddock'];
      const pick = await chooseDialog({ title: 'Umparken', text: 'Wohin soll das Auto?', choices, allowText: false });
      if (!pick) return;
      if (pick.startsWith('Außerhalb')) await app.moveVehicle(v, { kind: 'extern' });
      else {
        const slot = slots.find((s) => pick.startsWith(`${s.code} ·`));
        const occupants = store.vehicles.filter((x) => x.slot_id === slot.id && x.id !== v.id);
        await app.moveVehicle(v, { kind: 'slot', slot, occupants, full: occupants.length >= (Number(slot.props.capacity) || 1) });
      }
      await reload({ vehiclesToo: false });
    }
    if (q === 'swaplevel') {
      try {
        const vehicles = await post(`/vehicles/${v.id}/move`, { slotId: v.slot_id, slotPos: v.slot_pos === 0 ? 1 : 0, swap: true });
        store.vehicles = vehicles;
        refreshVehicles();
        await reload({ vehiclesToo: false });
        toast('Oben und unten getauscht.', 'ok');
      } catch (err) { toastError(err); }
    }
  });

  on(content, 'input', '[data-logsearch]', (_e, inp) => {
    logQuery = inp.value;
    setHTML(content.querySelector('[data-loglist]'), logList());
  });
  on(content, 'input', '[data-doczoom]', (_e, r) => { const img = content.querySelector('[data-docimg]'); if (img) img.style.width = `${r.value}%`; });
  on(content, 'change', '[data-docpick]', (_e, s) => { const img = content.querySelector('[data-docimg]'); if (img && s.value) img.src = `/files/${s.value}`; });
  on(content, 'click', '[data-addspec]', () => content.querySelector('[data-specs]').appendChild(el(specRow({}))));
  on(content, 'click', '[data-delspec]', (_e, b) => b.closest('[data-specrow]').remove());

  on(content, 'click', 'button', async (e, b) => {
    const ds = b.dataset;
    try {
      if (ds.done) {
        haptic([10, 30, 10]);
        const mileage = content.querySelector('[data-mileage]');
        await post(`/tasks/${ds.done}/done`, { mileage: mileage && mileage.value ? Number(mileage.value) : null });
        const t = data.tasks.find((x) => x.id === Number(ds.done));
        toast(t && t.cost ? `Erledigt: Wartungsheft und Budget (${euro(t.cost)}) aktualisiert.` : 'Erledigt und ins Wartungsheft übertragen.', 'ok');
        await reload(); refreshWhiteboard();
      } else if (ds.taskcost) {
        const t = data.tasks.find((x) => x.id === Number(ds.taskcost));
        const REMOVE = 'Preis entfernen';
        const val = await chooseDialog({ title: 'Preis der Aufgabe', text: `${t ? t.title : ''}: Betrag in Euro. Er erscheint automatisch im Budget unter „Noch zu kaufen“ und wandert beim Abhaken nach „Bereits gekauft“.`,
          choices: t && t.cost ? [REMOVE] : [], allowText: true, placeholder: t && t.cost ? `aktuell ${String(t.cost).replace('.', ',')} €` : 'z. B. 89,90', okLabel: 'Übernehmen' });
        if (val === null || val === undefined) return;
        const cost = val === REMOVE ? '' : String(val).replace(/[€\s]/g, '');
        if (cost && !(Number(cost.replace(',', '.')) > 0)) { toast('Bitte einen Betrag eingeben, z. B. 89,90.', 'warn'); return; }
        await put(`/tasks/${ds.taskcost}`, { cost });
        toast(cost ? 'Preis gespeichert und im Budget geführt.' : 'Preis entfernt.', 'ok');
        await reload();
      } else if (ds.worktask) {
        await post('/work', { task_id: Number(ds.worktask), vehicle_id: id });
        toast('Eingetragen: du schraubst daran.', 'ok');
        await reload(); refreshWhiteboard();
      } else if (ds.deltask) {
        if (!(await confirmDialog('Aufgabe löschen?', { danger: true, okLabel: 'Löschen' }))) return;
        await del(`/tasks/${ds.deltask}`); await reload(); refreshWhiteboard();
      } else if (ds.reopen) {
        await post(`/tasks/${ds.reopen}/reopen`); await reload(); refreshWhiteboard();
      } else if (ds.dellog) {
        if (!(await confirmDialog('Eintrag aus dem Wartungsheft löschen?', { danger: true, okLabel: 'Löschen' }))) return;
        await del(`/log/${ds.dellog}`); await reload({ vehiclesToo: false });
      } else if (ds.buytoggle) {
        await put(`/purchases/${ds.buytoggle}`, { status: ds.to }); haptic(8); await reload();
      } else if (ds.delbuy) {
        await del(`/purchases/${ds.delbuy}`); await reload();
      } else if (ds.viewdoc) {
        viewDoc(data.documents.find((d) => d.id === Number(ds.viewdoc)));
      } else if (ds.deldoc) {
        if (!(await confirmDialog('Dokument endgültig löschen?', { danger: true, okLabel: 'Löschen' }))) return;
        await del(`/documents/${ds.deldoc}`); await reload({ vehiclesToo: false });
      } else if ('newpart' in ds) {
        app.openPartForm({ vehicle_id: id }, () => reload({ vehiclesToo: false }));
      } else if (ds.goshelf) {
        m.close();
        app.navigate({ kind: 'shelf', shelfId: Number(ds.goshelf), level: Number(ds.level) || null, boxId: Number(ds.box) || null, highlight: `part:${ds.part}` });
      } else if (ds.openevent) {
        app.navigate({ kind: 'event', eventId: Number(ds.openevent) });
      } else if (ds.deletevehicle) {
        if (!(await confirmDialog(`„${data.vehicle.name}“ inklusive Aufgaben, Wartungsheft und Dokumenten löschen?`, { danger: true, okLabel: 'Endgültig löschen' }))) return;
        await del(`/vehicles/${id}`); m.close(); await refreshVehicles(); refreshWhiteboard(); toast('Fahrzeug gelöscht.');
      }
    } catch (err) { toastError(err); }
  });

  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    try {
      if (kind === 'task') {
        await post('/tasks', { ...formData(form), vehicle_id: id });
        haptic(8); await reload(); refreshWhiteboard();
      } else if (kind === 'log') {
        await post('/log', { ...formData(form), vehicle_id: id });
        toast(form.cost && Number(String(form.cost.value).replace(',', '.')) > 0 ? 'Ins Wartungsheft eingetragen, Kosten stehen im Budget.' : 'Ins Wartungsheft eingetragen.', 'ok'); await reload();
      } else if (kind === 'buy') {
        await post('/purchases', { ...formData(form), vehicle_id: id });
        await reload();
      } else if (kind === 'doc') {
        const fd = new FormData(form);
        if (!form.file.files.length) return;
        const btn = form.querySelector('button');
        btn.disabled = true; btn.textContent = 'Lädt hoch …';
        await upload(`/vehicles/${id}/documents`, fd);
        toast('Dokument gespeichert.', 'ok'); await reload({ vehiclesToo: false });
      } else if (kind === 'specs') {
        const rows = [...form.querySelectorAll('[data-specrow]')].map((r) => Object.fromEntries([...r.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value])));
        const f = formData(form);
        await put(`/vehicles/${id}/specs`, { tuev_until: f.tuev_until, vin: f.vin, plate: f.plate, spec_notes: f.spec_notes, wheel_specs: rows });
        toast('Daten übertragen und gespeichert.', 'ok'); await reload();
      } else if (kind === 'dims') {
        await put(`/vehicles/${id}`, dimsPayload(form));
        toast('Maße gespeichert. Der Anhänger-Check rechnet ab jetzt mit den Radmaßen.', 'ok', 4000);
        await reload();
      } else if (kind === 'vehicle') {
        await put(`/vehicles/${id}`, formData(form));
        toast('Gespeichert.', 'ok'); await reload();
      }
    } catch (err) { toastError(err); }
  });

  renderHead();
  renderTab();
}

/* ====================================================================== */
/* Fahrzeug-Formular (Einstellungen + Neues Auto)                         */
/* ====================================================================== */
function vehicleFormFields(v = {}, { readonly = false, isNew = false } = {}) {
  const dis = readonly ? 'disabled' : '';
  return html`
    <form class="grid sm:grid-cols-2 gap-3" data-form="vehicle">
      <label class="sm:col-span-2"><span class="label">Name</span><input class="input" name="name" value="${v.name || ''}" required ${dis} placeholder="z. B. E36 Drift Coupé"></label>
      <label><span class="label">Modell / Sprite</span>
        <select class="select" name="model" ${dis} data-modelselect>
          <optgroup label="Standardmodelle">${Object.entries(store.meta.models).filter(([, mm]) => mm.builtin !== false).map(([k, mm]) => html`<option value="${k}" ${v.model === k ? 'selected' : ''}>${mm.label}</option>`)}</optgroup>
          ${Object.values(store.meta.models).some((mm) => mm.builtin === false) ? html`<optgroup label="Eigene Modelle">${Object.entries(store.meta.models).filter(([, mm]) => mm.builtin === false).map(([k, mm]) => html`<option value="${k}" ${v.model === k ? 'selected' : ''}>${mm.label}</option>`)}</optgroup>` : ''}
        </select>
        ${isAdmin() && !readonly ? html`<span class="text-[10px] text-slate-500">Modell fehlt? Admin-Konsole &gt; Fahrzeug-Modelle</span>` : ''}</label>
      <label><span class="label">Kennzeichen</span><input class="input font-mono" name="plate" value="${v.plate || ''}" ${dis}></label>
      <div class="sm:col-span-2"><span class="label">Farbe</span>
        <div class="flex flex-wrap items-center gap-2">
          <input type="color" class="input !w-16" name="color" value="${v.color || '#9ca3af'}" ${dis} data-colorinput>
          ${readonly ? '' : COLOR_PRESETS.map((c) => html`<button type="button" class="w-7 h-7 rounded-full ring-2 ring-white/10 hover:ring-white/60" style="background:${c}" data-preset="${c}" title="${c}"></button>`)}
        </div></div>
      <label><span class="label">Kilometerstand</span><input class="input" type="number" name="mileage" value="${v.mileage || ''}" ${dis}></label>
      ${isNew ? dimsFields(v, { readonly })
        : html`<p class="sm:col-span-2 text-xs text-slate-400 -mt-1">${icon('target', 'w-3.5 h-3.5 inline text-cyan-300')} Gewicht, Radstand und Spurweiten stehen im Reiter <button type="button" class="text-cyan-300 underline" data-goto-dims>Setup &amp; Maße</button>.</p>`}
      <label><span class="label">Status</span>
        <select class="select" name="status" ${dis}>${Object.entries(store.meta.status).map(([k, s]) => html`<option value="${k}" ${v.status === k ? 'selected' : ''}>${s.label}</option>`)}</select></label>
      ${!v.slot_id ? html`<label class="sm:col-span-2"><span class="label">Standort außerhalb</span><input class="input" name="extern_location" value="${v.extern_location || 'Paddock'}" ${dis} list="externList">
        <datalist id="externList"><option>Paddock</option><option>Auf dem Hänger</option><option>Beim Kumpel</option><option>Beim Lackierer</option><option>Unterwegs</option></datalist></label>` : ''}
      <label class="sm:col-span-2"><span class="label">Notizen</span><textarea class="input" rows="3" name="notes" ${dis}>${v.notes || ''}</textarea></label>
      ${readonly ? '' : html`
        <div class="sm:col-span-2 flex flex-wrap gap-2 justify-between pt-1">
          ${!isNew && isAdmin() ? html`<button type="button" class="btn btn-danger" data-deletevehicle="1">${icon('trash')} Fahrzeug löschen</button>` : html`<span></span>`}
          <button class="btn btn-primary">${icon('check')} ${isNew ? 'Anlegen' : 'Speichern'}</button>
        </div>`}
    </form>`;
}

function bindColorPresets(root) {
  on(root, 'click', '[data-preset]', (_e, b) => { root.querySelector('[data-colorinput]').value = b.dataset.preset; haptic(5); });
}

export function openVehicleForm() {
  const body = el(html`<div>${vehicleFormFields({ model: 'e46_coupe', color: '#f5c518', status: 'ready', extern_location: 'Paddock' }, { isNew: true })}</div>`);
  const m = openModal({ title: 'Neues Auto', subtitle: 'Startet im Paddock und kann direkt in die Halle gezogen werden', size: 'md', iconName: 'car', body });
  bindColorPresets(body);
  bindDims(body);
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const v = await post('/vehicles', formData(e.target));
      m.close();
      await refreshVehicles();
      toast(`${v.name} steht im Paddock. Einfach auf einen freien Platz ziehen!`, 'ok', 4500);
      app.map.focusVehicle(v.id);
    } catch (err) { toastError(err); }
  });
}

/* ====================================================================== */
/* Fuhrpark-Panel (rechte Seitenleiste)                                   */
/* ====================================================================== */
export function renderFleetPanel(container) {
  const inside = store.vehicles.filter((v) => v.slot_id);
  const outside = store.vehicles.filter((v) => !v.slot_id);
  const row = (v) => {
    const st = statusInfo(v.status);
    return html`
      <button class="card card-hover w-full text-left p-2.5 flex items-center gap-3" data-vehicle="${v.id}">
        <img src="${carThumb(modelInfo(v.model), v.color, { w: 84, h: 40, status: st.color })}" class="w-[84px] h-[40px] shrink-0" alt="">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white text-sm truncate">${v.name}</div>
          <div class="text-[11px] text-slate-400 truncate">${vehicleLocationLabel(v)}</div>
          <div class="flex flex-wrap gap-1 mt-1">
            <span class="chip !text-[10px]" style="color:${st.color};border-color:${st.color}55"><span class="dot" style="background:${st.color}"></span>${st.label}</span>
            ${v.open_tasks ? html`<span class="chip !text-[10px] !text-amber-200">${v.open_tasks} offen</span>` : ''}
            ${v.next_event ? html`<span class="chip !text-[10px] !text-cyan-200">${icon('flag', 'w-3 h-3')} ${countdownLabel(daysUntil(v.next_event.date_start))}</span>` : ''}
          </div>
        </div>
      </button>`;
  };
  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div><h3 class="font-display font-bold tracking-wider text-white">Fuhrpark</h3><p class="text-xs text-slate-500">${store.vehicles.length} Fahrzeuge · ${inside.length} in der Halle</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-newvehicle>${icon('plus')} Auto</button>` : ''}
      </div>
      <section><h4 class="font-display text-[11px] tracking-[0.2em] text-slate-400 mb-2">IN DER HALLE</h4><div class="space-y-2">${inside.map(row)}</div></section>
      <section><h4 class="font-display text-[11px] tracking-[0.2em] text-amber-300 mb-2">UNTERWEGS · PADDOCK</h4><div class="space-y-2">${outside.map(row)}
        ${!outside.length ? html`<p class="text-sm text-slate-500">Alle Autos sind in der Halle.</p>` : ''}</div></section>
    </div>`);
  if (!container.dataset.boundFleet) {
    container.dataset.boundFleet = '1';
    on(container, 'click', '[data-vehicle]', (_e, b) => app.navigate({ kind: 'vehicle', vehicleId: Number(b.dataset.vehicle) }));
    on(container, 'click', '[data-newvehicle]', () => openVehicleForm());
  }
}
