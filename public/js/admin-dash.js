/**
 * v5.2: No-Code-Baukasten für das Hallen-TV (/tv bzw. /dashboard)
 * ------------------------------------------------------------
 * Seiten mit Raster (Vollbild, Split-Screen, 3 Spalten, 2×2 ...), jede Kachel bekommt per Auswahlliste
 * oder Drag & Drop ein Widget. Mehrere Seiten rotieren auf dem TV (allgemeines Intervall oder eigene Dauer je Seite).
 * Gespeichert in der Tabelle dashboard_configs (API /api/admin/dashboards), jede Änderung sofort.
 */
import { get, post, put, del } from './api.js';
import { html, setHTML, on, icon, toast, toastError, confirmDialog } from './ui.js';

export const DASH_WIDGETS = {
  event: ['⏱️', 'Event-Countdown & Packliste'],
  work: ['🔧', 'Wer schraubt woran?'],
  tasks: ['✅', 'Heute zu tun'],
  shortage: ['⚠️', 'Mangel-Radar (Stoffe & Getränke)'],
  tools: ['🛠️', 'Werkzeug-Radar (verliehen / schwebend)'],
  hall: ['🅿️', 'Hallen-Belegung (freie Plätze)'],
  banner: ['📣', 'Text-Banner / Laufband'],
  weather: ['☀️', 'Wetter'],
  empty: ['▫️', 'Leer']
};
export const DASH_LAYOUTS = {
  '1x1': ['Vollbild', 1], split: ['Split-Screen', 2], 'split-h': ['Oben / Unten', 2], '3col': ['3 Spalten', 3],
  '2x2': ['2 × 2 Kacheln', 4], 'main-side': ['Groß + 2 klein', 3], '3x2': ['3 × 2 Kacheln', 6]
};
const TONES = { info: 'Neutral', ok: 'Grün', warn: 'Gelb (Hinweis)', alarm: 'Rot (Alarm)' };

