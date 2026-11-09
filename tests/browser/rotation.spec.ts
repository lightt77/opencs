import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript(settings => { if (!localStorage.getItem('opencs.settings')) localStorage.setItem('opencs.settings', JSON.stringify({ map: 'india', freezeTime: 0, roundEndDelay: 0, volume: 0, radioChatter: false, shadows: false, ...settings })); }, settings);
  await page.goto('/');
}
async function deploy(page: Page) {
  await page.locator('#deploy').click();
  if (await page.locator('#resume').isVisible()) await page.locator('#resume').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await page.evaluate(() => { for (const a of window.__OPENCS__.actors) { a.brain.decision = 1e6; a.brain.pause = 1e6; } });
}

test('biome browser and configurable timing/auto mode persist without changing saved audio', async ({ page }) => {
  await prepare(page, { soundPack: 'custom', volume: 27 });
  await expect(page.locator('[data-map]')).toHaveCount(12);
  await page.locator('#biome-filter').selectOption('snow');
  await expect(page.locator('[data-map]')).toHaveCount(2);
  await page.locator('[data-map="alpine"]').click();
  await page.locator('#auto-play').check();
  await page.locator('#open-settings').click();
  await page.locator('#matchDuration').fill('900'); await page.locator('#roundDuration').fill('150'); await page.locator('#rotationDelay').fill('5');
  await expect(page.locator('#autoRotate')).toBeChecked();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await expect(page.locator('[data-map="alpine"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#auto-play')).toBeChecked();
  await page.locator('#open-settings').click();
  await expect(page.locator('#matchDuration')).toHaveValue('900'); await expect(page.locator('#roundDuration')).toHaveValue('150'); await expect(page.locator('#rotationDelay')).toHaveValue('5');
  await expect(page.locator('#soundPack')).toHaveValue('custom'); await expect(page.locator('#volume')).toHaveValue('27');
});

test('deathmatch exceeds the old kill cap and ends only at configured timeout, including draws', async ({ page }) => {
  await prepare(page, { matchDuration: 90 }); await deploy(page);
  expect(await page.evaluate(() => window.__OPENCS__.remaining)).toBeGreaterThan(88);
  const live = await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.scores = { blue: 80, red: 60 }; g.remaining = 20; g.checkMatch();
    return { phase: g.phase, screen: g.screen };
  });
  expect(live).toEqual({ phase: 'live', screen: 'playing' });
  await page.evaluate(() => { const g = window.__OPENCS__; g.remaining = 0; g.checkMatch(); g.update(1 / 60); });
  await expect(page.locator('.results-dialog')).toBeVisible();
  expect(await page.evaluate(() => ({ winner: window.__OPENCS__.winner, score: window.__OPENCS__.scores.blue }))).toEqual({ winner: 'blue', score: 80 });
  await page.locator('#rematch').click();
  await page.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.scores = { blue: 51, red: 51 }; g.remaining = 0; g.checkMatch(); g.update(1 / 60); });
  await expect(page.getByRole('heading', { name: 'STALEMATE.' })).toBeVisible();
});

test('auto mode rotates twice, preserves operator/session totals, resets match scores, and retains pointer lock', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page, { autoRotate: true, rotationDelay: 3 }); await deploy(page);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.player.kills = 7; g.player.deaths = 2;
    g.scores = { blue: 7, red: 3 }; g.remaining = 0; g.checkMatch(); g.update(1 / 60);
  });
  await expect(page.locator('#rotation-status')).toBeVisible();
  expect(await page.evaluate(() => ({ locked: document.pointerLockElement?.id, different: window.__OPENCS__.nextMap !== window.__OPENCS__.arena.id }))).toEqual({ locked: 'game', different: true });
  await expect(page.locator('.session-totals')).toContainText('BLUE 7 : 3 RED');
  await page.evaluate(() => { const g = window.__OPENCS__; g.nextMap = 'dust2_blockout'; for (let i = 0; i < 185; i++) g.update(1 / 60); });
  await expect(page.locator('#rotation-status')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const g = window.__OPENCS__;
    return { map: g.arena.id, screen: g.screen, kills: g.player.kills, deaths: g.player.deaths, scores: g.scores, session: g.sessionScores, completed: g.completedMatches, bodies: g.actors.every(a => a.body.body.isValid()), locked: document.pointerLockElement?.id };
  })).toEqual({ map: 'dust2_blockout', screen: 'playing', kills: 7, deaths: 2, scores: { blue: 0, red: 0 }, session: { blue: 7, red: 3 }, completed: 1, bodies: true, locked: 'game' });
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.scores = { blue: 2, red: 9 }; g.remaining = 0; g.checkMatch(); g.update(1 / 60);
    g.nextMap = 'foundry'; for (let i = 0; i < 185; i++) g.update(1 / 60);
  });
  expect(await page.evaluate(() => ({ map: window.__OPENCS__.arena.id, scores: window.__OPENCS__.sessionScores, completed: window.__OPENCS__.completedMatches, kills: window.__OPENCS__.player.kills }))).toEqual({ map: 'foundry', scores: { blue: 9, red: 12 }, completed: 2, kills: 7 });
  await page.keyboard.press('Escape'); await page.locator('#leave').click();
  await expect(page.locator('#deploy')).toBeVisible();
  expect(errors).toEqual([]);
});

