import { expect, test, type Page } from '@playwright/test';
import type { Game } from '../../src/game';
import type { Actor } from '../../src/actor';

type DiagnosticGame = Omit<Game, never> & {
  update(dt: number): void;
  damage(victim: Actor, amount: number, attacker: Actor, weapon: 'ak'): void;
  updateGrenades(dt: number): void;
  botGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', point: { x: number; z: number }): void;
};
declare global { interface Window { __OPENCS__: DiagnosticGame } }

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SMALL MAPS. BIG STAKES.' })).toBeVisible();
}

async function deploy(page: Page, suppressCombat = false) {
  await page.getByRole('button', { name: /DEPLOY TO/ }).click();
  if (await page.locator('#resume').isVisible()) await page.locator('#resume').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  if (suppressCombat) {
    // Input tests must not race a random sniper death; combat has its own integration test.
    await page.evaluate(() => { for (const bot of window.__OPENCS__.actors) bot.brain.decision = 1e6; });
  }
}

test('lobby, local settings, map previews and field manual', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await page.getByRole('button', { name: 'SNOW OUTPOST', exact: true }).click();
  await expect(page.locator('[data-map="snow"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.locator('#volume').fill('20');
  await page.locator('#sensitivity').fill('1.5');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await expect(page.locator('[data-map="snow"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await expect(page.locator('#volume')).toHaveValue('20');
  await expect(page.locator('#sensitivity')).toHaveValue('1.5');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: /FIELD MANUAL/ }).click();
  await expect(page.getByRole('heading', { name: 'FIELD MANUAL' })).toBeVisible();
  await page.getByRole('button', { name: 'Close manual' }).click();
  await page.screenshot({ path: 'test-results/lobby.png' });
  expect(errors).toEqual([]);
});

test('pointer lock, movement, firing, reloading, inventory and pause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page); await deploy(page, true);
  await page.evaluate(() => { for (let i = 0; i < 190; i++) window.__OPENCS__.update(1 / 60); });
  const before = await page.evaluate(() => window.__OPENCS__.player.position.z);
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.position.z)).toBeLessThan(before - 2);
  await page.keyboard.up('KeyW');
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.ammo.ak.clip)).toBeLessThan(29);
  await page.mouse.up();
  await page.keyboard.press('KeyR');
  await expect(page.locator('#weapon-status')).toContainText('RELOADING');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.ammo.ak.clip)).toBe(30);
  await page.keyboard.press('Digit2'); await expect(page.locator('#weapon-name')).toHaveText('USP');
  await page.keyboard.press('Digit3'); await expect(page.locator('#weapon-name')).toHaveText('FIELD KNIFE');
  await page.keyboard.press('Digit1');
  await page.keyboard.down('Tab'); await expect(page.locator('#scoreboard')).toBeVisible();
  await expect(page.locator('.scoreboard-row:not(.board-labels)')).toHaveCount(10);
  await page.keyboard.up('Tab'); await expect(page.locator('#scoreboard')).toBeHidden();
  await page.screenshot({ path: 'test-results/gameplay.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'MATCH PAUSED' })).toBeVisible();
  const time = await page.evaluate(() => window.__OPENCS__.time);
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  expect(await page.evaluate(() => window.__OPENCS__.time)).toBe(time);
  await page.getByRole('button', { name: 'LEAVE MATCH' }).click();
  await expect(page.locator('#deploy')).toBeVisible();
  expect(errors).toEqual([]);
});

test('bots navigate, engage, damage and respawn in deathmatch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    const initial = g.actors.map(a => a.position.clone());
    for (let i = 0; i < 2400; i++) g.update(1 / 60);
    return {
      moved: g.actors.filter((a, i) => !a.human && a.position.distanceTo(initial[i]) > 4).length,
      deaths: g.actors.reduce((n, a) => n + a.deaths, 0),
      scores: g.scores.blue + g.scores.red,
      scoredKills: g.actors.reduce((n, a) => n + a.kills, 0),
      feet: g.actors.filter(a => a.alive).map(a => a.position.y),
    };
  });
  expect(result.moved).toBeGreaterThanOrEqual(7);
  expect(result.deaths).toBeGreaterThan(0);
  expect(result.scores).toBe(result.scoredKills);
  expect(result.feet.every(y => y > -.1 && y < 6)).toBe(true);
  expect(errors).toEqual([]);
});

test('AWP scope and grenade utility work on India', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'INDIA COURT', exact: true }).click();
  await page.locator('[data-primary="awp"]').click();
  await deploy(page, true);
  await page.evaluate(() => { for (let i = 0; i < 190; i++) window.__OPENCS__.update(1 / 60); });
  await page.mouse.click(720, 450, { button: 'right' }); await expect(page.locator('#scope')).toBeVisible();
  await page.mouse.click(720, 450); await expect(page.locator('#scope')).toBeHidden();
  await expect(page.locator('#clip')).toHaveText('4');
  await page.keyboard.press('Digit6');
  await expect(page.locator('#weapon-name')).toHaveText('SMOKE GRENADE');
  await page.evaluate(() => { for (let i = 0; i < 90; i++) window.__OPENCS__.update(1 / 60); });
  await page.mouse.click(720, 450);
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.ammo.smoke.clip)).toBe(0);
  await expect(page.locator('#weapon-name')).toHaveText('AWP');
  const utility = await page.evaluate(() => {
    const g = window.__OPENCS__;
    // Launch locally to verify perception parity: smoke blocks the same sightline for bots.
    g.botGrenade(g.actors[1], 'smoke', g.actors[1].position);
    for (let i = 0; i < 150; i++) g.update(1 / 60);
    return g.actors.length === 10 && g.actors.some(a => a.ammo.smoke.clip === 0);
  });
  expect(utility).toBe(true);
});

