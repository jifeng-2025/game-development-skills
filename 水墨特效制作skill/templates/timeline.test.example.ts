// TEMPLATE: vitest for the timeline (no engine needed). One test per new effect: count, beats, condition.
import { describe, expect, it } from 'vitest';
import { VfxTimeline, type Presentation } from '../timeline.ts';
import { meshNumbers } from '../materials.ts';

const state: Presentation = { epoch: 0, player: [0, .8, 0], sword: [0, 1.6, 0] };

describe('vfx timeline', () => {
  it('never mutates combat events or state', () => {
    const ev = Object.freeze({ kind: 'attack', step: 1, x: 0, z: 0, dirX: 0, dirZ: 1, radius: 2 } as const);
    const t = new VfxTimeline(); t.handle(ev, Object.freeze(state)); t.tick(.016, state);
    expect(ev.radius).toBe(2); expect(t.effects[0]!.role).toBe('attack');
  });
  it('expires everything it creates', () => {
    const t = new VfxTimeline(); t.handle({ kind: 'attack', step: 3, x: 0, z: 0, dirX: 0, dirZ: 1, radius: 2.6 }, state);
    for (let i = 0; i < 600; i++) t.tick(1 / 60, state);
    expect(t.effects).toHaveLength(0); expect(t.dropped).toBe(0);
  });
  it('per-frame material values carry no texture bindings (ForgeaX 0.4.19 republish crash)', () => {
    expect(Object.values(meshNumbers()).some((v) => typeof v === 'object' && v !== null && 'texture' in v)).toBe(false);
  });
});
