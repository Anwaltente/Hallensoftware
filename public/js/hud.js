/**
 * v4: HUD (permanenter Schnellzugriff) + Schwebe-Status / Hallen-Ablage
 * ------------------------------------------------------------
 * HUD in der Kopfzeile (Desktop) und als Dock über der Handy-Navigation:
 *   [⚠ KRITISCHER MANGEL ...]  [🛠️ 4 liegen rum]  [⚡ SCHNELL-VERBRAUCH]  [🔊]
 *
 * Schwebe-Status: Werkzeug, Kisten und Teile per 1 Tap auf "liegt rum" setzen
 * (jedes Element mit data-float-kind + data-float-ref wird automatisch zum Schalter).
 */
import { store, app, setState, subscribe, canEdit } from './state.js';
import { get, post, put } from './api.js';
import { $, html, setHTML, el, on, icon, toast, toastError, openModal, since } from './ui.js';
import { ratchet, levelUp, warn, tick, coin, buzz, popNumber, bump, sparks, isMuted, toggleMute, onMuteChange } from './sfx.js';

/* ---------------- Formatierung ---------------- */
export function fmtQty(n, kind = 'piece') {
  if (n === null || n === undefined) return '?';
  const v = Number(n);
  if (kind === 'fluid') return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

/* ---------------- HUD-Daten ---------------- */
let knownCrit = null;   // IDs der kritischen Artikel beim letzten Stand (für den Warnton bei neuem Mangel)

/** Neue HUD-Daten übernehmen; neuer kritischer Mangel -> Warnton + Toast */
export function applyHud(h, { silent = false } = {}) {
  if (!h) return;
  const ids = new Set((h.critical || []).map((c) => c.id));
  if (knownCrit && !silent) {
    const fresh = (h.critical || []).filter((c) => !knownCrit.has(c.id));
    if (fresh.length) {
      warn();
      buzz([80, 60, 80]);
      toast(bizView() ? `Mindestbestand unterschritten: ${fresh[0].text}` : `KRITISCHER MANGEL: ${fresh[0].text}`, 'error', 6000);
    }
  }
  knownCrit = ids;
  setState({ hud: h }, ['hud']);
}

export async function refreshHud() {
  try { applyHud(await get('/hud')); } catch { /* still */ }
}

/* ---------------- HUD rendern ---------------- */
const bizView = () => document.documentElement.classList.contains('biz');

/** v5: Büro-Ansicht: gleiche Funktionen, nüchterne Beschriftung, kein Ton-Schalter */
function bizHudHtml(mobile) {
  const h = store.hud || { critical: [], floatCount: 0 };
  const crit = (h.critical || []).length;
  const low = (h.low || []).length;
  const n = h.floatCount || 0;
  const need = (h.radarNew || 0) + (h.shoppingOpen || 0);
  const critChip = crit ? html`<button class="hud-btn hud-crit" data-hud="bizmat" title="${(h.critical || []).map((c) => c.text).join('\n')}">${icon('alert', 'w-4 h-4 shrink-0')}<span>${mobile ? 'Mindestbestand unterschritten' : 'Mindestbestand'} (${crit + low})</span></button>` : '';
  const cart = need ? html`<button class="hud-btn hud-cart ${h.radarNew ? 'has' : ''}" data-hud="cart" title="Bedarfsliste: ${h.radarNew || 0} neu ermittelt, ${h.shoppingOpen || 0} offen">${icon('list', 'w-4 h-4')}<span>Bedarf (${need})</span></button>` : '';
  const floatChip = n ? html`<button class="hud-btn hud-float has" data-hud="float" title="Betriebsmittel außerhalb des Lagerorts">${icon('package', 'w-4 h-4')}<span>${mobile ? `Offen (${n})` : `Entnahmen (${n})`}</span></button>` : '';
  const quick = canEdit() ? html`<button class="hud-btn hud-quick" data-hud="bizmat" title="Materialentnahme / Verbrauchsbeleg erfassen">${icon('edit', 'w-4 h-4')}<span>Materialentnahme</span></button>` : '';
  if (mobile) return html`${critChip}<div class="hud-row">${quick}${cart}${floatChip}</div>`;
  return html`${critChip}${cart}${floatChip}${quick}`;
}

function hudHtml(mobile) {
  if (bizView()) return bizHudHtml(mobile);
  const h = store.hud || { critical: [], floatCount: 0 };
  const crit = h.critical || [];
  const n = h.floatCount || 0;
  const critChip = crit.length ? html`
    <button class="hud-btn hud-crit" data-hud="crit" title="${crit.map((c) => c.text).join('\n')}">
      ${icon('alert', 'w-4 h-4 shrink-0')}
      ${mobile ? html`<span><b>KRITISCHER MANGEL:</b> ${crit[0].text}${crit.length > 1 ? ` (+${crit.length - 1})` : ''}</span>`
        : html`<span class="hidden min-[1800px]:inline"><b>KRITISCHER MANGEL:</b> ${crit[0].text}${crit.length > 1 ? ` (+${crit.length - 1})` : ''}</span><span class="min-[1800px]:hidden">KRITISCH${crit.length > 1 ? ` (${crit.length})` : ''}</span>`}
    </button>` : '';
  const floatChip = html`
    <button class="hud-btn hud-float ${n ? 'has' : 'none'}" data-hud="float" title="${n ? `${n} ${n === 1 ? 'Ding liegt' : 'Dinge liegen'} in der Halle rum` : 'Alles aufgeräumt'}">
      <span aria-hidden="true">🛠️</span>${mobile
        ? (n ? html`<b>${n}</b><span>rum</span>` : html`<span>✓</span>`)
        : (n ? html`<b>${n}</b><span class="hidden xl:inline">${n === 1 ? 'liegt rum' : 'liegen rum'}</span>` : html`<span class="hidden xl:inline">aufgeräumt</span>`)}
    </button>`;
  const quick = canEdit() ? html`
    <button class="hud-btn hud-quick" data-hud="quick" title="Schnell-Verbrauch: Öl, Kühlmittel, Bremsenreiniger ... in zwei Taps austragen">
      <span class="bolt" aria-hidden="true">⚡</span><span>${mobile ? 'Schnell-Verbrauch' : html`<span class="hidden xl:inline">Schnell-</span>Verbrauch`}</span>
    </button>` : '';
  // v4.2: Einkaufs-Radar (Kritische Liste + Kühlschrank unter Soll) und offene Einkaufsliste
  const radarNew = h.radarNew || 0;
  const listOpen = h.shoppingOpen || 0;
  const cart = (radarNew || listOpen) ? html`
    <button class="hud-btn hud-cart ${radarNew ? 'has' : ''}" data-hud="cart" title="Demnächst einkaufen: ${radarNew} neu im Mangel-Radar, ${listOpen} auf der Einkaufsliste">
      <span aria-hidden="true">🛒</span><b>${radarNew + listOpen}</b>${mobile ? '' : html`<span class="hidden xl:inline">einkaufen</span>`}
    </button>` : '';
  const mute = html`<button class="hud-btn hud-mute ${isMuted() ? 'off' : ''}" data-hud="mute" title="${isMuted() ? 'Ton ist aus' : 'Ton ist an'} (Klick zum Umschalten)">${isMuted() ? '🔇' : '🔊'}</button>`;
  if (mobile) return html`${critChip}<div class="hud-row">${quick}${cart}${floatChip}${mute}</div>`;
  return html`${critChip}${cart}${floatChip}${quick}${mute}`;
}

function renderHud() {
  const d = $('#hud');
  const m = $('#hudDock');
  if (d) setHTML(d, hudHtml(false));
  if (m) {
    setHTML(m, hudHtml(true));
    // Toasts am Handy über dem Dock anzeigen
    requestAnimationFrame(() => document.documentElement.style.setProperty('--dock-h', `${m.offsetHeight || 0}px`));
  }
}

export function initHud() {
  const handler = (_e, b) => {
    const a = b.dataset.hud;
    if (a === 'mute') { toggleMute(); buzz(10); return; }
    tick(); buzz(12);
    if (a === 'bizmat') { if (app.bizTab) app.bizTab('material'); return; }
    if (a === 'quick') app.openQuickUse && app.openQuickUse();
    if (a === 'float') openFloatDrawer();
    if (a === 'crit' || a === 'cart') app.openQuickUse && app.openQuickUse({ tab: 'shop' });
  };
  [$('#hud'), $('#hudDock')].forEach((root) => root && on(root, 'click', '[data-hud]', handler));
  subscribe('hud', renderHud);
  subscribe('me', renderHud);
  subscribe('biz', renderHud);   // v5
  onMuteChange(renderHud);
  initFloatButtons();
  renderHud();
}

/* ====================================================================== */
/* Schwebe-Status                                                         */
/* ====================================================================== */
const KIND_ICON = { tool: 'wrench', box: 'box', part: 'package', other: 'move' };
const KIND_LABEL = { tool: 'Werkzeug', box: 'Kiste', part: 'Teil', other: 'Sonstiges' };

/** Ist ein Werkzeug/eine Kiste/ein Teil gerade in der Schwebe? */
export function floatOf(kind, refId) {
  return ((store.hud && store.hud.floating) || []).find((f) => f.kind === kind && Number(f.ref_id) === Number(refId)) || null;
}

/** Ortswahl: Stellplätze, Bühnen, Werkbank, Autos oder Freitext */
export function chooseSpot(title = 'Wo liegt es?') {
  return new Promise((resolve) => {
    let answered = false;
    const objs = store.objects.filter((o) => ['slot', 'workbench', 'toolwall', 'zone', 'shelf'].includes(o.type) && (o.label || o.code));
    const cars = store.vehicles.filter((v) => v.slot_id);
    const m = openModal({
      title, subtitle: 'Optional: hilft beim Wiederfinden und Aufräumen', size: 'md', iconName: 'target',
      body: html`
        <div class="label">In der Halle</div>
        <div class="flex flex-wrap gap-2 mb-4">${objs.map((o) => html`<button class="chip chip-btn" data-obj="${o.id}">${o.code && o.type === 'slot' ? `${o.code} · ` : ''}${o.label || o.code}</button>`)}</div>
        ${cars.length ? html`<div class="label">An einem Auto</div>
        <div class="flex flex-wrap gap-2 mb-4">${cars.map((v) => html`<button class="chip chip-btn" data-veh="${v.id}">${icon('car', 'w-3.5 h-3.5')} ${v.name}</button>`)}</div>` : ''}
        <form class="flex gap-2" data-free><input class="input flex-1" name="spot" placeholder="Eigener Ort, z. B. vor dem Rolltor"><button class="btn btn-primary">OK</button></form>
        <button class="btn btn-ghost w-full mt-3 text-slate-400" data-none>Einfach irgendwo in der Halle</button>`,
      onClose: () => { if (!answered) resolve(null); }
    });
    const done = (v) => { answered = true; resolve(v); m.close(); };
    on(m.body, 'click', '[data-obj]', (_e, b) => done({ object_id: Number(b.dataset.obj) }));
    on(m.body, 'click', '[data-veh]', (_e, b) => done({ vehicle_id: Number(b.dataset.veh) }));
    on(m.body, 'click', '[data-none]', () => done({}));
    m.body.querySelector('[data-free]').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.spot.value.trim(); if (v) done({ spot: v }); });
  });
}

