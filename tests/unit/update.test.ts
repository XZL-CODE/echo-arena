// 自动更新里的纯逻辑：BLAKE2b-512 与 minisign 签名核对、版本比较、清单解析、更新说明整理、
// 能否一键安装，以及自动检查的时机和存档里的更新设置。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  defaultSettings,
  emptySave,
  parseSave,
  serializeSave,
  updateCheckDue,
} from '../../src/core/run/save.js';

interface Verifier {
  trustedComment: string;
  update(chunk: Uint8Array): void;
  verify(): boolean;
}

interface Minisign {
  Blake2b512: new () => { update(data: Uint8Array): unknown; digest(): Buffer };
  createVerifier(publicKey: string, signature: string): Verifier;
  parsePublicKey(value: string): { keyId: Buffer };
  verifyData(publicKey: string, signature: string, data: Uint8Array): boolean;
}

interface Manifest {
  version: string;
  date: string | null;
  notes: string;
  url: string;
  signature: string;
}

interface UpdateCore {
  PUBLIC_KEY: string;
  FEED_URL: string;
  cleanNotes(body: string): string;
  compareVersions(a: string, b: string): number;
  installMode(o: {
    platform: string;
    packaged: boolean;
    where: string | null;
    writable: boolean;
  }): { auto: boolean; reason?: string };
  macBundlePath(exe: string): string | null;
  platformKey(platform: string, arch: string): string;
  readManifest(manifest: unknown, current: string, key: string): Manifest | null;
  signedVersion(trustedComment: string): string | null;
}

// 编译后位于 build/test/tests/unit，更新模块在仓库根目录的 electron/ 下。
const load = createRequire(import.meta.url);
const electronFile = (name: string) =>
  fileURLToPath(new URL(`../../../../electron/${name}`, import.meta.url));
const minisign = load(electronFile('minisign.cjs')) as Minisign;
const core = load(electronFile('update-core.cjs')) as UpdateCore;

/** 测试密钥：按 Tauri 的写法（minisign 文本再 base64 一层）给出公钥和签名。 */
function testKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = crypto.randomBytes(8);
  const wrap = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  return {
    publicKey: wrap(
      `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`,
    ),
    sign(data: Buffer, o: { prehash?: boolean; trusted?: string; forgeComment?: string } = {}) {
      const prehash = o.prehash ?? true;
      const message = prehash ? crypto.createHash('blake2b512').update(data).digest() : data;
      const signature = crypto.sign(null, message, privateKey);
      const trusted = o.trusted ?? 'timestamp:1760000000\tfile:test.bin\tversion:1.0.0';
      const global = crypto.sign(
        null,
        Buffer.concat([signature, Buffer.from(trusted)]),
        privateKey,
      );
      const sig = Buffer.concat([Buffer.from(prehash ? 'ED' : 'Ed'), keyId, signature]);
      return wrap(
        `untrusted comment: signature from tauri secret key\n${sig.toString('base64')}\n` +
          `trusted comment: ${o.forgeComment ?? trusted}\n${global.toString('base64')}\n`,
      );
    },
  };
}

