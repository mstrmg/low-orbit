// Not a test: prints how a few stations fare, to sanity-check balance.js.
// Run with: node test/balance-check.mjs
import { createInitialState } from '../src/sim/state.js';
import { placeModule, placementsFor } from '../src/sim/build.js';
import { runFor } from '../src/sim/step.js';

function build(state, type, pick = () => true, facing) {
  const p = placementsFor(state, type).find(pick);
  const r = placeModule(state, type, { ...p, facing });
  if (!r.ok) throw new Error(r.reason);
  return r.module;
}
const onAxis = (a) => (p) => p.axis.join() === a.join();
function report(label, state, orbits) {
  for (let o = 1; o <= orbits && !state.gameOver; o++) {
    runFor(state, 90);
    const temps = state.modules.map((m) => `${m.name.split(' ')[0][0]}${Math.round(m.temp)}`).join(' ');
    console.log(`${label} orbit ${o}: reserve ${state.coreReserveS.toFixed(0)}s research ${state.research.toFixed(0)} stored ${state.power.stored.toFixed(0)} | ${temps}`);
  }
  if (state.gameOver) console.log(`  LOST at ${state.gameOver.time.toFixed(0)}s (orbit ${state.gameOver.orbit}): ${state.gameOver.text}`);
  const alerts = state.alerts.slice(-4).map((a) => `   [${a.time.toFixed(0)}s ${a.level}] ${a.text}`).join('\n');
  console.log(alerts);
}

let s = createInitialState();
report('hub only', s, 3);

s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
report('solar, no battery', s, 9);

s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
build(s, 'battery', onAxis([0, -1, 0]));
report('solar+battery, no radiator', s, 14);

s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
build(s, 'battery', onAxis([0, -1, 0]));
build(s, 'radiator', onAxis([0, 1, 0]));
report('starter', s, 10);

s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
build(s, 'battery', onAxis([0, -1, 0]));
build(s, 'radiator', onAxis([0, 1, 0]));
build(s, 'lab', onAxis([0, 0, 1]));
report('starter+lab', s, 10);

s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
build(s, 'battery', onAxis([0, -1, 0]));
build(s, 'radiator', onAxis([0, 1, 0]));
const lab = build(s, 'lab', onAxis([0, 0, 1]));
build(s, 'solar', (p) => p.parentId === lab.id && p.axis[0] === 1);
build(s, 'solar', (p) => p.parentId === lab.id && p.axis[0] === -1);
build(s, 'radiator', (p) => p.parentId === lab.id && p.axis[1] === 1);
build(s, 'battery', (p) => p.parentId === lab.id && p.axis[2] === 1);
build(s, 'battery', (p) => p.axis[2] === 1);
report('grown', s, 12);

import { movePriority } from '../src/sim/build.js';
s = createInitialState();
build(s, 'solar', onAxis([1, 0, 0]));
build(s, 'solar', onAxis([-1, 0, 0]));
build(s, 'battery', onAxis([0, -1, 0]));
build(s, 'radiator', onAxis([0, 1, 0]));
const lab2 = build(s, 'lab', onAxis([0, 0, 1]));
movePriority(s, lab2.id, 1);
report('starter+lab below cutoff', s, 10);
console.log(s.priority);
