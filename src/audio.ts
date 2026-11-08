import type { SoundPack, WeaponId } from './config';
import type { Point } from './math';

export const SOUND_PACKS = {
  classic: { name: 'CLASSIC', description: 'Dry reports, a metallic edge, and an old-school low-end thump.', duration: 1, cutoff: 1, gain: 1, pitch: 1, waveform: 'triangle', tail: false, toneLevel: .65 },
  punchy: { name: 'PUNCHY', description: 'A sharp crack, heavier bass, and a short outdoor tail.', duration: .85, cutoff: 1.8, gain: .95, pitch: .7, waveform: 'sawtooth', tail: true, toneLevel: .32 },
  suppressed: { name: 'SUPPRESSED', description: 'Short, rounded shots with a soft mechanical pop.', duration: .5, cutoff: .28, gain: .6, pitch: 1.6, waveform: 'sine', tail: false, toneLevel: .3 },
} satisfies Record<SoundPack, { name: string; description: string; duration: number; cutoff: number; gain: number; pitch: number; waveform: OscillatorType; tail: boolean; toneLevel: number }>;

export class Sound {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private listener = { x: 0, z: 0, yaw: 0 };
  volume = .65;
  pack: SoundPack = 'classic';

  async unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -8; limiter.ratio.value = 6; limiter.attack.value = .002; limiter.release.value = .15;
        this.master.connect(limiter); limiter.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      await this.context.resume();
    } catch { /* The game remains playable without an audio device. */ }
  }

  listen(x: number, z: number, yaw: number) { this.listener = { x, z, yaw }; }

  private channel(position?: Point, loudness = 1) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    this.master.gain.value = this.volume * .55;
    const gain = ctx.createGain();
    const dx = (position?.x ?? this.listener.x) - this.listener.x;
    const dz = (position?.z ?? this.listener.z) - this.listener.z;
    const dist = Math.hypot(dx, dz);
    gain.gain.value = loudness / (1 + dist * .075);
    const pan = ctx.createStereoPanner();
    pan.pan.value = position ? Math.max(-1, Math.min(1, (dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw)) / Math.max(dist, 1))) : 0;
    gain.connect(pan); pan.connect(this.master);
    return { ctx, gain, dispose: () => { gain.disconnect(); pan.disconnect(); } };
  }

  private burst(duration: number, frequency: number, volume: number, position?: Point, tone = 100, color: { waveform?: OscillatorType; filterEnd?: number; toneLevel?: number } = {}) {
    const out = this.channel(position, volume);
    if (!out || !this.noise) return;
    const { ctx, gain } = out;
    const now = ctx.currentTime;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(.001, now);
    envelope.gain.linearRampToValueAtTime(1, now + .002);
    envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
    envelope.connect(gain);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, now);
    if (color.filterEnd) filter.frequency.exponentialRampToValueAtTime(color.filterEnd, now + duration);
    const source = ctx.createBufferSource(); source.buffer = this.noise;
    source.connect(filter); filter.connect(envelope); source.start(now, Math.random() * .3); source.stop(now + duration);
    const osc = ctx.createOscillator(); osc.type = color.waveform ?? 'triangle';
    osc.frequency.setValueAtTime(tone, now); osc.frequency.exponentialRampToValueAtTime(35, now + duration);
    const toneGain = ctx.createGain(); toneGain.gain.value = color.toneLevel ?? 1;
    osc.connect(toneGain); toneGain.connect(envelope); osc.start(now); osc.stop(now + duration);
    source.onended = () => { source.disconnect(); osc.disconnect(); toneGain.disconnect(); filter.disconnect(); envelope.disconnect(); out.dispose(); };
  }

  shot(id: WeaponId, position?: Point) {
    if (id === 'knife') return this.burst(.12, 900, .28, position, 250);
    const sniper = id === 'awp';
    const profile = SOUND_PACKS[this.pack];
    const frequency = (id === 'pistol' ? 3200 : id === 'ak' ? 2800 : id === 'm4' ? 2200 : 1900) * profile.cutoff;
    this.burst((sniper ? .55 : id === 'pistol' ? .13 : .19) * profile.duration, frequency, (sniper ? 1 : .7) * profile.gain, position, (sniper ? 95 : 160) * profile.pitch, { waveform: profile.waveform, filterEnd: frequency * .28, toneLevel: profile.toneLevel });
    if (profile.tail) this.burst(sniper ? .7 : .3, 550, sniper ? .2 : .09, position, 60, { waveform: 'sine', toneLevel: .25 });
  }
  async preview(id: WeaponId) { await this.unlock(); this.shot(id); }
  step(position?: Point, snow = false) { this.burst(.065, snow ? 1400 : 700, .13, position, 70); }
  reload() { this.burst(.14, 3600, .2, undefined, 260); }
  click() { this.burst(.045, 1800, .2, undefined, 400); }
  hit(head: boolean) { this.burst(.055, head ? 5500 : 2300, .24, undefined, head ? 1600 : 700); }
  explosion(position: Point) { this.burst(.9, 700, 1.4, position, 65); }
  flash(position: Point) { this.burst(.3, 6500, .55, position, 1900); }
}
