import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, loadSettings } from '../src/config';

afterEach(() => vi.unstubAllGlobals());
function stored(value: unknown) { vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value) }); }

describe('saved settings', () => {
  it('migrates existing preferences with the original movement defaults', () => {
    stored({ map: 'india', volume: 25 });
    expect(loadSettings()).toEqual({ ...DEFAULTS, map: 'india', volume: 25 });
  });
  it('clamps movement modifiers and rejects invalid toggles', () => {
    stored({ movementSpeed: 999, jumpGravity: -1, doubleJump: 'true' });
    expect(loadSettings()).toMatchObject({ movementSpeed: 2, jumpGravity: 10, doubleJump: false });
    stored({ movementSpeed: '1.5', jumpGravity: '12' });
    expect(loadSettings()).toMatchObject({ movementSpeed: 1, jumpGravity: 20 });
  });
  it('restores valid custom movement values', () => {
    stored({ movementSpeed: 1.5, jumpGravity: 14, doubleJump: true, map: 'longshot' });
    expect(loadSettings()).toMatchObject({ movementSpeed: 1.5, jumpGravity: 14, doubleJump: true, map: 'longshot' });
  });
  it('restores known sound packs and safely rejects unknown pack IDs', () => {
    stored({ soundPack: 'punchy' }); expect(loadSettings().soundPack).toBe('punchy');
    stored({ soundPack: 'suppressed' }); expect(loadSettings().soundPack).toBe('suppressed');
    stored({ soundPack: 'custom' }); expect(loadSettings().soundPack).toBe('custom');
    stored({ soundPack: 'missing-pack' }); expect(loadSettings().soundPack).toBe('classic');
  });
});
