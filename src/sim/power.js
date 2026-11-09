// Power: solar supply, the priority list, batteries, and the core reserve.

import { LOSE, ORBIT, POWER } from '../config/balance.js';
import { outputFactorAt, explainOverheat } from './heat.js';
import { BATTERY_CUTOFF, getHub, getModule, pushAlert, specOf } from './state.js';
import { dot } from './vec.js';

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** System: work out who gets power this tick. */
export function updatePower(state, dt) {
  const supply = collectSolarPower(state);
  const { load, demand, batteryDemand, shedCount } = allocateByPriority(state, supply, dt);
  const { stored, capacity } = settleBatteries(state, supply - load, dt);
  state.power = { supply, demand, batteryDemand, load, net: supply - load, stored, capacity, shedCount };
  warnOfEclipseShortfall(state);
  drainCoreReserve(state, dt);
}

/** Solar output = base x sun-facing factor x sunlight x temperature factor. Returns total kW. */
export function collectSolarPower(state) {
  let supply = 0;
  for (const m of state.modules) {
    const spec = specOf(m);
    if (!spec.solar) continue;
    m.sunFacing = Math.max(0, dot(m.facing, state.orbit.sunDir));
    m.output = m.overheated ? 0 : m.sunFacing * state.orbit.sunFactor * outputFactorAt(m.temp);
    m.powerOut = spec.solar * m.output;
    supply += m.powerOut;
  }
  return supply;
}

const usableBatteries = (state) => state.modules.filter((m) => specOf(m).capacity && !m.overheated);

/**
 * Hand out power down the priority list. When demand is higher than supply,
 * modules shut down from the lowest priority up. Modules above the battery
 * cutoff may run on solar plus batteries; modules below it only ever run on
 * solar power that the modules above them have left over.
 */
export function allocateByPriority(state, supply, dt) {
  const batteryKJ = usableBatteries(state).reduce((sum, b) => sum + b.charge, 0);
  const available = supply + batteryKJ / dt; // kW that could be delivered this tick

  const wanting = [];
  let demand = 0; // kW every working consumer would like
  let batteryDemand = 0; // kW of that from modules allowed to use batteries
  let aboveCutoff = true;
  for (const id of state.priority) {
    if (id === BATTERY_CUTOFF) {
      aboveCutoff = false;
      continue;
    }
    const m = getModule(state, id);
    m.onBattery = aboveCutoff;
    if (m.overheated) {
      m.powered = false;
      continue;
    }
    demand += specOf(m).draw;
    if (aboveCutoff) batteryDemand += specOf(m).draw;
    if (m.restartIn > 0) {
      m.restartIn = Math.max(0, m.restartIn - dt);
      m.powered = false;
      continue;
    }
    wanting.push(m);
  }

  let load = 0;
  let running = 0;
  let cut = false; // once one module is shed, everything below it is too
  for (const m of wanting) {
    const draw = specOf(m).draw;
    const limit = m.onBattery ? available : supply;
    if (!cut && load + draw <= limit + 1e-9) {
      load += draw;
      running += 1;
      m.powered = true;
      continue;
    }
    cut = true;
    if (m.powered) announcePowerLoss(state, m, { supply, batteryKJ, demand: state.orbit.sunlit ? demand : batteryDemand });
    m.powered = false;
    m.restartIn = POWER.RESTART_DELAY_S;
  }

  const consumers = state.priority.length - 1;
  return { load, demand, batteryDemand, shedCount: consumers - running };
}

function announcePowerLoss(state, m, { supply, batteryKJ, demand }) {
  if (!m.onBattery && !state.orbit.sunlit) {
    pushAlert(state, 'info', `${m.name} switched off for the eclipse (it is below the battery cutoff).`, `shed:${m.id}`);
    return;
  }
  const why = state.orbit.sunlit ? `solar is making ${fmt(supply)} kW` : 'the station is in eclipse';
  const stored = !m.onBattery
    ? 'it is below the battery cutoff'
    : batteryKJ < 0.5
      ? 'batteries are empty'
      : `batteries hold ${fmt(batteryKJ)} kJ`;
  pushAlert(
    state,
    m === getHub(state) ? 'bad' : 'warn',
    `${m.name} lost power: ${why} and ${stored}, against ${fmt(demand)} kW of demand.`,
    `shed:${m.id}`,
  );
}

