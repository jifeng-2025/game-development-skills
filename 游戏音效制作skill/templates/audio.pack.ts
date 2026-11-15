// TEMPLATE (游戏音效制作skill) — copy to <game>/assets/audio/audio.pack.ts, then replace:
//   __AUDIO_PACKAGE_ID__  a fresh UUIDv7-style package id (also the --ns of synth.mjs)
//   import paths for the game's combat event module and run/flow state (here ../combat/events.ts, ../flow/run.ts)
//   STATS_GLOBAL / BRIDGES_GLOBAL / RUN_GLOBAL names, and the system `after:` names of combat/flow systems.
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import { AudioSource } from '@forgeax/engine/audio';
import { Time, Update, type World } from '@forgeax/engine/ecs';
import { FRAME_START_SCAN_SYSTEM_NAME, INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import * as combatEvents from '../combat/events.ts';
import type { CombatEvent } from '../combat/events.ts';
import { run } from '../flow/run.ts';
import { CLIPS, type SoundName } from './clips.ts';
import { combatCues, createUiCues, SOUNDS, TIER_VOLUME, type Cue } from './cues.ts';

/**
 * AU001 audio plugin (Engine realm). Subscribes to combat events and UI edges and plays one-shot
 * `AudioSource` entities; the Host-owned Web Audio consumer (installed by the ForgeaX bootstrap) does
 * the actual playback. No Web Audio, DOM or gameplay writes here: read-only on events and `run`.
 */
export const AUDIO_PACKAGE_ID = definePackageId('__AUDIO_PACKAGE_ID__');

type Listener = (event: Readonly<CombatEvent>) => void;
type Subscribe = (listener: Listener) => () => void;
type RunLike = { phase: typeof run.phase; settings: boolean; nonce: number };

/** Read-only evidence counters (per realm). Never read by gameplay. */
export interface AudioStats {
  loaded: number;
  failed: string[];
  events: Record<string, number>;
  played: Record<string, number>;
  skipped: Record<string, number>;
  peakVoices: number;
  sources: number;
}
const STATS_GLOBAL = '__inkAudioStats';
const BRIDGES_GLOBAL = '__inkVfxBridges'; // registry where every module copy registers its event subscribe fn + run
const RUN_GLOBAL = '__inkRun';
const G = globalThis as unknown as Record<string, unknown>;
const stats: AudioStats = (G[STATS_GLOBAL] ??= {
  loaded: 0, failed: [], events: {}, played: {}, skipped: {}, peakVoices: 0, sources: 0,
}) as AudioStats;

/**
 * Module-copy bridge (same cause as V003): the plugin loader gives this file its own copy of
 * combat/events.ts and flow/run.ts. Subscribe to every copy the VFX bridge registry knows about plus our
 * own, de-duplicated by subscribe function; the copy that actually emits owns the live `run`.
 */
interface VfxBridge { on?: Subscribe; run: RunLike; live: boolean }
function bridges(): VfxBridge[] { return (G[BRIDGES_GLOBAL] as VfxBridge[] | undefined) ?? []; }
const own: Subscribe | undefined = (combatEvents as unknown as { onCombatEvent?: Subscribe }).onCombatEvent;

function liveRun(): RunLike {
  const all = bridges();
  const live = all.find((b) => b.live)?.run;
  if (live) return live;
  // Stale copies never leave their initial state; any copy that moved is the live one.
  for (const b of all) if (b.run.phase !== 'title' || b.run.nonce !== 0) return b.run;
  const shared = G[RUN_GLOBAL] as RunLike | undefined;
  if (shared && (shared.phase !== 'title' || shared.nonce !== 0)) return shared;
  return run;
}

const MAX_VOICES = 24;

interface Voice { entity: number; sound: SoundName; until: number }

export async function startAudio(world: World, assets: AssetRegistry): Promise<() => void> {
  const parse = (assets as unknown as { parseGuid?: (s: string) => unknown }).parseGuid?.bind(assets);
  const clips = new Map<SoundName, { handle: unknown; seconds: number }[]>();
  const handles: unknown[] = [];
  await Promise.all((Object.keys(CLIPS) as SoundName[]).map(async (name) => {
    const list: { handle: unknown; seconds: number }[] = [];
    for (const clip of CLIPS[name]) {
      const loaded = await assets.load((parse ? parse(clip.guid) : clip.guid) as never, 'audio');
      if (!loaded.ok) { stats.failed.push(`${name}:${loaded.error.code ?? 'error'}`); continue; }
      handles.push(loaded.value);
      list.push({ handle: loaded.value, seconds: clip.seconds });
      stats.loaded += 1;
    }
    clips.set(name, list);
  }));

  let clock = 0;
  let seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const voices: Voice[] = [];
  const lastStart = new Map<SoundName, number>();
  const lastVariant = new Map<SoundName, number>();
  const pending: { at: number; sound: SoundName }[] = [];

  const skip = (sound: SoundName) => { stats.skipped[sound] = (stats.skipped[sound] ?? 0) + 1; };
  const start = (sound: SoundName) => {
    const spec = SOUNDS[sound];
    const variants = clips.get(sound) ?? [];
    if (variants.length === 0) return skip(sound);
    if (clock - (lastStart.get(sound) ?? -1e9) < spec.cooldown) return skip(sound);
    const same = voices.filter((v) => v.sound === sound);
    if (same.length >= spec.voices) stop(same[0]!);
    if (voices.length >= MAX_VOICES) stop(voices[0]!);
    // Avoid repeating the previous variant back to back.
    let index = Math.floor(rand() * variants.length);
    if (variants.length > 1 && index === lastVariant.get(sound)) index = (index + 1) % variants.length;
    const clip = variants[index]!;
    const rate = 1 + (rand() * 2 - 1) * spec.pitch;
    const spawned = world.spawn({
      component: AudioSource,
      data: { clip: clip.handle as never, playing: true, volume: TIER_VOLUME[spec.tier], playbackRate: rate, spatialBlend: 0, bus: 'sfx' },
    });
    if (!spawned.ok) return skip(sound);
    lastStart.set(sound, clock);
    lastVariant.set(sound, index);
    voices.push({ entity: spawned.value as unknown as number, sound, until: clock + clip.seconds / rate + 0.15 });
    stats.played[sound] = (stats.played[sound] ?? 0) + 1;
    stats.peakVoices = Math.max(stats.peakVoices, voices.length);
  };
  function stop(voice: Voice) {
    const i = voices.indexOf(voice);
    if (i >= 0) voices.splice(i, 1);
    world.despawn(voice.entity as never);
  }
  const cue = (cues: readonly Cue[]) => {
    for (const c of cues) {
      if (c.delay) pending.push({ at: clock + c.delay, sound: c.sound });
      else start(c.sound);
    }
  };

  const offs = new Map<Subscribe, () => void>();
  const onEvent: Listener = (event) => {
    stats.events[event.kind] = (stats.events[event.kind] ?? 0) + 1;
    cue(combatCues(event));
  };
  const poll = () => {
    const subs = new Set<Subscribe>();
    if (own) subs.add(own);
    for (const b of bridges()) if (b.on) subs.add(b.on);
    for (const sub of subs) if (!offs.has(sub)) offs.set(sub, sub(onEvent));
  };
  poll();

  const ui = createUiCues();
  world.addSystem(Update, {
    name: 'game-audio',
    after: [FRAME_START_SCAN_SYSTEM_NAME, 'inkblade-combat', 'inkblade-flow'], // ← the game's combat + flow system names
    queries: [],
    fn: () => {
      clock += Math.max(0, Math.min(0.1, world.getResource(Time).delta));
      poll();
      const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
      const state = liveRun();
      cue(ui({ phase: state.phase, settings: state.settings, pressed: (code) => input?.keyboard?.justPressedCode(code) ?? false }));
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (pending[i]!.at <= clock) { const { sound } = pending[i]!; pending.splice(i, 1); start(sound); }
      }
      for (let i = voices.length - 1; i >= 0; i -= 1) if (voices[i]!.until <= clock) stop(voices[i]!);
      stats.sources = voices.length;
    },
  }).unwrap();

  return () => {
    world.removeSystem(Update, 'game-audio').unwrap();
    for (const off of offs.values()) off();
    offs.clear();
    for (const v of voices.splice(0)) world.despawn(v.entity as never);
    for (const h of handles) assets.release(h as never);
  };
}

export const audio: Plugin.Object<{ readonly clips: readonly string[] }> = {
  name: 'game/audio',
  inject: ['world', 'assets'],
  async apply(ctx) {
    const world = ctx.world;
    const assets = ctx.assets as unknown as AssetRegistry | undefined;
    if (!assets) throw new Error('game/audio requires assets');
    await ctx.effect(async function* () {
      try {
        yield await startAudio(world, assets);
      } catch (cause) {
        // Audio must never take the game down: record and stay silent.
        stats.failed.push(`start:${cause instanceof Error ? cause.message : String(cause)}`);
      }
    });
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  plugins: true,
  packageId: AUDIO_PACKAGE_ID,
  build: () => ok({
    'plugin/audio': {
      kind: 'plugin',
      module: { specifier: './audio.pack.ts', export: 'audio' },
      // Asset references put every clip into the persistent definition closure.
      config: { clips: Object.values(CLIPS).flatMap((list) => list.map((clip) => ({ $asset: clip.guid }))) },
    },
  }),
});
