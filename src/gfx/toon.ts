// 卡通着色：两段色阶加柔和过渡、队伍色背光边缘、硬高光、发光部件，以及受击闪白、染色、溶解消散。
// 模型的每个顶点带一个 surf 属性：x 发光强度、y 高光、z 背光边缘、w 描边粗细系数。
import * as THREE from 'three';

let rampTexture: THREE.DataTexture | null = null;

/** 明暗色阶：横坐标是 dot(N, L) * 0.5 + 0.5。 */
export function toonRamp(): THREE.DataTexture {
  if (rampTexture) return rampTexture;
  const size = 256;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    // 暗部 → 明部的交界很窄（0.49–0.515，像赛璐璐动画那样分明）；亮部缓慢抬升，正对光源再亮一档。
    const shadow = 0.45;
    const lit = 0.84 + 0.16 * smooth(0.55, 0.85, x);
    let v = shadow + (lit - shadow) * smooth(0.49, 0.515, x);
    v += 0.1 * smooth(0.92, 0.95, x);
    const b = Math.round(Math.min(1, v / 1.1) * 255);
    data[i * 4] = b;
    data[i * 4 + 1] = b;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampTexture = tex;
  return tex;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 三维值噪声（溶解、火焰等共用）。 */
export const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) {
    return vnoise(p) * 0.55 + vnoise(p * 2.03 + 11.7) * 0.3 + vnoise(p * 4.1 + 3.1) * 0.15;
  }
`;

/** 每个模型实例各自的着色参数。 */
export interface ToonUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uFlash: { value: THREE.Vector4 };
  uTint: { value: THREE.Vector4 };
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uGlow: { value: number };
  uTime: { value: number };
}

export function toonUniforms(): ToonUniforms {
  return {
    uRimColor: { value: new THREE.Color(0.55, 0.85, 1) },
    uRimStrength: { value: 0.55 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uTint: { value: new THREE.Vector4(1, 1, 1, 0) },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(1, 0.8, 0.4) },
    uGlow: { value: 1 },
    uTime: { value: 0 },
  };
}

export interface ToonOptions {
  uniforms?: ToonUniforms;
  vertexColors?: boolean;
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  side?: THREE.Side;
  /** 没有 surf 属性的模型（场景道具）用这个值代替。 */
  defaultSurf?: [number, number, number, number];
  transparent?: boolean;
  opacity?: number;
}

/**
 * 卡通材质：在 three 自带的卡通材质上加背光边缘、硬高光、发光、闪白、染色与溶解。
 * uniforms 可以在多个材质之间共享（同一个模型的主体与附件）。
 */
export function toonMaterial(options: ToonOptions = {}): THREE.MeshToonMaterial & {
  userData: { uniforms: ToonUniforms };
} {
  const uniforms = options.uniforms ?? toonUniforms();
  const material = new THREE.MeshToonMaterial({
    color: options.color ?? 0xffffff,
    vertexColors: options.vertexColors ?? true,
    gradientMap: toonRamp(),
    map: options.map ?? null,
    side: options.side ?? THREE.FrontSide,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
  const surf = options.defaultSurf ?? [0, 0, 1, 1];
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = shader.defines ?? {};
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec4 surf;
        attribute vec2 surf2;
        varying vec4 vSurf;
        varying vec2 vSurf2;
        varying vec3 vObjPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vSurf = surf;
        vSurf2 = surf2;
        vObjPos = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform vec4 uFlash;
        uniform vec4 uTint;
        uniform float uDissolve;
        uniform vec3 uDissolveColor;
        uniform float uGlow;
        uniform float uTime;
        varying vec4 vSurf;
        varying vec2 vSurf2;
        varying vec3 vObjPos;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        float dissolveEdge = 0.0;
        if (uDissolve > 0.0) {
          float dn = fbm3(vObjPos * 9.0) - uDissolve * 1.08 + 0.04;
          if (dn < 0.0) discard;
          dissolveEdge = 1.0 - smoothstep(0.0, 0.07, dn);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 V = normalize(vViewPosition);
          float ndv = clamp(dot(normal, V), 0.0, 1.0);
          float rim = smoothstep(0.64, 0.78, 1.0 - ndv) * vSurf.z;
          #if NUM_DIR_LIGHTS > 0
            vec3 L = directionalLights[0].direction;
            // 背光边缘主要出现在背对主光的一侧。
            rim *= 0.3 + 0.7 * smoothstep(0.25, -0.35, dot(normal, L));
          #endif
          reflectedLight.indirectDiffuse += uRimColor * rim * uRimStrength * (0.6 + 0.4 * diffuseColor.rgb);
          #if NUM_DIR_LIGHTS > 0
            vec3 H = normalize(L + V);
            float sp = pow(clamp(dot(normal, H), 0.0, 1.0), 42.0);
            reflectedLight.directSpecular += smoothstep(0.5, 0.58, sp) * vSurf.y * 0.55 * directionalLights[0].color;
          #endif
          totalEmissiveRadiance += diffuseColor.rgb * vSurf.x * uGlow;
        }`,
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        /* glsl */ `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse
          + reflectedLight.directSpecular + totalEmissiveRadiance;
        outgoingLight = mix(outgoingLight, outgoingLight * uTint.rgb, uTint.a);
        outgoingLight = mix(outgoingLight, uFlash.rgb, uFlash.a);
        outgoingLight += uDissolveColor * dissolveEdge * 3.0;`,
      );
  };
  // 没有 surf 属性的网格：WebGL 对缺失的顶点属性使用常量值。
  material.userData.defaultSurf = surf;
  material.customProgramCacheKey = () => 'echo-toon';
  return material as THREE.MeshToonMaterial & { userData: { uniforms: ToonUniforms } };
}

