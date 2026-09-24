const { getSql, getMemory } = require('../db/client');

const highRiskCountries = new Set((process.env.HIGH_RISK_COUNTRIES || 'RU,KP,IR').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
const sharedAsns = new Set((process.env.SHARED_NETWORK_ASNS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
const sharedIsps = (process.env.SHARED_NETWORK_ISPS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

async function analyzeIP(ipAddress, userId) {
  if (!ipAddress) return { score: 0, reasons: [], data: null };
  const ip = String(ipAddress);
  let record = null;
  try {
    const sql = getSql();
    const rows = sql ? await sql("SELECT * FROM ip_records WHERE ip_address=$1 AND last_seen > NOW()-INTERVAL '24 hours'", [ip]) : [];
    record = rows[0] || (!sql ? getMemory().ips.get(ip) : null);
  } catch (_) { record = getMemory().ips.get(ip); }
  if (!record) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,proxy,hosting,query,country,countryCode,regionName,isp,as`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`IP provider returned ${response.status}`);
      const data = await response.json();
      if (data.status !== 'success') throw new Error(data.message || 'IP provider rejected lookup');
      const isp = String(data.isp || '');
      record = { ip_address: ip, is_vpn: false, is_proxy: Boolean(data.proxy), is_tor: false, is_datacenter: Boolean(data.hosting), is_shared_network: sharedAsns.has(String(data.as || '').toUpperCase()) || sharedIsps.some(value => isp.toLowerCase().includes(value)), country_code: data.countryCode, region: data.regionName, asn: data.as, isp: data.isp, risk_score: 0, user_ids: [], flagged: false };
    } catch (_) {
      record = { ip_address: ip, is_vpn: false, is_proxy: false, is_tor: false, is_datacenter: false, is_shared_network: false, country_code: null, isp: null, risk_score: 0, user_ids: [], flagged: false };
    }
  }
  const storedIsp = String(record.isp || '');
  record.is_shared_network = Boolean(record.is_shared_network || sharedAsns.has(String(record.asn || '').toUpperCase()) || sharedIsps.some(value => storedIsp.toLowerCase().includes(value)));
  record.user_ids = Array.from(new Set([...(record.user_ids || []), ...(userId ? [String(userId)] : [])]));
  let score = 0;
  const reasons = [];
  if (record.is_proxy) { score += 40; reasons.push('PROXY_IP'); }
  if (record.is_vpn) { score += 35; reasons.push('VPN_IP'); }
  if (record.is_datacenter) { score += 30; reasons.push('DATACENTER_IP'); }
  if (record.is_tor) { score += 50; reasons.push('TOR_IP'); }
  if (record.country_code && highRiskCountries.has(String(record.country_code).toUpperCase())) { score += 10; reasons.push('HIGH_RISK_COUNTRY'); }
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
  return { score: Math.min(score, 100), reasons, data: record };
}

async function isKnownBadIP(ipAddress) {
  const ip = String(ipAddress || '');
  const sql = getSql();
  if (sql) {
    const rows = await sql('SELECT flagged FROM ip_records WHERE ip_address=$1', [ip]);
    return Boolean(rows[0]?.flagged);
  }
  return Boolean(getMemory().ips.get(ip)?.flagged);
}

module.exports = { analyzeIP, isKnownBadIP };
