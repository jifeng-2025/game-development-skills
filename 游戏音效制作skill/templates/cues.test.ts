// TEMPLATE (游戏音效制作skill) — copy to <game>/assets/audio/__tests__/cues.test.ts and adapt the event literals.
import { describe, expect, it } from 'vitest';
import { CLIPS, type SoundName } from '../clips.ts';
import { combatCues, createUiCues, E_LAND_DELAY, SOUNDS } from '../cues.ts';

const names = (list: readonly { sound: SoundName }[]) => list.map((c) => c.sound);

describe('AU001 audio cues', () => {
  it('every sound has clips and a spec', () => {
    for (const name of Object.keys(SOUNDS) as SoundName[]) expect(CLIPS[name].length).toBeGreaterThan(0);
    expect(Object.keys(SOUNDS).sort()).toEqual(Object.keys(CLIPS).sort());
  });

  it('maps the combat events', () => {
    expect(names(combatCues({ kind: 'attack', step: 3, x: 0, z: 0, dirX: 0, dirZ: 1, radius: 1 }))).toEqual(['slash-3']);
    expect(names(combatCues({ kind: 'hit', crit: true, x: 0, z: 0, source: 'attack' }))).toEqual(['hit-crit']);
    expect(names(combatCues({ kind: 'hit', crit: false, x: 0, z: 0, source: 'enemy' }))).toEqual([]);
    expect(names(combatCues({ kind: 'kill', x: 0, z: 0, source: 'q', enemy: 1, heavy: true }))).toEqual(['kill-ink-heavy']);
    const e = combatCues({ kind: 'skillCast', skill: 'e', fromX: 0, fromZ: 0, toX: 1, toZ: 1 });
    expect(names(e)).toEqual(['e-windup', 'e-land']);
    expect(e[1]?.delay).toBe(E_LAND_DELAY);
    expect(names(combatCues({ kind: 'skillCast', skill: 'ult', fromX: 0, fromZ: 0, toX: 0, toZ: 0 }))).toEqual([]);
    expect(names(combatCues({ kind: 'ultStart' }))).toEqual(['ult-start']);
    expect(names(combatCues({ kind: 'enemyTelegraph', phase: 'end', enemy: 0, x: 0, z: 0, dirX: 0, dirZ: 1 }))).toEqual([]);
    expect(names(combatCues({ kind: 'roomExit', phase: 'seal', x: 0, z: 0 }))).toEqual(['room-seal']);
  });

  it('derives UI edges from phase and presses', () => {
    const ui = createUiCues();
    const none = () => false;
    const key = (code: string) => (c: string) => c === code;
    expect(names(ui({ phase: 'title', settings: false, pressed: none }))).toEqual([]);
    expect(names(ui({ phase: 'title', settings: false, pressed: key('KeyS') }))).toEqual(['ui-move']);
    expect(names(ui({ phase: 'lines', settings: false, pressed: none }))).toEqual(['ui-confirm']);
    expect(names(ui({ phase: 'hex', settings: false, pressed: key('Digit2') }))).toEqual(['ui-hex-select']);
    expect(names(ui({ phase: 'hex', settings: false, pressed: key('Digit2') }))).toEqual([]);
    expect(names(ui({ phase: 'fight', settings: false, pressed: none }))).toEqual(['ui-hex-confirm']);
  });
});
