// Runs the systems in their fixed order, one tick at a time.

import { SIM } from '../config/balance.js';
import { updateAltitude } from './altitude.js';
import { updateContracts } from './contracts.js';
import { updateCrew } from './crew.js';
import { updateDocking } from './docking.js';
import { updateEvents } from './events.js';
import { updateHeat } from './heat.js';
import { advanceOrbit } from './orbit.js';
import { updatePower } from './power.js';

export const TICK_S = 1 / SIM.TICKS_PER_SECOND; // s of game time per tick

// orbit → power → heat → altitude → docking → crew → contracts → events
export const SYSTEMS = [
  advanceOrbit,
  updatePower,
  updateHeat,
  updateAltitude,
  updateDocking,
  updateCrew,
  updateContracts,
  updateEvents,
];

/** Advance the simulation by one tick. Does nothing once the game is over. */
export function stepSimulation(state) {
  if (state.gameOver) return;
  for (const system of SYSTEMS) system(state, TICK_S);
}

/** Advance by a number of game seconds (used by tests and balance checks). */
export function runFor(state, seconds) {
  const ticks = Math.round(seconds * SIM.TICKS_PER_SECOND);
  for (let i = 0; i < ticks && !state.gameOver; i++) stepSimulation(state);
  return state;
}
