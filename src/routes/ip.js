const router = require('express').Router();
const { getSql, getMemory } = require('../db/client');
const { optionalIp } = require('../utils/validation');

router.get('/:ipAddress', async (req, res) => {
  try {
    const ip = optionalIp(req.params.ipAddress);
    if (!ip) return res.status(400).json({ error: 'ipAddress is required' });
    const sql = getSql();
    const rows = sql ? await sql('SELECT * FROM ip_records WHERE ip_address=$1', [ip]) : [];
    const record = rows[0] || getMemory().ips.get(ip);
    if (!record) return res.status(404).json({ error: 'IP not found' });
    const users = record.user_ids || [];
    res.json({ ip, isVPN: Boolean(record.is_vpn), isProxy: Boolean(record.is_proxy), isTor: Boolean(record.is_tor), isDatacenter: Boolean(record.is_datacenter), riskScore: record.risk_score || 0, country: record.country_code || null, isp: record.isp || null, usersFromIP: users, userCount: users.length, flagged: Boolean(record.flagged), analyzedAt: new Date().toISOString() });
  } catch (error) {
    const status = /valid/.test(error.message) ? 400 : 503;
    res.status(status).json({ error: status === 400 ? error.message : 'IP lookup unavailable' });
  }
});

module.exports = router;