export interface OutlineUniforms {
  uWidth: { value: number };
  uResolution: { value: THREE.Vector2 };
  uColor: { value: THREE.Color };
  uOpacity: { value: number };
  uDissolve: { value: number };
}

/** 全场共享的描边分辨率与粗细（按画布像素）。 */
export const outlineShared = {
  resolution: new THREE.Vector2(1280, 800),
  width: 1.8,
};

/**
 * 描边：把背面沿法线在屏幕空间里推出固定像素宽度（倒壳描边），颜色取部件颜色压暗。
 * 支持骨骼蒙皮。
 */
export function outlineMaterial(
  toon?: ToonUniforms,
  darken = 0.2,
): THREE.ShaderMaterial & { userData: { uniforms: OutlineUniforms } } {
  const uniforms: OutlineUniforms = {
    uWidth: { value: outlineShared.width },
    uResolution: { value: outlineShared.resolution },
    uColor: { value: new THREE.Color(darken, darken * 0.92, darken * 1.02) },
    uOpacity: { value: 1 },
    uDissolve: toon ? toon.uDissolve : { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexColors: true,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <color_pars_vertex>
      #include <skinning_pars_vertex>
      attribute vec4 surf;
      uniform float uWidth;
      uniform vec2 uResolution;
      varying vec3 vObjPos;
      void main() {
        #include <color_vertex>
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vObjPos = position;
        vec3 nView = normalize(normalMatrix * objectNormal);
        vec4 clipN = projectionMatrix * vec4(nView, 0.0);
        vec2 dir = clipN.xy * uResolution;
        float len = length(dir);
        if (len > 1e-6) {
          dir /= len;
          gl_Position.xy += dir * uWidth * surf.w * 2.0 / uResolution * gl_Position.w;
        }
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <color_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uDissolve;
      varying vec3 vObjPos;
      ${NOISE_GLSL}
      void main() {
        if (uDissolve > 0.0 && fbm3(vObjPos * 9.0) - uDissolve * 1.08 + 0.04 < 0.02) discard;
        vec3 c = uColor;
        #ifdef USE_COLOR
          c *= mix(vec3(0.35), vColor.rgb, 0.85);
        #endif
        gl_FragColor = vec4(c, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  material.userData.uniforms = uniforms;
  return material as THREE.ShaderMaterial & { userData: { uniforms: OutlineUniforms } };
}

/** 半透明的“玻璃 / 水 / 水晶”材质：菲涅耳边缘更亮，中间透出后面的东西。 */
export function glassMaterial(
  toon: ToonUniforms,
  options: { color: THREE.ColorRepresentation; opacity?: number; edge?: number },
): THREE.ShaderMaterial {
  const color = new THREE.Color(options.color);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: options.opacity ?? 0.42 },
      uEdge: { value: options.edge ?? 1.2 },
      uFlash: toon.uFlash,
      uDissolve: toon.uDissolve,
      uTime: toon.uTime,
    },
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <color_pars_vertex>
      #include <skinning_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObjPos;
      void main() {
        #include <color_vertex>
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vN = normalize(transformedNormal);
        vV = -mvPosition.xyz;
        vObjPos = position;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <color_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uEdge;
      uniform vec4 uFlash;
      uniform float uDissolve;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObjPos;
      ${NOISE_GLSL}
      void main() {
        if (uDissolve > 0.0 && fbm3(vObjPos * 9.0) - uDissolve * 1.08 + 0.04 < 0.0) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float f = pow(1.0 - abs(dot(n, v)), 2.2);
        vec3 base = uColor;
        #ifdef USE_COLOR
          base *= vColor.rgb;
        #endif
        float caustic = vnoise(vObjPos * 14.0 + vec3(0.0, uTime * 0.6, 0.0));
        vec3 col = base * (0.55 + 0.35 * caustic) + base * f * uEdge + vec3(f * f * 0.9);
        // 左上方的一块高光
        float spec = smoothstep(0.93, 0.97, dot(n, normalize(vec3(-0.4, 0.6, 0.7))));
        col += vec3(spec * 1.4);
        col = mix(col, uFlash.rgb, uFlash.a);
        gl_FragColor = vec4(col, clamp(uOpacity + f * 0.45 + spec, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  return material;
}
