const net = require('net');
const { getSql, getMemory } = require('../db/client');
const { lookupIP } = require('./blocklistManager');

const highRiskCountries = new Set((process.env.HIGH_RISK_COUNTRIES || 'RU,KP,IR').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
const sharedAsns = new Set((process.env.SHARED_NETWORK_ASNS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
const sharedIsps = (process.env.SHARED_NETWORK_ISPS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const externalLookups = new Map();

function blocklistScore(kinds) {
  return kinds.reduce((score, kind) => score + ({ proxy: 40, vpn: 35, tor: 50, datacenter: 30, abuse: 60 }[kind] || 0), 0);
}

async function fetchExternal(ip) {
  if (externalLookups.has(ip)) return externalLookups.get(ip);
  const request = (async () => {
    const template = process.env.IP_LOOKUP_URL || 'https://ipwho.is/{ip}';
    const separator = template.includes('?') ? '&' : '?';
    const fields = process.env.IP_LOOKUP_FIELDS || 'success,country_code,connection,security';
    const url = `${template.replace('{ip}', encodeURIComponent(ip))}${fields ? `${separator}fields=${encodeURIComponent(fields)}` : ''}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`IP provider returned ${response.status}`);
      const data = await response.json();
      if (data.success === false || data.status === 'fail') throw new Error(data.message || 'IP provider rejected lookup');
      const security = data.security || {};
      const connection = data.connection || {};
      const isp = data.isp || connection.isp || null;
      return { is_vpn: Boolean(security.vpn), is_proxy: Boolean(security.proxy), is_tor: Boolean(security.tor), is_datacenter: Boolean(security.hosting || security.datacenter), is_shared_network: sharedAsns.has(String(connection.asn || '').toUpperCase()) || sharedIsps.some(value => String(isp || '').toLowerCase().includes(value)), country_code: data.country_code || null, asn: connection.asn || null, isp, risk_score: 0, user_ids: [], flagged: false };
    } finally { clearTimeout(timeout); }
  })();
  externalLookups.set(ip, request);
  try { return await request; } finally { externalLookups.delete(ip); }
}

async function analyzeIP(ipAddress, userId) {
  if (!ipAddress || net.isIP(String(ipAddress)) === 0) return { score: 0, reasons: ['IP_LOOKUP_FAILED'], data: null };
  const ip = String(ipAddress);
  let record = null;
  try {
    const sql = getSql();
    const rows = sql ? await sql("SELECT * FROM ip_records WHERE ip_address=$1 AND last_seen > NOW()-INTERVAL '24 hours'", [ip]) : [];
    record = rows[0] || (!sql ? getMemory().ips.get(ip) : null);
  } catch (_) { record = getMemory().ips.get(ip); }
  let kinds = [];
  try { kinds = await lookupIP(ip); } catch (_) {}
  if (!record && !kinds.length) {
    try { record = await fetchExternal(ip); }
    catch (_) { return { score: 0, reasons: ['IP_LOOKUP_FAILED'], data: null }; }
  }
  if (!record) record = { ip_address: ip, is_vpn: false, is_proxy: false, is_tor: false, is_datacenter: false, is_shared_network: false, country_code: null, isp: null, risk_score: 0, user_ids: [], flagged: false };
  record.is_vpn = Boolean(record.is_vpn || kinds.includes('vpn'));
  record.is_proxy = Boolean(record.is_proxy || kinds.includes('proxy'));
  record.is_tor = Boolean(record.is_tor || kinds.includes('tor'));
  record.is_datacenter = Boolean(record.is_datacenter || kinds.includes('datacenter'));
  const storedIsp = String(record.isp || '');
  record.ip_address = ip;
  record.is_shared_network = Boolean(record.is_shared_network || sharedAsns.has(String(record.asn || '').toUpperCase()) || sharedIsps.some(value => storedIsp.toLowerCase().includes(value)));
  record.user_ids = Array.from(new Set([...(record.user_ids || []), ...(userId ? [String(userId)] : [])]));
  let score = blocklistScore(kinds);
  const reasons = kinds.map(kind => `BLOCKLIST_${kind.toUpperCase()}`);
  if (record.is_proxy) { score += 40; if (!kinds.includes('proxy')) reasons.push('PROXY_IP'); }
  if (record.is_vpn) { score += 35; if (!kinds.includes('vpn')) reasons.push('VPN_IP'); }
  if (record.is_datacenter) { score += 30; if (!kinds.includes('datacenter')) reasons.push('DATACENTER_IP'); }
  if (record.is_tor) { score += 50; if (!kinds.includes('tor')) reasons.push('TOR_IP'); }
  if (record.country_code && highRiskCountries.has(String(record.country_code).toUpperCase())) { score += 10; reasons.push('HIGH_RISK_COUNTRY'); }
  if (kinds.includes('abuse')) { score += 60; reasons.push('ABUSE_IP'); }
  if (record.is_shared_network) {
    reasons.push('SHARED_NETWORK_CONTEXT');
    if (record.user_ids.length >= 10) { score += 25; reasons.push('TEN_PLUS_USERS_SHARED_NETWORK'); }
    else if (record.user_ids.length >= 5) { score += 10; reasons.push('FIVE_PLUS_USERS_SHARED_NETWORK'); }
  } else if (record.user_ids.length >= 5) { score += 50; reasons.push('FIVE_PLUS_USERS_SAME_IP'); }
  else if (record.user_ids.length >= 3) { score += 25; reasons.push('THREE_PLUS_USERS_SAME_IP'); }
  record.risk_score = Math.min(score, 100);
  try {
    const sql = getSql();
    if (sql) await sql('INSERT INTO ip_records (ip_address,is_vpn,is_proxy,is_tor,is_datacenter,is_shared_network,country_code,region,asn,isp,risk_score,user_ids,flagged,last_seen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) ON CONFLICT (ip_address) DO UPDATE SET risk_score=EXCLUDED.risk_score,user_ids=EXCLUDED.user_ids,is_shared_network=EXCLUDED.is_shared_network,last_seen=NOW()', [ip, record.is_vpn, record.is_proxy, record.is_tor, record.is_datacenter, record.is_shared_network, record.country_code, record.region, record.asn, record.isp, record.risk_score, record.user_ids, record.flagged]);
    else getMemory().ips.set(ip, record);
  } catch (_) {}
  return { score: Math.min(score, 100), reasons: [...new Set(reasons)], data: record };
}

async function isKnownBadIP(ipAddress) {
  const ip = String(ipAddress || '');
  const sql = getSql();
  if (sql) { const rows = await sql('SELECT flagged FROM ip_records WHERE ip_address=$1', [ip]); return Boolean(rows[0]?.flagged); }
  return Boolean(getMemory().ips.get(ip)?.flagged);
}

module.exports = { analyzeIP, isKnownBadIP };
