// 自动更新（主进程）：读 GitHub Release 上的更新清单，下载新版安装包、用内置公钥核对签名，
// 然后安装并重新打开。只有检查和下载更新时联网；什么时候检查、怎么提示由页面决定（src/ui/updates.tsx）。
//
// 测试用的环境变量：
// - ECHO_ARENA_UPDATE_URL：更新清单的地址；off 表示不检查。设了它才认 ECHO_ARENA_UPDATE_PUBKEY（测试公钥）。
// - ECHO_ARENA_UPDATE_DRY_RUN=1：下载并核对签名，但不安装、不退出。
const { app, ipcMain, net, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createVerifier } = require('./minisign.cjs');
const core = require('./update-core.cjs');

const CHECK_TIMEOUT = 20_000;
/** 下载时超过这么久没收到数据就放弃；慢网络下整体用时不设上限。 */
const STALL_TIMEOUT = 60_000;
/** 进度事件的最短间隔（毫秒）。 */
const PROGRESS_INTERVAL = 100;

// macOS：等游戏退出后，把旧的 .app 挪开、换上新的，失败时放回旧的，最后打开留在原处的那个。
const MAC_REPLACE_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; staged="$3"; backup="$4"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then echo "游戏没有退出，放弃更新"; exit 1; fi
  sleep 0.2
done
rm -rf "$backup"
if mv "$target" "$backup"; then
  if mv "$staged" "$target"; then
    rm -rf "$backup"
    echo "已换上新版本"
  else
    mv "$backup" "$target"
    echo "换上新版本失败，已放回旧版本"
  fi
else
  echo "挪不开旧版本，没有更新"
