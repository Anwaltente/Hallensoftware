/**
 * Admin-Bereich (PIN-geschützt)
 * - No-Code Garage-Builder: Objekte hinzufügen, verschieben, skalieren, umbenennen
 * - Blueprint-Editor: Leitungen (230 V, 400 V, Druckluft, Daten) und Knoten per Linienzug
 * - Konsole: Nutzer & Rechte, Hall Pass, Post-Event Quick-Checks, CSV-Import, Geräte, System/Backup
 */
import { store, app, setState, emit, isAdmin, refreshAll, refreshBlueprint, setBpLayer, bpLayerOf } from './state.js';
import { get, post, put, del, upload } from './api.js';
import { $, html, setHTML, el, on, icon, toast, toastError, haptic, openModal, confirmDialog, formData, initials, fmtDateTime, pinPad } from './ui.js';
import { ensureAdminUnlocked } from './auth.js';
import { tabModels, tabTv } from './admin-v3.js';
import { tabConsumables } from './admin-v4.js';   // v4: Verbrauch & kritische Ressourcen

const OBJ_TYPES = {
  slot: { label: 'Stellplatz', w: 2.9, h: 5.0, color: '#94a3b8', props: { kind: 'standard', capacity: 1 } },
  shelf: { label: 'Regal', w: 0.6, h: 3.0, color: '#0ea5e9', props: { levels: 4 } },
  workbench: { label: 'Werkbank', w: 0.7, h: 2.0, color: '#b45309', props: {} },
  toolwall: { label: 'Werkzeugwand', w: 2.0, h: 0.25, color: '#64748b', props: {} },
  zone: { label: 'Zone', w: 2.0, h: 2.0, color: '#a855f7', props: { hatch: true } },
  door: { label: 'Tor', w: 3.0, h: 0.15, color: '#f59e0b', props: {} },
  tyrestack: { label: 'Reifenlager', w: 0.7, h: 1.9, color: '#94a3b8', props: {} },
  fridge: { label: 'Kühlschrank', w: 0.6, h: 0.85, color: '#38bdf8', props: {} }
};

/* ====================================================================== */
export function initAdmin() {
  app.onBuilderSelect = (o) => renderProps(o ? { kind: 'object', obj: o } : null);
  app.onBuilderChange = (o) => { saveObjectDebounced(o); if (selectedObjId === o.id) renderProps({ kind: 'object', obj: o }); };
  app.onBlueprintCreate = createBlueprintItem;
  app.onBlueprintSelect = (it) => renderProps(it ? { kind: 'blueprint', item: it } : null);

  on($('#mapTopBar'), 'click', '[data-tb]', async (_e, b) => {
    const a = b.dataset.tb;
    const map = app.map;
    if (a === 'done') { setState({ builder: false }, ['builder']); renderProps(null); map.builderSelId = null; await refreshAll(); toast('Baukasten geschlossen. Layout gespeichert.', 'ok'); }
    if (a.startsWith('add:')) addObject(a.slice(4));
    if (a === 'bpedit') {
      if (!map.bp.edit && !(await ensureAdminUnlocked())) return;
      map.bp.edit = !map.bp.edit; map.bp.draft = null; renderMapTopBar();
    }
    if (a.startsWith('tool:')) { map.bp.tool = a.slice(5); map.bp.draft = null; const kinds = Object.keys(store.meta.blueprintKinds[map.bp.tool === 'node' ? 'node' : 'line']); if (!kinds.includes(map.bp.kind)) [map.bp.kind] = kinds; renderMapTopBar(); }
    if (a === 'finish') map.finishLine();
  });
  on($('#mapTopBar'), 'change', '[data-bpkind]', (_e, s) => { app.map.bp.kind = s.value; });
}

/* ---------------- Werkzeugleiste über der Map ---------------- */
export function renderMapTopBar() {
  const bar = $('#mapTopBar');
  if (!bar) return;
  if (store.builder && store.mode === 'hall') {
    setHTML(bar, html`
      <div class="pointer-events-auto glass rounded-xl px-2 py-1.5 flex flex-wrap items-center justify-center gap-1 border-cyan-400/40 shadow-[0_0_24px_rgba(34,211,238,.2)] max-w-[95vw]">
        <span class="font-display text-[11px] font-bold tracking-[0.2em] text-cyan-300 px-2">${icon('grid', 'w-3.5 h-3.5 inline')} BAUKASTEN</span>
        ${Object.entries(OBJ_TYPES).map(([k, t]) => html`<button class="btn btn-sm" data-tb="add:${k}">${icon('plus', 'w-3 h-3')} ${t.label}</button>`)}
        <button class="btn btn-sm btn-primary" data-tb="done">${icon('check', 'w-3.5 h-3.5')} Fertig</button>
      </div>
      <div class="pointer-events-none glass rounded-lg px-3 py-1 text-[11px] text-slate-400">Ziehen = verschieben (Shift: 0,5 m) · Ecke unten rechts = Größe · Pfeiltasten = feinjustieren</div>`);
    return;
  }
  if (store.mode === 'blueprint') {
    const bp = app.map ? app.map.bp : { edit: false, tool: 'select', kind: 'v230' };
    const kinds = store.meta.blueprintKinds[bp.tool === 'node' ? 'node' : 'line'];
    setHTML(bar, html`
      <div class="pointer-events-auto glass rounded-xl px-2 py-1.5 flex flex-wrap items-center justify-center gap-1 !bg-[#041021]/90 !border-sky-400/40 shadow-[0_0_24px_rgba(56,189,248,.25)] max-w-[95vw]">
        <span class="font-display text-[11px] font-bold tracking-[0.2em] neon-text px-2">${icon('zap', 'w-3.5 h-3.5 inline')} BLUEPRINT · RÖNTGENBLICK</span>
        ${isAdmin() ? html`<button class="btn btn-sm ${bp.edit ? 'btn-primary' : ''}" data-tb="bpedit">${icon(bp.edit ? 'unlock' : 'lock', 'w-3.5 h-3.5')} ${bp.edit ? 'Bearbeiten an' : 'Bearbeiten'}</button>` : ''}
        ${bp.edit ? html`
          <div class="mode-switch">
            <button class="${bp.tool === 'select' ? 'on bp' : ''}" data-tb="tool:select">Auswählen</button>
            <button class="${bp.tool === 'line' ? 'on bp' : ''}" data-tb="tool:line">Leitung</button>
            <button class="${bp.tool === 'node' ? 'on bp' : ''}" data-tb="tool:node">Punkt</button>
          </div>
          ${bp.tool !== 'select' ? html`<select class="select !w-auto !py-1 text-xs" data-bpkind>${Object.entries(store.meta.blueprintLayers || { x: { label: '' } }).map(([lk, l]) => {
            const opts = Object.entries(kinds).filter(([, v]) => !store.meta.blueprintLayers || v.layer === lk);
            return opts.length ? html`<optgroup label="${l.label}">${opts.map(([k, v]) => html`<option value="${k}" ${bp.kind === k ? 'selected' : ''}>${v.label}</option>`)}</optgroup>` : '';
          })}</select>` : ''}
          ${bp.tool === 'line' ? html`<button class="btn btn-sm" data-tb="finish">${icon('check', 'w-3 h-3')} Linie fertig</button>` : ''}` : ''}
      </div>
      ${bp.edit && bp.tool === 'line' ? html`<div class="pointer-events-none glass rounded-lg px-3 py-1 text-[11px] text-sky-200/80">Klicken = Punkt setzen (rechtwinklig, Shift = frei) · Doppelklick/Enter = fertig · Esc = abbrechen · Rücktaste = letzten Punkt weg</div>` : ''}`);
    return;
  }
  setHTML(bar, '');
}

