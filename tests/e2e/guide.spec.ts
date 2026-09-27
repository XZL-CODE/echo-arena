// 新手指引：新安装后跟着第一场自动出现、可以跳过、“？”随时重看，老玩家的存档不弹出。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchClient, readSave, ready, screenshotPath } from './client';

type HookWindow = { __echo: { fastForward(seconds: number): void; result(): string | null } };

const guide = (page: Page) => page.locator('[data-testid=guide]');
const guideTitle = (page: Page) => page.locator('[data-testid=guide-title]');

/** 快进到分出胜负（结果不重要，只要进入结算）。 */
async function finishBattle(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const result = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      echo.fastForward(20);
      return echo.result();
    });
    if (result) return;
  }
  throw new Error('战斗没有在 240 秒内结束');
}

test('新安装：第一场的准备、战斗、结算各讲一段，看完后重启不再出现', async () => {
  const first = await launchClient({ hooks: true });
  const page = first.page;
  const errors = await ready(page);
  // 标题页不弹，点“开始”进入第一场准备时才出现。
  await expect(page.locator('[data-testid=start]')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await page.click('[data-testid=start]');
  await expect(guideTitle(page)).toHaveText('本场目标');
  for (const title of ['开局招式', '队伍配置', '站位', '开战']) {
    await page.click('[data-testid=guide-next]');
    await expect(guideTitle(page)).toHaveText(title);
  }
  await page.screenshot({ path: screenshotPath('guide-prep'), animations: 'disabled' });

  // 在“开战”这一步直接点被圈出的开战按钮，战斗部分接着讲，讲的时候战斗暂停。
  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await expect(guideTitle(page)).toHaveText('暂停');
  const timer = page.locator('[data-testid=timer]');
  await page.waitForTimeout(1200);
  await expect(timer).toHaveText('0:00');
  for (const title of ['主动招式', '集火', '回响']) {
    await page.keyboard.press('ArrowRight');
    await expect(guideTitle(page)).toHaveText(title);
  }
  await page.screenshot({ path: screenshotPath('guide-battle'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(guide(page)).toBeHidden();
  await expect(timer).not.toHaveText('0:00', { timeout: 5_000 });

  await finishBattle(page);
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(guideTitle(page)).toHaveText('胜负之后');
  await page.click('[data-testid=guide-next]');
  await expect(guide(page)).toBeHidden();
  await expect
    .poll(() => readSave(first.userData)?.settings.guideSeen)
    .toEqual(['prep', 'battle', 'result']);
  await first.app.close();
  expect(errors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors2 = await ready(second.page);
  await second.page.click('[data-testid=continue]');
  await expect(second.page.locator('[data-testid=guide-open]')).toBeVisible();
  await second.page.waitForTimeout(600);
  await expect(guide(second.page)).toBeHidden();
  await second.app.close();
  expect(errors2).toEqual([]);
});

test('跳过：一次跳过整个指引，开战和重启后都不再出现', async () => {
  const first = await launchClient();
  const page = first.page;
  const errors = await ready(page);
  await page.click('[data-testid=start]');
  await expect(guideTitle(page)).toHaveText('本场目标');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();
  await expect
    .poll(() => readSave(first.userData)?.settings.guideSeen)
    .toEqual(['prep', 'battle', 'result']);

  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('[data-testid=timer]')).not.toHaveText('0:00', { timeout: 5_000 });
  await first.app.close();
  expect(errors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors2 = await ready(second.page);
  await second.page.click('[data-testid=continue]');
  await expect(second.page.locator('[data-testid=fight]')).toBeVisible();
  await second.page.waitForTimeout(600);
  await expect(guide(second.page)).toBeHidden();
  await second.app.close();
  expect(errors2).toEqual([]);
});

test('“？”随时重看：标题页翻看全部，准备阶段重看这一段，战斗中重看会暂停', async () => {
  const { app, page } = await launchClient();
  const errors = await ready(page);

  await page.click('[data-testid=title-guide]');
  await expect(guide(page)).toContainText('1 / 10');
  await expect(guideTitle(page)).toHaveText('本场目标');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('开局招式');
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=start]');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=guide-open]');
  await expect(guideTitle(page)).toHaveText('本场目标');
  await expect(page.locator('[data-testid=guide-skip]')).toHaveText('关闭');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=fight]');
  const timer = page.locator('[data-testid=timer]');
  await expect(timer).not.toHaveText('0:00', { timeout: 5_000 });
  await page.click('[data-testid=guide-open]');
  await expect(guideTitle(page)).toHaveText('暂停');
  const frozen = (await timer.textContent()) ?? '';
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(frozen);
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();
  await expect(timer).not.toHaveText(frozen, { timeout: 5_000 });
  await app.close();
  expect(errors).toEqual([]);
});

test('旧版本（v0.1.0）存档读入后不自动弹出指引', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-e2e-'));
  const legacy = {
    app: 'echo-arena',
    version: 1,
    savedAt: '2026-09-24T12:00:00.000Z',
    settings: { musicVolume: 0.45, seenHints: ['battle-basics'] },
    run: null,
    records: { runsStarted: 1, runsCompleted: 0, bestEcho: 3 },
  };
  fs.writeFileSync(path.join(userData, 'save.json'), JSON.stringify(legacy));

  const { app, page } = await launchClient({ userData });
  const errors = await ready(page);
  await page.click('[data-testid=start]');
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(guide(page)).toBeHidden();
  await expect(page.locator('[data-testid=guide-open]')).toBeVisible();
  await app.close();
  expect(errors).toEqual([]);
});
