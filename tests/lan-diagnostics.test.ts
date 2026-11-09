import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { WebSocketServer } from 'ws';
import { attachDiagnostics } from '../server/diagnostics';
import { attachRooms } from '../server/rooms';
import { checkLan } from '../server/check';

let server: Server | undefined, wss: WebSocketServer | undefined;
afterEach(async () => {
  if (wss) await new Promise<void>(resolve => wss!.close(() => resolve()));
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  server = undefined; wss = undefined;
});

async function setup(rooms = true) {
  const logs: string[] = [];
  server = createServer((req, res) => { if (!diagnostics(req, res)) res.writeHead(404).end(); });
  const diagnostics = attachDiagnostics(server, 'production', message => logs.push(message));
  if (rooms) wss = attachRooms(server, message => logs.push(message));
  else server.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, logs };
}

describe('LAN reachability diagnostics', () => {
  it('serves health without a build, identifies the same server across requests, and logs incoming requests', async () => {
    const { url, logs } = await setup();
    const response = await fetch(`${url}/__lan/health`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const health = await response.json();
    expect(health).toMatchObject({ service: 'OPENCS LAN', mode: 'production', clientAddress: '127.0.0.1', websocketPath: '/lan' });
    expect(health.serverId).toMatch(/^[a-f0-9]{12}$/);
    expect((await (await fetch(`${url}/__lan/health`)).json()).serverId).toBe(health.serverId);
    expect(logs.some(line => line.includes('TCP connected from 127.0.0.1'))).toBe(true);
    expect(logs.some(line => line.includes('HTTP GET "/__lan/health"'))).toBe(true);
    expect(logs.some(line => line.includes('LOCAL ONLY'))).toBe(true);
  });
  it('serves a standalone check page, supports HEAD, and rejects other methods', async () => {
    const { url } = await setup();
    const page = await fetch(`${url}/__lan`);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('WebSocket PASS');
    expect(html).not.toContain('src=');
    const head = await fetch(`${url}/__lan/health`, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    expect((await fetch(`${url}/__lan/health`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${url}/not-a-diagnostic`)).status).toBe(404);
  });
  it('checks real HTTP and WebSocket connections without creating a room', async () => {
    const { url, logs } = await setup();
    const report: string[] = [];
    expect(await checkLan(url, message => report.push(message))).toBe(true);
    expect(report.some(line => line.includes('HTTP PASS'))).toBe(true);
    expect(report.some(line => line.includes('WebSocket PASS'))).toBe(true);
    expect(logs.some(line => line.includes('WebSocket accepted'))).toBe(true);
  });
  it('reports a WebSocket failure separately after HTTP passes', async () => {
    const { url } = await setup(false);
    const report: string[] = [];
    expect(await checkLan(url, message => report.push(message), 300)).toBe(false);
    expect(report.some(line => line.includes('HTTP PASS'))).toBe(true);
    expect(report.some(line => line.startsWith('FAIL:'))).toBe(true);
  });
  it('rejects HTTPS rather than silently testing a different protocol', async () => {
    await expect(checkLan('https://192.168.1.7:5173')).rejects.toThrow('not HTTPS');
  });
  it('reports an HTTP deadline when a reachable socket never responds', async () => {
    server = createServer();
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const report: string[] = [];
    expect(await checkLan(`http://127.0.0.1:${port}`, message => report.push(message), 100)).toBe(false);
    expect(report.some(line => line.includes('HTTP timed out'))).toBe(true);
  });
});
