// TEMPLATE (project-bound glue, from a shipped game). Keep: startVfx(world, assets, feed) + feed {subscribe, poll, read, delta};
// globalThis-shared signals (max over sources); module-copy bridge; read-only stats; adaptive quality; definePack registration
// of 'plugin/vfx'. Replace: combat/events + flow/run imports, scene entity names ('player','camera'), signal names, globals.
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { Time, Update, type World } from '@forgeax/engine/ecs';
import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { readPresentationWorldMatrix } from '@forgeax/engine/scene';
import { ok, type MaterialAsset } from '@forgeax/engine/types';
import * as combatEvents from '../combat/events.ts';
import type { CombatEvent } from '../combat/events.ts';
import { run } from '../flow/run.ts';
import { resolveGameEntity } from '../shared/scene-refs.ts';
import { createVfxMaterial, materialKey, OVERLAY_KEYS, VFX_PACKAGE_ID } from './materials.ts';
import { createVfxRenderer } from './renderer.ts';
import { VfxTimeline, type CameraPose, type Presentation, type PresentationKind, type PresentationRequest, type Vec, type VfxEvent } from './timeline.ts';
import { OBLIQUE_FOV } from '../view/oblique.ts';
import { VFX_TEXTURES, type TextureKey } from './textures.ts';

type Listener = (event: Readonly<VfxEvent>) => void;

/**
 * Read-only presentation signals for the render owner (0..1 strength, updated each frame).
 * desaturate: full-screen 去色只留朱红 for E; hidePlayer: hide/fade the player model; swordGlow: E refresh.
 */
type SignalKey = 'desaturate' | 'hidePlayer' | 'swordGlow' | 'transition';
type Signals = Record<SignalKey, number>;
const SIGNAL_KEYS: readonly SignalKey[] = ['desaturate', 'hidePlayer', 'swordGlow', 'transition'];
const shared = globalThis as { __inkVfxSignals?: Signals; __inkVfxSources?: Set<Signals> };
/** One object per realm, so every module instance (game plugin, evidence preview) feeds the same render input. */
export const vfxSignals: Signals = shared.__inkVfxSignals ??= { desaturate: 0, hidePlayer: 0, swordGlow: 0, transition: 0 };
const sources: Set<Signals> = shared.__inkVfxSources ??= new Set();
function publish() { for (const k of SIGNAL_KEYS) { let v = 0; for (const s of sources) v = Math.max(v, s[k]); vfxSignals[k] = v; } }

/** Dev preview / playthrough feed. Never used by combat; lets evidence runs inject events. */
const previewListeners = new Set<Listener>();
export function previewEmit(event: VfxEvent): void { for (const l of previewListeners) l(event); }

/**
 * Module-copy bridge (V003). The plugin loader and Cursor's ink.pack.ts load separate copies of this module,
 * and each copy imports its own combat/events.ts and flow/run.ts. Only the copy in the combat graph ever emits.
 * Every copy registers what it imported; the plugin subscribes to all of them and adopts the `run` of whichever
 * copy actually delivered combat events.
 */
interface Bridge { id: number; on?: (l: Listener) => () => void; run: typeof run; live: boolean }
const bridges: Bridge[] = ((globalThis as { __inkVfxBridges?: Bridge[] }).__inkVfxBridges ??= []);
if (!bridges.some((b) => b.run === run)) bridges.push({ id: bridges.length,
  on: (combatEvents as unknown as { onCombatEvent?: (l: Listener) => () => void }).onCombatEvent, run, live: false });
/** The live game state: the run object from the copy that emitted, else this copy's import. */
function liveRun(): typeof run { return bridges.find((b) => b.live)?.run ?? run; }

/** Combat broadcast (onCombatEvent) from every module copy; new copies are picked up on `poll()`. */
function subscribeCombat(listener: Listener): { off(): void; poll(): void } {
  previewListeners.add(listener);
  const offs = new Map<Bridge, () => void>();
  const poll = () => {
    for (const b of bridges) if (b.on && !offs.has(b))
      offs.set(b, b.on((event) => { if (!b.live) { for (const o of bridges) o.live = o === b; } listener(event); }));
  };
  poll();
  return { poll, off() { previewListeners.delete(listener); for (const off of offs.values()) off(); offs.clear(); } };
}

/** Read-only evidence counters (per realm). Never read by gameplay. */
export interface VfxStats { events: Record<string, number>; frames: number; updateMs: number[]; peakEffects: number; peakParticles: number; peakMeshes: number; dropped: number; player?: [number, number]; foes?: Record<string, [number, number, number]>; hex?: string; run?: { phase: string; hex: string | null; nonce: number; same: boolean; bridges: number; live: number } }
const stats: VfxStats = ((globalThis as { __inkVfxStats?: VfxStats }).__inkVfxStats ??= { events: {}, frames: 0, updateMs: [], peakEffects: 0, peakParticles: 0, peakMeshes: 0, dropped: 0 });

