import type { WeaponId } from './config';
import type { Point } from './math';

export class Sound {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private listener = { x: 0, z: 0, yaw: 0 };
  volume = .65;

  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.master.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      void this.context.resume().catch(() => {});
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

  private burst(duration: number, frequency: number, volume: number, position?: Point, tone = 100) {
    const out = this.channel(position, volume);
    if (!out || !this.noise) return;
    const { ctx, gain } = out;
    const now = ctx.currentTime;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(.001, now);
    envelope.gain.linearRampToValueAtTime(1, now + .002);
    envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
    envelope.connect(gain);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = frequency;
    const source = ctx.createBufferSource(); source.buffer = this.noise;
    source.connect(filter); filter.connect(envelope); source.start(now, Math.random() * .3); source.stop(now + duration);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(tone, now); osc.frequency.exponentialRampToValueAtTime(35, now + duration);
    osc.connect(envelope); osc.start(now); osc.stop(now + duration);
    source.onended = () => { filter.disconnect(); envelope.disconnect(); out.dispose(); };
  }

  shot(id: WeaponId, position?: Point) {
    if (id === 'knife') return this.burst(.12, 900, .28, position, 250);
    const sniper = id === 'awp';
    this.burst(sniper ? .55 : .19, id === 'pistol' ? 3200 : 2400, sniper ? 1 : .7, position, sniper ? 95 : 160);
  }
  step(position?: Point, snow = false) { this.burst(.065, snow ? 1400 : 700, .13, position, 70); }
  reload() { this.burst(.14, 3600, .2, undefined, 260); }
  click() { this.burst(.045, 1800, .2, undefined, 400); }
  hit(head: boolean) { this.burst(.055, head ? 5500 : 2300, .24, undefined, head ? 1600 : 700); }
  explosion(position: Point) { this.burst(.9, 700, 1.4, position, 65); }
  flash(position: Point) { this.burst(.3, 6500, .55, position, 1900); }
}
