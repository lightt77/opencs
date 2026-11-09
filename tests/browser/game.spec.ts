import { expect, test, type Page } from '@playwright/test';
import type { Game } from '../../src/game';
import type { Actor } from '../../src/actor';

type DiagnosticGame = Omit<Game, never> & {
  update(dt: number): void;
  camera(dt: number): void;
  resetActors(): void;
  damage(victim: Actor, amount: number, attacker: Actor, weapon: 'ak', head?: boolean): void;
  updateGrenades(dt: number): void;
  botGrenade(actor: Actor, type: 'he' | 'flash' | 'smoke', point: { x: number; z: number }): void;
  updateRadio(): void;
  checkMatch(): void;
};
declare global { interface Window { __OPENCS__: DiagnosticGame; __steps: Array<{ sprint: boolean; crouch: boolean }>; __throws: number[] } }

function sampleWav() {
  const samples = 4410, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * .1) * 8000 * (1 - i / samples)), 44 + i * 2);
  return bytes;
}

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
  await page.locator('#movementSpeed').fill('1.5');
  await page.locator('#jumpGravity').fill('14');
  await page.locator('#doubleJump').check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await expect(page.locator('[data-map="snow"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await expect(page.locator('#volume')).toHaveValue('20');
  await expect(page.locator('#sensitivity')).toHaveValue('1.5');
  await expect(page.locator('#movementSpeed')).toHaveValue('1.5');
  await expect(page.locator('#jumpGravity')).toHaveValue('14');
  await expect(page.locator('#doubleJump')).toBeChecked();
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
  await page.evaluate(() => { const g = window.__OPENCS__; g.player.reset({ x: 0, z: 36 }, 0); for (let i = 0; i < 190; i++) g.update(1 / 60); });
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
  expect(result.feet.every(y => y > -.1 && y < 6), JSON.stringify(result)).toBe(true);
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
  for (let round = 0; round < 5; round++) {
    await page.evaluate(() => {
      const g = window.__OPENCS__;
      for (let i = 0; i < 190; i++) g.update(1 / 60);
      for (const enemy of g.actors.filter(a => a.team === 'red')) g.damage(enemy, 200, g.player, 'ak');
      g.update(1 / 60);
      for (let i = 0; i < 245; i++) g.update(1 / 60);
    });
    if (round < 4) await page.getByRole('button', { name: `START ROUND ${round + 2}` }).click();
  }
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    return { screen: g.screen, blue: g.scores.blue, winner: g.winner, kills: g.player.kills };
  });
  expect(result).toEqual({ screen: 'finished', blue: 5, winner: 'blue', kills: 25 });
  await expect(page.getByRole('heading', { name: 'GROUND TAKEN.' })).toBeVisible();
  await expect(page.getByLabel('Player scores').locator('.scoreboard-row:not(.board-labels)')).toHaveCount(10);
  await page.getByRole('button', { name: 'BACK TO MISSION SETUP' }).click();
  await expect(page.locator('#deploy')).toBeVisible();
});

test('hitscan respects headshots, solid walls, friendly fire and knife range', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'INDIA COURT', exact: true }).click(); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5], ally = g.actors[1];
    for (const actor of g.actors) { actor.alive = false; actor.body.enabled(false); }
    p.reset({ x: 0, z: 28 }, 0); enemy.reset({ x: 0, z: 23 }, 0);
    p.switching = 0;
    g.shoot(p, enemy.eye().sub(p.eye()).normalize());
    const headshot = !enemy.alive && g.kills[0].head && p.kills === 1;

    enemy.reset({ x: -22, z: -10 }, 0); p.reset({ x: -22, z: 10 }, 0); p.switching = 0;
    g.settings.wallShots = 'off';
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
  await open(page); await page.getByRole('button', { name: 'SNOW OUTPOST', exact: true }).click(); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5], ally = g.actors[1];
    for (const actor of g.actors) { actor.alive = false; actor.body.enabled(false); }
    p.reset({ x: 11, z: 12 }, 0); enemy.reset({ x: 11, z: 17 }, 0); ally.reset({ x: 11, z: 9 }, 0);
    p.switching = 0; p.cooldown = 0;
    const beforeSmoke = g.visible(p.position, enemy.position);
    g.botGrenade(p, 'flash', p.position); g.updateGrenades(2);
    const flashParity = p.flash > 0 && ally.flash > 0 && enemy.flash > 0;
    p.cooldown = 0; p.grenadeCooldown = 0;
    g.botGrenade(p, 'smoke', p.position); g.updateGrenades(2);
    const smokeBlocks = !g.visible(p.position, enemy.position);

    // The crate at x=11,z=-3 shields the enemy from a nearby explosion.
    p.reset({ x: 11, z: 0 }, 0); enemy.reset({ x: 11, z: -6 }, 0);
    ally.reset({ x: 11, z: 2 }, 0); p.cooldown = 0; p.switching = 0;
    g.botGrenade(p, 'he', p.position); g.updateGrenades(2);
    const heCover = enemy.health === 100;
    const noFriendlyHE = ally.health === 100;
    const selfDamage = p.health < 100;
    return { beforeSmoke, flashParity, smokeBlocks, heCover, noFriendlyHE, selfDamage };
  });
  expect(result).toEqual({ beforeSmoke: true, flashParity: true, smokeBlocks: true, heCover: true, noFriendlyHE: true, selfDamage: true });
});

