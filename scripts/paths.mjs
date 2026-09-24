// 工程路径与存档目录（启动脚本、本机服务和测试共用）。
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const SRC_DIR = path.join(ROOT_DIR, 'src');
export const BUILD_STAMP = path.join(DIST_DIR, '.build-stamp');

export const APP_ID = 'echo-arena';
export const DEFAULT_PORT = 5188;
export const PORT_ATTEMPTS = 10;

/**
 * 存档目录：macOS 放在 Application Support，Windows 放在 %APPDATA%，
 * 其他系统遵循 XDG。设置 ECHO_ARENA_DATA_DIR 可覆盖（测试时使用）。
 */
export function resolveDataDir(
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
) {
  if (env.ECHO_ARENA_DATA_DIR) return path.resolve(env.ECHO_ARENA_DATA_DIR);
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'EchoArena');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'EchoArena');
  }
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(dataHome, 'echo-arena');
}
