// 一键启动客户端：首次自动安装依赖（含 Electron）并构建，然后打开游戏窗口。
// 用法：node scripts/start.mjs [--attach]
//   --attach  保持在前台运行（开发时查看日志）；默认打开窗口后脚本立即结束。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, needsBuild } from './build.mjs';
import { ELECTRON_MIRROR, MIN_NODE, ROOT_DIR } from './paths.mjs';

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const [needMajor, needMinor] = MIN_NODE;
  if (major < needMajor || (major === needMajor && minor < needMinor)) {
    fail(
      `当前 Node.js 版本是 ${process.versions.node}，需要 ${needMajor}.${needMinor} 或更新版本。` +
        '请到 https://nodejs.org 安装 LTS 版后重试。',
    );
  }
}

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
}

function ensureDependencies() {
  const marker = path.join(ROOT_DIR, 'node_modules', 'typescript', 'package.json');
  const electronPackage = path.join(ROOT_DIR, 'node_modules', 'electron', 'package.json');
  if (fs.existsSync(marker) && fs.existsSync(electronPackage)) return;
  console.log('首次运行：正在安装依赖（只需一次，需要联网）……');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = run(npm, ['install', '--no-audit', '--no-fund']);
  if (result.status !== 0 || !fs.existsSync(marker)) {
    fail('依赖安装失败。请检查网络后重试，或在项目目录手动执行 npm install。');
  }
}

/** Electron 程序本体在第一次使用时下载；官方源失败时改用国内镜像再试一次。 */
function ensureElectronBinary() {
  const installer = path.join(ROOT_DIR, 'node_modules', 'electron', 'install.js');
  const attempt = (env) =>
    spawnSync(process.execPath, [installer], { cwd: ROOT_DIR, stdio: 'inherit', env });
  if (attempt(process.env).status === 0) return;
  if (process.env.ELECTRON_MIRROR) fail('Electron 下载失败，请检查网络或 ELECTRON_MIRROR 设置。');
  console.log(`Electron 下载失败，改用镜像 ${ELECTRON_MIRROR} 重试……`);
  if (attempt({ ...process.env, ELECTRON_MIRROR }).status !== 0) {
    fail('Electron 下载失败。请检查网络后重试。');
  }
}

function ensureBuild() {
  if (!needsBuild()) return;
  console.log('正在构建游戏……');
  try {
    build();
  } catch (error) {
    fail(`构建失败：${error instanceof Error ? error.message : error}`);
  }
}

function electronExecutable() {
  // electron 包的入口返回可执行文件路径；缺失时会尝试下载。
  return require(path.join(ROOT_DIR, 'node_modules', 'electron'));
}

function main() {
  const attach = process.argv.includes('--attach');
  checkNodeVersion();
  ensureDependencies();
  ensureElectronBinary();
  ensureBuild();

  const executable = electronExecutable();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (attach) {
    const child = spawn(executable, [ROOT_DIR], { stdio: 'inherit', env });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  const child = spawn(executable, [ROOT_DIR], { stdio: 'ignore', detached: true, env });
  child.on('error', (error) => fail(`无法启动游戏窗口：${error.message}`));
  child.unref();
  console.log('\n  回声竞技场已启动，这个终端窗口可以关闭了。\n');
}

main();