/** 1 Tap: Status "In der Schwebe" setzen (Ratsche!), Ort optional nachtragen */
export async function markFloating(kind, refId, anchor = null, { label = null, place = null } = {}) {
  if (!canEdit()) { toast('Nur-Lese-Modus.', 'warn'); return null; }
  ratchet();
  buzz([30, 20, 30]);
  if (anchor) { bump(anchor); popNumber('IN DER SCHWEBE', anchor, { color: '#fbbf24' }); }
  try {
    const res = await post('/floating', { kind, ref_id: refId, label, ...(place || {}) });
    applyHud(res.hud, { silent: true });
    const item = res.item;
    if (item && !place) {
      toast(`${item.label} liegt jetzt rum.`, 'warn', 5200, {
        label: 'Wo?',
        onClick: async () => {
          const p = await chooseSpot(`Wo liegt „${item.label}“?`);
          if (!p) return;
          try { const r = await put(`/floating/${item.id}`, p); applyHud(r.hud, { silent: true }); tick(); toast('Ort gemerkt.', 'ok'); } catch (err) { toastError(err); }
        }
      });
    }
    return item;
  } catch (err) { toastError(err); return null; }
}

/** Ein Ding zurück ins Fach (Erfolgs-Sound, beim letzten Teil: Level-Up) */
export async function returnFloating(f, rowEl = null) {
  try {
    if (rowEl) rowEl.classList.add('fly-home');
    const res = f.source === 'borrow' ? await post(`/tools/${f.ref_id}/return`) : await post(`/floating/${f.id}/return`);
    const h = res.hud || await get('/hud');
    applyHud(h, { silent: true });
    if (!h.floatCount) celebrateClean(rowEl);
    else { coin(); buzz(15); }
    return h;
  } catch (err) { if (rowEl) rowEl.classList.remove('fly-home'); toastError(err); return null; }
}

