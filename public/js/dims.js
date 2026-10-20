/**
 * v4.1: Radmaße eines Autos (für den Anhänger-Check) + KI-Auto-Fill via Gemini
 * ------------------------------------------------------------
 * Felder: Radstand, Spurweite vorn/hinten, Reifenbreite vorn/hinten (alle in mm), Gewicht.
 * Radaußenbreite = MAX(Spur vorn + Reifen vorn, Spur hinten + Reifen hinten) wird live angezeigt.
 * Button "✨ Serienmaße via KI laden" fragt POST /api/cars/fetch-dimensions und füllt die Felder,
 * danach kann man sie für Drift-Umbauten (Wisefab, Spurplatten, breitere Reifen) sofort anpassen.
 */
import { modelInfo } from './state.js';
import { post } from './api.js';
import { html, on, icon, toast, toastError } from './ui.js';
import { coin, tick, buzz, popNumber, bump } from './sfx.js';

/** Standard-Suchbegriff für die KI: Modellbezeichnung, bei "Dummy" der Autoname */
export function aiQueryFor(v = {}) {
  const m = modelInfo(v.model || 'dummy');
  if (v.model && v.model !== 'dummy' && m.label) return m.label;
  return v.name || '';
}

export function outerWidthOf(d) {
  const ax = (t, w) => (Number(t) > 0 && Number(w) > 0 ? Number(t) + Number(w) : null);
  const vals = [ax(d.track_front_mm, d.tire_width_front_mm), ax(d.track_rear_mm, d.tire_width_rear_mm || d.tire_width_front_mm)].filter(Boolean);
  return vals.length ? Math.max(...vals) : null;
}

const num = (name, label, v, ph, dis) => html`
  <label><span class="label">${label}</span><input class="input font-mono" type="number" inputmode="numeric" name="${name}" value="${v ?? ''}" placeholder="${ph}" ${dis}></label>`;

/**
 * Formular-Block (ohne eigenes <form>): wird in das Neues-Auto-Formular und in den Reiter "Setup & Maße" eingebettet.
 * withBody: zusätzlich Karosserie-Länge/-Breite (Ersatzwerte, wenn Radmaße fehlen).
 */
export function dimsFields(v = {}, { readonly = false, withBody = true } = {}) {
  const dis = readonly ? 'disabled' : '';
  const m = modelInfo(v.model || 'dummy');
  const ow = v.outer_width_calc_mm || outerWidthOf(v);
  return html`
    <div class="dims-box sm:col-span-2" data-dims>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <div class="flex-1 min-w-[12rem]">
          <div class="font-display font-bold text-white text-sm tracking-wide">${icon('target', 'w-4 h-4 inline text-cyan-300')} Radmaße für den Anhänger-Check</div>
          <div class="text-[11px] text-slate-400">Zählt die Reifenaufstandsfläche, nicht die Karosserie. Alle Werte in Millimetern.</div>
        </div>
      </div>
      ${readonly ? '' : html`<div class="flex flex-wrap gap-2 mb-3">
        <input class="input flex-1 min-w-[12rem] !py-2" data-ai-query value="${aiQueryFor(v)}" placeholder="z. B. BMW E46 320Ci Coupé">
        <button type="button" class="btn btn-ai" data-ai-dims>✨ Serienmaße via KI laden</button>
      </div>`}
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${num('wheelbase_mm', 'Radstand', v.wheelbase_mm, 'z. B. 2725', dis)}
        ${num('track_front_mm', 'Spurweite vorn', v.track_front_mm, 'z. B. 1471', dis)}
        ${num('track_rear_mm', 'Spurweite hinten', v.track_rear_mm, 'z. B. 1483', dis)}
        ${num('tire_width_front_mm', 'Reifenbreite vorn', v.tire_width_front_mm, 'z. B. 225', dis)}
        ${num('tire_width_rear_mm', 'Reifenbreite hinten', v.tire_width_rear_mm, 'z. B. 245', dis)}
        ${num('weight_kg', 'Gewicht (kg)', v.weight_kg, m.weight ? `${m.weight} lt. Modell` : 'z. B. 1350', dis)}
      </div>
      <div class="dims-result mt-3" data-outer>
        <span class="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-display">Radaußenbreite</span>
        <b data-outer-val>${ow ? `${ow} mm` : '?'}</b>
        <span class="text-[11px] text-slate-500" data-outer-hint>${ow ? 'max(Spur + Reifenbreite) von Vorder- und Hinterachse' : 'Spurweite und Reifenbreite eintragen'}</span>
      </div>
      <div class="text-[11px] text-slate-500 mt-2" data-ai-info></div>
      ${withBody ? html`<details class="mt-3"><summary class="text-xs text-slate-400 cursor-pointer select-none">Karosseriemaße (nur Ersatz, wenn Radmaße fehlen)</summary>
        <div class="grid grid-cols-2 gap-2 mt-2">
          ${num('length_cm', 'Länge (cm)', v.length_cm, String(Math.round((m.length || 4.4) * 100)), dis)}
          ${num('width_cm', 'Breite inkl. Spiegel (cm)', v.width_cm, String(Math.round((m.width || 1.8) * 100)), dis)}
        </div></details>` : ''}
    </div>`;
}

