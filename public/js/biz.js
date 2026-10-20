/**
 * v5: Büro-/Enterprise-Ansicht ("Stealth-Modus")
 * ------------------------------------------------------------
 * Umschalten: Alt+B (hin und zurück), Esc (sofort ins Büro, wenn kein Dialog offen ist)
 * oder über das Profilmenü (Klick auf den eigenen Namen oben rechts).
 * Die Wahl wird lokal im Browser gemerkt (localStorage "halle.view").
 *
 * Gleiche Daten, gleiche Funktionen, nur eine nüchterne ERP-Oberfläche:
 *   Stellplatz- & Kapazitätsmatrix  (statt Hallenplan, Umsetzen per Drag & Drop oder Auswahlliste)
 *   Inventar                        (Teile, Werkzeug, Euroboxen als Tabelle mit Filter, Sortierung, Suche)
 *   Materialentnahme                (Verbrauchsbeleg erfassen, Bestand, Belegjournal mit Storno, Bedarf)
 *   Projekte & Termine              (Event-Kalender mit Ausrüstungs-Checkliste)
 * Das Setup-Sheet zeigt im Büro eine Kennzahlentabelle "Fahrwerksgeometrie & Prüfprotokoll" (setup.js).
 *
 * Keine Server- oder Datenbankänderungen: alles läuft über die bestehenden API-Endpunkte.
 */
import { store, app, setState, subscribe, canEdit, refreshVehicles, applyViewLabels } from './state.js';
import { get, post, put } from './api.js';
import { $, html, setHTML, el, on, icon, toast, toastError, topModal, fmtDate } from './ui.js';
import { setQuiet, isMuted, toggleMute } from './sfx.js';
import { openPartForm, openToolForm } from './storage.js';
import { openStockIn, openGebinde, openQuickUse } from './quickuse.js';
import { openPacklist, openEventEditor } from './events.js';
import { applyHud, fmtQty } from './hud.js';

const VIEW_KEY = 'halle.view';
const TAB_KEY = 'halle.biz.tab';
const GAME_TITLE = 'HALLE//OS · Werkstatt-Management';
const BIZ_TITLE = 'Fleet & Resource Management Portal';
const BIZ_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232563eb'/%3E%3Cg fill='%23fff'%3E%3Crect x='7' y='7' width='7' height='7' rx='1'/%3E%3Crect x='18' y='7' width='7' height='7' rx='1'/%3E%3Crect x='7' y='18' width='7' height='7' rx='1'/%3E%3Crect x='18' y='18' width='7' height='7' rx='1'/%3E%3C/g%3E%3C/svg%3E";
let gameIcon = null;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privates Fenster */ } };

export const isBiz = () => document.documentElement.classList.contains('biz');

/* Fahrzeugstatus in Büro-Sprache */
export const BIZ_STATUS = {
  ready: { label: 'Betriebsbereit', cls: 'ok' },
  work: { label: 'In Wartung', cls: 'warn' },
  parts: { label: 'Wartet auf Freigabe', cls: 'info' }
};
const statusBadge = (s) => { const b = BIZ_STATUS[s] || { label: s, cls: 'grey' }; return html`<span class="bz-badge ${b.cls}">${b.label}</span>`; };
const KIND_ZONE = { lift: 'Hebebühnen', buffer: 'Pufferflächen', standard: 'Stellplätze', chill: 'Stellplätze' };
const ZONE_ORDER = ['Hebebühnen', 'Stellplätze', 'Pufferflächen', 'Sonstige'];

/* ====================================================================== */
/* Umschalten                                                             */
/* ====================================================================== */
function setFavicon(biz) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (gameIcon === null) gameIcon = link.getAttribute('href');
  link.setAttribute('href', biz ? BIZ_ICON : gameIcon);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', biz ? '#ffffff' : '#0a0d12');
}

function syncMapFlag() {
  document.body.classList.toggle('biz-map', isBiz() && (!!store.builder || store.mode === 'blueprint'));
}

export function setBiz(on) {
  const biz = !!on;
  document.documentElement.classList.toggle('biz', biz);
  lsSet(VIEW_KEY, biz ? 'biz' : 'game');
  setQuiet(biz);
  document.title = biz ? BIZ_TITLE : GAME_TITLE;
  setFavicon(biz);
  applyViewLabels();
  closeMenu();
  // Versorgungsplan (Blueprint) ist eine reine Grafik: im Büro zurück auf die Übersicht
  if (biz && store.mode === 'blueprint' && app.setMode) app.setMode('hall');
  syncMapFlag();
  setState({ biz }, ['biz']);
  if (biz) renderWorkspace();
  else if (app.map) requestAnimationFrame(() => { app.map.resize(); app.map.fit(false); });
}
export const toggleBiz = () => setBiz(!isBiz());

/* ====================================================================== */
/* Profilmenü (Ansicht, Ton, Abmelden)                                    */
/* ====================================================================== */
let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', outside, true);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('#userChip')) closeMenu(); }

