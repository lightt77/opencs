export type Team = 'blue' | 'red';
export type Mode = 'tdm' | 'elimination';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type MapId = 'dust' | 'snow' | 'india';
export type WeaponId = 'ak' | 'm4' | 'awp' | 'pistol' | 'knife' | 'he' | 'flash' | 'smoke';
export type Primary = 'ak' | 'm4' | 'awp';

export interface Settings {
  map: MapId; mode: Mode; difficulty: Difficulty; primary: Primary;
  sensitivity: number; volume: number; fov: number; shadows: boolean;
}

export const DEFAULTS: Settings = {
  map: 'dust', mode: 'tdm', difficulty: 'medium', primary: 'ak',
  sensitivity: 1, volume: 65, fov: 85, shadows: true,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem('opencs.settings') ?? '{}');
    return {
      map: ['dust', 'snow', 'india'].includes(raw.map) ? raw.map : DEFAULTS.map,
      mode: ['tdm', 'elimination'].includes(raw.mode) ? raw.mode : DEFAULTS.mode,
      difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : DEFAULTS.difficulty,
      primary: ['ak', 'm4', 'awp'].includes(raw.primary) ? raw.primary : DEFAULTS.primary,
      sensitivity: finiteRange(raw.sensitivity, .25, 2.5, 1),
      volume: finiteRange(raw.volume, 0, 100, 65),
      fov: finiteRange(raw.fov, 70, 105, 85),
      shadows: typeof raw.shadows === 'boolean' ? raw.shadows : true,
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
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  ak: { name: 'AK-47', short: 'AK', damage: 35, head: 3.2, interval: .105, magazine: 30, reserve: 90, reload: 2.35, spread: .002, recoil: .013, speed: 5.6, automatic: true, range: 110 },
  m4: { name: 'M4A1', short: 'M4', damage: 30, head: 3.2, interval: .09, magazine: 30, reserve: 90, reload: 2.15, spread: .0015, recoil: .009, speed: 5.7, automatic: true, range: 110 },
  awp: { name: 'AWP', short: 'AWP', damage: 115, head: 2, interval: 1.35, magazine: 5, reserve: 20, reload: 3.1, spread: .0008, recoil: .027, speed: 4.8, automatic: false, range: 140 },
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

export function isGrenade(id: WeaponId): id is 'he' | 'flash' | 'smoke' {
  return id === 'he' || id === 'flash' || id === 'smoke';
}

export function inventory(primary: Primary): WeaponId[] { return [primary, 'pistol', 'knife', 'he', 'flash', 'smoke']; }
