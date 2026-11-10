import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript(settings => localStorage.setItem('opencs.settings', JSON.stringify({ map: 'india', primary: 'ak', freezeTime: 0, volume: 0, radioChatter: false, shadows: false, ...settings })), settings);
  await page.goto('/');
}

async function deploy(page: Page) {
  await page.locator('#deploy').click();
  if (await page.locator('#resume').isVisible()) await page.locator('#resume').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await page.evaluate(() => { for (const a of window.__OPENCS__.actors) { a.brain.decision = 1e6; a.brain.pause = 1e6; } });
}

test('B opens the deathmatch picker; swapping primaries keeps ammo, health, utility and scores', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page); await deploy(page);
  await expect(page.locator('#loadout-hint')).toBeVisible();
  await page.keyboard.press('KeyB');
  await expect(page.getByRole('group', { name: 'Deathmatch primary' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player;
    p.health = 37; p.ammo.ak = { clip: 7, reserve: 3 }; p.ammo.pistol.clip = 5; p.ammo.he.clip = 0;
    p.cooldown = .7; p.reload = 2; p.kills = 9; g.scores.blue = 9;
  });
  await page.locator('[data-deathmatch-primary="m4"]').click();
  expect(await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player;
    return { primary: p.primary, weapon: p.weapon, ammo: p.ammo.m4, health: p.health, pistol: p.ammo.pistol.clip, he: p.ammo.he.clip, reload: p.reload, switching: p.switching, kills: p.kills, score: g.scores.blue, inventory: p.weapons.includes('ak') };
  })).toEqual({ primary: 'm4', weapon: 'm4', ammo: { clip: 30, reserve: 90 }, health: 37, pistol: 5, he: 0, reload: 0, switching: .25, kills: 9, score: 9, inventory: false });
  await expect(page.locator('[data-deathmatch-primary="m4"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-deathmatch-primary="awp"]').click();
  await page.locator('[data-deathmatch-primary="ak"]').click();
  expect(await page.evaluate(() => ({ ammo: window.__OPENCS__.player.ammo.ak, cooldown: window.__OPENCS__.player.cooldown }))).toEqual({ ammo: { clip: 7, reserve: 3 }, cooldown: .7 });
  await page.locator('[data-deathmatch-primary="awp"]').click();
  await page.locator('#resume').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await expect(page.locator('#weapon-name')).toHaveText('AWP');
  await expect(page.locator('#weapon-slots')).toContainText('AWP');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('opencs.settings')!).primary)).toBe('awp');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-deathmatch-primary="awp"]')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/deathmatch-loadout.png' });
  expect(errors).toEqual([]);
});

test('dead players can choose a primary without reviving and keep it through respawn and rotation', async ({ page }) => {
  await prepare(page, { autoRotate: true, rotationDelay: 30, roundEndDelay: 0 }); await deploy(page);
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.player.immunity = 0;
    g.damage(g.player, 200, g.actors.find(a => a.team !== g.player.team)!, 'ak');
  });
  await page.keyboard.press('KeyB');
  await expect(page.getByRole('group', { name: 'Deathmatch primary' })).toBeVisible();
  await page.locator('[data-deathmatch-primary="m4"]').click();
  expect(await page.evaluate(() => ({ alive: window.__OPENCS__.player.alive, health: window.__OPENCS__.player.health, primary: window.__OPENCS__.player.primary }))).toEqual({ alive: false, health: 0, primary: 'm4' });
  await page.locator('#resume').click();
  await page.evaluate(() => { const g = window.__OPENCS__; g.player.respawn = 0; g.update(1 / 60); });
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.player.alive)).toBe(true);
  await expect(page.locator('#weapon-name')).toHaveText('M4A1');
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.remaining = 0; g.checkMatch(); g.update(1 / 60);
    g.nextMap = 'foundry'; g.rotationRemaining = 0; g.update(1 / 60);
  });
  expect(await page.evaluate(() => ({ map: window.__OPENCS__.arena.id, primary: window.__OPENCS__.player.primary, weapon: window.__OPENCS__.player.weapon }))).toEqual({ map: 'foundry', primary: 'm4', weapon: 'm4' });
});

for (const allowedWeapons of [['ak', 'awp'], ['pistol']]) test(`deathmatch picker respects restrictions: ${allowedWeapons.join('/')}`, async ({ page }) => {
  await prepare(page, { allowedWeapons }); await deploy(page);
  await page.keyboard.press('KeyB');
  await expect(page.locator('[data-deathmatch-primary="m4"]')).toBeDisabled();
  expect(await page.evaluate(() => window.__OPENCS__.changeDeathmatchPrimary('m4'))).toBe(false);
  for (const primary of ['ak', 'awp']) {
    if (allowedWeapons.includes(primary)) await expect(page.locator(`[data-deathmatch-primary="${primary}"]`)).toBeEnabled();
    else await expect(page.locator(`[data-deathmatch-primary="${primary}"]`)).toBeDisabled();
  }
});

