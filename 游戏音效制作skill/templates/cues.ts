// TEMPLATE (游戏音效制作skill) — example cue table from inkblade. Keep the shape (TIER_VOLUME, SOUNDS spec, combatCues,
// createUiCues) and rewrite the event cases / phase names for the new game. Sound names must equal synth.mjs SOUNDS keys.
import type { CombatEvent } from '../combat/events.ts';
import type { Phase } from '../flow/run.ts';
import type { SoundName } from './clips.ts';

/**
 * AU001 cue table: pure mapping from combat events / UI edges to sound names.
 * No Engine or Web Audio types here, so the mapping is unit-testable in isolation.
 */
export type Tier = 'skill' | 'hit' | 'swing' | 'foe' | 'ui';

export interface Cue {
  readonly sound: SoundName;
  /** Seconds after the trigger (E is a teleport: windup and landing share one frame). */
  readonly delay?: number;
}

/** Playback gain per loudness tier (files are already peak-normalized per tier in synth.mjs). */
export const TIER_VOLUME: Readonly<Record<Tier, number>> = { skill: 1, hit: 1, swing: 0.8, foe: 0.8, ui: 0.5 };

export interface SoundSpec {
  readonly tier: Tier;
  /** Minimum seconds between two starts of this sound (anti-stacking). */
  readonly cooldown: number;
  /** Maximum simultaneous voices of this sound. */
  readonly voices: number;
  /** Random playback-rate spread (±), applied on top of the authored variants. */
  readonly pitch: number;
}

const spec = (tier: Tier, cooldown = 0.04, voices = 2, pitch = 0): SoundSpec => ({ tier, cooldown, voices, pitch });

export const SOUNDS: Readonly<Record<SoundName, SoundSpec>> = {
  'slash-1': spec('swing', 0.12, 2, 0.04),
  'slash-2': spec('swing', 0.12, 2, 0.04),
  'slash-3': spec('swing', 0.12, 2, 0.03),
  hit: spec('hit', 0.04, 4, 0.05),
  'hit-crit': spec('hit', 0.04, 3, 0.03),
  dash: spec('swing', 0.08, 2, 0.03),
  'q-thrust': spec('skill', 0.1, 2),
  'e-windup': spec('skill', 0.1, 1),
  'e-land': spec('skill', 0.1, 2),
  'e-refresh': spec('skill', 0.2, 1),
  'ult-start': spec('skill', 0.5, 1),
  'ult-slash': spec('skill', 0.06, 3, 0.06),
  'ult-end': spec('skill', 0.5, 1),
  telegraph: spec('foe', 0.12, 2),
  'kill-ink': spec('foe', 0.05, 3, 0.04),
  'kill-ink-heavy': spec('foe', 0.3, 1),
  'player-hurt': spec('foe', 0.15, 1, 0.03),
  'ui-move': spec('ui', 0.03, 2),
  'ui-confirm': spec('ui', 0.06, 1),
  'ui-hex-select': spec('ui', 0.05, 1),
  'ui-hex-confirm': spec('ui', 0.2, 1),
  'ui-transition': spec('ui', 0.4, 1),
  'room-seal': spec('foe', 0.2, 1),
};

/** E windup plays at the cast frame; the landing hit follows by this much. */
export const E_LAND_DELAY = 0.08;

/** Combat event → cues. Events without a sound (`bolt`, `inkMark`, telegraph end, `skillCast ult`) return []. */
export function combatCues(event: Readonly<CombatEvent>): readonly Cue[] {
  switch (event.kind) {
    case 'attack': return [{ sound: event.step === 3 ? 'slash-3' : event.step === 2 ? 'slash-2' : 'slash-1' }];
    case 'hit': return event.source === 'enemy' ? [] : [{ sound: event.crit ? 'hit-crit' : 'hit' }];
    case 'kill': return [{ sound: event.heavy ? 'kill-ink-heavy' : 'kill-ink' }];
    case 'skillCast':
      if (event.skill === 'dash') return [{ sound: 'dash' }];
      if (event.skill === 'q') return [{ sound: 'q-thrust' }];
      if (event.skill === 'e') return [{ sound: 'e-windup' }, { sound: 'e-land', delay: E_LAND_DELAY }];
      return []; // 'ult' is voiced by ultStart, emitted on the same frame
    case 'eRefresh': return [{ sound: 'e-refresh' }];
    case 'ultStart': return [{ sound: 'ult-start' }];
    case 'ultSlash': return [{ sound: 'ult-slash' }];
    case 'ultEnd': return [{ sound: 'ult-end' }];
    case 'enemyTelegraph': return event.phase === 'start' ? [{ sound: 'telegraph' }] : [];
    case 'playerHurt': return [{ sound: 'player-hurt' }];
    case 'roomExit': return [{ sound: 'room-seal' }];
    case 'roomTransition': return [{ sound: 'ui-transition' }];
    default: return [];
  }
}

export interface UiFrame {
  readonly phase: Phase;
  readonly settings: boolean;
  readonly pressed: (code: string) => boolean;
}

const HEX_PHASES: ReadonlySet<Phase> = new Set(['hex', 'hexMid', 'hex2']);
const MENU_MOVE = ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'];
const DIGITS = ['Digit1', 'Digit2', 'Digit3'];

/**
 * UI edges from the read-only run phase and this frame's key presses.
 * `armed` remembers the pre-selected hex digit so the confirming second press does not also play "select".
 */
export function createUiCues() {
  let last: Phase | undefined;
  let armed = '';
  return (frame: UiFrame): Cue[] => {
    const cues: Cue[] = [];
    const prev = last;
    last = frame.phase;
    if (prev !== undefined && prev !== frame.phase) {
      if (HEX_PHASES.has(prev) && !HEX_PHASES.has(frame.phase)) cues.push({ sound: 'ui-hex-confirm' });
      if (prev === 'title' && !frame.settings) cues.push({ sound: 'ui-confirm' });
      if (!HEX_PHASES.has(frame.phase)) armed = '';
    }
    if (frame.phase === 'title' && !frame.settings && prev === 'title') {
      if (MENU_MOVE.some(frame.pressed)) cues.push({ sound: 'ui-move' });
    }
    if ((frame.phase === 'lines' || frame.phase === 'dead' || frame.phase === 'ending' || frame.phase === 'victory') && frame.pressed('Enter')) {
      cues.push({ sound: 'ui-confirm' });
    }
    // The flow plugin may apply the pick on the same frame, so the press can arrive with the phase already left.
    if (HEX_PHASES.has(frame.phase) || (prev !== undefined && HEX_PHASES.has(prev))) {
      const digit = DIGITS.find(frame.pressed);
      if (digit && digit !== armed) {
        armed = digit;
        cues.push({ sound: 'ui-hex-select' });
      }
    }
    return cues;
  };
}
