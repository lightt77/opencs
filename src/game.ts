import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Actor } from './actor';
import { Sound } from './audio';
import { updateBot, type BotContext } from './bots';
import { DEFAULTS, FIXED_DT, MATCH_SECONDS, PRIMARIES, ROUND_LIMIT, ROUND_SECONDS, TDM_LIMIT, WEAPONS, isGrenade, sanitizeWeapons, type Primary, type Settings, type Team, type WeaponId } from './config';
import { MAPS, type Arena } from './maps';
import { angleDelta, clamp, damageAtRange, distance, groundVelocity, segmentCircle, shotSpread, type Point } from './math';
import { disposeTree, weaponModel } from './models';
import { Navigation } from './navigation';
import { Physics } from './physics';
import { View } from './view';
import { airVelocity, footstepStride, movementScale, scopeFov, verticalMotion } from './movement';
import { coverHits, penetration } from './ballistics';
import { chooseSpawn, spawnCandidates } from './spawns';
import { blastFlight, grenadePose, grenadeThrow } from './grenades';
import { Radio } from './radio';
import { drawProfiles, sanitizeProfiles } from './bot-profiles';
import { Lan } from './lan';
import { cleanControls, type Action, type Controls, type Operator, type Room } from './lan-protocol';

export interface Kill { killer: string; victim: string; team: Team; weapon: WeaponId; head: boolean; time: number }
interface Grenade { body: RAPIER.RigidBody; mesh: THREE.Object3D; owner: Actor; type: 'he' | 'flash' | 'smoke'; fuse: number }
interface Smoke { point: Point; life: number }
export interface DamagePopup { id: number; amount: number; head: boolean; killed: boolean; point: THREE.Vector3; time: number }
export type Screen = 'menu' | 'playing' | 'paused' | 'loadout' | 'finished';

export class Game {
  lan = new Lan();
  network = false;
  private localActor = 0;
  private members = new Map<string, number>();
  private remoteControls = new Map<number, { controls: Controls; received: number }>();
  private actions: Action[] = [];
  private networkTimer?: number;
  private netTick = 0;
  private netReceived = 0;
  private events: Array<{ kind: 'shot' | 'throw' | 'explosion' | 'flash' | 'smoke' | 'hit'; actor?: number; weapon?: WeaponId; point: number[]; end?: number[]; amount?: number; head?: boolean; killed?: boolean }> = [];
  private replicaGrenades: THREE.Object3D[] = [];
  private inactive = new Set<number>();
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
  get player() { return this.actors[this.localActor]; }
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
  get grenadeCharge() { return this.grenadePrime ? grenadeThrow(this.time - this.grenadePrime.start, this.settings.grenadePower).charge : undefined; }

