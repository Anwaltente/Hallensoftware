/**
 * Chill-Ecke & Kühlschrank-Radar
 * - Getränke & Snacks mit [+1] / [-1] / [+Kiste] (v4.2: Werkstatt-Vorräte entfernt, die laufen über die Kritische Liste)
 * - Mindestbestand mit Low-Stock-Alarm (HUD-Chip, pulsierender Kühlschrank auf der Map, LED-Ticker)
 */
import { store, app, setState, canEdit, subscribe } from './state.js';
import { get, post, put, del } from './api.js';
import { $, html, setHTML, el, on, icon, toast, toastError, haptic, openModal, confirmDialog, formData, since } from './ui.js';

export async function refreshSupplies() {
  const list = await get('/supplies');
  setState({ supplies: list }, ['supplies']);
  return list;
}

/** Kurzer Alarmtext, z. B. "Bier fast leer!" */
export function lowText(list = store.supplies) {
  const low = (list || []).filter((s) => s.low);
  if (!low.length) return '';
  const first = low[0];
  return `${first.name} ${first.qty <= 0 ? 'leer' : 'fast leer'}!${low.length > 1 ? ` (+${low.length - 1})` : ''}`;
}

/** HUD-Chip in der Kopfzeile */
export function initSupplyAlert() {
  const chip = $('#supplyAlert');
  const render = () => {
    const txt = lowText();
    chip.classList.toggle('hidden', !txt);
    if (txt) setHTML(chip, html`${icon('fridge', 'w-4 h-4')}<span class="hidden sm:inline lg:hidden min-[1700px]:inline whitespace-nowrap">${txt}</span>`);
    chip.title = (store.supplies || []).filter((s) => s.low).map((s) => `${s.name}: ${s.qty} ${s.unit} (mind. ${s.min_qty})`).join('\n');
  };
  subscribe('supplies', render);
  chip.addEventListener('click', () => app.navigate({ kind: 'fridge' }));
  render();
}

