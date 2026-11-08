import * as THREE from 'three';
import { inventory, WEAPONS, type Primary, type Team, type WeaponId } from './config';
import type { CharacterBody } from './physics';
import type { Point } from './math';
import { Soldier } from './models';

export interface Ammo { clip: number; reserve: number }
export interface Brain {
  path: Point[]; goal?: Point; target: number; acquired: number; decision: number;
  repath: number; memory?: { point: Point; time: number }; burst: number; pause: number;
  hold: number; stuck: number; previous: Point; aimHeight: number; role: 'push' | 'flank' | 'hold';
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
  cooldown = 0;
  reload = 0;
  switching = 0;
  shots = 0;
  shotAge = 0;
  step = 0;
  brain: Brain;
  model: Soldier;

  constructor(readonly id: number, readonly name: string, readonly team: Team, readonly human: boolean, primary: Primary, readonly body: CharacterBody) {
    this.primary = primary; this.weapon = primary;
    this.model = new Soldier(team, name, primary);
    this.model.label.userData.enabled = team === 'blue';
    this.model.root.userData.actor = id;
    this.model.root.traverse(o => { o.userData.actor = id; });
    this.brain = {
      path: [], target: -1, acquired: 0, decision: 0, repath: 0, burst: 0, pause: 0,
      hold: 0, stuck: 0, previous: { x: 0, z: 0 }, aimHeight: 1.15,
      role: (['push', 'flank', 'hold'] as const)[id % 3],
    };
    this.refill(); this.sync();
  }

  get eyeHeight() { return this.body.crouched ? 1.02 : 1.56; }
  eye() { return this.position.clone().add(new THREE.Vector3(0, this.eyeHeight, 0)); }
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get weapons() { return inventory(this.primary); }

  refill() {
    for (const [id, spec] of Object.entries(WEAPONS)) this.ammo[id as WeaponId] = { clip: spec.magazine, reserve: spec.reserve };
  }

  reset(point: Point, immunity: number) {
    this.alive = true; this.health = 100; this.velocity.set(0, 0, 0);
    this.flash = 0; this.cooldown = 0; this.reload = 0; this.switching = .25;
    this.shots = 0; this.shotAge = 0; this.immunity = immunity;
    this.weapon = this.primary; this.refill();
    this.body.enabled(true); this.body.crouch(false); this.body.teleport(point);
    this.yaw = this.team === 'blue' ? 0 : Math.PI; this.pitch = 0;
    this.brain.path = []; this.brain.target = -1; this.brain.memory = undefined;
    this.brain.goal = undefined; this.brain.repath = 0; this.brain.stuck = 0; this.brain.burst = 0; this.brain.pause = 0; this.brain.hold = 0;
    this.sync(); this.previousPosition.copy(this.position);
    this.model.root.visible = !this.human;
  }

  sync() {
    const p = this.body.position(); this.position.set(p.x, p.y, p.z);
    this.model.root.position.copy(this.position); this.model.root.rotation.y = this.yaw;
  }

  tick(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
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

  equip(id: WeaponId) {
    if (!this.alive || !this.weapons.includes(id) || this.weapon === id) return false;
    this.weapon = id; this.reload = 0; this.switching = .25; this.shots = 0; return true;
  }
}
