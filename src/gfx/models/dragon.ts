// 首领 · 烛龙：兽形（烛龙）→ 半血化为人形（烛龙君）。
import * as THREE from 'three';
import {
  bladeShape,
  deform,
  ellipsoid,
  extrude,
  limb,
  noise3,
  place,
  tube,
  type V3,
} from '../kit/geo.js';
import { horns, humanoid } from '../kit/humanoid.js';
import { mix, smooth } from '../kit/palette.js';
import { BlueprintBuilder, type Blueprint, type ColorFn } from '../kit/rig.js';
import { katana } from '../kit/weapons.js';

const SCALE = 0x2a1418;
const SCALE_HI = 0x5a1a1e;
const FLANK = 0x4e1216;
const BELLY = 0x9c5428;
const BELLY_DARK = 0x62301c;
const EMBER = 0xff5a1f;
const GOLD = 0xffc84e;
const FLAME = 0xffe27a;
const HORN = 0xe8d8b8;
const HORN_DARK = 0x2a1a14;

/**
 * 鳞甲配色。v 是部件自身的上下位置（-1 底、1 顶）：背脊近黑，两侧暗红带斑驳，
 * 腹部一节节琥珀色甲片。
 */
function hide(ry: number, cy = 0, bellyAt = -0.45): ColorFn {
  const top = new THREE.Color(SCALE);
  const flank = new THREE.Color(FLANK);
  return (p) => {
    const v = (p.y - cy) / ry;
    if (v < bellyAt) {
      const plate = Math.cos(p.z * 32) > 0.6 ? 0.72 : 1;
      return mix(BELLY_DARK, BELLY, smooth(bellyAt, bellyAt - 0.3, v)).multiplyScalar(plate);
    }
    const mottle = 0.82 + 0.34 * noise3(p.x * 8 + 3, p.y * 8, p.z * 8);
    return flank
      .clone()
      .lerp(top, smooth(bellyAt + 0.1, 0.35, v))
      .multiplyScalar(mottle);
  };
}

/** 沿一条模型坐标里的曲线放骨头：各骨头落在曲线等分点上，蒙皮的 t 与骨头一一对应。 */
function boneAlong(
  b: BlueprintBuilder,
  names: string[],
  parent: string,
  curve: THREE.Curve<THREE.Vector3>,
): void {
  names.forEach((name, i) => {
    const p = curve.getPointAt(i / (names.length - 1));
    const rel = p.sub(b.bonePosition(i === 0 ? parent : (names[i - 1] as string)));
    b.bone(name, i === 0 ? parent : (names[i - 1] as string), [rel.x, rel.y, rel.z]);
  });
}

/** 把模型坐标的点换成某根骨头的局部坐标（骨头没有旋转，只差一个平移）。 */
function local(b: BlueprintBuilder, bone: string, pts: V3[]): V3[] {
  const o = b.bonePosition(bone);
  return pts.map((p) => [p[0] - o.x, p[1] - o.y, p[2] - o.z]);
}

/**
 * 烛龙：黑红鳞甲的巨龙。S 形长颈、楔形长吻与下颌、金环长角与龙须，颈后一路火焰鬃毛，
 * 背脊到尾尖一排发光骨刺，一对镶火边的蝠翼，粗壮的四肢和利爪，胸口嵌着熔岩心核，尾尖燃着火。
 */
