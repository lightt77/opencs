import type { Settings, Team, Primary, WeaponId } from './config';

export interface Member { id: string; name: string; team: Team; primary: Primary }
export interface Room { key: string; host: string; members: Member[]; settings: Settings; started: boolean }
export interface Operator { name: string; team: Team; primary: Primary; member?: string }
export type Action = { kind: 'reload' } | { kind: 'quick' } | { kind: 'equip'; weapon: WeaponId };
export interface Controls {
  keys: string[]; yaw: number; pitch: number; scope: number; fire: boolean; trigger: boolean;
  jump: boolean; actions: Action[]; grenade?: { type: 'he' | 'flash' | 'smoke'; held: number };
}
export const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight'];
export function cleanControls(value: unknown): Controls | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Controls;
  if (![v.yaw, v.pitch, v.scope].every(n => typeof n === 'number' && Number.isFinite(n))) return;
  return {
    keys: Array.isArray(v.keys) ? MOVE_KEYS.filter(k => v.keys.includes(k)) : [],
    yaw: v.yaw % (Math.PI * 2), pitch: Math.max(-1.45, Math.min(1.45, v.pitch)), scope: Math.max(0, Math.min(2, Math.round(v.scope))),
    fire: v.fire === true, trigger: v.trigger === true, jump: v.jump === true,
    actions: Array.isArray(v.actions) ? v.actions.slice(0, 8).filter(a => a && (a.kind === 'reload' || a.kind === 'quick' || (a.kind === 'equip' && ['ak', 'm4', 'awp', 'pistol', 'knife', 'he', 'flash', 'smoke'].includes(a.weapon)))) : [],
    grenade: v.grenade && ['he', 'flash', 'smoke'].includes(v.grenade.type) && Number.isFinite(v.grenade.held) ? { type: v.grenade.type, held: Math.max(0, Math.min(1.5, v.grenade.held)) } : undefined,
  };
}

export function balancedTeam(members: Member[], requested: Team, size: number, moving?: string): Team | undefined {
  const others = members.filter(m => m.id !== moving);
  const counts = { blue: others.filter(m => m.team === 'blue').length, red: others.filter(m => m.team === 'red').length };
  const opposite = requested === 'blue' ? 'red' : 'blue';
  if (counts[requested] < size && counts[requested] <= counts[opposite]) return requested;
  if (moving) return; // Reject a switch rather than silently moving a player to another team.
  return counts[opposite] < size ? opposite : undefined;
}

export function operators(room: Room): Operator[] {
  const result: Operator[] = room.members.map(m => ({ name: m.name, team: m.team, primary: m.primary, member: m.id }));
  for (const team of ['blue', 'red'] as const) {
    const count = result.filter(a => a.team === team).length;
    if (room.settings.botFill) for (let i = count; i < room.settings.teamSize; i++) result.push({ name: `${team === 'blue' ? 'B' : 'R'}-BOT-${i + 1}`, team, primary: room.settings.map === 'longshot' ? 'awp' : i % 3 === 0 ? 'awp' : i % 2 ? 'ak' : 'm4' });
  }
  return result;
}