export function openProfileMenu(anchor, { onLogout } = {}) {
  if (menuEl) { closeMenu(); return; }
  const me = store.me;
  if (!me) return;
  const biz = isBiz();
  const role = { admin: biz ? 'Administrator' : 'Admin', schrauber: biz ? 'Sachbearbeitung' : 'Schrauber', gast: biz ? 'Lesezugriff' : 'Hall Pass · nur lesen' }[me.role] || me.role;
  menuEl = el(html`<div class="bz-menu" role="menu">
    <div class="who"><b>${me.name}</b><span>${role}</span></div>
    <div class="sec">Ansicht</div>
    <button class="it ${biz ? '' : 'on'}" data-view="game" role="menuitemradio"><span class="radio"></span>Ansicht: Werkstatt (Game)</button>
    <button class="it ${biz ? 'on' : ''}" data-view="biz" role="menuitemradio"><span class="radio"></span>Ansicht: Enterprise (Büro / ERP)<span class="r"><kbd>Alt</kbd>+<kbd>B</kbd></span></button>
    ${biz ? '' : html`<button class="it" data-act="sound">${isMuted() ? '🔇' : '🔊'} Ton ${isMuted() ? 'einschalten' : 'ausschalten'}</button>`}
    <hr>
    <button class="it" data-act="logout">${icon('logout', 'w-4 h-4')} Profil wechseln / Abmelden</button>
    <div class="sec" style="text-transform:none;letter-spacing:0;font-weight:400">Alt+B wechselt die Ansicht. Esc schaltet sofort ins Büro.</div>
  </div>`);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = `${Math.round(r.bottom + 6)}px`;
  menuEl.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  document.body.appendChild(menuEl);
  menuEl.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    const a = e.target.closest('[data-act]');
    if (v) { setBiz(v.dataset.view === 'biz'); closeMenu(); }
    if (a && a.dataset.act === 'sound') { toggleMute(); closeMenu(); }
    if (a && a.dataset.act === 'logout') { closeMenu(); if (onLogout) onLogout(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

/* ====================================================================== */
/* Tastenkürzel                                                           */
/* ====================================================================== */
let lastDialogEsc = 0;
function onKey(e) {
  // Boss-Key: Alt+B (auch während man tippt; auf dem Mac ist Alt = Option)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') {
    e.preventDefault();
    e.stopPropagation();
    toggleBiz();
    return;
  }
  if (e.key !== 'Escape') return;
  if (menuEl) { closeMenu(); lastDialogEsc = Date.now(); return; }
  // Esc schließt zuerst offene Dialoge (ui.js). Erst ein Esc ohne Dialog schaltet ins Büro.
  if (topModal() || document.querySelector('.modal-wrap')) { lastDialogEsc = Date.now(); return; }
  if (isBiz()) return;
  if (Date.now() - lastDialogEsc < 700) return;
  if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (store.builder || store.mode === 'blueprint') return;   // dort beendet Esc das Zeichnen
  setBiz(true);
}

/* ====================================================================== */
/* Arbeitsbereich                                                         */
/* ====================================================================== */
const TABS = [
  ['slots', 'Stellplatz- & Kapazitätsmatrix', 'Stellplätze'],
  ['inventory', 'Inventar & Lagerbestand', 'Inventar'],
  ['material', 'Materialentnahme / Verbrauchsbeleg erfassen', 'Materialentnahme'],
  ['projects', 'Projekte & Termine', 'Projekte']
];
let tab = TABS.some(([k]) => k === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : 'slots';

function tabCount(key) {
  const h = store.hud || {};
  if (key === 'slots') return store.vehicles.length;
  if (key === 'material') return ((h.critical || []).length + (h.low || []).length) || '';
  if (key === 'projects') return (store.events || []).length || '';
  return '';
}

export function showBizTab(key) {
  if (!TABS.some(([k]) => k === key)) return;
  tab = key;
  lsSet(TAB_KEY, key);
  if (window.innerWidth < 1024 && app.setMobileView) app.setMobileView('map');
  renderWorkspace();
}

function renderWorkspace() {
  const root = $('#bizWorkspace');
  if (!root || !isBiz() || !store.me) return;
  const t = TABS.find(([k]) => k === tab);
  setHTML(root, html`<div class="bz">
    <div class="bz-head"><div class="flex-1 min-w-0">
      <div class="bz-crumb">${store.hall && store.hall.name ? store.hall.name : 'Standort'} / Operations / ${t[2]}</div>
      <div class="bz-title">${t[1]}</div></div>
      <div class="text-xs text-slate-500 bz-stand">Stand: ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</div>
    </div>
    <nav class="bz-tabs" role="tablist">${TABS.map(([k, , short]) => {
      const n = tabCount(k);
      return html`<button class="bz-tab ${k === tab ? 'on' : ''}" data-bztab="${k}">${short}${n !== '' ? html`<span class="bz-count">${n}</span>` : ''}</button>`;
    })}</nav>
    <div data-bzbody></div>
  </div>`);
  const body = root.querySelector('[data-bzbody]');
  ({ slots: renderSlots, inventory: renderInventory, material: renderMaterial, projects: renderProjects })[tab](body);
}

function refreshTabs() {
  const nav = document.querySelector('#bizWorkspace .bz-tabs');
  if (!nav) return;
  nav.querySelectorAll('[data-bztab]').forEach((b) => {
    const n = tabCount(b.dataset.bztab);
    let c = b.querySelector('.bz-count');
    if (n === '' && c) c.remove();
    if (n !== '') { if (!c) { c = document.createElement('span'); c.className = 'bz-count'; b.appendChild(c); } c.textContent = n; }
  });
}
const bodyEl = () => document.querySelector('#bizWorkspace [data-bzbody]');

/* ---------------------------------------------------------------------- */
/* 1) Stellplatz- & Kapazitätsmatrix                                      */
/* ---------------------------------------------------------------------- */
const natural = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true });
const slotsList = () => store.objects.filter((o) => o.type === 'slot').sort((a, b) => natural(a.code, b.code));
const capOf = (s) => Math.max(1, Number(s.props && s.props.capacity) || 1);
const occOf = (s) => store.vehicles.filter((v) => v.slot_id === s.id).sort((a, b) => (a.slot_pos || 0) - (b.slot_pos || 0));
const zoneOf = (s) => KIND_ZONE[s.props && s.props.kind] || 'Sonstige';
/** Fahrzeuge den Ebenen eines Platzes zuordnen (slot_pos 0 = oben, 1 = unten; Ausreißer füllen freie Ebenen) */
function positions(s, occ) {
  const cap = capOf(s);
  const out = Array(cap).fill(null);
  const rest = [];
  occ.forEach((v) => { const p = Number(v.slot_pos) || 0; if (p < cap && !out[p]) out[p] = v; else rest.push(v); });
  rest.forEach((v) => { const i = out.indexOf(null); if (i >= 0) out[i] = v; else out.push(v); });
  return out;
}
const slotName = (s) => `${s.code}${s.label ? ` · ${s.label}` : ''}`;

function moveOptions(v) {
  const opts = slotsList().map((s) => {
    const occ = occOf(s).filter((x) => x.id !== v.id);
    const cap = capOf(s);
    const free = cap - occ.length;
    const own = v.slot_id === s.id;
    const note = own ? 'aktueller Platz' : free > 0 ? (cap > 1 ? `${free} von ${cap} frei` : 'frei') : `belegt (${occ.map((x) => x.name).join(', ')}) · tauschen`;
    return html`<option value="${s.id}" ${own ? 'disabled' : ''}>${slotName(s)} (${note})</option>`;
  });
  return html`<option value="">Umsetzen nach …</option>${opts}${v.slot_id ? html`<option value="extern">Außerhalb (Paddock, Hänger, Werkstatt …)</option>` : ''}`;
}

function vehicleCells(v) {
  return html`
    <td><span class="bz-drag" aria-hidden="true"></span><button class="bz-link" data-open="${v.id}">${v.name}</button></td>
    <td class="mono">${v.plate || '-'}</td>
    <td>${canEdit() ? html`<select class="select sel" data-status="${v.id}">${Object.entries(BIZ_STATUS).map(([k, b]) => html`<option value="${k}" ${v.status === k ? 'selected' : ''}>${b.label}</option>`)}</select>` : statusBadge(v.status)}</td>
    <td>${canEdit() ? html`<select class="select sel" data-move="${v.id}">${moveOptions(v)}</select>` : html`<span class="muted">-</span>`}</td>
    <td class="whitespace-nowrap"><button class="btn btn-sm" data-open="${v.id}">Akte</button> <button class="btn btn-sm" data-proto="${v.id}" title="Fahrwerksgeometrie & Prüfprotokoll">Protokoll</button></td>`;
}

function renderSlots(body) {
  const slots = slotsList();
  const capTotal = slots.reduce((a, s) => a + capOf(s), 0);
  const inside = store.vehicles.filter((v) => v.slot_id);
  const extern = store.vehicles.filter((v) => !v.slot_id).sort((a, b) => natural(a.name, b.name));
  const cnt = (st) => store.vehicles.filter((v) => v.status === st).length;
  const util = capTotal ? Math.round((inside.length / capTotal) * 100) : 0;
  const zones = ZONE_ORDER.map((z) => [z, slots.filter((s) => zoneOf(s) === z)]).filter(([, l]) => l.length);
  const dnd = canEdit();

  const rows = zones.map(([zone, list]) => html`
    <tr class="zone"><td colspan="8">${zone} · ${list.reduce((a, s) => a + capOf(s), 0)} Plätze</td></tr>
    ${list.map((s) => {
      const cap = capOf(s);
      const occ = occOf(s);
      const placed = positions(s, occ);
      return placed.map((v, i) => {
        const pos = cap > 1 ? (i === 0 ? 'Ebene oben' : i === 1 ? 'Ebene unten' : `Ebene ${i + 1}`) : '-';
        return html`<tr data-slot="${s.id}" ${v && dnd ? html`draggable="true" data-drag="${v.id}"` : ''}>
          ${i === 0 ? html`<td rowspan="${placed.length}"><b>${s.code}</b> <span class="muted">${s.label || ''}</span>${s.props && s.props.blocksLane ? html`<div><span class="bz-badge warn nodot mt-1">Blockiert Durchfahrt</span></div>` : ''}</td>` : ''}
          <td class="muted">${pos}</td>
          ${v ? vehicleCells(v) : html`<td colspan="5" class="empty">frei${dnd ? ' · Fahrzeug hierher ziehen' : ''}</td>`}
          <td class="num">${i === 0 ? html`${occ.length}/${cap}` : ''}</td>
        </tr>`;
      });
    })}`);

  const resources = store.objects.filter((o) => ['shelf', 'tyrestack', 'fridge', 'toolwall', 'workbench'].includes(o.type))
    .sort((a, b) => natural(a.type + a.code, b.type + b.code));
  const RES = { shelf: 'Regal / Lagerplatz', tyrestack: 'Reifenlager', fridge: 'Verpflegung (Kühlschrank)', toolwall: 'Werkzeugwand', workbench: 'Werkbank' };

  setHTML(body, html`
    <div class="bz-kpis">
      <div class="bz-kpi"><div class="k">Kapazität Halle</div><div class="v">${capTotal}</div><div class="s">${slots.length} Stellplätze</div></div>
      <div class="bz-kpi"><div class="k">Auslastung</div><div class="v">${util} %</div><div class="s">${inside.length} belegt · ${Math.max(0, capTotal - inside.length)} frei</div></div>
      <div class="bz-kpi"><div class="k">Betriebsbereit</div><div class="v">${cnt('ready')}</div><div class="s">von ${store.vehicles.length} Fahrzeugen</div></div>
      <div class="bz-kpi ${cnt('work') ? 'warn' : ''}"><div class="k">In Wartung</div><div class="v">${cnt('work')}</div><div class="s">aktive Aufträge</div></div>
      <div class="bz-kpi"><div class="k">Wartet auf Freigabe</div><div class="v">${cnt('parts')}</div><div class="s">Teile / Material offen</div></div>
      <div class="bz-kpi"><div class="k">Außerhalb</div><div class="v">${extern.length}</div><div class="s">Fremdstandorte</div></div>
    </div>
    <div class="bz-card">
      <div class="bz-card-head"><h3>Stellplatzbelegung<span class="hint">${dnd ? 'Zeile per Drag & Drop auf einen Platz ziehen oder „Umsetzen nach“ wählen' : 'Lesezugriff'}</span></h3></div>
      <div class="bz-scroll"><table class="bz-table">
        <thead><tr><th>Zone / Stellplatz</th><th>Position</th><th>Fahrzeug</th><th>Kennzeichen</th><th>Status</th><th>Disposition</th><th>Dokumente</th><th class="num">Belegt</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="bz-card">
      <div class="bz-card-head"><h3>Fahrzeuge außerhalb der Halle<span class="hint">${extern.length} Datensätze</span></h3></div>
      ${extern.length ? html`<div class="bz-scroll"><table class="bz-table">
        <thead><tr><th>Standort</th><th>Fahrzeug</th><th>Kennzeichen</th><th>Status</th><th>Disposition</th><th>Dokumente</th></tr></thead>
        <tbody>${extern.map((v) => html`<tr data-extern ${dnd ? html`draggable="true" data-drag="${v.id}"` : ''}><td class="muted">${v.extern_location || 'Paddock'}</td>${vehicleCells(v)}</tr>`)}</tbody>
      </table></div>` : html`<div class="bz-none">Alle Fahrzeuge stehen in der Halle.</div>`}
    </div>
    <div class="bz-card">
      <div class="bz-card-head"><h3>Hallenressourcen<span class="hint">Lagerplätze, Reifenlager, Werkzeug, Verpflegung</span></h3></div>
      <div class="bz-scroll"><table class="bz-table">
        <thead><tr><th>Kennung</th><th>Bezeichnung</th><th>Ressourcentyp</th><th></th></tr></thead>
        <tbody>${resources.map((o) => html`<tr class="clickable" data-res="${o.id}"><td class="mono">${o.code || '-'}</td><td>${o.label || RES[o.type]}</td><td class="muted">${RES[o.type]}</td><td class="num"><button class="btn btn-sm" data-res="${o.id}">Öffnen</button></td></tr>`)}
          ${!resources.length ? html`<tr><td colspan="4" class="empty">Keine Ressourcen im Hallenplan hinterlegt.</td></tr>` : ''}</tbody>
      </table></div>
    </div>`);
}

let dragId = null;
function bindSlotEvents(root) {
  on(root, 'change', '[data-status]', async (_e, s) => {
    try {
      await put(`/vehicles/${s.dataset.status}`, { status: s.value });
      await refreshVehicles();
      toast(`Status geändert: ${BIZ_STATUS[s.value].label}`, 'ok');
    } catch (err) { toastError(err); refreshVehicles().catch(() => {}); }
  });
  on(root, 'change', '[data-move]', (_e, s) => {
    const v = store.vehicles.find((x) => x.id === Number(s.dataset.move));
    const val = s.value;
    s.value = '';
    if (!v || !val) return;
    if (val === 'extern') { app.moveVehicle(v, { kind: 'extern' }); return; }
    moveTo(v, Number(val));
  });
  on(root, 'click', '[data-open]', (e, b) => { e.stopPropagation(); app.openCockpit(Number(b.dataset.open)); });
  on(root, 'click', '[data-proto]', (e, b) => { e.stopPropagation(); app.openCockpit(Number(b.dataset.proto), { tab: 'setup' }); });
  on(root, 'click', '[data-res]', (e, r) => {
    e.stopPropagation();
    const o = store.objects.find((x) => x.id === Number(r.dataset.res));
    if (!o) return;
    if (o.type === 'shelf') app.openShelf(o.id);
    else if (o.type === 'tyrestack') app.openTyreHub();
    else if (o.type === 'fridge') app.openFridge();
    else { invState.type = 'tool'; showBizTab('inventory'); }
  });
  // Drag & Drop zwischen Tabellenzeilen
  root.addEventListener('dragstart', (e) => {
    const tr = e.target.closest && e.target.closest('[data-drag]');
    if (!tr || tab !== 'slots') return;
    dragId = Number(tr.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragId)); } catch { /* egal */ }
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const tr = e.target.closest('tr[data-slot]');
    root.querySelectorAll('tr.drop-ok').forEach((x) => { if (x !== tr) x.classList.remove('drop-ok'); });
    if (!tr) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll(`tr[data-slot="${tr.dataset.slot}"]`).forEach((x) => x.classList.add('drop-ok'));
  });
  root.addEventListener('drop', (e) => {
    const tr = e.target.closest('tr[data-slot]');
    const id = dragId;
    dragId = null;
    root.querySelectorAll('tr.drop-ok').forEach((x) => x.classList.remove('drop-ok'));
    if (!tr || !id) return;
    e.preventDefault();
    const v = store.vehicles.find((x) => x.id === id);
    if (v) moveTo(v, Number(tr.dataset.slot));
  });
  root.addEventListener('dragend', () => { dragId = null; root.querySelectorAll('tr.drop-ok').forEach((x) => x.classList.remove('drop-ok')); });
}

