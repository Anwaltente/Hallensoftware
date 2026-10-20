/**
 * v3: Gespann- und Beladungsrechner
 * ------------------------------------------------------------
 * Prüft je Auto/Anhänger-Kombination:
 *   1. Gewicht:   Autogewicht <= Nutzlast (zGG minus Leergewicht)
 *   2. Gespann:   Leergewicht Anhänger + Auto <= zulässige Anhängelast des Zugfahrzeugs
 *   3. Maße (v4.1, Reifenaufstandsfläche statt Karosserie):
 *        Radstand            <= Nutzlänge der Ladefläche / Auffahrfläche
 *        Radaußenbreite      <= Nutzbreite zwischen den Radkästen
 *        (Radaußenbreite = Spurweite + 1 × Reifenbreite, größerer Wert von Vorder- oder Hinterachse)
 *      Fehlen die Radmaße, wird ersatzweise die Karosserie geprüft: passt sie, passen die Räder sicher;
 *      passt sie nicht, gibt es nur eine gelbe Warnung ("Radmaße eintragen"), keinen roten Fehlalarm.
 * und schlägt automatisch eine Zuweisung vor (ein Auto pro Anhänger), die möglichst
 * viele Autos legal verlädt und die Anhänger möglichst passend auslastet.
 */
const { db } = require('../db');
const { getModels } = require('./vehicleModels');
const { outerWidth } = require('./dims');

const RESERVE_WARN_KG = 100;      // weniger Reserve = gelbe Ampel
const RESERVE_WARN_LEN_MM = 100;  // Radstand: unter 10 cm Luft = knapp
const RESERVE_WARN_WID_MM = 40;   // Spur: unter 4 cm Luft zu den Radkästen = knapp

function carSpecs(v, models = getModels()) {
  const m = models[v.model] || {};
  return {
    id: v.id, name: v.name, model: v.model, color: v.color,
    weight: v.weight_kg || m.weight || null,
    weightEstimated: !v.weight_kg,
    // Karosserie (nur noch Ersatz, wenn Radmaße fehlen)
    length_cm: v.length_cm || Math.round((m.length || 4.4) * 100),
    width_cm: v.width_cm || Math.round((m.width || 1.8) * 100),
    // v4.1: Reifenaufstandsfläche
    wheelbase_mm: v.wheelbase_mm || null,
    track_front_mm: v.track_front_mm || null,
    track_rear_mm: v.track_rear_mm || null,
    tire_width_front_mm: v.tire_width_front_mm || null,
    tire_width_rear_mm: v.tire_width_rear_mm || null,
    outer_width_mm: v.outer_width_calc_mm || outerWidth(v)
  };
}

function trailerSpecs(t) {
  return { ...t, payload_kg: Math.max(0, (t.gvw_kg || 0) - (t.empty_kg || 0)) };
}

const cm = (mm) => Math.round(mm / 10);

/** Bewertet ein Auto auf einem Anhänger. status: ok | warn | red */
function evaluate(car, trailer) {
  const issues = [];
  const payload = trailer.payload_kg;
  let reserve = null;
  // 1. Gewicht <= Nutzlast
  if (!car.weight) {
    issues.push({ level: 'warn', text: 'Gewicht des Autos unbekannt' });
  } else {
    reserve = payload - car.weight;
    if (reserve < 0) issues.push({ level: 'red', text: `Überladen um ${-reserve} kg!` });
    else if (reserve < RESERVE_WARN_KG) issues.push({ level: 'warn', text: `Nur ${reserve} kg Reserve` });
    if (car.weightEstimated) issues.push({ level: 'info', text: `Gewicht geschätzt (${car.weight} kg laut Modell)` });
  }
  const total = (trailer.empty_kg || 0) + (car.weight || 0);
  if (trailer.tow_capacity_kg && car.weight) {
    const over = total - trailer.tow_capacity_kg;
    if (over > 0) issues.push({ level: 'red', text: `Gespann zu schwer: ${over} kg über Anhängelast (${trailer.tow_capacity_kg} kg)!` });
  }
  // 2. Radstand <= Nutzlänge
  if (trailer.deck_length_cm) {
    const deck = trailer.deck_length_cm * 10;
    if (car.wheelbase_mm) {
      const d = deck - car.wheelbase_mm;
      if (d < 0) issues.push({ level: 'red', text: `Radstand zu lang für ${trailer.name} (${cm(-d)} cm)!` });
      else if (d < RESERVE_WARN_LEN_MM) issues.push({ level: 'warn', text: `Radstand knapp (${cm(d)} cm Luft)` });
    } else {
      const d = trailer.deck_length_cm - car.length_cm;
      if (d < 0) issues.push({ level: 'warn', text: `Radstand fehlt: Karosserie ${-d} cm länger als die Ladefläche. Radmaße eintragen!` });
      else issues.push({ level: 'info', text: 'Radstand fehlt: geprüft mit Karosserielänge (passt sicher)' });
    }
  }
  // 3. Radaußenbreite <= Nutzbreite zwischen den Radkästen
  if (trailer.deck_width_cm) {
    const deck = trailer.deck_width_cm * 10;
    if (car.outer_width_mm) {
      const d = deck - car.outer_width_mm;
      if (d < 0) issues.push({ level: 'red', text: `Spur zu breit für ${trailer.name} (${cm(-d)} cm)!` });
      else if (d < RESERVE_WARN_WID_MM) issues.push({ level: 'warn', text: `Spur knapp (${cm(d)} cm Luft zu den Radkästen)` });
    } else {
      const d = trailer.deck_width_cm - car.width_cm;
      if (d < 0) issues.push({ level: 'warn', text: `Spurweite fehlt: Karosserie ${-d} cm breiter als die Ladefläche. Radmaße eintragen!` });
      else issues.push({ level: 'info', text: 'Spurweite fehlt: geprüft mit Karosseriebreite (passt sicher)' });
    }
  }
  const status = issues.some((i) => i.level === 'red') ? 'red' : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  return { status, issues, payload_kg: payload, total_kg: total, reserve_kg: reserve };
}

