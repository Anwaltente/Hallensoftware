/**
 * v5.2: Fahrzeug-Spickzettel "Quick Specs"
 * ------------------------------------------------------------
 * Die wichtigsten Werte auf einen Blick, groß und touch-freundlich (Handy in der Halle):
 * Radschrauben-Drehmoment, Füllmengen + Viskositäten, Zündkerzen, Reifendrücke kalt/warm, eigene Zusatzwerte.
 * Gespeichert als JSON in vehicles.quick_specs (PUT /api/vehicles/:id/quick-specs).
 * Reifendrücke ohne eigenen Eintrag werden aus dem aktuell gefahrenen Setup angezeigt.
 */
import { canEdit } from './state.js';
import { get, put } from './api.js';
import { html, setHTML, on, icon, toast, toastError } from './ui.js';

const nf = (v, d = 1) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: d }));
const val = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

export async function renderQuickSpecs(root, { vehicle, onSaved }) {
  let edit = false;
  let qs = { ...(vehicle.quick_specs || {}) };
  let setup = null;
  try {
    const setups = await get(`/vehicles/${vehicle.id}/setups`);
    setup = setups.find((s) => s.is_current) || setups[0] || null;
  } catch { /* ohne Setup weiter */ }

  const pSetup = (kind, axle) => {
    const p = setup && setup.data && setup.data.pressure && setup.data.pressure[kind];
    if (!p) return null;
    const a = axle === 'front' ? [p.fl, p.fr] : [p.rl, p.rr];
    const n = a.map(Number).filter((x) => Number.isFinite(x) && x > 0);
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : null;
  };
  const press = (kind, axle) => {
    const own = qs[`p_${kind}_${axle}`];
    if (own !== undefined && own !== null) return { v: own, src: '' };
    const s = pSetup(kind, axle);
    return s !== null ? { v: s, src: 'setup' } : null;
  };

  const tile = (k, v, unit, sub, color, extra = '') => html`
    <div class="qs-tile ${v === '' || v === null || v === undefined ? 'empty' : ''} ${extra}" style="--qc:${color}">
      <div class="k">${k}</div>
      <div class="v">${v === '' || v === null || v === undefined ? 'k. A.' : html`${v}${unit ? html`<small>${unit}</small>` : ''}`}</div>
      ${sub ? html`<div class="s">${sub}</div>` : ''}
    </div>`;

  function view() {
    const pr = { cf: press('cold', 'front'), cr: press('cold', 'rear'), wf: press('warm', 'front'), wr: press('warm', 'rear') };
    const anyPress = Object.values(pr).some(Boolean);
    const fromSetup = Object.values(pr).some((p) => p && p.src === 'setup');
    const pv = (p) => (p ? nf(p.v, 2) : 'k. A.');
    const has = Object.keys(qs).length > 0;
    return html`
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <div class="flex-1 min-w-[180px]"><div class="font-display font-bold text-white text-lg">Spickzettel ${vehicle.name}</div>
          <div class="text-xs text-slate-400">Drehmomente, Füllmengen, Zündkerzen, Reifendrücke auf einen Blick</div></div>
        ${canEdit() ? html`<button class="btn btn-sm ${has ? '' : 'btn-primary'}" data-qs-edit>${icon('edit', 'w-3.5 h-3.5')} ${has ? 'Bearbeiten' : 'Werte eintragen'}</button>` : ''}
      </div>
      <div class="qs-grid">
        ${tile('Radschrauben', qs.wheel_torque !== undefined ? nf(qs.wheel_torque, 0) : '', 'Nm', qs.wheel_bolt || 'Anzugsmoment', '#facc15')}
        ${tile('Motoröl', qs.engine_oil_l !== undefined ? nf(qs.engine_oil_l, 2) : '', 'L', qs.engine_oil_type || 'Menge mit Filter', '#f59e0b')}
        ${tile('Getriebeöl', qs.gearbox_oil_l !== undefined ? nf(qs.gearbox_oil_l, 2) : '', 'L', qs.gearbox_oil_type || '', '#a3e635')}
        ${tile('Diff-Öl', qs.diff_oil_l !== undefined ? nf(qs.diff_oil_l, 2) : '', 'L', qs.diff_oil_type || '', '#84cc16')}
        ${tile('Kühlmittel', qs.coolant_l !== undefined ? nf(qs.coolant_l, 2) : '', 'L', qs.coolant_type || '', '#22d3ee')}
        ${tile('Zündkerzen', qs.spark_type || '', '', qs.spark_gap !== undefined ? `Elektrodenabstand ${nf(qs.spark_gap, 2)} mm` : 'Typ und Elektrodenabstand', '#f472b6', 'wide')}
        <div class="qs-tile wide ${anyPress ? '' : 'empty'}" style="--qc:#38bdf8">
          <div class="k">Reifendruck${fromSetup ? html` <span class="normal-case tracking-normal text-[10px] text-sky-300">· teils aus Setup „${setup.title}“</span>` : ''}</div>
          ${anyPress ? html`<div class="qs-press">
            <span></span><span>vorne</span><span>hinten</span>
            <span>kalt</span><b>${pv(pr.cf)}</b><b>${pv(pr.cr)}</b>
            <span>warm</span><b>${pv(pr.wf)}</b><b>${pv(pr.wr)}</b>
          </div><div class="s">bar</div>` : html`<div class="v">k. A.</div>`}
        </div>
        ${(qs.extra || []).map((x) => tile(x.label, x.value, '', '', '#a78bfa'))}
        ${qs.notes ? html`<div class="qs-tile wide" style="--qc:#94a3b8"><div class="k">Notizen</div><div class="text-sm text-slate-200 mt-1 whitespace-pre-line">${qs.notes}</div></div>` : ''}
      </div>`;
  }

  function form() {
    const f = (name, label, { unit = '', type = 'number', step = '0.1', ph = '', w = '' } = {}) => html`
      <label class="${w}"><span class="label">${label}</span>
        <div class="relative"><input class="input ${unit ? '!pr-10' : ''}" name="${name}" ${type === 'number' ? html`type="text" inputmode="decimal" data-num="${step}"` : ''} value="${type === 'number' ? val(qs[name]) : (qs[name] || '')}" placeholder="${ph}">
        ${unit ? html`<span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">${unit}</span>` : ''}</div></label>`;
    const extra = qs.extra && qs.extra.length ? qs.extra : [{ label: '', value: '' }];
    return html`
      <form class="space-y-4" data-qs-form>
        <section class="card p-3"><div class="label !mb-2">Räder</div><div class="grid grid-cols-2 gap-2">
          ${f('wheel_torque', 'Radschrauben-Drehmoment', { unit: 'Nm', step: '1', ph: '120' })}
          ${f('wheel_bolt', 'Schrauben / Schlüssel', { type: 'text', ph: 'M12×1,5 · 17er' })}</div></section>
        <section class="card p-3"><div class="label !mb-2">Füllmengen & Viskositäten</div><div class="grid grid-cols-2 gap-2">
          ${f('engine_oil_l', 'Motoröl', { unit: 'L', ph: '6,5' })}${f('engine_oil_type', 'Typ', { type: 'text', ph: '10W-60' })}
          ${f('gearbox_oil_l', 'Getriebeöl', { unit: 'L', ph: '1,0' })}${f('gearbox_oil_type', 'Typ', { type: 'text', ph: '75W-90' })}
          ${f('diff_oil_l', 'Diff-Öl', { unit: 'L', ph: '1,1' })}${f('diff_oil_type', 'Typ', { type: 'text', ph: '75W-140' })}
          ${f('coolant_l', 'Kühlmittel', { unit: 'L', ph: '8,4' })}${f('coolant_type', 'Typ', { type: 'text', ph: 'G48, 50 %' })}</div></section>
        <section class="card p-3"><div class="label !mb-2">Zündung</div><div class="grid grid-cols-2 gap-2">
          ${f('spark_type', 'Zündkerzentyp', { type: 'text', ph: 'NGK BKR6EQUP' })}
          ${f('spark_gap', 'Elektrodenabstand', { unit: 'mm', step: '0.01', ph: '0,8' })}</div></section>
        <section class="card p-3"><div class="label !mb-2">Reifendruck (leer = aus dem aktuellen Setup)</div><div class="grid grid-cols-2 gap-2">
          ${f('p_cold_front', 'Kalt vorne', { unit: 'bar', step: '0.05', ph: val(pSetup('cold', 'front')) })}${f('p_cold_rear', 'Kalt hinten', { unit: 'bar', step: '0.05', ph: val(pSetup('cold', 'rear')) })}
          ${f('p_warm_front', 'Warm vorne', { unit: 'bar', step: '0.05', ph: val(pSetup('warm', 'front')) })}${f('p_warm_rear', 'Warm hinten', { unit: 'bar', step: '0.05', ph: val(pSetup('warm', 'rear')) })}</div></section>
        <section class="card p-3"><div class="label !mb-2">Eigene Werte</div>
          <div class="space-y-2" data-qs-extra>${extra.map((x) => html`<div class="grid grid-cols-[1fr_1fr_auto] gap-2" data-xrow>
            <input class="input" data-xk="label" value="${x.label || ''}" placeholder="z. B. Bremsflüssigkeit"><input class="input" data-xk="value" value="${x.value || ''}" placeholder="DOT 4, 0,5 L">
            <button type="button" class="btn-icon" data-xdel>${icon('trash', 'w-4 h-4')}</button></div>`)}</div>
          <button type="button" class="btn btn-sm mt-2" data-xadd>${icon('plus', 'w-3.5 h-3.5')} Wert hinzufügen</button></section>
        <label class="block"><span class="label">Notizen</span><textarea class="input" name="notes" rows="2" placeholder="z. B. Ölfilter MANN HU 816 x">${qs.notes || ''}</textarea></label>
        <div class="flex gap-2 sticky bottom-0 py-2 bg-[#121821]">
          <button type="button" class="btn" data-qs-cancel>Abbrechen</button>
          <button class="btn btn-primary flex-1">${icon('check')} Speichern</button>
        </div>
      </form>`;
  }

  const render = () => setHTML(root, edit ? form() : view());
  render();
  // Der Cockpit-Inhalt wird für alle Reiter wiederverwendet: Listener nur einmal, Zustand immer vom letzten Aufruf
  root._qs = {
    setEdit: (on2) => { edit = on2; render(); },
    save: async (body) => {
      const res = await put(`/vehicles/${vehicle.id}/quick-specs`, body);
      qs = res.quick_specs || {};
      vehicle.quick_specs = qs;
      edit = false;
      render();
      if (onSaved) onSaved();
    }
  };

  if (root.dataset.qsBound) return;
  root.dataset.qsBound = '1';
  on(root, 'click', '[data-qs-edit]', () => root._qs.setEdit(true));
  on(root, 'click', '[data-qs-cancel]', () => root._qs.setEdit(false));
  on(root, 'click', '[data-xadd]', () => {
    const box = root.querySelector('[data-qs-extra]');
    const row = box.querySelector('[data-xrow]').cloneNode(true);
    row.querySelectorAll('input').forEach((i) => { i.value = ''; });
    box.appendChild(row);
  });
  on(root, 'click', '[data-xdel]', (_e, b) => {
    const rows = root.querySelectorAll('[data-xrow]');
    if (rows.length > 1) b.closest('[data-xrow]').remove();
    else b.closest('[data-xrow]').querySelectorAll('input').forEach((i) => { i.value = ''; });
  });
  root.addEventListener('submit', async (e) => {
    const fEl = e.target.closest('[data-qs-form]');
    if (!fEl) return;
    e.preventDefault();
    const body = {};
    fEl.querySelectorAll('[name]').forEach((i) => { body[i.name] = i.value.trim(); });
    for (const i of fEl.querySelectorAll('[data-num]')) {
      if (i.value.trim() && !Number.isFinite(Number(i.value.trim().replace(',', '.')))) { toast(`Bitte eine Zahl eintragen: ${i.closest('label').querySelector('.label').textContent}`, 'warn'); i.focus(); return; }
    }
    body.extra = [...fEl.querySelectorAll('[data-xrow]')].map((r) => ({ label: r.querySelector('[data-xk="label"]').value, value: r.querySelector('[data-xk="value"]').value }));
    try {
      await root._qs.save(body);
      toast('Spickzettel gespeichert.', 'ok');
    } catch (err) { toastError(err); }
  });
}
