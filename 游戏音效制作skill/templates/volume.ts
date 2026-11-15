// TEMPLATE (游戏音效制作skill) — copy to <game>/assets/audio/volume.ts. Replace __inkPrefs with the global the
// settings slider writes (0..1) and __inkAudioHost with the evidence tap name play-audio.mjs reads (AUDIO_HOST_GLOBAL).
// Register from the frontend (host/UI) root plugin's effect:  yield (await import('../audio/volume.ts')).startAudioVolume(ctx.gameHost);
/**
 * AU001 frontend volume bridge (Host realm only). The settings slider in skin-hud writes
 * `globalThis.__inkPrefs.volume` (0..1); this mirrors it onto the Host-owned WebAudioEngine `master` bus.
 * The Engine Worker cannot read DOM prefs, so this small Host-side loop is the only coupling.
 */
interface BusControl {
  setBusVolume(bus: string, volume: number): void;
  getState?(): unknown;
  getActiveSourceCount?(): number;
}
interface HostLike { readonly audio?: BusControl }

export function startAudioVolume(host: HostLike | undefined): () => void {
  if (!host || typeof setInterval !== 'function') return () => undefined;
  const g = globalThis as { __inkPrefs?: { volume: number }; __inkAudioHost?: () => unknown };
  let applied = Number.NaN;
  let engine: BusControl | undefined;
  const sync = () => {
    const current = host.audio;
    if (current !== engine) { engine = current; applied = Number.NaN; }
    if (!engine) return;
    const volume = Math.max(0, Math.min(1, g.__inkPrefs?.volume ?? 0.8));
    if (volume === applied) return;
    engine.setBusVolume('master', volume);
    applied = volume;
  };
  sync();
  const timer = setInterval(sync, 150);
  // Evidence read (playthrough only): Host audio state + applied master volume.
  g.__inkAudioHost = () => ({ master: applied, active: engine?.getActiveSourceCount?.(), state: engine?.getState?.() });
  return () => {
    clearInterval(timer);
    delete g.__inkAudioHost;
  };
}
