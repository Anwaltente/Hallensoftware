/**
 * v5.3: Admin-Konsole · Aktivitäts- & Audit-Log
 *   Grobe Übersicht (Meilensteine): Anmeldungen/Profilwechsel, Materialentnahmen, Umparken, erledigte und pausierte To-dos, Setup-Änderungen
 *   Detailansicht: jeder Klick und jede Änderung mit Zeitstempel
 *   Filter: Person, Zeitraum, Suchtext
 */
import { get } from './api.js';
import { html, setHTML, on, icon, toastError, initials, raw, esc } from './ui.js';

const TYPES = {
  login: ['Anmeldung', '#22d3ee', 'user'],
  logout: ['Abmeldung', '#64748b', 'logout'],
  profile_switch: ['Profilwechsel', '#22d3ee', 'users'],
  login_failed: ['Login fehlgeschlagen', '#f43f5e', 'lock'],
  quickuse: ['Materialentnahme', '#f59e0b', 'package'],
  vehicle_move: ['Umgeparkt', '#a78bfa', 'move'],
  task_done: ['To-do erledigt', '#84cc16', 'check'],
  task_pause: ['Nicht fertig', '#f97316', 'pause'],
  setup_change: ['Setup', '#f472b6', 'gauge'],
  task_assign: ['Zuweisung', '#38bdf8', 'users'],
  pdf_export: ['PDF-Export', '#94a3b8', 'file'],
  ui_click: ['Klick', '#475569', 'target'],
  ui_open: ['Geöffnet', '#0ea5e9', 'eye'],
  ui_map: ['Hallenkarte', '#0891b2', 'map'],
  ui_search: ['Suche', '#8b5cf6', 'search'],
  ui_export: ['Export', '#94a3b8', 'download']
};
const typeInfo = (t) => TYPES[t] || (String(t).startsWith('api_') ? ['Änderung', '#3b82f6', 'edit'] : String(t).startsWith('ui_') ? ['Interaktion', '#475569', 'target'] : [t, '#64748b', 'activity']);

