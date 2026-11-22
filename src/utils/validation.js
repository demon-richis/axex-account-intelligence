const net = require('net');

function requiredId(value, name) {
  const id = String(value || '').trim();
  if (!/^\d{17,20}$/.test(id)) throw new Error(`${name} must be a valid Discord snowflake`);
  return id;
}

function optionalId(value, name) {
  if (value == null || value === '') return null;
  return requiredId(value, name);
}

function optionalIp(value) {
  if (value == null || value === '') return null;
  const ip = String(value).trim();
  if (!net.isIP(ip)) throw new Error('ip must be a valid IPv4 or IPv6 address');
  return ip;
}

function optionalTimestamp(value) {
  if (value == null || value === '') return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now()) {
    throw new Error('createdTimestamp must be a valid non-future timestamp');
  }
  return timestamp;
}

function optionalUsername(value) {
  if (value == null || value === '') return null;
  const username = String(value).trim();
  if (username.length < 2 || username.length > 32) throw new Error('username must be 2-32 characters');
  return username;
}

module.exports = { requiredId, optionalId, optionalIp, optionalTimestamp, optionalUsername };