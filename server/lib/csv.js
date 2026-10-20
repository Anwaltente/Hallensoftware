/**
 * CSV-Parser (RFC 4180 kompatibel) für Google-Sheets- und Excel-Exporte.
 * - erkennt Trennzeichen automatisch (Komma, Semikolon, Tab)
 * - unterstützt Anführungszeichen, "" als Escape und Zeilenumbrüche in Feldern
 * - entfernt BOM
 */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

function parseCSV(input, delimiter) {
  const text = String(input).replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === delim) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!clean.length) return { delimiter: delim, headers: [], rows: [] };
  const headers = clean[0].map((h, idx) => String(h).trim() || `Spalte ${idx + 1}`);
  const data = clean.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? String(r[idx]).trim() : ''; });
    return obj;
  });
  return { delimiter: delim, headers, rows: data };
}

/** Schlägt eine Spaltenzuordnung anhand typischer (deutscher) Überschriften vor. */
const FIELD_HINTS = {
  name: ['name', 'bezeichnung', 'teil', 'artikel', 'werkzeug', 'titel'],
  category: ['kategorie', 'category', 'gruppe', 'typ', 'art'],
  qty: ['anzahl', 'menge', 'stück', 'stk', 'qty', 'bestand'],
  condition: ['zustand', 'condition', 'status'],
  shelf: ['regal', 'shelf'],
  level: ['etage', 'ebene', 'fach', 'level'],
  box: ['box', 'kiste', 'eurobox', 'behälter'],
  vehicle: ['auto', 'fahrzeug', 'passend für', 'passt', 'zuordnung', 'modell'],
  event: ['event', 'packliste', 'trackside', 'event-relevant'],
  location: ['ort', 'lagerort', 'platz', 'location'],
  part_number: ['teilenummer', 'oe', 'artikelnummer', 'nummer'],
  price: ['preis', 'kosten', 'price'],
  notes: ['notiz', 'bemerkung', 'kommentar', 'notes', 'info']
};

function suggestMapping(headers) {
  const mapping = {};
  const lower = headers.map((h) => h.toLowerCase());
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    let idx = lower.findIndex((h) => hints.includes(h));
    if (idx < 0) idx = lower.findIndex((h) => hints.some((hint) => h.includes(hint)));
    if (idx >= 0 && !Object.values(mapping).includes(headers[idx])) mapping[field] = headers[idx];
  }
  return mapping;
}

module.exports = { parseCSV, detectDelimiter, suggestMapping, FIELD_HINTS };
