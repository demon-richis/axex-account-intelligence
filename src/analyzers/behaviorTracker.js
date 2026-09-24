const { getSql, getMemory } = require('../db/client');

const windows = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };

async function recordEvent(userId, guildId, eventType, data = {}) {
  const event = { userId: String(userId), guildId: String(guildId || 'unknown'), eventType, clickMs: data.clickMs == null ? null : Number(data.clickMs), metadata: data.metadata || {}, createdAt: new Date().toISOString() };
  const sql = getSql();
  if (sql) await sql('INSERT INTO behavior_events (user_id,guild_id,event_type,click_ms,metadata) VALUES ($1,$2,$3,$4,$5)', [event.userId, event.guildId, event.eventType, event.clickMs, event.metadata]);
  else getMemory().events.push(event);
  return event;
}

function eventTime(event) {
  return new Date(event.created_at || event.createdAt || 0).getTime();
}

function summarize(events, now) {
  const result = {};
  for (const [name, duration] of Object.entries(windows)) {
    const recent = events.filter(event => now - eventTime(event) <= duration);
    const clicks = recent.map(event => event.click_ms ?? event.clickMs).filter(value => Number.isFinite(Number(value))).map(Number);
    const failures = recent.filter(event => (event.event_type || event.eventType) === 'VERIFY_FAIL').length;
    const joins = recent.filter(event => (event.event_type || event.eventType) === 'JOIN').length;
    result[name] = { events: recent.length, failures, joins, averageClickMs: clicks.length ? clicks.reduce((sum, value) => sum + value, 0) / clicks.length : null };
  }
  return result;
}

async function getBehaviorScore(userId) {
  const id = String(userId);
  let events;
  try {
    const sql = getSql();
    events = sql ? await sql("SELECT event_type, click_ms, created_at FROM behavior_events WHERE user_id=$1 AND created_at > NOW()-INTERVAL '7 days' ORDER BY created_at DESC LIMIT 1000", [id]) : getMemory().events.filter(event => event.userId === id);
  } catch (_) {
    events = getMemory().events.filter(event => event.userId === id);
  }
  const windowStats = summarize(events, Date.now());
  const week = windowStats['7d'];
  let score = 0;
  const reasons = [];
  if (windowStats['5m'].failures >= 3) { score += 35; reasons.push('VERIFY_FAILS_3_IN_5_MINUTES'); }
  else if (windowStats['1h'].failures >= 3) { score += 30; reasons.push('VERIFY_FAILS_3_IN_1_HOUR'); }
  else if (windowStats['24h'].failures >= 5) { score += 35; reasons.push('VERIFY_FAILS_5_IN_24_HOURS'); }
  else if (week.failures >= 10) { score += 25; reasons.push('VERIFY_FAILS_10_IN_7_DAYS'); }
  if (windowStats['5m'].averageClickMs !== null && windowStats['5m'].averageClickMs < 800) { score += 25; reasons.push('INHUMAN_CLICK_SPEED_5_MINUTES'); }
  else if (windowStats['24h'].averageClickMs !== null && windowStats['24h'].averageClickMs < 800) { score += 15; reasons.push('FAST_CLICK_SPEED_24_HOURS'); }
  if (windowStats['5m'].joins > 1) { score += 20; reasons.push('MULTIPLE_JOIN_ATTEMPTS_5_MINUTES'); }
  return { score: Math.min(score, 100), reasons, history: events.slice(0, 20), windows: windowStats, failedVerifications: week.failures, averageClickMs: windowStats['24h'].averageClickMs };
}

module.exports = { recordEvent, getBehaviorScore };
