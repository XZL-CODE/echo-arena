// 更新包签名核对：minisign 格式（Ed25519），也就是 Tauri 的签名器产出的格式。
// Tauri 的公钥和 .sig 都是“minisign 文本再 base64 一层”，这里两种写法都认。
// Electron 用的 BoringSSL 没有 BLAKE2b-512（预哈希签名要用），所以下面用纯 JS 实现。
const crypto = require('node:crypto');

// ---- BLAKE2b-512（RFC 7693）----
// 64 位字拆成低、高两个 32 位整数存在 Int32Array 里（下标 2i 为低位，2i+1 为高位）。
// 全程用 32 位整数运算（进位用位运算算出），比混用浮点数快三倍多：一个 200 MB 的安装包约 4 秒，
// 而且是边下载边算的。

const IV = new Int32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

const SIGMA_ROWS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

/** 12 轮的消息字排列（第 11、12 轮重复第 1、2 轮），已换算成 Int32Array 里的下标。 */
const SIGMA = new Uint8Array(12 * 16);
for (let r = 0; r < 12; r++) {
  for (let i = 0; i < 16; i++) SIGMA[r * 16 + i] = SIGMA_ROWS[r % 10][i] * 2;
}

/** 32 位加法 x + y = sum 的进位（0 或 1）。 */
function carry(x, y, sum) {
  return ((x & y) | ((x | y) & ~sum)) >>> 31;
}

/** 混合函数 G：a、b、c、d 是 v 里的下标，x、y 是消息字 m 里的下标。 */
function mix(v, m, a, b, c, d, x, y) {
  let al = v[a];
  let ah = v[a + 1];
  let bl = v[b];
  let bh = v[b + 1];
  let cl = v[c];
  let ch = v[c + 1];
  let lo;
  let ml;
  // a = a + b + m[x]
  lo = (al + bl) | 0;
  ah = (ah + bh + carry(al, bl, lo)) | 0;
  al = lo;
  ml = m[x];
  lo = (al + ml) | 0;
  ah = (ah + m[x + 1] + carry(al, ml, lo)) | 0;
  al = lo;
  // d = (d ^ a) >>> 32
  let dl = v[d + 1] ^ ah;
  let dh = v[d] ^ al;
  // c = c + d
  lo = (cl + dl) | 0;
  ch = (ch + dh + carry(cl, dl, lo)) | 0;
  cl = lo;
  // b = (b ^ c) >>> 24
  let xl = bl ^ cl;
  let xh = bh ^ ch;
  bl = (xl >>> 24) | (xh << 8);
  bh = (xh >>> 24) | (xl << 8);
  // a = a + b + m[y]
  lo = (al + bl) | 0;
  ah = (ah + bh + carry(al, bl, lo)) | 0;
  al = lo;
  ml = m[y];
  lo = (al + ml) | 0;
  ah = (ah + m[y + 1] + carry(al, ml, lo)) | 0;
  al = lo;
  // d = (d ^ a) >>> 16
  xl = dl ^ al;
  xh = dh ^ ah;
  dl = (xl >>> 16) | (xh << 16);
  dh = (xh >>> 16) | (xl << 16);
  // c = c + d
  lo = (cl + dl) | 0;
  ch = (ch + dh + carry(cl, dl, lo)) | 0;
  cl = lo;
  // b = (b ^ c) >>> 63，即左移 1 位
  xl = bl ^ cl;
  xh = bh ^ ch;
  bl = (xh >>> 31) | (xl << 1);
  bh = (xl >>> 31) | (xh << 1);
  v[a] = al;
  v[a + 1] = ah;
  v[b] = bl;
  v[b + 1] = bh;
  v[c] = cl;
  v[c + 1] = ch;
  v[d] = dl;
  v[d + 1] = dh;
}

class Blake2b512 {
  constructor() {
    this.h = new Int32Array(IV);
    // 参数块：输出 64 字节、无密钥、扇出与深度为 1。
    this.h[0] ^= 0x01010040;
    this.block = new Uint8Array(128);
    // 消息字直接按小端读这一块（客户端只跑在 x64 与 Apple 芯片上，都是小端）。
    this.m = new Int32Array(this.block.buffer);
    this.v = new Int32Array(32);
    this.filled = 0;
    /** 已压缩的字节数（计数器的高 64 位一直是 0，够用到 2^53 字节）。 */
    this.count = 0;
    this.done = false;
  }