/** Put surplus power into the batteries, or take the shortfall out of them. */
export function settleBatteries(state, netKW, dt) {
  const batteries = usableBatteries(state);
  for (const m of state.modules) if (specOf(m).capacity) m.flow = 0;

  if (netKW > 0) {
    let energy = netKW * dt; // kJ to store
    for (let pass = 0; pass < 4 && energy > 1e-9; pass++) {
      const open = batteries.filter((b) => b.charge < specOf(b).capacity - 1e-9);
      if (!open.length) break;
      const share = energy / open.length;
      for (const b of open) {
        const taken = Math.min(share, specOf(b).capacity - b.charge);
        b.charge += taken;
        b.flow += taken / dt;
        energy -= taken;
      }
    }
  } else if (netKW < 0) {
    const total = batteries.reduce((sum, b) => sum + b.charge, 0);
    const energy = Math.min(-netKW * dt, total); // kJ to take out
    for (const b of batteries) {
      const taken = total > 0 ? (energy * b.charge) / total : 0;
      b.charge = Math.max(0, b.charge - taken);
      b.flow -= taken / dt;
    }
  }

  let stored = 0;
  let capacity = 0;
  for (const m of state.modules) {
    const spec = specOf(m);
    if (!spec.capacity) continue;
    stored += m.charge;
    capacity += spec.capacity;
    m.output = m.charge / spec.capacity;
  }
  return { stored, capacity };
}

/** At sunset, say plainly whether the batteries will last the eclipse (pillar 3). */
export function warnOfEclipseShortfall(state) {
  if (!state.orbit.justSet) return;
  const eclipseS = ORBIT.PERIOD_S - ORBIT.SUNLIT_S;
  const { stored, capacity, batteryDemand: demand } = state.power;
  const needed = demand * eclipseS;
  const key = `eclipse:${state.orbit.number}`;
  if (capacity === 0) {
    pushAlert(state, 'warn', `Eclipse. No battery bank: everything goes dark for ${eclipseS} s.`, key);
  } else if (demand === 0) {
    pushAlert(state, 'info', 'Eclipse. Nothing is set to run on batteries.', key);
  } else if (stored < needed) {
    const lasts = demand > 0 ? stored / demand : eclipseS;
    pushAlert(
      state,
      'warn',
      `Eclipse. Batteries hold ${fmt(stored)} kJ; ${fmt(demand)} kW for ${eclipseS} s needs ${fmt(needed)} kJ. ` +
        `Full load lasts about ${Math.round(lasts)} s, then low priorities shut down.`,
      key,
    );
  } else {
    pushAlert(state, 'info', `Eclipse. Batteries hold ${fmt(stored)} kJ, enough for ${eclipseS} s at ${fmt(demand)} kW.`, key);
  }
}

/**
 * Lose condition: the hub's reserve covers 2 orbits without power. It drains
 * while the hub is dark (no power, or shut down by heat) and refills slowly
 * while the hub runs.
 */
export function drainCoreReserve(state, dt) {
  const hub = getHub(state);
  const full = LOSE.CORE_BLACKOUT_ORBITS * ORBIT.PERIOD_S;
  if (hub.powered) {
    state.coreReserveS = Math.min(full, state.coreReserveS + LOSE.RESERVE_RECOVERY_RATE * dt);
    return;
  }
  state.coreReserveS = Math.max(0, state.coreReserveS - dt);
  if (state.coreReserveS <= 0 && !state.gameOver) {
    state.gameOver = {
      reason: 'core-blackout',
      title: 'Station lost',
      text: explainCoreLoss(state),
      time: state.time,
      orbit: state.orbit.number,
      research: state.research,
    };
  }
}

/** Why the hub went dark for good, in plain words (pillar 4). */
export function explainCoreLoss(state) {
  const hub = getHub(state);
  const lead = `The core hub went without power for the equivalent of ${LOSE.CORE_BLACKOUT_ORBITS} full orbits.`;
  if (hub.overheated) {
    return `${lead} It overheated at ${Math.round(hub.temp)}° and never cooled enough to restart. ${explainOverheat(state, hub)}`;
  }
  const solar = state.modules.filter((m) => specOf(m).solar);
  if (!solar.length) return `${lead} The station has no solar wings, so nothing was making power.`;
  const eclipseS = ORBIT.PERIOD_S - ORBIT.SUNLIT_S;
  const rank = state.priority.filter((id) => id !== BATTERY_CUTOFF).indexOf(hub.id) + 1;
  const rankNote = !hub.onBattery
    ? ' The hub is below the battery cutoff, so it never ran on batteries.'
    : rank > 1
      ? ` The hub is number ${rank} in the priority list, so modules above it were fed first.`
      : '';
  if (state.power.capacity === 0) {
    return `${lead} There are solar wings but no battery bank, so the hub went dark every eclipse until its reserve ran out.${rankNote}`;
  }
  const dead = solar.every((m) => m.overheated || Math.abs(m.facing[2]) === 1);
  if (dead) return `${lead} No solar wing was making power: wings facing along the orbit's axis (±Z) never see the sun, and overheated wings shut down.${rankNote}`;
  return (
    `${lead} The batteries hold ${fmt(state.power.capacity)} kJ, but the modules above the battery cutoff ask for ${fmt(state.power.batteryDemand)} kW, ` +
    `which needs ${fmt(state.power.batteryDemand * eclipseS)} kJ to cross a ${eclipseS} s eclipse, and the solar wings could not refill them in time.${rankNote}`
  );
}