test('double-Q shortens AWP recovery without resetting ammunition or allowing instant shots', async ({ page }) => {
  await open(page); await page.locator('[data-primary="awp"]').click(); await deploy(page, true);
  await page.evaluate(() => { for (let i = 0; i < 190; i++) window.__OPENCS__.update(1 / 60); });
  await page.mouse.click(720, 450);
  await expect(page.locator('#clip')).toHaveText('4');
  await page.keyboard.press('KeyQ'); await expect(page.locator('#weapon-name')).toHaveText('USP');
  await page.keyboard.press('KeyQ'); await expect(page.locator('#weapon-name')).toHaveText('AWP');
  const cycle = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player;
    const recovery = p.cooldown + p.awpShotAge;
    const before = p.ammo.awp.clip;
    g.shoot(p, p.eye().normalize());
    return { recovery, before, after: p.ammo.awp.clip, previous: p.previousWeapon };
  });
  expect(cycle.recovery).toBeCloseTo(.7, 1);
  expect(cycle.before).toBe(4); expect(cycle.after).toBe(4); expect(cycle.previous).toBe('pistol');
  await page.evaluate(() => { for (let i = 0; i < 45; i++) window.__OPENCS__.update(1 / 60); });
  await page.mouse.click(720, 450); await expect(page.locator('#clip')).toHaveText('3');
});

test('custom movement speed and double jump apply to live physics', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.locator('#movementSpeed').fill('1.5'); await page.locator('#jumpGravity').fill('12'); await page.locator('#doubleJump').check();
  await page.getByRole('button', { name: 'Close settings' }).click(); await deploy(page, true);
  await page.evaluate(() => { const g = window.__OPENCS__; g.player.reset({ x: 0, z: 36 }, 0); for (let i = 0; i < 190; i++) g.update(1 / 60); });
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.speed)).toBeGreaterThan(8);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.jumpsUsed)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.position.y)).toBeGreaterThan(.4);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.jumpsUsed)).toBe(2);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__OPENCS__.player.jumpsUsed)).toBe(2);
});

test('Longshot renders beyond 370 metres and supports long-range sniper hits', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await page.getByRole('button', { name: 'LONGSHOT RANGE', exact: true }).click();
  await page.locator('[data-primary="awp"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5];
    // Range validation uses a known clear lane, not randomized concealed spawns.
    for (const actor of g.actors) { actor.alive = false; actor.body.enabled(false); }
    p.reset({ x: 0, z: 185 }, 0); enemy.reset({ x: 0, z: -185 }, 0);
    const spawnDistance = p.position.distanceTo(enemy.position);
    const visible = g.visible(p.position, enemy.position);
    p.switching = 0; p.immunity = 0; enemy.immunity = 0;
    const target = enemy.position.clone(); target.y += 1.13;
    g.shoot(p, target.sub(p.eye()).normalize());
    return { width: g.arena.width, depth: g.arena.depth, spawnDistance, visible, far: g.view.camera.far, killed: !enemy.alive, botWeapons: g.actors.slice(1).every(a => a.primary === 'awp') };
  });
  expect(result).toMatchObject({ width: 320, depth: 420, visible: true, killed: true, botWeapons: true });
  expect(result.spawnDistance).toBeGreaterThan(360); expect(result.far).toBeGreaterThan(600);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.recoilPitch = 0; g.recoilYaw = 0; g.player.pitch = 0; g.player.yaw = 0;
    g.actors[5].reset({ x: 0, z: -185 }, 0); g.actors[5].brain.hold = 1e6;
  });
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await expect(page.locator('#scope')).toBeVisible();
  expect(await page.evaluate(() => window.__OPENCS__.view.camera.fov)).toBe(12);
  await page.screenshot({ path: 'test-results/longshot.png' });
  expect(await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (const actor of g.actors) actor.brain.decision = 0;
    g.update(1 / 60);
    for (let i = 0; i < 5; i++) g.update(1 / 60);
    return g.actors.slice(5).some(a => a.brain.target >= 0);
  })).toBe(true);
  expect(errors).toEqual([]);
});

