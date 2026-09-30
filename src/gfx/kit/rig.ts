// 造型蓝图与实例：在骨骼的局部坐标里摆部件，合并成一张刚性蒙皮网格（每个顶点只跟一根骨头），
// 同一蓝图的所有实例共享几何体，各自有骨骼与材质参数（队伍色、闪白、溶解）。
import * as THREE from 'three';
import {
  glassMaterial,
  outlineMaterial,
  toonMaterial,
  toonUniforms,
  type ToonUniforms,
} from '../toon.js';
import { FaceRig, type FaceSpec } from './face.js';
import type { V3 } from './geo.js';

export type ColorFn = (p: THREE.Vector3, t: number) => THREE.ColorRepresentation;

export interface PartStyle {
  color: THREE.ColorRepresentation | ColorFn;
  /** 发光强度（0 不发光；1 以上会进入泛光）。 */
  glow?: number;
  /** 硬高光强度。 */
  gloss?: number;
  /** 队伍色背光边缘（默认 1）。 */
  rim?: number;
  /** 描边粗细系数（默认 1，0 没有描边）。 */
  line?: number;
  /** 柔和明暗（0–1）：皮肤用，暗部往亮部抬。 */
  soft?: number;
}

interface BoneSpec {
  name: string;
  parent: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** 挂在骨头上的附加物（火苗、光球、武器光刃……），由各自的绘制代码实例化。 */
export interface Attachment {
  kind: string;
  bone: string;
  pos: V3;
  /** 附加物自己的参数。 */
  data: Record<string, unknown>;
}

export interface Blueprint {
  id: string;
  bones: BoneSpec[];
  body: THREE.BufferGeometry;
  glass: { geometry: THREE.BufferGeometry; color: THREE.Color; opacity: number } | null;
  faces: FaceSpec[];
  attachments: Attachment[];
  /** 站立高度（米），用于血条、头像取景与镜头。 */
  height: number;
  /** 头部中心（模型坐标，绑定姿势），头像取景用。 */
  headCenter: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/** 蓝图构建器：先定义骨骼，再往骨骼上挂部件。 */
export class BlueprintBuilder {
  readonly id: string;
  private bones: BoneSpec[] = [];
  private byName = new Map<string, number>();
  private world: THREE.Matrix4[] = [];
  private parts: THREE.BufferGeometry[] = [];
  private glassParts: THREE.BufferGeometry[] = [];
  private glassColor = new THREE.Color(0x9fe8ff);
  private glassOpacity = 0.4;
  private faces: FaceSpec[] = [];
  private attachments: Attachment[] = [];
  height = 1;
  headCenter = new THREE.Vector3(0, 1, 0);

  constructor(id: string) {
    this.id = id;
  }

  /** 定义一根骨头：位置相对父骨（绑定姿势），可选初始旋转。 */
  bone(name: string, parent: string | null, pos: V3, rot: V3 = [0, 0, 0]): this {
    if (this.byName.has(name)) throw new Error(`重复的骨头：${name}`);
    const parentIndex = parent === null ? -1 : this.index(parent);
    const spec: BoneSpec = {
      name,
      parent: parentIndex,
      pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    };
    const local = new THREE.Matrix4().compose(spec.pos, spec.quat, new THREE.Vector3(1, 1, 1));
    const world =
      parentIndex >= 0 ? (this.world[parentIndex] as THREE.Matrix4).clone().multiply(local) : local;
    this.byName.set(name, this.bones.length);
    this.bones.push(spec);
    this.world.push(world);
    return this;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  index(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`没有这根骨头：${name}`);
    return i;
  }

  /** 骨头在绑定姿势下的模型坐标。 */
  bonePosition(name: string): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(this.world[this.index(name)] as THREE.Matrix4);
  }

  /** 把骨头局部坐标里的点换算到模型坐标。 */
  toModel(name: string, p: V3): THREE.Vector3 {
    return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(
      this.world[this.index(name)] as THREE.Matrix4,
    );
  }

  /** 挂一个部件：geometry 在骨头局部坐标里，会被消耗（原地变换）。 */
  part(bone: string, geometry: THREE.BufferGeometry, style: PartStyle): this {
    this.parts.push(
      bakePart(geometry, this.index(bone), this.world[this.index(bone)] as THREE.Matrix4, style),
    );
    return this;
  }