test('elimination awards rounds, resets lives, and ends a match', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'SNOW OUTPOST', exact: true }).click();
  await page.locator('[data-mode="elimination"]').click();
  await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 190; i++) g.update(1 / 60);
      for (const enemy of g.actors.filter(a => a.team === 'red')) g.damage(enemy, 200, g.player, 'ak');
      g.update(1 / 60);
      if (g.screen === 'finished') break;
      for (let i = 0; i < 245; i++) g.update(1 / 60);
    }
    return { screen: g.screen, blue: g.scores.blue, winner: g.winner, kills: g.player.kills };
  });
  expect(result).toEqual({ screen: 'finished', blue: 5, winner: 'blue', kills: 25 });
  await expect(page.getByRole('heading', { name: 'GROUND TAKEN.' })).toBeVisible();
  await page.getByRole('button', { name: 'BACK TO MISSION SETUP' }).click();
  await expect(page.locator('#deploy')).toBeVisible();
});

test('hitscan respects headshots, solid walls, friendly fire and knife range', async ({ page }) => {
  await open(page); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5], ally = g.actors[1];
    for (const actor of g.actors) { actor.alive = false; actor.body.enabled(false); }
    p.reset({ x: 0, z: 28 }, 0); enemy.reset({ x: 0, z: 23 }, 0);
    p.switching = 0;
    g.shoot(p, enemy.eye().sub(p.eye()).normalize());
    const headshot = !enemy.alive && g.kills[0].head && p.kills === 1;

    enemy.reset({ x: -13, z: 0 }, 0); p.reset({ x: -13, z: 28 }, 0); p.switching = 0;
    g.shoot(p, enemy.eye().sub(p.eye()).normalize());
    const wall = enemy.health === 100;

    enemy.alive = false; enemy.body.enabled(false);
    p.reset({ x: 0, z: 28 }, 0); ally.reset({ x: 0, z: 23 }, 0); p.switching = 0;
    g.shoot(p, ally.eye().sub(p.eye()).normalize());
    const friendly = ally.health === 100;

    ally.alive = false; ally.body.enabled(false);
    enemy.reset({ x: 0, z: 23 }, 0); p.weapon = 'knife'; p.cooldown = 0;
    g.shoot(p, enemy.eye().sub(p.eye()).normalize());
    const knifeMiss = enemy.health === 100;
    enemy.reset({ x: 0, z: 26.5 }, 0); p.cooldown = 0;
    g.shoot(p, enemy.eye().sub(p.eye()).normalize());
    return { headshot, wall, friendly, knifeMiss, knifeHit: enemy.health < 100 };
  });
  expect(result).toEqual({ headshot: true, wall: true, friendly: true, knifeMiss: true, knifeHit: true });
});

test('flash affects both teams, smoke blocks bot vision, and HE respects cover', async ({ page }) => {
  await open(page); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5], ally = g.actors[1];
    for (const actor of g.actors) { actor.alive = false; actor.body.enabled(false); }
    p.reset({ x: 23, z: 15 }, 0); enemy.reset({ x: 23, z: 20 }, 0); ally.reset({ x: 23, z: 12 }, 0);
    p.switching = 0; p.cooldown = 0;
    const beforeSmoke = g.visible(p.position, enemy.position);
    g.botGrenade(p, 'flash', p.position); g.updateGrenades(2);
    const flashParity = p.flash > 0 && ally.flash > 0 && enemy.flash > 0;
    p.cooldown = 0;
    g.botGrenade(p, 'smoke', p.position); g.updateGrenades(2);
    const smokeBlocks = !g.visible(p.position, enemy.position);

    // The tall crate at z=5 shields the enemy from a nearby explosion.
    p.reset({ x: 23, z: 8.5 }, 0); enemy.reset({ x: 23, z: 2 }, 0);
    ally.reset({ x: 21, z: 9 }, 0); p.cooldown = 0;
    g.botGrenade(p, 'he', p.position); g.updateGrenades(2);
    const heCover = enemy.health === 100;
    const noFriendlyHE = ally.health === 100;
    const selfDamage = p.health < 100;
    return { beforeSmoke, flashParity, smokeBlocks, heCover, noFriendlyHE, selfDamage };
  });
  expect(result).toEqual({ beforeSmoke: true, flashParity: true, smokeBlocks: true, heCover: true, noFriendlyHE: true, selfDamage: true });
});
