'use strict';

/** "just now", "5m", "2h", "3d", then a date. */
function relativeTime(iso, from = Date.now()) {
  const diff = Math.max(0, from - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return formatDate(iso);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const initial = (name) => (name || '?').charAt(0).toUpperCase();

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Safe JSON for embedding inside a <script type="application/json"> block. */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

module.exports = { relativeTime, formatDate, formatDateTime, initial, plural, jsonForScript };
