// 工程路径（构建、启动与测试脚本共用）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const SRC_DIR = path.join(ROOT_DIR, 'src');
export const BUILD_STAMP = path.join(DIST_DIR, '.build-stamp');

/** Electron 44 的安装工具要求的最低 Node.js 版本。 */
export const MIN_NODE = [22, 12];

/** 国内网络下载 Electron 失败时使用的镜像。 */
export const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