test('sound packs can be previewed, saved, restored and reset independently of match setup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await page.getByRole('button', { name: 'LONGSHOT RANGE', exact: true }).click();
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  for (const pack of ['classic', 'punchy', 'suppressed']) {
    await page.locator('#soundPack').selectOption(pack);
    await page.getByRole('button', { name: /PREVIEW .* GUNSHOT/ }).click();
    expect(await page.evaluate(() => window.__OPENCS__.sound.pack)).toBe(pack);
  }
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.getByRole('button', { name: 'Close settings' }).click(); await page.reload();
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await expect(page.locator('#soundPack')).toHaveValue('suppressed');
  await page.getByRole('button', { name: 'RESTORE DEFAULTS' }).click();
  await expect(page.locator('#soundPack')).toHaveValue('classic');
  await expect(page.locator('#movementSpeed')).toHaveValue('1'); await expect(page.locator('#jumpGravity')).toHaveValue('20');
  await expect(page.locator('#doubleJump')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[data-map="longshot"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('damage popups report actual damage, distinguish headshots, and expire', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'INDIA COURT', exact: true }).click(); await deploy(page, true);
  await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5];
    for (const actor of g.actors) { actor.alive = false; actor.respawn = 1000; actor.body.enabled(false); }
    g.phase = 'live'; p.reset({ x: 0, z: 28 }, 0); enemy.reset({ x: 0, z: 23 }, 0);
    enemy.brain.decision = 1e6; enemy.brain.hold = 1e6;
    p.switching = 0; p.pitch = 0; p.yaw = 0;
    const target = enemy.position.clone(); target.y += 1.13;
    g.shoot(p, target.sub(p.eye()).normalize());
  });
  await expect(page.locator('.damage-number[data-damage="35"]')).toBeVisible();
  const lethal = await page.evaluate(() => {
    const g = window.__OPENCS__, enemy = g.actors[5]; enemy.health = 10;
    g.damage(enemy, 200, g.player, 'ak', true);
    const last = g.damagePopups.at(-1)!;
    return { amount: last.amount, head: last.head, killed: last.killed };
  });
  expect(lethal).toEqual({ amount: 10, head: true, killed: true });
  await expect(page.locator('.damage-number.is-headshot[data-damage="10"]')).toBeVisible();
  await page.evaluate(() => { for (let i = 0; i < 65; i++) window.__OPENCS__.update(1 / 60); });
  await expect(page.locator('.damage-number')).toHaveCount(0);
});

test('intermission waits for a new loadout and preserves round score', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'SNOW OUTPOST', exact: true }).click();
  await page.locator('[data-mode="elimination"]').click(); await deploy(page, true);
  await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (let i = 0; i < 190; i++) g.update(1 / 60);
    for (const enemy of g.actors.filter(a => a.team === 'red')) g.damage(enemy, 200, g.player, 'ak');
    g.update(1 / 60);
  });
  await expect(page.getByRole('heading', { name: 'NEXT ROUND LOADOUT' })).toBeVisible();
  const time = await page.evaluate(() => window.__OPENCS__.time);
  await page.locator('[data-round-primary="awp"]').click();
  expect(await page.evaluate(() => window.__OPENCS__.time)).toBe(time);
  expect(await page.evaluate(() => window.__OPENCS__.player.primary)).toBe('ak');
  await page.getByRole('button', { name: 'START ROUND 2' }).click();
  await expect(page.locator('#weapon-name')).toHaveText('AWP');
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    return { round: g.round, score: g.scores.blue, kills: g.player.kills, primary: g.player.primary, clip: g.player.ammo.awp.clip, rejectedLiveChange: !g.continueRound('m4') };
  });
  expect(result).toEqual({ round: 2, score: 1, kills: 5, primary: 'awp', clip: 5, rejectedLiveChange: true });
});

test('Dust II displays its route callouts, mid doors, and A/B site landmarks', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await expect(page.getByRole('button', { name: 'DUST II', exact: true })).toBeVisible();
  await deploy(page, true);
  await page.evaluate(() => window.__OPENCS__.player.reset({ x: 0, z: 36 }, 0));
  await expect(page.locator('#location-name')).toHaveText('T SPAWN');
  await page.evaluate(() => window.__OPENCS__.player.reset({ x: -27.5, z: -4 }, 0));
  await expect(page.locator('#location-name')).toHaveText('UPPER TUNNELS');
  await page.evaluate(() => window.__OPENCS__.player.reset({ x: 0, z: -2 }, 0));
  await expect(page.locator('#location-name')).toHaveText('MID DOORS');
  await page.screenshot({ path: 'test-results/dust-ii.png' });
  expect(errors).toEqual([]);
});

