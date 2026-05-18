/**
 * MongoDB query prompt helpers — schema-aware routing for LLM parity (Claude / Gemini).
 */

export type CollectionSchema = {
  columns: string[];
  rowCount: number;
  fileName: string;
  columnTypes?: Record<string, string>;
  parseQuality?: Array<{
    column: string;
    inferred: 'numeric' | 'text' | 'mixed';
    coercedPct: number;
  }>;
};

export type FileAttachment = {
  name: string;
  isCsv?: boolean;
  collectionName?: string;
  headers?: string[];
  columnTypes?: Record<string, string>;
  rowCount?: number;
};

export type QueryTopic = 'revenue' | 'cluster' | 'footfall' | 'call' | 'lead' | 'general';

export function detectQueryTopics(query: string): Set<QueryTopic> {
  const q = query.toLowerCase();
  const topics = new Set<QueryTopic>();

  if (
    /cluster|old\s*center|new\s*center|fy\s*25|fy\s*26|fy25|fy26|oldvsnew|old\s*vs\s*new|degrowth|cannibal|expansion|existing\s*center/i.test(
      q
    )
  ) {
    topics.add('cluster');
  }
  if (
    /revenue|revenues|financial|income|earnings|rupees|rs\.|₹|pharmacy|ivf_revenue|operative/i.test(
      q
    ) &&
    !/cluster|old\s*center|new\s*center|degrowth|cannibal/i.test(q)
  ) {
    topics.add('revenue');
  }
  if (/footfall|show rate|visit/i.test(q)) topics.add('footfall');
  if (/call center|call_centre|audit|transcript|empathy|fatal/i.test(q)) topics.add('call');
  if (/\blead\b|crm|inquiry|enquiry/i.test(q)) topics.add('lead');
  if (topics.size === 0) topics.add('general');

  return topics;
}

export function pickFilesForQuery(query: string, availableFiles: FileAttachment[]): FileAttachment[] {
  const q = query.toLowerCase();
  const topics = detectQueryTopics(query);
  const matched: FileAttachment[] = [];
  const seen = new Set<string>();

  const add = (f: FileAttachment | undefined) => {
    if (f && !seen.has(f.name)) {
      matched.push(f);
      seen.add(f.name);
    }
  };

  if (topics.has('cluster')) {
    const patterns = [
      'oldvsnew',
      'old_vs_new',
      'clustersummary',
      'cluster_summary',
      'cluster',
      'footfall',
      'file to icsi',
      'file_to_icsi',
      'icsi',
    ];
    for (const f of availableFiles) {
      const n = f.name.toLowerCase().replace(/[\s_-]+/g, '');
      if (patterns.some((p) => n.includes(p.replace(/[\s_-]+/g, '')))) add(f);
    }
    if (matched.length > 0) return matched.slice(0, 8);
  }

  if (topics.has('revenue')) {
    const revenueFile = availableFiles.find(
      (f) => f.name.toLowerCase().includes('revenue') && !f.name.toLowerCase().includes('lead')
    );
    if (revenueFile) return [revenueFile];
  }

  if (topics.has('footfall')) {
    for (const f of availableFiles) {
      if (f.name.toLowerCase().includes('footfall')) add(f);
    }
    if (matched.length) return matched.slice(0, 6);
  }

  if (topics.has('call')) {
    for (const f of availableFiles) {
      if (/call|audit|transcript/i.test(f.name)) add(f);
    }
    if (matched.length) return matched.slice(0, 4);
  }

  if (topics.has('lead')) {
    for (const f of availableFiles) {
      if (/lead|crm/i.test(f.name) && !f.name.toLowerCase().includes('revenue')) add(f);
    }
    if (matched.length) return matched.slice(0, 4);
  }

  const fileMappings: { keywords: string[]; patterns: string[] }[] = [
    { keywords: ['revenue'], patterns: ['revenue'] },
    { keywords: ['region', 'gujarat', 'state', 'geographic'], patterns: ['region', 'revenue'] },
    { keywords: ['market share', 'competition', 'nova'], patterns: ['market', 'competetion', 'nova', 'opu'] },
    { keywords: ['conversion', 'icsi'], patterns: ['conversion', 'icsi', 'file'] },
  ];

  for (const mapping of fileMappings) {
    if (mapping.keywords.some((kw) => q.includes(kw))) {
      for (const f of availableFiles) {
        const n = f.name.toLowerCase();
        if (mapping.patterns.some((p) => n.includes(p))) add(f);
      }
    }
  }

  if (matched.length > 0) return matched.slice(0, 8);
  return availableFiles.slice(0, 8);
}

function collNameFromAtt(att: FileAttachment): string {
  return (
    att.collectionName ||
    'data_' +
      att.name
        .replace(/\.csv$/i, '')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase()
  );
}

export function formatCollectionSchemaBlock(
  att: FileAttachment,
  tableSchemas: Record<string, CollectionSchema>
): string {
  const coll = collNameFromAtt(att);
  const schema = tableSchemas[coll];
  const columns = schema?.columns || att.headers || [];
  const types = schema?.columnTypes || att.columnTypes || {};
  const rowCount = schema?.rowCount ?? att.rowCount ?? 0;

  const colLines = columns
    .map((c) => {
      const t = types[c] || (/^col_\d+$/i.test(c) ? 'number' : 'string');
      return `    - \`${c}\` (${t})`;
    })
    .join('\n');

  const geoCols = columns.filter((c) => /state|region|cluster|district|city|centre|center|zone/i.test(c));
  const numCols = columns.filter((c) => {
    const t = types[c] || '';
    return t === 'number' || /revenue|amount|total|count|footfall|icsi|sale|margin|ebitda/i.test(c);
  });

  let hints = '';
  if (geoCols.length) {
    hints += `\n  - **Geography:** use ${geoCols.map((g) => `\`${g}\``).join(', ')}. For Gujarat use \`StateName\` if present (not \`State\` unless listed).`;
  }
  if (numCols.length) {
    hints += `\n  - **Metrics ($sum):** ${numCols.slice(0, 10).map((n) => `\`$${n}\``).join(', ')}`;
  }

  return (
    `--- ${att.name} ---\n` +
    `  - **Collection:** \`${coll}\`\n` +
    `  - **Rows:** ${rowCount.toLocaleString()}\n` +
    `  - **Columns (exact names):**\n${colLines || '    (load schemas)'}\n` +
    hints +
    `\n  - **Example:** \`{"collection":"${coll}","pipeline":[{"$match":{}},{"$group":{"_id":null,"count":{"$sum":1}}}]}\`\n` +
    `---`
  );
}

