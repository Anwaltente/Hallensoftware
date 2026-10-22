/**
 * UI-Helfer: sicheres HTML-Templating, Icons, Modals, Toasts, Haptik, Formatierung.
 * Alle Module bauen ihre Oberfläche mit diesen Bausteinen.
 */

/* ---------------- Sicheres Templating ---------------- */
export const raw = (s) => ({ __raw: String(s ?? '') });

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderVal(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(renderVal).join('');
  if (typeof v === 'object' && v.__raw !== undefined) return v.__raw;
  return esc(v);
}

/** Tagged Template: alle Werte werden escaped, außer raw()/html``-Fragmente. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += renderVal(vals[i]); });
  return raw(out);
}

export function setHTML(node, fragment) {
  node.innerHTML = renderVal(fragment);
  return node;
}

export function el(fragment) {
  const t = document.createElement('template');
  t.innerHTML = renderVal(fragment).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Event-Delegation: on(root, 'click', '[data-act]', fn) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) fn(e, target);
  });
}

export function formData(form) {
  const data = {};
  for (const elx of form.elements) {
    if (!elx.name || elx.disabled) continue;
    if (elx.type === 'checkbox') data[elx.name] = elx.checked;
    else if (elx.type === 'radio') { if (elx.checked) data[elx.name] = elx.value; }
    else if (elx.type === 'file') continue;
    else data[elx.name] = elx.value;
  }
  return data;
}

/* ---------------- Icons (Stroke-SVG, lucide-inspiriert) ---------------- */
const ICONS = {
  car: '<path d="M5 17h14M6 17v2M18 17v2"/><path d="M3 13l2-6a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 7l2 6v4H3z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>',
  map: '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  zap: '<path d="M13 2L3 14h8l-1 8 10-12h-8z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h18"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  print: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="9" rx="2"/><path d="M6 14h12v8H6z"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  pin: '<path d="M12 21s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  refresh: '<path d="M21 2v6h-6M3 22v-6h6"/><path d="M3.5 9a9 9 0 0 1 15-3.4L21 8M20.5 15a9 9 0 0 1-15 3.4L3 16"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  package: '<path d="M16.5 9.4L7.5 4.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  zoomin: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  board: '<rect x="2" y="3" width="20" height="14" rx="1"/><path d="M8 21l4-4 4 4M6 8h8M6 12h5"/>',
  shelf: '<rect x="3" y="2" width="18" height="20" rx="1"/><path d="M3 8h18M3 14h18M3 20h18"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  tyre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7z"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M17 17h4v4h-4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M9 6v2M9 13v3"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>'
};

export function icon(name, cls = 'w-4 h-4') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`);
}

/* ---------------- Formatierung ---------------- */
const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const euro = (n) => euroFmt.format(Number(n) || 0);

export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: opts.short ? '2-digit' : 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

export function since(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `seit ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `seit ${h} h ${min % 60} min`;
  return `seit ${Math.floor(h / 24)} Tagen`;
}

export function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

export function countdownLabel(days) {
  if (days < 0) return 'vorbei';
  if (days === 0) return 'HEUTE';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
}

export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

/* ---------------- Haptik & Toasts ---------------- */
export function haptic(pattern = 12) {
  if (document.documentElement.classList.contains('biz')) return; // v5: Büro-Ansicht ohne Vibration
  try {
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && active) navigator.vibrate(pattern);
  } catch { /* ignorieren */ }
}

export function toast(message, type = 'info', ms = 3200, action = null) {
  const root = document.getElementById('toastRoot');
  const colors = { info: 'border-cyan-400/60 text-cyan-100', ok: 'border-lime-400/60 text-lime-100', warn: 'border-amber-400/70 text-amber-100', error: 'border-rose-500/70 text-rose-100' };
  const node = el(html`<div class="toast pointer-events-auto glass border-l-4 ${colors[type] || colors.info} px-4 py-3 rounded-md text-sm shadow-xl flex items-center gap-3">
    <span class="flex-1">${message}</span>${action ? html`<button class="btn btn-sm shrink-0" data-toast-action>${action.label}</button>` : ''}</div>`);
  root.appendChild(node);
  const remove = () => { node.classList.add('toast-out'); setTimeout(() => node.remove(), 300); };
  if (action) node.querySelector('[data-toast-action]').addEventListener('click', () => { remove(); action.onClick(); });
  setTimeout(remove, ms);
}

export function toastError(err) {
  toast(err && err.message ? err.message : String(err), 'error', 4500);
}

/* ---------------- Modals ---------------- */
const stack = [];

/**
 * openModal({ title, subtitle, size, body, footer, onClose, className })
 * body/footer: html``-Fragment oder HTMLElement. Gibt { el, body, close } zurück.
 */
