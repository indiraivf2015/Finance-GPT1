// Simple Node.js server to inject runtime environment variables
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MongoClient, GridFSBucket, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { renderArtifact, sweepGeneratedDir } from './artifacts/index.js';
import { getCachedUser, invalidateUserCache } from './lib/user-cache.js';
import {
  buildDataCollectionIndexes,
  inferColumnTypesFromRecords,
  sampleRowsFromRecords,
} from './lib/data-indexes.js';
import { validateSql } from './lib/validate-sql.js';
import { ingestCsvIntoDuckDB, executeDuckDBQuery, describeDuckDBTable, dropDuckDBTable } from './lib/duckdb-engine.js';
import { validateProductionEnv, getAllowedOrigins, isProduction } from './lib/env.js';
import {
  getGeminiClient,
  getGeminiModel,
  completeGeminiChat,
  streamGeminiChat,
} from './lib/gemini-chat.js';
import {
  validatePipelineWithSchema,
  buildSchemaHintForCollection,
} from './lib/pipeline-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.join(__dirname, '.env') });
validateProductionEnv();

const app = express();
const PORT = process.env.PORT || 5005;

if (isProduction()) {
  app.set('trust proxy', 1);
}

// MongoDB connection
// Format: mongodb+srv://username:password@cluster.mongodb.net/database
// If password contains special characters, URL encode them
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'indira-gpt';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ANTHROPIC_MODEL_DEFAULT = 'claude-sonnet-4-20250514';
const ANTHROPIC_MODEL_QUERY_DEFAULT = 'claude-haiku-4-5-20251001';
const ANTHROPIC_MODEL_ANSWER_DEFAULT = 'claude-sonnet-4-20250514';
const DATA_ENGINE = (process.env.DATA_ENGINE || 'mongo').toLowerCase() === 'sql' ? 'sql' : 'mongo';

function resolveAnthropicModel(phase) {
  const legacy = process.env.ANTHROPIC_MODEL;
  if (phase === 1 || phase === 'query') {
    return (
      process.env.ANTHROPIC_MODEL_QUERY ||
      legacy ||
      ANTHROPIC_MODEL_QUERY_DEFAULT
    );
  }
  if (phase === 2 || phase === 'answer') {
    return (
      process.env.ANTHROPIC_MODEL_ANSWER ||
      legacy ||
      ANTHROPIC_MODEL_ANSWER_DEFAULT
    );
  }
  return legacy || ANTHROPIC_MODEL_DEFAULT;
}

function getAnthropicClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

/** Validate Claude Messages API shape: non-empty, strict user/assistant alternation, starts with user */
function normalizeAnthropicMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    out.push({ role: m.role, content });
  }
  if (out.length === 0) return null;
  if (out[0].role !== 'user') return null;
  for (let k = 1; k < out.length; k++) {
    if (out[k].role === out[k - 1].role) return null;
  }
  return out;
}

