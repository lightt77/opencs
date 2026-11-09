import type { Team } from './config';
import type { Navigation } from './navigation';
import { distance, type Point } from './math';

export function spawnCandidates(nav: Navigation, team: Team, roundStart: boolean): Point[] {
  const sign = team === 'blue' ? 1 : -1;
  const points: Point[] = [];
  for (let i = 0; i < nav.walkable.length; i++) {
    if (!nav.walkable[i]) continue;
    const p = nav.point(i);
    // Round starts retain opposite sides but spread across their rear quarter.
    if (roundStart && (nav.arena.surface ? !nav.arena[team].some(s => distance(s, p) < 12) : p.z * sign < nav.arena.depth * .29)) continue;
    if (nav.clear(p, p, .7, .65) && nav.clear(p, p, 1.7, .4)) points.push(p);
  }
  return points.length ? points : nav.arena[team];
}

export function chooseSpawn(candidates: Point[], allies: Point[], enemies: Point[], nav: Navigation, random = Math.random): Point {
  const scores = candidates.filter(p => allies.every(a => distance(a, p) > 2.5) && enemies.every(e => distance(e, p) > 8)).map(point => {
    const nearest = Math.min(100, ...enemies.map(e => distance(e, point)));
    const exposed = enemies.some(e => nav.clear(e, point));
    return { point, score: (exposed ? 0 : 200) + nearest };
  }).sort((a, b) => b.score - a.score);
  if (!scores.length) {
    // Congested arenas: maximize separation instead of blindly using a fixed spawn.
    return [...candidates].sort((a, b) => Math.min(100, ...[...allies, ...enemies].map(p => distance(p, b))) - Math.min(100, ...[...allies, ...enemies].map(p => distance(p, a))))[0];
  }
  const safe = scores.filter(s => s.score >= scores[0].score - 16);
  return safe[Math.min(safe.length - 1, Math.floor(random() * safe.length))].point;
}
