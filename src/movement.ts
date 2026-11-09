export const JUMP_IMPULSE = 7.2;
export const CROUCH_DROP = .54;

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
