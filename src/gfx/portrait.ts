// 头像与立绘：用一个独立的小渲染器把宠物模型渲染成图片（界面卡片、大招特写横幅、图鉴）。
// 结果按“造型 + 取景 + 姿势 + 尺寸”缓存成 data URL。
import * as THREE from 'three';
import { Animator, type AnimState } from './anim/animator.js';
import { attachExtras } from './kit/attachments.js';
import { ModelInstance } from './kit/rig.js';
import { blueprint, profileOf } from './models/index.js';
import { outlineShared } from './toon.js';

export type Framing = 'bust' | 'full' | 'face';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch {
    return null;
  }
}

export interface PortraitOptions {
  framing?: Framing;
  pose?: AnimState;
  /** 姿势时间（秒）。 */
  t?: number;
  size?: [number, number];
  /** 转身角度（弧度，0 = 正面）。 */
  yaw?: number;
  /** 队伍色边缘光（不填是中性白）。 */
  rim?: THREE.ColorRepresentation;
}

/** 渲染一张宠物图片，返回 data URL（失败时返回空字符串）。 */
export function portrait(formId: string, options: PortraitOptions = {}): string {
  const framing = options.framing ?? 'full';
  const pose = options.pose ?? 'idle';
  const [w, h] = options.size ?? [256, 256];
  const yaw = options.yaw ?? 0.35;
  const key = `${formId}|${framing}|${pose}|${options.t ?? 0}|${w}x${h}|${yaw}|${options.rim ?? ''}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r = getRenderer();
  if (!r) return '';
  r.setSize(w, h, false);
  r.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x6a5a8a, 1.3));
  const key1 = new THREE.DirectionalLight(0xfff0dc, 3.1);
  key1.position.set(-2, 4, 5);
  scene.add(key1);
  const model = new ModelInstance(blueprint(formId, 'hi'));
  attachExtras(model);
  model.setRim(options.rim ?? 0xffffff, options.rim ? 0.7 : 0.35);
  model.group.rotation.y = yaw;
  scene.add(model.group);
  const animator = new Animator(model, profileOf(formId), 1);
  const t = options.t ?? 1.2;
  const steps = Math.round(t * 30);
  for (let i = 0; i <= steps; i++) {
    const tt = i / 30;
    animator.update(
      { state: pose, t: tt, dur: pose === 'ult' ? 1.4 : 0.8, speed: 0, time: tt + 3 },
      1 / 30,
      model.group.position,
      yaw,
    );
    model.update(tt + 3, 1 / 30);
  }
  for (const face of model.faces) face.set(animator.expression);
  model.group.updateMatrixWorld(true);
  const bp = model.blueprint;
  const camera = new THREE.PerspectiveCamera(24, w / h, 0.05, 50);
  const head = bp.headCenter.clone();
  let target: THREE.Vector3;
  let dist: number;
  if (framing === 'face') {
    target = head.clone().add(new THREE.Vector3(0, -bp.height * 0.02, 0));
    dist = Math.max(0.5, bp.height * 0.55);
  } else if (framing === 'bust') {
    target = new THREE.Vector3(0, head.y - bp.height * 0.12, 0);
    dist = bp.height * 1.35;
  } else {
    target = new THREE.Vector3(0, bp.height * 0.5, 0);
    dist = bp.height * 2.6 * Math.max(1, (h / w) * 0.8);
  }
  camera.position.set(target.x, target.y + dist * 0.12, target.z + dist);
  camera.lookAt(target);
  const prevRes = outlineShared.resolution.clone();
  const prevWidth = outlineShared.width;
  outlineShared.resolution.set(w, h);
  outlineShared.width = framing === 'full' ? 1.4 : 2;
  r.render(scene, camera);
  outlineShared.resolution.copy(prevRes);
  outlineShared.width = prevWidth;
  const url = r.domElement.toDataURL('image/png');
  model.dispose();
  cache.set(key, url);
  return url;
}

/** 清掉缓存（换画质或释放内存时）。 */
export function clearPortraits(): void {
  cache.clear();
}
