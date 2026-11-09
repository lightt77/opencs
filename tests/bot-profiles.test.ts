import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { BOT_PROFILES, drawProfiles, sanitizeProfiles } from '../src/bot-profiles';
import { botSkill, botTactics, regroupGoal, updateBot, type BotContext } from '../src/bots';
import { Actor } from '../src/actor';
import { Navigation } from '../src/navigation';
import { MAPS } from '../src/maps';
import { WEAPONS, WEAPON_IDS } from '../src/config';

function actor(id = 1, profile = BOT_PROFILES[0]): Actor {
  const body = { grounded: false, crouched: false, crouch(value: boolean) { this.crouched = value; }, move: vi.fn() };
  return Object.assign(Object.create(Actor.prototype), {
    id, team: id < 5 ? 'blue' : 'red', alive: true, human: id === 0, profile: { ...profile }, position: new Vector3(id, 0, 25),
    velocity: new Vector3(), yaw: 0, pitch: 0, health: 100, immunity: 0, flash: 0, reload: 0, switching: 0, body,
    primary: 'ak', weapon: 'ak', allowedWeapons: [...WEAPON_IDS], cooldowns: {},
    ammo: Object.fromEntries(WEAPON_IDS.map(id => [id, { clip: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }])),
    brain: { path: [], target: -1, acquired: 0, decision: 0, repath: 0, burst: 0, pause: 0, hold: 0, stuck: 0,
      previous: { x: id, z: 25 }, aimHeight: 1.13, role: 'push', coverUntil: 0, nextClimb: 1000 },
  });
}
function context(actors: Actor[]): BotContext {
  return { time: 10, difficulty: 'medium', actors, nav: new Navigation(MAPS.india), intel: {},
    movementSpeed: 1, jumpGravity: 20, visible: () => false, shoot: vi.fn(), throwGrenade: vi.fn() };
}

describe('bot personality pool', () => {
  it('defines ten unique profiles covering every skill and both behavioral traits', () => {
    expect(BOT_PROFILES).toHaveLength(10); expect(new Set(BOT_PROFILES.map(p => p.id)).size).toBe(10);
    expect(new Set(BOT_PROFILES.map(p => p.skill)).size).toBe(3);
    for (const trait of ['coop', 'bravery'] as const) expect(new Set(BOT_PROFILES.map(p => p[trait])).size).toBe(2);
  });
  it('sanitizes edits and falls back to an enabled pool without mutating defaults', () => {
    const profiles = sanitizeProfiles([{ id: 'vanguard', name: '<bad>', skill: 'low', coop: 'bad', bravery: 'low', enabled: false }]);
    expect(profiles[0]).toEqual({ ...BOT_PROFILES[0], skill: 'low', bravery: 'low', enabled: false });
    expect(sanitizeProfiles(BOT_PROFILES.map(p => ({ ...p, enabled: false }))).every(p => p.enabled)).toBe(true);
    profiles[1].skill = 'low'; expect(BOT_PROFILES[1].skill).toBe('high');
  });
  it('shuffles nine distinct assignments and only repeats when a smaller pool is exhausted', () => {
    const a = drawProfiles(BOT_PROFILES, 9, () => .2), b = drawProfiles(BOT_PROFILES, 9, () => .8);
    expect(new Set(a.map(p => p.id)).size).toBe(9); expect(a.map(p => p.id)).not.toEqual(b.map(p => p.id));
    const small = BOT_PROFILES.map((p, i) => ({ ...p, enabled: i < 2 }));
    const drawn = drawProfiles(small, 9, () => .5);
    expect(new Set(drawn.map(p => p.id))).toEqual(new Set(['vanguard', 'sentinel']));
    for (let i = 0; i < 8; i += 2) expect(drawn[i].id).not.toBe(drawn[i + 1].id);
    drawn[0].skill = 'low'; expect(small[0].skill).toBe('high');
  });
});

describe('skill and tactical personalities', () => {
  it('uses profile skill for aim/reaction/tracking, with overall difficulty scaling', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const low = botSkill(BOT_PROFILES[8], difficulty), high = botSkill(BOT_PROFILES[0], difficulty);
      expect(high.error).toBeLessThan(low.error); expect(high.reaction).toBeLessThan(low.reaction); expect(high.tracking).toBeGreaterThan(low.tracking);
    }
    expect(botSkill(BOT_PROFILES[0], 'hard').error).toBeLessThan(botSkill(BOT_PROFILES[0], 'easy').error);
  });
  it('makes timid bots seek cover earlier and lone wolves skip regrouping', () => {
    expect(botTactics(BOT_PROFILES[1]).retreatHealth).toBeGreaterThan(botTactics(BOT_PROFILES[0]).retreatHealth);
    const leader = actor(0), follower = actor(2); leader.position.set(0, 0, 5);
    expect(regroupGoal(follower, [leader, follower])).toBeDefined();
    follower.profile = { ...BOT_PROFILES[2] }; expect(regroupGoal(follower, [leader, follower])).toBeUndefined();
    follower.profile = { ...BOT_PROFILES[0] }; leader.alive = false; expect(regroupGoal(follower, [leader, follower])).toBeUndefined();
  });
  it('only cooperative bots consume and publish shared sightings', () => {
    for (const coop of ['low', 'high'] as const) {
      const bot = actor(); bot.profile!.coop = coop;
      const game = context([bot]); game.intel.blue = { point: { x: 0, z: 15 }, time: 9 };
      updateBot(bot, 1 / 60, game);
      expect(!!bot.brain.memory).toBe(coop === 'high');
      const enemy = actor(5); enemy.position.set(1, 0, 20);
      bot.brain.decision = 0; game.actors.push(enemy); game.visible = () => true; game.intel = {};
      updateBot(bot, 1 / 60, game);
      expect(bot.brain.target).toBe(enemy.id); expect(!!game.intel.blue).toBe(coop === 'high');
    }
  });
  it('uses quiet crouched approaches for timid bots but sprints aggressive rotations', () => {
    for (const bravery of ['low', 'high'] as const) {
      const bot = actor(); bot.profile!.bravery = bravery; bot.brain.decision = 100;
      bot.brain.memory = { point: { x: 1, z: 15 }, time: 9 };
      const game = context([bot]); updateBot(bot, 1 / 60, game);
      expect(bot.body.crouched).toBe(bravery === 'low'); expect(bot.sprinting).toBe(bravery === 'high');
    }
  });
});
