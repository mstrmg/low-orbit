// Visual-only constants. Nothing in here affects the simulation: gameplay
// numbers live in src/config/balance.js. Tune how the game looks here.

export const LOOK = {
  // --- world scale (scene units; one grid cell is 2 units) ---
  planetRadius: 1000, // scene units
  atmosphereHeight: 24, // scene units above the ground where the glow fades out
  groundLapOrbits: 5, // orbits per visible lap of the ground under the station (slower than real, calmer to watch)
  groundTrackTilt: 0.9, // radians; tilts the planet so the station doesn't just follow its equator
  groundDriftOrbits: 37, // orbits for the ground track to drift once around the planet
  cloudDriftOrbits: 90, // orbits for the clouds to lap the ground
  bakeSize: 512, // pixels per face of the baked planet cube map

  // --- light ---
  sunIntensity: 3.3, // directional light strength at local noon
  sunColor: 0xfff3e2,
  sunLowColor: 0xff7636, // sunlight just after sunrise / before sunset
  planetShineDay: 0.4, // light bounced up from the sunlit ground
  reflections: 0.7, // how strongly shiny parts mirror the planet at local noon
  planetShineColor: 0x8fb6ff,
  eclipseFill: 0.55, // dim blue fill so the station stays readable in the dark
  eclipseFillColor: 0x93a8e8,
  ambientDay: 0.16,
  ambientNight: 0.42,
  ambientColor: 0x7d95d6,

  // --- camera / post ---
  maxPixelRatio: 2, // never draw more than this many pixels per CSS pixel
  minFrameRate: 38, // below this for a couple of seconds, the picture drops resolution a step
  exposure: 1.0,
  bloomStrength: 0.42,
  bloomRadius: 0.55,
  bloomThreshold: 0.95,
  sunriseFlash: 0.35, // extra bloom while the sun crosses the planet's edge
  starsInDaylight: 0.3, // star brightness while the sun is up (1 = eclipse)

  // --- heat map (H) ---
  heatStops: [
    [0.0, 0x2447d8], // cold
    [0.35, 0x1fb6c9],
    [0.55, 0x3fd27a],
    [0.67, 0xf2c537], // around the warn temperature
    [0.85, 0xff6a1f],
    [1.0, 0xff2018], // shut-down temperature
  ],
};
