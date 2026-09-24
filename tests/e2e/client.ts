// 启动客户端：默认用 node_modules 里的 Electron 运行源码；
// 设置 ECHO_ARENA_EXECUTABLE（文件或打包输出目录）时启动打包后的程序。
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

export async function launchClient(userData?: string): Promise<Client> {
  const dir = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-e2e-'));
  const env = { ...process.env, ECHO_ARENA_USER_DATA: dir } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const target = process.env.ECHO_ARENA_EXECUTABLE;
  const app = target
    ? await electron.launch({ executablePath: resolveExecutable(target), env })
    : await electron.launch({ args: [ROOT], env });
  const page = await app.firstWindow();
  return { app, page, userData: dir };
}

export function screenshotPath(name: string): string {
  const dir = path.join(ROOT, 'test-results', 'screens');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${process.platform}.png`);
}
