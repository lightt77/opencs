import type { Game } from './game';
import type { Controls, Operator, Room } from './lan-protocol';
import type { Primary } from './config';

export class Lan {
  id = '';
  room?: Room;
  status = '';
  onChange?: () => void;
  onStart?: (room: Room, operators: Operator[]) => void;
  onInput?: (id: string, controls: Controls) => void;
  onSnapshot?: (state: ReturnType<Game['snapshot']>) => void;
  onLeft?: (id: string) => void;
  onPrimary?: (id: string, primary: Primary) => void;
  onEnded?: () => void;
  private socket?: WebSocket;
  get host() { return this.room?.host === this.id; }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lan`);
      this.socket = ws;
      const timeout = window.setTimeout(() => { ws.close(); reject(new Error('LAN server did not answer. Start it with npm run lan.')); }, 5000);
      ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'hello') { this.id = msg.id; clearTimeout(timeout); resolve(); }
        if (msg.type === 'room') { this.room = msg.room; this.status = ''; this.onChange?.(); }
        if (msg.type === 'error') { this.status = msg.message; this.onChange?.(); }
        if (msg.type === 'start') { this.room = msg.room; this.onStart?.(msg.room, msg.operators); }
        if (msg.type === 'input') this.onInput?.(msg.id, msg.controls);
        if (msg.type === 'snapshot') this.onSnapshot?.(msg.state);
        if (msg.type === 'left') this.onLeft?.(msg.id);
        if (msg.type === 'primary') this.onPrimary?.(msg.id, msg.primary);
        if (msg.type === 'ended') { this.room = undefined; this.status = msg.reason; this.onEnded?.(); this.onChange?.(); }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Cannot reach the LAN server. Use the host Wi-Fi address and run npm run lan.')); };
      ws.onclose = () => {
        clearTimeout(timeout); reject(new Error('LAN connection closed.'));
        if (this.socket !== ws) return;
        const active = !!this.room; this.room = undefined; this.status = 'Disconnected from the LAN server.';
        if (active) this.onEnded?.(); this.onChange?.();
      };
    });
  }
  send(data: unknown) { if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 512 * 1024) this.socket.send(JSON.stringify(data)); }
  leave() { this.send({ type: 'leave' }); this.room = undefined; this.status = ''; this.onChange?.(); }
}
