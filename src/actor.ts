import * as THREE from 'three';
import { AWP_QUICK_INTERVAL, grenadeLoadout, inventory, WEAPON_IDS, WEAPONS, isGrenade, type Primary, type Team, type WeaponId } from './config';
import type { CharacterBody } from './physics';
import type { Point } from './math';
import { Soldier } from './models';
import { CROUCH_DROP } from './movement';
import type { BotProfile } from './bot-profiles';

export interface Ammo { clip: number; reserve: number }
export interface Brain {
  path: Point[]; goal?: Point; target: number; acquired: number; decision: number;
  repath: number; memory?: { point: Point; time: number }; burst: number; pause: number;
  hold: number; stuck: number; previous: Point; aimHeight: number; role: 'push' | 'flank' | 'hold';
  coverUntil: number; nextClimb: number; climb?: { approach: Point; top: Point; height: number; until: number; jumping: boolean };
}

export class Actor {
  position = new THREE.Vector3();
  previousPosition = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  kills = 0;
  deaths = 0;
  alive = true;
  respawn = 0;
  immunity = 0;
  flash = 0;
  weapon: WeaponId;
  primary: Primary;
  ammo = {} as Record<WeaponId, Ammo>;
  previousWeapon: WeaponId = 'pistol';
  allowedWeapons: WeaponId[] = [...WEAPON_IDS];
  grenadeCapacity = 3;
  refillTimers: Partial<Record<WeaponId, number>> = {};
  grenadeCooldown = 0;
  private cooldowns: Partial<Record<WeaponId, number>> = {};
  private quickAwpCycle = false;
  awpShotAge = Infinity;
  throwAge = Infinity;
  jumpsUsed = 0;
  get cooldown() { return this.cooldowns[this.weapon] ?? 0; }
  set cooldown(value: number) { this.cooldowns[this.weapon] = value; }
  reload = 0;
  switching = 0;
  shots = 0;
  shotAge = 0;
  step = 0;
  sprinting = false;
  deathAge = 0;
  deathHead = false;
  deathBlast = false;
  deathOrigin = new THREE.Vector3();
  deathDirection = new THREE.Vector3();
  brain: Brain;
  profile?: BotProfile;
  model: Soldier;

  constructor(readonly id: number, readonly name: string, readonly team: Team, public human: boolean, primary: Primary, readonly body: CharacterBody) {
    this.primary = primary; this.weapon = primary;
    this.model = new Soldier(team, name, primary);
    this.model.label.userData.enabled = team === 'blue';
    this.model.root.userData.actor = id;
    this.model.root.traverse(o => { o.userData.actor = id; });
    this.brain = {
      path: [], target: -1, acquired: 0, decision: 0, repath: 0, burst: 0, pause: 0,
      hold: 0, stuck: 0, previous: { x: 0, z: 0 }, aimHeight: 1.15,
      role: (['push', 'flank', 'hold'] as const)[id % 3],
      coverUntil: 0, nextClimb: 0,
    };
    this.refill(); this.sync();
  }

