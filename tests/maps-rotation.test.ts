import { describe, expect, it } from 'vitest';
import { MAP_IDS, DEFAULTS, sanitizeSettings } from '../src/config';
import { BIOMES } from '../src/biomes';
import { MAPS } from '../src/maps';
import { compileMap, surfaceHeight, validateMap } from '../src/map-schema';
import source from '../src/maps/dust2-blockout.json';
import { randomMap } from '../src/rotation';
import { Navigation } from '../src/navigation';
import { penetration, rayBox } from '../src/ballistics';
import { segmentBox } from '../src/math';

describe('bundled arenas and map compiler', () => {
  it('bundles twelve distinct layouts across eight reusable biomes', () => {
    expect(Object.keys(MAPS)).toEqual([...MAP_IDS]);
    expect(new Set(Object.values(MAPS).map(a => a.biome)).size).toBe(8);
    expect(new Set(Object.values(MAPS).map(a => JSON.stringify(a.boxes))).size).toBe(12);
    for (const a of Object.values(MAPS)) {
      expect(BIOMES[a.biome]).toBeDefined();
      expect(sanitizeSettings({ map: a.id }).map).toBe(a.id);
    }
  });
  it('preserves the supplied regions and compiles deterministic floors, ceilings, props and rotations', () => {
    const a = MAPS.dust2_blockout, b = compileMap(source, a.id, a.name, a.biome);
    expect(a.boxes).toEqual(b.boxes);
    expect(a.areas).toHaveLength(source.regions.length);
    expect(a.width).toBe(115); expect(a.depth).toBe(205);
    expect(a.boxes.some(b => b.kind === 'beam')).toBe(true);
    expect(a.boxes.some(b => b.rotY === .3)).toBe(true);
    expect(a.boxes.filter(b => b.kind === 'floor').length).toBeGreaterThan(20);
    expect(surfaceHeight(a, { x: -2.5, z: -52.5 })).toBeLessThan(-1);
    expect(surfaceHeight(a, { x: 29.5, z: 75.5 })).toBeGreaterThan(3);
    expect(surfaceHeight(a, { x: -54, z: -101 })).toBeUndefined();
  });
  it('provides reachable routes to every named region with no discontinuous floor steps', () => {
    const a = MAPS.dust2_blockout, nav = new Navigation(a), start = a.blue[2];
    for (const r of a.areas!) {
      const goal = nav.point(nav.nearest(r));
      expect(nav.path(start, goal).length, r.name).toBeGreaterThan(0);
      expect(Math.hypot(goal.x - r.x, goal.z - r.z), r.name).toBeLessThan(5);
    }
    const g = a.surface!;
    for (let i = 0; i < g.heights.length; i++) for (const j of [i % g.cols < g.cols - 1 ? i + 1 : i, i + g.cols]) {
      if (Number.isFinite(g.heights[i]) && Number.isFinite(g.heights[j])) expect(Math.abs(g.heights[i] - g.heights[j])).toBeLessThan(.201);
    }
  });
  it('rejects malformed specifications before compiling geometry', () => {
    for (const value of [null, {}, { ...source, unitScale: Infinity }, { ...source, bounds: { min: [0, 0, 0], max: [10000, 1, 1] } }, { ...source, connections: [{ from: 'missing', to: 't_spawn', type: 'open' }] }, { ...source, regions: [source.regions[0], source.regions[0]] }]) {
      expect(() => validateMap(value)).toThrow();
    }
  });
  it('uses matching rotated boxes for visibility and bullets; elevated floors never penetrate', () => {
    const b = { x: 0, y: 1, z: 0, w: 8, h: 2, d: .5, rotY: Math.PI / 2 };
    expect(segmentBox({ x: -5, z: 3 }, { x: 5, z: 3 }, b)).toBe(true);
    expect(rayBox({ x: -5, y: 1, z: 3 }, { x: 1, y: 0, z: 0 }, b, 10)).toBeDefined();
    expect(rayBox({ x: 3, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, b, 10)).toBeUndefined();
    expect(penetration('awp', [{ box: { ...b, kind: 'floor' }, entry: 2, exit: 2.5 }], 'walls').multiplier).toBe(0);
  });
});

describe('timed matches and rotation settings', () => {
  it('migrates saved preferences without losing audio or imposing auto play', () => {
    const s = sanitizeSettings({ volume: 23, soundPack: 'custom', map: 'india' });
    expect(s).toMatchObject({ volume: 23, soundPack: 'custom', map: 'india', matchDuration: 360, roundDuration: 100, rotationDelay: 8, autoRotate: false });
    expect(sanitizeSettings({ matchDuration: Infinity, roundDuration: -1, rotationDelay: 999, autoRotate: true })).toMatchObject({ matchDuration: DEFAULTS.matchDuration, roundDuration: 15, rotationDelay: 30, autoRotate: true });
  });
  it('chooses a random different map, with every alternative eligible', () => {
    for (const current of MAP_IDS) {
      const choices = new Set(Array.from({ length: MAP_IDS.length - 1 }, (_, i) => randomMap(current, () => (i + .5) / (MAP_IDS.length - 1))));
      expect(choices.size).toBe(MAP_IDS.length - 1); expect(choices.has(current)).toBe(false);
    }
  });
});
