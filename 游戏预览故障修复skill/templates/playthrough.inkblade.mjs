/**
 * Official smoke playthrough (C013-6): real keys from the title to a first kill.
 * Intro plates and dialogue advance only on a key, so the script presses Enter through them.
 *
 *   pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json
 */
const read = { read: 'ink-run' };

/** Press Enter until the run leaves the intro plates and any held dialogue line. */
async function advanceStory(play, state, until) {
  for (let i = 0; i < 40 && !until(state); i += 1) {
    if (state.phase === 'lines' || state.holdLine) await play.keyboard.press('Enter');
    state = await play.advance(0.3, read);
  }
  return state;
}

export default async function playthrough(play) {
  let state = await play.advance(0.4, read);
  if (state.phase !== 'title') throw new Error(`expected the title: ${JSON.stringify(state)}`);
  await play.screenshot('title');

  await play.step('enter the court', () => play.keyboard.press('Enter'));
  state = await play.advance(0.6, read);
  if (state.phase === 'title') throw new Error(`worker stayed on title: ${JSON.stringify(state)}`);
  state = await advanceStory(play, state, (s) => s.phase !== 'lines');
  if (state.phase !== 'hex') throw new Error(`intro plates did not lead to the hex pick: ${JSON.stringify(state)}`);
  await play.screenshot('hex');

  await play.step('pick 墨锋', async () => {
    await play.keyboard.press('Digit1');
    await play.keyboard.press('Digit1');
  });
  state = await play.advance(0.4, read);
  if (state.phase !== 'fight' || state.hex !== 'ink') throw new Error(`hex pick failed: ${JSON.stringify(state)}`);

  await play.keyboard.press('F2');
  let fight = state;
  for (let i = 0; i < 40 && fight.kills < 1; i += 1) {
    fight = await advanceStory(play, fight, (s) => !s.holdLine);
    await play.mouse.click([0.5, 0.42]);
    await play.keyboard.press('KeyQ');
    fight = await play.advance(0.4, read);
  }
  if (fight.kills < 1) throw new Error(`no kill: ${JSON.stringify(fight)}`);
  fight = await advanceStory(play, fight, (s) => !s.holdLine);
  await play.screenshot('fight');
  return fight;
}
