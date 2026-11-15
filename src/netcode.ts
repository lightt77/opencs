// LAN netcode helpers: guest movement validation, snapshot interpolation and a
// background-safe tick source. Kept free of game/DOM state so they are unit-testable.

export type Vec3 = [number, number, number];

// The host accepts a guest's self-simulated position when it is reachable from the
// host's last known position in the elapsed time. Friendly-LAN trust with a speed clamp:
// it stops teleports/speed hacks and wildly desynced clients, not subtle cheating.
export function acceptMove(previous: { x: number; y: number; z: number }, proposed: Vec3, maxSpeed: number, elapsed: number): boolean {
  if (!proposed.every(Number.isFinite)) return false;
  const t = Math.min(.3, Math.max(1 / 60, elapsed));
  const horizontal = Math.hypot(proposed[0] - previous.x, proposed[2] - previous.z);
  return horizontal <= maxSpeed * 1.35 * t + .6 && Math.abs(proposed[1] - previous.y) <= 36 * t + 1.2;
}

const angleLerp = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Stores recent host snapshots (keyed by host simulation time) and samples remote actors
// slightly in the past, so 30 Hz snapshots with network jitter render as smooth motion.
export class SnapshotBuffer {
  private frames: Array<{ time: number; actors: Array<[number, number, number, number]> }> = [];
  private offset?: number;
  constructor(readonly delay = .1, readonly capacity = 32) {}

  clear() { this.frames = []; this.offset = undefined; }

  push(hostTime: number, actors: Array<[number, number, number, number]>, localSeconds: number) {
    const last = this.frames.at(-1);
    if (last && hostTime < last.time) this.clear(); // host restarted the clock (new match)
    else if (last && hostTime === last.time) return;
    this.frames.push({ time: hostTime, actors });
    if (this.frames.length > this.capacity) this.frames.shift();
    // Track the earliest arrival: delayed packets must not pull the clock backwards.
    const offset = localSeconds - hostTime;
    this.offset = this.offset === undefined || offset < this.offset ? offset : this.offset + (offset - this.offset) * .02;
  }

  // Returns [x, y, z, yaw] for an actor at local time `localSeconds`, or undefined if unknown.
  sample(index: number, localSeconds: number): [number, number, number, number] | undefined {
    if (!this.frames.length || this.offset === undefined) return;
    const target = localSeconds - this.offset - this.delay;
    let i = this.frames.length - 1;
    while (i > 0 && this.frames[i - 1].time > target) i--;
    const b = this.frames[i], a = this.frames[i - 1];
    const pb = b.actors[index]; if (!pb) return;
    if (!a || target >= b.time) return [...pb];
    const pa = a.actors[index]; if (!pa) return [...pb];
    if (target <= a.time) return [...pa];
    // Respawns and teleports should cut, not slide across the map.
    if (Math.hypot(pb[0] - pa[0], pb[2] - pa[2]) > 6) return [...pb];
    const t = (target - a.time) / (b.time - a.time);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t, angleLerp(pa[3], pb[3], t)];
  }
}

// Browsers throttle main-thread timers in background tabs to about 1 Hz, which froze the whole
// match for guests whenever the host alt-tabbed. Dedicated worker timers keep running.
export function startTicker(hz: number, tick: () => void): () => void {
  try {
    const source = `setInterval(() => postMessage(0), ${1000 / hz});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => tick();
    return () => worker.terminate();
  } catch {
    const id = window.setInterval(tick, 1000 / hz);
    return () => window.clearInterval(id);
  }
}
