/**
 * Animiertes Drift-Setup-Sheet (Fahrwerk & Geometrie)
 * - Frontansicht (Sturz) und Draufsicht (Spur, Lenkeinschlag) als animierte SVG-Grafik
 * - Seitenansicht für den Nachlauf
 * - Reifendruck kalt/warm, Lenkwinkel-Kit, Dämpfer-Klicks, Stabis, Fahrhöhe
 * - Strecken-Historie: welches Setup hat bei welchem Event / Track funktioniert?
 */
import { canEdit } from './state.js';
import { get, post, put, del } from './api.js';
import { html, setHTML, el, on, icon, toast, toastError, haptic, fmtDate, confirmDialog } from './ui.js';

const CAMBER_X = 3;  // Darstellung überhöht, damit -1° schon sichtbar ist
const TOE_X = 8;
// v5.2: Spur in Millimetern (Summe je Achse). Grafik: Winkel je Rad proportional zur halben Achs-Spur, stark überhöht
const TOE_MM_X = 4;          // Grad Darstellung je mm Spur pro Rad
const TOE_MM_MAX = 22;       // Grafik begrenzen
const fmtMm = (v, digits = 1) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? 'k. A.'
  : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(digits).replace('.', ',')} mm`);
/** Felgendurchmesser in mm aus den Rad-Specs ("8,5x18 ET35" -> 18 Zoll), sonst 17 Zoll */
function rimDiameterMm(vehicle) {
  for (const w of (vehicle && vehicle.wheel_specs) || []) {
    const m = String(w.rim || '').match(/[x×]\s*(\d{2})(?:[.,]\d)?\b/i) || String(w.tire || '').match(/R\s?(\d{2})\b/i);
    if (m) return Number(m[1]) * 25.4;
  }
  return 17 * 25.4;
}
/** Alte Spurwerte in Grad (je Rad) in mm je Achse umrechnen: mm = Felgendurchmesser × tan(Winkel), links + rechts */
function legacyToeMm(setup, vehicle) {
  const t = setup && setup.data && setup.data.toe;
  if (!t || !['fl', 'fr', 'rl', 'rr'].some((k) => Number(t[k]))) return null;
  const D = rimDiameterMm(vehicle);
  const mm = (deg) => D * Math.tan((Number(deg) || 0) * Math.PI / 180);
  const r1 = (x) => Math.round(x * 10) / 10;
  return { front: r1(mm(t.fl) + mm(t.fr)), rear: r1(mm(t.rl) + mm(t.rr)), inch: Math.round(D / 25.4) };
}
const CLICKS_MAX = 24;

const DEFAULTS = {
  camber: { fl: -3, fr: -3, rl: -0.5, rr: -0.5 },
  toe: { fl: 0, fr: 0, rl: 0, rr: 0 },   // alt (Grad), nur noch zum Umrechnen alter Setups; neu: toe_front_mm / toe_rear_mm
  caster: { fl: 7, fr: 7 },
  pressure: { cold: { fl: 2.2, fr: 2.2, rl: 2.0, rr: 2.0 }, warm: { fl: 2.6, fr: 2.6, rl: 2.4, rr: 2.4 } },
  steering: { kit: '', lock: 55, ackermann: 'parallel' },
  dampers: { front: { rebound: 10, bump: 8 }, rear: { rebound: 8, bump: 6 } },
  arb: { front: '', rear: '' },
  rideHeight: { front: '', rear: '' }
};

const clone = (o) => JSON.parse(JSON.stringify(o));
function deepMerge(base, add) {
  const out = clone(base);
  for (const [k, v] of Object.entries(add || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k] || {}, v) : v;
  return out;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, val) { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks[ks.length - 1]] = val; }
const num = (v, d = 0) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const fmt = (v, digits = 1) => `${num(v) > 0 ? '+' : ''}${num(v).toFixed(digits)}°`;

/* ---------------- SVG-Bausteine ---------------- */
function frontView() {
  const wheel = (cx, id) => `
    <g class="geo-wheel" data-w="${id}" style="transform-origin:${cx}px 200px">
      <rect x="${cx - 21}" y="92" width="42" height="108" rx="11" fill="#0c0e11" stroke="#3a414c" stroke-width="1.5"/>
      <rect x="${cx - 13}" y="112" width="26" height="68" rx="5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
      <circle cx="${cx}" cy="146" r="6" fill="#94a3b8"/>
      <line x1="${cx}" y1="70" x2="${cx}" y2="92" stroke="#22d3ee" stroke-width="2" stroke-dasharray="3 3"/>
    </g>`;
  return `<svg viewBox="0 0 420 240" class="geo-svg">
    <defs><pattern id="geoGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(56,189,248,.08)"/></pattern></defs>
    <rect width="420" height="240" fill="url(#geoGrid)"/>
    <line x1="10" y1="200" x2="410" y2="200" stroke="#475569" stroke-width="2"/>
    <rect x="120" y="78" width="180" height="62" rx="12" fill="#151c27" stroke="#334155"/>
    <text x="210" y="114" text-anchor="middle" class="geo-label" data-axle-label>VORDERACHSE</text>
    <line x1="120" y1="96" x2="88" y2="104" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
    <line x1="120" y1="130" x2="88" y2="176" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
    <line x1="300" y1="96" x2="332" y2="104" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
    <line x1="300" y1="130" x2="332" y2="176" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>
    <line x1="68" y1="60" x2="68" y2="205" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>
    <line x1="352" y1="60" x2="352" y2="205" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>
    ${wheel(68, 'right')}${wheel(352, 'left')}
    <text x="68" y="226" text-anchor="middle" class="geo-val" data-val="right"></text>
    <text x="352" y="226" text-anchor="middle" class="geo-val" data-val="left"></text>
    <text x="68" y="50" text-anchor="middle" class="geo-label" data-side="right">RECHTS</text>
    <text x="352" y="50" text-anchor="middle" class="geo-label" data-side="left">LINKS</text>
  </svg>`;
}

function topView() {
  const w = (cx, cy, id) => `
    <g class="geo-wheel" data-tw="${id}" style="transform-origin:${cx}px ${cy}px">
      <rect x="${cx - 12}" y="${cy - 30}" width="24" height="60" rx="7" fill="#0c0e11" stroke="#3a414c" stroke-width="1.5"/>
      <line x1="${cx}" y1="${cy - 30}" x2="${cx}" y2="${cy - 58}" stroke="#f97316" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy - 58}" r="3" fill="#f97316"/>
    </g>`;
  return `<svg viewBox="0 0 300 430" class="geo-svg mx-auto" style="max-width:340px">
    <rect width="300" height="430" fill="url(#geoGrid)"/>
    <path d="M110 46 Q150 26 190 46 L208 120 L208 360 Q205 392 150 396 Q95 392 92 360 L92 120 Z" fill="#151c27" stroke="#334155" stroke-width="1.5"/>
    <path d="M112 150 L188 150 L180 186 L120 186 Z" fill="#0b1320" stroke="#334155"/>
    <path d="M120 300 L180 300 L186 326 L114 326 Z" fill="#0b1320" stroke="#334155"/>
    <line x1="64" y1="118" x2="236" y2="118" stroke="#334155" stroke-width="3"/>
    <line x1="64" y1="330" x2="236" y2="330" stroke="#334155" stroke-width="3"/>
    ${w(64, 118, 'fl')}${w(236, 118, 'fr')}${w(64, 330, 'rl')}${w(236, 330, 'rr')}
    ${['fl', 'fr', 'rl', 'rr'].map((k) => {
      const x = k.endsWith('l') ? 22 : 278; const y = k.startsWith('f') ? 118 : 330;
      return `<text x="${x}" y="${y - 8}" text-anchor="middle" class="geo-label">${{ fl: 'VL', fr: 'VR', rl: 'HL', rr: 'HR' }[k]}</text>
        <text x="${x}" y="${y + 8}" text-anchor="middle" class="geo-val" data-toe="${k}"></text>
        <text x="${x}" y="${y + 22}" text-anchor="middle" class="geo-small" data-psi="${k}"></text>`;
    }).join('')}
  </svg>`;
}

function sideView() {
  return `<svg viewBox="0 0 160 170" class="geo-svg mx-auto" style="max-width:240px">
    <rect width="160" height="170" fill="url(#geoGrid)"/>
    <line x1="10" y1="150" x2="150" y2="150" stroke="#475569" stroke-width="2"/>
    <circle cx="80" cy="102" r="46" fill="#0c0e11" stroke="#3a414c" stroke-width="1.5"/>
    <circle cx="80" cy="102" r="28" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
    <line x1="80" y1="14" x2="80" y2="160" stroke="rgba(255,255,255,.2)" stroke-dasharray="4 4"/>
    <g class="geo-wheel" data-caster style="transform-origin:80px 102px"><line x1="80" y1="12" x2="80" y2="150" stroke="#a3e635" stroke-width="3" stroke-linecap="round"/></g>
    <text x="80" y="166" text-anchor="middle" class="geo-val" data-caster-val></text>
    <text x="10" y="13" class="geo-small" style="font-size:8px">← Fahrtrichtung</text>
  </svg>`;
}

const clicks = (val) => html`<span class="clicks">${Array.from({ length: CLICKS_MAX }, (_, i) => html`<i class="${i < num(val) ? 'on' : ''}"></i>`)}</span>`;

/* ====================================================================== */
export async function renderSetupTab(content, { vehicle }) {
  const root = el(html`<div><p class="text-sm text-slate-500">Lädt …</p></div>`);
  setHTML(content, '');
  content.appendChild(root);
  let setups = [];
  let events = [];
  try { [setups, events] = await Promise.all([get(`/vehicles/${vehicle.id}/setups`), get('/events')]); } catch (err) { toastError(err); return; }

  let current = setups.find((s) => s.is_current) || setups[0] || null;
  let data = deepMerge(DEFAULTS, current ? current.data : {});
  // v5.2: Spur in mm (Spalten toe_front_mm / toe_rear_mm); alte Setups mit Gradwerten werden zur Anzeige umgerechnet
  let toe = {};
  const loadToe = () => {
    if (current && (current.toe_front_mm !== null && current.toe_front_mm !== undefined || current.toe_rear_mm !== null && current.toe_rear_mm !== undefined)) {
      toe = { front: current.toe_front_mm, rear: current.toe_rear_mm, converted: null };
    } else if (current) {
      const c = legacyToeMm(current, vehicle);
      toe = c ? { front: c.front, rear: c.rear, converted: c.inch } : { front: null, rear: null, converted: null };
    } else toe = { front: 0, rear: 1, converted: null };
  };
  loadToe();
  const toeNow = () => {
    const f = root.querySelector('[name="toe_front_mm"]');
    const r = root.querySelector('[name="toe_rear_mm"]');
    const n = (el2, fb) => { if (!el2) return fb; const v = String(el2.value).replace(',', '.').trim(); return v === '' ? null : Number(v); };
    return { front: n(f, toe.front), rear: n(r, toe.rear) };
  };
  let axle = 'front';
  let steer = false;

  const field = (path, label, { step = 0.1, unit = '', type = 'number', w = '' } = {}) => html`
    <label class="${w}"><span class="label">${label}</span>
      <div class="relative"><input class="input !py-1.5 font-mono text-sm ${unit ? '!pr-9' : ''}" ${type === 'number' ? `type="number" step="${step}"` : ''} name="${path}" value="${getPath(data, path) ?? ''}" ${canEdit() ? '' : 'disabled'}>
      ${unit ? html`<span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">${unit}</span>` : ''}</div></label>`;
  const quad = (base, label, opts) => html`
    <div><div class="label">${label}</div><div class="grid grid-cols-4 gap-1.5">
      ${['fl', 'fr', 'rl', 'rr'].map((k) => field(`${base}.${k}`, { fl: 'VL', fr: 'VR', rl: 'HL', rr: 'HR' }[k], opts))}</div></div>`;

  function render() {
    setHTML(root, html`
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <div class="flex-1 min-w-[200px]">
          <div class="font-display font-bold text-white text-lg">${current ? current.title : 'Neues Setup'}</div>
          <div class="text-xs text-slate-400">${current ? html`${current.event_name || current.track || 'ohne Strecke'} · ${fmtDate(current.setup_date)}${current.is_current ? html` · <span class="text-lime-300">aktuell gefahren</span>` : ''}` : 'Werte eintragen und speichern'}</div>
        </div>
        <div class="mode-switch game-only"><button class="${axle === 'front' ? 'on' : ''}" data-axle="front">Vorderachse</button><button class="${axle === 'rear' ? 'on' : ''}" data-axle="rear">Hinterachse</button></div>
        <button class="btn btn-sm game-only ${steer ? 'btn-amber' : ''}" data-steer>${icon('target', 'w-3.5 h-3.5')} Lenkeinschlag</button>
        <button class="btn btn-sm biz-only" data-printproto>${icon('print', 'w-3.5 h-3.5')} Protokoll drucken</button>
      </div>

      <div class="grid xl:grid-cols-[1.25fr_1fr] gap-4">
        <!-- v5: Büro-Ansicht: Kennzahlentabelle statt Grafik -->
        <div class="biz-only bz-proto print-area" data-protocol></div>
        <!-- Visualisierung -->
        <div class="space-y-3 game-only">
          <div class="geo-panel"><div class="geo-title">FRONTANSICHT · STURZ <span>Darstellung ${CAMBER_X}× überhöht</span></div>${{ __raw: frontView() }}</div>
          <div class="grid sm:grid-cols-[1.4fr_1fr] gap-3">
            <div class="geo-panel"><div class="geo-title">DRAUFSICHT · SPUR IN MM <span data-toesum>stark überhöht</span></div>${{ __raw: topView() }}</div>
            <div class="space-y-3">
              <div class="geo-panel"><div class="geo-title">NACHLAUF</div>${{ __raw: sideView() }}</div>
              <div class="geo-panel p-3 space-y-2 text-[11px]" data-dampers></div>
            </div>
          </div>
        </div>

        <!-- Werte -->
        <form class="space-y-4" data-setupform>
          <div class="grid grid-cols-2 gap-2">
            <label class="col-span-2"><span class="label">Setup-Name</span><input class="input" name="title" value="${current ? current.title : ''}" placeholder="z. B. Trocken Basis, Regen, Bilster Berg" ${canEdit() ? '' : 'disabled'}></label>
            <label><span class="label">Event</span><select class="select text-sm" name="event_id" ${canEdit() ? '' : 'disabled'}><option value="">kein Event</option>
              ${events.map((e) => html`<option value="${e.id}" ${current && current.event_id === e.id ? 'selected' : ''}>${e.name} (${fmtDate(e.date_start, { short: true })})</option>`)}</select></label>
            <label><span class="label">Strecke</span><input class="input text-sm" name="track" value="${current ? current.track || '' : ''}" ${canEdit() ? '' : 'disabled'}></label>
          </div>
          <section class="geo-section"><h4>Sturz (Camber)</h4>${quad('camber', '', { step: 0.1, unit: '°' })}</section>
          <section class="geo-section"><h4>Spur (Toe) in mm <span>Summe je Achse · + = Vorspur · − = Nachspur</span></h4>
            <div class="grid grid-cols-2 gap-1.5">
              <label><span class="label">Spur vorn</span><div class="relative"><input class="input !py-1.5 font-mono text-sm !pr-9" type="number" step="0.1" name="toe_front_mm" value="${toe.front ?? ''}" ${canEdit() ? '' : 'disabled'}><span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">mm</span></div></label>
              <label><span class="label">Spur hinten</span><div class="relative"><input class="input !py-1.5 font-mono text-sm !pr-9" type="number" step="0.1" name="toe_rear_mm" value="${toe.rear ?? ''}" ${canEdit() ? '' : 'disabled'}><span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">mm</span></div></label>
            </div>
            ${toe.converted ? html`<p class="text-[11px] text-amber-300 mt-1.5">${icon('alert', 'w-3 h-3 inline')} Aus den alten Gradwerten umgerechnet (${toe.converted}-Zoll-Felge). Bitte prüfen und speichern.</p>` : ''}
          </section>
          <section class="geo-section"><h4>Nachlauf & Lenkung</h4>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              ${field('caster.fl', 'Nachlauf VL', { unit: '°' })}${field('caster.fr', 'Nachlauf VR', { unit: '°' })}
              ${field('steering.lock', 'Lenkwinkel', { step: 1, unit: '°' })}
              <label><span class="label">Ackermann</span><select class="select !py-1.5 text-sm" name="steering.ackermann" ${canEdit() ? '' : 'disabled'}>
                ${[['pro', 'Pro'], ['parallel', 'Parallel'], ['anti', 'Anti']].map(([k, l]) => html`<option value="${k}" ${data.steering.ackermann === k ? 'selected' : ''}>${l}</option>`)}</select></label>
              ${field('steering.kit', 'Lenkwinkel-Kit', { type: 'text', w: 'col-span-2 sm:col-span-4' })}
            </div></section>
          <section class="geo-section"><h4>Reifendruck</h4>
            ${quad('pressure.cold', 'Kalt (bar)', { step: 0.05 })}<div class="h-2"></div>${quad('pressure.warm', 'Warm (bar)', { step: 0.05 })}</section>
          <section class="geo-section"><h4>Dämpfer (Klicks) & Stabis</h4>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              ${field('dampers.front.rebound', 'Zug vorn', { step: 1 })}${field('dampers.front.bump', 'Druck vorn', { step: 1 })}
              ${field('dampers.rear.rebound', 'Zug hinten', { step: 1 })}${field('dampers.rear.bump', 'Druck hinten', { step: 1 })}
              ${field('arb.front', 'Stabi vorn', { type: 'text', w: 'col-span-2' })}${field('arb.rear', 'Stabi hinten', { type: 'text', w: 'col-span-2' })}
              ${field('rideHeight.front', 'Höhe vorn', { step: 1, unit: 'mm', w: 'col-span-2' })}${field('rideHeight.rear', 'Höhe hinten', { step: 1, unit: 'mm', w: 'col-span-2' })}
            </div></section>
          <section class="geo-section"><h4>Wie lief's?</h4>
            <div class="flex items-center gap-1 mb-2" data-stars>${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="star ${current && current.rating >= n ? 'on' : ''}" data-star="${n}" ${canEdit() ? '' : 'disabled'}>★</button>`)}
              <span class="text-xs text-slate-500 ml-2">Bewertung für die Strecken-Historie</span></div>
            <textarea class="input text-sm" rows="2" name="notes" placeholder="z. B. Heck kommt zu spät, vorne mehr Druck" ${canEdit() ? '' : 'disabled'}>${current ? current.notes || '' : ''}</textarea>
          </section>
          ${canEdit() ? html`<div class="flex flex-wrap gap-2">
            ${current ? html`<button class="btn btn-primary" data-save="update">${icon('check')} Speichern</button>` : ''}
            <button class="btn ${current ? '' : 'btn-primary'}" data-save="new">${icon('plus')} Als neues Setup</button>
            ${current && !current.is_current ? html`<button type="button" class="btn" data-makecurrent>${icon('flag', 'w-3.5 h-3.5')} Als aktuell markieren</button>` : ''}
          </div>` : ''}
        </form>
      </div>

      <!-- Strecken-Historie -->
      <h4 class="font-display text-xs tracking-[0.2em] text-slate-400 mt-6 mb-2">STRECKEN-HISTORIE</h4>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${setups.map((s) => html`
          <div class="card p-3 ${current && current.id === s.id ? '!border-cyan-400/60' : ''}">
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0"><div class="font-semibold text-white truncate">${s.title}</div>
                <div class="text-[11px] text-slate-400 truncate">${s.event_name || s.track || 'ohne Strecke'} · ${fmtDate(s.setup_date)}</div></div>
              ${s.is_current ? html`<span class="chip !text-[10px] !text-lime-200 !border-lime-400/40">aktuell</span>` : ''}
            </div>
            <div class="text-amber-300 text-sm mt-1">${'★'.repeat(s.rating || 0)}<span class="text-slate-700">${'★'.repeat(5 - (s.rating || 0))}</span></div>
            <div class="text-[11px] text-slate-400 font-mono mt-1">Sturz ${num(s.data.camber && s.data.camber.fl).toFixed(1)}° / ${num(s.data.camber && s.data.camber.rl).toFixed(1)}° · Lenkw. ${s.data.steering ? s.data.steering.lock : '?'}°${s.toe_front_mm !== null && s.toe_front_mm !== undefined ? ` · Spur ${fmtMm(s.toe_front_mm)} / ${fmtMm(s.toe_rear_mm)}` : ''}</div>
            ${s.notes ? html`<div class="text-[11px] text-slate-500 mt-1 line-clamp-2">${s.notes}</div>` : ''}
            <div class="flex gap-1.5 mt-2">
              <button class="btn btn-sm flex-1" data-load="${s.id}">Laden</button>
              ${canEdit() ? html`<button class="btn-icon !w-7 !h-7 hover:!text-rose-300" data-delsetup="${s.id}">${icon('trash', 'w-3.5 h-3.5')}</button>` : ''}
            </div>
          </div>`)}
        ${!setups.length ? html`<p class="text-sm text-slate-500">Noch keine Setups gespeichert.</p>` : ''}
      </div>`);
    updateVisual();
  }

  let rating = current ? current.rating || 0 : 0;

  function readForm() {
    const f = root.querySelector('[data-setupform]');
    const next = clone(data);
    f.querySelectorAll('[name]').forEach((inp) => {
      if (['title', 'event_id', 'track', 'notes', 'toe_front_mm', 'toe_rear_mm'].includes(inp.name)) return;
      const isText = inp.type !== 'number';
      setPath(next, inp.name, isText ? inp.value : (inp.value === '' ? '' : num(inp.value)));
    });
    return next;
  }

  /**
   * v5: "Fahrwerksgeometrie & Prüfprotokoll" (Büro-Ansicht). Gleiche Werte wie die Grafik,
   * dazu Seitendifferenz links/rechts mit Toleranzbewertung.
   */
  function renderProtocol() {
    const box = root.querySelector('[data-protocol]');
    if (!box) return;
    const d = data;
    const v = (x, digits) => (x === '' || x === null || x === undefined ? '-' : num(x).toFixed(digits).replace('.', ','));
    const diff = (a, b, tol, digits) => {
      if (a === '' || b === '' || a == null || b == null) return html`<td class="num muted">-</td><td></td>`;
      const dv = Math.abs(num(a) - num(b));
      const ok = dv <= tol + 1e-9;
      return html`<td class="num">${dv.toFixed(digits).replace('.', ',')}</td><td><span class="bz-badge ${ok ? 'ok' : 'warn'}">${ok ? 'i. O.' : 'prüfen'}</span></td>`;
    };
    const quadRow = (label, unit, o, digits, tol) => html`<tr>
      <td>${label}</td><td class="muted">${unit}</td>
      ${['fl', 'fr', 'rl', 'rr'].map((k) => html`<td class="num">${v(o[k], digits)}</td>`)}
      ${diff(o.fl, o.fr, tol, digits)}</tr>`;
    const rowAxle = (label, unit, f, r, digits = 0) => html`<tr><td>${label}</td><td class="muted">${unit}</td>
      <td class="num" colspan="2">${typeof f === 'string' && f !== '' && Number.isNaN(Number(f)) ? f : v(f, digits)}</td>
      <td class="num" colspan="2">${typeof r === 'string' && r !== '' && Number.isNaN(Number(r)) ? r : v(r, digits)}</td><td class="num muted">-</td><td></td></tr>`;
    const ack = { pro: 'Pro-Ackermann', parallel: 'Parallel', anti: 'Anti-Ackermann' }[d.steering.ackermann] || d.steering.ackermann || '-';
    setHTML(box, html`
      <div class="bz-card !mb-0">
        <div class="bz-card-head"><h3>Fahrwerksgeometrie & Prüfprotokoll<span class="hint">${vehicle.name}${vehicle.plate ? ` · ${vehicle.plate}` : ''} · ${current ? `${current.title}, ${fmtDate(current.setup_date)}` : 'nicht gespeichert'}</span></h3></div>
        <div class="bz-scroll"><table class="bz-table">
          <thead><tr><th>Messgröße</th><th>Einheit</th><th class="num">VL</th><th class="num">VR</th><th class="num">HL</th><th class="num">HR</th><th class="num">Δ L/R vorn</th><th>Bewertung</th></tr></thead>
          <tbody>
            <tr class="zone"><td colspan="8">Achsgeometrie</td></tr>
            ${quadRow('Sturz', '°', d.camber, 2, 0.3)}
            ${(() => { const tm = toeNow(); return html`<tr><td>Spur gesamt <span class="muted">(+ Vorspur)</span></td><td class="muted">mm</td><td class="num" colspan="2">${fmtMm(tm.front)}</td><td class="num" colspan="2">${fmtMm(tm.rear)}</td><td class="num muted">-</td><td></td></tr>`; })()}
            <tr><td>Nachlauf</td><td class="muted">°</td><td class="num">${v(d.caster.fl, 1)}</td><td class="num">${v(d.caster.fr, 1)}</td><td class="num muted">-</td><td class="num muted">-</td>${diff(d.caster.fl, d.caster.fr, 0.5, 1)}</tr>
            <tr class="zone"><td colspan="8">Reifenfülldruck</td></tr>
            ${quadRow('Fülldruck kalt', 'bar', d.pressure.cold, 2, 0.1)}
            ${quadRow('Fülldruck warm', 'bar', d.pressure.warm, 2, 0.1)}
            <tr class="zone"><td colspan="8">Lenkung, Dämpfung, Fahrzeughöhe <span class="font-normal">(Spalten: vorn / hinten)</span></td></tr>
            <tr><td>Lenkwinkel</td><td class="muted">°</td><td class="num" colspan="4">${v(d.steering.lock, 0)} · ${ack}${d.steering.kit ? ` · ${d.steering.kit}` : ''}</td><td class="num muted">-</td><td></td></tr>
            ${rowAxle('Dämpfer Zugstufe', 'Klicks', d.dampers.front.rebound, d.dampers.rear.rebound)}
            ${rowAxle('Dämpfer Druckstufe', 'Klicks', d.dampers.front.bump, d.dampers.rear.bump)}
            ${rowAxle('Stabilisator', 'Einst.', d.arb.front || '-', d.arb.rear || '-')}
            ${rowAxle('Fahrzeughöhe', 'mm', d.rideHeight.front, d.rideHeight.rear)}
          </tbody>
        </table></div>
        <div class="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">Toleranz Seitendifferenz: Sturz ±0,30°, Nachlauf ±0,50°, Fülldruck ±0,10 bar. Spur in mm als Summe je Achse (Spalten vorn/hinten). Werte werden im Formular rechts gepflegt.</div>
      </div>`);
  }

  /** Grafik an die aktuellen Werte anpassen (CSS-Transitions animieren das Kippen). */
  function updateVisual() {
    renderProtocol();
    const d = data;
    const front = axle === 'front';
    const cR = num(front ? d.camber.fr : d.camber.rr);
    const cL = num(front ? d.camber.fl : d.camber.rl);
    const q = (s) => root.querySelector(s);
    if (!q('[data-w="right"]')) return;
    // Viewer links = rechte Fahrzeugseite. Negativer Sturz: Oberkante kippt zur Fahrzeugmitte.
    q('[data-w="right"]').style.transform = `rotate(${-cR * CAMBER_X}deg)`;
    q('[data-w="left"]').style.transform = `rotate(${cL * CAMBER_X}deg)`;
    q('[data-val="right"]').textContent = `${front ? 'VR' : 'HR'} ${fmt(cR)}`;
    q('[data-val="left"]').textContent = `${front ? 'VL' : 'HL'} ${fmt(cL)}`;
    q('[data-axle-label]').textContent = front ? 'VORDERACHSE' : 'HINTERACHSE';

    const lock = num(d.steering.lock);
    const ack = { pro: 0.82, parallel: 1, anti: 1.12 }[d.steering.ackermann] || 1;
    const tm = toeNow();
    for (const k of ['fl', 'fr', 'rl', 'rr']) {
      const axleMm = k.startsWith('f') ? tm.front : tm.rear;
      const perWheel = Number.isFinite(Number(axleMm)) && axleMm !== null ? Number(axleMm) / 2 : 0;   // je Rad die halbe Achs-Spur
      let rot = (k.endsWith('l') ? 1 : -1) * Math.max(-TOE_MM_MAX, Math.min(TOE_MM_MAX, perWheel * TOE_MM_X));
      // Lenkeinschlag nach links: kurveninneres Rad (links) voll, äußeres je nach Ackermann
      if (steer && k.startsWith('f')) rot += -(k === 'fl' ? lock : lock * ack * 0.82);
      q(`[data-tw="${k}"]`).style.transform = `rotate(${rot}deg)`;
      q(`[data-toe="${k}"]`).textContent = axleMm === null || axleMm === undefined ? 'k. A.' : fmtMm(perWheel, 2);
      q(`[data-psi="${k}"]`).textContent = `${num(d.pressure.cold[k]).toFixed(1)} → ${num(d.pressure.warm[k]).toFixed(1)} bar`;
    }
    const sum = root.querySelector('[data-toesum]');
    if (sum) sum.textContent = `gesamt vorn ${fmtMm(tm.front)} · hinten ${fmtMm(tm.rear)}`;
    const cas = (num(d.caster.fl) + num(d.caster.fr)) / 2;
    q('[data-caster]').style.transform = `rotate(${cas}deg)`;
    q('[data-caster-val]').textContent = `${cas.toFixed(1)}°`;
    setHTML(q('[data-dampers]'), html`
      <div class="geo-title !p-0 !mb-1">DÄMPFER</div>
      ${[['Zug vorn', d.dampers.front.rebound], ['Druck vorn', d.dampers.front.bump], ['Zug hinten', d.dampers.rear.rebound], ['Druck hinten', d.dampers.rear.bump]]
        .map(([l, v]) => html`<div class="flex items-center gap-2"><span class="w-20 text-slate-400">${l}</span>${clicks(v)}<span class="font-mono text-slate-300 w-5 text-right">${v}</span></div>`)}
      <div class="text-slate-400 pt-1">Stabi: <span class="text-white">${d.arb.front || 'k. A.'}</span> / <span class="text-white">${d.arb.rear || 'k. A.'}</span></div>
      ${d.steering.kit ? html`<div class="text-slate-400">Kit: <span class="text-white">${d.steering.kit}</span> · ${lock}°</div>` : ''}`);
  }

  async function reloadList(selectId) {
    setups = await get(`/vehicles/${vehicle.id}/setups`);
    current = setups.find((s) => s.id === selectId) || setups.find((s) => s.is_current) || setups[0] || null;
    data = deepMerge(DEFAULTS, current ? current.data : {});
    loadToe();
    rating = current ? current.rating || 0 : 0;
    render();
  }

  on(root, 'input', '[data-setupform] [name]', () => { data = readForm(); updateVisual(); });
  on(root, 'change', '[data-setupform] select', () => { data = readForm(); updateVisual(); });
  on(root, 'click', '[data-axle]', (_e, b) => { axle = b.dataset.axle; root.querySelectorAll('[data-axle]').forEach((x) => x.classList.toggle('on', x === b)); updateVisual(); });
  on(root, 'click', '[data-printproto]', () => {
    document.body.classList.add('print-proto');
    window.addEventListener('afterprint', () => document.body.classList.remove('print-proto'), { once: true });
    window.print();
    setTimeout(() => document.body.classList.remove('print-proto'), 1500);
  });
  on(root, 'click', '[data-steer]', (_e, b) => { steer = !steer; b.classList.toggle('btn-amber', steer); haptic(8); updateVisual(); });
  on(root, 'click', '[data-star]', (_e, b) => {
    rating = Number(b.dataset.star) === rating ? 0 : Number(b.dataset.star);
    root.querySelectorAll('[data-star]').forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
  });
  on(root, 'click', '[data-load]', (_e, b) => {
    current = setups.find((s) => s.id === Number(b.dataset.load));
    data = deepMerge(DEFAULTS, current.data);
    loadToe();
    rating = current.rating || 0;
    render();
    toast(`Setup „${current.title}“ geladen.`);
  });
  on(root, 'click', '[data-delsetup]', async (_e, b) => {
    if (!(await confirmDialog('Setup löschen?', { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/setups/${b.dataset.delsetup}`); await reloadList(); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-makecurrent]', async () => {
    try { await post(`/setups/${current.id}/current`); toast('Als aktuelles Setup markiert.', 'ok'); await reloadList(current.id); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-save]', async (e, b) => {
    e.preventDefault();
    const f = root.querySelector('[data-setupform]');
    data = readForm();
    const payload = {
      vehicle_id: vehicle.id, title: f.title.value || 'Setup', event_id: f.event_id.value || null, track: f.track.value,
      notes: f.notes.value, rating: rating || null, data, is_current: b.dataset.save === 'new' ? !setups.length : undefined,
      toe_front_mm: f.toe_front_mm.value, toe_rear_mm: f.toe_rear_mm.value   // v5.2: Spur in mm
    };
    try {
      const saved = b.dataset.save === 'update' && current ? await put(`/setups/${current.id}`, payload) : await post('/setups', payload);
      haptic([8, 20, 8]);
      toast('Setup gespeichert.', 'ok');
      await reloadList(saved.id);
    } catch (err) { toastError(err); }
  });

  render();
}
