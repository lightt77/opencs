import { compileMap, surfaceHeight, validateMap, type MapDefinition } from './map-schema';
import { Navigation } from './navigation';
import { spawnCandidates } from './spawns';
import { distance, type Point } from './math';
import type { Arena } from './maps';

export interface MapReport {
  ok: boolean; errors: string[]; warnings: string[];
  stats?: { name: string; biome: string; width: number; depth: number; regions: number; connections: number; boxes: number; spawnDistance: number };
  ascii?: string; svg?: string; arena?: Arena;
}

// Pure, deterministic map lint used by `npm run map:check` and the tests. An agent writing a
// map reads the errors/warnings and the ASCII preview, edits the JSON, and re-runs until ok.
export function checkMap(value: unknown, id = 'custom_check'): MapReport {
  const errors: string[] = [], warnings: string[] = [];
  try { validateMap(value); } catch (error) { return { ok: false, errors: [(error as Error).message], warnings }; }
  const m = value as MapDefinition;
  let arena: Arena;
  try { arena = compileMap(m, id as `custom_${string}`); } catch (error) { return { ok: false, errors: [`Compile failed: ${(error as Error).message}`], warnings }; }
  const nav = new Navigation(arena);
  const s = m.unitScale;

  for (const r of m.regions) {
    const b = r.bounds;
    const inside = (x: number, z: number) => x >= m.bounds.min[0] && x <= m.bounds.max[0] && z >= m.bounds.min[2] && z <= m.bounds.max[2];
    if (!inside(b.x - b.width / 2, b.z - b.depth / 2) || !inside(b.x + b.width / 2, b.z + b.depth / 2)) errors.push(`Region ${r.id} extends outside map bounds`);
    if (b.y < m.bounds.min[1] || b.y > m.bounds.max[1]) errors.push(`Region ${r.id} floor y=${b.y} is outside bounds.min[1]..bounds.max[1]`);
    if (r.type !== 'cover' && Math.min(b.width, b.depth) * s < 3) warnings.push(`Region ${r.id} is narrower than 3 m; players will scrape walls`);
    for (const c of r.cover) {
      const [px, , pz] = c.pos;
      if (Math.abs(px - b.x) > b.width / 2 + .01 || Math.abs(pz - b.z) > b.depth / 2 + .01) warnings.push(`Cover ${c.type} in ${r.id} sits outside its region (pos uses absolute map coordinates)`);
    }
    const touched = m.connections.some(c => c.from === r.id || c.to === r.id);
    const overlaps = m.regions.some(o => o !== r && Math.abs(o.bounds.x - b.x) <= (o.bounds.width + b.width) / 2 && Math.abs(o.bounds.z - b.z) <= (o.bounds.depth + b.depth) / 2);
    if (!touched && !overlaps && r.type !== 'cover') errors.push(`Region ${r.id} has no connection and touches no other region; it is an island`);
  }

  const t = arena.red[0], ct = arena.blue[0];
  // Sites usually have cover at their centre; target the closest open spot within 6 m.
  const open = (p: Point): Point | undefined => {
    for (let r = 0; r <= 6; r += 1) for (let k = 0; k < (r ? 12 : 1); k++) {
      const q = { x: p.x + Math.cos(k * Math.PI / 6) * r, z: p.z + Math.sin(k * Math.PI / 6) * r };
      if (surfaceHeight(arena, q) !== undefined && nav.clear(q, q, .7, .3)) return { ...q, y: surfaceHeight(arena, q) };
    }
  };
  const reach = (from: Point, target: Point, label: string) => {
    const to = open(target);
    if (!to) { errors.push(`${label}: no open floor within 6 m of the destination`); return; }
    if (!nav.path(from, to).length) errors.push(`${label}: no walkable route (check connections, cover blocking corridors, or steep drops)`);
  };
  for (const [team, spawns] of [['T', arena.red], ['CT', arena.blue]] as const)
    spawns.forEach((p, i) => { if (surfaceHeight(arena, p) === undefined || !nav.clear(p, p, .7, .4)) errors.push(`${team} spawn slot ${i + 1} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is blocked or off the floor; widen the spawn region (needs >= 14 m wide) or move cover`); });
  if (ct.z <= t.z) errors.push('spawn_t must be at the -z end of the map (top of the preview) and spawn_ct at the +z end');
  else if (ct.z < arena.depth * .29 || t.z > -arena.depth * .29) warnings.push('Spawns should sit in the outer ~20% of the map along z');
  for (const team of ['red', 'blue'] as const) if (spawnCandidates(nav, team, true).length < 10) errors.push(`${team === 'red' ? 'T' : 'CT'} spawn region needs more open floor near its centre (at least ~10 clear 1.5 m cells within 12 m); enlarge it or remove cover`);
  reach(t, ct, 'T spawn -> CT spawn');
  for (const site of arena.sites ?? []) { reach(t, site, `T spawn -> site ${site.label}`); reach(ct, site, `CT spawn -> site ${site.label}`); }
  if (!arena.sites?.length) warnings.push('No bombsites (regions with type "site" and tag bombsite_a / bombsite_b)');
  const spawnDistance = distance(t, ct);
  if (spawnDistance < 30) warnings.push(`Spawns are only ${spawnDistance.toFixed(0)} m apart; 50-110 m plays best`);
  if (arena.width * arena.depth < 40 * 40) warnings.push('Map is very small (under 40 x 40 m)');

  const stats = { name: arena.name, biome: arena.biome, width: arena.width, depth: arena.depth, regions: m.regions.length, connections: m.connections.length, boxes: arena.boxes.length, spawnDistance: Math.round(spawnDistance) };
  return { ok: !errors.length, errors, warnings, stats, ascii: asciiPreview(arena, nav), svg: svgPreview(arena), arena };
}

