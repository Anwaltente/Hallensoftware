/**
 * v4.1: KI-Auto-Fill für Serienmaße via Google Gemini
 *
 *   POST /api/cars/fetch-dimensions   { car_name: "BMW E46 320Ci" }
 *   -> { wheelbase_mm, track_front_mm, track_rear_mm, standard_tire_width, tire_width_rear_mm?, curb_weight_kg?, matched, note }
 *
 * Schlüssel: Umgebungsvariable GEMINI_API_KEY (oder Datei .env im Projektordner, siehe .env.example).
 * Modell:    GEMINI_MODEL (Standard: gemini-3.8-flash). Meldet Google, dass ein Modell nicht mehr verfügbar ist,
 *            wechselt die App automatisch auf das in der Fehlermeldung genannte Nachfolgemodell.
 * Der Schlüssel bleibt auf dem Server und wird nie an den Browser geschickt.
 */
const express = require('express');
const { httpError, strOrNull } = require('../lib/util');

const router = express.Router();
let autoModel = null;   // Nachfolgemodell, falls Google ein Modell abgekündigt hat (gilt bis zum Neustart)
const MODEL = () => autoModel || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const cache = new Map();            // gleiche Anfrage 24 h aus dem Speicher (spart Kontingent)
const CACHE_MS = 24 * 3600 * 1000;

const SYSTEM = `Du bist eine technische Fahrzeugdatenbank für Autotransporter-Beladung.
Gib für das genannte Fahrzeug die SERIENMASSE der Basisversion zurück, ausschließlich als JSON:
{ "wheelbase_mm": 2725, "track_front_mm": 1471, "track_rear_mm": 1483, "standard_tire_width": 205,
  "tire_width_rear_mm": 205, "curb_weight_kg": 1395, "matched": "BMW 3er Coupé E46 320Ci (2000-2006)", "note": "" }
Regeln:
- Alle Längen in Millimetern, ganze Zahlen. Spurweite = Reifenmitte zu Reifenmitte.
- standard_tire_width = Serien-Reifenbreite vorn in mm (z. B. 205 aus 205/55 R16).
- tire_width_rear_mm nur abweichend setzen, wenn die Serie hinten breitere Reifen hat (Mischbereifung), sonst gleich standard_tire_width.
- curb_weight_kg = Leergewicht nach EU (mit Fahrer 75 kg) oder DIN, wenn bekannt, sonst 0.
- matched = welches Modell/Baujahr du angenommen hast. note = kurzer Hinweis bei Unsicherheit, sonst leer.
- Wenn du das Fahrzeug nicht sicher kennst: realistische Werte des wahrscheinlichsten Modells und das in note sagen.
- Keine Erklärungen, kein Markdown, nur das JSON-Objekt.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    wheelbase_mm: { type: 'INTEGER' },
    track_front_mm: { type: 'INTEGER' },
    track_rear_mm: { type: 'INTEGER' },
    standard_tire_width: { type: 'INTEGER' },
    tire_width_rear_mm: { type: 'INTEGER' },
    curb_weight_kg: { type: 'INTEGER' },
    matched: { type: 'STRING' },
    note: { type: 'STRING' }
  },
  required: ['wheelbase_mm', 'track_front_mm', 'track_rear_mm', 'standard_tire_width']
};

const inRange = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };

function parseAnswer(j) {
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!text) throw httpError(502, 'Gemini hat keine Antwort geliefert.');
  let d;
  try { d = JSON.parse(text); } catch { throw httpError(502, 'Gemini-Antwort war kein gültiges JSON.'); }
  const out = {
    wheelbase_mm: inRange(d.wheelbase_mm, 1500, 4500),
    track_front_mm: inRange(d.track_front_mm, 1000, 2200),
    track_rear_mm: inRange(d.track_rear_mm, 1000, 2200),
    standard_tire_width: inRange(d.standard_tire_width, 100, 400),
    tire_width_rear_mm: inRange(d.tire_width_rear_mm, 100, 400),
    curb_weight_kg: inRange(d.curb_weight_kg, 400, 4000),
    matched: strOrNull(d.matched),
    note: strOrNull(d.note)
  };
  if (!out.wheelbase_mm || !out.track_front_mm || !out.track_rear_mm || !out.standard_tire_width) {
    throw httpError(502, 'Gemini hat unvollständige oder unplausible Maße geliefert. Bitte Bezeichnung genauer angeben.');
  }
  if (!out.tire_width_rear_mm) out.tire_width_rear_mm = out.standard_tire_width;
  return out;
}

/** generationConfig passend zur Modellgeneration (Gemini 3+: thinkingLevel, Temperatur auf Standard lassen) */
function genConfig(model, { schema = true } = {}) {
  const g3 = /gemini-([3-9]|\d{2,})/.test(model);
  const cfg = { responseMimeType: 'application/json' };
  if (schema) cfg.responseSchema = SCHEMA;
  if (g3) cfg.thinkingConfig = { thinkingLevel: 'low' };
  else { cfg.temperature = 0.1; cfg.thinkingConfig = { thinkingBudget: 0 }; }
  return cfg;
}

async function callGemini(model, carName, key, opts) {
  const base = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';   // nur für Tests überschreibbar
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Fahrzeug: ${carName}` }] }],
    generationConfig: genConfig(model, opts)
  });
  const call = async (headers) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: ctrl.signal });
    } finally { clearTimeout(t); }
  };
  let r = await call({ 'x-goog-api-key': key });
  // Manche Google-Schlüssel sind OAuth-Token statt klassischer API-Keys: dann als Bearer versuchen
  if ((r.status === 401 || r.status === 403) && !key.startsWith('AIza')) r = await call({ authorization: `Bearer ${key}` });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j, msg: (j.error && j.error.message) || `HTTP ${r.status}` };
}

