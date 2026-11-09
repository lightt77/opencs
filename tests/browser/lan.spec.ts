import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, bots: boolean, mode = 'tdm', grenadePower = 34) {
  await page.addInitScript(({ bots, mode, grenadePower }) => localStorage.setItem('opencs.settings', JSON.stringify({ map: 'india', mode, teamSize: 2, botFill: bots, freezeTime: 0, volume: 0, radioChatter: false, grenadePower })), { bots, mode, grenadePower });
  await page.goto('/');
  await page.locator('#lan-play').click();
}
async function room(host: Page, guest: Page, bots: boolean, mode = 'tdm') {
  await prepare(host, bots, mode, 60); await host.locator('#lan-name').fill('Host'); await host.locator('#lan-create').click();
  const key = await host.locator('#room-key').textContent();
  await prepare(guest, bots, mode); await guest.locator('#lan-name').fill('Guest'); await guest.locator('#lan-key').fill(key!); await guest.locator('#lan-join').click();
  await expect(guest.locator('.lan-roster')).toContainText('Guest / YOU');
  await expect(guest.locator('#lan-status')).toContainText('smaller team');
  await host.locator('#lan-start').click();
  await expect.poll(() => guest.evaluate(() => window.__OPENCS__.network)).toBe(true);
  if (await guest.locator('#resume').isVisible()) await guest.locator('#resume').click();
  await expect.poll(() => guest.evaluate(() => document.pointerLockElement?.id)).toBe('game');
}

test('LAN human-only match: balanced rooms, remote movement/equipment/fire, shared score, live pause and host disconnect', async ({ browser }) => {
  const hc = await browser.newContext(), gc = await browser.newContext();
  const host = await hc.newPage(), guest = await gc.newPage();
  const errors: string[] = []; host.on('pageerror', e => errors.push(e.message)); guest.on('pageerror', e => errors.push(e.message));
  try {
    await room(host, guest, false);
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors.length)).toBe(2);
    expect(await guest.evaluate(() => ({ name: window.__OPENCS__.player.name, team: window.__OPENCS__.player.team, humans: window.__OPENCS__.actors.filter(a => a.human).length }))).toEqual({ name: 'Guest', team: 'red', humans: 2 });
    const before = await guest.evaluate(() => window.__OPENCS__.player.position.z);
    await guest.keyboard.down('KeyW');
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].position.z)).toBeGreaterThan(before + .5);
    await guest.keyboard.up('KeyW');
    await guest.keyboard.press('Digit2');
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].weapon)).toBe('pistol');
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.weapon)).toBe('pistol');
    await host.evaluate(() => {
      const g = window.__OPENCS__;
      g.arena = { ...g.arena, boxes: [] };
      g.player.reset({ x: -3, z: 25 }, 0); g.player.health = 1;
      g.actors[1].reset({ x: 3, z: 25 }, 0);
    });
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.position.x)).toBeGreaterThan(2.9);
    await guest.evaluate(() => { const p = window.__OPENCS__.player; p.yaw = Math.PI / 2; p.pitch = 0; });
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].switching)).toBe(0);
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].yaw)).toBeGreaterThan(1.5);
    await guest.mouse.down(); await guest.mouse.up();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.scores.red)).toBe(1);
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.scores.red)).toBe(1);
    expect(await guest.evaluate(() => window.__OPENCS__.player.kills)).toBe(1);
    await guest.keyboard.press('Escape');
    await expect(guest.getByRole('heading', { name: 'MOUSE RELEASED' })).toBeVisible();
    await guest.locator('#pause-settings').click();
    await expect(guest.locator('#movementSpeed')).toBeDisabled();
    await expect(guest.locator('#grenadePower')).toBeDisabled();
    await expect(guest.locator('#grenadePower')).toHaveValue('60');
    await expect(guest.locator('#volume')).toBeEnabled();
    await guest.getByRole('button', { name: 'Close settings' }).click();
    const time = await guest.evaluate(() => window.__OPENCS__.time);
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.time)).toBeGreaterThan(time + .2);
    await host.evaluate(() => window.__OPENCS__.toMenu());
    await expect(guest.locator('#lan-status')).toContainText('host left');
    expect(errors).toEqual([]);
  } finally { await hc.close(); await gc.close(); }
});