test('released mouse requires a gesture to resume solo; scoreboard rotation can be stopped', async ({ page }) => {
  await prepare(page, { autoRotate: true, rotationDelay: 30 }); await deploy(page);
  await page.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.remaining = 0; g.checkMatch(); g.update(1 / 60); });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const g = window.__OPENCS__; g.rotationRemaining = .01; g.update(1 / 60); });
  await expect(page.locator('#resume')).toBeVisible();
  await page.locator('#resume').click();
  await page.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.remaining = 0; g.checkMatch(); g.update(1 / 60); });
  await page.keyboard.press('Escape'); await page.locator('#stop-rotation').click();
  await expect(page.locator('#rotation-status')).toHaveCount(0); await expect(page.locator('#rematch')).toBeVisible();
  expect(await page.evaluate(() => { const g = window.__OPENCS__; g.update(100); return g.screen; })).toBe('finished');
});

test('auto elimination advances rounds without a loadout interruption and resets wins on the next map', async ({ page }) => {
  await prepare(page, { mode: 'elimination', autoRotate: true, rotationDelay: 30, roundDuration: 45 }); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (let round = 0; round < 5; round++) {
      g.phase = 'live';
      for (const a of g.actors.filter(a => a.team === 'red')) { a.immunity = 0; g.damage(a, 200, g.player, 'ak'); }
      g.checkMatch(); g.update(1 / 60);
    }
    return { screen: g.screen, completed: g.completedMatches, next: !!g.nextMap, wins: g.sessionScores.blue, kills: g.player.kills };
  });
  expect(result).toEqual({ screen: 'finished', completed: 1, next: true, wins: 5, kills: 25 });
  await page.evaluate(() => { const g = window.__OPENCS__; g.rotationRemaining = 0; g.update(1 / 60); });
  expect(await page.evaluate(() => ({ round: window.__OPENCS__.round, scores: window.__OPENCS__.scores, remaining: Math.ceil(window.__OPENCS__.remaining), kills: window.__OPENCS__.player.kills }))).toEqual({ round: 1, scores: { blue: 0, red: 0 }, remaining: 45, kills: 25 });
});

for (const map of ['dust2_blockout', 'canopy', 'dockyard', 'alpine', 'redrock', 'quarter', 'foundry', 'pinewatch']) test(`${map} renders, spawns both teams, and runs real bot/physics simulation`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page, { map }); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (const a of g.actors) { a.brain.decision = 0; a.brain.pause = 0; }
    const initial = g.actors.map(a => a.position.clone());
    for (let i = 0; i < 360; i++) g.update(1 / 60);
    return { map: g.arena.id, actors: g.actors.length, finite: g.actors.every(a => a.position.toArray().every(Number.isFinite)), fallen: g.actors.some(a => a.position.y < -4), moved: g.actors.filter((a, i) => !a.human && a.position.distanceTo(initial[i]) > 1).length, levelObjects: g.view.level.children.length };
  });
  expect(result).toMatchObject({ map, actors: 10, finite: true, fallen: false });
  expect(result.moved).toBeGreaterThan(5);
  if (map === 'dust2_blockout') { expect(result.levelObjects).toBeLessThan(30); await page.screenshot({ path: 'test-results/dust2-blockout.png' }); }
  expect(errors).toEqual([]);
});

test('JSON blockout bots traverse the full arena and find combat without falling through floors', async ({ page }) => {
  await prepare(page, { map: 'dust2_blockout' }); await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__;
    for (const a of g.actors) { a.brain.decision = 0; a.brain.pause = 0; }
    for (let i = 0; i < 5400; i++) g.update(1 / 60);
    return { kills: g.scores.blue + g.scores.red, fallen: g.actors.some(a => a.position.y < -4), alive: g.actors.some(a => a.alive), time: g.remaining };
  });
  expect(result.kills).toBeGreaterThan(0); expect(result.fallen).toBe(false); expect(result.alive).toBe(true); expect(result.time).toBeGreaterThan(250);
});

