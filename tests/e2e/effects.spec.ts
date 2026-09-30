// 画面特效：激烈场面里各类特效都有上限，不会越积越多；打开“减少闪烁”后首领战照常进行。
import { expect, test, type Page } from '@playwright/test';
import { launchClient, ready, skipGuide } from './client';

interface FxStats {
  particles: number;
  rings: number;
  bolts: number;
  lights: number;
  decals: number;
  texts: number;
  quality: number;
  drawMs: number;
}

interface Hooks {
  fastForward(seconds: number): void;
  hold(on: boolean): void;
  mode(): string;
  result(): 'win' | 'lose' | null;
  cast(kind: 'guard' | 'slinger' | 'bell', x?: number, y?: number): boolean;
  setupRun(encounterId: string, modules: Array<[string, number]>, matchIndex?: number): void;
  fxStats(): FxStats;
}
type HookWindow = { __echo: Hooks };

/** 冲锋、弹射、连爆、漩涡：连锁最多、特效最密的一套。 */
const CHAIN_BUILD: Array<[string, number]> = [
  ['charge', 2],
  ['ricochet', 2],
  ['burst', 2],
  ['vortex', 2],
];
/** 能稳定打赢发条大王的一套（见平衡报告）。 */
const KING_BUILD: Array<[string, number]> = [
  ['reflect', 2],
  ['ricochet', 2],
  ['vortex', 1],
  ['burst', 1],
];

async function setupRun(
  page: Page,
  encounterId: string,
  build: Array<[string, number]>,
  matchIndex: number,
): Promise<void> {
  await page.evaluate(
    ([id, mods, index]) => (window as unknown as HookWindow).__echo.setupRun(id, mods, index),
    [encounterId, build, matchIndex] as const,
  );
  await expect(page.locator('[data-testid=fight]')).toBeVisible();
}

/**
 * 一边放招式一边快进，直到分出胜负；返回胜负与过程中各类特效数量的峰值。
 * 战斗只靠快进推进（画面照常刷新），结果与机器快慢无关。
 */
async function playOut(page: Page): Promise<{ peak: FxStats; result: string }> {
  await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));
  const peak: FxStats = {
    particles: 0,
    rings: 0,
    bolts: 0,
    lights: 0,
    decals: 0,
    texts: 0,
    quality: 1,
    drawMs: 0,
  };
  for (let i = 0; i < 400; i++) {
    const { stats, result } = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      for (const kind of ['guard', 'slinger', 'bell'] as const) echo.cast(kind);
      echo.fastForward(0.25);
      return { stats: echo.fxStats(), result: echo.result() };
    });
    for (const key of Object.keys(peak) as Array<keyof FxStats>) {
      peak[key] = Math.max(peak[key], stats[key]);
    }
    // 隔几步让画面真正画几帧（持续特效、拖尾和泛光都在画的时候生成）。
    if (i % 4 === 0) await page.waitForTimeout(40);
    if (result) return { peak, result };
  }
  throw new Error('战斗没有在 100 秒内结束');
}

test('激烈场面：爆炸、闪电、光照、焦痕都有上限，整场打完没有脚本错误', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await setupRun(page, 'swarm', CHAIN_BUILD, 3);
  await skipGuide(page);
  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  const { peak } = await playOut(page);
  // 确实打出了特效
  expect(peak.particles).toBeGreaterThan(40);
  expect(peak.decals).toBeGreaterThan(0);
  // 且都在上限之内
  expect(peak.particles).toBeLessThanOrEqual(900);
  expect(peak.rings).toBeLessThanOrEqual(91);
  expect(peak.bolts).toBeLessThanOrEqual(61);
  expect(peak.lights).toBeLessThanOrEqual(24);
  expect(peak.decals).toBeLessThanOrEqual(28);
  expect(peak.texts).toBeLessThanOrEqual(40);
  await app.close();
  expect(errors).toEqual([]);
});

test('打开“减少闪烁”：首领战（冲撞、召唤、倒下）照常打完', async () => {
  const { app, page } = await launchClient({ hooks: true });
  const errors = await ready(page);
  await page.click('[data-testid=title-settings]');
  const dialog = page.locator('[data-testid=settings]');
  await dialog.locator('label.toggle', { hasText: '减少闪烁' }).click();
  await expect(dialog.getByLabel('减少闪烁')).toBeChecked();
  await page.keyboard.press('Escape');
  await setupRun(page, 'king', KING_BUILD, 6);
  await skipGuide(page);
  await page.click('[data-testid=fight]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  const { peak, result } = await playOut(page);
  expect(result).toBe('win');
  expect(peak.particles).toBeGreaterThan(20);
  expect(peak.particles).toBeLessThanOrEqual(900);
  await app.close();
  expect(errors).toEqual([]);
});
