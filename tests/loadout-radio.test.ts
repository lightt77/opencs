import { describe, expect, it, vi } from 'vitest';
import { Actor } from '../src/actor';
import { DEFAULTS, grenadeLoadout, inventory, sanitizeWeapons, WEAPON_IDS } from '../src/config';
import { grenadeThrow } from '../src/grenades';
import { coverHits, penetration } from '../src/ballistics';
import { ASSET_SHOTS, AUDIO_ASSETS, RADIO_LINES } from '../src/audio-assets';
import { Radio } from '../src/radio';

function actor(allowed = [...WEAPON_IDS]) {
  const a = Object.assign(Object.create(Actor.prototype) as Actor, { allowedWeapons: allowed, primary: 'ak', grenadeCapacity: 3, ammo: {}, refillTimers: {}, reload: 0 });
  a.refill(); return a;
}

describe('match weapon restrictions', () => {
  it('supports rifle-only, pistol-only, knife-only, grenade-only and mixed primary sets', () => {
    expect(inventory('ak', ['awp'])).toEqual(['awp']);
    expect(inventory('ak', ['pistol'])).toEqual(['pistol']);
    expect(inventory('awp', ['knife'])).toEqual(['knife']);
    expect(inventory('ak', ['he', 'flash'])).toEqual(['he', 'flash']);
    expect(inventory('awp', ['ak', 'awp'])).toEqual(['awp']);
    expect(inventory('ak', ['ak', 'awp'])).toEqual(['ak']);
  });
  it('rejects empty/invalid restrictions and deduplicates stored IDs', () => {
    expect(sanitizeWeapons([])).toEqual(DEFAULTS.allowedWeapons);
    expect(sanitizeWeapons(['bad'])).toEqual(DEFAULTS.allowedWeapons);
    expect(sanitizeWeapons(['he', 'he', 'bad', 'knife'])).toEqual(['knife', 'he']);
  });
  it('shares no more than three grenade slots across enabled types', () => {
    expect(grenadeLoadout(['he', 'flash', 'smoke'], 3)).toEqual({ he: 1, flash: 1, smoke: 1 });
    expect(grenadeLoadout(['he'], 3)).toEqual({ he: 3, flash: 0, smoke: 0 });
    expect(grenadeLoadout(['he', 'smoke'], 3)).toEqual({ he: 2, flash: 0, smoke: 1 });
    expect(grenadeLoadout(['knife'], 3)).toEqual({ he: 0, flash: 0, smoke: 0 });
    expect(grenadeLoadout(['flash'], 99).flash).toBe(3);
  });
});

describe('deathmatch resupply', () => {
  it('restores full magazines/reserves at the deadline, not on every shot', () => {
    const a = actor(); a.ammo.ak.clip = 2; a.ammo.ak.reserve = 0;
    a.scheduleRefill('ak', 10); a.replenish(9);
    a.ammo.ak.clip--; a.scheduleRefill('ak', 10);
    expect(a.refillTimers.ak).toBe(1); expect(a.ammo.ak.clip).toBe(1);
    a.reload = 2; a.replenish(1);
    expect(a.ammo.ak).toEqual({ clip: 30, reserve: 90 }); expect(a.refillTimers.ak).toBeUndefined();
  });
  it('refills grenade allocations without exceeding total capacity or restoring banned weapons', () => {
    const a = actor(['he', 'smoke']);
    expect(a.ammo.he.clip).toBe(2); expect(a.ammo.smoke.clip).toBe(1); expect(a.ammo.ak.clip).toBe(0);
    a.ammo.he.clip = 0; a.ammo.smoke.clip = 0;
    a.scheduleRefill('he', 10); a.scheduleRefill('smoke', 10); a.replenish(10);
    expect(a.ammo.he.clip + a.ammo.smoke.clip).toBe(3); expect(a.ammo.flash.clip).toBe(0);
    a.scheduleRefill('ak', 1); a.replenish(1); expect(a.ammo.ak.clip).toBe(0);
  });
  it('does not change health or cooldowns, and fresh loadouts clear old refill timers', () => {
    const a = actor(['pistol']); a.health = 17; a.scheduleRefill('pistol', 10); a.refill();
    expect(a.refillTimers).toEqual({}); expect(a.health).toBe(17);
    a.scheduleRefill('knife', 10); expect(a.refillTimers).toEqual({});
  });
});

