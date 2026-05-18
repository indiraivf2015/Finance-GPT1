import NodeSQLParser from 'node-sql-parser';

const BLOCKED_WORDS = [
  'ATTACH', 'COPY', 'INSTALL', 'LOAD', 'PRAGMA', 'EXPORT', 'IMPORT', 'CALL', 'SET',
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
];

const BLOCKED_FUNCTIONS = [
  'read_csv', 'read_csv_auto', 'read_parquet', 'read_json', 'glob', 'parquet_scan',
];

const parser = new NodeSQLParser.Parser();

function stripTrailingSemicolon(sql) {
  let s = sql.trim();
  if (s.endsWith(';')) {
    s = s.slice(0, -1).trim();
  }
  if (s.includes(';')) {
    throw new Error('Only a single SQL statement is allowed (no statement chaining)');
  }
  return s;
}

function assertBlockedTokens(sql) {
  const upper = sql.toUpperCase();
  for (const word of BLOCKED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(sql)) {
      throw new Error(`Blocked SQL keyword not allowed: ${word}`);
    }
  }
  for (const fn of BLOCKED_FUNCTIONS) {
    if (upper.includes(fn.toUpperCase())) {
      throw new Error(`Blocked function not allowed: ${fn}`);
    }
  }
}

function assertSelectAst(ast) {
  if (!ast || ast.type !== 'select') {
    throw new Error('Only SELECT or WITH … SELECT statements are allowed');
  }
}

/**
 * @param {string} rawSql
 * @returns {string} normalized SQL
 */
export function validateSql(rawSql) {
  if (!rawSql || typeof rawSql !== 'string' || !rawSql.trim()) {
    throw new Error('SQL query is required');
  }

  let sql = stripTrailingSemicolon(rawSql);
  assertBlockedTokens(sql);

  let ast;
  try {
    ast = parser.astify(sql, { database: 'postgresql' });
  } catch (e) {
    throw new Error(`SQL parse error: ${e.message}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new Error('Only a single SQL statement is allowed');
  }

  const stmt = statements[0];
  if (stmt.type === 'select') {
    assertSelectAst(stmt);
  } else if (stmt.type === 'with') {
    // WITH … SELECT
    if (!stmt.stmt || stmt.stmt.type !== 'select') {
      throw new Error('WITH clause must terminate in a SELECT');
    }
  } else {
    throw new Error(`Statement type not allowed: ${stmt.type}`);
  }

  return sql;
}

/**
 * Enforce server-side row cap.
 * @param {string} sql
 * @param {number} maxRows
 */
export function applySqlRowCap(sql, maxRows = 10000) {
  const normalized = sql.trim().replace(/;\s*$/, '');
  const limitRe = /\bLIMIT\s+\d+\s*$/i;
  if (limitRe.test(normalized)) {
    const m = normalized.match(/\bLIMIT\s+(\d+)\s*$/i);
    const n = parseInt(m[1], 10);
    if (n > maxRows) {
      return normalized.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
    }
    return normalized;
  }
  return `${normalized} LIMIT ${maxRows}`;
}