  /**
   * 沿一串骨头平滑蒙皮的部件（尾巴、长发、飘带）：geometry 在第一根骨头的局部坐标里，
   * 需要带 't' 属性（tube 生成的沿长度参数），按 t 在相邻骨头之间线性分配权重。
   */
  chain(bones: string[], geometry: THREE.BufferGeometry, style: PartStyle): this {
    const first = this.index(bones[0] as string);
    const t = geometry.getAttribute('t') as THREE.BufferAttribute | undefined;
    const baked = bakePart(geometry, first, this.world[first] as THREE.Matrix4, style);
    if (!t || bones.length < 2) {
      this.parts.push(baked);
      return this;
    }
    const indices = bones.map((b) => this.index(b));
    const si = baked.getAttribute('skinIndex') as THREE.BufferAttribute;
    const sw = baked.getAttribute('skinWeight') as THREE.BufferAttribute;
    const n = indices.length - 1;
    for (let i = 0; i < si.count; i++) {
      const k = Math.min(n, Math.max(0, t.getX(i) * n));
      const a = Math.min(n - 1, Math.floor(k));
      const f = k - a;
      si.setXYZW(i, indices[a] as number, indices[a + 1] as number, 0, 0);
      sw.setXYZW(i, 1 - f, f, 0, 0);
    }
    this.parts.push(baked);
    return this;
  }

  /** 左右对称的一对部件：geometry 按左侧（+x）摆放，右侧自动镜像到 boneR。 */
  pair(boneL: string, boneR: string, geometry: THREE.BufferGeometry, style: PartStyle): this {
    const right = geometry.clone();
    right.scale(-1, 1, 1);
    flipIndexWinding(right);
    this.part(boneL, geometry, style);
    this.part(boneR, right, style);
    return this;
  }

  /** 半透明部件（泡泡、水环、水晶壳）。 */
  glass(
    bone: string,
    geometry: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    opacity = 0.4,
  ): this {
    this.glassColor = new THREE.Color(color);
    this.glassOpacity = opacity;
    this.glassParts.push(
      bakePart(geometry, this.index(bone), this.world[this.index(bone)] as THREE.Matrix4, {
        color: 0xffffff,
      }),
    );
    return this;
  }

  face(spec: FaceSpec): this {
    this.index(spec.bone);
    this.faces.push(spec);
    return this;
  }

  attach(kind: string, bone: string, pos: V3, data: Record<string, unknown> = {}): this {
    this.index(bone);
    this.attachments.push({ kind, bone, pos, data });
    return this;
  }

  build(): Blueprint {
    if (this.parts.length === 0) throw new Error(`${this.id} 没有部件`);
    const body = mergeParts(this.parts);
    const glass =
      this.glassParts.length > 0
        ? {
            geometry: mergeParts(this.glassParts),
            color: this.glassColor,
            opacity: this.glassOpacity,
          }
        : null;
    return {
      id: this.id,
      bones: this.bones,
      body,
      glass,
      faces: this.faces,
      attachments: this.attachments,
      height: this.height,
      headCenter: this.headCenter.clone(),
    };
  }
}

function flipIndexWinding(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (!index) return;
  const arr = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1] as number;
    arr[i + 1] = arr[i + 2] as number;
    arr[i + 2] = t;
  }
  index.needsUpdate = true;
}

