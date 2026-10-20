/**
 * v3: Anhänger-Fuhrpark & automatische Gespannbeladung
 * - Anhänger mit Leergewicht, zGG, Nutzlast (automatisch), Ladefläche und Zugfahrzeug/Anhängelast
 * - Beladungsplan je Event: Vorschlag vom Server, manuell änderbar, Ampel + Warnton bei Überladung
 */
import { isMuted } from './sfx.js';
import { store, app, canEdit, modelInfo } from './state.js';
import { get, post, put, del } from './api.js';
import { html, raw, setHTML, el, on, icon, toast, toastError, haptic, openModal, confirmDialog, formData } from './ui.js';
import { carThumb } from './sprites.js';

const AMPEL = {
  ok: { label: 'Passt', cls: 'ampel-ok' },
  warn: { label: 'Knapp', cls: 'ampel-warn' },
  red: { label: 'Nicht zulässig', cls: 'ampel-red' }
};

/* ---------------- Warnton (WebAudio, kein Audiofile nötig) ---------------- */
let audioCtx = null;
export function warnTone() {
  try {
    if (isMuted()) throw new Error('stumm'); // v4: globaler Ton-Schalter im HUD
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, 0.22].forEach((off) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(880, t0 + off);
      o.frequency.exponentialRampToValueAtTime(440, t0 + off + 0.18);
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.19);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + off); o.stop(t0 + off + 0.2);
    });
  } catch { /* ohne Ton */ }
  haptic([60, 40, 60]);
}

/* ---------------- Grafik: Ladefläche mit Auto (Draufsicht) ----------------
 * v4.1: gezeichnet wird die Reifenaufstandsfläche (Radstand × Radaußenbreite), die Karosserie nur blass dahinter. */
function deckSvg(trailer, car, status) {
  if (!trailer) return raw('');
  const L = trailer.deck_length_cm || 450; const B = trailer.deck_width_cm || 200;
  const cl = car ? car.length_cm : 0; const cw = car ? car.width_cm : 0;
  const maxL = Math.max(L, cl) + 60; const maxB = Math.max(B, cw) + 30;
  const sx = 220 / maxL;
  const h = Math.max(54, maxB * sx + 10);
  const deckX = 30; const deckY = (h - B * sx) / 2;
  const cx = deckX + (L * sx) / 2; const cy = h / 2;
  const col = status === 'red' ? '#f43f5e' : status === 'warn' ? '#f59e0b' : '#22c55e';
  let carSvg = '';
  if (car) {
    carSvg = `<rect x="${cx - (cl * sx) / 2}" y="${cy - (cw * sx) / 2}" width="${cl * sx}" height="${cw * sx}" rx="${cw * sx * 0.3}" fill="${col}14" stroke="${col}55" stroke-width="1" stroke-dasharray="3 3"/>`;
    if (car.wheelbase_mm && car.outer_width_mm) {
      const wb = (car.wheelbase_mm / 10) * sx;
      const ow = (car.outer_width_mm / 10) * sx;
      const tl = 64 * sx;                                       // Reifendurchmesser ca. 64 cm
      const twF = ((car.tire_width_front_mm || 225) / 10) * sx;
      const twR = ((car.tire_width_rear_mm || car.tire_width_front_mm || 225) / 10) * sx;
      const tire = (x, y, w) => `<rect x="${x - tl / 2}" y="${y}" width="${tl}" height="${w}" rx="1.5" fill="${col}" opacity=".9"/>`;
      carSvg += `<line x1="${cx - wb / 2}" y1="${cy}" x2="${cx + wb / 2}" y2="${cy}" stroke="${col}" stroke-width="1" stroke-dasharray="${status === 'red' ? '4 3' : '0'}"/>
        ${tire(cx + wb / 2, cy - ow / 2, twF)}${tire(cx + wb / 2, cy + ow / 2 - twF, twF)}
        ${tire(cx - wb / 2, cy - ow / 2, twR)}${tire(cx - wb / 2, cy + ow / 2 - twR, twR)}`;
    }
  }
  return raw(`<svg viewBox="0 0 260 ${h}" class="w-full max-w-[260px]" style="height:${h}px">
    <line x1="4" y1="${h / 2}" x2="${deckX}" y2="${h / 2}" stroke="#64748b" stroke-width="3"/>
    <circle cx="5" cy="${h / 2}" r="4" fill="#94a3b8"/>
    <rect x="${deckX}" y="${deckY}" width="${L * sx}" height="${B * sx}" rx="3" fill="#1c2531" stroke="#475569" stroke-width="1.5"/>
    <rect x="${deckX + L * sx * 0.38}" y="${deckY - 5}" width="${L * sx * 0.22}" height="5" fill="#0b0c0f"/>
    <rect x="${deckX + L * sx * 0.38}" y="${deckY + B * sx}" width="${L * sx * 0.22}" height="5" fill="#0b0c0f"/>
    ${carSvg}
    <text x="${deckX + L * sx / 2}" y="${h - 2}" text-anchor="middle" font-size="9" fill="#94a3b8" font-family="JetBrains Mono">${L} × ${B} cm</text>
  </svg>`);
}

