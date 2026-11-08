import RAPIER from '@dimforge/rapier3d-compat';
import type { Arena } from './maps';
import type { Point } from './math';
import { FIXED_DT } from './config';

export class Physics {
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });

  constructor(arena: Arena) {
    this.world.timestep = FIXED_DT;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(arena.width, .5, arena.depth).setTranslation(0, -.5, 0).setCollisionGroups(0x0001ffff));
    for (const b of arena.boxes) this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.y, b.z).setCollisionGroups(0x0001ffff));
    this.world.step();
  }

  character(point: Point) { return new CharacterBody(this.world, point); }

  grenade(position: { x: number; y: number; z: number }, velocity: { x: number; y: number; z: number }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.ball(.11).setRestitution(.42).setFriction(.7).setDensity(4).setCollisionGroups(0x00040001), body);
    body.setLinvel(velocity, true);
    body.setAngvel({ x: 5, y: 2, z: 1 }, true);
    return body;
  }

  dispose() { this.world.free(); }
}

export class CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  grounded = false;
  height = .86;
  crouched = false;

  constructor(private world: RAPIER.World, point: Point) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(point.x, this.height + .04, point.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(.54, .32).setCollisionGroups(0x00020001), this.body);
    this.controller = world.createCharacterController(.025);
    this.controller.enableAutostep(.28, .3, false);
    this.controller.enableSnapToGround(.18);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
  }

  position() {
    const p = this.body.translation();
    return { x: p.x, y: p.y - this.height, z: p.z };
  }

  teleport(point: Point) {
    const p = { x: point.x, y: this.height + .05, z: point.z };
    this.body.setTranslation(p, true); this.body.setNextKinematicTranslation(p);
    this.grounded = false;
  }

  crouch(enabled: boolean) {
    if (enabled === this.crouched) return;
    // Prevent standing through a low ceiling (all launch maps have ample headroom).
    const feet = this.position();
    this.crouched = enabled; this.height = enabled ? .59 : .86;
    this.collider.setShape(new RAPIER.Capsule(enabled ? .27 : .54, .32));
    this.body.setTranslation({ x: feet.x, y: feet.y + this.height, z: feet.z }, true);
  }

  move(x: number, y: number, z: number) {
    // Characters use steering separation, rather than physically obstructing one another.
    this.controller.computeColliderMovement(this.collider, { x, y, z }, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, 0x00020001);
    const delta = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z });
    this.grounded = this.controller.computedGrounded();
  }

  enabled(on: boolean) { this.body.setEnabled(on); }
}

export async function initPhysics() { await RAPIER.init(); }