test('LAN bot fill, grenade synchronization, and host-controlled elimination intermission', async ({ browser }) => {
  const hc = await browser.newContext(), gc = await browser.newContext();
  const host = await hc.newPage(), guest = await gc.newPage();
  const errors: string[] = []; host.on('pageerror', e => errors.push(e.message)); guest.on('pageerror', e => errors.push(e.message));
  try {
    await room(host, guest, true, 'elimination');
    expect(await host.evaluate(() => window.__OPENCS__.actors.length)).toBe(4);
    expect(await guest.evaluate(() => window.__OPENCS__.actors.filter(a => !a.human).length)).toBe(2);
    await host.evaluate(() => { for (const a of window.__OPENCS__.actors) { a.brain.decision = 1e6; a.brain.pause = 1e6; } });
    await guest.keyboard.press('Digit4');
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.weapon)).toBe('he');
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.switching)).toBe(0);
    await guest.mouse.down();
    await expect(guest.locator('#grenade-charge')).toBeVisible();
    await guest.mouse.up();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].ammo.he.clip)).toBe(0);
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.player.ammo.he.clip)).toBe(0);
    await host.evaluate(() => {
      const g = window.__OPENCS__; g.settings.roundEndDelay = 0;
      for (const a of g.actors.filter(a => a.team === 'red')) { a.immunity = 0; g.damage(a, 100, g.player, 'ak', true); }
    });
    await expect(host.locator('#continue-round')).toBeVisible();
    await expect(guest.locator('#continue-round')).toBeDisabled();
    expect(await guest.evaluate(() => window.__OPENCS__.scores.blue)).toBe(1);
    await guest.locator('[data-round-primary="awp"]').click();
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].primary)).toBe('awp');
    await host.locator('#continue-round').click();
    await expect.poll(() => guest.evaluate(() => window.__OPENCS__.round)).toBe(2);
    await expect(guest.locator('#resume')).toBeVisible();
    await guest.locator('#resume').click();
    expect(await guest.evaluate(() => window.__OPENCS__.player.alive)).toBe(true);
    expect(await guest.evaluate(() => window.__OPENCS__.player.weapon)).toBe('awp');
    await guest.evaluate(() => window.__OPENCS__.toMenu());
    await expect.poll(() => host.evaluate(() => window.__OPENCS__.actors[1].human)).toBe(false);
    expect(await host.evaluate(() => window.__OPENCS__.actors[1].alive)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await hc.close(); await gc.close(); }
});

test('configurable team counts and grenade physics persist, lethal blasts launch away from blast rather than thrower', async ({ page }) => {
  await page.goto('/'); await page.locator('#open-settings').click();
  await page.locator('#teamSize').fill('3'); await page.locator('#grenadePower').fill('60');
  await page.locator('#grenadeWeight').selectOption('heavy'); await page.locator('#grenadeBounce').uncheck();
  await page.getByRole('button', { name: 'Close settings' }).click(); await page.reload();
  await page.locator('#deploy').click();
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, victim = g.actors[3];
    const blast = victim.position.clone(); blast.x -= 1;
    victim.immunity = 0;
    (g as unknown as { damage(v: typeof victim, n: number, a: typeof victim, w: string, h: boolean, p: typeof blast): void }).damage(victim, 100, g.player, 'he', false, blast);
    const origin = victim.position.clone();
    (g as unknown as { updateDeath(a: typeof victim, dt: number): void }).updateDeath(victim, .4);
    return { count: g.actors.length, power: g.settings.grenadePower, weight: g.settings.grenadeWeight, bounce: g.settings.grenadeBounce, upward: victim.position.y - origin.y, direction: victim.deathDirection.x, blast: victim.deathBlast };
  });
  expect(result).toEqual({ count: 6, power: 60, weight: 'heavy', bounce: false, upward: 1.6, direction: 1, blast: true });
});
