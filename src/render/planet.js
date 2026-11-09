// The planet: one handmade world drawn entirely by a shader (no image files).
// Day/night line, city lights on the night side, clouds, ocean glint and
// haze toward the limb all follow the same sun direction as the station light.

import * as THREE from 'three';

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p, int octaves) {
    float amp = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      sum += amp * noise(p);
      p = p * 2.03 + vec3(17.1, 3.7, 9.2);
      amp *= 0.5;
    }
    return sum;
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vSurface; // unit position on the sphere, fixed to the ground
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vSurface = normalize(position);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vSurface;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  ${NOISE}

  void main() {
    vec3 p = normalize(vSurface);
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    float facing = max(dot(N, V), 0.0);
    // How much finer than a pixel the surface detail is (large near the horizon).
    float blur = clamp((fwidth(p.x) + fwidth(p.y) + fwidth(p.z)) * 90.0, 0.0, 1.0);

    // --- Ground: continents, biomes, shallows -------------------------------
    vec3 warp = vec3(fbm(p * 2.1 + 3.0, 3), fbm(p * 2.1 + 19.0, 3), fbm(p * 2.1 + 41.0, 3)) - 0.25;
    float height = fbm(p * 2.6 + warp * 1.4 + 11.0, 7);
    float coast = 0.515;
    float land = smoothstep(coast, coast + 0.012, height);
    float elevation = clamp((height - coast) / 0.22, 0.0, 1.0);
    float depth = clamp((coast - height) / 0.16, 0.0, 1.0);

    float latitude = abs(dot(p, normalize(vec3(0.45, 0.25, 0.86))));
    float moisture = fbm(p * 6.0 + 57.0, 4);
    vec3 forest = vec3(0.07, 0.24, 0.09);
    vec3 grass = vec3(0.24, 0.36, 0.12);
    vec3 desert = vec3(0.62, 0.47, 0.27);
    vec3 rock = vec3(0.36, 0.31, 0.28);
    vec3 snow = vec3(0.92, 0.95, 1.0);
    vec3 ground = mix(desert, mix(grass, forest, smoothstep(0.45, 0.62, moisture)), smoothstep(0.38, 0.52, moisture + latitude * 0.25));
    ground = mix(ground, rock, smoothstep(0.45, 0.8, elevation));
    ground = mix(ground, snow, smoothstep(0.78, 0.95, elevation + latitude * 0.5));

    vec3 shallow = vec3(0.05, 0.42, 0.52);
    vec3 deep = vec3(0.012, 0.075, 0.24);
    vec3 ocean = mix(shallow, deep, smoothstep(0.0, 0.55, depth));
    vec3 albedo = mix(ocean, ground, land);

    // --- Clouds ----------------------------------------------------------------
    vec3 drift = vec3(uTime * 0.004, 0.0, uTime * 0.0025);
    float cloudField = fbm(p * 5.5 + drift + warp * 2.2 + 80.0, 6);
    float cloud = smoothstep(0.50, 0.70, cloudField) * 0.92;

    // --- Light -----------------------------------------------------------------
    float ndl = dot(N, uSunDir);
    float day = smoothstep(-0.08, 0.22, ndl);
    float twilight = smoothstep(-0.2, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.38, ndl));
    vec3 sunColor = mix(vec3(1.0), vec3(1.0, 0.52, 0.26), twilight);
    float diffuse = pow(max(ndl, 0.0), 0.75);

    vec3 surface = albedo * (1.0 - cloud * 0.45);
    surface = mix(surface, vec3(0.96, 0.97, 1.0), cloud);
    vec3 color = surface * sunColor * (diffuse * 2.1 + 0.05) * day;

    // Sun glint on open water.
    vec3 H = normalize(uSunDir + V);
    float glint = pow(max(dot(N, H), 0.0), 90.0) * (1.0 - land) * (1.0 - cloud) * day;
    color += vec3(1.0, 0.9, 0.75) * glint * 1.6;

    // --- Night side: city lights ---------------------------------------------
    float region = smoothstep(0.52, 0.72, fbm(p * 34.0 + 5.0, 4));
    float towns = smoothstep(0.55, 0.9, noise(p * 420.0)) * 0.75 + smoothstep(0.7, 0.95, noise(p * 150.0));
    towns = mix(towns, 0.32, blur);
    float lowland = 1.0 - smoothstep(0.35, 0.7, elevation);
    vec3 cities = vec3(1.0, 0.68, 0.34) * region * towns * land * lowland * (1.0 - cloud * 0.85);
    color += cities * (1.0 - day) * 1.5;
    color += albedo * vec3(0.012, 0.018, 0.035) * (1.0 - day); // faint moonlit ground

    // --- Air: haze toward the limb, warm at the terminator -----------------
    float limb = pow(1.0 - facing, 2.6);
    vec3 haze = mix(vec3(0.30, 0.58, 1.0), vec3(1.0, 0.45, 0.2), twilight * 0.85);
    color = mix(color, haze * (0.25 + 1.2 * day), limb * (0.12 + 0.72 * max(day, twilight * 0.7)));
    color += vec3(0.03, 0.07, 0.16) * pow(1.0 - facing, 5.0) * (1.0 - day); // airglow

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createPlanet(radius) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 256, 128), material);
  mesh.name = 'planet';
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
