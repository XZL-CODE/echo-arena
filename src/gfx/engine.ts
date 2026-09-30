// 3D 渲染底座：WebGL2 渲染器、后期处理（泛光、调色、暗角、色散、闪白）与画质档位。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** 画质档位：0 低、1 中、2 高、3 极高。 */
export type QualityLevel = 0 | 1 | 2 | 3;

interface QualityPreset {
  /** 相对设备像素比的上限。 */
  maxPixelRatio: number;
  /** 多重采样抗锯齿的采样数（0 = 关）。 */
  samples: number;
  bloom: boolean;
  shadows: boolean;
  shadowSize: number;
  /** 粒子数量系数。 */
  particles: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  0: {
    maxPixelRatio: 0.85,
    samples: 0,
    bloom: false,
    shadows: false,
    shadowSize: 512,
    particles: 0.45,
  },
  1: { maxPixelRatio: 1, samples: 2, bloom: true, shadows: true, shadowSize: 1024, particles: 0.7 },
  2: { maxPixelRatio: 1.5, samples: 4, bloom: true, shadows: true, shadowSize: 2048, particles: 1 },
  3: { maxPixelRatio: 2, samples: 4, bloom: true, shadows: true, shadowSize: 2048, particles: 1 },
};

/** 调色、暗角、径向模糊、色散与闪白：在泛光之后、色调映射之前的线性色彩空间里处理。 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uVignette: { value: 0.28 },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uTint: { value: new THREE.Vector4(0, 0, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uRadial;
    uniform vec2 uCenter;
    uniform vec4 uFlash;
    uniform vec4 uTint;
    varying vec2 vUv;

    vec3 sampleScene(vec2 uv) {
      if (uAberration <= 0.0) return texture2D(tDiffuse, uv).rgb;
      vec2 off = (uv - 0.5) * uAberration;
      return vec3(
        texture2D(tDiffuse, uv + off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - off).b
      );
    }

    void main() {
      vec3 col = sampleScene(vUv);
      if (uRadial > 0.0) {
        vec2 dir = vUv - uCenter;
        vec3 acc = col;
        for (int i = 1; i < 8; i++) {
          acc += sampleScene(vUv - dir * uRadial * float(i) / 8.0);
        }
        col = acc / 8.0;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      col = mix(col, col * uTint.rgb, uTint.a);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.86);
      float v = smoothstep(0.78, 0.22, length(d));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uFlash.rgb, uFlash.a);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface EngineOptions {
  /** 画质上限（设置里选的档位）；自动调节不会超过它。 */
  maxQuality?: QualityLevel;
  /** 固定画质，不自动调节（测试与截图用）。 */
  pinned?: QualityLevel;
}

/** 帧耗时的指数平均，用于自动升降画质。 */
class Governor {
  ema = 16;
  private slow = 0;
  private fast = 0;

  /** 返回 -1 降档、+1 升档、0 不变。 */
  sample(ms: number, dt: number): -1 | 0 | 1 {
    this.ema += (Math.min(ms, 100) - this.ema) * 0.08;
    if (this.ema > 24) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.ema < 14.5) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt);
    }
    if (this.slow > 1.8) {
      this.slow = 0;
      return -1;
    }
    if (this.fast > 6) {
      this.fast = 0;
      return 1;
    }
    return 0;
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** 是否在用软件渲染（没有可用显卡）。 */
  readonly software: boolean;
  quality: QualityLevel;
  maxQuality: QualityLevel;
  pinned: QualityLevel | null;
  width = 1;
  height = 1;
  pixelRatio = 1;
  readonly grade: ShaderPass;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  private target: THREE.WebGLRenderTarget;
  private governor = new Governor();
  private lastFrame = 0;
  /** 最近一帧渲染耗时（毫秒，CPU 侧提交时间）。 */
  drawMs = 0;
  bloomStrength = 0.6;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x1b1430, 1);
    this.renderer = renderer;
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(rendererName(renderer));

    this.maxQuality = options.maxQuality ?? 3;
    this.pinned = options.pinned ?? null;
    this.quality =
      this.pinned ?? (this.software ? 0 : (Math.min(2, this.maxQuality) as QualityLevel));

    this.target = this.makeTarget(1, 1);
    this.composer = new EffectComposer(renderer, this.target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.bloomStrength, 0.5, 1.12);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.applyQuality();
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const preset = QUALITY[this.quality];
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: preset.samples,
    });
    target.texture.name = 'Engine.scene';
    return target;
  }

  get preset(): QualityPreset {
    return QUALITY[this.quality];
  }

  setQuality(level: QualityLevel): void {
    const next = Math.max(0, Math.min(this.maxQuality, level)) as QualityLevel;
    if (next === this.quality) return;
    this.quality = next;
    this.applyQuality();
  }

  pin(level: QualityLevel | null): void {
    this.pinned = level;
    if (level !== null) {
      this.quality = level;
      this.applyQuality();
    }
  }

  private applyQuality(): void {
    const preset = QUALITY[this.quality];
    this.renderer.shadowMap.enabled = preset.shadows;
    this.bloom.enabled = preset.bloom;
    // 多重采样数变了要换一张渲染目标。
    if (this.target.samples !== preset.samples) {
      const old = this.target;
      this.target = this.makeTarget(old.width, old.height);
      this.composer.reset(this.target);
      old.dispose();
    }
    this.resize(this.width, this.height, true);
  }

  resize(width: number, height: number, force = false): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const ratio = Math.min(dpr, QUALITY[this.quality].maxPixelRatio);
    if (!force && width === this.width && height === this.height && ratio === this.pixelRatio) {
      return;
    }
    this.width = width;
    this.height = height;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    const bw = Math.max(64, Math.round(width * ratio * 0.5));
    const bh = Math.max(64, Math.round(height * ratio * 0.5));
    this.bloom.setSize(bw, bh);
  }

  /** 渲染一帧；dt 用于自动调节画质。 */
  render(scene: THREE.Scene, camera: THREE.Camera, dt = 1 / 60): void {
    const start = performance.now();
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.bloom.strength = this.bloomStrength;
    this.composer.render(dt);
    this.drawMs = performance.now() - start;
    const now = start;
    const frameMs = this.lastFrame ? now - this.lastFrame : 16;
    this.lastFrame = now;
    if (this.pinned === null && frameMs < 250) {
      const step = this.governor.sample(frameMs, dt);
      if (step !== 0) this.setQuality((this.quality + step) as QualityLevel);
    }
  }

  /** 画面没在刷新时（切到后台、暂停渲染）重置计时，避免把空档算成卡顿。 */
  resetTiming(): void {
    this.lastFrame = 0;
  }

  get frameEma(): number {
    return this.governor.ema;
  }

  dispose(): void {
    this.composer.dispose();
    this.target.dispose();
    this.renderer.dispose();
  }
}

function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '');
}
