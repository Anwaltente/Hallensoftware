/**
 * Spotlight-Suche (Strg+K / Cmd+K / "/")
 * Durchsucht Autos, Teile, Werkzeug, Euroboxen, Aufgaben, Wartungsheft und Events.
 * Auswahl springt per Kamera-Zoom direkt zum Fach, zur Box oder zum Auto.
 */
import { app } from './state.js';
import { get } from './api.js';
import { html, setHTML, el, icon, openModal, topModal } from './ui.js';

const TYPE = {
  vehicle: { label: 'Auto', icon: 'car', color: 'text-cyan-300' },
  part: { label: 'Teil', icon: 'box', color: 'text-amber-300' },
  tool: { label: 'Werkzeug', icon: 'wrench', color: 'text-sky-300' },
  box: { label: 'Eurobox', icon: 'package', color: 'text-fuchsia-300' },
  task: { label: 'Aufgabe', icon: 'list', color: 'text-lime-300' },
  log: { label: 'Wartungsheft', icon: 'file', color: 'text-slate-300' },
  event: { label: 'Event', icon: 'flag', color: 'text-orange-300' },
  tyre: { label: 'Reifen', icon: 'tyre', color: 'text-orange-300' },
  supply: { label: 'Vorrat', icon: 'fridge', color: 'text-sky-300' }
};

let openInstance = null;

export function initSpotlight() { /* Tastenkürzel werden in app.js gebunden */ }

export function openSpotlight() {
  if (openInstance && topModal() === openInstance) return;
  let results = [];
  let active = 0;
  let timer = null;
  let seq = 0;
  const body = el(html`<div class="-mx-5 -my-4">
    <div class="flex items-center gap-3 px-5 py-3 border-b border-white/10">
      <span class="text-cyan-300">${icon('search', 'w-5 h-5')}</span>
      <input class="flex-1 bg-transparent outline-none text-lg text-white placeholder:text-slate-500" placeholder="Wo ist die 17er Nuss? Benzinfilter? E46?" data-q autocomplete="off">
      <kbd>Esc</kbd>
    </div>
    <div class="max-h-[60vh] overflow-y-auto p-2" data-results>
      <p class="text-sm text-slate-500 px-3 py-6 text-center">Tippe mindestens 2 Zeichen. <span class="text-slate-600">↑ ↓ wählen · Enter springen</span></p>
    </div></div>`);
  const m = openModal({ title: 'Spotlight', size: 'lg', body, onClose: () => { openInstance = null; } });
  m.el.querySelector('.modal-panel').classList.add('sm:!mt-[-20vh]');
  openInstance = m;
  const input = body.querySelector('[data-q]');
  const list = body.querySelector('[data-results]');

  function render() {
    if (!results.length) {
      setHTML(list, html`<p class="text-sm text-slate-500 px-3 py-6 text-center">${input.value.trim().length < 2 ? 'Tippe mindestens 2 Zeichen.' : 'Nichts gefunden.'}</p>`);
      return;
    }
    setHTML(list, html`${results.map((r, i) => {
      const t = TYPE[r.type] || TYPE.part;
      return html`<button class="spot-item w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent ${i === active ? 'active' : ''}" data-i="${i}">
        <span class="${t.color}">${icon(t.icon)}</span>
        <span class="flex-1 min-w-0"><span class="block text-sm font-semibold text-white truncate">${r.title}</span><span class="block text-xs text-slate-400 truncate">${r.subtitle || ''}</span></span>
        <span class="chip !text-[10px]">${t.label}</span>
      </button>`;
    })}`);
    const a = list.querySelector('.spot-item.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  function go(i) {
    const r = results[i];
    if (!r) return;
    m.close();
    app.navigate(r.target);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const my = ++seq;
      if (q.length < 2) { results = []; render(); return; }
      try {
        const res = await get(`/search?q=${encodeURIComponent(q)}`);
        if (my !== seq) return;
        results = res; active = 0; render();
      } catch { /* still */ }
    }, 140);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (e.key === 'Enter') { e.preventDefault(); go(active); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) go(Number(b.dataset.i)); });
  input.focus();
  setTimeout(() => input.focus(), 30);
}
