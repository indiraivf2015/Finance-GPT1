// PPTX renderer (pptxgenjs). Pure JS — no headless Chromium, no native deps.
// Honours the doctrine matrix: deck = native bar/pie charts + tables.
import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGO_PATH = path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'Logo.png');

const PINK = 'BE185D';
const RED = '991B1B';
const GRAY = '6B7280';
const TEXT = '111827';

function extractAsk(narrative) {
  if (!narrative) return null;
  const m = String(narrative).match(/\bAsk\s*[:\-—]\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

export async function renderDeck(spec, filePath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = spec.title || 'Indira IVF — Deliverable';
  pptx.company = 'Indira IVF';

  const restricted = spec.confidentiality === 'restricted';
  const footerText = restricted ? 'INTERNAL — NOT FOR EXTERNAL CIRCULATION' : '';

  pptx.defineSlideMaster({
    title: 'INDIRA_MASTER',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.06, fill: { color: PINK } } },
      ...(footerText
        ? [{ text: { text: footerText, options: { x: 0.3, y: 7.05, w: 12.7, h: 0.3, fontSize: 9, color: RED, italic: true, align: 'center' } } }]
        : []),
      { text: { text: 'Indira IVF — CFO Co-Pilot', options: { x: 0.3, y: 7.35, w: 12.7, h: 0.25, fontSize: 8, color: GRAY, align: 'center' } } },
    ],
  });

  // Cover slide
  const cover = pptx.addSlide({ masterName: 'INDIRA_MASTER' });
  let logoPlaced = false;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      cover.addImage({ path: LOGO_PATH, x: 5.46, y: 1.0, w: 2.4, h: 1.6 });
      logoPlaced = true;
    } catch (_e) { /* ignore — fall back to text title */ }
  }
  cover.addText(spec.title || 'Indira IVF Deliverable', {
    x: 0.5, y: logoPlaced ? 3.0 : 2.6, w: 12.3, h: 1.0,
    fontSize: 32, bold: true, color: TEXT, align: 'center',
  });
  if (spec.audience) {
    cover.addText(`Audience: ${spec.audience}`, {
      x: 0.5, y: 4.2, w: 12.3, h: 0.5, fontSize: 16, color: '4B5563', align: 'center',
    });
  }
  cover.addText(`Classification: ${(spec.confidentiality || 'internal').toUpperCase()}`, {
    x: 0.5, y: 4.8, w: 12.3, h: 0.5, fontSize: 14,
    color: restricted ? RED : GRAY, align: 'center', italic: true,
  });
  cover.addText(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), {
    x: 0.5, y: 5.5, w: 12.3, h: 0.4, fontSize: 12, color: GRAY, align: 'center',
  });

  // Executive Summary slide (S-C-R-A from first section)
  const first = spec.sections[0];
  if (first) {
    const exec = pptx.addSlide({ masterName: 'INDIRA_MASTER' });
    exec.addText('Executive Summary', { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, bold: true, color: PINK });
    exec.addText(first.heading || 'Situation, Complication, Recommendation, Ask', {
      x: 0.5, y: 1.05, w: 12.3, h: 0.4, fontSize: 14, italic: true, color: '4B5563',
    });
    exec.addText(String(first.narrative || ''), {
      x: 0.5, y: 1.55, w: 12.3, h: 5.2, fontSize: 14, color: TEXT, valign: 'top', wrap: true,
    });
  }

  // Per-section content slides
  for (let i = 0; i < spec.sections.length; i++) {
    const section = spec.sections[i];
    const slide = pptx.addSlide({ masterName: 'INDIRA_MASTER' });

    slide.addText(section.heading || `Section ${i + 1}`, {
      x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, bold: true, color: PINK,
    });

    let yCursor = 1.1;
    if (section.narrative) {
      slide.addText(String(section.narrative), {
        x: 0.5, y: yCursor, w: 12.3, h: 1.6,
        fontSize: 12, color: TEXT, align: 'left', valign: 'top', wrap: true,
      });
      yCursor += 1.7;
    }

    const hasChart = section.chart && Array.isArray(section.chart.data) && section.chart.data.length > 0;
    const hasTable = section.table && Array.isArray(section.table.columns) && Array.isArray(section.table.rows);

    if (hasChart) {
      const ct = section.chart.chartType === 'pie' ? pptx.ChartType.pie : pptx.ChartType.bar;
      const labels = section.chart.data.map(d => String(d.name ?? ''));
      const values = section.chart.data.map(d => Number(d.value) || 0);
      const chartData = [{ name: section.chart.title || section.heading || 'Series', labels, values }];
      try {
        slide.addChart(ct, chartData, {
          x: 0.5, y: yCursor, w: hasTable ? 6.0 : 12.3, h: hasTable ? 3.5 : 4.5,
          showTitle: !!section.chart.title, title: section.chart.title || '', titleFontSize: 12,
          showLegend: true, legendPos: 'b',
          chartColors: ['BE185D', '9333EA', '2563EB', '059669', 'D97706', 'DC2626', '475569', '7C3AED'],
          dataLabelFontSize: 10,
          catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
        });
      } catch (_e) { /* if chart fails, leave gracefully */ }
    }

    if (hasTable) {
      const headerRow = section.table.columns.map(c => ({
        text: String(c),
        options: { bold: true, color: 'FFFFFF', fill: { color: PINK }, align: 'center' },
      }));
      const dataRows = section.table.rows.map(r => r.map(cell => {
        const isNum = typeof cell === 'number';
        const display = cell == null ? '' : (isNum ? cell.toLocaleString('en-IN') : String(cell));
        return { text: display, options: { color: TEXT, align: isNum ? 'right' : 'left' } };
      }));
      slide.addTable([headerRow, ...dataRows], {
        x: hasChart ? 6.7 : 0.5,
        y: yCursor,
        w: hasChart ? 6.1 : 12.3,
        fontSize: 10,
        border: { type: 'solid', color: 'E5E7EB', pt: 0.5 },
        autoPage: false,
      });
    }
  }

  // Decisions Sought slide
  const decisions = pptx.addSlide({ masterName: 'INDIRA_MASTER' });
  decisions.addText('Decisions Sought', {
    x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 24, bold: true, color: PINK,
  });
  const askLines = spec.sections
    .map((s, idx) => {
      const ask = extractAsk(s.narrative);
      if (ask) return `${idx + 1}. ${ask}`;
      return `${idx + 1}. ${s.heading || 'Section'} — outcome required`;
    })
    .join('\n\n');
  decisions.addText(askLines, {
    x: 0.5, y: 1.2, w: 12.3, h: 5.3, fontSize: 14, color: TEXT, valign: 'top', wrap: true,
  });
  if (spec.sourceNote) {
    decisions.addText(`Source: ${spec.sourceNote}`, {
      x: 0.5, y: 6.6, w: 12.3, h: 0.4, fontSize: 10, color: GRAY, italic: true,
    });
  }

  await pptx.writeFile({ fileName: filePath });
}
