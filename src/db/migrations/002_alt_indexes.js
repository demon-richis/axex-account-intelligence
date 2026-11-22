module.exports = {
  statements: [
    `CREATE INDEX IF NOT EXISTS user_intelligence_ip_last_seen_idx ON user_intelligence (ip_address, last_seen)`,
    `CREATE INDEX IF NOT EXISTS user_intelligence_avatar_hash_idx ON user_intelligence (avatar_hash)`,
    `CREATE INDEX IF NOT EXISTS user_intelligence_username_lower_idx ON user_intelligence (lower(username))`
  ]
};
