import { describe, expect, it } from 'vitest';
import { airVelocity, JUMP_IMPULSE, verticalMotion } from '../src/movement';

describe('configurable jumping', () => {
  const dt = 1 / 60;
  it('preserves a normal ground jump with double jump disabled', () => {
    expect(verticalMotion(0, true, true, 0, false, 20, dt)).toEqual({ velocity: JUMP_IMPULSE, jumpsUsed: 1 });
    expect(verticalMotion(3, false, true, 1, false, 20, dt).velocity).toBeLessThan(3);
  });
  it('allows exactly one air jump and replenishes on landing', () => {
    const air = verticalMotion(-2, false, true, 1, true, 20, dt);
    expect(air).toEqual({ velocity: JUMP_IMPULSE, jumpsUsed: 2 });
    expect(verticalMotion(2, false, true, 2, true, 20, dt).velocity).toBeLessThan(2);
    expect(verticalMotion(-3, true, false, 2, true, 20, dt).jumpsUsed).toBe(0);
  });
  it('does not grant two air jumps when walking off a ledge', () => {
    expect(verticalMotion(-2, false, true, 0, true, 20, dt).jumpsUsed).toBe(2);
  });
  it('low gravity slows falling without changing the jump impulse', () => {
    expect(verticalMotion(2, false, false, 1, false, 10, dt).velocity).toBeGreaterThan(verticalMotion(2, false, false, 1, false, 35, dt).velocity);
    expect(verticalMotion(0, true, true, 0, false, 10, dt).velocity).toBe(JUMP_IMPULSE);
  });
});

describe('air steering', () => {
  it('brakes a left jump and reverses right before a normal jump lands', () => {
    let v = { x: -5.6, z: 0 };
    for (let i = 0; i < 20; i++) v = airVelocity(v.x, v.z, 1, 0, 5.6, 1 / 60);
    expect(v.x).toBeCloseTo(5.6); expect(v.z).toBe(0);
  });
  it('preserves momentum without input and does not add a diagonal boost', () => {
    expect(airVelocity(3, -4, 0, 0, 5.6, 1 / 60)).toEqual({ x: 3, z: -4 });
    let v = { x: 0, z: -5.6 };
    for (let i = 0; i < 120; i++) {
      v = airVelocity(v.x, v.z, 1, -1, 5.6, 1 / 60);
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(5.6 + 1e-8);
    }
  });
  it('is stable across timestep subdivisions and supports weapon/speed scaling', () => {
    let v = { x: -8.4, z: 0 };
    for (let i = 0; i < 40; i++) v = airVelocity(v.x, v.z, 1, 0, 8.4, 1 / 120);
    expect(v.x).toBeCloseTo(8.4);
    expect(airVelocity(-8.4, 0, 1, 0, 8.4, 0).x).toBe(-8.4);
  });
});
