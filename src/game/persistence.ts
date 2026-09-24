// 存档管理：内存中保存完整存档，改动后延迟合并写入；关闭窗口前同步落盘。
import { emptySave, parseSave, serializeSave, type SaveData } from '../core/run/save.js';
import { createSaveBackend, type SaveBackend } from '../platform/storage.js';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export class Persistence {
  readonly backend: SaveBackend;
  data: SaveData = emptySave();
  /** 读取时存档损坏或不可识别。 */
  recovered = false;
  status: SaveStatus = 'idle';
  onStatus: ((status: SaveStatus) => void) | null = null;
  private timer: number | null = null;
  private dirty = false;

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
    try {
      await this.backend.write(serializeSave(this.data));
      this.setStatus('saved');
    } catch {
      this.dirty = true;
      this.setStatus('error');
    }
  }

  flushNow(): void {
    if (!this.dirty) return;
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
