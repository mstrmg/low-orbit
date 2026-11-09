// Heat: modules warm up while they run, the sun warms everything, radiators
// shed heat depending on which way they face, and coolant loops even out
// temperatures between connected modules.

import { HEAT, POWER } from '../config/balance.js';
import { getModule, heatCapacity, pushAlert, specOf } from './state.js';
import { dot } from './vec.js';

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** 1 below WARN_TEMP, falling in a straight line to OUTPUT_AT_MAX at MAX_TEMP. */
export function outputFactorAt(temp) {
  const { WARN_TEMP, MAX_TEMP, OUTPUT_AT_MAX } = HEAT;
  if (temp <= WARN_TEMP) return 1;
  const t = Math.min(1, (temp - WARN_TEMP) / (MAX_TEMP - WARN_TEMP));
  return 1 - t * (1 - OUTPUT_AT_MAX);
}

/** A radiator works fully edge-on to the sun (or in eclipse), and at 20% face-on. */
export function radiatorEfficiency(facing, orbit) {
  const exposure = Math.abs(dot(facing, orbit.sunDir)) * orbit.sunFactor;
  return 1 - exposure * (1 - HEAT.RADIATOR_SUN_FACING_EFFICIENCY);
}

/** A warm radiator sheds more: 0 at ZERO_TEMP, 1 at RATED_TEMP, capped at MAX_BOOST. */
export function radiatorTempFactor(temp) {
  const { RADIATOR_ZERO_TEMP, RADIATOR_RATED_TEMP, RADIATOR_MAX_BOOST } = HEAT;
  const t = (temp - RADIATOR_ZERO_TEMP) / (RADIATOR_RATED_TEMP - RADIATOR_ZERO_TEMP);
  return Math.max(0, Math.min(RADIATOR_MAX_BOOST, t));
}

/** System: one tick of heat. */
export function updateHeat(state, dt) {
  generateHeat(state);
  radiateHeat(state);
  for (const m of state.modules) m.temp += ((m.heatIn - m.heatOut) * dt) / heatCapacity(m);
  distributeHeat(state, dt);
  summariseHeat(state);
  checkTemperatureLimits(state);
}

/** Heat made by running modules and charging batteries, plus sunlight on everything. */
export function generateHeat(state) {
  const solarHeat = HEAT.SOLAR_HEATING * state.orbit.sunFactor;
  for (const m of state.modules) {
    const spec = specOf(m);
    let made = 0;
    if (spec.draw && m.powered) made += spec.heat;
    if (spec.chargeHeat && m.flow > POWER.CHARGING_THRESHOLD_KW) made += spec.chargeHeat;
    m.heatMade = made; // heat units/s from running
    m.heatIn = made + solarHeat; // heat units/s in total
  }
}

/** Powered radiators shed heat according to their angle to the sun and their temperature. */
export function radiateHeat(state) {
  for (const m of state.modules) {
    const spec = specOf(m);
    m.heatOut = 0;
    if (!spec.cooling) continue;
    m.efficiency = radiatorEfficiency(m.facing, state.orbit);
    m.output = m.powered ? m.efficiency * radiatorTempFactor(m.temp) : 0;
    m.heatOut = spec.cooling * m.output;
  }
}

/** Coolant loops: each connected pair of modules drifts toward the same temperature. */
export function distributeHeat(state, dt) {
  for (const child of state.modules) {
    if (child.parentId == null) continue;
    const parent = getModule(state, child.parentId);
    const cp = heatCapacity(parent);
    const cc = heatCapacity(child);
    const gap = parent.temp - child.temp;
    const evening = (Math.abs(gap) * cp * cc) / (cp + cc); // heat that would make them equal
    const moved = Math.sign(gap) * Math.min(HEAT.CONDUCTION * Math.abs(gap) * dt, evening);
    parent.temp -= moved / cp;
    child.temp += moved / cc;
  }
}

function summariseHeat(state) {
  let generated = 0;
  let solar = 0;
  let removed = 0;
  let hottest = state.modules[0];
  for (const m of state.modules) {
    generated += m.heatMade;
    solar += m.heatIn - m.heatMade;
    removed += m.heatOut;
    if (m.temp > hottest.temp) hottest = m;
  }
  state.heat = { generated, solar, removed, hottestId: hottest.id, maxTemp: hottest.temp };
}

/** Warn above WARN_TEMP, shut down at MAX_TEMP, restart once back below WARN_TEMP. */
export function checkTemperatureLimits(state) {
  for (const m of state.modules) {
    const spec = specOf(m);
    if (spec.overheatImmune) continue;
    if (!m.overheated && m.temp >= HEAT.MAX_TEMP) {
      m.overheated = true;
      m.powered = false;
      pushAlert(
        state,
        'bad',
        `${m.name} overheated at ${Math.round(m.temp)}° and shut down. ${explainOverheat(state, m)}`,
        `overheat:${m.id}:${state.tick}`,
      );
    } else if (m.overheated && m.temp < HEAT.WARN_TEMP) {
      m.overheated = false;
      pushAlert(state, 'good', `${m.name} cooled to ${Math.round(m.temp)}° and restarted.`, `cooled:${m.id}:${state.tick}`);
    }
    const hot = m.temp >= HEAT.WARN_TEMP;
    if (hot && !m.hot && !m.overheated) {
      pushAlert(
        state,
        'warn',
        `${m.name} is above ${HEAT.WARN_TEMP}° and losing output. ${explainOverheat(state, m)}`,
        `warn:${m.id}`,
      );
    }
    m.hot = hot;
  }
}

/** The most useful single reason a module is too hot (pillar 4). */
export function explainOverheat(state, module) {
  const radiators = state.modules.filter((m) => specOf(m).cooling);
  if (!radiators.length) return 'There are no radiators on the station.';
  const dark = radiators.filter((r) => !r.powered);
  if (dark.length === radiators.length) {
    return `${listNames(dark)} ${dark.length > 1 ? 'have' : 'has'} no power, so nothing is shedding heat.`;
  }
  const sunFacing = radiators
    .filter((r) => r.powered && r.efficiency < 0.6)
    .sort((a, b) => a.efficiency - b.efficiency);
  if (sunFacing.length) {
    const r = sunFacing[0];
    return `${r.name} is facing the sun (${Math.round(r.efficiency * 100)}% efficiency).`;
  }
  const { generated, solar, removed } = state.heat;
  void module;
  return `The station is taking in ${fmt(generated + solar)} heat/s and its radiators are removing ${fmt(removed)}.`;
}

function listNames(modules) {
  const names = modules.map((m) => m.name);
  return names.length > 2 ? `${names.length} radiators` : names.join(' and ');
}
