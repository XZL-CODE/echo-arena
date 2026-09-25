// 存档读写：原子写入（先写临时文件再替换），并保留上一版备份。主进程专用。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_SAVE_BYTES = 2 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSaveStore(dataDir) {
  const savePath = path.join(dataDir, 'save.json');
  const backupPath = path.join(dataDir, 'save.backup.json');
  const tempPath = path.join(dataDir, 'save.json.tmp');

  function validate(text) {
    if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES) {
      throw new Error('存档内容无效');
    }
    JSON.parse(text);
  }

  async function renameWithRetry(from, to) {
    // Windows 上杀毒软件或索引服务可能短暂占用文件，rename 会报 EPERM/EBUSY。
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(from, to);
        return;
      } catch (error) {
        const retryable = error && (error.code === 'EPERM' || error.code === 'EBUSY');
        if (!retryable || attempt >= 4) throw error;
        await sleep(60 * (attempt + 1));
      }
    }
  }

  return {
    dataDir,
    savePath,
    backupPath,
    async read() {
      try {
        return await fsp.readFile(savePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(text) {
      validate(text);
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.writeFile(tempPath, text, 'utf8');
      if (fs.existsSync(savePath)) await fsp.copyFile(savePath, backupPath);
      await renameWithRetry(tempPath, savePath);
    },
    /** 窗口关闭前的同步写入，保证最后一次改动不丢。 */
    writeSync(text) {
      validate(text);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(tempPath, text, 'utf8');
      if (fs.existsSync(savePath)) fs.copyFileSync(savePath, backupPath);
      fs.renameSync(tempPath, savePath);
    },
    /** 重置：把当前存档挪成备份，误操作时还能手动找回一次。 */
    async remove() {
      if (fs.existsSync(savePath)) await renameWithRetry(savePath, backupPath);
    },
  };
}

module.exports = { createSaveStore };
