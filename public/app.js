/**
 * HALLE//OS · Client-Einstieg
 * ------------------------------------------------------------
 * Verdrahtet die Module:
 *   js/state.js      zentraler Store + Pub/Sub + Funktionsregistry (app)
 *   js/api.js        REST-Client
 *   js/ui.js         Templating, Icons, Modals, Toasts
 *   js/sprites.js    Top-Down Fahrzeug-Vektoren
 *   js/map.js        Map-Engine (Kamera, Drag & Drop, Builder, Blueprint)
 *   js/auth.js       Login, Hall Pass, Quick-Check-Abfrage
 *   js/whiteboard.js Whiteboard + "Woran arbeite ich gerade?"
 *   js/cockpit.js    Fahrzeug-Cockpit + Fuhrpark
 *   js/events.js     Event-Planer + Packliste
 *   js/storage.js    Lager, Regal-Frontansicht, Werkzeug
 *   js/admin.js      Admin-Konsole, Garage-Builder, Blueprint-Editor
 *   js/spotlight.js  Strg+K Suche
 *   v2:
 *   js/tyres.js      Drift-Tyre Hub (Reifen, Felgen, Kompletträder, -2 Burned)
 *   js/qr.js         QR-Encoder, Label-Druck, Scanner
 *   js/supplies.js   Chill-Ecke & Kühlschrank-Radar
 *   js/setup.js      Animiertes Drift-Setup-Sheet
 *   js/ticker.js     LED-Laufband mit Event-Countdown
 *   v3:
 *   js/trailers.js   Anhänger-Fuhrpark + Gespann-Rechner
 *   js/admin-v3.js   Fahrzeug-Modelle verwalten + TV-Dashboard-Konfiguration
 *   tv.html / tv.js  Hallen-TV unter /tv und /dashboard
 *   v4:
 *   js/sfx.js        Synthetische Game-Sounds (Web Audio), Vibration, Zahlen-Popups
 *   js/hud.js        HUD-Schnellzugriff + Schwebe-Status / Hallen-Ablage
 *   js/quickuse.js   Schnell-Verbrauch (Zwei-Tap-Hub) + Einkaufsliste
 *   js/admin-v4.js   Admin: Verbrauchsartikel & kritische Ressourcen
 *   v5:
 *   js/biz.js        Büro-/Enterprise-Ansicht (Alt+B / Esc), Profilmenü, ERP-Tabellen
 *   biz.css          Heller Business-Look, aktiv bei <html class="biz">
 *   v5.3:
 *   js/pwa.js        App auf dem Homescreen (Service Worker, Installieren)
 *   js/track.js      Aktivitäts-Log (Klicks, Interaktionen)
 *   js/workload.js   Team-Auslastung, Zuweisung, Zeitschätzung, "Arbeit pausieren"
 *   js/admin-activity.js  Admin: Aktivitäts- & Audit-Log
 */
import { store, app, subscribe, setState, emit, canEdit, isAdmin, statusInfo, vehicleById, objectById, setBpLayer, bpLayerOf,
  loadMeta, refreshMeta, refreshAll, refreshWhiteboard, refreshBlueprint, refreshVehicles } from './js/state.js';
import { post } from './js/api.js';
import { $, $$, html, setHTML, icon, toast, toastError, haptic, chooseDialog, confirmDialog, initials, on, topModal } from './js/ui.js';
import { HallMap } from './js/map.js';
import { initAuth, showLogin, checkQuickChecks, logout } from './js/auth.js';
import { initWhiteboard } from './js/whiteboard.js';
import { openCockpit, renderFleetPanel } from './js/cockpit.js';
import { renderEventsPanel, openPacklist } from './js/events.js';
import { renderLagerPanel, renderToolsPanel, openShelf } from './js/storage.js';
import { initAdmin, openAdminConsole, renderMapTopBar } from './js/admin.js';
import { initSpotlight, openSpotlight } from './js/spotlight.js';
import { get } from './js/api.js';
import { openTyreHub, burnTyres } from './js/tyres.js';
import { openScanner, handleScanText } from './js/qr.js';
import { openFridge, initSupplyAlert, refreshSupplies } from './js/supplies.js';
import { initTicker } from './js/ticker.js';
import { renderTrailersPanel } from './js/trailers.js';
import { initHud, refreshHud, openFloatDrawer } from './js/hud.js';
import { openQuickUse } from './js/quickuse.js';
import { initBiz, openProfileMenu, isBiz } from './js/biz.js';
import { initPwa } from './js/pwa.js';                          // v5.3
import { initTracking, track } from './js/track.js';            // v5.3
import { openWorkload } from './js/workload.js';                // v5.3

