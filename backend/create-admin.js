// Standalone script to create / reset an admin user in MongoDB.
//
// Usage (from the backend folder):
//   node create-admin.js                                   -> admin@indira.com / admin123
//   node create-admin.js you@example.com YourPass#123      -> custom email + password
//
// Safe to run multiple times: it upserts the user (creates if missing,
// resets the password if it already exists) and always sets role = "admin".

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'indira-gpt';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in backend/.env');
  process.exit(1);
}

const emailArg = (process.argv[2] || 'admin@indira.com').toLowerCase().trim();
const passwordArg = process.argv[3] || 'admin123';

if (!emailArg.includes('@')) {
  console.error(`❌ Invalid email: ${emailArg}`);
  process.exit(1);
}
if (!passwordArg || passwordArg.length < 6) {
  console.error('❌ Password must be at least 6 characters long');
  process.exit(1);
}

const maskedUri = MONGODB_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
console.log('🔄 Connecting to MongoDB...');
console.log(`   URI: ${maskedUri}`);
console.log(`   DB : ${DB_NAME}`);

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(DB_NAME);

  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  const passwordHash = await bcrypt.hash(passwordArg, 10);
  const now = new Date();

  const result = await db.collection('users').findOneAndUpdate(
    { email: emailArg },
    {
      $set: {
        email: emailArg,
        passwordHash,
        role: 'admin',
        lastLogin: null,
        mustChangePassword: false,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('');
  console.log('✅ Admin user is ready');
  console.log('---------------------------------------------');
  console.log(`   Email   : ${emailArg}`);
  console.log(`   Password: ${passwordArg}`);
  console.log(`   Role    : admin`);
  console.log('---------------------------------------------');
  console.log('⚠️  Please change this password after logging in.');
} catch (err) {
  console.error('❌ Failed to create admin user:', err.message);
  if (err.message.includes('authentication failed') || err.message.includes('bad auth')) {
    console.error('   Check the username/password in backend/.env -> MONGODB_URI');
  }
  process.exitCode = 1;
} finally {
  await client.close();
}
