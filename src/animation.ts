import { clamp } from './math';
import { CROUCH_DROP } from './movement';

export interface LegPose { hip: number; knee: number; ankle: number; roll: number }

// Two-bone IK: knee bends back; the ankle cancels the joint rotation to plant a flat boot.
export function solveLeg(x: number, y: number, z: number): LegPose {
  const thigh = .41, shin = .39;
  const planeY = Math.hypot(x, y);
  const reach = clamp(Math.hypot(planeY, z), .05, thigh + shin - .002);
  const hip = Math.atan2(-z, planeY) + Math.acos(clamp((thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach), -1, 1));
  const knee = -Math.acos(clamp((reach * reach - thigh * thigh - shin * shin) / (2 * thigh * shin), -1, 1));
  return { hip, knee, ankle: -hip - knee, roll: Math.atan2(x, -y) };
}

// First half: planted stance. Second half: lifted swing, with eased takeoff/landing.
export function footTarget(phase: number, amount: number, forward: number, sideways: number, crouch: number, bob: number) {
  const cycle = ((phase % 1) + 1) % 1;
  const swing = cycle >= .5;
  const t = swing ? (cycle - .5) * 2 : cycle * 2;
  const stride = swing ? Math.cos(t * Math.PI) : -1 + 2 * t;
  const lift = swing ? Math.sin(t * Math.PI) * .16 * amount : 0;
  return {
    x: stride * sideways * .23 * amount,
    y: -.73 + crouch * CROUCH_DROP + lift - bob,
    z: stride * forward * .3 * amount,
  };
}
