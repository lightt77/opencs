export const JUMP_IMPULSE = 7.2;
export const CROUCH_DROP = .54;

// Accelerate toward the requested horizontal velocity, including braking/reversing.
// No input preserves momentum; steering never adds diagonal speed or an air boost.
export function airVelocity(vx: number, vz: number, dx: number, dz: number, maxSpeed: number, dt: number) {
  const input = Math.hypot(dx, dz);
  if (!input) return { x: vx, z: vz };
  const targetX = dx / input * maxSpeed, targetZ = dz / input * maxSpeed;
  const deltaX = targetX - vx, deltaZ = targetZ - vz, delta = Math.hypot(deltaX, deltaZ);
  const step = Math.min(1, maxSpeed * 8 * dt / Math.max(delta, 1e-8));
  return { x: vx + deltaX * step, z: vz + deltaZ * step };
}

export function movementScale(crouched: boolean, scoped: boolean, sprinting: boolean) {
  return crouched ? .48 : scoped ? .55 : sprinting ? 1.5 : 1;
}

export function scopeFov(base: number, level: number) {
  // Double optical magnification, not just half the angle.
  return level === 2 ? 2 * Math.atan(Math.tan(base * Math.PI / 360) / 2) * 180 / Math.PI : base;
}

export function footstepStride(sprinting: boolean, crouched: boolean) { return crouched ? 2.1 : sprinting ? 2.6 : 2.2; }

// Landing replenishes jumps. Walking off a ledge grants at most one air jump.
export function verticalMotion(velocity: number, grounded: boolean, jump: boolean, jumpsUsed: number, doubleJump: boolean, gravity: number, dt: number) {
  if (grounded) { velocity = -.5; jumpsUsed = 0; }
  else velocity = Math.max(-35, velocity - gravity * dt);
  if (jump && (grounded || (doubleJump && jumpsUsed < 2))) {
    velocity = JUMP_IMPULSE;
    jumpsUsed = grounded ? 1 : 2;
  }
  return { velocity, jumpsUsed };
}

// GoldSrc-style ("classic") movement, converted from Half-Life units to metres
// (1 u ≈ 2.54 cm): sv_friction 4, sv_stopspeed 75 u/s, sv_accelerate 5.5,
// sv_airaccelerate 10 and a 30 u/s air wish-speed cap, which is what makes air-strafing work.
export const CLASSIC = { friction: 4, stopSpeed: 1.9, accelerate: 5.5, airAccelerate: 10, airWishCap: .76, landingScale: .8, airSpeedCap: 1.7 };

function accelerate(vx: number, vz: number, wx: number, wz: number, wishSpeed: number, addCap: number, accel: number, dt: number) {
  const add = addCap - (vx * wx + vz * wz);
  if (add <= 0) return { x: vx, z: vz };
  const step = Math.min(accel * wishSpeed * dt, add);
  return { x: vx + wx * step, z: vz + wz * step };
}

export function classicGroundVelocity(vx: number, vz: number, dx: number, dz: number, maxSpeed: number, dt: number) {
  const speed = Math.hypot(vx, vz);
  if (speed > 0) {
    const drop = Math.max(speed, CLASSIC.stopSpeed) * CLASSIC.friction * dt, scale = Math.max(0, speed - drop) / speed;
    vx *= scale; vz *= scale;
  }
  const input = Math.hypot(dx, dz);
  if (!input) return { x: vx, z: vz };
  const v = accelerate(vx, vz, dx / input, dz / input, maxSpeed, maxSpeed, CLASSIC.accelerate, dt);
  const capped = Math.hypot(v.x, v.z);
  return capped > maxSpeed ? { x: v.x * maxSpeed / capped, z: v.z * maxSpeed / capped } : v;
}

// No input keeps momentum. Turning while holding a strafe key gains a little speed, as in CS,
// but never more than airSpeedCap × the ground speed.
export function classicAirVelocity(vx: number, vz: number, dx: number, dz: number, maxSpeed: number, dt: number) {
  const input = Math.hypot(dx, dz);
  if (!input) return { x: vx, z: vz };
  const v = accelerate(vx, vz, dx / input, dz / input, maxSpeed, Math.min(maxSpeed, CLASSIC.airWishCap), CLASSIC.airAccelerate, dt);
  const speed = Math.hypot(v.x, v.z), cap = maxSpeed * CLASSIC.airSpeedCap;
  return speed > cap ? { x: v.x * cap / speed, z: v.z * cap / speed } : v;
}