export async function openFridge() {
  let list;
  try { list = await refreshSupplies(); } catch (err) { toastError(err); return; }
  let editMode = false;
  const body = el(html`<div class="fridge-wrap"><div data-content></div></div>`);
  const m = openModal({ title: 'Kühlschrank-Radar', subtitle: 'Chill-Ecke · Getränke & Snacks', size: 'xl', iconName: 'fridge', body });
  const content = body.querySelector('[data-content]');

  const card = (s) => {
    const max = Math.max(s.min_qty * 2, s.qty, 1);
    const pct = Math.min(100, Math.round((s.qty / max) * 100));
    const minPct = Math.min(100, Math.round((s.min_qty / max) * 100));
    const state = s.qty <= 0 ? 'empty' : s.low ? 'low' : 'ok';
    return html`
      <div class="fridge-item card p-3 ${state !== 'ok' ? `is-${state}` : ''}" data-id="${s.id}">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-display font-bold text-white truncate">${s.name}</div>
            <div class="text-[11px] ${state === 'ok' ? 'text-slate-500' : 'text-rose-300 font-semibold'}">${state === 'empty' ? 'LEER!' : state === 'low' ? 'fast leer' : 'ausreichend'} · mind. ${s.min_qty}</div>
          </div>
          <div class="text-right"><div class="font-display text-3xl font-bold leading-none ${state === 'ok' ? 'text-cyan-200' : 'text-rose-300'}">${s.qty}</div><div class="text-[10px] text-slate-500">${s.unit}</div></div>
        </div>
        <div class="fill-bar mt-3"><span style="width:${pct}%"></span><i style="left:${minPct}%" title="Mindestbestand"></i></div>
        ${canEdit() ? html`<div class="grid grid-cols-3 gap-1.5 mt-3">
          <button class="btn btn-sm" data-adj="-1">-1</button>
          <button class="btn btn-sm" data-adj="1">+1</button>
          <button class="btn btn-sm btn-lime" data-adj="${s.pack_size}" title="Kiste / Packung auffüllen">+${s.pack_size}</button>
        </div>` : ''}
        ${s.last ? html`<div class="text-[10px] text-slate-500 mt-2 truncate">zuletzt ${s.last.user_name || '?'} ${s.last.delta > 0 ? '+' : ''}${s.last.delta} · ${since(s.last.created_at)}</div>` : ''}
        ${editMode ? html`<form class="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-white/10" data-edit="${s.id}">
          <label class="col-span-3"><span class="label">Name</span><input class="input !py-1 text-sm" name="name" value="${s.name}"></label>
          <label><span class="label">Mindest</span><input class="input !py-1 text-sm" type="number" min="0" name="min_qty" value="${s.min_qty}"></label>
          <label><span class="label">Kiste</span><input class="input !py-1 text-sm" type="number" min="1" name="pack_size" value="${s.pack_size}"></label>
          <label><span class="label">Einheit</span><input class="input !py-1 text-sm" name="unit" value="${s.unit}"></label>
          <button type="button" class="btn btn-sm btn-danger" data-delsup="${s.id}">${icon('trash', 'w-3.5 h-3.5')}</button>
          <button class="btn btn-sm btn-primary col-span-2">Speichern</button>
        </form>` : ''}
      </div>`;
  };

  function render() {
    // v4.2: nur noch Getränke & Snacks. Werkstatt-Betriebsstoffe laufen über Inventar + Kritische Liste.
    const fridge = list.filter((s) => s.category === 'kuehlschrank');
    const low = fridge.filter((s) => s.low);
    setHTML(content, html`
      ${low.length ? html`<div class="low-banner mb-4">${icon('alert', 'w-4 h-4')} <b>Einkaufen:</b> ${low.map((s) => `${s.name} (${s.qty}/${s.min_qty})`).join(' · ')}
          ${canEdit() ? html`<button class="btn btn-sm ml-auto" data-tolist>${icon('list', 'w-3.5 h-3.5')} Auf die Einkaufsliste</button>` : ''}</div>`
        : html`<div class="mb-4 rounded-lg border border-lime-400/30 bg-lime-400/10 px-3 py-2 text-sm text-lime-200">${icon('check', 'w-4 h-4 inline')} Alles aufgefüllt. Prost!</div>`}
      <section class="fridge-box">
        <div class="fridge-door-head"><span>${icon('fridge', 'w-4 h-4')} KÜHLSCHRANK · GETRÄNKE &amp; SNACKS</span><span class="fridge-temp">4°C</span></div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">${fridge.map(card)}</div>
      </section>
      <p class="text-[11px] text-slate-500 mt-3">Öle, Reiniger und anderes Werkstatt-Material stehen jetzt im Inventar und auf der Kritischen Liste (Schnell-Verbrauch).</p>
      ${canEdit() ? html`
        <div class="flex flex-wrap items-end gap-2 mt-4">
          <button class="btn btn-sm ${editMode ? 'btn-primary' : ''}" data-editmode>${icon('edit', 'w-3.5 h-3.5')} ${editMode ? 'Bearbeiten beenden' : 'Mindestbestände bearbeiten'}</button>
          <form class="flex flex-wrap gap-2 ml-auto items-end" data-new>
            <input class="input !w-40 !py-1.5 text-sm" name="name" placeholder="Neues Getränk / Snack" required>
            <input class="input !w-20 !py-1.5 text-sm" type="number" min="0" name="qty" placeholder="Anz.">
            <input class="input !w-24 !py-1.5 text-sm" type="number" min="0" name="min_qty" placeholder="Mindest">
            <button class="btn btn-sm">${icon('plus')}</button>
          </form>
        </div>` : ''}`);
  }

  const apply = (newList) => { list = newList; setState({ supplies: list }, ['supplies']); render(); };

  on(content, 'click', '[data-adj]', async (_e, b) => {
    const id = Number(b.closest('[data-id]').dataset.id);
    const delta = Number(b.dataset.adj);
    haptic(delta > 0 ? [8, 20, 8] : 10);
    try {
      const res = await post(`/supplies/${id}/adjust`, { delta });
      apply(res.list);
      if (res.becameLow) toast(`${res.item.name} fast leer! Auf die Einkaufsliste.`, 'warn', 4500);
    } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-editmode]', () => { editMode = !editMode; render(); });
  on(content, 'click', '[data-tolist]', async () => {
    try {
      for (const s of list.filter((x) => x.low)) await post('/shopping-list', { source: 'supply', ref_id: s.id });
      toast('Steht auf der Hallen-Einkaufsliste.', 'ok');
      if (app.refreshHud) app.refreshHud();
    } catch (err) { toastError(err); }
  });
  on(content, 'click', '[data-delsup]', async (_e, b) => {
    if (!(await confirmDialog('Artikel entfernen?', { danger: true, okLabel: 'Entfernen' }))) return;
    try { apply(await del(`/supplies/${b.dataset.delsup}`)); } catch (err) { toastError(err); }
  });
  content.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.matches('[data-new]')) { apply(await post('/supplies', formData(f))); toast('Artikel angelegt.', 'ok'); }
      if (f.matches('[data-edit]')) { apply(await put(`/supplies/${f.dataset.edit}`, formData(f))); toast('Gespeichert.', 'ok'); }
    } catch (err) { toastError(err); }
  });
  render();
  return m;
}
