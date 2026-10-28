'use strict';

/** Quotes a CSV cell and neutralises spreadsheet formulas (CSV injection). */
function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// UTF-8 BOM so Excel opens accented / Bengali text correctly.
const BOM = '﻿';

module.exports = { toCsv, BOM };
