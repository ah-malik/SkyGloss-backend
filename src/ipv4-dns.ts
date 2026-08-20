import * as dns from 'dns';
import * as net from 'net';

// Windows Node often tries IPv6 first. Hosts without AAAA (e.g. api.wise-sandbox.com)
// then fail with getaddrinfo ENOTFOUND instead of falling back to IPv4.
dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
