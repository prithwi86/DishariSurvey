'use strict';
const fs = require('fs');
const config = require('./config');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown: **bold**, _italic_, *italic*. Input is escaped first. */
function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*(.+?)\*(?=[\s.,;:)]|$)/g, '$1<em>$2</em>');
}

/** Converts the subset of Markdown used in LEGAL.md (headings, lists, paragraphs) to HTML. */
function markdownToHtml(md) {
  const out = [];
  let list = null; // 'ol' | 'ul'
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara();
      closeList();
      const level = Math.min(m[1].length + 1, 4); // page title is the h1
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^(\d+)\.\s+(.*)$/)) || (m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      const type = /^\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) {
        closeList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(m[m.length - 1])}</li>`);
    } else if (/^---+$/.test(line) || line.startsWith('>')) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/**
 * Splits LEGAL.md into its two "## " sections and returns
 * { terms: { title, html }, privacy: { title, html } }.
 */
function loadLegal(file = config.legalPath) {
  let md = '';
  try {
    md = fs.readFileSync(file, 'utf8');
  } catch {
    md = '';
  }
  const sections = {};
  for (const part of md.split(/^## /m).slice(1)) {
    const [heading, ...rest] = part.split(/\r?\n/);
    const title = heading.replace(/\s+[—-]\s+.*$/, '').trim();
    const key = /privacy/i.test(heading) ? 'privacy' : /terms/i.test(heading) ? 'terms' : null;
    if (key) sections[key] = { title, html: markdownToHtml(rest.join('\n')) };
  }
  const missing = { title: '', html: '<p>This page is being prepared.</p>' };
  return {
    terms: sections.terms || { ...missing, title: 'Terms of Service' },
    privacy: sections.privacy || { ...missing, title: 'Privacy Policy' },
  };
}

module.exports = { loadLegal, markdownToHtml };
