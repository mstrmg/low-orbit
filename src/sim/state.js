// Game state shape + factory. The state is plain data: it survives
// JSON.stringify / JSON.parse unchanged. No classes, no Three.js objects.

import { ALERTS, HEAT, LOSE, ORBIT, POWER } from '../config/balance.js';
import { MODULES } from '../data/modules.js';
import { orbitAt } from './orbit.js';
import { add, scale } from './vec.js';

export const HUB_ID = 1;
/** Marker in the priority list. Modules listed after it never draw on the batteries. */
export const BATTERY_CUTOFF = 0;

export function createInitialState() {
  const state = {
    version: 1,
    tick: 0, // ticks since start
    time: ORBIT.START_TIME_S, // s game time
    orbit: orbitAt(ORBIT.START_TIME_S),
    nextId: 1,
    nameCounts: {}, // type -> how many have been built (for names)
    modules: [],
    priority: [BATTERY_CUTOFF], // ids of power consumers, highest priority first, plus the battery cutoff marker
    power: { supply: 0, demand: 0, batteryDemand: 0, load: 0, net: 0, stored: 0, capacity: 0, shedCount: 0 }, // kW, kJ
    heat: { generated: 0, solar: 0, removed: 0, hottestId: HUB_ID, maxTemp: HEAT.START_TEMP }, // heat units/s, degrees
    research: 0, // research data points
    coreReserveS: LOSE.CORE_BLACKOUT_ORBITS * ORBIT.PERIOD_S, // s of hub blackout left before the station is lost
    alerts: [], // { id, time, level: 'info'|'warn'|'bad'|'good', text }
    alertTimes: {}, // alert key -> game time it was last shown
    nextAlertId: 1,
    gameOver: null, // { reason, title, text, time, orbit }
  };
  addModule(state, 'hub', { parentId: null, cell: [0, 0, 0], axis: [0, 0, 1], facing: null });
  return state;
}

/** Append a module to the state. Callers (build.js) check the placement first. */
export function addModule(state, type, { parentId, cell, axis, facing }) {
  const spec = MODULES[type];
  const count = (state.nameCounts[type] = (state.nameCounts[type] ?? 0) + 1);
  const module = {
    id: state.nextId++,
    type,
    name: type === 'hub' ? spec.name : `${spec.short} ${count}`,
    parentId, // id of the module this one is attached to (null for the hub)
    cell, // grid cell of the module's first cell
    axis, // unit grid direction the module extends along, away from its parent
    facing, // wings only: unit direction the flat face points
    temp: HEAT.START_TEMP, // degrees
    powered: !spec.draw, // consumers start unpowered until the power system runs
    overheated: false, // shut down by heat until it cools below WARN_TEMP
    restartIn: 0, // s before an unpowered consumer retries
    onBattery: true, // consumers: above the battery cutoff in the priority list
    hot: false, // at or above WARN_TEMP
    // Readouts refreshed every tick (for the UI; not inputs to the next tick):
    powerOut: 0, // kW produced (solar)
    sunFacing: 0, // 0..1 how squarely a solar wing faces the sun
    efficiency: 0, // 0..1 radiator efficiency from its angle to the sun
    heatMade: 0, // heat units/s made by running
    heatIn: 0, // heat units/s this module is generating or absorbing
    heatOut: 0, // heat units/s a radiator is removing
    output: 0, // 0..1 how well the module is doing its job
  };
  if (spec.capacity) {
    module.charge = spec.capacity * POWER.NEW_BATTERY_CHARGE; // kJ
    module.flow = 0; // kW into (+) or out of (−) this battery
  }
  state.modules.push(module);
  // New consumers join just above the battery cutoff: lowest priority, but allowed to use batteries.
  if (spec.draw) state.priority.splice(state.priority.indexOf(BATTERY_CUTOFF), 0, module.id);
  return module;
}

export const getModule = (state, id) => state.modules.find((m) => m.id === id);
export const getHub = (state) => state.modules[0];
export const specOf = (module) => MODULES[module.type];

/** Grid cells a module occupies. */
export function moduleCells(module) {
  const cells = [];
  for (let i = 0; i < specOf(module).cells; i++) cells.push(add(module.cell, scale(module.axis, i)));
  return cells;
}

export const heatCapacity = (module) => specOf(module).mass * HEAT.CAPACITY_PER_MASS; // heat units per degree

/** 'overheated' | 'unpowered' | 'warn' | 'ok' — one word for how a module is doing. */
export function moduleStatus(module) {
  if (module.overheated) return 'overheated';
  if (specOf(module).draw && !module.powered) return 'unpowered';
  if (module.temp >= HEAT.WARN_TEMP) return 'warn';
  return 'ok';
}

/**
 * Add a line to the alert log. `key` stops the same alert repeating within
 * ALERTS.REPEAT_GAP_S; pass a unique key to always show it.
 */
export function pushAlert(state, level, text, key = text) {
  const last = state.alertTimes[key];
  if (last !== undefined && state.time - last < ALERTS.REPEAT_GAP_S) return;
  state.alertTimes[key] = state.time;
  state.alerts.push({ id: state.nextAlertId++, time: state.time, level, text });
  if (state.alerts.length > ALERTS.KEEP) state.alerts.splice(0, state.alerts.length - ALERTS.KEEP);
}
