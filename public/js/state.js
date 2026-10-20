/**
 * Zentraler Client-State mit einfachem Pub/Sub.
 * Module lesen aus `store` und hören mit `subscribe(topic, fn)` auf Änderungen.
 * Topics: 'vehicles', 'layout', 'work', 'events', 'me', 'blueprint', 'whiteboard', 'mode'
 */
import { get } from './api.js';

export const store = {
  me: null,
  meta: null,
  hall: { name: 'Halle', width: 8, depth: 19 },
  objects: [],
  vehicles: [],
  users: [],
  work: [],
  events: [],
  blueprint: [],
  whiteboard: null,
  supplies: [],          // v2: Kühlschrank-Radar
  ticker: null,          // v2: LED-Laufband
  settings: {},          // v2: z. B. publicUrl für QR-Codes
  hud: null,             // v4: kritische Ressourcen, Verbrauch, Dinge in der Schwebe
  mode: 'hall',          // 'hall' | 'blueprint'
  bpHidden: (() => { try { return new Set(JSON.parse(localStorage.getItem('halle.bp.hidden') || '[]')); } catch { return new Set(); } })(),   // v5.2: ausgeblendete Blueprint-Layer
  builder: false,        // Admin-Baukasten aktiv?
  adminUnlocked: false   // PIN-Bestätigung für Admin-Werkzeuge
};

/**
 * App-weite Funktionsregistry (verhindert zirkuläre Imports zwischen Modulen).
 * Wird in app.js befüllt: app.map, app.openCockpit, app.openShelf, app.navigate, app.showTab ...
 */
export const app = {};

const listeners = new Map();

export function subscribe(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic).delete(fn);
}

export function emit(topic, payload) {
  (listeners.get(topic) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
}

export function setState(patch, topics = []) {
  Object.assign(store, patch);
  topics.forEach((t) => emit(t));
}

/* ---------- Rollen ---------- */
const LEVEL = { gast: 0, schrauber: 1, admin: 2 };
export const can = (role) => !!store.me && LEVEL[store.me.role] >= LEVEL[role];
export const canEdit = () => can('schrauber');
export const isAdmin = () => can('admin');

/* ---------- v5.2: Blueprint-Layer ---------- */
export function bpLayerOf(item) {
  const k = store.meta && store.meta.blueprintKinds && store.meta.blueprintKinds[item.type] && store.meta.blueprintKinds[item.type][item.kind];
  return (k && k.layer) || item.kind;
}
export const bpVisible = (item) => !store.bpHidden.has(bpLayerOf(item));
export function setBpLayer(layer, visible) {
  if (visible) store.bpHidden.delete(layer); else store.bpHidden.add(layer);
  try { localStorage.setItem('halle.bp.hidden', JSON.stringify([...store.bpHidden])); } catch { /* egal */ }
  emit('bplayers');
}

/* ---------- Lookups ---------- */
export const vehicleById = (id) => store.vehicles.find((v) => v.id === Number(id));
export const objectById = (id) => store.objects.find((o) => o.id === Number(id));
export const userById = (id) => store.users.find((u) => u.id === Number(id));
export const modelInfo = (model) => (store.meta && store.meta.models[model]) || { label: model, length: 4.4, width: 1.8, shape: 'dummy' };
export const statusInfo = (s) => (store.meta && store.meta.status[s]) || { label: s, color: '#94a3b8' };

export function vehicleLocationLabel(v) {
  if (!v.slot_id) return `Außerhalb · ${v.extern_location || 'Paddock'}`;
  const slot = objectById(v.slot_id);
  const cap = slot && slot.props ? Number(slot.props.capacity) || 1 : 1;
  const posLabel = cap > 1 ? (v.slot_pos === 0 ? ' · oben (Bühne)' : ' · unten') : '';
  return `Halle · ${slot ? `${slot.code} ${slot.label || ''}`.trim() : '?'}${posLabel}`;
}

/* ---------- v5: Status-Bezeichnungen je Ansicht (Werkstatt / Büro) ---------- */
const BIZ_STATUS_LABELS = { ready: 'Betriebsbereit', work: 'In Wartung', parts: 'Wartet auf Freigabe' };
export function applyViewLabels() {
  const st = store.meta && store.meta.status;
  if (!st) return;
  const biz = document.documentElement.classList.contains('biz');
  for (const [k, s] of Object.entries(st)) {
    if (s.label_game === undefined) s.label_game = s.label;
    s.label = biz && BIZ_STATUS_LABELS[k] ? BIZ_STATUS_LABELS[k] : s.label_game;
  }
}

/* ---------- Laden ---------- */
export async function loadMeta() {
  if (!store.meta) store.meta = await get('/meta');
  applyViewLabels();
  return store.meta;
}

/** v3: Modellliste neu laden (nach Änderungen in der Admin-Konsole) */
export async function refreshMeta() {
  store.meta = await get('/meta');
  applyViewLabels();
  emit('meta');
  return store.meta;
}

export async function refreshAll() {
  const data = await get('/bootstrap');
  setState({
    me: data.me, hall: data.hall, objects: data.objects, vehicles: data.vehicles,
    users: data.users, work: data.work, events: data.events,
    supplies: data.supplies || [], settings: data.settings || {}
  }, ['me', 'layout', 'vehicles', 'work', 'events', 'supplies']);
  return data;
}

export async function refreshVehicles() {
  setState({ vehicles: await get('/vehicles') }, ['vehicles']);
}

export async function refreshWhiteboard() {
  const wb = await get('/whiteboard');
  setState({ whiteboard: wb, work: wb.work }, ['whiteboard', 'work']);
}

export async function refreshEvents() {
  setState({ events: await get('/events?upcoming=1') }, ['events']);
}

export async function refreshBlueprint() {
  setState({ blueprint: await get('/blueprint') }, ['blueprint']);
}
