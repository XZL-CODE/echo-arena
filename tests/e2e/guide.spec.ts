// 新手指引：新安装后按情形教（照着做才往下走）、可以跳过、标题页进教学战从头练、“？”随时重看，
// 老版本更新上来的存档不再自动教。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchClient, readSave, ready, screenshotPath } from './client';

type HookWindow = { __echo: { fastForward(seconds: number): void; result(): string | null } };

const ALL_PARTS = ['prep', 'battle', 'skill', 'echo', 'result', 'reward'];

const guide = (page: Page) => page.locator('[data-testid=guide]');
const guideTitle = (page: Page) => page.locator('[data-testid=guide-title]');

/** 手指演示的位置（指尖；拖动时还有终点）。 */
async function handPoints(page: Page): Promise<{ x: number; y: number; toX: number; toY: number }> {
  const hand = page.locator('[data-testid=guide-hand]');
  await expect(hand).toHaveAttribute('data-x', /\d/);
  return hand.evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.x), y: Number(d.y), toX: Number(d.toX), toY: Number(d.toY) };
  });
}

/** 照着手指点一下。 */
async function tapHand(page: Page): Promise<void> {
  const p = await handPoints(page);
  await page.mouse.click(p.x, p.y);
}

/** 照着手指从起点拖到终点。 */
async function dragHand(page: Page): Promise<void> {
  const hand = page.locator('[data-testid=guide-hand]');
  await expect(hand).toHaveAttribute('data-to-x', /\d/);
  const p = await handPoints(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.toX, p.toY, { steps: 8 });
  await page.mouse.up();
}

/** 战斗一点点往前走，直到出现下一课（指引出现时战斗会停住，快进也随之停下）。 */
async function playUntilLesson(page: Page): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (await guide(page).isVisible()) return;
    await page.evaluate(() => (window as unknown as HookWindow).__echo.fastForward(0.25));
  }
  throw new Error('30 秒内没有出现下一课');
}

/** 快进到分出胜负。 */
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

/** 战前准备这一课：看对手 → 选开局招式 → 拖动队员 → 开战。 */
async function prepLesson(page: Page): Promise<void> {
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('选一个开局招式');
  await expect(page.locator('[data-testid=guide-next]')).toHaveCount(0);
  await expect(page.locator('[data-testid=guide-wait]')).toBeVisible();
  await page.click('[data-testid=starter-reflect]');
  await expect(guideTitle(page)).toHaveText('拖动队员，摆好站位');
  await dragHand(page);
  await expect(guideTitle(page)).toHaveText('点“开战”');
}

