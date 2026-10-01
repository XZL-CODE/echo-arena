// 画面特效：十只人形态对首领的激烈场面里，粒子与各类立体特效都有上限，不会越积越多；
// 打开“减少闪烁”、关掉特写后首领战照常打完。
import { expect, test, type Page } from '@playwright/test';
import {
  fight,
  launchClient,
  newRun,
  patchRun,
  ready,
  screenshotPath,
  skipGuide,
  type FxStats,
  type HookWindow,
} from './client';

/** 十只人形态：技能与大招最密的一支军团。 */
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

/** 粒子池与特效数量的上限（见 src/gfx/fx/particles.ts、effects.ts）。 */
const MAX_PARTICLES = 3200 + 1920;
const MAX_EFFECTS = 160;

// 首领战在没有显卡的机器上（软件渲染）一帧要画很久，给足时间
test.setTimeout(300_000);

/** 一点点快进到分出胜负，隔几步让画面真正画几帧；返回胜负与各项数量的峰值（也记下拍到的特写）。 */
async function playOut(page: Page): Promise<{ peak: FxStats; result: string; shots: Set<number> }> {
  const peak: FxStats = {
    units: 0,
    particles: 0,
    effects: 0,
    quality: 0,
    drawMs: 0,
    fps: 0,
    frames: 0,
    shot: 0,
    shotUnit: 0,
  };
  const shots = new Set<number>();
  for (let i = 0; i < 600; i++) {
    const { stats, result } = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      echo.fastForward(0.5);
      return { stats: echo.fxStats(), result: echo.state().battle?.result ?? null };
    });
    for (const key of Object.keys(peak) as Array<keyof FxStats>) {
      peak[key] = Math.max(peak[key], stats[key]);
    }
    if (stats.shot) shots.add(stats.shot);
    // 持续特效、拖尾和碎块都在画的时候推进
    if (i % 2 === 0) await page.waitForTimeout(40);
    if (result) return { peak, result, shots };
  }
  throw new Error('战斗没有在 300 秒内结束');
}

test('激烈场面：十只人形态对首领，粒子与特效都有上限，整场打完没有脚本错误', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await newRun(page);
  await skipGuide(page);
  await patchRun(page, 6, ALL_STARS);
  await fight(page);
  const { peak, result, shots } = await playOut(page);
  await page.screenshot({ path: screenshotPath('effects-boss') });
  expect(result).toBe('win');
  // 放技能时有特写，人形态放大招时有两段式大招镜头
  expect([...shots].sort()).toEqual([1, 2]);
  // 确实打出了特效
  expect(peak.units).toBeGreaterThanOrEqual(12);
  expect(peak.particles).toBeGreaterThan(100);
  expect(peak.effects).toBeGreaterThan(5);
  // 且都在上限之内
  expect(peak.particles).toBeLessThanOrEqual(MAX_PARTICLES);
  expect(peak.effects).toBeLessThanOrEqual(MAX_EFFECTS);
  await app.close();
  expect(errors).toEqual([]);
});

test('打开“减少闪烁”、关掉特写：首领战（喷火、变身、倒下）照常打完', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await page.click('[data-testid=settings]');
  const dialog = page.locator('[data-testid=settings-dialog]');
  await dialog.locator('label.toggle', { hasText: '减少闪烁' }).click();
  await expect(dialog.getByLabel('减少闪烁')).toBeChecked();
  await dialog.locator('label.toggle', { hasText: '技能与大招特写' }).click();
  await expect(dialog.getByLabel('技能与大招特写')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await newRun(page);
  await skipGuide(page);
  await patchRun(page, 6, ALL_STARS);
  await fight(page);
  const { peak, result, shots } = await playOut(page);
  expect(result).toBe('win');
  // 关掉特写后镜头不再推近
  expect(shots.size).toBe(0);
  expect(peak.particles).toBeGreaterThan(50);
  expect(peak.particles).toBeLessThanOrEqual(MAX_PARTICLES);
  expect(peak.effects).toBeLessThanOrEqual(MAX_EFFECTS);
  await app.close();
  expect(errors).toEqual([]);
});
