/**
 * v4: Game-Feeling ohne Audiodateien
 * ------------------------------------------------------------
 * Alle Sounds werden live mit der Web Audio API synthetisiert (latenzfrei, offline, keine MP3s):
 *   pfftKlack()  Schnellabzug: Druckluft-Zischen + satter mechanischer Klick
 *   ratchet()    Werkzeug-Ratsche (Status "In der Schwebe")
 *   levelUp()    Erfolgs-Jingle ("Alles aufgeräumt", Nachkauf)
 *   warn()       dezenter, tiefer Warnton (kritischer Mangel)
 *   tick()       kurzer UI-Klick
 * Dazu: Mute-Schalter (lokal gemerkt), Vibration und schwebende Zahlen-Popups.
 */
const KEY = 'halle.sfx.muted';
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let quiet = false;        // v5: Büro-Ansicht schaltet alle Effekte stumm (unabhängig vom Mute-Schalter)
const listeners = new Set();

try { muted = localStorage.getItem(KEY) === '1'; } catch { /* privates Fenster */ }

export const isMuted = () => muted;
export function setMuted(on) {
  muted = !!on;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* egal */ }
  listeners.forEach((fn) => fn(muted));
  if (!muted) tick();
}
export const toggleMute = () => setMuted(!muted);
/** v5: Büro-Modus. Kein Ton, keine Vibration, keine Popups/Funken. Mute-Einstellung bleibt unberührt. */
export const isQuiet = () => quiet;
export function setQuiet(on) { quiet = !!on; }
export const onMuteChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function audio() {
  if (muted || quiet) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -14;
      master.ratio.value = 6;
      const vol = ctx.createGain();
      vol.gain.value = 0.9;
      master.connect(vol).connect(ctx.destination);
      // 1 s weißes Rauschen als Basis für Zischen und Klicks
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

/** Hüllkurve: schneller Anstieg, exponentielles Abklingen */
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(t, { dur = 0.2, type = 'bandpass', freq = 3000, q = 1, peak = 0.3, attack = 0.005, sweepTo = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + attack + 0.05);
}

function tone(t, { type = 'sine', freq = 440, to = null, dur = 0.2, peak = 0.2, attack = 0.005 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

/** Schnellabzug: "Pfft-Klack" */
export function pfftKlack() {
  if (!audio()) return;
  const t = ctx.currentTime + 0.005;
  noise(t, { dur: 0.16, type: 'highpass', freq: 2500, sweepTo: 6500, q: 0.7, peak: 0.22, attack: 0.012 });  // Pfft (Druckluft)
  noise(t + 0.02, { dur: 0.12, type: 'bandpass', freq: 5200, q: 2, peak: 0.12 });
  const k = t + 0.13;                                                                      // Klack
  noise(k, { dur: 0.035, type: 'bandpass', freq: 1800, q: 6, peak: 0.55, attack: 0.001 });
  tone(k, { type: 'triangle', freq: 210, to: 70, dur: 0.09, peak: 0.45, attack: 0.002 });  // Wumms des Schalters
  tone(k + 0.004, { type: 'square', freq: 1400, to: 600, dur: 0.02, peak: 0.08, attack: 0.001 });
}

/** Ratsche: schnelle Folge harter Klicks mit leichtem Pitch-Wackeln */
export function ratchet(clicks = 7) {
  if (!audio()) return;
  const t0 = ctx.currentTime + 0.005;
  for (let i = 0; i < clicks; i += 1) {
    const t = t0 + i * 0.045 + (Math.random() * 0.006);
    const f = 2600 + Math.random() * 500 - i * 60;
    noise(t, { dur: 0.022, type: 'bandpass', freq: f, q: 9, peak: 0.5, attack: 0.001 });
    tone(t, { type: 'square', freq: 900 - i * 25, to: 400, dur: 0.012, peak: 0.07, attack: 0.001 });
  }
  noise(t0 + clicks * 0.045 + 0.02, { dur: 0.05, type: 'bandpass', freq: 1500, q: 4, peak: 0.35, attack: 0.001 }); // Einrasten
}

/** Level-Up / Erfolg: Arpeggio + Glitzer */
export function levelUp() {
  if (!audio()) return;
  const t = ctx.currentTime + 0.01;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    tone(t + i * 0.085, { type: 'square', freq: f, dur: 0.16, peak: 0.09, attack: 0.004 });
    tone(t + i * 0.085, { type: 'triangle', freq: f / 2, dur: 0.18, peak: 0.12, attack: 0.004 });
  });
  const end = t + notes.length * 0.085;
  [1046.5, 1318.5, 1568].forEach((f) => tone(end, { type: 'triangle', freq: f, dur: 0.55, peak: 0.08, attack: 0.01 }));
  noise(end, { dur: 0.4, type: 'highpass', freq: 7000, q: 0.5, peak: 0.05, attack: 0.02 });
}

/** Kleiner positiver Bestätigungston (z. B. Nachkauf gebucht) */
export function coin() {
  if (!audio()) return;
  const t = ctx.currentTime + 0.005;
  tone(t, { type: 'square', freq: 987.8, dur: 0.07, peak: 0.08 });
  tone(t + 0.07, { type: 'square', freq: 1318.5, dur: 0.22, peak: 0.08 });
}

/** Dezenter, tiefer Warnton (kritischer Mangel) */
export function warn() {
  if (!audio()) return;
  const t = ctx.currentTime + 0.01;
  [0, 0.32].forEach((off) => {
    tone(t + off, { type: 'sine', freq: 98, dur: 0.26, peak: 0.42, attack: 0.03 });
    tone(t + off, { type: 'triangle', freq: 196, to: 180, dur: 0.24, peak: 0.12, attack: 0.03 });
  });
}

export function tick() {
  if (!audio()) return;
  const t = ctx.currentTime + 0.003;
  noise(t, { dur: 0.018, type: 'bandpass', freq: 3200, q: 8, peak: 0.25, attack: 0.001 });
}

/* ---------------- Haptik ---------------- */
export function buzz(pattern = [30, 20, 30]) {
  if (quiet) return;
  try {
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && active) navigator.vibrate(pattern);
  } catch { /* ignorieren */ }
}

