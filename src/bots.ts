import * as THREE from 'three';
import type { Actor } from './actor';
import { BOT_SKILL, WEAPONS, isGrenade, type Difficulty, type Team } from './config';
import { angleDelta, clamp, distance, type Point } from './math';
import type { Navigation } from './navigation';
import { movementScale } from './movement';
import { coverHits } from './ballistics';

interface Contact { point: Point; time: number }
export interface BotContext {
  time: number; difficulty: Difficulty; actors: Actor[]; nav: Navigation;
  intel: Partial<Record<Team, Contact>>;
  movementSpeed: number; jumpGravity: number;
  visible(a: Point, b: Point): boolean;
  shoot(actor: Actor, direction: THREE.Vector3): void;
  throwGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', target: Point): void;
}

export function updateBot(actor: Actor, dt: number, game: BotContext) {
  const brain = actor.brain, skill = BOT_SKILL[game.difficulty];
  actor.sprinting = false;
  brain.decision -= dt; brain.repath -= dt; brain.pause -= dt;
  if (brain.decision <= 0) {
    brain.decision = .13 + Math.random() * .06;
    let target: Actor | undefined, best = Infinity;
    for (const enemy of game.actors) {
      if (enemy.team === actor.team || !enemy.alive || enemy.immunity > 0) continue;
      const d = distance(actor.position, enemy.position);
      const angle = Math.atan2(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z);
      const inView = d < 5 || Math.abs(angleDelta(actor.yaw, angle)) < 1.25;
      const sight = actor.weapon === 'awp' ? (game.nav.arena.sniperSight ?? 52) : 52;
      if (d > sight || !inView || actor.flash > .3 || !game.visible(actor.eye(), enemy.eye())) continue;
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
  const targetVisible = target && actor.flash < .3 && game.visible(actor.eye(), target.eye());
  const armed = actor.weapons.find(id => !isGrenade(id) && (id === 'knife' || actor.ammo[id].clip > 0 || actor.ammo[id].reserve > 0));
  if (armed && isGrenade(actor.weapon)) actor.equip(armed);
  const ammo = actor.ammo[actor.weapon];
  if (ammo.clip === 0 || (!targetVisible && ammo.clip < WEAPONS[actor.weapon].magazine * .55)) {
    if (!actor.startReload() && ammo.clip === 0 && ammo.reserve === 0) {
      const fallback = actor.weapons.find(id => id !== actor.weapon && (id === 'knife' || actor.ammo[id].clip > 0 || actor.ammo[id].reserve > 0));
      if (fallback) actor.equip(fallback);
    }
  }

  let moveX = 0, moveZ = 0;
  const danger = targetVisible ? target.position : brain.memory?.point;
  if (danger && (actor.health < 40 || actor.reload > 0) && brain.coverUntil <= game.time && brain.repath <= 0) {
    const cover = findCover(actor.position, danger, game.nav);
    if (cover) {
      brain.path = game.nav.path(actor.position, cover); brain.goal = cover;
      brain.coverUntil = game.time + 4; brain.repath = 2; brain.climb = undefined;
    }
  }
  const retreating = brain.coverUntil > game.time;
  const cautious = !targetVisible && !!brain.memory && game.time - brain.memory.time < 5 && distance(actor.position, brain.memory.point) < 14;
  actor.body.crouch(!brain.climb && !retreating && (cautious || (!!targetVisible && distance(actor.position, target.position) > 12 && actor.reload <= 0)) || (retreating && brain.path.length === 0));
  if (targetVisible) {
    const delta = target.eye().sub(actor.eye());
    const d = delta.length();
    const desiredYaw = Math.atan2(-delta.x, -delta.z);
    actor.yaw += angleDelta(actor.yaw, desiredYaw) * Math.min(1, dt * skill.tracking);
    const targetHeight = brain.aimHeight * (target.body.crouched ? .67 : 1);
    const desiredPitch = Math.atan2(targetHeight - actor.eyeHeight + target.position.y - actor.position.y, Math.hypot(delta.x, delta.z));
    actor.pitch += (desiredPitch - actor.pitch) * Math.min(1, dt * skill.tracking);

    if (game.time - brain.acquired > skill.reaction && Math.abs(angleDelta(actor.yaw, desiredYaw)) < .13 && brain.pause <= 0 && actor.reload <= 0) {
      const sniperScale = actor.weapon === 'awp' ? .5 * Math.min(1, 40 / Math.max(1, d)) : 1;
      const error = skill.error * sniperScale * (actor.body.crouched ? .75 : 1) * (1 + actor.speed * .11);
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
    if (actor.weapon === 'awp' && brain.role === 'flank' && game.nav.arena.id === 'longshot' && actor.cooldown > .45) {
      const side = actor.id % 2 ? 1 : -1;
      moveX = Math.cos(actor.yaw) * side; moveZ = -Math.sin(actor.yaw) * side;
    }
    if (actor.weapon === 'knife') {
      moveX = d > 1.5 ? delta.x / d : 0; moveZ = d > 1.5 ? delta.z / d : 0;
    } else if (isGrenade(actor.weapon)) {
      if (d > 15) { moveX = delta.x / d; moveZ = delta.z / d; }
      else if (d < 7) { moveX = -delta.x / d; moveZ = -delta.z / d; }
      const grenade = actor.weapons.find(id => isGrenade(id) && actor.ammo[id].clip > 0);
      if (grenade && isGrenade(grenade) && d < 30 && game.time - brain.acquired > skill.reaction) game.throwGrenade(actor, grenade, target.position);
    } else if (d < 5) { moveX += Math.sin(actor.yaw); moveZ += Math.cos(actor.yaw); }
    if (brain.decision > .12 && d > 11 && d < 29 && game.time - brain.acquired > .8 && Math.random() < .025) {
      if (actor.ammo.he.clip) game.throwGrenade(actor, 'he', target.position);
      else if (actor.ammo.flash.clip) game.throwGrenade(actor, 'flash', target.position);
    }
    if (actor.health < 30 && actor.ammo.smoke.clip && Math.random() < dt * .2) game.throwGrenade(actor, 'smoke', actor.position);
  }

  const holdingAngle = !targetVisible && actor.reload <= 0 && (brain.hold > game.time || (retreating && brain.path.length === 0));
  if (holdingAngle) {
    const point = brain.memory?.point ?? game.nav.arena[actor.team === 'blue' ? 'red' : 'blue'][0];
    const yaw = Math.atan2(actor.position.x - point.x, actor.position.z - point.z) + Math.sin(game.time * 1.4) * .3;
    actor.yaw += angleDelta(actor.yaw, yaw) * Math.min(1, dt * 5);
  }
  if ((!targetVisible || actor.reload > 0 || retreating) && !holdingAngle) {
    if (!retreating && (brain.repath <= 0 || (!brain.path.length && !targetVisible))) {
      const memory = brain.memory && game.time - brain.memory.time < 7 ? brain.memory.point : undefined;
      const routes = game.nav.arena.routes;
      let goal: Point;
      if (memory && distance(actor.position, memory) > 3) {
        goal = { ...memory };
        if (brain.role === 'flank' && distance(actor.position, memory) > 12) {
          const edge = game.nav.arena.width / 2 - 4;
          goal.x = clamp(goal.x + (actor.id % 2 ? 8 : -8), -edge, edge);
        }
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

  // Local, collision-driven jumps onto low crates, not teleports onto buildings.
  if (!retreating && !targetVisible && !cautious && !brain.climb && actor.body.grounded && brain.nextClimb <= game.time && brain.role !== 'push') {
    brain.nextClimb = game.time + 5 + Math.random() * 4;
    const perch = findPerch(actor.position, game.nav);
    if (perch) {
      brain.climb = { ...perch, until: game.time + 6, jumping: false };
      brain.path = game.nav.path(actor.position, perch.approach);
    }
  }
  const climb = brain.climb;
  if (climb) {
    if (game.time > climb.until || retreating || actor.flash > .3) { brain.climb = undefined; brain.repath = 0; }
    else {
      actor.body.crouch(false);
      let destination = climb.jumping ? climb.top : climb.approach;
      if (!climb.jumping && distance(actor.position, climb.approach) < .65 && actor.body.grounded) {
        climb.jumping = true; actor.velocity.y = Math.sqrt(2 * game.jumpGravity * Math.max(.15, climb.height - actor.position.y + .32));
        destination = climb.top;
      }
      const d = distance(actor.position, destination);
      moveX = d > .2 ? (destination.x - actor.position.x) / d : 0;
      moveZ = d > .2 ? (destination.z - actor.position.z) / d : 0;
      if (climb.jumping && actor.body.grounded && actor.position.y > climb.height - .15) {
        moveX = moveZ = 0; brain.hold = game.time + 1;
      }
    }
  }
  if (retreating && !brain.path.length) moveX = moveZ = 0;

  // Local avoidance helps teammates spread out instead of forming a single-file train.
  for (const ally of game.actors) {
    if (ally === actor || !ally.alive) continue;
    const d = distance(actor.position, ally.position);
    if (d > .01 && d < 1.1) { moveX += (actor.position.x - ally.position.x) / d * (1.1 - d) * 1.5; moveZ += (actor.position.z - ally.position.z) / d * (1.1 - d) * 1.5; }
  }
  const length = Math.hypot(moveX, moveZ);
  actor.sprinting = !actor.body.crouched && !brain.climb && actor.flash <= .3 && length > .3 && (retreating || (!targetVisible && !cautious && !holdingAngle));
  const speed = (brain.climb ? 3.5 : targetVisible && !retreating ? 2.1 : WEAPONS[actor.weapon].speed * .8) * game.movementSpeed * movementScale(actor.body.crouched, false, actor.sprinting) * (actor.flash > .3 ? .35 : 1);
  actor.velocity.x = length > 0 ? moveX / Math.max(1, length) * speed : 0;
  actor.velocity.z = length > 0 ? moveZ / Math.max(1, length) * speed : 0;
  actor.velocity.y = actor.body.grounded && actor.velocity.y <= 0 ? -.5 : Math.max(-35, actor.velocity.y - game.jumpGravity * dt);
  actor.body.move(actor.velocity.x * dt, actor.velocity.y * dt, actor.velocity.z * dt);
  if (distance(actor.position, brain.previous) < .015 && length > .3) brain.stuck += dt;
  else brain.stuck = 0;
  if (brain.stuck > .6) { brain.repath = 0; brain.path = []; brain.stuck = 0; }
  brain.previous = { x: actor.position.x, z: actor.position.z };
}

export function findCover(from: Point, threat: Point, nav: Navigation): Point | undefined {
  const candidates: Array<{ point: Point; score: number }> = [];
  for (const b of nav.walls) {
    if (b.h < 1 || distance(from, b) > 16) continue;
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const p = { x: b.x + sx * (b.w / 2 + .8), z: b.z + sz * (b.d / 2 + .8) };
      if (nav.clear(threat, p, .95) || !nav.clear(p, p, .7, .5)) continue;
      candidates.push({ point: p, score: distance(from, p) });
    }
  }
  for (const { point } of candidates.sort((a, b) => a.score - b.score)) {
    const path = nav.path(from, point);
    // Reject pockets that the navigation grid cannot actually reach.
    if (path.length && distance(path[path.length - 1], point) < Math.max(1.2, nav.cell * .8)) return point;
  }
  return undefined;
}

export function findPerch(from: Point, nav: Navigation) {
  for (const box of [...nav.arena.boxes].sort((a, b) => distance(from, a) - distance(from, b))) {
    const height = box.y + box.h / 2;
    if (box.kind !== 'crate' || height > 1.35 || height < .4 || distance(from, box) > 9 || box.w < 1 || box.d < 1) continue;
    const top = { x: box.x, z: box.z };
    const overhead = nav.arena.boxes.some(b => b !== box && Math.abs(b.x - box.x) < b.w / 2 + .4 && Math.abs(b.z - box.z) < b.d / 2 + .4 && b.y - b.h / 2 < height + 1.8 && b.y + b.h / 2 > height);
    if (overhead) continue;
    const approaches = [{ x: box.x - box.w / 2 - .85, z: box.z }, { x: box.x + box.w / 2 + .85, z: box.z }, { x: box.x, z: box.z - box.d / 2 - .85 }, { x: box.x, z: box.z + box.d / 2 + .85 }].sort((a, b) => distance(from, a) - distance(from, b));
    for (const approach of approaches) {
      if (!nav.clear(approach, approach, .7, .5) || !nav.clear(from, approach, .7, .45)) continue;
      const origin = new THREE.Vector3(approach.x, height + .1, approach.z), direction = new THREE.Vector3(top.x - approach.x, 0, top.z - approach.z);
      const length = direction.length();
      if (!coverHits(origin, direction.normalize(), nav.arena.boxes, length).length) return { approach, top, height };
    }
  }
}
