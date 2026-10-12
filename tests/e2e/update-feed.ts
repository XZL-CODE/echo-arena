// 测试用的更新源：本机 HTTP 服务提供 latest.json 与更新包，用一把测试密钥按 Tauri 的 minisign 格式签名
// （minisign 文本再 base64 一层；ED 表示先对文件做 BLAKE2b-512 再签；可信注释里写进版本号）。
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestKey {
  /** 写给客户端的公钥（ECHO_ARENA_UPDATE_PUBKEY）。 */
  publicKey: string;
  sign(data: Buffer, o?: { file?: string; version?: string }): string;
}

export function createTestKey(): TestKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = crypto.randomBytes(8);
  const wrap = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  const idText = Buffer.from(keyId).reverse().toString('hex').toUpperCase();
  const pub = Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64');
  return {
    publicKey: wrap(`untrusted comment: minisign public key: ${idText}\n${pub}\n`),
    sign(data, { file = 'update.bin', version = '9.9.9' } = {}) {
      const hash = crypto.createHash('blake2b512').update(data).digest();
      const signature = crypto.sign(null, hash, privateKey);
      const now = Math.floor(Date.now() / 1000);
      const trusted = `timestamp:${now}\tfile:${file}\tversion:${version}`;
      const global = crypto.sign(
        null,
        Buffer.concat([signature, Buffer.from(trusted)]),
        privateKey,
      );
      const sig = Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64');
      return wrap(
        `untrusted comment: signature from tauri secret key\n${sig}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`,
      );
    },
  };
}

export interface Feed {
  /** 更新清单的地址（ECHO_ARENA_UPDATE_URL）。 */
  manifestUrl: string;
  /** 收到的请求路径（按顺序）。 */
  requests: string[];
  /** 发布一个新版本：清单指向 file，签名默认用 key 对 data 签。 */
  publish(o: {
    version: string;
    data: Buffer;
    file: string;
    notes?: string;
    signature?: string;
  }): void;
  close(): Promise<void>;
}

/** 正文格式与 CI 发布时一致：更新内容 + 安装说明。 */
export function releaseBody(version: string, items: string[]): string {
  return [
    `## v${version} 更新内容`,
    '',
    ...items.map((item) => `- ${item}`),
    '',
    '## 安装说明',
    '',
    'macOS 下载 .dmg；Windows 下载 -win-setup.exe。',
  ].join('\r\n');
}

export async function startFeed(key: TestKey): Promise<Feed> {
  const files = new Map<string, { type: string; body: Buffer }>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    requests.push(pathname);
    const file = files.get(pathname);
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': file.type, 'content-length': file.body.length });
    res.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    manifestUrl: `${base}/latest.json`,
    requests,
    publish(o) {
      const entry = {
        url: `${base}/download/${encodeURIComponent(o.file)}`,
        signature: o.signature ?? key.sign(o.data, { file: o.file, version: o.version }),
      };
      const manifest = {
        version: o.version,
        notes: o.notes ?? releaseBody(o.version, ['测试用的更新']),
        pub_date: '2026-10-12T08:00:00Z',
        platforms: Object.fromEntries(
          [
            'darwin-aarch64',
            'darwin-x86_64',
            'windows-x86_64',
            'linux-x86_64',
            'linux-aarch64',
          ].map((platform) => [platform, entry]),
        ),
      };
      files.set('/latest.json', {
        type: 'application/json',
        body: Buffer.from(JSON.stringify(manifest)),
      });
      files.set(`/download/${o.file}`, { type: 'application/octet-stream', body: o.data });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
