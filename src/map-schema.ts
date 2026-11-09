import type { Arena } from './maps';
import { BIOMES, type BiomeId } from './biomes';
import type { MapId } from './config';
import { clamp, type Box, type Point } from './math';

type Vec3 = [number, number, number];
export interface MapDefinition {
  mapName: string; unitScale: number; bounds: { min: number[]; max: number[] };
  regions: Array<{ id: string; type: string; bounds: { x: number; y: number; z: number; width: number; height: number; depth: number }; tags: string[];
    cover: Array<{ type: string; pos: number[]; size: number[]; rotY?: number }> }>;
  connections: Array<{ from: string; to: string; type: string; elevationChange?: number }>;
}
export interface SurfaceGrid { cell: number; cols: number; rows: number; heights: Float32Array }

export function validateMap(value: unknown): asserts value is MapDefinition {
  const m = value as MapDefinition;
  const vector = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
  if (!m || typeof m.mapName !== 'string' || !Number.isFinite(m.unitScale) || m.unitScale <= 0 || m.unitScale > 10 || !vector(m.bounds?.min) || !vector(m.bounds?.max)) throw new Error('Invalid map name, scale or bounds');
  if (m.bounds.max.some((n, i) => n <= m.bounds.min[i]) || m.bounds.max.some((n, i) => (n - m.bounds.min[i]) * m.unitScale > 512)) throw new Error('Map bounds must be positive and at most 512 metres per axis');
  if (!Array.isArray(m.regions) || !m.regions.length || m.regions.length > 128 || !Array.isArray(m.connections) || m.connections.length > 512) throw new Error('Invalid region/connection count');
  const ids = new Set<string>();
  for (const r of m.regions) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || typeof r.type !== 'string') throw new Error('Duplicate or invalid region ID');
    ids.add(r.id);
    const b = r.bounds;
    if (!b || ![b.x, b.y, b.z, b.width, b.height, b.depth].every(Number.isFinite) || Math.min(b.width, b.height, b.depth) <= 0) throw new Error(`Invalid bounds: ${r.id}`);
    if (!Array.isArray(r.tags) || !r.tags.every(t => typeof t === 'string') || !Array.isArray(r.cover) || r.cover.length > 128) throw new Error(`Invalid tags/cover: ${r.id}`);
    for (const c of r.cover) if (typeof c.type !== 'string' || !vector(c.pos) || !vector(c.size) || c.size.some(n => n <= 0) || (c.rotY !== undefined && !Number.isFinite(c.rotY))) throw new Error(`Invalid cover: ${r.id}`);
  }
  for (const c of m.connections) if (!ids.has(c.from) || !ids.has(c.to) || typeof c.type !== 'string' || (c.elevationChange !== undefined && !Number.isFinite(c.elevationChange))) throw new Error('Invalid connection reference');
  for (const tag of ['spawn_ct', 'spawn_t']) if (!m.regions.some(r => r.tags.includes(tag))) throw new Error(`Missing ${tag} region`);
}

export function surfaceHeight(arena: Arena, p: Point): number | undefined {
  const g = arena.surface;
  if (!g) return 0;
  const x = Math.floor((p.x + arena.width / 2) / g.cell), z = Math.floor((p.z + arena.depth / 2) / g.cell);
  if (x < 0 || z < 0 || x >= g.cols || z >= g.rows) return;
  const y = g.heights[z * g.cols + x];
  return Number.isFinite(y) ? y : undefined;
}

