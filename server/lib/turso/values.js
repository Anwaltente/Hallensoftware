/**
 * Werte zwischen JavaScript und dem Turso-Protokoll (Hrana) umwandeln.
 * Turso erwartet für jeden Parameter ein Objekt { type, value } (bei blob: { type, base64 }).
 */
/**
 * JS-Wert -> Hrana-Wert. Turso akzeptiert NUR Objekte der Form { type, value } (bzw. base64 bei blob);
 * ein nackter String oder eine Zahl an dieser Stelle führt zu
 * "HTTP 400: JSON parse error: invalid type: string ..., expected internally tagged enum Value".
 */
function encodeValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { type: 'null' };
    return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  if (typeof v === 'string') return { type: 'text', value: v };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { type: 'null' } : { type: 'text', value: v.toISOString() };
  if (typeof v === 'object') { try { return { type: 'text', value: JSON.stringify(v) }; } catch { return { type: 'text', value: String(v) }; } }
  return { type: 'null' };   // function, symbol ...
}

/** Ist das bereits ein gültiger Hrana-Wert? */
function isHranaValue(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.type !== 'string') return false;
  switch (v.type) {
    case 'null': return true;
    case 'integer': return typeof v.value === 'string' && /^-?\d+$/.test(v.value);
    case 'float': return typeof v.value === 'number' && Number.isFinite(v.value);
    case 'text': return typeof v.value === 'string';
    case 'blob': return typeof v.base64 === 'string';
    default: return false;
  }
}

/**
 * Letzte Kontrolle vor dem Senden: jede Anweisung hat sql (String), args als Array von Hrana-Werten
 * bzw. named_args als Array { name, value }. Rohe JS-Werte werden hier umgewandelt, undefined wird null.
 */
function sanitizeStmt(stmt) {
  const out = { sql: String(stmt.sql), want_rows: stmt.want_rows !== false };
  if (Array.isArray(stmt.named_args) && stmt.named_args.length) {
    out.named_args = stmt.named_args.map((a) => ({ name: String(a.name), value: isHranaValue(a.value) ? a.value : encodeValue(a.value) }));
  } else {
    const args = stmt.args === undefined || stmt.args === null ? [] : (Array.isArray(stmt.args) ? stmt.args : [stmt.args]);
    out.args = args.map((v) => (isHranaValue(v) ? v : encodeValue(v)));
  }
  return out;
}

function decodeValue(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') { const n = Number(v.value); return Number.isSafeInteger(n) ? n : BigInt(v.value); }
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'text') return v.value;
  if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
  return v.value === undefined ? null : v.value;
}


module.exports = { encodeValue, decodeValue, isHranaValue, sanitizeStmt };