export function buildRevenueMongoExample(
  collName: string,
  schema?: CollectionSchema
): string {
  const cols = schema?.columns || [];
  const types = schema?.columnTypes || {};
  const stateField =
    cols.find((c) => /^statename$/i.test(c)) ||
    cols.find((c) => /^state$/i.test(c)) ||
    'StateName';
  const revenueField =
    cols.find((c) => types[c] === 'number' && /total_revenue|^revenue$/i.test(c)) ||
    cols.find((c) => /total_revenue/i.test(c)) ||
    cols.find((c) => types[c] === 'number' && /revenue/i.test(c)) ||
    'Total_Revenue';

  return (
    `\`\`\`mongodb\n` +
    `{"collection":"${collName}","pipeline":[` +
    `{"$match":{"${stateField}":{"$regex":"Gujarat","$options":"i"}}},` +
    `{"$group":{"_id":null,"total":{"$sum":"$${revenueField}"}}}` +
    `]}\n\`\`\``
  );
}

export function buildMongoQueryRules(provider: 'claude' | 'gemini'): string {
  const strict =
    provider === 'gemini'
      ? `
**GEMINI-SPECIFIC (MANDATORY):**
- Copy column names EXACTLY from the schema blocks below — never invent \`State\`, \`Revenue\`, or \`Total Revenue\` unless listed.
- NEVER use \`$split\`, \`$arrayElemAt\` on \`col_*\`, or CSV parsing — data is already columnar.
- Use ONLY: \`$match\`, \`$group\`, \`$project\`, \`$sort\`, \`$limit\`, \`$addFields\`, \`$count\`.
- Output exactly ONE \`\`\`mongodb block with valid JSON: \`"collection"\` + \`"pipeline"\` array.
- If unsure of field names, Phase 1 may use \`{"$limit":1}\` on the target collection only, then Phase 2 uses real fields.
`
      : '';

  return (
    `**MONGODB PIPELINE RULES (BINDING):**` +
    strict +
    `
- NEVER use \`$split\` — numeric and text fields are already typed columns.
- For state/region filters: use columns listed under Geography (e.g. \`StateName\` for Gujarat).
- For totals: \`$sum\` only on columns marked \`(number)\` in the schema.
- Do NOT query collections unrelated to the user question.
- Phase 1: ONE \`\`\`mongodb block only — no analysis text or numbers.
`
  );
}

export function buildMongoRepairPrompt(opts: {
  error: string;
  collection?: string;
  failedPipeline?: unknown;
  tableSchemas: Record<string, CollectionSchema>;
  sqlTables: string[];
  contract: 'mongodb' | 'sql';
}): string {
  const { error, collection, failedPipeline, tableSchemas, sqlTables, contract } = opts;
  let schemaBlock = '';
  if (collection && tableSchemas[collection]) {
    const s = tableSchemas[collection];
    schemaBlock = formatCollectionSchemaBlock(
      {
        name: s.fileName,
        collectionName: collection,
        headers: s.columns,
        columnTypes: s.columnTypes,
        rowCount: s.rowCount,
        isCsv: true,
      },
      tableSchemas
    );
  } else {
    schemaBlock = sqlTables
      .slice(0, 6)
      .map((c) => {
        const s = tableSchemas[c];
        if (!s) return `- \`${c}\``;
        return formatCollectionSchemaBlock(
          { name: s.fileName, collectionName: c, headers: s.columns, columnTypes: s.columnTypes, isCsv: true },
          tableSchemas
        );
      })
      .join('\n');
  }

  const pipelineSnippet = failedPipeline
    ? `\nFailed pipeline: \`${JSON.stringify(failedPipeline).slice(0, 800)}\`\n`
    : '';

  return (
    `The data query failed.\n` +
    `**Error:** ${error}\n` +
    pipelineSnippet +
    `\n**Allowed collections:** ${sqlTables.join(', ') || 'none'}\n\n` +
    `**Schema for correction:**\n${schemaBlock}\n\n` +
    `Generate ONE corrected \`\`\`${contract} block using EXACT column names from the schema. ` +
    `Do NOT use $split. For revenue by state use StateName if listed.`
  );
}

export function formatAccessibleSourcesList(
  accessibleTableNames: string[],
  accessibleSchemas: Record<string, CollectionSchema>
): string {
  return accessibleTableNames
    .map((collName) => {
      const schema = accessibleSchemas[collName];
      if (!schema || schema.rowCount <= 0) return null;
      const businessName = schema.fileName.replace(/\.csv$/i, '').replace(/_/g, ' ');
      const typedCols = schema.columns
        .slice(0, 14)
        .map((c) => {
          const t = schema.columnTypes?.[c] || 'string';
          return `${c} (${t})`;
        })
        .join(', ');
      return `- **${businessName}** → \`${collName}\` | ${schema.rowCount.toLocaleString()} rows | ${typedCols}${schema.columns.length > 14 ? '…' : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}