test('新安装：战前、开战、回响、结算、挑奖励依次教，照着做才往下走，学完重启不再出现', async () => {
  const first = await launchClient({ hooks: true });
  const page = first.page;
  const errors = await ready(page);
  // 标题页不弹，点“开始”进入第一场准备时才出现。
  await expect(page.locator('[data-testid=start]')).toBeVisible();
  await expect(guide(page)).toBeHidden();
  await page.click('[data-testid=start]');
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.click('[data-testid=guide-next]');

  // 要照做的步骤没有“下一步”，点亮出来的地方以外也没有反应。
  await expect(guideTitle(page)).toHaveText('选一个开局招式');
  await page.locator('[data-testid=fight]').click();
  await expect(page.locator('[data-testid=battle-hud]')).toBeHidden();
  await expect(guideTitle(page)).toHaveText('选一个开局招式');
  await page.click('[data-testid=starter-reflect]');
  await expect(guideTitle(page)).toHaveText('拖动队员，摆好站位');
  await dragHand(page);
  await expect(guideTitle(page)).toHaveText('点“开战”');
  await page.screenshot({ path: screenshotPath('guide-prep'), animations: 'disabled' });
  await page.keyboard.press('Enter');

  // 开战：战斗停着等玩家点对手集火，再按空格开打。
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await expect(guideTitle(page)).toHaveText('点一个对手，集火它');
  const timer = page.locator('[data-testid=timer]');
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await expect(timer).toHaveText('0:00');
  await expect(guideTitle(page)).toHaveText('点一个对手，集火它');
  await tapHand(page);
  await expect(guideTitle(page)).toHaveText('按空格开打');
  await expect(page.locator('.focus-line')).toContainText('集火');
  await page.keyboard.press('Space');
  await expect(guide(page)).toBeHidden();
  await expect(timer).not.toHaveText('0:00', { timeout: 5_000 });

  // 第一次有箭被反射盾弹回：定格讲回响。
  await playUntilLesson(page);
  await expect(guideTitle(page)).toHaveText(/^回响 ×\d+！$/);
  const frozen = (await timer.textContent()) ?? '';
  await page.waitForTimeout(800);
  await expect(timer).toHaveText(frozen);
  await page.screenshot({ path: screenshotPath('guide-echo'), animations: 'disabled' });
  await page.click('[data-testid=guide-next]');
  await expect(guide(page)).toBeHidden();

  const result = await finishBattle(page);
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  if (result === 'win') {
    await expect(guideTitle(page)).toHaveText('赢了！去挑奖励');
    await page.click('[data-testid=result-next]');
    await expect(guideTitle(page)).toHaveText('挑一张，带进下一场');
    await page.locator('[data-testid^=offer-]').first().click();
    await page.click('[data-testid=reward-confirm]');
    await expect(page.locator('[data-testid=fight]')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(guide(page)).toBeHidden();
    await expect
      .poll(() => readSave(first.userData)?.settings.guideSeen)
      .toEqual(['prep', 'battle', 'echo', 'result', 'reward']);
  } else {
    await expect(guideTitle(page)).toHaveText('没赢也不亏');
    await page.click('[data-testid=guide-next]');
    await expect(guide(page)).toBeHidden();
    await expect
      .poll(() => readSave(first.userData)?.settings.guideSeen)
      .toEqual(['prep', 'battle', 'echo', 'result']);
  }
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

test('跳过：一次跳过全部课程，开战、打出回响、结算时都不再出现', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await page.click('[data-testid=start]');
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();
  await expect.poll(() => readSave(userData)?.settings.guideSeen).toEqual(ALL_PARTS);

  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await expect(page.locator('[data-testid=timer]')).not.toHaveText('0:00', { timeout: 5_000 });
  await expect(guide(page)).toBeHidden();
  await finishBattle(page);
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await expect(guide(page)).toBeHidden();
  await app.close();
  expect(errors).toEqual([]);
});

test('教学战：标题页进入，从头教一遍（放招式先点按钮、再点场地），不影响存档里的这一轮', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  // 先开一轮正式的，回到标题，再进教学战。
  await page.click('[data-testid=start]');
  await page.click('[data-testid=guide-skip]');
  await page.click('[data-testid=menu]');
  await page.getByRole('button', { name: '回到标题（进度已保存）' }).click();
  await expect(page.locator('[data-testid=continue]')).toBeVisible();
  const saved = JSON.stringify(readSave(userData)?.run);

  await page.click('[data-testid=title-guide]');
  await expect(page.locator('.match-no')).toHaveText('教学战');
  await prepLesson(page);
  await page.click('[data-testid=fight]');
  await expect(guideTitle(page)).toHaveText('点一个对手，集火它');
  await tapHand(page);
  await expect(guideTitle(page)).toHaveText('按空格开打');
  await page.keyboard.press('Space');
  await expect(guide(page)).toBeHidden();

  // 教学战里叮当带着漩涡：准备好后教放招式；另外等第一次回响。
  const taught: string[] = [];
  while (taught.length < 2) {
    await playUntilLesson(page);
    const title = (await guideTitle(page).textContent()) ?? '';
    if (title.startsWith('回响')) {
      taught.push('echo');
      await page.click('[data-testid=guide-next]');
    } else {
      taught.push('skill');
      expect(title).toBe('第一步：点「漩涡」');
      await page.click('[data-testid=skill-bell]');
      await expect(guideTitle(page)).toHaveText('第二步：点场地放出去');
      await page.screenshot({ path: screenshotPath('guide-skill'), animations: 'disabled' });
      await tapHand(page);
    }
    await expect(guide(page)).toBeHidden();
  }
  expect(taught.sort()).toEqual(['echo', 'skill']);

  expect(await finishBattle(page)).toBe('win');
  await expect(guideTitle(page)).toHaveText('赢了！去挑奖励', { timeout: 15_000 });
  await page.click('[data-testid=result-next]');
  await page.locator('[data-testid^=offer-]').first().click();
  await page.click('[data-testid=reward-confirm]');
  await expect(page.locator('[data-testid=practice-done]')).toBeVisible();
  await expect(page.locator('[data-testid=practice-play]')).toHaveText(/继续我的这一轮/);
  await page.click('[data-testid=practice-title]');
  await expect(page.locator('[data-testid=continue]')).toBeVisible();
  expect(JSON.stringify(readSave(userData)?.run)).toBe(saved);
  await app.close();
  expect(errors).toEqual([]);
});

test('“？”随时重看：准备和战斗中都能直接翻看，战斗中会暂停，不改变学习进度', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await page.click('[data-testid=start]');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=guide-open]');
  await expect(guideTitle(page)).toHaveText('先看对手');
  await expect(page.locator('[data-testid=guide-skip]')).toHaveText('关闭');
  // 空格翻到下一步（只翻一步）；重看时要照做的步骤也能直接往下翻。
  await page.keyboard.press('Space');
  await expect(guideTitle(page)).toHaveText('选一个开局招式');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('拖动队员，摆好站位');
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=fight]');
  const timer = page.locator('[data-testid=timer]');
  await expect(timer).not.toHaveText('0:00', { timeout: 5_000 });
  await page.click('[data-testid=guide-open]');
  await expect(guideTitle(page)).toHaveText('点一个对手，集火它');
  const frozen = (await timer.textContent()) ?? '';
  await page.waitForTimeout(1200);
  await expect(timer).toHaveText(frozen);
  await page.keyboard.press('ArrowRight');
  await expect(guideTitle(page)).toHaveText('回响');
  await page.keyboard.press('ArrowRight');
  await expect(guideTitle(page)).toHaveText('按空格继续');
  await page.keyboard.press('Space');
  await expect(guide(page)).toBeHidden();
  await expect(timer).not.toHaveText(frozen, { timeout: 5_000 });
  expect(readSave(userData)?.settings.guideSeen).toEqual(ALL_PARTS);
  await app.close();
  expect(errors).toEqual([]);
});

