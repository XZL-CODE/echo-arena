// 开发模式：TypeScript 监听编译 + public 目录同步 + 本机服务（刷新浏览器即可看到改动）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build, copyPublic } from './build.mjs';
import { DEFAULT_PORT, PUBLIC_DIR, ROOT_DIR } from './paths.mjs';
import { createGameServer, listen } from './server.mjs';

build();

const tsc = spawn(
  process.execPath,
  [
    path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    'tsconfig.json',
    '-w',
    '--preserveWatchOutput',
  ],
  { cwd: ROOT_DIR, stdio: 'inherit' },
);

let copyTimer = null;
fs.watch(PUBLIC_DIR, { recursive: true }, () => {
  clearTimeout(copyTimer);
  copyTimer = setTimeout(copyPublic, 100);
});

const { server, store } = createGameServer();
const port = await listen(server, DEFAULT_PORT + 1);
console.log(`开发服务：http://127.0.0.1:${port}/  （存档：${store.savePath}）`);

process.on('SIGINT', () => {
  tsc.kill();
  server.close(() => process.exit(0));
});
