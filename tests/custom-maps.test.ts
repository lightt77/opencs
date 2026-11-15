import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMapIds, isMapId, sanitizeSettings } from '../src/config';
import { MAPS, customMapId } from '../src/maps';
import { checkMap } from '../src/map-check';
import { randomMap } from '../src/rotation';

const dir = new URL('../src/maps/custom/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));

describe('custom maps', () => {
  it('discovers every JSON file in src/maps/custom and registers it as a selectable map', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const id = customMapId(file);
      expect(MAPS[id]?.id).toBe(id);
      expect(allMapIds()).toContain(id);
      expect(sanitizeSettings({ map: id }).map).toBe(id);
    }
    expect(isMapId('custom_does_not_exist')).toBe(false);
    expect(randomMap('dust', () => .999)).toBe(allMapIds().at(-1));
  });
  for (const file of files) it(`${file} passes the map checker`, () => {
    const report = checkMap(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
    expect(report.errors).toEqual([]);
    expect(report.ascii).toMatch(/T/);
  });
  it('reports islands, unreachable sites and schema problems in agent-readable form', () => {
    const base = JSON.parse(readFileSync(new URL('market_district.json', dir), 'utf8'));
    const island = structuredClone(base);
    island.connections = island.connections.filter((c: { to: string; from: string }) => c.to !== 'site_b' && c.from !== 'site_b');
    const report = checkMap(island);
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/site_b .*island/);
    expect(report.errors.join('\n')).toMatch(/site B: no walkable route/);
    expect(checkMap({ ...base, biome: 'moon' }).errors[0]).toMatch(/Unknown biome "moon"/);
    expect(checkMap({ ...base, regions: base.regions.map((r: { tags: string[] }) => ({ ...r, tags: r.tags.filter(t => t !== 'spawn_ct') })) }).errors[0]).toMatch(/spawn_ct/);
  });
});