const SCORE = { ok: 3, warn: 2, red: -100 };

/** Vorschlag per Backtracking (kleine Mengen, daher exakt). */
function suggest(cars, trailers) {
  let best = { score: -Infinity, plan: [] };
  const used = new Set();
  const plan = [];
  let steps = 0;
  function rec(i, score, slack) {
    if (steps++ > 200000) return; // Schutz bei sehr vielen Autos
    if (i === cars.length) {
      const total = score * 100000 - slack;
      if (total > best.score) best = { score: total, plan: [...plan] };
      return;
    }
    const car = cars[i];
    for (const t of trailers) {
      if (used.has(t.id)) continue;
      const ev = evaluate(car, t);
      if (ev.status === 'red') continue;
      used.add(t.id); plan.push({ vehicle_id: car.id, trailer_id: t.id });
      rec(i + 1, score + SCORE[ev.status], slack + Math.max(0, ev.reserve_kg || 0));
      used.delete(t.id); plan.pop();
    }
    plan.push({ vehicle_id: car.id, trailer_id: null });
    rec(i + 1, score, slack);
    plan.pop();
  }
  // schwere Autos zuerst, damit die großen Anhänger für sie frei bleiben
  cars = [...cars].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  rec(0, 0, 0);
  return best.plan;
}

function loadingPlan(eventId, { override = null } = {}) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;
  const models = getModels();
  const vehicles = db.prepare('SELECT v.* FROM vehicles v JOIN event_vehicles ev ON ev.vehicle_id = v.id WHERE ev.event_id = ? ORDER BY v.name').all(eventId);
  const trailers = db.prepare('SELECT t.*, v.name AS tow_vehicle_name FROM trailers t LEFT JOIN vehicles v ON v.id = t.tow_vehicle_id WHERE t.active = 1 ORDER BY t.gvw_kg DESC').all().map(trailerSpecs);
  const eventIds = new Set(vehicles.map((v) => v.id));
  // Autos, die selbst einen Anhänger ziehen, werden nicht verladen
  const towIds = new Set(trailers.filter((t) => t.tow_vehicle_id && eventIds.has(t.tow_vehicle_id)).map((t) => t.tow_vehicle_id));
  const cars = vehicles.map((v) => ({ ...carSpecs(v, models), isTow: towIds.has(v.id) }));
  const loadable = cars.filter((c) => !c.isTow);

  const saved = db.prepare('SELECT vehicle_id, trailer_id FROM event_loading WHERE event_id = ?').all(eventId);
  const suggestion = suggest(loadable, trailers);
  const source = override ? 'preview' : saved.length ? 'saved' : 'suggestion';
  const base = override || (saved.length ? saved : suggestion);

  const byId = new Map(trailers.map((t) => [t.id, t]));
  const rows = loadable.map((car) => {
    const a = base.find((x) => x.vehicle_id === car.id);
    const trailer = a && a.trailer_id ? byId.get(a.trailer_id) : null;
    return { car, trailer_id: trailer ? trailer.id : null, eval: trailer ? evaluate(car, trailer) : null };
  });
  // gleicher Anhänger doppelt (nur bei manueller Planung möglich) = rot
  const counts = {};
  rows.forEach((r) => { if (r.trailer_id) counts[r.trailer_id] = (counts[r.trailer_id] || 0) + 1; });
  rows.forEach((r) => {
    if (r.trailer_id && counts[r.trailer_id] > 1) {
      r.eval.status = 'red';
      r.eval.issues.unshift({ level: 'red', text: 'Anhänger doppelt belegt!' });
    }
  });
  const summary = {
    red: rows.filter((r) => r.eval && r.eval.status === 'red').length,
    warn: rows.filter((r) => r.eval && r.eval.status === 'warn').length,
    ok: rows.filter((r) => r.eval && r.eval.status === 'ok').length,
    selfDriving: rows.filter((r) => !r.trailer_id).length,
    tow: cars.filter((c) => c.isTow).map((c) => c.name)
  };
  return { event: { id: event.id, name: event.name }, trailers, cars, rows, source, suggestion, summary };
}

module.exports = { carSpecs, trailerSpecs, evaluate, suggest, loadingPlan };