// Debug: Log environment variable loading
if (process.env.NODE_ENV !== 'production') {
  console.log('\n📋 Environment variables check:');
  console.log(`   MONGODB_URI: ${MONGODB_URI ? '✅ Loaded' : '❌ Not found in .env'}`);
  console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Loaded' : '⚠️  Using default'}`);
  console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ Not found'}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Loaded' : '❌ Not found'}`);
  console.log(`   ANTHROPIC_MODEL: ${process.env.ANTHROPIC_MODEL || ANTHROPIC_MODEL_DEFAULT} (default if unset)`);
  console.log(`   GEMINI_MODEL: ${getGeminiModel()}`);
  if (!MONGODB_URI) {
    console.log('\n⚠️  MONGODB_URI not found in .env file!');
    console.log('   Make sure your .env file contains:');
    console.log('   MONGODB_URI=mongodb+srv://indiragenai:YOUR_PASSWORD@cluster1.zbw5eso.mongodb.net/indira-gpt');
  }
}

let db = null;
let client = null;

// Connect to MongoDB
async function connectDB() {
  try {
    // Check if MONGODB_URI is set
    if (!MONGODB_URI) {
      if (process.env.NODE_ENV === 'production') {
        // In production, environment variables should be set in App Runner
        console.warn('\n⚠️  MONGODB_URI not set. Make sure it is configured in App Runner environment variables.');
        console.warn('   The application will continue but database features will not work.');
        return; // Don't exit, just skip connection
      } else {
        // In development, show helpful error
        console.error('\n❌ MONGODB_URI not set in .env file!');
        console.error('   Please add MONGODB_URI to your .env file:');
        console.error('   MONGODB_URI=mongodb+srv://indiragenai:YOUR_PASSWORD@cluster1.zbw5eso.mongodb.net/indira-gpt');
        console.error('   Replace YOUR_PASSWORD with your actual MongoDB password');
        console.error('   If password has special characters, URL encode them (e.g., @ becomes %40)');
        // In development, we can exit to force fixing the issue
        return;
      }
    }
    
    if (MONGODB_URI.includes('<db_password>') || MONGODB_URI.includes('<password>')) {
      console.error('\n❌ MONGODB_URI contains placeholder!');
      console.error('   Please replace <db_password> with your actual MongoDB password');
      console.error('   Current value:', MONGODB_URI.replace(/:[^@]+@/, ':***@'));
      return;
    }
    
    // Construct connection string - if MONGODB_URI doesn't include database, append it
    let connectionString = MONGODB_URI;
    if (!connectionString.includes('/indira-gpt') && !connectionString.includes('?')) {
      connectionString = connectionString.replace(/\/$/, '') + `/${DB_NAME}?retryWrites=true&w=majority`;
    } else if (!connectionString.includes('retryWrites')) {
      connectionString += (connectionString.includes('?') ? '&' : '?') + 'retryWrites=true&w=majority';
    }
    
    // Log connection attempt (without password)
    const maskedUri = connectionString.replace(/mongodb\+srv:\/\/([^:]+):([^@]+)@/, 'mongodb+srv://$1:***@');
    console.log('🔄 Attempting to connect to MongoDB...');
    console.log(`   Connection string: ${maskedUri}`);
    
    client = new MongoClient(connectionString);
    await client.connect();
    db = client.db(DB_NAME);
    const dbHost = (() => {
      try {
        const u = new URL(connectionString.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
        return u.hostname || 'configured host';
      } catch {
        return 'configured host';
      }
    })();
    console.log(`✅ Connected to MongoDB (${dbHost})`);
    
    // Create indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    
    // Create default admin user if it doesn't exist
    const adminExists = await db.collection('users').findOne({ email: 'admin@indira.com' });
    if (!adminExists) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      await db.collection('users').insertOne({
        email: 'admin@indira.com',
        passwordHash: adminPassword,
        role: 'admin',
        createdAt: new Date(),
        lastLogin: null,
        mustChangePassword: true
      });
      console.log('✅ Default admin user created: admin@indira.com / admin123');
      console.log('⚠️  Please change the default admin password after first login!');
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    // Provide specific error messages
    if (error.message.includes('authentication failed') || error.message.includes('bad auth')) {
      console.error('   🔐 Authentication failed - possible issues:');
      console.error('   1. Wrong password in MONGODB_URI');
      console.error('   2. Password contains special characters that need URL encoding');
      console.error('      Special characters: @ # $ % & + = ? / : ; , < >');
      console.error('      Example: If password is "p@ss#word", use "p%40ss%23word"');
      console.error('   3. Wrong username in MONGODB_URI');
      console.error('   4. Database user doesn\'t exist in MongoDB Atlas');
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      console.error('   🌐 Network error - check:');
      console.error('   1. Internet connection');
      console.error('   2. MongoDB Atlas cluster is running');
      console.error('   3. Network access in MongoDB Atlas allows your IP');
    } else {
      console.error('   Make sure MONGODB_URI environment variable is set correctly');
      console.error('   Format: mongodb+srv://username:password@cluster.mongodb.net/database');
    }
    // Don't exit - app can still serve static files
  }
}

connectDB();

// Production security headers (when behind nginx)
if (isProduction()) {
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
}

// Middleware
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// NOTE: Global error handler is intentionally placed AFTER all routes (see bottom of file)

// Multer configuration for file uploads
// Accepts CSV plus modern (.xlsx) and legacy (.xls) Excel workbooks. Excel
// uploads land in the same handler and are split into one collection per sheet
// (Phase E). 500 MB cap unchanged.
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers report this for .xlsx
]);
function hasExcelExtension(name) {
  return /\.(xlsx|xls)$/i.test(String(name || ''));
}
const upload = multer({ 
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const isCsv = file.mimetype === 'text/csv' || /\.csv$/i.test(file.originalname);
    const isXlsx = hasExcelExtension(file.originalname) || XLSX_MIMES.has(file.mimetype);
    if (isCsv || isXlsx) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or Excel (.xlsx, .xls) files are allowed'));
    }
  }
});

// CORS — restrict in production when ALLOWED_ORIGINS is set; permissive in dev
const allowedOrigins = getAllowedOrigins();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isProduction() && allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
  } else if (!isProduction()) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(allowedOrigins.length > 0 && isProduction() && origin && !allowedOrigins.includes(origin) ? 403 : 200);
  }
  next();
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        console.error('JWT verification error:', err.message);
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = user;
      if (!isProduction()) {
        console.log('✅ User authenticated:', { email: user.email, role: user.role });
      }
      next();
    });
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ error: 'Authentication error', message: error.message });
  }
};

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      console.error('❌ requireAdmin: req.user is undefined');
      return res.status(401).json({ error: 'User not authenticated' });
    }
    if (req.user.role !== 'admin') {
      console.error('❌ requireAdmin: User is not admin:', req.user.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    console.log('✅ Admin access granted:', req.user.email);
    next();
  } catch (error) {
    console.error('requireAdmin middleware error:', error);
    res.status(500).json({ error: 'Internal server error in authentication', message: error.message });
  }
};

// ============================================
// MongoDB-Native Data Query Functions
// ============================================

function getCollectionName(fileName) {
  return 'data_' + fileName
    .replace(/\.csv$/i, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function fileUnavailableMessage(fileName) {
  return `The data file "${fileName}" is not available. It may have been deleted by an administrator.`;
}

async function deleteGridFSByFilename(fileName) {
  const bucket = new GridFSBucket(db, { bucketName: 'csvFiles' });
  let gridFile = await db.collection('csvFiles.files').findOne({ filename: fileName });
  while (gridFile) {
    await bucket.delete(gridFile._id);
    console.log(`✓ Deleted GridFS entry: ${fileName}`);
    gridFile = await db.collection('csvFiles.files').findOne({ filename: fileName });
  }
}

/**
 * Soft-delete csvFiles metadata, drop parsed collection, remove GridFS blob, scrub user access.
 */
async function deleteStoredCsvFile(fileName, deletedBy) {
  const records = await db.collection('csvFiles').find({ fileName }).toArray();
  if (records.length === 0) {
    return { found: false };
  }

  const collectionNames = new Set();
  for (const rec of records) {
    collectionNames.add(rec.dataCollection || getCollectionName(fileName));
  }

  for (const collectionName of collectionNames) {
    try {
      await db.collection(collectionName).drop();
      console.log(`✓ Dropped data collection: ${collectionName}`);
    } catch (e) {
      console.warn(`⚠️ Could not drop collection ${collectionName}:`, e.message);
    }
    try {
      await dropDuckDBTable(collectionName);
    } catch (e) {
      console.warn(`⚠️ DuckDB drop failed for ${collectionName}:`, e.message);
    }
  }

  const needsGridFS = records.some((r) => r.storedInGridFS);
  if (needsGridFS) {
    try {
      await deleteGridFSByFilename(fileName);
    } catch (e) {
      console.warn(`⚠️ GridFS delete failed for ${fileName}:`, e.message);
    }
  }

  await db.collection('csvFiles').updateMany(
    { fileName },
    {
      $set: {
        isActive: false,
        deletedAt: new Date(),
        deletedBy: deletedBy || 'admin',
      },
    }
  );

  await db.collection('users').updateMany(
    { accessibleFiles: fileName },
    { $pull: { accessibleFiles: fileName } }
  );
  invalidateUserCache();

  return { found: true, collectionNames: [...collectionNames] };
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const s = val instanceof Date ? val.toISOString() : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsvContent(rows) {
  if (!rows?.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return lines.join('\n');
}

// Strip a leading currency token (₹, Rs., Rs, INR, $) before numeric detection.
// Case-insensitive; tolerant of an optional trailing space. Returns the cleaned
// remainder or the original string if no prefix matched.
function stripCurrencyPrefix(s) {
  return s
    .replace(/^\s*₹\s*/, '')
    .replace(/^\s*Rs\.?\s*/i, '')
    .replace(/^\s*INR\s*/i, '')
    .replace(/^\s*\$\s*/, '');
}

function cleanCSVValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    // Trailing-percent values stay as strings — we will not silently coerce
    // "12.5%" to 12.5 because that hides whether downstream code expects 0.125.
    if (/%\s*$/.test(trimmed)) return trimmed;

    // Detect accounting-negative parentheses: "(1,234)" or "(1,234.56)" (with
    // optional currency token inside the parens). Also handles plain "(123)".
    const accountingMatch = trimmed.match(/^\(\s*(.+?)\s*\)$/);
    if (accountingMatch) {
      const inner = stripCurrencyPrefix(accountingMatch[1].trim());
      if (/^[\d,]+\.?\d*$/.test(inner)) {
        const num = parseFloat(inner.replace(/,/g, ''));
        if (!isNaN(num)) return -num;
      }
    }

    // Strip leading currency tokens (₹ / Rs. / Rs / INR / $) and re-test
    const stripped = stripCurrencyPrefix(trimmed);

    // Detect comma-formatted numbers like "8,144,550" or Indian-grouped "12,34,567"
    if (/^-?[\d,]+\.?\d*$/.test(stripped) && stripped.includes(',')) {
      const num = parseFloat(stripped.replace(/,/g, ''));
      if (!isNaN(num)) return num;
    }
    // Detect plain numbers
    if (/^-?\d+\.?\d*$/.test(stripped)) {
      const num = parseFloat(stripped);
      if (!isNaN(num)) return num;
    }
    return trimmed;
  }
  return value;
}

async function parseAndStoreCSVInMongo(fileName, content) {
  const collectionName = getCollectionName(fileName);
  
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true
  });
  
  if (!records || records.length === 0) {
    throw new Error(`No data found in CSV file ${fileName}`);
  }
  
  // Clean all values (handle comma-formatted numbers, cast types)
  // Also sanitize MongoDB field names: MongoDB forbids keys containing '.' or starting with '$'
  const cleanedRecords = records.map(row => {
    const cleaned = {};
    for (const [key, value] of Object.entries(row)) {
      const cleanKey = key.trim()
        .replace(/\./g, '_')           // dots → underscore (e.g. "Q1.2025" → "Q1_2025")
        .replace(/^\$/, '_')           // leading $ → _ (e.g. "$Revenue" → "_Revenue")
        .replace(/\$/g, '')            // remaining $ removed (e.g. "Revenue ($)" → "Revenue ()")
        .replace(/[()[\]{}/\\#%]/g, '') // remove other special chars common in financial headers
        .replace(/\s+/g, '_')          // spaces → underscore
        .replace(/_+/g, '_')           // collapse multiple underscores
        .replace(/^_|_$/g, '')         // trim leading/trailing underscores
        || `col_${Object.keys(cleaned).length}`; // fallback if key becomes empty
      cleaned[cleanKey] = cleanCSVValue(value);
    }
    return cleaned;
  });
  
  // Drop existing collection and insert fresh data
  try {
    await db.collection(collectionName).drop();
    console.log(`✓ Dropped existing collection: ${collectionName}`);
  } catch (e) {
    // Collection doesn't exist yet — that's fine
  }
  
  const col = db.collection(collectionName);
  await col.insertMany(cleanedRecords);
  console.log(`✓ Stored ${cleanedRecords.length} documents in collection: ${collectionName}`);

  await buildDataCollectionIndexes(col, cleanedRecords, Object.keys(cleanedRecords[0] || {}));
  
  const headers = Object.keys(cleanedRecords[0] || {});
  const columnTypes = inferColumnTypesFromRecords(cleanedRecords, headers);
  const sampleRows = sampleRowsFromRecords(cleanedRecords, 3);

  let sqlColumns = [];
  let sqlRowCount = cleanedRecords.length;
  try {
    const duck = await ingestCsvIntoDuckDB(collectionName, content);
    sqlColumns = duck.sqlColumns;
    sqlRowCount = duck.rowCount;
    console.log(`✓ DuckDB table ${collectionName}: ${sqlRowCount} rows, ${sqlColumns.length} columns`);
  } catch (duckErr) {
    console.warn(`⚠️ DuckDB ingest failed for ${fileName}: ${duckErr.message}`);
  }

  // ----------------------------------------------------------------------
  // Per-column type-inference summary. Lets the system instruction warn the
  // model when a column the user is likely to sum did not parse as numeric.
  //   numeric     : every non-null value in the sample is a number
  //   text        : zero non-null numeric values
  //   mixed       : both numeric and string non-null values appear
  //   coercedPct  : share of non-null values successfully coerced to numbers
  // We sample up to 1000 rows for speed (and to keep this fast on huge CSVs).
  // ----------------------------------------------------------------------
  const SAMPLE_SIZE = Math.min(cleanedRecords.length, 1000);
  const parseQuality = headers.map(col => {
    let total = 0, numeric = 0, text = 0;
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const v = cleanedRecords[i][col];
      if (v === null || v === undefined || v === '') continue;
      total++;
      if (typeof v === 'number' && Number.isFinite(v)) numeric++;
      else if (typeof v === 'string') text++;
    }
    let inferred = 'text';
    if (total === 0) inferred = 'text';
    else if (numeric === total) inferred = 'numeric';
    else if (numeric > 0 && text > 0) inferred = 'mixed';
    else if (numeric === 0) inferred = 'text';
    const coercedPct = total === 0 ? 0 : Math.round((numeric / total) * 1000) / 10; // one decimal
    return { column: col, inferred, coercedPct };
  });

  return {
    collectionName,
    headers,
    rowCount: cleanedRecords.length,
    parseQuality,
    columnTypes,
    sampleRows,
    sqlColumns,
    sqlRowCount,
  };
}

// ----------------------------------------------------------------------
// Excel ingestion (Phase E). Reads an .xlsx/.xls workbook with SheetJS and
// emits one MongoDB collection per sheet. Each sheet is registered as its
// own csvFiles record so RBAC, /api/data/schemas, and the system-instruction
// collection list pick it up with zero further change. Cell values pass
// through cleanCSVValue, so currency / accounting-negative / Indian-grouped
// numerics behave identically to CSV.
// ----------------------------------------------------------------------
function sanitizeSheetName(name) {
  return String(name || 'sheet').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'sheet';
}
function buildSheetFileName(originalBase, sheetName) {
  const safeSheet = String(sheetName).replace(/[\\/\*\?\:\[\]]/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'Sheet';
  return `${originalBase}__${safeSheet}.xlsx`;
}

async function parseAndStoreXLSXInMongo(originalFileName, filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: false, cellText: false });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error(`No sheets found in workbook ${originalFileName}`);
  }

  const originalBase = originalFileName.replace(/\.(xlsx|xls)$/i, '');
  const sheetsResult = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Convert sheet to array-of-objects keyed by header row. Use defval:'' so
    // missing cells become '' (then cleanCSVValue → null) rather than undefined.
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, blankrows: false });
    if (!rows || rows.length === 0) {
      console.warn(`⚠️ Sheet "${sheetName}" in ${originalFileName} is empty; skipping.`);
      continue;
    }

    // Sanitize headers (same rules as CSV parser) and clean cell values.
    const cleanedRecords = rows.map(row => {
      const cleaned = {};
      for (const [key, value] of Object.entries(row)) {
        const cleanKey = String(key).trim()
          .replace(/\./g, '_')
          .replace(/^\$/, '_')
          .replace(/\$/g, '')
          .replace(/[()[\]{}/\\#%]/g, '')
          .replace(/\s+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '')
          || `col_${Object.keys(cleaned).length}`;
        // SheetJS hands us Date objects when cellDates: true; keep them as
        // ISO strings for downstream consistency with CSV parsing.
        if (value instanceof Date) {
          cleaned[cleanKey] = value.toISOString();
        } else {
          cleaned[cleanKey] = cleanCSVValue(value);
        }
      }
      return cleaned;
    });

    const sheetFileName = buildSheetFileName(originalBase, sheetName);
    const collectionName = getCollectionName(sheetFileName);

    try {
      await db.collection(collectionName).drop();
      console.log(`✓ Dropped existing collection: ${collectionName}`);
    } catch (_e) { /* didn't exist — fine */ }

    const col = db.collection(collectionName);
    await col.insertMany(cleanedRecords);
    console.log(`✓ Stored ${cleanedRecords.length} rows from sheet "${sheetName}" → ${collectionName}`);

    const headers = Object.keys(cleanedRecords[0] || {});
    await buildDataCollectionIndexes(col, cleanedRecords, headers);
    const columnTypes = inferColumnTypesFromRecords(cleanedRecords, headers);
    const sampleRows = sampleRowsFromRecords(cleanedRecords, 3);

    let sqlColumns = [];
    let sqlRowCount = cleanedRecords.length;
    try {
      const rawCsv = rowsToCsvContent(rows);
      const duck = await ingestCsvIntoDuckDB(collectionName, rawCsv);
      sqlColumns = duck.sqlColumns;
      sqlRowCount = duck.rowCount;
    } catch (duckErr) {
      console.warn(`⚠️ DuckDB ingest failed for sheet ${sheetFileName}: ${duckErr.message}`);
    }

    // Per-sheet parseQuality (same logic as parseAndStoreCSVInMongo)
    const SAMPLE_SIZE = Math.min(cleanedRecords.length, 1000);
    const parseQuality = headers.map(col => {
      let total = 0, numeric = 0, text = 0;
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const v = cleanedRecords[i][col];
        if (v === null || v === undefined || v === '') continue;
        total++;
        if (typeof v === 'number' && Number.isFinite(v)) numeric++;
        else if (typeof v === 'string') text++;
      }
      let inferred = 'text';
      if (total === 0) inferred = 'text';
      else if (numeric === total) inferred = 'numeric';
      else if (numeric > 0 && text > 0) inferred = 'mixed';
      const coercedPct = total === 0 ? 0 : Math.round((numeric / total) * 1000) / 10;
      return { column: col, inferred, coercedPct };
    });

    sheetsResult.push({
      sheetName,
      fileName: sheetFileName,
      collectionName,
      columns: headers,
      rowCount: cleanedRecords.length,
      parseQuality,
      columnTypes,
      sampleRows,
      sqlColumns,
      sqlRowCount,
    });
  }

  if (sheetsResult.length === 0) {
    throw new Error(`Workbook ${originalFileName} produced no usable sheets`);
  }
  return sheetsResult;
}

/** @deprecated — use validatePipelineWithSchema from pipeline-validator.js */
function validatePipeline(pipeline) {
  return validatePipelineWithSchema(pipeline, {});
}

function schemaColumnsForEngine(fileDoc) {
  const useSql =
    DATA_ENGINE === 'sql' &&
    Array.isArray(fileDoc.sqlColumns) &&
    fileDoc.sqlColumns.length > 0;
  if (useSql) {
    return {
      columns: fileDoc.sqlColumns.map((c) => c.name),
      columnTypes: Object.fromEntries(
        fileDoc.sqlColumns.map((c) => [c.name, c.type || 'VARCHAR'])
      ),
    };
  }
  return {
    columns: fileDoc.columns || [],
    columnTypes: fileDoc.columnTypes || {},
  };
}

function buildSchemaFromFileDoc(fileDoc) {
  const collectionName = fileDoc.dataCollection || getCollectionName(fileDoc.fileName);
  const { columns, columnTypes } = schemaColumnsForEngine(fileDoc);
  return {
    fileName: fileDoc.fileName,
    collectionName,
    columns,
    columnTypes,
    rowCount: fileDoc.rowCount ?? 0,
    parseQuality: Array.isArray(fileDoc.parseQuality) ? fileDoc.parseQuality : [],
    sample: Array.isArray(fileDoc.sampleRows) ? fileDoc.sampleRows : [],
    dataEngine: DATA_ENGINE,
  };
}

async function assertSqlColumnParity(fileDoc) {
  if (DATA_ENGINE !== 'sql') return;
  const tableName = fileDoc.dataCollection || getCollectionName(fileDoc.fileName);
  const live = await describeDuckDBTable(tableName);
  if (!live || live.length === 0) return;
  const persisted = (fileDoc.sqlColumns || []).map((c) => c.name);
  const liveNames = live.map((c) => c.name);
  if (persisted.length && persisted.join('\0') !== liveNames.join('\0')) {
    throw new Error(
      `SQL column identifier mismatch for ${fileDoc.fileName}: metadata does not match DuckDB DESCRIBE`
    );
  }
}

// CRITICAL: Inject environment variables into index.html BEFORE serving static files
// This ensures the API key is injected for all HTML requests
// Only serve static files if dist folder exists (production mode)
const distExists = fs.existsSync(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));

if (distExists) {
  app.get('/', (req, res) => {
    injectApiKeyAndServe(req, res);
  });

  app.get('/index.html', (req, res) => {
    injectApiKeyAndServe(req, res);
  });
} else {
  // Dev mode - just return a message for root route
  app.get('/', (req, res) => {
    res.json({ 
      message: 'Express API server running in dev mode',
      note: 'Frontend is served by Vite on port 3000',
      api: 'API endpoints available at /api/*'
    });
  });
}

// Function to inject API key and serve HTML
function injectApiKeyAndServe(req, res) {
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Build files not found. Please build the application first.');
  }

  // Read the index.html file
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Get API key from environment variable (set in App Runner)
  const apiKey = process.env.GEMINI_API_KEY || '';
  
  // Log for debugging (only in development or if key is missing)
  if (!apiKey) {
    console.warn('WARNING: GEMINI_API_KEY environment variable is not set!');
  } else {
    console.log(`🔑 Injecting API key into HTML (length: ${apiKey.length}, first 10: ${apiKey.substring(0, 10)}..., source: process.env.GEMINI_API_KEY)`);
  }
  
  // Escape API key for safe injection into HTML/JavaScript
  // Escape single quotes, backslashes, and newlines
  const escapedApiKey = apiKey
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")    // Escape single quotes
    .replace(/\n/g, '\\n')  // Escape newlines
    .replace(/\r/g, '\\r'); // Escape carriage returns
  
  // Inject the API key into the HTML as early as possible
  // Replace the process.env polyfill with actual API key (more flexible regex)
  const processEnvPattern = /window\.process\s*=\s*window\.process\s*\|\|\s*\{\s*env:\s*\{\s*API_KEY:\s*['"](.*?)['"]\s*(?:,\s*GEMINI_API_KEY:\s*['"](.*?)['"])?\s*\}\s*\};/;
  if (processEnvPattern.test(html)) {
    html = html.replace(
      processEnvPattern,
      `window.process = window.process || { env: { API_KEY: '${escapedApiKey}', GEMINI_API_KEY: '${escapedApiKey}' } };`
    );
  } else {
    // If pattern doesn't match, inject it anyway before the existing script
    const existingScriptMatch = html.match(/<script[^>]*>/);
    if (existingScriptMatch) {
      html = html.replace(
        existingScriptMatch[0],
        `<script>window.process = window.process || { env: { API_KEY: '${escapedApiKey}', GEMINI_API_KEY: '${escapedApiKey}' } };</script>\n    ${existingScriptMatch[0]}`
      );
    }
  }
  
  // Inject API key as a script tag early in the head (before other scripts)
  // This ensures it's available immediately when the page loads
  const scriptInjection = `
    <script>
      (function() {
        if (typeof window !== 'undefined') {
          window.__GEMINI_API_KEY__ = '${escapedApiKey}';
          if (!window.process) {
            window.process = { env: {} };
          }
          if (!window.process.env) {
            window.process.env = {};
          }
          window.process.env.API_KEY = '${escapedApiKey}';
          window.process.env.GEMINI_API_KEY = '${escapedApiKey}';
        }
      })();
    </script>
  `;
  
  // Insert script injection right after the opening <head> tag
  // This ensures it runs before any other scripts
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${scriptInjection}`);
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', `${scriptInjection}</head>`);
  } else {
    // Fallback: inject at the very beginning of the body or after <html>
    if (html.includes('<html')) {
      html = html.replace(/<html[^>]*>/, (match) => `${match}${scriptInjection}`);
    }
  }
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