  get eyeHeight() { return this.body.crouched ? 1.56 - CROUCH_DROP : 1.56; }
  eye() { return this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0)); }
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get weapons() { return inventory(this.primary, this.allowedWeapons); }

  configureLoadout(allowed: WeaponId[], capacity: number) {
    this.allowedWeapons = [...allowed]; this.grenadeCapacity = capacity;
    this.weapon = this.weapons[0]; this.previousWeapon = this.weapons.find(id => id !== this.weapon) ?? this.weapon;
  }

  refill() {
    const grenades = grenadeLoadout(this.allowedWeapons, this.grenadeCapacity);
    for (const id of WEAPON_IDS) this.ammo[id] = { clip: !this.weapons.includes(id) ? 0 : isGrenade(id) ? grenades[id] : WEAPONS[id].magazine, reserve: this.weapons.includes(id) ? WEAPONS[id].reserve : 0 };
    this.refillTimers = {};
  }

  scheduleRefill(id: WeaponId, delay: number) {
    if (id !== 'knife' && this.refillTimers[id] === undefined) this.refillTimers[id] = delay;
  }

  replenish(dt: number) {
    const grenades = grenadeLoadout(this.allowedWeapons, this.grenadeCapacity);
    for (const id of Object.keys(this.refillTimers) as WeaponId[]) {
      this.refillTimers[id]! -= dt;
      if (this.refillTimers[id]! > 1e-6) continue;
      delete this.refillTimers[id];
      if (!this.weapons.includes(id)) continue;
      this.ammo[id] = { clip: isGrenade(id) ? grenades[id] : WEAPONS[id].magazine, reserve: WEAPONS[id].reserve };
      if (id === this.weapon) this.reload = 0;
    }
  }

  reset(point: Point, immunity: number) {
    this.alive = true; this.health = 100; this.velocity.set(0, 0, 0);
    this.sprinting = false; this.step = 0; this.deathAge = 0; this.deathHead = false;
    this.deathBlast = false;
    this.throwAge = Infinity;
    this.model.resetPose();
    this.flash = 0; this.cooldowns = {}; this.reload = 0; this.switching = .25;
    this.previousWeapon = this.weapons.find(id => id !== this.weapons[0]) ?? this.weapons[0]; this.quickAwpCycle = false; this.awpShotAge = Infinity; this.jumpsUsed = 0;
    this.shots = 0; this.shotAge = 0; this.immunity = immunity;
    this.weapon = this.weapons[0]; this.grenadeCooldown = 0; this.refill();
    this.body.enabled(true); this.body.teleport(point); this.body.crouch(false);
    this.yaw = this.team === 'blue' ? 0 : Math.PI; this.pitch = 0;
    this.brain.path = []; this.brain.target = -1; this.brain.memory = undefined;
    this.brain.goal = undefined; this.brain.repath = 0; this.brain.stuck = 0; this.brain.burst = 0; this.brain.pause = 0; this.brain.hold = 0;
    this.brain.coverUntil = 0; this.brain.climb = undefined; this.brain.nextClimb = 0;
    this.sync(); this.previousPosition.copy(this.position);
    this.model.root.visible = !this.human;
  }

  sync() {
    this.model.equip(this.weapon);
    const p = this.body.position(); this.position.set(p.x, p.y, p.z);
    this.model.root.position.copy(this.position); this.model.root.rotation.y = this.yaw;
  }

  tick(dt: number) {
    for (const id of Object.keys(this.cooldowns) as WeaponId[]) this.cooldowns[id] = Math.max(0, this.cooldowns[id]! - dt);
    this.awpShotAge += dt;
    this.throwAge += dt;
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    this.switching = Math.max(0, this.switching - dt);
    this.immunity = Math.max(0, this.immunity - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.shotAge += dt;
    if (this.shotAge > .22) this.shots = Math.max(0, this.shots - dt * 13);
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) {
        const ammo = this.ammo[this.weapon], need = Math.min(WEAPONS[this.weapon].magazine - ammo.clip, ammo.reserve);
        ammo.clip += need; ammo.reserve -= need; this.reload = 0;
      }
    }
  }

  startReload() {
    const spec = WEAPONS[this.weapon], ammo = this.ammo[this.weapon];
    if (this.reload > 0 || this.switching > 0 || spec.reload === 0 || ammo.clip >= spec.magazine || ammo.reserve <= 0) return false;
    this.reload = spec.reload; return true;
  }

  quickSwitch() { return this.equip(this.previousWeapon, true); }

  equip(id: WeaponId, quick = false) {
    if (!this.alive || !this.weapons.includes(id) || this.weapon === id) return false;
    const outgoing = this.weapon;
    this.previousWeapon = outgoing; this.weapon = id;
    this.model.equip(id);
    if (quick && outgoing === 'awp' && this.awpShotAge < WEAPONS.awp.interval) this.quickAwpCycle = true;
    if (quick && id === 'awp' && this.quickAwpCycle) {
      // Double-Q skips the long bolt recovery, but never allows instant sniper spam.
      this.cooldown = Math.min(this.cooldown, Math.max(0, AWP_QUICK_INTERVAL - this.awpShotAge));
      this.quickAwpCycle = false;
    } else if (!quick) this.quickAwpCycle = false;
    this.reload = 0; this.switching = quick ? .12 : .25; this.shots = 0; return true;
  }
}