async function askGemini(carName, key) {
  let model = MODEL();
  let schema = true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await callGemini(model, carName, key, { schema });
    if (r.ok) return { ...parseAnswer(r.j), model };
    const msg = r.msg;
    if (r.status === 400 && /API key/i.test(msg)) throw httpError(502, 'Gemini lehnt den API-Schlüssel ab. Bitte GEMINI_API_KEY prüfen.');
    if (r.status === 401 || r.status === 403) throw httpError(502, `Gemini: Zugriff verweigert (${msg}). Bitte GEMINI_API_KEY prüfen.`);
    if (r.status === 429) throw httpError(429, 'Gemini-Kontingent erschöpft. Bitte später nochmal versuchen.');
    // Modell abgekündigt? Google nennt das Nachfolgemodell in der Meldung, z. B. "use models/gemini-3.8-flash"
    const next = /no longer available|not found|deprecated|is not supported/i.test(msg) && msg.match(/models\/(gemini-[a-z0-9.\-]+)/gi);
    const successor = next && next.map((x) => x.replace(/^models\//i, '')).find((x) => x !== model);
    if (successor) {
      console.log(`[gemini] Modell ${model} nicht verfügbar, wechsle auf ${successor}`);
      autoModel = successor;
      model = successor;
      continue;
    }
    // Konfiguration vom Modell nicht unterstützt: einmal ohne JSON-Schema versuchen (JSON wird trotzdem verlangt)
    if (r.status === 400 && schema) { schema = false; continue; }
    throw httpError(502, `Gemini-Fehler: ${msg}`);
  }
  throw httpError(502, 'Gemini antwortet nicht wie erwartet. Bitte später nochmal versuchen.');
}

router.post('/cars/fetch-dimensions', async (req, res, next) => {
  try {
    const carName = strOrNull(req.body && req.body.car_name);
    if (!carName || carName.length < 3) throw httpError(400, 'Bitte Fahrzeug angeben, z. B. „BMW E46 320Ci“.');
    if (carName.length > 120) throw httpError(400, 'Fahrzeugbezeichnung ist zu lang.');
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) throw httpError(503, 'Kein Gemini-Schlüssel hinterlegt. GEMINI_API_KEY in der Datei .env im Projektordner eintragen und den Server neu starten.');
    const ck = carName.toLowerCase();
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.data, cached: true });
    let data;
    try {
      data = await askGemini(carName, key);
    } catch (err) {
      if (err.name === 'AbortError') throw httpError(504, 'Gemini antwortet nicht (Zeitüberschreitung).');
      if (!err.status) throw httpError(502, `Gemini nicht erreichbar: ${err.message}`);
      throw err;
    }
    data = { ...data, query: carName };
    cache.set(ck, { at: Date.now(), data });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
