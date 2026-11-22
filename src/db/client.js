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
  { pattern: '(deleted|banned|null|undefined)', pattern_type: 'keyword', score_addition: 30, description: 'Suspicious keywords' }
];

async function initDB() {
  if (initialized) return;
  if (process.env.DATABASE_URL) {
    sql = neon(process.env.DATABASE_URL);
    await sql(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
    const appliedRows = await sql('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map(row => row.version));
    const migrationDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationDir).filter(file => /^\d{3}_.*\.js$/.test(file)).sort();
    for (const file of files) {
      const version = file.slice(0, 3);
      if (applied.has(version)) continue;
      const migration = require(path.join(migrationDir, file));
      try {
        for (const statement of migration.statements) await sql(statement);
        await sql('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        console.log(`[DB] Applied migration ${version} (${file})`);
      } catch (error) {
        console.error(`[DB] Migration ${version} failed: ${error.message}`);
        throw error;
      }
    }
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
async function cleanupExpiredData() {
  if (!sql) return { skipped: true };
  const behaviorDays = Number(process.env.BEHAVIOR_RETENTION_DAYS) || 180;
  const networkDays = Number(process.env.NETWORK_RETENTION_DAYS) || 90;
  const outcomeDays = Number(process.env.OUTCOME_RETENTION_DAYS) || 365;
  await sql('DELETE FROM behavior_events WHERE created_at < NOW() - make_interval(days => $1)', [behaviorDays]);
  await sql('DELETE FROM ip_records WHERE last_seen < NOW() - make_interval(days => $1) AND flagged = FALSE', [networkDays]);
  await sql('DELETE FROM outcomes WHERE created_at < NOW() - make_interval(days => $1)', [outcomeDays]);
  return { behaviorDays, networkDays, outcomeDays };
}
module.exports = { initDB, getSql, getMemory, getActiveFlag, query, cleanupExpiredData };
