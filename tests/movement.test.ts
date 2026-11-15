import { describe, expect, it } from 'vitest';
import { CLASSIC, airVelocity, classicAirVelocity, classicGroundVelocity, JUMP_IMPULSE, verticalMotion } from '../src/movement';

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

describe('classic (GoldSrc-style) movement', () => {
  const dt = 1 / 60;
  const run = (f: typeof classicGroundVelocity, v: { x: number; z: number }, dx: number, dz: number, ticks: number, speed = 5.6) => {
    for (let i = 0; i < ticks; i++) v = f(v.x, v.z, dx, dz, speed, dt); return v;
  };
  it('reaches full speed in about a quarter second and never exceeds it on the ground', () => {
    expect(Math.hypot(...Object.values(run(classicGroundVelocity, { x: 0, z: 0 }, 0, -1, 12)))).toBeLessThan(5.6);
    const v = run(classicGroundVelocity, { x: 0, z: 0 }, 1, -1, 60);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(5.6, 1); expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(5.6 + 1e-9);
  });
  it('slides to a stop with friction, and counter-strafing stops much faster', () => {
    const coast = run(classicGroundVelocity, { x: 5.6, z: 0 }, 0, 0, 9);
    const counter = run(classicGroundVelocity, { x: 5.6, z: 0 }, -1, 0, 9);
    expect(coast.x).toBeGreaterThan(2); expect(Math.abs(counter.x)).toBeLessThan(coast.x / 2);
    expect(run(classicGroundVelocity, { x: 5.6, z: 0 }, 0, 0, 40).x).toBe(0);
  });
  it('has weak direct air control but gains speed when air-strafing, up to a cap', () => {
    // Holding a key in the air only builds ~0.76 m/s along it (no running start mid-air).
    expect(Math.hypot(...Object.values(run(classicAirVelocity, { x: 0, z: 0 }, 0, -1, 60)))).toBeCloseTo(CLASSIC.airWishCap, 5);
    expect(run(classicAirVelocity, { x: 5.6, z: 0 }, 1, 0, 60).x).toBe(5.6); // and W adds nothing forward
    expect(classicAirVelocity(3, -4, 0, 0, 5.6, dt)).toEqual({ x: 3, z: -4 });
    // Strafe right while the view turns right: wish direction stays ~90° to velocity.
    let v = { x: 0, z: -5.6 };
    for (let i = 0; i < 60; i++) { const a = Math.atan2(v.z, v.x) + Math.PI / 2 - .05; v = classicAirVelocity(v.x, v.z, Math.cos(a), Math.sin(a), 5.6, dt); }
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(5.9);
    expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(5.6 * CLASSIC.airSpeedCap + 1e-9);
  });
});
