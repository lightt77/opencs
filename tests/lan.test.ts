import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket, type WebSocketServer } from 'ws';
import { attachRooms, privateAddress } from '../server/rooms';
import { balancedTeam, cleanControls, operators, type Member, type Room } from '../src/lan-protocol';
import { DEFAULTS, sanitizeSettings } from '../src/config';
import { blastFlight, grenadePhysics, grenadeThrow } from '../src/grenades';

const member = (id: string, team: 'blue' | 'red'): Member => ({ id, name: id, team, primary: 'ak' });
describe('LAN rules and validation', () => {
  it('keeps human team choices within one player and respects capacity', () => {
    const players = [member('host', 'blue')];
    expect(balancedTeam(players, 'blue', 5)).toBe('red');
    expect(balancedTeam(players, 'red', 5)).toBe('red');
    players.push(member('guest', 'red'));
    expect(balancedTeam(players, 'blue', 1)).toBeUndefined();
    expect(balancedTeam(players, 'blue', 5, 'guest')).toBeUndefined();
    expect(balancedTeam(players, 'red', 5, 'guest')).toBe('red');
  });
  it('supports humans only, mixed teams, and up to ten slots per team', () => {
    const room: Room = { key: 'ABCDEF', host: 'h', members: [member('h', 'blue'), member('g', 'red')], settings: { ...DEFAULTS, teamSize: 3 }, started: false };
    expect(operators(room)).toHaveLength(6); expect(operators(room).filter(a => a.member)).toHaveLength(2);
    room.settings = { ...room.settings, botFill: false }; expect(operators(room)).toHaveLength(2);
    expect(sanitizeSettings({ teamSize: 200, grenadePower: 999, grenadeWeight: 'bogus', grenadeBounce: false })).toMatchObject({ teamSize: 10, grenadePower: 65, grenadeWeight: 'normal', grenadeBounce: false });
  });
  it('validates remote controls without accepting positions, damage or unrestricted keys', () => {
    expect(cleanControls({ yaw: Infinity, pitch: 0, scope: 0 })).toBeUndefined();
    expect(cleanControls({ yaw: 100, pitch: 8, scope: 9, keys: ['KeyW', 'Delete'], fire: true, jump: 'true', actions: [{ kind: 'equip', weapon: 'bad' }, { kind: 'reload' }], grenade: { type: 'he', held: 99 } })).toMatchObject({ keys: ['KeyW'], pitch: 1.45, scope: 2, fire: true, jump: false, actions: [{ kind: 'reload' }], grenade: { type: 'he', held: 1.5 } });
  });
  it('accepts LAN/loopback peers, rejects public addresses', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.2', '10.0.0.2', '172.16.2.3', 'fd00::1']) expect(privateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888', '']) expect(privateAddress(ip)).toBe(false);
  });
});

describe('grenade tuning', () => {
  it('supports a much higher adjustable throw cap while retaining charge and precision', () => {
    expect(grenadeThrow(1.5, 65).speed).toBe(65);
    expect(grenadeThrow(0, 34).speed).toBeGreaterThan(8);
    expect(grenadeThrow(99, 100).speed).toBe(65);
    expect(grenadeThrow(1.5, 34).spread).toBe(0);
  });
  it('weight changes mass/drop, bounce can be disabled, and blast bodies rise then land', () => {
    expect(grenadePhysics('heavy', true).gravity).toBeGreaterThan(grenadePhysics('light', true).gravity);
    expect(grenadePhysics('normal', false).restitution).toBe(0);
    expect(blastFlight(0).height).toBe(0); expect(blastFlight(.4).height).toBeGreaterThan(1.5);
    expect(blastFlight(1.3).height).toBe(0); expect(blastFlight(1.3).distance).toBeGreaterThan(5);
  });
});

