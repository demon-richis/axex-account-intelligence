function riskLevel(score) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  return value <= 25 ? 'clean' : value <= 50 ? 'low' : value <= 75 ? 'high' : 'critical';
}

function recommendation(score) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  return value <= 25 ? 'allow' : value <= 50 ? 'monitor' : value <= 75 ? 'challenge' : value <= 90 ? 'queue' : 'block';
}

module.exports = { riskLevel, recommendation };
