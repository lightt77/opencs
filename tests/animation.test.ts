import { describe, expect, it } from 'vitest';
import { footTarget, solveLeg } from '../src/animation';

describe('articulated walk cycle', () => {
  it('bends knees and preserves level boots throughout the cycle', () => {
    for (let phase = 0; phase < 1; phase += .025) {
      const p = footTarget(phase, 1, 1, 0, 0, 0);
      const pose = solveLeg(p.x, p.y, p.z);
      expect(pose.knee).toBeLessThan(0);
      expect(pose.hip + pose.knee + pose.ankle).toBeCloseTo(0);
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
    }
  });
  it('plants the stance foot and lifts the opposite swinging foot', () => {
    const stance = footTarget(.25, 1, 1, 0, 0, 0);
    const swing = footTarget(.75, 1, 1, 0, 0, 0);
    expect(stance.y).toBeCloseTo(-.73);
    expect(swing.y).toBeGreaterThan(stance.y + .1);
    expect(solveLeg(0, swing.y, swing.z).knee).toBeLessThan(solveLeg(0, stance.y, stance.z).knee);
  });
  it('settles when stopped and follows strafing direction', () => {
    expect(footTarget(.75, 0, 1, 0, 0, 0)).toEqual({ x: 0, y: -.73, z: 0 });
    const strafe = footTarget(.1, 1, 0, 1, 0, 0);
    expect(Math.abs(strafe.x)).toBeGreaterThan(0); expect(strafe.z).toBeCloseTo(0);
  });
  it('keeps crouched boots planted while lowering the head to crouch eye height', () => {
    const standing = footTarget(0, 0, 1, 0, 0, 0), crouched = footTarget(0, 0, 1, 0, 1, 0);
    expect(crouched.y - standing.y).toBeCloseTo(.54);
    const pose = solveLeg(crouched.x, crouched.y, crouched.z);
    expect(Object.values(pose).every(Number.isFinite)).toBe(true);
    expect(pose.hip + pose.knee + pose.ankle).toBeCloseTo(0);
  });
});
