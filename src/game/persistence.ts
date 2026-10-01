// 存档管理：内存中保存完整存档，改动后延迟合并写入；关闭窗口前同步落盘。
import {
  emptySave,
  parseSave,
  SAVE_VERSION,
  serializeSave,
  type SaveData,
} from '../core/run/save.js';
import { createSaveBackend, type SaveBackend } from '../platform/storage.js';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export class Persistence {
  readonly backend: SaveBackend;
  data: SaveData = emptySave();
  /** 读取时存档损坏或不可识别。 */
  recovered = false;
  /** 旧版本（玩具小队玩法）存档里有进行中的一轮，新玩法无法沿用，读入时丢弃了。 */
  droppedOldRun = false;
  status: SaveStatus = 'idle';
  onStatus: ((status: SaveStatus) => void) | null = null;
  private timer: number | null = null;
  private dirty = false;
  /** 已经发出、还没确认写完的异步写入数（关闭窗口可能把它们打断）。 */
  private writing = 0;

  constructor(backend: SaveBackend = createSaveBackend()) {
    this.backend = backend;
  }

  async load(): Promise<SaveData> {
    let text: string | null = null;
    try {
      text = await this.backend.read();
    } catch {
      this.setStatus('error');
    }
    const parsed = parseSave(text);
    this.recovered = text !== null && parsed === null;
    this.droppedOldRun = parsed !== null && hasOldRun(text);
    this.data = parsed ?? emptySave();
    window.addEventListener('pagehide', () => this.flushNow());
    window.addEventListener('beforeunload', () => this.flushNow());
    return this.data;
  }

  /** 修改存档并安排写入。 */
  update(mutate: (data: SaveData) => void, immediate = false): void {
    mutate(this.data);
    this.dirty = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), immediate ? 0 : 350);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.setStatus('saving');
    this.writing++;
    try {
      await this.backend.write(serializeSave(this.data));
      this.setStatus('saved');
    } catch {
      this.dirty = true;
      this.setStatus('error');
    } finally {
      this.writing--;
    }
  }

  /** 关闭窗口前同步写一次最新存档：有没写的改动，或者还有异步写入没确认写完时都要写。 */
  flushNow(): void {
    if (!this.dirty && this.writing === 0) return;
    this.dirty = false;
    try {
      this.backend.writeNow(serializeSave(this.data));
    } catch {
      this.dirty = true;
    }
  }

  /** 清除全部存档（设置、进度与记录），回到全新状态。 */
  async reset(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
    await this.backend.remove();
    this.data = emptySave();
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }
}

/** 存档是旧版本格式，且里面有进行中的一轮。 */
function hasOldRun(text: string | null): boolean {
  try {
    const raw = JSON.parse(text ?? 'null') as { version?: unknown; run?: unknown } | null;
    return !!raw && Number(raw.version ?? 1) < SAVE_VERSION && !!raw.run;
  } catch {
    return false;
  }
}
