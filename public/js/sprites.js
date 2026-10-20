/**
 * Top-Down Fahrzeug-Sprites (Vektor, Canvas 2D)
 * ------------------------------------------------------------
 * drawCar(ctx, { x, y, angle, scale, model, color, ...opts })
 *   x, y   = Mittelpunkt in Pixeln, angle = Rotation (0 = Nase oben)
 *   scale  = Pixel pro Meter, model = Eintrag aus /api/meta (length, width, shape)
 * Formen: coupe | sedan | touring | cabrio | dummy
 * Neue Form: in CABINS ergänzen (Anteile der Fahrzeuglänge von vorn).
 */

export function shade(hex, amt) {
  let c = String(hex || '#999').replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c.slice(0, 6), 16);
  let r = (num >> 16) & 255; let g = (num >> 8) & 255; let b = num & 255;
  const t = amt < 0 ? 0 : 255; const p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}

export function luminance(hex) {
  let c = String(hex || '#999').replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c.slice(0, 6), 16);
  return (0.299 * ((num >> 16) & 255) + 0.587 * ((num >> 8) & 255) + 0.114 * (num & 255)) / 255;
}

// Anteile der Länge: Windschutzscheibe -> Dach -> Heckscheibe
const CABINS = {
  coupe:   { ws: 0.34, roof: 0.45, rear: 0.65, end: 0.76, roofW: 0.70 },
  sedan:   { ws: 0.32, roof: 0.43, rear: 0.68, end: 0.79, roofW: 0.72 },
  touring: { ws: 0.32, roof: 0.43, rear: 0.89, end: 0.95, roofW: 0.74 },
  cabrio:  { ws: 0.34, roof: 0.42, rear: 0.70, end: 0.78, roofW: 0.74 },
  // v3: weitere Silhouetten für eigene Modelle
  hatch:   { ws: 0.33, roof: 0.45, rear: 0.86, end: 0.93, roofW: 0.72 },   // Kompakt / Kleinwagen (z. B. Trabant, E36 Compact)
  van:     { ws: 0.14, roof: 0.22, rear: 0.95, end: 0.98, roofW: 0.84 },   // Bus / Transporter
  pickup:  { ws: 0.30, roof: 0.40, rear: 0.54, end: 0.58, roofW: 0.74 },   // Pick-up (Ladefläche dahinter)
  dummy:   { ws: 0.30, roof: 0.40, rear: 0.75, end: 0.85, roofW: 0.76 }
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bodyPath(ctx, W, L) {
  const w = W / 2; const l = L / 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.74, -l);
  ctx.quadraticCurveTo(0, -l - L * 0.014, w * 0.74, -l);
  ctx.quadraticCurveTo(w * 0.97, -l + L * 0.008, w, -l + L * 0.10);
  ctx.lineTo(w, l - L * 0.09);
  ctx.quadraticCurveTo(w * 0.98, l - L * 0.004, w * 0.78, l);
  ctx.quadraticCurveTo(0, l + L * 0.012, -w * 0.78, l);
  ctx.quadraticCurveTo(-w * 0.98, l - L * 0.004, -w, l - L * 0.09);
  ctx.lineTo(-w, -l + L * 0.10);
  ctx.quadraticCurveTo(-w * 0.97, -l + L * 0.008, -w * 0.74, -l);
  ctx.closePath();
}

/** Trapez/Glas zwischen zwei Längspositionen (Anteile) mit Breiten (Anteile von W). */
function band(ctx, W, L, f0, f1, w0, w1, round = 0.02) {
  const y0 = -L / 2 + L * f0; const y1 = -L / 2 + L * f1;
  const a = (W * w0) / 2; const b = (W * w1) / 2;
  const r = L * round;
  ctx.beginPath();
  ctx.moveTo(-a + r, y0);
  ctx.lineTo(a - r, y0);
  ctx.quadraticCurveTo(a, y0, a + (b - a) * 0.1, y0 + r);
  ctx.lineTo(b, y1 - r);
  ctx.quadraticCurveTo(b, y1, b - r, y1);
  ctx.lineTo(-b + r, y1);
  ctx.quadraticCurveTo(-b, y1, -b, y1 - r);
  ctx.lineTo(-a - (b - a) * 0.1, y0 + r);
  ctx.quadraticCurveTo(-a, y0, -a + r, y0);
  ctx.closePath();
}

