import { describe, expect, it } from 'vitest';
import { MAX_SAMPLE_BYTES, validateAudioFile, validateDecodedShot } from '../src/custom-audio';
import { soundPackDescription } from '../src/audio';

describe('custom sample validation', () => {
  it('accepts individual WAV, MP3, and OGG files, including uppercase extensions', () => {
    for (const name of ['ak.wav', 'm4.MP3', 'awp.ogg']) expect(() => validateAudioFile({ name, size: 1000 })).not.toThrow();
  });
  it('rejects archives, scripts, empty files, and oversized inputs', () => {
    for (const name of ['sounds.zip', 'sound.js', 'shot.wav.exe']) expect(() => validateAudioFile({ name, size: 1000 })).toThrow();
    for (const size of [0, -1, NaN, Infinity, MAX_SAMPLE_BYTES + 1]) expect(() => validateAudioFile({ name: 'ak.wav', size })).toThrow();
  });
  it('limits decoded samples to short mono/stereo audio', () => {
    expect(() => validateDecodedShot(.1, 1)).not.toThrow(); expect(() => validateDecodedShot(5, 2)).not.toThrow();
    for (const duration of [0, NaN, Infinity, 5.01]) expect(() => validateDecodedShot(duration, 1)).toThrow();
    for (const channels of [0, 3, 1.5, NaN]) expect(() => validateDecodedShot(.2, channels)).toThrow();
  });
  it('explains missing-file fallback rather than promising silence or a complete pack', () => {
    expect(soundPackDescription('custom')).toContain('fall back to Classic');
  });
});
