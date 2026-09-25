const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

const memory = { users: new Map(), ips: new Map(), alts: [], patterns: [], events: [], flags: new Map(), history: [], joins: [], blocklists: [], outcomes: [] };
let sql = null;
let initialized = false;
const defaults = [
  { pattern: '[a-z]{2,4}[0-9]{4,8}$', pattern_type: 'regex', score_addition: 20, description: 'Letters followed by many numbers' },
  { pattern: '[a-zA-Z0-9]{16,}', pattern_type: 'regex', score_addition: 15, description: 'Very long random string' },
  { pattern: '(user|member|discord|bot)[0-9]+', pattern_type: 'regex', score_addition: 25, description: 'Generic bot-like name' },
  { pattern: '([a-z])\\1{3,}', pattern_type: 'regex', score_addition: 20, description: 'Repeated characters' },
  { pattern: '(deleted|banned|null|undefined)', pattern_type: 'keyword', score_addition: 30, description: 'Suspicious keywords' },
  { pattern: '[^a-zA-Z0-9_.]', pattern_type: 'regex', score_addition: 10, description: 'Unusual special characters' }
];

async function initDB() {
  if (initialized) return;
  if (process.env.DATABASE_URL) {
    sql = neon(process.env.DATABASE_URL);
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await sql(statement);
  } else {
    memory.patterns.push(...defaults);
    console.warn('DATABASE_URL not set; using in-memory development store.');
  }
  initialized = true;
}
function getSql() { return sql; }
function getMemory() { return memory; }
async function getActiveFlag(userId) {
  const id = String(userId);
  if (sql) {
    const rows = await sql('SELECT user_id, reason, flagged_by, severity, active FROM flagged_accounts WHERE user_id=$1 AND active=TRUE', [id]);
    return rows[0] || null;
  }
  return memory.flags.get(id)?.active ? memory.flags.get(id) : null;
}
async function query(text, params = []) { if (!sql) throw new Error('DATABASE_UNAVAILABLE'); return sql.query(text, params); }
module.exports = { initDB, getSql, getMemory, getActiveFlag, query };
