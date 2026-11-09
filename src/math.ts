export interface Point { x: number; z: number }
export interface Box { x: number; y: number; z: number; w: number; h: number; d: number; color?: number; kind?: 'wall' | 'crate' | 'building' | 'beam' | 'door' }
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Slab intersection in the horizontal plane. Used by AI perception and blast occlusion.
export function segmentBox(a: Point, b: Point, box: Box, padding = 0): boolean {
  let near = 0, far = 1;
  for (const [origin, direction, center, half] of [
    [a.x, b.x - a.x, box.x, box.w / 2 + padding],
    [a.z, b.z - a.z, box.z, box.d / 2 + padding],
  ]) {
    if (Math.abs(direction) < 1e-8) {
      if (origin < center - half || origin > center + half) return false;
    } else {
      const t1 = (center - half - origin) / direction;
      const t2 = (center + half - origin) / direction;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (near > far) return false;
    }
  }
  return true;
}

export function segmentCircle(a: Point, b: Point, center: Point, radius: number): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((center.x - a.x) * dx + (center.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(a.x + dx * t - center.x, a.z + dz * t - center.z) < radius;
}

// Counter-strafing cancels momentum quickly without changing the speed cap diagonally.
export function groundVelocity(vx: number, vz: number, dx: number, dz: number, speed: number, dt: number) {
  const friction = Math.max(0, 1 - 10 * dt);
  vx *= friction; vz *= friction;
  const length = Math.hypot(dx, dz);
  if (length > 0) {
    dx /= length; dz /= length;
    const add = Math.min(speed - (vx * dx + vz * dz), speed * 12 * dt);
    if (add > 0) { vx += dx * add; vz += dz * add; }
  }
  const lengthV = Math.hypot(vx, vz);
  if (lengthV > speed) { vx *= speed / lengthV; vz *= speed / lengthV; }
  return { x: vx, z: vz };
}

export function shotSpread(base: number, speed: number, airborne: boolean, crouch: boolean, shots: number, unscoped = false) {
  return base * (crouch ? .65 : 1) + speed * .0035 + (airborne ? .055 : 0) + Math.min(shots, 12) * .0011 + (unscoped ? .075 : 0);
}

export function damageAtRange(damage: number, distance: number, head: boolean, multiplier: number, falloff = 450) {
  return Math.max(1, Math.round(damage * (head ? multiplier : 1) * Math.max(.7, 1 - distance / falloff)));
}
