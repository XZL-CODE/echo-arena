// 挂在骨头上的动态附加物：火苗（尾尖、额前）、光球、电弧环等。每个实例自己更新动画。
import * as THREE from 'three';
import { NOISE_GLSL } from '../toon.js';
import type { Attachment, ModelInstance } from './rig.js';

interface Extra {
  object: THREE.Object3D;
  update(time: number, dt: number): void;
  dispose(): void;
}

let flameGeo: THREE.BufferGeometry | null = null;

/** 水滴形火苗（底部圆、顶部尖），高 1，底部在原点。 */
function flameGeometry(): THREE.BufferGeometry {
  if (flameGeo) return flameGeo;
  const pts: THREE.Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // 底部是半圆，往上收成尖。
    const r =
      t < 0.28
        ? Math.sin((t / 0.28) * (Math.PI / 2)) * 0.36
        : 0.36 *
          Math.pow(1 - (t - 0.28) / 0.72, 1.35) *
          (1 + 0.25 * Math.sin(((t - 0.28) / 0.72) * Math.PI));
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), t));
  }
  flameGeo = new THREE.LatheGeometry(pts, 18);
  return flameGeo;
}

function flameMaterial(
  color: THREE.ColorRepresentation,
  core: THREE.ColorRepresentation,
  phase: number,
  intensity: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
      uOuter: { value: new THREE.Color(color) },
      uCore: { value: new THREE.Color(core) },
      uIntensity: { value: intensity },
      uFade: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 p = position;
        float t = uTime * 1.0 + uPhase;
        float h = p.y;
        p.x += sin(t * 9.0 + h * 7.0) * 0.1 * h;
        p.z += cos(t * 7.3 + h * 6.0) * 0.08 * h;
        p.y *= 1.0 + 0.12 * sin(t * 12.0) + 0.06 * sin(t * 23.0 + 1.3);
        p.xz *= 1.0 + 0.08 * sin(t * 17.0 + h * 4.0);
        vY = h;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uOuter;
      uniform vec3 uCore;
      uniform float uIntensity;
      uniform float uFade;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float core = smoothstep(0.35, 0.95, ndv) * (1.0 - smoothstep(0.35, 0.9, vY));
        vec3 col = mix(uOuter, uCore, core);
        col = mix(col, uOuter * 0.7, smoothstep(0.7, 1.0, vY));
        float a = smoothstep(0.02, 0.35, ndv) * (1.0 - smoothstep(0.85, 1.0, vY) * 0.6);
        gl_FragColor = vec4(col * uIntensity, a * uFade);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** 两层火苗：外层橙红，内层明黄。 */
function flame(att: Attachment, index: number): Extra {
  const size = (att.data.size as number | undefined) ?? 0.1;
  const color = (att.data.color as THREE.ColorRepresentation | undefined) ?? 0xff6a1f;
  const core = (att.data.core as THREE.ColorRepresentation | undefined) ?? 0xffe27a;
  const group = new THREE.Group();
  group.position.set(...(att.pos as [number, number, number]));
  const outerMat = flameMaterial(color, core, index * 1.7, 2.4);
  const innerMat = flameMaterial(core, 0xffffff, index * 1.7 + 0.8, 2.8);
  const outer = new THREE.Mesh(flameGeometry(), outerMat);
  outer.scale.setScalar(size);
  outer.position.y = -size * 0.2;
  const inner = new THREE.Mesh(flameGeometry(), innerMat);
  inner.scale.set(size * 0.55, size * 0.62, size * 0.55);
  inner.position.y = -size * 0.16;
  outer.renderOrder = 4;
  inner.renderOrder = 5;
  group.add(outer, inner);
  return {
    object: group,
    update(time) {
      outerMat.uniforms.uTime.value = time;
      innerMat.uniforms.uTime.value = time;
    },
    dispose() {
      outerMat.dispose();
      innerMat.dispose();
    },
  };
}

/** 发光小球（法杖顶端、浮游电球）。 */
function orb(att: Attachment): Extra {
  const size = (att.data.size as number | undefined) ?? 0.05;
  const color = new THREE.Color(
    (att.data.color as THREE.ColorRepresentation | undefined) ?? 0x9fe8ff,
  );
  const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2) });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), mat);
  const haloMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(size * 1.7, 16, 12), haloMat);
  mesh.add(halo);
  mesh.position.set(...(att.pos as [number, number, number]));
  const bob = (att.data.bob as number | undefined) ?? 0;
  const base = mesh.position.y;
  return {
    object: mesh,
    update(time) {
      halo.scale.setScalar(1 + 0.12 * Math.sin(time * 6));
      if (bob) mesh.position.y = base + Math.sin(time * 2.4) * bob;
    },
    dispose() {
      mat.dispose();
      haloMat.dispose();
      mesh.geometry.dispose();
      halo.geometry.dispose();
    },
  };
}

