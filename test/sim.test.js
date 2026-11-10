import test from 'node:test';
import assert from 'node:assert/strict';

import { HEAT, LOSE, ORBIT } from '../src/config/balance.js';
import { MODULES } from '../src/data/modules.js';
import {
  attachmentPoints,
  canRemove,
  movePriority,
  placeModule,
  placementsFor,
  removeModule,
  rotateFacing,
} from '../src/sim/build.js';
import { distributeHeat, outputFactorAt, radiatorEfficiency } from '../src/sim/heat.js';
import { orbitAt, transitionsBetween } from '../src/sim/orbit.js';
import { BATTERY_CUTOFF, createInitialState, getHub, heatCapacity } from '../src/sim/state.js';
import { runFor, stepSimulation, SYSTEMS } from '../src/sim/step.js';

/** Run until the game clock reads `time` seconds. */
const runTo = (state, time) => runFor(state, time - state.time);

const onAxis = (...axis) => (p) => p.axis.join() === axis.join();

function build(state, type, pick = () => true, facing) {
  const point = placementsFor(state, type).find(pick);
  assert.ok(point, `no free attachment point for ${type}`);
  const result = placeModule(state, type, { ...point, facing });
  assert.ok(result.ok, result.reason);
  return result.module;
}

/** Hub + two zenith-facing solar wings + batteries + one radiator. */
function starterStation(batteries = 2) {
  const state = createInitialState();
  build(state, 'solar', onAxis(1, 0, 0));
  build(state, 'solar', onAxis(-1, 0, 0));
  let last = build(state, 'battery', onAxis(0, -1, 0));
  for (let i = 1; i < batteries; i++) last = build(state, 'battery', (p) => p.parentId === last.id);
  build(state, 'radiator', onAxis(0, 1, 0));
  return state;
}

test('orbit: 55 s sunlit then 35 s eclipse, repeating every 90 s', () => {
  assert.equal(ORBIT.PERIOD_S, 90);
  assert.equal(orbitAt(10).sunlit, true);
  assert.equal(orbitAt(54.9).sunlit, true);
  assert.equal(orbitAt(55).sunlit, false);
  assert.equal(orbitAt(89.9).sunlit, false);
  assert.equal(orbitAt(90).sunlit, true);
  assert.equal(orbitAt(90).number, 2);
  assert.equal(orbitAt(70).sunFactor, 0);
  assert.equal(orbitAt(27.5).sunFactor, 1);
});

test('orbit: sun is overhead at local noon and below the horizon in eclipse', () => {
  const noon = orbitAt(ORBIT.SUNLIT_S / 2).sunDir;
  assert.ok(Math.abs(noon[0]) < 1e-9 && Math.abs(noon[1] - 1) < 1e-9);
  assert.ok(orbitAt(1).sunDir[0] < 0, 'rises on the −X side');
  assert.ok(orbitAt(54).sunDir[0] > 0, 'sets on the +X side');
  assert.ok(orbitAt(72.5).sunDir[1] < -0.99, 'opposite the zenith mid-eclipse');
  for (const t of [0, 13, 40, 77]) assert.equal(orbitAt(t).sunDir[2], 0);
});

test('orbit: upcoming sunrises and sunsets can be read ahead', () => {
  const list = transitionsBetween(10, 190);
  assert.deepEqual(
    list.map((t) => [t.time, t.kind]),
    [[55, 'sunset'], [90, 'sunrise'], [145, 'sunset'], [180, 'sunrise']],
  );
});

test('systems run in the fixed order from the brief', () => {
  assert.deepEqual(
    SYSTEMS.map((f) => f.name),
    ['advanceOrbit', 'updatePower', 'updateHeat', 'updateAltitude', 'updateDocking', 'updateCrew', 'updateContracts', 'updateEvents'],
  );
});

test('state is plain JSON and the sim is deterministic across a save', () => {
  const a = starterStation();
  build(a, 'lab', onAxis(0, 0, 1));
  runFor(a, 130);
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(b, a);
  runFor(a, 200);
  runFor(b, 200);
  assert.deepEqual(b, a);
});