export function openModal({ title = '', subtitle = '', size = 'md', body = '', footer = null, onClose = null, className = '', iconName = null } = {}) {
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[1400px]' };
  const root = document.getElementById('modalRoot');
  const wrap = el(html`
    <div class="modal-wrap fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div class="modal-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" data-close></div>
      <div class="modal-panel relative w-full ${sizes[size] || sizes.md} max-h-[92vh] sm:max-h-[88vh] flex flex-col panel-industrial rounded-t-2xl sm:rounded-xl ${className}">
        <div class="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-white/10">
          ${iconName ? html`<div class="mt-0.5 text-cyan-300">${icon(iconName, 'w-5 h-5')}</div>` : ''}
          <div class="flex-1 min-w-0">
            <h2 class="font-display text-lg font-semibold tracking-wide text-white truncate">${title}</h2>
            ${subtitle ? html`<p class="text-xs text-slate-400 mt-0.5">${subtitle}</p>` : ''}
          </div>
          <button class="btn-icon" data-close title="Schließen (Esc)">${icon('x', 'w-5 h-5')}</button>
        </div>
        <div class="modal-body flex-1 overflow-y-auto px-5 py-4"></div>
        <div class="modal-footer hidden px-5 py-3 border-t border-white/10 flex flex-wrap gap-2 justify-end"></div>
      </div>
    </div>`);
  const bodyEl = wrap.querySelector('.modal-body');
  const footEl = wrap.querySelector('.modal-footer');
  if (body instanceof HTMLElement) bodyEl.appendChild(body); else setHTML(bodyEl, body);
  if (footer) { footEl.classList.remove('hidden'); if (footer instanceof HTMLElement) footEl.appendChild(footer); else setHTML(footEl, footer); }

  let closed = false;
  const api = {
    el: wrap, body: bodyEl, footer: footEl,
    close(result) {
      if (closed) return;
      closed = true;
      wrap.classList.add('modal-out');
      setTimeout(() => wrap.remove(), 180);
      const idx = stack.indexOf(api);
      if (idx >= 0) stack.splice(idx, 1);
      if (onClose) onClose(result);
    },
    setFooter(fragment) { footEl.classList.remove('hidden'); setHTML(footEl, fragment); }
  };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  root.appendChild(wrap);
  stack.push(api);
  requestAnimationFrame(() => wrap.classList.add('modal-in'));
  return api;
}

export const topModal = () => stack[stack.length - 1] || null;
export const closeAllModals = () => [...stack].reverse().forEach((m) => m.close());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
});

export function confirmDialog(text, { title = 'Sicher?', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title, size: 'sm', iconName: danger ? 'alert' : 'check',
      body: html`<p class="text-slate-300">${text}</p>`,
      footer: html`<button class="btn" data-close>Abbrechen</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okLabel}</button>`,
      onClose: () => { if (!answered) resolve(false); }
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); m.close(); });
  });
}

/** Auswahl aus Chips + optional Freitext. Gibt String oder null zurück. */
export function chooseDialog({ title, text = '', choices = [], allowText = true, placeholder = 'Eigener Text ...', okLabel = 'Übernehmen' }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title, size: 'sm',
      body: html`
        ${text ? html`<p class="text-slate-400 text-sm mb-3">${text}</p>` : ''}
        <div class="flex flex-wrap gap-2 mb-3">${choices.map((c) => html`<button class="chip chip-btn" data-choice="${c}">${c}</button>`)}</div>
        ${allowText ? html`<form class="flex gap-2" data-form><input class="input flex-1" name="text" placeholder="${placeholder}"><button class="btn btn-primary">${okLabel}</button></form>` : ''}`,
      onClose: () => { if (!answered) resolve(null); }
    });
    on(m.body, 'click', '[data-choice]', (_e, t) => { answered = true; resolve(t.dataset.choice); m.close(); });
    const f = m.body.querySelector('[data-form]');
    if (f) f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = f.text.value.trim();
      if (!v) return;
      answered = true; resolve(v); m.close();
    });
  });
}

/** PIN-Pad (Touch-freundlich). Gibt Promise<string|null>. */
export function pinPad({ title = 'PIN eingeben', subtitle = '' } = {}) {
  return new Promise((resolve) => {
    let pin = '';
    let answered = false;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
    const m = openModal({
      title, subtitle, size: 'sm', iconName: 'lock',
      body: html`
        <div class="pin-dots flex justify-center gap-3 mb-5" data-dots></div>
        <div class="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
          ${keys.map((k) => html`<button class="pin-key ${k === 'OK' ? 'pin-ok' : ''}" data-k="${k}">${k}</button>`)}
        </div>`,
      onClose: () => { if (!answered) resolve(null); }
    });
    m.el.setAttribute('data-nolog', '1');   // v5.3: PIN-Eingaben landen nie im Aktivitäts-Log
    const dots = m.body.querySelector('[data-dots]');
    const render = () => setHTML(dots, html`${Array.from({ length: Math.max(4, pin.length) }, (_, i) => html`<span class="pin-dot ${i < pin.length ? 'on' : ''}"></span>`)}`);
    render();
    const press = (k) => {
      haptic(8);
      if (k === 'C') pin = '';
      else if (k === 'OK') { if (pin.length >= 4) { answered = true; resolve(pin); m.close(); } return; }
      else if (pin.length < 8) pin += k;
      render();
    };
    on(m.body, 'click', '[data-k]', (_e, t) => press(t.dataset.k));
    const keyHandler = (e) => {
      if (!document.body.contains(m.el)) { document.removeEventListener('keydown', keyHandler); return; }
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); render(); }
      else if (e.key === 'Enter') press('OK');
    };
    document.addEventListener('keydown', keyHandler);
  });
}
