import type { MapId } from './config';
import type { Box, Point } from './math';

export interface Arena {
  id: MapId; name: string; subtitle: string; description: string;
  width: number; depth: number; sky: number; fog: number; ground: number; wall: number; accent: number;
  boxes: Box[]; routes: Point[]; blue: Point[]; red: Point[];
  navCell?: number; viewDistance?: number; fogNear?: number; sniperSight?: number; scopeFov?: number;
  areas?: Array<Point & { name: string; radius: number }>;
  sites?: Array<Point & { label: string }>;
}

const box = (x: number, z: number, w: number, d: number, h = 4.8, kind: Box['kind'] = 'building', color?: number): Box => ({ x, y: h / 2, z, w, d, h, kind, color });
const crate = (x: number, z: number, w = 2, d = 2, h = 1.6) => box(x, z, w, d, h, 'crate');
const bounds = (w: number, d: number): Box[] => [box(-w / 2, 0, 1, d + 1, 6, 'wall'), box(w / 2, 0, 1, d + 1, 6, 'wall'), box(0, -d / 2, w, 1, 6, 'wall'), box(0, d / 2, w, 1, 6, 'wall')];
const spawns = (z: number): Point[] => [0, -8, 8, -4, 4].map(x => ({ x, z }));

export const MAPS: Record<MapId, Arena> = {
  dust: {
    id: 'dust', name: 'DUST II', subtitle: 'CLASSIC ROUTES / LONG · MID · TUNNELS',
    description: 'Dust2-inspired routing: Long A and pit, short/catwalk, mid double doors, B tunnels, and a defender-side A/B rotation.',
    width: 80, depth: 88, sky: 0xc6c4b0, fog: 0xc9c1a5, ground: 0xb9a27a, wall: 0xc8af83, accent: 0x8f6650,
    viewDistance: 150, fogNear: 60,
    boxes: [
      ...bounds(80, 88),
      // West: a covered upper tunnel into B, with a lower-tunnel branch into mid.
      box(-35, -5, 6, 36, 5.8), box(-15, -3, 16, 26, 5.8), box(-20, 23, 8, 14, 5.8),
      box(-11, -26, 10, 14, 5.8), box(-31, -40, 15, 5, 5.8),
      box(-19, -27, 1.5, 12, 4.6, 'wall'), box(-19, -15, 1.5, 3, 4.6, 'wall'),
      { x: -27.5, y: 3.65, z: 0, w: 9, h: .55, d: 32, kind: 'beam' },
      // East: the mid island forces short/catwalk to turn before A; Long runs outside it.
      box(13, -3, 16, 22, 5.8), box(23, -22, 8, 8, 5.8), box(22, 17, 12, 20, 5.8),
      box(37, 9, 2, 10, 2.5, 'wall'), box(33, 4, 6, 1.3, 1.1, 'wall'),
      // Staggered double doors preserve narrow mid/long peeks without closing either route.
      box(-2.4, -8, 2.4, .35, 3.1, 'door', 0x75513a), box(2.4, -7.1, 2.4, .35, 3.1, 'door', 0x75513a),
      { x: 0, y: 3.45, z: -8, w: 13, h: .6, d: 1.2, kind: 'beam' },
      box(30.8, 24, 2.2, .35, 3.1, 'door', 0x75513a), box(35.2, 23.1, 2.2, .35, 3.1, 'door', 0x75513a),
      { x: 33, y: 3.45, z: 24, w: 10, h: .6, d: 1.2, kind: 'beam' },
      // Site cover, spawn cover, and the short-to-A cross.
      crate(-31, -33, 4, 4, 2.2), crate(-25, -26, 3, 3, 1.6),
      crate(25, -34, 4, 4, 2.2), crate(32, -28, 3, 3, 1.6), crate(34, -38, 2, 2, 1.3),
      crate(12, -17, 2, 2, 1.2), crate(-8, 29, 2, 2, 1.2), crate(8, 29, 2, 2, 1.2),
    ],
    routes: [{ x: 33, z: 29 }, { x: 33, z: -10 }, { x: 28, z: -31 }, { x: 3, z: -17 }, { x: 16, z: -17 }, { x: -27.5, z: 13 }, { x: -27.5, z: -19 }, { x: -28, z: -30 }, { x: 0, z: -17 }],
    blue: spawns(36), red: spawns(-37),
    sites: [{ label: 'A', x: 29, z: -33 }, { label: 'B', x: -28, z: -30 }],
    areas: [
      { name: 'T SPAWN', x: 0, z: 36, radius: 13 }, { name: 'CT SPAWN', x: 0, z: -38, radius: 11 },
      { name: 'A SITE', x: 29, z: -33, radius: 12 }, { name: 'B SITE', x: -28, z: -30, radius: 12 },
      { name: 'LONG DOORS', x: 33, z: 24, radius: 7 }, { name: 'PIT', x: 34, z: 9, radius: 6 },
      { name: 'LONG A', x: 33, z: -8, radius: 17 }, { name: 'SHORT / CATWALK', x: 13, z: -17, radius: 9 },
      { name: 'UPPER TUNNELS', x: -27.5, z: -4, radius: 13 }, { name: 'LOWER TUNNELS', x: -20, z: 13, radius: 11 },
      { name: 'MID DOORS', x: 0, z: -8, radius: 7 }, { name: 'TOP MID', x: 0, z: 15, radius: 15 },
    ],
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
  longshot: {
    id: 'longshot', name: 'LONGSHOT RANGE', subtitle: '320 × 420 M / EXTREME RANGE',
    description: 'A vast, open proving ground. Sparse cover, 370-metre spawn sightlines. AWP recommended.',
    width: 320, depth: 420, sky: 0xc5d4d9, fog: 0xcdd9d8, ground: 0xb3b29b, wall: 0x9a9f8d, accent: 0x657e75,
    navCell: 4, viewDistance: 900, fogNear: 300, sniperSight: 600, scopeFov: 12,
    boxes: [
      ...bounds(320, 420),
      ...[-1, 1].flatMap(side => [
        box(side * 132, -145, 18, 22, 8), box(side * 132, 145, 18, 22, 8),
        box(side * 100, -75, 12, 4, 2.6, 'wall'), box(side * 100, 75, 12, 4, 2.6, 'wall'),
        crate(side * 54, -110, 4, 5, 2.2), crate(side * 54, 110, 4, 5, 2.2),
        crate(side * 72, -32, 4, 4, 1.6), crate(side * 72, 32, 4, 4, 1.6),
        crate(side * 112, 0, 5, 4, 2.2),
        box(side * 38, -180, 8, 3, 2.6, 'wall'), box(side * 38, 180, 8, 3, 2.6, 'wall'),
      ]),
    ],
    routes: [{ x: -115, z: 0 }, { x: 115, z: 0 }, { x: -45, z: -65 }, { x: 45, z: 65 }, { x: 0, z: 0 }, { x: -100, z: 130 }, { x: 100, z: -130 }],
    blue: spawns(185).map(p => ({ x: p.x * 3, z: p.z })),
    red: spawns(-185).map(p => ({ x: p.x * 3, z: p.z })),
  },
};