test('老版本更新上来的存档不自动教：v0.1.0 没有进度记录，v0.2.0 三段都看过', async () => {
  const saves = [
    {
      app: 'echo-arena',
      version: 1,
      savedAt: '2026-09-24T12:00:00.000Z',
      settings: { musicVolume: 0.45, seenHints: ['battle-basics'] },
      run: null,
      records: { runsStarted: 1, runsCompleted: 0, bestEcho: 3 },
    },
    {
      app: 'echo-arena',
      version: 2,
      savedAt: '2026-09-27T08:00:00.000Z',
      settings: { guideSeen: ['prep', 'battle', 'result'] },
      run: null,
      records: { runsStarted: 1, runsCompleted: 0, bestEcho: 2 },
    },
  ];
  for (const save of saves) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-e2e-'));
    fs.writeFileSync(path.join(userData, 'save.json'), JSON.stringify(save));
    const { app, page } = await launchClient({ userData, hooks: true });
    const errors = await ready(page);
    await page.click('[data-testid=start]');
    await expect(page.locator('[data-testid=fight]')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(guide(page)).toBeHidden();
    await page.click('[data-testid=fight]');
    await expect(page.locator('[data-testid=timer]')).not.toHaveText('0:00', { timeout: 5_000 });
    await page.evaluate(() => (window as unknown as HookWindow).__echo.fastForward(10));
    await expect(guide(page)).toBeHidden();
    await app.close();
    expect(errors).toEqual([]);
  }
});
