const express = require('express');
const crypto = require('crypto');
const { recordEvent } = require('../analyzers/behaviorTracker');
const { requiredId } = require('../utils/validation');

const publicRouter = express.Router();
const protectedRouter = express.Router();
const tokens = new Map();
const attempts = new Map();
const TOKEN_TTL = 10 * 60 * 1000;
const WINDOW = 60 * 1000;
const LIMIT = 5;

function sweep() {
  const now = Date.now();
  for (const [token, value] of tokens) if (value.expiresAt <= now) tokens.delete(token);
  for (const [ip, value] of attempts) if (value.startedAt + WINDOW <= now) attempts.delete(ip);
}

protectedRouter.post('/create', (req, res) => {
  try {
    const userId = requiredId(req.body?.userId, 'userId');
    const guildId = requiredId(req.body?.guildId, 'guildId');
    sweep();
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + TOKEN_TTL;
    tokens.set(token, { userId, guildId, expiresAt });
    res.status(201).json({ token, url: `/v/${token}`, expiresAt });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

publicRouter.get('/:token', (req, res) => {
  sweep();
  const entry = tokens.get(req.params.token);
  if (!entry) return res.status(404).type('text/plain').send('Verification link expired or not found.');
  res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verification</title></head><body><p>Keep this page open for a moment while verification completes.</p></body></html>');
});

publicRouter.post('/:token/complete', async (req, res) => {
  sweep();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = attempts.get(ip);
  if (!attempt || now - attempt.startedAt >= WINDOW) attempts.set(ip, { startedAt: now, count: 1 });
  else { attempt.count += 1; if (attempt.count > LIMIT) return res.status(429).json({ error: 'Too many verification attempts' }); }
  const entry = tokens.get(req.params.token);
  if (!entry) return res.status(400).json({ error: 'Verification link expired or not found' });
  tokens.delete(req.params.token);
  try {
    await recordEvent(entry.userId, entry.guildId, 'WEB_IP_CAPTURED', { metadata: { ip } });
    res.json({ ok: true, code: crypto.randomBytes(4).toString('hex').toUpperCase() });
  } catch (_) { res.status(503).json({ error: 'Verification capture unavailable' }); }
});

module.exports = { publicRouter, protectedRouter, tokens };