let server: Server | undefined, wss: WebSocketServer | undefined;
const clients: WebSocket[] = [];
afterEach(async () => {
  clients.splice(0).forEach(ws => ws.terminate());
  if (wss) await new Promise<void>(r => wss!.close(() => r()));
  if (server) await new Promise<void>(r => server!.close(() => r()));
  wss = undefined; server = undefined;
});
async function connection() {
  if (!server) { server = createServer(); wss = attachRooms(server); await new Promise<void>(r => server!.listen(0, '127.0.0.1', r)); }
  const address = server.address() as { port: number };
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/lan`, { origin: `http://127.0.0.1:${address.port}` });
  clients.push(ws);
  const queue: any[] = [], waiters: Array<(m: any) => void> = [];
  ws.on('message', b => { const msg = JSON.parse(b.toString()); const next = waiters.shift(); if (next) next(msg); else queue.push(msg); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise<any>(r => waiters.push(r));
  const hello = await next();
  return { ws, id: hello.id as string, next, send: (msg: unknown) => ws.send(JSON.stringify(msg)) };
}
describe('real LAN websocket rooms', () => {
  it('creates keys, joins balanced teams, locks starts, routes inputs only to host and snapshots only from host, closes on host exit', async () => {
    const host = await connection(), guest = await connection(), late = await connection();
    host.send({ type: 'create', name: 'Host', team: 'blue', settings: { ...DEFAULTS, teamSize: 1, botFill: false } });
    const { room } = await host.next(); expect(room.key).toMatch(/^[A-F0-9]{6}$/);
    guest.send({ type: 'join', key: room.key.toLowerCase(), name: 'Guest', team: 'blue' });
    expect((await guest.next()).room.members[1].team).toBe('red'); expect((await guest.next()).type).toBe('error'); await host.next();
    guest.send({ type: 'team', team: 'blue' }); expect((await guest.next()).type).toBe('error');
    host.send({ type: 'start' }); expect((await host.next()).operators).toHaveLength(2); expect((await guest.next()).type).toBe('start');
    late.send({ type: 'join', key: room.key, name: 'Late' }); expect((await late.next()).message).toContain('already started');
    guest.send({ type: 'input', controls: { keys: ['KeyW'], yaw: 0, pitch: 0, scope: 0 } });
    expect(await host.next()).toMatchObject({ type: 'input', id: guest.id, controls: { keys: ['KeyW'] } });
    guest.send({ type: 'snapshot', state: { time: -999 } });
    guest.send({ type: 'input', controls: { keys: ['KeyD'], yaw: 0, pitch: 0, scope: 0 } });
    expect(await host.next()).toMatchObject({ type: 'input', controls: { keys: ['KeyD'] } });
    host.send({ type: 'snapshot', state: { time: 12 } }); expect(await guest.next()).toEqual({ type: 'snapshot', state: { time: 12 } });
    host.send({ type: 'leave' }); expect((await guest.next()).type).toBe('ended');
  });
  it('rejects cross-origin websocket connections', async () => {
    await connection();
    const address = server!.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/lan`, { origin: 'http://untrusted.example' }); clients.push(ws);
    await new Promise<void>(resolve => ws.on('error', () => resolve()));
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
  it('rejects empty teams and wrong keys, replaces no players when full, and notifies departure', async () => {
    const host = await connection(), guest = await connection(), extra = await connection();
    host.send({ type: 'create', name: 'Host', settings: { ...DEFAULTS, teamSize: 1, botFill: false } }); const { room } = await host.next();
    host.send({ type: 'start' }); expect((await host.next()).message).toContain('Both teams');
    guest.send({ type: 'join', name: 'Guest', key: 'WRONG' }); expect((await guest.next()).type).toBe('error');
    guest.send({ type: 'join', name: 'Guest', key: room.key, team: 'red' }); await guest.next(); await host.next();
    extra.send({ type: 'join', name: 'Third', key: room.key }); expect((await extra.next()).message).toContain('full');
    guest.ws.close(); expect(await host.next()).toEqual({ type: 'left', id: guest.id }); expect((await host.next()).room.members).toHaveLength(1);
  });
});
