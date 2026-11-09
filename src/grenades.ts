import { clamp } from './math';

export const GRENADE_CHARGE_SECONDS = 1.5;
export function grenadeThrow(heldSeconds: number) {
  const charge = clamp(heldSeconds / GRENADE_CHARGE_SECONDS, 0, 1);
  return { charge, speed: 8 + charge * 14, spread: .065 * (1 - charge) };
}