const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const timeLabel = (ts) => new Date(ts).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function detailHtml(d) {
  if (!d || typeof d !== 'object') return '';
  const fmt = (v) => (v === null || v === undefined ? 'leer' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (Array.isArray(d.changes) && d.changes.length) {
    return html`<div class="act-det"><div class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Änderungen</div>
      ${d.changes.map((c) => html`<div class="flex gap-2 text-xs"><span class="text-slate-400 min-w-[7rem]">${c.feld}</span><span class="text-rose-300 line-through">${fmt(c.vorher)}</span><span class="text-slate-500">→</span><span class="text-lime-300">${fmt(c.nachher)}</span></div>`)}</div>`;
  }
  const entries = Object.entries(d).filter(([k]) => k !== 'changes');
  if (!entries.length) return '';
  return html`<div class="act-det">${entries.map(([k, v]) => html`<div class="flex gap-2 text-xs"><span class="text-slate-500 min-w-[6.5rem]">${k}</span><span class="text-slate-300 break-all font-mono">${raw(esc(fmt(v).slice(0, 1200)))}</span></div>`)}</div>`;
}

export async function tabActivity(c0) {
  const c = c0.cloneNode(false);
  c0.replaceWith(c);
  const st = { level: 'high', user: '', from: iso(new Date(Date.now() - 6 * 86400000)), to: '', q: '', range: '6', rows: [], hasMore: false, users: [], open: new Set(), loading: false };

  async function load({ more = false } = {}) {
    if (st.loading) return;
    st.loading = true;
    const qs = new URLSearchParams({ level: st.level, limit: '120' });
    if (st.user) qs.set('user', st.user);
    if (st.from) qs.set('from', st.from);
    if (st.to) qs.set('to', st.to);
    if (st.q) qs.set('q', st.q);
    if (more && st.rows.length) qs.set('before', String(st.rows[st.rows.length - 1].id));
    try {
      const res = await get(`/admin/activity?${qs}`);
      st.rows = more ? [...st.rows, ...res.rows] : res.rows;
      st.hasMore = res.hasMore;
      st.users = res.users || [];
    } catch (err) { toastError(err); }
    st.loading = false;
    renderList();
  }

  const userColor = (name) => (st.users.find((u) => u.name === name) || {}).color || '#94a3b8';

  function renderShell() {
    setHTML(c, html`
      <div class="act-wrap">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <div class="mode-switch" data-level>
            <button type="button" data-lv="high" class="${st.level === 'high' ? 'on' : ''}">${icon('flag', 'w-3.5 h-3.5')} Meilensteine</button>
            <button type="button" data-lv="all" class="${st.level === 'all' ? 'on' : ''}">${icon('activity', 'w-3.5 h-3.5')} Alle Klicks &amp; Ereignisse</button>
          </div>
          <button class="btn btn-sm ml-auto" data-reload title="Neu laden">${icon('refresh', 'w-3.5 h-3.5')} Aktualisieren</button>
        </div>
        <div class="act-filters card p-3 mb-3">
          <label><span class="label">Person</span><select class="select" data-f="user"><option value="">Alle</option></select></label>
          <label><span class="label">Von</span><input class="input" type="date" data-f="from" value="${st.from}"></label>
          <label><span class="label">Bis</span><input class="input" type="date" data-f="to" value="${st.to}"></label>
          <label class="act-q"><span class="label">Suche</span><input class="input" data-f="q" placeholder="z. B. E46, Querlenker, Regal B" value="${st.q}"></label>
          <div class="act-quick">${[['0', 'Heute'], ['6', '7 Tage'], ['29', '30 Tage'], ['all', 'Alles']].map(([k, l]) => html`<button type="button" class="chip chip-btn ${st.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`)}</div>
        </div>
        <p class="text-[11px] text-slate-500 mb-2" data-hint>${st.level === 'high'
          ? 'Grobe Übersicht: Anmeldungen und Profilwechsel, Materialentnahmen (Schnell-Verbrauch), Umparken, erledigte und pausierte To-dos, Setup-Änderungen.'
          : 'Detailansicht: jeder Klick und jede Änderung mit Zeitstempel. Zeile antippen für Details. PIN-Eingaben werden nie protokolliert.'}</p>
        <div data-list><p class="text-sm text-slate-500 p-4">Lädt …</p></div>
      </div>`);
  }

  function renderList() {
    const sel = c.querySelector('[data-f="user"]');
    if (sel && sel.options.length <= 1) {
      setHTML(sel, html`<option value="">Alle</option>${st.users.map((u) => html`<option value="${u.name}" ${st.user === u.name ? 'selected' : ''}>${u.name}</option>`)}<option value="Gast" ${st.user === 'Gast' ? 'selected' : ''}>Gast (Hall Pass)</option>`);
    }
    const list = c.querySelector('[data-list]');
    if (!st.rows.length) { setHTML(list, html`<div class="card p-6 text-center text-sm text-slate-400">${icon('activity', 'w-6 h-6 mx-auto mb-2 text-slate-500')}Keine Einträge für diese Auswahl.</div>`); return; }
    const groups = [];
    for (const r of st.rows) {
      const d = iso(new Date(r.created_at));
      if (!groups.length || groups[groups.length - 1].day !== d) groups.push({ day: d, label: dayLabel(r.created_at), rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    setHTML(list, html`
      ${groups.map((g) => html`
        <div class="act-day">${g.label}<span>${g.rows.length}</span></div>
        <div class="act-list">
          ${g.rows.map((r) => {
            const [label, color, ic] = typeInfo(r.action_type);
            const open = st.open.has(r.id);
            return html`<div class="act-row ${r.is_high_level ? 'is-high' : ''} ${open ? 'open' : ''}" data-row="${r.id}" style="--ac:${color}">
              <div class="act-time">${timeLabel(r.created_at)}</div>
              <span class="act-ava" style="background:${userColor(r.user_name)}" title="${r.user_name || ''}">${initials(r.user_name || '?')}</span>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-1.5"><span class="act-badge">${icon(ic, 'w-3 h-3')} ${label}</span><span class="text-[11px] text-slate-400">${r.user_name || 'Unbekannt'}</span></div>
                <div class="act-text">${r.description}</div>
                ${open ? detailHtml(r.details) : ''}
              </div>
            </div>`;
          })}
        </div>`)}
      ${st.hasMore ? html`<button class="btn w-full mt-3" data-more>${icon('plus', 'w-3.5 h-3.5')} Ältere Einträge laden</button>` : html`<p class="text-[11px] text-slate-600 text-center mt-3">Ende der Liste.</p>`}`);
  }

  renderShell();
  on(c, 'click', '[data-lv]', (_e, b) => { st.level = b.dataset.lv; st.open.clear(); renderShell(); load(); });
  on(c, 'click', '[data-reload]', () => load());
  on(c, 'click', '[data-more]', () => load({ more: true }));
  on(c, 'click', '[data-row]', (e, r) => {
    if (e.target.closest('a, button')) return;
    const id = Number(r.dataset.row);
    if (st.open.has(id)) st.open.delete(id); else st.open.add(id);
    renderList();
  });
  on(c, 'click', '[data-range]', (_e, b) => {
    const k = b.dataset.range;
    st.range = k;
    c.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('on', x === b));
    st.from = k === 'all' ? '' : iso(new Date(Date.now() - Number(k) * 86400000));
    st.to = '';
    c.querySelector('[data-f="from"]').value = st.from;
    c.querySelector('[data-f="to"]').value = '';
    load();
  });
  on(c, 'change', '[data-f]', (_e, inp) => {
    st[inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'from' || inp.dataset.f === 'to') { st.range = ''; c.querySelectorAll('[data-range]').forEach((x) => x.classList.remove('on')); }
    if (inp.dataset.f !== 'q') load();
  });
  let qt = null;
  on(c, 'input', '[data-f="q"]', (_e, inp) => { clearTimeout(qt); qt = setTimeout(() => { st.q = inp.value.trim(); load(); }, 300); });
  load();
}
