// 流程测试：打完一场收服与进化、战斗中途关闭后继续、输了重来、设置保存与清除存档、
// 暂停与集火、拖动站位、整轮结算。用测试钩子（window.__echo）快进战斗、直接摆出指定对局，
// 开战前停住实时推进，结果由固定种子决定。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  fight,
  finishBattle,
  launchClient,
  newRun,
  patchRun,
  readSave,
  ready,
  screenshotPath,
  skipGuide,
  state,
  type HookWindow,
} from './client';

/** 十只人形态：稳定打赢最后一场的首领战。 */
const ALL_STARS = [
  'fox',
  'bird',
  'otter',
  'turtle',
  'bunny',
  'deer',
  'cat',
  'wolf',
  'bear',
  'lizard',
].map((species) => ({ species, form: 3 }));

async function currentRun(page: Page) {
  const run = (await state(page)).run;
  if (!run) throw new Error('没有进行中的一轮');
  return run;
}

/** 进化演出：跳过后点“继续”。 */
async function skipEvolution(page: Page): Promise<void> {
  await expect(page.locator('[data-testid=evolve]')).toBeVisible();
  await page.click('[data-testid=evolve-skip]');
  await page.click('[data-testid=evolve-done]');
}

test('打赢一场、收服与进化，进入下一场，进度写进存档', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  await fight(page);
  expect(await finishBattle(page)).toBe('win');

  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: screenshotPath('flow-result'), animations: 'disabled' });
  await page.click('[data-testid=to-reward]');
  await expect(page.locator('[data-testid=claim]')).toBeVisible();
  const before = await currentRun(page);
  const offer = before.rewards as {
    capture: Array<{ species: string; form: number }>;
    evolve: Array<{ uid: number; to: number }>;
  };
  expect(offer.capture.length).toBeGreaterThan(0);
  expect(offer.evolve.length).toBeGreaterThan(0);
  await page.click('[data-testid=capture-0]');
  await page.click('[data-testid=evolve-0]');
  await page.screenshot({ path: screenshotPath('flow-reward'), animations: 'disabled' });
  await page.click('[data-testid=claim]');
  await skipEvolution(page);

  await expect(page.locator('[data-testid=start-battle]')).toBeVisible();
  const run = await currentRun(page);
  expect(run.matchIndex).toBe(1);
  expect(run.phase).toBe('prep');
  expect(run.legion.length).toBe(before.legion.length + 1);
  const evolved = offer.evolve[0];
  expect(run.legion.find((p) => p.uid === evolved?.uid)?.form).toBe(evolved?.to);

  await app.close();
  const save = readSave(userData);
  expect(save?.run?.matchIndex).toBe(1);
  expect(save?.run?.phase).toBe('prep');
  expect(save?.run?.legion.length).toBe(run.legion.length);
  expect(save?.codex.length).toBeGreaterThan(before.legion.length);
  expect(errors).toEqual([]);
});

test('战斗中关闭客户端，重开后回到这一场的战前准备，军团不变', async () => {
  const first = await launchClient({ hooks: true });
  const firstErrors = await ready(first.page);
  await newRun(first.page);
  await skipGuide(first.page);
  const legion = (await currentRun(first.page)).legion;
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
  await expect(second.page.locator('[data-testid=start-battle]')).toBeVisible();
  const run = await currentRun(second.page);
  expect(run.matchIndex).toBe(0);
  expect(run.inBattle).toBe(false);
  expect(run.attempts[0]).toBe(1);
  expect(run.legion).toEqual(legion);
  await second.app.close();
  expect(errors).toEqual([]);
});

test('输了可以原样再来或回去调整，军团不丢', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  // 一只幼年叶耳兔去打最后一场的首领：必输
  await patchRun(page, 6, [{ species: 'bunny', form: 1 }]);
  await fight(page);
  expect(await finishBattle(page)).toBe('lose');
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });

  await page.click('[data-testid=retry]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));
  let run = await currentRun(page);
  expect(run.matchIndex).toBe(6);
  expect(run.attempts[6]).toBe(2);
  expect(run.legion.map((p) => `${p.species}-${p.form}`)).toEqual(['bunny-1']);

  expect(await finishBattle(page)).toBe('lose');
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.click('[data-testid=retry-prep]');
  await expect(page.locator('[data-testid=start-battle]')).toBeVisible();
  run = await currentRun(page);
  expect(run.inBattle).toBe(false);
  expect(run.matchIndex).toBe(6);
  expect(run.legion.map((p) => `${p.species}-${p.form}`)).toEqual(['bunny-1']);
  await app.close();
  expect(errors).toEqual([]);
});

