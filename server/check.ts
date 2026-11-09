import { get } from 'node:http';
import { WebSocket } from 'ws';
import { healthPath, type LanLog } from './diagnostics';

export async function checkLan(address: string, log: LanLog = console.log, timeout = 5000) {
  const url = new URL(address);
  if (url.protocol !== 'http:') throw new Error('Use the host http://Wi-Fi-IP:port URL, not HTTPS.');
  url.pathname = healthPath; url.search = ''; url.hash = '';
  log(`Testing ${url.origin} directly (no browser/system HTTP proxy).`);
  const started = Date.now();
  try {
    const health = await new Promise<{ service: string; serverId: string }>((resolve, reject) => {
      const req = get(url, res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
          if (body.length > 64 * 1024) req.destroy(new Error('Unexpectedly large health response.'));
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${body.slice(0, 160)}`);
            const data = JSON.parse(body);
            if (data.service !== 'OPENCS LAN') throw new Error('This address is not an OPENCS LAN server.');
            log(JSON.stringify(data, null, 2)); resolve(data);
          } catch (error) { reject(error); }
        });
      });
      const timer = setTimeout(() => req.destroy(new Error('HTTP timed out: no health response.')), timeout);
      req.once('close', () => clearTimeout(timer));
      req.on('error', reject);
    });
    log(`HTTP PASS (${Date.now() - started}ms), server ${health.serverId}`);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${url.host}/lan`, { origin: url.origin, handshakeTimeout: timeout });
      let passed = false;
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket hello timed out.')); }, timeout);
      ws.on('message', data => {
        try { if (JSON.parse(data.toString()).type === 'hello') { passed = true; clearTimeout(timer); ws.close(); resolve(); } }
        catch { ws.terminate(); reject(new Error('Invalid WebSocket response.')); }
      });
      ws.on('error', reject);
      ws.on('close', () => { clearTimeout(timer); if (!passed) reject(new Error('WebSocket closed before hello.')); });
    });
    log('WebSocket PASS. Network and room server are reachable.');
    return true;
  } catch (error) {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    log('No TCP entry in host terminal: traffic did not reach Node. Check the IP/port, VPN/proxy, Local Network permission, firewall, and router client isolation.');
    log('Probe passes but browser times out: check browser Local Network permission, proxy/HTTPS-only settings, and extensions.');
    return false;
  }
}
