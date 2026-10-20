/**
 * Fahrzeug-Modelle (Sprite-Typen): Standardwerte.
 * Ab v3 werden diese beim Start einmalig in die Tabelle vehicle_models übernommen
 * (INSERT OR IGNORE) und sind danach in der Admin-Konsole verwaltbar.
 */
const MODELS = {
  e36_coupe:   { label: 'BMW E36 Coupé',     chassis: 'E36', shape: 'coupe',   length: 4.43, width: 1.71, weight: 1300 },
  e36_limo:    { label: 'BMW E36 Limousine', chassis: 'E36', shape: 'sedan',   length: 4.43, width: 1.70, weight: 1300 },
  e46_coupe:   { label: 'BMW E46 Coupé',     chassis: 'E46', shape: 'coupe',   length: 4.49, width: 1.76, weight: 1400 },
  e46_touring: { label: 'BMW E46 Touring',   chassis: 'E46', shape: 'touring', length: 4.48, width: 1.74, weight: 1500 },
  e46_cabrio:  { label: 'BMW E46 Cabrio',    chassis: 'E46', shape: 'cabrio',  length: 4.49, width: 1.76, weight: 1550 },
  g42_coupe:   { label: 'BMW G42 Coupé',     chassis: 'G42', shape: 'coupe',   length: 4.54, width: 1.84, weight: 1690 },
  g21_touring: { label: 'BMW G21 Touring',   chassis: 'G21', shape: 'touring', length: 4.71, width: 1.83, weight: 1660 },
  dummy:       { label: 'Dummy / Sonstiges', chassis: '',    shape: 'dummy',   length: 4.40, width: 1.80, weight: 1300 }
};

/**
 * v3: Silhouetten, aus denen eigene Modelle (z. B. "Trabant 601", "S13", "E30") zusammengestellt werden.
 * Die Modelle selbst liegen ab v3 in der Tabelle vehicle_models (Admin-Konsole > Fahrzeug-Modelle).
 */
const SHAPES = {
  coupe: 'Coupé',
  sedan: 'Limousine',
  touring: 'Kombi / Touring',
  cabrio: 'Cabrio / Roadster',
  hatch: 'Kompakt / Kleinwagen',
  van: 'Bus / Transporter',
  pickup: 'Pick-up',
  dummy: 'Neutral (Box)'
};

const STATUS = {
  ready: { label: 'Fahrbereit',          color: '#22c55e' },
  work:  { label: 'In Arbeit',           color: '#facc15' },
  parts: { label: 'Wartet auf Teile',    color: '#ef4444' }
};

const SLOT_KINDS = {
  standard: 'Standardplatz',
  buffer: 'Pufferplatz (Schneise)',
  lift: 'Hebebühne',
  chill: 'Unter Chill-Ecke'
};

/**
 * Blueprint: Leitungen und Punkte. Jede Art gehört zu genau einem Layer (v5.2: einzeln ein-/ausblendbar).
 * Farben je Layer: Druckluft Neon-Blau, 230 V Gelb/Orange, 400 V Rot/Violett, Verteilung Neon-Grün, Daten Lila.
 */
const BLUEPRINT_LAYERS = {
  air:  { label: 'Druckluftnetz', short: 'Druckluft', color: '#22d3ee', hint: 'Kompressor, Leitungen, Wasserabscheider, Schlauchtrommeln' },
  v230: { label: '230V Stromnetz', short: '230 V', color: '#facc15', hint: 'Steckdosen, Lichtschalter, Lampen' },
  v400: { label: '400V Starkstrom', short: '400 V', color: '#ff2e63', hint: 'CEE-Dosen für Hebebühnen, Schweißgerät, Kompressor' },
  fuse: { label: 'Sicherungskasten / Unterverteiler', short: 'Verteilung', color: '#39ff88', hint: 'Hauptverteilung, Unterverteiler, Sicherungen' },
  data: { label: 'Netzwerk / Daten', short: 'Daten', color: '#a78bfa', hint: 'LAN, WLAN, Kameras' }
};

const BLUEPRINT_KINDS = {
  line: {
    v230: { label: '230 V Leitung', color: '#facc15', layer: 'v230' },
    v400: { label: '400 V Starkstrom', color: '#ff2e63', layer: 'v400' },
    air:  { label: 'Druckluft', color: '#22d3ee', layer: 'air' },
    data: { label: 'Netzwerk / Daten', color: '#a78bfa', layer: 'data' }
  },
  node: {
    verteiler:      { label: 'Unterverteiler', color: '#39ff88', layer: 'fuse' },
    sicherungskasten: { label: 'Sicherungskasten (Hauptverteilung)', color: '#39ff88', layer: 'fuse' },
    steckdose230:   { label: 'Steckdose 230 V', color: '#facc15', layer: 'v230' },
    licht:          { label: 'Licht / Schalter', color: '#fde68a', layer: 'v230' },
    schalter:       { label: 'Lichtschalter', color: '#fb923c', layer: 'v230' },
    lampe:          { label: 'Lampe', color: '#fde047', layer: 'v230' },
    steckdose400:   { label: 'CEE 400 V', color: '#c084fc', layer: 'v400' },
    kompressor:     { label: 'Kompressor', color: '#22d3ee', layer: 'air' },
    abscheider:     { label: 'Abscheider / Wartungseinheit', color: '#38bdf8', layer: 'air' },
    kupplung:       { label: 'Druckluft-Kupplung', color: '#67e8f9', layer: 'air' },
    schlauchtrommel: { label: 'Schlauchtrommel', color: '#7dd3fc', layer: 'air' }
  }
};

module.exports = { MODELS, SHAPES, STATUS, SLOT_KINDS, BLUEPRINT_KINDS, BLUEPRINT_LAYERS };
