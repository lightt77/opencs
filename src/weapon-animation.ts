import type { Object3D } from 'three';
import { clamp } from './math';

export function awpAction(age: number) {
  const kick = age >= 0 && age < .24 ? (1 - age / .24) ** 2 : 0;
  const cycle = age > .14 && age < .72 ? Math.sin((age - .14) / .58 * Math.PI) : 0;
  return { kick, cycle, bolt: clamp((age - .2) / .12, 0, 1) * (1 - clamp((age - .45) / .15, 0, 1)) };
}

export function animateBolt(root: Object3D, age: number) {
  const bolt = root.getObjectByName('awp-bolt');
  if (!bolt) return;
  const pose = awpAction(age);
  bolt.position.z = pose.bolt * .11;
  bolt.rotation.z = -pose.cycle * .9;
}
