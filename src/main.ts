// 入口：启动应用外壳。
import { App } from './ui/app.js';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  void app.start();
}
