/**
 * Drift-Tyre Hub (Reifenlager & Räder-Manager)
 * - Reifen, Felgen und Kompletträder getrennt verwalten
 * - Virtuelles Montieren / Abziehen
 * - 1-Klick "-2 Burned" mit Rauch-Animation und Rückgängig
 */
import { store, app, canEdit, refreshVehicles } from './state.js';
import { get, post, put, del, ApiError } from './api.js';
import { html, raw, setHTML, el, on, icon, toast, toastError, haptic, fmtDate, openModal, confirmDialog, chooseDialog, formData } from './ui.js';

const COND = { neu: { label: 'Neu', cls: '!text-lime-200 !border-lime-400/40' }, training: { label: '3 bis 4 mm / Training', cls: '!text-amber-200 !border-amber-400/40' }, burner: { label: 'Burner / Altreifen', cls: '!text-rose-200 !border-rose-400/40' } };
const CLASS = { drift: { label: 'Driftreifen', cls: '!text-orange-200 !border-orange-400/40' }, strasse: { label: 'Gute Reifen / Straße', cls: '!text-sky-200 !border-sky-400/40' } };

let knownDims = ['225/45 R17', '235/40 R18', '205/55 R16'];

/* ---------------- Grafiken ---------------- */
/** Seitenansicht eines Rads: Reifen (optional) + Felge. */
export function wheelSvg({ tyre = true, rim = true, worn = false, size = 56, rimColor = '#cbd5e1' } = {}) {
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 72 * Math.PI) / 180;
    return `<line x1="32" y1="32" x2="${32 + Math.sin(a) * 15}" y2="${32 - Math.cos(a) * 15}" stroke="${rimColor}" stroke-width="3.2" stroke-linecap="round"/>`;
  }).join('');
  const tread = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    return `<line x1="${32 + Math.sin(a) * 26}" y1="${32 - Math.cos(a) * 26}" x2="${32 + Math.sin(a) * 30}" y2="${32 - Math.cos(a) * 30}" stroke="#2b2f36" stroke-width="2"/>`;
  }).join('');
  return raw(`<svg viewBox="0 0 64 64" width="${size}" height="${size}" class="tyre-svg ${worn ? 'worn' : ''}">
    ${tyre ? `<circle cx="32" cy="32" r="30" fill="#0d0f12"/>${worn ? '' : tread}<circle cx="32" cy="32" r="30" fill="none" stroke="#3a3f47" stroke-width="1"/>` : ''}
    ${rim ? `<circle cx="32" cy="32" r="${tyre ? 19.5 : 21}" fill="#1e293b" stroke="${rimColor}" stroke-width="2.5"/>${spokes}<circle cx="32" cy="32" r="4" fill="${rimColor}"/>`
      : `<circle cx="32" cy="32" r="18" fill="#0a0d12" stroke="#1f242b" stroke-width="2"/>`}
  </svg>`);
}

/** Reifenstapel (Draufsicht seitlich) für die Bestandsübersicht. */
function stackSvg(count, { worn = false } = {}) {
  const n = Math.min(count, 8);
  let g = '';
  for (let i = 0; i < n; i += 1) {
    const y = 108 - i * 12;
    g += `<g><rect x="6" y="${y - 10}" width="68" height="12" rx="5" fill="${worn ? '#1c1414' : '#111317'}" stroke="#2c3038"/>
      <ellipse cx="40" cy="${y - 10}" rx="34" ry="6" fill="${worn ? '#2a1a1a' : '#16191e'}" stroke="#2c3038"/>
      <ellipse cx="40" cy="${y - 10}" rx="17" ry="3" fill="#07080a"/></g>`;
  }
  return raw(`<svg viewBox="0 0 80 120" width="64" height="96">${g}${count > 8 ? `<text x="40" y="12" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="Chakra Petch">+${count - 8}</text>` : ''}</svg>`);
}

/** Rauch-Animation für "Burned". */
function burnFx(count) {
  const node = el(html`<div class="burn-fx"><div class="burn-smoke">${Array.from({ length: 9 }, (_, i) => html`<span style="--i:${i}"></span>`)}</div>
    <div class="burn-text">-${count} BURNED</div></div>`);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1700);
}

