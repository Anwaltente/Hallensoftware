/**
 * v5.3: Schlanker PDF-Erzeuger ohne Zusatzpakete (DIN A4, Standardschrift Helvetica)
 * ------------------------------------------------------------
 * Kann genau das, was für druckfertige Listen gebraucht wird: Text (normal/fett, mit Zeilenumbruch),
 * Linien, Rechtecke, Farben, mehrere Seiten, Seitenzahlen. Umlaute, ß und € über WinAnsiEncoding.
 * Koordinaten in Punkt (1 pt = 1/72 Zoll), Ursprung OBEN links (wird intern umgerechnet).
 */
const zlib = require('zlib');

/* Zeichenbreiten (1/1000 em) für die Codes 32..255 in WinAnsiEncoding (Adobe-Standardmetriken) */
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];

/* Unicode -> WinAnsi (0x80..0x9F); 0xA0..0xFF ist identisch mit Latin-1 */
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const FALLBACK = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '≈': '~', '≤': '<=', '≥': '>=', '×': 'x', '✓': 'OK', '✔': 'OK', '−': '-', '·': '·', ' ': ' ', ' ': ' ' };

/** Text in WinAnsi-Bytes (Array von Zahlen) */
function encode(str) {
  const out = [];
  for (const ch of String(str === null || str === undefined ? '' : str).normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13 || cp === 9) { out.push(32); continue; }
    if (cp >= 32 && cp < 127) { out.push(cp); continue; }
    if (cp >= 0xA0 && cp <= 0xFF) { out.push(cp); continue; }
    if (CP1252[cp]) { out.push(CP1252[cp]); continue; }
    if (FALLBACK[ch] !== undefined) { for (const c of FALLBACK[ch]) out.push(...encode(c)); continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base !== ch && base.length) { out.push(...encode(base)); continue; }
    if (cp < 32) continue;
    out.push(63); // ?
  }
  return out;
}

function pdfString(bytes) {
  let s = '(';
  for (const b of bytes) {
    if (b === 40 || b === 41 || b === 92) s += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) s += `\\${b.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

const num = (n) => (Math.round(n * 100) / 100).toString();
function rgb(hex) {
  const h = String(hex || '#000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => num(parseInt(f.slice(i, i + 2), 16) / 255)).join(' ');
}

class Pdf {
  constructor({ width = 595.28, height = 841.89, title = 'Dokument', author = 'HALLE//OS', subject = '' } = {}) {
    this.W = width;
    this.H = height;
    this.meta = { title, author, subject };
    this.pages = [];
    this.addPage();
  }

  addPage() { this.page = []; this.pages.push(this.page); return this.pages.length; }

  get pageCount() { return this.pages.length; }

  /** Breite eines Textes in pt */
  width(str, size = 10, bold = false) {
    const w = bold ? W_BOLD : W_REG;
    let sum = 0;
    for (const b of encode(str)) sum += (b >= 32 && b <= 255 ? w[b - 32] : 556) || 0;
    return (sum * size) / 1000;
  }

  /** Zeilenumbruch auf maxWidth (Wörter, sehr lange Wörter werden hart getrennt) */
  wrap(str, maxWidth, size = 10, bold = false) {
    const lines = [];
    for (const para of String(str === null || str === undefined ? '' : str).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (let word of words) {
        while (this.width(word, size, bold) > maxWidth) {
          let cut = word.length - 1;
          while (cut > 1 && this.width(`${word.slice(0, cut)}-`, size, bold) > maxWidth) cut -= 1;
          if (line) { lines.push(line); line = ''; }
          lines.push(`${word.slice(0, cut)}-`);
          word = word.slice(cut);
        }
        const test = line ? `${line} ${word}` : word;
        if (this.width(test, size, bold) <= maxWidth) line = test;
        else { if (line) lines.push(line); line = word; }
      }
      lines.push(line);
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  text(x, y, str, { size = 10, bold = false, color = '#111827', align = 'left', page = null } = {}) {
    const target = page ? this.pages[page - 1] : this.page;
    const w = this.width(str, size, bold);
    const dx = align === 'right' ? -w : align === 'center' ? -w / 2 : 0;
    target.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(x + dx)} ${num(this.H - y)} Td ${pdfString(encode(str))} Tj ET`);
    return w;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.6, page = null } = {}) {
    const target = page ? this.pages[page - 1] : this.page;
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`);
    if (stroke) ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    ops.push(`${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    target.push(`q ${ops.join(' ')} Q`);
  }

  line(x1, y1, x2, y2, { color = '#94a3b8', width = 0.6, dash = null, page = null } = {}) {
    const target = page ? this.pages[page - 1] : this.page;
    target.push(`q ${rgb(color)} RG ${num(width)} w ${dash ? `[${dash.join(' ')}] 0 d ` : ''}${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S Q`);
  }

  /** Fertiges PDF als Buffer */
  toBuffer() {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalogId = add(null);
    const pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const contentId = add({ stream: data, dict: `<< /Length ${data.length} /Filter /FlateDecode >>` });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    const utf16 = (s) => `<FEFF${Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase()}>`;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const infoId = add(`<< /Title ${utf16(this.meta.title)} /Author ${utf16(this.meta.author)} /Subject ${utf16(this.meta.subject || this.meta.title)} /Producer (HALLE//OS) /CreationDate (${date}) >>`);

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = chunks[0].length;
    const xref = [];
    objs.forEach((o, i) => {
      xref.push(offset);
      let buf;
      if (o && typeof o === 'object' && o.stream) {
        buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      } else {
        buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      }
      chunks.push(buf);
      offset += buf.length;
    });
    const xrefStart = offset;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of xref) x += `${String(off).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(Buffer.from(x, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf, encode };
