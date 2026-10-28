'use strict';
const fs = require('fs');
const PDFDocument = require('pdfkit');
const config = require('./config');
const { formatDate, formatDateTime, initial } = require('./format');

// Design tokens (same as the app).
const C = {
  text: '#333333',
  muted: '#6c6260',
  divider: '#f0dcdc',
  track: '#f3e9e7',
  no: '#aa9c99',
  accent700: '#a52a3d',
  grad1: '#d44a5f',
  grad2: '#c3354a',
  shadow: '#c93a50',
  white: '#ffffff',
};

const PAGE = { margin: 44, footer: 28 };

// Characters the built-in Helvetica (WinAnsi) can draw.
const WIN_ANSI = /[^\t\n\r\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g;

function buildReport({ survey, questions, stats, comments, excludeFlagged }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.margin, bottom: PAGE.margin + PAGE.footer, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: { Title: `${survey.name} — report`, Author: 'Dishari' },
  });

  // ---------- Fonts ----------
  const custom = config.pdfFontRegular && fs.existsSync(config.pdfFontRegular);
  if (custom) {
    doc.registerFont('body', config.pdfFontRegular);
    doc.registerFont('bold', config.pdfFontBold && fs.existsSync(config.pdfFontBold) ? config.pdfFontBold : config.pdfFontRegular);
  } else {
    doc.registerFont('body', 'Helvetica');
    doc.registerFont('bold', 'Helvetica-Bold');
  }
  let replacedChars = false;
  const t = (s) => {
    s = String(s == null ? '' : s);
    if (custom) return s;
    return s.replace(WIN_ANSI, () => {
      replacedChars = true;
      return '?';
    });
  };

  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const atTop = () => doc.y <= doc.page.margins.top + 1;

  function ensure(h) {
    if (doc.y + h > bottom() && !atTop()) doc.addPage();
  }

  function gradient(x, y, w, h) {
    const g = doc.linearGradient(x, y, x + w, y + h * 0.36);
    g.stop(0, C.grad1).stop(1, C.grad2);
    return g;
  }

  function card(x, y, w, h, radius = 12) {
    doc.save().roundedRect(x, y + 2, w, h, radius).fillOpacity(0.06).fill(C.shadow).restore();
    doc.save().roundedRect(x, y, w, h, radius).lineWidth(1).fillAndStroke(C.white, C.divider).restore();
  }

  function kicker(text, x, y, color = C.accent700) {
    doc.font('bold').fontSize(8).fillColor(color).text(t(text).toUpperCase(), x, y, { characterSpacing: 0.6, lineBreak: false });
  }

  function bar(x, y, w, label, count, pct, kind, labelW = 28, h = 12) {
    const valueW = 62;
    const trackX = x + labelW;
    const trackW = w - labelW - valueW - 8;
    const ty = y + (h - 9) / 2;
    doc.font('body').fontSize(9).fillColor(C.text).text(t(label), x, ty, { width: labelW, lineBreak: false, ellipsis: true });
    doc.save().roundedRect(trackX, y, trackW, h, h / 2).fill(C.track).restore();
    const fillW = Math.max(pct > 0 ? h : 0, (trackW * pct) / 100);
    if (fillW > 0) {
      doc.save().roundedRect(trackX, y, fillW, h, h / 2).fill(kind === 'yes' ? gradient(trackX, y, fillW, h) : C.no).restore();
    }
    doc.font('body').fontSize(9).fillColor(C.text).text(`${count} · ${pct}%`, trackX + trackW + 8, ty, { width: valueW, align: 'right', lineBreak: false });
  }

  function sectionHeading(kick, title) {
    kicker(kick, left, doc.y);
    doc.font('bold').fontSize(20).fillColor(C.text).text(t(title), left, doc.y + 14, { width });
    doc.y += 14;
  }

  const yesno = questions.filter((q) => q.type === 'yesno');
  const choice = questions.filter((q) => q.type === 'choice');
  const closed = questions.filter((q) => q.type !== 'text'); // summarised as charts
  const withText = questions.filter((q) => q.type !== 'choice'); // can have comments / written answers

  let fontNoteY = 0; // where the cover's font note goes, if characters had to be replaced

  // ---------- 1. Cover / summary ----------
  {
    const y = doc.y;
    doc.font('bold').fontSize(26);
    const titleH = doc.heightOfString(t(survey.name), { width: width - 40 });
    const h = 24 + 12 + 10 + titleH + 12 + 14 + 24;
    doc.save().roundedRect(left, y + 4, width, h, 18).fillOpacity(0.14).fill(C.shadow).restore();
    doc.save().roundedRect(left, y, width, h, 18).fill(gradient(left, y, width, h)).restore();
    kicker('Survey report', left + 20, y + 24, C.white);
    doc.font('bold').fontSize(26).fillColor(C.white).text(t(survey.name), left + 20, y + 46, { width: width - 40 });
    doc.font('body').fontSize(10).fillColor(C.white).text(`Generated ${formatDate(new Date().toISOString())}`, left + 20, y + 46 + titleH + 12);
    doc.y = y + h + 18;

    const sy = doc.y;
    const sw = (width - 12) / 2;
    const sh = 70;
    [[`${stats.used}`, `/${stats.issued}`, 'Responded'], [`${stats.rate}%`, '', 'Response rate']].forEach(([big, small, label], i) => {
      const x = left + i * (sw + 12);
      card(x, sy, sw, sh);
      doc.font('bold').fontSize(26).fillColor(C.text).text(big, x + 16, sy + 14, { continued: !!small, lineBreak: false });
      if (small) doc.font('bold').fontSize(13).fillColor('#8b7f7c').text(small, { lineBreak: false });
      doc.font('body').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), x + 16, sy + 48, { characterSpacing: 0.5 });
    });
    doc.y = sy + sh + 18;

    if (survey.purpose) {
      doc.font('body').fontSize(10.5);
      const ph = doc.heightOfString(t(survey.purpose), { width: width - 32, lineGap: 3 });
      ensure(ph + 52);
      const py = doc.y;
      card(left, py, width, ph + 46);
      kicker("Why we're asking", left + 16, py + 14);
      doc.font('body').fontSize(10.5).fillColor(C.text).text(t(survey.purpose), left + 16, py + 32, { width: width - 32, lineGap: 3 });
      doc.y = py + ph + 46 + 18;
    }

    doc.font('body').fontSize(9).fillColor(C.muted);
    const notes = [
      [
        `${questions.length} questions`,
        choice.length && `${choice.length} multiple choice`,
        yesno.length && `${yesno.length} Yes/No`,
        `${questions.length - choice.length - yesno.length} written`,
      ].filter(Boolean).join(' · ') + '.',
      excludeFlagged ? 'Comments flagged by admins are left out of this report.' : 'Comments flagged by admins are included and marked “Flagged”.',
    ];
    doc.text(notes.join('\n'), left, doc.y, { width, lineGap: 3 });
    doc.moveDown(0.6);
    fontNoteY = doc.y;
  }

  // ---------- 2. Statistics for closed questions (multiple choice and Yes/No) ----------
  if (closed.length) {
    doc.addPage();
    sectionHeading(choice.length ? 'Results summary' : 'Yes / No statistics', 'At a glance');
    doc.y += 6;
    // Multiple-choice cards are compact so that a typical survey's charts fit on one page.
    for (const q of closed) {
      const isChoice = q.type === 'choice';
      const titleSize = isChoice ? 11 : 12;
      doc.font('bold').fontSize(titleSize);
      const th = doc.heightOfString(t(q.title), { width: width - 32 });
      const rows = isChoice
        ? q.tally.options.map((o) => [o.label, o.count, o.pct, 'yes'])
        : [['Yes', q.yes, q.yesPct, 'yes'], ['No', q.no, q.noPct, 'no']];
      const pad = isChoice ? 12 : 14;
      const rowH = isChoice ? 14 : 20;
      const barH = isChoice ? 10 : 12;
      const h = pad + 13 + th + 8 + rows.length * rowH + (isChoice ? 4 : 8);
      ensure(h + 8);
      const y = doc.y;
      card(left, y, width, h);
      const answeredLabel = isChoice ? ` · ${q.tally.total} answer${q.tally.total === 1 ? '' : 's'}` : '';
      doc.font('body').fontSize(8).fillColor(C.muted).text(`Q${q.position}${answeredLabel}`, left + 16, y + pad);
      doc.font('bold').fontSize(titleSize).fillColor(C.text).text(t(q.title), left + 16, y + pad + 13, { width: width - 32 });
      const by = y + pad + 13 + th + 8;
      const labelW = isChoice ? 118 : 28;
      rows.forEach(([label, count, p, kind], i) => bar(left + 16, by + i * rowH, width - 32, label, count, p, kind, labelW, barH));
      doc.y = y + h + 8;
    }
  }

  // ---------- 3. Comments and written answers, question by question ----------
  if (withText.length) {
    doc.addPage();
    sectionHeading(choice.length ? 'Written responses' : 'Responses by question', 'What people said');
    doc.y += 8;
    const sectionTop = doc.y;

    const bodyOpts = { width: width - 28, lineGap: 2 };
    const commentHeight = (c) => {
      doc.font('body').fontSize(10.5);
      return 10 + 18 + 4 + doc.heightOfString(t(c.body), bodyOpts) + 8;
    };

    for (const q of withText) {
      const list = comments[q.id] || [];
      doc.font('bold').fontSize(14);
      const titleH = doc.heightOfString(t(q.title), { width });
      const headH = 14 + titleH + (q.type === 'yesno' ? 18 : 4) + 8;
      // Several text boxes → one sub-group per box; otherwise a single group.
      const groups = q.fields && q.fields.length
        ? q.fields.map((label, i) => ({ label, items: list.filter((c) => c.field_index === i) }))
        : [{ label: null, items: list }];
      const groupH = (g) => (g.label ? 22 : 0) + (g.items.length ? g.items.reduce((s, c) => s + commentHeight(c), 0) : 24);
      const total = headH + groups.reduce((s, g) => s + groupH(g), 0);
      // Keep a question together when it fits; otherwise start it on a fresh page.
      const remaining = bottom() - doc.y;
      const freshPage = atTop() || doc.y === sectionTop;
      if (!freshPage && (total > remaining || headH + 60 > remaining)) doc.addPage();

      const hy = doc.y;
      kicker(`Question ${q.position}`, left, hy);
      doc.font('bold').fontSize(14).fillColor(C.text).text(t(q.title), left, hy + 14, { width });
      if (q.type === 'yesno') {
        doc.font('body').fontSize(9.5).fillColor(C.muted).text(`Yes ${q.yes} · ${q.yesPct}%  /  No ${q.no} · ${q.noPct}%`, left, doc.y + 4);
      }
      doc.y += 8;

      for (const g of groups) {
        if (g.label) {
          ensure(22 + (g.items.length ? commentHeight(g.items[0]) : 24));
          doc.font('bold').fontSize(10.5).fillColor(C.accent700).text(t(g.label), left, doc.y + 6, { width });
          doc.y += 6;
        }
        if (!g.items.length) {
          doc.font('body').fontSize(10).fillColor(C.muted).text(q.type === 'yesno' ? 'No comments.' : 'No responses.', left, doc.y + 4);
          doc.y += 22;
          continue;
        }

        for (const c of g.items) {
          const h = commentHeight(c);
          ensure(h);
          const y = doc.y;
          doc.save().moveTo(left, y).lineTo(left + width, y).lineWidth(1).stroke(C.divider).restore();
          const ay = y + 10;
          doc.save().circle(left + 9, ay + 9, 9).fill(gradient(left, ay, 18, 18)).restore();
          doc.font('bold').fontSize(8).fillColor(C.white).text(initial(c.display_name), left, ay + 5.5, { width: 18, align: 'center', lineBreak: false });
          doc.font('bold').fontSize(10).fillColor(C.text).text(t(c.display_name), left + 28, ay + 4, { continued: true, lineBreak: false });
          doc.font('body').fontSize(8.5).fillColor(C.muted).text(`   ${formatDateTime(c.created_at)}${c.flagged ? '   · Flagged' : ''}`, { lineBreak: false });
          doc.font('body').fontSize(10.5).fillColor(C.text).text(t(c.body), left + 28, ay + 22, bodyOpts);
          doc.y = y + h;
        }
      }
      doc.y += 14;
    }
  }

  // ---------- Notes that depend on the content ----------
  if (replacedChars) {
    doc.switchToPage(0);
    doc.font('body').fontSize(9).fillColor(C.accent700).text(
      'Some comments use characters (e.g. Bengali script or emoji) that this report font cannot show; they appear as “?”. Read them in the app or the CSV export, or set PDF_FONT_REGULAR to a font that supports them.',
      left, fontNoteY, { width, lineGap: 2 }
    );
  }

  // ---------- 4. Footer on every page ----------
  const label = `Dishari · ${t(survey.name).replace(/^Dishari\s+/i, '')}`;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - PAGE.margin - 6;
    doc.save().moveTo(left, fy - 10).lineTo(left + width, fy - 10).lineWidth(0.75).stroke(C.divider).restore();
    doc.font('body').fontSize(8).fillColor(C.muted).text(`${label} · page ${i + 1} of ${range.count}`, left, fy, { width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = saved;
  }

  return doc;
}

module.exports = { buildReport };
