// 启动客户端：默认用 node_modules 里的 Electron 运行源码；
// 设置 ECHO_ARENA_EXECUTABLE（文件或打包输出目录）时启动打包后的程序。
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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
  return { app, page, userData: dir };
}

/** 等界面启动完毕，并记录页面里的脚本错误（测试结束时应为空）。 */
export async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('body[data-ready]', { timeout: 30_000 });
  return errors;
}

/** 读取存档文件；文件不存在时返回 null。 */
export function readSave(userData: string): SaveFile | null {
  const file = path.join(userData, 'save.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SaveFile;
}

export interface SaveFile {
  app: string;
  settings: Record<string, unknown>;
  run: {
    matchIndex: number;
    phase: string;
    inBattle: boolean;
    levels: Record<string, number>;
    loadout: Record<string, Array<string | null>>;
    formation: { units: Record<string, { x: number; y: number }> };
    records: Array<{ encounterId: string; attempts: number; won: boolean }>;
  } | null;
}

export function screenshotPath(name: string): string {
  const dir = path.join(ROOT, 'test-results', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${process.platform}.png`);
}
