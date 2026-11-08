import { describe, expect, it } from 'vitest';
import { BOT_SKILL, inventory, isGrenade, WEAPONS } from '../src/config';
import { damageAtRange, groundVelocity, segmentBox, segmentCircle, shotSpread } from '../src/math';

describe('movement and accuracy', () => {
  it('caps diagonal movement at the same speed as forward movement', () => {
    let v = { x: 0, z: 0 };
    for (let i = 0; i < 60; i++) v = groundVelocity(v.x, v.z, 1, 1, 6, 1 / 60);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(6);
  });
  it('counter-strafes faster than passive friction', () => {
    const passive = groundVelocity(6, 0, 0, 0, 6, 1 / 60);
    const counter = groundVelocity(6, 0, -1, 0, 6, 1 / 60);
    expect(Math.abs(counter.x)).toBeLessThan(Math.abs(passive.x));
  });
  it('rewards planted/crouched shots and penalizes jumping and unscoped sniping', () => {
    const planted = shotSpread(.002, 0, false, false, 0);
    expect(shotSpread(.002, 5, false, false, 0)).toBeGreaterThan(planted);
    expect(shotSpread(.002, 0, true, false, 0)).toBeGreaterThan(planted);
    expect(shotSpread(.002, 0, false, true, 0)).toBeLessThan(planted);
    expect(shotSpread(.002, 0, false, false, 10)).toBeGreaterThan(planted);
    expect(shotSpread(.002, 0, false, false, 0, true)).toBeGreaterThan(.07);
  });
});

describe('combat tuning', () => {
  it('provides all six inventory slots for every primary', () => {
    for (const id of ['ak', 'm4', 'awp'] as const) expect(inventory(id)).toEqual([id, 'pistol', 'knife', 'he', 'flash', 'smoke']);
  });
  it('makes AK headshots and close-range AWP body shots lethal', () => {
    expect(damageAtRange(WEAPONS.ak.damage, 10, true, WEAPONS.ak.head)).toBeGreaterThanOrEqual(100);
    expect(damageAtRange(WEAPONS.awp.damage, 10, false, WEAPONS.awp.head)).toBeGreaterThanOrEqual(100);
    expect(damageAtRange(WEAPONS.pistol.damage, 10, false, WEAPONS.pistol.head)).toBeLessThan(100);
  });
  it('changes difficulty through aim and reaction, never extra damage', () => {
    expect(BOT_SKILL.easy.error).toBeGreaterThan(BOT_SKILL.medium.error);
    expect(BOT_SKILL.medium.error).toBeGreaterThan(BOT_SKILL.hard.error);
    expect(BOT_SKILL.easy.reaction).toBeGreaterThan(BOT_SKILL.hard.reaction);
    expect(isGrenade('he')).toBe(true); expect(isGrenade('ak')).toBe(false);
  });
});

describe('perception primitives', () => {
  const box = { x: 0, y: 2, z: 0, w: 2, h: 4, d: 2 };
  it('blocks sight through walls including axis-aligned rays', () => {
    expect(segmentBox({ x: 0, z: -4 }, { x: 0, z: 4 }, box)).toBe(true);
    expect(segmentBox({ x: 3, z: -4 }, { x: 3, z: 4 }, box)).toBe(false);
    expect(segmentBox({ x: -4, z: 0 }, { x: 4, z: 0 }, box)).toBe(true);
  });
  it('blocks smoke crossings and sight from inside smoke', () => {
    expect(segmentCircle({ x: 0, z: -8 }, { x: 0, z: 8 }, { x: 0, z: 0 }, 4)).toBe(true);
    expect(segmentCircle({ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 0 }, 4)).toBe(true);
    expect(segmentCircle({ x: 8, z: -8 }, { x: 8, z: 8 }, { x: 0, z: 0 }, 4)).toBe(false);
  });
});
