import { describe, expect, it } from 'vitest';
import { JUMP_IMPULSE, verticalMotion } from '../src/movement';

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
