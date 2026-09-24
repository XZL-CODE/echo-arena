// 构建：用 TypeScript 编译 src → dist/js（浏览器原生 ES 模块），再复制 public 静态文件。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILD_STAMP, DIST_DIR, PUBLIC_DIR, ROOT_DIR, SRC_DIR } from './paths.mjs';

const TSC = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');

export function runTsc(args) {
  if (!fs.existsSync(TSC)) {
    throw new Error('缺少 TypeScript 编译器，请先在项目目录执行 npm install。');
  }
  const result = spawnSync(process.execPath, [TSC, ...args], { cwd: ROOT_DIR, stdio: 'inherit' });
  return result.status === 0;
}

export function copyPublic() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.cpSync(PUBLIC_DIR, DIST_DIR, { recursive: true });
}

export function build() {
  fs.rmSync(path.join(DIST_DIR, 'js'), { recursive: true, force: true });
  copyPublic();
  if (!runTsc(['-p', 'tsconfig.json'])) {
    throw new Error('TypeScript 编译失败。');
  }
  fs.writeFileSync(BUILD_STAMP, new Date().toISOString());
}

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target)) {
    newest = Math.max(newest, newestMtime(path.join(target, entry)));
  }
  return newest;
}

/** dist 不存在，或源码、静态文件、编译配置比上次构建新时需要重新构建。 */
export function needsBuild() {
  if (!fs.existsSync(BUILD_STAMP)) return true;
  const builtAt = fs.statSync(BUILD_STAMP).mtimeMs;
  const sources = [SRC_DIR, PUBLIC_DIR, path.join(ROOT_DIR, 'tsconfig.json')];
  return sources.some((source) => newestMtime(source) > builtAt);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    build();
    console.log('构建完成：dist/');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
