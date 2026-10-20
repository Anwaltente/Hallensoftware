/**
 * QR-Code-System
 * ------------------------------------------------------------
 * 1. Eigener QR-Encoder (Byte-Modus, Fehlerkorrektur M, Version 1 bis 10), keine externe Bibliothek nötig,
 *    funktioniert also auch offline in der Halle.
 * 2. Druckfertige Labels (Eurobox, Auto, Reifenlager, Kühlschrank).
 * 3. In-App-Scanner: BarcodeDetector (Chrome/Android) mit Fallback auf jsQR (wird bei Bedarf vom CDN geladen).
 *
 * Inhalt der Codes ist ein Link (z. B. https://halle.example.de/?scan=box-12). Dadurch funktioniert
 * auch die normale Handy-Kamera: Link antippen, App öffnet sich direkt am richtigen Fach.
 */
import { store, app } from './state.js';
import { html, el, icon, openModal, toast, haptic } from './ui.js';

/* ====================================================================== */
/* Encoder                                                                */
/* ====================================================================== */
// [ECC-Codewörter pro Block, Blöcke Gruppe 1, Datenwörter G1, Blöcke Gruppe 2, Datenwörter G2] für Level M
const ECC_M = [null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const [, b1, d1, b2, d2] = ECC_M[v];
    const capacityBits = (b1 * d1 + b2 * d2) * 8;
    const needed = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (needed <= capacityBits) { version = v; break; }
  }
  if (!version) throw new Error('Text zu lang für QR-Code.');
  const [eccLen, b1, d1, b2, d2] = ECC_M[version];
  const dataCap = b1 * d1 + b2 * d2;

  // Bitstrom
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

  // Blöcke + Fehlerkorrektur + Verschachtelung
  const blocks = [];
  let k = 0;
  const divisor = rsDivisor(eccLen);
  for (let i = 0; i < b1 + b2; i += 1) {
    const len = i < b1 ? d1 : d2;
    const dat = data.slice(k, k + len);
    k += len;
    blocks.push({ dat, ecc: rsRemainder(dat, divisor) });
  }
  const codewords = [];
  const maxLen = Math.max(d1, d2);
  for (let i = 0; i < maxLen; i += 1) blocks.forEach((b) => { if (i < b.dat.length) codewords.push(b.dat[i]); });
  for (let i = 0; i < eccLen; i += 1) blocks.forEach((b) => codewords.push(b.ecc[i]));

  // Matrix
  const size = version * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[version];
  for (let i = 0; i < al.length; i += 1) {
    for (let j = 0; j < al.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask) => {
    const d = (0 << 3) | mask; // ECC-Level M = 00
    let rem = d;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) set(8, i, getBit(f, i));
    set(8, 7, getBit(f, 6)); set(8, 8, getBit(f, 7)); set(7, 8, getBit(f, 8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, getBit(f, i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, getBit(f, i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, getBit(f, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
      set(a, b, getBit(vb, i)); set(b, a, getBit(vb, i));
    }
  }

  // Daten im Zickzack platzieren
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < codewords.length * 8) {
          mod[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7));
          bi += 1;
        }
      }
    }
  }

  // Maske mit geringster Strafpunktzahl wählen
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];
  const applyMask = (m) => { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0;
    for (let y = 0; y < size; y += 1) {
      let run = 1;
      for (let x = 1; x < size; x += 1) { if (mod[y][x] === mod[y][x - 1]) { run += 1; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; }
    }
    for (let x = 0; x < size; x += 1) {
      let run = 1;
      for (let y = 1; y < size; y += 1) { if (mod[y][x] === mod[y - 1][x]) { run += 1; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; }
    }
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    let dark = 0;
    mod.forEach((row) => row.forEach((c) => { if (c) dark += 1; }));
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0; let bestScore = Infinity;
  for (let m = 0; m < 8; m += 1) {
    applyMask(m); drawFormat(m);
    const sc = penalty();
    if (sc < bestScore) { bestScore = sc; best = m; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return mod;
}

/** QR als SVG-String (schwarz auf weiß, 4 Module Ruhezone). */
export function qrSvg(text, { size = 160, margin = 4 } = {}) {
  const m = qrMatrix(text);
  const n = m.length + margin * 2;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + margin} ${y + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ====================================================================== */
/* Links & Labels                                                         */
/* ====================================================================== */
export function publicBase() {
  return (store.settings && store.settings.publicUrl) || location.origin;
}

export function scanUrl(kind, id = '') {
  return `${publicBase()}/?scan=${kind}${id !== '' ? `-${id}` : ''}`;
}

/**
 * Druckfertige Label-Ansicht. labels: [{ kind, id, title, subtitle, color }]
 */
export function printLabels(labels, { title = 'QR-Labels drucken' } = {}) {
  const local = /localhost|127\.0\.0\.1/.test(publicBase());
  const body = el(html`<div class="print-area">
    ${local ? html`<div class="no-print mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">${icon('alert', 'w-4 h-4 inline')}
      Die Codes zeigen auf <b>${publicBase()}</b>. Handys in der Halle erreichen das nicht. Trage in der Admin-Konsole (System) die Adresse ein, unter der die App im WLAN oder im Internet läuft.</div>` : ''}
    <div class="no-print flex items-center gap-3 mb-4 text-sm text-slate-400">
      <span>Labelgröße:</span>
      <div class="mode-switch" data-size><button class="on" data-s="std">62 × 29 mm</button><button data-s="big">Groß (A6)</button></div>
    </div>
    <div class="qr-sheet flex flex-wrap gap-3" data-sheet>
      ${labels.map((l) => html`
        <div class="qr-label" style="--lc:${l.color || '#facc15'}">
          <div class="qr-code">${{ __raw: qrSvg(scanUrl(l.kind, l.id), { size: 200 }) }}</div>
          <div class="qr-text">
            <div class="qr-kicker">HALLE//OS · ${l.kicker || ''}</div>
            <div class="qr-title">${l.title}</div>
            ${l.subtitle ? html`<div class="qr-sub">${l.subtitle}</div>` : ''}
            <div class="qr-stripe"></div>
          </div>
        </div>`)}
    </div></div>`);
  const m = openModal({ title, subtitle: `${labels.length} Label${labels.length === 1 ? '' : 's'}`, size: 'lg', iconName: 'print', body,
    footer: html`<button class="btn" data-close>Schließen</button><button class="btn btn-primary" data-print>${icon('print')} Drucken</button>` });
  m.footer.querySelector('[data-print]').addEventListener('click', () => window.print());
  body.querySelector('[data-size]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    body.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
    body.querySelector('[data-sheet]').classList.toggle('qr-big', b.dataset.s === 'big');
  });
}

/* ====================================================================== */
/* Scanner                                                                */
/* ====================================================================== */
/** Text eines gescannten Codes auswerten und hinspringen. Gibt true zurück, wenn verstanden. */
export function handleScanText(text) {
  let code = String(text || '').trim();
  try { const u = new URL(code); code = u.searchParams.get('scan') || u.searchParams.get('box') || code; } catch { /* kein Link */ }
  const m = /^(box|car|auto|tyres|fridge|shelf)(?:-(\d+))?$/i.exec(code);
  if (!m) return false;
  const kind = m[1].toLowerCase();
  const id = Number(m[2]);
  haptic([20, 40, 20]);
  if (kind === 'box') {
    app.navigate({ kind: 'box', boxId: id });
  } else if (kind === 'car' || kind === 'auto') {
    app.navigate({ kind: 'vehicle', vehicleId: id });
  } else if (kind === 'shelf') {
    app.navigate({ kind: 'shelf', shelfId: id });
  } else if (kind === 'tyres') {
    app.navigate({ kind: 'tyres' });
  } else if (kind === 'fridge') {
    app.navigate({ kind: 'fridge' });
  }
  return true;
}

let jsQRPromise = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRPromise) {
    jsQRPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => { jsQRPromise = null; reject(new Error('QR-Decoder konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
  }
  return jsQRPromise;
}

export function openScanner() {
  let stream = null;
  let running = true;
  const body = el(html`<div>
    <div class="relative rounded-xl overflow-hidden bg-black aspect-[3/4] sm:aspect-video">
      <video class="w-full h-full object-cover" playsinline muted data-video></video>
      <div class="scan-frame absolute inset-0 pointer-events-none"><span></span></div>
      <div class="absolute inset-x-0 bottom-0 p-3 text-center text-sm text-white/90 bg-gradient-to-t from-black/80" data-status>Kamera wird gestartet …</div>
    </div>
    <form class="flex gap-2 mt-3" data-manual>
      <input class="input font-mono" name="code" placeholder="oder Code eingeben, z. B. box-3 oder car-1" autocomplete="off">
      <button class="btn">${icon('check')}</button>
    </form>
    <p class="text-[11px] text-slate-500 mt-2">Tipp: Die normale Handy-Kamera funktioniert auch, die Codes enthalten einen Link zur App.</p>
  </div>`);
  const m = openModal({ title: 'QR-Scanner', subtitle: 'Box oder Auto scannen', size: 'md', iconName: 'camera', body,
    onClose: () => { running = false; if (stream) stream.getTracks().forEach((t) => t.stop()); } });
  const video = body.querySelector('[data-video]');
  const status = body.querySelector('[data-status]');
  const setStatus = (t) => { status.textContent = t; };

  const done = (text) => {
    if (handleScanText(text)) { running = false; m.close(); toast('Code erkannt!', 'ok'); return true; }
    setStatus(`Unbekannter Code: ${String(text).slice(0, 40)}`);
    return false;
  };

  body.querySelector('[data-manual]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!done(e.target.code.value)) toast('Code nicht erkannt.', 'warn');
  });

  (async () => {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Kamera braucht HTTPS (oder localhost). Nutze die Handy-Kamera oder gib den Code ein.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (err) {
      setStatus(`Kein Kamerazugriff: ${err.message}`);
      return;
    }
    if (!running) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    setStatus('Code ins Bild halten …');

    let detect;
    if ('BarcodeDetector' in window) {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        detect = async () => { const r = await det.detect(video); return r[0] ? r[0].rawValue : null; };
      } catch { detect = null; }
    }
    if (!detect) {
      try {
        const jsQR = await loadJsQR();
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true });
        detect = async () => {
          if (!video.videoWidth) return null;
          const w = 480; const h = Math.round((video.videoHeight / video.videoWidth) * w);
          c.width = w; c.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          return r ? r.data : null;
        };
      } catch (err) { setStatus(err.message); return; }
    }
    const tick = async () => {
      if (!running) return;
      try {
        const text = await detect();
        if (text && done(text)) return;
      } catch { /* weiter */ }
      setTimeout(tick, 180);
    };
    tick();
  })();
}

