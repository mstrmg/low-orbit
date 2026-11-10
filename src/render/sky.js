// Everything far away: star field, a faint galactic band, and the sun disc with its glare.
// Render-only.

import * as THREE from 'three';
import { LOOK } from './look.js';
import { NOISE_GLSL } from './noise.glsl.js';

const SKY_RADIUS = 4200;
const SUN_DISTANCE = 3600;

// Small deterministic RNG so the sky is the same every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStars() {
  const rand = mulberry32(90210);
  const count = 5200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  // the galactic band is tilted against the orbit plane
  const bandNormal = new THREE.Vector3(0.35, 0.55, 0.76).normalize();
  const v = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // rejection-sample so stars crowd toward the band
    for (let tries = 0; tries < 8; tries++) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      v.set(s * Math.cos(phi), u, s * Math.sin(phi));
      const offBand = Math.abs(v.dot(bandNormal));
      if (rand() < 0.35 + 0.65 * Math.exp(-offBand * offBand * 14)) break;
    }
    positions.set([v.x * SKY_RADIUS, v.y * SKY_RADIUS, v.z * SKY_RADIUS], i * 3);
    const mag = Math.pow(rand(), 5.5); // most stars are faint, a few are bright
    sizes[i] = 1.1 + mag * 3.4;
    const warmth = rand();
    tint.setRGB(1, 1, 1);
    if (warmth < 0.22) tint.setRGB(0.72, 0.82, 1.0);
    else if (warmth > 0.82) tint.setRGB(1.0, 0.84, 0.66);
    const b = 0.35 + 0.65 * mag + rand() * 0.25;
    colors.set([tint.r * b, tint.g * b, tint.b * b], i * 3);
    phases[i] = rand() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uBrightness: { value: 1 }, uPixelRatio: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uPixelRatio;
      uniform float uTime;
      varying vec3 vColor;
      void main(){
        vColor = aColor * (0.9 + 0.1 * sin(uTime * 1.3 + aPhase));
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uBrightness;
      varying vec3 vColor;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(vColor * a * a * uBrightness, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'stars';
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}

function createGalaxyBand() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uBrightness: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform float uBrightness;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        vec3 bandNormal = normalize(vec3(0.35, 0.55, 0.76));
        float off = dot(d, bandNormal);
        float band = exp(-off * off * 22.0);
        float clouds = fbm(d * 3.0, 5) * 0.5 + 0.5;
        float dust = smoothstep(0.35, 0.75, fbm(d * 6.0 + 9.0, 5) * 0.5 + 0.5);
        float glow = band * (0.35 + 0.65 * clouds) * (1.0 - dust * 0.6 * band);
        vec3 col = mix(vec3(0.05, 0.07, 0.14), vec3(0.16, 0.13, 0.12), clouds) * glow * 0.42;
        col += vec3(0.0025, 0.004, 0.009); // space is never pure black on screen
        gl_FragColor = vec4(col * uBrightness, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), material);
  mesh.name = 'galaxy-band';
  mesh.frustumCulled = false;
  mesh.renderOrder = -20;
  return mesh;
}

function createSun() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uVisibility: { value: 1 }, uColor: { value: new THREE.Color(1, 0.96, 0.9) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv * 2.0 - 1.0;
        // camera-facing quad
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uVisibility;
      uniform vec3 uColor;
      void main(){
        float r = length(vUv);
        float disc = smoothstep(0.070, 0.058, r);
        float corona = exp(-r * 11.0) * 0.6 + exp(-r * 3.4) * 0.07;
        // soft cross-shaped streaks, like a camera lens
        float a = atan(vUv.y, vUv.x);
        float streak = pow(abs(cos(a * 2.0)), 60.0) * exp(-r * 4.0) * 0.35;
        float edge = 1.0 - smoothstep(0.75, 1.0, r);
        vec3 col = uColor * (disc * 14.0 + corona * 2.2 + streak) * edge;
        gl_FragColor = vec4(col * uVisibility, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const size = SUN_DISTANCE * 0.42;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.name = 'sun';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';
  // Stars and the galactic band are fixed in space, so in the station's frame
  // they wheel around once per orbit, together with the sun.
  const fixed = new THREE.Group();
  const band = createGalaxyBand();
  const stars = createStars();
  fixed.add(band, stars);
  const sun = createSun();
  group.add(fixed, sun);

  return {
    group,
    farPlane: SKY_RADIUS * 1.5,
    /**
     * @param {THREE.Vector3} sunDir unit vector toward the sun
     * @param {number} sunAngle radians of the sun from straight up (orbit.angle)
     * @param {number} sunFactor 0..1 strength of sunlight
     * @param {THREE.Color} sunColor current sunlight colour
     * @param {THREE.Camera} camera
     * @param {number} seconds real seconds, for twinkle
     * @param {number} pixelRatio
     */
    update(sunDir, sunAngle, sunFactor, sunColor, camera, seconds, pixelRatio) {
      group.position.copy(camera.position); // the sky never shows parallax
      fixed.rotation.z = -sunAngle;
      sun.position.copy(sunDir).multiplyScalar(SUN_DISTANCE);
      sun.material.uniforms.uVisibility.value = 0.45 + 0.55 * sunFactor;
      sun.material.uniforms.uColor.value.copy(sunColor);
      // eyes adapt: stars come out in eclipse and wash out in daylight
      const starLevel = THREE.MathUtils.lerp(1.0, LOOK.starsInDaylight, sunFactor);
      stars.material.uniforms.uBrightness.value = starLevel;
      stars.material.uniforms.uPixelRatio.value = pixelRatio;
      stars.material.uniforms.uTime.value = seconds;
      band.material.uniforms.uBrightness.value = starLevel;
    },
  };
}

/**
 * A soft picture of the surroundings for shiny surfaces to reflect: the bright
 * planet below, its blue limb, black space above. Fixed in the station's frame.
 */
export function createEnvironment(renderer, limbAngle) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    uniforms: { uLimb: { value: -Math.cos(limbAngle) } }, // height of the planet's edge, as sin(elevation)
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      uniform float uLimb;
      void main(){
        float y = normalize(vDir).y;
        float ground = smoothstep(uLimb + 0.04, uLimb - 0.04, y);
        vec3 planet = mix(vec3(0.42, 0.60, 0.95), vec3(0.20, 0.36, 0.72), smoothstep(uLimb, -1.0, y));
        vec3 glow = vec3(0.35, 0.60, 1.0) * exp(-abs(y - uLimb) * 16.0) * 1.4;
        vec3 space = vec3(0.012, 0.014, 0.022);
        gl_FragColor = vec4(mix(space, planet, ground) + glow, 1.0);
      }`,
    side: THREE.BackSide,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  scene.add(dome);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.04);
  generator.dispose();
  dome.geometry.dispose();
  material.dispose();
  return target.texture;
}