test('custom gunshot files import locally, survive reload, reject corrupt replacements and can be removed', async ({ page }) => {
  const errors: string[] = [], uploads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' || request.method() === 'PUT') uploads.push(request.url()); });
  await open(page); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.locator('#manage-sounds').click();
  await page.locator('#custom-ak').setInputFiles({ name: 'my-<b>ak.wav', mimeType: 'audio/wav', buffer: sampleWav() });
  await expect(page.locator('#custom-audio-status')).toContainText('loaded and saved locally');
  await expect(page.locator('[data-sample-name="ak"]')).toHaveText('my-<b>ak.wav');
  await expect(page.locator('[data-sample-name="ak"] b')).toHaveCount(0);
  expect(await page.evaluate(() => ({ pack: window.__OPENCS__.sound.pack, ready: window.__OPENCS__.sound.hasCustomShot('ak'), missing: window.__OPENCS__.sound.hasCustomShot('awp') }))).toEqual({ pack: 'custom', ready: true, missing: false });
  await page.evaluate(() => { window.__OPENCS__.sound.pack = 'classic'; });
  await page.getByRole('button', { name: 'Preview AK-47 custom gunshot', exact: true }).click();
  expect(await page.evaluate(() => window.__OPENCS__.sound.pack)).toBe('classic');
  await page.reload(); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await expect(page.locator('#soundPack')).toHaveValue('custom'); await page.locator('#manage-sounds').click();
  await expect(page.locator('[data-sample-name="ak"]')).toHaveText('my-<b>ak.wav');
  await page.getByRole('button', { name: 'Preview AK-47 custom gunshot', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.sound.hasCustomShot('ak'))).toBe(true);
  await page.locator('#custom-ak').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await expect(page.locator('#custom-audio-status')).toContainText('could not be decoded');
  await expect(page.locator('[data-sample-name="ak"]')).toHaveText('my-<b>ak.wav');
  await page.screenshot({ path: 'test-results/custom-audio.png' });
  await page.getByRole('button', { name: 'Remove AK-47 custom gunshot', exact: true }).click();
  await expect(page.locator('[data-sample-name="ak"]')).toHaveText('Classic fallback');
  await page.reload(); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click(); await page.locator('#manage-sounds').click();
  await expect(page.locator('[data-sample-name="ak"]')).toHaveText('Classic fallback');
  await expect(page.getByRole('button', { name: 'Preview AK-47 custom gunshot', exact: true })).toBeDisabled();
  expect(errors).toEqual([]); expect(uploads).toEqual([]);
});

test('custom audio remains usable for the session when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage blocked for test'); } }));
  await open(page); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click(); await page.locator('#manage-sounds').click();
  await page.locator('#custom-awp').setInputFiles({ name: 'awp.wav', mimeType: 'audio/wav', buffer: sampleWav() });
  await expect(page.locator('#custom-audio-status')).toContainText('this session only');
  expect(await page.evaluate(() => window.__OPENCS__.sound.hasCustomShot('awp'))).toBe(true);
});

test('sprint, crouch, and distance-based footsteps work with actual movement', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live';
    for (const a of g.actors.slice(1)) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    g.player.reset({ x: 0, z: 26 }, 0);
    window.__steps = []; const original = g.sound.step.bind(g.sound);
    g.sound.step = (position, snow, sprint = false, crouch = false) => { window.__steps.push({ sprint, crouch }); original(position, snow, sprint, crouch); };
    for (let i = 0; i < 20; i++) g.update(1 / 60);
  });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.speed)).toBeGreaterThan(8);
  await expect.poll(() => page.evaluate(() => window.__steps.some(s => s.sprint))).toBe(true);
  await page.keyboard.down('ControlLeft');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.body.crouched)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.speed)).toBeLessThan(3);
  expect(await page.evaluate(() => ({ sprint: window.__OPENCS__.player.sprinting, eye: window.__OPENCS__.player.eyeHeight }))).toEqual({ sprint: false, eye: 1.02 });
  await expect.poll(() => page.evaluate(() => window.__steps.some(s => s.crouch))).toBe(true);
  await page.keyboard.up('ControlLeft'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.body.crouched)).toBe(false);
  await page.evaluate(() => { const g = window.__OPENCS__; g.player.reset({ x: -22, z: 9 }, 0); for (let i = 0; i < 20; i++) g.update(1 / 60); });
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.position.z)).toBeLessThan(8.2);
  await page.evaluate(() => { window.__steps = []; });
  // Simulate enough blocked motion for several phantom steps if cadence used desired speed.
  await page.evaluate(() => { for (let i = 0; i < 240; i++) window.__OPENCS__.update(1 / 60); });
  expect(await page.evaluate(() => window.__steps.length)).toBe(0);
  await page.keyboard.up('KeyW');
});

test('AWP cycles two optical zoom levels and clears zoom on switch, reload and sprint', async ({ page }) => {
  await open(page); await page.locator('[data-primary="awp"]').click(); await deploy(page, true);
  await page.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.player.reset({ x: 0, z: 36 }, 0); });
  await page.mouse.click(700, 450, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.view.camera.fov)).toBe(24);
  await page.mouse.click(700, 450, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.scopeLevel)).toBe(2);
  await expect.poll(async () => {
    const second = await page.evaluate(() => window.__OPENCS__.view.camera.fov);
    return Math.tan(24 * Math.PI / 360) / Math.tan(second * Math.PI / 360);
  }).toBeCloseTo(2, 6);
  await page.mouse.click(700, 450, { button: 'right' }); await expect(page.locator('#scope')).toBeHidden();
  await page.mouse.click(700, 450, { button: 'right' }); await page.keyboard.press('Digit2'); await expect(page.locator('#scope')).toBeHidden();
  await page.keyboard.press('Digit1'); await page.mouse.click(700, 450, { button: 'right' });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await expect(page.locator('#scope')).toBeHidden();
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await page.evaluate(() => { window.__OPENCS__.player.ammo.awp.clip = 4; window.__OPENCS__.player.switching = 0; });
  await page.mouse.click(700, 450, { button: 'right' }); await page.keyboard.press('KeyR'); await expect(page.locator('#scope')).toBeHidden();
});

