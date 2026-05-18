// Artifact rendering entry point.
// Honours the matrix declared in the doctrine: PPTX (deck) ships charts,
// XLSX (workbook) ships live formulas + R/A/G conditional formatting,
// DOCX (report) and PDF carry narrative + tables only.
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { renderDeck } from './deck.js';
import { renderWorkbook } from './workbook.js';
import { renderReport } from './report.js';
import { renderPdf } from './pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GENERATED_DIR = path.join(__dirname, '..', 'generated');

const TYPE_MAP = {
  deck:     { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', render: renderDeck },
  workbook: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         render: renderWorkbook },
  report:   { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   render: renderReport },
  pdf:      { ext: 'pdf',  mime: 'application/pdf',                                                            render: renderPdf },
};

function sanitizeFileName(s) {
  return String(s || 'artifact')
    .replace(/[^a-zA-Z0-9_\- ]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'artifact';
}

export async function renderArtifact(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec must be an object');
  const cfg = TYPE_MAP[spec.type];
  if (!cfg) throw new Error(`Unsupported artifact type: ${spec.type}. Allowed: deck | workbook | report | pdf`);
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) throw new Error('spec.sections must be a non-empty array');

  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const id = uuidv4();
  const baseName = sanitizeFileName(spec.filenameHint || spec.title || 'artifact');
  const fileName = `${baseName}.${cfg.ext}`;
  const filePath = path.join(GENERATED_DIR, `${id}.${cfg.ext}`);

  await cfg.render(spec, filePath);

  return { id, filePath, fileName, mime: cfg.mime, generatedDir: GENERATED_DIR };
}

// Opportunistic sweep — deletes generated artifact files older than maxAgeMs.
// Called from /api/artifact/generate on every invocation. No cron required.
export function sweepGeneratedDir(maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    if (!fs.existsSync(GENERATED_DIR)) return;
    const now = Date.now();
    for (const entry of fs.readdirSync(GENERATED_DIR)) {
      try {
        const p = path.join(GENERATED_DIR, entry);
        const st = fs.statSync(p);
        if (st.isFile() && (now - st.mtimeMs) > maxAgeMs) {
          fs.unlinkSync(p);
        }
      } catch (_e) { /* per-entry failures must not abort the sweep */ }
    }
  } catch (_e) { /* sweep is best-effort */ }
}

export { GENERATED_DIR };
