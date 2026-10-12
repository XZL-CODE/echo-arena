// 自动更新里不依赖 Electron 的部分：版本比较、本机平台、清单解析、更新说明整理、能否一键安装，
// 以及发版脚本生成 Release 正文与更新清单的格式（两边的约定放在一处）。单元测试直接加载这个文件。

const REPO = 'XZL-CODE/echo-arena';
/** GitHub 的固定跳转：总是指向最新一个正式 Release 里的同名文件。 */
const FEED_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const DOWNLOAD_PAGE = `https://github.com/${REPO}/releases/latest`;
/**
 * 更新包签名的公钥（minisign 文本再 base64 一层，key id abf4d928f7343dae）。
 * 作者各应用共用这一套；对应的私钥只在仓库 Secret 和作者的密码管理器里。
 */
const PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFFM0QzNEY3MjhEOUY0QUIKUldTcjlOa285elE5cmxoTUk1RXl0TUNvalcvR1JZc0JtdWhaUVdqbW0zTUJlbDAxMGdYVEZhUTIK';

/** 解析语义化版本（可带 v 前缀）；不合法时返回 null。 */
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(text).trim(),
  );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** 比较两个版本：a 比 b 新返回正数，旧返回负数，相同返回 0。不合法的版本当作最旧。 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  }
  // 正式版比同号的预发布版新；预发布版逐段比较，数字段比文字段旧。
  if (!va.pre.length || !vb.pre.length) return vb.pre.length - va.pre.length;
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** 清单里的平台名（与 Tauri 的写法一致）。 */
function platformKey(platform, arch) {
  const os = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[platform] ?? platform;
  const cpu = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[arch] ?? arch;
  return `${os}-${cpu}`;
}

/**
 * 读更新清单：比自己新时返回这个版本的信息与本机的安装包，否则 null。
 * 清单不合法、或新版本没有本机的安装包时抛出给玩家看的错误。
 */
function readManifest(manifest, current, key) {
  if (!manifest || typeof manifest !== 'object' || !parseVersion(manifest.version)) {
    throw new Error('更新清单格式不对');
  }
  const version = String(manifest.version).replace(/^v/, '');
  if (compareVersions(version, current) <= 0) return null;
  const entry = manifest.platforms && manifest.platforms[key];
  if (!entry || typeof entry.url !== 'string' || typeof entry.signature !== 'string') {
    throw new Error(`新版本 v${version} 没有适合这台电脑的安装包`);
  }
  let url;
  try {
    url = new URL(entry.url);
  } catch {
    throw new Error('更新清单里的下载地址不对');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('更新清单里的下载地址不对');
  }
  return {
    version,
    date: typeof manifest.pub_date === 'string' ? manifest.pub_date : null,
    notes: typeof manifest.notes === 'string' ? manifest.notes : '',
    url: url.href,
    signature: entry.signature,
  };
}

/**
 * 签名的可信注释里写进的版本号（发版时 Tauri 签名器的 --app-version）；没有时返回 null。
 * 可信注释是“键:值”用制表符隔开，例如 timestamp:…\tfile:…\tversion:0.6.0。
 */
function signedVersion(trustedComment) {
  for (const field of String(trustedComment ?? '').split('\t')) {
    const colon = field.indexOf(':');
    if (colon > 0 && /version/i.test(field.slice(0, colon))) return field.slice(colon + 1).trim();
  }
  return null;
}

/**
 * 更新说明取 Release 正文：去掉开头的“## vX 更新内容”标题（和弹窗标题重复），
 * 以及“## 安装说明”和之后的内容（给手动下载的人看的）。Windows 上拼出的正文可能是 CRLF。
 */
