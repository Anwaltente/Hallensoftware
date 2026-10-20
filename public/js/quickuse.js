/**
 * v4: SCHNELL-VERBRAUCH (Zwei-Tap-Verbrauchs-Hub)
 * ------------------------------------------------------------
 * Tap 1: HUD-Button "⚡ Schnell-Verbrauch"   Tap 2: Menge auf der Kachel (-0,5 L / -1 Stk / Angebrochenes leer!)
 * - v4.2: Der Bestand ist die Summe aller verknüpften Gebinde im Inventar (Regal, Ebene, Box).
 *         Abgezogen wird zuerst aus angebrochenen, dann aus den kleinsten Gebinden. Nachschub nur per "Einlagern" mit Lagerort.
 * - Optional "Buchen auf": Halle / Allgemein oder ein Auto (landet dann im Wartungsheft inkl. Kosten)
 * - Jede Buchung mit Rückgängig, Sound (Pfft-Klack), Vibration und schwebender Zahl
 * - Reiter Einkauf: Einkaufs-Radar (Kritische Liste + Kühlschrank unter Soll), Hallen-Einkaufsliste, Auto-Einkäufe
 */
import { store, app, canEdit } from './state.js';
import { get, post, put } from './api.js';
import { html, setHTML, el, on, icon, toast, toastError, openModal, since, euro, fmtDateTime, formData, confirmDialog } from './ui.js';
import { pfftKlack, warn, tick, coin, levelUp, buzz, popNumber, bump, sparks } from './sfx.js';
import { applyHud, fmtQty } from './hud.js';

const TARGET_KEY = 'halle.qu.target';
const TARGET_TTL = 2 * 3600 * 1000;   // Fahrzeug-Auswahl gilt 2 Stunden, danach wieder "Halle"