export interface VfxFeed {
  subscribe(listener: Listener): () => void;
  /** Called every frame; lets the feed attach late module copies. */
  poll?(): void;
  read(): Presentation;
  /** Optional clock override (evidence preview): maps frame delta to VFX delta. */
  delta?(frameDelta: number): number;
}

/** Starts the VFX timeline + renderer on a World. Returns the cleanup. */
export async function startVfx(world: World, assets: AssetRegistry, feed: VfxFeed, systemName = 'inkblade-vfx') {
  const pulses: { kind: PresentationKind; start: number; end: number }[] = [];
  let clock = 0, ema = 0;
  const timeline = new VfxTimeline((r: PresentationRequest) => {
    const start = clock + (r.delay ?? 0); pulses.push({ kind: r.kind, start, end: start + r.seconds });
  });
  let epoch = feed.read().epoch;
  const snapshot = () => { const s = feed.read(); if (s.epoch !== epoch) { timeline.reset(); pulses.length = 0; epoch = s.epoch; } return s; };
  const renderer = await createVfxRenderer(world, assets);
  const mine: Signals = { desaturate: 0, hidePlayer: 0, swordGlow: 0, transition: 0 };
  sources.add(mine);
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = feed.subscribe(event => {
      if ((globalThis as { __inkVfxOff?: boolean }).__inkVfxOff) return; // perf baseline switch (evidence only)
      if (!feed.delta) {
        stats.events[event.kind] = (stats.events[event.kind] ?? 0) + 1;
        // Last known foe positions (evidence driver aims with these): [x, z, clock].
        const foes = (stats.foes ??= {});
        if (event.kind === 'enemyTelegraph') foes[String(event.enemy)] = [event.x, event.z, clock];
        else if (event.kind === 'kill') delete foes[String(event.enemy)];
        else if (event.kind === 'hit' && event.source !== 'enemy') foes[`hit`] = [event.x, event.z, clock];
      }
      timeline.handle(event, snapshot());
    });
    world.addSystem(Update, { name: systemName, after: ['inkblade-combat'], queries: [], fn: () => {
      const t0 = performance.now();
      feed.poll?.();
      const raw = world.getResource(Time).delta;
      const dt = feed.delta ? feed.delta(raw) : raw;
      clock += dt;
      timeline.tick(dt, snapshot());
      renderer.update(timeline.effects);
      mine.desaturate = mine.hidePlayer = mine.swordGlow = mine.transition = 0;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]!;
        if (clock >= p.end) { pulses.splice(i, 1); continue; }
        if (clock < p.start) continue;
        if (p.kind === 'transition') continue; // read from the timeline below (exact curve, not a pulse)
        const key = p.kind === 'desaturate' ? 'desaturate' : p.kind === 'hide-player' ? 'hidePlayer' : 'swordGlow';
        // Short in/out ramps so post-processing never pops.
        const k = Math.min(1, (clock - p.start) / .03, (p.end - clock) / .05);
        mine[key] = Math.max(mine[key], k);
      }
      // 千刃：held desaturation between ultStart and ultEnd; 转场墨晕 cover for an optional UI/post layer.
      mine.desaturate = Math.max(mine.desaturate, timeline.ultLevel);
      mine.hidePlayer = Math.max(mine.hidePlayer, timeline.ultHidden);
      mine.transition = timeline.transitionLevel;
      publish();
      // V003-8: adaptive burst quality from the VFX update cost (EMA): > 2.5 ms → fewer particles, < 1.5 ms → recover.
      const cost = performance.now() - t0;
      ema = ema * .95 + cost * .05;
      timeline.quality = ema > 2.5 ? Math.max(.5, timeline.quality - .02) : ema < 1.5 ? Math.min(1, timeline.quality + .01) : timeline.quality;
      if (!feed.delta) {
        const fx = timeline.effects; let pts = 0; for (const e of fx) if (e.geometry === 'points') pts++;
        stats.frames++; stats.hex = timeline.inferredHex; stats.peakEffects = Math.max(stats.peakEffects, fx.length); stats.peakParticles = Math.max(stats.peakParticles, pts);
        stats.peakMeshes = Math.max(stats.peakMeshes, fx.length - pts); stats.dropped = timeline.dropped;
        stats.updateMs.push(performance.now() - t0); if (stats.updateMs.length > 4000) stats.updateMs.splice(0, 2000);
      }
    } }).unwrap();
  } catch (error) { unsubscribe?.(); sources.delete(mine); renderer.dispose(); throw error; }
  return {
    timeline, renderer,
    dispose() {
      unsubscribe?.(); world.removeSystem(Update, systemName).unwrap();
      timeline.reset(); renderer.dispose(); sources.delete(mine); publish();
    },
  };
}