/** Kurzinfo zu den Maßen eines Autos für die Gespann-Liste */
function carDimsText(c) {
  const w = c.weight ? `${c.weight} kg${c.weightEstimated ? '*' : ''}` : 'Gewicht ?';
  if (c.wheelbase_mm && c.outer_width_mm) return `${w} · Radstand ${c.wheelbase_mm} · Spur außen ${c.outer_width_mm} mm`;
  return `${w} · Radmaße fehlen (Karosserie ${c.length_cm}×${c.width_cm} cm)`;
}

/* ====================================================================== */
/* Panel "Anhänger" (rechte Seitenleiste)                                  */
/* ====================================================================== */
export async function renderTrailersPanel(container) {
  let trailers = [];
  try { trailers = await get('/trailers'); } catch (err) { toastError(err); }
  setHTML(container, html`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between">
        <div><h3 class="font-display font-bold tracking-wider text-white">Anhänger-Fuhrpark</h3><p class="text-xs text-slate-500">${trailers.length} Anhänger · Beladung im Event-Planer</p></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary" data-tr-new>${icon('plus')} Anhänger</button>` : ''}
      </div>
      ${trailers.map((t) => html`
        <article class="card p-3 ${t.active ? '' : 'opacity-50'}">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-display font-bold text-white truncate">${t.name}</div>
              <div class="text-[11px] text-slate-400">${t.plate ? html`<span class="font-mono">${t.plate}</span> · ` : ''}${t.active ? 'aktiv' : 'stillgelegt'}</div>
            </div>
            ${canEdit() ? html`<button class="btn-icon !w-8 !h-8" data-tr-edit="${t.id}">${icon('edit', 'w-3.5 h-3.5')}</button>` : ''}
          </div>
          <div class="grid grid-cols-3 gap-1.5 mt-2 text-center">
            <div class="rounded-md bg-black/30 py-1.5"><div class="text-[9px] uppercase tracking-widest text-slate-500">Leer</div><div class="font-mono text-sm text-white">${t.empty_kg} kg</div></div>
            <div class="rounded-md bg-black/30 py-1.5"><div class="text-[9px] uppercase tracking-widest text-slate-500">zGG</div><div class="font-mono text-sm text-white">${t.gvw_kg} kg</div></div>
            <div class="rounded-md bg-cyan-400/10 border border-cyan-400/30 py-1.5"><div class="text-[9px] uppercase tracking-widest text-cyan-300">Nutzlast</div><div class="font-mono text-sm font-bold text-cyan-200">${t.payload_kg} kg</div></div>
          </div>
          <div class="mt-2">${deckSvg(t, null, 'ok')}</div>
          <div class="text-[11px] text-slate-400 mt-1">${icon('car', 'w-3 h-3 inline')} Zugfahrzeug: ${t.tow_vehicle_name || t.tow_name || 'nicht festgelegt'}${t.tow_capacity_kg ? html` · Anhängelast <b class="text-slate-200">${t.tow_capacity_kg} kg</b> gebremst` : ''}</div>
        </article>`)}
      ${!trailers.length ? html`<div class="card p-6 text-center text-sm text-slate-400">${icon('car', 'w-6 h-6 mx-auto mb-2')}Noch kein Anhänger angelegt.</div>` : ''}
    </div>`);
  if (!container.dataset.boundTrailers) {
    container.dataset.boundTrailers = '1';
    const rerender = () => app.rerenderTab('trailers');
    on(container, 'click', '[data-tr-new]', () => trailerForm({}, rerender));
    on(container, 'click', '[data-tr-edit]', async (_e, b) => {
      const list = await get('/trailers');
      trailerForm(list.find((x) => x.id === Number(b.dataset.trEdit)), rerender);
    });
  }
}

function trailerForm(t, onSaved) {
  const isNew = !t.id;
  const body = el(html`<div><form class="grid sm:grid-cols-2 gap-3" data-form>
    <label class="sm:col-span-2"><span class="label">Name</span><input class="input" name="name" value="${t.name || ''}" required placeholder="z. B. Brenderup 2-Achs Autotransporter"></label>
    <label><span class="label">Kennzeichen</span><input class="input font-mono" name="plate" value="${t.plate || ''}"></label>
    <label class="flex items-center gap-2 sm:mt-6"><input type="checkbox" class="check" name="active" ${t.active === 0 ? '' : 'checked'}> aktiv (für Beladung nutzen)</label>
    <label><span class="label">Leergewicht (kg)</span><input class="input" type="number" min="0" name="empty_kg" value="${t.empty_kg ?? ''}" required data-calc></label>
    <label><span class="label">zul. Gesamtgewicht zGG (kg)</span><input class="input" type="number" min="0" name="gvw_kg" value="${t.gvw_kg ?? ''}" required data-calc></label>
    <div class="sm:col-span-2 rounded-lg bg-cyan-400/10 border border-cyan-400/30 px-3 py-2 text-sm text-cyan-100" data-payload></div>
    <label><span class="label">Nutzlänge Auffahrfläche (cm)</span><input class="input" type="number" min="0" name="deck_length_cm" value="${t.deck_length_cm ?? ''}" placeholder="z. B. 450"><span class="text-[10px] text-slate-500">wird mit dem Radstand verglichen</span></label>
    <label><span class="label">Nutzbreite zwischen den Radkästen (cm)</span><input class="input" type="number" min="0" name="deck_width_cm" value="${t.deck_width_cm ?? ''}" placeholder="z. B. 200"><span class="text-[10px] text-slate-500">wird mit der Radaußenbreite verglichen</span></label>
    <label><span class="label">Zugfahrzeug aus dem Fuhrpark</span><select class="select" name="tow_vehicle_id"><option value="">keins / extern</option>${store.vehicles.map((v) => html`<option value="${v.id}" ${t.tow_vehicle_id === v.id ? 'selected' : ''}>${v.name}</option>`)}</select></label>
    <label><span class="label">oder Zugfahrzeug (Freitext)</span><input class="input" name="tow_name" value="${t.tow_name || ''}" placeholder="z. B. Sprinter von Papa"></label>
    <label class="sm:col-span-2"><span class="label">Zulässige Anhängelast gebremst (kg)</span><input class="input" type="number" min="0" name="tow_capacity_kg" value="${t.tow_capacity_kg ?? ''}" placeholder="steht im Fahrzeugschein (O.1)"></label>
    <label class="sm:col-span-2"><span class="label">Notizen</span><input class="input" name="notes" value="${t.notes || ''}"></label>
  </form></div>`);
  const m = openModal({ title: isNew ? 'Neuer Anhänger' : t.name, size: 'md', iconName: 'car', body,
    footer: html`${!isNew ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash')}</button>` : ''}<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Speichern</button>` });
  const f = body.querySelector('form');
  const calc = () => {
    const p = (Number(f.gvw_kg.value) || 0) - (Number(f.empty_kg.value) || 0);
    setHTML(body.querySelector('[data-payload]'), p >= 0 ? html`Nutzlast (automatisch): <b class="font-mono">${p} kg</b>` : html`<span class="text-rose-300">Leergewicht größer als zGG!</span>`);
  };
  on(body, 'input', '[data-calc]', calc);
  calc();
  m.footer.querySelector('[data-save]').addEventListener('click', async () => {
    if (!f.reportValidity()) return;
    try {
      const d = formData(f);
      if (isNew) await post('/trailers', d); else await put(`/trailers/${t.id}`, d);
      m.close(); toast('Anhänger gespeichert.', 'ok'); onSaved && onSaved();
    } catch (err) { toastError(err); }
  });
  const dl = m.footer.querySelector('[data-del]');
  if (dl) dl.addEventListener('click', async () => {
    if (!(await confirmDialog(`Anhänger „${t.name}“ löschen? Bestehende Beladungspläne verlieren diese Zuordnung.`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/trailers/${t.id}`); m.close(); onSaved && onSaved(); } catch (err) { toastError(err); }
  });
}

/* ====================================================================== */
/* Beladungsplan für ein Event                                             */
/* ====================================================================== */
export function loadingBadge(summary) {
  if (!summary) return '';
  if (summary.red) return html`<span class="ampel ampel-red">${icon('alert', 'w-3 h-3')} ${summary.red} Problem${summary.red > 1 ? 'e' : ''}</span>`;
  if (summary.warn) return html`<span class="ampel ampel-warn">knapp</span>`;
  if (summary.ok) return html`<span class="ampel ampel-ok">${icon('check', 'w-3 h-3')} legal</span>`;
  return '';
}

export async function openLoadingPlan(eventId) {
  let plan;
  try { plan = await get(`/events/${eventId}/loading`); } catch (err) { toastError(err); return; }
  let assign = new Map(plan.rows.map((r) => [r.car.id, r.trailer_id]));
  let dirty = false;
  let lastRed = plan.summary.red;

  const body = el(html`<div data-root></div>`);
  const m = openModal({ title: `Gespanne · ${plan.event.name}`, subtitle: 'Welches Auto kommt auf welchen Anhänger?', size: 'xl', iconName: 'car', body,
    onClose: () => { if (dirty) toast('Hinweis: Die geänderte Beladung wurde nicht gespeichert.', 'warn', 4500); },
    footer: html`${canEdit() ? html`<button class="btn btn-ghost mr-auto" data-suggest>${icon('refresh')} Neu vorschlagen</button>` : ''}
      <button class="btn" data-close>Schließen</button>${canEdit() ? html`<button class="btn btn-primary" data-saveplan>${icon('check')} Plan speichern</button>` : ''}` });
  const root = body;

  /** Lokale Neubewertung beim Umstellen (gleiche Regeln wie Server, damit die Ampel sofort reagiert). */
  async function evaluateLocal() {
    const assignments = [...assign.entries()].map(([vehicle_id, trailer_id]) => ({ vehicle_id, trailer_id }));
    // Server ist die Quelle der Wahrheit: Vorschau wird bewertet, aber noch NICHT gespeichert
    plan = await post(`/events/${eventId}/loading/preview`, { assignments });
    dirty = true;
  }

  function render() {
    const s = plan.summary;
    if (!plan.trailers.length) {
      setHTML(root, html`<div class="card p-6 text-center text-slate-300">${icon('car', 'w-8 h-8 mx-auto mb-3 text-slate-500')}
        Noch kein Anhänger angelegt. Lege im Reiter <b>Anhänger</b> deine Hänger mit Leergewicht, zGG und Ladefläche an.</div>`);
      return;
    }
    setHTML(root, html`
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span class="ampel ${s.red ? 'ampel-red ampel-pulse' : s.warn ? 'ampel-warn' : 'ampel-ok'} !text-sm !px-3 !py-1.5">
          ${s.red ? html`${icon('alert', 'w-4 h-4')} ${s.red} Gespann${s.red > 1 ? 'e' : ''} nicht zulässig` : s.warn ? 'Alles zulässig, teilweise knapp' : html`${icon('check', 'w-4 h-4')} Alle Gespanne im legalen Bereich`}
        </span>
        <span class="chip">${plan.source === 'saved' ? 'gespeicherter Plan' : plan.source === 'preview' ? 'nicht gespeicherte Änderung' : 'automatischer Vorschlag'}</span>
        ${s.selfDriving ? html`<span class="chip">${s.selfDriving} Auto${s.selfDriving > 1 ? 's' : ''} ohne Anhänger (fährt selbst)</span>` : ''}
        ${s.tow.length ? html`<span class="chip !text-cyan-200">Zugfahrzeug: ${s.tow.join(', ')}</span>` : ''}
      </div>
      <div class="space-y-2">
        ${plan.rows.map((r) => {
          const t = plan.trailers.find((x) => x.id === r.trailer_id);
          const st = r.eval ? r.eval.status : null;
          return html`
            <div class="card p-3 grid lg:grid-cols-[230px_1fr_270px] gap-3 items-center ${st === 'red' ? 'load-red' : st === 'warn' ? 'load-warn' : st === 'ok' ? 'load-ok' : ''}">
              <div class="flex items-center gap-2 min-w-0">
                <img src="${carThumb(modelInfo(r.car.model), r.car.color, { w: 70, h: 32 })}" class="w-[70px] h-8 shrink-0" alt="">
                <div class="min-w-0"><div class="font-semibold text-white text-sm truncate">${r.car.name}</div>
                  <div class="text-[11px] text-slate-400 font-mono">${carDimsText(r.car)}</div></div>
              </div>
              <div class="min-w-0">
                <select class="select text-sm mb-2" data-assign="${r.car.id}" ${canEdit() ? '' : 'disabled'}>
                  <option value="">Fährt selbst / kein Anhänger</option>
                  ${plan.trailers.map((x) => html`<option value="${x.id}" ${x.id === r.trailer_id ? 'selected' : ''}>${x.name} (Nutzlast ${x.payload_kg} kg)</option>`)}
                </select>
                ${r.eval ? html`<div class="flex flex-wrap gap-1.5">
                  <span class="ampel ${AMPEL[st].cls}">${AMPEL[st].label}</span>
                  ${r.eval.issues.map((i) => html`<span class="text-[11px] ${i.level === 'red' ? 'text-rose-300 font-semibold' : i.level === 'warn' ? 'text-amber-200' : 'text-slate-500'}">${i.text}</span>`)}
                  ${!r.eval.issues.length ? html`<span class="text-[11px] text-lime-300">${r.eval.reserve_kg} kg Reserve · Gespann ${r.eval.total_kg} kg</span>` : ''}
                </div>` : html`<span class="text-[11px] text-slate-500">Auf eigener Achse oder anderweitig transportiert.</span>`}
              </div>
              <div>${t ? deckSvg(t, r.car, st) : ''}</div>
            </div>`;
        })}
      </div>
      <p class="text-[11px] text-slate-500 mt-3">* Gewicht aus dem Fahrzeugmodell geschätzt. Echtes Gewicht im Cockpit unter Einstellungen eintragen. Ein Anhänger trägt ein Auto.</p>`);
  }

  on(root, 'change', '[data-assign]', async (_e, s) => {
    assign.set(Number(s.dataset.assign), s.value ? Number(s.value) : null);
    try {
      await evaluateLocal();
      if (plan.summary.red > lastRed) warnTone();
      lastRed = plan.summary.red;
      render();
    } catch (err) { toastError(err); }
  });
  const sug = m.footer.querySelector('[data-suggest]');
  if (sug) sug.addEventListener('click', async () => {
    try {
      plan = await del(`/events/${eventId}/loading`);
      assign = new Map(plan.rows.map((r) => [r.car.id, r.trailer_id]));
      lastRed = plan.summary.red;
      render();
      toast('Neuer Vorschlag berechnet.', 'ok');
    } catch (err) { toastError(err); }
  });
  const sv = m.footer.querySelector('[data-saveplan]');
  if (sv) sv.addEventListener('click', async () => {
    try {
      plan = await post(`/events/${eventId}/loading`, { assignments: [...assign.entries()].map(([vehicle_id, trailer_id]) => ({ vehicle_id, trailer_id })) });
      dirty = false;
      render();
      toast(plan.summary.red ? 'Gespeichert, aber es gibt noch unzulässige Gespanne!' : 'Beladungsplan gespeichert.', plan.summary.red ? 'warn' : 'ok');
      app.rerenderTab('events');
    } catch (err) { toastError(err); }
  });
  render();
  if (plan.summary.red) warnTone();
  return m;
}
app.openLoadingPlan = openLoadingPlan;
