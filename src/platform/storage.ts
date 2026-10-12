// 存档读写的底层：在客户端里写入本机用户数据目录（经主进程）；
// 在普通浏览器里开发时退回 localStorage。客户端预加载脚本暴露的其余接口（窗口、更新）也在这里声明。

export interface UpdateInfo {
  version: string;
  /** 这个版本检查不检查更新（开发与测试时关掉）。 */
  enabled: boolean;
  /** 能否一键安装；不能时 reason 说明原因，界面改为打开下载页。 */
  auto: boolean;
  reason: string | null;
}

export interface UpdateFound {
  status: 'available';
  version: string;
  current: string;
  /** 发布时间（ISO 字符串）。 */
  date: string | null;
  /** 整理过的更新说明（Markdown 的子集）。 */
  notes: string;
}

export type UpdateCheckResult =
  { status: 'latest'; version: string } | UpdateFound | { status: 'error'; message: string };

export type UpdateInstallResult = { ok: true; dryRun?: boolean } | { ok: false; message: string };

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'installing';
  received?: number;
  total?: number;
}

/** 自动更新：主进程负责联网、核对签名与安装。 */
export interface UpdateBridge {
  info(): Promise<UpdateInfo>;
  check(): Promise<UpdateCheckResult>;
  install(): Promise<UpdateInstallResult>;
  openPage(): Promise<void>;
  onProgress(callback: (progress: UpdateProgress) => void): () => void;
}

export interface EchoArenaBridge {
  platform: string;
  save: {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
    writeSync(text: string): boolean;
    remove(): Promise<void>;
    info(): Promise<{ dir: string; file: string }>;
  };
  openDataDir(): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  quit(): Promise<void>;
  update: UpdateBridge;
}

declare global {
  interface Window {
    echoArena?: EchoArenaBridge;
  }
}

export interface SaveBackend {
  kind: 'file' | 'browser';
  /** 给玩家看的存档位置说明。 */
  location(): Promise<string>;
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  /** 窗口关闭前的同步写入（尽力而为）。 */
  writeNow(text: string): void;
  remove(): Promise<void>;
  /** 打开存档所在文件夹；浏览器里不可用。 */
  openFolder: (() => Promise<boolean>) | null;
}

const LOCAL_KEY = 'echo-arena-save';

export function bridge(): EchoArenaBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.echoArena;
}

export function createSaveBackend(): SaveBackend {
  const api = bridge();
  if (api) {
    return {
      kind: 'file',
      location: async () => (await api.save.info()).file,
      read: () => api.save.read(),
      write: (text) => api.save.write(text),
      writeNow: (text) => {
        api.save.writeSync(text);
      },
      remove: () => api.save.remove(),
      openFolder: () => api.openDataDir(),
    };
  }
  return {
    kind: 'browser',
    location: async () => '浏览器本地存储（localStorage）',
    read: async () => safeLocal(() => localStorage.getItem(LOCAL_KEY), null),
    write: async (text) => {
      safeLocal(() => localStorage.setItem(LOCAL_KEY, text), undefined);
    },
    writeNow: (text) => {
      safeLocal(() => localStorage.setItem(LOCAL_KEY, text), undefined);
    },
    remove: async () => {
      safeLocal(() => localStorage.removeItem(LOCAL_KEY), undefined);
    },
    openFolder: null,
  };
}

function safeLocal<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
