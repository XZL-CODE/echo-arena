// 流程测试：打完一场到下一场、战斗中途关闭后继续、输了重来、设置保存与清除存档。
// 用测试钩子（window.__echo）快进战斗、直接摆出指定对局，结果由固定种子决定。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchClient, readSave, ready, screenshotPath, type SaveFile } from './client';

interface Hooks {
  fastForward(seconds: number): void;
  result(): 'win' | 'lose' | null;
  run(): SaveFile['run'];
  setupRun(encounterId: string, modules: Array<[string, number]>, matchIndex?: number): void;
}
type HookWindow = { __echo: Hooks };

async function setupRun(
  page: Page,
  encounterId: string,
  modules: Array<[string, number]>,
  matchIndex: number,
): Promise<void> {
  await page.evaluate(
    ([id, mods, index]) => (window as unknown as HookWindow).__echo.setupRun(id, mods, index),
    [encounterId, modules, matchIndex] as const,
  );
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
}

async function currentRun(page: Page): Promise<NonNullable<SaveFile['run']>> {
  const run = await page.evaluate(() => (window as unknown as HookWindow).__echo.run());
  if (!run) throw new Error('没有进行中的一轮');
  return run;
}

/** 快进到分出胜负，返回结果。 */
async function finishBattle(page: Page): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const result = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      echo.fastForward(20);
      return echo.result();
    });
    if (result) return result;
  }
  throw new Error('战斗没有在 240 秒内结束');
}

async function fight(page: Page): Promise<void> {
  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
}

test('打赢一场、挑选奖励、进入下一场，进度写进存档', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await setupRun(page, 'volley', [['reflect', 1]], 0);
  await fight(page);
  expect(await finishBattle(page)).toBe('win');

  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: screenshotPath('flow-result'), animations: 'disabled' });
  await page.click('[data-testid=result-next]');
  await expect(page.locator('[data-testid=reward]')).toBeVisible();
  const offers = page.locator('[data-testid^=offer-]');
  await expect(offers).toHaveCount(3);
  const picked = ((await offers.first().getAttribute('data-testid')) ?? '').slice('offer-'.length);
  await offers.first().click();
  await page.screenshot({ path: screenshotPath('flow-reward'), animations: 'disabled' });
  await page.click('[data-testid=reward-confirm]');

  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  await expect(page.locator('.match-no')).toHaveText('第 2 / 7 场');
  const run = await currentRun(page);
  expect(run.matchIndex).toBe(1);
  expect(run.records[0]?.won).toBe(true);
  expect(run.levels[picked]).toBeGreaterThanOrEqual(1);

  await app.close();
  const save = readSave(userData);
  expect(save?.run?.matchIndex).toBe(1);
  expect(save?.run?.phase).toBe('prep');
  expect(save?.run?.levels[picked]).toBe(run.levels[picked]);
  expect(errors).toEqual([]);
});

test('战斗中关闭客户端，重开后回到这一场的战前准备', async () => {
  const first = await launchClient({ hooks: true });
  const firstErrors = await ready(first.page);
  await setupRun(
    first.page,
    'shellwall',
    [
      ['charge', 1],
      ['ricochet', 1],
    ],
    2,
  );
  await fight(first.page);
  await first.page.evaluate(() => (window as unknown as HookWindow).__echo.fastForward(5));
  await first.app.close();
  expect(firstErrors).toEqual([]);
  expect(readSave(first.userData)?.run?.inBattle).toBe(true);

  const second = await launchClient({ userData: first.userData, hooks: true });
  const errors = await ready(second.page);
  await expect(second.page.locator('[data-testid=resume-note]')).toContainText('战斗中离开');
  await second.page.screenshot({ path: screenshotPath('flow-resume-title') });
  await second.page.click('[data-testid=continue]');
  await expect(second.page.locator('[data-testid=fight]')).toBeVisible();
  await expect(second.page.locator('[data-testid=match-name]')).toHaveText('壳壳盾阵');
  const run = await currentRun(second.page);
  expect(run.matchIndex).toBe(2);
  expect(run.inBattle).toBe(false);
  expect(run.levels).toEqual({ charge: 1, ricochet: 1 });
  expect(run.records[2]?.attempts).toBe(1);
  await second.app.close();
  expect(errors).toEqual([]);
});

test('输了可以原样重来或回去调整，已拿到的招式不丢', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await setupRun(page, 'king', [['bulwark', 1]], 6);
  await fight(page);
  expect(await finishBattle(page)).toBe('lose');
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });

  await page.click('[data-testid=result-retry]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  let run = await currentRun(page);
  expect(run.matchIndex).toBe(6);
  expect(run.records[6]?.attempts).toBe(2);
  expect(run.levels).toEqual({ bulwark: 1 });

  expect(await finishBattle(page)).toBe('lose');
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.click('[data-testid=result-adjust]');
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  run = await currentRun(page);
  expect(run.inBattle).toBe(false);
  expect(run.matchIndex).toBe(6);
  expect(run.levels).toEqual({ bulwark: 1 });
  await app.close();
  expect(errors).toEqual([]);
});

test('设置在重开后保留', async () => {
  const first = await launchClient();
  const firstErrors = await ready(first.page);
  await first.page.click('[data-testid=title-settings]');
  const dialog = first.page.locator('[data-testid=settings]');
  await expect(dialog.getByLabel('显示伤害数字')).toBeChecked();
  await dialog.locator('label.toggle', { hasText: '显示伤害数字' }).click();
  await expect(dialog.getByLabel('显示伤害数字')).not.toBeChecked();
  await expect.poll(() => readSave(first.userData)?.settings.damageNumbers).toBe(false);
  await first.app.close();
  expect(firstErrors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors = await ready(second.page);
  await second.page.click('[data-testid=title-settings]');
  await expect(
    second.page.locator('[data-testid=settings]').getByLabel('显示伤害数字'),
  ).not.toBeChecked();
  await second.app.close();
  expect(errors).toEqual([]);
});

test('清除全部存档后回到第一次打开的状态，并留一份备份', async () => {
  const first = await launchClient();
  const firstErrors = await ready(first.page);
  await first.page.click('[data-testid=start]');
  await expect(first.page.locator('[data-testid=fight]')).toBeVisible();
  await expect.poll(() => readSave(first.userData)?.run?.matchIndex).toBe(0);

  await first.page.getByRole('button', { name: '设置' }).click();
  await first.page.click('[data-testid=reset-all]');
  await first.page.click('[data-testid=confirm-ok]');
  await expect(first.page.locator('[data-testid=start]')).toBeVisible();
  await expect(first.page.locator('[data-testid=continue]')).toHaveCount(0);
  expect(fs.existsSync(path.join(first.userData, 'save.backup.json'))).toBe(true);
  await first.app.close();
  expect(firstErrors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors = await ready(second.page);
  await expect(second.page.locator('[data-testid=start]')).toBeVisible();
  await expect(second.page.locator('[data-testid=continue]')).toHaveCount(0);
  expect(readSave(second.userData)?.run ?? null).toBeNull();
  await second.app.close();
  expect(errors).toEqual([]);
});
