const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeProfile } = require('../src/analyzers/profileAnalyzer');
const { analyzeUsername } = require('../src/analyzers/usernameAnalyzer');
const { calculateRisk } = require('../src/analyzers/riskEngine');
const { recordEvent, getBehaviorScore } = require('../src/analyzers/behaviorTracker');
const { snowflakeCreatedAt } = require('../src/integrations/discord');
const { recordGuildObservation, getGuildBaseline, analyzeGuildBaseline } = require('../src/analyzers/guildBaseline');
const { riskLevel, recommendation } = require('../src/analyzers/thresholds');
const { getMemory } = require('../src/db/client');
const { lookupIP, normalizeCidr } = require('../src/analyzers/blocklistManager');
const { resetDiscordCache, snowflakeCreatedAt: discordSnowflakeCreatedAt } = require('../src/integrations/discord');

test('unknown profile fields do not create age or avatar evidence', () => {
  const result = analyzeProfile({});
  assert.equal(result.ageDays, null);
  assert.deepEqual(result.reasons, ['ACCOUNT_AGE_UNKNOWN']);
});

test('invalid future account timestamps are ignored', () => {
  const result = analyzeProfile({ createdTimestamp: Date.now() + 86400000 });
  assert.equal(result.ageDays, null);
});

test('missing usernames do not receive a length penalty', async () => {
  assert.deepEqual(await analyzeUsername(''), { score: 0, reasons: [], patterns: [] });
});

test('risk levels and forced flags are consistent', () => {
  const high = calculateRisk({ score: 75 }, { score: 75 }, { score: 75 }, { score: 75 }, { totalAltScore: 75 }, { score: 75 });
  assert.equal(high.riskLevel, 'high');
  assert.equal(high.recommendation, 'challenge');
  const flagged = calculateRisk({}, {}, {}, {}, {}, {}, { isFlagged: true });
  assert.deepEqual([flagged.finalScore, flagged.riskLevel, flagged.recommendation], [100, 'critical', 'block']);
});

test('behavior scoring exposes independent time windows', async () => {
  const userId = `window-test-${Date.now()}`;
  await recordEvent(userId, 'guild-test', 'VERIFY_FAIL', { clickMs: 500 });
  const result = await getBehaviorScore(userId);
  assert.equal(result.windows['5m'].failures, 1);
  assert.equal(result.windows['24h'].averageClickMs, 500);
  assert.match(result.reasons.join(','), /INHUMAN_CLICK_SPEED_5_MINUTES/);
});

test('Discord snowflakes produce account creation timestamps', () => {
  assert.equal(Number.isFinite(snowflakeCreatedAt('175928847299117063')), true);
});

test('guild baselines identify large account-age outliers', async () => {
  const guildId = `baseline-test-${Date.now()}`;
  for (let index = 0; index < 10; index += 1) await recordGuildObservation(guildId, 120, false);
  const baseline = await getGuildBaseline(guildId);
  const result = analyzeGuildBaseline(baseline, 1);
  assert.equal(result.score, 15);
  assert.deepEqual(result.reasons, ['GUILD_ACCOUNT_AGE_OUTLIER']);
});

test('thresholds are shared and confidence ignores unknown age', () => {
  assert.equal(riskLevel(60), 'high');
  assert.equal(recommendation(60), 'challenge');
  assert.equal(riskLevel(80), 'critical');
  assert.equal(recommendation(80), 'queue');
  const result = calculateRisk({ score: 0, reasons: ['ACCOUNT_AGE_UNKNOWN'] }, { score: 25, reasons: ['USERNAME_PATTERN:test'] });
  assert.equal(result.confidence, 'low');
});

test('old behavior failures decay without disappearing from history', async () => {
  const userId = `decay-test-${Date.now()}`;
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  for (let index = 0; index < 5; index += 1) getMemory().events.push({ userId, guildId: 'guild', eventType: 'VERIFY_FAIL', clickMs: null, metadata: {}, createdAt: old });
  const stale = await getBehaviorScore(userId);
  assert.equal(stale.score, 0);
  assert.equal(stale.failedVerifications, 5);
  assert.ok(stale.reasons.includes('VERIFY_FAILS_STALE'));
});

test('memory blocklist lookup matches CIDR ranges', async () => {
  const memory = getMemory();
  memory.blocklists.push({ cidr: '203.0.113.0/24', source: 'test', kind: 'tor' });
  assert.equal(normalizeCidr('203.0.113.7'), '203.0.113.7/32');
  assert.deepEqual(await lookupIP('203.0.113.9'), ['tor']);
});

test('Discord 429 does not fail analysis and backs off repeat calls', async () => {
  const http = require('node:http');
  const originalFetch = global.fetch;
  const originalToken = process.env.DISCORD_TOKEN;
  const originalApiKey = process.env.API_KEY;
  let calls = 0;
  process.env.DISCORD_TOKEN = 'test-token';
  process.env.API_KEY = 'test-key';
  resetDiscordCache();
  global.fetch = async () => { calls += 1; return { status: 429, ok: false, headers: { get: () => null }, json: async () => ({ retry_after: 60 }) }; };
  const { app } = require('../index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = () => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/analyze/discord-429?username=normalname', headers: { 'X-API-Key': 'test-key' } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  const first = await request();
  const second = await request();
  await new Promise(resolve => server.close(resolve));
  global.fetch = originalFetch;
  if (originalToken == null) delete process.env.DISCORD_TOKEN;
  else process.env.DISCORD_TOKEN = originalToken;
  if (originalApiKey == null) delete process.env.API_KEY;
  else process.env.API_KEY = originalApiKey;
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.discordEnriched, false);
  assert.equal(typeof first.body.riskScore, 'number');
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.discordEnriched, false);
  assert.equal(calls, 1);
  assert.equal(Number.isFinite(discordSnowflakeCreatedAt('175928847299117063')), true);
});