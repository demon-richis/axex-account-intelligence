const { getMemory, getSql } = require('../db/client');
let patternCache = null;
const fallbackPatterns = [
  { pattern: '[a-z]{2,4}[0-9]{4,8}$', pattern_type: 'regex', score_addition: 20, description: 'Letters followed by many numbers' },
  { pattern: '[a-zA-Z0-9]{16,}', pattern_type: 'regex', score_addition: 15, description: 'Very long random string' },
  { pattern: '(user|member|discord|bot)[0-9]+', pattern_type: 'regex', score_addition: 25, description: 'Generic bot-like name' },
  { pattern: '([a-z])\\1{3,}', pattern_type: 'regex', score_addition: 20, description: 'Repeated characters' },
  { pattern: '(deleted|banned|null|undefined)', pattern_type: 'keyword', score_addition: 30, description: 'Suspicious keywords' }
];
async function loadPatterns() {
  if (patternCache) return patternCache;
  const sql = getSql();
  if (sql) { try { const rows = await sql('SELECT pattern, pattern_type, score_addition, description FROM username_patterns'); patternCache = dedupe(rows); return patternCache; } catch (_) {} }
  patternCache = dedupe(getMemory().patterns.length ? getMemory().patterns : fallbackPatterns); return patternCache;
}
function isSafePattern(pattern) {
  if (!pattern || typeof pattern.pattern !== 'string' || pattern.pattern.length > 100) return false;
  if (pattern.pattern_type === 'keyword') return true;
  if (/\([^)]*[+*{][^)]*\)[+*{]/.test(pattern.pattern) || /\(\.\*\)\*/.test(pattern.pattern) || /\(\.\+\)\+/.test(pattern.pattern)) return false;
  try { new RegExp(pattern.pattern, 'iu'); return true; } catch (_) { return false; }
}
function dedupe(patterns) { return [...new Map(patterns.filter(isSafePattern).map(pattern => [pattern.pattern, pattern])).values()]; }
function invalidatePatternCache() { patternCache = null; }
async function analyzeUsername(username = '') {
  const value = String(username); if (!value) return { score: 0, reasons: [], patterns: [] };
  let score = 0; const reasons = []; const patterns = []; const weaknesses = new Set();
  for (const p of await loadPatterns()) {
    if (typeof p.pattern !== 'string' || p.pattern.length > 100) continue;
    let matched = false;
    try {
      if (p.pattern_type === 'keyword') {
        const escaped = p.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        matched = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(value);
      } else {
        if (/^[\s\S]*\([^)]*[+*{][^)]*\)[+*{]/.test(p.pattern) || /invalid/i.test(p.pattern)) continue;
        matched = new RegExp(p.pattern, 'iu').test(value);
      }
    } catch (_) { continue; }
    if (matched) {
      const category = /[0-9].*\$$/.test(p.pattern) ? 'DIGITS' : (p.pattern_type === 'keyword' ? 'KEYWORD' : p.description || p.pattern);
      if (weaknesses.has(category)) continue;
      weaknesses.add(category);
      score += Math.max(0, Number(p.score_addition) || 0);
      patterns.push(p.pattern); reasons.push(`USERNAME_PATTERN:${p.description || p.pattern}`);
    }
  }
  if (value.length < 3 || value.length > 28) { if (weaknesses.has('LENGTH') === false) { weaknesses.add('LENGTH'); score += 10; reasons.push('USERNAME_LENGTH'); } }
  if (/^\d+$/.test(value)) { score += 30; reasons.push('ALL_NUMBERS'); }
  const digitCount = (value.match(/\d/g) || []).length;
  if (/[._-]/.test(value) && digitCount >= 5 && /[A-Z]/.test(value) && /[a-z]/.test(value)) { score += 15; reasons.push('RANDOM_MIXED_USERNAME'); }
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/iu.test(value)) { score += 15; reasons.push('GIBBERISH_CONSONANT_CLUSTER'); }
  if (/\d{4,}$/.test(value) && !weaknesses.has('DIGITS')) { weaknesses.add('DIGITS'); score += 15; reasons.push('SEQUENTIAL_NUMBERS'); }
  if (/[^\p{L}\p{N}\p{M}_.-]{4}/u.test(value) || /\p{M}{6}/u.test(value)) { score += 10; reasons.push('LONG_SYMBOL_OR_ZALGO_RUN'); }
  return { score: Math.min(score, 60), reasons, patterns };
}
module.exports = { analyzeUsername, loadPatterns, invalidatePatternCache };
