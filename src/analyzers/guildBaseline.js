const { getSql, getMemory } = require('../db/client');

const memoryBaselines = new Map();

async function getGuildBaseline(guildId) {
  const id = String(guildId);
  const sql = getSql();
  if (sql) {
    const rows = await sql('SELECT * FROM guild_baselines WHERE guild_id=$1', [id]);
    return rows[0] || null;
  }
  return memoryBaselines.get(id) || null;
}

function analyzeGuildBaseline(baseline, accountAgeDays) {
  if (!baseline || baseline.sample_count < 10 || accountAgeDays == null || baseline.average_account_age_days == null) {
    return { score: 0, reasons: [], baseline: baseline || null };
  }
  const ageGap = Number(baseline.average_account_age_days) - Number(accountAgeDays);
  if (ageGap >= 90) return { score: 15, reasons: ['GUILD_ACCOUNT_AGE_OUTLIER'], baseline };
  if (ageGap >= 30) return { score: 8, reasons: ['GUILD_ACCOUNT_AGE_BELOW_BASELINE'], baseline };
  return { score: 0, reasons: [], baseline };
}

async function recordGuildObservation(guildId, accountAgeDays, wasRaid, eventType) {
  const id = String(guildId);
  const age = Number.isFinite(Number(accountAgeDays)) ? Number(accountAgeDays) : null;
  const fresh = age != null && age < 7;
  const sql = getSql();
  if (sql) {
    await sql(`INSERT INTO guild_baselines (guild_id, sample_count, join_count, fresh_join_count, raid_count, verification_successes, verification_failures, average_account_age_days, updated_at)
      VALUES ($1, 1, 1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        sample_count=guild_baselines.sample_count+1,
        join_count=guild_baselines.join_count+1,
        fresh_join_count=guild_baselines.fresh_join_count+EXCLUDED.fresh_join_count,
        raid_count=guild_baselines.raid_count+EXCLUDED.raid_count,
        verification_successes=guild_baselines.verification_successes+EXCLUDED.verification_successes,
        verification_failures=guild_baselines.verification_failures+EXCLUDED.verification_failures,
        average_account_age_days=CASE WHEN EXCLUDED.average_account_age_days IS NULL THEN guild_baselines.average_account_age_days ELSE ((guild_baselines.average_account_age_days*guild_baselines.sample_count)+EXCLUDED.average_account_age_days)/(guild_baselines.sample_count+1) END,
        updated_at=NOW()`, [id, fresh ? 1 : 0, wasRaid ? 1 : 0, eventType === 'VERIFY_SUCCESS' ? 1 : 0, eventType === 'VERIFY_FAIL' ? 1 : 0, age]);
    return;
  }
  const current = memoryBaselines.get(id) || { guild_id: id, sample_count: 0, join_count: 0, fresh_join_count: 0, raid_count: 0, verification_successes: 0, verification_failures: 0, average_account_age_days: null };
  const nextCount = current.sample_count + 1;
  current.average_account_age_days = age == null ? current.average_account_age_days : ((Number(current.average_account_age_days || 0) * current.sample_count) + age) / nextCount;
  current.sample_count = nextCount;
  current.join_count += 1;
  current.fresh_join_count += fresh ? 1 : 0;
  current.raid_count += wasRaid ? 1 : 0;
  current.verification_successes += eventType === 'VERIFY_SUCCESS' ? 1 : 0;
  current.verification_failures += eventType === 'VERIFY_FAIL' ? 1 : 0;
  memoryBaselines.set(id, current);
}

async function recordGuildEvent(guildId, eventType) {
  if (eventType !== 'VERIFY_SUCCESS' && eventType !== 'VERIFY_FAIL') return;
  const baseline = await getGuildBaseline(guildId);
  const sql = getSql();
  if (sql) {
    await sql('UPDATE guild_baselines SET verification_successes=verification_successes+$2, verification_failures=verification_failures+$3, updated_at=NOW() WHERE guild_id=$1', [String(guildId), eventType === 'VERIFY_SUCCESS' ? 1 : 0, eventType === 'VERIFY_FAIL' ? 1 : 0]);
  } else if (baseline) {
    baseline.verification_successes += eventType === 'VERIFY_SUCCESS' ? 1 : 0;
    baseline.verification_failures += eventType === 'VERIFY_FAIL' ? 1 : 0;
  }
}

module.exports = { getGuildBaseline, analyzeGuildBaseline, recordGuildObservation, recordGuildEvent };
