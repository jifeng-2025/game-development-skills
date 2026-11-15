/**
 * Deterministic VFX preview harness (dev-only evidence; import via dev eval as /@fs/<abs>/preview.ts).
 * Drives the REAL VFX plugin code with scripted events and an exact frozen clock, so a screenshot lands
 * on the requested beat regardless of browser frame pacing. Used by scripts/capture-preview.sh.
 *
 * Adapt: startVfx import, camera yaw/distance import, Presentation fields, scenario table.
 */
import { startVfx } from './vfx.pack.ts';                       // must accept a feed {subscribe, read, delta}
import { OBLIQUE_DISTANCE, OBLIQUE_YAW } from '../view/oblique.ts'; // camera constants (single source of truth)
import type { Presentation, Vec, VfxEvent } from './timeline.ts';

type Sim = { world: never; assets: never };
type Scheduled = { at: number; event: VfxEvent };
export type Scenario = 'slash' | 'telegraph' | 'bolts';
let active: { dispose(): void } | undefined;

// Screen-up / screen-right on the ground plane for a fixed oblique camera.
const UP = [Math.sin(OBLIQUE_YAW), -Math.cos(OBLIQUE_YAW)] as const, RIGHT = [Math.cos(OBLIQUE_YAW), Math.sin(OBLIQUE_YAW)] as const;
/** Distance the offsets below were authored for; layouts scale when the camera distance changes. */
const AUTHORED_DISTANCE = 22;

function script(s: Scenario, p: Vec): Scheduled[] {
  const k = OBLIQUE_DISTANCE / AUTHORED_DISTANCE;
  const at = (r: number, u: number) => ({ x: p[0] + (RIGHT[0] * r + UP[0] * u) * k, z: p[2] + (RIGHT[1] * r + UP[1] * u) * k });
  const attack = (step: 1 | 2 | 3, r: number, t = 0): Scheduled => ({ at: t, event: { kind: 'attack', step, ...at(r, 0), dirX: UP[0], dirZ: UP[1], radius: step === 3 ? 2.6 : 1.8 } });
  switch (s) {
    case 'slash': return [attack(1, -4.6), attack(2, 0), attack(3, 4.8)];
    case 'telegraph': { const w = at(0, -3); return [{ at: 0, event: { kind: 'enemyTelegraph', phase: 'start', enemy: 0, shape: 'fan', ...w, dirX: -UP[0], dirZ: -UP[1] } }]; }
    case 'bolts': return [-.12, .12].map((o) => ({ at: 0, event: { kind: 'bolt', ...at(0, 0), dirX: UP[0] * Math.cos(o) - UP[1] * Math.sin(o), dirZ: UP[0] * Math.sin(o) + UP[1] * Math.cos(o), speed: 16, life: .45 } }));
  }
}

export async function preview(sim: Sim, opts: { scenario: Scenario; freezeAt: number; player?: Vec }) {
  stopPreview();
  const player: Vec = opts.player ?? [0, .8, 0];
  const listeners = new Set<(e: Readonly<VfxEvent>) => void>();
  // Same-time events fire in AUTHORED order (e.g. kill before refresh, attack before its hit).
  const pending = script(opts.scenario, player).sort((a, b) => a.at - b.at);
  let elapsed = 0;
  const read = (): Presentation => ({ epoch: 'preview', player, sword: [player[0], 1.6, player[2]] });
  const delta = (frame: number) => {
    while (pending.length && pending[0]!.at <= elapsed + 1e-6) { const ev = pending.shift()!.event; for (const l of listeners) l(ev); }
    const step = Math.max(0, Math.min(frame, 1 / 60, opts.freezeAt - elapsed)); // ≤1/60 s per frame, exact stop
    elapsed += step; return step;
  };
  const running = await startVfx(sim.world, sim.assets, { subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); }, read, delta }, 'vfx-preview-run');
  active = { dispose() { running.dispose(); } };
  return { scenario: opts.scenario, freezeAt: opts.freezeAt };
}
export function stopPreview() { active?.dispose(); active = undefined; }
