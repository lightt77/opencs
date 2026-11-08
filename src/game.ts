import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Actor } from './actor';
import { Sound } from './audio';
import { updateBot, type BotContext } from './bots';
import { DEFAULTS, FIXED_DT, MATCH_SECONDS, ROUND_LIMIT, ROUND_SECONDS, TDM_LIMIT, WEAPONS, isGrenade, type Settings, type Team, type WeaponId } from './config';
import { MAPS, type Arena } from './maps';
import { angleDelta, clamp, damageAtRange, distance, groundVelocity, segmentCircle, shotSpread, type Point } from './math';
import { block, disposeTree } from './models';
import { Navigation } from './navigation';
import { Physics } from './physics';
import { View } from './view';

export interface Kill { killer: string; victim: string; team: Team; weapon: WeaponId; head: boolean; time: number }
interface Grenade { body: RAPIER.RigidBody; mesh: THREE.Object3D; owner: Actor; type: 'he' | 'flash' | 'smoke'; fuse: number }
interface Smoke { point: Point; life: number }
export type Screen = 'menu' | 'playing' | 'paused' | 'finished';

export class Game {
  view: View;
  sound = new Sound();
  settings: Settings = { ...DEFAULTS };
  screen: Screen = 'menu';
  phase: 'warmup' | 'live' | 'between' = 'warmup';
  arena: Arena = MAPS.dust;
  nav = new Navigation(MAPS.dust);
  physics?: Physics;
  actors: Actor[] = [];
  get player() { return this.actors[0]; }
  time = 0;
  remaining = MATCH_SECONDS;
  phaseTime = 3;
  round = 1;
  scores = { blue: 0, red: 0 };
  kills: Kill[] = [];
  winner: Team | 'draw' = 'draw';
  announcement = '';
  announcementTime = 0;
  lastDamage = -100;
  damageDirection = 0;
  hitTime = -100;
  hitHead = false;
  fps = 60;
  scoreboard = false;
  scoped = false;
  recoilPitch = 0;
  recoilYaw = 0;
  kick = 0;
  shotFlash = 0;
  spectating = '';
  get smokeOpacity() {
    return this.smokes.reduce((opacity, smoke) => Math.max(opacity, clamp((4.2 - distance(this.view.camera.position, smoke.point)) * .8, 0, .96) * Math.min(1, smoke.life / 2)), 0);
  }
  onScreenChange?: () => void;
  onFrame?: () => void;
  private keys = new Set<string>();
  private mouseDown = false;
  private trigger = false;
  private accumulator = 0;
  private lastFrame = performance.now();
  private renderTime = 0;
  private grenades: Grenade[] = [];
  private smokes: Smoke[] = [];
  private intel: BotContext['intel'] = {};
  private ray = new THREE.Raycaster();
  private eyeY = 1.56;
  private jumpQueued = false;

  constructor(canvas: HTMLCanvasElement) {
    this.view = new View(canvas); this.view.build(this.arena);
    this.input(); requestAnimationFrame(t => this.frame(t));
  }

  preview(settings: Settings) {
    this.settings = { ...settings };
    this.sound.volume = settings.volume / 100;
    this.view.renderer.shadowMap.enabled = settings.shadows;
    if (this.arena.id !== settings.map) {
      this.arena = MAPS[settings.map]; this.view.build(this.arena);
    }
  }

  start(settings: Settings) {
    this.cleanup(); this.settings = { ...settings };
    this.arena = MAPS[settings.map]; this.nav = new Navigation(this.arena);
    this.physics = new Physics(this.arena); this.view.build(this.arena);
    this.view.renderer.shadowMap.enabled = settings.shadows;
    this.sound.volume = settings.volume / 100; this.sound.unlock();
    const names = ['YOU', 'Kestrel', 'Moss', 'Rook', 'Echo', 'Viper', 'Ash', 'Ghost', 'Flint', 'Cinder'];
    this.actors = names.map((name, id) => {
      const team = id < 5 ? 'blue' : 'red';
      const primary = id === 0 ? settings.primary : this.arena.id === 'india' ? (id % 3 === 0 ? 'm4' : 'awp') : id % 4 === 0 ? 'awp' : id % 2 === 0 ? 'm4' : 'ak';
      const actor = new Actor(id, name, team, id === 0, primary, this.physics!.character(this.arena[team][id % 5]));
      this.view.scene.add(actor.model.root); return actor;
    });
    this.time = 0; this.round = 1; this.scores = { blue: 0, red: 0 }; this.kills = [];
    this.remaining = settings.mode === 'tdm' ? MATCH_SECONDS : ROUND_SECONDS;
    this.phase = 'warmup'; this.phaseTime = 3; this.intel = {};
    this.resetActors(); this.screen = 'playing'; this.accumulator = 0;
    this.clearInput(); this.onScreenChange?.(); this.capture();
  }

