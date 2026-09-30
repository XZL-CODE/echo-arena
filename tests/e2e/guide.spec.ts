// 新手指引：新安装后按情形教（照着做才往下走）、可以跳过、标题页“新手指引”进教学战从头练、
// “？”随时重看；v0.4.0 以前的存档（旧玩法）升级后丢弃进行中的一轮并重新教。
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dragHand,
  finishBattle,
  launchClient,
  newRun,
  readSave,
  ready,
  screenshotPath,
  state,
  tapHand,
  type HookWindow,
} from './client';

const ALL_PARTS = ['prep', 'battle', 'echo', 'ult', 'result', 'reward'];

const guide = (page: Page) => page.locator('[data-testid=guide]');
const guideTitle = (page: Page) => page.locator('[data-testid=guide-title]');

// 整场战斗照着指引打一遍；没有显卡的机器上（软件渲染）一帧要画很久，给足时间
test.setTimeout(240_000);

/**
 * 战斗往前走，直到出现下一课；分出胜负就返回 false。
 * 指引出现时战斗会停住，快进也停在那一步，所以一次可以快进好几秒。
 */
async function playUntilLesson(page: Page): Promise<boolean> {
  for (let i = 0; i < 150; i++) {
    const { open, result } = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      if (!echo.guide()) echo.fastForward(2);
      return { open: echo.guide(), result: echo.state().battle?.result ?? null };
    });
    if (open) {
      await expect(guide(page)).toBeVisible();
      return true;
    }
    if (result) return false;
  }
  throw new Error('300 秒内既没有出现下一课，也没有分出胜负');
}

/** 战前准备这一课：看对手 → 看军团 → 拖动宠物（照做）→ 开战（Enter）。 */
async function prepLesson(page: Page): Promise<void> {
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('这是你的军团');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('拖动宠物，摆好站位');
  await expect(page.locator('[data-testid=guide-next]')).toHaveCount(0);
  await expect(page.locator('[data-testid=guide-wait]')).toBeVisible();
  await dragHand(page);
  await expect(guideTitle(page)).toHaveText('点“开战”');
}

/** 开战这一课：战斗停着等玩家点敌人集火，再看暂停与加速。 */
async function battleLesson(page: Page): Promise<void> {
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  await expect(guideTitle(page)).toHaveText('点一个敌人，集火它');
  const time = page.locator('[data-testid=time]');
  // 这一步要照做：空格不放行，战斗也不会开始
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await expect(time).toHaveText('0:00');
  await expect(guideTitle(page)).toHaveText('点一个敌人，集火它');
  await tapHand(page);
  await expect(guideTitle(page)).toHaveText('暂停与加速');
  await expect(page.locator('[data-testid=focus]')).toContainText('集火');
  await page.click('[data-testid=guide-next]');
  await expect(guide(page)).toBeHidden();
}

/** 奖励这一课：照着手指收服、进化、确认，然后跳过进化演出。 */
async function rewardLesson(page: Page): Promise<void> {
  await expect(guideTitle(page)).toHaveText('收服一只新宠物');
  await tapHand(page);
  await expect(guideTitle(page)).toHaveText('让一只宠物进化');
  await tapHand(page);
  await expect(guideTitle(page)).toHaveText('点“确认”');
  await tapHand(page);
  await expect(page.locator('[data-testid=evolve]')).toBeVisible();
  await page.click('[data-testid=evolve-skip]');
  await page.click('[data-testid=evolve-done]');
}