/* ======================= Rechte Seitenleiste ======================= */
const PANELS = {
  events: renderEventsPanel,
  lager: renderLagerPanel,
  tools: renderToolsPanel,
  fleet: renderFleetPanel,
  trailers: renderTrailersPanel   // v3: Anhänger-Fuhrpark
};
let activeTab = 'events';

function showTab(tab, { mobile = true } = {}) {
  if (!PANELS[tab]) return;
  activeTab = tab;
  $$('#rightTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  PANELS[tab]($('#rightContent'));
  if (mobile && window.innerWidth < 1024) setMobileView(tab);
}
app.showTab = showTab;
app.rerenderTab = (tab) => { if (!tab || tab === activeTab) PANELS[activeTab]($('#rightContent')); };

function setMobileView(view) {
  document.body.dataset.mobileView = view;
  $$('#mobileNav .mnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (['events', 'lager', 'tools', 'fleet', 'trailers'].includes(view) && view !== activeTab) showTab(view, { mobile: false });
}
app.setMobileView = setMobileView;

/* ======================= Kopfzeile ======================= */
function renderUserChip() {
  const me = store.me;
  const chip = $('#userChip');
  if (!me) { setHTML(chip, ''); return; }
  const roleLabel = isBiz()
    ? { admin: 'Administrator', schrauber: 'Sachbearbeitung', gast: 'Lesezugriff' }[me.role]
    : { admin: 'Admin', schrauber: 'Schrauber', gast: 'Hall Pass' }[me.role];
  setHTML(chip, html`
    <span class="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold text-black" style="background:${me.color || '#94a3b8'}">${initials(me.name)}</span>
    <span class="hidden sm:flex flex-col items-start leading-tight">
      <span class="text-xs font-semibold text-white">${me.name}</span>
      <span class="text-[10px] uppercase tracking-wider ${me.role === 'gast' ? 'text-amber-300' : 'text-slate-400'}">${roleLabel}${me.role === 'gast' && !isBiz() ? ' · nur lesen' : ''}</span>
    </span>`);
  $('#adminBtn').classList.toggle('hidden', !isAdmin());
  $('#hallName').textContent = store.hall.name || 'Werkstatt-Management';
}

function renderTicker() {
  const t = $('#liveTicker');
  if (!store.work.length) { setHTML(t, html`<span class="text-slate-500">${isBiz() ? 'Keine aktiven Arbeitsaufträge.' : 'Gerade schraubt niemand.'}</span>`); return; }
  setHTML(t, html`${store.work.slice(0, 3).map((w) => html`
    <span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-lime-400/10 border border-lime-400/25">
      <span class="live-dot"></span><b class="text-white">${w.user_name}</b> ${isBiz() ? 'bearbeitet' : 'schraubt an'} ${w.vehicle_name || (isBiz() ? 'Hallenaufgaben' : 'der Halle')}${w.text ? html` · <span class="text-lime-300">${w.text}</span>` : ''}
    </span>`)}`);
}

function renderLegend() {
  const lg = $('#mapLegend');
  lg.style.display = store.builder ? 'none' : '';
  lg.classList.toggle('bp-on', store.mode === 'blueprint');
  // v5.2: Blueprint-Layer einzeln ein-/ausblenden (Druckluft, 230 V, 400 V, Verteilung, Daten)
  if (store.mode === 'blueprint' && store.meta && store.meta.blueprintLayers) {
    const counts = {};
    for (const it of store.blueprint || []) { const l = bpLayerOf(it); counts[l] = (counts[l] || 0) + 1; }
    setHTML(lg, html`
      <div class="bp-layers">
        <div class="flex items-center gap-2 mb-0.5"><span class="font-display text-[10px] font-bold tracking-widest neon-text flex-1">LAYER</span>
          <button class="text-[10px] text-sky-300 hover:text-white" data-bpall="1">alle</button><span class="text-slate-600">·</span><button class="text-[10px] text-sky-300 hover:text-white" data-bpall="0">keine</button></div>
        ${Object.entries(store.meta.blueprintLayers).map(([k, l]) => html`
          <label class="bp-layer ${store.bpHidden.has(k) ? 'off' : ''}" style="--lc:${l.color}" title="${l.hint}">
            <input type="checkbox" data-bplayer="${k}" ${store.bpHidden.has(k) ? '' : 'checked'}><span class="sw"></span><span>${l.label}</span><small>${counts[k] || 0}</small>
          </label>`)}
      </div>`);
    return;
  }
  let items;
  if (store.mode === 'blueprint') {
    const k = store.meta ? store.meta.blueprintKinds : { line: {}, node: {} };
    items = html`${Object.values(k.line).map((x) => html`<div class="flex items-center gap-2"><span class="inline-block w-5 h-[3px] rounded" style="background:${x.color};box-shadow:0 0 6px ${x.color}"></span>${x.label}</div>`)}`;
  } else {
    const s = store.meta ? store.meta.status : {};
    items = html`
      ${Object.values(s).map((x) => html`<div class="flex items-center gap-2"><span class="dot" style="background:${x.color};box-shadow:0 0 8px ${x.color}"></span>${x.label}</div>`)}
      <div class="flex items-center gap-2"><span class="inline-block w-4 h-2.5 rounded-sm hazard"></span>Schneise blockiert</div>
      <div class="text-slate-500 pt-1">${canEdit() ? 'Ziehen = umparken · Klick = Cockpit' : 'Klick = Cockpit'}</div>
      <div class="text-slate-500">Mausrad = Zoom · Doppelklick = alles zeigen</div>`;
  }
  // Kompakt: nur Status-Punkte, volle Legende beim Darüberfahren / Antippen
  const dots = store.mode === 'blueprint'
    ? html`<span class="neon-text">LEITUNGEN</span>`
    : html`${Object.values(store.meta ? store.meta.status : {}).map((x) => html`<span class="dot" style="background:${x.color}"></span>`)}<span>LEGENDE</span>`;
  setHTML(lg, html`
    <div class="group outline-none" tabindex="0">
      <div class="flex items-center gap-1.5 font-display text-[10px] font-bold tracking-widest text-slate-400 cursor-default">${dots}</div>
      <div class="hidden group-hover:block group-focus:block mt-2 space-y-1">${items}</div>
    </div>`);
}

function setMode(mode) {
  if (mode !== 'hall' && pinResult) clearSearchPin();   // v5.3
  setState({ mode }, ['mode']);
  document.body.classList.toggle('mode-blueprint', mode === 'blueprint');
  $$('.mode-switch button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode === 'blueprint' && store.builder) setState({ builder: false }, ['builder']);
  if (mode === 'blueprint') refreshBlueprint().catch(toastError);
  renderLegend();
  renderMapTopBar();
  if (app.map) app.map.fit();
}
app.setMode = setMode;

/* ======================= Fahrzeuge umparken ======================= */
async function moveVehicle(v, target) {
  try {
    if (target.kind === 'extern') {
      if (!v.slot_id) return;
      const loc = await chooseDialog({
        title: `${v.name} nach draußen`,
        text: 'Wo steht das Auto? Alle To-Dos, Wartungseinträge, Scheine und Events bleiben erhalten.',
        choices: ['Paddock', 'Auf dem Hänger', 'Beim Kumpel', 'Beim Lackierer', 'Unterwegs', 'Externe Werkstatt']
      });
      if (!loc) return;
      const vehicles = await post(`/vehicles/${v.id}/move`, { slotId: null, externLocation: loc });
      setState({ vehicles }, ['vehicles']);
      haptic([12, 40, 12]);
      toast(`${v.name} steht jetzt: ${loc}`, 'ok');
      return;
    }
    const slot = target.slot;
    if (slot.id === v.slot_id && !target.full) return;
    let swap = false;
    if (target.full) {
      const other = target.occupants[0];
      swap = await confirmDialog(`${slot.code} ist belegt von „${other.name}“. Plätze tauschen?`, { title: 'Platz belegt', okLabel: 'Tauschen' });
      if (!swap) return;
    }
    const vehicles = await post(`/vehicles/${v.id}/move`, { slotId: slot.id, swap });
    setState({ vehicles }, ['vehicles']);
    haptic([12, 40, 12]);
    const moved = vehicles.find((x) => x.id === v.id);
    const cap = Number(slot.props.capacity) || 1;
    toast(`${v.name} → ${slot.code} ${slot.label || ''}${cap > 1 ? (moved.slot_pos === 0 ? ' (oben)' : ' (unten)') : ''}`, 'ok');
    if (slot.props.blocksLane) toast('Achtung: Schneise blockiert! Hebebühne 1 kommt nicht raus.', 'warn', 4200);
  } catch (err) {
    toastError(err);
    refreshVehicles().catch(() => {});
  }
}
app.moveVehicle = moveVehicle;

function renderSelectionBar(v) {
  const bar = $('#selectionBar');
  if (!v) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  setHTML(bar, html`
    <div class="glass rounded-xl px-3 py-2 flex items-center gap-3 shadow-2xl border-cyan-400/40">
      <span class="dot" style="background:${statusInfo(v.status).color}"></span>
      <div class="text-sm leading-tight"><b class="text-white">${v.name}</b><div class="text-[11px] text-cyan-300">Zielplatz antippen</div></div>
      <button class="btn btn-sm btn-primary" data-sel="open">${icon('eye')} Cockpit</button>
      <button class="btn btn-sm burn-btn !px-2" data-sel="burn" title="2 Driftreifen abgefahren">${icon('flame', 'w-3.5 h-3.5')} -2</button>
      <button class="btn-icon" data-sel="cancel">${icon('x')}</button>
    </div>`);
}

/* ======================= v5.3: Such-Pin auf der Karte ======================= */
let pinResult = null;
function renderPinBar() {
  const bar = $('#pinBar');
  if (!pinResult) { bar.classList.add('hidden'); setHTML(bar, ''); return; }
  bar.classList.remove('hidden');
  const p = pinResult.pin;
  setHTML(bar, html`
    <div class="pin-bar">
      <span class="pin-ico">${icon('pin', 'w-4 h-4')}</span>
      <div class="min-w-0 flex-1 leading-tight"><div class="text-sm font-semibold text-white truncate">Hier: ${p.label}</div><div class="text-[11px] text-pink-200/90 truncate">${p.sub || ''}</div></div>
      <button class="btn btn-sm !px-2" data-pinact="zoom" title="Heranzoomen">${icon('zoomin', 'w-3.5 h-3.5')}</button>
      ${pinResult.target ? html`<button class="btn btn-sm btn-primary" data-pinact="open">Öffnen</button>` : ''}
      <button class="btn-icon !w-8 !h-8" data-pinact="close" title="Pin ausblenden">${icon('x', 'w-4 h-4')}</button>
    </div>`);
}
function showSearchPin(r) {
  if (!r || !r.pin || isBiz() || !app.map) return false;
  if (window.innerWidth < 1024) setMobileView('map');
  if (store.mode !== 'hall') setMode('hall');
  if (store.builder) return false;
  if (!app.map.showPin(r.pin)) return false;
  pinResult = r;
  renderPinBar();
  haptic([8, 30, 8]);
  return true;
}
function clearSearchPin() { pinResult = null; if (app.map) app.map.clearPin(); renderPinBar(); }
app.showSearchPin = showSearchPin;
app.clearSearchPin = clearSearchPin;

/* ======================= Navigation (Spotlight etc.) ======================= */
function navigate(target) {
  if (!target) return;
  if (window.innerWidth < 1024) setMobileView('map');
  if (store.mode !== 'hall') setMode('hall');
  switch (target.kind) {
    case 'vehicle':
      app.map.focusVehicle(target.vehicleId, () => openCockpit(target.vehicleId, { tab: target.tab, query: target.query }));
      break;
    case 'shelf':
      app.map.focusObject(target.shelfId, () => openShelf(target.shelfId, { level: target.level, boxId: target.boxId, highlight: target.highlight }));
      break;
    case 'event':
      openPacklist(target.eventId);
      break;
    case 'inventory':
      showTab('lager');
      break;
    case 'tools':
      showTab('tools');
      break;
    case 'whiteboard':
      if (window.innerWidth < 1024) setMobileView('board');
      break;
    case 'box':
      // Box-ID -> Regal finden, hinzoomen, Box-Inventar öffnen
      get('/boxes').then((boxes) => {
        const b = boxes.find((x) => x.id === Number(target.boxId));
        if (!b) { toast('Box nicht gefunden.', 'warn'); return; }
        app.map.focusObject(b.shelf_id, () => openShelf(b.shelf_id, { level: b.level, boxId: b.id }));
      }).catch(toastError);
      break;
    case 'tyres': {
      const o = store.objects.find((x) => x.type === 'tyrestack');
      if (o) app.map.focusObject(o.id, () => openTyreHub({ vehicleId: target.vehicleId }));
      else openTyreHub({ vehicleId: target.vehicleId });
      break;
    }
    case 'fridge': {
      const o = store.objects.find((x) => x.type === 'fridge');
      if (o) app.map.focusObject(o.id, () => openFridge());
      else openFridge();
      break;
    }
    default:
  }
}
app.navigate = navigate;
app.openCockpit = openCockpit;
app.openShelf = openShelf;
app.openTyreHub = openTyreHub;
app.openFridge = openFridge;
app.openQuickUse = openQuickUse;      // v4
app.openWorkload = openWorkload;      // v5.3
app.openFloatDrawer = openFloatDrawer; // v4
app.refreshSupplies = refreshSupplies;
app.refreshHud = refreshHud;

/* ======================= Start ======================= */
let started = false;

async function startApp() {
  await refreshMeta().catch(() => {});   // v3: Modellliste kann sich geändert haben
  await refreshAll();
  renderUserChip();
  renderLegend();
  if (!started) {
    started = true;
    app.map = new HallMap($('#mapCanvas'), {
      onHaptic: haptic,
      onVehicleClick: (v) => { track(`Klickte auf Auto ${v.name} (Hallenkarte)`, 'map'); app.map.focusVehicle(v.id, () => openCockpit(v.id)); },
      onVehicleSelect: (v) => { if (v) track(`Wählte Auto ${v.name} auf der Hallenkarte`, 'map'); renderSelectionBar(v); },
      onPinClick: () => { haptic(8); app.map.zoomToPin(); },
      onMove: moveVehicle,
      onObjectClick: (o) => {
        track(`Klickte auf ${o.label || o.code || o.type} (Hallenkarte)`, 'map');
        if (o.type === 'shelf') app.map.focusObject(o.id, () => openShelf(o.id));
        else if (o.type === 'tyrestack') navigate({ kind: 'tyres' });
        else if (o.type === 'fridge' || (o.type === 'zone' && o.code === 'CHILL')) navigate({ kind: 'fridge' });
        else if (o.type === 'toolwall' || o.type === 'workbench') showTab('tools');
        else if (o.type === 'slot') {
          const occ = store.vehicles.filter((v) => v.slot_id === o.id);
          toast(`${o.code} · ${o.label || ''}: ${occ.length ? occ.map((v) => v.name).join(', ') : 'frei'}`);
        }
      },
      onBuilderSelect: (o) => app.onBuilderSelect && app.onBuilderSelect(o),
      onBuilderChange: (o) => app.onBuilderChange && app.onBuilderChange(o),
      onBlueprintCreate: (item) => app.onBlueprintCreate && app.onBlueprintCreate(item),
      onBlueprintSelect: (item) => app.onBlueprintSelect && app.onBlueprintSelect(item)
    });
    initWhiteboard($('#leftPanel'));
    initAdmin();
    initSpotlight();
    initSupplyAlert();
    initTicker($('#ledTicker'));
    initHud();   // v4
    initTracking();   // v5.3: Aktivitäts-Log (Klicks)
    bindChrome();
    setInterval(poll, 20000);
  }
  showTab(activeTab, { mobile: false });
  renderMapTopBar();
  await Promise.all([refreshWhiteboard(), refreshBlueprint(), refreshHud()]).catch(toastError);
  checkQuickChecks();
  // Deep-Links: ?auto=ID öffnet ein Cockpit, ?scan=box-12 / car-3 kommt von gedruckten QR-Codes
  const params = new URLSearchParams(location.search);
  if (params.get('auto')) navigate({ kind: 'vehicle', vehicleId: Number(params.get('auto')) });
  if (params.get('scan')) setTimeout(() => handleScanText(params.get('scan')), 400);
  // v5.3: Kurzbefehle vom Homescreen-Icon (lange drücken): ?open=search / ?open=workload
  if (params.get('open') === 'search') setTimeout(openSpotlight, 300);
  if (params.get('open') === 'workload') setTimeout(openWorkload, 300);
  if (params.get('scan') || params.get('auto') || params.get('open')) history.replaceState(null, '', location.pathname);
}
app.startApp = startApp;

async function poll() {
  if (document.hidden || !store.me || (app.map && app.map.drag) || store.builder) return;
  try {
    await Promise.all([refreshVehicles(), refreshWhiteboard(), refreshSupplies(), refreshHud()]);
  } catch { /* still */ }
}

function bindChrome() {
  $$('.mode-switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#rightTabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab, { mobile: false }); });
  $('#mobileNav').addEventListener('click', (e) => {
    const b = e.target.closest('.mnav-btn');
    if (!b) return;
    haptic(6);
    setMobileView(b.dataset.view);
    if (b.dataset.view === 'map' && app.map) app.map.resize();
  });
  // v5.2: Blueprint-Layer-Schalter
  $('#mapLegend').addEventListener('change', (e) => { const c = e.target.closest('[data-bplayer]'); if (c) setBpLayer(c.dataset.bplayer, c.checked); });
  $('#mapLegend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bpall]');
    if (!b || !store.meta) return;
    Object.keys(store.meta.blueprintLayers || {}).forEach((k) => setBpLayer(k, b.dataset.bpall === '1'));
  });
  on($('#pinBar'), 'click', '[data-pinact]', (_e, b) => {
    const a = b.dataset.pinact;
    if (a === 'zoom') app.map.zoomToPin();
    if (a === 'close') clearSearchPin();
    if (a === 'open' && pinResult) { const t = pinResult.target; app.map.zoomToPin(() => navigate(t)); }
  });
  $('#spotlightBtn').addEventListener('click', openSpotlight);
  $('#spotlightBtnMobile').addEventListener('click', openSpotlight);
  $('#adminBtn').addEventListener('click', openAdminConsole);
  $('#scanBtn').addEventListener('click', () => { haptic(8); openScanner(); });
  // v5: Profilmenü mit Ansichts-Umschalter (Werkstatt / Enterprise), Ton und Abmelden
  $('#userChip').addEventListener('click', (e) => {
    openProfileMenu(e.currentTarget, {
      onLogout: async () => {
        if (await confirmDialog(`Als ${store.me.name} abmelden und Profil wechseln?`, { title: 'Profil wechseln', okLabel: 'Abmelden' })) logout();
      }
    });
  });
  $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const m = app.map;
    if (b.dataset.zoom === 'fit') m.fit();
    else m.zoomAt(b.dataset.zoom === 'in' ? 1.3 : 1 / 1.3, m.cw / 2, m.ch / 2);
  }));
  on($('#selectionBar'), 'click', '[data-sel]', (_e, t) => {
    const id = app.map.selectedVehicleId;
    if (t.dataset.sel === 'burn' && id) { burnTyres(id); return; }
    app.map.select(null);
    if (t.dataset.sel === 'open' && id) app.map.focusVehicle(id, () => openCockpit(id));
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSpotlight(); }
    else if (e.key === '/' && !e.target.closest('input,textarea,select') && !topModal()) { e.preventDefault(); openSpotlight(); }
  });
}

