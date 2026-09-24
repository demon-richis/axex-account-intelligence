const DISCORD_API = 'https://discord.com/api/v10';

function snowflakeCreatedAt(userId) {
  try {
    const epoch = 1420070400000n;
    return Number((BigInt(userId) >> 22n) + BigInt(epoch));
  } catch (_) {
    return null;
  }
}

async function discordRequest(path) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
      signal: controller.signal
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDiscordAccount(userId, guildId) {
  if (!process.env.DISCORD_BOT_TOKEN) return null;
  const user = await discordRequest(`/users/${encodeURIComponent(userId)}`);
  if (!user) throw new Error('Discord user was not found or is not accessible');
  const member = guildId ? await discordRequest(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`) : null;
  return {
    username: user.username || user.global_name || null,
    avatar: user.avatar || null,
    createdTimestamp: snowflakeCreatedAt(user.id || userId),
    bot: Boolean(user.bot),
    system: Boolean(user.system),
    guildMember: member ? { joinedAt: member.joined_at || null, roles: member.roles || [], pending: Boolean(member.pending) } : null,
    source: 'discord'
  };
}

module.exports = { fetchDiscordAccount, snowflakeCreatedAt };
