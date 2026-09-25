// 配色：书桌上的迷你台球桌。队伍区分同时依靠色相（暖黄/天青 vs 梅紫/珊瑚）、底座形状与血条样式。

export const PALETTE = {
  desk: '#2b1d16',
  deskLight: '#3d2a1f',
  railDark: '#5a3620',
  rail: '#8a5a35',
  railLight: '#b07a4c',
  cushion: '#2c6450',
  felt: '#2f6d58',
  feltDark: '#1f4c3e',
  feltLight: '#3d8069',
  chalk: 'rgba(255, 248, 230, 0.28)',
  outline: '#241a1f',
  shadow: 'rgba(8, 12, 10, 0.34)',
  allyBase: '#f6ead3',
  enemyBase: '#3b1f34',
  allyHp: '#5ad1e6',
  enemyHp: '#ff7a68',
  hpBack: 'rgba(20, 14, 16, 0.72)',
  focus: '#ffd166',
  text: '#fff8ea',
  arrow: '#e9844f',
  enemyShot: '#ff8a5c',
  allyShot: '#fff1b8',
  heal: '#ffc2d4',
  taunt: '#ff6b5a',
  magnet: '#9ad8ff',
} as const;

/** 回响等级配色：等级越高越暖越亮。 */
export const ECHO_COLORS = [
  '#fff1b8',
  '#7ee8fa',
  '#72f2c8',
  '#ffe066',
  '#ffae42',
  '#ff6fb5',
  '#c77dff',
  '#ffffff',
] as const;

export function echoColor(level: number): string {
  return ECHO_COLORS[Math.max(0, Math.min(ECHO_COLORS.length - 1, level))] as string;
}
