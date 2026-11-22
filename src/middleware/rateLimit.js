const crypto = require('crypto');
const buckets = new Map();
const WINDOW = 60000;

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function applyLimit(req, res, next, key, limit) {
  const now = Date.now();
  if (buckets.size > 10000) {
    for (const [bucketKey, bucket] of buckets) if (now - bucket.start >= WINDOW * 2) buckets.delete(bucketKey);
  }
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW) bucket = { start: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  const retryAfter = Math.max(1, Math.ceil((WINDOW - (now - bucket.start)) / 1000));
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
  res.set('Retry-After', String(retryAfter));
  if (bucket.count > limit) return res.status(429).json({ error: 'Rate limit exceeded', retryAfterSeconds: retryAfter });
  next();
}

function publicLimiter(req, res, next) {
  const limit = clamp(process.env.RATE_LIMIT_PUBLIC, 1, 10000, 60);
  const key = `public:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  applyLimit(req, res, next, key, limit);
}

function authLimiter(req, res, next) {
  const limit = clamp(process.env.RATE_LIMIT_AUTH, 30, 10000, 600);
  const apiKey = String(req.headers['x-api-key'] || '');
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const guildValue = req.query?.guildId || req.body?.guildId || '';
  const guildId = /^\d{17,20}$/.test(String(guildValue)) ? String(guildValue) : 'none';
  applyLimit(req, res, next, `auth:${hash}:${guildId}`, limit);
}

module.exports = Object.assign(publicLimiter, { publicLimiter, authLimiter });