test('elimination retains between-round-only loadout rules', async ({ page }) => {
  await prepare(page, { mode: 'elimination' }); await deploy(page);
  await expect(page.locator('#loadout-hint')).toBeHidden();
  await page.keyboard.press('KeyB');
  expect(await page.evaluate(() => window.__OPENCS__.screen)).toBe('playing');
  expect(await page.evaluate(() => window.__OPENCS__.changeDeathmatchPrimary('awp'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Deathmatch primary' })).toHaveCount(0);
});

test('LAN guests and hosts can change primary while live, with host validation and synchronized equipment', async ({ browser }) => {
  const hc = await browser.newContext(), gc = await browser.newContext(), host = await hc.newPage(), guest = await gc.newPage();
  const errors: string[] = []; for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  try {
    await prepare(host, { teamSize: 1, botFill: false, allowedWeapons: ['ak', 'awp', 'pistol'] });
    await host.locator('#lan-play').click(); await host.locator('#lan-name').fill('Host'); await host.locator('#lan-create').click();
    const key = await host.locator('#room-key').textContent();
    await prepare(guest); await guest.locator('#lan-play').click(); await guest.locator('#lan-name').fill('Guest'); await guest.locator('#lan-key').fill(key!); await guest.locator('#lan-join').click();
    await expect(guest.locator('.lan-roster')).toContainText('Guest / YOU'); await host.locator('#lan-start').click();
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.network)).toBe(true);
    if (await guest.locator('#resume').isVisible()) await guest.locator('#resume').click();
    await guest.keyboard.press('KeyB');
    await expect(guest.locator('[data-deathmatch-primary="m4"]')).toBeDisabled();
    await host.evaluate(() => { const p = window.__OPENCS__.actors[1]; p.health = 42; p.ammo.ak.clip = 7; p.ammo.pistol.clip = 3; });
    await guest.locator('[data-deathmatch-primary="awp"]').click();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].weapon)).toBe('awp');
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.weapon)).toBe('awp');
    expect(await host.evaluate(() => ({ health: window.__OPENCS__.actors[1].health, pistol: window.__OPENCS__.actors[1].ammo.pistol.clip, hostPrimary: window.__OPENCS__.player.primary }))).toEqual({ health: 42, pistol: 3, hostPrimary: 'ak' });
    await guest.locator('[data-deathmatch-primary="ak"]').click();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].weapon)).toBe('ak');
    expect(await host.evaluate(() => window.__OPENCS__.actors[1].ammo.ak.clip)).toBe(7);
    // Bypass the guest UI to verify the authority still refuses a banned gun.
    await guest.evaluate(() => window.__OPENCS__.lan.send({ type: 'primary', primary: 'm4' }));
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].primary)).toBe('ak');
    // Keep host mouse released: host-side pause must not block a guest request.
    await host.evaluate(() => window.__OPENCS__.pause());
    await host.locator('[data-deathmatch-primary="awp"]').click();
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.actors[0].weapon)).toBe('awp');
    await guest.locator('[data-deathmatch-primary="awp"]').click();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].weapon)).toBe('awp');
    const time = await guest.evaluate(() => window.__OPENCS__.time);
    expect(await host.evaluate(() => window.__OPENCS__.actors[1].ammo.m4.clip)).toBe(0);
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.time)).toBeGreaterThan(time + .2);
    await host.evaluate(() => { const g = window.__OPENCS__, p = g.actors[1]; p.immunity = 0; g.damage(p, 200, g.player, 'ak'); p.respawn = 30; });
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.alive)).toBe(false);
    await guest.locator('[data-deathmatch-primary="ak"]').click();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].primary)).toBe('ak');
    expect(await host.evaluate(() => window.__OPENCS__.actors[1].alive)).toBe(false);
    await host.evaluate(() => { window.__OPENCS__.actors[1].respawn = 0; });
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.alive)).toBe(true);
    expect(await guest.evaluate(() => window.__OPENCS__.player.weapon)).toBe('ak');
    // Results/end buffers must reject requests rather than alter the next match's loadout.
    await host.evaluate(() => { const g = window.__OPENCS__; g.phase = 'between'; g.phaseTime = 30; });
    await guest.evaluate(() => window.__OPENCS__.lan.send({ type: 'primary', primary: 'awp' }));
    const tick = await guest.evaluate(() => window.__OPENCS__.time);
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.time)).toBeGreaterThan(tick + .1);
    expect(await host.evaluate(() => window.__OPENCS__.actors[1].primary)).toBe('ak');
    expect(errors).toEqual([]);
  } finally { await hc.close(); await gc.close(); }
});
