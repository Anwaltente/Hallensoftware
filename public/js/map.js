/**
 * Map-Engine (Canvas 2D)
 * ------------------------------------------------------------
 * Weltkoordinaten in METERN. Ursprung = hintere linke Hallenecke, y wächst Richtung Einfahrt.
 * Neben der Halle liegt der "Unterwegs / Paddock"-Bereich (Parkbuchten für externe Autos).
 *
 * Features:
 *  - Kamera mit Pan, Mausrad-Zoom, Pinch-Zoom und weichen Zoom-Transitions (focusRect)
 *  - Drag & Drop von Autos mit Snap-to-Slot (Maus + Touch), alternativ "antippen -> Ziel antippen"
 *  - Status-Glow, Puls bei aktiver Arbeit, animierte Warnstreifen "Schneise blockiert!"
 *  - Admin-Baukasten: Objekte verschieben/skalieren mit Raster-Snap
 *  - Blueprint-Modus: Neon-Schaltplan auf Gitter, Linienzug-Editor für Elektrik & Druckluft
 *
 * Kommunikation nach außen nur über die handlers (siehe app.js), dadurch bleibt die Engine austauschbar.
 */
import { store, canEdit, isAdmin, modelInfo, statusInfo, bpVisible } from './state.js';
import { drawCar } from './sprites.js';

const PADDOCK_GAP = 1.8;
const BAY_W = 3.0;
const BAY_H = 5.3;
const BAY_GAP = 0.35;
const DRAG_THRESHOLD = 7;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const snap = (v, step) => Math.round(v / step) * step;
const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function distToSegment(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
}

export class HallMap {
  constructor(canvas, handlers = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = handlers;
    this.cam = { x: 8, y: 9.5, zoom: 30 };
    this.anim = null;
    this.userMoved = false;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.hoverVehicle = null;
    this.mouse = null;
    this.selectedVehicleId = null;
    this.poses = new Map();
    this.time = 0;
    this.last = performance.now();
    this.highlight = null;          // { rect, until }
    this.builderSelId = null;
    this.bp = { tool: 'select', kind: 'v230', draft: null, selId: null, edit: false };
    this.labels = [];
    this.pin = null;               // v5.3: Such-Pin { objectId|vehicleId, frac, label, sub }

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindEvents();
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ======================= Geometrie ======================= */
  get hall() { return { x: 0, y: 0, w: store.hall.width || 8, h: store.hall.depth || 19 }; }

  slots() { return store.objects.filter((o) => o.type === 'slot'); }

  externVehicles() { return store.vehicles.filter((v) => !v.slot_id).sort((a, b) => a.id - b.id); }

  paddock() {
    const hall = this.hall;
    const n = this.externVehicles().length;
    let bays = Math.max(4, n + 1);
    if (bays % 2) bays += 1;
    const rows = bays / 2;
    const x0 = hall.w + PADDOCK_GAP;
    const list = [];
    for (let i = 0; i < bays; i += 1) {
      const col = i % 2; const row = Math.floor(i / 2);
      list.push({ x: x0 + col * (BAY_W + BAY_GAP), y: 0.6 + row * (BAY_H + BAY_GAP), w: BAY_W, h: BAY_H });
    }
    const h = Math.max(hall.h, rows * (BAY_H + BAY_GAP) + 1.0);
    return { area: { x: x0 - 0.5, y: 0, w: 2 * BAY_W + BAY_GAP + 1.0, h }, bays: list };
  }

  worldBounds() {
    const hall = this.hall;
    if (store.mode === 'blueprint') return { x: -1, y: -1, w: hall.w + 2, h: hall.h + 2 };
    const p = this.paddock().area;
    return { x: -0.8, y: -0.8, w: p.x + p.w + 0.8 + 0.8, h: Math.max(hall.h, p.h) + 1.6 + 0.8 };
  }

  /** Zielposition jedes Autos (Mittelpunkt in Metern). */
  targetPose(v) {
    if (v.slot_id) {
      const slot = store.objects.find((o) => o.id === v.slot_id);
      if (slot) {
        const cap = Number(slot.props.capacity) || 1;
        const cx = slot.x + slot.w / 2; let cy = slot.y + slot.h / 2;
        const rot = slot.w > slot.h * 1.15 ? Math.PI / 2 : 0;
        if (cap > 1) {
          const shared = store.vehicles.filter((o) => o.slot_id === slot.id).length > 1;
          if (shared) cy += v.slot_pos === 0 ? -0.45 : 0.45;
        }
        return { x: cx, y: cy, a: rot, raised: cap > 1 && v.slot_pos === 0 && slot.props.kind === 'lift' };
      }
    }
    const idx = this.externVehicles().findIndex((x) => x.id === v.id);
    const bay = this.paddock().bays[Math.max(0, idx)];
    return { x: bay.x + bay.w / 2, y: bay.y + bay.h / 2 - 0.15, a: 0, raised: false };
  }

  vehicleRect(v) {
    const pose = this.poses.get(v.id) || this.targetPose(v);
    const m = modelInfo(v.model);
    const rotated = Math.abs(Math.sin(pose.a)) > 0.5;
    const w = rotated ? m.length : m.width; const h = rotated ? m.width : m.length;
    return { x: pose.x - w / 2, y: pose.y - h / 2, w, h };
  }

  /* ======================= Kamera ======================= */
  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.cw = Math.max(50, r.width); this.ch = Math.max(50, r.height);
    this.c.width = Math.round(this.cw * this.dpr);
    this.c.height = Math.round(this.ch * this.dpr);
    this.c.style.width = `${this.cw}px`; this.c.style.height = `${this.ch}px`;
    if (!this.userMoved) this.fit(false);
  }