test('wallbang settings allow thick walls with reduced damage or restrict to thin cover', async ({ page }) => {
  await open(page); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, enemy = g.actors[5];
    for (const a of g.actors) { a.alive = false; a.body.enabled(false); }
    const shot = (x: number, z1: number, z2: number) => {
      p.reset({ x, z: z1 }, 0); enemy.reset({ x, z: z2 }, 0); p.switching = 0;
      const target = enemy.position.clone(); target.y += 1.13;
      g.shoot(p, target.sub(p.eye()).normalize()); return 100 - enemy.health;
    };
    const result = { clear: shot(0, -3, -13), door: shot(2.4, -3, -13), thick: shot(13, 12, -20), thinOnly: 0 };
    g.settings.wallShots = 'thin'; result.thinOnly = shot(13, 12, -20); return result;
  });
  expect(result.clear).toBeGreaterThan(30); expect(result.door).toBeGreaterThan(0);
  expect(result.door).toBeLessThan(result.clear); expect(result.thick).toBeGreaterThan(0);
  expect(result.thick).toBeLessThan(result.door); expect(result.thinOnly).toBe(0);
});

test('headshot death launches a backward fall then pans and zooms toward the killer', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, killer = g.actors[5]; g.phase = 'live';
    for (const a of g.actors) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    p.reset({ x: 0, z: 25 }, 0); killer.reset({ x: 0, z: 16 }, 0);
    killer.brain.decision = killer.brain.hold = 1e6; g.camera(1);
    const start = g.view.camera.position.clone(), base = p.position.clone(), rotation = g.view.camera.quaternion.clone();
    g.damage(p, 200, killer, 'ak', true);
    for (let i = 0; i < 20; i++) { g.update(1 / 60); g.camera(1 / 60); }
    const airborne = p.position.y - base.y, falling = rotation.angleTo(g.view.camera.quaternion) > .2;
    for (let i = 0; i < 116; i++) { g.update(1 / 60); g.camera(1 / 60); }
    const end = g.view.camera.position.clone();
    return { airborne, falling, pushed: p.position.distanceTo(base), tilt: p.model.body.rotation.x, nearKiller: end.distanceTo(killer.eye()), startDistance: start.distanceTo(killer.eye()), fov: g.view.camera.fov, name: g.spectating, dead: !p.alive };
  });
  expect(result.airborne).toBeGreaterThan(.5); expect(result.falling).toBe(true);
  expect(result.pushed).toBeGreaterThan(.7); expect(result.pushed).toBeLessThan(1);
  expect(result.tilt).toBeCloseTo(Math.PI / 2); expect(result.nearKiller).toBeLessThan(result.startDistance / 2);
  expect(result.fov).toBeLessThan(50); expect(result.name).toContain('KILLER'); expect(result.dead).toBe(true);
  await page.screenshot({ path: 'test-results/death-camera.png' });
});

test('saved round timers gate combat and keep the end buffer before total scores', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.locator('#freezeTime').fill('1.5'); await page.locator('#roundEndDelay').fill('3.5');
  await page.getByRole('button', { name: 'Close settings' }).click(); await page.reload();
  await page.locator('[data-mode="elimination"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, start = g.player.position.clone();
    const freeze = g.phaseTime;
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const frozen = g.phase === 'warmup' && start.distanceTo(g.player.position) < .1;
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    for (const a of g.actors.filter(a => a.team === 'red')) g.damage(a, 200, g.player, 'ak');
    g.update(1 / 60);
    const score = g.scores.blue;
    for (let i = 0; i < 150; i++) g.update(1 / 60);
    const buffered = g.screen === 'playing' && g.phase === 'between';
    for (let i = 0; i < 65; i++) g.update(1 / 60);
    return { freeze, frozen, score, buffered, delay: g.settings.roundEndDelay };
  });
  expect(result.freeze).toBeGreaterThan(1); expect(result).toMatchObject({ frozen: true, score: 1, buffered: true, delay: 3.5 });
  await expect(page.getByLabel('Total team scores')).toContainText('BLUE ROUNDS · 5 KILLS');
  await expect(page.getByLabel('Total team scores')).toContainText('RED ROUNDS · 0 KILLS');
  await expect(page.getByLabel('Player scores').locator('.scoreboard-row:not(.board-labels)')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'START ROUND 2' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/round-score.png' });
  await page.getByRole('button', { name: 'START ROUND 2' }).click();
  expect(await page.evaluate(() => window.__OPENCS__.phase)).toBe('warmup');
});

test('bots climb low crates physically, sprint on rotations, crouch to aim and seek cover', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, bot = g.actors[1], enemy = g.actors[5]; g.phase = 'live';
    for (const a of g.actors) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    bot.reset({ x: 0, z: 17 }, 0); bot.brain.role = 'hold'; bot.brain.decision = bot.brain.hold = 1e6;
    let height = 0, landed = false;
    for (let i = 0; i < 210; i++) {
      g.update(1 / 60); height = Math.max(height, bot.position.y);
      landed ||= bot.body.grounded && bot.position.y > 1.2;
    }
    bot.reset({ x: 0, z: 28 }, 0); bot.brain.nextClimb = 1e6; bot.brain.decision = 1e6;
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    const sprint = bot.sprinting;
    bot.reset({ x: 0, z: 28 }, 0); enemy.reset({ x: 0, z: 15 }, 0);
    enemy.brain.hold = enemy.brain.decision = 1e6; bot.brain.target = enemy.id; bot.brain.decision = 1e6;
    g.update(1 / 60); const crouch = bot.body.crouched;
    bot.health = 20; bot.brain.repath = 0; g.update(1 / 60);
    return { height, landed, sprint, crouch, cover: bot.brain.coverUntil > g.time, path: bot.brain.path.length };
  });
  expect(result.height).toBeGreaterThan(1.3); expect(result.landed).toBe(true);
  expect(result.sprint).toBe(true); expect(result.crouch).toBe(true); expect(result.cover).toBe(true); expect(result.path).toBeGreaterThan(0);
});