function moveTo(v, slotId) {
  const slot = store.objects.find((o) => o.id === slotId);
  if (!slot) return;
  const occupants = store.vehicles.filter((x) => x.slot_id === slot.id && x.id !== v.id);
  if (slot.id === v.slot_id) return;
  app.moveVehicle(v, { kind: 'slot', slot, full: occupants.length >= capOf(slot), occupants });
}

/* ---------------------------------------------------------------------- */
/* 2) Inventar (Teile, Werkzeug, Euroboxen)                               */
/* ---------------------------------------------------------------------- */
const invState = { q: '', type: '', loc: '', status: '', sort: 'name', dir: 1, limit: 250, data: null, loading: false };

async function loadInventory() {
  invState.loading = true;
  try {
    const [parts, tools, boxes] = await Promise.all([get('/parts'), get('/tools'), get('/boxes')]);
    invState.data = { parts, tools, boxes };
  } catch (err) { toastError(err); invState.data = invState.data || { parts: [], tools: [], boxes: [] }; }
  invState.loading = false;
}

const floatSet = () => new Set(((store.hud && store.hud.floating) || []).map((f) => `${f.kind}:${f.ref_id}`));
const locText = (r) => [r.shelf_code, r.level ? `Ebene ${r.level}` : '', r.box_label ? `Box ${r.box_label}` : ''].filter(Boolean).join(' · ');

