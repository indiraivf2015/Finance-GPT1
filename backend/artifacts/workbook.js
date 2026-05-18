// XLSX renderer (exceljs). Pure JS — no native deps.
// Honours the doctrine matrix:
//   - Multiple sheets (Cover + one per section + Data trace).
//   - Live SUM/total formulas (never hard-coded computed values).
//   - Conditional formatting (R/A/G) on variance and margin columns.
//   - Embedded charts intentionally NOT rendered — exceljs cannot author them
//     reliably, and we will not silently downgrade. Charts ship in PPTX.
import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBE185D' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11, name: 'Calibri' };
const TITLE_FONT  = { color: { argb: 'FFBE185D' }, bold: true, size: 16, name: 'Calibri' };
const FOOTER_FONT = { color: { argb: 'FF991B1B' }, italic: true, size: 10, name: 'Calibri' };

const VARIANCE_COL_RX = /\b(variance|delta|gap|diff|var\b)/i;
const MARGIN_COL_RX   = /\b(margin|%|ratio|rate)\b|%\)?$/i;

function isVarianceColumn(name) { return VARIANCE_COL_RX.test(String(name || '')); }
function isMarginColumn(name)   { return MARGIN_COL_RX.test(String(name || '')); }

function safeSheetName(s) {
  return String(s || 'Section').replace(/[\\/\*\?\:\[\]]/g, '_').slice(0, 31).trim() || 'Section';
}