function celebrateClean(anchor) {
  levelUp();
  buzz([30, 30, 30, 30, 90]);
  sparks(anchor || document.body);
  popNumber('ALLES AUFGERÄUMT!', anchor || null, { color: '#a3e635', big: true });
}

/** Globale 1-Tap-Schalter: <button data-float-kind="tool" data-float-ref="12"> */
function initFloatButtons() {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-float-kind]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();   // nicht zusätzlich die Zeile öffnen
    const kind = b.dataset.floatKind;
    const ref = Number(b.dataset.floatRef);
    const cur = floatOf(kind, ref);
    const label = (txt) => { const s = b.querySelector('span'); if (s) s.textContent = txt; };
    if (cur) { const h = await returnFloating(cur, null); if (h) { b.classList.remove('on'); label('Rausgeholt'); if (h.floatCount) toast(`${cur.label}: wieder im Fach.`, 'ok'); } return; }
    const item = await markFloating(kind, ref, b);
    if (item) { b.classList.add('on'); label('liegt rum'); }
  }, true);
}

/* ---------------- Hallen-Ablage (Clean-Up Drawer) ---------------- */
export async function openFloatDrawer() {
  let items = [];
  let q = '';
  let candidates = [];
  const body = el(html`<div><div data-head></div><div class="space-y-2 mt-4" data-list></div><div class="mt-6" data-add></div></div>`);
  const m = openModal({ title: 'Hallen-Ablage', subtitle: 'Was liegt gerade rum? Zurück ins Fach mit einem Tap.', size: 'lg', iconName: 'wrench', body });
  const head = body.querySelector('[data-head]');
  const list = body.querySelector('[data-list]');
  const add = body.querySelector('[data-add]');

  const placeLine = (f) => {
    if (f.spot) return f.source === 'borrow' ? `in Benutzung ${f.spot}` : `liegt ${f.spot}`;
    return 'Ort unbekannt';
  };

  function renderHead() {
    const n = items.length;
    setHTML(head, html`
      <div class="flex items-center gap-4 flex-wrap">
        <div class="float-count ${n ? '' : 'zero'}">${n}</div>
        <div class="flex-1 min-w-[10rem]">
          <div class="font-display font-bold text-white text-lg">${n ? `${n === 1 ? 'Ding liegt' : 'Dinge liegen'} in der Halle rum` : 'Alles aufgeräumt!'}</div>
          <div class="text-xs text-slate-400">${n ? 'Tippe auf „Liegt wieder im Fach“, sobald es zurück ist.' : 'Saubere Halle, glückliche Schrauber.'}</div>
        </div>
        ${canEdit() && n ? html`<button class="btn btn-lime !py-3 !px-5 text-base" data-allback>${icon('check', 'w-5 h-5')} Alles zurückgeräumt</button>` : ''}
      </div>`);
  }

  function renderList() {
    setHTML(list, html`${items.map((f) => html`
      <div class="float-row" data-row="${f.id}">
        <div class="ico">${icon(KIND_ICON[f.kind] || 'move', 'w-5 h-5')}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white truncate">${f.label} <span class="text-[10px] font-display tracking-wider text-slate-500 uppercase">${KIND_LABEL[f.kind] || ''}</span></div>
          <div class="text-sm ${f.spot ? 'text-amber-200' : 'text-slate-500'} truncate">${icon('target', 'w-3.5 h-3.5 inline')} ${placeLine(f)}
            ${canEdit() && f.source === 'float' ? html`<button class="text-cyan-300 text-xs ml-1 underline" data-spot="${f.id}">${f.spot ? 'ändern' : 'Ort angeben'}</button>` : ''}</div>
          <div class="text-[11px] text-slate-500 truncate">${f.user_name || '?'} · ${f.created_at ? since(f.created_at) : ''}${f.home ? html` · <span class="text-slate-400">zurück nach ${f.home}</span>` : ''}</div>
        </div>
        ${canEdit() ? html`<button class="btn btn-sm btn-primary shrink-0 !py-2" data-back="${f.id}">${icon('check', 'w-3.5 h-3.5')} <span class="hidden sm:inline">Liegt wieder im Fach</span><span class="sm:hidden">Zurück</span></button>` : ''}
      </div>`)}
      ${!items.length ? html`<div class="card p-6 text-center text-lime-300 font-display tracking-wider">🧹 Nichts liegt rum.</div>` : ''}`);
  }

  function renderAdd() {
    if (!canEdit()) { setHTML(add, ''); return; }
    setHTML(add, html`
      <div class="qu-section">ETWAS RAUSGEHOLT?</div>
      <div class="relative"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">${icon('search')}</span>
        <input class="input !pl-9" placeholder="Werkzeug, Kiste oder Teil suchen …" value="${q}" data-q></div>
      <div class="grid sm:grid-cols-2 gap-2 mt-2" data-cands>${candidates.map((c) => html`
        <button class="card card-hover px-3 py-2 text-left flex items-center gap-2 ${c.floating ? 'opacity-50' : ''}" data-cand="${c.kind}:${c.ref_id}" ${c.floating ? 'disabled' : ''}>
          <span class="text-amber-300">${icon(KIND_ICON[c.kind], 'w-4 h-4')}</span>
          <span class="flex-1 min-w-0"><span class="block text-sm text-white truncate">${c.label}</span><span class="block text-[11px] text-slate-500">${c.floating ? 'liegt schon rum' : c.sub || KIND_LABEL[c.kind]}</span></span>
          <span class="chip !text-[10px]">${icon('plus', 'w-3 h-3')}</span>
        </button>`)}</div>
      <form class="flex gap-2 mt-3" data-other><input class="input flex-1" name="label" placeholder="Anderes Ding, z. B. Wagenheber"><button class="btn">${icon('plus')} Liegt rum</button></form>`);
  }

  async function load() {
    try { const r = await get('/floating'); items = r.items; } catch (err) { toastError(err); }
    renderHead(); renderList();
  }
  async function search() {
    if (!q.trim()) candidates = [];
    else { try { candidates = (await get(`/floating/candidates?q=${encodeURIComponent(q)}`)).slice(0, 10); } catch { candidates = []; } }
    const pos = add.querySelector('[data-q]') ? add.querySelector('[data-q]').selectionStart : null;
    renderAdd();
    const inp = add.querySelector('[data-q]');
    if (inp && pos !== null) { inp.focus(); inp.setSelectionRange(pos, pos); }
  }

  on(head, 'click', '[data-allback]', async (_e, b) => {
    try {
      list.querySelectorAll('.float-row').forEach((r, i) => setTimeout(() => r.classList.add('fly-home'), i * 70));
      const res = await post('/floating/return-all');
      applyHud(res.hud, { silent: true });
      setTimeout(() => { celebrateClean(b); items = []; renderHead(); renderList(); search(); }, Math.min(600, 120 + items.length * 70));
    } catch (err) { toastError(err); load(); }
  });
  on(list, 'click', '[data-back]', async (_e, b) => {
    const f = items.find((x) => String(x.id) === b.dataset.back);
    const row = b.closest('.float-row');
    const h = await returnFloating(f, row);
    if (h) setTimeout(() => { items = items.filter((x) => x !== f); renderHead(); renderList(); }, 480);
  });
  on(list, 'click', '[data-spot]', async (_e, b) => {
    const f = items.find((x) => String(x.id) === b.dataset.spot);
    const p = await chooseSpot(`Wo liegt „${f.label}“?`);
    if (!p) return;
    try { const r = await put(`/floating/${f.id}`, p); applyHud(r.hud, { silent: true }); items = r.items; tick(); renderList(); } catch (err) { toastError(err); }
  });
  on(add, 'input', '[data-q]', (_e, inp) => { q = inp.value; clearTimeout(add._t); add._t = setTimeout(search, 220); });
  on(add, 'click', '[data-cand]', async (_e, b) => {
    const [kind, ref] = b.dataset.cand.split(':');
    const c = candidates.find((x) => x.kind === kind && String(x.ref_id) === ref);
    const p = await chooseSpot(`Wo liegt „${c.label}“?`);
    if (p === null) return;
    const item = await markFloating(kind, Number(ref), b, { place: p });
    if (item) { await load(); search(); }
  });
  add.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-other]')) return;
    e.preventDefault();
    const label = e.target.label.value.trim();
    if (!label) return;
    const p = await chooseSpot(`Wo liegt „${label}“?`);
    if (p === null) return;
    const item = await markFloating('other', null, e.target.querySelector('button'), { label, place: p });
    if (item) { e.target.reset(); await load(); }
  });

  renderHead(); renderAdd();
  await load();
  search();
  return m;
}

/* Kleine Hilfe für andere Module: Button-Markup für den 1-Tap-Schalter */
export function floatBtn(kind, refId, { small = false, text = true } = {}) {
  if (!canEdit()) return '';
  const on_ = !!floatOf(kind, refId);
  return html`<button class="btn ${small ? 'btn-sm !px-2' : 'btn-sm'} btn-float ${on_ ? 'on' : ''}" data-float-kind="${kind}" data-float-ref="${refId}"
    title="${on_ ? 'Liegt rum: antippen, wenn es wieder im Fach ist' : 'In der Schwebe: rausgeholt, liegt in der Halle'}">🛠️${text ? html` <span>${on_ ? 'liegt rum' : 'Rausgeholt'}</span>` : ''}</button>`;
}