// Compile declarative regions into a deterministic, single-layer blockout. Connections
// infer L-shaped corridors; all elevation changes get accessible 20cm stair ramps.
// The supplied source stays unchanged. This is not a stacked-floor/navmesh importer.
export function compileMap(value: unknown, id: MapId, name: string, biome: BiomeId): Arena {
  validateMap(value); const m = value, s = m.unitScale;
  const width = Math.ceil((m.bounds.max[0] - m.bounds.min[0]) * s), depth = Math.ceil((m.bounds.max[2] - m.bounds.min[2]) * s);
  const cx = (m.bounds.min[0] + m.bounds.max[0]) / 2, cz = (m.bounds.min[2] + m.bounds.max[2]) / 2;
  const cell = .5, cols = width / cell, rows = depth / cell, heights = new Float32Array(cols * rows).fill(NaN);
  const regions = m.regions.map(r => ({ ...r, bounds: { x: (r.bounds.x - cx) * s, z: (r.bounds.z - cz) * s, y: r.bounds.y * s, width: r.bounds.width * s, depth: r.bounds.depth * s, height: r.bounds.height * s } }));
  const center = (i: number) => ({ x: (i % cols + .5) * cell - width / 2, z: (Math.floor(i / cols) + .5) * cell - depth / 2 });
  for (let i = 0; i < heights.length; i++) {
    const p = center(i);
    for (const r of regions) if (Math.abs(p.x - r.bounds.x) <= r.bounds.width / 2 && Math.abs(p.z - r.bounds.z) <= r.bounds.depth / 2) heights[i] = r.bounds.y;
  }
  for (const c of m.connections) {
    const a = regions.find(r => r.id === c.from)!.bounds, b = regions.find(r => r.id === c.to)!.bounds;
    const points = [{ x: a.x, z: a.z }, { x: b.x, z: a.z }, { x: b.x, z: b.z }];
    const total = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    let covered = 0;
    for (let k = 0; k < 2; k++) {
      const from = points[k], to = points[k + 1], len = Math.hypot(to.x - from.x, to.z - from.z);
      for (let i = 0; i < heights.length; i++) {
        if (Number.isFinite(heights[i])) continue;
        const p = center(i), t = len ? clamp(((p.x - from.x) * (to.x - from.x) + (p.z - from.z) * (to.z - from.z)) / (len * len), 0, 1) : 0;
        if (Math.hypot(p.x - from.x - (to.x - from.x) * t, p.z - from.z - (to.z - from.z) * t) <= 2.5) heights[i] = a.y + (b.y - a.y) * (total ? (covered + t * len) / total : 0);
      }
      covered += len;
    }
  }
  // Lower steep boundaries gradually; never create an unwalkable vertical step.
  for (let i = 0; i < heights.length; i++) if (Number.isFinite(heights[i])) heights[i] = Math.floor((heights[i] + .0001) * 5) / 5;
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let i = 0; i < heights.length; i++) {
      if (!Number.isFinite(heights[i])) continue;
      for (const j of [i % cols ? i - 1 : -1, i % cols < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
        if (j >= 0 && j < heights.length && Number.isFinite(heights[j]) && heights[i] > heights[j] + .201) { heights[i] = heights[j] + .2; changed = true; }
      }
    }
    if (!changed) break;
  }
  const boxes: Box[] = [], visited = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    if (visited[i] || !Number.isFinite(heights[i])) continue;
    const x = i % cols, z = Math.floor(i / cols), y = heights[i];
    let w = 1, d = 1;
    const matches = (j: number) => !visited[j] && Math.abs(heights[j] - y) < .01;
    while (x + w < cols && matches(i + w)) w++;
    while (z + d < rows && Array.from({ length: w }, (_, k) => i + d * cols + k).every(matches)) d++;
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) visited[i + dz * cols + dx] = 1;
    boxes.push({ x: (x + w / 2) * cell - width / 2, z: (z + d / 2) * cell - depth / 2, y: y - .25, w: w * cell, d: d * cell, h: .5, kind: 'floor' });
  }
  // Perimeter walls follow the union of region/corridor floors. Merge collinear runs.
  for (const side of ['x', 'z'] as const) {
    const lines = new Map<string, number[]>();
    for (let i = 0; i < heights.length; i++) {
      if (!Number.isFinite(heights[i])) continue;
      const x = i % cols, z = Math.floor(i / cols);
      for (const sign of [-1, 1]) {
        const nx = x + (side === 'x' ? sign : 0), nz = z + (side === 'z' ? sign : 0);
        if (nx >= 0 && nz >= 0 && nx < cols && nz < rows && Number.isFinite(heights[nz * cols + nx])) continue;
        const edge = side === 'x' ? x + (sign > 0 ? 1 : 0) : z + (sign > 0 ? 1 : 0);
        const key = `${edge}:${Math.round(heights[i] * 5)}`;
        const list = lines.get(key) ?? []; list.push(side === 'x' ? z : x); lines.set(key, list);
      }
    }
    for (const [key, values] of lines) {
      const [edge, h] = key.split(':').map(Number); values.sort((a, b) => a - b);
      for (let k = 0; k < values.length;) {
        const start = values[k]; let end = start + 1; k++;
        while (k < values.length && values[k] === end) { end++; k++; }
        boxes.push({ x: side === 'x' ? edge * cell - width / 2 : (start + end) * cell / 2 - width / 2, z: side === 'z' ? edge * cell - depth / 2 : (start + end) * cell / 2 - depth / 2, y: h / 5 + 3, w: side === 'x' ? .25 : (end - start) * cell, d: side === 'z' ? .25 : (end - start) * cell, h: 6, kind: 'wall' });
      }
    }
  }
  const arena: Arena = { ...BIOMES[biome], id, name, biome, subtitle: 'DESERT / JSON REGIONS · ELEVATION · TUNNELS', description: 'Your supplied 22-region blockout with inferred corridors and accessible stepped transitions. Not an exact recreation.', width, depth, boxes, routes: [], blue: [], red: [], surface: { cell, cols, rows, heights }, navCell: 1, viewDistance: 320, fogNear: 140, areas: [], sites: [] };
  for (const r of regions) {
    const b = r.bounds;
    arena.areas!.push({ x: b.x, z: b.z, y: b.y, name: r.id.replaceAll('_', ' ').toUpperCase(), radius: Math.max(b.width, b.depth) / 2 });
    if (r.type !== 'cover') arena.routes.push({ x: b.x, z: b.z, y: surfaceHeight(arena, b) });
    if (r.tags.includes('spawn_ct') || r.tags.includes('spawn_t')) {
      const team = r.tags.includes('spawn_ct') ? 'blue' : 'red';
      arena[team] = [-6, -3, 0, 3, 6].map(dx => ({ x: b.x + dx, z: b.z, y: surfaceHeight(arena, { x: b.x + dx, z: b.z }) }));
    }
    if (r.type === 'site') arena.sites!.push({ x: b.x, z: b.z, y: surfaceHeight(arena, b), label: r.tags.includes('bombsite_a') ? 'A' : 'B' });
    if (r.type === 'tunnel') boxes.push({ x: b.x, z: b.z, y: b.y + b.height + .15, w: b.width, d: b.depth, h: .3, kind: 'beam' });
    for (const prop of r.cover) {
      // Traversal props describe floors, not solid blockers across an entire lane.
      if (/stairs|stair_steps|ramp/.test(prop.type)) continue;
      const [px, py, pz] = prop.pos, [w, h, d] = prop.size.map(n => n * s);
      const x = (px - cx) * s, z = (pz - cz) * s, bottom = Math.max(py * s, surfaceHeight(arena, { x, z }) ?? py * s);
      const kind: Box['kind'] = /crate|boxes|container/.test(prop.type) ? 'crate' : /door/.test(prop.type) ? 'door' : 'wall';
      const add = (dx: number, dy: number, dz: number, bw: number, bh: number, bd: number) => {
        const angle = prop.rotY ?? 0;
        boxes.push({ x: x + dx * Math.cos(angle) + dz * Math.sin(angle), z: z - dx * Math.sin(angle) + dz * Math.cos(angle), y: bottom + dy + bh / 2, w: bw, h: bh, d: bd, kind, rotY: angle, color: /metal|car|truck|scaffold|container/.test(prop.type) ? 0x627d87 : undefined });
      };
      if (/window_frame|double_doors|scaffold/.test(prop.type)) {
        add(-w / 2 + .15, 0, 0, .3, h, d); add(w / 2 - .15, 0, 0, .3, h, d); add(0, h - .25, 0, w, .25, d);
      } else if (/car|pickup_truck/.test(prop.type)) { add(0, 0, 0, w, h * .55, d); add(0, h * .55, 0, w * .45, h * .45, d * .85); }
      else add(0, 0, 0, w, h, d);
    }
  }
  return arena;
}
