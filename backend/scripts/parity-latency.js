/**
 * Parity + latency gate script (Phase 6).
 * Usage: node scripts/parity-latency.js [--engine mongo|sql|both]
 * Requires MONGODB_URI and populated csvFiles / data collections.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { executeDuckDBQuery } from '../lib/duckdb-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'indira-gpt';
const LARGE_TABLES = ['data_21_revenue', 'data_17_footfall'];

function pctl(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function timeMongo(db, collectionName, pipeline) {
  const start = Date.now();
  await db.collection(collectionName).aggregate(pipeline, { allowDiskUse: true }).toArray();
  return Date.now() - start;
}

async function timeSql(tableName, sql) {
  const start = Date.now();
  await executeDuckDBQuery(tableName, sql, 10000);
  return Date.now() - start;
}

async function main() {
  const mode = process.argv.includes('--engine')
    ? process.argv[process.argv.indexOf('--engine') + 1]
    : 'both';

  if (!MONGODB_URI) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const files = await db.collection('csvFiles').find({ isActive: true }).limit(5).toArray();
  console.log(`Testing ${files.length} active files (mode=${mode})`);

  const mongoTimes = [];
  const sqlTimes = [];

  for (const table of LARGE_TABLES) {
  const fileDoc = files.find((f) => (f.dataCollection || '').includes(table.replace('data_', ''))) ||
      (await db.collection('csvFiles').findOne({ dataCollection: table }));

    if (!fileDoc) {
      console.warn(`Skip ${table}: no csvFiles record`);
      continue;
    }

    const coll = fileDoc.dataCollection || table;
    const metric = (fileDoc.columns || []).find((c) => /revenue|total|amount/i.test(c)) || fileDoc.columns?.[0];
    if (!metric) continue;

    const mongoPipeline = [{ $group: { _id: null, total: { $sum: `$${metric}` } } }];
    const sql = `SELECT SUM("${metric}") AS total FROM ${coll}`;

    if (mode === 'mongo' || mode === 'both') {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await timeMongo(db, coll, mongoPipeline));
      mongoTimes.push(...runs);
      console.log(`Mongo ${coll}: ${runs.map((r) => `${r}ms`).join(', ')}`);
    }
    if (mode === 'sql' || mode === 'both') {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await timeSql(coll, sql));
      sqlTimes.push(...runs);
      console.log(`SQL  ${coll}: ${runs.map((r) => `${r}ms`).join(', ')}`);
    }
  }

  if (mongoTimes.length) {
    console.log(`Mongo p50=${pctl(mongoTimes, 50)}ms p95=${pctl(mongoTimes, 95)}ms`);
  }
  if (sqlTimes.length) {
    console.log(`SQL  p50=${pctl(sqlTimes, 50)}ms p95=${pctl(sqlTimes, 95)}ms`);
  }
  if (mongoTimes.length && sqlTimes.length) {
    const pass = pctl(sqlTimes, 95) <= pctl(mongoTimes, 95);
    console.log(pass ? '✅ Latency gate PASS (SQL p95 <= Mongo p95)' : '❌ Latency gate FAIL');
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
