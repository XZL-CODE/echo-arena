// 冒烟测试：客户端能打开、开始一轮、进入战斗，并把存档写进用户数据目录。
// CI 在 macOS 与 Windows 上也用打包好的程序运行全部端到端测试。
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchClient, screenshotPath } from './client';

test('客户端启动、开始一轮并写入本地存档', async () => {
  const { app, page, userData } = await launchClient();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('body[data-ready]', { timeout: 30_000 });
  expect(await page.title()).toBe('回声竞技场');
  expect(await page.evaluate(() => document.body.dataset.ready)).toBe('file');
  await page.screenshot({ path: screenshotPath('smoke-title') });

  await page.click('[data-testid=start]');
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  await page.screenshot({ path: screenshotPath('smoke-prep') });
  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: screenshotPath('smoke-battle') });

  await app.close();
  expect(errors).toEqual([]);
  const save = JSON.parse(fs.readFileSync(path.join(userData, 'save.json'), 'utf8'));
  expect(save.app).toBe('echo-arena');
  expect(save.run.inBattle).toBe(true);
});
