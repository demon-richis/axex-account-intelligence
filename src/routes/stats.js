const router = require('express').Router();
const { getSql, getMemory } = require('../db/client');

const thresholds = [['allow', 0], ['monitor', 26], ['challenge', 51], ['queue', 76], ['block', 91]];

router.get('/accuracy', async (req, res) => {
  try {
    const sql = getSql();
    let observations;
    if (sql) {
      observations = await sql('SELECT o.outcome, u.risk_score FROM outcomes o JOIN user_intelligence u ON u.user_id=o.user_id');
    } else {
      const memory = getMemory();
      observations = memory.outcomes.map(outcome => ({ outcome: outcome.outcome, risk_score: memory.users.get(outcome.user_id)?.risk_score ?? memory.users.get(outcome.user_id)?.riskScore }));
    }
    const breakdown = thresholds.map(([threshold, cutoff]) => {
      const predicted = observations.filter(row => Number(row.risk_score) >= cutoff);
      return { threshold, flagged: predicted.length, confirmed_bad: predicted.filter(row => row.outcome === 'confirmed_bad' || row.outcome === 'false_negative').length, false_positives: predicted.filter(row => row.outcome === 'false_positive').length };
    });
    res.json({ thresholds: breakdown, analyzedAt: new Date().toISOString() });
  } catch (_) { res.status(503).json({ error: 'Accuracy statistics unavailable' }); }
});

router.get('/', async (req, res) => {
  try {
    const sql = getSql();
    let stats;
    if (sql) {
      const [users, ips, alts, flags, flaggedIps] = await Promise.all([
        sql('SELECT COUNT(*)::int AS n, COALESCE(AVG(risk_score),0)::int AS avg FROM user_intelligence'),
        sql('SELECT COUNT(*)::int AS n FROM ip_records'),
        sql('SELECT COUNT(*)::int AS n FROM alt_groups'),
        sql("SELECT COUNT(*)::int AS n FROM flagged_accounts WHERE active=TRUE"),
        sql('SELECT COUNT(*)::int AS n FROM ip_records WHERE flagged=TRUE')
      ]);
      const distribution = await sql('SELECT risk_level,COUNT(*)::int AS n FROM user_intelligence GROUP BY risk_level');
      stats = { totalUsers: users[0].n, avgRiskScore: users[0].avg, totalIPs: ips[0].n, altGroupsDetected: alts[0].n, flaggedUsers: flags[0].n, flaggedIPs: flaggedIps[0].n, riskDistribution: Object.fromEntries(distribution.map(row => [row.risk_level, row.n])) };
    } else {
      const memory = getMemory();
      const users = [...memory.users.values()];
      const riskDistribution = {};
      users.forEach(user => { const level = user.risk_level || user.riskLevel || 'clean'; riskDistribution[level] = (riskDistribution[level] || 0) + 1; });
      stats = { totalUsers: users.length, flaggedUsers: [...memory.flags.values()].filter(flag => flag.active).length, totalIPs: memory.ips.size, flaggedIPs: [...memory.ips.values()].filter(ip => ip.flagged).length, altGroupsDetected: memory.alts.length, avgRiskScore: users.length ? Math.round(users.reduce((total, user) => total + (user.risk_score || user.riskScore || 0), 0) / users.length) : 0, riskDistribution };
    }
    res.json({ ...stats, analyzedAt: new Date().toISOString() });
  } catch (_) { res.status(503).json({ error: 'Stats unavailable' }); }
});

module.exports = router;
