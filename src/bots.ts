import * as THREE from 'three';
import type { Actor } from './actor';
import { BOT_SKILL, WEAPONS, type Difficulty, type Team } from './config';
import { angleDelta, clamp, distance, type Point } from './math';
import type { Navigation } from './navigation';

interface Contact { point: Point; time: number }
export interface BotContext {
  time: number; difficulty: Difficulty; actors: Actor[]; nav: Navigation;
  intel: Partial<Record<Team, Contact>>;
  visible(a: Point, b: Point): boolean;
  shoot(actor: Actor, direction: THREE.Vector3): void;
  throwGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', target: Point): void;
  footstep(actor: Actor): void;
}

export function updateBot(actor: Actor, dt: number, game: BotContext) {
  const brain = actor.brain, skill = BOT_SKILL[game.difficulty];
  brain.decision -= dt; brain.repath -= dt; brain.pause -= dt;
  if (brain.decision <= 0) {
    brain.decision = .13 + Math.random() * .06;
    let target: Actor | undefined, best = Infinity;
    for (const enemy of game.actors) {
      if (enemy.team === actor.team || !enemy.alive || enemy.immunity > 0) continue;
      const d = distance(actor.position, enemy.position);
      const angle = Math.atan2(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z);
      const inView = d < 5 || Math.abs(angleDelta(actor.yaw, angle)) < 1.25;
      if (d > 52 || !inView || actor.flash > .3 || !game.visible(actor.position, enemy.position)) continue;
      const score = d - (enemy.id === brain.target ? 5 : 0);
      if (score < best) { best = score; target = enemy; }
    }
    if (target) {
      if (brain.target !== target.id) {
        brain.acquired = game.time; brain.burst = 0;
        brain.aimHeight = game.difficulty === 'hard' && Math.random() < .24 ? 1.56 : 1.13;
      }
      brain.target = target.id;
      brain.memory = { point: { x: target.position.x, z: target.position.z }, time: game.time };
      game.intel[actor.team] = { point: { ...brain.memory.point }, time: game.time };
    } else {
      brain.target = -1;
      const intel = game.intel[actor.team];
      if (intel && game.time - intel.time < 6 && (!brain.memory || intel.time > brain.memory.time)) brain.memory = { point: { ...intel.point }, time: intel.time };
    }
  }

  const target = game.actors.find(a => a.id === brain.target && a.alive);
  const targetVisible = target && actor.flash < .3 && game.visible(actor.position, target.position);
  const ammo = actor.ammo[actor.weapon];
  if (ammo.clip === 0 || (!targetVisible && ammo.clip < WEAPONS[actor.weapon].magazine * .55)) {
    if (!actor.startReload() && ammo.clip === 0 && ammo.reserve === 0) actor.equip(actor.weapon === 'pistol' ? 'knife' : 'pistol');
  }

  let moveX = 0, moveZ = 0;
  if (targetVisible) {
    const delta = target.eye().sub(actor.eye());
    const d = delta.length();
    const desiredYaw = Math.atan2(-delta.x, -delta.z);
    actor.yaw += angleDelta(actor.yaw, desiredYaw) * Math.min(1, dt * skill.tracking);
    const desiredPitch = Math.atan2(brain.aimHeight - actor.eyeHeight + target.position.y - actor.position.y, Math.hypot(delta.x, delta.z));
    actor.pitch += (desiredPitch - actor.pitch) * Math.min(1, dt * skill.tracking);

    if (game.time - brain.acquired > skill.reaction && Math.abs(angleDelta(actor.yaw, desiredYaw)) < .13 && brain.pause <= 0 && actor.reload <= 0) {
      const error = skill.error * (actor.weapon === 'awp' ? .5 : 1) * (1 + actor.speed * .11);
      const yaw = actor.yaw + (Math.random() - .5) * error * 2;
      const pitch = actor.pitch + (Math.random() - .5) * error * 2;
      const ready = actor.cooldown <= 0 && actor.switching <= 0;
      game.shoot(actor, new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
      if (ready) {
        brain.burst++;
        if (brain.burst >= skill.burst) { brain.burst = 0; brain.pause = .22 + Math.random() * .4; }
      }
    }

    // Fire from a planted stance, then take a short lateral step between bursts.
    if (brain.pause > 0 && actor.weapon !== 'awp') {
      const side = Math.sin(game.time * .7 + actor.id) > 0 ? 1 : -1;
      moveX = Math.cos(actor.yaw) * side; moveZ = -Math.sin(actor.yaw) * side;
    }
    if (actor.weapon === 'knife') {
      moveX = d > 1.5 ? delta.x / d : 0; moveZ = d > 1.5 ? delta.z / d : 0;
    } else if (d < 5) { moveX += Math.sin(actor.yaw); moveZ += Math.cos(actor.yaw); }
    if (actor.health < 35 && brain.repath <= 0) {
      const cover = findCover(actor.position, target.position, game.nav);
      if (cover) { brain.path = game.nav.path(actor.position, cover); brain.goal = cover; brain.repath = 2; }
    }
    if (brain.decision > .12 && d > 11 && d < 29 && game.time - brain.acquired > .8 && Math.random() < .025) {
      if (actor.ammo.he.clip) game.throwGrenade(actor, 'he', target.position);
      else if (actor.ammo.flash.clip) game.throwGrenade(actor, 'flash', target.position);
    }
    if (actor.health < 30 && actor.ammo.smoke.clip && Math.random() < dt * .2) game.throwGrenade(actor, 'smoke', actor.position);
  }

  const holdingAngle = !targetVisible && actor.reload <= 0 && brain.hold > game.time;
  if (holdingAngle) {
    const point = brain.memory?.point ?? { x: 0, z: actor.team === 'blue' ? -28 : 28 };
    const yaw = Math.atan2(actor.position.x - point.x, actor.position.z - point.z) + Math.sin(game.time * 1.4) * .3;
    actor.yaw += angleDelta(actor.yaw, yaw) * Math.min(1, dt * 5);
  }
  if ((!targetVisible || actor.reload > 0 || (actor.health < 35 && brain.path.length)) && !holdingAngle) {
    if (brain.repath <= 0 || (!brain.path.length && !targetVisible)) {
      const memory = brain.memory && game.time - brain.memory.time < 7 ? brain.memory.point : undefined;
      const routes = game.nav.arena.routes;
      let goal: Point;
      if (memory && distance(actor.position, memory) > 3) {
        goal = { ...memory };
        if (brain.role === 'flank' && distance(actor.position, memory) > 12) goal.x = clamp(goal.x + (actor.id % 2 ? 8 : -8), -25, 25);
      } else {
        // Routes and enemy spawn are map knowledge, not knowledge of unseen enemies.
        const options = [...routes, ...game.nav.arena[actor.team === 'blue' ? 'red' : 'blue']].filter(p => distance(actor.position, p) > 3);
        goal = options[(actor.id * 3 + Math.floor(game.time / 8) + Math.floor(Math.random() * 3)) % options.length];
      }
      if (actor.reload > 0 && brain.memory) goal = findCover(actor.position, brain.memory.point, game.nav) ?? goal;
      brain.goal = goal; brain.path = game.nav.path(actor.position, goal); brain.repath = 1.5 + Math.random();
    }
    const followingPath = brain.path.length > 0;
    while (brain.path.length && distance(actor.position, brain.path[0]) < .65) brain.path.shift();
    if (followingPath && !brain.path.length && brain.role === 'hold') brain.hold = game.time + 2.5;
    const waypoint = brain.path[0];
    if (waypoint) {
      const dx = waypoint.x - actor.position.x, dz = waypoint.z - actor.position.z;
      const len = Math.hypot(dx, dz); moveX = dx / len; moveZ = dz / len;
      if (!targetVisible) {
        const yaw = Math.atan2(-dx, -dz);
        actor.yaw += angleDelta(actor.yaw, yaw) * Math.min(1, dt * 7);
        actor.pitch *= Math.max(0, 1 - dt * 5);
      }
    }
  }

  // Local avoidance helps teammates spread out instead of forming a single-file train.
  for (const ally of game.actors) {
    if (ally === actor || !ally.alive) continue;
    const d = distance(actor.position, ally.position);
    if (d > .01 && d < 1.1) { moveX += (actor.position.x - ally.position.x) / d * (1.1 - d) * 1.5; moveZ += (actor.position.z - ally.position.z) / d * (1.1 - d) * 1.5; }
  }
  const length = Math.hypot(moveX, moveZ);
  const speed = (targetVisible ? 2.1 : WEAPONS[actor.weapon].speed * .8) * (actor.flash > .3 ? .35 : 1);
  actor.velocity.x = length > 0 ? moveX / Math.max(1, length) * speed : 0;
  actor.velocity.z = length > 0 ? moveZ / Math.max(1, length) * speed : 0;
  actor.velocity.y = actor.body.grounded ? -.5 : Math.max(-25, actor.velocity.y - 20 * dt);
  actor.body.move(actor.velocity.x * dt, actor.velocity.y * dt, actor.velocity.z * dt);
  if (actor.speed > 1) {
    actor.step += dt;
    if (actor.step > .43) { actor.step = 0; game.footstep(actor); }
  }
  if (distance(actor.position, brain.previous) < .015 && length > .3) brain.stuck += dt;
  else brain.stuck = 0;
  if (brain.stuck > .6) { brain.repath = 0; brain.path = []; brain.stuck = 0; }
  brain.previous = { x: actor.position.x, z: actor.position.z };
}

export function findCover(from: Point, threat: Point, nav: Navigation): Point | undefined {
  let best: Point | undefined, score = Infinity;
  for (const b of nav.walls) {
    if (b.h < 1.5 || distance(from, b) > 16) continue;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = { x: b.x + sx * (b.w / 2 + 1), z: b.z + sz * (b.d / 2 + 1) };
      if (nav.clear(threat, p) || !nav.clear(p, p, .7, .5)) continue;
      const d = distance(from, p);
      if (d < score) { score = d; best = p; }
    }
  }
  return best;
}