subscribe('me', renderUserChip);
subscribe('work', renderTicker);
subscribe('biz', () => { renderUserChip(); renderTicker(); renderLegend(); if (store.me) app.rerenderTab(); });
subscribe('vehicles', () => { if (activeTab === 'fleet') app.rerenderTab('fleet'); });
subscribe('events', () => { if (activeTab === 'events') app.rerenderTab('events'); });
subscribe('builder', () => { renderLegend(); renderMapTopBar(); if (store.builder) clearSearchPin(); });
subscribe('bplayers', renderLegend);                                          // v5.2
subscribe('blueprint', () => { if (store.mode === 'blueprint') renderLegend(); });
// v4: Werkzeug-/Lager-Liste neu zeichnen, wenn sich der Schwebe-Status ändert
let lastFloatSig = '';
subscribe('hud', () => {
  const sig = ((store.hud && store.hud.floating) || []).map((f) => `${f.kind}:${f.ref_id}`).join(',');
  if (sig === lastFloatSig) return;
  lastFloatSig = sig;
  if (activeTab === 'tools' || activeTab === 'lager') app.rerenderTab(activeTab);
});

window.addEventListener('auth:required', () => { if (store.me) { setState({ me: null }); showLogin(); } });

(async function boot() {
  try {
    await loadMeta();
  } catch {
    setHTML($('#loginRoot'), html`<div class="fixed inset-0 grid place-items-center login-bg text-slate-300 p-6 text-center">Server nicht erreichbar. Läuft <code class="font-mono text-cyan-300">npm start</code>?</div>`);
    return;
  }
  initBiz();   // v5: Ansicht + Tastenkürzel schon auf dem Anmeldebildschirm
  initPwa();   // v5.3: Service Worker, "Als App installieren"
  initAuth(startApp);
})();

// Für Debugging in der Konsole
window.HALLE = { store, app, emit, vehicleById, objectById };