test('BLAKE2b-512 与 OpenSSL 的结果一致（各种长度、任意切块）', () => {
  for (const n of [0, 1, 63, 127, 128, 129, 255, 256, 257, 1000, 4096, 65_537]) {
    const data = crypto.randomBytes(n);
    const want = crypto.createHash('blake2b512').update(data).digest('hex');
    const hash = new minisign.Blake2b512();
    for (let i = 0; i < n;) {
      const step = 1 + ((i * 7919) % 300);
      hash.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(hash.digest().toString('hex'), want, `长度 ${n}`);
  }
  // RFC 7693 附录 A 的例子
  const abc = new minisign.Blake2b512().update(Buffer.from('abc'));
  assert.match((abc as { digest(): Buffer }).digest().toString('hex'), /^ba80a53f981c4d0d6a27/);
});

test('minisign 签名：预哈希与旧式签名都能核对，内容、可信注释被改或换了密钥都不通过', () => {
  const key = testKey();
  const data = crypto.randomBytes(200_000);
  assert.equal(minisign.verifyData(key.publicKey, key.sign(data), data), true);
  assert.equal(minisign.verifyData(key.publicKey, key.sign(data, { prehash: false }), data), true);

  // 边下载边核对：分块喂入；可信注释里带着签名时写进的版本号
  const verifier = minisign.createVerifier(key.publicKey, key.sign(data));
  for (let i = 0; i < data.length; i += 4096) verifier.update(data.subarray(i, i + 4096));
  assert.equal(verifier.verify(), true);
  assert.equal(core.signedVersion(verifier.trustedComment), '1.0.0');

  const tampered = Buffer.from(data);
  tampered[1234] ^= 1;
  assert.equal(minisign.verifyData(key.publicKey, key.sign(data), tampered), false);
  assert.equal(
    minisign.verifyData(key.publicKey, key.sign(data, { forgeComment: 'file:other.bin' }), data),
    false,
  );
  assert.throws(
    () => minisign.verifyData(testKey().publicKey, key.sign(data), data),
    /不是客户端认的那一把/,
  );
  assert.throws(() => minisign.verifyData(key.publicKey, 'bm90IGEgc2lnbmF0dXJl', data));
});

test('客户端内置的公钥能解析，key id 与作者的密钥一致', () => {
  assert.equal(minisign.parsePublicKey(core.PUBLIC_KEY).keyId.toString('hex'), 'abf4d928f7343dae');
  assert.equal(
    core.FEED_URL,
    'https://github.com/XZL-CODE/echo-arena/releases/latest/download/latest.json',
  );
});

test('签名的可信注释里写进的版本号', () => {
  assert.equal(core.signedVersion('timestamp:1760000000\tfile:a.dmg\tversion:0.6.0'), '0.6.0');
  assert.equal(core.signedVersion('timestamp:1760000000\tfile:a.dmg'), null);
  assert.equal(core.signedVersion(''), null);
});

test('版本比较按语义化版本', () => {
  assert.ok(core.compareVersions('0.6.0', '0.5.1') > 0);
  assert.ok(core.compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(core.compareVersions('v1.2.3', '1.2.3') === 0);
  assert.ok(core.compareVersions('1.0.0', '1.0.0-beta.2') > 0);
  assert.ok(core.compareVersions('1.0.0-beta.10', '1.0.0-beta.2') > 0);
  assert.ok(core.compareVersions('1.0.0-beta', '1.0.0-1') > 0);
  assert.ok(core.compareVersions('0.5.1', '0.5.1-rc.1') > 0);
  assert.ok(core.compareVersions('坏版本', '0.0.1') < 0);
});

test('本机平台名与清单解析：只认更高版本，缺本机安装包或地址不对时报错', () => {
  assert.equal(core.platformKey('darwin', 'arm64'), 'darwin-aarch64');
  assert.equal(core.platformKey('darwin', 'x64'), 'darwin-x86_64');
  assert.equal(core.platformKey('win32', 'x64'), 'windows-x86_64');
  const entry = { url: 'https://example.com/a.exe', signature: 'sig' };
  const manifest = {
    version: '0.6.0',
    notes: '说明',
    pub_date: '2026-10-12T00:00:00Z',
    platforms: { 'windows-x86_64': entry },
  };
  assert.deepEqual(core.readManifest(manifest, '0.5.1', 'windows-x86_64'), {
    version: '0.6.0',
    date: '2026-10-12T00:00:00Z',
    notes: '说明',
    url: 'https://example.com/a.exe',
    signature: 'sig',
  });
  assert.equal(core.readManifest(manifest, '0.6.0', 'windows-x86_64'), null);
  assert.equal(core.readManifest(manifest, '0.7.0', 'windows-x86_64'), null);
  assert.throws(() => core.readManifest(manifest, '0.5.1', 'darwin-aarch64'), /没有适合这台电脑/);
  assert.throws(() => core.readManifest({ version: 'x' }, '0.5.1', 'windows-x86_64'), /格式不对/);
  assert.throws(() => core.readManifest(null, '0.5.1', 'windows-x86_64'), /格式不对/);
  const local = { ...manifest, platforms: { 'windows-x86_64': { ...entry, url: 'file:///C:/a' } } };
  assert.throws(() => core.readManifest(local, '0.5.1', 'windows-x86_64'), /下载地址不对/);
});

test('更新说明去掉开头的“更新内容”标题和“安装说明”一节（兼容 CRLF）', () => {
  const body =
    '## v0.6.0 更新内容\r\n\r\n- 新增自动更新\r\n- 修复闪光\r\n\r\n## 安装说明\r\n\r\n下载 dmg';
  assert.equal(core.cleanNotes(body), '- 新增自动更新\n- 修复闪光');
  assert.equal(core.cleanNotes('- 只有一条'), '- 只有一条');
  assert.equal(core.cleanNotes(''), '');
});

test('能否一键安装：macOS 要在可写的位置，Windows 免安装版和源码版只给下载页', () => {
  const mac = { platform: 'darwin', packaged: true, writable: true };
  assert.equal(core.installMode({ ...mac, where: '/Applications/回声竞技场.app' }).auto, true);
  assert.equal(
    core.installMode({ ...mac, where: '/Applications/回声竞技场.app', writable: false }).auto,
    false,
  );
  assert.match(
    core.installMode({ ...mac, where: '/private/var/folders/x/AppTranslocation/1/d/a.app' })
      .reason ?? '',
    /拖进“应用程序”/,
  );
  assert.equal(core.installMode({ ...mac, where: '/Volumes/回声竞技场/a.app' }).auto, false);
  const win = { platform: 'win32', packaged: true, writable: false };
  assert.equal(core.installMode({ ...win, where: null }).auto, true);
  assert.match(core.installMode({ ...win, where: 'D:\\EchoArena.exe' }).reason ?? '', /免安装版/);
  assert.match(core.installMode({ ...win, packaged: false, where: null }).reason ?? '', /源码/);
  assert.equal(
    core.installMode({ platform: 'linux', packaged: true, where: null, writable: true }).auto,
    false,
  );
  assert.equal(
    core.macBundlePath('/Applications/回声竞技场.app/Contents/MacOS/EchoArena'),
    '/Applications/回声竞技场.app',
  );
  assert.equal(core.macBundlePath('/usr/local/bin/electron'), null);
});

test('自动检查的时机：没查过、超过一天、时间被往回调、或上次发现的新版本还没装', () => {
  const now = Date.UTC(2026, 9, 12, 12);
  const hour = 3600_000;
  assert.equal(updateCheckDue(null, now), true);
  assert.equal(updateCheckDue({ at: now - 2 * hour, found: null }, now), false);
  assert.equal(updateCheckDue({ at: now - 25 * hour, found: null }, now), true);
  assert.equal(updateCheckDue({ at: now + hour, found: null }, now), true);
  assert.equal(updateCheckDue({ at: now - 2 * hour, found: '0.6.0' }, now), true);
});

test('存档里的更新设置：默认自动检查，往返保留，坏数据清理', () => {
  assert.equal(defaultSettings().autoUpdate, true);
  assert.equal(defaultSettings().updateCheck, null);
  const data = emptySave();
  data.settings.autoUpdate = false;
  data.settings.updateCheck = { at: 1_760_000_000_000, found: '0.6.0' };
  const back = parseSave(serializeSave(data));
  assert.equal(back?.settings.autoUpdate, false);
  assert.deepEqual(back?.settings.updateCheck, { at: 1_760_000_000_000, found: '0.6.0' });

  const raw = JSON.parse(serializeSave(emptySave()));
  raw.settings.autoUpdate = 'yes';
  raw.settings.updateCheck = { at: 'later', found: 3 };
  const cleaned = parseSave(JSON.stringify(raw));
  assert.equal(cleaned?.settings.autoUpdate, true);
  assert.equal(cleaned?.settings.updateCheck, null);
  raw.settings.updateCheck = { at: 5, found: '<script>' };
  assert.deepEqual(parseSave(JSON.stringify(raw))?.settings.updateCheck, { at: 5, found: null });
});