// Health check endpoint (BEFORE catch-all route)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    hasAnthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || ANTHROPIC_MODEL_DEFAULT,
    anthropicModelQuery: resolveAnthropicModel(1),
    anthropicModelAnswer: resolveAnthropicModel(2),
    geminiModel: getGeminiModel(),
    dataEngine: DATA_ENGINE,
    apiKeyLength: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
    dbConnected: db !== null
  });
});

app.get('/api/config', authenticateToken, (req, res) => {
  res.json({
    dataEngine: DATA_ENGINE,
    queryContract: DATA_ENGINE === 'sql' ? 'sql' : 'mongodb',
    anthropicModelQuery: resolveAnthropicModel(1),
    anthropicModelAnswer: resolveAnthropicModel(2),
    geminiModel: getGeminiModel(),
    providers: {
      claude: !!process.env.ANTHROPIC_API_KEY?.trim(),
      gemini: !!getGeminiClient(),
    },
    defaultProvider: 'claude',
  });
});

// ============================================
// Authentication API Endpoints
// ============================================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = await db.collection('users').findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id.toString(),
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        mustChangePassword: user.mustChangePassword === true
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const user = await db.collection('users').findOne({ email: req.user.email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      mustChangePassword: user.mustChangePassword === true
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint (client-side token removal, but we can log it)
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// Forgot password: send temporary password by email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await db.collection('users').findOne({ email });
    const genericMessage = { message: 'If an account exists for this email, a temporary password has been sent. Please check your inbox and log in, then set a new password.' };
    if (!user) {
      return res.json(genericMessage);
    }
    const tempPassword = crypto.randomBytes(6).toString('hex');
    const tempHash = await bcrypt.hash(tempPassword, 10);
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { passwordHash: tempHash, mustChangePassword: true } }
    );
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error('SMTP not configured; cannot send forgot-password email');
      return res.status(503).json({ error: 'Email service is not configured. Please contact support.' });
    }
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'INDIRA GPT – Temporary password',
      text: `Your temporary password is: ${tempPassword}\n\nPlease log in with this password. You will be asked to set a new password immediately after logging in.\n\nDo not share this email.`,
      html: `<p>Your temporary password is: <strong>${tempPassword}</strong></p><p>Please log in with this password. You will be asked to set a new password immediately after logging in.</p><p>Do not share this email.</p>`
    });
    res.json(genericMessage);
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again or contact support.' });
  }
});

