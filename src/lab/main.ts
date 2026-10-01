// 开发用的造型样张页：只在 ECHO_ARENA_LAB 环境变量下由客户端打开，不打进安装包。
// 查询参数：ids=fox-1,fox-2（并排展示）、yaw=0.4（转身角度）、pose=idle、t=1.2（动作时间）、
// cam=front|high|close、bg=stage|plain。
import * as THREE from 'three';
import { Animator, type AnimState } from '../gfx/anim/animator.js';
import { BattleView } from '../gfx/battle/view.js';
import type { StageTheme } from '../gfx/battle/stage.js';
import { Engine } from '../gfx/engine.js';
import { MockBattle } from './mock.js';
import { attachExtras } from '../gfx/kit/attachments.js';
import { ModelInstance } from '../gfx/kit/rig.js';
import { createLights } from '../gfx/lighting.js';
import { blueprint, profileOf } from '../gfx/models/index.js';
import { Showcase } from '../gfx/showcase.js';
import { outlineShared } from '../gfx/toon.js';

declare global {
  interface Window {
    __labReady?: boolean;
    __labError?: string;
  }
}

function param(name: string, fallback: string): string {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}

function main(): void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  document.body.style.margin = '0';
  document.body.appendChild(canvas);
  const engine = new Engine(canvas, { pinned: Number(param('q', '3')) as 0 | 1 | 2 | 3 });
  const scene = new THREE.Scene();
  const bgTop = new THREE.Color(param('sky', '#8fb8ff'));
  const bgBottom = new THREE.Color(param('horizon', '#ffe4c8'));
  scene.background = gradientTexture(bgTop, bgBottom);
  const lights = createLights(undefined, 4);
  scene.add(lights.group);

  if (param('bg', 'stage') === 'night') {
    scene.background = gradientTexture(new THREE.Color('#141a3a'), new THREE.Color('#4a2a5a'));
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.MeshToonMaterial({ color: 0x3a3558 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  } else if (param('bg', 'stage') === 'stage') {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.MeshToonMaterial({ color: 0x8fcf7a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const ids = param('ids', 'fox-1').split(',');
  const yaw = Number(param('yaw', '0.45'));
  const models: ModelInstance[] = [];
  const animators: Animator[] = [];
  let maxH = 0.5;
  const gap = Number(param('gap', '0'));
  let x = 0;
  const widths = ids.map((id) => Math.max(0.5, blueprint(id).height * 0.9));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (ids.length - 1);
  x = -total / 2;
  ids.forEach((id, i) => {
    const bp = blueprint(id);
    const m = new ModelInstance(bp);
    attachExtras(m);
    m.setRim(param('rim', '#8fe0ff'), 0.55);
    const w = widths[i] as number;
    m.group.position.set(x + w / 2, 0, 0);
    m.group.rotation.y = yaw;
    x += w + gap;
    scene.add(m.group);
    models.push(m);
    animators.push(new Animator(m, profileOf(id), i));
    maxH = Math.max(maxH, bp.height);
  });

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const view = param('cam', 'front');
  const span = Math.max(total, maxH * 1.25);
  const dist = (span / (2 * Math.tan(THREE.MathUtils.degToRad(14)))) * 1.12;
  if (view === 'high') {
    camera.position.set(0, maxH * 0.5 + dist * 0.7, dist * 0.75);
  } else if (view === 'close') {
    camera.position.set(0, maxH * 0.75, dist * 0.55);
  } else {
    camera.position.set(0, maxH * 0.55 + dist * 0.18, dist);
  }
  camera.lookAt(0, maxH * (view === 'close' ? 0.62 : 0.45), 0);

  const time = Number(param('t', '0.5'));
  const pose = param('pose', 'idle') as AnimState;
  const dur = Number(param('dur', '0.8'));
  // 从 0 推进到 time，让跟随摆动（头发、披风、尾巴）稳定下来
  const steps = Math.max(1, Math.round(time * 60));
  const start = pose === 'idle' || pose === 'run' ? Math.max(0, steps - 180) : 0;
  for (let i = start; i <= steps; i++) {
    const tt = i / 60;
    animators.forEach((a, j) => {
      const m = models[j] as ModelInstance;
      a.update({ state: pose, t: tt, dur, speed: 3, time: tt }, 1 / 60, m.group.position, yaw);
      for (const face of m.faces) face.set(a.expression);
      m.update(tt, 1 / 60);
    });
  }
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    engine.resize(w, h);
    engine.prepare();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    outlineShared.resolution.set(w * engine.pixelRatio, h * engine.pixelRatio);
    outlineShared.width = 1.5 * engine.pixelRatio;
  };
  resize();
  window.addEventListener('resize', resize);

  let frames = 0;
  const loop = () => {
    for (const m of models) m.update(time, 0);
    engine.render(scene, camera, 1 / 60);
    frames++;
    if (frames === 4) window.__labReady = true;
    requestAnimationFrame(loop);
  };
  loop();
}

function gradientTexture(top: THREE.Color, bottom: THREE.Color): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, `#${top.getHexString()}`);
  g.addColorStop(1, `#${bottom.getHexString()}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 战场样张：假战斗 10 对 10，推进到 t 秒后截图。 */
function arena(): void {
  document.body.style.margin = '0';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  host.append(canvas, overlay);
  document.body.appendChild(host);
  const view = new BattleView(canvas, overlay, Number(param('q', '2')) as 0 | 1 | 2 | 3);
  view.setStage(param('stage', 'meadow') as StageTheme);
  view.lod = param('lod', 'lo') as 'hi' | 'lo';
  view.namer = (u) => ({
    skill: u.species === 'fox' ? '狐火·千本斩' : u.species === 'cat' ? '九霄雷落' : '奥义',
    name: `${u.species}`,
  });
  const left = param(
    'left',
    'fox-3,bird-2,otter-1,turtle-3,bunny-2,deer-1,cat-3,wolf-2,bear-1,lizard-2',
  ).split(',');
  const right = param(
    'right',
    'wolf-3,cat-1,bear-2,lizard-3,deer-2,fox-1,bird-3,turtle-1,otter-2,bunny-3',
  ).split(',');
  const battle = new MockBattle(left, right);
  const resize = () => view.resize(window.innerWidth, window.innerHeight);
  resize();
  const until = Number(param('t', '5'));
  const dt = 1 / 60;
  let frame = 0;
  const steps = Math.round(until / dt);
  // 快进：模拟与特效照常推进，只在最后几帧真正渲染
  for (let i = 0; i < steps; i++) {
    const scale = view.timeScale;
    battle.step(dt * scale);
    view.sync(battle, 1, dt);
    const evs = battle.drainEvents();
    if (evs.length && i % 30 === 0) console.log('[lab] events', evs.map((e) => e.type).join(','));
    view.handle(evs);
    // 定点拍镜头：结束前 lead 秒对第 who 个单位触发技能特写或大招镜头
    if (i === steps - Math.round(Number(param('lead', '0.5')) / dt) && param('cam', '') !== '') {
      const who = battle.units.filter((u) => u.alive)[Number(param('who', '0'))];
      const foe = battle.units.find((u) => u.alive && who && u.team !== who.team);
      if (who && foe) {
        if (param('cam', '') === 'ult')
          view.handle([
            { type: 'ult', unitId: who.id, skill: 'ult', x: who.x, y: who.y, tx: foe.x, ty: foe.y },
          ]);
        else
          view.handle([
            {
              type: 'skill',
              unitId: who.id,
              skill: 'skill',
              form: who.form,
              x: who.x,
              y: who.y,
              tx: foe.x,
              ty: foe.y,
            },
          ]);
      }
    }
    if (i >= steps - 3) view.render(dt);
    else view.tick(dt);
    frame++;
  }
  console.log(
    '[lab] stats',
    JSON.stringify(view.stats()),
    'units alive',
    battle.units.filter((u) => u.alive).length,
    'shots',
    battle.projectiles.length,
  );
  console.log(
    '[lab] camera',
    view.camera.position
      .toArray()
      .map((v) => v.toFixed(2))
      .join(','),
    'shot',
    view.rig.inShot ? (view.rig.inUltShot ? 'ult' : 'skill') : 'none',
    'debris',
    view.effects.debris.alive,
  );
  window.__labReady = true;
  const loop = () => {
    view.render(0.0001);
    requestAnimationFrame(loop);
  };
  if (param('live', '0') === '1') {
    const live = () => {
      const scale = view.timeScale;
      battle.step(dt * scale);
      view.sync(battle, 1, dt);
      view.handle(battle.drainEvents());
      view.render(dt);
      requestAnimationFrame(live);
    };
    live();
  } else loop();
  void frame;
}

/** 进化演出样张：from → to，推进到 t 秒截图。 */
function evolve(): void {
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  document.body.appendChild(canvas);
  const engine = new Engine(canvas, { pinned: Number(param('q', '2')) as 0 | 1 | 2 | 3 });
  engine.resize(window.innerWidth, window.innerHeight);
  const show = new Showcase();
  show.show(param('from', 'fox-2'));
  const to = param('to', '');
  if (to) show.startEvolution(to, Number(param('color', String(0xff8a3a))));
  const until = Number(param('t', '2'));
  const dt = 1 / 60;
  const steps = Math.round(until / dt);
  for (let i = 0; i < steps; i++) show.update(dt);
  show.render(engine, dt);
  window.__labReady = true;
  const loop = () => {
    show.render(engine, 0.0001);
    requestAnimationFrame(loop);
  };
  loop();
}

try {
  const scene = param('scene', 'pet');
  if (scene === 'arena') arena();
  else if (scene === 'evolve') evolve();
  else main();
} catch (error) {
  window.__labError = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  console.error(error);
}
