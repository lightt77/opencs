import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { awpAction } from '../src/weapon-animation';
import { View } from '../src/view';

describe('AWP bolt-action animation', () => {
  it('kicks rearward immediately, cycles the bolt, and fully settles', () => {
    expect(awpAction(0).kick).toBe(1); expect(awpAction(.1).kick).toBeGreaterThan(0);
    expect(awpAction(.4).bolt).toBe(1); expect(awpAction(.4).cycle).toBeGreaterThan(.9);
    expect(awpAction(.8)).toEqual({ kick: 0, cycle: 0, bolt: 0 });
    expect(awpAction(Infinity)).toEqual({ kick: 0, cycle: 0, bolt: 0 });
  });
  it('moves the actual AWP model more than rifles and resets the bolt after recovery', () => {
    const view = Object.assign(Object.create(View.prototype) as View, { weapon: new Group() });
    view.equip('ak'); view.animateWeapon(0, 0, 1, 0, 0, true, false, false);
    const rifleZ = view.weapon.position.z;
    view.equip('awp'); view.animateWeapon(0, 0, 1, 0, 0, true, false, false, 0);
    expect(view.weapon.position.z).toBeGreaterThan(rifleZ + .1);
    view.animateWeapon(.4, 0, 0, 0, 0, false, false, false, .4);
    const bolt = view.weapon.getObjectByName('awp-bolt')!;
    expect(bolt.position.z).toBeCloseTo(.11); expect(bolt.rotation.z).toBeLessThan(-.8);
    view.animateWeapon(1, 0, 0, 0, 0, false, false, false, 1);
    expect(bolt.position.z).toBe(0); expect(bolt.rotation.z).toBeCloseTo(0); expect(view.weapon.position.z).toBeCloseTo(-.48);
  });
});
