import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { sanitizeSettings } from '../src/config';
import { balancedTeam, cleanControls, operators, type Member, type Room } from '../src/lan-protocol';
import type { LanLog } from './diagnostics';

export function privateAddress(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  return ip === '::1' || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip) || /^(fc|fd|fe80:)/i.test(ip);
}

interface Peer { id: string; ws: WebSocket; room?: Room; alive: boolean; count: number; since: number }
export function attachRooms(server: Server, log: LanLog = () => {}) {
  const rooms = new Map<string, Room>(), peers = new Map<string, Peer>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/lan') return; // Leave Vite's HMR socket alone.
    let origin: URL;
    try { origin = new URL(req.headers.origin ?? ''); } catch { log(`WebSocket rejected from ${req.socket.remoteAddress}: missing/invalid Origin`); socket.destroy(); return; }
    if (!privateAddress(req.socket.remoteAddress) || origin.host !== req.headers.host) { log(`WebSocket rejected from ${req.socket.remoteAddress}: non-LAN source or Origin/Host mismatch`); socket.destroy(); return; }
    log(`WebSocket accepted from ${req.socket.remoteAddress}`);
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (peer: Peer | undefined, data: unknown) => {
    if (peer?.ws.readyState === WebSocket.OPEN && peer.ws.bufferedAmount < 1024 * 1024) peer.ws.send(JSON.stringify(data));
  };
  const broadcast = (room: Room, data: unknown, except?: string) => { for (const m of room.members) if (m.id !== except) send(peers.get(m.id), data); };
  const roster = (room: Room) => broadcast(room, { type: 'room', room });
  const leave = (peer: Peer) => {
    const room = peer.room; peer.room = undefined;
    if (!room) return;
    if (room.host === peer.id) {
      broadcast(room, { type: 'ended', reason: 'The host left. This room has closed.' }, peer.id);
      for (const m of room.members) { const p = peers.get(m.id); if (p) p.room = undefined; }
      rooms.delete(room.key);
    } else {
      room.members = room.members.filter(m => m.id !== peer.id);
      const moved: Member[] = [];
      if (!room.started) {
        let blue = room.members.filter(m => m.team === 'blue'), red = room.members.filter(m => m.team === 'red');
        while (Math.abs(blue.length - red.length) > 1) {
          const member = (blue.length > red.length ? blue : red).at(-1)!;
          member.team = member.team === 'blue' ? 'red' : 'blue'; moved.push(member);
          blue = room.members.filter(m => m.team === 'blue'); red = room.members.filter(m => m.team === 'red');
        }
      }
      broadcast(room, { type: 'left', id: peer.id }); roster(room);
      for (const member of moved) send(peers.get(member.id), { type: 'error', message: 'A player left; you were moved to keep teams balanced.' });
    }
  };
  wss.on('connection', ws => {
    const peer: Peer = { id: randomBytes(8).toString('hex'), ws, alive: true, count: 0, since: Date.now() };
    peers.set(peer.id, peer); send(peer, { type: 'hello', id: peer.id });
    ws.on('pong', () => { peer.alive = true; });
    ws.on('message', bytes => {
      if (Date.now() - peer.since > 1000) { peer.count = 0; peer.since = Date.now(); }
      if (++peer.count > 150) { ws.close(1008, 'Too many messages'); return; }
      try {
        const msg = JSON.parse(bytes.toString());
        const error = (message: string) => send(peer, { type: 'error', message });
        if (msg.type === 'leave') { leave(peer); return; }
        if (msg.type === 'create' || msg.type === 'join') {
          if (peer.room) { error('Leave your current room first.'); return; }
          const name = typeof msg.name === 'string' ? msg.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18) : '';
          if (!name) { error('Enter a player name (letters and numbers).'); return; }
          const primary = ['ak', 'm4', 'awp'].includes(msg.primary) ? msg.primary : 'ak';
          const requested = msg.team === 'red' ? 'red' : 'blue';
          if (msg.type === 'create') {
            if (rooms.size >= 32) { error('This LAN server is full.'); return; }
            let key: string; do { key = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(key));
            const room: Room = { key, host: peer.id, members: [{ id: peer.id, name, team: requested, primary }], settings: sanitizeSettings(msg.settings), started: false };
            rooms.set(key, room); peer.room = room; roster(room);
          } else {
            const room = rooms.get(String(msg.key).trim().toUpperCase());
            if (!room) { error('Room not found. Check the key and the host Wi-Fi address.'); return; }
            if (room.started) { error('Match already started. Join the next room.'); return; }
            if (room.members.some(m => m.name.toLowerCase() === name.toLowerCase())) { error('That player name is taken.'); return; }
            const team = balancedTeam(room.members, requested, room.settings.teamSize);
            if (!team) { error('Both teams are full.'); return; }
            room.members.push({ id: peer.id, name, team, primary }); peer.room = room; roster(room);
            if (team !== requested) error('Assigned to the smaller team to keep players balanced.');
          }
          return;
        }
        const room = peer.room; if (!room) return;
        const host = room.host === peer.id;
        if (msg.type === 'team' && !room.started) {
          const requested = msg.team === 'red' ? 'red' : 'blue';
          const team = balancedTeam(room.members, requested, room.settings.teamSize, peer.id);
          if (!team) { error('That team is full or would unbalance human players.'); return; }
          room.members.find(m => m.id === peer.id)!.team = team; roster(room);
        } else if (msg.type === 'start' && host && !room.started) {
          const list = operators(room);
          if (!list.some(a => a.team === 'blue') || !list.some(a => a.team === 'red')) { error('Both teams need an operator. Invite another player or enable bot fill before creating the room.'); return; }
          room.started = true;
          broadcast(room, { type: 'start', room, operators: list });
        } else if (msg.type === 'input' && !host && room.started) {
          const controls = cleanControls(msg.controls); if (controls) send(peers.get(room.host), { type: 'input', id: peer.id, controls });
        } else if (msg.type === 'primary' && !host && room.started && ['ak', 'm4', 'awp'].includes(msg.primary)) {
          send(peers.get(room.host), { type: 'primary', id: peer.id, primary: msg.primary });
        } else if (msg.type === 'snapshot' && host && room.started) {
          broadcast(room, { type: 'snapshot', state: msg.state }, peer.id);
        }
      } catch { send(peer, { type: 'error', message: 'Invalid room message.' }); }
    });
    ws.on('close', code => { log(`WebSocket disconnected (${code})`); leave(peer); peers.delete(peer.id); });
    ws.on('error', error => { log(`WebSocket error: ${error.message}`); ws.close(); });
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) { if (!peer.alive) peer.ws.terminate(); else { peer.alive = false; peer.ws.ping(); } }
  }, 5000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
