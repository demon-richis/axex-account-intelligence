const { getSql, getMemory } = require('../db/client');

function snowflakeDistance(a, b) {
  try { return Math.abs(BigInt(a) - BigInt(b)); } catch (_) { return Infinity; }
}

function normalizeUsername(username) {
  return String(username || '').toLowerCase().replace(/[^a-z0-9]+$/g, '').replace(/[.\-_]+$/g, '').replace(/\d+$/g, '');
}

async function detectAlts(userId, ipAddress, username, createdTimestamp, avatarHash) {
  const id = String(userId);
  let candidates = [];
  const normalized = normalizeUsername(username);
  const avatar = avatarHash || null;
  try {
    const sql = getSql();
    if (sql) {
      candidates = await sql(`SELECT user_id, username, avatar_hash, account_created, ip_address, is_flagged
        FROM user_intelligence
        WHERE user_id<>$1
          AND (
            ($2::text IS NOT NULL AND ip_address::text=$2 AND last_seen >= NOW()-INTERVAL '7 days')
            OR ($3::text IS NOT NULL AND avatar_hash=$3)
            OR ($4::text IS NOT NULL AND char_length($4)>=4 AND regexp_replace(regexp_replace(lower(COALESCE(username,'')), '[^a-z0-9]+$', '', 'g'), '\\d+$', '', 'g')=$4)
          )
        LIMIT 50`, [id, ipAddress || null, avatar, normalized.length >= 4 ? normalized : null]);
    } else {
      const cutoff = Date.now() - 7 * 86400000;
      candidates = [...getMemory().users.values()].filter(user => {
        if (user.user_id === id) return false;
        const sameIp = ipAddress && user.ip_address && String(ipAddress) === String(user.ip_address);
        const recentIp = sameIp && (!user.last_seen || new Date(user.last_seen).getTime() >= cutoff);
        const sameAvatar = avatar && user.avatar_hash && String(avatar) === String(user.avatar_hash);
        const candidateName = normalizeUsername(user.username);
        const similarName = normalized.length >= 4 && candidateName.length >= 4 && normalized === candidateName;
        return recentIp || sameAvatar || similarName;
      }).slice(0, 50);
    }
  } catch (_) {
    candidates = [...getMemory().users.values()].filter(user => user.user_id !== id).slice(0, 50);
  }
  const results = [];
  const currentName = String(username || '').toLowerCase();
  const sharedIp = Boolean(getMemory().ips.get(String(ipAddress || ''))?.is_shared_network);
  for (const candidate of candidates) {
    let confidence = 0;
    const reasons = [];
    const candidateIp = candidate.ip_address;
    const independent = [];
    if (ipAddress && candidateIp && String(ipAddress) === String(candidateIp)) {
      if (!sharedIp) { confidence += 50; independent.push('SAME_IP'); }
      else confidence += 25;
      reasons.push('SAME_IP');
      if (candidate.is_flagged) { confidence += 30; reasons.push('SAME_IP_AS_FLAGGED'); }
    }
    if (avatar && candidate.avatar_hash && String(avatar) === String(candidate.avatar_hash)) {
      confidence += 40;
      independent.push('SAME_AVATAR');
      reasons.push('SAME_AVATAR');
    }
    const candidateNormalized = normalizeUsername(candidate.username);
    if (normalized.length >= 4 && candidateNormalized.length >= 4 && normalized === candidateNormalized) {
      confidence += 20;
      independent.push('SIMILAR_USERNAME');
      reasons.push('SIMILAR_USERNAME');
    }
    const otherCreated = new Date(candidate.account_created || 0).getTime();
    const currentCreated = Number(createdTimestamp);
    if (currentCreated && otherCreated && Math.abs(currentCreated - otherCreated) <= 3600000) {
      confidence += 25;
      reasons.push('SAME_CREATION_BATCH');
    }
    if (snowflakeDistance(id, candidate.user_id) <= 1000) {
      confidence += 10;
      reasons.push('SEQUENTIAL_IDS');
    }
    const flaggedIp = Boolean(candidate.is_flagged || getMemory().ips.get(String(candidateIp || ''))?.flagged);
    if (independent.length >= 2 || flaggedIp) results.push({ userId: candidate.user_id, confidence: Math.min(confidence, 100), reasons });
  }
  const sql = getSql();
  if (sql && results.length) {
    const placeholders = results.map((_, index) => `($${index * 4 + 1},$${index * 4 + 2},$${index * 4 + 3},$${index * 4 + 4})`).join(',');
    const params = results.flatMap(alt => [id, alt.userId, alt.confidence, alt.reasons]);
    await sql(`INSERT INTO alt_groups (primary_user_id,alt_user_id,confidence,reason) VALUES ${placeholders}
      ON CONFLICT (primary_user_id,alt_user_id) DO UPDATE SET confidence=EXCLUDED.confidence, reason=EXCLUDED.reason`, params);
  } else if (!sql) {
    const memory = getMemory();
    for (const alt of results) {
      const existing = memory.alts.find(item => item.primary_user_id === id && item.alt_user_id === alt.userId);
      if (existing) Object.assign(existing, { confidence: alt.confidence, reason: alt.reasons });
      else memory.alts.push({ primary_user_id: id, alt_user_id: alt.userId, confidence: alt.confidence, reason: alt.reasons });
    }
  }
  return { alts: results, totalAltScore: Math.min(results.reduce((total, alt) => total + alt.confidence, 0), 100) };
}

module.exports = { detectAlts };