  constructor(canvas: HTMLCanvasElement) {
    this.view = new View(canvas); this.view.build(this.arena);
    this.input(); requestAnimationFrame(t => this.frame(t));
    this.lan.onStart = (room, list) => this.startNetwork(room, list);
    this.lan.onInput = (id, input) => {
      const actor = this.members.get(id), controls = cleanControls(input);
      if (actor === undefined || !controls || !this.lan.host) return;
      const previous = this.remoteControls.get(actor)?.controls;
      if (previous) { controls.trigger ||= previous.trigger; controls.jump ||= previous.jump; controls.grenade ??= previous.grenade; controls.actions = [...previous.actions, ...controls.actions].slice(0, 16); }
      this.remoteControls.set(actor, { controls, received: performance.now() });
    };
    this.lan.onSnapshot = state => { if (this.network && !this.lan.host) this.restoreSnapshot(state); };
    this.lan.onPrimary = (id, primary) => {
      const index = this.members.get(id);
      if (this.lan.host && this.screen === 'loadout' && index !== undefined && this.settings.allowedWeapons.includes(primary)) this.actors[index].primary = primary;
    };
    this.lan.onLeft = id => {
      const index = this.members.get(id); if (index === undefined) return;
      this.remoteControls.delete(index);
      const actor = this.actors[index]; if (!actor) return;
      // Keep stable actor IDs. A departing human becomes an inert slot, or a bot if fill is enabled.
      actor.human = false;
      if (!this.settings.botFill) { this.inactive.add(actor.id); actor.alive = false; actor.health = 0; actor.respawn = 0; actor.body.enabled(false); }
      else {
        const used = new Set(this.actors.filter(a => !a.human && a !== actor).map(a => a.profile?.id));
        const unused = this.settings.botProfiles.filter(p => p.enabled && !used.has(p.id));
        actor.profile = drawProfiles(unused.length ? unused : this.settings.botProfiles, 1)[0];
        actor.brain.role = actor.profile.bravery === 'low' ? actor.profile.coop === 'high' ? 'hold' : 'flank' : 'push';
      }
    };
    this.lan.onEnded = () => { if (this.network) this.toMenu(); };
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

  start(settings: Settings, roster?: Operator[], localActor = 0) {
    this.cleanup(); this.settings = { ...settings };
    this.localActor = localActor;
    this.settings.allowedWeapons = sanitizeWeapons(settings.allowedWeapons);
    this.settings.botProfiles = sanitizeProfiles(settings.botProfiles);
    this.arena = MAPS[settings.map]; this.nav = new Navigation(this.arena);
    this.physics = new Physics(this.arena); this.view.build(this.arena);
    this.spawnPools = { blue: spawnCandidates(this.nav, 'blue', false), red: spawnCandidates(this.nav, 'red', false) };
    this.view.renderer.shadowMap.enabled = settings.shadows;
    this.configureAudio(settings); void this.sound.unlock();
    const names = ['YOU', 'Kestrel', 'Moss', 'Rook', 'Echo', 'Viper', 'Ash', 'Ghost', 'Flint', 'Cinder'];
    const size = Math.max(1, Math.min(10, Math.round(settings.teamSize)));
    const list = roster ?? Array.from({ length: size * 2 }, (_, id) => ({ name: names[id] ?? `Bot ${id}`, team: id < size ? 'blue' as const : 'red' as const, primary: settings.primary, member: id === 0 ? 'solo' : undefined }));
    this.actors = list.map((operator, id) => {
      const { name, team } = operator;
      const primary = id === 0 ? settings.primary : this.arena.id === 'longshot' ? 'awp' : this.arena.id === 'india' ? (id % 3 === 0 ? 'm4' : 'awp') : id % 4 === 0 ? 'awp' : id % 2 === 0 ? 'm4' : 'ak';
      const actor = new Actor(id, name, team, !!operator.member, roster ? operator.primary : primary, this.physics!.character(this.arena[team][id % this.arena[team].length]));
      actor.model.label.userData.enabled = team === list[localActor].team;
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
    const bots = this.actors.filter(a => !a.human && !this.inactive.has(a.id));
    const profiles = drawProfiles(this.settings.botProfiles, bots.length);
    for (const actor of bots) {
      actor.profile = profiles.shift()!;
      actor.brain.role = actor.profile.bravery === 'low' ? (actor.profile.coop === 'high' ? 'hold' : 'flank') : 'push';
    }
    // Alternate teams so both spawn plans account for opposing positions.
    const blue = this.actors.filter(a => a.team === 'blue'), red = this.actors.filter(a => a.team === 'red');
    for (const actor of Array.from({ length: Math.max(blue.length, red.length) }, (_, i) => [blue[i], red[i]]).flat().filter((a): a is Actor => !!a)) {
      if (this.inactive.has(actor.id)) continue;
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
    if (this.networkTimer !== undefined) window.clearInterval(this.networkTimer);
    this.networkTimer = undefined; this.network = false; this.remoteControls.clear(); this.events = []; this.inactive.clear();
    for (const mesh of this.replicaGrenades) { this.view.scene.remove(mesh); disposeTree(mesh); } this.replicaGrenades = [];
    this.radio.reset(); this.sound.stopRadio();
    this.clearGrenades();
    for (const actor of this.actors) { this.view.scene.remove(actor.model.root); disposeTree(actor.model.root); }
    this.actors = []; this.physics?.dispose(); this.physics = undefined;
    this.view.clearEffects(); this.smokes = []; this.intel = {};
    this.damagePopups = [];
    this.deathCamera = undefined;
  }

  toMenu() {
    if (this.lan.room) this.lan.leave();
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
    if (this.network && !this.lan.host) return false;
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
  private clearInput() { this.keys.clear(); this.actions = []; this.mouseDown = this.trigger = this.jumpQueued = false; this.scoreboard = false; this.cancelGrenade(); }
  private cancelGrenade() { this.grenadePrime = this.grenadeRelease = undefined; }

  private emptyControls(actor: Actor): Controls { return { keys: [], yaw: actor.yaw, pitch: actor.pitch, scope: 0, fire: false, trigger: false, jump: false, actions: [] }; }

  private startNetwork(room: Room, roster: Operator[]) {
    const local = roster.findIndex(a => a.member === this.lan.id);
    if (local < 0) return;
    const preferences = this.settings;
    const settings = { ...room.settings };
    // Match rules are shared; mouse, sound and display preferences remain per-device.
    for (const key of ['sensitivity', 'volume', 'fov', 'shadows', 'soundPack', 'effectsPack', 'radioChatter', 'radioVolume'] as const) Object.assign(settings, { [key]: preferences[key] });
    this.start(settings, roster, local);
    this.network = true; this.netTick = 0; this.netReceived = performance.now();
    this.members = new Map(roster.flatMap((a, i) => a.member ? [[a.member, i] as const] : []));
    let last = performance.now(), accumulated = 0;
    this.networkTimer = window.setInterval(() => {
      const now = performance.now(), elapsed = Math.min(.1, (now - last) / 1000); last = now;
      if (this.lan.host) {
        accumulated += elapsed;
        while (accumulated >= FIXED_DT) { this.update(FIXED_DT); accumulated -= FIXED_DT; }
        if (++this.netTick % 3 === 0) { this.lan.send({ type: 'snapshot', state: this.snapshot() }); this.events = []; }
      } else {
        if (now - this.netReceived > 8000) { this.toMenu(); this.lan.status = 'The host stopped responding. Room closed.'; this.lan.onChange?.(); return; }
        if (++this.netTick % 2 === 0) {
          const p = this.player, active = this.screen === 'playing';
          const controls: Controls = active ? { keys: [...this.keys], yaw: p.yaw + this.recoilYaw, pitch: p.pitch + this.recoilPitch, scope: this.scopeLevel, fire: this.mouseDown, trigger: this.trigger, jump: this.jumpQueued, actions: this.actions.splice(0), grenade: this.grenadeRelease } : this.emptyControls(p);
          this.lan.send({ type: 'input', controls });
          this.trigger = this.jumpQueued = false; this.grenadeRelease = undefined;
        }
        this.kick = Math.max(0, this.kick - elapsed * 6); this.shotFlash = Math.max(0, this.shotFlash - elapsed);
        this.recoilPitch *= Math.exp(-elapsed * 6); this.recoilYaw *= Math.exp(-elapsed * 7);
      }
    }, 1000 / 60);
  }

  snapshot() {
    return {
      time: this.time, remaining: this.remaining, phase: this.phase, phaseTime: this.phaseTime, round: this.round, scores: this.scores,
      screen: this.screen === 'paused' ? 'playing' as const : this.screen, winner: this.winner,
      announcement: this.announcement, announcementTime: this.announcementTime, kills: this.kills,
      actors: this.actors.map(a => ({ position: a.position.toArray(), velocity: a.velocity.toArray(), yaw: a.yaw, pitch: a.pitch,
        active: !this.inactive.has(a.id),
        health: a.health, alive: a.alive, kills: a.kills, deaths: a.deaths, respawn: a.respawn, immunity: a.immunity, flash: a.flash,
        weapon: a.weapon, primary: a.primary, ammo: a.ammo, reload: a.reload, switching: a.switching, shots: a.shots,
        cooldown: a.cooldown, grenadeCooldown: a.grenadeCooldown, awpShotAge: Number.isFinite(a.awpShotAge) ? a.awpShotAge : 999,
        throwAge: Number.isFinite(a.throwAge) ? a.throwAge : 999,
        refillTimers: a.refillTimers, sprinting: a.sprinting, crouched: a.body.crouched, grounded: a.body.grounded, human: a.human,
        deathAge: a.deathAge, deathHead: a.deathHead, deathBlast: a.deathBlast, deathOrigin: a.deathOrigin.toArray(), deathDirection: a.deathDirection.toArray(), profile: a.profile })),
      grenades: this.grenades.map(g => ({ position: g.body.translation(), rotation: g.body.rotation(), type: g.type })),
      smokes: this.smokes, events: this.events,
    };
  }

  private restoreSnapshot(state: ReturnType<Game['snapshot']>) {
    this.netReceived = performance.now();
    const oldTime = this.time, oldRound = this.round, oldPhase = this.phase;
    this.time = state.time; this.remaining = state.remaining; this.phase = state.phase; this.phaseTime = state.phaseTime;
    this.round = state.round; this.scores = state.scores; this.winner = state.winner;
    this.announcement = state.announcement; this.announcementTime = state.announcementTime; this.kills = state.kills;
    if (oldRound !== state.round) { this.radio.reset(); this.sound.stopRadio(); this.reportedCounts.clear(); this.view.clearEffects(); this.damagePopups = []; }
    for (const [i, s] of state.actors.entries()) {
      const a = this.actors[i]; if (!a) continue;
      const alive = a.alive, health = a.health, yaw = a.yaw, pitch = a.pitch, previousWeapon = a.weapon, wasReloading = a.reload > 0, wasGrounded = a.body.grounded;
      a.previousPosition.copy(a.position);
      const { position, velocity, deathOrigin, deathDirection, crouched, grounded, active, ...fields } = s;
      if (active) this.inactive.delete(i); else this.inactive.add(i);
      Object.assign(a, fields);
      a.position.fromArray(position); a.velocity.fromArray(velocity); a.deathOrigin.fromArray(deathOrigin); a.deathDirection.fromArray(deathDirection);
      if ((!alive && a.alive) || a.previousPosition.distanceTo(a.position) > 5) a.previousPosition.copy(a.position);
      a.body.crouched = crouched; a.body.grounded = grounded;
      if (a === this.player) {
        if (previousWeapon !== a.weapon) this.cancelGrenade();
        if (alive && a.alive) { a.yaw = yaw; a.pitch = pitch; }
        if (a.health < health) this.lastDamage = this.time;
        if (alive && !a.alive) {
          const kill = state.kills.find(k => k.victim === a.name), killer = this.actors.find(other => other.name === kill?.killer) ?? a;
          this.deathCamera = { killer: killer.id, time: this.time, origin: this.view.camera.position.clone(), rotation: this.view.camera.quaternion.clone(), fov: this.view.camera.fov };
          this.cancelGrenade(); this.scoped = false;
        }
        if (!alive && a.alive) { this.deathCamera = undefined; this.scoped = false; }
        if (a.weapon !== 'awp' || a.reload > 0 || a.sprinting) this.scoped = false;
      }
      a.model.equip(a.weapon); a.model.root.position.copy(a.position);
      a.model.root.rotation.y = a.alive ? a.yaw : Math.atan2(a.deathDirection.x, a.deathDirection.z);
      const dt = Math.max(0, state.time - oldTime);
      if (alive && !a.alive) this.sound.death(a === this.player ? undefined : a.position);
      if (!wasReloading && a.reload > 0) this.sound.reload(a === this.player ? undefined : a.position);
      if (wasGrounded && !grounded && a.velocity.y > 0) this.sound.jump(a === this.player ? undefined : a.position);
      if (alive && !a.alive && a.team !== this.player.team && this.actors.some(bot => !bot.human && bot.alive && bot.team === this.player.team && this.botSees(bot, a))) this.radio.observedDeaths.add(a.id);
      if (alive && a.alive && grounded && this.phase === 'live') {
        const moved = a.previousPosition.distanceTo(a.position);
        if (moved < 2) a.step += moved;
        if (a.step >= footstepStride(a.sprinting, crouched)) { a.step = 0; this.sound.step(a === this.player ? undefined : a.position, this.arena.id === 'snow', a.sprinting, crouched); }
      }
      a.model.animate(dt, { x: a.velocity.x, z: a.velocity.z }, a.alive, a.reload > 0, grounded, crouched, a.deathAge, a.deathHead || a.deathBlast, a.awpShotAge, a.throwAge);
    }
    for (const event of state.events) {
      const point = new THREE.Vector3().fromArray(event.point), actor = this.actors[event.actor ?? -1];
      if (event.kind === 'shot' && actor && event.weapon) {
        actor.model.flash = .06; this.sound.shot(event.weapon, actor === this.player ? undefined : point);
        if (event.end && event.weapon !== 'knife') this.view.tracer(point, new THREE.Vector3().fromArray(event.end));
        if (actor === this.player) {
          this.kick = 1; this.shotFlash = .05; const spec = WEAPONS[event.weapon];
          this.recoilPitch = Math.min(.18, this.recoilPitch + spec.recoil * (1 + actor.shots * .06));
          this.recoilYaw += Math.sin(actor.shots * 1.7) * spec.recoil * .4;
          if (event.weapon === 'awp') this.scoped = false;
        }
      } else if (event.kind === 'throw' && actor) {
        actor.throwAge = 0;
      } else if (event.kind === 'explosion' || event.kind === 'flash') {
        this.view.explosion(point); if (event.kind === 'explosion') this.sound.explosion(point); else this.sound.flash(point);
      } else if (event.kind === 'smoke') this.view.smoke(point);
      else if (event.kind === 'hit' && actor === this.player) {
        this.hitTime = this.time; this.hitHead = !!event.head; this.sound.hit(!!event.head);
        this.damagePopups.push({ id: ++this.nextDamageId, amount: event.amount!, head: !!event.head, killed: !!event.killed, point, time: this.time });
      }
    }
    this.damagePopups = this.damagePopups.filter(p => this.time - p.time < .95);
    this.smokes = state.smokes;
    this.updateRadio();
    if (oldPhase !== 'between' && this.phase === 'between') {
      const team = this.scores.blue === this.scores.red ? 'draw' : this.scores.blue > this.scores.red ? 'blue' : 'red';
      if (this.settings.mode === 'tdm') this.victoryRadio(team);
      else {
        const winner = state.announcement.startsWith('BLUE') ? 'blue' : state.announcement.startsWith('RED') ? 'red' : 'draw';
        this.victoryRadio(winner);
      }
    }
    while (this.replicaGrenades.length > state.grenades.length) { const mesh = this.replicaGrenades.pop()!; this.view.scene.remove(mesh); disposeTree(mesh); }
    state.grenades.forEach((g, i) => {
      let mesh: THREE.Object3D | undefined = this.replicaGrenades[i];
      if (mesh && mesh.userData.type !== g.type) { this.view.scene.remove(mesh); disposeTree(mesh); mesh = undefined; }
      if (!mesh) { mesh = weaponModel(g.type); mesh.userData.type = g.type; this.replicaGrenades[i] = mesh; this.view.scene.add(mesh); }
      mesh.position.set(g.position.x, g.position.y, g.position.z); mesh.quaternion.set(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
    });
    const desired = state.screen;
    if ((desired === 'finished' || desired === 'loadout') && this.screen !== desired) {
      this.screen = desired; this.clearInput(); this.release(); this.onScreenChange?.();
    } else if (desired === 'playing' && this.screen === 'loadout') { this.screen = 'paused'; this.onScreenChange?.(); }
  }

  private action(action: Action) {
    if (this.network && !this.lan.host) {
      this.scoped = false;
      if (action.kind !== 'reload') this.cancelGrenade();
      this.actions.push(action); return;
    }
    this.applyAction(this.player, action);
  }

  private applyAction(actor: Actor, action: Action) {
    if (!actor.alive) return;
    if (action.kind === 'reload') {
      if (actor.startReload() && actor === this.player) { this.scoped = false; this.sound.reload(); }
    } else if (action.kind === 'quick' ? actor.quickSwitch() : actor.equip(action.weapon)) {
      if (actor === this.player) { this.cancelGrenade(); this.scoped = false; this.sound.click(); }
    }
  }

  private input() {
    window.addEventListener('keydown', event => {
      if (this.screen !== 'playing') return;
      if (['Tab', 'Space', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Tab') this.scoreboard = true;
      if (event.repeat || !this.player?.alive) return;
      if (event.code === 'Space') this.jumpQueued = true;
      if (event.code === 'KeyR') this.action({ kind: 'reload' });
      if (event.code === 'KeyQ') this.action({ kind: 'quick' });
      if (event.code.startsWith('Digit')) {
        const id = this.player.weapons[Number(event.code.slice(5)) - 1];
        if (id) this.action({ kind: 'equip', weapon: id });
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
      this.action({ kind: 'equip', weapon: weapons[index] });
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
    if (this.screen === 'playing' && !this.network) {
      this.accumulator += dt;
      while (this.screen === 'playing' && this.accumulator >= FIXED_DT) { this.update(FIXED_DT); this.accumulator -= FIXED_DT; }
      this.view.updateEffects(dt);
    } else { this.accumulator = 0; if (this.network) this.view.updateEffects(dt); }
    if (this.network && !this.lan.host) {
      const alpha = clamp((performance.now() - this.netReceived) / 50, 0, 1);
      for (const a of this.actors) { if (a !== this.player) a.model.root.position.copy(a.previousPosition).lerp(a.position, alpha); a.throwAge += dt; }
    }
    this.camera(dt);
    const showWeapon = this.screen !== 'menu' && !!this.player?.alive && !this.scoped;
    this.view.render(showWeapon);
    this.onFrame?.(); requestAnimationFrame(t => this.frame(t));
  }

  private update(dt: number) {
    if (this.screen !== 'playing' && !(this.network && this.lan.host && this.screen === 'paused')) return;
    this.time += dt; this.announcementTime = Math.max(0, this.announcementTime - dt);
    this.damagePopups = this.damagePopups.filter(popup => this.time - popup.time < .95);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.shotFlash = Math.max(0, this.shotFlash - dt);
    this.recoilPitch *= Math.exp(-dt * 6); this.recoilYaw *= Math.exp(-dt * 7);
    for (const actor of this.actors) { actor.previousPosition.copy(actor.position); actor.tick(dt); if (!actor.alive) this.updateDeath(actor, dt); }
    if (this.phase === 'warmup' || this.phase === 'between') {
      for (const [index, remote] of this.remoteControls) {
        for (const action of remote.controls.actions) this.applyAction(this.actors[index], action);
        remote.controls.actions = []; remote.controls.trigger = remote.controls.jump = false; remote.controls.grenade = undefined;
      }
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
        if (this.inactive.has(actor.id)) continue;
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
        if (actor.human) {
          if (actor === this.player) this.updatePlayer(dt);
          else {
            const remote = this.remoteControls.get(actor.id);
            const controls = remote && performance.now() - remote.received < 300 ? remote.controls : this.emptyControls(actor);
            this.updatePlayer(dt, actor, controls);
            controls.trigger = controls.jump = false; controls.actions = []; controls.grenade = undefined;
          }
        }
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
      actor.model.animate(dt, motion, actor.alive, actor.reload > 0, actor.body.grounded, actor.body.crouched, actor.deathAge, actor.deathHead || actor.deathBlast, actor.awpShotAge, actor.throwAge);
    }
    for (const smoke of this.smokes) smoke.life -= dt;
    this.smokes = this.smokes.filter(s => s.life > 0);
  }

  private updatePlayer(dt: number, p = this.player, controls?: Controls) {
    const keys = controls ? new Set(controls.keys) : this.keys;
    const firing = controls ? controls.fire : this.mouseDown;
    const trigger = controls ? controls.trigger : this.trigger;
    const jump = controls ? controls.jump : this.jumpQueued;
    let scoped = controls ? controls.scope > 0 && p.weapon === 'awp' : this.scoped;
    if (controls) { p.yaw = controls.yaw; p.pitch = controls.pitch; for (const action of controls.actions) this.applyAction(p, action); }
    if (p.reload > 0 || p.switching > 0) scoped = false;
    p.body.crouch(keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
    const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const dx = right * Math.cos(p.yaw) - forward * Math.sin(p.yaw);
    const dz = -right * Math.sin(p.yaw) - forward * Math.cos(p.yaw);
    p.sprinting = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && forward > 0 && !p.body.crouched && p.reload <= 0 && !firing && !trigger;
    if (p.sprinting && p === this.player) this.scoped = false;
    const maxSpeed = WEAPONS[p.weapon].speed * this.settings.movementSpeed * movementScale(p.body.crouched, scoped, p.sprinting);
    const vertical = verticalMotion(p.velocity.y, p.body.grounded, jump, p.jumpsUsed, this.settings.doubleJump, this.settings.jumpGravity, dt);
    if (vertical.jumpsUsed > p.jumpsUsed) this.sound.jump(p === this.player ? undefined : p.position);
    p.velocity.y = vertical.velocity; p.jumpsUsed = vertical.jumpsUsed; if (!controls) this.jumpQueued = false;
    if (p.body.grounded) {
      const v = groundVelocity(p.velocity.x, p.velocity.z, dx, dz, maxSpeed, dt);
      p.velocity.x = v.x; p.velocity.z = v.z;
    } else {
      const v = airVelocity(p.velocity.x, p.velocity.z, dx, dz, maxSpeed, dt);
      p.velocity.x = v.x; p.velocity.z = v.z;
    }
    p.body.move(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt);
    // Preserve quick clicks even when down/up both occur between fixed simulation ticks.
    const release = controls ? controls.grenade : this.grenadeRelease;
    if (release) {
      if (!controls) this.grenadeRelease = undefined;
      if (p.weapon === release.type) this.throwPlayerGrenade(release.held, p);
    }
    if (!isGrenade(p.weapon) && ((firing && WEAPONS[p.weapon].automatic) || trigger)) {
      const spread = shotSpread(WEAPONS[p.weapon].spread, p.speed, !p.body.grounded, p.body.crouched, p.shots, p.weapon === 'awp' && !scoped);
      const yaw = p.yaw + (p === this.player ? this.recoilYaw : 0) + (Math.random() - .5) * spread * 2;
      const pitch = p.pitch + (p === this.player ? this.recoilPitch : 0) + (Math.random() - .5) * spread * 2;
      this.shoot(p, new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
    }
    if (!controls) this.trigger = false;
  }

  shoot(actor: Actor, direction: THREE.Vector3) {
    const id = actor.weapon, spec = WEAPONS[id], ammo = actor.ammo[id];
    if (!actor.alive || !actor.weapons.includes(id) || actor.sprinting || actor.cooldown > 0 || actor.reload > 0 || actor.switching > 0 || isGrenade(id)) return;
    if (ammo.clip <= 0) {
      if (actor.startReload() && actor === this.player) { this.scoped = false; this.sound.reload(); }
      return;
    }
    actor.immunity = 0;
    if (id !== 'knife') ammo.clip--;
    if (this.settings.mode === 'tdm') actor.scheduleRefill(id, this.settings.refillDelay);
    actor.cooldown = spec.interval; actor.shots++; actor.shotAge = 0; actor.model.flash = .06;
    if (id === 'awp') actor.awpShotAge = 0;
    if (actor === this.player) {
      this.kick = 1; this.shotFlash = id === 'knife' ? 0 : .05;
      this.recoilPitch = Math.min(.18, this.recoilPitch + spec.recoil * (1 + actor.shots * .06));
      this.recoilYaw += Math.sin(actor.shots * 1.7) * spec.recoil * .4;
      if (id === 'awp') this.scoped = false;
    }
    this.sound.shot(id, actor === this.player ? undefined : actor.position);
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
    if (this.network) this.events.push({ kind: 'shot', actor: actor.id, weapon: id, point: origin.toArray(), end: endpoint.toArray() });
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
      if (actor === this.player) { this.hitTime = this.time; this.hitHead = head; this.sound.hit(head); }
    }
  }

  private damage(victim: Actor, amount: number, attacker: Actor, weapon: WeaponId, head = false, blast?: THREE.Vector3) {
    if (!victim.alive || victim.immunity > 0) return;
    const dealt = Math.min(victim.health, Math.max(0, Math.round(amount)));
    if (dealt === 0) return;
    victim.health -= dealt;
    if (this.network && victim.team !== attacker.team) this.events.push({ kind: 'hit', actor: attacker.id, amount: dealt, head, killed: victim.health === 0, point: victim.position.clone().add(new THREE.Vector3(0, 1.95, 0)).toArray() });
    if (attacker === this.player && victim.team !== attacker.team) {
      this.damagePopups.push({ id: ++this.nextDamageId, amount: dealt, head, killed: victim.health === 0, point: victim.position.clone().add(new THREE.Vector3(0, 1.95, 0)), time: this.time });
      this.damagePopups = this.damagePopups.slice(-24);
    }
    if (victim === this.player) {
      this.lastDamage = this.time;
      this.damageDirection = angleDelta(victim.yaw, Math.atan2(victim.position.x - attacker.position.x, victim.position.z - attacker.position.z));
    }
    if (head && victim.team !== attacker.team && attacker.team === this.player.team) {
      const teammate = this.actors.find(a => !a.human && a.alive && a !== attacker && a.team === attacker.team && this.botSees(a, victim));
      if (teammate) this.radio.say('headshot', teammate.name, this.time);
    }
    if (victim.health > 0) return;
    victim.alive = false; victim.deaths++; victim.respawn = 3;
    this.sound.death(victim === this.player ? undefined : victim.position);
    if (victim.team !== this.player.team) {
      const witness = this.actors.find(a => !a.human && a.team === this.player.team && a.alive && (a === attacker || this.botSees(a, victim)));
      if (witness) this.radio.observedDeaths.add(victim.id);
    }
    victim.sprinting = false; victim.deathAge = 0; victim.deathHead = head;
    victim.deathBlast = weapon === 'he';
    victim.deathOrigin.copy(victim.position);
    victim.deathDirection.copy(victim.position).sub(blast ?? attacker.position).setY(0);
    if (victim.deathDirection.lengthSq() < .001) victim.deathDirection.set(Math.sin(victim.yaw), 0, Math.cos(victim.yaw));
    victim.deathDirection.normalize();
    victim.model.root.rotation.y = Math.atan2(victim.deathDirection.x, victim.deathDirection.z);
    victim.body.enabled(false); victim.velocity.set(0, 0, 0); victim.reload = 0;
    if (victim.team !== attacker.team) { attacker.kills++; if (this.settings.mode === 'tdm') this.scores[attacker.team]++; }
    this.kills.unshift({ killer: attacker.name, victim: victim.name, team: attacker.team, weapon, head, time: this.time });
    this.kills = this.kills.slice(0, 5);
    if (victim === this.player) {
      this.cancelGrenade();
      this.deathCamera = { killer: attacker.id, time: this.time, origin: this.view.camera.position.clone(), rotation: this.view.camera.quaternion.clone(), fov: this.view.camera.fov };
      this.scoped = false; this.mouseDown = this.trigger = false;
    }
  }

  private updateDeath(actor: Actor, dt: number) {
    actor.deathAge += dt;
    const t = clamp(actor.deathAge / .8, 0, 1);
    const flight = blastFlight(actor.deathAge);
    const desired = actor.deathOrigin.clone().addScaledVector(actor.deathDirection, actor.deathBlast ? flight.distance : (actor.deathHead ? .85 : .18) * t);
    if (this.nav.clear(actor.position, desired, actor.deathOrigin.y + .45, .35)) {
      actor.position.x = desired.x; actor.position.z = desired.z;
    }
    actor.position.y = actor.deathOrigin.y + (actor.deathBlast ? flight.height : actor.deathHead ? Math.sin(t * Math.PI) * .75 : 0);
    actor.model.root.position.copy(actor.position);
  }

  private throwPlayerGrenade(held = 0, player = this.player) {
    const type = player.weapon;
    if (!player.alive || !isGrenade(type) || !player.weapons.includes(type) || !player.ammo[type].clip || player.grenadeCooldown > 0 || player.switching > 0) return;
    const spec = grenadeThrow(held, this.settings.grenadePower), yaw = player.yaw + (Math.random() - .5) * spec.spread * 2;
    const pitch = player.pitch + .18 + (Math.random() - .5) * spec.spread * 2;
    const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.launchGrenade(player, type, direction.multiplyScalar(spec.speed).add(new THREE.Vector3(player.velocity.x * .45, Math.max(0, player.velocity.y) * .45, player.velocity.z * .45)));
    if (player === this.player) this.kick = .8;
    if (!player.ammo[type].clip) player.equip(player.weapons.find(id => !isGrenade(id)) ?? player.weapons.find(id => player.ammo[id].clip > 0) ?? type);
  }

  private botGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', target: Point) {
    if (!actor.alive || !actor.weapons.includes(type) || !actor.ammo[type].clip || actor.grenadeCooldown > 0 || actor.cooldown > 0 || actor.reload > 0 || actor.switching > 0) return;
    const delta = new THREE.Vector3(target.x - actor.position.x, 0, target.z - actor.position.z);
    const length = delta.length(), scale = this.settings.grenadePower / 34; delta.normalize().multiplyScalar(Math.min(22 * scale, length * .85)); delta.y = clamp(length * .32, 3, 10);
    this.launchGrenade(actor, type, delta); actor.cooldown = .6;
  }

  private launchGrenade(owner: Actor, type: 'he' | 'flash' | 'smoke', velocity: THREE.Vector3) {
    if (!owner.alive || !owner.weapons.includes(type) || !owner.ammo[type].clip || owner.grenadeCooldown > 0) return;
    owner.ammo[type].clip--; owner.immunity = 0;
    owner.grenadeCooldown = 1;
    owner.throwAge = 0;
    if (this.settings.mode === 'tdm') owner.scheduleRefill(type, this.settings.refillDelay);
    // Start at the eye, rather than ahead of a wall where a throw could clip through geometry.
    const origin = owner.eye();
    const direction = velocity.clone().normalize();
    const clearance = coverHits(origin, direction, this.arena.boxes, .45)[0]?.entry ?? .45;
    origin.addScaledVector(direction, Math.max(0, clearance - .13));
    const mesh = weaponModel(type); mesh.position.copy(origin);
    this.view.scene.add(mesh);
    this.grenades.push({ body: this.physics!.grenade(origin, velocity, this.settings.grenadeWeight, this.settings.grenadeBounce), mesh, owner, type, fuse: type === 'flash' ? 1.45 : 1.8 });
    if (this.network) this.events.push({ kind: 'throw', actor: owner.id, point: origin.toArray() });
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
        if (this.network) this.events.push({ kind: 'explosion', point: position.toArray() });
        for (const actor of this.actors) {
          if (!actor.alive || (actor.team === grenade.owner.team && actor !== grenade.owner)) continue;
          const d = actor.eye().distanceTo(position);
          if (d < 8 && this.nav.clear(position, actor.position, .7)) this.damage(actor, Math.round(100 * (1 - d / 8)), grenade.owner, 'he', false, position);
        }
      } else if (grenade.type === 'flash') {
        this.view.explosion(position); this.sound.flash(position);
        if (this.network) this.events.push({ kind: 'flash', point: position.toArray() });
        for (const actor of this.actors) {
          const d = actor.eye().distanceTo(position);
          if (!actor.alive || d > 21 || !this.nav.clear(position, actor.position)) continue;
          const angle = Math.atan2(actor.position.x - position.x, actor.position.z - position.z);
          const facing = Math.abs(angleDelta(actor.yaw, angle)) < 1.6;
          actor.flash = Math.max(actor.flash, (1 - d / 24) * (facing ? 4 : 1.2));
        }
      } else {
        position.y = .1; this.view.smoke(position); this.smokes.push({ point: position, life: 12 });
        if (this.network) this.events.push({ kind: 'smoke', point: position.toArray() });
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
    this.sound.step(actor === this.player ? undefined : actor.position, this.arena.id === 'snow', actor.sprinting, quiet);
    this.hear(actor, quiet ? 3 : actor.sprinting ? 23 : 13);
  }

  private safeSpawn(team: Team): Point {
    const enemies = this.actors.filter(a => a.alive && a.team !== team);
    return chooseSpawn(this.spawnPools[team], this.actors.filter(a => a.alive && a.team === team).map(a => a.position), enemies.map(e => e.position), this.nav);
  }

  private checkMatch() {
    if (this.network && this.lan.host) {
      const available = (team: Team) => this.actors.some(a => a.team === team && !this.inactive.has(a.id));
      if (!available('blue') || !available('red')) {
        const winner = available('blue') ? 'blue' : 'red';
        this.pendingFinish = winner; this.phase = 'between'; this.phaseTime = this.settings.roundEndDelay;
        this.victoryRadio(winner); this.announce(`${winner.toUpperCase()} WINS · OPPONENTS LEFT`, this.phaseTime + .1); this.clearInput(); return;
      }
    }
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
        const remaining = this.actors.filter(a => a.team !== this.player.team).length - this.radio.observedDeaths.size;
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
    for (const actor of this.actors) actor.model.root.visible = actor !== p && !this.inactive.has(actor.id);
    if (p.alive) {
      this.spectating = '';
      const alpha = this.network ? this.lan.host ? 1 : clamp((performance.now() - this.netReceived) / 50, 0, 1) : clamp(this.accumulator / FIXED_DT, 0, 1);
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
      const ally = this.actors.find(a => a.team === p.team && a.alive);
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
    const throwPose = grenadePose(p.throwAge, this.grenadeCharge);
    this.view.weapon.position.y += throwPose.y; this.view.weapon.position.z += throwPose.z; this.view.weapon.rotation.x += throwPose.pitch;
  }
}
