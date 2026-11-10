// Effects: atmosphere glow at the planet's edge, the sun and its sunrise
// flash, the star field, and the heat-map tint.

import * as THREE from 'three';
import { HEAT } from '../config/balance.js';

/** A thin shell around the planet that glows along the limb. */
export function createAtmosphereGlow(planetRadius, thickness = 0.022) {
  const shellRadius = planetRadius * (1 + thickness);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    // Cosine of the grazing angle where a ray that just touches the planet meets the shell.
    uEdge: { value: Math.sqrt(1 - (planetRadius / shellRadius) ** 2) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uEdge;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float grazing = clamp(-dot(N, V) / uEdge, 0.0, 1.0); // 0 at the outer edge, 1 at the ground
        float glow = pow(grazing, 1.7);
        float ndl = dot(N, uSunDir);
        float day = smoothstep(-0.3, 0.2, ndl);
        float twilight = smoothstep(-0.45, -0.05, ndl) * (1.0 - smoothstep(0.0, 0.4, ndl));
        float towardSun = pow(max(dot(-V, uSunDir), 0.0), 10.0);
        vec3 color = vec3(0.25, 0.55, 1.0) * day * 1.15;
        color += vec3(1.0, 0.42, 0.14) * twilight * 0.9;
        color += vec3(1.0, 0.72, 0.45) * towardSun * smoothstep(-0.5, 0.0, ndl) * 2.4;
        color += vec3(0.04, 0.09, 0.2) * (1.0 - day);
        gl_FragColor = vec4(color * glow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(shellRadius, 192, 96), material);
  mesh.name = 'atmosphere';
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

function radialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The sun: a bright disc with a soft halo that the planet's edge can hide,
 * plus a wide flare that blooms over the limb at sunrise and sunset.
 */
export function createSun(distance) {
  const group = new THREE.Group();
  group.name = 'sun';
  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,255,255,1)'],
        [0.045, 'rgba(255,252,240,1)'],
        [0.07, 'rgba(255,236,190,0.55)'],
        [0.2, 'rgba(255,205,130,0.16)'],
        [0.5, 'rgba(255,170,90,0.04)'],
        [1, 'rgba(255,150,70,0)'],
      ]),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  disc.scale.setScalar(distance * 0.5);
  const flare = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,210,150,0.9)'],
        [0.15, 'rgba(255,150,80,0.35)'],
        [0.5, 'rgba(255,110,50,0.08)'],
        [1, 'rgba(255,90,40,0)'],
      ]),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      opacity: 0,
    }),
  );
  flare.scale.setScalar(distance * 0.95);
  flare.renderOrder = 5;
  group.add(disc, flare);

  return {
    group,
    /** sunFactor 0..1; the flare peaks mid-fade, at sunrise and sunset. */
    update(sunDir, sunFactor, sunlit) {
      group.position.copy(sunDir).multiplyScalar(distance);
      const edge = 4 * sunFactor * (1 - sunFactor); // 0 → 1 → 0 through the fade
      flare.material.opacity = sunlit ? edge * 0.75 : 0;
      disc.material.opacity = sunlit ? 0.35 + 0.65 * sunFactor : 0;
    },
  };
}

/** Stars on a far sphere. They turn with the sun and dim while it is up. */
export function createStars(radius, count = 2600) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(a) * radius, r * Math.sin(a) * radius, z * radius], i * 3);
    const brightness = 0.25 + 0.75 * random() ** 2.5;
    tint.setHSL(0.55 + random() * 0.15, 0.25 * random(), brightness);
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'stars';
  points.frustumCulled = false;
  return points;
}

const heatColor = new THREE.Color();

/** Blue (cold) → red (MAX_TEMP) for the heat-map view. */
export function heatMapColor(temp, target = heatColor) {
  const t = THREE.MathUtils.clamp(temp / HEAT.MAX_TEMP, 0, 1);
  return target.setHSL(0.64 * (1 - t), 0.9, 0.5);
}

/**
 * Heat-map view: swap every module's materials for one flat colour by
 * temperature, or put the normal materials back.
 */
export function applyHeatMap(stationView, state, enabled) {
  for (const module of state.modules) {
    const entry = stationView.entries.get(module.id);
    if (!entry) continue;
    if (enabled) {
      heatMapColor(module.temp, entry.heatMaterial.color);
      entry.heatMaterial.emissive.copy(entry.heatMaterial.color).multiplyScalar(0.55);
    }
    if (entry.heatOn === enabled) continue;
    entry.heatOn = enabled;
    entry.group.traverse((object) => {
      if (!object.isMesh || object.userData.keepMaterial) return;
      if (enabled) {
        object.userData.baseMaterial ??= object.material;
        object.material = entry.heatMaterial;
      } else if (object.userData.baseMaterial) {
        object.material = object.userData.baseMaterial;
      }
    });
  }
}
