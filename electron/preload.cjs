// 预加载脚本：只向页面暴露存档与窗口相关的少量接口（上下文隔离 + 沙盒）。
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
});
