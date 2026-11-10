/**
 * v5.6: Freie Bühnensuche ("Wann ist eine Bühne frei?")
 * Dauer (1/2/3 Tage, Wochenende) und Bühne wählen, die nächsten 5 freien Zeiträume erscheinen sofort.
 * Ein Klick auf einen Termin ruft onPick({ von, bis, lift_id, lift_label }) auf.
 */
import { get } from './api.js';
import { html, setHTML, on, icon, openModal, toastError } from './ui.js';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const fmt = (iso) => { const d = new Date(`${iso}T12:00:00`); return `${WD[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };

export function openLiftFinder({ lifts, lift = 0, vehicleId = null, excludeId = null, onPick }) {
  const m = openModal({
    title: 'Freie Bühne finden', subtitle: 'Die nächsten 5 freien Termine', size: 'sm', iconName: 'search',
    body: html`
      <div class="grid grid-cols-2 gap-2 mb-3">
        <label><span class="label">Benötigte Dauer</span><select class="select" data-f="dur">
          <option value="1">1 Tag</option><option value="2">2 Tage</option><option value="3">3 Tage</option><option value="weekend">Wochenende</option></select></label>
        <label><span class="label">Bühne</span><select class="select" data-f="lift">
          <option value="0">Egal</option>${lifts.map((l) => html`<option value="${l.id}" ${l.id === lift ? 'selected' : ''}>${l.label || l.code}</option>`)}</select></label>
      </div>
      <div data-res class="space-y-1.5"><p class="text-sm text-slate-500">Sucht …</p></div>`
  });
  const q = (n) => m.body.querySelector(`[data-f="${n}"]`).value;
  let found = [];
  async function search() {
    const dur = q('dur');
    const qs = new URLSearchParams({ days: dur === 'weekend' ? '2' : dur, lift: q('lift') });
    if (dur === 'weekend') qs.set('weekend', '1');
    if (vehicleId) qs.set('vehicle_id', vehicleId);
    if (excludeId) qs.set('exclude', excludeId);
    try { found = await get(`/lift-free?${qs}`); } catch (err) { toastError(err); return; }
    const box = m.body.querySelector('[data-res]');
    setHTML(box, found.length ? html`${found.map((r, i) => html`
      <button type="button" class="card card-hover w-full text-left px-3 py-2 flex items-center gap-2" data-pick="${i}">
        <span class="text-lime-300">${icon('check', 'w-4 h-4')}</span>
        <span class="text-sm text-white">Frei: ${fmt(r.von)}${r.von === r.bis ? '' : ` bis ${fmt(r.bis)}`} <span class="text-slate-400">(${r.lift_label})</span></span>
      </button>`)}` : html`<p class="text-sm text-slate-400">In den nächsten 6 Monaten ist nichts frei.</p>`);
  }
  on(m.body, 'change', '[data-f]', search);
  on(m.body, 'click', '[data-pick]', (_e, b) => { const r = found[Number(b.dataset.pick)]; m.close(); if (onPick) onPick(r); });
  search();
  return m;
}
