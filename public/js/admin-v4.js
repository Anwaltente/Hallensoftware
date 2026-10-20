/**
 * v4: Admin-Bereich "Verbrauch & Kritisch"
 *   - Verbrauchsartikel für den Schnell-Verbrauch anlegen, bearbeiten, ausblenden
 *   - Kritische Ressourcen: Artikel, die NIE ausgehen dürfen, mit Schwellenwert (z. B. mindestens 5 L)
 *   - v4.2: Ist = Summe der Gebinde im Inventar; Zuordnungs-Assistent für vorhandene Teile und alte Werkstatt-Vorräte
 */
import { store, app } from './state.js';
import { get, post, put, del } from './api.js';
import { html, setHTML, on, icon, toast, toastError, confirmDialog, formData, openModal } from './ui.js';
import { fmtQty } from './hud.js';
import { tick, coin } from './sfx.js';

function fresh(c) {
  const n = c.cloneNode(false);
  c.replaceWith(n);
  return n;
}

const stepsText = (c) => (c.steps || []).map((n) => String(n).replace('.', ',')).join('  ');

function fields(c = {}) {
  const objs = store.objects.filter((o) => ['shelf', 'workbench', 'toolwall', 'zone', 'fridge', 'tyrestack', 'slot'].includes(o.type));
  const kind = c.kind || 'fluid';
  return html`
    <label class="sm:col-span-2"><span class="label">Bezeichnung</span><input class="input" name="name" value="${c.name || ''}" required placeholder="z. B. 10W-60 Motoröl"></label>
    <label><span class="label">Art</span><select class="select" name="kind"><option value="fluid" ${kind === 'fluid' ? 'selected' : ''}>Flüssigkeit</option><option value="piece" ${kind !== 'fluid' ? 'selected' : ''}>Verbrauchsmaterial (Stück)</option></select></label>
    <label><span class="label">Einheit</span><input class="input" name="unit" value="${c.unit || (kind === 'fluid' ? 'L' : 'Stk')}" placeholder="L, Stk, Dosen, Rollen"></label>
    <label><span class="label">Schnell-Tasten (Mengen)</span><input class="input" name="steps" value="${c.steps ? stepsText(c) : (kind === 'fluid' ? '0,5  1  2' : '1  2')}" placeholder="0,5  1  2"></label>
    <label><span class="label">Preis pro Einheit (€)</span><input class="input" type="number" step="0.01" min="0" name="price_per_unit" value="${c.price_per_unit ?? ''}" placeholder="optional, für die Kosten im Wartungsheft"></label>
    <label><span class="label">Soll / Mindestbestand</span><input class="input" type="number" step="0.1" min="0" name="min_qty" value="${c.min_qty ?? 0}"></label>
    <p class="sm:col-span-2 text-[11px] text-slate-400 -mt-1">Der Ist-Bestand wird automatisch aus allen verknüpften Gebinden im Inventar summiert (z. B. 2 × 1 L Dose + 1 × 5 L Kanister = 7 L).</p>
    <label><span class="label">Alarm-Ort auf dem Hallenplan</span><select class="select" name="location_object_id"><option value="">automatisch (Regal des ersten Gebindes)</option>
      ${objs.map((o) => html`<option value="${o.id}" ${Number(c.location_object_id) === o.id ? 'selected' : ''}>${o.label || o.code}</option>`)}</select></label>
    <label><span class="label">Sortierung</span><input class="input" type="number" name="sort" value="${c.sort ?? 100}"></label>
    <label class="sm:col-span-2 flex items-center gap-3 card px-3 py-3 !border-rose-400/40 cursor-pointer">
      <input type="checkbox" class="check check-lg" name="critical" ${c.critical ? 'checked' : ''}>
      <span><b class="text-rose-200">Kritische Ressource: darf NIE ausgehen</b><span class="block text-xs text-slate-400">Fällt der Bestand unter den Mindestbestand: roter Neon-Alarm im HUD, auf dem Hallenplan und auf dem Hallen-TV, Warnton und ganz oben auf der Einkaufsliste.</span></span>
    </label>
    ${c.id ? html`<label class="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" class="check" name="active" ${c.active ? 'checked' : ''}> im Schnell-Verbrauch anzeigen</label>` : ''}`;
}