export function dragonBeast(): Blueprint {
  const b = new BlueprintBuilder('dragon-1');
  b.bone('root', null, [0, 0, 0])
    .bone('body', 'root', [0, 0.95, 0])
    .bone('chest', 'body', [0, 0.08, 0.46])
    .bone('hips', 'body', [0, 0.02, -0.48]);

  // 颈线：从胸口斜向前上抬起，到头部再往前探
  const neckPts: V3[] = [
    [0, 1.08, 0.6],
    [0, 1.36, 0.84],
    [0, 1.66, 0.96],
    [0, 1.9, 1.02],
    [0, 2.04, 1.12],
  ];
  const neckCurve = new THREE.CatmullRomCurve3(
    neckPts.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const neckBones = ['neckBase', 'neckMid', 'neck', 'head'];
  boneAlong(b, neckBones, 'chest', neckCurve);
  b.bone('jaw', 'head', [0, -0.07, 0.08]);
  b.bone('wingL', 'chest', [0.26, 0.34, -0.1]).bone('wingR', 'chest', [-0.26, 0.34, -0.1]);

  // 尾线：从臀部往后下垂，再微微扬起
  const tailPts: V3[] = [
    [0, 0.98, -0.72],
    [0, 0.88, -1.1],
    [0.08, 0.72, -1.5],
    [0.22, 0.6, -1.88],
    [0.36, 0.58, -2.2],
    [0.46, 0.66, -2.45],
  ];
  const tailCurve = new THREE.CatmullRomCurve3(
    tailPts.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const tailBones = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  boneAlong(b, tailBones, 'hips', tailCurve);

  // 四肢：前腿肘往后、腕往前；后腿膝往前、跗关节往后，脚掌再往前伸
  for (const [n, side] of [
    ['FL', 1],
    ['FR', -1],
    ['BL', 1],
    ['BR', -1],
  ] as const) {
    const front = n.startsWith('F');
    b.bone(
      `leg${n}`,
      front ? 'chest' : 'hips',
      front ? [side * 0.34, -0.2, 0.06] : [side * 0.32, -0.12, 0.02],
    )
      .bone(`shin${n}`, `leg${n}`, front ? [0, -0.36, -0.1] : [0, -0.34, 0.18])
      .bone(`paw${n}`, `shin${n}`, front ? [0, -0.38, 0.1] : [0, -0.34, -0.22]);
  }
  b.height = 2.4;

  // ---- 躯干：深胸、收腰、结实的臀
  b.part('body', ellipsoid(0.44, 0.42, 0.72, 48, 32), { color: hide(0.42) });
  b.part('chest', place(ellipsoid(0.46, 0.5, 0.44, 44, 30), [0, 0.02, 0.02]), {
    color: hide(0.5, 0.02),
  });
  b.part('hips', place(ellipsoid(0.38, 0.38, 0.4, 36, 24), [0, 0.02, 0]), {
    color: hide(0.38, 0.02),
  });
  // 胸口熔岩心核：菱形晶核 + 几道往外裂开的熔岩纹
  b.part(
    'chest',
    place(new THREE.OctahedronGeometry(1, 0), [0, 0.02, 0.46], [0, 0, 0], [0.07, 0.11, 0.05]),
    {
      color: FLAME,
      glow: 2.4,
      line: 0.6,
      rim: 0,
    },
  );
  for (const [dx, dy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [0, -1.3],
  ] as const) {
    b.part(
      'chest',
      tube(
        [
          [dx * 0.04, 0.02 + dy * 0.06, 0.465],
          [dx * 0.1, 0.02 + dy * 0.12, 0.44],
          [dx * 0.17, 0.02 + dy * 0.15, 0.4],
        ],
        { radius: (t) => 0.012 * (1 - t) + 0.003, radial: 5, segments: 8 },
      ),
      { color: EMBER, glow: 1.6, line: 0 },
    );
  }

  // ---- 长颈：一根管子平滑蒙在四根骨头上
  b.chain(
    neckBones,
    tube(local(b, 'neckBase', neckPts), {
      radius: (t) => 0.12 + 0.19 * Math.pow(1 - t, 1.3),
      radial: 20,
      segments: 30,
    }),
    {
      color: (p, t) => {
        // 颈线前侧（喉咙）是腹甲，后侧是鳞
        const c = neckCurve.getPointAt(t).sub(b.bonePosition('neckBase'));
        const tan = neckCurve.getTangentAt(t);
        const front = (p.z - c.z) * tan.y - (p.y - c.y) * tan.z;
        const r = 0.12 + 0.19 * Math.pow(1 - t, 1.3);
        if (front > r * 0.45) {
          const plate = Math.cos(t * 60) > 0.55 ? 0.72 : 1;
          return mix(BELLY_DARK, BELLY, smooth(0.45, 0.8, front / r)).multiplyScalar(plate);
        }
        const mottle = 0.82 + 0.34 * noise3(p.x * 8, p.y * 8 + 1, p.z * 8);
        return mix(SCALE, FLANK, smooth(-0.6, 0.45, front / r)).multiplyScalar(mottle);
      },
    },
  );

  // ---- 头：宽颅骨接楔形长吻
  const skull = ellipsoid(1, 1, 1, 48, 32);
  deform(skull, (p) => {
    const front = Math.max(0, p.z);
    p.x *= 1 - front * 0.5;
    p.y *= p.y > 0 ? 1 - front * 0.52 : 1 - front * 0.3;
    p.z *= 1 + front * 1.05;
    // 头顶压平一点，眉骨处略鼓
    if (p.y > 0.55) p.y = 0.55 + (p.y - 0.55) * 0.5;
  });
  skull.scale(0.2, 0.17, 0.26);
  b.part('head', place(skull, [0, 0.04, 0.06]), {
    color: (p) => {
      if (p.y < -0.05) return mix(0x3a0c0e, SCALE_HI, smooth(-0.1, -0.05, p.y));
      const mottle = 0.85 + 0.3 * noise3(p.x * 10, p.y * 10, p.z * 10);
      return mix(SCALE_HI, SCALE, smooth(-0.02, 0.12, p.y)).multiplyScalar(mottle);
    },
    gloss: 0.3,
  });
  // 眉骨：从眼上方斜着往后长进角根
  for (const side of [1, -1]) {
    b.part(
      'head',
      tube(
        [
          [side * 0.06, 0.13, 0.3],
          [side * 0.11, 0.15, 0.16],
          [side * 0.15, 0.16, 0.02],
        ],
        { radius: (t) => 0.03 + t * 0.02, radial: 10, segments: 10, caps: true },
      ),
      { color: SCALE_HI, gloss: 0.4 },
    );
    // 鼻孔
    b.part('head', place(ellipsoid(0.022, 0.012, 0.024, 10, 8), [side * 0.045, 0.075, 0.58]), {
      color: 0x0a0406,
      line: 0,
    });
    // 发光竖瞳眼（在眉骨下）
    b.part(
      'head',
      place(
        ellipsoid(0.034, 0.02, 0.02, 16, 10),
        [side * 0.125, 0.105, 0.18],
        [0, side * 0.55, side * -0.25],
      ),
      {
        color: FLAME,
        glow: 2.4,
        line: 0.5,
        rim: 0,
      },
    );
    b.part(
      'head',
      place(
        new THREE.BoxGeometry(0.006, 0.03, 0.006),
        [side * 0.137, 0.105, 0.19],
        [0, side * 0.55, 0],
      ),
      {
        color: 0x1a0a04,
        line: 0,
      },
    );
    // 上颌獠牙
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.ConeGeometry(0.014 - i * 0.001, i === 1 ? 0.07 : 0.045, 6);
      tooth.rotateX(Math.PI);
      b.part('head', place(tooth, [side * (0.085 - i * 0.012), -0.05, 0.46 - i * 0.075]), {
        color: 0xfff6e8,
        line: 0.4,
      });
    }
    // 颊侧骨刺：从下颌关节往后
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.ConeGeometry(0.022 - i * 0.004, 0.16 - i * 0.03, 6);
      spike.rotateX(-Math.PI / 2 - 0.25);
      b.part(
        'head',
        place(
          spike,
          [side * (0.17 - i * 0.01), -0.02 - i * 0.05, -0.12 - i * 0.02],
          [0, side * -0.5, 0],
        ),
        {
          color: (p) => mix(HORN_DARK, HORN, smooth(-0.02, -0.12, p.z)),
        },
      );
    }
  }
  // 下颌（张嘴时转动）：外侧鳞、底下一条腹甲
  const jaw = ellipsoid(1, 1, 1, 36, 20);
  deform(jaw, (p) => {
    const front = Math.max(0, p.z);
    p.x *= 1 - front * 0.5;
    p.y *= 1 - front * 0.4;
    p.z *= 1 + front * 0.9;
  });
  jaw.scale(0.14, 0.055, 0.24);
  b.part('jaw', place(jaw, [0, -0.02, 0.12]), {
    color: (p) =>
      p.y < -0.045
        ? mix(BELLY_DARK, BELLY, 0.5)
        : p.y > 0.0
          ? new THREE.Color(0x3a0c0e)
          : new THREE.Color(SCALE_HI),
  });
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      b.part(
        'jaw',
        place(new THREE.ConeGeometry(0.012, 0.04, 6), [
          side * (0.07 - i * 0.012),
          0.025,
          0.4 - i * 0.075,
        ]),
        {
          color: 0xfff6e8,
          line: 0.4,
        },
      );
    }
  }
  // 长角：主角往后掠、末端上挑，带两道金环；下面一对短角
  for (const side of [1, -1]) {
    b.part(
      'head',
      tube(
        [
          [side * 0.11, 0.15, 0.04],
          [side * 0.17, 0.25, -0.1],
          [side * 0.2, 0.3, -0.3],
          [side * 0.19, 0.28, -0.52],
          [side * 0.15, 0.36, -0.7],
        ],
        { radius: (t) => 0.05 * Math.pow(1 - t, 0.9) + 0.004, radial: 12, segments: 30 },
      ),
      {
        color: (_p, t) =>
          Math.abs(t - 0.26) < 0.03 || Math.abs(t - 0.4) < 0.02
            ? new THREE.Color(GOLD)
            : mix(HORN_DARK, HORN, smooth(0.2, 1, t)),
        gloss: 0.8,
      },
    );
    b.part(
      'head',
      tube(
        [
          [side * 0.15, 0.04, -0.02],
          [side * 0.24, 0.02, -0.14],
          [side * 0.28, 0.0, -0.3],
        ],
        { radius: (t) => 0.026 * (1 - t) + 0.003, radial: 8, segments: 12 },
      ),
      { color: (_p, t) => mix(HORN_DARK, HORN, t) },
    );
    // 龙须：从鼻侧飘出，顺着脸颊往后，末端发光
    b.part(
      'head',
      tube(
        [
          [side * 0.07, 0.04, 0.54],
          [side * 0.18, 0.05, 0.46],
          [side * 0.3, 0.0, 0.26],
          [side * 0.36, -0.08, 0.0],
          [side * 0.38, -0.08, -0.3],
          [side * 0.34, 0.0, -0.52],
        ],
        { radius: (t) => 0.009 * (1 - t) + 0.002, radial: 5, segments: 28 },
      ),
      { color: (_p, t) => mix(GOLD, FLAME, t), glow: 0.9, line: 0.4 },
    );
  }

  // ---- 火焰鬃毛：沿颈背一路长出、往后飘的火舌，根部橙红、梢头金黄
  const mane = (u: number, len: number, lean: number, fan: number) => {
    const c = neckCurve.getPointAt(u);
    const tan = neckCurve.getTangentAt(u);
    const back = new THREE.Vector3(0, tan.z, -tan.y).normalize();
    const r = 0.12 + 0.19 * Math.pow(1 - u, 1.3);
    const root = c.clone().addScaledVector(back, r * 0.8);
    const pts = [
      root.clone().addScaledVector(back, -0.03),
      root
        .clone()
        .addScaledVector(back, len * 0.35)
        .add(new THREE.Vector3(fan * 0.3, 0, -len * 0.25)),
      root
        .clone()
        .addScaledVector(back, len * 0.55)
        .add(new THREE.Vector3(fan * 0.7, -len * 0.05, -len * 0.62)),
      root
        .clone()
        .addScaledVector(back, len * 0.6 + lean)
        .add(new THREE.Vector3(fan, -len * 0.18, -len * 0.95)),
    ];
    const geo = tube(
      local(
        b,
        'neckBase',
        pts.map((p) => [p.x, p.y, p.z]),
      ),
      {
        radius: (t) => len * 0.18 * Math.pow(1 - t, 0.75) + 0.004,
        flat: 0.6,
        radial: 10,
        segments: 14,
      },
    );
    // 顶点颜色按离火舌根部的远近渐变；蒙皮按火舌在颈上的位置分给骨头
    const base = root.clone().sub(b.bonePosition('neckBase'));
    const color: ColorFn = (p) =>
      mix(EMBER, FLAME, smooth(0.25, 0.95, p.distanceTo(base) / (len * 1.1)));
    const count = geo.getAttribute('position').count;
    geo.setAttribute('t', new THREE.Float32BufferAttribute(new Array(count).fill(u), 1));
    b.chain(neckBones, geo, { color, glow: 1.1, rim: 0.2, line: 0.5 });
  };
  // 火舌左右交错着散开，正面看是一簇蓬起的鬃毛，不是一排叠片
  for (let i = 0; i < 14; i++) {
    const u = 0.04 + (i / 13) * 0.9;
    const len = 0.2 + 0.16 * Math.sin(u * Math.PI);
    mane(
      u,
      len,
      0.02 * Math.sin(i * 2.1),
      (i % 2 === 0 ? 1 : -1) * len * (0.25 + 0.2 * Math.sin(i * 1.7) ** 2),
    );
  }

  // ---- 背脊骨刺：从肩到臀，沿背线一排，往后掠
  const ellTop = (z: number, cy: number, cz: number, ry: number, rz: number) => {
    const k = 1 - ((z - cz) / rz) ** 2;
    return k > 0 ? cy + ry * Math.sqrt(k) : -9;
  };
  const backTop = (z: number) =>
    Math.max(
      ellTop(z, 0, 0, 0.42, 0.72),
      ellTop(z, 0.1, 0.48, 0.5, 0.44),
      ellTop(z, 0.04, -0.48, 0.38, 0.4),
    );
  for (let i = 0; i < 9; i++) {
    const z = 0.56 - i * 0.16;
    const h = 0.24 - Math.abs(i - 2.5) * 0.02;
    const spike = extrude(bladeShape(0.13, h, 0.3), 0.03, 0.01);
    b.part('body', place(spike, [0, backTop(z) - 0.03, z], [0, Math.PI / 2, 0]), {
      color: (p) => mix(0x1a0c0e, 0xff4a10, smooth(h * 0.35, h * 0.95, p.y)),
      glow: 0.75,
    });
  }

  // ---- 尾巴：五节平滑弯曲，沿途骨刺，尾尖燃火
  const tailR = (t: number) => 0.3 * Math.pow(1 - t, 1.05) + 0.03;
  b.chain(
    tailBones,
    tube(local(b, 'tail1', tailPts), { radius: tailR, radial: 18, segments: 50 }),
    {
      color: (p, t) => {
        const c = tailCurve.getPointAt(t).sub(b.bonePosition('tail1'));
        const v = (p.y - c.y) / tailR(t);
        if (v < -0.45)
          return mix(BELLY_DARK, BELLY, 0.6).multiplyScalar(Math.cos(t * 70) > 0.5 ? 0.72 : 1);
        const mottle = 0.82 + 0.34 * noise3(p.x * 8, p.y * 8 + 2, p.z * 8);
        return mix(FLANK, SCALE, smooth(-0.3, 0.6, v)).multiplyScalar(mottle);
      },
    },
  );
  for (let i = 0; i < 9; i++) {
    const u = 0.04 + i * 0.1;
    const c = tailCurve.getPointAt(u);
    const top = c.clone().add(new THREE.Vector3(0, tailR(u) * 0.85, 0));
    const bone = tailBones[Math.min(4, Math.round(u * 4))] as string;
    const h = 0.18 * (1 - u * 0.7);
    const spike = extrude(bladeShape(0.1 * (1 - u * 0.5), h, 0.35), 0.024, 0.008);
    const o = b.bonePosition(bone);
    b.part(
      bone,
      place(spike, [top.x - o.x, top.y - o.y - 0.02, top.z - o.z], [0, Math.PI / 2, 0]),
      {
        color: (p) => mix(0x1a0c0e, 0xff4a10, smooth(h * 0.3, h * 0.9, p.y)),
        glow: 0.75,
      },
    );
  }
  {
    const end = tailCurve.getPointAt(1).sub(b.bonePosition('tail5'));
    b.attach('flame', 'tail5', [end.x, end.y + 0.08, end.z - 0.04], {
      size: 0.3,
      color: EMBER,
      core: FLAME,
    });
  }

  // ---- 四肢：肩和大腿是鼓起的肌肉块，关节有骨刺，脚掌三趾带弯爪
  for (const n of ['FL', 'FR', 'BL', 'BR'] as const) {
    const front = n.startsWith('F');
    const side = n.endsWith('L') ? 1 : -1;
    const legSkin: ColorFn = (p) =>
      mix(FLANK, SCALE, 0.45).multiplyScalar(0.82 + 0.34 * noise3(p.x * 9, p.y * 9 + 4, p.z * 9));
    if (front) {
      b.part(
        'chest',
        place(
          ellipsoid(0.17, 0.3, 0.22, 24, 18),
          [side * 0.3, -0.12, 0.08],
          [0.25, 0, side * 0.12],
        ),
        { color: legSkin },
      );
      b.part(`leg${n}`, limb([0, 0.04, 0], [0, -0.36, -0.1], 0.17, 0.12), { color: legSkin });
      b.part(`shin${n}`, limb([0, 0, 0], [0, -0.36, 0.1], 0.12, 0.1), { color: legSkin });
      // 肘后骨刺
      const spur = new THREE.ConeGeometry(0.03, 0.16, 6);
      spur.rotateX(-Math.PI / 2 - 0.6);
      b.part(`shin${n}`, place(spur, [0, 0.02, -0.1]), {
        color: (p) => mix(HORN_DARK, HORN, smooth(-0.04, -0.14, p.z)),
      });
    } else {
      b.part(
        'hips',
        place(ellipsoid(0.2, 0.34, 0.3, 24, 18), [side * 0.28, -0.08, 0.04], [-0.3, 0, side * 0.1]),
        { color: legSkin },
      );
      b.part(`leg${n}`, limb([0, 0.04, 0], [0, -0.34, 0.18], 0.19, 0.12), { color: legSkin });
      b.part(`shin${n}`, limb([0, 0, 0], [0, -0.34, -0.22], 0.12, 0.085), { color: legSkin });
      b.part(`paw${n}`, limb([0, 0, 0], [0, -0.11, 0.08], 0.085, 0.075), { color: legSkin });
    }
    // 脚掌与三根弯爪
    const foot: V3 = front ? [0, -0.035, 0.06] : [0, -0.13, 0.14];
    b.part(`paw${n}`, place(ellipsoid(0.12, 0.06, 0.15, 20, 12), foot), { color: SCALE_HI });
    for (const k of [-1, 0, 1]) {
      const claw = tube(
        [
          [foot[0] + k * 0.055, foot[1] + 0.02, foot[2] + 0.12],
          [foot[0] + k * 0.07, foot[1] + 0.01, foot[2] + 0.2],
          [foot[0] + k * 0.075, foot[1] - 0.04, foot[2] + 0.24],
        ],
        { radius: (t) => 0.022 * (1 - t) + 0.002, radial: 6, segments: 8 },
      );
      b.part(`paw${n}`, claw, {
        color: (_p, t) => mix(HORN_DARK, HORN, smooth(0.2, 0.7, t)),
        gloss: 0.6,
      });
    }
  }

  // ---- 蝠翼：翼臂 + 四根指骨，翼膜暗红、往外透出橙光，扇贝形后缘镶一道火边
  for (const [bone, side] of [
    ['wingL', 1],
    ['wingR', -1],
  ] as const) {
    const span = 2.1;
    const fingers: V3[] = [
      [side * span * 0.55, 0.92, -0.25],
      [side * span * 0.92, 0.55, -0.55],
      [side * span, 0.1, -0.95],
      [side * span * 0.7, -0.25, -1.2],
    ];
    const elbow: V3 = [side * span * 0.38, 0.55, 0.02];
    b.part(bone, place(ellipsoid(0.12, 0.1, 0.12, 16, 12), [0, 0, 0]), { color: SCALE });
    b.part(
      bone,
      tube([[0, 0, 0], elbow], { radius: (t) => 0.08 * (1 - t * 0.45), radial: 10, segments: 8 }),
      { color: SCALE },
    );
    b.part(
      bone,
      place(
        new THREE.ConeGeometry(0.035, 0.18, 6),
        [elbow[0], elbow[1] + 0.08, elbow[2]],
        [0, 0, side * -0.3],
      ),
      {
        color: HORN,
      },
    );
    for (const f of fingers) {
      b.part(
        bone,
        tube([elbow, f], { radius: (t) => 0.036 * (1 - t * 0.8) + 0.004, radial: 8, segments: 10 }),
        { color: SCALE_HI },
      );
      b.part(bone, tube([elbow, f], { radius: 0.007, radial: 5, segments: 10 }), {
        color: EMBER,
        glow: 1.3,
        line: 0,
      });
      b.part(bone, place(new THREE.ConeGeometry(0.03, 0.12, 6), f, [0, 0, side * -1.2]), {
        color: HORN,
      });
    }
    // 翼膜：肘点 + 各指尖 + 贴身根部组成扇面；两层各朝一面
    const center = new THREE.Vector3(...elbow);
    const rim = [
      new THREE.Vector3(0, -0.05, -0.1),
      ...fingers.map((f) => new THREE.Vector3(...f)),
      new THREE.Vector3(side * 0.2, -0.4, -0.9),
    ];
    const pos: number[] = [];
    const edge: V3[][] = [];
    for (let i = 0; i < rim.length - 1; i++) {
      const a = rim[i] as THREE.Vector3;
      const c = rim[i + 1] as THREE.Vector3;
      // 后缘往里凹（扇贝形）
      const mid = a.clone().lerp(c, 0.5).lerp(center, 0.18);
      for (const [p1, p2] of [
        [a, mid],
        [mid, c],
      ] as const) {
        pos.push(center.x, center.y, center.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        pos.push(
          center.x,
          center.y,
          center.z - 0.008,
          p2.x,
          p2.y,
          p2.z - 0.008,
          p1.x,
          p1.y,
          p1.z - 0.008,
        );
      }
      if (i > 0 && i < rim.length - 1) edge.push([a.toArray(), mid.toArray(), c.toArray()] as V3[]);
    }
    const membrane = new THREE.BufferGeometry();
    membrane.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    membrane.computeVertexNormals();
    b.part(bone, membrane, {
      color: (p) => {
        const d = p.distanceTo(center);
        return mix(0x3a0c12, 0xb8401c, smooth(0.4, 1.3, d));
      },
      rim: 0.6,
      line: 0.3,
    });
    for (const e of edge) {
      b.part(bone, tube(e, { radius: 0.01, radial: 5, segments: 10 }), {
        color: EMBER,
        glow: 1.1,
        line: 0,
      });
    }
  }
  b.headCenter = b
    .bonePosition('head')
    .clone()
    .add(new THREE.Vector3(0, 0.06, 0.2));
  return b.build();
}

