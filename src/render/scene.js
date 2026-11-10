// Renderer, camera, lights and the planet. Reads orbit data; holds no game state.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORBIT } from '../config/balance.js';
import { createAtmosphereGlow, createStars, createSun } from './effects.js';
import { createPlanet } from './planet.js';

const PLANET_RADIUS = 1000; // scene units
// Distance from the planet's centre, chosen so the planet's edge hides the sun
// for exactly the eclipse fraction of the orbit.
const ECLIPSE_HALF_ANGLE = (Math.PI * (ORBIT.PERIOD_S - ORBIT.SUNLIT_S)) / ORBIT.PERIOD_S;
const ORBIT_RADIUS = PLANET_RADIUS / Math.sin(ECLIPSE_HALF_ANGLE);
const PLANET_SPIN = 0.05; // extra turn of the ground per orbit, so the ground track drifts
const SUN_DISTANCE = 6000;

// Camera presets (keys 1-4): unit direction from the station to the camera.
const PRESETS = [
  [0.72, 0.4, 0.88], // three-quarter
  [0.05, 1, 0.12], // from above, planet behind
  [0, 0.1, 1], // side-on, along the horizon
  [-1, 0.22, 0.3], // from the sunrise side, looking toward sunset
];

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010207);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 30000);
  camera.position.set(13, 7.5, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 55;

  // --- Lights ---------------------------------------------------------------
  const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);

  const ambient = new THREE.AmbientLight(0x5a78b8, 0.4); // dim blue fill
  const fill = new THREE.DirectionalLight(0x6f8fd0, 0.5); // gives shape in eclipse
  fill.position.set(-0.4, 0.5, 0.75);
  const planetShine = new THREE.DirectionalLight(0x8ab8ff, 0); // light bounced up from the day side
  planetShine.position.set(0, -1, 0);
  scene.add(ambient, fill, planetShine);

  // --- Sky and planet -------------------------------------------------------
  const planetCenter = new THREE.Vector3(0, -ORBIT_RADIUS, 0);
  const planet = createPlanet(PLANET_RADIUS);
  const atmosphere = createAtmosphereGlow(PLANET_RADIUS);
  const planetPivot = new THREE.Group(); // turns the ground under the station
  planetPivot.position.copy(planetCenter);
  planetPivot.add(planet.mesh);
  atmosphere.mesh.position.copy(planetCenter);
  const stars = createStars(20000);
  const sun = createSun(SUN_DISTANCE);
  scene.add(planetPivot, atmosphere.mesh, stars, sun.group);

  const stationRoot = new THREE.Group();
  stationRoot.name = 'station';
  scene.add(stationRoot);

  const sunDir = new THREE.Vector3();
  const sunWarm = new THREE.Color(0xff8a3c);
  const sunWhite = new THREE.Color(0xfff1dc);
  const center = new THREE.Vector3();
  let shadowExtent = 0;
  let cameraTween = null;

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /** Fit the shadow box and camera target to the station. bounds: { center: Vector3, radius }. */
  function frameStation(bounds) {
    center.copy(bounds.center);
    const extent = bounds.radius + 2;
    if (extent !== shadowExtent) {
      shadowExtent = extent;
      const cam = sunLight.shadow.camera;
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.near = 1;
      cam.far = 60 + extent * 2;
      cam.updateProjectionMatrix();
    }
  }

  /** Jump (smoothly) to camera preset 0-3. */
  function setPreset(index, radius = 6) {
    const dir = new THREE.Vector3(...PRESETS[index]).normalize();
    const distance = THREE.MathUtils.clamp(radius * 2.4 + 8, 14, controls.maxDistance);
    cameraTween = { from: camera.position.clone(), to: center.clone().addScaledVector(dir, distance), t: 0 };
  }

  /**
   * orbit: result of orbitAt(renderTime). timeS: game time for slow drifts.
   * realDt: seconds since last frame.
   */
  function update(orbit, timeS, realDt) {
    sunDir.fromArray(orbit.sunDir);
    const f = orbit.sunFactor;

    sunLight.position.copy(center).addScaledVector(sunDir, 40 + shadowExtent);
    sunLight.target.position.copy(center);
    sunLight.intensity = 3.2 * f;
    sunLight.color.lerpColors(sunWarm, sunWhite, f * f);
    ambient.intensity = THREE.MathUtils.lerp(0.55, 0.3, f);
    fill.intensity = THREE.MathUtils.lerp(0.7, 0.25, f);
    planetShine.intensity = 0.9 * Math.max(0, Math.cos(orbit.angle)) ** 0.6 * (orbit.sunlit ? 1 : 0);

    const turns = timeS / ORBIT.PERIOD_S; // orbits flown
    planetPivot.rotation.z = -orbit.angle - turns * Math.PI * 2 * PLANET_SPIN;
    stars.rotation.z = -orbit.angle;
    stars.material.opacity = THREE.MathUtils.lerp(1, 0.35, f);
    planet.uniforms.uSunDir.value.copy(sunDir);
    planet.uniforms.uTime.value = timeS;
    atmosphere.uniforms.uSunDir.value.copy(sunDir);
    sun.update(sunDir, f, orbit.sunlit);

    controls.target.lerp(center, 1 - Math.exp(-realDt * 6));
    if (cameraTween) {
      cameraTween.t = Math.min(1, cameraTween.t + realDt / 0.6);
      const k = cameraTween.t * cameraTween.t * (3 - 2 * cameraTween.t);
      camera.position.lerpVectors(cameraTween.from, cameraTween.to, k);
      if (cameraTween.t >= 1) cameraTween = null;
    }
    controls.update();
  }

  const render = () => renderer.render(scene, camera);
  controls.addEventListener('start', () => (cameraTween = null));

  return { renderer, scene, camera, controls, stationRoot, sunLight, update, render, resize, frameStation, setPreset };
}
