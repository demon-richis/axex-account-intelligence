const { getSql, getMemory } = require('../db/client');
async function recordEvent(userId, guildId, eventType, data = {}) {
  const event = { userId: String(userId), guildId: String(guildId || 'unknown'), eventType, clickMs: data.clickMs == null ? null : Number(data.clickMs), metadata: data.metadata || {}, createdAt: new Date().toISOString() };
  const sql = getSql();
  try { if (sql) await sql('INSERT INTO behavior_events (user_id,guild_id,event_type,click_ms,metadata) VALUES ($1,$2,$3,$4,$5)', [event.userId,event.guildId,event.eventType,event.clickMs,event.metadata]); else getMemory().events.push(event); return event; } catch (err) { console.error('recordEvent:', err.message); return event; }
}
async function getBehaviorScore(userId) {
  const id = String(userId); let events;
  try { const sql = getSql(); events = sql ? await sql('SELECT event_type, click_ms, created_at FROM behavior_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500', [id]) : getMemory().events.filter(e => e.userId === id); } catch (_) { events = getMemory().events.filter(e => e.userId === id); }
  const fails = events.filter(e => e.event_type === 'VERIFY_FAIL' || e.eventType === 'VERIFY_FAIL').length;
  const clicks = events.map(e => e.click_ms ?? e.clickMs).filter(n => Number.isFinite(Number(n))).map(Number);
  const avg = clicks.length ? clicks.reduce((a,b) => a+b, 0) / clicks.length : null; let score = 0; const reasons = [];
  if (fails >= 5) { score += 50; reasons.push('VERIFY_FAIL_COUNT_5_PLUS'); } else if (fails >= 3) { score += 30; reasons.push('VERIFY_FAIL_COUNT_3_PLUS'); }
  if (avg !== null && avg < 800) { score += 25; reasons.push('INHUMAN_CLICK_SPEED'); } else if (avg !== null && avg < 1500) { score += 10; reasons.push('SUSPICIOUS_CLICK_SPEED'); }
  if (events.filter(e => e.event_type === 'JOIN' || e.eventType === 'JOIN').length > 1) { score += 20; reasons.push('MULTIPLE_JOIN_ATTEMPTS'); }
  return { score: Math.min(score,100), reasons, history: events.slice(0,20), failedVerifications: fails, averageClickMs: avg };
}
module.exports = { recordEvent, getBehaviorScore };
