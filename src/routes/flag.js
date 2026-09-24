const router = require('express').Router();
const { getSql, getMemory } = require('../db/client');
const cache = require('../cache/scoreCache');
const { requiredId } = require('../utils/validation');

const severities = new Set(['low', 'medium', 'high', 'critical']);

router.post('/:userId', async (req, res) => {
  try {
    const id = requiredId(req.params.userId, 'userId');
    const reason = String(req.body?.reason || '').trim();
    const severity = String(req.body?.severity || 'medium').toLowerCase();
    const flaggedBy = String(req.body?.flaggedBy || 'system').trim();
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'reason is required and must be at most 500 characters' });
    if (!severities.has(severity)) return res.status(400).json({ error: 'severity must be low, medium, high, or critical' });
    if (!flaggedBy || flaggedBy.length > 64) return res.status(400).json({ error: 'flaggedBy must be 1-64 characters' });
    const sql = getSql();
    if (sql) {
      await sql('INSERT INTO flagged_accounts (user_id,reason,flagged_by,severity) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET reason=EXCLUDED.reason,flagged_by=EXCLUDED.flagged_by,severity=EXCLUDED.severity,active=TRUE', [id, reason, flaggedBy, severity]);
      await sql('INSERT INTO user_intelligence (user_id,is_flagged,flag_reason,risk_score,risk_level) VALUES ($1,TRUE,$2,100,\'critical\') ON CONFLICT (user_id) DO UPDATE SET is_flagged=TRUE,flag_reason=EXCLUDED.flag_reason,risk_score=100,risk_level=\'critical\',updated_at=NOW()', [id, reason]);
    } else {
      const memory = getMemory();
      memory.flags.set(id, { user_id: id, reason, flagged_by: flaggedBy, severity, active: true });
      const user = memory.users.get(id) || { user_id: id };
      Object.assign(user, { is_flagged: true, flag_reason: reason, risk_score: 100, risk_level: 'critical' });
      memory.users.set(id, user);
    }
    cache.invalidate(id);
    res.json({ ok: true, userId: id, flagged: true, reason, severity, flaggedBy, analyzedAt: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ error: 'Flag unavailable' });
  }
});

module.exports = router;