test('building: hub offers 6 attachment points and modules snap to them', () => {
  const state = createInitialState();
  assert.equal(attachmentPoints(state).length, 6);
  const wing = build(state, 'solar', onAxis(1, 0, 0));
  assert.deepEqual(wing.cell, [1, 0, 0]);
  assert.deepEqual(wing.facing, [0, 1, 0]);
  assert.equal(attachmentPoints(state).length, 5);
  const bad = placeModule(state, 'solar', { parentId: 1, cell: [5, 5, 5], axis: [1, 0, 0] });
  assert.equal(bad.ok, false);
});

test('building: nothing can overlap', () => {
  const state = createInitialState();
  const lab = build(state, 'lab', onAxis(1, 0, 0)); // cells (1,0,0) and (2,0,0)
  build(state, 'battery', onAxis(0, 1, 0)); // cell (0,1,0), port toward (0,2,0)
  build(state, 'solar', (p) => p.parentId === lab.id && p.axis[1] === 1); // (2,1,0)…(2,3,0)
  const cells = new Set();
  for (const m of state.modules) {
    for (let i = 0; i < MODULES[m.type].cells; i++) {
      const c = m.cell.map((v, k) => v + m.axis[k] * i).join();
      assert.ok(!cells.has(c), `cell ${c} used twice`);
      cells.add(c);
    }
  }
  // A lab going −X from the lab's +Y side port would run back through occupied cells.
  const blocked = placementsFor(state, 'solar').filter((p) => p.cell.join() === '0,2,0' && p.axis.join() === '1,0,0');
  assert.equal(blocked.length, 0);
});

test('building: only leaf modules can be removed, never the hub', () => {
  const state = createInitialState();
  const lab = build(state, 'lab', onAxis(1, 0, 0));
  const wing = build(state, 'radiator', (p) => p.parentId === lab.id);
  assert.equal(canRemove(state, 1).ok, false);
  assert.equal(canRemove(state, lab.id).ok, false);
  assert.equal(removeModule(state, wing.id).ok, true);
  assert.equal(removeModule(state, lab.id).ok, true);
  assert.deepEqual(state.priority, [1, BATTERY_CUTOFF]);
});

test('building: turning a wing cycles through its four facings', () => {
  const state = createInitialState();
  const wing = build(state, 'solar', onAxis(1, 0, 0));
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    seen.add(wing.facing.join());
    rotateFacing(state, wing.id);
  }
  assert.equal(seen.size, 4);
  assert.deepEqual(wing.facing, [0, 1, 0]);
});

test('power: solar output follows the sun-facing factor and stops in eclipse', () => {
  const state = createInitialState();
  const up = build(state, 'solar', onAxis(1, 0, 0), [0, 1, 0]);
  const side = build(state, 'solar', onAxis(-1, 0, 0), [0, 0, 1]);
  runTo(state, ORBIT.SUNLIT_S / 2);
  assert.ok(Math.abs(up.powerOut - 8) < 0.01, `noon output ${up.powerOut}`);
  assert.equal(side.powerOut, 0, 'a wing facing along the orbit axis never sees the sun');
  runFor(state, 40);
  assert.equal(state.orbit.sunlit, false);
  assert.equal(up.powerOut, 0);
});

test('power: a zenith-facing fixed wing averages roughly half its rating while sunlit', () => {
  const state = createInitialState();
  const wing = build(state, 'solar', onAxis(1, 0, 0), [0, 1, 0]);
  let sum = 0;
  runTo(state, ORBIT.PERIOD_S);
  for (let i = 0; i < ORBIT.SUNLIT_S * 10; i++) {
    stepSimulation(state);
    sum += wing.powerOut;
  }
  const average = sum / (ORBIT.SUNLIT_S * 10) / MODULES.solar.solar;
  assert.ok(average > 0.45 && average < 0.6, `average ${average}`);
});

