import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/maps';
import { distance } from '../src/math';
import { Navigation } from '../src/navigation';

for (const arena of Object.values(MAPS)) describe(`${arena.name} navigation`, () => {
  const nav = new Navigation(arena);
  it('has clear, connected spawn points on both teams', () => {
    for (const point of [...arena.blue, ...arena.red]) {
      expect(nav.clear(point, point, .7, .4)).toBe(true);
      expect(distance(point, nav.point(nav.nearest(point)))).toBeLessThan(1.8);
      expect(nav.path(point, arena.routes[0]).length).toBeGreaterThan(0);
    }
  });
  it('finds a collision-free route from each spawn to the opposite team', () => {
    for (let i = 0; i < 5; i++) {
      const start = arena.blue[i];
      const path = nav.path(start, arena.red[i]);
      expect(path.length).toBeGreaterThan(0);
      let previous = start;
      for (const point of path) {
        expect(nav.clear(previous, point, .7, .32)).toBe(true);
        previous = point;
      }
      expect(distance(path.at(-1)!, arena.red[i])).toBeLessThan(2);
    }
  });
  it('does not treat overhead arches as navigation obstacles', () => {
    for (const beam of arena.boxes.filter(b => b.kind === 'beam')) expect(nav.walls.includes(beam)).toBe(false);
  });
});
