// DOCX renderer (docx). Pure JS — no native deps.
// Honours the doctrine matrix: report (Word) carries narrative + tables only.
// Charts are intentionally NOT rendered — the docx library cannot author them
// reliably; charts ship in PPTX.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType,
  Header, Footer, PageNumber, BorderStyle,
} from 'docx';
import fs from 'fs';

function thinBorder(color = 'E5E7EB') {
  return {
    top:    { style: BorderStyle.SINGLE, size: 4, color },
    bottom: { style: BorderStyle.SINGLE, size: 4, color },
    left:   { style: BorderStyle.SINGLE, size: 4, color },
    right:  { style: BorderStyle.SINGLE, size: 4, color },
  };
}

function tableFromSection(section) {
  const cols = section.table.columns.map(c => String(c));
  const rows = section.table.rows;

  const tableRows = [];
  tableRows.push(new TableRow({
    tableHeader: true,
    children: cols.map(c => new TableCell({
      shading: { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'BE185D' },
      borders: thinBorder('BE185D'),
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', size: 20 })],
      })],
    })),
  }));

  for (const r of rows) {
    tableRows.push(new TableRow({
      children: cols.map((_c, idx) => {
        const cell = r[idx];
        const isNum = typeof cell === 'number';
        const display = cell == null ? '' : (isNum ? cell.toLocaleString('en-IN') : String(cell));
        return new TableCell({
          borders: thinBorder('E5E7EB'),
          children: [new Paragraph({
            alignment: isNum ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: [new TextRun({ text: display, size: 20, color: '111827' })],
          })],
        });
      }),
    }));
  }

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export async function renderReport(spec, filePath) {
  const restricted = spec.confidentiality === 'restricted';
  const children = [];

  // S-C-R-A one-pager FIRST (per spec — first section is the executive summary)
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: spec.title || 'Indira IVF Deliverable', bold: true, size: 36, color: 'BE185D' })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `${spec.audience ? 'Audience: ' + spec.audience + '   |   ' : ''}Classification: ${(spec.confidentiality || 'internal').toUpperCase()}`,
      italics: true, size: 20, color: restricted ? '991B1B' : '6B7280',
    })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
      size: 20, color: '6B7280',
    })],
  }));
  children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));

  for (let i = 0; i < spec.sections.length; i++) {
    const section = spec.sections[i];

    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: `${i + 1}. ${section.heading || 'Section'}`, bold: true, color: 'BE185D', size: 28 })],
    }));

    if (section.narrative) {
      const lines = String(section.narrative).split(/\n+/);
      for (const line of lines) {
        if (!line.trim()) continue;
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: line, size: 22, color: '111827' })],
        }));
      }
    }

    if (section.table?.columns && section.table?.rows && section.table.columns.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      children.push(tableFromSection(section));
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    }

    if (section.chart && Array.isArray(section.chart.data) && section.chart.data.length > 0) {
      // Charts cannot be rendered in the Word format — flag plainly to keep the
      // user honest. The PPTX deliverable carries the visual.
      children.push(new Paragraph({
        children: [new TextRun({
          text: `[Chart: "${section.chart.title || section.heading || 'Chart'}" — rendered in the PPTX deliverable. The Word/PDF carry the underlying tables.]`,
          italics: true, size: 18, color: '6B7280',
        })],
      }));
    }
  }

  if (spec.sourceNote) {
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `Source: ${spec.sourceNote}`, italics: true, color: '6B7280', size: 18 })],
    }));
  }

  const doc = new Document({
    creator: 'Indira IVF — CFO Co-Pilot',
    title: spec.title || 'Indira IVF Deliverable',
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: spec.title || 'Indira IVF Deliverable', size: 18, color: '6B7280' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: restricted
              ? [
                  new TextRun({ text: 'Internal — not for external circulation', italics: true, color: '991B1B', size: 18 }),
                  new TextRun({ text: '   |   Page ', size: 18, color: '6B7280' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '6B7280' }),
                ]
              : [
                  new TextRun({ text: 'Page ', size: 18, color: '6B7280' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '6B7280' }),
                ],
          })],
        }),
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buf);
}