function loadTarget() {
  try {
    const t = JSON.parse(localStorage.getItem(TARGET_KEY) || 'null');
    if (t && Date.now() - t.at < TARGET_TTL && store.vehicles.some((v) => v.id === t.id)) return t.id;
  } catch { /* egal */ }
  return null;
}
function saveTarget(id) {
  try { localStorage.setItem(TARGET_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* egal */ }
}

const amountLabel = (n, c) => `${fmtQty(n, c.kind)} ${c.unit}`;

/* ---------------- Kachel ---------------- */
function tileHtml(c) {
  const steps = c.steps.length ? c.steps : [1];
  return html`
    <div class="qu-tile" data-cid="${c.id}">
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="qu-name">${c.name}</div>
          <div class="flex flex-wrap gap-1 mt-1.5 min-h-[18px]" data-badges></div>
        </div>
        <div class="text-right shrink-0"><div class="qu-qty" data-qty></div><div class="qu-unit">${c.unit}</div></div>
      </div>
      <div class="tank ${c.kind}" data-tank><span></span><i></i></div>
      <div class="flex justify-between text-[10.5px] text-slate-500 mt-1"><span data-min></span><span data-cont></span></div>
      <div class="qu-btns" style="--n:${Math.min(steps.length, 4)}">
        ${steps.map((s) => html`<button class="qu-btn" data-use="${s}" ${canEdit() ? '' : 'disabled'}>-${amountLabel(s, c)}</button>`)}
        <button class="qu-btn empty" data-empty ${canEdit() ? '' : 'disabled'}></button>
      </div>
      <div class="qu-tools">
        <button class="btn btn-sm" data-gebinde title="Alle Gebinde im Lager mit Lagerort">${icon('package', 'w-3.5 h-3.5')} Gebinde <span data-gcount></span></button>
        ${canEdit() ? html`<button class="btn btn-sm" data-stockin title="Gekauft? Mit Lagerort einlagern">${icon('plus', 'w-3.5 h-3.5')} Einlagern</button>` : ''}
      </div>
      <div class="qu-last" data-last></div>
    </div>`;
}

function paintTile(tile, c) {
  if (!tile) return;
  tile.classList.toggle('is-crit', c.crit);
  tile.classList.toggle('is-low', c.low && !c.crit);
  tile.classList.toggle('is-unknown', c.unknown);
  const badges = [];
  if (c.crit) badges.push(html`<span class="qu-badge crit">${icon('alert', 'w-3 h-3')} KRITISCH</span>`);
  else if (c.low) badges.push(html`<span class="qu-badge low">FAST LEER</span>`);
  if (c.critical && !c.crit) badges.push(html`<span class="qu-badge must">DARF NIE AUSGEHEN</span>`);
  if (c.unknown) badges.push(html`<span class="qu-badge must !text-slate-300 !border-slate-500/50 !bg-slate-500/10">BESTAND ?</span>`);
  setHTML(tile.querySelector('[data-badges]'), html`${badges}`);
  tile.querySelector('[data-qty]').textContent = c.unknown ? '?' : fmtQty(c.qty, c.kind);
  const max = Math.max((c.min_qty || 0) * 2, c.qty || 0, 1);
  const tank = tile.querySelector('[data-tank]');
  tank.classList.toggle('low', c.low && !c.crit);
  tank.classList.toggle('crit', c.crit);
  tank.querySelector('span').style.width = c.unknown ? '0%' : `${Math.min(100, ((c.qty || 0) / max) * 100)}%`;
  const marker = tank.querySelector('i');
  marker.style.display = c.min_qty > 0 ? '' : 'none';
  marker.style.left = `${Math.min(99, (c.min_qty / max) * 100)}%`;
  tile.querySelector('[data-min]').textContent = c.min_qty > 0 ? `mind. ${amountLabel(c.min_qty, c)}` : '';
  tile.querySelector('[data-cont]').textContent = c.breakdown || (c.unknown ? 'kein Gebinde im Inventar' : 'alle Gebinde leer');
  const eb = tile.querySelector('[data-empty]');
  eb.textContent = c.emptyAmount ? `Angebrochenes leer! (-${amountLabel(c.emptyAmount, c)})` : 'Nichts angebrochen';
  eb.disabled = !canEdit() || !c.emptyAmount;
  const gc = tile.querySelector('[data-gcount]');
  if (gc) gc.textContent = c.stock && c.stock.length ? `(${c.stock.length})` : '';
  const l = c.last;
  tile.querySelector('[data-last]').textContent = l
    ? `zuletzt ${l.user_name || '?'}: ${l.kind === 'count' ? 'Inventur' : `${l.delta > 0 ? '+' : ''}${amountLabel(l.delta, c)}`}${l.vehicle_name ? ` → ${l.vehicle_name}` : ''} · ${since(l.created_at)}`
    : (c.unknown ? 'Noch kein Gebinde im Inventar: „Einlagern“ antippen oder ein Teil im Lager zuordnen.' : '');
}

/* ====================================================================== */
/* v4.2: Gebinde im Lager + Einlagern (Nachschub nur mit Lagerort)        */
/* ====================================================================== */
const fmtN = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Lagerort-Auswahl (Regal, Ebene, Box) als Formular-Block */
async function locationFields(prefix = '') {
  let boxes = [];
  try { boxes = await get('/boxes'); } catch { /* egal */ }
  const shelves = store.objects.filter((o) => o.type === 'shelf');
  const frag = html`<div class="grid grid-cols-3 gap-2" data-loc>
    <label><span class="label">Regal</span><select class="select" name="${prefix}shelf_id" data-shelf><option value="">ohne</option>${shelves.map((sh) => html`<option value="${sh.id}">${sh.code}</option>`)}</select></label>
    <label><span class="label">Ebene</span><select class="select" name="${prefix}level" data-level><option value="">keine</option></select></label>
    <label><span class="label">Box</span><select class="select" name="${prefix}box_id" data-box><option value="">lose</option></select></label>
  </div>`;
  const bind = (root) => {
    const sh = root.querySelector('[data-shelf]'); const lv = root.querySelector('[data-level]'); const bx = root.querySelector('[data-box]');
    const fill = () => {
      const s = shelves.find((x) => x.id === Number(sh.value));
      const n = s ? Number(s.props.levels) || 4 : 0;
      const keep = lv.value;
      setHTML(lv, html`<option value="">keine</option>${Array.from({ length: n }, (_, i) => html`<option value="${i + 1}" ${Number(keep) === i + 1 ? 'selected' : ''}>Ebene ${i + 1}</option>`)}`);
      const list = boxes.filter((b) => b.shelf_id === Number(sh.value) && (!lv.value || b.level === Number(lv.value)));
      setHTML(bx, html`<option value="">lose</option>${list.map((b) => html`<option value="${b.id}">${b.label} (E${b.level})</option>`)}`);
    };
    sh.addEventListener('change', () => { lv.value = ''; fill(); });
    lv.addEventListener('change', fill);
  };
  return { frag, bind };
}

/**
 * Nach dem Einkauf einlagern: bestehendes Gebinde +N (Lagerort bleibt) oder neues Gebinde mit Lagerort anlegen.
 * Gibt die aktualisierte Kategorie zurück (oder null).
 */
export async function openStockIn(c, { listId = null, anchor = null } = {}) {
  const loc = await locationFields('');
  return new Promise((resolve) => {
    let done = false;
    const rows = c.stock || [];
    const m = openModal({
      title: `Einlagern: ${c.name}`, subtitle: 'Nachschub kommt immer mit Lagerort ins Inventar', size: 'md', iconName: 'package',
      body: html`
        ${rows.length ? html`<div class="label">Zu einem vorhandenen Gebinde dazulegen</div>
          <div class="space-y-1.5 mb-4">${rows.map((r) => html`
            <div class="card px-3 py-2 flex items-center gap-2">
              <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${r.name}</div>
                <div class="text-[11px] text-slate-400">${fmtN(r.pack_size)} ${c.unit} je Gebinde · ${r.qty}× da · ${r.location}</div></div>
              <input class="input !w-16 !py-1 text-center font-mono" type="number" min="1" value="1" data-addn="${r.id}">
              <button class="btn btn-sm btn-lime" data-addto="${r.id}">${icon('plus', 'w-3.5 h-3.5')} dazu</button>
            </div>`)}</div>` : ''}
        <div class="label">${rows.length ? 'Oder neues Gebinde anlegen' : 'Neues Gebinde anlegen'}</div>
        <form class="space-y-2" data-new>
          <div class="grid grid-cols-3 gap-2">
            <label class="col-span-3"><span class="label">Bezeichnung</span><input class="input" name="name" placeholder="z. B. ${c.name} (5 L Kanister)"></label>
            <label><span class="label">Anzahl</span><input class="input font-mono" type="number" min="1" name="qty" value="1" required></label>
            <label><span class="label">Gebindemenge (${c.unit})</span><input class="input font-mono" type="number" min="0" step="0.01" name="pack_size" required placeholder="${c.kind === 'fluid' ? 'z. B. 5' : 'z. B. 1'}"></label>
            <div class="self-end text-xs text-cyan-200 pb-2" data-sum></div>
          </div>
          ${loc.frag}
          <button class="btn btn-primary w-full">${icon('check')} Einlagern</button>
        </form>`,
      onClose: () => { if (!done) resolve(null); }
    });
    loc.bind(m.body);
    const f = m.body.querySelector('[data-new]');
    const sum = () => { const q = Number(f.qty.value) || 0; const p = Number(f.pack_size.value) || 0; m.body.querySelector('[data-sum]').textContent = p ? `= ${fmtN(q * p)} ${c.unit}` : ''; };
    f.addEventListener('input', sum);
    const finish = (res) => {
      done = true;
      coin(); buzz([20, 30, 20]);
      popNumber(`+${fmtN(res.item.qty - (c.qty || 0))} ${c.unit}`, anchor || m.body, { color: '#22d3ee' });
      applyHud(res.hud, { silent: true });
      if (c.crit && !res.item.crit) { levelUp(); sparks(anchor || document.body); toast(`${c.name} wieder über Soll. Notfall vorbei!`, 'ok'); }
      else toast(`${c.name} eingelagert. Bestand jetzt ${fmtN(res.item.qty)} ${c.unit}.`, 'ok');
      resolve(res.item); m.close();
    };
    on(m.body, 'click', '[data-addto]', async (_e, b) => {
      const n = Number(m.body.querySelector(`[data-addn="${b.dataset.addto}"]`).value) || 1;
      try { finish(await post(`/consumables/${c.id}/stock-in`, { part_id: Number(b.dataset.addto), add: n, list_id: listId })); } catch (err) { toastError(err); }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(f);
      try { finish(await post(`/consumables/${c.id}/stock-in`, { create: d, list_id: listId })); } catch (err) { toastError(err); }
    });
  });
}

/** Alle Gebinde einer Kategorie mit Lagerort, +/- und angebrochenem Rest */
export async function openGebinde(cid, { onChange = null } = {}) {
  let c;
  try { c = await get(`/consumables/${cid}/stock`); } catch (err) { toastError(err); return; }
  const body = el(html`<div data-g></div>`);
  const m = openModal({ title: `Gebinde: ${c.name}`, subtitle: 'Ist-Bestand = Summe aller Gebinde in der Halle', size: 'md', iconName: 'package', body });
  const render = () => {
    setHTML(body, html`
      <div class="dims-result mb-3"><span class="text-[11px] uppercase tracking-[0.15em] text-slate-400 font-display">Gesamt</span>
        <b>${c.unknown ? '?' : `${fmtN(c.qty)} ${c.unit}`}</b><span class="text-[11px] text-slate-500">Soll mindestens ${fmtN(c.min_qty)} ${c.unit}${c.breakdown ? ` · ${c.breakdown}` : ''}</span></div>
      <div class="space-y-2">${(c.stock || []).map((r) => html`
        <div class="card px-3 py-2.5" data-row="${r.id}">
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${r.name}</div>
              <div class="text-[11px] text-slate-400">${fmtN(r.pack_size)} ${c.unit} je Gebinde · <span class="${r.location === 'ohne Lagerort' ? 'text-amber-300' : ''}">${r.location}</span></div></div>
            <span class="font-mono text-cyan-200 text-sm shrink-0">${fmtN(r.content)} ${c.unit}</span>
          </div>
          ${canEdit() ? html`<div class="flex flex-wrap items-center gap-1.5 mt-2">
            <button class="btn btn-sm" data-dq="-1" ${r.qty ? '' : 'disabled'}>-1</button>
            <span class="font-mono text-sm w-10 text-center">${r.qty}×</span>
            <button class="btn btn-sm" data-dq="1">+1</button>
            <label class="flex items-center gap-1 text-[11px] text-slate-400 ml-2">angebrochen, Rest
              <input class="input !w-20 !py-1 font-mono text-sm" type="number" min="0" step="0.01" value="${r.open_rest ?? ''}" placeholder="voll" data-rest></label>
            ${r.shelf_id ? html`<button class="btn btn-sm ml-auto" data-goto="${r.shelf_id}" data-level="${r.level || ''}" data-box="${r.box_id || ''}">${icon('target', 'w-3.5 h-3.5')} Regal</button>` : ''}
          </div>` : ''}
        </div>`)}
        ${!(c.stock || []).length ? html`<p class="text-sm text-slate-400">Noch kein Gebinde im Inventar. Entweder „Einlagern“ oder ein vorhandenes Teil im Lager dieser Kategorie zuordnen (Teil bearbeiten, „Gehört zu“).</p>` : ''}
      </div>
      ${canEdit() ? html`<button class="btn btn-primary w-full mt-4" data-in>${icon('plus')} Einlagern</button>` : ''}`);
  };
  const reload = async () => { c = await get(`/consumables/${cid}/stock`); render(); if (onChange) onChange(c); if (app.refreshHud) app.refreshHud(); };
  on(body, 'click', '[data-dq]', async (_e, b) => {
    const r = c.stock.find((x) => x.id === Number(b.closest('[data-row]').dataset.row));
    try { await put(`/parts/${r.id}`, { qty: Math.max(0, r.qty + Number(b.dataset.dq)) }); tick(); buzz(8); await reload(); } catch (err) { toastError(err); }
  });
  on(body, 'change', '[data-rest]', async (_e, inp) => {
    const r = c.stock.find((x) => x.id === Number(inp.closest('[data-row]').dataset.row));
    try { await put(`/parts/${r.id}`, { open_rest: inp.value === '' ? null : inp.value }); tick(); await reload(); } catch (err) { toastError(err); }
  });
  on(body, 'click', '[data-goto]', (_e, b) => { m.close(); app.navigate({ kind: 'shelf', shelfId: Number(b.dataset.goto), level: Number(b.dataset.level) || null, boxId: Number(b.dataset.box) || null }); });
  on(body, 'click', '[data-in]', async (_e, b) => { const item = await openStockIn(c, { anchor: b }); if (item) await reload(); });
  render();
}

/* ====================================================================== */
export async function openQuickUse({ tab = 'use' } = {}) {
  let items = [];
  let target = loadTarget();
  let current = tab;
  const body = el(html`
    <div class="-mx-5 -my-4">
      <div class="sticky top-0 z-10 bg-[#121821] border-b border-white/10 px-4 pt-3 pb-2 space-y-2">
        <div class="flex items-center gap-2"><span class="font-display text-[10px] font-bold tracking-[0.2em] text-slate-400 shrink-0">BUCHEN AUF</span><div class="qu-target flex-1" data-target></div></div>
        <nav class="tabs" data-tabs></nav>
      </div>
      <div class="px-4 py-4" data-content></div>
    </div>`);
  const m = openModal({ title: '⚡ Schnell-Verbrauch', subtitle: 'Menge antippen, fertig. Der Bestand kommt aus allen Gebinden im Lager und sinkt live mit.', size: 'full', body });
  const targetEl = body.querySelector('[data-target]');
  const tabsEl = body.querySelector('[data-tabs]');
  const content = body.querySelector('[data-content]');

  function renderTarget() {
    const cars = [...store.vehicles].sort((a, b) => (!!b.slot_id - !!a.slot_id) || a.name.localeCompare(b.name));
    setHTML(targetEl, html`
      <button class="chip chip-btn ${!target ? 'on' : ''}" data-tg="">🏠 Halle / Allgemein</button>
      ${cars.map((v) => html`<button class="chip chip-btn ${target === v.id ? 'on' : ''}" data-tg="${v.id}">${icon('car', 'w-3.5 h-3.5')} ${v.name}</button>`)}`);
  }

  function renderTabs(shopCount = null) {
    const sc = shopCount ?? ((store.hud && (store.hud.radarNew || 0) + (store.hud.shoppingOpen || 0)) || 0);
    setHTML(tabsEl, html`
      <button class="tab ${current === 'use' ? 'active' : ''}" data-t="use">${icon('zap', 'w-3.5 h-3.5')} Verbrauch</button>
      <button class="tab ${current === 'shop' ? 'active' : ''}" data-t="shop">${icon('list', 'w-3.5 h-3.5')} Einkauf ${sc ? html`<span class="chip !py-0 !text-[10px] ${(store.hud && store.hud.critical.length) ? '!bg-rose-600 !text-white !border-rose-400' : ''}">${sc}</span>` : ''}</button>
      <button class="tab ${current === 'log' ? 'active' : ''}" data-t="log">${icon('clock', 'w-3.5 h-3.5')} Verlauf</button>`);
  }

  /* ---------- Reiter: Verbrauch ---------- */
  async function renderUse() {
    try { items = await get('/consumables'); } catch (err) { toastError(err); return; }
    const crit = items.filter((c) => c.crit);
    const unknownCrit = items.filter((c) => c.critical && c.unknown);
    const fluids = items.filter((c) => c.kind === 'fluid');
    const pieces = items.filter((c) => c.kind !== 'fluid');
    setHTML(content, html`
      ${crit.map((c) => html`<div class="crit-banner mb-2">${icon('alert', 'w-5 h-5 shrink-0')}<span><b>KRITISCHER MANGEL:</b> ${c.qty <= 0 ? `${c.name} ist LEER!` : `Nur noch ${amountLabel(c.qty, c)} ${c.name} vorhanden!`}</span></div>`)}
      ${unknownCrit.length ? html`<div class="low-banner !text-amber-100 !bg-amber-400/10 !border-amber-400/40 mb-3">${icon('list', 'w-4 h-4')} ${unknownCrit.length} Artikel, die nie ausgehen dürfen, haben noch kein Gebinde im Inventar: „Einlagern“ antippen oder vorhandene Teile im Lager zuordnen, dann wacht das Notfall-Radar.</div>` : ''}
      ${fluids.length ? html`<div class="qu-section">FLÜSSIGKEITEN</div><div class="qu-grid mb-6">${fluids.map(tileHtml)}</div>` : ''}
      ${pieces.length ? html`<div class="qu-section">VERBRAUCHSMATERIAL</div><div class="qu-grid">${pieces.map(tileHtml)}</div>` : ''}
      ${!items.length ? html`<div class="card p-6 text-center text-slate-400">Noch keine Verbrauchsartikel. Admin-Konsole → „Verbrauch & Kritisch“.</div>` : ''}`);
    items.forEach((c) => paintTile(content.querySelector(`[data-cid="${c.id}"]`), c));
  }

  const itemOf = (tile) => items.find((x) => x.id === Number(tile.dataset.cid));
  const replaceItem = (c) => { items = items.map((x) => (x.id === c.id ? c : x)); paintTile(content.querySelector(`[data-cid="${c.id}"]`), c); };

  async function undoMove(moveId, c) {
    try {
      const res = await post(`/consumable-moves/${moveId}/undo`);
      tick(); buzz(15);
      if (res.item) { replaceItem(res.item); popNumber('↺', content.querySelector(`[data-cid="${c.id}"]`), { color: '#22d3ee' }); }
      applyHud(res.hud, { silent: true });
      toast('Buchung zurückgenommen.', 'info');
      if (current === 'log') renderLog();
    } catch (err) { toastError(err); }
  }

  async function use(tile, c, { amount = null, empty = false }, ev) {
    const amt = empty ? c.emptyAmount : amount;
    if (!amt) return;
    pfftKlack();
    buzz([30, 20, 30]);
    bump(tile);
    popNumber(`-${amountLabel(amt, c)}`, ev && ev.clientX ? ev : tile, { color: '#a3e635' });
    try {
      const res = await post(`/consumables/${c.id}/use`, { amount, empty, vehicle_id: target });
      replaceItem(res.item);
      applyHud(res.hud, { silent: true });
      const car = res.move.vehicle_name;
      if (res.crossedCritical) {
        warn(); buzz([90, 60, 90]);
        toast(`KRITISCHER MANGEL: ${res.item.qty <= 0 ? `${res.item.name} ist LEER!` : `Nur noch ${amountLabel(res.item.qty, res.item)} ${res.item.name} vorhanden!`} Steht ganz oben auf der Einkaufsliste.`, 'error', 7000);
      } else if (res.crossed) toast(`${res.item.name} unter Mindestbestand: steht auf der Einkaufsliste.`, 'warn', 4500);
      toast(`${res.popup} ${c.name}${car ? ` → ${car}` : ' · Halle'}${res.item.unknown ? '' : ` · Rest ${amountLabel(res.item.qty, res.item)}`}`, 'ok', 4500,
        { label: 'Rückgängig', onClick: () => undoMove(res.move.id, c) });
      if (res.move.noStock) toast(`${c.name}: kein Gebinde im Inventar. Verbrauch ist gebucht, der Bestand bleibt unbekannt.`, 'info', 5000);
      else if (res.move.shortfall > 0) toast(`Im Lager waren ${amountLabel(res.move.shortfall, c)} weniger als gebucht. Bitte Gebinde prüfen.`, 'warn', 5500);
      renderTabs();
    } catch (err) {
      bump(tile, 'shake');
      toastError(err);
    }
  }

  on(content, 'click', '[data-use]', (e, b) => { const t = b.closest('.qu-tile'); use(t, itemOf(t), { amount: Number(b.dataset.use) }, e); });
  on(content, 'click', '[data-empty]', (e, b) => { const t = b.closest('.qu-tile'); use(t, itemOf(t), { empty: true }, e); });
  on(content, 'click', '[data-gebinde]', (_e, b) => {
    const t = b.closest('.qu-tile');
    tick();
    openGebinde(Number(t.dataset.cid), { onChange: (c) => { if (items.some((x) => x.id === c.id)) replaceItem(c); } });
  });
  on(content, 'click', '[data-stockin]', async (_e, b) => {
    const t = b.closest('.qu-tile');
    const item = await openStockIn(itemOf(t), { anchor: b });
    if (item) { replaceItem(item); bump(t); renderTabs(); }
  });

  /* ---------- Reiter: Einkauf (v4.2: Radar + Hallen-Einkaufsliste + Auto-Einkäufe) ---------- */
  async function renderShop() {
    let data;
    try { data = await get('/shopping'); } catch (err) { toastError(err); return; }
    renderTabs(data.counts.radarNew + data.counts.list);
    const radarRow = (it) => html`
      <div class="shop-row ${it.level}">
        <span class="${it.level === 'critical' ? 'text-rose-300' : 'text-amber-300'}">${icon(it.source === 'supply' ? 'fridge' : it.level === 'critical' ? 'alert' : 'package', 'w-5 h-5')}</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white">${it.name} ${it.level === 'critical' ? html`<span class="qu-badge crit ml-1">KRITISCH</span>` : ''}</div>
          <div class="text-xs ${it.level === 'critical' ? 'text-rose-200' : 'text-slate-400'}">${it.text}</div>
          <div class="text-xs text-cyan-200 mt-0.5">Kaufen: ${it.buy.text}</div>
        </div>
        ${it.onList ? html`<span class="chip !text-lime-200 !border-lime-400/40 shrink-0">${icon('check', 'w-3 h-3')} auf der Liste</span>`
          : canEdit() ? html`<button class="btn btn-sm btn-amber shrink-0" data-tolist="${it.source}:${it.ref_id}" data-qty="${it.buy.text}">${icon('plus', 'w-3.5 h-3.5')} Einkaufsliste</button>` : ''}
      </div>`;
    const listRow = (it) => html`
      <div class="shop-row" data-li="${it.id}">
        <span class="text-cyan-300">${icon(it.source === 'supply' ? 'fridge' : it.source === 'consumable' ? 'package' : 'list', 'w-5 h-5')}</span>
        <div class="flex-1 min-w-0"><div class="font-semibold text-white truncate">${it.name}</div>
          <div class="text-xs text-slate-400">${it.qty_text || ''}${it.note ? ` · ${it.note}` : ''}${it.created_by_name ? ` · ${it.created_by_name}` : ''}</div></div>
        ${canEdit() ? html`<button class="btn btn-sm btn-lime shrink-0" data-bought="${it.id}">${icon('check', 'w-3.5 h-3.5')} Gekauft</button>
          <button class="btn-icon shrink-0" data-rm="${it.id}" title="Von der Liste nehmen">${icon('x', 'w-4 h-4')}</button>` : ''}
      </div>`;
    const purchaseRow = (it) => html`<div class="shop-row">
        <span class="text-slate-400">${icon('car', 'w-5 h-5')}</span>
        <div class="flex-1 min-w-0"><div class="font-semibold text-white truncate">${it.url ? html`<a class="hover:text-cyan-300" href="${it.url}" target="_blank" rel="noopener">${it.name} ↗</a>` : it.name}</div>
          <div class="text-xs text-slate-400">${it.vehicle_name || 'Allgemein'}${it.qty > 1 ? ` · ${it.qty}×` : ''}${it.price ? ` · ${euro(it.price * (it.qty || 1))}` : ''}</div></div>
        ${canEdit() ? html`<button class="btn btn-sm shrink-0" data-buyp="${it.id}">${icon('check', 'w-3.5 h-3.5')} Gekauft</button>` : ''}
      </div>`;
    const newOnRadar = data.radar.filter((x) => !x.onList);
    setHTML(content, html`
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="qu-section !mb-0 flex-1">DEMNÄCHST EINKAUFEN · MANGEL-RADAR</div>
        ${canEdit() && newOnRadar.length > 1 ? html`<button class="btn btn-sm" data-allto>${icon('plus', 'w-3.5 h-3.5')} Alle auf die Liste</button>` : ''}
      </div>
      <div class="space-y-2 mb-6">${data.radar.map(radarRow)}
        ${!data.radar.length ? html`<div class="card p-4 text-center text-lime-300 text-sm">Kritische Liste und Kühlschrank sind über Soll. Nichts fehlt.</div>` : ''}</div>
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="qu-section !mb-0 flex-1">HALLEN-EINKAUFSLISTE</div>
        ${data.list.length || data.purchases.length ? html`<button class="btn btn-sm" data-copy>${icon('file', 'w-3.5 h-3.5')} Liste kopieren</button>` : ''}
      </div>
      <div class="space-y-2 mb-3">${data.list.map(listRow)}
        ${!data.list.length ? html`<p class="text-sm text-slate-500">Die Liste ist leer. Aus dem Radar oben mit einem Klick übernehmen oder unten etwas eintragen.</p>` : ''}</div>
      ${canEdit() ? html`<form class="flex gap-2 mb-6" data-manual><input class="input flex-1" name="name" placeholder="Sonst noch was? z. B. Nitrilhandschuhe" required><input class="input !w-28" name="qty_text" placeholder="Menge"><button class="btn">${icon('plus')}</button></form>` : ''}
      ${data.purchases.length ? html`<div class="qu-section">FÜR DIE AUTOS</div><div class="space-y-2">${data.purchases.map(purchaseRow)}</div>` : ''}`);
    content._shop = data;
  }

  const shopData = () => content._shop || { radar: [], list: [], purchases: [] };
  async function addToList(source, refId, qtyText, ev) {
    try {
      const res = await post('/shopping-list', { source, ref_id: refId, qty_text: qtyText });
      coin(); buzz(15); popNumber('🛒', ev, { color: '#facc15' });
      applyHud(res.hud, { silent: true });
    } catch (err) { toastError(err); }
  }
  on(content, 'click', '[data-tolist]', async (e, b) => {
    const [source, ref] = b.dataset.tolist.split(':');
    await addToList(source, Number(ref), b.dataset.qty, e);
    renderShop();
  });
  on(content, 'click', '[data-allto]', async (e) => {
    for (const it of shopData().radar.filter((x) => !x.onList)) await addToList(it.source, it.ref_id, it.buy.text, e);
    renderShop();
  });
  content.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-manual]')) return;
    e.preventDefault();
    try { const res = await post('/shopping-list', formData(e.target)); tick(); applyHud(res.hud, { silent: true }); renderShop(); } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-bought]', async (e, b) => {
    const it = shopData().list.find((x) => x.id === Number(b.dataset.bought));
    try {
      if (it.source === 'consumable') {
        // Gekauft heißt: einlagern (mit Lagerort). Ohne Einlagern bleibt der Eintrag offen.
        const c = await get(`/consumables/${it.ref_id}/stock`);
        const item = await openStockIn(c, { listId: it.id, anchor: b });
        if (!item) return;
      } else if (it.source === 'supply') {
        const s = (store.supplies || []).find((x) => x.id === it.ref_id) || {};
        const n = s.pack_size || 1;
        if (await confirmDialog(`${it.name}: ${n} ${s.unit || 'Stück'} in den Kühlschrank einbuchen?`, { title: 'Gekauft', okLabel: `+${n} einbuchen` })) {
          await post(`/supplies/${it.ref_id}/adjust`, { delta: n });
          if (app.refreshSupplies) app.refreshSupplies();
        }
        await post(`/shopping-list/${it.id}/bought`);
        coin(); popNumber('✓', e, { color: '#a3e635' });
      } else {
        await post(`/shopping-list/${it.id}/bought`);
        coin(); buzz(15); popNumber('✓', e, { color: '#a3e635' });
      }
      if (app.refreshHud) app.refreshHud();
      setTimeout(renderShop, 350);
    } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-rm]', async (_e, b) => {
    try { const res = await post(`/shopping-list/${b.dataset.rm}/remove`); tick(); applyHud(res.hud, { silent: true }); renderShop(); } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-buyp]', async (e, b) => {
    try {
      await put(`/purchases/${b.dataset.buyp}`, { status: 'bought' });
      coin(); buzz(15); popNumber('✓', e, { color: '#a3e635' });
      setTimeout(renderShop, 400);
    } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-copy]', async () => {
    const d = shopData();
    const lines = [...d.list.map((it) => `${it.name}${it.qty_text ? `: ${it.qty_text}` : ''}`), ...d.purchases.map((it) => `${it.name}${it.vehicle_name ? ` (${it.vehicle_name})` : ''}`)];
    const text = `Einkaufsliste ${new Date().toLocaleDateString('de-DE')}\n${lines.map((l) => `- ${l}`).join('\n')}`;
    try { await navigator.clipboard.writeText(text); toast('Liste kopiert. Ab in den Chat!', 'ok'); }
    catch {
      const ta = el(html`<textarea class="input mt-3 h-40">${text}</textarea>`);
      content.prepend(ta); ta.select(); toast('Text markiert: kopieren mit Strg+C.', 'info');
    }
    tick();
  });

  /* ---------- Reiter: Verlauf ---------- */
  async function renderLog() {
    let rows = [];
    try { rows = await get('/consumable-moves?limit=80'); } catch (err) { toastError(err); return; }
    const KIND = { use: 'Verbrauch', empty: 'Angebrochenes leer', refill: 'Nachgekauft (alt)', count: 'Inventur (alt)' };
    setHTML(content, html`<div class="space-y-1.5">
      ${rows.map((r) => {
        const fresh = !r.undone && Date.now() - Date.parse(r.created_at) < 24 * 3600000;
        const c = { kind: r.item_kind, unit: r.unit };
        return html`<div class="card px-3 py-2 flex items-center gap-3 text-sm ${r.undone ? 'opacity-40 line-through' : ''}">
          <span class="font-mono text-xs w-24 shrink-0 ${r.delta < 0 ? 'text-lime-300' : 'text-cyan-300'}">${r.kind === 'count' ? `= ${amountLabel(r.qty_after, c)}` : `${r.delta > 0 ? '+' : ''}${amountLabel(r.delta, c)}`}</span>
          <div class="flex-1 min-w-0"><div class="text-white truncate">${r.name}${r.vehicle_name ? html` <span class="text-amber-200">→ ${r.vehicle_name}</span>` : ''}</div>
            <div class="text-[11px] text-slate-500">${KIND[r.kind] || r.kind} · ${r.user_name || '?'} · ${fmtDateTime(r.created_at)}</div></div>
          ${fresh && canEdit() ? html`<button class="btn btn-sm" data-undo="${r.id}" data-cid="${r.consumable_id}">${icon('undo', 'w-3.5 h-3.5')}</button>` : ''}
        </div>`;
      })}
      ${!rows.length ? html`<p class="text-sm text-slate-500">Noch keine Buchungen.</p>` : ''}</div>`);
  }
  on(content, 'click', '[data-undo]', (_e, b) => undoMove(Number(b.dataset.undo), { id: Number(b.dataset.cid) }));

  /* ---------- Steuerung ---------- */
  function show(t) {
    current = t;
    renderTabs();
    ({ use: renderUse, shop: renderShop, log: renderLog })[t]();
  }
  on(tabsEl, 'click', '[data-t]', (_e, b) => { tick(); show(b.dataset.t); });
  on(targetEl, 'click', '[data-tg]', (_e, b) => {
    target = b.dataset.tg ? Number(b.dataset.tg) : null;
    saveTarget(target);
    tick(); buzz(8);
    renderTarget();
    const v = store.vehicles.find((x) => x.id === target);
    toast(v ? `Verbrauch wird jetzt auf ${v.name} gebucht (Wartungsheft).` : 'Verbrauch wird auf die Halle gebucht.', 'info', 2500);
  });

  renderTarget();
  show(current);
  return m;
}