export async function renderWorkbook(spec, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Indira IVF — CFO Co-Pilot';
  wb.created = new Date();
  wb.title = spec.title || 'Indira IVF Deliverable';

  const restricted = spec.confidentiality === 'restricted';

  // --- Cover sheet ---
  const cover = wb.addWorksheet('Cover');
  cover.getCell('B2').value = spec.title || 'Indira IVF Deliverable';
  cover.getCell('B2').font = { ...TITLE_FONT, size: 18 };
  cover.getCell('B4').value = `Audience: ${spec.audience || 'Internal'}`;
  cover.getCell('B5').value = `Classification: ${(spec.confidentiality || 'internal').toUpperCase()}`;
  cover.getCell('B6').value = `Generated: ${new Date().toLocaleString('en-IN')}`;
  if (spec.sourceNote) {
    cover.getCell('B8').value = `Source: ${spec.sourceNote}`;
    cover.getCell('B8').alignment = { wrapText: true, vertical: 'top' };
  }
  if (restricted) {
    cover.getCell('B10').value = 'INTERNAL — NOT FOR EXTERNAL CIRCULATION';
    cover.getCell('B10').font = FOOTER_FONT;
  }
  cover.getColumn(1).width = 4;
  cover.getColumn(2).width = 100;

  // --- Per-section sheets ---
  const usedNames = new Set(['Cover']);
  for (let i = 0; i < spec.sections.length; i++) {
    const section = spec.sections[i];
    let sheetName = safeSheetName(`${i + 1}_${section.heading || 'Section'}`);
    let suffix = 1;
    while (usedNames.has(sheetName)) {
      sheetName = safeSheetName(`${i + 1}_${section.heading || 'Section'}_${++suffix}`);
    }
    usedNames.add(sheetName);
    const ws = wb.addWorksheet(sheetName);

    // Heading + narrative
    ws.getCell('A1').value = section.heading || `Section ${i + 1}`;
    ws.getCell('A1').font = TITLE_FONT;
    ws.mergeCells('A1:H1');

    if (section.narrative) {
      ws.getCell('A3').value = String(section.narrative);
      ws.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
      ws.mergeCells('A3:H6');
      ws.getRow(3).height = 18;
    }

    if (section.table && Array.isArray(section.table.columns) && Array.isArray(section.table.rows) && section.table.columns.length > 0) {
      const startRow = 8;
      const cols = section.table.columns.map(c => String(c));

      // Column headers
      ws.getRow(startRow).values = cols;
      ws.getRow(startRow).eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFBE185D' } },
          bottom: { style: 'thin', color: { argb: 'FFBE185D' } },
          left: { style: 'thin', color: { argb: 'FFBE185D' } },
          right: { style: 'thin', color: { argb: 'FFBE185D' } },
        };
      });

      // Detect numeric columns from the first row that supplies a number
      const numericColIdx = new Set();
      for (const row of section.table.rows) {
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'number' && Number.isFinite(row[c])) numericColIdx.add(c);
        }
      }

      // Insert data rows
      let r = startRow + 1;
      for (const row of section.table.rows) {
        ws.getRow(r).values = cols.map((_c, idx) => {
          const v = row[idx];
          return typeof v === 'number' ? v : (v == null ? '' : v);
        });
        ws.getRow(r).eachCell((cell, colNumber) => {
          cell.border = {
            top:    { style: 'hair', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
            left:   { style: 'hair', color: { argb: 'FFE5E7EB' } },
            right:  { style: 'hair', color: { argb: 'FFE5E7EB' } },
          };
          if (typeof cell.value === 'number') {
            cell.alignment = { horizontal: 'right' };
            const colName = cols[colNumber - 1] || '';
            if (isMarginColumn(colName)) cell.numFmt = '0.0%';
            else cell.numFmt = '#,##0.00';
          }
        });
        r++;
      }
      const lastDataRow = r - 1;

      // TOTAL row with LIVE FORMULAS — never hard-coded sums
      if (lastDataRow >= startRow + 1) {
        const totalsRow = lastDataRow + 1;
        ws.getCell(totalsRow, 1).value = 'TOTAL';
        ws.getCell(totalsRow, 1).font = { bold: true };
        ws.getRow(totalsRow).eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7F3' } };
        });
        for (let c = 1; c < cols.length; c++) {
          if (numericColIdx.has(c)) {
            const colLetter = ws.getColumn(c + 1).letter;
            const colName = cols[c] || '';
            if (isMarginColumn(colName)) {
              // Margin/% columns aren't summable; leave blank to avoid misleading totals
              continue;
            }
            ws.getCell(totalsRow, c + 1).value = { formula: `SUM(${colLetter}${startRow + 1}:${colLetter}${lastDataRow})` };
            ws.getCell(totalsRow, c + 1).font = { bold: true };
            ws.getCell(totalsRow, c + 1).numFmt = '#,##0.00';
            ws.getCell(totalsRow, c + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7F3' } };
          }
        }
      }

      // Conditional formatting (R/A/G) on variance + margin columns
      for (let c = 0; c < cols.length; c++) {
        const colName = cols[c];
        const colLetter = ws.getColumn(c + 1).letter;
        if (lastDataRow < startRow + 1) continue;
        const range = `${colLetter}${startRow + 1}:${colLetter}${lastDataRow}`;
        if (isVarianceColumn(colName) && numericColIdx.has(c)) {
          ws.addConditionalFormatting({
            ref: range,
            rules: [
              { type: 'cellIs', operator: 'greaterThan', priority: 1, formulae: ['0'],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD1FAE5' } }, font: { color: { argb: 'FF065F46' }, bold: true } } },
              { type: 'cellIs', operator: 'lessThan', priority: 2, formulae: ['0'],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } }, font: { color: { argb: 'FF991B1B' }, bold: true } } },
            ],
          });
        } else if (isMarginColumn(colName) && numericColIdx.has(c)) {
          ws.addConditionalFormatting({
            ref: range,
            rules: [
              { type: 'cellIs', operator: 'greaterThanOrEqual', priority: 1, formulae: ['0.20'],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD1FAE5' } } } },
              { type: 'cellIs', operator: 'between', priority: 2, formulae: ['0.10', '0.1999'],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } } } },
              { type: 'cellIs', operator: 'lessThan', priority: 3, formulae: ['0.10'],
                style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } } } },
            ],
          });
        }
      }

      // Approximate column widths
      ws.columns.forEach((col, idx) => {
        let maxLen = (cols[idx] || '').length;
        for (const row of section.table.rows) {
          const v = row[idx];
          const s = v == null ? '' : String(v);
          if (s.length > maxLen) maxLen = s.length;
        }
        col.width = Math.min(Math.max(maxLen + 2, 12), 40);
      });
    } else if (section.chart && Array.isArray(section.chart.data) && section.chart.data.length > 0) {
      // No table provided — render the chart's data as a small numeric reference table
      const startRow = 8;
      ws.getRow(startRow).values = ['Name', 'Value'];
      ws.getRow(startRow).eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { horizontal: 'center' };
      });
      let r = startRow + 1;
      for (const d of section.chart.data) {
        ws.getRow(r).values = [String(d.name ?? ''), Number(d.value) || 0];
        ws.getCell(r, 2).numFmt = '#,##0.00';
        r++;
      }
      const lastDataRow = r - 1;
      ws.getRow(r).values = ['TOTAL', { formula: `SUM(B${startRow + 1}:B${lastDataRow})` }];
      ws.getRow(r).font = { bold: true };
      ws.getCell(r, 2).numFmt = '#,##0.00';
      ws.getColumn(1).width = 28;
      ws.getColumn(2).width = 20;
    }

    if (restricted) {
      const footerRow = (ws.lastRow?.number || 30) + 3;
      ws.getCell(`A${footerRow}`).value = 'Internal — not for external circulation';
      ws.getCell(`A${footerRow}`).font = FOOTER_FONT;
    }
  }

  // --- Data sheet (raw rows for traceability) ---
  const dataSheet = wb.addWorksheet('Data');
  dataSheet.getRow(1).values = ['Section', 'Row JSON'];
  dataSheet.getRow(1).font = HEADER_FONT;
  dataSheet.getRow(1).fill = HEADER_FILL;
  let dr = 2;
  for (const section of spec.sections) {
    if (section.table?.rows) {
      for (const row of section.table.rows) {
        dataSheet.getCell(`A${dr}`).value = section.heading || '';
        dataSheet.getCell(`B${dr}`).value = JSON.stringify(row);
        dr++;
      }
    }
  }
  dataSheet.getColumn(1).width = 30;
  dataSheet.getColumn(2).width = 100;
  if (restricted) {
    const footerRow = dr + 2;
    dataSheet.getCell(`A${footerRow}`).value = 'Internal — not for external circulation';
    dataSheet.getCell(`A${footerRow}`).font = FOOTER_FONT;
  }

  await wb.xlsx.writeFile(filePath);
}
