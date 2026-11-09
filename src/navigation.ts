import { distance, segmentBox, type Point, type Box } from './math';
import type { Arena } from './maps';
import { surfaceHeight } from './map-schema';
import { rayBox } from './ballistics';

export class Navigation {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly walkable: Uint8Array;
  readonly walls: Box[];
  private buckets = new Map<string, Box[]>();

  constructor(readonly arena: Arena) {
    this.cell = arena.navCell ?? 1.5;
    this.cols = Math.ceil(arena.width / this.cell);
    this.rows = Math.ceil(arena.depth / this.cell);
    this.walls = arena.boxes.filter(b => b.kind !== 'floor' && b.kind !== 'beam' && (arena.surface || b.y - b.h / 2 < 1.7));
    for (const b of arena.boxes.filter(b => b.kind !== 'floor')) {
      const c = Math.abs(Math.cos(b.rotY ?? 0)), s = Math.abs(Math.sin(b.rotY ?? 0));
      const w = (b.w * c + b.d * s) / 2, d = (b.w * s + b.d * c) / 2;
      for (let x = Math.floor((b.x - w) / 8); x <= Math.floor((b.x + w) / 8); x++) for (let z = Math.floor((b.z - d) / 8); z <= Math.floor((b.z + d) / 8); z++) {
        const key = `${x}:${z}`, list = this.buckets.get(key) ?? []; list.push(b); this.buckets.set(key, list);
      }
    }
    this.walkable = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.walkable.length; i++) {
      const p = this.point(i);
      this.walkable[i] = Number(Math.abs(p.x) < arena.width / 2 - 1 && Math.abs(p.z) < arena.depth / 2 - 1 && (!arena.surface ? !this.walls.some(b => Math.abs(p.x - b.x) < b.w / 2 + .5 && Math.abs(p.z - b.z) < b.d / 2 + .5) : this.clear(p, p, .9, .5)));
    }
  }

  point(i: number): Point {
    const p: Point = { x: (i % this.cols + .5) * this.cell - this.arena.width / 2, z: (Math.floor(i / this.cols) + .5) * this.cell - this.arena.depth / 2 };
    if (this.arena.surface) p.y = surfaceHeight(this.arena, p);
    return p;
  }

  nearest(p: Point): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.walkable.length; i++) {
      if (!this.walkable[i]) continue;
      const d = distance(p, this.point(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  clear(a: Point, b: Point, eye = 1.4, padding = 0): boolean {
    if (this.arena.surface) {
      const ay = a.y ?? surfaceHeight(this.arena, a), by = b.y ?? surfaceHeight(this.arena, b);
      if (ay === undefined || by === undefined || surfaceHeight(this.arena, a) === undefined || surfaceHeight(this.arena, b) === undefined) return false;
      const length = Math.hypot(b.x - a.x, by - ay, b.z - a.z);
      const origin = { x: a.x, y: ay + eye, z: a.z };
      const direction = { x: length ? (b.x - a.x) / length : 0, y: length ? (by - ay) / length : 0, z: length ? (b.z - a.z) / length : 0 };
      if (this.nearby(a, b, padding).some(box => rayBox(origin, direction, { ...box, w: box.w + padding * 2, d: box.d + padding * 2 }, length))) return false;
      // A straight movement shortcut must follow actual floors, not cross voids or cliffs.
      let previous = ay;
      const steps = Math.max(1, Math.ceil(distance(a, b) * 5));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        const h = surfaceHeight(this.arena, p);
        if (h === undefined || Math.abs(h - previous) > .25 || Math.abs(h - (ay + (by - ay) * t)) > .3) return false;
        previous = h;
      }
      return true;
    }
    return !this.arena.boxes.some(box => box.y - box.h / 2 < eye && box.y + box.h / 2 > eye && segmentBox(a, b, box, padding));
  }

  private nearby(a: Point, b: Point, padding: number) {
    const boxes = new Set<Box>();
    for (let x = Math.floor((Math.min(a.x, b.x) - padding) / 8); x <= Math.floor((Math.max(a.x, b.x) + padding) / 8); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - padding) / 8); z <= Math.floor((Math.max(a.z, b.z) + padding) / 8); z++) {
        for (const box of this.buckets.get(`${x}:${z}`) ?? []) boxes.add(box);
      }
    }
    return [...boxes];
  }

  path(from: Point, to: Point): Point[] {
    if (this.clear(from, to, .7, .45)) return [to];
    const start = this.nearest(from), end = this.nearest(to);
    if (start < 0 || end < 0) return [];
    const open = new Set([start]);
    const came = new Map<number, number>();
    const scores = new Float32Array(this.walkable.length).fill(Infinity);
    const estimated = new Float32Array(this.walkable.length).fill(Infinity);
    scores[start] = 0; estimated[start] = distance(this.point(start), this.point(end));
    while (open.size) {
      let current = -1, best = Infinity;
      for (const i of open) if (estimated[i] < best) { best = estimated[i]; current = i; }
      if (current === end) {
        const result: Point[] = [this.point(end)];
        while (came.has(current)) { current = came.get(current)!; result.push(this.point(current)); }
        result.reverse(); result.shift();
        // Greedy string-pulling keeps bots from zig-zagging between grid centers.
        const smooth: Point[] = [];
        let anchor = from, index = 0;
        while (index < result.length) {
          let next = index;
          while (next + 1 < result.length && this.clear(anchor, result[next + 1], .7, .48)) next++;
          anchor = result[next]; smooth.push(anchor); index = next + 1;
        }
        return smooth;
      }
      open.delete(current);
      const cx = current % this.cols, cz = Math.floor(current / this.cols);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = cx + dx, z = cz + dz, n = z * this.cols + x;
        if (x < 0 || x >= this.cols || z < 0 || z >= this.rows || !this.walkable[n]) continue;
        if (this.arena.surface && !this.clear(this.point(current), this.point(n), .7, .35)) continue;
        if (dx && dz && (!this.walkable[cz * this.cols + x] || !this.walkable[z * this.cols + cx])) continue;
        const score = scores[current] + (dx && dz ? 1.4142 : 1);
        if (score >= scores[n]) continue;
        came.set(n, current); scores[n] = score;
        estimated[n] = score + distance(this.point(n), this.point(end)) / this.cell;
        open.add(n);
      }
    }
    return [];
  }
}
