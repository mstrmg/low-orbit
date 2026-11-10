// Orbit position, sunlit/eclipse and sun direction.
//
// The station keeps one side toward the planet (−Y is down). In that frame the
// sun circles around the Z axis once per orbit: it rises on the −X side, is
// overhead (+Y) at local noon and sets on the +X side. During the eclipse it is
// behind the planet.

import { ORBIT, SIM } from '../config/balance.js';

/** Everything about the orbit that follows from the game time alone. */
export function orbitAt(timeS) {
  const { PERIOD_S, SUNLIT_S, TRANSITION_S } = ORBIT;
  const number = Math.floor(timeS / PERIOD_S) + 1;
  const phaseS = timeS - (number - 1) * PERIOD_S; // s since this orbit's sunrise
  const sunlit = phaseS < SUNLIT_S;
  const sunFactor = sunlit
    ? Math.max(0, Math.min(1, phaseS / TRANSITION_S, (SUNLIT_S - phaseS) / TRANSITION_S))
    : 0;
  // Angle of the sun from the zenith, radians. 0 at local noon.
  const angle = (2 * Math.PI * (phaseS - SUNLIT_S / 2)) / PERIOD_S;
  return {
    number, // 1-based orbit count
    phaseS, // s since sunrise, 0..PERIOD_S
    sunlit, // true in the sunlit portion
    sunFactor, // 0..1 strength of sunlight (fades at sunrise/sunset)
    angle, // radians from zenith
    sunDir: [Math.sin(angle), Math.cos(angle), 0], // unit vector toward the sun
  };
}

/** System: move the clock one tick and refresh the orbit readout. */
export function advanceOrbit(state, dt) {
  const wasSunlit = state.orbit.sunlit;
  state.tick += 1;
  state.time = ORBIT.START_TIME_S + state.tick / SIM.TICKS_PER_SECOND;
  state.orbit = orbitAt(state.time);
  state.orbit.justSet = wasSunlit && !state.orbit.sunlit; // eclipse began this tick
  state.orbit.justRose = !wasSunlit && state.orbit.sunlit; // sunrise this tick
  void dt;
}

/** Sunrises and sunsets between two game times, in order. */
export function transitionsBetween(fromS, toS) {
  const { PERIOD_S, SUNLIT_S } = ORBIT;
  const list = [];
  for (let k = Math.floor(fromS / PERIOD_S) - 1; k * PERIOD_S <= toS; k++) {
    const rise = k * PERIOD_S;
    const set = rise + SUNLIT_S;
    if (rise >= fromS && rise <= toS) list.push({ time: rise, kind: 'sunrise', orbit: k + 1 });
    if (set >= fromS && set <= toS) list.push({ time: set, kind: 'sunset', orbit: k + 1 });
  }
  return list;
}

/** Seconds until the next sunset (if sunlit) or sunrise (if in eclipse). */
export function secondsToNextTransition(orbit) {
  return orbit.sunlit ? ORBIT.SUNLIT_S - orbit.phaseS : ORBIT.PERIOD_S - orbit.phaseS;
}
