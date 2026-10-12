// 自动更新的界面：启动后按设置在后台检查；发现新版本时标题页右上角出现“新版本 vX”按钮，
// 点开是更新弹窗（版本、发布时间、更新说明、下载进度，立即更新 / 稍后 / 在浏览器中查看）；
// 设置里的“更新”一栏：当前版本、自动检查开关、手动检查与结果。
// 联网、核对签名与安装都在主进程（electron/updater.cjs），这里只管时机和界面。
import { updateCheckDue, type Settings } from '../core/run/save.js';
import {
  bridge,
  type UpdateBridge,
  type UpdateFound,
  type UpdateInfo,
  type UpdateProgress,
} from '../platform/storage.js';
import { h, mount, type Child } from './dom.js';
import { button, dialog, toggle } from './widgets.js';

/** 启动后等这么久再自动检查，不和开场的加载抢资源。 */
const AUTO_CHECK_DELAY = 5000;

export interface UpdateHost {
  settings(): Settings;
  updateSettings(mutate: (s: Settings) => void): void;
  openModal(node: HTMLElement): void;
  closeModal(): void;
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; update: UpdateFound }
  | { kind: 'error'; message: string };

type InstallState =
  | { kind: 'idle' }
  | { kind: 'working'; progress: UpdateProgress | null }
  /** 安装程序已经启动，游戏马上退出。 */
  | { kind: 'restarting' }
  /** 测试模式：下载并核对了签名，没有安装。 */
  | { kind: 'verified' }
  | { kind: 'failed'; message: string };

interface View {
  el: HTMLElement;
  render: () => Child;
}

export class Updates {
  private readonly host: UpdateHost;
  private readonly api: UpdateBridge | null;
  private info: UpdateInfo | null = null;
  private check: CheckState = { kind: 'idle' };
  private install: InstallState = { kind: 'idle' };
  /** 跟着状态重画的界面片段；离开页面（不再挂在文档上）后丢弃。 */
  private readonly views = new Set<View>();

  constructor(host: UpdateHost) {
    this.host = host;
    this.api = bridge()?.update ?? null;
    this.api?.onProgress((progress) => {
      if (this.install.kind !== 'working') return;
      this.install = { kind: 'working', progress };
      this.changed();
    });
  }

  /** 已经发现、还没装的新版本。 */
  get available(): UpdateFound | null {
    return this.check.kind === 'available' ? this.check.update : null;
  }

  private get busy(): boolean {
    return this.install.kind === 'working' || this.install.kind === 'restarting';
  }

  /** 读主进程的更新信息；开着自动检查且到时间了，稍后在后台检查一次。 */
  async start(): Promise<void> {
    if (!this.api) return;
    try {
      this.info = await this.api.info();
    } catch {
      return;
    }
    this.changed();
    const s = this.host.settings();
    if (this.info.enabled && s.autoUpdate && updateCheckDue(s.updateCheck, Date.now())) {
      window.setTimeout(() => void this.runCheck(), AUTO_CHECK_DELAY);
    }
  }

  /** 检查一次。失败不弹提示，原因显示在设置里。 */
  async runCheck(): Promise<void> {
    if (!this.api || !this.info?.enabled || this.check.kind === 'checking' || this.busy) return;
    this.check = { kind: 'checking' };
    this.changed();
    const result = await this.api
      .check()
      .catch((error: unknown) => ({ status: 'error' as const, message: String(error) }));
    if (result.status === 'error') {
      this.check = { kind: 'error', message: result.message };
    } else {
      const found = result.status === 'available' ? result : null;
      this.check = found ? { kind: 'available', update: found } : { kind: 'latest' };
      this.host.updateSettings((s) => {
        s.updateCheck = { at: Date.now(), found: found ? found.version : null };
      });
    }
    this.changed();
  }