/* ---------------- Schwebende Zahlen-Popups ---------------- */
/**
 * popNumber('-1,0 L', event|element|{x,y}, { color })
 * Text steigt kurz nach oben und verblasst.
 */
export function popNumber(text, at, { color = '#a3e635', big = false } = {}) {
  if (quiet) return;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (at && typeof at.clientX === 'number' && (at.clientX || at.clientY)) { x = at.clientX; y = at.clientY; }
  else if (at && at.getBoundingClientRect) { const r = at.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  else if (at && typeof at.x === 'number') { x = at.x; y = at.y; }
  const n = document.createElement('div');
  n.className = `num-pop${big ? ' num-pop-big' : ''}`;
  n.textContent = text;
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  n.style.setProperty('--pc', color);
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1300);
}

/** Kurze "Stoß"-Animation auf einem Element (Kachel ruckelt mechanisch) */
export function bump(elm, cls = 'bump') {
  if (!elm || quiet) return;
  elm.classList.remove(cls);
  void elm.offsetWidth; // Reflow, damit die Animation neu startet
  elm.classList.add(cls);
}

/** Konfetti-Funken für Erfolgsmomente */
export function sparks(at, colors = ['#a3e635', '#22d3ee', '#facc15']) {
  if (quiet) return;
  let x = window.innerWidth / 2; let y = window.innerHeight / 2;
  if (at && at.getBoundingClientRect) { const r = at.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
  for (let i = 0; i < 18; i += 1) {
    const s = document.createElement('i');
    s.className = 'spark';
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
    const d = 60 + Math.random() * 70;
    s.style.left = `${x}px`; s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d - 30}px`);
    s.style.background = colors[i % colors.length];
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}
