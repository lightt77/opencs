import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, Physics } from '../src/physics';
import { MAPS } from '../src/maps';
import { Navigation } from '../src/navigation';
import { surfaceHeight } from '../src/map-schema';

beforeAll(async () => { await initPhysics(); });
describe('Rapier character controller', () => {
  it('spawns above/below zero on JSON floors and physically climbs the inferred site steps', () => {
    const arena = MAPS.dust2_blockout, physics = new Physics(arena), nav = new Navigation(arena);
    const start = arena.blue[2], destination = nav.point(nav.nearest({ x: 30, z: 76 }));
    const actor = physics.character(start), path = nav.path(start, destination);
    expect(path.length).toBeGreaterThan(0);
    for (let i = 0; i < 1600 && path.length; i++) {
      const p = actor.position(), goal = path[0], d = Math.hypot(goal.x - p.x, goal.z - p.z);
      if (d < .25) path.shift();
      else actor.move((goal.x - p.x) / d * .07, -.06, (goal.z - p.z) / d * .07);
      physics.world.step();
    }
    const p = actor.position();
    expect(Math.hypot(p.x - destination.x, p.z - destination.z)).toBeLessThan(1);
    expect(p.y).toBeGreaterThan(3);
    const pit = { x: -2.5, z: -52.5, y: surfaceHeight(arena, { x: -2.5, z: -52.5 }) };
    actor.teleport(pit);
    for (let i = 0; i < 30; i++) { actor.move(0, -.05, 0); physics.world.step(); }
    expect(actor.position().y).toBeCloseTo(pit.y!, 1);
    physics.dispose();
  });
  it('applies grenade weight and bounce to actual simulated trajectories', () => {
    const physics = new Physics({ ...MAPS.india, boxes: [] });
    const light = physics.grenade({ x: -5, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, 'light', true);
    const heavy = physics.grenade({ x: 5, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, 'heavy', false);
    for (let i = 0; i < 20; i++) physics.world.step();
    expect(light.translation().y).toBeGreaterThan(heavy.translation().y);
    let lightBounce = 0, heavyBounce = 0;
    for (let i = 0; i < 100; i++) {
      physics.world.step();
      lightBounce = Math.max(lightBounce, light.linvel().y); heavyBounce = Math.max(heavyBounce, heavy.linvel().y);
    }
    expect(lightBounce).toBeGreaterThan(2); expect(heavyBounce).toBeLessThan(.5);
    physics.dispose();
  });
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
  it('keeps crouching under low ceilings and stands once clear', () => {
    const physics = new Physics({ ...MAPS.india, boxes: [{ x: 0, y: 1.5, z: 0, w: 4, h: .4, d: 4, kind: 'beam' }] });
    const actor = physics.character({ x: 0, z: 0 });
    actor.crouch(true); physics.world.step(); actor.crouch(false);
    expect(actor.crouched).toBe(true);
    actor.teleport({ x: 0, z: 5 }); physics.world.step(); actor.crouch(false);
    expect(actor.crouched).toBe(false);
    physics.dispose();
  });
  it('repeated stance changes cannot sink a moving character through the floor', () => {
    const physics = new Physics(MAPS.india), actor = physics.character({ x: 0, z: 25 });
    for (let i = 0; i < 300; i++) {
      actor.crouch(i % 2 === 0); actor.move(.003, -.02, 0); physics.world.step();
      expect(actor.position().y).toBeGreaterThan(-.05);
    }
    physics.dispose();
  });
});
