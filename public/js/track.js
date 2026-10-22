/**
 * v5.3: Aktivitäts-Log im Browser (Detail-Ebene)
 * Sammelt Klicks und wichtige Interaktionen ("Öffnete Regal B", "Klickte auf Auto E46", "Startete Suche nach ...")
 * und schickt sie gebündelt an /api/activity/track (alle paar Sekunden bzw. beim Verlassen der Seite).
 * Nie protokolliert: der Anmeldebildschirm, PIN-Eingaben und Inhalte von Eingabefeldern.
 */
import { store } from './state.js';

const queue = [];
let timer = null;
let lastKey = '';
let lastAt = 0;

const clean = (s, n = 70) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function track(text, type = 'click', details = null) {
  if (!store.me || !text) return;
  const now = Date.now();
  const key = `${type}|${text}`;
  if (key === lastKey && now - lastAt < 700) return;   // Doppel-Events (Touch + Klick) zusammenfassen
  lastKey = key; lastAt = now;
  queue.push({ type, text: clean(text, 200), details, t: new Date(now).toISOString() });
  if (queue.length >= 40) flush();
  else if (!timer) timer = setTimeout(flush, 6000);
}

export function flush(beacon = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return Promise.resolve();
  const events = queue.splice(0, 100);
  const body = JSON.stringify({ events });
  if (beacon && navigator.sendBeacon) {
    try { if (navigator.sendBeacon('/api/activity/track', new Blob([body], { type: 'application/json' }))) return Promise.resolve(); } catch { /* weiter mit fetch */ }
  }
  return fetch('/api/activity/track', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .then(() => {}).catch(() => {});
}

const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], summary, label, .chip-btn, .eurobox, [data-act], [data-vehicle], [data-lg-part], [data-tool]';

function contextOf(t) {
  const modal = t.closest('.modal-panel');
  if (modal) { const h = modal.querySelector('h2'); return h ? clean(h.textContent, 40) : 'Dialog'; }
  if (t.closest('#leftPanel')) return 'Whiteboard';
  if (t.closest('#rightPanel')) { const a = document.querySelector('#rightTabs .tab.active'); return a ? clean(a.textContent, 30) : 'Seitenleiste'; }
  if (t.closest('#mobileNav')) return 'Navigation';
  if (t.closest('#topBar')) return 'Kopfzeile';
  if (t.closest('#bizWorkspace')) return 'Büro-Ansicht';
  if (t.closest('#hudDock, #hud')) return 'HUD';
  if (t.closest('.bz-menu')) return 'Profilmenü';
  if (t.closest('#mapArea')) return 'Hallenkarte';
  return '';
}

function labelOf(t) {
  const aria = t.getAttribute('aria-label') || t.getAttribute('title');
  let txt = '';
  if (t.matches('.eurobox') && t.getAttribute('title')) txt = t.getAttribute('title');
  if (!txt) {
    txt = (t.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    // CSS-Großschreibung (z. B. Reiter) zurück in die echte Schreibweise
    if (txt && txt === txt.toUpperCase() && /[A-ZÄÖÜ]/.test(txt)) {
      const tc = String(t.textContent || '').replace(/\s+/g, ' ').trim();
      const i = tc.toUpperCase().indexOf(txt);
      if (i >= 0) txt = tc.slice(i, i + txt.length);
    }
  }
  if (!txt || txt.length < 2) txt = aria || txt;
  if (!txt) {
    const d = t.dataset || {};
    txt = d.act || d.tab || d.view || d.mode || Object.keys(d)[0] || '';
  }
  return clean(txt, 60);
}

function onClick(e) {
  if (!store.me) return;
  const t = e.target && e.target.closest && e.target.closest(CLICKABLE);
  if (!t || t.closest('[data-nolog], #loginRoot')) return;
  if (t.matches('label') && t.querySelector('input[type="text"], input[type="number"], input[type="date"], textarea, select')) return;
  const label = labelOf(t);
  if (!label) return;
  const ctx = contextOf(t);
  track(`Klickte „${label}“${ctx && ctx !== label ? ` (${ctx})` : ''}`, 'click');
}

let started = false;
export function initTracking() {
  if (started) return;
  started = true;
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', () => flush(true));
  window.HALLE_TRACK_FLUSH = () => flush();
}
