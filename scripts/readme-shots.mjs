// 生成 README 用的截图（docs/screenshots/*.jpg）：启动真实客户端，按新安装的流程走、用测试钩子摆出场景后截图。
// 特写与大招镜头要等战斗里真的放出来：让战斗实时跑，镜头推近时再截（没有显卡的机器上会比较慢）。
// 用法：npm run shots（Linux 上用 xvfb-run npm run shots）。
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR } from './paths.mjs';

const OUT = path.join(ROOT_DIR, 'docs', 'screenshots');
const SIZE = { width: 1280, height: 800 };

/** 十只人形态（首领战与大招特写用）。 */
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
];
/** 进化到一半的中期军团：幼年、进化形态与人形态混编。 */
const MID_LEGION = [
  { species: 'turtle', form: 2 },
  { species: 'bear', form: 2 },
  { species: 'fox', form: 3 },
  { species: 'cat', form: 3 },
  { species: 'bunny', form: 2 },
  { species: 'otter', form: 2 },
  { species: 'bird', form: 3 },
  { species: 'deer', form: 1 },
];

async function shot(page, name, wait = 150) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 85 });
  console.log(`  docs/screenshots/${name}.jpg`);
}

const echo = (page, fn, arg) => page.evaluate(fn, arg);

async function patchRun(page, matchIndex, legion) {
  await echo(page, ([m, l]) => window.__echo.patchRun({ matchIndex: m, legion: l }), [
    matchIndex,
    legion,
  ]);
  await page.waitForSelector('[data-testid=start-battle]');
  await page.waitForTimeout(1200);
}

/** 开战，安静快进到第 seconds 秒（不放特效和特写），再实时跑 run 秒让画面自然起来。 */
async function fightUntil(page, seconds, run = 1.5) {
  await echo(page, () => window.__echo.hold(true));
  await page.click('[data-testid=start-battle]');
  await page.waitForSelector('[data-testid=battle-hud]');
  await echo(page, () => window.__echo.hold(true));
  await echo(page, (s) => window.__echo.fastForward(s, true), seconds);
  await echo(page, () => window.__echo.hold(false));
  await waitBattleTime(page, seconds + run);
}

async function waitBattleTime(page, t, limit = 240_000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    const now = await echo(page, () => window.__echo.state().battle?.t ?? 0);
    if (now >= t) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`战斗没有在时限内走到 ${t} 秒`);
}

/** 等镜头推近（kind 1 技能特写、2 大招特写），推到位后截图；filter 挑拍的是谁。 */
async function waitShot(page, kind, name, settle, filter = () => true, limit = 300_000) {
  const start = Date.now();
  let seen = 0;
  while (Date.now() - start < limit) {
    const fx = await echo(page, () => window.__echo.fxStats());
    if (fx.shot === kind && fx.shotUnit !== seen) {
      const units = await echo(page, () => window.__echo.units());
      const who = units.find((u) => u.id === fx.shotUnit);
      seen = fx.shotUnit;
      if (who && filter(who)) {
        await page.waitForTimeout(settle);
        await shot(page, name, 0);
        return;
      }
    }
    await page.waitForTimeout(80);
  }
  throw new Error(`没有等到 ${name} 的镜头`);
}

/** 战前菜单 → 设置 → 切换“技能与大招特写”。 */
async function toggleCinematics(page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置' }).click();
  const dialog = page.locator('[data-testid=settings-dialog]');
  await dialog.locator('label.toggle', { hasText: '技能与大招特写' }).click();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=settings-dialog]', { state: 'detached' });
}

