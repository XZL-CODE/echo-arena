// 发版时给更新包签名，生成更新清单 latest.json 与 Release 正文（CI 的“发布 Release”任务调用）：
//   node scripts/release-update.mjs --tag v0.6.0 --artifacts artifacts --notes notes
// notes 目录里放 pr.md（合并进来的 PR 正文）和 generated.md（GitHub 自动生成的说明），
// 脚本在这里写出 release.md；签名文件与 latest.json 写在 artifacts 目录。
//   node scripts/release-update.mjs --check-key
// 只用私钥签一个小文件，再用客户端内置的公钥核对：确认仓库 Secret 里的私钥和客户端对得上。
//
// 私钥与密码从环境变量 TAURI_SIGNING_PRIVATE_KEY、TAURI_SIGNING_PRIVATE_KEY_PASSWORD 读（仓库 Secret），
// 用 Tauri 的命令行工具签名（作者各应用共用同一套密钥与格式）。签完都用客户端的公钥再核对一遍。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT_DIR } from './paths.mjs';

const require = createRequire(import.meta.url);
const { parsePublicKey, parseSignature, verifyData } = require('../electron/minisign.cjs');
const core = require('../electron/update-core.cjs');

const TAURI_CLI = '@tauri-apps/cli@2.11.5';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

/**
 * 签名并核对，返回签名（minisign 文本再 base64 一层，与 .sig 文件内容相同）。
 * version：写进签名的可信注释，防止清单被改成用旧安装包冒充新版本。
 */
function sign(file, version) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY || !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    fail(
      '缺少更新包的签名密钥：在仓库 Settings → Secrets and variables → Actions 里添加 ' +
        'TAURI_SIGNING_PRIVATE_KEY 与 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。',
    );
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // 不接标准输入：密码不对时直接报错，不会停在交互提示上
  const args = ['--yes', TAURI_CLI, 'signer', 'sign', '--app-version', version, file];
  const result = spawnSync(npx, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) fail(`给 ${path.basename(file)} 签名失败。`);
  const signature = fs.readFileSync(`${file}.sig`, 'utf8').trim();
  let ok = false;
  try {
    ok = verifyData(core.PUBLIC_KEY, signature, fs.readFileSync(file));
  } catch (error) {
    fail(`${path.basename(file)} 的签名核对出错：${error.message}`);
  }
  if (!ok) fail(`${path.basename(file)} 的签名用客户端内置的公钥核对不通过。`);
  return signature;
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function checkKey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-arena-key-'));
  const file = path.join(dir, 'check.txt');
  fs.writeFileSync(file, `echo-arena update key check ${new Date().toISOString()}\n`);
  const signature = sign(file, '0.0.0');
  fs.rmSync(dir, { recursive: true, force: true });
  const keyId = parsePublicKey(core.PUBLIC_KEY).keyId.toString('hex');
  console.log(`签名密钥与客户端内置的公钥是一对（key id ${keyId}）。`);
  console.log(`可信注释：${JSON.stringify(parseSignature(signature).trustedComment)}`);
}

function release({ tag, artifacts, notes }) {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  if (tag !== `v${version}`) {
    fail(
      `要发布的 ${tag} 和 package.json 的版本 ${version} 不一致：客户端按清单里的版本判断要不要更新，` +
        '装上的程序却还是原来的版本，会一直提示更新。先改 package.json 再发布。',
    );
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) fail('缺少 GITHUB_REPOSITORY。');
  const names = core.installerNames(version);
  for (const name of Object.values(names)) {
    if (!fs.existsSync(path.join(artifacts, name))) fail(`找不到安装包 ${name}。`);
  }
  const mac = { file: names.mac, signature: sign(path.join(artifacts, names.mac), version) };
  const win = { file: names.win, signature: sign(path.join(artifacts, names.win), version) };

  const items = core.pickUpdateItems(
    readText(path.join(notes, 'pr.md')),
    readText(path.join(notes, 'generated.md')),
  );
  const body = core.releaseBody({ version, tag, repo, items });
  fs.writeFileSync(path.join(notes, 'release.md'), body);
  const manifest = core.buildManifest({
    version,
    tag,
    repo,
    notes: body,
    date: new Date().toISOString(),
    mac,
    win,
  });
  fs.writeFileSync(path.join(artifacts, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已生成 latest.json（v${version}）与 Release 正文：\n\n${body}`);
}

const { values } = parseArgs({
  options: {
    'check-key': { type: 'boolean' },
    tag: { type: 'string' },
    artifacts: { type: 'string' },
    notes: { type: 'string' },
  },
});

if (values['check-key']) {
  checkKey();
} else {
  if (!values.tag || !values.artifacts || !values.notes) {
    fail('用法：node scripts/release-update.mjs --tag vX.Y.Z --artifacts <目录> --notes <目录>');
  }
  release({ tag: values.tag, artifacts: values.artifacts, notes: values.notes });
}
