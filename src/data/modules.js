// Module definitions (brief section 5).
// draw: kW used while powered.        solar: kW made in full, face-on sunlight.
// heat: heat units/s made while powered. cooling: heat units/s removed (rated).
// capacity: kJ stored.                chargeHeat: heat units/s while charging.
// mass: mass units.                   cells: grid cells occupied, in a line.
// ports: where other modules can attach ('end', 'sides', 'back').
// wing: a flat panel with a facing the player chooses.

export const MODULES = {
  hub: {
    name: 'Core hub',
    short: 'Hub',
    draw: 2,
    heat: 2,
    mass: 10,
    cells: 1,
    ports: ['end', 'back', 'sides'],
    buildable: false,
    purpose: 'The heart of the station. If it stays dark, the station is lost.',
  },
  solar: {
    name: 'Solar wing',
    short: 'Solar',
    solar: 8,
    heat: 0,
    mass: 3,
    cells: 3,
    ports: [],
    wing: true,
    buildable: true,
    hotkey: 'z',
    purpose: 'Makes power in sunlight. Face it at the sun.',
  },
  battery: {
    name: 'Battery bank',
    short: 'Battery',
    capacity: 100,
    chargeHeat: 1,
    heat: 0,
    mass: 5,
    cells: 1,
    ports: ['end'],
    buildable: true,
    hotkey: 'x',
    purpose: 'Stores power for the eclipse.',
  },
  radiator: {
    name: 'Radiator wing',
    short: 'Radiator',
    draw: 1,
    cooling: 6,
    heat: 0,
    mass: 3,
    cells: 2,
    ports: [],
    wing: true,
    overheatImmune: true,
    buildable: true,
    hotkey: 'c',
    purpose: 'Sheds heat. Keep it edge-on to the sun.',
  },
  lab: {
    name: 'Research lab',
    short: 'Lab',
    draw: 6,
    heat: 5,
    mass: 10,
    cells: 2,
    ports: ['end', 'sides'],
    buildable: true,
    hotkey: 'v',
    purpose: 'Produces research data while powered and cool.',
  },
};

export const BUILD_ORDER = ['solar', 'battery', 'radiator', 'lab'];
