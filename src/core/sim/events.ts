// 模拟向表现层（画面、声音、提示）发出的事件。规则层不关心它们怎样被呈现。
import type { DamageSource, ModuleId, Team, UnitKind } from '../types.js';

export type SimEvent =
  | { type: 'shoot'; unitId: number; x: number; y: number; angle: number; big: boolean }
  | {
      type: 'hit';
      targetId: number;
      x: number;
      y: number;
      amount: number;
      echo: number;
      team: Team;
      source: DamageSource;
      killed: boolean;
    }
  | { type: 'block'; unitId: number; x: number; y: number; team: Team }
  | { type: 'reflect'; unitId: number; x: number; y: number; echo: number; team: Team }
  | { type: 'ricochet'; x1: number; y1: number; x2: number; y2: number; echo: number }
  | { type: 'bounce'; x: number; y: number; echo: number }
  | { type: 'fizzle'; x: number; y: number; team: Team }
  | { type: 'redirect'; x: number; y: number; echo: number }
  | { type: 'impact'; x: number; y: number; strength: number; echo: number; damaging: boolean }
  | { type: 'spring'; x: number; y: number; obstacleId: number }
  | {
      type: 'explode';
      x: number;
      y: number;
      radius: number;
      echo: number;
      team: Team;
      source: DamageSource;
    }
  | { type: 'echo'; x: number; y: number; level: number; chain: number; source: DamageSource }
  | {
      type: 'heal';
      targetId: number;
      fromX: number;
      fromY: number;
      x: number;
      y: number;
      amount: number;
    }
  | {
      type: 'pulse';
      unitId: number;
      x: number;
      y: number;
      radius: number;
      kind: 'heal' | 'magnet' | 'taunt';
    }
  | { type: 'death'; unitId: number; kind: UnitKind; team: Team; x: number; y: number }
  | { type: 'spawn'; unitId: number; kind: UnitKind; x: number; y: number }
  | { type: 'melee'; unitId: number; targetId: number; x: number; y: number; heavy: boolean }
  | { type: 'windup'; unitId: number; kind: UnitKind; duration: number }
  | { type: 'volley'; x: number; y: number; count: number }
  | { type: 'cast'; unitId: number; module: ModuleId; x: number; y: number }
  | { type: 'dashEnd'; unitId: number; x: number; y: number; quake: boolean }
  | { type: 'vortexEnd'; x: number; y: number; burst: boolean }
  | { type: 'lob'; x: number; y: number; toX: number; toY: number }
  | { type: 'lobLand'; x: number; y: number; radius: number }
  | { type: 'fuse'; unitId: number }
  | { type: 'phase'; unitId: number; phase: number }
  | { type: 'stunned'; unitId: number; x: number; y: number; duration: number }
  | { type: 'overtime'; level: number }
  | { type: 'focus'; unitId: number }
  | { type: 'end'; result: 'win' | 'lose' };
