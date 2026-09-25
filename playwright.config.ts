// 端到端测试：直接启动桌面客户端（开发版或打包后的程序）。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/e2e',
  reporter: [['list']],
});
