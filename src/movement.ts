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