function cleanNotes(body) {
  const lines = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n');
  if (/^#{1,6}\s.*更新内容/.test(lines[0] ?? '')) lines.shift();
  const cut = lines.findIndex((line) => /^#{1,6}\s*安装说明/.test(line));
  if (cut >= 0) lines.length = cut;
  return lines.join('\n').trim();
}

// ---- 发版：Release 正文与更新清单（scripts/release-update.mjs 生成，客户端读取） ----

/** 安装包文件名（与 package.json 的 build 配置一致）。 */
function installerNames(version) {
  return {
    mac: `EchoArena-${version}-mac-universal.dmg`,
    win: `EchoArena-${version}-win-setup.exe`,
  };
}

/**
 * 这一版的更新内容：合并进来的 PR 正文里“## 更新内容”一节；没有就用 GitHub 自动生成的 PR 列表
 * （“* 标题 by @作者 in 链接”只留标题）。
 */
function pickUpdateItems(prBody, generated) {
  const lines = String(prBody ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const start = lines.findIndex((line) => /^##\s*更新内容\s*$/.test(line.trim()));
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
    const section = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
    if (section) return section;
  }
  const items = String(generated ?? '')
    .split('\n')
    .map((line) => /^\*\s+(.+?)\s+by\s+@\S+\s+in\s+\S+$/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => `- ${match[1]}`);
  return items.length ? items.join('\n') : '- 改进与修复。';
}

/** Release 正文：更新内容在前（客户端弹窗显示这一段），安装说明在后。 */
function releaseBody({ version, tag, repo, items }) {
  return [
    `## v${version} 更新内容`,
    '',
    items,
    '',
    '## 安装说明',
    '',
    `macOS 下载 .dmg（Apple 芯片与 Intel 通用）；Windows 下载 -win-setup.exe（安装版）或 -win-portable.exe（免安装）。安装包未签名，首次打开的办法、操作与玩法见 [README](https://github.com/${repo}/blob/${tag}/README.md)。`,
    '',
    '游戏启动后会检查这里有没有新版本（只访问 GitHub，设置里可以关掉）；macOS 版和 Windows 安装版可以在游戏里一键更新。v0.5.1 及更早的版本没有这个功能，需要手动下载一次。',
    '',
  ].join('\n');
}

/** 更新清单：macOS 通用包同时登记两种芯片；Windows 登记安装版（免安装版不自动更新）。 */
function buildManifest({ version, tag, repo, notes, date, mac, win }) {
  const url = (file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
  const macEntry = { url: url(mac.file), signature: mac.signature };
  return {
    version,
    notes,
    pub_date: date,
    platforms: {
      'darwin-aarch64': macEntry,
      'darwin-x86_64': macEntry,
      'windows-x86_64': { url: url(win.file), signature: win.signature },
    },
  };
}

/** macOS：从可执行文件的路径找到所在的 .app 包。 */
function macBundlePath(exePath) {
  const match = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return match ? match[1] : null;
}

/**
 * 能不能一键安装；不能时给出原因（界面改为提示并打开下载页）。
 * where：macOS 上 .app 包的位置，Windows 上免安装版的文件路径（不是免安装版为 null）。
 */
function installMode({ platform, packaged, where, writable }) {
  if (!packaged)
    return { auto: false, reason: '从源码运行的版本请用 git 拉取新代码，或下载安装包。' };
  if (platform === 'darwin') {
    if (!where) return { auto: false, reason: '找不到应用所在的位置，请下载新版手动替换。' };
    if (where.includes('/AppTranslocation/') || where.startsWith('/Volumes/')) {
      return {
        auto: false,
        reason: '请先把回声竞技场拖进“应用程序”文件夹，从那里打开后再更新。',
      };
    }
    if (!writable) {
      return { auto: false, reason: '没有权限替换应用所在的文件夹，请下载新版手动替换。' };
    }
    return { auto: true };
  }
  if (platform === 'win32') {
    if (where) return { auto: false, reason: '免安装版不能自动替换，请下载新版。' };
    return { auto: true };
  }
  return { auto: false, reason: '这个系统没有一键更新，请到下载页获取新版。' };
}

module.exports = {
  DOWNLOAD_PAGE,
  FEED_URL,
  PUBLIC_KEY,
  buildManifest,
  cleanNotes,
  compareVersions,
  installMode,
  installerNames,
  macBundlePath,
  parseVersion,
  pickUpdateItems,
  platformKey,
  readManifest,
  releaseBody,
  signedVersion,
};
