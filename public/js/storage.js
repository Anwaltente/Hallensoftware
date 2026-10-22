/**
 * Lager-Radar: Regale & Euroboxen (Frontansicht), Ersatzteile, Werkzeug-Radar mit Verleih und Wunschliste.
 * v4: Überall 1-Tap "Rausgeholt" (Schwebe-Status) für Werkzeug, Kisten und Teile.
 */
import { store, app, canEdit, isAdmin, refreshAll } from './state.js';
import { get, post, put, del } from './api.js';
import { printLabels } from './qr.js';
import { floatBtn, floatOf } from './hud.js';   // v4: Schwebe-Status
import { ratchet, coin, buzz } from './sfx.js';
import { track } from './track.js';   // v5.3: Aktivitäts-Log
import { html, setHTML, el, on, icon, toast, toastError, haptic, euro, since, openModal, confirmDialog, chooseDialog, formData, initials, fmtDate } from './ui.js';

const CONDITIONS = ['neu', 'gebraucht', 'aufbereitet', 'defekt'];
const BOX_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#9ca3af', '#0f172a'];

/* ====================================================================== */
/* Lager-Panel                                                            */
/* ====================================================================== */
const lagerState = { q: '', filter: 'all', vehicle: '', showAll: false };

export async function renderLagerPanel(container) {
  const shelves = store.objects.filter((o) => o.type === 'shelf').sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const phone = isPhone();   // v5.3: am Handy Akkordeon statt Regal-Kacheln + langer Liste
  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div><h3 class="font-display font-bold tracking-wider text-white">Lager-Radar</h3><p class="text-xs text-slate-500">Regale, Euroboxen, Ersatzteile</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-lg-newpart>${icon('plus')} Teil</button>` : ''}
      </div>
      ${phone ? html`<div class="acc-wrap card !p-0 overflow-hidden" data-lg-acc></div>` : html`
      <div class="grid grid-cols-2 gap-2">
        ${shelves.map((s) => html`
          <button class="card card-hover p-3 text-left" data-lg-shelf="${s.id}">
            <div class="flex items-center gap-2 mb-2">${icon('shelf', 'w-4 h-4 text-sky-300')}<span class="font-display font-bold text-white">${s.label || `Regal ${s.code}`}</span></div>
            <div class="space-y-1">${Array.from({ length: Number(s.props.levels) || 4 }, (_, i) => html`<div class="h-2 rounded-sm bg-slate-700/70 border-b-2 border-slate-500/60"></div>`)}</div>
            <div class="text-[10px] text-slate-500 mt-2">${Number(s.props.levels) || 4} Etagen · Frontansicht öffnen</div>
          </button>`)}
      </div>`}
      <div class="space-y-2">
        <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">${icon('search')}</span>
          <input class="input !pl-9" placeholder="Teile suchen …" value="${lagerState.q}" data-lg-q></div>
        <div class="flex flex-wrap gap-1.5">
          ${[['all', 'Alle'], ['event', 'Event-relevant'], ['universal', 'Universal'], ['loose', 'Ohne Lagerort']].map(([k, l]) => html`<button class="chip chip-btn ${lagerState.filter === k ? 'on' : ''}" data-lg-filter="${k}">${l}</button>`)}
          <select class="select !w-auto !py-1 text-xs" data-lg-vehicle><option value="">Alle Autos</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${String(lagerState.vehicle) === String(v.id) ? 'selected' : ''}>${v.name}</option>`)}</select>
        </div>
      </div>
      <div data-lg-list class="space-y-1.5"><p class="text-sm text-slate-500">Lädt …</p></div>
    </div>`);
  if (!container.dataset.boundLager) {
    container.dataset.boundLager = '1';
    on(container, 'click', '[data-lg-shelf]', (_e, b) => app.navigate({ kind: 'shelf', shelfId: Number(b.dataset.lgShelf) }));
    on(container, 'click', '[data-lg-newpart]', () => openPartForm({}, () => loadParts(container)));
    on(container, 'input', '[data-lg-q]', (_e, inp) => { lagerState.q = inp.value; clearTimeout(container._t); container._t = setTimeout(() => loadParts(container), 180); });
    on(container, 'click', '[data-lg-filter]', (_e, b) => { lagerState.filter = b.dataset.lgFilter; container.querySelectorAll('[data-lg-filter]').forEach((x) => x.classList.toggle('on', x === b)); loadParts(container); });
    on(container, 'change', '[data-lg-vehicle]', (_e, s) => { lagerState.vehicle = s.value; loadParts(container); });
    on(container, 'click', '[data-lg-showall]', () => { lagerState.showAll = true; loadParts(container); });
    on(container, 'click', '[data-lg-part]', async (e, b) => {
      if (e.target.closest('[data-lg-goto]') || e.target.closest('[data-lg-acc]')) return;
      const parts = await get(`/parts?q=`);
      openPartForm(parts.find((p) => p.id === Number(b.dataset.lgPart)), () => loadParts(container));
    });
    on(container, 'click', '[data-lg-goto]', (e, b) => {
      e.stopPropagation();
      app.navigate({ kind: 'shelf', shelfId: Number(b.dataset.lgGoto), level: Number(b.dataset.level) || null, boxId: Number(b.dataset.box) || null, highlight: `part:${b.dataset.part}` });
    });
  }
  if (phone) {
    const acc = container.querySelector('[data-lg-acc]');
    if (acc) renderShelfAccordion(acc, {});
  }
  loadParts(container);
}

async function loadParts(container) {
  const list = container.querySelector('[data-lg-list]');
  if (!list) return;
  const qs = new URLSearchParams();
  if (lagerState.q) qs.set('q', lagerState.q);
  if (lagerState.vehicle) qs.set('vehicleId', lagerState.vehicle);
  if (lagerState.filter === 'event') qs.set('event', '1');
  let parts = [];
  try { parts = await get(`/parts?${qs}`); } catch (err) { toastError(err); return; }
  if (lagerState.filter === 'universal') parts = parts.filter((p) => p.universal);
  if (lagerState.filter === 'loose') parts = parts.filter((p) => !p.shelf_id);
  // v5.3: am Handy die komplette Liste erst auf Wunsch (Suche, Filter oder Knopf), sonst endloses Scrollen
  if (isPhone() && !lagerState.q && lagerState.filter === 'all' && !lagerState.vehicle && !lagerState.showAll && parts.length > 6) {
    setHTML(list, html`<button class="btn w-full" data-lg-showall>${icon('list', 'w-4 h-4')} Alle ${parts.length} Teile als Liste zeigen</button>
      <p class="text-[11px] text-slate-500 text-center">Tipp: oben im Regal aufklappen oder suchen.</p>`);
    return;
  }
  setHTML(list, html`
    <div class="text-[11px] text-slate-500">${parts.length} Teile</div>
    ${parts.map((p) => partRow(p))}
    ${!parts.length ? html`<p class="text-sm text-slate-500">Keine Treffer.</p>` : ''}`);
}

function assignLabel(p) {
  if (p.universal) return html`<span class="chip !text-[10px] !text-lime-200 !border-lime-400/40">Universal</span>`;
  if (p.vehicle_name) return html`<span class="chip !text-[10px]">${p.vehicle_name}</span>`;
  if (p.foreign_model) return html`<span class="chip !text-[10px] !text-amber-200">für ${p.foreign_model}</span>`;
  return '';
}

function partRow(p, { compact = false } = {}) {
  const fmtN = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return html`
    <div class="card card-hover px-3 py-2 flex items-center gap-2.5 cursor-pointer" data-lg-part="${p.id}" data-partrow="${p.id}">
      <span class="font-mono text-xs ${p.pack_size && !p.qty ? 'text-rose-300' : 'text-slate-400'} w-7 shrink-0">${p.qty}×</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-white truncate">${p.name}</div>
        <div class="flex flex-wrap gap-1 mt-0.5">${p.pack_size ? html`<span class="chip !text-[10px] !text-cyan-200 !border-cyan-400/40">${fmtN(p.pack_size)} ${p.pack_unit || ''} je Gebinde</span>` : ''}
          ${p.consumable_name ? html`<span class="chip !text-[10px] !text-rose-200 !border-rose-400/40">${icon('alert', 'w-2.5 h-2.5')} ${p.consumable_name}</span>` : ''}
          ${p.open_rest !== null && p.open_rest !== undefined && p.qty > 0 ? html`<span class="chip !text-[10px] !text-amber-200">angebrochen: ${fmtN(p.open_rest)} ${p.pack_unit || ''}</span>` : ''}
          ${assignLabel(p)}
          ${p.event_relevant ? html`<span class="chip !text-[10px] !text-amber-200 !border-amber-400/40">${icon('flag', 'w-2.5 h-2.5')} Event</span>` : ''}
          ${p.condition && p.condition !== 'neu' ? html`<span class="chip !text-[10px]">${p.condition}</span>` : ''}</div>
      </div>
      ${!compact ? (p.shelf_id ? html`<button class="chip chip-btn !text-[10px] shrink-0" data-lg-goto="${p.shelf_id}" data-level="${p.level || ''}" data-box="${p.box_id || ''}" data-part="${p.id}">${icon('target', 'w-3 h-3')} ${p.shelf_code}${p.level ? `·E${p.level}` : ''}${p.box_label ? html` <span class="dot" style="background:${p.box_color}"></span>` : ''}</button>` : html`<span class="chip !text-[10px] shrink-0">kein Ort</span>`) : ''}
      ${floatBtn('part', p.id, { small: true, text: false })}
    </div>`;
}

/* ====================================================================== */
/* Regal-Frontansicht                                                     */
/* ====================================================================== */
export async function openShelf(shelfId, { level = null, boxId = null, highlight = null } = {}) {
  // v5.3: am Handy kompaktes Akkordeon statt Frontansicht (kein endloses Scrollen)
  if (isPhone()) return openShelfAccordion(shelfId, { level, boxId, highlight });
  let data;
  try { data = await get(`/shelves/${shelfId}`); } catch (err) { toastError(err); return; }
  track(`Öffnete ${data.shelf.label || `Regal ${data.shelf.code}`}`, 'open');
  let selectedBox = boxId || null;
  const body = el(html`<div class="grid lg:grid-cols-[1fr_320px] gap-4"><div data-front></div><div data-detail></div></div>`);
  const m = openModal({ title: data.shelf.label || `Regal ${data.shelf.code}`, subtitle: 'Frontansicht · Etage 1 = unten', size: 'xl', iconName: 'shelf', body });
  const front = body.querySelector('[data-front]');
  const detail = body.querySelector('[data-detail]');

  async function reload() { data = await get(`/shelves/${shelfId}`); render(); }

  function render() {
    const levels = Number(data.shelf.props.levels) || 4;
    const rows = [];
    for (let l = levels; l >= 1; l -= 1) rows.push(l);
    setHTML(front, html`
      <div class="shelf-frame p-3">
        ${rows.map((l) => {
          const boxes = data.boxes.filter((b) => b.level === l);
          const loose = data.parts.filter((p) => p.level === l && !p.box_id);
          const looseTools = data.tools.filter((t) => t.level === l && !t.box_id);
          return html`
            <div class="shelf-level flex items-end gap-2 px-2 pt-3 pb-2 ${level === l ? 'bg-cyan-400/5' : ''}" data-level="${l}">
              <div class="w-8 shrink-0 self-center font-display font-bold text-slate-500 text-sm">E${l}</div>
              <div class="flex flex-wrap items-end gap-2 flex-1 min-h-[70px]">
                ${boxes.map((b) => {
                  const count = data.parts.filter((p) => p.box_id === b.id).length + data.tools.filter((t) => t.box_id === b.id).length;
                  return html`<button class="eurobox ${selectedBox === b.id ? 'ring-2 ring-cyan-300' : ''}" style="--bc:${b.color}" data-box="${b.id}" title="${b.label}">
                    <span class="handle"></span><span class="tag">${b.label}</span>
                    <div class="text-[10px] font-semibold mt-1 opacity-80">${count} Teile</div></button>`;
                })}
                ${[...loose.map((p) => html`<span class="chip !bg-slate-800 cursor-pointer" data-loosepart="${p.id}" data-partchip="part:${p.id}">${icon('box', 'w-3 h-3')} ${p.qty}× ${p.name}</span>`),
                  ...looseTools.map((t) => html`<span class="chip !bg-slate-800 !text-sky-200" data-partchip="tool:${t.id}">${icon('wrench', 'w-3 h-3')} ${t.name}</span>`)]}
                ${!boxes.length && !loose.length && !looseTools.length ? html`<span class="text-xs text-slate-600 italic">leer</span>` : ''}
              </div>
              ${isAdmin() ? html`<button class="btn-icon !w-7 !h-7 shrink-0" data-addbox="${l}" title="Eurobox auf Etage ${l}">${icon('plus', 'w-3.5 h-3.5')}</button>` : ''}
            </div>`;
        })}
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-3 text-sm">
        ${isAdmin() ? html`<span class="text-slate-400">Etagen:</span>
          <button class="btn btn-sm" data-levels="-1">-</button><span class="font-display font-bold text-white">${levels}</span><button class="btn btn-sm" data-levels="1">+</button>` : ''}
        ${data.boxes.length ? html`<button class="btn btn-sm ml-auto" data-qrall>${icon('qr')} Alle Box-Labels drucken</button>` : ''}
      </div>`);
    renderDetail();
  }

  function renderDetail() {
    const box = data.boxes.find((b) => b.id === selectedBox);
    if (!box) {
      setHTML(detail, html`<div class="card p-4 text-sm text-slate-400">
        <div class="font-display text-white font-bold mb-1">${icon('box', 'w-4 h-4 inline text-cyan-300')} Eurobox wählen</div>
        Tippe auf eine Box, um den Inhalt zu sehen. Lose Teile liegen direkt auf der Etage.
        ${canEdit() ? html`<button class="btn btn-sm w-full mt-3" data-newpart-shelf>${icon('plus')} Teil in dieses Regal</button>` : ''}
      </div>`);
      return;
    }
    const parts = data.parts.filter((p) => p.box_id === box.id);
    const tools = data.tools.filter((t) => t.box_id === box.id);
    setHTML(detail, html`
      <div class="card overflow-hidden">
        <div class="px-4 py-3 flex items-center gap-2" style="background:linear-gradient(90deg, ${box.color}55, transparent)">
          <span class="w-4 h-4 rounded" style="background:${box.color}"></span>
          <div class="flex-1"><div class="font-display font-bold text-white">${box.label}</div><div class="text-[11px] text-slate-300">Etage ${box.level} · Platz ${box.position}</div></div>
          ${floatBtn('box', box.id)}
          <button class="btn-icon" data-qrbox="${box.id}" title="QR-Code drucken">${icon('qr')}</button>
          ${isAdmin() ? html`<button class="btn-icon" data-editbox="${box.id}">${icon('edit')}</button>` : ''}
        </div>
        <div class="p-3 space-y-1.5">
          ${parts.map((p) => partRow(p, { compact: true }))}
          ${tools.map((t) => html`<div class="card px-3 py-2 text-sm flex items-center gap-2" data-partchip="tool:${t.id}">${icon('wrench', 'w-3.5 h-3.5 text-sky-300')}<span class="flex-1 text-white">${t.name}</span>${t.borrowed_by_name ? html`<span class="chip !text-[10px] !text-pink-200">bei ${t.borrowed_by_name}</span>` : ''}${floatBtn('tool', t.id, { small: true, text: false })}</div>`)}
          ${!parts.length && !tools.length ? html`<p class="text-sm text-slate-500">Box ist leer.</p>` : ''}
          ${canEdit() ? html`<button class="btn btn-sm w-full mt-2" data-newpart-box="${box.id}">${icon('plus')} Teil in diese Box</button>` : ''}
        </div>
      </div>`);
  }

  function flashHighlight() {
    if (selectedBox) {
      const b = front.querySelector(`[data-box="${selectedBox}"]`);
      if (b) { b.classList.add('flash'); b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    if (highlight) {
      const chips = body.querySelectorAll(`[data-partchip="${highlight}"], [data-partrow="${highlight.split(':')[1]}"]`);
      chips.forEach((c) => { c.classList.add('flash-target'); });
    }
  }

  on(front, 'click', '[data-box]', (_e, b) => { selectedBox = Number(b.dataset.box); haptic(6); render(); });
  on(front, 'click', '[data-loosepart]', (_e, c) => openPartForm(data.parts.find((p) => p.id === Number(c.dataset.loosepart)), reload));
  on(front, 'click', '[data-addbox]', (_e, b) => openBoxForm({ shelf_id: shelfId, level: Number(b.dataset.addbox), position: data.boxes.filter((x) => x.level === Number(b.dataset.addbox)).length + 1 }, reload));
  on(front, 'click', '[data-levels]', async (_e, b) => {
    const levels = Math.max(1, Math.min(10, (Number(data.shelf.props.levels) || 4) + Number(b.dataset.levels)));
    try { await put(`/layout/objects/${shelfId}`, { props: { ...data.shelf.props, levels } }); await refreshAll(); await reload(); } catch (err) { toastError(err); }
  });
  const boxLabel = (b) => ({ kind: 'box', id: b.id, title: b.label, subtitle: `${data.shelf.label || `Regal ${data.shelf.code}`} · Etage ${b.level} · Platz ${b.position}`, kicker: 'EUROBOX', color: b.color });
  on(detail, 'click', '[data-qrbox]', (_e, b) => printLabels([boxLabel(data.boxes.find((x) => x.id === Number(b.dataset.qrbox)))], { title: 'QR-Code: Eurobox' }));
  on(front, 'click', '[data-qrall]', () => printLabels(data.boxes.map(boxLabel), { title: `QR-Labels ${data.shelf.label || data.shelf.code}` }));
  on(detail, 'click', '[data-lg-part]', (_e, r) => openPartForm(data.parts.find((p) => p.id === Number(r.dataset.lgPart)), reload));
  on(detail, 'click', '[data-editbox]', (_e, b) => openBoxForm(data.boxes.find((x) => x.id === Number(b.dataset.editbox)), async (deleted) => { if (deleted) selectedBox = null; await reload(); }));
  on(detail, 'click', '[data-newpart-box]', (_e, b) => openPartForm({ box_id: Number(b.dataset.newpartBox), shelf_id: shelfId }, reload));
  on(detail, 'click', '[data-newpart-shelf]', () => openPartForm({ shelf_id: shelfId, level: 1 }, reload));

  render();
  setTimeout(flashHighlight, 120);
  return m;
}


/* ====================================================================== */
/* v5.3: Handy-Ansicht: verschachteltes Akkordeon-Regal                   */
/*   Ebene 1: Regal-Tabs · Ebene 2: Etagen · Ebene 3: Boxen/Freifläche    */
/*   Ebene 4: Box-Inhalt mit Suchzeile. Standard: alles eingeklappt.      */
/* ====================================================================== */
export const isPhone = () => !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);

function openShelfAccordion(shelfId, opts = {}) {
  const body = el(html`<div class="-mx-5 -my-4"><div data-acc></div></div>`);
  const m = openModal({ title: 'Regale', subtitle: 'Regal wählen, Etage aufklappen, Box antippen', size: 'xl', iconName: 'shelf', body });
  renderShelfAccordion(body.querySelector('[data-acc]'), { shelfId, ...opts, inModal: m });
  return m;
}

/**
 * Akkordeon in einen Container zeichnen (Modal oder Lager-Panel).
 * opts: { shelfId, level, boxId, highlight }
 */
export async function renderShelfAccordion(root, opts = {}) {
  const shelves = store.objects.filter((o) => o.type === 'shelf').sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const st = root._acc || { cache: new Map() };
  root._acc = st;
  st.shelfId = Number(opts.shelfId) || st.shelfId || (shelves[0] && shelves[0].id) || null;
  st.level = opts.level !== undefined ? (opts.level || null) : (st.level ?? null);
  st.box = opts.boxId ? Number(opts.boxId) : (opts.level !== undefined ? null : (st.box ?? null));
  st.q = '';
  st.highlight = opts.highlight || null;
  if (opts.highlight && !st.level && !st.box) {
    // Treffer ohne Etage/Box: Freifläche der passenden Etage öffnen, sobald Daten da sind
    st.pendingHighlight = opts.highlight;
  }

  const load = async (force = false) => {
    if (!st.shelfId) return null;
    if (!force && st.cache.has(st.shelfId)) return st.cache.get(st.shelfId);
    const d = await get(`/shelves/${st.shelfId}`);
    st.cache.set(st.shelfId, d);
    return d;
  };

  async function reload() { st.cache.delete(st.shelfId); await draw(); }

  function levelStats(d, l) {
    const boxes = d.boxes.filter((b) => b.level === l);
    const boxIds = new Set(boxes.map((b) => b.id));
    const parts = d.parts.filter((p) => (p.box_id ? boxIds.has(p.box_id) : p.level === l));
    const tools = d.tools.filter((t) => (t.box_id ? boxIds.has(t.box_id) : t.level === l));
    const loose = d.parts.filter((p) => !p.box_id && p.level === l);
    const looseTools = d.tools.filter((t) => !t.box_id && t.level === l);
    return { boxes, parts, tools, loose, looseTools };
  }

  function boxPanel(d, key) {
    const isLoose = String(key).startsWith('loose');
    const lvl = isLoose ? Number(String(key).split('-')[1]) || null : null;
    const box = isLoose ? null : d.boxes.find((b) => b.id === Number(key));
    if (!isLoose && !box) return '';
    const parts = isLoose ? d.parts.filter((p) => !p.box_id && (lvl ? p.level === lvl : !p.level)) : d.parts.filter((p) => p.box_id === box.id);
    const tools = isLoose ? d.tools.filter((t) => !t.box_id && (lvl ? t.level === lvl : !t.level)) : d.tools.filter((t) => t.box_id === box.id);
    const color = box ? box.color : '#64748b';
    return html`
      <div class="acc-box" style="--bc:${color}" data-accbox="${key}">
        <div class="acc-box-head">
          <span class="w-3.5 h-3.5 rounded shrink-0" style="background:${color}"></span>
          <div class="flex-1 min-w-0"><div class="font-display font-bold text-white truncate">${box ? box.label : lvl ? `Freifläche Etage ${lvl}` : 'Ohne Etage'}</div>
            <div class="text-[11px] text-slate-400">${parts.length} ${parts.length === 1 ? 'Teil' : 'Teile'}${tools.length ? ` · ${tools.length} Werkzeug` : ''}${box ? ` · Platz ${box.position}` : ''}</div></div>
          ${box ? floatBtn('box', box.id, { small: true, text: false }) : ''}
          ${box ? html`<button class="btn-icon !w-8 !h-8" data-acc-qr="${box.id}" title="QR-Code drucken">${icon('qr', 'w-4 h-4')}</button>` : ''}
          ${box && isAdmin() ? html`<button class="btn-icon !w-8 !h-8" data-acc-editbox="${box.id}" title="Box bearbeiten">${icon('edit', 'w-4 h-4')}</button>` : ''}
          <button class="btn-icon !w-8 !h-8" data-acc-closebox title="Zuklappen">${icon('x', 'w-4 h-4')}</button>
        </div>
        ${parts.length + tools.length > 4 ? html`<div class="relative px-3 pt-2"><span class="absolute left-5 top-1/2 translate-y-[-30%] text-slate-500">${icon('search', 'w-3.5 h-3.5')}</span>
          <input class="input !pl-8 !py-1.5 text-sm" placeholder="In dieser ${box ? 'Box' : 'Ablage'} suchen …" data-acc-q autocomplete="off"></div>` : ''}
        <div class="p-2.5 space-y-1.5" data-acc-items>
          ${parts.map((p) => html`<div data-acc-item="${`${p.name} ${p.category || ''} ${p.part_number || ''}`.toLowerCase()}">${partRow(p, { compact: true })}</div>`)}
          ${tools.map((t) => html`<div class="card px-3 py-2 text-sm flex items-center gap-2" data-acc-item="${`${t.name} ${t.category || ''}`.toLowerCase()}" data-partchip="tool:${t.id}">${icon('wrench', 'w-3.5 h-3.5 text-sky-300')}<span class="flex-1 text-white">${t.name}</span>${t.borrowed_by_name ? html`<span class="chip !text-[10px] !text-pink-200">bei ${t.borrowed_by_name}</span>` : ''}${floatBtn('tool', t.id, { small: true, text: false })}</div>`)}
          ${!parts.length && !tools.length ? html`<p class="text-sm text-slate-500 px-1">Leer.</p>` : ''}
          <p class="text-sm text-slate-500 px-1 hidden" data-acc-none>Nichts gefunden.</p>
          ${canEdit() ? html`<button class="btn btn-sm w-full mt-1" data-acc-newpart>${icon('plus')} Teil ${box ? 'in diese Box' : 'hierher'}</button>` : ''}
        </div>
      </div>`;
  }

  async function draw() {
    let d;
    try { d = await load(); } catch (err) { toastError(err); return; }
    if (!d) { setHTML(root, html`<p class="p-4 text-sm text-slate-500">Noch keine Regale angelegt.</p>`); return; }
    const levels = Number(d.shelf.props.levels) || 4;
    // Treffer ohne vorgewählte Etage: Etage/Box aus dem markierten Teil ableiten
    if (st.pendingHighlight) {
      const [kind, id] = st.pendingHighlight.split(':');
      const it = (kind === 'tool' ? d.tools : d.parts).find((x) => x.id === Number(id));
      if (it) {
        const b = it.box_id && d.boxes.find((x) => x.id === it.box_id);
        st.level = b ? b.level : it.level || 0;
        st.box = b ? b.id : `loose-${it.level || 0}`;
      }
      st.pendingHighlight = null;
    }
    const noLevel = { parts: d.parts.filter((p) => !p.box_id && !p.level), tools: d.tools.filter((t) => !t.box_id && !t.level) };
    const lvls = Array.from({ length: levels }, (_, i) => i + 1);
    setHTML(root, html`
      <div class="acc-shelf">
        <div class="acc-tabs" role="tablist">
          ${shelves.map((s) => html`<button class="acc-tab ${s.id === st.shelfId ? 'on' : ''}" role="tab" data-acc-shelf="${s.id}">${icon('shelf', 'w-3.5 h-3.5')} ${s.label || `Regal ${s.code}`}</button>`)}
        </div>
        <div class="acc-levels">
          ${lvls.map((l) => {
            const ls = levelStats(d, l);
            const open = st.level === l;
            const count = ls.parts.length + ls.tools.length;
            return html`
              <div class="acc-level ${open ? 'open' : ''}" data-acc-level="${l}">
                <button class="acc-lvhead" data-acc-lv="${l}" aria-expanded="${open ? 'true' : 'false'}">
                  <span class="acc-lvnum">E${l}</span>
                  <span class="flex-1 min-w-0 text-left">
                    <span class="block text-sm font-semibold text-white">Etage ${l}${l === 1 ? ' (unten)' : l === levels ? ' (oben)' : ''}</span>
                    <span class="block text-[11px] text-slate-400 truncate">${ls.boxes.length} ${ls.boxes.length === 1 ? 'Box' : 'Boxen'} · ${count} ${count === 1 ? 'Teil' : 'Teile'}${ls.loose.length + ls.looseTools.length ? ` · ${ls.loose.length + ls.looseTools.length} lose` : ''}</span>
                  </span>
                  <span class="acc-dots">${ls.boxes.slice(0, 6).map((b) => html`<i style="background:${b.color}"></i>`)}</span>
                  <span class="acc-chev" aria-hidden="true"></span>
                </button>
                ${open ? html`
                  <div class="acc-lvbody">
                    <div class="acc-tiles">
                      ${ls.boxes.map((b) => {
                        const n = d.parts.filter((p) => p.box_id === b.id).length + d.tools.filter((t) => t.box_id === b.id).length;
                        return html`<button class="acc-tile ${st.box === b.id ? 'on' : ''}" style="--bc:${b.color}" data-acc-tile="${b.id}" title="${b.label}"><span class="acc-tile-label">${b.label}</span><span class="acc-tile-n">${n}</span></button>`;
                      })}
                      ${ls.loose.length + ls.looseTools.length || !ls.boxes.length ? html`<button class="acc-tile is-free ${st.box === `loose-${l}` ? 'on' : ''}" data-acc-tile="loose-${l}" title="Freifläche"><span class="acc-tile-label">Freifläche</span><span class="acc-tile-n">${ls.loose.length + ls.looseTools.length}</span></button>` : ''}
                      ${isAdmin() ? html`<button class="acc-tile is-add" data-acc-addbox="${l}" title="Neue Eurobox auf Etage ${l}">${icon('plus', 'w-4 h-4')}<span class="acc-tile-label">Box</span></button>` : ''}
                    </div>
                    ${st.box && (st.box === `loose-${l}` || ls.boxes.some((b) => b.id === st.box)) ? boxPanel(d, st.box) : ''}
                  </div>` : ''}
              </div>`;
          })}
          ${noLevel.parts.length + noLevel.tools.length ? html`
            <div class="acc-level ${st.level === 0 ? 'open' : ''}" data-acc-level="0">
              <button class="acc-lvhead" data-acc-lv="0"><span class="acc-lvnum">?</span><span class="flex-1 text-left"><span class="block text-sm font-semibold text-white">Ohne Etage</span>
                <span class="block text-[11px] text-slate-400">${noLevel.parts.length + noLevel.tools.length} Einträge</span></span><span class="acc-chev"></span></button>
              ${st.level === 0 ? html`<div class="acc-lvbody">${boxPanel(d, 'loose-0')}</div>` : ''}
            </div>` : ''}
        </div>
        ${d.boxes.length ? html`<div class="px-3 pb-3"><button class="btn btn-sm w-full" data-acc-qrall>${icon('qr')} Alle Box-Labels dieses Regals drucken</button></div>` : ''}
      </div>`);
    if (st.highlight) {
      const hl = st.highlight;
      st.highlight = null;
      setTimeout(() => {
        const [kind, id] = hl.split(':');
        const node = root.querySelector(kind === 'tool' ? `[data-partchip="tool:${id}"]` : `[data-partrow="${id}"]`);
        if (node) { node.classList.add('flash-target'); node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }, 80);
    } else if (st.box) {
      const bx = root.querySelector('[data-accbox]');
      if (bx && opts._scroll !== false) bx.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  if (!root.dataset.boundAcc) {
    root.dataset.boundAcc = '1';
    on(root, 'click', '[data-acc-shelf]', (_e, b) => { st.shelfId = Number(b.dataset.accShelf); st.level = null; st.box = null; haptic(6); const s = shelves.find((x) => x.id === st.shelfId); track(`Öffnete ${s ? s.label || `Regal ${s.code}` : 'Regal'}`, 'open'); draw(); });
    on(root, 'click', '[data-acc-lv]', (_e, b) => { const l = Number(b.dataset.accLv); st.level = st.level === l ? null : l; st.box = l === 0 ? 'loose-0' : null; haptic(5); draw(); });
    on(root, 'click', '[data-acc-tile]', (_e, b) => {
      const k = b.dataset.accTile;
      const key = String(k).startsWith('loose') ? k : Number(k);
      st.box = st.box === key ? null : key;
      haptic(6);
      if (st.box) track(`Öffnete Box ${b.getAttribute('title') || ''}`, 'open');
      draw();
    });
    on(root, 'click', '[data-acc-closebox]', () => { st.box = null; if (st.level === 0) st.level = null; draw(); });
    on(root, 'input', '[data-acc-q]', (_e, inp) => {
      const q = inp.value.trim().toLowerCase();
      const items = root.querySelectorAll('[data-acc-item]');
      let shown = 0;
      items.forEach((x) => { const ok = !q || x.dataset.accItem.includes(q); x.classList.toggle('hidden', !ok); if (ok) shown += 1; });
      const none = root.querySelector('[data-acc-none]');
      if (none) none.classList.toggle('hidden', shown > 0 || !items.length);
    });
    on(root, 'click', '[data-lg-part]', (e, r) => {
      if (e.target.closest('[data-float-kind], [data-lg-goto]')) return;
      const d = st.cache.get(st.shelfId);
      const p = d && d.parts.find((x) => x.id === Number(r.dataset.lgPart));
      if (p) openPartForm(p, reload);
    });
    on(root, 'click', '[data-acc-newpart]', () => {
      const d = st.cache.get(st.shelfId);
      if (String(st.box).startsWith('loose')) openPartForm({ shelf_id: st.shelfId, level: Number(String(st.box).split('-')[1]) || null }, reload);
      else openPartForm({ box_id: st.box, shelf_id: st.shelfId, level: d && (d.boxes.find((b) => b.id === st.box) || {}).level }, reload);
    });
    on(root, 'click', '[data-acc-addbox]', (_e, b) => {
      const d = st.cache.get(st.shelfId);
      const l = Number(b.dataset.accAddbox);
      openBoxForm({ shelf_id: st.shelfId, level: l, position: d ? d.boxes.filter((x) => x.level === l).length + 1 : 1 }, reload);
    });
    on(root, 'click', '[data-acc-editbox]', (_e, b) => {
      const d = st.cache.get(st.shelfId);
      openBoxForm(d.boxes.find((x) => x.id === Number(b.dataset.accEditbox)), async (deleted) => { if (deleted) st.box = null; await reload(); });
    });
    const label = (d, b) => ({ kind: 'box', id: b.id, title: b.label, subtitle: `${d.shelf.label || `Regal ${d.shelf.code}`} · Etage ${b.level} · Platz ${b.position}`, kicker: 'EUROBOX', color: b.color });
    on(root, 'click', '[data-acc-qr]', (_e, b) => { const d = st.cache.get(st.shelfId); printLabels([label(d, d.boxes.find((x) => x.id === Number(b.dataset.accQr)))], { title: 'QR-Code: Eurobox' }); });
    on(root, 'click', '[data-acc-qrall]', () => { const d = st.cache.get(st.shelfId); printLabels(d.boxes.map((b) => label(d, b)), { title: `QR-Labels ${d.shelf.label || d.shelf.code}` }); });
  }
  root._accReload = reload;
  await draw();
}

function openBoxForm(box, onDone) {
  const isNew = !box.id;
  const body = el(html`<div>
    <form class="grid grid-cols-2 gap-3" data-form>
      <label class="col-span-2"><span class="label">Beschriftung</span><input class="input" name="label" value="${box.label || ''}" required placeholder="z. B. Bremse, Elektrik"></label>
      <label><span class="label">Etage</span><input class="input" type="number" min="1" name="level" value="${box.level || 1}"></label>
      <label><span class="label">Position</span><input class="input" type="number" min="1" name="position" value="${box.position || 1}"></label>
      <div class="col-span-2"><span class="label">Farbcode</span>
        <div class="flex flex-wrap gap-2">${BOX_COLORS.map((c) => html`<label class="cursor-pointer"><input type="radio" name="color" value="${c}" class="peer sr-only" ${(box.color || BOX_COLORS[4]) === c ? 'checked' : ''}><span class="block w-8 h-8 rounded-md ring-2 ring-transparent peer-checked:ring-white" style="background:${c}"></span></label>`)}</div></div>
    </form></div>`);
  const m = openModal({
    title: isNew ? 'Neue Eurobox' : `Box „${box.label}“`, size: 'sm', iconName: 'box', body,
    footer: html`${!isNew ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash')}</button>` : ''}<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>Speichern</button>`
  });
  m.footer.querySelector('[data-save]').addEventListener('click', async () => {
    const f = body.querySelector('[data-form]');
    if (!f.reportValidity()) return;
    try {
      const payload = { ...formData(f), shelf_id: box.shelf_id };
      if (isNew) await post('/boxes', payload); else await put(`/boxes/${box.id}`, payload);
      m.close(); onDone && onDone(false);
    } catch (err) { toastError(err); }
  });
  const d = m.footer.querySelector('[data-del]');
  if (d) d.addEventListener('click', async () => {
    if (!(await confirmDialog('Box löschen? Inhalte bleiben als lose Teile auf der Etage.', { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/boxes/${box.id}`); m.close(); onDone && onDone(true); } catch (err) { toastError(err); }
  });
}

/* ====================================================================== */
/* Teil-Formular                                                          */
/* ====================================================================== */
export async function openPartForm(part = {}, onSaved = null) {
  const isNew = !part.id;
  let boxes = [];
  let cons = [];
  try { [boxes, cons] = await Promise.all([get('/boxes'), get('/consumables')]); } catch { /* egal */ }
  const shelves = store.objects.filter((o) => o.type === 'shelf');
  const p = { qty: 1, condition: 'neu', ...part };
  if (p.box_id && !p.shelf_id) { const b = boxes.find((x) => x.id === p.box_id); if (b) { p.shelf_id = b.shelf_id; p.level = b.level; } }
  const mode = p.universal ? 'universal' : p.foreign_model ? 'foreign' : p.vehicle_id ? 'vehicle' : (isNew && !p.vehicle_id ? 'universal' : 'vehicle');

  const body = el(html`<div>
    <form class="grid sm:grid-cols-2 gap-3" data-form>
      <label class="sm:col-span-2"><span class="label">Bezeichnung</span><input class="input" name="name" value="${p.name || ''}" required placeholder="z. B. Querlenker vorne links"></label>
      <label><span class="label">Kategorie</span><input class="input" name="category" value="${p.category || ''}" list="catList" placeholder="Fahrwerk, Bremse, Öle …">
        <datalist id="catList">${['Fahrwerk', 'Bremse', 'Motor', 'Antrieb', 'Elektrik', 'Öle', 'Räder', 'Karosserie', 'Verbrauch', 'Innenraum'].map((c) => html`<option>${c}</option>`)}</datalist></label>
      <div class="grid grid-cols-2 gap-2">
        <label><span class="label">Anzahl</span><input class="input" type="number" min="0" name="qty" value="${p.qty}"></label>
        <label><span class="label">Zustand</span><select class="select" name="condition">${CONDITIONS.map((c) => html`<option ${p.condition === c ? 'selected' : ''}>${c}</option>`)}</select></label>
      </div>
      <div class="sm:col-span-2 dims-box !p-3" data-pack>
        <div class="font-display font-bold text-white text-sm mb-1">${icon('package', 'w-4 h-4 inline text-cyan-300')} Gebinde &amp; Kritische Liste <span class="text-[11px] font-normal text-slate-400">(für Öle, Flüssigkeiten, Verbrauchsmaterial)</span></div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label class="col-span-2"><span class="label">Gehört zu (Kritische Liste)</span>
            <select class="select" name="consumable_id" data-cons><option value="">keine Zuordnung</option>${cons.map((c) => html`<option value="${c.id}" data-unit="${c.unit}" ${Number(p.consumable_id) === c.id ? 'selected' : ''}>${c.name} (${c.unit})</option>`)}</select></label>
          <label><span class="label">Gebindemenge</span><input class="input font-mono" type="number" step="0.01" min="0" name="pack_size" value="${p.pack_size ?? ''}" placeholder="z. B. 5" data-packsize></label>
          <label><span class="label">Einheit</span><select class="select" name="pack_unit" data-packunit>${['L', 'Stk', 'Dosen', 'Flaschen', 'Rollen', 'Packungen', 'kg', 'm'].map((u) => html`<option ${(p.pack_unit || 'L') === u ? 'selected' : ''}>${u}</option>`)}</select></label>
          <label class="col-span-2"><span class="label">Rest im angebrochenen Gebinde</span><input class="input font-mono" type="number" step="0.01" min="0" name="open_rest" value="${p.open_rest ?? ''}" placeholder="leer = keins angebrochen" data-openrest></label>
          <div class="col-span-2 self-end text-sm text-cyan-200 pb-2" data-packsum></div>
        </div>
        <p class="text-[11px] text-slate-500 mt-1">Beispiel: Anzahl 2, Gebindemenge 1, Einheit L = zwei 1-L-Dosen. Die Kritische Liste summiert alle Gebinde in der Halle automatisch.</p>
      </div>
      <div class="sm:col-span-2">
        <span class="label">Zuordnung</span>
        <div class="mode-switch mb-2" data-assign>
          <button type="button" data-mode="vehicle" class="${mode === 'vehicle' ? 'on' : ''}">Auto</button>
          <button type="button" data-mode="universal" class="${mode === 'universal' ? 'on' : ''}">Universal</button>
          <button type="button" data-mode="foreign" class="${mode === 'foreign' ? 'on' : ''}">Fremdes Modell</button>
        </div>
        <div data-assign-vehicle class="${mode === 'vehicle' ? '' : 'hidden'}"><select class="select" name="vehicle_id"><option value="">Auto wählen …</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${p.vehicle_id === v.id ? 'selected' : ''}>${v.name}</option>`)}</select></div>
        <div data-assign-foreign class="${mode === 'foreign' ? '' : 'hidden'}"><input class="input" name="foreign_model" value="${p.foreign_model || ''}" placeholder="Freitext, z. B. E30 M20 oder E36 Compact"></div>
        <p data-assign-universal class="text-xs text-slate-500 ${mode === 'universal' ? '' : 'hidden'}">Passt zu allen Autos (z. B. Öl, Kabelbinder). Erscheint in Packlisten genau einmal.</p>
      </div>
      <div class="sm:col-span-2 grid grid-cols-3 gap-2">
        <label><span class="label">Regal</span><select class="select" name="shelf_id" data-shelf><option value="">kein</option>${shelves.map((s) => html`<option value="${s.id}" ${p.shelf_id === s.id ? 'selected' : ''}>${s.code}</option>`)}</select></label>
        <label><span class="label">Etage</span><select class="select" name="level" data-level></select></label>
        <label><span class="label">Eurobox</span><select class="select" name="box_id" data-boxsel></select></label>
      </div>
      <label><span class="label">Teilenummer</span><input class="input font-mono" name="part_number" value="${p.part_number || ''}"></label>
      <label class="flex items-center gap-3 card px-3 py-2.5 sm:mt-5 cursor-pointer"><input type="checkbox" class="check" name="event_relevant" ${p.event_relevant ? 'checked' : ''}><span class="text-sm"><b class="text-amber-300">Event-tauglich</b><br><span class="text-[11px] text-slate-400">landet automatisch auf der Packliste</span></span></label>
      <label class="sm:col-span-2"><span class="label">Notizen</span><textarea class="input" rows="2" name="notes">${p.notes || ''}</textarea></label>
    </form></div>`);
  let assign = mode;
  const shelfSel = body.querySelector('[data-shelf]');
  const levelSel = body.querySelector('[data-level]');
  const boxSel = body.querySelector('[data-boxsel]');
  const fillLevels = (keep) => {
    const s = shelves.find((x) => x.id === Number(shelfSel.value));
    const n = s ? Number(s.props.levels) || 4 : 0;
    setHTML(levelSel, html`<option value="">keine</option>${Array.from({ length: n }, (_, i) => html`<option value="${i + 1}" ${Number(keep) === i + 1 ? 'selected' : ''}>E${i + 1}</option>`)}`);
  };
  const fillBoxes = (keep) => {
    const list = boxes.filter((b) => b.shelf_id === Number(shelfSel.value) && (!levelSel.value || b.level === Number(levelSel.value)));
    setHTML(boxSel, html`<option value="">lose</option>${list.map((b) => html`<option value="${b.id}" ${Number(keep) === b.id ? 'selected' : ''}>${b.label} (E${b.level})</option>`)}`);
  };
  fillLevels(p.level); fillBoxes(p.box_id);
  // v4.2: Gebinde-Summe live anzeigen, Einheit kommt von der Kritischen Liste
  const consSel = body.querySelector('[data-cons]');
  const packSize = body.querySelector('[data-packsize]');
  const packUnit = body.querySelector('[data-packunit]');
  const openRest = body.querySelector('[data-openrest]');
  const qtyInp = body.querySelector('[name="qty"]');
  const nameInp = body.querySelector('[name="name"]');
  const fmtN = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const syncPack = () => {
    const opt = consSel.selectedOptions[0];
    const unit = opt && opt.dataset.unit;
    if (unit) {
      if (![...packUnit.options].some((o) => o.value === unit)) packUnit.insertAdjacentHTML('beforeend', `<option>${unit.replace(/[<>&"]/g, '')}</option>`);
      packUnit.value = unit;
    }
    packUnit.disabled = !!unit;
    if (unit && !packSize.value) {
      const m = String(nameInp.value).match(/(\d+(?:[.,]\d+)?)\s?(ml|l|liter|ltr)\b/i);
      if (m && unit === 'L') packSize.value = Number(m[1].replace(',', '.')) / (/ml/i.test(m[2]) ? 1000 : 1);
    }
    const q = Number(qtyInp.value) || 0; const ps = Number(packSize.value) || 0;
    const rest = openRest.value === '' ? null : Number(openRest.value);
    const total = ps ? (rest !== null && q > 0 ? (q - 1) * ps + Math.min(rest, ps) : q * ps) : 0;
    body.querySelector('[data-packsum]').textContent = ps ? `= ${fmtN(total)} ${packUnit.value} in dieser Zeile${unit ? ' (zählt zur Kritischen Liste)' : ''}` : '';
  };
  [consSel, packSize, packUnit, openRest, qtyInp].forEach((x) => x.addEventListener('input', syncPack));
  consSel.addEventListener('change', syncPack);
  syncPack();
  shelfSel.addEventListener('change', () => { fillLevels(null); fillBoxes(null); });
  levelSel.addEventListener('change', () => fillBoxes(boxSel.value));
  boxSel.addEventListener('change', () => { const b = boxes.find((x) => x.id === Number(boxSel.value)); if (b) { fillLevels(b.level); } });
  on(body, 'click', '[data-assign] [data-mode]', (_e, b) => {
    assign = b.dataset.mode;
    body.querySelectorAll('[data-assign] [data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    ['vehicle', 'universal', 'foreign'].forEach((k) => body.querySelector(`[data-assign-${k}]`).classList.toggle('hidden', k !== assign));
  });

  const m = openModal({
    title: isNew ? 'Neues Ersatzteil' : p.name, subtitle: isNew ? '' : 'Teil bearbeiten', size: 'md', iconName: 'box', body,
    footer: html`${!isNew && canEdit() ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash')}</button>` : ''}
      ${!isNew && p.shelf_id ? html`<button class="btn" data-goto>${icon('target')} Im Regal zeigen</button>` : ''}
      <button class="btn" data-close>Abbrechen</button>${canEdit() ? html`<button class="btn btn-primary" data-save>${icon('check')} Speichern</button>` : ''}`
  });
  const save = m.footer.querySelector('[data-save]');
  if (save) save.addEventListener('click', async () => {
    const f = body.querySelector('[data-form]');
    if (!f.reportValidity()) return;
    const d = formData(f);
    d.universal = assign === 'universal';
    if (assign !== 'vehicle') d.vehicle_id = null;
    if (assign !== 'foreign') d.foreign_model = null;
    if (assign === 'vehicle' && !d.vehicle_id) { toast('Bitte ein Auto wählen oder Universal markieren.', 'warn'); return; }
    try {
      if (isNew) await post('/parts', d); else await put(`/parts/${p.id}`, d);
      haptic(8);
      m.close();
      toast('Teil gespeichert.', 'ok');
      onSaved && onSaved();
      if (!onSaved) app.rerenderTab('lager');
    } catch (err) { toastError(err); }
  });
  const delBtn = m.footer.querySelector('[data-del]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(`„${p.name}“ löschen?`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/parts/${p.id}`); m.close(); onSaved && onSaved(); } catch (err) { toastError(err); }
  });
  const goto = m.footer.querySelector('[data-goto]');
  if (goto) goto.addEventListener('click', () => { m.close(); app.navigate({ kind: 'shelf', shelfId: p.shelf_id, level: p.level, boxId: p.box_id, highlight: `part:${p.id}` }); });
}
app.openPartForm = openPartForm;

/* ====================================================================== */
/* Werkzeug-Radar & Wunschliste                                           */
/* ====================================================================== */
const toolState = { q: '', filter: 'all' };

export async function renderToolsPanel(container) {
  let tools = [];
  try { tools = await get('/tools'); } catch (err) { toastError(err); }
  const owned = tools.filter((t) => !t.wishlist);
  const wish = tools.filter((t) => t.wishlist);
  const q = toolState.q.toLowerCase();
  const visible = owned.filter((t) => (!q || `${t.name} ${t.category || ''} ${t.location_text || ''}`.toLowerCase().includes(q))
    && (toolState.filter === 'all' || (toolState.filter === 'borrowed' && t.borrowed_by) || (toolState.filter === 'event' && t.event_relevant)
      || (toolState.filter === 'lent' && t.lent_to)));
  const borrowedCount = owned.filter((t) => t.borrowed_by).length;
  // v5.2: außer Haus verliehen, überfällig = Rückgabedatum vorbei
  const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const lentInfo = (t) => {
    if (!t.lent_to) return null;
    const dayMs = 86400000;
    const od = t.lent_due && t.lent_due < todayIso ? Math.round((Date.parse(todayIso) - Date.parse(t.lent_due)) / dayMs) : 0;
    const inDays = t.lent_due && !od ? Math.round((Date.parse(t.lent_due) - Date.parse(todayIso)) / dayMs) : null;
    return { od, inDays };
  };
  const lent = owned.filter((t) => t.lent_to);
  const overdue = lent.filter((t) => lentInfo(t).od > 0);

  const location = (t) => (t.shelf_code ? `Regal ${t.shelf_code}${t.level ? ` · E${t.level}` : ''}${t.box_label ? ` · ${t.box_label}` : ''}` : t.location_text || 'ohne festen Ort');

  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div><h3 class="font-display font-bold tracking-wider text-white">Werkzeug-Radar</h3><p class="text-xs text-slate-500">${owned.length} Werkzeuge · ${borrowedCount} in Benutzung${lent.length ? ` · ${lent.length} außer Haus` : ''}</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-tl-new>${icon('plus')} Werkzeug</button>` : ''}
      </div>
      <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">${icon('search')}</span>
        <input class="input !pl-9" placeholder="Werkzeug suchen …" value="${toolState.q}" data-tl-q></div>
      ${overdue.length ? html`<div class="tool-overdue">${icon('alert', 'w-4 h-4 shrink-0')}<div class="flex-1 min-w-0">${overdue.map((t) => html`<div>Überfällig: <b>${t.name}</b> bei <b>${t.lent_to}</b> seit ${lentInfo(t).od} ${lentInfo(t).od === 1 ? 'Tag' : 'Tagen'}!</div>`)}</div></div>` : ''}
      <div class="flex flex-wrap gap-1.5">${[['all', 'Alle'], ['borrowed', 'In Benutzung'], ['lent', `Außer Haus${lent.length ? ` (${lent.length})` : ''}`], ['event', 'Event-relevant']].map(([k, l]) => html`<button class="chip chip-btn ${toolState.filter === k ? 'on' : ''} ${k === 'lent' && overdue.length ? 'chip-alarm' : ''}" data-tl-filter="${k}">${l}</button>`)}</div>
      <div class="space-y-1.5" data-tl-list>
        ${visible.map((t) => html`
          <div class="card px-3 py-2.5 ${t.lent_to ? (lentInfo(t).od ? 'tool-od' : 'tool-lent') : t.borrowed_by ? '!border-pink-400/30' : ''}" data-tool="${t.id}">
            <div class="flex items-start gap-2.5">
              <span class="mt-0.5 ${t.lent_to ? (lentInfo(t).od ? 'text-rose-300' : 'text-violet-300') : t.borrowed_by ? 'text-pink-300' : 'text-sky-300'}">${icon('wrench')}</span>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-white">${t.name}${t.qty > 1 ? html` <span class="text-slate-500 font-normal">(${t.qty}×)</span>` : ''}</div>
                <div class="text-[11px] text-slate-500">${t.category ? `${t.category} · ` : ''}${location(t)}</div>
                ${t.lent_to ? html`<div class="mt-1 text-xs ${lentInfo(t).od ? 'text-rose-200 font-semibold' : 'text-violet-200'}">
                  ${icon('move', 'w-3 h-3 inline')} Außerhalb der Halle · verliehen an <b>${t.lent_to}</b> seit ${fmtDate(t.lent_at)}
                  <div class="text-[11px] ${lentInfo(t).od ? 'text-rose-300' : 'text-violet-300/80'}">${t.lent_due
                    ? (lentInfo(t).od ? `Überfällig seit ${lentInfo(t).od} ${lentInfo(t).od === 1 ? 'Tag' : 'Tagen'} (Rückgabe war ${fmtDate(t.lent_due)})`
                      : lentInfo(t).inDays === 0 ? 'Rückgabe heute fällig' : `Rückgabe bis ${fmtDate(t.lent_due)} (in ${lentInfo(t).inDays} ${lentInfo(t).inDays === 1 ? 'Tag' : 'Tagen'})`)
                    : 'ohne Rückgabedatum'}${t.lent_note ? ` · ${t.lent_note}` : ''}</div></div>`
                : t.borrowed_by ? html`<div class="mt-1 text-xs text-pink-200 flex items-center gap-1.5">
                  <span class="w-4 h-4 rounded-full grid place-items-center text-[8px] font-bold text-black" style="background:${t.borrowed_by_color}">${initials(t.borrowed_by_name)}</span>
                  In Benutzung von <b>${t.borrowed_by_name}</b>${t.borrowed_vehicle_name ? html` an <b>${t.borrowed_vehicle_name}</b>` : ''} <span class="text-pink-300/60">${since(t.borrowed_at)}</span></div>`
                  : floatOf('tool', t.id) ? html`<div class="mt-1 text-[11px] text-amber-300">🛠️ liegt rum${floatOf('tool', t.id).spot ? ` ${floatOf('tool', t.id).spot}` : ''}</div>`
                  : html`<div class="mt-1 text-[11px] text-lime-400/80">● verfügbar</div>`}
              </div>
              <div class="flex flex-col items-end gap-1">
                ${canEdit() ? html`
                  <button class="btn-icon !w-7 !h-7 ${t.event_relevant ? '!text-amber-300' : ''}" data-tl-event="${t.id}" title="Event-relevant umschalten">${icon('flag', 'w-3.5 h-3.5')}</button>` : (t.event_relevant ? html`<span class="text-amber-300">${icon('flag', 'w-3.5 h-3.5')}</span>` : '')}
              </div>
            </div>
            ${canEdit() ? html`<div class="flex flex-wrap gap-1.5 mt-2">
              ${t.lent_to ? html`<button class="btn btn-sm btn-lime flex-1" data-tl-back="${t.id}">${icon('undo', 'w-3.5 h-3.5')} Wieder in der Halle</button>`
                : html`
              ${t.borrowed_by ? html`<button class="btn btn-sm flex-1" data-tl-return="${t.id}">${icon('undo', 'w-3.5 h-3.5')} Zurückgegeben</button>`
                : html`<button class="btn btn-sm flex-1" data-tl-borrow="${t.id}">${icon('play', 'w-3 h-3')} Nehme ich</button>`}
              ${floatBtn('tool', t.id)}
              <button class="btn btn-sm" data-tl-lend="${t.id}" title="Außer Haus verleihen (Kumpel, Firma …)">${icon('move', 'w-3.5 h-3.5')} Verleihen</button>`}
              <button class="btn btn-sm" data-tl-edit="${t.id}">${icon('edit', 'w-3.5 h-3.5')}</button>
              ${t.shelf_id ? html`<button class="btn btn-sm" data-tl-goto="${t.shelf_id}" data-level="${t.level || ''}" data-box="${t.box_id || ''}">${icon('target', 'w-3.5 h-3.5')}</button>` : ''}
            </div>` : ''}
          </div>`)}
        ${!visible.length ? html`<p class="text-sm text-slate-500">Keine Treffer.</p>` : ''}
      </div>

      <section class="pt-2">
        <div class="flex items-baseline justify-between mb-2">
          <h4 class="font-display text-[11px] tracking-[0.2em] text-fuchsia-300">${icon('star', 'w-3.5 h-3.5 inline')} WUNSCHLISTE</h4>
          <span class="text-xs font-display text-white">${euro(wish.reduce((a, t) => a + (t.price || 0), 0))}</span>
        </div>
        <div class="space-y-1.5">
          ${wish.map((t) => html`
            <div class="card px-3 py-2 flex items-center gap-2 text-sm">
              <div class="flex-1 min-w-0"><div class="text-white truncate">${t.url ? html`<a class="hover:text-cyan-300" href="${t.url}" target="_blank" rel="noopener">${t.name} ↗</a>` : t.name}</div>
                ${t.notes ? html`<div class="text-[11px] text-slate-500 truncate">${t.notes}</div>` : ''}</div>
              <span class="font-mono text-xs text-slate-300">${t.price ? euro(t.price) : ''}</span>
              ${canEdit() ? html`<button class="btn btn-sm btn-lime" data-tl-acquire="${t.id}" title="Gekauft: ins Inventar">${icon('check', 'w-3.5 h-3.5')}</button>
                <button class="btn-icon !w-7 !h-7" data-tl-edit="${t.id}">${icon('edit', 'w-3.5 h-3.5')}</button>` : ''}
            </div>`)}
          ${!wish.length ? html`<p class="text-sm text-slate-500">Wunschlos glücklich.</p>` : ''}
          ${canEdit() ? html`<button class="btn btn-sm w-full" data-tl-newwish>${icon('plus')} Wunsch hinzufügen</button>` : ''}
        </div>
      </section>
    </div>`);

  if (!container.dataset.boundTools) {
    container.dataset.boundTools = '1';
    const rerender = () => app.rerenderTab('tools');
    on(container, 'input', '[data-tl-q]', (_e, inp) => {
      toolState.q = inp.value;
      clearTimeout(container._tt);
      container._tt = setTimeout(async () => {
        const pos = inp.selectionStart;
        await renderToolsPanel(container);
        const ni = container.querySelector('[data-tl-q]');
        if (ni) { ni.focus(); ni.setSelectionRange(pos, pos); }
      }, 200);
    });
    on(container, 'click', '[data-tl-filter]', (_e, b) => { toolState.filter = b.dataset.tlFilter; rerender(); });
    on(container, 'click', '[data-tl-new]', () => openToolForm({}, rerender));
    on(container, 'click', '[data-tl-newwish]', () => openToolForm({ wishlist: 1 }, rerender));
    on(container, 'click', '[data-tl-edit]', async (_e, b) => {
      const list = await get('/tools');
      openToolForm(list.find((t) => t.id === Number(b.dataset.tlEdit)), rerender);
    });
    on(container, 'click', '[data-tl-borrow]', async (_e, b) => {
      const names = ['Ohne Auto', ...store.vehicles.map((v) => v.name)];
      const pick = await chooseDialog({ title: 'Werkzeug nehmen', text: 'An welchem Auto?', choices: names, allowText: false });
      if (!pick) return;
      const v = store.vehicles.find((x) => x.name === pick);
      try { await post(`/tools/${b.dataset.tlBorrow}/borrow`, { vehicle_id: v ? v.id : null }); ratchet(); buzz([30, 20, 30]); toast('Eingetragen. Bitte zurücklegen, wenn fertig!', 'ok'); rerender(); if (app.refreshHud) app.refreshHud(); } catch (err) { toastError(err); }
    });
    on(container, 'click', '[data-tl-return]', async (_e, b) => {
      try { await post(`/tools/${b.dataset.tlReturn}/return`); coin(); buzz(15); toast('Zurück an seinem Platz.', 'ok'); rerender(); if (app.refreshHud) app.refreshHud(); } catch (err) { toastError(err); }
    });
    // v5.2: Verleih außer Haus
    on(container, 'click', '[data-tl-lend]', async (_e, b) => {
      const list = await get('/tools');
      const t = list.find((x) => x.id === Number(b.dataset.tlLend));
      if (t) openLendDialog(t, rerender);
    });
    on(container, 'click', '[data-tl-back]', async (_e, b) => {
      try { await post(`/tools/${b.dataset.tlBack}/back`); coin(); buzz(15); toast('Wieder in der Halle, zurück an seinem Stammplatz.', 'ok'); rerender(); if (app.refreshHud) app.refreshHud(); } catch (err) { toastError(err); }
    });
    on(container, 'click', '[data-tl-event]', async (_e, b) => {
      const list = await get('/tools');
      const t = list.find((x) => x.id === Number(b.dataset.tlEvent));
      try { await put(`/tools/${t.id}`, { event_relevant: !t.event_relevant }); toast(t.event_relevant ? 'Nicht mehr auf Packlisten.' : 'Kommt ab jetzt auf jede Packliste.', 'ok'); rerender(); } catch (err) { toastError(err); }
    });
    on(container, 'click', '[data-tl-acquire]', async (_e, b) => {
      try { await post(`/tools/${b.dataset.tlAcquire}/acquire`); toast('Gekauft! Jetzt im Inventar.', 'ok'); rerender(); } catch (err) { toastError(err); }
    });
    on(container, 'click', '[data-tl-goto]', (_e, b) => app.navigate({ kind: 'shelf', shelfId: Number(b.dataset.tlGoto), level: Number(b.dataset.level) || null, boxId: Number(b.dataset.box) || null }));
  }
}

/**
 * v5.2: Schneller Verleih-Dialog "Außerhalb der Halle / Verliehen"
 * An wen · Verleihdatum (heute) · erwartete Rückgabe · Notiz
 */
export async function openLendDialog(t, onDone) {
  let names = [];
  try { names = await get('/tools/lend-names'); } catch { /* egal */ }
  const pool = [...new Set([...names, ...store.users.map((u) => u.name)])];
  const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const todayIso = iso(new Date());
  const plus = (n) => iso(new Date(Date.now() + n * 86400000));
  const body = el(html`<div>
    <form class="space-y-3" data-form>
      <label class="block"><span class="label">An wen verliehen? (Name / Firma / Kumpel)</span>
        <input class="input" name="to" list="lendNames" required autocomplete="off" placeholder="z. B. Max, Reifen Müller GmbH">
        <datalist id="lendNames">${pool.map((n) => html`<option value="${n}"></option>`)}</datalist></label>
      ${pool.length ? html`<div class="flex flex-wrap gap-1.5">${pool.slice(0, 8).map((n) => html`<button type="button" class="chip chip-btn" data-pick="${n}">${n}</button>`)}</div>` : ''}
      <div class="grid grid-cols-2 gap-3">
        <label><span class="label">Verleihdatum</span><input class="input" type="date" name="date" value="${todayIso}" max="${todayIso}"></label>
        <label><span class="label">Erwartete Rückgabe</span><input class="input" type="date" name="due" value="${plus(7)}" min="${todayIso}"></label>
      </div>
      <div class="flex flex-wrap gap-1.5">${[[1, 'morgen'], [3, '3 Tage'], [7, '1 Woche'], [14, '2 Wochen'], [30, '1 Monat']].map(([n, l]) => html`<button type="button" class="chip chip-btn" data-due="${plus(n)}">${l}</button>`)}
        <button type="button" class="chip chip-btn" data-due="">offen</button></div>
      <label class="block"><span class="label">Notiz (optional)</span><input class="input" name="note" placeholder="z. B. mit Koffer und 2 Akkus"></label>
    </form></div>`);
  const m = openModal({
    title: `${t.name} verleihen`, subtitle: 'Status: Außerhalb der Halle / Verliehen', size: 'sm', iconName: 'move', body,
    footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Verliehen</button>`
  });
  const f = body.querySelector('[data-form]');
  on(body, 'click', '[data-pick]', (_e, b) => { f.to.value = b.dataset.pick; });
  on(body, 'click', '[data-due]', (_e, b) => { f.due.value = b.dataset.due; });
  setTimeout(() => f.to.focus(), 60);
  const save = async () => {
    if (!f.reportValidity()) return;
    const d = formData(f);
    try {
      await post(`/tools/${t.id}/lend`, { to: d.to, date: d.date, due: d.due || null, note: d.note });
      m.close();
      ratchet();
      toast(`${t.name} ist verliehen an ${d.to}${d.due ? `, zurück bis ${fmtDate(d.due)}` : ''}.`, 'ok');
      if (app.refreshHud) app.refreshHud();
      if (onDone) onDone();
    } catch (err) { toastError(err); }
  };
  m.footer.querySelector('[data-save]').addEventListener('click', save);
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

export async function openToolForm(tool = {}, onSaved) {
  const isNew = !tool.id;
  let boxes = [];
  let cons = [];
  try { [boxes, cons] = await Promise.all([get('/boxes'), get('/consumables')]); } catch { /* egal */ }
  const shelves = store.objects.filter((o) => o.type === 'shelf');
  const t = { qty: 1, ...tool };
  const body = el(html`<div>
    <form class="grid sm:grid-cols-2 gap-3" data-form>
      <label class="sm:col-span-2"><span class="label">Name</span><input class="input" name="name" value="${t.name || ''}" required placeholder="z. B. Schlagschrauber, 17er Nuss"></label>
      <label><span class="label">Kategorie</span><input class="input" name="category" value="${t.category || ''}" placeholder="Heben, Nüsse, Elektro …"></label>
      <label><span class="label">Anzahl</span><input class="input" type="number" min="1" name="qty" value="${t.qty}"></label>
      ${t.wishlist ? html`
        <label><span class="label">Preis €</span><input class="input" type="number" step="0.01" name="price" value="${t.price || ''}"></label>
        <label><span class="label">Shop-Link</span><input class="input" name="url" value="${t.url || ''}"></label>
        <input type="hidden" name="wishlist" value="1">` : html`
        <label class="sm:col-span-2"><span class="label">Fester Ort (Freitext)</span><input class="input" name="location_text" value="${t.location_text || ''}" placeholder="Werkzeugwand, Werkzeugwagen Schublade 2 …"></label>
        <label><span class="label">oder Regal</span><select class="select" name="shelf_id"><option value="">kein</option>${shelves.map((s) => html`<option value="${s.id}" ${t.shelf_id === s.id ? 'selected' : ''}>${s.code}</option>`)}</select></label>
        <label><span class="label">Eurobox</span><select class="select" name="box_id"><option value="">lose</option>${boxes.map((b) => html`<option value="${b.id}" ${t.box_id === b.id ? 'selected' : ''}>${b.shelf_code} · E${b.level} · ${b.label}</option>`)}</select></label>
        <label class="sm:col-span-2 flex items-center gap-3 card px-3 py-2.5 cursor-pointer"><input type="checkbox" class="check" name="event_relevant" ${t.event_relevant ? 'checked' : ''}><span class="text-sm"><b class="text-amber-300">Event-tauglich</b> · kommt auf jede Packliste (genau einmal)</span></label>`}
      <label class="sm:col-span-2"><span class="label">Notizen</span><input class="input" name="notes" value="${t.notes || ''}"></label>
    </form></div>`);
  const m = openModal({
    title: isNew ? (t.wishlist ? 'Neuer Wunsch' : 'Neues Werkzeug') : t.name, size: 'md', iconName: t.wishlist ? 'star' : 'wrench', body,
    footer: html`${!isNew ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash')}</button>` : ''}<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Speichern</button>`
  });
  m.footer.querySelector('[data-save]').addEventListener('click', async () => {
    const f = body.querySelector('[data-form]');
    if (!f.reportValidity()) return;
    const d = formData(f);
    if (d.wishlist === '1') d.wishlist = true;
    try {
      if (isNew) await post('/tools', d); else await put(`/tools/${t.id}`, d);
      m.close(); toast('Gespeichert.', 'ok'); onSaved && onSaved();
    } catch (err) { toastError(err); }
  });
  const delBtn = m.footer.querySelector('[data-del]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(`„${t.name}“ löschen?`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/tools/${t.id}`); m.close(); onSaved && onSaved(); } catch (err) { toastError(err); }
  });
}

