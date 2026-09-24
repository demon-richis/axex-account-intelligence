const router = require('express').Router();
const { recordEvent } = require('../analyzers/behaviorTracker');
const { recordGuildEvent } = require('../analyzers/guildBaseline');
const cache = require('../cache/scoreCache');
const { requiredId } = require('../utils/validation');

const eventTypes = new Set(['VERIFY_START', 'VERIFY_SUCCESS', 'VERIFY_FAIL', 'JOIN', 'CHALLENGE_FAIL']);

router.post('/', async (req, res) => {
  try {
    const { userId, guildId, eventType, clickMs, metadata } = req.body || {};
    const id = requiredId(userId, 'userId');
    const guild = requiredId(guildId, 'guildId');
    if (!eventTypes.has(eventType)) return res.status(400).json({ error: 'eventType is not supported' });
    if (clickMs != null && (!Number.isInteger(Number(clickMs)) || Number(clickMs) < 0 || Number(clickMs) > 300000)) return res.status(400).json({ error: 'clickMs must be an integer from 0 to 300000' });
    if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata))) return res.status(400).json({ error: 'metadata must be an object' });
    const event = await recordEvent(id, guild, eventType, { clickMs, metadata });
    await recordGuildEvent(guild, eventType);
    const { getSql, getMemory } = require('../db/client');
    if (getSql()) {
      if (eventType === 'VERIFY_SUCCESS') await getSql()('UPDATE user_intelligence SET total_verifications=total_verifications+1, last_seen=NOW(), updated_at=NOW() WHERE user_id=$1', [id]);
      if (eventType === 'VERIFY_FAIL' || eventType === 'CHALLENGE_FAIL') await getSql()('UPDATE user_intelligence SET failed_verifications=failed_verifications+1, last_seen=NOW(), updated_at=NOW() WHERE user_id=$1', [id]);
    } else {
      const user = getMemory().users.get(id);
      if (user && eventType === 'VERIFY_SUCCESS') user.total_verifications = (user.total_verifications || 0) + 1;
      if (user && (eventType === 'VERIFY_FAIL' || eventType === 'CHALLENGE_FAIL')) user.failed_verifications = (user.failed_verifications || 0) + 1;
    }
    cache.invalidate(id);
    res.status(201).json({ ok: true, event, recordedAt: new Date().toISOString() });
  } catch (error) {
    const status = /must be/.test(error.message) ? 400 : 503;
    res.status(status).json({ error: status === 400 ? error.message : 'Event recording unavailable' });
  }
});

module.exports = router;
