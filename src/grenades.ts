import { clamp } from './math';

export const GRENADE_CHARGE_SECONDS = 1.5;
export function grenadeThrow(heldSeconds: number, power = 34) {
  const charge = clamp(heldSeconds / GRENADE_CHARGE_SECONDS, 0, 1);
  const cap = clamp(Number.isFinite(power) ? power : 34, 12, 65);
  return { charge, speed: (8 + charge * 14) * (cap / 22), spread: .065 * (1 - charge) };
}

export function grenadePhysics(weight: 'light' | 'normal' | 'heavy', bounce: boolean) {
  // Weight is deliberately game-like: heavier grenades have more drop and lose more speed.
  const scale = weight === 'light' ? .65 : weight === 'heavy' ? 1.5 : 1;
  return { mass: .4 * scale, gravity: scale, damping: weight === 'heavy' ? .18 : .02, restitution: bounce ? .62 : 0, friction: bounce ? .45 : 1 };
}

export function blastFlight(age: number) {
  const t = clamp(age, 0, 1.3);
  return { distance: 4.5 * t, height: Math.max(0, 8 * t - 10 * t * t) };
}

export function grenadePose(age: number, charge?: number) {
  const release = age >= 0 && age < .4 ? Math.sin(age / .4 * Math.PI) : 0;
  return { y: (charge === undefined ? 0 : .06) - release * .12, z: (charge === undefined ? 0 : .08 + charge * .12) - release * .35, pitch: (charge === undefined ? 0 : -.35 - charge * .35) + release * .8 };
}