  /** 标题页右上角：发现新版本时出现“新版本 vX”按钮。 */
  badge(): HTMLElement {
    return this.slot('corner-actions update-corner', () => {
      const update = this.available;
      if (!update) return null;
      return button({
        label: `新版本 v${update.version}`,
        kind: 'primary',
        size: 'small',
        title: '查看更新说明',
        onClick: () => this.openDialog(),
        testId: 'update-badge',
      });
    });
  }

  /** 设置里的“更新”一栏；不是客户端（浏览器里开发）时没有。after：关掉更新弹窗后回到设置。 */
  settingsSection(after: () => void): HTMLElement | null {
    if (!this.api) return null;
    return h(
      'section',
      { class: 'settings-update', 'data-testid': 'update-settings' },
      h('h4', null, '更新'),
      this.slot('update-settings-body', () => this.settingsBody(after)),
    ) as HTMLElement;
  }

  /** 更新弹窗。安装过程中不能关。after：关掉后要回到的界面（从设置打开时回到设置）。 */
  openDialog(after?: () => void): void {
    const update = this.available;
    if (!update) return;
    if (this.install.kind === 'failed' || this.install.kind === 'verified') {
      this.install = { kind: 'idle' };
    }
    const close = () => {
      if (this.busy) return;
      this.host.closeModal();
      after?.();
    };
    const meta = [`当前版本 v${update.current}`];
    if (update.date) meta.push(`发布于 ${formatDate(update.date)}`);
    const node = dialog({
      title: `发现新版本 v${update.version}`,
      testId: 'update-dialog',
      body: h(
        'div',
        null,
        h('p', { class: 'update-meta' }, meta.join(' · ')),
        notesView(update.notes),
        this.slot('update-status', () => this.statusView()),
        this.slot('modal-actions', () => this.dialogActions(close)),
      ),
      actions: [],
      onClose: close,
    });
    node.classList.add('update-dialog');
    this.host.openModal(node);
  }

  // ---------------------------------------------------------------- 内部

  private async startInstall(): Promise<void> {
    if (!this.api || this.busy) return;
    this.install = { kind: 'working', progress: null };
    this.changed();
    const result = await this.api
      .install()
      .catch((error: unknown) => ({ ok: false as const, message: String(error) }));
    if (!result.ok) this.install = { kind: 'failed', message: result.message };
    else this.install = result.dryRun ? { kind: 'verified' } : { kind: 'restarting' };
    this.changed();
  }

  private settingsBody(after: () => void): Child {
    const info = this.info;
    if (!info) return null;
    const version = h(
      'span',
      { class: 'update-version', 'data-testid': 'update-version' },
      `当前版本 v${info.version}`,
    );
    if (!info.enabled) {
      return [version, h('span', { class: 'update-result' }, '这个版本不检查更新（开发或测试）。')];
    }
    const s = this.host.settings();
    const checking = this.check.kind === 'checking';
    return [
      version,
      toggle(
        '自动检查更新',
        s.autoUpdate,
        (v) => this.host.updateSettings((x) => (x.autoUpdate = v)),
        '启动后在后台检查，每天最多一次；只有检查和下载更新时访问 GitHub',
      ),
      button({
        label: checking ? '正在检查…' : '检查更新',
        size: 'small',
        disabled: checking || this.busy,
        onClick: () => void this.runCheck(),
        testId: 'update-check',
      }),
      h('span', { class: 'update-result', 'data-testid': 'update-result' }, this.resultText()),
      this.available
        ? button({
            label: '查看新版本',
            kind: 'primary',
            size: 'small',
            onClick: () => this.openDialog(after),
            testId: 'update-open',
          })
        : null,
      this.check.kind === 'error'
        ? button({
            label: '打开下载页',
            size: 'small',
            onClick: () => void this.api?.openPage(),
          })
        : null,
    ];
  }

  private resultText(): string {
    switch (this.check.kind) {
      case 'checking':
        return '正在检查…';
      case 'latest':
        return '已是最新版本。';
      case 'available':
        return `发现新版本 v${this.check.update.version}。`;
      case 'error':
        return `检查失败：${this.check.message}`;
      case 'idle': {
        const last = this.host.settings().updateCheck;
        return last ? `上次检查：${formatTime(last.at)}` : '还没有检查过。';
      }
    }
  }

