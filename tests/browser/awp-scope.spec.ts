import { expect, test, type Page } from '@playwright/test';

async function deploy(page: Page) {
  await page.addInitScript(() => localStorage.setItem('opencs.settings', JSON.stringify({ map: 'india', primary: 'awp', freezeTime: 0, volume: 0, radioChatter: false, shadows: false })));
  await page.goto('/'); await page.locator('#deploy').click();
  if (await page.locator('#resume').isVisible()) await page.locator('#resume').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game');
  await page.evaluate(() => {
    const g = window.__OPENCS__; g.phase = 'live'; g.player.switching = 0; g.player.pitch = 1.4;
    for (const a of g.actors) { a.brain.decision = 1e6; a.brain.pause = 1e6; }
  });
}

for (const level of [1, 2]) test(`AWP returns to zoom level ${level} after its bolt animation`, async ({ page }) => {
  await deploy(page);
  for (let i = 0; i < level; i++) await page.mouse.click(720, 450, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.scopeLevel)).toBe(level);
  const fov = await page.evaluate(() => { window.__OPENCS__.camera(0); return window.__OPENCS__.view.camera.fov; });
  await page.mouse.click(720, 450);
  await expect(page.locator('#scope')).toBeHidden();
  expect(await page.evaluate(() => window.__OPENCS__.player.ammo.awp.clip)).toBe(4);
  await expect.poll(() => page.evaluate(() => window.__OPENCS__.scopeLevel)).toBe(level);
  await expect(page.locator('#scope')).toBeVisible();
  expect(await page.evaluate(() => ({ fov: window.__OPENCS__.view.camera.fov, age: window.__OPENCS__.player.awpShotAge >= .72 }))).toEqual({ fov, age: true });
});

test('AWP stays unscoped until the bolt finishes, and unscoped shots do not auto-zoom', async ({ page }) => {
  await deploy(page);
  const result = await page.evaluate(() => {
    const g = window.__OPENCS__, p = g.player, direction = p.position.clone().set(0, 1, 0);
    g.scopeLevel = 2; g.shoot(p, direction);
    const fired = g.scopeLevel;
    for (let i = 0; i < 42; i++) g.update(1 / 60);
    const cycling = g.scopeLevel;
    for (let i = 0; i < 2; i++) g.update(1 / 60);
    const recovered = g.scopeLevel;
    g.scoped = false; p.cooldown = 0; g.shoot(p, direction);
    for (let i = 0; i < 50; i++) g.update(1 / 60);
    return { fired, cycling, recovered, unscoped: g.scopeLevel };
  });
  expect(result).toEqual({ fired: 0, cycling: 0, recovered: 2, unscoped: 0 });
});

for (const action of ['switch', 'reload', 'sprint', 'manual zoom', 'death', 'primary change', 'round reset'] as const) test(`${action} cancels the AWP's pending zoom return`, async ({ page }) => {
  await deploy(page);
  const level = await page.evaluate(action => {
    const g = window.__OPENCS__, p = g.player;
    g.scopeLevel = 2; g.shoot(p, p.position.clone().set(0, 1, 0));
    const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    if (action === 'switch') { key('KeyQ'); key('KeyQ'); }
    if (action === 'reload') key('KeyR');
    if (action === 'sprint') { key('KeyW'); key('ShiftLeft'); g.update(1 / 60); }
    if (action === 'manual zoom') window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    if (action === 'death') { p.immunity = 0; g.damage(p, 200, g.actors.find(a => a.team !== p.team)!, 'ak'); }
    if (action === 'primary change') { g.changeDeathmatchPrimary('ak'); g.changeDeathmatchPrimary('awp'); }
    if (action === 'round reset') g.resetActors();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    return g.scopeLevel;
  }, action);
  // A deliberate right-click chooses the first zoom; it must not jump back to level two.
  expect(level).toBe(action === 'manual zoom' ? 1 : 0);
});
