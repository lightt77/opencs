import * as THREE from 'three';
import { TEAM_COLOR, type Team, type WeaponId } from './config';
import { footTarget, solveLeg } from './animation';
import { clamp, type Point } from './math';
import { CROUCH_DROP } from './movement';
import { animateBolt, awpAction } from './weapon-animation';

const material = (color: number, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness });
const steel = material(0x303a3c, .4);
const dark = material(0x172225);
const wood = material(0x86553c);
const skin = material(0xc7a080);
const olive = material(0x737b53);

export function block(parent: THREE.Object3D, size: number[], position: number[], mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function cylinder(parent: THREE.Object3D, radius: number, length: number, position: number[], mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), mat);
  mesh.rotation.x = Math.PI / 2; mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}

export function weaponModel(id: WeaponId, hands = false): THREE.Group {
  const root = new THREE.Group();
  const rifle = id === 'ak' || id === 'm4' || id === 'awp';
  if (rifle) {
    const trim = id === 'ak' ? wood : id === 'awp' ? olive : dark;
    block(root, [.09, .12, .35], [0, 0, -.16], steel);
    block(root, [.08, .1, .26], [0, -.01, -.42], trim);
    cylinder(root, .018, id === 'awp' ? .45 : .27, [0, .015, id === 'awp' ? -.7 : -.63], steel);
    block(root, [.07, .11, .28], [0, -.025, .15], trim);
    const grip = block(root, [.055, .15, .075], [0, -.12, -.06], dark); grip.rotation.x = -.25;
    const mag = block(root, [.055, id === 'awp' ? .1 : .23, .09], [0, -.16, -.24], steel); mag.rotation.x = id === 'ak' ? -.2 : 0;
    block(root, [.025, .045, .025], [0, .09, -.51], dark);
    block(root, [.025, .035, .025], [0, .09, -.04], dark);
    if (id === 'awp') {
      cylinder(root, .038, .24, [0, .13, -.16], dark);
      cylinder(root, .047, .065, [0, .13, -.29], steel);
      block(root, [.05, .07, .12], [0, .065, -.14], steel);
      const bolt = new THREE.Group(); bolt.name = 'awp-bolt'; root.add(bolt);
      block(bolt, [.1, .02, .025], [.065, .035, -.08], steel);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(.024, 6, 4), dark);
      handle.position.set(.12, .025, -.08); bolt.add(handle);
    }
    if (id === 'm4') cylinder(root, .027, .15, [0, .015, -.8], dark);
  } else if (id === 'pistol') {
    block(root, [.075, .085, .26], [0, 0, -.12], steel);
    const grip = block(root, [.065, .16, .085], [0, -.11, -.025], dark); grip.rotation.x = -.2;
    cylinder(root, .016, .08, [0, .005, -.28], dark);
    block(root, [.015, .02, .02], [0, .05, -.22], dark);
  } else if (id === 'knife') {
    block(root, [.045, .045, .18], [0, 0, -.03], dark);
    block(root, [.12, .025, .025], [0, 0, -.13], steel);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(.047, .29, 3), material(0xabb8b9, .25));
    blade.rotation.x = -Math.PI / 2; blade.position.z = -.28; root.add(blade);
  } else {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(.075, 1), id === 'he' ? olive : material(id === 'smoke' ? 0x8d9797 : 0xb4b6a1));
    body.scale.y = 1.4; body.position.y = -.03; root.add(body);
    block(root, [.04, .06, .04], [0, .07, 0], steel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.028, .005, 4, 10), steel); ring.position.set(.04, .08, 0); root.add(ring);
  }
  if (hands) {
    const sleeve = material(0x344d56);
    block(root, [.1, .1, .23], [.035, -.16, .16], sleeve);
    block(root, [.09, .09, .1], [.025, -.13, .015], skin);
    if (rifle) {
      block(root, [.1, .1, .22], [-.08, -.15, -.27], sleeve);
      block(root, [.09, .08, .1], [-.025, -.09, -.38], skin);
    }
  }
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(.09), new THREE.MeshBasicMaterial({ color: 0xffd180, transparent: true, opacity: .9, depthWrite: false }));
  flash.name = 'muzzle'; flash.position.set(0, .015, id === 'awp' ? -.95 : id === 'm4' ? -.9 : id === 'pistol' ? -.34 : -.8);
  flash.scale.set(.7, .7, 2.1); flash.visible = false; root.add(flash);
  return root;
}