test('设置在重开后保留', async () => {
  const first = await launchClient();
  const firstErrors = await ready(first.page);
  await first.page.click('[data-testid=settings]');
  const dialog = first.page.locator('[data-testid=settings-dialog]');
  await expect(dialog.getByLabel('伤害数字')).toBeChecked();
  await dialog.locator('label.toggle', { hasText: '伤害数字' }).click();
  await expect(dialog.getByLabel('伤害数字')).not.toBeChecked();
  await expect.poll(() => readSave(first.userData)?.settings.damageNumbers).toBe(false);
  await first.app.close();
  expect(firstErrors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors = await ready(second.page);
  await second.page.click('[data-testid=settings]');
  await expect(
    second.page.locator('[data-testid=settings-dialog]').getByLabel('伤害数字'),
  ).not.toBeChecked();
  await second.app.close();
  expect(errors).toEqual([]);
});

test('清除全部存档后回到第一次打开的状态，并留一份备份', async () => {
  const first = await launchClient();
  const firstErrors = await ready(first.page);
  await first.page.click('[data-testid=new-run]');
  await first.page.click('[data-testid=depart]');
  await skipGuide(first.page);
  await expect.poll(() => readSave(first.userData)?.run?.matchIndex).toBe(0);

  // 战前菜单 → 设置 → 清除全部存档
  await first.page.keyboard.press('Escape');
  await first.page.getByRole('button', { name: '设置' }).click();
  await first.page.click('[data-testid=reset-all]');
  await first.page.click('[data-testid=confirm-reset]');
  await expect(first.page.locator('[data-testid=new-run]')).toBeVisible();
  await expect(first.page.locator('[data-testid=continue]')).toHaveCount(0);
  expect(fs.existsSync(path.join(first.userData, 'save.backup.json'))).toBe(true);
  await first.app.close();
  expect(firstErrors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors = await ready(second.page);
  await expect(second.page.locator('[data-testid=new-run]')).toBeVisible();
  await expect(second.page.locator('[data-testid=continue]')).toHaveCount(0);
  expect(readSave(second.userData)?.run ?? null).toBeNull();
  // 学习进度也清掉了：新开一轮会再教
  await second.page.click('[data-testid=new-run]');
  await second.page.click('[data-testid=depart]');
  await expect(second.page.locator('[data-testid=guide-title]')).toHaveText('先看对手');
  await second.app.close();
  expect(errors).toEqual([]);
});

test('战斗中空格暂停、点敌人设集火，窗口失焦自动暂停', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  await page.click('[data-testid=start-battle]');
  const time = page.locator('[data-testid=time]');
  const banner = page.locator('[data-testid=banner]');
  await expect(time).not.toHaveText('0:00', { timeout: 10_000 });

  await page.keyboard.press('Space');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('已暂停');
  const frozen = (await time.textContent()) ?? '';
  await page.waitForTimeout(1500);
  await expect(time).toHaveText(frozen);

  // 暂停时画面不动：照着敌人在屏幕上的位置点它，设为集火
  const units = await page.evaluate(() => (window as unknown as HookWindow).__echo.units());
  const foe = units.find((u) => u.team === 1 && u.alive && u.screen);
  if (!foe?.screen) throw new Error('找不到敌人的屏幕位置');
  await page.mouse.click(foe.screen.x, (foe.screen.y + foe.screen.top) / 2);
  await expect.poll(async () => (await state(page)).battle?.focusId).toBe(foe.id);
  await expect(page.locator('[data-testid=focus]')).toContainText('集火');
  await page.screenshot({ path: screenshotPath('flow-focus') });

  await page.keyboard.press('Space');
  await expect(banner).toBeHidden();
  await expect(time).not.toHaveText(frozen, { timeout: 5_000 });

  // 窗口失去焦点时自动暂停（设置里默认打开），回到窗口后继续
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(banner).toContainText('自动暂停');
  await expect.poll(async () => (await state(page)).battle?.paused).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(banner).toBeHidden();
  await app.close();
  expect(errors).toEqual([]);
});

test('战前拖动宠物换开场位置，写进存档', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  const units = await page.evaluate(() => (window as unknown as HookWindow).__echo.units());
  const pet = units.find((u) => u.team === 0 && u.uid && u.screen);
  if (!pet?.screen) throw new Error('找不到我方宠物的屏幕位置');
  const from = (await currentRun(page)).legion.find((p) => p.uid === pet.uid);
  if (!from) throw new Error('军团里没有这只宠物');
  const a = { x: pet.screen.x, y: (pet.screen.y + pet.screen.top) / 2 };
  // 往屏幕下方拖：在场地上是往镜头这边挪
  const down = from.y < 550;
  const b = { x: a.x - 30, y: a.y + (down ? 150 : -150) };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = (await currentRun(page)).legion.find((x) => x.uid === pet.uid);
      return Math.abs((p?.y ?? from.y) - from.y);
    })
    .toBeGreaterThan(100);
  const moved = (await currentRun(page)).legion.find((x) => x.uid === pet.uid);
  expect(moved?.x ?? 999).toBeLessThanOrEqual(640);
  await page.screenshot({ path: screenshotPath('flow-prep-adjusted'), animations: 'disabled' });

  await fight(page);
  await app.close();
  const saved = readSave(userData)?.run?.legion.find((p) => p.uid === pet.uid);
  expect(saved?.x).toBeCloseTo(moved?.x ?? 0, 3);
  expect(saved?.y).toBeCloseTo(moved?.y ?? 0, 3);
  expect(errors).toEqual([]);
});

test('最后一场获胜后看到整轮结算，回到标题后记下通关', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  await patchRun(page, 6, ALL_STARS);
  await fight(page);
  expect(await finishBattle(page)).toBe('win');
  await expect(page.locator('[data-testid=to-complete]')).toBeVisible({ timeout: 15_000 });
  await page.click('[data-testid=to-complete]');
  await expect(page.locator('[data-testid=complete]')).toBeVisible();
  await page.screenshot({ path: screenshotPath('flow-complete'), animations: 'disabled' });

  await page.click('[data-testid=close-run]');
  await expect(page.locator('[data-testid=new-run]')).toBeVisible();
  await expect(page.locator('[data-testid=continue]')).toHaveCount(0);
  await expect.poll(() => readSave(userData)?.records.runsCompleted).toBe(1);
  expect(readSave(userData)?.run ?? null).toBeNull();
  await app.close();
  expect(errors).toEqual([]);
});
