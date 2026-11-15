/**
 * Event-driven VFX timeline skeleton (pure TS, no engine imports → unit-testable with vitest).
 * Copied structure from a shipped game; replace the event union and handle() cases for your game.
 *
 * Contract:
 *   handle(event, state)  — combat event → push Effect objects (never touches the World)
 *   tick(dt, state)       — advance ages, curves, homing, gravity, landing; drop expired
 *   effects               — read by renderer.update() every frame
 * Presentation state (player, sword, camera, foes…) is read by the plugin each frame and passed in.
 */
import type { TextureKey } from './textures.ts';

export type Vec = readonly [number, number, number];
export interface Presentation { epoch: unknown; player: Vec; sword: Vec; paused?: boolean; foes?: readonly (readonly number[])[] }
/** Replace with the game's combat event union (or import it). Accept loose shapes while fields are not frozen. */
export type VfxEvent =
  | { kind: 'attack'; step: 1 | 2 | 3; x: number; z: number; dirX: number; dirZ: number; radius: number; attackId?: number }
  | { kind: 'hit'; crit: boolean; x: number; z: number; source: string; attackId?: number }
  | { kind: 'kill'; x: number; z: number; enemy: number; heavy?: boolean }
  | { kind: 'enemyTelegraph'; phase: 'start' | 'end'; enemy: number; x: number; z: number; dirX: number; dirZ: number; shape?: 'fan' | 'line' | 'ring'; radius?: number; halfAngle?: number; duration?: number }
  | { kind: 'bolt'; x: number; z: number; dirX: number; dirZ: number; speed: number; life: number };

export const INK: Vec = [0.035, 0.045, 0.065];
export const PAPER: Vec = [0.88, 0.84, 0.74];
export const RED: Vec = [0.85, 0.055, 0.025];
/** Hard caps; extra effects are counted in `dropped` (acceptance: dropped = 0 in live runs). */
export const LIMITS = { meshes: 80, particles: 768, warnings: 16 } as const;
/** Vertical sprites must face the camera or they go edge-on: yaw = -cameraYaw. */
export const FACE_CAMERA = -38 * Math.PI / 180;

export interface Effect {
  id: number; texture: TextureKey; geometry: 'arc' | 'quad' | 'vertical' | 'points'; role: string;
  origin: Vec; position: Vec; target?: Vec; velocity?: Vec;
  gravity: number; curve: number; angle: number; size: [number, number]; grow: [number, number]; mirror: boolean;
  age: number; life: number; tint: Vec; rim: number; alpha: number; opacity: number;
  /** 0 → 1 dissolve; shader erodes with noise after ~0.4. */
  phase: number; split: number; scroll: number; crit: number;
  /** Arc reveal 0..1 (negative = none). */
  sweep: number;
  fill: [number, number, number, number]; wedge: [number, number, number, number];
  warning?: { enemy: number; shape: 'fan' | 'line' | 'ring'; radius: number; halfAngle: number; duration: number };
  quat?: readonly [number, number, number, number]; layer?: 'overlay'; bloom?: number;
  outlinePx?: number; tip?: number; rimTint?: Vec; land?: boolean; attackId?: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export class VfxTimeline {
  effects: Effect[] = [];
  dropped = 0;
  /** Burst multiplier 0.5..1, lowered by the plugin when the VFX update gets expensive. */
  quality = 1;
  private nextId = 1;
  private seed = 7321;
  private random() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  /** Negative `age` in patch = delayed start (beats). */
  private add(texture: TextureKey, position: Vec, life: number, role: string, patch: Partial<Effect> = {}): Effect | undefined {
    const cat = patch.warning ? 'warnings' : patch.geometry === 'points' ? 'particles' : 'meshes';
    const n = this.effects.filter((e) => cat === 'warnings' ? !!e.warning : cat === 'particles' ? e.geometry === 'points' : !e.warning && e.geometry !== 'points').length;
    if (n >= LIMITS[cat]) { this.dropped++; return; }
    const e: Effect = { id: this.nextId++, texture, geometry: 'quad', role, origin: position, position, gravity: .8, curve: 0,
      angle: 0, size: [1, 1], grow: [1, 1], mirror: false, age: 0, life, tint: INK, rim: 0, alpha: .75, opacity: .75,
      phase: 0, split: 0, scroll: 0, crit: 0, sweep: -1, fill: [0, 0, 0, -1], wedge: [0, 0, 0, 0], ...patch };
    if (patch.origin === undefined) e.origin = e.position;
    this.effects.push(e); return e;
  }
  private burst(at: Vec, count: number, tint: Vec, texture: TextureKey, life = .55, delay = 0, speed = 1, extra: Partial<Effect> = {}) {
    count = Math.max(1, Math.round(count * this.quality));
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2, v = (.6 + this.random() * 1.5) * speed;
      this.add(texture, at, life, 'burst', { geometry: 'points', tint, alpha: .85, size: [.1 + this.random() * .14, 1], age: -delay,
        velocity: [Math.cos(a) * v, .5 + this.random() * 1.2, Math.sin(a) * v], ...extra });
    }
  }

  handle(event: Readonly<VfxEvent>, state: Presentation) {
    if (state.paused) return;
    switch (event.kind) {
      case 'attack': {
        // Arc slash on the ground plane, revealed head→tail by `sweep`, then dissolved.
        this.add(event.step === 3 ? 'slash-wide' as TextureKey : 'slash' as TextureKey, [event.x, .9, event.z], .32, 'attack', {
          geometry: 'arc', size: [event.radius, event.radius], angle: Math.atan2(event.dirX, event.dirZ), alpha: 1, rim: 1, sweep: 0, attackId: event.attackId });
        break;
      }
      case 'bolt': {
        // Projectile seen from above: horizontal spinning crescent (a stroke along screen-up flattens to a line).
        const v = event.speed;
        this.add('slash' as TextureKey, [event.x, 1, event.z], event.life, 'projectile', { geometry: 'arc', size: [1.4, 1.4], alpha: 1, rim: 1,
          angle: this.random() * Math.PI, velocity: [event.dirX * v, 0, event.dirZ * v], curve: 28 });
        break;
      }
      // hit / kill / telegraph … see SKILL.md 步骤 4.
      default: break;
    }
  }

  tick(dt: number, state: Presentation) {
    if (state.paused) return;
    for (const e of this.effects) {
      e.age += dt; if (e.age < 0) { e.opacity = 0; continue; }
      const t = clamp(e.age / e.life);
      if (e.velocity) e.position = [e.origin[0] + e.velocity[0] * e.age, e.origin[1] + e.velocity[1] * e.age - (e.geometry === 'points' ? e.gravity : 0) * e.age * e.age, e.origin[2] + e.velocity[2] * e.age];
      if (e.role === 'attack') { e.sweep = clamp(e.age / .06); e.phase = clamp((t - .45) / .55); e.opacity = e.alpha; }
      else if (e.role === 'projectile') { e.angle -= dt * (e.curve || 28); e.opacity = e.alpha * (1 - clamp((t - .8) / .2)); }
      else if (e.geometry === 'points') e.opacity = e.alpha * (1 - easeOut(t));
      else { e.opacity = e.alpha; e.phase = clamp((t - .5) / .5); }
    }
    this.effects = this.effects.filter((e) => e.age < e.life);
  }
  reset() { this.effects = []; }
}
