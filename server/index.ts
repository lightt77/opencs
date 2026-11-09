import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { attachRooms, privateAddress } from './rooms';

const root = resolve('dist'), port = Number(process.env.PORT ?? 5173);
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  if (!privateAddress(req.socket.remoteAddress)) { res.writeHead(403).end('LAN only'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const info = await stat(file); if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end('Not found. Run npm run build first.'); }
});
attachRooms(server);
server.listen(port, '0.0.0.0', () => {
  console.log(`OPENCS LAN: http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) for (const ip of list ?? []) if (ip.family === 'IPv4' && !ip.internal && privateAddress(ip.address)) console.log(`Share on your Wi-Fi: http://${ip.address}:${port}`);
});
