const { getMemory, getSql } = require('../db/client');
let patternCache = null;
async function loadPatterns() {
  if (patternCache) return patternCache;
  const sql = getSql();
  if (sql) { try { const rows = await sql('SELECT pattern, pattern_type, score_addition, description FROM username_patterns'); patternCache = rows; return rows; } catch (_) {} }
  patternCache = getMemory().patterns; return patternCache;
}
async function analyzeUsername(username = '') {
  const value = String(username); let score = 0; const reasons = []; const patterns = [];
  for (const p of await loadPatterns()) { try { const re = new RegExp(p.pattern, p.pattern_type === 'keyword' ? 'i' : 'i'); if (re.test(value)) { score += Number(p.score_addition) || 0; patterns.push(p.pattern); reasons.push(`USERNAME_PATTERN:${p.description || p.pattern}`); } } catch (_) {} }
  if (value.length < 3 || value.length > 28) { score += 10; reasons.push('USERNAME_LENGTH'); }
  if (/^\d+$/.test(value)) { score += 30; reasons.push('ALL_NUMBERS'); }
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(value)) { score += 15; reasons.push('GIBBERISH_CONSONANT_CLUSTER'); }
  if (/\d{4,}$/.test(value)) { score += 15; reasons.push('SEQUENTIAL_NUMBERS'); }
  return { score: Math.min(score, 100), reasons, patterns };
}
module.exports = { analyzeUsername, loadPatterns };
