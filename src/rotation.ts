import { MAP_IDS, type MapId } from './config';

// Excluding the current arena prevents immediate repeats, even with a fixed RNG.
export function randomMap(current: MapId, random = Math.random): MapId {
  const choices = MAP_IDS.filter(id => id !== current);
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
}
