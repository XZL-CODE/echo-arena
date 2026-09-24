// 回声竞技场桌面客户端：主进程。负责窗口、本地资源协议与存档读写。
const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSaveStore } = require('./save-store.cjs');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEV = process.env.ECHO_ARENA_DEV === '1';

// 存档目录固定为 macOS ~/Library/Application Support/EchoArena、
// Windows %APPDATA%\EchoArena；测试时用 ECHO_ARENA_USER_DATA 指向临时目录。
const userDataDir = process.env.ECHO_ARENA_USER_DATA
  ? path.resolve(process.env.ECHO_ARENA_USER_DATA)
  : path.join(app.getPath('appData'), 'EchoArena');
app.setPath('userData', userDataDir);

// 用自定义协议加载游戏文件（比 file:// 更安全，也能正常使用 ES 模块）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function resolveAsset(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const filePath = path.normalize(path.join(DIST_DIR, relative));
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) return null;
  return filePath;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: '回声竞技场',
    backgroundColor: '#2b1d16',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 游戏页面之外的一切导航与新窗口都拒绝。
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });

  // 端到端测试时打开测试钩子（快进战斗等），正常运行不会带这个参数。
  const query = process.env.ECHO_ARENA_TEST === '1' ? '?test=1' : '';
  mainWindow.loadURL(`app://game/index.html${query}`);
  if (DEV) watchForReload(mainWindow);
}

/** 开发模式：dist 有变化就刷新页面。 */
function watchForReload(win) {
  let timer = null;
  try {
    fs.watch(DIST_DIR, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }, 150);
    });
  } catch (error) {
    console.warn('无法监听 dist 目录的变化：', error.message);
  }
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS 保留最基本的应用菜单：隐藏、全屏、退出（⌘Q）。
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about', label: '关于回声竞技场' },
          { type: 'separator' },
          { role: 'hide', label: '隐藏' },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: '退出回声竞技场' },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'togglefullscreen', label: '切换全屏' },
          ...(DEV ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
        ],
      },
    ]),
  );
}

function registerIpc(store) {
  ipcMain.handle('save:read', () => store.read());
  ipcMain.handle('save:write', (_event, text) => store.write(text));
  ipcMain.on('save:write-sync', (event, text) => {
    try {
      store.writeSync(text);
      event.returnValue = true;
    } catch (error) {
      console.error('关闭前保存失败：', error);
      event.returnValue = false;
    }
  });
  ipcMain.handle('save:remove', () => store.remove());
  ipcMain.handle('save:info', () => ({ dir: store.dataDir, file: store.savePath }));
  ipcMain.handle('app:open-data-dir', async () => {
    fs.mkdirSync(store.dataDir, { recursive: true });
    const error = await shell.openPath(store.dataDir);
    return error === '';
  });
  ipcMain.handle('app:toggle-fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('app:is-fullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));
  ipcMain.handle('app:quit', () => app.quit());
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const filePath = resolveAsset(request.url);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  registerIpc(createSaveStore(app.getPath('userData')));
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 这是单窗口游戏：关掉窗口就退出（包括 macOS）。
app.on('window-all-closed', () => app.quit());
