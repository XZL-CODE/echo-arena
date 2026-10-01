// 场景光照：天空 / 地面半球光提供偏冷的暗部颜色，左上前方的暖色主光投影子。
import * as THREE from 'three';

export interface LightRig {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  group: THREE.Group;
}

export interface LightPreset {
  sky: THREE.ColorRepresentation;
  ground: THREE.ColorRepresentation;
  hemi: number;
  key: THREE.ColorRepresentation;
  keyIntensity: number;
  /** 主光方向（从目标指向光源）。 */
  dir: [number, number, number];
}

export const DAY: LightPreset = {
  sky: 0xc8dcff,
  ground: 0x5e4a86,
  hemi: 1.05,
  key: 0xfff0dc,
  keyIntensity: 3.1,
  dir: [-0.45, 0.8, 0.55],
};

export function createLights(preset: LightPreset = DAY, extent = 9): LightRig {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(preset.sky, preset.ground, preset.hemi);
  const key = new THREE.DirectionalLight(preset.key, preset.keyIntensity);
  const d = new THREE.Vector3(...preset.dir).normalize();
  key.position.copy(d.multiplyScalar(20));
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera as THREE.OrthographicCamera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 1;
  cam.far = 50;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  group.add(hemi, key, key.target);
  return { hemi, key, group };
}

export function applyPreset(rig: LightRig, preset: LightPreset): void {
  rig.hemi.color.set(preset.sky);
  rig.hemi.groundColor.set(preset.ground);
  rig.hemi.intensity = preset.hemi;
  rig.key.color.set(preset.key);
  rig.key.intensity = preset.keyIntensity;
  const d = new THREE.Vector3(...preset.dir).normalize();
  rig.key.position.copy(d.multiplyScalar(20)).add(rig.key.target.position);
}