/* ---------------- Builder: Objekte ---------------- */
let selectedObjId = null;
const saveTimers = new Map();

function saveObjectDebounced(o) {
  clearTimeout(saveTimers.get(o.id));
  saveTimers.set(o.id, setTimeout(async () => {
    try { await put(`/layout/objects/${o.id}`, { x: o.x, y: o.y, w: o.w, h: o.h }); } catch (err) { toastError(err); }
  }, 300));
}

async function addObject(type) {
  const t = OBJ_TYPES[type];
  const cam = app.map.cam;
  const hall = store.hall;
  const x = Math.max(0, Math.min(hall.width - t.w, Math.round((cam.x - t.w / 2) * 10) / 10));
  const y = Math.max(0, Math.min(hall.depth - t.h, Math.round((cam.y - t.h / 2) * 10) / 10));
  const count = store.objects.filter((o) => o.type === type).length + 1;
  const code = type === 'slot' ? `P${count}` : type === 'shelf' ? String.fromCharCode(64 + count) : `${type.slice(0, 2).toUpperCase()}${count}`;
  try {
    const obj = await post('/layout/objects', { type, code, label: `${t.label} ${type === 'shelf' ? code : count}`, x, y, w: t.w, h: t.h, color: t.color, props: t.props });
    store.objects.push(obj);
    emit('layout');
    app.map.builderSelId = obj.id;
    renderProps({ kind: 'object', obj });
    haptic(10);
  } catch (err) { toastError(err); }
}

