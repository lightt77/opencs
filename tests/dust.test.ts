import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/maps';
import { Navigation } from '../src/navigation';
import type { Point } from '../src/math';

describe('Dust II route layout', () => {
  const arena = MAPS.dust, nav = new Navigation(arena);
  const start = arena.blue[0];
  const routes: Record<string, Point[]> = {
    'Long A': [start, { x: 33, z: 29 }, { x: 33, z: -10 }, { x: 29, z: -33 }],
    'Short / catwalk': [start, { x: 0, z: 14 }, { x: 3, z: -17 }, { x: 16, z: -17 }, { x: 29, z: -33 }],
    'B tunnels': [start, { x: -28, z: 34 }, { x: -27.5, z: 13 }, { x: -27.5, z: -19 }, { x: -28, z: -30 }],
    'CT rotation': [{ x: -28, z: -30 }, { x: -20, z: -18 }, { x: 0, z: -18 }, arena.red[0], { x: 29, z: -33 }],
  };
  for (const [name, points] of Object.entries(routes)) it(`connects ${name} with navigable, collision-free paths`, () => {
    for (let i = 1; i < points.length; i++) {
      expect(nav.clear(points[i], points[i], .7, .4)).toBe(true);
      const path = nav.path(points[i - 1], points[i]); expect(path.length).toBeGreaterThan(0);
      let previous = points[i - 1];
      for (const point of path) { expect(nav.clear(previous, point, .7, .32)).toBe(true); previous = point; }
    }
  });
  it('has A/B landmarks, wooden double doors, and a tunnel roof above player headroom', () => {
    expect(arena.sites?.map(s => s.label)).toEqual(['A', 'B']);
    expect(arena.boxes.filter(b => b.kind === 'door')).toHaveLength(4);
    expect(arena.areas?.some(a => a.name === 'SHORT / CATWALK')).toBe(true);
    expect(nav.clear({ x: -27.5, z: -12 }, { x: -27.5, z: 10 })).toBe(true);
    expect(nav.clear({ x: 13, z: -3 }, { x: 13, z: -3 })).toBe(false);
  });
});
