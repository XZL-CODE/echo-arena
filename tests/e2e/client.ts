// 启动客户端：默认用 node_modules 里的 Electron 运行源码；
// 设置 ECHO_ARENA_EXECUTABLE（文件或打包输出目录）时启动打包后的程序。
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// path.resolve 去掉末尾的分隔符：Windows 上 Playwright 会给参数加引号，
// 末尾的反斜杠会把收尾引号转义掉，导致 Electron 拿到错误的程序路径。
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

export interface Client {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/** 把打包输出目录解析成可执行文件路径（.app 包、win-unpacked 目录或直接的文件）。 */
export function resolveExecutable(target: string): string {
  const full = path.resolve(ROOT, target);
  const stat = fs.statSync(full);
  if (stat.isFile()) return full;
  const appBundle = full.endsWith('.app')
    ? full
    : fs.readdirSync(full).find((f) => f.endsWith('.app'));
  if (appBundle) {
    const macos = path.join(
      full.endsWith('.app') ? full : path.join(full, appBundle),
      'Contents',
      'MacOS',
    );
    const [binary] = fs.readdirSync(macos);
    if (!binary) throw new Error(`No executable in ${macos}`);
    return path.join(macos, binary);
  }
  const candidates = fs
    .readdirSync(full)
    .filter((f) =>
      process.platform === 'win32'
        ? f.endsWith('.exe') && !/uninstall/i.test(f)
        : f === 'EchoArena' || f === 'echo-arena',
    );
  if (!candidates[0]) throw new Error(`No executable found in ${full}`);
  return path.join(full, candidates[0]);
}

export interface LaunchOptions {
  /** 复用已有的用户数据目录（模拟关闭后重新打开）。 */
  userData?: string;
  /** 打开测试钩子 window.__echo（快进、直接摆出对局等）。 */
  hooks?: boolean;
}

export async function launchClient(options: LaunchOptions = {}): Promise<Client> {
  const dir = options.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-e2e-'));
  const env = { ...process.env, ECHO_ARENA_USER_DATA: dir } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  if (options.hooks) env.ECHO_ARENA_TEST = '1';
  else delete env.ECHO_ARENA_TEST;
  const target = process.env.ECHO_ARENA_EXECUTABLE;
  const app = target
    ? await electron.launch({ executablePath: resolveExecutable(target), env })
    : await electron.launch({ args: [ROOT], env });
  const page = await app.firstWindow();
  // 没有显卡的机器（CI）用软件渲染，首领战一帧要画一秒以上，一次点击要等好几帧才生效，
  // 默认 30 秒的操作时限不够
  page.setDefaultTimeout(90_000);
  return { app, page, userData: dir };
}

/** 等界面启动完毕，并记录页面里的脚本错误（测试结束时应为空）。 */
export async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('body[data-ready]', { timeout: 30_000 });
  return errors;
}

/** 新安装会在第一场战前准备弹出新手指引；与指引无关的测试先把它跳过（一次跳过全部课程）。 */
export async function skipGuide(page: Page): Promise<void> {
  const skip = page.locator('[data-testid=guide-skip]');
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.locator('[data-testid=guide]')).toBeHidden();
}