function renderProps(sel) {
  const panel = $('#propsPanel');
  if (!sel) { panel.classList.add('hidden'); selectedObjId = null; return; }
  panel.classList.remove('hidden');
  if (sel.kind === 'object') {
    const o = sel.obj;
    selectedObjId = o.id;
    const p = o.props || {};
    setHTML(panel, html`
      <div class="flex items-center justify-between mb-3"><h3 class="font-display font-bold text-white">${OBJ_TYPES[o.type] ? OBJ_TYPES[o.type].label : o.type}</h3><button class="btn-icon" data-pp="close">${icon('x')}</button></div>
      <form class="space-y-2.5" data-ppform>
        <div class="grid grid-cols-[80px_1fr] gap-2">
          <label><span class="label">Code</span><input class="input" name="code" value="${o.code || ''}"></label>
          <label><span class="label">Bezeichnung</span><input class="input" name="label" value="${o.label || ''}"></label>
        </div>
        <div class="grid grid-cols-4 gap-1.5">
          ${['x', 'y', 'w', 'h'].map((k) => html`<label><span class="label">${{ x: 'X', y: 'Y', w: 'Breite', h: 'Tiefe' }[k]}</span><input class="input !px-2 text-sm font-mono" type="number" step="0.1" name="${k}" value="${o[k]}"></label>`)}
        </div>
        <label><span class="label">Farbe</span><input class="input" type="color" name="color" value="${o.color || '#94a3b8'}"></label>
        ${o.type === 'slot' ? html`
          <label><span class="label">Art</span><select class="select" name="kind">${Object.entries(store.meta.slotKinds).map(([k, l]) => html`<option value="${k}" ${p.kind === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label><span class="label">Kapazität (Autos)</span><select class="select" name="capacity"><option value="1" ${Number(p.capacity) !== 2 ? 'selected' : ''}>1</option><option value="2" ${Number(p.capacity) === 2 ? 'selected' : ''}>2 (oben + unten)</option></select></label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" name="blocksLane" ${p.blocksLane ? 'checked' : ''}> Blockiert die Schneise, wenn belegt</label>` : ''}
        ${o.type === 'shelf' ? html`<label><span class="label">Etagen</span><input class="input" type="number" min="1" max="10" name="levels" value="${p.levels || 4}"></label>` : ''}
        ${o.type === 'zone' ? html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" name="hatch" ${p.hatch ? 'checked' : ''}> Schraffiert</label>` : ''}
        <label><span class="label">Ebene (Zeichenreihenfolge)</span><input class="input" type="number" name="sort" value="${o.sort || 0}"></label>
        <div class="flex gap-2 pt-1">
          <button type="button" class="btn btn-danger" data-pp="delete">${icon('trash')}</button>
          <button class="btn btn-primary flex-1">${icon('check')} Übernehmen</button>
        </div>
      </form>`);
    return;
  }
  // Blueprint-Element
  const it = sel.item;
  const kinds = store.meta.blueprintKinds[it.type];
  const editable = isAdmin() && app.map.bp.edit;
  setHTML(panel, html`
    <div class="flex items-center justify-between mb-3"><h3 class="font-display font-bold neon-text">${it.type === 'line' ? 'Leitung' : 'Punkt'}</h3><button class="btn-icon" data-pp="close">${icon('x')}</button></div>
    ${editable ? html`
      <form class="space-y-2.5" data-bpform>
        <label><span class="label">Art</span><select class="select" name="kind">${Object.entries(kinds).map(([k, v]) => html`<option value="${k}" ${it.kind === k ? 'selected' : ''}>${v.label}</option>`)}</select></label>
        <label><span class="label">Beschriftung</span><input class="input" name="label" value="${it.label || ''}" placeholder="z. B. CEE 16A Bühne 1"></label>
        <div class="text-[11px] text-slate-400 font-mono">${it.points.length} Punkt(e) · ${it.type === 'line' ? `${lineLength(it.points).toFixed(1)} m` : `${it.points[0][0]} / ${it.points[0][1]}`}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-danger" data-pp="bpdelete">${icon('trash')}</button><button class="btn btn-primary flex-1">Speichern</button></div>
      </form>` : html`
      <div class="text-sm space-y-1">
        <div><span class="dot" style="background:${kinds[it.kind] ? kinds[it.kind].color : '#fff'}"></span> ${kinds[it.kind] ? kinds[it.kind].label : it.kind}</div>
        ${it.label ? html`<div class="text-white font-semibold">${it.label}</div>` : ''}
        ${it.type === 'line' ? html`<div class="text-slate-400 font-mono text-xs">Länge ca. ${lineLength(it.points).toFixed(1)} m</div>` : ''}
      </div>`}`);
  panel.dataset.bpid = it.id;
}

const lineLength = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

function bindPropsPanel() {
  const panel = $('#propsPanel');
  on(panel, 'click', '[data-pp]', async (_e, b) => {
    const a = b.dataset.pp;
    if (a === 'close') { renderProps(null); app.map.builderSelId = null; app.map.bp.selId = null; }
    if (a === 'delete') {
      const o = store.objects.find((x) => x.id === selectedObjId);
      if (!o || !(await confirmDialog(`„${o.label || o.code}“ entfernen?${o.type === 'slot' ? ' Autos auf diesem Platz wandern in den Paddock.' : ''}`, { danger: true, okLabel: 'Entfernen' }))) return;
      try { await del(`/layout/objects/${o.id}`); renderProps(null); app.map.builderSelId = null; await refreshAll(); } catch (err) { toastError(err); }
    }
    if (a === 'bpdelete') {
      try { await del(`/blueprint/${panel.dataset.bpid}`); renderProps(null); app.map.bp.selId = null; await refreshBlueprint(); } catch (err) { toastError(err); }
    }
  });
  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    try {
      if (e.target.matches('[data-ppform]')) {
        const o = store.objects.find((x) => x.id === selectedObjId);
        const props = { ...o.props };
        if (o.type === 'slot') { props.kind = f.kind; props.capacity = Number(f.capacity); props.blocksLane = !!f.blocksLane; }
        if (o.type === 'shelf') props.levels = Number(f.levels) || 4;
        if (o.type === 'zone') props.hatch = !!f.hatch;
        const saved = await put(`/layout/objects/${o.id}`, { code: f.code, label: f.label, x: f.x, y: f.y, w: f.w, h: f.h, color: f.color, sort: f.sort, props });
        Object.assign(o, saved);
        emit('layout');
        toast('Objekt aktualisiert.', 'ok');
      } else if (e.target.matches('[data-bpform]')) {
        await put(`/blueprint/${panel.dataset.bpid}`, { kind: f.kind, label: f.label });
        await refreshBlueprint();
        toast('Gespeichert.', 'ok');
      }
    } catch (err) { toastError(err); }
  });
}
setTimeout(bindPropsPanel, 0);

/* ---------------- Blueprint: Elemente anlegen ---------------- */
async function createBlueprintItem(item) {
  try {
    const kinds = store.meta.blueprintKinds[item.type];
    const saved = await post('/blueprint', { ...item, label: '' });
    if (store.bpHidden.has(bpLayerOf(item))) setBpLayer(bpLayerOf(item), true);   // v5.2: neues Element sichtbar machen
    await refreshBlueprint();
    app.map.bp.selId = saved.id;
    renderProps({ kind: 'blueprint', item: store.blueprint.find((b) => b.id === saved.id) });
    toast(`${kinds[item.kind].label} eingezeichnet.`, 'ok');
    haptic(10);
  } catch (err) { toastError(err); }
}

/* ====================================================================== */
/* Admin-Konsole                                                          */
/* ====================================================================== */
/** Ersetzt den Container durch eine leere Kopie, damit keine alten Event-Listener hängen bleiben. */
function fresh(c) {
  const n = c.cloneNode(false);
  c.replaceWith(n);
  return n;
}

const CONSOLE_TABS = [['builder', 'Baukasten', 'grid'], ['users', 'Nutzer', 'users'], ['models', 'Fahrzeug-Modelle', 'car'], ['tv', 'TV-Dashboard', 'board'], ['consumables', 'Verbrauch & Kritisch', 'alert'],
  ['hallpass', 'Hall Pass', 'link'], ['quick', 'Quick-Checks', 'flag'], ['import', 'CSV-Import', 'upload'], ['devices', 'Geräte', 'power'], ['system', 'System', 'settings']];

export async function openAdminConsole() {
  if (!isAdmin()) return;
  if (!(await ensureAdminUnlocked())) return;
  let tab = 'builder';
  const body = el(html`<div class="-mx-5 -my-4"><nav class="tabs px-3 border-b border-white/10 sticky top-0 bg-[#121821] z-10" data-tabs></nav><div class="px-5 py-4" data-content></div></div>`);
  const m = openModal({ title: 'Admin-Konsole', subtitle: 'Halle, Nutzer und Daten verwalten', size: 'xl', iconName: 'unlock', body });
  const tabsEl = body.querySelector('[data-tabs]');
  const render = () => {
    setHTML(tabsEl, html`${CONSOLE_TABS.map(([k, l, i]) => html`<button class="tab ${tab === k ? 'active' : ''}" data-t="${k}">${icon(i, 'w-3.5 h-3.5')} ${l}</button>`)}`);
    const content = body.querySelector('[data-content]');
    ({ builder: tabBuilder, users: tabUsers, models: tabModels, tv: tabTv, consumables: tabConsumables, hallpass: tabHallpass, quick: tabQuick, import: tabImport, devices: tabDevices, system: tabSystem })[tab](content, m);
  };
  on(tabsEl, 'click', '[data-t]', (_e, b) => { tab = b.dataset.t; render(); });
  render();
}

/* ---------------- Baukasten ---------------- */
function tabBuilder(c0, m) {
  const c = fresh(c0);
  setHTML(c, html`
    <div class="grid md:grid-cols-2 gap-4">
      <div class="card p-5">
        <div class="hazard h-1.5 rounded mb-4"></div>
        <h3 class="font-display font-bold text-white text-lg mb-1">No-Code Garage-Builder</h3>
        <p class="text-sm text-slate-400 mb-4">Stellplätze, Regale, Werkbänke, Werkzeugwände und Zonen direkt auf der Map hinzufügen, verschieben, skalieren und umbenennen. Alles wird sofort gespeichert.</p>
        <button class="btn btn-primary w-full" data-a="builder">${icon('grid')} Baukasten auf der Map öffnen</button>
      </div>
      <div class="card p-5">
        <h3 class="font-display font-bold neon-text text-lg mb-1">Blueprint-Modus</h3>
        <p class="text-sm text-slate-400 mb-4">Elektrik (230 V, 400 V, Verteiler) und Druckluft (Kompressor, Rohre, Abscheider) per Linienzug einzeichnen.</p>
        <button class="btn w-full !border-sky-400/50 !text-sky-200" data-a="blueprint">${icon('zap')} Blueprint bearbeiten</button>
      </div>
    </div>`);
  on(c, 'click', '[data-a]', (_e, b) => {
    m.close();
    if (window.innerWidth < 1024) app.setMobileView('map');
    if (b.dataset.a === 'builder') {
      app.setMode('hall');
      setState({ builder: true }, ['builder']);
      app.map.select(null);
      app.map.fitParams && app.map.focusRect({ x: -0.5, y: -0.5, w: store.hall.width + 1, h: store.hall.depth + 1 }, { pad: 0.5 });
      toast('Baukasten aktiv: Objekt anklicken und ziehen.', 'info', 4000);
    } else {
      app.setMode('blueprint');
      app.map.bp.edit = true;
      app.map.bp.tool = 'line';
      renderMapTopBar();
    }
  });
}

/* ---------------- Nutzer ---------------- */
async function tabUsers(c0) {
  const c = fresh(c0);
  let users = [];
  try { users = await get('/admin/users'); } catch (err) { toastError(err); return; }
  setHTML(c, html`
    <div class="space-y-2 mb-5">
      ${users.map((u) => html`
        <div class="card px-3 py-2.5 flex flex-wrap items-center gap-3 ${u.active ? '' : 'opacity-50'}" data-u="${u.id}">
          <span class="w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-black" style="background:${u.color}">${initials(u.name)}</span>
          <div class="flex-1 min-w-[120px]"><div class="font-semibold text-white">${u.name}${store.me.id === u.id ? html` <span class="text-[10px] text-cyan-300">(du)</span>` : ''}</div><div class="text-[11px] text-slate-500">seit ${fmtDateTime(u.created_at)}</div></div>
          <select class="select !w-auto !py-1 text-sm" data-role><option value="schrauber" ${u.role === 'schrauber' ? 'selected' : ''}>Schrauber</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select>
          <input type="color" class="input !w-12 !h-9" value="${u.color}" data-color>
          <button class="btn btn-sm" data-pin>${icon('lock', 'w-3.5 h-3.5')} PIN</button>
          <button class="btn btn-sm" data-active>${u.active ? 'Sperren' : 'Aktivieren'}</button>
          ${store.me.id !== u.id ? html`<button class="btn-icon hover:!text-rose-300" data-del>${icon('trash')}</button>` : ''}
        </div>`)}
    </div>
    <form class="card p-4 grid sm:grid-cols-[1fr_140px_70px_120px_auto] gap-2 items-end" data-newuser>
      <label><span class="label">Name</span><input class="input" name="name" required placeholder="z. B. Kumpel 3"></label>
      <label><span class="label">Rolle</span><select class="select" name="role"><option value="schrauber">Schrauber</option><option value="admin">Admin</option></select></label>
      <label><span class="label">Farbe</span><input class="input" type="color" name="color" value="#f97316"></label>
      <label><span class="label">PIN (4 bis 8)</span><input class="input font-mono" name="pin" inputmode="numeric" pattern="\\d{4,8}" required></label>
      <button class="btn btn-primary">${icon('plus')} Anlegen</button>
    </form>
    <p class="text-xs text-slate-500 mt-3"><b>Rechte:</b> Schrauber dürfen umparken, Aufgaben, Teile, Events und Dokumente pflegen. Admins zusätzlich Baukasten, Blueprint, Nutzer, Import und Konverter. Gäste (Hall Pass) sehen alles nur lesend.</p>`);
  const reload = () => tabUsers(c);
  on(c, 'change', '[data-role]', async (_e, s) => { try { await put(`/admin/users/${s.closest('[data-u]').dataset.u}`, { role: s.value }); toast('Rolle geändert.', 'ok'); } catch (err) { toastError(err); reload(); } });
  on(c, 'change', '[data-color]', async (_e, s) => { try { await put(`/admin/users/${s.closest('[data-u]').dataset.u}`, { color: s.value }); await refreshAll(); } catch (err) { toastError(err); } });
  on(c, 'click', '[data-pin]', async (_e, b) => {
    const pin = await pinPad({ title: 'Neue PIN', subtitle: '4 bis 8 Ziffern' });
    if (!pin) return;
    try { await put(`/admin/users/${b.closest('[data-u]').dataset.u}`, { pin }); toast('PIN geändert.', 'ok'); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-active]', async (_e, b) => {
    const u = users.find((x) => x.id === Number(b.closest('[data-u]').dataset.u));
    try { await put(`/admin/users/${u.id}`, { active: !u.active }); reload(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-del]', async (_e, b) => {
    const u = users.find((x) => x.id === Number(b.closest('[data-u]').dataset.u));
    if (!(await confirmDialog(`Profil „${u.name}“ löschen?`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/admin/users/${u.id}`); reload(); } catch (err) { toastError(err); }
  });
  c.querySelector('[data-newuser]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/admin/users', formData(e.target)); toast('Profil angelegt.', 'ok'); reload(); refreshAll(); } catch (err) { toastError(err); }
  });
}