test('power: batteries charge in sunlight and drain in eclipse', () => {
  const state = starterStation(2);
  runTo(state, ORBIT.SUNLIT_S - 8);
  const charged = state.power.stored;
  assert.ok(charged > 150, `stored ${charged} kJ before sunset`);
  runFor(state, 30);
  assert.equal(state.orbit.sunlit, false);
  assert.ok(state.power.stored < charged - 40, 'drained during eclipse');
  assert.equal(getHub(state).powered, true);
});

test('power: when short, modules shut down from the lowest priority up', () => {
  const state = createInitialState();
  build(state, 'solar', onAxis(1, 0, 0), [0, 1, 0]);
  build(state, 'solar', onAxis(-1, 0, 0), [0, 1, 0]); // 16 kW at noon
  const labA = build(state, 'lab', onAxis(0, 0, 1));
  const labB = build(state, 'lab', onAxis(0, 0, -1));
  const labC = build(state, 'lab', onAxis(0, 1, 0));
  // Demand: hub 2 + three labs at 6 = 20 kW against 16 kW at best.
  runTo(state, ORBIT.SUNLIT_S / 2);
  assert.deepEqual([getHub(state).powered, labA.powered, labB.powered, labC.powered], [true, true, true, false]);
  assert.equal(state.power.load, 14);
  assert.equal(state.power.shedCount, 1);

  // Put lab C above lab B: now B is the one shed, and the alert says why.
  movePriority(state, labC.id, -1);
  runFor(state, 5.5);
  assert.deepEqual([labA.powered, labB.powered, labC.powered], [true, false, true]);
  assert.ok(state.alerts.some((a) => a.text.startsWith('Lab 2 lost power: solar is making')));
});

test('power: modules below the battery cutoff run on sunlight only', () => {
  const state = starterStation(2);
  const lab = build(state, 'lab', onAxis(0, 0, 1));
  build(state, 'solar', (p) => p.parentId === lab.id && p.axis[0] === 1);
  build(state, 'solar', (p) => p.parentId === lab.id && p.axis[0] === -1);
  assert.equal(movePriority(state, lab.id, 1).ok, true);
  assert.equal(state.priority.at(-1), lab.id);
  runTo(state, ORBIT.SUNLIT_S / 2);
  assert.equal(lab.powered, true, 'runs at noon');
  runFor(state, 45);
  assert.equal(state.orbit.sunlit, false);
  assert.equal(lab.powered, false, 'off in eclipse');
  assert.equal(getHub(state).powered, true, 'hub still on batteries');
  assert.ok(state.power.stored > 0);
});

test('heat: radiator efficiency depends on which way it faces', () => {
  const noon = orbitAt(ORBIT.SUNLIT_S / 2);
  const eclipse = orbitAt(70);
  assert.ok(Math.abs(radiatorEfficiency([0, 1, 0], noon) - HEAT.RADIATOR_SUN_FACING_EFFICIENCY) < 1e-9, 'face-on: about 20%');
  assert.ok(Math.abs(radiatorEfficiency([0, -1, 0], noon) - HEAT.RADIATOR_SUN_FACING_EFFICIENCY) < 1e-9, 'either face counts');
  assert.equal(radiatorEfficiency([0, 0, 1], noon), 1, 'edge-on: 100%');
  assert.equal(radiatorEfficiency([0, 1, 0], eclipse), 1, 'no sun in eclipse');
});

test('heat: coolant loops even out neighbours without creating or losing heat', () => {
  const state = createInitialState();
  const lab = build(state, 'lab', onAxis(1, 0, 0));
  const hub = getHub(state);
  lab.temp = 80;
  hub.temp = 20;
  const total = () => state.modules.reduce((sum, m) => sum + m.temp * heatCapacity(m), 0);
  const before = total();
  for (let i = 0; i < 50; i++) distributeHeat(state, 0.1);
  assert.ok(Math.abs(total() - before) < 1e-6);
  assert.ok(lab.temp < 80 && hub.temp > 20 && lab.temp > hub.temp);
  for (let i = 0; i < 20000; i++) distributeHeat(state, 0.1);
  assert.ok(Math.abs(lab.temp - hub.temp) < 0.01);
});