export class Soldier {
  root = new THREE.Group();
  body = new THREE.Group();
  leftLeg = new THREE.Group();
  rightLeg = new THREE.Group();
  leftKnee = new THREE.Group();
  rightKnee = new THREE.Group();
  leftFoot = new THREE.Group();
  rightFoot = new THREE.Group();
  leftArm = new THREE.Group();
  rightArm = new THREE.Group();
  gun: THREE.Group;
  label: THREE.Sprite;
  flash = 0;
  death = 0;
  private gaitPhase = 0;
  private gaitAmount = 0;
  private crouchAmount = 0;
  private heldWeapon: WeaponId;

  constructor(team: Team, name: string, weapon: WeaponId) {
    this.heldWeapon = weapon;
    const uniform = material(team === 'blue' ? 0x405a64 : 0x82644e);
    const accent = material(TEAM_COLOR[team]);
    this.root.add(this.body);
    const torso = block(this.body, [.43, .49, .27], [0, 1.12, 0], uniform);
    torso.userData.head = false;
    block(this.body, [.37, .32, .075], [0, 1.14, -.16], dark);
    for (const x of [-.12, 0, .12]) block(this.body, [.085, .12, .05], [x, 1.07, -.21], olive);
    block(this.body, [.38, .075, .29], [0, .87, 0], dark);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 1), skin);
    head.position.set(0, 1.56, -.015); head.scale.set(.85, 1.08, .9); head.userData.head = true; this.body.add(head);
    const helmet = block(this.body, [.32, .15, .3], [0, 1.68, 0], uniform); helmet.userData.head = true;
    const visor = block(this.body, [.26, .065, .04], [0, 1.58, -.16], dark); visor.userData.head = true;
    block(this.body, [.36, .04, .32], [0, 1.625, -.015], uniform).userData.head = true;
    this.leftLeg.position.set(-.13, .84, 0); this.rightLeg.position.set(.13, .84, 0);
    for (const [leg, knee, foot] of [[this.leftLeg, this.leftKnee, this.leftFoot], [this.rightLeg, this.rightKnee, this.rightFoot]]) {
      block(leg, [.16, .38, .19], [0, -.19, 0], uniform);
      knee.position.y = -.41; leg.add(knee);
      block(knee, [.14, .36, .17], [0, -.18, 0], uniform);
      block(knee, [.17, .11, .045], [0, -.01, -.095], dark);
      foot.position.y = -.39; knee.add(foot);
      block(foot, [.17, .12, .29], [0, -.045, -.065], dark);
      this.body.add(leg);
    }
    this.leftArm.position.set(-.28, 1.32, 0); this.rightArm.position.set(.28, 1.32, 0);
    for (const arm of [this.leftArm, this.rightArm]) {
      block(arm, [.14, .27, .16], [0, -.12, 0], uniform);
      block(arm, [.15, .08, .17], [0, -.055, 0], accent);
      block(arm, [.12, .13, .28], [0, -.24, -.1], uniform);
      block(arm, [.11, .1, .11], [0, -.24, -.27], skin);
      arm.rotation.x = -.35; this.body.add(arm);
    }
    this.gun = weaponModel(weapon); this.gun.position.set(.17, 1.03, -.35); this.body.add(this.gun);
    // Held equipment is not a damage hitbox (including the invisible muzzle flash).
    this.gun.traverse(o => { if (o instanceof THREE.Mesh) o.raycast = () => {}; });
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#a9def0'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'; ctx.fillText(name.toUpperCase(), 128, 32);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: true }));
    this.label.position.y = 2.05; this.label.scale.set(1.2, .23, 1); this.label.visible = team === 'blue'; this.root.add(this.label);
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  resetPose() {
    this.death = this.flash = this.gaitPhase = this.gaitAmount = this.crouchAmount = 0;
    this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0);
  }

  equip(id: WeaponId) {
    if (this.heldWeapon === id) return;
    this.heldWeapon = id;
    this.body.remove(this.gun);
    // Geometry belongs to this model; most materials are shared across operators.
    this.gun.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.gun = weaponModel(id); this.gun.position.set(.17, 1.03, -.35);
    this.gun.traverse(o => { o.userData.actor = this.root.userData.actor; if (o instanceof THREE.Mesh) o.raycast = () => {}; });
    this.body.add(this.gun);
  }

  animate(dt: number, motion: Point, alive: boolean, reloading: boolean, grounded: boolean, crouched: boolean, deathAge = 0, deathHead = false, awpShotAge = Infinity) {
    this.flash = Math.max(0, this.flash - dt);
    this.gun.getObjectByName('muzzle')!.visible = this.flash > 0 && alive;
    this.death = alive ? 0 : clamp(deathAge / (deathHead ? .65 : .8), 0, 1);
    const fall = this.death * this.death * (3 - 2 * this.death);
    this.body.rotation.z = deathHead ? 0 : -fall * .18;
    this.label.visible = alive && this.label.userData.enabled !== false;
    const speed = Math.hypot(motion.x, motion.z);
    const blend = 1 - Math.exp(-dt * 14);
    this.gaitAmount += ((alive && grounded ? clamp(speed / 4.5, 0, 1) : 0) - this.gaitAmount) * blend;
    this.crouchAmount += ((crouched && alive ? 1 : 0) - this.crouchAmount) * blend;
    // Advance from actual distance travelled: blocked or stationary actors don't march in place.
    if (alive && grounded) this.gaitPhase = (this.gaitPhase + speed * dt / 2.6) % 1;
    const yaw = this.root.rotation.y;
    const forward = speed > .05 ? -(motion.x * Math.sin(yaw) + motion.z * Math.cos(yaw)) / speed : 1;
    const sideways = speed > .05 ? (motion.x * Math.cos(yaw) - motion.z * Math.sin(yaw)) / speed : 0;
    const bob = (1 - Math.cos(this.gaitPhase * Math.PI * 4)) * .009 * this.gaitAmount;
    this.body.position.y = alive ? -this.crouchAmount * CROUCH_DROP + bob : fall * .18;
    this.body.rotation.x = alive ? .04 * this.gaitAmount + this.crouchAmount * .12 : fall * Math.PI / 2;
    const legs = [[this.leftLeg, this.leftKnee, this.leftFoot], [this.rightLeg, this.rightKnee, this.rightFoot]];
    legs.forEach(([leg, knee, foot], index) => {
      const target = footTarget(this.gaitPhase + index * .5, this.gaitAmount, forward, sideways, this.crouchAmount, bob);
      if (!grounded && alive) { target.y += .13; target.z = index ? .12 : -.12; }
      const pose = solveLeg(target.x, target.y, target.z);
      leg.rotation.set(pose.hip, 0, pose.roll); knee.rotation.x = pose.knee;
      foot.rotation.set(pose.ankle, 0, -pose.roll);
    });
    this.gun.rotation.x = reloading ? -.55 : -this.flash * 2;
    this.gun.position.z = -.35;
    if (this.heldWeapon === 'awp') {
      const pose = awpAction(awpShotAge);
      this.gun.position.z += pose.kick * .1;
      if (!reloading) this.gun.rotation.x -= pose.kick * .1;
      animateBolt(this.gun, awpShotAge);
    }
    this.rightArm.rotation.x = reloading ? .1 : -.35;
    this.leftArm.rotation.x = -.35 + Math.sin(this.gaitPhase * Math.PI * 2) * .04 * this.gaitAmount;
  }
}

export function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) geometries.add(object.geometry);
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  // Shared weapon materials are intentionally retained across matches.
  const shared = new Set<THREE.Material>([steel, dark, wood, skin, olive]);
  for (const mat of materials) {
    if (shared.has(mat)) continue;
    if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
    mat.dispose();
  }
}