// One character per ~2 m. Legend: . floor  ^ raised  v lowered  # obstacle  T/C spawns  A/B sites  (space) void
export function asciiPreview(arena: Arena, nav = new Navigation(arena)): string {
  const step = Math.max(1, Math.ceil(Math.max(arena.width, arena.depth) / 90));
  const cols = Math.ceil(arena.width / step), rows = Math.ceil(arena.depth / step);
  const grid = Array.from({ length: rows }, () => Array<string>(cols).fill(' '));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = { x: (c + .5) * step - arena.width / 2, z: (r + .5) * step - arena.depth / 2 };
    const y = surfaceHeight(arena, p);
    if (y === undefined) continue;
    grid[r][c] = !nav.clear(p, p, .7, 0) ? '#' : y > .5 ? '^' : y < -.5 ? 'v' : '.';
  }
  const mark = (p: Point, ch: string) => {
    const c = Math.floor((p.x + arena.width / 2) / step), r = Math.floor((p.z + arena.depth / 2) / step);
    if (grid[r]?.[c] !== undefined) grid[r][c] = ch;
  };
  arena.red.forEach(p => mark(p, 'T')); arena.blue.forEach(p => mark(p, 'C'));
  for (const s of arena.sites ?? []) mark(s, s.label);
  return grid.map(row => row.join('').replace(/\s+$/, '')).join('\n');
}

export function svgPreview(arena: Arena): string {
  const scale = 6, w = arena.width * scale, h = arena.depth * scale;
  const X = (x: number) => (x + arena.width / 2) * scale, Z = (z: number) => (z + arena.depth / 2) * scale;
  const parts: string[] = [];
  for (const b of arena.boxes) {
    const fill = b.kind === 'floor' ? `hsl(${35 + Math.max(-6, Math.min(6, b.y)) * 6},35%,${62 + b.y * 4}%)` : b.kind === 'beam' ? 'rgba(40,40,60,.25)' : b.kind === 'crate' ? '#8a5a35' : b.kind === 'door' ? '#6b3d22' : '#3b3b3b';
    const transform = b.rotY ? ` transform="rotate(${-b.rotY * 180 / Math.PI} ${X(b.x)} ${Z(b.z)})"` : '';
    parts.push(`<rect x="${X(b.x - b.w / 2).toFixed(1)}" y="${Z(b.z - b.d / 2).toFixed(1)}" width="${(b.w * scale).toFixed(1)}" height="${(b.d * scale).toFixed(1)}" fill="${fill}"${transform}/>`);
  }
  for (const a of arena.areas ?? []) parts.push(`<text x="${X(a.x)}" y="${Z(a.z)}" font-size="10" text-anchor="middle" fill="#111" font-family="monospace">${a.name}</text>`);
  for (const [list, color] of [[arena.red, '#c0392b'], [arena.blue, '#2471a3']] as const) for (const p of list) parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="5" fill="${color}"/>`);
  for (const s of arena.sites ?? []) parts.push(`<text x="${X(s.x)}" y="${Z(s.z) + 14}" font-size="28" font-weight="bold" text-anchor="middle" fill="#e67e22" font-family="sans-serif">${s.label}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#1b1b1b"/>${parts.join('')}</svg>`;
}
