import { describe, expect, it } from 'vitest';
import { SOUND_PACKS } from '../src/audio';

describe('gunshot sound packs', () => {
  it('offers three genuinely different synthesis profiles', () => {
    const packs = Object.values(SOUND_PACKS);
    expect(packs).toHaveLength(3);
    expect(new Set(packs.map(p => p.waveform)).size).toBe(3);
    expect(new Set(packs.map(p => p.cutoff)).size).toBe(3);
    expect(new Set(packs.map(p => p.duration)).size).toBe(3);
    expect(SOUND_PACKS.punchy.tail).toBe(true);
    expect(SOUND_PACKS.suppressed.gain).toBeLessThan(SOUND_PACKS.classic.gain);
  });
  it('keeps every profile within valid audio parameter ranges', () => {
    for (const pack of Object.values(SOUND_PACKS)) {
      expect(pack.duration).toBeGreaterThan(0); expect(pack.pitch).toBeGreaterThan(0);
      expect(pack.gain).toBeGreaterThan(0); expect(pack.gain).toBeLessThanOrEqual(1);
      expect(pack.cutoff * 3200).toBeLessThan(22050);
    }
  });
});