/* ---------------- Hall Pass ---------------- */
async function tabHallpass(c0) {
  const c = fresh(c0);
  let pass;
  try { pass = await get('/admin/hallpass'); } catch (err) { toastError(err); return; }
  const url = `${location.origin}/?pass=${pass.token}`;
  setHTML(c, html`
    <div class="card p-5 max-w-2xl">
      <div class="flex items-center gap-3 mb-3">
        <span class="text-amber-300">${icon('link', 'w-6 h-6')}</span>
        <div class="flex-1"><h3 class="font-display font-bold text-white text-lg">Hall Pass</h3><p class="text-sm text-slate-400">Gast-Link für Eltern & Freunde: Halle, Autos und Events ansehen, nichts ändern.</p></div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" data-enabled ${pass.enabled ? 'checked' : ''}> aktiv</label>
      </div>
      <div class="flex gap-2 ${pass.enabled ? '' : 'opacity-40 pointer-events-none'}">
        <input class="input font-mono text-sm" readonly value="${url}" data-url>
        <button class="btn" data-copy>${icon('file')} Kopieren</button>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-sm" data-regen>${icon('refresh', 'w-3.5 h-3.5')} Neuen Link erzeugen (alter wird ungültig)</button>
      </div>
    </div>`);
  c.querySelector('[data-enabled]').addEventListener('change', async (e) => {
    try { await put('/admin/hallpass', { enabled: e.target.checked }); toast(e.target.checked ? 'Hall Pass aktiv.' : 'Hall Pass deaktiviert, Gäste wurden abgemeldet.', 'ok'); tabHallpass(c); } catch (err) { toastError(err); }
  });
  c.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link kopiert.', 'ok'); } catch { c.querySelector('[data-url]').select(); }
  });
  c.querySelector('[data-regen]').addEventListener('click', async () => {
    if (!(await confirmDialog('Neuen Link erzeugen? Der alte Link funktioniert dann nicht mehr.', { okLabel: 'Erzeugen' }))) return;
    try { await post('/admin/hallpass/regenerate'); tabHallpass(c); } catch (err) { toastError(err); }
  });
}

