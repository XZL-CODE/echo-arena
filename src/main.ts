// 临时启动页：验证客户端外壳（窗口、协议、存档桥接、画布）。完整界面接入后替换。
import { Persistence } from './game/persistence.js';
import { renderBoard } from './render/board.js';
import { View } from './render/view.js';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '<canvas></canvas><h1 data-testid="title">回声竞技场</h1>';
  const persistence = new Persistence();
  await persistence.load();
  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const view = new View(canvas);
  view.fit(window.innerWidth, window.innerHeight - 60);
  const board = renderBoard(view);
  view.ctx.setTransform(1, 0, 0, 1, 0, 0);
  view.ctx.drawImage(board, 0, 0);
  persistence.update((d) => {
    d.records.runsStarted += 0;
  }, true);
  await persistence.flush();
  document.body.dataset.ready = persistence.backend.kind;
}

void boot();
