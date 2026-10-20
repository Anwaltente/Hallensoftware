/**
 * LED-Laufband (Motivations-Ticker)
 * Links: Live-Countdown zum nächsten Event (Tage : Stunden : Minuten, Sekundenpunkt blinkt).
 * Rechts: Laufschrift mit Status (offene To-Dos je Auto, Packliste, Driftreifen, leere Vorräte).
 * v4: kritischer Mangel und "liegt rum" stehen ganz vorne.
 */
import { store, app, setState, subscribe } from './state.js';
import { get } from './api.js';
import { html, setHTML } from './ui.js';

let root = null;
let timer = null;
let lastText = '';

const pad = (n) => String(Math.max(0, n)).padStart(2, '0');

export function eventStart(ev) {
  if (!ev) return null;
  return new Date(`${ev.date_start}T${ev.start_time || '08:00'}:00`);
}

function statusSegments(t) {
  const seg = [];
  // v4: kritischer Mangel ganz vorne, dann "liegt rum"
  const hud = store.hud;
  if (hud) {
    for (const c of hud.critical || []) seg.push(`KRITISCHER MANGEL: ${c.text.toUpperCase()}`);
    if (hud.floatCount) seg.push(`${hud.floatCount} ${hud.floatCount === 1 ? 'DING LIEGT' : 'DINGE LIEGEN'} IN DER HALLE RUM`);
  }
  if (!t || !t.event) {
    seg.push('KEIN EVENT GEPLANT', 'ZEIT ZUM SCHRAUBEN');
  } else {
    const start = eventStart(t.event);
    const days = Math.floor((start - Date.now()) / 86400000);
    const end = new Date(`${t.event.date_end || t.event.date_start}T23:59:59`);
    if (Date.now() >= start && Date.now() <= end) seg.push(`HEUTE IST ${t.event.name.toUpperCase()}! VOLLGAS`);
    else if (days <= 0) seg.push(`${t.event.name.toUpperCase()} STARTET IN WENIGEN STUNDEN`);
    else seg.push(`NOCH ${days} ${days === 1 ? 'TAG' : 'TAGE'} BIS ${t.event.name.toUpperCase()}`);
    if (t.event.location) seg.push(`ORT: ${t.event.location.toUpperCase()}`);
    for (const v of t.vehicles) {
      seg.push(v.open_tasks ? `${v.open_tasks} ${v.open_tasks === 1 ? 'TO-DO' : 'TO-DOS'} AM ${v.name.toUpperCase()} OFFEN` : `${v.name.toUpperCase()} IST STARTKLAR`);
    }
    if (t.packlist && t.packlist.total) seg.push(t.packlist.pct >= 100 ? 'PACKLISTE KOMPLETT' : `PACKLISTE ZU ${t.packlist.pct}% FERTIG`);
    if (typeof t.driftTyres === 'number') seg.push(`${t.driftTyres} DRIFTREIFEN AUF LAGER`);
  }
  for (const s of (t && t.low) || []) seg.push(`${s.name.toUpperCase()} ${s.qty <= 0 ? 'LEER' : 'FAST LEER'}!`);
  return seg;
}

function renderMarquee() {
  const t = store.ticker;
  const text = statusSegments(t).join('   ✦   ');
  if (text === lastText) return;
  lastText = text;
  const track = root.querySelector('[data-track]');
  const dur = Math.max(18, text.length * 0.22);
  setHTML(track, html`<span>${text}   ✦   </span><span aria-hidden="true">${text}   ✦   </span>`);
  track.style.animationDuration = `${dur}s`;
}

function tick() {
  const t = store.ticker;
  const cd = root.querySelector('[data-countdown]');
  const name = root.querySelector('[data-evname]');
  if (!t || !t.event) {
    name.textContent = 'KEIN EVENT';
    setHTML(cd, html`<span class="led-digits">-- : -- : --</span>`);
    return;
  }
  const diff = Math.max(0, eventStart(t.event) - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const blink = Math.floor(Date.now() / 500) % 2 === 0;
  name.textContent = t.event.name.toUpperCase();
  setHTML(cd, html`
    <span class="led-unit"><b>${pad(d)}</b><i>TAGE</i></span><span class="led-colon ${blink ? 'on' : ''}">:</span>
    <span class="led-unit"><b>${pad(h)}</b><i>STD</i></span><span class="led-colon ${blink ? 'on' : ''}">:</span>
    <span class="led-unit"><b>${pad(m)}</b><i>MIN</i></span>`);
  root.classList.toggle('led-hot', d < 3);
}

export async function refreshTicker() {
  try { setState({ ticker: await get('/ticker') }, ['ticker']); } catch { /* still */ }
}

export function initTicker(container) {
  root = container;
  setHTML(root, html`
    <div class="led-board">
      <button class="led-left" data-led-event title="Packliste öffnen">
        <span class="led-kicker">NÄCHSTES EVENT</span>
        <span class="led-name" data-evname></span>
        <span class="led-countdown" data-countdown></span>
      </button>
      <div class="led-marquee"><div class="led-track" data-track></div></div>
    </div>`);
  root.querySelector('[data-led-event]').addEventListener('click', () => {
    if (store.ticker && store.ticker.event) app.navigate({ kind: 'event', eventId: store.ticker.event.id });
  });
  subscribe('ticker', () => { renderMarquee(); tick(); });
  subscribe('hud', renderMarquee);   // v4
  let debounce = null;
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(refreshTicker, 800); };
  ['events', 'vehicles', 'supplies', 'whiteboard'].forEach((topic) => subscribe(topic, soon));
  clearInterval(timer);
  timer = setInterval(tick, 500);
  setInterval(refreshTicker, 60000);
  refreshTicker();
}
