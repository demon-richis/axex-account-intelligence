const router = require('express').Router();
const { getSql, getMemory } = require('../db/client');
const cache = require('../cache/scoreCache');
const { requiredId } = require('../utils/validation');

const allowed = new Set(['confirmed_bad', 'confirmed_good', 'false_positive', 'false_negative']);

router.post('/', async (req, res) => {
  try {
    const userId = requiredId(req.body?.userId, 'userId');
    const guildId = requiredId(req.body?.guildId, 'guildId');
    const outcome = String(req.body?.outcome || '');
    const decidedBy = String(req.body?.decidedBy || 'system').trim();
    if (!allowed.has(outcome)) return res.status(400).json({ error: 'outcome is not supported' });
    if (!decidedBy || decidedBy.length > 64) return res.status(400).json({ error: 'decidedBy must be 1-64 characters' });
    const sql = getSql();
    const row = { user_id: userId, guild_id: guildId, outcome, decided_by: decidedBy, created_at: new Date().toISOString() };
    if (sql) await sql('INSERT INTO outcomes (user_id,guild_id,outcome,decided_by) VALUES ($1,$2,$3,$4)', [userId, guildId, outcome, decidedBy]);
    else getMemory().outcomes.push(row);
    cache.invalidate(userId);
    res.status(201).json({ ok: true, userId, guildId, outcome, decidedBy, recordedAt: new Date().toISOString() });
  } catch (error) { res.status(/must be/.test(error.message) ? 400 : 503).json({ error: /must be/.test(error.message) ? error.message : 'Outcome recording unavailable' }); }
});

module.exports = router;