test('round spawn plans vary without overlaps or fixed opposing sightlines', async ({ page }) => {
  await open(page); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, starts: string[] = [];
    let separated = true, concealed = 0;
    for (let round = 0; round < 12; round++) {
      g.resetActors(); starts.push(`${g.player.position.x},${g.player.position.z}`);
      for (let i = 0; i < g.actors.length; i++) for (let j = i + 1; j < g.actors.length; j++) separated &&= g.actors[i].position.distanceTo(g.actors[j].position) > 2.5;
      if (!g.visible(g.player.eye(), g.actors[5].eye())) concealed++;
    }
    return { unique: new Set(starts).size, separated, concealed };
  });
  expect(result.unique).toBeGreaterThan(2); expect(result.separated).toBe(true); expect(result.concealed).toBeGreaterThan(8);
});

test('supplied sound pack and effect assets decode, persist, and coexist with original packs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await page.locator('#soundPack').selectOption('assets');
  await page.locator('#effectsPack').selectOption('assets');
  await page.locator('#radioVolume').fill('45');
  await page.getByRole('button', { name: /PREVIEW AK-47 GUNSHOT/ }).click();
  expect(await page.evaluate(async () => {
    const sound = window.__OPENCS__.sound; await sound.unlock();
    return ['ak47_fire', 'awp_fire', 'm4a1_fire', 'usp_fire', 'jump1', 'zoom', 'generic_reload', 'footsteps', 'nice_shot2', 'pain10'].every(id => sound.hasAsset(id));
  })).toBe(true);
  await page.locator('#radioChatter').uncheck();
  await page.getByRole('button', { name: 'Close settings' }).click(); await page.reload();
  await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
  await expect(page.locator('#soundPack')).toHaveValue('assets'); await expect(page.locator('#radioVolume')).toHaveValue('45'); await expect(page.locator('#radioChatter')).not.toBeChecked();
  for (const pack of ['classic', 'punchy', 'suppressed', 'custom']) await page.locator('#soundPack').selectOption(pack);
  await page.locator('#effectsPack').selectOption('classic'); expect(errors).toEqual([]);
});

for (const [preset, expected] of [['awp', ['awp']], ['awp-ak', ['ak', 'awp']], ['usp', ['pistol']], ['knife', ['knife']], ['grenades', ['he', 'flash', 'smoke']]] as const) {
  test(`${preset} match restrictions apply to both teams and survive respawns`, async ({ page }) => {
    await open(page); await page.locator('#weapon-rules').click();
    await page.locator(`[data-preset="${preset}"]`).click(); await page.getByRole('button', { name: 'Close settings' }).click();
    await deploy(page, true);
    const result = await page.evaluate(() => {
      const g = window.__OPENCS__;
      const equipped = g.actors.map(a => ({ weapon: a.weapon, weapons: a.weapons, forbiddenAmmo: Object.entries(a.ammo).filter(([id, ammo]) => !a.weapons.includes(id as Actor['weapon']) && ammo.clip > 0).length }));
      g.player.reset({ x: 0, z: 36 }, 0);
      g.player.equip('m4');
      return { equipped, afterReset: g.player.weapon, weapons: g.player.weapons };
    });
    for (const a of result.equipped) { expect(expected).toContain(a.weapon); expect(a.weapons.every(id => (expected as readonly string[]).includes(id))).toBe(true); expect(a.forbiddenAmmo).toBe(0); }
    expect(expected).toContain(result.afterReset);
    if (preset === 'awp') {
      await expect(page.locator('#crosshair')).toBeHidden();
      await page.mouse.click(720, 450, { button: 'right' }); await expect(page.locator('#scope')).toBeVisible();
    }
  });
}

