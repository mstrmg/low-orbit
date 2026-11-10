// The planet: one handmade (fixed-seed) world with no image files.
//
// The big shapes (continents, rainfall, cloud systems, where cities cluster) are
// painted once at start-up into a small cube map. Every frame the surface shader
// reads that and adds fine detail on top, only as fine as a pixel can show. That
// keeps coastlines and clouds crisp right under the station without paying for
// dozens of noise layers per pixel.
//
// Drawn here: day/night line, city lights, clouds and their shadows, ocean glint,
// terrain relief, haze toward the limb, and the atmosphere glow around the edge.
// Everything follows one sun direction, the same one that lights the station.
//
// Render-only: reads a sun direction and a time, knows nothing about the sim.

import * as THREE from 'three';
import { LOOK } from './look.js';
import { NOISE_GLSL } from './noise.glsl.js';

// ---------------------------------------------------------------------------
// Bake: r = terrain height, g = moisture, b = cloud field, a = city clustering
// ---------------------------------------------------------------------------
const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 q = d * 1.25;
  vec3 w = vec3(fbm(q, 4), fbm(q + vec3(5.2, 1.3, 2.8), 4), fbm(q + vec3(1.7, 9.2, 4.4), 4));

  float h = fbm(d * 1.45 + w * 0.7 + vec3(3.1, 0.4, 7.7), 6);
  // mountain ranges: sharp ridges, only well inland
  float ridge = 1.0 - abs(snoise(d * 5.0 + w * 1.5));
  h += 0.16 * ridge * ridge * smoothstep(0.04, 0.29, h);

  float moisture = fbm(d * 2.3 + w * 0.5 + vec3(11.0, 4.0, 2.0), 5) * 0.5 + 0.5;

  vec3 cw = vec3(fbm(d * 2.2 + 20.0, 4), fbm(d * 2.2 + 31.0, 4), fbm(d * 2.2 + 47.0, 4));
  float cloud = fbm(d * 2.6 + cw * 1.15 + vec3(8.0), 5);

  float region = fbm(d * 7.0 + vec3(2.0), 4);
  gl_FragColor = vec4(h, moisture, cloud, region);
}
`;

function bakePlanetMaps(renderer) {
  const target = new THREE.WebGLCubeRenderTarget(LOOK.bakeSize, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.NoColorSpace,
  });
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: BAKE_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  scene.add(box);
  const camera = new THREE.CubeCamera(0.1, 10, target);
  camera.update(renderer, scene);
  box.geometry.dispose();
  material.dispose();
  return target;
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------
const SURFACE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform samplerCube uBake;
uniform vec3 uCameraToCenter; // planet centre relative to the camera
uniform float uCameraC;       // |camera - centre|^2 - radius^2
uniform float uRadius;
uniform mat3 uWorldToLocal;   // world direction -> the planet's own (turning) frame
uniform vec3 uSunDir;      // toward the sun, world space
uniform vec3 uSunLocal;    // same, in the planet's own frame
uniform vec2 uCloudTurn;   // cos, sin of how far the clouds have drifted
uniform float uTime;       // real seconds, for twinkle only
${NOISE_GLSL}

const float SEA = 0.04;
const float SUN_STEP = 0.011; // radians stepped toward the sun for shadows and relief

// Extra noise layers on top of the baked field. Layers finer than a pixel fade out,
// so the ground never shimmers toward the horizon. Returns (all layers, broad layers only):
// the broad part is used for shading, where pixel-sized bumps would only add grit.
vec2 fineDetail(vec3 p, float pixel, float freq, float amp, int layers){
  vec2 sum = vec2(0.0);
  for (int i = 0; i < 6; i++){
    if (i >= layers) break;
    float fade = 1.0 - smoothstep(0.22, 0.6, freq * pixel);
    if (fade <= 0.0) break;
    float n = amp * fade * snoise(p * freq + float(i) * 17.3);
    sum.x += n;
    sum.y += n * (1.0 - smoothstep(0.03, 0.09, freq * pixel));
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

vec3 turnClouds(vec3 d){
  return vec3(uCloudTurn.x * d.x + uCloudTurn.y * d.z, d.y, -uCloudTurn.y * d.x + uCloudTurn.x * d.z);
}

float cloudCover(float field, float lat){
  // bands: wet near the equator and at mid latitudes, clearer in between
  float band = 0.09 * cos(lat * 9.0) + 0.10 * smoothstep(0.45, 0.8, abs(lat));
  return smoothstep(0.03, 0.40, field + band);
}

// Tilt a normal by the slope of a height field, using screen-space derivatives.
vec3 bumpNormal(vec3 N, vec3 P, float height){
  vec3 dpdx = dFdx(P);
  vec3 dpdy = dFdy(P);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * N - grad);
}

void main(){
  // The mesh only says which pixels the planet covers. The exact point on the
  // sphere comes from the view ray, so nothing depends on the mesh's flat triangles.
  vec3 ray = normalize(vWorldPos - cameraPosition);
  float along = dot(uCameraToCenter, ray);
  float reach = along - sqrt(max(along * along - uCameraC, 0.0));
  vec3 N = normalize(ray * reach - uCameraToCenter);
  vec3 P = N * uRadius; // relative to the planet's centre
  vec3 d = uWorldToLocal * N;
  vec3 L = normalize(uSunDir);
  vec3 V = -ray;
  float pixel = max(length(dFdx(d)), length(dFdy(d))); // radians of ground per screen pixel
  float NdL = dot(N, L);
  float mu = clamp(dot(N, V), 0.0, 1.0);

  vec4 baked = textureCube(uBake, d);

  // --- ground ---------------------------------------------------------------
  vec2 hFine = fineDetail(d, pixel, 100.0, 0.014, 6);
  float h = baked.r + hFine.x;
  float coastWidth = max(0.0015, pixel * 30.0);
  float land = smoothstep(SEA - coastWidth, SEA + coastWidth, h);
  float elev = max(h - SEA, 0.0);
  float lat = d.y;
  float alat = abs(lat);
  float grain = snoise(d * 37.0);

  float moisture = baked.g + grain * 0.04;
  float temp = 1.0 - alat * 1.15 - elev * 1.3 + 0.10 * snoise(d * 3.7);
  float iceEdge = 0.80 + 0.06 * grain + 0.25 * (h - SEA);
  float ice = smoothstep(iceEdge, iceEdge + 0.02, alat);

  float depth = smoothstep(-0.24, 0.0, h - SEA);
  vec3 water = mix(vec3(0.003, 0.016, 0.070), vec3(0.008, 0.060, 0.165), depth);
  water = mix(water, vec3(0.020, 0.230, 0.290), pow(depth, 7.0) * 0.85);

  vec3 desert = vec3(0.50, 0.37, 0.21);
  vec3 savanna = vec3(0.27, 0.26, 0.11);
  vec3 jungle = vec3(0.025, 0.135, 0.040);
  vec3 forest = vec3(0.040, 0.110, 0.040);
  vec3 tundra = vec3(0.24, 0.23, 0.18);
  vec3 rock = vec3(0.21, 0.18, 0.16);
  vec3 snow = vec3(0.85, 0.89, 0.95);
  vec3 warm = mix(desert, mix(savanna, jungle, smoothstep(0.50, 0.72, moisture)), smoothstep(0.34, 0.55, moisture));
  vec3 cool = mix(tundra, forest, smoothstep(0.36, 0.60, moisture));
  vec3 ground = mix(cool, warm, smoothstep(0.36, 0.66, temp));
  ground = mix(ground, rock, smoothstep(0.20, 0.36, elev));
  ground = mix(ground, snow, smoothstep(0.10, 0.02, temp) * 0.92);
  ground *= 0.86 + 0.28 * fineDetail(d, pixel, 500.0, 1.0, 2).x;

  vec3 albedo = mix(water, ground, land);
  albedo = mix(albedo, snow, ice);
  float solid = max(land, ice); // not open water

  // --- clouds ---------------------------------------------------------------
  vec3 dc = turnClouds(d);
  vec2 cFine = fineDetail(dc, pixel, 90.0, 0.030, 5);
  float cloudFine = cFine.x;
  float cloudBase = textureCube(uBake, dc).b;
  float cloud = cloudCover(cloudBase + cloudFine, lat);
  // One more look at the map, a short step toward the sun. It gives the cloud shadows,
  // and comparing "here" with "sunward" shows which slopes face the light.
  vec3 sunSide = uSunLocal - d * dot(uSunLocal, d);
  vec3 ds = normalize(d + sunSide * SUN_STEP);
  float sunwardHeight = textureCube(uBake, ds).r;
  float shadow = cloudCover(textureCube(uBake, turnClouds(ds)).b + cloudFine, ds.y);

  // --- relief ---------------------------------------------------------------
  float rough = solid * (1.0 - ice * 0.7);
  float broadRelief = (max(baked.r - SEA, 0.0) - max(sunwardHeight - SEA, 0.0)) * rough * 9.0;
  vec3 Nb = bumpNormal(N, P, hFine.y * rough * 150.0);
  float fineRelief = dot(Nb, L) - NdL;
  float cloudRelief = (cloud - shadow) * 0.55 * smoothstep(0.0, 0.3, cloud);
  float relief = clamp(mix(broadRelief + fineRelief, cloudRelief, smoothstep(0.0, 0.5, cloud)), -0.6, 0.6);

  // --- daylight -------------------------------------------------------------
  // sunlight reddens where it grazes through the air near the day/night line
  vec3 sunCol = mix(vec3(1.0, 0.42, 0.17), vec3(1.0, 0.96, 0.90), smoothstep(-0.03, 0.30, NdL));
  float day = smoothstep(-0.09, 0.14, NdL);
  float lambert = clamp(NdL * 0.9 + 0.1, 0.0, 1.0);
  float shade = clamp(lambert + relief * 1.25 * smoothstep(-0.05, 0.25, NdL), 0.0, 1.3);

  vec3 surface = albedo * (1.0 - 0.6 * shadow * (1.0 - cloud));
  surface = mix(surface, vec3(0.90, 0.92, 0.96), cloud);
  vec3 col = surface * sunCol * shade * day * 1.05;
  col += surface * vec3(0.018, 0.030, 0.055) * day; // skylight fills the shadows

  // sun glint on open water
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float open = (1.0 - solid) * (1.0 - cloud) * (1.0 - shadow * 0.7);
  col += sunCol * open * day * (pow(NdH, 420.0) * 3.2 + pow(NdH, 40.0) * 0.20);

  // --- night ----------------------------------------------------------------
  float night = 1.0 - smoothstep(-0.14, 0.03, NdL);
  if (night > 0.001){
    float cluster = smoothstep(0.10, 0.58, baked.a + 0.22 * exp(-elev * 14.0));
    float liveable = land * (1.0 - ice) * smoothstep(0.05, 0.30, temp) * (1.0 - smoothstep(0.20, 0.34, elev))
      * mix(0.2, 1.0, smoothstep(0.28, 0.52, moisture));
    // metro areas: separate bright patches inside the settled regions, joined by a web of roads
    float metro = pow(max(snoise(d * 46.0 + 7.0) * 0.5 + 0.5, 0.0), 3.0) * 2.2;
    float web = pow(1.0 - abs(snoise(d * 90.0 + 2.0)), 16.0);
    // towns: sharp dots up close, melting into a soft glow far away
    float sharp = 1.0 - smoothstep(0.10, 0.45, 700.0 * pixel);
    float n1 = snoise(d * 300.0);
    float n2 = snoise(d * 760.0 + 5.0);
    float towns = pow(max(n1, 0.0), 2.0) * 1.2 + pow(max(n2, 0.0), 3.0) * 1.8;
    towns = mix(0.16, towns, sharp);
    float twinkle = 0.9 + 0.1 * sin(uTime * 3.0 + n2 * 40.0);
    float lights = liveable * cluster * ((metro + 0.05) * towns + web * 0.5 * (0.3 + metro)) * twinkle;
    col += vec3(1.0, 0.60, 0.26) * lights * night * (1.0 - cloud * 0.9) * 3.6;
    // faint moonlight so the night side keeps some shape
    col += (albedo * 0.5 + vec3(0.05) * cloud + vec3(0.004, 0.006, 0.012)) * vec3(0.08, 0.115, 0.19) * night;
  }

  // --- air ------------------------------------------------------------------
  float haze = pow(1.0 - mu, 2.4);
  float hazeLit = smoothstep(-0.20, 0.26, NdL);
  vec3 hazeCol = mix(vec3(1.0, 0.40, 0.14), vec3(0.27, 0.53, 1.0), smoothstep(-0.06, 0.28, NdL));
  col = mix(col, hazeCol * hazeLit * 1.05, haze * 0.86);
  col += hazeCol * hazeLit * 0.022;
  col += vec3(0.010, 0.022, 0.050) * pow(1.0 - mu, 5.0) * (1.0 - hazeLit); // night airglow

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Atmosphere: an additive shell. For each view ray it finds how close the ray
// passes to the ground and glows accordingly.
// ---------------------------------------------------------------------------
const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMOSPHERE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCenter;
uniform vec3 uSunDir;
uniform float uRadius;
uniform float uHeight;
void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);
  vec3 L = normalize(uSunDir);
  float t = max(dot(uCenter - ro, rd), 0.0);
  vec3 radial = ro + rd * t - uCenter;
  float dist = length(radial);
  float h = dist - uRadius;
  if (h < -1.0) discard; // the ground is drawn by the surface shader
  h = max(h, 0.0);
  float density = exp(-h / (uHeight * 0.26)) * (1.0 - smoothstep(uHeight * 0.7, uHeight, h));

  float s = dot(radial / dist, L); // +1 where the air is in full sun, -1 at midnight
  float lit = smoothstep(-0.28, 0.20, s);
  float dusk = exp(-pow((s + 0.05) / 0.16, 2.0));
  float toSun = max(dot(rd, L), 0.0);
  float forward = pow(toSun, 9.0);
  float halo = pow(toSun, 120.0);

  vec3 blue = vec3(0.22, 0.50, 1.0);
  vec3 orange = vec3(1.0, 0.37, 0.10);
  vec3 col = blue * lit * (1.0 - dusk * 0.8) * 0.9;
  col += orange * dusk * (0.55 + 1.5 * forward);
  col += vec3(1.0, 0.62, 0.32) * forward * lit * 0.28;
  col += vec3(1.0, 0.76, 0.52) * halo * smoothstep(-0.2, 0.0, s) * 1.1;
  col *= 1.0 + 1.5 * exp(-h / (uHeight * 0.06)); // bright thin line right at the limb
  col *= density;

  // night side: a faint green-blue airglow layer floating above the dark limb
  float layer = exp(-pow((h - uHeight * 0.34) / (uHeight * 0.085), 2.0));
  col += (vec3(0.020, 0.052, 0.030) * layer + vec3(0.006, 0.014, 0.034) * density) * (1.0 - lit);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * @param {THREE.WebGLRenderer} renderer used once, to paint the planet's maps
 * @param {THREE.Vector3} center planet centre in world space
 */
export function createPlanet(renderer, center) {
  const radius = LOOK.planetRadius;
  const maps = bakePlanetMaps(renderer);

  const group = new THREE.Group();
  group.name = 'planet';
  group.position.copy(center);

  const ground = new THREE.Group(); // turns so the ground slides under the station
  group.add(ground);

  const uniforms = {
    uBake: { value: maps.texture },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
    uCloudTurn: { value: new THREE.Vector2(1, 0) },
    uTime: { value: 0 },
    uCameraToCenter: { value: new THREE.Vector3() },
    uCameraC: { value: 0 },
    uRadius: { value: radius },
    uWorldToLocal: { value: new THREE.Matrix3() },
  };
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 256, 128),
    new THREE.ShaderMaterial({ uniforms, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG }),
  );
  surface.name = 'planet-surface';
  surface.frustumCulled = false;
  surface.onBeforeRender = (_renderer, _scene, camera) => {
    const toCenter = uniforms.uCameraToCenter.value.subVectors(center, camera.position);
    uniforms.uCameraC.value = toCenter.lengthSq() - radius * radius;
  };
  ground.add(surface);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius + LOOK.atmosphereHeight, 192, 96),
    new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: center.clone() },
        uSunDir: uniforms.uSunDir,
        uRadius: { value: radius },
        uHeight: { value: LOOK.atmosphereHeight },
      },
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  atmosphere.name = 'planet-atmosphere';
  atmosphere.frustumCulled = false;
  atmosphere.renderOrder = 2;
  group.add(atmosphere);

  const inverse = new THREE.Matrix4();

  return {
    group,
    radius,
    /**
     * @param {THREE.Vector3} sunDir unit vector toward the sun, world space
     * @param {number} orbits game time in orbits flown (fractional, keeps growing)
     * @param {number} seconds real seconds, for small ambient animation
     */
    update(sunDir, orbits, seconds) {
      // The station flies toward the sunrise (−X), so the ground slides toward +X.
      ground.rotation.z = -(orbits / LOOK.groundLapOrbits) * Math.PI * 2;
      surface.rotation.set(LOOK.groundTrackTilt, (orbits / LOOK.groundDriftOrbits) * Math.PI * 2, 0);
      surface.updateWorldMatrix(true, false);
      inverse.copy(surface.matrixWorld).invert();
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uSunLocal.value.copy(sunDir).transformDirection(inverse);
      uniforms.uWorldToLocal.value.setFromMatrix4(inverse);
      const drift = (orbits / LOOK.cloudDriftOrbits) * Math.PI * 2;
      uniforms.uCloudTurn.value.set(Math.cos(drift), Math.sin(drift));
      uniforms.uTime.value = seconds;
    },
    dispose() {
      maps.dispose();
      surface.geometry.dispose();
      surface.material.dispose();
      atmosphere.geometry.dispose();
      atmosphere.material.dispose();
    },
  };
}