  compress(last) {
    const { v, m, h } = this;
    v.set(h, 0);
    v.set(IV, 16);
    v[24] ^= this.count | 0;
    v[25] ^= (this.count / 0x100000000) | 0;
    if (last) {
      v[28] = ~v[28];
      v[29] = ~v[29];
    }
    for (let r = 0; r < 12; r++) {
      const s = r * 16;
      mix(v, m, 0, 8, 16, 24, SIGMA[s], SIGMA[s + 1]);
      mix(v, m, 2, 10, 18, 26, SIGMA[s + 2], SIGMA[s + 3]);
      mix(v, m, 4, 12, 20, 28, SIGMA[s + 4], SIGMA[s + 5]);
      mix(v, m, 6, 14, 22, 30, SIGMA[s + 6], SIGMA[s + 7]);
      mix(v, m, 0, 10, 20, 30, SIGMA[s + 8], SIGMA[s + 9]);
      mix(v, m, 2, 12, 22, 24, SIGMA[s + 10], SIGMA[s + 11]);
      mix(v, m, 4, 14, 16, 26, SIGMA[s + 12], SIGMA[s + 13]);
      mix(v, m, 6, 8, 18, 28, SIGMA[s + 14], SIGMA[s + 15]);
    }
    for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16];
  }

  update(data) {
    if (this.done) throw new Error('hash already finished');
    for (let i = 0; i < data.length;) {
      // 块满了、后面还有数据时才压缩：最后一块要留到 digest() 带上结束标记。
      if (this.filled === 128) {
        this.count += 128;
        this.compress(false);
        this.filled = 0;
      }
      const take = Math.min(128 - this.filled, data.length - i);
      this.block.set(data.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
    }
    return this;
  }

  digest() {
    this.done = true;
    this.count += this.filled;
    this.block.fill(0, this.filled);
    this.compress(true);
    const out = Buffer.alloc(64);
    for (let i = 0; i < 16; i++) out.writeInt32LE(this.h[i], i * 4);
    return out;
  }
}

// ---- minisign ----

/** Ed25519 公钥的 DER（SPKI）前缀，后面接 32 字节原始公钥。 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** 取 minisign 文本的非空行；Tauri 的写法是整段再 base64 一层，先解开。 */
function minisignLines(value) {
  let text = String(value).trim();
  if (!text.startsWith('untrusted comment:')) {
    text = Buffer.from(text, 'base64').toString('utf8');
  }
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines[0] || !lines[0].startsWith('untrusted comment:')) {
    throw new Error('不是 minisign 格式');
  }
  return lines;
}

/** 解析公钥：返回 key id（8 字节）与 Node 的公钥对象。 */
function parsePublicKey(value) {
  const raw = Buffer.from(minisignLines(value)[1] || '', 'base64');
  if (raw.length !== 42 || raw.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error('公钥格式不对');
  }
  return {
    keyId: raw.subarray(2, 10),
    key: crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10, 42)]),
      format: 'der',
      type: 'spki',
    }),
  };
}

/** 解析签名：算法（ED 为预哈希）、key id、对文件的签名、可信注释与全局签名。 */
function parseSignature(value) {
  const lines = minisignLines(value);
  const raw = Buffer.from(lines[1] || '', 'base64');
  const trusted = lines[2] || '';
  if (raw.length !== 74 || !trusted.startsWith('trusted comment: ') || !lines[3]) {
    throw new Error('签名格式不对');
  }
  const algorithm = raw.toString('latin1', 0, 2);
  if (algorithm !== 'ED' && algorithm !== 'Ed') throw new Error('不支持的签名算法');
  return {
    prehashed: algorithm === 'ED',
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10, 74),
    trustedComment: trusted.slice('trusted comment: '.length),
    globalSignature: Buffer.from(lines[3], 'base64'),
  };
}

/**
 * 边收数据边核对：update() 喂文件内容，verify() 在收完后核对两层签名。
 * 签名与公钥对不上（key id 不同）时在创建时就报错。
 */
function createVerifier(publicKey, signature) {
  const pub = parsePublicKey(publicKey);
  const sig = parseSignature(signature);
  if (!pub.keyId.equals(sig.keyId)) {
    throw new Error(`签名用的密钥（${sig.keyId.toString('hex')}）不是客户端认的那一把`);
  }
  const hash = sig.prehashed ? new Blake2b512() : null;
  const chunks = [];
  return {
    update(chunk) {
      if (hash) hash.update(chunk);
      else chunks.push(Buffer.from(chunk));
    },
    verify() {
      const message = hash ? hash.digest() : Buffer.concat(chunks);
      if (!crypto.verify(null, message, pub.key, sig.signature)) return false;
      const signed = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
      return crypto.verify(null, signed, pub.key, sig.globalSignature);
    },
  };
}

/** 一次性核对一段数据（测试与发布脚本用）。 */
function verifyData(publicKey, signature, data) {
  const verifier = createVerifier(publicKey, signature);
  verifier.update(data);
  return verifier.verify();
}

module.exports = {
  Blake2b512,
  createVerifier,
  parsePublicKey,
  parseSignature,
  verifyData,
};