/** 战斗中暂停 → 回到战前。 */
async function backToPrep(page) {
  await page.keyboard.press('Escape');
  await page.click('[data-testid=back-to-prep]');
  await page.waitForSelector('[data-testid=start-battle]');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-shots-'));
  const env = { ...process.env, ECHO_ARENA_USER_DATA: userData, ECHO_ARENA_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [ROOT_DIR], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
  }, SIZE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('body[data-ready]', { timeout: 60_000 });

  // 新安装：选伙伴 → 第一场战前准备的新手指引（手指演示拖动站位）
  await page.click('[data-testid=new-run]');
  await page.waitForSelector('[data-testid=depart]');
  await page.click('[data-testid=starter-cat]').catch(() => {});
  await shot(page, 'starter', 1500);
  await page.click('[data-testid=depart]');
  await page.waitForSelector('[data-testid=guide-title]');
  await page.click('[data-testid=guide-next]');
  await page.click('[data-testid=guide-next]');
  await shot(page, 'guide-drag', 2200);
  // 照着拖一下，再点开战：开战这一课演示点敌人集火
  const hand = await echo(page, () => {
    const d = document.querySelector('[data-testid=guide-hand]').dataset;
    return { x: +d.x, y: +d.y, toX: +d.toX, toY: +d.toY };
  });
  await page.mouse.move(hand.x, hand.y);
  await page.mouse.down();
  await page.mouse.move(hand.toX, hand.toY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=battle-hud]');
  await shot(page, 'guide-focus', 2200);
  await page.click('[data-testid=guide-skip]');

  // 战前准备：中期军团对第 4 场
  await echo(page, () => window.__echo.newRun({ seed: 11, starter: 'cat' }));
  await patchRun(page, 3, MID_LEGION);
  await shot(page, 'prep', 800);

  // 战斗全景：技能正在出手的一刻（关掉特写，看全场）
  await toggleCinematics(page);
  await fightUntil(page, 5.5, 1.2);
  await shot(page, 'battle', 0);

  // 技能特写与大招镜头：十只人形态打第 6 场，实时跑，镜头推近时截
  await backToPrep(page);
  await toggleCinematics(page);
  await patchRun(
    page,
    5,
    ALL_STARS.map((species) => ({ species, form: 3 })),
  );
  await page.click('[data-testid=start-battle]');
  await page.waitForSelector('[data-testid=battle-hud]');
  await waitShot(page, 1, 'skill', 350, (u) => u.team === 0);
  await waitShot(page, 2, 'ult', 900, (u) => u.team === 0);

  // 首领战：烛龙兽形喷火
  await backToPrep(page);
  await patchRun(
    page,
    6,
    ALL_STARS.map((species) => ({ species, form: 3 })),
  );
  await fightUntil(page, 3, 1.6);
  await shot(page, 'boss', 0);

  // 奖励：选好收服和进化；再看进化演出
  await echo(page, () => window.__echo.newRun({ seed: 11, starter: 'cat' }));
  await patchRun(page, 2, MID_LEGION.slice(0, 6));
  await echo(page, () => window.__echo.hold(true));
  await page.click('[data-testid=start-battle]');
  for (let i = 0; i < 30; i++) {
    const r = await echo(page, () => {
      window.__echo.fastForward(10, true);
      return window.__echo.state().battle?.result ?? null;
    });
    if (r) break;
  }
  await page.waitForSelector('[data-testid=to-reward]', { timeout: 60_000 });
  await page.click('[data-testid=to-reward]');
  await page.waitForSelector('[data-testid=claim]');
  if (await page.$('[data-testid=capture-0]')) await page.click('[data-testid=capture-0]');
  // 进化挑一个变人形态的（演出最完整）
  const offer = await echo(page, () => window.__echo.state().run?.rewards);
  const human = offer?.evolve.findIndex((v) => v.to === 3) ?? -1;
  const pick = human >= 0 ? human : offer?.evolve.length ? 0 : -1;
  if (pick >= 0) await page.click(`[data-testid=evolve-${pick}]`);
  await shot(page, 'reward', 1800);
  await page.click('[data-testid=claim]');
  if (pick >= 0) {
    await shot(page, 'evolve', 2300);
    await page.waitForSelector('[data-testid=evolve-done]', { timeout: 30_000 });
    await page.click('[data-testid=evolve-done]');
  }

  // 图鉴：见过的形态点开看介绍
  await page.waitForSelector('[data-testid=start-battle]');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '回到标题' }).click();
  await page.waitForSelector('[data-testid=codex]');
  await page.click('[data-testid=codex]');
  await page.waitForSelector('[data-testid=codex-grid]');
  await page.click('[data-testid=codex-cat-3]');
  await shot(page, 'codex', 1800);

  // 标题画面
  await page.click('[data-testid=codex-back]');
  await shot(page, 'title', 2200);

  await app.close();
  if (errors.length) {
    console.error('页面报错：', errors);
    process.exitCode = 1;
  }
}

await main();