/**
 * 烛龙君：龙角龙尾的君主。银白长发金色发梢、黑金长大衣与赤红披风、龙鳞肩甲，
 * 手持烛火长刀，身后金色荆棘日轮，身边环绕火焰。
 */
export function dragonLord(): Blueprint {
  const f = humanoid({
    id: 'dragon-2',
    sex: 'm',
    height: 2.05,
    build: 1.12,
    skin: 0xf6e0d4,
    eyes: { iris: 0xe0781a, glow: FLAME, style: 'sharp' },
    hair: {
      style: 'long',
      color: 0xf2eee8,
      tip: GOLD,
      tipFrom: 0.5,
      bangs: 8,
      length: 0.8,
      seed: 41,
    },
    hairBones: 3,
    tailBones: 3,
    outfit: {
      suit: 0x1a1014,
      legs: 0x140c10,
      coat: {
        color: 0x1a1014,
        lining: 0xb81e22,
        trim: GOLD,
        length: 1.0,
        open: 0.7,
        sleeves: 'long',
        highCollar: true,
        slits: true,
        pattern: (p) => mix(0x1a1014, 0x6a1418, smooth(-0.5, -1.0, p.y)),
        gem: EMBER,
      },
      cape: { color: 0x8a1418, lining: 0x1a0a0c, trim: GOLD, length: 1.2, width: 1.25 },
      pauldrons: { color: 0x2a1418, trim: GOLD, size: 1.5, spikes: true },
      gloves: { color: 0x1a1014, length: 0.4 },
      boots: { color: 0x1a1014, height: 0.9, trim: GOLD },
      belt: GOLD,
      sash: 0xb81e22,
      gold: GOLD,
    },
  });
  const { b, s } = f;
  const X = (v: number) => v * s;
  horns(f, 0x1a1014, GOLD, 0.26, 1.1, GOLD);
  const tailPts: V3[] = [
    [0, 0, 0],
    [0, X(-0.14), X(-0.16)],
    [X(0.06), X(-0.34), X(-0.36)],
    [X(0.16), X(-0.46), X(-0.62)],
  ];
  b.chain(
    ['tail1', 'tail2', 'tail3'],
    tube(tailPts, {
      radius: (t) => X(0.075) * (1 - t * 0.85) + X(0.006),
      radial: 12,
      segments: 32,
    }),
    {
      color: (_p, t) =>
        Math.abs(Math.sin(t * 30)) > 0.93 ? new THREE.Color(SCALE_HI) : new THREE.Color(SCALE),
      gloss: 0.5,
    },
  );
  b.attach('flame', 'tail3', [X(0.16), X(-0.44), X(-0.64)], {
    size: X(0.1),
    color: EMBER,
    core: FLAME,
  });
  katana(b, 'weapon', s, { main: 0x2a1418, accent: GOLD, glow: EMBER, grip: 0x5a1018 }, 0.95);
  b.attach('halo', 'chest', [0, X(0.28), X(-0.3)], {
    radius: X(0.52),
    style: 'thorn',
    color: GOLD,
    accent: FLAME,
    count: 24,
    spin: 0.15,
  });
  b.attach('orbit', 'root', [0, X(1.15), 0], {
    kind: 'flame',
    count: 5,
    radius: X(0.72),
    size: X(0.08),
    color: EMBER,
    core: FLAME,
    speed: 0.8,
  });
  return b.build();
}
