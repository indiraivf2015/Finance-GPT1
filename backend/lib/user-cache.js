/** In-memory TTL cache for users.findOne — keyed by email. */

const TTL_MS = Math.max(5000, parseInt(process.env.USER_CACHE_TTL_MS || '45000', 10) || 45000);
const cache = new Map();

export function invalidateUserCache(email) {
  if (!email) {
    cache.clear();
    return;
  }
  cache.delete(String(email).toLowerCase());
}

export async function getCachedUser(db, email) {
  const key = String(email).toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.user;
  }
  const user = await db.collection('users').findOne({ email: key });
  if (user) {
    cache.set(key, { user, expiresAt: Date.now() + TTL_MS });
  }
  return user;
}
