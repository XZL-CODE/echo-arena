// 存档读写：原子写入（先写临时文件再替换），并保留上一版备份。主进程专用。
// 写入按调用顺序排队进行；换上新存档这一步同步完成并带序号，
// 已经有更新的写入落盘时，旧的直接丢弃，磁盘上留下的总是最新的一次。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_SAVE_BYTES = 2 * 1024 * 1024;
const RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows 上杀毒软件或索引服务可能短暂占用文件，rename 会报 EPERM/EBUSY。 */
function isBusy(error) {
  return !!error && (error.code === 'EPERM' || error.code === 'EBUSY');
}

function busyError() {
  return Object.assign(new Error('存档文件被占用'), { code: 'EBUSY' });
}

function createSaveStore(dataDir) {
  const savePath = path.join(dataDir, 'save.json');
  const backupPath = path.join(dataDir, 'save.backup.json');
  const tempPath = path.join(dataDir, 'save.json.tmp');
  const syncTempPath = path.join(dataDir, 'save.json.sync.tmp');
  /** 每次写入（或清除）的序号，以及已经生效的最新序号。 */
  let issued = 0;
  let committed = 0;
  /** 异步写入与清除排成一队：前一个完成（或失败）后才开始下一个。 */
  let queue = Promise.resolve();

  function validate(text) {
    if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES) {
      throw new Error('存档内容无效');
    }
    JSON.parse(text);
  }

  function enqueue(job) {
    const task = queue.then(job);
    queue = task.catch(() => {});
    return task;
  }

  /**
   * 备份当前存档并换上写好的临时文件。整步同步完成，中间插不进别的写入；
   * 已经有更新的写入生效时放弃这一次。文件被占用时返回 false，稍后重试。
   */
  function commit(temp, id) {
    if (id < committed) {
      fs.rmSync(temp, { force: true });
      return true;
    }
    try {
      if (fs.existsSync(savePath)) fs.copyFileSync(savePath, backupPath);
      fs.renameSync(temp, savePath);
    } catch (error) {
      if (isBusy(error)) return false;
      throw error;
    }
    committed = id;
    return true;
  }

  async function writeInOrder(text, id) {
    if (id < committed) return;
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(tempPath, text, 'utf8');
    for (let attempt = 0; !commit(tempPath, id); attempt++) {
      if (attempt >= RETRIES) throw busyError();
      await sleep(60 * (attempt + 1));
    }
  }

  async function removeInOrder(id) {
    if (id < committed) return;
    for (let attempt = 0; fs.existsSync(savePath); attempt++) {
      try {
        fs.renameSync(savePath, backupPath);
      } catch (error) {
        if (!isBusy(error) || attempt >= RETRIES) throw error;
        await sleep(60 * (attempt + 1));
      }
    }
    committed = Math.max(committed, id);
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
    write(text) {
      validate(text);
      const id = ++issued;
      return enqueue(() => writeInOrder(text, id));
    },
    /** 窗口关闭前的同步写入，保证最后一次改动不丢；排在它之前还没落盘的写入都会被丢弃。 */
    writeSync(text) {
      validate(text);
      const id = ++issued;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(syncTempPath, text, 'utf8');
      if (!commit(syncTempPath, id)) throw busyError();
    },
    /** 重置：把当前存档挪成备份，误操作时还能手动找回一次。排在之前的写入之后进行。 */
    remove() {
      const id = ++issued;
      return enqueue(() => removeInOrder(id));
    },
  };
}

module.exports = { createSaveStore };
