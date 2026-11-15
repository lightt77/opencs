import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, acceptMove } from '../src/netcode';
import { cleanControls } from '../src/lan-protocol';

describe('guest movement validation', () => {
  const origin = { x: 0, y: 0, z: 0 };
  it('accepts normal running and jumping, rejects teleports and speed hacks', () => {
    expect(acceptMove(origin, [.1, 0, 0], 6, 1 / 60)).toBe(true);
    expect(acceptMove(origin, [1.5, .3, 0], 7.5, .2)).toBe(true);
    expect(acceptMove(origin, [12, 0, 0], 7.5, .1)).toBe(false);
    expect(acceptMove(origin, [0, 9, 0], 7.5, 1 / 60)).toBe(false);
    expect(acceptMove(origin, [NaN, 0, 0], 7.5, 1 / 60)).toBe(false);
    expect(acceptMove(origin, [40, 0, 0], 7.5, 10)).toBe(false); // long stalls are capped
  });
  it('sanitizes the predicted move in guest controls', () => {
    const c = cleanControls({ yaw: 0, pitch: 0, scope: 0, keys: [], actions: [], move: { position: [1, 2, 3], velocity: [99, 0, -99], grounded: true, crouched: 'yes' } });
    expect(c?.move).toEqual({ position: [1, 2, 3], velocity: [40, 0, -40], grounded: true, crouched: false });
    expect(cleanControls({ yaw: 0, pitch: 0, scope: 0, move: { position: [1, 2], velocity: [0, 0, 0] } })?.move).toBeUndefined();
  });
});

describe('snapshot interpolation buffer', () => {
  it('renders remote actors 100 ms in the past, interpolating position and yaw', () => {
    const b = new SnapshotBuffer(.1);
    b.push(10, [[0, 0, 0, 0]], 100);
    b.push(10.1, [[1, 0, 0, Math.PI / 2]], 100.1);
    const mid = b.sample(0, 100.15)!;
    expect(mid[0]).toBeCloseTo(.5); expect(mid[3]).toBeCloseTo(Math.PI / 4);
    expect(b.sample(0, 100.5)![0]).toBe(1);
    expect(b.sample(1, 100.15)).toBeUndefined();
  });
  it('ignores late packets for the clock, cuts on teleports and resets on a new match clock', () => {
    const b = new SnapshotBuffer(.1);
    b.push(0, [[0, 0, 0, 0]], 50); b.push(.05, [[20, 0, 0, 0]], 50.3); // second packet arrived late
    expect(b.sample(0, 50.125)![0]).toBe(20); // teleport: no slide across the map
    b.push(0, [[5, 0, 5, 0]], 60);
    expect(b.sample(0, 60.2)![0]).toBe(5);
  });
});
