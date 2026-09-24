function analyzeProfile(user = {}) {
  let score = 0; const reasons = []; const created = Number(user.createdTimestamp);
  const ageDays = Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null;
  if (ageDays !== null) { if (ageDays < 1) { score += 40; reasons.push('ACCOUNT_UNDER_1_DAY'); } else if (ageDays < 7) { score += 20; reasons.push('ACCOUNT_UNDER_7_DAYS'); } else if (ageDays < 30) { score += 10; reasons.push('ACCOUNT_UNDER_30_DAYS'); } else if (ageDays < 90) { score += 5; reasons.push('ACCOUNT_UNDER_90_DAYS'); } }
  if (!user.avatar) { score += 20; reasons.push('DEFAULT_AVATAR'); }
  if (user.bio !== undefined && !user.bio) { score += 5; reasons.push('NO_BIO'); }
  if (Array.isArray(user.connections) && user.connections.length === 0) { score += 5; reasons.push('NO_CONNECTIONS'); }
  return { score: Math.min(score, 100), reasons, ageDays };
}
module.exports = { analyzeProfile };
