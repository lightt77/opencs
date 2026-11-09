import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Actor } from './actor';
import { Sound } from './audio';
import { updateBot, type BotContext } from './bots';
import { DEFAULTS, FIXED_DT, MATCH_SECONDS, PRIMARIES, ROUND_LIMIT, ROUND_SECONDS, TDM_LIMIT, WEAPONS, isGrenade, sanitizeWeapons, type Primary, type Settings, type Team, type WeaponId } from './config';
import { MAPS, type Arena } from './maps';
import { angleDelta, clamp, damageAtRange, distance, groundVelocity, segmentCircle, shotSpread, type Point } from './math';
import { block, disposeTree } from './models';
import { Navigation } from './navigation';
import { Physics } from './physics';
import { View } from './view';
import { airVelocity, footstepStride, movementScale, scopeFov, verticalMotion } from './movement';
import { coverHits, penetration } from './ballistics';
import { chooseSpawn, spawnCandidates } from './spawns';
import { grenadeThrow } from './grenades';
import { Radio } from './radio';
import { drawProfiles, sanitizeProfiles } from './bot-profiles';

export interface Kill { killer: string; victim: string; team: Team; weapon: WeaponId; head: boolean; time: number }
interface Grenade { body: RAPIER.RigidBody; mesh: THREE.Object3D; owner: Actor; type: 'he' | 'flash' | 'smoke'; fuse: number }
interface Smoke { point: Point; life: number }
export interface DamagePopup { id: number; amount: number; head: boolean; killed: boolean; point: THREE.Vector3; time: number }
export type Screen = 'menu' | 'playing' | 'paused' | 'loadout' | 'finished';

export class Game {
  view: View;
  sound = new Sound();
  radio = new Radio((clip, priority) => this.sound.radio(clip, priority));
  private radioCheck = 0;
  private reportedCounts = new Set<number>();
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
  damagePopups: DamagePopup[] = [];
  private nextDamageId = 0;
  winner: Team | 'draw' = 'draw';
  announcement = '';
  announcementTime = 0;
  lastDamage = -100;
  damageDirection = 0;
  hitTime = -100;
  hitHead = false;
  fps = 60;
  scoreboard = false;
  scopeLevel = 0;
  get scoped() { return this.scopeLevel > 0; }
  set scoped(value: boolean) { this.scopeLevel = value ? 1 : 0; }
  deathCamera?: { killer: number; time: number; origin: THREE.Vector3; rotation: THREE.Quaternion; fov: number };
  private pendingFinish?: Team | 'draw';
  private spawnPools = { blue: [] as Point[], red: [] as Point[] };
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
  private grenadePrime?: { type: 'he' | 'flash' | 'smoke'; start: number };
  private grenadeRelease?: { type: 'he' | 'flash' | 'smoke'; held: number };
  get grenadeCharge() { return this.grenadePrime ? grenadeThrow(this.time - this.grenadePrime.start).charge : undefined; }

  constructor(canvas: HTMLCanvasElement) {
    this.view = new View(canvas); this.view.build(this.arena);
    this.input(); requestAnimationFrame(t => this.frame(t));
  }

  preview(settings: Settings) {
    this.settings = { ...settings };
    this.configureAudio(settings);
    this.view.renderer.shadowMap.enabled = settings.shadows;
    if (this.arena.id !== settings.map) {
      this.arena = MAPS[settings.map]; this.view.build(this.arena);
    }
  }

  configureAudio(settings: Settings) {
    this.sound.volume = settings.volume / 100; this.sound.pack = settings.soundPack;
    this.sound.effectsPack = settings.effectsPack; this.sound.radioVolume = settings.radioVolume / 100;
    this.sound.radioEnabled = settings.radioChatter;
    this.radio.enabled = settings.radioChatter && settings.radioVolume > 0;
    if (!this.radio.enabled) { this.sound.stopRadio(); this.radio.message = undefined; }
  }