test('heat: output falls above warn and a module shuts down at max', () => {
  assert.equal(outputFactorAt(HEAT.WARN_TEMP - 1), 1);
  assert.ok(Math.abs(outputFactorAt((HEAT.WARN_TEMP + HEAT.MAX_TEMP) / 2) - 0.75) < 1e-9);

  const state = starterStation(2);
  const lab = build(state, 'lab', onAxis(0, 0, 1));
  lab.temp = HEAT.MAX_TEMP + 5;
  stepSimulation(state);
  assert.equal(lab.overheated, true);
  stepSimulation(state);
  assert.equal(lab.powered, false);
  assert.ok(state.alerts.some((a) => a.level === 'bad' && a.text.includes('Lab 1 overheated')));
  lab.temp = HEAT.WARN_TEMP - 1;
  stepSimulation(state);
  assert.equal(lab.overheated, false, 'restarts once back below warn');
});

test('heat: an overheat alert names a sun-facing radiator as the cause', () => {
  const state = createInitialState();
  build(state, 'solar', onAxis(1, 0, 0));
  build(state, 'solar', onAxis(-1, 0, 0));
  const radiator = build(state, 'radiator', onAxis(0, 0, 1), [0, 1, 0]); // faces the noon sun
  runTo(state, ORBIT.SUNLIT_S / 2);
  assert.ok(radiator.efficiency < 0.25);
  getHub(state).temp = HEAT.MAX_TEMP + 1;
  stepSimulation(state);
  const alert = state.alerts.find((a) => a.text.includes('Core hub overheated'));
  assert.ok(alert, 'overheat alert');
  assert.match(alert.text, /Radiator 1 is facing the sun \(\d+% efficiency\)/);
});

test('heat: a station with no radiator overheats; one with a radiator settles', () => {
  const hot = starterStation(2);
  removeModule(hot, hot.modules.find((m) => m.type === 'radiator').id);
  runFor(hot, 90 * 16);
  assert.ok(hot.heat.maxTemp >= HEAT.MAX_TEMP - 1 || hot.gameOver, `no radiator: ${hot.heat.maxTemp}`);

  const cool = starterStation(2);
  runFor(cool, 90 * 16);
  assert.equal(cool.gameOver, null);
  assert.ok(cool.heat.maxTemp < HEAT.WARN_TEMP, `with radiator: ${cool.heat.maxTemp}`);
});

test('lose: a bare hub is lost after exactly 2 orbits without power', () => {
  const state = createInitialState();
  runFor(state, LOSE.CORE_BLACKOUT_ORBITS * ORBIT.PERIOD_S - 1);
  assert.equal(state.gameOver, null);
  runFor(state, 2);
  assert.equal(state.gameOver.reason, 'core-blackout');
  assert.match(state.gameOver.text, /no solar wings/);
  const tick = state.tick;
  runFor(state, 10);
  assert.equal(state.tick, tick, 'the sim stops once the game is over');
});

test('lose: solar wings without batteries lose to repeated eclipse blackouts', () => {
  const state = createInitialState();
  build(state, 'solar', onAxis(1, 0, 0));
  build(state, 'solar', onAxis(-1, 0, 0));
  runFor(state, 90 * 12);
  assert.ok(state.gameOver, 'lost');
  assert.ok(state.gameOver.orbit >= 4, `lasted until orbit ${state.gameOver.orbit}`);
  assert.match(state.gameOver.text, /no battery bank/);
});

test('survive: a small sensible station gets through many eclipses', () => {
  const state = starterStation(2);
  runFor(state, 90 * 20);
  assert.equal(state.gameOver, null);
  assert.ok(state.coreReserveS > 170);
});

test('research: a lab earns data only while powered', () => {
  const state = starterStation(2);
  const lab = build(state, 'lab', onAxis(0, 0, 1));
  runTo(state, 90);
  assert.ok(state.research > 10);
  assert.ok(state.research < 90);
  assert.ok(lab.temp > HEAT.START_TEMP);
});
