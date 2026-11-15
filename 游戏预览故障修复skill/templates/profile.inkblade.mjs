/**
 * Profile for 墨刃 / inkblade (ForgeaX 0.4.19). Copy and rewrite this file for another game:
 * readState / sendCommand run INSIDE the page (no closures over this module); modes run in Node with ctx.
 *
 * Page hooks this game exposes (presentation realm):
 *   globalThis.__inkView  — latest run snapshot posted from the engine worker (phase, room, wave, hp, x, z, …)
 *   globalThis.__inkSend  — post a flow command to the worker: {t:'auto',on}, {t:'god',on}, {t:'restart'}, …
 * Keys: Enter advances intro plates / dialogue; Digit1-3 arm then confirm a hex card; F2 god mode; F4 jump to boss;
 *       Esc pause. Combat aiming uses the game's own `auto` command; walking, dialogue and picks are real input.
 */
const EXITS = [[0, -2.15], [0, 60.5], [0, -59]]; // courtyard → corridor → inner court (inner exit unused)
const HEX_PHASES = ['hex', 'hexMid', 'hex2'];

export default {
  readState: () => {
    const v = globalThis.__inkView;
    return v ? { phase: v.phase, room: v.room, wave: v.wave, hp: v.hp, kills: v.kills, x: v.x, z: v.z, line: v.line,
      holdLine: v.holdLine, exitOpen: v.exitOpen, transition: v.transition, endingStep: v.endingStep, paused: v.paused,
      subtitle: v.subtitle, bannerLife: v.bannerLife, bossHp: v.bossHp, bossMax: v.bossMax, hex: v.hex, auto: v.auto, god: v.god } : null;
  },
  sendCommand: (cmd) => globalThis.__inkSend?.(cmd),
  position: (s) => [s.x, s.z],
  failurePattern: 'AppError|app-system-update-failed|Unable to start the game',
  warningPattern: '\\[inkblade\\]',
  /** Called while waiting: push dialogue forward (click on the ending so Enter never restarts the run). */
  answer: async (ctx, s) => {
    if (s.phase === 'ending' && s.holdLine) {
      // Click the dialogue box (viewport-relative: centre, 90 % down); Enter on the last line would restart.
      const vp = ctx.page.viewportSize() ?? { width: 1280, height: 720 };
      await ctx.click(vp.width / 2, vp.height * 0.9, 90);
    }
    else if (s.phase === 'lines' || s.holdLine) await ctx.tap('Enter');
  },

  modes: {
    /** Smallest smoke: title → plates → hex pick (FIX_HEX=mouse|keys, FIX_CARD=0..2) → in a fight. */
    start: async (ctx) => {
      await toFight(ctx);
      await ctx.shot('fight', 300);
      return await ctx.state();
    },
    /** Q001/F001 style: reach room FIX_ROOM (default 1) and stay FIX_HOLD seconds (default 15) without an error page. */
    hold: async (ctx) => {
      const room = Number(ctx.env.FIX_ROOM ?? 1);
      const holdS = Number(ctx.env.FIX_HOLD ?? 15);
      await toFight(ctx);
      await helpers(ctx);
      while ((await ctx.state()).room < room) await clearAndExit(ctx);
      await ctx.until((s) => s.room === room && s.transition <= 0, 20_000, `room ${room}`);
      const end = Date.now() + holdS * 1000;
      while (Date.now() < end) {
        if (await ctx.failure()) throw new Error('error page while holding');
        const s = await ctx.state();
        if (s.holdLine) await ctx.tap('Enter');
        await ctx.sleep(250);
      }
      await ctx.shot(`room${room}-held`);
      return { room, held: holdS };
    },
    /**
     * Before/after screens for a fix report (run with FIX_VIEWPORT=1920x1080): one screenshot per problem at the
     * same place as the original evidence, plus a text-layer overlap check on each. Extend the list per task.
     */
    shots: async (ctx) => {
      const layers = ['#ui-teach', '#ui-banner', '#ui-dialog', '#ui-subtitle', '#ui-pause .card'];
      const marks = [];
      const mark = async (name) => {
        await ctx.shot(name, 400);
        const check = await ctx.overlaps(layers, { modal: ['#ui-pause .card', '#ui-settings .card'] });
        marks.push({ name, overlaps: check.pairs, covered: check.covered });
      };
      await toFight(ctx);
      await mark('hud');
      await ctx.tap('Escape');
      await ctx.until((s) => s.paused, 5_000, 'pause', { answer: false });
      await mark('pause');
      await ctx.tap('Escape');
      await helpers(ctx);
      await ctx.tap('F4');
      await ctx.until((s) => s.room === 2 && s.phase === 'fight' && !s.holdLine, 30_000, 'boss fight');
      await mark('boss');
      await ctx.until((s) => s.phase === 'ending' && s.endingStep >= 2, 240_000, 'ending');
      await mark('ending');
      await ctx.tap('Enter');
      await ctx.sleep(1500);
      await mark('after-ending-enter');
      const bad = marks.filter((m) => m.overlaps.length);
      // FIX_OVERLAP=warn records overlaps and finishes the route (use it to collect the whole before-set).
      if (bad.length && ctx.env.FIX_OVERLAP !== 'warn') throw new Error(`text layers overlap: ${JSON.stringify(bad)}`);
      if (bad.length) ctx.record.notes.push({ overlaps: bad });
      return { marks, afterEnding: (await ctx.state())?.phase };
    },
    /** Three rooms to 「第一章 · 完」. */
    full: async (ctx) => {
      await toFight(ctx);
      await helpers(ctx);
      while ((await ctx.state()).room < 2) await clearAndExit(ctx);
      await ctx.until((s) => s.phase === 'ending' && s.endingStep >= 2, 240_000, 'ending');
      await ctx.shot('ending', 600);
      return { ending: ctx.stamp() };
    },
  },
};