/** 读取存档文件；文件不存在时返回 null。 */
export function readSave(userData: string): SaveFile | null {
  const file = path.join(userData, 'save.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SaveFile;
}

export interface SavedPet {
  uid: number;
  species: string;
  form: number;
  x: number;
  y: number;
}

export interface SaveFile {
  app: string;
  version: number;
  settings: Record<string, unknown> & { guideSeen: string[] };
  run: {
    matchIndex: number;
    phase: string;
    inBattle: boolean;
    legion: SavedPet[];
    records: Array<{ encounterId: string; attempts: number; won: boolean }>;
  } | null;
  records: { runsStarted: number; runsCompleted: number };
  codex: string[];
}

// ---- 测试钩子（启动时 hooks: true） ----

export interface HookState {
  screen: string;
  practice: boolean;
  run: {
    matchIndex: number;
    phase: string;
    inBattle: boolean;
    attempts: number[];
    legion: SavedPet[];
    rewards: { capture: unknown[]; evolve: unknown[] } | null;
  } | null;
  battle: { t: number; result: 'win' | 'lose' | null; focusId: number; paused: boolean } | null;
  settings: Record<string, unknown> & { guideSeen: string[] };
}

export interface UnitInfo {
  id: number;
  uid: number;
  team: number;
  species: string;
  form: number;
  alive: boolean;
  hp: number;
  screen: { x: number; y: number; top: number } | null;
}

export interface FxStats {
  units: number;
  particles: number;
  effects: number;
  quality: number;
  drawMs: number;
  fps: number;
  /** 累计画了多少帧。 */
  frames: number;
  /** 正在拍的特写：0 没有，1 技能特写，2 大招特写。 */
  shot: number;
  shotUnit: number;
}

export interface Hooks {
  state(): HookState;
  newRun(o?: { seed?: number; difficulty?: string; starter?: string }): void;
  patchRun(o: { matchIndex?: number; legion?: Array<{ species: string; form: number }> }): void;
  startBattle(): void;
  hold(on: boolean): void;
  speed(n: number): void;
  fastForward(seconds: number): void;
  units(): UnitInfo[];
  focus(id: number): void;
  fxStats(): FxStats;
  guide(): boolean;
}
export type HookWindow = { __echo: Hooks };

export function state(page: Page): Promise<HookState> {
  return page.evaluate(() => (window as unknown as HookWindow).__echo.state());
}

/** 用固定种子新开一轮，直接到第一场战前准备。 */
export async function newRun(page: Page, seed = 7): Promise<void> {
  await page.evaluate((s) => (window as unknown as HookWindow).__echo.newRun({ seed: s }), seed);
  await expect(page.locator('[data-testid=start-battle]')).toBeVisible();
}

/** 改这一轮：跳到第几场、换一支军团（回到战前准备）。 */
export async function patchRun(
  page: Page,
  matchIndex: number,
  legion?: Array<{ species: string; form: number }>,
): Promise<void> {
  await page.evaluate(
    ([m, l]) => (window as unknown as HookWindow).__echo.patchRun({ matchIndex: m, legion: l }),
    [matchIndex, legion] as const,
  );
  await expect(page.locator('[data-testid=start-battle]')).toBeVisible();
}

/**
 * 开战。hold 为 true 时先停住实时推进：战斗只靠快进走（画面照常刷新），
 * 胜负与机器快慢无关。
 */
export async function fight(page: Page, hold = true): Promise<void> {
  if (hold) await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));
  await page.click('[data-testid=start-battle]');
  await expect(page.locator('[data-testid=battle-hud]')).toBeVisible();
  if (hold) await page.evaluate(() => (window as unknown as HookWindow).__echo.hold(true));
}

/** 快进到分出胜负，返回结果（结算界面在收尾演完后出现）。 */
export async function finishBattle(page: Page): Promise<'win' | 'lose'> {
  for (let i = 0; i < 20; i++) {
    const result = await page.evaluate(() => {
      const echo = (window as unknown as HookWindow).__echo;
      echo.fastForward(15);
      return echo.state().battle?.result ?? null;
    });
    if (result) return result;
  }
  throw new Error('战斗没有在 300 秒内结束');
}

/** 手指演示的位置（指尖；拖动时还有终点）。 */
export async function handPoints(
  page: Page,
): Promise<{ x: number; y: number; toX: number; toY: number }> {
  const hand = page.locator('[data-testid=guide-hand]');
  await expect(hand).toHaveAttribute('data-x', /\d/);
  return hand.evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.x), y: Number(d.y), toX: Number(d.toX), toY: Number(d.toY) };
  });
}

/** 照着手指点一下。 */
export async function tapHand(page: Page): Promise<void> {
  const p = await handPoints(page);
  await page.mouse.click(p.x, p.y);
}

/** 照着手指从起点拖到终点。 */
export async function dragHand(page: Page): Promise<void> {
  await expect(page.locator('[data-testid=guide-hand]')).toHaveAttribute('data-to-x', /\d/);
  const p = await handPoints(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.toX, p.toY, { steps: 10 });
  await page.mouse.up();
}

export function screenshotPath(name: string): string {
  const dir = path.join(ROOT, 'test-results', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${process.platform}.png`);
}