/** Live-Berechnung + KI-Button verdrahten. root = Element, das den dims-Block enthält. */
export function bindDims(root) {
  if (!root || root.dataset.dimsBound) return;
  root.dataset.dimsBound = '1';
  const field = (n) => root.querySelector(`[data-dims] [name="${n}"]`);
  const update = () => {
    const box = root.querySelector('[data-dims]');
    if (!box) return;
    const d = {};
    ['track_front_mm', 'track_rear_mm', 'tire_width_front_mm', 'tire_width_rear_mm'].forEach((k) => { const f = field(k); d[k] = f ? f.value : ''; });
    const ow = outerWidthOf(d);
    box.querySelector('[data-outer-val]').textContent = ow ? `${Math.round(ow)} mm` : '?';
    box.querySelector('[data-outer-hint]').textContent = ow ? 'max(Spur + Reifenbreite) von Vorder- und Hinterachse' : 'Spurweite und Reifenbreite eintragen';
  };
  on(root, 'input', '[data-dims] input', update);
  // Modellwechsel im Neues-Auto-Formular: KI-Suchbegriff mitziehen, solange er nicht von Hand geändert wurde
  on(root, 'change', '[data-modelselect]', (_e, sel) => {
    const q = root.querySelector('[data-ai-query]');
    if (q && !q.dataset.touched) q.value = aiQueryFor({ model: sel.value, name: (field('name') || {}).value });
  });
  on(root, 'input', '[data-ai-query]', (_e, q) => { q.dataset.touched = '1'; });
  on(root, 'click', '[data-ai-dims]', async (_e, btn) => {
    const q = root.querySelector('[data-ai-query]');
    const carName = (q && q.value.trim()) || '';
    if (carName.length < 3) { toast('Bitte Fahrzeug angeben, z. B. „BMW E46 320Ci“.', 'warn'); if (q) q.focus(); return; }
    tick(); buzz(10);
    const label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = '✨ Frage KI …';
    try {
      const d = await post('/cars/fetch-dimensions', { car_name: carName });
      const set = (n, val) => { const f = field(n); if (f && val) { f.value = val; bump(f, 'filled'); } };
      set('wheelbase_mm', d.wheelbase_mm);
      set('track_front_mm', d.track_front_mm);
      set('track_rear_mm', d.track_rear_mm);
      set('tire_width_front_mm', d.standard_tire_width);
      set('tire_width_rear_mm', d.tire_width_rear_mm || d.standard_tire_width);
      const w = field('weight_kg');
      if (w && !w.value && d.curb_weight_kg) { w.value = d.curb_weight_kg; bump(w, 'filled'); }
      update();
      coin(); buzz([20, 30, 20]);
      popNumber('✨ Serienmaße', btn, { color: '#c084fc' });
      const info = root.querySelector('[data-ai-info]');
      if (info) info.textContent = `KI (${d.model || 'Gemini'}): ${d.matched || carName}${d.note ? ` · ${d.note}` : ''}. Werte bitte prüfen und bei Umbauten (Wisefab, Spurplatten, breitere Reifen) anpassen, dann speichern.`;
      toast('Serienmaße eingetragen. Noch nicht gespeichert: bei Bedarf anpassen und speichern.', 'ok', 5000);
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = label;
    }
  });
  update();
}

/** Nur die Maß-Felder aus einem Formular holen (für den Reiter "Setup & Maße") */
export function dimsPayload(form) {
  const out = {};
  ['wheelbase_mm', 'track_front_mm', 'track_rear_mm', 'tire_width_front_mm', 'tire_width_rear_mm', 'weight_kg', 'length_cm', 'width_cm']
    .forEach((k) => { const f = form.querySelector(`[name="${k}"]`); if (f) out[k] = f.value; });
  return out;
}

