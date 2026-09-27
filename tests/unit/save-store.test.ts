// 存档文件的写入顺序：写入重叠、关闭前的同步写入、清除存档时，磁盘上留下的总是最新的一次。
// 用放慢第一次写临时文件的办法，稳定地造出慢磁盘上才会碰到的先后顺序。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

interface SaveStore {
  savePath: string;
  backupPath: string;
  write(text: string): Promise<void>;
  writeSync(text: string): void;
  remove(): Promise<void>;
}

// 编译后位于 build/test/tests/unit，存档模块在仓库根目录的 electron/ 下。
const storeFile = fileURLToPath(new URL('../../../../electron/save-store.cjs', import.meta.url));
const { createSaveStore } = createRequire(import.meta.url)(storeFile) as {
  createSaveStore(dir: string): SaveStore;
};

const realWriteFile = fsp.writeFile;
const patched = fsp as { writeFile: typeof fsp.writeFile };

/** 让接下来第一次写临时文件慢 ms 毫秒。 */
function slowFirstWrite(ms: number): void {
  let calls = 0;
  patched.writeFile = (async (...args: Parameters<typeof fsp.writeFile>) => {
    if (++calls === 1) await new Promise((resolve) => setTimeout(resolve, ms));
    return realWriteFile(...args);
  }) as typeof fsp.writeFile;
}

afterEach(() => {
  patched.writeFile = realWriteFile;
});

function freshStore(): SaveStore {
  return createSaveStore(fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-store-')));
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as { v: string };

test('两次写入重叠时按调用顺序落盘，后写的留在存档里', async () => {
  const store = freshStore();
  slowFirstWrite(50);
  await Promise.all([
    store.write(JSON.stringify({ v: 'older' })),
    store.write(JSON.stringify({ v: 'newer' })),
  ]);
  assert.equal(readJson(store.savePath).v, 'newer');
  assert.equal(readJson(store.backupPath).v, 'older');
});

test('关闭前的同步写入不会被之前还没落盘的写入盖掉', async () => {
  const store = freshStore();
  slowFirstWrite(50);
  const pending = store.write(JSON.stringify({ v: 'older' }));
  store.writeSync(JSON.stringify({ v: 'newest' }));
  await pending;
  assert.equal(readJson(store.savePath).v, 'newest');
});

test('清除存档排在之前的写入之后，之后的写入照常生效', async () => {
  const store = freshStore();
  await store.write(JSON.stringify({ v: 'first' }));
  slowFirstWrite(50);
  const pending = store.write(JSON.stringify({ v: 'second' }));
  await store.remove();
  await pending;
  assert.equal(fs.existsSync(store.savePath), false);
  assert.equal(readJson(store.backupPath).v, 'second');
  await store.write(JSON.stringify({ v: 'after-reset' }));
  assert.equal(readJson(store.savePath).v, 'after-reset');
});
