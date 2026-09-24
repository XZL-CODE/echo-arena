// 一键启动：首次自动安装依赖并构建，然后启动本机服务并打开浏览器。
// 用法：node scripts/start.mjs [--no-open] [--port 5188]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { build, needsBuild } from './build.mjs';
import { APP_ID, DEFAULT_PORT, PORT_ATTEMPTS, ROOT_DIR } from './paths.mjs';
import { createGameServer, listen } from './server.mjs';

const MIN_NODE_MAJOR = 18;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    fail(
      `当前 Node.js 版本是 ${process.versions.node}，需要 ${MIN_NODE_MAJOR} 或更新版本。` +
        '请到 https://nodejs.org 安装 LTS 版后重试。',
    );
  }
}

function ensureDependencies() {
  const tscPackage = path.join(ROOT_DIR, 'node_modules', 'typescript', 'package.json');
  if (fs.existsSync(tscPackage)) return;
  console.log('首次运行：正在安装构建依赖（只需一次，需要联网）……');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0 || !fs.existsSync(tscPackage)) {
    fail('依赖安装失败。请检查网络后重试，或在项目目录手动执行 npm install。');
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

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === APP_ID);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function openBrowser(url) {
  const commands = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '""', url]],
  };
  const [command, args] = commands[process.platform] ?? ['xdg-open', [url]];
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.on('error', () => console.log(`无法自动打开浏览器，请手动访问：${url}`));
    child.unref();
  } catch {
    console.log(`无法自动打开浏览器，请手动访问：${url}`);
  }
}

function parseArgs(argv) {
  const options = { open: !process.env.ECHO_ARENA_NO_OPEN, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') options.open = false;
    else if (argv[i] === '--port') options.port = Number(argv[++i]);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  checkNodeVersion();
  ensureDependencies();
  ensureBuild();

  const { server, store } = createGameServer();
  let port = null;
  for (let candidate = options.port; candidate < options.port + PORT_ATTEMPTS; candidate++) {
    if (await probe(candidate)) {
      const url = `http://127.0.0.1:${candidate}/`;
      console.log(`游戏服务已经在运行：${url}`);
      if (options.open) openBrowser(url);
      return;
    }
    try {
      port = await listen(server, candidate);
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') fail(`启动本机服务失败：${error.message}`);
    }
  }
  if (port === null) {
    fail(`端口 ${options.port}–${options.port + PORT_ATTEMPTS - 1} 都被占用，无法启动。`);
  }

  const url = `http://127.0.0.1:${port}/`;
  console.log('');
  console.log('  回声竞技场已启动');
  console.log(`  游戏地址：${url}`);
  console.log(`  存档位置：${store.savePath}`);
  console.log('  游玩期间请保持此窗口打开；关闭窗口或按 Ctrl+C 即停止游戏服务。');
  console.log('');
  if (options.open) openBrowser(url);

  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => fail(`启动失败：${error instanceof Error ? error.message : error}`));