  start(settings: Settings) {
    this.cleanup(); this.settings = { ...settings };
    this.settings.allowedWeapons = sanitizeWeapons(settings.allowedWeapons);
    this.settings.botProfiles = sanitizeProfiles(settings.botProfiles);
    this.arena = MAPS[settings.map]; this.nav = new Navigation(this.arena);
    this.physics = new Physics(this.arena); this.view.build(this.arena);
    this.spawnPools = { blue: spawnCandidates(this.nav, 'blue', false), red: spawnCandidates(this.nav, 'red', false) };
    this.view.renderer.shadowMap.enabled = settings.shadows;
    this.configureAudio(settings); void this.sound.unlock();
    const names = ['YOU', 'Kestrel', 'Moss', 'Rook', 'Echo', 'Viper', 'Ash', 'Ghost', 'Flint', 'Cinder'];
    this.actors = names.map((name, id) => {
      const team = id < 5 ? 'blue' : 'red';
      const primary = id === 0 ? settings.primary : this.arena.id === 'longshot' ? 'awp' : this.arena.id === 'india' ? (id % 3 === 0 ? 'm4' : 'awp') : id % 4 === 0 ? 'awp' : id % 2 === 0 ? 'm4' : 'ak';
      const actor = new Actor(id, name, team, id === 0, primary, this.physics!.character(this.arena[team][id % 5]));
      this.view.scene.add(actor.model.root); return actor;
    });
    this.time = 0; this.round = 1; this.scores = { blue: 0, red: 0 }; this.kills = [];
    this.remaining = settings.mode === 'tdm' ? MATCH_SECONDS : ROUND_SECONDS;
    this.phase = 'warmup'; this.phaseTime = settings.freezeTime; this.intel = {}; this.pendingFinish = undefined;
    this.resetActors(); this.screen = 'playing'; this.accumulator = 0;
    this.clearInput(); this.onScreenChange?.(); this.capture();
  }

  private resetActors() {
    this.clearGrenades(); this.smokes = []; this.intel = {}; this.view.clearEffects();
    this.radio.reset(); this.sound.stopRadio(); this.reportedCounts.clear(); this.radioCheck = 0;
    const assigned: Array<{ point: Point; team: Team }> = [];
    const pools = { blue: spawnCandidates(this.nav, 'blue', true), red: spawnCandidates(this.nav, 'red', true) };
    const profiles = drawProfiles(this.settings.botProfiles, this.actors.filter(a => !a.human).length);
    for (const actor of this.actors.filter(a => !a.human)) {
      actor.profile = profiles.shift()!;
      actor.brain.role = actor.profile.bravery === 'low' ? (actor.profile.coop === 'high' ? 'hold' : 'flank') : 'push';
    }
    // Alternate teams so both spawn plans account for opposing positions.
    for (const actor of [0, 5, 1, 6, 2, 7, 3, 8, 4, 9].map(id => this.actors[id])) {
      if (!this.settings.allowedWeapons.includes(actor.primary)) actor.primary = PRIMARIES.find(id => this.settings.allowedWeapons.includes(id)) ?? actor.primary;
      actor.configureLoadout(this.settings.allowedWeapons, this.settings.grenadeCapacity);
      const enemyPoints = assigned.filter(a => a.team !== actor.team).map(a => a.point);
      const point = chooseSpawn(pools[actor.team], assigned.map(a => a.point), enemyPoints, this.nav);
      actor.reset(point, this.settings.mode === 'tdm' ? 1.6 : 0); assigned.push({ point, team: actor.team });
    }
    this.physics!.world.step();
    this.scoped = false; this.recoilPitch = this.recoilYaw = this.kick = 0;
    this.eyeY = 1.56; this.lastDamage = this.hitTime = -100;
    this.damagePopups = [];
    this.deathCamera = undefined;
  }

  private cleanup() {
    this.radio.reset(); this.sound.stopRadio();
    this.clearGrenades();
    for (const actor of this.actors) { this.view.scene.remove(actor.model.root); disposeTree(actor.model.root); }
    this.actors = []; this.physics?.dispose(); this.physics = undefined;
    this.view.clearEffects(); this.smokes = []; this.intel = {};
    this.damagePopups = [];
    this.deathCamera = undefined;
  }

  toMenu() {
    this.screen = 'menu'; this.release(); this.cleanup(); this.clearInput(); this.onScreenChange?.();
  }

  pause() {
    if (this.screen !== 'playing') return;
    this.screen = 'paused'; this.sound.stopRadio(); this.clearInput(); this.release(); this.onScreenChange?.();
  }

  resume() {
    if (this.screen !== 'paused') return;
    void this.sound.unlock(); this.screen = 'playing'; this.clearInput(); this.onScreenChange?.(); this.capture();
  }

  continueRound(primary: Primary) {
    if (this.screen !== 'loadout' || this.phase !== 'between' || !['ak', 'm4', 'awp'].includes(primary)) return false;
    if (PRIMARIES.some(id => this.settings.allowedWeapons.includes(id)) && !this.settings.allowedWeapons.includes(primary)) return false;
    this.player.primary = primary; this.settings.primary = primary;
    this.round++; this.resetActors(); this.remaining = ROUND_SECONDS;
    this.phase = 'warmup'; this.phaseTime = this.settings.freezeTime; this.screen = 'playing'; this.clearInput();
    this.onScreenChange?.(); this.capture(); return true;
  }

