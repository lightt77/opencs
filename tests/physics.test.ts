import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, Physics } from '../src/physics';
import { MAPS } from '../src/maps';

beforeAll(async () => { await initPhysics(); });
describe('Rapier character controller', () => {
  it('lands on the floor and stops at solid walls', () => {
    const physics = new Physics(MAPS.india);
    const actor = physics.character({ x: 0, z: 28 });
    physics.world.step();
    for (let i = 0; i < 120; i++) { actor.move(0, -.1, .1); physics.world.step(); }
    expect(actor.position().y).toBeGreaterThanOrEqual(-.01);
    expect(actor.position().y).toBeLessThan(.1);
    expect(actor.position().z).toBeLessThan(32.2);
    expect(actor.grounded).toBe(true);
    physics.dispose();
  });
  it('can crouch and stand without moving its feet', () => {
    const physics = new Physics(MAPS.india);
    const actor = physics.character({ x: 0, z: 28 });
    const y = actor.position().y;
    actor.crouch(true); expect(actor.position().y).toBeCloseTo(y);
    actor.crouch(false); expect(actor.position().y).toBeCloseTo(y);
    physics.dispose();
  });
});
