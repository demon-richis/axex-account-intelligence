const DISCORD_API = 'https://discord.com/api/v10';
const PROFILE_TTL = 60 * 60 * 1000;
const profileCache = new Map();
let unavailableUntil = 0;

function snowflakeCreatedAt(userId) {
  try {
    const epoch = 1420070400000n;
    return Number((BigInt(userId) >> 22n) + BigInt(epoch));
  } catch (_) {
    return null;
  }
}

async function discordRequest(path) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
      signal: controller.signal
    });
    if (response.status === 404) return null;
    if (response.status === 429) {
      let body = {};
      try { body = await response.json(); } catch (_) {}
      const retryAfter = Math.max(1, Number(body.retry_after || body.retryAfter || response.headers?.get?.('retry-after') || 1));
      unavailableUntil = Date.now() + retryAfter * 1000;
      const error = new Error(`Discord API rate limited; retrying in ${retryAfter}s`);
      error.status = 429;
      error.retryAfter = retryAfter;
      throw error;
    }
    if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDiscordAccount(userId, guildId) {
  if (!process.env.DISCORD_TOKEN || Date.now() < unavailableUntil) return null;
  const cached = profileCache.get(String(userId));
  if (cached && Date.now() - cached.timestamp < PROFILE_TTL) return cached.data;
  if (cached) profileCache.delete(String(userId));
  const user = await discordRequest(`/users/${encodeURIComponent(userId)}`);
  if (!user) throw new Error('Discord user was not found or is not accessible');
  const member = guildId ? await discordRequest(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`) : null;
  const account = {
    username: user.username || user.global_name || null,
    avatar: user.avatar || null,
    bio: user.bio,
    connections: Array.isArray(user.connections) ? user.connections : undefined,
    createdTimestamp: snowflakeCreatedAt(user.id || userId),
    bot: Boolean(user.bot),
    system: Boolean(user.system),
    guildMember: member ? { joinedAt: member.joined_at || null, roles: member.roles || [], pending: Boolean(member.pending) } : null,
    source: 'discord'
  };
  profileCache.set(String(userId), { data: account, timestamp: Date.now() });
  return account;
}

function resetDiscordCache() { profileCache.clear(); unavailableUntil = 0; }

module.exports = { fetchDiscordAccount, snowflakeCreatedAt, resetDiscordCache };
