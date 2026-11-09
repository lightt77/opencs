import { describe, expect, it } from 'vitest';
import { coverHits, penetration, rayBox } from '../src/ballistics';
import { footstepStride, movementScale, scopeFov } from '../src/movement';
import { chooseSpawn, spawnCandidates } from '../src/spawns';
import { Navigation } from '../src/navigation';
import { MAPS } from '../src/maps';
import { findCover, findPerch } from '../src/bots';
import { distance, type Box } from '../src/math';

const origin = { x: 0, y: 1.4, z: 5 }, direction = { x: 0, y: 0, z: -1 };
const wall = (d: number, kind: Box['kind'] = 'wall', z = 0): Box => ({ x: 0, y: 2, z, w: 4, h: 4, d, kind });

describe('thin-cover ballistics', () => {
  it('measures the complete 3D thickness and handles rays starting inside cover', () => {
    expect(rayBox(origin, direction, wall(.3), 20)).toEqual({ entry: 4.85, exit: 5.15 });
    expect(rayBox({ x: 0, y: 2, z: 0 }, direction, wall(.4), 20)).toEqual({ entry: 0, exit: .2 });
    expect(rayBox({ ...origin, y: 6 }, direction, wall(.3), 20)).toBeUndefined();
  });
  it('allows reduced rifle damage through thin wood and masonry but not thick walls', () => {
    for (const box of [wall(.35, 'door'), wall(.2)]) {
      const result = penetration('ak', coverHits(origin, direction, [box], 20));
      expect(result.multiplier).toBeGreaterThan(0); expect(result.multiplier).toBeLessThan(.7);
    }
    expect(penetration('ak', coverHits(origin, direction, [wall(2)], 20)).multiplier).toBe(0);
    expect(penetration('pistol', coverHits(origin, direction, [wall(.35, 'door')], 20)).multiplier).toBe(0);
    expect(penetration('knife', coverHits(origin, direction, [wall(.01)], 20)).multiplier).toBe(0);
  });
  it('uses cumulative thickness, weapon budgets, and a two-layer cap', () => {
    const hits = coverHits(origin, direction, [wall(.4, 'door', 1), wall(.4, 'door', -1)], 20);
    expect(penetration('m4', hits).multiplier).toBe(0);
    expect(penetration('awp', hits).multiplier).toBeGreaterThan(0);
    expect(penetration('awp', coverHits(origin, direction, [wall(.05, 'door', 1), wall(.05, 'door', 0), wall(.05, 'door', -1)], 20)).multiplier).toBe(0);
    expect(penetration('ak', []).multiplier).toBe(1);
  });
  it('makes grazing shots cost more than perpendicular shots', () => {
    const straight = coverHits(origin, direction, [wall(.3, 'door')], 20);
    const angled = coverHits({ x: -4, y: 1.4, z: 5 }, { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, [wall(.3, 'door')], 20);
    expect(penetration('ak', angled).multiplier).toBeLessThan(penetration('ak', straight).multiplier);
  });
});

describe('movement and optics', () => {
  it('prioritizes crouch and scope over sprint', () => {
    expect(movementScale(false, false, true)).toBe(1.5);
    expect(movementScale(true, false, true)).toBe(.48);
    expect(movementScale(false, true, true)).toBe(.55);
    expect(footstepStride(true, false)).toBeGreaterThan(footstepStride(false, false));
  });
  it('doubles actual magnification at both map scope settings', () => {
    for (const base of [12, 24]) {
      expect(scopeFov(base, 1)).toBe(base);
      expect(Math.tan(base * Math.PI / 360) / Math.tan(scopeFov(base, 2) * Math.PI / 360)).toBeCloseTo(2, 8);
    }
  });
});

describe('randomized safe spawns', () => {
  for (const arena of Object.values(MAPS)) it(`${arena.name} supplies separated, ground-clear round spawns`, () => {
    const nav = new Navigation(arena);
    const assigned = [];
    for (const team of ['blue', 'red'] as const) {
      const pool = spawnCandidates(nav, team, true);
      expect(pool.length).toBeGreaterThan(10);
      for (let i = 0; i < 5; i++) {
        const point = chooseSpawn(pool, assigned, [], nav, () => .42);
        expect(assigned.every(p => distance(p, point) > 2.5)).toBe(true);
        expect(nav.clear(point, point, .7, .65)).toBe(true);
        expect(point.z * (team === 'blue' ? 1 : -1)).toBeGreaterThan(arena.depth * .29);
        assigned.push(point);
      }
    }
    const pool = spawnCandidates(nav, 'blue', true);
    expect(chooseSpawn(pool, [], [], nav, () => 0)).not.toEqual(chooseSpawn(pool, [], [], nav, () => .99));
  });
  it('prefers concealed candidates over an exposed spawn', () => {
    const nav = new Navigation(MAPS.dust), enemy = { x: 0, z: 0 };
    const hidden = { x: -28, z: 30 }, exposed = { x: 0, z: 30 };
    expect(nav.clear(enemy, hidden)).toBe(false); expect(nav.clear(enemy, exposed)).toBe(true);
    expect(chooseSpawn([hidden, exposed], [], [enemy], nav, () => .9)).toEqual(hidden);
  });
});

describe('bot cover and climbing opportunities', () => {
  it('finds a low reachable crate, but not tall buildings or overhead-obstructed tops', () => {
    const nav = new Navigation(MAPS.india);
    expect(findPerch({ x: 0, z: 17 }, nav)).toMatchObject({ top: { x: 0, z: 13 }, height: 1.3 });
    expect(findPerch({ x: 22, z: 10 }, nav)).toBeUndefined();
  });
  it('finds nearby cover that actually occludes the threat', () => {
    const nav = new Navigation(MAPS.dust), threat = { x: 0, z: 0 };
    const cover = findCover({ x: 12, z: 10 }, threat, nav);
    expect(cover).toBeDefined();
    expect(nav.clear(threat, cover!, .95)).toBe(false); expect(nav.clear(cover!, cover!, .7, .5)).toBe(true);
  });
});