test('新安装：战前、开战、回响、结算、奖励依次教，照着做才往下走，学完重启不再出现', async () => {
  const first = await launchClient({ hooks: true });
  const page = first.page;
  const errors = await ready(page);
  // 标题页不弹
  await expect(page.locator('[data-testid=new-run]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(guide(page)).toBeHidden();
  await newRun(page);
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.screenshot({ path: screenshotPath('guide-prep-foe'), animations: 'disabled' });
  await page.click('[data-testid=guide-next]');
  await page.click('[data-testid=guide-next]');

  // 要照做的步骤没有“下一步”，亮出来的地方以外点不到（战前的“菜单”点了不弹菜单）
  await expect(guideTitle(page)).toHaveText('拖动宠物，摆好站位');
  await page.getByRole('button', { name: '菜单' }).click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid=settings-dialog]')).toHaveCount(0);
  await expect(page.locator('.modal-layer.on')).toHaveCount(0);
  await dragHand(page);
  await expect(guideTitle(page)).toHaveText('点“开战”');
  await page.screenshot({ path: screenshotPath('guide-prep'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  await battleLesson(page);
  await expect(page.locator('[data-testid=time]')).not.toHaveText('0:00', { timeout: 5_000 });
  await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));

  // 第一次打出 2 级以上的回响：停下来讲
  expect(await playUntilLesson(page)).toBe(true);
  await expect(guideTitle(page)).toHaveText(/^回响 ×\d+$/);
  const frozen = (await state(page)).battle?.t ?? 0;
  await page.evaluate(() => (window as unknown as HookWindow).__echo.fastForward(2));
  expect((await state(page)).battle?.t).toBe(frozen);
  await page.screenshot({ path: screenshotPath('guide-echo'), animations: 'disabled' });
  await page.click('[data-testid=guide-next]');
  await expect(guide(page)).toBeHidden();

  expect(await finishBattle(page)).toBe('win');
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(guideTitle(page)).toHaveText('看看这一场');
  await page.click('[data-testid=guide-next]');
  await page.click('[data-testid=to-reward]');
  await rewardLesson(page);
  await expect(page.locator('[data-testid=start-battle]')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(guide(page)).toBeHidden();
  await expect
    .poll(() => readSave(first.userData)?.settings.guideSeen)
    .toEqual(['prep', 'battle', 'echo', 'result', 'reward']);
  await first.app.close();
  expect(errors).toEqual([]);

  const second = await launchClient({ userData: first.userData });
  const errors2 = await ready(second.page);
  await second.page.click('[data-testid=continue]');
  await expect(second.page.locator('[data-testid=start-battle]')).toBeVisible();
  await second.page.waitForTimeout(600);
  await expect(guide(second.page)).toBeHidden();
  await second.app.close();
  expect(errors2).toEqual([]);
});

test('跳过：一次跳过全部课程，开战、回响、结算、奖励都不再出现', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await expect(guideTitle(page)).toHaveText('先看对手');
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();
  await expect.poll(() => readSave(userData)?.settings.guideSeen).toEqual(ALL_PARTS);

  await page.click('[data-testid=start-battle]');
  await expect(page.locator('[data-testid=time]')).not.toHaveText('0:00', { timeout: 10_000 });
  await expect(guide(page)).toBeHidden();
  await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));
  expect(await playUntilLesson(page)).toBe(false);
  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await expect(guide(page)).toBeHidden();
  await page.click('[data-testid=to-reward]');
  await expect(page.locator('[data-testid=claim]')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(guide(page)).toBeHidden();
  await app.close();
  expect(errors).toEqual([]);
});

test('教学战：标题页“新手指引”从头教一遍（含大招），挑完奖励回到标题，存档里的这一轮不变', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  // 先开一轮正式的并学完（跳过），回到标题，再进教学战
  await newRun(page);
  await page.click('[data-testid=guide-skip]');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '回到标题' }).click();
  await expect(page.locator('[data-testid=continue]')).toBeVisible();
  await expect.poll(() => readSave(userData)?.run?.matchIndex).toBe(0);
  const saved = JSON.stringify(readSave(userData)?.run);

  await page.click('[data-testid=title-guide]');
  await expect(page.locator('.match-tag')).toHaveText('教学战');
  await prepLesson(page);
  await page.keyboard.press('Enter');
  await battleLesson(page);
  await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));

  // 教学战里伙伴是人形态：攒满能量放大招时讲大招；另外等第一次回响
  const taught: string[] = [];
  while (await playUntilLesson(page)) {
    const title = (await guideTitle(page).textContent()) ?? '';
    taught.push(title.startsWith('回响') ? 'echo' : title);
    if (title === '大招') {
      await page.screenshot({ path: screenshotPath('guide-ult'), animations: 'disabled' });
    }
    await page.click('[data-testid=guide-next]');
    await expect(guide(page)).toBeHidden();
  }
  expect(taught.sort()).toEqual(['echo', '大招']);

  await expect(page.locator('[data-testid=result]')).toBeVisible({ timeout: 15_000 });
  await expect(guideTitle(page)).toHaveText('看看这一场');
  await page.click('[data-testid=guide-next]');
  await page.click('[data-testid=to-reward]');
  await rewardLesson(page);
  await expect(page.locator('[data-testid=practice-done]')).toBeVisible();
  await expect(page.locator('[data-testid=practice-play]')).toHaveText(/继续我的这一轮/);
  await page.click('[data-testid=practice-title]');
  await expect(page.locator('[data-testid=continue]')).toBeVisible();
  expect(JSON.stringify(readSave(userData)?.run)).toBe(saved);
  await app.close();
  expect(errors).toEqual([]);
});

