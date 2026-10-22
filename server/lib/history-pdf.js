/**
 * v5.3: Wartungshistorie eines Fahrzeugs als druckfertiges PDF (DIN A4 hoch)
 *   Kopf: Fahrzeug, Modell, Kennzeichen / Spitzname, Kilometerstand, TÜV, Exportdatum
 *   Tabelle: Datum, Km, durchgeführte Arbeit, erledigt von, Teile & Flüssigkeiten, Notizen, Kosten
 * Liest nur, schreibt nichts.
 */
const { db } = require('../db');
const { Pdf } = require('./pdf');
const { getModels } = require('./vehicleModels');
const { TZ } = require('./util');

const M = 36;                 // Seitenrand
const C = {
  ink: '#0f172a', text: '#1f2937', muted: '#64748b', line: '#cbd5e1', soft: '#f1f5f9', zebra: '#f8fafc',
  head: '#1e293b', accent: '#f59e0b', accent2: '#0891b2'
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
};
const euro = (n) => `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const km = (n) => (n || n === 0 ? `${Number(n).toLocaleString('de-DE')} km` : '');

function tuevLabel(val) {
  if (!val) return 'k. A.';
  if (/^\d{4}-\d{2}$/.test(val)) return `${val.slice(5, 7)}/${val.slice(0, 4)}`;
  return fmtDate(val);
}

/** Alle Daten für den Export */
function collect(vehicleId) {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!v) return null;
  const log = db.prepare(`SELECT l.*, u.name AS user_name FROM maintenance_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.vehicle_id = ? ORDER BY l.done_at DESC, l.id DESC`).all(vehicleId);
  // Verbrauchte Flüssigkeiten / Material aus dem Schnell-Verbrauch je Eintrag
  const moves = db.prepare(`SELECT m.log_id, m.delta, c.name, c.unit, c.kind FROM consumable_moves m JOIN consumables c ON c.id = m.consumable_id
    WHERE m.vehicle_id = ? AND m.log_id IS NOT NULL AND m.undone = 0`).all(vehicleId);
  const byLog = new Map();
  for (const m of moves) {
    const amount = Math.abs(Number(m.delta) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
    if (!byLog.has(m.log_id)) byLog.set(m.log_id, []);
    byLog.get(m.log_id).push(`${amount} ${m.unit} ${m.name}`);
  }
  // Gekaufte Teile, die an diesem Eintrag hängen (nur wenn sie etwas anderes beschreiben als der Titel)
  const buys = db.prepare("SELECT log_id, name, qty FROM purchases WHERE vehicle_id = ? AND log_id IS NOT NULL AND status = 'bought'").all(vehicleId);
  const buyByLog = new Map();
  for (const b of buys) {
    if (!buyByLog.has(b.log_id)) buyByLog.set(b.log_id, []);
    buyByLog.get(b.log_id).push(b);
  }
  const rows = log.map((l) => {
    const parts = [];
    if (l.parts_used) parts.push(l.parts_used);
    for (const p of byLog.get(l.id) || []) parts.push(p);
    for (const b of buyByLog.get(l.id) || []) {
      if (String(b.name || '').trim().toLowerCase() !== String(l.title || '').trim().toLowerCase()) parts.push(`${b.qty > 1 ? `${b.qty}× ` : ''}${b.name}`);
    }
    const quick = /^Verbrauch:/i.test(l.title || '') && /^Schnell-Verbrauch/i.test(l.description || '');
    return {
      date: fmtDate(l.done_at),
      km: km(l.mileage),
      work: quick ? `Betriebsstoff nachgefüllt: ${String(l.title).replace(/^Verbrauch:\s*/i, '')}` : l.title || '',
      by: l.user_name || '',
      parts: parts.join(', ') || (quick ? String(l.title).replace(/^Verbrauch:\s*/i, '') : ''),
      notes: quick ? String(l.description || '').replace(/^Schnell-Verbrauch\s*·?\s*/i, '') : l.description || '',
      cost: l.cost ? euro(l.cost) : '',
      costNum: Number(l.cost) || 0,
      fromTask: !!l.task_id
    };
  });
  const model = (getModels()[v.model] || {}).label || v.model;
  return { v, model, rows };
}

function build(vehicleId, { exportedBy = null } = {}) {
  const data = collect(vehicleId);
  if (!data) return null;
  const { v, model, rows } = data;
  const now = new Date();
  const exportDate = now.toLocaleDateString('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const exportTime = now.toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const pdf = new Pdf({ title: `Wartungshistorie ${v.name}`, author: exportedBy || 'HALLE//OS', subject: `Wartungshistorie ${v.name}${v.plate ? ` (${v.plate})` : ''}` });
  const W = pdf.W;
  const inner = W - 2 * M;

  /* ---------- Kopf (nur Seite 1) ---------- */
  pdf.rect(0, 0, W, 6, { fill: C.accent });
  // Warnstreifen-Akzent (Werkstatt-Look, druckt dezent)
  for (let x = W - M - 90; x < W - M; x += 9) pdf.rect(x, 6, 4.5, 3, { fill: C.head });
  let y = M + 14;
  pdf.text(M, y, 'HALLE//OS · WERKSTATT', { size: 8, bold: true, color: C.accent2 });
  pdf.text(W - M, y, `Exportiert am ${exportDate}, ${exportTime} Uhr`, { size: 8, color: C.muted, align: 'right' });
  y += 24;
  pdf.text(M, y, 'Wartungshistorie', { size: 22, bold: true, color: C.ink });
  y += 18;
  pdf.text(M, y, `${v.name}${v.plate ? `  ·  ${v.plate}` : ''}`, { size: 12, bold: true, color: C.text });
  y += 14;

  // Fahrzeug-Steckbrief
  const totalCost = rows.reduce((s, r) => s + r.costNum, 0);
  const facts = [
    ['Fahrzeug / Spitzname', v.name],
    ['Modell', model],
    ['Kennzeichen', v.plate || 'k. A.'],
    ['FIN', v.vin || 'k. A.'],
    ['Kilometerstand', v.mileage ? km(v.mileage) : 'k. A.'],
    ['TÜV / HU bis', tuevLabel(v.tuev_until)],
    ['Einträge', String(rows.length)],
    ['Summe Kosten', totalCost ? euro(totalCost) : 'k. A.']
  ];
  const colsN = 4;
  const cellW = inner / colsN;
  const boxH = 2 * 30 + 12;
  pdf.rect(M, y, inner, boxH, { fill: C.soft, stroke: C.line, lineWidth: 0.6 });
  pdf.rect(M, y, 3, boxH, { fill: C.accent });
  facts.forEach(([label, value], i) => {
    const cx = M + 12 + (i % colsN) * cellW;
    const cy = y + 16 + Math.floor(i / colsN) * 30;
    pdf.text(cx, cy, label.toUpperCase(), { size: 6.5, bold: true, color: C.muted });
    const val = pdf.wrap(value, cellW - 16, 9.5, true)[0] || '';
    pdf.text(cx, cy + 12, val, { size: 9.5, bold: true, color: C.ink });
  });
  y += boxH + 18;

  /* ---------- Tabelle ---------- */
  const cols = [
    { key: 'date', label: 'Datum', w: 52 },
    { key: 'km', label: 'Km-Stand', w: 50 },
    { key: 'work', label: 'Durchgeführte Arbeit', w: 122, bold: true },
    { key: 'by', label: 'Erledigt von', w: 58 },
    { key: 'parts', label: 'Teile & Flüssigkeiten', w: 100 },
    { key: 'notes', label: 'Notizen', w: 0 },
    { key: 'cost', label: 'Kosten', w: 50, align: 'right' }
  ];
  cols[5].w = inner - cols.reduce((s, c) => s + c.w, 0);
  const FS = 7.6;
  const LH = 9.6;
  const PADX = 4;
  const PADY = 5;
  const bottom = pdf.H - M - 26;

  const header = () => {
    pdf.rect(M, y, inner, 17, { fill: C.head });
    let x = M;
    for (const c of cols) {
      pdf.text(c.align === 'right' ? x + c.w - PADX : x + PADX, y + 11.5, c.label.toUpperCase(), { size: 6.4, bold: true, color: '#ffffff', align: c.align || 'left' });
      x += c.w;
    }
    y += 17;
  };

  const newPage = () => {
    pdf.addPage();
    pdf.rect(0, 0, W, 4, { fill: C.accent });
    y = M + 6;
    pdf.text(M, y, `Wartungshistorie ${v.name}${v.plate ? ` · ${v.plate}` : ''}`, { size: 8.5, bold: true, color: C.text });
    pdf.text(W - M, y, 'Fortsetzung', { size: 7.5, color: C.muted, align: 'right' });
    y += 10;
    header();
  };

  if (!rows.length) {
    pdf.text(M, y + 10, 'Für dieses Fahrzeug gibt es noch keine Einträge im Wartungsheft.', { size: 10, color: C.muted });
    y += 30;
  } else {
    pdf.text(M, y, 'EINTRÄGE (NEUESTE ZUERST)', { size: 7.5, bold: true, color: C.muted });
    y += 7;
    header();
    rows.forEach((r, i) => {
      const lines = cols.map((c) => (r[c.key] ? pdf.wrap(r[c.key], c.w - 2 * PADX, FS, !!c.bold) : ['']));
      const h = Math.max(...lines.map((l, ci) => l.length + (ci === 2 && r.fromTask ? 0.8 : 0))) * LH + 2 * PADY - 2;
      if (y + h > bottom) newPage();
      if (i % 2 === 1) pdf.rect(M, y, inner, h, { fill: C.zebra });
      let x = M;
      cols.forEach((c, ci) => {
        lines[ci].forEach((ln, li) => {
          pdf.text(c.align === 'right' ? x + c.w - PADX : x + PADX, y + PADY + 6.2 + li * LH, ln,
            { size: FS, bold: !!c.bold, color: c.key === 'by' || c.key === 'km' || c.key === 'date' ? C.text : c.key === 'notes' ? '#334155' : C.ink, align: c.align || 'left' });
        });
        if (c.key === 'work' && r.fromTask) {
          pdf.text(x + PADX, y + PADY + 6.2 + lines[ci].length * LH, 'aus Aufgabe', { size: 6, color: C.accent2 });
        }
        x += c.w;
      });
      y += h;
      pdf.line(M, y, M + inner, y, { color: '#e2e8f0', width: 0.4 });
    });
    // Summe
    if (y + 22 > bottom) newPage();
    pdf.line(M, y, M + inner, y, { color: C.head, width: 0.9 });
    y += 13;
    pdf.text(M + inner - cols[6].w - PADX - 6, y, 'Summe', { size: 8, bold: true, color: C.text, align: 'right' });
    pdf.text(M + inner - PADX, y, totalCost ? euro(totalCost) : '0,00 €', { size: 8.5, bold: true, color: C.ink, align: 'right' });
    y += 8;
  }

  /* ---------- Bestätigung / Unterschrift ---------- */
  if (y + 70 > bottom) newPage();
  y += 34;
  const half = (inner - 24) / 2;
  pdf.line(M, y, M + half, y, { color: C.muted, width: 0.6 });
  pdf.line(M + half + 24, y, M + inner, y, { color: C.muted, width: 0.6 });
  pdf.text(M, y + 10, 'Ort, Datum', { size: 7, color: C.muted });
  pdf.text(M + half + 24, y + 10, 'Unterschrift / Stempel', { size: 7, color: C.muted });

  /* ---------- Fußzeile auf jeder Seite ---------- */
  const total = pdf.pageCount;
  for (let p = 1; p <= total; p += 1) {
    const fy = pdf.H - M + 8;
    pdf.line(M, fy - 10, M + inner, fy - 10, { color: C.line, width: 0.5, page: p });
    pdf.text(M, fy, `HALLE//OS · Wartungshistorie ${v.name} · erstellt am ${exportDate}${exportedBy ? ` von ${exportedBy}` : ''}`, { size: 6.8, color: C.muted, page: p });
    pdf.text(M + inner, fy, `Seite ${p} von ${total}`, { size: 6.8, bold: true, color: C.text, align: 'right', page: p });
  }

  const safe = String(v.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Fahrzeug';
  return { buffer: pdf.toBuffer(), filename: `Wartungshistorie-${safe}-${now.toISOString().slice(0, 10)}.pdf`, rows: rows.length };
}

module.exports = { historyPdf: build, collectHistory: collect };
