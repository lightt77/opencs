import { distance, segmentBox, type Point, type Box } from './math';
import type { Arena } from './maps';

export class Navigation {
  readonly cell = 1.5;
  readonly cols: number;
  readonly rows: number;
  readonly walkable: Uint8Array;
  readonly walls: Box[];

  constructor(readonly arena: Arena) {
    this.cols = Math.ceil(arena.width / this.cell);
    this.rows = Math.ceil(arena.depth / this.cell);
    this.walls = arena.boxes.filter(b => b.y - b.h / 2 < 1.7);
    this.walkable = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.walkable.length; i++) {
      const p = this.point(i);
      this.walkable[i] = Number(Math.abs(p.x) < arena.width / 2 - 1 && Math.abs(p.z) < arena.depth / 2 - 1 && !this.walls.some(b => Math.abs(p.x - b.x) < b.w / 2 + .5 && Math.abs(p.z - b.z) < b.d / 2 + .5));
    }
  }

  point(i: number): Point {
    return { x: (i % this.cols + .5) * this.cell - this.arena.width / 2, z: (Math.floor(i / this.cols) + .5) * this.cell - this.arena.depth / 2 };
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
    return !this.arena.boxes.some(box => box.y - box.h / 2 < eye && box.y + box.h / 2 > eye && segmentBox(a, b, box, padding));
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
