import { randomBytes } from 'node:crypto';
import { get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { privateAddress } from './rooms';

export const healthPath = '/__lan/health';
export const checkPath = '/__lan';
export type LanLog = (message: string) => void;
export const lanLog: LanLog = message => console.log(`[OPENCS LAN ${new Date().toISOString()}] ${message}`);

export function lanAddresses(port: number) {
  return Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? [])
    .filter(ip => ip.family === 'IPv4' && !ip.internal && privateAddress(ip.address))
    .map(ip => ({ interface: name, url: `http://${ip.address}:${port}` })));
}

// Deliberately independent of Vite, WebGL, assets, and the game's JavaScript.
const checkPage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPENCS LAN connection test</title>
<style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:0 20px;background:#101820;color:#eef}a{color:#8df}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:#192733}button{padding:10px}</style>
<h1>OPENCS LAN connection test</h1>
<p>This page loaded: your browser can reach the host over HTTP. No game assets are needed.</p>
<p>Use the same Wi-Fi URL on both computers, not localhost. Share the report below if a test fails.</p>
<button id="retry">Run again</button> <a href="/">Open game</a>
<pre id="report" aria-live="polite"></pre>
<script>
const report = document.querySelector('#report');
let running = false;
async function run() {
  if (running) return;
  running = true;
  report.textContent = '';
  const log = message => { report.textContent += message + '\\n'; console.info('[OPENCS LAN]', message); };
  log('Time: ' + new Date().toISOString());
  log('Page: ' + location.href);
  log('Browser: ' + navigator.userAgent);
  try {
    const start = performance.now();
    const response = await fetch('${healthPath}', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const health = await response.json();
    log('HTTP PASS (' + Math.round(performance.now() - start) + ' ms)');
    log(JSON.stringify(health, null, 2));
  } catch (error) { log('HTTP FAIL: ' + error.message); }
  await new Promise(resolve => {
    const start = performance.now();
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/lan');
    let finished = false;
    const done = message => { if (finished) return; finished = true; clearTimeout(timer); log(message); ws.close(); resolve(); };
    const timer = setTimeout(() => done('WebSocket FAIL: no hello within 5 seconds'), 5000);
    ws.onmessage = event => { try { if (JSON.parse(event.data).type === 'hello') done('WebSocket PASS (' + Math.round(performance.now() - start) + ' ms). Room server reachable.'); } catch {} };
    ws.onerror = () => done('WebSocket FAIL: connection rejected or blocked; check the host terminal logs.');
    ws.onclose = event => done('WebSocket FAIL: closed with code ' + event.code);
  });
  log('If both pass but the game fails, open browser developer tools and share Console errors.');
  running = false;
}
document.querySelector('#retry').onclick = run;
run();
</script></html>`;

export function attachDiagnostics(server: Server, mode: 'development' | 'production', log: LanLog = lanLog) {
  const serverId = randomBytes(6).toString('hex');
  const verbose = process.env.OPENCS_LAN_DEBUG === '1';
  server.on('connection', socket => {
    // A timeout with no incoming TCP entry means the request never reached Node.
    log(`TCP connected from ${socket.remoteAddress}:${socket.remotePort} to ${socket.localAddress}:${socket.localPort}`);
    socket.on('error', error => log(`TCP error: ${error.message}`));
  });
  server.on('listening', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    log(`Server ${serverId}, ${mode}, listening on ${address.address}:${address.port}`);
    if (address.address === '127.0.0.1' || address.address === '::1') {
      log('LOCAL ONLY: guests cannot reach this server. Start npm run lan instead.');
      return;
    }
    for (const entry of lanAddresses(address.port)) log(`Share (${entry.interface}): ${entry.url}/ | Connection test: ${entry.url}${checkPath}`);
    log('Host and guests must use the SAME Wi-Fi URL. A separate localhost server can have different rooms.');
    log('Guest timeout with no TCP log: check guest VPN/proxy, host Local Network permission, firewall, and Wi-Fi client isolation.');
    // macOS can allow a loopback listener and a wildcard listener on the same port.
    const probe = get(`http://127.0.0.1:${address.port}${healthPath}`, res => {
      let body = '';
      res.on('data', chunk => { if (body.length < 4096) body += chunk; });
      res.on('end', () => {
        try { if (JSON.parse(body).serverId === serverId) return; } catch {}
        log('WARNING: 127.0.0.1 reaches a DIFFERENT server on this port. Stop the old server or use npm run lan -- --port 5175. Open the printed Wi-Fi URL on BOTH machines.');
      });
      res.on('error', () => {});
    });
    probe.setTimeout(2000, () => probe.destroy());
    probe.on('error', () => {});
  });
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    if (verbose || path === '/' || path === checkPath || path === healthPath) {
      const start = Date.now();
      log(`HTTP ${req.method} ${JSON.stringify(path.slice(0, 180))} from ${req.socket.remoteAddress}`);
      res.once('finish', () => log(`HTTP ${res.statusCode} ${JSON.stringify(path.slice(0, 180))} ${Date.now() - start}ms`));
    }
    if (path !== checkPath && path !== healthPath) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!privateAddress(req.socket.remoteAddress)) { res.writeHead(403).end('LAN only'); return true; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return true; }
    const port = req.socket.localPort ?? 5173;
    const body = path === checkPath ? checkPage : JSON.stringify({
      service: 'OPENCS LAN', serverId, mode, time: new Date().toISOString(),
      clientAddress: req.socket.remoteAddress, serverAddress: req.socket.localAddress,
      port, addresses: lanAddresses(port), websocketPath: '/lan',
    });
    res.writeHead(200, { 'Content-Type': path === checkPath ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