test('LAN host rotates the shared map and cumulative scoreboard without recreating the room', async ({ browser }) => {
  const hc = await browser.newContext(), gc = await browser.newContext(), host = await hc.newPage(), guest = await gc.newPage();
  const errors: string[] = []; for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  try {
    await prepare(host, { autoRotate: true, rotationDelay: 30, teamSize: 1, botFill: false, matchDuration: 120 });
    await host.locator('#lan-play').click(); await host.locator('#lan-name').fill('Host'); await host.locator('#lan-create').click();
    const key = await host.locator('#room-key').textContent();
    await prepare(guest); await guest.locator('#lan-play').click(); await guest.locator('#lan-name').fill('Guest'); await guest.locator('#lan-key').fill(key!); await guest.locator('#lan-join').click();
    await expect(guest.locator('.lan-roster')).toContainText('Guest / YOU'); await host.locator('#lan-start').click();
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.network)).toBe(true);
    await host.evaluate(() => {
      const g = window.__OPENCS__; g.phase = 'live'; g.scores = { blue: 42, red: 4 }; g.player.kills = 42; g.actors[1].kills = 4;
      g.remaining = 0; g.checkMatch(); g.update(1 / 60);
    });
    await expect(guest.locator('#rotation-status')).toBeVisible();
    await guest.evaluate(() => window.__OPENCS__.stopRotation());
    expect(await guest.evaluate(() => !!window.__OPENCS__.nextMap)).toBe(true);
    await host.evaluate(() => { const g = window.__OPENCS__; g.nextMap = 'dust2_blockout'; g.rotationRemaining = .01; });
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.arena.id)).toBe('dust2_blockout');
    expect(await guest.evaluate(() => {
      const g = window.__OPENCS__;
      return { totals: g.sessionScores, match: g.scores, kills: g.player.kills, room: g.lan.room?.key, duration: g.settings.matchDuration, names: g.actors.map(a => a.name) };
    })).toEqual({ totals: { blue: 42, red: 4 }, match: { blue: 0, red: 0 }, kills: 4, room: key, duration: 120, names: ['Host', 'Guest'] });
    await guest.evaluate(() => window.__OPENCS__.toMenu());
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.screen)).toBe('finished');
    expect(await host.evaluate(() => window.__OPENCS__.nextMap)).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await hc.close(); await gc.close(); }
});

for (const fill of [false, true]) test(`LAN scoreboard departure ${fill ? 'keeps a stable bot slot across rotation' : 'stops rotation when a human-only team empties'}`, async ({ browser }) => {
  const hc = await browser.newContext(), gc = await browser.newContext(), host = await hc.newPage(), guest = await gc.newPage();
  try {
    await prepare(host, { autoRotate: true, rotationDelay: 30, teamSize: fill ? 2 : 1, botFill: fill });
    await host.locator('#lan-play').click(); await host.locator('#lan-name').fill('Host'); await host.locator('#lan-create').click();
    const key = await host.locator('#room-key').textContent();
    await prepare(guest); await guest.locator('#lan-play').click(); await guest.locator('#lan-name').fill('Guest'); await guest.locator('#lan-key').fill(key!); await guest.locator('#lan-join').click();
    await expect(guest.locator('.lan-roster')).toContainText('Guest / YOU'); await host.locator('#lan-start').click();
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.network)).toBe(true);
    await host.evaluate(() => { const g = window.__OPENCS__; g.phase = 'live'; g.remaining = 0; g.checkMatch(); g.update(1 / 60); });
    await expect(guest.locator('#rotation-status')).toBeVisible();
    await guest.evaluate(() => window.__OPENCS__.toMenu());
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].human)).toBe(false);
    if (fill) {
      await host.evaluate(() => { const g = window.__OPENCS__; g.nextMap = 'foundry'; g.rotationRemaining = 0; });
      await expect.poll(() => host.evaluate(() => window.__OPENCS__.arena.id)).toBe('foundry');
      expect(await host.evaluate(() => ({ id: window.__OPENCS__.actors[1].id, human: window.__OPENCS__.actors[1].human, alive: window.__OPENCS__.actors[1].alive, count: window.__OPENCS__.actors.length }))).toEqual({ id: 1, human: false, alive: true, count: 4 });
    } else {
      expect(await host.evaluate(() => { const g = window.__OPENCS__; g.update(100); return { screen: g.screen, next: g.nextMap, map: g.arena.id }; })).toEqual({ screen: 'finished', next: undefined, map: 'india' });
    }
  } finally { await hc.close(); await gc.close(); }
});
