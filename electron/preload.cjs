// 预加载脚本：只向页面暴露存档、窗口与更新相关的少量接口（上下文隔离 + 沙盒）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('echoArena', {
  platform: process.platform,
  save: {
    read: () => ipcRenderer.invoke('save:read'),
    write: (text) => ipcRenderer.invoke('save:write', text),
    writeSync: (text) => ipcRenderer.sendSync('save:write-sync', text),
    remove: () => ipcRenderer.invoke('save:remove'),
    info: () => ipcRenderer.invoke('save:info'),
  },
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('app:is-fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  update: {
    info: () => ipcRenderer.invoke('update:info'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    openPage: () => ipcRenderer.invoke('update:open-page'),
    /** 订阅下载与安装进度，返回取消订阅的函数。 */
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
  },
});
