import * as THREE from 'three';
import type { Arena } from './maps';
import type { WeaponId } from './config';
import { block, disposeTree, weaponModel } from './models';
import { animateBolt, awpAction } from './weapon-animation';
import { BIOMES } from './biomes';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Effect { object: THREE.Object3D; life: number; total: number; grow?: number }

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(85, 1, .06, 180);
  level = new THREE.Group();
  solids: THREE.Object3D[] = [];
  weaponScene = new THREE.Scene();
  weaponCamera = new THREE.PerspectiveCamera(65, 1, .01, 10);
  weapon = new THREE.Group();
  private effects: Effect[] = [];
  private sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private snow?: THREE.Points;
  private currentWeapon?: WeaponId;
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.autoClear = false;
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.level);
    this.ambient = new THREE.HemisphereLight(0xe3ebdf, 0x726e5e, 2.1); this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffedce, 3);
    this.sun.position.set(-24, 40, -17); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -43, right: 43, top: 43, bottom: -43, near: 1, far: 100 });
    this.sun.shadow.bias = -.0006; this.sun.shadow.normalBias = .025;
    this.scene.add(this.sun);
    this.weaponScene.add(new THREE.HemisphereLight(0xe8ebdc, 0x657079, 2.7));
    const key = new THREE.DirectionalLight(0xfff0da, 3); key.position.set(-2, 3, -1); this.weaponScene.add(key);
    this.weaponScene.add(this.weapon);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    for (const camera of [this.camera, this.weaponCamera]) { camera.aspect = this.width / this.height; camera.updateProjectionMatrix(); }
  }

  build(arena: Arena) {
    this.clearEffects(); disposeTree(this.level); this.level.clear(); this.solids = [];
    this.snow = undefined;
    const biome = BIOMES[arena.biome], snowy = arena.biome === 'snow';
    this.sun.color.setHex(biome.sun); this.ambient.color.setHex(biome.ambient); this.ambient.groundColor.setHex(arena.ground);
    this.scene.background = new THREE.Color(arena.sky);
    this.scene.fog = new THREE.Fog(arena.fog, arena.fogNear ?? 35, arena.viewDistance ?? 115);
    this.camera.far = Math.max(180, (arena.viewDistance ?? 115) + 100); this.camera.updateProjectionMatrix();
    const extent = Math.max(arena.width, arena.depth);
    const shadowReach = Math.max(43, extent * .65);
    this.sun.position.set(-extent * .36, extent * .61, -extent * .26);
    Object.assign(this.sun.shadow.camera, { left: -shadowReach, right: shadowReach, top: shadowReach, bottom: -shadowReach, far: extent * 2 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const texture = this.surfaceTexture(snowy);
    const floorTexture = texture.clone(); floorTexture.repeat.set(arena.width / 4, arena.depth / 4);
    floorTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const floorMat = new THREE.MeshStandardMaterial({ color: arena.ground, map: floorTexture, roughness: 1 });
    if (!arena.surface) {
      const floor = block(this.level, [arena.width, .2, arena.depth], [0, -.1, 0], floorMat);
      floor.castShadow = false; this.solids.push(floor);
    }
    const walls = new THREE.MeshStandardMaterial({ color: arena.wall, map: texture, roughness: .95 });
    const trim = new THREE.MeshStandardMaterial({ color: arena.accent, roughness: .95 });
    const crates = new THREE.MeshStandardMaterial({ color: snowy ? 0x64818a : 0x82734f, roughness: .9 });
    const seam = new THREE.MeshStandardMaterial({ color: snowy ? 0x425b62 : 0x584e36 });
    const colored = new Map<number, THREE.MeshStandardMaterial>();
    for (const b of arena.boxes) {
      if (b.color && !colored.has(b.color)) colored.set(b.color, new THREE.MeshStandardMaterial({ color: b.color }));
      const mat = b.color ? colored.get(b.color)! : b.kind === 'floor' ? floorMat : b.kind === 'crate' ? crates : walls;
      const mesh = block(this.level, [b.w, b.h, b.d], [b.x, b.y, b.z], mat); this.solids.push(mesh);
      mesh.rotation.y = b.rotY ?? 0;
      if (b.rotY) continue; // Avoid unrotated trim on rotated collision props.
      if (b.kind === 'crate') {
        for (const y of [-b.h * .35, b.h * .35]) block(this.level, [b.w + .025, .07, b.d + .025], [b.x, b.y + y, b.z], seam);
        block(this.level, [.07, b.h + .025, b.d + .025], [b.x, b.y, b.z], seam);
      } else if (b.kind === 'door') {
        for (const height of [.6, 1.6, 2.6].filter(h => h < b.h)) block(this.level, [b.w + .02, .09, b.d + .045], [b.x, b.y - b.h / 2 + height, b.z], seam);
        block(this.level, [.05, b.h, b.d + .025], [b.x, b.y, b.z], seam);
      } else if (b.kind === 'building') {
        block(this.level, [b.w + .22, .2, b.d + .22], [b.x, b.y + b.h / 2, b.z], trim);
        block(this.level, [b.w + .08, .28, b.d + .08], [b.x, .18, b.z], trim);
        if (snowy) block(this.level, [b.w + .35, .14, b.d + .35], [b.x, b.y + b.h / 2 + .16, b.z], floorMat);
        if (b.w > 5 && b.d > 5) {
          for (const side of [-1, 1]) {
            const faceZ = b.z + side * (b.d / 2 + .025);
            block(this.level, [1.25, 2.25, .04], [b.x, 1.13, faceZ], trim);
            block(this.level, [1.45, .17, .18], [b.x, 2.35, faceZ], trim);
            for (const offset of [-b.w * .3, b.w * .3]) {
              block(this.level, [1.2, .95, .045], [b.x + offset, 2.8, faceZ], seam);
              block(this.level, [1.4, .1, .18], [b.x + offset, 2.3, faceZ], trim);
              block(this.level, [.05, .95, .06], [b.x + offset, 2.8, faceZ + side * .01], trim);
            }
          }
        }
      }
    }
    // Inlaid floor seams and spawn-zone markings keep the simple geometry grounded.
    const lineMat = new THREE.MeshStandardMaterial({ color: snowy ? 0xb9ccd5 : arena.accent, transparent: true, opacity: .18 });
    const grid = extent > 100 ? 20 : 5;
    if (!arena.surface) {
      for (let z = -Math.floor(arena.depth / 2 / grid) * grid; z < arena.depth / 2; z += grid) block(this.level, [arena.width - 1, .006, .025], [0, .006, z], lineMat);
      for (let x = -Math.floor(arena.width / 2 / grid) * grid; x < arena.width / 2; x += grid) block(this.level, [.025, .006, arena.depth - 1], [x, .006, 0], lineMat);
    }
    for (const [p, color, label] of [[arena.blue[0], 0x70b9d5, 'BLUE / 01'], [arena.red[0], 0xdb8065, 'RED / 02']] as const) {
      const marking = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: .5 });
      block(this.level, [10, .01, .15], [p.x, (p.y ?? 0) + .015, p.z], marking);
      if (!arena.surface) this.sign(label, color, 0, 2.6, Math.sign(p.z) * (arena.depth / 2 - .56), p.z > 0 ? Math.PI : 0);
    }
    this.sign(arena.name, arena.accent, -arena.width / 2 + .57, 3.7, 0, Math.PI / 2);
    for (const site of arena.sites ?? []) this.floorLabel(site.label, site.x, site.z, site.y);
    if (arena.id === 'dust') {
      this.sign('A  →  LONG', 0xc89964, 15.95, 2.5, 19, -Math.PI / 2);
      this.sign('←  B  TUNNELS', 0xc89964, -15.95, 2.5, 23, Math.PI / 2);
      this.sign('MID  /  CT', 0xc89964, -6.95, 2.5, 0, Math.PI / 2);
    }
    if (arena.id === 'longshot') {
      for (let z = -180; z <= 180; z += 30) block(this.level, [.16, .012, 4], [0, .018, z], trim);
    }
    if (snowy) {
      const geo = new THREE.BufferGeometry(); const data = new Float32Array(900 * 3);
      for (let i = 0; i < data.length; i += 3) { data[i] = (Math.random() - .5) * arena.width; data[i + 1] = Math.random() * 16; data[i + 2] = (Math.random() - .5) * arena.depth; }
      geo.setAttribute('position', new THREE.BufferAttribute(data, 3));
      this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: .055, transparent: true, opacity: .65 })); this.level.add(this.snow);
    }
    // Non-colliding scenery is strictly outside the playable perimeter.
    if (['jungle', 'forest', 'canyon', 'coast'].includes(arena.biome) && !arena.surface) {
      const bark = new THREE.MeshStandardMaterial({ color: 0x675441 });
      const leaves = new THREE.MeshStandardMaterial({ color: arena.biome === 'jungle' ? 0x3a6547 : 0x38594b });
      for (let i = 0; i < 28; i++) {
        const side = i % 2 ? -1 : 1, x = side * (arena.width / 2 + 4 + i % 3 * 2), z = (i / 28 - .5) * arena.depth;
        if (arena.biome === 'canyon') block(this.level, [6 + i % 4, 8 + i % 5, 8], [x, 3, z], walls);
        else if (arena.biome === 'coast') block(this.level, [2, 7, 2], [x, 3, z], trim);
        else { block(this.level, [.7, 8, .7], [x, 4, z], bark); block(this.level, [4 + i % 3, 5, 4 + i % 3], [x, 8, z], leaves); }
      }
    }
    this.batchLevel();
  }

  private batchLevel() {
    // Many small stair tiles still render in a handful of material batches.
    this.level.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of this.level.children) if (child instanceof THREE.Mesh && !Array.isArray(child.material) && !child.material.transparent) {
      const list = groups.get(child.material) ?? []; list.push(child); groups.set(child.material, list);
    }
    this.solids = [];
    for (const [material, meshes] of groups) {
      const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrix));
      const geometry = mergeGeometries(geometries);
      geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      for (const mesh of meshes) { this.level.remove(mesh); mesh.geometry.dispose(); }
      const batch = new THREE.Mesh(geometry, material); batch.castShadow = batch.receiveShadow = true;
      this.level.add(batch); this.solids.push(batch);
    }
  }

  private surfaceTexture(snow: boolean) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e5e1d8'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(65,60,45,${Math.random() * (snow ? .05 : .1)})`;
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 3); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private sign(text: string, color: number, x: number, y: number, z: number, rotation: number) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#202a25'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = '#e9e8d7'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 80);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 1 }));
    mesh.position.set(x, y, z); mesh.rotation.y = rotation; this.level.add(mesh);
  }

  private floorLabel(text: string, x: number, z: number, y = 0) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#a25435'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 232, 232);
    ctx.fillStyle = '#a25435'; ctx.font = 'bold 180px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 190);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: .8, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y + .025, z); this.level.add(mesh);
  }

  equip(id: WeaponId) {
    if (id === this.currentWeapon) return;
    disposeTree(this.weapon); this.weapon.clear(); this.weapon.add(weaponModel(id, true)); this.currentWeapon = id;
  }

  animateWeapon(time: number, speed: number, kick: number, reload: number, switching: number, firing: boolean, knife: boolean, crouched: boolean, awpShotAge = Infinity) {
    const bob = Math.min(speed / 6, 1);
    this.weapon.position.set(.26 + Math.sin(time * 8) * .008 * bob, -.26 - (crouched ? .025 : 0) + Math.abs(Math.cos(time * 8)) * .012 * bob - Math.sin(reload * Math.PI) * .23 - switching * .3, -.48 + kick * .065);
    this.weapon.rotation.set(-kick * .07 + Math.sin(reload * Math.PI) * .4, -.025, Math.sin(reload * Math.PI) * -.4);
    if (this.currentWeapon === 'awp') {
      const pose = awpAction(awpShotAge);
      this.weapon.position.z += pose.kick * .15;
      this.weapon.position.y += pose.kick * .035 - pose.cycle * .035;
      this.weapon.rotation.x -= pose.kick * .12;
      this.weapon.rotation.z += pose.cycle * .075;
      animateBolt(this.weapon, awpShotAge);
    }
    if (knife && kick > 0) { this.weapon.rotation.z -= kick * .7; this.weapon.position.x -= kick * .3; }
    const muzzle = this.weapon.getObjectByName('muzzle');
    if (muzzle) { muzzle.visible = firing; muzzle.rotation.z = time * 67; }
  }

  impact(position: THREE.Vector3, blood = false) {
    const object = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: blood ? 0xb86652 : 0xf2dd9b });
    for (let i = 0; i < 5; i++) {
      const particle = new THREE.Mesh(new THREE.BoxGeometry(.025, .025, .025), mat);
      particle.position.set((Math.random() - .5) * .2, (Math.random() - .5) * .2, (Math.random() - .5) * .2); object.add(particle);
    }
    object.position.copy(position); this.scene.add(object); this.effects.push({ object, life: .16, total: .16, grow: 5 });
  }

  tracer(start: THREE.Vector3, end: THREE.Vector3) {
    const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0xffe2a2, transparent: true, opacity: .22 }));
    this.scene.add(object); this.effects.push({ object, life: .045, total: .045 });
  }

  explosion(position: THREE.Vector3) {
    const object = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffad55, transparent: true, opacity: .75, depthWrite: false }));
    object.position.copy(position); this.scene.add(object); this.effects.push({ object, life: .4, total: .4, grow: 8 });
  }

  smoke(position: THREE.Vector3) {
    const object = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbac1b7, transparent: true, opacity: .8, roughness: 1, depthWrite: false });
    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.65, 1), mat);
      const angle = i * 2.4; const radius = Math.sqrt(i / 18) * 2.5;
      mesh.position.set(Math.cos(angle) * radius, .5 + Math.random() * 2, Math.sin(angle) * radius); object.add(mesh);
    }
    object.position.copy(position); this.scene.add(object); this.effects.push({ object, life: 12, total: 12 });
  }

  updateEffects(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]; effect.life -= dt;
      if (effect.grow) effect.object.scale.setScalar(1 + (effect.total - effect.life) * effect.grow);
      if (effect.total > 2) {
        effect.object.scale.setScalar(Math.min(1, (effect.total - effect.life) * 2, effect.life / 2));
      }
      if (effect.life <= 0) { this.scene.remove(effect.object); disposeTree(effect.object); this.effects.splice(i, 1); }
    }
    if (this.snow) {
      const attr = this.snow.geometry.getAttribute('position');
      for (let i = 0; i < attr.count; i++) { let y = attr.getY(i) - dt * .65; if (y < 0) y = 16; attr.setY(i, y); }
      attr.needsUpdate = true;
    }
  }

  clearEffects() {
    for (const effect of this.effects) { this.scene.remove(effect.object); disposeTree(effect.object); }
    this.effects = [];
  }

  render(showWeapon: boolean) {
    this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    if (showWeapon) { this.renderer.clearDepth(); this.renderer.render(this.weaponScene, this.weaponCamera); }
  }
}