  private capture() {
    if (document.pointerLockElement === this.view.canvas) return;
    try {
      const request = this.view.canvas.requestPointerLock();
      if (request) void request.catch(() => this.pause());
    } catch { this.pause(); }
  }

  private release() { if (document.pointerLockElement) document.exitPointerLock(); }
  private clearInput() { this.keys.clear(); this.mouseDown = this.trigger = this.jumpQueued = false; this.scoreboard = false; this.cancelGrenade(); }
  private cancelGrenade() { this.grenadePrime = this.grenadeRelease = undefined; }

  private input() {
    window.addEventListener('keydown', event => {
      if (this.screen !== 'playing') return;
      if (['Tab', 'Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Tab') this.scoreboard = true;
      if (event.repeat || !this.player?.alive) return;
      if (event.code === 'Space') this.jumpQueued = true;
      if (event.code === 'KeyR' && this.player.startReload()) { this.scoped = false; this.sound.reload(); }
      if (event.code === 'KeyQ' && this.player.quickSwitch()) { this.cancelGrenade(); this.scoped = false; this.sound.click(); }
      if (event.code.startsWith('Digit')) {
        const id = this.player.weapons[Number(event.code.slice(5)) - 1];
        if (id && this.player.equip(id)) { this.cancelGrenade(); this.scoped = false; this.sound.click(); }
      }
      if (event.code === 'Escape') this.pause();
    });
    window.addEventListener('keyup', event => { this.keys.delete(event.code); if (event.code === 'Tab') this.scoreboard = false; });
    window.addEventListener('mousemove', event => {
      if (this.screen !== 'playing' || document.pointerLockElement !== this.view.canvas || !this.player?.alive) return;
      const sensitivity = .0021 * this.settings.sensitivity * (this.scoped ? this.scopeLevel === 2 ? .17 : .34 : 1);
      this.player.yaw -= event.movementX * sensitivity;
      this.player.pitch = clamp(this.player.pitch - event.movementY * sensitivity, -1.45, 1.45);
    });
    window.addEventListener('mousedown', event => {
      if (this.screen !== 'playing' || document.pointerLockElement !== this.view.canvas) return;
      if (event.button === 0) {
        this.mouseDown = true;
        const p = this.player;
        if (p.alive && isGrenade(p.weapon)) {
          if (this.phase === 'live' && p.ammo[p.weapon].clip > 0 && p.grenadeCooldown <= 0 && p.switching <= 0) this.grenadePrime = { type: p.weapon, start: this.time };
        } else this.trigger = true;
      }
      if (event.button === 2 && this.player.alive && this.player.weapon === 'awp' && !this.player.reload && !this.player.sprinting) { this.scopeLevel = (this.scopeLevel + 1) % 3; this.sound.zoom(); }
    });
    window.addEventListener('mouseup', event => {
      if (event.button !== 0) return;
      this.mouseDown = false;
      if (this.grenadePrime && this.screen === 'playing' && this.phase === 'live') this.grenadeRelease = { type: this.grenadePrime.type, held: this.time - this.grenadePrime.start };
      this.grenadePrime = undefined;
    });
    this.view.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', event => {
      if (this.screen !== 'playing' || !this.player?.alive) return;
      event.preventDefault();
      const weapons = this.player.weapons;
      let index = weapons.indexOf(this.player.weapon);
      index = (index + (event.deltaY > 0 ? 1 : -1) + weapons.length) % weapons.length;
      if (this.player.equip(weapons[index])) { this.cancelGrenade(); this.scoped = false; this.sound.click(); }
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
      while (this.screen === 'playing' && this.accumulator >= FIXED_DT) { this.update(FIXED_DT); this.accumulator -= FIXED_DT; }
      this.view.updateEffects(dt);
    } else this.accumulator = 0;
    this.camera(dt);
    const showWeapon = this.screen !== 'menu' && !!this.player?.alive && !this.scoped;
    this.view.render(showWeapon);
    this.onFrame?.(); requestAnimationFrame(t => this.frame(t));
  }

