/**
 * v4.1: Radmaße eines Fahrzeugs (für den Anhänger-Check zählt die Reifenaufstandsfläche, nicht die Karosserie).
 *   Radaußenbreite = Spurweite + 1 × Reifenbreite (Spur wird Reifenmitte zu Reifenmitte gemessen),
 *   jeweils der größere Wert von Vorder- oder Hinterachse.
 */
function axleOuter(track, tire) {
  const t = Number(track); const w = Number(tire);
  return t > 0 && w > 0 ? Math.round(t + w) : null;
}

/** MAX(track_front + tire_front, track_rear + tire_rear); fehlt eine Achse, zählt die andere */
function outerWidth(v) {
  if (!v) return null;
  const f = axleOuter(v.track_front_mm, v.tire_width_front_mm);
  const r = axleOuter(v.track_rear_mm, v.tire_width_rear_mm || v.tire_width_front_mm);
  const vals = [f, r].filter((x) => x);
  return vals.length ? Math.max(...vals) : null;
}

module.exports = { outerWidth, axleOuter };
