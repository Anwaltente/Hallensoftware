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
 */
import { store, app, subscribe, setState, emit, canEdit, isAdmin, statusInfo, vehicleById, objectById,
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
      onVehicleClick: (v) => app.map.focusVehicle(v.id, () => openCockpit(v.id)),
      onVehicleSelect: renderSelectionBar,
      onMove: moveVehicle,
      onObjectClick: (o) => {
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
  if (params.get('scan') || params.get('auto')) history.replaceState(null, '', location.pathname);
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
subscribe('builder', () => { renderLegend(); renderMapTopBar(); });
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
  initAuth(startApp);
})();

// Für Debugging in der Konsole
window.HALLE = { store, app, emit, vehicleById, objectById };
