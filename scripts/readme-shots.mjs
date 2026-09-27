// 生成 README 用的截图（docs/screenshots/*.jpg）：启动真实客户端，按新安装的流程走、用测试钩子摆出场景后截图。
// 用法：npm run shots（Linux 上用 xvfb-run npm run shots）。
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR } from './paths.mjs';

const OUT = path.join(ROOT_DIR, 'docs', 'screenshots');
const SIZE = { width: 1280, height: 800 };

const REFLECT_BUILD = [
  ['reflect', 2],
  ['ricochet', 2],
  ['burst', 1],
  ['mend', 1],
];
const CHAIN_BUILD = [
  ['charge', 1],
  ['ricochet', 2],
  ['burst', 2],
  ['vortex', 1],
];

async function shot(page, name, wait = 150) {
  await page.waitForTimeout(wait);
  await page.screenshot({
    path: path.join(OUT, `${name}.jpg`),
    type: 'jpeg',
    quality: 85,
    animations: 'disabled',
  });
  console.log(`  docs/screenshots/${name}.jpg`);
}

async function setupRun(page, encounter, modules, matchIndex) {
  await page.evaluate(
    ([e, m, i]) => window.__echo.setupRun(e, m, i),
    [encounter, modules, matchIndex],
  );
  await page.waitForSelector('[data-testid=fight]');
}

/** 开战后快进到第 seconds 秒。 */
async function fightUntil(page, seconds) {
  await page.click('[data-testid=fight]');
  await page.waitForSelector('[data-testid=battle-hud]');
  await page.evaluate((s) => window.__echo.fastForward(s), seconds);
}

/** 新手指引里手指演示的位置。 */
async function hand(page) {
  await page.waitForSelector('[data-testid=guide-hand][data-x]', { state: 'attached' });
  return page.locator('[data-testid=guide-hand]').evaluate((el) => {
    const d = el.dataset;
    return { x: Number(d.x), y: Number(d.y), toX: Number(d.toX), toY: Number(d.toY) };
  });
}

async function title(page) {
  return (await page.locator('[data-testid=guide-title]').textContent()) ?? '';
}

async function waitTitle(page, text) {
  await page.waitForFunction(
    (t) => document.querySelector('[data-testid=guide-title]')?.textContent === t,
    text,
  );
}

/** 战斗一点点往前走，直到出现下一课。 */
async function playUntilLesson(page) {
  for (let i = 0; i < 120; i++) {
    if (await page.locator('[data-testid=guide]').isVisible()) return;
    await page.evaluate(() => window.__echo.fastForward(0.25));
  }
  throw new Error('没有等到下一课');
}

/** 战前准备这一课走到“拖动队员”：看对手 → 选开局招式。 */
async function toDragStep(page) {
  await page.waitForSelector('[data-testid=guide]', { state: 'visible' });
  await waitTitle(page, '先看对手');
  await page.click('[data-testid=guide-next]');
  await page.click('[data-testid=starter-reflect]');
  await waitTitle(page, '拖动队员，摆好站位');
}

/** 照着手指拖动队员、开战、点对手集火、按空格开打。 */
async function dragAndStart(page) {
  const d = await hand(page);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.toX, d.toY, { steps: 8 });
  await page.mouse.up();
  await waitTitle(page, '点“开战”');
  await page.keyboard.press('Enter');
  await waitTitle(page, '点一个对手，集火它');
  const e = await hand(page);
  await page.mouse.click(e.x, e.y);
  await waitTitle(page, '按空格开打');
  await page.keyboard.press('Space');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-shots-'));
  const env = { ...process.env, ECHO_ARENA_USER_DATA: userData, ECHO_ARENA_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [ROOT_DIR], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
    }, SIZE);
    await page.waitForSelector('body[data-ready]');

    // 标题画面：背后是自动演示的战斗。
    await page.waitForTimeout(2500);
    await shot(page, 'title');

    // 新手指引（全新安装）：手指演示拖动队员，拖到一半时截图。
    await page.click('[data-testid=start]');
    await toDragStep(page);
    await shot(page, 'guide-drag', 1250);

    // 第一次有箭被反射盾弹回：定格讲回响，亮点沿着箭的去向飞到一半时截图。
    await dragAndStart(page);
    await playUntilLesson(page);
    if (!(await title(page)).startsWith('回响'))
      throw new Error(`意外的一课：${await title(page)}`);
    await shot(page, 'guide-echo', 650);
    await page.click('[data-testid=guide-skip]');

    // 爆爆虫潮：冲锋、弹射、连爆一路连锁。
    await setupRun(page, 'swarm', CHAIN_BUILD, 3);
    await fightUntil(page, 8.9);
    await shot(page, 'chain');

    // 木箭齐射队：反射盾把箭弹回去，再弹向下一个射手。
    await setupRun(page, 'volley', REFLECT_BUILD, 2);
    await fightUntil(page, 6.15);
    await shot(page, 'battle');

    // 打完这一场，挑奖励。
    for (let i = 0; i < 12 && !(await page.evaluate(() => window.__echo.result())); i++) {
      await page.evaluate(() => window.__echo.fastForward(20));
    }
    await page.click('[data-testid=result-next]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid=reward]');
    await page.locator('[data-testid^=offer-]').first().click();
    await shot(page, 'reward');

    // 教学战：放招式的第二步，手指点在对手中间。
    await page.click('[data-testid=reward-confirm]');
    await page.waitForSelector('[data-testid=fight]');
    await page.click('[data-testid=menu]');
    await page.getByRole('button', { name: '回到标题（进度已保存）' }).click();
    await page.click('[data-testid=title-guide]');
    await toDragStep(page);
    await dragAndStart(page);
    for (let i = 0; i < 3; i++) {
      await playUntilLesson(page);
      if ((await title(page)).startsWith('第一步')) break;
      await page.click('[data-testid=guide-next]');
    }
    // 等挑奖励时弹出的提示条消失，再点招式按钮；手指按下去时截图。
    await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0);
    await page.click('[data-testid=skill-bell]');
    await waitTitle(page, '第二步：点场地放出去');
    await shot(page, 'guide-skill', 500);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