fi
open "$target"
`;

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`${path.basename(file)} 出错：${(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

function createUpdater({ getWindow }) {
  const feedOverride = process.env.ECHO_ARENA_UPDATE_URL;
  const enabled = feedOverride !== 'off' && process.env.ECHO_ARENA_DEV !== '1';
  const feedUrl = feedOverride && feedOverride !== 'off' ? feedOverride : core.FEED_URL;
  // 测试用的更新源可以配一把测试公钥；正式的更新源只认内置的公钥。
  const publicKey =
    feedOverride && process.env.ECHO_ARENA_UPDATE_PUBKEY
      ? process.env.ECHO_ARENA_UPDATE_PUBKEY
      : core.PUBLIC_KEY;
  const dryRun = process.env.ECHO_ARENA_UPDATE_DRY_RUN === '1';
  const workDir = path.join(app.getPath('temp'), 'EchoArena-update');
  /** 最近一次检查发现、还没装的更新。 */
  let pending = null;
  let installing = false;

  /** macOS 上 .app 包的位置；Windows 上免安装版的文件路径。 */
  function where() {
    if (process.platform === 'darwin') return core.macBundlePath(app.getPath('exe'));
    if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE || null;
    return null;
  }

  function mode() {
    if (dryRun) return { auto: true };
    const place = where();
    let writable = false;
    if (process.platform === 'darwin' && place) {
      try {
        fs.accessSync(path.dirname(place), fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    return core.installMode({
      platform: process.platform,
      packaged: app.isPackaged,
      where: place,
      writable,
    });
  }

  function info() {
    const m = mode();
    return {
      version: app.getVersion(),
      enabled,
      auto: m.auto,
      reason: m.reason ?? null,
    };
  }

  async function check() {
    if (!enabled) return { status: 'error', message: '这个版本不检查更新。' };
    if (!installing) await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    try {
      const response = await net.fetch(feedUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(CHECK_TIMEOUT),
      });
      if (response.status === 404) throw new Error('还没有发布带更新清单的版本。');
      if (!response.ok) throw new Error(`更新服务器返回 ${response.status}。`);
      const manifest = await response.json().catch(() => {
        throw new Error('更新清单格式不对');
      });
      const current = app.getVersion();
      const update = core.readManifest(
        manifest,
        current,
        core.platformKey(process.platform, process.arch),
      );
      if (!installing) pending = update;
      if (!update) return { status: 'latest', version: current };
      return {
        status: 'available',
        version: update.version,
        current,
        date: update.date,
        notes: core.cleanNotes(update.notes),
      };
    } catch (error) {
      return { status: 'error', message: describe(error) };
    }
  }

  function describe(error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return '连接超时，请检查网络后再试。';
    }
    const text = error instanceof Error ? error.message : String(error);
    if (/^net::/.test(text)) return `连不上更新服务器（${text}）。`;
    return /[。！？.]$/.test(text) ? text : `${text}。`;
  }

  function sendProgress(progress) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:progress', progress);
  }

  /** 下载到 file，边下边核对签名；对不上就删掉并报错。 */
  async function download(update, file) {
    const verifier = createVerifier(publicKey, update.signature);
    const controller = new AbortController();
    let stall = setTimeout(() => controller.abort(), STALL_TIMEOUT);
    let received = 0;
    let total = 0;
    let lastSent = 0;
    try {
      const response = await net.fetch(update.url, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`下载失败（服务器返回 ${response.status}）。`);
      total = Number(response.headers.get('content-length')) || 0;
      sendProgress({ phase: 'downloading', received, total });
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          clearTimeout(stall);
          stall = setTimeout(() => controller.abort(), STALL_TIMEOUT);
          verifier.update(chunk);
          received += chunk.length;
          const now = Date.now();
          if (now - lastSent >= PROGRESS_INTERVAL) {
            lastSent = now;
            sendProgress({ phase: 'downloading', received, total });
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file), {
        signal: controller.signal,
      });
      sendProgress({ phase: 'verifying', received, total });
      if (total && received !== total) throw new Error('下载不完整，请重试。');
      if (!verifier.verify()) {
        throw new Error('签名核对没通过：下载到的文件和发布的不一致，已删除，没有安装。');
      }
    } catch (error) {
      await fsp.rm(file, { force: true }).catch(() => {});
      if (controller.signal.aborted)
        throw new Error('下载中断：一分钟没有收到数据，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(stall);
    }
  }

  /** macOS：挂载 dmg，把新的 .app 拷出来，交给辅助脚本在游戏退出后替换。 */
  async function prepareMac(file, dir) {
    const target = where();
    const mount = path.join(dir, 'mnt');
    await fsp.mkdir(mount, { recursive: true });
    await run('/usr/bin/hdiutil', [
      'attach',
      file,
      '-nobrowse',
      '-noautoopen',
      '-readonly',
      '-noverify',
      '-mountpoint',
      mount,
    ]);
    let staged;
    try {
      const name = (await fsp.readdir(mount)).find((entry) => entry.endsWith('.app'));
      if (!name) throw new Error('安装包里没有找到应用。');
      staged = path.join(dir, 'new', name);
      await fsp.mkdir(path.dirname(staged), { recursive: true });
      await run('/usr/bin/ditto', [path.join(mount, name), staged]);
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
    }
    const script = path.join(dir, 'replace.sh');
    await fsp.writeFile(script, MAC_REPLACE_SCRIPT, { mode: 0o755 });
    const backup = path.join(dir, 'old', path.basename(target));
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    return () => {
      const log = fs.openSync(path.join(dir, 'replace.log'), 'a');
      try {
        return spawn('/bin/sh', [script, String(process.pid), target, staged, backup], {
          detached: true,
          stdio: ['ignore', log, log],
        });
      } finally {
        fs.closeSync(log);
      }
    };
  }

  /** Windows：静默运行 NSIS 安装包（沿用原来的安装位置），装完由安装包重新打开游戏。 */
  function prepareWindows(file) {
    return () =>
      spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
  }

  /** 下载地址里的文件名，只保留安全的字符。 */
  function fileName(url) {
    const name = decodeURIComponent(path.posix.basename(new URL(url).pathname));
    return name.replace(/[^\w.-]/g, '_').replace(/^\.+/, '') || 'update';
  }

  /** 启动安装进程，确认启动成功。 */
  function launch(start) {
    return new Promise((resolve, reject) => {
      const child = start();
      child.once('error', (error) => reject(new Error(`无法启动安装：${error.message}`)));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  async function install() {
    if (installing) return { ok: false, message: '正在更新中。' };
    const update = pending;
    if (!update) return { ok: false, message: '请先检查更新。' };
    const m = mode();
    if (!m.auto) return { ok: false, message: m.reason };
    installing = true;
    try {
      const dir = path.join(workDir, update.version);
      await fsp.rm(workDir, { recursive: true, force: true });
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, fileName(update.url));
      await download(update, file);
      if (dryRun) {
        await fsp.rm(workDir, { recursive: true, force: true });
        installing = false;
        return { ok: true, dryRun: true };
      }
      sendProgress({ phase: 'installing' });
      const start =
        process.platform === 'darwin' ? await prepareMac(file, dir) : prepareWindows(file);
      await launch(start);
      // 稍等让页面显示“正在安装”，然后退出（关窗口时照常写存档）；安装包也会等游戏退出。
      setTimeout(() => app.quit(), 500);
      return { ok: true };
    } catch (error) {
      installing = false;
      return { ok: false, message: describe(error) };
    }
  }

  function openDownloadPage() {
    return shell.openExternal(core.DOWNLOAD_PAGE);
  }

  return { info, check, install, openDownloadPage };
}

function registerUpdateIpc(updater) {
  ipcMain.handle('update:info', () => updater.info());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.install());
  ipcMain.handle('update:open-page', () => updater.openDownloadPage());
}

module.exports = { createUpdater, registerUpdateIpc };
