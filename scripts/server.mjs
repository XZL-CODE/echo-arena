// 本机服务：只监听 127.0.0.1，提供 dist 静态文件和存档接口。零第三方依赖。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ID, DEFAULT_PORT, DIST_DIR, resolveDataDir } from './paths.mjs';

const HOST = '127.0.0.1';
const MAX_SAVE_BYTES = 2 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0];
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME_TYPES['.json'] });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SAVE_BYTES) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function renameWithRetry(from, to) {
  // Windows 上杀毒软件或索引器短暂占用文件时，rename 可能报 EPERM/EBUSY。
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      const retryable = error && (error.code === 'EPERM' || error.code === 'EBUSY');
      if (!retryable || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
}

function createSaveStore(dataDir) {
  const savePath = path.join(dataDir, 'save.json');
  const backupPath = path.join(dataDir, 'save.backup.json');
  const tempPath = path.join(dataDir, 'save.json.tmp');

  return {
    dataDir,
    savePath,
    backupPath,
    async read() {
      try {
        return await fsp.readFile(savePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(text) {
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.writeFile(tempPath, text, 'utf8');
      if (fs.existsSync(savePath)) {
        await fsp.copyFile(savePath, backupPath);
      }
      await renameWithRetry(tempPath, savePath);
    },
    async remove() {
      // 重置时把当前存档挪成备份，误操作还能手动找回一次。
      if (fs.existsSync(savePath)) {
        await renameWithRetry(savePath, backupPath);
      }
    },
  };
}

async function serveStatic(req, res, rootDir) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let relative = decodeURIComponent(url.pathname);
  if (relative.endsWith('/')) relative += 'index.html';
  const filePath = path.resolve(rootDir, '.' + relative);
  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    send(res, 403, 'Forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') send(res, 404, 'Not found');
    else send(res, 500, 'Server error');
  }
}

async function handleSaveApi(req, res, store) {
  if (req.method === 'GET') {
    const text = await store.read();
    if (text === null) send(res, 204, '');
    else send(res, 200, text, { 'Content-Type': MIME_TYPES['.json'] });
    return;
  }

  // 写操作只接受同源 JSON 请求，避免其他网页改写本地存档。
  const origin = req.headers.origin;
  if (origin && hostnameOf(new URL(origin).host) !== hostnameOf(req.headers.host)) {
    send(res, 403, 'Forbidden');
    return;
  }

  if (req.method === 'PUT') {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, 'Expected JSON');
      return;
    }
    let text;
    try {
      text = await readBody(req);
      JSON.parse(text);
    } catch {
      send(res, 400, 'Invalid save');
      return;
    }
    await store.write(text);
    send(res, 204, '');
    return;
  }

  if (req.method === 'DELETE') {
    await store.remove();
    send(res, 204, '');
    return;
  }

  send(res, 405, 'Method not allowed');
}

export function createGameServer({ rootDir = DIST_DIR, dataDir = resolveDataDir() } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const store = createSaveStore(dataDir);

  const server = http.createServer(async (req, res) => {
    // 拒绝非本机主机名，防止 DNS 重绑定把本机服务暴露给外部网页。
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(req.headers.host))) {
      send(res, 403, 'Forbidden');
      return;
    }
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/api/health') {
        sendJson(res, 200, {
          app: APP_ID,
          storage: 'file',
          dataDir: store.dataDir,
          savePath: store.savePath,
        });
      } else if (pathname === '/api/save') {
        await handleSaveApi(req, res, store);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, resolvedRoot);
      } else {
        send(res, 405, 'Method not allowed');
      }
    } catch (error) {
      console.error('请求处理失败：', error);
      if (!res.headersSent) send(res, 500, 'Server error');
      else res.end();
    }
  });

  return { server, store };
}

/** 在指定端口监听；端口被占用时 reject（错误码 EADDRINUSE）。 */
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, root: DIST_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--root') options.root = path.resolve(argv[++i]);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArgs(process.argv.slice(2));
  const { server, store } = createGameServer({ rootDir: options.root });
  listen(server, options.port)
    .then((port) => {
      console.log(`回声竞技场本机服务：http://${HOST}:${port}/`);
      console.log(`存档文件：${store.savePath}`);
    })
    .catch((error) => {
      console.error(`无法监听端口 ${options.port}：${error.message}`);
      process.exit(1);
    });
}