  private resetActors() {
    this.clearGrenades(); this.smokes = []; this.intel = {}; this.view.clearEffects();
    for (const actor of this.actors) actor.reset(this.arena[actor.team][actor.id % 5], this.settings.mode === 'tdm' ? 1.6 : 0);
    this.physics!.world.step();
    this.scoped = false; this.recoilPitch = this.recoilYaw = this.kick = 0;
    this.eyeY = 1.56; this.lastDamage = this.hitTime = -100;
  }

  private cleanup() {
    this.clearGrenades();
    for (const actor of this.actors) { this.view.scene.remove(actor.model.root); disposeTree(actor.model.root); }
    this.actors = []; this.physics?.dispose(); this.physics = undefined;
    this.view.clearEffects(); this.smokes = []; this.intel = {};
  }

  toMenu() {
    this.screen = 'menu'; this.release(); this.cleanup(); this.clearInput(); this.onScreenChange?.();
  }

  pause() {
    if (this.screen !== 'playing') return;
    this.screen = 'paused'; this.clearInput(); this.release(); this.onScreenChange?.();
  }

  resume() {
    if (this.screen !== 'paused') return;
    this.sound.unlock(); this.screen = 'playing'; this.clearInput(); this.onScreenChange?.(); this.capture();
  }

  private capture() {
    try {
      const request = this.view.canvas.requestPointerLock();
      if (request) void request.catch(() => this.pause());
    } catch { this.pause(); }
  }

  private release() { if (document.pointerLockElement) document.exitPointerLock(); }
  private clearInput() { this.keys.clear(); this.mouseDown = this.trigger = this.jumpQueued = false; this.scoreboard = false; }

