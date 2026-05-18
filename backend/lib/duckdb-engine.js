import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DuckDBInstance } from '@duckdb/node-api';
import { validateSql, applySqlRowCap } from './validate-sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'indira.duckdb');
const CSV_CACHE_DIR = path.join(DATA_DIR, 'csv-cache');

let instancePromise = null;

function escapePath(p) {
  return p.replace(/\\/g, '/').replace(/'/g, "''");
}

function quoteIdent(name) {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function getInstance() {
  if (!instancePromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(CSV_CACHE_DIR, { recursive: true });
    instancePromise = DuckDBInstance.fromCache(DB_PATH);
  }
  return instancePromise;
}

/**
 * Load CSV into persisted DuckDB table (original headers preserved).
 * @param {string} tableName — from getCollectionName(fileName)
 * @param {string} csvContent — raw CSV text
 * @returns {{ sqlColumns: { name: string, type: string }[], rowCount: number }}
 */
export async function ingestCsvIntoDuckDB(tableName, csvContent) {
  const cachePath = path.join(CSV_CACHE_DIR, `${tableName}.csv`);
  fs.writeFileSync(cachePath, csvContent, 'utf8');
  const escaped = escapePath(cachePath);

  const instance = await getInstance();
  const conn = await instance.connect();

  const qTable = quoteIdent(tableName);
  await conn.run(`DROP TABLE IF EXISTS ${qTable}`);
  await conn.run(
    `CREATE TABLE ${qTable} AS SELECT * FROM read_csv_auto('${escaped}', header=true, ignore_errors=true)`
  );

  const countReader = await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS cnt FROM ${qTable}`);
  const countRows = countReader.getRowObjectsJson();
  const rowCount = Number(countRows[0]?.cnt ?? 0);

  const descReader = await conn.runAndReadAll(`DESCRIBE SELECT * FROM ${qTable}`);
  const descRows = descReader.getRowObjectsJson();
  const sqlColumns = descRows.map((r) => ({
    name: String(r.column_name ?? r.Column ?? r.name ?? ''),
    type: String(r.column_type ?? r.Type ?? r.type ?? 'VARCHAR'),
  })).filter((c) => c.name);

  conn.closeSync();
  return { sqlColumns, rowCount };
}

/**
 * @param {string} tableName
 * @param {string} sql — model SELECT (FROM must reference tableName)
 * @param {number} maxRows
 */
export async function executeDuckDBQuery(tableName, sql, maxRows = 10000) {
  const validated = validateSql(sql);
  const capped = applySqlRowCap(validated, maxRows);

  const instance = await getInstance();
  const conn = await instance.connect();
  const qTable = quoteIdent(tableName);

  const start = Date.now();
  const reader = await conn.runAndReadAll(capped);
  const rows = reader.getRowObjectsJson();
  const queryTime = Date.now() - start;

  conn.closeSync();

  const limited = rows.slice(0, maxRows);
  return {
    data: limited,
    rowCount: limited.length,
    totalRows: rows.length,
    truncated: rows.length > maxRows,
    columns: limited.length > 0 ? Object.keys(limited[0]) : [],
    queryTime: `${queryTime}ms`,
  };
}

/** Introspect persisted table — for schema endpoint / Phase 5 assert. */
export async function describeDuckDBTable(tableName) {
  const instance = await getInstance();
  const conn = await instance.connect();
  const qTable = quoteIdent(tableName);
  try {
    const descReader = await conn.runAndReadAll(`DESCRIBE SELECT * FROM ${qTable}`);
    const descRows = descReader.getRowObjectsJson();
    return descRows.map((r) => ({
      name: String(r.column_name ?? r.Column ?? r.name ?? ''),
      type: String(r.column_type ?? r.Type ?? r.type ?? 'VARCHAR'),
    })).filter((c) => c.name);
  } catch (e) {
    return null;
  } finally {
    conn.closeSync();
  }
}

export function getDuckDBPath() {
  return DB_PATH;
}

/** Remove persisted table when an admin deletes a CSV from the knowledge base. */
export async function dropDuckDBTable(tableName) {
  if (!tableName) return;
  const instance = await getInstance();
  const conn = await instance.connect();
  const qTable = quoteIdent(tableName);
  try {
    await conn.run(`DROP TABLE IF EXISTS ${qTable}`);
  } finally {
    conn.closeSync();
  }
  const cachePath = path.join(CSV_CACHE_DIR, `${tableName}.csv`);
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch {
    /* best-effort */
  }
}
