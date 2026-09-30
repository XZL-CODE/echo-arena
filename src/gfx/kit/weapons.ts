// 武器与手持物：刀、法杖、弓、三叉戟与盾、大锤、拳套、宝珠。挂在 weapon / offhand 骨头上（手心朝下握持）。
import * as THREE from 'three';
import { bladeShape, ellipsoid, extrude, lathe, limb, place, tube, type V3 } from './geo.js';
import { mix, smooth } from './palette.js';
import type { BlueprintBuilder } from './rig.js';

export interface WeaponColors {
  main: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
  glow?: THREE.ColorRepresentation;
  grip?: THREE.ColorRepresentation;
}

/** 单刃刀：刀身沿骨头的 -Y 反方向（握在手里刀尖朝前上方由动作决定）。 */
export function katana(
  b: BlueprintBuilder,
  bone: string,
  s: number,
  c: WeaponColors,
  length = 0.4,
): void {
  const X = (v: number) => v * s;
  const grip = c.grip ?? 0x3a1e2a;
  // 刀柄
  b.part(bone, limb([0, X(0.07), 0], [0, X(-0.1), 0], X(0.015), X(0.014), 10), { color: grip });
  // 护手
  b.part(bone, place(ellipsoid(X(0.045), X(0.012), X(0.034), 16, 8), [0, X(0.078), 0]), {
    color: c.accent,
    gloss: 0.8,
  });
  // 刀身：略弯，边缘发光
  const blade = extrude(bladeShape(X(0.036), X(length), 0.08), X(0.008), X(0.003));
  const glow = c.glow ?? c.main;
  b.part(bone, place(blade, [0, X(0.084), 0], [0, Math.PI / 2, 0]), {
    color: (p) => mix(c.main, glow, smooth(X(length * 0.1), X(length * 0.95), p.y)),
    glow: c.glow ? 1.1 : 0,
    gloss: 1,
    line: 0.7,
  });
}

/** 法杖：长杆 + 顶端饰物（宝石 / 羽毛 / 枝条由调用方补充），返回顶端位置（骨头坐标）。 */
export function staff(
  b: BlueprintBuilder,
  bone: string,
  s: number,
  c: WeaponColors,
  length = 0.62,
): V3 {
  const X = (v: number) => v * s;
  b.part(bone, limb([0, X(-0.2), 0], [0, X(length - 0.2), 0], X(0.013), X(0.016), 10), {
    color: c.main,
  });
  b.part(
    bone,
    place(
      new THREE.TorusGeometry(X(0.022), X(0.008), 8, 16),
      [0, X(length - 0.22), 0],
      [Math.PI / 2, 0, 0],
    ),
    {
      color: c.accent,
      gloss: 0.8,
    },
  );
  return [0, X(length - 0.14), 0];
}

/** 弓：一段弧形弓臂加一根弦（左手持）。 */
export function bow(b: BlueprintBuilder, bone: string, s: number, c: WeaponColors): void {
  const X = (v: number) => v * s;
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8 - 0.5) * 2.2;
    pts.push([0, Math.sin(a) * X(0.26), Math.cos(a) * X(0.1) - X(0.06)]);
  }
  b.part(
    bone,
    tube(pts, {
      radius: (t) => X(0.012) * (1 - Math.abs(t - 0.5) * 0.9) + X(0.004),
      radial: 8,
      segments: 30,
    }),
    {
      color: c.main,
      gloss: 0.4,
    },
  );
  b.part(bone, limb(pts[0] as V3, pts[8] as V3, X(0.0025), X(0.0025), 6), {
    color: c.glow ?? 0xffffff,
    glow: c.glow ? 0.8 : 0,
    line: 0,
  });
  b.part(bone, place(ellipsoid(X(0.018), X(0.03), X(0.018), 12, 8), [0, 0, X(0.035)]), {
    color: c.accent,
  });
}

