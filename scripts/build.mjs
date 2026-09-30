// 构建：用 TypeScript 编译 src → dist/js（浏览器原生 ES 模块），再复制 public 静态文件，
// 并把用到的 three.js 文件拷进 dist/vendor（页面用 import map 把 'three' 指向这里）。
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILD_STAMP, DIST_DIR, PUBLIC_DIR, ROOT_DIR, SRC_DIR } from './paths.mjs';

const TSC = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
const THREE_DIR = path.join(ROOT_DIR, 'node_modules', 'three');
const VENDOR_DIR = path.join(DIST_DIR, 'vendor', 'three');
/** 页面里的 import map：内容的哈希要写进内容安全策略才允许执行。 */
const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;

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
  for (const name of fs.readdirSync(DIST_DIR)) {
    if (name.endsWith('.html')) pinImportMap(path.join(DIST_DIR, name));
  }
}

/** 把页面里 import map 的哈希写进内容安全策略（格式化工具改了缩进也不会失效）。 */
function pinImportMap(file) {
  const html = fs.readFileSync(file, 'utf8');
  const map = IMPORT_MAP.exec(html);
  if (!map) return;
  const hash = crypto.createHash('sha256').update(map[1]).digest('base64');
  const pinned = html.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);
  if (!pinned.includes(hash)) throw new Error(`${file} 的内容安全策略里缺少 import map 的哈希。`);
  if (pinned !== html) fs.writeFileSync(file, pinned);
}

/** 模块里引用的 three.js 扩展（'three/addons/...'）。 */
function addonImports(source) {
  const out = [];
  for (const m of source.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of source.matchAll(/import\s*\(\s*['"]three\/addons\/([^'"]+)['"]\s*\)/g)) {
    out.push(m[1]);
  }
  return out;
}

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJs(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * 拷贝 three.js 本体和实际用到的扩展（连同它们相对引用的文件）。
 * 扩展里的 'three' 由页面的 import map 解析，文件本身不改。
 */
export function copyThree() {
  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  for (const name of ['three.module.js', 'three.core.js']) {
    fs.copyFileSync(path.join(THREE_DIR, 'build', name), path.join(VENDOR_DIR, name));
  }
  const pending = listJs(path.join(DIST_DIR, 'js')).flatMap((file) =>
    addonImports(fs.readFileSync(file, 'utf8')),
  );
  const done = new Set();
  const jsm = path.join(THREE_DIR, 'examples', 'jsm');
  while (pending.length > 0) {
    const rel = path.posix.normalize(pending.pop());
    if (done.has(rel)) continue;
    done.add(rel);
    const from = path.join(jsm, rel);
    if (!fs.existsSync(from)) throw new Error(`找不到 three.js 扩展：${rel}`);
    const to = path.join(VENDOR_DIR, 'addons', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    const source = fs.readFileSync(from, 'utf8');
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      pending.push(path.posix.join(path.posix.dirname(rel), m[1]));
    }
  }
}

export function build() {
  fs.rmSync(path.join(DIST_DIR, 'js'), { recursive: true, force: true });
  copyPublic();
  if (!runTsc(['-p', 'tsconfig.json'])) {
    throw new Error('TypeScript 编译失败。');
  }
  copyThree();
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
