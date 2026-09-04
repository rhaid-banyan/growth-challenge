'use strict';
// Minimal RFC 4180 CSV reader/writer. No dependencies.
// Handles quoted fields, embedded commas, quotes ("" escapes) and newlines.

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function escapeField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// rows: array of objects; columns: ordered header list
function stringify(rows, columns) {
  const lines = [columns.map(escapeField).join(',')];
  for (const r of rows) lines.push(columns.map((c) => escapeField(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

// Parse text into array of objects using the header row.
function toObjects(text) {
  const rows = parse(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (!rows.length) return { columns: [], rows: [] };
  const [header, ...body] = rows;
  const objs = body.map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] === undefined ? '' : r[idx]; });
    return o;
  });
  return { columns: header, rows: objs };
}

module.exports = { parse, stringify, toObjects, escapeField };