test('grenades prime while held, charge to a cap, and launch only on release', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live';
    for (const a of g.actors.slice(1)) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    g.player.reset({ x: 0, z: 25 }, 0); g.player.equip('he'); g.player.switching = 0;
    window.__throws = [];
    const original = g.physics!.grenade.bind(g.physics);
    g.physics!.grenade = (position, velocity) => { window.__throws.push(Math.hypot(velocity.x, velocity.y, velocity.z)); return original(position, velocity); };
  });
  await page.mouse.down();
  await expect(page.locator('#grenade-charge')).toBeVisible();
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__OPENCS__.update(1 / 60); });
  expect(await page.evaluate(() => ({ charge: window.__OPENCS__.grenadeCharge, count: window.__OPENCS__.player.ammo.he.clip, throws: window.__throws.length }))).toEqual({ charge: 1, count: 1, throws: 0 });
  await page.mouse.up(); await expect.poll(() => page.evaluate(() => window.__throws.length)).toBe(1);
  await expect(page.locator('#grenade-charge')).toBeHidden();
  expect(await page.evaluate(() => window.__OPENCS__.player.ammo.he.clip)).toBe(0);
  await page.evaluate(() => { const p = window.__OPENCS__.player; p.equip('flash'); p.switching = 0; p.grenadeCooldown = 0; });
  await page.mouse.click(720, 450); await expect.poll(() => page.evaluate(() => window.__throws.length)).toBe(2);
  const speeds = await page.evaluate(() => window.__throws);
  expect(speeds[0]).toBeCloseTo(22); expect(speeds[1]).toBeLessThan(9);
});

test('switching weapons or pausing cancels a held grenade without spending ammunition', async ({ page }) => {
  await open(page); await deploy(page, true);
  await page.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.player.equip('he'); g.player.switching = 0; });
  await page.mouse.down(); await expect(page.locator('#grenade-charge')).toBeVisible();
  await page.keyboard.press('Digit2'); await page.mouse.up();
  await expect(page.locator('#grenade-charge')).toBeHidden();
  expect(await page.evaluate(() => window.__OPENCS__.player.ammo.he.clip)).toBe(1);
  await page.evaluate(() => { const p = window.__OPENCS__.player; p.equip('he'); p.switching = 0; });
  await page.mouse.down(); await expect(page.locator('#grenade-charge')).toBeVisible();
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => ({ charge: window.__OPENCS__.grenadeCharge, count: window.__OPENCS__.player.ammo.he.clip }))).toEqual({ charge: undefined, count: 1 });
});

test('deathmatch resupplies spent guns and grenade slots after ten seconds; elimination does not', async ({ page }) => {
  await open(page); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player; g.phase = 'live';
    for (const a of g.actors.slice(1)) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    p.reset({ x: 0, z: 36 }, 0); p.switching = 0; g.shoot(p, p.eye().set(0, 1, 0));
    g.botGrenade(p, 'he', { x: 0, z: -20 });
    // Shooting cooldown blocks utility until ready.
    p.cooldown = 0; g.botGrenade(p, 'he', { x: 0, z: -20 });
    for (let i = 0; i < 540; i++) g.update(1 / 60);
    const before = { clip: p.ammo.ak.clip, grenade: p.ammo.he.clip };
    for (let i = 0; i < 65; i++) g.update(1 / 60);
    const after = { clip: p.ammo.ak.clip, grenade: p.ammo.he.clip, reserve: p.ammo.ak.reserve, health: p.health };
    g.settings.mode = 'elimination'; p.cooldown = 0; p.switching = 0; g.shoot(p, p.eye().set(0, 1, 0));
    for (let i = 0; i < 601; i++) g.update(1 / 60);
    return { before, after, eliminationClip: p.ammo.ak.clip, timer: p.refillTimers.ak };
  });
  expect(result.before).toEqual({ clip: 29, grenade: 0 }); expect(result.after).toEqual({ clip: 30, grenade: 1, reserve: 90, health: 100 });
  expect(result.eliminationClip).toBe(29); expect(result.timer).toBeUndefined();
});

test('radio headshot, friendly-fire and victory reactions use supplied clips without enabling friendly damage', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(async () => {
    const g = window.__OPENCS__, p = g.player, bot = g.actors[1], enemy = g.actors[5]; await g.sound.unlock();
    g.settings.mode = 'elimination'; g.phase = 'live';
    for (const a of g.actors) { a.alive = false; a.body.enabled(false); }
    p.reset({ x: 0, z: 25 }, 0); bot.reset({ x: 2, z: 25 }, 0); enemy.reset({ x: 0, z: 20 }, 0);
    g.damage(enemy, 40, p, 'ak', true);
    const head = g.radio.message?.event, nonlethal = enemy.alive;
    g.damage(enemy, 200, p, 'ak');
    const known = g.radio.observedDeaths.size;
    g.radio.reset(); p.switching = 0;
    g.shoot(p, bot.eye().sub(p.eye()).normalize());
    const friendly = g.radio.message?.event, health = bot.health;
    g.checkMatch();
    return { head, nonlethal, known, friendly, health, victory: g.radio.message?.event, clipLoaded: g.sound.hasAsset(g.radio.message!.clip) };
  });
  expect(result).toEqual({ head: 'headshot', nonlethal: true, known: 1, friendly: 'friendlyFire', health: 100, victory: 'closeVictory', clipLoaded: true });
  await expect(page.locator('#radio-message')).toContainText('[RADIO]');
});

