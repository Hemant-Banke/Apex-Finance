const dns = require('dns').promises;
const net = require('net');
const { badRequest } = require('./httpError');

// A user-supplied endpoint is fetched by OUR server, so it must not reach our own network.
function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** A public https base URL, or a 400. Checked again on every use: DNS can change after saving. */
async function assertPublicHttps(raw) {
  let url;
  try { url = new URL(raw); } catch { throw badRequest('Enter a valid URL'); }
  if (url.protocol !== 'https:') throw badRequest('The endpoint must use https');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('That endpoint\'s host could not be found');
  if (addrs.some(a => isPrivate(a.address))) throw badRequest('That endpoint points to a private network');
  return url.toString().replace(/\/+$/, '');
}

module.exports = { assertPublicHttps };
