export const JUMP_IMPULSE = 7.2;

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
