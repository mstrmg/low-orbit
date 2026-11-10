// Effects: the final image pass (bloom, vignette) and the heat-map tint.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HEAT } from '../config/balance.js';
import { LOOK } from './look.js';

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.3 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float edge = smoothstep(0.25, 0.95, dot(p, p) * 2.0);
      gl_FragColor = vec4(c.rgb * (1.0 - uAmount * edge), c.a);
    }`,
};

/**
 * The image pipeline: draw the scene in HDR with anti-aliasing, let the bright
 * parts glow (sun, city lights, lamps), darken the corners a touch, then tone-map.
 */
export function createPost(renderer, scene, camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
  composer.addPass(bloom);
  const vignette = new ShaderPass(VIGNETTE);
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  return {
    composer,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    /**
     * sunFactor 0..1. Lamps and city lights bloom a little more in the dark, and the
     * glow swells for a moment as the sun crosses the planet's edge (the sunrise flash).
     */
    update(sunFactor) {
      const crossing = 4 * sunFactor * (1 - sunFactor); // 0 → 1 → 0 through sunrise or sunset
      bloom.strength = LOOK.bloomStrength * THREE.MathUtils.lerp(1.5, 1.0, sunFactor) + LOOK.sunriseFlash * crossing;
    },
    render() {
      composer.render();
    },
  };
}

// --- Heat map -------------------------------------------------------------------

const stops = LOOK.heatStops.map(([at, hex]) => [at, new THREE.Color(hex)]);
const heatColor = new THREE.Color();

/** Blue (cold) through green and amber (warn) to red (MAX_TEMP), for the heat-map view. */
export function heatMapColor(temp, target = heatColor) {
  const t = THREE.MathUtils.clamp(temp / HEAT.MAX_TEMP, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, colorA] = stops[i - 1];
      const [b, colorB] = stops[i];
      return target.lerpColors(colorA, colorB, (t - a) / (b - a));
    }
  }
  return target.copy(stops[stops.length - 1][1]);
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
      // Mostly self-lit, so the colour reads the same in sunlight and in eclipse.
      heatMapColor(module.temp, entry.heatMaterial.emissive);
      entry.heatMaterial.color.copy(entry.heatMaterial.emissive).multiplyScalar(0.35);
      // hot modules glow harder, so trouble stands out
      entry.heatMaterial.emissiveIntensity = 0.5 + 0.45 * THREE.MathUtils.clamp(module.temp / HEAT.MAX_TEMP, 0, 1);
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