/** 把部件变换到模型坐标，写入颜色、surf 与蒙皮属性。 */
function bakePart(
  g: THREE.BufferGeometry,
  boneIndex: number,
  world: THREE.Matrix4,
  style: PartStyle,
): THREE.BufferGeometry {
  let geo = g.index ? g : g;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const surf = new Float32Array(count * 4);
  const surf2 = new Float32Array(count * 2);
  const tAttr = geo.getAttribute('t') as THREE.BufferAttribute | undefined;
  const fixed = typeof style.color === 'function' ? null : new THREE.Color(style.color);
  for (let i = 0; i < count; i++) {
    if (fixed) {
      _c.copy(fixed);
    } else {
      _v.fromBufferAttribute(pos, i);
      _c.set((style.color as ColorFn)(_v, tAttr ? tAttr.getX(i) : 0));
    }
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
    surf[i * 4] = style.glow ?? 0;
    surf[i * 4 + 1] = style.gloss ?? 0;
    surf[i * 4 + 2] = style.rim ?? 1;
    surf[i * 4 + 3] = style.line ?? 1;
    surf2[i * 2] = style.soft ?? 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  geo.setAttribute('surf2', new THREE.BufferAttribute(surf2, 2));
  geo.applyMatrix4(world);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = boneIndex;
    skinWeight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  for (const name of Object.keys(geo.attributes)) {
    if (
      !['position', 'normal', 'color', 'surf', 'surf2', 'skinIndex', 'skinWeight'].includes(name)
    ) {
      geo.deleteAttribute(name);
    }
  }
  if (!geo.index) {
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  geo = geo as THREE.BufferGeometry;
  return geo;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    vertices += p.getAttribute('position').count;
    indices += (p.getIndex() as THREE.BufferAttribute).count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const surf = new Float32Array(vertices * 4);
  const surf2 = new Float32Array(vertices * 2);
  const skinIndex = new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const n = p.getAttribute('position').count;
    position.set(
      (p.getAttribute('position') as THREE.BufferAttribute).array as Float32Array,
      vo * 3,
    );
    normal.set((p.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array, vo * 3);
    color.set((p.getAttribute('color') as THREE.BufferAttribute).array as Float32Array, vo * 3);
    surf.set((p.getAttribute('surf') as THREE.BufferAttribute).array as Float32Array, vo * 4);
    surf2.set((p.getAttribute('surf2') as THREE.BufferAttribute).array as Float32Array, vo * 2);
    skinIndex.set(
      (p.getAttribute('skinIndex') as THREE.BufferAttribute).array as Uint16Array,
      vo * 4,
    );
    skinWeight.set(
      (p.getAttribute('skinWeight') as THREE.BufferAttribute).array as Float32Array,
      vo * 4,
    );
    const idx = (p.getIndex() as THREE.BufferAttribute).array;
    for (let i = 0; i < idx.length; i++) index[io + i] = (idx[i] as number) + vo;
    vo += n;
    io += idx.length;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  g.setAttribute('surf2', new THREE.BufferAttribute(surf2, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  // 绑定姿势的包围球：动作会超出一些，实例里关掉视锥裁剪。
  return g;
}

/** 骨头的绑定姿势（动作在它上面叠加偏移）。 */
export interface RestPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** 一个模型实例：场景里的一只宠物。 */
export class ModelInstance {
  readonly blueprint: Blueprint;
  readonly group = new THREE.Group();
  /** 朝向与弹跳等由动作控制的中间层（group 只放世界位置）。 */
  readonly pivot = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  readonly boneByName = new Map<string, THREE.Bone>();
  readonly rest: RestPose[] = [];
  readonly uniforms: ToonUniforms;
  readonly body: THREE.SkinnedMesh;
  readonly outline: THREE.SkinnedMesh;
  readonly glass: THREE.SkinnedMesh | null;
  readonly faces: FaceRig[] = [];
  /** 附加物实例（由 attachments.ts 创建），每帧更新。 */
  readonly extras: Array<{
    update(time: number, dt: number): void;
    dispose(): void;
    object: THREE.Object3D;
  }> = [];
  private outlineMat: ReturnType<typeof outlineMaterial>;

  constructor(blueprint: Blueprint) {
    this.blueprint = blueprint;
    this.uniforms = toonUniforms();
    this.group.add(this.pivot);

    for (const spec of blueprint.bones) {
      const bone = new THREE.Bone();
      bone.name = spec.name;
      bone.position.copy(spec.pos);
      bone.quaternion.copy(spec.quat);
      this.bones.push(bone);
      this.boneByName.set(spec.name, bone);
      this.rest.push({ pos: spec.pos.clone(), quat: spec.quat.clone() });
    }
    blueprint.bones.forEach((spec, i) => {
      const bone = this.bones[i] as THREE.Bone;
      if (spec.parent >= 0) (this.bones[spec.parent] as THREE.Bone).add(bone);
      else this.pivot.add(bone);
    });

    const material = toonMaterial({ uniforms: this.uniforms });
    this.body = new THREE.SkinnedMesh(blueprint.body, material);
    this.outlineMat = outlineMaterial(this.uniforms);
    this.outline = new THREE.SkinnedMesh(blueprint.body, this.outlineMat);
    this.body.castShadow = true;
    this.body.frustumCulled = false;
    this.outline.frustumCulled = false;
    this.pivot.add(this.body, this.outline);
    this.group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    this.body.bind(skeleton);
    this.outline.bind(skeleton, this.body.bindMatrix);

    if (blueprint.glass) {
      const gm = glassMaterial(this.uniforms, {
        color: blueprint.glass.color,
        opacity: blueprint.glass.opacity,
      });
      this.glass = new THREE.SkinnedMesh(blueprint.glass.geometry, gm);
      this.glass.frustumCulled = false;
      this.glass.renderOrder = 2;
      this.pivot.add(this.glass);
      this.glass.bind(skeleton, this.body.bindMatrix);
    } else {
      this.glass = null;
    }

    for (const spec of blueprint.faces) {
      const face = new FaceRig(spec, this.uniforms);
      const bone = this.boneByName.get(spec.bone) as THREE.Bone;
      bone.add(face.group);
      this.faces.push(face);
    }
  }

  bone(name: string): THREE.Bone | undefined {
    return this.boneByName.get(name);
  }

  /** 队伍色背光（我方天青、对手珊瑚红）。 */
  setRim(color: THREE.ColorRepresentation, strength = 0.55): void {
    this.uniforms.uRimColor.value.set(color);
    this.uniforms.uRimStrength.value = strength;
  }

  setFlash(amount: number, color: THREE.ColorRepresentation = 0xffffff): void {
    this.uniforms.uFlash.value.set(0, 0, 0, amount);
    _c.set(color);
    this.uniforms.uFlash.value.x = _c.r;
    this.uniforms.uFlash.value.y = _c.g;
    this.uniforms.uFlash.value.z = _c.b;
  }

  setTint(amount: number, color: THREE.ColorRepresentation = 0xffffff): void {
    _c.set(color);
    this.uniforms.uTint.value.set(_c.r, _c.g, _c.b, amount);
  }

  setDissolve(amount: number, edge: THREE.ColorRepresentation = 0xffd27a): void {
    this.uniforms.uDissolve.value = amount;
    this.uniforms.uDissolveColor.value.set(edge);
  }

  setOutlineOpacity(v: number): void {
    this.outlineMat.userData.uniforms.uOpacity.value = v;
    this.outlineMat.transparent = v < 1;
  }

  /** 把所有骨头放回绑定姿势。 */
  resetPose(): void {
    this.bones.forEach((bone, i) => {
      const rest = this.rest[i] as RestPose;
      bone.position.copy(rest.pos);
      bone.quaternion.copy(rest.quat);
      bone.scale.set(1, 1, 1);
    });
  }

  update(time: number, dt: number): void {
    this.uniforms.uTime.value = time;
    for (const face of this.faces) face.update(time, dt);
    for (const extra of this.extras) extra.update(time, dt);
  }

  dispose(): void {
    (this.body.material as THREE.Material).dispose();
    this.outlineMat.dispose();
    if (this.glass) (this.glass.material as THREE.Material).dispose();
    for (const face of this.faces) face.dispose();
    for (const extra of this.extras) extra.dispose();
    this.body.skeleton.dispose();
  }
}

/** 模型坐标里的点 → 某根骨头的局部坐标（按绑定姿势）。 */
export function boneLocal(bp: Blueprint, bone: string, p: THREE.Vector3): THREE.Vector3 {
  const chain: number[] = [];
  let i = bp.bones.findIndex((b) => b.name === bone);
  while (i >= 0) {
    chain.unshift(i);
    i = (bp.bones[i] as BoneSpec).parent;
  }
  _m.identity();
  for (const j of chain) {
    const b = bp.bones[j] as BoneSpec;
    _m.multiply(new THREE.Matrix4().compose(b.pos, b.quat, new THREE.Vector3(1, 1, 1)));
  }
  return p.clone().applyMatrix4(_m.clone().invert());
}

void _n;