describe('deathmatch primary changes', () => {
  function equipped(): Actor {
    const a = actor();
    Object.assign(a, { alive: true, weapon: 'ak', previousWeapon: 'pistol', health: 37, cooldowns: {}, model: { equip: vi.fn() }, awpShotAge: .1 });
    return a;
  }

  it('replaces only the primary, cancels reloading, and keeps a valid quick-switch target', () => {
    const a = equipped(); a.ammo.pistol.clip = 5; a.ammo.he.clip = 0; a.reload = 2;
    expect(a.changePrimary('m4')).toBe(true);
    expect(a.primary).toBe('m4'); expect(a.weapon).toBe('m4'); expect(a.weapons).not.toContain('ak');
    expect(a.ammo.m4).toEqual({ clip: 30, reserve: 90 }); expect(a.reload).toBe(0); expect(a.switching).toBe(.25);
    expect(a.health).toBe(37); expect(a.ammo.pistol.clip).toBe(5); expect(a.ammo.he.clip).toBe(0);
    expect(a.previousWeapon).toBe('pistol'); expect(a.quickSwitch()).toBe(true); expect(a.weapon).toBe('pistol');
    expect(a.changePrimary('m4')).toBe(true); expect(a.weapon).toBe('m4');
  });

  it('preserves spent or exhausted primary ammo and per-weapon cooldowns when switching back', () => {
    const a = equipped(); a.ammo.ak = { clip: 0, reserve: 0 }; a.cooldown = .08;
    a.changePrimary('awp'); a.ammo.awp.clip = 4; a.cooldown = 1.2;
    a.changePrimary('ak'); expect(a.ammo.ak).toEqual({ clip: 0, reserve: 0 }); expect(a.cooldown).toBe(.08);
    a.changePrimary('awp'); expect(a.ammo.awp.clip).toBe(4); expect(a.cooldown).toBe(1.2); expect(a.awpShotAge).toBe(.1);
  });

  it('lets normal timed resupply replenish previously used primaries, but not banned ones', () => {
    const a = equipped(); a.ammo.ak.clip = 1; a.scheduleRefill('ak', 10); a.changePrimary('m4');
    a.replenish(9); a.changePrimary('ak'); expect(a.ammo.ak.clip).toBe(1);
    a.changePrimary('m4'); a.replenish(1); a.changePrimary('ak'); expect(a.ammo.ak.clip).toBe(30);
    a.ammo.ak.clip = 2; a.scheduleRefill('ak', 1); a.allowedWeapons = ['m4']; a.changePrimary('m4');
    a.replenish(1); expect(a.ammo.ak.clip).toBe(2); expect(a.changePrimary('ak')).toBe(false);
  });

  it('rejects invalid/restricted primaries and queues dead players without reviving or resupplying', () => {
    const a = equipped(); a.allowedWeapons = ['ak', 'pistol'];
    expect(a.changePrimary('awp')).toBe(false); expect(a.changePrimary('pistol' as 'ak')).toBe(false);
    expect(a.primary).toBe('ak'); expect(a.weapon).toBe('ak');
    a.allowedWeapons.push('m4'); a.alive = false; a.health = 0;
    expect(a.changePrimary('m4')).toBe(true); expect(a.primary).toBe('m4'); expect(a.alive).toBe(false); expect(a.health).toBe(0);
    expect(a.ammo.m4.clip).toBe(0); a.refill(); expect(a.ammo.m4.clip).toBe(30); expect(a.ammo.ak.clip).toBe(0);
  });
});

describe('charged grenade throws', () => {
  it('increases speed and precision up to a finite 1.5-second cap', () => {
    const tap = grenadeThrow(0), middle = grenadeThrow(.75), full = grenadeThrow(1.5);
    expect(tap.speed).toBeCloseTo(34 * 8 / 22); expect(middle.speed).toBeCloseTo(34 * 15 / 22); expect(full.speed).toBe(34);
    expect(tap.spread).toBeGreaterThan(middle.spread); expect(full.spread).toBe(0);
    expect(grenadeThrow(99)).toEqual(full); expect(grenadeThrow(-1)).toEqual(tap);
  });
});

describe('all-wall penetration', () => {
  const hits = (thickness: number) => coverHits({ x: 0, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, [{ x: 0, y: 2, z: 0, w: 4, h: 4, d: thickness, kind: 'wall' }], 30);
  it('allows thick walls for all firearms, reduces damage by thickness, never permits knife wall hits', () => {
    for (const weapon of ['ak', 'm4', 'awp', 'pistol'] as const) {
      const thin = penetration(weapon, hits(.2), 'walls').multiplier, thick = penetration(weapon, hits(4), 'walls').multiplier;
      expect(thick).toBeGreaterThan(0); expect(thick).toBeLessThan(thin); expect(thin).toBeLessThan(1);
    }
    expect(penetration('knife', hits(.01), 'walls').multiplier).toBe(0);
    expect(penetration('awp', hits(.01), 'off').multiplier).toBe(0);
  });
});

describe('supplied audio manifest and radio scheduling', () => {
  it('resolves every requested scenario to an existing asset, including filename variants', () => {
    for (const name of [...Object.values(ASSET_SHOTS), 'footsteps', 'jump1', 'zoom', 'generic_reload', ...Object.values(RADIO_LINES).flat()]) expect(AUDIO_ASSETS[name], name).toBeTruthy();
  });
  it('prevents overlap and chatter spam; victory interrupts a lower-priority call', () => {
    const play = vi.fn(() => 1), radio = new Radio(play);
    expect(radio.say('headshot', 'Echo', 0)).toBe(true);
    expect(radio.say('overwhelmed', 'Moss', .5)).toBe(false);
    expect(radio.say('headshot', 'Echo', 3)).toBe(false);
    expect(radio.say('bigVictory', 'Rook', .6, true)).toBe(true);
    expect(play).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(radio.message?.event).toBe('bigVictory');
  });
  it('avoids consecutive duplicate variants and clears round knowledge', () => {
    const radio = new Radio(() => 1);
    radio.say('headshot', 'Echo', 0, false, () => 0); const first = radio.message?.clip;
    radio.say('headshot', 'Moss', 8, false, () => 0); expect(radio.message?.clip).not.toBe(first);
    radio.observedDeaths.add(7); radio.reset(); expect(radio.observedDeaths.size).toBe(0); expect(radio.message).toBeUndefined();
    radio.enabled = false; expect(radio.say('bigVictory', 'Echo', 9, true)).toBe(false);
  });
});
