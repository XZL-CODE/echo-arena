// 真正替换安装的更新：用 CI 刚打出的安装包冒充“新版本 9.9.9”（测试密钥签名），从游戏里点“立即更新”，
// 核对旧程序被替换、游戏自动重新打开。
// - macOS：把 .app 拷到临时目录再打开，更新后那个位置换成了 dmg 里的新 .app。
// - Windows：先用安装包静默装到临时目录，更新后安装目录被重装（旧文件清掉）。
// 只在 CI 的打包任务里跑（ECHO_ARENA_INSTALL_TEST=1）：Windows 安装会写当前用户的注册表。
import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchClient, resolveExecutable } from './client';
import { createTestKey, releaseBody, startFeed } from './update-feed';

const target = process.env.ECHO_ARENA_EXECUTABLE;
const enabled =
  process.env.ECHO_ARENA_INSTALL_TEST === '1' &&
  !!target &&
  (process.platform === 'darwin' || process.platform === 'win32');

test.skip(!enabled, '只在 CI 打包任务里对打包好的程序跑');
test.setTimeout(8 * 60_000);

/** 打包输出目录里的安装包（dmg 或 NSIS 安装版）。 */
function installerFile(): string {
  const dir = path.resolve(target ?? '', '..');
  const pattern = process.platform === 'darwin' ? /\.dmg$/ : /-win-setup\.exe$/;
  const name = fs.readdirSync(dir).find((f) => pattern.test(f));
  if (!name) throw new Error(`No installer next to ${target}`);
  return path.join(dir, name);
}

function running(match: string): boolean {
  if (process.platform === 'darwin') {
    return spawnSync('pgrep', ['-f', match]).status === 0;
  }
  const script = `@(Get-Process EchoArena -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${match}*' }).Count`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return Number(out.trim()) > 0;
}

function stopAll(match: string): void {
  if (process.platform === 'darwin') spawnSync('pkill', ['-f', match]);
  else spawnSync('taskkill', ['/F', '/IM', 'EchoArena.exe']);
}

test('立即更新：下载新版、核对签名、替换安装并自动重新打开', async () => {
  const key = createTestKey();
  const feed = await startFeed(key);
  const installer = installerFile();
  const data = fs.readFileSync(installer);
  feed.publish({
    version: '9.9.9',
    data,
    file: path.basename(installer),
    notes: releaseBody('9.9.9', ['安装测试']),
  });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-install-'));
  let executable: string;
  /** 换没换成新版本、新版本在不在运行的判断依据。 */
  let replaced: () => boolean;
  let processMatch: string;
  if (process.platform === 'darwin') {
    const exe = resolveExecutable(target ?? '');
    const bundle = exe.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const copy = path.join(work, 'Applications', path.basename(bundle));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    execFileSync('ditto', [bundle, copy]);
    executable = path.join(copy, 'Contents', 'MacOS', path.basename(exe));
    const inode = fs.statSync(copy).ino;
    replaced = () => fs.existsSync(copy) && fs.statSync(copy).ino !== inode;
    processMatch = path.join(copy, 'Contents', 'MacOS');
  } else {
    const dir = path.join(work, 'EchoArena');
    const install = spawnSync(installer, ['/S', '/currentuser', `/D=${dir}`]);
    expect(install.status).toBe(0);
    executable = path.join(dir, 'EchoArena.exe');
    expect(fs.existsSync(executable)).toBe(true);
    const marker = path.join(dir, 'old-version.txt');
    fs.writeFileSync(marker, 'old');
    replaced = () => !fs.existsSync(marker) && fs.existsSync(executable);
    processMatch = dir;
  }

  try {
    const { app, page } = await launchClient({
      executable,
      env: {
        ECHO_ARENA_UPDATE_URL: feed.manifestUrl,
        ECHO_ARENA_UPDATE_PUBKEY: key.publicKey,
      },
    });
    const closed = app.waitForEvent('close', { timeout: 5 * 60_000 });
    await page.click('[data-testid=update-badge]', { timeout: 60_000 });
    await expect(page.locator('[data-testid=update-manual]')).toHaveCount(0);
    await page.click('[data-testid=update-install]');
    // 下载、核对签名、准备安装，然后游戏自己退出
    await closed;
    expect(feed.requests).toContain(`/download/${path.basename(installer)}`);

    await expect.poll(replaced, { timeout: 4 * 60_000, intervals: [1000] }).toBe(true);
    await expect
      .poll(() => running(processMatch), { timeout: 2 * 60_000, intervals: [1000] })
      .toBe(true);
  } finally {
    const log = path.join(os.tmpdir(), 'EchoArena-update', '9.9.9', 'replace.log');
    if (fs.existsSync(log)) console.log(`replace.log:\n${fs.readFileSync(log, 'utf8')}`);
    stopAll(processMatch);
    await feed.close();
    if (process.platform === 'win32') {
      const dir = path.dirname(executable);
      const uninstaller = fs.existsSync(dir)
        ? fs.readdirSync(dir).find((f) => /^Uninstall .*\.exe$/.test(f))
        : undefined;
      if (uninstaller) spawnSync(path.join(dir, uninstaller), ['/S', '/currentuser']);
    }
  }
});