  private statusView(): Child {
    const s = this.install;
    if (s.kind === 'working') return progressView(s.progress);
    if (s.kind === 'restarting') {
      return h('p', null, '正在安装：游戏马上关闭，装好后会自动重新打开，请稍等半分钟左右。');
    }
    if (s.kind === 'verified') {
      return h(
        'p',
        { 'data-testid': 'update-verified' },
        '已下载新版本并核对签名（测试模式，没有安装）。',
      );
    }
    if (s.kind === 'failed') {
      return h(
        'p',
        { class: 'update-error', 'data-testid': 'update-error' },
        `更新没有完成：${s.message}`,
      );
    }
    if (this.info && !this.info.auto) {
      return h('p', { 'data-testid': 'update-manual' }, this.info.reason ?? '请到下载页获取新版。');
    }
    return null;
  }

  private dialogActions(close: () => void): Child {
    const busy = this.busy;
    const later = button({ label: '稍后', onClick: close, disabled: busy, testId: 'update-later' });
    const page = (primary: boolean) =>
      button({
        label: primary ? '打开下载页' : '在浏览器中查看',
        kind: primary ? 'primary' : 'secondary',
        disabled: busy,
        onClick: () => void this.api?.openPage(),
        testId: 'update-page',
      });
    if (this.install.kind === 'verified') {
      return button({ label: '完成', kind: 'primary', onClick: close, testId: 'update-done' });
    }
    if (this.info && !this.info.auto) return [later, page(true)];
    return [
      later,
      page(false),
      button({
        label: this.install.kind === 'failed' ? '重试' : '立即更新',
        kind: 'primary',
        disabled: busy,
        onClick: () => void this.startInstall(),
        testId: 'update-install',
      }),
    ];
  }

  /** 一块跟着更新状态重画的界面。 */
  private slot(className: string, render: () => Child): HTMLElement {
    const el = h('div', { class: className }) as HTMLElement;
    mount(el, render());
    this.views.add({ el, render });
    return el;
  }

  private changed(): void {
    for (const view of this.views) {
      if (!view.el.isConnected) this.views.delete(view);
      else mount(view.el, view.render());
    }
  }
}

function progressView(progress: UpdateProgress | null): Node {
  let text = '正在连接…';
  let ratio = 0;
  if (progress?.phase === 'downloading') {
    const received = progress.received ?? 0;
    const total = progress.total ?? 0;
    ratio = total ? received / total : 0;
    text = total
      ? `正在下载 ${Math.floor(ratio * 100)}%（${mb(received)} / ${mb(total)} MB）`
      : `正在下载 ${mb(received)} MB`;
  } else if (progress?.phase === 'verifying') {
    ratio = 1;
    text = '正在核对签名…';
  } else if (progress?.phase === 'installing') {
    ratio = 1;
    text = '正在准备安装…';
  }
  return h(
    'div',
    { 'data-testid': 'update-progress' },
    h(
      'div',
      { class: 'update-bar' },
      h('div', { style: { width: `${Math.round(ratio * 100)}%` } }),
    ),
    h('p', null, text),
  );
}

/** 更新说明：只认列表、小标题和段落；链接只留文字，去掉加粗、代码等标记。 */
function notesView(text: string): Node {
  if (!text.trim()) return h('p', { class: 'update-notes' }, '这一版没有写更新说明。');
  const blocks: Node[] = [];
  let list: Node[] = [];
  const flush = () => {
    if (list.length) blocks.push(h('ul', null, ...list));
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = /^[-*+]\s+(.*)$/.exec(line);
    if (item) {
      list.push(h('li', null, inline(item[1] ?? '')));
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(heading ? h('h5', null, inline(heading[1] ?? '')) : h('p', null, inline(line)));
  }
  flush();
  return h('div', { class: 'update-notes', 'data-testid': 'update-notes' }, ...blocks);
}

function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '');
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : ymd(d);
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
