export type Team = 'blue' | 'red';
export type Mode = 'tdm' | 'elimination';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type MapId = 'dust' | 'snow' | 'india' | 'longshot';
export type WeaponId = 'ak' | 'm4' | 'awp' | 'pistol' | 'knife' | 'he' | 'flash' | 'smoke';
export type Primary = 'ak' | 'm4' | 'awp';
export type BuiltinSoundPack = 'classic' | 'punchy' | 'suppressed';
export type SoundPack = BuiltinSoundPack | 'custom' | 'assets';
export type FirearmId = 'ak' | 'm4' | 'awp' | 'pistol';

export interface Settings {
  map: MapId; mode: Mode; difficulty: Difficulty; primary: Primary;
  sensitivity: number; volume: number; fov: number; shadows: boolean;
  movementSpeed: number; doubleJump: boolean; jumpGravity: number;
  soundPack: SoundPack;
  freezeTime: number; roundEndDelay: number;
  effectsPack: 'classic' | 'assets'; radioChatter: boolean; radioVolume: number;
  allowedWeapons: WeaponId[]; grenadeCapacity: number; refillDelay: number;
  wallShots: 'off' | 'thin' | 'walls';
}

export const DEFAULTS: Settings = {
  map: 'dust', mode: 'tdm', difficulty: 'medium', primary: 'ak',
  sensitivity: 1, volume: 65, fov: 85, shadows: true,
  movementSpeed: 1, doubleJump: false, jumpGravity: 20,
  soundPack: 'classic',
  freezeTime: 3, roundEndDelay: 2.5,
  effectsPack: 'assets', radioChatter: true, radioVolume: 70,
  allowedWeapons: ['ak', 'm4', 'awp', 'pistol', 'knife', 'he', 'flash', 'smoke'],
  grenadeCapacity: 3, refillDelay: 10, wallShots: 'walls',
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem('opencs.settings') ?? '{}');
    return {
      map: ['dust', 'snow', 'india', 'longshot'].includes(raw.map) ? raw.map : DEFAULTS.map,
      mode: ['tdm', 'elimination'].includes(raw.mode) ? raw.mode : DEFAULTS.mode,
      difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : DEFAULTS.difficulty,
      primary: ['ak', 'm4', 'awp'].includes(raw.primary) ? raw.primary : DEFAULTS.primary,
      sensitivity: finiteRange(raw.sensitivity, .25, 2.5, 1),
      volume: finiteRange(raw.volume, 0, 100, 65),
      fov: finiteRange(raw.fov, 70, 105, 85),
      shadows: typeof raw.shadows === 'boolean' ? raw.shadows : true,
      movementSpeed: finiteRange(raw.movementSpeed, .5, 2, DEFAULTS.movementSpeed),
      doubleJump: typeof raw.doubleJump === 'boolean' ? raw.doubleJump : DEFAULTS.doubleJump,
      jumpGravity: finiteRange(raw.jumpGravity, 10, 35, DEFAULTS.jumpGravity),
      soundPack: ['classic', 'punchy', 'suppressed', 'custom', 'assets'].includes(raw.soundPack) ? raw.soundPack : DEFAULTS.soundPack,
      freezeTime: finiteRange(raw.freezeTime, 0, 10, DEFAULTS.freezeTime),
      roundEndDelay: finiteRange(raw.roundEndDelay, 0, 6, DEFAULTS.roundEndDelay),
      effectsPack: raw.effectsPack === 'classic' ? 'classic' : DEFAULTS.effectsPack,
      radioChatter: typeof raw.radioChatter === 'boolean' ? raw.radioChatter : DEFAULTS.radioChatter,
      radioVolume: finiteRange(raw.radioVolume, 0, 100, DEFAULTS.radioVolume),
      allowedWeapons: sanitizeWeapons(raw.allowedWeapons),
      grenadeCapacity: Math.round(finiteRange(raw.grenadeCapacity, 1, 3, 3)),
      refillDelay: finiteRange(raw.refillDelay, 1, 30, 10),
      wallShots: ['off', 'thin', 'walls'].includes(raw.wallShots) ? raw.wallShots : DEFAULTS.wallShots,
    };
  } catch { return { ...DEFAULTS }; }
}