function inventoryRows() {
  const { parts, tools, boxes } = invState.data;
  const fl = floatSet();
  const perBox = new Map();
  parts.forEach((p) => { if (p.box_id) perBox.set(p.box_id, (perBox.get(p.box_id) || 0) + 1); });
  tools.forEach((t) => { if (t.box_id) perBox.set(t.box_id, (perBox.get(t.box_id) || 0) + 1); });
  const rows = [];
  parts.forEach((p) => {
    const pack = p.pack_size ? `${p.qty} × ${fmtQty(p.pack_size, p.consumable_kind || 'piece')} ${p.pack_unit || ''}`.trim() : String(p.qty);
    const floating = fl.has(`part:${p.id}`);
    const st = floating ? ['In Verwendung', 'warn'] : p.qty <= 0 ? ['Kein Bestand', 'bad'] : p.open_rest != null ? ['Angebrochen', 'info'] : ['Am Lager', 'ok'];
    rows.push({
      key: `part:${p.id}`, type: 'part', typeLabel: 'Material / Teil', ref: p, name: p.name, sub: [p.part_number, p.consumable_name ? `Gebinde: ${p.consumable_name}` : ''].filter(Boolean).join(' · '),
      category: p.category || '', qty: p.qty, qtyText: pack, loc: locText(p), shelf: p.shelf_code || '',
      assign: p.vehicle_name || (p.universal ? 'Universal' : p.foreign_model ? `passt zu ${p.foreign_model}` : ''),
      status: st[0], statusCls: st[1], cond: p.condition || '', event: !!p.event_relevant
    });
  });
  tools.forEach((t) => {
    const floating = fl.has(`tool:${t.id}`);
    const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const st = t.wishlist ? ['Beschaffung geplant', 'grey']
      : t.lent_to ? (t.lent_due && t.lent_due < todayIso ? [`Rückgabe überfällig: ${t.lent_to}`, 'bad'] : [`Verliehen an ${t.lent_to}${t.lent_due ? ` bis ${fmtDate(t.lent_due)}` : ''}`, 'warn'])
      : t.borrowed_by ? [`Ausgegeben an ${t.borrowed_by_name || '?'}${t.borrowed_vehicle_name ? ` (${t.borrowed_vehicle_name})` : ''}`, 'warn'] : floating ? ['In Verwendung', 'warn'] : ['Verfügbar', 'ok'];
    rows.push({
      key: `tool:${t.id}`, type: 'tool', typeLabel: 'Betriebsmittel', ref: t, name: t.name, sub: t.notes || '', category: t.category || '', qty: t.qty, qtyText: String(t.qty),
      loc: locText(t) || t.location_text || '', shelf: t.shelf_code || '', assign: '', status: st[0], statusCls: st[1], event: !!t.event_relevant,
      wish: !!t.wishlist, borrowed: !!t.borrowed_by || !!t.lent_to
    });
  });
  boxes.forEach((b) => {
    const floating = fl.has(`box:${b.id}`);
    const n = perBox.get(b.id) || 0;
    rows.push({
      key: `box:${b.id}`, type: 'box', typeLabel: 'Behälter (Eurobox)', ref: b, name: b.label, sub: b.notes || '', category: 'Lagerbehälter', qty: n, qtyText: `${n} Pos.`,
      loc: [b.shelf_code, b.level ? `Ebene ${b.level}` : '', b.position ? `Platz ${b.position}` : ''].filter(Boolean).join(' · '), shelf: b.shelf_code || '', assign: '',
      status: floating ? 'Entnommen' : 'Eingelagert', statusCls: floating ? 'warn' : 'ok', event: false
    });
  });
  return rows;
}