/* ---------------- Post-Event Quick-Checks ---------------- */
const qRow = (q = {}) => html`
  <div class="grid grid-cols-1 sm:grid-cols-[1fr_170px_1fr_auto] gap-1.5" data-qrow>
    <input class="input text-sm" placeholder="Frage, z. B. Reifen abgefahren?" value="${q.text || ''}" data-k="text">
    <select class="select text-sm" data-k="taskOn"><option value="">keine Aufgabe</option><option value="yes" ${q.taskOn === 'yes' ? 'selected' : ''}>Aufgabe bei Ja</option><option value="no" ${q.taskOn === 'no' ? 'selected' : ''}>Aufgabe bei Nein</option></select>
    <input class="input text-sm" placeholder="Aufgabentitel" value="${q.taskTitle || ''}" data-k="taskTitle">
    <button type="button" class="btn-icon" data-delq>${icon('x', 'w-3.5 h-3.5')}</button>
  </div>`;

async function tabQuick(c0) {
  const c = fresh(c0);
  let list = [];
  try { list = await get('/admin/quickchecks'); } catch (err) { toastError(err); return; }
  const events = await get('/events').catch(() => []);
  setHTML(c, html`
    <div class="space-y-3 mb-6">
      ${list.map((q) => html`
        <div class="card p-3" data-qc="${q.id}">
          <div class="flex flex-wrap items-center gap-2">
            <span class="${q.active ? 'text-lime-300' : 'text-slate-500'}">${icon('flag')}</span>
            <div class="flex-1 min-w-[160px]"><div class="font-semibold text-white">${q.title}</div>
              <div class="text-[11px] text-slate-500">${q.event_name || 'ohne Event'} · ${q.vehicle_name || 'Halle'} · ${q.questions.length} Fragen · ${q.answers.length} Antworten</div></div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" data-qactive ${q.active ? 'checked' : ''}> beim Login abfragen</label>
            <button class="btn btn-sm" data-qreset title="Alle erneut fragen">${icon('refresh', 'w-3.5 h-3.5')}</button>
            <button class="btn-icon hover:!text-rose-300" data-qdel>${icon('trash')}</button>
          </div>
          ${q.answers.length ? html`<details class="mt-2"><summary class="text-xs text-cyan-300 cursor-pointer">Antworten ansehen</summary>
            <div class="mt-2 space-y-2">${q.answers.map((a) => html`<div class="text-xs bg-black/30 rounded p-2"><b class="text-white">${a.user_name}</b> · ${fmtDateTime(a.created_at)}
              <ul class="mt-1 space-y-0.5">${q.questions.map((qq, i) => { const ans = a.answers.find((x) => Number(x.index) === i) || {}; return html`<li>${qq.text} <b class="${ans.value === 'yes' ? 'text-lime-300' : 'text-rose-300'}">${ans.value === 'yes' ? 'Ja' : ans.value === 'no' ? 'Nein' : '?'}</b>${ans.note ? html` <span class="text-slate-400">(${ans.note})</span>` : ''}</li>`; })}</ul></div>`)}</div></details>` : ''}
        </div>`)}
      ${!list.length ? html`<p class="text-sm text-slate-500">Noch keine Quick-Checks.</p>` : ''}
    </div>
    <form class="card p-4 space-y-3" data-newqc>
      <h4 class="font-display font-bold text-white">Neuer Post-Event Quick-Check</h4>
      <div class="grid sm:grid-cols-3 gap-2">
        <label><span class="label">Titel</span><input class="input" name="title" placeholder="Post-Event Check" required></label>
        <label><span class="label">Event</span><select class="select" name="event_id"><option value="">keins</option>${events.map((e) => html`<option value="${e.id}">${e.name} (${e.date_start})</option>`)}</select></label>
        <label><span class="label">Auto (Ziel der Aufgaben)</span><select class="select" name="vehicle_id"><option value="">Halle</option>${store.vehicles.map((v) => html`<option value="${v.id}">${v.name}</option>`)}</select></label>
      </div>
      <div class="space-y-2" data-qrows>${qRow({ text: 'Reifen abgefahren?', taskOn: 'yes', taskTitle: 'Neue Reifen aufziehen' })}${qRow({ text: 'Diff-Öl gewechselt?', taskOn: 'no', taskTitle: 'Diff-Öl wechseln' })}</div>
      <div class="flex flex-wrap gap-2 items-center">
        <button type="button" class="btn btn-sm" data-addq>${icon('plus', 'w-3 h-3')} Frage</button>
        <label class="flex items-center gap-2 text-sm ml-auto"><input type="checkbox" class="check" name="active" checked> sofort aktivieren</label>
        <button class="btn btn-primary">${icon('check')} Anlegen</button>
      </div>
    </form>`);
  const reload = () => tabQuick(c);
  on(c, 'click', '[data-addq]', () => c.querySelector('[data-qrows]').appendChild(el(qRow())));
  on(c, 'click', '[data-delq]', (_e, b) => b.closest('[data-qrow]').remove());
  on(c, 'change', '[data-qactive]', async (_e, cb) => {
    try { await put(`/admin/quickchecks/${cb.closest('[data-qc]').dataset.qc}`, { active: cb.checked }); toast(cb.checked ? 'Wird beim nächsten Login abgefragt.' : 'Deaktiviert.', 'ok'); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-qreset]', async (_e, b) => {
    try { await put(`/admin/quickchecks/${b.closest('[data-qc]').dataset.qc}`, { active: true, resetAnswers: true }); toast('Alle Schrauber werden erneut gefragt.', 'ok'); reload(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-qdel]', async (_e, b) => {
    if (!(await confirmDialog('Quick-Check löschen?', { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/admin/quickchecks/${b.closest('[data-qc]').dataset.qc}`); reload(); } catch (err) { toastError(err); }
  });
  c.querySelector('[data-newqc]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const questions = [...c.querySelectorAll('[data-qrow]')].map((r) => Object.fromEntries([...r.querySelectorAll('[data-k]')].map((i) => [i.dataset.k, i.value])));
    try { await post('/admin/quickchecks', { ...f, questions }); toast('Quick-Check angelegt.', 'ok'); reload(); } catch (err) { toastError(err); }
  });
}

/* ---------------- CSV-Import ---------------- */
const IMPORT_FIELDS = {
  parts: [['name', 'Name *'], ['category', 'Kategorie'], ['qty', 'Anzahl'], ['condition', 'Zustand'], ['shelf', 'Regal (A/B)'], ['level', 'Etage'], ['box', 'Box'], ['vehicle', 'Auto / Universal / Freitext'], ['event', 'Event-relevant (x/ja)'], ['part_number', 'Teilenummer'], ['notes', 'Notizen']],
  tools: [['name', 'Name *'], ['category', 'Kategorie'], ['qty', 'Anzahl'], ['location', 'Ort (Freitext)'], ['shelf', 'Regal'], ['level', 'Etage'], ['box', 'Box'], ['event', 'Event-relevant (x/ja)'], ['price', 'Preis'], ['notes', 'Notizen']]
};

function tabImport(c0) {
  const c = fresh(c0);
  let preview = null;
  let target = 'parts';
  // v5.2: Zielfach-Routing (Standard-Regal, Ebene, Eurobox) für Zeilen ohne eigenen Lagerort
  const def = { shelf_id: '', level: '', box_id: '', box_label: '', override: false };
  let boxes = [];
  get('/boxes').then((b) => { boxes = b; if (preview) render(); }).catch(() => {});
  const shelves = () => store.objects.filter((o) => o.type === 'shelf').sort((a, b) => String(a.code).localeCompare(String(b.code), 'de', { numeric: true }));
  const routeHtml = () => {
    const sh = shelves().find((x) => String(x.id) === String(def.shelf_id));
    const levels = sh ? Number(sh.props && sh.props.levels) || 4 : 4;
    const bx = sh ? boxes.filter((b) => b.shelf_id === sh.id && (!def.level || String(b.level) === String(def.level))) : [];
    const hasCsvLoc = preview && (preview.mapping.shelf || preview.mapping.box);
    return html`
      <div class="card p-3 mb-4 border-cyan-400/30" data-route>
        <div class="flex items-center gap-2 mb-2"><span class="text-cyan-300">${icon('target', 'w-4 h-4')}</span><h4 class="font-display font-bold text-white text-sm flex-1">Zielfach (Standard-Lagerort)</h4></div>
        <p class="text-xs text-slate-400 mb-2">Alle importierten Zeilen ohne eigenen Lagerort landen hier. ${hasCsvLoc ? 'Zeilen mit Regal/Box in der CSV behalten ihren Lagerort (außer du setzt den Haken unten).' : 'Die CSV hat keine Regal-/Box-Spalte zugeordnet: alle Zeilen kommen ins Zielfach.'}</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label><span class="label">Regal</span><select class="select text-sm" data-def="shelf_id"><option value="">kein Standard</option>${shelves().map((x) => html`<option value="${x.id}" ${String(def.shelf_id) === String(x.id) ? 'selected' : ''}>${x.label || `Regal ${x.code}`}</option>`)}</select></label>
          <label><span class="label">Ebene</span><select class="select text-sm" data-def="level" ${sh ? '' : 'disabled'}><option value="">egal</option>${Array.from({ length: levels }, (_, i) => html`<option value="${i + 1}" ${String(def.level) === String(i + 1) ? 'selected' : ''}>Ebene ${i + 1}</option>`)}</select></label>
          <label><span class="label">Eurobox</span><select class="select text-sm" data-def="box_id" ${sh ? '' : 'disabled'}><option value="">lose ins Fach</option>${bx.map((b) => html`<option value="${b.id}" ${String(def.box_id) === String(b.id) ? 'selected' : ''}>E${b.level} · ${b.label}</option>`)}<option value="new" ${def.box_id === 'new' ? 'selected' : ''}>+ Neue Box …</option></select></label>
          ${def.box_id === 'new' ? html`<label><span class="label">Name neue Box</span><input class="input text-sm" data-def="box_label" value="${def.box_label}" placeholder="z. B. Import Oktober"></label>` : html`<div></div>`}
        </div>
        ${hasCsvLoc ? html`<label class="flex items-center gap-2 text-xs text-slate-300 mt-2"><input type="checkbox" class="check !w-4 !h-4" data-def="override" ${def.override ? 'checked' : ''}> Lagerort aus der CSV ignorieren, ALLE Zeilen ins Zielfach</label>` : ''}
      </div>`;
  };
  const render = () => {
    setHTML(c, html`
      <div class="card p-4 mb-4">
        <h3 class="font-display font-bold text-white mb-1">Google Sheets importieren</h3>
        <p class="text-sm text-slate-400 mb-3">In Google Sheets: <i>Datei → Herunterladen → CSV</i>. Komma, Semikolon und Tab werden automatisch erkannt. Regale per Code (A/B), Boxen werden bei Bedarf angelegt, Autos per Name zugeordnet, „Universal“ macht ein Teil universell.</p>
        <form class="flex flex-wrap gap-2 items-end" data-upload>
          <label><span class="label">Ziel</span><select class="select" name="target"><option value="parts" ${target === 'parts' ? 'selected' : ''}>Ersatzteile</option><option value="tools" ${target === 'tools' ? 'selected' : ''}>Werkzeug</option></select></label>
          <label class="flex-1 min-w-[200px]"><span class="label">CSV-Datei</span><input type="file" name="file" accept=".csv,text/csv,text/plain" class="block w-full text-sm text-slate-400" required></label>
          <button class="btn btn-primary">${icon('eye')} Vorschau</button>
        </form>
      </div>
      ${preview ? html`
        <div class="card p-4">
          <div class="flex items-center justify-between mb-3"><h4 class="font-display font-bold text-white">Spalten zuordnen</h4><span class="text-xs text-slate-400">${preview.rowCount} Zeilen · Trennzeichen „${preview.delimiter === '\t' ? 'Tab' : preview.delimiter}“</span></div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
            ${IMPORT_FIELDS[target].map(([k, l]) => html`<label><span class="label">${l}</span><select class="select text-sm" data-map="${k}"><option value="">nicht importieren</option>${preview.headers.map((h) => html`<option ${preview.mapping[k] === h ? 'selected' : ''}>${h}</option>`)}</select></label>`)}
          </div>
          ${routeHtml()}
          <div class="overflow-x-auto rounded-lg border border-white/10 mb-4">
            <table class="text-xs w-full"><thead class="bg-black/40"><tr>${preview.headers.map((h) => html`<th class="text-left px-2 py-1.5 font-semibold text-slate-300 whitespace-nowrap">${h}</th>`)}</tr></thead>
              <tbody>${preview.rows.slice(0, 8).map((r) => html`<tr class="border-t border-white/5">${preview.headers.map((h) => html`<td class="px-2 py-1 text-slate-400 whitespace-nowrap">${r[h]}</td>`)}</tr>`)}</tbody></table>
          </div>
          <button class="btn btn-lime" data-commit>${icon('download')} ${preview.rowCount} Zeilen importieren</button>
        </div>` : ''}`);
  };
  render();
  c.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    e.preventDefault();
    target = e.target.target.value;
    try { preview = await upload('/admin/import/preview', new FormData(e.target)); render(); } catch (err) { toastError(err); }
  });
  // Zielfach-Auswahl merken; Regal/Ebene beeinflussen die Box-Liste
  c.addEventListener('change', (e) => {
    const d = e.target.closest('[data-def]');
    if (d) {
      const k = d.dataset.def;
      def[k] = d.type === 'checkbox' ? d.checked : d.value;
      if (k === 'shelf_id') { def.level = ''; def.box_id = ''; }
      if (k === 'level') def.box_id = '';
      if (k !== 'box_label') { remember(); render(); }
      return;
    }
    const m = e.target.closest('[data-map]');
    if (m && preview) { preview.mapping[m.dataset.map] = m.value || undefined; remember(); render(); }
  });
  c.addEventListener('input', (e) => { const d = e.target.closest('[data-def="box_label"]'); if (d) def.box_label = d.value; });
  // aktuelle Spaltenzuordnung vor jedem Neuzeichnen sichern
  function remember() { if (!preview) return; c.querySelectorAll('[data-map]').forEach((x) => { preview.mapping[x.dataset.map] = x.value || undefined; }); }
  c.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-commit]')) return;
    const mapping = {};
    c.querySelectorAll('[data-map]').forEach((s) => { if (s.value) mapping[s.dataset.map] = s.value; });
    if (!mapping.name) { toast('Bitte die Spalte für „Name“ zuordnen.', 'warn'); return; }
    if (def.box_id === 'new' && !String(def.box_label).trim()) { toast('Bitte einen Namen für die neue Box eingeben.', 'warn'); return; }
    const defaults = def.shelf_id ? {
      shelf_id: Number(def.shelf_id), level: def.level ? Number(def.level) : null,
      box_id: def.box_id && def.box_id !== 'new' ? Number(def.box_id) : null,
      box_label: def.box_id === 'new' ? String(def.box_label).trim() : null, override: !!def.override
    } : null;
    try {
      const res = await post('/admin/import/commit', { target, mapping, rows: preview.rows, defaults });
      toast(`${res.imported} Einträge importiert${res.skipped.length ? `, ${res.skipped.length} leere Zeilen übersprungen` : ''}.`, 'ok', 5000);
      preview = null; render();
      get('/boxes').then((b) => { boxes = b; }).catch(() => {});
      if (app.refreshHud) app.refreshHud();
      app.rerenderTab();
    } catch (err) { toastError(err); }
  });
}

/* ---------------- Geräte (Smart Home vorbereitet) ---------------- */
async function tabDevices(c0) {
  const c = fresh(c0);
  let devices = [];
  try { devices = await get('/devices'); } catch (err) { toastError(err); return; }
  setHTML(c, html`
    <p class="text-sm text-slate-400 mb-3">Vorbereitet für smarte Steckdosen (Shelly, Tasmota), Heizungen, Sensoren und Webcams. Treiber liegen in <code class="font-mono text-cyan-300">server/devices/drivers.js</code>, die REST-Endpunkte unter <code class="font-mono text-cyan-300">/api/devices</code>.</p>
    <div class="space-y-2 mb-5">
      ${devices.map((d) => html`
        <div class="card px-3 py-2.5 flex flex-wrap items-center gap-3" data-dev="${d.id}">
          <span class="${d.state.on ? 'text-lime-300' : 'text-slate-500'}">${icon(d.type === 'camera' ? 'camera' : 'power')}</span>
          <div class="flex-1 min-w-[150px]"><div class="font-semibold text-white">${d.name}</div><div class="text-[11px] text-slate-500 font-mono">${d.type} · ${d.driver}${d.endpoint ? ` · ${d.endpoint}` : ''}</div></div>
          <span class="chip ${d.state.on ? '!text-lime-200 !border-lime-400/40' : ''}">${d.state.on ? 'AN' : 'AUS'}</span>
          ${d.type !== 'camera' ? html`<button class="btn btn-sm" data-act="on">An</button><button class="btn btn-sm" data-act="off">Aus</button>` : html`<a class="btn btn-sm" href="/api/devices/${d.id}/snapshot" target="_blank" rel="noopener">${icon('camera', 'w-3.5 h-3.5')} Bild</a>`}
          <button class="btn-icon hover:!text-rose-300" data-devdel>${icon('trash')}</button>
        </div>`)}
    </div>
    <form class="card p-4 grid sm:grid-cols-[1fr_120px_120px_1fr_auto] gap-2 items-end" data-newdev>
      <label><span class="label">Name</span><input class="input" name="name" required placeholder="Heizung Werkbank"></label>
      <label><span class="label">Typ</span><select class="select" name="type"><option value="plug">Steckdose</option><option value="heater">Heizung</option><option value="light">Licht</option><option value="sensor">Sensor</option><option value="camera">Webcam</option></select></label>
      <label><span class="label">Treiber</span><select class="select" name="driver"><option value="mock">Demo</option><option value="shelly">Shelly</option><option value="tasmota">Tasmota</option><option value="webhook">Webhook</option></select></label>
      <label><span class="label">Endpunkt</span><input class="input font-mono text-sm" name="endpoint" placeholder="http://192.168.0.50"></label>
      <button class="btn btn-primary">${icon('plus')}</button>
    </form>`);
  const reload = () => tabDevices(c);
  on(c, 'click', '[data-act]', async (_e, b) => {
    try { await post(`/devices/${b.closest('[data-dev]').dataset.dev}/action`, { action: b.dataset.act }); reload(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-devdel]', async (_e, b) => {
    if (!(await confirmDialog('Gerät entfernen?', { danger: true, okLabel: 'Entfernen' }))) return;
    try { await del(`/devices/${b.closest('[data-dev]').dataset.dev}`); reload(); } catch (err) { toastError(err); }
  });
  c.querySelector('[data-newdev]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/devices', formData(e.target)); reload(); } catch (err) { toastError(err); }
  });
}

/* ---------------- System ---------------- */
function tabSystem(c0) {
  const c = fresh(c0);
  const h = store.hall;
  setHTML(c, html`
    <div class="grid md:grid-cols-2 gap-4">
      <form class="card p-4 space-y-3" data-hall>
        <h4 class="font-display font-bold text-white">Halle</h4>
        <label class="block"><span class="label">Name</span><input class="input" name="name" value="${h.name || ''}"></label>
        <div class="grid grid-cols-2 gap-2">
          <label><span class="label">Breite (m)</span><input class="input" type="number" step="0.1" name="width" value="${h.width}"></label>
          <label><span class="label">Tiefe (m)</span><input class="input" type="number" step="0.1" name="depth" value="${h.depth}"></label>
        </div>
        <button class="btn btn-primary">${icon('check')} Speichern</button>
      </form>
      <div class="card p-4 space-y-3">
        <h4 class="font-display font-bold text-white">Backup</h4>
        <p class="text-sm text-slate-400">Lädt eine konsistente Kopie der SQLite-Datenbank herunter (Uploads liegen in <code class="font-mono text-cyan-300">data/uploads</code>).</p>
        <a class="btn" href="/api/admin/backup">${icon('download')} Datenbank sichern</a>
        <h4 class="font-display font-bold text-white pt-2">QR-Codes</h4>
        <p class="text-sm text-slate-400">Adresse, unter der Handys die App erreichen (WLAN-IP oder Domain). Steht in jedem gedruckten QR-Code.</p>
        <form class="flex gap-2" data-puburl>
          <input class="input font-mono text-sm" name="url" value="${(store.settings && store.settings.publicUrl) || ''}" placeholder="${location.origin}">
          <button class="btn">${icon('check')}</button>
        </form>
        <h4 class="font-display font-bold text-white pt-2">API</h4>
        <p class="text-sm text-slate-400">REST-Endpunkte unter <code class="font-mono text-cyan-300">/api</code>. Für Skripte: Header <code class="font-mono">Authorization: Bearer &lt;Session-Token&gt;</code>.</p>
      </div>
    </div>`);
  c.querySelector('[data-puburl]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await put('/settings/public-url', formData(e.target));
      store.settings = { ...(store.settings || {}), publicUrl: r.publicUrl };
      toast(r.publicUrl ? `QR-Codes zeigen jetzt auf ${r.publicUrl}` : 'Es wird die aktuelle Adresse verwendet.', 'ok');
    } catch (err) { toastError(err); }
  });
  c.querySelector('[data-hall]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await put('/layout/hall', formData(e.target)); await refreshAll(); app.map.fit(); toast('Halle gespeichert.', 'ok'); } catch (err) { toastError(err); }
  });
}