/** 三叉戟。 */
export function trident(b: BlueprintBuilder, bone: string, s: number, c: WeaponColors): void {
  const X = (v: number) => v * s;
  b.part(bone, limb([0, X(-0.24), 0], [0, X(0.46), 0], X(0.012), X(0.012), 10), { color: c.main });
  for (const x of [-1, 0, 1]) {
    const h = x === 0 ? 0.16 : 0.12;
    b.part(
      bone,
      tube(
        [
          [x * X(0.045), X(0.44), 0],
          [x * X(0.05), X(0.5), 0],
          [x * X(0.042), X(0.46 + h), 0],
        ],
        { radius: (t) => X(0.012) * (1 - t) + X(0.001), radial: 8, segments: 10 },
      ),
      { color: c.accent, gloss: 1, glow: c.glow ? 0.4 : 0 },
    );
  }
  b.part(bone, limb([X(-0.05), X(0.44), 0], [X(0.05), X(0.44), 0], X(0.01), X(0.01), 8), {
    color: c.accent,
    gloss: 1,
  });
}

/** 圆盾（龟壳盾）：朝向骨头的 +Z。 */
export function shield(
  b: BlueprintBuilder,
  bone: string,
  s: number,
  c: WeaponColors,
  radius = 0.17,
): void {
  const X = (v: number) => v * s;
  const r = X(radius);
  const dome = new THREE.SphereGeometry(r, 36, 16, 0, Math.PI * 2, 0, Math.PI * 0.32);
  dome.scale(1, 0.55, 1);
  dome.rotateX(Math.PI / 2);
  // 龟甲六边形纹路：按方向把颜色分块
  b.part(bone, place(dome, [0, 0, X(0.03)]), {
    color: (p) => {
      const a = Math.atan2(p.y, p.x);
      const rr = Math.hypot(p.x, p.y) / r;
      const cell = Math.abs(Math.sin(a * 3)) > 0.93 || (rr > 0.42 && rr < 0.47) ? 1 : 0;
      return mix(c.main, c.accent, cell * 0.85);
    },
    gloss: 0.6,
  });
  b.part(bone, place(new THREE.TorusGeometry(r * 0.98, X(0.012), 8, 40), [0, 0, X(0.03)]), {
    color: c.accent,
    gloss: 0.8,
  });
}

/** 大锤：短柄 + 石质锤头。 */
export function hammer(b: BlueprintBuilder, bone: string, s: number, c: WeaponColors): void {
  const X = (v: number) => v * s;
  b.part(bone, limb([0, X(-0.12), 0], [0, X(0.34), 0], X(0.016), X(0.016), 10), {
    color: c.grip ?? 0x5a3a26,
  });
  const head = new THREE.CylinderGeometry(X(0.075), X(0.075), X(0.22), 8, 1);
  head.rotateZ(Math.PI / 2);
  b.part(bone, place(head, [0, X(0.4), 0]), { color: c.main, gloss: 0.2 });
  for (const x of [-1, 1]) {
    b.part(
      bone,
      place(new THREE.CylinderGeometry(X(0.082), X(0.082), X(0.03), 8, 1).rotateZ(Math.PI / 2), [
        x * X(0.1),
        X(0.4),
        0,
      ]),
      {
        color: c.accent,
        gloss: 0.7,
        glow: c.glow ? 0.6 : 0,
      },
    );
  }
}

/** 拳套（戴在手上，放大手部）。 */
export function gauntlet(b: BlueprintBuilder, bone: string, s: number, c: WeaponColors): void {
  const X = (v: number) => v * s;
  b.part(bone, place(ellipsoid(X(0.046), X(0.05), X(0.04), 18, 12), [0, X(-0.03), X(0.004)]), {
    color: c.main,
    gloss: 0.7,
  });
  for (let i = 0; i < 3; i++) {
    b.part(
      bone,
      place(ellipsoid(X(0.012), X(0.02), X(0.012), 10, 8), [
        X(-0.024 + i * 0.024),
        X(-0.075),
        X(0.02),
      ]),
      {
        color: c.accent,
        glow: c.glow ? 1.2 : 0,
      },
    );
  }
  b.part(
    bone,
    lathe(
      [
        [X(0.036), X(0.03)],
        [X(0.05), X(0.0)],
        [X(0.048), X(-0.012)],
      ],
      { segments: 16 },
    ),
    { color: c.accent, gloss: 0.6 },
  );
}
