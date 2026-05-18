// PDF renderer (pdfkit). Pure JS — no native deps.
// Honours the doctrine matrix: PDF carries narrative + tables only,
// paginated, with running header/footer; restricted ⇒ confidentiality watermark.
import PDFDocument from 'pdfkit';
import fs from 'fs';

const PINK = '#BE185D';
const RED  = '#991B1B';
const GRAY = '#6B7280';
const TEXT = '#111827';

function decoratePages(doc, spec, restricted) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNo = i - range.start + 1;
    const total = range.count;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    // Header
    doc.fontSize(9).fillColor(GRAY).font('Helvetica')
      .text(spec.title || 'Indira IVF Deliverable', 36, 20, { align: 'right', width: doc.page.width - 72 });

    // Watermark for restricted
    if (restricted) {
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor(RED).opacity(0.08).fontSize(70).font('Helvetica-Bold')
        .text('INTERNAL — NOT FOR EXTERNAL CIRCULATION', 0, doc.page.height / 2 - 35, {
          align: 'center', width: doc.page.width,
        });
      doc.opacity(1);
      doc.restore();
    }

    // Footer
    let footerText = `Page ${pageNo} of ${total}`;
    if (restricted) footerText = `Internal — not for external circulation   |   ${footerText}`;
    doc.fontSize(9).fillColor(restricted ? RED : GRAY).font(restricted ? 'Helvetica-Oblique' : 'Helvetica')
      .text(footerText, 36, doc.page.height - 30, { align: 'center', width: doc.page.width - 72 });

    doc.page.margins.bottom = oldBottom;
  }
}

function drawTable(doc, columns, rows) {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usableWidth / columns.length;
  const rowHeight = 18;

  if (doc.y + rowHeight > doc.page.height - 80) doc.addPage();

  // Header row
  doc.save().rect(startX, doc.y, usableWidth, rowHeight).fill(PINK).restore();
  doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
  const headerY = doc.y + 4;
  columns.forEach((c, i) => {
    doc.text(String(c), startX + i * colWidth + 4, headerY, {
      width: colWidth - 8, ellipsis: true, lineBreak: false,
    });
  });
  doc.y += rowHeight;

  doc.font('Helvetica').fontSize(9).fillColor(TEXT);
  for (const r of rows) {
    if (doc.y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      // re-draw header on the new page for clarity
      doc.save().rect(startX, doc.y, usableWidth, rowHeight).fill(PINK).restore();
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
      const hY = doc.y + 4;
      columns.forEach((c, i) => {
        doc.text(String(c), startX + i * colWidth + 4, hY, {
          width: colWidth - 8, ellipsis: true, lineBreak: false,
        });
      });
      doc.y += rowHeight;
      doc.font('Helvetica').fontSize(9).fillColor(TEXT);
    }
    const rowY = doc.y + 3;
    columns.forEach((_c, i) => {
      const cell = r[i];
      const isNum = typeof cell === 'number';
      const display = cell == null ? '' : (isNum ? cell.toLocaleString('en-IN') : String(cell));
      doc.text(display, startX + i * colWidth + 4, rowY, {
        width: colWidth - 8, ellipsis: true, lineBreak: false, align: isNum ? 'right' : 'left',
      });
    });
    doc.moveTo(startX, doc.y + rowHeight).lineTo(startX + usableWidth, doc.y + rowHeight)
      .strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    doc.y += rowHeight;
  }
  doc.moveDown(0.5);
}

export async function renderPdf(spec, filePath) {
  const restricted = spec.confidentiality === 'restricted';
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: spec.title || 'Indira IVF Deliverable',
          Author: 'Indira IVF — CFO Co-Pilot',
        },
        bufferPages: true,
      });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Title block
      doc.fillColor(PINK).fontSize(22).font('Helvetica-Bold')
        .text(spec.title || 'Indira IVF Deliverable', { align: 'center' });
      doc.moveDown(0.3);
      doc.fillColor(restricted ? RED : GRAY).fontSize(11).font('Helvetica-Oblique')
        .text(`${spec.audience ? 'Audience: ' + spec.audience + '   |   ' : ''}Classification: ${(spec.confidentiality || 'internal').toUpperCase()}`, {
          align: 'center',
        });
      doc.fillColor(GRAY).fontSize(10).font('Helvetica')
        .text(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), { align: 'center' });
      doc.moveDown(1);

      for (let i = 0; i < spec.sections.length; i++) {
        const section = spec.sections[i];
        if (doc.y > doc.page.height - 200) doc.addPage();

        doc.fillColor(PINK).fontSize(14).font('Helvetica-Bold')
          .text(`${i + 1}. ${section.heading || 'Section'}`);
        doc.moveDown(0.3);

        if (section.narrative) {
          doc.fillColor(TEXT).fontSize(10).font('Helvetica')
            .text(String(section.narrative), { align: 'left' });
          doc.moveDown(0.5);
        }

        if (section.table?.columns && section.table?.rows && section.table.columns.length > 0) {
          drawTable(doc, section.table.columns, section.table.rows);
        }

        if (section.chart && Array.isArray(section.chart.data) && section.chart.data.length > 0) {
          doc.fillColor(GRAY).fontSize(9).font('Helvetica-Oblique')
            .text(`[Chart: "${section.chart.title || section.heading || 'Chart'}" — rendered in the PPTX deliverable. The Word/PDF carry the underlying tables.]`, { align: 'left' });
          doc.moveDown(0.4);
        }
      }

      if (spec.sourceNote) {
        doc.moveDown(1);
        doc.fillColor(GRAY).fontSize(9).font('Helvetica-Oblique')
          .text(`Source: ${spec.sourceNote}`, { align: 'left' });
      }

      decoratePages(doc, spec, restricted);
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (e) { reject(e); }
  });
}
