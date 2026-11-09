export type BotSkill = 'low' | 'mid' | 'high';
export type BotTrait = 'low' | 'high';
export interface BotProfile {
  id: string; name: string; skill: BotSkill; coop: BotTrait; bravery: BotTrait; enabled: boolean;
}

export const BOT_PROFILES: readonly BotProfile[] = [
  { id: 'vanguard', name: 'Vanguard', skill: 'high', coop: 'high', bravery: 'high', enabled: true },
  { id: 'sentinel', name: 'Sentinel', skill: 'high', coop: 'high', bravery: 'low', enabled: true },
  { id: 'hunter', name: 'Hunter', skill: 'high', coop: 'low', bravery: 'high', enabled: true },
  { id: 'shade', name: 'Shade', skill: 'high', coop: 'low', bravery: 'low', enabled: true },
  { id: 'wingman', name: 'Wingman', skill: 'mid', coop: 'high', bravery: 'high', enabled: true },
  { id: 'anchor', name: 'Anchor', skill: 'mid', coop: 'high', bravery: 'low', enabled: true },
  { id: 'raider', name: 'Raider', skill: 'mid', coop: 'low', bravery: 'high', enabled: true },
  { id: 'lurker', name: 'Lurker', skill: 'mid', coop: 'low', bravery: 'low', enabled: true },
  { id: 'rookie', name: 'Rookie', skill: 'low', coop: 'high', bravery: 'low', enabled: true },
  { id: 'hothead', name: 'Hothead', skill: 'low', coop: 'low', bravery: 'high', enabled: true },
];

export function sanitizeProfiles(value: unknown): BotProfile[] {
  const profiles = BOT_PROFILES.map(base => {
    const raw = Array.isArray(value) ? value.find(p => p && p.id === base.id) : undefined;
    return { ...base,
      skill: ['low', 'mid', 'high'].includes(raw?.skill) ? raw.skill as BotSkill : base.skill,
      coop: ['low', 'high'].includes(raw?.coop) ? raw.coop as BotTrait : base.coop,
      bravery: ['low', 'high'].includes(raw?.bravery) ? raw.bravery as BotTrait : base.bravery,
      enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : base.enabled,
    };
  });
  if (!profiles.some(p => p.enabled)) profiles.forEach(p => { p.enabled = true; });
  return profiles;
}

// Draw without replacement; a small selected pool repeats only after every profile is used.
export function drawProfiles(profiles: readonly BotProfile[], count: number, random = Math.random): BotProfile[] {
  const pool = profiles.filter(p => p.enabled);
  const source = pool.length ? pool : BOT_PROFILES;
  const result: BotProfile[] = [];
  while (result.length < count) {
    const bag = [...source];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    result.push(...bag.slice(0, count - result.length).map(p => ({ ...p })));
  }
  return result;
}

export const profileLabel = (p: BotProfile) => `${p.name} · Skill ${p.skill.toUpperCase()} / Co-op ${p.coop.toUpperCase()} / Bravery ${p.bravery.toUpperCase()}`;
