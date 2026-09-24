const cache = new Map();
const TTL = 5 * 60 * 1000;
function get(userId) { const entry = cache.get(String(userId)); if (!entry || Date.now() - entry.timestamp > TTL) { if (entry) cache.delete(String(userId)); return null; } cache.delete(String(userId)); cache.set(String(userId), entry); return entry.data; }
function set(userId, data) { const key = String(userId); cache.delete(key); cache.set(key, { data, timestamp: Date.now() }); while (cache.size > 1000) cache.delete(cache.keys().next().value); }
function invalidate(userId) { cache.delete(String(userId)); }
module.exports = { get, set, invalidate };
