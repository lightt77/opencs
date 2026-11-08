import type { MapId } from './config';
import type { Box, Point } from './math';

export interface Arena {
  id: MapId; name: string; subtitle: string; description: string;
  width: number; depth: number; sky: number; fog: number; ground: number; wall: number; accent: number;
  boxes: Box[]; routes: Point[]; blue: Point[]; red: Point[];
}

const box = (x: number, z: number, w: number, d: number, h = 4.8, kind: Box['kind'] = 'building', color?: number): Box => ({ x, y: h / 2, z, w, d, h, kind, color });
const crate = (x: number, z: number, w = 2, d = 2, h = 1.6) => box(x, z, w, d, h, 'crate');
const bounds = (w: number, d: number): Box[] => [box(-w / 2, 0, 1, d + 1, 6, 'wall'), box(w / 2, 0, 1, d + 1, 6, 'wall'), box(0, -d / 2, w, 1, 6, 'wall'), box(0, d / 2, w, 1, 6, 'wall')];
const spawns = (z: number): Point[] => [-8, -4, 0, 4, 8].map(x => ({ x, z }));

export const MAPS: Record<MapId, Arena> = {
  dust: {
    id: 'dust', name: 'DUST YARD', subtitle: 'SUN-BAKED / THREE LANES',
    description: 'Warm stone. Tight tunnels. A dangerous mid crossing.',
    width: 58, depth: 66, sky: 0xc6c4b0, fog: 0xc9c1a5, ground: 0xb9a27a, wall: 0xc8af83, accent: 0x8f6650,
    boxes: [
      ...bounds(58, 66), box(-13, -14, 12, 15), box(13, -14, 12, 15, 5.5),
      box(-13, 14, 12, 15, 5.5), box(13, 14, 12, 15),
      crate(0, 0, 5, 3, 1.3), crate(-23, -4, 2.4, 3.5, 2.1), crate(23, 5, 2.4, 3.5, 2.1),
      crate(-3, -25, 2, 2, 1.2), crate(4, 24, 2, 2, 1.2), crate(-13, 0, 3, 2, 1.8), crate(13, 0, 3, 2, 1.8),
      { x: 0, y: 4.5, z: -7, w: 14, h: 1.4, d: 1.5, kind: 'beam' },
      { x: 0, y: 4.5, z: 7, w: 14, h: 1.4, d: 1.5, kind: 'beam' },
    ],
    routes: [{ x: -23, z: 0 }, { x: 23, z: 0 }, { x: -4, z: -5 }, { x: 4, z: 5 }, { x: -23, z: 20 }, { x: 23, z: -20 }],
    blue: spawns(28), red: spawns(-28),
  },
  snow: {
    id: 'snow', name: 'SNOW OUTPOST', subtitle: 'COLD AIR / CLOSE QUARTERS',
    description: 'An isolated outpost. Split pushes around a central depot.',
    width: 58, depth: 66, sky: 0xa8bdc9, fog: 0xc7d6df, ground: 0xd5e0e3, wall: 0x758b94, accent: 0x425c63,
    boxes: [
      ...bounds(58, 66), box(0, 0, 13, 17, 5.3),
      box(-19, -15, 9, 13, 4.7), box(19, 15, 9, 13, 4.7),
      box(19, -16, 9, 11, 3.7), box(-19, 16, 9, 11, 3.7),
      crate(-11, 3, 2.5, 3.5, 1.4), crate(11, -3, 2.5, 3.5, 1.4),
      crate(0, 20, 5, 2.5, 1.8), crate(0, -20, 5, 2.5, 1.8), crate(-25, 0, 2, 3), crate(25, 0, 2, 3),
    ],
    routes: [{ x: -10, z: 0 }, { x: 10, z: 0 }, { x: -26, z: 2 }, { x: 26, z: -2 }, { x: -9, z: -23 }, { x: 9, z: 23 }],
    blue: spawns(28), red: spawns(-28),
  },
  india: {
    id: 'india', name: 'INDIA COURT', subtitle: 'OPEN SKY / LONG SIGHTLINES',
    description: 'A symmetrical courtyard. Long angles reward a steady hand.',
    width: 58, depth: 66, sky: 0xc5cfcd, fog: 0xc4c8b9, ground: 0xabaa91, wall: 0xc3b79c, accent: 0x687c72,
    boxes: [
      ...bounds(58, 66),
      ...[-14, 14].flatMap(x => [-14, 0, 14].map(z => box(x, z, 3, 3, 5.5))),
      box(-22, 0, 4, 15, 3.6), box(22, 0, 4, 15, 3.6),
      crate(0, -13, 7, 2, 1.3), crate(0, 13, 7, 2, 1.3),
      crate(-7, 0, 2.5, 3, 1.7), crate(7, 0, 2.5, 3, 1.7),
      box(0, -30, 11, 2, 3.8), box(0, 30, 11, 2, 3.8),
      { x: -14, y: 5.2, z: 0, w: 4.5, h: .7, d: 34, kind: 'beam' },
      { x: 14, y: 5.2, z: 0, w: 4.5, h: .7, d: 34, kind: 'beam' },
    ],
    routes: [{ x: -8, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 0 }, { x: -26, z: 0 }, { x: 26, z: 0 }, { x: 0, z: -22 }],
    blue: spawns(25), red: spawns(-25),
  },
};
