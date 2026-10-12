// 自动更新：本机起一个假的更新源（测试密钥签名），走一遍发现新版本、看更新说明、下载并核对签名，
// 签名对不上时不安装，以及“每天最多自动查一次”和设置里的手动检查、开关。
// 这里都用测试模式（下载并核对签名后不安装）；真正替换安装见 update-install.spec.ts。
import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { launchClient, readSave, ready, screenshotPath } from './client';
import { createTestKey, releaseBody, startFeed, type Feed } from './update-feed';

const key = createTestKey();
let feed: Feed;

test.beforeEach(async () => {
  feed = await startFeed(key);
});

test.afterEach(async () => {
  await feed.close();
});

function updateEnv(): Record<string, string> {
  return {
    ECHO_ARENA_UPDATE_URL: feed.manifestUrl,
    ECHO_ARENA_UPDATE_PUBKEY: key.publicKey,
    ECHO_ARENA_UPDATE_DRY_RUN: '1',
  };
}

test('发现新版本：标题页出现按钮，弹窗里看更新说明，下载并核对签名', async () => {
  const data = crypto.randomBytes(3 * 1024 * 1024);
  feed.publish({
    version: '9.9.9',
    data,
    file: 'EchoArena-9.9.9-test.bin',
    notes: releaseBody('9.9.9', ['新增：**自动更新**', '修复：[闪光](https://example.com)太频繁']),
  });
  const { app, page, userData } = await launchClient({ env: updateEnv() });
  const errors = await ready(page);

  // 启动几秒后在后台检查，标题页右上角出现按钮（不弹窗打断）
  const badge = page.locator('[data-testid=update-badge]');
  await expect(badge).toHaveText('新版本 v9.9.9', { timeout: 30_000 });
  await expect(page.locator('[data-testid=update-dialog]')).toHaveCount(0);
  await badge.click();

  const dialog = page.locator('[data-testid=update-dialog]');
  await expect(dialog).toContainText('发现新版本 v9.9.9');
  await expect(dialog).toContainText('发布于 2026-10-12');
  // 更新说明去掉了与标题重复的“更新内容”标题和给手动下载的人看的“安装说明”，Markdown 标记只留文字
  const notes = page.locator('[data-testid=update-notes] li');
  await expect(notes).toHaveText(['新增：自动更新', '修复：闪光太频繁']);
  await expect(dialog).not.toContainText('安装说明');
  await expect(dialog).not.toContainText('更新内容');
  await page.screenshot({ path: screenshotPath('update-dialog'), animations: 'disabled' });

  await page.click('[data-testid=update-install]');
  await expect(page.locator('[data-testid=update-verified]')).toBeVisible({ timeout: 60_000 });
  expect(feed.requests).toContain('/download/EchoArena-9.9.9-test.bin');
  await page.click('[data-testid=update-done]');
  await expect(dialog).toHaveCount(0);

  // 设置里显示检查结果，也能从这里再打开弹窗
  await page.click('[data-testid=settings]');
  await expect(page.locator('[data-testid=update-result]')).toHaveText('发现新版本 v9.9.9。');
  await expect(page.locator('[data-testid=update-version]')).toContainText('当前版本 v');
  await page.screenshot({ path: screenshotPath('update-settings'), animations: 'disabled' });
  await page.click('[data-testid=update-open]');
  await expect(dialog).toBeVisible();
  await page.click('[data-testid=update-later]');
  await expect(page.locator('[data-testid=settings-dialog]')).toBeVisible();

  await app.close();
  expect(errors).toEqual([]);
  expect(readSave(userData)?.settings.updateCheck).toMatchObject({ found: '9.9.9' });
});

test('签名对不上的更新包不安装，可以重试', async () => {
  const data = crypto.randomBytes(1024 * 1024);
  // 签名是对另一份内容做的：模拟 Release 里的文件被换掉
  feed.publish({
    version: '9.9.9',
    data,
    file: 'EchoArena-9.9.9-test.bin',
    signature: key.sign(crypto.randomBytes(1024 * 1024)),
  });
  const { app, page } = await launchClient({ env: updateEnv() });
  const errors = await ready(page);
  await page.click('[data-testid=update-badge]', { timeout: 30_000 });
  await page.click('[data-testid=update-install]');
  await expect(page.locator('[data-testid=update-error]')).toContainText('签名核对没通过', {
    timeout: 60_000,
  });
  await expect(page.locator('[data-testid=update-install]')).toHaveText('重试');
  await expect(page.locator('[data-testid=update-install]')).toBeEnabled();
  await page.screenshot({ path: screenshotPath('update-bad-signature'), animations: 'disabled' });
  await app.close();
  expect(errors).toEqual([]);
});

test('签名里的版本号和清单不一致时不安装（防止用旧版本的安装包冒充新版本）', async () => {
  const data = crypto.randomBytes(1024 * 1024);
  const file = 'EchoArena-9.9.9-test.bin';
  feed.publish({
    version: '9.9.9',
    data,
    file,
    signature: key.sign(data, { file, version: '9.9.8' }),
  });
  const { app, page } = await launchClient({ env: updateEnv() });
  const errors = await ready(page);
  await page.click('[data-testid=update-badge]', { timeout: 30_000 });
  await page.click('[data-testid=update-install]');
  await expect(page.locator('[data-testid=update-error]')).toContainText('版本号', {
    timeout: 60_000,
  });
  await app.close();
  expect(errors).toEqual([]);
});

test('已是最新时不提示；一天内不再自动检查；设置里可以手动检查和关掉自动检查', async () => {
  feed.publish({ version: '0.0.1', data: Buffer.from('old'), file: 'old.bin' });
  const first = await launchClient({ env: updateEnv() });
  const errors = await ready(first.page);
  await expect.poll(() => feed.requests.length, { timeout: 30_000 }).toBe(1);
  await first.page.click('[data-testid=settings]');
  await expect(first.page.locator('[data-testid=update-result]')).toHaveText('已是最新版本。');
  await expect(first.page.locator('[data-testid=update-badge]')).toHaveCount(0);
  await first.app.close();
  expect(errors).toEqual([]);
  expect(readSave(first.userData)?.settings.updateCheck).toMatchObject({ found: null });

  // 重新打开：上次检查不到一天、也没有待装的新版本，不再自动检查
  const second = await launchClient({ env: updateEnv(), userData: first.userData });
  await ready(second.page);
  await second.page.waitForTimeout(8000);
  expect(feed.requests.length).toBe(1);
  await second.page.click('[data-testid=settings]');
  await expect(second.page.locator('[data-testid=update-result]')).toContainText('上次检查：');
  await second.page.click('[data-testid=update-check]');
  await expect(second.page.locator('[data-testid=update-result]')).toHaveText('已是最新版本。');
  expect(feed.requests.length).toBe(2);
  await second.page.locator('[data-testid=update-settings] .toggle').click();
  await second.app.close();
  expect(readSave(first.userData)?.settings.autoUpdate).toBe(false);
});