export function drawCar(ctx, o) {
  const { x, y, angle = 0, scale, model, color = '#9ca3af' } = o;
  const L = (model.length || 4.4) * scale;
  const W = (model.width || 1.8) * scale;
  const shape = model.shape || 'dummy';
  const cab = CABINS[shape] || CABINS.dummy;
  const lift = o.raised ? 1.05 : 1;
  // ps = echte Bildschirm-Pixel pro Einheit (Blur/ShadowBlur werden nicht mittransformiert)
  const ps = o.pxScale || scale;
  const px = scale / ps; // ein Bildschirm-Pixel in lokalen Einheiten

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.scale(lift, lift);

  // Bodenschatten
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.filter = `blur(${Math.max(1, ps * (o.raised ? 0.16 : 0.08))}px)`;
  const so = o.raised ? scale * 0.16 : scale * 0.05;
  roundRect(ctx, -W / 2 + so, -L / 2 + so * 1.4, W, L, W * 0.25);
  ctx.fill();
  ctx.restore();

  // Status-Glow (dezent, pulsiert über glowStrength)
  if (o.glow) {
    ctx.save();
    const k = o.glowStrength ?? 1;
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = ps * (0.07 + 0.11 * k);
    ctx.strokeStyle = o.glow;
    ctx.globalAlpha *= 0.35 + 0.55 * k;
    ctx.lineWidth = Math.max(1.2 * px, scale * 0.035);
    bodyPath(ctx, W * 1.05, L * 1.025);
    ctx.stroke();
    ctx.restore();
  }

  // Räder
  ctx.fillStyle = '#050608';
  const ww = W * 0.14; const wl = L * 0.15;
  for (const fy of [0.19, 0.80]) {
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * (W / 2 - ww * 0.42) - ww / 2, -L / 2 + L * fy - wl / 2, ww, wl, ww * 0.3);
      ctx.fill();
    }
  }

  // Karosserie mit Querverlauf (Glanz)
  const grad = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  grad.addColorStop(0, shade(color, -0.32));
  grad.addColorStop(0.12, shade(color, -0.04));
  grad.addColorStop(0.5, shade(color, 0.10));
  grad.addColorStop(0.88, shade(color, -0.04));
  grad.addColorStop(1, shade(color, -0.32));
  bodyPath(ctx, W, L);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = Math.max(1 * px, scale * 0.025);
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.stroke();

  if (shape === 'dummy') {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1 * px, scale * 0.04);
    ctx.beginPath();
    ctx.moveTo(-W * 0.35, -L * 0.3); ctx.lineTo(W * 0.35, L * 0.3);
    ctx.moveTo(W * 0.35, -L * 0.3); ctx.lineTo(-W * 0.35, L * 0.3);
    ctx.stroke();
  } else {
    // Motorhaube: Power-Dome-Linien
    ctx.strokeStyle = shade(color, -0.25);
    ctx.lineWidth = Math.max(0.8 * px, scale * 0.018);
    ctx.beginPath();
    ctx.moveTo(-W * 0.16, -L / 2 + L * 0.04); ctx.lineTo(-W * 0.2, -L / 2 + L * cab.ws);
    ctx.moveTo(W * 0.16, -L / 2 + L * 0.04); ctx.lineTo(W * 0.2, -L / 2 + L * cab.ws);
    ctx.stroke();

    // Glasfläche (Windschutzscheibe bis Heckscheibe)
    const glass = ctx.createLinearGradient(0, -L / 2 + L * cab.ws, 0, -L / 2 + L * cab.end);
    glass.addColorStop(0, '#22344a');
    glass.addColorStop(0.35, '#0b1320');
    glass.addColorStop(1, '#131c2a');
    band(ctx, W, L, cab.ws, cab.end, 0.70, 0.74);
    ctx.fillStyle = glass;
    ctx.fill();

    if (shape === 'cabrio') {
      // Offener Innenraum mit Sitzen + Verdeckkasten
      band(ctx, W, L, cab.roof, cab.rear, 0.80, 0.80, 0.01);
      ctx.fillStyle = '#1b1410';
      ctx.fill();
      ctx.fillStyle = '#3a2a20';
      const seatW = W * 0.26; const seatL = L * 0.1;
      for (const fy of [0.46, 0.60]) {
        for (const sx of [-1, 1]) {
          roundRect(ctx, sx * W * 0.17 - seatW / 2, -L / 2 + L * fy, seatW, seatL, seatW * 0.3);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#0f0f12';
      ctx.beginPath(); ctx.arc(-W * 0.17, -L / 2 + L * 0.445, W * 0.09, 0, Math.PI * 2); ctx.fill();
      band(ctx, W, L, cab.rear, cab.end, 0.80, 0.74, 0.02);
      ctx.fillStyle = '#18181b';
      ctx.fill();
    } else {
      // Dach
      const roof = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
      roof.addColorStop(0, shade(color, -0.3));
      roof.addColorStop(0.5, shade(color, 0.2));
      roof.addColorStop(1, shade(color, -0.3));
      band(ctx, W, L, cab.roof, cab.rear, cab.roofW, cab.roofW - 0.02, 0.03);
      ctx.fillStyle = roof;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = Math.max(0.6 * px, scale * 0.012);
      ctx.stroke();
      if (shape === 'pickup') {
        // offene Ladefläche
        ctx.fillStyle = shade(color, -0.55);
        roundRect(ctx, -W * 0.40, -L / 2 + L * 0.61, W * 0.80, L * 0.35, W * 0.04);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = Math.max(0.8 * px, scale * 0.02);
        ctx.beginPath();
        for (let i = 1; i < 4; i += 1) { ctx.moveTo(-W * 0.4 + (W * 0.8 * i) / 4, -L / 2 + L * 0.63); ctx.lineTo(-W * 0.4 + (W * 0.8 * i) / 4, -L / 2 + L * 0.94); }
        ctx.stroke();
      }
      if (shape === 'van') {
        // Dachsicke
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = Math.max(0.8 * px, scale * 0.02);
        ctx.beginPath();
        for (let i = 1; i < 6; i += 1) { ctx.moveTo(-W * 0.36, -L / 2 + L * (0.22 + i * 0.12)); ctx.lineTo(W * 0.36, -L / 2 + L * (0.22 + i * 0.12)); }
        ctx.stroke();
      }
      if (shape === 'touring') {
        // Dachreling
        ctx.strokeStyle = 'rgba(15,15,20,0.7)';
        ctx.lineWidth = Math.max(0.8 * px, scale * 0.03);
        ctx.beginPath();
        ctx.moveTo(-W * 0.33, -L / 2 + L * (cab.roof + 0.03)); ctx.lineTo(-W * 0.33, -L / 2 + L * (cab.rear - 0.03));
        ctx.moveTo(W * 0.33, -L / 2 + L * (cab.roof + 0.03)); ctx.lineTo(W * 0.33, -L / 2 + L * (cab.rear - 0.03));
        ctx.stroke();
      }
      // Spiegelung
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      band(ctx, W, L, cab.ws + 0.012, cab.roof - 0.012, 0.30, 0.18, 0.01);
      ctx.fill();
    }

    // Außenspiegel
    ctx.fillStyle = shade(color, -0.2);
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * (W / 2 + W * 0.05), -L / 2 + L * (cab.ws + 0.04), W * 0.07, L * 0.022, sx * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Niere
  ctx.fillStyle = '#0a0a0a';
  for (const sx of [-1, 1]) {
    roundRect(ctx, sx * W * 0.075 - W * 0.06, -L / 2 + L * 0.004, W * 0.12, L * 0.03, W * 0.03);
    ctx.fill();
  }
  // Scheinwerfer (Angel Eyes)
  ctx.save();
  ctx.shadowColor = 'rgba(200,230,255,0.9)';
  ctx.shadowBlur = ps * 0.25;
  ctx.fillStyle = '#e6f3ff';
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.arc(sx * W * 0.26, -L / 2 + L * 0.03, W * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx * W * 0.37, -L / 2 + L * 0.035, W * 0.045, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Rückleuchten
  ctx.save();
  ctx.shadowColor = 'rgba(255,40,40,0.9)';
  ctx.shadowBlur = ps * 0.2;
  ctx.fillStyle = '#ef2a2a';
  for (const sx of [-1, 1]) {
    roundRect(ctx, sx * W * 0.33 - W * 0.13, L / 2 - L * 0.035, W * 0.26, L * 0.03, W * 0.02);
    ctx.fill();
  }
  ctx.restore();

  // Auswahl-Rahmen
  if (o.selected) {
    ctx.save();
    ctx.setLineDash([scale * 0.2, scale * 0.12]);
    ctx.lineDashOffset = -(o.time || 0) * scale * 0.02;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5 * px, scale * 0.05);
    roundRect(ctx, -W / 2 - scale * 0.18, -L / 2 - scale * 0.18, W + scale * 0.36, L + scale * 0.36, scale * 0.3);
    ctx.stroke();
    ctx.restore();
  }
  if (o.dim) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    bodyPath(ctx, W, L);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- Thumbnails für Listen (seitlich, Nase rechts) ---------- */
const thumbCache = new Map();

export function carThumb(model, color, { w = 96, h = 44, status = null } = {}) {
  const key = `${model.shape}|${model.length}|${color}|${w}|${h}|${status}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const scale = Math.min((w * 0.9) / (model.length || 4.4), (h * 0.8) / (model.width || 1.8));
  drawCar(ctx, { x: w / 2, y: h / 2, angle: Math.PI / 2, scale, model, color, glow: status, glowStrength: 0.6 });
  const url = c.toDataURL();
  thumbCache.set(key, url);
  return url;
}
