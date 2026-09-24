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

test('战前换起手招式；战斗中空格暂停、失焦自动暂停，按 1 再点场地发动冲锋', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await page.click('[data-testid=start]');
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  await page.click('[data-testid=starter-charge]');
  await expect.poll(async () => (await currentRun(page)).levels).toEqual({ charge: 1 });
  await fight(page);

  const banner = page.locator('[data-testid=banner]');
  const timer = page.locator('[data-testid=timer]');
  await page.evaluate(() => (window as unknown as HookWindow).__echo.fastForward(2));
  await page.keyboard.press('Space');
  await expect(banner).toContainText('已暂停');
  await page.waitForTimeout(300);
  const frozen = (await timer.textContent()) ?? '';
  expect(frozen).not.toBe('0:00');
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(frozen);
  await page.keyboard.press('Space');
  await expect(banner).toHaveCount(0);
  await expect(timer).not.toHaveText(frozen, { timeout: 5_000 });

  const cooldown = page.locator('[data-testid=skill-guard] .cd-mask');
  await expect(cooldown).toHaveText('');
  await page.keyboard.press('1');
  await expect(banner).toContainText('冲锋');
  const box = await page.locator('[data-testid=arena]').boundingBox();
  if (!box) throw new Error('找不到竞技场画布');
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await expect(banner).toHaveCount(0);
  await expect(cooldown).not.toHaveText('');
  await page.screenshot({ path: screenshotPath('flow-charge') });

  // 窗口失去焦点时自动暂停（设置里默认打开）。
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(banner).toContainText('自动暂停');
  await app.close();
  expect(errors).toEqual([]);
});

test('最后一场获胜后看到整轮结算，可以回到标题或再来一轮', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await setupRun(
    page,
    'volley',
    [
      ['reflect', 2],
      ['ricochet', 2],
      ['charge', 1],
      ['mend', 1],
    ],
    6,
  );
  await fight(page);
  expect(await finishBattle(page)).toBe('win');
  await expect(page.locator('[data-testid=result-next]')).toContainText('整轮结算', {
    timeout: 15_000,
  });
  await page.click('[data-testid=result-next]');
  await expect(page.locator('[data-testid=summary]')).toBeVisible();
  await page.screenshot({ path: screenshotPath('flow-summary'), animations: 'disabled' });

  await page.click('[data-testid=summary-title]');
  await expect(page.locator('[data-testid=start]')).toContainText('再来一轮');
  await expect(page.locator('[data-testid=last-summary]')).toBeVisible();
  await page.click('[data-testid=start]');
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
  const run = await currentRun(page);
  expect(run.matchIndex).toBe(0);
  expect(run.phase).toBe('prep');
  expect(run.levels).toEqual({ reflect: 1 });
  await app.close();
  expect(errors).toEqual([]);
});

test('战前调整：点槽位卸下、从招式库装回，拖动队员换开场位置', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await setupRun(
    page,
    'swarm',
    [
      ['reflect', 1],
      ['ricochet', 1],
      ['pierce', 1],
      ['mend', 1],
    ],
    3,
  );
  const slinger = async () => (await currentRun(page)).loadout.slinger ?? [];
  expect(await slinger()).toContain('pierce');

  await page.locator('[data-testid^=slot-slinger-]', { hasText: '贯穿射' }).click();
  await page.getByRole('button', { name: '卸下' }).click();
  await expect(page.locator('[data-testid=lib-pierce]')).toBeVisible();
  expect(await slinger()).not.toContain('pierce');
  await page.click('[data-testid=lib-pierce]');
  await page.getByRole('button', { name: '装到小弹的空槽' }).click();
  await expect(page.locator('[data-testid=lib-pierce]')).toHaveCount(0);
  expect(await slinger()).toContain('pierce');

  // 竞技场坐标 → 屏幕坐标：画布四周各有 34 单位的木框，整体 1268×728。
  const box = await page.locator('[data-testid=arena]').boundingBox();
  if (!box) throw new Error('找不到竞技场画布');
  const toScreen = (x: number, y: number) => ({
    x: box.x + ((x + 34) / 1268) * box.width,
    y: box.y + ((y + 34) / 728) * box.height,
  });
  const from = (await currentRun(page)).formation.units.guard;
  if (!from) throw new Error('没有阿铁的站位');
  const a = toScreen(from.x, from.y);
  const b = toScreen(from.x - 60, 170);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await currentRun(page)).formation.units.guard?.y ?? 0))
    .toBeLessThan(from.y - 100);
  await page.screenshot({ path: screenshotPath('flow-prep-adjusted'), animations: 'disabled' });

  await fight(page);
  await expect(page.locator('[data-testid=skill-slinger]')).toBeVisible();
  await app.close();
  const save = readSave(userData);
  expect(save?.run?.loadout.slinger).toContain('pierce');
  expect(save?.run?.formation.units.guard?.y ?? 999).toBeLessThan(from.y - 100);
  expect(errors).toEqual([]);
});