function filteredInventory() {
  const q = invState.q.trim().toLowerCase();
  let rows = inventoryRows().filter((r) => {
    if (invState.type && r.type !== invState.type) return false;
    if (invState.loc && r.shelf !== invState.loc) return false;
    if (invState.status === 'ok' && r.statusCls !== 'ok') return false;
    if (invState.status === 'out' && !(r.statusCls === 'warn' || r.statusCls === 'bad')) return false;
    if (invState.status === 'event' && !r.event) return false;
    if (invState.status === 'wish' && !r.wish) return false;
    if (q && !`${r.name} ${r.sub} ${r.category} ${r.loc} ${r.assign} ${r.status}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const k = invState.sort;
  const d = invState.dir;
  rows = rows.sort((a, b) => (k === 'qty' ? (a.qty - b.qty) * d : natural(a[k] || '', b[k] || '') * d) || natural(a.name, b.name));
  return rows;
}

function renderInventory(body) {
  if (!invState.data) {
    setHTML(body, html`<div class="bz-card"><div class="bz-none">Lade Inventardaten …</div></div>`);
    if (!invState.loading) loadInventory().then(() => { if (tab === 'inventory' && bodyEl()) renderInventory(bodyEl()); });
    return;
  }
  const all = inventoryRows();
  const shelves = [...new Set(all.map((r) => r.shelf).filter(Boolean))].sort(natural);
  const cnt = (t) => all.filter((r) => r.type === t).length;
  setHTML(body, html`
    <div class="bz-kpis">
      <div class="bz-kpi"><div class="k">Material / Teile</div><div class="v">${cnt('part')}</div><div class="s">Positionen</div></div>
      <div class="bz-kpi"><div class="k">Betriebsmittel</div><div class="v">${cnt('tool')}</div><div class="s">${all.filter((r) => r.borrowed).length} ausgegeben</div></div>
      <div class="bz-kpi"><div class="k">Behälter</div><div class="v">${cnt('box')}</div><div class="s">${shelves.length} Lagerplätze</div></div>
      <div class="bz-kpi ${all.some((r) => r.statusCls === 'warn') ? 'warn' : ''}"><div class="k">Außer Lagerort</div><div class="v">${all.filter((r) => r.statusCls === 'warn').length}</div><div class="s">in Verwendung / ausgegeben</div></div>
    </div>
    <div class="bz-card">
      <div class="bz-card-head"><h3>Bestandsliste</h3>
        ${canEdit() ? html`<button class="btn btn-sm" data-inv-new="part">${icon('plus', 'w-3.5 h-3.5')} Material</button><button class="btn btn-sm" data-inv-new="tool">${icon('plus', 'w-3.5 h-3.5')} Betriebsmittel</button>` : ''}
        <button class="btn btn-sm" data-inv-reload title="Aktualisieren">${icon('refresh', 'w-3.5 h-3.5')}</button>
        <button class="btn btn-sm" data-inv-csv>${icon('download', 'w-3.5 h-3.5')} CSV</button>
      </div>
      <div class="bz-filter">
        <input class="input grow" type="search" placeholder="Suche nach Bezeichnung, Kategorie, Lagerort, Fahrzeug …" value="${invState.q}" data-inv-q>
        <select class="select" data-inv-f="type">
          <option value="">Alle Objektarten</option>
          ${[['part', 'Material / Teile'], ['tool', 'Betriebsmittel'], ['box', 'Behälter']].map(([k, l]) => html`<option value="${k}" ${invState.type === k ? 'selected' : ''}>${l}</option>`)}
        </select>
        <select class="select" data-inv-f="loc"><option value="">Alle Lagerplätze</option>${shelves.map((s) => html`<option value="${s}" ${invState.loc === s ? 'selected' : ''}>${s}</option>`)}</select>
        <select class="select" data-inv-f="status">
          ${[['', 'Alle Status'], ['ok', 'Verfügbar / am Lager'], ['out', 'Außer Lagerort / kein Bestand'], ['event', 'Event-relevant'], ['wish', 'Beschaffung geplant']].map(([k, l]) => html`<option value="${k}" ${invState.status === k ? 'selected' : ''}>${l}</option>`)}
        </select>
        <span class="meta" data-inv-meta></span>
      </div>
      <div class="bz-scroll" data-inv-table></div>
    </div>`);
  renderInventoryTable();
}

function renderInventoryTable() {
  const box = document.querySelector('#bizWorkspace [data-inv-table]');
  if (!box) return;
  const rows = filteredInventory();
  const shown = rows.slice(0, invState.limit);
  const th = (k, l, cls = '') => html`<th class="${cls}" data-sort="${k}">${l}${invState.sort === k ? html`<span class="arr">${invState.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
  setHTML(box, html`<table class="bz-table">
    <thead><tr>${th('typeLabel', 'Objektart')}${th('name', 'Bezeichnung')}${th('category', 'Kategorie')}${th('qty', 'Menge', 'num')}${th('loc', 'Lagerort')}${th('assign', 'Zuordnung')}${th('status', 'Status')}</tr></thead>
    <tbody>${shown.map((r) => html`<tr class="clickable" data-inv="${r.key}">
      <td class="muted whitespace-nowrap">${r.typeLabel}</td>
      <td><div class="font-medium">${r.name}</div>${r.sub ? html`<div class="text-[11px] text-slate-500 truncate max-w-[22rem]">${r.sub}</div>` : ''}</td>
      <td class="muted">${r.category || '-'}</td>
      <td class="num whitespace-nowrap">${r.qtyText}</td>
      <td class="muted">${r.loc || '-'}</td>
      <td class="muted">${r.assign || '-'}</td>
      <td><span class="bz-badge ${r.statusCls}">${r.status}</span>${r.event ? html` <span class="bz-badge grey nodot">Event</span>` : ''}</td>
    </tr>`)}
    ${!shown.length ? html`<tr><td colspan="7" class="empty">Keine Datensätze zu diesem Filter.</td></tr>` : ''}</tbody>
  </table>
  ${rows.length > shown.length ? html`<div class="p-2 text-center"><button class="btn btn-sm" data-inv-more>Weitere ${rows.length - shown.length} Datensätze anzeigen</button></div>` : ''}`);
  const meta = document.querySelector('#bizWorkspace [data-inv-meta]');
  if (meta) meta.textContent = `${rows.length} von ${invState.data ? inventoryRows().length : 0} Datensätzen`;
}

function exportCsv() {
  const rows = filteredInventory();
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Objektart', 'Bezeichnung', 'Kategorie', 'Menge', 'Lagerort', 'Zuordnung', 'Status'].map(q).join(';'),
    ...rows.map((r) => [r.typeLabel, r.name, r.category, r.qtyText, r.loc, r.assign, r.status].map(q).join(';'))];
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventar_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bindInventoryEvents(root) {
  let qTimer = null;
  on(root, 'input', '[data-inv-q]', (_e, i) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { invState.q = i.value; invState.limit = 250; renderInventoryTable(); }, 120);
  });
  on(root, 'change', '[data-inv-f]', (_e, s) => { invState[s.dataset.invF] = s.value; invState.limit = 250; renderInventoryTable(); });
  on(root, 'click', '[data-sort]', (_e, t) => {
    const k = t.dataset.sort;
    if (!t.closest('[data-inv-table]')) return;
    if (invState.sort === k) invState.dir *= -1; else { invState.sort = k; invState.dir = 1; }
    renderInventoryTable();
  });
  on(root, 'click', '[data-inv-more]', () => { invState.limit += 250; renderInventoryTable(); });
  on(root, 'click', '[data-inv-csv]', exportCsv);
  const reload = async () => { await loadInventory(); if (tab === 'inventory' && bodyEl()) renderInventory(bodyEl()); };
  on(root, 'click', '[data-inv-reload]', reload);
  on(root, 'click', '[data-inv-new]', (_e, b) => (b.dataset.invNew === 'part' ? openPartForm({}, reload) : openToolForm({}, reload)));
  on(root, 'click', '[data-inv]', (_e, tr) => {
    const [kind, id] = tr.dataset.inv.split(':');
    const d = invState.data;
    if (kind === 'part') { const p = d.parts.find((x) => x.id === Number(id)); if (p) openPartForm(p, reload); }
    if (kind === 'tool') { const t = d.tools.find((x) => x.id === Number(id)); if (t) openToolForm(t, reload); }
    if (kind === 'box') { const b = d.boxes.find((x) => x.id === Number(id)); if (b) app.openShelf(b.shelf_id, { level: b.level, boxId: b.id }); }
  });
}

/* ---------------------------------------------------------------------- */
/* 3) Materialentnahme / Verbrauchsbeleg                                  */
/* ---------------------------------------------------------------------- */
const matState = { items: null, moves: null, sel: '', vehicle: '', loading: false };

async function loadMaterial() {
  matState.loading = true;
  try {
    const [items, moves] = await Promise.all([get('/consumables'), get('/consumable-moves?limit=40')]);
    matState.items = items;
    matState.moves = moves;
  } catch (err) { toastError(err); matState.items = matState.items || []; matState.moves = matState.moves || []; }
  matState.loading = false;
}

const qtyStr = (n, c) => (n === null || n === undefined ? 'nicht erfasst' : `${fmtQty(n, c.kind)} ${c.unit}`);
function stockState(c) {
  if (c.unknown) return ['Nicht erfasst', 'grey'];
  if (c.empty) return ['Kein Bestand', 'bad'];
  if (c.crit) return ['Kritisch, unter Mindestbestand', 'bad'];
  if (c.low) return ['Unter Mindestbestand', 'warn'];
  return ['Ausreichend', 'ok'];
}

function renderMaterial(body) {
  if (!matState.items) {
    setHTML(body, html`<div class="bz-card"><div class="bz-none">Lade Materialstamm …</div></div>`);
    if (!matState.loading) loadMaterial().then(() => { if (tab === 'material' && bodyEl()) renderMaterial(bodyEl()); });
    return;
  }
  const items = matState.items;
  if (!items.some((c) => String(c.id) === matState.sel)) matState.sel = items.length ? String(items[0].id) : '';
  const h = store.hud || {};
  setHTML(body, html`
    <div data-mat-kpis></div>
    ${canEdit() ? html`<div class="bz-card">
      <div class="bz-card-head"><h3>Verbrauchsbeleg erfassen<span class="hint">Abbuchung aus dem kleinsten bzw. angebrochenen Gebinde</span></h3></div>
      <form class="bz-card-body" data-mat-form>
        <div class="bz-form">
          <label class="full"><span class="label">Material</span><select class="select" name="cid" data-mat-sel>
            ${items.map((c) => html`<option value="${c.id}" ${String(c.id) === matState.sel ? 'selected' : ''}>${c.name}${c.critical ? ' (kritisch)' : ''} · Bestand ${qtyStr(c.qty, c)}</option>`)}
          </select></label>
          <label><span class="label">Menge <span data-mat-unit></span></span><input class="input" type="number" name="amount" min="0" step="any" inputmode="decimal" data-mat-amount required></label>
          <label><span class="label">Kostenstelle / Fahrzeug</span><select class="select" name="vehicle_id">
            <option value="">Allgemein (Halle)</option>
            ${[...store.vehicles].sort((a, b) => natural(a.name, b.name)).map((v) => html`<option value="${v.id}" ${String(v.id) === matState.vehicle ? 'selected' : ''}>${v.name}${v.plate ? ` (${v.plate})` : ''}</option>`)}
          </select></label>
          <button class="btn btn-primary" type="submit">${icon('check', 'w-4 h-4')} Beleg buchen</button>
        </div>
        <label class="flex items-center gap-2 mt-2 text-xs text-slate-600"><input type="checkbox" class="check !w-4 !h-4" name="empty" data-mat-empty> Restmenge buchen (angebrochenes Gebinde aufgebraucht)</label>
        <div class="bz-note" data-mat-info></div>
      </form>
    </div>` : ''}
    <div class="bz-split two">
      <div class="bz-card">
        <div class="bz-card-head"><h3>Bestandsübersicht Verbrauchsmaterial</h3>${canEdit() ? html`<button class="btn btn-sm" data-mat-shop>Bedarfsliste${h.shoppingOpen ? ` (${h.shoppingOpen})` : ''}</button>` : ''}</div>
        <div class="bz-scroll" data-mat-stock></div>
      </div>
      <div class="bz-card">
        <div class="bz-card-head"><h3>Belegjournal<span class="hint">Storno bis 24 h nach Buchung</span></h3><button class="btn btn-sm" data-mat-reload title="Aktualisieren">${icon('refresh', 'w-3.5 h-3.5')}</button></div>
        <div class="bz-scroll" data-mat-journal></div>
      </div>
    </div>
    <div class="bz-card">
      <div class="bz-card-head"><h3>Bedarfsermittlung<span class="hint">Mindestbestand unterschritten (Material und Verpflegung)</span></h3></div>
      <div class="bz-scroll" data-mat-radar></div>
    </div>`);
  renderMaterialParts();
  updateMatInfo();
}

function renderMaterialParts() {
  const root = document.querySelector('#bizWorkspace');
  if (!root || !matState.items) return;
  const items = matState.items;
  const h = store.hud || {};
  const k = root.querySelector('[data-mat-kpis]');
  if (k) {
    const crit = items.filter((c) => c.crit).length;
    const low = items.filter((c) => c.low && !c.crit).length;
    setHTML(k, html`<div class="bz-kpis">
      <div class="bz-kpi"><div class="k">Materialstamm</div><div class="v">${items.length}</div><div class="s">${items.filter((c) => c.critical).length} kritische Positionen</div></div>
      <div class="bz-kpi ${crit ? 'bad' : ''}"><div class="k">Kritisch unterschritten</div><div class="v">${crit}</div><div class="s">sofortiger Bedarf</div></div>
      <div class="bz-kpi ${low ? 'warn' : ''}"><div class="k">Unter Mindestbestand</div><div class="v">${low}</div><div class="s">Nachbestellung empfohlen</div></div>
      <div class="bz-kpi"><div class="k">Offene Bedarfe</div><div class="v">${h.shoppingOpen || 0}</div><div class="s">${h.radarNew || 0} neu ermittelt</div></div>
    </div>`);
  }
  const st = root.querySelector('[data-mat-stock]');
  if (st) {
    setHTML(st, html`<table class="bz-table">
      <thead><tr><th>Material</th><th class="num">Bestand</th><th class="num">Mindestbestand</th><th>Reichweite</th><th>Status</th><th>Lagerorte</th>${canEdit() ? html`<th></th>` : ''}</tr></thead>
      <tbody>${items.map((c) => {
        const [label, cls] = stockState(c);
        const min = Number(c.min_qty) || 0;
        const pct = c.unknown ? 0 : Math.max(0, Math.min(100, min ? (c.qty / (min * 2)) * 100 : 100));
        const locs = [...new Set((c.stock || []).map((r) => r.location).filter(Boolean))];
        return html`<tr>
          <td><div class="font-medium">${c.name}</div>${c.critical ? html`<div class="text-[11px] text-slate-500">kritische Ressource</div>` : ''}</td>
          <td class="num whitespace-nowrap">${qtyStr(c.qty, c)}</td>
          <td class="num whitespace-nowrap">${min ? `${fmtQty(min, c.kind)} ${c.unit}` : '-'}</td>
          <td><span class="bz-bar ${cls === 'bad' ? 'bad' : cls === 'warn' ? 'low' : ''}"><span style="width:${pct}%"></span></span></td>
          <td><span class="bz-badge ${cls}">${label}</span></td>
          <td class="muted text-[11px]">${locs.length ? locs.slice(0, 2).join(', ') + (locs.length > 2 ? ` +${locs.length - 2}` : '') : '-'}</td>
          ${canEdit() ? html`<td class="whitespace-nowrap num"><button class="btn btn-sm" data-mat-in="${c.id}">Wareneingang</button> <button class="btn btn-sm" data-mat-geb="${c.id}">Gebinde</button></td>` : ''}
        </tr>`;
      })}
      ${!items.length ? html`<tr><td colspan="7" class="empty">Noch kein Verbrauchsmaterial angelegt (Admin-Konsole · Verbrauch & Kritisch).</td></tr>` : ''}</tbody>
    </table>`);
  }
  const j = root.querySelector('[data-mat-journal]');
  if (j) {
    const moves = matState.moves || [];
    const KIND = { use: 'Entnahme', empty: 'Entnahme (Rest)', refill: 'Zugang', count: 'Inventur', stockin: 'Wareneingang', 'stock-in': 'Wareneingang' };
    setHTML(j, html`<table class="bz-table">
      <thead><tr><th>Beleg</th><th>Datum</th><th>Material</th><th class="num">Menge</th><th>Kostenstelle</th><th>Erfasst von</th><th></th></tr></thead>
      <tbody>${moves.map((m) => {
        const recent = Date.now() - Date.parse(m.created_at) < 24 * 3600000;
        const canUndo = canEdit() && !m.undone && recent && (m.kind === 'use' || m.kind === 'empty');
        return html`<tr>
          <td class="mono">MB-${String(m.id).padStart(6, '0')}</td>
          <td class="muted whitespace-nowrap">${new Date(m.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td>${m.name}<div class="text-[11px] text-slate-500">${KIND[m.kind] || m.kind}</div></td>
          <td class="num whitespace-nowrap ${m.undone ? 'line-through text-slate-400' : ''}">${m.delta > 0 ? '+' : ''}${fmtQty(m.delta, m.item_kind)} ${m.unit}</td>
          <td class="muted">${m.vehicle_name || 'Allgemein'}</td>
          <td class="muted">${m.user_name || '-'}</td>
          <td class="num">${m.undone ? html`<span class="bz-badge grey nodot">Storniert</span>` : canUndo ? html`<button class="btn btn-sm" data-mat-undo="${m.id}">Storno</button>` : ''}</td>
        </tr>`;
      })}
      ${!moves.length ? html`<tr><td colspan="7" class="empty">Noch keine Buchungen.</td></tr>` : ''}</tbody>
    </table>`);
  }
  const r = root.querySelector('[data-mat-radar]');
  if (r) {
    const radar = h.radar || [];
    setHTML(r, html`<table class="bz-table">
      <thead><tr><th>Position</th><th>Herkunft</th><th>Befund</th><th>Bedarfsliste</th></tr></thead>
      <tbody>${radar.map((x) => html`<tr>
        <td class="font-medium">${x.name}</td>
        <td class="muted">${x.source === 'supply' ? 'Verpflegung' : 'Verbrauchsmaterial'}</td>
        <td><span class="bz-badge ${x.level === 'critical' ? 'bad' : 'warn'}">${x.text}</span></td>
        <td>${x.onList ? html`<span class="bz-badge info">erfasst</span>` : canEdit() ? html`<button class="btn btn-sm" data-mat-tolist="${x.source}:${x.ref_id}">Bedarf anmelden</button>` : '-'}</td>
      </tr>`)}
      ${!radar.length ? html`<tr><td colspan="4" class="empty">Kein Bedarf ermittelt. Alle Mindestbestände sind erfüllt.</td></tr>` : ''}</tbody>
    </table>`);
  }
}

function updateMatInfo() {
  const root = document.querySelector('#bizWorkspace');
  const c = matState.items && matState.items.find((x) => String(x.id) === matState.sel);
  if (!root || !c) return;
  const u = root.querySelector('[data-mat-unit]');
  if (u) u.textContent = `(${c.unit})`;
  const a = root.querySelector('[data-mat-amount]');
  const empty = root.querySelector('[data-mat-empty]');
  if (a) { a.step = c.kind === 'fluid' ? '0.1' : '1'; a.placeholder = c.steps && c.steps.length ? `z. B. ${fmtQty(c.steps[0], c.kind)}` : ''; a.disabled = !!(empty && empty.checked); }
  const info = root.querySelector('[data-mat-info]');
  if (info) {
    const rest = c.emptyAmount ? ` · angebrochen: ${fmtQty(c.emptyAmount, c.kind)} ${c.unit}` : '';
    info.className = `bz-note ${c.low || c.unknown ? 'warn' : ''}`;
    info.textContent = c.unknown
      ? 'Für dieses Material ist noch kein Gebinde mit Lagerort erfasst. Die Buchung wird protokolliert, Bestand bitte per Wareneingang erfassen.'
      : `Verfügbar: ${qtyStr(c.qty, c)} · Mindestbestand: ${fmtQty(c.min_qty || 0, c.kind)} ${c.unit}${rest}${c.breakdown ? ` · ${c.breakdown}` : ''}`;
  }
}

async function reloadMaterial() {
  await loadMaterial();
  if (tab === 'material') renderMaterialParts();
  updateMatInfo();
}

function bindMaterialEvents(root) {
  on(root, 'change', '[data-mat-sel]', (_e, s) => { matState.sel = s.value; updateMatInfo(); });
  on(root, 'change', '[data-mat-empty]', () => updateMatInfo());
  on(root, 'change', '[data-mat-form] [name="vehicle_id"]', (_e, s) => { matState.vehicle = s.value; });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-mat-form]');
    if (!f) return;
    e.preventDefault();
    const c = matState.items.find((x) => String(x.id) === f.cid.value);
    if (!c) return;
    const empty = f.empty.checked;
    const amount = Number(String(f.amount.value).replace(',', '.'));
    if (!empty && !(amount > 0)) { toast('Bitte eine Menge angeben.', 'warn'); return; }
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await post(`/consumables/${c.id}/use`, empty ? { empty: true, vehicle_id: f.vehicle_id.value || null } : { amount, vehicle_id: f.vehicle_id.value || null });
      if (res.hud) applyHud(res.hud);
      toast(`Beleg MB-${String(res.move.id).padStart(6, '0')} gebucht: ${fmtQty(res.move.amount, c.kind)} ${c.unit} ${c.name}${res.move.vehicle_name ? ` · ${res.move.vehicle_name}` : ''}`, 'ok', 4200,
        { label: 'Storno', onClick: () => undoMove(res.move.id) });
      if (res.move.shortfall > 0) toast(`Hinweis: ${fmtQty(res.move.shortfall, c.kind)} ${c.unit} ohne Lagerbestand gebucht.`, 'warn', 5000);
      if (res.crossed) toast(`${c.name}: Mindestbestand unterschritten.`, res.crossedCritical ? 'error' : 'warn', 5000);
      f.amount.value = '';
      f.empty.checked = false;
      await reloadMaterial();
    } catch (err) { toastError(err); }
    btn.disabled = false;
  });
  on(root, 'click', '[data-mat-undo]', (_e, b) => undoMove(Number(b.dataset.matUndo)));
  on(root, 'click', '[data-mat-reload]', reloadMaterial);
  on(root, 'click', '[data-mat-shop]', () => openQuickUse({ tab: 'shop' }));
  on(root, 'click', '[data-mat-in]', (_e, b) => { const c = matState.items.find((x) => x.id === Number(b.dataset.matIn)); if (c) openStockIn(c).then((it) => { if (it) reloadMaterial(); }); });
  on(root, 'click', '[data-mat-geb]', (_e, b) => openGebinde(Number(b.dataset.matGeb), { onChange: reloadMaterial }));
  on(root, 'click', '[data-mat-tolist]', async (_e, b) => {
    const [source, ref] = b.dataset.matTolist.split(':');
    try {
      const res = await post('/shopping-list', { source, ref_id: Number(ref) });
      if (res.hud) applyHud(res.hud);
      toast(res.already ? 'Steht bereits auf der Bedarfsliste.' : 'Bedarf angemeldet.', 'ok');
    } catch (err) { toastError(err); }
  });
}

async function undoMove(id) {
  try {
    const res = await post(`/consumable-moves/${id}/undo`);
    if (res.hud) applyHud(res.hud);
    toast(`Beleg MB-${String(id).padStart(6, '0')} storniert.`, 'ok');
    await reloadMaterial();
  } catch (err) { toastError(err); }
}

/* ---------------------------------------------------------------------- */
/* 4) Projekte & Termine (Event-Kalender mit Ausrüstungs-Checkliste)      */
/* ---------------------------------------------------------------------- */
const prjState = { list: null, filter: 'upcoming', month: null, stats: new Map(), loading: false };
const todayStr = () => new Date().toISOString().slice(0, 10);

async function loadProjects() {
  prjState.loading = true;
  try { prjState.list = await get('/events'); } catch (err) { toastError(err); prjState.list = prjState.list || []; }
  prjState.loading = false;
}

function prjStatus(e) {
  const t = todayStr();
  const end = e.date_end || e.date_start;
  if (end < t) return ['Abgeschlossen', 'grey'];
  if (e.date_start <= t) return ['Laufend', 'info'];
  const days = Math.round((Date.parse(e.date_start) - Date.parse(t)) / 86400000);
  return [days <= 7 ? `Geplant · in ${days} ${days === 1 ? 'Tag' : 'Tagen'}` : 'Geplant', days <= 7 ? 'warn' : 'ok'];
}

function calendarHtml(list) {
  const base = prjState.month ? new Date(`${prjState.month}-01T12:00:00`) : new Date();
  const y = base.getFullYear();
  const m = base.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7;   // Montag = 0
  const days = new Date(y, m + 1, 0).getDate();
  const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = todayStr();
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(html`<div class="p-1 bg-slate-50"></div>`);
  for (let d = 1; d <= days; d += 1) {
    const day = iso(d);
    const evs = list.filter((e) => e.date_start <= day && (e.date_end || e.date_start) >= day);
    cells.push(html`<div class="p-1 min-h-[3.4rem] border-t border-slate-100 ${day === t ? 'bg-blue-50' : ''}">
      <div class="text-[11px] ${day === t ? 'font-semibold text-blue-700' : 'text-slate-500'}">${d}</div>
      ${evs.slice(0, 2).map((e) => html`<button class="block w-full text-left truncate text-[11px] leading-tight mt-0.5 px-1 py-0.5 rounded-sm bg-blue-100 text-blue-800" data-prj-open="${e.id}" title="${e.name}">${e.name}</button>`)}
      ${evs.length > 2 ? html`<div class="text-[10px] text-slate-500">+${evs.length - 2}</div>` : ''}
    </div>`);
  }
  const label = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return html`<div class="bz-card">
    <div class="bz-card-head"><h3>Terminkalender · ${label}</h3>
      <button class="btn btn-sm" data-prj-month="-1">‹</button><button class="btn btn-sm" data-prj-month="0">Heute</button><button class="btn btn-sm" data-prj-month="1">›</button></div>
    <div class="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => html`<div class="py-1">${d}</div>`)}</div>
    <div class="grid grid-cols-7">${cells}</div>
  </div>`;
}

function renderProjects(body) {
  if (!prjState.list) {
    setHTML(body, html`<div class="bz-card"><div class="bz-none">Lade Projektdaten …</div></div>`);
    if (!prjState.loading) loadProjects().then(() => { if (tab === 'projects' && bodyEl()) renderProjects(bodyEl()); });
    return;
  }
  const all = [...prjState.list].sort((a, b) => natural(a.date_start, b.date_start));
  const list = all.filter((e) => (prjState.filter === 'all' ? true : prjState.filter === 'past' ? e.past : !e.past));
  if (prjState.filter === 'past') list.reverse();
  const groups = new Map();
  list.forEach((e) => {
    const k = e.date_start.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  });
  const vname = (id) => { const v = store.vehicles.find((x) => x.id === id); return v ? v.name : `#${id}`; };
  const upcoming = all.filter((e) => !e.past);
  const next = upcoming[0];
  setHTML(body, html`
    <div class="bz-kpis">
      <div class="bz-kpi"><div class="k">Anstehende Projekte</div><div class="v">${upcoming.length}</div><div class="s">${all.length - upcoming.length} abgeschlossen</div></div>
      <div class="bz-kpi"><div class="k">Nächster Termin</div><div class="v text-base">${next ? fmtDate(next.date_start) : '-'}</div><div class="s truncate">${next ? next.name : 'kein Termin geplant'}</div></div>
      <div class="bz-kpi"><div class="k">Disponierte Fahrzeuge</div><div class="v">${new Set(upcoming.flatMap((e) => e.vehicle_ids || [])).size}</div><div class="s">in anstehenden Projekten</div></div>
    </div>
    <div class="bz-split two">
      <div class="bz-card">
        <div class="bz-card-head"><h3>Projektliste</h3>
          <select class="select !w-auto !py-1 text-xs" data-prj-filter>
            ${[['upcoming', 'Anstehend'], ['past', 'Abgeschlossen'], ['all', 'Alle']].map(([k, l]) => html`<option value="${k}" ${prjState.filter === k ? 'selected' : ''}>${l}</option>`)}
          </select>
          ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-prj-new>${icon('plus', 'w-3.5 h-3.5')} Neues Projekt</button>` : ''}
        </div>
        <div class="bz-scroll"><table class="bz-table">
          <thead><tr><th>Zeitraum</th><th>Projekt</th><th>Ort</th><th>Fahrzeuge</th><th>Ausrüstungs-Checkliste</th><th>Status</th><th></th></tr></thead>
          <tbody>${[...groups.entries()].map(([k, evs]) => html`
            <tr class="zone"><td colspan="7">${new Date(`${k}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</td></tr>
            ${evs.map((e) => {
              const [sl, sc] = prjStatus(e);
              const st = prjState.stats.get(e.id);
              const pct = st && st.total ? Math.round((st.packed / st.total) * 100) : 0;
              return html`<tr>
                <td class="whitespace-nowrap">${fmtDate(e.date_start)}${e.date_end && e.date_end !== e.date_start ? html`<div class="text-[11px] text-slate-500">bis ${fmtDate(e.date_end)}</div>` : ''}</td>
                <td><button class="bz-link" data-prj-open="${e.id}">${e.name}</button>${e.notes ? html`<div class="text-[11px] text-slate-500 truncate max-w-[16rem]">${e.notes}</div>` : ''}</td>
                <td class="muted">${e.location || '-'}</td>
                <td class="muted text-[11px]">${(e.vehicle_ids || []).map(vname).join(', ') || '-'}</td>
                <td class="whitespace-nowrap" data-prj-stat="${e.id}">${st ? html`<span class="bz-bar ${pct === 100 ? 'done' : ''}"><span style="width:${pct}%"></span></span><span class="text-[11px] text-slate-600">${st.packed}/${st.total}</span>` : html`<span class="text-[11px] text-slate-500">${e.packed_count} erledigt</span>`}</td>
                <td><span class="bz-badge ${sc}">${sl}</span></td>
                <td class="num whitespace-nowrap"><button class="btn btn-sm" data-prj-open="${e.id}">Checkliste</button>${canEdit() ? html` <button class="btn btn-sm" data-prj-edit="${e.id}">Bearbeiten</button>` : ''}</td>
              </tr>`;
            })}`)}
          ${!list.length ? html`<tr><td colspan="7" class="empty">Keine Projekte in dieser Auswahl.</td></tr>` : ''}</tbody>
        </table></div>
      </div>
      ${calendarHtml(all)}
    </div>`);
  // Checklisten-Fortschritt nachladen (nur für sichtbare, nicht abgeschlossene Projekte)
  list.filter((e) => !e.past && !prjState.stats.has(e.id)).slice(0, 15).forEach((e) => {
    get(`/events/${e.id}/packlist`).then((d) => {
      prjState.stats.set(e.id, d.stats);
      const cell = document.querySelector(`#bizWorkspace [data-prj-stat="${e.id}"]`);
      if (!cell) return;
      const pct = d.stats.total ? Math.round((d.stats.packed / d.stats.total) * 100) : 0;
      setHTML(cell, html`<span class="bz-bar ${pct === 100 ? 'done' : ''}"><span style="width:${pct}%"></span></span><span class="text-[11px] text-slate-600">${d.stats.packed}/${d.stats.total}</span>`);
    }).catch(() => {});
  });
}

function bindProjectEvents(root) {
  const rerender = () => { if (tab === 'projects' && bodyEl()) renderProjects(bodyEl()); };
  on(root, 'change', '[data-prj-filter]', (_e, s) => { prjState.filter = s.value; rerender(); });
  on(root, 'click', '[data-prj-month]', (_e, b) => {
    const step = Number(b.dataset.prjMonth);
    const base = prjState.month ? new Date(`${prjState.month}-01T12:00:00`) : new Date();
    if (step === 0) prjState.month = null;
    else { const d = new Date(base.getFullYear(), base.getMonth() + step, 1, 12); prjState.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    rerender();
  });
  on(root, 'click', '[data-prj-open]', async (_e, b) => {
    const id = Number(b.dataset.prjOpen);
    await openPacklist(id);
    // Fortschritt nach dem Schließen neu laden
    prjState.stats.delete(id);
  });
  on(root, 'click', '[data-prj-new]', () => openEventEditor(null));
  on(root, 'click', '[data-prj-edit]', (_e, b) => {
    const ev = (prjState.list || []).find((x) => x.id === Number(b.dataset.prjEdit));
    if (ev) openEventEditor(ev);
  });
}

/* ====================================================================== */
/* Start                                                                  */
/* ====================================================================== */
export function initBiz() {
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  const root = $('#bizWorkspace');
  if (root) {
    on(root, 'click', '[data-bztab]', (_e, b) => showBizTab(b.dataset.bztab));
    bindSlotEvents(root);
    bindInventoryEvents(root);
    bindMaterialEvents(root);
    bindProjectEvents(root);
  }
  // Hintergrund-Aktualisierung (alle 20 s) nicht mitten in eine Auswahl oder ein Ziehen hinein rendern
  const busy = () => !!dragId || !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#bizWorkspace select, #bizWorkspace input'));
  let pending = false;
  const rerenderIf = (key) => () => {
    refreshTabs();
    if (!isBiz() || tab !== key || !bodyEl()) return;
    if (busy()) { if (!pending) { pending = true; document.addEventListener('focusout', () => { pending = false; setTimeout(() => { if (tab === key && bodyEl() && !busy()) renderSlots(bodyEl()); }, 50); }, { once: true }); } return; }
    renderSlots(bodyEl());
  };
  subscribe('vehicles', rerenderIf('slots'));
  subscribe('layout', rerenderIf('slots'));
  subscribe('events', () => { prjState.list = null; prjState.stats.clear(); if (isBiz() && tab === 'projects' && bodyEl()) renderProjects(bodyEl()); refreshTabs(); });
  subscribe('hud', () => {
    if (!isBiz()) return;
    refreshTabs();
    if (tab === 'material' && matState.items) renderMaterialParts();
    if (tab === 'inventory' && invState.data) renderInventoryTable();
  });
  subscribe('me', () => { if (isBiz()) renderWorkspace(); });
  subscribe('builder', syncMapFlag);
  subscribe('mode', syncMapFlag);
  // Gemerkte Ansicht anwenden (die Klasse setzt bereits das Inline-Skript im <head>)
  if (isBiz()) setBiz(true);
  app.setBiz = setBiz;
  app.toggleBiz = toggleBiz;
  app.isBiz = isBiz;
  app.bizTab = showBizTab;
}
