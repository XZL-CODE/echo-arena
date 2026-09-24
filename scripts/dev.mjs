// 开发模式：TypeScript 监听编译 + public 同步 + 客户端窗口（dist 变化后自动刷新）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build, copyPublic } from './build.mjs';
import { PUBLIC_DIR, ROOT_DIR } from './paths.mjs';

const require = createRequire(import.meta.url);

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

const electron = require(path.join(ROOT_DIR, 'node_modules', 'electron'));
const env = { ...process.env, ECHO_ARENA_DEV: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, [ROOT_DIR], { stdio: 'inherit', env });
app.on('exit', (code) => {
  tsc.kill();
  process.exit(code ?? 0);
});