test('“？”随时重看：战前与战斗中都能直接翻看，战斗中会暂停，不改变学习进度', async () => {
  const { app, page, userData } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await page.click('[data-testid=guide-skip]');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=help]');
  await expect(guideTitle(page)).toHaveText('先看对手');
  await expect(page.locator('[data-testid=guide-skip]')).toHaveText('关闭');
  // 空格翻到下一步（只翻一步）；重看时要照做的步骤也能直接往下翻
  await page.keyboard.press('Space');
  await expect(guideTitle(page)).toHaveText('这是你的军团');
  await page.click('[data-testid=guide-next]');
  await expect(guideTitle(page)).toHaveText('拖动宠物，摆好站位');
  await expect(page.locator('[data-testid=guide-next]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide(page)).toBeHidden();

  await page.click('[data-testid=start-battle]');
  const time = page.locator('[data-testid=time]');
  await expect(time).not.toHaveText('0:00', { timeout: 10_000 });
  await page.click('[data-testid=help]');
  await expect(guideTitle(page)).toHaveText('点一个敌人，集火它');
  const frozen = (await time.textContent()) ?? '';
  await page.waitForTimeout(1200);
  await expect(time).toHaveText(frozen);
  await page.keyboard.press('ArrowRight');
  await expect(guideTitle(page)).toHaveText('暂停与加速');
  await page.keyboard.press('Enter');
  await expect(guide(page)).toBeHidden();
  await expect(time).not.toHaveText(frozen, { timeout: 5_000 });
  expect(readSave(userData)?.settings.guideSeen).toEqual(ALL_PARTS);
  await app.close();
  expect(errors).toEqual([]);
});

test('旧玩法的存档升级后：保留设置与记录，丢弃进行中的一轮并说明，新手指引重新教', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-e2e-'));
  // v0.4.0（存档版本 3）：玩具小队玩法，第 3 场战前
  fs.writeFileSync(
    path.join(userData, 'save.json'),
    JSON.stringify({
      app: 'echo-arena',
      version: 3,
      savedAt: '2026-09-30T08:00:00.000Z',
      settings: { musicVolume: 0.3, damageNumbers: false, guideSeen: ALL_PARTS },
      run: { seed: 1, matchIndex: 2, phase: 'prep', levels: { reflect: 1 } },
      records: { runsStarted: 3, runsCompleted: 1, bestEcho: 5 },
    }),
  );
  const { app, page } = await launchClient({ userData, hooks: true });
  const errors = await ready(page);
  await expect(page.locator('.toast').first()).toContainText('旧版本进行中的一轮无法继续');
  await expect(page.locator('[data-testid=continue]')).toHaveCount(0);
  const s = await state(page);
  expect(s.settings.musicVolume).toBe(0.3);
  expect(s.settings.damageNumbers).toBe(false);
  expect(s.settings.guideSeen).toEqual([]);
  await page.click('[data-testid=new-run]');
  await page.click('[data-testid=depart]');
  await expect(guideTitle(page)).toHaveText('先看对手');
  await app.close();
  expect(errors).toEqual([]);
});