test('enemy-count radio reports require witnessed deaths and a current observation, not global alive counts', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, bot = g.actors[1]; g.settings.mode = 'elimination'; g.phase = 'live';
    for (const a of g.actors) { a.alive = false; a.body.enabled(false); }
    p.reset({ x: 0, z: 26 }, 0); bot.reset({ x: 2, z: 25 }, 0); g.actors[9].reset({ x: 0, z: 18 }, 0);
    g.updateRadio(); const unseen = g.radio.message?.event;
    // Three deaths in this bot's field of view: it can now report two remaining.
    for (const id of [5, 6, 7]) { const e = g.actors[id]; e.reset({ x: 0, z: 20 }, 0); g.damage(e, 200, bot, 'ak'); }
    g.time += 8; g.updateRadio(); const two = g.radio.message?.event;
    const e = g.actors[8]; e.reset({ x: 0, z: 20 }, 0); g.damage(e, 200, bot, 'ak');
    g.time += 8; g.updateRadio(); const one = g.radio.message?.event;
    g.radio.reset(); g.configureAudio({ ...g.settings, radioChatter: false }); g.time += 8; g.updateRadio();
    return { unseen, two, one, muted: g.radio.message === undefined };
  });
  expect(result).toEqual({ unseen: undefined, two: 'twoLeft', one: 'oneLeft', muted: true });
});

test('round end includes every player and permits a pistol-only next round', async ({ page }) => {
  await open(page); await page.locator('[data-mode="elimination"]').click(); await deploy(page, true);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live';
    for (const a of g.actors.filter(a => a.team === 'red')) { a.immunity = 0; g.damage(a, 200, g.player, 'ak'); }
    g.update(1 / 60); for (let i = 0; i < 155; i++) g.update(1 / 60);
  });
  const board = page.getByLabel('Player scores'); await expect(board.locator('.scoreboard-row:not(.board-labels)')).toHaveCount(10);
  await expect(board).toContainText('Kestrel'); await expect(board).toContainText('Cinder');
  await page.locator('#round-rules').click(); await page.locator('[data-preset="usp"]').click(); await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[data-round-primary]')).toHaveCount(0);
  await page.getByRole('button', { name: 'START ROUND 2' }).click();
  expect(await page.evaluate(() => window.__OPENCS__.actors.every(a => a.weapon === 'pistol' && a.weapons.length === 1))).toBe(true);
  expect(await page.evaluate(() => window.__OPENCS__.scores.blue)).toBe(1);
});

test('radio distinguishes dominant victories from close wins and reacts to local overwhelming numbers', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, bot = g.actors[1]; g.settings.mode = 'elimination'; g.phase = 'live';
    for (const e of g.actors.filter(a => a.team === 'red')) { e.immunity = 0; g.damage(e, 200, g.player, 'ak'); }
    g.checkMatch(); const victory = g.radio.message?.event;
    g.radio.reset(); g.phase = 'live'; g.time += 20;
    for (const a of g.actors) { a.alive = false; a.body.enabled(false); }
    bot.reset({ x: 0, z: 25 }, 0);
    g.actors[5].reset({ x: -2, z: 19 }, 0); g.actors[6].reset({ x: 0, z: 18 }, 0); g.actors[7].reset({ x: 2, z: 19 }, 0);
    g.updateRadio();
    return { victory, overwhelmed: g.radio.message?.event };
  });
  expect(result).toEqual({ victory: 'bigVictory', overwhelmed: 'overwhelmed' });
});

test('grenade-only bots throw utility, respect the shared cooldown, and never equip banned guns', async ({ page }) => {
  await open(page); await page.locator('[data-map="india"]').click(); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__; g.settings.allowedWeapons = ['he']; g.resetActors(); g.phase = 'live';
    const bot = g.actors[1], enemy = g.actors[5];
    for (const a of g.actors) { a.alive = false; a.respawn = 1000; a.body.enabled(false); }
    bot.reset({ x: 0, z: 26 }, 0); enemy.reset({ x: 0, z: 18 }, 0);
    bot.brain.target = enemy.id; bot.brain.acquired = -10; bot.brain.decision = 1e6; enemy.brain.decision = enemy.brain.hold = 1e6;
    bot.switching = 0; g.update(1 / 60);
    const afterFirst = bot.ammo.he.clip;
    bot.cooldown = 0; g.botGrenade(bot, 'he', enemy.position);
    const blocked = bot.ammo.he.clip === afterFirst;
    for (let i = 0; i < 70; i++) g.update(1 / 60);
    return { afterFirst, blocked, afterSecond: bot.ammo.he.clip, weapon: bot.weapon, weapons: bot.weapons };
  });
  expect(result).toEqual({ afterFirst: 2, blocked: true, afterSecond: 1, weapon: 'he', weapons: ['he'] });
});

test('deathmatch weapon-rule changes apply on respawn, not halfway through a life', async ({ page }) => {
  await open(page); await deploy(page, true);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player; g.phase = 'live'; g.settings.allowedWeapons = ['knife'];
    const before = p.weapons;
    p.immunity = 0; g.damage(p, 200, g.actors[5], 'ak');
    p.respawn = 0; g.update(1 / 60);
    return { before, weapon: p.weapon, weapons: p.weapons, alive: p.alive, akAmmo: p.ammo.ak.clip };
  });
  expect(result.before).toContain('ak'); expect(result).toMatchObject({ weapon: 'knife', weapons: ['knife'], alive: true, akAmmo: 0 });
});