function finiteRange(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export interface WeaponSpec {
  name: string; short: string; damage: number; head: number; interval: number;
  magazine: number; reserve: number; reload: number; spread: number;
  recoil: number; speed: number; automatic: boolean; range: number;
  falloff?: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  ak: { name: 'AK-47', short: 'AK', damage: 35, head: 3.2, interval: .105, magazine: 30, reserve: 90, reload: 2.35, spread: .002, recoil: .013, speed: 5.6, automatic: true, range: 110 },
  m4: { name: 'M4A1', short: 'M4', damage: 30, head: 3.2, interval: .09, magazine: 30, reserve: 90, reload: 2.15, spread: .0015, recoil: .009, speed: 5.7, automatic: true, range: 110 },
  awp: { name: 'AWP', short: 'AWP', damage: 115, head: 2, interval: 1.35, magazine: 5, reserve: 20, reload: 3.1, spread: .0008, recoil: .027, speed: 4.8, automatic: false, range: 700, falloff: 6000 },
  pistol: { name: 'USP', short: 'USP', damage: 26, head: 3, interval: .22, magazine: 12, reserve: 48, reload: 1.65, spread: .003, recoil: .014, speed: 6, automatic: false, range: 80 },
  knife: { name: 'FIELD KNIFE', short: 'KNIFE', damage: 55, head: 1, interval: .48, magazine: 1, reserve: 0, reload: 0, spread: 0, recoil: 0, speed: 6.5, automatic: false, range: 2.3 },
  he: { name: 'HE GRENADE', short: 'HE', damage: 95, head: 1, interval: 1, magazine: 1, reserve: 0, reload: 0, spread: 0, recoil: 0, speed: 6, automatic: false, range: 25 },
  flash: { name: 'FLASHBANG', short: 'FLASH', damage: 0, head: 1, interval: 1, magazine: 1, reserve: 0, reload: 0, spread: 0, recoil: 0, speed: 6, automatic: false, range: 25 },
  smoke: { name: 'SMOKE GRENADE', short: 'SMOKE', damage: 0, head: 1, interval: 1, magazine: 1, reserve: 0, reload: 0, spread: 0, recoil: 0, speed: 6, automatic: false, range: 25 },
};

export const BOT_SKILL = {
  easy: { reaction: .8, error: .085, tracking: 2.5, burst: 3 },
  medium: { reaction: .43, error: .037, tracking: 4.5, burst: 5 },
  hard: { reaction: .24, error: .014, tracking: 7, burst: 7 },
};

export const TEAM_COLOR = { blue: 0x70b9d5, red: 0xdb8065 };
export const FIXED_DT = 1 / 60;
export const TDM_LIMIT = 40;
export const MATCH_SECONDS = 360;
export const ROUND_SECONDS = 100;
export const ROUND_LIMIT = 5;
export const AWP_QUICK_INTERVAL = .7;

export function isGrenade(id: WeaponId): id is 'he' | 'flash' | 'smoke' {
  return id === 'he' || id === 'flash' || id === 'smoke';
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const PRIMARIES: Primary[] = ['ak', 'm4', 'awp'];

export function sanitizeWeapons(value: unknown): WeaponId[] {
  const allowed = Array.isArray(value) ? WEAPON_IDS.filter(id => value.includes(id)) : [];
  return allowed.length ? allowed : [...DEFAULTS.allowedWeapons];
}

export function inventory(primary: Primary, allowed: readonly WeaponId[] = WEAPON_IDS): WeaponId[] {
  const selected = allowed.includes(primary) ? primary : PRIMARIES.find(id => allowed.includes(id));
  return [...(selected ? [selected] : []), ...WEAPON_IDS.filter(id => !PRIMARIES.includes(id as Primary) && allowed.includes(id))];
}

// Three slots total; restricted grenade sets redistribute the slots, never exceed capacity.
export function grenadeLoadout(allowed: readonly WeaponId[], capacity: number) {
  const types = (['he', 'flash', 'smoke'] as const).filter(id => allowed.includes(id));
  const counts = { he: 0, flash: 0, smoke: 0 };
  for (let i = 0; types.length && i < Math.min(3, Math.max(1, Math.round(capacity))); i++) counts[types[i % types.length]]++;
  return counts;
}