export async function renderDashBuilder(root, { tvUrl = '' } = {}) {
  let state;
  try { state = await get('/admin/dashboards'); } catch (err) { toastError(err); return; }
  const timers = new Map();

  const slideById = (id) => state.slides.find((s) => s.id === Number(id));
  const fitTiles = (layout, tiles) => Array.from({ length: DASH_LAYOUTS[layout][1] }, (_, i) => tiles[i] || { widget: 'empty' });

  const cell = (sl, t, i) => {
    const [emo, label] = DASH_WIDGETS[t.widget] || DASH_WIDGETS.empty;
    return html`
      <div class="dash-cell ${t.widget === 'empty' ? 'is-empty' : ''}" data-cell="${i}" draggable="true" title="Ziehen zum Tauschen, Widget aus der Palette hierher ziehen">
        <div class="flex items-center gap-1.5 min-w-0"><span class="dash-emo">${emo}</span><span class="text-[11px] font-semibold text-white truncate flex-1">${label}</span></div>
        <select class="select !py-1 !text-xs mt-1" data-tile="${i}">${Object.entries(DASH_WIDGETS).map(([k, [, l]]) => html`<option value="${k}" ${t.widget === k ? 'selected' : ''}>${l}</option>`)}</select>
        ${t.widget === 'banner' ? html`
          <textarea class="input !text-xs mt-1" rows="2" data-btext="${i}" placeholder="Team-Info, z. B. Samstag 10 Uhr Reifen umziehen!">${t.text || ''}</textarea>
          <div class="flex items-center gap-2 mt-1">
            <label class="flex items-center gap-1 text-[11px] text-slate-300"><input type="checkbox" class="check !w-4 !h-4" data-bscroll="${i}" ${t.scroll ? 'checked' : ''}> Laufband</label>
            <select class="select !py-0.5 !text-[11px] flex-1" data-btone="${i}">${Object.entries(TONES).map(([k, l]) => html`<option value="${k}" ${(t.tone || 'info') === k ? 'selected' : ''}>${l}</option>`)}</select>
          </div>` : ''}
        ${t.widget !== 'empty' && t.widget !== 'banner' ? html`<input class="input !py-0.5 !text-[11px] mt-1" data-ttitle="${i}" value="${t.title || ''}" placeholder="eigene Überschrift (optional)">` : ''}
      </div>`;
  };

  const slideCard = (sl, i) => html`
    <div class="card p-3 dash-slide ${sl.active ? '' : 'opacity-60'}" data-slide="${sl.id}">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip font-mono">${i + 1}</span>
        <input class="input !py-1 text-sm !w-44 flex-1 min-w-[8rem]" data-f="name" value="${sl.name}" placeholder="Name der Seite">
        <label class="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" class="check !w-4 !h-4" data-f="active" ${sl.active ? 'checked' : ''}> aktiv</label>
        <label class="flex items-center gap-1.5 text-xs text-slate-400">Dauer <input class="input !py-1 !w-16 text-xs font-mono" type="number" min="5" max="300" data-f="duration" value="${sl.duration || ''}" placeholder="${state.interval}"> s</label>
        <span class="flex-1"></span>
        <span class="text-[11px] text-slate-500 min-w-[5rem] text-right" data-st></span>
        <button class="btn-icon !w-7 !h-7" data-mv="-1" title="Nach vorne" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-icon !w-7 !h-7" data-mv="1" title="Nach hinten" ${i === state.slides.length - 1 ? 'disabled' : ''}>▼</button>
        ${tvUrl ? html`<a class="btn btn-sm" href="${tvUrl}&slide=${sl.id}" target="_blank" rel="noopener" title="Diese Seite auf dem TV ansehen">${icon('eye', 'w-3.5 h-3.5')}</a>` : ''}
        <button class="btn btn-sm" data-dup title="Kopieren">${icon('layers', 'w-3.5 h-3.5')}</button>
        <button class="btn-icon !w-7 !h-7 hover:!text-rose-300" data-delslide title="Löschen">${icon('trash', 'w-3.5 h-3.5')}</button>
      </div>
      <div class="flex flex-wrap gap-1.5 mt-2.5">${Object.entries(DASH_LAYOUTS).map(([k, [l, n]]) => html`
        <button class="dash-lay ${sl.layout === k ? 'on' : ''}" data-layout="${k}" title="${l}">
          <span class="dash-mini dl-${k}">${Array.from({ length: n }, () => html`<i></i>`)}</span><span>${l}</span></button>`)}</div>
      <div class="dash-grid dl-${sl.layout} mt-2.5">${sl.tiles.map((t, ti) => cell(sl, t, ti))}</div>
    </div>`;

  function render() {
    setHTML(root, html`
      <div class="card p-4 space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-cyan-300">${icon('grid', 'w-6 h-6')}</span>
          <div class="flex-1 min-w-[220px]"><h3 class="font-display font-bold text-white text-lg">Dashboard-Baukasten</h3>
            <p class="text-sm text-slate-400">Raster wählen, Widgets per Auswahl oder Drag & Drop in die Kacheln. Mehrere Seiten wechseln automatisch.</p></div>
          <label class="flex items-center gap-2 card px-3 py-2 cursor-pointer ${state.useGrid ? '!border-lime-400/50' : ''}">
            <input type="checkbox" class="check" data-usegrid ${state.useGrid ? 'checked' : ''}>
            <span class="text-sm"><b class="${state.useGrid ? 'text-lime-300' : 'text-white'}">Eigene Seiten auf dem TV</b><br><span class="text-[11px] text-slate-400">${state.useGrid ? 'aktiv: das TV zeigt diese Seiten' : 'aus: das TV zeigt die Standard-Screens'}</span></span>
          </label>
          <button class="btn btn-primary" data-newslide>${icon('plus')} Neue Seite</button>
        </div>
        <div class="dash-palette">
          <span class="text-[11px] text-slate-500 mr-1">Widgets ziehen:</span>
          ${Object.entries(DASH_WIDGETS).filter(([k]) => k !== 'empty').map(([k, [e, l]]) => html`<span class="chip chip-btn" draggable="true" data-wdrag="${k}">${e} ${l}</span>`)}
        </div>
        <div class="space-y-3" data-slides>${state.slides.map((sl, i) => slideCard(sl, i))}</div>
        ${!state.slides.length ? html`<p class="text-sm text-slate-500">Noch keine Seite. Lege mit „Neue Seite“ die erste an.</p>` : ''}
        <p class="text-[11px] text-slate-500">Allgemeines Intervall: ${state.interval} s (oben einstellbar). Eine eigene Dauer gilt nur für ihre Seite. Änderungen werden sofort gespeichert, das TV übernimmt sie beim nächsten Abruf (spätestens nach 30 s).</p>
      </div>`);
  }

  function rerenderSlide(id) {
    const i = state.slides.findIndex((s) => s.id === Number(id));
    const elx = root.querySelector(`[data-slide="${id}"]`);
    if (i < 0 || !elx) { render(); return; }
    const tmp = document.createElement('div');
    setHTML(tmp, slideCard(state.slides[i], i));
    elx.replaceWith(tmp.firstElementChild);
  }

  const status = (id, text) => { const st = root.querySelector(`[data-slide="${id}"] [data-st]`); if (st) st.textContent = text; };

  function save(id, { now = false, redraw = false } = {}) {
    const sl = slideById(id);
    if (!sl) return;
    clearTimeout(timers.get(id));
    status(id, 'speichert …');
    const run = async () => {
      try {
        const saved = await put(`/admin/dashboards/${id}`, { name: sl.name, layout: sl.layout, tiles: sl.tiles, duration: sl.duration || null, active: sl.active });
        Object.assign(sl, saved);
        if (redraw) rerenderSlide(id);
        status(id, 'gespeichert ✓');
      } catch (err) { status(id, 'Fehler'); toastError(err); }
    };
    if (now) run(); else timers.set(id, setTimeout(run, 450));
  }

  render();
  if (root.dataset.dashBound) return;
  root.dataset.dashBound = '1';

  on(root, 'change', '[data-usegrid]', async (_e, c) => {
    try {
      await put('/admin/tv', { useGrid: c.checked });
      state.useGrid = c.checked;
      render();
      toast(c.checked ? 'Das TV zeigt jetzt deine eigenen Seiten.' : 'Das TV zeigt wieder die Standard-Screens.', 'ok');
    } catch (err) { toastError(err); c.checked = !c.checked; }
  });
  on(root, 'click', '[data-newslide]', async () => {
    try {
      const sl = await post('/admin/dashboards', { name: `Seite ${state.slides.length + 1}`, layout: '2x2', tiles: [{ widget: 'event' }, { widget: 'work' }, { widget: 'shortage' }, { widget: 'tools' }] });
      state.slides.push(sl);
      render();
    } catch (err) { toastError(err); }
  });
  const slideOfEl = (elx) => slideById(elx.closest('[data-slide]').dataset.slide);
  on(root, 'input', '[data-f="name"], [data-f="duration"]', (_e, inp) => {
    const sl = slideOfEl(inp);
    if (inp.dataset.f === 'name') sl.name = inp.value;
    else sl.duration = inp.value ? Number(inp.value) : null;
    save(sl.id);
  });
  on(root, 'change', '[data-f="active"]', (_e, c) => { const sl = slideOfEl(c); sl.active = c.checked; c.closest('[data-slide]').classList.toggle('opacity-60', !c.checked); save(sl.id, { now: true }); });
  on(root, 'click', '[data-layout]', (_e, b) => {
    const sl = slideOfEl(b);
    sl.layout = b.dataset.layout;
    sl.tiles = fitTiles(sl.layout, sl.tiles);
    rerenderSlide(sl.id);
    save(sl.id, { now: true });
  });
  on(root, 'change', '[data-tile]', (_e, s) => {
    const sl = slideOfEl(s);
    const i = Number(s.dataset.tile);
    sl.tiles[i] = { widget: s.value, ...(s.value === 'banner' ? { text: sl.tiles[i].text || '', tone: 'info' } : {}) };
    rerenderSlide(sl.id);
    save(sl.id, { now: true });
  });
  on(root, 'input', '[data-btext], [data-ttitle]', (_e, t) => {
    const sl = slideOfEl(t);
    const i = Number(t.dataset.btext ?? t.dataset.ttitle);
    if (t.dataset.btext !== undefined) sl.tiles[i].text = t.value; else sl.tiles[i].title = t.value;
    save(sl.id);
  });
  on(root, 'change', '[data-bscroll], [data-btone]', (_e, t) => {
    const sl = slideOfEl(t);
    const i = Number(t.dataset.bscroll ?? t.dataset.btone);
    if (t.dataset.bscroll !== undefined) sl.tiles[i].scroll = t.checked; else sl.tiles[i].tone = t.value;
    save(sl.id, { now: true });
  });
  on(root, 'click', '[data-mv]', async (_e, b) => {
    const sl = slideOfEl(b);
    const i = state.slides.indexOf(sl);
    const j = i + Number(b.dataset.mv);
    if (j < 0 || j >= state.slides.length) return;
    [state.slides[i], state.slides[j]] = [state.slides[j], state.slides[i]];
    render();
    try { state.slides = await post('/admin/dashboards/order', { ids: state.slides.map((s) => s.id) }); } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-dup]', async (_e, b) => {
    const sl = slideOfEl(b);
    try {
      const copy = await post('/admin/dashboards', { name: `${sl.name} (Kopie)`, layout: sl.layout, tiles: sl.tiles, duration: sl.duration, active: false });
      state.slides.push(copy);
      render();
      toast('Kopie angelegt (noch nicht aktiv).', 'ok');
    } catch (err) { toastError(err); }
  });
  on(root, 'click', '[data-delslide]', async (_e, b) => {
    const sl = slideOfEl(b);
    if (!(await confirmDialog(`Seite „${sl.name}“ löschen?`, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/admin/dashboards/${sl.id}`); state.slides = state.slides.filter((x) => x.id !== sl.id); render(); } catch (err) { toastError(err); }
  });

  // Drag & Drop: Widget aus der Palette in eine Kachel, Kacheln untereinander tauschen
  let drag = null;
  root.addEventListener('dragstart', (e) => {
    const w = e.target.closest && e.target.closest('[data-wdrag]');
    const c = e.target.closest && e.target.closest('[data-cell]');
    if (w) drag = { widget: w.dataset.wdrag };
    else if (c) drag = { slide: Number(c.closest('[data-slide]').dataset.slide), cell: Number(c.dataset.cell) };
    else return;
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', JSON.stringify(drag)); } catch { /* egal */ }
  });
  root.addEventListener('dragover', (e) => {
    if (!drag) return;
    const c = e.target.closest('[data-cell]');
    root.querySelectorAll('.dash-cell.drop').forEach((x) => { if (x !== c) x.classList.remove('drop'); });
    if (!c) return;
    e.preventDefault();
    c.classList.add('drop');
  });
  root.addEventListener('drop', (e) => {
    const c = e.target.closest('[data-cell]');
    root.querySelectorAll('.dash-cell.drop').forEach((x) => x.classList.remove('drop'));
    if (!c || !drag) return;
    e.preventDefault();
    const sl = slideOfEl(c);
    const i = Number(c.dataset.cell);
    if (drag.widget) sl.tiles[i] = { widget: drag.widget, ...(drag.widget === 'banner' ? { text: '', tone: 'info' } : {}) };
    else if (drag.slide === sl.id) { const tmp = sl.tiles[i]; sl.tiles[i] = sl.tiles[drag.cell]; sl.tiles[drag.cell] = tmp; }
    else { const from = slideById(drag.slide); if (from) sl.tiles[i] = { ...from.tiles[drag.cell] }; }
    drag = null;
    rerenderSlide(sl.id);
    save(sl.id, { now: true });
  });
  root.addEventListener('dragend', () => { drag = null; root.querySelectorAll('.dash-cell.drop').forEach((x) => x.classList.remove('drop')); });
}
