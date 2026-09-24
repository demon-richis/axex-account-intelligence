const router = require('express').Router();
const { getSql, getMemory, getActiveFlag } = require('../db/client');
const { analyzeProfile } = require('../analyzers/profileAnalyzer');
const { analyzeUsername } = require('../analyzers/usernameAnalyzer');
const { getBehaviorScore } = require('../analyzers/behaviorTracker');
const { analyzeIP } = require('../analyzers/networkAnalyzer');
const { detectAlts } = require('../analyzers/altDetector');
const { recordJoin } = require('../analyzers/joinPatternAnalyzer');
const { calculateRisk } = require('../analyzers/riskEngine');
const { fetchDiscordAccount } = require('../integrations/discord');
const { getGuildBaseline, analyzeGuildBaseline, recordGuildObservation } = require('../analyzers/guildBaseline');
const { requiredId, optionalId, optionalIp, optionalTimestamp, optionalUsername } = require('../utils/validation');
const cache = require('../cache/scoreCache');

router.get('/:userId', async (req, res) => {
  try {
    const userId = requiredId(req.params.userId, 'userId');
    const requestedUsername = optionalUsername(req.query.username);
    const ip = optionalIp(req.query.ip);
    const guildId = optionalId(req.query.guildId, 'guildId');
    const requestedTimestamp = optionalTimestamp(req.query.createdTimestamp);
    const discordAccount = await fetchDiscordAccount(userId, guildId);
    const username = discordAccount?.username || requestedUsername;
    const avatar = discordAccount ? discordAccount.avatar : req.query.avatar;
    const createdTimestamp = discordAccount?.createdTimestamp || requestedTimestamp;
    const profile = analyzeProfile({ username, avatar, createdTimestamp });
    const usernameResult = await analyzeUsername(username || '');
    const behavior = await getBehaviorScore(userId);
    const network = await analyzeIP(ip, userId);
    const alt = await detectAlts(userId, ip, username, createdTimestamp);
    const baseline = guildId ? await getGuildBaseline(guildId) : null;
    const joinWave = guildId ? recordJoin(guildId, userId, { accountAgeDays: profile.ageDays, avatar }) : { score: 0, reasons: [] };
    const guildSignal = guildId ? analyzeGuildBaseline(baseline, profile.ageDays) : { score: 0, reasons: [], baseline: null };
    const join = { ...joinWave, score: Math.min(100, joinWave.score + guildSignal.score), reasons: [...(joinWave.reasons || []), ...guildSignal.reasons], guildBaseline: guildSignal };
    if (getSql() && guildId) await getSql()('INSERT INTO join_patterns (guild_id,user_id,account_age_days,risk_score,was_raid) VALUES ($1,$2,$3,$4,$5)', [guildId, userId, profile.ageDays, join.score, Boolean(join.isRaid)]);
    if (guildId) await recordGuildObservation(guildId, profile.ageDays, Boolean(join.isRaid));
    const flag = await getActiveFlag(userId);
    const previousRows = getSql() ? await getSql()('SELECT risk_score FROM user_intelligence WHERE user_id=$1', [userId]) : [];
    const previous = previousRows[0]?.risk_score ?? getMemory().users.get(userId)?.risk_score;
    const result = calculateRisk(profile, usernameResult, behavior, network, alt, join, { isFlagged: Boolean(flag), sameIpAsBanned: Boolean(network.data?.flagged) });
    const accountCreated = createdTimestamp ? new Date(createdTimestamp).toISOString() : null;
    const record = { user_id: userId, username, avatar_hash: avatar || null, ip_address: ip, account_created: accountCreated, risk_score: result.finalScore, risk_level: result.riskLevel, profile_score: profile.score, username_score: usernameResult.score, behavior_score: behavior.score, network_score: network.score, is_flagged: Boolean(flag), flag_reason: flag?.reason || null, last_seen: new Date().toISOString() };
    const sql = getSql();
    if (sql) {
      await sql('INSERT INTO user_intelligence (user_id,username,avatar_hash,ip_address,account_created,risk_score,risk_level,profile_score,username_score,behavior_score,network_score,is_flagged,flag_reason,last_seen,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) ON CONFLICT (user_id) DO UPDATE SET username=EXCLUDED.username,avatar_hash=EXCLUDED.avatar_hash,ip_address=EXCLUDED.ip_address,account_created=COALESCE(EXCLUDED.account_created,user_intelligence.account_created),risk_score=EXCLUDED.risk_score,risk_level=EXCLUDED.risk_level,profile_score=EXCLUDED.profile_score,username_score=EXCLUDED.username_score,behavior_score=EXCLUDED.behavior_score,network_score=EXCLUDED.network_score,is_flagged=EXCLUDED.is_flagged,flag_reason=EXCLUDED.flag_reason,last_seen=NOW(),updated_at=NOW()', [userId, record.username, record.avatar_hash, record.ip_address, record.account_created, record.risk_score, record.risk_level, record.profile_score, record.username_score, record.behavior_score, record.network_score, record.is_flagged, record.flag_reason]);
    } else {
      getMemory().users.set(userId, record);
    }
    if (previous != null && Number(previous) !== result.finalScore) {
      const historyReason = result.reasons.slice(0, 5).join(',') || 'SCORE_UPDATED';
      if (sql) await sql('INSERT INTO risk_history (user_id,old_score,new_score,reason) VALUES ($1,$2,$3,$4)', [userId, Number(previous), result.finalScore, historyReason]);
      else getMemory().history.push({ user_id: userId, old_score: Number(previous), new_score: result.finalScore, reason: historyReason, changed_at: new Date().toISOString() });
    }
    cache.set(userId, { riskScore: result.finalScore, riskLevel: result.riskLevel, recommendation: result.recommendation });
    res.json({ userId, username, dataSource: discordAccount ? 'discord' : 'request', riskScore: result.finalScore, riskLevel: result.riskLevel, recommendation: result.recommendation, breakdown: result.breakdown, reasons: result.reasons, cached: false, analyzedAt: new Date().toISOString() });
  } catch (error) {
    const status = /must be|must have|valid|characters/.test(error.message) ? 400 : 503;
    console.error('analysis:', error.message);
    res.status(status).json({ error: status === 400 ? error.message : 'Analysis unavailable' });
  }
});

module.exports = router;