  private input() {
    window.addEventListener('keydown', event => {
      if (this.screen !== 'playing') return;
      if (['Tab', 'Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Tab') this.scoreboard = true;
      if (event.repeat || !this.player?.alive) return;
      if (event.code === 'Space') this.jumpQueued = true;
      if (event.code === 'KeyR' && this.player.startReload()) { this.scoped = false; this.sound.reload(); }
      if (event.code.startsWith('Digit')) {
        const id = this.player.weapons[Number(event.code.slice(5)) - 1];
        if (id && this.player.equip(id)) { this.scoped = false; this.sound.click(); }
      }
      if (event.code === 'Escape') this.pause();
    });
    window.addEventListener('keyup', event => { this.keys.delete(event.code); if (event.code === 'Tab') this.scoreboard = false; });
    window.addEventListener('mousemove', event => {
      if (this.screen !== 'playing' || document.pointerLockElement !== this.view.canvas || !this.player?.alive) return;
      const sensitivity = .0021 * this.settings.sensitivity * (this.scoped ? .34 : 1);
      this.player.yaw -= event.movementX * sensitivity;
      this.player.pitch = clamp(this.player.pitch - event.movementY * sensitivity, -1.45, 1.45);
    });
    window.addEventListener('mousedown', event => {
      if (this.screen !== 'playing' || document.pointerLockElement !== this.view.canvas) return;
      if (event.button === 0) { this.mouseDown = true; this.trigger = true; }
      if (event.button === 2 && this.player.alive && this.player.weapon === 'awp' && !this.player.reload) { this.scoped = !this.scoped; this.sound.click(); }
    });
    window.addEventListener('mouseup', event => { if (event.button === 0) this.mouseDown = false; });
    this.view.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', event => {
      if (this.screen !== 'playing' || !this.player?.alive) return;
      event.preventDefault();
      const weapons = this.player.weapons;
      let index = weapons.indexOf(this.player.weapon);
      index = (index + (event.deltaY > 0 ? 1 : -1) + weapons.length) % weapons.length;
      if (this.player.equip(weapons[index])) { this.scoped = false; this.sound.click(); }
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.screen === 'playing') this.pause();
    });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
  }

  private frame(now: number) {
    const dt = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
    this.fps += ((1 / Math.max(dt, .001)) - this.fps) * .04;
    this.renderTime += dt;
    if (this.screen === 'playing') {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) { this.update(FIXED_DT); this.accumulator -= FIXED_DT; }
      this.view.updateEffects(dt);
    } else this.accumulator = 0;
    this.camera(dt);
    const showWeapon = this.screen !== 'menu' && !!this.player?.alive && !this.scoped;
    this.view.render(showWeapon);
    this.onFrame?.(); requestAnimationFrame(t => this.frame(t));
  }

  private update(dt: number) {
    this.time += dt; this.announcementTime = Math.max(0, this.announcementTime - dt);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.shotFlash = Math.max(0, this.shotFlash - dt);
    this.recoilPitch *= Math.exp(-dt * 6); this.recoilYaw *= Math.exp(-dt * 7);
    for (const actor of this.actors) { actor.previousPosition.copy(actor.position); actor.tick(dt); }
    if (this.phase === 'warmup' || this.phase === 'between') {
      this.phaseTime -= dt;
      for (const actor of this.actors) if (actor.alive) actor.body.move(0, -.1, 0);
      if (this.phaseTime <= 0) {
        if (this.phase === 'between') {
          this.round++; this.resetActors(); this.remaining = ROUND_SECONDS; this.phase = 'warmup'; this.phaseTime = 3;
        } else { this.phase = 'live'; this.announce(this.settings.mode === 'tdm' ? 'WEAPONS FREE' : `ROUND ${this.round} · ELIMINATE THE ENEMY`, 2); }
      }
    } else {
      this.remaining = Math.max(0, this.remaining - dt);
      const context: BotContext = {
        time: this.time, difficulty: this.settings.difficulty, actors: this.actors, nav: this.nav, intel: this.intel,
        visible: (a, b) => this.visible(a, b), shoot: (actor, direction) => this.shoot(actor, direction),
        throwGrenade: (actor, type, target) => this.botGrenade(actor, type, target), footstep: a => this.footstep(a),
      };
      for (const actor of this.actors) {
        if (!actor.alive) {
          actor.respawn -= dt;
          if (this.settings.mode === 'tdm' && actor.respawn <= 0) actor.reset(this.safeSpawn(actor.team), 1.6);
          continue;
        }
        if (actor.human) this.updatePlayer(dt);
        else updateBot(actor, dt, context);
      }
      this.updateGrenades(dt);
      this.checkMatch();
    }
    this.physics!.world.step();
    for (const actor of this.actors) {
      if (actor.alive) actor.sync();
      actor.model.animate(dt, this.time + actor.id * .5, actor.alive && this.phase === 'live' ? actor.speed : 0, actor.alive, actor.reload > 0);
    }
    for (const smoke of this.smokes) smoke.life -= dt;
    this.smokes = this.smokes.filter(s => s.life > 0);
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    p.body.crouch(this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'));
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const dx = right * Math.cos(p.yaw) - forward * Math.sin(p.yaw);
    const dz = -right * Math.sin(p.yaw) - forward * Math.cos(p.yaw);
    const maxSpeed = WEAPONS[p.weapon].speed * (p.body.crouched ? .48 : this.scoped ? .55 : 1);
    if (p.body.grounded) {
      const v = groundVelocity(p.velocity.x, p.velocity.z, dx, dz, maxSpeed, dt);
      p.velocity.x = v.x; p.velocity.z = v.z; p.velocity.y = -.5;
      if (this.jumpQueued) { p.velocity.y = 7.2; this.jumpQueued = false; }
    } else {
      p.velocity.y = Math.max(-28, p.velocity.y - 20 * dt);
      const length = Math.hypot(dx, dz);
      if (length) {
        p.velocity.x += dx / length * dt * 3; p.velocity.z += dz / length * dt * 3;
        const speed = p.speed;
        if (speed > maxSpeed) { p.velocity.x *= maxSpeed / speed; p.velocity.z *= maxSpeed / speed; }
      }
      this.jumpQueued = false;
    }
    p.body.move(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt);
    if (p.body.grounded && p.speed > 2 && !p.body.crouched) {
      p.step += dt;
      if (p.step > .38) { p.step = 0; this.footstep(p); }
    }
    // Preserve quick clicks even when down/up both occur between fixed simulation ticks.
    if ((this.mouseDown && WEAPONS[p.weapon].automatic) || this.trigger) {
      if (isGrenade(p.weapon)) this.throwPlayerGrenade();
      else {
        const spread = shotSpread(WEAPONS[p.weapon].spread, p.speed, !p.body.grounded, p.body.crouched, p.shots, p.weapon === 'awp' && !this.scoped);
        const yaw = p.yaw + this.recoilYaw + (Math.random() - .5) * spread * 2;
        const pitch = p.pitch + this.recoilPitch + (Math.random() - .5) * spread * 2;
        this.shoot(p, new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
      }
    }
    this.trigger = false;
  }

  shoot(actor: Actor, direction: THREE.Vector3) {
    const id = actor.weapon, spec = WEAPONS[id], ammo = actor.ammo[id];
    if (!actor.alive || actor.cooldown > 0 || actor.reload > 0 || actor.switching > 0 || isGrenade(id)) return;
    if (ammo.clip <= 0) {
      if (actor.startReload() && actor.human) { this.scoped = false; this.sound.reload(); }
      return;
    }
    actor.immunity = 0;
    if (id !== 'knife') ammo.clip--;
    actor.cooldown = spec.interval; actor.shots++; actor.shotAge = 0; actor.model.flash = .06;
    if (actor.human) {
      this.kick = 1; this.shotFlash = id === 'knife' ? 0 : .05;
      this.recoilPitch = Math.min(.18, this.recoilPitch + spec.recoil * (1 + actor.shots * .06));
      this.recoilYaw += Math.sin(actor.shots * 1.7) * spec.recoil * .4;
      if (id === 'awp') this.scoped = false;
    }
    this.sound.shot(id, actor.human ? undefined : actor.position);
    this.hear(actor, id === 'knife' ? 5 : 38);
    const origin = actor.eye();
    this.ray.set(origin, direction.normalize()); this.ray.far = spec.range;
    this.view.scene.updateMatrixWorld(true);
    const targets: THREE.Object3D[] = [...this.view.solids];
    for (const target of this.actors) if (target !== actor && target.alive) targets.push(target.model.body);
    // The player's model is invisible in first person, but remains raycastable for bots.
    const hits = this.ray.intersectObjects(targets, true);
    const hit = hits[0];
    const endpoint = hit?.point ?? origin.clone().addScaledVector(direction, spec.range);
    if (id !== 'knife') {
      const muzzle = origin.clone().addScaledVector(direction, .65).add(new THREE.Vector3(0, -.13, 0));
      this.view.tracer(muzzle, endpoint);
    }
    if (!hit) return;
    const targetId = hit.object.userData.actor as number | undefined;
    const victim = targetId === undefined ? undefined : this.actors[targetId];
    const head = hit.object.userData.head === true && id !== 'knife';
    this.view.impact(hit.point, !!victim);
    if (victim && victim.team !== actor.team && victim.immunity <= 0) {
      const amount = damageAtRange(spec.damage, hit.distance, head, spec.head);
      this.damage(victim, amount, actor, id, head);
      if (actor.human) { this.hitTime = this.time; this.hitHead = head; this.sound.hit(head); }
    }
  }

  private damage(victim: Actor, amount: number, attacker: Actor, weapon: WeaponId, head = false) {
    if (!victim.alive || victim.immunity > 0) return;
    victim.health = Math.max(0, victim.health - amount);
    if (victim.human) {
      this.lastDamage = this.time;
      this.damageDirection = angleDelta(victim.yaw, Math.atan2(victim.position.x - attacker.position.x, victim.position.z - attacker.position.z));
    }
    if (victim.health > 0) return;
    victim.alive = false; victim.deaths++; victim.respawn = 3;
    victim.body.enabled(false); victim.velocity.set(0, 0, 0); victim.reload = 0;
    if (victim.team !== attacker.team) { attacker.kills++; if (this.settings.mode === 'tdm') this.scores[attacker.team]++; }
    this.kills.unshift({ killer: attacker.name, victim: victim.name, team: attacker.team, weapon, head, time: this.time });
    this.kills = this.kills.slice(0, 5);
    if (victim.human) { this.scoped = false; this.mouseDown = false; }
  }

  private throwPlayerGrenade() {
    const player = this.player, type = player.weapon;
    if (!isGrenade(type) || !player.ammo[type].clip || player.cooldown > 0 || player.switching > 0) return;
    const direction = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch) + .18, -Math.cos(player.yaw) * Math.cos(player.pitch));
    this.launchGrenade(player, type, direction.normalize().multiplyScalar(15));
    this.kick = .8; player.equip(player.primary);
  }

  private botGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', target: Point) {
    if (!actor.ammo[type].clip || actor.cooldown > 0 || actor.reload > 0) return;
    const delta = new THREE.Vector3(target.x - actor.position.x, 0, target.z - actor.position.z);
    const length = delta.length(); delta.normalize().multiplyScalar(Math.min(16, length * .7)); delta.y = clamp(length * .32, 3, 8);
    this.launchGrenade(actor, type, delta); actor.cooldown = .6;
  }

  private launchGrenade(owner: Actor, type: 'he' | 'flash' | 'smoke', velocity: THREE.Vector3) {
    owner.ammo[type].clip--; owner.immunity = 0;
    // Start at the eye, rather than ahead of a wall where a throw could clip through geometry.
    const origin = owner.eye();
    const mesh = block(new THREE.Group(), [.15, .2, .15], [0, 0, 0], new THREE.MeshStandardMaterial({ color: type === 'he' ? 0x697348 : type === 'smoke' ? 0xa5b1ae : 0xd4d0b5 }));
    this.view.scene.add(mesh);
    this.grenades.push({ body: this.physics!.grenade(origin, velocity), mesh, owner, type, fuse: type === 'flash' ? 1.45 : 1.8 });
    this.sound.click();
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const grenade = this.grenades[i]; grenade.fuse -= dt;
      const p = grenade.body.translation(); grenade.mesh.position.set(p.x, p.y, p.z);
      const q = grenade.body.rotation(); grenade.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (grenade.fuse > 0) continue;
      const position = new THREE.Vector3(p.x, Math.max(.1, p.y), p.z);
      if (grenade.type === 'he') {
        this.view.explosion(position); this.sound.explosion(position);
        for (const actor of this.actors) {
          if (!actor.alive || (actor.team === grenade.owner.team && actor !== grenade.owner)) continue;
          const d = actor.eye().distanceTo(position);
          if (d < 8 && this.nav.clear(position, actor.position, .7)) this.damage(actor, Math.round(100 * (1 - d / 8)), grenade.owner, 'he');
        }
      } else if (grenade.type === 'flash') {
        this.view.explosion(position); this.sound.flash(position);
        for (const actor of this.actors) {
          const d = actor.eye().distanceTo(position);
          if (!actor.alive || d > 21 || !this.nav.clear(position, actor.position)) continue;
          const angle = Math.atan2(actor.position.x - position.x, actor.position.z - position.z);
          const facing = Math.abs(angleDelta(actor.yaw, angle)) < 1.6;
          actor.flash = Math.max(actor.flash, (1 - d / 24) * (facing ? 4 : 1.2));
        }
      } else {
        position.y = .1; this.view.smoke(position); this.smokes.push({ point: position, life: 12 });
      }
      this.physics!.world.removeRigidBody(grenade.body); this.view.scene.remove(grenade.mesh); disposeTree(grenade.mesh); this.grenades.splice(i, 1);
    }
  }

  private clearGrenades() {
    for (const g of this.grenades) {
      this.physics?.world.removeRigidBody(g.body); this.view.scene.remove(g.mesh); disposeTree(g.mesh);
    }
    this.grenades = [];
  }

  visible(a: Point, b: Point) {
    return this.nav.clear(a, b) && !this.smokes.some(smoke => segmentCircle(a, b, smoke.point, 4.2));
  }

  private hear(actor: Actor, radius: number) {
    for (const bot of this.actors) {
      if (bot.human || !bot.alive || bot.team === actor.team || distance(bot.position, actor.position) > radius) continue;
      // Hearing supplies an approximate location, not a target or permission to fire through walls.
      bot.brain.memory = { point: { x: actor.position.x + (Math.random() - .5) * 3, z: actor.position.z + (Math.random() - .5) * 3 }, time: this.time };
      if (bot.brain.target < 0) bot.brain.repath = Math.min(bot.brain.repath, .3);
    }
  }

  private footstep(actor: Actor) {
    this.sound.step(actor.human ? undefined : actor.position, this.arena.id === 'snow'); this.hear(actor, 13);
  }

  private safeSpawn(team: Team): Point {
    const enemies = this.actors.filter(a => a.alive && a.team !== team);
    const candidates = [...this.arena[team], ...this.arena.routes];
    let best = candidates[0], bestScore = -Infinity;
    for (const point of candidates) {
      const score = Math.min(...enemies.map(e => distance(e.position, point) - (this.nav.clear(e.position, point) ? 35 : 0)), 100) - Math.random() * 3;
      if (score > bestScore) { bestScore = score; best = point; }
    }
    return best;
  }

  private checkMatch() {
    if (this.settings.mode === 'tdm') {
      if (this.scores.blue >= TDM_LIMIT || this.scores.red >= TDM_LIMIT || this.remaining <= 0) this.finish(this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red');
    } else {
      const blue = this.actors.filter(a => a.team === 'blue' && a.alive);
      const red = this.actors.filter(a => a.team === 'red' && a.alive);
      if (blue.length && red.length && this.remaining > 0) return;
      let winner: Team | 'draw' = blue.length === red.length ? 'draw' : blue.length > red.length ? 'blue' : 'red';
      if (this.remaining <= 0 && blue.length === red.length) {
        const bh = blue.reduce((n, a) => n + a.health, 0), rh = red.reduce((n, a) => n + a.health, 0);
        winner = bh === rh ? 'draw' : bh > rh ? 'blue' : 'red';
      }
      if (winner !== 'draw') this.scores[winner]++;
      if (this.scores.blue >= ROUND_LIMIT || this.scores.red >= ROUND_LIMIT || this.round >= 15) {
        this.finish(this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red'); return;
      }
      this.phase = 'between'; this.phaseTime = 4;
      this.announce(winner === 'draw' ? 'ROUND DRAW' : `${winner.toUpperCase()} TEAM TAKES THE ROUND`, 4);
    }
  }

  private finish(winner: Team | 'draw') {
    this.winner = winner; this.screen = 'finished'; this.clearInput(); this.release(); this.onScreenChange?.();
  }

  private announce(text: string, duration: number) { this.announcement = text; this.announcementTime = duration; }

  private camera(dt: number) {
    const camera = this.view.camera;
    if (this.screen === 'menu' || !this.player) {
      const angle = this.renderTime * .025;
      camera.position.set(24 * Math.cos(angle), 18, 27 * Math.sin(angle) + 9); camera.lookAt(0, 0, -3);
      camera.fov = 65; camera.updateProjectionMatrix(); return;
    }
    const p = this.player;
    for (const actor of this.actors) actor.model.root.visible = !actor.human;
    if (p.alive) {
      this.spectating = '';
      const alpha = clamp(this.accumulator / FIXED_DT, 0, 1);
      const position = p.previousPosition.clone().lerp(p.position, this.screen === 'playing' ? alpha : 1);
      this.eyeY += (p.eyeHeight - this.eyeY) * Math.min(1, dt * 16);
      const bob = Math.sin(this.time * 14) * .013 * Math.min(p.speed / 5, 1) * (p.body.grounded ? 1 : 0);
      camera.position.copy(position).add(new THREE.Vector3(0, this.eyeY + bob, 0));
      camera.rotation.set(clamp(p.pitch + this.recoilPitch, -1.5, 1.5), p.yaw + this.recoilYaw, 0, 'YXZ');
      this.sound.listen(p.position.x, p.position.z, p.yaw);
    } else {
      const ally = this.actors.find(a => a.team === 'blue' && a.alive);
      if (ally) {
        this.spectating = ally.name;
        ally.model.root.visible = false;
        const pos = ally.eye(); camera.position.copy(pos);
        camera.rotation.set(ally.pitch, ally.yaw, 0, 'YXZ');
        this.sound.listen(ally.position.x, ally.position.z, ally.yaw);
      } else {
        this.spectating = '';
      }
    }
    const fov = this.scoped && p.alive ? 24 : this.settings.fov;
    if (Math.abs(camera.fov - fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    this.view.equip(p.weapon);
    const reload = p.reload > 0 ? 1 - p.reload / WEAPONS[p.weapon].reload : 0;
    this.view.animateWeapon(this.time, p.speed, this.kick, reload, p.switching / .25, this.shotFlash > 0, p.weapon === 'knife', p.body.crouched);
  }
}
