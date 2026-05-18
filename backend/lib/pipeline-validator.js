/**
 * MongoDB aggregation pipeline safety checks (column-aware).
 */

const DISALLOWED_STAGES = ['$out', '$merge', '$currentOp', '$listSessions', '$planCacheStats'];

/** Stages that parse raw CSV-style cells — data is already columnar in MongoDB. */
const DISALLOWED_PARSE_STAGES = ['$split', '$regexFind', '$regexFindAll'];

const AGG_OPERATORS = new Set([
  'sum',
  'avg',
  'min',
  'max',
  'first',
  'last',
  'push',
  'addToSet',
  'stdDevPop',
  'stdDevSamp',
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Walk pipeline / expressions and collect $split targets and $sum field refs. */
function walkExpression(node, ctx) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkExpression(item, ctx));
    return;
  }
  if (!isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    if (DISALLOWED_PARSE_STAGES.includes(key)) {
      ctx.blockedStages.push(key);
      if (key === '$split' && Array.isArray(value) && value.length > 0) {
        const target = value[0];
        if (typeof target === 'string' && target.startsWith('$') && !target.startsWith('$$')) {
          ctx.splitFields.push(target.slice(1));
        }
      }
    }
    if (DISALLOWED_STAGES.includes(key)) {
      ctx.blockedStages.push(key);
    }
    walkExpression(value, ctx);
  }

  // "$sum": "$Total_Revenue" or "$group": { total: { $sum: "$x" } }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (AGG_OPERATORS.has(k.replace(/^\$/, '')) && typeof v === 'string' && v.startsWith('$') && !v.startsWith('$$')) {
        ctx.sumFields.push(v.slice(1));
      }
    }
  }
}

function normalizeColumnTypes(columnTypes) {
  if (!columnTypes || typeof columnTypes !== 'object') return {};
  const out = {};
  for (const [col, typ] of Object.entries(columnTypes)) {
    out[col] = String(typ).toLowerCase();
  }
  return out;
}

function fieldType(col, types) {
  if (types[col]) return types[col];
  if (/^col_\d+$/i.test(col)) return 'number';
  return 'string';
}

function isNumericType(typ) {
  return typ === 'number' || typ === 'int' || typ === 'integer' || typ === 'double' || typ === 'float';
}

/**
 * @param {unknown[]} pipeline
 * @param {Record<string, string>} [columnTypes] from csvFiles metadata
 * @returns {string[]} allowed column names (for hints)
 */
export function validatePipelineWithSchema(pipeline, columnTypes = {}) {
  if (!Array.isArray(pipeline)) {
    throw new Error('Pipeline must be an array');
  }

  const types = normalizeColumnTypes(columnTypes);
  const ctx = { blockedStages: [], splitFields: [], sumFields: [] };

  for (const stage of pipeline) {
    if (!isPlainObject(stage)) {
      throw new Error('Each pipeline stage must be an object');
    }
    for (const key of Object.keys(stage)) {
      if (DISALLOWED_STAGES.includes(key)) {
        throw new Error(`Dangerous pipeline stage not allowed: ${key}`);
      }
    }
    walkExpression(stage, ctx);
  }

  if (ctx.blockedStages.length > 0) {
    const unique = [...new Set(ctx.blockedStages)];
    const cols = Object.keys(types);
    const numericCols = cols.filter((c) => isNumericType(fieldType(c, types)));
    const geoCols = cols.filter((c) =>
      /state|region|cluster|district|city|centre|center|zone/i.test(c)
    );
    throw new Error(
      `Pipeline uses disallowed stage(s): ${unique.join(', ')}. ` +
        `Data is already structured — use only $match, $group, $project, $sort, $limit, $addFields, $count. ` +
        `Do NOT use $split or parse col_* as CSV. ` +
        (geoCols.length
          ? `Geography columns: ${geoCols.join(', ')}. `
          : '') +
        (numericCols.length
          ? `Numeric columns for $sum: ${numericCols.slice(0, 20).join(', ')}${numericCols.length > 20 ? '…' : ''}.`
          : 'Use exact column names from the schema.')
    );
  }

  for (const col of ctx.splitFields) {
    const typ = fieldType(col, types);
    if (isNumericType(typ)) {
      throw new Error(
        `$split cannot be used on numeric field "${col}". Use $match and $group with $sum on numeric columns instead.`
      );
    }
  }

  for (const col of ctx.sumFields) {
    const typ = fieldType(col, types);
    if (typ === 'string' && !/^col_\d+$/i.test(col)) {
      throw new Error(
        `Cannot $sum string field "${col}". Use a numeric column such as: ${
          Object.keys(types)
            .filter((c) => isNumericType(fieldType(c, types)))
            .slice(0, 12)
            .join(', ') || '(check schema)'
        }.`
      );
    }
  }

  return Object.keys(types);
}

/** @deprecated use validatePipelineWithSchema */
export function validatePipeline(pipeline) {
  return validatePipelineWithSchema(pipeline, {});
}

/**
 * Build hint text for LLM retries from file metadata.
 */
export function buildSchemaHintForCollection(fileDoc) {
  if (!fileDoc) return '';
  const { columns = [], columnTypes = {} } =
    fileDoc.columnTypes && Object.keys(fileDoc.columnTypes).length
      ? { columns: fileDoc.columns || [], columnTypes: fileDoc.columnTypes }
      : { columns: fileDoc.columns || [], columnTypes: {} };

  const lines = columns.map((c) => {
    const t = fieldType(c, normalizeColumnTypes(columnTypes));
    return `  - ${c} (${t})`;
  });

  const geo = columns.filter((c) => /state|region|cluster|district|city|centre|center/i.test(c));
  const revenue = columns.filter((c) =>
    /revenue|pharmacy|operative|ivf|sale|amount|total/i.test(c)
  );

  let extra = '';
  if (geo.length) {
    extra += `\nGeography filters: prefer ${geo.map((g) => `"${g}"`).join(', ')} (e.g. StateName for Gujarat — do not guess "State" unless listed).`;
  }
  if (revenue.length) {
    extra += `\nRevenue metrics: sum with $sum on ${revenue.slice(0, 8).map((r) => `"$${r}"`).join(', ')}.`;
  }

  return `Collection \`${fileDoc.dataCollection || fileDoc.fileName}\` (${fileDoc.fileName}):\n${lines.join('\n')}${extra}`;
}