/** World matrix (column-major) → camera position, forward (−Z) and rotation quaternion. */
export function cameraPose(m: ArrayLike<number>): CameraPose {
  const col = (i: number) => { const v = [m[i]!, m[i + 1]!, m[i + 2]!]; const n = Math.hypot(...v) || 1; return v.map(x => x / n) as [number, number, number]; };
  const [r, u, b] = [col(0), col(4), col(8)];
  const tr = r[0] + u[1] + b[2];
  let q: [number, number, number, number];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(u[2] - b[1]) / s, (b[0] - r[2]) / s, (r[1] - u[0]) / s, s / 4]; }
  else if (r[0] > u[1] && r[0] > b[2]) { const s = Math.sqrt(1 + r[0] - u[1] - b[2]) * 2; q = [s / 4, (u[0] + r[1]) / s, (b[0] + r[2]) / s, (u[2] - b[1]) / s]; }
  else if (u[1] > b[2]) { const s = Math.sqrt(1 + u[1] - r[0] - b[2]) * 2; q = [(u[0] + r[1]) / s, s / 4, (b[1] + u[2]) / s, (b[0] - r[2]) / s]; }
  else { const s = Math.sqrt(1 + b[2] - r[0] - u[1]) * 2; q = [(b[0] + r[2]) / s, (b[1] + u[2]) / s, s / 4, (r[1] - u[0]) / s]; }
  return { pos: [m[12]!, m[13]!, m[14]!], forward: [-b[0], -b[1], -b[2]], quat: q, fovY: OBLIQUE_FOV, aspect: 16 / 9 };
}

/** Mounted as a child of plugin/scene (interface request B). Only subscribes; never writes combat state. */
export const vfx: Plugin = {
  name: 'inkblade/vfx', inject: ['world', 'assets', 'gameScene'],
  async apply(ctx) {
    const world = ctx.world, assets = ctx.assets;
    if (!assets) throw new Error('inkblade/vfx requires AssetRegistry');
    const player = resolveGameEntity(world, ctx.gameScene, 'player');
    let camera: ReturnType<typeof resolveGameEntity> | undefined;
    try { camera = resolveGameEntity(world, ctx.gameScene, 'camera'); } catch { camera = undefined; }
    const read = (): Presentation => {
      const run = liveRun();
      const m = readPresentationWorldMatrix(world, player);
      const p: Vec = [m?.[12] ?? 0, .8, m?.[14] ?? 0];
      stats.player = [p[0], p[2]];
      stats.run = { phase: run.phase, hex: run.hex, nonce: run.nonce, same: run === (globalThis as { __inkRun?: unknown }).__inkRun, bridges: bridges.length, live: bridges.findIndex((b) => b.live) };
      const c = camera === undefined ? undefined : readPresentationWorldMatrix(world, camera);
      const pose = c ? cameraPose(c) : undefined;
      // Read-only debug mirror for the evidence preview (separate module instance in the same realm).
      (globalThis as { __inkVfxCamera?: CameraPose }).__inkVfxCamera = pose;
      return { epoch: run.nonce, player: p, sword: [p[0], 1.6, p[2]], hex: run.hex ?? 'none', rank: run.rank, camera: pose,
        foes: (run as { spots?: readonly (readonly number[])[] }).spots };
    };
    await ctx.effect(async function* () {
      let sub: ReturnType<typeof subscribeCombat> | undefined;
      const running = await startVfx(world, assets, {
        subscribe: (l) => { sub = subscribeCombat(l); return () => sub?.off(); },
        poll: () => sub?.poll(), read });
      yield () => running.dispose();
    });
  },
};

export default definePack({schemaVersion:'2.0.0',plugins:true,packageId:VFX_PACKAGE_ID,
  build:()=>{
    const payload:Record<string,MaterialAsset>={};
    for(const key of Object.keys(VFX_TEXTURES) as TextureKey[])if(key!=='noise')payload[materialKey(key)]=createVfxMaterial(key);
    for(const key of ['fan','ring','line'] as TextureKey[])payload[materialKey(key,false,true)]=createVfxMaterial(key,false,true);
    for(const key of ['splat-00','spark-01','spark-02','spark-03','mist-03'] as TextureKey[])payload[materialKey(key,true)]=createVfxMaterial(key,true);
    for(const key of OVERLAY_KEYS)payload[materialKey(key,false,false,true)]=createVfxMaterial(key,false,false,true);
    return ok({...payload,'plugin/vfx':{kind:'plugin' as const,module:{specifier:'./vfx.pack.ts',export:'vfx'}}});
  },
});