async function helpers(ctx) {
  await ctx.tap('F2');
  await ctx.send({ t: 'auto', on: true });
}

/** Title → intro plates (Enter) → hex pick with real input → fight phase. */
async function toFight(ctx) {
  await ctx.until((s) => s.phase === 'title', 30_000, 'title', { answer: false });
  await ctx.shot('title');
  await ctx.tap('Enter');
  await ctx.until((s) => HEX_PHASES.includes(s.phase), 30_000, 'hex pick');
  const probe = await ctx.hitProbe('.ui-hex-card');
  ctx.record.events.push({ hexProbe: probe });
  await ctx.shot('hex');
  const card = Number(ctx.env.FIX_CARD ?? 0);
  if ((ctx.env.FIX_HEX ?? 'mouse') === 'mouse') {
    const { x, y } = probe[card];
    await ctx.page.mouse.move(x, y);
    await ctx.click(x, y);
    await ctx.sleep(250);
    ctx.record.events.push({ armedAfterFirstClick: await ctx.page.evaluate(() => document.querySelector('.ui-hex-card.is-armed')?.getAttribute('data-hex') ?? null) });
    await ctx.click(x, y);
  } else {
    await ctx.tap(`Digit${card + 1}`); await ctx.sleep(250); await ctx.tap(`Digit${card + 1}`);
  }
  await ctx.until((s) => s.phase === 'fight', 15_000, 'fight after pick');
}

/** Let `auto` clear the room, then walk to the exit with auto OFF (auto keeps lunging at its last aim). */
async function clearAndExit(ctx) {
  const start = await ctx.state();
  await ctx.until((s) => s.room !== start.room || (s.phase === 'fight' && s.exitOpen && s.transition <= 0), 120_000, `room ${start.room} cleared`);
  if ((await ctx.state()).room !== start.room) return;
  await ctx.send({ t: 'auto', on: false });
  try {
    const [tx, tz] = EXITS[start.room];
    await ctx.walkTo(tx, tz, (s) => s.room !== start.room || s.transition > 0);
  } finally {
    await ctx.send({ t: 'auto', on: true });
  }
  await ctx.until((s) => s.room !== start.room, 20_000, `left room ${start.room}`);
  await ctx.shot(`room${start.room + 1}`, 300);
}
