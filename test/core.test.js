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
const { analyzeJoin, recordJoin, getGuildJoinPattern } = require('../src/analyzers/joinPatternAnalyzer');

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

test('guild baseline excludes unknown ages but includes zero', async () => {
  const guildId = `baseline-unknown-${Date.now()}`;
  await recordGuildObservation(guildId, null, false);
  await recordGuildObservation(guildId, undefined, false);
  await recordGuildObservation(guildId, NaN, false);
  let baseline = await getGuildBaseline(guildId);
  assert.equal(baseline.sample_count, 0);
  assert.equal(baseline.average_account_age_days, null);
  await recordGuildObservation(guildId, 0, false);
  await recordGuildObservation(guildId, 10, false);
  baseline = await getGuildBaseline(guildId);
  assert.equal(baseline.sample_count, 2);
  assert.equal(baseline.average_account_age_days, 5);
  assert.equal(baseline.fresh_join_count, 1);
});

test('join analysis is read-only and requires multiple matching joins for a wave', () => {
  const guildId = `join-test-${Date.now()}`;
  const metadata = { accountAgeDays: 1, avatar: null };
  assert.equal(analyzeJoin(guildId, 'user-1', metadata).joinCount, 1);
  assert.equal(analyzeJoin(guildId, 'user-2', metadata).joinCount, 1);
  assert.equal(getGuildJoinPattern(guildId).joinCount, 0);
  recordJoin(guildId, 'user-1', metadata);
  recordJoin(guildId, 'user-2', metadata);
  assert.equal(analyzeJoin(guildId, 'user-3', metadata).joinCount, 3);
  assert.equal(analyzeJoin(guildId, 'user-3', metadata).accountWave, true);
});

test('join wave minimum defaults to three and never flags one joiner', () => {
  const oldMinimum = process.env.JOIN_WAVE_MIN;
  delete process.env.JOIN_WAVE_MIN;
  const guildId = `join-min-${Date.now()}`;
  assert.equal(analyzeJoin(guildId, 'only-user', { accountAgeDays: 1, avatar: null }).accountWave, false);
  recordJoin(guildId, 'one', { accountAgeDays: 1, avatar: null });
  recordJoin(guildId, 'two', { accountAgeDays: 1, avatar: null });
  recordJoin(guildId, 'three', { accountAgeDays: 1, avatar: null });
  const wave = analyzeJoin(guildId, 'four', { accountAgeDays: 1, avatar: null });
  assert.equal(wave.accountWave, true);
  if (oldMinimum == null) delete process.env.JOIN_WAVE_MIN; else process.env.JOIN_WAVE_MIN = oldMinimum;
});

test('alt detector requires independent signals', async () => {
  const { detectAlts } = require('../src/analyzers/altDetector');
  const memory = getMemory();
  memory.users.clear();
  memory.ips.clear();
  memory.alts.length = 0;
  memory.users.set('123456789012345678', { user_id: '123456789012345678', username: 'normal', avatar_hash: null, ip_address: '203.0.113.10', account_created: new Date().toISOString(), is_flagged: false, last_seen: new Date().toISOString() });
  let result = await detectAlts('123456789012345679', '203.0.113.10', 'different', null, null);
  assert.equal(result.alts.length, 0);
  memory.users.set('123456789012345680', { user_id: '123456789012345680', username: 'different', avatar_hash: 'same-avatar', ip_address: '203.0.113.11', account_created: null, is_flagged: false, last_seen: new Date().toISOString() });
  result = await detectAlts('123456789012345681', '203.0.113.11', 'different', null, 'same-avatar');
  assert.equal(result.alts.length >= 1, true);
  result = await detectAlts('123456789012345678', null, null, null, null);
  assert.equal(result.alts.length <= 50, true);
});

test('profile richness adds no missing-signal risk and enforces age', () => {
  const oldProfile = analyzeProfile({});
  assert.equal(oldProfile.score, 0);
  assert.equal(oldProfile.richness, 0);
  const created = Date.now() - 2 * 86400000;
  const full = analyzeProfile({ createdTimestamp: created, avatar: 'avatar', premiumType: 2, decoration: { asset: 'decoration' }, banner: 'banner', bio: 'hello' });
  assert.equal(full.richness, 10);
  assert.equal(full.autoCandidate, true);
  const young = analyzeProfile({ createdTimestamp: Date.now(), avatar: 'avatar', premiumType: 2, decoration: {}, banner: 'banner', bio: 'hello' });
  assert.equal(young.autoCandidate, false);
  assert.equal(analyzeProfile({ createdTimestamp: created, avatar: null }).richness, 0);
});

test('username scoring is Unicode-aware and regex patterns are safe', async () => {
  const { analyzeUsername, invalidatePatternCache } = require('../src/analyzers/usernameAnalyzer');
  for (const name of ['रोहित', 'محمد', '田中太郎', 'Иван', '😀cool']) {
    const result = await analyzeUsername(name);
    assert.equal(result.reasons.includes('LONG_SYMBOL_OR_ZALGO_RUN'), false);
  }
  assert.equal((await analyzeUsername('user12345678')).score > 0, true);
  assert.equal((await analyzeUsername('xX_a8f3k2j9d1_Xx')).score > 0, true);
  const memory = getMemory();
  memory.patterns.length = 0;
  memory.patterns.push({ pattern: '(a+)+', pattern_type: 'regex', score_addition: 40, description: 'unsafe' });
  invalidatePatternCache();
  assert.equal((await analyzeUsername('aaaa')).score <= 60, true);
  assert.equal((await analyzeUsername('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).score <= 60, true);
  memory.patterns.length = 0;
  invalidatePatternCache();
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

test('POST analyze accepts JSON and preserves GET compatibility', async () => {
  const http = require('node:http');
  const originalApiKey = process.env.API_KEY;
  const originalDiscord = process.env.DISCORD_TOKEN;
  process.env.API_KEY = 'test-post-key';
  delete process.env.DISCORD_TOKEN;
  const { app } = require('../index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (method, path, body) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { 'X-API-Key': 'test-post-key', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  const get = await request('GET', '/analyze/123456789012345678?username=normalname&createdTimestamp=1500000000000');
  const post = await request('POST', '/analyze/123456789012345678', { username: 'normalname', createdTimestamp: 1500000000000, ip: 'not-an-ip', referenceId: 'portal-123' });
  await new Promise(resolve => server.close(resolve));
  if (originalApiKey == null) delete process.env.API_KEY; else process.env.API_KEY = originalApiKey;
  if (originalDiscord == null) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = originalDiscord;
  assert.equal(post.status, 200);
  assert.equal(post.body.referenceId, 'portal-123');
  assert.equal(post.body.riskScore, get.body.riskScore);
  assert.equal(post.body.userId, get.body.userId);
  assert.ok(post.body.username);
  assert.ok(post.body.breakdown);
  assert.equal(post.body.scoreVersion, '2.1');
});