  private update(dt: number) {
    if (this.screen !== 'playing') return;
    this.time += dt; this.announcementTime = Math.max(0, this.announcementTime - dt);
    this.damagePopups = this.damagePopups.filter(popup => this.time - popup.time < .95);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.shotFlash = Math.max(0, this.shotFlash - dt);
    this.recoilPitch *= Math.exp(-dt * 6); this.recoilYaw *= Math.exp(-dt * 7);
    for (const actor of this.actors) { actor.previousPosition.copy(actor.position); actor.tick(dt); if (!actor.alive) this.updateDeath(actor, dt); }
    if (this.phase === 'warmup' || this.phase === 'between') {
      this.phaseTime -= dt;
      for (const actor of this.actors) if (actor.alive) actor.body.move(0, -.1, 0);
      if (this.phaseTime <= 0) {
        if (this.phase === 'between') {
          if (this.pendingFinish !== undefined) { this.finish(this.pendingFinish); this.pendingFinish = undefined; }
          else { this.screen = 'loadout'; this.clearInput(); this.release(); this.onScreenChange?.(); }
        } else { this.phase = 'live'; this.announce(this.settings.mode === 'tdm' ? 'WEAPONS FREE' : `ROUND ${this.round} · ELIMINATE THE ENEMY`, 2); }
      }
    } else {
      this.remaining = Math.max(0, this.remaining - dt);
      const context: BotContext = {
        time: this.time, difficulty: this.settings.difficulty, actors: this.actors, nav: this.nav, intel: this.intel,
        movementSpeed: this.settings.movementSpeed, jumpGravity: this.settings.jumpGravity,
        visible: (a, b) => this.visible(a, b), shoot: (actor, direction) => this.shoot(actor, direction),
        throwGrenade: (actor, type, target) => this.botGrenade(actor, type, target),
      };
      for (const actor of this.actors) {
        if (!actor.alive) {
          actor.respawn -= dt;
          if (this.settings.mode === 'tdm' && actor.respawn <= 0) {
            if (!this.settings.allowedWeapons.includes(actor.primary)) actor.primary = PRIMARIES.find(id => this.settings.allowedWeapons.includes(id)) ?? actor.primary;
            actor.configureLoadout(this.settings.allowedWeapons, this.settings.grenadeCapacity);
            actor.reset(this.safeSpawn(actor.team), 1.6);
          }
          continue;
        }
        if (this.settings.mode === 'tdm') actor.replenish(dt);
        const wasReloading = actor.reload > 0, wasGrounded = actor.body.grounded, wasVertical = actor.velocity.y;
        if (actor.human) this.updatePlayer(dt);
        else updateBot(actor, dt, context);
        if (!actor.human && !wasReloading && actor.reload > 0) this.sound.reload(actor.position);
        if (!actor.human && wasGrounded && wasVertical <= 0 && actor.velocity.y > 0) this.sound.jump(actor.position);
      }
      this.updateGrenades(dt);
      this.updateRadio();
      this.checkMatch();
    }
    this.physics!.world.step();
    for (const actor of this.actors) {
      if (actor.alive) actor.sync();
      const moving = actor.alive && this.phase === 'live';
      const motion = { x: moving ? (actor.position.x - actor.previousPosition.x) / dt : 0, z: moving ? (actor.position.z - actor.previousPosition.z) / dt : 0 };
      if (moving && actor.body.grounded && Math.hypot(motion.x, motion.z) > .8) {
        actor.step += Math.hypot(motion.x, motion.z) * dt;
        if (actor.step >= footstepStride(actor.sprinting, actor.body.crouched)) { actor.step = 0; this.footstep(actor); }
      }
      actor.model.animate(dt, motion, actor.alive, actor.reload > 0, actor.body.grounded, actor.body.crouched, actor.deathAge, actor.deathHead, actor.awpShotAge);
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
    p.sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && forward > 0 && !p.body.crouched && p.reload <= 0 && !this.mouseDown && !this.trigger;
    if (p.sprinting) this.scoped = false;
    const maxSpeed = WEAPONS[p.weapon].speed * this.settings.movementSpeed * movementScale(p.body.crouched, this.scoped, p.sprinting);
    const vertical = verticalMotion(p.velocity.y, p.body.grounded, this.jumpQueued, p.jumpsUsed, this.settings.doubleJump, this.settings.jumpGravity, dt);
    if (vertical.jumpsUsed > p.jumpsUsed) this.sound.jump();
    p.velocity.y = vertical.velocity; p.jumpsUsed = vertical.jumpsUsed; this.jumpQueued = false;
    if (p.body.grounded) {
      const v = groundVelocity(p.velocity.x, p.velocity.z, dx, dz, maxSpeed, dt);
      p.velocity.x = v.x; p.velocity.z = v.z;
    } else {
      const v = airVelocity(p.velocity.x, p.velocity.z, dx, dz, maxSpeed, dt);
      p.velocity.x = v.x; p.velocity.z = v.z;
    }
    p.body.move(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt);
    // Preserve quick clicks even when down/up both occur between fixed simulation ticks.
    if (this.grenadeRelease) {
      const release = this.grenadeRelease; this.grenadeRelease = undefined;
      if (p.weapon === release.type) this.throwPlayerGrenade(release.held);
    }
    if (!isGrenade(p.weapon) && ((this.mouseDown && WEAPONS[p.weapon].automatic) || this.trigger)) {
      const spread = shotSpread(WEAPONS[p.weapon].spread, p.speed, !p.body.grounded, p.body.crouched, p.shots, p.weapon === 'awp' && !this.scoped);
      const yaw = p.yaw + this.recoilYaw + (Math.random() - .5) * spread * 2;
      const pitch = p.pitch + this.recoilPitch + (Math.random() - .5) * spread * 2;
      this.shoot(p, new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
    }
    this.trigger = false;
  }

  shoot(actor: Actor, direction: THREE.Vector3) {
    const id = actor.weapon, spec = WEAPONS[id], ammo = actor.ammo[id];
    if (!actor.alive || !actor.weapons.includes(id) || actor.sprinting || actor.cooldown > 0 || actor.reload > 0 || actor.switching > 0 || isGrenade(id)) return;
    if (ammo.clip <= 0) {
      if (actor.startReload() && actor.human) { this.scoped = false; this.sound.reload(); }
      return;
    }
    actor.immunity = 0;
    if (id !== 'knife') ammo.clip--;
    if (this.settings.mode === 'tdm') actor.scheduleRefill(id, this.settings.refillDelay);
    actor.cooldown = spec.interval; actor.shots++; actor.shotAge = 0; actor.model.flash = .06;
    if (id === 'awp') actor.awpShotAge = 0;
    if (actor.human) {
      this.kick = 1; this.shotFlash = id === 'knife' ? 0 : .05;
      this.recoilPitch = Math.min(.18, this.recoilPitch + spec.recoil * (1 + actor.shots * .06));
      this.recoilYaw += Math.sin(actor.shots * 1.7) * spec.recoil * .4;
      if (id === 'awp') this.scoped = false;
    }
    this.sound.shot(id, actor.human ? undefined : actor.position);
    this.hear(actor, id === 'knife' ? 5 : id === 'awp' ? 150 : 38);
    const origin = actor.eye();
    this.ray.set(origin, direction.normalize()); this.ray.far = spec.range;
    this.view.scene.updateMatrixWorld(true);
    const targets: THREE.Object3D[] = [];
    for (const target of this.actors) if (target !== actor && target.alive) targets.push(target.model.body);
    // The player's model is invisible in first person, but remains raycastable for bots.
    const hits = this.ray.intersectObjects(targets, true);
    const hit = hits[0];
    const cover = coverHits(origin, direction, this.arena.boxes, spec.range).filter(h => h.entry < (hit?.distance ?? spec.range));
    const result = penetration(id, cover, this.settings.wallShots);
    // The floor is always solid, never a penetrable wall.
    const floor = direction.y < -1e-8 ? -origin.y / direction.y : Infinity;
    const hitDistance = Math.min(hit?.distance ?? spec.range, result.stop ?? Infinity, floor);
    const endpoint = origin.clone().addScaledVector(direction, hitDistance);
    if (id !== 'knife') {
      const muzzle = origin.clone().addScaledVector(direction, .65).add(new THREE.Vector3(0, -.13, 0));
      this.view.tracer(muzzle, endpoint);
    }
    for (const wall of cover) {
      if (wall.entry > hitDistance) break;
      this.view.impact(origin.clone().addScaledVector(direction, wall.entry), false);
    }
    if (!hit || !result.multiplier || floor < hit.distance) return;
    const targetId = hit.object.userData.actor as number | undefined;
    const victim = targetId === undefined ? undefined : this.actors[targetId];
    const head = hit.object.userData.head === true && id !== 'knife';
    this.view.impact(hit.point, !!victim);
    if (victim && victim.team === actor.team && victim !== actor && victim.immunity <= 0 && !victim.human && actor.team === this.player.team) this.radio.say('friendlyFire', victim.name, this.time);
    if (victim && victim.team !== actor.team && victim.immunity <= 0) {
      const amount = damageAtRange(spec.damage, hit.distance, head, spec.head, spec.falloff) * result.multiplier;
      this.damage(victim, amount, actor, id, head);
      if (actor.human) { this.hitTime = this.time; this.hitHead = head; this.sound.hit(head); }
    }
  }

  private damage(victim: Actor, amount: number, attacker: Actor, weapon: WeaponId, head = false) {
    if (!victim.alive || victim.immunity > 0) return;
    const dealt = Math.min(victim.health, Math.max(0, Math.round(amount)));
    if (dealt === 0) return;
    victim.health -= dealt;
    if (attacker.human && victim.team !== attacker.team) {
      this.damagePopups.push({ id: ++this.nextDamageId, amount: dealt, head, killed: victim.health === 0, point: victim.position.clone().add(new THREE.Vector3(0, 1.95, 0)), time: this.time });
      this.damagePopups = this.damagePopups.slice(-24);
    }
    if (victim.human) {
      this.lastDamage = this.time;
      this.damageDirection = angleDelta(victim.yaw, Math.atan2(victim.position.x - attacker.position.x, victim.position.z - attacker.position.z));
    }
    if (head && victim.team !== attacker.team && attacker.team === this.player.team) {
      const teammate = this.actors.find(a => !a.human && a.alive && a !== attacker && a.team === attacker.team && this.botSees(a, victim));
      if (teammate) this.radio.say('headshot', teammate.name, this.time);
    }
    if (victim.health > 0) return;
    victim.alive = false; victim.deaths++; victim.respawn = 3;
    this.sound.death(victim.human ? undefined : victim.position);
    if (victim.team !== this.player.team) {
      const witness = this.actors.find(a => !a.human && a.team === this.player.team && a.alive && (a === attacker || this.botSees(a, victim)));
      if (witness) this.radio.observedDeaths.add(victim.id);
    }
    victim.sprinting = false; victim.deathAge = 0; victim.deathHead = head;
    victim.deathOrigin.copy(victim.position);
    victim.deathDirection.copy(victim.position).sub(attacker.position).setY(0);
    if (victim.deathDirection.lengthSq() < .001) victim.deathDirection.set(Math.sin(victim.yaw), 0, Math.cos(victim.yaw));
    victim.deathDirection.normalize();
    victim.model.root.rotation.y = Math.atan2(victim.deathDirection.x, victim.deathDirection.z);
    victim.body.enabled(false); victim.velocity.set(0, 0, 0); victim.reload = 0;
    if (victim.team !== attacker.team) { attacker.kills++; if (this.settings.mode === 'tdm') this.scores[attacker.team]++; }
    this.kills.unshift({ killer: attacker.name, victim: victim.name, team: attacker.team, weapon, head, time: this.time });
    this.kills = this.kills.slice(0, 5);
    if (victim.human) {
      this.cancelGrenade();
      this.deathCamera = { killer: attacker.id, time: this.time, origin: this.view.camera.position.clone(), rotation: this.view.camera.quaternion.clone(), fov: this.view.camera.fov };
      this.scoped = false; this.mouseDown = this.trigger = false;
    }
  }

  private updateDeath(actor: Actor, dt: number) {
    actor.deathAge += dt;
    const t = clamp(actor.deathAge / .8, 0, 1);
    const desired = actor.deathOrigin.clone().addScaledVector(actor.deathDirection, (actor.deathHead ? .85 : .18) * t);
    if (this.nav.clear(actor.position, desired, actor.deathOrigin.y + .45, .35)) {
      actor.position.x = desired.x; actor.position.z = desired.z;
    }
    actor.position.y = actor.deathOrigin.y + (actor.deathHead ? Math.sin(t * Math.PI) * .75 : 0);
    actor.model.root.position.copy(actor.position);
  }

  private throwPlayerGrenade(held = 0) {
    const player = this.player, type = player.weapon;
    if (!player.alive || !isGrenade(type) || !player.weapons.includes(type) || !player.ammo[type].clip || player.grenadeCooldown > 0 || player.switching > 0) return;
    const spec = grenadeThrow(held), yaw = player.yaw + (Math.random() - .5) * spec.spread * 2;
    const pitch = player.pitch + .18 + (Math.random() - .5) * spec.spread * 2;
    const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.launchGrenade(player, type, direction.multiplyScalar(spec.speed));
    this.kick = .8;
    if (!player.ammo[type].clip) player.equip(player.weapons.find(id => !isGrenade(id)) ?? player.weapons.find(id => player.ammo[id].clip > 0) ?? type);
  }

  private botGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', target: Point) {
    if (!actor.alive || !actor.weapons.includes(type) || !actor.ammo[type].clip || actor.grenadeCooldown > 0 || actor.cooldown > 0 || actor.reload > 0 || actor.switching > 0) return;
    const delta = new THREE.Vector3(target.x - actor.position.x, 0, target.z - actor.position.z);
    const length = delta.length(); delta.normalize().multiplyScalar(Math.min(16, length * .7)); delta.y = clamp(length * .32, 3, 8);
    this.launchGrenade(actor, type, delta); actor.cooldown = .6;
  }

  private launchGrenade(owner: Actor, type: 'he' | 'flash' | 'smoke', velocity: THREE.Vector3) {
    if (!owner.alive || !owner.weapons.includes(type) || !owner.ammo[type].clip || owner.grenadeCooldown > 0) return;
    owner.ammo[type].clip--; owner.immunity = 0;
    owner.grenadeCooldown = 1;
    if (this.settings.mode === 'tdm') owner.scheduleRefill(type, this.settings.refillDelay);
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
    const origin = new THREE.Vector3(a.x, (a as Partial<THREE.Vector3>).y ?? 1.4, a.z);
    const end = new THREE.Vector3(b.x, (b as Partial<THREE.Vector3>).y ?? 1.4, b.z);
    const direction = end.sub(origin), length = direction.length();
    return !coverHits(origin, direction.normalize(), this.arena.boxes, length).length && !this.smokes.some(smoke => segmentCircle(a, b, smoke.point, 4.2));
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
    const quiet = actor.body.crouched;
    this.sound.step(actor.human ? undefined : actor.position, this.arena.id === 'snow', actor.sprinting, quiet);
    this.hear(actor, quiet ? 3 : actor.sprinting ? 23 : 13);
  }

  private safeSpawn(team: Team): Point {
    const enemies = this.actors.filter(a => a.alive && a.team !== team);
    return chooseSpawn(this.spawnPools[team], this.actors.filter(a => a.alive && a.team === team).map(a => a.position), enemies.map(e => e.position), this.nav);
  }

  private checkMatch() {
    if (this.settings.mode === 'tdm') {
      if (this.scores.blue >= TDM_LIMIT || this.scores.red >= TDM_LIMIT || this.remaining <= 0) {
        this.pendingFinish = this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red';
        this.phase = 'between'; this.phaseTime = this.settings.roundEndDelay;
        this.victoryRadio(this.pendingFinish);
        this.announce('MATCH COMPLETE', this.phaseTime + .1); this.clearInput();
      }
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
      this.victoryRadio(winner);
      if (this.scores.blue >= ROUND_LIMIT || this.scores.red >= ROUND_LIMIT || this.round >= 15) {
        this.pendingFinish = this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red';
      }
      this.phase = 'between'; this.phaseTime = this.settings.roundEndDelay;
      this.announce(winner === 'draw' ? 'ROUND DRAW' : `${winner.toUpperCase()} TEAM TAKES THE ROUND`, this.phaseTime + .1);
      this.clearInput();
    }
  }

  private finish(winner: Team | 'draw') {
    this.winner = winner; this.screen = 'finished'; this.clearInput(); this.release(); this.onScreenChange?.();
  }

  private announce(text: string, duration: number) { this.announcement = text; this.announcementTime = duration; }

  private botSees(bot: Actor, target: Actor) {
    const d = distance(bot.position, target.position);
    const sight = bot.weapon === 'awp' ? (this.arena.sniperSight ?? 52) : 52;
    const angle = Math.atan2(bot.position.x - target.position.x, bot.position.z - target.position.z);
    return bot.flash < .3 && d < sight && (d < 5 || Math.abs(angleDelta(bot.yaw, angle)) < 1.25) && this.visible(bot.eye(), target.eye());
  }

  private updateRadio() {
    if (!this.radio.enabled || this.time < this.radioCheck) return;
    this.radioCheck = this.time + .5;
    const allies = this.actors.filter(a => a.alive && a.team === this.player.team);
    for (const bot of allies.filter(a => !a.human)) {
      const enemies = this.actors.filter(a => a.alive && a.team !== bot.team && this.botSees(bot, a));
      if (!enemies.length) continue;
      if (this.settings.mode === 'elimination') {
        const remaining = 5 - this.radio.observedDeaths.size;
        if ((remaining === 1 || remaining === 2) && !this.reportedCounts.has(remaining)) {
          if (this.radio.say(remaining === 1 ? 'oneLeft' : 'twoLeft', bot.name, this.time)) this.reportedCounts.add(remaining);
        }
      }
      const nearby = allies.filter(a => distance(bot.position, a.position) < 22).length;
      if (enemies.length > nearby) this.radio.say('overwhelmed', bot.name, this.time);
    }
  }

  private victoryRadio(winner: Team | 'draw') {
    if (winner !== this.player.team) return;
    const survivors = this.actors.filter(a => a.alive && a.team === winner);
    const speaker = survivors.find(a => !a.human) ?? survivors[0] ?? this.player;
    const big = this.settings.mode === 'tdm' ? this.scores[winner] - this.scores[winner === 'blue' ? 'red' : 'blue'] >= 10 : survivors.length >= 3;
    this.radio.say(big ? 'bigVictory' : 'closeVictory', speaker.name, this.time, true);
  }

  private camera(dt: number) {
    const camera = this.view.camera;
    if (this.screen === 'menu' || !this.player) {
      const angle = this.renderTime * .025;
      const scale = Math.max(this.arena.width, this.arena.depth) / 66;
      camera.position.set(24 * scale * Math.cos(angle), 18 * scale, (27 * Math.sin(angle) + 9) * scale); camera.lookAt(0, 0, -3 * scale);
      camera.fov = 65; camera.updateProjectionMatrix(); return;
    }
    const p = this.player;
    const deathAge = this.deathCamera ? this.time - this.deathCamera.time : Infinity;
    const deathDuration = this.deathCamera?.killer === p.id ? .8 : 2.3;
    for (const actor of this.actors) actor.model.root.visible = !actor.human;
    if (p.alive) {
      this.spectating = '';
      const alpha = clamp(this.accumulator / FIXED_DT, 0, 1);
      const position = p.previousPosition.clone().lerp(p.position, this.screen === 'playing' ? alpha : 1);
      this.eyeY += (p.eyeHeight - this.eyeY) * Math.min(1, dt * 16);
      const bob = Math.sin(this.time * (p.sprinting ? 19 : 14)) * (p.sprinting ? .021 : .013) * Math.min(p.speed / 5, 1) * (p.body.grounded ? 1 : 0);
      camera.position.copy(position).add(new THREE.Vector3(0, this.eyeY + bob, 0));
      camera.rotation.set(clamp(p.pitch + this.recoilPitch, -1.5, 1.5), p.yaw + this.recoilYaw, 0, 'YXZ');
      this.sound.listen(p.position.x, p.position.z, p.yaw);
    } else if (this.deathCamera && deathAge < deathDuration) {
      const death = this.deathCamera, age = this.time - death.time;
      const fall = clamp(age / .8, 0, 1);
      const fallen = p.position.clone().add(new THREE.Vector3(0, .22 + (1 - fall) * p.eyeHeight, 0));
      const fallenRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.35, p.yaw, .2, 'YXZ'));
      if (age < .8) {
        camera.position.copy(death.origin).lerp(fallen, fall);
        camera.quaternion.copy(death.rotation).slerp(fallenRotation, fall);
      } else {
        const killer = this.actors[death.killer];
        const target = killer.eye();
        const outward = p.deathOrigin.clone().sub(target).setY(0).normalize();
        if (!outward.lengthSq()) outward.set(0, 0, 1);
        const clearance = coverHits(target, outward, this.arena.boxes, 3)[0]?.entry ?? 3;
        const destination = target.clone().addScaledVector(outward, Math.max(.15, clearance - .25));
        const t = clamp((age - .8) / 1.5, 0, 1), smooth = t * t * (3 - 2 * t);
        const start = p.deathOrigin.clone().add(new THREE.Vector3(0, .25, 0));
        camera.position.copy(start).lerp(destination, smooth); camera.position.y += Math.sin(t * Math.PI) * .65;
        camera.lookAt(target);
        const look = camera.quaternion.clone(); camera.quaternion.copy(fallenRotation).slerp(look, clamp(t * 3, 0, 1));
      }
      this.spectating = death.killer === p.id ? '' : `KILLER · ${this.actors[death.killer].name}`;
      this.sound.listen(camera.position.x, camera.position.z, camera.rotation.y);
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
    let fov = this.settings.fov;
    if (this.scoped && p.alive) fov = scopeFov(this.arena.scopeFov ?? 24, this.scopeLevel);
    else if (!p.alive && this.deathCamera && deathAge < deathDuration) {
      fov = deathAge < .8 ? THREE.MathUtils.lerp(this.deathCamera.fov, this.settings.fov, deathAge / .8) : THREE.MathUtils.lerp(this.settings.fov, 48, clamp((deathAge - .8) / 1.5, 0, 1));
    }
    if (Math.abs(camera.fov - fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    this.view.equip(p.weapon);
    const reload = p.reload > 0 ? 1 - p.reload / WEAPONS[p.weapon].reload : 0;
    this.view.animateWeapon(this.time, p.speed, this.kick, reload, p.switching / .25, this.shotFlash > 0, p.weapon === 'knife', p.body.crouched, p.awpShotAge);
    if (this.grenadeCharge !== undefined) { this.view.weapon.position.y += .06; this.view.weapon.rotation.x -= .25 + this.grenadeCharge * .2; }
  }
}
