// Renderer, camera, lights, sky and planet. Reads orbit data; holds no game state.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORBIT } from '../config/balance.js';
import { createPost } from './effects.js';
import { LOOK } from './look.js';
import { createPlanet } from './planet.js';
import { createEnvironment, createSky } from './sky.js';

// Distance from the planet's centre, chosen so the planet's edge hides the sun
// for exactly the eclipse fraction of the orbit: what you see matches the timeline.
const ECLIPSE_HALF_ANGLE = (Math.PI * (ORBIT.PERIOD_S - ORBIT.SUNLIT_S)) / ORBIT.PERIOD_S;
const ORBIT_RADIUS = LOOK.planetRadius / Math.sin(ECLIPSE_HALF_ANGLE);
const MIN_GROUND_CLEARANCE = LOOK.atmosphereHeight + 4; // scene units the camera stays above the ground

// Camera presets (keys 1-4): unit direction from the station to the camera.
const PRESETS = [
  [0.72, 0.4, 0.88], // three-quarter
  [0.05, 1, 0.12], // from above, planet behind
  [0, 0.1, 1], // side-on, along the horizon
  [-1, 0.22, 0.3], // from the sunrise side, looking toward sunset
];

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000002);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 12000);
  camera.position.set(13, 7.5, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 55;
  controls.zoomSpeed = 0.8;

  // --- Lights ---------------------------------------------------------------
  const sunLight = new THREE.DirectionalLight(LOOK.sunColor, LOOK.sunIntensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);

  // Soft light from all around: the dark sky above, the planet below.
  const bounce = new THREE.HemisphereLight(0x0a1020, LOOK.planetShineColor, 0);
  const ambient = new THREE.AmbientLight(LOOK.ambientColor, LOOK.ambientNight);
  // A dim blue lamp that follows the camera, so the station keeps its shape in eclipse.
  const fill = new THREE.DirectionalLight(LOOK.eclipseFillColor, LOOK.eclipseFill);
  scene.add(bounce, ambient, fill, fill.target);

  // --- Sky and planet -------------------------------------------------------
  const planetCenter = new THREE.Vector3(0, -ORBIT_RADIUS, 0);
  const planet = createPlanet(renderer, planetCenter);
  const sky = createSky();
  scene.add(sky.group, planet.group);
  scene.environment = createEnvironment(renderer, ECLIPSE_HALF_ANGLE); // reflections of the planet on shiny parts

  const stationRoot = new THREE.Group();
  stationRoot.name = 'station';
  scene.add(stationRoot);

  const post = createPost(renderer, scene, camera);

  const sunDir = new THREE.Vector3();
  const sunLow = new THREE.Color(LOOK.sunLowColor);
  const sunHigh = new THREE.Color(LOOK.sunColor);
  const shineDay = new THREE.Color(LOOK.planetShineColor);
  const shineDusk = new THREE.Color(0xff8a4a);
  const center = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const fromPlanet = new THREE.Vector3();
  let shadowExtent = 0;
  let cameraTween = null;
  let seconds = 0; // real time, for ambient animation only

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    post.setSize(width, height, renderer.getPixelRatio());
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
    seconds += realDt;
    sunDir.fromArray(orbit.sunDir);
    const f = orbit.sunFactor;
    const warm = f * f * (3 - 2 * f);

    // Sun: fades and reddens through the air at sunrise and sunset.
    sunLight.position.copy(center).addScaledVector(sunDir, 40 + shadowExtent);
    sunLight.target.position.copy(center);
    sunLight.intensity = LOOK.sunIntensity * f;
    sunLight.color.lerpColors(sunLow, sunHigh, warm);

    // Planet shine: strongest at local noon, warm and weak near the day/night line, gone at night.
    const overDay = Math.max(0, Math.cos(orbit.angle));
    const shine = Math.pow(overDay, 0.6);
    bounce.groundColor.lerpColors(shineDusk, shineDay, Math.min(1, overDay * 3));
    bounce.intensity = LOOK.planetShineDay * shine + 0.05 * f;
    scene.environmentIntensity = LOOK.reflections * (0.1 + 0.9 * shine);
    ambient.intensity = THREE.MathUtils.lerp(LOOK.ambientNight, LOOK.ambientDay, f);
    fill.intensity = THREE.MathUtils.lerp(LOOK.eclipseFill, LOOK.eclipseFill * 0.45, f);

    // Eyes adapt a little in the dark.
    renderer.toneMappingExposure = LOOK.exposure * THREE.MathUtils.lerp(1.22, 1.0, f);

    planet.update(sunDir, timeS / ORBIT.PERIOD_S, seconds);

    controls.target.lerp(center, 1 - Math.exp(-realDt * 6));
    if (cameraTween) {
      cameraTween.t = Math.min(1, cameraTween.t + realDt / 0.6);
      const k = cameraTween.t * cameraTween.t * (3 - 2 * cameraTween.t);
      camera.position.lerpVectors(cameraTween.from, cameraTween.to, k);
      if (cameraTween.t >= 1) cameraTween = null;
    }
    controls.update();

    // Never let the camera dip into the atmosphere.
    fromPlanet.subVectors(camera.position, planetCenter);
    const minRadius = LOOK.planetRadius + MIN_GROUND_CLEARANCE;
    if (fromPlanet.length() < minRadius) camera.position.copy(planetCenter).addScaledVector(fromPlanet.normalize(), minRadius);

    // Fill lamp: over the camera's left shoulder.
    offset.set(-0.55, 0.45, 0.7).applyQuaternion(camera.quaternion);
    fill.position.copy(center).addScaledVector(offset, 30);
    fill.target.position.copy(center);

    sky.update(sunDir, orbit.angle, f, sunLight.color, camera, seconds, renderer.getPixelRatio());
    post.update(f);
  }

  const render = () => post.render();
  controls.addEventListener('start', () => (cameraTween = null));

  return { renderer, scene, camera, controls, stationRoot, sunLight, update, render, resize, frameStation, setPreset };
}
