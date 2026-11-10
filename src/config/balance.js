// Every tunable number in the game lives here, with its unit.
// Units: seconds (game time), kW (power), kJ (stored energy = kW x s),
// "heat units" (heat), degrees (temperature), mass units (kg-ish).

export const SIM = {
  TICKS_PER_SECOND: 10, // ticks per game second (fixed step)
  MAX_TICKS_PER_FRAME: 60, // ticks; cap so a slow frame can't spiral
};

export const ORBIT = {
  PERIOD_S: 90, // s, one full lap around the planet
  SUNLIT_S: 55, // s of each orbit in sunlight (the rest, 35 s, is eclipse)
  TRANSITION_S: 3, // s, sunlight fades in after sunrise and out before sunset
  START_TIME_S: 6, // s, the game starts just after sunrise
};

export const POWER = {
  RESTART_DELAY_S: 5, // s a module waits after losing power before it retries
  NEW_BATTERY_CHARGE: 0, // fraction (0-1) of capacity a newly built battery holds
  CHARGING_THRESHOLD_KW: 0.05, // kW flowing in above which a battery counts as "charging"
};

export const HEAT = {
  START_TEMP: 20, // degrees, temperature of the hub at start and of new modules
  CAPACITY_PER_MASS: 2, // heat units needed to warm 1 mass unit by 1 degree
  SOLAR_HEATING: 0.5, // heat units/s the sun adds to each module in full sunlight
  CONDUCTION: 0.3, // heat units/s per degree of difference across one connection
  WARN_TEMP: 60, // degrees; above this a module works at reduced output
  MAX_TEMP: 90, // degrees; at this a module shuts down
  OUTPUT_AT_MAX: 0.5, // fraction of output left just below MAX_TEMP
  RADIATOR_SUN_FACING_EFFICIENCY: 0.2, // fraction of rated cooling when face-on to the sun
  RADIATOR_ZERO_TEMP: 0, // degrees; a radiator this cold removes nothing
  RADIATOR_RATED_TEMP: 40, // degrees; a radiator this warm removes its rated heat
  RADIATOR_MAX_BOOST: 1.5, // x rated; ceiling on how much a hot radiator removes
};

export const LOSE = {
  CORE_BLACKOUT_ORBITS: 2, // orbits of hub blackout the core reserve covers
  RESERVE_RECOVERY_RATE: 0.25, // s of reserve regained per s the hub runs
};

export const RESEARCH = {
  POINTS_PER_S: 1, // research data per second from one lab at full output
};

export const ALERTS = {
  REPEAT_GAP_S: 30, // s before the same alert may be shown again
  KEEP: 40, // number of alerts kept in the log
};
