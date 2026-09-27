// 生成 README 用的截图（docs/screenshots/*.jpg）：启动真实客户端，用测试钩子摆出场景后截图。
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

async function shot(page, name) {
  await page.waitForTimeout(150);
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

    // 新手指引：全新安装，进入第一场准备后的第二步。
    await page.click('[data-testid=start]');
    await page.waitForSelector('[data-testid=guide]', { state: 'visible' });
    await page.click('[data-testid=guide-next]');
    await shot(page, 'guide');

    // 爆爆虫潮：冲锋、弹射、连爆一路连锁。
    await setupRun(page, 'swarm', CHAIN_BUILD, 3);
    await page.click('[data-testid=guide-skip]');
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
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
