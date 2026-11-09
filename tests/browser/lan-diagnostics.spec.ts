import { expect, test } from '@playwright/test';

test('standalone LAN diagnostics check HTTP and WebSocket without loading game assets', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/__lan');
  await expect(page.locator('#report')).toContainText('HTTP PASS');
  await expect(page.locator('#report')).toContainText('WebSocket PASS');
  expect(requests.every(path => path === '/__lan' || path === '/__lan/health')).toBe(true);
  expect(await page.evaluate(() => '__OPENCS__' in window)).toBe(false);
  await page.locator('#retry').click();
  await expect(page.locator('#report')).toContainText('WebSocket PASS');
  expect(errors).toEqual([]);
});
