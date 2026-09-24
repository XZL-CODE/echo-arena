// 冒烟测试：客户端能打开窗口、显示游戏、把存档写进用户数据目录。
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchClient, screenshotPath } from './client';

test('客户端启动并写入本地存档', async () => {
  const { app, page, userData } = await launchClient();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('body[data-ready]', { timeout: 30_000 });
  expect(await page.title()).toBe('回声竞技场');
  expect(await page.evaluate(() => document.body.dataset.ready)).toBe('file');
  await page.screenshot({ path: screenshotPath('smoke') });
  await app.close();
  expect(errors).toEqual([]);
  expect(fs.existsSync(path.join(userData, 'save.json'))).toBe(true);
});
