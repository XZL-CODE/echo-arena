// 编译 src/core 与 tests/unit 到 build/test，然后用 Node 内置测试运行器执行。
// --balance：改为运行平衡检查脚本（打印各场对局在不同配置下的胜负与用时）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runTsc } from './build.mjs';
import { ROOT_DIR } from './paths.mjs';

const OUT_DIR = path.join(ROOT_DIR, 'build', 'test');

function findTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findTests(full);
    return entry.name.endsWith('.test.js') ? [full] : [];
  });
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
if (!runTsc(['-p', 'tsconfig.test.json'])) process.exit(1);

const balance = process.argv.includes('--balance');
const args = balance
  ? [path.join(OUT_DIR, 'tests', 'unit', 'tools', 'balance.js'), ...process.argv.slice(3)]
  : ['--test', ...findTests(path.join(OUT_DIR, 'tests', 'unit'))];
const result = spawnSync(process.execPath, args, { cwd: ROOT_DIR, stdio: 'inherit' });
process.exit(result.status ?? 1);