/* ---------------- Burner (auch vom Cockpit/Selektionsleiste nutzbar) ---------------- */
export async function burnTyres(vehicleId = null, { onDone = null } = {}) {
  try {
    const res = await post('/tyres/burn', { vehicle_id: vehicleId, count: 2 });
    haptic([30, 30, 60]);
    burnFx(res.burned.length);
    const rims = Object.fromEntries(res.burned.map((b) => [b.id, b.rim_id]));
    toast(`${res.burned.length} Reifen abgefahren (${res.burned[0].dimension}). Noch ${res.remaining} Driftreifen aktiv.${res.partial ? ' Bestand reicht nicht für 2!' : ''}`,
      res.remaining < 4 ? 'warn' : 'ok', 6500,
      { label: 'Rückgängig', onClick: async () => { await post('/tyres/unburn', { ids: res.burned.map((b) => b.id), rims }); toast('Zurückgenommen.'); onDone && onDone(); } });
    onDone && onDone(res.hub);
    return res;
  } catch (err) { toastError(err); return null; }
}
app.burnTyres = burnTyres;

/* ====================================================================== */
export async function openTyreHub({ vehicleId = null } = {}) {
  let data;
  try { data = await get('/tyrehub'); } catch (err) { toastError(err); return; }
  let tab = 'tyres';
  let filter = 'all';
  let burnVehicle = vehicleId || '';

  const body = el(html`<div class="-mx-5 -my-4"><div data-head class="px-5 pt-4 pb-4"></div>
    <nav class="tabs px-3 border-b border-white/10 sticky top-0 z-10 bg-[#121821]" data-tabs></nav>
    <div class="px-5 py-4" data-content></div></div>`);
  const m = openModal({ title: 'Reifenlager', subtitle: 'Drift-Tyre Hub · Reifen, Felgen, Kompletträder', size: 'xl', iconName: 'tyre', body });
  const head = body.querySelector('[data-head]');
  const tabsEl = body.querySelector('[data-tabs]');
  const content = body.querySelector('[data-content]');

  const reload = async (hub) => { data = hub || await get('/tyrehub'); render(); };

  function renderHead() {
    const s = data.stats;
    const kpi = (label, val, cls, sub = '') => html`<div class="rounded-lg bg-black/30 border border-white/10 px-3 py-2">
      <div class="text-[10px] uppercase tracking-widest text-slate-500 font-display">${label}</div>
      <div class="font-display text-2xl font-bold ${cls}">${val}</div>${sub ? html`<div class="text-[10px] text-slate-500">${sub}</div>` : ''}</div>`;
    setHTML(head, html`
      <div class="flex flex-col lg:flex-row gap-4">
        <div class="flex items-end gap-3 overflow-x-auto pb-1 shrink-0">
          ${s.byDimension.map((d) => html`<div class="text-center">${stackSvg(d.loose + d.mounted)}<div class="text-[10px] font-mono text-slate-400 mt-1">${d.dimension}</div>
            <div class="text-[10px] text-slate-500">${d.loose} lose · ${d.mounted} mont.</div></div>`)}
          ${!s.byDimension.length ? html`<div class="text-sm text-rose-300">Kein Driftreifen mehr da!</div>` : ''}
        </div>
        <div class="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
          ${kpi('Drift lose', s.driftLoose, s.driftLoose < 4 ? 'text-rose-400' : 'text-orange-300', 'aktiver Bestand')}
          ${kpi('Drift montiert', s.driftMounted, 'text-orange-200', 'auf Felge')}
          ${kpi('Straße', s.street, 'text-sky-300', 'gute Reifen')}
          ${kpi('Abgefahren', s.burned, 'text-slate-400', 'zur Entsorgung')}
        </div>
      </div>
      ${canEdit() ? html`
        <div class="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/10 to-transparent p-3">
          <button class="btn burn-btn" data-burn>${icon('flame')} -2 BURNED</button>
          <select class="select !w-auto !py-1.5 text-sm" data-burnveh>
            <option value="">Allgemeiner Drift-Bestand</option>
            ${store.vehicles.map((v) => html`<option value="${v.id}" ${String(burnVehicle) === String(v.id) ? 'selected' : ''}>${v.name}</option>`)}
          </select>
          <span class="text-xs text-slate-400">Zieht 2 Driftreifen ab (zuerst die montierten des Autos) und schiebt sie zu „Abgefahren“.</span>
        </div>` : ''}`);
  }

  function renderTabs() {
    const tabs = [['tyres', `Reifen (${data.tyres.filter((t) => t.status === 'aktiv' && !t.rim_id).length} lose)`], ['wheels', `Felgen & Kompletträder (${data.rims.length})`], ['burned', `Abgefahren (${data.stats.burned})`]];
    setHTML(tabsEl, html`${tabs.map(([k, l]) => html`<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`)}`);
  }

  function tabTyres() {
    const loose = data.tyres.filter((t) => t.status === 'aktiv' && !t.rim_id && (filter === 'all' || t.class === filter));
    // Gleiche Reifen gruppieren
    const groups = new Map();
    for (const t of loose) {
      const k = [t.dimension, t.brand, t.model, t.condition, t.class, t.vehicle_id].join('|');
      if (!groups.has(k)) groups.set(k, { ...t, ids: [] });
      groups.get(k).ids.push(t.id);
    }
    setHTML(content, html`
      <div class="flex flex-wrap items-center gap-2 mb-3">
        ${[['all', 'Alle'], ['drift', 'Drift'], ['strasse', 'Straße']].map(([k, l]) => html`<button class="chip chip-btn ${filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`)}
        ${canEdit() ? html`<button class="btn btn-sm btn-primary ml-auto" data-new="tyre">${icon('plus')} Reifen</button>` : ''}
      </div>
      <div class="grid sm:grid-cols-2 gap-2">
        ${[...groups.values()].map((g) => html`
          <div class="card p-3 flex items-center gap-3">
            <div class="relative shrink-0">${wheelSvg({ rim: false, worn: g.condition === 'burner' })}<span class="absolute -top-1 -right-1 chip !bg-black !text-white !px-1.5 font-mono">${g.ids.length}×</span></div>
            <div class="flex-1 min-w-0">
              <div class="font-mono text-sm font-bold text-white">${g.dimension}</div>
              <div class="text-xs text-slate-400 truncate">${g.brand || ''} ${g.model || ''}${g.dot ? ` · DOT ${g.dot}` : ''}</div>
              <div class="flex flex-wrap gap-1 mt-1">
                <span class="chip !text-[10px] ${CLASS[g.class].cls}">${CLASS[g.class].label}</span>
                <span class="chip !text-[10px] ${COND[g.condition].cls}">${COND[g.condition].label}</span>
                ${g.vehicle_name ? html`<span class="chip !text-[10px]">${g.vehicle_name}</span>` : ''}
              </div>
            </div>
            ${canEdit() ? html`<div class="flex flex-col gap-1">
              <button class="btn btn-sm" data-mount="${g.ids[0]}" title="Reifen auf Felge montieren">${icon('tyre', 'w-3.5 h-3.5')} Montieren</button>
              <div class="flex gap-1">
                <button class="btn-icon !w-7 !h-7" data-edit-tyre="${g.ids[0]}" title="Bearbeiten">${icon('edit', 'w-3.5 h-3.5')}</button>
                <button class="btn-icon !w-7 !h-7 hover:!text-rose-300" data-del-tyre="${g.ids[0]}" title="Einen löschen">${icon('trash', 'w-3.5 h-3.5')}</button>
              </div></div>` : ''}
          </div>`)}
      </div>
      ${!groups.size ? html`<p class="text-sm text-slate-500">Keine losen Reifen.</p>` : ''}`);
  }

  function tabWheels() {
    setHTML(content, html`
      <div class="flex items-center gap-2 mb-3"><span class="text-sm text-slate-400">${data.stats.wheels} Kompletträder · ${data.stats.freeRims} freie Felgen</span>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary ml-auto" data-new="rim">${icon('plus')} Felge</button>` : ''}</div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${data.rims.map((r) => html`
          <div class="card p-3 ${r.tyre_id ? '!border-orange-400/30' : ''}">
            <div class="flex items-center gap-3">
              ${wheelSvg({ tyre: !!r.tyre_id, rimColor: /schwarz/i.test(r.color || '') ? '#475569' : /gold|bronze/i.test(r.color || '') ? '#d4a017' : '#cbd5e1' })}
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-white text-sm truncate">${r.model}</div>
                <div class="text-xs font-mono text-slate-400">${r.size || ''}${r.pcd ? ` · LK ${r.pcd}` : ''}</div>
                <div class="text-[11px] text-slate-500">${r.color || ''}${r.condition ? ` · ${r.condition}` : ''}</div>
              </div>
            </div>
            <div class="mt-2 text-xs ${r.tyre_id ? 'text-orange-200' : 'text-slate-500'}">${r.tyre_id ? html`${icon('tyre', 'w-3 h-3 inline')} Komplettrad: <b>${r.tyre_dimension}</b> ${r.tyre_brand || ''} ${r.tyre_model || ''}` : 'Felge ohne Reifen'}</div>
            ${canEdit() ? html`<div class="flex flex-wrap gap-1.5 mt-2">
              <select class="select !w-auto !py-1 text-xs flex-1" data-rim-veh="${r.id}"><option value="">kein Auto</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${r.vehicle_id === v.id ? 'selected' : ''}>${v.name}</option>`)}</select>
              ${r.tyre_id ? html`<button class="btn btn-sm" data-unmount="${r.tyre_id}">Reifen abziehen</button>` : html`<button class="btn btn-sm" data-mountrim="${r.id}">Reifen montieren</button>`}
              <button class="btn-icon !w-7 !h-7" data-edit-rim="${r.id}">${icon('edit', 'w-3.5 h-3.5')}</button>
            </div>` : (r.vehicle_name ? html`<div class="text-[11px] text-slate-400 mt-1">${r.vehicle_name}</div>` : '')}
          </div>`)}
      </div>`);
  }

  function tabBurned() {
    const burned = data.tyres.filter((t) => t.status === 'abgefahren');
    setHTML(content, html`
      <div class="flex items-center gap-2 mb-3"><span class="text-sm text-slate-400">${burned.length} Altreifen zur Entsorgung</span>
        ${canEdit() && burned.length ? html`<button class="btn btn-sm btn-danger ml-auto" data-dispose="all">${icon('trash')} Alle entsorgen (${burned.length})</button>` : ''}</div>
      <div class="space-y-1.5">
        ${burned.map((t) => html`<div class="card px-3 py-2 flex items-center gap-3 text-sm" data-burned-row="${t.id}">
          ${wheelSvg({ rim: false, worn: true, size: 34 })}
          <div class="flex-1 min-w-0"><span class="font-mono text-white">${t.dimension}</span> <span class="text-slate-400">${t.brand || ''} ${t.model || ''}</span>
            <div class="text-[11px] text-slate-500">abgefahren ${t.burned_at ? fmtDate(t.burned_at) : ''}${t.vehicle_name ? ` · ${t.vehicle_name}` : ''}</div></div>
          ${canEdit() ? html`
            <button class="btn btn-sm" data-unburn="${t.id}" title="Zurück in den aktiven Bestand">${icon('undo', 'w-3.5 h-3.5')} <span class="hidden sm:inline">Doch noch gut</span></button>
            <button class="btn btn-sm btn-danger" data-dispose-one="${t.id}" title="Diesen Altreifen austragen">${icon('x', 'w-3.5 h-3.5')} Entsorgen</button>` : ''}
        </div>`)}
        ${!burned.length ? html`<p class="text-sm text-slate-500">Keine Altreifen. Sauber!</p>` : ''}
      </div>`);
  }

  function render() {
    knownDims = [...new Set([...data.tyres.map((t) => t.dimension), ...knownDims])];
    renderHead();
    renderTabs();
    ({ tyres: tabTyres, wheels: tabWheels, burned: tabBurned })[tab]();
  }

  /* ---------- Aktionen ---------- */
  on(tabsEl, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; render(); });
  on(head, 'change', '[data-burnveh]', (_e, s) => { burnVehicle = s.value; });
  on(head, 'click', '[data-burn]', async () => {
    await burnTyres(burnVehicle ? Number(burnVehicle) : null, { onDone: (hub) => reload(hub) });
  });

  on(content, 'click', 'button, [data-filter]', async (_e, b) => {
    const d = b.dataset;
    try {
      if (d.filter) { filter = d.filter; render(); }
      if (d.new === 'tyre') tyreForm({}, reload);
      if (d.new === 'rim') rimForm({}, reload);
      if (d.editTyre) tyreForm(data.tyres.find((t) => t.id === Number(d.editTyre)), reload);
      if (d.editRim) rimForm(data.rims.find((r) => r.id === Number(d.editRim)), reload);
      if (d.delTyre) { if (await confirmDialog('Diesen Reifen löschen?', { danger: true, okLabel: 'Löschen' })) reload(await del(`/tyres/${d.delTyre}`)); }
      if (d.mount) mountDialog({ tyreId: Number(d.mount) }, data, reload);
      if (d.mountrim) mountDialog({ rimId: Number(d.mountrim) }, data, reload);
      if (d.unmount) {
        const pick = await chooseDialog({ title: 'Reifen abziehen', text: 'Wohin mit dem Reifen?', choices: ['Zurück ins Lager', 'Altreifen (abgefahren)'], allowText: false });
        if (!pick) return;
        reload(await post(`/tyres/${d.unmount}/unmount`, { to: pick.startsWith('Alt') ? 'abgefahren' : 'lager' }));
        haptic(10);
        toast('Reifen abgezogen. Felge ist wieder frei.', 'ok');
      }
      if (d.unburn) reload(await post('/tyres/unburn', { ids: [Number(d.unburn)] }));
      // Bugfix v3: Buttons haben jetzt Werte (data-dispose="all"), vorher war das Attribut leer und damit "falsy"
      if (d.disposeOne) {
        const r = await post('/tyres/dispose', { ids: [Number(d.disposeOne)] });
        haptic(10);
        toast('Altreifen ausgetragen.', 'ok');
        reload(r.hub);
      }
      if (d.dispose === 'all') {
        const count = data.tyres.filter((t) => t.status === 'abgefahren').length;
        if (!count) return;
        if (!(await confirmDialog(`Möchtest du wirklich alle ${count} Altreifen austragen?`, { title: 'Altreifen entsorgen', danger: true, okLabel: `Alle ${count} austragen` }))) return;
        const r = await post('/tyres/dispose', { all: true });
        toast(`${r.disposed} Altreifen entsorgt.`, 'ok');
        reload(r.hub);
      }
    } catch (err) { toastError(err); }
  });
  on(content, 'change', '[data-rim-veh]', async (_e, s) => {
    try { reload(await put(`/rims/${s.dataset.rimVeh}`, { vehicle_id: s.value || null })); } catch (err) { toastError(err); }
  });

  render();
  refreshVehicles().catch(() => {});
  return m;
}

/* ---------------- Formulare ---------------- */
function tyreForm(t, onSaved) {
  const isNew = !t.id;
  const body = el(html`<div><form class="grid sm:grid-cols-2 gap-3" data-form>
    <label><span class="label">Dimension</span><input class="input font-mono" name="dimension" value="${t.dimension || ''}" placeholder="225/45 R17" required list="dimList">
      <datalist id="dimList">${knownDims.map((dd) => html`<option>${dd}</option>`)}</datalist></label>
    <label><span class="label">DOT</span><input class="input font-mono" name="dot" value="${t.dot || ''}" placeholder="z. B. 2223"></label>
    <label><span class="label">Marke</span><input class="input" name="brand" value="${t.brand || ''}"></label>
    <label><span class="label">Modell</span><input class="input" name="model" value="${t.model || ''}"></label>
    <label><span class="label">Zustand</span><select class="select" name="condition">${Object.entries(COND).map(([k, c]) => html`<option value="${k}" ${t.condition === k ? 'selected' : ''}>${c.label}</option>`)}</select></label>
    <label><span class="label">Einstufung</span><select class="select" name="class">${Object.entries(CLASS).map(([k, c]) => html`<option value="${k}" ${t.class === k ? 'selected' : ''}>${c.label}</option>`)}</select></label>
    <label><span class="label">Auto (optional)</span><select class="select" name="vehicle_id"><option value="">allgemeiner Bestand</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${t.vehicle_id === v.id ? 'selected' : ''}>${v.name}</option>`)}</select></label>
    ${isNew ? html`<label><span class="label">Anzahl</span><input class="input" type="number" min="1" max="40" name="qty" value="4"></label>` : ''}
    <label class="sm:col-span-2"><span class="label">Notizen</span><input class="input" name="notes" value="${t.notes || ''}"></label>
  </form></div>`);
  const m = openModal({ title: isNew ? 'Reifen einlagern' : `Reifen ${t.dimension}`, size: 'md', iconName: 'tyre', body,
    footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Speichern</button>` });
  m.footer.querySelector('[data-save]').addEventListener('click', async () => {
    const f = body.querySelector('form');
    if (!f.reportValidity()) return;
    try { const hub = isNew ? await post('/tyres', formData(f)) : await put(`/tyres/${t.id}`, formData(f)); m.close(); toast('Gespeichert.', 'ok'); onSaved(hub); } catch (err) { toastError(err); }
  });
}

function rimForm(r, onSaved) {
  const isNew = !r.id;
  const body = el(html`<div><form class="grid sm:grid-cols-2 gap-3" data-form>
    <label class="sm:col-span-2"><span class="label">Typ / Modell</span><input class="input" name="model" value="${r.model || ''}" required placeholder="z. B. BBS RC090, Style 68"></label>
    <label><span class="label">Maße</span><input class="input font-mono" name="size" value="${r.size || ''}" placeholder="8x17 ET20"></label>
    <label><span class="label">Lochkreis</span><input class="input font-mono" name="pcd" value="${r.pcd || ''}" placeholder="5x120"></label>
    <label><span class="label">Farbe</span><input class="input" name="color" value="${r.color || ''}" placeholder="Silber, Schwarz, Gold"></label>
    <label><span class="label">Zustand</span><input class="input" name="condition" value="${r.condition || 'gut'}"></label>
    <label><span class="label">Auto (optional)</span><select class="select" name="vehicle_id"><option value="">keins</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${r.vehicle_id === v.id ? 'selected' : ''}>${v.name}</option>`)}</select></label>
    ${isNew ? html`<label><span class="label">Anzahl</span><input class="input" type="number" min="1" max="20" name="qty" value="4"></label>` : ''}
  </form></div>`);
  const m = openModal({ title: isNew ? 'Felgen anlegen' : r.model, size: 'md', iconName: 'tyre', body,
    footer: html`${!isNew ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash')}</button>` : ''}<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Speichern</button>` });
  m.footer.querySelector('[data-save]').addEventListener('click', async () => {
    const f = body.querySelector('form');
    if (!f.reportValidity()) return;
    try { const hub = isNew ? await post('/rims', formData(f)) : await put(`/rims/${r.id}`, formData(f)); m.close(); toast('Gespeichert.', 'ok'); onSaved(hub); } catch (err) { toastError(err); }
  });
  const d = m.footer.querySelector('[data-del]');
  if (d) d.addEventListener('click', async () => {
    if (!(await confirmDialog('Felge löschen? Ein montierter Reifen wird lose.', { danger: true, okLabel: 'Löschen' }))) return;
    try { onSaved(await del(`/rims/${r.id}`)); m.close(); } catch (err) { toastError(err); }
  });
}

/** Montage-Dialog: freien Reifen + freie Felge wählen. */
function mountDialog({ tyreId = null, rimId = null }, data, onSaved) {
  const inch = (s, re) => { const mm = re.exec(s || ''); return mm ? Number(mm[1]) : null; };
  const freeTyres = data.tyres.filter((t) => t.status === 'aktiv' && !t.rim_id);
  const freeRims = data.rims.filter((r) => !r.tyre_id);
  let selR = rimId || null;
  // Von einer Felge aus geöffnet: passenden Reifen (gleiche Zollgröße) vorschlagen
  const rimInchSel = rimId ? inch((freeRims.find((r) => r.id === rimId) || {}).size, /x\s?(\d{2})/i) : null;
  const matching = rimInchSel ? freeTyres.find((t) => inch(t.dimension, /R\s?(\d{2})/i) === rimInchSel) : null;
  let selT = tyreId || (matching && matching.id) || (freeTyres[0] && freeTyres[0].id);
  const body = el(html`<div class="grid md:grid-cols-2 gap-4"><div data-tyres></div><div data-rims></div><div class="md:col-span-2" data-preview></div></div>`);
  const m = openModal({ title: 'Reifen auf Felge montieren', subtitle: 'Wird zum Komplettrad', size: 'lg', iconName: 'tyre', body,
    footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-ok>${icon('tyre')} Montieren</button>` });
  const render = () => {
    const t = freeTyres.find((x) => x.id === selT);
    const ti = t ? inch(t.dimension, /R\s?(\d{2})/i) : null;
    const rimsSorted = [...freeRims].sort((a, b) => (inch(b.size, /x\s?(\d{2})/i) === ti) - (inch(a.size, /x\s?(\d{2})/i) === ti));
    if (!selR && rimsSorted[0]) selR = rimsSorted[0].id;
    setHTML(body.querySelector('[data-tyres]'), html`<div class="label">Reifen</div><div class="space-y-1 max-h-64 overflow-y-auto pr-1">
      ${freeTyres.map((x) => html`<button class="card w-full text-left px-3 py-2 text-sm flex gap-2 items-center ${x.id === selT ? '!border-cyan-400 !bg-cyan-400/10' : ''}" data-t="${x.id}">
        <span class="font-mono text-white">${x.dimension}</span><span class="text-slate-400 truncate">${x.brand || ''} ${x.model || ''}</span><span class="ml-auto chip !text-[10px]">${x.class === 'drift' ? 'Drift' : 'Straße'}</span></button>`)}
      ${!freeTyres.length ? html`<p class="text-sm text-slate-500">Keine losen Reifen.</p>` : ''}</div>`);
    setHTML(body.querySelector('[data-rims]'), html`<div class="label">Felge</div><div class="space-y-1 max-h-64 overflow-y-auto pr-1">
      ${rimsSorted.map((r) => { const ok = ti && inch(r.size, /x\s?(\d{2})/i) === ti; return html`<button class="card w-full text-left px-3 py-2 text-sm flex gap-2 items-center ${r.id === selR ? '!border-cyan-400 !bg-cyan-400/10' : ''}" data-r="${r.id}">
        <span class="text-white truncate">${r.model}</span><span class="font-mono text-slate-400">${r.size || ''}</span>${ok ? html`<span class="ml-auto text-lime-300">${icon('check', 'w-3.5 h-3.5')}</span>` : ''}</button>`; })}
      ${!freeRims.length ? html`<p class="text-sm text-slate-500">Keine freie Felge. Erst eine Felge anlegen oder einen Reifen abziehen.</p>` : ''}</div>`);
    const r = freeRims.find((x) => x.id === selR);
    setHTML(body.querySelector('[data-preview]'), t && r ? html`<div class="flex items-center justify-center gap-4 rounded-xl bg-black/30 border border-white/10 py-3">
      ${wheelSvg({ rim: false, size: 52 })}<span class="text-2xl text-slate-500">+</span>${wheelSvg({ tyre: false, size: 52 })}<span class="text-2xl text-slate-500">=</span>${wheelSvg({ size: 64 })}
      <div class="text-sm"><b class="text-white font-mono">${t.dimension}</b><br><span class="text-slate-400">auf ${r.model} ${r.size || ''}</span></div></div>` : '');
  };
  on(body, 'click', '[data-t]', (_e, b) => { selT = Number(b.dataset.t); selR = null; render(); });
  on(body, 'click', '[data-r]', (_e, b) => { selR = Number(b.dataset.r); render(); });
  m.footer.querySelector('[data-ok]').addEventListener('click', async () => {
    if (!selT || !selR) { toast('Bitte Reifen und Felge wählen.', 'warn'); return; }
    try {
      onSaved(await post(`/tyres/${selT}/mount`, { rim_id: selR }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        if (!(await confirmDialog(`${err.message} Trotzdem montieren?`, { okLabel: 'Trotzdem' }))) return;
        try { onSaved(await post(`/tyres/${selT}/mount`, { rim_id: selR, force: true })); } catch (e2) { toastError(e2); return; }
      } else { toastError(err); return; }
    }
    haptic([10, 30, 10]);
    m.close();
    toast('Montiert! Komplettrad steht im Lager.', 'ok');
  });
  render();
}
