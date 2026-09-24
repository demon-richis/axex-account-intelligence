const { getSql, getMemory } = require('../db/client');
function snowflakeDistance(a,b) { try { return Math.abs(BigInt(a)-BigInt(b)); } catch (_) { return Infinity; } }
async function detectAlts(userId, ipAddress, username, createdTimestamp) {
  const id = String(userId); let candidates = [];
  try { const sql = getSql(); candidates = sql ? await sql('SELECT user_id, username, account_created FROM user_intelligence WHERE user_id<>$1', [id]) : [...getMemory().users.values()].filter(u => u.user_id !== id); } catch (_) { candidates = [...getMemory().users.values()].filter(u => u.user_id !== id); }
  const results = []; const currentName = String(username || '').toLowerCase();
  for (const c of candidates) { let confidence = 0; const reasons = []; const candidateIp = c.ip_address;
    if (ipAddress && candidateIp && ipAddress === candidateIp) { confidence += 50; reasons.push('SAME_IP'); if (c.is_flagged) { confidence += 30; reasons.push('SAME_IP_AS_FLAGGED'); } }
    if (currentName && c.username && (currentName === c.username.toLowerCase() || currentName.replace(/\d+$/,'') === c.username.toLowerCase().replace(/\d+$/,''))) { confidence += 20; reasons.push('SIMILAR_USERNAME'); }
    const otherCreated = new Date(c.account_created || 0).getTime(); const currentCreated = Number(createdTimestamp);
    if (currentCreated && otherCreated && Math.abs(currentCreated-otherCreated) <= 3600000) { confidence += 25; reasons.push('SAME_CREATION_BATCH'); }
    if (snowflakeDistance(id, c.user_id) <= 1000) { confidence += 10; reasons.push('SEQUENTIAL_IDS'); }
    if (confidence > 0) results.push({ userId: c.user_id, confidence: Math.min(confidence,100), reasons });
  }
  for (const alt of results) { try { const sql = getSql(); if (sql) await sql('INSERT INTO alt_groups (primary_user_id,alt_user_id,confidence,reason) VALUES ($1,$2,$3,$4) ON CONFLICT (primary_user_id,alt_user_id) DO UPDATE SET confidence=EXCLUDED.confidence, reason=EXCLUDED.reason', [id,alt.userId,alt.confidence,alt.reasons]); else { const m=getMemory(); if (!m.alts.some(a=>a.primary_user_id===id&&a.alt_user_id===alt.userId)) m.alts.push({primary_user_id:id,alt_user_id:alt.userId,confidence:alt.confidence,reason:alt.reasons}); } } catch (_) {} }
  return { alts: results, totalAltScore: Math.min(results.reduce((n,a)=>n+a.confidence,0),100) };
}
module.exports = { detectAlts };