  fitParams(rect, pad = 0.6) {
    const zoom = Math.min(this.cw / (rect.w + pad * 2), this.ch / (rect.h + pad * 2));
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, zoom: Math.max(4, Math.min(220, zoom)) };
  }

  fit(animate = true) {
    const t = this.fitParams(this.worldBounds(), 0.2);
    this.userMoved = false;
    if (animate) this.animateTo(t); else Object.assign(this.cam, t);
  }

  animateTo(target, duration = 520, after = null) {
    this.anim = { from: { ...this.cam }, to: target, start: performance.now(), duration, after };
  }

  /** Zoom-Transition auf ein Rechteck, danach Callback (z. B. Cockpit öffnen). */
  focusRect(rect, { pad = 1.2, maxZoom = 140, after = null, duration = 520 } = {}) {
    const t = this.fitParams(rect, pad);
    t.zoom = Math.min(maxZoom, t.zoom);
    this.userMoved = true;
    this.animateTo(t, duration, after);
  }

  focusVehicle(id, after) {
    const v = store.vehicles.find((x) => x.id === Number(id));
    if (!v) return after && after();
    this.focusRect(this.vehicleRect(v), { pad: 2.2, after });
  }

  focusObject(id, after) {
    const o = store.objects.find((x) => x.id === Number(id));
    if (!o) return after && after();
    this.flash(o);
    this.focusRect(o, { pad: Math.max(1.5, Math.max(o.w, o.h) * 0.4), after });
  }

  flash(rect, ms = 2600) { this.highlight = { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, until: performance.now() + ms }; }

  /* ---------- v5.3: Such-Pin ("Hier: 10er Nuss") ---------- */
  pinWorld(pin = this.pin) {
    if (!pin) return null;
    if (pin.vehicleId) {
      const v = store.vehicles.find((x) => x.id === Number(pin.vehicleId));
      if (v) { const r = this.vehicleRect(v); return { x: r.x + r.w / 2, y: r.y + r.h * 0.35 }; }
    }
    const o = pin.objectId && store.objects.find((x) => x.id === Number(pin.objectId));
    if (!o) return null;
    const f = Math.max(0.05, Math.min(0.95, Number(pin.frac ?? 0.5)));
    return o.h >= o.w ? { x: o.x + o.w / 2, y: o.y + o.h * f } : { x: o.x + o.w * f, y: o.y + o.h / 2 };
  }

  /** Pin setzen und die Kamera sanft hinfliegen lassen (mittlerer Zoom, Umgebung bleibt sichtbar) */
  showPin(pin) {
    this.pin = { ...pin, born: performance.now() };
    const w = this.pinWorld();
    if (!w) { this.pin = null; return false; }
    this.focusRect({ x: w.x - 2.6, y: w.y - 2.6, w: 5.2, h: 5.2 }, { pad: 1.2, maxZoom: 64, duration: 700 });
    return true;
  }

  /** Klick auf den Pin: ganz nah heranzoomen */
  zoomToPin(after = null) {
    const w = this.pinWorld();
    if (!w) return;
    this.focusRect({ x: w.x - 0.7, y: w.y - 0.7, w: 1.4, h: 1.4 }, { pad: 0.6, maxZoom: 150, duration: 650, after });
  }

  clearPin() { this.pin = null; }

  pinHit(s) {
    if (!this.pin || !this.pinBox) return false;
    const b = this.pinBox;
    return (s.x >= b.x && s.x <= b.x + b.w && s.y >= b.y && s.y <= b.y + b.h) || Math.hypot(s.x - b.px, s.y - b.py) < 26;
  }

  drawPin(ctx) {
    this.pinBox = null;
    if (!this.pin || store.mode !== 'hall' || store.builder) return;
    const w = this.pinWorld();
    if (!w) return;
    const s = this.toScreen(w.x, w.y);
    const col = '#ff2e93';
    const t = this.time;
    ctx.save();
    // pulsierende Ringe am Boden
    for (let i = 0; i < 3; i += 1) {
      const ph = ((t * 0.9) + i / 3) % 1;
      ctx.strokeStyle = `rgba(255,46,147,${(1 - ph) * 0.85})`;
      ctx.lineWidth = 2.5 * (1 - ph) + 0.5;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 8 + ph * 34, (8 + ph * 34) * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,46,147,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Nadel (hüpft beim Erscheinen kurz)
    const age = (performance.now() - (this.pin.born || 0)) / 1000;
    const bounce = age < 0.9 ? Math.abs(Math.sin(age * 7)) * (1 - age / 0.9) * 18 : Math.sin(t * 3) * 2;
    const hy = s.y - 30 - bounce;
    ctx.shadowColor = col; ctx.shadowBlur = 18 + 8 * Math.sin(t * 5);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(s.x, hy, 12, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(s.x, s.y - 3 - bounce * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, hy, 4.6, 0, Math.PI * 2); ctx.fill();
    // Beschriftungs-Fahne
    const title = `Hier: ${this.pin.label || ''}`;
    const sub = this.pin.sub || '';
    ctx.font = '700 13px "Chakra Petch", ui-sans-serif, system-ui';
    const tw = ctx.measureText(title).width;
    ctx.font = '500 11px "IBM Plex Sans", ui-sans-serif, system-ui';
    const sw = sub ? ctx.measureText(sub).width : 0;
    const bw = Math.min(this.cw - 16, Math.max(tw, sw) + 22);
    const bh = sub ? 40 : 26;
    let bx = s.x + 18; let by = hy - bh / 2;
    if (bx + bw > this.cw - 8) bx = s.x - 18 - bw;
    bx = Math.max(8, bx); by = Math.max(8, Math.min(this.ch - bh - 8, by));
    ctx.fillStyle = 'rgba(12,8,16,0.94)';
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 8); else ctx.rect(bx, by, bw, bh);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(bx, by + 6, 3, bh - 12);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '700 13px "Chakra Petch", ui-sans-serif, system-ui';
    ctx.fillStyle = '#fff';
    const clipText = (txt, max) => { let x = txt; while (x.length > 3 && ctx.measureText(x).width > max) x = `${x.slice(0, -2)}…`; return x; };
    ctx.fillText(clipText(title, bw - 20), bx + 11, by + (sub ? 14 : bh / 2));
    if (sub) {
      ctx.font = '500 11px "IBM Plex Sans", ui-sans-serif, system-ui';
      ctx.fillStyle = '#fbcfe8';
      ctx.fillText(clipText(sub, bw - 20), bx + 11, by + 29);
    }
    ctx.restore();
    this.pinBox = { x: bx, y: by, w: bw, h: bh, px: s.x, py: hy };
  }

  zoomAt(factor, sx, sy) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(4, Math.min(260, this.cam.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.userMoved = true;
    this.anim = null;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.cw / 2) / this.cam.zoom + this.cam.x, y: (sy - this.ch / 2) / this.cam.zoom + this.cam.y };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.cw / 2, y: (wy - this.cam.y) * this.cam.zoom + this.ch / 2 };
  }

  /* ======================= Hit-Tests ======================= */
  vehicleAt(p) {
    // Oberstes zuerst: angehobene / obere Position und gezogene Autos
    const list = [...store.vehicles].sort((a, b) => this.drawOrder(b) - this.drawOrder(a));
    return list.find((v) => inRect(p, this.vehicleRect(v))) || null;
  }

  drawOrder(v) { return (v.slot_id && v.slot_pos === 0 ? 2 : 1) + (this.drag && this.drag.active && this.drag.id === v.id ? 10 : 0); }

  objectAt(p, types = null) {
    const list = [...store.objects].sort((a, b) => (b.sort - a.sort) || (b.type === 'slot') - (a.type === 'slot') || (a.w * a.h - b.w * b.h));
    return list.find((o) => (!types || types.includes(o.type)) && inRect(p, o)) || null;
  }

  dropTargetAt(p, vehicle) {
    const slot = this.slots().filter((s) => inRect(p, s)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (slot) {
      const cap = Number(slot.props.capacity) || 1;
      const occupants = store.vehicles.filter((v) => v.slot_id === slot.id && (!vehicle || v.id !== vehicle.id));
      return { kind: 'slot', slot, full: occupants.length >= cap, occupants };
    }
    if (inRect(p, this.paddock().area)) return { kind: 'extern' };
    return null;
  }

  blueprintAt(p) {
    const tol = Math.max(0.18, 9 / this.cam.zoom);
    const items = store.blueprint.filter(bpVisible);   // v5.2: ausgeblendete Layer sind nicht anklickbar
    for (const it of [...items].reverse()) {
      if (it.type === 'node' && Math.hypot(p.x - it.points[0][0], p.y - it.points[0][1]) < tol * 1.4) return it;
    }
    for (const it of [...items].reverse()) {
      if (it.type !== 'line') continue;
      for (let i = 1; i < it.points.length; i += 1) if (distToSegment(p, it.points[i - 1], it.points[i]) < tol) return it;
    }
    return null;
  }

  /* ======================= Eingabe ======================= */
  bindEvents() {
    const c = this.c;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', () => { this.mouse = null; this.hoverVehicle = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      this.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      if (store.mode === 'blueprint' && this.bp.draft) { this.finishLine(); return; }
      const p = this.eventWorld(e);
      if (!store.builder && !this.vehicleAt(p) && !this.objectAt(p, ['shelf', 'fridge', 'tyrestack'])) this.fit();
    });
    c.addEventListener('contextmenu', (e) => {
      if (store.mode === 'blueprint' && this.bp.draft) { e.preventDefault(); this.finishLine(); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (store.mode === 'blueprint' && this.bp.draft) {
        if (e.key === 'Enter') { this.finishLine(); e.preventDefault(); }
        if (e.key === 'Escape') { this.bp.draft = null; e.stopPropagation(); }
        if (e.key === 'Backspace') { this.bp.draft.points.pop(); if (!this.bp.draft.points.length) this.bp.draft = null; e.preventDefault(); }
      }
      if (store.builder && this.builderSelId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const o = store.objects.find((x) => x.id === this.builderSelId);
        if (!o) return;
        const step = e.shiftKey ? 0.5 : 0.1;
        if (e.key === 'ArrowUp') o.y -= step; if (e.key === 'ArrowDown') o.y += step;
        if (e.key === 'ArrowLeft') o.x -= step; if (e.key === 'ArrowRight') o.x += step;
        o.x = +o.x.toFixed(2); o.y = +o.y.toFixed(2);
        e.preventDefault();
        this.h.onBuilderChange && this.h.onBuilderChange(o);
      }
    });
  }

  eventScreen(e) { const r = this.c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  eventWorld(e) { const s = this.eventScreen(e); return this.toWorld(s.x, s.y); }

  onDown(e) {
    this.c.setPointerCapture(e.pointerId);
    const s = this.eventScreen(e);
    this.pointers.set(e.pointerId, s);
    this.anim = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      this.drag = null;
      return;
    }
    const p = this.toWorld(s.x, s.y);
    const base = { pointerId: e.pointerId, pointerType: e.pointerType, start: s, last: s, startWorld: p, active: false, button: e.button };

    if (store.mode === 'blueprint') { this.drag = { ...base, type: 'pan' }; return; }

    if (store.builder && isAdmin()) {
      const sel = store.objects.find((o) => o.id === this.builderSelId);
      if (sel && this.onResizeHandle(s, sel)) { this.drag = { ...base, type: 'resize', id: sel.id, orig: { ...sel } }; return; }
      const obj = this.objectAt(p);
      if (obj) { this.drag = { ...base, type: 'object', id: obj.id, orig: { ...obj } }; return; }
      this.drag = { ...base, type: 'pan' };
      return;
    }

    const v = this.pin && this.pinHit(s) ? null : this.vehicleAt(p);   // v5.3: Pin hat Vorrang
    if (v && canEdit()) {
      const pose = this.poses.get(v.id) || this.targetPose(v);
      this.drag = { ...base, type: 'vehicle', id: v.id, offset: { x: p.x - pose.x, y: p.y - pose.y } };
      return;
    }
    this.drag = { ...base, type: 'pan', vehicleId: v ? v.id : null };
  }

  onResizeHandle(s, o) {
    const br = this.toScreen(o.x + o.w, o.y + o.h);
    return Math.abs(s.x - br.x) < 14 && Math.abs(s.y - br.y) < 14;
  }

  onMove(e) {
    const s = this.eventScreen(e);
    this.shiftDown = e.shiftKey;
    if (e.pointerType === 'mouse') this.mouse = this.toWorld(s.x, s.y);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);

    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.zoomAt(dist / this.pinch.dist, mid.x, mid.y);
      this.cam.x -= (mid.x - this.pinch.mid.x) / this.cam.zoom;
      this.cam.y -= (mid.y - this.pinch.mid.y) / this.cam.zoom;
      this.pinch = { dist, mid };
      return;
    }

    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId) {
      if (e.pointerType === 'mouse' && !d) {
        const p = this.toWorld(s.x, s.y);
        this.hoverVehicle = store.mode === 'hall' && !store.builder ? this.vehicleAt(p) : null;
        const hoverObj = !this.hoverVehicle && store.mode === 'hall' && !store.builder ? this.objectAt(p, ['shelf', 'fridge', 'tyrestack']) : null;
        const sel = store.builder ? store.objects.find((o) => o.id === this.builderSelId) : null;
        this.c.style.cursor = sel && this.onResizeHandle(s, sel) ? 'nwse-resize'
          : (this.hoverVehicle || hoverObj || (store.builder && this.objectAt(p)) || (this.pin && this.pinHit(s))) ? 'pointer'
            : store.mode === 'blueprint' && this.bp.edit && this.bp.tool !== 'select' ? 'crosshair' : 'grab';
      }
      return;
    }
    if (!d.active && Math.hypot(s.x - d.start.x, s.y - d.start.y) > DRAG_THRESHOLD) {
      d.active = true;
      if (d.type === 'vehicle') { this.h.onHaptic && this.h.onHaptic(10); this.hoverVehicle = null; }
    }
    if (!d.active) return;
    const p = this.toWorld(s.x, s.y);

    if (d.type === 'pan') {
      this.cam.x -= (s.x - d.last.x) / this.cam.zoom;
      this.cam.y -= (s.y - d.last.y) / this.cam.zoom;
      this.userMoved = true;
      this.c.style.cursor = 'grabbing';
    } else if (d.type === 'vehicle') {
      d.world = p;
      d.target = this.dropTargetAt(p, store.vehicles.find((v) => v.id === d.id));
      if (d.target && (!d.lastTarget || d.lastTarget.slot !== d.target.slot || d.lastTarget.kind !== d.target.kind)) this.h.onHaptic && this.h.onHaptic(6);
      d.lastTarget = d.target;
      this.c.style.cursor = 'grabbing';
    } else if (d.type === 'object') {
      const o = store.objects.find((x) => x.id === d.id);
      const step = e.shiftKey ? 0.5 : 0.1;
      o.x = +snap(d.orig.x + (p.x - d.startWorld.x), step).toFixed(2);
      o.y = +snap(d.orig.y + (p.y - d.startWorld.y), step).toFixed(2);
    } else if (d.type === 'resize') {
      const o = store.objects.find((x) => x.id === d.id);
      o.w = Math.max(0.2, +snap(d.orig.w + (p.x - d.startWorld.x), 0.1).toFixed(2));
      o.h = Math.max(0.1, +snap(d.orig.h + (p.y - d.startWorld.y), 0.1).toFixed(2));
    }
    d.last = s;
  }

  onUp(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
    const d = this.drag;
    this.drag = null;
    if (!d || d.pointerId !== e.pointerId || cancelled) return;
    this.c.style.cursor = 'grab';
    const p = this.toWorld(d.last.x, d.last.y);

    if (d.active) {
      if (d.type === 'vehicle') {
        const v = store.vehicles.find((x) => x.id === d.id);
        // Pose am Drop-Punkt lassen, damit das Einrasten animiert
        this.poses.set(v.id, { ...(this.poses.get(v.id) || this.targetPose(v)), x: d.world.x - d.offset.x, y: d.world.y - d.offset.y });
        if (d.target && this.h.onMove) this.h.onMove(v, d.target);
      } else if ((d.type === 'object' || d.type === 'resize') && this.h.onBuilderChange) {
        this.h.onBuilderChange(store.objects.find((x) => x.id === d.id));
      }
      return;
    }
    this.handleClick(p, d);
  }

  handleClick(p, d) {
    const touchLike = d.pointerType !== 'mouse';

    if (store.mode === 'blueprint') { this.blueprintClick(p); return; }

    if (store.builder && isAdmin()) {
      const obj = this.objectAt(p);
      this.builderSelId = obj ? obj.id : null;
      this.h.onBuilderSelect && this.h.onBuilderSelect(obj);
      return;
    }

    // v5.3: Such-Pin antippen = ganz nah heranzoomen
    if (this.pin && this.pinHit(d.last)) { this.h.onPinClick && this.h.onPinClick(this.pin); return; }

    const v = this.vehicleAt(p);
    // Tap-to-Move: Auto ist ausgewählt -> Ziel antippen
    if (this.selectedVehicleId) {
      const sel = store.vehicles.find((x) => x.id === this.selectedVehicleId);
      if (v && v.id === this.selectedVehicleId) { this.select(null); this.h.onVehicleClick && this.h.onVehicleClick(v); return; }
      const target = this.dropTargetAt(p, sel);
      if (sel && target && !(target.kind === 'slot' && target.slot.id === sel.slot_id && !target.full)) {
        this.h.onHaptic && this.h.onHaptic([10, 30, 10]);
        this.h.onMove && this.h.onMove(sel, target);
        this.select(null);
        return;
      }
      if (v) { this.select(v.id); return; }
      this.select(null);
      return;
    }

    if (v) {
      if (touchLike && canEdit()) { this.select(v.id); this.h.onHaptic && this.h.onHaptic(12); return; }
      this.h.onVehicleClick && this.h.onVehicleClick(v);
      return;
    }
    // Priorität: Kühlschrank/Reifenlager/Regal > Stellplatz/Werkbank > Zonen (z. B. Chill-Ecke)
    const obj = this.objectAt(p, ['fridge', 'tyrestack', 'shelf']) || this.objectAt(p, ['slot', 'toolwall', 'workbench']) || this.objectAt(p, ['zone']);
    if (obj && this.h.onObjectClick) this.h.onObjectClick(obj);
  }

  select(id) {
    this.selectedVehicleId = id;
    this.h.onVehicleSelect && this.h.onVehicleSelect(id ? store.vehicles.find((v) => v.id === id) : null);
  }

  /* ---------- Blueprint-Editor ---------- */
  bpSnap(p, last) {
    let x = snap(p.x, 0.05); let y = snap(p.y, 0.05);
    // an vorhandene Punkte andocken
    const tol = Math.max(0.2, 10 / this.cam.zoom);
    for (const it of store.blueprint) {
      for (const pt of it.points) if (Math.hypot(pt[0] - p.x, pt[1] - p.y) < tol) return { x: pt[0], y: pt[1] };
    }
    // orthogonal zum letzten Punkt (Leitungen laufen meist gerade)
    if (last && !(this.shiftDown)) {
      if (Math.abs(x - last[0]) < Math.abs(y - last[1])) x = last[0]; else y = last[1];
    }
    return { x: +x.toFixed(2), y: +y.toFixed(2) };
  }

  blueprintClick(p) {
    if (!(this.bp.edit && isAdmin())) {
      const it = this.blueprintAt(p);
      this.bp.selId = it ? it.id : null;
      this.h.onBlueprintSelect && this.h.onBlueprintSelect(it);
      return;
    }
    if (this.bp.tool === 'select') {
      const it = this.blueprintAt(p);
      this.bp.selId = it ? it.id : null;
      this.h.onBlueprintSelect && this.h.onBlueprintSelect(it);
    } else if (this.bp.tool === 'node') {
      const s = this.bpSnap(p, null);
      this.h.onBlueprintCreate && this.h.onBlueprintCreate({ type: 'node', kind: this.bp.kind, points: [[s.x, s.y]] });
    } else if (this.bp.tool === 'line') {
      const last = this.bp.draft ? this.bp.draft.points[this.bp.draft.points.length - 1] : null;
      const s = this.bpSnap(p, last);
      if (!this.bp.draft) this.bp.draft = { kind: this.bp.kind, points: [] };
      const prev = this.bp.draft.points[this.bp.draft.points.length - 1];
      if (!prev || prev[0] !== s.x || prev[1] !== s.y) this.bp.draft.points.push([s.x, s.y]);
      this.h.onHaptic && this.h.onHaptic(5);
    }
  }

  finishLine() {
    const d = this.bp.draft;
    this.bp.draft = null;
    if (d && d.points.length >= 2 && this.h.onBlueprintCreate) this.h.onBlueprintCreate({ type: 'line', kind: d.kind, points: d.points });
  }

  /* ======================= Render-Loop ======================= */
  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.time += dt;
    if (this.anim) {
      const k = Math.min(1, (t - this.anim.start) / this.anim.duration);
      const e = ease(k);
      const { from, to } = this.anim;
      // Zoom logarithmisch interpolieren = gleichmäßiger Kamera-Flug
      this.cam.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      this.cam.x = from.x + (to.x - from.x) * e;
      this.cam.y = from.y + (to.y - from.y) * e;
      if (k >= 1) { const after = this.anim.after; this.anim = null; if (after) after(); }
    }
    this.updatePoses(dt);
    this.render();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  updatePoses(dt) {
    const seen = new Set();
    for (const v of store.vehicles) {
      seen.add(v.id);
      const target = this.targetPose(v);
      const cur = this.poses.get(v.id);
      if (!cur) { this.poses.set(v.id, { ...target }); continue; }
      const k = Math.min(1, dt * 9);
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      cur.a += (target.a - cur.a) * k;
      cur.raised = target.raised;
    }
    for (const id of this.poses.keys()) if (!seen.has(id)) this.poses.delete(id);
  }

  label(x, y, text, opts = {}) { this.labels.push({ x, y, text, ...opts }); }

  render() {
    const ctx = this.ctx;
    this.labels = [];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bp = store.mode === 'blueprint';
    ctx.fillStyle = bp ? '#041021' : '#0b0e13';
    ctx.fillRect(0, 0, this.cw, this.ch);

    ctx.save();
    ctx.translate(this.cw / 2, this.ch / 2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    if (bp) this.drawBlueprint(ctx); else this.drawHall(ctx);
    ctx.restore();

    this.drawLabels(ctx);
    if (!bp) this.drawPin(ctx);   // v5.3
    if (!bp) this.drawHoverCard(ctx);
  }

  /* ---------- Halle ---------- */
  drawHall(ctx) {
    const z = this.cam.zoom;
    const hall = this.hall;
    const px = 1 / z;
    const pad = this.paddock();

    // Außenbereich: Asphalt
    ctx.fillStyle = '#12161c';
    const wb = this.worldBounds();
    ctx.fillRect(wb.x - 50, wb.y - 50, wb.w + 100, wb.h + 100);

    // Paddock
    ctx.fillStyle = '#171b22';
    ctx.fillRect(pad.area.x, pad.area.y, pad.area.w, pad.area.h);
    ctx.strokeStyle = 'rgba(250,204,21,0.25)';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([0.4, 0.3]);
    ctx.strokeRect(pad.area.x, pad.area.y, pad.area.w, pad.area.h);
    ctx.setLineDash([]);
    this.label(pad.area.x + pad.area.w / 2, pad.area.y - 0.35, 'UNTERWEGS · PADDOCK', { size: 12, color: '#facc15', weight: 700, font: 'display', spacing: 2 });
    pad.bays.forEach((b, i) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.stroke();
      this.label(b.x + b.w / 2, b.y + b.h - 0.25, `P${i + 1}`, { size: 10, color: 'rgba(255,255,255,0.25)', font: 'mono' });
    });

    // Hallenboden
    const floor = ctx.createLinearGradient(0, 0, 0, hall.h);
    floor.addColorStop(0, '#262b33'); floor.addColorStop(1, '#20252c');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, hall.w, hall.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let x = 1; x < hall.w; x += 1) { ctx.moveTo(x, 0); ctx.lineTo(x, hall.h); }
    for (let y = 1; y < hall.h; y += 1) { ctx.moveTo(0, y); ctx.lineTo(hall.w, y); }
    ctx.stroke();
    if (store.builder) this.drawBuilderGrid(ctx, hall);

    // Wände (Einfahrt offen)
    const door = store.objects.find((o) => o.type === 'door');
    ctx.strokeStyle = '#5b6573';
    ctx.lineWidth = 0.22;
    ctx.lineCap = 'square';
    ctx.beginPath();
    if (door) {
      ctx.moveTo(door.x, hall.h); ctx.lineTo(0, hall.h); ctx.lineTo(0, 0); ctx.lineTo(hall.w, 0); ctx.lineTo(hall.w, hall.h); ctx.lineTo(door.x + door.w, hall.h);
    } else ctx.rect(0, 0, hall.w, hall.h);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Mittellinie zwischen den Spuren
    ctx.strokeStyle = 'rgba(250,204,21,0.35)';
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.6, 0.45]);
    ctx.beginPath(); ctx.moveTo(hall.w / 2 - 0.1, 6.3); ctx.lineTo(hall.w / 2 - 0.1, hall.h - 0.3); ctx.stroke();
    ctx.setLineDash([]);
    this.label(hall.w / 2, hall.h + 0.55, `${(store.hall.name || 'HALLE').toUpperCase()} · ${hall.w} × ${hall.h} m · EINFAHRT`, { size: 11, color: '#94a3b8', weight: 600, font: 'display', spacing: 2 });

    // Layout-Objekte
    const sorted = [...store.objects].sort((a, b) => a.sort - b.sort);
    for (const o of sorted) this.drawObject(ctx, o);

    // Schneisen-Warnung
    this.drawLaneWarnings(ctx);
    this.drawWallLed();
    this.drawHudMarkers(ctx);   // v4: kritischer Mangel + Dinge in der Schwebe

    // Drag-Feedback
    const d = this.drag;
    if (d && d.active && d.type === 'vehicle') this.drawDropHints(ctx, d);
    if (this.selectedVehicleId) this.drawDropHints(ctx, { id: this.selectedVehicleId, target: null });

    // Autos
    const list = [...store.vehicles].sort((a, b) => this.drawOrder(a) - this.drawOrder(b));
    for (const v of list) this.drawVehicle(ctx, v);

    if (this.highlight && performance.now() < this.highlight.until) {
      const r = this.highlight.rect;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
      ctx.save();
      ctx.strokeStyle = `rgba(34,211,238,${0.4 + 0.6 * pulse})`;
      ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 20;
      ctx.lineWidth = 0.08 + 0.06 * pulse;
      ctx.strokeRect(r.x - 0.25, r.y - 0.25, r.w + 0.5, r.h + 0.5);
      ctx.restore();
    }
    if (store.builder) this.drawBuilderSelection(ctx);
  }

  drawBuilderGrid(ctx, hall) {
    ctx.strokeStyle = 'rgba(34,211,238,0.10)';
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.beginPath();
    for (let x = 0; x <= hall.w; x += 0.5) { ctx.moveTo(x, 0); ctx.lineTo(x, hall.h); }
    for (let y = 0; y <= hall.h; y += 0.5) { ctx.moveTo(0, y); ctx.lineTo(hall.w, y); }
    ctx.stroke();
  }

  hatch(ctx, o, color, spacing = 0.35, offset = 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = spacing * 0.35;
    ctx.beginPath();
    const span = o.w + o.h;
    for (let s = -span + (offset % (spacing * 2)); s < span; s += spacing) {
      ctx.moveTo(o.x + s, o.y); ctx.lineTo(o.x + s + o.h, o.y + o.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawObject(ctx, o) {
    const color = o.color || '#94a3b8';
    const px = 1 / this.cam.zoom;
    switch (o.type) {
      case 'zone': {
        ctx.fillStyle = `${color}14`;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        if (o.props.hatch) this.hatch(ctx, o, `${color}22`, 0.5);
        ctx.strokeStyle = `${color}88`;
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([0.25, 0.18]);
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.setLineDash([]);
        if (o.code === 'KOMP') {
          ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 0.05;
          ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.35, o.h * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        this.label(o.x + 0.15, o.y + 0.3, (o.label || '').toUpperCase(), { size: 10, color, align: 'left', weight: 700, font: 'display', spacing: 1.5 });
        break;
      }
      case 'slot': {
        const kind = o.props.kind || 'standard';
        ctx.fillStyle = kind === 'lift' ? 'rgba(34,211,238,0.05)' : 'rgba(255,255,255,0.02)';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        // Ecken-Markierungen
        ctx.strokeStyle = `${color}cc`;
        ctx.lineWidth = 0.07;
        const c = 0.6;
        ctx.beginPath();
        for (const [x, y, dx, dy] of [[o.x, o.y, 1, 1], [o.x + o.w, o.y, -1, 1], [o.x, o.y + o.h, 1, -1], [o.x + o.w, o.y + o.h, -1, -1]]) {
          ctx.moveTo(x + dx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * c);
        }
        ctx.stroke();
        if (kind === 'buffer') {
          ctx.strokeStyle = `${color}55`; ctx.lineWidth = 0.04; ctx.setLineDash([0.3, 0.25]);
          ctx.strokeRect(o.x, o.y, o.w, o.h); ctx.setLineDash([]);
        }
        if (kind === 'lift') this.drawLift(ctx, o);
        // Platzkennung groß auf den Boden gemalt
        this.label(o.x + o.w / 2, o.y + o.h / 2, o.code || '', { size: Math.max(12, Math.min(64, o.w * this.cam.zoom * 0.42)), color: 'rgba(255,255,255,0.07)', weight: 800, font: 'display', world: true });
        const slotText = (o.label || '').toUpperCase().includes(String(o.code || '').toUpperCase()) ? o.label : `${o.code || ''} · ${o.label || ''}`;
        this.label(o.x + 0.14, o.y + 0.24, slotText.toUpperCase(), { size: 9, color: `${color}`, weight: 700, font: 'display', spacing: 1, align: 'left' });
        break;
      }
      case 'shelf': {
        ctx.fillStyle = '#1c2633';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = color; ctx.lineWidth = 0.05;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        // Fachböden + Boxen-Andeutung
        const vertical = o.h >= o.w;
        const n = Math.max(2, Math.round((vertical ? o.h : o.w) / 0.6));
        ctx.lineWidth = 0.03; ctx.strokeStyle = `${color}88`;
        ctx.beginPath();
        for (let i = 1; i < n; i += 1) {
          if (vertical) { ctx.moveTo(o.x, o.y + (o.h / n) * i); ctx.lineTo(o.x + o.w, o.y + (o.h / n) * i); } else { ctx.moveTo(o.x + (o.w / n) * i, o.y); ctx.lineTo(o.x + (o.w / n) * i, o.y + o.h); }
        }
        ctx.stroke();
        const boxColors = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316', '#a855f7'];
        for (let i = 0; i < n; i += 1) {
          ctx.fillStyle = `${boxColors[(i + o.id) % boxColors.length]}aa`;
          if (vertical) ctx.fillRect(o.x + o.w * 0.18, o.y + (o.h / n) * i + 0.08, o.w * 0.64, o.h / n - 0.16);
          else ctx.fillRect(o.x + (o.w / n) * i + 0.08, o.y + o.h * 0.18, o.w / n - 0.16, o.h * 0.64);
        }
        this.label(vertical ? o.x + o.w + 0.2 : o.x + o.w / 2, vertical ? o.y + o.h / 2 : o.y - 0.3, (o.label || `Regal ${o.code}`).toUpperCase(),
          { size: 11, color, weight: 700, font: 'display', align: vertical ? 'left' : 'center', spacing: 1, bg: 'rgba(8,12,18,0.75)' });
        break;
      }
      case 'workbench': {
        const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
        g.addColorStop(0, '#5a3a1c'); g.addColorStop(0.5, '#8a5a2b'); g.addColorStop(1, '#5a3a1c');
        ctx.fillStyle = g; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.03; ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#334155';
        ctx.fillRect(o.x + o.w * 0.2, o.y + 0.15, o.w * 0.6, 0.35); // Schraubstock
        this.label(o.x + o.w / 2, o.y + o.h / 2, (o.label || 'Werkbank').toUpperCase(), { size: 9, color: '#fcd34d', weight: 700, font: 'display', rotate: o.h > o.w });
        break;
      }
      case 'toolwall': {
        ctx.fillStyle = '#334155'; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#0f172a';
        for (let x = o.x + 0.1; x < o.x + o.w; x += 0.15) for (let y = o.y + 0.06; y < o.y + o.h; y += 0.12) ctx.fillRect(x, y, 0.03, 0.03);
        this.label(o.x + o.w / 2, o.y - 0.3, (o.label || 'Werkzeugwand').toUpperCase(), { size: 9, color: '#94a3b8', weight: 600, font: 'display' });
        break;
      }
      case 'door': {
        ctx.save();
        ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip();
        ctx.fillStyle = '#facc15'; ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#111'; ctx.lineWidth = 0.12;
        ctx.beginPath();
        for (let x = o.x - o.h * 2; x < o.x + o.w; x += 0.35) { ctx.moveTo(x, o.y + o.h); ctx.lineTo(x + o.h * 2, o.y); }
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'fridge': this.drawFridge(ctx, o); break;
      case 'tyrestack': this.drawTyreStack(ctx, o); break;
      default:
        ctx.strokeStyle = color; ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
  }

  /* v2: Kühlschrank mit Low-Stock-Puls */
  drawFridge(ctx, o) {
    const low = (store.supplies || []).filter((s) => s.low);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    ctx.save();
    if (low.length) { ctx.shadowColor = '#f43f5e'; ctx.shadowBlur = 10 + 16 * pulse; }
    const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
    g.addColorStop(0, '#cbd5e1'); g.addColorStop(0.5, '#f1f5f9'); g.addColorStop(1, '#94a3b8');
    ctx.fillStyle = g;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.restore();
    ctx.strokeStyle = low.length ? `rgba(244,63,94,${0.5 + 0.5 * pulse})` : '#38bdf8';
    ctx.lineWidth = low.length ? 0.06 : 0.03;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#475569';
    ctx.fillRect(o.x + o.w * 0.12, o.y + o.h * 0.38, o.w * 0.76, 0.03);       // Türspalt
    ctx.fillRect(o.x + o.w * 0.15, o.y + o.h * 0.1, 0.05, o.h * 0.2);         // Griff
    ctx.fillStyle = low.length ? `rgba(244,63,94,${0.6 + 0.4 * pulse})` : '#22c55e';
    ctx.beginPath(); ctx.arc(o.x + o.w * 0.75, o.y + o.h * 0.2, 0.05, 0, Math.PI * 2); ctx.fill(); // Status-LED
    this.label(o.x + o.w + 0.2, o.y + o.h / 2, 'KÜHLSCHRANK', { size: 10, color: '#bae6fd', weight: 700, font: 'display', align: 'left', bg: 'rgba(8,12,18,0.75)' });
    if (low.length) {
      const first = low[0];
      this.label(o.x + o.w + 0.2, o.y + o.h / 2 + 0.48, `${first.name.toUpperCase()} ${first.qty <= 0 ? 'LEER' : 'FAST LEER'}!${low.length > 1 ? ` +${low.length - 1}` : ''}`,
        { size: 9.5, color: '#fff', bg: `rgba(225,29,72,${0.55 + 0.45 * pulse})`, weight: 800, font: 'display', align: 'left' });
    }
  }

  /* v2: Reifenstapel (Draufsicht: gestapelte Reifen) */
  drawTyreStack(ctx, o) {
    ctx.fillStyle = 'rgba(15,23,42,0.6)';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    const r = Math.min(o.w, 0.66) / 2;
    const n = Math.max(1, Math.floor(o.h / (r * 2 + 0.02)));
    for (let i = 0; i < n; i += 1) {
      const cx = o.x + o.w / 2; const cy = o.y + r + 0.01 + i * (o.h / n);
      ctx.fillStyle = '#0b0c0f';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.025;
      for (let k = 0; k < 3; k += 1) { ctx.beginPath(); ctx.arc(cx, cy, r * (0.92 - k * 0.07), 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#050608';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(249,115,22,0.6)'; ctx.lineWidth = 0.03;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    const drift = store.ticker && typeof store.ticker.driftTyres === 'number' ? store.ticker.driftTyres : null;
    this.label(o.x + o.w + 0.2, o.y + o.h / 2, (o.label || 'Reifenlager').toUpperCase(), { size: 11, color: '#fdba74', weight: 700, font: 'display', align: 'left', spacing: 1, bg: 'rgba(8,12,18,0.75)' });
    if (drift !== null) {
      this.label(o.x + o.w + 0.2, o.y + o.h / 2 + 0.5, `${drift} DRIFTREIFEN`, { size: 9, color: drift < 4 ? '#fff' : '#0b0b0b', bg: drift < 4 ? '#e11d48' : '#fb923c', weight: 800, font: 'display', align: 'left' });
    }
  }

  /* v4: Kritischer Mangel (roter Neon-Rahmen am Lagerort) + "liegt rum"-Marker an Plätzen und Autos */
  drawHudMarkers(ctx) {
    const h = store.hud;
    if (!h || store.mode !== 'hall' || store.builder) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    const fmt = (c) => (c.qty <= 0 ? 'LEER' : `${Number(c.qty).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${c.unit}`);
    if (h.critical && h.critical.length) {
      const fallback = store.objects.find((o) => o.type === 'shelf');
      const groups = new Map();
      for (const c of h.critical) {
        const o = (c.location_object_id && store.objects.find((x) => x.id === c.location_object_id)) || fallback;
        if (!o) continue;
        if (!groups.has(o.id)) groups.set(o.id, { o, list: [] });
        groups.get(o.id).list.push(c);
      }
      for (const { o, list } of groups.values()) {
        ctx.save();
        ctx.strokeStyle = `rgba(244,63,94,${0.45 + 0.55 * pulse})`;
        ctx.shadowColor = '#f43f5e'; ctx.shadowBlur = 10 + 20 * pulse;
        ctx.lineWidth = 0.07;
        ctx.strokeRect(o.x - 0.12, o.y - 0.12, o.w + 0.24, o.h + 0.24);
        ctx.restore();
        const vertical = o.h > o.w;
        const c = list[0];
        this.label(vertical ? o.x + o.w + 0.2 : o.x + o.w / 2, vertical ? o.y + o.h / 2 + 0.5 : o.y + o.h + 0.45,
          `KRITISCH: ${c.name.toUpperCase()} ${fmt(c)}${list.length > 1 ? ` +${list.length - 1}` : ''}`,
          { size: 9.5, color: '#fff', bg: `rgba(225,29,72,${0.6 + 0.4 * pulse})`, weight: 800, font: 'display', align: vertical ? 'left' : 'center' });
      }
    }
    const fl = h.floating || [];
    if (!fl.length) return;
    const anchors = new Map();
    for (const f of fl) {
      let key = null; let pos = null;
      if (f.vehicle_id && this.poses.get(f.vehicle_id)) {
        const p = this.poses.get(f.vehicle_id);
        key = `v${f.vehicle_id}`; pos = { x: p.x, y: p.y - 1.2, align: 'center' };
      } else if (f.object_id) {
        const o = store.objects.find((x) => x.id === f.object_id);
        if (o) { key = `o${o.id}`; pos = { x: o.x + o.w - 0.08, y: o.y + 0.8, align: 'right' }; }
      }
      if (!key) continue;
      if (!anchors.has(key)) anchors.set(key, { pos, n: 0, label: f.label });
      anchors.get(key).n += 1;
    }
    for (const a of anchors.values()) {
      const text = a.n === 1 ? `◆ ${a.label.toUpperCase().slice(0, 20)}` : `◆ ${a.n} DINGE LIEGEN RUM`;
      this.label(a.pos.x, a.pos.y, text, { size: 9, color: '#1a1003', bg: `rgba(251,191,36,${0.75 + 0.25 * pulse})`, weight: 800, font: 'display', align: a.pos.align });
    }
  }

  /* v2: LED-Schild an der Hallenwand (Event-Countdown) */
  drawWallLed() {
    const t = store.ticker;
    if (!t || !t.event) return;
    const start = new Date(`${t.event.date_start}T${t.event.start_time || '08:00'}:00`);
    const diff = Math.max(0, start - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const colon = Math.floor(Date.now() / 500) % 2 ? ':' : ' ';
    const hall = this.hall;
    this.label(hall.w * 0.72, -0.5, `${t.event.name.toUpperCase()}  ${String(d).padStart(2, '0')}T ${String(h).padStart(2, '0')}${colon}${String(m).padStart(2, '0')}`,
      { size: 10, color: '#ffb000', bg: '#0a0806', weight: 700, font: 'mono' });
  }

  drawLift(ctx, o) {
    // Zwei-Säulen-Bühne: Säulen links/rechts + Tragarme
    const midY = o.y + o.h / 2;
    ctx.fillStyle = '#3b4656';
    ctx.strokeStyle = '#22d3ee66';
    ctx.lineWidth = 0.03;
    for (const x of [o.x - 0.05, o.x + o.w - 0.3]) {
      ctx.fillRect(x, midY - 0.25, 0.35, 0.5);
      ctx.strokeRect(x, midY - 0.25, 0.35, 0.5);
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.45)';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(o.x + 0.25, midY); ctx.lineTo(o.x + o.w * 0.35, midY - 1.3);
    ctx.moveTo(o.x + 0.25, midY); ctx.lineTo(o.x + o.w * 0.35, midY + 1.3);
    ctx.moveTo(o.x + o.w - 0.25, midY); ctx.lineTo(o.x + o.w * 0.65, midY - 1.3);
    ctx.moveTo(o.x + o.w - 0.25, midY); ctx.lineTo(o.x + o.w * 0.65, midY + 1.3);
    ctx.stroke();
  }

  laneBlocked() {
    return this.slots().filter((s) => s.props.blocksLane && store.vehicles.some((v) => v.slot_id === s.id));
  }

  drawLaneWarnings(ctx) {
    const blocked = this.laneBlocked();
    if (!blocked.length) return;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 5);
    for (const s of blocked) {
      // animierte Warnstreifen als Rahmen
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x - 0.12, s.y - 0.12, s.w + 0.24, s.h + 0.24);
      ctx.rect(s.x + 0.14, s.y + 0.14, s.w - 0.28, s.h - 0.28);
      ctx.clip('evenodd');
      ctx.fillStyle = '#facc15';
      ctx.fillRect(s.x - 0.2, s.y - 0.2, s.w + 0.4, s.h + 0.4);
      this.hatch(ctx, { x: s.x - 0.2, y: s.y - 0.2, w: s.w + 0.4, h: s.h + 0.4 }, '#0b0b0b', 0.42, this.time * 0.8);
      ctx.restore();
    }
    // Plätze dahinter in derselben Spur kommen nicht mehr raus (z. B. Hebebühne 1)
    const top = blocked.reduce((a, b) => (b.y < a.y ? b : a));
    const behind = this.slots().filter((s) => !s.props.blocksLane && s.y + s.h <= top.y + 0.01
      && s.x < top.x + top.w && s.x + s.w > top.x && store.vehicles.some((v) => v.slot_id === s.id));
    for (const s of behind) {
      ctx.save();
      ctx.strokeStyle = `rgba(244,63,94,${0.45 + 0.55 * pulse})`;
      ctx.lineWidth = 0.09;
      ctx.setLineDash([0.35, 0.2]);
      ctx.strokeRect(s.x - 0.05, s.y - 0.05, s.w + 0.1, s.h + 0.1);
      ctx.restore();
    }
    this.label(top.x + top.w / 2, top.y, behind.length ? 'SCHNEISE BLOCKIERT · AUSFAHRT ZU' : 'SCHNEISE BLOCKIERT!',
      { size: 10.5, color: '#0b0b0b', bg: `rgba(250,204,21,${0.75 + 0.25 * pulse})`, weight: 800, font: 'display', spacing: 1 });
  }

  drawDropHints(ctx, d) {
    const v = store.vehicles.find((x) => x.id === d.id);
    for (const s of this.slots()) {
      const cap = Number(s.props.capacity) || 1;
      const occ = store.vehicles.filter((x) => x.slot_id === s.id && x.id !== d.id).length;
      const free = occ < cap;
      const isTarget = d.target && d.target.kind === 'slot' && d.target.slot.id === s.id;
      ctx.save();
      ctx.strokeStyle = free ? 'rgba(74,222,128,0.85)' : 'rgba(244,63,94,0.75)';
      ctx.fillStyle = free ? 'rgba(74,222,128,0.10)' : 'rgba(244,63,94,0.08)';
      if (isTarget) { ctx.fillStyle = free ? 'rgba(74,222,128,0.28)' : 'rgba(250,204,21,0.25)'; ctx.shadowColor = free ? '#4ade80' : '#facc15'; ctx.shadowBlur = 24; }
      ctx.lineWidth = isTarget ? 0.12 : 0.05;
      ctx.setLineDash(isTarget ? [] : [0.3, 0.2]);
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.restore();
      if (isTarget && !free) this.label(s.x + s.w / 2, s.y + s.h / 2 + 1.2, 'BELEGT · TAUSCHEN?', { size: 10, color: '#0b0b0b', bg: '#facc15', weight: 800, font: 'display' });
      if (isTarget && free && cap > 1) this.label(s.x + s.w / 2, s.y + s.h / 2 + 1.2, occ ? 'DARUNTER PARKEN' : 'AUF DIE BÜHNE', { size: 10, color: '#052e16', bg: '#4ade80', weight: 800, font: 'display' });
    }
    const pad = this.paddock().area;
    const isExt = d.target && d.target.kind === 'extern';
    if (v && (v.slot_id || isExt)) {
      ctx.save();
      ctx.strokeStyle = isExt ? '#facc15' : 'rgba(250,204,21,0.5)';
      ctx.fillStyle = isExt ? 'rgba(250,204,21,0.12)' : 'rgba(250,204,21,0.04)';
      ctx.lineWidth = isExt ? 0.12 : 0.05;
      ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
      ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);
      ctx.restore();
    }
  }

  drawVehicle(ctx, v) {
    const m = modelInfo(v.model);
    const st = statusInfo(v.status);
    let pose = this.poses.get(v.id) || this.targetPose(v);
    const d = this.drag;
    const dragging = d && d.active && d.type === 'vehicle' && d.id === v.id;
    if (dragging) pose = { ...pose, x: d.world.x - d.offset.x, y: d.world.y - d.offset.y, raised: true };
    const working = store.work.filter((w) => w.vehicle_id === v.id);
    const pulse = working.length ? 0.55 + 0.45 * Math.sin(this.time * 4) : 0.75;
    const lower = v.slot_id && v.slot_pos === 1 && store.vehicles.some((o) => o.slot_id === v.slot_id && o.slot_pos === 0);

    drawCar(ctx, {
      x: pose.x, y: pose.y, angle: pose.a, scale: 1, pxScale: this.cam.zoom,
      model: m, color: v.color, glow: st.color, glowStrength: dragging ? 1 : pulse,
      raised: pose.raised || dragging, selected: this.selectedVehicleId === v.id, time: this.time * 60,
      dim: lower || (store.builder ? true : false), alpha: store.builder ? 0.35 : 1
    });

    if (store.builder) return;
    const r = this.vehicleRect(v);
    // Namensschild
    const short = v.name.length > 22 ? `${v.name.slice(0, 21)}…` : v.name;
    if (!dragging) {
      this.label(pose.x, r.y + r.h + 0.3, short, { size: 10.5, color: '#e2e8f0', bg: 'rgba(8,12,18,0.78)', weight: 600 });
      if (!v.slot_id) this.label(pose.x, r.y + r.h + 0.72, (v.extern_location || 'Paddock').toUpperCase(), { size: 9, color: '#facc15', weight: 700, font: 'display', spacing: 1 });
      const slot = v.slot_id && store.objects.find((o) => o.id === v.slot_id);
      if (slot && (Number(slot.props.capacity) || 1) > 1) {
        this.label(pose.x + r.w / 2 + 0.05, pose.y - r.h / 2 + 0.3, v.slot_pos === 0 ? '▲ OBEN' : '▼ UNTEN', { size: 9, color: '#0b0b0b', bg: v.slot_pos === 0 ? '#22d3ee' : '#94a3b8', weight: 800, font: 'display', align: 'left' });
      }
    }
    // Wer schraubt gerade? (pulsierende Avatare)
    working.forEach((w, i) => {
      this.label(pose.x - (working.length - 1) * 0.35 + i * 0.7, r.y - 0.35, (w.user_name || '?').slice(0, 1).toUpperCase(),
        { size: 11, color: '#0b0b0b', bg: w.user_color || '#22d3ee', weight: 800, circle: true, pulse });
    });
    if (v.open_tasks > 0 && !dragging) {
      this.label(pose.x + r.w / 2 - 0.1, r.y + 0.25, String(v.open_tasks), { size: 9.5, color: '#0b0b0b', bg: '#f59e0b', weight: 800, circle: true });
    }
    // v5.3: Arbeit unterbrochen ("Nicht fertig geworden"): gestrichelter Warnrahmen + Badge mit Rest-To-do
    if (v.paused_tasks > 0 && !dragging) {
      const pw = 0.6 + 0.4 * Math.sin(this.time * 3);
      ctx.save();
      ctx.strokeStyle = `rgba(249,115,22,${0.55 + 0.45 * pw})`;
      ctx.lineWidth = 0.07;
      ctx.setLineDash([0.28, 0.18]);
      ctx.lineDashOffset = -this.time * 0.6;
      ctx.strokeRect(r.x - 0.16, r.y - 0.16, r.w + 0.32, r.h + 0.32);
      ctx.restore();
      this.label(pose.x, r.y + r.h + (v.slot_id ? 0.74 : 1.14), '⏸ IN ARBEIT · TO-DO OFFEN', { size: 9, color: '#1a0f00', bg: `rgba(249,115,22,${0.78 + 0.22 * pw})`, weight: 800, font: 'display', spacing: 0.5 });
    }
  }

  drawBuilderSelection(ctx) {
    const o = store.objects.find((x) => x.id === this.builderSelId);
    if (!o) return;
    const px = 1 / this.cam.zoom;
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(o.x + o.w - 6 * px, o.y + o.h - 6 * px, 12 * px, 12 * px);
    ctx.restore();
    this.label(o.x + o.w / 2, o.y - 0.3, `${o.w.toFixed(1)} × ${o.h.toFixed(1)} m  @ ${o.x.toFixed(1)} / ${o.y.toFixed(1)}`, { size: 10, color: '#22d3ee', bg: 'rgba(4,16,33,0.9)', font: 'mono' });
  }

  /* ---------- Blueprint ---------- */
  drawBlueprint(ctx) {
    const hall = this.hall;
    const wb = this.worldBounds();
    const px = 1 / this.cam.zoom;
    // Gitter
    ctx.lineWidth = px;
    ctx.strokeStyle = 'rgba(56,189,248,0.07)';
    ctx.beginPath();
    for (let x = Math.floor(wb.x); x <= wb.x + wb.w; x += 0.25) { ctx.moveTo(x, wb.y); ctx.lineTo(x, wb.y + wb.h); }
    for (let y = Math.floor(wb.y); y <= wb.y + wb.h; y += 0.25) { ctx.moveTo(wb.x, y); ctx.lineTo(wb.x + wb.w, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(56,189,248,0.18)';
    ctx.beginPath();
    for (let x = Math.floor(wb.x); x <= wb.x + wb.w; x += 1) { ctx.moveTo(x, wb.y); ctx.lineTo(x, wb.y + wb.h); }
    for (let y = Math.floor(wb.y); y <= wb.y + wb.h; y += 1) { ctx.moveTo(wb.x, y); ctx.lineTo(wb.x + wb.w, y); }
    ctx.stroke();

    // Hallen-Umriss (Neon)
    ctx.save();
    ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 0.08;
    ctx.strokeRect(0, 0, hall.w, hall.h);
    ctx.restore();
    // Maßketten
    this.label(hall.w / 2, -0.45, `${hall.w.toFixed(2)} m`, { size: 10, color: '#7dd3fc', font: 'mono' });
    this.label(-0.45, hall.h / 2, `${hall.h.toFixed(2)} m`, { size: 10, color: '#7dd3fc', font: 'mono', rotate: true });

    // Objekte als dünne Konturen
    for (const o of store.objects) {
      ctx.strokeStyle = 'rgba(125,211,252,0.35)';
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash(o.type === 'slot' ? [4 * px, 4 * px] : []);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.setLineDash([]);
      this.label(o.x + o.w / 2, o.y + o.h / 2, o.code || o.label || '', { size: 10, color: 'rgba(125,211,252,0.45)', font: 'mono' });
    }

    const kinds = store.meta ? store.meta.blueprintKinds : { line: {}, node: {} };
    // Leitungen mit "Stromfluss"-Animation
    for (const it of store.blueprint.filter((x) => x.type === 'line' && bpVisible(x))) {
      const k = kinds.line[it.kind] || { color: '#fff' };
      const sel = this.bp.selId === it.id;
      ctx.save();
      ctx.shadowColor = k.color; ctx.shadowBlur = sel ? 22 : 12;
      ctx.strokeStyle = k.color;
      ctx.lineWidth = sel ? 0.11 : 0.07;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      it.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.025;
      ctx.setLineDash([0.12, 0.5]);
      ctx.lineDashOffset = -this.time * (it.kind === 'air' ? 1.2 : 2.2);
      ctx.stroke();
      ctx.restore();
      if (it.label && it.points.length > 1) {
        const [a, b] = [it.points[0], it.points[1]];
        this.label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.22, it.label, { size: 9, color: k.color, bg: 'rgba(4,16,33,0.85)', font: 'mono' });
      }
    }
    // Knoten
    for (const it of store.blueprint.filter((x) => x.type === 'node' && bpVisible(x))) {
      const k = kinds.node[it.kind] || { color: '#fff' };
      const [x, y] = it.points[0];
      const sel = this.bp.selId === it.id;
      ctx.save();
      ctx.shadowColor = k.color; ctx.shadowBlur = sel ? 26 : 14;
      ctx.fillStyle = '#041021';
      ctx.strokeStyle = k.color;
      ctx.lineWidth = sel ? 0.08 : 0.05;
      ctx.beginPath();
      if (it.kind === 'verteiler') ctx.rect(x - 0.22, y - 0.22, 0.44, 0.44);
      else if (it.kind === 'sicherungskasten') ctx.rect(x - 0.3, y - 0.3, 0.6, 0.6);
      else if (it.kind === 'kompressor') ctx.arc(x, y, 0.3, 0, Math.PI * 2);
      else ctx.arc(x, y, 0.17, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      const sym = { verteiler: 'UV', sicherungskasten: 'HV', steckdose230: '~', steckdose400: '3~', kompressor: 'K', abscheider: 'A', kupplung: '◦', licht: '✶', schalter: 'S', lampe: '✶', schlauchtrommel: '◎' }[it.kind] || '•';
      this.label(x, y, sym, { size: 10, color: k.color, weight: 800, font: 'mono' });
      if (it.label) this.label(x, y + 0.48, it.label, { size: 9, color: '#e0f2fe', bg: 'rgba(4,16,33,0.85)', font: 'mono' });
    }
    // Zeichnen (Entwurf)
    const draft = this.bp.draft;
    if (draft) {
      const k = kinds.line[draft.kind] || { color: '#fff' };
      ctx.save();
      ctx.strokeStyle = k.color; ctx.lineWidth = 0.07; ctx.setLineDash([0.2, 0.12]);
      ctx.beginPath();
      draft.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      if (this.mouse) {
        const s = this.bpSnap(this.mouse, draft.points[draft.points.length - 1]);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.restore();
      for (const p of draft.points) { ctx.fillStyle = k.color; ctx.fillRect(p[0] - 0.06, p[1] - 0.06, 0.12, 0.12); }
    }
    if (this.bp.edit && this.mouse && this.bp.tool !== 'select') {
      const s = this.bpSnap(this.mouse, draft ? draft.points[draft.points.length - 1] : null);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(s.x - 0.2, s.y); ctx.lineTo(s.x + 0.2, s.y); ctx.moveTo(s.x, s.y - 0.2); ctx.lineTo(s.x, s.y + 0.2); ctx.stroke();
      this.label(s.x + 0.25, s.y - 0.25, `${s.x.toFixed(2)} / ${s.y.toFixed(2)}`, { size: 9, color: '#bae6fd', font: 'mono', align: 'left' });
    }
    // Autos nur als Geister-Umriss
    for (const v of store.vehicles.filter((x) => x.slot_id)) {
      const r = this.vehicleRect(v);
      ctx.strokeStyle = 'rgba(125,211,252,0.15)'; ctx.lineWidth = px;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  /* ---------- Bildschirm-Labels ---------- */
  drawLabels(ctx) {
    const fonts = { display: '"Chakra Petch", ui-sans-serif, system-ui', mono: '"JetBrains Mono", ui-monospace, monospace', body: '"IBM Plex Sans", ui-sans-serif, system-ui' };
    const zoomK = Math.max(0.65, Math.min(1.25, this.cam.zoom / 34));
    for (const l of this.labels) {
      const s = this.toScreen(l.x, l.y);
      if (s.x < -200 || s.y < -50 || s.x > this.cw + 200 || s.y > this.ch + 50) continue;
      const size = l.world ? l.size : l.size * zoomK;
      if (!l.world && size < 6.5) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (l.rotate) ctx.rotate(-Math.PI / 2);
      ctx.font = `${l.weight || 500} ${size}px ${fonts[l.font || 'body']}`;
      if (l.spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${l.spacing}px`;
      ctx.textAlign = l.align || 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(l.text).width;
      // Schilder mit Hintergrund bleiben immer komplett im Bild
      if (l.bg && !l.circle && !l.rotate) {
        const x0 = l.align === 'left' ? -5 : l.align === 'right' ? -w - 5 : -w / 2 - 5;
        const left = s.x + x0; const right = left + w + 10;
        if (left < 4) ctx.translate(4 - left, 0); else if (right > this.cw - 4) ctx.translate(this.cw - 4 - right, 0);
      }
      if (l.circle) {
        const r = size * 0.95 * (l.pulse ? 0.9 + 0.2 * l.pulse : 1);
        if (l.pulse) { ctx.fillStyle = `${l.bg}55`; ctx.beginPath(); ctx.arc(0, 0, r * (1.2 + 0.5 * l.pulse), 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = l.bg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (l.bg) {
        const padX = 5; const h = size + 6;
        const x0 = l.align === 'left' ? -padX : l.align === 'right' ? -w - padX : -w / 2 - padX;
        ctx.fillStyle = l.bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0, -h / 2, w + padX * 2, h, 4); else ctx.rect(x0, -h / 2, w + padX * 2, h);
        ctx.fill();
      }
      ctx.fillStyle = l.color || '#fff';
      ctx.fillText(l.text, 0, l.circle ? 1 : 0.5);
      ctx.restore();
    }
  }

  drawHoverCard(ctx) {
    const v = this.hoverVehicle;
    if (!v || !this.mouse || (this.drag && this.drag.active)) return;
    const st = statusInfo(v.status);
    const s = this.toScreen(this.mouse.x, this.mouse.y);
    const note = v.paused_note ? (v.paused_note.length > 46 ? `${v.paused_note.slice(0, 45)}…` : v.paused_note) : null;
    const lines = [v.name, `${modelInfo(v.model).label}`, `● ${st.label}${v.open_tasks ? ` · ${v.open_tasks} offen` : ''}`, v.next_event ? `⚑ ${v.next_event.name} · ${v.next_event.date_start.split('-').reverse().join('.')}` : null,
      note ? `⏸ Noch zu tun: ${note}` : null].filter(Boolean);
    ctx.save();
    ctx.font = '600 12px "IBM Plex Sans", system-ui';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22;
    const h = lines.length * 18 + 14;
    let x = s.x + 16; let y = s.y + 16;
    if (x + w > this.cw) x = s.x - w - 16;
    if (y + h > this.ch) y = s.y - h - 16;
    ctx.fillStyle = 'rgba(10,14,20,0.94)';
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#fff' : i === 2 ? st.color : l.startsWith('⏸') ? '#fdba74' : '#94a3b8';
      ctx.font = `${i === 0 ? 700 : 500} ${i === 0 ? 13 : 11.5}px "IBM Plex Sans", system-ui`;
      ctx.fillText(l, x + 11, y + 20 + i * 18);
    });
    ctx.restore();
  }
}
