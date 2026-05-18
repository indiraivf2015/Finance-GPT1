/** Auto-detect dimension/date columns and create single-field indexes after bulk insert. */

const DIMENSION_RX = /(centre|center|cluster|region|zone|district|city|state|branch|hub|location|area|territory|market)/i;
const DATE_RX = /(date|month|year|period|week|day|quarter|fy|timestamp|time)/i;

function looksLikeDate(val) {
  if (val instanceof Date) return true;
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)) return true;
  const d = Date.parse(s);
  return !Number.isNaN(d);
}

/**
 * @param {import('mongodb').Collection} collection
 * @param {Record<string, unknown>[]} records
 * @param {string[]} headers
 */
export async function buildDataCollectionIndexes(collection, records, headers) {
  if (!records?.length || !headers?.length) return [];

  const rowCount = records.length;
  const SAMPLE = Math.min(records.length, 2000);
  const candidates = [];

  for (const col of headers) {
    const nameHint = DIMENSION_RX.test(col) || DATE_RX.test(col);
    const distinct = new Set();
    let dateHits = 0;
    let nonNull = 0;

    for (let i = 0; i < SAMPLE; i++) {
      const v = records[i][col];
      if (v === null || v === undefined || v === '') continue;
      nonNull++;
      distinct.add(typeof v === 'string' ? v.trim().toUpperCase() : String(v));
      if (DATE_RX.test(col) || looksLikeDate(v)) dateHits++;
    }

    if (nonNull === 0) continue;

    const cardinality = distinct.size;
    const lowCardinality = cardinality > 0 && cardinality <= Math.max(50, Math.floor(rowCount * 0.05));
    const mostlyDates = dateHits / nonNull >= 0.5;

    if (nameHint || lowCardinality || mostlyDates) {
      candidates.push(col);
    }
  }

  const created = [];
  for (const col of candidates) {
    try {
      const indexName = await collection.createIndex({ [col]: 1 }, { name: `idx_${col}`.slice(0, 120) });
      created.push({ column: col, index: indexName });
    } catch (e) {
      console.warn(`⚠️ Could not create index on ${collection.collectionName}.${col}: ${e.message}`);
    }
  }

  if (created.length > 0) {
    console.log(`✓ Indexes on ${collection.collectionName}: ${created.map((c) => c.column).join(', ')}`);
  }
  return created;
}

export function inferColumnTypesFromRecords(records, headers) {
  const columnTypes = {};
  for (const col of headers) {
    for (let i = 0; i < Math.min(records.length, 200); i++) {
      const v = records[i][col];
      if (v === null || v === undefined || v === '') continue;
      columnTypes[col] = typeof v === 'number' && Number.isFinite(v) ? 'number' : 'string';
      break;
    }
    if (!columnTypes[col]) columnTypes[col] = 'string';
  }
  return columnTypes;
}

export function sampleRowsFromRecords(records, limit = 3) {
  return records.slice(0, limit).map((row) => ({ ...row }));
}
