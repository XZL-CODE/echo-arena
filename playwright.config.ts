// 端到端测试：直接启动桌面客户端（开发版或打包后的程序）。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/e2e',
  // CI 上另外输出 GitHub 注释：失败的测试连同错误信息显示在运行摘要里
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
});