// Change password (first-time login or user-initiated)
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await db.collection('users').findOne({ email: req.user.email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { passwordHash: newHash, mustChangePassword: false } }
    );
    res.json({
      message: 'Password changed successfully',
      user: {
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        mustChangePassword: false
      }
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Report token usage (authenticated; used by frontend after each LLM call)
app.post('/api/usage', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const { promptTokens = 0, completionTokens = 0, totalTokens = 0 } = req.body;
    const total = Number(totalTokens) || (Number(promptTokens) + Number(completionTokens)) || 0;
    if (total <= 0) {
      return res.status(400).json({ error: 'Invalid token counts' });
    }
    const email = req.user.email;
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const now = new Date();
    await db.collection('users').updateOne(
      { email },
      {
        $inc: {
          totalTokensUsed: total,
          promptTokensUsed: Number(promptTokens) || 0,
          completionTokensUsed: Number(completionTokens) || 0
        },
        $set: { lastTokenUsedAt: now }
      }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Usage report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- LLM chat (Claude or Gemini; API keys stay on server) ---
function resolveChatProvider(body) {
  return body?.provider === 'gemini' ? 'gemini' : 'claude';
}

app.post('/api/chat', authenticateToken, async (req, res) => {
  const provider = resolveChatProvider(req.body);
  const system = typeof req.body?.system === 'string' ? req.body.system : '';
  const messages = normalizeAnthropicMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({
      error: 'Invalid messages: provide a non-empty array of { role, content } alternating user/assistant, starting with user'
    });
  }

  try {
    if (provider === 'gemini') {
      if (!getGeminiClient()) {
        return res.status(503).json({ error: 'Gemini API not configured (set GEMINI_API_KEY)' });
      }
      const { text, usage } = await completeGeminiChat(system, messages);
      return res.json({ text, usage, provider: 'gemini', model: getGeminiModel() });
    }

    const client = getAnthropicClient();
    if (!client) {
      return res.status(503).json({ error: 'Anthropic API not configured (set ANTHROPIC_API_KEY)' });
    }
    const phase = Number(req.body?.phase) || 2;
    const model = resolveAnthropicModel(phase);
    const maxTokens = Math.min(Math.max(Number(req.body?.max_tokens) || 8192, 256), 16384);
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages
    });
    const text = (msg.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
    const inT = msg.usage?.input_tokens ?? 0;
    const outT = msg.usage?.output_tokens ?? 0;
    res.json({
      text,
      usage: {
        promptTokens: inT,
        completionTokens: outT,
        totalTokens: inT + outT
      },
      provider: 'claude',
      model
    });
  } catch (error) {
    console.error(`${provider} /api/chat error:`, error);
    res.status(500).json({ error: error.message || `${provider} request failed` });
  }
});

app.post('/api/chat/stream', authenticateToken, async (req, res) => {
  const provider = resolveChatProvider(req.body);
  const system = typeof req.body?.system === 'string' ? req.body.system : '';
  const messages = normalizeAnthropicMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({
      error: 'Invalid messages: provide a non-empty array of { role, content } alternating user/assistant, starting with user'
    });
  }

  if (provider === 'gemini' && !getGeminiClient()) {
    return res.status(503).json({ error: 'Gemini API not configured (set GEMINI_API_KEY)' });
  }
  if (provider === 'claude' && !getAnthropicClient()) {
    return res.status(503).json({ error: 'Anthropic API not configured (set ANTHROPIC_API_KEY)' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeLine = (evt) => {
    res.write(`${JSON.stringify(evt)}\n`);
  };

  try {
    if (provider === 'gemini') {
      await streamGeminiChat(system, messages, writeLine);
      res.end();
      return;
    }

    const client = getAnthropicClient();
    const phase = Number(req.body?.phase) || 2;
    const model = resolveAnthropicModel(phase);
    const maxTokens = Math.min(Math.max(Number(req.body?.max_tokens) || 16384, 256), 16384);
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: system || undefined,
      messages
    });
    stream.on('text', (textDelta) => {
      if (textDelta) writeLine({ type: 'text', text: textDelta });
    });
    const finalMsg = await stream.finalMessage();
    const inT = finalMsg.usage?.input_tokens ?? 0;
    const outT = finalMsg.usage?.output_tokens ?? 0;
    writeLine({
      type: 'usage',
      promptTokens: inT,
      completionTokens: outT,
      totalTokens: inT + outT
    });
    res.end();
  } catch (error) {
    console.error(`${provider} /api/chat/stream error:`, error);
    try {
      writeLine({ type: 'error', message: error.message || `${provider} stream failed` });
    } catch (_) {
      /* ignore */
    }
    res.end();
  }
});

// Get token usage summary (admin only)
app.get('/api/admin/usage', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const users = await db.collection('users')
      .find({}, { projection: { email: 1, totalTokensUsed: 1, promptTokensUsed: 1, completionTokensUsed: 1, lastTokenUsedAt: 1 } })
      .toArray();
    let totalTokens = 0;
    const byUser = users.map(u => {
      const used = Number(u.totalTokensUsed) || 0;
      totalTokens += used;
      return {
        email: u.email,
        totalTokens: used,
        promptTokens: Number(u.promptTokensUsed) || 0,
        completionTokens: Number(u.completionTokensUsed) || 0,
        lastUsed: u.lastTokenUsedAt || null
      };
    });
    res.json({ totalTokens, byUser });
  } catch (error) {
    console.error('Admin usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log user prompt (authenticated; stores what the user searched)
app.post('/api/logs', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const truncated = prompt.length > 2000 ? prompt.substring(0, 2000) + '…' : prompt;
    const email = req.user.email;
    const inserted = await db.collection('promptLogs').insertOne({
      email,
      prompt: truncated,
      createdAt: new Date()
    });
    res.json({ ok: true, id: inserted.insertedId.toString() });
  } catch (error) {
    console.error('Log prompt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update log with response (authenticated user can only update their own log)
app.patch('/api/logs/:id', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const id = req.params.id;
    const response = typeof req.body?.response === 'string' ? req.body.response.trim() : '';
    if (!id) {
      return res.status(400).json({ error: 'Log id is required' });
    }
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: 'Invalid log id' });
    }
    const truncated = response.length > 50000 ? response.substring(0, 50000) + '…' : response;
    const result = await db.collection('promptLogs').findOneAndUpdate(
      { _id: objectId, email: req.user.email },
      { $set: { response: truncated } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ error: 'Log not found or access denied' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Update log response error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List users that have logs (admin only)
app.get('/api/admin/logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const agg = await db.collection('promptLogs').aggregate([
      { $group: { _id: '$email', lastLogAt: { $max: '$createdAt' }, count: { $sum: 1 } } },
      { $sort: { lastLogAt: -1 } },
      { $project: { email: '$_id', lastLogAt: 1, count: 1, _id: 0 } }
    ]).toArray();
    res.json(agg);
  } catch (error) {
    console.error('Admin logs list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get logs for a specific user (admin only)
app.get('/api/admin/logs/:email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const email = decodeURIComponent(req.params.email);
    const logs = await db.collection('promptLogs')
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(200)
      .project({ prompt: 1, createdAt: 1, response: 1, _id: 1 })
      .toArray();
    res.json(logs);
  } catch (error) {
    console.error('Admin logs user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Admin API Endpoints
// ============================================

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const users = await db.collection('users')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    
    // Include accessibleFiles count for each user
    const usersWithFileCount = users.map(user => ({
      ...user,
      fileCount: user.accessibleFiles ? user.accessibleFiles.length : 0
    }));
    
    res.json(usersWithFileCount);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Failed to fetch users'
    });
  }
});

// Add new user (admin only)
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📝 Add user request received:', { 
      email: req.body?.email, 
      role: req.body?.role,
      hasAccessibleFiles: !!req.body?.accessibleFiles,
      userEmail: req.user?.email 
    });
    
    if (!db) {
      console.error('❌ Database not connected');
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email, password, role, accessibleFiles } = req.body;
    
    if (!email || !password) {
      console.error('❌ Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format:', email);
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email: email.toLowerCase() });
    if (existingUser) {
      console.error('❌ User already exists:', email);
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    
    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Insert user with accessible files
    // Safely get addedBy email (handle case where req.user might not have email)
    const addedByEmail = req.user?.email || req.user?.userId || 'system';
    
    const result = await db.collection('users').insertOne({
      email: email.toLowerCase(),
      passwordHash,
      role: role || 'user',
      accessibleFiles: Array.isArray(accessibleFiles) ? accessibleFiles : [],
      createdAt: new Date(),
      lastLogin: null,
      addedBy: addedByEmail,
      mustChangePassword: true
    });
    
    res.status(201).json({
      _id: result.insertedId,
      email: email.toLowerCase(),
      role: role || 'user',
      accessibleFiles: Array.isArray(accessibleFiles) ? accessibleFiles : [],
      createdAt: new Date()
    });
  } catch (error) {
    console.error('❌ Add user error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue
    });
    
    // Provide more detailed error information for debugging
    const errorMessage = error.message || 'Internal server error';
    
    // Check for specific MongoDB errors
    if (error.code === 11000) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    
    // Check for validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Validation error', message: errorMessage });
    }
    
    // Return detailed error in development, generic in production
    const errorResponse = {
      error: 'Internal server error',
      message: errorMessage
    };
    
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.stack;
      errorResponse.errorCode = error.code;
    }
    
    res.status(500).json(errorResponse);
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email } = req.params;
    
    // Prevent deleting yourself
    if (email.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await db.collection('users').deleteOne({ email: email.toLowerCase() });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role (admin only)
app.put('/api/admin/users/:email/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email } = req.params;
    const { role } = req.body;
    
    if (!role || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Valid role (admin or user) is required' });
    }
    
    // Prevent changing your own role
    if (email.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    
    const result = await db.collection('users').updateOne(
      { email: email.toLowerCase() },
      { $set: { role, updatedAt: new Date(), updatedBy: req.user.email } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User role updated successfully' });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// File Management API Endpoints (Admin Only)
// ============================================

// Get all available CSV files
app.get('/api/admin/files', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📁 Get files request received');
    
    if (!db) {
      console.error('❌ Database not connected');
      // Try to reconnect
      try {
        await connectDB();
        if (!db) {
          return res.status(503).json({ error: 'Database not connected. Please check MongoDB connection.' });
        }
      } catch (reconnectError) {
        console.error('❌ Failed to reconnect to database:', reconnectError);
        return res.status(503).json({ 
          error: 'Database not connected', 
          message: reconnectError.message || 'Failed to connect to MongoDB'
        });
      }
    }
    
    console.log('✅ Database connection verified');
    
    // Query files - handle missing uploadedAt field gracefully
    // Use a more robust sort that handles missing fields
    console.log('🔍 Querying files from database...');
    const files = await db.collection('csvFiles')
      .find({ isActive: { $ne: false } }) // Only get active files
      .toArray();
    
    console.log(`✅ Found ${files.length} files`);
    
    // Sort in memory to handle missing uploadedAt fields
    files.sort((a, b) => {
      try {
        const dateA = a.uploadedAt || a.createdAt || new Date(0);
        const dateB = b.uploadedAt || b.createdAt || new Date(0);
        // Ensure dates are Date objects
        const dateAObj = dateA instanceof Date ? dateA : new Date(dateA);
        const dateBObj = dateB instanceof Date ? dateB : new Date(dateB);
        return dateBObj.getTime() - dateAObj.getTime(); // Newest first
      } catch (sortError) {
        console.error('Error sorting files:', sortError);
        return 0; // Keep original order if sort fails
      }
    });
    
    // Remove fileContent from response to reduce payload size (only include metadata)
    // Handle missing fields gracefully
    const filesWithoutContent = files.map(file => {
      try {
        return {
          _id: file._id ? (file._id.toString ? file._id.toString() : String(file._id)) : null,
          fileName: file.fileName || 'Unknown',
          filePath: file.filePath || `/data/${file.fileName || 'unknown'}`,
          fileSize: file.fileSize || 0,
          uploadedAt: file.uploadedAt || file.createdAt || new Date(),
          uploadedBy: file.uploadedBy || 'Unknown',
          isActive: file.isActive !== false, // Default to true if not set
          storedInGridFS: file.storedInGridFS || false,
          dataCollection: file.dataCollection || getCollectionName(file.fileName || ''),
          rowCount: file.rowCount ?? 0,
        };
      } catch (mapError) {
        console.error('Error mapping file:', file, mapError);
        // Return a safe default object
        return {
          _id: file._id ? (file._id.toString ? file._id.toString() : String(file._id)) : null,
          fileName: file.fileName || 'Unknown',
          filePath: `/data/${file.fileName || 'unknown'}`,
          fileSize: 0,
          uploadedAt: new Date(),
          uploadedBy: 'Unknown',
          isActive: true,
          storedInGridFS: false
        };
      }
    });
    
    console.log(`✅ Returning ${filesWithoutContent.length} files to client`);
    res.json(filesWithoutContent);
  } catch (error) {
    console.error('❌ Get files error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    // Check for specific MongoDB errors
    if (error.name === 'MongoServerError' || error.name === 'MongoError' || error.name === 'MongoNetworkError') {
      console.error('❌ MongoDB error detected');
      return res.status(503).json({ 
        error: 'Database error',
        message: error.message || 'Failed to connect to database',
        hint: 'Please check MongoDB connection. The database may not be connected.'
      });
    }
    
    // Check if database is not connected
    if (!db) {
      console.error('❌ Database connection is null');
      return res.status(503).json({ 
        error: 'Database not connected',
        message: 'MongoDB connection is not established. Please check server logs.',
        hint: 'Check if MONGODB_URI is set correctly in .env file'
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Failed to fetch files',
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// Delete CSV / data file (admin only) — soft-delete metadata, drop Mongo collection + GridFS
app.delete('/api/admin/files/:fileName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const fileName = decodeURIComponent(req.params.fileName || '').trim();
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const active = await db.collection('csvFiles').findOne({ fileName, isActive: { $ne: false } });
    if (!active) {
      return res.status(404).json({ error: `File not found or already deleted: ${fileName}` });
    }

    const result = await deleteStoredCsvFile(fileName, req.user.email);
    if (!result.found) {
      return res.status(404).json({ error: `File not found: ${fileName}` });
    }

    console.log(`✓ Deleted file from knowledge base: ${fileName} (collections: ${result.collectionNames.join(', ')})`);

    res.json({
      message: 'File deleted successfully',
      fileName,
      dataCollections: result.collectionNames,
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
});

// Upload CSV file (admin only) - saves to MongoDB only, overwrites existing file
app.post('/api/admin/files/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // ----------------------------------------------------------------------
    // Excel branch (Phase E). Reads the workbook with SheetJS and registers
    // ONE csvFiles record per sheet so RBAC, /api/data/schemas, and the
    // system instruction's available-collections list pick them up with zero
    // further change. The CSV branch below is unchanged.
    // ----------------------------------------------------------------------
    if (hasExcelExtension(req.file.originalname)) {
      const originalBase = req.file.originalname.replace(/\.(xlsx|xls)$/i, '');

      // Wipe any prior records for this workbook (parent + per-sheet records)
      const sheetFileNameRx = new RegExp('^' + originalBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '__.+\\.xlsx$', 'i');
      const priorRecords = await db.collection('csvFiles').find({
        $or: [
          { fileName: req.file.originalname },
          { fileName: { $regex: sheetFileNameRx } }
        ]
      }).toArray();
      if (priorRecords.length > 0) {
        // Drop the per-sheet collections so they don't linger with stale data
        for (const rec of priorRecords) {
          if (rec.dataCollection) {
            try { await db.collection(rec.dataCollection).drop(); }
            catch (_e) { /* ok if missing */ }
          }
        }
        await db.collection('csvFiles').deleteMany({
          $or: [
            { fileName: req.file.originalname },
            { fileName: { $regex: sheetFileNameRx } }
          ]
        });
        console.log(`✓ Removed ${priorRecords.length} prior record(s) for workbook ${req.file.originalname}`);
      }

      let sheetsResult;
      try {
        sheetsResult = await parseAndStoreXLSXInMongo(req.file.originalname, req.file.path);
      } catch (parseError) {
        console.error(`❌ XLSX parse failed for "${req.file.originalname}": ${parseError.message}`);
        try { fs.unlinkSync(req.file.path); } catch (_e) {}
        return res.status(400).json({
          error: 'Failed to parse Excel workbook',
          message: parseError.message,
        });
      }

      // Register one csvFiles record per sheet (each acts as its own "file"
      // for RBAC purposes, exactly like CSV files).
      const insertedSheets = [];
      for (const sheet of sheetsResult) {
        await db.collection('csvFiles').insertOne({
          fileName: sheet.fileName,
          filePath: `/data/${sheet.fileName}`,
          fileSize: req.file.size,
          fileContent: null,
          storedInGridFS: false,
          uploadedAt: new Date(),
          uploadedBy: req.user.email,
          isActive: true,
          dataCollection: sheet.collectionName,
          columns: sheet.columns,
          rowCount: sheet.rowCount,
          parseQuality: sheet.parseQuality || [],
          columnTypes: sheet.columnTypes || {},
          sampleRows: sheet.sampleRows || [],
          sqlColumns: sheet.sqlColumns || [],
          sqlRowCount: sheet.sqlRowCount ?? sheet.rowCount,
          sourceType: 'xlsx-sheet',
          parentFile: req.file.originalname,
          sheetName: sheet.sheetName,
        });
        insertedSheets.push({
          sheetName: sheet.sheetName,
          fileName: sheet.fileName,
          dataCollection: sheet.collectionName,
          columns: sheet.columns,
          rowCount: sheet.rowCount,
        });
        console.log(`✓ Registered sheet record: ${sheet.fileName} → ${sheet.collectionName} (${sheet.rowCount} rows)`);
      }

      try { fs.unlinkSync(req.file.path); } catch (_e) {}
      return res.status(201).json({
        message: 'Workbook uploaded successfully',
        file: {
          fileName: req.file.originalname,
          fileSize: req.file.size,
          uploadedAt: new Date(),
          sourceType: 'xlsx',
          sheets: insertedSheets,
          sheetCount: insertedSheets.length,
        }
      });
    }
    // ----------------------------------------------------------------------
    // CSV branch (existing flow — unchanged below this line).
    // ----------------------------------------------------------------------

    const fileSizeMB = req.file.size / (1024 * 1024);
    const isLargeFile = req.file.size > 16 * 1024 * 1024;
    
    let fileContent = null;
    if (!isLargeFile) {
      try {
        fileContent = fs.readFileSync(req.file.path, 'utf8');
        if (fileContent.trim().toLowerCase().startsWith('<!doctype') || 
            fileContent.trim().toLowerCase().startsWith('<html')) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Uploaded file appears to be HTML, not CSV. Please upload a valid CSV file.' });
        }
      } catch (readError) {
        console.error('Error reading file content:', readError);
        fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'Failed to read file content' });
      }
    } else {
      try {
        const fd = fs.openSync(req.file.path, 'r');
        const buf = Buffer.alloc(1024);
        fs.readSync(fd, buf, 0, 1024, 0);
        fs.closeSync(fd);
        const sample = buf.toString('utf8');
        if (sample.trim().toLowerCase().startsWith('<!doctype') || 
            sample.trim().toLowerCase().startsWith('<html')) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Uploaded file appears to be HTML, not CSV. Please upload a valid CSV file.' });
        }
      } catch (sampleError) {
        console.warn('Could not validate large file sample:', sampleError.message);
      }
    }
    
    // Delete ALL existing records for this filename (full overwrite, no duplicates)
    const existingRecords = await db.collection('csvFiles').find({ fileName: req.file.originalname }).toArray();
    if (existingRecords.length > 0) {
      // Clean up any GridFS data for this filename
      const hasGridFS = existingRecords.some(r => r.storedInGridFS);
      if (hasGridFS) {
        try {
          const bucket = new GridFSBucket(db, { bucketName: 'csvFiles' });
          // Delete ALL GridFS files with this name (there may be multiple)
          let gridFile = await db.collection('csvFiles.files').findOne({ filename: req.file.originalname });
          while (gridFile) {
            await bucket.delete(gridFile._id);
            console.log(`✓ Deleted old GridFS entry: ${req.file.originalname}`);
            gridFile = await db.collection('csvFiles.files').findOne({ filename: req.file.originalname });
          }
        } catch (deleteError) {
          console.warn(`⚠️ Could not delete old GridFS file:`, deleteError.message);
        }
      }
      // Remove ALL duplicate MongoDB records for this filename
      await db.collection('csvFiles').deleteMany({ fileName: req.file.originalname });
      console.log(`✓ Removed ${existingRecords.length} old record(s) for: ${req.file.originalname}`);
    }
    
    if (isLargeFile) {
      console.log(`📦 File is ${fileSizeMB.toFixed(2)}MB, storing in GridFS`);
      const bucket = new GridFSBucket(db, { bucketName: 'csvFiles' });
      
      const uploadStream = bucket.openUploadStream(req.file.originalname, {
        metadata: {
          uploadedAt: new Date(),
          uploadedBy: req.user.email,
          isActive: true
        }
      });
      
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(uploadStream)
          .on('error', (err) => {
            console.error('GridFS upload error:', err);
            reject(err);
          })
          .on('finish', () => {
            console.log(`✓ Uploaded to GridFS: ${req.file.originalname}`);
            resolve(null);
          });
      });
      
      await db.collection('csvFiles').insertOne({
        fileName: req.file.originalname,
        filePath: `/data/${req.file.originalname}`,
        fileSize: req.file.size,
        fileContent: null,
        storedInGridFS: true,
        uploadedAt: new Date(),
        uploadedBy: req.user.email,
        isActive: true
      });
      console.log(`✓ Stored file metadata in MongoDB: ${req.file.originalname}`);
      
    } else {
      console.log(`📄 File is ${fileSizeMB.toFixed(2)}MB, storing in MongoDB document`);
      
      try {
        await db.collection('csvFiles').insertOne({
          fileName: req.file.originalname,
          filePath: `/data/${req.file.originalname}`,
          fileSize: req.file.size,
          fileContent: fileContent,
          storedInGridFS: false,
          uploadedAt: new Date(),
          uploadedBy: req.user.email,
          isActive: true
        });
        console.log(`✓ Stored file in MongoDB: ${req.file.originalname} (${fileContent ? fileContent.length : 0} chars)`);
      } catch (insertErr) {
        console.error(`❌ MongoDB insertOne failed for "${req.file.originalname}": ${insertErr.message}`);
        fs.unlinkSync(req.file.path);
        return res.status(500).json({
          error: 'Failed to save file to database',
          message: insertErr.message,
          hint: insertErr.message.includes('document too large') 
            ? 'File is too large to store directly. Try splitting the CSV into smaller files.'
            : 'Check MongoDB connection and permissions.'
        });
      }
    }
    
    // Parse CSV and store structured data in a dedicated MongoDB collection
    let csvContent = fileContent;
    if (!csvContent && isLargeFile) {
      csvContent = fs.readFileSync(req.file.path, 'utf8');
    }
    
    let parseResult = null;
    if (csvContent) {
      try {
        parseResult = await parseAndStoreCSVInMongo(req.file.originalname, csvContent);
        console.log(`✓ Parsed and stored ${parseResult.rowCount} documents in collection: ${parseResult.collectionName}`);
        
        // Update csvFiles metadata with collection info + per-column parseQuality
        await db.collection('csvFiles').updateOne(
          { fileName: req.file.originalname, isActive: true },
          { $set: {
            dataCollection: parseResult.collectionName,
            columns: parseResult.headers,
            rowCount: parseResult.rowCount,
            parseQuality: parseResult.parseQuality || [],
            columnTypes: parseResult.columnTypes || {},
            sampleRows: parseResult.sampleRows || [],
            sqlColumns: parseResult.sqlColumns || [],
            sqlRowCount: parseResult.sqlRowCount ?? parseResult.rowCount,
          }}
        );
      } catch (parseError) {
        console.error(`⚠️ CSV parse/store failed for "${req.file.originalname}":`);
        console.error(`   Error type : ${parseError.constructor.name}`);
        console.error(`   Message    : ${parseError.message}`);
        // Do NOT re-throw — raw file is already saved in MongoDB; structured parse is best-effort
        parseResult = null;
      }
    }
    
    // Clean up temp file from multer
    fs.unlinkSync(req.file.path);
    
    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        uploadedAt: new Date(),
        dataCollection: parseResult?.collectionName || null,
        columns: parseResult?.headers || [],
        rowCount: parseResult?.rowCount || 0
      }
    });
  } catch (error) {
    console.error('Upload file error:', error);
    try {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (cleanupError) {
      console.warn('Could not clean up temp file:', cleanupError.message);
    }
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Failed to upload file'
    });
  }
});

