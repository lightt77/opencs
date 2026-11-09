import type { Box, Point } from './math';
import type { Settings, WeaponId } from './config';

export interface Point3 extends Point { y: number }

// Direction is normalized; entry/exit are distances, including oblique thickness.
export function rayBox(origin: Point3, direction: Point3, box: Box, range: number) {
  let entry = 0, exit = range;
  for (const [o, d, center, half] of [[origin.x, direction.x, box.x, box.w / 2], [origin.y, direction.y, box.y, box.h / 2], [origin.z, direction.z, box.z, box.d / 2]]) {
    if (Math.abs(d) < 1e-8) {
      if (o < center - half || o > center + half) return;
    } else {
      const a = (center - half - o) / d, b = (center + half - o) / d;
      entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      if (exit < entry) return;
    }
  }
  return { entry, exit };
}

export function coverHits(origin: Point3, direction: Point3, boxes: Box[], range: number) {
  return boxes.flatMap(box => {
    const hit = rayBox(origin, direction, box, range);
    return hit ? [{ ...hit, box }] : [];
  }).sort((a, b) => a.entry - b.entry);
}

export function penetration(weapon: WeaponId, hits: ReturnType<typeof coverHits>, mode: Settings['wallShots'] = 'thin') {
  const budget = weapon === 'awp' ? 1.4 : weapon === 'ak' ? .9 : weapon === 'm4' ? .75 : weapon === 'pistol' ? .2 : 0;
  let spent = 0, multiplier = 1, layers = 0;
  for (const hit of hits) {
    const wood = hit.box.kind === 'door' || hit.box.kind === 'crate';
    const cost = (hit.exit - hit.entry) * (wood ? 1 : 2.5);
    if (mode === 'off' || !budget) return { multiplier: 0, stop: hit.entry };
    if (mode === 'walls') {
      // Ordinary walls are penetrable, but thickness/material and every layer cost damage.
      multiplier *= .65 * Math.exp(-cost / (budget * 8));
      continue;
    }
    spent += Math.max(.04, cost); layers++;
    if (!budget || spent > budget || layers > 2) return { multiplier: 0, stop: hit.entry };
    multiplier *= .7 * (1 - cost / budget * .5);
  }
  return { multiplier: mode === 'walls' && hits.length ? Math.max(.025, multiplier) : multiplier, stop: undefined };
}
