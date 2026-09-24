const { getMemory, getSql } = require('../db/client');
let patternCache = null;
const fallbackPatterns = [
  { pattern: '[a-z]{2,4}[0-9]{4,8}$', pattern_type: 'regex', score_addition: 20, description: 'Letters followed by many numbers' },
  { pattern: '[a-zA-Z0-9]{16,}', pattern_type: 'regex', score_addition: 15, description: 'Very long random string' },
  { pattern: '(user|member|discord|bot)[0-9]+', pattern_type: 'regex', score_addition: 25, description: 'Generic bot-like name' },
  { pattern: '([a-z])\\1{3,}', pattern_type: 'regex', score_addition: 20, description: 'Repeated characters' },
  { pattern: '(deleted|banned|null|undefined)', pattern_type: 'keyword', score_addition: 30, description: 'Suspicious keywords' },
  { pattern: '[^a-zA-Z0-9_.]', pattern_type: 'regex', score_addition: 10, description: 'Unusual special characters' }
];
async function loadPatterns() {
  if (patternCache) return patternCache;
  const sql = getSql();
  if (sql) { try { const rows = await sql('SELECT pattern, pattern_type, score_addition, description FROM username_patterns'); patternCache = rows; return rows; } catch (_) {} }
  patternCache = getMemory().patterns.length ? getMemory().patterns : fallbackPatterns; return patternCache;
}
async function analyzeUsername(username = '') {
  const value = String(username); if (!value) return { score: 0, reasons: [], patterns: [] }; let score = 0; const reasons = []; const patterns = [];
  for (const p of await loadPatterns()) { try { const re = new RegExp(p.pattern, p.pattern_type === 'keyword' ? 'i' : 'i'); if (re.test(value)) { score += Number(p.score_addition) || 0; patterns.push(p.pattern); reasons.push(`USERNAME_PATTERN:${p.description || p.pattern}`); } } catch (_) {} }
  if (value.length < 3 || value.length > 28) { score += 10; reasons.push('USERNAME_LENGTH'); }
  if (/^\d+$/.test(value)) { score += 30; reasons.push('ALL_NUMBERS'); }
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(value)) { score += 15; reasons.push('GIBBERISH_CONSONANT_CLUSTER'); }
  if (/\d{4,}$/.test(value)) { score += 15; reasons.push('SEQUENTIAL_NUMBERS'); }
  return { score: Math.min(score, 100), reasons, patterns };
}
module.exports = { analyzeUsername, loadPatterns };