/** 发光材质：颜色乘以强度后进入泛光。 */
function glowMat(
  color: THREE.ColorRepresentation,
  intensity: number,
  additive = false,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: additive,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/**
 * 背后的光环：金色荆棘环、火焰环、符文环、花瓣环、雷电环、水晶环。竖在身后缓缓旋转。
 */
function halo(att: Attachment, index: number): Extra {
  const radius = (att.data.radius as number | undefined) ?? 0.3;
  const color = (att.data.color as THREE.ColorRepresentation | undefined) ?? 0xffc84e;
  const accent = (att.data.accent as THREE.ColorRepresentation | undefined) ?? 0xfff2c0;
  const style = (att.data.style as string | undefined) ?? 'thorn';
  const spin = (att.data.spin as number | undefined) ?? 0.25;
  const count = (att.data.count as number | undefined) ?? 16;
  const group = new THREE.Group();
  group.position.set(...(att.pos as [number, number, number]));
  const tilt = (att.data.tilt as number | undefined) ?? 0;
  group.rotation.x = tilt;
  const ring = new THREE.Group();
  group.add(ring);
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, to: THREE.Object3D = ring) => {
    const mesh = new THREE.Mesh(g, m);
    to.add(mesh);
    geos.push(g);
    mats.push(m);
    return mesh;
  };
  const main = glowMat(color, 1.9);
  add(new THREE.TorusGeometry(radius, radius * 0.028, 8, 72), main);
  const inner = new THREE.Group();
  group.add(inner);
  add(new THREE.TorusGeometry(radius * 0.8, radius * 0.012, 6, 64), glowMat(accent, 1.6), inner);
  const flames: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const long = i % 2 === 0;
    const len = radius * (long ? 0.42 : 0.24);
    if (style === 'flame') {
      const m = flameMaterial(0xff5a1f, 0xffe27a, i * 0.9 + index, 2.6);
      flames.push(m);
      const mesh = new THREE.Mesh(flameGeometry(), m);
      mesh.scale.set(len * 0.55, len * 1.1, len * 0.55);
      mesh.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      mesh.rotation.z = a - Math.PI / 2;
      ring.add(mesh);
      mats.push(m);
    } else if (style === 'crystal') {
      const g = new THREE.OctahedronGeometry(len * 0.35, 0);
      g.scale(0.55, 1.4, 0.55);
      const mesh = add(g, glowMat(i % 3 === 0 ? accent : color, 1.5));
      mesh.position.set(Math.cos(a) * radius * 1.12, Math.sin(a) * radius * 1.12, 0);
      mesh.rotation.z = a - Math.PI / 2;
    } else if (style === 'petal') {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(len * 0.35, len * 0.5, 0, len);
      shape.quadraticCurveTo(-len * 0.35, len * 0.5, 0, 0);
      const g = new THREE.ShapeGeometry(shape, 8);
      const mesh = add(
        g,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(i % 2 ? accent : color).multiplyScalar(1.5),
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      mesh.rotation.z = a - Math.PI / 2;
    } else if (style === 'bubble') {
      const m = glowMat(i % 3 === 0 ? accent : color, 1.2, true);
      (m as THREE.MeshBasicMaterial).opacity = 0.75;
      const mesh = add(new THREE.SphereGeometry(len * (long ? 0.28 : 0.18), 12, 10), m);
      mesh.position.set(Math.cos(a) * radius * 1.1, Math.sin(a) * radius * 1.1, 0);
    } else if (style === 'rune') {
      const g = new THREE.CylinderGeometry(len * 0.26, len * 0.26, radius * 0.02, 6, 1);
      g.rotateX(Math.PI / 2);
      const mesh = add(g, glowMat(i % 2 ? accent : color, 1.7));
      mesh.position.set(Math.cos(a) * radius * 1.12, Math.sin(a) * radius * 1.12, 0);
      mesh.rotation.z = a;
    } else if (style === 'bolt') {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 4; j++) {
        const r = radius + (j % 2 ? 0.35 : 0) * len + j * len * 0.12;
        pts.push(new THREE.Vector3(Math.cos(a + j * 0.03) * r, Math.sin(a + j * 0.03) * r, 0));
      }
      const g = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts),
        8,
        radius * 0.012,
        4,
        false,
      );
      add(g, glowMat(i % 2 ? accent : color, 2.2));
    } else {
      // 荆棘：朝外的尖刺，长短交替，微微弯
      const g = new THREE.ConeGeometry(radius * 0.05, len, 6, 1);
      g.translate(0, len / 2, 0);
      const mesh = add(g, main);
      mesh.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      mesh.rotation.z = a - Math.PI / 2 + (long ? 0.12 : -0.1);
    }
  }
  // 小圆点缀在内圈
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = add(new THREE.SphereGeometry(radius * 0.045, 10, 8), glowMat(accent, 2.2), inner);
    m.position.set(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8, 0);
  }
  return {
    object: group,
    update(time) {
      ring.rotation.z = time * spin;
      inner.rotation.z = -time * spin * 1.6;
      for (const f of flames) f.uniforms.uTime.value = time;
      const pulse = 1 + 0.03 * Math.sin(time * 3);
      group.scale.setScalar(pulse);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/** 环绕身体飞行的小东西：狐火、电球、水珠、花瓣、晶石。 */
function orbit(att: Attachment, index: number): Extra {
  const count = (att.data.count as number | undefined) ?? 3;
  const radius = (att.data.radius as number | undefined) ?? 0.5;
  const kind = (att.data.kind as string | undefined) ?? 'orb';
  const color = (att.data.color as THREE.ColorRepresentation | undefined) ?? 0xffb13b;
  const core = (att.data.core as THREE.ColorRepresentation | undefined) ?? 0xffffff;
  const speed = (att.data.speed as number | undefined) ?? 1.2;
  const size = (att.data.size as number | undefined) ?? 0.05;
  const group = new THREE.Group();
  group.position.set(...(att.pos as [number, number, number]));
  const items: THREE.Object3D[] = [];
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const flames: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < count; i++) {
    let obj: THREE.Object3D;
    if (kind === 'flame') {
      const m = flameMaterial(color, core, i * 1.3 + index, 2.6);
      flames.push(m);
      mats.push(m);
      obj = new THREE.Mesh(flameGeometry(), m);
      obj.scale.set(size, size * 1.6, size);
    } else if (kind === 'crystal') {
      const g = new THREE.OctahedronGeometry(size, 0);
      g.scale(0.7, 1.5, 0.7);
      const m = glowMat(color, 1.7);
      geos.push(g);
      mats.push(m);
      obj = new THREE.Mesh(g, m);
    } else {
      const g = new THREE.SphereGeometry(size, 14, 10);
      const m = glowMat(color, 2.2);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(size * 1.8, 14, 10),
        glowMat(color, 0.8, true),
      );
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.35;
      geos.push(g, halo.geometry);
      mats.push(m, halo.material as THREE.Material);
      obj = new THREE.Mesh(g, m);
      obj.add(halo);
    }
    group.add(obj);
    items.push(obj);
  }
  return {
    object: group,
    update(time) {
      items.forEach((obj, i) => {
        const a = time * speed + (i / count) * Math.PI * 2;
        obj.position.set(
          Math.cos(a) * radius,
          Math.sin(time * 1.7 + i) * radius * 0.18,
          Math.sin(a) * radius,
        );
        obj.rotation.y = -a;
      });
      for (const f of flames) f.uniforms.uTime.value = time;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/** 场景道具（火把等）共用的火苗几何与材质。 */
export function flameGeometryShared(): THREE.BufferGeometry {
  return flameGeometry();
}

const sharedFlames: THREE.ShaderMaterial[] = [];

export function flameMaterialShared(
  color: THREE.ColorRepresentation,
  core: THREE.ColorRepresentation,
): THREE.ShaderMaterial {
  const m = flameMaterial(color, core, sharedFlames.length * 1.3, 2.6);
  sharedFlames.push(m);
  return m;
}

/** 推进场景火苗的动画时间。 */
export function tickSharedFlames(time: number): void {
  for (const m of sharedFlames) m.uniforms.uTime.value = time;
}

const MAKERS: Record<string, (att: Attachment, index: number) => Extra> = {
  flame,
  orb,
  halo,
  orbit,
};

/** 为模型实例创建蓝图里声明的全部附加物。 */
export function attachExtras(model: ModelInstance): void {
  model.blueprint.attachments.forEach((att, i) => {
    const make = MAKERS[att.kind];
    if (!make) return;
    const extra = make(att, i);
    const bone = model.bone(att.bone);
    if (!bone) return;
    bone.add(extra.object);
    model.extras.push(extra);
  });
}

void NOISE_GLSL;
