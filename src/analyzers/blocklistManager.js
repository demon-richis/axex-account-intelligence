const net = require('net');
const { getSql, getMemory } = require('../db/client');

const sources = [
  { url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset', kind: 'abuse' },
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', kind: 'proxy' },
  { url: 'https://check.torproject.org/torlist/all', kind: 'tor' },
  { url: 'https://check.torproject.org/torbulkexitlist', kind: 'tor' },
  { url: 'https://www.dan.me.uk/torlist/?exit', kind: 'tor' }
];

const pendingSources = new Map();

function normalizeCidr(value) {
  let raw = String(value || '').trim().split(/\s+/)[0];
  if (!raw || raw.startsWith('#')) return null;
  if (!raw.includes('/') && raw.includes(':') && raw.split(':').length === 2 && net.isIP(raw) === 0) raw = raw.split(':')[0];
  const [address, prefixText] = raw.split('/');
  const version = net.isIP(address);
  if (!version) return null;
  const prefix = prefixText == null ? (version === 4 ? 32 : 128) : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > (version === 4 ? 32 : 128)) return null;
  return `${address}/${prefix}`;
}

async function fetchSource(source) {
  if (pendingSources.has(source.url)) return pendingSources.get(source.url);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(source.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`blocklist returned ${response.status}`);
      const text = await response.text();
      return [...new Set(text.split(/\r?\n/).map(normalizeCidr).filter(Boolean))].map(cidr => ({ cidr, source: source.url, kind: source.kind }));
    } finally { clearTimeout(timeout); }
  })();
  pendingSources.set(source.url, request);
  try { return await request; } finally { pendingSources.delete(source.url); }
}

async function insertRows(rows) {
  if (!rows.length) return;
  const sql = getSql();
  if (sql) {
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500);
      const statement = buildBlocklistInsert(batch);
      await sql(statement.text, statement.params);
    }
  } else {
    const memory = getMemory();
    for (const row of rows) if (!memory.blocklists.some(existing => existing.cidr === row.cidr)) memory.blocklists.push(row);
  }
}

function buildBlocklistInsert(batch) {
  const values = batch.map((_, index) => `($${index * 3 + 1}::cidr,$${index * 3 + 2},$${index * 3 + 3})`).join(',');
  return { text: `INSERT INTO ip_blocklists (cidr,source,kind) VALUES ${values} ON CONFLICT (cidr) DO NOTHING`, params: batch.flatMap(row => [row.cidr, row.source, row.kind]) };
}

async function refreshBlocklists() {
  const results = await Promise.all(sources.map(source => fetchSource(source).catch(error => { console.warn(`Blocklist refresh failed for ${source.url}: ${error.message}`); return []; })));
  const rows = results.flat();
  await insertRows(rows);
  return { refreshed: rows.length, sources: sources.length };
}

function ipToBigInt(address) {
  if (net.isIP(address) === 4) return BigInt(`0x${address.split('.').map(part => Number(part).toString(16).padStart(2, '0')).join('')}`);
  const groups = address.split('::');
  const left = groups[0] ? groups[0].split(':') : [];
  const right = groups[1] ? groups[1].split(':') : [];
  const expanded = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return expanded.reduce((value, group) => (value << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
}

function contains(cidr, address) {
  const [network, prefixText] = cidr.split('/');
  if (net.isIP(network) !== net.isIP(address)) return false;
  const bits = net.isIP(address) === 4 ? 32n : 128n;
  const prefix = BigInt(prefixText);
  if (prefix === 0n) return true;
  const mask = ((1n << bits) - 1n) ^ ((1n << (bits - prefix)) - 1n);
  return (ipToBigInt(network) & mask) === (ipToBigInt(address) & mask);
}

async function lookupIP(ip) {
  const sql = getSql();
  if (sql) {
    const rows = await sql('SELECT kind FROM ip_blocklists WHERE cidr >>= $1::inet', [ip]);
    return rows.map(row => row.kind);
  }
  return getMemory().blocklists.filter(row => contains(row.cidr, ip)).map(row => row.kind);
}

async function isEmpty() {
  const sql = getSql();
  if (sql) { const rows = await sql('SELECT COUNT(*)::int AS count FROM ip_blocklists'); return rows[0].count === 0; }
  return getMemory().blocklists.length === 0;
}

module.exports = { refreshBlocklists, lookupIP, isEmpty, normalizeCidr, buildBlocklistInsert };