// Get user's accessible files (admin only)
app.get('/api/admin/users/:email/files', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email } = req.params;
    const user = await db.collection('users').findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const accessibleFiles = user.accessibleFiles || [];
    res.json(accessibleFiles);
  } catch (error) {
    console.error('Get user files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user's accessible files (admin only)
app.put('/api/admin/users/:email/files', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const { email } = req.params;
    const { fileNames } = req.body; // Array of file names
    
    if (!Array.isArray(fileNames)) {
      return res.status(400).json({ error: 'fileNames must be an array' });
    }
    
    const result = await db.collection('users').updateOne(
      { email: email.toLowerCase() },
      { 
        $set: { 
          accessibleFiles: fileNames,
          filesUpdatedAt: new Date(),
          filesUpdatedBy: req.user.email
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    invalidateUserCache(email);
    
    res.json({ 
      message: 'User file access updated successfully',
      accessibleFiles: fileNames
    });
  } catch (error) {
    console.error('Update user files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get accessible files for current user (for chatbot)
app.get('/api/user/files', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const user = await db.collection('users').findOne({ email: req.user.email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // If admin, return all files; otherwise return only accessible files
    if (user.role === 'admin') {
      const allFiles = await db.collection('csvFiles').find({ isActive: true }).toArray();
      res.json(allFiles.map(f => f.fileName));
    } else {
      const accessibleFiles = user.accessibleFiles || [];
      res.json(accessibleFiles);
    }
  } catch (error) {
    console.error('Get user accessible files error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files (AFTER HTML injection routes) - only in production
if (distExists) {
  // CRITICAL: Handle /data routes FIRST, before general static middleware
  // This ensures CSV files are served correctly and not intercepted by catch-all routes
  
  // Serve CSV files from MongoDB only
  app.get('/data/:filename', async (req, res, next) => {
    let fileName = req.params.filename;
    try {
      fileName = decodeURIComponent(fileName);
    } catch (e) {
      console.warn(`⚠️ Could not decode filename: ${req.params.filename}`);
    }
    
    console.log(`📁 Request for CSV file: "${req.params.filename}" -> decoded: "${fileName}"`);
    
    if (!fileName.endsWith('.csv')) {
      return next();
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database not connected' });
      }
      
      let fileDoc = await db.collection('csvFiles').findOne({ 
        fileName: fileName,
        isActive: true 
      });
      
      if (!fileDoc) {
        const decodedFileName = decodeURIComponent(fileName);
        if (decodedFileName !== fileName) {
          fileDoc = await db.collection('csvFiles').findOne({ 
            fileName: decodedFileName,
            isActive: true 
          });
        }
      }
      
      if (!fileDoc) {
        console.warn(`⚠️ CSV file not found in MongoDB: ${fileName}`);
        return res.status(404).json({ error: `CSV file not found: ${fileName}` });
      }
      
      if (fileDoc.storedInGridFS || (fileDoc.fileSize > 16 * 1024 * 1024 && !fileDoc.fileContent)) {
        const bucket = new GridFSBucket(db, { bucketName: 'csvFiles' });
        const stream = bucket.openDownloadStreamByName(fileName);
        
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const content = Buffer.concat(chunks).toString('utf-8');
          console.log(`✓ Serving CSV from GridFS: ${fileName} (${content.length} chars)`);
          res.send(content);
        });
        stream.on('error', (err) => {
          console.error(`❌ Error reading from GridFS:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading file from GridFS' });
          }
        });
      } else if (fileDoc.fileContent) {
        console.log(`✓ Serving CSV from MongoDB: ${fileName} (${fileDoc.fileContent.length} chars)`);
        return res.send(fileDoc.fileContent);
      } else {
        console.warn(`⚠️ CSV file ${fileName} has no content. Please re-upload.`);
        return res.status(404).json({ 
          error: `CSV file ${fileName} needs to be re-uploaded. Content is missing.` 
        });
      }
    } catch (error) {
      console.error(`❌ Error serving CSV file ${fileName}:`, error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Error serving file from database' });
      }
    }
  });
}

// ============================================
// MongoDB Data Query Endpoints (always registered — dev + production)
// ============================================

// Get file schema (columns, row count, and sample data) — metadata only
app.get('/api/data/schema/:fileName', authenticateToken, async (req, res) => {
  try {
    const fileName = decodeURIComponent(req.params.fileName);
    
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const user = await getCachedUser(db, req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role !== 'admin') {
      const hasAccess = user.accessibleFiles && user.accessibleFiles.includes(fileName);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this file' });
      }
    }
    
    const fileDoc = await db.collection('csvFiles').findOne({ fileName, isActive: { $ne: false } });
    if (!fileDoc) {
      const wasDeleted = await db.collection('csvFiles').findOne({ fileName, isActive: false });
      if (wasDeleted) {
        return res.status(410).json({
          error: fileUnavailableMessage(fileName),
          code: 'FILE_DELETED',
        });
      }
      return res.status(404).json({ error: `File ${fileName} not found` });
    }

    await assertSqlColumnParity(fileDoc);
    res.json(buildSchemaFromFileDoc(fileDoc));
  } catch (error) {
    console.error('Schema endpoint error:', error);
    res.status(500).json({ error: error.message || 'Failed to get schema' });
  }
});

// Get all schemas at once (for frontend data loading) — metadata only, no live counts
app.get('/api/data/schemas', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const user = await getCachedUser(db, req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let files;
    if (user.role === 'admin') {
      files = await db.collection('csvFiles').find({ isActive: true }).toArray();
    } else {
      const accessibleFiles = user.accessibleFiles || [];
      if (accessibleFiles.length === 0) {
        return res.json([]);
      }
      files = await db.collection('csvFiles').find({ 
        fileName: { $in: accessibleFiles }, 
        isActive: true 
      }).toArray();
    }
    
    const schemas = [];
    for (const fileDoc of files) {
      try {
        await assertSqlColumnParity(fileDoc);
        schemas.push(buildSchemaFromFileDoc(fileDoc));
      } catch (e) {
        console.warn(`⚠️ Could not get schema for ${fileDoc.fileName}: ${e.message}`);
      }
    }
    
    res.json(schemas);
  } catch (error) {
    console.error('Schemas endpoint error:', error);
    res.status(500).json({ error: error.message || 'Failed to get schemas' });
  }
});

// Execute MongoDB aggregation pipeline on data collection
app.post('/api/data/query', authenticateToken, async (req, res) => {
  try {
    const { pipeline, fileName, collectionName: reqCollection } = req.body;
    
    if (!pipeline || !Array.isArray(pipeline)) {
      return res.status(400).json({ error: 'pipeline (array) is required' });
    }
    
    if (!fileName && !reqCollection) {
      return res.status(400).json({ error: 'fileName or collectionName is required' });
    }
    
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    const user = await getCachedUser(db, req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role !== 'admin' && fileName) {
      const hasAccess = user.accessibleFiles && user.accessibleFiles.includes(fileName);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this file' });
      }
    }
    
    // Determine collection name and file metadata (for schema-aware validation)
    let collectionName = reqCollection;
    let fileDoc = null;
    if (fileName) {
      fileDoc = await db.collection('csvFiles').findOne({ fileName, isActive: { $ne: false } });
      if (!fileDoc) {
        const wasDeleted = await db.collection('csvFiles').findOne({ fileName, isActive: false });
        if (wasDeleted) {
          return res.status(410).json({
            error: fileUnavailableMessage(fileName),
            code: 'FILE_DELETED',
          });
        }
        return res.status(404).json({ error: `File ${fileName} not found` });
      }
      if (!collectionName) {
        collectionName = fileDoc.dataCollection || getCollectionName(fileName);
      }
    } else if (collectionName) {
      fileDoc = await db.collection('csvFiles').findOne({
        $or: [{ dataCollection: collectionName }, { fileName: collectionName.replace(/^data_/, '') }],
        isActive: { $ne: false },
      });
    } else {
      return res.status(400).json({ error: 'fileName or collectionName is required' });
    }

    const { columnTypes } = fileDoc ? schemaColumnsForEngine(fileDoc) : { columnTypes: {} };
    try {
      validatePipelineWithSchema(pipeline, columnTypes);
    } catch (validationErr) {
      const schemaHint = fileDoc ? buildSchemaHintForCollection(fileDoc) : '';
      return res.status(400).json({
        error: validationErr.message,
        hint: schemaHint || 'Use $match and $group only; copy exact column names from /api/data/schemas',
        code: 'PIPELINE_VALIDATION',
      });
    }
    
    console.log(`📊 Executing aggregation on ${collectionName}: ${JSON.stringify(pipeline).substring(0, 300)}`);
    
    const startTime = Date.now();
    const result = await db.collection(collectionName).aggregate(pipeline, { allowDiskUse: true }).toArray();
    const queryTime = Date.now() - startTime;
    
    // Strip _id from results unless it's a grouped field
    const cleanResult = result.map(row => {
      if (row._id && typeof row._id === 'object' && row._id.constructor.name === 'ObjectId') {
        const { _id, ...rest } = row;
        return rest;
      }
      return row;
    });
    
    const maxRows = 10000;
    const limitedResult = cleanResult.slice(0, maxRows);
    
    console.log(`✓ Aggregation executed in ${queryTime}ms, returned ${limitedResult.length} rows`);
    
    res.json({
      success: true,
      data: limitedResult,
      rowCount: limitedResult.length,
      totalRows: cleanResult.length,
      truncated: cleanResult.length > maxRows,
      columns: limitedResult.length > 0 ? Object.keys(limitedResult[0]) : [],
      queryTime: `${queryTime}ms`
    });
  } catch (error) {
    console.error('MongoDB query endpoint error:', error);
    res.status(500).json({ 
      error: error.message || 'Query failed',
      hint: 'Check aggregation pipeline syntax and ensure you have access to this file'
    });
  }
});

// Execute SQL against persisted DuckDB table (same auth/RBAC as /api/data/query)
app.post('/api/data/sql', authenticateToken, async (req, res) => {
  try {
    const { sql, fileName } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'sql (string) is required' });
    }
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const user = await getCachedUser(db, req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'admin') {
      const hasAccess = user.accessibleFiles && user.accessibleFiles.includes(fileName);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this file' });
      }
    }

    const fileDoc = await db.collection('csvFiles').findOne({ fileName, isActive: { $ne: false } });
    if (!fileDoc) {
      const wasDeleted = await db.collection('csvFiles').findOne({ fileName, isActive: false });
      if (wasDeleted) {
        return res.status(410).json({
          error: fileUnavailableMessage(fileName),
          code: 'FILE_DELETED',
        });
      }
      return res.status(404).json({ error: `File ${fileName} not found` });
    }

    const tableName = fileDoc.dataCollection || getCollectionName(fileName);
    validateSql(sql);

    const upper = sql.toUpperCase();
    if (upper.includes('FROM') && !upper.includes(tableName.toUpperCase())) {
      console.warn(`⚠️ SQL may not reference resolved table ${tableName}`);
    }

    console.log(`📊 Executing SQL on ${tableName}: ${sql.substring(0, 300)}`);

    const result = await executeDuckDBQuery(tableName, sql, 10000);

    res.json({
      success: true,
      data: result.data,
      rowCount: result.rowCount,
      totalRows: result.totalRows,
      truncated: result.truncated,
      columns: result.columns,
      queryTime: result.queryTime,
    });
  } catch (error) {
    console.error('SQL query endpoint error:', error);
    res.status(500).json({
      error: error.message || 'SQL query failed',
      hint: 'Only single SELECT/WITH statements against the resolved table are allowed',
    });
  }
});

// Reconciliation control-total for group-by answers (R3)
app.post('/api/data/reconcile', authenticateToken, async (req, res) => {
  try {
    const { fileName, metricColumn, dimensionColumn } = req.body;
    if (!fileName || !metricColumn) {
      return res.status(400).json({ error: 'fileName and metricColumn are required' });
    }
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const user = await getCachedUser(db, req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'admin') {
      const hasAccess = user.accessibleFiles?.includes(fileName);
      if (!hasAccess) return res.status(403).json({ error: 'Access denied to this file' });
    }

    const fileDoc = await db.collection('csvFiles').findOne({ fileName, isActive: { $ne: false } });
    if (!fileDoc) {
      const wasDeleted = await db.collection('csvFiles').findOne({ fileName, isActive: false });
      if (wasDeleted) {
        return res.status(410).json({
          error: fileUnavailableMessage(fileName),
          code: 'FILE_DELETED',
        });
      }
      return res.status(404).json({ error: `File ${fileName} not found` });
    }

    const tableName = fileDoc.dataCollection || getCollectionName(fileName);
    const qMetric = `"${String(metricColumn).replace(/"/g, '""')}"`;
    const castExpr = `TRY_CAST(${qMetric} AS DOUBLE)`;

    const grandSql = `SELECT SUM(${castExpr}) AS grand_total, COUNT(*) FILTER (WHERE ${castExpr} IS NULL) AS cast_failed FROM ${tableName}`;
    const bucketSql = dimensionColumn
      ? `SELECT SUM(${castExpr}) AS bucket_sum FROM (SELECT ${castExpr} AS v FROM ${tableName}) t`
      : null;

    const grand = await executeDuckDBQuery(tableName, grandSql, 1);
    const grandTotal = Number(grand.data[0]?.grand_total ?? 0);
    const castFailed = Number(grand.data[0]?.cast_failed ?? 0);

    let bucketSum = grandTotal;
    if (dimensionColumn && bucketSql) {
      const dim = `"${String(dimensionColumn).replace(/"/g, '""')}"`;
      const groupedSql = `SELECT SUM(bucket_val) AS bucket_sum FROM (SELECT ${castExpr} AS bucket_val FROM ${tableName} GROUP BY UPPER(TRIM(${dim}))) g`;
      const buck = await executeDuckDBQuery(tableName, groupedSql, 1);
      bucketSum = Number(buck.data[0]?.bucket_sum ?? 0);
    }

    const variance = grandTotal - bucketSum;
    const variancePct = grandTotal !== 0 ? (variance / grandTotal) * 100 : 0;

    res.json({
      controlTotal: grandTotal,
      sumOfBuckets: bucketSum,
      variance,
      variancePct: Math.round(variancePct * 1000) / 1000,
      castFailed,
    });
  } catch (error) {
    console.error('Reconcile endpoint error:', error);
    res.status(500).json({ error: error.message || 'Reconciliation failed' });
  }
});

// ============================================
// Artifact Generation & Authenticated Download
// ============================================
// Doctrine binding: the engine is permitted to emit deliverable artifacts ONLY
// from numbers that originated in /api/data/query results. The model is the
// gatekeeper of that rule (Layer 2 guardrail #10); this endpoint enforces only
// auth, RBAC over the user's accessible files, schema validity, and ownership.
// We mirror the auth + access pattern from /api/data/query.
app.post('/api/artifact/generate', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const { spec } = req.body || {};
    if (!spec || typeof spec !== 'object') {
      return res.status(400).json({ error: 'spec is required' });
    }
    const validTypes = ['deck', 'workbook', 'report', 'pdf'];
    if (!validTypes.includes(spec.type)) {
      return res.status(400).json({ error: `spec.type must be one of: ${validTypes.join(', ')}` });
    }
    if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
      return res.status(400).json({ error: 'spec.sections must be a non-empty array' });
    }
    for (let i = 0; i < spec.sections.length; i++) {
      const s = spec.sections[i];
      if (!s || typeof s !== 'object') {
        return res.status(400).json({ error: `Section ${i} is not an object` });
      }
      if (!s.narrative || typeof s.narrative !== 'string' || !s.narrative.trim()) {
        return res.status(400).json({ error: `Section ${i} (${s.heading || 'unnamed'}) requires narrative text` });
      }
      if (s.table) {
        if (!Array.isArray(s.table.columns) || !Array.isArray(s.table.rows)) {
          return res.status(400).json({ error: `Section ${i} table must have columns[] and rows[]` });
        }
      }
      if (s.chart) {
        if (!Array.isArray(s.chart.data)) {
          return res.status(400).json({ error: `Section ${i} chart must have data[]` });
        }
      }
    }

    // Mirror /api/data/query: ensure user exists and has access to at least one file
    // (admins bypass). The model is the source-of-truth filter on which collections
    // it actually queried; this is the same trust boundary used elsewhere.
    const user = await getCachedUser(db, req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.role !== 'admin') {
      const accessibleFiles = user.accessibleFiles || [];
      if (accessibleFiles.length === 0) {
        return res.status(403).json({ error: 'No accessible data files; cannot generate artifact.' });
      }
    }

    // Opportunistic 24h sweep — keeps backend/generated/ tidy without cron
    sweepGeneratedDir();

    const { id, filePath, fileName, mime } = await renderArtifact(spec);

    await db.collection('artifacts').insertOne({
      id,
      owner: req.user.email,
      fileName,
      mime,
      filePath,
      type: spec.type,
      title: spec.title || null,
      audience: spec.audience || null,
      confidentiality: spec.confidentiality || 'internal',
      createdAt: new Date(),
    });

    console.log(`📦 Artifact generated: type=${spec.type} id=${id} owner=${req.user.email} file=${fileName}`);
    return res.status(201).json({ downloadId: id, fileName });
  } catch (error) {
    console.error('Artifact generate error:', error);
    return res.status(500).json({
      error: 'Failed to generate artifact',
      message: error.message || 'Unknown error',
    });
  }
});

// Authenticated download. NEVER served via express.static — token required.
// 403 unless record.owner === req.user.email or req.user.role === 'admin'.
app.get('/api/artifact/download/:id', authenticateToken, async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    const { id } = req.params;
    if (!id || !/^[a-f0-9-]{8,}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const record = await db.collection('artifacts').findOne({ id });
    if (!record) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    if (record.owner !== req.user.email && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied to this artifact' });
    }
    if (!fs.existsSync(record.filePath)) {
      return res.status(410).json({ error: 'Artifact file is no longer available (older than 24h or sweep occurred).' });
    }

    const safeName = String(record.fileName || 'artifact').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', record.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    const stream = fs.createReadStream(record.filePath);
    stream.on('error', (err) => {
      console.error('Artifact stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to stream artifact' });
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Artifact download error:', error);
    return res.status(500).json({ error: 'Failed to download artifact', message: error.message });
  }
});

if (distExists) {
  // All CSV files are served from MongoDB via the /data/:filename route above

  // General static files (AFTER /data routes to avoid conflicts)
  app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

  // Fallback: For any other routes, serve index.html with API key injection (SPA routing)
  app.get('*', (req, res, next) => {
    // Skip /data routes - they should be handled by route handlers above
    if (req.path.startsWith('/data/')) {
      // If we reach here, the /data route handlers didn't match, so file doesn't exist
      console.warn(`⚠️ /data route not handled, file may not exist: ${req.path}`);
      return res.status(404).json({ error: `CSV file not found: ${req.path}` });
    }
    // Only inject for HTML requests, serve static files for others
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    if (req.path.includes('.')) {
      // Let static middleware handle it or return 404
      return res.status(404).send('Not found');
    }
    // For SPA routes, serve index.html with injection
    injectApiKeyAndServe(req, res);
  });
} else {
  // Dev mode - only handle API routes, return 404 for others
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).json({ 
      error: 'Not found',
      note: 'In dev mode, static files are served by Vite on port 3000'
    });
  });
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment variables:`);
  console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set (' + process.env.GEMINI_API_KEY.length + ' chars)' : '❌ Not set'}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set (' + process.env.ANTHROPIC_API_KEY.length + ' chars)' : '❌ Not set'}`);
  console.log(`   ANTHROPIC_MODEL_QUERY: ${resolveAnthropicModel(1)}`);
  console.log(`   ANTHROPIC_MODEL_ANSWER: ${resolveAnthropicModel(2)}`);
  console.log(`   DATA_ENGINE: ${DATA_ENGINE}`);
  console.log(`   MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Set' : '❌ Not set'}`);
  console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️  Using default (not secure!)'}`);
  if (process.env.MONGODB_URI) {
    const maskedUri = process.env.MONGODB_URI.replace(/mongodb\+srv:\/\/([^:]+):([^@]+)@/, 'mongodb+srv://$1:***@');
    console.log(`   MongoDB URI: ${maskedUri}`);
  }
  console.log(`\n📊 Database connection status: ${db ? '✅ Connected' : '❌ Not connected'}`);
  if (!db) {
    console.log('⚠️  WARNING: Database is not connected. Some features will not work.');
    console.log('   Check server logs above for MongoDB connection errors.');
  }
  console.log('');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    console.error('   Please stop the process using port 5005 or change PORT in .env');
    console.error('   To find and kill the process:');
    console.error('   Windows: netstat -ano | findstr :5005');
    console.error('   Then: taskkill /PID <PID> /F');
    process.exit(1);
  } else {
    throw err;
  }
});

// Global error handler — MUST be after all routes so Express treats it as an error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error caught by global handler:');
  console.error(`   Path    : ${req.method} ${req.path}`);
  console.error(`   Type    : ${err.constructor.name}`);
  console.error(`   Message : ${err.message}`);
  if (!res.headersSent) {
    if (req.path.startsWith('/api/')) {
      res.status(500).json({
        error: 'Internal server error',
        ...(isProduction()
          ? {}
          : { message: err.message || 'An unexpected error occurred' }),
      });
    } else {
      next(err);
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