export async function tabConsumables(c0) {
  const c = fresh(c0);
  let list = [];
  let assign = { parts: [], supplies: [] };
  let showAll = false;

  async function load() {
    try { [list, assign] = await Promise.all([get('/consumables?all=1'), get('/admin/consumables/assign')]); } catch (err) { toastError(err); }
    render();
  }

  function render() {
    const crit = list.filter((x) => x.critical);
    setHTML(c, html`
      <div class="grid lg:grid-cols-[1fr_1.15fr] gap-5">
        <div>
          <h3 class="font-display font-bold text-white mb-1">Kritische Ressourcen</h3>
          <p class="text-sm text-slate-400 mb-3">Dinge, die in der Halle NIE ausgehen dürfen. Hier steht nur das Soll. Das Ist summiert die App aus allen Gebinden im Inventar.</p>
          <div class="space-y-2">
            ${crit.map((x) => html`
              <div class="card px-3 py-2.5 flex items-center gap-3 ${x.crit ? '!border-rose-400/70' : ''}" data-row="${x.id}">
                <span class="${x.crit ? 'text-rose-300' : 'text-slate-500'}">${icon('alert', 'w-4 h-4')}</span>
                <div class="flex-1 min-w-0"><div class="text-sm font-semibold text-white truncate">${x.name}</div>
                  <div class="text-[11px] ${x.crit ? 'text-rose-300 font-semibold' : 'text-slate-500'}">${x.unknown ? 'noch kein Gebinde im Inventar' : `Ist ${fmtQty(x.qty, x.kind)} ${x.unit}${x.breakdown ? ` (${x.breakdown})` : ''}`}${x.crit ? ' · KRITISCHER MANGEL' : ''}</div></div>
                <label class="flex items-center gap-1.5 text-xs text-slate-400">mind.
                  <input class="input !w-20 !py-1 text-sm text-right" type="number" step="0.1" min="0" value="${x.min_qty}" data-min="${x.id}"> ${x.unit}</label>
              </div>`)}
            ${!crit.length ? html`<p class="text-sm text-slate-500">Noch keine kritischen Artikel. Rechts bei einem Artikel „darf nie ausgehen“ anhaken.</p>` : ''}
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-display font-bold text-white">Alle Verbrauchsartikel</h3>
            <button class="btn btn-sm btn-primary" data-new>${icon('plus')} Artikel</button>
          </div>
          <div class="space-y-1.5">
            ${list.map((x) => html`
              <div class="card px-3 py-2 flex items-center gap-2.5 ${x.active ? '' : 'opacity-50'}">
                <span class="text-lg" aria-hidden="true">${x.kind === 'fluid' ? '🛢️' : '📦'}</span>
                <div class="flex-1 min-w-0"><div class="text-sm text-white truncate">${x.name}${x.active ? '' : ' (ausgeblendet)'}</div>
                  <div class="text-[11px] text-slate-500">Ist ${x.unknown ? '? (kein Gebinde)' : `${fmtQty(x.qty, x.kind)} ${x.unit}`} · Soll ${fmtQty(x.min_qty, x.kind)} ${x.unit}${x.breakdown ? ` · ${x.breakdown}` : ''}</div></div>
                <button class="btn btn-sm ${x.critical ? 'btn-danger' : ''}" data-crit="${x.id}" title="Kritische Ressource umschalten">${icon('alert', 'w-3.5 h-3.5')}<span class="hidden sm:inline">${x.critical ? 'kritisch' : 'normal'}</span></button>
                <button class="btn-icon" data-edit="${x.id}" title="Bearbeiten">${icon('edit')}</button>
              </div>`)}
          </div>
        </div>
      </div>
      ${assistant()}`);
  }

  /* v4.2: Zuordnungs-Assistent: vorhandene Inventar-Teile verknüpfen, alte Werkstatt-Vorräte übernehmen */
  function assistant() {
    const active = list.filter((x) => x.active);
    const consOpts = (sel) => html`${active.map((x) => html`<option value="${x.id}" ${Number(sel) === x.id ? 'selected' : ''}>${x.name} (${x.unit})</option>`)}`;
    const parts = assign.parts.filter((p) => showAll || p.likely);
    const shelves = store.objects.filter((o) => o.type === 'shelf');
    return html`
      <div class="mt-8 pt-5 border-t border-white/10">
        <h3 class="font-display font-bold text-white mb-1">${icon('link', 'w-4 h-4 inline text-cyan-300')} Zuordnungs-Assistent</h3>
        <p class="text-sm text-slate-400 mb-4">Verknüpft vorhandene Teile im Inventar mit der Kritischen Liste. Nur das, was du hier bestätigst, wird geändert.</p>
        <div class="grid lg:grid-cols-2 gap-5">
          <section>
            <div class="flex items-center justify-between mb-2"><div class="label !mb-0">Teile im Inventar (noch ohne Zuordnung)</div>
              <label class="text-[11px] text-slate-400 flex items-center gap-1.5"><input type="checkbox" class="check" data-showall ${showAll ? 'checked' : ''}> alle Teile zeigen</label></div>
            <div class="space-y-2">${parts.map((p) => html`
              <div class="card px-3 py-2.5" data-ap="${p.id}">
                <div class="text-sm text-white">${p.qty}× ${p.name}</div>
                <div class="text-[11px] text-slate-500 mb-2">${p.location}</div>
                <div class="flex flex-wrap gap-2 items-center">
                  <select class="select !w-auto !py-1 text-sm flex-1 min-w-[10rem]" data-apc><option value="">Kategorie wählen</option>${consOpts(p.suggest_consumable_id)}</select>
                  <input class="input !w-24 !py-1 text-sm font-mono" type="number" step="0.01" min="0" placeholder="Menge" value="${p.suggest_pack ?? ''}" data-app title="Gebindemenge, z. B. 5 für 5 L">
                  <button class="btn btn-sm btn-primary" data-link="${p.id}">${icon('link', 'w-3.5 h-3.5')} verknüpfen</button>
                </div>
              </div>`)}
              ${!parts.length ? html`<p class="text-sm text-slate-500">${showAll ? 'Alle Teile sind zugeordnet.' : 'Keine passenden Teile gefunden. „alle Teile zeigen“ anhaken.'}</p>` : ''}
            </div>
          </section>
          <section>
            <div class="label">Alte Werkstatt-Vorräte aus dem Kühlschrank-Radar</div>
            <div class="space-y-2">${assign.supplies.map((sp) => html`
              <div class="card px-3 py-2.5" data-as="${sp.id}">
                <div class="text-sm text-white">${sp.name}: ${sp.qty} ${sp.unit} <span class="text-slate-500">(mind. ${sp.min_qty})</span></div>
                <div class="flex flex-wrap gap-2 items-center mt-2">
                  <select class="select !w-auto !py-1 text-sm flex-1 min-w-[10rem]" data-asc><option value="">neue Kategorie „${sp.name}“ anlegen</option>${consOpts(sp.suggest_consumable_id)}</select>
                  <select class="select !w-auto !py-1 text-sm" data-ass><option value="">ohne Regal</option>${shelves.map((sh) => html`<option value="${sh.id}">Regal ${sh.code}</option>`)}</select>
                  <input class="input !w-16 !py-1 text-sm" type="number" min="1" placeholder="Ebene" data-asl>
                  <button class="btn btn-sm btn-primary" data-import="${sp.id}">${icon('download', 'w-3.5 h-3.5')} ins Inventar</button>
                </div>
                <div class="text-[11px] text-amber-300 mt-1 hidden" data-aswarn></div>
              </div>`)}
              ${!assign.supplies.length ? html`<p class="text-sm text-slate-500">Nichts mehr zu übernehmen.</p>` : ''}
            </div>
            <p class="text-[11px] text-slate-500 mt-2">Der alte Eintrag bleibt unverändert in der Datenbank, er wird nur nicht mehr im Kühlschrank angezeigt.</p>
          </section>
        </div>
      </div>`;
  }

  on(c, 'change', '[data-showall]', (_e, b) => { showAll = b.checked; render(); });
  on(c, 'change', '[data-asc]', (_e, sel) => {
    const warnEl = sel.closest('[data-as]').querySelector('[data-aswarn]');
    const x = list.find((i) => i.id === Number(sel.value));
    warnEl.classList.toggle('hidden', !(x && !x.unknown));
    if (x && !x.unknown) warnEl.textContent = `Achtung: ${x.name} hat schon ${fmtQty(x.qty, x.kind)} ${x.unit} im Inventar. Nicht doppelt zählen!`;
  });
  on(c, 'click', '[data-link]', async (_e, b) => {
    const row = b.closest('[data-ap]');
    const cid = row.querySelector('[data-apc]').value;
    const pack = row.querySelector('[data-app]').value;
    if (!cid) { toast('Bitte eine Kategorie wählen.', 'warn'); return; }
    try { await post('/admin/consumables/link-part', { part_id: Number(b.dataset.link), consumable_id: Number(cid), pack_size: pack }); coin(); toast('Verknüpft. Zählt jetzt zum Ist-Bestand.', 'ok'); changed(); await load(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-import]', async (_e, b) => {
    const row = b.closest('[data-as]');
    try {
      await post('/admin/consumables/import-supply', { supply_id: Number(b.dataset.import), consumable_id: row.querySelector('[data-asc]').value || null, shelf_id: row.querySelector('[data-ass]').value || null, level: row.querySelector('[data-asl]').value || null });
      coin(); toast('Ins Inventar übernommen.', 'ok'); changed(); await load();
    } catch (err) { toastError(err); }
  });

  const changed = () => { if (app.refreshHud) app.refreshHud(); };

  on(c, 'change', '[data-min]', async (_e, inp) => {
    try { await put(`/admin/consumables/${inp.dataset.min}`, { min_qty: inp.value }); tick(); toast('Schwellenwert gespeichert.', 'ok', 1800); changed(); await load(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-crit]', async (_e, b) => {
    const x = list.find((i) => i.id === Number(b.dataset.crit));
    try { await put(`/admin/consumables/${x.id}`, { critical: !x.critical }); x.critical ? tick() : coin(); changed(); await load(); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-new]', () => openForm({}));
  on(c, 'click', '[data-edit]', (_e, b) => openForm(list.find((i) => i.id === Number(b.dataset.edit))));

  function openForm(item) {
    const m = openModal({
      title: item.id ? `Artikel: ${item.name}` : 'Neuer Verbrauchsartikel', size: 'lg', iconName: 'package',
      body: html`<form class="grid sm:grid-cols-2 gap-3" data-f>${fields(item)}</form>`,
      footer: html`${item.id ? html`<button class="btn btn-danger mr-auto" data-del>${icon('trash', 'w-4 h-4')} Entfernen</button>` : ''}
        <button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>Speichern</button>`
    });
    const f = m.body.querySelector('[data-f]');
    m.footer.querySelector('[data-save]').addEventListener('click', async () => {
      if (!f.reportValidity()) return;
      const d = formData(f);
      try {
        if (item.id) await put(`/admin/consumables/${item.id}`, d);
        else await post('/admin/consumables', d);
        coin(); toast('Gespeichert.', 'ok'); m.close(); changed(); load();
      } catch (err) { toastError(err); }
    });
    const delBtn = m.footer.querySelector('[data-del]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!(await confirmDialog(`„${item.name}“ entfernen? Hat der Artikel schon Buchungen, wird er nur ausgeblendet und der Verlauf bleibt erhalten.`, { danger: true, okLabel: 'Entfernen' }))) return;
      try { const r = await del(`/admin/consumables/${item.id}`); toast(r.archived ? 'Ausgeblendet (Verlauf bleibt).' : 'Entfernt.', 'ok'); m.close(); changed(); load(); } catch (err) { toastError(err); }
    });
  }

  await load();
}
