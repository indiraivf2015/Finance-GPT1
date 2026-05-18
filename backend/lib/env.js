const DEFAULT_JWT_PLACEHOLDER = 'your-secret-key-change-in-production';

/**
 * Fail fast when NODE_ENV=production if required secrets are missing or unsafe.
 */
export function validateProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = [];
  if (!process.env.MONGODB_URI?.trim()) missing.push('MONGODB_URI');
  if (!process.env.JWT_SECRET?.trim()) missing.push('JWT_SECRET');

  if (missing.length > 0) {
    console.error('\n❌ Production startup blocked — missing required environment variables:');
    missing.forEach((k) => console.error(`   - ${k}`));
    console.error('   Copy backend/.env.example to backend/.env and set values before deploying.\n');
    process.exit(1);
  }

  if (process.env.JWT_SECRET === DEFAULT_JWT_PLACEHOLDER) {
    console.error('\n❌ Production startup blocked — JWT_SECRET is still the default placeholder.');
    console.error('   Generate a strong secret and set JWT_SECRET in backend/.env\n');
    process.exit(1);
  }
}

export function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}
