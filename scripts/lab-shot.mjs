// 开发用：打开造型样张页并截图。
// 用法：xvfb-run -a node scripts/lab-shot.mjs <输出目录> "名字:查询参数" ["名字:查询参数" ...]
// 例如：node scripts/lab-shot.mjs /tmp/shots "fox:ids=fox-1,fox-2,fox-3&yaw=0.5"
// 可选环境变量 LAB_SIZE=宽x高（默认 1280x800）。
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './paths.mjs';

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) {
  console.error('用法：node scripts/lab-shot.mjs <输出目录> "名字:查询参数" ...');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const [width, height] = (process.env.LAB_SIZE ?? '1280x800').split('x').map(Number);

const env = { ...process.env, ECHO_ARENA_LAB: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [ROOT_DIR], env });
const page = await app.firstWindow();
await app.evaluate(
  ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(200, 200);
    win.setContentSize(size.width, size.height);
  },
  { width, height },
);
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('页面错误：', msg.text());
  else if (msg.text().startsWith('[lab]')) console.log(msg.text());
});
page.on('pageerror', (error) => console.error('脚本错误：', error.message));

for (const spec of specs) {
  const i = spec.indexOf(':');
  const name = spec.slice(0, i);
  const query = spec.slice(i + 1);
  await page.goto(`app://game/lab.html?${query}`);
  const ok = await page
    .waitForFunction(() => window.__labReady || window.__labError, null, { timeout: 60_000 })
    .then(() => page.evaluate(() => window.__labError ?? null));
  if (ok) {
    console.error(`${name}: ${ok}`);
    continue;
  }
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await app.close();
