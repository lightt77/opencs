import { RADIO_LINES, radioText, type RadioEvent } from './audio-assets';

// No queued stale callouts: one voice at a time, event cooldowns, victories take priority.
export class Radio {
  enabled = true;
  message?: { speaker: string; text: string; clip: string; event: RadioEvent; until: number };
  private busyUntil = 0;
  private cooldowns = new Map<RadioEvent, number>();
  private previous = new Map<RadioEvent, string>();
  readonly observedDeaths = new Set<number>();

  constructor(private play: (clip: string, priority: boolean) => number) {}

  reset() {
    this.message = undefined; this.busyUntil = 0; this.cooldowns.clear(); this.observedDeaths.clear();
  }

  say(event: RadioEvent, speaker: string, time: number, priority = false, random = Math.random) {
    if (!this.enabled || (!priority && (time < this.busyUntil || time < (this.cooldowns.get(event) ?? 0)))) return false;
    const options = RADIO_LINES[event].filter(clip => clip !== this.previous.get(event));
    const clip = options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? RADIO_LINES[event][0];
    const duration = this.play(clip, priority) || 1.5;
    this.previous.set(event, clip);
    this.message = { speaker, text: radioText(clip), clip, event, until: time + duration + .6 };
    this.busyUntil = time + duration + 1.25;
    this.cooldowns.set(event, time + (event === 'overwhelmed' ? 16 : event === 'friendlyFire' ? 6 : 7));
    return true;
  }
}
